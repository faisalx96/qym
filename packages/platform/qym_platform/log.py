"""Central logging for the platform: ``from qym_platform.log import get_logger``.

Every platform module logs through ``logger = get_logger(__name__)``, so all
records sit under the ``qym_platform`` logger tree. Each process entry point
(the API app factories, ``qym_platform.worker``, ``qym_platform.serve``, the
CLI) calls :func:`configure_logging` once; repeated calls are no-ops.

Environment:

* ``QYM_LOG_LEVEL``: ``DEBUG`` | ``INFO`` (default) | ``WARNING`` | ``ERROR``.
* ``QYM_LOG_FORMAT``: ``text`` (default) or ``json`` (one object per line with
  ``timestamp``, ``level``, ``logger``, ``message``, ``service``,
  ``request_id`` when a request is in flight, ``exc_info`` as the traceback
  string, and any ``extra=`` fields).

The handler goes on the root logger (records propagate), so pytest's
``caplog`` and uvicorn's own loggers keep working. Every line this module
formats is passed through :func:`redact_text`: bearer tokens, API keys,
passwords and similar ``key=value`` pairs never reach the output.

Caught exceptions are logged with their traceback through
``logger.exception(...)`` inside an ``except`` block, or
:func:`log_exception` when the level or context fields matter.
"""

from __future__ import annotations

import contextvars
import datetime as _dt
import json
import logging
import os
import re
import sys
import threading
from typing import Any, Dict, Iterable, Mapping, Optional

ROOT_LOGGER_NAME = "qym_platform"
REDACTED = "[REDACTED]"
DEFAULT_LEVEL = "INFO"
DEFAULT_FORMAT = "text"
FORMATS = ("text", "json")

_request_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("qym_request_id", default=None)
_configure_lock = threading.Lock()
_configured = False
_HANDLER_MARKER = "_qym_platform_handler"
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


# --------------------------------------------------------------------------- #
# Loggers
# --------------------------------------------------------------------------- #


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """A logger under the ``qym_platform`` tree.

    ``get_logger(__name__)`` in a platform module returns the logger of that
    module's dotted name (``qym_platform.services.retention``), so tests and
    docs that name a module's logger keep matching. Any other name is nested
    under ``qym_platform``; ``__main__`` (``python -m qym_platform.x``) maps to
    ``qym_platform`` itself.
    """
    if not name or name == "__main__" or name == ROOT_LOGGER_NAME:
        return logging.getLogger(ROOT_LOGGER_NAME)
    if name.startswith(ROOT_LOGGER_NAME + "."):
        return logging.getLogger(name)
    return logging.getLogger(f"{ROOT_LOGGER_NAME}.{name}")


def log_exception(
    logger: logging.Logger,
    message: str,
    *args: Any,
    level: int = logging.ERROR,
    exc: Optional[BaseException] = None,
    **context: Any,
) -> None:
    """Log ``message`` with the current (or given) exception's traceback.

    ``context`` keyword fields are appended as ``key=value`` to the text line
    and become top-level fields in JSON output. Use inside an ``except`` block
    (or pass ``exc=``); ``level`` lets recoverable failures log at WARNING
    while still carrying the traceback.
    """
    exc_info: Any = (type(exc), exc, exc.__traceback__) if exc is not None else True
    if context:
        suffix = " ".join(f"{key}=%s" for key in context)
        message = f"{message} {suffix}" if message else suffix
        args = tuple(args) + tuple(context.values())
    logger.log(level, message, *args, exc_info=exc_info, extra={"context": dict(context)} if context else None, stacklevel=2)


# --------------------------------------------------------------------------- #
# Request id
# --------------------------------------------------------------------------- #


def get_request_id() -> Optional[str]:
    return _request_id.get()


def set_request_id(value: Optional[str]) -> contextvars.Token:
    return _request_id.set(value)


def reset_request_id(token: contextvars.Token) -> None:
    _request_id.reset(token)


# --------------------------------------------------------------------------- #
# Redaction
# --------------------------------------------------------------------------- #

