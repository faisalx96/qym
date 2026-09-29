"""Per-event rejections: never resend refused events, never lose the rest (C024)."""

from __future__ import annotations

import io
import json
import os
from urllib.error import HTTPError
from urllib.parse import urlsplit
from uuid import uuid4

import pytest

from qym.platform import client as client_module
from qym.platform.client import PlatformEventStream


def _limits(monkeypatch, *, batch=50):
    monkeypatch.setattr(PlatformEventStream, "MAX_BATCH_EVENTS", batch)
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 60)
    monkeypatch.setattr(PlatformEventStream, "HEARTBEAT_INTERVAL", 60)
    monkeypatch.setattr(PlatformEventStream, "CLOSE_JOIN_TIMEOUT", 5)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_BASE", 0.001)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_MAX", 0.001)


def test_partial_success_counts_refused_events_and_does_not_resend(
    monkeypatch, capsys
):
    _limits(monkeypatch)
    posts = []

    def post(url, payload, key, **kwargs):
        events = [json.loads(line) for line in payload.splitlines() if line]
        posts.append(events)
        bad = [evt for evt in events if evt["payload"].get("bad")]
        return {
            "ok": True,
            "applied": len(events) - len(bad),
            "skipped": 0,
            "rejected": len(bad),
            "rejected_events": [
                {
                    "event_id": evt["event_id"],
                    "sequence": evt["sequence"],
                    "type": evt["type"],
                    "error": "payload.latency_ms: Field required",
                }
                for evt in bad
            ],
        }

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    for i in range(3):
        stream.emit("item_completed", {"index": i, "bad": i == 1})
    stream.close()

    assert len(posts) == 1 and len(posts[0]) == 3
    assert stream.sent_events == 2
    assert stream.rejected_events == 1
    assert stream.dropped_events == 1
    # A refused event was delivered: the platform flags the run instead, so
    # the flush (and with it the run's completion) is not held (C024).
    assert stream.undelivered_events == 0
    assert stream.flush(0) is True
    err = capsys.readouterr().err
    assert "payload.latency_ms: Field required" in err
    assert "rejected by the platform" in err
    assert "failed to upload" not in err


def test_old_platform_response_without_verdict_counts_everything_sent(monkeypatch):
    _limits(monkeypatch, batch=1)
    responses = iter([None, {}, {"ok": True, "applied": 1, "skipped": 0}])
    monkeypatch.setattr(
        client_module, "_post_ndjson", lambda *args, **kwargs: next(responses)
    )
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    try:
        for i in range(3):
            stream.emit("item_started", {"index": i})
    finally:
        stream.close()
    assert (stream.sent_events, stream.dropped_events, stream.rejected_events) == (
        3,
        0,
        0,
    )


def test_sync_send_does_not_retry_a_deterministic_rejection(monkeypatch):
    attempts = []

    def post(url, payload, key, **kwargs):
        attempts.append(payload)
        body = json.dumps(
            {"rejected": 1, "rejected_events": [{"error": "final_status: bad"}]}
        ).encode()
        raise HTTPError(url, 422, "Unprocessable", None, io.BytesIO(body))

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    try:
        stream.emit("run_completed", {"final_status": "bad"}, sync=True)
    finally:
        stream.close()
    assert len(attempts) == 1
    assert stream.rejected_events == stream.dropped_events == 1
    assert "final_status: bad" in stream._first_rejection


@pytest.mark.parametrize("status", [400, 404, 422])
def test_isolated_events_are_not_retried_on_4xx(monkeypatch, status):
    _limits(monkeypatch)
    calls = []

    def post(url, payload, key, **kwargs):
        calls.append(payload)
        raise HTTPError(url, status, "rejected", None, None)

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    for i in range(3):
        stream.emit("item_started", {"index": i})
    stream.close()
    # One batch attempt, then exactly one isolated attempt per event.
    assert len(calls) == 4
    assert stream.dropped_events == 3
    assert not stream._thread.is_alive()
    # A 4xx without per-event verdicts (unknown run, a proxy's limit) says
    # nothing about the events: they count as undelivered and hold completion.
    assert stream.rejected_events == 0
    assert stream.undelivered_events == 3
    assert stream.flush(0) is False


