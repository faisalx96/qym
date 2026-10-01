"""Queue views and orphan cancel for the queue API (plan §12.2a, §13.1, §14.1).

Read side (``api/eval_queue.py`` serializes it):

- ``queue_jobs``: a project's non-terminal jobs (``QUEUED``, ``SUBMITTING``,
  ``SUBMITTED``, ``RUNNING``, ``BLOCKED``, ``CANCELLING``) in **dispatch order**, the
  exact ``ORDER BY`` of ``EvalDispatcher.claim``: ``COALESCE(next_attempt_at,
  created_at)``, then ``created_at``, then ``combo_index`` (plus ``id`` so ties are
  stable). The dispatcher does not order by priority: priority is enforced by the
  Evaluation Service (HIGH preempts), so the queue shows what qym will send next.
- ``queue_positions``: 1-based position of each ``QUEUED`` job within its environment
  (only jobs of one environment compete for its in-flight slots).
- ``linked_runs`` / ``run_progress``: the job's run (``job.run_id``, else the run whose
  ``experiment_job_id`` points at the job, as the dispatcher finds it) and its progress,
  ``items_done`` (received ``run_items``) over ``items_total``
  (``run_metadata.total_items``, when the SDK sent it).
- ``environment_summaries``: per environment, in-flight/queued/blocked counts against
  ``max_inflight_jobs``, health, and whether a ``HIGH`` job is active (a local in-flight
  job, or a ``HIGH`` item in the remote snapshot).
- ``remote_view``: the stored snapshot (``eval_remote_queue.read_snapshot``) with each
  remote job matched to a local job by ``remote_job_id`` (any status) or flagged as an
  **orphan**. A matched remote job whose local job is already terminal (``TIMED_OUT``,
  ``CANCELLED``, ``FAILED``, ``SUCCEEDED``) while the snapshot still shows it
  ``PENDING``/``RUNNING`` is flagged **stale**: qym stopped tracking it (a timeout
  whose remote cancel failed, or a ``CANCELLING`` give-up) but it may still hold a
  service worker.

Write side: ``cancel_remote_orphans`` calls ``POST /evals/{id}/cancel`` for remote
jobs that are in the environment's latest snapshot and are orphans (match **no**
local job) or stale. Ids that match a non-terminal local job are refused (they go
through ``cancel_jobs``, which keeps the job row, linked run and experiment status
consistent). Every id sent to the service is audit-logged
(``eval_remote_job.cancel``, with ``stale`` and the local ``job_id`` for stale
jobs); the caller checks the manager role and commits.

Caveat: a job whose ``POST /evals`` answer was lost is ``SUBMITTING`` with no
``remote_job_id`` until the dispatcher reconciles it, so its remote job shows as an
orphan meanwhile. Cancelling it is safe: the reconcile adopts the remote job and the
next poll records it as ``CANCELLED``.
"""

from __future__ import annotations

from typing import (
    TYPE_CHECKING,
    Any,
    Dict,
    Iterable,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
)

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import (
    AuditLog,
    EvalEnvironment,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    EvalRemoteQueueSnapshot,
    Run,
    RunItem,
)
from .eval_dispatcher import is_stale_remote, stale_remote_job_ids
from .eval_experiments import ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES
from .eval_remote_queue import read_snapshot
from .eval_service_client import (
    EnvAuthError,
    EvalServiceClient,
    EvalServiceError,
    NotCancellable,
    RemoteNotFound,
    redact_text,
)

if TYPE_CHECKING:
    from ..auth import Principal

# Every status the queue shows, in state-machine order.
QUEUE_STATUSES: Tuple[EvalJobStatus, ...] = tuple(
    s for s in EvalJobStatus if s not in TERMINAL_JOB_STATUSES
)

# ``cancel_remote_orphans`` outcomes, per remote job id.
ORPHAN_CANCELLED = "cancelled"
ORPHAN_ALREADY_TERMINAL = "already_terminal"  # 409: finished before the cancel
ORPHAN_NOT_FOUND = "not_found"  # 404: the service no longer knows it
ORPHAN_REFUSED_LOCAL = "refused_local_job"  # ours: cancel it through /cancel
ORPHAN_NOT_IN_SNAPSHOT = "not_in_snapshot"  # not a queued/running job we saw
ORPHAN_ERROR = "error"
ERROR_MESSAGE_MAX = 300


def dispatch_order() -> Tuple[Any, ...]:
    """``ORDER BY`` of ``EvalDispatcher.claim`` (keep the two in sync), plus ``id``."""
    job = EvalExperimentJob
    return (
        func.coalesce(job.next_attempt_at, job.created_at),
        job.created_at,
        job.combo_index,
        job.id,
    )


