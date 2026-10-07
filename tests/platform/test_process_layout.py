from __future__ import annotations

import os

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")

import anyio.to_thread
from fastapi.testclient import TestClient
from qym_platform.app import create_app, process_layout_warning
from qym_platform.db.session import request_threadpool_size
from qym_platform.settings import PlatformSettings


def _settings(**values) -> PlatformSettings:
    return PlatformSettings(database_url="sqlite:///:memory:", **values)


def test_single_process_layout_warns_outside_dev_only() -> None:
    assert process_layout_warning(_settings(environment="dev", role="all")) is None
    assert process_layout_warning(_settings(environment="test", role="all")) is None
    assert (
        process_layout_warning(_settings(environment="production", role="api")) is None
    )
    warning = process_layout_warning(_settings(environment="production", role="all"))
    assert warning and "QYM_ROLE=api" in warning and "QYM_ROLE=worker" in warning
    assert process_layout_warning(_settings(environment="Staging", role="all"))


def test_request_threadpool_defaults_to_the_api_pool_ceiling() -> None:
    assert request_threadpool_size(_settings()) == 20
    assert request_threadpool_size(_settings(db_pool_size=15, db_max_overflow=5)) == 20
    assert request_threadpool_size(_settings(db_pool_size=4, db_max_overflow=0)) == 4
    assert request_threadpool_size(_settings(http_threadpool_size=8)) == 8


def test_startup_caps_the_anyio_threadpool() -> None:
    app = create_app(_settings(role="api", db_pool_size=6, db_max_overflow=1))

    @app.get("/_threads")
    async def threads() -> dict:
        return {"total": anyio.to_thread.current_default_thread_limiter().total_tokens}

    with TestClient(app) as client:
        assert client.get("/_threads").json() == {"total": 7}
