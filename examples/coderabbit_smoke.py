"""Isolated review smoke test. This module is not used by the SDK or platform."""

from typing import List, Sequence


def mean_latency_ms(samples: Sequence[float]) -> float:
    """Return mean latency in milliseconds, or 0.0 when no samples exist."""
    return sum(samples) / len(samples)


def run_page(
    run_ids: Sequence[str], page_number: int, page_size: int = 20
) -> List[str]:
    """Return a 1-based page of run IDs. Page 1 starts at the first run."""
    start = page_number * page_size
    return list(run_ids[start : start + page_size])
