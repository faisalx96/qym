import os
from datetime import datetime, timedelta

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from qym_platform.services import retention

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def migrated_postgres(monkeypatch):
    """A schema built by the real Alembic chain (partitioned spans, cascades)."""
    from uuid import uuid4

    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_ret_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    from sqlalchemy.engine import make_url

    scoped = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("QYM_DATABASE_URL", scoped.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    config = Config()
    config.set_main_option("script_location", os.path.join(REPO, "packages", "platform", "qym_platform", "migrations"))
    command.upgrade(config, "head")
    engine = create_engine(scoped)
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _seed_run(conn, run_id, created_at, deleted_at=None):
    conn.execute(text("INSERT INTO users (id, email, display_name, title, role, is_active, created_at, updated_at) VALUES ('u', 'u@example.test', 'U', '', 'ADMIN', true, now(), now()) ON CONFLICT DO NOTHING"))
    conn.execute(text("INSERT INTO projects (id, name, slug, is_active, created_by_user_id, created_at, updated_at) VALUES ('p', 'P', 'p', true, 'u', now(), now()) ON CONFLICT DO NOTHING"))
    conn.execute(
        text(
            "INSERT INTO runs (id, project_id, created_by_user_id, owner_user_id, task, dataset, metrics, run_metadata, run_config, samples, status, created_at, updated_at, deleted_at) "
            "VALUES (:id, 'p', 'u', 'u', 't', 'd', '[]', '{}', '{}', 1, 'COMPLETED', :c, :c, :d)"
        ),
        {"id": run_id, "c": created_at, "d": deleted_at},
    )
    conn.execute(text("INSERT INTO run_items (run_id, item_id, index, input, item_metadata, retry_count) VALUES (:r, 'i', 0, '{}', '{}', 0)"), {"r": run_id})
    conn.execute(
        text("INSERT INTO spans (run_created_at, run_id, trace_id, span_id, name) VALUES (:c, :r, 't', :s, 'x')"),
        {"c": created_at, "r": run_id, "s": f"s-{run_id}"},
    )


def test_partitions_are_created_ahead_and_dropped_after_retention(migrated_postgres):
    engine = migrated_postgres
    now = datetime(2026, 9, 14, 12, 0, 0)
    old = now - timedelta(days=120)
    recent = now - timedelta(days=10)
    from qym_platform.migrations_support import ensure_month_partitions_between

    ensure_month_partitions_between(engine, old, now)
    with engine.begin() as conn:
        _seed_run(conn, "old", old)
        _seed_run(conn, "recent", recent)
        partitioned = conn.execute(text("SELECT relkind FROM pg_class WHERE oid = 'spans'::regclass")).scalar()
        assert partitioned == "p"
        placed = conn.execute(text("SELECT tableoid::regclass::text FROM spans WHERE run_id = 'old'")).scalar()
        assert placed.startswith("spans_y") and "default" not in placed

    created = retention.ensure_span_partitions(engine, months_ahead=2, now=now)
    assert "spans_y2026m11" in created or not created  # idempotent when already present
    with engine.connect() as conn:
        names = {r[0] for r in conn.execute(text("SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'spans'::regclass"))}
    assert {"spans_y2026m10", "spans_y2026m11"} <= names

    dropped = retention.drop_expired_span_partitions(engine, retention_days=60, now=now)
    assert dropped and all(name < "spans_y2026m07" or name == "spans_y2026m06" for name in dropped)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM spans WHERE run_id = 'old'")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM spans WHERE run_id = 'recent'")).scalar() == 1
        # derived rows survive raw-trace retention
        assert conn.execute(text("SELECT count(*) FROM run_items WHERE run_id = 'old'")).scalar() == 1
    assert retention.drop_expired_span_partitions(engine, retention_days=0, now=now) == []


def test_purge_cascades_children_after_grace(migrated_postgres):
    engine = migrated_postgres
    now = datetime(2026, 9, 14)
    from qym_platform.migrations_support import ensure_month_partitions_between

    ensure_month_partitions_between(engine, now - timedelta(days=40), now)
    with engine.begin() as conn:
        _seed_run(conn, "gone", now - timedelta(days=5), deleted_at=now - timedelta(days=40))
        _seed_run(conn, "fresh", now - timedelta(days=5), deleted_at=now - timedelta(days=2))
        _seed_run(conn, "live", now - timedelta(days=5))
        conn.execute(text("INSERT INTO dashboard_partition_state (partition_key, project_key, last_enqueued_version, last_applied_version, queue_state, retry_count, backfill_kind, backfill_cursor, backfill_source_version, backfill_complete, updated_at) VALUES ('gone', 'p', 0, 0, 'ready', 0, 'item', 0, 0, true, now())"))
    purged = retention.purge_soft_deleted_runs(engine, grace_days=30, now=now)
    assert purged == ["gone"]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM runs")).scalar() == 2
        assert conn.execute(text("SELECT count(*) FROM run_items WHERE run_id = 'gone'")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM spans WHERE run_id = 'gone'")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM dashboard_partition_state WHERE partition_key = 'gone'")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM run_items WHERE run_id = 'fresh'")).scalar() == 1
