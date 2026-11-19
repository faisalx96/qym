"""What the worker says it is doing right now, for the activity line.

The worker sends ``activity`` inside its control block with every heartbeat. qym
shows only what was reported: nothing here invents progress, and a worker that
stops reporting shows as a stale report, by the same rule as the worker page.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import LiveSource, User
from qym_platform.services import live_jobs
from qym_platform.services.live_overview import source_status
from qym_platform.settings import PlatformSettings

# The work on one turn; the worker sends the order it follows.
STEPS = frozenset(("fetch", "judge", "sql", "chart", "save"))
JOB_KINDS = frozenset(("backfill", "backfill_preview", live_jobs.REEVALUATE))
WORKER_STATES = frozenset(("running", "paused", "waiting"))
_COUNT_MAX = 1_000_000_000
_TIMESTAMP_MAX_LENGTH = 40


class _Malformed(ValueError):
    """The worker sent an activity object qym cannot show safely."""


def _text(value: Any, limit: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > limit:
        raise _Malformed
    return value


def _count(value: Any) -> Optional[int]:
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= _COUNT_MAX:
        raise _Malformed
    return value


def _timestamp(value: Any, *, required: bool) -> Optional[str]:
    if value is None and not required:
        return None
    if not isinstance(value, str) or not 0 < len(value) <= _TIMESTAMP_MAX_LENGTH:
        raise _Malformed
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise _Malformed from None
    return value


def _slot(value: Any, steps: list[str], kinds: frozenset[str]) -> Optional[dict]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise _Malformed
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in kinds:
        raise _Malformed
    step = value.get("step")
    if step is not None and (not isinstance(step, str) or step not in steps):
        raise _Malformed
    return {
        "kind": kind,
        "job_id": _text(value.get("job_id"), 64),
        "trace_id": _text(value.get("trace_id"), live_jobs.TRACE_ID_MAX_LENGTH),
        "step": step,
        # Derived from the step, so the position can never disagree with its name.
        "step_index": steps.index(step) + 1 if step is not None else None,
        "step_count": len(steps),
        "done": _count(value.get("done")),
        "total": _count(value.get("total")),
        "started_at": _timestamp(value.get("started_at"), required=False),
        "reported_at": _timestamp(value.get("reported_at"), required=True),
    }


def clean_activity(value: Any) -> Optional[dict]:
    """Return the worker's activity with known keys only, or None when it is absent
    (an older worker) or malformed. Never raises on worker data."""
    if not isinstance(value, dict):
        return None
    steps = value.get("steps")
    if (
        not isinstance(steps, list)
        or not steps
        or len(steps) > len(STEPS)
        or not all(isinstance(step, str) and step in STEPS for step in steps)
        or len(set(steps)) != len(steps)
    ):
        return None
    try:
        return {
            "steps": list(steps),
            "live": _slot(value.get("live"), steps, frozenset(("live",))),
            "job": _slot(value.get("job"), steps, JOB_KINDS),
        }
    except _Malformed:
        return None


def _poll_interval(worker: dict, control: dict) -> Optional[int]:
    """The interval the worker runs with, else the one it registered with."""
    running = control.get("running")
    evaluation = running.get("evaluation") if isinstance(running, dict) else None
    for holder in (evaluation, worker):
        value = holder.get("poll_interval_s") if isinstance(holder, dict) else None
        if type(value) is int and 0 < value <= 86400:
            return value
    return None


def activity_payload(
    db: Session, source: LiveSource, settings: PlatformSettings, now: datetime
) -> dict[str, Any]:
    """The light read behind the activity line of every Live page."""
    worker: dict[str, Any] = source.worker if isinstance(source.worker, dict) else {}
    reported = worker.get("control")
    control: dict[str, Any] = reported if isinstance(reported, dict) else {}
    status = source_status(source, settings, now)
    state = control.get("state")
    reason = control.get("reason")
    activity = clean_activity(control.get("activity"))
    reported_job = (activity or {}).get("job") or {}
    job = live_jobs.active_job(db, source, reported_job.get("job_id"))
    requested_by = None
    if job is not None and job.requested_by_user_id is not None:
        user = db.get(User, job.requested_by_user_id)
        requested_by = user.display_name if user is not None else None
    return {
        "server_time": to_api_timestamp(now),
        "worker": {
            "state": (
                state
                if isinstance(state, str) and state in WORKER_STATES
                else "waiting"
            ),
            "reason": reason[:500] if isinstance(reason, str) and reason else None,
            "last_report_at": status["last_heartbeat_at"],
            "stale": status["stale"],
            "last_poll_at": status["last_poll_at"],
            "poll_interval_s": _poll_interval(worker, control),
        },
        "activity": activity,
        "job": (
            {
                "id": job.id,
                "kind": job.kind,
                "status": job.status,
                "trace_id": live_jobs.job_trace_id(job),
                # The day range, so the activity line can name a backfill on every page.
                "params": {
                    key: value
                    for key in ("since_day", "until_day")
                    if isinstance(job.params, dict)
                    and isinstance(value := job.params.get(key), str)
                },
                "progress": job.progress if isinstance(job.progress, dict) else {},
                "requested_at": to_api_timestamp(job.requested_at),
                "requested_by": requested_by,
                "updated_at": to_api_timestamp(job.updated_at),
            }
            if job is not None
            else None
        ),
    }
