"""Static assets compressed once per file version instead of on every request.

``GZipMiddleware`` compresses every response it sees, so each cold download of
``dashboard.js`` or ``dashboard.css`` paid the compression again, on the event
loop, for bytes that never change. ``PrecompressedStaticFiles`` compresses a
text asset the first time it is asked for (in a thread, at the highest level,
since the cost is paid once), keeps the bytes keyed by path, mtime and size,
and serves them with ``Content-Encoding: gzip``. ``GZipExceptStatic`` keeps
the per-request middleware away from the static mounts (older Starlette would
compress such a response a second time). An edited file has a new mtime, so a
stale copy is never served; nothing has to be generated at build time.
"""

from __future__ import annotations

import gzip
import os
import threading
from collections import OrderedDict
from typing import Optional, Tuple

import anyio
from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from qym_platform.middleware.cache_control import STATIC_PREFIXES

COMPRESSIBLE_TYPES = (
    "text/",
    "application/javascript",
    "application/json",
    "application/xml",
    "image/svg+xml",
)
MIN_SIZE = 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
CACHE_BYTES = 32 * 1024 * 1024


class PrecompressedStaticFiles(StaticFiles):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._gz_lock = threading.Lock()
        self._gz_cache: "OrderedDict[str, Tuple[int, int, bytes]]" = OrderedDict()
        self._gz_bytes = 0

    def _compressed(self, path: str, mtime_ns: int, size: int) -> bytes:
        with self._gz_lock:
            hit = self._gz_cache.get(path)
            if hit is not None and hit[0] == mtime_ns and hit[1] == size:
                self._gz_cache.move_to_end(path)
                return hit[2]
        with open(path, "rb") as handle:
            body = gzip.compress(handle.read(), compresslevel=9, mtime=0)
        with self._gz_lock:
            old = self._gz_cache.pop(path, None)
            if old is not None:
                self._gz_bytes -= len(old[2])
            self._gz_cache[path] = (mtime_ns, size, body)
            self._gz_bytes += len(body)
            while self._gz_bytes > CACHE_BYTES and len(self._gz_cache) > 1:
                _, (_, _, evicted) = self._gz_cache.popitem(last=False)
                self._gz_bytes -= len(evicted)
        return body

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        gz = await self._maybe_gzip(response, scope)
        return gz if gz is not None else response

    async def _maybe_gzip(self, response: Response, scope: Scope) -> Optional[Response]:
        if type(response) is not FileResponse or response.status_code != 200:
            return None
        request = Headers(scope=scope)
        if scope.get("method") != "GET" or "range" in request:
            return None
        if "gzip" not in request.get("accept-encoding", ""):
            return None
        media_type = (response.media_type or "").lower()
        if not media_type.startswith(COMPRESSIBLE_TYPES):
            return None
        stat_result = response.stat_result
        if stat_result is None or not MIN_SIZE <= stat_result.st_size <= MAX_FILE_BYTES:
            return None
        body = await anyio.to_thread.run_sync(
            self._compressed,
            os.fspath(response.path),
            stat_result.st_mtime_ns,
            stat_result.st_size,
        )
        headers = {
            key: value
            for key, value in response.headers.items()
            if key.lower() not in {"content-length", "accept-ranges", "content-type"}
        }
        headers["content-encoding"] = "gzip"
        headers["vary"] = "Accept-Encoding"
        return Response(body, headers=headers, media_type=response.media_type)


def _is_static(scope: Scope, prefixes: Tuple[str, ...]) -> bool:
    path = scope.get("path") or ""
    root = (scope.get("root_path") or "").rstrip("/")
    if root and path.startswith(root + "/"):
        path = path[len(root):]
    return path.startswith(prefixes)


class GZipExceptStatic:
    """``GZipMiddleware`` for pages and API responses; static mounts compress
    their own text assets once (``PrecompressedStaticFiles``)."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        minimum_size: int = 1024,
        compresslevel: int = 6,
        static_prefixes: Tuple[str, ...] = STATIC_PREFIXES,
    ) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size, compresslevel=compresslevel)
        self.static_prefixes = static_prefixes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and _is_static(scope, self.static_prefixes):
            await self.app(scope, receive, send)
        else:
            await self.gzip(scope, receive, send)
