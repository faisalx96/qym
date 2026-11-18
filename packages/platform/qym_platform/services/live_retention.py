"""Purge expired live evaluation rows in committed batches."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Callable

from qym_platform.db.models import (
    AuditLog,
    LiveCanaryResult,
    LiveChartImage,
    LiveChartSnapshot,
    LiveChartStyle,
    LiveDay,
    LiveJob,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
    LiveWorkerEvent,
)
from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

BATCH_SIZE = 1000
# A stylesheet arrives just before the first snapshot that names it.
CHART_STYLE_GRACE = timedelta(days=1)


def _purge_turns(db: Session, cutoff: date) -> tuple[int, int, int, int]:
    """Lock each turn batch before deleting its charts, scores and turns."""
    turns = scores = chart_images = chart_snapshots = 0
    while True:
        ids = [
            row[0]
            for row in db.execute(
                select(LiveTurn.id)
                .where(LiveTurn.day < cutoff)
                .order_by(LiveTurn.id)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            ).all()
        ]
        # SQLite ignores FOR UPDATE, so each DELETE must recheck the cutoff.
        eligible = select(LiveTurn.id).where(
            LiveTurn.id.in_(ids), LiveTurn.day < cutoff
        )
        deleted_images = (
            db.query(LiveChartImage)
            .filter(LiveChartImage.turn_pk.in_(eligible))
            .delete(synchronize_session=False)
        )
        deleted_snapshots = (
            db.query(LiveChartSnapshot)
            .filter(LiveChartSnapshot.turn_pk.in_(eligible))
            .delete(synchronize_session=False)
        )
        deleted_scores = (
            db.query(LiveTurnScore)
            .filter(LiveTurnScore.turn_pk.in_(eligible))
            .delete(synchronize_session=False)
        )
        deleted_turns = (
            db.query(LiveTurn)
            .filter(LiveTurn.id.in_(ids), LiveTurn.day < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        turns += deleted_turns
        scores += deleted_scores
        chart_images += deleted_images
        chart_snapshots += deleted_snapshots
        if len(ids) < BATCH_SIZE:
            return turns, scores, chart_images, chart_snapshots


def _purge_expired_chart_images(db: Session, cutoff: datetime) -> int:
    """Delete screenshots uploaded before the cutoff; turns and scores stay."""
    chart_images = 0
    while True:
        # Lock the parent turns, as ingest does, so a replacement upload waits
        # for this batch instead of updating a row that is being deleted.
        ids = [
            row[0]
            for row in db.execute(
                select(LiveChartImage.id)
                .join(LiveTurn, LiveTurn.id == LiveChartImage.turn_pk)
                .where(LiveChartImage.received_at < cutoff)
                .order_by(LiveChartImage.id)
                .limit(BATCH_SIZE)
                .with_for_update(of=LiveTurn, skip_locked=True)
            ).all()
        ]
        # The DELETE rechecks the upload time: SQLite ignores FOR UPDATE, and on
        # PostgreSQL a replacement can commit after the snapshot, before the lock.
        deleted = (
            db.query(LiveChartImage)
            .filter(LiveChartImage.id.in_(ids), LiveChartImage.received_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        chart_images += deleted
        if len(ids) < BATCH_SIZE:
            return chart_images


def _purge_unused_chart_styles(db: Session, cutoff: datetime) -> int:
    """Delete stylesheets received before the cutoff that no snapshot of their source names."""
    chart_styles = 0
    source_ids = [
        row[0]
        for row in db.execute(
            select(LiveChartStyle.source_id)
            .where(LiveChartStyle.received_at < cutoff)
            .distinct()
        ).all()
    ]
    for source_id in source_ids:
        # Snapshot ingest holds the source lock while it checks its stylesheet,
        # so a stylesheet cannot be deleted under an upload that is using it.
        locked = db.execute(
            select(LiveSource.id)
            .where(LiveSource.id == source_id)
            .with_for_update(skip_locked=True)
        ).first()
        if locked is not None:
            used = (
                select(LiveChartSnapshot.id)
                .join(LiveTurn, LiveTurn.id == LiveChartSnapshot.turn_pk)
                .where(
                    LiveTurn.source_id == LiveChartStyle.source_id,
                    LiveChartSnapshot.style_sha256 == LiveChartStyle.sha256,
                )
                .correlate(LiveChartStyle)
                .exists()
            )
            chart_styles += (
                db.query(LiveChartStyle)
                .filter(
                    LiveChartStyle.source_id == source_id,
                    LiveChartStyle.received_at < cutoff,
                    ~used,
                )
                .delete(synchronize_session=False)
            )
        db.commit()
    return chart_styles


def purge_live(
    session_factory: Callable[[], Session],
    *,
    retention_days: int,
    chart_image_retention_days: int,
    now: datetime,
) -> dict[str, int]:
    """Purge expired live data, jobs and events in committed batches."""
    cutoff = now - timedelta(days=retention_days)
    settings = PlatformSettings()
    # chart_images counts screenshots deleted with their turn;
    # chart_images_expired counts those deleted alone, by upload age.
    # chart_snapshots go only with their turn; chart_styles once none names them.
    counts = {
        "turns": 0,
        "scores": 0,
        "chart_images": 0,
        "chart_images_expired": 0,
        "chart_snapshots": 0,
        "chart_styles": 0,
        "canaries": 0,
        "days": 0,
        "jobs": 0,
        "events": 0,
    }
    with session_factory() as db:
        (
            counts["turns"],
            counts["scores"],
            counts["chart_images"],
            counts["chart_snapshots"],
        ) = _purge_turns(db, cutoff.date())
        counts["chart_images_expired"] = _purge_expired_chart_images(
            db, now - timedelta(days=chart_image_retention_days)
        )
        counts["chart_styles"] = _purge_unused_chart_styles(db, now - CHART_STYLE_GRACE)
        for name, model, condition in (
            ("canaries", LiveCanaryResult, LiveCanaryResult.checked_at < cutoff),
            ("days", LiveDay, LiveDay.day < (now - timedelta(days=730)).date()),
        ):
            while True:
                ids = (
                    select(model.id)
                    .where(condition)
                    .order_by(model.id)
                    .limit(BATCH_SIZE)
                )
                deleted = (
                    db.query(model)
                    .filter(model.id.in_(ids))
                    .delete(synchronize_session=False)
                )
                db.commit()
                counts[name] += deleted
                if deleted < BATCH_SIZE:
                    break
        for name, model, condition in (
            (
                "jobs",
                LiveJob,
                LiveJob.finished_at
                < now - timedelta(days=settings.live_jobs_retention_days),
            ),
            (
                "events",
                LiveWorkerEvent,
                LiveWorkerEvent.last_at
                < now - timedelta(days=settings.live_events_retention_days),
            ),
        ):
            while True:
                ids = [
                    row[0]
                    for row in db.execute(
                        select(model.id)
                        .where(condition)
                        .order_by(model.id)
                        .limit(BATCH_SIZE)
                        .with_for_update(skip_locked=True)
                    ).all()
                ]
                deleted = (
                    db.query(model)
                    .filter(model.id.in_(ids), condition)
                    .delete(synchronize_session=False)
                )
                db.commit()
                counts[name] += deleted
                if len(ids) < BATCH_SIZE:
                    break
        if any(counts.values()):
            db.add(
                AuditLog(
                    actor_user_id=None,
                    action="live_retention",
                    entity_type="live_source",
                    entity_id="all",
                    before={},
                    after=counts,
                )
            )
            db.commit()
    logger.info("live retention deleted %s", counts)
    return counts
