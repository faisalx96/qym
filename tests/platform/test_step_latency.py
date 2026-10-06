"""Tests for per-step latency distributions (qym_platform.api.step_latency)."""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import pytest

from qym_platform.api.step_latency import (
    _percentile,
    classify_spans,
    compute_step_latency,
    summarize_step_latency,
)


@dataclass
class FakeSpan:
    span_id: str
    name: str
    trace_id: str = "t1"
    run_id: str = "r1"
    parent_span_id: Optional[str] = None
    duration_ms: Optional[float] = None
    status: str = "OK"
    start_time_ns: Optional[int] = 0
    end_time_ns: Optional[int] = 0
    attributes: Dict[str, Any] = field(default_factory=dict)


def tool(span_id, name, parent, dur, status="OK", trace="t1", **attrs):
    return FakeSpan(
        span_id=span_id, name=name, parent_span_id=parent, duration_ms=dur,
        status=status, trace_id=trace,
        attributes={"openinference.span.kind": "TOOL", "tool.name": name, **attrs},
    )


def llm(span_id, parent, dur, model="m1", trace="t1", tokens=None, status="OK"):
    attrs = {"openinference.span.kind": "LLM", "llm.model_name": model}
    if tokens:
        attrs.update({
            "llm.token_count.prompt": tokens[0],
            "llm.token_count.completion": tokens[1],
            "llm.token_count.total": tokens[0] + tokens[1],
        })
    return FakeSpan(
        span_id=span_id, name="ChatCompletion", parent_span_id=parent,
        duration_ms=dur, trace_id=trace, status=status, attributes=attrs,
    )


def make_trace():
    """root -> chat_task -> [tool sql x3, llm x2]; root -> eval_metrics -> [tool sql x2, llm judge]."""
    return [
        FakeSpan(span_id="root", name="eval-item"),
        FakeSpan(span_id="task", name="chat_task", parent_span_id="root"),
        tool("s1", "sql_execute", "task", 100.0),
        tool("s2", "sql_execute", "task", 200.0),
        tool("s3", "sql_execute", "task", 300.0),
        llm("l1", "task", 1000.0),
        llm("l2", "task", 3000.0),
        FakeSpan(span_id="em", name="eval_metrics", parent_span_id="root"),
        tool("s4", "sql_execute", "em", 400.0),
        tool("s5", "sql_execute", "em", 500.0),
        llm("l3", "em", 2000.0, model="judge-1"),
    ]


class TestPercentile:
    def test_known_values(self):
        xs = sorted(float(i) for i in range(1, 101))  # 1..100
        assert _percentile(xs, 50) == pytest.approx(50.5)
        assert _percentile(xs, 25) == pytest.approx(25.75)
        assert _percentile(xs, 95) == pytest.approx(95.05)

    def test_single_value(self):
        assert _percentile([42.0], 95) == 42.0


class TestPhaseAttribution:
    def test_task_vs_eval_split(self):
        rows = classify_spans(make_trace())
        phases = {r["span_id"]: r["phase"] for r in rows}
        assert phases["s1"] == phases["s2"] == phases["s3"] == "task"
        assert phases["l1"] == phases["l2"] == "task"
        assert phases["s4"] == phases["s5"] == "eval"
        assert phases["l3"] == "eval"

    def test_usage_scope_attr_without_ancestry(self):
        spans = make_trace()
        # a task-parented tool explicitly tagged metric-scope (the ask_question
        # re-execution case) must land in eval
        spans.append(
            tool("s6", "sql_execute", "task", 999.0, **{"qym.usage_scope": "metric"})
        )
        rows = classify_spans(spans)
        assert {r["phase"] for r in rows if r["span_id"] == "s6"} == {"eval"}

    def test_orphan_parent_is_task(self):
        spans = [tool("x1", "sql_execute", "missing-parent", 50.0)]
        rows = classify_spans(spans)
        assert rows[0]["phase"] == "task"

    def test_container_spans_excluded(self):
        rows = classify_spans(make_trace())
        ids = {r["span_id"] for r in rows}
        assert "root" not in ids and "task" not in ids and "em" not in ids

    def test_matching_span_ids_in_other_runs_do_not_inherit_eval_phase(self):
        rows = classify_spans([
            FakeSpan(
                span_id="call", name="evaluate", run_id="r1", trace_id="t1",
                duration_ms=100.0, attributes={"qym.usage_scope": "metric"},
            ),
            FakeSpan(
                span_id="call", name="task", run_id="r2", trace_id="t2",
                duration_ms=200.0,
            ),
        ])
        assert {row["run_id"]: row["phase"] for row in rows} == {
            "r1": "eval", "r2": "task",
        }


