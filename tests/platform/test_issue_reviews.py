from copy import deepcopy

import pytest
from fastapi import HTTPException

from qym_platform.api import runs as runs_api
from qym_platform.api.analysis import approve_correction, approve_metric_analysis, update_correction, delete_correction, reset_correction
from qym_platform.auth import Principal
from qym_platform.db.models import CorrectionStatus, ReviewCorrection, RunItemPassScore
from qym_platform.services.approved_diagnoses import load_approved_diagnoses
from qym_platform.services.issue_reviews import correction_issue_id, issue_content
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY, replace_metric_review_candidate
from test_root_cause_issue_persistence import db_session, _seed_run, ISSUES


def setup(session):
    actor, run, item = _seed_run(session)
    analysis = {"root_cause_issues": deepcopy(ISSUES), "root_cause": ISSUES[0]["category"], "source": "ai", "solution": "Old shared solution", "solution_note": "Shared notes"}
    item.item_metadata = {"metric_analyses": {"accuracy": analysis, "style": {"keep": True}}}
    session.commit()
    return actor, run, item, Principal(user=actor, auth_type="none")


def act(session, run, item, principal, action, index=0, issue=None, pass_number=None):
    if pass_number:
        analysis = session.query(RunItemPassScore).filter_by(run_id=run.id, item_id=item.item_id, metric_name="accuracy", pass_number=pass_number).one().meta[PASS_ANALYSIS_META_KEY]
    else:
        analysis = item.item_metadata["metric_analyses"]["accuracy"]
    current = analysis.get("root_cause_issues", [])[index] if action != "add" else {}
    request = {"run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy", "action": action, "issue_index": index, "issue_id": current.get("issue_id"), "expected_issue": deepcopy(current)}
    if issue is not None:
        request["issue"] = issue
    if pass_number:
        request["pass_number"] = pass_number
    result = runs_api.update_root_cause_issue(request, db=session, principal=principal)
    session.expire_all()
    assert result["ok"] and result["row"]
    return result


def candidates(session, run):
    return session.query(ReviewCorrection).filter_by(run_id=run.id, is_active=True).order_by(ReviewCorrection.id).all()


def test_approve_one_issue_and_edit_other_preserves_sibling_after_reload(db_session):
    actor, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve")
    analysis = deepcopy(item.item_metadata["metric_analyses"]["accuracy"])
    one, two = analysis["root_cause_issues"]
    assert one["review_status"] == "approved"
    assert two["review_status"] == "pending"
    assert analysis["review_status"] == "pending"
    assert analysis["solution"] == "Old shared solution"
    assert all(not issue.get("solution") for issue in [one, two])
    approved = load_approved_diagnoses(db_session, [run.id])[(run.id, item.item_id)]
    assert [entry["note"] for entry in approved] == [ISSUES[0]["finding"]]

    content = {**issue_content(two), "solution": "Correct the boolean expression", "solution_note": "Add a regression test"}
    act(db_session, run, item, principal, "edit", 1, content)
    after = item.item_metadata["metric_analyses"]["accuracy"]
    assert after["root_cause_issues"][0] == one
    assert after["root_cause_issues"][1]["solution"] == content["solution"]
    assert after["root_cause_issues"][1]["review_status"] == "pending"
    assert item.item_metadata["metric_analyses"]["style"] == {"keep": True}
    assert len(candidates(db_session, run)) == 2

    act(db_session, run, item, principal, "approve", 1)
    assert len(load_approved_diagnoses(db_session, [run.id])[(run.id, item.item_id)]) == 2
    assert all(c.status == CorrectionStatus.APPROVED for c in candidates(db_session, run))
    assert item.item_metadata["metric_analyses"]["accuracy"]["review_status"] == "approved"


def test_edit_approved_issue_only_reopens_that_issue_and_add_stays_pending(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    act(db_session, run, item, principal, "approve", 1)
    sibling = deepcopy(item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][1])
    act(db_session, run, item, principal, "edit", 0, {**ISSUES[0], "solution": "x" * 1000})
    issues = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert issues[0]["review_status"] == "pending"
    assert len(issues[0]["solution"]) == 1000
    assert issues[1] == sibling
    act(db_session, run, item, principal, "add", issue={**ISSUES[0], "finding": "Third issue", "solution": "Third solution", "review_status": "approved"})
    issues = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert len(issues) == 3 and issues[2]["review_status"] == "pending"
    assert issues[1] == sibling


