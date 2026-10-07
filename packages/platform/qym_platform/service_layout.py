"""Which parts of the platform this process runs (``QYM_SERVICE`` / ``QYM_ROLE``).

The platform can run as one server (``all``, the default) or as three
services that share one database:

* ``main``: UI and every regular API route (plus the ingest routes unless
  ``QYM_MAIN_INCLUDE_INGEST=false``); background jobs are queued in
  ``background_jobs`` instead of running here.
* ``ingestion``: only the SDK write path (``POST /v1/runs``,
  ``/v1/runs/{id}/events``, ``/v1/runs:upload``).
* ``workers``: the background loops, the executor for queued jobs, and a
  small ``/healthz`` + ``/status`` surface.

``QYM_SERVICE`` wins when set. Otherwise the legacy ``QYM_ROLE`` maps
``all -> all``, ``api -> main`` and ``worker -> workers``; a legacy ``api``
process keeps the single-server HTTP surface and runs its jobs in-process as
before, it only leaves the loops to a worker process.
"""

from __future__ import annotations

from dataclasses import dataclass

from qym_platform.settings import PlatformSettings

_ROLE_TO_SERVICE = {"all": "all", "api": "main", "worker": "workers"}


def normalize_prefix(value: str | None) -> str:
    """``/x/y`` form without a trailing slash; ``""`` for the root."""
    value = (value or "").strip().strip("/")
    return f"/{value}" if value else ""


@dataclass(frozen=True)
class ServiceLayout:
    service: str  # all | main | ingestion | workers
    explicit: bool  # set through QYM_SERVICE (not derived from QYM_ROLE)
    root_path: str
    main_prefix: str
    ingestion_prefix: str
    workers_prefix: str
    main_include_ingest: bool
    ingestion_legacy_paths: bool

    @property
    def legacy(self) -> bool:
        return not self.explicit

    @property
    def runs_loops(self) -> bool:
        """Dashboard summary, maintenance, eval dispatch and queue snapshot loops."""
        return self.service in ("all", "workers")

    @property
    def runs_job_executor(self) -> bool:
        """Claims jobs queued by a ``main`` service."""
        return self.service == "workers"

    @property
    def queues_jobs(self) -> bool:
        """Analyses, rule inference and product evals go to the workers queue.

        Only an explicit ``QYM_SERVICE=main``: a legacy ``QYM_ROLE=api``
        process keeps running them itself, as before.
        """
        return self.service == "main" and self.explicit

    @property
    def single_server_surface(self) -> bool:
        """Serves every route plus the ingestion/workers aliases (``all``, legacy ``api``)."""
        return self.service == "all" or (self.service == "main" and self.legacy)

    @property
    def writes_heartbeat(self) -> bool:
        """Publishes liveness to ``service_heartbeats`` (loops not in the HTTP process)."""
        return self.service == "workers"


def resolve_layout(settings: PlatformSettings) -> ServiceLayout:
    explicit = bool(settings.service)
    service = settings.service or _ROLE_TO_SERVICE.get(settings.role, "all")
    return ServiceLayout(
        service=service,
        explicit=explicit,
        root_path=normalize_prefix(settings.root_path),
        main_prefix=normalize_prefix(settings.main_prefix),
        ingestion_prefix=normalize_prefix(settings.ingestion_prefix),
        workers_prefix=normalize_prefix(settings.workers_prefix),
        main_include_ingest=bool(settings.main_include_ingest),
        ingestion_legacy_paths=bool(settings.ingestion_legacy_paths),
    )


def job_execution_queued(settings: PlatformSettings | None = None) -> bool:
    """True when this process should enqueue background jobs for the workers."""
    return resolve_layout(settings or PlatformSettings()).queues_jobs


__all__ = ["ServiceLayout", "job_execution_queued", "normalize_prefix", "resolve_layout"]
