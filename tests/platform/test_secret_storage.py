from __future__ import annotations

import asyncio
import os
import sys
import types
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
os.environ.setdefault(
    "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
)
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
SDK_SRC = ROOT / "packages" / "sdk"
for src in (PLATFORM_SRC, SDK_SRC):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.db.models import Project, ProjectLlmConnection, User, UserRole
from _helpers import sqlite_session_factory

PROJECT_ID = "proj-1"
CONNECTIONS_URL = f"/v1/projects/{PROJECT_ID}/llm-connections"


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    with sqlite_session_factory() as factory:
        yield factory


def _headers(email: str) -> dict[str, str]:
    # Origin matches the default base_url so the same-origin write guard allows POST/PUT/DELETE.
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def _seed_admin_and_project(session_factory) -> None:
    """Admins have access to every project, so no membership rows are needed."""
    with session_factory() as session:
        session.add(User(id="user-1", email="user@example.com", role=UserRole.ADMIN))
        session.add(
            Project(
                id=PROJECT_ID, name="Proj", slug="proj", created_by_user_id="user-1"
            )
        )
        session.commit()


def test_connection_key_is_encrypted_and_masked(
    client, session_factory, monkeypatch
) -> None:
    _seed_admin_and_project(session_factory)

    create = client.post(
        CONNECTIONS_URL,
        headers=_headers("user@example.com"),
        json={
            "name": "OpenAI prod",
            "llm_base_url": "https://api.openai.com/v1",
            "llm_api_key": "sk-secret-1234",
            "llm_model": "gpt-4o-mini",
        },
    )
    assert create.status_code == 200
    created = create.json()
    connection_id = created["id"]
    # First connection becomes the default; the raw key is never echoed back.
    assert created["is_default"] is True
    assert created["llm_api_key_set"] is True
    assert created["llm_api_key_hint"] == "••••1234"
    assert "llm_api_key" not in created
    assert "llm_api_key_encrypted" not in created

    with session_factory() as session:
        conn = session.query(ProjectLlmConnection).filter_by(id=connection_id).first()
        assert conn is not None
        assert conn.llm_api_key_encrypted
        assert conn.llm_api_key_last4 == "1234"

    listing = client.get(CONNECTIONS_URL, headers=_headers("user@example.com"))
    assert listing.status_code == 200
    conns = listing.json()["connections"]
    assert len(conns) == 1
    assert conns[0]["llm_api_key_hint"] == "••••1234"

    # ── Test connection: the provider client receives the decrypted key.
    # The max_tokens fallback is owned by test_openai_compat.py.
    captured: dict[str, object] = {}

    class FakeAsyncOpenAI:
        def __init__(self, *, base_url: str, api_key: str, http_client: object):
            captured["base_url"] = base_url
            captured["api_key"] = api_key
            self.chat = types.SimpleNamespace(
                completions=types.SimpleNamespace(create=self._create)
            )

        async def _create(self, **kwargs):
            return types.SimpleNamespace(
                choices=[
                    types.SimpleNamespace(message=types.SimpleNamespace(content="ok"))
                ]
            )

    monkeypatch.setitem(
        sys.modules, "openai", types.SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI)
    )
    test_response = client.post(
        f"{CONNECTIONS_URL}/{connection_id}/test", headers=_headers("user@example.com")
    )
    assert test_response.status_code == 200
    assert captured["api_key"] == "sk-secret-1234"


def test_update_with_keep_preserves_key(client, session_factory) -> None:
    _seed_admin_and_project(session_factory)
    create = client.post(
        CONNECTIONS_URL,
        headers=_headers("user@example.com"),
        json={
            "name": "c1",
            "llm_api_key": "sk-secret-9999",
            "llm_model": "gpt-4o-mini",
        },
    )
    connection_id = create.json()["id"]

    update = client.put(
        f"{CONNECTIONS_URL}/{connection_id}",
        headers=_headers("user@example.com"),
        json={"name": "c1 renamed", "llm_api_key": "__KEEP__", "llm_model": "gpt-4o"},
    )
    assert update.status_code == 200
    assert update.json()["name"] == "c1 renamed"

    with session_factory() as session:
        conn = session.query(ProjectLlmConnection).filter_by(id=connection_id).first()
        assert conn.llm_model == "gpt-4o"
        assert conn.llm_api_key_last4 == "9999"  # key preserved across the rename


def test_private_llm_base_url_is_blocked_by_default(
    client, session_factory, monkeypatch
) -> None:
    _seed_admin_and_project(session_factory)
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "false")

    response = client.post(
        CONNECTIONS_URL,
        headers=_headers("user@example.com"),
        json={
            "name": "metadata service",
            "llm_base_url": "http://127.0.0.1:8080/v1",
            "llm_api_key": "sk-secret",
            "llm_model": "test-model",
        },
    )

    assert response.status_code == 400
    assert "non-public address" in response.json()["detail"]


