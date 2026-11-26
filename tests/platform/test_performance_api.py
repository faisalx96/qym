"""The Performance page routes: reads, start with its preconditions, stop, token hand-off, the runner."""

from __future__ import annotations

import csv
import io
import json
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    NOW,
    OTHER_TOKEN,
    RUNNER_TOKEN,
    TOKENS,
    page_time,
    seed_api_key,
    seed_dataset,
    seed_event,
    seed_log_lines,
    seed_performance,
    seed_questions,
    seed_report,
    seed_run,
    seed_runner,
    seed_target,
    seed_token,
    seed_user,
    target_tokens,
    token_value,
    use_encryption_key,
)
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    Dataset,
    DatasetItem,
    DatasetVersion,
    DatasetVersionStatus,
    PerformanceEvent,
    PerformanceQuestion,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    Project,
    ProjectRole,
    User,
)
from qym_platform.permissions import VIEWER_DETAIL
from qym_platform.security import api_key_prefix
from qym_platform.services import (
    performance_runs,
    performance_targets,
    performance_views,
)
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.settings import PlatformSettings

PROJECT = "performance-project-1"
BASE = f"/api/projects/{PROJECT}/performance"
OWNER_ID = "performance-user-owner-1"
MEMBER_ID = "performance-user-member-1"
MANAGER = {"X-User-Email": f"{OWNER_ID}@example.test"}
MEMBER = {"X-User-Email": f"{MEMBER_ID}@example.test"}
VIEWER = {"X-User-Email": "performance-user-viewer-1@example.test"}
OUTSIDER = {"X-User-Email": "performance-user-outsider-1@example.test"}
ADMIN = {"X-User-Email": "owner@example.test"}
AT = "2026-11-20T11:00:00Z"
# The code the platform gives its Viewer rule (derived from the sentence).
VIEWER_CODE = "viewers_cannot_change_this_project"
NEW_TOKEN = "example-new-refresh-token-7a2e"
PLAN = {
    "baseline_users": 5,
    "max_users": 20,
    "step_users": 10,
    "hold_seconds": 450,
    "limit_ms": 180000,
    "max_error_rate_pct": 10,
    "timeout_seconds": 540,
}
MIX = {"simple": 50, "medium": 35, "complex": 15}
LEVELS = [
    {"level": 10, "state": "done", "answers": 22, "p95_ms": 61000, "result": "pass"},
    {"level": 20, "state": "running", "answers": 9, "p95_ms": 95000, "result": "pass"},
]
HEADLINE = {
    "verdict": "breakpoint_found",
    "safe_load_users": 10,
    "breaking_level_users": 20,
    "breaking_reason": "latency",
    "recommended_max_users": 8,
    "p95_at_safe_load_ms": 150000.0,
    "p95_ms": 170000.0,
    "answers_measured": 40,
    "answers_total": 50,
    "errors_total": 2,
    "error_rate_pct": 4.0,
    "max_users": 20,
    "duration_s": 240.0,
    "quality_mean": 95.0,
}


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    page_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seeded = seed_performance(db)
        seed_user(db, seeded.project, suffix="viewer-1", role=ProjectRole.VIEWER)
        seed_user(db, suffix="outsider-1")
        db.commit()
    return factory


def world(db) -> SimpleNamespace:
    """The seeded rows of the first project, loaded in this session."""
    return SimpleNamespace(
        project=db.get(Project, PROJECT),
        owner=db.get(User, OWNER_ID),
        member=db.get(User, MEMBER_ID),
        runner=db.scalars(
            select(PerformanceRunner).where(
                PerformanceRunner.project_id == PROJECT,
                PerformanceRunner.key == "runner-1",
            )
        ).first(),
        target=db.scalars(
            select(PerformanceTarget).where(
                PerformanceTarget.project_id == PROJECT,
                PerformanceTarget.name == "QA - Preprod",
            )
        ).first(),
        version=db.scalars(
            select(DatasetVersion)
            .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
            .where(Dataset.project_id == PROJECT, Dataset.name == "QA - Load questions")
        ).first(),
    )


def change(session_factory, work):
    """Run ``work(db, world)`` in one committed transaction and return its result."""
    with session_factory() as db:
        result = work(db, world(db))
        db.commit()
        return result


def add_run(session_factory, **values) -> str:
    def work(db, w):
        user = values.pop("by", None)
        return seed_run(
            db,
            w.project,
            w.runner,
            w.target,
            user=getattr(w, user) if user else None,
            **values,
        ).id

    return change(session_factory, work)


@pytest.fixture()
def ids(session_factory) -> SimpleNamespace:
    with session_factory() as db:
        w = world(db)
        return SimpleNamespace(
            runner=w.runner.id,
            target=w.target.id,
            version=w.version.id,
            dataset=w.version.dataset_id,
        )


@contextmanager
def statements(engine):
    seen: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


def refused(response, http: int, code: str, **details):
    assert response.status_code == http, response.text
    error = response.json()["error"]
    assert error["code"] == code, error
    assert error["message"]
    for name, value in details.items():
        assert error["details"][name] == value, error
    return error


