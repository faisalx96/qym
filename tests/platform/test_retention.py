import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event, get_ident
from unittest.mock import patch

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")

from sqlalchemy import event, text

from qym_platform.services import retention


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


def _span_partitions(engine):
    with engine.connect() as conn:
        return {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'spans'::regclass"
                )
            )
        }


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

    # The migration pre-creates partitions from the wall clock. Remove the two
    # months after `now` so the create path always runs; September already
    # exists from ensure_month_partitions_between(old, now) above.
    with engine.begin() as conn:
        for name in ("spans_y2026m10", "spans_y2026m11"):
            conn.execute(text(f"DROP TABLE IF EXISTS {name}"))
    created = retention.ensure_span_partitions(engine, months_ahead=2, now=now)
    assert created == ["spans_y2026m10", "spans_y2026m11"]
    assert {"spans_y2026m09", "spans_y2026m10", "spans_y2026m11"} <= _span_partitions(engine)
    assert retention.ensure_span_partitions(engine, months_ahead=2, now=now) == []

    # 60 days before 2026-09-14 is 2026-07-16: only May and June end before it.
    dropped = retention.drop_expired_span_partitions(engine, retention_days=60, now=now)
    assert sorted(dropped) == ["spans_y2026m05", "spans_y2026m06"]
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


def test_purge_pauses_while_the_project_is_archived(migrated_postgres):
    """Postgres twin of the SQLite pause tests: the boolean join and the
    clock filter hold in the scan, the per-run recheck and the DELETE."""
    engine = migrated_postgres
    now = datetime(2026, 9, 14)
    from qym_platform.migrations_support import ensure_month_partitions_between

    ensure_month_partitions_between(engine, now - timedelta(days=40), now)
    with engine.begin() as conn:
        _seed_run(conn, "paused", now - timedelta(days=5), deleted_at=now - timedelta(days=40))
        conn.execute(
            text("UPDATE projects SET is_active = false, archived_at = :a WHERE id = 'p'"),
            {"a": now - timedelta(days=20)},
        )
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == []
    # Unarchived after 20 days: the clock moved forward by the pause.
    with engine.begin() as conn:
        conn.execute(text("UPDATE projects SET is_active = true, archived_at = NULL WHERE id = 'p'"))
        conn.execute(
            text("UPDATE runs SET purge_clock_started_at = :c WHERE id = 'paused'"),
            {"c": now - timedelta(days=20)},
        )
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == []
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now + timedelta(days=11)) == ["paused"]


def _restore_client(engine):
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session, sessionmaker

    from qym_platform.app import create_app
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db.models import User
    from qym_platform.deps import get_db
    from qym_platform.settings import PlatformSettings

    factory = sessionmaker(bind=engine, autoflush=False)
    app = create_app(PlatformSettings(database_url="sqlite://", role="api"))

    def database():
        with factory() as db:
            yield db

    with Session(engine) as db:
        user = db.get(User, "u")
        db.expunge(user)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=user, auth_type="none"
    )
    return TestClient(app)


def test_restore_after_candidate_selection_survives_purge(migrated_postgres):
    engine = migrated_postgres
    now = datetime.utcnow()
    with engine.begin() as conn:
        _seed_run(conn, "restore", now - timedelta(days=5), now - timedelta(days=40))
    selected, resume = Event(), Event()

    def pause_selection(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT id FROM runs WHERE deleted_at"):
            selected.set()
            assert resume.wait(10)

    event.listen(engine, "after_cursor_execute", pause_selection)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                retention.purge_soft_deleted_runs, engine, grace_days=30, now=now
            )
            assert selected.wait(10)
            try:
                response = _restore_client(engine).post(
                    "/api/runs/restore", json={"run_id": "restore"}
                )
                assert response.status_code == 200, response.text
            finally:
                resume.set()
            assert pending.result(timeout=15) == []
    finally:
        resume.set()
        event.remove(engine, "after_cursor_execute", pause_selection)
    with engine.connect() as conn:
        assert conn.execute(
            text("SELECT deleted_at IS NULL FROM runs WHERE id = 'restore'")
        ).scalar()
        assert (
            conn.execute(
                text("SELECT count(*) FROM run_items WHERE run_id = 'restore'")
            ).scalar()
            == 1
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM audit_logs WHERE entity_id = 'restore' AND action = 'run.restored'"
                )
            ).scalar()
            == 1
        )


