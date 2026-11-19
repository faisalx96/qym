"""Persist live sources, worker activity, evaluated turns and canary results."""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import zlib
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy.exc import DataError, DBAPIError, IntegrityError, StatementError
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp, to_storage_utc, utc_now_naive
from qym_platform.db.models import (
    LiveCanaryResult,
    LiveChartImage,
    LiveChartSnapshot,
    LiveChartStyle,
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
        ChartSnapshotBody,
        DayBody,
        MetricSpecBody,
        SourceBody,
        TurnBody,
    )

logger = get_logger(__name__)


class _NonFiniteJSONError(ValueError):
    """A turn contains a non-finite number in a producer JSON value."""


# A snapshot is one serialized chart document. Its text is escaped by the
# serializer, so these can only be real tags. The page's locked frame is the
# protection; this check only keeps obviously active markup out of storage.
# Whole names only: <metadata> and <foreignObject> are ordinary chart elements.
_SNAPSHOT_HEAD = "<head></head>"
# The canonical start of a serialized document: an <html> start tag whose
# attributes are plain names or name="value" pairs, then the empty head at once.
# Anything else ahead of the head (an element, a comment, a text area that only
# quotes it) would let the markup decide where the page's own head ends.
# Every attribute starts with whitespace and a name holds none, so the pattern
# reads any input in one way only and its work stays linear in the length.
_SNAPSHOT_START = re.compile(
    r"[ \t\n\f\r]*<html"
    r"(?:[ \t\n\f\r]+[^ \t\n\f\r\"'<>/=]+(?:=\"[^\"<>]*\")?)*"
    r"[ \t\n\f\r]*><head></head>"
)
_SNAPSHOT_FORBIDDEN_TAG = re.compile(
    r"<\s*(script|iframe|object|embed|link|meta|base|template|noscript)[\s>/]",
    re.IGNORECASE | re.ASCII,
)


class ChartImageError(Exception):
    """Chart evidence (image, snapshot or stylesheet) cannot be stored as requested."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def utcnow() -> datetime:
    """Return qym's receive time as naive UTC."""
    return utc_now_naive()


def parse_png(data: bytes) -> tuple[int, int]:
    """Read dimensions from a PNG signature and complete first IHDR chunk."""
    if (
        len(data) < 33
        or not data.startswith(b"\x89PNG\r\n\x1a\n")
        or data[8:16] != b"\x00\x00\x00\rIHDR"
    ):
        raise ValueError("invalid PNG")
    width, height = struct.unpack_from(">II", data, 16)
    if not (0 < width <= 2147483647 and 0 < height <= 2147483647):
        raise ValueError("invalid PNG")
    return width, height


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
        if name == "day_key_timezone" and value is None:
            if not created:
                continue
            value = "UTC"
        if (
            name == "worker"
            and isinstance(source.worker, dict)
            and "control" in source.worker
        ):
            value = {"control": source.worker["control"], **(value or {})}
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
    # Match retention's turn-before-children lock order.
    row = (
        db.query(LiveTurn)
        .filter_by(source_id=source.id, turn_id=body.turn_id)
        .with_for_update()
        .first()
    )
    created = row is None
    if row is None:
        row = LiveTurn(source_id=source.id, received_at=utcnow())
        db.add(row)
    else:
        values["summary"]["replaced_at"] = to_api_timestamp(utcnow())
        charts = values["summary"].get("charts", [])
        if not isinstance(charts, list):
            charts = []
        refs = {
            chart["ref"]
            for chart in charts
            if isinstance(chart, dict) and isinstance(chart.get("ref"), str)
        }
        db.query(LiveChartImage).filter(
            LiveChartImage.turn_pk == row.id,
            LiveChartImage.ref.notin_(refs),
        ).delete(synchronize_session=False)
        db.query(LiveChartSnapshot).filter(
            LiveChartSnapshot.turn_pk == row.id,
            LiveChartSnapshot.ref.notin_(refs),
        ).delete(synchronize_session=False)
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


def _chart_turn(db: Session, source: LiveSource, turn_id: str, ref: str) -> LiveTurn:
    """Lock the turn and check that its summary declares the chart."""
    turn = (
        db.query(LiveTurn)
        .filter_by(source_id=source.id, turn_id=turn_id)
        .with_for_update()
        .first()
    )
    if turn is None:
        raise ChartImageError(404, "turn not found")
    charts = (turn.summary or {}).get("charts", [])
    if not isinstance(charts, list) or not any(
        isinstance(chart, dict) and chart.get("ref") == ref for chart in charts
    ):
        raise ChartImageError(404, "chart not found")
    return turn


