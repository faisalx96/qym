"""Ingest stays bounded in memory and short on the run lock (OOM / lock timeouts)."""

from __future__ import annotations

import asyncio
import json
import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
from qym_platform.api import ingest
from qym_platform.auth import Principal
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
    Run,
    RunEvent,
    RunItem,
    RunOrigin,
    RunTraceSummary,
    RunWorkflowStatus,
    Span,
    User,
    UserRole,
)
from qym_platform.services import trace_statistics


@pytest.fixture
def database():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as db:
        owner = User(id="owner", email="owner@example.invalid", role=UserRole.ADMIN)
        project = Project(
            id="project", name="Test", slug="test", created_by_user_id=owner.id
        )
        run = Run(
            id=str(uuid4()),
            project_id=project.id,
            owner_user_id=owner.id,
            created_by_user_id=owner.id,
            task="test",
            dataset="test",
            metrics=["score"],
            samples=1,
            status=RunWorkflowStatus.RUNNING,
            run_metadata={},
            run_config={},
        )
        db.add(owner)
        db.flush()
        db.add(project)
        db.flush()
        db.add(run)
        db.commit()
        yield engine, db, run, Principal(
            user=owner, auth_type="api_key", project_id=project.id
        )
    engine.dispose()


def _event(run, sequence, kind, payload):
    return dict(
        schema_version=1,
        run_id=run.id,
        event_id=str(uuid4()),
        sequence=sequence,
        sent_at="2026-09-05T00:00:00Z",
        type=kind,
        payload=payload,
    )


def _apply(db, run, principal, events):
    body = "\n".join(json.dumps(value) for value in events).encode()
    return json.loads(ingest._ingest_events_sync(run.id, body, db, principal).body)


def _heartbeat(run, sequence):
    return _event(
        run, sequence, "run_heartbeat", {"heartbeat_at": "2026-09-05T00:00:00Z"}
    )


def _item_with_span(run, sequence, item_id, trace_id, tokens=10):
    return [
        _event(
            run,
            sequence,
            "item_completed",
            dict(item_id=item_id, output="ok", latency_ms=1, trace_id=trace_id),
        ),
        _event(
            run,
            sequence + 1,
            "span_completed",
            dict(
                trace_id=trace_id,
                span_id=f"s-{item_id}",
                name="llm",
                attributes={
                    "openinference.span.kind": "LLM",
                    "llm.token_count.total": tokens,
                },
            ),
        ),
    ]


# -- request body cap ------------------------------------------------------------


def _small_body_limit(monkeypatch):
    # ingest_settings() is cached per process; patch the reference ingest uses.
    from qym_platform.settings import PlatformSettings

    settings = PlatformSettings(max_ingest_body_bytes=131_072)
    monkeypatch.setattr(ingest, "ingest_settings", lambda: settings)


class _Request:
    def __init__(self, chunks, length=None):
        self._chunks = chunks
        self.headers = {} if length is None else {"content-length": str(length)}

    async def stream(self):
        for chunk in self._chunks:
            yield chunk


def test_body_over_declared_content_length_is_refused_with_413():
    request = _Request([b"x" * 10], length=1_000)
    with pytest.raises(HTTPException) as refused:
        asyncio.run(ingest._read_ingest_body(request, 100))
    assert refused.value.status_code == 413


def test_streamed_body_is_counted_while_read():
    # No (or a lying) Content-Length: the stream itself is capped.
    request = _Request([b"x" * 60, b"x" * 60, b"never read"])
    with pytest.raises(HTTPException) as refused:
        asyncio.run(ingest._read_ingest_body(request, 100))
    assert refused.value.status_code == 413
    assert asyncio.run(ingest._read_ingest_body(_Request([b"ab", b"cd"], 4), 4)) == (
        b"abcd"
    )