class TestStats:
    def test_group_stats(self):
        groups = compute_step_latency(make_trace())
        by_key = {(g["phase"], g["step_type"]): g for g in groups}

        task_sql = by_key[("task", "sql_execute")]
        assert task_sql["n"] == 3
        assert task_sql["mean_ms"] == pytest.approx(200.0)
        assert task_sql["median_ms"] == pytest.approx(200.0)
        assert task_sql["min_ms"] == 100.0 and task_sql["max_ms"] == 300.0

        eval_sql = by_key[("eval", "sql_execute")]
        assert eval_sql["n"] == 2
        assert eval_sql["mean_ms"] == pytest.approx(450.0)

        assert by_key[("eval", "llm:judge-1")]["n"] == 1

    def test_errors_excluded_but_counted(self):
        spans = make_trace()
        spans.append(tool("e1", "sql_execute", "task", 9999.0, status="ERROR"))
        groups = compute_step_latency(spans)
        task_sql = next(
            g for g in groups if g["phase"] == "task" and g["step_type"] == "sql_execute"
        )
        assert task_sql["n"] == 3          # error not pooled into distribution
        assert task_sql["error_count"] == 1
        assert task_sql["max_ms"] == 300.0  # 9999 did not leak into stats

    def test_missing_duration_skipped(self):
        spans = make_trace()
        spans.append(tool("m1", "sql_execute", "task", None))
        groups = compute_step_latency(spans)
        task_sql = next(
            g for g in groups if g["phase"] == "task" and g["step_type"] == "sql_execute"
        )
        assert task_sql["n"] == 3

    def test_rollup_by_kind(self):
        groups = compute_step_latency(make_trace(), rollup="kind")
        keys = {(g["phase"], g["step_type"]) for g in groups}
        assert ("task", "tool") in keys and ("task", "llm") in keys
        task_tool = next(
            g for g in groups if g["phase"] == "task" and g["step_type"] == "tool"
        )
        assert task_tool["n"] == 3

    def test_multi_trace_pooling(self):
        spans = make_trace()
        spans += [
            FakeSpan(span_id="root2", name="eval-item", trace_id="t2"),
            tool("t2s1", "sql_execute", "root2", 700.0, trace="t2"),
        ]
        groups = compute_step_latency(spans)
        task_sql = next(
            g for g in groups if g["phase"] == "task" and g["step_type"] == "sql_execute"
        )
        assert task_sql["n"] == 4

    def test_sorted_by_median_desc_within_phase(self):
        groups = compute_step_latency(make_trace())
        task_groups = [g for g in groups if g["phase"] == "eval"]
        medians = [g["median_ms"] for g in task_groups]
        assert medians == sorted(medians, reverse=True)


