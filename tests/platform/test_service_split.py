"""Service split: main / ingestion / workers apps, prefixes, ingress rules and the job queue."""

from __future__ import annotations

import asyncio
import os
import re
import sys
import threading
import time
import types
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform import main, serve
from qym_platform.api.ingest import router as ingest_router
from qym_platform.app import create_app, create_ingestion_app, create_workers_app
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.background_job_models import BackgroundJob, ServiceHeartbeat
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.service_layout import resolve_layout
from qym_platform.services import job_registry as registry_module
from qym_platform.services.analysis_jobs import AnalysisJobManager, RemoteAnalysisJob
from qym_platform.services.job_executor import JobExecutor
from qym_platform.services.job_registry import EXPIRED_ERROR, job_registry
from qym_platform.services.product_evals import (
    ProductEvalConfigError,
    ProductEvalJobManager,
    ProductEvalRuntimeInputs,
    RemoteProductEvalJob,
)
from qym_platform.services.workers_runtime import (
    ServiceHeartbeatWriter,
    read_service_heartbeats,
)
from qym_platform.settings import PlatformSettings

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "split-token"


def _settings(**values) -> PlatformSettings:
    values.setdefault("database_url", "sqlite:///:memory:")
    values.setdefault("environment", "test")
    values.setdefault("auth_mode", "proxy_headers")
    return PlatformSettings(**values)


