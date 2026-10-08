"""Central platform logging (qym_platform.log) and the request-context middleware."""

from __future__ import annotations

import asyncio
import io
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from qym_platform import log as platform_log
from qym_platform.log import (
    REDACTED,
    configure_logging,
    get_logger,
    log_exception,
    redact_mapping,
    redact_text,
    reset_request_id,
    set_request_id,
)
from qym_platform.middleware.request_context import RequestContextMiddleware, install_request_context


@pytest.fixture
def fresh_logging(monkeypatch):
    """Let a test configure logging from scratch; restore the session setup after."""
    root = logging.getLogger()
    saved_handlers = list(root.handlers)
    saved_level = root.level
    saved_configured = platform_log._configured
    for name in ("QYM_LOG_LEVEL", "QYM_LOG_FORMAT", "QYM_SERVICE", "QYM_ROLE"):
        monkeypatch.delenv(name, raising=False)
    platform_log.reset_logging_for_tests()
    yield
    platform_log.reset_logging_for_tests()
    root.handlers[:] = saved_handlers
    root.setLevel(saved_level)
    platform_log._configured = saved_configured


def _platform_handlers():
    return [h for h in logging.getLogger().handlers if getattr(h, "_qym_platform_handler", False)]


def _emit(stream: io.StringIO) -> str:
    for handler in _platform_handlers():
        handler.flush()
    return stream.getvalue()


# --------------------------------------------------------------------------- #
# get_logger / configure_logging
# --------------------------------------------------------------------------- #


def test_get_logger_namespaces_under_qym_platform():
    assert get_logger("qym_platform.services.retention").name == "qym_platform.services.retention"
    assert get_logger("custom").name == "qym_platform.custom"
    assert get_logger("__main__").name == "qym_platform"
    assert get_logger().name == "qym_platform"


def test_configure_logging_is_idempotent(fresh_logging):
    assert configure_logging(stream=io.StringIO()) is True
    assert configure_logging(stream=io.StringIO()) is False
    assert configure_logging() is False
    assert len(_platform_handlers()) == 1
    # force replaces the platform handler instead of adding a second one.
    assert configure_logging(force=True, stream=io.StringIO()) is True
    assert len(_platform_handlers()) == 1


def test_level_comes_from_env(fresh_logging, monkeypatch):
    monkeypatch.setenv("QYM_LOG_LEVEL", "debug")
    configure_logging(stream=io.StringIO())
    assert logging.getLogger().level == logging.DEBUG

    monkeypatch.setenv("QYM_LOG_LEVEL", "WARNING")
    configure_logging(force=True, stream=io.StringIO())
    assert logging.getLogger().level == logging.WARNING

    monkeypatch.setenv("QYM_LOG_LEVEL", "not-a-level")
    configure_logging(force=True, stream=io.StringIO())
    assert logging.getLogger().level == logging.INFO


def test_default_is_info_text(fresh_logging):
    stream = io.StringIO()
    configure_logging(stream=stream)
    logger = get_logger("tests.text")
    logger.debug("hidden detail")
    logger.info("run %s created", "r-1")
    out = _emit(stream)
    assert "hidden detail" not in out
    line = out.strip().splitlines()[-1]
    assert " INFO qym_platform.tests.text run r-1 created" in line


def test_json_format_includes_fields_and_traceback(fresh_logging, monkeypatch):
    monkeypatch.setenv("QYM_LOG_FORMAT", "json")
    monkeypatch.setenv("QYM_SERVICE", "ingestion")
    stream = io.StringIO()
    configure_logging(stream=stream)
    logger = get_logger("tests.json")
    token = set_request_id("req-123")
    try:
        try:
            raise ZeroDivisionError("division by zero")
        except ZeroDivisionError:
            logger.exception("job %s failed", "job-9", extra={"run_id": "r-7"})
    finally:
        reset_request_id(token)
    record = json.loads(_emit(stream).strip().splitlines()[-1])
    assert record["level"] == "ERROR"
    assert record["logger"] == "qym_platform.tests.json"
    assert record["message"] == "job job-9 failed"
    assert record["service"] == "ingestion"
    assert record["request_id"] == "req-123"
    assert record["run_id"] == "r-7"
    assert record["timestamp"].endswith("+00:00")
    assert "Traceback (most recent call last)" in record["exc_info"]
    assert "ZeroDivisionError: division by zero" in record["exc_info"]


def test_text_format_has_request_id_and_traceback(fresh_logging):
    stream = io.StringIO()
    configure_logging(stream=stream, fmt="text")
    logger = get_logger("tests.text_exc")
    token = set_request_id("abc")
    try:
        try:
            raise ValueError("bad value")
        except ValueError:
            log_exception(logger, "import failed", run_id="r-1")
    finally:
        reset_request_id(token)
    out = _emit(stream)
    assert "[abc] import failed run_id=r-1" in out
    assert "Traceback (most recent call last)" in out
    assert "ValueError: bad value" in out