def test_restore_waiting_for_purge_returns_404(migrated_postgres):
    engine = migrated_postgres
    now = datetime.utcnow()
    with engine.begin() as conn:
        _seed_run(conn, "purge", now - timedelta(days=5), now - timedelta(days=40))
    locked, restore_started, resume = Event(), Event(), Event()

    def observe(conn, cursor, statement, parameters, context, executemany):
        if (
            statement.startswith("SELECT id FROM runs WHERE id =")
            and "FOR UPDATE" in statement
        ):
            locked.set()
            assert resume.wait(10)

    def before_restore(conn, cursor, statement, parameters, context, executemany):
        if "runs.deleted_at IS NOT NULL" in statement and "FOR UPDATE" in statement:
            restore_started.set()

    event.listen(engine, "after_cursor_execute", observe)
    event.listen(engine, "before_cursor_execute", before_restore)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            purge = pool.submit(
                retention.purge_soft_deleted_runs, engine, grace_days=30, now=now
            )
            assert locked.wait(10)
            client = _restore_client(engine)
            restore = pool.submit(
                client.post, "/api/runs/restore", json={"run_id": "purge"}
            )
            try:
                assert restore_started.wait(10)
            finally:
                resume.set()
            assert purge.result(timeout=15) == ["purge"]
            response = restore.result(timeout=15)
            assert response.status_code == 404, response.text
    finally:
        resume.set()
        event.remove(engine, "after_cursor_execute", observe)
        event.remove(engine, "before_cursor_execute", before_restore)
    with engine.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM runs WHERE id = 'purge'")).scalar()
            == 0
        )
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM audit_logs WHERE entity_id = 'purge' AND action = 'run.restored'"
                )
            ).scalar()
            == 0
        )


def test_purge_waits_for_dashboard_deletion_publication(migrated_postgres):
    from sqlalchemy.orm import Session, sessionmaker

    from qym_platform.db.models import Run
    from qym_platform.services.dashboard_outbox import install_dashboard_outbox_hooks
    from qym_platform.services.dashboard_summaries import DashboardSummaryWorker

    engine = migrated_postgres
    now = datetime.utcnow()
    with engine.begin() as conn:
        _seed_run(conn, "pending", now - timedelta(days=5))
    worker = DashboardSummaryWorker(sessionmaker(bind=engine))
    for _ in range(10):
        worker.tick()
    with engine.begin() as conn:
        assert conn.execute(
            text(
                "SELECT present FROM dashboard_run_dimensions WHERE run_key = 'pending'"
            )
        ).scalar()
        assert (
            conn.execute(
                text(
                    "SELECT sum(count) FROM dashboard_bucket_rollups WHERE granularity = 'hour'"
                )
            ).scalar()
            == 1
        )
    install_dashboard_outbox_hooks()
    with Session(engine) as db:
        db.get(Run, "pending").deleted_at = now - timedelta(days=40)
        db.commit()
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == []
    worker.tick()
    with engine.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT sum(count) FROM dashboard_bucket_rollups WHERE granularity = 'hour'"
                )
            ).scalar()
            == 0
        )
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == [
        "pending"
    ]
    assert worker.tick() == 0


