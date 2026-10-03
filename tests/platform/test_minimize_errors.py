"""Lower-is-better metrics leave errors out of the mean (C015 amended, C008).

For a metric declared ``direction="minimize"`` 0 is the best value, so task
and scorer errors are left out of its run mean (and views show the count
beside it) instead of counting as 0; in pass/fail verdicts an errored item or
pass is a failure. Higher-is-better metrics, and metrics that declare no
direction, keep the C015 rule (errors count as 0). The server
(services/run_means.py) and the browser (metrics.js getRowScore) apply the
same rule on every surface.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from qym.core.reducers import group_stats
from qym_platform.api import insights as insights_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.dashboard_models import DashboardRunSummary as Summary
from qym_platform.db.models import (
    Run,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
)
from qym_platform.services import dashboard_summaries as summaries_service
from qym_platform.services import repeat_passes
from qym_platform.services.repeat_analysis import build_repeat_analysis
from qym_platform.services.run_means import (
    MetricTotals,
    apply_repeat_pass_errors,
    is_metric_error,
    is_task_error_pass,
    mean_without_metric_errors,
    metric_mean_fields,
    reduce_pass_scores,
    run_metric_count,
    run_metric_mean,
)
from sqlalchemy import event
from sqlalchemy.orm import Session
from test_dashboard_durable_summaries import (
    drain,
    item,
    legacy,
    projected,
    run,
)
from test_repeat_runs_platform import (
    RUN_ID,
    _auth_mode,
    _event,
    _ingest,
    _make_env,
    _seed,
)

REPO = Path(__file__).resolve().parents[2]
METRICS_JS = REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"


def _approx(values):
    return {key: pytest.approx(value) for key, value in values.items()}


def _principal(db):
    return Principal(user=db.get(User, "u"), auth_type="none")


def _spec(run_id, name, position, direction, **kwargs):
    return RunMetricSpec(
        run_id=run_id,
        metric_name=name,
        position=position,
        schema_version=2,
        score_type=kwargs.pop("score_type", "percentage"),
        direction=direction,
        **kwargs,
    )


def _node(script, data):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required to check metrics.js")
    source = (
        "const fs = require('fs'), vm = require('vm');\n"
        "const ctx = vm.createContext({ window: {} });\n"
        "vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);\n"
        "const m = ctx.window.QymMetrics;\n"
        "const input = JSON.parse(fs.readFileSync(0, 'utf8'));\n" + script
    )
    result = subprocess.run(
        [node, "-e", source, str(METRICS_JS)],
        input=json.dumps(data),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


# The run page's mean: metrics.js getRowScore with each metric's declared
# direction, averaged over the rows that have a score.
JS_MEANS = """
const specs = input.specs || {};
const out = {};
input.metrics.forEach((name, idx) => {
  const direction = m.metricDirection(specs[name]);
  let sum = 0, cnt = 0;
  for (const row of input.rows) {
    const { score } = m.getRowScore(row, idx, name, direction);
    if (score !== null) { sum += score; cnt++; }
  }
  out[name] = cnt ? sum / cnt : null;
});
process.stdout.write(JSON.stringify(out));
"""


def test_rule_leaves_errors_out_only_for_lower_is_better_metrics():
    totals = dict(
        score_sum=1.5,
        score_count=3,
        error_score_sum=0.0,
        error_score_count=1,
        unscored_errors=1,
    )
    # maximize and undeclared: every error counts as 0 (C015).
    for direction in ("maximize", None):
        metric = MetricTotals(direction=direction, **totals)
        assert run_metric_mean(metric, task_errors=1) == pytest.approx(0.3)
        assert run_metric_count(metric, task_errors=1) == 5
        assert mean_without_metric_errors(metric, 1) == pytest.approx(0.5)
    # minimize: task and scorer errors are left out.
    metric = MetricTotals(direction="minimize", **totals)
    assert run_metric_mean(metric, task_errors=1) == pytest.approx(0.75)
    assert run_metric_count(metric, task_errors=1) == 2
    assert mean_without_metric_errors(metric, 1) == pytest.approx(0.75)
    # Every item errored: no mean, and it is not published (0 reads as best).
    empty = MetricTotals(direction="minimize", unscored_errors=2)
    assert run_metric_mean(empty, task_errors=3) is None
    fields = metric_mean_fields(
        ["h", "q"],
        {"h": empty, "q": MetricTotals(unscored_errors=2)},
        3,
        {"h": "minimize", "q": "maximize"},
    )
    assert fields["metric_averages"] == {"q": 0.0}
    assert "h" not in fields["metric_scored_averages"]


class _Pass:
    def __init__(self, score, meta=None, label=None):
        self.score_numeric, self.meta, self.label = score, meta, label


def test_pass_reduction_leaves_errored_passes_out_when_lower_is_better():
    passes = [
        _Pass(0.2),
        _Pass(0.0, {"status": "error"}),
        _Pass(None, {"status": "timeout"}),
        _Pass(0.0, None, "error"),  # ingest's zero-fill for a failed task
        _Pass(0.6),
    ]
    assert reduce_pass_scores(passes, "minimize") == (pytest.approx(0.4), 2)
    assert reduce_pass_scores(passes, "maximize") == (pytest.approx(0.8 / 5), 5)
    assert reduce_pass_scores(passes, None) == (pytest.approx(0.8 / 5), 5)
    assert reduce_pass_scores(passes[1:4], "minimize") == (None, 0)

    totals = {"h": MetricTotals(score_sum=0.6, score_count=2, direction="minimize")}
    apply_repeat_pass_errors(
        totals,
        [("h", 0.2, [(0.2, False, False), (0.0, True, False), (0.4, False, False)])],
    )
    # The item re-reduces over its clean passes: (0.4 + 0.3) / 2.
    assert run_metric_mean(totals["h"], 0) == pytest.approx(0.35)


def _classic(db, run_id="r"):
    """h is lower-is-better, q higher-is-better, u declares no direction.

    a, b: scored; c: h scorer error stored as 0, u scorer error unscored;
    d: h unscored scorer error, q scorer error stored as 0; e: task error.
    """
    run(
        db,
        run_id=run_id,
        metrics=["h", "q", "u"],
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 5},
    )
    db.add(_spec(run_id, "h", 0, "minimize", pass_threshold=0.3))
    db.add(_spec(run_id, "q", 1, "maximize"))
    for index, item_id in enumerate("abcd"):
        item(db, item_id=item_id, run_id=run_id, index=index)
    item(db, item_id="e", run_id=run_id, index=4, output=None, error="boom")
    for item_id, metric, score, meta in [
        ("a", "h", 0.2, {}),
        ("b", "h", 0.6, {}),
        ("c", "h", 0.0, {"status": "error", "error": "judge 429"}),
        ("d", "h", None, {"status": "timeout"}),
        ("a", "q", 1.0, {}),
        ("b", "q", 0.5, {}),
        ("c", "q", 0.8, {}),
        ("d", "q", 0.0, {"status": "error"}),
        ("a", "u", 0.5, {}),
        ("b", "u", 0.5, {}),
        ("c", "u", None, {"status": "error"}),
        ("d", "u", 1.0, {}),
    ]:
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id=item_id,
                metric_name=metric,
                score_numeric=score,
                meta=meta,
            )
        )
    db.commit()


# h: (0.2 + 0.6) / 2, errors left out. q: (1.0 + 0.5 + 0.8 + 0 + task 0) / 5.
# u: (0.5 + 0.5 + 0 + 1.0 + task 0) / 5.
CLASSIC = {"h": 0.4, "q": 0.46, "u": 0.4}
CLASSIC_SCORED = {"q": 0.575, "u": 0.5}


def _rows(engine, run_id="r"):
    with Session(engine) as db:
        data = runs_api.legacy_run_data(
            run_id, db=db, principal=_principal(db), view="compact"
        )
    return data["snapshot"]


def test_classic_run_list_summary_insights_run_page_agree(database):
    with Session(database) as db:
        _classic(db)
    expected_list = legacy(database)
    drain(database)
    published = projected(database)
    with Session(database) as db:
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, "r"))
        point = insights_api.project_insights(
            project_slug="test",
            period="all",
            task=None,
            dataset=None,
            dataset_version_id=None,
            model=None,
            status=None,
            db=db,
            principal=_principal(db),
        )["runs"][0]
    for name, payload in (
        ("legacy", expected_list),
        ("projected", published),
        ("detail", detail),
    ):
        assert payload["metric_averages"] == _approx(CLASSIC), name
        assert payload["metric_scored_averages"] == _approx(CLASSIC_SCORED), name
    assert point["metric_averages"] == _approx(CLASSIC)
    assert point["metric_counts"] == {"h": 2, "q": 5, "u": 5}

    snapshot = _rows(database)
    means = _node(
        JS_MEANS,
        {
            "rows": snapshot["rows"],
            "metrics": ["h", "q", "u"],
            "specs": snapshot["metric_specs"],
        },
    )
    assert means == _approx(CLASSIC)


PASS_VERDICTS = """
const run = input.run;
const specs = run.snapshot.metric_specs || {};
const out = {};
for (const name of ['h', 'q']) {
  const direction = m.metricDirection(specs[name]);
  const result = m.calculateItemLevelMetrics({
    runsData: [run],
    metricName: name,
    threshold: m.defaultPassThreshold(specs[name]),
    direction,
    isBoolean: false,
    getMetricIndex: data => (data.snapshot.metric_names || []).indexOf(name),
    getItemId: row => row.item_id,
    trackDistribution: true,
  });
  out[name] = {
    passAtK: result.passAtK, avgScore: result.avgScore,
    items: result.totalItems, failed: result.failedCount,
    distribution: result.correctDistribution,
  };
}
process.stdout.write(JSON.stringify(out));
"""


def test_models_and_run_page_never_count_an_errored_item_as_a_pass(database):
    with Session(database) as db:
        _classic(db)
        models = runs_api.models_runs_data(
            files=["r"], db=db, principal=_principal(db)
        )["runs"][0]
    run_page = _rows(database)
    for name, data in (
        ("models", models),
        ("run page", {"run": {"samples": 1}, "snapshot": run_page}),
    ):
        verdicts = _node(PASS_VERDICTS, {"run": data})
        # h passes at <= 0.3: only a. The scorer errors (c, d) and the task
        # error (e) fail; they were passes when an error counted as 0.
        assert verdicts["h"]["passAtK"] == pytest.approx(0.2), name
        assert verdicts["h"]["avgScore"] == pytest.approx(0.4), name
        assert verdicts["h"]["items"] == 5, name
        assert verdicts["h"]["distribution"] == [4, 1], name
        # q passes at >= 0.8 (a, c); errors fail through their 0 as before.
        assert verdicts["q"]["passAtK"] == pytest.approx(0.4), name
        assert verdicts["q"]["avgScore"] == pytest.approx(0.46), name


COHORT = """
const rows = (values, metas) => values.map((value, i) => ({
  item_id: 'item-' + i, status: metas[i] === 'task' ? 'error' : 'completed',
  metric_values: [value],
  metric_meta: metas[i] && metas[i] !== 'task' ? { h: metas[i] } : {},
}));
const left = { run: { run_id: 'L', samples: 1 }, snapshot: { metric_names: ['h'],
  rows: rows([0, 0, 0.1], [{ status: 'error' }, 'task', null]) } };
