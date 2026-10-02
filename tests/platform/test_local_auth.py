from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
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
from qym_platform.db.models import AuditLog, LocalAuthCredential, User, UserIdentity, UserRole
from qym_platform.deps import get_db
from qym_platform.security import hash_password
from qym_platform.settings import PlatformSettings
from _helpers import app_client as _client


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


def _change_password(client, email: str, current: str, new: str):
    return client.post(
        "/v1/auth/password/change",
        json={"email": email, "current_password": current, "new_password": new},
        headers=ORIGIN_HEADERS,
    )


def _issue_reset(session_factory, admin_id: str, user_id: str, temporary_password: str) -> None:
    """Commit a reset the way the endpoint does, from a separate session."""
    from qym_platform.api import web as web_api

    with session_factory() as session:
        web_api._store_temporary_password(
            session, session.get(User, user_id), admin_id, hash_password(temporary_password)
        )
        session.commit()


def test_change_password_loses_to_a_reset_committed_after_verification(session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    admin_id = _create_local_user(session_factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    member_id = _create_local_user(session_factory, "member@example.com", "forgotten-pass-1")
    _issue_reset(session_factory, admin_id, member_id, "first-temp-pass-1")
    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)

    real_hash = auth_api.hash_password

    def hash_then_reset_again(password):
        # The admin issues a second reset after the change verified the first one.
        _issue_reset(session_factory, admin_id, member_id, "second-temp-pass-2")
        return real_hash(password)

    monkeypatch.setattr(auth_api, "hash_password", hash_then_reset_again)
    with _client(session_factory) as client:
        stale = _change_password(client, "member@example.com", "first-temp-pass-1", "chosen-pass-123")
        assert stale.status_code == 401
        assert client.get("/v1/me").status_code == 401

    monkeypatch.setattr(auth_api, "hash_password", real_hash)
    with _client(session_factory) as client:
        assert _login(client, "member@example.com", "chosen-pass-123").status_code == 401
        assert _login(client, "member@example.com", "first-temp-pass-1").status_code == 401
        pending = _login(client, "member@example.com", "second-temp-pass-2")
        assert pending.status_code == 403
        assert pending.json()["code"] == "password_change_required"
    with session_factory() as session:
        assert session.get(LocalAuthCredential, member_id).must_change_password is True


def test_temporary_password_is_consumed_by_only_one_change(session_factory, monkeypatch):
    from qym_platform.api import auth as auth_api

    admin_id = _create_local_user(session_factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    member_id = _create_local_user(session_factory, "member@example.com", "forgotten-pass-1")
    _issue_reset(session_factory, admin_id, member_id, "temp-pass-12345")
    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)

    real_hash = auth_api.hash_password

    def hash_after_rival_change(password):
        # A second request with the same temporary password commits first.
        with session_factory() as session:
            credential = session.get(LocalAuthCredential, member_id)
            credential.password_hash = real_hash("rival-pass-1234")
            credential.must_change_password = False
            session.commit()
        return real_hash(password)

    monkeypatch.setattr(auth_api, "hash_password", hash_after_rival_change)
    with _client(session_factory) as client:
        late = _change_password(client, "member@example.com", "temp-pass-12345", "late-pass-12345")
        assert late.status_code == 401
        assert client.get("/v1/me").status_code == 401

    monkeypatch.setattr(auth_api, "hash_password", real_hash)
    with _client(session_factory) as client:
        assert _login(client, "member@example.com", "late-pass-12345").status_code == 401
        assert _login(client, "member@example.com", "temp-pass-12345").status_code == 401
        assert _login(client, "member@example.com", "rival-pass-1234").status_code == 200
        # The consumed temporary password cannot start another change either.
        replay = _change_password(client, "member@example.com", "temp-pass-12345", "replay-pass-123")
        assert replay.status_code == 401


def test_concurrent_first_resets_retry_instead_of_failing(session_factory, monkeypatch):
    from qym_platform.api import web as web_api

    admin_id = _create_local_user(session_factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    with session_factory() as session:
        user = User(email="gitlab@example.com", display_name="GitLab User", role=UserRole.MEMBER, is_active=True)
        session.add(user)
        session.flush()
        session.add(UserIdentity(user_id=user.id, provider="gitlab", subject="g#42", email=user.email, raw_claims={}))
        session.commit()
        user_id = user.id
    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)

    real_store = web_api._store_temporary_password
    calls = []

    def store_while_rival_commits(db, user, actor_id, password_hash):
        real_store(db, user, actor_id, password_hash)
        calls.append(user.id)
        if len(calls) == 1:
            # The rival first reset commits after this one found no credential.
            with session_factory() as other:
                real_store(other, other.get(User, user_id), admin_id, hash_password("rival-temp-pass-1"))
                other.commit()

    monkeypatch.setattr(web_api, "_store_temporary_password", store_while_rival_commits)
    with _client(session_factory) as client:
        assert _login(client, "admin@example.com", "admin-pass-123").status_code == 200
        reset = _reset_password(client, user_id)
    assert reset.status_code == 200
    assert len(calls) == 2

    with _client(session_factory) as client:
        assert _login(client, "gitlab@example.com", "rival-temp-pass-1").status_code == 401
        latest = _login(client, "gitlab@example.com", reset.json()["temporary_password"])
        assert latest.status_code == 403
        assert latest.json()["code"] == "password_change_required"

    with session_factory() as session:
        assert session.query(LocalAuthCredential).filter(LocalAuthCredential.user_id == user_id).count() == 1
        local_identities = session.query(UserIdentity).filter(
            UserIdentity.user_id == user_id, UserIdentity.provider == "local_password"
        )
        assert local_identities.count() == 1
        audits = session.query(AuditLog).filter(AuditLog.action == "user.password_reset").all()
        assert sorted(row.before["had_password"] for row in audits) == [False, True]


def _postgres_app(postgres_engine):
    factory = sessionmaker(bind=postgres_engine, autoflush=False, autocommit=False)
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return app, factory


def _run_together(*calls):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(call) for call in calls]
        return [future.result(timeout=30) for future in futures]


