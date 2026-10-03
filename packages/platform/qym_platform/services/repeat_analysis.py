"""Canonical repeat-performance curves and persistent uncertainty cache."""

from __future__ import annotations

import hashlib
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from qym.core.reducers import mean_ci, unbiased_pass_at_k, unbiased_pass_hat_k
from qym_platform.db.models import RunMetricAnalysis


CONFIDENCE = 0.95
BOOTSTRAP_ITERATIONS = 2000
MIN_UNCERTAINTY_ITEMS = 20
# 2: an errored pass never passes, also where its 0 meets a threshold of 0
# or below. Curves cached by version 1 are recomputed.
METHOD_VERSION = 2


# ``(item_id, pass_number, score, errored)``. An errored pass (its scorer or
# task failed) never passes; its score is the 0 it counts as, or None for a
# lower-is-better metric, which leaves it out of averages
# (services/run_means.py).
ScoreRow = Tuple[str, int, Optional[float], bool]


def score_signature(rows: Iterable[ScoreRow]) -> str:
    """Stable digest used to invalidate cached curves after score edits."""

    digest = hashlib.sha256()
    for item_id, pass_number, score, errored in rows:
        digest.update(str(item_id).encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(int(pass_number)).encode("ascii"))
        digest.update(b"\0")
        digest.update(b"none" if score is None else float(score).hex().encode("ascii"))
        digest.update(b"\0error" if errored else b"")
        digest.update(b"\n")
    return digest.hexdigest()


def _interval(values: Sequence[float], *, seed: int) -> Dict[str, float] | None:
    if len(values) < MIN_UNCERTAINTY_ITEMS:
        return None
    result = mean_ci(
        values,
        confidence=CONFIDENCE,
        iterations=BOOTSTRAP_ITERATIONS,
        seed=seed,
    )
    return {"low": result["ci_low"], "high": result["ci_high"]}


def build_repeat_analysis(
    items_scores: Dict[str, List[Optional[float]]],
    *,
    threshold: float,
    samples: int,
    direction: str = "maximize",
    eligible: Optional[Mapping[str, Sequence[bool]]] = None,
) -> Dict[str, Any]:
    """Build Pass@k, Pass^k, and cumulative-average curves with item CIs.

    A lower-is-better metric (``direction="minimize"``) passes at or below
    the threshold. A None score (an errored pass) never passes and is left
    out of the cumulative average. ``eligible`` maps an item to one flag per
    score; a ``False`` pass (an errored pass counted as 0) never passes.
    """

    def passes(score: Optional[float], ok: bool) -> bool:
        if score is None or not ok:
            return False
        return score <= threshold if direction == "minimize" else score >= threshold

    def correct_count(item_id: str, scores: Sequence[Optional[float]]) -> int:
        flags = eligible.get(item_id) if eligible is not None else None
        if flags is None:
            flags = [True] * len(scores)
        elif len(flags) != len(scores):
            raise ValueError("eligible needs one flag per score")
        return sum(1 for score, ok in zip(scores, flags) if passes(score, ok))

    max_k = max((len(scores) for scores in items_scores.values()), default=0)
    band: Dict[int, Dict[str, Any]] = {}
    for k in range(1, max_k + 1):
        in_band = [
            (item_id, scores)
            for item_id, scores in items_scores.items()
            if len(scores) >= k
        ]
        pass_at_values: List[float] = []
        pass_hat_values: List[float] = []
        cumulative_values: List[float] = []
        for item_id, scores in in_band:
            correct = correct_count(item_id, scores)
            pass_at_values.append(unbiased_pass_at_k(len(scores), correct, k))
            pass_hat_values.append(unbiased_pass_hat_k(len(scores), correct, k))
            scored = [score for score in scores[:k] if score is not None]
            if scored:
                cumulative_values.append(sum(scored) / len(scored))

        def average(values: Sequence[float]) -> float:
            return sum(values) / len(values) if values else 0.0

        seed = 1777 + k * 97
        band[k] = {
            "pass_at_k": average(pass_at_values),
            "pass_hat_k": average(pass_hat_values),
            # No scored pass among the first k (every one errored, for a
            # lower-is-better metric): no average. 0 would read as its best.
            "cumulative_avg": average(cumulative_values) if cumulative_values else None,
            "n_items": len(in_band),
            "uncertainty": {
                "pass_at_k": _interval(pass_at_values, seed=seed),
                "pass_hat_k": _interval(pass_hat_values, seed=seed),
                "cumulative_avg": _interval(cumulative_values, seed=seed),
            },
        }

    distribution = [0] * (samples + 1)
    for item_id, scores in items_scores.items():
        distribution[min(correct_count(item_id, scores), samples)] += 1

    return {
        "band": band,
        "distribution": distribution,
        "confidence": CONFIDENCE,
        "bootstrap_iterations": BOOTSTRAP_ITERATIONS,
        "minimum_uncertainty_items": MIN_UNCERTAINTY_ITEMS,
        "method": "item_bootstrap",
        "method_version": METHOD_VERSION,
    }


def cached_repeat_analysis(
    db: Session,
    *,
    run_id: str,
    metric_name: str,
    threshold: float,
    samples: int,
    rows: Sequence[ScoreRow],
    items_scores: Dict[str, List[Optional[float]]],
    eligible: Optional[Mapping[str, Sequence[bool]]] = None,
    direction: str = "maximize",
) -> Dict[str, Any]:
    """Return a persisted curve, recomputing only when its score digest changes."""

    threshold_micros = round(float(threshold) * 1_000_000)
    signature = score_signature(rows)
    if direction == "minimize":
        # A run's direction is fixed; folding it into the digest keeps
        # curves cached before directions existed valid for "maximize".
        # ":2": curves cached before a k with no scored pass had no average
        # (they stored 0.0 there) are recomputed.
        signature = hashlib.sha256((signature + ":minimize:2").encode("ascii")).hexdigest()
    cached = (
        db.query(RunMetricAnalysis)
        .filter(
            RunMetricAnalysis.run_id == run_id,
            RunMetricAnalysis.metric_name == metric_name,
            RunMetricAnalysis.threshold_micros == threshold_micros,
            RunMetricAnalysis.method_version == METHOD_VERSION,
        )
        .first()
    )
    if cached and cached.source_signature == signature:
        payload = dict(cached.payload or {})
        payload["band"] = {
            int(k): value for k, value in (payload.get("band") or {}).items()
        }
        return payload

    payload = build_repeat_analysis(
        items_scores,
        threshold=threshold,
        samples=samples,
        direction=direction,
        eligible=eligible,
    )
    if cached:
        cached.source_signature = signature
        cached.payload = payload
    else:
        db.add(
            RunMetricAnalysis(
                run_id=run_id,
                metric_name=metric_name,
                threshold_micros=threshold_micros,
                method_version=METHOD_VERSION,
                source_signature=signature,
                payload=payload,
            )
        )
    db.commit()
    return payload
