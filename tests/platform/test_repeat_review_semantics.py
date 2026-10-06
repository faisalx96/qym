"""Reviewer edits, cancelled passes and error counts agree on every view.

Final review of the P0 series (C008, C015, C009, C011, C024):

- a reviewer's item-level score on a repeat run reaches every mean (it was
  accepted, marked Edited, and then re-derived from the passes);
- so do the run page's Category Performance groups, with the item's pass
  weight;
- a pass whose metric was scored before its task was cancelled is a failed
  task in the source rows too, as in the published projection;
- a pass slice keeps a reviewer's score on a failed task;
- the Models "Errors" tile counts every errored pass, like the runs list;
- a Performance-curve k with no scored pass has no average (not 0, the best
  value of a lower-is-better metric);
- the source and projection reads touch only the run they are about.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from qym_platform.api import insights as insights_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.repeat_analysis import build_repeat_analysis
from qym_platform.services.run_means import (
    errored_pass_items,
    is_task_error_pass,
    raw_metric_totals,
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
from test_minimize_errors import (
    JS_MEANS,
    PASS_VERDICTS,
    _approx,
    _event,
    _ingest,
    _ingest_env,
    _node,
    _principal,
    _repeat,
    _rows,
    _scored,
)
from test_repeat_runs_platform import RUN_ID


class _Statements:
    def __init__(self, engine):
        self.engine, self.sql = engine, []

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._capture)
        return self.sql

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._capture)

    def _capture(self, conn, cursor, statement, *args):
        self.sql.append(statement.lower())


def _edit(db, row_index, metric, value, **extra):
    return runs_api.update_metric(
        {
            "file_path": "rr",
            "row_index": row_index,
            "metric_name": metric,
            "new_score": value,
            **extra,
        },
        db=db,
        principal=_principal(db),
    )


def _means_everywhere(engine, run_id="rr"):
    """legacy list, published summary, run detail and the run page (JS)."""
    expected_list = legacy(engine, run_id)
    drain(engine)
    published = projected(engine, run_id)
    with Session(engine) as db:
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, run_id))
    snapshot = _rows(engine, run_id)
    js = _node(
        JS_MEANS,
        {"rows": snapshot["rows"], "metrics": ["h", "q"], "specs": snapshot["metric_specs"]},
    )
    return {
        "legacy": expected_list,
        "projected": published,
        "detail": detail,
        "js": {"metric_averages": js},
    }


def test_item_level_edit_on_a_repeat_item_reaches_every_mean(database):
    """Item a has a scorer-error pass on h (lower is better) and q: the
    reviewer's item value used to be dropped and re-derived from its passes."""
    with Session(database) as db:
        _repeat(db)
        _edit(db, 0, "h", "0.9")
        _edit(db, 0, "q", "0.1")
        stored = db.query(RunItemScore).filter_by(run_id="rr", item_id="a", metric_name="h").one()
        assert stored.meta["item_edit"] == "true" and stored.meta["modified"] == "true"
        # Judged by the reviewer's value, not its errored pass.
        errored = errored_pass_items(db, ["rr"])
        assert ("rr", "a", "h") not in errored and ("rr", "b", "h") in errored
    # h: a 0.9 (edited), b 0.2, c 0.5, d 0.2 (its failed pass 3 left out).
    # q: a 0.1 (edited), b 0.5, c 0.5, d 2/3 (its failed pass 3 as 0);
    # without scorer errors the same.
    expected = {"h": (0.9 + 0.2 + 0.5 + 0.2) / 4, "q": (0.1 + 0.5 + 0.5 + 2 / 3) / 4}
    for name, payload in _means_everywhere(database).items():
        assert payload["metric_averages"] == _approx(expected), name
        if name != "js":
            assert payload["metric_scored_averages"] == _approx({"q": expected["q"]}), name

    # A pass edit makes the item the mean over its passes again.
    with Session(database) as db:
        _edit(db, 0, "h", "0.6", pass_number=3)
        stored = db.query(RunItemScore).filter_by(run_id="rr", item_id="a", metric_name="h").one()
        assert "item_edit" not in stored.meta
        assert stored.score_numeric == pytest.approx(0.4)
    expected["h"] = (0.4 + 0.2 + 0.5 + 0.2) / 4
    for name, payload in _means_everywhere(database).items():
        assert payload["metric_averages"]["h"] == pytest.approx(expected["h"]), name