def test_concurrent_purge_workers_delete_only_once(migrated_postgres):
    engine = migrated_postgres
    now = datetime.utcnow()
    with engine.begin() as conn:
        _seed_run(conn, "once", now - timedelta(days=5), now - timedelta(days=40))
    locked, resume = Event(), Event()

    def pause(conn, cursor, statement, parameters, context, executemany):
        if (
            statement.startswith("SELECT id FROM runs WHERE id =")
            and not locked.is_set()
        ):
            locked.set()
            assert resume.wait(10)

    event.listen(engine, "after_cursor_execute", pause)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(
                retention.purge_soft_deleted_runs, engine, grace_days=30, now=now
            )
            assert locked.wait(10)
            try:
                assert (
                    retention.purge_soft_deleted_runs(engine, grace_days=30, now=now)
                    == []
                )
            finally:
                resume.set()
            assert first.result(timeout=15) == ["once"]
    finally:
        resume.set()
        event.remove(engine, "after_cursor_execute", pause)


def test_public_restore_during_dashboard_cleanup_preserves_lock_order(
    migrated_postgres,
):
    from sqlalchemy.orm import Session, sessionmaker

    from qym_platform.services import dashboard_summaries as service

    engine = migrated_postgres
    now = datetime.utcnow()
    with engine.begin() as conn:
        _seed_run(conn, "restore-dashboard", now - timedelta(days=5))
    worker = service.DashboardSummaryWorker(sessionmaker(bind=engine))
    for _ in range(10):
        worker.tick()
    client = _restore_client(engine)
    assert (
        client.post(
            "/api/runs/delete", json={"file_path": "restore-dashboard"}
        ).status_code
        == 200
    )
    locked, restoration_waiting = Event(), Event()
    cleanup_thread = []
    refresh = service.refresh_run_summary

    def hold_cleanup(*args, **kwargs):
        locked.set()
        assert restoration_waiting.wait(10)
        return refresh(*args, **kwargs)

    def before_statement(conn, cursor, statement, parameters, context, executemany):
        if (
            cleanup_thread
            and get_ident() != cleanup_thread[0]
            and "dashboard_partition_state" in statement
        ):
            restoration_waiting.set()

    def cleanup():
        cleanup_thread.append(get_ident())
        with Session(engine) as db:
            service.process_partition(db, "restore-dashboard")
            db.commit()

    def restore():
        return client.post("/api/runs/restore", json={"run_id": "restore-dashboard"})

    event.listen(engine, "before_cursor_execute", before_statement)
    try:
        with patch.object(service, "refresh_run_summary", side_effect=hold_cleanup):
            with ThreadPoolExecutor(max_workers=2) as pool:
                deletion = pool.submit(cleanup)
                assert locked.wait(10)
                restoration = pool.submit(restore)
                deletion.result(timeout=15)
                response = restoration.result(timeout=15)
                assert response.status_code == 200, response.text
    finally:
        restoration_waiting.set()
        event.remove(engine, "before_cursor_execute", before_statement)
    for _ in range(10):
        worker.tick()
    with engine.connect() as conn:
        assert conn.execute(
            text("SELECT deleted_at IS NULL FROM runs WHERE id = 'restore-dashboard'")
        ).scalar()
        assert conn.execute(
            text(
                "SELECT present FROM dashboard_run_dimensions WHERE run_key = 'restore-dashboard'"
            )
        ).scalar()
        assert (
            conn.execute(
                text(
                    "SELECT sum(count) FROM dashboard_bucket_rollups WHERE granularity = 'hour'"
                )
            ).scalar()
            == 1
        )


def _seed_bulk(conn, run_id, created_at, *, items, spans, events):
    for index in range(1, items):
        conn.execute(
            text(
                "INSERT INTO run_items (run_id, item_id, index, input, item_metadata, retry_count) "
                "VALUES (:r, :i, :n, '{}', '{}', 0)"
            ),
            {"r": run_id, "i": f"i{index}", "n": index},
        )
    for index in range(1, spans):
        conn.execute(
            text(
                "INSERT INTO spans (run_created_at, run_id, trace_id, span_id, name) "
                "VALUES (:c, :r, 't', :s, 'x')"
            ),
            {"c": created_at, "r": run_id, "s": f"s{index:03d}"},
        )
    for index in range(events):
        conn.execute(
            text(
                "INSERT INTO run_events (run_id, event_id, sequence, type, sent_at, payload) "
                "VALUES (:r, :e, :n, 'item', now(), '{}')"
            ),
            {"r": run_id, "e": f"{run_id}-e{index}", "n": index},
        )