def test_isolated_events_with_platform_verdicts_count_as_rejected(
    monkeypatch, capsys
):
    """A 422 listing the refused events is a verdict: the run may complete (C024)."""
    _limits(monkeypatch)
    calls = []

    def post(url, payload, key, **kwargs):
        events = [json.loads(line) for line in payload.splitlines() if line]
        calls.append(events)
        body = {
            "ok": False,
            "applied": 0,
            "skipped": 0,
            "rejected": len(events),
            "rejected_events": [
                {"event_id": evt["event_id"], "error": "latency_ms: Field required"}
                for evt in events
            ],
        }
        raise HTTPError(
            url, 422, "rejected", None, io.BytesIO(json.dumps(body).encode())
        )

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    stream = PlatformEventStream("http://unused.invalid", "test-only", "run-test")
    for i in range(3):
        stream.emit("item_completed", {"index": i})
    stream.close()
    assert len(calls) == 4
    assert stream.rejected_events == stream.dropped_events == 3
    assert stream.undelivered_events == 0
    assert stream.flush(0) is True
    err = capsys.readouterr().err
    assert "3 platform events were rejected by the platform" in err
    assert "latency_ms: Field required" in err


# --- Real SDK stream against the platform ingest route ---------------------

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")


@pytest.fixture
def platform(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
    from qym_platform.api import ingest
    from qym_platform.auth import Principal, require_api_key_principal
    from qym_platform.db.base import Base
    from qym_platform.db.models import Project, Run, RunWorkflowStatus, User, UserRole
    from qym_platform.deps import get_db

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    run_id = str(uuid4())
    with Session(engine) as db:
        db.add(User(id="owner", email="owner@example.invalid", role=UserRole.ADMIN))
        db.flush()
        db.add(
            Project(id="project", name="Test", slug="test", created_by_user_id="owner")
        )
        db.flush()
        db.add(
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
            )
        )
        db.commit()
    app = FastAPI()
    app.include_router(ingest.router)

    def session():
        with Session(engine, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_api_key_principal] = lambda: Principal(
        user=User(id="owner"), auth_type="api_key", project_id="project"
    )
    statuses = []
    with TestClient(app, raise_server_exceptions=False) as client:

        def post_ndjson(url, payload, key, **kwargs):
            # Behave like urllib: non-2xx responses raise HTTPError with a body.
            response = client.post(
                urlsplit(url).path,
                content=payload,
                headers={"content-type": "application/x-ndjson"},
            )
            statuses.append(response.status_code)
            if response.status_code >= 400:
                raise HTTPError(
                    url,
                    response.status_code,
                    response.text,
                    None,
                    io.BytesIO(response.content),
                )
            return response.json()

        monkeypatch.setattr(client_module, "_post_ndjson", post_ndjson)
        yield engine, run_id, statuses


def test_poison_event_reaches_platform_as_one_rejection(monkeypatch, platform):
    from sqlalchemy.orm import Session
    from qym_platform.db.models import RunEvent, RunItem

    _limits(monkeypatch, batch=200)
    engine, run_id, statuses = platform
    stream = PlatformEventStream("http://platform.invalid", "test-only", run_id)
    for i in range(199):
        if i == 100:
            # item_completed without latency_ms: invalid for the platform.
            stream.emit("item_completed", {"item_id": "item-7", "output": "x"})
        stream.emit("item_started", {"item_id": f"item-{i}", "index": i, "input": i})
    stream.close()

    assert statuses == [200]
    assert stream.sent_events == 199
    assert stream.rejected_events == stream.dropped_events == 1
    with Session(engine) as db:
        assert db.query(RunItem).count() == 199
        assert db.query(RunEvent).count() == 199


def test_poison_only_batch_is_isolated_without_retry_loop(monkeypatch, platform):
    from sqlalchemy.orm import Session
    from qym_platform.db.models import RunItem

    _limits(monkeypatch, batch=200)
    engine, run_id, statuses = platform
    stream = PlatformEventStream("http://platform.invalid", "test-only", run_id)
    stream.emit("span_completed", {"trace_id": "t", "name": "no span id"})
    stream.emit("item_completed", {"item_id": "a", "output": "x"})
    stream.close()

    # 422 for the batch, then one 422 per isolated event; no 5xx, no loop.
    assert statuses == [422, 422, 422]
    assert stream.rejected_events == 2
    assert "span_id" in stream._first_rejection
    assert not stream._thread.is_alive()
    with Session(engine) as db:
        assert db.query(RunItem).count() == 0
