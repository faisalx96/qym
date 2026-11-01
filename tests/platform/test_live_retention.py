"""Live retention cutoffs and scheduled maintenance on both databases."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from _live_support import seed_week
from qym_platform.db.models import (
    AuditLog,
    LiveCanaryResult,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
)
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

# The first three seeded days expire; October 29 through November 1 remain.
NOW = datetime(2026, 10, 29, 12) + timedelta(days=180)


@pytest.fixture()
def session_factory(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_week(db, "p")
        db.commit()
    return factory


def test_purge_deletes_old_turns_scores_and_canaries_only(session_factory):
    from qym_platform.services.live_retention import purge_live

    with session_factory() as db:
        source = db.query(LiveSource).one()
        cutoff = datetime(2026, 10, 29, 12)
        for checked_at in (
            cutoff - timedelta(days=1),
            cutoff - timedelta(microseconds=1),
            cutoff,
        ):
            db.add(
                LiveCanaryResult(
                    source_id=source.id,
                    canary="query",
                    checked_at=checked_at,
                    status="ok",
                )
            )
        db.commit()
        kept_turn_ids = {
            row.id
            for row in db.query(LiveTurn).filter(LiveTurn.day >= date(2026, 10, 29))
        }
        old_turn_ids = {
            row.id
            for row in db.query(LiveTurn).filter(LiveTurn.day < date(2026, 10, 29))
        }
        kept_scores = db.execute(
            select(LiveTurnScore.__table__)
            .where(LiveTurnScore.turn_pk.in_(kept_turn_ids))
            .order_by(LiveTurnScore.id)
        ).all()
        kept_canaries = db.execute(
            select(LiveCanaryResult.__table__)
            .where(LiveCanaryResult.checked_at >= cutoff)
            .order_by(LiveCanaryResult.id)
        ).all()
        assert len(old_turn_ids) == 16
        assert len(kept_turn_ids) == 24
        assert len(kept_scores) == 144
        assert len(kept_canaries) == 5

    counts = purge_live(session_factory, retention_days=180, now=NOW)

    assert counts == {"turns": 16, "scores": 96, "canaries": 2, "days": 0}
    with session_factory() as db:
        assert {row.id for row in db.query(LiveTurn)} == kept_turn_ids
        assert {row.day for row in db.query(LiveTurn)} == {
            date(2026, 10, 29),
            date(2026, 10, 30),
            date(2026, 10, 31),
            date(2026, 11, 1),
        }
        assert (
            db.query(LiveTurnScore)
            .filter(LiveTurnScore.turn_pk.in_(old_turn_ids))
            .count()
            == 0
        )
        assert (
            db.execute(select(LiveTurnScore.__table__).order_by(LiveTurnScore.id)).all()
            == kept_scores
        )
        assert (
            db.execute(
                select(LiveCanaryResult.__table__).order_by(LiveCanaryResult.id)
            ).all()
            == kept_canaries
        )
        assert db.query(LiveSource).count() == 1
        assert db.query(LiveMetricSpec).count() == 6
        entry = db.query(AuditLog).filter_by(action="live_retention").one()
        assert entry.actor_user_id is None
        assert entry.after == counts

    assert purge_live(session_factory, retention_days=180, now=NOW) == {
        "turns": 0,
        "scores": 0,
        "canaries": 0,
        "days": 0,
    }
    with session_factory() as db:
        assert db.query(AuditLog).filter_by(action="live_retention").count() == 1


def test_purge_keeps_day_rows_under_two_years(session_factory):
    from qym_platform.services.live_retention import purge_live

    with session_factory() as db:
        kept_days = db.execute(select(LiveDay.__table__).order_by(LiveDay.day)).all()
        assert len(kept_days) == 7
        old_day = LiveDay(
            source_id=db.query(LiveSource).one().id,
            day=(NOW - timedelta(days=800)).date(),
            status="closed",
        )
        db.add(old_day)
        db.commit()
        old_day_id = old_day.id

    counts = purge_live(session_factory, retention_days=180, now=NOW)

    assert counts["days"] == 1
    with session_factory() as db:
        assert db.get(LiveDay, old_day_id) is None
        assert (
            db.execute(select(LiveDay.__table__).order_by(LiveDay.day)).all()
            == kept_days
        )
        assert (
            db.query(AuditLog).filter_by(action="live_retention").one().after == counts
        )


def test_maintenance_loop_calls_purge_live(session_factory, database, monkeypatch):
    from qym_platform import datetime_utils
    from qym_platform.feedback_agent import retention as feedback_retention
    from qym_platform.services import live_retention, maintenance, retention

    calls = []

    def purge(factory, *, retention_days, now):
        calls.append((factory, retention_days, now))
        return {"turns": 0, "scores": 0, "canaries": 0, "days": 0}

    monkeypatch.setenv("QYM_LIVE_RETENTION_DAYS", "180")
    monkeypatch.setattr(datetime_utils, "utc_now_naive", lambda: NOW)
    monkeypatch.setattr(retention, "run_retention", lambda engine, **kwargs: {})
    monkeypatch.setattr(
        feedback_retention, "run_purge", lambda factory: calls.append("feedback")
    )
    monkeypatch.setattr(live_retention, "purge_live", purge)
    worker = maintenance.MaintenanceWorker(session_factory, database)
    worker._next_retention = 0

    worker._maybe_run_retention()

    assert calls == ["feedback", (session_factory, 180, NOW)]
