"""Dataset item search over decoded JSON and normalized Arabic text."""

from __future__ import annotations

import json
import unicodedata

from sqlalchemy import String, cast, func, literal_column, or_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Query, Session

from qym_platform.db.models import DatasetItem

# Fold alef variants and alef maqsura, and remove tatweel and Arabic marks.
# Keep distinct letters such as ta marbuta and ha distinct.
_ARABIC_MARKS = "".join(
    chr(code)
    for start, stop in ((0x0610, 0x0700), (0x08D3, 0x0900))
    for code in range(start, stop)
    if unicodedata.category(chr(code)).startswith("M")
)
_TRANSLATE_FROM = "أإآٱىـ" + _ARABIC_MARKS
_TRANSLATE_TO = "ااااي"
_TRANSLATION = str.maketrans(
    {
        char: _TRANSLATE_TO[i] if i < len(_TRANSLATE_TO) else None
        for i, char in enumerate(_TRANSLATE_FROM)
    }
)


def normalize_dataset_search(value: str) -> str:
    return unicodedata.normalize("NFKC", value).translate(_TRANSLATION).lower()


def _sqlite_search_text(value: str | None, is_json: bool) -> str | None:
    if value is None:
        return None
    if is_json:
        value = json.dumps(json.loads(value), ensure_ascii=False)
    return normalize_dataset_search(value)


def filter_dataset_item_search(db: Session, query: Query, search: str | None) -> Query:
    """Apply the same literal substring filter before counting or paging."""
    needle = normalize_dataset_search(search or "").strip()
    if not needle:
        return query

    sqlite = db.get_bind().dialect.name == "sqlite"
    if sqlite:
        # SQLite is used by embedded/test databases and lacks normalize/translate.
        db.connection().connection.driver_connection.create_function(
            "qym_dataset_search_text", 2, _sqlite_search_text, deterministic=True
        )

    predicates = []
    for column, is_json in (
        (DatasetItem.item_id, False),
        (DatasetItem.input, True),
        (DatasetItem.expected_output, True),
    ):
        if sqlite:
            normalized = func.qym_dataset_search_text(column, is_json)
        else:
            # JSON preserves \u escapes; JSONB decodes them, including nested data.
            value = cast(cast(column, JSONB), String) if is_json else column
            normalized = func.lower(
                func.translate(
                    func.normalize(value, literal_column("NFKC")),
                    _TRANSLATE_FROM,
                    _TRANSLATE_TO,
                )
            )
        predicates.append(normalized.contains(needle, autoescape=True))
    return query.filter(or_(*predicates))
