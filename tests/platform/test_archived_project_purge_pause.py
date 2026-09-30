"""Trash purging pauses while a project is archived, and Unarchive says which
API keys start working again.

Restore refuses runs of an archived project, so retention must not purge them
meanwhile: their purge clock pauses at archive and resumes at unarchive where
it stopped (each run keeps its own clock). Deleted Runs shows "Purge paused"
instead of a date. The Unarchive dialog lists the keys unarchiving turns back
on, from ``GET /v1/admin/projects/{id}/unarchive-preview``.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
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
    ApiKey,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.services import maintenance, retention

ORIGIN = "http://localhost:8000"
ADMIN = {"X-User-Email": "admin@x.com", "Origin": ORIGIN}
MGR = {"X-User-Email": "mgr@x.com", "Origin": ORIGIN}
GRACE = 30
NOW = datetime(2026, 9, 30, 12, 0, 0)


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


@pytest.fixture(params=["sqlite", "postgres"])
def engine(request, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", str(GRACE))
    clear_api_key_cache()
    cleanup = None
    if request.param == "postgres":
        from uuid import uuid4

        from sqlalchemy.engine import make_url

        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_pause_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(make_url(url).update_query_dict({"options": f"-csearch_path={schema}"}))

        def cleanup():
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
                User(id="gone", email="gone@x.com", role=UserRole.MEMBER),
                User(id="off", email="off@x.com", role=UserRole.MEMBER, is_active=False),
            ]
        )
        db.flush()
        db.add_all(
            [
                Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin", is_active=True),
                Project(id="pb", name="Project B", slug="pb", created_by_user_id="admin", is_active=True),
            ]
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER),
                ProjectMembership(project_id="pa", user_id="off", role=ProjectRole.MEMBER),
                ProjectMembership(project_id="pb", user_id="mgr", role=ProjectRole.MANAGER),
            ]
        )
        db.commit()
    yield engine
    clear_api_key_cache()
    engine.dispose()
    if cleanup:
        cleanup()


@pytest.fixture()
def make(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


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


def _trash(make, *runs) -> None:
    with make() as db:
        db.add_all(runs)
        db.commit()


def _archive(client, project_id: str, *, at: datetime) -> None:
    """Archive through the API, as if it happened at ``at``."""
    assert client.post(f"/v1/admin/projects/{project_id}/archive", headers=ADMIN).status_code == 200
    _set_archived_at(client.app, project_id, at)


def _set_archived_at(app, project_id: str, at: datetime) -> None:
    session = next(app.dependency_overrides[get_db]())
    try:
        session.get(Project, project_id).archived_at = at
        session.commit()
    finally:
        session.close()


def _clock(make, run_id: str):
    with make() as db:
        return db.get(Run, run_id).purge_clock_started_at


def _exists(make, run_id: str) -> bool:
    with make() as db:
        return db.get(Run, run_id) is not None


# ── Retention ────────────────────────────────────────────────────────────────


def test_purge_skips_deleted_runs_of_archived_projects(engine, make, client):
    old = NOW - timedelta(days=GRACE + 10)
    _trash(make, _run("active-old", "pa", old), _run("archived-old", "pb", old))
    _archive(client, "pb", at=NOW - timedelta(days=1))

    assert retention.purge_soft_deleted_runs(engine, grace_days=GRACE, now=NOW) == ["active-old"]
    assert _exists(make, "archived-old")
    # Still paused on every later tick.
    assert retention.purge_soft_deleted_runs(engine, grace_days=GRACE, now=NOW + timedelta(days=400)) == []


def test_the_retention_job_leaves_archived_projects_alone(engine, make, client):
    if engine.dialect.name != "sqlite":
        pytest.skip("span partitions need the migrated schema (test_retention.py)")
    old = NOW - timedelta(days=GRACE + 10)
    _trash(make, _run("active-old", "pa", old), _run("archived-old", "pb", old))
    _archive(client, "pb", at=NOW - timedelta(days=1))
    with make() as db:
        job = maintenance.enqueue(db, "run_retention", {"deleted_run_grace_days": GRACE})
        db.commit()
        job_id = job.id
    worker = maintenance.MaintenanceWorker(make, engine, retention_interval=0)
    assert worker.tick()
    with make() as db:
        job = db.get(maintenance_models.MaintenanceJob, job_id)
        assert job.status == "succeeded", job.error
        assert job.progress["runs_purged"] == ["active-old"]
    assert _exists(make, "archived-old")


def test_unarchive_resumes_the_purge_clock_where_it_paused(engine, make, client):
    deleted = NOW - timedelta(days=120)
    _trash(make, _run("r", "pb", deleted))
    # Archived 20 days after the delete (10 days of grace left), for 100 days.
    _archive(client, "pb", at=deleted + timedelta(days=20))
    before = datetime.utcnow()
    assert client.post("/v1/admin/projects/pb/unarchive", headers=ADMIN).status_code == 200
    unarchived = datetime.utcnow()

    clock = _clock(make, "r")
    paused_min = before - (deleted + timedelta(days=20))
    paused_max = unarchived - (deleted + timedelta(days=20))
    assert deleted + paused_min <= clock <= deleted + paused_max
    # 10 days of grace were left at archive: still 10 days after unarchive.
    due = retention.purge_due_at(deleted, GRACE, clock)
    assert unarchived + timedelta(days=9) < due <= unarchived + timedelta(days=10, seconds=1)
    assert retention.purge_soft_deleted_runs(engine, grace_days=GRACE, now=unarchived + timedelta(days=9)) == []
    assert retention.purge_soft_deleted_runs(engine, grace_days=GRACE, now=unarchived + timedelta(days=11)) == ["r"]
    with make() as db:
        project = db.get(Project, "pb")
        assert project.is_active and project.archived_at is None


def test_each_run_is_credited_only_for_the_pauses_after_its_delete(engine, make, client):
    start = NOW - timedelta(days=300)
    _trash(make, _run("early", "pb", start))
    _archive(client, "pb", at=start + timedelta(days=5))
    assert client.post("/v1/admin/projects/pb/unarchive", headers=ADMIN).status_code == 200
    first_pause = _clock(make, "early") - start
    assert first_pause > timedelta(days=290)

    _trash(make, _run("late", "pb", datetime.utcnow() - timedelta(days=1)))
    _archive(client, "pb", at=datetime.utcnow() - timedelta(days=3))
    assert client.post("/v1/admin/projects/pb/unarchive", headers=ADMIN).status_code == 200
    # "early" gets both pauses; "late" (deleted after the first) only the second.
    second_pause = _clock(make, "early") - start - first_pause
    assert timedelta(days=2, hours=23) < second_pause < timedelta(days=3, minutes=1)
    late = _clock(make, "late")
    with make() as db:
        late_deleted = db.get(Run, "late").deleted_at
    assert timedelta(days=2, hours=23) < late - late_deleted < timedelta(days=3, minutes=1)


def test_archiving_through_the_project_update_pauses_and_resumes_too(engine, make, client):
    """PATCH /v1/admin/projects/{id} with is_active toggles the same pause."""
    deleted = NOW - timedelta(days=GRACE + 10)
    _trash(make, _run("r", "pb", deleted))
    assert client.patch("/v1/admin/projects/pb", json={"is_active": False}, headers=ADMIN).status_code == 200
    with make() as db:
        assert db.get(Project, "pb").archived_at is not None
    assert retention.purge_soft_deleted_runs(engine, grace_days=GRACE, now=NOW) == []

    _set_archived_at(client.app, "pb", deleted + timedelta(days=20))
    before = datetime.utcnow()
    assert client.patch("/v1/admin/projects/pb", json={"is_active": True}, headers=ADMIN).status_code == 200
    with make() as db:
        project = db.get(Project, "pb")
        assert project.is_active and project.archived_at is None
    # 10 days of grace were left at archive: still about 10 days after unarchive.
    due = retention.purge_due_at(deleted, GRACE, _clock(make, "r"))
    assert before + timedelta(days=9) < due < datetime.utcnow() + timedelta(days=10, seconds=1)


def test_deleting_and_restoring_reset_the_purge_clock(make, client):
    with make() as db:
        db.add(_run("r", "pa", NOW - timedelta(days=5)))
        db.flush()
        db.get(Run, "r").purge_clock_started_at = NOW + timedelta(days=50)
        db.commit()
    assert client.post("/api/runs/restore", headers=ADMIN, json={"run_id": "r"}).status_code == 200
    assert _clock(make, "r") is None
    with make() as db:
        db.get(Run, "r").purge_clock_started_at = NOW
        db.commit()
    assert client.post("/api/runs/delete", headers=ADMIN, json={"file_path": "r"}).status_code == 200
    assert _clock(make, "r") is None


def test_purge_query_uses_the_deleted_at_index_on_sqlite(engine):
    """The pause adds a per-row filter; the scan stays an index range scan."""
    if engine.dialect.name != "sqlite":
        pytest.skip("SQLite query plan")
    with engine.connect() as conn:
        plan = " ".join(
            str(row[-1])
            for row in conn.execute(
                text(f"EXPLAIN QUERY PLAN SELECT id FROM runs WHERE {retention._PURGE_DUE} ORDER BY deleted_at LIMIT 50"),
                {"c": NOW, "active": True},
            )
        )
    assert "ix_runs_deleted_at" in plan, plan


def test_purge_due_at_counts_from_the_purge_clock():
    deleted = datetime(2026, 9, 1)
    assert retention.purge_due_at(deleted, 30) == datetime(2026, 10, 1)
    assert retention.purge_due_at(deleted, 30, datetime(2026, 9, 11)) == datetime(2026, 10, 11)
    # A clock never runs behind the deletion.
    assert retention.purge_due_at(deleted, 30, datetime(2026, 8, 1)) == datetime(2026, 10, 1)
    assert retention.purge_due_at(deleted, 0, datetime(2026, 9, 11)) is None


# ── Deleted Runs and project deletion ───────────────────────────────────────


def test_trash_says_purge_is_paused_for_archived_projects(make, client):
    deleted = datetime.utcnow() - timedelta(days=3)
    _trash(make, _run("in-a", "pa", deleted), _run("in-b", "pb", deleted))
    _archive(client, "pb", at=datetime.utcnow())
    rows = {row["id"]: row for row in client.get("/api/runs/trash", headers=ADMIN).json()}
    assert rows["in-b"]["purge_paused"] is True and rows["in-b"]["purge_at"] is None
    assert rows["in-b"]["project_archived"] is True
    assert rows["in-a"]["purge_paused"] is False and rows["in-a"]["purge_at"]

    assert client.post("/v1/admin/projects/pb/unarchive", headers=ADMIN).status_code == 200
    row = {r["id"]: r for r in client.get("/api/runs/trash", headers=ADMIN).json()}["in-b"]
    assert row["purge_paused"] is False and row["purge_at"]


def test_deleting_an_archived_project_explains_the_paused_purge(make, client):
    _trash(make, _run("in-b", "pb", datetime.utcnow()))
    _archive(client, "pb", at=datetime.utcnow())
    preview = client.get("/v1/admin/projects/pb/deletion", headers=ADMIN).json()
    assert preview["archived"] is True and preview["can_delete"] is False
    reason = preview["blocked_reason"]
    assert "purging is paused while the project is archived" in reason
    assert "It stays archived and keeps its data." in reason
    assert "Archive it instead" not in reason


# ── Unarchive preview ────────────────────────────────────────────────────────


def _key(key_id: str, user_id: str, project_id: str = "pa", **fields) -> ApiKey:
    return ApiKey(
        id=key_id,
        user_id=user_id,
        project_id=project_id,
        name=fields.pop("name", key_id),
        prefix=key_id[:16],
        key_hash=b"x",
        scopes=[],
        **fields,
    )


def test_unarchive_preview_lists_the_keys_that_start_working_again(make, client):
    with make() as db:
        db.add_all(
            [
                _key("ci", "mgr", name="CI pipeline"),
                _key("admin-key", "admin", name="Admin notebook"),  # admins need no membership
                _key("revoked", "mgr", revoked_at=datetime.utcnow()),
                _key("disabled-owner", "off"),
                _key("removed-member", "gone"),
                _key("other-project", "mgr", project_id="pb"),
            ]
        )
        db.commit()
    assert client.post("/v1/admin/projects/pa/archive", headers=ADMIN).status_code == 200
    body = client.get("/v1/admin/projects/pa/unarchive-preview", headers=ADMIN).json()
    assert body["archived"] is True and body["slug"] == "pa"
    assert body["active_api_key_count"] == 2
    assert sorted(key["name"] for key in body["active_api_keys"]) == ["Admin notebook", "CI pipeline"]
    assert {key["creator"]["email"] for key in body["active_api_keys"]} == {"mgr@x.com", "admin@x.com"}
    assert "key_hash" not in body["active_api_keys"][0]


def test_unarchive_preview_caps_the_list_and_is_admin_only(make, client):
    with make() as db:
        db.add_all([_key(f"k{index:02d}", "mgr") for index in range(12)])
        db.commit()
    assert client.get("/v1/admin/projects/pa/unarchive-preview", headers=MGR).status_code == 403
    body = client.get("/v1/admin/projects/pa/unarchive-preview", headers=ADMIN).json()
    assert body["active_api_key_count"] == 12
    assert len(body["active_api_keys"]) == 10