class TestLeafRule:
    def test_custom_untagged_leaf_span_included(self):
        spans = make_trace()
        spans.append(FakeSpan(
            span_id="c1", name="parse_response", parent_span_id="task",
            duration_ms=42.0,
        ))
        rows = classify_spans(spans)
        row = next(r for r in rows if r["span_id"] == "c1")
        assert row["step_type"] == "parse_response"
        assert row["kind"] == "OTHER"
        assert row["phase"] == "task"

    def test_untagged_container_with_children_excluded(self):
        rows = classify_spans(make_trace())
        assert "task" not in {r["span_id"] for r in rows}  # chat_task has children

    def test_kind_tagged_span_with_children_still_included(self):
        spans = make_trace()
        # a TOOL span that itself has a child sub-span
        spans.append(FakeSpan(
            span_id="sub", name="inner", parent_span_id="s1", duration_ms=1.0,
        ))
        rows = classify_spans(spans)
        assert "s1" in {r["span_id"] for r in rows}  # kind wins over leaf test

    def test_childless_eval_metrics_not_a_step(self):
        spans = [
            FakeSpan(span_id="root", name="eval-item"),
            tool("s1", "sql_execute", "root", 100.0),
            # eval_metrics with no metric sub-spans: a leaf, but structural
            FakeSpan(span_id="em", name="eval_metrics", parent_span_id="root"),
        ]
        rows = classify_spans(spans)
        assert "em" not in {r["span_id"] for r in rows}

    def test_other_runs_children_do_not_hide_a_leaf_with_the_same_ids(self):
        spans = [
            FakeSpan(span_id="root", name="parse", run_id="r1", duration_ms=50.0),
            FakeSpan(span_id="root", name="parse", run_id="r2", duration_ms=60.0),
            FakeSpan(
                span_id="child", name="read", run_id="r2", parent_span_id="root",
                duration_ms=40.0,
            ),
        ]
        rows = classify_spans(spans)
        assert {(row["run_id"], row["span_id"]) for row in rows} == {
            ("r1", "root"), ("r2", "child"),
        }


class TestTokens:
    def test_tokens_summed_per_group(self):
        spans = [
            FakeSpan(span_id="root", name="eval-item"),
            llm("l1", "root", 100.0, tokens=(1000, 200)),
            llm("l2", "root", 120.0, tokens=(800, 150)),
        ]
        groups = compute_step_latency(spans)
        g = next(x for x in groups if x["step_type"] == "llm:m1")
        assert g["tokens_prompt"] == 1800
        assert g["tokens_completion"] == 350
        assert g["tokens_total"] == 2150

    def test_total_falls_back_to_prompt_plus_completion(self):
        span = llm("l1", None, 100.0, tokens=(500, 100))
        del span.attributes["llm.token_count.total"]
        groups = compute_step_latency([span])
        assert groups[0]["tokens_total"] == 600

    def test_errored_call_tokens_still_counted(self):
        spans = [
            FakeSpan(span_id="root", name="eval-item"),
            llm("l1", "root", 100.0, tokens=(900, 100)),
            llm("l2", "root", 50.0, tokens=(400, 0), status="ERROR"),
        ]
        groups = compute_step_latency(spans)
        g = next(x for x in groups if x["step_type"] == "llm:m1")
        assert g["n"] == 1 and g["error_count"] == 1
        assert g["tokens_total"] == 1400  # errored call's prompt tokens included

    def test_missing_token_attrs_are_zero(self):
        groups = compute_step_latency(make_trace())
        assert all(g["tokens_total"] == 0 for g in groups)

    def test_error_only_group_reports_tokens(self):
        spans = [llm("l1", None, None, tokens=(300, 0), status="ERROR")]
        groups = compute_step_latency(spans)
        assert groups[0]["n"] == 0
        assert groups[0]["tokens_total"] == 300
        assert groups[0]["mean_ms"] is None


MS = 1_000_000  # ns per ms


def timed_trace(trace="t1", task_ms=5000.0, eval_ms=3000.0, run="r1", task_status="OK"):
    """make_trace() with timed containers: root -> chat_task, eval_metrics."""
    durations = {"root": task_ms + eval_ms, "task": task_ms, "em": eval_ms}
    spans = make_trace()
    for span in spans:
        span.trace_id, span.run_id = trace, run
        span.duration_ms = durations.get(span.span_id, span.duration_ms)
        if span.span_id == "task":
            span.status = task_status
    return spans


def phases_of(spans):
    return {p["phase"]: p for p in summarize_step_latency(spans)["phases"]}


