"""Request validation errors that never echo credentials (security checklist §15).

FastAPI's default 422 handler returns each Pydantic error with its ``input``. For a
missing field that input is the **whole request body**, so a create request with a
typo sent back its ``api_key`` / ``llm_api_key`` / temporary-model ``secrets`` in the
response. This handler keeps the default response shape but masks credential values:
an error whose ``loc`` names a credential field gets ``input: "[REDACTED]"``, and any
other structured input goes through the Evaluation Service redactor with the request
fields that carry secrets (``secrets``, ``temporary_keys``) added.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from qym_platform.services.eval_service_client import (
    REDACTED,
    _is_sensitive_key,
    redact_payload,
)

# Request fields whose *values* are maps of secrets (not named like a key themselves).
_SECRET_CONTAINERS = frozenset({"secrets", "temporary_keys"})


def _is_secret_field(name: Any) -> bool:
    return str(name).lower() in _SECRET_CONTAINERS or _is_sensitive_key(name)


def _redact_input(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: (
                REDACTED
                if _is_secret_field(key) and item not in (None, "", {})
                else _redact_input(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_input(item) for item in value]
    return redact_payload(value)


def safe_validation_errors(errors: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Copies of Pydantic errors with every credential value masked."""
    out: List[Dict[str, Any]] = []
    for error in errors:
        item = dict(error)
        if "input" in item:
            loc = item.get("loc") or ()
            if any(_is_secret_field(part) for part in loc):
                item["input"] = REDACTED
            else:
                item["input"] = _redact_input(item["input"])
        out.append(item)
    return out


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(safe_validation_errors(exc.errors()))},
    )


__all__ = ("safe_validation_errors", "validation_exception_handler")