def get(client, path: str = "", headers=MEMBER, **params) -> dict:
    response = client.get(BASE + path, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def start_body(ids, **changes) -> dict:
    body = {
        "target_id": ids.target,
        "test_type": "breakpoint",
        "dataset_version_id": ids.version,
        "plan": dict(PLAN),
        "mix": dict(MIX),
    }
    body.update(changes)
    return body


def start(client, ids, headers=MEMBER, **changes):
    return client.post(f"{BASE}/runs", headers=headers, json=start_body(ids, **changes))


def stored_runs(session_factory) -> list[PerformanceRun]:
    with session_factory() as db:
        runs = list(
            db.scalars(select(PerformanceRun).order_by(PerformanceRun.number)).all()
        )
        db.expunge_all()
        return runs


def audits(session_factory, action: str) -> list[AuditLog]:
    with session_factory() as db:
        return list(
            db.scalars(
                select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
            ).all()
        )


def events(session_factory, run_id: str) -> list[tuple[str, str]]:
    with session_factory() as db:
        rows = db.scalars(
            select(PerformanceEvent)
            .where(PerformanceEvent.run_id == run_id)
            .order_by(PerformanceEvent.id)
        ).all()
        return [(row.code, row.source) for row in rows]


def assert_no_token_values(payload, *extra: str) -> None:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    for value in (*TOKENS.values(), NEW_TOKEN, *extra):
        assert value not in text
    assert "token_encrypted" not in text


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------


def test_start_queues_a_run_with_its_settings_frozen(client, session_factory, ids):
    response = start(client, ids, note="  first try  ")
    assert response.status_code == 201, response.text
    body = response.json()
    stages = [
        {"role": "baseline", "target_users": 5, "start_s": 0, "end_s": 60},
        {"role": "ramp", "target_users": 10, "start_s": 60, "end_s": 90},
        {"role": "hold", "target_users": 10, "start_s": 90, "end_s": 540},
        {"role": "ramp", "target_users": 20, "start_s": 540, "end_s": 570},
        {"role": "hold", "target_users": 20, "start_s": 570, "end_s": 1020},
        {"role": "cooldown", "target_users": 5, "start_s": 1020, "end_s": 1050},
        {"role": "cooldown", "target_users": 0, "start_s": 1050, "end_s": 1080},
    ]
    plan = {
        **PLAN,
        "follow_up_rate": 0.3,
        "abort_on_break": True,
        "users": None,
        "duration_seconds": None,
        "min_quality": None,
        "max_no_data_pct": None,
        "levels": [10, 20],
        "total_seconds": 1080,
        "warmup_seconds": 30,
        "stages": stages,
    }
    (run,) = stored_runs(session_factory)
    assert body == {
        "id": run.id,
        "number": 1,
        "status": "queued",
        "requested_at": AT,
        "plan": plan,
    }
    assert (run.status, run.test_type, run.runner_id) == (
        "queued",
        "breakpoint",
        ids.runner,
    )
    assert (run.target_id, run.dataset_id, run.dataset_version_id) == (
        ids.target,
        ids.dataset,
        ids.version,
    )
    assert run.requested_by_user_id == MEMBER_ID
    assert run.claimed_at is None and run.progress == {}
    assert run.config == {
        "schema": 1,
        "test_type": "breakpoint",
        "target": {
            "id": ids.target,
            "name": "QA - Preprod",
            "is_production": False,
            "base_url": "https://target.example.test",
            "chat_path": "/change/api/chat",
            "auth_server": None,
            "token_refresh_path": "/auth/token",
            "refresh_cookie_name": "estishraf_rt",
        },
        "tokens": [
            {"name": "refresh_token", "hint": "41bd", "version": 1},
            {"name": "access_token", "hint": "0c2e", "version": 1},
        ],
        "plan": plan,
        "mix": MIX,
        "dataset": {
            "id": ids.dataset,
            "name": "QA - Load questions",
            "version_id": ids.version,
            "version": "v1",
            "item_count": 6,
            "content_hash": "qa-load-questions-v1".ljust(64, "0"),
            "tier_counts": {"simple": 2, "medium": 2, "complex": 2},
            "single_kind": False,
        },
        "options": {"store_answers": True, "question_sent_lines": True},
        "note": "first try",
    }
    assert_no_token_values([body, run.config])
    (audit,) = audits(session_factory, "performance.run.start")
    assert (audit.actor_user_id, audit.entity_type, audit.entity_id) == (
        MEMBER_ID,
        "performance_run",
        run.id,
    )
    assert audit.after["target"] == {
        "id": ids.target,
        "name": "QA - Preprod",
        "is_production": False,
    }
    assert audit.after["plan"]["levels"] == [10, 20]
    assert audit.after["plan"]["total_seconds"] == 1080
    assert events(session_factory, run.id) == [("queued", "qym")]
    # The run is now what blocks the next start, for everyone.
    again = start(client, ids, headers=MANAGER)
    refused(again, 409, "runner_busy", run_id=run.id)
    assert len(stored_runs(session_factory)) == 1


def test_smoke_and_soak_store_their_own_plan(client, session_factory, ids):
    smoke = start(
        client,
        ids,
        test_type="smoke",
        plan={
            "limit_ms": 60000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 180,
            "users": 9,
        },
        options={"store_answers": False},
    )
    assert smoke.status_code == 201, smoke.text
    plan = smoke.json()["plan"]
    assert (plan["users"], plan["duration_seconds"], plan["total_seconds"]) == (
        1,
        180,
        180,
    )
    assert plan["stages"] == [
        {"role": "steady", "target_users": 1, "start_s": 0, "end_s": 180}
    ]
    assert (plan["min_quality"], plan["max_no_data_pct"]) == (70, 20)
    (run,) = stored_runs(session_factory)
    assert run.config["options"]["store_answers"] is False
    client.post(f"{BASE}/runs/{run.id}/stop", headers=MEMBER)

    soak = start(
        client,
        ids,
        test_type="soak",
        plan={
            "limit_ms": 60000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 180,
            "users": 20,
            "duration_seconds": 7200,
            "min_quality": 80,
        },
    )
    assert soak.status_code == 201, soak.text
    assert soak.json()["number"] == 2
    assert soak.json()["plan"]["levels"] == [20]
    assert soak.json()["plan"]["total_seconds"] == 7200
    assert soak.json()["plan"]["min_quality"] == 80


@pytest.mark.parametrize("who", [VIEWER, OUTSIDER])
def test_start_needs_a_member(client, session_factory, ids, who):
    response = start(client, ids, headers=who)
    assert response.status_code == 403, response.text
    # The role is checked before the body is looked at.
    assert client.post(f"{BASE}/runs", headers=who, json={}).status_code == 403
    assert stored_runs(session_factory) == []


def test_viewer_refusal_is_the_platforms_viewer_rule(client, ids):
    refused(start(client, ids, headers=VIEWER), 403, VIEWER_CODE)


def test_every_write_refuses_a_viewer_with_the_platforms_own_answer(
    client, session_factory, ids
):
    """The project-wide Viewer rule answers exactly as on every other route of the platform."""
    run_id = add_run(session_factory, status="running")
    target = f"{BASE}/targets/{ids.target}"
    writes = [
        ("POST", f"{BASE}/runs", start_body(ids)),
        ("POST", f"{BASE}/runs/{run_id}/stop", {}),
        (
            "POST",
            f"{BASE}/runs/{run_id}/tokens",
            {"name": "refresh_token", "token": NEW_TOKEN},
        ),
        (
            "POST",
            f"{BASE}/targets",
            {
                "name": "QA - New",
                "is_production": False,
                "base_url": "https://new.example.test",
            },
        ),
        (
            "PUT",
            target,
            {
                "name": "QA - Preprod",
                "is_production": False,
                "base_url": "https://target.example.test",
            },
        ),
        ("DELETE", target, None),
        ("POST", f"{target}/restore", None),
        ("PUT", f"{target}/tokens/refresh_token", {"token": NEW_TOKEN}),
        ("DELETE", f"{target}/tokens/refresh_token", None),
        ("PUT", f"{BASE}/runner/key", {"api_key_id": None}),
    ]
    for method, path, body in writes:
        response = client.request(method, path, headers=VIEWER, json=body)
        assert response.status_code == 403, (method, path, response.text)
        assert response.json()["detail"] == VIEWER_DETAIL, (method, path)
        assert response.json()["error"]["code"] == VIEWER_CODE, (method, path)
        assert NEW_TOKEN not in response.text
    # A Member who is not a Manager keeps the contract's own refusal.
    member = client.request("DELETE", target, headers=MEMBER)
    refused(member, 403, "forbidden")
    assert member.json()["detail"]["code"] == "forbidden"


@pytest.mark.parametrize(
    "body_change",
    [
        {"plan": {**PLAN, "limit_ms": 180500}},
        {"plan": {**PLAN, "hold_seconds": 29}},
        {"plan": {**PLAN, "timeout_seconds": 901}},
        {"plan": {**PLAN, "max_error_rate_pct": 0}},
        {
            "plan": {
                "limit_ms": 180000,
                "max_error_rate_pct": 10,
                "timeout_seconds": 540,
            }
        },
        {"test_type": "soak"},
        {"test_type": "stress"},
        {"mix": {"simple": 50, "medium": 50}},
        {"mix": {"simple": -10, "medium": 60, "complex": 50}},
        {"note": "n" * 501},
    ],
)
def test_a_body_outside_the_allowed_values_is_a_validation_error(
    client, session_factory, ids, body_change
):
    refused(start(client, ids, **body_change), 422, "validation_error")
    assert stored_runs(session_factory) == []


def test_start_names_a_missing_or_archived_target(client, session_factory, ids):
    missing = start(client, ids, target_id="missing")
    refused(missing, 404, "target_not_found")
    assert missing.json()["detail"] == "Target not found"

    def archive(db, w):
        w.target.archived_at = NOW

    change(session_factory, archive)
    refused(start(client, ids), 409, "target_archived")
    assert stored_runs(session_factory) == []


def production(session_factory) -> str:
    def work(db, w):
        w.target.is_production = True

    change(session_factory, work)
    return "QA - Preprod"


def test_production_needs_a_manager_and_the_typed_name(client, session_factory, ids):
    name = production(session_factory)
    refused(start(client, ids, confirm_target=name), 403, "production_requires_manager")
    refused(start(client, ids, headers=MANAGER), 422, "confirm_target_mismatch")
    refused(
        start(client, ids, headers=MANAGER, confirm_target="qa - preprod"),
        422,
        "confirm_target_mismatch",
    )
    assert stored_runs(session_factory) == []
    response = start(client, ids, headers=MANAGER, confirm_target=name)
    assert response.status_code == 201, response.text
    (run,) = stored_runs(session_factory)
    assert run.config["target"]["is_production"] is True
    # Answers of a production target are not stored unless the person asks for it.
    assert run.config["options"]["store_answers"] is False
    (audit,) = audits(session_factory, "performance.run.start")
    assert audit.after["target"]["is_production"] is True
    assert audit.after["plan"]["max_users"] == 20


def test_a_platform_admin_counts_as_a_manager(client, session_factory, ids):
    name = production(session_factory)
    response = start(client, ids, headers=ADMIN, confirm_target=name)
    assert response.status_code == 201, response.text


# Review focus 4: the dataset is a draft, lacks a kind, has no kinds, or is empty.


def other_dataset(session_factory, **values) -> str:
    def work(db, w):
        return seed_dataset(
            db, w.project, w.owner, name="QA - Other questions", **values
        ).id

    return change(session_factory, work)


def test_a_draft_dataset_is_refused_with_the_reason(client, session_factory, ids):
    draft = other_dataset(session_factory, status=DatasetVersionStatus.DRAFT)
    error = refused(
        start(client, ids, dataset_version_id=draft),
        422,
        "dataset_not_published",
        status="draft",
    )
    assert "draft" in error["message"]
    refused(start(client, ids, dataset_version_id="missing"), 422, "dataset_not_found")
    assert stored_runs(session_factory) == []


@pytest.mark.parametrize(
    "column, value, reason",
    [
        ("private_test_set", True, "private_test_set"),
        ("access_mode", "restricted", "restricted"),
    ],
)
def test_a_dataset_not_every_member_may_read_is_refused(
    client, session_factory, ids, column, value, reason
):
    def work(db, w):
        setattr(db.get(Dataset, w.version.dataset_id), column, value)

    change(session_factory, work)
    refused(
        start(client, ids, headers=MANAGER), 422, "dataset_not_allowed", reason=reason
    )
    tiers = get(client, "/dataset-tiers", dataset_version_id=ids.version)
    assert (tiers["usable"], tiers["item_count"]) == (False, 0)
    assert tiers["reason"]


def test_a_dataset_of_another_project_is_not_found(client, session_factory, ids):
    def work(db, _w):
        other = seed_performance(db, suffix="2", runner_token="t-2", other_token="o-2")
        return other.version.id

    foreign = change(session_factory, work)
    refused(start(client, ids, dataset_version_id=foreign), 422, "dataset_not_found")
    response = client.get(
        f"{BASE}/dataset-tiers", headers=MEMBER, params={"dataset_version_id": foreign}
    )
    refused(response, 404, "dataset_version_not_found")


def test_a_mix_that_asks_for_a_kind_the_dataset_lacks_is_refused(
    client, session_factory, ids
):
    two_kinds = other_dataset(session_factory, tiers=("simple", "medium"))
    error = refused(
        start(client, ids, dataset_version_id=two_kinds),
        422,
        "mix_tier_empty",
        tiers=["complex"],
    )
    assert "complex" in error["message"]
    refused(
        start(client, ids, mix={"simple": 50, "medium": 35, "complex": 5}),
        422,
        "mix_invalid",
        sum=90,
    )
    assert stored_runs(session_factory) == []
    response = start(
        client,
        ids,
        dataset_version_id=two_kinds,
        mix={"simple": 60, "medium": 40, "complex": 0},
    )
    assert response.status_code == 201, response.text
    (run,) = stored_runs(session_factory)
    assert run.config["mix"] == {"simple": 60, "medium": 40, "complex": 0}
    assert run.config["dataset"]["tier_counts"] == {
        "simple": 2,
        "medium": 2,
        "complex": 0,
    }


def test_a_dataset_without_kinds_runs_as_one_kind(client, session_factory, ids):
    plain = other_dataset(session_factory, tiers=(None,), per_tier=4)
    tiers = get(client, "/dataset-tiers", dataset_version_id=plain)
    assert tiers == {
        "dataset_id": tiers["dataset_id"],
        "dataset_version_id": plain,
        "version": "v1",
        "published": True,
        "item_count": 4,
        "tier_counts": {"simple": 0, "medium": 4, "complex": 0},
        "untiered": 4,
        "single_kind": True,
        "follow_ups": 1,
        "usable": True,
        "reason": None,
    }
    # The mix of the request is not used, whatever it says.
    response = start(
        client,
        ids,
        dataset_version_id=plain,
        mix={"simple": 0, "medium": 0, "complex": 0},
    )
    assert response.status_code == 201, response.text
    (run,) = stored_runs(session_factory)
    assert run.config["mix"] == {"simple": 0, "medium": 100, "complex": 0}
    assert run.config["dataset"]["single_kind"] is True
    assert run.config["dataset"]["tier_counts"] == {
        "simple": 0,
        "medium": 4,
        "complex": 0,
    }
    assert run.config["dataset"]["item_count"] == 4


@pytest.mark.parametrize(
    "metadata, counts, untiered, single_kind",
    [
        (
            [{"complexity": "Simple"}] * 6
            + [{"complexity": "Medium"}] * 4
            + [{"complexity": "Complex"}] * 2,
            (6, 4, 2),
            0,
            False,
        ),
        (
            [{"tier": " simple "}, {"tier": "MEDIUM"}, {"tier": "Complex"}],
            (1, 1, 1),
            0,
            False,
        ),
        ([{"tier": " SIMPLE ", "complexity": "Complex"}], (1, 0, 0), 0, False),
        ([{"tier": "unknown", "complexity": " Complex "}], (0, 0, 1), 0, False),
        ([{"complexity": "unknown"}, {"tier": "unknown"}, {}], (0, 3, 0), 3, True),
        (
            [
                {"tier": "simple"},
                {"complexity": "Medium"},
                {"tier": "bad", "complexity": "Complex"},
                {"complexity": "unknown"},
            ],
            (1, 1, 1),
            1,
            False,
        ),
        (
            [
                {"tier": None, "complexity": "Simple"},
                {"tier": 42, "complexity": "Medium"},
                {"tier": ["complex"], "complexity": {"kind": "complex"}},
            ],
            (1, 1, 0),
            1,
            False,
        ),
    ],
)
def test_stored_item_kinds_agree_in_lists_tiers_and_start(
    client, session_factory, ids, metadata, counts, untiered, single_kind
):
    version = other_dataset(session_factory, tiers=(None,), per_tier=len(metadata))
    with session_factory() as db:
        items = db.scalars(
            select(DatasetItem)
            .where(DatasetItem.dataset_version_id == version)
            .order_by(DatasetItem.index)
        ).all()
        for item, values in zip(items, metadata):
            item.item_metadata = values
        db.commit()
    expected = dict(zip(("simple", "medium", "complex"), counts))
    tiers = get(client, "/dataset-tiers", dataset_version_id=version)
    assert tiers["tier_counts"] == expected
    assert (tiers["untiered"], tiers["single_kind"]) == (untiered, single_kind)
    listed = next(
        row
        for row in get(client, "/datasets")["datasets"]
        if row["latest_published_version"]["id"] == version
    )
    assert listed["tier_counts"] == expected
    assert listed["single_kind"] is single_kind
    chosen = next(kind for kind, count in expected.items() if count)
    mix = {kind: 100 if kind == chosen else 0 for kind in expected}
    if not single_kind:
        missing = next((kind for kind, count in expected.items() if not count), None)
        if missing:
            refused(
                start(
                    client,
                    ids,
                    dataset_version_id=version,
                    mix={kind: 100 if kind == missing else 0 for kind in expected},
                ),
                422,
                "mix_tier_empty",
                tiers=[missing],
            )
    response = start(client, ids, dataset_version_id=version, mix=mix)
    assert response.status_code == 201, response.text
    (run,) = stored_runs(session_factory)
    assert run.config["dataset"]["tier_counts"] == expected
    assert run.config["dataset"]["single_kind"] is single_kind
    assert run.config["mix"] == mix


def test_an_empty_dataset_is_refused_and_disabled_items_do_not_count(
    client, session_factory, ids
):
    empty = other_dataset(session_factory, tiers=())
    error = refused(start(client, ids, dataset_version_id=empty), 422, "mix_tier_empty")
    assert error["message"] == "This dataset version has no questions."
    tiers = get(client, "/dataset-tiers", dataset_version_id=empty)
    assert (tiers["usable"], tiers["reason"]) == (
        False,
        "This dataset version has no questions.",
    )

    def disable_complex(db, w):
        items = db.scalars(
            select(DatasetItem).where(DatasetItem.dataset_version_id == w.version.id)
        ).all()
        for item in items:
            if item.item_metadata["tier"] == "complex":
                item.disabled_at = NOW

    change(session_factory, disable_complex)
    tiers = get(client, "/dataset-tiers", dataset_version_id=ids.version)
    assert tiers["item_count"] == 4
    assert tiers["tier_counts"] == {"simple": 2, "medium": 2, "complex": 0}
    assert (tiers["untiered"], tiers["single_kind"], tiers["follow_ups"]) == (
        0,
        False,
        2,
    )
    refused(start(client, ids), 422, "mix_tier_empty", tiers=["complex"])
    assert stored_runs(session_factory) == []


def test_dataset_tiers_of_the_seeded_version(client, ids):
    assert get(
        client, "/dataset-tiers", headers=VIEWER, dataset_version_id=ids.version
    ) == {
        "dataset_id": ids.dataset,
        "dataset_version_id": ids.version,
        "version": "v1",
        "published": True,
        "item_count": 6,
        "tier_counts": {"simple": 2, "medium": 2, "complex": 2},
        "untiered": 0,
        "single_kind": False,
        "follow_ups": 3,
        "usable": True,
        "reason": None,
    }


def add_version(db, dataset_id: str, user, version: str, tiers, *, status, when) -> str:
    """One more version of a dataset, with one question per entry of ``tiers``."""
    published = status is DatasetVersionStatus.PUBLISHED
    row = DatasetVersion(
        dataset_id=dataset_id,
        version=version,
        status=status,
        item_count=len(tiers),
        created_by_user_id=user.id,
        published_by_user_id=user.id if published else None,
        published_at=when if published else None,
        created_at=when,
        updated_at=when,
    )
    db.add(row)
    db.flush()
    for index, tier in enumerate(tiers):
        db.add(
            DatasetItem(
                dataset_version_id=row.id,
                item_id=f"{version}-{index}",
                index=index,
                input=f"Question {version}-{index}?",
                item_metadata={
                    "tier": tier,
                    "follow_up": "  " if index else "And then?",
                },
                labels=[],
                fingerprint=f"fp-{dataset_id}-{version}-{index}",
            )
        )
    db.flush()
    return row.id


def test_the_datasets_a_run_could_use(client, session_factory, ids):
    def work(db, w):
        made = {}
        made["draft"] = seed_dataset(
            db,
            w.project,
            w.member,
            name="QA - Draft only",
            status=DatasetVersionStatus.DRAFT,
            tiers=("simple",),
            per_tier=3,
        ).id
        made["plain"] = seed_dataset(
            db, w.project, w.owner, name="QA - Plain", tiers=(None,), per_tier=4
        ).id
        for name, column, value in [
            ("QA - Private", "private_test_set", True),
            ("QA - Restricted", "access_mode", "restricted"),
            ("QA - Deleted", "deleted_at", NOW),
        ]:
            version = seed_dataset(db, w.project, w.owner, name=name)
            setattr(db.get(Dataset, version.dataset_id), column, value)
        seed_performance(db, suffix="2", runner_token="t-2", other_token="o-2")
        # The seeded dataset gets a second published version, a newer draft, a newer
        # archived version and one disabled question: the newest published one counts.
        later = NOW + timedelta(hours=2)
        made["v2"] = add_version(
            db,
            w.version.dataset_id,
            w.member,
            "v2",
            ("complex", "complex", "medium", "easy"),
            status=DatasetVersionStatus.PUBLISHED,
            when=later,
        )
        add_version(
            db,
            w.version.dataset_id,
            w.owner,
            "v3",
            ("simple",) * 9,
            status=DatasetVersionStatus.DRAFT,
            when=later + timedelta(hours=1),
        )
        add_version(
            db,
            w.version.dataset_id,
            w.owner,
            "v0",
            ("simple",) * 7,
            status=DatasetVersionStatus.ARCHIVED,
            when=later + timedelta(hours=2),
        )
        disabled = db.scalars(
            select(DatasetItem).where(
                DatasetItem.dataset_version_id == made["v2"], DatasetItem.index == 1
            )
        ).one()
        disabled.disabled_at = NOW
        made["draft_dataset"] = db.get(DatasetVersion, made["draft"]).dataset_id
        made["plain_dataset"] = db.get(DatasetVersion, made["plain"]).dataset_id
        return made

    made = change(session_factory, work)
    assert get(client, "/datasets", headers=VIEWER) == {
        "datasets": [
            {
                "id": made["draft_dataset"],
                "name": "QA - Draft only",
                "slug": "qa-draft-only",
                "latest_published_version": None,
                "item_count": 3,
                "tier_counts": {"simple": 3, "medium": 0, "complex": 0},
                "follow_ups": 1,
                "single_kind": False,
                "updated_by": "QA - Person member-1",
                "updated_by_user_id": MEMBER_ID,
                "updated_at": AT,
            },
            {
                "id": ids.dataset,
                "name": "QA - Load questions",
                "slug": "qa-load-questions",
                "latest_published_version": {"id": made["v2"], "name": "v2"},
                # Four questions, one disabled; "easy" is not a kind.
                "item_count": 3,
                "tier_counts": {"simple": 0, "medium": 1, "complex": 1},
                "follow_ups": 1,
                "single_kind": False,
                "updated_by": "QA - Person member-1",
                "updated_by_user_id": MEMBER_ID,
                "updated_at": "2026-11-20T13:00:00Z",
            },
            {
                "id": made["plain_dataset"],
                "name": "QA - Plain",
                "slug": "qa-plain",
                "latest_published_version": {"id": made["plain"], "name": "v1"},
                "item_count": 4,
                "tier_counts": {"simple": 0, "medium": 4, "complex": 0},
                "follow_ups": 1,
                "single_kind": True,
                "updated_by": "QA - Person owner-1",
                "updated_by_user_id": OWNER_ID,
                "updated_at": AT,
            },
        ]
    }
    # The list and the read of one version count the same way.
    tiers = get(client, "/dataset-tiers", dataset_version_id=made["v2"])
    assert tiers["item_count"] == 3
    assert tiers["tier_counts"] == {"simple": 0, "medium": 1, "complex": 1}
    assert (tiers["untiered"], tiers["follow_ups"]) == (1, 1)
    assert client.get(f"{BASE}/datasets", headers=OUTSIDER).status_code == 403


def test_the_datasets_read_uses_a_fixed_number_of_statements(
    client, session_factory, database
):
    with statements(database) as one:
        assert len(get(client, "/datasets")["datasets"]) == 1

    def more(db, w):
        people = [w.owner, w.member]
        for number in range(6):
            draft = number % 3 == 0
            seed_dataset(
                db,
                w.project,
                people[number % 2],
                name=f"QA - Questions {number}",
                status=(
                    DatasetVersionStatus.DRAFT
                    if draft
                    else DatasetVersionStatus.PUBLISHED
                ),
                per_tier=3,
            )

    change(session_factory, more)
    with statements(database) as many:
        assert len(get(client, "/datasets")["datasets"]) == 7
    assert len(many) == len(one)


def test_a_plan_the_rules_call_bad_is_refused_with_its_checks(
    client, session_factory, ids
):
    no_levels = start(client, ids, plan={**PLAN, "step_users": 30})
    error = refused(no_levels, 422, "plan_invalid")
    assert [(check["code"], check["tone"]) for check in error["details"]["checks"]] == [
        ("no_levels", "bad"),
        ("hold_ok", "ok"),
    ]
    assert error["message"] == error["details"]["checks"][0]["message"]
    short_timeout = start(client, ids, plan={**PLAN, "timeout_seconds": 120})
    error = refused(short_timeout, 422, "plan_invalid")
    assert "timeout_below_limit" in [
        check["code"] for check in error["details"]["checks"]
    ]
    assert stored_runs(session_factory) == []
    # A warning does not stop a run.
    warned = start(client, ids, plan={**PLAN, "hold_seconds": 300, "max_users": 25})
    assert warned.status_code == 201, warned.text


def test_a_plan_over_the_platform_limits_is_refused(client, session_factory, ids):
    refused(
        start(client, ids, plan={**PLAN, "max_users": 250}),
        422,
        "over_platform_limit",
        field="max_users",
        limit=200,
        value=250,
    )
    refused(
        start(client, ids, plan={**PLAN, "baseline_users": 201}),
        422,
        "over_platform_limit",
        field="max_users",
        limit=200,
        value=201,
    )
    long_ladder = {**PLAN, "max_users": 200, "step_users": 5, "hold_seconds": 3600}
    refused(
        start(client, ids, plan=long_ladder),
        422,
        "over_platform_limit",
        field="total_seconds",
        limit=28800,
        value=60 + 40 * 3630 + 60,
    )
    soak = {
        "limit_ms": 60000,
        "max_error_rate_pct": 10,
        "timeout_seconds": 180,
        "users": 10,
        "duration_seconds": 28801,
    }
    refused(
        start(client, ids, test_type="soak", plan=soak),
        422,
        "over_platform_limit",
        field="total_seconds",
        limit=28800,
        value=28801,
    )
    assert stored_runs(session_factory) == []


def test_a_plan_over_the_targets_own_limits_is_refused(client, session_factory, ids):
    def limit(db, w):
        w.target.max_users = 10
        w.target.max_duration_s = 600

    change(session_factory, limit)
    error = refused(
        start(client, ids),
        422,
        "over_target_limit",
        field="max_users",
        limit=10,
        value=20,
    )
    assert "QA - Preprod" in error["message"]
    # One level of 10 users takes exactly the 600 seconds the target allows.
    one_level = start(client, ids, plan={**PLAN, "max_users": 10})
    assert one_level.status_code == 201, one_level.text
    (run,) = stored_runs(session_factory)
    assert run.config["plan"]["total_seconds"] == 600
    client.post(f"{BASE}/runs/{run.id}/stop", headers=MEMBER)
    refused(
        start(client, ids, plan={**PLAN, "max_users": 10, "hold_seconds": 451}),
        422,
        "over_target_limit",
        field="total_seconds",
        limit=600,
        value=601,
    )
    # Smoke is one user for three minutes: it fits every target.
    smoke = start(
        client,
        ids,
        test_type="smoke",
        plan={"limit_ms": 60000, "max_error_rate_pct": 10, "timeout_seconds": 180},
    )
    assert smoke.status_code == 201, smoke.text


def test_start_needs_an_encryption_key(client, session_factory, ids, monkeypatch):
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY")
    refused(start(client, ids), 409, "encryption_key_missing")
    assert get(client, "/setup")["blocked"]["code"] == "encryption_key_missing"
    assert get(client, "/setup")["encryption_ready"] is False


def test_start_needs_a_runner_that_has_connected(client, session_factory, ids):
    def never_connected(db, w):
        w.runner.registered_at = None
        w.runner.instance_id = None
        w.runner.last_heartbeat_at = None

    change(session_factory, never_connected)
    refused(start(client, ids), 409, "runner_missing")
    setup = get(client, "/setup")
    assert setup["runner"] is None
    assert setup["blocked"]["code"] == "runner_missing"

    def no_runner(db, w):
        db.delete(w.runner)

    change(session_factory, no_runner)
    refused(start(client, ids), 409, "runner_missing")
    assert stored_runs(session_factory) == []


def test_start_needs_a_chosen_runner_key_that_is_not_revoked(
    client, session_factory, ids
):
    def revoke(db, w):
        db.get(ApiKey, w.runner.runner_key_id).revoked_at = NOW

    change(session_factory, revoke)
    refused(start(client, ids), 409, "runner_key_missing")
    setup = get(client, "/setup")
    assert setup["blocked"]["code"] == "runner_key_missing"
    assert setup["runner"]["runner_key_set"] is False
    assert setup["runner"]["runner_key_matches"] is None

    def clear(db, w):
        w.runner.runner_key_id = None

    change(session_factory, clear)
    refused(start(client, ids), 409, "runner_key_missing")
    assert stored_runs(session_factory) == []


def test_start_needs_a_runner_heard_from_in_the_last_seconds(
    client, session_factory, ids, monkeypatch
):
    page_time(monkeypatch, NOW + timedelta(seconds=31))
    refused(start(client, ids), 409, "runner_stale", seconds_since_heartbeat=31)
    setup = get(client, "/setup")
    assert setup["blocked"]["code"] == "runner_stale"
    assert (setup["runner"]["fresh"], setup["runner"]["stale"]) == (False, False)
    assert setup["runner"]["seconds_since_heartbeat"] == 31
    page_time(monkeypatch, NOW + timedelta(seconds=30))
    assert get(client, "/setup")["blocked"] is None
    assert start(client, ids).status_code == 201


def test_start_needs_a_saved_sign_in_that_has_not_run_out(client, session_factory, ids):
    def drop(name):
        def work(db, w):
            db.delete(target_tokens(db, w.target)[name])

        return work

    change(session_factory, drop("refresh_token"))
    refused(start(client, ids), 409, "sign_in_missing", missing=["refresh_token"])

    def expired(db, w):
        seed_token(
            db,
            w.target,
            "refresh_token",
            NEW_TOKEN,
            expires_at=NOW - timedelta(seconds=1),
        )

    change(session_factory, expired)
    refused(
        start(client, ids),
        409,
        "token_expired",
        name="refresh_token",
        expires_at="2026-11-20T10:59:59Z",
    )
    assert stored_runs(session_factory) == []

    def renew(db, w):
        target_tokens(db, w.target)["refresh_token"].expires_at = NOW + timedelta(
            hours=1
        )
        db.delete(target_tokens(db, w.target)["access_token"])

    change(session_factory, renew)
    # The access token is optional: the refresh token alone is a sign-in.
    response = start(client, ids)
    assert response.status_code == 201, response.text
    (run,) = stored_runs(session_factory)
    assert run.config["tokens"] == [
        {"name": "refresh_token", "hint": "7a2e", "version": 1}
    ]


def test_target_reads_send_the_person_ids_beside_the_names(client, session_factory):
    """A person is a UserName with an id (B13): the target's creator and each token's saver come with their ids."""

    def name_people(db, w):
        w.target.created_by_user_id = OWNER_ID
        for token in target_tokens(db, w.target).values():
            token.updated_by_user_id = MEMBER_ID

    change(session_factory, name_people)
    (row,) = get(client, "/targets", headers=MANAGER)["targets"]
    assert (row["created_by"], row["created_by_user_id"]) == (
        "QA - Person owner-1",
        OWNER_ID,
    )
    assert {(t["updated_by"], t["updated_by_user_id"]) for t in row["tokens"]} == {
        ("QA - Person member-1", MEMBER_ID)
    }
    (setup_row,) = get(client, "/setup")["targets"]
    assert {t["updated_by_user_id"] for t in setup_row["tokens"]} == {MEMBER_ID}


# Review focus 3: a second run on a busy runner or target, and two starts at once.


@pytest.mark.parametrize("status", ["queued", "starting", "running", "stopping"])
def test_a_busy_runner_takes_no_second_run(client, session_factory, ids, status):
    run_id = add_run(session_factory, status=status)
    error = refused(start(client, ids), 409, "runner_busy", run_id=run_id)
    assert "Run 1" in error["message"]
    setup = get(client, "/setup")
    assert setup["blocked"]["code"] == "runner_busy"
    assert setup["blocked"]["run_id"] == run_id
    assert len(stored_runs(session_factory)) == 1


def second_runner_run(session_factory, *, same_target: bool) -> str:
    """A run in progress on another runner of the project (the table allows several)."""

    def work(db, w):
        # The first runner has not been heard from for longer, so the pages pick it second.
        runner = seed_runner(
            db, w.project, key="runner-0", now=NOW - timedelta(hours=1)
        )
        target = w.target
        if not same_target:
            target = seed_target(
                db,
                w.project,
                name="QA - Second",
                base_url="https://second.example.test",
            )
        return seed_run(db, w.project, runner, target, status="running").id

    return change(session_factory, work)


def test_a_busy_target_takes_no_second_run(client, session_factory, ids):
    run_id = second_runner_run(session_factory, same_target=True)
    error = refused(start(client, ids), 409, "target_busy", run_id=run_id)
    assert "Run 1" in error["message"]
    assert get(client, "/setup")["targets"][0]["active_run_id"] == run_id
    assert len(stored_runs(session_factory)) == 1


def test_the_database_decides_a_start_that_slipped_past_the_checks(
    client, session_factory, ids, monkeypatch
):
    """Two starts at the same moment both pass the checks; the unique index stops one."""
    run_id = add_run(session_factory, status="queued")
    monkeypatch.setattr(performance_targets, "active_run", lambda *args, **kwargs: None)
    error = refused(start(client, ids), 409, "runner_busy", run_id=run_id)
    assert "Run 1" in error["message"]
    assert len(stored_runs(session_factory)) == 1
    assert audits(session_factory, "performance.run.start") == []


def test_the_database_also_decides_for_a_busy_target(
    client, session_factory, ids, monkeypatch
):
    run_id = second_runner_run(session_factory, same_target=True)
    monkeypatch.setattr(performance_targets, "active_run", lambda *args, **kwargs: None)
    refused(start(client, ids), 409, "target_busy", run_id=run_id)
    assert len(stored_runs(session_factory)) == 1


def test_two_people_pressing_start_at_once_start_one_run(
    session_factory, database, ids
):
    if database.dialect.name != "postgresql":
        pytest.skip("two transactions at once need PostgreSQL's row locks")
    barrier = threading.Barrier(2)
    results: list[tuple[str, object]] = []

    def press(user_id: str) -> None:
        with session_factory() as db:
            project = db.get(Project, PROJECT)
            user = db.get(User, user_id)
            barrier.wait(timeout=20)
            try:
                run = performance_runs.start_run(
                    db, project=project, user=user, body=start_body(ids), now=NOW
                )
                db.commit()
                results.append(("started", run.id))
            except PerformanceError as exc:
                db.rollback()
                results.append((exc.code, exc.details.get("run_id")))

    threads = [
        threading.Thread(target=press, args=(user,)) for user in (OWNER_ID, MEMBER_ID)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert sorted(code for code, _ in results) == ["runner_busy", "started"]
    (run,) = stored_runs(session_factory)
    assert dict(results) == {"started": run.id, "runner_busy": run.id}
    assert len(audits(session_factory, "performance.run.start")) == 1


# What a Manager does to the target while a Member presses Start.
TARGET_CHANGES = {
    "archived": ("DELETE", "", None),
    "address changed": (
        "PUT",
        "",
        {
            "name": "QA - Preprod",
            "is_production": False,
            "base_url": "https://new-system.example.test",
        },
    ),
    "refresh token removed": ("DELETE", "/tokens/refresh_token", None),
}


def change_target(client, ids, what: str):
    method, path, body = TARGET_CHANGES[what]
    return client.request(
        method, f"{BASE}/targets/{ids.target}{path}", headers=MANAGER, json=body
    )


def press_start(session_factory, ids, results: dict) -> None:
    """A Member's start in its own transaction; the outcome lands in ``results``."""
    with session_factory() as db:
        try:
            run = performance_runs.start_run(
                db,
                project=db.get(Project, PROJECT),
                user=db.get(User, MEMBER_ID),
                body=start_body(ids),
                now=NOW,
            )
            db.commit()
            results["start"] = ("started", run.id)
        except PerformanceError as exc:
            db.rollback()
            results["start"] = (exc.code, exc.details)


@pytest.mark.parametrize(
    "what, code",
    [
        ("archived", "target_archived"),
        ("address changed", "target_changed"),
        ("refresh token removed", "sign_in_missing"),
    ],
)
def test_a_target_change_committed_during_a_start_is_seen_by_the_start(
    client, session_factory, database, ids, monkeypatch, what, code
):
    """The Manager commits after the start's own checks, before the start holds the target."""
    if database.dialect.name != "postgresql":
        pytest.skip("two transactions at once need PostgreSQL's row locks")
    real = performance_views.starts_used
    answers = []

    def manager_acts_first(*args, **kwargs):
        if not answers:
            answers.append(change_target(client, ids, what))
        return real(*args, **kwargs)

    monkeypatch.setattr(performance_views, "starts_used", manager_acts_first)
    results: dict = {}
    press_start(session_factory, ids, results)
    assert answers[0].status_code in (200, 204), answers[0].text
    assert results["start"][0] == code
    assert stored_runs(session_factory) == []
    assert audits(session_factory, "performance.run.start") == []


@pytest.mark.parametrize("what", list(TARGET_CHANGES))
def test_a_target_change_waits_for_a_start_that_holds_the_target_and_sees_its_run(
    client, session_factory, database, ids, monkeypatch, what
):
    """The start holds the target first: the Manager's change waits, then finds the run."""
    if database.dialect.name != "postgresql":
        pytest.skip("two transactions at once need PostgreSQL's row locks")
    held, release = threading.Event(), threading.Event()
    real_hold = performance_targets.hold_target
    real_get = performance_targets.get_target
    pids: list[int] = []

    def hold_then_pause(db, *args, **kwargs):
        target = real_hold(db, *args, **kwargs)
        held.set()
        assert release.wait(10), "the Manager's change was never seen waiting"
        return target

    def record_pid(db, *args, **kwargs):
        if kwargs.get("lock"):
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
        return real_get(db, *args, **kwargs)

    monkeypatch.setattr(performance_targets, "hold_target", hold_then_pause)
    monkeypatch.setattr(performance_targets, "get_target", record_pid)
    results: dict = {}

    def manager_changes() -> None:
        results["change"] = change_target(client, ids, what)

    starter = threading.Thread(target=press_start, args=(session_factory, ids, results))
    manager = threading.Thread(target=manager_changes)
    try:
        starter.start()
        assert held.wait(10), "the start never held the target"
        manager.start()
        # Unlocked, the change completes at once; locked, it waits on the target row.
        deadline = time.monotonic() + 10
        while manager.is_alive():
            if pids:
                with database.connect() as conn:
                    waiting = conn.scalar(
                        text(
                            "SELECT wait_event_type = 'Lock' FROM pg_stat_activity "
                            "WHERE pid = :pid"
                        ),
                        {"pid": pids[0]},
                    )
                if waiting:
                    break
            assert time.monotonic() < deadline, "the change neither waited nor finished"
            time.sleep(0.01)
    finally:
        release.set()
        starter.join(30)
        manager.join(30)
    code, run_id = results["start"]
    assert code == "started", results["start"]
    refused(results["change"], 409, "target_busy", run_id=run_id)
    with session_factory() as db:
        target = db.get(PerformanceTarget, ids.target)
        assert target.archived_at is None
        assert target.base_url == "https://target.example.test"
        assert sorted(target_tokens(db, target)) == ["access_token", "refresh_token"]
    (run,) = stored_runs(session_factory)
    assert run.config["target"]["base_url"] == "https://target.example.test"


def test_start_is_refused_when_the_runner_registered_with_another_key(
    client, session_factory, ids
):
    """Tokens go only to the chosen key: a runner under another key could never sign in."""

    def other_key(db, w):
        w.runner.registered_key_id = "performance-other-key-1"

    change(session_factory, other_key)
    refused(start(client, ids), 409, "runner_key_mismatch")
    setup = get(client, "/setup")
    assert setup["blocked"]["code"] == "runner_key_mismatch"
    assert setup["blocked"]["message"]
    assert setup["runner"]["runner_key_matches"] is False

    def key_deleted(db, w):
        # The key the runner registered with was deleted (the column is SET NULL).
        w.runner.registered_key_id = None

    change(session_factory, key_deleted)
    refused(start(client, ids), 409, "runner_key_mismatch")
    assert stored_runs(session_factory) == []


@pytest.mark.parametrize(
    "test_type, plan",
    [
        ("breakpoint", {**PLAN, "users": 5000, "duration_seconds": 1}),
        (
            "soak",
            {
                "limit_ms": 60000,
                "max_error_rate_pct": 10,
                "timeout_seconds": 180,
                "users": 20,
                "duration_seconds": 7200,
                "baseline_users": 0,
                "max_users": 5000,
                "step_users": 0,
                "hold_seconds": 1,
            },
        ),
    ],
)
def test_a_start_ignores_fields_its_test_type_does_not_use(
    client, session_factory, ids, test_type, plan
):
    response = start(client, ids, test_type=test_type, plan=plan)
    assert response.status_code == 201, response.text
    stored = response.json()["plan"]
    if test_type == "breakpoint":
        assert (stored["users"], stored["duration_seconds"]) == (None, None)
        assert stored["max_users"] == 20
    else:
        assert (stored["baseline_users"], stored["max_users"]) == (None, None)
        assert (stored["step_users"], stored["hold_seconds"]) == (None, None)
        assert stored["users"] == 20
    # The service applies the same rule to a request that did not pass the route.
    with session_factory() as db:
        assert (
            performance_runs._checked_plan(
                test_type, plan, world(db).target, PlatformSettings()
            )["total_seconds"]
            == stored["total_seconds"]
        )


def test_a_run_whose_runner_went_silent_does_not_block_the_next(
    client, session_factory, ids
):
    lost = add_run(session_factory, status="running", now=NOW - timedelta(seconds=200))
    response = start(client, ids)
    assert response.status_code == 201, response.text
    assert response.json()["number"] == 2
    first, second = stored_runs(session_factory)
    assert (first.id, first.status) == (lost, "interrupted")
    assert first.status_reason == "runner_silent"
    assert first.finished_at == NOW - timedelta(seconds=80)
    assert second.status == "queued"
    assert events(session_factory, lost) == [("interrupted", "qym")]


def test_starts_per_hour_are_limited_per_person(
    client, session_factory, ids, monkeypatch
):
    monkeypatch.setenv("QYM_PERFORMANCE_STARTS_PER_HOUR", "2")
    add_run(
        session_factory, status="finished", by="member", now=NOW - timedelta(minutes=50)
    )
    add_run(
        session_factory, status="stopped", by="member", now=NOW - timedelta(minutes=10)
    )
    add_run(
        session_factory, status="finished", by="member", now=NOW - timedelta(minutes=61)
    )
    assert get(client, "/setup")["limits"]["starts_per_hour"] == 2
    assert get(client, "/setup")["limits"]["starts_left"] == 0
    assert get(client, "/setup", headers=MANAGER)["limits"]["starts_left"] == 2
    response = start(client, ids)
    refused(response, 429, "too_many_starts", retry_after_s=600)
    assert response.headers["Retry-After"] == "600"
    assert len(stored_runs(session_factory)) == 3
    # Another person has their own count.
    assert start(client, ids, headers=MANAGER).status_code == 201


def test_the_limit_of_starts_can_be_switched_off(
    client, session_factory, ids, monkeypatch
):
    monkeypatch.setenv("QYM_PERFORMANCE_STARTS_PER_HOUR", "0")
    for _ in range(3):
        add_run(session_factory, status="finished", by="member")
    limits = get(client, "/setup")["limits"]
    assert (limits["starts_per_hour"], limits["starts_left"]) == (0, None)
    assert start(client, ids).status_code == 201


def test_start_in_an_archived_project_is_refused(client, session_factory, ids):
    def archive(db, w):
        w.project.is_active = False

    change(session_factory, archive)
    response = start(client, ids, headers=MANAGER)
    assert response.status_code == 409, response.text
    assert response.headers["X-Qym-Project-State"] == "archived"
    home = get(client, headers=MANAGER)
    assert home["can"] == {"start": False, "manage": False}


# ---------------------------------------------------------------------------
# Stop
# ---------------------------------------------------------------------------


def stop(client, run_id: str, headers=MEMBER, **body):
    return client.post(f"{BASE}/runs/{run_id}/stop", headers=headers, json=body or None)


def test_stop_ends_a_queued_run_at_once(client, session_factory):
    run_id = add_run(session_factory, status="queued", by="owner")
    response = stop(client, run_id, reason="  wrong target  ")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": run_id,
        "status": "stopped",
        "outcome": "stopped",
        "stop_requested_at": AT,
    }
    (run,) = stored_runs(session_factory)
    assert (run.status, run.finished_at, run.stop_reason) == (
        "stopped",
        NOW,
        "wrong target",
    )
    assert run.status_reason == "stopped_before_claim"
    assert run.stop_requested_by_user_id == MEMBER_ID
    assert events(session_factory, run_id) == [("stopped", "qym")]
    (audit,) = audits(session_factory, "performance.run.stop")
    assert audit.before == {"status": "queued"}
    assert audit.after == {
        "status": "stopped",
        "outcome": "stopped",
        "reason": "wrong target",
    }
    page = get(client, f"/runs/{run_id}")
    assert page["status_reason"] == {
        "code": "stopped_before_claim",
        "message": "Stopped by QA - Person member-1 before the runner picked it up.",
    }
    assert page["run"]["stop_requested_by"] == "QA - Person member-1"
    assert page["run"]["stop_requested_by_user_id"] == MEMBER_ID
    assert page["late_results_until"] is None
    again = stop(client, run_id)
    assert again.status_code == 200
    assert again.json()["outcome"] == "already_ended"
    assert len(audits(session_factory, "performance.run.stop")) == 1


@pytest.mark.parametrize("status", ["starting", "running"])
def test_stop_asks_the_runner_to_stop_a_claimed_run(client, session_factory, status):
    run_id = add_run(session_factory, status=status)
    response = stop(client, run_id, reason="Preprod is needed")
    assert response.json() == {
        "id": run_id,
        "status": "stopping",
        "outcome": "stop_requested",
        "stop_requested_at": AT,
    }
    (run,) = stored_runs(session_factory)
    assert (run.status, run.finished_at) == ("stopping", None)
    # The run has not ended: its reason is written with the final status.
    assert run.status_reason is None
    assert (run.stop_requested_at, run.stop_reason) == (NOW, "Preprod is needed")
    assert events(session_factory, run_id) == [("stop_requested", "qym")]
    page = get(client, f"/runs/{run_id}")
    assert (page["stop_requested"], page["effective_status"]) == (True, "stopping")
    assert page["status_reason"] is None
    # A repeat is not an error and changes nothing.
    again = stop(client, run_id, headers=MANAGER, reason="other words")
    assert again.status_code == 200
    assert again.json()["outcome"] == "stop_requested"
    (run,) = stored_runs(session_factory)
    assert run.stop_reason == "Preprod is needed"
    assert len(audits(session_factory, "performance.run.stop")) == 1


def test_stop_ends_a_run_whose_runner_is_silent_as_interrupted(
    client, session_factory, monkeypatch
):
    run_id = add_run(session_factory, status="running")
    page_time(monkeypatch, NOW + timedelta(seconds=150))
    response = stop(client, run_id)
    assert response.json()["outcome"] == "interrupted"
    assert response.json()["status"] == "interrupted"
    (run,) = stored_runs(session_factory)
    assert run.status == "interrupted"
    assert run.status_reason == "stopped_while_runner_silent"
    assert run.finished_at == NOW + timedelta(seconds=120)
    assert run.stop_requested_by_user_id == MEMBER_ID
    page = get(client, f"/runs/{run_id}")
    assert page["status_reason"]["code"] == "stopped_while_runner_silent"
    assert page["late_results_until"] == "2026-11-20T11:12:00Z"


def test_stop_leaves_an_ended_or_expired_run_as_it_is(
    client, session_factory, monkeypatch
):
    finished = add_run(session_factory, status="finished")
    response = stop(client, finished)
    assert response.json() == {
        "id": finished,
        "status": "finished",
        "outcome": "already_ended",
        "stop_requested_at": None,
    }
    queued = add_run(session_factory, status="queued")
    page_time(monkeypatch, NOW + timedelta(seconds=600))
    response = stop(client, queued)
    assert response.json()["outcome"] == "already_ended"
    assert response.json()["status"] == "expired"
    runs = stored_runs(session_factory)
    assert [run.status for run in runs] == ["finished", "expired"]
    assert [run.status_reason for run in runs] == [None, "not_claimed"]
    assert runs[1].stop_requested_at is None


def test_stop_is_for_members_also_in_an_archived_project(client, session_factory):
    run_id = add_run(session_factory, status="running")
    refused(stop(client, run_id, headers=VIEWER), 403, VIEWER_CODE)
    assert stop(client, run_id, headers=OUTSIDER).status_code == 403
    missing = stop(client, "missing")
    refused(missing, 404, "run_not_found")
    refused(stop(client, run_id, reason="r" * 501), 422, "validation_error")

    def archive(db, w):
        w.project.is_active = False

    change(session_factory, archive)
    response = stop(client, run_id)
    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "stop_requested"


# ---------------------------------------------------------------------------
# Token hand-off
# ---------------------------------------------------------------------------


def hand_off(client, run_id: str, headers=MEMBER, **body):
    payload = {"name": "refresh_token", "token": NEW_TOKEN, **body}
    return client.post(f"{BASE}/runs/{run_id}/tokens", headers=headers, json=payload)


def test_a_new_token_is_saved_for_the_runs_target(client, session_factory):
    run_id = add_run(session_factory, status="running", token_needed="refresh_token")
    assert get(client, f"/runs/{run_id}")["token_needed"] == "refresh_token"
    response = hand_off(client, run_id, token=f" {NEW_TOKEN} ")
    assert response.status_code == 200, response.text
    assert response.json() == {"name": "refresh_token", "hint": "7a2e", "version": 2}
    with session_factory() as db:
        w = world(db)
        token = target_tokens(db, w.target)["refresh_token"]
        assert token_value(token) == NEW_TOKEN
        assert NEW_TOKEN not in token.token_encrypted
        assert (token.version, token.updated_by_user_id) == (2, MEMBER_ID)
        assert db.get(PerformanceRun, run_id).token_needed is None
    page = get(client, f"/runs/{run_id}")
    assert page["token_needed"] is None
    assert [(row["name"], row["hint"], row["version"]) for row in page["tokens"]] == [
        ("access_token", "0c2e", 1),
        ("refresh_token", "7a2e", 2),
    ]
    assert events(session_factory, run_id) == [("token_supplied", "qym")]
    timeline = get(client, f"/runs/{run_id}/events")["events"]
    assert timeline[0]["details"] == {"name": "refresh_token", "version": 2}
    (audit,) = audits(session_factory, "performance.run.token")
    assert audit.entity_id == run_id
    assert audit.before == {"name": "refresh_token", "hint": "41bd", "version": 1}
    assert audit.after["hint"] == "7a2e" and audit.after["version"] == 2
    assert_no_token_values([response.json(), page, timeline, audit.before, audit.after])


def test_the_run_keeps_asking_until_the_token_it_waits_for_arrives(
    client, session_factory
):
    run_id = add_run(session_factory, status="running", token_needed="refresh_token")
    response = hand_off(
        client, run_id, name="access_token", expires_at="2026-11-20T12:00:00Z"
    )
    assert response.json() == {"name": "access_token", "hint": "7a2e", "version": 2}
    page = get(client, f"/runs/{run_id}")
    assert page["token_needed"] == "refresh_token"
    assert page["tokens"][0]["expires_at"] == "2026-11-20T12:00:00Z"


def test_hand_off_refusals(client, session_factory, monkeypatch):
    finished = add_run(session_factory, status="finished")
    refused(hand_off(client, finished), 409, "run_ended", status="finished")
    run_id = add_run(session_factory, status="running")
    refused(hand_off(client, run_id, token="  "), 422, "token_empty")
    refused(hand_off(client, run_id, name="session"), 422, "validation_error")
    wrong_type = hand_off(client, run_id, token={"value": "secret-in-a-dict-5b1d"})
    refused(wrong_type, 422, "token_empty")
    assert "secret-in-a-dict-5b1d" not in wrong_type.text
    refused(hand_off(client, run_id, headers=VIEWER), 403, VIEWER_CODE)
    refused(hand_off(client, "missing"), 404, "run_not_found")
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY")
    refused(hand_off(client, run_id), 409, "encryption_key_missing")
    with session_factory() as db:
        token = target_tokens(db, world(db).target)["refresh_token"]
        assert (token.version, token.token_hint) == (1, "41bd")


SECRET_BODY = "eyJhbGciOiJIUzI1NiJ9.a-pasted-token-body.c4d9"


@pytest.mark.parametrize(
    "content, content_type",
    [
        (json.dumps(SECRET_BODY), "application/json"),
        (json.dumps([SECRET_BODY]), "application/json"),
        (json.dumps([{"token": SECRET_BODY}]), "application/json"),
        (SECRET_BODY, "text/plain"),
        (SECRET_BODY, "application/json"),
        (f"token={SECRET_BODY}", "application/x-www-form-urlencoded"),
    ],
)
def test_a_hand_off_body_that_is_not_an_object_never_comes_back(
    client, session_factory, content, content_type
):
    run_id = add_run(session_factory, status="running")
    response = client.post(
        f"{BASE}/runs/{run_id}/tokens",
        headers={**MEMBER, "Content-Type": content_type},
        content=content,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] in ("token_empty", "validation_error")
    assert SECRET_BODY not in response.text
    assert "pasted-token" not in response.text
    with session_factory() as db:
        token = target_tokens(db, world(db).target)["refresh_token"]
        assert (token.version, token.token_hint) == (1, "41bd")


def test_a_hand_off_holds_the_run_and_keeps_a_request_the_runner_made_meanwhile(
    session_factory, database
):
    """The person's request read the run; the runner then asked for the other token."""
    if database.dialect.name != "postgresql":
        pytest.skip("two transactions at once need PostgreSQL's row locks")
    run_id = add_run(session_factory, status="running", token_needed="access_token")
    with session_factory() as person:
        run = person.get(PerformanceRun, run_id)
        assert run.token_needed == "access_token"
        with session_factory() as runner_side:
            runner_side.get(PerformanceRun, run_id).token_needed = "refresh_token"
            runner_side.commit()
        with statements(database) as seen:
            performance_runs.handoff_token(
                person,
                run=run,
                user=person.get(User, MEMBER_ID),
                name="access_token",
                value=NEW_TOKEN,
                now=NOW,
            )
        person.commit()
    locks = [
        sql for sql in seen if "FOR UPDATE" in sql and "FROM performance_runs" in sql
    ]
    assert len(locks) == 1, seen
    with session_factory() as db:
        assert db.get(PerformanceRun, run_id).token_needed == "refresh_token"


def test_a_run_that_went_silent_takes_no_token(client, session_factory, monkeypatch):
    run_id = add_run(session_factory, status="running")
    page_time(monkeypatch, NOW + timedelta(seconds=120))
    refused(hand_off(client, run_id), 409, "run_ended", status="interrupted")


def test_hand_off_follows_the_production_rule_and_needs_the_target(
    client, session_factory
):
    production(session_factory)
    run_id = add_run(session_factory, status="running")
    refused(hand_off(client, run_id), 403, "production_requires_manager")
    assert get(client, f"/runs/{run_id}")["can"] == {
        "stop": True,
        "hand_off_token": False,
    }
    assert (
        get(client, f"/runs/{run_id}", headers=MANAGER)["can"]["hand_off_token"] is True
    )
    assert hand_off(client, run_id, headers=MANAGER).status_code == 200

    def lose_target(db, _w):
        db.get(PerformanceRun, run_id).target_id = None

    change(session_factory, lose_target)
    refused(hand_off(client, run_id, headers=MANAGER), 409, "target_missing")


# ---------------------------------------------------------------------------
# Home, history, setup
# ---------------------------------------------------------------------------


def runner_payload(ids) -> dict:
    return {
        "id": ids.runner,
        "key": "runner-1",
        "name": "QA - Runner",
        "info": {"runner_version": "0.1.0", "host": "qa-runner-host"},
        "reported_state": "idle",
        "current_run_id": None,
        "last_heartbeat_at": AT,
        "seconds_since_heartbeat": 0,
        "fresh": True,
        "stale": False,
        "runner_key_set": True,
        "runner_key_matches": True,
        "errors_last_hour": 0,
        "registered_at": AT,
    }


def test_home_before_any_run(client, ids):
    assert get(client) == {
        "server_time": AT,
        "runner": runner_payload(ids),
        "active_run": None,
        "targets": [
            {
                "id": ids.target,
                "name": "QA - Preprod",
                "is_production": False,
                "host": "target.example.test",
                "sign_in_ready": True,
                "active_run_id": None,
                "archived": False,
            }
        ],
        "runs": {"rows": [], "total": 0, "page": 1, "page_size": 25},
        "safe_load_trend": [],
        "can": {"start": True, "manage": False},
    }
    assert get(client, headers=MANAGER)["can"] == {"start": True, "manage": True}
    assert get(client, headers=VIEWER)["can"] == {"start": False, "manage": False}
    assert client.get(BASE, headers=OUTSIDER).status_code == 403


def test_home_shows_the_run_in_progress_and_the_trend(client, session_factory, ids):
    def work(db, w):
        for number, safe in enumerate([10, None, 30], start=1):
            seed_run(
                db,
                w.project,
                w.runner,
                w.target,
                status="finished",
                now=NOW - timedelta(days=4 - number),
                safe_load_users=safe,
                breaking_level_users=safe + 10 if safe else None,
                max_users=60,
            )
        seed_run(
            db,
            w.project,
            w.runner,
            w.target,
            status="stopped",
            now=NOW - timedelta(hours=2),
            safe_load_users=20,
        )
        seed_run(
            db,
            w.project,
            w.runner,
            w.target,
            status="finished",
            test_type="soak",
            now=NOW - timedelta(hours=1),
            safe_load_users=20,
        )
        return seed_run(
            db,
            w.project,
            w.runner,
            w.target,
            user=w.member,
            status="running",
            token_needed="refresh_token",
            progress={
                "phase": "hold",
                "elapsed_s": 200.0,
                "level": 20,
                "users": 20,
                "p95_ms": 95000,
                "answers": {"finished": 31, "in_flight": 12, "errors": 2},
                "levels": LEVELS,
            },
        ).id

    active = change(session_factory, work)
    home = get(client)
    assert home["active_run"] == {
        "id": active,
        "number": 6,
        "test_type": "breakpoint",
        "status": "running",
        "target": {"id": ids.target, "name": "QA - Preprod", "is_production": False},
        "requested_by": "QA - Person member-1",
        "requested_by_user_id": MEMBER_ID,
        "requested_at": AT,
        "started_at": AT,
        "elapsed_s": 200.0,
        "planned_s": 300,
        "phase": "hold",
        "level": 20,
        "users": 20,
        "answers_finished": 31,
        "answers_in_flight": 12,
        "errors": 2,
        "p95_ms": 95000,
        "limit_ms": 180000,
        "stop_requested": False,
        "token_needed": "refresh_token",
        "seconds_since_report": 0,
        "stages": [
            {"role": "baseline", "target_users": 5, "start_s": 0, "end_s": 60},
            {"role": "ramp", "target_users": 10, "start_s": 60, "end_s": 90},
            {"role": "hold", "target_users": 10, "start_s": 90, "end_s": 150},
            {"role": "ramp", "target_users": 20, "start_s": 150, "end_s": 180},
            {"role": "hold", "target_users": 20, "start_s": 180, "end_s": 240},
            {"role": "cooldown", "target_users": 5, "start_s": 240, "end_s": 270},
            {"role": "cooldown", "target_users": 0, "start_s": 270, "end_s": 300},
        ],
        "levels": LEVELS,
    }
    page = get(client, f"/runs/{active}")
    assert home["active_run"]["stages"] == page["config"]["plan"]["stages"]
    assert home["active_run"]["levels"] == page["progress"]["levels"]
    assert home["targets"][0]["active_run_id"] == active
    # Finished Breakpoint runs with a safe load only, oldest first.
    assert [
        (
            row["number"],
            row["safe_load_users"],
            row["breaking_level_users"],
            row["max_users"],
        )
        for row in home["safe_load_trend"]
    ] == [(1, 10, 20, 60), (3, 30, 40, 60)]
    assert home["safe_load_trend"][0]["finished_at"] == "2026-11-17T11:00:00Z"
    assert home["safe_load_trend"][0]["target_id"] == ids.target
    assert [row["number"] for row in home["runs"]["rows"]] == [6, 5, 4, 3, 2, 1]
    assert home["runs"]["total"] == 6
    assert get(client, "/runner")["active_run"] == home["active_run"]


def test_a_history_row_carries_the_headline(client, session_factory, ids):
    run_id = add_run(session_factory, status="finished", by="owner", **HEADLINE)
    change(
        session_factory, lambda db, w: seed_report(db, db.get(PerformanceRun, run_id))
    )
    page = get(client, "/runs", headers=VIEWER)
    assert page == {
        "rows": [
            {
                "id": run_id,
                "number": 1,
                "test_type": "breakpoint",
                "status": "finished",
                "target": {
                    "id": ids.target,
                    "name": "QA - Preprod",
                    "is_production": False,
                },
                "dataset": {
                    "id": "performance-dataset",
                    "name": "QA - Load questions",
                    "version": "v1",
                },
                "requested_by": "QA - Person owner-1",
                "requested_by_user_id": OWNER_ID,
                "requested_at": AT,
                "started_at": AT,
                "finished_at": AT,
                "limit_ms": 180000,
                "status_reason": None,
                "note": "",
                "has_report": True,
                **HEADLINE,
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 25,
    }


def history(session_factory) -> dict[str, str]:
    """Six runs of different kinds; returns their ids by a short name."""

    def work(db, w):
        other = seed_target(
            db, w.project, name="QA - Second", base_url="https://second.example.test"
        )
        made = {}
        rows = [
            (
                "found",
                w.target,
                "finished",
                "breakpoint",
                {"verdict": "breakpoint_found"},
            ),
            ("clean", w.target, "finished", "breakpoint", {"verdict": "not_reached"}),
            ("smoke", other, "finished", "smoke", {"verdict": "pass"}),
            ("soak", other, "failed", "soak", {"error": "The sign-in was rejected"}),
            ("stopped", w.target, "stopped", "breakpoint", {}),
            ("live", w.target, "running", "breakpoint", {}),
        ]
        for index, (name, target, status, test_type, extra) in enumerate(rows):
            made[name] = seed_run(
                db,
                w.project,
                w.runner,
                target,
                status=status,
                test_type=test_type,
                now=NOW - timedelta(minutes=10 * (len(rows) - index - 1)),
                **extra,
            ).id
        made["other_target"] = other.id
        return made

    return change(session_factory, work)


def numbers(page: dict) -> list[int]:
    return [row["number"] for row in page["rows"]]


def test_history_pages_newest_first(client, session_factory):
    history(session_factory)
    first = get(client, "/runs", page_size=4)
    assert (numbers(first), first["total"], first["page"], first["page_size"]) == (
        [6, 5, 4, 3],
        6,
        1,
        4,
    )
    second = get(client, "/runs", page_size=4, page=2)
    assert (numbers(second), second["total"], second["page"]) == ([2, 1], 6, 2)
    assert numbers(get(client, "/runs", page_size=4, page=3)) == []
    for params in ({"page_size": 0}, {"page_size": 201}, {"page": 0}):
        response = client.get(f"{BASE}/runs", headers=MEMBER, params=params)
        refused(response, 422, "validation_error")


def test_history_filters(client, session_factory, monkeypatch):
    made = history(session_factory)
    assert numbers(get(client, "/runs", status=["finished"])) == [3, 2, 1]
    assert numbers(get(client, "/runs", status=["failed", "stopped"])) == [5, 4]
    assert numbers(get(client, "/runs", verdict=["pass", "not_reached"])) == [3, 2]
    assert numbers(get(client, "/runs", target=made["other_target"])) == [4, 3]
    assert numbers(get(client, "/runs", test_type=["smoke", "soak"])) == [4, 3]
    both = get(client, "/runs", test_type=["breakpoint"], status=["finished"])
    assert (numbers(both), both["total"]) == ([2, 1], 2)
    assert numbers(get(client, "/runs", status=["running"])) == [6]
    assert get(client, "/runs", status=["interrupted"])["total"] == 0
    refused(
        client.get(f"{BASE}/runs", headers=MEMBER, params={"status": "done"}),
        422,
        "validation_error",
    )
    # The status is the one derived on read: a silent run is interrupted, not running.
    page_time(monkeypatch, NOW + timedelta(seconds=120))
    assert numbers(get(client, "/runs", status=["running"])) == []
    silent = get(client, "/runs", status=["interrupted"])
    assert numbers(silent) == [6]
    row = silent["rows"][0]
    assert (row["status"], row["id"]) == ("interrupted", made["live"])
    assert row["finished_at"] == "2026-11-20T11:02:00Z"
    assert row["status_reason"] == "The runner stopped answering; the run was ended"


def test_reasons_of_runs_that_did_not_end_normally(
    client, session_factory, monkeypatch
):
    made = history(session_factory)
    rows = {row["id"]: row for row in get(client, "/runs")["rows"]}
    assert rows[made["soak"]]["status_reason"] == "The sign-in was rejected"
    assert (
        rows[made["stopped"]]["status_reason"]
        == "The runner stopped the test by itself."
    )
    assert rows[made["found"]]["status_reason"] is None
    assert get(client, f"/runs/{made['soak']}")["status_reason"]["code"] == "k6_failed"

    def more(db, w):
        runner = seed_runner(
            db, w.project, key="runner-0", now=NOW - timedelta(hours=1)
        )
        target = db.get(PerformanceTarget, made["other_target"])
        return {
            "preflight": seed_run(
                db,
                w.project,
                w.runner,
                target,
                status="failed",
                started_at=None,
                error="The dataset has no complex question",
            ).id,
            "replaced": seed_run(
                db,
                w.project,
                w.runner,
                target,
                status="interrupted",
                status_reason="runner_restarted",
                error="A new runner process took over; the run was ended",
            ).id,
            "by_person": seed_run(
                db,
                w.project,
                w.runner,
                target,
                status="stopped",
                status_reason="stopped_by_person",
                stop_requested_at=NOW,
                stop_requested_by_user_id=w.owner.id,
            ).id,
            "unknown_code": seed_run(
                db,
                w.project,
                w.runner,
                target,
                status="failed",
                status_reason="something_new",
                error="The plan differs",
            ).id,
            "finished": seed_run(
                db,
                w.project,
                w.runner,
                target,
                status="finished",
                status_reason="k6_failed",
            ).id,
            "shutdown": seed_run(
                db,
                w.project,
                w.runner,
                target,
                status="interrupted",
                error="The runner was told to shut down",
            ).id,
            "unclaimed": seed_run(db, w.project, runner, target, status="queued").id,
        }

    extra = change(session_factory, more)

    def reason(name):
        return get(client, f"/runs/{extra[name]}")["status_reason"]

    assert reason("preflight") == {
        "code": "preflight_failed",
        "message": "The dataset has no complex question",
    }
    assert reason("replaced") == {
        "code": "runner_restarted",
        "message": "The runner was started again during the run; the run was ended.",
    }
    assert reason("by_person") == {
        "code": "stopped_by_person",
        "message": "Stopped by QA - Person owner-1.",
    }
    # A code this version does not know falls back to what the row itself says.
    assert reason("unknown_code") == {
        "code": "k6_failed",
        "message": "The plan differs",
    }
    # A run that ran to its end has no reason, whatever the column holds.
    assert reason("finished") is None
    assert reason("shutdown") == {
        "code": "runner_shutdown",
        "message": "The runner was told to shut down",
    }
    assert reason("unclaimed") is None
    page_time(monkeypatch, NOW + timedelta(seconds=600))
    page = get(client, f"/runs/{extra['unclaimed']}")
    assert (page["effective_status"], page["run"]["stored_status"]) == (
        "expired",
        "queued",
    )
    assert page["status_reason"]["code"] == "not_claimed"
    assert page["run"]["finished_at"] == "2026-11-20T11:10:00Z"
    assert page["can"] == {"stop": False, "hand_off_token": False}


def test_history_and_home_use_a_fixed_number_of_statements(
    client, session_factory, database
):
    add_run(session_factory, status="finished", by="owner")
    with statements(database) as one_list:
        get(client, "/runs")
    with statements(database) as one_home:
        get(client)

    def more(db, w):
        people = [w.owner, w.member]
        for number in range(8):
            run = seed_run(
                db,
                w.project,
                w.runner,
                w.target,
                status="finished",
                user=people[number % 2],
            )
            seed_report(db, run)
            seed_target(
                db,
                w.project,
                name=f"QA - Target {number}",
                base_url=f"https://target-{number}.example.test",
            )

    change(session_factory, more)
    with statements(database) as many_list:
        assert len(get(client, "/runs")["rows"]) == 9
    with statements(database) as many_home:
        assert len(get(client)["targets"]) == 9
    assert len(many_list) == len(one_list)
    assert len(many_home) == len(one_home)


def test_history_search_matches_number_target_dataset_and_person(
    client, session_factory, database
):
    add_run(session_factory, status="finished", by="owner")

    def work(db, w):
        staging = seed_target(
            db, w.project, name="QA - Staging", base_url="https://staging.example.test"
        )
        seed_run(db, w.project, w.runner, staging, status="finished", user=w.member)
        # A run on the project's real dataset (the two above carry a snapshot of a dataset that has no row).
        seed_run(
            db, w.project, w.runner, w.target, version=w.version, status="finished"
        )

    change(session_factory, work)
    dataset = next(
        row["dataset"]["name"]
        for row in get(client, "/runs")["rows"]
        if row["number"] == 3
    )

    def found(q):
        page = get(client, "/runs", q=q)
        return sorted(row["number"] for row in page["rows"]), page["total"]

    assert found("staging") == ([2], 1)  # the target, case-insensitive
    assert found("PERSON MEMBER") == ([2], 1)  # the requesting person
    # The dataset, by the name each row shows (stored on the run).
    shown = sorted(
        row["number"]
        for row in get(client, "/runs")["rows"]
        if row["dataset"]["name"] == dataset
    )
    assert shown and found(dataset.upper()) == (shown, len(shown))
    assert found("run 1") == ([1], 1) and found("#2") == ([2], 1)  # the number
    assert found("50%_") == ([], 0)  # LIKE wildcards are plain characters

    # A renamed target: the search follows the name stored on the run, which is the name its row shows.
    def rename(db, w):
        target = db.scalars(
            select(PerformanceTarget).where(PerformanceTarget.name == "QA - Staging")
        ).one()
        target.name = "QA - Renamed"

    change(session_factory, rename)
    assert [
        row["target"]["name"] for row in get(client, "/runs", q="staging")["rows"]
    ] == ["QA - Staging"]
    assert found("renamed") == ([], 0)
    # A search is part of the same statements as the list.
    with statements(database) as plain:
        get(client, "/runs")
    with statements(database) as searched:
        get(client, "/runs", q="staging")
    assert len(searched) == len(plain)


def test_runner_events_search_the_message_and_the_runner_read_counts_them(
    client, session_factory, database
):
    def work(db, w):
        seed_event(
            db,
            w.runner,
            at=NOW - timedelta(minutes=2),
            message="Sign-in failed on QA - Preprod",
        )
        seed_event(
            db,
            w.runner,
            at=NOW - timedelta(minutes=1),
            message="A note from the runner",
        )

    change(session_factory, work)
    page = get(client, "/runner/events", q="SIGN-IN")
    assert ([row["message"] for row in page["events"]], page["total"]) == (
        ["Sign-in failed on QA - Preprod"],
        1,
    )
    assert get(client, "/runner/events", q="100%")["total"] == 0
    with statements(database) as plain:
        get(client, "/runner/events")
    with statements(database) as searched:
        get(client, "/runner/events", q="note")
    assert len(searched) == len(plain)
    assert get(client, "/runner")["events_total"] == 2


def test_setup_gives_limits_defaults_and_targets(client, session_factory, ids):
    def archived(db, w):
        seed_target(
            db,
            w.project,
            name="QA - Old",
            base_url="https://old.example.test",
            archived_at=NOW,
        )
        w.target.max_users = 50

    change(session_factory, archived)
    setup = get(client, "/setup")
    assert setup["server_time"] == AT
    assert setup["runner"] == runner_payload(ids)
    assert setup["blocked"] is None
    assert setup["can_manage_targets"] is False
    assert setup["encryption_ready"] is True
    assert setup["store_answers_default"] == {"production": False, "other": True}
    assert setup["limits"] == {
        "baseline_users": [1, 200],
        "max_users": [1, 200],
        "step_users": [1, 200],
        "hold_seconds": [30, 3600],
        "limit_ms": [1000, 900000],
        "max_error_rate_pct": [1, 100],
        "follow_up_rate": [0, 1],
        "timeout_seconds": [30, 900],
        "users": [1, 200],
        "duration_seconds": [60, 28800],
        "max_total_seconds": 28800,
        "starts_per_hour": 20,
        "starts_left": 20,
    }
    assert setup["defaults"]["breakpoint"] == {
        "plan": {
            "baseline_users": 5,
            "max_users": 60,
            "step_users": 10,
            "hold_seconds": 450,
            "follow_up_rate": 0.3,
            "abort_on_break": True,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 540,
            "users": None,
            "duration_seconds": None,
            "min_quality": None,
            "max_no_data_pct": None,
        },
        "mix": {"simple": 50, "medium": 35, "complex": 15},
    }
    assert setup["defaults"]["smoke"]["plan"]["users"] == 1
    assert setup["defaults"]["smoke"]["plan"]["duration_seconds"] == 180
    assert setup["defaults"]["soak"]["plan"]["users"] == 20
    assert setup["defaults"]["soak"]["plan"]["duration_seconds"] == 7200
    (target,) = setup["targets"]
    assert target["name"] == "QA - Preprod"
    assert target["max_users"] == 50
    assert (
        target["can_start"],
        target["can_save_tokens"],
        target["sign_in_ready"],
    ) == (
        True,
        True,
        True,
    )
    assert target["settings"] == {
        "auth_server": None,
        "refresh_cookie_name": "estishraf_rt",
    }
    assert "last_run" not in target
    assert_no_token_values(setup)
    manager = get(client, "/setup", headers=MANAGER)
    assert manager["can_manage_targets"] is True
    viewer = get(client, "/setup", headers=VIEWER)
    assert viewer["targets"][0]["can_start"] is False
    # Each default is a plan the start route accepts as it is.
    for test_type, values in setup["defaults"].items():
        response = start(
            client, ids, test_type=test_type, plan=values["plan"], mix=values["mix"]
        )
        if test_type == "breakpoint":
            refused(response, 422, "over_target_limit", limit=50, value=60)
        else:
            assert response.status_code == 201, response.text
            run = stored_runs(session_factory)[-1]
            client.post(f"{BASE}/runs/{run.id}/stop", headers=MEMBER)
    assert get(client, "/setup")["limits"]["starts_left"] == 18


# ---------------------------------------------------------------------------
# The run page
# ---------------------------------------------------------------------------


def test_a_run_before_its_first_report(client, session_factory, ids):
    run_id = add_run(session_factory, status="queued", by="member")
    page = get(client, f"/runs/{run_id}")
    assert page["server_time"] == AT
    assert page["effective_status"] == "queued"
    assert (
        page["run"]["status"] == "queued" and page["run"]["stored_status"] == "queued"
    )
    assert page["run"]["requested_by"] == "QA - Person member-1"
    assert page["run"]["max_users"] == 20
    assert page["run"]["claimed_at"] is None
    assert page["status_reason"] is None
    assert page["progress"] is None
    assert page["seconds_since_report"] is None
    assert page["summary"] is None
    assert (page["report"], page["report_expired"]) == (None, False)
    assert page["late_results_until"] is None
    assert page["config"]["plan"]["levels"] == [10, 20]
    assert page["runner"] == {
        "name": "QA - Runner",
        "reported_state": "idle",
        "seconds_since_heartbeat": 0,
        "fresh": True,
        "stale": False,
    }
    assert page["counts"] == {
        "questions_received": 0,
        "questions_dropped": 0,
        "log_lines_received": 0,
        "log_lines_dropped": 0,
        "events": 0,
    }
    assert page["can"] == {"stop": True, "hand_off_token": True}
    assert get(client, f"/runs/{run_id}", headers=VIEWER)["can"] == {
        "stop": False,
        "hand_off_token": False,
    }
    assert_no_token_values(page)


def test_a_finished_run_with_its_result_and_report(
    client, session_factory, monkeypatch
):
    def work(db, w):
        run = seed_run(
            db,
            w.project,
            w.runner,
            w.target,
            status="finished",
            progress={"phase": "finishing", "elapsed_s": 240.0},
            summary={
                "schema": 1,
                "verdict": "breakpoint_found",
                "headline": {"safe_load_users": 10},
                "suite_summary": {"raw": "the suite's own file"},
            },
            questions_dropped=3,
            log_lines_dropped=7,
            exit_code=99,
            **HEADLINE,
        )
        seed_questions(db, run, 4)
        seed_log_lines(db, run, 5)
        seed_event(db, w.runner, run=run)
        report = seed_report(db, run)
        return run.id, report.byte_size, report.sha256

    run_id, size, digest = change(session_factory, work)
    page_time(monkeypatch, NOW + timedelta(seconds=300))
    page = get(client, f"/runs/{run_id}")
    assert page["effective_status"] == "finished"
    assert page["progress"] == {"phase": "finishing", "elapsed_s": 240.0}
    assert page["seconds_since_report"] == 300
    assert page["summary"] == {
        "schema": 1,
        "verdict": "breakpoint_found",
        "headline": {"safe_load_users": 10},
    }
    assert page["report"] == {
        "byte_size": size,
        "sha256": digest,
        "received_at": AT,
        "expires_at": "2027-05-19T11:00:00Z",
        "url": f"{BASE}/runs/{run_id}/report",
    }
    assert page["report_expired"] is False
    assert page["run"]["has_report"] is True
    assert page["run"]["exit_code"] == 99
    assert page["run"]["safe_load_users"] == 10
    assert page["counts"] == {
        "questions_received": 4,
        "questions_dropped": 3,
        "log_lines_received": 5,
        "log_lines_dropped": 7,
        "events": 1,
    }
    assert page["late_results_until"] == "2026-11-20T11:10:00Z"
    assert page["can"] == {"stop": False, "hand_off_token": False}


def test_a_run_of_another_project_is_not_found(client, session_factory):
    def work(db, _w):
        other = seed_performance(db, suffix="2", runner_token="t-2", other_token="o-2")
        return seed_run(
            db, other.project, other.runner, other.target, status="finished"
        ).id

    foreign = change(session_factory, work)
    for path in (
        "",
        "/questions",
        "/questions.csv",
        "/log",
        "/log.txt",
        "/events",
        "/report",
    ):
        response = client.get(f"{BASE}/runs/{foreign}{path}", headers=MANAGER)
        refused(response, 404, "run_not_found")
    assert get(client, "/runs")["total"] == 0


def with_questions(session_factory) -> str:
    """A run with 7 questions: seq 6 and 7 are errors, 3 is a follow-up without data."""

    def work(db, w):
        run = seed_run(db, w.project, w.runner, w.target, status="running")
        seed_questions(db, run, 5)
        seed_questions(
            db,
            run,
            2,
            first_seq=6,
            status="error",
            http_status=500,
            error_kind="server",
            level=20,
            answer=None,
            quality=None,
            ttfb_ms=None,
        )
        row = db.scalars(
            select(PerformanceQuestion).where(
                PerformanceQuestion.run_id == run.id, PerformanceQuestion.seq == 3
            )
        ).one()
        row.is_followup = True
        row.no_data = True
        row.level = None
        row.question = "=SUM(A1) is 100% of the customs total?"
        row.answer = "No data for that period"
        return run.id

    return change(session_factory, work)


def seqs(page: dict) -> list[int]:
    return [row["seq"] for row in page["rows"]]


def test_questions_newest_first_with_counts_over_the_whole_run(client, session_factory):
    run_id = with_questions(session_factory)
    page = get(client, f"/runs/{run_id}/questions", headers=VIEWER)
    assert seqs(page) == [7, 6, 5, 4, 3, 2, 1]
    assert (page["total"], page["page"], page["page_size"], page["last_seq"]) == (
        7,
        1,
        50,
        7,
    )
    assert page["facets"] == {
        "statuses": {"ok": 5, "error": 2, "interrupted": 0},
        "tiers": {"simple": 2, "medium": 3, "complex": 2},
        "levels": {"10": 4, "20": 2, "none": 1},
        "error_kinds": {"server": 2},
        "followups": 1,
        "no_data": 1,
    }
    assert page["rows"][-1] == {
        "seq": 1,
        "asked_at": AT,
        "elapsed_s": 91.0,
        "stage": "hold",
        "level": 10,
        "user": 2,
        "tier": "medium",
        "question_id": "medium-1",
        "is_followup": False,
        "question": "Question 1?",
        "status": "ok",
        "http_status": 200,
        "error_kind": None,
        "duration_ms": 1000.0,
        "ttfb_ms": 100.0,
        "quality": 100.0,
        "no_data": False,
        "warmup": False,
        "attempts": 1,
        "answer": "Answer 1",
        "answer_truncated": False,
    }


def test_questions_paging_filters_and_sorting(client, session_factory):
    run_id = with_questions(session_factory)
    path = f"/runs/{run_id}/questions"
    second = get(client, path, page_size=3, page=2)
    assert (seqs(second), second["total"], second["page"], second["page_size"]) == (
        [4, 3, 2],
        7,
        2,
        3,
    )
    errors = get(client, path, status=["error"])
    assert (seqs(errors), errors["total"]) == ([7, 6], 2)
    # The counts for the filter controls stay those of the whole run.
    assert errors["facets"]["statuses"] == {"ok": 5, "error": 2, "interrupted": 0}
    assert errors["last_seq"] == 7
    assert seqs(get(client, path, status=["ok", "error"], level=[20])) == [7, 6]
    assert seqs(get(client, path, tier=["simple"])) == [6, 3]
    assert seqs(get(client, path, tier=["simple", "complex"])) == [6, 5, 3, 2]
    assert seqs(get(client, path, followup="true")) == [3]
    assert seqs(get(client, path, followup="false", status=["error"])) == [7, 6]
    assert seqs(get(client, path, no_data="true")) == [3]
    for number in ("#3", "  #3  "):
        assert seqs(get(client, path, q=number)) == [3]
    # "#1" is the number only; a plain 1 also finds text that contains it.
    assert seqs(get(client, path, q="#1")) == [1]
    assert seqs(get(client, path, q="1")) == [3, 1]
    assert seqs(get(client, path, q="#1", status=["error"])) == []
    assert seqs(get(client, path, q="534")) == []
    assert seqs(get(client, path, q="9" * 200)) == []
    assert seqs(get(client, path, q="question 4")) == [4]
    assert seqs(get(client, path, q="no data for")) == [3]
    assert seqs(get(client, path, q="complex-")) == [5, 2]
    # A percent sign and an underscore are text, not wildcards.
    assert seqs(get(client, path, q="100% of")) == [3]
    assert seqs(get(client, path, q="_")) == []
    assert seqs(get(client, path, sort="seq")) == [1, 2, 3, 4, 5, 6, 7]
    assert seqs(get(client, path, sort="-duration_ms", page_size=3)) == [7, 6, 5]
    assert seqs(get(client, path, sort="duration_ms", page_size=2)) == [1, 2]
    # Rows without a first byte come last, in both directions.
    assert seqs(get(client, path, sort="-ttfb_ms")) == [5, 4, 3, 2, 1, 6, 7]
    assert seqs(get(client, path, sort="ttfb_ms")) == [1, 2, 3, 4, 5, 6, 7]
    for params in (
        {"sort": "tier"},
        {"status": "slow"},
        {"page_size": 201},
        {"level": "x"},
    ):
        response = client.get(BASE + path, headers=MEMBER, params=params)
        refused(response, 422, "validation_error")


@pytest.mark.parametrize(
    "query, found",
    [("#534", [534]), ("534", [1534, 534, 8])],
    ids=["number", "number or text"],
)
def test_questions_search_by_number(client, session_factory, query, found):
    run_id = with_questions(session_factory)

    def work(db, w):
        run = db.get(PerformanceRun, run_id)
        seed_questions(db, run, 1, first_seq=534)
        seed_questions(db, run, 1, first_seq=1534)
        seed_questions(db, run, 1, first_seq=8, question="Text mentioning 534")

    change(session_factory, work)
    page = get(client, f"/runs/{run_id}/questions", q=query)
    assert (seqs(page), page["total"]) == (found, len(found))
    response = client.get(
        f"{BASE}/runs/{run_id}/questions.csv", headers=VIEWER, params={"q": query}
    )
    assert response.status_code == 200
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert [row["seq"] for row in rows] == [str(seq) for seq in sorted(found)]


def test_questions_live_tail_gives_the_rows_that_came_since(client, session_factory):
    run_id = with_questions(session_factory)
    path = f"/runs/{run_id}/questions"
    tail = get(client, path, after_seq=4)
    assert (seqs(tail), tail["page"], tail["total"], tail["last_seq"]) == (
        [5, 6, 7],
        1,
        7,
        7,
    )
    assert seqs(get(client, path, after_seq=4, page_size=2)) == [5, 6]
    assert seqs(get(client, path, after_seq=2, status=["ok"])) == [3, 4, 5]
    assert seqs(get(client, path, after_seq=7)) == []


def test_questions_as_a_file(client, session_factory):
    run_id = with_questions(session_factory)
    response = client.get(f"{BASE}/runs/{run_id}/questions.csv", headers=VIEWER)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="performance-run-1-questions.csv"'
    )
    assert response.headers["x-content-type-options"] == "nosniff"
    text = response.content.decode("utf-8")
    assert text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(text[1:])))
    assert rows[0] == [
        "seq",
        "asked_at",
        "elapsed_s",
        "stage",
        "level",
        "user",
        "tier",
        "question_id",
        "is_followup",
        "question",
        "status",
        "http_status",
        "error_kind",
        "duration_ms",
        "ttfb_ms",
        "quality",
        "no_data",
        "warmup",
        "attempts",
        "answer",
        "answer_truncated",
    ]
    assert [row[0] for row in rows[1:]] == ["1", "2", "3", "4", "5", "6", "7"]
    assert rows[1] == [
        "1",
        AT,
        "91.0",
        "hold",
        "10",
        "2",
        "medium",
        "medium-1",
        "False",
        "Question 1?",
        "ok",
        "200",
        "",
        "1000.0",
        "100.0",
        "100.0",
        "False",
        "False",
        "1",
        "Answer 1",
        "False",
    ]
    # A cell that a spreadsheet would read as a formula is made plain text.
    assert rows[3][9] == "'=SUM(A1) is 100% of the customs total?"
    assert rows[3][4] == ""
    filtered = client.get(
        f"{BASE}/runs/{run_id}/questions.csv",
        headers=MEMBER,
        params={"status": "error", "sort": "-seq", "page": 5, "after_seq": 6},
    )
    rows = list(csv.reader(io.StringIO(filtered.content.decode("utf-8")[1:])))
    assert [row[0] for row in rows[1:]] == ["7", "6"]


