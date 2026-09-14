"""Request work stays independent of event/output history; error semantics survive."""

from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import event, select, func
from sqlalchemy.orm import Session

from qym_platform.api import runs
from qym_platform.auth import Principal
from qym_platform.db.dashboard_models import (
    DashboardChangeEvent as Change,
    DashboardPartitionState as Partition,
    DashboardRunSummary as Summary,
)
from qym_platform.db.models import (
    RunEvent,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from qym_platform.services import dashboard_summaries as service
from test_dashboard_durable_summaries import (
    database,
    run,
    item,
    drain,
    legacy,
    projected,
)


def list_page(db, **kwargs):
    return runs.legacy_list_runs(
        limit=100,
        offset=0,
        project_slug="test",
        status=None,
        exclude_live=False,
        include_total=True,
        user=None,
        user_id=None,
        owner_user_id=None,
        db=db,
        principal=Principal(user=db.get(User, "u"), auth_type="none"),
        **kwargs,
    )


def rows(response):
    return [
        row
        for models in response["tasks"].values()
        for group in models.values()
        for row in group
    ]


@pytest.mark.parametrize("refreshing", [False, True])
def test_published_list_never_reads_execution_history(database, refreshing):
    with Session(database) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        item(db)
        db.commit()
    drain(database)
    with Session(database) as db:
        if refreshing:
            part = db.get(Partition, "r")
            part.backfill_complete = False
            part.queue_state = "backfill"
            db.commit()
        statements = []

        def capture(conn, cursor, sql, *args):
            statements.append(sql.lower())

        event.listen(database, "before_cursor_execute", capture)
        try:
            with patch.object(
                runs,
                "_execution_error_pairs_for_runs",
                side_effect=AssertionError("source scan on published run"),
            ):
                response = list_page(db)
        finally:
            event.remove(database, "before_cursor_execute", capture)
    assert len(rows(response)) == 1
    assert rows(response)[0]["total_items"] == 1
    assert response["freshness"]["backfilling"] is refreshing
    assert response["freshness"]["unpublished_runs"] == 0
    assert not any(
        table in sql
        for sql in statements
        for table in (
            "run_events",
            "run_items",
            "run_item_attempts",
            "run_item_scores",
            "run_item_pass_scores",
            "spans",
        )
    )


def test_mixed_list_only_computes_unpublished_runs(database):
    with Session(database) as db:
        run(db, run_id="ready", status=RunWorkflowStatus.COMPLETED)
        item(db, run_id="ready")
        db.commit()
    drain(database)
    with Session(database) as db:
        run(db, run_id="new", status=RunWorkflowStatus.COMPLETED)
        item(db, run_id="new")
        db.commit()
        original = runs._execution_error_pairs_for_runs
        calls = []

        def checked(session, ids, **kwargs):
            calls.extend(ids)
            return original(session, ids, **kwargs)

        with patch.object(runs, "_execution_error_pairs_for_runs", side_effect=checked):
            response = list_page(db)
    assert {row["run_id"] for row in rows(response)} == {"ready", "new"}
    assert calls == ["new"]


def add_event(db, identity, kind, pass_number=1, **payload):
    obj = RunEvent(
        run_id="r",
        event_id=identity,
        sequence=int(identity),
        type=kind,
        sent_at=datetime.utcnow(),
        payload={
            "item_id": "i",
            "pass_number": pass_number,
            "output": "private output" * 1000,
            **payload,
        },
    )
    db.add(obj)
    return obj


@pytest.mark.parametrize("samples", [1, 3])
def test_projected_legacy_evidence_matches_source_and_deduplicates(database, samples):
    with Session(database) as db:
        run(
            db,
            samples=samples,
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"last_completed_pass": samples, "total_items": 1},
        )
        item(db, error="task failed", retry_count=2)
        db.add(
            RunItemAttempt(
                run_id="r",
                item_id="i",
                pass_number=1,
                attempt_number=3,
                is_last_attempt=True,
                status="FAILED",
            )
        )
        db.add(
            RunItemScore(
                run_id="r",
                item_id="i",
                metric_name="score",
                score_numeric=0,
                meta={"status": "error"},
            )
        )
        add_event(db, "1", "item_failed", retry_count=2)
        add_event(db, "2", "item_completed", retry_count=2)
        add_event(db, "3", "item_attempt_started", attempt_number=3)
        add_event(db, "4", "item_attempt_finished", attempt_number=1, status="FAILED")
        if samples > 1:
            add_event(db, "5", "item_completed", pass_number=2, retry_count=4)
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id="i",
                    pass_number=2,
                    metric_name="score",
                    score_numeric=0,
                    meta={"status": "timeout"},
                )
            )
        db.commit()
        numeric = list(
            db.scalars(
                select(Change).where(Change.metric_key.startswith("legacy_event:"))
            )
        )
        assert len(numeric) == (4 if samples > 1 else 3)
        assert all(row.record_kind == "attempt" and not row.is_last for row in numeric)
        assert all(
            not hasattr(row, "payload") and row.latency_ms is None for row in numeric
        )
    expected = legacy(database)
    drain(database)
    actual = projected(database)
    assert (
        actual["execution_error_count"]
        == expected["execution_error_count"]
        == (2 if samples > 1 else 1)
    )
    assert (
        actual["total_retries"]
        == expected["total_retries"]
        == (6 if samples > 1 else 2)
    )
    if samples > 1:
        assert [p["error_count"] for p in actual["pass_summaries"]] == [1, 1, 0]
        assert [p["retry_count"] for p in actual["pass_summaries"]] == [2, 4, 0]


