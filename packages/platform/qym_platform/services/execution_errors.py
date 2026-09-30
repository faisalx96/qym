"""Shared shape for task-execution and metric-check error counts."""

from collections import Counter, defaultdict
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple


def error_breakdown(
    task_counts: Mapping[int, int],
    metric_counts: Mapping[int, Mapping[str, int]],
) -> Dict[str, Any]:
    """Keep whole-run and per-pass counts in the same units."""
    totals: Counter = Counter()
    passes = {}
    for number in sorted(task_counts.keys() | metric_counts.keys()):
        metrics = dict(metric_counts.get(number, {}))
        totals.update(metrics)
        passes[number] = {
            "task_error_count": task_counts.get(number, 0),
            "metric_error_count": sum(metrics.values()),
            "metric_error_counts": metrics,
        }
    return {
        "task_error_count": sum(task_counts.values()),
        "metric_error_count": sum(totals.values()),
        "metric_error_counts": dict(totals),
        "pass_error_counts": passes,
    }


def repeat_execution_counts(
    db, run_ids: List[str], *, prefer_published: bool = False
) -> Dict[str, Dict[str, int]]:
    """Execution success units of repeat runs from source rows, by run id.

    A repeat run keeps one RunItem per item, overwritten by whichever pass
    arrived last, so execution success counts item passes instead. Each item
    pass with attempt evidence counts once: attempt rows (SDKs that run
    repeats send a final attempt for every pass, and ingest also records one
    from item_completed), and the legacy item events that carry a failure or
    retries (the evidence the dashboard projection keeps as attempt records).
    It failed when it has a task error: its last attempt failed, or the SDK
    reported item_failed for it (the executions task_error_count counts), so
    a retried pass is judged by its last attempt. A pass still running counts
    like an unfinished item of a classic run: not failed.

    The dashboard projection publishes the same numbers. ``prefer_published``
    reads them for runs whose publication is current (multi-run views) and
    scans source rows only for the rest.
    """
    from sqlalchemy import and_, or_

    from qym_platform.db.models import RunEvent, RunItemAttempt
    from qym_platform.services.dashboard_outbox import (
        execution_event_numbers,
        execution_event_query,
    )
    from qym_platform.services.run_means import METRIC_ERROR_STATUSES

    if not run_ids:
        return {}
    counts: Dict[str, Dict[str, int]] = {}
    if prefer_published:
        from qym_platform.db.dashboard_models import DashboardPartitionState
        from qym_platform.db.dashboard_models import DashboardRunSummary as Summary

        executions = Summary.data["execution_count"].as_integer()
        successes = Summary.data["execution_success_count"].as_integer()
        for run_id, total, success in (
            db.query(Summary.run_key, executions, successes)
            .join(
                DashboardPartitionState,
                DashboardPartitionState.partition_key == Summary.run_key,
            )
            .filter(
                Summary.run_key.in_(run_ids),
                Summary.projection_revision > 0,
                # Every source change is applied: the counts match source rows.
                DashboardPartitionState.queue_state == "ready",
                executions.isnot(None),
                successes.isnot(None),
            )
        ):
            counts[run_id] = {
                "execution_count": int(total),
                "execution_success_count": int(success),
            }
        run_ids = [run_id for run_id in run_ids if run_id not in counts]
        if not run_ids:
            return counts
    passes: Dict[str, Set[Tuple[str, int]]] = defaultdict(set)
    failed: Dict[str, Set[Tuple[str, int]]] = defaultdict(set)
    attempts = db.query(
        RunItemAttempt.run_id,
        RunItemAttempt.item_id,
        RunItemAttempt.pass_number,
        RunItemAttempt.is_last_attempt,
        RunItemAttempt.status,
    ).filter(RunItemAttempt.run_id.in_(run_ids))
    for run_id, item_id, pass_number, is_last, status in attempts.yield_per(1000):
        key = (str(item_id), max(1, int(pass_number or 1)))
        passes[run_id].add(key)
        if is_last and str(status or "").strip().lower() in METRIC_ERROR_STATUSES:
            failed[run_id].add(key)
    # Legacy SDKs can report an item pass only through its events. Only a
    # failure or a retry makes an event evidence; filter the bulk of
    # item_completed/attempt events out in SQL (a superset: JSON numbers can
    # come back as integers, and the numbers are checked again below).
    retry = RunEvent.payload["retry_count"].as_string()
    attempt = RunEvent.payload["attempt_number"].as_string()
    events = execution_event_query().where(
        RunEvent.run_id.in_(run_ids),
        or_(
            RunEvent.type == "item_failed",
            and_(retry.isnot(None), retry.notin_(("", "0"))),
            and_(attempt.isnot(None), attempt.notin_(("", "0", "1"))),
        ),
    )
    for row in db.execute(events.execution_options(yield_per=1000)):
        numbers = execution_event_numbers(
            row.type,
            {
                key: getattr(row, key)
                for key in ("item_id", "pass_number", "retry_count", "attempt_number")
            },
        )
        if not numbers["item_id"] or not (numbers["error"] or numbers["retry_count"]):
            continue
        key = (numbers["item_id"], numbers["pass_number"])
        passes[row.run_id].add(key)
        if numbers["error"]:
            failed[row.run_id].add(key)
    for run_id, pairs in passes.items():
        counts[run_id] = {
            "execution_count": len(pairs),
            "execution_success_count": len(pairs - failed[run_id]),
        }
    return counts


def execution_success_fields(
    total_items: int, success_count: int, repeat: Optional[Mapping[str, int]] = None
) -> Dict[str, Any]:
    """Execution success of one run: per item, or per item pass when repeated.

    ``repeat`` is a ``repeat_execution_counts`` entry; a repeat run without
    any pass evidence keeps its item counts.
    """
    executions, successes = total_items, success_count
    if repeat and repeat.get("execution_count"):
        executions = repeat["execution_count"]
        successes = repeat["execution_success_count"]
    return {
        "execution_count": executions,
        "execution_success_count": successes,
        "success_rate": (successes / executions) if executions else 0.0,
    }
