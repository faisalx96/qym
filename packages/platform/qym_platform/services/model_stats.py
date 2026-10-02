"""K-run statistics for the Models view and Charts groups, on the server (C035).

The Models comparison and the Charts "Grouped" columns used to download every
selected run's per-item vectors (``GET /api/models/runs``) and reduce them in
the browser. This module performs the same reduction next to the data, so a
view receives a few hundred bytes per model instead of every item.

The rules are ``metrics.js``'s, row for row (``calculateItemLevelMetrics``,
``getRowScore``, ``rowMetricErrorCounts``, ``rowMetricPasses``) and
``dashboard.js``'s ``expandSampledRunsData``, applied to the rows
``api.runs._build_models_runs_data`` builds. Those rows are item level: a
repeat run ships only the passes of its errored items (``pass_scores_scope``
"errored"), so a repeat run counts as one of the K runs, as before. A run
whose rows carry every pass (other payloads) pools its passes as K entries.
``tests/platform/test_model_stats.py`` checks the port against ``metrics.js``.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

METRIC_ERROR_STATUSES = ("error", "failed", "timeout")


def parse_score_value(value: Any) -> Optional[float]:
    """``metrics.js`` ``parseScoreValue``."""
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    raw = str(value).strip()
    if not raw:
        return None
    lowered = raw.lower()
    if lowered in ("n/a", "na", "none", "null"):
        return None
    if raw == "✓" or lowered in ("true", "yes", "y"):
        return 1.0
    if raw == "✗" or lowered in ("false", "no", "n"):
        return 0.0
    if raw.endswith("%"):
        pct = _parse_float_prefix(raw[:-1].strip())
        if pct is not None:
            return pct / 100
    return _parse_float_prefix(raw)


def _parse_float_prefix(text: str) -> Optional[float]:
    """JavaScript ``parseFloat``: the longest leading decimal number."""
    match = re.match(
        r"\s*([+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))", text
    )
    if not match:
        return None
    return float(match.group(1).replace("Infinity", "inf"))


def _is_metric_error_meta(meta: Any) -> bool:
    if not isinstance(meta, dict):
        return False
    return str(meta.get("status") or "").strip().lower() in METRIC_ERROR_STATUSES


def _is_task_error_row(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    return str(row.get("status") or "").lower() in ("error", "failed")


def _is_not_received(row: Any) -> bool:
    return (
        isinstance(row, dict) and str(row.get("status") or "").lower() == "not_received"
    )


def _is_repeat_aggregate_row(row: Dict[str, Any]) -> bool:
    # An empty pass_scores object still marks a repeat row (as in JavaScript).
    return row.get("__pass_scope") is not True and isinstance(
        row.get("pass_scores"), dict
    )


def _is_reviewed_pass_slice(row: Dict[str, Any], metric: str) -> bool:
    """A row scoped to one pass whose failed task a reviewer then scored."""
    if row.get("__pass_scope") is not True:
        return False
    meta = (row.get("metric_meta") or {}).get(metric)
    return isinstance(meta, dict) and str(meta.get("modified") or "").lower() == "true"


def _has_metric_error(row: Dict[str, Any], metric: str) -> bool:
    aggregate = (
        row.get("metric_meta") if isinstance(row.get("metric_meta"), dict) else {}
    )
    passes = (
        row.get("pass_metric_meta")
        if isinstance(row.get("pass_metric_meta"), dict)
        else {}
    )
    per_pass = passes.get(metric)
    if isinstance(per_pass, list) and any(_is_metric_error_meta(m) for m in per_pass):
        return True
    return _is_metric_error_meta(aggregate.get(metric))


def _is_task_error_pass(row: Dict[str, Any], metric: str, index: int) -> bool:
    metas = (row.get("pass_metric_meta") or {}).get(metric)
    meta = metas[index] if isinstance(metas, list) and index < len(metas) else None
    if _is_metric_error_meta(meta):
        return False
    if isinstance(meta, dict):
        if str(meta.get("modified") or "").lower() == "true":
            return False
        if str(meta.get("label") or "").strip().lower() == "error":
            if meta.get("task_error") is True:
                return True
            others = [
                key
                for key, value in meta.items()
                if key not in ("label", "status") and value not in (None, "")
            ]
            if not others:
                return True
    attempts = row.get("pass_attempts")
    attempt = (
        attempts[index]
        if isinstance(attempts, list) and index < len(attempts)
        else None
    )
    return bool(attempt) and _is_task_error_row(attempt)


def _repeat_pass_outcomes(row: Dict[str, Any], metric: str):
    scores = (
        (row.get("pass_scores") or {}).get(metric)
        if isinstance(row.get("pass_scores"), dict)
        else None
    )
    if not isinstance(scores, list):
        return None
    if not isinstance(row.get("pass_metric_meta"), dict):
        return None
    metas = row["pass_metric_meta"].get(metric)
    outcomes = []
    for index, raw in enumerate(scores):
        meta = metas[index] if isinstance(metas, list) and index < len(metas) else None
        scorer_error = _is_metric_error_meta(meta)
        outcomes.append(
            {
                "value": parse_score_value(raw),
                "scorer": scorer_error,
                "task": not scorer_error and _is_task_error_pass(row, metric, index),
            }
        )
    return outcomes


def row_score(row: Dict[str, Any], index: int, metric: str, direction: Optional[str]):
    """``metrics.js`` ``getRowScore``: ``(score, is_error)``."""
    if not row or _is_not_received(row):
        return None, False
    left_out = direction == "minimize"
    if (
        _is_task_error_row(row)
        and not _is_repeat_aggregate_row(row)
        and not _is_reviewed_pass_slice(row, metric)
    ):
        return (None if left_out else 0.0), True
    meta = (row.get("metric_meta") or {}).get(metric)
    values = row.get("metric_values") or []
    if isinstance(meta, dict) and str(meta.get("item_edit") or "").lower() == "true":
        return parse_score_value(values[index] if index < len(values) else None), False
    if left_out:
        passes = _repeat_pass_outcomes(row, metric)
        if passes and any(p["scorer"] or p["task"] for p in passes):
            kept = [
                p["value"]
                for p in passes
                if not (p["scorer"] or p["task"]) and p["value"] is not None
            ]
            return (sum(kept) / len(kept) if kept else None), True
        if _has_metric_error(row, metric):
            return None, True
    metric_error = _has_metric_error(row, metric)
    score = parse_score_value(values[index] if index < len(values) else None)
    if score is None:
        return (0.0, True) if metric_error else (None, False)
    return score, metric_error


def row_error_count(row: Dict[str, Any], metric: str) -> int:
    """Task plus scorer errors of ``metrics.js`` ``rowMetricErrorCounts``."""
    if _is_not_received(row):
        return 0
    passes = _repeat_pass_outcomes(row, metric)
    repeat = _is_repeat_aggregate_row(row)
    if passes is not None:
        task = sum(1 for p in passes if p["task"])
        scorer = sum(1 for p in passes if p["scorer"])
        if task or scorer or repeat:
            return task + scorer
    if repeat:
        return int(_is_task_error_row(row)) + int(_has_metric_error(row, metric))
    if _is_task_error_row(row):
        return 0 if _is_reviewed_pass_slice(row, metric) else 1
    return int(_has_metric_error(row, metric))


def _metric_passes(score, threshold, direction, is_boolean) -> Optional[bool]:
    if direction not in ("maximize", "minimize") or score is None:
        return None
    if not math.isfinite(score):
        return None
    if is_boolean:
        return score <= 0.0001 if direction == "minimize" else score >= 0.9999
    return score <= threshold if direction == "minimize" else score >= threshold


def _passes(score, is_error, threshold, direction, is_boolean) -> bool:
    if direction not in ("maximize", "minimize"):
        return False
    if is_error and direction == "minimize":
        return False
    return _metric_passes(score, threshold, direction, is_boolean) is True


def _median(values: List[float]) -> float:
    ordered = sorted(v for v in values if math.isfinite(v))
    if not ordered:
        return 0.0
    mid = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2
    return ordered[mid]


def _item_id(row: Dict[str, Any]) -> str:
    return row.get("item_id") or str(row.get("index"))


def expand_sampled_runs(runs_data: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """``dashboard.js`` ``expandSampledRunsData``: one entry per pass of a
    repeat run whose rows carry pass scores, each row scoped to that pass.

    A run whose errored items alone carry passes (``pass_scores_scope``
    "errored", the Models payload) stays one entry. So does a run whose rows
    hold no pass scores at all: an empty ``pass_scores`` object (a repeat item
    a reviewer scored as a whole) is not pass data.
    """
    out: List[Dict[str, Any]] = []
    for data in runs_data or []:
        run = (data or {}).get("run") or {}
        snapshot = (data or {}).get("snapshot") or {}
        try:
            samples = int(run.get("samples") or 1)
        except (TypeError, ValueError):
            samples = 1
        rows = snapshot.get("rows") or []
        has_passes = (
            samples > 1
            and snapshot.get("pass_scores_scope") != "errored"
            and any(row and row.get("pass_scores") for row in rows)
        )
        if not has_passes:
            out.append(data)
            continue
        names = list(snapshot.get("metric_names") or run.get("metric_names") or [])
        for number in range(samples):
            pass_rows = []
            for row in rows:
                values = row.get("metric_values") or []
                pass_scores = row.get("pass_scores") or {}
                scoped_values = []
                for index, name in enumerate(names):
                    scores = (
                        pass_scores.get(name) if isinstance(pass_scores, dict) else None
                    )
                    if isinstance(scores, list):
                        value = scores[number] if number < len(scores) else None
                        scoped_values.append("" if value is None else value)
                    else:
                        scoped_values.append(
                            values[index] if index < len(values) else None
                        )
                attempts = row.get("pass_attempts")
                attempt = (
                    attempts[number]
                    if isinstance(attempts, list) and number < len(attempts)
                    else None
                )
                failed = (bool(attempt) and _is_task_error_row(attempt)) or any(
                    _is_task_error_pass(row, name, number) for name in names
                )
                scoped = {
                    "metric_values": scoped_values,
                    "status": (
                        "error"
                        if failed
                        else (
                            "completed"
                            if _is_task_error_row(row)
                            else row.get("status")
                        )
                    ),
                    "__pass_scope": True,
                }
                if not row.get("pass_metric_meta"):
                    pass_rows.append({**row, **scoped})
                    continue
                meta = {}
                for name in names:
                    metas = row["pass_metric_meta"].get(name)
                    value = (
                        metas[number]
                        if isinstance(metas, list) and number < len(metas)
                        else None
                    )
                    if isinstance(value, dict):
                        meta[name] = value
                pass_rows.append(
                    {**row, **scoped, "metric_meta": meta, "pass_metric_meta": None}
                )
            out.append({"run": run, "snapshot": {**snapshot, "rows": pass_rows}})
    return out


def _empty_stats() -> Dict[str, Any]:
    return {
        "passAtK": 0,
        "passHatK": 0,
        "maxAtK": 0,
        "consistency": 0,
        "reliability": 0,
        "avgScore": 0,
        "avgLatency": 0,
        "medianLatency": 0,
        "totalItems": 0,
        "failedCount": 0,
        "K": 0,
        "correctDistribution": [0],
        "runNames": [],
        "minScore": 0,
        "stddevScore": 0,
        "totalScoreSum": 0,
        "totalScoreCount": 0,
    }


def compact_run(
    data: Dict[str, Any], metric: str, direction: Optional[str]
) -> List[Dict[str, Any]]:
    """One selected run as the K entries it contributes (a repeat run whose
    rows carry every pass contributes one per pass), each reduced to what the
    statistics read: per item ``(score, is_error, error_count, latency)``.

    The item rows themselves are not kept, so a large selection is read a
    chunk of runs at a time (``group_stats_for_runs``).
    """
    entries = []
    for entry in expand_sampled_runs([data]):
        snapshot = (entry or {}).get("snapshot") or {}
        rows = snapshot.get("rows") or []
        names = list(snapshot.get("metric_names") or [])
        metric_index = names.index(metric) if metric in names else -1
        order: List[str] = []
        seen = set()
        outcomes: Dict[str, tuple] = {}
        for row in rows:
            key = _item_id(row)
            if key in seen:
                continue  # the first row of an item counts, as before
            seen.add(key)
            order.append(key)
            if metric_index < 0:
                continue
            score, is_error = row_score(row, metric_index, metric, direction)
            latency = row.get("latency_ms")
            outcomes[key] = (
                score,
                is_error,
                row_error_count(row, metric),
                (
                    float(latency)
                    if isinstance(latency, (int, float))
                    and not isinstance(latency, bool)
                    and latency > 0
                    else None
                ),
            )
        entries.append({"order": order, "outcomes": outcomes, "rows": bool(rows)})
    return entries


def k_run_stats(
    runs_data: Sequence[Dict[str, Any]],
    metric: str,
    threshold: float,
    is_boolean: bool,
    direction: Optional[str],
) -> Dict[str, Any]:
    """One group's statistics: Models' ``calculateModelStatsFromItems``.

    ``runs_data`` are ``_build_models_runs_data`` entries, in selection order.
    """
    return stats_from_compact(
        [
            (
                ((data or {}).get("run") or {}).get("run_name"),
                compact_run(data, metric, direction),
            )
            for data in runs_data or []
        ],
        threshold,
        is_boolean,
        direction,
    )


def stats_from_compact(
    runs: Sequence[tuple],
    threshold: float,
    is_boolean: bool,
    direction: Optional[str],
) -> Dict[str, Any]:
    """``k_run_stats`` over ``(run_name, compact_run(...))`` pairs."""
    if not runs:
        return _empty_stats()
    run_names = [name or "Run %d" % (index + 1) for index, (name, _) in enumerate(runs)]
    # Repeat runs with every pass pool their passes: a xk run is k entries.
    entries = [entry for _, compact in runs for entry in compact]
    k = len(entries)
    effective = 0.9999 if is_boolean else float(threshold)
    distribution = [0] * (k + 1)
    result: Dict[str, Any] = {
        "passAtK": 0,
        "passHatK": 0,
        "maxAtK": 0,
        "consistency": None,
        "reliability": None,
        "avgScore": 0,
        "avgLatency": 0,
        "medianLatency": 0,
        "totalItems": 0,
        "failedCount": 0,
        "K": k,
        "totalScoreSum": 0,
        "totalScoreCount": 0,
        "minScore": 0,
        "stddevScore": 0,
    }
    if any(entry["rows"] for entry in entries):
        _reduce(entries, effective, is_boolean, direction, result, distribution)
    no_score = result["totalScoreCount"] == 0 and direction == "minimize"
    result["correctDistribution"] = distribution
    result["runNames"] = run_names
    if no_score:
        result["maxAtK"] = result["avgScore"] = result["minScore"] = None
    return result


def _reduce(entries, threshold, is_boolean, direction, result, distribution):
    item_ids: Dict[str, None] = {}
    for entry in entries:
        for key in entry["order"]:
            item_ids.setdefault(key, None)

    pass_at = pass_hat = items_with_data = items_best = 0
    multi = with_pass = 0
    consistency_sum = reliability_sum = max_sum = 0.0
    score_sum = 0.0
    scores_all: List[float] = []
    latency_sum = 0.0
    latencies: List[float] = []
    failed = 0
    for item_id in item_ids:
        outcomes = []
        for entry in entries:
            outcome = entry["outcomes"].get(item_id)
            if outcome is None:
                continue
            score, is_error, errors, latency = outcome
            if score is not None or is_error:
                outcomes.append((score, is_error))
            failed += errors
            if score is not None:
                score_sum += score
                scores_all.append(score)
            if latency is not None:
                latency_sum += latency
                latencies.append(latency)
        if not outcomes:
            continue
        items_with_data += 1
        scores = [score for score, _ in outcomes if score is not None]
        correct = sum(
            1
            for score, is_error in outcomes
            if _passes(score, is_error, threshold, direction, is_boolean)
        )
        distribution[correct] += 1
        if scores:
            max_sum += min(scores) if direction == "minimize" else max(scores)
            items_best += 1
        if correct > 0:
            pass_at += 1
        if correct == len(outcomes):
            pass_hat += 1
        if len(outcomes) > 1:
            agreement = max(correct, len(outcomes) - correct)
            consistency_sum += 2 * agreement / len(outcomes) - 1
            multi += 1
            if correct > 0:
                reliability_sum += correct / len(outcomes)
                with_pass += 1

    result["totalItems"] = items_with_data
    result["failedCount"] = failed
    result["passAtK"] = pass_at / items_with_data if items_with_data else 0
    result["passHatK"] = pass_hat / items_with_data if items_with_data else 0
    result["maxAtK"] = max_sum / items_best if items_best else 0
    result["consistency"] = consistency_sum / multi if multi else None
    result["reliability"] = reliability_sum / with_pass if with_pass else None
    count = len(scores_all)
    result["avgScore"] = score_sum / count if count else 0
    result["avgLatency"] = latency_sum / len(latencies) if latencies else 0
    result["medianLatency"] = _median(latencies) if latencies else 0
    result["totalScoreSum"] = score_sum
    result["totalScoreCount"] = count
    result["minScore"] = min(scores_all) if scores_all else 0
    if count > 1:
        mean = score_sum / count
        result["stddevScore"] = math.sqrt(
            sum((s - mean) ** 2 for s in scores_all) / count
        )


def group_stats(
    runs_data: Iterable[Dict[str, Any]],
    groups: Sequence[Dict[str, Any]],
    metric: str,
    threshold: float,
    is_boolean: bool,
    direction: Optional[str],
) -> Dict[str, Dict[str, Any]]:
    """Statistics per group: ``{group key: k_run_stats}``."""
    compact = {}
    for data in runs_data or []:
        run = (data or {}).get("run") or {}
        compact[run.get("run_id")] = (
            run.get("run_name"),
            compact_run(data, metric, direction),
        )
    return _group_results(compact, groups, threshold, is_boolean, direction)


def _group_results(compact, groups, threshold, is_boolean, direction):
    return {
        group["key"]: stats_from_compact(
            [compact[run_id] for run_id in group["runs"] if run_id in compact],
            threshold,
            is_boolean,
            direction,
        )
        for group in groups
    }


# Runs whose item rows are built at once: a large selection never holds every
# run's rows in memory together (the browser used to fetch 100 at a time).
RUNS_PER_CHUNK = 100


def group_stats_for_runs(
    build_rows: Callable[[List[Any]], List[Dict[str, Any]]],
    runs: Sequence[Any],
    groups: Sequence[Dict[str, Any]],
    metric: str,
    threshold: float,
    is_boolean: bool,
    direction: Optional[str],
) -> Dict[str, Dict[str, Any]]:
    """``group_stats`` over ``runs`` (ORM runs), reading their item rows
    ``RUNS_PER_CHUNK`` runs at a time with ``build_rows`` and keeping only each
    run's compact outcomes."""
    compact: Dict[Any, tuple] = {}
    for start in range(0, len(runs), RUNS_PER_CHUNK):
        for data in build_rows(list(runs[start : start + RUNS_PER_CHUNK])):
            run = (data or {}).get("run") or {}
            compact[run.get("run_id")] = (
                run.get("run_name"),
                compact_run(data, metric, direction),
            )
    return _group_results(compact, groups, threshold, is_boolean, direction)
