"""The run page's live probe and the analyzer's light run views (C039, C027)."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app  # noqa: E402
from qym_platform.db.base import Base  # noqa: E402
from qym_platform.db.models import (  # noqa: E402
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItem,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db  # noqa: E402
from qym_platform.services.run_payloads import scope_row_to_pass  # noqa: E402

OWNER = {"X-User-Email": "owner@example.com"}
OUTSIDER = {"X-User-Email": "other@example.com"}


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-secret")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as session:
        session.add_all(
            [
                User(id="user-owner", email="owner@example.com", role=UserRole.MEMBER),
                User(id="user-other", email="other@example.com", role=UserRole.MEMBER),
            ]
        )
        session.flush()
        session.add(
            Project(
                id="project-1", name="P1", slug="p1", created_by_user_id="user-owner"
            )
        )
        session.flush()
        session.add(
            ProjectMembership(
                project_id="project-1", user_id="user-owner", role=ProjectRole.MEMBER
            )
        )
        now = datetime.utcnow()
        session.add(
            Run(
                id="run-1",
                project_id="project-1",
                created_by_user_id="user-owner",
                owner_user_id="user-owner",
                task="t",
                dataset="d",
                model="m",
                status=RunWorkflowStatus.RUNNING,
                metrics=["quality"],
                run_metadata={},
                run_config={"run_name": "Live run"},
                started_at=now - timedelta(seconds=30),
                last_event_at=now - timedelta(seconds=1),
            )
        )
        session.flush()
        session.add_all(
            [
                RunItem(
                    run_id="run-1",
                    item_id=f"item-{index}",
                    index=index,
                    input=f"question {index}",
                    expected="",
                    output=f"answer {index}",
                )
                for index in range(3)
            ]
        )
        session.commit()
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


def test_live_status_follows_events_and_the_end_of_the_run(client, session_factory):
    first = client.get("/api/runs/run-1/live-status", headers=OWNER)
    assert first.status_code == 200
    body = first.json()
    assert body["status"] == "RUNNING" and body["live"] is True
    assert body["run_id"] == "run-1"
    assert body["started_at"] and body["server_time"]
    assert (
        client.get("/api/runs/run-1/live-status", headers=OWNER).json()["revision"]
        == body["revision"]
    )

    # A new event moves the revision: the page reloads the rows.
    with session_factory() as session:
        run = session.get(Run, "run-1")
        run.last_event_at = datetime.utcnow() + timedelta(seconds=5)
        session.commit()
    moved = client.get("/api/runs/run-1/live-status", headers=OWNER).json()
    assert moved["revision"] != body["revision"]

    with session_factory() as session:
        run = session.get(Run, "run-1")
        run.status = RunWorkflowStatus.COMPLETED
        run.ended_at = datetime.utcnow()
        session.commit()
    ended = client.get("/api/runs/run-1/live-status", headers=OWNER).json()
    assert ended["status"] == "COMPLETED" and ended["live"] is False
    assert ended["ended_at"]


def test_a_late_event_moves_the_revision(client, session_factory):
    """An event sent before the latest one leaves last_event_at (and every
    Run column) alone; the revision must still move, or the page never
    reloads the rows it brought."""
    from qym_platform.db.models import RunEvent

    before = client.get("/api/runs/run-1/live-status", headers=OWNER).json()
    with session_factory() as session:
        run = session.get(Run, "run-1")
        late = run.last_event_at - timedelta(seconds=20)
        session.add(
            RunEvent(
                run_id="run-1",
                event_id="late-1",
                sequence=7,
                type="item_completed",
                sent_at=late,
                payload={},
            )
        )
        session.commit()
    after = client.get("/api/runs/run-1/live-status", headers=OWNER).json()
    assert after["last_event_at"] == before["last_event_at"]
    assert after["revision"] != before["revision"]


def test_run_payload_of_a_live_run_carries_its_revision(client, session_factory):
    data = client.get("/api/runs/run-1?view=compact", headers=OWNER).json()
    probe = client.get("/api/runs/run-1/live-status", headers=OWNER).json()
    assert data["run"]["live_revision"] == probe["revision"]

    with session_factory() as session:
        run = session.get(Run, "run-1")
        run.status = RunWorkflowStatus.COMPLETED
        run.ended_at = datetime.utcnow()
        session.commit()
    ended = client.get("/api/runs/run-1?view=compact", headers=OWNER).json()
    assert "live_revision" not in ended["run"]


def test_live_status_refuses_unknown_runs_and_outsiders(client):
    assert client.get("/api/runs/nope/live-status", headers=OWNER).status_code == 404
    assert (
        client.get("/api/runs/run-1/live-status", headers=OUTSIDER).status_code == 403
    )


def test_summary_view_carries_the_run_header_without_rows(client):
    response = client.get("/api/runs/run-1?view=summary", headers=OWNER)
    assert response.status_code == 200
    data = response.json()
    assert data["snapshot"]["rows"] == []
    assert data["run"]["run_name"] == "Live run"
    assert data["run"]["metric_names"] == ["quality"]
    full = client.get("/api/runs/run-1?view=compact", headers=OWNER).json()
    assert len(full["snapshot"]["rows"]) == 3


def test_pass_number_needs_the_compact_view(client):
    assert client.get("/api/runs/run-1?pass_number=2", headers=OWNER).status_code == 422
    assert (
        client.get(
            "/api/runs/run-1?view=summary&pass_number=2", headers=OWNER
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/runs/run-1?view=compact&pass_number=0", headers=OWNER
        ).status_code
        == 422
    )
    scoped = client.get("/api/runs/run-1?view=compact&pass_number=1", headers=OWNER)
    assert scoped.status_code == 200
    assert scoped.json()["snapshot"]["pass_number"] == 1


def test_scope_row_to_pass_keeps_positions_of_one_pass():
    row = {
        "item_id": "item-1",
        "pass_scores": {"quality": [0.1, 0.9, 0.2]},
        "pass_metric_meta": {
            "quality": [{"label": "a"}, {"label": "b"}, {"label": "c"}]
        },
        "pass_metric_analyses": {"quality": [None, {"root_cause": "x"}, None]},
        "pass_attempts": [
            {"pass_number": 1, "output_digest": "1"},
            {"pass_number": 2, "output_digest": "2"},
            {"pass_number": 3, "output_digest": "3"},
        ],
        "metric_values": [0.4],
    }
    scoped = scope_row_to_pass(row, 2)
    assert scoped["pass_scores"] == {"quality": [None, 0.9, None]}
    assert scoped["pass_metric_meta"] == {"quality": [None, {"label": "b"}, None]}
    assert scoped["pass_metric_analyses"] == {
        "quality": [None, {"root_cause": "x"}, None]
    }
    assert scoped["pass_attempts"] == [
        None,
        {"pass_number": 2, "output_digest": "2"},
        None,
    ]
    assert scoped["metric_values"] == [0.4]

    # Legacy attempts without a pass number are positional.
    legacy = scope_row_to_pass({"pass_attempts": [{"status": "a"}, {"status": "b"}]}, 1)
    assert legacy["pass_attempts"] == [{"status": "a"}, None]