_SECRET_KEY = (
    r"[A-Za-z0-9_\-]*(?:api[_\-]?key|apikey|secret(?:[_\-]?key)?|private[_\-]?key|password|passwd|token|cookie)"
)
_TEXT_SECRET_PATTERNS = (
    # Authorization headers in any rendering: "Authorization: Bearer x",
    # "'authorization': 'Basic x'", "authorization=x".
    re.compile(r"(?i)(\bauthorization[\"']?\s*[:=]\s*[\"']?)(?:(?:bearer|basic|token)\s+)?[^\s\"',;}&]+"),
    re.compile(r"(?i)(\bbearer\s+)[^\s\"',;}&]+"),
    re.compile(r"(?i)(\bbasic\s+)[A-Za-z0-9+/=]{8,}"),
    # key=value / "key": "value" pairs whose key names a credential.
    re.compile(r"(?i)([\"']?\b" + _SECRET_KEY + r"\b[\"']?\s*[:=]\s*[\"']?)(?!\[REDACTED\])[^\s\"',;}&)]+"),
    # Credentials in URLs: scheme://user:password@host
    re.compile(r"(?i)(\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:)[^\s@/]+(?=@)"),
    # Recognizable token shapes: launch tokens, dataset read tokens, OpenAI-style keys.
    re.compile(r"()\bqlt_[A-Za-z0-9_\-]{8,}"),
    re.compile(r"()\bqym_dr_[A-Za-z0-9_\-]{8,}"),
    re.compile(r"()\bsk-[A-Za-z0-9_\-]{16,}"),
)
_SENSITIVE_FIELD = re.compile(r"(?i)(api[_\-]?key|apikey|secret|secret_key|private_key|password|passwd|token|authorization|cookie)$")


def redact_text(text: Any) -> str:
    """Mask credentials (bearer tokens, ``api_key=...``, passwords) in text."""
    value = str(text)
    for pattern in _TEXT_SECRET_PATTERNS:
        value = pattern.sub(lambda match: match.group(1) + REDACTED, value)
    return value


def redact_mapping(value: Any) -> Any:
    """A copy of ``value`` with every credential-named key's value masked."""
    if isinstance(value, Mapping):
        out: Dict[Any, Any] = {}
        for key, item in value.items():
            if isinstance(key, str) and _SENSITIVE_FIELD.search(key.replace("-", "_")):
                out[key] = REDACTED
            else:
                out[key] = redact_mapping(item)
        return out
    if isinstance(value, (list, tuple)):
        return type(value)(redact_mapping(item) for item in value)
    if isinstance(value, str):
        return redact_text(value)
    return value


