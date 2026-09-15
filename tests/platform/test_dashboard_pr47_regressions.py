"""Pending membership and soft-deletion regressions from PR 47 review."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.db.dashboard_models import DashboardBucketRollup as Bucket
from qym_platform.db.models import RunItemScore, RunWorkflowStatus
from test_dashboard_durable_summaries import (
    Dimension,
    Record,
    Run,
    Summary,
    database,
    drain,
    item,
    run,
    service,
)


def _read(engine):
    with Session(engine) as db:
        project = {"id": "p", "role": "MANAGER"}
        return (
            dashboard._overview(db, project, {}),
            dashboard._page(db, project, {}, limit=50, offset=0, sort="time-desc"),
        )


def test_pending_run_invalidates_warm_catalog_page_and_overview(database):
    with Session(database) as db:
        run(db)
        item(db)
        db.commit()
    drain(database)
    before, before_page = _read(database)
    with Session(database) as db:
        run(
            db,
            "pending",
            status=RunWorkflowStatus.COMPLETED,
            run_metadata={"total_items": 600},
        )
        for index in range(600):
            item(db, str(index), "pending")
        db.commit()
    # The default batch cannot publish all 600 item events. Its pending
    # descriptor is already visible and must be in every cached catalog.
    with Session(database) as db:
        service.drain_dashboard_changes(db, max_events=500)
        db.commit()
        assert db.get(Summary, "pending").projection_revision == 0
    after, after_page = _read(database)
    assert after["revision"] == before["revision"]
    assert after["catalog_revision"] != before["catalog_revision"]
    assert after["total_runs"] == 2
    assert after_page["total_runs"] == 2
    assert {row["run_id"] for row in after_page["rows"]} == {"r", "pending"}
    assert before_page["total_runs"] == 1
    drain(database)
    settled, page = _read(database)
    assert not settled["freshness"]["updating"]
    assert settled["catalog_revision"] != after["catalog_revision"]
    assert (
        next(row for row in page["rows"] if row["run_id"] == "pending")["summary_state"]
        == "published"
    )


def test_membership_fingerprint_cannot_collide_with_revision_sum(database):
    with Session(database) as db:
        run(db, "one")
        run(db, "two")
        db.commit()
    drain(database)
    with Session(database) as db:
        before = service.dashboard_freshness(db, ["p"])
        removed = db.get(Summary, "one")
        db.get(Summary, "two").projection_revision += removed.projection_revision
        db.delete(removed)
        db.commit()
        after = service.dashboard_freshness(db, ["p"])
        assert after["revision"] == before["revision"]
        assert after["catalog_revision"] != before["catalog_revision"]


def test_deleted_extreme_is_excluded_and_restore_recovers_it(database):
    with Session(database) as db:
        for run_id, latency, score in (("low", 10, 0.2), ("high", 90, 0.9)):
            run(db, run_id)
            item(db, run_id=run_id, latency_ms=latency)
            db.add(
                RunItemScore(
                    run_id=run_id,
                    item_id="i",
                    metric_name="score",
                    score_numeric=score,
                    meta={},
                )
            )
        db.commit()
    drain(database)

    def extrema():
        with Session(database) as db:
            buckets = list(db.scalars(select(Bucket)))
            assert {b.granularity for b in buckets} == {"hour", "day"}
            return {
                (b.latency_min, b.latency_max, b.score_min, b.score_max)
                for b in buckets
            }

    assert extrema() == {(10, 90, 0.2, 0.9)}
    with Session(database) as db:
        db.get(Run, "high").deleted_at = datetime.utcnow()
        db.commit()
    drain(database)
    assert extrema() == {(10, 10, 0.2, 0.2)}
    with Session(database) as db:
        assert not db.get(Dimension, "high").present
        assert all(
            row.present
            for row in db.scalars(
                select(Record).where(
                    Record.run_key == "high", Record.record_kind.in_(["item", "score"])
                )
            )
        )
        db.get(Run, "high").deleted_at = None
        db.commit()
    drain(database)
    assert extrema() == {(10, 90, 0.2, 0.9)}
