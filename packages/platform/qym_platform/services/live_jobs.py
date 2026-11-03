"""Apply monotonic worker progress to source-scoped jobs."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from qym_platform.datetime_utils import to_storage_utc
from qym_platform.db.models import LiveJob, LiveSource


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
