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

Run metadata (plan §10.1). Every job's body carries two reserved
``evaluator.config.run_metadata`` keys, which the SDK copies into ``runs.run_metadata``:
``qym_launch`` (``build_qym_launch``) and ``qym_config`` (``build_qym_config``), the §8.1
document of the job's combination with sweeps resolved. ``qym_config`` is secret-free:
connection bindings keep ``{connection_id, name, model}`` and every secret ref
(``{"$secret": ref}``, e.g. a temporary model's key) becomes
``{"$secret": "redacted"}`` (``redact_secret_refs``), so the run page can show the
config without the job row.

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
from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.attributes import set_committed_value

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
# In flight: occupies a slot on its environment (the dispatcher's inflight cap).
ACTIVE_JOB_STATUSES = frozenset(
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


# --------------------------------------------------------------------------- run metadata

SECRET_REF_KEY = "$secret"
REDACTED_SECRET_REF = "redacted"
# Literal values under these keys are masked in ``qym_config`` (defence in depth: the
# document validator already rejects literal secrets).
_SECRET_KEY_NAMES = frozenset(
    {"api_key", "apikey", "authorization", "password", "secret", "token"}
)
_SECRET_KEY_SUFFIXES = ("_api_key", "_apikey", "_password", "_secret", "_token")
_MASKED = "[REDACTED]"
_PLACEHOLDER_PREFIX = "{{qym:slot:"


def is_secret_ref(value: Any) -> bool:
    """``{"$secret": ref}``: how specs reference an experiment secret (#12)."""
    return isinstance(value, Mapping) and SECRET_REF_KEY in value


def _is_secret_key(key: Any) -> bool:
    name = str(key).lower().replace("-", "_")
    return name in _SECRET_KEY_NAMES or name.endswith(_SECRET_KEY_SUFFIXES)


def redact_secret_refs(value: Any) -> Any:
    """A copy with every ``{"$secret": ref}`` replaced by ``{"$secret": "redacted"}``.

    Generic over where refs appear (bindings, overrides, lists). Literal strings under
    secret-looking keys (``api_key``, ``*_token``…) are masked too; slot placeholders
    (``{{qym:slot:…}}``) are kept, they are not secrets.
    """
    if is_secret_ref(value):
        return {SECRET_REF_KEY: REDACTED_SECRET_REF}
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, child in value.items():
            if (
                _is_secret_key(key)
                and isinstance(child, str)
                and child
                and not child.startswith(_PLACEHOLDER_PREFIX)
            ):
                out[key] = _MASKED
            else:
                out[key] = redact_secret_refs(child)
        return out
    if isinstance(value, list):
        return [redact_secret_refs(v) for v in value]
    return copy.deepcopy(value)


def display_binding(binding: Any, resolved: Optional[Mapping[str, Any]] = None) -> Any:
    """A slot binding as ``qym_config`` shows it: never a key.

    ``connection`` → ``{connection_id, name, model}`` (``resolved`` carries the current
    name and model, as in ``eval_bindings`` ``resolution.models``); ``temporary`` →
    ``{"temporary": {label, model, base_url[, api_key: {"$secret": "redacted"}]}}``;
    inherit/``None`` → ``None``.
    """
    if binding is None:
        return None
    if not isinstance(binding, Mapping):
        return redact_secret_refs(binding)
    if set(binding) == {"inherit"} and binding["inherit"] is True:
        return None
    resolved = resolved or {}
    if "connection_id" in binding and "temporary" not in binding:
        return {
            "connection_id": binding.get("connection_id"),
            "name": resolved.get("name") or binding.get("name"),
            "model": resolved.get("model") or binding.get("model"),
        }
    if "temporary" in binding and "connection_id" not in binding:
        raw = binding.get("temporary")
        temporary: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
        shown: dict[str, Any] = {
            key: temporary[key]
            for key in ("label", "model", "base_url")
            if key in temporary
        }
        if temporary.get("api_key") is not None:
            shown["api_key"] = {SECRET_REF_KEY: REDACTED_SECRET_REF}
        return {"temporary": redact_secret_refs(shown)}
    return redact_secret_refs(binding)


def display_bindings(
    bindings: Any, models: Optional[Mapping[str, Mapping[str, Any]]] = None
) -> dict[str, Any]:
    """``display_binding`` for every slot."""
    if not isinstance(bindings, Mapping):
        return {}
    models = models or {}
    return {
        key: display_binding(binding, models.get(key))
        for key, binding in bindings.items()
    }


def build_qym_config(
    document: Mapping[str, Any],
    *,
    schema_hash: Optional[str],
    base_source: Optional[Mapping[str, Any]],
    models: Optional[Mapping[str, Mapping[str, Any]]] = None,
    sweep: Optional[Mapping[str, Any]] = None,
) -> dict[str, Any]:
    """``run_metadata.qym_config``: the §8.1 document of one combination (§10.1).

    ``document`` is one combination (sweeps resolved by ``eval_sweeps.expand``).
    ``models`` maps slot keys to the resolved connection ``{name, model}``; ``sweep``
    is the combination's ``{pointer: value}`` (job ``params["sweep"]``), included so
    the run shows which values were swept. The result is secret-free.
    """
    evaluator = document.get("evaluator")
    overrides = document.get("env_overrides")
    config = {
        "schema_hash": schema_hash,
        "base_source": dict(base_source) if base_source else {"kind": "blank"},
        "evaluator": dict(evaluator) if isinstance(evaluator, Mapping) else {},
        "slot_bindings": display_bindings(document.get("slot_bindings"), models),
        "env_overrides": dict(overrides) if isinstance(overrides, Mapping) else {},
    }
    if sweep:
        config["sweep"] = dict(sweep)
    return redact_secret_refs(config)


def build_qym_launch(
    *,
    experiment_id: str,
    job_id: str,
    environment_id: str,
    combo_index: int,
    attempt: int = 0,
    retry_of_job_id: Optional[str] = None,
) -> dict[str, Any]:
    """``run_metadata.qym_launch`` as stored: the token is only added at dispatch."""
    launch: dict[str, Any] = {
        "experiment_id": experiment_id,
        "job_id": job_id,
        "environment_id": environment_id,
        "combo_index": combo_index,
        "attempt": attempt,
    }
    if retry_of_job_id:
        launch["retry_of_job_id"] = retry_of_job_id
    return launch


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


def aggregate_status(statuses: Iterable[EvalJobStatus]) -> EvalExperimentStatus:
    """Experiment status from its current (non-superseded) job statuses (plan §4.5).

    The single implementation, used by the API, the queue and the dispatcher:

    - no jobs, or every job ``QUEUED`` → ``QUEUED``;
    - any job in flight (``SUBMITTING``/``SUBMITTED``/``RUNNING``/``CANCELLING``) →
      ``RUNNING``; so is a mix of ``QUEUED`` jobs and jobs that have moved on;
    - otherwise every job has *settled* (terminal, or ``BLOCKED``: nothing more is
      dispatched without a user action) → ``COMPLETED`` (all succeeded),
      ``CANCELLED`` (all cancelled), ``PARTIAL`` (some succeeded) or ``FAILED``.
      ``BLOCKED`` counts as not succeeded.
    """
    items = [EvalJobStatus(s) for s in statuses]
    if not items:
        return EvalExperimentStatus.QUEUED
    if any(s in ACTIVE_JOB_STATUSES for s in items):
        return EvalExperimentStatus.RUNNING
    if any(s == EvalJobStatus.QUEUED for s in items):
        if all(s == EvalJobStatus.QUEUED for s in items):
            return EvalExperimentStatus.QUEUED
        return EvalExperimentStatus.RUNNING
    if all(s == EvalJobStatus.CANCELLED for s in items):
        return EvalExperimentStatus.CANCELLED
    succeeded = sum(1 for s in items if s == EvalJobStatus.SUCCEEDED)
    if succeeded == len(items):
        return EvalExperimentStatus.COMPLETED
    if succeeded:
        return EvalExperimentStatus.PARTIAL
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
    if experiment.status != status:
        experiment.status = status
    clear_secrets_when_settled(experiment, jobs)
    return status


# Nothing more is dispatched from these without a user action; a retry asks for the
# temporary-model keys again (#12).
SETTLED_JOB_STATUSES = TERMINAL_JOB_STATUSES | {EvalJobStatus.BLOCKED}


def clear_secrets_when_settled(
    experiment: EvalExperiment, jobs: Sequence[EvalExperimentJob]
) -> bool:
    """Drop temporary-model keys once every current job has settled (plan §7.5).

    ``jobs`` are all of the experiment's rows; superseded attempts are ignored.
    Settled means terminal, or ``BLOCKED`` (only a retry, which asks for the key
    again, moves it on). Returns True when the keys were cleared. Caller commits.

    The ``UPDATE`` only clears the blob that was seen: a retry always writes a fresh
    blob, so a retry committed concurrently (e.g. while the dispatcher settles the
    last job) keeps its keys instead of losing them to this write.
    """
    seen = experiment.secrets_encrypted
    if not seen:
        return False
    current = current_jobs(list(jobs))
    if not current or any(j.status not in SETTLED_JOB_STATUSES for j in current):
        return False
    session = object_session(experiment)
    if session is None:
        experiment.secrets_encrypted = None
        return True
    session.flush()
    cleared = _guarded_experiment_update(
        session,
        experiment.id,
        [EvalExperiment.secrets_encrypted == seen],
        {"secrets_encrypted": None},
    )
    if cleared:
        set_committed_value(experiment, "secrets_encrypted", None)
    return cleared


def _guarded_experiment_update(
    db: Session,
    experiment_id: str,
    conditions: Sequence[Any],
    values: Mapping[str, Any],
) -> bool:
    result = cast(
        CursorResult,
        db.execute(
            update(EvalExperiment)
            .where(EvalExperiment.id == experiment_id, *conditions)
            .values(**values)
            .execution_options(synchronize_session=False)
        ),
    )
    return bool(result.rowcount)


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
