"""The submitting user's qym API key for Evaluation Service jobs (``qym_api_key``).

``POST /evals`` takes a top-level ``qym_api_key``: a platform API key of the user who
submits the job (the same user as ``user_id``), scoped to the target project. The
service's worker uses it as the SDK's ``QYM_API_KEY`` when it uploads the run, so the
run is created by that user in that project.

The submitting user is the experiment's **creator** (``user_id`` in the stored body),
for every job and every retry, whoever clicked retry.

Lifecycle, one dedicated key per experiment:

- **Mint** at launch (never for a dry run): ``issue_experiment_api_key`` creates an
  ``ApiKey`` owned by the creator in the experiment's project, named
  ``Evaluation Service · <experiment name>``, with ``SUBMITTER_KEY_SCOPES``. The token
  comes from ``security.generate_api_key`` (same format as project keys). Only its
  PBKDF2 hash is in ``api_keys``; the raw token is kept Fernet-encrypted in
  ``eval_experiments.qym_api_key_encrypted`` (``secrets.encrypt_llm_api_key``, so
  key rotation and ``tools/reencrypt_llm_keys`` apply). It is never returned by any
  API, logged, or written to ``request_body``/``remote_result``.
- **Use** at dispatch: ``resolve_submitter_key`` decrypts it in memory for the
  dispatcher, which adds it to the body next to the launch token. A missing, revoked
  or unreadable key, or a creator who is gone, disabled or no longer in the project,
  raises ``SubmitterKeyUnavailable`` and the job is ``BLOCKED`` with its reason.
- **Revoke** when the experiment settles (``revoke_key_when_settled``, called by
  ``eval_experiments.recompute_experiment_status``): once every current job is
  terminal (``BLOCKED`` doesn't count: it may be retried and its upload must still
  work), ``api_keys.revoked_at`` is set and the blob cleared.
- **Retry** (``ensure_key_for_retry``): a usable key is re-encrypted into a fresh
  blob; a revoked or unusable one is replaced by a newly minted key.

Races. The settle clears the blob with ``UPDATE … WHERE qym_api_key_encrypted =
<blob it saw>``, and revokes only if that matched. A retry always writes a *new* blob
with the same guard, so exactly one of a concurrent settle and retry wins: either the
retry keeps the key alive (the settle's guard misses), or the settle revokes it and
the retry, whose guard then misses, mints a new one. Both update the experiment row
before ``api_keys``, so the lock order is the same.
"""

from __future__ import annotations

import logging
from typing import Any, Optional, Sequence, cast

from sqlalchemy import CursorResult, update
from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.attributes import set_committed_value

from ..datetime_utils import utc_now_naive
from ..db.models import (
    ApiKey,
    EvalExperiment,
    EvalExperimentJob,
    ProjectMembership,
    User,
    UserRole,
)
from ..secrets import decrypt_llm_api_key, encrypt_llm_api_key
from ..security import api_key_prefix, generate_api_key
from ..settings import PlatformSettings

logger = logging.getLogger(__name__)

# What the SDK needs to create a run and stream its events (``POST /v1/runs``,
# ``POST /v1/runs/{id}/events``). Scopes aren't enforced today (auth.py); these are
# recorded so the key stays minimal if enforcement comes back.
SUBMITTER_KEY_SCOPES = ("runs:write",)
KEY_NAME_PREFIX = "Evaluation Service · "
KEY_NAME_MAX = 200  # api_keys.name

KEY_UNAVAILABLE = (
    "The submitting user's qym API key is unavailable; retry to issue a new one"
)
CREATOR_MISSING = (
    "The experiment's creator no longer exists; clone the experiment to launch it "
    "again"
)
CREATOR_NOT_MEMBER = (
    "The experiment's creator is no longer an active member of this project; clone "
    "the experiment to launch it as yourself"
)


class SubmitterKeyUnavailable(RuntimeError):
    """The job can't be submitted as its creator; ``str(exc)`` is the wait reason."""


def key_name(experiment_name: Optional[str]) -> str:
    """``Evaluation Service · <name>``, truncated to fit ``api_keys.name``."""
    name = KEY_NAME_PREFIX + (experiment_name or "").strip()
    if len(name) <= KEY_NAME_MAX:
        return name
    return name[: KEY_NAME_MAX - 1] + "…"


