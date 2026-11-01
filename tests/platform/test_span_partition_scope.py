"""C184: span reads carry the partition key, and the summary shape rescan runs after a deploy only."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import sessionmaker

from qym_platform.services import dashboard_summaries as service
from qym_platform.services.span_scope import span_run_clause

CREATED = datetime(2026, 10, 15, 12, 0, 0)


def _db(dialect: str):
    return SimpleNamespace(get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name=dialect)))


def test_postgres_span_reads_name_the_partition_key():
    clause = span_run_clause(_db("postgresql"), "r1", CREATED)
    sql = str(clause.compile(dialect=postgresql.dialect()))
    assert "spans.run_id" in sql and "spans.run_created_at" in sql


def test_sqlite_and_unknown_created_at_keep_the_run_id_filter():
    for db, created in ((_db("sqlite"), CREATED), (_db("postgresql"), None)):
        sql = str(span_run_clause(db, "r1", created).compile(dialect=sqlite.dialect()))
        assert "run_created_at" not in sql and "spans.run_id" in sql


def test_summary_shape_rescan_runs_every_30_s_after_a_start_then_hourly(monkeypatch):
    import qym_platform.db.dashboard_models  # noqa: F401 (registers the tables)
    import qym_platform.db.models  # noqa: F401
    from qym_platform.db.base import Base

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    worker = service.DashboardSummaryWorker(sessionmaker(bind=engine))
    calls = []
    monkeypatch.setattr(service, "reconcile_expired_dashboard_runs", lambda db, limit: 0)
    monkeypatch.setattr(service, "bootstrap_partitions", lambda db, limit: 0)
    monkeypatch.setattr(service, "reconcile_summary_shapes", lambda db, limit: calls.append(1) or 0)
    monkeypatch.setattr(service, "scheduled_partitions", lambda db, limit: [])
    clock = {"now": 1000.0}
    monkeypatch.setattr(service.time, "monotonic", lambda: clock["now"])
    worker._started = 1000.0
    for second in range(0, 600, 10):  # the first 10 minutes: every 30 s
        clock["now"] = 1000.0 + second
        worker.tick()
    assert len(calls) == 20
    calls.clear()
    for second in range(service.SHAPE_CHECK_WINDOW, service.SHAPE_CHECK_WINDOW + 7200, 10):
        clock["now"] = 1000.0 + second
        worker.tick()
    assert 2 <= len(calls) <= 3  # hourly once the deploy window is over
