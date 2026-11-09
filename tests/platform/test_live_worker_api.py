"""Worker UI controls, permissions and secret-safe responses on both databases."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Query
from test_live_worker_settings import SECRETS, session_factory, values  # noqa: F401

from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    LiveDay,
    LiveJob,
    LiveSource,
    LiveTurn,
    LiveWorkerEvent,
    LiveWorkerSettings,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.services import live_worker_settings
from qym_platform.services.live_ingest import record_heartbeat

ADMIN = {"X-User-Email": "owner@example.test"}
BASE = "/api/projects/test/live/worker"
NOW = datetime(2026, 11, 3, 22)
JOB = {
    "kind": "backfill",
    "since_day": "2026-01-01",
    "until_day": "2026-01-31",
    "limit": 2000,
}
WRITES = [
    ("PUT", "/state", {"state": "paused"}),
    ("PUT", "/key", {"api_key_id": None}),
    ("POST", "/settings", {"values": {}}),
    ("POST", "/settings/1/restore", None),
    ("POST", "/jobs", JOB),
    ("POST", "/jobs/missing/cancel", None),
]


@pytest.fixture(autouse=True)
def auth(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setattr("qym_platform.services.live_overview.utcnow", lambda: NOW)


def read(client, **params):
    response = client.get(BASE, headers=ADMIN, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def save(client, values, **extra):
    return client.post(
        BASE + "/settings", headers=ADMIN, json={"values": values, **extra}
    )


def assert_safe(value):
    content = json.dumps(value)
    for secret in [*SECRETS.values(), "gateway-secret"]:
        assert secret not in content
    assert "secrets_encrypted" not in content
    assert "key_hash" not in content


@pytest.mark.parametrize(
    "control, running, model_ids",
    [
        ("legacy", None, []),
        ({}, {}, []),
        ({"models": "legacy"}, {"models": "legacy"}, []),
        ({"models": {"ids": "judge-a"}}, {"models": {"ids": "judge-a"}}, []),
        (
            {"models": {"ids": ["judge-a", 1]}},
            {"models": {"ids": ["judge-a", 1]}},
            [],
        ),
        (
            {"models": {"ids": ["judge-a"]}},
            {"models": {"ids": ["judge-a"]}},
            ["judge-a"],
        ),
    ],
)
def test_read_defensive_worker_metadata(
    client, session_factory, control, running, model_ids
):
    with session_factory() as db:
        record_heartbeat(
            db, db.get(LiveSource, "source"), NOW, None, None, {"control": control}, NOW
        )
        db.commit()
    body = read(client)
    assert body["running"] == running
    assert body["model_ids"] == model_ids


def test_read_without_version_and_with_version(client, session_factory, values):
    body = read(client)
    assert body == {
        "state": {"desired": "running", "changed_at": None, "changed_by": None},
        "running": None,
        "worker": {},
        "stale": True,
        "status": {
            "desired_state": "running",
            "worker_key_set": False,
            "errors_last_hour": 0,
            "id": "source",
            "key": "worker",
            "name": "Worker",
            "environment": "test",
            "product": None,
            "day_key_timezone": "UTC",
            "stale": True,
            "seconds_since_heartbeat": None,
            "last_heartbeat_at": None,
            "last_poll_at": None,
            "last_turn_at": None,
            "worker": {},
        },
        "today": {
            "day": "2026-11-03",
            "turns_seen": 0,
            "evaluated": 0,
            "failed": 0,
            "in_qym": 0,
        },
        "worker_key": None,
        "api_keys": [],
        "settings": None,
        "versions": [],
        "jobs": [],
        "connections": [
            {
                "id": "connection",
                "name": "Gateway",
                "base_url": "https://gateway.example/v1",
                "api_key_last4": "",
            }
        ],
        "model_ids": [],
    }
    assert save(client, values, secrets=SECRETS).status_code == 201
    control = {
        "models": {"ids": ["judge-a"]},
        "settings_version_applied": 1,
        "verification": {
            "version": 1,
            "checks": {
                "database.connect": "ok",
                "langfuse.auth": "ok",
                "gateway.models": "ok",
                "dataiku.auth": "ok",
            },
        },
    }
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        record_heartbeat(
            db,
            source,
            NOW,
            NOW - timedelta(seconds=30),
            None,
            {"control": control, "worker_version": "2", "eval_code_version": "abc"},
            NOW,
        )
        # Many distinct creators make accidental per-row lookups visible.
        for i in range(55):
            db.add(
                User(
                    id=f"creator-{i}",
                    email=f"creator-{i}@test",
                    display_name=f"Creator {i}",
                    role=UserRole.MEMBER,
                )
            )
        db.flush()
        for i in range(55):
            db.add(
                LiveWorkerSettings(
                    source_id=source.id,
                    version=i + 2,
                    values=values,
                    secret_hints={"database_password": "5678"},
                    secrets_encrypted={},
                    created_by_user_id=f"creator-{i}",
                )
            )
            db.add(
                LiveJob(
                    source_id=source.id,
                    kind="backfill",
                    status="done",
                    requested_by_user_id=f"creator-{i}",
                    requested_at=NOW + timedelta(seconds=i),
                    updated_at=NOW + timedelta(minutes=1, seconds=i),
                )
            )
        db.commit()
        engine = db.get_bind()
    user_queries = []

    def count_users(conn, cursor, statement, parameters, context, many):
        if statement.lstrip().startswith("SELECT") and "FROM users" in statement:
            user_queries.append(statement)

    event.listen(engine, "before_cursor_execute", count_users)
    try:
        body = read(client, source="worker")
    finally:
        event.remove(engine, "before_cursor_execute", count_users)
    assert body["running"] == control
    assert body["worker"] == {
        "control": control,
        "worker_version": "2",
        "eval_code_version": "abc",
    }
    assert body["stale"] is False
    assert body["status"]["stale"] is False
    assert body["status"]["last_heartbeat_at"] == "2026-11-03T22:00:00Z"
    assert body["status"]["last_poll_at"] == "2026-11-03T21:59:30Z"
    assert body["status"]["worker"] == body["worker"]
    assert body["model_ids"] == ["judge-a"]
    assert body["settings"]["version"] == 56
    assert body["settings"]["created_by"] == "Creator 54"
    assert [v["version"] for v in body["versions"]] == list(range(56, 6, -1))
    assert len(body["jobs"]) == 20
    assert [j["requested_by"] for j in body["jobs"]] == [
        f"Creator {i}" for i in range(54, 34, -1)
    ]
    assert [j["updated_at"] for j in body["jobs"]] == [
        f"2026-11-03T22:01:{i:02d}Z" for i in range(54, 34, -1)
    ]
    assert len(user_queries) <= 3, user_queries
    assert_safe(body)
    assert (
        client.get(BASE, headers=ADMIN, params={"source": "missing"}).status_code == 404
    )


@pytest.mark.parametrize("jobs_limit", [1, 50, 200])
def test_read_jobs_limit(client, session_factory, jobs_limit):
    with session_factory() as db:
        for i in range(205):
            db.add(
                LiveJob(
                    id=f"job-{i}",
                    source_id="source",
                    kind="backfill",
                    status="done",
                    requested_at=NOW + timedelta(seconds=i),
                )
            )
        db.commit()
    jobs = read(client, jobs_limit=jobs_limit)["jobs"]
    assert [job["id"] for job in jobs] == [
        f"job-{i}" for i in range(204, 204 - jobs_limit, -1)
    ]


@pytest.mark.parametrize("jobs_limit", [0, 201])
def test_read_jobs_limit_bounds(client, jobs_limit):
    response = client.get(BASE, headers=ADMIN, params={"jobs_limit": jobs_limit})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("with_day", [False, True])
@pytest.mark.parametrize(
    "zone", ["Asia/Riyadh", "UTC", "Unknown/Timezone", "/UTC", "Asia", "+03:00"]
)
def test_read_today_uses_source_timezone_and_selected_source(
    client, session_factory, monkeypatch, with_day, zone
):
    now = datetime(2026, 11, 3, 22, 30)
    monkeypatch.setattr("qym_platform.services.live_overview.utcnow", lambda: now)
    today = now.date() + timedelta(days=1 if zone == "Asia/Riyadh" else 0)
    with session_factory() as db:
        # At 22:30 UTC it is already November 4 in Riyadh.
        db.get(LiveSource, "source").day_key_timezone = zone
        db.add(
            LiveSource(
                id="second",
                project_id="p",
                key="second",
                name="Second",
                environment="test",
                is_active=False,
            )
        )
        db.flush()
        for source_id, day, seen, evaluated, failed, count in [
            ("source", NOW.date(), 12, 9, 2, 3),
            ("source", NOW.date() + timedelta(days=1), 100, 90, 10, 2),
            ("second", NOW.date(), 200, 180, 20, 4),
        ]:
            if with_day or day != today or source_id != "source":
                db.add(
                    LiveDay(
                        source_id=source_id,
                        day=day,
                        turns_seen=seen,
                        evaluated=evaluated,
                        failed=failed,
                    )
                )
            for i in range(count):
                db.add(
                    LiveTurn(
                        source_id=source_id,
                        day=day,
                        turn_id=f"{day}-{i}",
                        turn_at=NOW,
                        status="completed",
                        question="Question",
                    )
                )
        db.commit()
    body = read(client, source="worker")
    assert body["status"]["day_key_timezone"] == (
        "Asia/Riyadh" if zone == "Asia/Riyadh" else "UTC"
    )
    seen, evaluated, failed, count = (
        (100, 90, 10, 2) if zone == "Asia/Riyadh" else (12, 9, 2, 3)
    )
    assert body["today"] == {
        "day": today.isoformat(),
        "turns_seen": seen if with_day else 0,
        "evaluated": evaluated if with_day else 0,
        "failed": failed if with_day else 0,
        "in_qym": count,
    }
    second = read(client, source="second")
    assert second["status"]["day_key_timezone"] == "UTC"
    assert second["today"] == {
        "day": "2026-11-03",
        "turns_seen": 200,
        "evaluated": 180,
        "failed": 20,
        "in_qym": 4,
    }


def test_state_round_trip_and_audit(client, session_factory):
    response = client.put(BASE + "/state", headers=ADMIN, json={"state": "paused"})
    assert response.status_code == 200, response.text
    assert response.json()["state"] == {
        "desired": "paused",
        "changed_at": "2026-11-03T22:00:00Z",
        "changed_by": "Owner",
    }
    assert read(client)["state"] == response.json()["state"]
    assert (
        client.put(BASE + "/state", headers=ADMIN, json={"state": "paused"}).status_code
        == 200
    )
    with session_factory() as db:
        row = db.query(AuditLog).filter_by(action="live.worker.state").one()
        assert (row.actor_user_id, row.entity_type, row.entity_id) == (
            "u",
            "live_source",
            "source",
        )
        assert row.before == {"state": "running"}
        assert row.after == {"state": "paused"}
        assert_safe([row.before, row.after])
    assert (
        client.put(
            BASE + "/state", headers=ADMIN, json={"state": "running"}
        ).status_code
        == 200
    )
    assert read(client)["state"]["desired"] == "running"
    with session_factory() as db:
        headers = seed_member(db, ProjectRole.MEMBER)
    response = client.put(BASE + "/state", headers=headers, json={"state": "paused"})
    assert response.status_code == 200, response.text
    assert response.json()["state"]["changed_by"] == "Member"


def test_key_set_clear_foreign_and_revoked(client, session_factory):
    with session_factory() as db:
        db.add(Project(id="other", slug="other", name="Other", created_by_user_id="u"))
        db.flush()
        for key, project, name, revoked in [
            ("a", "p", "Zulu", None),
            ("b", "p", "Alpha", None),
            ("foreign", "other", "Foreign", None),
            ("revoked", "p", "Revoked", NOW),
        ]:
            db.add(
                ApiKey(
                    id=key,
                    project_id=project,
                    user_id="u",
                    name=name,
                    prefix=f"prefix-{key}",
                    key_hash=b"hash",
                    revoked_at=revoked,
                )
            )
        db.commit()
    response = client.put(BASE + "/key", headers=ADMIN, json={"api_key_id": "a"})
    assert response.status_code == 200, response.text
    assert response.json()["worker_key"] == {
        "id": "a",
        "name": "Zulu",
        "prefix": "prefix-a",
        "changed_at": "2026-11-03T22:00:00Z",
        "changed_by": "Owner",
    }
    assert read(client)["worker_key"] == response.json()["worker_key"]
    assert [k["name"] for k in read(client)["api_keys"]] == ["Alpha", "Zulu"]
    with session_factory() as db:
        db.get(ApiKey, "a").revoked_at = NOW
        db.commit()
    assert read(client)["worker_key"] is None
    response = client.put(BASE + "/key", headers=ADMIN, json={"api_key_id": None})
    assert response.status_code == 200
    assert response.json() == {"worker_key": None}
    for key in ("foreign", "revoked", "missing"):
        response = client.put(BASE + "/key", headers=ADMIN, json={"api_key_id": key})
        assert response.status_code == 422
        assert response.json()["detail"] == "api key not found"
        assert response.json()["error"]["code"] == "api_key_not_found"
    with session_factory() as db:
        rows = (
            db.query(AuditLog)
            .filter_by(action="live.worker.key")
            .order_by(AuditLog.created_at)
            .all()
        )
        assert len(rows) == 2
        assert rows[0].before == {"prefix": None}
        assert rows[0].after == {"prefix": "prefix-a"}
        assert rows[1].after == {"prefix": None}


def test_settings_save_returns_version_and_hints_only(client, session_factory, values):
    response = save(client, values, secrets=SECRETS, note="Initial")
    assert response.status_code == 201, response.text
    assert response.json() == {"version": 1}
    body = read(client)
    assert body["settings"]["secret_hints"] == {
        "langfuse_secret_key": "1234",
        "database_password": "5678",
    }
    assert body["settings"]["created_by"] == "Owner"
    assert_safe(body)
    assert save(client, values, note="Next").status_code == 201
    with session_factory() as db:
        rows = (
            db.query(AuditLog)
            .filter_by(action="live.worker.settings")
            .order_by(AuditLog.created_at, AuditLog.id)
            .all()
        )
        assert len(rows) == 2
        by_version = {r.after["version"]: r for r in rows}
        assert by_version[1].before == {}
        assert set(by_version[1].after) == {"version", "values", "secret_hints"}
        assert by_version[2].before == by_version[1].after
        assert_safe([[r.before, r.after] for r in rows])


def test_save_omitted_secret_keeps_previous_token(client, session_factory, values):
    assert save(client, values, secrets=SECRETS).status_code == 201
    assert save(client, values).status_code == 201
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        versions = live_worker_settings.list_versions(db, source)
        assert versions[0].secrets_encrypted == versions[1].secrets_encrypted
        resolved, errors = live_worker_settings.resolved_secrets(
            db, source, versions[0]
        )
        assert errors == []
        assert all(resolved[k] == v for k, v in SECRETS.items())


def test_settings_409_without_encryption_key(
    client, session_factory, values, monkeypatch
):
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY")
    response = save(client, values, secrets=SECRETS)
    assert response.status_code == 409
    assert response.json()["detail"] == "encryption key not configured"
    assert response.json()["error"]["code"] == "encryption_key_not_configured"
    with session_factory() as db:
        assert db.query(LiveWorkerSettings).count() == 0
        assert db.query(AuditLog).count() == 0


def test_settings_422_field_path(client, session_factory, values):
    values["evaluation"]["parallel_turns"] = 9
    response = save(client, values, secrets=SECRETS)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"][0]["loc"] == [
        "body",
        "values",
        "evaluation",
        "parallel_turns",
    ]
    assert response.json()["detail"] == response.json()["error"]["details"]
    values["evaluation"]["parallel_turns"] = 2
    for secrets, field in [
        ({}, "database_password"),
        ({**SECRETS, "unknown": "secret"}, "unknown"),
    ]:
        response = save(client, values, secrets=secrets)
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "secrets", field]
        assert response.json()["detail"][0]["type"] == "value_error"
        assert_safe(response.json())
    values["models"]["connection_id"] = "missing"
    response = save(client, values, secrets=SECRETS)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == [
        "body",
        "values",
        "models",
        "connection_id",
    ]


def test_restore_creates_new_version(client, session_factory, values):
    assert save(client, values, secrets=SECRETS).status_code == 201
    values["evaluation"]["parallel_turns"] = 5
    assert save(client, values).status_code == 201
    response = client.post(BASE + "/settings/1/restore", headers=ADMIN)
    assert response.status_code == 201, response.text
    assert response.json() == {"version": 3}
    assert read(client)["settings"]["values"]["evaluation"]["parallel_turns"] == 2
    with session_factory() as db:
        row = db.query(AuditLog).filter_by(action="live.worker.restore").one()
        assert (row.before["version"], row.after["version"]) == (2, 3)
        assert_safe([row.before, row.after])
    assert client.post(BASE + "/settings/99/restore", headers=ADMIN).status_code == 404


def test_jobs_create_validations(client, session_factory, monkeypatch):
    cases = [
        ({"until_day": "2025-12-31"}, "until_day before since_day"),
        ({"until_day": "2026-02-01"}, "At most 31 days per job"),
        ({"limit": 0}, "limit must be 1 to 2000"),
        ({"limit": 2001}, "limit must be 1 to 2000"),
        ({"redo": ["failed", "failed"]}, "redo must not contain duplicate labels"),
        ({"redo": ["all", "all"]}, "redo must not contain duplicate labels"),
        ({"redo": ["all", "failed"]}, "redo all must not be combined with others"),
        (
            {"redo": ["inconclusive", "all"]},
            "redo all must not be combined with others",
        ),
        (
            {"since_day": "2026-11-05", "until_day": "2026-11-05"},
            "until_day in the future",
        ),
    ]
    for changes, message in cases:
        response = client.post(BASE + "/jobs", headers=ADMIN, json={**JOB, **changes})
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == message
        assert response.json()["error"]["code"] == "validation_error"
    response = client.post(BASE + "/jobs", headers=ADMIN, json=JOB)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "queued"
    assert response.json()["requested_by"] == "Owner"
    assert response.json()["params"]["redo"] == ["failed"]
    duplicate = client.post(BASE + "/jobs", headers=ADMIN, json=JOB)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "a backfill job is already queued or running"
    assert duplicate.json()["error"]["code"] == "conflict"
    with session_factory() as db:
        db.get(LiveJob, response.json()["id"]).status = "running"
        db.commit()
    assert client.post(BASE + "/jobs", headers=ADMIN, json=JOB).status_code == 409
    preview = client.post(
        BASE + "/jobs", headers=ADMIN, json={**JOB, "kind": "backfill_preview"}
    )
    assert preview.status_code == 201, preview.text
    assert preview.json()["params"]["redo"] == []
    with session_factory() as db:
        db.add(
            LiveSource(
                id="second",
                project_id="p",
                key="second",
                name="Second",
                environment="test",
                is_active=False,
            )
        )
        row = db.query(AuditLog).filter_by(action="live.worker.job").first()
        assert row.after == response.json()["params"]
        db.commit()
    assert (
        client.post(BASE + "/jobs?source=second", headers=ADMIN, json=JOB).status_code
        == 201
    )
    monkeypatch.setenv("QYM_LIVE_JOB_MAX_DAYS", "2")
    assert (
        client.post(BASE + "/jobs", headers=ADMIN, json=JOB).json()["detail"]
        == "At most 2 days per job"
    )


@pytest.mark.parametrize("kind", ["backfill", "backfill_preview"])
@pytest.mark.parametrize(
    "redo",
    [None, [], ["failed"], ["inconclusive"], ["failed", "inconclusive"], ["all"]],
)
def test_jobs_redo(client, session_factory, kind, redo):
    response = client.post(
        BASE + "/jobs", headers=ADMIN, json={**JOB, "kind": kind, "redo": redo}
    )
    assert response.status_code == 201, response.text
    expected = (
        [] if kind == "backfill_preview" else ["failed"] if redo is None else redo
    )
    assert response.json()["params"]["redo"] == expected
    assert read(client)["jobs"][0]["params"]["redo"] == expected
    with session_factory() as db:
        assert db.get(LiveJob, response.json()["id"]).params["redo"] == expected


def test_jobs_redo_unknown_label(client):
    response = client.post(
        BASE + "/jobs", headers=ADMIN, json={**JOB, "redo": ["success"]}
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("stale_precheck", [False, True])
def test_jobs_duplicate_insert_is_409(
    client, session_factory, monkeypatch, stale_precheck
):
    with session_factory() as db:
        db.add(LiveJob(source_id="source", kind="backfill", status="queued"))
        db.commit()
    if stale_precheck:
        original_first = Query.first

        def first(query):
            if query.column_descriptions[0]["expr"] is LiveJob.id:
                return None
            return original_first(query)

        monkeypatch.setattr(Query, "first", first)
    response = client.post(BASE + "/jobs", headers=ADMIN, json=JOB)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "a backfill job is already queued or running"
    if stale_precheck:
        from qym_platform.services.live_jobs import JobError, create_job
        from qym_platform.settings import PlatformSettings

        with session_factory() as db:
            source = db.get(LiveSource, "source")
            source.desired_state = "paused"
            with pytest.raises(JobError) as error:
                create_job(
                    db,
                    source,
                    "backfill",
                    date(2026, 1, 1),
                    date(2026, 1, 31),
                    2000,
                    PlatformSettings(),
                    "u",
                    NOW,
                )
            assert error.value.status == 409
            assert db.is_active
            db.commit()
        with session_factory() as db:
            assert db.get(LiveSource, "source").desired_state == "paused"
            assert db.query(LiveJob).count() == 1


@pytest.mark.parametrize("zone", ["UTC+03:00", "Asia"])
def test_jobs_unknown_timezone_is_422(client, session_factory, zone):
    with session_factory() as db:
        db.get(LiveSource, "source").day_key_timezone = zone
        db.commit()
    response = client.post(BASE + "/jobs", headers=ADMIN, json=JOB)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "source timezone not recognised"


def test_jobs_params_are_utc_bounds_of_the_source_timezone(client, session_factory):
    with session_factory() as db:
        db.get(LiveSource, "source").day_key_timezone = "Asia/Riyadh"
        db.commit()
    # 22:00 UTC on November 3 is already November 4 in Riyadh.
    response = client.post(
        BASE + "/jobs",
        headers=ADMIN,
        json={**JOB, "since_day": "2026-11-04", "until_day": "2026-11-04"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["params"] == {
        "since_day": "2026-11-04",
        "until_day": "2026-11-04",
        "limit": 2000,
        "redo": ["failed"],
        "since": "2026-11-03T21:00:00Z",
        "until": "2026-11-04T20:59:59.999999Z",
    }


def test_jobs_cancel_queued_running_terminal(client, session_factory):
    with session_factory() as db:
        db.add(
            LiveSource(
                id="second",
                project_id="p",
                key="second",
                name="Second",
                environment="test",
                is_active=False,
            )
        )
        db.flush()
        for status in ("queued", "running", "done", "failed", "cancelled"):
            db.add(
                LiveJob(
                    id=status,
                    source_id="source",
                    kind="backfill_preview" if status == "running" else "backfill",
                    status=status,
                )
            )
        db.add(
            LiveJob(id="foreign", source_id="second", kind="backfill", status="queued")
        )
        db.commit()
    for status in ("queued", "running"):
        response = client.post(BASE + f"/jobs/{status}/cancel", headers=ADMIN)
        assert response.status_code == 200, response.text
        job = response.json()
        assert job["status"] == ("cancelled" if status == "queued" else "running")
        assert job["cancel_requested"] is (status == "running")
        assert job["finished_at"] == (
            "2026-11-03T22:00:00Z" if status == "queued" else None
        )
    for status in ("done", "failed", "cancelled", "queued"):
        response = client.post(BASE + f"/jobs/{status}/cancel", headers=ADMIN)
        assert response.status_code == 409
        assert response.json()["detail"] == "job already finished"
    for job_id in ("missing", "foreign"):
        assert (
            client.post(BASE + f"/jobs/{job_id}/cancel", headers=ADMIN).status_code
            == 404
        )
    with session_factory() as db:
        assert (
            db.query(AuditLog).filter_by(action="live.worker.job.cancel").count() == 2
        )


def test_events_list_filters_and_limit(client, session_factory):
    with session_factory() as db:
        db.add(
            LiveSource(
                id="second",
                project_id="p",
                key="second",
                name="Second",
                environment="test",
                is_active=False,
            )
        )
        db.flush()
        for i in range(205):
            db.add(
                LiveWorkerEvent(
                    source_id="source" if i < 204 else "second",
                    level="error" if i % 2 else "info",
                    component="database" if i % 3 else "langfuse",
                    code="connect",
                    message=f"Event {i}",
                    details={"attempt": i, "langfuse_secret_key": "sk"},
                    fingerprint=str(i),
                    count=2,
                    first_at=NOW,
                    last_at=NOW + timedelta(seconds=i),
                )
            )
        db.commit()
    response = client.get(BASE + "/events", headers=ADMIN)
    assert response.status_code == 200
    rows = response.json()["events"]
    assert len(rows) == 50
    assert rows[0]["message"] == "Event 203"
    assert all(row["details"] == {"attempt": 203 - i} for i, row in enumerate(rows))
    assert set(rows[0]) == {
        "id",
        "level",
        "component",
        "code",
        "message",
        "details",
        "count",
        "first_at",
        "last_at",
    }
    assert rows[0]["first_at"] == "2026-11-03T22:00:00Z"
    for filters in (
        {"component": "database"},
        {"level": "error"},
        {"component": "database", "level": "error"},
    ):
        rows = client.get(
            BASE + "/events", headers=ADMIN, params={**filters, "limit": 200}
        ).json()["events"]
        assert rows
        assert all(all(row[k] == v for k, v in filters.items()) for row in rows)
        assert [r["last_at"] for r in rows] == sorted(
            [r["last_at"] for r in rows], reverse=True
        )
    assert (
        len(client.get(BASE + "/events?limit=200", headers=ADMIN).json()["events"])
        == 200
    )
    assert client.get(BASE + "/events?limit=201", headers=ADMIN).status_code == 422
    assert client.get(BASE + "/events?component=missing", headers=ADMIN).json() == {
        "events": []
    }


def seed_member(db, role, project_id="p"):
    db.add(
        User(
            id="member",
            email="member@test",
            display_name="Member",
            role=UserRole.MEMBER,
        )
    )
    db.flush()
    db.add(ProjectMembership(project_id=project_id, user_id="member", role=role))
    db.commit()
    return {"X-User-Email": "member@test"}


def test_viewer_is_403_on_every_write(client, session_factory):
    with session_factory() as db:
        headers = seed_member(db, ProjectRole.VIEWER)
    assert client.get(BASE, headers=headers).status_code == 200
    for method, path, body in WRITES:
        response = client.request(method, BASE + path, headers=headers, json=body)
        assert response.status_code == 403, response.text


def test_archived_is_409_on_every_write(client, session_factory):
    with session_factory() as db:
        db.get(Project, "p").is_active = False
        db.commit()
    assert read(client)["settings"] is None
    for method, path, body in WRITES:
        response = client.request(method, BASE + path, headers=ADMIN, json=body)
        assert response.status_code == 409, response.text
        assert response.headers["X-Qym-Project-State"] == "archived"


def test_other_project_member_is_404(client, session_factory):
    with session_factory() as db:
        db.add(Project(id="other", slug="other", name="Other", created_by_user_id="u"))
        db.flush()
        headers = seed_member(db, ProjectRole.MEMBER, "other")
    for method, path, body in [("GET", "", None), ("GET", "/events", None), *WRITES]:
        response = client.request(method, BASE + path, headers=headers, json=body)
        assert response.status_code == 404, response.text
