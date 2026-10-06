"""Review and approval rules (C041, C061, C070, C072, C074).

- C041: scores of a submitted or approved run are locked (403); every edit
  records who/when/from/to and can be reset to the original score; deleting
  passes follows the run-deletion rule and is refused on reviewed runs.
- C061: submitting asks for confirmation (UI) and a bulk submit is one
  request and one transaction.
- C072: managers and admins submit on behalf of the owner, recorded in the
  history; managers can transfer a run to another member.
- C070: editing an approved correction sends it back to PENDING.
- C074: per-project "who can approve corrections" and "require a different
  reviewer", enforced for approve, reject, reset, bulk and the run page.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AuditLog,
    CorrectionStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowEvent,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db

DASHBOARD = ROOT / "packages/platform/qym_platform/_static/dashboard"
ENDED_AT = datetime(2026, 9, 1, 12, 0, 0)

OWNER = "owner@example.com"
MEMBER = "member@example.com"
MANAGER = "manager@example.com"
ADMIN = "admin@example.com"
OUTSIDER = "outsider@example.com"


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as db:
        _seed_people(db)
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _ui(email: str) -> dict:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def _seed_people(db: Session) -> None:
    db.add_all(
        [
            User(id="owner-1", email=OWNER, role=UserRole.MEMBER, display_name="Olive Owner"),
            User(id="member-1", email=MEMBER, role=UserRole.MEMBER, display_name="Mo Member"),
            User(id="manager-1", email=MANAGER, role=UserRole.MEMBER, display_name="Maya Manager"),
            User(id="admin-1", email=ADMIN, role=UserRole.ADMIN, display_name="Ada Admin"),
            User(id="outsider-1", email=OUTSIDER, role=UserRole.MEMBER),
        ]
    )
    db.flush()
    db.add(Project(id="project-1", name="Project", slug="project", created_by_user_id="admin-1"))
    db.flush()
    db.add_all(
        [
            ProjectMembership(project_id="project-1", user_id="owner-1", role=ProjectRole.MEMBER),
            ProjectMembership(project_id="project-1", user_id="member-1", role=ProjectRole.MEMBER),
            ProjectMembership(project_id="project-1", user_id="manager-1", role=ProjectRole.MANAGER),
        ]
    )
    db.commit()


def _run(
    db: Session,
    run_id: str,
    *,
    status=RunWorkflowStatus.COMPLETED,
    samples: int = 1,
    owner: str = "owner-1",
) -> str:
    db.add(
        Run(
            id=run_id,
            project_id="project-1",
            created_by_user_id=owner,
            owner_user_id=owner,
            task="task",
            dataset="dataset",
            metrics=["accuracy"],
            run_metadata={},
            run_config={"run_name": f"Run {run_id}"},
            samples=samples,
            status=status,
            started_at=ENDED_AT - timedelta(minutes=5),
            ended_at=ENDED_AT,
            last_event_at=ENDED_AT,
        )
    )
    db.flush()
    db.add(
        RunItem(
            run_id=run_id,
            item_id="item-1",
            index=0,
            input={"q": "hi"},
            output="out",
            latency_ms=10,
            item_metadata={},
        )
    )
    if samples > 1:
        for number, value in ((1, 1.0), (2, 0.0)):
            db.add(
                RunItemPassScore(
                    run_id=run_id,
                    item_id="item-1",
                    metric_name="accuracy",
                    pass_number=number,
                    score_numeric=value,
                    meta={},
                )
            )
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id="item-1",
                metric_name="accuracy",
                score_numeric=0.5,
                score_raw=0.5,
                meta={"sample_reducer": "mean", "samples_observed": 2},
            )
        )
    else:
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id="item-1",
                metric_name="accuracy",
                score_numeric=0.8,
                score_raw=0.8,
                meta={},
            )
        )
    db.commit()
    return run_id


def _edit(client, run_id, value, email=OWNER, **extra):
    return client.post(
        "/api/runs/update_metric",
        json={"file_path": run_id, "row_index": 0, "metric_name": "accuracy", "new_score": value, **extra},
        headers=_ui(email),
    )


def _reset(client, run_id, email=OWNER, **extra):
    return client.post(
        "/api/runs/update_metric",
        json={"file_path": run_id, "row_index": 0, "metric_name": "accuracy", "reset": True, **extra},
        headers=_ui(email),
    )


def _score(session_factory, run_id):
    with session_factory() as db:
        row = db.query(RunItemScore).filter_by(run_id=run_id, metric_name="accuracy").one()
        return row.score_numeric, dict(row.meta or {})


def _pass_scores(session_factory, run_id):
    with session_factory() as db:
        return {
            p.pass_number: (p.score_numeric, dict(p.meta or {}))
            for p in db.query(RunItemPassScore).filter_by(run_id=run_id)
        }


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# C041: locked scores, edit record, reset to original, pass deletion rule
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status, fragment",
    [
        (RunWorkflowStatus.SUBMITTED, "submitted for approval"),
        (RunWorkflowStatus.APPROVED, "approved run"),
    ],
)
def test_scores_of_a_submitted_or_approved_run_are_locked(client, session_factory, status, fragment):
    with session_factory() as db:
        _run(db, "r1", status=status)
    for email in (OWNER, MANAGER, ADMIN):
        response = _edit(client, "r1", 0.1, email=email)
        assert response.status_code == 403, response.text
        assert "Scores are locked" in response.json()["detail"]
        assert fragment in response.json()["detail"]
        assert response.headers["X-Qym-Run-Status"] == status.value
        assert _reset(client, "r1", email=email).status_code == 403
    assert _score(session_factory, "r1") == (0.8, {})


@pytest.mark.parametrize("status", [RunWorkflowStatus.COMPLETED, RunWorkflowStatus.REJECTED])
def test_scores_stay_editable_outside_review(client, session_factory, status):
    with session_factory() as db:
        _run(db, "r1", status=status)
    _ok(_edit(client, "r1", 0.3))
    assert _score(session_factory, "r1")[0] == pytest.approx(0.3)


def test_each_edit_records_who_when_and_from_what_and_reset_restores_the_original(
    client, session_factory
):
    with session_factory() as db:
        _run(db, "r1")
    _ok(_edit(client, "r1", 0.3))
    row = _ok(_edit(client, "r1", 0.4, email=MEMBER))["row"]
    value, meta = _score(session_factory, "r1")
    assert value == pytest.approx(0.4)
    assert meta["modified"] == "true"
    assert meta["original_score"] == pytest.approx(0.8)
    record = meta["last_edit"]
    assert record["by_user_id"] == "member-1"
    assert record["by"] == "Mo Member"
    assert record["from"] == pytest.approx(0.3)
    assert record["to"] == pytest.approx(0.4)
    assert record["at"]
    # The edit record reaches the page with the row.
    assert row["metric_meta"]["accuracy"]["last_edit"]["by"] == "Mo Member"

    row = _ok(_reset(client, "r1"))["row"]
    assert row["metric_values"] == [pytest.approx(0.8)]
    assert _score(session_factory, "r1") == (pytest.approx(0.8), {})

    with session_factory() as db:
        audits = (
            db.query(AuditLog)
            .filter(AuditLog.entity_id == "r1", AuditLog.action.like("run.score_%"))
            .order_by(AuditLog.id)
            .all()
        )
    assert [(a.action, a.actor_user_id, a.before["score"], a.after["score"]) for a in audits] == [
        ("run.score_edited", "owner-1", pytest.approx(0.8), pytest.approx(0.3)),
        ("run.score_edited", "member-1", pytest.approx(0.3), pytest.approx(0.4)),
        ("run.score_reset", "owner-1", pytest.approx(0.4), pytest.approx(0.8)),
    ]
    assert audits[0].after["metric_name"] == "accuracy"
    assert audits[0].after["item_id"] == "item-1"
    # Nothing left to reset.
    assert _reset(client, "r1").status_code == 409


def test_reset_brings_back_a_scorer_failure_the_edit_replaced(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        score = db.query(RunItemScore).filter_by(run_id="r1").one()
        score.score_numeric = None
        score.score_raw = None
        score.meta = {"status": "error", "error": "judge timed out"}
        db.commit()
    _ok(_edit(client, "r1", 0.9))
    value, meta = _score(session_factory, "r1")
    assert value == pytest.approx(0.9) and "status" not in meta
    _ok(_reset(client, "r1"))
    assert _score(session_factory, "r1") == (None, {"status": "error", "error": "judge timed out"})


def test_reset_of_a_label_score_restores_its_number_too(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        score = db.query(RunItemScore).filter_by(run_id="r1").one()
        score.score_raw = "pass"
        score.score_numeric = 1.0
        db.commit()
    _ok(_edit(client, "r1", 0.0))
    _ok(_reset(client, "r1"))
    with session_factory() as db:
        score = db.query(RunItemScore).filter_by(run_id="r1").one()
        assert (score.score_raw, score.score_numeric, score.meta) == ("pass", 1.0, {})


def test_repeat_run_reset_restores_passes_and_the_item_mean(client, session_factory):
    with session_factory() as db:
        _run(db, "r2", samples=2)
    _ok(_edit(client, "r2", 1.0, pass_number=2, expected_pass_version=0))
    assert _score(session_factory, "r2")[0] == pytest.approx(1.0)
    passes = _pass_scores(session_factory, "r2")
    assert passes[2][0] == pytest.approx(1.0)
    assert passes[2][1]["last_edit"]["pass_number"] == 2

    # Resetting the pass gives it its value back and the item its mean.
    _ok(_reset(client, "r2", pass_number=2, expected_pass_version=0))
    value, meta = _score(session_factory, "r2")
    assert value == pytest.approx(0.5)
    assert "modified" not in meta and "last_edit" not in meta and "pass_2_original" not in meta
    assert _pass_scores(session_factory, "r2")[2] == (pytest.approx(0.0), {})
    assert _reset(client, "r2", pass_number=2, expected_pass_version=0).status_code == 409

    # An item-level edit, then a pass edit, then resetting the item resets all.
    _ok(_edit(client, "r2", 0.9))
    assert _score(session_factory, "r2")[1]["item_edit"] == "true"
    _ok(_edit(client, "r2", 0.5, pass_number=1, expected_pass_version=0))
    _ok(_reset(client, "r2"))
    value, meta = _score(session_factory, "r2")
    assert value == pytest.approx(0.5)
    assert meta == {"sample_reducer": "mean", "samples_observed": 2}
    passes = _pass_scores(session_factory, "r2")
    assert passes[1] == (pytest.approx(1.0), {})
    assert passes[2] == (pytest.approx(0.0), {})


def test_pass_deletion_follows_the_run_deletion_rule(client, session_factory):
    with session_factory() as db:
        _run(db, "r2", samples=2)
    response = client.delete("/api/runs/r2/passes/2", headers=_ui(MEMBER))
    assert response.status_code == 403, response.text
    response = client.request(
        "DELETE", "/api/runs/r2/passes", json={"pass_numbers": [2]}, headers=_ui(MEMBER)
    )
    assert response.status_code == 403, response.text
    assert len(_pass_scores(session_factory, "r2")) == 2
    _ok(client.delete("/api/runs/r2/passes/2", headers=_ui(OWNER)))
    assert set(_pass_scores(session_factory, "r2")) == {1}


@pytest.mark.parametrize("status", [RunWorkflowStatus.SUBMITTED, RunWorkflowStatus.APPROVED])
def test_passes_of_a_reviewed_run_cannot_be_deleted(client, session_factory, status):
    with session_factory() as db:
        _run(db, "r2", samples=2, status=status)
    for email in (OWNER, MANAGER, ADMIN):
        response = client.delete("/api/runs/r2/passes/2", headers=_ui(email))
        assert response.status_code == 409, response.text
        assert response.headers["X-Qym-Run-Status"] == status.value
        response = client.request(
            "DELETE", "/api/runs/r2/passes", json={"pass_numbers": [2]}, headers=_ui(email)
        )
        assert response.status_code == 409, response.text
    assert len(_pass_scores(session_factory, "r2")) == 2
    if status == RunWorkflowStatus.APPROVED:
        assert "Unapprove the run before deleting passes" in response.json()["detail"]


def test_runs_list_offers_no_pass_deletion_on_reviewed_runs():
    """The row's pass delete icon and the bulk Delete follow the server's
    409 on submitted and approved runs instead of offering a refused action."""
    js = (DASHBOARD / "dashboard.js").read_text(encoding="utf-8")
    assert (
        "data-can-delete-pass=\"${canDelete && !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED']"
        ".includes(status) ? 'true' : 'false'}\"" in js
    )
    assert "&& !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED'].includes(run.status || ''));" in js


def test_run_page_locks_scores_and_offers_reset_and_equal_editor_actions():
    run_html = (DASHBOARD / "run.html").read_text(encoding="utf-8")
    compare_html = (DASHBOARD / "compare.html").read_text(encoding="utf-8")
    assert "body.run-scores-locked .metric-edit-open" in run_html
    assert "function applyScoreLockMode()" in run_html
    assert "applyScoreLockMode();" in run_html
    assert "metric-reset-btn" in run_html and "reset: true" in run_html
    assert "scoreEditBadge(passMetricMeta" in run_html
    assert "scoreEditBadge(fullMetricMeta" in run_html
    # The chip editor's save button no longer has its own smaller size: save
    # and cancel share the .qym-metric-edit-action square.
    assert ".chip-edit .metric-edit-save {" not in run_html
    assert "compareRunScoresLocked(runIdx)" in compare_html
    assert "scoreEditTitle(score.meta)" in compare_html
    # Edit bookkeeping is not listed as score metadata.
    assert "['modified', 'original_score']" not in run_html + compare_html


def test_edit_record_stays_in_the_lean_run_index():
    from qym_platform.services.run_payloads import _keep_index_meta_value

    assert _keep_index_meta_value("last_edit", {"by": "x" * 300})
    details_js = (DASHBOARD / "run_details.js").read_text(encoding="utf-8")
    assert "new Set(['error', 'status', 'task_error', 'last_edit'])" in details_js


# ---------------------------------------------------------------------------
# C061 + C072: confirmed, bulk and on-behalf submission; ownership transfer
# ---------------------------------------------------------------------------


def _status(session_factory, run_id):
    with session_factory() as db:
        return db.get(Run, run_id).status


def test_submit_takes_an_optional_comment(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
    _ok(client.post("/v1/runs/r1/submit", json={"comment": "ready for review"}, headers=_ui(OWNER)))
    history = _ok(client.get("/api/runs/r1/review-history", headers=_ui(OWNER)))["events"]
    assert [(e["action"], e["comment"], e["on_behalf_of"]) for e in history] == [
        ("submit", "ready for review", None)
    ]
    # Old clients post without a body.
    with session_factory() as db:
        _run(db, "r3")
    _ok(client.post("/v1/runs/r3/submit", headers=_ui(OWNER)))


@pytest.mark.parametrize("email, actor", [(MANAGER, "manager-1"), (ADMIN, "admin-1")])
def test_managers_and_admins_submit_on_behalf_of_the_owner(client, session_factory, email, actor):
    with session_factory() as db:
        _run(db, "r1")
    _ok(client.post("/v1/runs/r1/submit", json={}, headers=_ui(email)))
    assert _status(session_factory, "r1") == RunWorkflowStatus.SUBMITTED
    history = _ok(client.get("/api/runs/r1/review-history", headers=_ui(OWNER)))["events"]
    assert history[0]["actor"]["id"] == actor
    assert history[0]["on_behalf_of"]["id"] == "owner-1"
    with session_factory() as db:
        event = db.query(RunWorkflowEvent).filter_by(run_id="r1").one()
        assert event.on_behalf_of_user_id == "owner-1"
        audit = db.query(AuditLog).filter_by(action="run.submitted", entity_id="r1").one()
        assert audit.after["on_behalf_of_user_id"] == "owner-1"


@pytest.mark.parametrize("email", [MEMBER, OUTSIDER])
def test_other_members_still_cannot_submit(client, session_factory, email):
    with session_factory() as db:
        _run(db, "r1")
    response = client.post("/v1/runs/r1/submit", headers=_ui(email))
    assert response.status_code == 403, response.text
    assert _status(session_factory, "r1") == RunWorkflowStatus.COMPLETED


def test_bulk_submit_is_one_transaction(client, session_factory):
    with session_factory() as db:
        _run(db, "a1")
        _run(db, "a2", status=RunWorkflowStatus.REJECTED)
        _run(db, "a3", status=RunWorkflowStatus.APPROVED)
    # One run that cannot be submitted refuses the request; nothing changes.
    response = client.post(
        "/v1/runs/submit", json={"run_ids": ["a1", "a2", "a3"], "comment": "batch"}, headers=_ui(OWNER)
    )
    assert response.status_code == 409, response.text
    assert "Run a3" in response.json()["detail"]
    assert "No runs were submitted" in response.json()["detail"]
    assert _status(session_factory, "a1") == RunWorkflowStatus.COMPLETED
    assert _status(session_factory, "a2") == RunWorkflowStatus.REJECTED
    with session_factory() as db:
        assert db.query(RunWorkflowEvent).count() == 0

    body = _ok(
        client.post(
            "/v1/runs/submit", json={"run_ids": ["a2", "a1", "a1"], "comment": "batch"}, headers=_ui(OWNER)
        )
    )
    assert body["submitted"] == ["a1", "a2"]
    assert _status(session_factory, "a1") == RunWorkflowStatus.SUBMITTED
    assert _status(session_factory, "a2") == RunWorkflowStatus.SUBMITTED
    with session_factory() as db:
        events = db.query(RunWorkflowEvent).filter_by(action="submit").all()
        assert sorted((e.run_id, e.comment) for e in events) == [("a1", "batch"), ("a2", "batch")]


def test_bulk_submit_checks_each_runs_owner(client, session_factory):
    with session_factory() as db:
        _run(db, "b1")
        _run(db, "b2", owner="member-1")
    response = client.post("/v1/runs/submit", json={"run_ids": ["b1", "b2"]}, headers=_ui(OWNER))
    assert response.status_code == 403, response.text
    assert _status(session_factory, "b1") == RunWorkflowStatus.COMPLETED
    _ok(client.post("/v1/runs/submit", json={"run_ids": ["b1", "b2"]}, headers=_ui(MANAGER)))
    assert _status(session_factory, "b2") == RunWorkflowStatus.SUBMITTED


@pytest.mark.parametrize(
    "body", [{}, {"run_ids": []}, {"run_ids": "a1"}, {"run_ids": [1]}, {"run_ids": ["missing"]}]
)
def test_bulk_submit_validates_its_input(client, session_factory, body):
    response = client.post("/v1/runs/submit", json=body, headers=_ui(OWNER))
    assert response.status_code in (400, 404), response.text


def test_managers_transfer_ownership(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
    response = client.post("/v1/runs/r1/owner", json={"user_id": "member-1"}, headers=_ui(OWNER))
    assert response.status_code == 403, response.text
    response = client.post("/v1/runs/r1/owner", json={"user_id": "outsider-1"}, headers=_ui(MANAGER))
    assert response.status_code == 400, response.text
    body = _ok(client.post("/v1/runs/r1/owner", json={"user_id": "member-1"}, headers=_ui(MANAGER)))
    assert body["owner"]["id"] == "member-1"
    with session_factory() as db:
        assert db.get(Run, "r1").owner_user_id == "member-1"
        audit = db.query(AuditLog).filter_by(action="run.owner_transferred").one()
        assert (audit.before, audit.after, audit.actor_user_id) == (
            {"owner_user_id": "owner-1"},
            {"owner_user_id": "member-1"},
            "manager-1",
        )
    # The new owner now submits it; the old one no longer can.
    assert client.post("/v1/runs/r1/submit", headers=_ui(OWNER)).status_code == 403
    _ok(client.post("/v1/runs/r1/submit", headers=_ui(MEMBER)))


def test_runs_list_confirms_submission_and_offers_manager_actions():
    js = (DASHBOARD / "dashboard.js").read_text(encoding="utf-8")
    index = (DASHBOARD / "index.html").read_text(encoding="utf-8")
    # The row icon and the bulk button open the confirmation, never POST directly.
    assert "showWorkflowModal('submit', run.run_id, name, { runs: [run] });" in js
    assert "showWorkflowModal('submit', null, '', { runs: selectedRuns });" in js
    assert "apiUrl('v1/runs/submit')" in js
    assert "for (const run of submittable)" not in js
    assert "canSubmit = writable && (isOwner || isProjectManager)" in js
    assert "Transfer ownership" in js and 'id="transfer-modal"' in index


# ---------------------------------------------------------------------------
# C070 + C074: corrections
# ---------------------------------------------------------------------------


def _correction(
    db: Session,
    *,
    run_id: str = "r1",
    author: str | None = "member-1",
    human: str = "Retrieval miss",
    ai: str = "",
    status=CorrectionStatus.PENDING,
    reviewer: str | None = None,
) -> int:
    correction = ReviewCorrection(
        run_id=run_id,
        item_id="item-1",
        metric_name=None,
        task="task",
        ai_root_cause=ai,
        ai_root_causes=[ai] if ai else [],
        human_root_cause=human,
        human_root_causes=[human] if human else [],
        corrected_by_user_id=author,
        is_active=True,
        status=status,
        reviewed_by_user_id=reviewer,
        reviewed_at=datetime(2026, 9, 2) if reviewer else None,
        created_at=datetime(2026, 9, 1),
    )
    db.add(correction)
    db.commit()
    return correction.id


def _rules(client, email=MANAGER, **rules):
    return client.patch("/v1/projects/project-1/review-rules", json=rules, headers=_ui(email))


def _correction_status(session_factory, correction_id):
    with session_factory() as db:
        return db.get(ReviewCorrection, correction_id).status


def test_review_rules_default_to_all_members_without_a_second_reviewer(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        cid = _correction(db)
    project = _ok(client.get("/v1/projects/by-slug/project", headers=_ui(MEMBER)))
    assert project["correction_approvers"] == "members"
    assert project["correction_require_different_reviewer"] is False
    # Default: any member, the author included, may decide (as before).
    body = _ok(client.post(f"/api/corrections/{cid}/approve", json={}, headers=_ui(MEMBER)))
    assert body["status"] == "approved"
    assert body["self_reviewed"] is True


def test_only_managers_change_the_review_rules(client, session_factory):
    assert _rules(client, MEMBER, correction_approvers="managers").status_code == 403
    assert _rules(client, MANAGER, correction_approvers="everyone").status_code == 422
    body = _ok(_rules(client, MANAGER, correction_approvers="managers", correction_require_different_reviewer=True))
    assert body == {
        "project_id": "project-1",
        "correction_approvers": "managers",
        "correction_require_different_reviewer": True,
    }
    with session_factory() as db:
        audit = db.query(AuditLog).filter_by(action="project.review_rules_updated").one()
        assert audit.before == {"correction_approvers": "members", "correction_require_different_reviewer": False}
        assert audit.after["correction_approvers"] == "managers"
    _ok(_rules(client, ADMIN, correction_approvers="members"))


def test_managers_only_rule_covers_approve_reject_reset_and_bulk(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        pending = _correction(db, author="owner-1")
        approved = _correction(db, author="owner-1", status=CorrectionStatus.APPROVED, reviewer="manager-1")
    _ok(_rules(client, correction_approvers="managers"))
    for path, body in (
        (f"/api/corrections/{pending}/approve", {}),
        (f"/api/corrections/{pending}/reject", {"comment": "no"}),
        (f"/api/corrections/{approved}/reset", None),
        ("/api/corrections/bulk", {"ids": [pending], "action": "approve"}),
        ("/api/corrections/bulk", {"ids": [pending], "action": "reject"}),
        ("/api/corrections/bulk", {"ids": [approved], "action": "reset"}),
    ):
        response = client.post(path, json=body, headers=_ui(MEMBER))
        assert response.status_code == 403, (path, response.text)
        assert "Only project managers and admins" in response.json()["detail"]
    assert _correction_status(session_factory, pending) == CorrectionStatus.PENDING
    assert _correction_status(session_factory, approved) == CorrectionStatus.APPROVED

    # The run page's approvals follow the same rule.
    response = client.post(
        "/api/corrections/approve-metric-analysis",
        json={"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy"},
        headers=_ui(MEMBER),
    )
    assert response.status_code == 403, response.text
    response = client.post(
        "/api/runs/update_root_cause_issue",
        json={"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy", "action": "approve", "issue_id": "x"},
        headers=_ui(MEMBER),
    )
    assert response.status_code == 403, response.text

    _ok(client.post("/api/corrections/bulk", json={"ids": [pending], "action": "approve"}, headers=_ui(MANAGER)))
    assert _correction_status(session_factory, pending) == CorrectionStatus.APPROVED
    # (Approving it superseded the older approval of the same item.)
    _ok(client.post(f"/api/corrections/{pending}/reset", headers=_ui(ADMIN)))


def test_a_refused_correction_refuses_the_whole_bulk_request(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        mine = _correction(db, author="member-1")
        theirs = _correction(db, author="owner-1")
    _ok(_rules(client, correction_require_different_reviewer=True))
    response = client.post(
        "/api/corrections/bulk", json={"ids": [theirs, mine], "action": "approve"}, headers=_ui(MEMBER)
    )
    assert response.status_code == 403, response.text
    assert _correction_status(session_factory, theirs) == CorrectionStatus.PENDING
    assert _correction_status(session_factory, mine) == CorrectionStatus.PENDING


def test_different_reviewer_rule_blocks_only_the_author(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        cid = _correction(db, author="member-1")
        ai_taken_as_is = _correction(db, author="member-1", human="", ai="Context missing")
    _ok(_rules(client, correction_require_different_reviewer=True))
    for path, body in (
        (f"/api/corrections/{cid}/approve", {}),
        (f"/api/corrections/{cid}/reject", {}),
    ):
        response = client.post(path, json=body, headers=_ui(MEMBER))
        assert response.status_code == 403, response.text
        assert "different reviewer" in response.json()["detail"]
    # Admins are authors too: the rule names the person, not the role.
    with session_factory() as db:
        admin_cid = _correction(db, author="admin-1")
    assert client.post(f"/api/corrections/{admin_cid}/approve", json={}, headers=_ui(ADMIN)).status_code == 403
    # Someone else may decide it.
    body = _ok(client.post(f"/api/corrections/{cid}/approve", json={}, headers=_ui(OWNER)))
    assert body["self_reviewed"] is False
    # The author may not reset someone else's decision on their own correction.
    assert client.post(f"/api/corrections/{cid}/reset", headers=_ui(MEMBER)).status_code == 403
    # An AI diagnosis taken as is has no human author: whoever started the
    # analysis may approve it, and approving does not make it "self-approved".
    body = _ok(client.post(f"/api/corrections/{ai_taken_as_is}/approve", json={}, headers=_ui(MEMBER)))
    assert body["self_reviewed"] is False


def test_reviews_list_names_the_rule_that_blocks_the_viewer(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        cid = _correction(db, author="member-1")
        _correction(db, author="owner-1", status=CorrectionStatus.APPROVED, reviewer="owner-1")
    _ok(_rules(client, correction_require_different_reviewer=True))
    listing = _ok(client.get("/api/corrections", headers=_ui(MEMBER)))["corrections"]
    by_id = {c["id"]: c for c in listing}
    assert "different reviewer" in by_id[cid]["review_block"]
    assert by_id[cid]["review_rules"]["correction_require_different_reviewer"] is True
    others = [c for c in listing if c["id"] != cid]
    assert [c["review_block"] for c in others] == [None]
    assert [c["self_reviewed"] for c in others] == [True]

    _ok(_rules(client, correction_approvers="managers"))
    listing = _ok(client.get("/api/corrections", headers=_ui(OWNER)))["corrections"]
    assert {c["review_block"] for c in listing} == {
        "Only project managers and admins can approve, reject or reset corrections in this project"
    }
    listing = _ok(client.get("/api/corrections", headers=_ui(MANAGER)))["corrections"]
    assert {c["review_block"] for c in listing} == {None}


def test_authors_delete_their_own_corrections_others_need_decision_rights(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        mine = _correction(db, author="member-1")
        theirs = _correction(db, author="owner-1")
    _ok(_rules(client, correction_approvers="managers"))
    assert client.delete(f"/api/corrections/{theirs}", headers=_ui(MEMBER)).status_code == 403
    response = client.post(
        "/api/corrections/bulk", json={"ids": [theirs], "action": "delete"}, headers=_ui(MEMBER)
    )
    assert response.status_code == 403
    _ok(client.delete(f"/api/corrections/{mine}", headers=_ui(MEMBER)))
    _ok(client.delete(f"/api/corrections/{theirs}", headers=_ui(MANAGER)))


def test_editing_an_approved_correction_returns_it_to_pending(client, session_factory):
    """C070: the edit is new text nobody reviewed; no reviewer fields are copied."""
    from qym_platform.services.root_cause_changes import apply_root_cause_change

    with session_factory() as db:
        _run(db, "r1")
        run = db.get(Run, "r1")
        item = db.query(RunItem).filter_by(run_id="r1").one()
        first = apply_root_cause_change(
            db, run=run, item=item, actor_user_id="owner-1", actor_source="human",
            human_patch={"root_cause": "Retrieval miss", "root_cause_note": "checked"},
        ).candidate
        db.commit()
        first_id = first.id
    _ok(client.post(f"/api/corrections/{first_id}/approve", json={"comment": "Checked the trace, correct"}, headers=_ui(MANAGER)))
    edited = _ok(
        client.put(
            f"/api/corrections/{first_id}",
            json={"human_root_cause": "Metric bug", "human_root_cause_note": "ignore this item"},
            headers=_ui(MEMBER),
        )
    )
    assert edited["id"] != first_id
    assert edited["status"] == "pending"
    assert edited["reviewed_by"] is None
    assert edited["review_comment"] == ""
    assert edited["corrected_by"]["id"] == "member-1"
    with session_factory() as db:
        old = db.get(ReviewCorrection, first_id)
        assert old.is_active is False
        assert (old.reviewed_by_user_id, old.review_comment) == ("manager-1", "Checked the trace, correct")


def test_reviews_page_disables_blocked_decisions_with_the_rule_and_equal_buttons():
    html = (DASHBOARD / "reviews.html").read_text(encoding="utf-8")
    assert "function renderDecisionActions(c, st, block)" in html
    assert "review-decision-rule" in html and "title=\"${escapeHtml(block)}\"" in html
    assert "Self-approved" in html
    assert "refuseBlockedSelection(ids)" in html
    # Approve and reject are the same square with the same icon size.
    assert "&#10003;</button>" not in html and "&#10007;</button>" not in html
    assert ".card-actions .review-decision {" in html
    settings = (DASHBOARD / "project_settings.html").read_text(encoding="utf-8")
    assert 'id="review-approvers"' in settings and 'id="review-different-reviewer"' in settings
    assert "v1/projects/${state.project.id}/review-rules" in settings


def test_review_rules_migration_is_quick_ddl_and_reversible(monkeypatch):
    import importlib.util

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = ROOT / "packages/platform/qym_platform/migrations/versions/0067_review_rules.py"
    spec = importlib.util.spec_from_file_location("migration_0067", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert (migration.revision, migration.down_revision) == ("0067", "0066")

    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    projects = sa.Table("projects", metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table("run_workflow_events", metadata, sa.Column("id", sa.Integer, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(projects.insert().values(id="p"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        row = connection.execute(
            sa.text("SELECT correction_approvers, correction_require_different_reviewer FROM projects")
        ).one()
        # Existing projects keep today's behaviour.
        assert row[0] == "members" and not row[1]
        columns = {c["name"]: c for c in sa.inspect(connection).get_columns("run_workflow_events")}
        assert columns["on_behalf_of_user_id"]["nullable"] is True
        migration.downgrade()
        inspector = sa.inspect(connection)
        assert "correction_approvers" not in {c["name"] for c in inspector.get_columns("projects")}
        assert "on_behalf_of_user_id" not in {
            c["name"] for c in inspector.get_columns("run_workflow_events")
        }
    engine.dispose()


# ---------------------------------------------------------------------------
# Review follow-ups: the run page's approvals judge the real author
# ---------------------------------------------------------------------------


def test_classic_score_edits_hold_the_run_lock_that_submit_takes(
    client, session_factory, monkeypatch
):
    """The lock check runs under the run row lock, so an edit racing a
    submit waits for it and then sees SUBMITTED (C041)."""
    import qym_platform.api.runs as runs_api

    locked = []
    real_lock = runs_api.lock_review_run

    def recording_lock(db, run_id):
        run = real_lock(db, run_id)
        locked.append((run_id, run.status))
        return run

    monkeypatch.setattr(runs_api, "lock_review_run", recording_lock)
    with session_factory() as db:
        _run(db, "r1")
    _ok(_edit(client, "r1", 0.3))
    _ok(_reset(client, "r1"))
    assert locked == [("r1", RunWorkflowStatus.COMPLETED)] * 2


def _human_analysis_item(db: Session, run_id: str = "r1") -> None:
    item = db.query(RunItem).filter_by(run_id=run_id).one()
    item.item_metadata = {
        "metric_analyses": {"accuracy": {"root_cause": "Retrieval miss", "source": "human"}}
    }
    db.commit()


def test_run_page_approval_of_a_human_analysis_without_a_record_is_not_self_review(
    client, session_factory
):
    """A saved human analysis with no correction row yet has no known author.

    The approval creates the row with the approver as ``corrected_by``; the
    different-reviewer rule must not then call that a self-review.
    """
    with session_factory() as db:
        _run(db, "r1")
        _human_analysis_item(db)
    _ok(_rules(client, correction_require_different_reviewer=True))
    body = _ok(
        client.post(
            "/api/corrections/approve-metric-analysis",
            json={"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy"},
            headers=_ui(OWNER),
        )
    )
    assert body["status"] == "approved"


def _legacy_pass_review(db: Session, author: str = "member-1") -> None:
    pass_score = db.query(RunItemPassScore).filter_by(run_id="r2", pass_number=1).one()
    pass_score.meta = {"root_cause_analysis": {"root_cause": "Retrieval miss", "source": "human"}}
    db.add(
        ReviewCorrection(
            run_id="r2",
            item_id="item-1",
            metric_name="accuracy",
            pass_number=1,
            task="task",
            ai_root_cause="",
            human_root_cause="Retrieval miss",
            human_root_causes=["Retrieval miss"],
            corrected_by_user_id=author,
            is_active=True,
            status=CorrectionStatus.PENDING,
            created_at=datetime(2026, 9, 1),
        )
    )
    db.commit()


def test_run_page_approval_of_a_legacy_pass_review_judges_its_author(client, session_factory):
    """A legacy grouped review is split on approval; the split rows are
    written by the approver, so the rule must judge the original author."""
    with session_factory() as db:
        _run(db, "r2", samples=2)
        _legacy_pass_review(db)
    _ok(_rules(client, correction_require_different_reviewer=True))
    request = {
        "run_id": "r2",
        "item_id": "item-1",
        "metric_name": "accuracy",
        "pass_number": 1,
        "expected_pass_version": 0,
    }
    response = client.post(
        "/api/corrections/approve-metric-analysis", json=request, headers=_ui(MEMBER)
    )
    assert response.status_code == 403, response.text
    assert "different reviewer" in response.json()["detail"]
    _ok(client.post("/api/corrections/approve-metric-analysis", json=request, headers=_ui(OWNER)))


def test_run_page_issue_approval_of_a_legacy_review_judges_its_author(client, session_factory):
    """An issue without its own review row (a legacy grouped review) is
    approved by index; the rule judges the grouped review's author."""
    with session_factory() as db:
        _run(db, "r1")
        item = db.query(RunItem).filter_by(run_id="r1").one()
        item.item_metadata = {
            "metric_analyses": {
                "accuracy": {
                    "root_cause": "Retrieval miss",
                    "source": "human",
                    "root_cause_issues": [{"category": "Retrieval miss", "source": "human"}],
                }
            }
        }
        db.add(
            ReviewCorrection(
                run_id="r1",
                item_id="item-1",
                metric_name="accuracy",
                task="task",
                ai_root_cause="",
                human_root_cause="Retrieval miss",
                human_root_causes=["Retrieval miss"],
                corrected_by_user_id="member-1",
                is_active=True,
                status=CorrectionStatus.PENDING,
                created_at=datetime(2026, 9, 1),
            )
        )
        db.commit()
    _ok(_rules(client, correction_require_different_reviewer=True))
    request = {
        "run_id": "r1",
        "item_id": "item-1",
        "metric_name": "accuracy",
        "action": "approve",
        "issue_id": None,
        "issue_index": 0,
        "expected_issue": {"category": "Retrieval miss"},
    }
    response = client.post("/api/runs/update_root_cause_issue", json=request, headers=_ui(MEMBER))
    assert response.status_code == 403, response.text
    assert "different reviewer" in response.json()["detail"]
    _ok(client.post("/api/runs/update_root_cause_issue", json=request, headers=_ui(OWNER)))