RUN_HTML = Path(__file__).resolve().parents[2] / "packages/platform/qym_platform/_static/dashboard/run.html"


def _run_page_functions(*names):
    source = RUN_HTML.read_text()
    chunks = []
    for name in names:
        match = re.search(rf"^      function {name}\([^\n]*\n.*?^      }}$", source, re.M | re.S)
        assert match, f"Missing production function: {name}"
        chunks.append(match.group())
    return "\n".join(chunks)


# The run page's Category Performance groups (run.html getCategoryGroupStats).
JS_CATEGORIES = (
    "const window = ctx.window;\n"
    + _run_page_functions(
        "metricDirectionOf", "metricPassesFor", "rowScoreFor", "errorsLeftOutFor",
        "passValuesFor", "passVectorFor", "getCategoryMetricScores",
        "categoryValueText", "isListCategoryKey", "getMetadataCategoryValues",
        "getCategoryGroupStats",
    )
    + """
const parseMetaList = raw => (Array.isArray(raw) ? raw : [raw]);
const state = {
  viewPass: input.viewPass || null, domainFilter: null, categoryBreakdownSort: 'name',
  metricDirections: { h: 'minimize', q: 'maximize' },
  metricThresholds: { h: 0.3, q: 0.8 }, metricIsBoolean: {},
};
const ids = new Set(input.rows.map(row => row.item_id || String(row.index)));
const out = {};
for (const key of ['topic', 'complexity']) {
  out[key] = {};
  ['h', 'q'].forEach((metric, index) => {
    for (const stat of getCategoryGroupStats(key, input.rows, ids, metric, index, null, true)) {
      out[key][stat.groupVal + ':' + metric] = [stat.avgScore, stat.passRate];
    }
  });
}
process.stdout.write(JSON.stringify(out));
"""
)


def _categories(engine, view_pass=None):
    """Item a alone is "easy", b-d "hard"; every item is topic "all"."""
    rows = _rows(engine, "rr")["rows"]
    for row in rows:
        row["item_metadata"] = {
            "complexity": "easy" if row["item_id"] == "a" else "hard",
            "topic": "all",
        }
    if view_pass:
        # The pass view's rows (run.html scopeRowToPass): the pass's own
        # values and metadata.
        rows = [
            {
                **row,
                "metric_values": [row["pass_scores"][name][view_pass - 1] for name in ("h", "q")],
                "metric_meta": {},
                "pass_metric_meta": None,
            }
            for row in rows
            if row["item_id"] == "a"
        ]
    return _node(JS_CATEGORIES, {"rows": rows, "viewPass": view_pass})


