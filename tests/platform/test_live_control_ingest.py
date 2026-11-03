"""Worker control, job progress and event ingestion contracts."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.orm import sessionmaker
from test_live_ingest_sources import (  # noqa: F401
    BASE,
    TOKEN as KEY_TOKEN,
    _auth_headers,
    _auth_mode,
    _seed_api_key,
)
from test_live_worker_settings import SECRETS, values  # noqa: F401

from qym_platform.db.models import (
    ApiKey,
    LiveJob,
    LiveSource,
    LiveWorkerEvent,
    LiveWorkerSettings,
    ProjectLlmConnection,
    User,
)
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services import live_worker_settings
from qym_platform.settings import PlatformSettings

NOW = datetime(2026, 11, 3, 12)
OTHER_TOKEN = "same-project-control-token"


@pytest.fixture()
def session_factory(database, monkeypatch, values):
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode())
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        _seed_api_key(db, token=KEY_TOKEN)
        _seed_api_key(db, token="other-project-token", suffix="2")
        db.get(User, "live-user-1").display_name = "Worker owner"
        db.add(
            ApiKey(
                id="same-project-key",
                user_id="live-user-1",
                project_id="live-project-1",
                name="Other key",
                prefix=api_key_prefix(OTHER_TOKEN),
                key_hash=hash_api_key(OTHER_TOKEN),
                scopes=[],
            )
        )
        db.add(
            ProjectLlmConnection(
                id="connection",
                project_id="live-project-1",
                name="Gateway",
                llm_base_url="https://gateway.example/v1",
                llm_api_key_encrypted=encrypt_llm_api_key("gateway-secret"),
            )
        )
        source = LiveSource(
            id="source",
            project_id="live-project-1",
            key="worker-1",
            name="Worker",
            environment="test",
            worker_key_id="live-key-1",
            state_changed_at=NOW,
            state_changed_by_user_id="live-user-1",
        )
        db.add(source)
        db.flush()
        live_worker_settings.create_version(
            db, source, values, SECRETS, "initial", "live-user-1", now=NOW
        )
        for job_id, status, offset in (
            ("new", "queued", 1),
            ("old", "running", 0),
            ("finished", "done", -1),
        ):
            db.add(
                LiveJob(
                    id=job_id,
                    source_id=source.id,
                    kind="backfill",
                    params={"hours": 1},
                    status=status,
                    progress={"evaluated": 2} if job_id == "old" else {},
                    requested_by_user_id="live-user-1",
                    requested_at=NOW + timedelta(minutes=offset),
                    updated_at=NOW,
                )
            )
        db.commit()
    return factory


def _control(client, **headers):
    return client.get(f"{BASE}/control", headers={**_auth_headers(), **headers})


def _progress(client, status="running", progress=None, job_id="new", **extra):
    return client.post(
        f"{BASE}/jobs/{job_id}/progress",
        headers=_auth_headers(),
        json={"status": status, "progress": progress or {}, **extra},
    )


def _event(**changes):
    return {
        "at": "2026-11-03T15:00:00+03:00",
        "level": "error",
        "component": "gateway",
        "code": "request_failed",
        "message": "Request 123 failed for abcdef1234567890",
        "details": {},
        **changes,
    }


def _events(client, events):
    return client.post(
        f"{BASE}/events", headers=_auth_headers(), json={"events": events}
    )


def _assert_error(response, status, detail):
    assert response.status_code == status, response.text
    assert response.json()["detail"] == detail
    assert response.json()["error"]["code"]


def test_control_returns_state_settings_and_jobs_to_worker_key(
    client, session_factory, values
):
    response = _control(client)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert re.fullmatch(r'W/"[0-9a-f]{32}"', response.headers["etag"])
    body = response.json()
    assert body["state"] == "running"
    assert body["state_changed_at"] == "2026-11-03T12:00:00Z"
    assert body["state_changed_by"] == "Worker owner"
    settings = body["settings"]
    assert settings["version"] == 1
    assert settings["created_at"] == "2026-11-03T12:00:00Z"
    assert settings["created_by"] == "Worker owner"
    assert settings["values"] == values
    assert settings["errors"] == []
    assert settings["secrets"] == {
        **SECRETS,
        "gateway_base_url": "https://gateway.example/v1",
        "gateway_api_key": "gateway-secret",
    }
    assert re.fullmatch(r"[0-9a-f]{64}", settings["secrets_digest"])
    assert settings["secrets_digest"] == live_worker_settings.secrets_digest(
        settings["secrets"]
    )
    assert "secrets_withheld" not in settings
    assert body["jobs"] == [
        {
            "id": job_id,
            "kind": "backfill",
            "params": {"hours": 1},
            "status": status,
            "progress": progress,
            "cancel_requested": False,
        }
        for job_id, status, progress in (
            ("old", "running", {"evaluated": 2}),
            ("new", "queued", {}),
        )
    ]
    from qym_platform.services.live_control import job_dict

    with session_factory() as db:
        assert job_dict(db.get(LiveJob, "new")) == {
            "id": "new",
            "kind": "backfill",
            "params": {"hours": 1},
            "status": "queued",
            "progress": {},
            "error": None,
            "requested_by": "Worker owner",
            "requested_at": "2026-11-03T12:01:00Z",
            "started_at": None,
            "finished_at": None,
            "cancel_requested": False,
        }
    heartbeat = client.post(
        f"{BASE}/heartbeat",
        headers=_auth_headers(),
        json={
            "at": "2026-11-03T12:00:00Z",
            "worker": {"control": {"version": 1, "state": "running"}},
        },
    )
    assert heartbeat.status_code == 204
    with session_factory() as db:
        assert db.get(LiveSource, "source").worker["control"] == {
            "version": 1,
            "state": "running",
        }


def test_control_withholds_secrets_from_other_keys(client, session_factory):
    worker = _control(client)
    response = _control(
        client,
        **_auth_headers(OTHER_TOKEN),
        **{"If-None-Match": worker.headers["etag"]},
    )
    assert response.status_code == 200, response.text
    settings = response.json()["settings"]
    assert settings["secrets_withheld"] is True
    assert "secrets" not in settings
    assert settings["secrets_digest"] == worker.json()["settings"]["secrets_digest"]
    assert settings["errors"] == []
    with session_factory() as db:
        db.get(LiveSource, "source").worker_key_id = None
        db.commit()
    response = _control(client)
    assert response.json()["settings"]["secrets_withheld"] is True
    assert "secrets" not in response.json()["settings"]
    # A stale principal must never disclose secrets for a revoked worker key.
    from qym_platform.auth import Principal
    from qym_platform.services.live_control import control_document

    with session_factory() as db:
        source = db.get(LiveSource, "source")
        source.worker_key_id = "live-key-1"
        db.get(ApiKey, "live-key-1").revoked_at = NOW
        db.flush()
        body, _ = control_document(
            db,
            source,
            Principal(
                user=db.get(User, "live-user-1"),
                auth_type="api_key",
                api_key_id="live-key-1",
            ),
            PlatformSettings(),
            NOW,
        )
        assert body["settings"]["secrets_withheld"] is True
        assert "secrets" not in body["settings"]


@pytest.mark.parametrize("strong", [False, True])
def test_control_304_on_matching_etag(client, strong):
    etag = _control(client).headers["etag"]
    candidate = etag.removeprefix("W/") if strong else etag
    response = _control(client, **{"If-None-Match": f'"unrelated", {candidate} '})
    assert response.status_code == 304, response.text
    assert response.content == b""
    assert response.headers["etag"] == etag


def test_control_etag_changes_when_state_or_version_or_connection_changes(
    client, session_factory, values
):
    etag = _control(client).headers["etag"]
    for change in (
        "state",
        "version",
        "connection",
        "progress",
        "terminal",
        "worker_key",
    ):
        with session_factory() as db:
            source = db.get(LiveSource, "source")
            if change == "state":
                source.desired_state = "paused"
                source.state_changed_at = NOW + timedelta(minutes=1)
            elif change == "version":
                live_worker_settings.create_version(
                    db, source, values, {}, None, "live-user-1"
                )
            elif change == "connection":
                db.get(ProjectLlmConnection, "connection").llm_api_key_encrypted = (
                    encrypt_llm_api_key("rotated")
                )
            elif change == "progress":
                db.get(LiveJob, "old").progress = {"evaluated": 3}
                db.get(LiveJob, "old").updated_at = NOW + timedelta(hours=1)
            elif change == "terminal":
                db.get(LiveJob, "new").status = "done"
            else:
                source.worker_key_id = None
            db.commit()
        response = _control(client, **{"If-None-Match": etag})
        assert response.status_code == 200, (change, response.text)
        assert response.headers["etag"] != etag, change
        etag = response.headers["etag"]


def test_control_reports_missing_connection(client, session_factory):
    with session_factory() as db:
        db.delete(db.get(ProjectLlmConnection, "connection"))
        db.commit()
    response = _control(client)
    assert response.status_code == 200, response.text
    settings = response.json()["settings"]
    assert settings["errors"] == ["connection missing"]
    assert settings["secrets"] == SECRETS


def test_control_etag_changes_when_an_older_job_updates(client, session_factory):
    from qym_platform.services.live_jobs import report_progress

    with session_factory() as db:
        db.get(LiveJob, "new").updated_at = NOW + timedelta(minutes=30)
        db.commit()
    etag = _control(client).headers["etag"]
    with session_factory() as db:
        report_progress(
            db,
            db.get(LiveSource, "source"),
            "old",
            "running",
            {"evaluated": 3},
            None,
            now=NOW + timedelta(minutes=10),
        )
        db.commit()
    response = _control(client, **{"If-None-Match": etag})
    assert response.status_code == 200, response.text
    assert response.headers["etag"] != etag
    assert response.json()["jobs"][0]["progress"] == {"evaluated": 3}


def test_control_without_version_has_null_settings(client, session_factory):
    with session_factory() as db:
        db.query(LiveWorkerSettings).delete()
        source = db.get(LiveSource, "source")
        source.state_changed_at = source.state_changed_by_user_id = None
        db.commit()
    response = _control(client)
    assert response.status_code == 200, response.text
    assert response.json()["settings"] is None
    assert response.json()["state_changed_at"] is None
    assert response.json()["state_changed_by"] is None


def test_control_other_project_key_is_403(client):
    response = _control(client, **_auth_headers("other-project-token"))
    _assert_error(response, 403, "API key belongs to another project")


@pytest.mark.parametrize(
    "counter", ["found", "skipped_existing", "evaluated", "failed"]
)
def test_progress_monotonic_counters(client, session_factory, counter):
    assert _progress(client, progress={counter: 3}).status_code == 200
    for value in (2, -1, True, 3.5, "4", None):
        _assert_error(
            _progress(client, progress={counter: value}),
            422,
            "counters must not decrease",
        )
    _assert_error(_progress(client), 422, "counters must not decrease")
    with session_factory() as db:
        assert db.get(LiveJob, "new").progress == {counter: 3}


@pytest.mark.parametrize("terminal", ["done", "failed", "cancelled"])
def test_progress_409_after_cancel_and_after_terminal(
    client, session_factory, terminal
):
    with session_factory() as db:
        db.get(LiveJob, "new").cancel_requested_at = NOW
        db.commit()
    _assert_error(_progress(client), 409, "job cancelled")
    assert _progress(client, status="cancelled").status_code == 200
    _assert_error(_progress(client), 409, "job already finished")
    with session_factory() as db:
        db.get(LiveJob, "finished").status = terminal
        db.commit()
    _assert_error(_progress(client, job_id="finished"), 409, "job already finished")


@pytest.mark.parametrize("terminal", ["done", "failed", "cancelled"])
def test_progress_stamps_started_and_finished(
    client, session_factory, monkeypatch, terminal
):
    monkeypatch.setattr("qym_platform.services.live_ingest.utcnow", lambda: NOW)
    response = _progress(client, progress={"evaluated": 1, "stage": "start"})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": "new",
        "status": "running",
        "progress": {"evaluated": 1, "stage": "start"},
    }
    later = NOW + timedelta(minutes=1)
    monkeypatch.setattr("qym_platform.services.live_ingest.utcnow", lambda: later)
    assert _progress(client, progress={"evaluated": 2}).status_code == 200
    response = _progress(
        client, status=terminal, progress={"evaluated": 3}, error="x" * 2001
    )
    assert response.status_code == 200, response.text
    with session_factory() as db:
        job = db.get(LiveJob, "new")
        assert job.started_at == NOW
        assert job.finished_at == later
        assert job.updated_at == later
        assert job.progress == {"evaluated": 3}
        assert job.error == ("x" * 2000 if terminal == "failed" else None)


def test_progress_unknown_job_404(client, session_factory):
    _assert_error(_progress(client, job_id="missing"), 404, "job not found")
    with session_factory() as db:
        source = LiveSource(
            id="other-source",
            project_id="live-project-2",
            key="worker",
            name="Other",
            environment="test",
        )
        db.add(source)
        db.flush()
        db.add(
            LiveJob(id="foreign", source_id=source.id, kind="backfill", status="queued")
        )
        db.commit()
    _assert_error(_progress(client, job_id="foreign"), 404, "job not found")


@pytest.mark.parametrize(
    "progress_json",
    ['{"latency":1e999}', '{"nested":[{"latency":-1e999}]}', '{"latency":NaN}'],
)
def test_progress_rejects_non_finite_json(client, session_factory, progress_json):
    response = client.post(
        f"{BASE}/jobs/new/progress",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        content='{"status":"running","progress":' + progress_json + '}',
    )
    assert response.status_code == 422, response.text
    assert "progress must be finite JSON" in response.text
    with session_factory() as db:
        assert db.get(LiveJob, "new").progress == {}
    assert _control(client).status_code == 200


def test_events_out_of_order_outside_window_stay_separate(client, session_factory):
    for at in ("2026-11-03T12:30:00Z", "2026-11-03T12:00:00Z"):
        response = _events(client, [_event(at=at)])
        assert response.status_code == 200, response.text
    with session_factory() as db:
        rows = db.query(LiveWorkerEvent).order_by(LiveWorkerEvent.first_at).all()
        assert len(rows) == 2
        assert [row.count for row in rows] == [1, 1]
        assert rows[0].first_at == rows[0].last_at == NOW
        assert rows[1].first_at == rows[1].last_at == NOW + timedelta(minutes=30)


def test_events_out_of_order_inside_window_merge(client, session_factory):
    for at in ("2026-11-03T12:10:00Z", "2026-11-03T12:00:00Z"):
        response = _events(client, [_event(at=at)])
        assert response.status_code == 200, response.text
    with session_factory() as db:
        row = db.query(LiveWorkerEvent).one()
        assert row.count == 2
        assert row.first_at == NOW
        assert row.last_at == NOW + timedelta(minutes=10)


def test_events_merge_by_fingerprint_within_window(client, session_factory):
    response = _events(client, [_event()] * 3 + [_event(message="Different failure")])
    assert response.status_code == 200, response.text
    assert response.json() == {"accepted": 2}
    with session_factory() as db:
        rows = db.query(LiveWorkerEvent).order_by(LiveWorkerEvent.id).all()
        assert [row.count for row in rows] == [3, 1]
        assert rows[0].first_at == rows[0].last_at == NOW
    response = _events(
        client,
        [
            _event(
                at="2026-11-03T12:05:00Z",
                message=" REQUEST  987 failed FOR fedcba9876543210 ",
                details={"attempt": 2},
            )
        ],
    )
    assert response.json() == {"accepted": 1}
    with session_factory() as db:
        rows = db.query(LiveWorkerEvent).order_by(LiveWorkerEvent.id).all()
        assert len(rows) == 2
        assert rows[0].count == 4
        assert rows[0].message == _event()["message"]
        assert rows[0].details == {"attempt": 2}
        assert rows[0].last_at == NOW + timedelta(minutes=5)
    assert _events(client, [_event(at="2026-11-03T12:25:00Z")]).status_code == 200
    assert _events(client, [_event(at="2026-11-03T12:24:00Z")]).status_code == 200
    with session_factory() as db:
        rows = db.query(LiveWorkerEvent).order_by(LiveWorkerEvent.id).all()
        assert [row.count for row in rows] == [4, 1, 2]
        assert rows[-1].last_at == NOW + timedelta(minutes=25)
    from qym_platform.services.live_events import fingerprint

    assert fingerprint("worker", "error", "ABCDEFABCDEFABCD 12") == fingerprint(
        "worker", "error", "1234567890123456 99"
    )


def test_events_batch_over_max_is_422(client, monkeypatch):
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_events_batch_max=2),
    )
    _assert_error(_events(client, [_event()] * 3), 422, "too many events")


@pytest.mark.parametrize("streamed", [False, True])
def test_events_body_over_256kib_is_413(client, session_factory, streamed):
    data = json.dumps(
        {"events": [_event(details={"large": "x" * (256 * 1024)})]}
    ).encode()
    headers = {**_auth_headers(), "Content-Type": "application/json"}
    if streamed:
        headers["Content-Length"] = "1"
        data = iter([data[: 256 * 1024], data[256 * 1024 :]])
    response = client.post(f"{BASE}/events", headers=headers, content=data)
    assert response.status_code == 413, response.text
    assert "262144 byte limit" in response.json()["detail"]
    assert response.json()["error"]["code"]
    with session_factory() as db:
        assert db.query(LiveWorkerEvent).count() == 0


def test_events_drop_secret_keys_from_details(client, session_factory):
    details = {
        "api_key": "x",
        "PASSWORD": "x",
        "secret": "x",
        "Token": "x",
        "gateway_API_KEY": "x",
        "access_token": "x",
        "database_password": "x",
        "client_secret": "x",
        "safe": 2,
        "tokens_used": 5,
        "nested": {"TOKEN": "x", "ok": True},
        "list": [{"password": "x", "ok": None}],
    }
    response = _events(client, [_event(details=details)])
    assert response.status_code == 200, response.text
    with session_factory() as db:
        assert db.query(LiveWorkerEvent).one().details == {
            "safe": 2,
            "tokens_used": 5,
            "nested": {"ok": True},
            "list": [{"ok": None}],
        }


@pytest.mark.parametrize(
    "changes",
    [
        {"component": "gateway-1"},
        {"component": ""},
        {"component": "a" * 31},
        {"code": "BAD"},
        {"level": "info"},
        {"details": {"nan": float("nan")}},
    ],
)
def test_events_invalid_component_is_422(client, changes):
    response = client.post(
        f"{BASE}/events",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        content=json.dumps({"events": [_event(**changes)]}),
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"]
