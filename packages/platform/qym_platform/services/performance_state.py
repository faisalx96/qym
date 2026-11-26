"""The state rules of a performance run (docs/performance-runner-protocol-v1.0.md, section 2).

A run is claimed once and never resumes. Two rules end a run without a word from
anyone: a claimed run whose runner gave no sign of life for
``performance_stale_after_seconds`` is ``interrupted``, and a queued run nobody
claimed within ``performance_queue_timeout_seconds`` is ``expired``. Both are
derived on read (``effective_status``) and written by ``end_if_stale`` on every
runner contact and by ``sweep_stale_runs`` from the maintenance loop.

Every function takes the clock as ``now`` (naive UTC, as the columns store it)
and leaves the commit to its caller.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    PERFORMANCE_ACTIVE_RUN_STATUSES,
    PERFORMANCE_FINAL_RUN_STATUSES,
    PERFORMANCE_STATUS_REASONS,
    PerformanceEvent,
    PerformanceRun,
)
from qym_platform.services.event_storage import ingest_settings
from qym_platform.settings import PlatformSettings
from sqlalchemy import select, update
from sqlalchemy.orm import Session

# Not final: a start is refused while the runner or the target has one of these.
ACTIVE_STATUSES: tuple[str, ...] = PERFORMANCE_ACTIVE_RUN_STATUSES
# Final: nothing follows, and nothing returns to ``queued``.
TERMINAL_STATUSES: tuple[str, ...] = PERFORMANCE_FINAL_RUN_STATUSES
# Claimed and not final: the runner owes signs of life.
CLAIMED_STATUSES: tuple[str, ...] = ("starting", "running", "stopping")

# Why qym ended a run by itself: the ``status_reason`` written with the final status.
SILENCE_REASONS = {"interrupted": "runner_silent", "expired": "not_claimed"}
INTERRUPTED_MESSAGE = "The runner stopped answering; the run was ended"
EXPIRED_MESSAGE = "No runner picked the run up in time"


def performance_settings() -> PlatformSettings:
    """The settings of this process (the snapshot the ingest routes use)."""
    return ingest_settings()


def last_sign_of_life(run: PerformanceRun) -> Optional[datetime]:
    """qym's receive time of the last claim, heartbeat or progress report of the claiming instance."""
    return run.last_seen_at or run.claimed_at


def derived_end(
    run: PerformanceRun, *, now: datetime, settings: Optional[PlatformSettings] = None
) -> Optional[tuple[str, datetime]]:
    """``(final status, end time)`` when a rule qym applies by itself has ended the run.

    The end time is the moment the limit ran out (last sign of life plus the
    stale limit; request time plus the queue limit), not the moment somebody
    looked, so the late window is the same whoever notices first. ``None`` when
    the stored status stands.
    """
    settings = settings or performance_settings()
    if run.status in CLAIMED_STATUSES:
        seen = last_sign_of_life(run)
        if seen is None:
            return None
        lost_at = seen + timedelta(seconds=settings.performance_stale_after_seconds)
        return ("interrupted", lost_at) if now >= lost_at else None
    if run.status == "queued":
        expired_at = run.requested_at + timedelta(
            seconds=settings.performance_queue_timeout_seconds
        )
        return ("expired", expired_at) if now >= expired_at else None
    return None


def effective_status(run: PerformanceRun, *, now: datetime) -> str:
    """The run's status after the rules that are derived on read; writes nothing."""
    ended = derived_end(run, now=now)
    return ended[0] if ended else run.status


def effective_finished_at(run: PerformanceRun, *, now: datetime) -> Optional[datetime]:
    """When the run ended, also for a run whose end has not been written yet."""
    ended = derived_end(run, now=now)
    return ended[1] if ended else run.finished_at


def is_runner_silent(run: PerformanceRun, *, now: datetime) -> bool:
    """True when a claimed run's runner has given no sign of life for the stale limit."""
    ended = derived_end(run, now=now)
    return ended is not None and ended[0] == "interrupted"


def accepts_results_until(
    run: PerformanceRun, *, now: datetime, settings: Optional[PlatformSettings] = None
) -> Optional[datetime]:
    """End of the late window of a run that has ended; ``None`` while it is not final."""
    settings = settings or performance_settings()
    finished_at = effective_finished_at(run, now=now)
    if finished_at is None or effective_status(run, now=now) not in TERMINAL_STATUSES:
        return None
    return finished_at + timedelta(seconds=settings.performance_late_window_seconds)


def accepts_results(run: PerformanceRun, *, now: datetime) -> bool:
    """Questions, log lines, the summary, the report and a rotated token are still taken.

    True for a claimed run that is not final, and for a claimed run that ended at
    most ``performance_late_window_seconds`` ago. A run nobody claimed never
    accepts results.
    """
    if run.claim_instance_id is None:
        return False
    until = accepts_results_until(run, now=now)
    return until is None or now <= until


