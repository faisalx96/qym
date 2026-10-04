"""Keep private pages and API responses out of browser caches.

Dashboard HTML and JSON carry user data. Without an explicit policy a browser
may keep them in its HTTP cache or back/forward cache, so pressing Back after
signing out can show the previous user's pages. Every dynamic response gets
``Cache-Control: no-store`` unless the route set its own policy. Static assets
(``/static``, ``/ui``) hold no user data and stay cacheable.

A plain ASGI middleware (no ``BaseHTTPMiddleware``) so streaming responses and
the ingest hot path pay only a header check.
"""

from __future__ import annotations

from typing import Tuple

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

STATIC_PREFIXES: Tuple[str, ...] = ("/static/", "/ui/")


class NoStoreMiddleware:
    def __init__(self, app: ASGIApp, *, static_prefixes: Tuple[str, ...] = STATIC_PREFIXES) -> None:
        self.app = app
        self.static_prefixes = static_prefixes

    def _is_static(self, scope: Scope) -> bool:
        path = scope.get("path") or ""
        root = (scope.get("root_path") or "").rstrip("/")
        if root and path.startswith(root + "/"):
            path = path[len(root):]
        return path.startswith(self.static_prefixes)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self._is_static(scope):
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_wrapper)
