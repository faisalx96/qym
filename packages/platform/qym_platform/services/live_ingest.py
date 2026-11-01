"""Persist live sources, worker heartbeats, metric specs and daily counters."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_storage_utc, utc_now_naive
from qym_platform.db.models import LiveDay, LiveMetricSpec, LiveSource
from qym_platform.log import get_logger

if TYPE_CHECKING:
    from qym_platform.api.live_ingest import DayBody, MetricSpecBody, SourceBody

logger = get_logger(__name__)


def utcnow() -> datetime:
    """Return qym's receive time as naive UTC."""
    return utc_now_naive()


def upsert_source(
    db: Session, project_id: str, key: str, body: SourceBody
) -> tuple[LiveSource, bool]:
    """Create a source or replace its reported configuration."""
    source = (
        db.query(LiveSource)
        .filter(LiveSource.project_id == project_id, LiveSource.key == key)
        .with_for_update()
        .first()
    )
    created = source is None
    if source is None:
        source = LiveSource(project_id=project_id, key=key)
        db.add(source)
    for name, value in body.model_dump().items():
        setattr(source, name, value)
    return source, created


def _day_row(db: Session, source: LiveSource, day: date) -> LiveDay:
    """Find the source's day or prepare a running row with zero poll counters."""
    row = (
        db.query(LiveDay)
        .filter(LiveDay.source_id == source.id, LiveDay.day == day)
        .first()
    )
    if row is None:
        row = LiveDay(
            source_id=source.id, day=day, status="running", polls=0, max_poll_gap_s=0
        )
        db.add(row)
    return row


def record_heartbeat(
    db: Session,
    source: LiveSource,
    at: datetime,
    last_poll_at: Optional[datetime],
    current_day: Optional[date],
    worker: Optional[dict],
    now: datetime,
) -> Optional[LiveDay]:
    """Record receipt using qym's clock and count polls for the reported day."""
    # The worker's `at` can lag or arrive out of order; it never drives liveness.
    previous = source.last_heartbeat_at
    source.last_heartbeat_at = to_storage_utc(now)
    source.last_poll_at = to_storage_utc(last_poll_at)
    if worker is not None:
        source.worker = {**(source.worker or {}), **worker}
    if current_day is None:
        return None
    row = _day_row(db, source, current_day)
    gap = 0
    if previous is not None:
        gap = int((source.last_heartbeat_at - to_storage_utc(previous)).total_seconds())
    row.polls += 1
    row.max_poll_gap_s = max(row.max_poll_gap_s, gap, 0)
    return row


def replace_metric_specs(
    db: Session, source: LiveSource, specs: list[MetricSpecBody]
) -> int:
    """Replace all metric specs reported by this source."""
    db.query(LiveMetricSpec).filter(LiveMetricSpec.source_id == source.id).delete(
        synchronize_session=False
    )
    for spec in specs:
        values = spec.model_dump()
        values["group_name"] = values.pop("group")
        db.add(LiveMetricSpec(source_id=source.id, **values))
    return len(specs)


def upsert_day(db: Session, source: LiveSource, day: date, body: DayBody) -> LiveDay:
    """Replace worker counters without changing qym's heartbeat counters."""
    row = _day_row(db, source, day)
    for name, value in body.model_dump().items():
        if name in {"first_poll_at", "last_poll_at", "closed_at"}:
            value = to_storage_utc(value)
        setattr(row, name, value)
    return row