def test_legacy_approved_group_migrates_without_losing_approvals(db_session):
    _, run, item, principal = setup(db_session)
    analysis = item.item_metadata["metric_analyses"]["accuracy"]
    candidate = replace_metric_review_candidate(db_session, run=run, item=item, metric_name="accuracy", analysis=analysis, actor_user_id=None, actor_source="ai")
    db_session.commit()
    approve_correction(candidate.id, {}, db=db_session, principal=principal)
    act(db_session, run, item, principal, "edit", 1, {**ISSUES[1], "finding": "Changed finding", "solution": "Fix it"})
    issues = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert issues[0]["review_status"] == "approved"
    assert issues[1]["review_status"] == "pending"
    assert candidate.is_active is False
    assert len(candidates(db_session, run)) == 2


def test_stale_edit_or_approval_rejected_and_forms_cannot_forge_review(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    original = deepcopy(item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][0])
    act(db_session, run, item, principal, "edit", 0, {**original, "finding": "New finding", "review_status": "approved"})
    assert item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][0]["review_status"] == "pending"
    request = {"run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy", "issue_id": original["issue_id"], "expected_issue": original}
    for action in ("approve", "edit", "delete"):
        with pytest.raises(HTTPException) as error:
            runs_api.update_root_cause_issue({**request, "action": action, "issue": original}, db=db_session, principal=principal)
        assert error.value.status_code == 409
        db_session.rollback()


def test_review_page_actions_keep_issue_scope_and_approval_evidence(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    first, second = candidates(db_session, run)
    approve_correction(second.id, {}, db=db_session, principal=principal)
    assert first.status == CorrectionStatus.APPROVED and first.is_active
    assert len(load_approved_diagnoses(db_session, [run.id])[(run.id, item.item_id)]) == 2
    update_correction(second.id, {"human_solution": "Second issue solution"}, db=db_session, principal=principal)
    db_session.expire_all()
    assert item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][0]["review_status"] == "approved"
    assert first.is_active and first.status == CorrectionStatus.APPROVED
    with pytest.raises(HTTPException) as error:
        approve_correction(second.id, {}, db=db_session, principal=principal)
    assert error.value.status_code == 409
    reset_correction(first.id, db=db_session, principal=principal)
    assert item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][0]["review_status"] == "pending"


def test_delete_one_issue_leaves_sibling(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    act(db_session, run, item, principal, "approve", 1)
    sibling = deepcopy(item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][1])
    act(db_session, run, item, principal, "delete", 0)
    assert item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"] == [sibling]
    assert len(candidates(db_session, run)) == 1


def test_repeat_pass_issue_reviews_and_solutions_are_isolated(db_session):
    _, run, item, principal = setup(db_session)
    run.samples = 2
    analysis = deepcopy(item.item_metadata["metric_analyses"]["accuracy"])
    for number in (1, 2):
        db_session.add(RunItemPassScore(run_id=run.id, item_id=item.item_id, metric_name="accuracy", pass_number=number, score_numeric=0, meta={PASS_ANALYSIS_META_KEY: deepcopy(analysis)}))
    db_session.commit()
    act(db_session, run, item, principal, "approve", 0, pass_number=2)
    act(db_session, run, item, principal, "edit", 1, {**ISSUES[1], "solution": "Pass 2 issue 2 only"}, pass_number=2)
    scores = db_session.query(RunItemPassScore).order_by(RunItemPassScore.pass_number).all()
    assert scores[0].meta[PASS_ANALYSIS_META_KEY] == analysis
    second = scores[1].meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"]
    assert second[0]["review_status"] == "approved"
    assert second[1]["review_status"] == "pending"
    assert second[1]["solution"] == "Pass 2 issue 2 only"
    assert item.item_metadata["metric_analyses"]["accuracy"] == analysis
    with pytest.raises(HTTPException) as error:
        runs_api.update_root_cause_issue({"run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy", "action": "approve"}, db=db_session, principal=principal)
    assert error.value.status_code == 400


