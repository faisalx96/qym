"""Correction status checks (P1 round 2, final-review decision on C042/C074).

Approve and Reject work only on PENDING corrections; Reset works only on
APPROVED or REJECTED ones. This holds on the single routes, the bulk route and
every run-page issue route (by issue_id and by issue_index), for legacy and
issue corrections. The correction rows are locked and the status is checked
again after locking; a refusal is a 409 that names the count. The Reviews All
tab sends each bulk action only the rows it fits and names the skipped count.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import HTTPException

from qym_platform.api import analysis as analysis_api
from qym_platform.api import runs as runs_api
from qym_platform.api.analysis import reject_correction, reset_correction
from qym_platform.db.models import CorrectionStatus, ReviewCorrection, RunItem, RunItemPassScore
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY

from test_issue_reviews import act, candidates, setup
from test_review_rules import (  # noqa: F401  (fixtures)
    MANAGER,
    MEMBER,
    _correction,
    _ok,
    _run,
    _ui,
    client,
    session_factory,
)
from test_root_cause_issue_javascript import _function, _run_javascript

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages/platform/qym_platform/_static/dashboard"
DECIDED_AT = datetime(2026, 9, 2)


def _state(session_factory, correction_id):
    with session_factory() as db:
        row = db.get(ReviewCorrection, correction_id)
        return row.status, row.reviewed_by_user_id, row.reviewed_at


# ---------------------------------------------------------------------------
# Single and bulk routes (legacy corrections)
# ---------------------------------------------------------------------------


def test_single_routes_decide_only_the_statuses_they_fit(client, session_factory):
    with session_factory() as db:
        for run_id in ("r1", "r2", "r3"):
            _run(db, run_id)
        approved = _correction(db, run_id="r1", status=CorrectionStatus.APPROVED, reviewer="manager-1")
        rejected = _correction(db, run_id="r2", status=CorrectionStatus.REJECTED, reviewer="manager-1")
        pending = _correction(db, run_id="r3")
    refusals = (
        (f"/api/corrections/{approved}/approve", {}, "This correction is approved. Only pending corrections can be approved. Reset it to pending first."),
        (f"/api/corrections/{rejected}/approve", {}, "This correction is rejected. Only pending corrections can be approved."),
        (f"/api/corrections/{approved}/reject", {"comment": "no"}, "This correction is approved. Only pending corrections can be rejected."),
        (f"/api/corrections/{rejected}/reject", {"comment": "no"}, "This correction is rejected. Only pending corrections can be rejected."),
        (f"/api/corrections/{pending}/reset", None, "This correction is pending. Only approved or rejected corrections can be reset."),
    )
    for path, body, detail in refusals:
        response = client.post(path, json=body, headers=_ui(MEMBER))
        assert response.status_code == 409, (path, response.text)
        assert response.json()["detail"].startswith(detail), response.json()["detail"]
    # Nothing was re-stamped: the decisions keep their reviewer and time.
    assert _state(session_factory, approved) == (CorrectionStatus.APPROVED, "manager-1", DECIDED_AT)
    assert _state(session_factory, rejected) == (CorrectionStatus.REJECTED, "manager-1", DECIDED_AT)
    assert _state(session_factory, pending) == (CorrectionStatus.PENDING, None, None)

    assert _ok(client.post(f"/api/corrections/{pending}/approve", json={}, headers=_ui(MEMBER)))["status"] == "approved"
    assert _ok(client.post(f"/api/corrections/{approved}/reset", headers=_ui(MEMBER)))["status"] == "pending"
    assert _ok(client.post(f"/api/corrections/{rejected}/reset", headers=_ui(MEMBER)))["status"] == "pending"
    assert _ok(client.post(f"/api/corrections/{rejected}/reject", json={"comment": "no"}, headers=_ui(MEMBER)))["status"] == "rejected"


def test_bulk_refuses_a_mixed_selection_and_names_the_count(client, session_factory):
    with session_factory() as db:
        for run_id in ("r1", "r2", "r3"):
            _run(db, run_id)
        pending = _correction(db, run_id="r1")
        approved = _correction(db, run_id="r2", status=CorrectionStatus.APPROVED, reviewer="manager-1")
        rejected = _correction(db, run_id="r3", status=CorrectionStatus.REJECTED, reviewer="manager-1")
    everything = [pending, approved, rejected]
    # The All tab sends no expected_status: the server still checks statuses.
    for action, detail in (
        ("approve", "2 of the 3 selected corrections are not pending. Only pending corrections can be approved."),
        ("reject", "2 of the 3 selected corrections are not pending. Only pending corrections can be rejected."),
        ("reset", "1 of the 3 selected corrections are not approved or rejected. Only approved or rejected corrections can be reset."),
    ):
        response = client.post(
            "/api/corrections/bulk",
            json={"ids": everything, "action": action, "comment": "x", "expected_count": 3},
            headers=_ui(MEMBER),
        )
        assert response.status_code == 409, (action, response.text)
        assert response.json()["detail"].startswith(detail), response.json()["detail"]
    assert _state(session_factory, pending) == (CorrectionStatus.PENDING, None, None)
    assert _state(session_factory, approved) == (CorrectionStatus.APPROVED, "manager-1", DECIDED_AT)
    assert _state(session_factory, rejected) == (CorrectionStatus.REJECTED, "manager-1", DECIDED_AT)

    # The rows each action fits go through.
    body = _ok(client.post("/api/corrections/bulk", json={"ids": [approved, rejected], "action": "reset"}, headers=_ui(MEMBER)))
    assert body["affected"] == 2
    body = _ok(client.post("/api/corrections/bulk", json={"ids": everything, "action": "approve"}, headers=_ui(MEMBER)))
    assert body["affected"] == 3
    # Delete stays possible whatever the status.
    _ok(client.post("/api/corrections/bulk", json={"ids": [pending], "action": "delete"}, headers=_ui(MEMBER)))


def _decided_meanwhile(session_factory, correction_id):
    """Another reviewer approves the correction after this request read it."""
    with session_factory() as other:
        row = other.get(ReviewCorrection, correction_id)
        row.status = CorrectionStatus.APPROVED
        row.reviewed_by_user_id = "manager-1"
        row.reviewed_at = DECIDED_AT
        other.commit()


def test_single_and_bulk_recheck_the_status_after_locking(client, session_factory, monkeypatch):
    with session_factory() as db:
        _run(db, "r1")
        _run(db, "r2")
        single = _correction(db, run_id="r1")
        first = _correction(db, run_id="r2")
    with session_factory() as db:
        second = ReviewCorrection(
            run_id="r2", item_id="item-2", metric_name=None, task="task", ai_root_cause="",
            human_root_cause="Other", human_root_causes=["Other"], corrected_by_user_id="member-1",
            is_active=True, status=CorrectionStatus.PENDING, created_at=datetime(2026, 9, 1),
        )
        db.add(RunItem(run_id="r2", item_id="item-2", index=1, input={}, output="o", item_metadata={}))
        db.add(second)
        db.commit()
        second = second.id

    real = analysis_api.require_correction_decision
    flipped = []

    def decide_meanwhile(db, principal, project_id, correction=None):
        real(db, principal, project_id, correction)
        if correction is not None and correction.id in (single, second) and correction.id not in flipped:
            flipped.append(correction.id)
            _decided_meanwhile(session_factory, correction.id)

    monkeypatch.setattr(analysis_api, "require_correction_decision", decide_meanwhile)
    response = client.post(f"/api/corrections/{single}/approve", json={}, headers=_ui(MEMBER))
    assert response.status_code == 409, response.text
    assert "This correction is approved" in response.json()["detail"]
    assert _state(session_factory, single) == (CorrectionStatus.APPROVED, "manager-1", DECIDED_AT)

    response = client.post(
        "/api/corrections/bulk",
        json={"ids": [first, second], "action": "approve", "expected_count": 2},
        headers=_ui(MEMBER),
    )
    assert response.status_code == 409, response.text
    assert "1 of the 2 selected corrections are not pending" in response.json()["detail"]
    assert _state(session_factory, first) == (CorrectionStatus.PENDING, None, None)
    assert _state(session_factory, second) == (CorrectionStatus.APPROVED, "manager-1", DECIDED_AT)


# ---------------------------------------------------------------------------
# Run-page issue routes (issue corrections and legacy grouped reviews)
# ---------------------------------------------------------------------------


def _issue_request(item, index, *, by_id=True):
    issue = deepcopy(item.item_metadata["metric_analyses"]["accuracy"]["root_cause_issues"][index])
    return {
        "run_id": "issue-run",
        "item_id": item.item_id,
        "metric_name": "accuracy",
        "action": "approve",
        "issue_id": issue.get("issue_id") if by_id else None,
        "issue_index": index,
        "expected_issue": issue,
    }


@pytest.mark.parametrize("by_id", [True, False], ids=["issue_id", "issue_index"])
def test_run_page_approves_only_pending_issues(db_session, by_id):
    _, run, item, principal = setup(db_session)
    runs_api.update_root_cause_issue(_issue_request(item, 0, by_id=True), db=db_session, principal=principal)
    db_session.expire_all()
    first, second = candidates(db_session, run)
    approved_at = first.reviewed_at
    assert first.status == CorrectionStatus.APPROVED

    with pytest.raises(HTTPException) as again:
        runs_api.update_root_cause_issue(_issue_request(item, 0, by_id=by_id), db=db_session, principal=principal)
    assert again.value.status_code == 409
    assert again.value.detail.startswith("This issue is approved. Only pending issues can be approved.")
    db_session.rollback()
    db_session.expire_all()
    assert first.reviewed_at == approved_at

    reject_correction(second.id, {"comment": "no"}, db=db_session, principal=principal)
    db_session.expire_all()
    with pytest.raises(HTTPException) as rejected:
        runs_api.update_root_cause_issue(_issue_request(item, 1, by_id=by_id), db=db_session, principal=principal)
    assert rejected.value.status_code == 409
    assert "This issue is rejected" in rejected.value.detail and "Reset it to pending first" in rejected.value.detail
    db_session.rollback()

    reset_correction(second.id, db=db_session, principal=principal)
    db_session.expire_all()
    runs_api.update_root_cause_issue(_issue_request(item, 1, by_id=by_id), db=db_session, principal=principal)
    db_session.expire_all()
    assert [c.status for c in candidates(db_session, run)] == [CorrectionStatus.APPROVED] * 2


def test_run_page_rechecks_the_issue_status_after_locking(db_session, monkeypatch):
    _, run, item, principal = setup(db_session)
    # Split the AI diagnosis into one review row per issue.
    runs_api.update_root_cause_issue(
        {**_issue_request(item, 0), "action": "edit", "issue": _issue_request(item, 0)["expected_issue"]},
        db=db_session,
        principal=principal,
    )
    db_session.expire_all()
    first = candidates(db_session, run)[0]
    real = runs_api.require_correction_decision

    def decided_meanwhile(db, principal_, project_id, correction=None):
        real(db, principal_, project_id, correction)
        # Another reviewer's approval lands in the database; this session
        # still holds the row as pending.
        db.execute(
            ReviewCorrection.__table__.update()
            .where(ReviewCorrection.id == first.id)
            .values(status=CorrectionStatus.APPROVED, reviewed_by_user_id=None, reviewed_at=DECIDED_AT)
        )

    monkeypatch.setattr(runs_api, "require_correction_decision", decided_meanwhile)
    with pytest.raises(HTTPException) as refused:
        runs_api.update_root_cause_issue(_issue_request(item, 0), db=db_session, principal=principal)
    assert refused.value.status_code == 409
    assert "This issue is approved" in refused.value.detail


def _legacy_group(db, *, status):
    item = db.query(RunItem).filter_by(run_id="r1").one()
    item.item_metadata = {
        "metric_analyses": {
            "accuracy": {
                "root_cause": "Retrieval miss",
                "source": "human",
                "root_cause_issues": [{"category": "Retrieval miss", "source": "human"}],
            }
        }
    }
    db.add(
        ReviewCorrection(
            run_id="r1", item_id="item-1", metric_name="accuracy", task="task", ai_root_cause="",
            human_root_cause="Retrieval miss", human_root_causes=["Retrieval miss"],
            corrected_by_user_id="member-1", is_active=True, status=status,
            reviewed_by_user_id="manager-1" if status != CorrectionStatus.PENDING else None,
            reviewed_at=DECIDED_AT if status != CorrectionStatus.PENDING else None,
            created_at=datetime(2026, 9, 1),
        )
    )
    db.commit()


@pytest.mark.parametrize("status", [CorrectionStatus.APPROVED, CorrectionStatus.REJECTED])
def test_run_page_refuses_to_approve_a_decided_legacy_review(client, session_factory, status):
    with session_factory() as db:
        _run(db, "r1")
        _legacy_group(db, status=status)
    by_index = {
        "run_id": "r1", "item_id": "item-1", "metric_name": "accuracy", "action": "approve",
        "issue_id": None, "issue_index": 0, "expected_issue": {"category": "Retrieval miss"},
    }
    response = client.post("/api/runs/update_root_cause_issue", json=by_index, headers=_ui(MANAGER))
    assert response.status_code == 409, response.text
    assert f"This issue is {status.value}" in response.json()["detail"]
    legacy = client.post(
        "/api/corrections/approve-metric-analysis",
        json={"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy"},
        headers=_ui(MANAGER),
    )
    # The older whole-diagnosis approval judges the grouped review by its
    # status too.
    assert legacy.status_code == 409, legacy.text
    with session_factory() as db:
        rows = db.query(ReviewCorrection).filter_by(run_id="r1", is_active=True).all()
        assert [(row.status, row.reviewed_by_user_id) for row in rows] == [(status, "manager-1")]


def test_metric_analysis_approval_refuses_a_decided_review(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        item = db.query(RunItem).filter_by(run_id="r1").one()
        item.item_metadata = {"metric_analyses": {"accuracy": {"root_cause": "Retrieval miss", "source": "human"}}}
        db.add(
            ReviewCorrection(
                run_id="r1", item_id="item-1", metric_name="accuracy", task="task", ai_root_cause="",
                human_root_cause="Retrieval miss", human_root_causes=["Retrieval miss"],
                corrected_by_user_id="member-1", is_active=True, status=CorrectionStatus.APPROVED,
                reviewed_by_user_id="manager-1", reviewed_at=DECIDED_AT, created_at=datetime(2026, 9, 1),
            )
        )
        db.commit()
    response = client.post(
        "/api/corrections/approve-metric-analysis",
        json={"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy"},
        headers=_ui(MANAGER),
    )
    assert response.status_code == 409, response.text
    assert "This correction is approved" in response.json()["detail"]
    with session_factory() as db:
        row = db.query(ReviewCorrection).filter_by(run_id="r1").one()
        assert (row.status, row.reviewed_by_user_id, row.reviewed_at) == (CorrectionStatus.APPROVED, "manager-1", DECIDED_AT)


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------


def test_reviews_bulk_buttons_send_only_the_rows_they_fit():
    source = (DASHBOARD / "reviews.html").read_text(encoding="utf-8")
    assert "approve: { label: 'Approve', fits: c => c.status === 'pending'" in source
    assert "reset: { label: 'Reset', fits: c => c.status === 'approved' || c.status === 'rejected'" in source
    for action in ("approve", "reject", "reset"):
        handler = source[source.index(f"const pick = bulkSelection('{action}');") :][:1600]
        assert f"if (refuseUnfitSelection('{action}', pick)) return;" in handler
        assert "const ids = pick.ids;" in handler
        assert f"skippedNote('{action}', pick.skipped, true)" in handler


def test_run_page_offers_approve_only_on_pending_issues():
    functions = "\n".join(_function("run", name) for name in ("rootCauseIssues", "renderMetricRootCauseIssues"))
    _run_javascript(functions + r"""
        const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const escapeAttr = escapeHtml;
        const rootCauseColor = () => 'var(--warning)';
        const IS_EXPORT = false;
        const render = status => renderMetricRootCauseIssues(
          {root_cause_issues: [{issue_id: 'i1', category: 'Retrieval', review_status: status}]}, 'item-1', 'accuracy');
        assert.ok(render('pending').includes('data-approve-issue="0"'));
        assert.ok(render('pending').includes('Pending review'));
        // A rejected issue is reset on Reviews before it can be approved.
        assert.ok(!render('rejected').includes('data-approve-issue'));
        assert.ok(render('rejected').includes('>Rejected</span>'));
        assert.ok(render('rejected').includes('Reset it to pending on Reviews'));
        assert.ok(!render('approved').includes('data-approve-issue'));
    """)


# ---------------------------------------------------------------------------
# Run page: each issue's review status comes from its correction (leftover)
# ---------------------------------------------------------------------------


def _row(db, run, item_id):
    rows = runs_api._build_run_data(db, run, compact=True)["snapshot"]["rows"]
    return next(row for row in rows if row["item_id"] == item_id)


def _json_says_pending(issues):
    for issue in issues:
        issue["review_status"] = "pending"


def test_run_payload_gives_each_issue_its_correction_status(db_session):
    """Older data: an issue's JSON says pending while its correction is
    approved or rejected. The run page showed Approve and the server refused
    it (409). The payload now names each issue's own review status, the one
    Approve is judged by."""
    _, run, item, principal = setup(db_session)
    runs_api.update_root_cause_issue(_issue_request(item, 0), db=db_session, principal=principal)
    db_session.expire_all()
    first, second = candidates(db_session, run)
    reject_correction(second.id, {"comment": "no"}, db=db_session, principal=principal)
    db_session.expire_all()
    metadata = deepcopy(item.item_metadata)
    issues = metadata["metric_analyses"]["accuracy"]["root_cause_issues"]
    ids = [issue["issue_id"] for issue in issues]
    _json_says_pending(issues)
    item.item_metadata = metadata
    db_session.commit()

    row = _row(db_session, run, item.item_id)
    assert row["review_issue_statuses"] == {
        "accuracy": [{"issue_id": ids[0], "status": "approved"}, {"issue_id": ids[1], "status": "rejected"}]
    }
    # The same statuses the Approve route judges by.
    for index in (0, 1):
        with pytest.raises(HTTPException) as refused:
            runs_api.update_root_cause_issue(_issue_request(item, index), db=db_session, principal=principal)
        assert refused.value.status_code == 409
        db_session.rollback()
        db_session.expire_all()

    # Reset on Reviews: pending again, and Approve goes through.
    reset_correction(second.id, db=db_session, principal=principal)
    db_session.expire_all()
    assert _row(db_session, run, item.item_id)["review_issue_statuses"]["accuracy"][1]["status"] == "pending"
    result = runs_api.update_root_cause_issue(_issue_request(item, 1), db=db_session, principal=principal)
    assert [entry["status"] for entry in result["row"]["review_issue_statuses"]["accuracy"]] == ["approved", "approved"]

    # An issue whose content no longer matches its review would get a new
    # pending review: pending, and Approve goes through.
    db_session.expire_all()
    metadata = deepcopy(item.item_metadata)
    metadata["metric_analyses"]["accuracy"]["root_cause_issues"][0]["finding"] = "Changed outside the routes"
    item.item_metadata = metadata
    db_session.commit()
    assert _row(db_session, run, item.item_id)["review_issue_statuses"]["accuracy"][0]["status"] == "pending"
    runs_api.update_root_cause_issue(_issue_request(item, 0), db=db_session, principal=principal)


def test_run_payload_sends_statuses_only_where_the_json_reading_differs(db_session):
    """Without a review row every issue is pending to the Approve route. The
    payload leaves such an analysis out while its JSON reads pending too (most
    analysed items), and names pending when the JSON says decided."""
    _, run, item, principal = setup(db_session)
    assert _row(db_session, run, item.item_id)["review_issue_statuses"] == {}
    metadata = deepcopy(item.item_metadata)
    metadata["metric_analyses"]["accuracy"]["review_status"] = "approved"
    item.item_metadata = metadata
    db_session.commit()
    statuses = _row(db_session, run, item.item_id)["review_issue_statuses"]["accuracy"]
    assert [entry["status"] for entry in statuses] == ["pending", "pending"]
    # The Approve route agrees.
    runs_api.update_root_cause_issue(_issue_request(item, 0, by_id=False), db=db_session, principal=principal)


@pytest.mark.parametrize("status", [CorrectionStatus.APPROVED, CorrectionStatus.REJECTED])
def test_run_payload_gives_a_legacy_grouped_issue_its_review_status(client, session_factory, status):
    with session_factory() as db:
        _run(db, "r1")
        _legacy_group(db, status=status)
        item = db.query(RunItem).filter_by(run_id="r1").one()
        metadata = deepcopy(item.item_metadata)
        _json_says_pending(metadata["metric_analyses"]["accuracy"]["root_cause_issues"])
        item.item_metadata = metadata
        db.commit()
    row = _ok(client.get("/api/runs/r1?view=compact", headers=_ui(MANAGER)))["snapshot"]["rows"][0]
    # No issue ID yet: the entry goes by position.
    assert row["review_issue_statuses"] == {"accuracy": [{"issue_id": "", "status": status.value}]}


def test_pass_payload_gives_each_pass_issue_its_correction_status(db_session):
    _, run, item, principal = setup(db_session)
    run.samples = 2
    analysis = deepcopy(item.item_metadata["metric_analyses"]["accuracy"])
    for number in (1, 2):
        db_session.add(RunItemPassScore(run_id=run.id, item_id=item.item_id, metric_name="accuracy", pass_number=number,
                                        score_numeric=0, meta={PASS_ANALYSIS_META_KEY: deepcopy(analysis)}))
    db_session.commit()
    act(db_session, run, item, principal, "approve", 0, pass_number=2)
    score = db_session.query(RunItemPassScore).filter_by(pass_number=2).one()
    meta = deepcopy(score.meta)
    _json_says_pending(meta[PASS_ANALYSIS_META_KEY]["root_cause_issues"])
    score.meta = meta
    db_session.commit()

    statuses = _row(db_session, run, item.item_id)["pass_review_issue_statuses"]["accuracy"]
    assert [entry["status"] for entry in statuses[1]] == ["approved", "pending"]
    # Pass 1 has no review row and its JSON reads pending: nothing to send.
    assert statuses[0] is None


def test_pass_statuses_read_each_review_row_once_without_its_snapshots(db_session, monkeypatch):
    """Final review (run page cost on reviewed repeat runs): the build loaded
    every active pass review row in full, with the item's four snapshots, and
    normalized each row's issues four times. The statuses need only the status
    and the issue columns, normalized once per row."""
    from sqlalchemy import event

    from qym_platform.services import issue_reviews

    _, run, item, principal = setup(db_session)
    run.samples = 2
    analysis = deepcopy(item.item_metadata["metric_analyses"]["accuracy"])
    for number in (1, 2):
        db_session.add(RunItemPassScore(run_id=run.id, item_id=item.item_id, metric_name="accuracy", pass_number=number,
                                        score_numeric=0, meta={PASS_ANALYSIS_META_KEY: deepcopy(analysis)}))
    db_session.commit()
    for number in (1, 2):
        act(db_session, run, item, principal, "approve", 0, pass_number=number)
    active = db_session.query(ReviewCorrection).filter(
        ReviewCorrection.is_active.is_(True), ReviewCorrection.pass_number.isnot(None)
    ).order_by(ReviewCorrection.id).all()
    pass_rows = len(active)
    assert pass_rows == 4
    pending = next(c for c in active if c.pass_number == 2 and c.status == CorrectionStatus.PENDING)
    reject_correction(pending.id, {"comment": "no"}, db=db_session, principal=principal)
    run_id, item_id = run.id, item.item_id
    db_session.expunge_all()
    run = db_session.get(type(run), run_id)

    statements = []
    normalized = []
    real_issues = issue_reviews.correction_issues

    def capture(_conn, _cursor, statement, *_args):
        statements.append(statement)

    def counting(correction):
        normalized.append(correction.id)
        return real_issues(correction)

    monkeypatch.setattr(issue_reviews, "correction_issues", counting)
    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        row = _row(db_session, run, item_id)
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    statuses = row["pass_review_issue_statuses"]["accuracy"]
    assert [entry["status"] for entry in statuses[0]] == ["approved", "pending"]
    assert [entry["status"] for entry in statuses[1]] == ["approved", "rejected"]
    pass_queries = [
        sql for sql in statements
        if "FROM review_corrections" in sql and "review_corrections.pass_number IS NOT NULL" in sql
    ]
    assert len(pass_queries) == 1
    for column in ("input_snapshot", "expected_snapshot", "output_snapshot", "scores_snapshot"):
        assert column not in pass_queries[0]
    # Each pass review row's issues are normalized once.
    assert len(normalized) == pass_rows and len(set(normalized)) == pass_rows


def test_run_page_offers_approve_by_the_issue_review_status():
    functions = "\n".join(
        _function("run", name)
        for name in ("rootCauseIssues", "renderMetricRootCauseIssues", "scopedPassAttempt",
                     "scopedPassMetricMeta", "scopedPassItemMetadata", "scopeRowToPass")
    )
    _run_javascript(functions + r"""
        const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const escapeAttr = escapeHtml;
        const rootCauseColor = () => 'var(--warning)';
        const IS_EXPORT = false;
        const analysis = {review_status: 'pending', root_cause_issues: [
          {issue_id: 'i1', category: 'Retrieval', review_status: 'pending'},
          {issue_id: 'i2', category: 'Prompt', review_status: 'pending'},
        ]};
        const render = (statuses, value = analysis) => renderMetricRootCauseIssues(value, 'item-1', 'accuracy', {}, statuses);
        const approveButtons = html => (html.match(/data-approve-issue="/g) || []).length;
        // The JSON says pending; the issues' own reviews are decided.
        const decided = render([{issue_id: 'i2', status: 'rejected'}, {issue_id: 'i1', status: 'approved'}]);
        assert.equal(approveButtons(decided), 0);
        assert.ok(decided.includes('rc-status-pill approved">Approved</span>'));
        assert.ok(decided.includes('>Rejected</span>'));
        // The review status wins over the JSON either way.
        const pending = render([{issue_id: 'i1', status: 'pending'}, {issue_id: 'i2', status: 'pending'}],
          {root_cause_issues: analysis.root_cause_issues.map(issue => ({...issue, review_status: 'approved'}))});
        assert.equal(approveButtons(pending), 2);
        // Without statuses (an exported page) the JSON still decides.
        assert.equal(approveButtons(render(undefined)), 2);
        // An issue without an ID goes by position, never by another issue's entry.
        const legacy = {root_cause_issues: [{category: 'Retrieval'}]};
        assert.equal(approveButtons(render([{issue_id: '', status: 'approved'}], legacy)), 0);
        assert.equal(approveButtons(render([{issue_id: 'i9', status: 'approved'}], legacy)), 1);

        // A pass view reads that pass's statuses.
        const row = {
          item_id: 'item-1', item_metadata: {},
          pass_metric_analyses: {accuracy: [analysis, analysis]},
          pass_review_issue_statuses: {accuracy: [
            [{issue_id: 'i1', status: 'pending'}, {issue_id: 'i2', status: 'pending'}],
            [{issue_id: 'i1', status: 'approved'}, {issue_id: 'i2', status: 'pending'}],
          ]},
        };
        for (const [pass, buttons] of [[1, 2], [2, 1]]) {
          const scoped = scopeRowToPass(row, ['accuracy'], pass);
          const html = renderMetricRootCauseIssues(scoped.item_metadata.metric_analyses.accuracy, 'item-1', 'accuracy',
            scoped.review_corrections.accuracy, scoped.review_issue_statuses.accuracy);
          assert.equal(approveButtons(html), buttons, 'pass ' + pass);
        }
    """)