def creator_can_submit(db: Session, experiment: EvalExperiment) -> Optional[str]:
    """``None`` when the creator may still act in the project, else the reason.

    Mirrors ``permissions.has_project_access``: an active user who is a member of the
    project, or an admin.
    """
    creator_id = experiment.created_by_user_id
    user = db.get(User, creator_id) if creator_id else None
    if user is None:
        return CREATOR_MISSING
    if not user.is_active:
        return CREATOR_NOT_MEMBER
    if user.role == UserRole.ADMIN:
        return None
    member = (
        db.query(ProjectMembership.user_id)
        .filter(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == experiment.project_id,
        )
        .first()
    )
    return None if member is not None else CREATOR_NOT_MEMBER


def _mint(
    db: Session, experiment: EvalExperiment, settings: Optional[PlatformSettings]
) -> tuple[ApiKey, str]:
    """A new key row for the creator (flushed) and its encrypted token."""
    if not experiment.created_by_user_id:
        raise SubmitterKeyUnavailable(CREATOR_MISSING)
    token, prefix, key_hash = generate_api_key()
    try:
        blob = encrypt_llm_api_key(token, settings)
    finally:
        del token
    row = ApiKey(
        user_id=experiment.created_by_user_id,
        project_id=experiment.project_id,
        name=key_name(experiment.name),
        prefix=prefix,
        key_hash=key_hash,
        scopes=list(SUBMITTER_KEY_SCOPES),
        created_at=utc_now_naive(),
    )
    db.add(row)
    db.flush()
    return row, blob


