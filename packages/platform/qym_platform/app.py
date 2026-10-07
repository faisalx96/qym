from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from qym_platform.auth_oidc import SESSION_MAX_AGE_SECONDS, origin_matches_base, session_auth_enabled
from qym_platform.middleware.cache_control import NoStoreMiddleware
from qym_platform.api.auth import router as auth_router
from qym_platform.settings import PlatformSettings
from qym_platform.validation_errors import validation_exception_handler
from qym_platform.api.web import router as web_router
from qym_platform.api.projects import router as projects_router
from qym_platform.api.eval_environments import router as eval_environments_router
from qym_platform.api.eval_queue import router as eval_queue_router
from qym_platform.api.eval_presets import router as eval_presets_router
from qym_platform.api.eval_best_runs import router as eval_best_runs_router
from qym_platform.api.experiments import router as experiments_router
from qym_platform.api.runs import router as runs_router
from qym_platform.api.step_latency import router as step_latency_router
from qym_platform.api.ingest import router as ingest_router
from qym_platform.api.analysis import router as analysis_router
from qym_platform.api.root_cause_dashboard import router as root_cause_dashboard_router
from qym_platform.api.product_evals import router as product_evals_router
from qym_platform.api.datasets import router as datasets_router
from qym_platform.api.insights import router as insights_router
from qym_platform.api.dashboard import router as dashboard_router
from qym_platform.api.dashboard_stats import router as dashboard_stats_router
from qym_platform.api.admin import router as admin_router
from qym_platform.services.analysis_jobs import (
    analysis_job_manager,
    rule_inference_job_manager,
)
from qym_platform.services.dashboard_summaries import DashboardSummaryWorker
from qym_platform.static_files import GZipExceptStatic, PrecompressedStaticFiles

# Starlette defaults to level 9: on multi-MB run/compare JSON that is about 3x
# the CPU of level 6 for 2-4 % smaller bodies.
GZIP_COMPRESSLEVEL = 6

_DEV_ENVIRONMENTS = {"dev", "development", "local", "test", "testing"}


def process_layout_warning(settings: PlatformSettings) -> str | None:
    """Warn when a non-dev deployment runs HTTP and every loop in one process.

    ``QYM_ROLE=all`` (the default) puts request handling, the dashboard,
    maintenance and eval-dispatch loops in this process, so one memory spike
    (a large retention purge, a backfill) takes HTTP down with it.
    """
    from qym_platform.service_layout import resolve_layout

    if resolve_layout(settings).service != "all":
        return None
    if str(settings.environment or "").strip().lower() in _DEV_ENVIRONMENTS:
        return None
    return (
        "QYM_ROLE=all runs HTTP and all background loops in this process. For "
        "production run the API with QYM_ROLE=api and a separate worker "
        "(QYM_ROLE=worker, QYM_SKIP_MIGRATIONS=1, `python -m qym_platform.worker`, "
        "docker compose --profile worker) with its own memory limit, or split "
        "the platform into services (QYM_SERVICE=main|ingestion|workers); see "
        "docs/internal/OPERATIONS.md."
    )