class RedactionFilter(logging.Filter):
    """Rewrite a record's message so credentials never reach a handler.

    Attached to handlers this module does not format itself (uvicorn's), and
    to the platform handler as a second line of defence.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - a broken format string; let logging report it
            return True
        redacted = redact_text(message)
        if redacted != message:
            record.msg = redacted
            record.args = None
        return True


class ContextFilter(logging.Filter):
    """Stamp ``service`` (``QYM_SERVICE``/``QYM_ROLE``) and ``request_id`` on records."""

    def __init__(self, service: Optional[str] = None) -> None:
        super().__init__()
        self.service = service if service is not None else current_service()

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "service"):
            record.service = self.service
        if not hasattr(record, "request_id"):
            record.request_id = _request_id.get()
        return True


def current_service() -> str:
    service = (os.environ.get("QYM_SERVICE") or "").strip().lower()
    if service:
        return service
    return (os.environ.get("QYM_ROLE") or "all").strip().lower() or "all"


# --------------------------------------------------------------------------- #
# Formatters
# --------------------------------------------------------------------------- #

# LogRecord attributes that are not ``extra=`` fields.
_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "service",
    "request_id",
    "context",
    "taskName",
}


class TextFormatter(logging.Formatter):
    """``<time> <LEVEL> <logger> [request_id] <message>`` plus the traceback."""

    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()
        request_id = getattr(record, "request_id", None)
        rid = f" [{request_id}]" if request_id else ""
        line = f"{self.formatTime(record, self.datefmt)} {record.levelname} {record.name}{rid} {record.message}"
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            line = f"{line}\n{record.exc_text}"
        if record.stack_info:
            line = f"{line}\n{self.formatStack(record.stack_info)}"
        return redact_text(line)


class JsonFormatter(logging.Formatter):
    """One JSON object per record; tracebacks as a string in ``exc_info``."""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": _dt.datetime.fromtimestamp(record.created, tz=_dt.timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_text(record.getMessage()),
            "service": getattr(record, "service", None) or current_service(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        if record.exc_info:
            payload["exc_info"] = redact_text(self.formatException(record.exc_info))
        elif record.exc_text:
            payload["exc_info"] = redact_text(record.exc_text)
        if record.stack_info:
            payload["stack_info"] = redact_text(self.formatStack(record.stack_info))
        extras = {key: value for key, value in vars(record).items() if key not in _RESERVED and not key.startswith("_")}
        context = getattr(record, "context", None)
        if isinstance(context, Mapping):
            extras.update(context)
        for key, value in redact_mapping(extras).items():
            payload.setdefault(key, value)
        return json.dumps(payload, default=str, ensure_ascii=False)


def make_formatter(fmt: Optional[str] = None) -> logging.Formatter:
    return JsonFormatter() if resolve_format(fmt) == "json" else TextFormatter()


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


def resolve_level(value: Optional[str] = None) -> int:
    raw = (value if value is not None else os.environ.get("QYM_LOG_LEVEL") or DEFAULT_LEVEL).strip().upper()
    if raw.isdigit():
        return int(raw)
    level = logging.getLevelName(raw)
    if isinstance(level, int):
        return level
    return logging.INFO


def resolve_format(value: Optional[str] = None) -> str:
    raw = (value if value is not None else os.environ.get("QYM_LOG_FORMAT") or DEFAULT_FORMAT).strip().lower()
    return raw if raw in FORMATS else DEFAULT_FORMAT


def _platform_handlers(logger: logging.Logger) -> Iterable[logging.Handler]:
    return [handler for handler in logger.handlers if getattr(handler, _HANDLER_MARKER, False)]


def is_configured() -> bool:
    return _configured


def configure_logging(
    *,
    level: Optional[str] = None,
    fmt: Optional[str] = None,
    service: Optional[str] = None,
    stream: Any = None,
    force: bool = False,
) -> bool:
    """Install the platform log handler once per process.

    Returns ``True`` when this call configured logging, ``False`` when an
    earlier call already had (pass ``force=True`` to reconfigure, e.g. after
    the environment changed in a test). Only this module's own handler is
    replaced; other root handlers (pytest's ``caplog``, a host application's)
    are left alone. The root logger's level is set to ``QYM_LOG_LEVEL`` on the
    first configuration only, so ``caplog.set_level`` keeps working.
    """
    global _configured
    with _configure_lock:
        if _configured and not force:
            return False
        resolved_level = resolve_level(level)
        formatter = make_formatter(fmt)
        root = logging.getLogger()
        for handler in _platform_handlers(root):
            root.removeHandler(handler)
        handler = logging.StreamHandler(stream if stream is not None else sys.stderr)
        setattr(handler, _HANDLER_MARKER, True)
        handler.setFormatter(formatter)
        handler.addFilter(ContextFilter(service))
        handler.addFilter(RedactionFilter())
        root.addHandler(handler)
        root.setLevel(resolved_level)
        # Platform loggers follow the root level unless someone set their own.
        logging.getLogger(ROOT_LOGGER_NAME).setLevel(logging.NOTSET)
        _configure_uvicorn(formatter if resolve_format(fmt) == "json" else None, service)
        _configured = True
        return True


def _configure_uvicorn(formatter: Optional[logging.Formatter], service: Optional[str]) -> None:
    """Redact uvicorn's lines too and, for JSON output, format them the same way.

    uvicorn installs its own handlers on ``uvicorn``/``uvicorn.access`` (which
    do not propagate to root), so they are adjusted in place, not replaced.
    """
    for name in _UVICORN_LOGGERS:
        for handler in logging.getLogger(name).handlers:
            if not any(isinstance(f, RedactionFilter) for f in handler.filters):
                handler.addFilter(ContextFilter(service))
                handler.addFilter(RedactionFilter())
            if formatter is not None:
                handler.setFormatter(formatter)


def apply_platform_format(handlers: Iterable[logging.Handler], *, fmt: Optional[str] = None) -> None:
    """Give handlers someone else installed (Alembic's ``fileConfig``) the platform format and redaction."""
    formatter = make_formatter(fmt) if resolve_format(fmt) == "json" else None
    for handler in handlers:
        if not any(isinstance(f, RedactionFilter) for f in handler.filters):
            handler.addFilter(ContextFilter())
            handler.addFilter(RedactionFilter())
        if formatter is not None:
            handler.setFormatter(formatter)


def reset_logging_for_tests() -> None:
    """Remove the platform handler and forget the configuration (tests only)."""
    global _configured
    with _configure_lock:
        root = logging.getLogger()
        for handler in _platform_handlers(root):
            root.removeHandler(handler)
        _configured = False


__all__ = [
    "REDACTED",
    "ContextFilter",
    "JsonFormatter",
    "RedactionFilter",
    "TextFormatter",
    "apply_platform_format",
    "configure_logging",
    "current_service",
    "get_logger",
    "get_request_id",
    "is_configured",
    "log_exception",
    "make_formatter",
    "redact_mapping",
    "redact_text",
    "reset_logging_for_tests",
    "reset_request_id",
    "set_request_id",
]