def issue_experiment_api_key(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> ApiKey:
    """Mint the experiment's key at launch (the experiment is new: no race). Flushes."""
    row, blob = _mint(db, experiment, settings)
    experiment.qym_api_key_id = row.id
    experiment.qym_api_key_encrypted = blob
    db.flush()
    return row


def _usable_token(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> Optional[str]:
    """The decrypted key if it is the creator's live key for this project, else None."""
    blob = experiment.qym_api_key_encrypted
    if not blob or not experiment.qym_api_key_id:
        return None
    row = db.get(ApiKey, experiment.qym_api_key_id)
    if (
        row is None
        or row.revoked_at is not None
        or row.user_id != experiment.created_by_user_id
        or row.project_id != experiment.project_id
    ):
        return None
    try:
        token = decrypt_llm_api_key(blob, settings)
    except Exception:  # noqa: BLE001 - never surface key material
        return None
    if api_key_prefix(token) != row.prefix:
        return None
    return token


def resolve_submitter_key(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> str:
    """The raw ``qym_api_key`` for a submit, in memory only.

    Raises ``SubmitterKeyUnavailable`` (its message is the job's wait reason) when the
    creator can't act in the project any more or the key is missing, revoked or
    unreadable. Never store, log or return the result.
    """
    problem = creator_can_submit(db, experiment)
    if problem:
        raise SubmitterKeyUnavailable(problem)
    token = _usable_token(db, experiment, settings)
    if token is None:
        raise SubmitterKeyUnavailable(KEY_UNAVAILABLE)
    return token


def _guarded_set(
    db: Session, experiment_id: str, seen_blob: Optional[str], values: dict[str, Any]
) -> bool:
    """``UPDATE`` the key columns only if the blob is still ``seen_blob``."""
    blob = EvalExperiment.qym_api_key_encrypted
    guard = blob.is_(None) if seen_blob is None else blob == seen_blob
    result = cast(
        CursorResult,
        db.execute(
            update(EvalExperiment)
            .where(EvalExperiment.id == experiment_id, guard)
            .values(**values)
            .execution_options(synchronize_session=False)
        ),
    )
    return bool(result.rowcount)


def _revoke(db: Session, key_id: Optional[str]) -> bool:
    if not key_id:
        return False
    result = cast(
        CursorResult,
        db.execute(
            update(ApiKey)
            .where(ApiKey.id == key_id, ApiKey.revoked_at.is_(None))
            .values(revoked_at=utc_now_naive())
            .execution_options(synchronize_session=False)
        ),
    )
    return bool(result.rowcount)


def ensure_key_for_retry(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> None:
    """Keep the experiment's key alive for a retry, or mint a new one. Flushes.

    A usable key is re-encrypted into a fresh blob (a settle racing this retry then
    misses its guard and doesn't revoke it). A revoked, missing or unreadable key is
    replaced by a new one; a live but unreadable old key is revoked unless a job may
    still be uploading with it. The caller checks ``creator_can_submit`` first and
    commits.
    """
    db.flush()
    seen = experiment.qym_api_key_encrypted
    token = _usable_token(db, experiment, settings)
    if token is not None:
        try:
            fresh = encrypt_llm_api_key(token, settings)
        finally:
            del token
        if _guarded_set(db, experiment.id, seen, {"qym_api_key_encrypted": fresh}):
            set_committed_value(experiment, "qym_api_key_encrypted", fresh)
            return
        # A concurrent settle revoked it meanwhile: mint below.
    db.refresh(experiment, ["qym_api_key_id", "qym_api_key_encrypted"])
    seen = experiment.qym_api_key_encrypted
    old_id = experiment.qym_api_key_id
    row, blob = _mint(db, experiment, settings)
    if not _guarded_set(
        db,
        experiment.id,
        seen,
        {"qym_api_key_id": row.id, "qym_api_key_encrypted": blob},
    ):
        # Another retry minted first: keep theirs, drop ours.
        _revoke(db, row.id)
        db.refresh(experiment, ["qym_api_key_id", "qym_api_key_encrypted"])
        return
    set_committed_value(experiment, "qym_api_key_id", row.id)
    set_committed_value(experiment, "qym_api_key_encrypted", blob)
    if old_id and old_id != row.id and not _has_live_jobs(db, experiment.id):
        _revoke(db, old_id)


def _has_live_jobs(db: Session, experiment_id: str) -> bool:
    """Whether a job may still upload with the experiment's current key."""
    from .eval_experiments import ACTIVE_JOB_STATUSES  # avoid an import cycle

    return (
        db.query(EvalExperimentJob.id)
        .filter(
            EvalExperimentJob.experiment_id == experiment_id,
            EvalExperimentJob.status.in_(tuple(ACTIVE_JOB_STATUSES)),
        )
        .first()
        is not None
    )


def revoke_key_when_settled(
    experiment: EvalExperiment, current: Sequence[EvalExperimentJob], terminal: Any
) -> bool:
    """Revoke the key once every current job is in ``terminal``. Caller commits.

    ``current`` are the experiment's non-superseded jobs. ``BLOCKED`` is not terminal
    here: a blocked job may be retried, and its run upload needs the key. Guarded like
    ``clear_secrets_when_settled`` (see the module docstring). Returns True when the
    key was revoked.
    """
    seen = experiment.qym_api_key_encrypted
    if not seen:
        return False
    if not current or any(job.status not in terminal for job in current):
        return False
    key_id = experiment.qym_api_key_id
    session = object_session(experiment)
    if session is None:
        return False
    session.flush()
    if not _guarded_set(session, experiment.id, seen, {"qym_api_key_encrypted": None}):
        return False
    set_committed_value(experiment, "qym_api_key_encrypted", None)
    _revoke(session, key_id)
    _forget_verified_keys()
    logger.info("eval experiment %s: settled; revoked its qym API key", experiment.id)
    return True


def _forget_verified_keys() -> None:
    """Drop ``auth``'s verification cache (revocation is also checked per request)."""
    try:
        from ..auth import clear_api_key_cache
    except Exception:  # noqa: BLE001 - auth unavailable (e.g. a bare tool process)
        return
    clear_api_key_cache()


__all__ = (
    "CREATOR_MISSING",
    "CREATOR_NOT_MEMBER",
    "KEY_NAME_PREFIX",
    "KEY_UNAVAILABLE",
    "SUBMITTER_KEY_SCOPES",
    "SubmitterKeyUnavailable",
    "creator_can_submit",
    "ensure_key_for_retry",
    "issue_experiment_api_key",
    "key_name",
    "resolve_submitter_key",
    "revoke_key_when_settled",
)
