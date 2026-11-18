"""Live retention cutoffs and scheduled maintenance on both databases."""

from __future__ import annotations

import hashlib
import zlib
from datetime import date, datetime, timedelta

import pytest
from _live_support import _png, seed_week
from qym_platform.db.models import (
    AuditLog,
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

    counts = purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    )

    assert counts == {
        "turns": 16, "scores": 96, "chart_images": 16, "chart_images_expired": 0,
        "chart_snapshots": 0, "chart_styles": 0,
        "canaries": 2, "days": 0, "jobs": 0, "events": 0,
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

    assert purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    ) == {
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
        assert db.query(AuditLog).filter_by(action="live_retention").count() == 1


@pytest.mark.parametrize("batch_size", [4, 10])
def test_purge_expires_chart_images_by_upload_age(
    session_factory, monkeypatch, batch_size
):
    from qym_platform.services.live_retention import purge_live

    monkeypatch.setattr("qym_platform.services.live_retention.BATCH_SIZE", batch_size)
    image = _png()
    image_cutoff = NOW - timedelta(days=30)
    old = image_cutoff - timedelta(microseconds=1)

    def chart(turn, ref, received_at):
        return LiveChartImage(
            turn_pk=turn.id,
            ref=ref,
            content_type="image/png",
            byte_size=len(image),
            width=3,
            height=2,
            sha256=hashlib.sha256(image).hexdigest(),
            image=image,
            received_at=received_at,
        )

    with session_factory() as db:
        turns = db.query(LiveTurn).order_by(LiveTurn.id).all()
        expired_turns = [turn for turn in turns if turn.day < date(2026, 10, 29)]
        kept_turns = [turn for turn in turns if turn.day >= date(2026, 10, 29)]
        assert (len(expired_turns), len(kept_turns)) == (16, 24)
        for turn in expired_turns:
            db.add(chart(turn, "first", old))
        # Every kept turn is far older than the image limit: only the upload counts.
        for index, turn in enumerate(kept_turns):
            db.add(chart(turn, "first", old if index < 10 else image_cutoff))
            if index < 5:
                # A backfill uploaded this screenshot yesterday for the old turn.
                db.add(chart(turn, "second", NOW - timedelta(days=1)))
        db.commit()
        kept_turn_ids = {turn.id for turn in kept_turns}
        kept_scores = db.execute(
            select(LiveTurnScore.__table__)
            .where(LiveTurnScore.turn_pk.in_(kept_turn_ids))
            .order_by(LiveTurnScore.id)
        ).all()
        kept_images = db.execute(
            select(LiveChartImage.__table__)
            .where(
                LiveChartImage.turn_pk.in_(kept_turn_ids),
                LiveChartImage.received_at >= image_cutoff,
            )
            .order_by(LiveChartImage.id)
        ).all()
        assert len(kept_scores) == 144
        assert len(kept_images) == 19

    counts = purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    )

    # Screenshots deleted with their turn and those deleted by age are counted apart.
    assert counts == {
        "turns": 16, "scores": 96, "chart_images": 16, "chart_images_expired": 10,
        "chart_snapshots": 0, "chart_styles": 0,
        "canaries": 0, "days": 0, "jobs": 0, "events": 0,
    }
    with session_factory() as db:
        assert {row.id for row in db.query(LiveTurn)} == kept_turn_ids
        assert (
            db.execute(select(LiveTurnScore.__table__).order_by(LiveTurnScore.id)).all()
            == kept_scores
        )
        assert (
            db.execute(select(LiveChartImage.__table__).order_by(LiveChartImage.id)).all()
            == kept_images
        )
        assert (
            db.query(AuditLog).filter_by(action="live_retention").one().after == counts
        )


def _style(source_id, name, received_at):
    css = zlib.compress(name.encode())
    return LiveChartStyle(
        source_id=source_id,
        sha256=hashlib.sha256(name.encode()).hexdigest(),
        css=css,
        css_size=len(name),
        byte_size=len(css),
        received_at=received_at,
    )


def _snapshot(turn, style, received_at, ref="first"):
    html = zlib.compress(b"<html><head></head><body></body></html>")
    return LiveChartSnapshot(
        turn_pk=turn.id,
        ref=ref,
        html=html,
        html_size=39,
        byte_size=len(html),
        sha256="0" * 64,
        style_sha256=style.sha256,
        viewport_width=1248,
        box_x=0,
        box_y=0,
        box_width=1248,
        box_height=462,
        received_at=received_at,
    )


