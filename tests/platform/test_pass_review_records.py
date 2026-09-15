"""Regression coverage for approvals made on a selected repeat pass."""
from copy import deepcopy
from datetime import datetime

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from sqlalchemy import text

from qym_platform.api import analysis as api
from qym_platform.api import runs as runs_api
from qym_platform.db.models import (
    CorrectionStatus,
    ProjectAnalysisCategoryCatalogVersion,
    ReviewCorrection,
    RunItemAttempt,
    RunItemPassScore,
)
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY
from qym_platform.services.llm_analyzer import AnalysisResult
from test_issue_reviews import setup, act
from test_root_cause_issue_persistence import db_session
from test_migrations import _load_migration


@pytest.fixture
def repeat(db_session):
    # Match SessionLocal, not SQLAlchemy's default autoflush=True.
    db_session.autoflush = False
    _, run, item, principal = setup(db_session)
    run.samples = 2
    original = deepcopy(item.item_metadata)
    analysis = {
        "source": "ai",
        "confidence": 0.9,
        "root_cause": "New approved category",
        "root_cause_issues": [
            {
                "issue_id": "shared-issue-1",
                "category": "New approved category",
                "subcategory": "Approved detail",
                "finding": "First finding",
            },
            {
                "issue_id": "shared-issue-2",
                "category": "Unapproved category",
                "subcategory": "Unapproved detail",
                "finding": "Second finding",
            },
        ],
        "category_taxonomy": {
            "New approved category": {
                "description": "Reviewed failure.",
                "when_to_use": "When observed.",
            },
            "Unapproved category": {
                "description": "Pending failure.",
                "when_to_use": "Unreviewed.",
            },
        },
    }
    for number in (1, 2):
        db_session.add(
            RunItemPassScore(
                run_id=run.id,
                item_id=item.item_id,
                metric_name="accuracy",
                pass_number=number,
                score_numeric=number / 10,
                meta={
                    PASS_ANALYSIS_META_KEY: deepcopy(analysis),
                    "reason": "Judge reason",
                },
            )
        )
        db_session.add(
            RunItemAttempt(
                run_id=run.id,
                item_id=item.item_id,
                pass_number=number,
                attempt_number=1,
                is_last_attempt=True,
                output={"answer": f"Pass {number}"},
            )
        )
    db_session.commit()
    return run, item, principal, original


def score(db, run, number):
    return (
        db.query(RunItemPassScore)
        .filter_by(run_id=run.id, metric_name="accuracy", pass_number=number)
        .one()
    )


def records(db, run, number):
    return (
        db.query(ReviewCorrection)
        .filter_by(run_id=run.id, pass_number=number, is_active=True)
        .order_by(ReviewCorrection.id)
        .all()
    )


def reviews(db, principal, **kwargs):
    args = dict(
        project_slug=None,
        task=None,
        dataset=None,
        model=None,
        run_name=None,
        source=None,
        conf_min=0,
        conf_max=100,
        status=None,
        search=None,
        limit=None,
    )
    args.update(kwargs)
    return api.list_corrections(**args, db=db, principal=principal)


def test_pass_approval_reaches_reviews_dataset_and_catalog(db_session, repeat):
    run, item, principal, original = repeat
    other_pass = deepcopy(score(db_session, run, 1).meta)
    act(db_session, run, item, principal, "approve", pass_number=2)
    listed = reviews(db_session, principal, status="approved", dataset=[run.dataset])
    assert listed["stats"]["approved"] == 1
    assert listed["datasets"] == [run.dataset]
    assert listed["facet_counts"]["dataset"] == {run.dataset: 1}
    review = listed["corrections"][0]
    assert review["pass_number"] == 2
    assert review["output_snapshot"] == {"answer": "Pass 2"}
    assert review["scores_snapshot"] == {"accuracy": 0.2}
    assert score(db_session, run, 1).meta == other_pass
    assert item.item_metadata == original
    config = api.get_analysis_config(run.id, db=db_session, principal=principal)
    assert "New approved category" in config["default_categories"]
    assert "Unapproved category" not in config["default_categories"]
    assert config["category_details_map"]["New approved category"] == [
        "Approved detail"
    ]
    assert config["category_example_counts"]["New approved category"] == 1
    assert config["category_examples"]["New approved category"][0]["pass_number"] == 2
    analyzer = api._analysis_config_with_category_catalog(db_session, run, [item], {})
    assert "New approved category" in analyzer["root_cause_categories"]
    assert analyzer["approved_category_details"] == {
        "New approved category": ["Approved detail"]
    }
    assert api._active_approved_review_keys(db_session, run, [item.item_id]) == set()


