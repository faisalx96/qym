"""Validate a manual metric score edit against the metric's type (C009).

The run page applies the same rules before it sends an edit
(``metrics.js`` ``parseMetricScoreInput``); the server is the authority and
never stores a score that is not a finite number.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional, Tuple

from qym_platform.services.model_stats import parse_score_value

# Plain decimal notation only: no thousands separators, comma decimals, hex,
# or Python-only forms such as "1_000", "nan" and "inf".
_NUMBER = re.compile(r"^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$")
_TRUE = {"true", "yes"}
_FALSE = {"false", "no"}

HINTS = {
    "boolean": "Enter true or false (1 or 0).",
    "percentage": "Enter a value from 0 to 1, or 0% to 100%.",
    "count": "Enter a whole number, 0 or more.",
    "number": "Enter a number.",
    "legacy": "Enter a number.",
}


class ScoreEditError(ValueError):
    """A score edit the metric cannot store; the message is shown inline."""


def edit_kind(score_type: Optional[str]) -> str:
    """The validation rule for a spec ``score_type`` (no spec: any number)."""
    return score_type if score_type in HINTS else "legacy"


def reduced_score_type(score_type: Optional[str]) -> Optional[str]:
    """Score type of a repeat-run item value, the mean over its passes.

    A mean of booleans is a rate and a mean of counts can be fractional.
    """
    return {"boolean": "percentage", "count": "number"}.get(score_type or "", score_type)


def parse_score_edit(value: Any, score_type: Optional[str]) -> float:
    """Return the numeric score for ``value`` or raise :class:`ScoreEditError`."""
    kind = edit_kind(score_type)
    hint = HINTS[kind]
    boolean_words = kind in ("boolean", "legacy")
    if isinstance(value, bool):
        if not boolean_words:
            raise ScoreEditError(hint)
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise ScoreEditError("Enter a score. " + hint)
        lowered = text.lower()
        if boolean_words and lowered in _TRUE:
            return 1.0
        if boolean_words and lowered in _FALSE:
            return 0.0
        percent = text.endswith("%")
        if percent:
            if kind not in ("percentage", "legacy"):
                raise ScoreEditError(hint)
            text = text[:-1].strip()
        if re.fullmatch(r"[+-]?[0-9]+,[0-9]+", text):
            raise ScoreEditError("Use a dot for decimals (0.7, not 0,7).")
        if not _NUMBER.match(text):
            raise ScoreEditError(hint)
        number = float(text) / (100.0 if percent else 1.0)
    else:
        raise ScoreEditError(hint)
    if not math.isfinite(number):
        raise ScoreEditError(hint)
    if kind == "boolean" and number not in (0.0, 1.0):
        raise ScoreEditError(hint)
    if kind == "percentage" and not 0.0 <= number <= 1.0:
        raise ScoreEditError(hint)
    if kind == "count" and (number < 0 or not number.is_integer()):
        raise ScoreEditError(hint)
    return number


# ---------------------------------------------------------------------------
# Edit record and "Reset to original" (C041)
# ---------------------------------------------------------------------------

# Score metadata a reviewer's edit adds next to the scorer's own: the edit
# flag, the score before the first edit (``original_score``, plus its numeric
# value when the raw value was not a number), and who made the last edit,
# when, and from which value to which. Every write that re-derives a score's
# metadata keeps these keys; the run page does not list them as metadata.
ORIGINAL_NUMERIC_KEY = "original_score_numeric"
EDIT_RECORD_KEY = "last_edit"
SCORE_EDIT_META_KEYS = frozenset(
    {"modified", "original_score", ORIGINAL_NUMERIC_KEY, EDIT_RECORD_KEY}
)
_ERROR_KEYS = ("status", "error", "traceback")


def is_edited(meta: Any) -> bool:
    """Whether a score row holds a reviewer's value (``meta.modified``)."""
    return isinstance(meta, dict) and str(meta.get("modified") or "").lower() == "true"


def edit_record(
    *,
    user_id: Optional[str],
    user_name: Optional[str],
    at: Optional[str],
    previous: Any,
    new: Any,
    action: str = "edit",
) -> dict:
    """``meta.last_edit``: who changed the score, when, and from what to what."""
    return {
        "action": action,
        "by_user_id": user_id,
        "by": user_name or "",
        "at": at,
        "from": previous,
        "to": new,
    }


# Raw values that mean "no score", so their number is None by design.
_NO_SCORE = {"", "n/a", "na", "none", "null"}


class ScoreResetError(ValueError):
    """A reset that cannot know the original number; nothing is changed."""


def restore_original_score(meta: Any, current_raw: Any) -> Tuple[Any, Optional[float], dict]:
    """Undo a reviewer's edits on one score row.

    Returns the original raw value, its numeric value and the metadata the
    scorer left: the edit keys are removed and a scorer failure the edit
    replaced (``supersede_metric_error``'s ``original_*``) is restored.

    A saved number is used as it is, 0 and None included. An edit made before
    numbers were saved has only the raw value, read as the dashboard reads
    scores; a raw value with no number (a label such as "pass") raises
    :class:`ScoreResetError`.
    """
    restored = dict(meta) if isinstance(meta, dict) else {}
    original = restored.pop("original_score", current_raw)
    if ORIGINAL_NUMERIC_KEY in restored:
        numeric = restored.pop(ORIGINAL_NUMERIC_KEY)
    else:
        numeric = parse_score_value(original)
        if numeric is None and original is not None and str(original).strip().lower() not in _NO_SCORE:
            raise ScoreResetError(
                "The original number of this score was not saved, so it cannot be "
                "restored. Edit the score instead."
            )
    for key in _ERROR_KEYS:
        if f"original_{key}" in restored:
            restored[key] = restored.pop(f"original_{key}")
    restored.pop("modified", None)
    restored.pop(EDIT_RECORD_KEY, None)
    return original, numeric, restored