@pytest.mark.parametrize("batch_size", [5, 16])
def test_purge_deletes_snapshots_with_turns_and_then_unused_styles(
    session_factory, monkeypatch, batch_size
):
    from qym_platform.services.live_retention import purge_live

    monkeypatch.setattr("qym_platform.services.live_retention.BATCH_SIZE", batch_size)
    long_ago = NOW - timedelta(days=170)
    with session_factory() as db:
        source = db.query(LiveSource).one()
        other = LiveSource(project_id="p", key="other", name="Other", environment="test")
        db.add(other)
        db.flush()
        styles = {
            # Named by a snapshot of a kept turn.
            "used": _style(source.id, "used", long_ago),
            # Named only by snapshots that go with their turns in this run.
            "expiring": _style(source.id, "expiring", long_ago),
            "orphan": _style(source.id, "orphan", NOW - timedelta(days=1, seconds=1)),
            # Not named yet, but inside the one-day grace: its snapshot may follow.
            "boundary": _style(source.id, "boundary", NOW - timedelta(days=1)),
            "fresh": _style(source.id, "fresh", NOW - timedelta(hours=1)),
            # The same stylesheet under another source, which has no snapshot of it.
            "elsewhere": _style(other.id, "used", long_ago),
        }
        db.add_all(styles.values())
        turns = db.query(LiveTurn).order_by(LiveTurn.id).all()
        kept_turns = [turn for turn in turns if turn.day >= date(2026, 10, 29)]
        for turn in turns:
            if turn.day < date(2026, 10, 29):
                db.add(_snapshot(turn, styles["expiring"], long_ago))
        # Far older than the 30-day image limit, which does not apply to snapshots.
        for turn in kept_turns[:3]:
            db.add(_snapshot(turn, styles["used"], long_ago))
        db.commit()
        kept_snapshots = db.execute(
            select(LiveChartSnapshot.__table__)
            .where(LiveChartSnapshot.turn_pk.in_([turn.id for turn in kept_turns]))
            .order_by(LiveChartSnapshot.id)
        ).all()
        kept_styles = {styles[name].id for name in ("used", "boundary", "fresh")}
        assert len(kept_snapshots) == 3
        assert db.query(LiveChartSnapshot).count() == 19

    counts = purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    )

    assert counts == {
        "turns": 16, "scores": 96, "chart_images": 0, "chart_images_expired": 0,
        "chart_snapshots": 16, "chart_styles": 3,
        "canaries": 0, "days": 0, "jobs": 0, "events": 0,
    }
    with session_factory() as db:
        assert (
            db.execute(
                select(LiveChartSnapshot.__table__).order_by(LiveChartSnapshot.id)
            ).all()
            == kept_snapshots
        )
        assert {row.id for row in db.query(LiveChartStyle.id)} == kept_styles
        assert (
            db.query(AuditLog).filter_by(action="live_retention").one().after == counts
        )

    again = purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    )
    assert not any(again.values())


def test_postgres_purge_skips_styles_of_a_source_that_is_being_written(database):
    from qym_platform.services.live_retention import purge_live

    if database.dialect.name != "postgresql":
        pytest.skip("SQLite has no row locks")
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        source = LiveSource(project_id="p", key="worker", name="Worker", environment="test")
        db.add(source)
        db.flush()
        db.add(_style(source.id, "orphan", NOW - timedelta(days=2)))
        db.commit()
        source_id = source.id

    def purge():
        return purge_live(
            factory, retention_days=180, chart_image_retention_days=30, now=NOW
        )["chart_styles"]

    with factory() as writer:
        # An ingest request holds this lock while it checks and stores a snapshot.
        writer.query(LiveSource).filter_by(id=source_id).with_for_update().one()
        assert purge() == 0
        with factory() as db:
            assert db.query(LiveChartStyle).count() == 1
        writer.rollback()
    assert purge() == 1
    with factory() as db:
        assert db.query(LiveChartStyle).count() == 0


def test_sqlite_repush_after_batch_selection_survives_purge(tmp_path, monkeypatch):
    from test_live_ingest_sources import _seed_api_key

    from qym_platform.api.live_ingest import TurnBody
    from qym_platform.db.base import Base
    from qym_platform.services.live_ingest import upsert_chart_image, upsert_turns
    from qym_platform.services.live_retention import purge_live
    from qym_platform.settings import PlatformSettings

    # Uploads are stamped NOW, inside the image limit.
    monkeypatch.setattr("qym_platform.services.live_ingest.utcnow", lambda: NOW)
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
            counts = purge_live(
                factory, retention_days=180, chart_image_retention_days=30, now=NOW
            )
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
            "turns": 1, "scores": 1, "chart_images": 1, "chart_images_expired": 0,
            "chart_snapshots": 0, "chart_styles": 0,
            "canaries": 0, "days": 0, "jobs": 0, "events": 0,
        }
    finally:
        engine.dispose()


