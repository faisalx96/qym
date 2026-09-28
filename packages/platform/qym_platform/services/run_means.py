"""One rule for a run's metric mean, shared by every view.

Errors count as 0:

- a task error scores every metric of that item as 0;
- a metric (scorer) error scores that metric as 0. Most SDKs already store 0
  for it; older SDKs and imports store no score, and those still count as 0;
- items that are still running or were never scored are left out.

The run page applies the same rule in ``metrics.js`` (``getRowScore``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple

from sqlalchemy import Text, cast, func

METRIC_ERROR_STATUSES = ("error", "failed", "timeout")


def is_metric_error(meta: Any) -> bool:
    """Return whether metric metadata represents a raised scorer error.

    ``meta.status`` is the only signal. The SDK sets it when a metric raises,
    times out, or returns a top-level ``error`` key (SDKs since 2026-09;
    earlier SDKs stored no score row for a raised metric). ``meta.error``
    alone is a verdict reason written by the metric itself (for example
    "Empty output" or a SQL syntax error), not a scorer crash.

    The run page applies the same rule in ``metrics.js``
    (``isMetricErrorMeta``).
    """
    if not isinstance(meta, dict):
        return False
    status = str(meta.get("status") or "").strip().lower()
    return status in METRIC_ERROR_STATUSES


def supersede_metric_error(meta: Dict[str, Any]) -> Dict[str, Any]:
    """A reviewer's score replaces what a failed scorer left behind.

    The row then no longer counts as a scorer error (``is_metric_error``),
    so error counts, "counted as 0%" notes and the mean without scorer
    errors all follow the edit. The failure stays on the row as
    ``original_status``, ``original_error`` and ``original_traceback``.
    Changes ``meta`` in place and returns it.
    """
    if is_metric_error(meta):
        for key in ("status", "error", "traceback"):
            if key in meta:
                value = meta.pop(key)
                meta.setdefault(f"original_{key}", value)
    return meta


def reduce_pass_scores(passes: Iterable[Any]) -> Tuple[Optional[float], int]:
    """An item's value in a repeat run: the mean over its passes.

    ``passes`` are rows with ``score_numeric`` and ``meta``. A scored pass
    counts at its value, a pass whose scorer failed without a score counts
    as 0, and a pass not scored yet is left out. Returns the mean (None when
    no pass counts) and how many passes counted.
    """
    values = [
        float(row.score_numeric) if row.score_numeric is not None else 0.0
        for row in passes
        if row.score_numeric is not None or is_metric_error(row.meta)
    ]
    return (sum(values) / len(values), len(values)) if values else (None, 0)


def metric_error_candidates(model):
    """SQL prefilter for score rows whose metadata holds a scorer error.

    Confirm each candidate with :func:`is_metric_error`.
    """
    return func.lower(func.trim(cast(model.meta["status"].as_string(), Text))).in_(
        METRIC_ERROR_STATUSES
    )


@dataclass
class MetricTotals:
    """Score totals for one metric of one run, over items without a task error."""

    score_sum: float = 0.0
    score_count: int = 0
    # Scorer errors that still stored a numeric score (normally 0).
    error_score_sum: float = 0.0
    error_score_count: int = 0
    # Scorer errors with no stored score.
    unscored_errors: int = 0
    # Repeat runs keep scorer errors on pass rows: each item row holds the
    # mean over its passes. ``pass_errors`` counts errored passes (the unit of
    # ``metric_error_counts``); ``scored_sum``/``scored_count`` are the totals
    # with each affected item re-reduced over its passes that did not error.
    pass_errors: int = 0
    scored_sum: Optional[float] = None
    scored_count: int = 0

    @property
    def metric_errors(self) -> int:
        return self.error_score_count + self.unscored_errors + self.pass_errors


def run_metric_mean(totals: MetricTotals, task_errors: int) -> Optional[float]:
    """Mean with every task and scorer error counted as 0."""
    denominator = totals.score_count + totals.unscored_errors + task_errors
    return totals.score_sum / denominator if denominator else None


def mean_without_metric_errors(
    totals: MetricTotals, task_errors: int
) -> Optional[float]:
    """The same mean with scorer errors left out; task errors still count as 0."""
    if totals.scored_sum is not None:
        denominator = totals.scored_count + task_errors
        return totals.scored_sum / denominator if denominator > 0 else None
    denominator = totals.score_count - totals.error_score_count + task_errors
    if denominator <= 0:
        return None
    return (totals.score_sum - totals.error_score_sum) / denominator


def apply_repeat_pass_errors(
    totals: Dict[str, "MetricTotals"],
    affected: Iterable[Tuple[str, Optional[float], Iterable[Tuple[Optional[float], bool]]]],
) -> None:
    """Add a repeat run's pass-level scorer errors to its metric totals.

    ``affected`` yields ``(metric, item_value, passes)`` for every item (without
    a task error) that has at least one errored pass; ``item_value`` is the
    item's stored mean over passes and ``passes`` its ``(score, errored)``
    pairs. The run mean is unchanged (errored passes already count as 0 in
    the item value); the mean without scorer errors re-reduces each such item
    over its passes that did not error, and an item whose every pass errored
    drops out of it.
    """
    for metric, item_value, passes in affected:
        passes = list(passes)
        metric_totals = totals.setdefault(metric, MetricTotals())
        if metric_totals.scored_sum is None:
            metric_totals.scored_sum = (
                metric_totals.score_sum - metric_totals.error_score_sum
            )
            metric_totals.scored_count = (
                metric_totals.score_count - metric_totals.error_score_count
            )
        metric_totals.pass_errors += sum(1 for _, errored in passes if errored)
        if item_value is not None:
            metric_totals.scored_sum -= float(item_value)
            metric_totals.scored_count -= 1
        clean = [
            float(score) for score, errored in passes if not errored and score is not None
        ]
        if clean:
            metric_totals.scored_sum += sum(clean) / len(clean)
            metric_totals.scored_count += 1


def metric_mean_fields(
    metrics: Iterable[str],
    totals: Dict[str, MetricTotals],
    task_errors: int,
) -> Dict[str, Dict[str, Any]]:
    """Published fields for each metric: the run mean, and the mean without
    scorer errors.

    ``metric_scored_averages`` is present only for metrics with scorer errors,
    so the UI can explain how far the errors moved the mean.
    """
    averages: Dict[str, Any] = {}
    scored: Dict[str, Any] = {}
    for metric in metrics:
        metric_totals = totals.get(metric) or MetricTotals()
        mean = run_metric_mean(metric_totals, task_errors)
        averages[metric] = mean if mean is not None else 0.0
        if metric_totals.metric_errors:
            scored[metric] = mean_without_metric_errors(metric_totals, task_errors)
    return {"metric_averages": averages, "metric_scored_averages": scored}


def raw_metric_totals(db, run_ids) -> Dict[str, Dict[str, MetricTotals]]:
    """Per-run, per-metric totals from ``RunItemScore`` rows.

    Rows on items with a task error are skipped; callers add those items to
    the denominator through ``task_errors``. Repeat runs also read the pass
    rows of items with a scorer error (``apply_repeat_pass_errors``).
    """
    from qym_platform.db.models import Run, RunItem, RunItemScore

    run_ids = list(run_ids)
    if not run_ids:
        return {}
    task_ok = (
        (RunItem.run_id == RunItemScore.run_id)
        & (RunItem.item_id == RunItemScore.item_id)
        & RunItem.error.is_(None)
    )
    totals: Dict[str, Dict[str, MetricTotals]] = {}
    for run_id, metric, score_sum, score_count in (
        db.query(
            RunItemScore.run_id,
            RunItemScore.metric_name,
            func.sum(RunItemScore.score_numeric),
            func.count(RunItemScore.score_numeric),
        )
        .join(RunItem, task_ok)
        .filter(RunItemScore.run_id.in_(run_ids))
        .group_by(RunItemScore.run_id, RunItemScore.metric_name)
    ):
        totals.setdefault(run_id, {})[metric] = MetricTotals(
            score_sum=float(score_sum or 0.0), score_count=int(score_count or 0)
        )
    for run_id, metric, score, status in (
        db.query(
            RunItemScore.run_id,
            RunItemScore.metric_name,
            RunItemScore.score_numeric,
            RunItemScore.meta["status"].as_string(),
        )
        .join(RunItem, task_ok)
        .filter(
            RunItemScore.run_id.in_(run_ids),
            metric_error_candidates(RunItemScore),
        )
        .yield_per(1000)
    ):
        if not is_metric_error({"status": status}):
            continue
        metric_totals = totals.setdefault(run_id, {}).setdefault(metric, MetricTotals())
        if score is None:
            metric_totals.unscored_errors += 1
        else:
            metric_totals.error_score_sum += float(score)
            metric_totals.error_score_count += 1
    repeat_ids = [
        row[0]
        for row in db.query(Run.id).filter(Run.id.in_(run_ids), Run.samples > 1)
    ]
    for run_id in repeat_ids:
        apply_repeat_pass_errors(
            totals.setdefault(run_id, {}), _repeat_pass_errors(db, run_id)
        )
    return totals


def _repeat_pass_errors(db, run_id):
    """``apply_repeat_pass_errors`` input for one repeat run, from source rows."""
    from qym_platform.db.models import RunItem, RunItemPassScore, RunItemScore

    task_ok = (
        (RunItem.run_id == RunItemPassScore.run_id)
        & (RunItem.item_id == RunItemPassScore.item_id)
        & RunItem.error.is_(None)
    )
    affected = set()
    for item_id, metric, status in (
        db.query(
            RunItemPassScore.item_id,
            RunItemPassScore.metric_name,
            RunItemPassScore.meta["status"].as_string(),
        )
        .join(RunItem, task_ok)
        .filter(
            RunItemPassScore.run_id == run_id,
            metric_error_candidates(RunItemPassScore),
        )
    ):
        if is_metric_error({"status": status}):
            affected.add((item_id, metric))
    if not affected:
        return []
    item_ids = sorted({item_id for item_id, _ in affected})
    passes: Dict[tuple, list] = {}
    values: Dict[tuple, Optional[float]] = {}
    for start in range(0, len(item_ids), 400):
        chunk = item_ids[start : start + 400]
        for item_id, metric, score, meta in db.query(
            RunItemPassScore.item_id,
            RunItemPassScore.metric_name,
            RunItemPassScore.score_numeric,
            RunItemPassScore.meta,
        ).filter(
            RunItemPassScore.run_id == run_id, RunItemPassScore.item_id.in_(chunk)
        ):
            if (item_id, metric) in affected:
                passes.setdefault((item_id, metric), []).append(
                    (score, is_metric_error(meta))
                )
        for item_id, metric, score in db.query(
            RunItemScore.item_id, RunItemScore.metric_name, RunItemScore.score_numeric
        ).filter(RunItemScore.run_id == run_id, RunItemScore.item_id.in_(chunk)):
            if (item_id, metric) in affected:
                values[(item_id, metric)] = score
    return [
        (metric, values.get((item_id, metric)), passes.get((item_id, metric), []))
        for item_id, metric in sorted(affected)
    ]
