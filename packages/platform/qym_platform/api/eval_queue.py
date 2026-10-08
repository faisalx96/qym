"""Queue API (plan §14.1, §12.2a, §13.1): what is waiting, what the service holds, cancel.

Routes live under ``/v1/projects/{project_id}/eval-queue``. Every project member can
read the queue. Cancelling a job needs its experiment's creator or a project manager,
checked **per job**. Cancelling an orphan remote job needs a project manager.

``GET /v1/projects/{pid}/eval-queue``
    Query: ``environment_id``, ``status`` (repeatable; non-terminal statuses only,
    anything else is a 422), ``mine`` (jobs of my experiments), ``experiment_id``,
    ``limit`` (default 500, max 1000). Response::

        {
          "jobs": [{
            "id", "experiment_id", "experiment_name", "environment_id",
            "environment_name", "combo_index", "attempt", "run_name",
            "params",                  # swept values + slot bindings, secret refs stripped
            "priority",                # "LOW" | "NORMAL" | "HIGH" (as submitted)
            "status",                  # QUEUED | SUBMITTING | SUBMITTED | RUNNING |
                                       # BLOCKED | CANCELLING
            "wait_reason",             # why it isn't progressing, or null
            "error",
            "queue_position",          # 1-based among QUEUED jobs of its environment
            "created_by_user_id", "created_by_email",
            "created_at", "next_attempt_at", "submitted_at", "cancel_requested_at",
            "remote_job_id", "remote_status",
            "can_cancel",              # the caller may cancel this job
            "run": null | {            # linked qym run and its live progress
              "id", "status", "status_reason", "started_at", "last_event_at",
              "items_done", "items_total", "deleted"
            }
          }],
          "total",                     # matching jobs (may exceed len(jobs))
          "limit",
          "environments": [{           # queue headers (the filtered env, or all active)
            "id", "name", "is_active", "health_status", "health_error",
            "inflight", "queued", "blocked",
            "stale_remote",            # finished locally, maybe still running remotely
            "counts": {status: n}, "high_active"
          }]
        }

    ``jobs`` are in **dispatch order**, exactly the dispatcher's claim order:
    ``COALESCE(next_attempt_at, created_at)``, ``created_at``, ``combo_index``
    (``services/eval_queue.dispatch_order``). Timestamps are API timestamps (UTC).

``GET /v1/projects/{pid}/eval-queue/remote``
    Query: ``environment_id`` (default: every active environment of the project).
    Serves the stored snapshots (never calls the service in the request) and schedules
    a background refresh of each shown environment whose snapshot is older than 30s
    (``eval_remote_queue.refresh_snapshot_on_view``). Response::

        {
          "environments": [{
            "environment_id", "environment_name", "is_active", "health_status",
            "fetched_at",              # last refresh attempt, null if never fetched
            "fetch_error",             # set when that attempt failed (items are older)
            "stale",                   # older than 30s (a refresh is scheduled)
            "orphan_count", "stale_count",
            "items": [{
              "remote_job_id", "status", "priority", "user_id", "created_at",
              "run_name",
              "orphan",                # no local job has this remote_job_id
              "stale",                 # matches a terminal local job but is still
                                       # PENDING/RUNNING on the service
              "match": null | {"job_id", "experiment_id", "experiment_name", "status"}
            }]
          }],
          "can_cancel_orphans"         # the caller is a project manager (orphans
                                       # and stale jobs)
        }

``POST /v1/projects/{pid}/eval-queue/cancel``
    Body: ``{"job_ids": [...≤200], "reason"?}`` **or**
    ``{"experiment_id", "statuses"?: ["QUEUED"], "reason"?}`` (every job of that
    experiment in those non-terminal statuses; default ``["QUEUED"]``). Uses
    ``eval_experiments.cancel_jobs``. Response::

        {"outcomes": {job_id: outcome}, "counts": {outcome: n}}

    with outcome ``cancelled`` (removed locally, nothing reached the service),
    ``cancelling`` (the dispatcher hard-stops it remotely on its next tick),
    ``forbidden``, ``already_terminal`` or ``not_found`` (unknown id or another
    project's job).

``POST /v1/projects/{pid}/eval-queue/remote/cancel`` (project manager)
    Body: ``{"environment_id", "remote_job_ids": [...≤200], "reason"?}``. Only orphans
    and stale jobs of the latest snapshot are cancelled, directly on the service.
    Response::

        {"environment_id", "outcomes": {remote_job_id: outcome},
         "errors": {remote_job_id: message}, "counts": {outcome: n}}

    with outcome ``cancelled``, ``already_terminal``, ``not_found``,
    ``refused_local_job`` (it matches a non-terminal local job: use
    ``/eval-queue/cancel``),
    ``not_in_snapshot`` or ``error``. Every id sent to the service is audit-logged.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from qym_platform.api.eval_environments import (
    EvalClientFactory,
    _get_environment,
    _remote_http_error,
    _stored_key,
    get_eval_client_factory,
)
from qym_platform.api.experiments import _user_emails, strip_secret_refs
from qym_platform.api.projects import _require_project_access, _require_project_manager
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    EvalEnvironment,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Run,
)
from qym_platform.deps import get_db
from qym_platform.llm_endpoint_security import LlmEndpointValidationError
from qym_platform.permissions import is_project_manager
from qym_platform.services import eval_queue
from qym_platform.services.eval_experiments import can_control_experiment, cancel_jobs
from qym_platform.services.eval_remote_queue import refresh_snapshot_on_view
from qym_platform.settings import PlatformSettings
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.log import get_logger

logger = get_logger(__name__)

router = APIRouter()

_PREFIX = "/v1/projects/{project_id}/eval-queue"
MAX_CANCEL_IDS = 200


class QueueCancelRequest(BaseModel):
    job_ids: Optional[List[str]] = Field(
        default=None, min_length=1, max_length=MAX_CANCEL_IDS
    )
    experiment_id: Optional[str] = Field(default=None, min_length=1, max_length=36)
    statuses: Optional[List[EvalJobStatus]] = Field(default=None, min_length=1)
    reason: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _one_form(self) -> "QueueCancelRequest":
        if (self.job_ids is None) == (self.experiment_id is None):
            raise ValueError("Send either job_ids or experiment_id")
        if self.statuses is not None and self.experiment_id is None:
            raise ValueError("statuses only applies with experiment_id")
        for status in self.statuses or []:
            if status not in eval_queue.QUEUE_STATUSES:
                raise ValueError(f"{status.value} jobs are already finished")
        if self.job_ids is not None and any(
            not jid or len(jid) > 100 for jid in self.job_ids
        ):
            raise ValueError("job_ids must be non-empty ids")
        return self


class RemoteCancelRequest(BaseModel):
    environment_id: str = Field(min_length=1, max_length=36)
    remote_job_ids: List[str] = Field(min_length=1, max_length=MAX_CANCEL_IDS)
    reason: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _ids(self) -> "RemoteCancelRequest":
        if any(not rid or len(rid) > 100 for rid in self.remote_job_ids):
            raise ValueError("remote_job_ids must be non-empty ids")
        return self


# --------------------------------------------------------------------------- helpers


def _counts(outcomes: Dict[str, str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for outcome in outcomes.values():
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts


def _project_environments(
    db: Session, project_id: str, environment_id: Optional[str]
) -> List[EvalEnvironment]:
    if environment_id:
        return [_get_environment(db, project_id, environment_id)]
    return (
        db.query(EvalEnvironment)
        .filter(
            EvalEnvironment.project_id == project_id,
            EvalEnvironment.is_active.is_(True),
        )
        .order_by(EvalEnvironment.name, EvalEnvironment.id)
        .all()
    )


def _job_run_name(job: EvalExperimentJob) -> Optional[str]:
    body = job.request_body if isinstance(job.request_body, dict) else {}
    config = (body.get("evaluator") or {}).get("config") or {}
    name = config.get("run_name") if isinstance(config, dict) else None
    return name if isinstance(name, str) else None


def _run_payload(
    run: Optional[Run], progress: Dict[str, Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if run is None:
        return None
    counts = progress.get(run.id) or {}
    return {
        "id": run.id,
        "status": run.status.value if run.status else None,
        "status_reason": run.status_reason,
        "started_at": to_api_timestamp(run.started_at),
        "last_event_at": to_api_timestamp(run.last_event_at),
        "items_done": counts.get("items_done", 0),
        "items_total": counts.get("items_total"),
        "deleted": run.deleted_at is not None,
    }


def _session_factory(db: Session) -> sessionmaker:
    """A factory on the request's engine, for work that outlives the request."""
    return sessionmaker(bind=db.get_bind(), autoflush=False)


