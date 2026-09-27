"""C023: access granted through a project ends with the membership or the project.

API keys act for their creator inside one project, so they stop working when
the creator leaves the project or the project is archived. Run ownership no
longer outlives membership, and the dataset API hides archived projects.
"""

from __future__ import annotations

import os
import sys
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
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
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
from qym_platform.security import api_key_prefix, hash_api_key

RUN_BODY = {"task": "t", "dataset": "d", "metrics": []}


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    clear_api_key_cache()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
                User(id="former", email="former@x.com", role=UserRole.MEMBER),
                Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin", is_active=True),
            ]
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER),
                ProjectMembership(project_id="pa", user_id="former", role=ProjectRole.MEMBER),
                Run(
                    id="r-former",
                    project_id="pa",
                    created_by_user_id="former",
                    owner_user_id="former",
                    task="t",
                    dataset="d",
                    metrics=[],
                    run_metadata={},
                    run_config={},
                    status=RunWorkflowStatus.COMPLETED,
                ),
            ]
        )
        db.commit()
    try:
        yield factory
    finally:
        clear_api_key_cache()
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
    app.dependency_overrides.clear()


def _ui(email: str) -> dict:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def _key(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_key(session_factory, token: str, user_id: str, project_id: str = "pa") -> None:
    with session_factory() as db:
        db.add(
            ApiKey(
                id=f"key-{token}",
                user_id=user_id,
                project_id=project_id,
                name=token,
                prefix=api_key_prefix(token),
                key_hash=hash_api_key(token),
                scopes=[],
            )
        )
        db.commit()


def _remove_membership_row(session_factory, user_id: str) -> None:
    with session_factory() as db:
        db.query(ProjectMembership).filter(
            ProjectMembership.project_id == "pa", ProjectMembership.user_id == user_id
        ).delete()
        db.commit()


def test_removing_a_member_revokes_their_keys_and_is_audited(client, session_factory):
    created = client.post(
        "/v1/projects/pa/api-keys", json={"name": "ci-key"}, headers=_ui("former@x.com")
    )
    assert created.status_code == 200
    token = created.json()["token"]
    assert client.post("/v1/runs", json=RUN_BODY, headers=_key(token)).status_code == 200

    removed = client.delete("/v1/projects/pa/members/former", headers=_ui("mgr@x.com"))
    assert removed.status_code == 200
    assert removed.json()["revoked_api_keys"] == 1

    assert client.post("/v1/runs", json=RUN_BODY, headers=_key(token)).status_code == 401
    assert client.get("/v1/datasets", headers=_key(token)).status_code == 401
    keys = client.get("/v1/projects/pa/api-keys", headers=_ui("mgr@x.com")).json()["api_keys"]
    assert [k["revoked_at"] is not None for k in keys] == [True]
    with session_factory() as db:
        audit = db.query(AuditLog).filter(AuditLog.action == "project.member_removed").one()
        assert audit.entity_id == "pa:former"
        assert audit.actor_user_id == "mgr"
        assert audit.after["revoked_api_key_ids"] == [created.json()["id"]]


def test_key_of_a_non_member_is_refused_on_every_key_route(client, session_factory):
    _seed_key(session_factory, "orphan-token", "former")
    assert client.post("/v1/runs", json=RUN_BODY, headers=_key("orphan-token")).status_code == 200
    _remove_membership_row(session_factory, "former")

    for response in (
        client.post("/v1/runs", json=RUN_BODY, headers=_key("orphan-token")),
        client.post("/v1/runs/r-former/events", content=b"", headers=_key("orphan-token")),
        client.get("/v1/datasets", headers=_key("orphan-token")),
        client.post("/v1/datasets", json={"name": "golden"}, headers=_key("orphan-token")),
    ):
        assert response.status_code == 403
        assert response.json()["detail"] == "API key owner is no longer a member of this project"


def test_admin_owned_key_keeps_working_without_membership(client, session_factory):
    _seed_key(session_factory, "admin-token", "admin")
    assert client.post("/v1/runs", json=RUN_BODY, headers=_key("admin-token")).status_code == 200


def test_archived_project_pauses_keys_until_unarchived(client, session_factory):
    _seed_key(session_factory, "mgr-token", "mgr")
    archived = client.post("/v1/admin/projects/pa/archive", headers=_ui("admin@x.com"))
    assert archived.status_code == 200

    for response in (
        client.post("/v1/runs", json=RUN_BODY, headers=_key("mgr-token")),
        client.post("/v1/runs/r-former/events", content=b"", headers=_key("mgr-token")),
        client.get("/v1/datasets", headers=_key("mgr-token")),
        client.post("/v1/datasets", json={"name": "golden"}, headers=_key("mgr-token")),
    ):
        assert response.status_code == 409
        assert "archived" in response.json()["detail"]
    with session_factory() as db:
        assert db.query(Run).filter(Run.project_id == "pa").count() == 1

    assert client.post("/v1/admin/projects/pa/unarchive", headers=_ui("admin@x.com")).status_code == 200
    assert client.post("/v1/runs", json=RUN_BODY, headers=_key("mgr-token")).status_code == 200
    assert client.get("/v1/datasets", headers=_key("mgr-token")).status_code == 200


def test_dataset_api_hides_archived_projects_from_ui_sessions(client, session_factory):
    assert client.get("/v1/datasets?project_slug=pa", headers=_ui("mgr@x.com")).status_code == 200
    with session_factory() as db:
        db.get(Project, "pa").is_active = False
        db.commit()
    assert client.get("/v1/datasets?project_slug=pa", headers=_ui("mgr@x.com")).status_code == 404
    created = client.post(
        "/v1/datasets?project_slug=pa", json={"name": "golden"}, headers=_ui("mgr@x.com")
    )
    assert created.status_code == 404
    # No slug: the fallback project must also be an active one.
    assert client.get("/v1/datasets", headers=_ui("admin@x.com")).status_code == 404


def test_removed_owner_loses_run_owner_rights(client, session_factory):
    _remove_membership_row(session_factory, "former")
    headers = _ui("former@x.com")

    assert client.post("/v1/runs/r-former/submit", headers=headers).status_code == 403
    assert (
        client.get("/api/runs/r-former/analysis-jobs/active", headers=headers).status_code
        == 403
    )
    deleted = client.post("/api/runs/delete", json={"file_path": "r-former"}, headers=headers)
    assert deleted.status_code == 403
    with session_factory() as db:
        run = db.get(Run, "r-former")
        assert run.deleted_at is None
        assert run.status == RunWorkflowStatus.COMPLETED


def test_current_owner_keeps_run_owner_rights(client):
    headers = _ui("former@x.com")
    assert (
        client.get("/api/runs/r-former/analysis-jobs/active", headers=headers).status_code
        == 200
    )
    assert client.post("/v1/runs/r-former/submit", headers=headers).status_code == 200