def test_reviews_actions_and_history_remain_on_selected_pass(db_session, repeat):
    run, item, principal, original = repeat
    act(db_session, run, item, principal, "approve", pass_number=1)
    pass_one = deepcopy(score(db_session, run, 1).meta)
    act(db_session, run, item, principal, "approve", pass_number=2)
    first, second = records(db_session, run, 2)
    assert records(db_session, run, 1)[0].status == CorrectionStatus.APPROVED
    detail = api.get_correction(first.id, db=db_session, principal=principal)
    assert all(event["review"]["pass_number"] == 2 for event in detail["history"])
    api.approve_correction(second.id, {}, db=db_session, principal=principal)
    api.reset_correction(first.id, db=db_session, principal=principal)
    assert (
        score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
            "review_status"
        ]
        == "pending"
    )
    api.approve_correction(first.id, {}, db=db_session, principal=principal)
    api.reject_correction(first.id, {}, db=db_session, principal=principal)
    assert (
        score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
            "review_status"
        ]
        == "rejected"
    )
    result = api.update_correction(
        first.id,
        {"human_solution": "Fix only pass two"},
        db=db_session,
        principal=principal,
    )
    assert result["pass_number"] == 2 and result["status"] == "pending"
    with pytest.raises(HTTPException) as error:
        api.approve_correction(first.id, {}, db=db_session, principal=principal)
    assert error.value.status_code == 409
    api.delete_correction(second.id, db=db_session, principal=principal)
    issues = score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]
    assert len(issues) == 1 and issues[0]["solution"] == "Fix only pass two"
    assert score(db_session, run, 1).meta == pass_one
    assert item.item_metadata == original


def test_legacy_pass_approval_creates_issue_reviews(db_session, repeat):
    run, item, principal, original = repeat
    target = score(db_session, run, 2)
    meta = deepcopy(target.meta)
    for issue in meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]:
        issue.pop("issue_id")
    target.meta = meta
    db_session.commit()
    result = api.approve_metric_analysis(
        {
            "run_id": run.id,
            "item_id": item.item_id,
            "metric_name": "accuracy",
            "pass_number": 2,
        },
        db=db_session,
        principal=principal,
    )
    assert result["id"] is not None and result["status"] == "approved"
    assert len(records(db_session, run, 2)) == 2
    assert all(
        row.status == CorrectionStatus.APPROVED for row in records(db_session, run, 2)
    )
    assert reviews(db_session, principal)["stats"]["approved"] == 2
    assert item.item_metadata == original


def test_partial_pass_approval_survives_ai_overwrite_other_pass_can_change(
    db_session, repeat
):
    run, item, principal, _ = repeat
    act(db_session, run, item, principal, "approve", pass_number=2)
    before = deepcopy(score(db_session, run, 2).meta)
    result = AnalysisResult(
        item_id=item.item_id,
        metric_name="accuracy",
        root_cause="Hallucination",
        root_cause_note="AI replacement",
        confidence=0.8,
    )
    saved, _ = api._save_pass_analysis_results(
        db_session, run, [result], 2, allow_human_overwrite=True
    )
    assert saved[0]["persistence_status"] == "skipped_approved_protection"
    assert score(db_session, run, 2).meta == before
    saved, _ = api._save_pass_analysis_results(
        db_session, run, [result], 1, allow_human_overwrite=True
    )
    assert saved[0]["persistence_status"] == "persisted"
    assert records(db_session, run, 2)[0].status == CorrectionStatus.APPROVED