def with_log(session_factory) -> str:
    def work(db, w):
        run = seed_run(
            db, w.project, w.runner, w.target, status="running", log_lines_dropped=4
        )
        seed_log_lines(
            db,
            run,
            6,
            level=lambda seq: {3: "warning", 5: "error"}.get(seq, "info"),
            message=lambda seq: (
                "runner: sign-in was rejected\nsecond line"
                if seq == 5
                else f"runner: line {seq}"
            ),
        )
        return run.id

    return change(session_factory, work)


def test_log_lines_in_order_with_a_pointer_to_the_rest(client, session_factory):
    run_id = with_log(session_factory)
    path = f"/runs/{run_id}/log"
    page = get(client, path, headers=VIEWER, limit=4)
    assert [line["seq"] for line in page["lines"]] == [1, 2, 3, 4]
    assert page["lines"][2] == {
        "seq": 3,
        "at": AT,
        "level": "warning",
        "message": "runner: line 3",
    }
    assert (
        page["next_after_seq"],
        page["last_seq"],
        page["total"],
        page["dropped"],
    ) == (
        4,
        6,
        6,
        4,
    )
    rest = get(client, path, limit=4, after_seq=4)
    assert [line["seq"] for line in rest["lines"]] == [5, 6]
    assert rest["next_after_seq"] is None
    exact = get(client, path, limit=6)
    assert (len(exact["lines"]), exact["next_after_seq"]) == (6, None)
    assert get(client, path, after_seq=6)["lines"] == []
    problems = get(client, path, level=["warning", "error"])
    assert ([line["seq"] for line in problems["lines"]], problems["total"]) == (
        [3, 5],
        2,
    )
    assert problems["last_seq"] == 6
    found = get(client, path, q="SIGN-IN")
    assert [line["seq"] for line in found["lines"]] == [5]
    for params in (
        {"limit": 1001},
        {"limit": 0},
        {"level": "debug"},
        {"after_seq": -1},
    ):
        response = client.get(BASE + path, headers=MEMBER, params=params)
        refused(response, 422, "validation_error")


