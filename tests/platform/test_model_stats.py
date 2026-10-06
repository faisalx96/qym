"""Models and Charts groups get K-run statistics from the server (C035).

``POST /api/dashboard/models/stats`` replaces downloading every selected run's
item rows (``GET /api/models/runs``) and reducing them in the browser. Its
numbers must equal what ``metrics.js`` (``calculateItemLevelMetrics``) and
``dashboard.js`` (``expandSampledRunsData``) computed from those rows.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from qym_platform.api import dashboard_stats
from qym_platform.api import runs as runs_api
from qym_platform.db.models import Run, RunItemScore, RunWorkflowStatus
from qym_platform.services import model_stats
from qym_platform.services.dashboard_cache import DashboardSnapshotCache
from qym_platform.services.model_stats import group_stats, k_run_stats
from test_dashboard_durable_summaries import drain, item, run
from test_lost_outcome_events import emitter, rid  # noqa: F401
from test_minimize_errors import _node, _principal, _spec
from test_repeat_task_errors_per_pass import _run as _repeat_run

DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard/dashboard.js"
)

# The browser's former reduction (dashboard.js calculateModelStatsFromItems):
# expand repeat runs that carry every pass, then metrics.js.
JS_STATS = """
const source = input.expand;
const expand = (new Function('window', source + '\\nreturn expandSampledRunsData;'))({ QymMetrics: m });
const out = input.cases.map(c => {
  const met = m.calculateItemLevelMetrics({
    runsData: expand(c.runs),
    metricName: c.metric,
    threshold: c.is_boolean ? 0.9999 : c.threshold,
    direction: c.direction,
    isBoolean: !!c.is_boolean,
    getMetricIndex: rd => (rd?.snapshot?.metric_names || rd?.run?.metric_names || []).indexOf(c.metric),
    getItemId: row => row.item_id || String(row.index),
    trackDistribution: true,
  });
  const noScore = met.totalScoreCount === 0 && m.errorsLeftOut(c.direction);
  return {
    passAtK: met.passAtK, passHatK: met.passHatK, maxAtK: noScore ? null : met.maxAtK,
    consistency: met.consistency, reliability: met.reliability,
    avgScore: noScore ? null : met.avgScore, avgLatency: met.avgLatency,
    medianLatency: met.medianLatency, totalItems: met.totalItems,
    failedCount: met.failedCount, minScore: noScore ? null : met.minScore,
    stddevScore: met.stddevScore, K: met.K, correctDistribution: met.correctDistribution,
    totalScoreCount: met.totalScoreCount,
  };
});
process.stdout.write(JSON.stringify(out));
"""

FIELDS = (
    "passAtK",
    "passHatK",
    "maxAtK",
    "consistency",
    "reliability",
    "avgScore",
    "avgLatency",
    "medianLatency",
    "totalItems",
    "failedCount",
    "minScore",
    "stddevScore",
    "K",
    "correctDistribution",
    "totalScoreCount",
)


def _expand_source():
    source = DASHBOARD_JS.read_text()
    start = source.index("  function expandSampledRunsData(runsData) {")
    end = source.index("\n  }\n", start) + 4
    return source[start:end]


def _js(cases):
    return _node(JS_STATS, {"expand": _expand_source(), "cases": cases})


def _same(python, javascript):
    for field in FIELDS:
        expected = javascript[field]
        actual = python[field]
        if isinstance(expected, list) or expected is None:
            assert actual == expected, field
        else:
            assert actual == pytest.approx(expected, abs=1e-9), field


def _random_row(rng, index, metrics, samples, scope):
    row = {
        "item_id": "item-%d" % (index % 9) if rng.random() < 0.9 else "",
        "index": index,
        "status": rng.choice(["completed"] * 6 + ["error", "not_received"]),
        "latency_ms": rng.choice([0, 0, 12.5, 40, 300, None]),
        "metric_values": [
            rng.choice([0, 1, 0.25, 0.8, "", "0.6", "70%", "true", "n/a", None, True])
            for _ in metrics
        ],
    }
    if rng.random() < 0.3:
        row["metric_meta"] = {
            metrics[0]: rng.choice([{"status": "error"}, {"error": "Empty output"}])
        }
    if samples > 1 and (scope == "full" or rng.random() < 0.4):
        row["pass_scores"] = {
            name: [rng.choice([0, 1, 0.5, None]) for _ in range(samples)]
            for name in metrics
            if rng.random() < 0.8
        }
        if rng.random() < 0.6:
            row["pass_metric_meta"] = {
                name: [
                    rng.choice(
                        [
                            None,
                            None,
                            {"status": "timeout"},
                            {"label": "error"},
                            {"label": "error", "modified": "true"},
                            {"label": "error", "task_error": True},
                        ]
                    )
                    for _ in range(samples)
                ]
                for name in row["pass_scores"]
            }
        if rng.random() < 0.3:
            row["pass_attempts"] = [
                rng.choice([None, {"status": "error"}, {"status": "completed"}])
                for _ in range(samples)
            ]
    return row


def _random_runs(rng):
    metrics = ["accuracy", "cost"]
    runs = []
    for number in range(rng.randint(0, 4)):
        samples = rng.choice([1, 1, 3])
        scope = rng.choice(["errored", "full"])
        snapshot = {
            "metric_names": metrics if rng.random() < 0.9 else ["cost"],
            "rows": [
                _random_row(rng, index, metrics, samples, scope)
                for index in range(rng.randint(0, 12))
            ],
        }
        if scope == "errored" and samples > 1:
            snapshot["pass_scores_scope"] = "errored"
        runs.append(
            {
                "run": {
                    "run_id": "r%d" % number,
                    "run_name": "Run %d" % number,
                    "samples": samples,
                },
                "snapshot": snapshot,
            }
        )
    return runs


def test_server_statistics_equal_the_browser_reduction_on_random_rows():
    rng = random.Random(20261001)
    cases = []
    for _ in range(120):
        cases.append(
            {
                "runs": _random_runs(rng),
                "metric": "accuracy",
                "threshold": rng.choice([0.5, 0.8, 0.2]),
                "is_boolean": rng.random() < 0.2,
                "direction": rng.choice(["maximize", "minimize", None]),
            }
        )
    expected = _js(cases)
    for case, javascript in zip(cases, expected):
        if not case["runs"]:
            continue  # the view never asks for an empty group
        python = k_run_stats(
            case["runs"],
            case["metric"],
            case["threshold"],
            case["is_boolean"],
            case["direction"],
        )
        _same(python, javascript)
        assert python["runNames"] == [r["run"]["run_name"] for r in case["runs"]]


def test_empty_pass_scores_do_not_pool_a_repeat_run_into_k_entries():
    """A repeat item a reviewer scored as a whole ships ``pass_scores: {}``:
    no pass data, so the run stays one of the K runs (it was k copies)."""
    run = {
        "run": {"run_id": "r", "run_name": "r", "samples": 3},
        "snapshot": {
            "metric_names": ["accuracy"],
            "rows": [
                {
                    "item_id": "a",
                    "index": 0,
                    "status": "completed",
                    "metric_values": [1],
                },
                {
                    "item_id": "b",
                    "index": 1,
                    "status": "error",
                    "metric_values": [0.9],
                    "pass_scores": {},
                },
            ],
        },
    }
    stats = k_run_stats([run], "accuracy", 0.8, False, "maximize")
    assert stats["K"] == 1
    assert stats["passAtK"] == 1.0
    assert (
        _js(
            [
                {
                    "runs": [run],
                    "metric": "accuracy",
                    "threshold": 0.8,
                    "is_boolean": False,
                    "direction": "maximize",
                }
            ]
        )[0]["K"]
        == 1
    )


def _seed_classic(db):
    for run_id, shift in (("c1", 0.0), ("c2", 0.3)):
        run(
            db,
            run_id=run_id,
            metrics=["score", "cost"],
            status=RunWorkflowStatus.COMPLETED,
        )
        db.add(_spec(run_id, "score", 0, "maximize"))
        db.add(_spec(run_id, "cost", 1, "minimize"))
        for index, (item_id, score, cost, meta) in enumerate(
            [
                ("ok1", 1.0, 0.1, {}),
                ("ok2", 0.5 + shift, 0.3, {}),
                ("scorer", None, 0.2, {"status": "error", "error": "429"}),
                ("reason", 0.4, None, {"error": "Empty output"}),
                ("task", None, None, {}),
            ]
        ):
            item(
                db,
                item_id=item_id,
                run_id=run_id,
                index=index,
                latency_ms=10.0 * (index + 1),
                **({"output": None, "error": "boom"} if item_id == "task" else {}),
            )
            for metric, value in (("score", score), ("cost", cost)):
                if item_id == "task":
                    continue
                db.add(
                    RunItemScore(
                        run_id=run_id,
                        item_id=item_id,
                        metric_name=metric,
                        score_numeric=value,
                        meta=meta if metric == "score" else {},
                    )
                )
    db.commit()


def test_endpoint_matches_the_browser_on_stored_runs_and_reads_one_metric(
    database, emitter
):
    repeat_last = _repeat_run(emitter, "fails-last", 3)
    repeat_first = _repeat_run(emitter, "fails-first", 1)
    with Session(database) as db:
        _seed_classic(db)
    drain(database)
    groups = [
        {"key": "classic", "runs": ["c1", "c2"]},
        {"key": "repeat", "runs": [repeat_last, repeat_first]},
        {"key": "mixed", "runs": ["c2", repeat_last]},
    ]
    with Session(database) as db:
        runs = {r.id: r for r in db.query(Run).all()}
        payload = runs_api._build_models_runs_data(
            db, [runs[r] for r in ("c1", "c2", repeat_last, repeat_first)]
        )
    by_id = {entry["run"]["run_id"]: entry for entry in payload}
    for metric, direction in (
        ("score", "maximize"),
        ("cost", "minimize"),
        ("h", "minimize"),
        ("q", "maximize"),
        ("u", None),
    ):
        with Session(database) as db:
            response = dashboard_stats.dashboard_model_stats(
                {
                    "metric": metric,
                    "threshold": 0.5,
                    "direction": direction,
                    "groups": groups,
                },
                db=db,
                principal=_principal(db),
            )
        assert response["missing"] == []
        expected = _js(
            [
                {
                    "runs": [by_id[r] for r in group["runs"]],
                    "metric": metric,
                    "threshold": 0.5,
                    "is_boolean": False,
                    "direction": direction,
                }
                for group in groups
            ]
        )
        for group, javascript in zip(groups, expected):
            _same(response["groups"][group["key"]], javascript)
        # A statistics response is a few hundred bytes per group.
        assert len(json.dumps(response)) < 600 * len(groups)


def test_endpoint_reads_item_rows_a_chunk_of_runs_at_a_time(
    database, emitter, monkeypatch
):
    """A large selection never holds every run's item rows at once: the rows
    are built a chunk of runs at a time and reduced to compact outcomes, with
    the same statistics as one pass over all of them."""
    repeat_last = _repeat_run(emitter, "fails-last", 3)
    with Session(database) as db:
        _seed_classic(db)
    drain(database)
    groups = [
        {"key": "classic", "runs": ["c1", "c2"]},
        {"key": "mixed", "runs": ["c2", repeat_last, "c1"]},
    ]
    request = {
        "metric": "cost",
        "threshold": 0.5,
        "direction": "minimize",
        "groups": groups,
    }
    with Session(database) as db:
        whole = dashboard_stats.dashboard_model_stats(
            request, db=db, principal=_principal(db)
        )
    built = []
    original = runs_api._build_models_runs_data

    def spy(db, runs, metric=None):
        built.append([run.id for run in runs])
        return original(db, runs, metric=metric)

    monkeypatch.setattr(runs_api, "_build_models_runs_data", spy)
    monkeypatch.setattr(model_stats, "RUNS_PER_CHUNK", 2)
    monkeypatch.setattr(dashboard_stats, "_stats_cache", DashboardSnapshotCache())
    with Session(database) as db:
        chunked = dashboard_stats.dashboard_model_stats(
            request, db=db, principal=_principal(db)
        )
    assert built and max(len(chunk) for chunk in built) <= 2
    assert sorted(run for chunk in built for run in chunk) == sorted(
        ["c1", "c2", repeat_last]
    )
    assert chunked == whole


def test_endpoint_reports_unreadable_runs_and_validates_its_request(database):
    with Session(database) as db:
        run(db, run_id="kept", status=RunWorkflowStatus.COMPLETED)
        item(db, item_id="i", run_id="kept")
        run(db, run_id="gone", status=RunWorkflowStatus.COMPLETED)
        db.get(Run, "gone").deleted_at = db.get(Run, "gone").created_at
        db.commit()
        response = dashboard_stats.dashboard_model_stats(
            {
                "metric": "score",
                "groups": [{"key": "g", "runs": ["kept", "gone", "unknown"]}],
            },
            db=db,
            principal=_principal(db),
        )
        assert response["missing"] == ["gone", "unknown"]
        assert response["groups"]["g"]["K"] == 1
        for bad in (
            {"metric": "score", "groups": []},
            {"metric": "", "groups": [{"key": "g", "runs": []}]},
            {"metric": "score", "threshold": "x", "groups": [{"key": "g", "runs": []}]},
            {
                "metric": "score",
                "direction": "up",
                "groups": [{"key": "g", "runs": []}],
            },
            {
                "metric": "score",
                "groups": [{"key": "g", "runs": []}, {"key": "g", "runs": []}],
            },
            {
                "metric": "score",
                "groups": [{"key": "g", "runs": ["x"] * 1}],
                "extra": 1,
            },
            {
                "metric": "score",
                "groups": [{"key": str(i), "runs": []} for i in range(101)],
            },
        ):
            with pytest.raises(HTTPException) as raised:
                dashboard_stats.dashboard_model_stats(
                    bad, db=db, principal=_principal(db)
                )
            assert raised.value.status_code == 400


def test_group_stats_keeps_each_groups_run_order():
    def entry(run_id, value):
        return {
            "run": {"run_id": run_id, "run_name": run_id, "samples": 1},
            "snapshot": {
                "metric_names": ["m"],
                "rows": [
                    {
                        "item_id": "a",
                        "index": 0,
                        "status": "completed",
                        "metric_values": [value],
                    }
                ],
            },
        }

    stats = group_stats(
        [entry("a", 1), entry("b", 0)],
        [{"key": "x", "runs": ["b", "a"]}],
        "m",
        0.5,
        False,
        "maximize",
    )
    assert stats["x"]["runNames"] == ["b", "a"]
    assert stats["x"]["correctDistribution"] == [0, 1, 0]


def test_nonfinite_score_text_is_no_score():
    """JSON has no Infinity: such text must not crash a statistics response."""
    for raw in ("Infinity", "-Infinity", "1e999", "1e999%"):
        assert model_stats.parse_score_value(raw) is None
    assert model_stats.parse_score_value("85%") == pytest.approx(0.85)
    assert model_stats.parse_score_value("0.5 points") == pytest.approx(0.5)


def _stats_fetch_source():
    source = DASHBOARD_JS.read_text()
    start = source.index("  let modelStatsCache = null;")
    end = source.index("  function calculateModelTraceStats(runs) {", start)
    return source[start:end]


def test_large_stat_requests_split_within_the_server_limits():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required to check dashboard.js")
    script = """