def queue_jobs(
    db: Session,
    project_id: str,
    *,
    environment_id: Optional[str] = None,
    statuses: Optional[Iterable[EvalJobStatus]] = None,
    created_by_user_id: Optional[str] = None,
    experiment_id: Optional[str] = None,
    limit: int = 500,
) -> Tuple[List[Tuple[EvalExperimentJob, EvalExperiment]], int]:
    """Non-terminal jobs of a project in dispatch order, and their total count.

    ``statuses`` narrows :data:`QUEUE_STATUSES` (terminal statuses are ignored);
    ``created_by_user_id`` keeps jobs of that user's experiments ("mine").
    """
    wanted = [s for s in (statuses or QUEUE_STATUSES) if s in QUEUE_STATUSES]
    if not wanted:
        return [], 0
    query = (
        db.query(EvalExperimentJob, EvalExperiment)
        .join(EvalExperiment, EvalExperiment.id == EvalExperimentJob.experiment_id)
        .filter(
            EvalExperiment.project_id == project_id,
            EvalExperimentJob.status.in_(wanted),
        )
    )
    if environment_id:
        query = query.filter(EvalExperimentJob.environment_id == environment_id)
    if created_by_user_id:
        query = query.filter(EvalExperiment.created_by_user_id == created_by_user_id)
    if experiment_id:
        query = query.filter(EvalExperimentJob.experiment_id == experiment_id)
    total = query.count()
    rows = query.order_by(*dispatch_order()).limit(limit).all()
    return [(job, experiment) for job, experiment in rows], total


def queue_positions(db: Session, environment_ids: Iterable[str]) -> Dict[str, int]:
    """``{job_id: n}``: 1-based dispatch position of each ``QUEUED`` job in its env."""
    env_ids = sorted(set(environment_ids))
    if not env_ids:
        return {}
    rows = db.execute(
        select(EvalExperimentJob.id, EvalExperimentJob.environment_id)
        .where(
            EvalExperimentJob.environment_id.in_(env_ids),
            EvalExperimentJob.status == EvalJobStatus.QUEUED,
        )
        .order_by(*dispatch_order())
    )
    positions: Dict[str, int] = {}
    counters: Dict[str, int] = {}
    for job_id, env_id in rows:
        counters[env_id] = counters.get(env_id, 0) + 1
        positions[job_id] = counters[env_id]
    return positions


def job_priority(job: EvalExperimentJob, experiment: EvalExperiment) -> str:
    """The priority the job is (or will be) submitted with."""
    body = job.request_body if isinstance(job.request_body, Mapping) else {}
    value = body.get("priority")
    if isinstance(value, str) and value:
        return value.upper()
    return experiment.priority.value


def linked_runs(db: Session, jobs: Sequence[EvalExperimentJob]) -> Dict[str, Run]:
    """``{job_id: run}`` via ``job.run_id``, else ``Run.experiment_job_id``."""
    by_run_id = {j.run_id: j.id for j in jobs if j.run_id}
    unlinked = [j.id for j in jobs if not j.run_id]
    out: Dict[str, Run] = {}
    if by_run_id:
        for run in db.query(Run).filter(Run.id.in_(list(by_run_id))):
            out[by_run_id[run.id]] = run
    if unlinked:
        for run in db.query(Run).filter(Run.experiment_job_id.in_(unlinked)):
            if run.experiment_job_id:
                out.setdefault(run.experiment_job_id, run)
    return out