def _two_issue_analysis(db: Session, issues: list) -> None:
    item = db.query(RunItem).filter_by(run_id="r1").one()
    item.item_metadata = {
        "metric_analyses": {
            "accuracy": {"root_cause": issues[0]["category"], "source": "human", "root_cause_issues": issues}
        }
    }


def _legacy_two_issue_review(db: Session, author: str = "member-1") -> int:
    """A grouped review of two issues without IDs, as stored before C074."""
    _two_issue_analysis(db, [{"category": "A", "source": "human"}, {"category": "B", "source": "human"}])
    review = ReviewCorrection(
        run_id="r1",
        item_id="item-1",
        metric_name="accuracy",
        task="task",
        ai_root_cause="",
        human_root_cause="A",
        human_root_causes=["A", "B"],
        human_root_cause_issues=[{"category": "A"}, {"category": "B"}],
        corrected_by_user_id=author,
        is_active=True,
        status=CorrectionStatus.PENDING,
        created_at=datetime(2026, 9, 1),
    )
    db.add(review)
    db.commit()
    return review.id


def _issue_request(action: str, index: int, category: str) -> dict:
    return {
        "run_id": "r1",
        "item_id": "item-1",
        "metric_name": "accuracy",
        "action": action,
        "issue_id": None,
        "issue_index": index,
        "expected_issue": {"category": category},
    }