def create_app(settings: PlatformSettings | None = None) -> FastAPI:
    settings = settings or PlatformSettings()
    analysis_job_manager.configure(max_workers=settings.analysis_job_max_workers)
    rule_inference_job_manager.configure(max_workers=settings.analysis_job_max_workers)

    app = FastAPI(
        title="qym-platform",
        version="0.2.3",
        docs_url="/api-docs",
        redoc_url=None,
        openapi_url="/openapi.json",
    )
    # 422 responses must never echo a submitted key (security checklist §15).
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    from qym_platform.db.session import SessionLocal, build_engine
    from qym_platform.deps import get_db
    from qym_platform.services.eval_dispatcher import EvalDispatcher
    from qym_platform.services.eval_remote_queue import RemoteQueueSnapshotter
    from qym_platform.services.maintenance import MaintenanceWorker
    from sqlalchemy.orm import sessionmaker

    from qym_platform.service_layout import resolve_layout

    layout = resolve_layout(settings)
    runs_loops = layout.runs_loops
    app.state.service_layout = layout
    app.state.runs_loops = runs_loops

    # Background loops get their own small pool so a backfill cannot starve requests.
    worker_engine = build_engine(settings, role="worker") if runs_loops else None
    worker_sessions = sessionmaker(bind=worker_engine, autoflush=False, autocommit=False) if worker_engine is not None else SessionLocal
    dashboard_worker = DashboardSummaryWorker(worker_sessions)
    app.state.dashboard_summary_worker = dashboard_worker
    maintenance_worker = MaintenanceWorker(worker_sessions, worker_engine if worker_engine is not None else SessionLocal.kw["bind"])
    app.state.maintenance_worker = maintenance_worker
    eval_dispatcher = EvalDispatcher(worker_sessions)
    app.state.eval_dispatcher = eval_dispatcher
    remote_queue_snapshotter = RemoteQueueSnapshotter(worker_sessions)
    app.state.remote_queue_snapshotter = remote_queue_snapshotter

    @app.on_event("startup")
    def start_dashboard_summary_worker() -> None:
        # Dependency-overridden apps own their test/embedding database. They can
        # use app.state.dashboard_summary_worker or run a worker for that factory.
        # The default role `all` runs the loops here. API-only processes
        # (QYM_ROLE=api) leave them to an optional separate worker process.
        if not runs_loops:
            logging.getLogger("uvicorn.error").info(
                "Dashboard summary worker disabled (service=%s: loops run in the workers service)",
                layout.service,
            )
            return
        if get_db not in app.dependency_overrides:
            dashboard_worker.start()
            logging.getLogger("uvicorn.error").info("Dashboard summary worker started")
            maintenance_worker.start()
            logging.getLogger("uvicorn.error").info("Maintenance worker started")
            eval_dispatcher.start()
            logging.getLogger("uvicorn.error").info("Eval dispatcher started")
            remote_queue_snapshotter.start()
            logging.getLogger("uvicorn.error").info("Remote queue snapshotter started")

    @app.on_event("startup")
    async def cap_request_threadpool() -> None:
        # Sync handlers each hold a pooled connection; never run more of them
        # at once than the API pool can serve (see request_threadpool_size).
        import anyio.to_thread

        from qym_platform.db.session import request_threadpool_size

        size = request_threadpool_size(settings)
        anyio.to_thread.current_default_thread_limiter().total_tokens = size
        logging.getLogger("uvicorn.error").info("Request threadpool capped at %d threads", size)

    @app.on_event("startup")
    def warn_single_process_layout() -> None:
        warning = process_layout_warning(settings)
        if warning:
            logging.getLogger("uvicorn.error").warning(warning)

    @app.on_event("startup")
    def warn_untrusted_proxy() -> None:
        from qym_platform.login_throttle import proxy_trust_warning

        warning = proxy_trust_warning(settings)
        if warning:
            logging.getLogger("uvicorn.error").warning(warning)

    @app.on_event("shutdown")
    def stop_dashboard_summary_worker() -> None:
        remote_queue_snapshotter.stop()
        eval_dispatcher.stop()
        maintenance_worker.stop()
        if dashboard_worker.stop():
            logging.getLogger("uvicorn.error").info("Dashboard summary worker stopped")
        else:
            logging.getLogger("uvicorn.error").warning(
                "Dashboard summary worker did not stop within the shutdown timeout"
            )

    # Run lists and detail payloads are large JSON; gzip cuts them ~5-10x.
    app.add_middleware(GZipExceptStatic, minimum_size=1024, compresslevel=GZIP_COMPRESSLEVEL)
    # Private pages and API data must not be replayed from the browser cache
    # (e.g. Back after signing out); static assets stay cacheable.
    app.add_middleware(NoStoreMiddleware)
    # Oversized uploads are refused before Starlette spools them to /tmp.
    from qym_platform.uploads import UploadLimitMiddleware

    app.add_middleware(UploadLimitMiddleware, max_upload_bytes=settings.max_upload_bytes)

    if settings.request_timing:
        from qym_platform.db.session import engine as _engine
        from qym_platform.middleware.timing import RequestTimingMiddleware, install_engine_hooks

        install_engine_hooks(_engine)
        app.add_middleware(RequestTimingMiddleware, slow_ms=settings.request_timing_slow_ms)

    if session_auth_enabled(settings):
        if not settings.auth_session_secret:
            raise RuntimeError("QYM_AUTH_SESSION_SECRET is required when session-based auth is enabled")
        app.add_middleware(
            SessionMiddleware,
            secret_key=settings.auth_session_secret,
            same_site="lax",
            https_only=str(settings.environment).lower() not in {"dev", "test", "local"},
            session_cookie="qym_session",
            max_age=SESSION_MAX_AGE_SECONDS,
        )

        @app.middleware("http")
        async def same_origin_write_guard(request: Request, call_next):
            if request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
                authz = (request.headers.get("authorization") or "").strip().lower()
                if not authz.startswith("bearer "):
                    origin = request.headers.get("origin")
                    referer = request.headers.get("referer")
                    if origin:
                        if not origin_matches_base(origin, settings.base_url):
                            return JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
                    elif referer:
                        if not referer.startswith(settings.base_url.rstrip("/") + "/") and referer.rstrip("/") != settings.base_url.rstrip("/"):
                            return JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
                    else:
                        return JSONResponse({"detail": "Missing same-origin headers"}, status_code=403)
            return await call_next(request)

    @app.get("/healthz")
    def healthz() -> JSONResponse:
        return JSONResponse({"ok": True, "service": "qym-platform", "env": settings.environment})

    # Serve UI assets from the platform package (no longer from SDK). Text
    # assets are gzipped once per file version, not on every request.
    platform_static = Path(__file__).resolve().parent / "_static"

    dashboard_dir = platform_static / "dashboard"
    ui_dir = platform_static / "ui"

    # Dashboard (historical + approvals + profile + admin)
    if dashboard_dir.exists():
        app.mount("/static", PrecompressedStaticFiles(directory=str(dashboard_dir)), name="dashboard_static")

    # Per-run UI (live/historical run detail)
    if ui_dir.exists():
        app.mount("/ui", PrecompressedStaticFiles(directory=str(ui_dir)), name="run_ui_static")

    app.include_router(auth_router)
    app.include_router(web_router)
    app.include_router(projects_router)
    app.include_router(eval_environments_router)
    app.include_router(eval_presets_router)
    app.include_router(eval_best_runs_router)
    app.include_router(experiments_router)
    app.include_router(eval_queue_router)
    app.include_router(analysis_router)  # before runs_router (its {run_id:path} is a catch-all)
    # Keep the dashboard route family registered so the feature can be restored
    # without rebuilding the application; its handlers are feature-gated.
    app.include_router(root_cause_dashboard_router)
    app.include_router(product_evals_router)
    app.include_router(datasets_router)
    app.include_router(insights_router)
    app.include_router(dashboard_router)
    app.include_router(dashboard_stats_router)
    app.include_router(admin_router)
    app.include_router(step_latency_router)
    app.include_router(runs_router)
    serves_ingest = layout.service != "main" or layout.main_include_ingest
    if serves_ingest:
        app.include_router(ingest_router)
        if layout.ingestion_prefix:
            # The ingestion service's paths, so a client or ingress configured
            # for /ingestion also works against this server.
            from qym_platform.api.service_status import healthz_router

            app.include_router(ingest_router, prefix=layout.ingestion_prefix, include_in_schema=False)
            app.include_router(
                healthz_router(
                    service=layout.service, environment=settings.environment, prefix=layout.ingestion_prefix
                )
            )
    if layout.single_server_surface and layout.workers_prefix:
        from qym_platform.api.service_status import local_status, workers_status_router

        def _local_status() -> dict:
            from qym_platform.db.session import engine as _api_engine

            return local_status(app.state, _api_engine)

        app.include_router(
            workers_status_router(
                prefix=layout.workers_prefix,
                environment=settings.environment,
                status=_local_status,
                service=layout.service,
            )
        )

    @app.on_event("shutdown")
    def shutdown_analysis_jobs() -> None:
        # The registry is in-memory by design for the current single-worker
        # deployment; release its bounded executor with the application.
        analysis_job_manager.shutdown(wait=True)
        rule_inference_job_manager.shutdown(wait=True)

    return app