def test_item_level_edit_on_a_repeat_item_reaches_the_category_means(database):
    """Category Performance read an edited repeat item's passes, so a 0.9
    item over passes it scored lower showed their mean, not 0.9."""
    with Session(database) as db:
        _repeat(db)
        _edit(db, 0, "h", "0.9")
        _edit(db, 0, "q", "0.1")
    # Item a's passes: h [0.2, scorer error, 0.4], q [1, 0 (error), 1].
    # Its reviewer value fills each of its 3 pass slots, like every other
    # item's passes: h b [0.1, 0.3] + 1 error, c [0.5] * 3, d [0.2, 0.2]
    # + 1 error; q b [1, 0, 0.5], c [0.5] * 3, d [1, 1, 0].
    assert _categories(database) == {
        "topic": {
            "all:h": pytest.approx([(0.9 * 3 + 0.4 + 1.5 + 0.4) / 10, 4 / 12]),
            "all:q": pytest.approx([(0.1 * 3 + 1.5 + 1.5 + 2) / 12, 3 / 12]),
        },
        "complexity": {
            "easy:h": pytest.approx([0.9, 0]),
            "hard:h": pytest.approx([2.3 / 7, 4 / 9]),
            "easy:q": pytest.approx([0.1, 0]),
            "hard:q": pytest.approx([5 / 9, 3 / 9]),
        },
    }
    # The pass view shows that pass's own value, not the item's.
    assert _categories(database, view_pass=3)["complexity"] == {
        "easy:h": pytest.approx([0.4, 0]),
        "easy:q": pytest.approx([1.0, 1]),
    }

    # A pass edit makes the item its passes again (the server drops
    # item_edit), so h of item a is [0.2, 0.6] + 1 error.
    with Session(database) as db:
        _edit(db, 0, "h", "0.6", pass_number=3)
    out = _categories(database)
    assert out["complexity"]["easy:h"] == pytest.approx([0.4, 1 / 3])
    assert out["topic"]["all:h"] == pytest.approx([(0.8 + 0.4 + 1.5 + 0.4) / 9, 5 / 12])
    assert out["complexity"]["easy:q"] == pytest.approx([0.1, 0])


def test_metric_scored_before_a_cancel_is_a_failed_task_in_every_view():
    """The SDK sends metric_scored as each metric finishes; a cancel mid-scoring
    then sends item_failed for the same pass. The zero-filled pass kept the
    scorer's metadata, so source rows read it as a real 0 (the best value)."""
    app, SessionLocal = _ingest_env(2)
    lines = [
        _event(1, "item_started", {"item_id": "item-1", "index": 0, "pass_number": 1}),
        _scored(2, 1, 0.9, {"reasoning": "judge says 0.9"}),
        _event(
            3,
            "item_failed",
            {"item_id": "item-1", "index": 0, "pass_number": 1, "error": "Cancelled"},
        ),
        _event(4, "item_started", {"item_id": "item-1", "index": 0, "pass_number": 2}),
        _scored(5, 2, 0.3),
        _event(
            6,
            "item_completed",
            {"item_id": "item-1", "index": 0, "pass_number": 2, "output": "ok", "latency_ms": 5},
        ),
    ]
    with TestClient(app) as client:
        _ingest(client, "\n".join(lines) + "\n", "test-token")
    engine = SessionLocal.kw["bind"]
    with SessionLocal() as db:
        cancelled = db.query(RunItemPassScore).filter_by(pass_number=1).one()
        assert cancelled.label == "error"
        assert cancelled.meta == {"reasoning": "judge says 0.9", "task_error": True}
        assert is_task_error_pass(cancelled.label, cancelled.meta)
        # The item is its clean pass only.
        assert db.query(RunItemScore).one().score_numeric == pytest.approx(0.3)
        principal = Principal(user=db.get(User, "user-1"), auth_type="none")
        detail = runs_api._compute_run_summary(db, db.get(runs_api.Run, RUN_ID))
        assert detail["metric_averages"] == _approx({"h": 0.3})
        assert errored_pass_items(db, [RUN_ID]) == {(RUN_ID, "item-1", "h")}
        group = runs_api.run_group_metrics(
            RUN_ID, metric="h", threshold=0.3, db=db, principal=principal
        )
        # The cancelled pass never passes.
        assert group["group"]["pass_hat_k"] == 0.0
        assert group["group"]["pass_at_k"] == 1.0
        data = runs_api.legacy_run_data(RUN_ID, db=db, principal=principal, view="compact")
    [row] = data["snapshot"]["rows"]
    # The page reads the server's classification (task_error), which the
    # index keeps once it drops the reasoning.
    assert row["pass_metric_meta"]["h"][0] == {
        "reasoning": "judge says 0.9",
        "task_error": True,
        "label": "error",
    }
    js = _node(JS_MEANS, {"rows": [row], "metrics": ["h"], "specs": data["snapshot"]["metric_specs"]})
    assert js == _approx({"h": 0.3})
    drain(engine)
    assert projected(engine, RUN_ID)["metric_averages"] == _approx({"h": 0.3})


