"""Repeat runs judge task errors per pass, whichever pass failed last.

A repeat run keeps one RunItem per item, overwritten by the pass that arrived
last, so its error said only whether the *last* pass failed. Run means used
it as an item-level task error: the same per-pass data gave different means
depending on which pass failed (and a lower-is-better metric dropped the
item's clean passes too). Now each item is the mean over its passes, a
failed pass counting as 0, or left out (with the error counted) when lower
is better, on every surface: the runs list, the published summary, the run
detail, the run page (metrics.js), Compare, Models and per-pass views.
"""

from __future__ import annotations

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from qym_platform.api import runs as runs_api
from qym_platform.db.dashboard_models import DashboardRunSummary as Summary
from qym_platform.db.models import Run, RunItem
from qym_platform.services import dashboard_summaries as summaries_service
from test_dashboard_durable_summaries import (
    drain,
    legacy,
    projected,
)
from test_lost_outcome_events import _js_means, _views, emitter, rid  # noqa: F401
from test_minimize_errors import PASS_VERDICTS, _approx, _node, _principal

# h is lower-is-better (the primary metric), q higher-is-better, u declares no
# direction. Item x fails one of its three passes; the other two score
# h 0.4, q 1.0, u 0.8. Item a is clean: h 0.2, q 1.0, u 0.5.
EXPECTED = {
    "h": (0.2 + 0.4) / 2,  # x: its failed pass left out
    "q": (1.0 + 2 / 3) / 2,  # x: (1 + 1 + 0) / 3
    "u": (0.5 + 1.6 / 3) / 2,  # x: (0.8 + 0.8 + 0) / 3
}

ERROR_COUNTS = """
const out = {};
for (const name of input.metrics) {
  let task = 0, scorer = 0;
  for (const row of input.rows) {
    const counts = m.rowMetricErrorCounts(row, name);
    task += counts.task; scorer += counts.scorer;
  }
  out[name] = [task, scorer];
}
out.errorRows = input.rows.filter(row => m.isErrorRow(row)).map(row => row.item_id);
process.stdout.write(JSON.stringify(out));
"""


def _run(emitter, name, failed_pass):
    run = emitter(name, 3, ["h", "q", "u"])
    events = run.started(2)
    for pass_number in (1, 2, 3):
        events += run.passed("a", 0, pass_number, {"h": 0.2, "q": 1.0, "u": 0.5})
        if pass_number == failed_pass:
            events += run.failed(
                "x", 1, pass_number, error="tool crashed", attempt_error="tool crashed"
            )
        else:
            events += run.passed("x", 1, pass_number, {"h": 0.4, "q": 1.0, "u": 0.8})
    assert run.post(events)["rejected"] == 0
    run.post(run.completed(2, 0))
    return rid(name)


def test_the_same_passes_give_the_same_means_whichever_pass_failed(database, emitter):
    last = _run(emitter, "fails-last", 3)
    first = _run(emitter, "fails-first", 1)
    with Session(database) as db:
        errors = {
            run_id: db.query(RunItem).filter_by(run_id=run_id, item_id="x").one().error
            for run_id in (last, first)
        }
    # The RunItem holds only the pass that arrived last.
    assert errors == {last: "tool crashed", first: None}

    for run_id in (last, first):
        views, snapshot = _views(database, run_id)
        for name, payload in views.items():
            assert payload["metric_averages"] == _approx(EXPECTED), (run_id, name)
            # No scorer errors: no mean without them to show.
            assert payload["metric_scored_averages"] == {}, (run_id, name)
            assert payload["task_error_count"] == 1, (run_id, name)
            assert (
                payload["execution_count"],
                payload["execution_success_count"],
            ) == (6, 5), (run_id, name)
        assert _js_means(snapshot, ["h", "q", "u"]) == _approx(EXPECTED), run_id
        counts = _node(
            ERROR_COUNTS, {"rows": snapshot["rows"], "metrics": ["h", "q", "u"]}
        )
        # One failed pass, counted once per metric; the item has an error
        # whichever pass it was.
        assert counts == {
            "h": [1, 0],
            "q": [1, 0],
            "u": [1, 0],
            "errorRows": ["x"],
        }, run_id
        with Session(database) as db:
            models = runs_api.models_runs_data(
                files=[run_id], db=db, principal=_principal(db)
            )["runs"][0]
        verdicts = _node(PASS_VERDICTS, {"run": models})
        assert verdicts["h"]["avgScore"] == pytest.approx(EXPECTED["h"]), run_id
        assert verdicts["q"]["avgScore"] == pytest.approx(EXPECTED["q"]), run_id
        # x errored on h (lower is better): it never passes, on either run.
        assert verdicts["h"]["failed"] == 1, run_id


