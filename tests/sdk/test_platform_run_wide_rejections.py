"""Run-wide refusals stop the stream instead of one request per event.

A reviewed run (409 + X-Qym-Run-State: in_review), an archived project or a
revoked key (X-Qym-Key-State) refuses every later upload of the run, so the
SDK must not fall back to posting each event on its own (C014, C023, C024).
"""

from __future__ import annotations

import io
import json
import os
import time
from email.message import Message
from urllib.error import HTTPError
from urllib.parse import urlsplit
from uuid import uuid4

import pytest

from qym.platform import client as client_module
from qym.platform.client import PlatformEventStream


def _limits(monkeypatch, *, batch=50, flush_interval=60.0):
    monkeypatch.setattr(PlatformEventStream, "MAX_BATCH_EVENTS", batch)
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", flush_interval)
    monkeypatch.setattr(PlatformEventStream, "HEARTBEAT_INTERVAL", 60)
    monkeypatch.setattr(PlatformEventStream, "CLOSE_JOIN_TIMEOUT", 5)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_BASE", 0.001)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_MAX", 0.001)


def _headers(**values) -> Message:
    msg = Message()
    for name, value in values.items():
        msg[name.replace("_", "-")] = value
    return msg


def _http_error(url, code, detail, **headers):
    body = json.dumps({"detail": detail}).encode()
    return HTTPError(url, code, detail, _headers(**headers), io.BytesIO(body))


@pytest.mark.parametrize(
    "code,detail,headers,expected",
    [
        (
            409,
            "Run is under review (APPROVED)",
            {"X_Qym_Run_State": "in_review", "X_Qym_Run_Status": "APPROVED"},
            "under review (APPROVED)",
        ),
        (
            409,
            "Project is archived",
            {"X_Qym_Key_State": "project_archived"},
            "Project is archived",
        ),
        (
            403,
            "API key owner is no longer a member of this project",
            {"X_Qym_Key_State": "owner_removed"},
            "no longer a member",
        ),
        (401, "Invalid API key", {}, "Invalid API key"),
    ],
)
@pytest.mark.parametrize("delivery", ["batch", "sync"])
def test_run_wide_rejection_stops_every_upload(
    monkeypatch, capsys, code, detail, headers, expected, delivery
):
    _limits(monkeypatch, batch=200)
    calls = []

    def post(url, payload, key, **kwargs):
        calls.append(payload.count("\n"))
        raise _http_error(url, code, detail, **headers)

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    for i in range(450):
        stream.emit("metric_scored", {"index": i}, sync=delivery == "sync" and i == 0)
    stream.close()
    stream.emit("run_completed", {}, sync=True)

    assert len(calls) == 1, calls
    assert stream._remote_closed.is_set()
    assert stream.sent_events == 0
    # Events emitted after the latch are ignored, like after a 410.
    if delivery == "sync":
        assert stream.dropped_events == 1
    else:
        assert 1 <= stream.dropped_events <= 450
    assert stream.rejected_events == 0
    assert stream.flush(0) is False
    assert not stream._thread.is_alive()
    err = capsys.readouterr().err
    assert expected in err
    assert "no longer accepts updates" in err
    assert "still uploaded" not in err
    assert err.count("qym:") == 1


def test_run_wide_rejection_during_per_event_isolation_stops_too(monkeypatch):
    _limits(monkeypatch)
    calls = []

    def post(url, payload, key, **kwargs):
        calls.append(payload)
        if len(calls) == 1:
            raise _http_error(url, 422, "bad batch")
        raise _http_error(
            url, 409, "Project is archived", X_Qym_Key_State="project_archived"
        )

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    for i in range(5):
        stream.emit("item_started", {"index": i})
    stream.close()

    # One batch, then the first isolated event learns the run is closed.
    assert len(calls) == 2
    assert stream.dropped_events == 5
    assert stream._remote_closed.is_set()


def test_409_or_403_without_a_state_header_is_still_isolated_per_event(monkeypatch):
    """Other refusals (e.g. a proxy's 403) keep the per-event fallback."""
    _limits(monkeypatch)
    calls = []

    def post(url, payload, key, **kwargs):
        calls.append(payload)
        raise _http_error(url, 409, "conflict")

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    for i in range(3):
        stream.emit("item_started", {"index": i})
    stream.close()

    assert len(calls) == 4
    assert not stream._remote_closed.is_set()
    # No per-event verdict: the events were not delivered, so completion
    # stays held (only events the platform itself rejected let a run finish).
    assert stream.dropped_events == 3
    assert stream.rejected_events == 0
    assert stream.flush(0) is False