def test_sqlite_image_replaced_after_batch_selection_survives_expiry(
    tmp_path, monkeypatch
):
    from test_live_ingest_sources import _seed_api_key

    from qym_platform.api.live_ingest import TurnBody
    from qym_platform.db.base import Base
    from qym_platform.services.live_ingest import upsert_chart_image, upsert_turns
    from qym_platform.services.live_retention import purge_live
    from qym_platform.settings import PlatformSettings

    clock = {"now": NOW - timedelta(days=31)}
    monkeypatch.setattr(
        "qym_platform.services.live_ingest.utcnow", lambda: clock["now"]
    )
    engine = create_engine(f"sqlite:///{tmp_path / 'live-image-expiry-race.db'}")
    factory = sessionmaker(bind=engine, autoflush=False)
    settings = PlatformSettings()
    ref = "chart_20261101_abcd1234"
    old_image, new_image = _png(), _png(width=2, height=1)

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
                    TurnBody(
                        turn_id=name,
                        turn_at=clock["now"],
                        status="completed",
                        question="Question?",
                        summary={"charts": [{"ref": ref}]},
                        scores=[{"metric_name": "accuracy", "score_numeric": 0.5}],
                    )
                    for name in ("replaced", "expired")
                ],
                settings,
            )
            assert report["accepted"] == 2
            for name in ("replaced", "expired"):
                upsert_chart_image(db, source, name, ref, old_image, settings)
            db.commit()

        selected = replaced = False

        def replace_before_delete(
            conn, cursor, statement, parameters, context, executemany
        ):
            nonlocal selected, replaced
            if statement.startswith("SELECT live_chart_images.id"):
                selected = True
            if (
                replaced
                or not selected
                or not statement.startswith("DELETE FROM live_chart_images")
            ):
                return
            # Replace on a second connection after selection, before the DELETE.
            replaced = True
            clock["now"] = NOW
            with factory() as db:
                assert (
                    db.connection().connection.driver_connection
                    is not conn.connection.driver_connection
                )
                source = db.get(LiveSource, source_id)
                status = upsert_chart_image(
                    db, source, "replaced", ref, new_image, settings
                )
                assert status == "replaced"
                db.commit()

        event.listen(engine, "before_cursor_execute", replace_before_delete)
        try:
            counts = purge_live(
                factory, retention_days=180, chart_image_retention_days=30, now=NOW
            )
        finally:
            event.remove(engine, "before_cursor_execute", replace_before_delete)

        assert replaced
        assert counts == {
            "turns": 0, "scores": 0, "chart_images": 0, "chart_images_expired": 1,
            "chart_snapshots": 0, "chart_styles": 0,
            "canaries": 0, "days": 0, "jobs": 0, "events": 0,
        }
        with factory() as db:
            assert db.query(LiveTurn).count() == 2
            assert db.query(LiveTurnScore).count() == 2
            chart = db.query(LiveChartImage).one()
            kept = db.query(LiveTurn).filter_by(turn_id="replaced").one()
            assert chart.turn_pk == kept.id
            assert chart.image == new_image and chart.received_at == NOW
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

    counts = purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    )

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

    def purge(factory, *, retention_days, chart_image_retention_days, now):
        calls.append((factory, retention_days, chart_image_retention_days, now))
        return {"turns": 0, "scores": 0, "chart_images": 0, "canaries": 0, "days": 0}

    monkeypatch.setenv("QYM_LIVE_RETENTION_DAYS", "180")
    monkeypatch.setenv("QYM_LIVE_CHART_IMAGE_RETENTION_DAYS", "45")
    monkeypatch.setattr(datetime_utils, "utc_now_naive", lambda: NOW)
    monkeypatch.setattr(retention, "run_retention", lambda engine, **kwargs: {})
    monkeypatch.setattr(
        feedback_retention, "run_purge", lambda factory: calls.append("feedback")
    )
    monkeypatch.setattr(live_retention, "purge_live", purge)
    worker = maintenance.MaintenanceWorker(session_factory, database)
    worker._next_retention = 0

    worker._maybe_run_retention()

    assert calls == ["feedback", (session_factory, 180, 45, NOW)]


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
    counts = purge_live(
        session_factory, retention_days=180, chart_image_retention_days=30, now=NOW
    )
    assert counts["jobs"] == counts["events"] == 1
    with session_factory() as db:
        assert {job.id for job in db.query(LiveJob)} == {"boundary", "running"}
        assert {row.message for row in db.query(LiveWorkerEvent)} == {"30", "1"}