def add_event(
    db: Session,
    *,
    runner_id: str,
    run_id: Optional[str],
    at: datetime,
    code: str,
    message: str,
    level: str = "info",
    details: Optional[dict[str, Any]] = None,
) -> PerformanceEvent:
    """Write one of qym's own lines on the runner's timeline (``source`` is ``qym``).

    Codes in use: ``claimed``, ``stop_requested``, ``token_supplied``,
    ``token_rotated``, ``interrupted``, ``expired``. Never put a token value in
    ``message`` or ``details``.
    """
    existing = None
    if code == "token_rotated" and run_id and details and details.get("name"):
        # Rotation already holds the run/token locks. Match names in Python so
        # this small per-run lookup has identical JSON semantics on both dialects.
        existing = next(
            (
                event
                for event in db.scalars(
                    select(PerformanceEvent)
                    .where(
                        PerformanceEvent.runner_id == runner_id,
                        PerformanceEvent.run_id == run_id,
                        PerformanceEvent.source == "qym",
                        PerformanceEvent.code == code,
                    )
                    .order_by(PerformanceEvent.id)
                )
                if event.details.get("name") == details["name"]
            ),
            None,
        )
        count = (existing.details.get("count", 1) + 1) if existing else 1
        details = {**details, "count": count, "last_at": to_api_timestamp(at)}
        if existing:
            message = (
                f"The target replaced the {details['name'].replace('_', ' ')} "
                f"{count} times; the latest one is saved"
            )
    run = db.get(PerformanceRun, run_id) if run_id else None
    if run is not None and run.target_kind == "estishraf_platform":
        from qym_platform.services.performance_redaction import masker

        mask = masker(db, target_id=run.target_id)
        # These details are constructed by qym (counts/token metadata), not
        # submitted free text. Preserve their protocol keys and literals.
        message = mask.text(message)
    if existing is not None:
        existing.message, existing.details = message, details
        return existing
    event = PerformanceEvent(
        runner_id=runner_id,
        run_id=run_id,
        at=at,
        level=level,
        code=code,
        message=message,
        details=details or {},
        source="qym",
    )
    db.add(event)
    return event


def finish_run(
    run: PerformanceRun,
    *,
    status: str,
    at: datetime,
    error: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """Give a loaded run its final status; the finish time opens the late window.

    ``reason`` is the ``status_reason`` code that says why the run ended other
    than by running to its end (one of ``PERFORMANCE_STATUS_REASONS``). Nobody
    is asked for a token once a run has ended. An ``error`` or a reason already
    stored is kept unless a new one is given.
    """
    if status not in TERMINAL_STATUSES:
        raise ValueError(f"{status} is not a final status")
    if (
        reason is not None
        and reason not in PERFORMANCE_STATUS_REASONS
        and not (
            run.target_kind == "estishraf_platform"
            and reason == "runner_kind_unsupported"
        )
    ):
        raise ValueError(f"{reason} is not a status reason")
    run.status = status
    run.finished_at = at
    run.token_needed = None
    if error is not None:
        run.error = error
    if reason is not None:
        run.status_reason = reason


def end_if_stale(db: Session, run: PerformanceRun, *, now: datetime) -> bool:
    """Write the end of a run that a silence rule has ended; True when this call wrote it.

    The write is conditional on the status and the sign of life the decision was
    made from, so a report that arrived in between wins and two sweepers never
    both write the event. The run object is refreshed either way.
    """
    ended = derived_end(run, now=now)
    if ended is None:
        return False
    status, at = ended
    seen = (
        PerformanceRun.last_seen_at.is_(None)
        if run.last_seen_at is None
        else PerformanceRun.last_seen_at == run.last_seen_at
    )
    message = INTERRUPTED_MESSAGE if status == "interrupted" else EXPIRED_MESSAGE
    values: dict[str, Any] = {
        "status": status,
        "status_reason": SILENCE_REASONS[status],
        "finished_at": at,
        "token_needed": None,
        "updated_at": now,
    }
    if run.error is None:
        values["error"] = message
    result = db.execute(
        update(PerformanceRun)
        .where(
            PerformanceRun.id == run.id,
            PerformanceRun.status == run.status,
            seen,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    db.refresh(run)
    if result.rowcount != 1:
        return False
    add_event(
        db,
        runner_id=run.runner_id,
        run_id=run.id,
        at=at,
        code=status,
        level="error" if status == "interrupted" else "warning",
        message=message,
    )
    return True


def sweep_stale_runs(db: Session, *, now: datetime) -> int:
    """End every silent or unclaimed run of every project; returns how many this call ended.

    Called by the maintenance loop (every 15 s). The caller commits.
    """
    settings = performance_settings()
    stale_before = now - timedelta(seconds=settings.performance_stale_after_seconds)
    expired_before = now - timedelta(seconds=settings.performance_queue_timeout_seconds)
    candidates = db.scalars(
        select(PerformanceRun).where(
            (
                PerformanceRun.status.in_(CLAIMED_STATUSES)
                & (
                    (PerformanceRun.last_seen_at <= stale_before)
                    | (
                        PerformanceRun.last_seen_at.is_(None)
                        & (PerformanceRun.claimed_at <= stale_before)
                    )
                )
            )
            | (
                (PerformanceRun.status == "queued")
                & (PerformanceRun.requested_at <= expired_before)
            )
        )
    ).all()
    return sum(1 for run in candidates if end_if_stale(db, run, now=now))