def test_the_whole_log_as_a_file(client, session_factory):
    run_id = with_log(session_factory)
    response = client.get(f"{BASE}/runs/{run_id}/log.txt", headers=VIEWER)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="performance-run-1-log.txt"'
    )
    lines = response.text.splitlines()
    assert len(lines) == 6
    assert lines[0] == f"{AT} INFO    runner: line 1"
    assert lines[2] == f"{AT} WARNING runner: line 3"
    # One entry is one line of the file.
    assert lines[4] == f"{AT} ERROR   runner: sign-in was rejected second line"


def test_the_run_timeline_is_oldest_first_and_carries_no_credential(
    client, session_factory
):
    def work(db, w):
        run = seed_run(db, w.project, w.runner, w.target, status="running")
        seed_event(db, w.runner, at=NOW - timedelta(minutes=9), code="registered")
        seed_event(
            db,
            w.runner,
            run=run,
            at=NOW - timedelta(minutes=1),
            level="warning",
            code="sign_in_rejected",
            message="The refresh token was rejected",
            details={
                "http_status": 401,
                "refresh_token": "leaked",
                "nested": {"cookie": "c"},
            },
        )
        seed_event(
            db,
            w.runner,
            run=run,
            at=NOW - timedelta(minutes=5),
            code="claimed",
            source="qym",
        )
        return run.id

    run_id = change(session_factory, work)
    timeline = get(client, f"/runs/{run_id}/events", headers=VIEWER)["events"]
    assert [(row["code"], row["source"]) for row in timeline] == [
        ("claimed", "qym"),
        ("sign_in_rejected", "runner"),
    ]
    assert timeline[1] == {
        "id": timeline[1]["id"],
        "at": "2026-11-20T10:59:00Z",
        "level": "warning",
        "code": "sign_in_rejected",
        "message": "The refresh token was rejected",
        "details": {"http_status": 401, "nested": {}},
        "source": "runner",
        "run_id": run_id,
    }
    assert get(client, f"/runs/{run_id}")["counts"]["events"] == 2