def test_root_cause_and_insight_verdicts_judge_repeat_items_per_pass(
    database, emitter
):
    from types import SimpleNamespace

    from qym_platform.services import insights_engine
    from qym_platform.services.root_cause_dashboard import (
        DashboardFilters,
        _load_snapshot,
    )

    last = _run(emitter, "fails-last", 3)
    first = _run(emitter, "fails-first", 1)
    with Session(database) as db:
        snapshot = _load_snapshot(db, "p", DashboardFilters(), include_changes=False)
        averages = {key: stat["average"] for key, stat in snapshot.score_stats.items()}
        errors = {key: stat["error_count"] for key, stat in snapshot.score_stats.items()}
        for run_id in (last, first):
            assert {
                metric: averages[(run_id, metric)] for metric in ("h", "q", "u")
            } == _approx(EXPECTED), run_id
            # No item-level task error: the failed pass is inside x's value.
            assert {errors[(run_id, metric)] for metric in ("h", "q", "u")} == {0}
            item = db.query(RunItem).filter_by(run_id=run_id, item_id="x").one()
            score = next(
                row
                for row in db.query(runs_api.RunItemScore).filter_by(
                    run_id=run_id, item_id="x", metric_name="q"
                )
            )
            # x's q is (1 + 1 + 0) / 3: a pass at 0.5, on either run.
            spec = SimpleNamespace(direction="maximize", pass_threshold=0.5)
            assert (
                insights_engine._metric_result(item, score, spec, db.get(Run, run_id))
                == "success"
            ), run_id


def test_pass_means_follow_the_pass_that_failed(database, emitter):
    last = _run(emitter, "fails-last", 3)
    first = _run(emitter, "fails-first", 1)
    failed = {"h": 0.2, "q": 0.5, "u": 0.25}
    clean = {"h": 0.3, "q": 1.0, "u": 0.65}
    for run_id, failed_pass in ((last, 3), (first, 1)):
        with Session(database) as db:
            means = {
                p["pass_number"]: p["metric_means"]
                for p in runs_api.run_passes(run_id, db, _principal(db))["passes"]
            }
        assert means == {
            number: _approx(failed if number == failed_pass else clean)
            for number in (1, 2, 3)
        }, run_id


