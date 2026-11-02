"""Metadata filters and facets for dataset items.

``meta=path:value`` filters items on a leaf of their ``metadata`` object.
``path`` is a dotted path of at most three keys (``domain``, ``source.region.code``),
each key made of ``[A-Za-z0-9_-]``. A value matches its JSON text: strings as
they are, numbers and booleans as JSON writes them (``2``, ``true``). A path
matches an item when it holds a scalar equal to the value **or** a list that
contains it (lists of objects, empty lists, nested lists and paths through an
array match nothing). Repeated ``meta`` values of one path combine by
``meta_mode=path:any|all`` (default ``all``); different paths always AND. The
comparison is done in SQL on both dialects (``json_extract`` / ``json_type`` /
``json_each`` on SQLite, ``#>`` / ``#>>`` / ``jsonb_array_elements`` on
PostgreSQL), one statement whatever the number of values.

``metadata_facets`` lists every scalar or list path of a version with its values and
counts for the filter popover; a path has ``kind`` ``scalar``, ``list`` or ``mixed``.
It streams the ``metadata`` column once and caches the result per version for a
minute; the cache key carries the schema, the item count and the newest item write,
so any item write makes the next call recompute.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from qym_platform.db.models import DatasetItem
from sqlalchemy import (String, and_, case, cast, exists, func, literal,
                        literal_column, or_, select)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import array as pg_array
from sqlalchemy.orm import Session

MAX_META_FILTERS = 5
MAX_META_VALUES = 20
MAX_PATH_LEVELS = 3
MAX_FACET_PATHS = 100
MAX_FACET_VALUES = 200
MAX_FACET_LIST_ELEMENTS = 200
MAX_FACET_VALUE_LENGTH = 500
FACET_CACHE_SECONDS = 60.0
FACET_SCHEMA = 2
DEFAULT_META_MODE = "all"
META_MODES = ("any", "all")

PATH_DETAIL = "Metadata path must be dotted keys of at most 3 levels"
FORMAT_DETAIL = "meta must look like path:value"
TOO_MANY_DETAIL = "Use at most 5 metadata filters"
TOO_MANY_VALUES_DETAIL = "Use at most 20 values for one metadata key"
MODE_FORMAT_DETAIL = "meta_mode must look like path:any or path:all"
MODE_TWICE_DETAIL = "Use one meta_mode per metadata key"
MODE_VALUE_DETAIL = "meta value must be a string, number, boolean or {values, mode}"
MODE_BATCH_DETAIL = "mode must be any or all"
VALUES_EMPTY_DETAIL = "values must not be empty"

_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class MetaFilter:
    """One metadata criterion: ``path`` holds ``any`` or ``all`` of ``values``."""

    path: str
    values: tuple[str, ...]
    mode: str = DEFAULT_META_MODE


def parse_path(path: str) -> list[str]:
    """The keys of a dotted ``path``; 422 when it is empty, too deep or has odd characters."""
    parts = (path or "").split(".")
    if not 1 <= len(parts) <= MAX_PATH_LEVELS or not all(
        _KEY_RE.match(part) for part in parts
    ):
        raise HTTPException(status_code=422, detail=PATH_DETAIL)
    return parts


def _group(pairs: Iterable[tuple[str, str]], modes: dict[str, str]) -> list[MetaFilter]:
    """Group ``(path, value)`` pairs by path (first-seen order, duplicates dropped) and check the limits."""
    grouped: dict[str, list[str]] = {}
    for path, value in pairs:
        bucket = grouped.setdefault(path, [])
        if value not in bucket:
            bucket.append(value)
    if len(grouped) > MAX_META_FILTERS:
        raise HTTPException(status_code=422, detail=TOO_MANY_DETAIL)
    filters: list[MetaFilter] = []
    for path, values in grouped.items():
        if len(values) > MAX_META_VALUES:
            raise HTTPException(status_code=422, detail=TOO_MANY_VALUES_DETAIL)
        filters.append(
            MetaFilter(path, tuple(values), modes.get(path, DEFAULT_META_MODE))
        )
    return filters


def parse_meta_params(
    values: Optional[Iterable[str]], modes: Optional[Iterable[str]] = None
) -> list[MetaFilter]:
    """``meta=["tags:a", "tags:b"]`` and ``meta_mode=["tags:any"]`` to ``MetaFilter`` objects.

    ``meta`` splits on the first colon (the value may hold colons); ``meta_mode``
    is ``path:any`` or ``path:all``, at most one per path, and needs a ``meta``
    value for the same path.
    """
    pairs: list[tuple[str, str]] = []
    for raw in values or []:
        if ":" not in raw:
            raise HTTPException(status_code=422, detail=FORMAT_DETAIL)
        path, value = raw.split(":", 1)
        parse_path(path)
        pairs.append((path, value))
    mode_by_path: dict[str, str] = {}
    for raw in modes or []:
        if ":" not in raw:
            raise HTTPException(status_code=422, detail=MODE_FORMAT_DETAIL)
        path, mode = raw.split(":", 1)
        parse_path(path)
        if mode not in META_MODES:
            raise HTTPException(status_code=422, detail=MODE_FORMAT_DETAIL)
        if path in mode_by_path:
            raise HTTPException(status_code=422, detail=MODE_TWICE_DETAIL)
        mode_by_path[path] = mode
    known = {path for path, _ in pairs}
    for path in mode_by_path:
        if path not in known:
            raise HTTPException(
                status_code=422, detail=f"meta_mode needs a meta filter for {path}"
            )
    return _group(pairs, mode_by_path)


def _scalar_value_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def meta_pairs_from_mapping(meta: Optional[dict[str, Any]]) -> list[MetaFilter]:
    """The batch body's ``{path: value | {values, mode}}`` as validated filters."""
    raw_filters: list[tuple[str, list[str], str]] = []
    for path, value in (meta or {}).items():
        parse_path(str(path))
        mode = DEFAULT_META_MODE
        if isinstance(value, dict):
            raw_mode = value.get("mode", DEFAULT_META_MODE)
            raw_values = value.get("values")
            if "values" not in value and "mode" not in value:
                raise HTTPException(status_code=422, detail=MODE_VALUE_DETAIL)
            if raw_mode not in META_MODES:
                raise HTTPException(status_code=422, detail=MODE_BATCH_DETAIL)
            mode = raw_mode
            if not isinstance(raw_values, list) or not raw_values:
                raise HTTPException(status_code=422, detail=VALUES_EMPTY_DETAIL)
            texts = []
            for item in raw_values:
                if item is None or isinstance(item, (dict, list)):
                    raise HTTPException(status_code=422, detail=MODE_VALUE_DETAIL)
                texts.append(_scalar_value_text(item))
        elif value is None or isinstance(value, list):
            raise HTTPException(status_code=422, detail=MODE_VALUE_DETAIL)
        else:
            texts = [_scalar_value_text(value)]
        raw_filters.append((str(path), texts, mode))
    if len(raw_filters) > MAX_META_FILTERS:
        raise HTTPException(status_code=422, detail=TOO_MANY_DETAIL)
    result: list[MetaFilter] = []
    for path, texts, mode in raw_filters:
        unique = list(dict.fromkeys(texts))
        if len(unique) > MAX_META_VALUES:
            raise HTTPException(status_code=422, detail=TOO_MANY_VALUES_DETAIL)
        result.append(MetaFilter(path, tuple(unique), mode))
    return result