def test_the_report_is_a_download_that_never_runs_in_the_page(client, session_factory):
    html = "<!doctype html><title>تقرير</title><script>window.x = 1</script>"

    def work(db, w):
        run = seed_run(db, w.project, w.runner, w.target, status="finished")
        seed_report(db, run, html)
        bare = seed_run(db, w.project, w.runner, w.target, status="finished")
        return run.id, bare.id

    run_id, bare = change(session_factory, work)
    response = client.get(f"{BASE}/runs/{run_id}/report", headers=VIEWER)
    assert response.status_code == 200, response.text
    assert response.content.decode("utf-8") == html
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="performance-run-1-report.html"'
    )
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "sandbox"
    refused(
        client.get(f"{BASE}/runs/{bare}/report", headers=VIEWER),
        404,
        "report_not_found",
    )
    assert (
        client.get(f"{BASE}/runs/{run_id}/report", headers=OUTSIDER).status_code == 403
    )


# ---------------------------------------------------------------------------
# The Runner page
# ---------------------------------------------------------------------------


def test_the_runner_page_of_a_connected_runner(client, session_factory, ids):
    def old_key(db, w):
        key = seed_api_key(
            db, w.project, w.owner, token="revoked-token", name="QA - Revoked"
        )
        key.revoked_at = NOW
        seed_event(db, w.runner, level="error", at=NOW - timedelta(minutes=59))
        seed_event(db, w.runner, level="error", at=NOW - timedelta(minutes=61))
        seed_event(db, w.runner, level="warning")

    change(session_factory, old_key)
    page = get(client, "/runner", headers=MANAGER)
    prefix = api_key_prefix(RUNNER_TOKEN)
    assert page == {
        "server_time": AT,
        "runner": {**runner_payload(ids), "errors_last_hour": 1},
        "runner_key": {
            "id": "performance-key-1",
            "name": "QA - Runner key",
            "prefix": prefix,
            "changed_at": AT,
            "changed_by": "QA - Person owner-1",
            "changed_by_user_id": OWNER_ID,
        },
        "api_keys": [
            {
                "id": "performance-other-key-1",
                "name": "QA - Other key",
                "prefix": api_key_prefix(OTHER_TOKEN),
            },
            {"id": "performance-key-1", "name": "QA - Runner key", "prefix": prefix},
        ],
        "active_run": None,
        "events_total": 3,
        "settings": {
            "fresh_within_s": 30,
            "stale_after_s": 120,
            "queue_timeout_s": 600,
            "late_window_s": 600,
        },
        "connect": {
            "project_id": PROJECT,
            "runner_path": f"/v1/projects/{PROJECT}/performance/runners/runner-1",
        },
        "can_manage": True,
    }
    assert "key_hash" not in json.dumps(page)
    member = get(client, "/runner")
    # Only a Manager chooses the key, so only a Manager gets the list to choose from.
    assert (member["can_manage"], member["api_keys"]) == (False, [])
    assert member["runner_key"]["id"] == "performance-key-1"
    assert get(client, "/runner", headers=VIEWER)["can_manage"] is False