def test_approval_requires_review_permission(db_session, monkeypatch):
    _, run, item, principal = setup(db_session)
    monkeypatch.setattr(runs_api, "can_review_run", lambda *args: False)
    with pytest.raises(HTTPException) as error:
        act(db_session, run, item, principal, "approve", 0)
    assert error.value.status_code == 403
    assert not candidates(db_session, run)


def test_whole_metric_approval_cannot_approve_issue_owned_diagnosis(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    with pytest.raises(HTTPException) as error:
        approve_metric_analysis({"run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy"}, db=db_session, principal=principal)
    assert error.value.status_code == 409


def test_legacy_whole_list_edit_preserves_unchanged_issue_approval(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    issues = deepcopy(item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"])
    issues[1]["finding"] = "Legacy editor changed second issue"
    issues[1]["review_status"] = "approved"
    runs_api.update_root_cause({"run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy", "root_cause_issues": issues}, db=db_session, principal=principal)
    db_session.expire_all()
    saved = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert saved[0]["review_status"] == "approved"
    assert saved[1]["review_status"] == "pending"

def test_add_retry_with_same_client_id_does_not_duplicate_issue(db_session):
    _, run, item, principal = setup(db_session)
    request = {
        "run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy",
        "action": "add", "client_issue_id": "f8bd9369-dd2e-4b16-bb86-1d2d950834da",
        "issue": {**ISSUES[0], "finding": "One new issue", "solution": "One new solution"},
    }
    runs_api.update_root_cause_issue(request, db=db_session, principal=principal)
    runs_api.update_root_cause_issue(request, db=db_session, principal=principal)
    db_session.expire_all()
    issues = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert len(issues) == 3
    assert issues[2]["issue_id"] == request["client_issue_id"]
    assert len(candidates(db_session, run)) == 3
    with pytest.raises(HTTPException) as error:
        runs_api.update_root_cause_issue({**request, "issue": {**request["issue"], "finding": "Different"}}, db=db_session, principal=principal)
    assert error.value.status_code == 409


def test_review_delete_keeps_the_other_issue_and_history_does_not_mix_siblings(db_session):
    from qym_platform.api.analysis import get_correction, get_corrections
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "approve", 0)
    act(db_session, run, item, principal, "approve", 1)
    first, second = candidates(db_session, run)
    bank = get_corrections(run.id, db=db_session, principal=principal)
    assert len(bank["corrections"]) == 2
    detail = get_correction(first.id, db=db_session, principal=principal)
    assert all(entry["review"].get("issue_id") != correction_issue_id(second) for entry in detail["history"])
    sibling = deepcopy(item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][1])
    delete_correction(first.id, db=db_session, principal=principal)
    db_session.expire_all()
    assert item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"] == [sibling]
    assert second.is_active and second.status == CorrectionStatus.APPROVED


def test_legacy_editor_omitting_solution_does_not_erase_it(db_session):
    _, run, item, principal = setup(db_session)
    act(db_session, run, item, principal, "edit", 1, {**ISSUES[1], "solution": "Keep second solution", "solution_note": "Keep second notes"})
    saved = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    legacy_payload = [{key: issue[key] for key in ("category", "subcategory", "finding")} for issue in saved]
    legacy_payload[1]["finding"] = "Legacy editor changed the finding"
    runs_api.update_root_cause({"run_id": run.id, "item_id": item.item_id, "metric_name": "accuracy", "root_cause_issues": legacy_payload}, db=db_session, principal=principal)
    db_session.expire_all()
    issue = item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][1]
    assert issue["solution"] == "Keep second solution"
    assert issue["solution_note"] == "Keep second notes"
    assert issue["finding"] == "Legacy editor changed the finding"


def test_ai_output_cannot_supply_review_authority():
    from qym_platform.api.analysis import _result_root_cause_issues
    from qym_platform.services.llm_analyzer import AnalysisResult
    result = AnalysisResult(item_id="sample", root_cause="", root_cause_note="", confidence=.9,
                            root_cause_issues=[{**ISSUES[0], "review_status": "approved", "reviewed_by_user_id": "fake", "source": "human"}])
    issue = _result_root_cause_issues(result)[0]
    assert all(key not in issue for key in ("review_status", "reviewed_by_user_id", "source"))