const right = { run: { run_id: 'R', samples: 1 }, snapshot: { metric_names: ['h'],
  rows: rows([0.1, 0.1, 0.1], [null, null, null]) } };
const repeat = { run: { run_id: 'P', samples: 3 }, snapshot: { metric_names: ['h'],
  rows: [{ item_id: 'item-0', status: 'completed', metric_values: [0.05],
    pass_scores: { h: [0, 0.1, 0] },
    pass_metric_meta: { h: [{ status: 'error' }, null, { label: 'error' }] },
    pass_attempts: [{ status: 'completed' }, { status: 'completed' }, { status: 'error' }] }] } };
const options = direction => ({
  threshold: 0.2, direction, isBoolean: false, metricName: 'h',
  getMetricIndex: () => 0, getItemId: row => row.item_id, getRunId: data => data.run.run_id,
});
const minimize = m.calculateGroupedCohortComparison({
  runsData: [left, right], leftRunIds: ['L'], rightRunIds: ['R'], ...options('minimize') });
const perPass = m.calculateGroupedCohortComparison({
  runsData: [repeat, right], leftRunIds: ['P'], rightRunIds: ['R'], ...options('minimize') });
process.stdout.write(JSON.stringify({
  eligible: minimize.eligibleItems,
  leftPassAtK: minimize.left.passAtK,
  rightPassAtK: minimize.right.passAtK,
  leftAvg: minimize.left.avgAtK,
  buckets: Object.fromEntries(Object.entries(minimize.buckets).map(([k, v]) => [k, v.count])),
  improved: minimize.summary.improvedCount,
  repeatPasses: perPass.items[0].leftPasses,
  repeatScores: perPass.items[0].leftScores,
}));
"""


def test_sweep_counts_errored_items_and_passes_as_failures():
    result = _node(COHORT, {})
    # Both errored left items fail and have no score; item-2 passes on both.
    assert result["eligible"] == 3
    assert result["leftPassAtK"] == pytest.approx(1 / 3)
    assert result["rightPassAtK"] == pytest.approx(1.0)
    assert result["leftAvg"] == pytest.approx(0.1)
    assert result["buckets"] == {
        "a_sweeps_b": 0,
        "b_sweeps_a": 2,
        "both_pass": 1,
        "both_fail": 0,
    }
    assert result["improved"] == 2
    # A repeat item: the scorer-error and task-error passes fail, unscored.
    assert result["repeatPasses"] == [False, True, False]
    assert result["repeatScores"] == [0.1]


EMPTY_AVERAGES = """
const run = (id, values) => ({ run: { run_id: id, samples: 1 }, snapshot: { metric_names: ['h'],
  rows: values.map((value, i) => ({ item_id: 'item-' + i, status: 'completed',
    metric_values: [value === null ? 0 : value],
    metric_meta: value === null ? { h: { status: 'error' } } : {} })) } });