def _cap_threadpool_on_startup(app: FastAPI, settings: PlatformSettings) -> None:
    @app.on_event("startup")
    async def cap_request_threadpool() -> None:
        import anyio.to_thread

        from qym_platform.db.session import request_threadpool_size

        size = request_threadpool_size(settings)
        anyio.to_thread.current_default_thread_limiter().total_tokens = size
        logging.getLogger("uvicorn.error").info("Request threadpool capped at %d threads", size)


def create_ingestion_app(settings: PlatformSettings | None = None) -> FastAPI:
    """The ingestion service (``QYM_SERVICE=ingestion``): the SDK write path only.

    Serves ``POST /v1/runs``, ``/v1/runs/{id}/events`` and ``/v1/runs:upload``
    under ``QYM_INGESTION_PREFIX`` and (``QYM_INGESTION_LEGACY_PATHS``, on by
    default) at their legacy paths, so an ingress can send exactly those
    paths here while SDK clients keep using ``QYM_BASE_URL``. Bearer API keys
    only: no session middleware, no UI, no other API route (404).
    """
    from qym_platform.api.service_status import healthz_router
    from qym_platform.service_layout import resolve_layout
    from qym_platform.uploads import UploadLimitMiddleware

    settings = settings or PlatformSettings()
    layout = resolve_layout(settings)
    app = FastAPI(title="qym-ingestion", version="0.2.3", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.state.service_layout = layout
    app.add_middleware(NoStoreMiddleware)
    app.add_middleware(UploadLimitMiddleware, max_upload_bytes=settings.max_upload_bytes)
    _cap_threadpool_on_startup(app, settings)

    @app.on_event("startup")
    def configure_models() -> None:
        # Every model (and its outbox hooks) before the first concurrent request.
        from sqlalchemy.orm import configure_mappers

        from qym_platform.db import models  # noqa: F401

        configure_mappers()

    app.include_router(healthz_router(service="ingestion", environment=settings.environment))
    if layout.ingestion_prefix:
        app.include_router(
            healthz_router(service="ingestion", environment=settings.environment, prefix=layout.ingestion_prefix)
        )
        app.include_router(ingest_router, prefix=layout.ingestion_prefix)
    if layout.ingestion_legacy_paths or not layout.ingestion_prefix:
        app.include_router(ingest_router)
    return app


def create_workers_app(settings: PlatformSettings | None = None, *, runtime_factory=None) -> FastAPI:
    """The workers service (``QYM_SERVICE=workers``).

    Runs every background loop and the executor for queued jobs
    (services/workers_runtime.py) for the lifetime of the app, and serves only
    ``/healthz``, ``{QYM_WORKERS_PREFIX}/healthz`` and ``{QYM_WORKERS_PREFIX}/status``.
    """
    import threading
    from contextlib import asynccontextmanager

    from qym_platform.api.service_status import healthz_router, workers_status_router
    from qym_platform.service_layout import resolve_layout

    settings = settings or PlatformSettings()
    layout = resolve_layout(settings)
    holder: dict = {}

    def _default_runtime():
        from sqlalchemy.orm import configure_mappers

        from qym_platform.db import models  # noqa: F401
        from qym_platform.services.workers_runtime import WorkersRuntime

        configure_mappers()
        return WorkersRuntime(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        runtime = (runtime_factory or _default_runtime)()
        holder["runtime"] = runtime
        stop = threading.Event()
        runtime.start()

        def supervise() -> None:
            while not stop.wait(1.0):
                try:
                    runtime.supervise_once()
                except Exception:  # pragma: no cover - keep supervising
                    logging.getLogger(__name__).exception("workers supervision failed")

        supervisor = threading.Thread(target=supervise, name="qym-workers-supervisor", daemon=True)
        supervisor.start()
        logging.getLogger("uvicorn.error").info("qym workers service started")
        try:
            yield
        finally:
            stop.set()
            supervisor.join(5)
            runtime.stop()
            holder.pop("runtime", None)

    app = FastAPI(
        title="qym-workers", version="0.2.3", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.service_layout = layout
    app.state.workers_runtime = holder

    def status() -> dict:
        runtime = holder.get("runtime")
        if runtime is None:
            return {"ok": False, "service": "workers", "error": "not started"}
        payload = runtime.status()
        executor = payload.get("job_executor") or {}
        payload["ok"] = all(payload.get("loops", {}).values()) and bool(executor.get("alive"))
        return payload

    app.include_router(healthz_router(service="workers", environment=settings.environment))
    if layout.workers_prefix:
        app.include_router(
            workers_status_router(prefix=layout.workers_prefix, environment=settings.environment, status=status)
        )
    else:
        app.include_router(workers_status_router(prefix="", environment=settings.environment, status=status))
    return app