def _until(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


# -- layout ----------------------------------------------------------------------


def test_service_wins_over_legacy_role_and_role_maps_as_an_alias() -> None:
    assert resolve_layout(_settings()).service == "all"
    legacy_api = resolve_layout(_settings(role="api"))
    assert legacy_api.service == "main" and legacy_api.legacy
    # A legacy API process keeps the single-server surface and its in-process jobs.
    assert (
        legacy_api.single_server_surface
        and not legacy_api.queues_jobs
        and not legacy_api.runs_loops
    )
    assert resolve_layout(_settings(role="worker")).service == "workers"
    explicit = resolve_layout(_settings(role="worker", service="main"))
    assert (
        explicit.service == "main"
        and explicit.queues_jobs
        and not explicit.single_server_surface
    )
    assert resolve_layout(_settings(service="workers")).runs_loops
    assert (
        resolve_layout(
            _settings(service="ingestion", ingestion_prefix="ingest/")
        ).ingestion_prefix
        == "/ingest"
    )
    with pytest.raises(ValueError):
        _settings(service="api")


def test_launcher_plans_per_service() -> None:
    main_plan = serve.plan({"QYM_SERVICE": "main", "QYM_WEB_WORKERS": "3"})
    assert (
        main_plan["loops_argv"] is None
        and main_plan["web_env"]["QYM_SERVICE"] == "main"
    )
    assert (
        serve.plan({"QYM_SERVICE": "ingestion", "QYM_WEB_WORKERS": "2"})["loops_argv"]
        is None
    )
    workers_plan = serve.plan({"QYM_SERVICE": "workers", "QYM_WEB_WORKERS": "4"})
    assert workers_plan["workers"] == 1 and workers_plan["loops_argv"] is None
    # Explicit single server with several web workers: one loop process, as with QYM_ROLE=all.
    single = serve.plan({"QYM_SERVICE": "all", "QYM_WEB_WORKERS": "2"})
    assert (
        "QYM_SERVICE" not in single["web_env"]
        and single["web_env"]["QYM_ROLE"] == "api"
    )
    assert (
        single["loops_env"]["QYM_ROLE"] == "worker"
        and "QYM_SERVICE" not in single["loops_env"]
    )
    with pytest.raises(SystemExit):
        serve.plan({"QYM_SERVICE": "api"})


def test_entrypoint_starts_the_workers_service_with_uvicorn() -> None:
    entrypoint = (ROOT / "docker" / "entrypoint.sh").read_text(encoding="utf-8")
    assert 'if [ "${QYM_SERVICE:-}" = "workers" ]; then' in entrypoint
    assert (
        'if [ -z "${QYM_SERVICE:-}" ] && [ "${QYM_ROLE:-all}" = "worker" ]; then'
        in entrypoint
    )
    compose = (ROOT / "docker" / "docker-compose.split.yml").read_text(encoding="utf-8")
    for service in ("migrate", "main", "ingestion", "workers", "ingress"):
        assert f"\n  {service}:" in compose
    assert "QYM_SKIP_MIGRATIONS" in compose


# -- HTTP surface ----------------------------------------------------------------


@pytest.fixture()
def db_factory(tmp_path, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_BASE_URL", "http://main.test")
    monkeypatch.setenv("QYM_PUBLIC_UI_URL", "https://ui.example.test")
    engine = create_engine(
        f"sqlite:///{tmp_path / 'split.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        user = User(id="user-1", email="owner@example.com", role=UserRole.MEMBER)
        project = Project(
            id="project-1",
            name="Project 1",
            slug="project-1",
            created_by_user_id="user-1",
        )
        db.add_all([user, project])
        db.flush()
        db.add(
            ProjectMembership(
                project_id="project-1", user_id="user-1", role=ProjectRole.MANAGER
            )
        )
        db.add(
            ApiKey(
                id="key-1",
                user_id="user-1",
                project_id="project-1",
                name="t",
                prefix=api_key_prefix(TOKEN),
                key_hash=hash_api_key(TOKEN),
                scopes=["runs:write", "runs:read"],
            )
        )
        db.commit()
    yield factory
    engine.dispose()


def _client(app, factory) -> TestClient:
    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _create_run(client: TestClient, path: str) -> dict:
    response = client.post(
        path,
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={
            "task": "task",
            "dataset": "dataset",
            "metrics": ["m"],
            "run_metadata": {},
            "run_config": {},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _event_body(run_id: str) -> str:
    return (
        '{"schema_version":1,"event_id":"%s","sequence":1,"sent_at":"2026-03-23T00:00:00Z",'
        '"type":"item_started","run_id":"%s","payload":{"item_id":"i1","index":0,"input":{"q":1},'
        '"expected":null,"item_metadata":{}}}\n' % (uuid4(), run_id)
    )


def test_all_mode_keeps_legacy_paths_and_adds_the_service_prefixes(db_factory) -> None:
    app = create_app(_settings(database_url="sqlite://"))
    with _client(app, db_factory) as client:
        legacy = _create_run(client, "/v1/runs")
        aliased = _create_run(client, "/ingestion/v1/runs")
        # Links point at the public UI, whichever path accepted the run.
        assert legacy["live_url"].startswith("https://ui.example.test/")
        assert aliased["live_url"].startswith("https://ui.example.test/")
        events = client.post(
            f"/ingestion/v1/runs/{aliased['run_id']}/events",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/x-ndjson",
            },
            content=_event_body(aliased["run_id"]),
        )
        assert events.status_code == 200, events.text
        for path in ("/healthz", "/ingestion/healthz", "/workers/healthz"):
            assert client.get(path).status_code == 200
        status = client.get("/workers/status").json()
        assert (
            status["service"] == "all"
            and status["job_executor"]["mode"] == "in-process"
        )
        assert client.get("/login").status_code in (200, 302, 307)
    with db_factory() as db:
        assert db.query(Run).count() == 2


def test_main_service_can_drop_the_ingest_routes(db_factory) -> None:
    app = create_app(_settings(service="main", main_include_ingest=False))
    with _client(app, db_factory) as client:
        assert client.post(
            "/v1/runs", headers={"Authorization": f"Bearer {TOKEN}"}, json={}
        ).status_code in (404, 405)
        assert client.get("/workers/status").status_code == 404
        assert client.get("/healthz").status_code == 200
    app = create_app(_settings(service="main"))
    with _client(app, db_factory) as client:
        _create_run(client, "/v1/runs")  # kept by default: old SDK setups keep working


def test_ingestion_app_serves_only_the_write_path(db_factory) -> None:
    app = create_ingestion_app(_settings(service="ingestion"))
    with _client(app, db_factory) as client:
        created = _create_run(client, "/ingestion/v1/runs")
        _create_run(client, "/v1/runs")  # legacy path (ingress routes it here)
        events = client.post(
            f"/v1/runs/{created['run_id']}/events",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/x-ndjson",
            },
            content=_event_body(created["run_id"]),
        )
        assert events.status_code == 200, events.text
        assert client.get("/healthz").json()["role"] == "ingestion"
        assert client.get("/ingestion/healthz").status_code == 200
        for path in (
            "/",
            "/login",
            "/static/dashboard.js",
            "/api/runs",
            "/v1/datasets",
            "/api-docs",
            "/workers/status",
        ):
            assert client.get(path).status_code == 404, path
        assert (
            client.post(f"/v1/runs/{created['run_id']}/submit", json={}).status_code
            == 404
        )
        # No session auth here: a browser cookie gets nothing.
        assert client.post("/v1/runs", json={}).status_code in (401, 403)
    app = create_ingestion_app(
        _settings(service="ingestion", ingestion_legacy_paths=False)
    )
    with _client(app, db_factory) as client:
        assert (
            client.post(
                "/v1/runs", headers={"Authorization": f"Bearer {TOKEN}"}, json={}
            ).status_code
            == 404
        )
        _create_run(client, "/ingestion/v1/runs")


def test_ingestion_app_honours_maintenance_mode(db_factory, monkeypatch) -> None:
    from qym_platform.services import event_storage

    monkeypatch.setattr(
        event_storage, "ingest_settings", lambda: _settings(maintenance_mode=True)
    )
    monkeypatch.setattr(
        "qym_platform.api.ingest.ingest_settings",
        lambda: _settings(maintenance_mode=True),
    )
    with _client(
        create_ingestion_app(_settings(service="ingestion")), db_factory
    ) as client:
        response = client.post(
            "/ingestion/v1/runs",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={
                "task": "t",
                "dataset": "d",
                "metrics": [],
                "run_metadata": {},
                "run_config": {},
            },
        )
        assert response.status_code == 503 and response.headers["Retry-After"] == "60"


# The ingress rules of docker/nginx.split.conf and OPERATIONS.md.
INGRESS_TO_INGESTION = [
    re.compile(r"^/v1/runs$"),
    re.compile(r"^/v1/runs:upload$"),
    re.compile(r"^/v1/runs/[^/]+/events$"),
    re.compile(r"^/ingestion/"),
]


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)


def _api_routes(app):
    """Every HTTP route as ``(path, methods, endpoint)``.

    Newer FastAPI keeps included routers as lazy ``_IncludedRouter`` entries;
    their ``effective_route_contexts()`` are the routes with final paths.
    """
    out = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            out.append(
                types.SimpleNamespace(
                    path=route.path, methods=set(route.methods), endpoint=route.endpoint
                )
            )
        elif hasattr(route, "effective_route_contexts"):
            for ctx in route.effective_route_contexts():
                out.append(
                    types.SimpleNamespace(
                        path=ctx.path,
                        methods=set(ctx.methods or ()),
                        endpoint=ctx.endpoint,
                    )
                )
    assert out, "no routes found"
    return out


def test_ingress_rules_send_exactly_the_ingest_routes_to_ingestion() -> None:
    ingest_endpoints = {route.endpoint for route in ingest_router.routes}
    main_app = create_app(_settings(service="main", main_include_ingest=False))
    matched = [
        (route.path, sorted(route.methods))
        for route in _api_routes(main_app)
        if any(rule.match(_concrete(route.path)) for rule in INGRESS_TO_INGESTION)
    ]
    # None of main's own routes (/v1/runs/{id}/submit, approve, owner, ...) is taken away.
    assert matched == []
    ingestion = create_ingestion_app(_settings(service="ingestion"))
    served = {
        (route.path, frozenset(route.methods))
        for route in _api_routes(ingestion)
        if route.endpoint in ingest_endpoints
    }
    for route in ingest_router.routes:
        for path in (route.path, "/ingestion" + route.path):
            assert (path, frozenset(route.methods)) in served
            assert any(
                rule.match(_concrete(path)) for rule in INGRESS_TO_INGESTION
            ), path
    # The single server answers every one of those paths as well.
    all_paths = {route.path for route in _api_routes(create_app(_settings()))}
    assert {route.path for route in ingest_router.routes} <= all_paths
    nginx = (ROOT / "docker" / "nginx.split.conf").read_text(encoding="utf-8")
    for rule in (
        "location = /v1/runs ",
        "location = /v1/runs:upload ",
        r"location ~ ^/v1/runs/[^/]+/events$ ",
        "location /ingestion/ ",
        "location /workers/ ",
        "location / ",
    ):
        assert rule in nginx, rule


def test_build_app_mounts_each_service_under_its_prefixes(monkeypatch) -> None:
    def build(**values):
        settings = _settings(**values)
        monkeypatch.setattr(main, "PlatformSettings", lambda: settings)
        return main.build_app()

    runtime = MagicMock()
    runtime.status.return_value = {
        "loops": {"maintenance": True},
        "job_executor": {"alive": True},
    }
    monkeypatch.setattr(
        main,
        "create_workers_app",
        lambda settings: create_workers_app(settings, runtime_factory=lambda: runtime),
    )
    with TestClient(build(service="workers", root_path="/qym")) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/qym/workers/healthz").status_code == 200
        body = client.get("/qym/workers/status").json()
        assert body["ok"] is True and body["loops"] == {"maintenance": True}
        assert client.get("/qym/api/runs").status_code == 404
        runtime.start.assert_called_once_with()
    runtime.stop.assert_called_once_with()
    with TestClient(build(service="ingestion", ingestion_prefix="/ingest")) as client:
        assert client.get("/ingest/healthz").status_code == 200
        assert client.get("/ingestion/healthz").status_code == 404
    with TestClient(build(service="main", main_prefix="/app")) as client:
        assert client.get("/app/healthz").status_code == 200
        assert client.get("/healthz").status_code == 200  # probe path


def test_workers_status_reports_unhealthy_loops() -> None:
    runtime = MagicMock()
    runtime.status.return_value = {
        "loops": {"maintenance": False},
        "job_executor": {"alive": True},
    }
    app = create_workers_app(
        _settings(service="workers"), runtime_factory=lambda: runtime
    )
    with TestClient(app) as client:
        assert client.get("/workers/status").status_code == 503


# -- job queue -------------------------------------------------------------------


@pytest.fixture(params=["sqlite", "postgres"])
def shared_db(request, tmp_path, monkeypatch):
    monkeypatch.setattr(registry_module, "FLUSH_SECONDS", 0.05)
    monkeypatch.setattr(registry_module, "HEARTBEAT_SECONDS", 0.2)
    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_split_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine(
            f"sqlite:///{tmp_path / 'jobs.db'}",
            connect_args={"check_same_thread": False},
        )
    BackgroundJob.__table__.create(engine)
    ServiceHeartbeat.__table__.create(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


@pytest.fixture
def managers():
    main_side, worker_side = AnalysisJobManager(max_workers=1), AnalysisJobManager(
        max_workers=1
    )
    try:
        yield main_side, worker_side
    finally:
        for manager in (main_side, worker_side):
            manager.clear()
            manager.shutdown(wait=True)


def _executor(engine, manager, runner, *, product=None):
    kinds = [
        (
            manager.kind,
            manager,
            lambda row, bind: manager.adopt(row, runner, bind),
            "failed",
        )
    ]
    if product is not None:
        kinds.append(
            (
                "product_eval",
                product,
                lambda row, bind: product.adopt(row, bind),
                "FAILED",
            )
        )
    return JobExecutor(engine, poll_interval=0.05, kinds=kinds)


@pytest.mark.asyncio
async def test_main_queues_an_analysis_and_a_worker_runs_it(
    shared_db, managers
) -> None:
    main_side, worker_side = managers
    release = threading.Event()
    seen_payloads = []

    async def runner(job):
        seen_payloads.append((job.run_id, job.user_id, job.request_payload))
        worker_side.update_progress(job, completed=1, total=2)
        while not release.is_set():
            await asyncio.sleep(0.02)
        return {"total_analyzed": 2}

    job, created = await main_side.submit(
        run_id="run-q",
        user_id="u1",
        auth_type="session",
        request_payload={"pass_number": 2, "metric": "m"},
        progress={"phase": "queued", "total": 2},
        runner=None,
        store_bind=shared_db,
        enqueue=True,
    )
    assert (
        created is True
        and isinstance(job, RemoteAnalysisJob)
        and job.status == "queued"
    )
    # A second start while it waits returns the same queued job (no duplicate).
    again, created_again = await main_side.submit(
        run_id="run-q",
        user_id="u2",
        auth_type="session",
        request_payload={"pass_number": 2},
        progress={},
        runner=None,
        store_bind=shared_db,
        enqueue=True,
    )
    assert created_again is False and again.job_id == job.job_id
    with Session(shared_db) as db:
        assert main_side.active_for_run("run-q", 2, db=db).job_id == job.job_id
        assert main_side.get(job.job_id, db=db).status == "queued"

    executor = _executor(shared_db, worker_side, runner)
    loop = asyncio.get_running_loop()
    assert await loop.run_in_executor(None, executor.poll_once) == 1
    assert (
        await loop.run_in_executor(None, executor.poll_once) == 0
    )  # slot busy, nothing queued
    with Session(shared_db) as db:
        assert await loop.run_in_executor(
            None,
            lambda: _until(
                lambda: (
                    main_side.get(job.job_id, db=db).snapshot()["progress"] or {}
                ).get("completed")
                == 1
            ),
        )
        running = main_side.get(job.job_id, db=db)
        assert running.status == "running"
        row = db.get(BackgroundJob, job.job_id)
        assert row.queued is False and row.claimed_by and row.payload is None
        # SQL NULL, not a JSON null: nothing of the payload stays behind.
        assert (
            db.execute(
                text(
                    "SELECT count(*) FROM background_jobs WHERE id = :i AND payload IS NULL"
                ),
                {"i": job.job_id},
            ).scalar()
            == 1
        )
    assert seen_payloads == [("run-q", "u1", {"pass_number": 2, "metric": "m"})]
    release.set()
    with Session(shared_db) as db:
        assert await loop.run_in_executor(
            None,
            lambda: _until(
                lambda: main_side.get(job.job_id, db=db).status == "completed"
            ),
        )
        assert main_side.snapshot(main_side.get(job.job_id, db=db))["result"] == {
            "total_analyzed": 2
        }


@pytest.mark.asyncio
async def test_cancel_of_queued_and_running_jobs(shared_db, managers) -> None:
    main_side, worker_side = managers

    async def runner(job):
        await asyncio.Event().wait()
        return {}

    queued, _ = await main_side.submit(
        run_id="run-c",
        user_id="u",
        auth_type="none",
        request_payload={},
        progress={},
        runner=None,
        store_bind=shared_db,
        enqueue=True,
    )
    with Session(shared_db) as db:
        cancelled = main_side.cancel(queued.job_id, db=db)
        assert cancelled.status == "cancelled"
        assert db.get(BackgroundJob, queued.job_id).payload is None
    executor = _executor(shared_db, worker_side, runner)
    assert executor.poll_once() == 0  # a cancelled queued job is never claimed

    running, _ = await main_side.submit(
        run_id="run-c2",
        user_id="u",
        auth_type="none",
        request_payload={},
        progress={},
        runner=None,
        store_bind=shared_db,
        enqueue=True,
    )
    loop = asyncio.get_running_loop()
    assert await loop.run_in_executor(None, executor.poll_once) == 1
    local = worker_side._jobs[running.job_id]
    assert await loop.run_in_executor(
        None, lambda: _until(lambda: local.status == "running")
    )
    with Session(shared_db) as db:
        assert main_side.cancel(running.job_id, db=db).status == "cancelled"
    # The worker sees the flag at its next flush and stops the job.
    assert await loop.run_in_executor(
        None, lambda: _until(lambda: local.status == "cancelled")
    )
    await asyncio.wait_for(asyncio.wrap_future(local.future), timeout=5)


@pytest.mark.asyncio
async def test_queued_rows_are_not_lost_but_expire(
    shared_db, managers, monkeypatch
) -> None:
    main_side, _ = managers
    job, _ = await main_side.submit(
        run_id="run-l",
        user_id="u",
        auth_type="none",
        request_payload={},
        progress={},
        runner=None,
        store_bind=shared_db,
        enqueue=True,
    )
    # Far older than a running job's stale limit: still waiting, not lost.
    with shared_db.begin() as conn:
        conn.execute(
            update(BackgroundJob.__table__).values(
                heartbeat_at=utc_now_naive()
                - timedelta(seconds=registry_module.STALE_AFTER_SECONDS * 20)
            )
        )
    with Session(shared_db) as db:
        assert main_side.get(job.job_id, db=db).status == "queued"
        assert main_side.active_for_run("run-l", db=db) is not None
    monkeypatch.setattr(registry_module, "_queue_timeout", 60.0)
    with Session(shared_db) as db:
        expired = main_side.get(job.job_id, db=db)
        assert expired.status == "failed"
        assert main_side.snapshot(expired)["error"] == EXPIRED_ERROR
        assert main_side.active_for_run("run-l", db=db) is None
    assert job_registry.claim(shared_db, main_side.kind, limit=5) == []


def test_concurrent_claimers_never_take_the_same_job(shared_db) -> None:
    from qym_platform.services.job_registry import JobDescription

    for n in range(20):
        job_registry.enqueue(
            shared_db,
            kind="analysis",
            job_id=f"analysis_{n:02d}",
            description=JobDescription(
                scope_id=f"run-{n}", status="queued", active=True, snapshot={}
            ),
            payload={"n": n},
        )
    claimed: list = []
    lock = threading.Lock()

    def claim_all():
        while True:
            try:
                rows = job_registry.claim(shared_db, "analysis", limit=1)
            except Exception:  # sqlite: database is locked under contention; retry
                time.sleep(0.01)
                continue
            if not rows:
                return
            with lock:
                claimed.extend(row["id"] for row in rows)

    threads = [threading.Thread(target=claim_all) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert sorted(claimed) == [f"analysis_{n:02d}" for n in range(20)]


# -- product evals ---------------------------------------------------------------


@pytest.fixture
def fake_evaluator(monkeypatch):
    import qym

    captured: dict = {}

    class FakeEvaluator:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def run(self, show_tui=True, auto_save=True, **kwargs):
            progress = captured.get("progress_callback")
            progress(
                types.SimpleNamespace(
                    event="run_start",
                    run_id="sdk-1",
                    run_info={"platform_run_id": "qym-run-7"},
                )
            )
            progress(types.SimpleNamespace(event="run_complete", run_id="sdk-1"))
            return None

    monkeypatch.setattr(qym, "Evaluator", FakeEvaluator)
    return captured


def test_product_eval_queue_encrypts_secrets_and_runs_in_the_worker(
    shared_db, monkeypatch, fake_evaluator
) -> None:
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", key)
    monkeypatch.setenv("QYM_INTERNAL_PLATFORM_URL", "http://ingress.internal:8080")
    main_side = ProductEvalJobManager(max_workers=2)
    worker_side = ProductEvalJobManager(max_workers=1)
    with Session(shared_db) as db:
        job = main_side.submit(
            preset_name="test",
            api_key="qym-secret-api-key",
            run_name="r",
            task_name=None,
            dataset_name=None,
            runtime_inputs=ProductEvalRuntimeInputs(refresh_token="refresh-secret"),
            model=None,
            metadata={"source": "split"},
            owner_user_id="u",
            project_id="p",
            run_count=1,
            store_bind=shared_db,
            enqueue=True,
            db=db,
        )
        assert isinstance(job, RemoteProductEvalJob)
        assert job.to_dict()["status"] == "QUEUED"
        assert job.wait_for_run(0.1) is False  # nobody claimed it yet
    with shared_db.connect() as conn:
        raw = str(conn.execute(text("SELECT payload FROM background_jobs")).scalar())
    assert "qym-secret-api-key" not in raw and "refresh-secret" not in raw
    assert "api_key_encrypted" in raw

    executor = _executor(
        shared_db, AnalysisJobManager(max_workers=1), None, product=worker_side
    )
    executor._kinds = executor._kinds[1:]  # product evals only
    assert executor.poll_once() == 1
    local = worker_side._jobs[job.job_id]
    local._future.result(timeout=10)
    assert local.status == "COMPLETED"
    config = fake_evaluator["config"]
    assert config["platform_api_key"] == "qym-secret-api-key"
    assert config["platform_url"] == "http://ingress.internal:8080"
    assert config["run_metadata"]["product_eval"]["eval_id"] == job.job_id
    with Session(shared_db) as db:
        assert _until(
            lambda: main_side.get(job.job_id, db=db).to_dict()["status"] == "COMPLETED"
        )
        seen = main_side.get(job.job_id, db=db)
        assert seen.to_dict()["run_id"] == "qym-run-7"
        assert (
            db.execute(
                text(
                    "SELECT count(*) FROM background_jobs WHERE id = :i AND payload IS NULL"
                ),
                {"i": job.job_id},
            ).scalar()
            == 1
        )  # wiped (SQL NULL)


def test_product_eval_queue_refuses_without_an_encryption_key(
    shared_db, monkeypatch
) -> None:
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", "")
    with Session(shared_db) as db, pytest.raises(
        ProductEvalConfigError, match="QYM_LLM_CONFIG_ENCRYPTION_KEY"
    ):
        ProductEvalJobManager(max_workers=1).submit(
            preset_name="test",
            api_key="k",
            run_name=None,
            task_name=None,
            dataset_name=None,
            runtime_inputs=None,
            model=None,
            metadata={},
            run_count=1,
            store_bind=shared_db,
            enqueue=True,
            db=db,
        )
    with shared_db.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM background_jobs")).scalar() == 0


def test_product_eval_queue_is_capped_in_the_database(shared_db, monkeypatch) -> None:
    from qym_platform.services.product_evals import ProductEvalQueueFull

    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode())
    manager = ProductEvalJobManager(max_workers=1)
    kwargs = dict(
        preset_name="test",
        api_key="k",
        run_name=None,
        task_name=None,
        dataset_name=None,
        runtime_inputs=None,
        model=None,
        metadata={},
        run_count=1,
        store_bind=shared_db,
        enqueue=True,
    )
    with Session(shared_db) as db:
        manager.submit(db=db, **kwargs)
        with pytest.raises(ProductEvalQueueFull):
            ProductEvalJobManager(max_workers=1).submit(db=db, **kwargs)


def test_product_eval_http_submit_in_main_mode(
    tmp_path, monkeypatch, fake_evaluator
) -> None:
    """POST /v1/product-evals on a main service queues; a worker runs it; polls and stop read the DB."""
    from qym_platform.api import product_evals as product_evals_api

    monkeypatch.setenv("QYM_SERVICE", "main")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("QYM_PUBLIC_UI_URL", "https://ui.example.test")
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pe.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="u", email="u@example.com", role=UserRole.MEMBER),
                Project(id="p", name="P", slug="p", created_by_user_id="u"),
            ]
        )
        db.flush()
        db.add(ProjectMembership(project_id="p", user_id="u", role=ProjectRole.MANAGER))
        db.add(
            ApiKey(
                id="k",
                user_id="u",
                project_id="p",
                name="t",
                prefix=api_key_prefix(TOKEN),
                key_hash=hash_api_key(TOKEN),
                scopes=["runs:write", "runs:read"],
            )
        )
        db.commit()
    worker_side = ProductEvalJobManager(max_workers=1)
    monkeypatch.setattr(
        product_evals_api, "job_manager", ProductEvalJobManager(max_workers=1)
    )
    executor = JobExecutor(
        engine,
        poll_interval=0.05,
        kinds=[
            (
                "product_eval",
                worker_side,
                lambda row, bind: worker_side.adopt(row, bind),
                "FAILED",
            )
        ],
    )
    executor.start()
    try:
        app = create_app()
        with _client(app, factory) as client:
            response = client.post(
                "/v1/product-evals",
                headers={"Authorization": f"Bearer {TOKEN}"},
                json={"preset": "test", "run_count": 1},
            )
            assert response.status_code == 202, response.text
            data = response.json()["data"]
            eval_id = data["eval_id"]
            assert (
                eval_id in worker_side._jobs
            )  # executed by the worker, not the HTTP process
            assert not product_evals_api.job_manager._jobs
            assert _until(
                lambda: client.get(
                    f"/v1/product-evals/jobs/{eval_id}",
                    headers={"Authorization": f"Bearer {TOKEN}"},
                ).json()["data"]["status"]
                == "COMPLETED"
            )
            body = client.get(
                f"/v1/product-evals/jobs/{eval_id}",
                headers={"Authorization": f"Bearer {TOKEN}"},
            ).json()["data"]
            urls = [run["qym_run_url"] for run in body["runs"] if run["qym_run_url"]]
            assert urls == ["https://ui.example.test/run/qym-run-7"]
    finally:
        executor.stop()


