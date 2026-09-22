"""Shared shape for task-execution and metric-check error counts."""

from collections import Counter
from typing import Any, Dict, Mapping


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
