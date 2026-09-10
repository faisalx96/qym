"""Per-step latency distributions for runs.

Computes percentile-based latency stats (n, mean, median, std, p5/p25/p75/p95,
min, max, CV) per (phase, step type) from stored spans, and serves them as
JSON or CSV. Phase attribution (task vs eval) mirrors the ingestion logic:
spans under an ``eval_metrics`` root or carrying ``qym.usage_scope=metric``
(directly or via an ancestor) belong to the eval phase.

Purely read-only: no schema changes, no ingestion changes.
"""

from __future__ import annotations

import csv
import io
import math
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from qym_platform.api.ingest import _span_oi_kind, _span_usage_scope
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import Run, RunItemAttempt, Span
from qym_platform.deps import get_db
from qym_platform.permissions import can_view_run

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


def _metric_span_ids(spans: Sequence[Any]) -> set:
    """Span ids in the eval phase, per trace: metric-scoped spans and all
    descendants of metric roots (``eval_metrics`` name or metric usage scope).
    Mirrors ingestion's attribution."""
    eval_ids: set = set()
    by_trace: Dict[str, List[Any]] = defaultdict(list)
    for span in spans:
        by_trace[span.trace_id].append(span)

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
                eval_ids.add(span.span_id)
    return eval_ids


def _step_label(kind: str, name: str, attrs: Dict[str, Any], rollup: str) -> str:
    if rollup == "kind":
        return kind.lower()
    if kind == "TOOL":
        return str(attrs.get("tool.name") or name or "tool")
    if kind == "LLM":
        model = str(attrs.get("llm.model_name") or "").strip()
        return f"llm:{model}" if model else (name or "llm")
    return name or kind.lower()


