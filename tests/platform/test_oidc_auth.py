from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

# NOTE: no module-level os.environ writes here — they execute at collection
# time and leak into every other test file in the run (e.g. QYM_BASE_URL
# breaking same-origin checks elsewhere). The session_factory fixture
# monkeypatches everything these tests need.

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
SDK_SRC = ROOT / "packages" / "sdk"
for src in (PLATFORM_SRC, SDK_SRC):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform import auth_oidc
from qym_platform.auth_oidc import ProviderIdentity, oidc_identity_from_claims
from qym_platform.db.base import Base
from qym_platform.db.models import LocalAuthCredential, User, UserIdentity, UserRole
from qym_platform.security import hash_password
from qym_platform.settings import PlatformSettings
from qym_platform.deps import get_db


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "oidc")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("QYM_BASE_URL", "http://testserver")
    monkeypatch.setenv("QYM_AUTH_GOOGLE_CLIENT_ID", "google-client")
    monkeypatch.setenv("QYM_AUTH_GOOGLE_CLIENT_SECRET", "google-secret")
    monkeypatch.setenv("QYM_AUTH_GITHUB_CLIENT_ID", "github-client")
    monkeypatch.setenv("QYM_AUTH_GITHUB_CLIENT_SECRET", "github-secret")
    monkeypatch.setenv("QYM_ADMIN_BOOTSTRAP_TOKEN", "bootstrap-secret")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_unauthenticated_html_redirects_to_login(client):
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/login?next=/"


def test_unauthenticated_json_returns_401(client):
    response = client.get("/v1/me")
    assert response.status_code == 401


def test_google_callback_provisions_user(client, session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject="google-sub",
            email="user@example.com",
            email_verified=True,
            display_name="Google User",
            raw_claims={"sub": "google-sub"},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)

    response = client.get("/v1/auth/callback/google", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/"

    me = client.get("/v1/me")
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "user@example.com"
    assert body["auth_type"] == "oidc"
    assert body["auth_provider"] == "google"

    with session_factory() as session:
        user = session.query(User).filter(User.email == "user@example.com").first()
        assert user is not None
        assert user.role == UserRole.MEMBER
        assert session.query(UserIdentity).filter(UserIdentity.user_id == user.id, UserIdentity.provider == "google").count() == 1


def test_github_callback_provisions_user(client, session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject="github-sub",
            email="octo@example.com",
            email_verified=True,
            display_name="Octo Cat",
            raw_claims={"id": "github-sub"},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)

    response = client.get("/v1/auth/callback/github", follow_redirects=False)
    assert response.status_code == 303

    with session_factory() as session:
        user = session.query(User).filter(User.email == "octo@example.com").first()
        assert user is not None
        assert session.query(UserIdentity).filter(UserIdentity.user_id == user.id, UserIdentity.provider == "github").count() == 1


def test_google_then_github_link_to_same_user(client, session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject=f"{provider}-subject",
            email="linked@example.com",
            email_verified=True,
            display_name="Linked User",
            raw_claims={"provider": provider},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)

    assert client.get("/v1/auth/callback/google", follow_redirects=False).status_code == 303
    assert client.get("/v1/auth/callback/github", follow_redirects=False).status_code == 303

    with session_factory() as session:
        users = session.query(User).filter(User.email == "linked@example.com").all()
        assert len(users) == 1
        identities = session.query(UserIdentity).filter(UserIdentity.user_id == users[0].id).all()
        assert sorted(identity.provider for identity in identities) == ["github", "google"]


def test_github_missing_verified_email_fails(client, monkeypatch):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        raise HTTPException(status_code=401, detail="GitHub account must provide a verified email")

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)
    response = client.get("/v1/auth/callback/github", follow_redirects=False)
    assert response.status_code == 401


def test_logout_clears_session(client, monkeypatch):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject="google-sub",
            email="logout@example.com",
            email_verified=True,
            display_name="Logout User",
            raw_claims={},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)
    assert client.get("/v1/auth/callback/google", follow_redirects=False).status_code == 303
    assert client.get("/v1/me").status_code == 200

    response = client.post("/v1/auth/logout", headers={"Origin": "http://testserver"})
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert client.get("/v1/me").status_code == 401