def test_a_runner_that_registered_with_another_key_is_told_apart(
    client, session_factory
):
    def other_key(db, w):
        w.runner.registered_key_id = "performance-other-key-1"

    change(session_factory, other_key)
    runner = get(client, "/runner")["runner"]
    assert (runner["runner_key_set"], runner["runner_key_matches"]) == (True, False)


def put_key(client, key_id, headers=MANAGER):
    return client.put(
        f"{BASE}/runner/key", headers=headers, json={"api_key_id": key_id}
    )


def test_a_manager_chooses_the_runner_key(client, session_factory, monkeypatch):
    page_time(monkeypatch, NOW + timedelta(minutes=5))
    response = put_key(client, "performance-other-key-1")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "runner_key": {
            "id": "performance-other-key-1",
            "name": "QA - Other key",
            "prefix": api_key_prefix(OTHER_TOKEN),
            "changed_at": "2026-11-20T11:05:00Z",
            "changed_by": "QA - Person owner-1",
            "changed_by_user_id": OWNER_ID,
        }
    }
    (audit,) = audits(session_factory, "performance.runner.key")
    assert audit.entity_type == "performance_runner"
    assert audit.before == {"prefix": api_key_prefix(RUNNER_TOKEN)}
    assert audit.after == {"prefix": api_key_prefix(OTHER_TOKEN)}
    # The same choice again changes nothing.
    assert put_key(client, "performance-other-key-1").status_code == 200
    assert len(audits(session_factory, "performance.runner.key")) == 1
    removed = put_key(client, None)
    assert removed.json() == {"runner_key": None}
    page = get(client, "/runner", headers=MANAGER)
    assert page["runner_key"] is None
    assert page["runner"]["runner_key_set"] is False
    assert get(client, "/setup")["blocked"]["code"] == "runner_key_missing"
    assert len(audits(session_factory, "performance.runner.key")) == 2