def classify_spans(spans: Sequence[Any], rollup: str = "name") -> List[Dict[str, Any]]:
    """Map spans to step rows: [{phase, kind, step_type, name, duration_ms,
    status, ...}] keeping only step-kind spans with usable durations or
    error status."""
    eval_ids = _metric_span_ids(spans)
    parent_ids = {
        (span.trace_id, span.parent_span_id)
        for span in spans
        if span.parent_span_id
    }
    rows: List[Dict[str, Any]] = []
    for span in spans:
        attrs = span.attributes or {}
        kind = _span_oi_kind(attrs)
        if span.name in _STRUCTURAL_SPAN_NAMES:
            continue
        is_leaf = (span.trace_id, span.span_id) not in parent_ids
        if kind not in _STEP_KINDS and not is_leaf:
            continue
        if not kind:
            kind = "OTHER"
        duration = span.duration_ms
        try:
            duration = float(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration = None
        if duration is not None and (not math.isfinite(duration) or duration < 0):
            duration = None
        status = str(span.status or "UNSET").upper()
        tokens = _token_counts(attrs)
        if duration is None and status != "ERROR":
            continue
        rows.append(
            {
                "run_id": span.run_id,
                "trace_id": span.trace_id,
                "span_id": span.span_id,
                "phase": "eval" if span.span_id in eval_ids else "task",
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
        )
    return rows


def compute_step_latency(
    spans: Sequence[Any], rollup: str = "name"
) -> List[Dict[str, Any]]:
    """Aggregate spans into per-(phase, step_type) latency distributions.

    ERROR spans are excluded from the distributions and surfaced as
    ``error_count`` per group.
    """
    rows = classify_spans(spans, rollup=rollup)
    groups: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        key = (row["phase"], row["step_type"], row["kind"])
        group = groups.setdefault(
            key,
            {"durations": [], "error_count": 0,
             "tokens_total": 0, "tokens_prompt": 0, "tokens_completion": 0},
        )
        # tokens count for every span, errored or not: they were spent
        for field in ("tokens_total", "tokens_prompt", "tokens_completion"):
            group[field] += row.get(field) or 0
        if row["status"] == "ERROR":
            group["error_count"] += 1
        elif row["duration_ms"] is not None:
            group["durations"].append(row["duration_ms"])

    out: List[Dict[str, Any]] = []
    for (phase, step_type, kind), group in groups.items():
        durations = sorted(group["durations"])
        n = len(durations)
        if n == 0 and group["error_count"] == 0:
            continue
        if n:
            mean = sum(durations) / n
            variance = sum((d - mean) ** 2 for d in durations) / n
            std = math.sqrt(variance)
            stats = {
                "n": n,
                "error_count": group["error_count"],
                "tokens_total": group["tokens_total"],
                "tokens_prompt": group["tokens_prompt"],
                "tokens_completion": group["tokens_completion"],
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
            }
        else:
            stats = {
                "n": 0,
                "error_count": group["error_count"],
                "tokens_total": group["tokens_total"],
                "tokens_prompt": group["tokens_prompt"],
                "tokens_completion": group["tokens_completion"],
                **{f: None for f in _LATENCY_FIELDS},
            }
        out.append({"phase": phase, "step_type": step_type, "kind": kind, **stats})

    out.sort(
        key=lambda g: (
            g["phase"],
            -(g["median_ms"] if g["median_ms"] is not None else -1),
        )
    )
    return out


PASS_REF_SEP = "::pass"


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
    principal: Principal,
    run_ids: List[str],
    pass_number: Optional[int] = None,
) -> tuple:
    """Load spans for the given run refs plus the passes available on them.

    Refs may be plain run ids or pass refs ("<run_id>::pass2"). A global
    ``pass_number`` applies to refs that don't carry their own.
    """
    if not run_ids:
        raise HTTPException(status_code=400, detail="No run ids given")

    refs = [_parse_run_ref(ref) for ref in run_ids]
    base_ids = list(dict.fromkeys(base for base, _ in refs))

    runs = Run.active(db).filter(Run.id.in_(base_ids)).all()
    found = {run.id: run for run in runs}
    missing = [rid for rid in base_ids if rid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Run not found: {missing[0]}")
    for run in runs:
        if not can_view_run(db, principal, run):
            raise HTTPException(status_code=403, detail="Access denied")

    passes = sorted(
        row[0]
        for row in db.query(RunItemAttempt.pass_number)
        .filter(RunItemAttempt.run_id.in_(base_ids))
        .distinct()
        .all()
        if row[0] is not None
    )

    def _traces_for(run_id: str, pass_no: int) -> List[str]:
        return [
            row[0]
            for row in db.query(RunItemAttempt.trace_id)
            .filter(
                RunItemAttempt.run_id == run_id,
                RunItemAttempt.pass_number == pass_no,
                RunItemAttempt.trace_id.isnot(None),
            )
            .distinct()
            .all()
        ]

    # Resolve each ref to either "the whole run" or "these traces", then take
    # the union so mixed selections (a whole run + one pass of another) work.
    whole_runs: List[str] = []
    trace_ids: List[str] = []
    for base, ref_pass in refs:
        effective = ref_pass if ref_pass is not None else pass_number
        if effective is None:
            whole_runs.append(base)
        else:
            trace_ids.extend(_traces_for(base, effective))

    query = db.query(Span)
    if whole_runs and trace_ids:
        query = query.filter(
            or_(Span.run_id.in_(whole_runs), Span.trace_id.in_(trace_ids))
        )
    elif whole_runs:
        query = query.filter(Span.run_id.in_(whole_runs))
    else:
        query = query.filter(Span.trace_id.in_(trace_ids))
    return query.all(), passes


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


@router.get("/api/runs/step-latency")
def multi_run_step_latency(
    run_ids: str = Query(..., description="Comma-separated run ids"),
    format: str = Query("json", pattern="^(json|csv)$"),
    level: str = Query("summary", pattern="^(summary|spans)$"),
    rollup: str = Query("name", pattern="^(name|kind)$"),
    pass_number: Optional[int] = Query(None, ge=1, description="Restrict to one repeat pass"),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    ids = [rid.strip() for rid in run_ids.split(",") if rid.strip()]
    spans, passes = _load_spans(db, principal, ids, pass_number=pass_number)
    trace_count = len({span.trace_id for span in spans if span.trace_id})
    if level == "spans":
        rows = classify_spans(spans, rollup=rollup)
        if format == "csv":
            return _csv_response(_SPAN_FIELDS, rows, "step_latency_spans.csv")
        return {"run_ids": ids, "pass_number": pass_number, "passes": passes,
                "trace_count": trace_count, "spans": rows}
    groups = compute_step_latency(spans, rollup=rollup)
    if format == "csv":
        return _csv_response(_SUMMARY_FIELDS, groups, "step_latency_summary.csv")
    return {
        "run_ids": ids,
        "rollup": rollup,
        "pass_number": pass_number,
        "passes": passes,
        "trace_count": trace_count,
        "groups": groups,
    }


@router.get("/api/runs/{run_id}/step-latency")
def single_run_step_latency(
    run_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    level: str = Query("summary", pattern="^(summary|spans)$"),
    rollup: str = Query("name", pattern="^(name|kind)$"),
    pass_number: Optional[int] = Query(None, ge=1, description="Restrict to one repeat pass"),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    return multi_run_step_latency(
        run_ids=run_id,
        format=format,
        level=level,
        rollup=rollup,
        pass_number=pass_number,
        db=db,
        principal=principal,
    )