def test_legacy_editor_reopens_only_changed_pass_issue(db_session, repeat):
    run, item, principal, _ = repeat
    act(db_session, run, item, principal, "approve", pass_number=2)
    act(db_session, run, item, principal, "approve", index=1, pass_number=2)
    before = deepcopy(
        score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]
    )
    changed = deepcopy(before)
    changed[1]["finding"] = "Edited through legacy form"
    runs_api.update_root_cause(
        {
            "run_id": run.id,
            "item_id": item.item_id,
            "metric_name": "accuracy",
            "pass_number": 2,
            "root_cause_issues": changed,
        },
        db=db_session,
        principal=principal,
    )
    issues = score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]
    assert all(issues[0][key] == value for key, value in before[0].items())
    assert issues[1]["review_status"] == "pending"
    assert [row.status for row in records(db_session, run, 2)] == [
        CorrectionStatus.APPROVED,
        CorrectionStatus.PENDING,
    ]


def test_catalog_approval_is_idempotent_and_keeps_old_version(db_session, repeat):
    run, item, principal, _ = repeat
    act(db_session, run, item, principal, "approve", pass_number=2)
    first = db_session.query(ProjectAnalysisCategoryCatalogVersion).one()
    original = deepcopy(first.categories)
    act(db_session, run, item, principal, "approve", pass_number=2)
    assert db_session.query(ProjectAnalysisCategoryCatalogVersion).count() == 1
    act(db_session, run, item, principal, "approve", index=1, pass_number=2)
    assert db_session.query(ProjectAnalysisCategoryCatalogVersion).count() == 2
    assert first.categories == original
    assert not first.is_active
    pinned = api._analysis_config_with_category_catalog(
        db_session, run, [item], {}, first.id
    )
    assert "Unapproved category" not in pinned["root_cause_categories"]
    assert (
        "Unapproved category"
        in api.get_analysis_config(run.id, db=db_session, principal=principal)[
            "default_categories"
        ]
    )


def test_migration_recovers_existing_approval_and_is_idempotent(
    db_session, repeat, monkeypatch
):
    run, item, principal, original = repeat
    target = score(db_session, run, 2)
    meta = deepcopy(target.meta)
    approved = meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0]
    approved.update(review_status="approved", reviewed_at="2026-09-15T10:00:00Z")
    target.meta = meta
    db_session.commit()
    migration = _load_migration("0057_pass_review_records.py")
    # Exercise the real upgrade against the preceding schema.
    connection = db_session.connection()
    connection.execute(text("DROP INDEX ix_review_corrections_pass_scope"))
    connection.execute(text("ALTER TABLE review_corrections DROP COLUMN pass_number"))
    monkeypatch.setattr(
        migration, "op", Operations(MigrationContext.configure(connection))
    )
    migration.upgrade()
    migration._backfill(connection)
    db_session.commit()
    db_session.expire_all()
    restored = records(db_session, run, 2)
    assert len(restored) == 2
    assert restored[0].status == CorrectionStatus.APPROVED
    assert restored[0].reviewed_at == datetime(2026, 9, 15, 10)
    assert restored[0].output_snapshot == {"answer": "Pass 2"}
    assert restored[1].status == CorrectionStatus.PENDING
    assert reviews(db_session, principal)["datasets"] == [run.dataset]
    assert db_session.query(ProjectAnalysisCategoryCatalogVersion).count() == 1
    config = api.get_analysis_config(run.id, db=db_session, principal=principal)
    assert "New approved category" in config["default_categories"]
    assert "Unapproved category" not in config["default_categories"]
    assert not records(db_session, run, 1)
    assert item.item_metadata == original
    assert (
        score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"][0][
            "review_status"
        ]
        == "approved"
    )


