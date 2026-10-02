"""C034: a live summary refresh reads only its own run's projection records.

refresh_run_summary() re-aggregates per-metric sums on every event batch. The
item lookup used to have no run predicate, so each refresh scanned every item
record in the database (O(history)). These tests pin the statement to the run
(SQL shape on SQLite, rows examined on PostgreSQL) and keep its numbers.
"""

from __future__ import annotations

import json
import os
import types
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, insert, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from qym_platform.db.dashboard_models import DashboardRecordState as Record
from qym_platform.services.dashboard_summaries import _metric_totals_statement

CLASSIC = types.SimpleNamespace(samples=1, status="COMPLETED")
REPEAT = types.SimpleNamespace(samples=3, status="COMPLETED")


def _rows(project, run, items, metrics, *, item_error=lambda n: 0, score=lambda n, m: 0.5):
    rows = []
    for n in range(items):
        key = f"{run}:item-{n}"
        rows.append(
            dict(project_key=project, run_key=run, record_key=key, metric_key="",
                 record_kind="item", error=item_error(n), latency_ms=10.0 + n,
                 score=None, present=True)
        )
        for m in range(metrics):
            rows.append(
                dict(project_key=project, run_key=run, record_key=key, metric_key=f"m{m}",
                     record_kind="score", error=0, latency_ms=None, score=score(n, m),
                     present=True)
            )
    return rows


def test_statement_correlates_items_on_the_run_and_matches_partial_indexes() -> None:
    sql = str(
        _metric_totals_statement("run-1", CLASSIC).compile(dialect=postgresql.dialect())
    )
    # The item lookup is a semi-join on the scored record's own run.
    assert "EXISTS (SELECT" in sql
    assert "dashboard_record_state_1.run_key = dashboard_record_state.run_key" in sql
    # `present IS true` cannot use the `WHERE present AND ...` partial indexes.
    assert "IS true" not in sql


def test_metric_totals_count_only_counted_items_of_the_run() -> None:
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Record.__table__.create(engine)
    with engine.begin() as conn:
        # Item 0 has a task error: classic runs leave its scores out.
        conn.execute(
            insert(Record),
            _rows("p", "run-1", 3, 2, item_error=lambda n: 1 if n == 0 else 0,
                  score=lambda n, m: float(n)),
        )
        # Another run with the SAME record keys must never leak in.
        conn.execute(
            insert(Record),
            [dict(row, run_key="run-2", project_key="p2") for row in _rows("p", "run-1", 3, 2)],
        )
    with Session(engine) as db:
        classic = {
            metric: (total, count)
            for metric, total, count, *_ in db.execute(_metric_totals_statement("run-1", CLASSIC))
        }
        repeat = {
            metric: (total, count)
            for metric, total, count, *_ in db.execute(_metric_totals_statement("run-1", REPEAT))
        }
    assert classic == {"m0": (3.0, 2), "m1": (3.0, 2)}
    assert repeat == {"m0": (3.0, 3), "m1": (3.0, 3)}


@pytest.fixture
def postgres_engine():
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_c034_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Record.__table__.create(engine)
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _rows_examined(plan: dict) -> int:
    """Rows every dashboard_record_state node produced or filtered away."""
    total = 0
    if plan.get("Relation Name") == "dashboard_record_state":
        per_loop = (
            plan.get("Actual Rows", 0)
            + plan.get("Rows Removed by Filter", 0)
            + plan.get("Rows Removed by Index Recheck", 0)
        )
        total += per_loop * plan.get("Actual Loops", 1)
    for child in plan.get("Plans", []):
        total += _rows_examined(child)
    return total


@pytest.mark.parametrize("items,metrics", [(40, 3), (400, 12)])
def test_refresh_cost_is_bounded_by_the_run_not_the_history(postgres_engine, items, metrics):
    with postgres_engine.begin() as conn:
        history = []
        for run in range(30):
            history.extend(_rows(f"proj-{run % 3}", f"old-run-{run}", 150, 4))
        conn.execute(insert(Record), history)
        conn.execute(insert(Record), _rows("proj-0", "live-run", items, metrics))
        conn.execute(text("ANALYZE dashboard_record_state"))
    statement = _metric_totals_statement("live-run", CLASSIC)
    compiled = str(
        statement.compile(postgres_engine, compile_kwargs={"literal_binds": True})
    )
    with postgres_engine.connect() as conn:
        plan = conn.exec_driver_sql(
            "EXPLAIN (ANALYZE, FORMAT JSON) " + compiled
        ).scalar()
        rows = conn.execute(statement).all()
    plan = plan if isinstance(plan, list) else json.loads(plan)
    examined = _rows_examined(plan[0]["Plan"])
    run_rows = items * (metrics + 1)
    history_rows = 30 * 150 * 5
    assert len(rows) == metrics
    assert "Seq Scan on dashboard_record_state" not in json.dumps(plan) or examined <= 3 * run_rows
    # O(run): a few lookups per scored record, never the other runs' records.
    assert examined <= 3 * run_rows, (examined, run_rows, history_rows)