const runs = [run('E', [null, null]), run('M', [0.6, 0.1]), run('Z', [0, 0])];
const cohort = (left, right, direction) => {
  const result = m.calculateGroupedCohortComparison({
    runsData: runs, leftRunIds: [left], rightRunIds: [right],
    threshold: 0.2, direction, isBoolean: false, metricName: 'h',
    getMetricIndex: () => 0, getItemId: row => row.item_id, getRunId: data => data.run.run_id });
  return [result.left.avgAtK, result.right.avgAtK, result.deltas.avgAtK,
    result.left.passAtK, result.right.passAtK];
};
process.stdout.write(JSON.stringify({
  left: cohort('E', 'M', 'minimize'),
  right: cohort('M', 'E', 'minimize'),
  both: cohort('E', 'E', 'minimize'),
  zero: cohort('Z', 'M', 'minimize'),
  maximize: cohort('E', 'M', 'maximize'),
}));
"""


def test_sweep_cohort_without_a_score_has_no_average_and_no_delta():
    result = _node(EMPTY_AVERAGES, {})
    # [left avg, right avg, avg delta, left Pass@k, right Pass@k]. Every h
    # entry of run E errored: no average and no delta, never 0.0 -> 0.35;
    # its errors still fail in the pass rates.
    assert result["left"] == [None, pytest.approx(0.35), None, 0, 0.5]
    assert result["right"] == [pytest.approx(0.35), None, None, 0.5, 0]
    assert result["both"] == [None, None, None, 0, 0]
    # Measured zeros are scores.
    assert result["zero"] == [0, pytest.approx(0.35), pytest.approx(0.35), 1, 0.5]
    # Higher is better: errors still count as 0.
    assert result["maximize"] == [0, pytest.approx(0.35), pytest.approx(0.35), 0, 0.5]


PASS_TOOLTIPS = """
const out = {};
for (const [name, args] of Object.entries(input)) {
  const tips = m.getMetricTooltips(...args);
  out[name] = [tips.passAtK, tips.passHatK, tips.maxAtK, tips.failedCount];
}
process.stdout.write(JSON.stringify(out));
"""


def test_pass_tooltips_follow_the_metric_direction():
    """getMetricTooltips (the repeat run page): lower is better passes at or
    below the threshold, its boolean best is 0%, and its errors are left out.
    Callers without a direction keep the higher-is-better wording."""
    tips = _node(
        PASS_TOOLTIPS,
        {
            "maximize": [3, False, 80, "maximize"],
            "minimize": [3, False, 20, "minimize"],
            "boolean maximize": [3, True, 80, "maximize"],
            "boolean minimize": [3, True, 20, "minimize"],
            "omitted": [3, False, 80],
            "undeclared": [3, False, 80, None],
        },
    )
    at_least = "Percentage of items where at least one of the 3 runs "
    every = "Percentage of items where all 3 runs "
    best = "Average of the best score across all 3 runs for each item"
    zero = (
        "Item evaluations that returned a task or scorer error, across all "
        "passes of the selected runs. Errors are scored as 0%."
    )
    maximize = [at_least + "scored ≥80%.", every + "scored ≥80%.", best + ".", zero]
    assert tips["maximize"] == tips["omitted"] == tips["undeclared"] == maximize
    assert tips["minimize"] == [
        at_least + "scored ≤20%.",
        every + "scored ≤20%.",
        best + " (the lowest, since lower is better).",
        "Item evaluations that returned a task or scorer error, across all "
        "passes of the selected runs. Lower is better for this metric, so "
        "errors are left out of its scores and count as fails.",
    ]
    assert tips["boolean maximize"][:2] == [
        at_least + "achieved a perfect score (100%).",
        every + "achieved a perfect score (100%).",
    ]
    assert tips["boolean minimize"][:2] == [
        at_least + "achieved the best score (0%).",
        every + "achieved the best score (0%).",
    ]


def test_compare_sweep_shows_no_average_and_no_verdict_for_a_side_without_scores():
    from test_metric_semantics import _compare_functions, run_metrics_js

    functions = _compare_functions(
        "sweepPassAtK", "sweepPassHatK", "sweepBinomPmf", "sweepLutMoments",
        "sweepPassMetricLuts", "normalCdf", "SWEEP_Z_95", "computeSweepNoise",
        "summarizeSweepItems", "escapeHtml", "getDeltaClass", "getNoiseDeltaClass",
        "renderSweepDelta", "formatSweepMetricValue", "renderSweepStatCard",
        "formatSweepCompactMetricValue", "formatSweepCompactDelta",
        "renderSweepMetadataMetricCell",
    )
    run_metrics_js(
        "const document = {createElement: () => ({set textContent(v) { this.v = String(v); }, get innerHTML() { return this.v; }})};\n"
        "var state = {selectedOverviewMetric: 'h'};\n"
        "function metricDirectionFor() { return 'minimize'; }\n"
        + functions
        + r"""
    // h is lower-is-better (pass at <= 0.2). Item a errored on the left (no
    // score, a fail); item b passed on both sides.
    const entry = (left, right) => ({
      leftScores: left === null ? [] : [left], rightScores: [right],
      leftPasses: [left !== null && left <= 0.2], rightPasses: [right <= 0.2],
      leftAttempts: [1], rightAttempts: [1], move: 0,
    });
    const a = entry(null, 0.6), b = entry(0.1, 0.1);
    const all = summarizeSweepItems([a, b], 1, 1, null);
    assert.equal(all.left.avgAtK, 0.1);
    assert.ok(Math.abs(all.deltas.avgAtK - 0.25) < 1e-9);
    // A filter that leaves only item a: no left average, delta or verdict.
    const only = summarizeSweepItems([a], 1, 1, null);
    assert.equal(only.left.avgAtK, null);
    assert.equal(only.right.avgAtK, 0.6);
    assert.equal(only.deltas.avgAtK, null);
    assert.equal(only.noise.avgAtK, null);
    assert.ok(only.noise.passAtK);
    assert.deepEqual([only.left.passAtK, only.right.passAtK], [0, 0]);
    assert.equal(summarizeSweepItems([], 1, 1, null).left.avgAtK, null);
    // A measured zero is a score.
    const zero = summarizeSweepItems([entry(0, 0.6)], 1, 1, null);
    assert.equal(zero.left.avgAtK, 0);
    assert.equal(zero.deltas.avgAtK, 0.6);

    const card = renderSweepStatCard('Avg@1', only.left.avgAtK, only.right.avgAtK,
      only.deltas.avgAtK, only.noise.avgAtK, 'minimize');
    assert.match(card, /sweep-stat-card qym-stat-strip__item neutral/);
    assert.match(card, /sweep-stat-from">—</);
    assert.match(card, /sweep-stat-to">60.0%</);
    assert.match(card, /sweep-delta-pill neutral">—</);
    const cell = renderSweepMetadataMetricCell(only.left.avgAtK, only.right.avgAtK,
      only.deltas.avgAtK, 'minimize');
    assert.match(cell, /class="from">—</);
    assert.match(cell, /sweep-metadata-delta neutral">—</);
    // The zero side still compares (a regression for lower-is-better).
    assert.match(renderSweepStatCard('Avg@1', 0, 0.6, 0.6, null, 'minimize'),
      /sweep-delta-pill negative">\+60.0%</);
    """
    )


def _repeat(db, run_id="rr"):
    """Three passes; h lower-is-better (primary), q higher-is-better.

    a: pass 2 scorer error. b: pass 2 task error (zero-filled, label
    "error"). c: clean. d: pass 3 task error, which is also the item's
    latest outcome (its RunItem error); it is judged per pass all the same,
    like b. Stored item values follow the old rule (errors as 0).
    """
    run(
        db,
        run_id=run_id,
        metrics=["h", "q"],
        samples=3,
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 4, "last_completed_pass": 3},
    )
    db.add(_spec(run_id, "h", 0, "minimize", pass_threshold=0.3, is_primary=True))
    db.add(_spec(run_id, "q", 1, "maximize"))
    for index, item_id in enumerate("abc"):
        item(db, item_id=item_id, run_id=run_id, index=index)
    item(db, item_id="d", run_id=run_id, index=3, output=None, error="boom")
    err, task = ({"status": "error"}, None), ({}, "error")
    ok = ({}, None)
    passes = {
        ("a", "h"): [(0.2, ok), (0.0, err), (0.4, ok)],
        ("a", "q"): [(1.0, ok), (0.0, err), (1.0, ok)],
        ("b", "h"): [(0.1, ok), (0.0, task), (0.3, ok)],
        ("b", "q"): [(1.0, ok), (0.0, task), (0.5, ok)],
        ("c", "h"): [(0.5, ok)] * 3,
        ("c", "q"): [(0.5, ok)] * 3,
        ("d", "h"): [(0.2, ok), (0.2, ok), (0.0, task)],
        ("d", "q"): [(1.0, ok), (1.0, ok), (0.0, task)],
    }
    for (item_id, metric), values in passes.items():
        for number, (score, (meta, label)) in enumerate(values, start=1):
            db.add(
                RunItemPassScore(
                    run_id=run_id,
                    item_id=item_id,
                    metric_name=metric,
                    pass_number=number,
                    score_numeric=score,
                    meta=dict(meta),
                    label=label,
                )
            )
        reduced = sum(score for score, _ in values) / 3
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id=item_id,
                metric_name=metric,
                score_numeric=reduced,
                score_raw=reduced,
                meta={"sample_reducer": "mean", "samples_observed": 3},
            )
        )
    failed = {("b", 2), ("d", 3)}
    for item_id in "abcd":
        for number in (1, 2, 3):
            db.add(
                RunItemAttempt(
                    run_id=run_id,
                    item_id=item_id,
                    pass_number=number,
                    attempt_number=1,
                    status="failed" if (item_id, number) in failed else "completed",
                    error="boom" if (item_id, number) in failed else None,
                    is_last_attempt=True,
                    latency_ms=10.0,
                    output=None if (item_id, number) in failed else "answer",
                )
            )
    db.commit()


# Task errors are judged per pass, whichever pass failed last (d's pass 3 is
# its RunItem error, and counts like b's pass 2).
# h: a (0.2 + 0.4) / 2, b (0.1 + 0.3) / 2, c 0.5, d (0.2 + 0.2) / 2.
# q: a 2/3, b 0.5, c 0.5, d 2/3 (its failed pass as 0). Without scorer errors
# a is 1.0.
REPEAT = {"h": 1.2 / 4, "q": (2 / 3 + 0.5 + 0.5 + 2 / 3) / 4}
REPEAT_SCORED = {"q": (1.0 + 0.5 + 0.5 + 2 / 3) / 4}
# Per pass (every pass row): h leaves errored passes out, q counts them as 0.
PASS_MEANS = {
    1: {"h": 0.25, "q": 0.875},
    2: {"h": 0.35, "q": 0.375},
    3: {"h": 0.4, "q": 0.5},
}


def test_repeat_run_list_summary_run_page_and_passes_agree(database):
    with Session(database) as db:
        _repeat(db)
    expected_list = legacy(database, "rr")
    drain(database)
    published = projected(database, "rr")
    with Session(database) as db:
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, "rr"))
        passes = runs_api.run_passes("rr", db, _principal(db))["passes"]
    for name, payload in (
        ("legacy", expected_list),
        ("projected", published),
        ("detail", detail),
    ):
        assert payload["metric_averages"] == _approx(REPEAT), name
        assert payload["metric_scored_averages"] == _approx(REPEAT_SCORED), name
    for name, payload in (("legacy", expected_list), ("projected", published)):
        strip = payload["pass_summaries"]
        assert [p["primary_metric"] for p in strip] == ["h"] * 3, name
        assert [p["primary_score"] for p in strip] == [
            pytest.approx(PASS_MEANS[n]["h"]) for n in (1, 2, 3)
        ], name
    assert {p["pass_number"]: p["metric_means"] for p in passes} == {
        number: _approx(means) for number, means in PASS_MEANS.items()
    }

    snapshot = _rows(database, "rr")
    means = _node(
        JS_MEANS,
        {
            "rows": snapshot["rows"],
            "metrics": ["h", "q"],
            "specs": snapshot["metric_specs"],
        },
    )
    assert means == _approx(REPEAT)


def test_models_payload_judges_repeat_items_without_their_errored_passes(database):
    with Session(database) as db:
        _repeat(db)
        models = runs_api.models_runs_data(
            files=["rr"], db=db, principal=_principal(db)
        )["runs"][0]
    rows = {row["item_id"]: row for row in models["snapshot"]["rows"]}
    # Only items with an errored pass carry their passes (with the error
    # markers), so Models keeps one entry per item.
    assert sorted(rows["a"]["pass_scores"]) == ["h", "q"]
    assert rows["a"]["pass_metric_meta"]["h"][1] == {"status": "error"}
    assert rows["b"]["pass_metric_meta"]["h"][1] == {"label": "error", "task_error": True}
    assert "pass_scores" not in rows["c"]
    assert models["snapshot"]["pass_scores_scope"] == "errored"
    verdicts = _node(PASS_VERDICTS, {"run": models})
    # h: a (0.2, 0.4) and b (0.1, 0.3) without their errored passes, c 0.5;
    # d is a task error. a and b errored, so none passes at <= 0.3.
    assert verdicts["h"]["avgScore"] == pytest.approx(REPEAT["h"])
    assert verdicts["h"]["passAtK"] == 0.0
    assert verdicts["h"]["failed"] == 3
    # q counts errored passes as 0 (the stored item values).
    assert verdicts["q"]["avgScore"] == pytest.approx(REPEAT["q"])


def test_repeat_group_metrics_count_errored_passes_as_failures(database):
    with Session(database) as db:
        _repeat(db)
        group = runs_api.run_group_metrics(
            "rr", metric=None, threshold=None, db=db, principal=_principal(db)
        )
    assert group["metric"] == "h" and group["direction"] == "minimize"
    stats = group["group"]
    # Passes (<= 0.3): a 1 of 3, b 2 of 3, c 0, d 2 of 3; errored passes fail.
    assert stats["pass_at_k"] == pytest.approx(0.75)
    assert stats["pass_hat_k"] == pytest.approx(0.0)
    assert stats["avg_at_k"] == pytest.approx(2.9 / 9)
    assert stats["max_at_k"] == pytest.approx(0.25)
    assert group["distribution"] == [1, 1, 2, 0]
    # Higher-is-better metrics keep counting errored passes as 0.
    assert group_stats({"x": [0.0, 1.0]}, threshold=0.5)["avg_at_k"] == 0.5
    assert build_repeat_analysis(
        {"x": [None, 0.2]}, threshold=0.3, samples=2, direction="minimize"
    )["distribution"] == [0, 1, 0]


def test_group_metrics_publish_no_average_when_every_pass_errored(database):
    with Session(database) as db:
        run(
            db,
            run_id="all-err",
            metrics=["h"],
            samples=2,
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"total_items": 1},
        )
        db.add(_spec("all-err", "h", 0, "minimize", pass_threshold=0.3))
        item(db, item_id="a", run_id="all-err", index=0)
        for number, (score, meta) in enumerate(
            [(0.0, {"status": "error"}), (None, {"status": "timeout"})], start=1
        ):
            db.add(
                RunItemPassScore(
                    run_id="all-err",
                    item_id="a",
                    metric_name="h",
                    pass_number=number,
                    score_numeric=score,
                    meta=meta,
                )
            )
        db.commit()
        group = runs_api.run_group_metrics(
            "all-err", metric=None, threshold=None, db=db, principal=_principal(db)
        )
    # No score is left: 0 would read as the best value of a lower-is-better
    # metric, so there is no average or best score, and nothing passes.
    assert group["group"]["avg_at_k"] is None
    assert group["group"]["max_at_k"] is None
    assert group["group"]["pass_at_k"] == 0.0
    assert group["distribution"] == [1, 0, 0]


def test_root_cause_reads_pass_rows_only_for_lower_is_better_metrics(database):
    from qym_platform.services.root_cause_dashboard import (
        DashboardFilters,
        _load_snapshot,
    )

    with Session(database) as db:
        _repeat(db)
        # h declares higher is better here: its errored passes count as 0 in
        # the stored item values and need no pass rows.
        db.query(RunMetricSpec).filter_by(run_id="rr", metric_name="h").update(
            {"direction": "maximize"}
        )
        db.commit()
    expected = legacy(database, "rr")["metric_averages"]
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        with Session(database) as db:
            snapshot = _load_snapshot(
                db, "p", DashboardFilters(), include_changes=False
            )
    finally:
        event.remove(database, "before_cursor_execute", capture)
    assert snapshot.errored_passes == set()
    assert {
        metric: stat["average"]
        for (run_id, metric), stat in snapshot.score_stats.items()
    } == _approx(expected)
    assert not any("run_item_pass_scores" in sql for sql in statements)


def test_pass_edit_and_pass_deletion_re_reduce_without_errored_passes(database):
    with Session(database) as db:
        _repeat(db)
        runs_api.update_metric(
            {
                "file_path": "rr",
                "row_index": 0,
                "metric_name": "h",
                "new_score": "0.6",
                "pass_number": 3,
            },
            db=db,
            principal=_principal(db),
        )
        stored = (
            db.query(RunItemScore)
            .filter_by(run_id="rr", item_id="a", metric_name="h")
            .one()
        )
        assert stored.score_numeric == pytest.approx(0.4)
        assert stored.meta["samples_observed"] == 2

        # Deleting a pass re-reduces with the same rule.
        repeat_passes._rereduce_scores(db, "rr", 3, set())
        db.flush()
        values = {
            (row.item_id, row.metric_name): row.score_numeric
            for row in db.query(RunItemScore).filter_by(run_id="rr")
        }
        assert values[("b", "h")] == pytest.approx(0.2)
        assert values[("d", "h")] == pytest.approx(0.2)
        assert values[("b", "q")] == pytest.approx(0.5)


def test_summary_shape_bump_refreshes_means_without_reading_source_rows(database):
    with Session(database) as db:
        _classic(db)
    drain(database)
    with Session(database) as db:
        # A summary published before this change: errors counted as 0.
        summary = db.get(Summary, "r")
        data = dict(summary.data)
        data["summary_shape"] = 3
        data["metric_averages"] = {"h": 0.16, "q": 0.46, "u": 0.4}
        summary.data = data
        db.commit()
        assert summaries_service.reconcile_summary_shapes(db) == 1
        db.commit()
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        drain(database)
    finally:
        event.remove(database, "before_cursor_execute", capture)
    published = projected(database)
    assert published["summary_shape"] == summaries_service.SUMMARY_SHAPE == 5
    assert published["metric_averages"] == _approx(CLASSIC)
    assert not any(
        table in sql
        for sql in statements
        for table in ("run_items", "run_item_scores", "run_item_pass_scores")
    )


def _ingest_env(samples, *, spec=True):
    app, SessionLocal = _make_env()
    with SessionLocal() as session:
        _seed(session, token="test-token", samples=samples)
        run = session.get(runs_api.Run, RUN_ID)
        run.metrics = ["h"]
        if spec:
            session.add(_spec(RUN_ID, "h", 0, "minimize"))
        session.commit()
    return app, SessionLocal


def _scored(seq, pass_number, score, meta=None):
    return _event(
        seq,
        "metric_scored",
        {
            "item_id": "item-1",
            "pass_number": pass_number,
            "metric_name": "h",
            "score_numeric": score,
            "meta": meta or {},
        },
    )


def test_ingest_reduces_lower_is_better_passes_without_errors():
    app, SessionLocal = _ingest_env(3)
    lines = [
        _event(1, "item_started", {"item_id": "item-1", "index": 0, "pass_number": 1}),
        _scored(2, 1, 0.2),
        _scored(3, 2, 0.0, {"status": "error", "error": "judge 429"}),
        _event(
            4,
            "item_failed",
            {"item_id": "item-1", "index": 0, "pass_number": 3, "error": "boom"},
        ),
    ]
    with TestClient(app) as client:
        _ingest(client, "\n".join(lines) + "\n", "test-token")
    with SessionLocal() as session:
        score = session.query(RunItemScore).one()
        # Only pass 1 counts: (0.2 + 0 + 0) / 3 under the old rule.
        assert score.score_numeric == pytest.approx(0.2)
        assert score.meta["samples_observed"] == 1


def test_ingest_reads_the_direction_of_a_run_started_in_the_same_batch():
    app, SessionLocal = _ingest_env(2, spec=False)
    started = _event(
        1,
        "run_started",
        {
            "task": "t",
            "dataset": "d",
            "metrics": ["h"],
            "metric_specs": {
                "h": {
                    "score_type": "percentage",
                    "direction": "minimize",
                    "schema_version": 2,
                }
            },
            "run_config": {"samples": 2},
            "started_at": "2026-09-05T00:00:00Z",
        },
    )
    lines = [
        started,
        _scored(2, 1, 0.4),
        _scored(3, 2, 0.0, {"status": "error"}),
    ]
    with TestClient(app) as client:
        _ingest(client, "\n".join(lines) + "\n", "test-token")
    with SessionLocal() as session:
        assert session.query(RunItemScore).one().score_numeric == pytest.approx(0.4)
        # Every pass errored: the item has no value (0 would read as best).
        assert reduce_pass_scores(
            session.query(RunItemPassScore).filter_by(pass_number=2).all(), "minimize"
        ) == (None, 0)


def test_guides_describe_how_direction_decides_the_error_rule():
    docs = REPO / "packages/platform/qym_platform/_static/dashboard/docs"
    metrics = (docs / "sdk-guide/metrics.html").read_text()
    assert (
        "For a lower-is-better metric 0 is the best score, so its errors are left out of its mean"
        in metrics
    )
    assert "counts as a fail in Pass/Fail, Pass@k and the Sweep" in metrics
    for guide in (
        "sdk-guide/metrics.html",
        "sdk-guide/judges.html",
        "sdk-guide/custom-metrics.html",
        "get-started/task-metric-io.html",
    ):
        text = (docs / guide).read_text()
        assert "lower-is-better metric" in text, guide


def test_root_cause_dashboard_and_insight_verdicts_follow_the_rule(database):
    from qym_platform.db.models import RunItem
    from qym_platform.services import insights_engine
    from qym_platform.services.root_cause_dashboard import (
        DashboardFilters,
        _load_snapshot,
        _score_outcome,
    )

    with Session(database) as db:
        _classic(db)
        _repeat(db)
        snapshot = _load_snapshot(db, "p", DashboardFilters(), include_changes=False)
        averages = {key: stat["average"] for key, stat in snapshot.score_stats.items()}
        assert averages == _approx(
            {
                ("r", "h"): CLASSIC["h"],
                ("r", "q"): CLASSIC["q"],
                ("r", "u"): CLASSIC["u"],
                ("rr", "h"): REPEAT["h"],
                ("rr", "q"): REPEAT["q"],
            }
        )
        specs = snapshot.metric_specs
        items = {(row.run_id, row.item_id): row for row in db.query(RunItem)}
        scores = {
            (row.run_id, row.item_id, row.metric_name): row
            for row in db.query(RunItemScore)
        }

        def outcome(run_id, item_id, metric):
            return _score_outcome(
                items[run_id, item_id],
                scores[run_id, item_id, metric],
                specs[run_id, metric],
            )

        # A scorer error of the lower-is-better h is an error, not a pass.
        assert outcome("r", "c", "h") == "error"
        assert outcome("r", "a", "h") == "passed"
        assert outcome("r", "d", "q") == "failed"
        # So is a repeat item with an errored pass (a: scorer, b: task).
        assert {("rr", "a", "h"), ("rr", "b", "h")} <= snapshot.errored_passes
        assert {("rr", "a"), ("rr", "b")} <= snapshot.failed_pairs
        assert {("r", "c"), ("r", "d"), ("r", "e")} <= snapshot.failed_pairs
        result = insights_engine._metric_result(
            items["r", "c"], scores["r", "c", "h"], specs["r", "h"]
        )
        assert result == "fail"


def test_repeat_items_whose_every_pass_failed_never_pass_a_zero_threshold(database):
    """A higher-is-better metric at a declared threshold of 0: an item whose
    passes all failed stores 0 and read as a pass on Insights and the
    root-cause dashboard. A mixed item stays a real measurement."""
    from qym_platform.db.models import RunItem
    from qym_platform.services import insights_engine
    from qym_platform.services.root_cause_dashboard import (
        DashboardFilters,
        _load_snapshot,
        _score_outcome,
    )
    from qym_platform.services.run_means import errored_repeat_items

    with Session(database) as db:
        run(
            db,
            run_id="zt",
            metrics=["q"],
            samples=2,
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"total_items": 4},
        )
        db.add(_spec("zt", "q", 0, "maximize", score_type="number", pass_threshold=0.0))
        task, scorer, ok = ({}, "error"), ({"status": "error"}, None), ({}, None)
        passes = {
            "tasks": [task, task],
            "scorer": [scorer, scorer],
            "mixed": [task, ok],
            "zero": [ok, ok],
        }
        for index, (item_id, outcomes) in enumerate(passes.items()):
            item(db, item_id=item_id, run_id="zt", index=index)
            for number, (meta, label) in enumerate(outcomes, start=1):
                db.add(
                    RunItemPassScore(
                        run_id="zt",
                        item_id=item_id,
                        metric_name="q",
                        pass_number=number,
                        score_numeric=0.0,
                        meta=dict(meta),
                        label=label,
                    )
                )
            db.add(
                RunItemScore(
                    run_id="zt",
                    item_id=item_id,
                    metric_name="q",
                    score_numeric=0.0,
                    score_raw=0.0,
                    meta={"sample_reducer": "mean", "samples_observed": 2},
                )
            )
        db.commit()

        specs = db.query(RunMetricSpec).filter_by(run_id="zt").all()
        assert errored_repeat_items(db, specs) == {
            ("zt", "tasks", "q"),
            ("zt", "scorer", "q"),
        }
        snapshot = _load_snapshot(db, "p", DashboardFilters(), include_changes=False)
        assert snapshot.errored_passes == {("zt", "tasks", "q"), ("zt", "scorer", "q")}
        items = {row.item_id: row for row in db.query(RunItem).filter_by(run_id="zt")}
        scores = {
            row.item_id: row for row in db.query(RunItemScore).filter_by(run_id="zt")
        }
        zt = db.get(Run, "zt")
        verdicts = {
            item_id: (
                _score_outcome(
                    items[item_id],
                    scores[item_id],
                    specs[0],
                    ("zt", item_id, "q") in snapshot.errored_passes,
                    zt,
                ),
                insights_engine._metric_result(
                    items[item_id],
                    scores[item_id],
                    specs[0],
                    zt,
                    ("zt", item_id, "q") in snapshot.errored_passes,
                ),
            )
            for item_id in passes
        }
        assert verdicts == {
            "tasks": ("failed", "fail"),
            "scorer": ("failed", "fail"),
            "mixed": ("passed", "success"),
            "zero": ("passed", "success"),
        }
        assert {("zt", "tasks"), ("zt", "scorer")} <= snapshot.failed_pairs
        assert ("zt", "mixed") not in snapshot.failed_pairs

        group = runs_api.run_group_metrics(
            "zt", metric=None, threshold=None, db=db, principal=_principal(db)
        )
    # Only the scored zeros pass: mixed once, zero twice.
    assert group["group"]["pass_at_k"] == pytest.approx(2 / 4)
    assert group["group"]["pass_hat_k"] == pytest.approx(1 / 4)
    assert group["group"]["avg_at_k"] == 0.0
    assert group["distribution"] == [2, 1, 1]


def test_repeat_analysis_cache_signature_holds_each_pass_error():
    from qym_platform.services.repeat_analysis import (
        METHOD_VERSION,
        score_signature,
    )

    assert METHOD_VERSION == 2
    scored = score_signature([("a", 1, 0.0, False)])
    assert scored != score_signature([("a", 1, 0.0, True)])
    assert build_repeat_analysis(
        {"a": [0.0, 0.0]},
        threshold=0.0,
        samples=2,
        eligible={"a": [False, True]},
    )["distribution"] == [0, 1, 0]


def test_scorer_label_error_and_reviewed_task_failures_are_scores():
    # A scorer's own "error" label comes with its metadata: a judged pass.
    scorer_label = _Pass(0.2, {"reason": "judged"}, "error")
    assert reduce_pass_scores([scorer_label, _Pass(0.4)], "minimize") == (
        pytest.approx(0.3),
        2,
    )
    # A reviewer's score over a task-failed pass stands.
    reviewed = _Pass(0.1, {"original_score": 0.0, "modified": "true"}, "error")
    assert reduce_pass_scores([reviewed, _Pass(0.5)], "minimize") == (
        pytest.approx(0.3),
        2,
    )
    rows = [
        {
            "status": "completed",
            "metric_values": [0.3],
            "pass_scores": {"h": [0.2, 0.4]},
            "pass_metric_meta": {"h": [{"label": "error", "reason": "judged"}, {}]},
            "pass_attempts": [{"status": "completed"}, {"status": "completed"}],
        },
        {
            "status": "completed",
            "metric_values": [0.3],
            "pass_scores": {"h": [0.1, 0.5]},
            "pass_metric_meta": {
                "h": [{"label": "error", "modified": "true", "original_score": 0}, {}]
            },
            "pass_attempts": [{"status": "error"}, {"status": "completed"}],
        },
    ]
    out = _node(
        "process.stdout.write(JSON.stringify(input.rows.map("
        "r => m.getRowScore(r, 0, 'h', 'minimize'))));",
        {"rows": rows},
    )
    assert out == [
        {"score": pytest.approx(0.3), "isError": False},
        {"score": pytest.approx(0.3), "isError": False},
    ]


@pytest.mark.parametrize(
    "label, meta, explanation, expected",
    [
        # A scorer error keeps its own status, even under the marker.
        ("error", {"status": "error", "task_error": True}, None, False),
        # A reviewer's edit replaces the zero-fill.
        ("error", {"task_error": True, "modified": "true"}, None, False),
        # The marker decides before the explanation and the metadata.
        ("error", {"task_error": True, "reason": "judged"}, "judged", True),
        ("error", {"task_error": False}, None, False),
        # Unmarked rows: an explanation or scorer metadata is a verdict; a
        # pass diagnosis is not scorer metadata.
        ("error", None, "Off topic", False),
        ("error", {"details": {"tone": "rude"}}, None, False),
        ("error", {"root_cause_analysis": {"cause": "x"}}, None, True),
        (" Error ", None, None, True),
        ("pass", {"task_error": True}, None, False),
    ],
)
def test_error_labeled_pass_classification_order(label, meta, explanation, expected):
    assert is_task_error_pass(label, meta, explanation) is expected


# Pass rows as stored: (label column, meta, explanation, final attempt).
_LABELED_PASSES = {
    "long_reason": ("error", {"reason": "r" * 500}, None, "completed"),
    "nested": ("error", {"details": {"tone": {"score": 2}}}, None, "completed"),
    "explained": ("error", None, "Off topic " * 40, "completed"),
    "verdict_marked": ("error", {"task_error": False}, None, "completed"),
    "failed": ("error", {"task_error": True, "reason": "partial"}, "partial", "error"),
    "legacy_zero_fill": ("error", None, None, "error"),
    "reviewed": ("error", {"task_error": True, "modified": "true"}, None, "error"),
    "scorer_error": ("error", {"status": "timeout"}, None, "completed"),
    # An imported run keeps the label in the metadata only.
    "imported": (None, {"label": "error", "reason": "judged"}, "Off topic", "completed"),
}


def _labeled(db, run_id="lp"):
    """A lower-is-better h over three passes: pass 1 of each item is a
    _LABELED_PASSES case (0.2 when judged, 0 when it failed), passes 2 and 3
    score 0.4 and 0.6. Judged items mean 0.4; failed ones 0.5."""
    run(
        db,
        run_id=run_id,
        metrics=["h"],
        samples=3,
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": len(_LABELED_PASSES), "last_completed_pass": 3},
    )
    db.add(_spec(run_id, "h", 0, "minimize", is_primary=True))
    for index, (item_id, case) in enumerate(_LABELED_PASSES.items()):
        label, meta, explanation, attempt = case
        item(db, item_id=item_id, run_id=run_id, index=index)
        errored = is_metric_error(meta) or is_task_error_pass(label, meta, explanation)
        rows = [
            RunItemPassScore(
                run_id=run_id,
                item_id=item_id,
                metric_name="h",
                pass_number=1,
                score_numeric=0.0 if errored else 0.2,
                label=label,
                meta=dict(meta) if meta is not None else None,
                explanation=explanation,
            )
        ] + [
            RunItemPassScore(
                run_id=run_id,
                item_id=item_id,
                metric_name="h",
                pass_number=number,
                score_numeric=score,
                meta={},
            )
            for number, score in ((2, 0.4), (3, 0.6))
        ]
        db.add_all(rows)
        reduced, observed = reduce_pass_scores(rows, "minimize")
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id=item_id,
                metric_name="h",
                score_numeric=reduced,
                score_raw=reduced,
                meta={"sample_reducer": "mean", "samples_observed": observed},
            )
        )
        for number in (1, 2, 3):
            failed = number == 1 and attempt == "error"
            db.add(
                RunItemAttempt(
                    run_id=run_id,
                    item_id=item_id,
                    pass_number=number,
                    attempt_number=1,
                    status="failed" if failed else "completed",
                    error="boom" if failed else None,
                    is_last_attempt=True,
                    latency_ms=10.0,
                    output=None if failed else "answer",
                )
            )
    db.commit()


# Six judged items at 0.4; the failed, zero-filled and scorer-error items 0.5.
LABELED_H = (6 * 0.4 + 3 * 0.5) / 9


def test_run_payload_flag_keeps_the_classification_through_compaction():
    """The page reads the server's verdict, not what the index leaves of the
    evidence: full rows, index rows and released rows agree with the means."""
    from qym_platform.services.run_payloads import compact_row

    rows, expected = [], []
    for label, meta, explanation, attempt in _LABELED_PASSES.values():
        # As _build_run_data builds the pass metadata.
        payload_meta = dict(meta) if meta else {}
        runs_api._set_task_error_flag(payload_meta, label, meta, explanation)
        if label:
            payload_meta.setdefault("label", label)
        if explanation:
            payload_meta.setdefault("explanation", explanation)
        rows.append(
            {
                "status": "completed",
                "metric_values": [0.4],
                "metric_meta": {},
                "pass_scores": {"h": [0.2]},
                "pass_metric_meta": {"h": [payload_meta]},
                "pass_attempts": [{"status": attempt, "output": "answer"}],
            }
        )
        expected.append(
            is_metric_error(meta) or is_task_error_pass(label, meta, explanation)
        )
    compact = [compact_row(row) for row in rows]
    for row in compact:
        meta = row["pass_metric_meta"]["h"][0]
        assert "explanation" not in meta and "details" not in meta
    script = (
        "process.stdout.write(JSON.stringify(input.rows.map(r => [\n"
        "  m.isTaskErrorPass(r, 'h', 0) || m.isMetricErrorMeta(r.pass_metric_meta.h[0]),\n"
        "  m.getRowScore(r, 0, 'h', 'minimize').isError,\n"
        "])));"
    )
    for view in (rows, compact):
        out = _node(script, {"rows": view})
        assert dict(zip(_LABELED_PASSES, (verdict for verdict, _ in out))) == dict(
            zip(_LABELED_PASSES, expected)
        )
    assert dict(zip(_LABELED_PASSES, expected)) == {
        "long_reason": False,
        "nested": False,
        "explained": False,
        "verdict_marked": False,
        "failed": True,
        "legacy_zero_fill": True,
        "reviewed": False,
        "scorer_error": True,
        "imported": False,
    }
    # The flag is the platform's, never a scorer field.
    hidden = _node(
        "process.stdout.write(JSON.stringify(['task_error', 'modified', "
        "'original_score', 'reason'].map(m.isInternalMetaKey)));",
        {},
    )
    assert hidden == [True, True, True, False]


def test_ingest_stores_a_scorer_error_label_as_a_verdict():
    """A scorer may label its own verdict "error" with no metadata or
    explanation. Ingest marks it, so it is not read as a failed task: the
    lower-is-better item keeps every pass, (0.2 + 0.4 + 0.6) / 3."""
    app, SessionLocal = _ingest_env(3)
    lines = [
        _event(1, "item_started", {"item_id": "item-1", "index": 0, "pass_number": 1}),
        _event(
            2,
            "metric_scored",
            {
                "item_id": "item-1",
                "pass_number": 1,
                "metric_name": "h",
                "score_numeric": 0.2,
                "label": "error",
            },
        ),
        _scored(3, 2, 0.4),
        _scored(4, 3, 0.6),
    ]
    with TestClient(app) as client:
        _ingest(client, "\n".join(lines) + "\n", "test-token")
    with SessionLocal() as session:
        first = session.query(RunItemPassScore).filter_by(pass_number=1).one()
        assert first.label == "error"
        assert first.meta == {"task_error": False}
        assert not is_task_error_pass(first.label, first.meta, first.explanation)
        score = session.query(RunItemScore).one()
        assert score.score_numeric == pytest.approx(0.4)
        assert score.meta["samples_observed"] == 3


def test_editing_a_task_failed_pass_counts_the_reviewer_score(database):
    with Session(database) as db:
        _repeat(db)
        runs_api.update_metric(
            {
                "file_path": "rr",
                "row_index": 1,
                "metric_name": "h",
                "new_score": "0.2",
                "pass_number": 2,
            },
            db=db,
            principal=_principal(db),
        )
        stored = (
            db.query(RunItemScore)
            .filter_by(run_id="rr", item_id="b", metric_name="h")
            .one()
        )
        assert stored.score_numeric == pytest.approx(0.2)
    # b is now (0.1 + 0.2 + 0.3) / 3.
    expected = dict(REPEAT, h=(0.3 + 0.2 + 0.5 + 0.2) / 4)
    drain(database)
    assert projected(database, "rr")["metric_averages"] == _approx(expected)
    assert legacy(database, "rr")["metric_averages"] == _approx(expected)
