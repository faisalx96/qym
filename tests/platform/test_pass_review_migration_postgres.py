"""Recover real pre-0057 approvals without losing evidence or review history."""

from copy import deepcopy
from datetime import datetime

from alembic import command
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    CorrectionStatus,
    Project,
    ProjectAnalysisCategoryCatalogVersion,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session
from test_migrations import _load_migration
from test_p1_migrations_lifecycle import postgres


def test_populated_0050_upgrade_recovers_approvals_and_retains_tombstones(postgres):
    engine, config = postgres
    command.upgrade(config, "0050")
    reviewed_at = datetime(2026, 9, 15, 10)
    with Session(engine) as db:
        db.info["dashboard_projection_worker"] = True
        user = User(id="u", email="u@example.test")
        db.add(user)
        db.flush()
        db.add(Project(id="p", name="Project", slug="p", created_by_user_id="u"))
        db.flush()
        db.add(
            Run(
                id="r",
                project_id="p",
                owner_user_id="u",
                created_by_user_id="u",
                task="task",
                dataset="dataset",
                metrics=["accuracy"],
                samples=2,
                status=RunWorkflowStatus.COMPLETED,
            )
        )
        db.flush()
        db.add(
            RunItem(
                run_id="r", item_id="i", index=0, input="question", output="pass two"
            )
        )
        db.add(
            RunItemScore(
                run_id="r", item_id="i", metric_name="accuracy", score_numeric=0.5
            )
        )
        for number in (1, 2):
            analysis = {
                "source": "ai",
                "root_cause_issues": [
                    {
                        "issue_id": "shared-issue",
                        "category": "Approved category",
                        "finding": f"Pass {number} finding",
                        "review_status": "approved",
                        "reviewed_at": "2026-09-15T10:00:00Z",
                        "reviewed_by_user_id": "u",
                    },
                    {"category": "Unapproved category", "finding": "Pending sibling"},
                ],
            }
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id="i",
                    metric_name="accuracy",
                    pass_number=number,
                    score_numeric=number / 10,
                    meta={PASS_ANALYSIS_META_KEY: analysis},
                )
            )
            db.add(
                RunItemAttempt(
                    run_id="r",
                    item_id="i",
                    pass_number=number,
                    attempt_number=1,
                    status="completed",
                    is_last_attempt=True,
                    output=f"pass {number}",
                )
            )
        # A real legacy aggregate approval has neither of the new columns.
        db.execute(
            ReviewCorrection.__table__.insert().values(
                run_id="r",
                item_id="i",
                metric_name="accuracy",
                task="task",
                ai_root_cause="Classic category",
                human_root_cause="Classic category",
                status=CorrectionStatus.APPROVED,
                is_active=True,
                reviewed_at=reviewed_at,
                reviewed_by_user_id="u",
            )
        )
        for run_id in ("collapsed", "unreviewed", "classic"):
            db.add(
                Run(
                    id=run_id,
                    project_id="p",
                    owner_user_id="u",
                    created_by_user_id="u",
                    task="task",
                    dataset="dataset",
                    metrics=["accuracy"],
                    samples=1,
                    run_metadata={"preserve": {"run_id": run_id}},
                    status=RunWorkflowStatus.COMPLETED,
                )
            )
            db.flush()
            db.add(
                RunItem(
                    run_id=run_id, item_id="i", index=0, input="question", output=run_id
                )
            )
            db.add(
                RunItemScore(
                    run_id=run_id,
                    item_id="i",
                    metric_name="accuracy",
                    score_numeric=0.2,
                )
            )
            if run_id != "classic":
                retained_analysis = deepcopy(analysis)
                if run_id == "unreviewed":
                    retained_analysis["root_cause_issues"][0][
                        "review_status"
                    ] = "pending"
                db.add(
                    RunItemPassScore(
                        run_id=run_id,
                        item_id="i",
                        metric_name="accuracy",
                        pass_number=1,
                        score_numeric=0.2,
                        meta={PASS_ANALYSIS_META_KEY: retained_analysis},
                    )
                )
                db.add(
                    RunItemAttempt(
                        run_id=run_id,
                        item_id="i",
                        pass_number=1,
                        attempt_number=1,
                        status="completed",
                        is_last_attempt=True,
                        output=run_id,
                    )
                )
        db.commit()

    with engine.connect() as conn:
        assert "pass_number" not in {
            column["name"] for column in inspect(conn).get_columns("review_corrections")
        }
        original_input = conn.scalar(
            text("SELECT input FROM run_items WHERE run_id='r'")
        )

    def recovered_snapshot():
        with Session(engine) as db:
            rows = db.scalars(
                select(ReviewCorrection)
                .where(ReviewCorrection.run_id == "r")
                .order_by(ReviewCorrection.pass_number, ReviewCorrection.id)
            ).all()
            scoped = [row for row in rows if row.pass_number is not None]
            assert len(scoped) == 4
            assert sum(row.status == CorrectionStatus.APPROVED for row in scoped) == 2
            assert sum(row.status == CorrectionStatus.PENDING for row in scoped) == 2
            assert all(row.pass_deleted_at is None for row in scoped)
            for row in scoped:
                assert row.output_snapshot == f"pass {row.pass_number}"
                assert row.scores_snapshot == {"accuracy": row.pass_number / 10}
                if row.status == CorrectionStatus.APPROVED:
                    assert (
                        row.reviewed_at == reviewed_at
                        and row.reviewed_by_user_id == "u"
                    )
            classic = [row for row in rows if row.pass_number is None]
            assert (
                len(classic) == 1 and classic[0].human_root_cause == "Classic category"
            )
            assert classic[0].reviewed_at == reviewed_at
            active_catalog = (
                db.query(ProjectAnalysisCategoryCatalogVersion)
                .filter_by(is_active=True)
                .one()
            )
            assert "Approved category" in active_catalog.categories
            assert "Classic category" in active_catalog.categories
            assert "Unapproved category" not in active_catalog.categories
            assert db.query(RunItem).filter_by(run_id="r").one().input == original_input
            for run_id in ("collapsed", "unreviewed"):
                metadata = db.get(Run, run_id).run_metadata
                assert metadata == {
                    "preserve": {"run_id": run_id},
                    "has_repeat_pass_context": True,
                    "pass_revision": 1,
                }
            assert db.get(Run, "classic").run_metadata == {
                "preserve": {"run_id": "classic"}
            }
            retained = (
                db.query(ReviewCorrection)
                .filter_by(run_id="collapsed")
                .order_by(ReviewCorrection.id)
                .all()
            )
            assert (
                len(retained) == 2 and retained[0].status == CorrectionStatus.APPROVED
            )
            assert (
                retained[0].pass_number == 1
                and retained[0].output_snapshot == "collapsed"
            )
            assert retained[0].reviewed_at == reviewed_at
            assert retained[1].status == CorrectionStatus.PENDING
            assert (
                db.query(ReviewCorrection).filter_by(run_id="unreviewed").count() == 0
            )
            return [
                (
                    row.pass_number,
                    row.status,
                    row.output_snapshot,
                    row.scores_snapshot,
                    row.reviewed_at,
                    row.reviewed_by_user_id,
                    deepcopy(row.human_root_cause_issues),
                    deepcopy(row.ai_root_cause_issues),
                )
                for row in rows
            ], db.query(ProjectAnalysisCategoryCatalogVersion).count()

    command.upgrade(config, "head")
    expected, catalog_count = recovered_snapshot()
    # Exercise the supported recovery path against the actual 0056 schema.
    command.downgrade(config, "0056")
    command.upgrade(config, "head")
    assert recovered_snapshot() == (expected, catalog_count)

    with Session(engine, autoflush=False) as db:
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        deleted_review_ids = [
            row.id
            for row in db.query(ReviewCorrection).filter_by(run_id="r", pass_number=1)
        ]
        runs_api.delete_run_pass("r", 1, db=db, principal=principal)
        tombstones = [
            (
                db.get(ReviewCorrection, row_id).id,
                db.get(ReviewCorrection, row_id).pass_deleted_at,
            )
            for row_id in deleted_review_ids
        ]
        assert all(timestamp is not None for _, timestamp in tombstones)
        assert db.get(Run, "r").samples == 1
        assert db.query(RunItem).filter_by(run_id="r").one().output == "pass 2"
        assert (
            db.query(ReviewCorrection)
            .filter_by(run_id="r", pass_number=1, is_active=True)
            .count()
            == 2
        )

    command.upgrade(config, "head")
    migration = _load_migration("0057_pass_review_records.py")
    with engine.begin() as conn:
        migration._backfill(conn)
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0058"
    with Session(engine) as db:
        assert [
            (
                db.get(ReviewCorrection, row_id).id,
                db.get(ReviewCorrection, row_id).pass_deleted_at,
            )
            for row_id in deleted_review_ids
        ] == tombstones
        assert all(
            not db.get(ReviewCorrection, row_id).is_active
            for row_id in deleted_review_ids
        )
        assert db.query(ProjectAnalysisCategoryCatalogVersion).count() == catalog_count
        assert db.query(ReviewCorrection).count() == 7
