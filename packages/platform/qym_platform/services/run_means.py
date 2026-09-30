"""One rule for a run's metric mean, shared by every view.

Higher-is-better metrics, and metrics that declare no direction, count errors
as 0 (C015):

- a task error scores every metric of that item as 0;
- a metric (scorer) error scores that metric as 0. Most SDKs already store 0
  for it; older SDKs and imports store no score, and those still count as 0.

Lower-is-better metrics (declared ``direction="minimize"``) leave errors out
instead, because 0 is their best value: task errors and scorer errors are not
counted in the mean, and views show how many there were next to it. In
pass/fail verdicts an errored item or pass is a failure for these metrics.

A repeat run (samples > 1) judges task errors per pass. Each item is the mean
over its passes, where a pass whose task or scorer failed counts as 0, or is
left out when lower is better (so the item is the mean over its passes
without an error). Its RunItem holds only the pass that arrived last, so it
never makes the whole item a task error: the same passes give the same mean
whichever of them failed last.

Items that are still running or were never scored are left out, and so are
the items of a completed run whose outcome never reached the platform
(``item_not_received``).

The run page applies the same rule in ``metrics.js`` (``getRowScore``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple

from sqlalchemy import Text, and_, cast, func, or_

from qym_platform.services.metric_semantics import declared_direction

METRIC_ERROR_STATUSES = ("error", "failed", "timeout")
# Ingest stores 0 for every metric of a repeat-run pass whose task failed and
# labels those scores "error" (api/ingest.py).
TASK_ERROR_PASS_LABEL = "error"
# ...and marks them with this metadata key, which also covers a pass whose
# metric was scored before the task failed (a cancel mid-scoring): the
# scorer's metadata stays on the row but no longer reads as a scored pass.
TASK_ERROR_PASS_MARKER = "task_error"
# A reviewer's item-level score on a repeat run (update_metric without a
# pass): the item keeps that value in every mean instead of being re-derived
# from its passes, until a pass changes and the item is reduced again.
ITEM_EDIT_KEY = "item_edit"
# Pass metadata keys that do not come from a scorer or a reviewer: the
# status, the label, and a pass diagnosis (root_cause_changes
# PASS_ANALYSIS_META_KEY).
_NOT_SCORE_METADATA = frozenset({"status", "label", "root_cause_analysis"})


def mean_task_errors(samples: Any, task_errors: Any) -> int:
    """Item-level task errors a run mean adds to its denominator.

    A classic run adds every item whose task failed (as 0, or left out when
    lower is better). A repeat run adds none: its item values already hold
    each failed pass (ingest stores it as 0, marked as a failed task), and its
    RunItem error is only the outcome of the pass that arrived last.
    """
    return int(task_errors or 0) if int(samples or 1) <= 1 else 0


# A completed run, also while it is in review (its data stays as it completed).
COMPLETED_RUN_STATUSES = ("COMPLETED", "SUBMITTED", "APPROVED", "REJECTED")


def item_not_received(
    run_status: Any, samples: Any, error: Any, output: Any, latency_ms: Any
) -> bool:
    """A classic item of a completed run whose outcome never reached the platform.

    item_completed always carries a latency and item_failed an error, so an
    item with neither, and no output, only started: the platform rejected (or
    never got) its outcome, and ingest had no final attempt to take it from.
    It shows as not received and is left out of Execution success and of the
    means; it is neither a success nor a task error. Items of a run still in
    progress, stopped or failed are not judged, and a repeat run's items are
    judged per pass. ``not_received_clause`` is the same rule in SQL, and
    ``metrics.js`` (``isNotReceivedRow``) reads the row state it produces.
    """
    status = str(getattr(run_status, "value", run_status) or "").upper()
    return (
        status in COMPLETED_RUN_STATUSES
        and int(samples or 1) <= 1
        and error is None
        and output is None
        and latency_ms is None
    )


def not_received_clause(item_model, run_model):
    """``item_not_received`` in SQL, for item rows joined to their run."""
    from qym_platform.db.models import RunWorkflowStatus

    return and_(
        run_model.status.in_(
            [RunWorkflowStatus(status) for status in COMPLETED_RUN_STATUSES]
        ),
        func.coalesce(run_model.samples, 1) <= 1,
        item_model.error.is_(None),
        item_model.latency_ms.is_(None),
        # An output set to None is stored as JSON null, not SQL NULL.
        or_(item_model.output.is_(None), cast(item_model.output, Text) == "null"),
    )


def not_received_items(db, run_ids) -> Dict[str, set]:
    """Item ids of each classic run that were never received (``item_not_received``)."""
    from qym_platform.db.models import Run, RunItem

    run_ids = list(run_ids)
    found: Dict[str, set] = {}
    for start in range(0, len(run_ids), 400):
        for run_id, item_id in (
            db.query(RunItem.run_id, RunItem.item_id)
            .join(Run, Run.id == RunItem.run_id)
            .filter(
                RunItem.run_id.in_(run_ids[start : start + 400]),
                not_received_clause(RunItem, Run),
            )
        ):
            found.setdefault(run_id, set()).add(item_id)
    return found


def errors_left_out(direction: Optional[str]) -> bool:
    """Whether a metric leaves errors out of its mean instead of counting 0.

    0 is the best value of a lower-is-better metric, so counting an error as
    0 would reward it: those metrics leave errors out. Every other metric
    counts them as 0.
    """
    return direction == "minimize"


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


def is_item_edit(meta: Any) -> bool:
    """Whether a repeat item's stored value is a reviewer's (``ITEM_EDIT_KEY``)."""
    return isinstance(meta, dict) and str(meta.get(ITEM_EDIT_KEY) or "").lower() == "true"


def task_error_pass_meta(meta: Any) -> Dict[str, Any]:
    """Metadata ingest stores on a pass score it zero-fills for a failed task."""
    marked = dict(meta) if isinstance(meta, dict) else {}
    marked[TASK_ERROR_PASS_MARKER] = True
    return marked


def is_task_error_pass(label: Any, meta: Any) -> bool:
    """Return whether a repeat-run pass score stands for a failed task.

    Ingest stores 0 with the label "error" for every metric of a pass whose
    task failed, marked with ``TASK_ERROR_PASS_MARKER``. A scorer error keeps
    its own status and is not a task error; a reviewer's edit ("modified")
    replaces it. The run page applies the same rule in ``metrics.js``
    (``isTaskErrorPass``).
    """
    if str(label or "").strip().lower() != TASK_ERROR_PASS_LABEL or is_metric_error(meta):
        return False
    if not isinstance(meta, dict):
        return True
    if str(meta.get("modified") or "").strip().lower() == "true":
        return False
    if meta.get(TASK_ERROR_PASS_MARKER) is True:
        return True
    # Unmarked rows (stored before the marker): ingest's zero-fill carried no
    # metadata, while a scorer's own "error" label comes with its metadata. A
    # pass diagnosis is stored beside the score and says nothing about it
    # (the run payload moves it out of the pass metadata).
    return not any(
        value not in (None, "")
        for key, value in meta.items()
        if key not in _NOT_SCORE_METADATA
    )


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


def reduce_pass_scores(
    passes: Iterable[Any], direction: Optional[str] = None
) -> Tuple[Optional[float], int]:
    """An item's value in a repeat run: the mean over its passes.

    ``passes`` are rows with ``score_numeric``, ``meta`` and ``label``. A
    scored pass counts at its value and a pass not scored yet is left out. A
    pass whose scorer or task failed counts as 0, or is left out for a
    lower-is-better metric (``errors_left_out``). Returns the mean (None when
    no pass counts) and how many passes counted.
    """
    if errors_left_out(direction):
        values = [
            float(row.score_numeric)
            for row in passes
            if row.score_numeric is not None
            and not is_metric_error(row.meta)
            and not is_task_error_pass(getattr(row, "label", None), row.meta)
        ]
    else:
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


def task_error_pass_candidates(model):
    """SQL prefilter for pass scores ingest stored for a failed task.

    Confirm each candidate with :func:`is_task_error_pass`.
    """
    return func.lower(func.trim(model.label)) == TASK_ERROR_PASS_LABEL


@dataclass
class MetricTotals:
    """Score totals for one metric of one run: over the items without a task
    error in a classic run, over every item in a repeat run."""

    score_sum: float = 0.0
    score_count: int = 0
    # Scorer errors that still stored a numeric score (normally 0).
    error_score_sum: float = 0.0
    error_score_count: int = 0
    # Scorer errors with no stored score.
    unscored_errors: int = 0
    # Scores ingest stored for a failed task (pass rows, read by per-pass
    # means). They are part of ``score_sum``.
    task_error_score_sum: float = 0.0
    task_error_score_count: int = 0
    # Repeat runs keep scorer errors on pass rows: each item row holds the
    # mean over its passes. ``pass_errors`` counts errored passes (the unit of
    # ``metric_error_counts``); ``scored_sum``/``scored_count`` are the totals
    # with each affected item re-reduced over its passes that did not error.
    pass_errors: int = 0
    scored_sum: Optional[float] = None
    scored_count: int = 0
    # The same re-reduction without the passes whose task failed either: the
    # mean of a lower-is-better metric (``errors_left_out``).
    clean_sum: Optional[float] = None
    clean_count: int = 0
    # The metric's declared direction (``declared_direction``); it selects
    # how errors enter the mean.
    direction: Optional[str] = None

    @property
    def metric_errors(self) -> int:
        return self.error_score_count + self.unscored_errors + self.pass_errors


def _mean_and_count(
    totals: MetricTotals, task_errors: int
) -> Tuple[Optional[float], int]:
    if errors_left_out(totals.direction):
        if totals.clean_sum is not None:
            total, count = totals.clean_sum, totals.clean_count
        else:
            total = (
                totals.score_sum - totals.error_score_sum - totals.task_error_score_sum
            )
            count = (
                totals.score_count
                - totals.error_score_count
                - totals.task_error_score_count
            )
        return (total / count if count > 0 else None), max(count, 0)
    count = totals.score_count + totals.unscored_errors + task_errors
    return (totals.score_sum / count if count else None), count


def run_metric_mean(totals: MetricTotals, task_errors: int) -> Optional[float]:
    """The run mean: task and scorer errors count as 0, or are left out for a
    lower-is-better metric (``errors_left_out``)."""
    return _mean_and_count(totals, task_errors)[0]


def run_metric_count(totals: MetricTotals, task_errors: int) -> int:
    """How many items (passes, for per-pass totals) the run mean covers."""
    return _mean_and_count(totals, task_errors)[1]


def mean_without_metric_errors(
    totals: MetricTotals, task_errors: int
) -> Optional[float]:
    """The same mean with scorer errors left out; task errors still count as 0.

    A lower-is-better metric leaves every error out of its mean already.
    """
    if errors_left_out(totals.direction):
        return run_metric_mean(totals, task_errors)
    if totals.scored_sum is not None:
        denominator = totals.scored_count + task_errors
        return totals.scored_sum / denominator if denominator > 0 else None
    denominator = totals.score_count - totals.error_score_count + task_errors
    if denominator <= 0:
        return None
    return (totals.score_sum - totals.error_score_sum) / denominator


def apply_repeat_pass_errors(
    totals: Dict[str, "MetricTotals"],
    affected: Iterable[Tuple[str, Optional[float], Iterable[Tuple[Any, ...]]]],
) -> None:
    """Add a repeat run's pass-level errors to its metric totals.

    ``affected`` yields ``(metric, item_value, passes)`` or ``(metric,
    item_value, passes, item_edited)`` for every item that has at least one
    errored pass, whichever pass arrived last; ``item_value`` is the item's stored
    mean over passes and ``passes`` its ``(score, scorer_error)`` or ``(score,
    scorer_error, task_error)`` tuples. The mean without scorer errors
    re-reduces each such item over its passes whose scorer did not fail (a
    failed task still counts as 0); the mean of a lower-is-better metric
    re-reduces it over its passes without any error. An item with no such
    pass drops out of that mean. The run mean of other metrics is unchanged:
    errored passes already count as 0 in the item value. An item a reviewer
    scored as a whole (``item_edited``) keeps that value in every mean.
    """
    for entry in affected:
        metric, item_value, passes = entry[:3]
        item_edited = len(entry) > 3 and bool(entry[3])
        passes = [
            (entry[0], bool(entry[1]), len(entry) > 2 and bool(entry[2]))
            for entry in passes
        ]
        metric_totals = totals.setdefault(metric, MetricTotals())
        if metric_totals.scored_sum is None:
            metric_totals.scored_sum = (
                metric_totals.score_sum - metric_totals.error_score_sum
            )
            metric_totals.scored_count = (
                metric_totals.score_count - metric_totals.error_score_count
            )
            metric_totals.clean_sum = metric_totals.scored_sum
            metric_totals.clean_count = metric_totals.scored_count
        metric_totals.pass_errors += sum(1 for _, scorer, _ in passes if scorer)
        if item_edited:
            continue
        if item_value is not None:
            metric_totals.scored_sum -= float(item_value)
            metric_totals.scored_count -= 1
            metric_totals.clean_sum -= float(item_value)
            metric_totals.clean_count -= 1
        scored = [
            0.0 if score is None else float(score)
            for score, scorer, task in passes
            if not scorer and (task or score is not None)
        ]
        if scored:
            metric_totals.scored_sum += sum(scored) / len(scored)
            metric_totals.scored_count += 1
        clean = [
            float(score)
            for score, scorer, task in passes
            if not scorer and not task and score is not None
        ]
        if clean:
            metric_totals.clean_sum += sum(clean) / len(clean)
            metric_totals.clean_count += 1


def metric_mean_fields(
    metrics: Iterable[str],
    totals: Dict[str, MetricTotals],
    task_errors: int,
    directions: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Published fields for each metric: the run mean, and the mean without
    scorer errors.

    ``directions`` maps metrics to their declared direction (default: the
    direction on their totals). ``metric_scored_averages`` is present only
    for metrics that count scorer errors as 0 and had some, so the UI can
    explain how far the errors moved the mean. A lower-is-better metric
    leaves errors out of its mean already; when every item errored it has no
    mean and is left out of ``metric_averages`` (0 would read as its best).
    """
    averages: Dict[str, Any] = {}
    scored: Dict[str, Any] = {}
    for metric in metrics:
        metric_totals = totals.get(metric) or MetricTotals()
        if directions is not None:
            metric_totals.direction = directions.get(metric)
        mean = run_metric_mean(metric_totals, task_errors)
        if errors_left_out(metric_totals.direction):
            if mean is not None:
                averages[metric] = mean
            continue
        averages[metric] = mean if mean is not None else 0.0
        if metric_totals.metric_errors:
            scored[metric] = mean_without_metric_errors(metric_totals, task_errors)
    return {"metric_averages": averages, "metric_scored_averages": scored}


