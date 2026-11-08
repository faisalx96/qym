"""Apply monotonic worker progress to source-scoped jobs."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from qym_platform.datetime_utils import ensure_utc, to_api_timestamp, to_storage_utc
from qym_platform.db.models import LiveJob, LiveSource
from qym_platform.settings import PlatformSettings


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
    for counter in ("found", "skipped_existing", "evaluated", "failed"):
        value = progress.get(counter, 0)
        if (
            type(value) is not int
            or value < 0
            or value < (job.progress or {}).get(counter, 0)
        ):
            raise JobError(422, "counters must not decrease")
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
    except (ZoneInfoNotFoundError, ValueError):
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
            "redo": (
                []
                if kind == "backfill_preview"
                else ["failed"] if redo is None else list(redo)
            ),
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
    job.updated_at = now
    flag_modified(job, "updated_at")
    return job
