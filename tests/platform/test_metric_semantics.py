"""Metric direction and primary metric come from the run spec (C008).

One rule for every page: the declared direction decides colors, pass/fail,
"best", winners, Sweep verdicts and rankings; a metric without one is shown
neutrally. Views open on the declared primary metric, else the first metric
by spec position (never alphabetical order).
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException
from qym_platform.api import ingest as ingest_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    RunItemPassScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.metric_semantics import declared_direction
from sqlalchemy.orm import Session
from test_compare_error_counts import run_compare_js
from test_dashboard_durable_summaries import (
    drain,
    item,
    legacy,
    projected,
    run,
)

REPO = Path(__file__).resolve().parents[2]
METRICS_JS = REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"
# Pages load the shared escaping layer before any other script.
SAFE_JS = REPO / "packages/platform/qym_platform/_static/dashboard/qym_safe.js"


def run_metrics_js(body: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required to check metrics.js")
    script = (
        "const assert = require('node:assert/strict'); const window = {};\n"
        + SAFE_JS.read_text()
        + "\nconst QymSafe = window.QymSafe;\n"
        + METRICS_JS.read_text()
        + "\nconst m = window.QymMetrics;\n"
        + body
    )
    result = subprocess.run([node], input=script, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr


# ── one rule: metrics.js and the server agree ─────────────────────────────


SPEC_CASES = [
    (None, None),
    ({}, None),
    ({"score_type": "boolean", "direction": None}, None),
    # Pre-2026-09 SDKs sent "maximize" by default for plain callables.
    ({"score_type": "legacy", "direction": "maximize"}, None),
    ({"score_type": "legacy", "direction": "minimize"}, "minimize"),
    ({"score_type": "percentage", "direction": "maximize"}, "maximize"),
    ({"score_type": "boolean", "direction": "minimize"}, "minimize"),
    ({"score_type": "count", "direction": "sideways"}, None),
    # Schema 2 SDKs send no direction unless declared, so an explicit
    # "maximize" on a plain-callable (legacy) metric is a declaration.
    ({"schema_version": 1, "score_type": "legacy", "direction": "maximize"}, None),
    ({"schema_version": 2, "score_type": "legacy", "direction": "maximize"}, "maximize"),
    ({"schema_version": 2, "score_type": "legacy", "direction": None}, None),
]


def test_explicit_direction_on_a_legacy_metric_survives_ingest():
    """``Metric(fn, score_type="legacy", direction="maximize")`` is declared."""
    from qym.metrics.spec import Metric

    def judged(output, expected):
        return 1.0

    declared = Metric(judged, score_type="legacy", direction="maximize").spec.to_dict()
    assert declared_direction(ingest_api._normalized_metric_spec(declared)) == "maximize"
    undeclared = Metric(judged, score_type="legacy").spec.to_dict()
    assert declared_direction(ingest_api._normalized_metric_spec(undeclared)) is None
    # A newer SDK resuming a run a schema 1 SDK started is not a spec change.
    stored = _spec(score_type="legacy", schema_version=1, direction="maximize")
    assert ingest_api._metric_spec_unchanged(
        stored, ingest_api._normalized_metric_spec(undeclared)
    )


@pytest.mark.parametrize("spec, expected", SPEC_CASES)
def test_server_reads_the_declared_direction(spec, expected):
    assert declared_direction(spec) == expected


def test_client_reads_the_same_direction():
    run_metrics_js(
        "const cases = " + json.dumps(SPEC_CASES) + ";\n"
        + "for (const [spec, expected] of cases) assert.equal(m.metricDirection(spec), expected, JSON.stringify(spec));\n"
    )


def test_client_semantics_helpers():
    run_metrics_js(r"""
    // Default metric: declared primary, else first by position (not alphabetical).
    assert.equal(m.defaultMetricName(['spider2', 'output_empty'], {}), 'spider2');
    assert.equal(m.defaultMetricName(['output_empty', 'spider2'], {spider2: {primary: true}}), 'spider2');
    assert.equal(m.defaultMetricName([], {}), null);
    assert.deepEqual(m.mergeMetricNames([['b', 'a'], ['a', 'c']]), ['b', 'a', 'c']);

    // Best / compare by direction; none without a direction.
    assert.deepEqual(m.bestMetricIndexes([0.015, 0.007, null], 'minimize'), [1]);
    assert.deepEqual(m.bestMetricIndexes([0.015, 0.007], 'maximize'), [0]);
    assert.deepEqual(m.bestMetricIndexes([0.2, 0.2], 'maximize'), [0, 1]);
    assert.deepEqual(m.bestMetricIndexes([0.015, 0.007], null), []);
    assert.equal(m.compareMetricValues(0.1, 0.2, 'minimize'), 1);
    assert.equal(m.compareMetricValues(0.1, 0.2, null), 0);

    // Pass/fail: booleans pass on True (maximize) or False (minimize).
    assert.equal(m.metricPasses(1, 0.8, 'maximize', true), true);
    assert.equal(m.metricPasses(0, 0.8, 'minimize', true), true);
    assert.equal(m.metricPasses(1, 0.8, 'minimize', true), false);
    assert.equal(m.metricPasses(0.1, 0.2, 'minimize'), true);
    assert.equal(m.metricPasses(0.9, 0.8, null), null);
    assert.equal(m.defaultPassThreshold({direction: 'minimize', score_type: 'percentage'}), 0.2);
    assert.equal(m.defaultPassThreshold({pass_threshold: 0.3}), 0.3);
    assert.equal(m.defaultPassThreshold(null, null), 0.8);

    // Colors: inverted for lower-is-better, none without a direction.
    assert.equal(m.getMetricColorClass(0.015, 'score', 'minimize'), 'score-5');
    assert.equal(m.getMetricColorClass(0.015, 'score', 'maximize'), 'score-1');
    assert.equal(m.getMetricColorClass(0.015, 'score', null), '');
    assert.equal(m.getMetricColorClass(0.015, 'score'), '');
    assert.equal(m.getMetricColorClass(5, 'numeric', 'maximize'), '');

    // Sweep verdicts: a drop in a lower-is-better rate is an improvement.
    assert.equal(m.metricDeltaVerdict(-0.026, 0.01, 'minimize'), 'improved');
    assert.equal(m.metricDeltaVerdict(-0.026, 0.01, 'maximize'), 'regressed');
    assert.equal(m.metricDeltaVerdict(-0.026, 0.01, null), 'changed');
    assert.equal(m.metricDeltaVerdict(0.005, 0.01, 'minimize'), 'within_noise');
    """)


def test_item_level_and_cohort_math_follow_the_direction():
    run_metrics_js(r"""
    const run = values => ({snapshot: {metric_names: ['empty'], rows: values.map((v, i) => ({index: i, status: 'completed', metric_values: [v]}))}});
    const runsData = [run([1, 0, 0]), run([0, 0, 1])];
    const base = {runsData, metricName: 'empty', threshold: 0.8, isBoolean: true,
      getMetricIndex: () => 0, trackDistribution: true};
    // Lower is better: False (0) passes; Max@K is the per-item minimum.
    const lower = m.calculateItemLevelMetrics({...base, direction: 'minimize'});
    assert.equal(lower.passAtK, 1);
    assert.equal(lower.passHatK, 1 / 3);
    assert.equal(lower.maxAtK, 0);
    // Higher is better keeps the historical result.
    const higher = m.calculateItemLevelMetrics({...base, direction: 'maximize'});
    assert.equal(higher.passAtK, 2 / 3);
    assert.equal(higher.maxAtK, 2 / 3);
    // No direction: no passes at all (views show values only).
    const neutral = m.calculateItemLevelMetrics({...base, direction: null});
    assert.equal(neutral.passAtK, 0);
    assert.equal(neutral.avgScore, 1 / 3);

    const cohort = m.calculateGroupedCohortComparison({
      runsData: [{...run([1, 1]), id: 'a'}, {...run([0, 0]), id: 'b'}],
      leftRunIds: ['a'], rightRunIds: ['b'], threshold: 0.8, metricName: 'empty',
      direction: 'minimize', isBoolean: true,
      getMetricIndex: () => 0, getItemId: row => String(row.index), getRunId: r => r.id,
    });
    assert.equal(cohort.summary.improvedCount, 2);
    assert.equal(cohort.buckets.b_sweeps_a.count, 2);
    """)


# ── compare: winners, best and Max@K by direction ───────────────────────────


def test_compare_winners_follow_direction_and_neutral_has_none():
    run_compare_js(r"""
        const fixture = values => ({run:{metric_names:['empty']},snapshot:{metric_names:['empty'],rows:
          values.map((v,i)=>({compare_item_id:'i'+i,status:'completed',metric_values:[v]}))}});
        const state = {runs:[fixture([0.3,0.1]),fixture([0.1,0.1])],compareItemIds:['i0','i1'],
          metricIsBoolean:{empty:false},metricThresholds:{empty:0.2},metricDirections:{empty:'minimize'}};
        let stats = calculateComparisonStatsForMetric('empty');
        // Lower wins: run 2 wins item 0; item 1 ties.
        assert.deepEqual(stats.wins,[0,1]);
        assert.equal(stats.ties,1);
        assert.equal(stats.itemWinners[0],1);
        assert.equal(stats.maxAtK,0.2);
        assert.equal(stats.passAtK,2);
        state.metricDirections.empty = null;
        stats = calculateComparisonStatsForMetric('empty');
        assert.deepEqual(stats.wins,[0,0]);
        assert.equal(stats.ties,0);
        assert.deepEqual(stats.itemWinners,[null,null]);
        assert.equal(stats.passAtK,0);
        assert.equal(stats.maxAtK,0);
    """)


def _compare_functions(*names):
    import re

    source = (REPO / "packages/platform/qym_platform/_static/dashboard/compare.html").read_text()
    chunks = []
    for name in names:
        match = re.search(
            rf"^      (?:function {name}\([^\n]*\n.*?^      }}|const {name} = [^\n]*;)$",
            source,
            re.M | re.S,
        )
        assert match, f"Missing production function: {name}"
        chunks.append(match.group())
    return "\n".join(chunks)


def test_sweep_verdict_follows_direction_and_names_the_metric():
    """The review's case: empty outputs fell 3.0% -> 0.4%, shown as REGRESSED."""
    functions = _compare_functions(
        "sweepPassAtK", "sweepPassHatK", "sweepBinomPmf", "sweepLutMoments",
        "sweepPassMetricLuts", "normalCdf", "SWEEP_Z_95", "computeSweepNoise",
        "escapeHtml", "renderSweepVerdict",
    )
    run_metrics_js(
        "const document = {createElement: () => ({set textContent(v) { this.v = String(v); }, get innerHTML() { return this.v; }})};\n"
        + functions
        + r"""
    // 500 items, 2 passes per side; empty on 15 left items, 2 right items.
    const items = Array.from({length: 500}, (_, i) => {
      const left = i < 15 ? [1, 1] : [0, 0];
      const right = i < 2 ? [1, 1] : [0, 0];
      return {leftScores: left, rightScores: right,
        leftPasses: left.map(v => v <= 0.0001), rightPasses: right.map(v => v <= 0.0001)};
    });
    const lower = computeSweepNoise(items, null, 'minimize');
    assert.equal(lower.avgAtK.verdict, 'improved');
    assert.equal(lower.passAtK.verdict, 'improved');
    const higher = computeSweepNoise(items, null, 'maximize');
    assert.equal(higher.avgAtK.verdict, 'regressed');
    var state = {selectedOverviewMetric: 'output_empty', defaultMetric: 'spider2', defaultMetricDeclared: true,
      metricDirections: {output_empty: 'minimize'}};
    globalThis.metricDirectionFor = name => state.metricDirections[name] || null;
    const html = renderSweepVerdict(lower, 'Avg@2', 'avgAtK');
    assert.match(html, /IMPROVED/);
    assert.match(html, /output_empty · lower is better/);
    assert.match(html, /selected metric/);
    state.selectedOverviewMetric = 'spider2';
    state.metricDirections.spider2 = 'maximize';
    assert.match(renderSweepVerdict(higher, 'Avg@2', 'avgAtK'), /declared primary metric/);
    state.defaultMetricDeclared = false;
    assert.match(renderSweepVerdict(higher, 'Avg@2', 'avgAtK'), /first metric \(no primary declared\)/);
    """
    )


