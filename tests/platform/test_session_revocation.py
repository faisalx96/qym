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
import threading
import time
from base64 import b64encode
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import itsdangerous
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
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
    # These tests sign people up next to an admin (C077: sign-up is opt-in).
    monkeypatch.setenv("QYM_AUTH_LOCAL_SIGNUP", "true")
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


@pytest.mark.parametrize("change", [{"role": "MEMBER"}, {"is_active": False}])
def test_concurrent_demotions_leave_one_active_admin_on_postgres(monkeypatch, change):
    """Two admins demote each other at once: one wins, the other gets 409."""
    from uuid import uuid4

    from sqlalchemy.engine import make_url

    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    schema = "qym_admins_" + uuid4().hex
    admin_engine = create_engine(url)
    with admin_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(make_url(url).update_query_dict({"options": f"-csearch_path={schema}"}))
    try:
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        with sessions() as db:
            db.add(User(id="admin-1", email="one@example.com", role=UserRole.ADMIN))
            db.add(User(id="admin-2", email="two@example.com", role=UserRole.ADMIN))
            db.commit()
        application = create_app()

        def override_get_db():
            db = sessions()
            try:
                yield db
            finally:
                db.close()

        application.dependency_overrides[get_db] = override_get_db
        results = {}
        with TestClient(application) as client:

            def demote(actor, target):
                headers = {**ORIGIN, "X-User-Email": f"{actor}@example.com"}
                results[target] = client.put(f"/v1/admin/users/{target}", json=change, headers=headers)

            # Both requests start while another transaction holds both admin
            # rows, so neither can finish before the other has started.
            holder = engine.connect()
            transaction = holder.begin()
            holder.execute(text("SELECT id FROM users ORDER BY id FOR UPDATE"))
            threads = [
                threading.Thread(target=demote, args=("one", "admin-2")),
                threading.Thread(target=demote, args=("two", "admin-1")),
            ]
            for thread in threads:
                thread.start()
            time.sleep(1.0)
            assert results == {}, "a demotion did not wait for the admin rows"
            transaction.commit()
            holder.close()
            for thread in threads:
                thread.join(30)
        assert sorted(response.status_code for response in results.values()) == [200, 409]
        with sessions() as db:
            active = db.query(User).filter_by(role=UserRole.ADMIN, is_active=True).count()
            assert active == 1
    finally:
        engine.dispose()
        with admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


def test_admin_cannot_disable_themselves_or_the_last_admin(app, session_factory):
    """A misclick must not leave the platform with no admin who can sign in."""
    with session_factory() as db:
        db.add(User(id="admin-1", email="admin@example.com", role=UserRole.ADMIN))
        db.add(User(id="member-1", email="member@example.com", role=UserRole.MEMBER))
        db.commit()
    headers = {**ORIGIN, "X-User-Email": "admin@example.com"}
    with TestClient(app) as admin:
        own = admin.put("/v1/admin/users/admin-1", json={"is_active": False}, headers=headers)
        assert own.status_code == 400
        assert "own account" in own.json()["detail"]
        demote = admin.put("/v1/admin/users/admin-1", json={"role": "MEMBER"}, headers=headers)
        assert demote.status_code == 409
        # C067: never your own admin role, even with other admins around.
        assert "your own admin role" in demote.json()["detail"]
        # Other users stay manageable.
        member = admin.put("/v1/admin/users/member-1", json={"is_active": False}, headers=headers)
        assert member.status_code == 200

        # With a second admin, either admin can be disabled by the other.
        promote = admin.put(
            "/v1/admin/users/member-1", json={"is_active": True, "role": "ADMIN"}, headers=headers
        )
        assert promote.status_code == 200
        other = admin.put("/v1/admin/users/member-1", json={"is_active": False}, headers=headers)
        assert other.status_code == 200
        # member-1 is disabled now, so admin-1 is the last active admin again.
        last = admin.put("/v1/admin/users/admin-1", json={"role": "MEMBER"}, headers=headers)
        assert last.status_code == 409
    with session_factory() as db:
        admin_row = db.get(User, "admin-1")
        assert admin_row.is_active and admin_row.role == UserRole.ADMIN


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


def test_session_revoked_during_a_touch_answers_401_not_500(app, session_factory):
    """A sign-out or revoke that lands between loading the session row and
    refreshing its last-seen time ends the session; it is not a server error."""
    from sqlalchemy import delete as sql_delete
    from sqlalchemy.orm import Session as OrmSession

    class RacingSession(OrmSession):
        def get(self, entity, ident, **kwargs):
            obj = super().get(entity, ident, **kwargs)
            if entity is UserSession and obj is not None:
                # Another request deletes the row after this one loaded it.
                self.execute(sql_delete(UserSession).where(UserSession.id == ident))
            return obj

    racing = sessionmaker(bind=session_factory.kw["bind"], class_=RacingSession, autoflush=False)

    def override_get_db():
        db = racing()
        try:
            yield db
        finally:
            db.close()

    with _browser(app) as client:
        cookie = _signup(client)
    with session_factory() as db:
        row = db.query(UserSession).one()
        row.last_seen_at = datetime.utcnow() - timedelta(minutes=11)
        db.commit()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as other:
        other.cookies.set("qym_session", cookie)
        assert other.get("/v1/me").status_code == 401


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
