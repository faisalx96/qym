"""Admin maintenance API: database statistics and operator-triggered jobs."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import UserRole
from qym_platform.deps import get_db
from qym_platform.services import maintenance
from qym_platform.settings import PlatformSettings

router = APIRouter(prefix="/api/admin", tags=["admin"])

_STATS_CACHE: Dict[str, Any] = {"at": 0.0, "value": None}
_STATS_TTL_SECONDS = 60.0


def _require_admin(principal: Principal) -> None:
    if principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")


def _worker_state(request: Request, settings: PlatformSettings, db: Session | None = None) -> Dict[str, Any]:
    state = request.app.state
    runs_loops = getattr(state, "runs_loops", None)
    if runs_loops is None:
        runs_loops = settings.role != "api"
    if not runs_loops:
        # This HTTP process runs no loops: a worker process does (the
        # workers service, the QYM_WEB_WORKERS launcher's loop process or a
        # worker Deployment). It reports through ``service_heartbeats``; with
        # no heartbeat at all (an old worker image) do not report "stopped".
        from qym_platform.api.service_status import heartbeat_summary

        workers = heartbeat_summary(db.get_bind()) if db is not None else {"processes": []}
        live = [p for p in workers.get("processes") or [] if p.get("alive")]
        layout = getattr(state, "service_layout", None)
        # An explicit split (QYM_SERVICE=main) expects a workers service that
        # heartbeats: none at all means it is down, not unknown.
        reported = bool(workers.get("processes")) or bool(layout is not None and layout.queues_jobs)
        loops = (live[0].get("loops") or {}) if live else {}
        return {
            "loops": "separate",
            "summary_worker_alive": (bool(loops.get("dashboard_summary")) if reported else None),
            "maintenance_worker_alive": (bool(loops.get("maintenance")) if reported else None),
            "maintenance_current_job": live[0].get("maintenance_current_job") if live else None,
            "workers_service": workers,
        }
    summary = getattr(state, "dashboard_summary_worker", None)
    maint = getattr(state, "maintenance_worker", None)
    return {
        "loops": "local",
        "summary_worker_alive": bool(summary and summary.is_alive()),
        "maintenance_worker_alive": bool(maint and maint.is_alive()),
        "maintenance_current_job": getattr(maint, "current_job_id", None),
    }


@router.get("/maintenance")
def maintenance_overview(
    request: Request,
    refresh: bool = False,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_admin(principal)
    settings = PlatformSettings()
    now = time.time()
    if refresh or _STATS_CACHE["value"] is None or now - _STATS_CACHE["at"] > _STATS_TTL_SECONDS:
        from qym_platform.tools.perf.db_stats import collect

        try:
            _STATS_CACHE["value"] = collect(db.get_bind(), top=12, sample_pct=1.0)
        except Exception as exc:  # noqa: BLE001 - stats are best effort (sqlite in tests)
            _STATS_CACHE["value"] = {"error": str(exc).splitlines()[0]}
        _STATS_CACHE["at"] = now
    pool = db.get_bind().pool
    return {
        "settings": {
            "role": settings.role,
            "service": getattr(getattr(request.app.state, "service_layout", None), "service", None),
            "maintenance_mode": settings.maintenance_mode,
            "event_log_mode": settings.event_log_mode,
            "span_retention_days": settings.span_retention_days,
            "deleted_run_grace_days": settings.deleted_run_grace_days,
            "span_partition_days_ahead": settings.span_partition_days_ahead,
        },
        "workers": _worker_state(request, settings, db),
        "pool": pool.status() if hasattr(pool, "status") else None,
        "db_stats": _STATS_CACHE["value"],
        "db_stats_age_seconds": round(now - _STATS_CACHE["at"], 1),
        "job_kinds": maintenance.registry(),
        "jobs": [j.as_dict() for j in maintenance.list_jobs(db)],
    }


@router.get("/maintenance/jobs/{job_id}")
def maintenance_job(job_id: str, db: Session = Depends(get_db), principal: Principal = Depends(require_ui_principal)) -> Dict[str, Any]:
    _require_admin(principal)
    from qym_platform.db.maintenance_models import MaintenanceJob

    job = db.get(MaintenanceJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.as_dict()


@router.post("/maintenance/jobs")
def maintenance_enqueue(
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_admin(principal)
    kind = str(request.get("kind") or "")
    params: Optional[Dict[str, Any]] = request.get("params") or {}
    if not isinstance(params, dict):
        raise HTTPException(status_code=400, detail="params must be an object")
    if kind not in maintenance.registry():
        raise HTTPException(status_code=400, detail=f"Unknown job kind {kind!r}")
    if maintenance.is_irreversible(kind) and request.get("confirm") != kind:
        raise HTTPException(status_code=400, detail=f"Irreversible job: repeat the kind name in 'confirm' ({kind})")
    try:
        job = maintenance.enqueue(db, kind, params, requested_by=principal.user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()
    return job.as_dict()


@router.post("/maintenance/jobs/{job_id}/start")
def maintenance_start(job_id: str, db: Session = Depends(get_db), principal: Principal = Depends(require_ui_principal)) -> Dict[str, Any]:
    _require_admin(principal)
    job = maintenance.request_start(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.commit()
    return job.as_dict()


@router.post("/maintenance/jobs/{job_id}/cancel")
def maintenance_cancel(job_id: str, db: Session = Depends(get_db), principal: Principal = Depends(require_ui_principal)) -> Dict[str, Any]:
    _require_admin(principal)
    job = maintenance.request_cancel(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.commit()
    return job.as_dict()
