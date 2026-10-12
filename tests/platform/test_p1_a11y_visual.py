"""API contract from the P1 accessibility and visual fixes.

- C038: Compare names the requested runs the server could not return.

The static contracts that used to live here (C046 mono token, C053 text
direction policy, C049 shared dialog focus contract) read the removed vanilla
dashboard files; the React app covers them in frontend/src/__tests__/
design-language.test.ts, frontend/src/lib/__tests__/lib.test.ts and
frontend/e2e/shell/a11y.spec.ts.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


# ── C038: Compare API ────────────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    if "openai" not in sys.modules:
        sys.modules["openai"] = MagicMock()
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from qym_platform.app import create_app
    from qym_platform.db.base import Base
    from qym_platform.db.models import Project, ProjectMembership, ProjectRole, Run, RunWorkflowStatus, User, UserRole
    from qym_platform.deps import get_db

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all([
            User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
            User(id="outsider", email="outsider@x.com", role=UserRole.MEMBER),
            Project(id="pa", name="A", slug="pa", created_by_user_id="mgr", is_active=True),
        ])
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER))
        for run_id in ("r1", "r2"):
            db.add(Run(
                id=run_id, project_id="pa", created_by_user_id="mgr", owner_user_id="mgr", task="t",
                dataset="d", metrics=["m"], run_metadata={}, run_config={"run_name": run_id},
                status=RunWorkflowStatus.COMPLETED,
            ))
        db.commit()
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


def _headers(email: str) -> dict:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def test_compare_lists_requested_runs_it_could_not_return(client) -> None:
    data = client.get("/api/compare?files=r1&files=gone&files=r2", headers=_headers("mgr@x.com")).json()
    assert [run["run"]["run_id"] for run in data["runs"]] == ["r1", "r2"]
    assert data["missing_runs"] == [{"run_id": "gone"}]

    hidden = client.get("/api/compare?files=r1&files=r2", headers=_headers("outsider@x.com")).json()
    assert hidden["runs"] == []
    assert hidden["missing_runs"] == [{"run_id": "r1"}, {"run_id": "r2"}]
