"""Every view shows the same run mean: task and scorer errors count as 0 (C015)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from qym_platform.api import insights as insights_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.run_means import (
    MetricTotals,
    mean_without_metric_errors,
    run_metric_mean,
)
from sqlalchemy.orm import Session
from test_dashboard_durable_summaries import (
    database,
    drain,
    item,
    legacy,
    projected,
    run,
)

REPO = Path(__file__).resolve().parents[2]

# score: 1.0 + 0.5, one scorer error with no score, one scorer error stored as
# 0, one task error -> 1.5 / 5. Without the scorer errors: 1.5 / 3.
# other: 0.8 + 0.6 + 0.4 + 1.0, one task error -> 2.8 / 5. No scorer errors:
# a verdict reason in meta.error is a judged score, not a scorer error (C010).
EXPECTED = {"score": 0.3, "other": 0.56}
EXPECTED_SCORED = {"score": 0.5}


def _seed(db):
    run(db, status=RunWorkflowStatus.COMPLETED, run_metadata={"total_items": 5})
    for item_id in ("ok1", "ok2", "unscored", "zeroed"):
        item(db, item_id=item_id)
    item(db, item_id="task", output=None, error="task unavailable")
    for item_id, metric, score, meta in [
        ("ok1", "score", 1.0, {}),
        ("ok2", "score", 0.5, {}),
        ("unscored", "score", None, {"status": "error", "error": "429"}),
        ("zeroed", "score", 0.0, {"status": "error", "error": "judge failed"}),
        ("ok1", "other", 0.8, {}),
        ("ok2", "other", 0.6, {}),
        ("unscored", "other", 0.4, {"error": "Empty output"}),
        ("zeroed", "other", 1.0, {}),
    ]:
        db.add(
            RunItemScore(
                run_id="r",
                item_id=item_id,
                metric_name=metric,
                score_numeric=score,
                meta=meta,
            )
        )
    db.commit()


def _principal(db):
    return Principal(user=db.get(User, "u"), auth_type="none")


def _approx(values):
    return {key: pytest.approx(value) for key, value in values.items()}


def test_rule_counts_errors_as_zero_and_reports_scored_mean():
    totals = MetricTotals(
        score_sum=1.5,
        score_count=3,
        error_score_sum=0.0,
        error_score_count=1,
        unscored_errors=1,
    )
    assert totals.metric_errors == 2
    assert run_metric_mean(totals, task_errors=1) == pytest.approx(0.3)
    assert mean_without_metric_errors(totals, task_errors=1) == pytest.approx(0.5)
    assert run_metric_mean(MetricTotals(), task_errors=0) is None
    assert mean_without_metric_errors(MetricTotals(unscored_errors=2), 0) is None


def test_list_summary_insights_and_run_page_agree(database):
    with Session(database) as db:
        _seed(db)

    expected_list = legacy(database)
    drain(database)
    published = projected(database)
    with Session(database) as db:
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, "r"))
        points = insights_api.project_insights(
            project_slug="test",
            period="all",
            task=None,
            dataset=None,
            dataset_version_id=None,
            model=None,
            status=None,
            db=db,
            principal=_principal(db),
        )["runs"]
        rows = runs_api.legacy_run_data("r", db=db, principal=_principal(db))[
            "snapshot"
        ]["rows"]

    for payload in (expected_list, published, detail):
        assert payload["metric_averages"] == _approx(EXPECTED)
        assert payload["metric_scored_averages"] == _approx(EXPECTED_SCORED)
    assert points[0]["metric_averages"] == _approx(EXPECTED)
    assert points[0]["metric_counts"] == {"score": 5, "other": 5}

    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required to check the run page's metrics.js")
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const m = ctx.window.QymMetrics;
const { rows, metrics } = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = {};
metrics.forEach((name, idx) => {
  let sum = 0, cnt = 0;
  for (const row of rows) {
    const { score } = m.getRowScore(row, idx, name);
    if (score !== null) { sum += score; cnt++; }
  }
  out[name] = sum / cnt;
});
process.stdout.write(JSON.stringify(out));
"""
    result = subprocess.run(
        [
            node,
            "-e",
            script,
            str(REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"),
        ],
        input=json.dumps({"rows": rows, "metrics": ["score", "other"]}),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == _approx(EXPECTED)


def test_repeat_pass_with_unscored_scorer_error_counts_as_zero(database):
    with Session(database) as db:
        run(
            db,
            metrics=["score"],
            samples=2,
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"total_items": 1, "last_completed_pass": 2},
        )
        item(db)
        db.add(
            RunItemPassScore(
                run_id="r",
                item_id="i",
                metric_name="score",
                pass_number=1,
                score_numeric=1.0,
                meta={},
            )
        )
        db.add(
            RunItemPassScore(
                run_id="r",
                item_id="i",
                metric_name="score",
                pass_number=2,
                score_numeric=None,
                meta={"status": "timeout"},
            )
        )
        db.commit()
        passes = runs_api.run_passes("r", db, _principal(db))["passes"]
    assert [p["metric_means"] for p in passes] == [{"score": 1.0}, {"score": 0.0}]


def test_upgrade_republishes_old_means_without_source_history(database):
    import importlib.util

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from qym_platform.db.dashboard_models import DashboardRunSummary as Summary
    from sqlalchemy import event

    with Session(database) as db:
        _seed(db)
    drain(database)
    with Session(database) as db:
        # A summary published before 0060: old mean, no shape marker.
        summary = db.get(Summary, "r")
        data = dict(summary.data)
        data.pop("summary_shape")
        data.pop("metric_scored_averages")
        data["metric_averages"] = {"score": 0.375, "other": 0.56}
        summary.data = data
        db.commit()
    path = (
        REPO
        / "packages/platform/qym_platform/migrations/versions/0060_run_means_count_metric_errors.py"
    )
    spec = importlib.util.spec_from_file_location("run_means_migration", path)
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
    published = projected(database)
    assert published["metric_averages"] == _approx(EXPECTED)
    assert published["metric_scored_averages"] == _approx(EXPECTED_SCORED)
    assert not any(
        table in sql
        for sql in statements
        for table in ("run_items", "run_item_scores", "run_item_pass_scores")
    )
