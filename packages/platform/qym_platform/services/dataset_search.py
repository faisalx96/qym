"""Dataset item search over decoded JSON and normalized Arabic text.

Every item stores ``search_text``: its item ID, input, expected output and
metadata, decoded and normalized once when the item is written. A search is
then a plain substring match on that column, which a pg_trgm GIN index can
serve, instead of re-serializing and normalizing every row's JSON per request.
Rows written before migration 0068 keep ``search_text`` NULL until the
``backfill_dataset_search_text`` maintenance job reaches them; until then they
are matched with the old per-row expression, so results never depend on the
backfill's progress.
"""

from __future__ import annotations

import json
import unicodedata
from typing import Any, Optional

from sqlalchemy import String, and_, cast, func, literal_column, or_
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
# Searched columns, in the order their text is joined in ``search_text``.
_SEARCHED_COLUMNS = (
    (DatasetItem.item_id, False),
    (DatasetItem.input, True),
    (DatasetItem.expected_output, True),
    (DatasetItem.item_metadata, True),
)


def normalize_dataset_search(value: str) -> str:
    return unicodedata.normalize("NFKC", value).translate(_TRANSLATION).lower()


def _field_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


def dataset_item_search_text(item_id: Any, input_value: Any, expected: Any, metadata: Any) -> str:
    """The normalized text a search matches for one item (one field per line)."""
    parts = [_field_text(item_id), _field_text(input_value), _field_text(expected), _field_text(metadata or {})]
    # PostgreSQL text cannot hold NUL characters.
    return normalize_dataset_search("\n".join(parts)).replace("\x00", "")


def _sqlite_search_text(value: Optional[str], is_json: bool) -> Optional[str]:
    if value is None:
        return None
    if is_json:
        value = json.dumps(json.loads(value), ensure_ascii=False)
    return normalize_dataset_search(value)


def _legacy_predicate(db: Session, needle: str):
    """Per-row match for items written before ``search_text`` existed."""
    sqlite = db.get_bind().dialect.name == "sqlite"
    if sqlite:
        # SQLite is used by embedded/test databases and lacks normalize/translate.
        db.connection().connection.driver_connection.create_function(
            "qym_dataset_search_text", 2, _sqlite_search_text, deterministic=True
        )
    predicates = []
    for column, is_json in _SEARCHED_COLUMNS:
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
    return or_(*predicates)


def version_has_unindexed_items(db: Session, version_id: str) -> bool:
    return (
        db.query(DatasetItem.id)
        .filter(DatasetItem.dataset_version_id == version_id, DatasetItem.search_text.is_(None))
        .first()
        is not None
    )


def filter_dataset_item_search(
    db: Session, query: Query, search: Optional[str], *, version_id: Optional[str] = None
) -> Query:
    """Apply the same literal substring filter before counting or paging.

    Pass ``version_id`` when the query is scoped to one version: once that
    version has no rows left without ``search_text``, the filter is the bare
    indexed predicate.
    """
    needle = normalize_dataset_search(search or "").strip()
    if not needle:
        return query
    indexed = DatasetItem.search_text.contains(needle, autoescape=True)
    if version_id is not None and not version_has_unindexed_items(db, version_id):
        return query.filter(indexed)
    return query.filter(
        or_(indexed, and_(DatasetItem.search_text.is_(None), _legacy_predicate(db, needle)))
    )
