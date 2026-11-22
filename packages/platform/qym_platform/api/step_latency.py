"""Per-step latency distributions for runs.

Computes percentile-based latency stats (n, mean, median, std, p5/p25/p75/p95,
min, max, CV) per (phase, step type) from stored spans, and serves them as
JSON or CSV. Phase attribution (task vs eval) mirrors the ingestion logic:
spans under an ``eval_metrics`` root or carrying ``qym.usage_scope=metric``
(directly or via an ancestor) belong to the eval phase. The JSON summary also
carries one distribution per phase, of each trace's phase parent span.

Purely read-only: no schema changes, no ingestion changes.
"""

from __future__ import annotations

import csv
import io
import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.api.ingest import _span_oi_kind, _span_usage_scope
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import Run, RunItemAttempt, RunStepLatencySummary, Span
from qym_platform.deps import get_db
from qym_platform.middleware.etag import mark_cacheable
from qym_platform.permissions import can_view_run
from qym_platform.services.repeat_passes import pass_revision
from qym_platform.services.span_scope import span_run_clause, spans_of_runs_clause

router = APIRouter()

# Span kinds that always count as "steps". Spans without one of these kinds
# still count when they are leaves (no children): that admits custom named
# spans users create in their own code, while container spans (AGENT/CHAIN
# roots, eval item wrappers) exclude themselves because they have children
# and would double-count their descendants' time.
_STEP_KINDS = {"LLM", "TOOL", "RETRIEVER", "EMBEDDING", "RERANKER", "GUARDRAIL"}

# qym structural spans are never steps, even when childless (e.g. an
# eval_metrics span with no recorded metric sub-spans is a leaf but
# still a phase container, not work).
_STRUCTURAL_SPAN_NAMES = {"eval_metrics"}

_LATENCY_FIELDS = [
    "mean_ms",
    "median_ms",
    "std_ms",
    "p5_ms",
    "p25_ms",
    "p75_ms",
    "p95_ms",
    "min_ms",
    "max_ms",
    "cv",
]

_TOKEN_FIELDS = ["tokens_total", "tokens_prompt", "tokens_completion"]

_SUMMARY_FIELDS = (
    ["phase", "step_type", "kind", "n", "error_count"]
    + _LATENCY_FIELDS
    + _TOKEN_FIELDS
)

_SPAN_FIELDS = [
    "run_id",
    "trace_id",
    "span_id",
    "phase",
    "kind",
    "step_type",
    "name",
    "duration_ms",
    "status",
    "tokens_total",
    "tokens_prompt",
    "tokens_completion",
    "start_time_ns",
    "end_time_ns",
]


def _token_counts(attrs: Dict[str, Any]) -> tuple:
    """(total, prompt, completion) from OpenInference llm.token_count.* attrs.

    Falls back to prompt+completion when no explicit total is recorded.
    """
    def _num(key: str) -> int:
        value = (attrs or {}).get(key)
        try:
            return int(value) if value is not None else 0
        except (TypeError, ValueError):
            return 0

    prompt = _num("llm.token_count.prompt")
    completion = _num("llm.token_count.completion")
    total = _num("llm.token_count.total") or (prompt + completion)
    return total, prompt, completion


def _percentile(sorted_values: Sequence[float], pct: float) -> float:
    """Linear-interpolation percentile (numpy's default method) on sorted data."""
    if not sorted_values:
        return math.nan
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (len(sorted_values) - 1) * (pct / 100.0)
    lo = int(math.floor(rank))
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = rank - lo
    return sorted_values[lo] + frac * (sorted_values[hi] - sorted_values[lo])


def _duration_ms(value: Any) -> Optional[float]:
    """A usable span duration in ms, or None (missing, non-finite, negative)."""
    try:
        duration = float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    if duration is not None and (not math.isfinite(duration) or duration < 0):
        return None
    return duration


def _metric_span_ids(spans: Sequence[Any]) -> set:
    """Run/trace/span keys in the eval phase: metric-scoped spans and all
    descendants of metric roots (``eval_metrics`` name or metric usage scope).
    Mirrors ingestion's attribution."""
    eval_ids: set = set()
    by_trace: Dict[tuple, List[Any]] = defaultdict(list)
    for span in spans:
        by_trace[(span.run_id, span.trace_id)].append(span)

    for trace_spans in by_trace.values():
        spans_by_id = {span.span_id: span for span in trace_spans}
        metric_root_ids = {
            span.span_id
            for span in trace_spans
            if span.name == "eval_metrics"
            or _span_usage_scope(span.attributes or {}) == "metric"
        }

        def _is_metric_descendant(span: Any) -> bool:
            parent_id = span.parent_span_id
            seen: set = set()
            while parent_id:
                if parent_id in metric_root_ids:
                    return True
                if parent_id in seen:
                    return False
                seen.add(parent_id)
                parent = spans_by_id.get(parent_id)
                if parent is None:
                    return False
                parent_id = parent.parent_span_id
            return False

        for span in trace_spans:
            if span.span_id in metric_root_ids or _is_metric_descendant(span):
                eval_ids.add((span.run_id, span.trace_id, span.span_id))
    return eval_ids


def _step_label(kind: str, name: str, attrs: Dict[str, Any], rollup: str) -> str:
    if rollup == "kind":
        return kind.lower()
    if kind == "TOOL":
        return str(attrs.get("tool.name") or name or "tool")
    if kind == "LLM":
        if rollup == "site":
            # A call site: the span's own name; its model is a separate field.
            return name or "llm"
        model = str(attrs.get("llm.model_name") or "").strip()
        return f"llm:{model}" if model else (name or "llm")
    return name or kind.lower()


