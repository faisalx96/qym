"""Issue edits keep every field where the reviewer typed it.

C005: an edit on the Reviews page stores the new finding as the finding and
leaves the subcategory unchanged, for a human issue and for an AI issue.
C007: the run page's "Why this category" text is stored as the issue's
``category_reason`` and shows on the Reviews page.
"""

from copy import deepcopy

import pytest
from _helpers import ISSUES, setup
from fastapi import HTTPException
from qym_platform.api import runs as runs_api
from qym_platform.api.analysis import (
    approve_correction,
    get_correction,
    update_correction,
)
from qym_platform.db.models import CorrectionStatus, ReviewCorrection
from qym_platform.services.issue_reviews import correction_issue_id
from qym_platform.services.root_cause_changes import replace_metric_review_candidate

REASON = "The policy changed after the knowledge snapshot."
TOP_REASON = "Both issues come from the agent, not the evaluator."


@pytest.fixture(autouse=True)
def _production_flush(db_session):
    # Match SessionLocal, not SQLAlchemy's default autoflush=True: the
    # analyzer's sync gives the issues their IDs in the analysis it saves.
    db_session.autoflush = False


def saved_issues(item):
    return item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]


def active(session, run):
    return (
        session.query(ReviewCorrection)
        .filter_by(run_id=run.id, is_active=True)
        .order_by(ReviewCorrection.id)
        .all()
    )


def run_page(
    session, run, item, principal, action, index=0, issue=None, expected=None, **extra
):
    """Send what the run page's issue dialog sends."""
    issues = saved_issues(item) if item.item_metadata.get("metric_analyses") else []
    current = issues[index] if action != "add" else {}
    request = {
        "run_id": run.id,
        "item_id": item.item_id,
        "metric_name": "accuracy",
        "action": action,
        **(
            {}
            if action == "add"
            else {
                "issue_index": index,
                "issue_id": current.get("issue_id"),
                "expected_issue": deepcopy(
                    expected if expected is not None else current
                ),
            }
        ),
        **extra,
    }
    if issue is not None:
        request["issue"] = issue
    result = runs_api.update_root_cause_issue(request, db=session, principal=principal)
    session.expire_all()
    return result


def candidate_for(session, run, issue_id):
    return next(c for c in active(session, run) if correction_issue_id(c) == issue_id)


def ai_candidates(session, run, item, **analysis_extra):
    """AI issue reviews as the analyzer creates them: no human issues yet."""
    analysis = {
        "root_cause_issues": [{**issue, "solution": ""} for issue in deepcopy(ISSUES)],
        "root_cause": ISSUES[0]["category"],
        "source": "ai",
        **analysis_extra,
    }
    meta = dict(item.item_metadata)
    meta["metric_analyses"] = {**meta["metric_analyses"], "accuracy": analysis}
    item.item_metadata = meta
    # As the analyzer saves it: the item is already locked.
    replace_metric_review_candidate(
        session,
        run=run,
        item=item,
        metric_name="accuracy",
        analysis=analysis,
        actor_user_id=None,
        actor_source="ai",
        item_locked=True,
    )
    session.commit()
    session.expire_all()
    rows = active(session, run)
    assert len(rows) == 2 and all(row.human_root_cause_issues == [] for row in rows)
    return rows


def form_issue(issue, **changes):
    """The fields the Reviews edit form sends."""
    keys = (
        "issue_id",
        "category",
        "subcategory",
        "finding",
        "category_reason",
        "solution",
        "solution_note",
    )
    return {**{key: issue.get(key, "") for key in keys}, **changes}


# --- C005: Reviews edits ---------------------------------------------------


def test_reviews_edit_of_a_human_issue_round_trips_finding_and_subcategory(db_session):
    _, run, item, principal = setup(db_session)
    run_page(
        db_session,
        run,
        item,
        principal,
        "edit",
        0,
        {**ISSUES[0], "finding": "Human finding"},
    )
    issue = saved_issues(item)[0]
    correction = candidate_for(db_session, run, issue["issue_id"])

    row = get_correction(correction.id, db=db_session, principal=principal)
    edited = form_issue(
        row["human_root_cause_issues"][0],
        finding="EDITED FINDING: the bot gives the legacy reset flow.",
    )
    result = update_correction(
        correction.id,
        {"human_root_cause_issues": [edited]},
        db=db_session,
        principal=principal,
    )
    db_session.expire_all()

    saved = saved_issues(item)[0]
    assert saved["finding"] == "EDITED FINDING: the bot gives the legacy reset flow."
    assert saved["subcategory"] == ISSUES[0]["subcategory"]
    assert saved["issue_id"] == issue["issue_id"]
    human = result["human_root_cause_issues"]
    assert [(i["subcategory"], i["finding"]) for i in human] == [
        (ISSUES[0]["subcategory"], edited["finding"])
    ]
    assert result["status"] == "pending"


