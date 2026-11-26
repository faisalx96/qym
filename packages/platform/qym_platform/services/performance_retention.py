"""Delete performance data that is older than its retention, in committed batches.

Questions and log lines go first (by the end of their run), then the report
files (by the day they arrived), then whole runs with everything that belongs
to them, then runner events. A run that has not ended is never touched.
Targets, tokens and runners are kept. Called hourly by the maintenance loop,
which also calls ``sweep_stale`` every few seconds.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from qym_platform.db.models import (
    PERFORMANCE_FINAL_RUN_STATUSES,
    AuditLog,
    PerformanceEvent,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceDashboardStep,
    PerformanceReport,
    PerformanceRun,
    PerformanceTargetToken,
)
from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)

BATCH_SIZE = 1000
# Runs are deleted with all their rows, so fewer of them go in one transaction.
RUN_BATCH_SIZE = 50


def _ended_before(cutoff: datetime) -> Any:
    """Runs that ended before the cutoff; a run that is not final never matches."""
    return select(PerformanceRun.id).where(
        PerformanceRun.status.in_(PERFORMANCE_FINAL_RUN_STATUSES),
        PerformanceRun.finished_at.is_not(None),
        PerformanceRun.finished_at < cutoff,
    )


def _purge_details(db: Session, model: Any, cutoff: datetime) -> int:
    """Delete one detail table's rows of runs that ended before the cutoff."""
    deleted = 0
    while True:
        ids = [
            row[0]
            for row in db.execute(
                select(model.id)
                .where(model.run_id.in_(_ended_before(cutoff)))
                .order_by(model.id)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            ).all()
        ]
        # SQLite ignores FOR UPDATE, so the DELETE checks the run's end again.
        deleted += (
            db.query(model)
            .filter(model.id.in_(ids), model.run_id.in_(_ended_before(cutoff)))
            .delete(synchronize_session=False)
        )
        db.commit()
        if len(ids) < BATCH_SIZE:
            return deleted


def _purge_reports(db: Session, cutoff: datetime) -> int:
    """Delete report files that arrived before the cutoff, without reading a file."""
    deleted = 0
    while True:
        ids = [
            row[0]
            for row in db.execute(
                select(PerformanceReport.run_id)
                .where(PerformanceReport.received_at < cutoff)
                .order_by(PerformanceReport.run_id)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            ).all()
        ]
        deleted += (
            db.query(PerformanceReport)
            .filter(
                PerformanceReport.run_id.in_(ids),
                PerformanceReport.received_at < cutoff,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
        if len(ids) < BATCH_SIZE:
            return deleted


def _purge_runs(db: Session, cutoff: datetime) -> dict[str, int]:
    """Delete runs that ended before the cutoff, with their questions, log, report and events."""
    counts = {
        "steps": 0,
        "runs": 0,
        "questions": 0,
        "log_lines": 0,
        "reports": 0,
        "events": 0,
    }
    children = (
        ("steps", PerformanceDashboardStep),
        ("questions", PerformanceQuestion),
        ("log_lines", PerformanceLogLine),
        ("reports", PerformanceReport),
        ("events", PerformanceEvent),
    )
    while True:
        ids = [
            row[0]
            for row in db.execute(
                _ended_before(cutoff)
                .order_by(PerformanceRun.id)
                .limit(RUN_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            ).all()
        ]
        eligible = _ended_before(cutoff).where(PerformanceRun.id.in_(ids))
        # The children go first and by name: SQLite does not follow the cascade.
        for name, model in children:
            counts[name] += (
                db.query(model)
                .filter(model.run_id.in_(eligible))
                .delete(synchronize_session=False)
            )
        counts["runs"] += (
            db.query(PerformanceRun)
            .filter(PerformanceRun.id.in_(eligible))
            .delete(synchronize_session=False)
        )
        db.commit()
        if len(ids) < RUN_BATCH_SIZE:
            return counts


def _purge_events(db: Session, cutoff: datetime) -> int:
    """Delete runner events older than the cutoff."""
    deleted = 0
    while True:
        ids = [
            row[0]
            for row in db.execute(
                select(PerformanceEvent.id)
                .where(PerformanceEvent.at < cutoff)
                .order_by(PerformanceEvent.id)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            ).all()
        ]
        deleted += (
            db.query(PerformanceEvent)
            .filter(PerformanceEvent.id.in_(ids), PerformanceEvent.at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if len(ids) < BATCH_SIZE:
            return deleted


def _purge_cookie_history(db: Session, now: datetime) -> int:
    from qym_platform.services.performance_platform import prune_cookie_history

    deleted = 0
    last_id = ""
    while True:
        rows = list(
            db.scalars(
                select(PerformanceTargetToken)
                .where(
                    PerformanceTargetToken.id > last_id,
                    PerformanceTargetToken.history_encrypted.is_not(None),
                )
                .order_by(PerformanceTargetToken.id)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        )
        for row in rows:
            deleted += prune_cookie_history(db, row, now)
        db.commit()
        if len(rows) < BATCH_SIZE:
            return deleted
        last_id = rows[-1].id


def purge_performance(
    session_factory: Callable[[], Session], *, now: datetime
) -> dict[str, int]:
    """Purge expired questions, log lines, report files, runs and events; returns the counts.

    One ``performance_retention`` audit row is written when anything was deleted.
    """
    settings = PlatformSettings()
    counts = {"questions": 0, "log_lines": 0, "reports": 0, "runs": 0, "events": 0}
    if not settings.performance_enabled:
        return counts
    detail_cutoff = now - timedelta(days=settings.performance_detail_retention_days)
    with session_factory() as db:
        steps = _purge_details(db, PerformanceDashboardStep, detail_cutoff)
        if steps:
            counts["steps"] = steps
        counts["questions"] = _purge_details(db, PerformanceQuestion, detail_cutoff)
        counts["log_lines"] = _purge_details(db, PerformanceLogLine, detail_cutoff)
        counts["reports"] = _purge_reports(
            db, now - timedelta(days=settings.performance_report_retention_days)
        )
        with_runs = _purge_runs(
            db, now - timedelta(days=settings.performance_retention_days)
        )
        for name, value in with_runs.items():
            if value or name in counts:
                counts[name] = counts.get(name, 0) + value
        counts["events"] += _purge_events(
            db, now - timedelta(days=settings.performance_events_retention_days)
        )
        versions = _purge_cookie_history(db, now)
        if versions:
            counts["cookie_versions"] = versions
        if any(counts.values()):
            db.add(
                AuditLog(
                    actor_user_id=None,
                    action="performance_retention",
                    entity_type="performance_run",
                    entity_id="all",
                    before={},
                    after=counts,
                )
            )
            db.commit()
    logger.info("performance retention deleted %s", counts)
    return counts


def sweep_stale(session_factory: Callable[[], Session], *, now: datetime) -> int:
    """End runs whose runner went silent and runs nobody claimed; returns how many.

    The state rules themselves live in ``performance_state``; this opens the
    session, calls them and commits.
    """
    if not PlatformSettings().performance_enabled:
        return 0
    from qym_platform.services.performance_state import sweep_stale_runs

    with session_factory() as db:
        ended = sweep_stale_runs(db, now=now)
        db.commit()
    return ended
