"""Persist live sources, worker activity, evaluated turns and canary results."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy.exc import DataError, DBAPIError, IntegrityError, StatementError
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp, to_storage_utc, utc_now_naive
from qym_platform.db.models import (
    LiveCanaryResult,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
)
from qym_platform.log import get_logger
from qym_platform.services.ingest_completeness import _clean as _strip_nul
from qym_platform.settings import PlatformSettings

if TYPE_CHECKING:
    from qym_platform.api.live_ingest import (
        CanaryBody,
        DayBody,
        MetricSpecBody,
        SourceBody,
        TurnBody,
    )

logger = get_logger(__name__)


class _NonFiniteJSONError(ValueError):
    """A turn contains a non-finite number in a producer JSON value."""


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


def _clean_text(value: Optional[str], limit: int) -> tuple[Optional[str], bool]:
    """Strip NULs and report whether the cleaned text exceeded its limit."""
    if value is None:
        return None, False
    value = _strip_nul(value)
    return value[:limit], len(value) > limit


def _turn_values(body: TurnBody, settings: PlatformSettings) -> tuple[dict, list[str]]:
    """Prepare turn columns with bounded text and producer detail."""
    json_values = [body.summary, body.detail, body.sql]
    for score in body.scores:
        json_values.extend((score.score_raw, score.meta))
    try:
        json.dumps(json_values, allow_nan=False)
    except ValueError:
        raise _NonFiniteJSONError("non-finite number in JSON") from None
    values = body.model_dump(exclude={"scores"})
    values["day"] = body.day or body.turn_at.date()
    for name in ("turn_at", "evaluated_at"):
        values[name] = to_storage_utc(values[name])
    for name in ("question", "answer"):
        values[name], truncated = _clean_text(values[name], 200000)
        if truncated:
            values["summary"]["text_truncated"] = True
    notes = []
    if body.detail is not None:
        size = len(
            json.dumps(body.detail, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )
        if size > settings.live_detail_max_bytes:
            values["detail"] = None
            values["summary"]["detail_truncated"] = True
            notes.append("detail truncated")
    return values, notes


def _upsert_turn(
    db: Session,
    source: LiveSource,
    body: TurnBody,
    settings: PlatformSettings,
    known_metrics: set[str],
) -> dict[str, Any]:
    """Replace one turn and its complete score set within the caller's savepoint."""
    values, notes = _turn_values(body, settings)
    row = (
        db.query(LiveTurn).filter_by(source_id=source.id, turn_id=body.turn_id).first()
    )
    created = row is None
    if row is None:
        row = LiveTurn(source_id=source.id, received_at=utcnow())
        db.add(row)
    else:
        values["summary"]["replaced_at"] = to_api_timestamp(utcnow())
        db.query(LiveTurnScore).filter_by(turn_pk=row.id).delete(
            synchronize_session=False
        )
    for name, value in values.items():
        setattr(row, name, value)
    db.flush()
    for score in body.scores:
        if score.metric_name not in known_metrics:
            notes.append(f"unknown metric {score.metric_name}")
        db.add(LiveTurnScore(turn_pk=row.id, **score.model_dump()))
    row.rejected = notes or None
    if source.last_turn_at is None or row.turn_at > source.last_turn_at:
        source.last_turn_at = row.turn_at
    db.flush()
    return {
        "turn_id": body.turn_id,
        "status": "created" if created else "updated",
        "error": None,
        "notes": notes,
    }


def upsert_turns(
    db: Session, source: LiveSource, turns: list[TurnBody], settings: PlatformSettings
) -> dict[str, Any]:
    """Apply a batch with one savepoint per turn and leave its commit to the caller."""
    connection = db.connection()
    # SQLite's legacy transaction mode otherwise commits a first SAVEPOINT alone.
    if (
        connection.dialect.name == "sqlite"
        and not connection.connection.driver_connection.in_transaction
    ):
        connection.exec_driver_sql("BEGIN")
    known_metrics = {
        name
        for (name,) in db.query(LiveMetricSpec.metric_name).filter_by(
            source_id=source.id
        )
    }
    report = {"accepted": 0, "updated": 0, "rejected": 0, "results": []}
    for body in turns:
        try:
            with db.begin_nested():
                result = _upsert_turn(db, source, body, settings, known_metrics)
        except (StatementError, ValueError, OverflowError, UnicodeError) as exc:
            if isinstance(exc, DBAPIError) and not isinstance(
                exc, (DataError, IntegrityError)
            ):
                raise
            error = (
                str(exc)
                if isinstance(exc, _NonFiniteJSONError)
                else "Database refused turn values"
            )
            logger.warning(
                "live turn %s rejected: %s",
                body.turn_id,
                type(exc).__name__,
            )
            result = {
                "turn_id": body.turn_id,
                "status": "rejected",
                "error": error,
                "notes": [],
            }
        counter = "accepted" if result["status"] == "created" else result["status"]
        report[counter] += 1
        report["results"].append(result)
    return report


def insert_canaries(db: Session, source: LiveSource, results: list[CanaryBody]) -> int:
    """Insert canary checks once per source, canary and UTC check time."""
    accepted = 0
    for body in results:
        values = body.model_dump()
        values["checked_at"] = to_storage_utc(body.checked_at)
        existing = (
            db.query(LiveCanaryResult.id)
            .filter_by(
                source_id=source.id, canary=body.canary, checked_at=values["checked_at"]
            )
            .first()
        )
        if existing is not None:
            continue
        db.add(LiveCanaryResult(source_id=source.id, **values))
        db.flush()
        accepted += 1
    return accepted


def turn_ids_for_day(db: Session, source: LiveSource, day: date) -> list[str]:
    """Return the source's turn IDs for the stored reporting day."""
    return [
        turn_id
        for (turn_id,) in db.query(LiveTurn.turn_id)
        .filter_by(source_id=source.id, day=day)
        .order_by(LiveTurn.turn_id)
    ]
