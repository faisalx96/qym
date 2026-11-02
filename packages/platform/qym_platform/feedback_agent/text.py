"""Text helpers: normalisation for search (Arabic aware), tokens, direction."""

from __future__ import annotations

import re
import unicodedata

_ARABIC_MARKS = re.compile("[ً-ٰٟۖ-ۭـ]")
_ALEF = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا"})
_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
_STOP = frozenset(
    "a an and are as at be by for from has have i in is it of on or that the this to we with you our my "
    "في من على الى عن مع هذا هذه ان او و".split()
)


def normalize(text: str) -> str:
    """Lower-case, strip Arabic diacritics and tatweel, unify alef / ya / ta marbuta forms."""
    value = unicodedata.normalize("NFKC", str(text or "")).lower()
    value = _ARABIC_MARKS.sub("", value)
    value = value.translate(_ALEF)
    return value.replace("ى", "ي").replace("ة", "ه")


def stem(token: str) -> str:
    """A crude stem that makes ``exports`` match ``export`` and ``الملفات`` match ``ملفات``."""
    if token.startswith("ال") and len(token) > 4:
        token = token[2:]
    for suffix in ("ing", "es", "ed", "s"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def tokens(text: str, *, keep_stop: bool = False) -> list[str]:
    out = []
    for raw in _TOKEN.findall(normalize(text)):
        if not keep_stop and raw in _STOP:
            continue
        if len(raw) < 2 and not raw.isdigit():
            continue
        out.append(raw)
    return out


def search_text(*parts: str) -> str:
    """The value stored in ``feedback_requests.search_text``: normalised title, summary and need."""
    return " ".join(p for p in (normalize(part).strip() for part in parts) if p)[:4000]


def clip(text: str, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


def one_line(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)