class TestPhaseParents:
    """Phase headers draw each trace's phase parent span, which step groups
    leave out as a container (C143)."""

    def test_task_span_and_eval_metrics_are_the_phase_parents(self):
        spans = timed_trace("t1", 5000.0, 3000.0) + timed_trace("t2", 7000.0, 1000.0)
        phases = phases_of(spans)
        assert list(phases) == ["task", "eval"]
        task, evals = phases["task"], phases["eval"]
        assert task["n"] == 2 and task["error_count"] == 0  # one sample per trace
        assert task["mean_ms"] == pytest.approx(6000.0)
        assert (task["min_ms"], task["max_ms"]) == (5000.0, 7000.0)
        assert evals["n"] == 2 and evals["mean_ms"] == pytest.approx(2000.0)
        # the item root (8s, both phases) is never a phase sample
        assert task["max_ms"] < 8000.0
        # the step groups are what compute_step_latency returns
        assert summarize_step_latency(spans)["groups"] == compute_step_latency(spans)

    def test_root_is_the_task_parent_without_an_eval_phase(self):
        spans = [
            FakeSpan(span_id="root", name="eval-item", duration_ms=900.0),
            tool("s1", "sql_execute", "root", 100.0),
        ]
        phases = phases_of(spans)
        assert list(phases) == ["task"]
        assert phases["task"]["n"] == 1
        assert phases["task"]["mean_ms"] == pytest.approx(900.0)

    def test_errored_parent_is_counted_not_pooled(self):
        spans = timed_trace("t1", 9999.0, task_status="ERROR") + timed_trace("t2", 5000.0)
        task = phases_of(spans)["task"]
        assert task["n"] == 1 and task["error_count"] == 1
        assert task["max_ms"] == 5000.0

    def test_metric_scoped_span_under_the_task_keeps_the_task_span(self):
        spans = timed_trace("t1", 5000.0, 3000.0)
        by_id = {span.span_id: span for span in spans}
        by_id["em"].start_time_ns, by_id["em"].end_time_ns = 6000 * MS, 9000 * MS
        # ask_question re-execution: a metric-scoped tool parented to the task
        rerun = tool("s6", "sql_execute", "task", 999.0, **{"qym.usage_scope": "metric"})
        rerun.start_time_ns, rerun.end_time_ns = 6500 * MS, 7499 * MS
        phases = phases_of(spans + [rerun])
        assert phases["task"]["mean_ms"] == pytest.approx(5000.0)
        # eval's parents are eval_metrics and the re-run: one wall-clock window
        assert phases["eval"]["n"] == 1
        assert phases["eval"]["mean_ms"] == pytest.approx(3000.0)

    def test_parents_without_a_wrapper_span_their_wall_clock_extent(self):
        def timed(span, start_ms, end_ms):
            span.start_time_ns, span.end_time_ns = start_ms * MS, end_ms * MS
            span.duration_ms = float(end_ms - start_ms)
            return span

        spans = [
            timed(FakeSpan(span_id="root", name="eval-item"), 0, 700),
            timed(tool("a", "sql_execute", "root", None), 0, 100),
            timed(tool("b", "http_get", "root", None), 150, 400),
            timed(FakeSpan(span_id="em", name="eval_metrics", parent_span_id="root"), 400, 700),
        ]
        phases = phases_of(spans)
        assert phases["task"]["n"] == 1
        assert phases["task"]["mean_ms"] == pytest.approx(400.0)
        assert phases["eval"]["mean_ms"] == pytest.approx(300.0)

    def test_phase_tokens_are_their_step_tokens(self):
        spans = timed_trace("t1")
        spans.append(llm("l9", "task", 10.0, tokens=(100, 20)))
        spans.append(llm("l8", "em", 10.0, model="judge-1", tokens=(50, 5)))
        # an agent span reporting its children's total must not double-count
        next(s for s in spans if s.span_id == "task").attributes.update(
            {"llm.token_count.total": 120}
        )
        phases = phases_of(spans)
        assert phases["task"]["tokens_total"] == 120
        assert (phases["task"]["tokens_prompt"], phases["task"]["tokens_completion"]) == (100, 20)
        assert phases["eval"]["tokens_total"] == 55

    def test_runs_sharing_trace_and_span_ids_stay_separate(self):
        spans = timed_trace("t1", 5000.0, run="r1") + timed_trace("t1", 7000.0, run="r2")
        assert phases_of(spans)["task"]["n"] == 2

    def test_traces_without_timed_parents_report_no_phases(self):
        assert summarize_step_latency(make_trace())["phases"] == []
