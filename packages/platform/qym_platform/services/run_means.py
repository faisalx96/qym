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
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import Text, cast, func, or_

METRIC_ERROR_STATUSES = ("error", "failed", "timeout")


def is_metric_error(meta: Any) -> bool:
    """Return whether metric metadata represents a raised scorer error."""
    if not isinstance(meta, dict):
        return False
    status = str(meta.get("status") or "").strip().lower()
    if status in METRIC_ERROR_STATUSES:
        return True
    error = meta.get("error")
    if isinstance(error, str):
        return bool(error.strip())
    return bool(error)


def metric_error_candidates(model):
    """SQL prefilter for score rows whose metadata may hold a scorer error.

    Confirm each candidate with :func:`is_metric_error`.
    """
    return or_(
        func.lower(func.trim(cast(model.meta["status"].as_string(), Text))).in_(
            METRIC_ERROR_STATUSES
        ),
        model.meta["error"].as_string().isnot(None),
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

    @property
    def metric_errors(self) -> int:
        return self.error_score_count + self.unscored_errors


def run_metric_mean(totals: MetricTotals, task_errors: int) -> Optional[float]:
    """Mean with every task and scorer error counted as 0."""
    denominator = totals.score_count + totals.unscored_errors + task_errors
    return totals.score_sum / denominator if denominator else None


def mean_without_metric_errors(
    totals: MetricTotals, task_errors: int
) -> Optional[float]:
    """The same mean with scorer errors left out; task errors still count as 0."""
    denominator = totals.score_count - totals.error_score_count + task_errors
    if denominator <= 0:
        return None
    return (totals.score_sum - totals.error_score_sum) / denominator


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
    the denominator through ``task_errors``.
    """
    from qym_platform.db.models import RunItem, RunItemScore

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
    for run_id, metric, score, status, error in (
        db.query(
            RunItemScore.run_id,
            RunItemScore.metric_name,
            RunItemScore.score_numeric,
            RunItemScore.meta["status"].as_string(),
            RunItemScore.meta["error"],
        )
        .join(RunItem, task_ok)
        .filter(
            RunItemScore.run_id.in_(run_ids),
            metric_error_candidates(RunItemScore),
        )
        .yield_per(1000)
    ):
        if not is_metric_error({"status": status, "error": error}):
            continue
        metric_totals = totals.setdefault(run_id, {}).setdefault(metric, MetricTotals())
        if score is None:
            metric_totals.unscored_errors += 1
        else:
            metric_totals.error_score_sum += float(score)
            metric_totals.error_score_count += 1
    return totals