PASS_SLICE = """
const row = {
  __pass_scope: true, status: 'error', metric_values: [0.2, ''],
  metric_meta: { h: { modified: 'true', original_score: 0 } },
};
process.stdout.write(JSON.stringify({
  h: m.getRowScore(row, 0, 'h', 'minimize'),
  q: m.getRowScore(row, 1, 'q', 'maximize'),
  hErrors: m.rowMetricErrorCounts(row, 'h'),
  qErrors: m.rowMetricErrorCounts(row, 'q'),
  // Not a pass slice: a task error stays one for every metric.
  whole: m.getRowScore({ ...row, __pass_scope: false }, 0, 'h', 'minimize'),
  edited: m.getRowScore({ status: 'completed', metric_values: [0.9],
    metric_meta: { h: { item_edit: 'true', modified: 'true' } },
    pass_scores: { h: [0.2, 0] }, pass_metric_meta: { h: [{}, { status: 'error' }] } },
    0, 'h', 'minimize'),
}));
"""


def test_pass_slices_keep_a_reviewer_score_on_a_failed_task():
    out = _node(PASS_SLICE, {})
    assert out["h"] == {"score": pytest.approx(0.2), "isError": False}
    assert out["q"] == {"score": 0, "isError": True}
    assert out["hErrors"] == {"task": 0, "scorer": 0}
    assert out["qErrors"] == {"task": 1, "scorer": 0}
    assert out["whole"] == {"score": None, "isError": True}
    # A reviewer's item value stands over the errored pass.
    assert out["edited"] == {"score": pytest.approx(0.9), "isError": False}


def test_models_errors_count_every_errored_pass_like_the_runs_list(database):
    with Session(database) as db:
        _repeat(db)
        # b's pass-1 task also failed (a maximize metric with a task error on
        # an earlier pass was not counted at all).
        for metric in ("h", "q"):
            row = (
                db.query(RunItemPassScore)
                .filter_by(run_id="rr", item_id="b", metric_name=metric, pass_number=1)
                .one()
            )
            row.score_numeric, row.label, row.meta = 0.0, "error", {"task_error": True}
        from qym_platform.db.models import RunItemAttempt

        attempt = db.query(RunItemAttempt).filter_by(run_id="rr", item_id="b", pass_number=1).one()
        attempt.status, attempt.error = "failed", "boom"
        db.commit()
        models = runs_api.models_runs_data(files=["rr"], db=db, principal=_principal(db))["runs"][0]
    listed = legacy(database, "rr")
    verdicts = _node(PASS_VERDICTS, {"run": models})
    for metric in ("h", "q"):
        expected = listed["task_error_count"] + listed["metric_error_counts"][metric]
        assert verdicts[metric]["failed"] == expected, metric
    assert listed["task_error_count"] == 3


def test_curve_has_no_average_where_every_first_pass_errored(database):
    band = build_repeat_analysis(
        {"x": [None, 0.8], "y": [None, 0.6]}, threshold=0.3, samples=2, direction="minimize"
    )["band"]
    assert band[1]["cumulative_avg"] is None
    assert band[2]["cumulative_avg"] == pytest.approx(0.7)
    assert band[1]["pass_at_k"] == 0.0
    with Session(database) as db:
        run(db, run_id="all-err", metrics=["h"], samples=2, status=RunWorkflowStatus.COMPLETED)
        db.add(
            RunMetricSpec(
                run_id="all-err", metric_name="h", position=0, schema_version=2,
                score_type="number", direction="minimize",
            )
        )
        item(db, item_id="a", run_id="all-err")
        for number in (1, 2):
            db.add(
                RunItemPassScore(
                    run_id="all-err", item_id="a", metric_name="h", pass_number=number,
                    score_numeric=0.0, meta={"status": "error"},
                )
            )
        db.commit()
        group = runs_api.run_group_metrics(
            "all-err", metric=None, threshold=None, db=db, principal=_principal(db)
        )
    assert {str(k): point["cumulative_avg"] for k, point in group["band"].items()} == {
        "1": None,
        "2": None,
    }


