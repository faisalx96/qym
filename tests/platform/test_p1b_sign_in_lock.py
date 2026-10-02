"""Sign-in lock per client (P1 round 2, final-review decision on C077).

The strict lock keys on (email, client): 5 wrong passwords in 5 minutes
refuse only the client that made them, and the right password from another
client still works. A high per-email ceiling (default 50 in 15 minutes) holds
across all clients, the per-client cap (30) stays, and "account already
exists" answers at sign-up count only against the client.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db import dashboard_models, maintenance_models  # noqa: F401  (tables)
from qym_platform.db.base import Base
from qym_platform.db.models import LocalAuthCredential, User, UserRole
from qym_platform.deps import get_db
from qym_platform.login_throttle import LoginThrottle, login_throttle
from qym_platform.security import hash_password
from qym_platform.settings import PlatformSettings

ORIGIN = {"Origin": "http://testserver"}
PASSWORD = "strong-pass-123"


@pytest.fixture()
def local(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "true")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    monkeypatch.setenv("QYM_BASE_URL", "http://testserver")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    monkeypatch.delenv("QYM_AUTH_LOCAL_SIGNUP", raising=False)
    for name in (
        "QYM_AUTH_LOGIN_MAX_FAILURES_PER_EMAIL",
        "QYM_AUTH_LOGIN_MAX_FAILURES_PER_CLIENT",
        "QYM_AUTH_LOGIN_FAILURE_WINDOW_SECONDS",
        "QYM_AUTH_LOGIN_EMAIL_CEILING",
        "QYM_AUTH_LOGIN_EMAIL_CEILING_WINDOW_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        # An admin exists, so sign-up stays off unless QYM_AUTH_LOCAL_SIGNUP.
        db.add(User(id="admin", email="admin@x.com", role=UserRole.ADMIN))
        db.add(User(id="u1", email="person@x.com", role=UserRole.MEMBER))
        db.flush()
        db.add(LocalAuthCredential(user_id="u1", password_hash=hash_password(PASSWORD)))
        db.commit()
    yield make
    engine.dispose()


def _app(make):
    app = create_app()

    def override_get_db():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return app


def _login(client, email, password):
    return client.post(
        "/v1/auth/login/password",
        json={"email": email, "password": password},
        headers=ORIGIN,
    )


def test_wrong_passwords_lock_only_the_client_that_sent_them(local):
    app = _app(local)
    with TestClient(app, client=("10.0.0.1", 1)) as attacker, TestClient(
        app, client=("10.0.0.2", 1)
    ) as person:
        for _ in range(5):
            assert _login(attacker, "person@x.com", "wrong-password").status_code == 401
        # The client that guessed is refused, even with the right password.
        blocked = _login(attacker, "person@x.com", PASSWORD)
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) > 0
        # The person signs in from their own client.
        assert _login(person, "person@x.com", PASSWORD).status_code == 200
        # The change-password step follows the same rule.
        change = attacker.post(
            "/v1/auth/password/change",
            json={"email": "person@x.com", "current_password": PASSWORD, "new_password": "another-pass-1"},
            headers=ORIGIN,
        )
        assert change.status_code == 429


def test_the_email_ceiling_holds_across_clients(local, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOGIN_EMAIL_CEILING", "6")
    app = _app(local)
    for index in range(3):
        with TestClient(app, client=(f"10.0.1.{index}", 1)) as guesser:
            for _ in range(2):
                assert _login(guesser, "person@x.com", "wrong-password").status_code == 401
    # Six failures from three clients reach the ceiling: the email pauses
    # everywhere, also for a client that never failed and the right password.
    with TestClient(app, client=("10.0.2.1", 1)) as person:
        refused = _login(person, "person@x.com", PASSWORD)
        assert refused.status_code == 429
        assert "Too many sign-in attempts" in refused.json()["detail"]
        # Other emails are not affected.
        assert _login(person, "nobody@x.com", "wrong-password").status_code == 401


def test_the_per_client_cap_still_holds(local, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOGIN_MAX_FAILURES_PER_CLIENT", "3")
    app = _app(local)
    with TestClient(app, client=("10.0.3.1", 1)) as guesser, TestClient(
        app, client=("10.0.3.2", 1)
    ) as person:
        for index in range(3):
            assert _login(guesser, f"guess{index}@x.com", "wrong-password").status_code == 401
        assert _login(guesser, "person@x.com", PASSWORD).status_code == 429
        assert _login(person, "person@x.com", PASSWORD).status_code == 200


def test_existing_email_at_sign_up_counts_only_against_the_client(local, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOCAL_SIGNUP", "true")
    monkeypatch.setenv("QYM_AUTH_LOGIN_MAX_FAILURES_PER_CLIENT", "8")
    app = _app(local)
    payload = {"email": "person@x.com", "password": PASSWORD}
    with TestClient(app, client=("10.0.4.1", 1)) as client:
        for _ in range(6):
            taken = client.post("/v1/auth/signup/password", json=payload, headers=ORIGIN)
            assert taken.status_code == 409
        # Six "already exists" answers did not lock the email, not even for
        # this client: the right password still signs in.
        assert _login(client, "person@x.com", PASSWORD).status_code == 200
    throttle = app.state.login_throttle
    assert not any(key.startswith(("email:", "pair:")) for key in throttle._failures)
    with TestClient(app, client=("10.0.4.1", 1)) as client:
        # They count for the client: two more failures reach its cap of 8.
        for _ in range(2):
            assert client.post("/v1/auth/signup/password", json=payload, headers=ORIGIN).status_code == 409
        assert client.post("/v1/auth/signup/password", json=payload, headers=ORIGIN).status_code == 429
        assert _login(client, "person@x.com", PASSWORD).status_code == 429


def test_settings_keep_working_and_add_the_ceiling(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite://")
    for name in (
        "QYM_AUTH_LOGIN_MAX_FAILURES_PER_EMAIL",
        "QYM_AUTH_LOGIN_MAX_FAILURES_PER_CLIENT",
        "QYM_AUTH_LOGIN_FAILURE_WINDOW_SECONDS",
        "QYM_AUTH_LOGIN_EMAIL_CEILING",
        "QYM_AUTH_LOGIN_EMAIL_CEILING_WINDOW_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    defaults = PlatformSettings()
    assert (
        defaults.auth_login_max_failures_per_email,
        defaults.auth_login_max_failures_per_client,
        defaults.auth_login_failure_window_seconds,
        defaults.auth_login_email_ceiling,
        defaults.auth_login_email_ceiling_window_seconds,
    ) == (5, 30, 300, 50, 900)

    monkeypatch.setenv("QYM_AUTH_LOGIN_MAX_FAILURES_PER_EMAIL", "2")
    monkeypatch.setenv("QYM_AUTH_LOGIN_EMAIL_CEILING", "40")
    monkeypatch.setenv("QYM_AUTH_LOGIN_EMAIL_CEILING_WINDOW_SECONDS", "600")

    class _State:
        pass

    class _App:
        state = _State()

    class _Request:
        app = _App()

    throttle = login_throttle(_Request())
    assert (throttle.max_per_email, throttle.email_ceiling, throttle.email_ceiling_window_seconds) == (2, 40, 600)


def test_ceiling_window_and_pair_lock_age_out_on_their_own_clocks():
    now = [1000.0]
    throttle = LoginThrottle(
        max_per_email=2,
        max_per_client=100,
        window_seconds=60,
        email_ceiling=3,
        email_ceiling_window_seconds=600,
        clock=lambda: now[0],
    )
    throttle.record_failure("a@x.com", "c1")
    throttle.record_failure("a@x.com", "c1")
    with pytest.raises(Exception) as pair:
        throttle.check("a@x.com", "c1")
    assert pair.value.status_code == 429 and pair.value.headers["Retry-After"] == "60"
    throttle.check("a@x.com", "c2")
    throttle.record_failure("a@x.com", "c2")
    # Three failures across clients reach the ceiling for every client.
    with pytest.raises(Exception) as ceiling:
        throttle.check("a@x.com", "c3")
    assert ceiling.value.headers["Retry-After"] == "600"
    # A success clears only that client's strict lock, not the ceiling.
    throttle.record_success("a@x.com", "c1")
    with pytest.raises(Exception):
        throttle.check("a@x.com", "c1")
    now[0] += 601
    throttle.check("a@x.com", "c1")
    throttle.check("a@x.com", "c3")


# Final review: concurrent attempts. Checking a password takes hundreds of
# milliseconds, so the check and the count are one step: an attempt counts
# as a failure from the moment it passes the check.


@pytest.fixture()
def threaded_local(local, tmp_path):
    """``local`` on a file database with one connection per request thread,
    so a burst of concurrent requests runs as it does on PostgreSQL."""
    from sqlalchemy.pool import NullPool

    engine = create_engine(
        f"sqlite:///{tmp_path / 'auth.db'}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with local() as source, make() as db:
        for user in source.query(User).all():
            db.add(User(id=user.id, email=user.email, role=user.role))
        db.flush()
        for credential in source.query(LocalAuthCredential).all():
            db.add(LocalAuthCredential(user_id=credential.user_id, password_hash=credential.password_hash))
        db.commit()
    yield make
    engine.dispose()


def _burst(app, host, count, send):
    """Start ``count`` requests from one client at once; count the answers."""
    import threading
    from collections import Counter

    codes = Counter()
    guard = threading.Lock()
    barrier = threading.Barrier(count)
    with TestClient(app, client=(host, 1)) as client:

        def one(index):
            barrier.wait()
            code = send(client, index).status_code
            with guard:
                codes[code] += 1

        threads = [threading.Thread(target=one, args=(index,)) for index in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(60)
    return dict(codes)


def _slow(monkeypatch, name, result):
    """Make ``qym_platform.api.auth.<name>`` take 0.3 s, as PBKDF2 does, so
    every request of a burst is in flight while the others are checked."""
    import time

    from qym_platform.api import auth as auth_api

    def slow(*_args):
        time.sleep(0.3)
        return result

    monkeypatch.setattr(auth_api, name, slow)


def test_a_burst_of_wrong_passwords_stops_at_the_strict_lock(threaded_local, monkeypatch):
    app = _app(threaded_local)
    with TestClient(app, client=("10.0.5.1", 1)) as client:
        assert _login(client, "person@x.com", "wrong-0").status_code == 401
    _slow(monkeypatch, "verify_password", False)
    codes = _burst(
        app, "10.0.5.1", 20, lambda client, index: _login(client, "person@x.com", f"wrong-{index + 1}")
    )
    # 5 per (email, client): four more password checks after the first.
    assert codes == {401: 4, 429: 16}
    throttle = app.state.login_throttle
    assert len(throttle._failures[throttle._pair_key("person@x.com", "10.0.5.1")]) == 5


def test_a_burst_of_wrong_passwords_stops_at_the_email_ceiling(threaded_local, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOGIN_EMAIL_CEILING", "3")
    monkeypatch.setenv("QYM_AUTH_LOGIN_MAX_FAILURES_PER_EMAIL", "100")
    app = _app(threaded_local)
    with TestClient(app, client=("10.0.5.2", 1)) as client:
        assert _login(client, "person@x.com", "wrong-0").status_code == 401
    _slow(monkeypatch, "verify_password", False)
    codes = _burst(
        app, "10.0.5.2", 20, lambda client, index: _login(client, "person@x.com", f"wrong-{index + 1}")
    )
    assert codes == {401: 2, 429: 18}


def test_a_burst_of_taken_emails_at_sign_up_stops_at_the_client_cap(threaded_local, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOCAL_SIGNUP", "true")
    monkeypatch.setenv("QYM_AUTH_LOGIN_MAX_FAILURES_PER_CLIENT", "3")
    app = _app(threaded_local)
    _slow(monkeypatch, "hash_password", b"not-a-real-hash")
    payload = {"email": "person@x.com", "password": PASSWORD}
    codes = _burst(
        app, "10.0.5.3", 10,
        lambda client, _index: client.post("/v1/auth/signup/password", json=payload, headers=ORIGIN),
    )
    assert codes == {409: 3, 429: 7}


def test_an_attempt_counts_until_it_is_settled():
    from fastapi import HTTPException

    throttle = LoginThrottle(
        max_per_email=2, max_per_client=100, window_seconds=60, clock=lambda: 1000.0
    )
    first = throttle.begin("a@x.com", "c1")
    second = throttle.begin("a@x.com", "c1")
    with pytest.raises(HTTPException) as refused:
        throttle.begin("a@x.com", "c1")
    assert refused.value.status_code == 429
    # A request that ended without a verdict is not counted.
    throttle.cancel(first)
    third = throttle.begin("a@x.com", "c1")
    # The right password clears the strict lock, but not for ``second``,
    # which is still in flight.
    throttle.succeeded(third)
    fourth = throttle.begin("a@x.com", "c1")
    with pytest.raises(HTTPException):
        throttle.begin("a@x.com", "c1")
    # Failures stay counted.
    throttle.failed(second)
    throttle.failed(fourth)
    with pytest.raises(HTTPException):
        throttle.begin("a@x.com", "c1")
    assert len(throttle._failures["email:a@x.com"]) == 2
    assert len(throttle._failures["client:c1"]) == 2
    assert not throttle._in_flight


def test_concurrent_first_requests_share_one_throttle(monkeypatch):
    import threading
    import time

    from qym_platform import login_throttle as module

    real_settings = module.PlatformSettings

    def slow_settings():
        time.sleep(0.05)
        return real_settings()

    monkeypatch.setattr(module, "PlatformSettings", slow_settings)

    class _State:
        pass

    class _App:
        state = _State()

    class _Request:
        app = _App()

    barrier = threading.Barrier(8)
    seen = []

    def first():
        barrier.wait()
        seen.append(id(login_throttle(_Request())))

    threads = [threading.Thread(target=first) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert len(seen) == 8 and len(set(seen)) == 1
