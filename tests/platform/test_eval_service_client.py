from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.llm_endpoint_security import (
    LlmEndpointValidationError,
    PinnedAsyncTransport,
)
from qym_platform.services import eval_service_client as esc
from qym_platform.services.eval_service_client import (
    EnvAuthError,
    EvalServiceClient,
    EvalServiceError,
    HighPriorityActive,
    NotCancellable,
    RemoteConflict,
    RemoteNotFound,
    RequestRejected,
    RetryableError,
)

BASE_URL = "https://eval.example.com/prefix"
ENV_KEY = "env-key-SUPERSECRET"
PROVIDER_KEY = "sk-provider-LEAKME"
JOB_ID = "5b1e0000-0000-0000-0000-000000000001"


def _job(**overrides):
    job = {
        "id": JOB_ID,
        "status": "PENDING",
        "priority": "NORMAL",
        "user_id": "user-1",
        "cancelled_by_user_id": None,
        "created_at": "2026-09-27T10:00:00+00:00",
        "updated_at": None,
        # The service stores env overrides flattened as strings (D1).
        "env_overrides": {
            "LLM_OVERRIDES": json.dumps(
                {
                    "endpoints": {
                        "primary": {
                            "model": "gpt-4o",
                            "base_url": "https://llm.example.com/v1",
                            "api_key": PROVIDER_KEY,
                        },
                        "cheap": {"model": "mini", "api_key": PROVIDER_KEY},
                    },
                    "main": {"endpoint": "primary", "temperature": 0.2},
                }
            ),
            "BRIEF_ENABLED": "true",
        },
        "eval_input": {"dataset": "ds", "model": "gpt-4o", "config": {}},
        "result": None,
        "error": None,
    }
    job.update(overrides)
    return job


def _run(handler, call):
    """Run ``call(client)`` against a MockTransport-backed client."""
    requests = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    async def main():
        http = httpx.AsyncClient(transport=httpx.MockTransport(recording_handler))
        async with http:
            client = EvalServiceClient(
                BASE_URL, ENV_KEY, allow_private=False, http_client=http
            )
            return await call(client)

    return asyncio.run(main()), requests


def _raises(handler, call, exc_type):
    with pytest.raises(exc_type) as info:
        _run(handler, call)
    return info.value


def _assert_no_secrets(*values):
    for value in values:
        text = value if isinstance(value, str) else json.dumps(value, default=repr)
        assert PROVIDER_KEY not in text
        assert ENV_KEY not in text


# --------------------------------------------------------------------------- #
# Success paths
# --------------------------------------------------------------------------- #


def test_submit_202_sends_bearer_and_redacts_echoed_provider_keys(caplog):
    caplog.set_level(logging.DEBUG, logger=esc.__name__)
    body = {
        "user_id": "user-1",
        "priority": "NORMAL",
        "env_overrides": {
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"model": "gpt-4o", "api_key": PROVIDER_KEY}}
            }
        },
        "evaluator": {"dataset": "ds"},
    }

    result, requests = _run(
        lambda request: httpx.Response(202, json=_job()),
        lambda client: client.submit(body),
    )

    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == f"{BASE_URL}/evals"
    assert request.headers["Authorization"] == f"Bearer {ENV_KEY}"
    # The real key must reach the service, only responses are redacted.
    assert json.loads(request.content) == body

    assert result["id"] == JOB_ID
    overrides = json.loads(result["env_overrides"]["LLM_OVERRIDES"])
    assert overrides["endpoints"]["primary"]["api_key"] == esc.REDACTED
    assert overrides["endpoints"]["cheap"]["api_key"] == esc.REDACTED
    assert overrides["endpoints"]["primary"]["model"] == "gpt-4o"
    assert overrides["main"] == {"endpoint": "primary", "temperature": 0.2}
    assert result["env_overrides"]["BRIEF_ENABLED"] == "true"
    _assert_no_secrets(result, caplog.text)
    assert "Authorization" in caplog.text and esc.REDACTED in caplog.text