def test_item_without_a_stored_completion_is_marked_in_the_run_payload(database):
    with Session(database) as db:
        run(db, run_id="r", metrics=["score"], status=RunWorkflowStatus.COMPLETED)
        item(db, item_id="rejected", run_id="r", index=0, output=None, latency_ms=None)
        item(db, item_id="answered", run_id="r", index=1, output="", latency_ms=3.0)
        item(db, item_id="failed", run_id="r", index=2, output=None, latency_ms=None, error="boom")
        db.commit()
    rows = {row["item_id"]: row for row in _rows(database, "r")["rows"]}
    assert rows["rejected"]["output_received"] is False
    # An empty answer that arrived, and a task error, are not missing output.
    assert "output_received" not in rows["answered"]
    assert "output_received" not in rows["failed"]


def test_group_metrics_read_pass_metadata_only_for_lower_is_better_metrics(database):
    with Session(database) as db:
        _repeat(db)
    # A failed pass's 0 passes a threshold of 0 or below: only there does a
    # higher-is-better metric need the error verdicts.
    for metric, threshold, reads_meta in (
        ("q", None, False),
        ("h", None, True),
        ("q", 0.0, True),
    ):
        with Session(database) as db, _Statements(database) as sql:
            runs_api.run_group_metrics(
                "rr", metric=metric, threshold=threshold, db=db, principal=_principal(db)
            )
        pass_reads = [s for s in sql if "from run_item_pass_scores" in s]
        assert pass_reads, metric
        assert any("run_item_pass_scores.meta" in s for s in pass_reads) is reads_meta, (
            metric,
            threshold,
        )


def test_source_and_projection_reads_stay_within_the_run(database):
    with Session(database) as db:
        _repeat(db)
        _repeat(db, run_id="rr2")
        _repeat(db, run_id="rr3")
    # Projection: the item self-join is scoped by run (it scanned every
    # project's item records).
    with _Statements(database) as sql:
        drain(database)
    joins = [s for s in sql if "dashboard_record_state as dashboard_record_state_1" in s]
    assert joins
    assert all("dashboard_record_state_1.run_key =" in s for s in joins)
    # Source: one candidate query for all repeat runs, not one per run. It
    # reads pass rows alone: a repeat item's RunItem error (its last pass)
    # does not decide which items are read.
    with Session(database) as db, _Statements(database) as sql:
        raw_metric_totals(db, ["rr", "rr2", "rr3"])
    candidates = [
        s
        for s in sql
        if "from run_item_pass_scores" in s and "run_item_pass_scores.run_id in (" in s
    ]
    assert len(candidates) == 1
    assert "run_items" not in candidates[0]


def test_insights_and_models_skip_reads_they_do_not_use(database):
    with Session(database) as db:
        _repeat(db)
        spec = db.query(RunMetricSpec).filter_by(run_id="rr", metric_name="h").one()
        spec.direction = "maximize"
        db.commit()
    with Session(database) as db, _Statements(database) as sql:
        insights_api.project_insights(
            project_slug="test",
            period="all",
            task=None,
            dataset=None,
            dataset_version_id=None,
            model=None,
            status=None,
            db=db,
            principal=_principal(db),
        )
    # Only the run mean is shown: no pass rows for maximize metrics.
    assert not any("run_item_pass_scores" in s for s in sql)
    with Session(database) as db, _Statements(database) as sql:
        runs_api.models_runs_data(files=["rr"], db=db, principal=_principal(db))
    # Scores and their scorer-error status come from one scan of the runs'
    # scores (other reads are keyed by the few errored items).
    scans = [s for s in sql if "from run_item_scores" in s and "run_item_scores.item_id in" not in s]
    assert len(scans) == 1