def test_events_after_a_poison_batch_are_batched_again(monkeypatch):
    """The per-event fallback resets the send cadence (no 1-event batches)."""
    _limits(monkeypatch, batch=200, flush_interval=0.4)
    batches = []

    def post(url, payload, key, **kwargs):
        events = [json.loads(line) for line in payload.splitlines() if line]
        batches.append([evt["payload"].get("index") for evt in events])
        if any(evt["payload"].get("bad") for evt in events):
            raise _http_error(url, 422, "bad event")
        return {"ok": True, "applied": len(events), "skipped": 0}

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    try:
        stream.emit("item_started", {"index": -1, "bad": True})
        deadline = time.monotonic() + 3
        while len(batches) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert batches == [[-1], [-1]]
        for i in range(5):
            stream.emit("item_started", {"index": i})
        time.sleep(0.8)
    finally:
        stream.close()

    assert batches[2:] == [[0, 1, 2, 3, 4]]


# --- Real SDK stream against the full platform app and real API keys --------

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

TOKEN = "run-wide-token"


@pytest.fixture
def live_platform(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker
    from sqlalchemy.pool import StaticPool

    from qym_platform.app import create_app
    from qym_platform.auth import clear_api_key_cache
    from qym_platform.db.base import Base
    from qym_platform.db.models import (
        ApiKey,
        Project,
        ProjectMembership,
        ProjectRole,
        Run,
        RunWorkflowStatus,
        User,
        UserRole,
    )
    from qym_platform.deps import get_db
    from qym_platform.security import api_key_prefix, hash_api_key

    clear_api_key_cache()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False)
    run_id = str(uuid4())
    with Session(engine) as db:
        db.add(User(id="owner", email="owner@example.invalid", role=UserRole.MEMBER))
        db.flush()
        db.add(
            Project(id="project", name="Test", slug="test", created_by_user_id="owner")
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id="project", user_id="owner", role=ProjectRole.MEMBER
                ),
                ApiKey(
                    id="key",
                    user_id="owner",
                    project_id="project",
                    name="runner",
                    prefix=api_key_prefix(TOKEN),
                    key_hash=hash_api_key(TOKEN),
                    scopes=[],
                ),
                Run(
                    id=run_id,
                    project_id="project",
                    owner_user_id="owner",
                    created_by_user_id="owner",
                    task="t",
                    dataset="d",
                    metrics=[],
                    status=RunWorkflowStatus.RUNNING,
                    run_metadata={},
                    run_config={},
                ),
            ]
        )
        db.commit()
    app = create_app()

    def session():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = session
    requests = []
    with TestClient(app, raise_server_exceptions=False) as client:

        def post_ndjson(url, payload, key, **kwargs):
            response = client.post(
                urlsplit(url).path,
                content=payload,
                headers={
                    "content-type": "application/x-ndjson",
                    "Authorization": f"Bearer {key}",
                },
            )
            requests.append(response.status_code)
            if response.status_code >= 400:
                raise HTTPError(
                    url,
                    response.status_code,
                    response.text,
                    _headers(**{k.replace("-", "_"): v for k, v in response.headers.items()}),
                    io.BytesIO(response.content),
                )
            return response.json()

        monkeypatch.setattr(client_module, "_post_ndjson", post_ndjson)
        yield engine, run_id, requests
    clear_api_key_cache()


def test_archiving_the_project_mid_run_stops_the_sdk(monkeypatch, capsys, live_platform):
    from sqlalchemy.orm import Session

    from qym_platform.db.models import Project

    _limits(monkeypatch, batch=50)
    engine, run_id, requests = live_platform
    stream = PlatformEventStream("http://platform.invalid", TOKEN, run_id)
    for i in range(50):
        stream.emit("item_started", {"item_id": f"a-{i}", "index": i, "input": i})
    assert stream.flush(5) is True
    with Session(engine) as db:
        db.get(Project, "project").is_active = False
        db.commit()
    for i in range(300):
        stream.emit("item_started", {"item_id": f"b-{i}", "index": 50 + i, "input": i})
    stream.close()

    assert requests == [200, 409]
    assert stream.sent_events == 50
    assert stream.dropped_events == 300
    err = capsys.readouterr().err
    assert "Project is archived" in err
    assert "still uploaded" not in err


def test_a_run_under_review_stops_the_sdk_after_one_request(
    monkeypatch, capsys, live_platform
):
    from sqlalchemy.orm import Session

    from qym_platform.db.models import Run, RunWorkflowStatus

    _limits(monkeypatch, batch=200)
    engine, run_id, requests = live_platform
    with Session(engine) as db:
        db.get(Run, run_id).status = RunWorkflowStatus.APPROVED
        db.commit()
    stream = PlatformEventStream("http://platform.invalid", TOKEN, run_id)
    for i in range(451):
        stream.emit("item_started", {"item_id": f"i-{i}", "index": i, "input": i})
    stream.close()
    stream.emit("run_completed", {"final_status": "COMPLETED"}, sync=True)

    assert requests == [409]
    assert stream.dropped_events == 451
    err = capsys.readouterr().err
    assert "under review (APPROVED)" in err
