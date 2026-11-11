"""ETag and 304 for the reads of finished runs (C072).

A finished run's detail, passes, group metrics, step latency and compare reads
are large and change rarely, yet every response was ``no-store``, so a return
visit downloaded them again. A route marks a response cacheable with
``mark_cacheable(response)`` once it knows every run in it is finished. This
middleware then sends a weak ETag of the body with ``Cache-Control: private,
no-cache`` and answers ``If-None-Match`` with ``304 Not Modified`` and no body.

``private, no-cache`` keeps the sign-out protection of ``NoStoreMiddleware``:
the browser revalidates every reuse, and a signed-out request gets 401, not the
cached body. The ETag hashes the body, so it is right by construction for any
edit (scores, issues, reviews); the server still builds the payload, and the
saving is the transfer. It runs inside GZip, so the hash is of the JSON.
"""

from __future__ import annotations

import hashlib
from typing import Any, Iterable, List, Optional

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MARKER = "x-qym-cacheable"
CACHE_CONTROL = "private, no-cache"
LIVE_STATUSES = {"RUNNING", "PENDING"}


def run_is_finished(run: Any) -> bool:
    status = getattr(run, "status", None)
    return str(getattr(status, "value", status) or "").upper() not in LIVE_STATUSES


def mark_cacheable(response: Optional[Any], runs: Iterable[Any]) -> None:
    """Mark ``response`` for an ETag when every run in it is finished (no-op when called outside a request)."""
    if response is None:
        return
    runs = list(runs)
    if runs and all(run_is_finished(run) for run in runs):
        response.headers[MARKER] = "1"


def _etag_matches(header: Optional[str], etag: str) -> bool:
    if not header:
        return False
    tags = [tag.strip() for tag in header.split(",")]
    return "*" in tags or etag in tags or etag.removeprefix("W/") in tags


class FinishedRunEtagMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in ("GET", "HEAD"):
            await self.app(scope, receive, send)
            return
        start: Optional[Message] = None
        chunks: List[bytes] = []

        async def send_wrapper(message: Message) -> None:
            nonlocal start
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if MARKER not in headers or message.get("status") != 200:
                    if MARKER in headers:
                        del headers[MARKER]
                    await send(message)
                    return
                start = message
                return
            if start is None:
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return
            body = b"".join(chunks)
            etag = 'W/"' + hashlib.sha256(body).hexdigest()[:32] + '"'
            headers = MutableHeaders(scope=start)
            del headers[MARKER]
            headers["ETag"] = etag
            headers["Cache-Control"] = CACHE_CONTROL
            if _etag_matches(Headers(scope=scope).get("if-none-match"), etag):
                not_modified = {
                    "type": "http.response.start",
                    "status": 304,
                    "headers": [
                        (b"etag", etag.encode()),
                        (b"cache-control", CACHE_CONTROL.encode()),
                    ],
                }
                await send(not_modified)
                await send({"type": "http.response.body", "body": b""})
                return
            await send(start)
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, send_wrapper)
