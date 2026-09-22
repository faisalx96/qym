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