def test_sweep_delta_colors_follow_direction_without_a_noise_band():
    """Single-pass cohorts have no Avg@k noise band, so the delta's sign alone
    colored it: a lower-is-better metric that dropped 60.9% -> 59.1% showed a
    red -1.8% card and red per-domain drops (review finding)."""
    functions = _compare_functions(
        "escapeHtml", "getDeltaClass", "getNoiseDeltaClass", "renderSweepDelta",
        "formatSweepMetricValue", "renderSweepStatCard",
        "formatSweepCompactMetricValue", "formatSweepCompactDelta",
        "renderSweepMetadataMetricCell",
    )
    run_metrics_js(
        "const document = {createElement: () => ({set textContent(v) { this.v = String(v); }, get innerHTML() { return this.v; }})};\n"
        + functions
        + r"""
    const cardClass = html => html.match(/sweep-stat-card qym-stat-strip__item (\w+)/)[1];
    const pillClass = html => html.match(/sweep-delta-pill (\w+)/)[1];
    // Avg@k with no band: a drop is better when lower is better.
    const lower = renderSweepStatCard('Avg@1', 0.609, 0.591, -0.018, null, 'minimize');
    assert.equal(cardClass(lower), 'positive');
    assert.equal(pillClass(lower), 'positive');
    const higher = renderSweepStatCard('Avg@1', 0.609, 0.591, -0.018, null, 'maximize');
    assert.equal(cardClass(higher), 'negative');
    // Pass rates stay higher-is-better (the default).
    assert.equal(cardClass(renderSweepStatCard('Pass@1', 0.2, 0.3, 0.1, null)), 'positive');
    // A band without a verdict also reads the direction.
    assert.equal(getNoiseDeltaClass(-0.05, {halfWidth: 0.01}, 'minimize'), 'positive');
    assert.equal(getNoiseDeltaClass(-0.005, {halfWidth: 0.01}, 'minimize'), 'neutral');
    // Per-domain breakdown cells.
    const cell = (delta, direction) => renderSweepMetadataMetricCell(0.64, 0.64 + delta, delta, direction)
      .match(/sweep-metadata-delta (\w+)/)[1];
    assert.equal(cell(-0.06, 'minimize'), 'positive');
    assert.equal(cell(0.01, 'minimize'), 'negative');
    assert.equal(cell(-0.06), 'negative');
    """
    )

    source = (REPO / "packages/platform/qym_platform/_static/dashboard/compare.html").read_text()
    # The Avg@k card and column pass the selected metric's direction.
    assert "noise.avgAtK, metricDirectionFor(metricName) || 'maximize')" in source
    assert "row.summary.deltas.avgAtK, avgDirection)" in source


