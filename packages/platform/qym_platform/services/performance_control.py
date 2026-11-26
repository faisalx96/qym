"""Build the runner's control document and its conditional-request validator (guide 4.1).

The document is the only place a token value leaves qym, and only for the API
key a Manager chose on the Runner page. Reading it writes nothing and is not a
sign of life.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime
from typing import Any, Optional

from cryptography.fernet import InvalidToken
from qym_platform import secrets as secret_storage
from qym_platform.auth import Principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    PERFORMANCE_TOKEN_NAMES,
    ApiKey,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTargetToken,
    Project,
)
from qym_platform.services import performance_state
from qym_platform.settings import PlatformSettings
from sqlalchemy import select
from sqlalchemy.orm import Session

# The runner's own pace; qym only repeats it so that the runner need not hard-code it.
HEARTBEAT_INTERVAL_S = 10
CONTROL_INTERVAL_IDLE_S = 10
CONTROL_INTERVAL_RUN_S = 2
PROGRESS_INTERVAL_S = 5
STOP_KILL_AFTER_S = 20
_DIGEST_KEY_LABEL = b"qym.performance.tokens-digest.v1"


def limits(settings: PlatformSettings) -> dict[str, int]:
    """The numbers of guide sections 2.4 and 5, as this qym is configured."""
    return {
        "heartbeat_interval_s": HEARTBEAT_INTERVAL_S,
        "control_interval_idle_s": CONTROL_INTERVAL_IDLE_S,
        "control_interval_run_s": CONTROL_INTERVAL_RUN_S,
        "progress_interval_s": PROGRESS_INTERVAL_S,
        "stale_after_s": settings.performance_stale_after_seconds,
        "late_window_s": settings.performance_late_window_seconds,
        "stop_kill_after_s": STOP_KILL_AFTER_S,
        "progress_max_bytes": settings.performance_progress_max_bytes,
        "questions_batch_max": settings.performance_questions_batch_max,
        "questions_max_bytes": settings.performance_questions_max_bytes,
        "questions_per_run_max": settings.performance_questions_per_run_max,
        "log_batch_max": settings.performance_log_batch_max,
        "log_max_bytes": settings.performance_log_max_bytes,
        "log_lines_per_run_max": settings.performance_log_lines_per_run_max,
        "events_batch_max": settings.performance_events_batch_max,
        "events_max_bytes": settings.performance_events_max_bytes,
        "summary_max_bytes": settings.performance_summary_max_bytes,
        "report_max_bytes": settings.performance_report_max_bytes,
        "question_chars_max": settings.performance_question_chars_max,
        "answer_chars_max": settings.performance_answer_chars_max,
        "log_message_chars_max": settings.performance_log_message_chars_max,
    }


def _token_order(row: PerformanceTargetToken) -> tuple[int, str]:
    known = PERFORMANCE_TOKEN_NAMES
    return (known.index(row.name) if row.name in known else len(known), row.name)


def token_rows(db: Session, target_id: Optional[str]) -> list[PerformanceTargetToken]:
    """The saved tokens of a target: refresh token first, then access token."""
    if target_id is None:
        return []
    rows = db.scalars(
        select(PerformanceTargetToken).where(
            PerformanceTargetToken.target_id == target_id,
            PerformanceTargetToken.token_encrypted != "",
        )
    ).all()
    return sorted(rows, key=_token_order)


def token_versions(db: Session, target_id: Optional[str]) -> dict[str, int]:
    """Version of each saved token of a target, now; names and numbers only."""
    return {row.name: row.version for row in token_rows(db, target_id)}


def is_chosen_key(db: Session, runner: PerformanceRunner, principal: Principal) -> bool:
    """True when the request's API key is the runner key a Manager chose, and not revoked."""
    if runner.runner_key_id is None or runner.runner_key_id != principal.api_key_id:
        return False
    key = db.get(ApiKey, runner.runner_key_id)
    return key is not None and key.revoked_at is None


def _resolved_tokens(db: Session, target_id: Optional[str]) -> list[dict[str, Any]]:
    """The target's tokens with their values; never log or store the result."""
    resolved = []
    for row in token_rows(db, target_id):
        try:
            value = secret_storage.decrypt_llm_api_key(row.token_encrypted)
        except (RuntimeError, ValueError, TypeError, InvalidToken) as exc:
            # Imported here: performance_runs may import this module.
            from qym_platform.services.performance_runs import PerformanceError

            raise PerformanceError(
                "secret_cannot_be_decrypted", 500, "secret cannot be decrypted"
            ) from exc
        resolved.append(
            {
                "name": row.name,
                "value": value,
                "hint": row.token_hint,
                "version": row.version,
                "expires_at": to_api_timestamp(row.expires_at),
            }
        )
    return resolved


