"""The experiment's dataset read token (``QYM_DATASET_READ_TOKEN``, guide v1.3 §4.3).

A worker that reads a private test set or a restricted dataset needs a *dataset read
token* (``services/dataset_read_tokens``). The platform mints one per experiment and
hands it to the Evaluation Service with the job, so a launcher who may name any dataset
of the project (owner decision D3: no launch gate) gets it read without an admin issuing
a deployment-wide token. The lifecycle mirrors ``eval_submitter_keys`` function by
function (read that module for the race analysis, it applies unchanged):

- **Mint** at launch (never for a dry run): :func:`issue_experiment_dataset_token`
  creates a ``DatasetReadToken`` (``kind = 'experiment'``) for the experiment's project,
  named ``Evaluation Service · <experiment name>``. Only its PBKDF2 hash is in
  ``dataset_read_tokens``; the raw token is kept Fernet-encrypted in
  ``eval_experiments.dataset_read_token_encrypted``. It is never returned by any API,
  logged, or written to ``request_body`` / ``remote_result``.
- **Scope**: full read of any dataset of the project on item reads (``token_grants_project``);
  it identifies no user and allows no write.
- **Use** at dispatch: :func:`resolve_dataset_token` decrypts it in memory, for a job
  whose stored schema declares ``QYM_DATASET_READ_TOKEN`` only (a service that does not
  know the key would answer 422).
- **Revoke** when the experiment settles (:func:`revoke_dataset_token_when_settled`, in
  the same transaction and with the same grace as the API key).
- **Retry** (:func:`ensure_dataset_token_for_retry`): a usable token is re-encrypted into
  a fresh blob; a revoked, missing or unreadable one is replaced by a new row. An
  experiment launched before this feature gets its token on the first retry.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional, Sequence, cast

from sqlalchemy import CursorResult, update
from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.attributes import set_committed_value

from ..datetime_utils import utc_now_naive
from ..db.models import AuditLog, DatasetReadToken, EvalExperiment, EvalExperimentJob
from ..log import get_logger
from ..secrets import decrypt_llm_api_key, encrypt_llm_api_key
from ..settings import PlatformSettings
from .dataset_read_tokens import TOKEN_PREFIX, clear_cache, generate_token
from .eval_submitter_keys import (
    KEY_NAME_MAX,
    KEY_NAME_PREFIX,
    KEY_REVOKE_GRACE,
    _has_live_jobs,
    settled_long_enough,
)

logger = get_logger(__name__)

# The key of the env-overrides schema that tells the service accepts the token.
TOKEN_ENV_KEY = "QYM_DATASET_READ_TOKEN"
KIND_EXPERIMENT = "experiment"

DATASET_TOKEN_UNAVAILABLE = (
    "The experiment's dataset read token is unavailable; retry to issue a new one"
)


class DatasetTokenUnavailable(RuntimeError):
    """The job can't get its dataset read token; ``str(exc)`` is the wait reason."""


def token_name(experiment_name: Optional[str]) -> str:
    """``Evaluation Service · <name>``, truncated to fit ``dataset_read_tokens.name``."""
    name = KEY_NAME_PREFIX + (experiment_name or "").strip()
    if len(name) <= KEY_NAME_MAX:
        return name
    return name[: KEY_NAME_MAX - 1] + "…"


def _audit(
    db: Session,
    experiment: EvalExperiment,
    action: str,
    after: dict[str, Any],
    actor_user_id: Optional[str] = None,
) -> None:
    """One audit row; ``after`` never holds the token."""
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            entity_type="eval_experiment",
            entity_id=experiment.id,
            before={},
            after={"experiment_id": experiment.id, **after},
        )
    )


def _mint(
    db: Session, experiment: EvalExperiment, settings: Optional[PlatformSettings]
) -> tuple[DatasetReadToken, str]:
    """A new token row for the experiment's project (flushed) and its encrypted blob."""
    if not experiment.created_by_user_id:
        raise DatasetTokenUnavailable(DATASET_TOKEN_UNAVAILABLE)
    token, prefix, token_hash = generate_token()
    try:
        blob = encrypt_llm_api_key(token, settings)
    finally:
        del token
    row = DatasetReadToken(
        project_id=experiment.project_id,
        name=token_name(experiment.name),
        prefix=prefix,
        token_hash=token_hash,
        created_by_user_id=experiment.created_by_user_id,
        created_at=utc_now_naive(),
        kind=KIND_EXPERIMENT,
        experiment_id=experiment.id,
    )
    db.add(row)
    db.flush()
    return row, blob


