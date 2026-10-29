"""Issue edits keep every field where the reviewer typed it.

C005: an edit on the Reviews page stores the new finding as the finding and
leaves the subcategory unchanged, for a human issue and for an AI issue.
"""

from copy import deepcopy

import pytest
from _helpers import ISSUES, setup
from fastapi import HTTPException
from qym_platform.api import runs as runs_api
from qym_platform.api.analysis import get_correction, update_correction
from qym_platform.db.models import ReviewCorrection
from qym_platform.services.issue_reviews import correction_issue_id
from qym_platform.services.root_cause_changes import replace_metric_review_candidate


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
