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

    @maintenance.register(
        "test_steps", params={"x": maintenance.Param("integer", 0, "A test param.")}
    )
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


def test_admin_overview_without_stats_and_db_stats_endpoint(sqlite_engine, monkeypatch):
    """The tab reads jobs and settings without the slow statistics, and the statistics on their own."""
    from qym_platform.api import admin as admin_api

    calls = []

    def fake_collect(engine, **kwargs):
        calls.append(kwargs)
        return {"database": {"size_bytes": 42}, "tables": [], "run_events_by_type": []}

    monkeypatch.setattr("qym_platform.tools.perf.db_stats.collect", fake_collect)
    monkeypatch.setitem(admin_api._STATS_CACHE, "value", None)
    monkeypatch.setitem(admin_api._STATS_CACHE, "at", 0.0)
    with _client(sqlite_engine, monkeypatch, user_id="member") as client:
        assert client.get("/api/admin/maintenance/db-stats").status_code == 403
    with _client(sqlite_engine, monkeypatch) as client:
        fast = client.get("/api/admin/maintenance", params={"stats": "false"})
        assert fast.status_code == 200
        body = fast.json()
        assert body["db_stats"] is None and body["db_stats_age_seconds"] is None
        assert "jobs" in body and "job_kinds" in body
        assert calls == []  # the overview without stats never collects them

        stats = client.get("/api/admin/maintenance/db-stats")
        assert stats.status_code == 200
        assert stats.json()["db_stats"]["database"]["size_bytes"] == 42
        assert len(calls) == 1
        client.get("/api/admin/maintenance/db-stats")
        assert len(calls) == 1  # cached for a minute
        client.get("/api/admin/maintenance/db-stats", params={"refresh": "true"})
        assert len(calls) == 2

        full = client.get("/api/admin/maintenance").json()  # the default still carries them
        assert full["db_stats"]["database"]["size_bytes"] == 42


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


def test_admin_overview_does_not_report_loops_stopped_in_an_http_only_process(sqlite_engine, monkeypatch):
    # QYM_WEB_WORKERS>1 runs the HTTP processes with QYM_ROLE=api and the loops
    # in one separate process: an HTTP process must not claim they "stopped".
    monkeypatch.setenv("QYM_ROLE", "api")
    with _client(sqlite_engine, monkeypatch, role="api") as client:
        workers = client.get("/api/admin/maintenance").json()["workers"]
    assert workers["loops"] == "separate"
    assert workers["summary_worker_alive"] is None
    assert workers["maintenance_worker_alive"] is None
    monkeypatch.setenv("QYM_ROLE", "all")
    with _client(sqlite_engine, monkeypatch) as client:
        workers = client.get("/api/admin/maintenance").json()["workers"]
    assert workers["loops"] == "local"
    assert workers["summary_worker_alive"] in (True, False)


# --------------------------------------------------------------------------------------
# Declared params (C001): admin input never reaches SQL text unchecked
# --------------------------------------------------------------------------------------


def _job_count(engine) -> int:
    with Session(engine) as db:
        return db.query(MaintenanceJob).count()


def test_every_job_kind_declares_its_params_with_defaults(sqlite_engine, monkeypatch):
    kinds = maintenance.registry()
    assert kinds["vacuum_analyze"]["params"]["tables"] == {
        "type": "tables",
        "default": ["run_events", "spans", "run_items"],
        "description": "Tables to vacuum and analyze, one per step.",
    }
    assert set(kinds["reclaim_run_events"]["params"]) == {"batch_runs", "vacuum_every"}
    assert set(kinds["prune_dashboard_events"]["params"]) == {"days", "batch"}
    assert kinds["create_deferred_indexes"]["params"]["indexes"]["choices"] == list(
        maintenance.DEFERRED_INDEXES
    )
    # A default that comes from a setting is read when the schema is listed.
    monkeypatch.setenv("QYM_SPAN_RETENTION_DAYS", "45")
    assert (
        maintenance.registry()["run_retention"]["params"]["span_retention_days"][
            "default"
        ]
        == 45
    )
    for kind, meta in kinds.items():
        for key, spec in meta["params"].items():
            assert spec["type"] in {
                "integer",
                "number",
                "tables",
                "indexes",
                "constraints",
            }, (kind, key)
            assert spec["description"], (kind, key)
            assert "default" in spec, (kind, key)
    with _client(sqlite_engine, monkeypatch) as client:
        body = client.get("/api/admin/maintenance", params={"stats": "false"}).json()
    assert (
        body["job_kinds"]["reclaim_run_events"]["params"]["batch_runs"]["default"] == 10
    )


