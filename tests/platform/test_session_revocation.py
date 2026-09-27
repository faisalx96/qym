"""C022: sign-in sessions live on the server and end when the user signs out.

A copied session cookie must stop working after sign-out, a password change or
reset, or a user disable; signing in rotates the session; private pages and API data are
sent with ``Cache-Control: no-store`` so Back after sign-out cannot replay them.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from base64 import b64encode
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import itsdangerous
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import LocalAuthCredential, User, UserRole, UserSession
from qym_platform.deps import get_db
from qym_platform.security import hash_password

ORIGIN = {"Origin": "http://testserver"}
SECRET = "test-session-secret"
PASSWORD = "strong-pass-123"


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "true")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", SECRET)
    monkeypatch.setenv("QYM_BASE_URL", "http://testserver")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    try:
        yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    finally:
        engine.dispose()


@pytest.fixture()
def app(session_factory):
    application = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    application.dependency_overrides[get_db] = override_get_db
    yield application
    application.dependency_overrides.clear()


@contextmanager
def _browser(app):
    with TestClient(app) as client:
        yield client


def _signup(client, email: str = "person@example.com") -> str:
    response = client.post(
        "/v1/auth/signup/password",
        json={"email": email, "password": PASSWORD},
        headers=ORIGIN,
    )
    assert response.status_code == 201
    return client.cookies.get("qym_session")


def _login(client, email: str = "person@example.com") -> str:
    response = client.post(
        "/v1/auth/login/password",
        json={"email": email, "password": PASSWORD},
        headers=ORIGIN,
    )
    assert response.status_code == 200
    return client.cookies.get("qym_session")


def _me_status(app, cookie: str) -> int:
    """Replay a cookie from a different browser (a copied cookie)."""
    with TestClient(app) as other:
        other.cookies.set("qym_session", cookie)
        return other.get("/v1/me").status_code


def test_copied_cookie_stops_working_after_sign_out(app, session_factory):
    with _browser(app) as client:
        cookie = _signup(client)
        assert _me_status(app, cookie) == 200

        assert client.post("/v1/auth/logout", headers=ORIGIN).status_code == 200
        assert client.get("/v1/me").status_code == 401

    # The copy was taken before sign-out; the server no longer honors it.
    assert _me_status(app, cookie) == 401
    with session_factory() as db:
        assert db.query(UserSession).count() == 0


def test_sign_out_ends_only_this_browser(app):
    with _browser(app) as laptop, _browser(app) as phone:
        _signup(laptop)
        _login(phone)
        assert phone.post("/v1/auth/logout", headers=ORIGIN).status_code == 200
        assert phone.get("/v1/me").status_code == 401
        assert laptop.get("/v1/me").status_code == 200


def test_sign_in_rotates_the_session(app):
    with _browser(app) as client:
        first = _signup(client)
        second = _login(client)
        assert first != second
        assert client.get("/v1/me").status_code == 200
    assert _me_status(app, first) == 401
    assert _me_status(app, second) == 200


def test_password_change_ends_every_session(app, session_factory):
    with _browser(app) as laptop, _browser(app) as phone:
        _signup(laptop)
        _login(phone)
        with session_factory() as db:
            user = db.query(User).filter(User.email == "person@example.com").one()
            credential = db.get(LocalAuthCredential, user.id)
            credential.password_hash = hash_password("another-pass-456")
            db.commit()
        assert laptop.get("/v1/me").status_code == 401
        assert phone.get("/v1/me").status_code == 401


def test_password_change_endpoint_ends_the_other_sessions(app):
    with _browser(app) as laptop, _browser(app) as phone:
        _signup(laptop)
        old_phone_cookie = _login(phone)
        response = phone.post(
            "/v1/auth/password/change",
            json={
                "email": "person@example.com",
                "current_password": PASSWORD,
                "new_password": "another-pass-456",
            },
            headers=ORIGIN,
        )
        assert response.status_code == 200
        assert laptop.get("/v1/me").status_code == 401
        assert phone.get("/v1/me").status_code == 200
    assert _me_status(app, old_phone_cookie) == 401


def _signed_cookie(session_factory, user_id: str, provider: str) -> str:
    token = f"session-of-{user_id}"
    now = datetime.utcnow()
    with session_factory() as db:
        db.add(
            UserSession(
                id=hashlib.sha256(token.encode()).hexdigest(),
                user_id=user_id,
                provider=provider,
                created_at=now,
                last_seen_at=now,
            )
        )
        db.commit()
    payload = b64encode(
        json.dumps(
            {"qym_sid": token, "qym_user_id": user_id, "qym_auth_provider": provider}
        ).encode()
    )
    return itsdangerous.TimestampSigner(SECRET).sign(payload).decode()


@pytest.mark.parametrize("has_password", [True, False], ids=["password", "provider-only"])
def test_admin_password_reset_ends_every_session(app, session_factory, has_password):
    with session_factory() as db:
        db.add(User(id="admin-1", email="admin@example.com", role=UserRole.ADMIN))
        db.add(User(id="user-1", email="person@example.com", role=UserRole.MEMBER))
        if has_password:
            db.add(LocalAuthCredential(user_id="user-1", password_hash=hash_password(PASSWORD)))
        db.commit()
    cookie = _signed_cookie(session_factory, "user-1", "local_password" if has_password else "gitlab")
    assert _me_status(app, cookie) == 200

    admin_headers = {**ORIGIN, "X-User-Email": "admin@example.com"}
    with TestClient(app) as admin:
        response = admin.post("/v1/admin/users/user-1/reset-password", headers=admin_headers)
        assert response.status_code == 200
    assert _me_status(app, cookie) == 401


def test_other_credential_updates_keep_sessions(app, session_factory):
    with _browser(app) as client:
        _signup(client)
        with session_factory() as db:
            credential = db.query(LocalAuthCredential).one()
            credential.last_login_at = datetime.utcnow()
            db.commit()
        assert client.get("/v1/me").status_code == 200


def test_disabling_a_user_ends_sessions_even_after_re_enable(app, session_factory):
    with session_factory() as db:
        db.add(User(id="admin-1", email="admin@example.com", role=UserRole.ADMIN))
        db.commit()
    admin_headers = {**ORIGIN, "X-User-Email": "admin@example.com"}
    with _browser(app) as client:
        cookie = _signup(client)
        with session_factory() as db:
            user_id = db.query(User.id).filter(User.email == "person@example.com").scalar()
    with TestClient(app) as admin:
        for active in (False, True):
            response = admin.put(
                f"/v1/admin/users/{user_id}", json={"is_active": active}, headers=admin_headers
            )
            assert response.status_code == 200
    assert _me_status(app, cookie) == 401


def test_cookie_without_server_session_is_rejected(app, session_factory):
    """Cookies issued before server-side sessions (no session id) are not trusted."""
    with _browser(app) as client:
        _signup(client)
    with session_factory() as db:
        user_id = db.query(User.id).filter(User.email == "person@example.com").scalar()
    payload = b64encode(
        json.dumps({"qym_user_id": user_id, "qym_auth_provider": "local_password"}).encode()
    )
    legacy = itsdangerous.TimestampSigner(SECRET).sign(payload).decode()
    assert _me_status(app, legacy) == 401


def test_idle_session_expires_on_the_server(app, session_factory):
    with _browser(app) as client:
        cookie = _signup(client)
        with session_factory() as db:
            row = db.query(UserSession).one()
            row.last_seen_at = datetime.utcnow() - timedelta(days=15)
            db.commit()
    assert _me_status(app, cookie) == 401


def test_active_session_refreshes_last_seen(app, session_factory):
    with _browser(app) as client:
        _signup(client)
        stale = datetime.utcnow() - timedelta(days=13)
        with session_factory() as db:
            row = db.query(UserSession).one()
            row.last_seen_at = stale
            db.commit()
        assert client.get("/v1/me").status_code == 200
        with session_factory() as db:
            assert db.query(UserSession).one().last_seen_at > stale + timedelta(days=12)


def test_session_cookie_keeps_the_14_day_lifetime(app):
    with _browser(app) as client:
        response = client.post(
            "/v1/auth/signup/password",
            json={"email": "person@example.com", "password": PASSWORD},
            headers=ORIGIN,
        )
    cookie_header = response.headers["set-cookie"]
    assert f"Max-Age={14 * 24 * 60 * 60}" in cookie_header
    assert "httponly" in cookie_header.lower()


def test_private_responses_are_not_cached(app):
    with _browser(app) as client:
        _signup(client)
        assert client.get("/v1/me").headers["cache-control"] == "no-store"
        page = client.get("/profile")
        assert page.status_code == 200
        assert page.headers["cache-control"] == "no-store"
        assert client.get("/login", follow_redirects=False).headers["cache-control"] == "no-store"
        asset = client.get("/static/auth.js")
        assert asset.status_code == 200
        assert "no-store" not in asset.headers.get("cache-control", "")


def test_static_assets_stay_cacheable_under_a_root_path(monkeypatch):
    """Behind an ingress prefix the mounted app sees /qym/static/...; assets must
    still skip no-store or every page view re-downloads them."""
    from qym_platform import main
    from qym_platform.settings import PlatformSettings

    settings = PlatformSettings(environment="test", auth_mode="none", root_path="/qym")
    monkeypatch.setattr(main, "PlatformSettings", lambda: settings)
    client = TestClient(main.build_app())  # no lifespan: no background workers
    for path in ("/qym/static/auth.js", "/qym/ui/index.html"):
        asset = client.get(path)
        assert asset.status_code == 200
        assert "no-store" not in asset.headers.get("cache-control", "")
    assert client.get("/qym/healthz").headers["cache-control"] == "no-store"