def test_reviews_edit_from_an_older_page_ignores_its_single_field_keys(db_session):
    """The old Reviews page also sent the new finding as human_root_cause_detail."""
    _, run, item, principal = setup(db_session)
    run_page(
        db_session,
        run,
        item,
        principal,
        "edit",
        0,
        {**ISSUES[0], "finding": "Human finding"},
    )
    issue = saved_issues(item)[0]
    correction = candidate_for(db_session, run, issue["issue_id"])

    edited = form_issue(issue, finding="New finding")
    update_correction(
        correction.id,
        {
            "human_root_cause_issues": [edited],
            "human_root_causes": [edited["category"]],
            "human_root_cause": edited["category"],
            "human_root_cause_detail": edited["finding"],
            "human_root_cause_note": "Human finding",
        },
        db=db_session,
        principal=principal,
    )
    db_session.expire_all()

    saved = saved_issues(item)[0]
    assert (saved["subcategory"], saved["finding"]) == (
        ISSUES[0]["subcategory"],
        "New finding",
    )


def test_reviews_edit_of_an_ai_issue_keeps_its_subcategory_and_stores_the_finding(
    db_session,
):
    _, run, item, principal = setup(db_session)
    first, _second = ai_candidates(db_session, run, item)
    row = get_correction(first.id, db=db_session, principal=principal)
    assert row["human_root_cause_issues"] == []
    ai_issue = row["ai_root_cause_issues"][0]

    # The old page sent these keys with an empty human note: the AI finding was erased.
    edited = form_issue(ai_issue, finding="One word changed in the AI finding.")
    result = update_correction(
        first.id,
        {
            "human_root_cause_issues": [edited],
            "human_root_cause_detail": edited["finding"],
            "human_root_cause_note": row["human_root_cause_note"] or "",
        },
        db=db_session,
        principal=principal,
    )
    db_session.expire_all()

    saved = saved_issues(item)[0]
    assert saved["subcategory"] == ISSUES[0]["subcategory"]
    assert saved["finding"] == "One word changed in the AI finding."
    assert saved["source"] == "human"
    assert saved_issues(item)[1]["finding"] == ISSUES[1]["finding"]
    assert [
        (i["subcategory"], i["finding"]) for i in result["human_root_cause_issues"]
    ] == [(ISSUES[0]["subcategory"], "One word changed in the AI finding.")]


def test_reviews_edit_of_one_issue_correction_still_refuses_two_issues(db_session):
    _, run, item, principal = setup(db_session)
    first, _second = ai_candidates(db_session, run, item)
    with pytest.raises(HTTPException) as error:
        update_correction(
            first.id,
            {"human_root_cause_issues": [form_issue(ISSUES[0]), form_issue(ISSUES[1])]},
            db=db_session,
            principal=principal,
        )
    assert error.value.status_code == 400
    assert error.value.detail == "Edit one issue at a time"


# --- C007: "Why this category" ---------------------------------------------


def test_run_page_add_stores_the_category_reason_and_reviews_shows_it(db_session):
    _, run, item, principal = setup(db_session)
    run_page(
        db_session,
        run,
        item,
        principal,
        "add",
        issue={**ISSUES[0], "finding": "Third issue", "category_reason": REASON},
        client_issue_id="f8bd9369-dd2e-4b16-bb86-1d2d950834da",
    )
    added = saved_issues(item)[2]
    assert added["category_reason"] == REASON

    row = get_correction(
        candidate_for(db_session, run, added["issue_id"]).id,
        db=db_session,
        principal=principal,
    )
    assert row["human_root_cause_issues"][0]["category_reason"] == REASON


def test_run_page_edit_of_only_the_reason_saves_it_for_review(db_session):
    _, run, item, principal = setup(db_session)
    run_page(db_session, run, item, principal, "approve", 1)
    issue = saved_issues(item)[1]
    before = candidate_for(db_session, run, issue["issue_id"])
    assert before.status == CorrectionStatus.APPROVED

    run_page(
        db_session,
        run,
        item,
        principal,
        "edit",
        1,
        {**ISSUES[1], "category_reason": REASON},
    )
    saved = saved_issues(item)[1]
    assert saved["category_reason"] == REASON
    assert saved["review_status"] == "pending"
    after = candidate_for(db_session, run, issue["issue_id"])
    assert after.id != before.id and after.status == CorrectionStatus.PENDING
    assert after.human_root_cause_issues[0]["category_reason"] == REASON