def test_historical_event_backfill_is_bounded_and_replay_safe(database):
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        run(db, samples=3, status=RunWorkflowStatus.COMPLETED)
        item(db)
        add_event(db, "1", "item_completed", pass_number=1, retry_count=3)
        add_event(db, "2", "item_completed", pass_number=2, retry_count=0)
        add_event(db, "3", "item_failed", pass_number=3, retry_count=2)
        db.commit()
        service.bootstrap_partitions(db)
        db.commit()
    expected = legacy(database)
    statements = []

    def capture(conn, cursor, sql, *args):
        if "run_events" in sql:
            statements.append(sql)

    event.listen(database, "before_cursor_execute", capture)
    try:
        drain(database, max_events=1)
    finally:
        event.remove(database, "before_cursor_execute", capture)
    actual = projected(database)
    assert actual["total_retries"] == expected["total_retries"] == 5
    assert actual["execution_error_count"] == expected["execution_error_count"] == 1
    assert statements
    assert all("run_events.sequence >" in sql for sql in statements)
    assert all("run_events.payload AS" not in sql for sql in statements)
    with Session(database) as db:
        part = db.get(Partition, "r")
        part.backfill_complete = False
        part.backfill_kind = "event"
        part.backfill_cursor = 0
        part.queue_state = "backfill"
        db.commit()
    drain(database, max_events=1)
    assert projected(database)["total_retries"] == 5
    assert projected(database)["execution_error_count"] == 1


def test_deleted_legacy_event_removes_its_numeric_evidence(database):
    with Session(database) as db:
        run(db, samples=2, status=RunWorkflowStatus.COMPLETED)
        item(db)
        add_event(db, "1", "item_failed", retry_count=4)
        db.commit()
    drain(database)
    assert projected(database)["execution_error_count"] == 1
    with Session(database) as db:
        db.query(RunEvent).filter(RunEvent.run_id == "r").delete(
            synchronize_session=False
        )
        db.commit()
    drain(database)
    assert projected(database)["execution_error_count"] == 0
    assert projected(database)["total_retries"] == 0


def test_upgrade_retains_publications_and_in_progress_cursors(database, monkeypatch):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from test_migrations import _load_migration

    with Session(database) as db:
        for rid in ("ready", "scanning", "failed"):
            run(db, run_id=rid, status=RunWorkflowStatus.COMPLETED)
            item(db, run_id=rid)
        db.commit()
    drain(database)
    with Session(database) as db:
        part = db.get(Partition, "scanning")
        part.backfill_complete = False
        part.backfill_kind = "score"
        part.backfill_cursor = 42
        part.queue_state = "backfill"
        db.get(Partition, "failed").queue_state = "repair_required"
        before = {
            row.run_key: (row.data, row.projection_revision)
            for row in db.scalars(select(Summary))
        }
        db.commit()
    migration = _load_migration("0050_dashboard_legacy_execution_events.py")
    with database.begin() as conn:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(conn))
        )
        migration.upgrade()
        migration.upgrade()
    with Session(database) as db:
        ready = db.get(Partition, "ready")
        assert not ready.backfill_complete and ready.backfill_kind == "event"
        scanning = db.get(Partition, "scanning")
        assert scanning.backfill_kind == "score" and scanning.backfill_cursor == 42
        assert db.get(Partition, "failed").queue_state == "repair_required"
        assert before == {
            row.run_key: (row.data, row.projection_revision)
            for row in db.scalars(select(Summary))
        }


