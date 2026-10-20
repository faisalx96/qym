"""Round 7 (Q2): ``GET /api/runs/{id}/passes`` runs a fixed number of SQL statements, whatever the run's size.

The runs table now prefetches the passes of every repeat run on a page, so a per-pass or per-item query (an N+1) would be
paid up to 20 times per list view. The statement count is pinned: it is the same at 20 and at 80 items, at most 28 (the count
measured on the seeded 10 x 300 and 10 x 1,200 runs), and the handler's time stays linear in item-passes at the
measured 22 to 41 us each (qa.md Q2-3: 66 ms for 3,000 item-passes, 322 ms for 12,000).
"""

from __future__ import annotations

import json
import os
import statistics
import time
import uuid

import pytest
from _helpers import _make_env
from fastapi.testclient import TestClient
from qym_platform.api.runs import run_passes
from qym_platform.auth import Principal
from qym_platform.db.models import User
from sqlalchemy import event
from test_repeat_runs_platform import RUN_ID, _seed

STRICT = os.environ.get("QYM_PERF_STRICT") == "1"
TOKEN = "statements-token"
MAX_STATEMENTS = 28
# measured 41 ms for 1,000 item-passes in this ingest-built fixture (the seeded 10 x 300 run: 66 ms for 3,000); the CI margin is 4x
PER_1000_ITEM_PASSES_MS = 50 if STRICT else 200


def _event(seq: int, type_: str, payload: dict) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            "event_id": str(uuid.uuid4()),
            "sequence": seq,
            "sent_at": "2026-07-04T00:00:00Z",
            "type": type_,
            "run_id": RUN_ID,
            "payload": payload,
        }
    )


def _events(items: int, passes: int) -> str:
    lines: list[str] = []
    seq = 0

    def push(type_: str, payload: dict) -> None:
        nonlocal seq
        seq += 1
        lines.append(_event(seq, type_, payload))

    for p in range(1, passes + 1):
        for i in range(items):
            item_id = f"item-{i:04d}"
            trace_id = f"trace-{item_id}-p{p}"
            push(
                "item_started",
                {"item_id": item_id, "index": i, "pass_number": p, "input": {"q": i}},
            )
            push(
                "item_attempt_started",
                {
                    "item_id": item_id,
                    "index": i,
                    "pass_number": p,
                    "attempt_number": 1,
                    "trace_id": trace_id,
                    "task_started_at_ms": 1_700_000_000_000 + (p * items + i) * 40,
                },
            )
            push(
                "metric_scored",
                {
                    "item_id": item_id,
                    "pass_number": p,
                    "metric_name": "accuracy",
                    "score_numeric": float((i + p) % 2),
                    "meta": {},
                },
            )
            push(
                "item_completed",
                {
                    "item_id": item_id,
                    "index": i,
                    "pass_number": p,
                    "is_final_pass": p == passes,
                    "output": f"out-{i}",
                    "latency_ms": 100.0 + i,
                    "trace_id": trace_id,
                },
            )
            push(
                "item_attempt_finished",
                {
                    "item_id": item_id,
                    "pass_number": p,
                    "attempt_number": 1,
                    "status": "completed",
                    "latency_ms": 100.0 + i,
                    "is_last_attempt": True,
                },
            )
        push(
            "pass_completed",
            {"pass_number": p, "samples": passes, "metrics": {"accuracy": 0.5}},
        )
    return "\n".join(lines) + "\n"


def _build(items: int, passes: int):
    app, factory = _make_env()
    with factory() as session:
        _seed(session, token=TOKEN, samples=passes)
    with TestClient(app) as client:
        response = client.post(
            f"/v1/runs/{RUN_ID}/events",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/x-ndjson",
            },
            content=_events(items, passes),
        )
        assert response.status_code == 200, response.text
    return factory


def _call(factory):
    """One `run_passes` call: (statement count, milliseconds, payload)."""
    engine = factory.kw["bind"]
    statements: list[str] = []

    def count(
        conn, cursor, statement, parameters, context, executemany
    ):  # noqa: ANN001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        with factory() as session:
            user = session.query(User).filter(User.id == "user-1").one()
            principal = Principal(
                user=user, auth_type="api_key", scopes=(), project_id="project-1"
            )
            started = time.perf_counter()
            payload = run_passes(RUN_ID, db=session, principal=principal)
            return len(statements), (time.perf_counter() - started) * 1000, payload
    finally:
        event.remove(engine, "before_cursor_execute", count)


def test_passes_statement_count_does_not_grow_with_the_run():
    small = _call(_build(20, 3))
    large = _call(_build(80, 3))
    assert small[2]["samples"] == large[2]["samples"] == 3
    assert [p["items_total"] for p in large[2]["passes"]] == [80, 80, 80]
    assert (
        small[0] == large[0]
    ), f"statements: {small[0]} at 20 items, {large[0]} at 80 (an N+1 crept in)"
    assert large[0] <= MAX_STATEMENTS, f"{large[0]} statements"


def test_passes_time_stays_linear_in_item_passes():
    factory = _build(100, 10)  # 1,000 item-passes
    _call(factory)  # warm the import graph and the connection
    times = [_call(factory)[1] for _ in range(5)]
    median = statistics.median(times)
    assert (
        median <= PER_1000_ITEM_PASSES_MS
    ), f"median {median:.1f} ms of {[round(t, 1) for t in times]}"


# qa.md Q2-3 (amended in round 7): /passes at 10 passes x 1,200 / x 300 items, median of 9 requests. The spec ceilings
# (340 / 80 ms) are measured on the production seed with redesign7/measure/passes_profile.py (316 / 67 ms implementer,
# 324 / 68 ms reviewer). This fixture is built through the ingest API in memory and is about 3x slower on the same
# handler (review: 866 / 209 ms), so the numbers asserted here are calibrated to the fixture: 950 / 250 ms strict
# (QYM_PERF_STRICT=1, a quiet machine), 4x that as the CI margin on a shared machine. The seed numbers are the
# product criterion; this test guards the handler against regressing by more than its fixture-to-seed ratio.
Q2_3_MS = {1200: 950 if STRICT else 3800, 300: 250 if STRICT else 1000}


@pytest.mark.parametrize("items", [300, 1200])
def test_passes_ceiling_at_the_seeded_sizes(items):
    factory = _build(items, 10)
    _call(factory)  # warm
    runs = [_call(factory) for _ in range(9)]
    median = statistics.median(ms for _, ms, _ in runs)
    assert {n for n, _, _ in runs} == {runs[0][0]} and runs[0][0] <= MAX_STATEMENTS
    assert (
        median <= Q2_3_MS[items]
    ), f"{items} items: median {median:.1f} ms of {[round(ms) for _, ms, _ in runs]}"