def test_http_connection_cannot_be_available_for_experiments(
    client, session_factory, monkeypatch
) -> None:
    _seed_admin_and_project(session_factory)
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "false")
    headers = _headers("user@example.com")
    body = {
        "llm_base_url": "http://api.example.com/v1",
        "llm_api_key": "sk-secret-http-9999",
        "llm_model": "m",
    }

    refused = client.post(
        CONNECTIONS_URL,
        headers=headers,
        json={**body, "name": "refused", "available_for_experiments": True},
    )
    assert refused.status_code == 400
    assert "https://" in refused.json()["detail"]
    assert "Available for experiments" in refused.json()["detail"]
    assert "sk-secret-http-9999" not in refused.text

    # Analyzer connections keep accepting public http://.
    analysis = client.post(
        CONNECTIONS_URL,
        headers=headers,
        json={**body, "name": "analysis", "available_for_experiments": False},
    )
    assert analysis.status_code == 200, analysis.text
    assert analysis.json()["available_for_experiments"] is False
    omitted = client.post(CONNECTIONS_URL, headers=headers, json={**body, "name": "omitted"})
    assert omitted.status_code == 200, omitted.text
    assert omitted.json()["available_for_experiments"] is False

    # Toggling it on later is refused too, and changes nothing.
    conn_id = analysis.json()["id"]
    toggle = client.put(
        f"{CONNECTIONS_URL}/{conn_id}",
        headers=headers,
        json={
            **body,
            "name": "analysis",
            "llm_api_key": "__KEEP__",
            "available_for_experiments": True,
        },
    )
    assert toggle.status_code == 400
    with session_factory() as session:
        assert session.get(ProjectLlmConnection, conn_id).available_for_experiments is False

    # An https:// connection is available by default.
    secure = client.post(
        CONNECTIONS_URL,
        headers=headers,
        json={**body, "name": "secure", "llm_base_url": "https://api.example.com/v1"},
    )
    assert secure.json()["available_for_experiments"] is True

    # Local development: QYM_ALLOW_PRIVATE_LLM_BASE_URLS lifts the rule.
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    toggle = client.put(
        f"{CONNECTIONS_URL}/{conn_id}",
        headers=headers,
        json={
            **body,
            "name": "analysis",
            "llm_api_key": "__KEEP__",
            "available_for_experiments": True,
        },
    )
    assert toggle.status_code == 200, toggle.text
    assert toggle.json()["available_for_experiments"] is True


def test_llm_endpoint_validation_rechecks_current_dns(monkeypatch) -> None:
    import qym_platform.llm_endpoint_security as endpoint_security

    responses = iter(
        [
            [(None, None, None, None, ("8.8.8.8", 443))],
            [(None, None, None, None, ("127.0.0.1", 443))],
        ]
    )
    monkeypatch.setattr(
        endpoint_security.socket, "getaddrinfo", lambda *args: next(responses)
    )

    assert asyncio.run(
        endpoint_security._resolve_public_address_async(
            "provider.example", 443, allow_private=False, timeout=1
        )
    ) == "8.8.8.8"
    with pytest.raises(endpoint_security.LlmEndpointValidationError, match="non-public"):
        asyncio.run(
            endpoint_security._resolve_public_address_async(
                "provider.example", 443, allow_private=False, timeout=1
            )
        )


def test_llm_transport_connects_to_the_validated_address(monkeypatch) -> None:
    import qym_platform.llm_endpoint_security as endpoint_security

    backend = endpoint_security.PinnedAsyncNetworkBackend(allow_private=False)
    captured: dict[str, object] = {}
    stream = object()

    async def connect_tcp(host, port, **kwargs):
        captured.update(host=host, port=port, **kwargs)
        return stream

    monkeypatch.setattr(
        endpoint_security,
        "_resolve_public_address",
        lambda *args, **kwargs: "8.8.8.8",
    )
    monkeypatch.setattr(backend._backend, "connect_tcp", connect_tcp)

    assert asyncio.run(backend.connect_tcp("provider.example", 443)) is stream
    assert captured["host"] == "8.8.8.8"
    assert captured["port"] == 443


def test_create_reports_missing_encryption_key(
    client, session_factory, monkeypatch
) -> None:
    # The repo .env supplies an encryption key, so simulate "not configured" at the guard.
    import qym_platform.api.projects as projects_api

    monkeypatch.setattr(projects_api, "encryption_available", lambda *a, **k: False)
    _seed_admin_and_project(session_factory)

    resp = client.post(
        CONNECTIONS_URL,
        headers=_headers("user@example.com"),
        json={
            "name": "c1",
            "llm_api_key": "sk-secret-1234",
            "llm_model": "gpt-4o-mini",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "LLM config encryption is not configured"