def test_get_redacts_structured_overrides_and_quotes_job_id():
    job = _job(
        env_overrides={
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"model": "m", "api_key": PROVIDER_KEY}}
            }
        }
    )
    result, requests = _run(
        lambda request: httpx.Response(200, json=job),
        lambda client: client.get(JOB_ID),
    )
    assert requests[0].url.path == f"/prefix/evals/{JOB_ID}"
    endpoints = result["env_overrides"]["LLM_OVERRIDES"]["endpoints"]
    assert endpoints["primary"] == {"model": "m", "api_key": esc.REDACTED}
    _assert_no_secrets(result)


def test_list_passes_filters_and_redacts_every_item():
    page = {"total": 2, "limit": 20, "offset": 0, "items": [_job(), _job()]}
    result, requests = _run(
        lambda request: httpx.Response(200, json=page),
        lambda client: client.list(status="RUNNING", user_id="u", limit=20, offset=0),
    )
    params = dict(requests[0].url.params)
    assert params == {"status": "RUNNING", "user_id": "u", "limit": "20", "offset": "0"}
    assert result["total"] == 2 and len(result["items"]) == 2
    _assert_no_secrets(result)


def test_cancel_posts_user_id():
    result, requests = _run(
        lambda request: httpx.Response(200, json=_job(status="CANCELLED")),
        lambda client: client.cancel(JOB_ID, "user-9"),
    )
    assert requests[0].method == "POST"
    assert requests[0].url.path == f"/prefix/evals/{JOB_ID}/cancel"
    assert json.loads(requests[0].content) == {"user_id": "user-9"}
    assert result["status"] == "CANCELLED"
    _assert_no_secrets(result)


def test_env_overrides_schema_keeps_shape_but_masks_secret_defaults():
    schema = {
        "$defs": {
            "EndpointConfig": {
                "properties": {
                    "api_key": {"type": "string", "default": PROVIDER_KEY},
                    "model": {"type": "string", "default": "gpt-4o"},
                }
            }
        },
        "properties": {"MILVUS_SEARCH_THRESHOLD": {"type": "number"}},
    }
    result, requests = _run(
        lambda request: httpx.Response(200, json=schema),
        lambda client: client.env_overrides_schema(),
    )
    assert requests[0].url.path == "/prefix/evals/env-overrides/schema"
    props = result["$defs"]["EndpointConfig"]["properties"]
    assert props["api_key"] == {"type": "string", "default": esc.REDACTED}
    assert props["model"]["default"] == "gpt-4o"
    assert result["properties"] == schema["properties"]
    _assert_no_secrets(result)


# --------------------------------------------------------------------------- #
# Error mapping
# --------------------------------------------------------------------------- #


def test_401_maps_to_env_auth_error():
    exc = _raises(
        lambda request: httpx.Response(
            401, json={"detail": "Invalid or missing API key"}
        ),
        lambda client: client.get(JOB_ID),
        EnvAuthError,
    )
    assert exc.status_code == 401
    _assert_no_secrets(str(exc), repr(exc))


def test_404_maps_to_remote_not_found():
    exc = _raises(
        lambda request: httpx.Response(404, json={"detail": "eval job not found"}),
        lambda client: client.cancel(JOB_ID, "u"),
        RemoteNotFound,
    )
    assert exc.status_code == 404
    assert "not found" in str(exc)


def test_409_on_submit_maps_to_high_priority_active():
    detail = (
        "cannot accept NORMAL priority job while HIGH priority job "
        "9f00-high-job is active"
    )
    exc = _raises(
        lambda request: httpx.Response(409, json={"detail": detail}),
        lambda client: client.submit({"user_id": "u", "evaluator": {"dataset": "d"}}),
        HighPriorityActive,
    )
    assert exc.job_id == "9f00-high-job"
    assert exc.priority == "NORMAL"
    assert exc.status_code == 409


@pytest.mark.parametrize("status", ["SUCCEEDED", "JobStatus.CANCELLED"])
def test_409_on_cancel_maps_to_not_cancellable(status):
    exc = _raises(
        lambda request: httpx.Response(
            409, json={"detail": f"cannot cancel job in status {status}"}
        ),
        lambda client: client.cancel(JOB_ID, "u"),
        NotCancellable,
    )
    assert exc.status == status.rsplit(".", 1)[-1]


def test_unrecognized_409_is_generic_conflict():
    exc = _raises(
        lambda request: httpx.Response(409, json={"detail": "something else"}),
        lambda client: client.get(JOB_ID),
        RemoteConflict,
    )
    assert not isinstance(exc, (HighPriorityActive, NotCancellable))