def issue_experiment_dataset_token(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> DatasetReadToken:
    """Mint the experiment's token at launch (the experiment is new: no race). Flushes."""
    row, blob = _mint(db, experiment, settings)
    experiment.dataset_read_token_id = row.id
    experiment.dataset_read_token_encrypted = blob
    _audit(
        db,
        experiment,
        "eval.dataset_token_issued",
        {"token_id": row.id},
        experiment.created_by_user_id,
    )
    db.flush()
    return row


def _usable_token(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> Optional[str]:
    """The decrypted token if it is a live token of the experiment's project, else None."""
    blob = experiment.dataset_read_token_encrypted
    if not blob or not experiment.dataset_read_token_id:
        return None
    row = db.get(DatasetReadToken, experiment.dataset_read_token_id)
    if (
        row is None
        or row.revoked_at is not None
        or row.project_id != experiment.project_id
    ):
        return None
    try:
        token = decrypt_llm_api_key(blob, settings)
    except Exception as exc:  # noqa: BLE001 - never surface token material
        logger.warning(
            "dataset read token %s could not be decrypted (%s)",
            row.id,
            type(exc).__name__,
        )
        return None
    if not token.startswith(TOKEN_PREFIX) or token[: len(row.prefix)] != row.prefix:
        return None
    return token


def has_dataset_token(experiment: EvalExperiment) -> bool:
    """Whether the experiment was launched with (or retried into) a token."""
    return experiment.dataset_read_token_id is not None


def resolve_dataset_token(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
) -> str:
    """The raw ``QYM_DATASET_READ_TOKEN`` for a submit, in memory only.

    Raises ``DatasetTokenUnavailable`` (its message is the job's wait reason) when the
    token is missing, revoked or unreadable. Never store, log or return the result.
    """
    token = _usable_token(db, experiment, settings)
    if token is None:
        raise DatasetTokenUnavailable(DATASET_TOKEN_UNAVAILABLE)
    return token


def _guarded_set(
    db: Session, experiment_id: str, seen_blob: Optional[str], values: dict[str, Any]
) -> bool:
    """``UPDATE`` the token columns only if the blob is still ``seen_blob``."""
    blob = EvalExperiment.dataset_read_token_encrypted
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


def revoke_token_row(db: Session, token_id: Optional[str]) -> bool:
    """Set ``revoked_at`` on a live token row; True when this call revoked it."""
    if not token_id:
        return False
    result = cast(
        CursorResult,
        db.execute(
            update(DatasetReadToken)
            .where(
                DatasetReadToken.id == token_id, DatasetReadToken.revoked_at.is_(None)
            )
            .values(revoked_at=utc_now_naive())
            .execution_options(synchronize_session=False)
        ),
    )
    revoked = bool(result.rowcount)
    if revoked:
        clear_cache()
    return revoked


def ensure_dataset_token_for_retry(
    db: Session,
    experiment: EvalExperiment,
    settings: Optional[PlatformSettings] = None,
    *,
    actor_user_id: Optional[str] = None,
) -> None:
    """Keep the experiment's token alive for a retry, or mint a new one. Flushes.

    Same rules as ``eval_submitter_keys.ensure_key_for_retry``; an experiment launched
    before the feature (no token at all) gets one here (decision D-B9). The caller
    commits.
    """
    db.flush()
    seen = experiment.dataset_read_token_encrypted
    token = _usable_token(db, experiment, settings)
    if token is not None:
        try:
            fresh = encrypt_llm_api_key(token, settings)
        finally:
            del token
        if _guarded_set(
            db, experiment.id, seen, {"dataset_read_token_encrypted": fresh}
        ):
            set_committed_value(experiment, "dataset_read_token_encrypted", fresh)
            return
        # A concurrent settle revoked it meanwhile: mint below.
    db.refresh(experiment, ["dataset_read_token_id", "dataset_read_token_encrypted"])
    seen = experiment.dataset_read_token_encrypted
    old_id = experiment.dataset_read_token_id
    row, blob = _mint(db, experiment, settings)
    if not _guarded_set(
        db,
        experiment.id,
        seen,
        {"dataset_read_token_id": row.id, "dataset_read_token_encrypted": blob},
    ):
        # Another retry minted first: keep theirs, drop ours.
        revoke_token_row(db, row.id)
        db.refresh(
            experiment, ["dataset_read_token_id", "dataset_read_token_encrypted"]
        )
        return
    set_committed_value(experiment, "dataset_read_token_id", row.id)
    set_committed_value(experiment, "dataset_read_token_encrypted", blob)
    _audit(
        db,
        experiment,
        "eval.dataset_token_issued",
        {"token_id": row.id},
        actor_user_id or experiment.created_by_user_id,
    )
    if old_id and old_id != row.id and not _has_live_jobs(db, experiment.id):
        revoke_token_row(db, old_id)


def revoke_dataset_token_when_settled(
    experiment: EvalExperiment,
    current: Sequence[EvalExperimentJob],
    terminal: Any,
    *,
    now: Optional[datetime] = None,
    grace: timedelta = KEY_REVOKE_GRACE,
) -> bool:
    """Revoke the token once every current job is in ``terminal`` and the last one
    finished at least ``grace`` ago. Caller commits.

    Same guard and grace as ``eval_submitter_keys.revoke_key_when_settled`` (``BLOCKED``
    is not terminal: a blocked job may be retried). Returns True when revoked.
    """
    seen = experiment.dataset_read_token_encrypted
    if not seen:
        return False
    if not current or any(job.status not in terminal for job in current):
        return False
    if not settled_long_enough(current, now=now, grace=grace):
        return False
    token_id = experiment.dataset_read_token_id
    session = object_session(experiment)
    if session is None:
        return False
    session.flush()
    if not _guarded_set(
        session, experiment.id, seen, {"dataset_read_token_encrypted": None}
    ):
        return False
    set_committed_value(experiment, "dataset_read_token_encrypted", None)
    revoke_token_row(session, token_id)
    _audit(
        session,
        experiment,
        "eval.dataset_token_revoked",
        {"token_id": token_id, "reason": "settled"},
    )
    logger.info(
        "eval experiment %s: settled; revoked its dataset read token", experiment.id
    )
    return True


__all__ = (
    "DATASET_TOKEN_UNAVAILABLE",
    "DatasetTokenUnavailable",
    "TOKEN_ENV_KEY",
    "ensure_dataset_token_for_retry",
    "has_dataset_token",
    "issue_experiment_dataset_token",
    "resolve_dataset_token",
    "revoke_dataset_token_when_settled",
    "revoke_token_row",
    "token_name",
)
