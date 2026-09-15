"""Compatibility checks: PR47 maintenance responses and local SDK closure."""

import json
import threading
from urllib.error import HTTPError

import pytest

from test_run_lifecycle import client, session_factory, _seed_run, _ui_headers
from qym_platform.api import ingest
from qym_platform.db.models import Run, RunEvent, RunWorkflowStatus
from qym_platform.settings import PlatformSettings
from qym.platform import client as sdk_client
from qym.platform.client import PlatformEventStream


@pytest.mark.parametrize("force_stop", [False, True])
def test_maintenance_and_terminal_closure_coexist(
    monkeypatch, client, session_factory, force_stop
):
    run_id = "00000000-0000-0000-0000-000000000777"
    with session_factory() as db:
        _seed_run(db, run_id=run_id)
    settings = PlatformSettings()
    settings.maintenance_mode = True
    monkeypatch.setattr(ingest, "ingest_settings", lambda: settings)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_BASE", 0.01)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_MAX", 0.02)
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.001)
    responses = []
    maintenance_seen = threading.Event()
    delivered = threading.Event()

    def post(url, body, key, **kwargs):
        response = client.post(
            f"/v1/runs/{run_id}/events",
            content=body,
            headers={"Authorization": "Bearer test-token"},
        )
        responses.append(response.status_code)
        if response.status_code == 503:
            assert response.headers["Retry-After"] == "60"
            maintenance_seen.set()
        if response.status_code >= 400:
            raise HTTPError(
                url, response.status_code, response.text, response.headers, None
            )
        delivered.set()

    monkeypatch.setattr(sdk_client, "_post_ndjson", post)
    stream = PlatformEventStream("http://test", "test-token", run_id)
    try:
        stream.emit("run_heartbeat", {"heartbeat_at": "2026-09-15T00:00:00Z"})
        assert maintenance_seen.wait(10)
        assert not stream._remote_closed.is_set()
        assert stream.dropped_events == 0
        if force_stop:
            stopped = client.post(
                f"/api/runs/{run_id}/force-stop",
                headers=_ui_headers("admin@example.com"),
            )
            assert stopped.status_code == 200
        settings.maintenance_mode = False
        if force_stop:
            stream._thread.join(10)
            assert not stream._thread.is_alive()
            assert stream._remote_closed.is_set()
            assert 410 in responses
            assert not stream.flush(0)
        else:
            assert delivered.wait(10)
            assert stream.flush(10)
            assert not stream._remote_closed.is_set()
            assert stream.dropped_events == 0
        with session_factory() as db:
            run = db.get(Run, run_id)
            count = db.query(RunEvent).filter_by(run_id=run_id).count()
            if force_stop:
                assert run.status == RunWorkflowStatus.STOPPED
                assert run.status_reason == "admin_force_stopped"
                assert count == 0
            else:
                assert run.status == RunWorkflowStatus.RUNNING
                assert count == 1
        print(
            json.dumps(
                {
                    "force_stop": force_stop,
                    "responses": responses,
                    "remote_closed": stream._remote_closed.is_set(),
                    "sent": stream.sent_events,
                    "dropped": stream.dropped_events,
                }
            )
        )
    finally:
        stream.close()
