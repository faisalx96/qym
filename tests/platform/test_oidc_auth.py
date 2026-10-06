from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

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

from qym_platform import auth_oidc
from qym_platform.auth_oidc import ProviderIdentity, oidc_identity_from_claims
from qym_platform.db.models import LocalAuthCredential, User, UserIdentity, UserRole
from qym_platform.security import hash_password
from qym_platform.settings import PlatformSettings
from _helpers import sqlite_session_factory


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

    with sqlite_session_factory() as factory:
        yield factory


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


class _FakeGitHubResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _FakeGitHubClient:
    def __init__(self, emails):
        self._payloads = {
            "user": {"id": 1, "login": "octocat", "name": "Octo Cat"},
            "user/emails": emails,
        }

    async def authorize_access_token(self, request):
        return {"access_token": "github-token"}

    async def get(self, path, token):
        return _FakeGitHubResponse(self._payloads[path])


def _github_exchange(monkeypatch, emails):
    import asyncio

    fake = _FakeGitHubClient(emails)
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)
    return asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "github", PlatformSettings()))


def test_github_exchange_rejects_account_without_verified_email(monkeypatch):
    emails = [
        {"email": "primary@example.com", "primary": True, "verified": False},
        {"email": "backup@example.com", "primary": False, "verified": False},
    ]
    with pytest.raises(HTTPException) as exc_info:
        _github_exchange(monkeypatch, emails)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "GitHub account must provide a verified email"


def test_github_exchange_falls_back_to_verified_non_primary_email(monkeypatch):
    emails = [
        {"email": "primary@example.com", "primary": True, "verified": False},
        {"email": "Backup@Example.com", "primary": False, "verified": True},
    ]
    identity = _github_exchange(monkeypatch, emails)
    assert identity.provider == "github"
    assert identity.subject == "1"
    assert identity.email == "backup@example.com"
    assert identity.display_name == "Octo Cat"


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


def _sign_in_with_google(client, monkeypatch, email):
    from qym_platform.api import auth as auth_api

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject=f"google-{email}",
            email=email,
            email_verified=True,
            display_name="",
            raw_claims={},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)
    assert client.get("/v1/auth/callback/google", follow_redirects=False).status_code == 303


def _bootstrap_admin(client, token="bootstrap-secret"):
    return client.post(
        "/v1/auth/bootstrap-admin",
        json={"bootstrap_token": token},
        headers={"Origin": "http://testserver"},
    )


def _role(session_factory, email):
    with session_factory() as session:
        return session.query(User).filter(User.email == email).one().role


def test_bootstrap_admin_promotes_only_the_first_user_with_the_token(client, session_factory, monkeypatch):
    _sign_in_with_google(client, monkeypatch, "bootstrap@example.com")

    wrong_token = _bootstrap_admin(client, token="not-the-bootstrap-secret")
    assert wrong_token.status_code == 403
    assert wrong_token.json()["detail"] == "Invalid bootstrap token"
    assert _role(session_factory, "bootstrap@example.com") == UserRole.MEMBER

    response = _bootstrap_admin(client)
    assert response.status_code == 200
    assert response.json()["role"] == "ADMIN"
    assert _role(session_factory, "bootstrap@example.com") == UserRole.ADMIN

    repeat = _bootstrap_admin(client)
    assert repeat.status_code == 200
    assert repeat.json()["role"] == "ADMIN"

    _sign_in_with_google(client, monkeypatch, "second@example.com")
    second_user = _bootstrap_admin(client)
    assert second_user.status_code == 409
    assert second_user.json()["detail"] == "Admin already exists"
    assert _role(session_factory, "second@example.com") == UserRole.MEMBER


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
        token={"userinfo": {"iss": GITLAB_URL, "sub": "42", "nickname": "dev"}},
        userinfo={"sub": "42", "email": "Dev@Corp.Example", "email_verified": True, "name": "Dev Person"},
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    identity = asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert fake.userinfo_calls == 1
    assert identity.provider == "gitlab"
    assert identity.subject == f"{GITLAB_URL}#42"
    assert identity.email == "dev@corp.example"
    assert identity.display_name == "Dev Person"


def test_gitlab_exchange_uses_id_token_email_without_userinfo_call(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"iss": GITLAB_URL, "sub": "7", "email": "id@corp.example", "email_verified": True, "preferred_username": "idtok"}}
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    identity = asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert fake.userinfo_calls == 0
    assert identity.subject == f"{GITLAB_URL}#7"
    assert identity.email == "id@corp.example"
    assert identity.display_name == "idtok"


def test_gitlab_exchange_rejects_userinfo_for_another_subject(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"iss": GITLAB_URL, "sub": "42"}},
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
            provider,
            {"sub": "42", "email": "dev@corp.example", "email_verified": True, "name": "Dev"},
            issuer=GITLAB_URL,
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
        assert identity.subject == f"{GITLAB_URL}#42"


def _gitlab_sign_in(client, monkeypatch, claims):
    """Run the real exchange and callback with a fake GitLab token."""
    fake = _FakeGitLabClient(token={"userinfo": dict(claims)})
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)
    client.post("/v1/auth/logout", headers={"Origin": "http://testserver"})
    return client.get("/v1/auth/callback/gitlab", follow_redirects=False)