# -- heartbeat / admin -----------------------------------------------------------


def test_heartbeat_is_written_read_and_removed(shared_db) -> None:
    writer = ServiceHeartbeatWriter(
        shared_db,
        service="workers",
        interval=1.0,
        info=lambda: {"loops": {"maintenance": True}},
    )
    writer.beat()
    rows = read_service_heartbeats(shared_db)
    assert (
        len(rows) == 1
        and rows[0]["alive"]
        and rows[0]["info"]["loops"] == {"maintenance": True}
    )
    with shared_db.begin() as conn:
        conn.execute(
            update(ServiceHeartbeat.__table__).values(
                heartbeat_at=utc_now_naive() - timedelta(seconds=30)
            )
        )
    assert read_service_heartbeats(shared_db)[0]["alive"] is False
    writer.beat()
    assert read_service_heartbeats(shared_db)[0]["alive"] is True
    writer.stop()  # a clean stop reads as stopped at once
    rows = read_service_heartbeats(shared_db)
    assert (
        len(rows) == 1
        and rows[0]["alive"] is False
        and rows[0]["info"]["stopped"] is True
    )


def test_admin_reports_the_workers_service_heartbeat(monkeypatch, tmp_path) -> None:
    from qym_platform.api import admin

    engine = create_engine(f"sqlite:///{tmp_path / 'hb.db'}")
    ServiceHeartbeat.__table__.create(engine)
    ServiceHeartbeatWriter(
        engine,
        service="workers",
        interval=5.0,
        info=lambda: {
            "loops": {"dashboard_summary": True, "maintenance": True},
            "maintenance_current_job": "job-1",
        },
    ).beat()
    request = types.SimpleNamespace(
        app=types.SimpleNamespace(state=types.SimpleNamespace(runs_loops=False))
    )
    with Session(engine) as db:
        state = admin._worker_state(request, _settings(service="main"), db)
    assert state["loops"] == "separate"
    assert (
        state["summary_worker_alive"] is True
        and state["maintenance_worker_alive"] is True
    )
    assert state["maintenance_current_job"] == "job-1"
    assert state["workers_service"]["alive"] is True


def test_admin_reports_a_missing_workers_service_as_down_only_in_split_mode(
    tmp_path,
) -> None:
    from qym_platform.api import admin

    engine = create_engine(f"sqlite:///{tmp_path / 'hb.db'}")
    ServiceHeartbeat.__table__.create(engine)

    def state_for(settings):
        layout = resolve_layout(settings)
        request = types.SimpleNamespace(
            app=types.SimpleNamespace(
                state=types.SimpleNamespace(
                    runs_loops=layout.runs_loops, service_layout=layout
                )
            )
        )
        with Session(engine) as db:
            return admin._worker_state(request, settings, db)

    assert state_for(_settings(service="main"))["summary_worker_alive"] is False
    # Legacy QYM_ROLE=api with an old worker image that never heartbeats: unknown.
    assert state_for(_settings(role="api"))["summary_worker_alive"] is None