@pytest.mark.parametrize(
    "kind, params, message",
    [
        # SQL in an identifier: before C001 this ran as a second statement.
        (
            "create_deferred_indexes",
            {"indexes": ["x; UPDATE users SET role='ADMIN'"]},
            "must be a name",
        ),
        # A free 'where' (or any spec that is not the one in code).
        (
            "create_deferred_indexes",
            {
                "indexes": [
                    {
                        "name": "ix_run_events_run_type_seq",
                        "table": "run_events",
                        "columns": ["run_id"],
                        "where": "1=1; DROP TABLE users",
                    }
                ]
            },
            "come from code",
        ),
        ("create_deferred_indexes", {"indexes": ["ix_not_in_code"]}, "must be one of"),
        ("drop_redundant_indexes", {"indexes": ["Ix_Upper"]}, "must be a name"),
        (
            "vacuum_analyze",
            {"tables": ["run_events; DROP TABLE users"]},
            "must be a name",
        ),
        ("vacuum_analyze", {"tables": ["no_such_table"]}, "does not exist"),
        ("vacuum_analyze", {"tables": "run_events"}, "must be a list"),
        (
            "validate_foreign_keys",
            {"constraints": [{"table": "runs", "constraint": "x y"}]},
            "must be a name",
        ),
        (
            "validate_foreign_keys",
            {"constraints": [{"table": "runs"}]},
            "must be an object",
        ),
        ("alter_column_types", {"tables": ["users"]}, "must be one of"),
        ("reclaim_run_events", {"batch": 5}, "does not take batch"),
        ("reclaim_run_events", {"vacuum_every": 0}, "at least 1"),
        ("reclaim_run_events", {"batch_runs": "10"}, "must be an integer"),
        ("reclaim_run_events", {"batch_runs": True}, "must be an integer"),
        ("db_stats", {"sample_pct": 500}, "at most 100"),
        (
            "backfill_dashboard_overview",
            {"window": 0, "extra": 1},
            "does not take extra",
        ),
    ],
)
def test_enqueue_refuses_bad_params_with_400_and_stores_nothing(
    sqlite_engine, monkeypatch, kind, params, message
):
    with _client(sqlite_engine, monkeypatch) as client:
        resp = client.post(
            "/api/admin/maintenance/jobs", json={"kind": kind, "params": params}
        )
    assert resp.status_code == 400, resp.text
    assert message in resp.json()["detail"]
    assert _job_count(sqlite_engine) == 0


def test_irreversible_job_refuses_an_undeclared_force_key(sqlite_engine, monkeypatch):
    with _client(sqlite_engine, monkeypatch) as client:
        resp = client.post(
            "/api/admin/maintenance/jobs",
            json={
                "kind": "drop_legacy_spans",
                "params": {"force": True},
                "confirm": "drop_legacy_spans",
            },
        )
    assert resp.status_code == 400
    assert "does not take force" in resp.json()["detail"]
    assert (
        "retention_days" in resp.json()["detail"]
    )  # the message names the keys it takes
    assert _job_count(sqlite_engine) == 0


