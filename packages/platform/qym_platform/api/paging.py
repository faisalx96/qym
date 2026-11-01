"""One list contract for new and changed list endpoints (C160).

Request: ``limit`` (default 50, max 200) and ``cursor`` (opaque, from the last
page's ``next_cursor``). Response: ``{"data": [...], "has_more": bool,
"next_cursor": str | null, "total": int | null}``.

Endpoints that returned a bare list keep that shape for one release by default
and give the new body with ``format=page``; the default flips in the next one.
"""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Query

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

PAGE_FORMAT = Query(
    default="list",
    pattern="^(list|page)$",
    description="'page' returns {data, has_more, next_cursor, total}; 'list' (default for one release) the bare list.",
)


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"o:{offset}".encode()).decode().rstrip("=")


def decode_cursor(cursor: Optional[str]) -> int:
    """The offset a cursor stands for; 422 for a cursor this server did not issue."""
    if not cursor:
        return 0
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        kind, _, value = base64.urlsafe_b64decode(padded.encode()).decode().partition(":")
        offset = int(value)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid cursor") from exc
    if kind != "o" or offset < 0:
        raise HTTPException(status_code=422, detail="Invalid cursor")
    return offset


def page_body(data: List[Any], *, offset: int, total: Optional[int]) -> Dict[str, Any]:
    """The page body for ``data`` read at ``offset`` of ``total`` rows."""
    end = offset + len(data)
    has_more = total is not None and end < total
    return {
        "data": data,
        "has_more": has_more,
        "next_cursor": encode_cursor(end) if has_more else None,
        "total": total,
    }
