"""C016: a publish with "Set as production" off does not go live.

A project with no ``production`` alias used to treat its newest published rule
version as live, so every publish went live. Now the first publish sets the
alias, later publishes move it only when asked, and migration 0094 pins the
alias of projects that already had published versions.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
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
    User,
    UserRole,
)
from qym_platform.deps import get_db
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/migrations/versions/0094_pin_production_rule_alias.py"
)


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = factory(expire_on_commit=False)
    manager = User(id="manager", email="manager@example.com", role=UserRole.MEMBER)
    project = Project(id="p1", name="P1", slug="p1", created_by_user_id=manager.id, is_active=True)
    db.add_all([manager, project])
    db.flush()
    db.add(ProjectMembership(project_id=project.id, user_id=manager.id, role=ProjectRole.MANAGER))
    db.commit()
    db.close()
    app = create_app()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_ui_principal] = lambda: Principal(user=manager, auth_type="session")
    with TestClient(app) as client:
        yield client, factory, engine
    app.dependency_overrides.clear()
    engine.dispose()


def _publish(client, factory, set_alias=None) -> str:
    draft = client.post("/api/projects/p1/analysis-rule-versions", json={})
    assert draft.status_code == 200, draft.text
    version_id = draft.json()["version"]["id"]
    with factory() as db:  # the editor's autosave, written straight on the draft
        db.get(ProjectAnalysisRuleVersion, version_id).rules = [{"title": "Rule", "instruction": "Do it."}]
        db.commit()
    body = {"set_alias": set_alias} if set_alias else {}
    published = client.post(f"/api/projects/p1/analysis-rule-versions/{version_id}:publish", json=body)
    assert published.status_code == 200, published.text
    return version_id


def _production(factory):
    with factory() as db:
        alias = db.query(ProjectAnalysisRuleAlias).filter_by(project_id="p1", alias="production").one_or_none()
        return alias.rule_version_id if alias else None


def test_first_publish_goes_live_and_later_ones_only_when_asked(env):
    client, factory, _ = env
    first = _publish(client, factory)
    assert _production(factory) == first
    second = _publish(client, factory)
    assert _production(factory) == first, "a publish with Set as production off must not go live"
    third = _publish(client, factory, set_alias="production")
    assert _production(factory) == third
    assert second not in (_production(factory),)


def test_migration_pins_the_version_that_was_live(env):
    _, factory, engine = env
    with factory() as db:
        for number, published in ((1, datetime(2026, 9, 1)), (2, datetime(2026, 9, 5)), (3, None)):
            db.add(
                ProjectAnalysisRuleVersion(
                    id=f"v{number}",
                    project_id="p1",
                    version=number,
                    status=AnalysisRuleVersionStatus.PUBLISHED,
                    rules=[{"title": "r", "instruction": "i"}],
                    created_by_user_id="manager",
                    published_by_user_id="manager",
                    published_at=published,
                )
            )
        db.commit()
    spec = importlib.util.spec_from_file_location("m0092", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        module.upgrade()  # a second run finds the alias and adds nothing
    assert _production(factory) == "v2"
    with factory() as db:
        assert db.query(ProjectAnalysisRuleAlias).filter_by(project_id="p1").count() == 1