def test_valid_params_are_queued_and_a_migration_spec_is_stored_by_name(
    sqlite_engine, monkeypatch
):
    spec = dict(maintenance.DEFERRED_INDEXES["ix_run_events_run_type_seq"])
    with _client(sqlite_engine, monkeypatch) as client:
        resp = client.post(
            "/api/admin/maintenance/jobs",
            json={"kind": "create_deferred_indexes", "params": {"indexes": [spec]}},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["params"] == {"indexes": ["ix_run_events_run_type_seq"]}
        resp = client.post(
            "/api/admin/maintenance/jobs",
            json={"kind": "vacuum_analyze", "params": {"tables": ["run_events"]}},
        )
        assert resp.status_code == 200, resp.text
    assert _job_count(sqlite_engine) == 2


def test_deferred_index_job_quotes_names_and_builds_the_index_from_code(sqlite_engine):
    factory = _factory(sqlite_engine)
    with sqlite_engine.begin() as conn:
        conn.execute(text("DROP INDEX IF EXISTS ix_dashboard_record_item_latency"))
    with factory() as db:
        maintenance.enqueue(
            db,
            "create_deferred_indexes",
            {"indexes": ["ix_dashboard_record_item_latency"]},
        )
        db.commit()
    assert maintenance.MaintenanceWorker(factory, sqlite_engine).tick() == "succeeded"
    with sqlite_engine.connect() as conn:
        sql = conn.execute(
            text(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'ix_dashboard_record_item_latency'"
            )
        ).scalar()
    assert sql is not None
    assert (
        '"dashboard_record_state"' in sql
        and "WHERE present AND record_kind = 'item'" in sql
    )


def test_worker_fails_a_stored_row_with_bad_params_before_its_handler_runs(
    sqlite_engine,
):
    calls = []

    @maintenance.register(
        "test_params_guard",
        params={"tables": maintenance.Param("tables", [], "Tables.")},
    )
    def _guard(ctx):
        calls.append(ctx.params)
        return True

    try:
        factory = _factory(sqlite_engine)
        with factory() as db:
            # Written past enqueue (a hand-made row, or one queued before C001).
            db.add(
                MaintenanceJob(
                    kind="test_params_guard",
                    params={"tables": ["x; DROP TABLE users"]},
                    progress={},
                    log="",
                )
            )
            db.commit()
        assert maintenance.MaintenanceWorker(factory, sqlite_engine).tick() == "failed"
        with factory() as db:
            row = (
                db.query(MaintenanceJob)
                .filter(MaintenanceJob.kind == "test_params_guard")
                .one()
            )
            assert "InvalidJobParams" in row.error and "must be a name" in row.error
            assert db.get(User, "admin") is not None
        assert calls == []
    finally:
        maintenance._REGISTRY.pop("test_params_guard", None)


def test_deferred_index_catalog_matches_the_migrations_that_queue_it():
    import importlib.util
    from pathlib import Path

    import qym_platform

    versions = Path(qym_platform.__file__).parent / "migrations" / "versions"
    specs = []
    for filename, attr in (
        ("0051_maintenance_jobs_and_event_indexes.py", "DEFERRED_INDEXES"),
        ("0055_dashboard_extrema_indexes.py", "INDEXES"),
        ("0098_dashboard_event_published_index.py", "INDEXES"),
        ("0101_covering_score_span_indexes.py", "INDEXES"),
    ):
        loader = importlib.util.spec_from_file_location(
            f"_migration_{filename[:4]}", versions / filename
        )
        module = importlib.util.module_from_spec(loader)
        loader.loader.exec_module(module)
        specs.extend(getattr(module, attr))
    assert {spec["name"]: spec for spec in specs} == maintenance.DEFERRED_INDEXES
    for spec in specs:
        # The job a migration queues passes the same check as an admin request.
        assert maintenance.validate_params(
            "create_deferred_indexes", {"indexes": [spec]}
        ) == {"indexes": [spec["name"]]}


def test_outbox_stats_read_size_rows_and_oldest_age_without_a_count():
    """C074: Maintenance shows the outbox size, rows and oldest row age; rows come from the table statistics."""
    from qym_platform.tools.perf.db_stats import outbox_stats

    class Conn:
        def __init__(self):
            self.sql = []

        def execute(self, statement):
            self.sql.append(str(statement))

            class Result:
                @staticmethod
                def scalar():
                    return 2678400.4

            return Result()

    conn = Conn()
    tables = [
        {"table": "runs", "total_bytes": 1, "live_rows": 1},
        {"table": "dashboard_change_events", "total_bytes": 2_000_000_000, "live_rows": 15174},
    ]
    assert outbox_stats(conn, tables) == {
        "total_bytes": 2_000_000_000,
        "rows": 15174,
        "oldest_age_seconds": 2678400,
    }
    assert len(conn.sql) == 1 and "count(" not in conn.sql[0].lower()
