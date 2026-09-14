"""The deployed ASGI entry point must run mounted application lifecycles."""

from contextlib import asynccontextmanager
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from qym_platform import main
from qym_platform.settings import PlatformSettings


@pytest.mark.parametrize("prefix", ["", "/", "/qym", "/qym/"])
def test_entrypoint_starts_and_stops_worker_once(monkeypatch, prefix):
    worker = Mock()
    monkeypatch.setattr("qym_platform.app.DashboardSummaryWorker", lambda _: worker)
    settings = PlatformSettings(environment="test", auth_mode="none", root_path=prefix)
    monkeypatch.setattr(main, "PlatformSettings", lambda: settings)
    app = main.build_app()
    with TestClient(app) as client:
        assert client.get(prefix.rstrip("/") + "/healthz").status_code == 200
        worker.start.assert_called_once_with()
        worker.stop.assert_not_called()
    worker.stop.assert_called_once_with()


def test_mounted_lifespan_preserves_state_and_cleans_up_after_failure(monkeypatch):
    events = []

    @asynccontextmanager
    async def lifespan(app):
        events.append("start")
        try:
            yield {"marker": "mounted-state"}
        finally:
            events.append("stop")

    inner = FastAPI(lifespan=lifespan)

    @inner.get("/state")
    def state(request: Request):
        return {"marker": request.state.marker}

    monkeypatch.setattr(main, "create_app", lambda _: inner)
    monkeypatch.setattr(
        main,
        "PlatformSettings",
        lambda: PlatformSettings(
            root_path="/qym", environment="test", auth_mode="none"
        ),
    )
    with pytest.raises(RuntimeError, match="test failure"):
        with TestClient(main.build_app()) as client:
            assert client.get("/qym/state").json() == {"marker": "mounted-state"}
            raise RuntimeError("test failure")
    assert events == ["start", "stop"]


def test_mounted_startup_failure_prevents_successful_startup(monkeypatch):
    @asynccontextmanager
    async def lifespan(app):
        raise RuntimeError("worker startup failed")
        yield

    monkeypatch.setattr(main, "create_app", lambda _: FastAPI(lifespan=lifespan))
    monkeypatch.setattr(
        main,
        "PlatformSettings",
        lambda: PlatformSettings(
            root_path="/qym", environment="test", auth_mode="none"
        ),
    )
    with pytest.raises(RuntimeError, match="worker startup failed"):
        with TestClient(main.build_app()):
            pass