def _digest_key() -> bytes:
    """A key of its own for the digest, derived from qym's encryption key.

    Without an encryption key no token can be saved, so the digest then covers
    an empty list and needs no secret.
    """
    keys = secret_storage.encryption_keys()
    secret = keys[0] if keys else ""
    return hmac.new(secret.encode("utf-8"), _DIGEST_KEY_LABEL, hashlib.sha256).digest()


def tokens_digest(tokens: list[dict[str, Any]]) -> str:
    """HMAC-SHA-256 over the names, versions and values; changes when any token changes.

    Keyed, so that a key that is not shown the tokens cannot test a guess of
    their values against it.
    """
    content = json.dumps(
        [[token["name"], token["version"], token["value"]] for token in tokens],
        separators=(",", ":"),
    )
    return hmac.new(_digest_key(), content.encode("utf-8"), hashlib.sha256).hexdigest()


def _current_and_last(
    db: Session, runner: PerformanceRunner, now: datetime, settings: PlatformSettings
) -> tuple[Optional[PerformanceRun], Optional[PerformanceRun]]:
    """The runner's run that is not final, and its latest final run inside the late window."""
    active = db.scalars(
        select(PerformanceRun).where(
            PerformanceRun.runner_id == runner.id,
            PerformanceRun.status.in_(performance_state.ACTIVE_STATUSES),
        )
    ).first()
    current = None
    ended = []
    if active is not None:
        # A silence rule may have ended it without the end being written yet.
        if performance_state.derived_end(active, now=now, settings=settings) is None:
            current = active
        else:
            ended.append(active)
    latest = db.scalars(
        select(PerformanceRun)
        .where(
            PerformanceRun.runner_id == runner.id,
            PerformanceRun.status.in_(performance_state.TERMINAL_STATUSES),
            PerformanceRun.claim_instance_id.is_not(None),
        )
        .order_by(PerformanceRun.finished_at.desc(), PerformanceRun.id)
        .limit(1)
    ).first()
    if latest is not None:
        ended.append(latest)
    last = None
    for run in ended:
        if run.claim_instance_id is None:
            continue
        until = performance_state.accepts_results_until(run, now=now, settings=settings)
        if until is None or now > until:
            continue
        if last is None or performance_state.effective_finished_at(
            run, now=now
        ) > performance_state.effective_finished_at(last, now=now):
            last = run
    return current, last


def control_document(
    db: Session,
    runner: PerformanceRunner,
    principal: Principal,
    settings: PlatformSettings,
    now: datetime,
) -> tuple[dict[str, Any], str]:
    """The control document and its weak ETag; token values only for the chosen key."""
    current, last = _current_and_last(db, runner, now, settings)
    from qym_platform.services import performance_platform as platform
    if current is not None and current.target_kind == platform.KIND and platform.KIND not in platform.supported(runner):
        current = None
    if last is not None and last.target_kind == platform.KIND and platform.KIND not in platform.supported(runner):
        last = None
    disclose = is_chosen_key(db, runner, principal)
    state = "idle"
    run_body = None
    digest = ""
    if current is not None:
        tokens = _resolved_tokens(db, current.target_id)
        digest = tokens_digest(tokens)
        stop_requested = current.stop_requested_at is not None
        if current.status == "queued":
            state = "queued"
        elif current.status == "stopping" or stop_requested:
            state = "stopping"
        else:
            state = "active"
        run_body = {
            "id": current.id,
            "number": current.number,
            "project_name": db.get_one(Project, current.project_id).name,
            "status": current.status,
            "requested_at": to_api_timestamp(current.requested_at),
            "stop_requested": stop_requested,
            "stop_reason": current.stop_reason,
            "config": current.config,
        }
        if disclose:
            run_body["tokens"] = tokens
        else:
            run_body["tokens_withheld"] = True
        run_body["tokens_digest"] = digest
        run_body["token_needed"] = current.token_needed
    last_body = None
    if last is not None:
        last_body = {
            "id": last.id,
            "status": performance_state.effective_status(last, now=now),
            "finished_at": to_api_timestamp(
                performance_state.effective_finished_at(last, now=now)
            ),
            "accepts_results_until": to_api_timestamp(
                performance_state.accepts_results_until(
                    last, now=now, settings=settings
                )
            ),
        }
    limit_values = limits(settings)
    if current is not None and current.target_kind == platform.KIND:
        limit_values.update(platform.limits(settings))
    body = {
        "state": state,
        "run": run_body,
        "last_run": last_body,
        "limits": limit_values,
    }
    signal = [
        state,
        (
            None
            if current is None
            else [
                current.id,
                current.status,
                current.stop_requested_at is not None,
                current.stop_reason,
                digest,
                current.token_needed,
            ]
        ),
        runner.runner_key_id,
        # Withheld and disclosed representations must never validate each other.
        disclose,
        last_body,
        limit_values,
    ]
    content = json.dumps(signal, sort_keys=True, separators=(",", ":"))
    etag = 'W/"' + hashlib.sha256(content.encode("utf-8")).hexdigest()[:32] + '"'
    return body, etag
