"""One bad event must not fail, stall or silently shrink an ingest batch (C024)."""

from __future__ import annotations

import json
import os
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DataError, OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from qym_platform.api import ingest
from qym_platform.auth import Principal, require_api_key_principal
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
    Run,
    RunEvent,
    RunItem,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
    Span,
    User,
    UserRole,
)
from qym_platform.deps import get_db


@pytest.fixture(params=["sqlite", "postgres"])
def api(request):
    admin = None
    schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_ingest_reject_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        # Enforce foreign keys like Postgres does.
        event.listen(
            engine,
            "connect",
            lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"),
        )

    def cleanup():
        engine.dispose()
        if admin:
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()

    request.addfinalizer(cleanup)
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
                metrics=["score"],
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
    with TestClient(app, raise_server_exceptions=False) as client:

        def post(lines):
            body = "\n".join(
                line if isinstance(line, str) else json.dumps(line) for line in lines
            )
            return client.post(
                f"/v1/runs/{run_id}/events",
                content=body,
                headers={"content-type": "application/x-ndjson"},
            )

        yield engine, run_id, post


def _event(run_id, sequence, kind, payload, event_id=None):
    return {
        "schema_version": 1,
        "event_id": event_id or str(uuid4()),
        "sequence": sequence,
        "sent_at": "2026-09-05T00:00:00Z",
        "type": kind,
        "run_id": run_id,
        "payload": payload,
    }


def _started(run_id, sequence, index):
    return _event(
        run_id,
        sequence,
        "item_started",
        {"item_id": f"item-{index}", "index": index, "input": "x"},
    )


def _counts(engine):
    with Session(engine) as db:
        return db.query(RunItem).count(), db.query(RunEvent).count()


def test_poison_event_in_200_event_batch_applies_the_other_199(api):
    engine, run_id, post = api
    events = [_started(run_id, i + 1, i) for i in range(199)]
    poison = _event(
        run_id,
        200,
        "item_completed",
        {"item_id": "item-7", "output": "no latency"},
    )
    events.insert(100, poison)

    response = post(events)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["ok"] is True
    assert (body["applied"], body["skipped"], body["rejected"]) == (199, 0, 1)
    [rejection] = body["rejected_events"]
    assert rejection["line"] == 101
    assert rejection["event_id"] == poison["event_id"]
    assert rejection["sequence"] == 200
    assert rejection["type"] == "item_completed"
    assert "latency_ms" in rejection["error"]
    assert _counts(engine) == (199, 199)
    with Session(engine) as db:
        assert (
            db.query(RunEvent).filter(RunEvent.event_id == poison["event_id"]).count()
            == 0
        )

    # Redelivery (e.g. after a lost response) stays deterministic and 2xx.
    again = post(events).json()
    assert (again["applied"], again["skipped"], again["rejected"]) == (0, 199, 1)


def test_span_without_span_id_is_rejected_without_losing_its_batch(api):
    engine, run_id, post = api
    events = [
        _event(
            run_id,
            1,
            "item_completed",
            {"item_id": "a", "output": "ok", "latency_ms": 3, "trace_id": "t"},
        ),
        _event(run_id, 2, "span_completed", {"trace_id": "t", "name": "llm"}),
        _event(
            run_id,
            3,
            "span_completed",
            {"trace_id": "t", "span_id": "good", "name": "llm"},
        ),
    ]
    body = post(events).json()
    assert (body["applied"], body["rejected"]) == (2, 1)
    assert "span_id" in body["rejected_events"][0]["error"]
    with Session(engine) as db:
        assert db.query(RunItem).one().output == "ok"
        assert [row.span_id for row in db.query(Span)] == ["good"]


def test_reused_sequence_is_a_per_event_rejection(api):
    engine, run_id, post = api
    first = _started(run_id, 1, 0)
    assert post([first]).json()["applied"] == 1

    # A new event_id claiming a stored sequence, next to a valid event, and a
    # second in-batch claim of the same fresh sequence.
    reused = _started(run_id, 1, 1)
    fresh = _started(run_id, 2, 2)
    clash = _started(run_id, 2, 3)
    response = post([reused, fresh, clash])

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["applied"], body["rejected"]) == (1, 2)
    rejected = {row["event_id"]: row for row in body["rejected_events"]}
    assert set(rejected) == {reused["event_id"], clash["event_id"]}
    assert "sequence 1" in rejected[reused["event_id"]]["error"]
    assert "sequence 2" in rejected[clash["event_id"]]["error"]
    with Session(engine) as db:
        assert {row.item_id for row in db.query(RunItem)} == {"item-0", "item-2"}
        stored = {row.sequence: row.event_id for row in db.query(RunEvent)}
    assert stored == {1: first["event_id"], 2: fresh["event_id"]}
    # Redelivering the original event is still an idempotent skip.
    assert post([first]).json()["skipped"] == 1


