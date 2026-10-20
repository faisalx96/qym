"""Metadata filters and facets for dataset items.

``meta=path:value`` filters items on a scalar leaf of their ``metadata`` object.
``path`` is a dotted path of at most three keys (``domain``, ``source.region.code``),
each key made of ``[A-Za-z0-9_-]``. A value matches its JSON text: strings as
they are, numbers and booleans as JSON writes them (``2``, ``true``). A path
through a non-object, to an object or array, or to a missing key matches
nothing. The comparison is done in SQL on both dialects (``json_extract`` /
``json_type`` on SQLite, ``#>>`` on PostgreSQL).

``metadata_facets`` lists every scalar leaf path of a version with its values and
counts for the filter popover. It streams the ``metadata`` column once and caches
the result per version for a minute; the cache key carries the item count and the
newest item write, so any item write makes the next call recompute.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections import Counter
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from qym_platform.db.models import DatasetItem
from sqlalchemy import String, and_, case, cast, func, literal
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import array as pg_array
from sqlalchemy.orm import Session

MAX_META_FILTERS = 5
MAX_PATH_LEVELS = 3
MAX_FACET_PATHS = 100
MAX_FACET_VALUES = 200
MAX_FACET_VALUE_LENGTH = 500
FACET_CACHE_SECONDS = 60.0

PATH_DETAIL = "Metadata path must be dotted keys of at most 3 levels"
FORMAT_DETAIL = "meta must look like path:value"
TOO_MANY_DETAIL = "Use at most 5 metadata filters"

_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def parse_path(path: str) -> list[str]:
    """The keys of a dotted ``path``; 422 when it is empty, too deep or has odd characters."""
    parts = (path or "").split(".")
    if not 1 <= len(parts) <= MAX_PATH_LEVELS or not all(
        _KEY_RE.match(part) for part in parts
    ):
        raise HTTPException(status_code=422, detail=PATH_DETAIL)
    return parts


def parse_meta_params(values: Optional[Iterable[str]]) -> list[tuple[str, str]]:
    """``["domain:finance", ...]`` to ``[("domain", "finance")]``; splits on the first colon."""
    pairs: list[tuple[str, str]] = []
    for raw in values or []:
        if ":" not in raw:
            raise HTTPException(status_code=422, detail=FORMAT_DETAIL)
        path, value = raw.split(":", 1)
        parse_path(path)
        pairs.append((path, value))
    if len(pairs) > MAX_META_FILTERS:
        raise HTTPException(status_code=422, detail=TOO_MANY_DETAIL)
    return pairs


def meta_pairs_from_mapping(meta: Optional[dict[str, Any]]) -> list[tuple[str, str]]:
    """The batch body's ``{path: value}`` as validated pairs."""
    pairs: list[tuple[str, str]] = []
    for path, value in (meta or {}).items():
        parse_path(str(path))
        if isinstance(value, bool):
            text = "true" if value else "false"
        elif value is None or isinstance(value, (dict, list)):
            raise HTTPException(status_code=422, detail=FORMAT_DETAIL)
        else:
            text = str(value)
        pairs.append((str(path), text))
    if len(pairs) > MAX_META_FILTERS:
        raise HTTPException(status_code=422, detail=TOO_MANY_DETAIL)
    return pairs


def _clause(db: Session, path: str, value: str) -> Any:
    parts = path.split(".")
    column = DatasetItem.item_metadata
    if db.get_bind().dialect.name == "postgresql":
        keys = cast(pg_array(parts), ARRAY(String))
        doc = cast(column, JSONB)
        return and_(
            func.jsonb_typeof(doc.op("#>")(keys)).in_(("string", "number", "boolean")),
            doc.op("#>>")(keys) == value,
        )
    json_path = "$." + ".".join(f'"{part}"' for part in parts)
    kind = func.json_type(column, json_path)
    text = case(
        (kind == "true", literal("true")),
        (kind == "false", literal("false")),
        else_=cast(func.json_extract(column, json_path), String),
    )
    return and_(kind.in_(("integer", "real", "text", "true", "false")), text == value)


def apply_meta_filters(
    db: Session, query: Any, pairs: Iterable[tuple[str, str]]
) -> Any:
    """AND every ``(path, value)`` pair onto an item ``query``."""
    for path, value in pairs:
        query = query.filter(_clause(db, path, value))
    return query


def _scalar_text(value: Any) -> Optional[str]:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value if len(value) <= MAX_FACET_VALUE_LENGTH else None
    if isinstance(value, (int, float)):
        return json.dumps(value)
    return None


def _walk(node: Any, prefix: tuple[str, ...], found: list[tuple[str, str]]) -> None:
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
        text = _scalar_text(value)
        if text is not None:
            found.append((".".join(path), text))


_cache: dict[str, tuple[float, tuple[Any, ...], dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def clear_facet_cache() -> None:
    with _cache_lock:
        _cache.clear()


def metadata_facets(db: Session, version_id: str) -> dict[str, Any]:
    """Every scalar leaf path of a version's metadata with its values and counts."""
    stamp = (
        db.query(func.count(DatasetItem.id), func.max(DatasetItem.updated_at))
        .filter(DatasetItem.dataset_version_id == version_id)
        .one()
    )
    key = (int(stamp[0] or 0), stamp[1])
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(version_id)
        if hit and hit[1] == key and now - hit[0] < FACET_CACHE_SECONDS:
            return hit[2]
    counters: dict[str, Counter] = {}
    rows = (
        db.query(DatasetItem.item_metadata)
        .filter(DatasetItem.dataset_version_id == version_id)
        .yield_per(1000)
    )
    for (metadata,) in rows:
        found: list[tuple[str, str]] = []
        _walk(metadata, (), found)
        for path, text in found:
            counters.setdefault(path, Counter())[text] += 1
    ordered = sorted(counters.items(), key=lambda entry: entry[0])
    paths: list[dict[str, Any]] = []
    for path, counter in ordered[:MAX_FACET_PATHS]:
        values = sorted(counter.items(), key=lambda entry: (-entry[1], entry[0]))
        paths.append(
            {
                "path": path,
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
