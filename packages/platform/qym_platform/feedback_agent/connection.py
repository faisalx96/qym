"""The platform-level connection of the feedback assistant (decision G3) and the model client.

One singleton row (``feedback_agent_connection``); the key is Fernet-encrypted like project connections
(``qym_platform.secrets``) and is never logged, never returned (only the last four characters) and never put in
a message, an event or an audit entry.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import httpx
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    PermissionDeniedError,
    RateLimitError,
)
from sqlalchemy.orm import Session

from qym_platform.db.feedback_models import FeedbackAgentConnection
from qym_platform.llm_endpoint_security import (
    LlmEndpointValidationError,
    create_llm_http_client,
    validate_llm_base_url,
)
from qym_platform.log import get_logger
from qym_platform.openai_compat import create_chat_completion_compat
from qym_platform.secrets import decrypt_llm_api_key, encryption_available
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)

TEST_TOOL = {
    "type": "function",
    "function": {
        "name": "qym_ping",
        "description": "Call this tool to confirm that tool calls work.",
        "parameters": {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]},
    },
}


class AgentError(Exception):
    """A failed turn or test. ``code`` is the SSE ``error.code``; ``admin_detail`` is shown to administrators only."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = True,
        admin_detail: str = "",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.admin_detail = admin_detail


def get_connection(db: Session) -> Optional[FeedbackAgentConnection]:
    return db.get(FeedbackAgentConnection, 1)


def is_configured(conn: Optional[FeedbackAgentConnection]) -> bool:
    return bool(conn and conn.llm_base_url and conn.llm_model and conn.llm_api_key_encrypted)


def api_key_hint(conn: Optional[FeedbackAgentConnection]) -> str:
    return ("••••" + conn.llm_api_key_last4) if conn and conn.llm_api_key_last4 else ""


def read_api_key(conn: FeedbackAgentConnection, settings: Optional[PlatformSettings] = None) -> str:
    try:
        return decrypt_llm_api_key(conn.llm_api_key_encrypted, settings)
    except RuntimeError as exc:
        raise AgentError(
            "agent_unavailable",
            "The assistant is not available.",
            retryable=False,
            admin_detail="The stored key cannot be decrypted. Save the connection again.",
        ) from exc


def build_client(base_url: str, api_key: str, settings: Optional[PlatformSettings] = None) -> AsyncOpenAI:
    settings = settings or PlatformSettings()
    try:
        url = validate_llm_base_url(base_url, allow_private=settings.allow_private_llm_base_urls)
    except LlmEndpointValidationError as exc:
        raise AgentError("agent_unavailable", "The assistant is not available.", retryable=False, admin_detail=str(exc)) from exc
    return AsyncOpenAI(
        base_url=url,
        api_key=api_key or "unused",
        http_client=create_llm_http_client(allow_private=settings.allow_private_llm_base_urls),
        max_retries=0,
    )


def map_exception(exc: BaseException) -> AgentError:
    """Turn a provider or transport failure into one of the five documented causes."""
    if isinstance(exc, AgentError):
        return exc
    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return AgentError("agent_rejected_key", "the key was rejected", retryable=False)
    if isinstance(exc, RateLimitError):
        return AgentError("agent_rate_limited", "rate limited", retryable=True)
    if isinstance(exc, (APITimeoutError, TimeoutError)) or isinstance(exc, httpx.TimeoutException):
        return AgentError("agent_timeout", "timed out", retryable=True)
    if isinstance(exc, APIConnectionError):
        return AgentError("agent_unavailable", "not reachable", retryable=True)
    if isinstance(exc, BadRequestError):
        text = str(exc).lower()
        if "tool" in text or "function" in text:
            return AgentError(
                "agent_unavailable", "the model does not support tool calls", retryable=False
            )
        return AgentError("agent_unavailable", f"the model refused the request (HTTP 400)", retryable=False)
    if isinstance(exc, APIStatusError):
        return AgentError("agent_unavailable", f"HTTP {exc.status_code}", retryable=exc.status_code >= 500)
    if isinstance(exc, LlmEndpointValidationError):
        return AgentError("agent_unavailable", "not reachable", retryable=False, admin_detail=str(exc))
    return AgentError("agent_bad_answer", "bad answer", retryable=True)


async def test_connection(base_url: str, model: str, api_key: str) -> dict[str, Any]:
    """One chat completion with a one-function tool and ``max_tokens`` 16 (QE-114). Writes nothing."""
    started = time.monotonic()
    try:
        client = build_client(base_url, api_key)
        try:
            response = await create_chat_completion_compat(
                client,
                model=model,
                messages=[{"role": "user", "content": "Call the qym_ping tool with ok=true."}],
                tools=[TEST_TOOL],
                tool_choice="auto",
                max_tokens=16,
                timeout=30,
            )
        finally:
            await client.close()
    except Exception as exc:  # noqa: BLE001 - mapped to a cause below
        err = map_exception(exc)
        logger.warning("feedback connection test failed: %s", err.code)
        detail = err.admin_detail or err.message
        if isinstance(exc, APIStatusError) and not isinstance(exc, (AuthenticationError, BadRequestError)):
            detail = f"HTTP {exc.status_code}"
        return {"ok": False, "model": model, "latency_ms": int((time.monotonic() - started) * 1000),
                "tool_call": False, "detail": detail}
    latency = int((time.monotonic() - started) * 1000)
    choice = response.choices[0] if getattr(response, "choices", None) else None
    calls = getattr(getattr(choice, "message", None), "tool_calls", None) or []
    called = any(getattr(getattr(c, "function", None), "name", "") == "qym_ping" for c in calls)
    if not called:
        return {"ok": False, "model": model, "latency_ms": latency, "tool_call": False,
                "detail": "the model does not support tool calls"}
    return {"ok": True, "model": getattr(response, "model", None) or model, "latency_ms": latency,
            "tool_call": True, "detail": ""}


def encryption_ready(settings: Optional[PlatformSettings] = None) -> bool:
    return encryption_available(settings)