def test_bad_envelope_lines_are_counted_and_explained(api):
    engine, run_id, post = api
    good = _started(run_id, 1, 0)
    missing = {"schema_version": 1, "type": "item_started", "run_id": run_id}
    wrong_run = _started(str(uuid4()), 2, 1)
    response = post([good, "{not json", missing, wrong_run])

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["applied"], body["skipped"], body["rejected"]) == (1, 0, 3)
    by_line = {row["line"]: row for row in body["rejected_events"]}
    assert set(by_line) == {2, 3, 4}
    assert "JSON" in by_line[2]["error"]
    assert by_line[2]["event_id"] is None
    assert "event_id" in by_line[3]["error"]
    assert by_line[3]["type"] == "item_started"
    assert "run_id" in by_line[4]["error"]
    assert by_line[4]["event_id"] == wrong_run["event_id"]
    assert _counts(engine) == (1, 1)


def test_batch_with_only_rejected_events_is_a_structured_422(api):
    engine, run_id, post = api
    response = post(
        [
            _event(run_id, 1, "item_completed", {"item_id": "a", "output": 1}),
            "[]",
        ]
    )
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["ok"] is False
    assert (body["applied"], body["skipped"], body["rejected"]) == (0, 0, 2)
    assert "2 events" in body["detail"]
    assert len(body["rejected_events"]) == 2
    assert _counts(engine) == (0, 0)


def test_out_of_range_integers_are_rejected_not_a_database_error(api):
    engine, run_id, post = api
    body = post(
        [
            _started(run_id, 1, 0),
            _started(run_id, 2**31, 1),
            _event(
                run_id,
                3,
                "item_started",
                {"item_id": "big", "index": 2**40, "input": "x"},
            ),
        ]
    ).json()
    assert (body["applied"], body["rejected"]) == (1, 2)
    errors = [row["error"] for row in body["rejected_events"]]
    assert any("sequence" in error for error in errors)
    assert any("index" in error for error in errors)
    assert _counts(engine) == (1, 1)


def test_invalid_metric_score_rejects_only_that_event(api):
    engine, run_id, post = api
    with Session(engine) as db:
        db.add(
            RunMetricSpec(
                run_id=run_id, metric_name="score", position=0, score_type="percentage"
            )
        )
        db.commit()
    bad = _event(
        run_id, 2, "metric_scored", {"item_id": "a", "metric_name": "score", "score_numeric": 4}
    )
    good = _event(
        run_id,
        3,
        "metric_scored",
        {"item_id": "a", "metric_name": "score", "score_numeric": 0.5},
    )
    body = post([_started(run_id, 1, 0), bad, good]).json()
    assert (body["applied"], body["rejected"]) == (2, 1)
    assert body["rejected_events"][0]["event_id"] == bad["event_id"]
    assert "between 0 and 1" in body["rejected_events"][0]["error"]
    with Session(engine) as db:
        assert db.query(RunItemScore).one().score_numeric == pytest.approx(0.5)


def test_conflicting_metric_spec_rejects_only_run_started(api):
    engine, run_id, post = api
    with Session(engine) as db:
        db.add(
            RunMetricSpec(
                run_id=run_id, metric_name="score", position=0, score_type="percentage"
            )
        )
        db.commit()
    started = _event(
        run_id,
        1,
        "run_started",
        {
            "task": "t",
            "dataset": "d",
            "metrics": ["score"],
            "metric_specs": {"score": {"score_type": "boolean"}},
            "started_at": "2026-09-05T00:00:00Z",
        },
    )
    body = post([started, _started(run_id, 2, 0)]).json()
    assert (body["applied"], body["rejected"]) == (1, 1)
    assert "changed during run" in body["rejected_events"][0]["error"]
    with Session(engine) as db:
        assert db.query(RunMetricSpec).one().score_type == "percentage"


