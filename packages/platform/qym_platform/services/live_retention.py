"""Purge expired live evaluation rows in committed batches."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Callable

from qym_platform.db.models import (
    AuditLog,
    LiveCanaryResult,
    LiveChartImage,
    LiveDay,
    LiveJob,
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


def _purge_turns(db: Session, cutoff: date) -> tuple[int, int, int]:
    """Lock each turn batch before deleting its images, scores and turns."""
    turns = scores = chart_images = 0
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
        if len(ids) < BATCH_SIZE:
            return turns, scores, chart_images


def purge_live(
    session_factory: Callable[[], Session], *, retention_days: int, now: datetime
) -> dict[str, int]:
    """Purge expired live data, jobs and events in committed batches."""
    cutoff = now - timedelta(days=retention_days)
    settings = PlatformSettings()
    counts = {
        "turns": 0,
        "scores": 0,
        "chart_images": 0,
        "canaries": 0,
        "days": 0,
        "jobs": 0,
        "events": 0,
    }
    with session_factory() as db:
        counts["turns"], counts["scores"], counts["chart_images"] = _purge_turns(
            db, cutoff.date()
        )
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
