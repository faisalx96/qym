"""Apply monotonic worker progress to source-scoped jobs."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from qym_platform.datetime_utils import ensure_utc, to_api_timestamp, to_storage_utc
from qym_platform.db.models import LiveJob, LiveSource, LiveTurn, User
from qym_platform.settings import PlatformSettings

REEVALUATE = "reevaluate"
REEVALUATE_CONFLICT = "A re-evaluation is already queued or running"
# A turn id is a String(200) column; a longer value can never name a turn.
TRACE_ID_MAX_LENGTH = 200
# Newest re-evaluation jobs of a source read for one turn's history.
_REEVALUATION_HISTORY = 200


class JobError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        self.detail = detail
        super().__init__(detail)


def report_progress(
    db: Session,
    source: LiveSource,
    job_id: str,
    status: str,
    progress: dict,
    error: Optional[str],
    now: datetime,
) -> LiveJob:
    """Lock a job and reject cancelled, terminal or decreasing updates."""
    job = (
        db.query(LiveJob)
        .filter_by(id=job_id, source_id=source.id)
        .with_for_update()
        .first()
    )
    if job is None:
        raise JobError(404, "job not found")
    if job.status in ("done", "failed", "cancelled"):
        raise JobError(409, "job already finished")
    if status == "running" and job.cancel_requested_at is not None:
        raise JobError(409, "job cancelled")
    for counter in (
        "found",
        "skipped_existing",
        "evaluated",
        "failed",
    ):
        value = progress.get(counter, 0)
        if (
            type(value) is not int
            or value < 0
            or value < (job.progress or {}).get(counter, 0)
        ):
            raise JobError(422, "counters must not decrease")
    # Older workers reset these on resume, including in their terminal report.
    # Keep the high-water values without preventing the job from finishing.
    progress = dict(progress)
    for counter in ("redone", "listed"):
        value = progress.get(counter, 0)
        if type(value) is not int or value < 0:
            raise JobError(422, f"{counter} must be a nonnegative integer")
        if counter in progress or counter in (job.progress or {}):
            progress[counter] = max(value, (job.progress or {}).get(counter, 0))
    for counter in (
        "resumed",
        "judged",
        "recorded",
        "incomplete",
        "fetch_failed",
        "deferred",
        "remaining",
        "would_evaluate",
        "would_redo",
        "beyond_limit",
    ):
        if counter in progress and (
            type(progress[counter]) is not int or progress[counter] < 0
        ):
            raise JobError(422, f"{counter} must be a nonnegative integer")
    for flag in ("limit_reached", "listing_stopped_early"):
        if flag in progress and type(progress[flag]) is not bool:
            raise JobError(422, f"{flag} must be a boolean")
    if "waiting" in progress and not isinstance(progress["waiting"], str):
        raise JobError(422, "waiting must be a string")
    if "effective_until" in progress:
        value = progress["effective_until"]
        try:
            if not isinstance(value, str):
                raise ValueError
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise JobError(422, "effective_until must be an ISO timestamp") from None
    if "rejected" in progress:
        rejected = progress["rejected"]
        if not isinstance(rejected, dict):
            raise JobError(422, "rejected must be an object")
        for counter in (
            "other_names",
            "no_session",
            "excluded_users",
            "other_environment",
            "bad_timestamp",
        ):
            if counter in rejected and (
                type(rejected[counter]) is not int or rejected[counter] < 0
            ):
                raise JobError(422, f"rejected.{counter} must be a nonnegative integer")
    now = to_storage_utc(now)
    if status == "running" and job.started_at is None:
        job.started_at = now
    if status in ("done", "failed", "cancelled"):
        job.finished_at = now
        if status == "failed":
            job.error = error[:2000] if error is not None else None
    job.status = status
    job.progress = progress
    job.updated_at = now
    # Preserve the supplied clock even when it equals the previous timestamp;
    # otherwise the column's onupdate default substitutes wall-clock time.
    flag_modified(job, "updated_at")
    return job


def create_job(
    db: Session,
    source: LiveSource,
    kind: str,
    since_day: date,
    until_day: date,
    limit: int,
    settings: PlatformSettings,
    actor_user_id: Optional[str],
    now: datetime,
    redo: Optional[list[str]] = None,
) -> LiveJob:
    """Queue one inclusive calendar-day range per source and job kind."""
    if kind not in ("backfill_preview", "backfill"):
        raise JobError(422, "invalid job kind")
    if redo is not None:
        if len(redo) != len(set(redo)):
            raise JobError(422, "redo must not contain duplicate labels")
        if "all" in redo and len(redo) > 1:
            raise JobError(422, "redo all must not be combined with others")
    if until_day < since_day:
        raise JobError(422, "until_day before since_day")
    if (until_day - since_day).days + 1 > settings.live_job_max_days:
        raise JobError(422, f"At most {settings.live_job_max_days} days per job")
    if type(limit) is not int or not 1 <= limit <= settings.live_job_max_limit:
        raise JobError(422, f"limit must be 1 to {settings.live_job_max_limit}")
    try:
        zone = ZoneInfo(source.day_key_timezone)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise JobError(422, "source timezone not recognised") from None
    if until_day > ensure_utc(now).astimezone(zone).date():
        raise JobError(422, "until_day in the future")
    # Lock the parent even when there is no queued job yet, closing the race
    # between concurrent creators checking for an existing active job.
    db.query(LiveSource).filter_by(id=source.id).with_for_update().one()
    existing = (
        db.query(LiveJob.id)
        .filter(
            LiveJob.source_id == source.id,
            LiveJob.kind == kind,
            LiveJob.status.in_(("queued", "running")),
        )
        .first()
    )
    if existing is not None:
        raise JobError(409, f"a {kind} job is already queued or running")
    now = to_storage_utc(now)
    job = LiveJob(
        source_id=source.id,
        kind=kind,
        params={
            "since_day": since_day.isoformat(),
            "until_day": until_day.isoformat(),
            "since": to_api_timestamp(datetime.combine(since_day, time.min, zone)),
            "until": to_api_timestamp(datetime.combine(until_day, time.max, zone)),
            "limit": limit,
            "redo": ["failed"] if redo is None else list(redo),
        },
        status="queued",
        requested_by_user_id=actor_user_id,
        requested_at=now,
        updated_at=now,
    )
    try:
        with db.begin_nested():
            db.add(job)
            db.flush()
    except IntegrityError:
        raise JobError(409, f"a {kind} job is already queued or running") from None
    return job


def create_reevaluate_job(
    db: Session,
    source: LiveSource,
    trace_id: str,
    actor_user_id: Optional[str],
    now: datetime,
) -> LiveJob:
    """Queue the re-evaluation of one turn of this source; one at a time per source."""
    if not isinstance(trace_id, str) or not trace_id.strip():
        raise JobError(422, "trace_id must not be blank")
    if len(trace_id) > TRACE_ID_MAX_LENGTH:
        raise JobError(
            422, f"trace_id must be at most {TRACE_ID_MAX_LENGTH} characters"
        )
    # The worker pushes a turn under its trace id, so the trace id is the turn id.
    known = (
        db.query(LiveTurn.id)
        .filter(LiveTurn.source_id == source.id, LiveTurn.turn_id == trace_id)
        .first()
    )
    if known is None:
        raise JobError(404, "turn not found")
    # Same parent lock as create_job: concurrent requests see each other's job.
    db.query(LiveSource).filter_by(id=source.id).with_for_update().one()
    existing = (
        db.query(LiveJob.id)
        .filter(
            LiveJob.source_id == source.id,
            LiveJob.kind == REEVALUATE,
            LiveJob.status.in_(("queued", "running")),
        )
        .first()
    )
    if existing is not None:
        raise JobError(409, REEVALUATE_CONFLICT)
    now = to_storage_utc(now)
    job = LiveJob(
        source_id=source.id,
        kind=REEVALUATE,
        params={"trace_ids": [trace_id], "redo": ["all"], "limit": 1},
        status="queued",
        requested_by_user_id=actor_user_id,
        requested_at=now,
        updated_at=now,
    )
    try:
        with db.begin_nested():
            db.add(job)
            db.flush()
    except IntegrityError:
        raise JobError(409, REEVALUATE_CONFLICT) from None
    return job


def job_trace_id(job: LiveJob) -> Optional[str]:
    """The turn a re-evaluation job targets; None for other kinds or odd params."""
    if job.kind != REEVALUATE or not isinstance(job.params, dict):
        return None
    trace_ids = job.params.get("trace_ids")
    if isinstance(trace_ids, list) and trace_ids and isinstance(trace_ids[0], str):
        return trace_ids[0]
    return None


def active_job(
    db: Session, source: LiveSource, preferred_id: Optional[str] = None
) -> Optional[LiveJob]:
    """The source's job in progress: the one the worker names, else the running one,
    else the oldest queued one."""
    jobs = (
        db.query(LiveJob)
        .filter(
            LiveJob.source_id == source.id, LiveJob.status.in_(("queued", "running"))
        )
        .order_by(
            case((LiveJob.status == "running", 0), else_=1),
            LiveJob.requested_at,
            LiveJob.id,
        )
        .all()
    )
    if preferred_id is not None:
        for job in jobs:
            if job.id == preferred_id:
                return job
    return jobs[0] if jobs else None


def reevaluation_state(
    db: Session, source: LiveSource, trace_id: str
) -> dict[str, Any]:
    """The queued or running re-evaluation of one turn and its latest finished one.

    Reads at most the newest ``_REEVALUATION_HISTORY`` re-evaluation jobs of the
    source and matches the turn in Python: ``params`` is a plain JSON column, with
    no containment operator shared by SQLite and PostgreSQL.
    """
    rows = (
        db.query(LiveJob)
        .filter(LiveJob.source_id == source.id, LiveJob.kind == REEVALUATE)
        .order_by(LiveJob.requested_at.desc(), LiveJob.id.desc())
        .limit(_REEVALUATION_HISTORY)
        .all()
    )
    active = last = None
    for job in rows:
        trace_ids = (
            job.params.get("trace_ids") if isinstance(job.params, dict) else None
        )
        if not isinstance(trace_ids, list) or trace_id not in trace_ids:
            continue
        if job.status in ("queued", "running"):
            active = active or job
        elif job.status in ("done", "failed", "cancelled"):
            last = last or job
        if active is not None and last is not None:
            break

    def requester(job: LiveJob) -> Optional[str]:
        if job.requested_by_user_id is None:
            return None
        user = db.get(User, job.requested_by_user_id)
        return user.display_name if user is not None else None

    return {
        "active": (
            {
                "id": active.id,
                "status": active.status,
                "requested_at": to_api_timestamp(active.requested_at),
                "requested_by": requester(active),
            }
            if active is not None
            else None
        ),
        "last": (
            {
                "id": last.id,
                "status": last.status,
                "finished_at": to_api_timestamp(last.finished_at),
                "error": last.error,
            }
            if last is not None
            else None
        ),
    }


def cancel_job(db: Session, source: LiveSource, job_id: str, now: datetime) -> LiveJob:
    """Cancel queued work immediately, or ask a running worker to stop."""
    job = (
        db.query(LiveJob)
        .filter_by(id=job_id, source_id=source.id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if job is None:
        raise JobError(404, "job not found")
    if job.status not in ("queued", "running"):
        raise JobError(409, "job already finished")
    now = to_storage_utc(now)
    if job.status == "queued":
        job.status = "cancelled"
        job.finished_at = now
    else:
        job.cancel_requested_at = now
        # Heartbeats use the server receipt time; last_poll_at is the worker's
        # live polling clock and can stop advancing while it is alive but paused.
        last_seen = to_storage_utc(source.last_heartbeat_at or job.updated_at)
        if now - last_seen >= timedelta(seconds=120):
            job.status = "cancelled"
            job.finished_at = now
            job.error = "cancelled while the worker was not responding"
    job.updated_at = now
    flag_modified(job, "updated_at")
    return job
