"""The runs list and the run page show the same status for a run.

Lifecycle transitions (final event, lease timeout, force stop, dispatcher
stops) change ``Run.status`` at once; the list rows come from the published
dimension row, which the summary worker republishes later. Until this fix
the list kept the old status for as long as the worker lagged.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from qym_platform.api import dashboard
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import Run, RunWorkflowStatus, User
from qym_platform.deps import get_db
from sqlalchemy.orm import Session
from test_dashboard_durable_summaries import Dimension, drain, item, run


@pytest.fixture
def api(database):  # noqa: F811
    app = FastAPI()
    app.include_router(runs_api.router)
    app.include_router(dashboard.router)
    with Session(database) as db:
        user = db.get(User, "u")
        _ = user.id, user.role, user.email
        db.expunge(user)
    principal = Principal(user=user, auth_type="local_password")

    def get_session():
        with Session(database) as db:
            yield db

    app.dependency_overrides[get_db] = get_session
    app.dependency_overrides[require_ui_principal] = lambda: principal
    with TestClient(app) as client:
        yield database, client


def _legacy_list(client):
    response = client.get("/api/runs", params={"project_slug": "test"})
    assert response.status_code == 200, response.text
    rows = {}
    for models in response.json()["tasks"].values():
        for runs in models.values():
            for row in runs:
                rows[row["run_id"]] = row
    return rows


def _durable_list(client):
    response = client.post(
        "/api/dashboard/runs", json={"project_slug": "test", "limit": 50}
    )
    assert response.status_code == 200, response.text
    return {row["run_id"]: row for row in response.json()["rows"]}


def _detail(client, run_id="r"):
    response = client.get(f"/api/runs/{run_id}", params={"view": "summary"})
    assert response.status_code == 200, response.text
    return response.json()["run"]


def _probe(client, run_id="r"):
    return client.get(f"/api/runs/{run_id}/live-status").json()


def _statuses(client, run_id="r"):
    return {
        "legacy_list": _legacy_list(client)[run_id]["status"],
        "durable_list": _durable_list(client)[run_id]["status"],
        "detail": _detail(client, run_id)["status"],
        "probe": _probe(client, run_id)["status"],
    }


def _published_running_run(engine):
    with Session(engine) as db:
        run(db, status=RunWorkflowStatus.RUNNING)
        item(db, "i1", output="a")
        db.commit()
    drain(engine)


def _assert_agree(client, expected):
    seen = _statuses(client)
    assert seen == {key: expected for key in seen}, seen


def test_final_event_shows_in_the_list_before_the_worker_runs(api):
    engine, client = api
    _published_running_run(engine)
    _assert_agree(client, "RUNNING")
    # The run's final event (ingest marks it terminal) commits before the
    # summary worker republishes the row.
    with Session(engine) as db:
        from qym_platform.services.run_lifecycle import mark_run_terminal

        mark_run_terminal(
            db.get(Run, "r"), RunWorkflowStatus.COMPLETED, ended_at=datetime.utcnow()
        )
        db.commit()
    _assert_agree(client, "COMPLETED")
    drain(engine)
    _assert_agree(client, "COMPLETED")
    with Session(engine) as db:
        assert db.get(Dimension, "r").status == "COMPLETED"


def test_a_failed_run_shows_failed_everywhere(api):
    engine, client = api
    _published_running_run(engine)
    with Session(engine) as db:
        from qym_platform.services.run_lifecycle import mark_run_terminal

        mark_run_terminal(
            db.get(Run, "r"), RunWorkflowStatus.FAILED, ended_at=datetime.utcnow()
        )
        db.commit()
    _assert_agree(client, "FAILED")


def test_lease_timeout_found_by_the_run_page_shows_in_the_list(api, monkeypatch):
    engine, client = api
    monkeypatch.setenv("QYM_RUN_STALE_TIMEOUT_SECONDS", "5")
    _published_running_run(engine)
    with Session(engine) as db:
        db.get(Run, "r").last_event_at = datetime.utcnow() - timedelta(minutes=10)
        db.commit()
    # Opening the run page infers the stop; the list must say the same.
    detail = _detail(client)
    assert detail["status"] == "STOPPED"
    _assert_agree(client, "STOPPED")
    assert _durable_list(client)["r"]["status_reason"] == "lease_timeout"

    # A later live event reopens the run: again visible in both views at once.
    with Session(engine) as db:
        from qym_platform.services.run_lifecycle import (mark_run_running,
                                                         touch_run_event)

        run_row = db.get(Run, "r")
        mark_run_running(run_row)
        touch_run_event(run_row, datetime.utcnow())
        db.commit()
    _assert_agree(client, "RUNNING")


def test_lease_timeout_found_by_the_list_shows_in_the_list(api, monkeypatch):
    engine, client = api
    monkeypatch.setenv("QYM_RUN_STALE_TIMEOUT_SECONDS", "5")
    _published_running_run(engine)
    with Session(engine) as db:
        db.get(Run, "r").last_event_at = datetime.utcnow() - timedelta(minutes=10)
        db.commit()
    assert _legacy_list(client)["r"]["status"] == "STOPPED"
    _assert_agree(client, "STOPPED")


def test_force_stop_and_dispatcher_stop_show_in_the_list_at_once(api):
    engine, client = api
    _published_running_run(engine)
    response = client.post("/api/runs/r/force-stop")
    assert response.status_code == 200, response.text
    _assert_agree(client, "STOPPED")
    assert _durable_list(client)["r"]["status_reason"] == "admin_force_stopped"


def test_a_guarded_bulk_stop_shows_in_the_list_at_once(api):
    """``eval_experiments.stop_linked_run`` stops a cancelled job's run with a
    guarded bulk ``UPDATE`` that bypasses the ORM flush hooks."""
    from qym_platform.services.run_lifecycle import \
        RUN_STATUS_REASON_CANCELLED_BY_USER
    from sqlalchemy import update

    engine, client = api
    _published_running_run(engine)
    with Session(engine) as db:
        db.execute(
            update(Run)
            .where(Run.id == "r", Run.status == RunWorkflowStatus.RUNNING)
            .values(
                status=RunWorkflowStatus.STOPPED,
                status_reason=RUN_STATUS_REASON_CANCELLED_BY_USER,
                ended_at=datetime.utcnow(),
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
    _assert_agree(client, "STOPPED")
    assert _durable_list(client)["r"]["status_reason"] == "cancelled_by_user"
    # The worker's later publication keeps the same values.
    drain(engine)
    _assert_agree(client, "STOPPED")


def test_an_unpublished_run_is_left_to_the_worker(api):
    """No dimension row yet (first events still being backfilled): nothing to
    mirror; the worker publishes the run with its current status."""
    engine, client = api
    with Session(engine) as db:
        run(db, status=RunWorkflowStatus.RUNNING)
        item(db, "i1", output="a")
        db.commit()
    with Session(engine) as db:
        from qym_platform.services.run_lifecycle import mark_run_terminal

        mark_run_terminal(
            db.get(Run, "r"), RunWorkflowStatus.COMPLETED, ended_at=datetime.utcnow()
        )
        db.commit()
    assert _detail(client)["status"] == "COMPLETED"
    drain(engine)
    _assert_agree(client, "COMPLETED")