def metric_directions(db, run_ids) -> Dict[str, Dict[str, Optional[str]]]:
    """Per-run, per-metric declared direction (``declared_direction``)."""
    from qym_platform.db.models import RunMetricSpec

    run_ids = list(run_ids)
    directions: Dict[str, Dict[str, Optional[str]]] = {}
    if not run_ids:
        return directions
    for spec in db.query(RunMetricSpec).filter(RunMetricSpec.run_id.in_(run_ids)):
        directions.setdefault(spec.run_id, {})[spec.metric_name] = declared_direction(
            spec
        )
    return directions


def raw_metric_totals(
    db, run_ids, *, scored_averages: bool = True
) -> Dict[str, Dict[str, MetricTotals]]:
    """Per-run, per-metric totals from ``RunItemScore`` rows.

    In classic runs, rows on items with a task error are skipped; callers add
    those items to the denominator through ``task_errors``
    (``mean_task_errors``). Items never received are skipped too. Repeat runs
    count every item's value, which holds its failed passes, and also read the
    pass rows of items with an errored pass (``apply_repeat_pass_errors``).
    Every metric with a spec carries its declared direction.

    ``scored_averages=False`` is for callers that need only the run mean
    (``run_metric_mean``): repeat runs then read pass rows only for their
    lower-is-better metrics, whose mean re-reduces items without errors.
    """
    from qym_platform.db.models import Run, RunItem, RunItemScore

    run_ids = list(run_ids)
    if not run_ids:
        return {}
    item_join = (RunItem.run_id == RunItemScore.run_id) & (
        RunItem.item_id == RunItemScore.item_id
    )
    counted = and_(
        # A repeat run's RunItem error is only its last pass's outcome.
        or_(Run.samples > 1, RunItem.error.is_(None)),
        ~not_received_clause(RunItem, Run),
    )
    totals: Dict[str, Dict[str, MetricTotals]] = {}
    for run_id, metric, score_sum, score_count in (
        db.query(
            RunItemScore.run_id,
            RunItemScore.metric_name,
            func.sum(RunItemScore.score_numeric),
            func.count(RunItemScore.score_numeric),
        )
        .join(RunItem, item_join)
        .join(Run, Run.id == RunItem.run_id)
        .filter(RunItemScore.run_id.in_(run_ids), counted)
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
        .join(RunItem, item_join)
        .join(Run, Run.id == RunItem.run_id)
        .filter(
            RunItemScore.run_id.in_(run_ids),
            counted,
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
    directions = metric_directions(db, run_ids)
    for run_id, by_metric in directions.items():
        for metric, direction in by_metric.items():
            totals.setdefault(run_id, {}).setdefault(
                metric, MetricTotals()
            ).direction = direction
    repeat_ids = [
        row[0]
        for row in db.query(Run.id).filter(Run.id.in_(run_ids), Run.samples > 1)
    ]
    left_out_by_run = {}
    for run_id in repeat_ids:
        left_out = {
            metric
            for metric, direction in (directions.get(run_id) or {}).items()
            if errors_left_out(direction)
        }
        if scored_averages or left_out:
            left_out_by_run[run_id] = left_out
    affected_by_run = _repeat_pass_errors(
        db, left_out_by_run, all_metrics=scored_averages
    )
    for run_id, affected in affected_by_run.items():
        apply_repeat_pass_errors(totals.setdefault(run_id, {}), affected)
    return totals


def _repeat_pass_errors(db, left_out_by_run, *, all_metrics=True):
    """``apply_repeat_pass_errors`` input per repeat run, from source rows.

    ``left_out_by_run`` maps each repeat run to its lower-is-better metrics.
    Items with a scorer-error pass, and, for those metrics, items with a pass
    whose task failed, whichever pass arrived last. With ``all_metrics=False``
    only the lower-is-better metrics are read. One query finds the candidates
    of every run; only runs with an affected item read their pass rows.
    """
    from qym_platform.db.models import RunItemPassScore

    run_ids = sorted(left_out_by_run)
    if not run_ids:
        return {}
    any_left_out = sorted(set().union(*left_out_by_run.values()))
    candidates = metric_error_candidates(RunItemPassScore)
    if not all_metrics:
        candidates = and_(RunItemPassScore.metric_name.in_(any_left_out), candidates)
    if any_left_out:
        candidates = or_(
            candidates,
            and_(
                RunItemPassScore.metric_name.in_(any_left_out),
                task_error_pass_candidates(RunItemPassScore),
            ),
        )
    affected_by_run: Dict[str, set] = {}
    for start in range(0, len(run_ids), 400):
        for run_id, item_id, metric, status, label in (
            db.query(
                RunItemPassScore.run_id,
                RunItemPassScore.item_id,
                RunItemPassScore.metric_name,
                RunItemPassScore.meta["status"].as_string(),
                RunItemPassScore.label,
            ).filter(
                RunItemPassScore.run_id.in_(run_ids[start : start + 400]), candidates
            )
        ):
            meta = {"status": status}
            left_out = left_out_by_run.get(run_id) or set()
            if (is_metric_error(meta) and (all_metrics or metric in left_out)) or (
                metric in left_out and is_task_error_pass(label, meta)
            ):
                affected_by_run.setdefault(run_id, set()).add((item_id, metric))
    return {
        run_id: _repeat_pass_outcomes(db, run_id, affected)
        for run_id, affected in affected_by_run.items()
    }


def _repeat_pass_outcomes(db, run_id, affected):
    """Passes and stored item values of one run's affected (item, metric)s."""
    from qym_platform.db.models import RunItemPassScore, RunItemScore

    item_ids = sorted({item_id for item_id, _ in affected})
    passes: Dict[tuple, list] = {}
    values: Dict[tuple, Optional[float]] = {}
    edited = set()
    for start in range(0, len(item_ids), 400):
        chunk = item_ids[start : start + 400]
        for item_id, metric, score, meta, label in db.query(
            RunItemPassScore.item_id,
            RunItemPassScore.metric_name,
            RunItemPassScore.score_numeric,
            RunItemPassScore.meta,
            RunItemPassScore.label,
        ).filter(
            RunItemPassScore.run_id == run_id, RunItemPassScore.item_id.in_(chunk)
        ):
            if (item_id, metric) in affected:
                passes.setdefault((item_id, metric), []).append(
                    (score, is_metric_error(meta), is_task_error_pass(label, meta))
                )
        for item_id, metric, score, item_edit in db.query(
            RunItemScore.item_id,
            RunItemScore.metric_name,
            RunItemScore.score_numeric,
            RunItemScore.meta[ITEM_EDIT_KEY].as_string(),
        ).filter(RunItemScore.run_id == run_id, RunItemScore.item_id.in_(chunk)):
            if (item_id, metric) in affected:
                values[(item_id, metric)] = score
                if is_item_edit({ITEM_EDIT_KEY: item_edit}):
                    edited.add((item_id, metric))
    return [
        (
            metric,
            values.get((item_id, metric)),
            passes.get((item_id, metric), []),
            (item_id, metric) in edited,
        )
        for item_id, metric in sorted(affected)
    ]


def errored_pass_items(db, run_ids, metrics=None) -> set:
    """``(run_id, item_id, metric)`` of repeat items with an errored pass.

    A pass whose scorer or task failed. Item-level verdicts of a
    lower-is-better metric treat such an item as errored (never a pass),
    like ``metrics.js`` ``getRowScore``. ``metrics`` limits the metrics read.
    """
    from qym_platform.db.models import RunItemPassScore

    run_ids = list(run_ids)
    if not run_ids or (metrics is not None and not metrics):
        return set()
    query = db.query(
        RunItemPassScore.run_id,
        RunItemPassScore.item_id,
        RunItemPassScore.metric_name,
        RunItemPassScore.meta,
        RunItemPassScore.label,
    ).filter(
        RunItemPassScore.run_id.in_(run_ids),
        or_(
            metric_error_candidates(RunItemPassScore),
            task_error_pass_candidates(RunItemPassScore),
        ),
    )
    if metrics is not None:
        query = query.filter(RunItemPassScore.metric_name.in_(sorted(metrics)))
    errored = set()
    for run_id, item_id, metric, meta, label in query:
        if is_metric_error(meta) or is_task_error_pass(label, meta):
            errored.add((run_id, item_id, metric))
    if errored:
        # An item a reviewer scored as a whole is judged by that score.
        from qym_platform.db.models import RunItemScore

        keys = sorted(errored)
        for start in range(0, len(keys), 400):
            chunk = keys[start : start + 400]
            for run_id, item_id, metric, item_edit in db.query(
                RunItemScore.run_id,
                RunItemScore.item_id,
                RunItemScore.metric_name,
                RunItemScore.meta[ITEM_EDIT_KEY].as_string(),
            ).filter(
                RunItemScore.run_id.in_({key[0] for key in chunk}),
                RunItemScore.item_id.in_({key[1] for key in chunk}),
                RunItemScore.meta[ITEM_EDIT_KEY].as_string().isnot(None),
            ):
                if is_item_edit({ITEM_EDIT_KEY: item_edit}):
                    errored.discard((run_id, item_id, metric))
    return errored


def pass_metric_totals(db, run_ids) -> Dict[str, Dict[Tuple[int, str], MetricTotals]]:
    """Per-run totals of each pass's mean per metric (repeat runs).

    Every pass row counts, whatever the item's latest task outcome: a pass
    whose scorer or task failed counts as 0, or is left out for a
    lower-is-better metric (``run_metric_mean`` with no task errors).
    """
    from qym_platform.db.models import RunItemPassScore

    run_ids = list(run_ids)
    if not run_ids:
        return {}
    totals: Dict[str, Dict[Tuple[int, str], MetricTotals]] = {}
    for run_id, pass_number, metric, score_sum, score_count in (
        db.query(
            RunItemPassScore.run_id,
            RunItemPassScore.pass_number,
            RunItemPassScore.metric_name,
            func.sum(RunItemPassScore.score_numeric),
            func.count(RunItemPassScore.score_numeric),
        )
        .filter(RunItemPassScore.run_id.in_(run_ids))
        .group_by(
            RunItemPassScore.run_id,
            RunItemPassScore.pass_number,
            RunItemPassScore.metric_name,
        )
    ):
        totals.setdefault(run_id, {})[(int(pass_number), metric)] = MetricTotals(
            score_sum=float(score_sum or 0.0), score_count=int(score_count or 0)
        )
    for run_id, pass_number, metric, score, meta, label in (
        db.query(
            RunItemPassScore.run_id,
            RunItemPassScore.pass_number,
            RunItemPassScore.metric_name,
            RunItemPassScore.score_numeric,
            RunItemPassScore.meta,
            RunItemPassScore.label,
        )
        .filter(
            RunItemPassScore.run_id.in_(run_ids),
            or_(
                metric_error_candidates(RunItemPassScore),
                task_error_pass_candidates(RunItemPassScore),
            ),
        )
        .yield_per(1000)
    ):
        metric_totals = totals.setdefault(run_id, {}).setdefault(
            (int(pass_number), metric), MetricTotals()
        )
        if is_metric_error(meta):
            if score is None:
                metric_totals.unscored_errors += 1
            else:
                metric_totals.error_score_sum += float(score)
                metric_totals.error_score_count += 1
        elif is_task_error_pass(label, meta) and score is not None:
            metric_totals.task_error_score_sum += float(score)
            metric_totals.task_error_score_count += 1
    directions = metric_directions(db, run_ids)
    for run_id, by_key in totals.items():
        for (_, metric), metric_totals in by_key.items():
            metric_totals.direction = (directions.get(run_id) or {}).get(metric)
    return totals