def test_rejection_details_are_capped_but_the_count_is_exact(api):
    _, run_id, post = api
    lines = ["{bad"] * (ingest.MAX_REJECTION_DETAILS + 5) + [_started(run_id, 1, 0)]
    body = post(lines).json()
    assert body["applied"] == 1
    assert body["rejected"] == ingest.MAX_REJECTION_DETAILS + 5
    assert len(body["rejected_events"]) == ingest.MAX_REJECTION_DETAILS


def test_reference_to_a_deleted_dataset_item_does_not_fail_the_batch(api):
    engine, run_id, post = api
    started = _started(run_id, 1, 0)
    started["payload"]["dataset_item_pk"] = 987654
    run_started = _event(
        run_id,
        2,
        "run_started",
        {
            "task": "t",
            "dataset": "d",
            "dataset_id": "deleted-dataset",
            "dataset_version_id": "deleted-version",
            "metrics": ["score"],
            "started_at": "2026-09-05T00:00:00Z",
        },
    )
    response = post([started, run_started, _started(run_id, 3, 1)])
    assert response.status_code == 200, response.text
    assert response.json()["applied"] == 3
    with Session(engine) as db:
        assert [row.dataset_item_pk for row in db.query(RunItem)] == [None, None]
        run = db.get(Run, run_id)
        assert (run.dataset_id, run.dataset_version_id) == (None, None)


def _emulate_postgres_value_checks(engine):
    """On SQLite, refuse the values PostgreSQL refuses (NUL, too-long text).

    SQLite stores both happily, so without this the database-refusal tests
    would pass without exercising anything. PostgreSQL runs the real checks.
    """
    if engine.dialect.name != "sqlite":
        return

    def strings(parameters):
        if isinstance(parameters, dict):
            parameters = list(parameters.values())
        if isinstance(parameters, (list, tuple)):
            for value in parameters:
                yield from strings(value)
        elif isinstance(parameters, str):
            yield parameters

    def refuse(conn, cursor, statement, parameters, context, executemany):
        writes_run_items = (
            statement.lstrip()
            .upper()
            .startswith(("INSERT INTO RUN_ITEMS ", "UPDATE RUN_ITEMS "))
        )
        for value in strings(parameters):
            if "\x00" in value or "\\u0000" in value:
                raise DataError(
                    statement,
                    parameters,
                    Exception("unsupported Unicode escape sequence"),
                )
            if (
                writes_run_items
                and len(value) > 2000
                and not value.startswith(("{", "[", '"'))
            ):
                raise DataError(
                    statement,
                    parameters,
                    Exception("value too long for type character varying(2000)"),
                )

    event.listen(engine, "before_cursor_execute", refuse)


def _refused_value_event(run_id, sequence, kind):
    if kind == "nul_output":
        payload = {"item_id": "item-7", "output": "tool\x00output", "latency_ms": 1}
        return _event(run_id, sequence, "item_completed", payload)
    if kind == "long_trace_url":
        payload = {
            "item_id": "item-7",
            "output": "ok",
            "latency_ms": 1,
            "trace_id": "t",
            "trace_url": "u" * 2100,
        }
        return _event(run_id, sequence, "item_completed", payload)
    if kind == "long_label":
        payload = {
            "item_id": "item-7",
            "metric_name": "score",
            "score_numeric": 1.0,
            "label": "judge said: " + "x" * 300,
        }
        return _event(run_id, sequence, "metric_scored", payload)
    payload = {"item_id": "x" * 250, "index": 999, "input": "x"}
    return _event(run_id, sequence, "item_started", payload)


@pytest.mark.parametrize(
    "kind", ["nul_output", "long_trace_url", "long_label", "long_item_id"]
)
def test_value_the_database_refuses_rejects_only_its_event(api, kind):
    engine, run_id, post = api
    if engine.dialect.name == "sqlite" and kind in {"long_label", "long_item_id"}:
        pytest.skip("SQLite does not enforce VARCHAR lengths")
    _emulate_postgres_value_checks(engine)
    events = [_started(run_id, i + 1, i) for i in range(199)]
    poison = _refused_value_event(run_id, 200, kind)
    events.insert(100, poison)

    response = post(events)

    # This used to be a text/plain 500 on every retry, so the run stalled.
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["applied"], body["skipped"], body["rejected"]) == (199, 0, 1)
    [rejection] = body["rejected_events"]
    assert rejection["line"] == 101
    assert rejection["event_id"] == poison["event_id"]
    assert rejection["type"] == poison["type"]
    assert "database refused" in rejection["error"]
    assert _counts(engine) == (199, 199)

    again = post(events).json()
    assert (again["applied"], again["skipped"], again["rejected"]) == (0, 199, 1)


