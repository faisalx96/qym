from __future__ import annotations

from datetime import datetime, timedelta

from qym_platform.datetime_utils import ensure_utc, utc_now
from qym_platform.db.models import Run, RunWorkflowStatus


RUN_STATUS_REASON_LEASE_TIMEOUT = "lease_timeout"
RUN_STATUS_REASON_ADMIN_FORCE_STOP = "admin_force_stopped"
# The run's evaluation job was cancelled by a user (Experiments or Queue page,
# eval_experiments.cancel_jobs). ``cancelled_from_queue`` is the legacy value.
RUN_STATUS_REASON_CANCELLED_BY_USER = "cancelled_by_user"
RUN_STATUS_REASON_CANCELLED_FROM_QUEUE = "cancelled_from_queue"
RUN_STATUS_REASONS_CANCELLED = frozenset(
    {RUN_STATUS_REASON_CANCELLED_BY_USER, RUN_STATUS_REASON_CANCELLED_FROM_QUEUE}
)
# The Evaluation Service finished the job but the run never received its final
# event and is missing items (eval_dispatcher settle sweep).
RUN_STATUS_REASON_UPLOAD_INCOMPLETE = "upload_incomplete"
# Stops inferred by the platform rather than reported by the run: a later live
# event reopens the run and a later terminal event replaces them.
SOFT_STOP_REASONS = frozenset(
    {RUN_STATUS_REASON_LEASE_TIMEOUT, RUN_STATUS_REASON_UPLOAD_INCOMPLETE}
)
TERMINAL_RUN_STATUSES = frozenset(
    {
        RunWorkflowStatus.COMPLETED,
        RunWorkflowStatus.FAILED,
        RunWorkflowStatus.STOPPED,
    }
)
# While a run is in review, runs.status holds the review state and its data is
# frozen: runner events must neither move the run nor rewrite what was reviewed.
REVIEW_RUN_STATUSES = frozenset(
    {
        RunWorkflowStatus.SUBMITTED,
        RunWorkflowStatus.APPROVED,
        RunWorkflowStatus.REJECTED,
    }
)


def is_run_in_review(run: Run) -> bool:
    return run.status in REVIEW_RUN_STATUSES


def touch_run_event(run: Run, event_at: datetime | None) -> None:
    if is_run_force_stopped(run) or is_run_in_review(run):
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
        and run.status_reason in SOFT_STOP_REASONS
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
    if is_run_force_stopped(run) or is_run_in_review(run):
        return
    if run.status in TERMINAL_RUN_STATUSES and not should_reopen_from_live_event(run):
        return
    run.status = RunWorkflowStatus.RUNNING
    run.status_reason = None
    run.ended_at = None


def mark_run_terminal(
    run: Run, status: RunWorkflowStatus, *, ended_at: datetime | None
) -> None:
    if is_run_force_stopped(run) or is_run_in_review(run):
        return
    if (
        run.status == RunWorkflowStatus.STOPPED
        and run.status_reason not in SOFT_STOP_REASONS
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


LIVE_RUN_STATUSES = frozenset({RunWorkflowStatus.RUNNING, RunWorkflowStatus.PENDING})


def stop_requested_job_ids(db, job_ids) -> set:
    """The evaluation jobs among ``job_ids`` that a user is cancelling.

    Cancelling a running job is asynchronous: the dispatcher cancels it on the
    Evaluation Service and only then marks its run ``STOPPED``
    (``eval_experiments.stop_linked_run``). Until then the run is still
    ``RUNNING`` but its stop was requested; pages show it as "Stopping…"
    instead of leaving it looking untouched.
    """
    from qym_platform.db.models import EvalExperimentJob, EvalJobStatus

    ids = {job_id for job_id in job_ids if job_id}
    if not ids:
        return set()
    return {
        job_id
        for (job_id,) in db.query(EvalExperimentJob.id).filter(
            EvalExperimentJob.id.in_(ids),
            EvalExperimentJob.status == EvalJobStatus.CANCELLING,
        )
    }


def is_run_stop_requested(db, run: Run) -> bool:
    """Whether a live run's evaluation job is being cancelled (see above)."""
    if run.status not in LIVE_RUN_STATUSES or not run.experiment_job_id:
        return False
    return bool(stop_requested_job_ids(db, [run.experiment_job_id]))
