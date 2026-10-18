"""Staged run-detail loading: ``view=compact&fields=`` groups and the folded summary (perf round 6)."""

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



def _compact(client, query="view=compact"):
    response = client.get(f"/api/runs/run-1?{query}", headers=OWNER)
    assert response.status_code == 200, response.text
    return response.json()


def test_compact_without_fields_keeps_its_shape(client):
    data = _compact(client)
    assert set(data) == {"run", "snapshot"}
    assert "row_fields" not in data["snapshot"]
    row = data["snapshot"]["rows"][0]
    # the whole index row: every group's keys are present
    from qym_platform.api.runs import ROW_FIELD_GROUPS

    for keys in ROW_FIELD_GROUPS.values():
        assert {key for key in keys if key != "output_received"} <= set(row)
    assert {"index", "item_id"} <= set(row)


@pytest.mark.parametrize("group", ["scores", "reasons", "categories", "traces", "text", "review"])
def test_each_group_returns_exactly_its_keys(client, group):
    from qym_platform.api.runs import ROW_FIELD_GROUPS

    full = _compact(client)["snapshot"]["rows"]
    rows = _compact(client, f"view=compact&fields={group}")["snapshot"]["rows"]
    assert [r["item_id"] for r in rows] == [r["item_id"] for r in full]
    allowed = {"index", "item_id"} | set(ROW_FIELD_GROUPS[group])
    for row, whole in zip(rows, full):
        assert set(row) <= allowed
        assert row["item_id"] == whole["item_id"] and row["index"] == whole["index"]
        for key in set(row) - {"index", "item_id"}:
            assert row[key] == whole[key]


def test_the_union_of_all_groups_is_todays_compact_row(client):
    full = _compact(client)["snapshot"]["rows"]
    every = ",".join(["scores", "reasons", "categories", "traces", "text", "review"])
    rows = _compact(client, f"view=compact&fields={every}")["snapshot"]["rows"]
    assert rows == full
    # additive: two requests merged by item id equal the combined one
    a = _compact(client, "view=compact&fields=scores,reasons")["snapshot"]["rows"]
    b = _compact(client, "view=compact&fields=categories,traces,text,review")["snapshot"]["rows"]
    merged = [{**x, **y} for x, y in zip(a, b)]
    assert merged == full


def test_scores_and_reasons_are_lighter_than_the_whole_row(client):
    full = len(client.get("/api/runs/run-1?view=compact", headers=OWNER).content)
    staged = len(
        client.get("/api/runs/run-1?view=compact&fields=scores,reasons", headers=OWNER).content
    )
    assert staged < full


def test_fields_refusals(client):
    assert client.get("/api/runs/run-1?view=compact&fields=nope", headers=OWNER).status_code == 422
    assert client.get("/api/runs/run-1?view=compact&fields=", headers=OWNER).status_code == 422
    assert client.get("/api/runs/run-1?fields=scores", headers=OWNER).status_code == 422
    assert client.get("/api/runs/run-1?view=full&fields=scores", headers=OWNER).status_code == 422
    assert (
        client.get("/api/runs/run-1?view=summary&fields=scores", headers=OWNER).status_code == 422
    )


def test_pass_number_composes_with_fields(client):
    data = _compact(client, "view=compact&pass_number=1&fields=scores")
    assert data["snapshot"]["pass_number"] == 1
    assert data["snapshot"]["row_fields"] == ["scores"]


def test_restricted_items_keep_the_same_rows_minus_text(client, monkeypatch):
    monkeypatch.setattr("qym_platform.api.runs.can_view_run_items", lambda *a, **k: False)
    data = _compact(client, "view=compact&fields=scores,text")
    assert data["run"]["items_restricted"] is True
    full = _compact(client)["snapshot"]["rows"]
    assert [r["item_id"] for r in data["snapshot"]["rows"]] == [r["item_id"] for r in full]
    for row in data["snapshot"]["rows"]:
        assert "question" not in str(row.get("input_preview"))  # redacted, same keys


def test_summary_carries_neighbors_and_the_review_event_count(client):
    data = client.get("/api/runs/run-1?view=summary", headers=OWNER).json()
    assert data["snapshot"]["rows"] == []
    assert data["review_event_count"] == 0
    assert data["snapshot"]["rows_total"] == 3
    neighbors = data["neighbors"]
    assert neighbors["run_id"] == "run-1"
    # the same answer the endpoint gives for the default order (this run is not in the dashboard projection)
    assert {"context", "position", "total", "previous", "next"} <= set(neighbors)
    assert neighbors["previous"] is None and neighbors["next"] is None
    # the endpoint it replaces still answers
    old = client.post(
        "/api/dashboard/neighbors",
        json={"project_slug": "p1", "run_id": "run-1", "filters": {}, "sort": "time-desc"},
        headers=OWNER,
    )
    assert old.status_code == 200


def test_summary_of_a_live_run_carries_the_live_revision(client):
    summary = client.get("/api/runs/run-1?view=summary", headers=OWNER).json()
    probe = client.get("/api/runs/run-1/live-status", headers=OWNER).json()
    assert summary["run"]["live_revision"] == probe["revision"]