def test_422_preserves_loc_and_drops_echoed_input(caplog):
    caplog.set_level(logging.DEBUG, logger=esc.__name__)
    detail = [
        {
            "type": "extra_forbidden",
            "loc": [
                "body",
                "env_overrides",
                "LLM_OVERRIDES",
                "endpoints",
                "primary",
                "api_kee",
            ],
            "msg": "Extra inputs are not permitted",
            "input": PROVIDER_KEY,
        },
        {
            "type": "missing",
            "loc": ["body", "user_id"],
            "msg": "Field required",
            "input": {"api_key": PROVIDER_KEY},
        },
    ]
    exc = _raises(
        lambda request: httpx.Response(422, json={"detail": detail}),
        lambda client: client.submit({"evaluator": {"dataset": "d"}}),
        RequestRejected,
    )
    assert exc.errors == [
        {
            "loc": [
                "body",
                "env_overrides",
                "LLM_OVERRIDES",
                "endpoints",
                "primary",
                "api_kee",
            ],
            "msg": "Extra inputs are not permitted",
            "type": "extra_forbidden",
        },
        {"loc": ["body", "user_id"], "msg": "Field required", "type": "missing"},
    ]
    assert "body.user_id: Field required" in str(exc)
    _assert_no_secrets(str(exc), exc.errors, caplog.text)


@pytest.mark.parametrize("status", [500, 502, 503, 429])
def test_5xx_maps_to_retryable(status, caplog):
    caplog.set_level(logging.DEBUG, logger=esc.__name__)
    exc = _raises(
        lambda request: httpx.Response(
            status, text=f"Traceback ... api_key='{PROVIDER_KEY}'"
        ),
        lambda client: client.get(JOB_ID),
        RetryableError,
    )
    assert exc.status_code == status
    _assert_no_secrets(str(exc), caplog.text)


def test_transport_error_maps_to_retryable(caplog):
    caplog.set_level(logging.DEBUG, logger=esc.__name__)

    def handler(request):
        raise httpx.ConnectError(
            f"boom Authorization: Bearer {ENV_KEY}", request=request
        )

    exc = _raises(handler, lambda client: client.get(JOB_ID), RetryableError)
    assert exc.__cause__ is None
    _assert_no_secrets(str(exc), caplog.text)


def test_timeout_maps_to_retryable():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    _raises(handler, lambda client: client.get(JOB_ID), RetryableError)


def test_error_detail_with_secret_is_scrubbed():
    exc = _raises(
        lambda request: httpx.Response(
            400, json={"detail": f"bad api_key={PROVIDER_KEY}"}
        ),
        lambda client: client.get(JOB_ID),
        EvalServiceError,
    )
    assert exc.status_code == 400
    _assert_no_secrets(str(exc))


# --------------------------------------------------------------------------- #
# Construction
# --------------------------------------------------------------------------- #


def test_default_client_uses_ssrf_safe_transport_and_timeouts():
    async def main():
        client = EvalServiceClient(BASE_URL + "/", ENV_KEY, allow_private=False)
        try:
            http = client._http
            assert isinstance(http._transport, PinnedAsyncTransport)
            assert http.follow_redirects is False
            assert http.timeout.connect == 5.0
            assert http.timeout.read == 30.0
            assert client.base_url == BASE_URL
            assert ENV_KEY not in repr(client)
        finally:
            await client.aclose()

    asyncio.run(main())


def test_private_base_url_rejected_unless_allowed():
    with pytest.raises(LlmEndpointValidationError):
        EvalServiceClient("http://127.0.0.1:8000", ENV_KEY, allow_private=False)
    client = EvalServiceClient(
        "http://127.0.0.1:8000",
        ENV_KEY,
        allow_private=True,
        http_client=httpx.AsyncClient(),
    )
    assert client.base_url == "http://127.0.0.1:8000"


def test_allow_private_defaults_to_platform_setting(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    client = EvalServiceClient(
        "http://127.0.0.1:9000", ENV_KEY, http_client=httpx.AsyncClient()
    )
    assert client.base_url == "http://127.0.0.1:9000"
