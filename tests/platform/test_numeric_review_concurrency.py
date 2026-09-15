"""Numeric pass edits must preserve approvals committed by review routes."""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.api import analysis as analysis_api, runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.base import Base
from qym_platform.db.models import (
    CorrectionStatus,
    Project,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY
from test_issue_reviews import act
from test_pass_review_records import records


@pytest.fixture
def review_database():
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "numeric_review_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        with sessions() as db:
            actor = User(id="numeric-user", email="numeric@example.test")
            db.add(actor)
            db.flush()
            project = Project(
                id="numeric-project",
                name="Numeric",
                slug="numeric",
                created_by_user_id=actor.id,
            )
            db.add(project)
            db.flush()
            run = Run(
                id="numeric-run",
                project_id=project.id,
                owner_user_id=actor.id,
                created_by_user_id=actor.id,
                task="numeric",
                dataset="numeric",
                metrics=["accuracy"],
                samples=2,
                status=RunWorkflowStatus.COMPLETED,
            )
            db.add(run)
            db.flush()
            item = RunItem(
                run_id=run.id,
                item_id="numeric-item",
                index=0,
                input="question",
                output="answer",
                item_metadata={},
            )
            db.add(item)
            db.flush()
            db.add(
                RunItemScore(
                    run_id=run.id,
                    item_id=item.item_id,
                    metric_name="accuracy",
                    score_numeric=0.15,
                )
            )
            for number in (1, 2):
                db.add(
                    RunItemPassScore(
                        run_id=run.id,
                        item_id=item.item_id,
                        metric_name="accuracy",
                        pass_number=number,
                        score_numeric=number / 10,
                        meta={
                            "reason": "Judge reason",
                            PASS_ANALYSIS_META_KEY: {
                                "source": "ai",
                                "root_cause": "Review category",
                                "root_cause_issues": [
                                    {
                                        "issue_id": "issue-one",
                                        "category": "Review category",
                                        "finding": "First finding",
                                    },
                                    {
                                        "issue_id": "issue-two",
                                        "category": "Sibling category",
                                        "finding": "Second finding",
                                    },
                                ],
                            },
                        },
                    )
                )
            db.commit()
            principal = Principal(user=actor, auth_type="none")
            act(db, run, item, principal, "approve", pass_number=1)
            candidate_id = records(db, run, 1)[0].id
            analysis_api.reset_correction(candidate_id, db=db, principal=principal)
            run_id = run.id
        yield engine, sessions, run_id, candidate_id, principal
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def edit_score(db, run_id, principal):
    return runs_api.update_metric(
        {
            "file_path": run_id,
            "row_index": 0,
            "metric_name": "accuracy",
            "new_score": 0.7,
            "pass_number": 1,
            "expected_pass_version": 0,
        },
        db=db,
        principal=principal,
    )


def assert_score_and_approval(sessions, candidate_id):
    with sessions() as db:
        score = db.query(RunItemPassScore).filter_by(pass_number=1).one()
        assert score.score_numeric == 0.7
        assert score.meta["modified"] == "true"
        assert score.meta["reason"] == "Judge reason"
        assert (
            db.get(ReviewCorrection, candidate_id).status == CorrectionStatus.APPROVED
        )
        issues = score.meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]
        assert issues[0]["review_status"] == "approved"
        assert issues[1]["review_status"] == "pending"


def test_numeric_edit_and_review_approval_serialize_before_reading_pass_meta(
    review_database,
):
    engine, sessions, run_id, candidate_id, principal = review_database
    numeric_read, release_numeric, approval_started, approval_done = (
        Event(),
        Event(),
        Event(),
        Event(),
    )
    approval_pid = []

    def pause_numeric(db, instance):
        if (
            current_thread().name.startswith("numeric")
            and isinstance(instance, RunItemPassScore)
            and instance.pass_number == 1
            and not numeric_read.is_set()
        ):
            numeric_read.set()
            assert release_numeric.wait(10), "Numeric edit was not released"

    def numeric_edit():
        with sessions() as db:
            return edit_score(db, run_id, principal)

    def approve():
        with sessions() as db:
            approval_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            approval_started.set()
            try:
                return analysis_api.approve_correction(
                    candidate_id, {}, db=db, principal=principal
                )
            finally:
                approval_done.set()

    event.listen(Session, "loaded_as_persistent", pause_numeric)
    try:
        with ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="numeric"
        ) as numeric_pool, ThreadPoolExecutor(max_workers=1) as review_pool:
            numeric = numeric_pool.submit(numeric_edit)
            try:
                assert numeric_read.wait(10), "Numeric edit did not read its pass"
                review = review_pool.submit(approve)
                assert approval_started.wait(10)
                # Old code allows approval to commit over the paused stale
                # read; fixed code makes approval wait for the shared item lock.
                deadline = time.monotonic() + 10
                while not approval_done.is_set():
                    with engine.connect() as conn:
                        waiting = conn.scalar(
                            text(
                                "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"
                            ),
                            {"pid": approval_pid[0]},
                        )
                    if waiting:
                        break
                    assert (
                        time.monotonic() < deadline
                    ), "Approval neither completed nor reached a row lock"
                    time.sleep(0.01)
            finally:
                release_numeric.set()
            assert numeric.result(timeout=10)["ok"]
            assert review.result(timeout=10)["status"] == "approved"
    finally:
        release_numeric.set()
        event.remove(Session, "loaded_as_persistent", pause_numeric)
    assert_score_and_approval(sessions, candidate_id)


def test_numeric_edit_refreshes_preloaded_pass_metadata_after_approval(review_database):
    _, sessions, run_id, candidate_id, principal = review_database
    with sessions() as numeric, sessions() as review:
        preloaded = numeric.query(RunItemPassScore).filter_by(pass_number=1).one()
        assert (
            preloaded.meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
                "review_status"
            ]
            == "pending"
        )
        analysis_api.approve_correction(
            candidate_id, {}, db=review, principal=principal
        )
        assert edit_score(numeric, run_id, principal)["ok"]
    assert_score_and_approval(sessions, candidate_id)
