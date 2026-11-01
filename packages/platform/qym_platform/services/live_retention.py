"""Purge expired live evaluation rows in committed batches."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Callable

from qym_platform.db.models import (
    AuditLog,
    LiveCanaryResult,
    LiveDay,
    LiveTurn,
    LiveTurnScore,
)
from qym_platform.log import get_logger
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

BATCH_SIZE = 1000


def _purge_turns(db: Session, cutoff: date) -> tuple[int, int]:
    """Delete scores explicitly before their turns, committing each batch."""
    turns = scores = 0
    while True:
        ids = (
            select(LiveTurn.id)
            .where(LiveTurn.day < cutoff)
            .order_by(LiveTurn.id)
            .limit(BATCH_SIZE)
        )
        deleted_scores = (
            db.query(LiveTurnScore)
            .filter(LiveTurnScore.turn_pk.in_(ids))
            .delete(synchronize_session=False)
        )
        deleted_turns = (
            db.query(LiveTurn)
            .filter(LiveTurn.id.in_(ids))
            .delete(synchronize_session=False)
        )
        db.commit()
        turns += deleted_turns
        scores += deleted_scores
        if deleted_turns < BATCH_SIZE:
            return turns, scores


def purge_live(
    session_factory: Callable[[], Session], *, retention_days: int, now: datetime
) -> dict[str, int]:
    """Purge expired turns and canaries, retaining daily rows for 730 days."""
    cutoff = now - timedelta(days=retention_days)
    counts = {"turns": 0, "scores": 0, "canaries": 0, "days": 0}
    with session_factory() as db:
        counts["turns"], counts["scores"] = _purge_turns(db, cutoff.date())
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
