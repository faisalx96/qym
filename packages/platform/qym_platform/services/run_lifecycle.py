from __future__ import annotations

from datetime import datetime, timedelta

from qym_platform.datetime_utils import ensure_utc, utc_now
from qym_platform.db.models import Run, RunWorkflowStatus


RUN_STATUS_REASON_LEASE_TIMEOUT = "lease_timeout"
RUN_STATUS_REASON_ADMIN_FORCE_STOP = "admin_force_stopped"
TERMINAL_RUN_STATUSES = frozenset(
    {
        RunWorkflowStatus.COMPLETED,
        RunWorkflowStatus.FAILED,
        RunWorkflowStatus.STOPPED,
    }
)


def touch_run_event(run: Run, event_at: datetime | None) -> None:
    if is_run_force_stopped(run):
        return
    normalized = ensure_utc(event_at)
    if normalized is None:
        return
    event_at_naive = normalized.replace(tzinfo=None)
    current = ensure_utc(run.last_event_at)
    if current is None or event_at_naive > current.replace(tzinfo=None):
        run.last_event_at = event_at_naive


def should_reopen_from_live_event(run: Run) -> bool:
    return (
        run.status == RunWorkflowStatus.STOPPED
        and run.status_reason == RUN_STATUS_REASON_LEASE_TIMEOUT
    )


def is_run_force_stopped(run: Run) -> bool:
    return run.status_reason == RUN_STATUS_REASON_ADMIN_FORCE_STOP


def can_force_stop_run(run: Run) -> bool:
    return not is_run_force_stopped(run) and run.status in {
        RunWorkflowStatus.RUNNING,
        RunWorkflowStatus.PENDING,
        RunWorkflowStatus.STOPPED,
    }


def mark_run_running(run: Run) -> None:
    if is_run_force_stopped(run):
        return
    if run.status in TERMINAL_RUN_STATUSES and not should_reopen_from_live_event(run):
        return
    run.status = RunWorkflowStatus.RUNNING
    run.status_reason = None
    run.ended_at = None


def mark_run_terminal(
    run: Run, status: RunWorkflowStatus, *, ended_at: datetime | None
) -> None:
    if is_run_force_stopped(run):
        return
    if (
        run.status == RunWorkflowStatus.STOPPED
        and run.status_reason != RUN_STATUS_REASON_LEASE_TIMEOUT
        and status != RunWorkflowStatus.STOPPED
    ):
        return
    run.status = status
    run.status_reason = None
    normalized = ensure_utc(ended_at) or utc_now()
    run.ended_at = normalized.replace(tzinfo=None)


def is_stale_running_run(
    run: Run, *, timeout_seconds: int, now: datetime | None = None
) -> bool:
    """Check the lease without changing state or loading run payloads."""
    if run.status != RunWorkflowStatus.RUNNING:
        return False

    last_seen = (
        ensure_utc(run.last_event_at)
        or ensure_utc(run.started_at)
        or ensure_utc(run.created_at)
    )
    if last_seen is None:
        return False

    current = ensure_utc(now) or utc_now()
    return current - last_seen >= timedelta(seconds=max(1, timeout_seconds))


def reconcile_stale_running_run(
    run: Run, *, timeout_seconds: int, now: datetime | None = None
) -> bool:
    if not is_stale_running_run(
        run, timeout_seconds=timeout_seconds, now=now
    ) or is_run_force_stopped(run):
        return False

    last_seen = (
        ensure_utc(run.last_event_at)
        or ensure_utc(run.started_at)
        or ensure_utc(run.created_at)
    )
    assert last_seen is not None
    run.status = RunWorkflowStatus.STOPPED
    run.status_reason = RUN_STATUS_REASON_LEASE_TIMEOUT
    run.ended_at = last_seen.replace(tzinfo=None)
    return True
