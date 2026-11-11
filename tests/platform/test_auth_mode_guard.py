"""C003: the auth mode cannot leave a deployment open by default.

Outside dev, test and local the UI app refuses auth mode ``none``, an empty or
unknown mode, and ``proxy_headers`` without ``QYM_PROXY_SHARED_SECRET``. In
``proxy_headers`` mode an identity header counts only on a request that sends
the shared secret in ``X-Qym-Proxy-Secret``.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app, create_ingestion_app
from qym_platform.auth import secret_matches
from qym_platform.db.base import Base
from qym_platform.db.models import User, UserRole
from qym_platform.deps import get_db
from qym_platform.settings import (
    PlatformSettings,
    auth_config_error,
    auth_config_warning,
)

SECRET = "proxy-shared-secret"


def _settings(**values) -> PlatformSettings:
    values.setdefault("database_url", "sqlite://")
    return PlatformSettings(**values)


@pytest.mark.parametrize(
    "mode, secret, names",
    [
        ("none", "", ["QYM_AUTH_MODE", "'none'", "QYM_ENVIRONMENT"]),
        ("", "", ["QYM_AUTH_MODE is empty"]),
        ("saml", "", ["QYM_AUTH_MODE is 'saml'", "proxy_headers"]),
        ("proxy_headers", "", ["QYM_PROXY_SHARED_SECRET", "X-Qym-Proxy-Secret"]),
    ],
)
@pytest.mark.parametrize("environment", ["production", "staging", ""])
def test_open_auth_modes_are_refused_outside_dev(mode, secret, names, environment):
    error = auth_config_error(
        _settings(environment=environment, auth_mode=mode, proxy_shared_secret=secret)
    )
    assert error is not None
    for name in names:
        assert name in error


@pytest.mark.parametrize(
    "values",
    [
        {"auth_mode": "proxy_headers", "proxy_shared_secret": SECRET},
        {"auth_mode": "oidc"},
        {
            "auth_mode": " OIDC "
        },  # normalized: the mode a request sees is the mode checked here
    ],
)
def test_closed_auth_modes_start_outside_dev(values):
    assert auth_config_error(_settings(environment="production", **values)) is None


@pytest.mark.parametrize(
    "environment", ["dev", "development", "local", "test", "testing", "Dev"]
)
@pytest.mark.parametrize("mode", ["none", "", "proxy_headers"])
def test_dev_test_and_local_still_start_with_any_mode(environment, mode):
    assert auth_config_error(_settings(environment=environment, auth_mode=mode)) is None


def test_dev_warns_about_headers_without_a_shared_secret():
    assert "QYM_PROXY_SHARED_SECRET" in auth_config_warning(
        _settings(environment="dev", auth_mode="proxy_headers")
    )
    assert (
        auth_config_warning(
            _settings(
                environment="dev", auth_mode="proxy_headers", proxy_shared_secret=SECRET
            )
        )
        is None
    )
    assert auth_config_warning(_settings(environment="dev", auth_mode="none")) is None
    assert (
        auth_config_warning(_settings(environment="production", auth_mode="oidc"))
        is None
    )


def test_ui_app_refuses_to_start_with_an_open_mode_outside_dev():
    with pytest.raises(RuntimeError, match="QYM_AUTH_MODE is 'none'"):
        create_app(_settings(environment="production", auth_mode="none"))
    with pytest.raises(RuntimeError, match="QYM_PROXY_SHARED_SECRET is not set"):
        create_app(_settings(environment="production", auth_mode="proxy_headers"))
    assert create_app(_settings(environment="test", auth_mode="none")) is not None
    # The ingestion service only takes Bearer API keys; it serves no UI identity.
    assert (
        create_ingestion_app(
            _settings(environment="production", auth_mode="none", service="ingestion")
        )
        is not None
    )


def test_auth_mode_is_normalized():
    assert _settings(auth_mode=" Proxy_Headers ").auth_mode == "proxy_headers"


def test_secret_matches_is_constant_time_and_never_matches_an_unset_secret(monkeypatch):
    import hmac

    calls = []
    real = hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(hmac, "compare_digest", spy)
    assert secret_matches("abc", "abc")
    assert not secret_matches("abd", "abc")
    assert not secret_matches(None, "abc")
    assert not secret_matches("", "")
    assert not secret_matches(None, "")
    assert len(calls) == 3


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            User(
                id="admin",
                email="admin@example.test",
                display_name="Admin",
                role=UserRole.ADMIN,
            )
        )
        db.commit()
    yield engine
    engine.dispose()


def _client(engine, monkeypatch, **env) -> TestClient:
    # require_ui_principal reads PlatformSettings() from the environment.
    for key, value in env.items():
        monkeypatch.setenv(f"QYM_{key.upper()}", value)
    app = create_app(PlatformSettings())
    factory = sessionmaker(bind=engine, autoflush=False)

    def override():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    return TestClient(app)


def _users(engine) -> set:
    with Session(engine) as db:
        return {u.email for u in db.query(User).all()}


@pytest.mark.parametrize("environment", ["production", "test"])
def test_proxy_mode_accepts_an_identity_header_only_with_the_shared_secret(
    engine, monkeypatch, environment
):
    client = _client(
        engine,
        monkeypatch,
        environment=environment,
        auth_mode="proxy_headers",
        proxy_shared_secret=SECRET,
    )
    admin = {"X-User-Email": "admin@example.test"}
    # No secret, a wrong secret, or the secret in another header: not accepted as any user.
    assert client.get("/v1/me", headers=admin).status_code == 401
    assert (
        client.get(
            "/v1/me", headers={**admin, "X-Qym-Proxy-Secret": SECRET + "x"}
        ).status_code
        == 401
    )
    assert (
        client.get("/v1/me", headers={**admin, "X-Proxy-Secret": SECRET}).status_code
        == 401
    )
    assert (
        client.get("/v1/me", headers={"X-Email": "admin@example.test"}).status_code
        == 401
    )
    # An unknown email is not auto-provisioned without the secret either.
    assert (
        client.get("/v1/me", headers={"X-User-Email": "new@example.test"}).status_code
        == 401
    )
    assert _users(engine) == {"admin@example.test"}
    # Through the proxy: the header counts.
    resp = client.get("/v1/me", headers={**admin, "X-Qym-Proxy-Secret": SECRET})
    assert resp.status_code == 200
    assert (
        resp.json()["email"] == "admin@example.test"
        and resp.json()["auth_type"] == "proxy_headers"
    )


def test_dev_proxy_mode_without_a_secret_keeps_accepting_headers(engine, monkeypatch):
    monkeypatch.delenv("QYM_PROXY_SHARED_SECRET", raising=False)
    client = _client(engine, monkeypatch, environment="test", auth_mode="proxy_headers")
    resp = client.get("/v1/me", headers={"X-User-Email": "admin@example.test"})
    assert resp.status_code == 200 and resp.json()["email"] == "admin@example.test"


@pytest.mark.parametrize("mode", ["", "saml"])
def test_identity_headers_count_only_in_proxy_headers_mode(engine, monkeypatch, mode):
    # Before C003 an empty or unknown mode took the same header path as proxy_headers.
    client = _client(engine, monkeypatch, environment="test", auth_mode=mode)
    assert (
        client.get("/v1/me", headers={"X-User-Email": "admin@example.test"}).status_code
        == 401
    )
