"""One error body for /api and /v1 (C159).

Every HTTPException and request validation error answers::

    {"error": {"code": "run_not_found", "message": "Run not found",
               "details": [...], "request_id": "..."},
     "detail": <the old detail>}

``detail`` stays as an alias for one release, so clients that read it keep
working. A route that raises a structured detail (a dict with ``code`` and
``message``) keeps its code. Product evals already answer ``{"error": {code,
message}}``; this extends that object.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from qym_platform.log import get_request_id
from qym_platform.validation_errors import safe_validation_errors

STATUS_CODES = {
    400: "bad_request",
    401: "not_authenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "unavailable",
}
_SHORT = re.compile(r"^[A-Za-z][A-Za-z0-9 '-]{0,48}$")


def error_code(status: int, message: str) -> str:
    """A short message names its own code ('Run not found' -> 'run_not_found'); a long one gets its status's code."""
    text = message.strip().rstrip(".")
    if _SHORT.match(text) and len(text.split()) <= 5:
        return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return STATUS_CODES.get(status, "error" if status < 500 else "internal_error")


def error_body(status: int, detail: Any, *, code: Optional[str] = None, details: Any = None) -> dict:
    message = detail if isinstance(detail, str) else ""
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("detail") or "")
        code = code or (detail.get("code") if isinstance(detail.get("code"), str) else None)
        details = details if details is not None else detail.get("details")
    return {
        "error": {
            "code": code or error_code(status, message),
            "message": message or STATUS_CODES.get(status, "error").replace("_", " ").capitalize(),
            "details": details if details is not None else [],
            "request_id": get_request_id(),
        },
        "detail": detail,
    }


async def http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=jsonable_encoder(error_body(exc.status_code, exc.detail)),
        headers=getattr(exc, "headers", None),
    )


async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    # 422 responses must never echo a submitted key (security checklist §15).
    errors = jsonable_encoder(safe_validation_errors(exc.errors()))
    body = error_body(422, errors, code="validation_error", details=errors)
    body["error"]["message"] = "The request is not valid"
    return JSONResponse(status_code=422, content=body)


def install_error_handlers(app) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