def test_purge_deletes_bulk_children_in_batches(migrated_postgres):
    engine = migrated_postgres
    now = datetime(2026, 9, 14)
    from qym_platform.migrations_support import ensure_month_partitions_between

    ensure_month_partitions_between(engine, now - timedelta(days=40), now)
    created = now - timedelta(days=5)
    with engine.begin() as conn:
        # _seed_run adds one item and one span; _seed_bulk adds the rest.
        _seed_run(conn, "bulk", created, deleted_at=now - timedelta(days=40))
        _seed_bulk(conn, "bulk", created, items=7, spans=9, events=5)
        _seed_run(conn, "keep", created)
        _seed_bulk(conn, "keep", created, items=3, spans=3, events=2)
    batches = []

    def count(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("DELETE FROM ") and "RETURNING" in statement:
            batches.append(statement.split()[2])

    event.listen(engine, "before_cursor_execute", count)
    try:
        purged = retention.purge_soft_deleted_runs(
            engine, grace_days=30, now=now, batch_size=2
        )
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert purged == ["bulk"]
    # 9 spans in batches of 2 -> 5 statements; items and events batch too.
    assert batches.count("spans") == 5
    assert batches.count("run_items") == 4
    assert batches.count("run_events") == 3
    with engine.connect() as conn:
        for table in ("runs", "run_items", "spans", "run_events"):
            column = "id" if table == "runs" else "run_id"
            left = conn.execute(
                text(f"SELECT count(*) FROM {table} WHERE {column} = 'bulk'")
            ).scalar()
            assert left == 0, table
        keep = {
            table: conn.execute(
                text(f"SELECT count(*) FROM {table} WHERE run_id = 'keep'")
            ).scalar()
            for table in ("run_items", "spans", "run_events")
        }
        assert keep == {"run_items": 3, "spans": 3, "run_events": 2}


def test_purge_defers_a_run_whose_batch_hits_a_lock_timeout(migrated_postgres):
    engine = migrated_postgres
    now = datetime(2026, 9, 14)
    from qym_platform.migrations_support import ensure_month_partitions_between

    ensure_month_partitions_between(engine, now - timedelta(days=40), now)
    with engine.begin() as conn:
        _seed_run(
            conn, "held", now - timedelta(days=5), deleted_at=now - timedelta(days=40)
        )
    holder = engine.connect()
    try:
        holder.execute(
            text("SELECT 1 FROM run_items WHERE run_id = 'held' FOR UPDATE")
        )

        def short_timeout(conn, cursor, statement, parameters, context, executemany):
            if statement == "SET LOCAL lock_timeout = '5s'":
                cursor.execute("SET LOCAL lock_timeout = '200ms'")

        event.listen(engine, "after_cursor_execute", short_timeout)
        try:
            assert (
                retention.purge_soft_deleted_runs(engine, grace_days=30, now=now)
                == []
            )
        finally:
            event.remove(engine, "after_cursor_execute", short_timeout)
    finally:
        holder.rollback()
        holder.close()
    with engine.connect() as conn:
        # The run stays soft-deleted with its items for the next tick.
        assert conn.execute(
            text("SELECT deleted_at IS NOT NULL FROM runs WHERE id = 'held'")
        ).scalar()
        assert (
            conn.execute(
                text("SELECT count(*) FROM run_items WHERE run_id = 'held'")
            ).scalar()
            == 1
        )
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == [
        "held"
    ]
