"""Separate task failures, failed metric checks and ordinary zero scores."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event
from sqlalchemy.orm import Session

from qym_platform.api import runs
from qym_platform.auth import Principal
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.dashboard_models import DashboardRunSummary as Summary
from qym_platform.db.models import (
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from test_dashboard_durable_summaries import (
    database,
    drain,
    item,
    legacy,
    projected,
    run,
)


@pytest.mark.parametrize("samples", [1, 3])
def test_task_errors_exclude_skipped_metrics_and_count_each_failed_check(
    database, samples
):
    with Session(database) as db:
        r = run(db, samples=samples, status=RunWorkflowStatus.COMPLETED)
        item(db, item_id="task", error="task unavailable")
        item(db, item_id="metric")
        item(db, item_id="zero")
        db.add(
            RunItemAttempt(
                run_id="r",
                item_id="task",
                pass_number=1,
                attempt_number=2,
                is_last_attempt=True,
                status="failed",
            )
        )
        for item_id, metric, meta in [
            ("task", "score", {"status": "error", "error": "task unavailable"}),
            ("metric", "score", {"status": "timeout"}),
            ("metric", "other", {"error": "judge failed"}),
            ("zero", "score", {"status": "success", "error": ""}),
            ("zero", "other", {"error": False}),
        ]:
            # A classic run may retain both score representations; count once.
            db.add(
                RunItemScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name=metric,
                    score_numeric=0,
                    meta=meta,
                )
            )
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name=metric,
                    pass_number=1,
                    score_numeric=0,
                    meta=meta,
                )
            )
        if samples > 1:
            # The same task succeeds on pass 2 but its metric fails.
            db.add(
                RunItemAttempt(
                    run_id="r",
                    item_id="task",
                    pass_number=2,
                    attempt_number=1,
                    is_last_attempt=True,
                    status="completed",
                )
            )
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id="task",
                    metric_name="score",
                    pass_number=2,
                    score_numeric=0,
                    meta={"status": "error"},
                )
            )
        db.commit()
        detailed = runs._compute_run_summary(db, r)
        passes = runs.run_passes(
            "r", db, Principal(user=db.get(User, "u"), auth_type="none")
        )
    expected = legacy(database)
    drain(database)
    actual = projected(database)
    for payload in (expected, actual, detailed):
        assert payload["task_error_count"] == 1
        assert payload["metric_error_count"] == (3 if samples > 1 else 2)
        assert payload["metric_error_counts"] == {
            "score": 2 if samples > 1 else 1,
            "other": 1,
        }
        assert payload["execution_error_count"] == (3 if samples > 1 else 2)
    assert passes["passes"][0]["task_error_count"] == 1
    assert passes["passes"][0]["metric_error_count"] == 2
    if samples > 1:
        for payload in (expected, actual):
            assert [p["task_error_count"] for p in payload["pass_summaries"]] == [
                1,
                0,
                0,
            ]
            assert [p["metric_error_count"] for p in payload["pass_summaries"]] == [
                2,
                1,
                0,
            ]
        assert passes["passes"][1]["task_error_count"] == 0
        assert passes["passes"][1]["metric_error_count"] == 1


def test_upgrade_refreshes_existing_publications_without_source_history(database):
    with Session(database) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        item(db)
        db.add(
            RunItemScore(
                run_id="r",
                item_id="i",
                metric_name="score",
                score_numeric=0,
                meta={"status": "error"},
            )
        )
        db.commit()
    drain(database)
    with Session(database) as db:
        summary = db.get(Summary, "r")
        revision = summary.projection_revision
        summary.data = {
            k: v
            for k, v in summary.data.items()
            if k
            not in {"task_error_count", "metric_error_count", "metric_error_counts"}
        }
        db.commit()
    path = (
        Path(__file__).resolve().parents[2]
        / "packages/platform/qym_platform/migrations/versions/0058_split_execution_error_counts.py"
    )
    spec = importlib.util.spec_from_file_location("split_error_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with database.begin() as conn:
        migration.op = Operations(MigrationContext.configure(conn))
        migration.upgrade()
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        drain(database)
    finally:
        event.remove(database, "before_cursor_execute", capture)
    actual = projected(database)
    assert actual["task_error_count"] == 0
    assert actual["metric_error_count"] == 1
    assert not any(
        table in sql
        for sql in statements
        for table in (
            "run_events",
            "run_items",
            "run_item_scores",
            "run_item_pass_scores",
            "run_item_attempts",
        )
    )
    with Session(database) as db:
        assert db.get(Summary, "r").projection_revision > revision
        assert db.get(Partition, "r").queue_state == "ready"


def test_reconcile_recovers_old_worker_and_excludes_ineligible_runs(database):
    from datetime import datetime
    from sqlalchemy import delete
    from qym_platform.db.models import Run
    from qym_platform.services import dashboard_summaries as service

    keys = ["eligible", "soft-deleted", "deleted-queue", "repair", "upgraded", "absent"]
    with Session(database) as db:
        for key in keys:
            run(db, key, status=RunWorkflowStatus.COMPLETED)
            if key != "absent":
                item(db, run_id=key, error="task failed")
        db.commit()
    drain(database)
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        for key in keys:
            if key != "upgraded":
                summary = db.get(Summary, key)
                summary.data = {
                    k: v for k, v in summary.data.items() if k != "task_error_count"
                }
        db.get(Run, "soft-deleted").deleted_at = datetime.utcnow()
        db.get(Partition, "deleted-queue").queue_state = "deleted"
        db.get(Partition, "repair").queue_state = "repair_required"
        db.execute(delete(Run).where(Run.id == "absent"))
        db.commit()
        before = {
            key: (
                db.get(Partition, key).queue_state,
                db.get(Summary, key).projection_revision,
            )
            for key in keys
        }
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        with Session(database) as db:
            assert service.reconcile_summary_shapes(db, limit=1) == 1
            db.commit()
            assert db.get(Partition, "eligible").queue_state == "pending"
            assert (
                db.get(Summary, "eligible").projection_revision == before["eligible"][1]
            )
        with Session(database) as db:
            service.process_partition(db, "eligible")
            db.commit()
        for _ in range(2):
            with Session(database) as db:
                assert service.reconcile_summary_shapes(db) == 0
                db.commit()
    finally:
        event.remove(database, "before_cursor_execute", capture)
    assert not any(
        table in sql
        for sql in statements
        for table in (
            "run_items",
            "run_events",
            "run_item_scores",
            "run_item_pass_scores",
            "run_item_attempts",
        )
    )
    with Session(database) as db:
        assert db.get(Summary, "eligible").data["task_error_count"] == 1
        assert db.get(Summary, "eligible").projection_revision > before["eligible"][1]
        for key in keys[1:]:
            assert (
                db.get(Partition, key).queue_state,
                db.get(Summary, key).projection_revision,
            ) == before[key]


def test_live_events_precede_historical_summary_refreshes(database):
    from datetime import datetime, timedelta
    from qym_platform.services import dashboard_summaries as service

    with Session(database) as db:
        for n in range(25):
            run(db, f"history-{n:02}", status=RunWorkflowStatus.COMPLETED)
        run(db, "live")
        db.commit()
    drain(database)
    with Session(database) as db:
        for n in range(25):
            partition = db.get(Partition, f"history-{n:02}")
            partition.queue_state = "pending"
            partition.updated_at = datetime.utcnow() - timedelta(days=1)
        item(db, run_id="live")
        db.commit()
    with Session(database) as db:
        selected = service.scheduled_partitions(db, limit=20)
        assert selected[0] == "live"
        assert len(selected) == 20
    drain(database)
    with Session(database) as db:
        assert service.scheduled_partitions(db) == []


def test_upgrade_and_live_events_share_bucket_lock_order(database, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from qym_platform.services import dashboard_summaries as service

    if database.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row locks")
    with Session(database) as db:
        run(db, "historical", status=RunWorkflowStatus.COMPLETED)
        run(db, "live")
        item(db, run_id="historical", error="failed")
        db.commit()
    drain(database)
    with Session(database) as db:
        summary = db.get(Summary, "historical")
        summary.data = {
            k: v for k, v in summary.data.items() if k != "task_error_count"
        }
        db.get(Partition, "historical").queue_state = "pending"
        item(db, run_id="live", latency_ms=42)
        db.commit()
    refresh_locked = threading.Event()
    live_attempted = threading.Event()
    lock_buckets = service._lock_buckets
    refresh = service.refresh_run_summary

    def lock(db, project, hours):
        if db.info.get("test_worker") == "live":
            live_attempted.set()
        lock_buckets(db, project, hours)
        db.info["test_buckets_locked"] = True

    def refresh_summary(db, run_id, version):
        if run_id == "historical":
            assert db.info.get(
                "test_buckets_locked"
            ), "refresh bypassed ordered bucket locks"
            refresh_locked.set()
            assert live_attempted.wait(5)
        return refresh(db, run_id, version)

    monkeypatch.setattr(service, "_lock_buckets", lock)
    monkeypatch.setattr(service, "refresh_run_summary", refresh_summary)

    def process(key):
        if key == "live":
            assert refresh_locked.wait(5)
        with Session(database) as db:
            db.info["test_worker"] = key
            service.process_partition(db, key)
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(process, key) for key in ("historical", "live")]
        for future in futures:
            future.result(timeout=15)
    with Session(database) as db:
        for key in ("historical", "live"):
            assert db.get(Partition, key).queue_state == "ready"
            assert db.get(Partition, key).retry_count == 0
        assert db.get(Summary, "historical").data["task_error_count"] == 1
        assert db.get(Summary, "live").data["avg_latency_ms"] == 42
