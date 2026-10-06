"""The sign-in and change-password forms keep what the user typed after an error.

login.html rebuilds its form on every state change; an error must not wipe the
email or the new password, must put focus on the field to fix, and must clear
once the user starts typing again.
"""

from __future__ import annotations

from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import LocalAuthCredential, User, UserRole
from qym_platform.deps import get_db
from qym_platform.security import hash_password

pytestmark = pytest.mark.browser

PASSWORD = "strong-pass-123"
TEMPORARY = "Temp-Pass-0001"


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


@pytest.fixture()
def page(browser, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "true")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("QYM_BASE_URL", "http://qym.test")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add(User(id="u1", email="person@example.com", role=UserRole.MEMBER))
        db.add(User(id="u2", email="reset@example.com", role=UserRole.MEMBER))
        db.flush()
        db.add(LocalAuthCredential(user_id="u1", password_hash=hash_password(PASSWORD)))
        db.add(
            LocalAuthCredential(
                user_id="u2", password_hash=hash_password(TEMPORARY), must_change_password=True
            )
        )
        db.commit()
    app = create_app()

    def session():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = session
    client = TestClient(app)
    posts = []

    def forward(route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname != "qym.test":
            return route.abort()
        if request.method == "POST":
            posts.append(url.path)
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() in {"content-type", "accept", "origin"}
        }
        response = client.request(
            request.method,
            url.path + (f"?{url.query}" if url.query else ""),
            headers=headers,
            content=request.post_data_buffer,
            follow_redirects=False,
        )
        route.fulfill(
            status=response.status_code,
            headers={"content-type": response.headers.get("content-type", "text/plain")},
            body=response.content,
        )

    context = browser.new_context(viewport={"width": 1280, "height": 900})
    tab = context.new_page()
    tab.set_default_timeout(8000)
    errors = []
    tab.on("pageerror", lambda error: errors.append(str(error)))
    tab.route("**/*", forward)
    tab.goto("http://qym.test/login")
    tab.locator("#email").wait_for()
    tab.posts = posts
    yield tab
    context.close()
    client.close()
    engine.dispose()
    assert errors == []


def _status(page) -> str:
    return page.locator(".auth-status").inner_text().strip()


def _focused(page) -> str:
    return page.evaluate("document.activeElement && document.activeElement.id")


def test_wrong_password_keeps_the_email_and_focuses_the_password(page):
    page.locator("#email").type("person@example.com")
    page.locator("#password").type("wrong-password")
    page.locator(".auth-submit").click()
    page.wait_for_function("document.querySelector('.auth-status').textContent.includes('Invalid')")
    assert page.locator("#email").input_value() == "person@example.com"
    assert page.locator("#password").input_value() == ""
    assert _focused(page) == "password"
    # The message goes away as soon as the user starts fixing it.
    page.keyboard.type("s")
    assert _status(page) == ""


def test_change_password_errors_keep_the_new_password(page):
    page.locator("#email").type("reset@example.com")
    page.locator("#password").type(TEMPORARY)
    page.locator(".auth-submit").click()
    page.locator("#new-password").wait_for()
    assert _focused(page) == "new-password"

    page.locator("#new-password").type("brand-new-pass-1")
    page.locator("#confirm-password").type("brand-new-pass-2")
    page.locator(".auth-submit").click()
    assert _status(page) == "The passwords do not match."
    assert page.locator("#new-password").input_value() == "brand-new-pass-1"
    assert page.locator("#confirm-password").input_value() == ""
    assert _focused(page) == "confirm-password"

    # A too-short retype is blocked by the browser; the old mismatch line is gone.
    page.keyboard.type("short")
    assert _status(page) == ""

    posts = len(page.posts)
    page.locator("#new-password").fill(TEMPORARY)
    page.locator("#confirm-password").fill(TEMPORARY)
    page.locator(".auth-submit").click()
    assert _status(page) == "The new password must be different from the temporary password."
    assert len(page.posts) == posts, "The same password is refused before any request"
    assert _focused(page) == "new-password"
