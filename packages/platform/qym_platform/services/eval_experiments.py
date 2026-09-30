"""Experiment and job bookkeeping shared by the API, the queue and the dispatcher.

Launch tokens (plan §11). Each job gets a one-time token that the dispatcher sends in
``evaluator.config.run_metadata.qym_launch.token`` and ingest verifies against
``EvalExperimentJob.launch_token_hash``. Only the sha256 is stored. So that the
dispatcher can still send the raw token without it ever touching the database, the
token is **derived**: ``HMAC-SHA256(subkey, job_id)``, where ``subkey`` is an HMAC of
``QYM_LLM_CONFIG_ENCRYPTION_KEY`` under a fixed label. Job ids are random UUIDs and a
retry creates a new row (new id), so every job has its own token; one-time use is
enforced at ingest (#17) by ``job.run_id IS NULL`` (plus the unique ``run_id``); ingest
compares hashes in constant time with ``verify_launch_token``.

Key rotation: rotating ``QYM_LLM_CONFIG_ENCRYPTION_KEY`` changes every derived token,
so the tokens of existing jobs are invalidated. A job submitted *after* the rotation
(queued, or resubmitted by crash recovery) sends a new token that no longer matches its
stored ``launch_token_hash``, and its run is ingested as ``local``. A job already
submitted with the old token still links, because ingest only hashes what it receives,
unless it is resubmitted. Rotate while no jobs are queued, or re-hash non-terminal jobs
with ``launch_token_hash_for_job`` right after rotating.

The stored ``request_body`` holds ``qym_launch`` **without** the token; the dispatcher
calls ``body_with_launch_token`` in memory just before submitting.

Retries (plan §13). A retry is a new row with the same ``combo_index``,
``attempt + 1`` and ``retry_of_job_id`` set (migration 0063); it gets a new id and so a
new token. The retried row is *superseded*: kept for history, left out of the
experiment's aggregate status.

Cancellation (plan §13.1) is ``cancel_job``: queued/blocked jobs without a live lease are
cancelled locally; otherwise ``cancel_requested_at`` is set (and submitted/running jobs
move to ``CANCELLING``) so the dispatcher performs the remote cancel.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import hmac
from datetime import datetime
from typing import Any, Iterable, Mapping, Optional, Sequence, cast

from sqlalchemy import CursorResult, or_, update
from sqlalchemy.orm import Session

from ..datetime_utils import utc_now_naive
from ..db.models import (
    EvalExperiment,
    EvalExperimentJob,
    EvalExperimentStatus,
    EvalJobStatus,
)
from ..settings import PlatformSettings

_TOKEN_KEY_LABEL = b"qym-eval-launch-token-v1"
TOKEN_PREFIX = "qlt_"

TERMINAL_JOB_STATUSES = frozenset(
    {
        EvalJobStatus.SUCCEEDED,
        EvalJobStatus.FAILED,
        EvalJobStatus.CANCELLED,
        EvalJobStatus.TIMED_OUT,
    }
)
# Cancelled locally (no remote job exists yet) when no dispatcher holds the lease.
LOCAL_CANCEL_STATUSES = (EvalJobStatus.QUEUED, EvalJobStatus.BLOCKED)
# Have (or may have) a remote job: the dispatcher cancels remotely.
REMOTE_CANCEL_STATUSES = (EvalJobStatus.SUBMITTED, EvalJobStatus.RUNNING)
RETRYABLE_STATUSES = frozenset(
    {
        EvalJobStatus.FAILED,
        EvalJobStatus.CANCELLED,
        EvalJobStatus.TIMED_OUT,
        EvalJobStatus.BLOCKED,
    }
)
_ACTIVE_STATUSES = frozenset(
    {
        EvalJobStatus.SUBMITTING,
        EvalJobStatus.SUBMITTED,
        EvalJobStatus.RUNNING,
        EvalJobStatus.CANCELLING,
    }
)


class LaunchTokenUnavailable(RuntimeError):
    """``QYM_LLM_CONFIG_ENCRYPTION_KEY`` is not configured."""


# --------------------------------------------------------------------------- tokens


def _token_subkey(settings: Optional[PlatformSettings] = None) -> bytes:
    secret = ((settings or PlatformSettings()).llm_config_encryption_key or "").strip()
    if not secret:
        raise LaunchTokenUnavailable(
            "Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY to be configured"
        )
    return hmac.new(secret.encode("utf-8"), _TOKEN_KEY_LABEL, hashlib.sha256).digest()


def launch_token_for_job(
    job_id: str, settings: Optional[PlatformSettings] = None
) -> str:
    """The raw one-time launch token of a job. Never store, log or return it."""
    digest = hmac.new(
        _token_subkey(settings), job_id.encode("utf-8"), hashlib.sha256
    ).digest()
    return TOKEN_PREFIX + base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def hash_launch_token(token: str) -> str:
    """``launch_token_hash``: hex sha256 of the raw token (what ingest compares)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_launch_token(token: Any, expected_hash: Optional[str]) -> bool:
    """Constant-time check of a received token against ``launch_token_hash`` (ingest)."""
    if not isinstance(token, str) or not token or not expected_hash:
        return False
    return hmac.compare_digest(hash_launch_token(token), expected_hash)


def launch_token_hash_for_job(
    job_id: str, settings: Optional[PlatformSettings] = None
) -> str:
    return hash_launch_token(launch_token_for_job(job_id, settings))


