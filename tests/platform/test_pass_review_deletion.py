"""Pass removal must preserve review evidence without retargeting old actions."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event, current_thread

import pytest
from fastapi import HTTPException
from qym_platform.api import analysis as api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    AuditLog,
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
from qym_platform.services import repeat_passes
from qym_platform.services.approved_diagnoses import load_approved_diagnoses
from qym_platform.services.llm_analyzer import AnalysisResult
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from test_issue_reviews import act
from test_pass_review_records import records, repeat, reviews, score
from test_retention import migrated_postgres
from test_root_cause_issue_persistence import db_session


def _add_third_pass(db, run, item):
    run.samples = 3
    db.add(
        RunItemPassScore(
            run_id=run.id,
            item_id=item.item_id,
            metric_name="accuracy",
            pass_number=3,
            score_numeric=0.3,
            meta=deepcopy(score(db, run, 2).meta),
        )
    )
    db.add(
        RunItemAttempt(
            run_id=run.id,
            item_id=item.item_id,
            pass_number=3,
            attempt_number=1,
            status="completed",
            is_last_attempt=True,
            output={"answer": "Pass 3"},
        )
    )
    db.commit()


def _evidence(row):
    return deepcopy(
        {
            "output": row.output_snapshot,
            "scores": row.scores_snapshot,
            "ai_issues": row.ai_root_cause_issues,
            "human_issues": row.human_root_cause_issues,
            "status": row.status,
            "reviewed_by": row.reviewed_by_user_id,
            "reviewed_at": row.reviewed_at,
            "created_at": row.created_at,
        }
    )


def test_delete_pass_retains_evidence_and_remaps_surviving_history(db_session, repeat):
    run, item, principal, original = repeat
    _add_third_pass(db_session, run, item)
    # All passes intentionally reuse the same issue IDs. Pass number is part
    # of the identity, so a deleted review must never match a shifted pass.
    act(db_session, run, item, principal, "approve", pass_number=1)
    deleted = records(db_session, run, 1)[0]
    deleted_id = deleted.id
    deleted_evidence = _evidence(deleted)
    act(db_session, run, item, principal, "approve", pass_number=2)
    historical = records(db_session, run, 2)[0]
    api.update_correction(
        historical.id,
        {"human_solution": "Keep pass two's edited solution"},
        db=db_session,
        principal=principal,
    )
    historical_id = historical.id
    historical_evidence = _evidence(historical)
    current = next(row for row in records(db_session, run, 2) if row.human_solution)
    api.approve_correction(current.id, {}, db=db_session, principal=principal)
    current_id = current.id
    current_evidence = _evidence(current)
    pass_two_meta = deepcopy(score(db_session, run, 2).meta)
    catalogs = [
        (row.id, row.version, row.is_active, row.content_hash)
        for row in db_session.query(ProjectAnalysisCategoryCatalogVersion).order_by(
            ProjectAnalysisCategoryCatalogVersion.version
        )
    ]

    runs_api.delete_run_pass(run.id, 1, db=db_session, principal=principal)

    assert run.samples == 2
    assert item.item_metadata["metric_analyses"] == original["metric_analyses"]
    assert score(db_session, run, 1).meta == pass_two_meta
    deleted = db_session.get(ReviewCorrection, deleted_id)
    historical = db_session.get(ReviewCorrection, historical_id)
    current = db_session.get(ReviewCorrection, current_id)
    assert deleted.pass_deleted_at is not None and not deleted.is_active
    assert deleted.pass_number == 1
    assert _evidence(deleted) == deleted_evidence
    assert historical.pass_number == current.pass_number == 1
    assert historical.pass_deleted_at is current.pass_deleted_at is None
    assert _evidence(historical) == historical_evidence
    assert _evidence(current) == current_evidence
    assert [
        (row.id, row.version, row.is_active, row.content_hash)
        for row in db_session.query(ProjectAnalysisCategoryCatalogVersion).order_by(
            ProjectAnalysisCategoryCatalogVersion.version
        )
    ] == catalogs

    detail = api.get_correction(current_id, db=db_session, principal=principal)
    history_ids = {entry["review"]["id"] for entry in detail["history"]}
    assert historical_id in history_ids
    assert current_id in history_ids
    assert deleted_id not in history_ids
    retired_detail = api.get_correction(deleted_id, db=db_session, principal=principal)
    assert {entry["review"]["id"] for entry in retired_detail["history"]} == {
        deleted_id
    }
    listed = reviews(db_session, principal, status="approved")
    assert [row["id"] for row in listed["corrections"]] == [current_id]
    approved = load_approved_diagnoses(db_session, [run.id])[(run.id, item.item_id)]
    assert len(approved) == 1 and approved[0]["pass_number"] == 1
    audit = db_session.query(AuditLog).filter_by(action="run.pass_deleted").one()
    assert audit.after["retired_reviews"] == 2
    assert audit.after["pass_number_map"] == {"1": None, "2": 1, "3": 2}


@pytest.mark.parametrize("action", ["approve", "reject", "reset", "delete", "edit"])
def test_deleted_review_cannot_mutate_same_issue_id_on_shifted_pass(
    db_session, repeat, action
):
    run, item, principal, _ = repeat
    _add_third_pass(db_session, run, item)
    act(db_session, run, item, principal, "approve", pass_number=1)
    deleted_id = records(db_session, run, 1)[0].id
    act(db_session, run, item, principal, "approve", pass_number=2)
    runs_api.delete_run_pass(run.id, 1, db=db_session, principal=principal)
    before = deepcopy(score(db_session, run, 1).meta)
    with pytest.raises(HTTPException) as error:
        if action == "approve":
            api.approve_correction(deleted_id, {}, db=db_session, principal=principal)
        elif action == "reject":
            api.reject_correction(deleted_id, {}, db=db_session, principal=principal)
        elif action == "reset":
            api.reset_correction(deleted_id, db=db_session, principal=principal)
        elif action == "delete":
            api.delete_correction(deleted_id, db=db_session, principal=principal)
        else:
            api.update_correction(
                deleted_id,
                {"human_solution": "This must never reach the survivor"},
                db=db_session,
                principal=principal,
            )
    assert error.value.status_code == 409
    db_session.rollback()
    assert score(db_session, run, 1).meta == before


def test_last_surviving_pass_keeps_review_actions_and_output(db_session, repeat):
    run, item, principal, _ = repeat
    act(db_session, run, item, principal, "approve", pass_number=2)
    review_id = records(db_session, run, 2)[0].id
    runs_api.delete_run_pass(run.id, 1, db=db_session, principal=principal)
    assert run.samples == 1
    assert item.output == {"answer": "Pass 2"}
    current = db_session.get(ReviewCorrection, review_id)
    assert current.pass_number == 1 and current.is_active
    assert current.output_snapshot == {"answer": "Pass 2"}
    api.reset_correction(review_id, db=db_session, principal=principal)
    assert (
        score(db_session, run, 1).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
            "review_status"
        ]
        == "pending"
    )
    api.approve_correction(review_id, {}, db=db_session, principal=principal)
    assert current.status == CorrectionStatus.APPROVED
    act(
        db_session,
        run,
        item,
        principal,
        "edit",
        pass_number=1,
        issue={"category": "New approved category", "finding": "Edited sole pass"},
    )
    assert (
        score(db_session, run, 1).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
            "finding"
        ]
        == "Edited sole pass"
    )


def test_bulk_pass_deletion_preserves_tombstones_across_renumbering(db_session, repeat):
    run, item, principal, _ = repeat
    _add_third_pass(db_session, run, item)
    for number in (1, 2, 3):
        act(db_session, run, item, principal, "approve", pass_number=number)
    ids_by_pass = {
        number: records(db_session, run, number)[0].id for number in (1, 2, 3)
    }
    runs_api.delete_run_passes(
        run.id, {"pass_numbers": [1, 2]}, db=db_session, principal=principal
    )
    assert run.samples == 1
    first = db_session.get(ReviewCorrection, ids_by_pass[1])
    second = db_session.get(ReviewCorrection, ids_by_pass[2])
    survivor = db_session.get(ReviewCorrection, ids_by_pass[3])
    assert first.pass_deleted_at is not None and first.pass_number == 1
    assert second.pass_deleted_at is not None and second.pass_number == 2
    assert survivor.pass_deleted_at is None and survivor.pass_number == 1
    assert survivor.is_active and survivor.output_snapshot == {"answer": "Pass 3"}
    assert item.output == {"answer": "Pass 3"}
    assert {row.id for row in records(db_session, run, 1)} == {
        row.id
        for row in db_session.query(ReviewCorrection).filter_by(
            run_id=run.id, is_active=True
        )
    }


def test_bulk_deletion_rolls_back_review_changes_if_a_later_pass_is_missing(
    db_session, repeat
):
    run, item, principal, _ = repeat
    _add_third_pass(db_session, run, item)
    act(db_session, run, item, principal, "approve", pass_number=2)
    review = records(db_session, run, 2)[0]
    review_id = review.id
    before = _evidence(review)
    for model in (RunItemAttempt, RunItemPassScore):
        db_session.query(model).filter_by(run_id=run.id, pass_number=1).delete(
            synchronize_session=False
        )
    db_session.commit()
    with pytest.raises(HTTPException) as error:
        runs_api.delete_run_passes(
            run.id, {"pass_numbers": [1, 2]}, db=db_session, principal=principal
        )
    assert error.value.status_code == 404
    db_session.expire_all()
    review = db_session.get(ReviewCorrection, review_id)
    assert run.samples == 3
    assert review.pass_number == 2 and review.is_active
    assert review.pass_deleted_at is None and _evidence(review) == before
    assert score(db_session, run, 2).score_numeric == 0.2
    assert db_session.query(AuditLog).filter_by(action="run.pass_deleted").count() == 0


@pytest.mark.parametrize("expected_version", [None, 0, False])
def test_stale_pass_number_edit_cannot_modify_identical_shifted_issue(
    db_session, repeat, expected_version
):
    run, item, principal, _ = repeat
    _add_third_pass(db_session, run, item)
    original_issue = deepcopy(
        score(db_session, run, 1).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0]
    )
    request = {
        "run_id": run.id,
        "item_id": item.item_id,
        "metric_name": "accuracy",
        "pass_number": 1,
        "issue_id": original_issue["issue_id"],
        "action": "edit",
        "expected_issue": original_issue,
        "issue": {**original_issue, "finding": "Changed through a stale pass number"},
        "expected_pass_version": expected_version,
    }
    runs_api.delete_run_pass(run.id, 1, db=db_session, principal=principal)
    before = deepcopy(score(db_session, run, 1).meta)
    with pytest.raises(HTTPException) as error:
        runs_api.update_root_cause_issue(request, db=db_session, principal=principal)
    assert error.value.status_code == 409
    db_session.rollback()
    assert score(db_session, run, 1).meta == before
    # The same edit succeeds only when the client supplies the current mapping.
    request["expected_pass_version"] = 1
    runs_api.update_root_cause_issue(request, db=db_session, principal=principal)
    assert (
        score(db_session, run, 1).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
            "finding"
        ]
        == request["issue"]["finding"]
    )


@pytest.mark.parametrize("bulk", [False, True])
def test_stale_pass_deletion_is_rejected_after_renumbering(db_session, repeat, bulk):
    run, item, principal, _ = repeat
    _add_third_pass(db_session, run, item)
    runs_api.delete_run_pass(run.id, 1, db=db_session, principal=principal)
    with pytest.raises(HTTPException) as error:
        if bulk:
            runs_api.delete_run_passes(
                run.id,
                {"pass_numbers": [1], "expected_pass_version": 0},
                db=db_session,
                principal=principal,
            )
        else:
            runs_api.delete_run_pass(
                run.id, 1, db=db_session, principal=principal, expected_pass_version=0
            )
    assert error.value.status_code == 409
    db_session.rollback()
    assert run.samples == 2 and score(db_session, run, 1).score_numeric == 0.2
    if bulk:
        runs_api.delete_run_passes(
            run.id,
            {"pass_numbers": [1], "expected_pass_version": 1},
            db=db_session,
            principal=principal,
        )
    else:
        runs_api.delete_run_pass(
            run.id, 1, db=db_session, principal=principal, expected_pass_version=1
        )
    assert run.samples == 1 and item.output == {"answer": "Pass 3"}
    assert run.run_metadata["pass_revision"] == 2


def test_late_analyzer_save_cannot_write_into_a_renumbered_pass(db_session, repeat):
    run, item, principal, _ = repeat
    _add_third_pass(db_session, run, item)
    result = AnalysisResult(
        item_id=item.item_id,
        metric_name="accuracy",
        root_cause="Old pass finding",
        confidence=0.9,
        root_cause_note="Analysis started before the selected pass was deleted",
    )
    runs_api.delete_run_pass(run.id, 1, db=db_session, principal=principal)
    before = deepcopy(score(db_session, run, 1).meta)
    with pytest.raises(HTTPException) as error:
        api._save_pass_analysis_results(
            db_session, run, [result], 1, expected_pass_version=0
        )
    assert error.value.status_code == 409
    db_session.rollback()
    assert score(db_session, run, 1).meta == before
    assert records(db_session, run, 1) == []
    saved, errors = api._save_pass_analysis_results(
        db_session, run, [result], 1, expected_pass_version=1
    )
    assert errors == 0 and saved[0]["persistence_status"] == "persisted"
    assert (
        score(db_session, run, 1).meta[PASS_ANALYSIS_META_KEY]["root_cause"]
        == "Old pass finding"
    )
    act(db_session, run, item, principal, "approve", pass_number=1)
    assert records(db_session, run, 1)[0].output_snapshot == {"answer": "Pass 2"}


@pytest.mark.asyncio
async def test_pass_aggregation_preserves_approval_committed_during_llm_call(
    db_session, repeat, monkeypatch
):
    run, item, principal, _ = repeat
    approved_metadata = None

    async def aggregate_with_peer_approval(_client, _model, results, **_kwargs):
        nonlocal approved_metadata
        with Session(db_session.get_bind(), autoflush=False) as peer:
            peer_run = peer.get(Run, run.id)
            peer_item = peer.query(RunItem).filter_by(run_id=run.id).one()
            act(peer, peer_run, peer_item, principal, "approve", pass_number=2)
            approved_metadata = deepcopy(score(peer, peer_run, 2).meta)
        results[0].root_cause = "Aggregator replacement"
        results[0].root_causes = ["Aggregator replacement"]
        results[0].root_cause_issues = [
            {"category": "Aggregator replacement", "finding": "Late rewrite"}
        ]
        return {"Aggregator replacement": 1}

    monkeypatch.setattr(
        api, "aggregate_analysis_categories", aggregate_with_peer_approval
    )
    _, changed = await api._aggregate_pass_analysis_results(
        db=db_session,
        run=run,
        pass_number=2,
        client=None,
        model="test",
        analyzer_config={},
        expected_pass_version=0,
    )
    db_session.commit()
    db_session.expire_all()
    assert changed == 0
    assert score(db_session, run, 2).meta == approved_metadata
    assert records(db_session, run, 2)[0].status == CorrectionStatus.APPROVED


@pytest.mark.parametrize("first_action", ["delete", "approve"])
def test_concurrent_approval_and_deletion_share_item_lock(
    migrated_postgres, monkeypatch, first_action
):
    """Both transaction orders are deterministic and use actual PG row locks."""
    sessions = sessionmaker(bind=migrated_postgres, autoflush=False)
    with sessions() as db:
        user = User(id="issue-user", email="issue-user@example.com")
        db.add(user)
        db.flush()
        project = Project(
            id="issue-project",
            name="Issue project",
            slug="issue-project",
            created_by_user_id=user.id,
        )
        db.add(project)
        db.flush()
        run = Run(
            id="issue-run",
            project_id=project.id,
            created_by_user_id=user.id,
            owner_user_id=user.id,
            task="issue-task",
            dataset="issue-dataset",
            metrics=["accuracy"],
            samples=3,
            status=RunWorkflowStatus.COMPLETED,
        )
        db.add(run)
        db.flush()
        item = RunItem(
            run_id=run.id,
            item_id="issue-item",
            index=0,
            input="question",
            output="Output 3",
            item_metadata={},
        )
        db.add(item)
        db.add(
            RunItemScore(
                run_id=run.id,
                item_id=item.item_id,
                metric_name="accuracy",
                score_numeric=0.2,
            )
        )
        db.flush()
        principal = Principal(user=user, auth_type="none")
        for number in (1, 2, 3):
            db.add(
                RunItemPassScore(
                    run_id=run.id,
                    item_id=item.item_id,
                    metric_name="accuracy",
                    pass_number=number,
                    score_numeric=number / 10,
                    meta={
                        PASS_ANALYSIS_META_KEY: {
                            "source": "ai",
                            "root_cause": "Same category",
                            "root_cause_issues": [
                                {
                                    "issue_id": "shared-id",
                                    "category": "Same category",
                                    "finding": "Same finding",
                                }
                            ],
                        }
                    },
                )
            )
            db.add(
                RunItemAttempt(
                    run_id=run.id,
                    item_id=item.item_id,
                    pass_number=number,
                    attempt_number=1,
                    status="completed",
                    is_last_attempt=True,
                    output=f"Output {number}",
                )
            )
        db.commit()
        act(db, run, item, principal, "approve", pass_number=1)
        target_id = records(db, run, 1)[0].id
        api.reset_correction(target_id, db=db, principal=principal)
        act(db, run, item, principal, "approve", pass_number=2)
        survivor_id = records(db, run, 2)[0].id
        run_id = run.id

    first_locked = Event()
    second_waiting = Event()
    release_first = Event()
    if first_action == "delete":
        real_lock = repeat_passes._lock_run_items

        def pause_first(db, run_id):
            real_lock(db, run_id)
            first_locked.set()
            assert release_first.wait(10), "Test failed to release pass deletion"

        monkeypatch.setattr(repeat_passes, "_lock_run_items", pause_first)
    else:
        real_lock = api.lock_issue_correction

        def pause_first(db, correction):
            real_lock(db, correction)
            first_locked.set()
            assert release_first.wait(10), "Test failed to release approval"

        monkeypatch.setattr(api, "lock_issue_correction", pause_first)

    def notice_second_lock(_conn, _cursor, statement, _params, _context, _many):
        if (
            current_thread().name.startswith("second")
            and "run_items" in statement
            and "FOR UPDATE" in statement
        ):
            second_waiting.set()

    event.listen(migrated_postgres, "before_cursor_execute", notice_second_lock)

    def perform(action):
        with sessions() as db:
            try:
                if action == "delete":
                    runs_api.delete_run_pass(run_id, 1, db=db, principal=principal)
                else:
                    api.approve_correction(target_id, {}, db=db, principal=principal)
                return 200
            except HTTPException as exc:
                db.rollback()
                return exc.status_code

    second_action = "approve" if first_action == "delete" else "delete"
    try:
        with ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="first"
        ) as first_pool, ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="second"
        ) as second_pool:
            first = first_pool.submit(perform, first_action)
            try:
                assert first_locked.wait(
                    10
                ), "First transaction did not take its item lock"
                second = second_pool.submit(perform, second_action)
                assert second_waiting.wait(
                    10
                ), "Second transaction did not reach the shared lock"
            finally:
                release_first.set()
            assert first.result(timeout=10) == 200
            assert second.result(timeout=10) == (
                409 if first_action == "delete" else 200
            )
    finally:
        release_first.set()
        event.remove(migrated_postgres, "before_cursor_execute", notice_second_lock)

    with sessions() as db:
        deleted = db.get(ReviewCorrection, target_id)
        survivor = db.get(ReviewCorrection, survivor_id)
        assert not deleted.is_active and deleted.pass_deleted_at is not None
        assert deleted.output_snapshot == "Output 1"
        assert deleted.status == (
            CorrectionStatus.PENDING
            if first_action == "delete"
            else CorrectionStatus.APPROVED
        )
        assert survivor.is_active and survivor.pass_deleted_at is None
        assert (
            survivor.pass_number == 1 and survivor.status == CorrectionStatus.APPROVED
        )
        assert survivor.output_snapshot == "Output 2"