def test_status_sort_uses_execution_errors_without_changing_task_success(database):
    from qym_platform.api.dashboard import _sort
    from qym_platform.db.dashboard_models import DashboardRunDimension as Dimension

    with Session(database) as db:
        for rid, errors in (("metric-error", 3), ("task-error", 1)):
            run(db, run_id=rid, status=RunWorkflowStatus.COMPLETED)
            item(db, run_id=rid, error="failed" if rid == "task-error" else None)
        db.commit()
    drain(database)
    with Session(database) as db:
        summary = db.get(Summary, "metric-error")
        summary.data = {**summary.data, "execution_error_count": 3}
        db.commit()
        ids = db.scalars(
            select(Dimension.run_key)
            .join(Summary, Summary.run_key == Dimension.run_key)
            .order_by(*_sort("status-desc"))
        ).all()
        assert ids == ["metric-error", "task-error"]
        assert db.get(Summary, "metric-error").data["error_count"] == 0


def test_live_publications_are_not_starved_by_history_refresh(database):
    from datetime import timedelta

    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        for i in range(8):
            rid = f"history-{i}"
            run(db, run_id=rid, status=RunWorkflowStatus.COMPLETED)
            db.add(
                Partition(
                    partition_key=rid,
                    project_key="p",
                    queue_state="backfill",
                    backfill_complete=False,
                    updated_at=datetime.utcnow() - timedelta(days=1),
                )
            )
        for i in range(5):
            rid = f"live-{i}"
            run(db, run_id=rid, status=RunWorkflowStatus.RUNNING)
            db.add(
                Partition(
                    partition_key=rid,
                    project_key="p",
                    queue_state="pending",
                    backfill_complete=False,
                    updated_at=datetime.utcnow(),
                )
            )
        db.commit()
        selected = service.scheduled_partitions(db, limit=4)
        assert len(selected) == 4
        assert sum(r.startswith("live-") for r in selected) == 3
        assert sum(r.startswith("history-") for r in selected) == 1


def test_downgrade_removes_only_derived_legacy_evidence(database, monkeypatch):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from qym_platform.db.dashboard_models import DashboardRecordState as Record
    from test_migrations import _load_migration

    with Session(database) as db:
        run(db, samples=2, status=RunWorkflowStatus.COMPLETED)
        item(db)
        add_event(db, "1", "item_failed", retry_count=3)
        db.add(
            RunItemAttempt(
                run_id="r",
                item_id="i",
                pass_number=1,
                attempt_number=1,
                is_last_attempt=True,
                status="COMPLETED",
            )
        )
        db.commit()
    drain(database)
    with Session(database) as db:
        published = db.get(Summary, "r").data
        assert (
            db.scalar(
                select(func.count())
                .select_from(Record)
                .where(Record.metric_key.startswith("legacy_event:"))
            )
            == 1
        )
    migration = _load_migration("0050_dashboard_legacy_execution_events.py")
    with database.begin() as conn:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(conn))
        )
        migration.upgrade()
        migration.downgrade()
    with Session(database) as db:
        assert db.scalar(select(func.count()).select_from(RunEvent)) == 1
        assert db.scalar(select(func.count()).select_from(RunItemAttempt)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(Record)
                .where(Record.metric_key.startswith("legacy_event:"))
            )
            == 0
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(Record)
                .where(Record.record_kind == "attempt")
            )
            == 1
        )
        assert db.get(Summary, "r").data == published
        part = db.get(Partition, "r")
        assert part.backfill_kind == "item" and part.backfill_cursor == 0
        assert not part.backfill_complete


def test_first_history_rows_publish_before_every_run_is_scanned(database):
    from sqlalchemy.orm import sessionmaker

    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        for n in range(100):
            rid = f"history-{n:03}"
            run(db, run_id=rid, status=RunWorkflowStatus.COMPLETED)
            for i in range(6):
                item(db, item_id=str(i), run_id=rid)
        db.commit()
        service.bootstrap_partitions(db)
        db.commit()
    # Three bounded item batches plus the remaining source-stage transitions.
    # The old round-robin schedule needed 80 ticks before publishing any run.
    worker = service.DashboardSummaryWorker(
        sessionmaker(bind=database, autoflush=False), max_partitions=4, max_events=2
    )
    for _ in range(8):
        worker.tick()
    with Session(database) as db:
        ready = list(db.scalars(select(Summary).where(Summary.projection_revision > 0)))
        assert len(ready) == 1
        assert all(summary.data["total_items"] == 6 for summary in ready)
        freshness = service.dashboard_freshness(db, ["p"])
        assert freshness["revision"] > 0
        assert freshness["freshness"]["unpublished_runs"] == 99
        assert freshness["freshness"]["failed_partitions"] == 0
        assert (
            db.scalar(
                select(func.count())
                .select_from(Partition)
                .where(
                    Partition.backfill_kind == "item", Partition.backfill_cursor == 0
                )
            )
            == 99
        )
    # The first publication expands historical throughput to the normal limit.
    for _ in range(8):
        worker.tick()
    with Session(database) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Summary)
                .where(Summary.projection_revision > 0)
            )
            == 5
        )