def body_with_launch_token(
    body: Mapping[str, Any],
    job_id: str,
    settings: Optional[PlatformSettings] = None,
) -> dict[str, Any]:
    """A copy of a stored ``request_body`` with ``qym_launch.token`` filled in.

    For the dispatcher, in memory, right before submitting. The result must not be
    persisted or logged.
    """
    out = copy.deepcopy(dict(body))
    evaluator = out.setdefault("evaluator", {})
    config = evaluator.setdefault("config", {})
    metadata = config.setdefault("run_metadata", {})
    launch = dict(metadata.get("qym_launch") or {})
    launch["job_id"] = job_id
    launch["token"] = launch_token_for_job(job_id, settings)
    metadata["qym_launch"] = launch
    return out


# --------------------------------------------------------------------------- lineage


def job_launch_info(job: EvalExperimentJob) -> dict[str, Any]:
    """``qym_launch`` of the stored body (never contains the token)."""
    body = job.request_body if isinstance(job.request_body, Mapping) else {}
    launch = (
        (((body.get("evaluator") or {}).get("config") or {}).get("run_metadata") or {})
    ).get("qym_launch")
    return dict(launch) if isinstance(launch, Mapping) else {}


def superseded_job_ids(jobs: Iterable[EvalExperimentJob]) -> set[str]:
    """Jobs that were retried (a newer attempt points at them)."""
    return {j.retry_of_job_id for j in jobs if j.retry_of_job_id}


# --------------------------------------------------------------------------- status


def aggregate_status(
    statuses: Sequence[EvalJobStatus],
) -> EvalExperimentStatus:
    """Experiment status from its current (non-superseded) jobs (plan §4.5)."""
    if not statuses:
        return EvalExperimentStatus.QUEUED
    if any(s not in TERMINAL_JOB_STATUSES for s in statuses):
        if any(s in _ACTIVE_STATUSES for s in statuses) or any(
            s in TERMINAL_JOB_STATUSES for s in statuses
        ):
            return EvalExperimentStatus.RUNNING
        return EvalExperimentStatus.QUEUED
    succeeded = sum(1 for s in statuses if s == EvalJobStatus.SUCCEEDED)
    cancelled = sum(1 for s in statuses if s == EvalJobStatus.CANCELLED)
    if succeeded == len(statuses):
        return EvalExperimentStatus.COMPLETED
    if succeeded:
        return EvalExperimentStatus.PARTIAL
    if cancelled == len(statuses):
        return EvalExperimentStatus.CANCELLED
    return EvalExperimentStatus.FAILED


def current_jobs(jobs: Sequence[EvalExperimentJob]) -> list[EvalExperimentJob]:
    superseded = superseded_job_ids(jobs)
    return [j for j in jobs if j.id not in superseded]


def recompute_experiment_status(
    db: Session, experiment: EvalExperiment
) -> EvalExperimentStatus:
    """Refresh ``experiment.status`` from its jobs (caller commits)."""
    jobs = (
        db.query(EvalExperimentJob)
        .filter(EvalExperimentJob.experiment_id == experiment.id)
        .all()
    )
    status = aggregate_status([j.status for j in current_jobs(jobs)])
    experiment.status = status
    return status


# --------------------------------------------------------------------------- cancel

CANCELLED = "cancelled"
CANCELLING = "cancelling"
ALREADY_TERMINAL = "already_terminal"


def _lease_free(now: datetime):
    return or_(
        EvalExperimentJob.lease_owner.is_(None),
        EvalExperimentJob.lease_until.is_(None),
        EvalExperimentJob.lease_until < now,
    )


def _guarded_update(
    db: Session, job_id: str, conditions: Sequence[Any], values: Mapping[str, Any]
) -> bool:
    """``UPDATE`` one job if ``conditions`` still hold; True when a row changed."""
    result = cast(
        CursorResult,
        db.execute(
            update(EvalExperimentJob)
            .where(EvalExperimentJob.id == job_id, *conditions)
            .values(**values)
            .execution_options(synchronize_session=False)
        ),
    )
    return bool(result.rowcount)


def cancel_job(
    db: Session,
    job: EvalExperimentJob,
    *,
    user_id: Optional[str],
    reason: Optional[str] = None,
) -> str:
    """Cancel one job (plan §13.1). Returns ``cancelled``/``cancelling``/``already_terminal``.

    Guarded ``UPDATE``s make this safe against a dispatcher claiming the job
    concurrently. Permission checks are the caller's; the caller commits and
    recomputes the experiment status.
    """
    now = utc_now_naive()
    status = EvalExperimentJob.status
    fields = {
        "cancel_requested_at": now,
        "cancelled_by_user_id": user_id,
        "cancel_reason": reason,
        "updated_at": now,
    }
    try:
        # 1. Not submitted and nobody holds the lease: cancel locally.
        if _guarded_update(
            db,
            job.id,
            [status.in_(LOCAL_CANCEL_STATUSES), _lease_free(now)],
            {
                "status": EvalJobStatus.CANCELLED,
                "finished_at": now,
                "wait_reason": None,
                "next_attempt_at": None,
                **fields,
            },
        ):
            return CANCELLED
        # 2. A remote job exists: the dispatcher cancels it on its next tick.
        if _guarded_update(
            db,
            job.id,
            [status.in_(REMOTE_CANCEL_STATUSES)],
            {"status": EvalJobStatus.CANCELLING, **fields},
        ):
            return CANCELLING
        # 3. Being submitted right now (lease held, or the SUBMITTING crash marker):
        # the dispatcher checks cancel_requested_at right after the service accepts
        # the job. Otherwise the job is terminal or already cancelling.
        _guarded_update(
            db,
            job.id,
            [
                status.in_((*LOCAL_CANCEL_STATUSES, EvalJobStatus.SUBMITTING)),
                EvalExperimentJob.cancel_requested_at.is_(None),
            ],
            fields,
        )
    finally:
        db.refresh(job)
    return ALREADY_TERMINAL if job.status in TERMINAL_JOB_STATUSES else CANCELLING