const fs = require('fs');
const calls = [];
const state = {};
const getProjectSlugFromPath = () => 'p';
async function dashboardQuery(path, payload) {
  calls.push(payload.groups.map(group => group.runs.length));
  const groups = {};
  payload.groups.forEach(group => { groups[group.key] = { n: group.runs.length }; });
  return { groups, missing: [] };
}
eval(fs.readFileSync(0, 'utf8') + `
(async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ key: 'g' + i, runs: ['r' + i] }));
  const wide = [0, 1, 2].map(i => ({ key: 'w' + i, runs: Array.from({ length: 900 }, (_, j) => i + '-' + j) }));
  const a = await fetchModelStats(many, 'm', 0.5, false, null, 1);
  const b = await fetchModelStats(wide, 'm', 0.5, false, null, 2);
  const modelCalls = calls.splice(0);
  const big = Array.from({ length: 2001 }, (_, j) => 'b' + j);
  const results = await Promise.allSettled([
    fetchChartGroupStats('big', big, 'm', 0.5, false, null),
    fetchChartGroupStats('ok', ['x'], 'm', 0.5, false, null),
  ]);
  console.log(JSON.stringify({
    groups: [Object.keys(a.groups).length, Object.keys(b.groups).length],
    modelCalls,
    chartCalls: calls,
    chart: results.map(r => r.status),
  }));
})();
`);
"""
    result = subprocess.run(
        [node, "-e", script],
        input=_stats_fetch_source(),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert out["groups"] == [101, 3]
    assert out["modelCalls"] == [[1] * 100, [1], [900, 900], [900]]
    # The oversized group fails alone; the other group of its tick still loads.
    assert out["chart"] == ["rejected", "fulfilled"]
    assert out["chartCalls"] == [[1]]
