"""HTTP regressions for per-pass storage and lifecycle reconstruction."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from qym_platform.api import ingest, runs
from qym_platform.app import create_app
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    Project,
    ProjectMembership,
    Run,
    RunEvent,
    RunItemAttempt,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.settings import PlatformSettings


@pytest.fixture(params=["sqlite", "postgres"])
def pass_api(request, monkeypatch):
    admin = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_pass_regression_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
    Base.metadata.create_all(engine)
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    run_id, token = str(uuid4()), "pass-regression-token"
    with Session(engine) as db:
        db.add(User(id="owner", email="owner@example.test", role=UserRole.ADMIN))
        db.flush()
        db.add(Project(id="project", name="P", slug="p", created_by_user_id="owner"))
        db.flush()
        db.add_all(
            [
                ProjectMembership(user_id="owner", project_id="project"),
                ApiKey(
                    id="key",
                    user_id="owner",
                    project_id="project",
                    name="Test",
                    prefix=api_key_prefix(token),
                    key_hash=hash_api_key(token),
                    scopes=[],
                ),
                Run(
                    id=run_id,
                    project_id="project",
                    owner_user_id="owner",
                    created_by_user_id="owner",
                    task="t",
                    dataset="d",
                    metrics=["m"],
                    samples=2,
                    run_config={"samples": 2},
                    run_metadata={"total_items": 1},
                    status=RunWorkflowStatus.RUNNING,
                ),
            ]
        )
        db.commit()
    app = create_app()

    def database():
        with Session(engine, autoflush=False) as db:
            yield db

    def principal():
        with Session(engine) as db:
            yield Principal(user=db.get(User, "owner"), auth_type="proxy_headers")

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_ui_principal] = principal
    client = TestClient(app)
    sequence = 0

    def post(kind, payload, *, repeat=False):
        nonlocal sequence
        sequence += 1
        event = {
            "schema_version": 1,
            "event_id": str(uuid4()),
            "sequence": sequence,
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "type": kind,
            "run_id": run_id,
            "payload": payload,
        }
        for delivery in range(2 if repeat else 1):
            response = client.post(
                f"/v1/runs/{run_id}/events",
                content=json.dumps(event),
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/x-ndjson",
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["applied"] == (0 if delivery else 1)

    def read():
        detail = client.get(f"/api/runs/{run_id}")
        passes = client.get(f"/api/runs/{run_id}/passes")
        assert detail.status_code == passes.status_code == 200
        return detail.json()["snapshot"]["rows"][0], passes.json()["passes"]

    yield engine, run_id, post, read
    client.close()
    engine.dispose()
    if admin:
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _settings(monkeypatch, mode):
    monkeypatch.setattr(
        ingest,
        "ingest_settings",
        lambda: PlatformSettings(database_url="sqlite://", event_log_mode=mode),
    )


def _start(post, pass_number, attempt_number=1):
    post(
        "item_attempt_started",
        {
            "item_id": "a",
            "pass_number": pass_number,
            "attempt_number": attempt_number,
            "task_started_at_ms": 1_700_000_000_000 + attempt_number,
            "trace_id": f"trace-{pass_number}-{attempt_number}",
        },
    )


def _complete(post, pass_number, output):
    post(
        "item_completed",
        {
            "item_id": "a",
            "pass_number": pass_number,
            "output": output,
            "latency_ms": 10,
            "is_final_pass": pass_number == 2,
        },
        repeat=True,
    )


def _finish(post, pass_number, attempt_number=1, **values):
    post(
        "item_attempt_finished",
        {
            "item_id": "a",
            "pass_number": pass_number,
            "attempt_number": attempt_number,
            "status": "completed",
            "is_last_attempt": True,
            "latency_ms": 10,
            **values,
        },
        repeat=True,
    )


@pytest.mark.parametrize("mode", ["full", "structural"])
@pytest.mark.parametrize(
    "ordering", ["completion_first", "finish_first", "completion_only"]
)
def test_pass_output_survives_separate_requests(pass_api, monkeypatch, mode, ordering):
    engine, run_id, post, read = pass_api
    _settings(monkeypatch, mode)
    outputs = [{"answer": "first", "values": [False, 0]}, "second"]
    for pass_number, output in enumerate(outputs, 1):
        if ordering != "completion_only":
            _start(post, pass_number)
        if ordering == "finish_first":
            _finish(post, pass_number, output=output)
        _complete(post, pass_number, output)
        # The completion is already durable before the old SDK's finish arrives.
        with Session(engine) as db:
            attempt = (
                db.query(RunItemAttempt)
                .filter_by(run_id=run_id, pass_number=pass_number)
                .one()
            )
            assert attempt.output == output
        if ordering == "completion_first":
            _finish(post, pass_number)  # SDK 1.5.2 omits output.
    with Session(engine) as db:
        attempts = (
            db.query(RunItemAttempt)
            .filter_by(run_id=run_id)
            .order_by(RunItemAttempt.pass_number)
            .all()
        )
        assert [attempt.output for attempt in attempts] == outputs
        assert all(attempt.is_last_attempt for attempt in attempts)
        events = (
            db.query(RunEvent).filter_by(run_id=run_id, type="item_completed").all()
        )
        assert all(("output" in event.payload) == (mode == "full") for event in events)
    row, passes = read()
    assert json.loads(row["pass_attempts"][0]["output"]) == outputs[0]
    assert row["pass_attempts"][1]["output"] == outputs[1]
    assert [value["completed_count"] for value in passes] == [1, 1]


@pytest.mark.parametrize("output", [None, "", False, 0, {}, []])
def test_structural_storage_preserves_falsey_outputs(pass_api, monkeypatch, output):
    engine, run_id, post, _ = pass_api
    _settings(monkeypatch, "structural")
    _start(post, 1)
    _complete(post, 1, output)
    _finish(post, 1)
    _complete(post, 2, "replacement")
    with Session(engine) as db:
        attempt = db.query(RunItemAttempt).filter_by(run_id=run_id, pass_number=1).one()
        assert attempt.output == output
        assert type(attempt.output) is type(output)


@pytest.mark.parametrize("final_status", ["completed", "failed"])
def test_retry_backoff_and_running_retry_are_not_terminal(
    pass_api, monkeypatch, final_status
):
    _, _, post, read = pass_api
    _complete(post, 1, "first")
    _start(post, 2)
    _finish(post, 2, status="failed", is_last_attempt=False, error="retryable")
    monkeypatch.setattr(
        runs,
        "_repeat_pass_event_state_from_events",
        lambda *a, **kw: pytest.fail("Replayed all lifecycle events"),
    )
    row, passes = read()
    assert row["pass_attempts"][1]["status"] == "running"
    assert passes[1]["completed_count"] == 0
    assert passes[1]["running_count"] == 1
    _start(post, 2, 2)
    row, passes = read()
    retry = row["pass_attempts"][1]
    assert (retry["status"], retry["retry_count"], retry["error"]) == ("running", 1, "")
    assert (passes[1]["completed_count"], passes[1]["running_count"]) == (0, 1)
    _finish(
        post,
        2,
        2,
        status=final_status,
        output="success" if final_status == "completed" else None,
        error="failed" if final_status == "failed" else None,
    )
    post(
        "run_completed",
        {
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "final_status": "COMPLETED",
        },
    )
    row, passes = read()
    assert row["pass_attempts"][1]["status"] == (
        "completed" if final_status == "completed" else "error"
    )
    assert (passes[1]["completed_count"], passes[1]["running_count"]) == (1, 0)


@pytest.mark.parametrize("mode", ["full", "structural"])
@pytest.mark.parametrize("during_backoff", [False, True])
def test_cancellation_keeps_pass_error_and_latest_retry(
    pass_api, monkeypatch, mode, during_backoff
):
    engine, run_id, post, read = pass_api
    _settings(monkeypatch, mode)
    _complete(post, 1, "first")
    _start(post, 2)
    _finish(post, 2, status="failed", is_last_attempt=False, error="retryable")
    if not during_backoff:
        _start(post, 2, 2)
    post(
        "item_failed",
        {"item_id": "a", "pass_number": 2, "error": "Cancelled", "retry_count": 0},
    )
    post(
        "run_completed",
        {"ended_at": datetime.now(timezone.utc).isoformat(), "final_status": "STOPPED"},
    )
    monkeypatch.setattr(
        runs,
        "_repeat_pass_event_state_from_events",
        lambda *a, **kw: pytest.fail("Replayed all lifecycle events"),
    )
    row, passes = read()
    failure = row["pass_attempts"][1]
    assert (failure["status"], failure["error"], failure["output"]) == (
        "error",
        "Cancelled",
        "ERROR: Cancelled",
    )
    assert failure["retry_count"] == (0 if during_backoff else 1)
    assert failure["trace_id"] == f"trace-2-{1 if during_backoff else 2}"
    assert row["pass_attempts"][0]["output"] == "first"
    assert passes[1]["error_count"] == 1
    with Session(engine) as db:
        attempts = (
            db.query(RunItemAttempt)
            .filter_by(run_id=run_id, pass_number=2)
            .order_by(RunItemAttempt.attempt_number)
            .all()
        )
        assert sum(attempt.is_last_attempt for attempt in attempts) == 1
        assert attempts[-1].error == "Cancelled"


def test_historical_cancelled_attempt_uses_targeted_failure_lookup(
    pass_api, monkeypatch
):
    engine, run_id, post, read = pass_api
    _complete(post, 1, "first")
    _start(post, 2)
    post("item_failed", {"item_id": "a", "pass_number": 2, "error": "Cancelled"})
    post(
        "run_completed",
        {"ended_at": datetime.now(timezone.utc).isoformat(), "final_status": "STOPPED"},
    )
    # Represent rows written by the previous ingestion implementation.
    with Session(engine) as db:
        attempt = db.query(RunItemAttempt).filter_by(run_id=run_id, pass_number=2).one()
        attempt.status, attempt.is_last_attempt, attempt.error = "RUNNING", False, None
        db.commit()
    monkeypatch.setattr(
        runs,
        "_repeat_pass_event_state_from_events",
        lambda *a, **kw: pytest.fail("Replayed all lifecycle events"),
    )
    row, passes = read()
    assert row["pass_attempts"][1]["error"] == "Cancelled"
    assert row["pass_attempts"][1]["output"] == "ERROR: Cancelled"
    assert (passes[1]["completed_count"], passes[1]["error_count"]) == (1, 1)
