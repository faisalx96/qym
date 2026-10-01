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


SUMMARY_KEYS = (
    "metric_averages",
    "metric_scored_averages",
    "metric_error_counts",
    "metric_error_count",
    "execution_error_count",
)


def _summaries(engine):
    """The list (projected and legacy) and run-detail summaries of run "r"."""
    drain(engine)
    with Session(engine) as db:
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, "r"))
    return {
        "projected": projected(engine),
        "legacy": legacy(engine),
        "detail": detail,
    }


def _js_row_scores(rows, metric):
    node = shutil.which("node")
    if not node:
        return None
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const m = ctx.window.QymMetrics;
const { rows, metric } = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(rows.map(r => m.getRowScore(r, 0, metric))));
"""
    result = subprocess.run(
        [
            node,
            "-e",
            script,
            str(REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"),
        ],
        input=json.dumps({"rows": rows, "metric": metric}),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_a_score_edited_over_a_scorer_error_is_no_longer_an_error(database):
    """C009 x C010 x C015: the edit counts at its value and stops being an error."""
    with Session(database) as db:
        run(
            db,
            metrics=["score"],
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"total_items": 3},
        )
        for index, item_id in enumerate(("a", "b", "c")):
            item(db, item_id=item_id, index=index)
        for item_id, score, meta in [
            ("a", 1.0, {}),
            ("b", 0.0, {"status": "error", "error": "judge 429", "traceback": "tb"}),
            ("c", 0.5, {}),
        ]:
            db.add(
                RunItemScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name="score",
                    score_numeric=score,
                    meta=meta,
                )
            )
        db.commit()
    before = _summaries(database)
    assert before["projected"]["metric_error_counts"] == {"score": 1}
    assert before["projected"]["metric_scored_averages"] == _approx({"score": 0.75})

    with Session(database) as db:
        response = runs_api.update_metric(
            {"file_path": "r", "row_index": 1, "metric_name": "score", "new_score": "0.45"},
            db=db,
            principal=_principal(db),
        )
        stored = db.query(RunItemScore).filter_by(item_id="b").one()
        assert stored.score_numeric == pytest.approx(0.45)
        # Who edited the score, when, from what to what (C041).
        assert stored.meta.pop("last_edit")["to"] == pytest.approx(0.45)
        assert stored.meta == {
            "original_score": 0.0,
            "modified": "true",
            "original_status": "error",
            "original_error": "judge 429",
            "original_traceback": "tb",
        }
    assert "status" not in response["row"]["metric_meta"]["score"]

    for name, summary in _summaries(database).items():
        assert summary["metric_averages"] == _approx({"score": 0.65}), name
        assert not (summary.get("metric_scored_averages") or {}), name
        assert not (summary.get("metric_error_counts") or {}), name
        assert not summary.get("metric_error_count"), name
        assert not summary.get("execution_error_count"), name

    with Session(database) as db:
        rows = runs_api.legacy_run_data("r", db=db, principal=_principal(db))[
            "snapshot"
        ]["rows"]
    scores = _js_row_scores(rows, "score")
    if scores is not None:
        assert [s["isError"] for s in scores] == [False, False, False]
        assert [s["score"] for s in scores] == _approx_list([1.0, 0.45, 0.5])


def _approx_list(values):
    return [pytest.approx(value) for value in values]


def _repeat_run_with_failed_pass(db):
    run(
        db,
        metrics=["score"],
        samples=2,
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 2, "last_completed_pass": 2},
    )
    item(db, item_id="a", index=0)
    item(db, item_id="b", index=1)
    # a: pass 1 scorer error with no score (older SDKs/imports), pass 2 = 0.
    # b: 1.0 on both passes. By the C015 rule a = (0 + 0) / 2 = 0.
    for item_id, number, score, meta in [
        ("a", 1, None, {"status": "error", "error": "scorer boom"}),
        ("a", 2, 0.0, {}),
        ("b", 1, 1.0, {}),
        ("b", 2, 1.0, {}),
    ]:
        db.add(
            RunItemPassScore(
                run_id="r",
                item_id=item_id,
                metric_name="score",
                pass_number=number,
                score_numeric=score,
                meta=meta,
            )
        )
    for item_id, score in (("a", 0.0), ("b", 1.0)):
        db.add(
            RunItemScore(
                run_id="r",
                item_id=item_id,
                metric_name="score",
                score_numeric=score,
                score_raw=score,
                meta={"sample_reducer": "mean", "samples_observed": 2},
            )
        )
    db.commit()


def test_editing_one_pass_keeps_the_failed_pass_at_zero(database):
    """C009 x C015: a pass edit re-reduces the item with the ingest rule."""
    with Session(database) as db:
        _repeat_run_with_failed_pass(db)
        runs_api.update_metric(
            {
                "file_path": "r",
                "row_index": 0,
                "metric_name": "score",
                "new_score": "1.0",
                "pass_number": 2,
            },
            db=db,
            principal=_principal(db),
        )
        stored = db.query(RunItemScore).filter_by(item_id="a").one()
        assert stored.score_numeric == pytest.approx(0.5)
        assert stored.meta["samples_observed"] == 2
    # Run mean: (0.5 + 1.0) / 2; the failed pass still counts as 0.
    for name, summary in _summaries(database).items():
        assert summary["metric_averages"] == _approx({"score": 0.75}), name


def test_editing_a_failed_pass_clears_its_scorer_error(database):
    with Session(database) as db:
        _repeat_run_with_failed_pass(db)
    assert _summaries(database)["projected"]["metric_error_counts"] == {"score": 1}
    with Session(database) as db:
        runs_api.update_metric(
            {
                "file_path": "r",
                "row_index": 0,
                "metric_name": "score",
                "new_score": "0.6",
                "pass_number": 1,
            },
            db=db,
            principal=_principal(db),
        )
        edited = (
            db.query(RunItemPassScore).filter_by(item_id="a", pass_number=1).one()
        )
        assert edited.meta["original_status"] == "error"
        assert "status" not in edited.meta
        stored = db.query(RunItemScore).filter_by(item_id="a").one()
        assert stored.score_numeric == pytest.approx(0.3)
    for name, summary in _summaries(database).items():
        assert not (summary.get("metric_error_counts") or {}), name
        assert summary["metric_averages"] == _approx({"score": 0.65}), name


def test_repeat_run_publishes_the_mean_without_scorer_errors(database):
    """C015 x C010: repeat runs keep scorer errors on pass rows. The list, the
    run summary and the run page count errored passes and re-reduce those
    items over their other passes for "mean without them"."""
    with Session(database) as db:
        run(
            db,
            metrics=["q"],
            samples=3,
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"total_items": 3, "last_completed_pass": 3},
        )
        for index, item_id in enumerate(("a", "b", "c")):
            item(db, item_id=item_id, index=index)
        err = {"status": "error", "error": "judge 429"}
        passes = {
            "a": [(1.0, {}), (0.0, err), (1.0, {})],
            "b": [(0.8, {}), (0.8, {}), (0.8, {})],
            "c": [(None, err), (0.0, {"status": "timeout"}), (0.6, {})],
        }
        for item_id, values in passes.items():
            for number, (score, meta) in enumerate(values, start=1):
                db.add(
                    RunItemPassScore(
                        run_id="r",
                        item_id=item_id,
                        metric_name="q",
                        pass_number=number,
                        score_numeric=score,
                        meta=meta,
                    )
                )
            # The stored item value by the C015 rule (errored passes are 0).
            reduced = sum(score or 0.0 for score, _ in values) / 3
            db.add(
                RunItemScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name="q",
                    score_numeric=reduced,
                    score_raw=reduced,
                    meta={"sample_reducer": "mean", "samples_observed": 3},
                )
            )
        db.commit()

    # Mean: (2/3 + 0.8 + 0.2) / 3. Without the 3 errored passes: a = 1.0,
    # b = 0.8, c = 0.6 -> 0.8.
    for name, summary in _summaries(database).items():
        assert summary["metric_averages"] == _approx({"q": (2 / 3 + 0.8 + 0.2) / 3}), name
        assert summary["metric_scored_averages"] == _approx({"q": 0.8}), name
        assert summary["metric_error_counts"] == {"q": 3}, name

    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required to check the run page's metrics.js")
    with Session(database) as db:
        rows = runs_api.legacy_run_data("r", db=db, principal=_principal(db))[
            "snapshot"
        ]["rows"]
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const m = ctx.window.QymMetrics;
const { rows } = JSON.parse(fs.readFileSync(0, 'utf8'));
let sum = 0, cnt = 0, errors = 0;
for (const row of rows) {
  const clean = m.scoreWithoutMetricErrors(row, 0, 'q');
  errors += clean.errors;
  if (clean.score !== null) { sum += clean.score; cnt++; }
}
process.stdout.write(JSON.stringify({ scored: sum / cnt, errors }));
"""
    result = subprocess.run(
        [
            node,
            "-e",
            script,
            str(REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"),
        ],
        input=json.dumps({"rows": rows}),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"scored": pytest.approx(0.8), "errors": 3}
