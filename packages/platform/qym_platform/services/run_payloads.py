"""Compact analytical rows and bounded hydration request validation.

The compact index preserves global numeric/category semantics. Text bodies and
judge metadata are loaded for opened items, or searched on the server, rather
than downloaded for every item during initial navigation.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import HTTPException

MAX_DETAIL_ITEMS = 100
MAX_SEARCH_CONDITIONS = 32
# Index rows keep metric metadata values no longer than this. Judge output
# (explanation, llm_result, gold_results, ...) is served by /items/details.
# run_details.js applies the same rule when it releases a hydrated row.
COMPACT_META_TEXT_LIMIT = 200
# Error flags drive task/metric error filters and buckets for every item, so
# they stay in the index at full length; so does a score's edit record
# (``last_edit``, a small dict) that the Edited badge explains.
_COMPACT_META_ALWAYS_KEPT = frozenset({"error", "status", "last_edit"})
INPUT_PREVIEW_CHARS = 300

MetaKeyIndex = Dict[str, Dict[str, Set[str]]]


def text_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def text_preview(value: str) -> str:
    """One-line prefix of a body, as the collapsed item title shows it."""
    return " ".join(value[: INPUT_PREVIEW_CHARS * 4].split())[:INPUT_PREVIEW_CHARS]


def compact_attempt(attempt: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(attempt)
    output = result.pop("output", None)
    result["__has_output"] = output is not None
    result["__execution_error"] = output if result.get("status") == "error" else ""
    result["output_digest"] = text_digest(str(output or ""))
    return result


def new_meta_key_index() -> MetaKeyIndex:
    return {
        "metric_meta_keys": {},
        "pass_metric_meta_keys": {},
        # By pass number: a single-pass view offers only that pass's keys.
        "pass_metric_meta_keys_by_pass": {},
    }


def meta_key_schema(index: MetaKeyIndex) -> Dict[str, Dict[str, List[str]]]:
    """Every metadata key seen per metric (or pass), for the metric-field chooser."""
    return {
        field: {metric: sorted(keys) for metric, keys in sorted(by_metric.items())}
        for field, by_metric in index.items()
    }


def _keep_index_meta_value(key: str, value: Any) -> bool:
    if key in _COMPACT_META_ALWAYS_KEPT:
        return True
    if key == "explanation":
        return False
    if value is None or isinstance(value, (bool, int, float)):
        return True
    return isinstance(value, str) and len(value) <= COMPACT_META_TEXT_LIMIT


def _compact_metric_meta(metadata: Any, *key_sets: Set[str]) -> Any:
    if not isinstance(metadata, dict):
        return metadata
    for keys in key_sets:
        keys.update(metadata)
    # Keep error/status and short scalar flags (label, modified, original
    # score, ...); drop explanations and large judge payloads.
    return {
        key: value
        for key, value in metadata.items()
        if _keep_index_meta_value(key, value)
    }


def compact_row(
    row: Dict[str, Any], meta_keys: Optional[MetaKeyIndex] = None
) -> Dict[str, Any]:
    """Index form of a UI row; ``meta_keys`` collects the dropped key names."""
    result = dict(row)
    output = result.get("output_full") or result.get("output")
    result["__has_output"] = output is not None
    result["__execution_error"] = output if result.get("status") == "error" else ""
    result["output_digest"] = text_digest(str(output or ""))
    result["input_preview"] = text_preview(
        str(result.get("input_full") or result.get("input") or "")
    )
    for field in (
        "input",
        "input_full",
        "expected",
        "expected_full",
        "output",
        "output_full",
    ):
        result.pop(field, None)
    result["__details_loaded"] = False
    keys = meta_keys if meta_keys is not None else new_meta_key_index()
    row_keys, pass_keys = keys["metric_meta_keys"], keys["pass_metric_meta_keys"]
    result["metric_meta"] = {
        metric: _compact_metric_meta(meta, row_keys.setdefault(metric, set()))
        for metric, meta in (result.get("metric_meta") or {}).items()
    }
    if result.get("pass_metric_meta"):
        by_pass = keys["pass_metric_meta_keys_by_pass"]
        result["pass_metric_meta"] = {
            metric: [
                _compact_metric_meta(
                    meta,
                    pass_keys.setdefault(metric, set()),
                    by_pass.setdefault(str(number), set()),
                )
                for number, meta in enumerate(values, start=1)
            ]
            for metric, values in result["pass_metric_meta"].items()
        }
    if result.get("pass_attempts"):
        result["pass_attempts"] = [
            compact_attempt(attempt) if attempt else None
            for attempt in result["pass_attempts"]
        ]
    return result


def detail_item_ids(payload: Dict[str, Any]) -> List[str]:
    values = payload.get("item_ids")
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_DETAIL_ITEMS:
        raise HTTPException(422, f"item_ids must contain 1 to {MAX_DETAIL_ITEMS} IDs")
    if any(
        not isinstance(value, str) or not value or len(value) > 200 for value in values
    ):
        raise HTTPException(
            422, "Each item ID must be a non-empty string of at most 200 characters"
        )
    return list(dict.fromkeys(values))


def search_conditions(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    values = payload.get("conditions")
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_SEARCH_CONDITIONS:
        raise HTTPException(
            422, f"conditions must contain 1 to {MAX_SEARCH_CONDITIONS} entries"
        )
    result = []
    seen = set()
    for value in values:
        if not isinstance(value, dict):
            raise HTTPException(422, "Each search condition must be an object")
        ident, field, term = value.get("id"), value.get("field"), value.get("value")
        operator = value.get("operator", "contains")
        if not isinstance(ident, str) or not ident or len(ident) > 200 or ident in seen:
            raise HTTPException(
                422, "Search condition IDs must be unique non-empty strings"
            )
        if field not in {"all", "content", "output"} or operator != "contains":
            raise HTTPException(
                422, "Supported search fields are all/content/output with contains"
            )
        if not isinstance(term, str) or len(term) > 10000:
            raise HTTPException(
                422, "Search values must be strings of at most 10000 characters"
            )
        seen.add(ident)
        result.append({"id": ident, "field": field, "value": term.lower()})
    return result


# Failure reasons (C065): the run page's item list shows why a failing row
# failed. The index drops explanations and long reasons, so the visible page
# asks for just these fields instead of hydrating whole items.
REASON_FIELDS = ("reason", "error", "status", "explanation", "label")
REASON_TEXT_LIMIT = 2000


def reason_request(payload: Dict[str, Any]) -> Tuple[List[str], str, Optional[int]]:
    """Validate a reasons request: item IDs, one metric, an optional pass."""
    ids = detail_item_ids(payload)
    metric = payload.get("metric")
    if not isinstance(metric, str) or not metric or len(metric) > 200:
        raise HTTPException(
            422, "metric must be a non-empty string of at most 200 characters"
        )
    pass_number = payload.get("pass_number")
    if pass_number is not None and (type(pass_number) is not int or pass_number < 1):
        raise HTTPException(422, "pass_number must be a positive integer")
    return ids, metric, pass_number


def reason_fields(meta: Any) -> Dict[str, str]:
    """The reason-bearing fields of one metric's metadata, as bounded text."""
    if not isinstance(meta, dict):
        return {}
    result = {}
    for key in REASON_FIELDS:
        value = meta.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, str):
            text = value
        else:
            text = json.dumps(value, ensure_ascii=False, default=str)
        result[key] = text[:REASON_TEXT_LIMIT]
    return result


# Per-pass series of a row: one entry per pass, by position.
_PASS_SERIES_FIELDS = ("pass_scores", "pass_metric_meta", "pass_metric_analyses")


def scope_row_to_pass(row: Dict[str, Any], pass_number: int) -> Dict[str, Any]:
    """Keep only one pass of a row's per-pass series.

    Positions stay (the other passes become null), so a reader that picks
    ``values[pass_number - 1]`` reads the same value as from the full row.
    The analyzer of one sample needs nothing from the other passes.
    """
    keep = pass_number - 1

    def one_pass(values: Any) -> Any:
        if not isinstance(values, list):
            return values
        return [value if index == keep else None for index, value in enumerate(values)]

    for field in _PASS_SERIES_FIELDS:
        series = row.get(field)
        if isinstance(series, dict):
            row[field] = {metric: one_pass(values) for metric, values in series.items()}
    attempts = row.get("pass_attempts")
    if isinstance(attempts, list):
        row["pass_attempts"] = [
            (
                attempt
                if isinstance(attempt, dict)
                and (
                    attempt.get("pass_number") == pass_number
                    or (attempt.get("pass_number") is None and index == keep)
                )
                else None
            )
            for index, attempt in enumerate(attempts)
        ]
    return row