def _value_clause(db: Session, path: str, value: str) -> Any:
    """The item holds a scalar equal to ``value`` at ``path`` or a list that contains it."""
    parts = path.split(".")
    meta_column = DatasetItem.item_metadata
    if db.get_bind().dialect.name == "postgresql":
        keys = cast(pg_array(parts), ARRAY(String))
        doc = cast(meta_column, JSONB)
        node = doc.op("#>")(keys)
        scalar = and_(
            func.jsonb_typeof(node).in_(("string", "number", "boolean")),
            doc.op("#>>")(keys) == value,
        )
        element = func.jsonb_array_elements(
            case(
                (func.jsonb_typeof(node) == "array", node),
                else_=literal_column("'[]'::jsonb"),
            ),
            type_=JSONB,
        ).column_valued("e")
        contains = and_(
            func.jsonb_typeof(node) == "array",
            exists(
                select(literal(1)).where(
                    func.jsonb_typeof(element).in_(("string", "number", "boolean")),
                    element.op("#>>")(literal_column("'{}'")) == value,
                )
            ),
        )
        return or_(scalar, contains)
    json_path = "$." + ".".join(f'"{part}"' for part in parts)
    kind = func.json_type(meta_column, json_path)
    text = case(
        (kind == "true", literal("true")),
        (kind == "false", literal("false")),
        else_=cast(func.json_extract(meta_column, json_path), String),
    )
    scalar = and_(kind.in_(("integer", "real", "text", "true", "false")), text == value)
    each = func.json_each(meta_column, json_path).table_valued(
        "value", "type", name="je"
    )
    element_text = case(
        (each.c.type == "true", literal("true")),
        (each.c.type == "false", literal("false")),
        else_=cast(each.c.value, String),
    )
    contains = and_(
        kind == "array",
        exists(
            select(literal(1))
            .select_from(each)
            .where(
                each.c.type.in_(("text", "integer", "real", "true", "false")),
                element_text == value,
            )
        ),
    )
    return or_(scalar, contains)


