"""Request id + unhandled-error logging for every HTTP request.

A plain ASGI middleware (no ``BaseHTTPMiddleware``) so the ingest hot path pays
only a header lookup. For each request it:

* takes the caller's ``X-Request-ID`` when it is a short, safe token, or makes
  a new one, stores it in :mod:`qym_platform.log`'s context (every log line of
  the request carries it) and echoes it on the response;
* logs any exception that escapes the app with its full traceback, the method,
  path, request id and status, then re-raises it, so Starlette still answers
  with its usual ``500 Internal Server Error`` body.
"""

from __future__ import annotations

import re
import uuid
from typing import Optional

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from qym_platform.log import get_logger, reset_request_id, set_request_id

logger = get_logger(__name__)

REQUEST_ID_HEADER = "x-request-id"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")


def _incoming_request_id(scope: Scope) -> Optional[str]:
    for key, value in scope.get("headers") or ():
        if key == REQUEST_ID_HEADER.encode("latin-1"):
            candidate = value.decode("latin-1").strip()
            if _SAFE_REQUEST_ID.match(candidate):
                return candidate
            return None
    return None


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = _incoming_request_id(scope) or uuid.uuid4().hex
        token = set_request_id(request_id)
        state = {"status": None}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                state["status"] = message.get("status")
                headers = MutableHeaders(scope=message)
                if REQUEST_ID_HEADER not in headers:
                    headers[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception(
                "unhandled error method=%s path=%s request_id=%s status=%s",
                scope.get("method"),
                scope.get("path"),
                request_id,
                state["status"] or 500,
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": state["status"] or 500,
                },
            )
            raise
        finally:
            reset_request_id(token)


def install_request_context(app) -> None:
    """Add :class:`RequestContextMiddleware` as the outermost app middleware."""
    app.add_middleware(RequestContextMiddleware)
