"""Health and status routes of the split services (``/healthz``, ``{prefix}/status``).

Unauthenticated like ``/healthz``: the payloads hold liveness flags and job
counts only, never job contents or configuration secrets.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


def healthz_router(*, service: str, environment: str, prefix: str = "") -> APIRouter:
    router = APIRouter(prefix=prefix, include_in_schema=False)

    @router.get("/healthz")
    def healthz() -> JSONResponse:
        return JSONResponse(
            {"ok": True, "service": "qym-platform", "role": service, "env": environment}
        )

    return router


def workers_status_router(
    *,
    prefix: str,
    environment: str,
    status: Callable[[], Dict[str, Any]],
    service: str = "workers",
) -> APIRouter:
    """``{prefix}/healthz`` and ``{prefix}/status`` (loop and job-executor liveness)."""
    router = healthz_router(service=service, environment=environment, prefix=prefix)

    @router.get("/status")
    def workers_status() -> JSONResponse:
        payload = status()
        healthy = bool(payload.get("ok", True))
        return JSONResponse(payload, status_code=200 if healthy else 503)

    return router


def heartbeat_summary(bind: Any) -> Dict[str, Any]:
    """Workers processes as their ``service_heartbeats`` rows report them."""
    from qym_platform.services.workers_runtime import read_service_heartbeats

    try:
        rows = read_service_heartbeats(bind, "workers")
    except Exception as exc:  # table missing before the migration, or a DB blip
        logger.warning("Could not read service heartbeats", exc_info=True)
        return {"processes": [], "alive": None, "error": type(exc).__name__}
    processes = [
        {
            "process_id": row["id"],
            "alive": row["alive"],
            "age_seconds": row["age_seconds"],
            "started_at": row["started_at"].isoformat() + "Z" if row.get("started_at") else None,
            "loops": row["info"].get("loops"),
            "job_executor": row["info"].get("job_executor"),
            "maintenance_current_job": row["info"].get("maintenance_current_job"),
        }
        for row in rows
    ]
    return {"processes": processes, "alive": any(p["alive"] for p in processes)}


def local_status(app_state: Any, bind: Optional[Any] = None) -> Dict[str, Any]:
    """Status of a single-server (``all``) process: its own loops and jobs."""
    from qym_platform.api.product_evals import job_manager
    from qym_platform.services.analysis_jobs import (
        analysis_job_manager,
        rule_inference_job_manager,
    )

    loops = {}
    for name, attr in (
        ("dashboard_summary", "dashboard_summary_worker"),
        ("maintenance", "maintenance_worker"),
        ("eval_dispatcher", "eval_dispatcher"),
        ("remote_queue_snapshotter", "remote_queue_snapshotter"),
    ):
        worker = getattr(app_state, attr, None)
        loops[name] = bool(worker is not None and worker.is_alive())
    payload: Dict[str, Any] = {
        "ok": True,
        "service": "all",
        "loops_local": bool(getattr(app_state, "runs_loops", False)),
        "loops": loops,
        "job_executor": {
            "mode": "in-process",
            "running": {
                analysis_job_manager.kind: analysis_job_manager.running_count(),
                rule_inference_job_manager.kind: rule_inference_job_manager.running_count(),
                "product_eval": job_manager.running_count(),
            },
        },
    }
    if bind is not None and not payload["loops_local"]:
        payload["workers"] = heartbeat_summary(bind)
    return payload


__all__ = ["healthz_router", "heartbeat_summary", "local_status", "workers_status_router"]