def test_runner_key_refusals(client, session_factory):
    refused(
        put_key(client, "performance-other-key-1", headers=MEMBER), 403, "forbidden"
    )
    refused(
        put_key(client, "performance-other-key-1", headers=VIEWER), 403, VIEWER_CODE
    )
    missing = put_key(client, "missing")
    refused(missing, 404, "api_key_not_found")
    refused(
        client.put(f"{BASE}/runner/key", headers=MANAGER, json={}),
        422,
        "validation_error",
    )

    def work(db, w):
        other = seed_performance(db, suffix="2", runner_token="t-2", other_token="o-2")
        revoked = seed_api_key(
            db, w.project, w.owner, token="revoked-token", name="QA - Revoked"
        )
        revoked.revoked_at = NOW
        return other.api_key.id, revoked.id

    foreign, revoked = change(session_factory, work)
    refused(put_key(client, foreign), 404, "api_key_not_found")
    refused(put_key(client, revoked), 409, "api_key_revoked")
    run_id = add_run(session_factory, status="running")
    refused(
        put_key(client, "performance-other-key-1"), 409, "runner_busy", run_id=run_id
    )
    refused(put_key(client, None), 409, "runner_busy", run_id=run_id)
    # The key in use may be confirmed while a run goes on.
    assert put_key(client, "performance-key-1").status_code == 200
    assert audits(session_factory, "performance.runner.key") == []


