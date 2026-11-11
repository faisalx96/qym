"""Search folding for Arabic text, shared by dataset, run and compare search.

The fold makes a search find text written with or without hamza on alef, with
alef maqsura or ya, with or without tatweel and diacritics (marks). Distinct
letters such as ta marbuta and ha stay distinct on purpose. ``fold_search_text``
also folds Arabic-Indic and Persian digits to 0-9 (C066), so '30' finds '٣٠'.
Dataset search stores its folded text, so it keeps the digits as written until
its stored text is rebuilt; run and compare search fold at query time.
"""

from __future__ import annotations

import unicodedata

# Arabic marks: every combining mark in the Arabic blocks.
ARABIC_MARKS = "".join(
    chr(code)
    for start, stop in ((0x0610, 0x0700), (0x08D3, 0x0900))
    for code in range(start, stop)
    if unicodedata.category(chr(code)).startswith("M")
)
# Alef variants and alef maqsura fold; tatweel and the marks are removed.
LETTERS_FROM = "أإآٱى"
LETTERS_TO = "ااااي"
REMOVED = "ـ" + ARABIC_MARKS
DIGITS_FROM = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹"
DIGITS_TO = "0123456789" * 2

_LETTER_TABLE = {
    **{ord(a): b for a, b in zip(LETTERS_FROM, LETTERS_TO)},
    **{ord(char): None for char in REMOVED},
}
_FULL_TABLE = {**_LETTER_TABLE, **{ord(a): b for a, b in zip(DIGITS_FROM, DIGITS_TO)}}


def fold_arabic_letters(value: str) -> str:
    """NFKC, the Arabic letter fold and lower case (dataset search's stored form)."""
    return unicodedata.normalize("NFKC", value).translate(_LETTER_TABLE).lower()


def fold_search_text(value: str) -> str:
    """``fold_arabic_letters`` plus Arabic-Indic and Persian digits as 0-9 (run and compare search)."""
    return unicodedata.normalize("NFKC", value).translate(_FULL_TABLE).lower()
