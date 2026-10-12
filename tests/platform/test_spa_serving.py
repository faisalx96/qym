"""The React app is served at the canonical URLs with a history-API fallback.

index.html for every client route, never for API or asset paths; runtime
bootstrap + <base href> injected; login redirect kept; QYM_ROOT_PATH respected;
hashed assets cacheable while the page is no-store; /app/* redirects.
"""

from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.api import spa
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import LocalAuthCredential, User, UserRole
from qym_platform.deps import get_db
from qym_platform.security import hash_password

INDEX_HTML = """<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>قيِّم</title>
<!--__QYM_APP_BOOTSTRAP__-->
<script type="module" src="./assets/index-abc123.js"></script>
</head><body><div id="root"></div></body></html>
"""


@pytest.fixture()
def built_spa(tmp_path, monkeypatch):
    """A fake Vite build so the tests do not depend on `npm run build`."""
    app_dir = tmp_path / "app"
    (app_dir / "assets").mkdir(parents=True)
    (app_dir / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (app_dir / "assets" / "index-abc123.js").write_text("console.log('qym')\n" * 100, encoding="utf-8")
    monkeypatch.setattr(spa, "spa_dir", lambda: app_dir)
    monkeypatch.setattr("qym_platform.app.spa_dir", lambda: app_dir)
    return app_dir


def _session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _client(make):
    app = create_app()

    def override():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    return TestClient(app)


def _bootstrap(html: str) -> dict:
    match = re.search(r"window\.__QYM_APP__ = (\{.*?\});", html)
    assert match, "bootstrap script missing"
    return json.loads(match.group(1))


@pytest.fixture()
def no_auth_env(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.delenv("QYM_AUTH_LOCAL_ENABLED", raising=False)
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    monkeypatch.setenv("QYM_BASE_URL", "http://qym.test")


@pytest.fixture()
def session_auth_env(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "true")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("QYM_BASE_URL", "http://qym.test")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")


class TestFallback:
    def test_app_root_serves_index_with_bootstrap(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            for path in ("/", "/profile", "/projects/p1/runs/a/b/c?pass=2", "/projects/p1/settings", "/admin/users", "/docs/sdk-guide/observers", "/compare?files=a&files=b", "/run/abc"):
                res = client.get(path)
                assert res.status_code == 200, path
                assert res.headers["content-type"].startswith("text/html")
                assert res.headers["cache-control"] == "no-store"
                assert '<base href="/">' in res.text
                boot = _bootstrap(res.text)
                assert boot == {"rootPath": "", "authMode": "none", "sessionAuth": False, "environment": "test"}
                assert 'window.__QYM_ROOT_PATH__ = ""' in res.text
                assert "<!--__QYM_APP_BOOTSTRAP__-->" not in res.text

    def test_assets_are_served_and_cacheable(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            asset = client.get("/assets/index-abc123.js")
            assert asset.status_code == 200
            assert "no-store" not in asset.headers.get("cache-control", "")
            assert "javascript" in asset.headers["content-type"]
            gz = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
            assert gz.headers.get("content-encoding") == "gzip"

    def test_missing_assets_and_files_never_get_index(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            for path in ("/assets/missing-xyz.js", "/favicon.png", "/projects/x/data.json"):
                res = client.get(path)
                assert res.status_code == 404, path
                assert "<html" not in res.text.lower()

    def test_api_and_other_prefixes_never_fall_back(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            for path in ("/v1/nope", "/api/nope", "/assets/nope.js", "/static/nope.js", "/ui/nope", "/ingestion/nope", "/workers/nope"):
                res = client.get(path)
                assert res.status_code == 404, path
                assert "<base href" not in res.text, path
            assert client.get("/healthz").status_code == 200
            assert client.get("/api-docs").status_code == 200
            assert "openapi" in client.get("/openapi.json").text

    def test_removed_ui_viewer_is_not_mounted(self, built_spa, no_auth_env):
        """The old standalone /ui viewer is gone: no mount, no static caching rule for it."""
        from qym_platform.middleware.cache_control import STATIC_PREFIXES

        assert "/ui/" not in STATIC_PREFIXES
        with _client(_session_factory()) as client:
            for path in ("/ui/index.html", "/ui/app.js"):
                assert client.get(path).status_code == 404, path

    def test_missing_build_is_a_clear_404(self, tmp_path, monkeypatch, no_auth_env):
        empty = tmp_path / "nope"
        monkeypatch.setattr(spa, "spa_dir", lambda: empty)
        monkeypatch.setattr("qym_platform.app.spa_dir", lambda: empty)
        with _client(_session_factory()) as client:
            res = client.get("/profile")
            assert res.status_code == 404
            assert "npm run build" in res.json()["detail"]

    def test_app_prefix_redirects_to_the_canonical_url(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            for old, new in (
                ("/app", "/"),
                ("/app/", "/"),
                ("/app/projects/p1/settings?tab=members", "/projects/p1/settings?tab=members"),
                ("/app/run/a/b?item=1&pass=2", "/run/a/b?item=1&pass=2"),
                ("/app/login?next=%2Fprofile", "/login?next=%2Fprofile"),
            ):
                res = client.get(old, follow_redirects=False)
                assert res.status_code == 302, old
                assert res.headers["location"] == new, old

    def test_dashboard_static_mount_is_gone(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            assert client.get("/static/dashboard.js").status_code == 404

    def test_post_to_a_page_url_is_not_served(self, built_spa, no_auth_env):
        with _client(_session_factory()) as client:
            assert client.post("/projects/p1").status_code == 405


class TestRootPath:
    def test_prefix_reaches_base_href_bootstrap_and_assets(self, built_spa, monkeypatch, no_auth_env):
        from qym_platform import main
        from qym_platform.settings import PlatformSettings

        settings = PlatformSettings(environment="test", auth_mode="none", root_path="/qym")
        monkeypatch.setattr(main, "PlatformSettings", lambda: settings)
        client = TestClient(main.build_app())
        res = client.get("/qym/projects/p1/overview")
        assert res.status_code == 200
        assert '<base href="/qym/">' in res.text
        assert _bootstrap(res.text)["rootPath"] == "/qym"
        assert res.headers["cache-control"] == "no-store"
        asset = client.get("/qym/assets/index-abc123.js")
        assert asset.status_code == 200
        assert "no-store" not in asset.headers.get("cache-control", "")


class TestSessionAuth:
    def _seed(self, make):
        with make() as db:
            db.add(User(id="u1", email="person@example.com", role=UserRole.MEMBER))
            db.flush()
            db.add(LocalAuthCredential(user_id="u1", password_hash=hash_password("correct horse battery")))
            db.commit()

    def test_unauthenticated_deep_link_bounces_to_spa_login(self, built_spa, session_auth_env):
        make = _session_factory()
        with _client(make) as client:
            res = client.get("/projects/p1/settings?tab=members", follow_redirects=False)
            assert res.status_code == 303
            assert res.headers["location"] == "/login?next=/projects/p1/settings%3Ftab%3Dmembers"
            login = client.get("/login?next=/profile")
            assert login.status_code == 200
            boot = _bootstrap(login.text)
            assert boot["sessionAuth"] is True and boot["authMode"] == "proxy_headers"
            assert login.headers["cache-control"] == "no-store"

    def test_signed_in_user_skips_login_and_reaches_pages(self, built_spa, session_auth_env):
        make = _session_factory()
        self._seed(make)
        with _client(make) as client:
            res = client.post(
                "/v1/auth/login/password?next=/profile",
                json={"email": "person@example.com", "password": "correct horse battery"},
                headers={"Origin": "http://qym.test"},
            )
            assert res.status_code == 200, res.text
            assert res.json()["next"] == "/profile"
            login = client.get("/login?next=/projects/p1", follow_redirects=False)
            assert login.status_code == 303
            assert login.headers["location"] == "/projects/p1"
            # an unsafe next is replaced by the SPA root
            evil = client.get("/login?next=//evil.test/x", follow_redirects=False)
            assert evil.headers["location"] == "/"
            page = client.get("/projects/p1")
            assert page.status_code == 200
            assert "<base href" in page.text

    def test_login_redirect_keeps_root_path(self, built_spa, monkeypatch, session_auth_env):
        from qym_platform import main
        from qym_platform.settings import PlatformSettings

        settings = PlatformSettings(
            environment="test",
            auth_mode="proxy_headers",
            auth_local_enabled=True,
            auth_session_secret="test-session-secret",
            base_url="http://qym.test",
            root_path="/qym",
        )
        monkeypatch.setattr(main, "PlatformSettings", lambda: settings)
        monkeypatch.setattr("qym_platform.app.PlatformSettings", lambda: settings)
        client = TestClient(main.build_app())
        res = client.get("/qym/trash", follow_redirects=False)
        assert res.status_code == 303
        assert res.headers["location"] == "/qym/login?next=/qym/trash"


def test_render_spa_index_without_marker_injects_into_head():
    from qym_platform.settings import PlatformSettings

    settings = PlatformSettings(environment="test", auth_mode="none")
    html = spa.render_spa_index("<html><head><title>x</title></head><body></body></html>", settings, "/qym")
    assert html.startswith('<html><head><base href="/qym/"><script>window.__QYM_APP__')
    assert json.loads(re.search(r"__QYM_APP__ = (\{.*?\});", html).group(1))["rootPath"] == "/qym"


def test_render_spa_index_escapes_hostile_root_path():
    from qym_platform.settings import PlatformSettings

    settings = PlatformSettings(environment="test", auth_mode="none")
    html = spa.render_spa_index("<html><head></head></html>", settings, '/x"></script><script>alert(1)')
    assert "</script><script>alert" not in html
    assert '<base href="/x&quot;&gt;&lt;/script&gt;' in html