def apply_meta_filters(db: Session, query: Any, filters: Iterable[MetaFilter]) -> Any:
    """AND every filter onto an item ``query``; one path's values combine by its mode."""
    for entry in filters:
        clauses = [_value_clause(db, entry.path, value) for value in entry.values]
        if len(clauses) == 1:
            query = query.filter(clauses[0])
        elif entry.mode == "any":
            query = query.filter(or_(*clauses))
        else:
            query = query.filter(and_(*clauses))
    return query


def _scalar_text(value: Any) -> Optional[str]:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value if len(value) <= MAX_FACET_VALUE_LENGTH else None
    if isinstance(value, (int, float)):
        return json.dumps(value)
    return None


def _walk(
    node: Any,
    prefix: tuple[str, ...],
    found: dict[str, dict[str, Any]],
) -> None:
    """Collect ``found[path] = {"scalar": text | None, "list": set of texts}`` for one item."""
    if not isinstance(node, dict):
        return
    for key, value in node.items():
        if not isinstance(key, str) or not _KEY_RE.match(key):
            continue
        path = prefix + (key,)
        if isinstance(value, dict):
            if len(path) < MAX_PATH_LEVELS:
                _walk(value, path, found)
            continue
        dotted = ".".join(path)
        if isinstance(value, list):
            elements = {
                text
                for text in (
                    _scalar_text(element)
                    for element in value[:MAX_FACET_LIST_ELEMENTS]
                    if not isinstance(element, (dict, list))
                )
                if text is not None
            }
            if elements:
                entry = found.setdefault(dotted, {"scalar": None, "list": set()})
                entry["list"] |= elements
            continue
        text = _scalar_text(value)
        if text is not None:
            entry = found.setdefault(dotted, {"scalar": None, "list": set()})
            entry["scalar"] = text


_cache: dict[str, tuple[float, tuple[Any, ...], dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def clear_facet_cache() -> None:
    with _cache_lock:
        _cache.clear()


def metadata_facets(db: Session, version_id: str) -> dict[str, Any]:
    """Every scalar or list path of a version's metadata with its values and counts."""
    stamp = (
        db.query(func.count(DatasetItem.id), func.max(DatasetItem.updated_at))
        .filter(DatasetItem.dataset_version_id == version_id)
        .one()
    )
    key = (FACET_SCHEMA, int(stamp[0] or 0), stamp[1])
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(version_id)
        if hit and hit[1] == key and now - hit[0] < FACET_CACHE_SECONDS:
            return hit[2]
    counters: dict[str, Counter] = {}
    has_list: set[str] = set()
    has_scalar: set[str] = set()
    rows = (
        db.query(DatasetItem.item_metadata)
        .filter(DatasetItem.dataset_version_id == version_id)
        .yield_per(1000)
    )
    for (metadata,) in rows:
        found: dict[str, dict[str, Any]] = {}
        _walk(metadata, (), found)
        for path, entry in found.items():
            texts = set(entry["list"])
            if entry["list"]:
                has_list.add(path)
            if entry["scalar"] is not None:
                texts.add(entry["scalar"])
                has_scalar.add(path)
            counter = counters.setdefault(path, Counter())
            for text in texts:
                counter[text] += 1
    ordered = sorted(counters.items(), key=lambda entry: entry[0])
    paths: list[dict[str, Any]] = []
    for path, counter in ordered[:MAX_FACET_PATHS]:
        values = sorted(counter.items(), key=lambda entry: (-entry[1], entry[0]))
        if path in has_list:
            kind = "mixed" if path in has_scalar else "list"
        else:
            kind = "scalar"
        paths.append(
            {
                "path": path,
                "kind": kind,
                "values": [
                    {"value": value, "count": count}
                    for value, count in values[:MAX_FACET_VALUES]
                ],
                "truncated": len(values) > MAX_FACET_VALUES,
                "value_count": len(values),
            }
        )
    result = {"paths": paths, "truncated": len(ordered) > MAX_FACET_PATHS}
    with _cache_lock:
        if len(_cache) > 256:
            _cache.clear()
        _cache[version_id] = (now, key, result)
    return result
