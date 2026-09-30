"""Validate a manual metric score edit against the metric's type (C009).

The run page applies the same rules before it sends an edit
(``metrics.js`` ``parseMetricScoreInput``); the server is the authority and
never stores a score that is not a finite number.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional

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
