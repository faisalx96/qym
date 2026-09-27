"""Metric verdict reasons are not scorer execution errors (C010).

Only ``meta.status`` (error/failed/timeout) marks a scorer error. A reason the
metric stored in ``meta.error`` ("Empty output", a SQL syntax error) is a
judged score. Runs projected under the old rule are rebuilt by the
``reclassify_metric_errors`` maintenance job.
"""

from unittest.mock import patch

import pytest
from qym_platform.api import runs as runs_api
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.maintenance_models import MaintenanceJob
from qym_platform.db.models import RunItemPassScore, RunItemScore, RunWorkflowStatus
from qym_platform.services import dashboard_outbox, maintenance
from qym_platform.services.run_means import is_metric_error
from sqlalchemy.orm import Session, sessionmaker
from test_dashboard_durable_summaries import database, drain, item, projected, run


@pytest.mark.parametrize(
    "meta, expected",
    [
        ({"status": "error", "error": "boom"}, True),
        ({"status": " Timeout "}, True),
        ({"status": "failed"}, True),
        ({"error": "Empty output"}, False),
        ({"is_valid": False, "error": 'ERROR near "FROM": syntax error'}, False),
        ({"reason": "Empty output"}, False),
        ({"status": "success", "error": "x"}, False),
        ({"label": "error"}, False),
        (None, False),
    ],
)
def test_only_status_marks_a_scorer_error(meta, expected):
    assert is_metric_error(meta) is expected


def _old_rule(meta):
    """The pre-C010 rule: any non-empty meta.error counted as a scorer error."""
    if not isinstance(meta, dict):
        return False
    if str(meta.get("status") or "").strip().lower() in {"error", "failed", "timeout"}:
        return True
    error = meta.get("error")
    return bool(error.strip()) if isinstance(error, str) else bool(error)


def _seed(db, run_id, reasons=True):
    run(db, run_id=run_id, status=RunWorkflowStatus.COMPLETED)
    for item_id in ("a", "b", "c"):
        item(db, item_id=item_id, run_id=run_id)
    rows = [
        ("a", "score", 1.0, {}),
        ("b", "score", 0.0, {"status": "error", "error": "judge 429"}),
        ("c", "score", 0.0, {"error": "Empty output"} if reasons else {}),
        ("a", "other", 1.0, {}),
        ("b", "other", 1.0, {}),
        ("c", "other", 0.0, {"is_valid": False, "error": "syntax"} if reasons else {}),
    ]
    for item_id, metric, score, meta in rows:
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id=item_id,
                metric_name=metric,
                score_numeric=score,
                meta=meta,
            )
        )
        db.add(
            RunItemPassScore(
                run_id=run_id,
                item_id=item_id,
                metric_name=metric,
                pass_number=1,
                score_numeric=score,
                meta=meta,
            )
        )
    db.commit()


def test_verdict_reasons_are_not_counted_in_run_summaries(database):
    with Session(database) as db:
        _seed(db, "r")
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, "r"))
    drain(database)
    published = projected(database)
    for payload in (detail, published):
        assert payload["metric_error_count"] == 1
        assert payload["metric_error_counts"] == {"score": 1}
        # Scorer errors count as 0; the reason rows are ordinary zeros.
        assert payload["metric_averages"] == pytest.approx(
            {"score": 1 / 3, "other": 2 / 3}
        )
        assert set(payload["metric_scored_averages"]) == {"score"}


def test_maintenance_job_rebuilds_runs_projected_with_the_old_rule(database):
    # Publish both runs as an older platform did: reasons counted as errors.
    with patch.object(dashboard_outbox, "_metric_execution_error", _old_rule):
        with Session(database) as db:
            _seed(db, "r")
            _seed(db, "clean", reasons=False)
        drain(database)
    assert projected(database)["metric_error_count"] == 3
    assert projected(database, "clean")["metric_error_count"] == 1

    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        job = maintenance.enqueue(db, "reclassify_metric_errors", {"window": 2})
        db.commit()
        job_id = job.id
    worker = maintenance.MaintenanceWorker(factory, database)
    assert worker.tick() == "succeeded"
    with factory() as db:
        row = db.get(MaintenanceJob, job_id)
        # Only the run with reasons is rebuilt; each run once for both tables.
        assert row.progress["runs"] == ["r"]
        assert row.progress["phase"] == "done"
        assert db.get(Partition, "r").queue_state == "backfill"
        assert db.get(Partition, "clean").queue_state != "backfill"

    drain(database)
    published = projected(database)
    assert published["metric_error_count"] == 1
    assert published["metric_error_counts"] == {"score": 1}
    assert projected(database, "clean")["metric_error_count"] == 1