def test_group_analysis_pass_rows_judge_each_pass_by_its_own_outcome(database, emitter):
    """dashboard.js expands a repeat run into one pseudo-run per pass: a pass
    that succeeded is not a task error because the item's last pass failed."""
    from pathlib import Path

    last = _run(emitter, "fails-last", 3)
    with Session(database) as db:
        data = runs_api.legacy_run_data(last, db=db, principal=_principal(db))
    dashboard_js = (
        Path(__file__).resolve().parents[2]
        / "packages/platform/qym_platform/_static/dashboard/dashboard.js"
    )
    source = dashboard_js.read_text()
    start = source.index("  function expandSampledRunsData(runsData) {")
    end = source.index("\n  }\n", start) + 4
    script = (
        "const expand = (function () {\n"
        + source[start:end]
        + "\nreturn expandSampledRunsData; })();\n"
        "globalThis.window = { QymMetrics: m };\n"
        "const runs = expand([input.data]);\n"
        "process.stdout.write(JSON.stringify(runs.map(rd => {\n"
        "  const row = rd.snapshot.rows.find(r => r.item_id === 'x');\n"
        "  const specs = rd.snapshot.metric_specs || {};\n"
        "  return { status: row.status,\n"
        "    q: m.getRowScore(row, 1, 'q', m.metricDirection(specs.q)),\n"
        "    h: m.getRowScore(row, 0, 'h', m.metricDirection(specs.h)) };\n"
        "})));"
    )
    out = _node(script, {"data": data})
    assert [entry["status"] for entry in out] == ["completed", "completed", "error"]
    assert [entry["q"] for entry in out] == [
        {"score": 1.0, "isError": False},
        {"score": 1.0, "isError": False},
        {"score": 0, "isError": True},
    ]
    assert [entry["h"] for entry in out] == [
        {"score": 0.4, "isError": False},
        {"score": 0.4, "isError": False},
        {"score": None, "isError": True},
    ]


def test_published_repeat_summaries_are_refreshed_without_reading_source_rows(
    database, emitter
):
    """SUMMARY_SHAPE 5: a summary published under the old rule is rebuilt
    from projection records alone."""
    last = _run(emitter, "fails-last", 3)
    drain(database)
    with Session(database) as db:
        summary = db.get(Summary, last)
        data = dict(summary.data)
        # What shape 4 published: x's last-pass error made it an item-level
        # task error (0, or dropped entirely when lower is better).
        data.update(
            summary_shape=4,
            metric_averages={"h": 0.2, "q": 0.5, "u": 0.25},
        )
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
    published = projected(database, last)
    assert published["summary_shape"] == summaries_service.SUMMARY_SHAPE == 5
    assert published["metric_averages"] == _approx(EXPECTED)
    assert not any(
        table in sql
        for sql in statements
        for table in ("run_items", "run_item_scores", "run_item_pass_scores")
    )
    with Session(database) as db:
        assert db.get(Run, last).samples == 3


def test_models_reads_a_reviewed_repeat_item_per_pass_whichever_pass_failed(
    database, emitter
):
    """A reviewer scored item x as a whole after its last pass failed. The
    Models payload ships no errored pass for it (the review decides its
    verdicts), so its row status, the last pass's, must not make it an
    item-level task error there: Models agrees with every other view."""
    last = _run(emitter, "reviewed-fails-last", 3)
    with Session(database) as db:
        for metric in ("h", "q", "u"):
            runs_api.update_metric(
                {
                    "file_path": last,
                    "row_index": 1,
                    "metric_name": metric,
                    "new_score": "0.9",
                },
                db=db,
                principal=_principal(db),
            )
    expected = {"h": (0.2 + 0.9) / 2, "q": (1.0 + 0.9) / 2, "u": (0.5 + 0.9) / 2}
    views, snapshot = _views(database, last)
    for name, payload in views.items():
        assert payload["metric_averages"] == _approx(expected), name
    assert _js_means(snapshot, ["h", "q", "u"]) == _approx(expected)
    run_page = _node(ERROR_COUNTS, {"rows": snapshot["rows"], "metrics": ["h", "q"]})
    with Session(database) as db:
        models = runs_api.models_runs_data(
            files=[last], db=db, principal=_principal(db)
        )["runs"][0]
    verdicts = _node(PASS_VERDICTS, {"run": models})
    assert verdicts["h"]["avgScore"] == pytest.approx(expected["h"])
    assert verdicts["q"]["avgScore"] == pytest.approx(expected["q"])
    # Its failed pass still counts as one error, as on the run page.
    assert [verdicts[m]["failed"] for m in ("h", "q")] == [
        sum(run_page[m]) for m in ("h", "q")
    ]