def test_refused_value_is_isolated_when_its_batch_completes_the_run(api):
    """A flush inside run_completed handling used to swallow the refusal,
    which then failed the commit as PendingRollbackError (a 500)."""
    engine, run_id, post = api
    _emulate_postgres_value_checks(engine)
    events = [
        _started(run_id, 1, 7),
        _refused_value_event(run_id, 2, "long_trace_url"),
        _event(
            run_id,
            3,
            "span_completed",
            {"trace_id": "t", "span_id": "s1", "name": "llm"},
        ),
        _event(
            run_id,
            4,
            "run_completed",
            {"ended_at": "2026-09-05T00:01:00Z", "summary": {"total_items": 1}},
        ),
    ]

    response = post(events)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["applied"], body["rejected"]) == (3, 1)
    assert body["rejected_events"][0]["line"] == 2
    with Session(engine) as db:
        assert db.get(Run, run_id).status == RunWorkflowStatus.COMPLETED
        assert [row.span_id for row in db.query(Span)] == ["s1"]


def test_transient_database_error_still_fails_the_batch_for_a_retry(api):
    engine, run_id, post = api

    def lose_connection(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("INSERT INTO RUN_ITEMS "):
            raise OperationalError(
                statement, parameters, Exception("server closed the connection")
            )

    event.listen(engine, "before_cursor_execute", lose_connection)
    try:
        response = post([_started(run_id, 1, 0), _started(run_id, 2, 1)])
    finally:
        event.remove(engine, "before_cursor_execute", lose_connection)

    # An outage is not the client's fault: it stays retryable (5xx) and is
    # never turned into rejected events.
    assert response.status_code == 500
    assert _counts(engine) == (0, 0)


@pytest.mark.parametrize("separator", [" ", " ", "\x85"])
def test_unicode_line_separator_inside_a_json_string_is_not_a_line_break(
    api, separator
):
    engine, run_id, post = api
    evt = _event(
        run_id,
        1,
        "item_started",
        {"item_id": "a", "index": 0, "input": f"first{separator}second"},
    )
    # The SDK serializes with ensure_ascii=False, which leaves these raw.
    response = post([json.dumps(evt, ensure_ascii=False)])

    assert response.status_code == 200, response.text
    assert response.json()["applied"] == 1
    with Session(engine) as db:
        assert db.query(RunItem).one().input == f"first{separator}second"


def _count_ingest_transactions(monkeypatch):
    calls = []
    original = ingest._ingest_events_sync

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(ingest, "_ingest_events_sync", counting)
    return calls


def test_isolation_cost_is_bounded_for_an_all_refused_batch(api, monkeypatch):
    """Splitting costs at most 2N-1 transactions, and N is capped."""
    engine, run_id, post = api
    _emulate_postgres_value_checks(engine)
    monkeypatch.setattr(ingest, "MAX_ISOLATED_BATCH_EVENTS", 40)
    calls = _count_ingest_transactions(monkeypatch)
    refused = [
        _event(
            run_id,
            i + 1,
            "item_started",
            {"item_id": f"item-{i}", "index": i, "input": "bad\x00value"},
        )
        for i in range(40)
    ]

    response = post(refused)

    assert response.status_code == 422, response.text
    assert response.json()["rejected"] == 40
    assert len(calls) <= 2 * 40 - 1
    assert _counts(engine) == (0, 0)


def test_oversized_batch_with_a_refused_value_is_not_split(api, monkeypatch):
    engine, run_id, post = api
    _emulate_postgres_value_checks(engine)
    monkeypatch.setattr(ingest, "MAX_ISOLATED_BATCH_EVENTS", 40)
    calls = _count_ingest_transactions(monkeypatch)
    events = [_started(run_id, i + 1, i) for i in range(41)]
    events[20] = _refused_value_event(run_id, 21, "nul_output")

    response = post(events)

    # One transaction, then a 4xx the SDK answers by resending event by event.
    assert response.status_code == 413, response.text
    assert "smaller batches" in response.json()["detail"]
    assert len(calls) == 1
    assert _counts(engine) == (0, 0)

    # A clean batch of the same size still applies in one transaction.
    calls.clear()
    clean = [_started(run_id, i + 1, i) for i in range(41)]
    assert post(clean).json()["applied"] == 41
    assert len(calls) == 1