def test_log_exception_level_and_context_fields(caplog):
    logger = get_logger("tests.helper")
    caplog.set_level(logging.DEBUG, logger=logger.name)
    try:
        raise KeyError("missing")
    except KeyError:
        log_exception(logger, "lookup failed", level=logging.WARNING, key="k1")
    record = caplog.records[-1]
    assert record.levelno == logging.WARNING
    assert record.exc_info and record.exc_info[0] is KeyError
    assert record.getMessage() == "lookup failed key=k1"
    assert record.context == {"key": "k1"}


# --------------------------------------------------------------------------- #
# Redaction
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "text, secret",
    [
        ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
        ("headers={'authorization': 'Basic dXNlcjpwYXNz'}", "dXNlcjpwYXNz"),
        ("calling with bearer tok_123456", "tok_123456"),
        ("api_key=sk_live_1234", "sk_live_1234"),
        ('{"password": "hunter2"}', "hunter2"),
        ("QYM_ADMIN_BOOTSTRAP_TOKEN=boot-123", "boot-123"),
        ("client_secret: s3cr3t", "s3cr3t"),
        ("postgresql://qym:dbpass@db/qym", "dbpass"),
        ("launch qlt_abcdefghijklmnop", "qlt_abcdefghijklmnop"),
        ("read token qym_dr_abcdefghijklmnop", "qym_dr_abcdefghijklmnop"),
        ("key sk-abcdefghijklmnopqrstuvwx", "sk-abcdefghijklmnopqrstuvwx"),
    ],
)
def test_redact_text_masks_credentials(text, secret):
    redacted = redact_text(text)
    assert secret not in redacted
    assert REDACTED in redacted


def test_redact_text_keeps_ordinary_fields():
    text = "max_tokens=512 token_count=3 launch_token_hash matches no configured encryption key run_id=r1"
    assert redact_text(text) == text


def test_redact_mapping_masks_sensitive_keys():
    value = {"api_key": "x", "nested": {"Authorization": "Bearer y", "run": "r1"}, "items": [{"password": "p"}]}
    assert redact_mapping(value) == {
        "api_key": REDACTED,
        "nested": {"Authorization": REDACTED, "run": "r1"},
        "items": [{"password": REDACTED}],
    }


@pytest.mark.parametrize("fmt", ["text", "json"])
def test_secrets_never_reach_platform_output(fresh_logging, fmt):
    stream = io.StringIO()
    configure_logging(stream=stream, fmt=fmt)
    logger = get_logger("tests.redaction")
    logger.warning("request failed: Authorization: Bearer %s api_key=%s", "tok-SECRET-1", "key-SECRET-2")
    try:
        raise RuntimeError("password=pw-SECRET-3 rejected")
    except RuntimeError:
        logger.exception("call failed", extra={"api_key": "key-SECRET-4"})
    out = _emit(stream)
    for secret in ("tok-SECRET-1", "key-SECRET-2", "pw-SECRET-3", "key-SECRET-4"):
        assert secret not in out
    assert "RuntimeError" in out


def test_uvicorn_handlers_get_redaction(fresh_logging):
    uvicorn_logger = logging.getLogger("uvicorn.access")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    uvicorn_logger.addHandler(handler)
    try:
        configure_logging(stream=io.StringIO())
        uvicorn_logger.warning("GET /x?api_key=leaky-value")
        assert "leaky-value" not in stream.getvalue()
    finally:
        uvicorn_logger.removeHandler(handler)


# --------------------------------------------------------------------------- #
# Request context middleware
# --------------------------------------------------------------------------- #


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/ok")
    def ok():
        get_logger("tests.route").info("inside route")
        return {"request_id": platform_log.get_request_id()}

    @app.get("/boom")
    def boom():
        raise RuntimeError("route exploded")

    install_request_context(app)
    return app


def test_request_id_is_generated_and_echoed():
    client = TestClient(_app())
    response = client.get("/ok")
    assert response.status_code == 200
    request_id = response.headers["x-request-id"]
    assert request_id and response.json() == {"request_id": request_id}


def test_safe_incoming_request_id_is_kept_and_unsafe_one_replaced():
    client = TestClient(_app())
    assert client.get("/ok", headers={"X-Request-ID": "edge-42"}).headers["x-request-id"] == "edge-42"
    replaced = client.get("/ok", headers={"X-Request-ID": "bad id\twith spaces"}).headers["x-request-id"]
    assert replaced != "bad id\twith spaces" and " " not in replaced


