from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
SDK_SRC = ROOT / "packages" / "sdk"
for src in (PLATFORM_SRC, SDK_SRC):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.auth_oidc import ProviderIdentity
from qym_platform.db.base import Base
from qym_platform.db.models import AuditLog, LocalAuthCredential, User, UserIdentity, UserRole
from qym_platform.deps import get_db
from qym_platform.security import hash_password
from qym_platform.settings import PlatformSettings


ORIGIN_HEADERS = {"Origin": "http://testserver"}


def _configure_env(
    monkeypatch: pytest.MonkeyPatch,
    *,
    auth_mode: str = "proxy_headers",
    auth_local_enabled: bool = True,
    auth_session_secret: str | None = "test-session-secret",
    google_enabled: bool = False,
) -> None:
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", auth_mode)
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "true" if auth_local_enabled else "false")
    monkeypatch.setenv("QYM_BASE_URL", "http://testserver")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    monkeypatch.setenv("QYM_ADMIN_BOOTSTRAP_TOKEN", "bootstrap-secret")

    if auth_session_secret is None:
        monkeypatch.delenv("QYM_AUTH_SESSION_SECRET", raising=False)
    else:
        monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", auth_session_secret)

    if google_enabled:
        monkeypatch.setenv("QYM_AUTH_GOOGLE_CLIENT_ID", "google-client")
        monkeypatch.setenv("QYM_AUTH_GOOGLE_CLIENT_SECRET", "google-secret")
    else:
        monkeypatch.delenv("QYM_AUTH_GOOGLE_CLIENT_ID", raising=False)
        monkeypatch.delenv("QYM_AUTH_GOOGLE_CLIENT_SECRET", raising=False)

    monkeypatch.delenv("QYM_AUTH_GITHUB_CLIENT_ID", raising=False)
    monkeypatch.delenv("QYM_AUTH_GITHUB_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("QYM_AUTH_GITLAB_URL", raising=False)
    monkeypatch.delenv("QYM_AUTH_GITLAB_CLIENT_ID", raising=False)
    monkeypatch.delenv("QYM_AUTH_GITLAB_CLIENT_SECRET", raising=False)


@pytest.fixture()
def session_factory():
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


@contextmanager
def _client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _create_local_user(
    session_factory, email: str, password: str, *, active: bool = True, role: UserRole = UserRole.MEMBER
) -> str:
    with session_factory() as session:
        user = User(
            email=email,
            display_name="Local User",
            role=role,
            is_active=active,
        )
        session.add(user)
        session.flush()
        session.add(LocalAuthCredential(user_id=user.id, password_hash=hash_password(password)))
        session.add(
            UserIdentity(
                user_id=user.id,
                provider="local_password",
                subject=user.id,
                email=email,
                raw_claims={"email": email, "auth_type": "local_password"},
            )
        )
        session.commit()
        return user.id


def test_auth_providers_reports_local_auth_enabled(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        response = client.get("/v1/auth/providers")
    assert response.status_code == 200
    assert response.json()["local_auth"] == {"enabled": True, "signup_enabled": True}


def test_auth_providers_reports_local_auth_disabled(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=False)
    with _client(session_factory) as client:
        response = client.get("/v1/auth/providers")
    assert response.status_code == 200
    assert response.json()["local_auth"] == {"enabled": False, "signup_enabled": False}


def test_login_page_marks_local_auth_when_enabled(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        response = client.get("/login")
    assert response.status_code == 200
    assert 'name="qym-local-auth" content="enabled"' in response.text


def test_login_page_omits_local_auth_marker_when_disabled(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=False)
    with _client(session_factory) as client:
        response = client.get("/login")
    assert response.status_code == 200
    assert 'name="qym-local-auth" content="enabled"' not in response.text


def test_signup_creates_user_identity_credential_and_session(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        response = client.post(
            "/v1/auth/signup/password?next=/projects/demo",
            json={"email": "new@example.com", "password": "strong-pass-123", "display_name": "New User"},
            headers=ORIGIN_HEADERS,
        )
        assert response.status_code == 201
        assert response.json() == {"ok": True, "next": "/projects/demo"}

        me = client.get("/v1/me")
        assert me.status_code == 200
        assert me.json()["auth_type"] == "local_password"
        assert me.json()["auth_provider"] == "local_password"

    with session_factory() as session:
        user = session.query(User).filter(User.email == "new@example.com").first()
        assert user is not None
        credential = session.query(LocalAuthCredential).filter(LocalAuthCredential.user_id == user.id).first()
        assert credential is not None
        assert credential.last_login_at is None
        identity = (
            session.query(UserIdentity)
            .filter(UserIdentity.user_id == user.id, UserIdentity.provider == "local_password")
            .first()
        )
        assert identity is not None


def test_signup_rejected_when_local_auth_disabled(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=False)
    with _client(session_factory) as client:
        response = client.post(
            "/v1/auth/signup/password",
            json={"email": "new@example.com", "password": "strong-pass-123"},
            headers=ORIGIN_HEADERS,
        )
    assert response.status_code == 400
    assert response.json()["detail"] == "Email/password auth is not enabled"


def test_signup_rejected_for_existing_non_local_account(session_factory, monkeypatch):
    with session_factory() as session:
        user = User(email="existing@example.com", display_name="Existing", role=UserRole.MEMBER, is_active=True)
        session.add(user)
        session.flush()
        session.add(
            UserIdentity(
                user_id=user.id,
                provider="google",
                subject="google-sub",
                email=user.email,
                raw_claims={"sub": "google-sub"},
            )
        )
        session.commit()

    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        response = client.post(
            "/v1/auth/signup/password",
            json={"email": "existing@example.com", "password": "strong-pass-123"},
            headers=ORIGIN_HEADERS,
        )
    assert response.status_code == 409
    assert response.json()["detail"] == "An account with this email already exists"


def test_login_succeeds_for_local_account_and_updates_last_login(session_factory, monkeypatch):
    _create_local_user(session_factory, "local@example.com", "strong-pass-123")
    _configure_env(monkeypatch, auth_local_enabled=True)

    with _client(session_factory) as client:
        response = client.post(
            "/v1/auth/login/password?next=/overview",
            json={"email": "local@example.com", "password": "strong-pass-123"},
            headers=ORIGIN_HEADERS,
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True, "next": "/overview"}
        me = client.get("/v1/me")
        assert me.status_code == 200
        assert me.json()["email"] == "local@example.com"
        assert me.json()["auth_type"] == "local_password"

    with session_factory() as session:
        user = session.query(User).filter(User.email == "local@example.com").first()
        credential = session.query(LocalAuthCredential).filter(LocalAuthCredential.user_id == user.id).first()
        assert credential is not None
        assert credential.last_login_at is not None


@pytest.mark.parametrize(
    ("email", "password", "setup"),
    [
        ("wrong@example.com", "wrong-pass-123", "wrong_password"),
        ("missing@example.com", "strong-pass-123", "missing_credential"),
        ("inactive@example.com", "strong-pass-123", "inactive_user"),
    ],
)
def test_login_rejects_invalid_local_credentials(session_factory, monkeypatch, email, password, setup):
    if setup == "wrong_password":
        _create_local_user(session_factory, email, "correct-pass-123")
    elif setup == "missing_credential":
        with session_factory() as session:
            session.add(User(email=email, display_name="No Credential", role=UserRole.MEMBER, is_active=True))
            session.commit()
    elif setup == "inactive_user":
        _create_local_user(session_factory, email, "strong-pass-123", active=False)

    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        response = client.post(
            "/v1/auth/login/password",
            json={"email": email, "password": password},
            headers=ORIGIN_HEADERS,
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_logout_clears_local_session(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        assert client.post(
            "/v1/auth/signup/password",
            json={"email": "logout@example.com", "password": "strong-pass-123"},
            headers=ORIGIN_HEADERS,
        ).status_code == 201
        assert client.get("/v1/me").status_code == 200
        response = client.post("/v1/auth/logout", headers=ORIGIN_HEADERS)
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert client.get("/v1/me").status_code == 401


def test_bootstrap_admin_promotes_first_local_user(session_factory, monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=True)
    with _client(session_factory) as client:
        assert client.post(
            "/v1/auth/signup/password",
            json={"email": "bootstrap@example.com", "password": "strong-pass-123"},
            headers=ORIGIN_HEADERS,
        ).status_code == 201
        response = client.post(
            "/v1/auth/bootstrap-admin",
            json={"bootstrap_token": "bootstrap-secret"},
            headers=ORIGIN_HEADERS,
        )
        assert response.status_code == 200
        assert response.json()["role"] == "ADMIN"


def test_oidc_flows_still_work_when_local_auth_is_enabled(session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True, google_enabled=True)

    async def fake_exchange(request, provider, settings):
        return ProviderIdentity(
            provider=provider,
            subject="google-sub",
            email="oidc@example.com",
            email_verified=True,
            display_name="OIDC User",
            raw_claims={"sub": "google-sub"},
        )

    monkeypatch.setattr(auth_api, "exchange_provider_identity", fake_exchange)

    with _client(session_factory) as client:
        providers = client.get("/v1/auth/providers").json()
        assert providers["local_auth"]["enabled"] is True
        assert any(item["id"] == "google" and item["enabled"] for item in providers["providers"])

        response = client.get("/v1/auth/callback/google", follow_redirects=False)
        assert response.status_code == 303
        me = client.get("/v1/me")
        assert me.status_code == 200
        assert me.json()["auth_type"] == "oidc"
        assert me.json()["auth_provider"] == "google"


def test_local_auth_requires_session_secret(monkeypatch):
    _configure_env(monkeypatch, auth_local_enabled=False)
    with pytest.raises(RuntimeError, match="QYM_AUTH_SESSION_SECRET is required when session-based auth is enabled"):
        create_app(
            PlatformSettings(
                database_url="sqlite:///:memory:",
                auth_mode="proxy_headers",
                auth_local_enabled=True,
                auth_session_secret="",
                base_url="http://testserver",
                environment="test",
            )
        )


def _login(client, email: str, password: str):
    return client.post(
        "/v1/auth/login/password",
        json={"email": email, "password": password},
        headers=ORIGIN_HEADERS,
    )


def _reset_password(client, user_id: str):
    return client.post(f"/v1/admin/users/{user_id}/reset-password", headers=ORIGIN_HEADERS)


def test_admin_password_reset_requires_new_password_before_session(session_factory, monkeypatch):
    admin_id = _create_local_user(session_factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    member_id = _create_local_user(session_factory, "member@example.com", "forgotten-pass-1")
    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)

    with _client(session_factory) as admin_client:
        assert _login(admin_client, "admin@example.com", "admin-pass-123").status_code == 200
        reset = _reset_password(admin_client, member_id)
    assert reset.status_code == 200
    assert reset.headers["cache-control"] == "no-store"
    temporary_password = reset.json()["temporary_password"]
    assert len(temporary_password) >= 16

    with _client(session_factory) as client:
        assert _login(client, "member@example.com", "forgotten-pass-1").status_code == 401

        gated = _login(client, "member@example.com", temporary_password)
        assert gated.status_code == 403
        assert gated.json()["code"] == "password_change_required"
        assert client.get("/v1/me").status_code == 401

        def change(current: str, new: str):
            return client.post(
                "/v1/auth/password/change?next=/overview",
                json={"email": "member@example.com", "current_password": current, "new_password": new},
                headers=ORIGIN_HEADERS,
            )

        assert change("wrong-temp-pass", "brand-new-pass-1").status_code == 401
        assert change(temporary_password, temporary_password).status_code == 400
        assert change(temporary_password, "short").status_code == 400
        assert client.get("/v1/me").status_code == 401

        changed = change(temporary_password, "brand-new-pass-1")
        assert changed.status_code == 200
        assert changed.json() == {"ok": True, "next": "/overview"}
        me = client.get("/v1/me")
        assert me.status_code == 200
        assert me.json()["email"] == "member@example.com"

    with _client(session_factory) as client:
        assert _login(client, "member@example.com", temporary_password).status_code == 401
        assert _login(client, "member@example.com", "brand-new-pass-1").status_code == 200

    with session_factory() as session:
        credential = session.get(LocalAuthCredential, member_id)
        assert credential.must_change_password is False
        audit = session.query(AuditLog).filter(AuditLog.action == "user.password_reset").one()
        assert audit.actor_user_id == admin_id
        assert audit.entity_id == member_id
        assert audit.before == {"had_password": True}
        assert temporary_password not in str(audit.after)


def test_admin_password_reset_gives_provider_only_user_a_password_login(session_factory, monkeypatch):
    _create_local_user(session_factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    with session_factory() as session:
        user = User(email="gitlab@example.com", display_name="GitLab User", role=UserRole.MEMBER, is_active=True)
        session.add(user)
        session.flush()
        session.add(UserIdentity(user_id=user.id, provider="gitlab", subject="42", email=user.email, raw_claims={}))
        session.commit()
        user_id = user.id
    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)

    with _client(session_factory) as client:
        assert _login(client, "admin@example.com", "admin-pass-123").status_code == 200
        reset = _reset_password(client, user_id)
        assert reset.status_code == 200
        # A second reset replaces the first temporary password.
        second = _reset_password(client, user_id)
        assert second.status_code == 200

    with _client(session_factory) as client:
        assert _login(client, "gitlab@example.com", reset.json()["temporary_password"]).status_code == 401
        gated = _login(client, "gitlab@example.com", second.json()["temporary_password"])
        assert gated.status_code == 403
        assert gated.json()["code"] == "password_change_required"

    with session_factory() as session:
        providers = {
            row.provider for row in session.query(UserIdentity).filter(UserIdentity.user_id == user_id)
        }
        assert providers == {"gitlab", "local_password"}
        audits = session.query(AuditLog).filter(AuditLog.action == "user.password_reset").order_by(AuditLog.id).all()
        assert [row.before for row in audits] == [{"had_password": False}, {"had_password": True}]


def test_admin_password_reset_requires_admin(session_factory, monkeypatch):
    _create_local_user(session_factory, "member@example.com", "member-pass-123")
    other_id = _create_local_user(session_factory, "other@example.com", "other-pass-123")
    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)

    with _client(session_factory) as client:
        assert _reset_password(client, other_id).status_code == 401
        assert _login(client, "member@example.com", "member-pass-123").status_code == 200
        assert _reset_password(client, other_id).status_code == 403

    with _client(session_factory) as client:
        assert _login(client, "other@example.com", "other-pass-123").status_code == 200


def test_admin_password_reset_rejects_unknown_user_and_disabled_local_auth(session_factory, monkeypatch):
    _create_local_user(session_factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    member_id = _create_local_user(session_factory, "member@example.com", "member-pass-123")
    admin_headers = {**ORIGIN_HEADERS, "X-User-Email": "admin@example.com"}

    _configure_env(monkeypatch, auth_mode="proxy_headers", auth_local_enabled=True)
    with _client(session_factory) as client:
        response = client.post("/v1/admin/users/missing-user/reset-password", headers=admin_headers)
        assert response.status_code == 404

    _configure_env(monkeypatch, auth_mode="proxy_headers", auth_local_enabled=False)
    with _client(session_factory) as client:
        response = client.post(f"/v1/admin/users/{member_id}/reset-password", headers=admin_headers)
        assert response.status_code == 400
        assert response.json()["detail"] == "Email/password auth is not enabled"

    with session_factory() as session:
        assert session.get(LocalAuthCredential, member_id).must_change_password is False


def test_change_password_rotates_a_known_password(session_factory, monkeypatch):
    _create_local_user(session_factory, "local@example.com", "old-pass-1234")
    _configure_env(monkeypatch, auth_local_enabled=True)

    with _client(session_factory) as client:
        response = client.post(
            "/v1/auth/password/change",
            json={"email": "local@example.com", "current_password": "old-pass-1234", "new_password": "new-pass-1234"},
            headers=ORIGIN_HEADERS,
        )
        assert response.status_code == 200
        assert _login(client, "local@example.com", "old-pass-1234").status_code == 401
        assert _login(client, "local@example.com", "new-pass-1234").status_code == 200