def test_run_page_issue_removal_follows_the_correction_delete_rule(client, session_factory):
    """Removing an issue deletes its correction: the same rule as DELETE (C074)."""
    with session_factory() as db:
        _run(db, "r1")
        legacy_id = _legacy_two_issue_review(db, author="member-1")
    _ok(_rules(client, correction_approvers="managers"))
    whole_list = {
        "run_id": "r1",
        "item_id": "item-1",
        "metric_name": "accuracy",
        "root_cause_issues": [{"category": "B"}],
    }
    for path, body in (
        ("/api/runs/update_root_cause_issue", _issue_request("delete", 0, "A")),
        ("/api/runs/update_root_cause", whole_list),
    ):
        response = client.post(path, json=body, headers=_ui(OWNER))
        assert response.status_code == 403, response.text
        assert "delete corrections written by someone else" in response.json()["detail"]
    with session_factory() as db:
        legacy = db.get(ReviewCorrection, legacy_id)
        assert (legacy.is_active, legacy.status) == (True, CorrectionStatus.PENDING)
    _ok(client.post("/api/runs/update_root_cause_issue", json=_issue_request("delete", 0, "A"), headers=_ui(MANAGER)))


def test_an_edit_next_to_a_removal_needs_only_the_removal_right(client, session_factory):
    """Compare sends issue IDs, so editing A while removing B judges B alone."""
    with session_factory() as db:
        _run(db, "r1")
        _two_issue_analysis(db, [
            {"issue_id": "a", "category": "A", "source": "human", "review_status": "pending"},
            {"issue_id": "b", "category": "B", "source": "human", "review_status": "pending"},
        ])
        for issue_id, category, author in (("a", "A", "member-1"), ("b", "B", "owner-1")):
            db.add(ReviewCorrection(
                run_id="r1", item_id="item-1", metric_name="accuracy", task="task",
                ai_root_cause="", human_root_cause=category, human_root_causes=[category],
                human_root_cause_issues=[{"issue_id": issue_id, "category": category}],
                corrected_by_user_id=author, is_active=True, status=CorrectionStatus.PENDING,
                created_at=datetime(2026, 9, 1),
            ))
        db.commit()
    _ok(_rules(client, correction_approvers="managers"))
    request = {"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy"}
    # Removing someone else's issue A is refused...
    response = client.post(
        "/api/runs/update_root_cause",
        json={**request, "root_cause_issues": [{"issue_id": "b", "category": "B"}]},
        headers=_ui(OWNER),
    )
    assert response.status_code == 403, response.text
    # ...but editing it while withdrawing one's own B is not.
    row = _ok(client.post(
        "/api/runs/update_root_cause",
        json={**request, "root_cause_issues": [{"issue_id": "a", "category": "A2"}]},
        headers=_ui(OWNER),
    ))["row"]
    issues = row["item_metadata"]["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert [(issue["issue_id"], issue["category"]) for issue in issues] == [("a", "A2")]


def test_splitting_a_legacy_review_keeps_its_author(client, session_factory):
    """Approving one issue splits the grouped review; the unchanged sibling
    still belongs to its writer, so the different-reviewer rule holds."""
    with session_factory() as db:
        _run(db, "r1")
        _legacy_two_issue_review(db, author="member-1")
    _ok(_rules(client, correction_require_different_reviewer=True))
    _ok(client.post("/api/runs/update_root_cause_issue", json=_issue_request("approve", 0, "A"), headers=_ui(MANAGER)))
    with session_factory() as db:
        sibling = db.query(ReviewCorrection).filter_by(is_active=True, status=CorrectionStatus.PENDING).one()
        assert (sibling.corrected_by_user_id, sibling.created_at) == ("member-1", datetime(2026, 9, 1))
    response = client.post(
        "/api/runs/update_root_cause_issue", json=_issue_request("approve", 1, "B"), headers=_ui(MEMBER)
    )
    assert response.status_code == 403, response.text
    assert "different reviewer" in response.json()["detail"]
    _ok(client.post("/api/runs/update_root_cause_issue", json=_issue_request("approve", 1, "B"), headers=_ui(MANAGER)))


def test_a_solution_note_edit_makes_its_writer_the_author():
    from qym_platform.services.correction_rules import correction_author_id

    def review(human_note: str) -> ReviewCorrection:
        return ReviewCorrection(
            corrected_by_user_id="member-1",
            ai_root_cause="Retrieval miss",
            ai_root_causes=["Retrieval miss"],
            ai_solution_note="Check the index",
            human_root_cause="Retrieval miss",
            human_root_causes=["Retrieval miss"],
            human_solution_note=human_note,
        )

    assert correction_author_id(review("Rebuild the index")) == "member-1"
    # A copied AI note, or none, is still the AI's text.
    assert correction_author_id(review(" Check the index ")) is None
    assert correction_author_id(review("")) is None


def test_reset_of_an_edit_made_before_numbers_were_saved(client, session_factory):
    """Older edits saved only the raw value: read it, or refuse and change nothing."""
    def seed(original):
        with session_factory() as db:
            score = db.query(RunItemScore).filter_by(run_id="r1").one()
            score.score_raw = score.score_numeric = 0.3
            score.meta = {"modified": "true", "original_score": original}
            db.commit()

    with session_factory() as db:
        _run(db, "r1")
    seed("85%")
    _ok(_reset(client, "r1"))
    with session_factory() as db:
        score = db.query(RunItemScore).filter_by(run_id="r1").one()
        assert (score.score_raw, score.score_numeric) == ("85%", pytest.approx(0.85))
    seed("pass")
    response = _reset(client, "r1")
    assert response.status_code == 409, response.text
    assert _score(session_factory, "r1") == (pytest.approx(0.3), {"modified": "true", "original_score": "pass"})