def test_gitlab_subject_is_scoped_to_its_issuer(client, session_factory, monkeypatch):
    # Repointing QYM_AUTH_GITLAB_URL at another instance must not let that
    # instance's user 1 sign in as the first instance's user 1.
    other_gitlab = "https://gitlab-b.corp.example"
    _enable_gitlab(monkeypatch)
    response = _gitlab_sign_in(
        client,
        monkeypatch,
        {"iss": GITLAB_URL, "sub": "1", "email": "root@corp.example", "email_verified": True},
    )
    assert response.status_code == 303
    admin_id = client.get("/v1/me").json()["id"]
    with session_factory() as session:
        session.get(User, admin_id).role = UserRole.ADMIN
        session.commit()

    _enable_gitlab(monkeypatch, url=other_gitlab)
    response = _gitlab_sign_in(
        client,
        monkeypatch,
        {"iss": other_gitlab, "sub": "1", "email": "someone@b.example", "email_verified": True},
    )
    assert response.status_code == 303
    me = client.get("/v1/me").json()
    assert me["id"] != admin_id
    assert me["email"] == "someone@b.example"
    assert me["role"] == "MEMBER"

    with session_factory() as session:
        subjects = sorted(row.subject for row in session.query(UserIdentity).filter(UserIdentity.provider == "gitlab"))
    assert subjects == sorted([f"{GITLAB_URL}#1", f"{other_gitlab}#1"])


def test_gitlab_same_issuer_and_subject_keeps_account_after_email_change(client, monkeypatch):
    _enable_gitlab(monkeypatch)
    _gitlab_sign_in(
        client,
        monkeypatch,
        {"iss": GITLAB_URL, "sub": "5", "email": "old@corp.example", "email_verified": True},
    )
    first_id = client.get("/v1/me").json()["id"]

    response = _gitlab_sign_in(
        client,
        monkeypatch,
        {"iss": GITLAB_URL, "sub": "5", "email": "new@corp.example", "email_verified": True},
    )
    assert response.status_code == 303
    assert client.get("/v1/me").json()["id"] == first_id


def test_gitlab_issuer_comes_from_id_token_not_userinfo(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"iss": GITLAB_URL, "sub": "42"}},
        userinfo={
            "iss": "https://attacker.example",
            "sub": "42",
            "email": "dev@corp.example",
            "email_verified": True,
        },
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    identity = asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert identity.subject == f"{GITLAB_URL}#42"


def test_gitlab_exchange_rejects_id_token_without_issuer(monkeypatch):
    import asyncio

    _enable_gitlab(monkeypatch)
    fake = _FakeGitLabClient(
        token={"userinfo": {"sub": "42", "email": "dev@corp.example", "email_verified": True}},
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "gitlab", PlatformSettings()))
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "GitLab identity is missing issuer"


def test_google_subject_is_not_issuer_scoped(monkeypatch):
    import asyncio

    fake = _FakeGitLabClient(
        token={
            "userinfo": {
                "iss": "https://accounts.google.com",
                "sub": "google-sub",
                "email": "user@example.com",
                "email_verified": True,
            }
        }
    )
    monkeypatch.setattr(auth_oidc, "_oauth_client", lambda settings, provider: fake)

    identity = asyncio.run(auth_oidc.exchange_provider_identity(MagicMock(), "google", PlatformSettings()))
    assert identity.subject == "google-sub"


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "https://gitlab.corp.example",
        "https://gitlab.corp.example/",
        "https://corp.example/gitlab",
        "http://gitlab.internal:8080",
    ],
)
def test_gitlab_url_setting_accepts_http_urls(monkeypatch, value):
    monkeypatch.setenv("QYM_AUTH_GITLAB_URL", value)
    assert PlatformSettings(database_url="sqlite://").auth_gitlab_url == value.strip()


@pytest.mark.parametrize(
    "value",
    [
        "gitlab.corp.example",
        "ftp://gitlab.corp.example",
        "https://",
        "https://gitlab.corp.example/?tenant=a",
        "https://gitlab.corp.example/#frag",
        "https://gitlab.corp.example:notaport",
        "https://git lab.corp.example",
        "https://gitlab.corp.example/.well-known/openid-configuration",
    ],
)
def test_gitlab_url_setting_rejects_malformed_values(monkeypatch, value):
    from pydantic import ValidationError

    monkeypatch.setenv("QYM_AUTH_GITLAB_URL", value)
    with pytest.raises(ValidationError) as exc_info:
        PlatformSettings(database_url="sqlite://")
    assert "QYM_AUTH_GITLAB_URL" in str(exc_info.value)


def test_login_redirect_keeps_every_parameter_of_a_shared_item_link(client):
    response = client.get("/projects/pa/runs/r-1?pass=2&item=a%26b", follow_redirects=False)
    assert response.status_code == 303
    location = urlsplit(response.headers["location"])
    assert location.path == "/login"
    assert parse_qs(location.query)["next"] == ["/projects/pa/runs/r-1?pass=2&item=a%26b"]
