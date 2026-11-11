"""C002: only a project manager can delete an analysis rule version.

The run-scoped route checked run ownership, so a member who owned one run could
hard-delete the rules a manager approved. The route now needs a manager,
refuses the live version, and soft-deletes so an admin can restore the row.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from qym_platform.api.analysis import _create_analysis_rule_version
from qym_platform.app import create_app
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalysisRuleVersionStatus,
    Project,
    ProjectAnalysisRuleAlias,
    ProjectAnalysisRuleVersion,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture()
def env():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    # Keep the seeded users readable after the seed session closes.
    db = factory(expire_on_commit=False)
    member = User(id="member", email="member@example.com", role=UserRole.MEMBER)
    manager = User(id="manager", email="manager@example.com", role=UserRole.MEMBER)
    admin = User(id="admin", email="admin@example.com", role=UserRole.ADMIN)
    project = Project(
        id="p1", name="P1", slug="p1", created_by_user_id=manager.id, is_active=True
    )
    run = Run(
        id="run-1",
        project_id=project.id,
        created_by_user_id=member.id,
        owner_user_id=member.id,
        task="task",
        dataset="dataset",
        metrics=["accuracy"],
        status=RunWorkflowStatus.COMPLETED,
    )
    db.add_all([member, manager, admin, project, run])
    db.flush()
    db.add_all(
        [
            ProjectMembership(
                project_id=project.id, user_id=member.id, role=ProjectRole.MEMBER
            ),
            ProjectMembership(
                project_id=project.id, user_id=manager.id, role=ProjectRole.MANAGER
            ),
        ]
    )
    live = _create_analysis_rule_version(
        db,
        project_id=project.id,
        rules=[{"title": "Live", "instruction": "Approved rule."}],
        source="manual",
        actor_user_id=manager.id,
        force_new=True,
    )
    live.status = AnalysisRuleVersionStatus.PUBLISHED
    db.add(
        ProjectAnalysisRuleAlias(
            project_id=project.id,
            alias="production",
            rule_version_id=live.id,
            updated_by_user_id=manager.id,
        )
    )
    draft = _create_analysis_rule_version(
        db,
        project_id=project.id,
        rules=[{"title": "Draft", "instruction": "Manager draft."}],
        source="manual",
        actor_user_id=manager.id,
        force_new=True,
        parent=live,
    )
    db.commit()
    ids = {"live": live.id, "draft": draft.id}
    db.close()

    users = {"member": member, "manager": manager, "admin": admin}
    current = {"user": member}
    app = create_app()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=current["user"], auth_type="session"
    )

    def act_as(name: str) -> None:
        current["user"] = users[name]

    with TestClient(app) as client:
        yield client, factory, ids, act_as
    app.dependency_overrides.clear()
    engine.dispose()


def _row(factory, version_id):
    with factory() as db:
        return db.get(ProjectAnalysisRuleVersion, version_id)


def test_member_who_owns_the_run_gets_403_and_the_row_stays(env):
    client, factory, ids, act_as = env
    act_as("member")

    listed = client.get("/api/runs/run-1/analysis-rule-versions")
    assert listed.status_code == 200
    assert listed.json()["can_delete"] is False

    response = client.delete(f"/api/runs/run-1/analysis-rule-versions/{ids['draft']}")

    assert response.status_code == 403
    row = _row(factory, ids["draft"])
    assert row is not None
    assert row.deleted_at is None


def test_member_gets_403_on_the_project_route_too(env):
    client, factory, ids, act_as = env
    act_as("member")

    response = client.delete(f"/api/projects/p1/analysis-rule-versions/{ids['draft']}")

    assert response.status_code == 403
    assert _row(factory, ids["draft"]).deleted_at is None


def test_server_refuses_to_delete_the_live_version(env):
    client, factory, ids, act_as = env
    act_as("manager")

    response = client.delete(f"/api/runs/run-1/analysis-rule-versions/{ids['live']}")

    assert response.status_code == 409
    assert _row(factory, ids["live"]).deleted_at is None


def test_manager_delete_is_soft_and_an_admin_can_restore_it(env):
    client, factory, ids, act_as = env
    act_as("manager")
    assert client.get("/api/runs/run-1/analysis-rule-versions").json()["can_delete"]

    response = client.delete(f"/api/runs/run-1/analysis-rule-versions/{ids['draft']}")

    assert response.status_code == 200
    row = _row(factory, ids["draft"])
    assert row is not None
    assert row.deleted_at is not None
    assert row.deleted_by_user_id == "manager"
    listed = client.get("/api/runs/run-1/analysis-rule-versions").json()
    assert ids["draft"] not in {v["id"] for v in listed["versions"]}

    act_as("admin")
    with_deleted = client.get(
        "/api/runs/run-1/analysis-rule-versions?include_deleted=true"
    ).json()
    assert ids["draft"] in {
        v["id"] for v in with_deleted["versions"] if v["is_deleted"]
    }
    restored = client.post(
        f"/api/runs/run-1/analysis-rule-versions/{ids['draft']}/restore"
    )
    assert restored.status_code == 200
    assert _row(factory, ids["draft"]).deleted_at is None