def test_events_endpoint_returns_413_for_oversized_body(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from qym_platform.auth import require_api_key_principal
    from qym_platform.deps import get_db

    _small_body_limit(monkeypatch)
    app = FastAPI()
    app.include_router(ingest.router)
    reached = []
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[require_api_key_principal] = lambda: reached.append(1)
    client = TestClient(app)
    response = client.post(f"/v1/runs/{uuid4()}/events", content=b"x" * 200_000)
    assert response.status_code == 413
    assert "QYM_MAX_INGEST_BODY_BYTES" in response.json()["detail"]


def test_oversized_line_is_rejected_before_parsing(database, monkeypatch):
    _, db, run, principal = database
    _small_body_limit(monkeypatch)
    loads = []
    original = json.loads
    monkeypatch.setattr(
        ingest.json,
        "loads",
        lambda text, *a, **k: loads.append(len(text)) or original(text, *a, **k),
    )
    big = _event(
        run, 1, "item_completed", dict(item_id="big", output="x" * 70_000, latency_ms=1)
    )
    small = _event(
        run, 2, "item_completed", dict(item_id="ok", output="y", latency_ms=1)
    )
    result = _apply(db, run, principal, [big, small])
    assert (result["applied"], result["rejected"]) == (1, 1)
    assert result["rejected_events"][0]["line"] == 1
    assert "character limit" in result["rejected_events"][0]["error"]
    assert all(size < 65_536 for size in loads)
    assert [item.item_id for item in db.query(RunItem)] == ["ok"]


# -- heartbeat fast path -----------------------------------------------------------


def test_heartbeat_only_batch_is_one_short_update(database):
    engine, db, run, principal = database
    run_id = run.id
    statements = []
    event.listen(
        engine,
        "before_cursor_execute",
        lambda conn, cursor, statement, *args: statements.append(statement),
    )
    beats = [_heartbeat(run, 1), _heartbeat(run, 2)]
    result = _apply(db, run, principal, beats)
    assert (result["applied"], result["skipped"], result["rejected"]) == (2, 0, 0)
    writes = [
        sql for sql in statements if sql.lstrip().startswith(("UPDATE", "INSERT"))
    ]
    # One guarded UPDATE of the run and one event-log INSERT (plus the
    # dashboard notification rows); none of the batch machinery runs.
    assert len([sql for sql in writes if sql.lstrip().startswith("UPDATE runs")]) == 1
    assert len([sql for sql in writes if "INTO run_events" in sql]) == 1
    assert not [sql for sql in statements if "run_metric_specs" in sql]
    db.expire_all()
    assert db.get(Run, run_id).last_event_at is not None
    assert db.query(RunEvent).count() == 2
    # A redelivered heartbeat batch is skipped, not stored twice.
    again = _apply(db, run, principal, beats)
    assert (again["applied"], again["skipped"]) == (0, 2)
    assert db.query(RunEvent).count() == 2


def test_heartbeat_with_other_events_takes_the_regular_path(database):
    _, db, run, principal = database
    result = _apply(
        db,
        run,
        principal,
        [
            _heartbeat(run, 1),
            _event(
                run, 2, "item_completed", dict(item_id="a", output="ok", latency_ms=1)
            ),
        ],
    )
    assert result["applied"] == 2
    assert db.query(RunEvent).count() == 2


def test_heartbeat_on_non_running_run_takes_the_regular_path(database):
    _, db, run, principal = database
    run.status = RunWorkflowStatus.STOPPED
    run.status_reason = "lease_timeout"
    db.commit()
    _apply(db, run, principal, [_heartbeat(run, 1)])
    db.refresh(run)
    # The regular path reopens a soft-stopped run, as before.
    assert run.status == RunWorkflowStatus.RUNNING
    assert db.query(RunEvent).count() == 1


def test_heartbeat_fast_path_refuses_foreign_principal(database):
    _, db, run, principal = database
    stranger = User(id="stranger", email="s@example.invalid", role=UserRole.MEMBER)
    db.add(stranger)
    db.commit()
    with pytest.raises(HTTPException) as refused:
        _apply(
            db,
            run,
            Principal(user=stranger, auth_type="api_key", project_id="project"),
            [_heartbeat(run, 1)],
        )
    assert refused.value.status_code == 403


# -- trace statistics on run_completed ------------------------------------------------


def test_run_completed_refreshes_incrementally(database, monkeypatch):
    _, db, run, principal = database
    events = []
    for index in range(5):
        events += _item_with_span(run, 1 + 2 * index, f"i{index}", f"t{index}")
    _apply(db, run, principal, events)
    assert db.get(RunTraceSummary, run.id) is not None

    rebuilds = []
    monkeypatch.setattr(
        trace_statistics, "_rebuild", lambda *a, **k: rebuilds.append(k)
    )
    _apply(
        db,
        run,
        principal,
        _item_with_span(run, 20, "late", "t-late", tokens=40)
        + [
            _event(
                run,
                30,
                "run_completed",
                dict(
                    final_status="COMPLETED",
                    ended_at="2026-09-05T00:01:00Z",
                    summary={"total_items": 6},
                ),
            )
        ],
    )
    assert rebuilds == []
    assert run.status == RunWorkflowStatus.COMPLETED
    assert run.run_metadata["trace_stats"]["avg_tokens"] == pytest.approx(15)


def test_run_completed_without_ledger_uses_bounded_backfill(database, monkeypatch):
    _, db, run, principal = database
    run_id = run.id
    for index in range(3):
        db.add(
            RunItem(
                run_id=run.id,
                item_id=f"i{index}",
                index=index,
                input={"big": "x" * 1000},
                item_metadata={},
                trace_id=f"t{index}",
            )
        )
        db.add(
            Span(
                run_id=run.id,
                trace_id=f"t{index}",
                span_id=f"s{index}",
                name="llm",
                attributes={
                    "openinference.span.kind": "LLM",
                    "llm.token_count.total": 10,
                },
                events=[{"big": "y" * 1000}],
                links=[],
            )
        )
    db.commit()
    modes = []
    original = trace_statistics._rebuild
    monkeypatch.setattr(
        trace_statistics,
        "_rebuild",
        lambda *a, **k: modes.append(k["full"]) or original(*a, **k),
    )
    loaded = []
    event.listen(db, "loaded_as_persistent", lambda session, obj: loaded.append(obj))
    _apply(
        db,
        run,
        principal,
        [
            _event(
                run,
                1,
                "run_completed",
                dict(
                    final_status="COMPLETED",
                    ended_at="2026-09-05T00:01:00Z",
                    summary={},
                ),
            )
        ],
    )
    assert modes == [False]
    # Items and spans are streamed as projected columns, never ORM entities.
    assert not [obj for obj in loaded if isinstance(obj, (RunItem, Span))]
    assert run.run_metadata["trace_stats"]["avg_tokens"] == 10
    assert all(
        item.item_metadata["trace_stats"]["tokens"] == 10 for item in db.query(RunItem)
    )


def test_failed_completion_refresh_keeps_the_ledger(database, monkeypatch):
    _, db, run, principal = database
    _apply(db, run, principal, _item_with_span(run, 1, "a", "t"))

    def fail(*args, **kwargs):
        raise ValueError("statement timeout")

    monkeypatch.setattr(ingest, "_refresh_live_trace_stats", fail)
    _apply(
        db,
        run,
        principal,
        _item_with_span(run, 3, "b", "u")
        + [
            _event(
                run,
                5,
                "run_completed",
                dict(
                    final_status="COMPLETED",
                    ended_at="2026-09-05T00:01:00Z",
                    summary={},
                ),
            )
        ],
    )
    summary = db.get(RunTraceSummary, run.id)
    db.refresh(summary)
    assert summary.totals["items"] == 1  # previous ledger kept
    stale = summary.totals["_stale"]
    assert stale["traces"] == ["u"] and stale["items"] == ["b"]
    assert stale["failures"] == 1
    assert run.status == RunWorkflowStatus.COMPLETED


def test_stale_marker_overflow_asks_for_a_full_rebuild():
    stale = trace_statistics._merge_stale(
        None,
        {f"t{i}" for i in range(trace_statistics.STALE_MAX_IDS + 1)},
        set(),
        failed=True,
        now=0,
    )
    assert stale["rebuild"] == "full" and "traces" not in stale
    again = trace_statistics._merge_stale(stale, {"x"}, {"y"}, failed=True, now=0)
    assert again["failures"] == 2
    assert again["retry_at"] == 2 * trace_statistics.STALE_BACKOFF_BASE_SECONDS


# -- score index refresh -----------------------------------------------------------


def test_sync_run_scores_skips_batches_that_cannot_change_scores(database, monkeypatch):
    _, db, run, principal = database
    run.origin = RunOrigin.OFFICIAL
    run.status = RunWorkflowStatus.COMPLETED
    db.commit()
    calls = []
    monkeypatch.setattr(ingest, "sync_run_scores", lambda db, run: calls.append(run.id))
    _apply(
        db,
        run,
        principal,
        [
            _event(
                run,
                1,
                "span_completed",
                dict(trace_id="t", span_id="late", name="x"),
            )
        ],
    )
    assert calls == []
    _apply(
        db,
        run,
        principal,
        [
            _event(
                run,
                2,
                "metric_scored",
                dict(item_id="a", metric_name="score", score_numeric=1.0),
            )
        ],
    )
    assert calls == [run.id]