def test_the_key_can_be_chosen_before_any_runner_has_connected(
    client, session_factory, ids
):
    change(session_factory, lambda db, w: db.delete(w.runner))
    empty = get(client, "/runner", headers=MANAGER)
    assert (empty["runner"], empty["runner_key"]) == (None, None)
    assert empty["connect"] == {
        "project_id": PROJECT,
        "runner_path": f"/v1/projects/{PROJECT}/performance/runners/runner-1",
    }
    assert get(client, "/runner/events") == {
        "events": [],
        "total": 0,
        "page": 1,
        "limit": 10,
    }

    response = put_key(client, "performance-key-1")
    assert response.status_code == 200, response.text
    assert response.json()["runner_key"]["id"] == "performance-key-1"
    with session_factory() as db:
        (runner,) = db.scalars(select(PerformanceRunner)).all()
        assert (runner.key, runner.name, runner.info) == ("runner-1", "Runner", {})
        assert runner.registered_at is None and runner.instance_id is None
        assert runner.last_heartbeat_at is None and runner.registered_key_id is None
        assert runner.runner_key_id == "performance-key-1"
        assert runner.runner_key_changed_by_user_id == OWNER_ID
    # The pages still say that no runner has connected, and show the chosen key.
    page = get(client, "/runner", headers=MANAGER)
    assert page["runner"] is None
    assert page["runner_key"]["id"] == "performance-key-1"
    assert get(client)["runner"] is None
    assert get(client, "/setup")["blocked"]["code"] == "runner_missing"
    refused(start(client, ids), 409, "runner_missing")
    # A second choice changes the same row.
    assert put_key(client, "performance-other-key-1").status_code == 200
    with session_factory() as db:
        (runner,) = db.scalars(select(PerformanceRunner)).all()
        assert runner.runner_key_id == "performance-other-key-1"


def test_runner_events_newest_first_with_paging_and_levels(client, session_factory):
    def work(db, w):
        for minute in range(1, 6):
            seed_event(
                db,
                w.runner,
                at=NOW - timedelta(minutes=minute),
                level="error" if minute % 2 else "info",
                code=f"code-{minute}",
                details={"attempt": minute, "api_key": "leaked"},
            )

    change(session_factory, work)
    page = get(client, "/runner/events", headers=VIEWER, limit=2)
    assert [row["code"] for row in page["events"]] == ["code-1", "code-2"]
    assert (page["total"], page["page"], page["limit"]) == (5, 1, 2)
    assert page["events"][0]["details"] == {"attempt": 1}
    assert page["events"][0]["run_id"] is None
    last = get(client, "/runner/events", limit=2, page=3)
    assert [row["code"] for row in last["events"]] == ["code-5"]
    errors = get(client, "/runner/events", level=["error"])
    assert (
        [row["code"] for row in errors["events"]],
        errors["total"],
        errors["limit"],
    ) == (
        ["code-1", "code-3", "code-5"],
        3,
        10,
    )
    for params in ({"limit": 101}, {"level": "fatal"}, {"page": 0}):
        response = client.get(f"{BASE}/runner/events", headers=MEMBER, params=params)
        refused(response, 422, "validation_error")


# ---------------------------------------------------------------------------
# Everything at once
# ---------------------------------------------------------------------------


def test_a_viewer_reads_every_page_and_no_read_carries_a_token(
    client, session_factory, ids
):
    def work(db, w):
        run = seed_run(
            db,
            w.project,
            w.runner,
            w.target,
            version=w.version,
            status="running",
            user=w.owner,
        )
        seed_questions(db, run, 2)
        seed_log_lines(db, run, 2)
        seed_event(db, w.runner, run=run)
        seed_report(db, run)
        return run.id

    run_id = change(session_factory, work)
    paths = [
        "",
        "/runs",
        "/setup",
        "/datasets",
        f"/dataset-tiers?dataset_version_id={ids.version}",
        f"/runs/{run_id}",
        f"/runs/{run_id}/questions",
        f"/runs/{run_id}/questions.csv",
        f"/runs/{run_id}/log",
        f"/runs/{run_id}/log.txt",
        f"/runs/{run_id}/events",
        f"/runs/{run_id}/report",
        "/targets",
        "/runner",
        "/runner/events",
    ]
    for path in paths:
        for who in (VIEWER, MANAGER):
            response = client.get(BASE + path, headers=who)
            assert response.status_code == 200, (path, response.text)
            assert_no_token_values(response.text)
        assert client.get(BASE + path, headers=OUTSIDER).status_code == 403, path


def test_switched_off_the_pages_are_not_there(client, monkeypatch):
    monkeypatch.setenv("QYM_PERFORMANCE_ENABLED", "false")
    for path in ("", "/runs", "/setup", "/targets", "/runner"):
        assert client.get(BASE + path, headers=MANAGER).status_code == 404
    assert client.post(f"{BASE}/runs", headers=MANAGER, json={}).status_code == 404


def test_an_unknown_project_is_not_found(client):
    response = client.get("/api/projects/missing/performance", headers=MANAGER)
    assert response.status_code == 404