# ── server: ingest stores what the SDK declares ─────────────────────────────


def test_ingest_keeps_an_undeclared_direction_and_the_primary_flag():
    normalized = ingest_api._normalized_metric_spec({"score_type": "boolean"})
    assert normalized["direction"] is None
    assert normalized["is_primary"] is False
    declared = ingest_api._normalized_metric_spec(
        {"score_type": "percentage", "direction": "minimize", "primary": True}
    )
    assert declared["direction"] == "minimize"
    assert declared["is_primary"] is True
    with pytest.raises(HTTPException) as exc:
        ingest_api._normalized_metric_spec({"score_type": "boolean", "direction": "down"})
    assert exc.value.status_code == 422


def _spec(**overrides):
    values = dict(
        run_id="r",
        metric_name="empty",
        position=0,
        schema_version=1,
        score_type="boolean",
        direction="maximize",
        pass_threshold=None,
        sample_reducer="mean",
        run_reducer="mean",
        unit=None,
        precision=None,
        is_primary=None,
    )
    values.update(overrides)
    return RunMetricSpec(**values)


def test_resumed_run_from_a_newer_sdk_is_not_a_spec_change():
    # Stored before this change: the old defaults ("maximize", no primary).
    stored = _spec()
    resent = ingest_api._normalized_metric_spec({"score_type": "boolean", "primary": True})
    assert ingest_api._metric_spec_unchanged(stored, resent)
    assert not ingest_api._metric_spec_unchanged(
        stored, ingest_api._normalized_metric_spec({"score_type": "percentage"})
    )
    assert not ingest_api._metric_spec_unchanged(
        _spec(direction=None, is_primary=False),
        ingest_api._normalized_metric_spec({"score_type": "boolean", "direction": "minimize"}),
    )