def test_history_scheduler_interleaves_projects_and_resumes_checkpoints(database):
    from qym_platform.db.models import Project

    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        db.add(Project(id="other", name="Other", slug="other", created_by_user_id="u"))
        db.flush()
        for project in ("p", "other"):
            for n in range(8):
                rid = f"{project}-{n}"
                run(
                    db,
                    run_id=rid,
                    project_id=project,
                    status=RunWorkflowStatus.COMPLETED,
                )
                db.add(
                    Partition(
                        partition_key=rid,
                        project_key=project,
                        queue_state="backfill",
                        backfill_complete=False,
                        backfill_kind="item",
                        backfill_cursor=500 if n == 7 else 0,
                    )
                )
        db.commit()
        selected = service.scheduled_partitions(db, limit=2)
        assert set(selected) == {"p-7", "other-7"}
        # Resume the same two checkpoints after they were recently processed;
        # an untouched project history must not push them to the back of the queue.
        for rid in selected:
            db.get(Partition, rid).updated_at = datetime.utcnow()
        db.commit()
        assert set(service.scheduled_partitions(db, limit=2)) == set(selected)


def test_history_scheduler_prioritizes_missing_publications(database):
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        for rid in ("published", "missing"):
            run(db, run_id=rid, status=RunWorkflowStatus.COMPLETED)
            db.add(
                Partition(
                    partition_key=rid,
                    project_key="p",
                    queue_state="backfill",
                    backfill_complete=False,
                    backfill_kind="event" if rid == "published" else "item",
                    backfill_cursor=500 if rid == "published" else 0,
                )
            )
        db.add(
            Summary(
                run_key="published",
                project_key="p",
                projection_revision=1,
                data={"total_items": 10},
            )
        )
        db.commit()
        assert service.scheduled_partitions(db, limit=1) == ["missing"]


def test_live_publication_does_not_expand_first_history_batch(database):
    with Session(database) as db:
        run(db, run_id="live")
        item(db, run_id="live")
        db.commit()
    drain(database)
    with Session(database) as db:
        assert db.get(Summary, "live").projection_revision > 0
        db.info["dashboard_projection_worker"] = True
        for n in range(8):
            run(db, run_id=f"history-{n}", status=RunWorkflowStatus.COMPLETED)
        db.commit()
        service.bootstrap_partitions(db)
        db.commit()
        selected = service.scheduled_partitions(db, limit=4)
        assert len(selected) == 1 and selected[0].startswith("history-")


def test_worker_recovers_unregistered_bulk_history_and_resumes_after_restart(database):
    from sqlalchemy.orm import sessionmaker

    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        run(db, status=RunWorkflowStatus.COMPLETED)
        for n in range(6):
            item(db, item_id=str(n))
        db.commit()
        assert db.get(Partition, "r") is None
    factory = sessionmaker(bind=database, autoflush=False)
    worker = service.DashboardSummaryWorker(factory, max_events=2)
    worker.tick()
    with Session(database) as db:
        assert db.get(Partition, "r").backfill_cursor > 0
    worker = service.DashboardSummaryWorker(factory, max_events=2)
    for _ in range(8):
        worker.tick()
    assert projected(database)["total_items"] == 6


def test_empty_orphan_queue_entries_cannot_starve_live_runs(database):
    from datetime import timedelta
    from sqlalchemy.orm import sessionmaker

    with Session(database) as db:
        for n in range(8):
            db.add(
                Partition(
                    partition_key=f"removed-{n}",
                    project_key="p",
                    queue_state="pending",
                    backfill_complete=True,
                    updated_at=datetime.utcnow() - timedelta(days=1),
                )
            )
        run(db)
        item(db)
        db.commit()
    worker = service.DashboardSummaryWorker(
        sessionmaker(bind=database, autoflush=False), max_partitions=4
    )
    for _ in range(3):
        worker.tick()
    assert projected(database)["total_items"] == 1
    with Session(database) as db:
        assert all(
            p.queue_state == "ready"
            for p in db.scalars(
                select(Partition).where(Partition.partition_key.like("removed-%"))
            )
        )
        assert not service.dashboard_freshness(db, ["p"])["freshness"]["updating"]


def test_completed_empty_scan_recovers_missing_first_publication(database):
    from sqlalchemy.orm import sessionmaker

    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        run(db, status=RunWorkflowStatus.COMPLETED)
        db.add(
            Partition(
                partition_key="r",
                project_key="p",
                queue_state="pending",
                backfill_complete=True,
                backfill_kind="event",
            )
        )
        db.commit()
    worker = service.DashboardSummaryWorker(
        sessionmaker(bind=database, autoflush=False)
    )
    worker.tick()
    assert projected(database)["total_items"] == 0
    with Session(database) as db:
        assert db.get(Summary, "r").projection_revision > 0
        assert db.get(Partition, "r").queue_state == "ready"
