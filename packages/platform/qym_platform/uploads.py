"""Bounded reads of uploaded files.

Starlette spools a multipart file over 1 MB to a temporary file while it parses
the body. ``UploadLimitMiddleware`` refuses oversized bodies before that, by
``Content-Length``; :func:`read_upload` caps what a handler reads into memory, so
a body that slips past the header check is still bounded.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, Dict

from fastapi import HTTPException, UploadFile

from qym_platform.settings import PlatformSettings

# Form fields and multipart boundaries around the file part.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024


def upload_limit_message(limit: int) -> str:
    return f"The upload exceeds the {limit // (1024 * 1024)} MB limit (QYM_MAX_UPLOAD_BYTES)."


async def read_upload(file: UploadFile, limit: int | None = None) -> bytes:
    """The file's bytes, or HTTP 413 when it is larger than ``limit``."""
    cap = limit if limit is not None else PlatformSettings().max_upload_bytes
    try:
        raw = await file.read(cap + 1)
    finally:
        await file.close()
    if len(raw) > cap:
        raise HTTPException(status_code=413, detail=upload_limit_message(cap))
    return raw


Scope = Dict[str, Any]
Receive = Callable[[], Awaitable[Dict[str, Any]]]
Send = Callable[[Dict[str, Any]], Awaitable[None]]


class UploadLimitMiddleware:
    """Refuses multipart bodies over the upload limit before they are parsed.

    A multipart request needs a ``Content-Length`` (411 without one): a chunked
    body of unknown size would be spooled to disk before any handler could stop it.
    """

    def __init__(self, app: Callable[..., Awaitable[None]], max_upload_bytes: int) -> None:
        self.app = app
        self.max_upload_bytes = max_upload_bytes
        self.max_body_bytes = max_upload_bytes + MULTIPART_OVERHEAD_BYTES

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") == "http":
            headers = dict(scope.get("headers") or [])
            content_type = headers.get(b"content-type", b"").decode("latin-1").lower()
            if content_type.startswith("multipart/form-data"):
                length = headers.get(b"content-length")
                if length is None:
                    await _reply(send, 411, "Uploads need a Content-Length header.")
                    return
                try:
                    size = int(length)
                except ValueError:
                    await _reply(send, 400, "Invalid Content-Length header.")
                    return
                if size > self.max_body_bytes:
                    await _reply(send, 413, upload_limit_message(self.max_upload_bytes))
                    return
        await self.app(scope, receive, send)


async def _reply(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