def test_run_payload_exposes_direction_and_primary(database):
    with Session(database) as db:
        run(db, metrics=["empty", "accuracy"], status=RunWorkflowStatus.COMPLETED)
        db.add(_spec(direction=None, is_primary=None))
        db.add(
            _spec(
                metric_name="accuracy",
                position=1,
                direction="maximize",
                is_primary=True,
            )
        )
        db.commit()
        specs = runs_api._metric_specs_for_runs(db, ["r"])["r"]
    assert list(specs) == ["empty", "accuracy"]
    assert specs["empty"]["direction"] is None
    assert specs["empty"]["primary"] is False
    assert specs["accuracy"]["primary"] is True


# ── server: repeat group metrics follow the direction ──────────────────────


def _seed_repeat(db, *, direction, primary=None):
    run(
        db,
        metrics=["accuracy", "empty"],
        samples=2,
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 2, "last_completed_pass": 2},
    )
    for item_id in ("a", "b"):
        item(db, item_id=item_id)
    db.add(_spec(metric_name="accuracy", position=0, direction="maximize"))
    db.add(
        _spec(metric_name="empty", position=1, direction=direction, is_primary=primary)
    )
    # empty: item a is never empty (0, 0); item b is empty once (1, 0).
    for item_id, scores in (("a", (0.0, 0.0)), ("b", (1.0, 0.0))):
        for pass_number, score in enumerate(scores, start=1):
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name="empty",
                    pass_number=pass_number,
                    score_numeric=score,
                )
            )
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name="accuracy",
                    pass_number=pass_number,
                    score_numeric=1.0,
                )
            )
    db.commit()