def _site_context(spans: Sequence[Any], eval_ids: set) -> tuple:
    """Sub-agents for the call-site rollup.

    A sub-agent is an AGENT span of the task phase below the phase parent
    (the parent itself is the Agent phase). Returns each span's nearest
    sub-agent name, keyed like ``eval_ids``, and the sub-agent spans.
    """
    agent_of: Dict[tuple, str] = {}
    agent_spans: List[Any] = []
    by_trace: Dict[tuple, List[Any]] = defaultdict(list)
    for span in spans:
        by_trace[(span.run_id, span.trace_id)].append(span)
    for (run_id, trace_id), trace_spans in by_trace.items():
        def is_eval(span: Any) -> bool:
            return (run_id, trace_id, span.span_id) in eval_ids

        parents = _phase_parents(trace_spans, is_eval)
        stop = {node.span_id for nodes in parents.values() for node in nodes}
        by_id = {span.span_id: span for span in trace_spans}
        agents = {
            span.span_id
            for span in trace_spans
            if span.span_id not in stop
            and not is_eval(span)
            and _span_oi_kind(span.attributes or {}) == "AGENT"
        }
        agent_spans.extend(by_id[span_id] for span_id in agents)
        for span in trace_spans:
            parent_id, seen = span.parent_span_id, set()
            while parent_id and parent_id not in stop and parent_id not in seen:
                if parent_id in agents:
                    agent_of[(run_id, trace_id, span.span_id)] = by_id[parent_id].name
                    break
                seen.add(parent_id)
                parent = by_id.get(parent_id)
                if parent is None:
                    break
                parent_id = parent.parent_span_id
    return agent_of, agent_spans


def classify_spans(
    spans: Sequence[Any],
    rollup: str = "name",
    eval_ids: Optional[set] = None,
    agent_of: Optional[Dict[tuple, str]] = None,
) -> List[Dict[str, Any]]:
    """Map spans to step rows: [{phase, kind, step_type, name, duration_ms,
    status, ...}] keeping only step-kind spans with usable durations or
    error status. ``eval_ids`` reuses an attribution already computed.
    The call-site rollup (``site``) adds each row's ``model`` and ``agent``."""
    if eval_ids is None:
        eval_ids = _metric_span_ids(spans)
    if rollup == "site" and agent_of is None:
        agent_of, _ = _site_context(spans, eval_ids)
    parent_ids = {
        (span.run_id, span.trace_id, span.parent_span_id)
        for span in spans
        if span.parent_span_id
    }
    rows: List[Dict[str, Any]] = []
    for span in spans:
        attrs = span.attributes or {}
        kind = _span_oi_kind(attrs)
        if span.name in _STRUCTURAL_SPAN_NAMES:
            continue
        span_key = (span.run_id, span.trace_id, span.span_id)
        is_leaf = span_key not in parent_ids
        if kind not in _STEP_KINDS and not is_leaf:
            continue
        if not kind:
            kind = "OTHER"
        duration = _duration_ms(span.duration_ms)
        status = str(span.status or "UNSET").upper()
        tokens = _token_counts(attrs)
        if duration is None and status != "ERROR":
            continue
        row = {
            "run_id": span.run_id,
            "trace_id": span.trace_id,
            "span_id": span.span_id,
            "phase": "eval" if span_key in eval_ids else "task",
            "kind": kind,
            "step_type": _step_label(kind, span.name, attrs, rollup),
            "name": span.name,
            "duration_ms": duration,
            "status": status,
            "tokens_total": tokens[0],
            "tokens_prompt": tokens[1],
            "tokens_completion": tokens[2],
            "start_time_ns": span.start_time_ns,
            "end_time_ns": span.end_time_ns,
        }
        if rollup == "site":
            row["model"] = str(attrs.get("llm.model_name") or "").strip() or None
            row["agent"] = (agent_of or {}).get(span_key)
        rows.append(row)
    return rows


def _new_bucket() -> Dict[str, Any]:
    return {"durations": [], "error_count": 0,
            "tokens_total": 0, "tokens_prompt": 0, "tokens_completion": 0}


def _add_tokens(bucket: Dict[str, Any], row: Dict[str, Any]) -> None:
    # tokens count for every span, errored or not: they were spent
    for field in _TOKEN_FIELDS:
        bucket[field] += row.get(field) or 0


def _bucket_stats(bucket: Dict[str, Any]) -> Dict[str, Any]:
    """n, error_count, tokens and the latency fields of one bucket."""
    durations = sorted(bucket["durations"])
    n = len(durations)
    stats: Dict[str, Any] = {
        "n": n,
        "error_count": bucket["error_count"],
        **{field: bucket[field] for field in _TOKEN_FIELDS},
    }
    if not n:
        stats.update({f: None for f in _LATENCY_FIELDS})
        return stats
    mean = sum(durations) / n
    variance = sum((d - mean) ** 2 for d in durations) / n
    std = math.sqrt(variance)
    stats.update({
        "mean_ms": mean,
        "median_ms": _percentile(durations, 50),
        "std_ms": std,
        "p5_ms": _percentile(durations, 5),
        "p25_ms": _percentile(durations, 25),
        "p75_ms": _percentile(durations, 75),
        "p95_ms": _percentile(durations, 95),
        "min_ms": durations[0],
        "max_ms": durations[-1],
        "cv": (std / mean) if mean > 0 else None,
    })
    return stats


