import os

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from qym_platform.testing.query_budget import (
    assert_no_source_scan,
    assert_query_budget,
    record_queries,
)


@pytest.fixture
def engine():
    eng = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE run_events (id INTEGER PRIMARY KEY, run_id TEXT)"))
        conn.execute(text("CREATE TABLE runs (id TEXT PRIMARY KEY)"))
    yield eng
    eng.dispose()


def test_record_queries_counts_statements_and_tables(engine):
    with record_queries(engine) as log:
        with engine.connect() as conn:
            conn.execute(text("SELECT id FROM runs"))
            conn.execute(text("SELECT count(*) FROM run_events WHERE run_id = 'r'"))
    assert log.count == 2
    assert log.tables_touched == {"runs", "run_events"}
    assert len(log.touching("run_events")) == 1
    assert log.total_ms >= 0
    assert "2 statements" in log.summary()


def test_recording_stops_after_context(engine):
    with record_queries(engine) as log:
        pass
    with engine.connect() as conn:
        conn.execute(text("SELECT id FROM runs"))
    assert log.count == 0


def test_budget_assertions_list_offending_sql(engine):
    with record_queries(engine) as log:
        with engine.connect() as conn:
            conn.execute(text("SELECT id FROM runs"))
            conn.execute(text("SELECT id FROM run_events"))
    assert_query_budget(log, max_statements=2)
    with pytest.raises(AssertionError, match="exceeds budget"):
        assert_query_budget(log, max_statements=1)
    with pytest.raises(AssertionError, match="run_events"):
        assert_no_source_scan(log)
    with pytest.raises(AssertionError, match="forbidden SQL"):
        assert_query_budget(log, forbid_sql=["count(*)"] if False else ["from run_events"])


def test_delete_and_update_tables_are_detected(engine):
    with record_queries(engine) as log:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM run_events WHERE run_id = 'x'"))
            conn.execute(text("UPDATE runs SET id = id WHERE id = 'x'"))
    assert log.tables_touched == {"run_events", "runs"}
