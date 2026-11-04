"""Live retention cutoffs and scheduled maintenance on both databases."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta

import pytest
from _live_support import _png, seed_week
from qym_platform.db.models import (
    AuditLog,
    LiveCanaryResult,
    LiveChartImage,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
)
from sqlalchemy import create_engine, event, select
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


@pytest.mark.parametrize("batch_size", [5, 16])
def test_purge_deletes_old_turns_scores_and_canaries_only(
    session_factory, monkeypatch, batch_size
):
    from qym_platform.services.live_retention import purge_live

    monkeypatch.setattr("qym_platform.services.live_retention.BATCH_SIZE", batch_size)
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
        image = _png()
        for turn in db.query(LiveTurn):
            db.add(
                LiveChartImage(
                    turn_pk=turn.id,
                    ref="chart_20261101_abcd1234",
                    content_type="image/png",
                    byte_size=len(image),
                    width=3,
                    height=2,
                    sha256=hashlib.sha256(image).hexdigest(),
                    image=image,
                    received_at=NOW,
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
        kept_images = db.execute(
            select(LiveChartImage.__table__)
            .where(LiveChartImage.turn_pk.in_(kept_turn_ids))
            .order_by(LiveChartImage.id)
        ).all()
        kept_canaries = db.execute(
            select(LiveCanaryResult.__table__)
            .where(LiveCanaryResult.checked_at >= cutoff)
            .order_by(LiveCanaryResult.id)
        ).all()
        assert len(old_turn_ids) == 16
        assert len(kept_turn_ids) == 24
        assert len(kept_scores) == 144
        assert len(kept_images) == 24
        assert len(kept_canaries) == 5

    counts = purge_live(session_factory, retention_days=180, now=NOW)

    assert counts == {
        "turns": 16, "scores": 96, "chart_images": 16, "canaries": 2, "days": 0, "jobs": 0, "events": 0
    }
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
            db.execute(select(LiveChartImage.__table__).order_by(LiveChartImage.id)).all()
            == kept_images
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
        "chart_images": 0,
        "canaries": 0,
        "days": 0,
        "jobs": 0,
        "events": 0,
    }
    with session_factory() as db:
        assert db.query(AuditLog).filter_by(action="live_retention").count() == 1


def test_sqlite_repush_after_batch_selection_survives_purge(tmp_path):
    from test_live_ingest_sources import _seed_api_key

    from qym_platform.api.live_ingest import TurnBody
    from qym_platform.db.base import Base
    from qym_platform.services.live_ingest import upsert_chart_image, upsert_turns
    from qym_platform.services.live_retention import purge_live
    from qym_platform.settings import PlatformSettings

    engine = create_engine(f"sqlite:///{tmp_path / 'live-retention-race.db'}")
    factory = sessionmaker(bind=engine, autoflush=False)
    settings = PlatformSettings()
    cutoff = date(2026, 10, 29)
    ref = "chart_20261101_abcd1234"
    image = _png()

    def turn(turn_id, day, score):
        return TurnBody(
            turn_id=turn_id,
            day=day,
            turn_at=datetime(2026, 10, 28, 12),
            status="completed",
            question="Question?",
            summary={"charts": [{"ref": ref}]},
            scores=[{"metric_name": "accuracy", "score_numeric": score}],
        )

    try:
        Base.metadata.create_all(engine)
        with factory() as db:
            _seed_api_key(db)
            source = LiveSource(
                project_id="live-project-1",
                key="worker",
                name="Worker",
                environment="test",
            )
            db.add(source)
            db.flush()
            source_id = source.id
            report = upsert_turns(
                db,
                source,
                [
                    turn(name, cutoff - timedelta(days=1), 0.5)
                    for name in ("repushed", "expired")
                ],
                settings,
            )
            assert report["accepted"] == 2
            for name in ("repushed", "expired"):
                upsert_chart_image(db, source, name, ref, image, settings)
            db.commit()
            turn_ids = {row.turn_id: row.id for row in db.query(LiveTurn)}

        repushed = False

        def repush_before_children(
            conn, cursor, statement, parameters, context, executemany
        ):
            nonlocal repushed
            if repushed or not statement.startswith("DELETE FROM live_chart_images"):
                return
            # Re-push on a second connection after selection, before any child DELETE.
            repushed = True
            with factory() as db:
                assert (
                    db.connection().connection.driver_connection
                    is not conn.connection.driver_connection
                )
                report = upsert_turns(
                    db,
                    db.get(LiveSource, source_id),
                    [turn("repushed", cutoff + timedelta(days=1), 0.9)],
                    settings,
                )
                assert report["updated"] == 1 and report["rejected"] == 0
                db.commit()

        event.listen(engine, "before_cursor_execute", repush_before_children)
        try:
            counts = purge_live(factory, retention_days=180, now=NOW)
        finally:
            event.remove(engine, "before_cursor_execute", repush_before_children)

        assert repushed
        with factory() as db:
            kept = db.query(LiveTurn).one()
            assert kept.id == turn_ids["repushed"]
            assert kept.day == cutoff + timedelta(days=1)
            assert db.get(LiveTurn, turn_ids["expired"]) is None
            score = db.query(LiveTurnScore).one()
            assert score.turn_pk == kept.id and score.score_numeric == 0.9
            chart = db.query(LiveChartImage).one()
            assert chart.turn_pk == kept.id and chart.image == image
        assert counts == {
            "turns": 1, "scores": 1, "chart_images": 1, "canaries": 0, "days": 0, "jobs": 0, "events": 0
        }
    finally:
        engine.dispose()


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
        return {"turns": 0, "scores": 0, "chart_images": 0, "canaries": 0, "days": 0}

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


def test_purge_removes_old_jobs_and_events(session_factory, monkeypatch):
    from qym_platform.db.models import LiveJob, LiveWorkerEvent
    from qym_platform.services.live_retention import purge_live

    monkeypatch.setenv("QYM_LIVE_JOBS_RETENTION_DAYS", "90")
    monkeypatch.setenv("QYM_LIVE_EVENTS_RETENTION_DAYS", "30")
    monkeypatch.setattr("qym_platform.services.live_retention.BATCH_SIZE", 1)
    with session_factory() as db:
        source = db.query(LiveSource).one()
        for job_id, status, finished in (
            ("old", "done", NOW - timedelta(days=91)),
            ("boundary", "done", NOW - timedelta(days=90)),
            ("running", "running", None),
        ):
            db.add(
                LiveJob(
                    id=job_id,
                    source_id=source.id,
                    kind="backfill",
                    status=status,
                    finished_at=finished,
                )
            )
        for age in (31, 30, 1):
            db.add(
                LiveWorkerEvent(
                    source_id=source.id,
                    level="error",
                    component="database",
                    code="connect",
                    message=str(age),
                    fingerprint=str(age),
                    first_at=NOW - timedelta(days=age),
                    last_at=NOW - timedelta(days=age),
                )
            )
        db.commit()
    counts = purge_live(session_factory, retention_days=180, now=NOW)
    assert counts["jobs"] == counts["events"] == 1
    with session_factory() as db:
        assert {job.id for job in db.query(LiveJob)} == {"boundary", "running"}
        assert {row.message for row in db.query(LiveWorkerEvent)} == {"30", "1"}