def _aggregate_steps(rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        # Call-site rows also split by model and sub-agent; other rows have
        # neither field, so their groups are unchanged.
        key = (row["phase"], row["step_type"], row["kind"], row.get("model"), row.get("agent"))
        group = groups.setdefault(key, _new_bucket())
        _add_tokens(group, row)
        if row["status"] == "ERROR":
            group["error_count"] += 1
        elif row["duration_ms"] is not None:
            group["durations"].append(row["duration_ms"])

    site = any("agent" in row for row in rows)
    out: List[Dict[str, Any]] = []
    for (phase, step_type, kind, model, agent), group in groups.items():
        if not group["durations"] and group["error_count"] == 0:
            continue
        entry = {"phase": phase, "step_type": step_type, "kind": kind}
        if site:
            entry.update({"model": model, "agent": agent})
        out.append({**entry, **_bucket_stats(group)})

    out.sort(
        key=lambda g: (
            g["phase"],
            -(g["median_ms"] if g["median_ms"] is not None else -1),
        )
    )
    return out


def compute_step_latency(
    spans: Sequence[Any], rollup: str = "name"
) -> List[Dict[str, Any]]:
    """Aggregate spans into per-(phase, step_type) latency distributions.

    ERROR spans are excluded from the distributions and surfaced as
    ``error_count`` per group.
    """
    return _aggregate_steps(classify_spans(spans, rollup=rollup))


def _phase_parents(
    trace_spans: Sequence[Any], is_eval: Callable[[Any], bool]
) -> Dict[str, List[Any]]:
    """The phase parent spans of one trace, per phase.

    Step rows leave containers out (they would double-count their children),
    so a phase header needs its own parent span, chosen as the attribution
    and ingestion's outer-scope spans see the trace:
    - eval: an eval span whose parent is not in the eval phase, i.e. the
      ``eval_metrics`` span (or a metric-scoped span outside it);
    - task: the trace root when it holds no eval span; otherwise the item
      root wraps both phases and its task-phase children are the parents
      (the SDK's task/agent span).
    """
    by_id = {span.span_id: span for span in trace_spans}

    def parent_of(span: Any) -> Optional[Any]:
        return by_id.get(span.parent_span_id) if span.parent_span_id else None

    # Every ancestor of an eval span holds eval work.
    holds_eval: set = set()
    for span in trace_spans:
        if not is_eval(span):
            continue
        parent = parent_of(span)
        while parent is not None and parent.span_id not in holds_eval:
            holds_eval.add(parent.span_id)
            parent = parent_of(parent)
    parents: Dict[str, List[Any]] = {"task": [], "eval": []}
    for span in trace_spans:
        parent = parent_of(span)
        if is_eval(span):
            if parent is None or not is_eval(parent):
                parents["eval"].append(span)
        elif parent is None:
            if span.span_id not in holds_eval:
                parents["task"].append(span)
        elif parent_of(parent) is None and parent.span_id in holds_eval:
            parents["task"].append(span)
    return parents


def _parents_duration(nodes: Sequence[Any]) -> Optional[float]:
    """One trace's phase time: its parent's duration, or the wall-clock
    extent of several parents (no single wrapper), else their summed time."""
    if len(nodes) == 1:
        return _duration_ms(nodes[0].duration_ms)
    starts = [node.start_time_ns for node in nodes]
    ends = [node.end_time_ns for node in nodes]
    if None not in starts and None not in ends and max(ends) > min(starts):
        return (max(ends) - min(starts)) / 1e6
    durations = [d for d in (_duration_ms(node.duration_ms) for node in nodes)
                 if d is not None]
    return sum(durations) if durations else None


def _aggregate_phases(
    spans: Sequence[Any], eval_ids: set, rows: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Per-phase distributions of the phase parent spans, one sample per
    trace (an ERROR parent counts as an error, as for steps). Tokens are the
    phase's step tokens, so containers never double-count them."""
    buckets = {"task": _new_bucket(), "eval": _new_bucket()}
    for row in rows:
        _add_tokens(buckets[row["phase"]], row)
    by_trace: Dict[tuple, List[Any]] = defaultdict(list)
    for span in spans:
        by_trace[(span.run_id, span.trace_id)].append(span)
    for (run_id, trace_id), trace_spans in by_trace.items():
        parents = _phase_parents(
            trace_spans,
            lambda span: (run_id, trace_id, span.span_id) in eval_ids,
        )
        for phase, nodes in parents.items():
            if not nodes:
                continue
            if any(str(node.status or "").upper() == "ERROR" for node in nodes):
                buckets[phase]["error_count"] += 1
                continue
            duration = _parents_duration(nodes)
            if duration is not None:
                buckets[phase]["durations"].append(duration)
    return [
        {"phase": phase, **_bucket_stats(bucket)}
        for phase, bucket in buckets.items()
        if bucket["durations"] or bucket["error_count"]
    ]


def _aggregate_agents(agent_spans: Sequence[Any]) -> List[Dict[str, Any]]:
    """One distribution per sub-agent name, one sample per invocation."""
    buckets: Dict[str, Dict[str, Any]] = {}
    for span in agent_spans:
        bucket = buckets.setdefault(span.name or "agent", _new_bucket())
        duration = _duration_ms(span.duration_ms)
        if str(span.status or "").upper() == "ERROR":
            bucket["error_count"] += 1
        elif duration is not None:
            bucket["durations"].append(duration)
    return [{"name": name, **_bucket_stats(bucket)} for name, bucket in buckets.items()]


def _aggregate_traces(spans: Sequence[Any], eval_ids: set) -> Dict[str, Any]:
    """Whole traces: each trace's root span(s), one sample per trace. A trace
    whose root or phase parent errored counts as an error, as for steps."""
    bucket = _new_bucket()
    by_trace: Dict[tuple, List[Any]] = defaultdict(list)
    for span in spans:
        if span.trace_id:
            by_trace[(span.run_id, span.trace_id)].append(span)
    for (run_id, trace_id), trace_spans in by_trace.items():
        ids = {span.span_id for span in trace_spans}
        roots = [span for span in trace_spans if not span.parent_span_id or span.parent_span_id not in ids]
        parents = _phase_parents(
            trace_spans, lambda span: (run_id, trace_id, span.span_id) in eval_ids
        )
        heads = roots + [node for nodes in parents.values() for node in nodes]
        if any(str(node.status or "").upper() == "ERROR" for node in heads):
            bucket["error_count"] += 1
            continue
        duration = _parents_duration(roots) if roots else None
        if duration is not None:
            bucket["durations"].append(duration)
    stats = _bucket_stats(bucket)
    return {field: stats[field] for field in ["n", "error_count"] + _LATENCY_FIELDS}


# The average trace (round 3 L2): the run's traces merged into one tree, in trace order, for the run page's
# Step timings "By step". Noise spans the trace drawer hides (framework plumbing with children) are see-through,
# as in the drawer: their children join the parent. Kinds the drawer always keeps are never noise.
_NOISE_SPAN_NAMES = {
    "should_continue", "route", "router", "RunnableSequence", "call_model", "ChannelWrite", "ChannelRead",
    "Prompt", "RunnableParallel", "RunnableLambda", "__start__", "__end__",
}
_KEEP_KINDS = {"LLM", "TOOL", "AGENT", "EMBEDDING", "RETRIEVER", "EVALUATOR", "GUARDRAIL"}
# A run whose span names never repeat (an id in each name) has no average trace; past this many merged nodes the
# summary leaves the tree out and the page falls back to its flat list of steps.
MAX_TREE_NODES = 2000
# A deeper path also leaves the tree out (the payload is nested one level per step).
MAX_TREE_DEPTH = 64


def _new_node(first: int) -> Dict[str, Any]:
    return {
        "first": first, "kinds": defaultdict(int), "phases": defaultdict(int), "models": set(), "step": False,
        "in_traces": 0, "calls": 0, "offsets": [], "children": [], **_new_bucket(),
    }


def _tree_payload(node: Dict[str, Any], name: Optional[str], traces: int, nodes: Dict[tuple, Dict[str, Any]]) -> Dict[str, Any]:
    kind = max(node["kinds"].items(), key=lambda kv: kv[1])[0] if node["kinds"] else "OTHER"
    phase = max(node["phases"].items(), key=lambda kv: kv[1])[0] if node["phases"] else None
    kids = [(child, nodes[child]) for child in node["children"]]
    # Trace order: the mean start of a step after its parent's start; the first one seen breaks ties (and places
    # a step without start times).
    kids.sort(key=lambda kv: (
        sum(kv[1]["offsets"]) / len(kv[1]["offsets"]) if kv[1]["offsets"] else math.inf, kv[1]["first"]
    ))
    return {
        "name": name,
        "kind": kind,
        "phase": phase,
        "step": node["step"],
        "models": sorted(node["models"]),
        "in_traces": node["in_traces"],
        "calls": node["calls"],
        "time_per_trace_ms": (sum(node["durations"]) / traces) if traces else None,
        **_bucket_stats(node),
        "children": [_tree_payload(child, path[-1], traces, nodes) for path, child in kids],
    }


def _aggregate_tree(spans: Sequence[Any], eval_ids: set, rows: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The average trace: every trace's spans merged into one tree.

    Merge rule: two spans are one node when they have the same name and their parents are one node (the same path
    of names from the trace root); a trace's single root is the "whole trace" node itself (several roots hang
    under it). Per node and per trace, the node's time is the sum of its spans' durations in that trace (ERROR
    spans are counted, not timed), so each sample is "the time in one trace", over the traces it runs in.
    Children are in trace order: the mean offset of their first start after the parent span's start.
    Returns None when the merged tree is larger than MAX_TREE_NODES."""
    steps = {(row["run_id"], row["trace_id"], row["span_id"]): row for row in rows}
    by_trace: Dict[tuple, List[Any]] = defaultdict(list)
    for span in spans:
        if span.trace_id:
            by_trace[(span.run_id, span.trace_id)].append(span)
    traces = len(by_trace)
    nodes: Dict[tuple, Dict[str, Any]] = {(): _new_node(0)}

    def start_key(item: tuple) -> tuple:
        index, span = item
        return (span.start_time_ns is None, span.start_time_ns or 0, index)

    for (run_id, trace_id), trace_spans in by_trace.items():
        ids = {span.span_id for span in trace_spans}
        children: Dict[str, List[tuple]] = defaultdict(list)
        roots: List[tuple] = []
        for index, span in enumerate(trace_spans):
            if span.parent_span_id and span.parent_span_id in ids and span.parent_span_id != span.span_id:
                children[span.parent_span_id].append((index, span))
            else:
                roots.append((index, span))
        roots.sort(key=start_key)
        for kids in children.values():
            kids.sort(key=start_key)
        starts = [span.start_time_ns for _, span in roots if span.start_time_ns is not None]
        trace_start = min(starts) if starts else None
        # One trace's time per node path (None while no span of it is timed).
        seen: Dict[tuple, List[Optional[float]]] = {}

        def visit(span: Any, path: tuple) -> None:
            key = (run_id, trace_id, span.span_id)
            node = nodes.get(path)
            if node is None:
                node = nodes[path] = _new_node(len(nodes))
                nodes[path[:-1]]["children"].append(path)
            row = steps.get(key)
            if row is not None:
                # A step: its row already holds the kind, phase, model and tokens (a container's tokens would count
                # its children's twice, so only steps carry them).
                node["step"] = True
                node["kinds"][row["kind"]] += 1
                node["phases"][row["phase"]] += 1
                if row.get("model"):
                    node["models"].add(row["model"])
                _add_tokens(node, row)
            else:
                attrs = span.attributes or {}
                node["kinds"][_span_oi_kind(attrs) or "OTHER"] += 1
                node["phases"]["eval" if key in eval_ids else "task"] += 1
                model = str(attrs.get("llm.model_name") or "").strip()
                if model:
                    node["models"].add(model)
            node["calls"] += 1
            acc = seen.setdefault(path, [None])
            if str(span.status or "").upper() == "ERROR":
                node["error_count"] += 1
            else:
                duration = _duration_ms(span.duration_ms)
                if duration is not None:
                    acc[0] = (acc[0] or 0.0) + duration

        def offset(span: Any, base: Optional[int]) -> Optional[float]:
            if base is None or span.start_time_ns is None:
                return None
            return (span.start_time_ns - base) / 1e6

        whole = nodes[()]
        for _, span in roots:
            whole["kinds"][_span_oi_kind(span.attributes or {}) or "OTHER"] += 1
        whole["calls"] += 1
        root_errors = any(str(span.status or "").upper() == "ERROR" for _, span in roots)
        if root_errors:
            whole["error_count"] += 1
        else:
            duration = _parents_duration([span for _, span in roots])
            if duration is not None:
                whole["durations"].append(duration)
        whole["in_traces"] += 1

        # The walk: (span, parent path, parent start). A single root is the whole trace, so its children start.
        top = children.get(roots[0][1].span_id, []) if len(roots) == 1 else roots
        base = roots[0][1].start_time_ns if len(roots) == 1 else trace_start
        stack: List[tuple] = [(span, (), base) for _, span in reversed(top)]
        firsts: Dict[tuple, Optional[float]] = {}
        while stack:
            span, parent_path, parent_start = stack.pop()
            kids = children.get(span.span_id, [])
            if kids and span.name in _NOISE_SPAN_NAMES and _span_oi_kind(span.attributes or {}) not in _KEEP_KINDS:
                stack.extend((kid, parent_path, parent_start) for _, kid in reversed(kids))
                continue
            path = parent_path + (span.name or "span",)
            if len(path) > MAX_TREE_DEPTH:
                return None
            visit(span, path)
            if path not in firsts:
                firsts[path] = offset(span, parent_start)
            stack.extend((kid, path, span.start_time_ns) for _, kid in reversed(kids))
        if len(nodes) > MAX_TREE_NODES:
            return None
        for path, (duration,) in seen.items():
            node = nodes[path]
            node["in_traces"] += 1
            if duration is not None:
                node["durations"].append(duration)
            if firsts.get(path) is not None:
                node["offsets"].append(firsts[path])
    if not traces:
        return None
    return _tree_payload(nodes[()], None, traces, nodes)


def _aggregate_kinds(rows: Sequence[Dict[str, Any]], traces: int) -> List[Dict[str, Any]]:
    """Each kind's time inside one trace: per trace, the sum of its steps' durations (ERROR steps are counted,
    not timed), over the traces it runs in; with its calls and the time of an average call."""
    kinds: Dict[str, Dict[str, Any]] = {}
    per_trace: Dict[tuple, List[Any]] = {}
    for row in rows:
        kind = row["kind"] or "OTHER"
        bucket = kinds.setdefault(kind, {**_new_bucket(), "calls": 0, "timed": 0.0, "timed_n": 0, "traces": set()})
        bucket["calls"] += 1
        bucket["traces"].add((row["run_id"], row["trace_id"]))
        _add_tokens(bucket, row)
        acc = per_trace.setdefault((kind, row["run_id"], row["trace_id"]), [None])
        if row["status"] == "ERROR":
            bucket["error_count"] += 1
        elif row["duration_ms"] is not None:
            acc[0] = (acc[0] or 0.0) + row["duration_ms"]
            bucket["timed"] += row["duration_ms"]
            bucket["timed_n"] += 1
    for (kind, _, _), (duration,) in per_trace.items():
        if duration is not None:
            kinds[kind]["durations"].append(duration)
    out = []
    for kind, bucket in kinds.items():
        out.append({
            "kind": kind,
            "in_traces": len(bucket["traces"]),
            "calls": bucket["calls"],
            "avg_call_ms": bucket["timed"] / bucket["timed_n"] if bucket["timed_n"] else None,
            "time_per_trace_ms": (sum(bucket["durations"]) / traces) if traces else None,
            **_bucket_stats(bucket),
        })
    out.sort(key=lambda k: -(k["time_per_trace_ms"] or 0))
    return out


def summarize_step_latency(
    spans: Sequence[Any], rollup: str = "name", tree: bool = False
) -> Dict[str, Any]:
    """Step groups plus phase parent distributions, from one attribution.

    The call-site rollup (``site``) also returns each sub-agent's span
    distribution (``agents``); every rollup returns whole-trace timings
    (``traces``). ``tree`` adds the average trace (``tree``, or None when
    it is too large) and each kind's time per trace (``kinds``)."""
    eval_ids = _metric_span_ids(spans)
    agent_of, agent_spans = _site_context(spans, eval_ids) if rollup == "site" else (None, [])
    rows = classify_spans(spans, rollup=rollup, eval_ids=eval_ids, agent_of=agent_of)
    summary: Dict[str, Any] = {
        "groups": _aggregate_steps(rows),
        "phases": _aggregate_phases(spans, eval_ids, rows),
        "traces": _aggregate_traces(spans, eval_ids),
    }
    if rollup == "site":
        summary["agents"] = _aggregate_agents(agent_spans)
    if tree:
        traces = len({(span.run_id, span.trace_id) for span in spans if span.trace_id})
        summary["tree"] = _aggregate_tree(spans, eval_ids, rows)
        summary["kinds"] = _aggregate_kinds(rows, traces)
    return summary


PASS_REF_SEP = "::pass"
# Distinct runs (and run or pass refs) one step-latency request may pool; the
# run cap matches GET /api/compare, whose lanes this endpoint serves.
MAX_STEP_LATENCY_RUNS = 20
MAX_STEP_LATENCY_REFS = 500
# The attributes this module reads, for spans stored before promoted columns.
_LEGACY_ATTRIBUTE_KEYS = (
    "openinference.span.kind",
    "ai.openinference.span.kind",
    "qym.usage_scope",
    "llm.model_name",
    "tool.name",
    "llm.token_count.total",
    "llm.token_count.prompt",
    "llm.token_count.completion",
)


def _parse_run_ref(ref: str) -> tuple:
    """Split "<run_id>::pass<N>" into (run_id, pass_number); plain ids give
    (run_id, None). Mirrors the dashboard's pass-ref convention so a cohort
    can mix whole runs and individual passes."""
    text = str(ref).strip()
    idx = text.find(PASS_REF_SEP)
    if idx < 0:
        return text, None
    try:
        return text[:idx], int(text[idx + len(PASS_REF_SEP):])
    except ValueError:
        return text[:idx], None


def _load_spans(
    db: Session,
    principal: Optional[Principal],
    run_ids: List[str],
    pass_number: Optional[int] = None,
) -> tuple:
    """Load spans for the given run refs plus the passes available on them.

    Refs may be plain run ids or pass refs ("<run_id>::pass2"). A global
    ``pass_number`` applies to refs that don't carry their own.
    """
    if not run_ids:
        raise HTTPException(status_code=400, detail="No run ids given")

    if len(set(run_ids)) > MAX_STEP_LATENCY_REFS:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_STEP_LATENCY_REFS} run or pass refs at once",
        )
    refs = [_parse_run_ref(ref) for ref in run_ids]
    base_ids = list(dict.fromkeys(base for base, _ in refs))
    if len(base_ids) > MAX_STEP_LATENCY_RUNS:
        # Every span of every run is pooled in memory: bound the request.
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_STEP_LATENCY_RUNS} runs at once "
            f"({len(base_ids)} requested)",
        )

    runs = Run.active(db).filter(Run.id.in_(base_ids)).all()
    found = {run.id: run for run in runs}
    missing = [rid for rid in base_ids if rid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Run not found: {missing[0]}")
    for run in runs:
        # principal None: the summary writer (C022), which serves no user
        if principal is not None and not can_view_run(db, principal, run):
            raise HTTPException(status_code=403, detail="Access denied")

    passes = sorted(
        row[0]
        for row in db.query(RunItemAttempt.pass_number)
        .filter(RunItemAttempt.run_id.in_(base_ids))
        .distinct()
        .all()
        if row[0] is not None
    )

    # Trace ids are client supplied and can repeat across runs. Keep each
    # pass's trace selection bound to the run whose access was checked.
    whole_runs: List[str] = []
    filters = []
    for base, ref_pass in refs:
        effective = ref_pass if ref_pass is not None else pass_number
        if effective is None:
            whole_runs.append(base)
        else:
            pass_traces = db.query(RunItemAttempt.trace_id).filter(
                RunItemAttempt.run_id == base,
                RunItemAttempt.pass_number == effective,
                RunItemAttempt.trace_id.isnot(None),
            )
            filters.append(
                and_(spans_of_runs_clause(db, [base]), Span.trace_id.in_(pass_traces))
            )
    if whole_runs:
        filters.append(spans_of_runs_clause(db, whole_runs))
    return _project_spans(db, filters), passes


def _spans_by_ref(
    db: Session,
    run_ids: List[str],
    spans: List["_SpanView"],
    pass_number: Optional[int] = None,
) -> Dict[str, List["_SpanView"]]:
    """Split the pooled spans of ``_load_spans`` into each ref's own spans.

    A pass ref owns the traces of that pass's attempts, exactly as the pooled
    filter selects them, so one request can serve every compared lane.
    """
    refs = list(dict.fromkeys(run_ids))
    scoped = {}
    for ref in refs:
        base, ref_pass = _parse_run_ref(ref)
        scoped[ref] = (base, ref_pass if ref_pass is not None else pass_number)
    wanted = {key for key in scoped.values() if key[1] is not None}
    traces: Dict[tuple, set] = defaultdict(set)
    if wanted:
        rows = db.query(
            RunItemAttempt.run_id, RunItemAttempt.pass_number, RunItemAttempt.trace_id
        ).filter(
            RunItemAttempt.run_id.in_(sorted({base for base, _ in wanted})),
            RunItemAttempt.trace_id.isnot(None),
        )
        for run_id, number, trace_id in rows:
            if (run_id, number) in wanted:
                traces[(run_id, number)].add(trace_id)
    spans_by_run: Dict[str, List[_SpanView]] = defaultdict(list)
    for span in spans:
        spans_by_run[span.run_id].append(span)
    result: Dict[str, List[_SpanView]] = {}
    for ref, (base, effective) in scoped.items():
        run_spans = spans_by_run.get(base, [])
        if effective is None:
            result[ref] = run_spans
        else:
            trace_ids = traces.get((base, effective), set())
            result[ref] = [span for span in run_spans if span.trace_id in trace_ids]
    return result


class _SpanView:
    """Narrow span row: scalar columns plus the few attributes this module reads.

    Promoted columns (migration 0053) answer kind/scope/model/tool/tokens without
    loading the attributes JSON; rows ingested before them fall back to the JSON.
    """

    __slots__ = ("run_id", "trace_id", "span_id", "parent_span_id", "name", "duration_ms", "status", "start_time_ns", "end_time_ns", "attributes")

    def __init__(self, row, attributes):
        (
            self.run_id, self.trace_id, self.span_id, self.parent_span_id, self.name,
            self.duration_ms, self.status, self.start_time_ns, self.end_time_ns,
        ) = row[:9]
        self.attributes = attributes


def _project_spans(db: Session, filters) -> List[_SpanView]:
    cols = (
        Span.run_id, Span.trace_id, Span.span_id, Span.parent_span_id, Span.name,
        Span.duration_ms, Span.status, Span.start_time_ns, Span.end_time_ns,
        Span.oi_kind, Span.usage_scope, Span.model_name, Span.tool_name,
        Span.token_total, Span.token_prompt, Span.token_completion, Span.id,
    )
    rows = db.query(*cols).filter(or_(*filters)).order_by(Span.start_time_ns.asc().nullslast(), Span.id.asc()).all()
    legacy_ids = [row[16] for row in rows if row[9] is None and row[10] is None and row[13] is None]
    legacy_attrs: Dict[int, Dict[str, Any]] = {}
    # Only the attribute keys read here, extracted in SQL, not the whole JSON.
    legacy_cols = [Span.attributes[key] for key in _LEGACY_ATTRIBUTE_KEYS]
    for start in range(0, len(legacy_ids), 500):
        chunk = legacy_ids[start : start + 500]
        for span_id, *values in db.query(Span.id, *legacy_cols).filter(Span.id.in_(chunk)):
            legacy_attrs[span_id] = {
                key: value
                for key, value in zip(_LEGACY_ATTRIBUTE_KEYS, values)
                if value is not None
            }
    views: List[_SpanView] = []
    for row in rows:
        if row[16] in legacy_attrs:
            attrs = legacy_attrs[row[16]]
        else:
            attrs = {}
            if row[9]:
                attrs["openinference.span.kind"] = row[9]
            if row[10]:
                attrs["qym.usage_scope"] = row[10]
            if row[11]:
                attrs["llm.model_name"] = row[11]
            if row[12]:
                attrs["tool.name"] = row[12]
            if row[13] is not None:
                attrs["llm.token_count.total"] = row[13]
            if row[14] is not None:
                attrs["llm.token_count.prompt"] = row[14]
            if row[15] is not None:
                attrs["llm.token_count.completion"] = row[15]
        views.append(_SpanView(row, attrs))
    return views


def _csv_response(fieldnames: List[str], rows: Iterable[Dict[str, Any]], filename: str) -> PlainTextResponse:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return PlainTextResponse(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# The run page's summary of a run is stored in run_step_latency_summaries (C022). The dashboard summary worker (the
# existing summary writer; no new process, owner) rebuilds it after it publishes a run: once when the run finishes,
# and at most every LIVE_SUMMARY_REBUILD while a run is live, so a large running run is not rebuilt per request.
# A read serves the stored row; only a missing or stale row is built on read.
LIVE_SUMMARY_REBUILD = timedelta(seconds=15)
# A running run's stored summary is served while it is this new (two writer rebuild intervals).
LIVE_SUMMARY_SERVE = timedelta(seconds=30)
WRITER_ROLLUP = "site"
SUMMARY_VERSION = "t1"


def _summary_fingerprint(db: Session, run: Run) -> str:
    """The span set a stored summary was built from: a late span, a removed pass or a new attempt changes it."""
    span_count, max_span = (
        db.query(func.count(Span.id), func.max(Span.id)).filter(span_run_clause(db, run.id, run.created_at)).one()
    )
    attempts = db.query(func.count()).select_from(RunItemAttempt).filter(RunItemAttempt.run_id == run.id).scalar()
    status = run.status.value if hasattr(run.status, "value") else str(run.status or "")
    # The leading version changes when the payload's shape does (t1: the average trace), so stored rows rebuild.
    return f"{SUMMARY_VERSION}|{status}|{pass_revision(run)}|{span_count or 0}|{max_span or 0}|{attempts or 0}"


def _is_live(run: Run) -> bool:
    return str(getattr(run.status, "value", run.status) or "").upper() in {"RUNNING", "PENDING"}


def _usable(stored: Optional[RunStepLatencySummary], fingerprint: str, live: bool, age: timedelta) -> bool:
    if stored is None:
        return False
    return stored.fingerprint == fingerprint or (live and datetime.utcnow() - stored.computed_at < age)


def _store(db: Session, run: Run, stored, rollup: str, pass_number: Optional[int], fingerprint: str) -> Dict[str, Any]:
    """Build the summary from the raw spans and store it; another writer's row wins a race."""
    payload = _summary_payload(db, None, [run.id], rollup, pass_number)
    now = datetime.utcnow()
    try:
        if stored is None:
            db.add(
                RunStepLatencySummary(
                    run_id=run.id,
                    pass_number=pass_number or 0,
                    rollup=rollup,
                    fingerprint=fingerprint,
                    payload=payload,
                    computed_at=now,
                )
            )
        else:
            stored.fingerprint, stored.payload, stored.computed_at = fingerprint, payload, now
        db.commit()
    except IntegrityError:
        db.rollback()
    return payload


def refresh_stored_summary(db: Session, run: Run) -> bool:
    """The summary writer's hook: rebuild the run's stored summary when it is stale. Returns whether it rebuilt."""
    fingerprint = _summary_fingerprint(db, run)
    stored = db.get(RunStepLatencySummary, (run.id, 0, WRITER_ROLLUP))
    if _usable(stored, fingerprint, _is_live(run), LIVE_SUMMARY_REBUILD):
        return False
    _store(db, run, stored, WRITER_ROLLUP, None, fingerprint)
    return True


def _stored_summary(
    db: Session,
    principal: Principal,
    run_id: str,
    rollup: str,
    pass_number: Optional[int],
) -> Dict[str, Any]:
    """The run page's summary of one run or pass: the stored row, or built and stored when it is missing or stale."""
    run = Run.active(db).filter(Run.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")
    fingerprint = _summary_fingerprint(db, run)
    stored = db.get(RunStepLatencySummary, (run.id, pass_number or 0, rollup))
    if _usable(stored, fingerprint, _is_live(run), LIVE_SUMMARY_SERVE):
        return stored.payload
    return _store(db, run, stored, rollup, pass_number, fingerprint)


@router.get("/api/runs/step-latency")
def multi_run_step_latency(
    run_ids: str = Query(..., description="Comma-separated run ids"),
    format: str = Query("json", pattern="^(json|csv)$"),
    level: str = Query("summary", pattern="^(summary|spans)$"),
    rollup: str = Query(
        "name",
        pattern="^(name|kind|site)$",
        description="name: LLM calls by model; kind: one row per kind; "
        "site: LLM calls by span name and model, with each step's sub-agent",
    ),
    pass_number: Optional[int] = Query(None, ge=1, description="Restrict to one repeat pass"),
    group_by: Optional[str] = Query(
        None,
        pattern="^ref$",
        description="Also return each run ref's own groups (JSON summary only)",
    ),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    response: Response = None,
) -> Dict[str, Any]:
    ids = [rid.strip() for rid in run_ids.split(",") if rid.strip()]
    # C072: an ETag when every run asked for is finished (access is checked below, before any body is sent)
    bases = list(dict.fromkeys(_parse_run_ref(ref)[0] for ref in ids))
    mark_cacheable(response, Run.active(db).filter(Run.id.in_(bases)).all() if len(bases) <= MAX_STEP_LATENCY_RUNS else [])
    if len(ids) == 1 and "::" not in ids[0] and level == "summary" and format == "json" and group_by is None:
        # The run page's request: one run (or one pass), summary JSON. Served from the stored summary (C022).
        return _stored_summary(db, principal, ids[0], rollup, pass_number)
    return _step_latency_response(db, principal, ids, format, level, rollup, pass_number, group_by)


def _summary_payload(
    db: Session, principal: Optional[Principal], ids: List[str], rollup: str, pass_number: Optional[int]
) -> Dict[str, Any]:
    """The JSON summary of the given refs, built from their raw spans."""
    payload = _step_latency_response(db, principal, ids, "json", "summary", rollup, pass_number, None)
    assert isinstance(payload, dict)
    return payload


def _step_latency_response(
    db: Session,
    principal: Optional[Principal],
    ids: List[str],
    format: str,
    level: str,
    rollup: str,
    pass_number: Optional[int],
    group_by: Optional[str],
):
    spans, passes = _load_spans(db, principal, ids, pass_number=pass_number)
    trace_count = len(
        {(span.run_id, span.trace_id) for span in spans if span.trace_id}
    )
    # Call-site rows name their model and sub-agent; CSV exports keep them.
    site_fields = ["model", "agent"] if rollup == "site" else []
    if level == "spans":
        rows = classify_spans(spans, rollup=rollup)
        if format == "csv":
            fields = _SPAN_FIELDS[:7] + site_fields + _SPAN_FIELDS[7:]
            return _csv_response(fields, rows, "step_latency_spans.csv")
        return {"run_ids": ids, "pass_number": pass_number, "passes": passes,
                "trace_count": trace_count, "spans": rows}
    if format == "csv":
        groups = compute_step_latency(spans, rollup=rollup)
        fields = _SUMMARY_FIELDS[:3] + site_fields + _SUMMARY_FIELDS[3:]
        return _csv_response(fields, groups, "step_latency_summary.csv")
    # The run page's call-site summary also carries the average trace; compare's lanes do not draw it.
    summary = summarize_step_latency(spans, rollup=rollup, tree=rollup == "site" and group_by is None)
    payload: Dict[str, Any] = {
        "run_ids": ids,
        "rollup": rollup,
        "pass_number": pass_number,
        "passes": passes,
        "trace_count": trace_count,
        "groups": summary["groups"],
        # Phase headers draw their parent spans, which steps leave out.
        "phases": summary["phases"],
        "traces": summary["traces"],
    }
    if "agents" in summary:
        payload["agents"] = summary["agents"]
    if "tree" in summary:
        payload["tree"] = summary["tree"]
        payload["kinds"] = summary["kinds"]
    if group_by == "ref":
        # Compare draws one lane per run or pass; serving every lane from the
        # pooled spans replaces one request per lane.
        by_ref = {
            ref: summarize_step_latency(ref_spans, rollup=rollup)
            for ref, ref_spans in _spans_by_ref(db, ids, spans, pass_number).items()
        }
        payload["groups_by_ref"] = {ref: s["groups"] for ref, s in by_ref.items()}
        payload["phases_by_ref"] = {ref: s["phases"] for ref, s in by_ref.items()}
    return payload


@router.get("/api/runs/{run_id}/step-latency")
def single_run_step_latency(
    run_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    level: str = Query("summary", pattern="^(summary|spans)$"),
    rollup: str = Query("name", pattern="^(name|kind|site)$"),
    pass_number: Optional[int] = Query(None, ge=1, description="Restrict to one repeat pass"),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    response: Response = None,
) -> Dict[str, Any]:
    return multi_run_step_latency(
        run_ids=run_id,
        format=format,
        level=level,
        rollup=rollup,
        pass_number=pass_number,
        group_by=None,
        db=db,
        principal=principal,
        response=response,
    )
