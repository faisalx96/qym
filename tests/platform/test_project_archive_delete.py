"""C021: "Archive" archives and "Delete" deletes.

Archive is reversible and never removes rows. Delete needs a typed
confirmation, removes everything a run-less project owns (including datasets
and LLM connections, which used to fail on a foreign key), and is refused with
a clear 409 while the project still has runs.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
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
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalyzerDocument,
    ApiKey,
    AuditLog,
    Dataset,
    DatasetAlias,
    DatasetItem,
    DatasetItemRevision,
    DatasetVersion,
    DatasetVersionChange,
    DatasetVersionStatus,
    Project,
    ProjectAnalysisCategoryCatalogVersion,
    ProjectAnalysisRuleMergeParent,
    ProjectAnalysisRuleVersion,
    ProjectLlmConnection,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key

ADMIN = {"X-User-Email": "admin@x.com", "Origin": "http://localhost:8000"}
MANAGER = {"X-User-Email": "mgr@x.com", "Origin": "http://localhost:8000"}


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    # Enforce foreign keys like PostgreSQL does, so a missed child table fails.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
            ]
        )
        db.commit()
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
    app.dependency_overrides.clear()


def _create_project(client, session_factory, slug: str) -> str:
    """A project set up like a new one: rules, catalog, member, key, dataset, LLM."""
    response = client.post("/v1/projects", json={"name": f"Project {slug}", "slug": slug}, headers=ADMIN)
    assert response.status_code == 200
    project_id = response.json()["id"]
    with session_factory() as db:
        db.add(ProjectMembership(project_id=project_id, user_id="mgr", role=ProjectRole.MANAGER))
        db.add(
            ApiKey(
                id=f"key-{slug}",
                user_id="mgr",
                project_id=project_id,
                name="ci",
                prefix=api_key_prefix(f"tok-{slug}-xxxxxxxx"),
                key_hash=hash_api_key(f"tok-{slug}-xxxxxxxx"),
                scopes=[],
            )
        )
        db.add(
            ProjectLlmConnection(
                id=f"llm-{slug}", project_id=project_id, name="default", is_default=True
            )
        )
        db.add(
            AnalyzerDocument(
                id=f"doc-{slug}",
                project_id=project_id,
                uploaded_by_user_id="admin",
                name="guide.md",
                content="text",
                characters=4,
            )
        )
        dataset = Dataset(id=f"ds-{slug}", project_id=project_id, name="golden", slug="golden", created_by_user_id="mgr")
        db.add(dataset)
        db.flush()
        v1 = DatasetVersion(
            id=f"v1-{slug}", dataset_id=dataset.id, version="v1", created_by_user_id="mgr",
            status=DatasetVersionStatus.PUBLISHED,
        )
        db.add(v1)
        db.flush()
        v2 = DatasetVersion(
            id=f"v2-{slug}", dataset_id=dataset.id, version="v2", created_by_user_id="mgr",
            parent_version_id=v1.id, base_version_id=v1.id,
        )
        db.add(v2)
        db.flush()
        item = DatasetItem(dataset_version_id=v2.id, item_id="case-1", input="q", fingerprint="f")
        db.add(item)
        db.flush()
        db.add_all(
            [
                DatasetItemRevision(
                    dataset_item_id=item.id, dataset_version_id=v2.id, revision_number=1,
                    change_type="add", actor_user_id="mgr",
                ),
                DatasetVersionChange(dataset_version_id=v2.id, parent_version_id=v1.id),
                DatasetAlias(dataset_id=dataset.id, alias="production", dataset_version_id=v1.id, updated_by_user_id="mgr"),
            ]
        )
        first_rules = (
            db.query(ProjectAnalysisRuleVersion)
            .filter(ProjectAnalysisRuleVersion.project_id == project_id)
            .one()
        )
        merged = ProjectAnalysisRuleVersion(
            id=f"rules-merged-{slug}", project_id=project_id, version=2,
            parent_version_id=first_rules.id, base_version_id=first_rules.id,
        )
        db.add(merged)
        db.flush()
        db.add(ProjectAnalysisRuleMergeParent(version_id=merged.id, parent_version_id=first_rules.id))
        db.commit()
    return project_id


def _add_run(session_factory, project_id: str, *, trashed: bool = False) -> None:
    with session_factory() as db:
        db.add(
            Run(
                project_id=project_id,
                created_by_user_id="admin",
                owner_user_id="admin",
                task="t",
                dataset="d",
                metrics=[],
                run_metadata={},
                run_config={},
                status=RunWorkflowStatus.COMPLETED,
                deleted_at=datetime.utcnow() if trashed else None,
            )
        )
        db.commit()


def _row_counts(session_factory, project_id: str) -> dict:
    with session_factory() as db:
        dataset_ids = [d.id for d in db.query(Dataset).filter(Dataset.project_id == project_id)]
        return {
            "project": db.query(Project).filter(Project.id == project_id).count(),
            "keys": db.query(ApiKey).filter(ApiKey.project_id == project_id).count(),
            "members": db.query(ProjectMembership).filter(ProjectMembership.project_id == project_id).count(),
            "llm": db.query(ProjectLlmConnection).filter(ProjectLlmConnection.project_id == project_id).count(),
            "docs": db.query(AnalyzerDocument).filter(AnalyzerDocument.project_id == project_id).count(),
            "datasets": len(dataset_ids),
            "versions": db.query(DatasetVersion).filter(DatasetVersion.dataset_id.in_(dataset_ids)).count(),
            "rules": db.query(ProjectAnalysisRuleVersion).filter(ProjectAnalysisRuleVersion.project_id == project_id).count(),
            "catalogs": db.query(ProjectAnalysisCategoryCatalogVersion)
            .filter(ProjectAnalysisCategoryCatalogVersion.project_id == project_id)
            .count(),
        }


def test_archive_never_deletes_a_runless_project(client, session_factory):
    project_id = _create_project(client, session_factory, "fresh")
    before = _row_counts(session_factory, project_id)
    assert before["keys"] == 1 and before["members"] == 2

    response = client.post(f"/v1/admin/projects/{project_id}/archive", headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        assert db.get(Project, project_id).is_active is False
        assert db.query(AuditLog).filter(AuditLog.action == "project.archived").count() == 1

    # Idempotent, and reversible.
    assert client.post(f"/v1/admin/projects/{project_id}/archive", headers=ADMIN).status_code == 200
    restored = client.post(f"/v1/admin/projects/{project_id}/unarchive", headers=ADMIN)
    assert restored.status_code == 200
    assert restored.json()["is_active"] is True
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        assert db.query(AuditLog).filter(AuditLog.action == "project.unarchived").count() == 1


def test_delete_requires_typed_confirmation(client, session_factory):
    project_id = _create_project(client, session_factory, "confirm-me")
    before = _row_counts(session_factory, project_id)
    for url in (
        f"/v1/admin/projects/{project_id}",
        f"/v1/admin/projects/{project_id}?confirm=wrong",
    ):
        response = client.delete(url, headers=ADMIN)
        assert response.status_code == 400
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        # The old combined endpoint archived on DELETE; now nothing happens.
        assert db.get(Project, project_id).is_active is True


def test_delete_removes_datasets_llm_connections_and_settings(client, session_factory):
    project_id = _create_project(client, session_factory, "doomed")
    keep_id = _create_project(client, session_factory, "keeper")
    keep_before = _row_counts(session_factory, keep_id)

    preview = client.get(f"/v1/admin/projects/{project_id}/deletion", headers=ADMIN)
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_delete"] is True and body["blocked_reason"] is None
    assert body["counts"] == {
        "runs": 0,
        "runs_in_trash": 0,
        "datasets": 1,
        "api_keys": 1,
        "members": 2,
        "llm_connections": 1,
        "rule_versions": 2,
        "analyzer_documents": 1,
    }

    response = client.delete(f"/v1/admin/projects/{project_id}?confirm=Project%20doomed", headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is True
    assert response.json()["counts"]["datasets"] == 1
    assert _row_counts(session_factory, project_id) == {
        "project": 0, "keys": 0, "members": 0, "llm": 0, "docs": 0,
        "datasets": 0, "versions": 0, "rules": 0, "catalogs": 0,
    }
    with session_factory() as db:
        assert db.query(DatasetItem).count() == 1  # the other project's item
        assert db.query(ProjectAnalysisRuleMergeParent).count() == 1
        audit = db.query(AuditLog).filter(AuditLog.action == "project.deleted").one()
        assert audit.entity_id == project_id
    assert _row_counts(session_factory, keep_id) == keep_before


def test_delete_accepts_the_slug_as_confirmation(client, session_factory):
    project_id = _create_project(client, session_factory, "by-slug")
    response = client.delete(f"/v1/admin/projects/{project_id}?confirm=by-slug", headers=ADMIN)
    assert response.status_code == 200


@pytest.mark.parametrize("trashed", [False, True])
def test_delete_is_refused_while_the_project_has_runs(client, session_factory, trashed):
    project_id = _create_project(client, session_factory, "has-runs")
    _add_run(session_factory, project_id, trashed=trashed)
    before = _row_counts(session_factory, project_id)

    preview = client.get(f"/v1/admin/projects/{project_id}/deletion", headers=ADMIN).json()
    assert preview["can_delete"] is False
    assert ("in Trash" in preview["blocked_reason"]) is trashed

    response = client.delete(f"/v1/admin/projects/{project_id}?confirm=has-runs", headers=ADMIN)
    assert response.status_code == 409
    assert response.json()["detail"] == preview["blocked_reason"]
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        assert db.get(Project, project_id).is_active is True
        assert db.query(Run).filter(Run.project_id == project_id).count() == 1


def test_blocked_delete_says_when_trash_stops_blocking(client, session_factory, monkeypatch):
    """Deleting the runs is not enough: they block until Trash purges them."""
    project_id = _create_project(client, session_factory, "trash-wait")
    _add_run(session_factory, project_id, trashed=True)
    url = f"/v1/admin/projects/{project_id}/deletion"

    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", "7")
    reason = client.get(url, headers=ADMIN).json()["blocked_reason"]
    assert "1 run in Trash" in reason
    assert "purged 7 days after deletion" in reason

    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", "0")
    reason = client.get(url, headers=ADMIN).json()["blocked_reason"]
    assert "automatic Trash purging is turned off" in reason

    settings = (
        ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard" / "project_settings.html"
    ).read_text(encoding="utf-8")
    assert "delete its runs first" not in settings
    assert "until its runs are deleted and purged from Trash" in settings


def test_patch_toggling_is_active_is_audited_like_archive(client, session_factory):
    """PATCH is_active cuts off or restores API keys, so it leaves the same trail."""
    project_id = _create_project(client, session_factory, "patched")
    url = f"/v1/admin/projects/{project_id}"

    archived = client.patch(url, json={"is_active": False}, headers=ADMIN)
    assert archived.status_code == 200
    assert archived.json()["is_active"] is False
    # A no-op PATCH writes nothing.
    assert client.patch(url, json={"is_active": False}, headers=ADMIN).status_code == 200
    restored = client.patch(url, json={"is_active": True}, headers=ADMIN)
    assert restored.json()["is_active"] is True
    renamed = client.patch(
        url, json={"name": "Renamed", "slug": "renamed"}, headers=ADMIN
    )
    assert (renamed.json()["name"], renamed.json()["slug"]) == ("Renamed", "renamed")

    with session_factory() as db:
        rows = (
            db.query(AuditLog)
            .filter(AuditLog.entity_type == "project", AuditLog.entity_id == project_id)
            .order_by(AuditLog.id)
            .all()
        )
        trail = [(row.action, row.before["is_active"], row.after) for row in rows]
        assert trail == [
            ("project.archived", True, {"is_active": False}),
            ("project.unarchived", False, {"is_active": True}),
            ("project.updated", True, {"name": "Renamed", "slug": "renamed"}),
        ]
        assert rows[-1].before["slug"] == "patched"
        assert all(row.actor_user_id == "admin" for row in rows)


def test_project_lifecycle_endpoints_are_admin_only(client, session_factory):
    project_id = _create_project(client, session_factory, "guarded")
    for method, url in (
        ("post", f"/v1/admin/projects/{project_id}/archive"),
        ("post", f"/v1/admin/projects/{project_id}/unarchive"),
        ("get", f"/v1/admin/projects/{project_id}/deletion"),
        ("delete", f"/v1/admin/projects/{project_id}?confirm=guarded"),
    ):
        assert getattr(client, method)(url, headers=MANAGER).status_code == 403
    assert _row_counts(session_factory, project_id)["project"] == 1


def test_danger_zone_buttons_call_their_own_endpoints() -> None:
    dashboard = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
    settings = (dashboard / "project_settings.html").read_text(encoding="utf-8")
    admin = (dashboard / "admin.html").read_text(encoding="utf-8")

    assert "v1/admin/projects/${state.project.id}/archive" in settings
    assert "v1/admin/projects/${state.project.id}/deletion" in settings
    assert "v1/admin/projects/${state.project.id}?confirm=${encodeURIComponent(name)}" in settings
    assert "backend will archive it instead" not in settings
    assert "Runs and data are preserved" not in settings
    assert "Permanently delete this project, all runs" not in settings
    # Admin table: archive/unarchive only, via the shared dialog, never DELETE.
    assert "data-project-unarchive" in admin
    assert "${archived ? 'archive' : 'unarchive'}" in admin
    assert "confirm('Archive this project?')" not in admin
    assert "v1/admin/projects/${btn.dataset.projectDelete}" not in admin
