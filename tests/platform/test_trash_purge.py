"""Delete permanently in Deleted runs (C118): ``POST /api/runs/purge``.

With retention Off a project that ever had runs could never be deleted. An
admin can now delete soft-deleted runs at once, also those of an archived
project, so the project's Deleted runs can be emptied. Live runs and members
are refused, and each purged run leaves a ``run.purged`` audit entry.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.auth import clear_api_key_cache
from qym_platform.db import dashboard_models, maintenance_models  # noqa: F401  (tables)
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AuditLog,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db

ORIGIN = "http://localhost:8000"
ADMIN = {"X-User-Email": "admin@x.com", "Origin": ORIGIN}
MGR = {"X-User-Email": "mgr@x.com", "Origin": ORIGIN}
DELETED = datetime(2026, 9, 1)


def _run(run_id: str, project_id: str, deleted_at=None) -> Run:
    return Run(
        id=run_id,
        project_id=project_id,
        created_by_user_id="mgr",
        owner_user_id="mgr",
        task="t",
        dataset="d",
        metrics=["m"],
        run_metadata={},
        run_config={"run_name": run_id},
        status=RunWorkflowStatus.COMPLETED,
        deleted_at=deleted_at,
    )


@pytest.fixture()
def make(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    # retention Off: without Delete permanently these runs would stay forever
    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", "0")
    clear_api_key_cache()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with maker() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
            ]
        )
        db.flush()
        db.add_all(
            [
                Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin", is_active=True),
                Project(id="pb", name="Project B", slug="pb", created_by_user_id="admin", is_active=False),
            ]
        )
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER))
        db.add_all(
            [
                _run("gone-a", "pa", DELETED),
                _run("gone-b", "pb", DELETED),
                _run("live", "pa"),
            ]
        )
        db.commit()
    yield maker
    clear_api_key_cache()
    engine.dispose()


@pytest.fixture()
def client(make):
    app = create_app()

    def session():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _exists(make, run_id: str) -> bool:
    with make() as db:
        return db.get(Run, run_id) is not None


def test_admin_deletes_runs_permanently_also_of_an_archived_project(make, client):
    response = client.post("/api/runs/purge", json={"run_ids": ["gone-a", "gone-b"]}, headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert sorted(body["purged"]) == ["gone-a", "gone-b"]
    assert body["skipped"] == []
    assert not _exists(make, "gone-a") and not _exists(make, "gone-b")
    with make() as db:
        audits = db.query(AuditLog).filter(AuditLog.action == "run.purged").all()
        assert sorted(a.entity_id for a in audits) == ["gone-a", "gone-b"]
        assert all(a.actor_user_id == "admin" and a.before["project_id"] for a in audits)


def test_live_and_unknown_runs_are_skipped_not_deleted(make, client):
    response = client.post("/api/runs/purge", json={"run_ids": ["live", "nope", "gone-a"]}, headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["purged"] == ["gone-a"]
    assert {s["run_id"]: s["reason"] for s in body["skipped"]} == {
        "live": "Deleted run not found",
        "nope": "Deleted run not found",
    }
    assert _exists(make, "live")


def test_a_run_still_on_the_dashboard_waits(make, client):
    # the dashboard worker has not removed the deleted run's contributions yet
    with make() as db:
        db.add(
            dashboard_models.DashboardRunDimension(
                run_key="gone-a",
                project_key="pa",
                task="t",
                model="m",
                dataset="d",
                owner="mgr",
                status="COMPLETED",
                timestamp=DELETED,
                created_at=DELETED,
                present=True,
            )
        )
        db.commit()
    response = client.post("/api/runs/purge", json={"run_ids": ["gone-a"]}, headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["purged"] == []
    assert body["skipped"][0]["run_id"] == "gone-a"
    assert "Try again" in body["skipped"][0]["reason"]
    assert _exists(make, "gone-a")


def test_only_admins_and_bounded_requests(make, client):
    assert client.post("/api/runs/purge", json={"run_ids": ["gone-a"]}, headers=MGR).status_code == 403
    assert client.post("/api/runs/purge", json={"run_ids": []}, headers=ADMIN).status_code == 400
    too_many = [f"r{i}" for i in range(51)]
    assert client.post("/api/runs/purge", json={"run_ids": too_many}, headers=ADMIN).status_code == 400
    assert _exists(make, "gone-a")