def test_catalog_keeps_archived_categories_and_manual_definitions():
    from qym_platform.services.approved_categories import approved_catalog_values

    prior = {
        "categories": ["Kept category"],
        "category_entries": [
            {"id": "kept", "label": "Kept category", "status": "active"},
            {"id": "archived", "label": "Archived category", "status": "archived"},
        ],
        "category_details_map": {},
        "category_taxonomy": {
            "Kept category": {
                "description": "Manager definition",
                "when_to_use": "Manager rule",
            },
        },
        "subcategory_taxonomy": {},
        "max_root_cause_categories": 2,
    }
    evidence = [
        {
            "status": "approved",
            "is_active": True,
            "human_root_cause_issues": [
                {"category": "kept CATEGORY", "subcategory": "Approved detail"},
                {"category": "Archived category"},
                {"category": "New category"},
            ],
            "human_category_taxonomy": {
                "Kept category": {
                    "description": "AI definition",
                    "when_to_use": "AI rule",
                },
                "Unapproved category": {
                    "description": "Unreviewed",
                    "when_to_use": "Never",
                },
            },
        }
    ]
    values = approved_catalog_values("project", prior, evidence)
    assert values["categories"] == ["Kept category", "New category"]
    assert values["category_taxonomy"] == prior["category_taxonomy"]
    assert values["category_entries"][0]["id"] == "kept"
    assert values["category_entries"][-1]["id"] == "archived"
    assert values["category_details_map"] == {"Kept category": ["Approved detail"]}
    assert values["max_root_cause_categories"] == 2
    assert approved_catalog_values("project", values, evidence) == values
    assert prior["categories"] == ["Kept category"]


@pytest.mark.parametrize("legacy_group", [False, True])
def test_recovery_handles_legacy_pass_and_classic_approvals(
    db_session, repeat, legacy_group
):
    run, item, principal, _ = repeat
    target = score(db_session, run, 2)
    meta = deepcopy(target.meta)
    analysis = meta[PASS_ANALYSIS_META_KEY]
    for issue in analysis["root_cause_issues"]:
        issue.pop("issue_id")
    if legacy_group:
        analysis.update(review_status="approved", reviewed_at="2026-09-15T10:00:00Z")
    else:
        analysis["root_cause_issues"][0].update(
            review_status="approved", reviewed_at="2026-09-15T10:00:00Z"
        )
    target.meta = meta
    db_session.add(
        ReviewCorrection(
            run_id=run.id,
            item_id=item.item_id,
            metric_name="accuracy",
            task=run.task,
            pass_number=None,
            ai_root_cause="Classic approved category",
            human_root_cause="Classic approved category",
            status=CorrectionStatus.APPROVED,
            is_active=True,
        )
    )
    db_session.commit()
    migration = _load_migration("0057_pass_review_records.py")
    migration._backfill(db_session.connection())
    db_session.commit()
    db_session.expire_all()
    restored = records(db_session, run, 2)
    assert len(restored) == 2
    assert len(
        {
            row.human_root_cause_issues[0]["issue_id"]
            for row in restored
            if row.status == CorrectionStatus.APPROVED
        }
    ) == (2 if legacy_group else 1)
    config = api.get_analysis_config(run.id, db=db_session, principal=principal)
    assert "Classic approved category" in config["default_categories"]
    assert ("Unapproved category" in config["default_categories"]) is legacy_group
    assert len(records(db_session, run, None)) == 1


def test_missing_pass_output_does_not_use_aggregate_output(db_session, repeat):
    run, item, principal, _ = repeat
    db_session.query(RunItemAttempt).filter_by(run_id=run.id, pass_number=2).delete()
    db_session.commit()
    act(db_session, run, item, principal, "approve", pass_number=2)
    assert records(db_session, run, 2)[0].output_snapshot is None


@pytest.mark.parametrize("action", ["reset", "reject", "delete"])
def test_bulk_review_actions_preserve_all_changes_in_a_pass(db_session, repeat, action):
    run, item, principal, original = repeat
    act(db_session, run, item, principal, "approve", pass_number=1)
    untouched = deepcopy(score(db_session, run, 1).meta)
    act(db_session, run, item, principal, "approve", pass_number=2)
    act(db_session, run, item, principal, "approve", index=1, pass_number=2)
    ids = [row.id for row in records(db_session, run, 2)]
    result = api.bulk_correction_action(
        api.BulkActionRequest(ids=ids, action=action),
        db=db_session,
        principal=principal,
    )
    assert result["affected"] == 2
    db_session.expire_all()
    issues = score(db_session, run, 2).meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]
    if action == "delete":
        assert issues == []
    else:
        assert len(issues) == 2
        assert all(
            issue["review_status"] == ("pending" if action == "reset" else "rejected")
            for issue in issues
        )
    assert score(db_session, run, 1).meta == untouched
    assert item.item_metadata == original