# --------------------------------------------------------------------------- routes


@router.get(_PREFIX)
def get_queue(
    project_id: str,
    environment_id: Optional[str] = Query(None, max_length=36),
    status: Optional[List[EvalJobStatus]] = Query(None),
    mine: bool = Query(False),
    experiment_id: Optional[str] = Query(None, max_length=36),
    limit: int = Query(500, ge=1, le=1000),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    terminal = [s.value for s in status or [] if s not in eval_queue.QUEUE_STATUSES]
    if terminal:
        raise HTTPException(
            status_code=422,
            detail=f"The queue only holds unfinished jobs, not {', '.join(terminal)}",
        )
    environments = _project_environments(db, project_id, environment_id)
    if experiment_id:
        exists = (
            db.query(EvalExperiment.id)
            .filter(
                EvalExperiment.id == experiment_id,
                EvalExperiment.project_id == project_id,
            )
            .first()
        )
        if exists is None:
            raise HTTPException(status_code=404, detail="Experiment not found")
    rows, total = eval_queue.queue_jobs(
        db,
        project_id,
        environment_id=environment_id,
        statuses=status,
        created_by_user_id=principal.user.id if mine else None,
        experiment_id=experiment_id,
        limit=limit,
    )
    jobs = [job for job, _ in rows]
    env_names = {env.id: env.name for env in environments}
    missing = {j.environment_id for j in jobs} - set(env_names)
    if missing:  # jobs on an environment that was since disabled
        env_names.update(
            {
                env.id: env.name
                for env in db.query(EvalEnvironment).filter(
                    EvalEnvironment.id.in_(sorted(missing))
                )
            }
        )
    positions = eval_queue.queue_positions(db, {j.environment_id for j in jobs})
    runs = eval_queue.linked_runs(db, jobs)
    progress = eval_queue.run_progress(db, runs.values())
    emails = _user_emails(db, [x.created_by_user_id for _, x in rows])
    allowed: Dict[str, bool] = {}
    out = []
    for job, experiment in rows:
        if experiment.id not in allowed:
            allowed[experiment.id] = can_control_experiment(db, principal, experiment)
        out.append(
            {
                "id": job.id,
                "experiment_id": experiment.id,
                "experiment_name": experiment.name,
                "environment_id": job.environment_id,
                "environment_name": env_names.get(job.environment_id),
                "combo_index": job.combo_index,
                "attempt": job.attempt,
                "run_name": _job_run_name(job),
                "params": strip_secret_refs(job.params or {}),
                "priority": eval_queue.job_priority(job, experiment),
                "status": job.status.value,
                "wait_reason": job.wait_reason,
                "error": job.error,
                "queue_position": positions.get(job.id),
                "created_by_user_id": experiment.created_by_user_id,
                "created_by_email": emails.get(experiment.created_by_user_id or ""),
                "created_at": to_api_timestamp(job.created_at),
                "next_attempt_at": to_api_timestamp(job.next_attempt_at),
                "submitted_at": to_api_timestamp(job.submitted_at),
                "cancel_requested_at": to_api_timestamp(job.cancel_requested_at),
                "remote_job_id": job.remote_job_id,
                "remote_status": job.remote_status,
                "can_cancel": allowed[experiment.id],
                "run": _run_payload(runs.get(job.id), progress),
            }
        )
    return {
        "jobs": out,
        "total": total,
        "limit": limit,
        "environments": eval_queue.environment_summaries(db, environments),
    }


@router.get(_PREFIX + "/remote")
def get_remote_queue(
    project_id: str,
    background_tasks: BackgroundTasks,
    environment_id: Optional[str] = Query(None, max_length=36),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    client_factory: EvalClientFactory = Depends(get_eval_client_factory),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    environments = _project_environments(db, project_id, environment_id)
    views = []
    factory = _session_factory(db)
    for env in environments:
        view = eval_queue.remote_view(db, env)
        view["fetched_at"] = to_api_timestamp(view["fetched_at"])
        views.append(view)
        if env.is_active and view["stale"]:
            # After the response: the page never waits on the service.
            background_tasks.add_task(
                refresh_snapshot_on_view,
                factory,
                env.id,
                client_factory=client_factory,
            )
    return {
        "environments": views,
        "can_cancel_orphans": is_project_manager(db, principal, project_id),
    }


@router.post(_PREFIX + "/cancel")
def cancel_queue_jobs(
    project_id: str,
    req: QueueCancelRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    if req.experiment_id is not None:
        experiment = (
            db.query(EvalExperiment)
            .filter(
                EvalExperiment.id == req.experiment_id,
                EvalExperiment.project_id == project_id,
            )
            .first()
        )
        if experiment is None:
            raise HTTPException(status_code=404, detail="Experiment not found")
        statuses = req.statuses or [EvalJobStatus.QUEUED]
        job_ids = [
            job_id
            for (job_id,) in db.query(EvalExperimentJob.id)
            .filter(
                EvalExperimentJob.experiment_id == experiment.id,
                EvalExperimentJob.status.in_(statuses),
            )
            .order_by(*eval_queue.dispatch_order())
        ]
    else:
        job_ids = list(req.job_ids or [])
    outcomes = (
        cancel_jobs(db, job_ids, principal, req.reason, project_id=project_id)
        if job_ids
        else {}
    )
    db.commit()
    logger.info("Queue cancel by user %s in project %s: %s", principal.user.id, project_id, _counts(outcomes))
    return {"outcomes": outcomes, "counts": _counts(outcomes)}


@router.post(_PREFIX + "/remote/cancel")
async def cancel_orphan_remote_jobs(
    project_id: str,
    req: RemoteCancelRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    client_factory: EvalClientFactory = Depends(get_eval_client_factory),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    env = _get_environment(db, project_id, req.environment_id)
    api_key = _stored_key(env, PlatformSettings())
    try:
        client = client_factory(env.base_url, api_key)
    except LlmEndpointValidationError as exc:
        raise _remote_http_error(exc, api_key)
    finally:
        del api_key
    try:
        outcomes, errors = await eval_queue.cancel_remote_orphans(
            db, env, req.remote_job_ids, principal, client, reason=req.reason
        )
    finally:
        await client.aclose()
    db.commit()
    logger.info(
        "Orphan remote job cancel on environment %s: %s (%d error(s))",
        env.id,
        _counts(outcomes),
        len(errors or []),
    )
    if env.is_active:
        background_tasks.add_task(
            refresh_snapshot_on_view,
            _session_factory(db),
            env.id,
            client_factory=client_factory,
        )
    return {
        "environment_id": env.id,
        "outcomes": outcomes,
        "errors": errors,
        "counts": _counts(outcomes),
    }