def test_concurrent_password_changes_on_postgres_consume_once(postgres_engine, monkeypatch):
    import threading

    from qym_platform.api import auth as auth_api

    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)
    app, factory = _postgres_app(postgres_engine)
    admin_id = _create_local_user(factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    member_id = _create_local_user(factory, "member@example.com", "forgotten-pass-1")
    _issue_reset(factory, admin_id, member_id, "temp-pass-12345")

    barrier = threading.Barrier(2)
    real_hash = auth_api.hash_password

    def hash_after_both_verified(password):
        digest = real_hash(password)
        barrier.wait(timeout=10)
        return digest

    monkeypatch.setattr(auth_api, "hash_password", hash_after_both_verified)

    def change(new_password):
        client = TestClient(app)
        response = _change_password(client, "member@example.com", "temp-pass-12345", new_password)
        return new_password, response.status_code, client.get("/v1/me").status_code

    results = _run_together(lambda: change("pass-from-a-123"), lambda: change("pass-from-b-123"))
    assert sorted(status for _, status, _ in results) == [200, 401]
    winner = next(password for password, status, _ in results if status == 200)
    loser = next(password for password, status, _ in results if status == 401)
    assert {password: me for password, _, me in results} == {winner: 200, loser: 401}

    monkeypatch.setattr(auth_api, "hash_password", real_hash)
    client = TestClient(app)
    assert _login(client, "member@example.com", loser).status_code == 401
    assert _login(client, "member@example.com", "temp-pass-12345").status_code == 401
    assert _login(client, "member@example.com", winner).status_code == 200


def test_concurrent_first_resets_on_postgres_both_succeed(postgres_engine, monkeypatch):
    import threading

    from qym_platform.api import web as web_api

    _configure_env(monkeypatch, auth_mode="oidc", auth_local_enabled=True)
    app, factory = _postgres_app(postgres_engine)
    _create_local_user(factory, "admin@example.com", "admin-pass-123", role=UserRole.ADMIN)
    with factory() as session:
        user = User(email="gitlab@example.com", display_name="GitLab User", role=UserRole.MEMBER, is_active=True)
        session.add(user)
        session.flush()
        session.add(UserIdentity(user_id=user.id, provider="gitlab", subject="g#42", email=user.email, raw_claims={}))
        session.commit()
        user_id = user.id

    from collections import Counter

    from qym_platform.security import verify_password

    barrier = threading.Barrier(2)
    real_store = web_api._store_temporary_password
    # Each request hashes its own temporary password, so the hash names the request.
    calls = Counter()

    def store_after_both_looked(db, user, actor_id, password_hash):
        real_store(db, user, actor_id, password_hash)
        calls[password_hash] += 1
        if calls[password_hash] == 1:
            barrier.wait(timeout=10)

    monkeypatch.setattr(web_api, "_store_temporary_password", store_after_both_looked)

    def reset():
        client = TestClient(app)
        assert _login(client, "admin@example.com", "admin-pass-123").status_code == 200
        response = _reset_password(client, user_id)
        return response.status_code, response.json().get("temporary_password")

    results = _run_together(reset, reset)
    assert [status for status, _ in results] == [200, 200]
    assert sorted(calls.values()) == [1, 2]
    retried_hash = next(digest for digest, count in calls.items() if count == 2)
    last = next(password for _, password in results if verify_password(password, retried_hash))
    first = next(password for _, password in results if password != last)

    client = TestClient(app)
    assert _login(client, "gitlab@example.com", first).status_code == 401
    assert _login(client, "gitlab@example.com", last).status_code == 403
    with factory() as session:
        assert session.query(LocalAuthCredential).filter(LocalAuthCredential.user_id == user_id).count() == 1
        assert (
            session.query(UserIdentity)
            .filter(UserIdentity.user_id == user_id, UserIdentity.provider == "local_password")
            .count()
            == 1
        )
