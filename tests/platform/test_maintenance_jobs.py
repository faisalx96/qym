import os

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.maintenance_models import MaintenanceJob
from qym_platform.db.models import Project, Run, RunEvent, RunWorkflowStatus, Span, User, UserRole
from qym_platform.deps import get_db
from qym_platform.services import maintenance
from qym_platform.settings import PlatformSettings


@pytest.fixture
def sqlite_engine():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(id="admin", email="a@example.test", display_name="A", role=UserRole.ADMIN))
        db.add(User(id="member", email="m@example.test", display_name="M", role=UserRole.MEMBER))
        db.flush()
        db.add(Project(id="p", name="P", slug="p", created_by_user_id="admin"))
        db.commit()
    yield engine
    engine.dispose()


def _factory(engine):
    return sessionmaker(bind=engine, autoflush=False)


def test_workers_in_same_process_have_distinct_lease_owners(sqlite_engine):
    factory = _factory(sqlite_engine)
    first = maintenance.MaintenanceWorker(factory, sqlite_engine)
    second = maintenance.MaintenanceWorker(factory, sqlite_engine)
    assert first.owner != second.owner
    assert len(first.owner) <= 64


def test_job_runs_in_steps_and_persists_progress(sqlite_engine):
    calls = []

    @maintenance.register("test_steps")
    def _steps(ctx):
        n = int(ctx.progress.get("n", 0)) + 1
        ctx.progress["n"] = n
        ctx.log(f"step {n}")
        calls.append(n)
        return n >= 3

    try:
        factory = _factory(sqlite_engine)
        with factory() as db:
            job = maintenance.enqueue(db, "test_steps", {"x": 1}, requested_by="admin")
            db.commit()
            job_id = job.id
            with pytest.raises(ValueError, match="already queued"):
                maintenance.enqueue(db, "test_steps")
        worker = maintenance.MaintenanceWorker(factory, sqlite_engine)
        assert worker.tick() == "succeeded"
        assert worker.tick() is None
        with factory() as db:
            row = db.get(MaintenanceJob, job_id)
            assert row.status == "succeeded"
            assert row.progress["n"] == 3
            assert row.log.count("step") == 3
            assert row.finished_at is not None and row.lease_owner is None
        assert calls == [1, 2, 3]
    finally:
        maintenance._REGISTRY.pop("test_steps", None)


def test_failed_job_records_error_and_cancel_flow(sqlite_engine):
    @maintenance.register("test_boom")
    def _boom(ctx):
        raise RuntimeError("kaboom")

    @maintenance.register("test_slow")
    def _slow(ctx):
        return False  # never finishes on its own

    try:
        factory = _factory(sqlite_engine)
        with factory() as db:
            boom = maintenance.enqueue(db, "test_boom")
            db.commit()
            boom_id = boom.id
        worker = maintenance.MaintenanceWorker(factory, sqlite_engine)
        assert worker.tick() == "failed"
        with factory() as db:
            row = db.get(MaintenanceJob, boom_id)
            assert row.status == "failed" and "kaboom" in row.error
            slow = maintenance.enqueue(db, "test_slow")
            db.commit()
            slow_id = slow.id
            # queued -> cancelled immediately
            assert maintenance.request_cancel(db, slow_id).status == "cancelled"
            db.commit()
        assert worker.tick() is None
    finally:
        maintenance._REGISTRY.pop("test_boom", None)
        maintenance._REGISTRY.pop("test_slow", None)


def test_paused_job_waits_for_operator_start(sqlite_engine):
    @maintenance.register("test_paused")
    def _paused(ctx):
        return True

    try:
        factory = _factory(sqlite_engine)
        with factory() as db:
            job = maintenance.enqueue(db, "test_paused")
            job.status = "paused"
            db.commit()
            job_id = job.id
        worker = maintenance.MaintenanceWorker(factory, sqlite_engine)
        assert worker.tick() is None
        with factory() as db:
            assert maintenance.request_start(db, job_id).status == "queued"
            db.commit()
        assert worker.tick() == "succeeded"
    finally:
        maintenance._REGISTRY.pop("test_paused", None)


def test_prune_dashboard_events_handler(sqlite_engine):
    from datetime import datetime, timedelta

    from qym_platform.db.dashboard_models import DashboardChangeEvent

    factory = _factory(sqlite_engine)
    old = datetime.utcnow() - timedelta(days=30)
    with factory() as db:
        db.info["dashboard_projection_worker"] = True
        for i, published in enumerate([old, old, None]):
            db.add(
                DashboardChangeEvent(
                    event_id=f"e{i}",
                    source_version=i + 1,
                    project_key="p",
                    partition_key="r",
                    record_key=f"r:item:{i}",
                    record_kind="item",
                    created_at=old,
                    published_at=published,
                )
            )
        job = maintenance.enqueue(db, "prune_dashboard_events", {"days": 7})
        db.commit()
        job_id = job.id
    worker = maintenance.MaintenanceWorker(factory, sqlite_engine)
    assert worker.tick() == "succeeded"
    with factory() as db:
        assert db.query(DashboardChangeEvent).count() == 1
        assert db.get(MaintenanceJob, job_id).progress["rows_deleted"] == 2


def _client(engine, monkeypatch, *, user_id="admin", **overrides):
    # require_ui_principal reads PlatformSettings() from the environment.
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    settings = PlatformSettings(database_url="sqlite://", auth_mode="proxy_headers", **overrides)
    app = create_app(settings)
    factory = _factory(engine)

    def override():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    email = {"admin": "a@example.test", "member": "m@example.test"}[user_id]
    return TestClient(app, headers={"X-User-Email": email, "Origin": settings.base_url})


