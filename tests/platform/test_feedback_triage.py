"""Administrator triage: rules, history, audit, stale writes (QE-97 to QE-108, spec section 7)."""

from __future__ import annotations

import pytest

from _feedback_support import make_env


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch):
    with make_env(monkeypatch, request.param) as e:
        e.a = e.confirmed("omar", "Export the compare page as PDF", number=1, priority="medium", complexity="M")
        e.b = e.confirmed("sara", "PDF export of the compare view", number=2)
        e.act_as("admin")
        yield e


def stamp(env, ref):
    return env.client.get(f"/v1/feedback/{ref}").json()["request"]["updated_at"]


def patch(env, ref, **body):
    body.setdefault("expected_updated_at", stamp(env, ref))
    return env.client.patch(f"/v1/feedback/{ref}/triage", json=body)


def audit_actions(env):
    from qym_platform.db.models import AuditLog

    with env.db() as db:
        return [a.action for a in db.query(AuditLog).order_by(AuditLog.id).all()]


def test_only_administrators_triage(env):
    env.act_as("omar")
    r = env.client.patch("/v1/feedback/FB-0001/triage", json={"status": "accepted", "expected_updated_at": "x"})
    assert r.status_code == 403 and r.json()["code"] == "not_admin"


def test_status_changes_need_no_note_and_write_event_and_audit(env):
    r = patch(env, "FB-0001", status="accepted")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["request"]["status"] == "accepted"
    assert [e["kind"] for e in body["new_events"]] == ["status"]
    assert body["events"][0]["after"] == {"status": "accepted"} and body["events"][0]["actor"] == "Admin"
    assert audit_actions(env) == ["feedback.status_changed"]


def test_priority_complexity_and_duplicates_require_a_note(env):
    for field, value in (("priority", "high"), ("complexity", "L")):
        r = patch(env, "FB-0001", **{field: value})
        assert r.status_code == 422 and r.json()["field"] == "note"
    r = patch(env, "FB-0001", priority="high", complexity="L", note="Three teams asked this week.")
    assert r.status_code == 200
    kinds = [e["kind"] for e in r.json()["new_events"]]
    assert sorted(kinds) == ["complexity", "priority"]
    assert all(e["note"] == "Three teams asked this week." for e in r.json()["new_events"])
    assert r.json()["events"][0]["before"] in ({"priority": "medium"}, {"complexity": "M"})
    assert sorted(audit_actions(env)) == ["feedback.complexity_revised", "feedback.priority_revised"]


def test_decline_needs_a_reason_shown_to_everyone_and_reopen_clears_it(env):
    assert patch(env, "FB-0001", status="declined").status_code == 422
    r = patch(env, "FB-0001", status="declined", decline_reason="Out of scope for this year.")
    assert r.status_code == 200 and r.json()["new_events"][0]["kind"] == "declined"
    env.act_as("omar")
    seen = env.client.get("/v1/feedback/FB-0001").json()["request"]
    assert seen["status"] == "declined" and seen["decline_reason"] == "Out of scope for this year."
    env.act_as("admin")
    assert patch(env, "FB-0001", status="new").json()["request"]["decline_reason"] is None
    assert "feedback.declined" in audit_actions(env)


def test_marking_a_duplicate_links_both_pages_and_refuses_chains(env):
    assert patch(env, "FB-0002", duplicate_of="FB-0001").status_code == 422  # note missing
    r = patch(env, "FB-0002", duplicate_of="FB-0001", note="Same request.")
    assert r.status_code == 200 and r.json()["request"]["duplicate_of"] == "FB-0001"
    assert [e["kind"] for e in r.json()["new_events"]] == ["duplicate"]
    canon = env.client.get("/v1/feedback/FB-0001").json()
    assert [(x["kind"], x["direction"], x["request"]["ref"]) for x in canon["related"]] == [("duplicate", "duplicate", "FB-0002")]
    dup = env.client.get("/v1/feedback/FB-0002").json()
    assert dup["related"][0]["direction"] == "canonical"
    r = patch(env, "FB-0001", duplicate_of="FB-0002", note="Loop")
    assert r.status_code == 409 and r.json()["code"] in ("duplicate_chain", "has_duplicates")
    env.confirmed("omar", "Third", number=3)
    r = patch(env, "FB-0003", duplicate_of="FB-0002", note="Chain")
    assert r.status_code == 409 and r.json()["code"] == "duplicate_chain"
    r = patch(env, "FB-0001", duplicate_of="FB-0003", note="Move the original")
    assert r.status_code == 409 and r.json()["code"] == "has_duplicates"
    assert patch(env, "FB-0002", duplicate_of="FB-0002", note="x").status_code == 422
    r = patch(env, "FB-0002", duplicate_of=None, note="Not the same after all.")
    assert r.status_code == 200 and r.json()["request"]["duplicate_of"] is None
    assert [e["kind"] for e in r.json()["new_events"]] == ["duplicate_cleared"]
    assert audit_actions(env)[-2:] == ["feedback.duplicate_marked", "feedback.duplicate_cleared"]


def test_two_administrators_saving_at_once_the_second_gets_409_stale(env):
    first = stamp(env, "FB-0001")
    assert env.client.patch("/v1/feedback/FB-0001/triage", json={"status": "planned", "expected_updated_at": first}).status_code == 200
    r = env.client.patch("/v1/feedback/FB-0001/triage", json={"status": "done", "expected_updated_at": first})
    assert r.status_code == 409 and r.json()["code"] == "stale"
    assert env.client.patch("/v1/feedback/FB-0001/triage", json={"status": "done"}).status_code == 422


def test_drafts_cannot_be_triaged_and_unknown_requests_are_404(env):
    env.act_as("sara")
    env.client  # noqa: B018
    from qym_platform.db.feedback_models import FeedbackRequest

    with env.db() as db:
        row = FeedbackRequest(subject="platform", status="draft", submitter_user_id=env.users["admin"], checklist={}, conflicts=[], agent_reasoning={})
        db.add(row)
        db.commit()
        rid = row.id
    env.act_as("admin")
    r = env.client.patch(f"/v1/feedback/{rid}/triage", json={"status": "new", "expected_updated_at": "x"})
    assert r.status_code == 409 and r.json()["code"] == "not_confirmed"
    assert env.client.patch("/v1/feedback/FB-0099/triage", json={"status": "new", "expected_updated_at": "x"}).status_code == 404
