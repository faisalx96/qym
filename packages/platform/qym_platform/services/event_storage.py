"""Storage policy for ingested events and spans.

Spans are persisted once, in ``spans``. ``run_events`` is the run's structural
history: which item/pass/attempt started, finished or scored, and when. Bodies
(inputs, outputs, judge explanations) already live in ``run_items``,
``run_item_attempts``, ``run_item_scores`` and ``run_item_pass_scores``; in
``structural`` mode they are dropped from the event log instead of being stored
a third time.

The span ceiling is a safety valve, not a trimming policy: a span above
``QYM_SPAN_MAX_BYTES`` keeps its scalar attributes (kind, scope, model, token
counts) and is flagged so a single runaway payload cannot wedge ingest or fill
the disk.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, Optional

from qym_platform.settings import PlatformSettings

# Body keys per event type that are redundant with the normalized tables.
_BODY_KEYS: Dict[str, tuple] = {
    "item_started": ("input", "expected", "item_metadata"),
    "item_completed": ("output", "item_metadata", "task_metadata"),
    "item_attempt_finished": ("output",),
    "metric_scored": ("score_raw", "meta", "explanation", "score_value"),
}

STRIPPED_MARKER = "qym.body_stripped"
OVERSIZED_MARKER = "qym.span_oversized"
OVERSIZED_BYTES = "qym.span_original_bytes"
_SCALAR_ATTR_MAX_CHARS = 256


@lru_cache(maxsize=1)
def ingest_settings() -> PlatformSettings:
    """Settings snapshot for the ingest hot path (one .env read per process)."""
    return PlatformSettings()


def structural_event_payload(event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return ``payload`` without redundant bodies; unchanged for other types."""
    keys = _BODY_KEYS.get(event_type)
    if not keys or not isinstance(payload, dict):
        return payload
    stripped = {k: v for k, v in payload.items() if k not in keys}
    if len(stripped) != len(payload):
        stripped[STRIPPED_MARKER] = True
    return stripped


def oversized_span_attributes(attributes: Dict[str, Any], original_bytes: int) -> Dict[str, Any]:
    """Keep only short scalar attributes of a span that exceeded the ceiling."""
    kept: Dict[str, Any] = {}
    for key, value in (attributes or {}).items():
        if isinstance(value, bool) or isinstance(value, (int, float)):
            kept[key] = value
        elif isinstance(value, str) and len(value) <= _SCALAR_ATTR_MAX_CHARS:
            kept[key] = value
    kept[OVERSIZED_MARKER] = True
    kept[OVERSIZED_BYTES] = int(original_bytes)
    return kept


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(float(value)) if value is not None else None
    except (TypeError, ValueError):
        return None


def span_columns_from_attributes(attributes: Dict[str, Any]) -> Dict[str, Any]:
    """Scalar columns promoted out of ``attributes`` so hot paths avoid the JSON."""
    attrs = attributes or {}
    kind = str(attrs.get("openinference.span.kind") or attrs.get("ai.openinference.span.kind") or "").upper() or None
    scope = str(attrs.get("qym.usage_scope") or "").lower() or None
    prompt = _int_or_none(attrs.get("llm.token_count.prompt"))
    completion = _int_or_none(attrs.get("llm.token_count.completion"))
    total = _int_or_none(attrs.get("llm.token_count.total") or attrs.get("gen_ai.usage.total_tokens"))
    if total is None and (prompt is not None or completion is not None):
        total = (prompt or 0) + (completion or 0)
    return {
        "oi_kind": kind[:20] if kind else None,
        "usage_scope": scope[:20] if scope else None,
        "model_name": (str(attrs.get("llm.model_name") or "")[:200] or None),
        "tool_name": (str(attrs.get("tool.name") or "")[:200] or None),
        "token_total": total,
        "token_prompt": prompt,
        "token_completion": completion,
    }
