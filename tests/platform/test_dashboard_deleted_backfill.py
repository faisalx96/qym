"""Deleted history stays idle; restoration and date ordering remain correct."""

from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from test_dashboard_durable_summaries import (
    Bucket,
    Change,
    Dimension,
    Partition,
    Run,
    RunItem,
    RunWorkflowStatus,
    Summary,
    database,
    drain,
    item,
    projected,
    run,
    service,
)


def test_bootstrap_ignores_deleted_history_and_uses_dashboard_run_date(database):
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        for rid, started, created, deleted in (
            ("old-import", datetime(2026, 1, 1), datetime(2026, 9, 14), None),
            ("new-run", datetime(2026, 9, 13), datetime(2026, 9, 12), None),
            ("no-start", None, datetime(2026, 9, 11), None),
            (
                "deleted",
                datetime(2026, 9, 15),
                datetime(2026, 9, 15),
                datetime.utcnow(),
            ),
        ):
            run(
                db,
                run_id=rid,
                status=RunWorkflowStatus.COMPLETED,
                started_at=started,
                created_at=created,
                deleted_at=deleted,
            )
        db.commit()
        for expected in ("new-run", "no-start", "old-import"):
            assert service.bootstrap_partitions(db, limit=1) == 1
            db.commit()
            assert db.get(Partition, expected) is not None
        assert service.bootstrap_partitions(db) == 0
        assert db.get(Partition, "deleted") is None
        # An empty project selects its newest run first, then moves backwards.
        for expected in ("new-run", "no-start", "old-import"):
            assert service.scheduled_partitions(db, limit=1) == [expected]
            db.get(Partition, expected).queue_state = "ready"
            db.commit()


@pytest.mark.parametrize("progress", ["unstarted", "partial", "published"])
def test_deleted_history_parks_without_scanning_and_restores_from_current_source(
    database, progress
):
    worker = service.DashboardSummaryWorker(
        sessionmaker(bind=database, autoflush=False), max_events=2
    )
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        run(db, status=RunWorkflowStatus.COMPLETED)
        for n in range(6):
            item(db, item_id=str(n), latency_ms=10 + n)
        db.commit()
        service.bootstrap_partitions(db)
        db.commit()
    if progress == "partial":
        worker.tick()
    elif progress == "published":
        drain(database)
    with Session(database) as db:
        db.get(Run, "r").deleted_at = datetime.utcnow()
        db.commit()
        part = db.get(Partition, "r")
        checkpoint = (part.backfill_kind, part.backfill_cursor, part.backfill_complete)
        pending = db.scalar(
            select(func.count())
            .select_from(Change)
            .where(Change.published_at.is_(None))
        )
        assert pending > 0
        assert service.dashboard_freshness(db, ["p"])["freshness"] == {
            "updating": False,
            "pending_partitions": 0,
            "backfilling": False,
            "unpublished_runs": 0,
            "failed_partitions": 0,
            "oldest_pending_at": None,
        }
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        with patch.object(
            service,
            "apply_events",
            side_effect=AssertionError("deleted events applied"),
        ):
            worker.tick()
            worker.tick()
    finally:
        event.remove(database, "before_cursor_execute", capture)
    assert not any(
        table in sql
        for sql in statements
        for table in (
            "run_items",
            "run_item_scores",
            "run_item_pass_scores",
            "run_item_attempts",
            "run_events",
        )
    )
    with Session(database) as db:
        part = db.get(Partition, "r")
        assert part.queue_state == "deleted"
        assert (
            part.backfill_kind,
            part.backfill_cursor,
            part.backfill_complete,
        ) == checkpoint
        assert service.scheduled_partitions(db) == []
        assert db.scalar(select(func.sum(Bucket.count))) in (None, 0)
        dimension = db.get(Dimension, "r")
        assert dimension is None or not dimension.present
        assert (
            db.scalar(
                select(func.count())
                .select_from(Change)
                .where(Change.published_at.is_(None))
            )
            == pending
        )
        # Source corrections while deleted stay parked, including tombstones.
        db.delete(db.scalar(select(RunItem).where(RunItem.item_id == "0")))
        db.scalar(select(RunItem).where(RunItem.item_id == "1")).latency_ms = 100
        db.commit()
        assert db.get(Partition, "r").queue_state == "deleted"
        assert service.scheduled_partitions(db) == []
        for change in db.scalars(select(Change).where(Change.published_at.is_(None))):
            change.created_at = datetime.utcnow() - timedelta(days=45)
        db.commit()
        db.get(Run, "r").deleted_at = None
        db.commit()
        assert service.scheduled_partitions(db) == ["r"]
        assert (
            service.dashboard_freshness(db, ["p"])["freshness"]["unpublished_runs"] == 1
        )
    worker.tick()  # Retire stale events and reset; no partial restoration visible.
    with Session(database) as db:
        assert db.get(Partition, "r").queue_state == "backfill"
        dimension = db.get(Dimension, "r")
        assert dimension is None or not dimension.present
        assert (
            service.dashboard_freshness(db, ["p"])["freshness"]["unpublished_runs"] == 1
        )
    drain(database, max_events=2)
    with Session(database) as db:
        part = db.get(Partition, "r")
        assert part.queue_state == "ready" and part.backfill_complete
        assert part.last_error is None
        assert db.get(Dimension, "r").present
        assert db.get(Summary, "r").count == 5
        assert db.get(Summary, "r").latency_sum == 154
        assert (
            db.scalar(
                select(func.sum(Bucket.count)).where(Bucket.granularity == "hour")
            )
            == 5
        )
    assert projected(database)["total_items"] == 5


def test_restore_committing_during_deletion_cleanup_is_not_lost(database):
    if database.dialect.name != "postgresql":
        pytest.skip("Concurrent source and partition locks require PostgreSQL")
    with Session(database) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        item(db)
        db.commit()
    drain(database)
    with Session(database) as db:
        db.get(Run, "r").deleted_at = datetime.utcnow()
        db.commit()
    locked, restored_source = Event(), Event()
    refresh = service.refresh_run_summary

    def hold_cleanup(*args, **kwargs):
        locked.set()
        assert restored_source.wait(10)
        return refresh(*args, **kwargs)

    def observe_restore(conn, cursor, sql, *args):
        if sql.lower().startswith("update runs set"):
            restored_source.set()

    def restore():
        assert locked.wait(10)
        with Session(database) as db:
            db.get(Run, "r").deleted_at = None
            db.commit()

    worker = service.DashboardSummaryWorker(
        sessionmaker(bind=database, autoflush=False)
    )
    event.listen(database, "after_cursor_execute", observe_restore)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            with patch.object(service, "refresh_run_summary", side_effect=hold_cleanup):
                cleanup = pool.submit(worker.tick)
                restoration = pool.submit(restore)
                cleanup.result(timeout=20)
                restoration.result(timeout=20)
    finally:
        event.remove(database, "after_cursor_execute", observe_restore)
    with Session(database) as db:
        assert db.get(Run, "r").deleted_at is None
        assert db.get(Partition, "r").queue_state == "deleted"
        assert service.scheduled_partitions(db) == ["r"]
    drain(database)
    with Session(database) as db:
        assert db.get(Dimension, "r").present
        assert db.get(Partition, "r").queue_state == "ready"
        assert (
            db.scalar(
                select(func.sum(Bucket.count)).where(Bucket.granularity == "hour")
            )
            == 1
        )
