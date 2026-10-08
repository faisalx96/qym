"""HTTP client for a remote Evaluation Service environment.

A thin ``httpx`` wrapper over the Evaluation Service ``/evals`` API. It is
built on :func:`create_llm_http_client` so every connection goes through the
same SSRF-safe pinned transport used for LLM providers: the platform sends
decrypted keys to this host.

Every response is redacted before it is returned. The service currently
echoes ``LLM_OVERRIDES.endpoints.*.api_key`` back in ``EvalJobRead.env_overrides``
(integration plan D1), sometimes as a flattened JSON string, so provider keys
are masked here and never reach callers, storage, logs, or exception messages.
``submit`` also masks the literal value of every credential it sent (e.g. the
top-level ``qym_api_key``) in the error text it logs or raises.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence
from urllib.parse import quote

import httpx

from qym_platform.llm_endpoint_security import (
    create_llm_http_client,
    validate_llm_base_url,
)
from qym_platform.settings import PlatformSettings
from qym_platform.log import get_logger

logger = get_logger(__name__)

CONNECT_TIMEOUT_SECONDS = 5.0
READ_TIMEOUT_SECONDS = 30.0
DEFAULT_TIMEOUT = httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)

REDACTED = "[REDACTED]"

_SENSITIVE_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "authorization",
    "client_secret",
    "password",
    "refresh_token",
    "secret",
    "secret_key",
    # ``run_metadata.qym_launch.token``: the one-time launch token (#16) is echoed back
    # in ``eval_input`` and must never be stored, returned or logged.
    "token",
    # ``EvalJobCreate.qym_api_key``: the submitting user's qym API key (guide §4.0).
    # The service may echo it like the D1 keys; it has no recognizable prefix, so
    # ``submit`` also scrubs its literal value from error text.
    "qym_api_key",
}
_SENSITIVE_SUFFIXES = ("_api_key", "_apikey", "_password", "_secret", "_token")

# Scrubs secrets out of free text (error details, transport messages).
_TEXT_SECRET_PATTERNS = (
    re.compile(r"(?i)(bearer\s+)[^\s\"',}]+"),
    re.compile(
        r"(?i)([\"']?[a-z0-9_]*(?:api_?key|secret|password|token)[\"']?\s*[:=]\s*"
        r"[\"']?)[^\"',}\s]+"
    ),
    # A launch token (``eval_experiments.TOKEN_PREFIX``) anywhere in the text.
    re.compile(r"()\bqlt_[A-Za-z0-9_-]{8,}"),
)

_HIGH_PRIORITY_ACTIVE_RE = re.compile(
    r"cannot accept (?P<priority>\S+) priority job while HIGH priority job "
    r"(?P<job_id>\S+) is active"
)
_NOT_CANCELLABLE_RE = re.compile(r"cannot cancel job in status (?P<status>\S+)")

_RETRYABLE_STATUS_CODES = {408, 425, 429}


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #


class EvalServiceError(Exception):
    """Base error for Evaluation Service calls. Messages are always redacted."""

    def __init__(self, message: str, *, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class EnvAuthError(EvalServiceError):
    """The environment rejected the API key (401)."""


class RemoteNotFound(EvalServiceError):
    """The remote job does not exist (404)."""


class RemoteConflict(EvalServiceError):
    """A 409 whose ``detail`` did not match a known variant."""


class HighPriorityActive(RemoteConflict):
    """Submission refused because a HIGH priority job is active (409)."""

    def __init__(
        self, message: str, *, job_id: str, priority: Optional[str] = None
    ) -> None:
        super().__init__(message, status_code=409)
        self.job_id = job_id
        self.priority = priority


class NotCancellable(RemoteConflict):
    """Cancel refused because the job is already terminal (409)."""

    def __init__(self, message: str, *, status: str) -> None:
        super().__init__(message, status_code=409)
        self.status = status


class RequestRejected(EvalServiceError):
    """The service rejected the request body or query (422).

    ``errors`` keeps each Pydantic error's ``loc`` path, ``msg`` and ``type``;
    the echoed ``input`` is dropped because it may contain secrets.
    """

    def __init__(self, message: str, *, errors: List[Dict[str, Any]]) -> None:
        super().__init__(message, status_code=422)
        self.errors = errors


class RetryableError(EvalServiceError):
    """Transport failure, timeout, or a 5xx/429 answer; safe to retry later."""


# --------------------------------------------------------------------------- #
# Redaction helpers
# --------------------------------------------------------------------------- #


def _is_sensitive_key(key: Any) -> bool:
    normalized = str(key).lower().replace("-", "_")
    return normalized in _SENSITIVE_KEYS or normalized.endswith(_SENSITIVE_SUFFIXES)


def redact_text(text: Any) -> str:
    """Mask bearer tokens and ``api_key=...``-style values in free text."""
    value = str(text)
    for pattern in _TEXT_SECRET_PATTERNS:
        value = pattern.sub(lambda match: match.group(1) + REDACTED, value)
    return value


def _redact_json_string(value: str) -> str:
    """Redact a JSON object/array stored as a string (flattened env vars)."""
    stripped = value.strip()
    if not stripped or stripped[0] not in "{[":
        return value
    try:
        parsed = json.loads(stripped)
    except ValueError:
        # Not JSON, but it looked structured: fall back to text scrubbing.
        return redact_text(value)
    redacted = redact_payload(parsed)
    if redacted == parsed:
        return value
    return json.dumps(redacted, separators=(",", ":"))


def redact_payload(value: Any) -> Any:
    """Return a copy of a service response with every credential masked.

    Covers nested dicts/lists and JSON encoded as strings, which is how the
    service returns ``env_overrides["LLM_OVERRIDES"]`` (D1).
    """
    if isinstance(value, Mapping):
        redacted: Dict[str, Any] = {}
        for key, item in value.items():
            if _is_sensitive_key(key) and item not in (None, ""):
                redacted[key] = REDACTED
            else:
                redacted[key] = redact_payload(item)
        return redacted
    if isinstance(value, list):
        return [redact_payload(item) for item in value]
    if isinstance(value, str):
        return _redact_json_string(value)
    return value


def _redact_schema(value: Any) -> Any:
    """Mask example/default values of secret fields without touching the schema shape."""
    if isinstance(value, Mapping):
        out: Dict[str, Any] = {}
        for key, item in value.items():
            if key == "properties" and isinstance(item, Mapping):
                out[key] = {
                    name: (
                        _mask_schema_values(sub)
                        if _is_sensitive_key(name)
                        else _redact_schema(sub)
                    )
                    for name, sub in item.items()
                }
            else:
                out[key] = _redact_schema(item)
        return out
    if isinstance(value, list):
        return [_redact_schema(item) for item in value]
    return value


def _mask_schema_values(subschema: Any) -> Any:
    if not isinstance(subschema, Mapping):
        return subschema
    out = dict(_redact_schema(subschema))
    if out.get("default") not in (None, ""):
        out["default"] = REDACTED
    if "examples" in out:
        out["examples"] = [REDACTED]
    if "example" in out:
        out["example"] = REDACTED
    return out


# Shorter values are too generic to mask as literals (e.g. "gpt-4o", "false").
_MIN_LITERAL_SECRET = 8


def _sent_secrets(value: Any) -> List[str]:
    """Literal credential values in a request body (under sensitive keys)."""
    found: List[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            if (
                _is_sensitive_key(key)
                and isinstance(item, str)
                and len(item) >= _MIN_LITERAL_SECRET
            ):
                found.append(item)
            else:
                found.extend(_sent_secrets(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(_sent_secrets(item))
    return found


def _scrub_text(text: str, secrets: Sequence[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, REDACTED)
    return text


def _scrub_values(value: Any, secrets: Sequence[str]) -> Any:
    """A copy of ``value`` with every literal in ``secrets`` masked."""
    if not secrets:
        return value
    if isinstance(value, str):
        return _scrub_text(value, secrets)
    if isinstance(value, Mapping):
        return {
            _scrub_values(key, secrets): _scrub_values(item, secrets)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub_values(item, secrets) for item in value]
    return value


def redact_headers(headers: Mapping[str, str]) -> Dict[str, str]:
    """Header copy that is safe to log."""
    return {
        key: (REDACTED if _is_sensitive_key(key) else value)
        for key, value in headers.items()
    }


# --------------------------------------------------------------------------- #
# Client
# --------------------------------------------------------------------------- #


class EvalServiceClient:
    """Async client for one Evaluation Service environment.

    ``base_url`` is the service root including any ``EVAL_SERVER_PREFIX``;
    the client appends ``/evals``. Use as ``async with`` or call :meth:`aclose`.
    A caller-supplied ``http_client`` is used as-is (tests) and never closed here.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        allow_private: Optional[bool] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        if allow_private is None:
            allow_private = PlatformSettings().allow_private_llm_base_urls
        self.base_url = validate_llm_base_url(base_url, allow_private=allow_private)
        self._api_key = api_key
        if http_client is None:
            http_client = create_llm_http_client(allow_private=allow_private)
            http_client.timeout = DEFAULT_TIMEOUT
            self._owns_client = True
        else:
            self._owns_client = False
        self._http = http_client

    def __repr__(self) -> str:
        return f"EvalServiceClient(base_url={self.base_url!r})"

    async def __aenter__(self) -> "EvalServiceClient":
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._http.aclose()

    # -- public API ---------------------------------------------------------- #

    async def submit(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        """``POST /evals``; returns the redacted ``EvalJobRead`` (202)."""
        sent = _sent_secrets(body)
        return _scrub_values(
            redact_payload(
                await self._request(
                    "POST", "/evals", json_body=dict(body), secrets=sent
                )
            ),
            sent,
        )

    async def get(self, job_id: str) -> Dict[str, Any]:
        """``GET /evals/{job_id}``; returns the redacted ``EvalJobRead``."""
        return redact_payload(await self._request("GET", _job_path(job_id)))

    async def cancel(self, job_id: str, user_id: str) -> Dict[str, Any]:
        """``POST /evals/{job_id}/cancel``; ``user_id`` is recorded for audit only."""
        data = await self._request(
            "POST", _job_path(job_id) + "/cancel", json_body={"user_id": user_id}
        )
        return redact_payload(data)

    async def list(
        self,
        *,
        status: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Dict[str, Any]:
        """``GET /evals``; returns ``{total, limit, offset, items}`` redacted."""
        params = {
            key: value
            for key, value in (
                ("status", status),
                ("user_id", user_id),
                ("priority", priority),
                ("limit", limit),
                ("offset", offset),
            )
            if value is not None
        }
        return redact_payload(await self._request("GET", "/evals", params=params))

    async def env_overrides_schema(self) -> Dict[str, Any]:
        """``GET /evals/env-overrides/schema``; the raw JSON Schema."""
        return _redact_schema(await self._request("GET", "/evals/env-overrides/schema"))

    # -- transport ----------------------------------------------------------- #

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Optional[Mapping[str, Any]] = None,
        secrets: Sequence[str] = (),
    ) -> Any:
        """One call. ``secrets`` are values sent in the body, masked in any error."""
        url = self.base_url + path
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        started = time.monotonic()
        try:
            response = await self._http.request(
                method, url, json=json_body, params=params, headers=headers
            )
        except httpx.TimeoutException as exc:
            logger.warning(
                "Evaluation service %s %s timed out (%s)",
                method,
                url,
                type(exc).__name__,
            )
            raise RetryableError(
                f"Evaluation service request timed out: {type(exc).__name__}"
            ) from None
        except httpx.TransportError as exc:
            message = _scrub_text(redact_text(exc), secrets)
            logger.warning(
                "Evaluation service %s %s failed: %s: %s",
                method,
                url,
                type(exc).__name__,
                message,
            )
            raise RetryableError(
                f"Evaluation service unreachable: {type(exc).__name__}: {message}"
            ) from None

        elapsed_ms = (time.monotonic() - started) * 1000
        logger.debug(
            "Evaluation service %s %s -> %s in %.0fms (headers=%s)",
            method,
            url,
            response.status_code,
            elapsed_ms,
            redact_headers(headers),
        )
        return _handle_response(method, url, response, secrets)


def _job_path(job_id: str) -> str:
    return "/evals/" + quote(str(job_id), safe="")


def _detail(response: httpx.Response) -> Any:
    try:
        return response.json().get("detail")
    except (ValueError, AttributeError):
        return None


def _handle_response(
    method: str, url: str, response: httpx.Response, secrets: Sequence[str] = ()
) -> Any:
    status = response.status_code
    if 200 <= status < 300:
        try:
            return response.json()
        except ValueError:
            logger.warning(
                "Evaluation service %s %s returned a non-JSON %s response", method, url, status
            )
            raise EvalServiceError(
                "Evaluation service returned a non-JSON response", status_code=status
            ) from None

    detail = _scrub_values(_detail(response), secrets)
    safe_detail = redact_text(detail) if isinstance(detail, str) else None
    logger.info(
        "Evaluation service %s %s returned %s%s",
        method,
        url,
        status,
        f": {safe_detail}" if safe_detail else "",
    )

    if status == 401:
        raise EnvAuthError(
            "Evaluation service rejected the environment API key", status_code=401
        )
    if status == 404:
        raise RemoteNotFound(safe_detail or "Evaluation job not found", status_code=404)
    if status == 409:
        raise _conflict(safe_detail or "")
    if status == 422:
        errors = _validation_errors(detail)
        raise RequestRejected(
            "Evaluation service rejected the request: "
            + "; ".join(_format_error(error) for error in errors),
            errors=errors,
        )
    if status >= 500 or status in _RETRYABLE_STATUS_CODES:
        raise RetryableError(
            f"Evaluation service returned HTTP {status}", status_code=status
        )
    raise EvalServiceError(
        f"Evaluation service returned HTTP {status}"
        + (f": {safe_detail}" if safe_detail else ""),
        status_code=status,
    )


def _conflict(detail: str) -> RemoteConflict:
    match = _HIGH_PRIORITY_ACTIVE_RE.search(detail)
    if match:
        return HighPriorityActive(
            detail,
            job_id=match.group("job_id"),
            priority=match.group("priority"),
        )
    match = _NOT_CANCELLABLE_RE.search(detail)
    if match:
        # The service may format the enum as ``JobStatus.SUCCEEDED``.
        status = match.group("status").rsplit(".", 1)[-1].upper()
        return NotCancellable(detail, status=status)
    return RemoteConflict(detail or "Evaluation service conflict", status_code=409)


def _validation_errors(detail: Any) -> List[Dict[str, Any]]:
    """Keep ``loc``/``msg``/``type`` from FastAPI errors; drop echoed ``input``."""
    if isinstance(detail, list):
        errors = []
        for item in detail:
            if not isinstance(item, Mapping):
                errors.append({"loc": [], "msg": redact_text(item), "type": ""})
                continue
            errors.append(
                {
                    "loc": list(item.get("loc") or []),
                    "msg": redact_text(item.get("msg", "")),
                    "type": str(item.get("type", "")),
                }
            )
        return errors
    if detail:
        return [{"loc": [], "msg": redact_text(detail), "type": ""}]
    return [{"loc": [], "msg": "Request rejected", "type": ""}]


def _format_error(error: Mapping[str, Any]) -> str:
    loc = ".".join(str(part) for part in error.get("loc") or [])
    return f"{loc}: {error.get('msg')}" if loc else str(error.get("msg"))
