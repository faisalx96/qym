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

Key rotation: rotating ``QYM_LLM_CONFIG_ENCRYPTION_KEY`` changes every derived token.
The old key goes into ``QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS``, and the dispatcher
passes the job's stored ``launch_token_hash`` as ``expected_hash``: the token is derived
with the current key, and if its hash doesn't match, with each previous key (constant
time), so a job created before the rotation and submitted after it still sends the token
ingest expects and links as ``official``. Ingest needs no change: it only hashes what
it receives. If no configured key matches (the old key was already dropped), the
current-key token is sent, a warning is logged (job id only), and the run is ingested as
``local``. Keep the previous key configured until no job created before the rotation is
still waiting to be submitted.

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

Cancellation (plan §13.1) is ``cancel_jobs`` (per-job permission, audit, linked run,
aggregate status) over ``cancel_job`` (the guarded state change): queued/blocked jobs
without a live lease are cancelled locally; otherwise ``cancel_requested_at`` is set
(and submitted/running jobs move to ``CANCELLING``) so the dispatcher performs the
remote cancel on its next tick (``EvalDispatcher._step_cancel``).
"""

from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import logging
from datetime import datetime
from typing import (
    TYPE_CHECKING,
    Any,
    Iterable,
    Mapping,
    Optional,
    Sequence,
    Union,
    cast,
)

from sqlalchemy import CursorResult, and_, or_, select, update
from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.orm.util import identity_key

from ..datetime_utils import utc_now_naive
from ..db.models import (
    AuditLog,
    EvalExperiment,
    EvalExperimentJob,
    EvalExperimentStatus,
    EvalJobStatus,
    Run,
    RunWorkflowStatus,
)
from ..secrets import previous_encryption_keys
from ..settings import PlatformSettings
from .run_lifecycle import (
    RUN_STATUS_REASON_CANCELLED_FROM_QUEUE,
    RUN_STATUS_REASON_LEASE_TIMEOUT,
)

if TYPE_CHECKING:
    from ..auth import Principal

logger = logging.getLogger(__name__)

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


def _subkey_for_secret(secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), _TOKEN_KEY_LABEL, hashlib.sha256).digest()


def _token_subkey(settings: Optional[PlatformSettings] = None) -> bytes:
    secret = ((settings or PlatformSettings()).llm_config_encryption_key or "").strip()
    if not secret:
        raise LaunchTokenUnavailable(
            "Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY to be configured"
        )
    return _subkey_for_secret(secret)


def _token_with_subkey(subkey: bytes, job_id: str) -> str:
    digest = hmac.new(subkey, job_id.encode("utf-8"), hashlib.sha256).digest()
    return TOKEN_PREFIX + base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def launch_token_for_job(
    job_id: str,
    settings: Optional[PlatformSettings] = None,
    *,
    expected_hash: Optional[str] = None,
) -> str:
    """The raw one-time launch token of a job. Never store, log or return it.

    With ``expected_hash`` (the job's stored ``launch_token_hash``), a token whose
    hash doesn't match is re-derived with each key of
    ``QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS`` and the matching one is returned, so a
    key rotation between launch and submit doesn't turn the run ``local``.
    """
    runtime_settings = settings or PlatformSettings()
    current = _token_with_subkey(_token_subkey(runtime_settings), job_id)
    if not expected_hash or verify_launch_token(current, expected_hash):
        return current
    for secret in previous_encryption_keys(runtime_settings):
        candidate = _token_with_subkey(_subkey_for_secret(secret), job_id)
        if verify_launch_token(candidate, expected_hash):
            return candidate
    logger.warning(
        "eval job %s: launch_token_hash matches no configured encryption key; "
        "sending the current-key token (the run will be ingested as local)",
        job_id,
    )
    return current


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
    *,
    expected_hash: Optional[str] = None,
) -> dict[str, Any]:
    """A copy of a stored ``request_body`` with ``qym_launch.token`` filled in.

    For the dispatcher, in memory, right before submitting. The result must not be
    persisted or logged. ``expected_hash`` is the job's ``launch_token_hash`` (see
    ``launch_token_for_job``: it picks a previous key after a rotation).
    """
    out = copy.deepcopy(dict(body))
    evaluator = out.setdefault("evaluator", {})
    config = evaluator.setdefault("config", {})
    metadata = config.setdefault("run_metadata", {})
    launch = dict(metadata.get("qym_launch") or {})
    launch["job_id"] = job_id
    launch["token"] = launch_token_for_job(
        job_id, settings, expected_hash=expected_hash
    )
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
    db: Session, experiment: Union[EvalExperiment, str]
) -> Optional[EvalExperimentStatus]:
    """Refresh ``experiment.status`` from its jobs (flushes, caller commits).

    ``experiment`` is the row or its id; returns None when the id is unknown. The one
    aggregate rule (``aggregate_status``) for the API, the queue and the dispatcher.

    On Postgres the experiment row is locked first (``FOR NO KEY UPDATE``, reloaded),
    so transactions settling sibling jobs recompute one after another and each one
    reads the jobs the previous one committed. Without the lock, two transactions
    finishing the last two jobs at once (two dispatcher pods, or a queue cancel and a
    dispatcher settle) each saw the other's job still running under READ COMMITTED,
    and the experiment stayed ``RUNNING`` forever (#40). SQLite serializes writers.

    Lock order: callers lock (or ``UPDATE``) their job rows, then the environment or
    run rows they touch, and only then call this, which locks the experiment row
    last. ``NO KEY UPDATE`` still lets other transactions insert jobs (a foreign-key
    ``KEY SHARE`` lock) while the row is held.
    """
    experiment_id = experiment if isinstance(experiment, str) else experiment.id
    db.flush()
    if _is_postgres(db):
        row = db.execute(
            select(EvalExperiment)
            .where(EvalExperiment.id == experiment_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
    elif isinstance(experiment, str):
        row = db.get(EvalExperiment, experiment_id)
    else:
        row = experiment
    if row is None:
        return None
    jobs = (
        db.query(EvalExperimentJob)
        .filter(EvalExperimentJob.experiment_id == row.id)
        .all()
    )
    status = aggregate_status([j.status for j in current_jobs(jobs)])
    if row.status != status:
        row.status = status
    clear_secrets_when_settled(row, jobs)
    return status


def _is_postgres(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


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

# ``cancel_jobs`` outcomes, per job id (plan §13.1).
CANCELLED = "cancelled"
CANCELLING = "cancelling"
ALREADY_TERMINAL = "already_terminal"
FORBIDDEN = "forbidden"
NOT_FOUND = "not_found"  # unknown id, or a job of another project
CANCELLING_WAIT_REASON = "Cancelling"


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
        local = [status.in_(LOCAL_CANCEL_STATUSES), _lease_free(now)]
        local_values = {
            "status": EvalJobStatus.CANCELLED,
            "finished_at": now,
            "wait_reason": None,
            "next_attempt_at": None,
            **fields,
        }
        remote_values = {
            "status": EvalJobStatus.CANCELLING,
            "wait_reason": CANCELLING_WAIT_REASON,
            "next_attempt_at": now,
            **fields,
        }
        # 1. Not submitted and nobody holds the lease: cancel locally.
        if _guarded_update(db, job.id, local, local_values):
            return CANCELLED
        # 2. A remote job exists: the dispatcher cancels it on its next tick (due now).
        if _guarded_update(
            db,
            job.id,
            [status.in_(REMOTE_CANCEL_STATUSES)],
            remote_values,
        ):
            return CANCELLING
        # 3. Being submitted right now (lease held, or the SUBMITTING crash marker):
        # the dispatcher checks cancel_requested_at before and right after the submit.
        # Otherwise the job is terminal or already cancelling.
        _guarded_update(
            db,
            job.id,
            [
                status.in_((*LOCAL_CANCEL_STATUSES, EvalJobStatus.SUBMITTING)),
                EvalExperimentJob.cancel_requested_at.is_(None),
            ],
            fields,
        )
        # 4. The dispatcher may have released the lease between 1 and 3 (e.g. it
        # blocked or deferred the job): nothing would pick the request up from a
        # BLOCKED job, so cancel locally now if that is possible.
        if _guarded_update(db, job.id, local, local_values):
            return CANCELLED
        # 5. The submit finished between 2 and 3 (SUBMITTING -> SUBMITTED/RUNNING, so
        # 3 matched nothing; on Postgres 3 may have waited for that very commit): the
        # remote job exists now, so cancel it remotely as in 2.
        if _guarded_update(
            db,
            job.id,
            [
                status.in_(REMOTE_CANCEL_STATUSES),
                EvalExperimentJob.cancel_requested_at.is_(None),
            ],
            remote_values,
        ):
            return CANCELLING
    finally:
        db.refresh(job)
    return ALREADY_TERMINAL if job.status in TERMINAL_JOB_STATUSES else CANCELLING


def stop_linked_run(
    db: Session, job: EvalExperimentJob, *, now: Optional[datetime] = None
) -> bool:
    """Mark the job's linked run ``STOPPED`` / ``cancelled_from_queue`` (plan §13.1).

    A cancelled worker is killed and never sends a terminal event, so the run would
    stay ``RUNNING``. Only a run without a terminal event is touched (``PENDING``,
    ``RUNNING``, or a lease-timeout ``STOPPED`` that would otherwise reopen); the
    ``UPDATE`` is guarded so a run finished concurrently by ingest keeps its outcome.
    Later events cannot reopen it (``run_lifecycle.mark_run_*``). Caller commits.
    """
    run_id = job.run_id or db.scalar(
        select(Run.id).where(Run.experiment_job_id == job.id).limit(1)
    )
    if not run_id:
        return False
    # The dashboard outbox hook expires the session around a bulk UPDATE of runs:
    # flush first so pending changes (e.g. the job's new status) are not discarded.
    db.flush()
    result = cast(
        CursorResult,
        db.execute(
            update(Run)
            .where(
                Run.id == run_id,
                or_(
                    Run.status.in_(
                        (RunWorkflowStatus.PENDING, RunWorkflowStatus.RUNNING)
                    ),
                    and_(
                        Run.status == RunWorkflowStatus.STOPPED,
                        Run.status_reason == RUN_STATUS_REASON_LEASE_TIMEOUT,
                    ),
                ),
            )
            .values(
                status=RunWorkflowStatus.STOPPED,
                status_reason=RUN_STATUS_REASON_CANCELLED_FROM_QUEUE,
                ended_at=now or utc_now_naive(),
            )
            .execution_options(synchronize_session=False)
        ),
    )
    stopped = bool(result.rowcount)
    if stopped:
        run = db.identity_map.get(identity_key(Run, run_id))
        if run is not None:
            db.expire(run)
    return stopped


def can_control_experiment(
    db: Session, principal: "Principal", experiment: EvalExperiment
) -> bool:
    """Cancel/retry: the experiment's creator or a project manager (plan §14)."""
    from ..permissions import is_project_manager  # avoid an import cycle

    creator = experiment.created_by_user_id
    if creator and creator == principal.user.id:
        return True
    return is_project_manager(db, principal, experiment.project_id)


def cancel_jobs(
    db: Session,
    job_ids: Sequence[str],
    principal: "Principal",
    reason: Optional[str] = None,
    *,
    project_id: Optional[str] = None,
) -> dict[str, str]:
    """Cancel several jobs, each on its own permission (plan §13.1).

    The one cancel service behind the experiment cancel endpoints and the queue API.
    Per id: ``forbidden`` unless the caller created the job's experiment or manages
    its project; otherwise ``cancel_job`` (``cancelled`` for queued/blocked jobs
    without a live lease, ``cancelling`` when the dispatcher must cancel remotely or
    is submitting the job right now, ``already_terminal``). Ids that don't exist, or
    belong to another project when ``project_id`` is given, are ``not_found``.

    A job cancelled here gets its linked run stopped (``stop_linked_run``), one
    ``AuditLog`` entry is written per job that was cancelled or is cancelling, and
    every touched experiment's aggregate status is recomputed. Caller commits.
    """
    ids = list(dict.fromkeys(job_ids))
    query = (
        db.query(EvalExperimentJob, EvalExperiment)
        .join(EvalExperiment, EvalExperiment.id == EvalExperimentJob.experiment_id)
        .filter(EvalExperimentJob.id.in_(ids))
    )
    if project_id is not None:
        query = query.filter(EvalExperiment.project_id == project_id)
    found = {job.id: (job, experiment) for job, experiment in query.all()}
    allowed: dict[str, bool] = {}
    touched: dict[str, EvalExperiment] = {}
    outcomes: dict[str, str] = {}
    # Rows are locked in id order (jobs, then experiments) so two concurrent bulk
    # cancels over the same jobs cannot deadlock; outcomes keep the caller's order.
    for job_id in sorted(ids):
        pair = found.get(job_id)
        if pair is None:
            outcomes[job_id] = NOT_FOUND
            continue
        job, experiment = pair
        if experiment.id not in allowed:
            allowed[experiment.id] = can_control_experiment(db, principal, experiment)
        if not allowed[experiment.id]:
            outcomes[job_id] = FORBIDDEN
            continue
        outcome = cancel_job(db, job, user_id=principal.user.id, reason=reason)
        outcomes[job_id] = outcome
        if outcome == ALREADY_TERMINAL:
            continue
        if outcome == CANCELLED:
            stop_linked_run(db, job)
        touched[experiment.id] = experiment
        db.add(
            AuditLog(
                actor_user_id=principal.user.id,
                action="eval_job.cancel",
                entity_type="eval_experiment_job",
                entity_id=job.id,
                before={},
                after={
                    "outcome": outcome,
                    "reason": reason,
                    "experiment_id": experiment.id,
                    "status": job.status.value,
                },
            )
        )
    # Last, after every job and run row: the dispatcher's order (job, environment or
    # run, experiment), so a cancel racing a dispatcher settle cannot deadlock.
    for experiment_id in sorted(touched):
        recompute_experiment_status(db, touched[experiment_id])
    return {job_id: outcomes[job_id] for job_id in ids}
