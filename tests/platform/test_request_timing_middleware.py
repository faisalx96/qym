import os

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")

from fastapi.testclient import TestClient

from qym_platform.app import create_app
from qym_platform.deps import get_db
from qym_platform.settings import PlatformSettings


def _client(**overrides):
    settings = PlatformSettings(database_url="sqlite://", auth_mode="none", **overrides)
    app = create_app(settings)
    # Keep the background worker out of these tests.
    app.dependency_overrides[get_db] = get_db
    return TestClient(app)


def test_server_timing_header_present_when_enabled():
    with _client(request_timing=True) as client:
        resp = client.get("/healthz")
    assert resp.status_code == 200
    header = resp.headers.get("server-timing", "")
    assert "app;dur=" in header
    assert "db;dur=" in header
    assert "db-count;dur=" in header


def test_server_timing_header_absent_by_default():
    with _client() as client:
        resp = client.get("/healthz")
    assert resp.status_code == 200
    assert "server-timing" not in resp.headers


def test_role_api_does_not_start_worker():
    settings = PlatformSettings(database_url="sqlite://", auth_mode="none", role="api")
    app = create_app(settings)
    with TestClient(app):
        pass
    assert app.state.dashboard_summary_worker.is_alive() is False