def test_reviews_edit_stores_the_category_reason(db_session):
    _, run, item, principal = setup(db_session)
    first, _second = ai_candidates(db_session, run, item)
    ai_issue = get_correction(first.id, db=db_session, principal=principal)[
        "ai_root_cause_issues"
    ][0]
    result = update_correction(
        first.id,
        {"human_root_cause_issues": [form_issue(ai_issue, category_reason=REASON)]},
        db=db_session,
        principal=principal,
    )
    db_session.expire_all()
    assert saved_issues(item)[0]["category_reason"] == REASON
    assert result["human_root_cause_issues"][0]["category_reason"] == REASON


def test_analysis_reason_goes_to_the_first_issue_once(db_session):
    """It is copied when the first issue gets an ID; a reviewer can clear it later."""
    _, run, item, principal = setup(db_session)
    ai_candidates(db_session, run, item, root_cause_reason=TOP_REASON)
    first, second = saved_issues(item)
    assert first["category_reason"] == TOP_REASON
    assert "category_reason" not in second

    run_page(
        db_session,
        run,
        item,
        principal,
        "edit",
        0,
        {**ISSUES[0], "category_reason": ""},
    )
    assert saved_issues(item)[0]["category_reason"] == ""
    assert (
        candidate_for(db_session, run, first["issue_id"]).human_root_cause_issues[0][
            "category_reason"
        ]
        == ""
    )


def test_deleting_the_first_issue_leaves_the_sibling_its_review_and_no_reason(
    db_session,
):
    _, run, item, principal = setup(db_session)
    ai_candidates(db_session, run, item, root_cause_reason=TOP_REASON)
    run_page(db_session, run, item, principal, "approve", 1)
    sibling = deepcopy(saved_issues(item)[1])

    run_page(db_session, run, item, principal, "delete", 0)
    assert saved_issues(item) == [sibling]
    review = candidate_for(db_session, run, sibling["issue_id"])
    assert review.status == CorrectionStatus.APPROVED


def test_first_run_page_edit_of_an_analysis_with_no_ids_accepts_the_shown_reason(
    db_session,
):
    """Before any review row, the run page shows the analysis reason on the first issue."""
    _, run, item, principal = setup(db_session)
    analysis = item.item_metadata["metric_analyses"]["accuracy"]
    item.item_metadata = {
        **item.item_metadata,
        "metric_analyses": {
            **item.item_metadata["metric_analyses"],
            "accuracy": {**analysis, "root_cause_reason": TOP_REASON},
        },
    }
    db_session.commit()
    shown = {**ISSUES[0], "category_reason": TOP_REASON}
    run_page(
        db_session,
        run,
        item,
        principal,
        "edit",
        0,
        {**shown, "finding": "Changed"},
        expected=shown,
    )
    saved = saved_issues(item)[0]
    assert (saved["finding"], saved["category_reason"]) == ("Changed", TOP_REASON)


def test_legacy_grouped_approval_survives_the_split_with_an_analysis_reason(db_session):
    _, run, item, principal = setup(db_session)
    analysis = {
        **item.item_metadata["metric_analyses"]["accuracy"],
        "root_cause_reason": TOP_REASON,
    }
    item.item_metadata = {
        **item.item_metadata,
        "metric_analyses": {
            **item.item_metadata["metric_analyses"],
            "accuracy": analysis,
        },
    }
    db_session.commit()
    grouped = replace_metric_review_candidate(
        db_session,
        run=run,
        item=item,
        metric_name="accuracy",
        analysis=analysis,
        actor_user_id=None,
        actor_source="ai",
    )
    db_session.commit()
    assert not correction_issue_id(grouped)
    approve_correction(grouped.id, {}, db=db_session, principal=principal)

    run_page(
        db_session,
        run,
        item,
        principal,
        "edit",
        1,
        {**ISSUES[1], "finding": "Changed finding"},
    )
    issues = saved_issues(item)
    assert issues[0]["review_status"] == "approved"
    assert issues[0]["category_reason"] == TOP_REASON
    assert issues[1]["review_status"] == "pending"