def test_unhandled_error_is_logged_with_traceback_and_body_unchanged(caplog):
    caplog.set_level(logging.ERROR, logger="qym_platform.middleware.request_context")
    client = TestClient(_app(), raise_server_exceptions=False)
    response = client.get("/boom", headers={"X-Request-ID": "req-boom"})
    assert response.status_code == 500
    assert response.text == "Internal Server Error"
    records = [r for r in caplog.records if r.name == "qym_platform.middleware.request_context"]
    assert len(records) == 1
    record = records[0]
    assert record.exc_info and record.exc_info[0] is RuntimeError
    message = record.getMessage()
    assert "method=GET" in message and "path=/boom" in message
    assert "request_id=req-boom" in message and "status=500" in message


def test_unhandled_error_still_propagates_to_test_clients():
    client = TestClient(_app())
    with pytest.raises(RuntimeError, match="route exploded"):
        client.get("/boom")


def test_request_id_reaches_json_log_lines(fresh_logging):
    stream = io.StringIO()
    configure_logging(stream=stream, fmt="json")
    client = TestClient(_app())
    response = client.get("/ok", headers={"X-Request-ID": "trace-1"})
    assert response.status_code == 200
    lines = [json.loads(line) for line in _emit(stream).strip().splitlines()]
    route_lines = [line for line in lines if line["message"] == "inside route"]
    assert route_lines and route_lines[0]["request_id"] == "trace-1"


def test_app_factories_install_request_context():
    from qym_platform.app import create_app, create_ingestion_app, create_workers_app

    for app in (create_app(), create_ingestion_app(), create_workers_app(runtime_factory=lambda: None)):
        assert any(m.cls is RequestContextMiddleware for m in app.user_middleware)


# --------------------------------------------------------------------------- #
# Representative modules log caught exceptions with their traceback
# --------------------------------------------------------------------------- #


def test_malformed_api_key_hash_is_logged_with_traceback(caplog):
    from qym_platform.security import verify_api_key

    caplog.set_level(logging.WARNING, logger="qym_platform.security")
    assert verify_api_key("token", b"pbkdf2_sha256$not-a-number$c2FsdA==$ZGVyaXZlZA==") is False
    record = next(r for r in caplog.records if r.name == "qym_platform.security")
    assert record.exc_info and record.exc_info[0] is ValueError


def test_undecryptable_llm_key_is_logged_with_traceback(caplog):
    from cryptography.fernet import Fernet, InvalidToken

    from qym_platform.secrets import decrypt_llm_api_key
    from qym_platform.settings import PlatformSettings

    settings = PlatformSettings(llm_config_encryption_key=Fernet.generate_key().decode())
    other = Fernet(Fernet.generate_key()).encrypt(b"sk-not-for-logs").decode()
    caplog.set_level(logging.ERROR, logger="qym_platform.secrets")
    with pytest.raises(RuntimeError):
        decrypt_llm_api_key(other, settings)
    record = next(r for r in caplog.records if r.name == "qym_platform.secrets")
    assert record.exc_info and record.exc_info[0] is InvalidToken
    assert "sk-not-for-logs" not in caplog.text


def test_failed_chat_completion_is_logged_with_traceback(caplog):
    from qym_platform.openai_compat import create_chat_completion_compat

    class _Completions:
        async def create(self, **_kwargs):
            raise ConnectionError("endpoint unreachable")

    class _Client:
        class chat:  # noqa: N801 - mirrors the OpenAI client shape
            completions = _Completions()

    caplog.set_level(logging.WARNING, logger="qym_platform.openai_compat")
    with pytest.raises(ConnectionError):
        asyncio.run(create_chat_completion_compat(_Client(), model="m", messages=[]))
    record = next(r for r in caplog.records if r.name == "qym_platform.openai_compat")
    assert record.exc_info and record.exc_info[0] is ConnectionError


def test_workers_supervision_failure_is_logged_with_traceback(caplog):
    from qym_platform.app import create_workers_app

    class _Runtime:
        def __init__(self):
            self.calls = 0

        def start(self):
            pass

        def stop(self):
            pass

        def status(self):
            return {"loops": {}, "job_executor": {"alive": True}}

        def supervise_once(self):
            self.calls += 1
            raise RuntimeError("loop restart failed")

    runtime = _Runtime()
    caplog.set_level(logging.ERROR, logger="qym_platform.app")
    app = create_workers_app(runtime_factory=lambda: runtime)
    import time

    with TestClient(app):
        deadline = time.monotonic() + 5
        while runtime.calls == 0 and time.monotonic() < deadline:
            time.sleep(0.05)
        time.sleep(0.1)
    records = [r for r in caplog.records if r.name == "qym_platform.app" and r.exc_info]
    assert records and records[0].exc_info[0] is RuntimeError
    assert "workers supervision failed" in records[0].getMessage()