def test_bootstrap_admin_promotes_first_authenticated_user(client, session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject="google-sub",
            email="bootstrap@example.com",
            email_verified=True,
            display_name="Bootstrap User",
            raw_claims={},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)
    assert client.get("/v1/auth/callback/google", follow_redirects=False).status_code == 303

    response = client.post(
        "/v1/auth/bootstrap-admin",
        json={"bootstrap_token": "bootstrap-secret"},
        headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "ADMIN"

    with session_factory() as session:
        user = session.query(User).filter(User.email == "bootstrap@example.com").first()
        assert user is not None
        assert user.role == UserRole.ADMIN

    second = client.post(
        "/v1/auth/bootstrap-admin",
        json={"bootstrap_token": "bootstrap-secret"},
        headers={"Origin": "http://testserver"},
    )
    assert second.status_code == 200
    assert second.json()["role"] == "ADMIN"


GITLAB_URL = "https://gitlab.corp.example"


def _enable_gitlab(monkeypatch, url: str = GITLAB_URL) -> None:
    monkeypatch.setenv("QYM_AUTH_GITLAB_URL", url)
    monkeypatch.setenv("QYM_AUTH_GITLAB_CLIENT_ID", "gitlab-client")
    monkeypatch.setenv("QYM_AUTH_GITLAB_CLIENT_SECRET", "gitlab-secret")


class _FakeGitLabClient:
    def __init__(self, token, userinfo=None):
        self.token = token
        self._userinfo = userinfo
        self.userinfo_calls = 0
        self.redirect_uri = None

    async def authorize_redirect(self, request, redirect_uri, **kwargs):
        from fastapi.responses import RedirectResponse

        self.redirect_uri = redirect_uri
        return RedirectResponse(f"{GITLAB_URL}/oauth/authorize", status_code=302)

    async def authorize_access_token(self, request):
        return self.token

    async def userinfo(self, token):
        self.userinfo_calls += 1
        return self._userinfo


def test_gitlab_provider_requires_url_and_client_credentials(client, monkeypatch):
    def gitlab_entry():
        providers = client.get("/v1/auth/providers").json()["providers"]
        return next(item for item in providers if item["id"] == "gitlab")

    monkeypatch.delenv("QYM_AUTH_GITLAB_URL", raising=False)
    monkeypatch.delenv("QYM_AUTH_GITLAB_CLIENT_ID", raising=False)
    monkeypatch.delenv("QYM_AUTH_GITLAB_CLIENT_SECRET", raising=False)
    assert gitlab_entry()["enabled"] is False

    _enable_gitlab(monkeypatch, url="")
    assert gitlab_entry()["enabled"] is False

    _enable_gitlab(monkeypatch)
    entry = gitlab_entry()
    assert entry["enabled"] is True
    assert entry["label"] == "Continue with GitLab"

    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    assert gitlab_entry()["enabled"] is False


def test_gitlab_client_uses_instance_discovery_document(monkeypatch):
    _enable_gitlab(monkeypatch, url=f"{GITLAB_URL}/")
    oauth_client = auth_oidc._oauth_client(PlatformSettings(), "gitlab")
    assert oauth_client._server_metadata_url == f"{GITLAB_URL}/.well-known/openid-configuration"
    assert oauth_client.client_kwargs["scope"] == "openid email profile"


def test_gitlab_login_without_instance_url_is_a_client_error(client, monkeypatch):
    _enable_gitlab(monkeypatch, url="")

    response = client.get("/v1/auth/login/gitlab", follow_redirects=False)
    assert response.status_code == 400
    assert response.json()["detail"] == "gitlab login is not configured"


def test_gitlab_login_redirects_with_gitlab_callback(client, monkeypatch):
    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(token={})
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    response = client.get("/v1/auth/login/gitlab?next=/runs", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith(GITLAB_URL)
    assert fake.redirect_uri == "http://testserver/v1/auth/callback/gitlab"


def test_gitlab_exchange_reads_userinfo_when_id_token_has_no_email(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"sub": "42", "nickname": "dev"}},
        userinfo={"sub": "42", "email": "Dev@Corp.Example", "email_verified": True, "name": "Dev Person"},
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    identity = asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert fake.userinfo_calls == 1
    assert identity.provider == "gitlab"
    assert identity.subject == "42"
    assert identity.email == "dev@corp.example"
    assert identity.display_name == "Dev Person"


def test_gitlab_exchange_uses_id_token_email_without_userinfo_call(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"sub": "7", "email": "id@corp.example", "email_verified": True, "preferred_username": "idtok"}}
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    identity = asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert fake.userinfo_calls == 0
    assert identity.email == "id@corp.example"
    assert identity.display_name == "idtok"


def test_gitlab_exchange_rejects_userinfo_for_another_subject(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"sub": "42"}},
        userinfo={"sub": "99", "email": "other@corp.example", "email_verified": True},
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert exc_info.value.status_code == 401


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "1", "email": "a@corp.example", "email_verified": False},
        {"sub": "1", "email": "a@corp.example", "email_verified": "false"},
        {"sub": "1", "email": "a@corp.example"},
        {"sub": "1", "email_verified": True},
        {"email": "a@corp.example", "email_verified": True},
    ],
)
def test_gitlab_identity_requires_verified_email_and_subject(claims):
    with pytest.raises(HTTPException) as exc_info:
        oidc_identity_from_claims("gitlab", claims)
    assert exc_info.value.status_code == 401
    assert "GitLab" in exc_info.value.detail


def test_gitlab_identity_accepts_string_true_email_verified():
    identity = oidc_identity_from_claims("gitlab", {"sub": "1", "email": "a@corp.example", "email_verified": "true"})
    assert identity.email_verified is True


def test_gitlab_callback_links_existing_password_account(client, session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    _enable_gitlab(monkeypatch)
    with session_factory() as session:
        user = User(email="dev@corp.example", display_name="Dev", role=UserRole.MEMBER, is_active=True)
        session.add(user)
        session.flush()
        session.add(LocalAuthCredential(user_id=user.id, password_hash=hash_password("existing-pass-1")))
        session.commit()
        user_id = user.id

    async def fake_exchange(request, provider, settings):
        return oidc_identity_from_claims(
            provider, {"sub": "42", "email": "dev@corp.example", "email_verified": True, "name": "Dev"}
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)

    response = client.get("/v1/auth/callback/gitlab", follow_redirects=False)
    assert response.status_code == 303
    me = client.get("/v1/me").json()
    assert me["id"] == user_id
    assert me["auth_provider"] == "gitlab"

    with session_factory() as session:
        assert session.query(User).filter(User.email == "dev@corp.example").count() == 1
        identity = session.query(UserIdentity).filter(UserIdentity.provider == "gitlab").one()
        assert identity.user_id == user_id
        assert identity.subject == "42"
