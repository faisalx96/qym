import json
import os

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from qym_platform.api import ingest
from qym_platform.auth import Principal
from qym_platform.db.base import Base
from qym_platform.db.models import Project, Run, RunEvent, RunWorkflowStatus, Span, User, UserRole
from qym_platform.services import event_storage
from qym_platform.settings import PlatformSettings


@pytest.fixture
def database(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = Session(engine)
    db.add(User(id="owner", email="o@example.test", display_name="O", role=UserRole.ADMIN))
    db.flush()
    db.add(Project(id="project", name="P", slug="p", created_by_user_id="owner"))
    run = Run(
        id="11111111-1111-4111-8111-111111111111",
        project_id="project",
        created_by_user_id="owner",
        owner_user_id="owner",
        task="t",
        dataset="d",
        metrics=["m"],
        status=RunWorkflowStatus.RUNNING,
    )
    db.add(run)
    db.commit()
    principal = Principal(user=db.get(User, "owner"), auth_type="api_key", project_id="project")
    yield engine, db, run, principal
    db.close()
    engine.dispose()


def _event(run, sequence, event_type, payload):
    return {
        "schema_version": 1,
        "event_id": f"00000000-0000-0000-0000-{sequence:012d}",
        "sequence": sequence,
        "sent_at": "2026-09-14T00:00:00Z",
        "type": event_type,
        "run_id": run.id,
        "payload": payload,
    }


def _apply(engine, run, principal, events):
    body = "\n".join(json.dumps(e) for e in events).encode()
    return json.loads(ingest._ingest_events_worker(run.id, body, engine, principal).body)


def _use_settings(monkeypatch, **overrides):
    settings = PlatformSettings(database_url="sqlite://", **overrides)
    monkeypatch.setattr(event_storage, "ingest_settings", lambda: settings)
    monkeypatch.setattr(ingest, "ingest_settings", lambda: settings)


def test_structural_payload_drops_only_redundant_bodies():
    started = {"item_id": "a", "index": 0, "input": {"q": "x" * 100}, "expected": "y", "item_metadata": {"k": 1}}
    out = event_storage.structural_event_payload("item_started", started)
    assert out == {"item_id": "a", "index": 0, event_storage.STRIPPED_MARKER: True}
    scored = {"item_id": "a", "metric_name": "m", "score_numeric": 0.5, "score_raw": {"s": 0.5}, "meta": {"status": "ok"}, "explanation": "long"}
    out = event_storage.structural_event_payload("metric_scored", scored)
    assert out["score_numeric"] == 0.5 and "explanation" not in out and "meta" not in out
    # unknown / structural-only events are untouched and unmarked
    hb = {"heartbeat_at": "2026-09-14T00:00:00Z"}
    assert event_storage.structural_event_payload("run_heartbeat", hb) == hb
    assert event_storage.STRIPPED_MARKER not in event_storage.structural_event_payload("item_attempt_started", {"item_id": "a", "attempt_number": 1})


def test_oversized_span_keeps_scalar_attributes():
    attrs = {
        "openinference.span.kind": "LLM",
        "qym.usage_scope": "metric",
        "llm.model_name": "gpt-4o-mini",
        "llm.token_count.total": 1234,
        "input.value": "x" * 5000,
        "llm.input_messages.0.message.content": "y" * 4000,
        "nested": {"a": 1},
    }
    kept = event_storage.oversized_span_attributes(attrs, 5_000_000)
    assert kept["openinference.span.kind"] == "LLM"
    assert kept["llm.token_count.total"] == 1234
    assert "input.value" not in kept and "nested" not in kept
    assert kept[event_storage.OVERSIZED_MARKER] is True
    assert kept[event_storage.OVERSIZED_BYTES] == 5_000_000


def test_ingest_stores_span_once_and_bodies_by_mode(database, monkeypatch):
    engine, db, run, principal = database
    _use_settings(monkeypatch, event_log_mode="full")
    events = [
        _event(run, 1, "item_started", {"item_id": "a", "index": 0, "input": {"q": "hello"}, "expected": "w"}),
        _event(run, 2, "span_completed", {"trace_id": "t", "span_id": "s1", "name": "llm", "attributes": {"openinference.span.kind": "LLM", "input.value": "big" * 100}}),
        _event(run, 3, "item_completed", {"item_id": "a", "output": "done", "latency_ms": 5, "trace_id": "t"}),
    ]
    assert _apply(engine, run, principal, events) == {"ok": True, "applied": 3, "skipped": 0}
    db.expire_all()
    assert db.query(Span).count() == 1
    stored = {e.type: e.payload for e in db.query(RunEvent).all()}
    assert set(stored) == {"item_started", "item_completed"}
    assert stored["item_started"]["input"] == {"q": "hello"}  # full mode keeps bodies

    # Redelivering the span (new event id, same span_id) is a no-op and counts as skipped.
    again = _event(run, 4, "span_completed", events[1]["payload"])
    assert _apply(engine, run, principal, [again]) == {"ok": True, "applied": 0, "skipped": 1}
    assert db.query(Span).count() == 1

    _use_settings(monkeypatch, event_log_mode="structural")
    more = [_event(run, 5, "item_completed", {"item_id": "b", "output": "x" * 500, "latency_ms": 5})]
    assert _apply(engine, run, principal, more)["applied"] == 1
    db.expire_all()
    row = db.query(RunEvent).filter(RunEvent.sequence == 5).one()
    assert "output" not in row.payload and row.payload[event_storage.STRIPPED_MARKER] is True
    assert row.payload["item_id"] == "b" and row.payload["latency_ms"] == 5


def test_ingest_applies_span_ceiling(database, monkeypatch):
    engine, db, run, principal = database
    _use_settings(monkeypatch, span_max_bytes=65_536)
    huge = _event(
        run,
        1,
        "span_completed",
        {"trace_id": "t", "span_id": "big", "name": "llm", "attributes": {"openinference.span.kind": "LLM", "llm.token_count.total": 7, "input.value": "z" * 70_000}},
    )
    assert _apply(engine, run, principal, [huge])["applied"] == 1
    span = db.query(Span).one()
    assert span.attributes[event_storage.OVERSIZED_MARKER] is True
    assert span.attributes["llm.token_count.total"] == 7
    assert "input.value" not in span.attributes