def test_admin_api_requires_admin_and_confirms_irreversible(sqlite_engine, monkeypatch):
    @maintenance.register("test_danger", irreversible=True)
    def _danger(ctx):
        return True

    try:
        with _client(sqlite_engine, monkeypatch, user_id="member") as client:
            assert client.get("/api/admin/maintenance").status_code == 403
        with _client(sqlite_engine, monkeypatch) as client:
            overview = client.get("/api/admin/maintenance")
            assert overview.status_code == 200
            body = overview.json()
            assert body["settings"]["maintenance_mode"] is False
            assert "reclaim_run_events" in body["job_kinds"]
            assert body["job_kinds"]["test_danger"]["irreversible"] is True
            assert client.post("/api/admin/maintenance/jobs", json={"kind": "nope"}).status_code == 400
            assert client.post("/api/admin/maintenance/jobs", json={"kind": "test_danger"}).status_code == 400
            created = client.post("/api/admin/maintenance/jobs", json={"kind": "test_danger", "confirm": "test_danger"})
            assert created.status_code == 200 and created.json()["status"] == "queued"
            job_id = created.json()["id"]
            assert client.post("/api/admin/maintenance/jobs", json={"kind": "test_danger", "confirm": "test_danger"}).status_code == 409
            assert client.get(f"/api/admin/maintenance/jobs/{job_id}").json()["kind"] == "test_danger"
            assert client.post(f"/api/admin/maintenance/jobs/{job_id}/cancel").json()["status"] == "cancelled"
    finally:
        maintenance._REGISTRY.pop("test_danger", None)


def test_maintenance_mode_returns_503_for_ingest(sqlite_engine, monkeypatch):
    from qym_platform.api import ingest
    from qym_platform.services import event_storage

    from qym_platform.auth import Principal, require_api_key_principal

    closed = PlatformSettings(database_url="sqlite://", maintenance_mode=True)
    monkeypatch.setattr(ingest, "ingest_settings", lambda: closed)
    monkeypatch.setattr(event_storage, "ingest_settings", lambda: closed)
    with _client(sqlite_engine, monkeypatch) as client:
        with Session(sqlite_engine) as db:
            admin = db.get(User, "admin")
            db.expunge(admin)
        client.app.dependency_overrides[require_api_key_principal] = lambda: Principal(user=admin, auth_type="api_key", scopes=["runs:write"], project_id="p")
        resp = client.post("/v1/runs", json={"task": "t", "dataset": "d", "metrics": []}, headers={"Authorization": "Bearer key"})
        assert resp.status_code == 503
        assert resp.headers.get("retry-after") == "60"
        resp = client.post("/v1/runs/abc/events", content=b"", headers={"Authorization": "Bearer key"})
        assert resp.status_code == 503


@pytest.mark.usefixtures("postgres_engine")
def test_reclaim_and_index_jobs_on_postgres(postgres_engine):
    factory = _factory(postgres_engine)
    with factory() as db:
        db.info["dashboard_projection_worker"] = True
        db.add(User(id="u", email="u@example.test", display_name="U", role=UserRole.ADMIN))
        db.flush()
        db.add(Project(id="p", name="P", slug="p", created_by_user_id="u"))
        db.flush()
        for r in range(3):
            db.add(Run(id=f"r{r}", project_id="p", created_by_user_id="u", owner_user_id="u", task="t", dataset="d", status=RunWorkflowStatus.COMPLETED))
        db.flush()
        seq = 0
        for r in range(3):
            for t in ("item_started", "span_completed", "span_completed", "item_completed"):
                seq += 1
                db.add(RunEvent(run_id=f"r{r}", event_id=f"e{seq}", sequence=seq, type=t, sent_at=__import__("datetime").datetime.utcnow(), payload={}))
            db.add(Span(run_id=f"r{r}", trace_id="t", span_id=f"s{r}", name="x"))
        db.commit()
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_run_events_run_id ON run_events (run_id)"))
        db.execute(text("DROP INDEX IF EXISTS ix_run_events_run_type_seq"))
        db.commit()
        reclaim = maintenance.enqueue(db, "reclaim_run_events", {"batch_runs": 2, "vacuum_every": 1})
        db.commit()
        reclaim_id = reclaim.id
    worker = maintenance.MaintenanceWorker(factory, postgres_engine)
    assert worker.tick() == "succeeded"
    with factory() as db:
        assert db.query(RunEvent).filter(RunEvent.type == "span_completed").count() == 0
        assert db.query(RunEvent).count() == 6
        assert db.query(Span).count() == 3
        row = db.get(MaintenanceJob, reclaim_id)
        assert row.progress["rows_deleted"] == 6 and row.progress["runs_done"] == 3
        assert "VACUUM" in row.log
        maintenance.enqueue(db, "drop_redundant_indexes", {"indexes": ["ix_run_events_run_id", "ix_never_existed"]})
        db.commit()
    assert worker.tick() == "succeeded"
    with factory() as db:
        names = {r[0] for r in db.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'run_events' AND schemaname = current_schema()"))}
        assert "ix_run_events_run_id" not in names
        maintenance.enqueue(db, "create_deferred_indexes", {"indexes": [{"name": "ix_run_events_run_type_seq", "table": "run_events", "columns": ["run_id", "type", "sequence"]}]})
        db.commit()
    assert worker.tick() == "succeeded"
    with factory() as db:
        names = {r[0] for r in db.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'run_events' AND schemaname = current_schema()"))}
        assert "ix_run_events_run_type_seq" in names