def upsert_chart_image(
    db: Session,
    source: LiveSource,
    turn_id: str,
    ref: str,
    data: bytes,
    settings: PlatformSettings,
) -> str:
    """Store a declared chart's PNG, leaving the commit to the caller."""
    turn = _chart_turn(db, source, turn_id, ref)
    width, height = parse_png(data)
    row = db.query(LiveChartImage).filter_by(turn_pk=turn.id, ref=ref).first()
    created = row is None
    if row is None:
        count = db.query(LiveChartImage.id).filter_by(turn_pk=turn.id).count()
        if count >= settings.live_chart_images_per_turn:
            raise ChartImageError(409, "chart image limit reached")
        row = LiveChartImage(turn_pk=turn.id, ref=ref)
        db.add(row)
    row.content_type = "image/png"
    row.byte_size = len(data)
    row.width = width
    row.height = height
    row.sha256 = hashlib.sha256(data).hexdigest()
    row.image = data
    row.received_at = utcnow()
    # One kind of evidence per chart, latest wins: the PNG replaces a snapshot.
    db.query(LiveChartSnapshot).filter_by(turn_pk=turn.id, ref=ref).delete(
        synchronize_session=False
    )
    return "created" if created else "replaced"


def check_snapshot_html(html: str, max_bytes: int) -> bytes:
    """Return the snapshot as UTF-8 bytes, or refuse its size or its markup."""
    try:
        data = html.encode("utf-8")
    except UnicodeEncodeError:
        raise ChartImageError(422, "snapshot html is not valid text") from None
    if len(data) > max_bytes:
        raise ChartImageError(
            413, f"chart snapshot html exceeds the {max_bytes} byte limit"
        )
    if _SNAPSHOT_START.match(html) is None:
        raise ChartImageError(
            422,
            "snapshot html must start with an <html> tag followed by <head></head>",
        )
    lowered = html.lower()
    if html.count(_SNAPSHOT_HEAD) != 1 or lowered.count(_SNAPSHOT_HEAD) != 1:
        raise ChartImageError(
            422, "snapshot html must contain <head></head> exactly once"
        )
    forbidden = _SNAPSHOT_FORBIDDEN_TAG.search(html)
    if forbidden is not None:
        raise ChartImageError(
            422, f"snapshot html must not contain <{forbidden.group(1).lower()}"
        )
    return data


def upsert_chart_snapshot(
    db: Session,
    source: LiveSource,
    turn_id: str,
    ref: str,
    body: ChartSnapshotBody,
    settings: PlatformSettings,
) -> str:
    """Store a declared chart's drawn markup, leaving the commit to the caller."""
    data = check_snapshot_html(body.html, settings.live_chart_snapshot_max_bytes)
    turn = _chart_turn(db, source, turn_id, ref)
    style = (
        db.query(LiveChartStyle.id)
        .filter_by(source_id=source.id, sha256=body.style_sha256)
        .first()
    )
    if style is None:
        raise ChartImageError(412, "chart style not found")
    row = db.query(LiveChartSnapshot).filter_by(turn_pk=turn.id, ref=ref).first()
    created = row is None
    if row is None:
        count = db.query(LiveChartSnapshot.id).filter_by(turn_pk=turn.id).count()
        if count >= settings.live_chart_images_per_turn:
            raise ChartImageError(409, "chart snapshot limit reached")
        row = LiveChartSnapshot(turn_pk=turn.id, ref=ref)
        db.add(row)
    stored = zlib.compress(data)
    row.html = stored
    row.html_size = len(data)
    row.byte_size = len(stored)
    row.sha256 = hashlib.sha256(data).hexdigest()
    row.style_sha256 = body.style_sha256
    row.viewport_width = body.viewport_width
    row.viewport_height = body.viewport_height
    # Round the captured region outward so the stored box never cuts into it.
    row.box_x = math.floor(body.box.x)
    row.box_y = math.floor(body.box.y)
    row.box_width = math.ceil(body.box.x + body.box.width) - row.box_x
    row.box_height = math.ceil(body.box.y + body.box.height) - row.box_y
    row.received_at = utcnow()
    # One kind of evidence per chart, latest wins: the snapshot replaces a PNG.
    db.query(LiveChartImage).filter_by(turn_pk=turn.id, ref=ref).delete(
        synchronize_session=False
    )
    return "created" if created else "replaced"


def store_chart_style(db: Session, source: LiveSource, sha256: str, data: bytes) -> str:
    """Store a stylesheet under its content hash, leaving the commit to the caller."""
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ChartImageError(422, "sha256 does not match the body")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        raise ChartImageError(422, "chart style is not UTF-8") from None
    existing = (
        db.query(LiveChartStyle.id)
        .filter_by(source_id=source.id, sha256=sha256)
        .first()
    )
    if existing is not None:
        # Same hash, same bytes. A repeated upload restarts the unused-style grace.
        db.query(LiveChartStyle).filter_by(id=existing.id).update(
            {"received_at": utcnow()}, synchronize_session=False
        )
        return "present"
    stored = zlib.compress(data)
    db.add(
        LiveChartStyle(
            source_id=source.id,
            sha256=sha256,
            css=stored,
            css_size=len(data),
            byte_size=len(stored),
            received_at=utcnow(),
        )
    )
    return "created"


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
