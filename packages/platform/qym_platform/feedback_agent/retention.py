"""Hourly purge of abandoned drafts (QE-164). Confirmed requests are never deleted here."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy.orm import Session

from qym_platform.db.feedback_models import FeedbackAgentConnection, FeedbackMessage, FeedbackRequest, FeedbackRequestEvent
from qym_platform.feedback_agent.constants import DEFAULT_RETENTION_DAYS
from qym_platform.feedback_agent.store import audit
from qym_platform.log import get_logger

logger = get_logger(__name__)


def purge_drafts(db: Session, now: Optional[datetime] = None) -> int:
    """Delete drafts idle for longer than ``draft_retention_days`` with their messages; one audit entry per pass."""
    now = now or datetime.utcnow()
    conn = db.get(FeedbackAgentConnection, 1)
    days = int(conn.draft_retention_days) if conn and conn.draft_retention_days else DEFAULT_RETENTION_DAYS
    cutoff = now - timedelta(days=days)
    ids = [
        r[0]
        for r in db.query(FeedbackRequest.id)
        .filter(FeedbackRequest.status == "draft", FeedbackRequest.last_activity_at < cutoff)
        .all()
    ]
    if not ids:
        return 0
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        db.query(FeedbackMessage).filter(FeedbackMessage.request_id.in_(chunk)).delete(synchronize_session=False)
        db.query(FeedbackRequestEvent).filter(FeedbackRequestEvent.request_id.in_(chunk)).delete(synchronize_session=False)
        db.query(FeedbackRequest).filter(FeedbackRequest.id.in_(chunk)).delete(synchronize_session=False)
    audit(db, None, "feedback.drafts_purged", "drafts", {}, {"count": len(ids), "retention_days": days})
    db.commit()
    logger.info("purged %d abandoned feedback drafts", len(ids))
    return len(ids)


def run_purge(session_factory: Callable[[], Session]) -> int:
    db = session_factory()
    try:
        return purge_drafts(db)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("feedback draft purge failed")
        return 0
    finally:
        db.close()