def _int_or_none(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def run_progress(db: Session, runs: Iterable[Run]) -> Dict[str, Dict[str, Any]]:
    """``{run_id: {items_done, items_total}}``; ``items_total`` may be ``None``."""
    runs = list(runs)
    if not runs:
        return {}
    done = dict(
        db.query(RunItem.run_id, func.count(RunItem.id))
        .filter(RunItem.run_id.in_([r.id for r in runs]))
        .group_by(RunItem.run_id)
        .all()
    )
    out: Dict[str, Dict[str, Any]] = {}
    for run in runs:
        metadata = run.run_metadata if isinstance(run.run_metadata, Mapping) else {}
        out[run.id] = {
            "items_done": int(done.get(run.id) or 0),
            "items_total": _int_or_none(metadata.get("total_items")),
        }
    return out


def _snapshot_has_high(snapshot: Optional[Mapping[str, Any]]) -> bool:
    return any(
        (item.get("priority") or "").upper() == "HIGH"
        for item in (snapshot or {}).get("items") or []
    )


def environment_summaries(
    db: Session, environments: Sequence[EvalEnvironment]
) -> List[Dict[str, Any]]:
    """Queue header per environment (plan §12.2a), in the given order."""
    env_ids = [env.id for env in environments]
    if not env_ids:
        return []
    counts: Dict[str, Dict[str, int]] = {}
    for env_id, status, n in (
        db.query(
            EvalExperimentJob.environment_id,
            EvalExperimentJob.status,
            func.count(EvalExperimentJob.id),
        )
        .filter(
            EvalExperimentJob.environment_id.in_(env_ids),
            EvalExperimentJob.status.in_(QUEUE_STATUSES),
        )
        .group_by(EvalExperimentJob.environment_id, EvalExperimentJob.status)
    ):
        counts.setdefault(env_id, {})[EvalJobStatus(status).value] = int(n)
    local_high = set()
    for job, experiment in (
        db.query(EvalExperimentJob, EvalExperiment)
        .join(EvalExperiment, EvalExperiment.id == EvalExperimentJob.experiment_id)
        .filter(
            EvalExperimentJob.environment_id.in_(env_ids),
            EvalExperimentJob.status.in_(list(ACTIVE_JOB_STATUSES)),
        )
    ):
        if job_priority(job, experiment) == "HIGH":
            local_high.add(job.environment_id)
    out = []
    for env in environments:
        by_status = counts.get(env.id, {})
        inflight = sum(by_status.get(s.value, 0) for s in ACTIVE_JOB_STATUSES)
        out.append(
            {
                "id": env.id,
                "name": env.name,
                "is_active": bool(env.is_active),
                "health_status": env.health_status,
                "health_error": env.health_error,
                "max_inflight_jobs": env.max_inflight_jobs,
                "inflight": inflight,
                # Stale remote jobs also take slots of the cap (dispatcher §13).
                "stale_remote": len(stale_remote_job_ids(db, env.id)),
                "queued": by_status.get(EvalJobStatus.QUEUED.value, 0),
                "blocked": by_status.get(EvalJobStatus.BLOCKED.value, 0),
                "counts": by_status,
                "high_active": env.id in local_high
                or _snapshot_has_high(read_snapshot(db, env.id)),
            }
        )
    return out


# ------------------------------------------------------------------ remote snapshot


def local_jobs_by_remote_id(
    db: Session, environment_id: str, remote_job_ids: Iterable[str]
) -> Dict[str, Tuple[EvalExperimentJob, EvalExperiment]]:
    """Our jobs (any status) on this environment with one of these remote ids."""
    ids = sorted({rid for rid in remote_job_ids if rid})
    if not ids:
        return {}
    rows = (
        db.query(EvalExperimentJob, EvalExperiment)
        .join(EvalExperiment, EvalExperiment.id == EvalExperimentJob.experiment_id)
        .filter(
            EvalExperimentJob.environment_id == environment_id,
            EvalExperimentJob.remote_job_id.in_(ids),
        )
        .order_by(EvalExperimentJob.created_at)
        .all()
    )
    # Should two rows ever share a remote id, the newest wins.
    return {str(job.remote_job_id): (job, experiment) for job, experiment in rows}


def remote_view(db: Session, env: EvalEnvironment) -> Dict[str, Any]:
    """One environment's latest snapshot, own jobs matched and orphans flagged."""
    snapshot = read_snapshot(db, env.id)
    items = list((snapshot or {}).get("items") or [])
    matched = local_jobs_by_remote_id(
        db, env.id, [item.get("remote_job_id") for item in items]
    )
    out_items = []
    for item in items:
        pair = matched.get(item.get("remote_job_id"))
        match = None
        stale = False
        if pair is not None:
            job, experiment = pair
            match = {
                "job_id": job.id,
                "experiment_id": experiment.id,
                "experiment_name": experiment.name,
                "status": job.status.value,
            }
            stale = is_stale_remote(item.get("status"), job.status)
        out_items.append(
            {**item, "orphan": match is None, "stale": stale, "match": match}
        )
    return {
        "environment_id": env.id,
        "environment_name": env.name,
        "is_active": bool(env.is_active),
        "health_status": env.health_status,
        "fetched_at": snapshot["fetched_at"] if snapshot else None,
        "fetch_error": snapshot["fetch_error"] if snapshot else None,
        "stale": snapshot["stale"] if snapshot else True,
        "items": out_items,
        "orphan_count": sum(1 for item in out_items if item["orphan"]),
        "stale_count": sum(1 for item in out_items if item["stale"]),
    }


def _drop_from_snapshot(db: Session, environment_id: str, gone: Iterable[str]) -> None:
    """Remove cancelled/finished orphans from the stored snapshot right away."""
    gone = set(gone)
    snapshot = db.get(EvalRemoteQueueSnapshot, environment_id)
    if not gone or snapshot is None:
        return
    items = [
        item
        for item in snapshot.items or []
        if not (isinstance(item, Mapping) and item.get("remote_job_id") in gone)
    ]
    if len(items) != len(snapshot.items or []):
        snapshot.items = items


async def cancel_remote_orphans(
    db: Session,
    env: EvalEnvironment,
    remote_job_ids: Sequence[str],
    principal: "Principal",
    client: EvalServiceClient,
    *,
    reason: Optional[str] = None,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Cancel orphan and stale remote jobs directly on the service (manager only).

    Returns ``(outcomes, errors)``: per id ``cancelled``, ``already_terminal``,
    ``not_found``, ``refused_local_job`` (matches a non-terminal local job, or a
    local job but not the snapshot), ``not_in_snapshot`` or ``error`` (with a
    redacted message in ``errors``). After a 401 the remaining ids are not sent.
    A cancelled stale job gets ``remote_status = CANCELLED`` on its local row.
    One ``AuditLog`` entry per id sent to the service. The caller checks the manager
    role, closes the client and commits.
    """
    ids = list(dict.fromkeys(rid for rid in remote_job_ids if rid))
    snapshot = read_snapshot(db, env.id)
    snapshot_status = {
        item.get("remote_job_id"): item.get("status")
        for item in (snapshot or {}).get("items") or []
    }
    local = local_jobs_by_remote_id(db, env.id, ids)
    outcomes: Dict[str, str] = {}
    errors: Dict[str, str] = {}
    auth_failed = False
    for rid in ids:
        if rid not in snapshot_status:
            outcomes[rid] = (
                ORPHAN_REFUSED_LOCAL if rid in local else ORPHAN_NOT_IN_SNAPSHOT
            )
            continue
        stale_job: Optional[EvalExperimentJob] = None
        if rid in local:
            job = local[rid][0]
            if not is_stale_remote(snapshot_status[rid], job.status):
                outcomes[rid] = ORPHAN_REFUSED_LOCAL
                continue
            stale_job = job
        if auth_failed:
            outcomes[rid] = ORPHAN_ERROR
            errors[rid] = "Evaluation service rejected the environment API key"
            continue
        try:
            await client.cancel(rid, principal.user.id)
        except NotCancellable:
            outcomes[rid] = ORPHAN_ALREADY_TERMINAL
        except RemoteNotFound:
            outcomes[rid] = ORPHAN_NOT_FOUND
        except EnvAuthError:
            auth_failed = True
            outcomes[rid] = ORPHAN_ERROR
            errors[rid] = "Evaluation service rejected the environment API key"
        except EvalServiceError as exc:
            outcomes[rid] = ORPHAN_ERROR
            errors[rid] = redact_text(str(exc))[:ERROR_MESSAGE_MAX]
        except Exception as exc:  # noqa: BLE001 - transport/policy; never echo details
            outcomes[rid] = ORPHAN_ERROR
            errors[rid] = f"Remote cancel failed: {type(exc).__name__}"
        else:
            outcomes[rid] = ORPHAN_CANCELLED
            if stale_job is not None:
                stale_job.remote_status = "CANCELLED"
        after: Dict[str, Any] = {
            "outcome": outcomes[rid],
            "environment_id": env.id,
            "project_id": env.project_id,
            "reason": reason,
            "orphan": stale_job is None,
        }
        if stale_job is not None:
            after.update(
                stale=True,
                job_id=stale_job.id,
                job_status=stale_job.status.value,
            )
        db.add(
            AuditLog(
                actor_user_id=principal.user.id,
                action="eval_remote_job.cancel",
                entity_type="eval_remote_job",
                entity_id=rid,
                before={},
                after=after,
            )
        )
    _drop_from_snapshot(
        db,
        env.id,
        [
            rid
            for rid, outcome in outcomes.items()
            if outcome in (ORPHAN_CANCELLED, ORPHAN_ALREADY_TERMINAL, ORPHAN_NOT_FOUND)
        ],
    )
    return outcomes, errors


__all__ = (
    "QUEUE_STATUSES",
    "cancel_remote_orphans",
    "dispatch_order",
    "environment_summaries",
    "job_priority",
    "linked_runs",
    "local_jobs_by_remote_id",
    "queue_jobs",
    "queue_positions",
    "remote_view",
    "run_progress",
)