def test_group_metrics_pass_lower_is_better_scores_and_default_to_primary(database):
    with Session(database) as db:
        _seed_repeat(db, direction="minimize", primary=True)
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        payload = runs_api.run_group_metrics("r", metric=None, threshold=None, db=db, principal=principal)
    # The declared primary metric, its direction and the minimize default threshold.
    assert payload["metric"] == "empty"
    assert payload["direction"] == "minimize"
    assert payload["threshold"] == pytest.approx(0.2)
    group = payload["group"]
    # Passing = not empty: item a passes both passes, item b one of two.
    assert group["pass_at_k"] == pytest.approx(1.0)
    assert group["pass_hat_k"] == pytest.approx(0.5)
    assert group["max_at_k"] == pytest.approx(0.0)
    assert payload["distribution"] == [0, 1, 1]


def test_group_metrics_without_primary_use_the_first_metric(database):
    with Session(database) as db:
        _seed_repeat(db, direction=None)
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        payload = runs_api.run_group_metrics("r", metric=None, threshold=None, db=db, principal=principal)
        empty = runs_api.run_group_metrics("r", metric="empty", threshold=None, db=db, principal=principal)
    assert payload["metric"] == "accuracy"
    assert payload["direction"] == "maximize"
    assert empty["direction"] is None
    assert empty["threshold"] == pytest.approx(0.8)


def test_pass_summaries_score_the_declared_primary_metric(database):
    """The runs list drawer paints pass_summaries first; its value must be
    the declared primary metric's, and say which metric it is."""
    with Session(database) as db:
        _seed_repeat(db, direction="minimize", primary=True)
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        passes = runs_api.run_passes("r", db, principal)["passes"]
    expected = {p["pass_number"]: p["metric_means"]["empty"] for p in passes}
    assert expected == {1: pytest.approx(0.5), 2: pytest.approx(0.0)}
    drain(database)
    for name, summary in (("projected", projected(database)), ("legacy", legacy(database))):
        summaries = summary["pass_summaries"]
        assert [s["primary_metric"] for s in summaries] == ["empty", "empty"], name
        assert {s["pass_number"]: s["primary_score"] for s in summaries} == expected, name


def test_server_primary_metric_rule_matches_the_client():
    from qym_platform.services.metric_semantics import primary_metric

    assert primary_metric(["a", "b"], {}) == "a"
    assert primary_metric(["a", "b"], {"b": {"primary": True}}) == "b"
    assert primary_metric(["a", "b"], {"b": {"primary": False}}) == "a"
    assert primary_metric([], {}) is None
    run_metrics_js(r"""
    assert.equal(m.defaultMetricName(['a', 'b'], {}), 'a');
    assert.equal(m.defaultMetricName(['a', 'b'], {b: {primary: true}}), 'b');
    assert.equal(m.defaultMetricName(['a', 'b'], {b: {primary: false}}), 'a');
    """)


def test_repeat_drawer_labels_optimistic_scores_and_seeds_the_threshold():
    """The optimistic drawer used the first metric's value under the primary
    column and an 80% threshold until the fetch landed (C008)."""
    source = (REPO / "packages/platform/qym_platform/_static/dashboard/dashboard.js").read_text()
    block = source[source.index("function buildSamplesDetailMarkup"):]
    block = block[: block.index("const optimistic = !!data._optimistic;")]
    assert "s.primary_metric" in block
    assert "[scoredMetric]: s.primary_score" in block
    assert "defaultPassThreshold(" in block
    assert "group: { metric: primary, threshold: primaryThreshold }" in block
