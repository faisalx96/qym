"""Feedback API: create, visibility (QE-167), confirm, numbers, status codes, reads write nothing (QE-159, QE-165, QE-166)."""

from __future__ import annotations

import threading

import pytest
from _feedback_support import make_env, parse_sse


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch, feedback_stub_url):
    with make_env(monkeypatch, request.param) as e:
        e.configure(feedback_stub_url)
        e.act_as("sara")
        yield e


def draft(env, message="We need a PDF export.", script="ask_then_propose"):
    env.set_script(script)
    r = env.client.post(
        "/v1/feedback", json={"subject": "platform", "message": message}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def propose(env, rid):
    env.client.post(f"/v1/feedback/{rid}/turn")
    r = env.client.post(
        f"/v1/feedback/{rid}/messages",
        json={"content": "Five analysts, weekly, a PDF is enough."},
    )
    events = parse_sse(r.text)
    return next(d for e, d in events if e == "proposal")["proposal"]


def confirm_body(proposal, **over):
    return {
        "title": proposal["title"],
        "description": proposal["description"],
        "priority": proposal["priority"]["level"],
        "complexity": proposal["complexity"]["level"],
        "proposal_seq": proposal["seq"],
        **over,
    }


def test_status_reports_configuration_and_who_can_configure(env):
    assert env.client.get("/v1/feedback/status").json() == {
        "configured": True,
        "encryption_ready": True,
        "can_configure": False,
    }
    env.act_as("admin")
    assert env.client.get("/v1/feedback/status").json()["can_configure"] is True
    assert env.client.delete("/v1/admin/feedback-agent").status_code == 204
    env.act_as("sara")
    assert env.client.get("/v1/feedback/status").json()["configured"] is False
    r = env.client.post("/v1/feedback", json={"subject": "platform", "message": "x"})
    assert r.status_code == 503 and r.json()["code"] == "feedback_not_configured"


def test_a_draft_is_visible_only_to_its_submitter_even_for_administrators(env):
    rid = draft(env)
    for who in ("omar", "admin"):
        env.act_as(who)
        for method, path, kw in (
            ("get", f"/v1/feedback/{rid}", {}),
            ("get", f"/v1/feedback/{rid}/messages", {}),
            ("post", f"/v1/feedback/{rid}/turn", {}),
            ("post", f"/v1/feedback/{rid}/messages", {"json": {"content": "hi"}}),
            (
                "post",
                f"/v1/feedback/{rid}/confirm",
                {
                    "json": {
                        "title": "t",
                        "description": "d",
                        "priority": "low",
                        "complexity": "S",
                        "proposal_seq": 1,
                    }
                },
            ),
            ("delete", f"/v1/feedback/{rid}", {}),
        ):
            r = getattr(env.client, method)(path, **kw)
            assert r.status_code == 404, (who, method, path, r.text)
        listing = env.client.get("/v1/feedback").json()
        assert listing["items"] == [] and listing["drafts"] == []
    env.act_as("sara")
    listing = env.client.get("/v1/feedback").json()
    assert [d["id"] for d in listing["drafts"]] == [rid] and listing["items"] == []


def test_confirm_assigns_a_number_stores_the_agent_values_and_is_idempotent(env):
    rid = draft(env)
    proposal = propose(env, rid)
    body = confirm_body(proposal, priority="high", complexity="L", title="Edited title")
    r = env.client.post(f"/v1/feedback/{rid}/confirm", json=body)
    assert r.status_code == 200, r.text
    req = r.json()["request"]
    assert (
        req["ref"] == "FB-0001"
        and req["status"] == "new"
        and req["title"] == "Edited title"
    )
    assert (
        req["priority"] == "high"
        and req["agent"]["priority"] == "medium"
        and req["agent"]["complexity"] == "M"
    )
    assert req["agent"]["priority_reasoning"]
    assert [e["kind"] for e in r.json()["events"]] == ["submitted"]
    again = env.client.post(f"/v1/feedback/{rid}/confirm", json=body)
    assert (
        again.status_code == 409
        and again.json()["code"] == "already_confirmed"
        and again.json()["request"] == "FB-0001"
    )
    env.act_as("omar")
    assert env.client.get("/v1/feedback/FB-0001").status_code == 200
    assert env.client.get(f"/v1/feedback/{rid}/messages").json()["messages"]
    from qym_platform.db.models import AuditLog

    with env.db() as db:
        assert db.query(AuditLog).filter_by(action="feedback.confirmed").count() == 1


def test_confirm_validates_the_proposal_and_the_values(env):
    rid = draft(env)
    r = env.client.post(
        f"/v1/feedback/{rid}/confirm",
        json={
            "title": "t",
            "description": "d",
            "priority": "low",
            "complexity": "S",
            "proposal_seq": 1,
        },
    )
    assert r.status_code == 409 and r.json()["code"] == "no_proposal"
    proposal = propose(env, rid)
    assert (
        env.client.post(
            f"/v1/feedback/{rid}/confirm",
            json=confirm_body(proposal, proposal_seq=proposal["seq"] + 5),
        ).json()["code"]
        == "proposal_stale"
    )
    assert (
        env.client.post(
            f"/v1/feedback/{rid}/confirm",
            json=confirm_body(proposal, priority="urgent"),
        ).status_code
        == 422
    )
    assert (
        env.client.post(
            f"/v1/feedback/{rid}/confirm", json=confirm_body(proposal, complexity="XXL")
        ).status_code
        == 422
    )
    assert (
        env.client.post(
            f"/v1/feedback/{rid}/confirm", json=confirm_body(proposal, description="  ")
        ).status_code
        == 422
    )
    # A new message supersedes the proposal.
    env.set_script("ask_then_propose")
    env.client.post(f"/v1/feedback/{rid}/messages", json={"content": "One more thing"})
    stale = env.client.post(f"/v1/feedback/{rid}/confirm", json=confirm_body(proposal))
    assert stale.status_code == 409 and stale.json()["code"] == "proposal_stale"


def test_numbers_are_unique_and_gap_free(env):
    refs = []
    for i in range(3):
        rid = draft(env, f"Request {i}")
        refs.append(
            env.client.post(
                f"/v1/feedback/{rid}/confirm", json=confirm_body(propose(env, rid))
            ).json()["request"]["ref"]
        )
    assert refs == ["FB-0001", "FB-0002", "FB-0003"]


def test_two_concurrent_confirmations_get_different_numbers(env):
    if env.engine.dialect.name != "postgresql":
        pytest.skip("needs two real connections (PostgreSQL)")
    from qym_platform.auth import Principal
    from qym_platform.db.feedback_models import FeedbackRequest
    from qym_platform.db.models import User
    from qym_platform.feedback_agent import lifecycle

    ids = []
    for i in range(2):
        rid = draft(env, f"Concurrent {i}")
        propose(env, rid)
        ids.append(rid)
    results, errors = [], []

    def go(rid):
        db = env.factory()
        try:
            user = db.get(User, env.users["sara"])
            req = db.get(FeedbackRequest, rid)
            p = req.proposal
            lifecycle.confirm(
                db,
                Principal(user=user, auth_type="none"),
                req,
                {
                    "title": "T",
                    "description": "Some description",
                    "priority": "low",
                    "complexity": "S",
                    "proposal_seq": p["seq"],
                },
            )
            db.commit()
            results.append(req.number)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=go, args=(rid,)) for rid in ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    assert sorted(results) == [1, 2]


def test_product_requests_need_a_project_the_caller_can_access(env):
    from qym_platform.db.models import Project, ProjectMembership, ProjectRole

    with env.db() as db:
        db.add(
            Project(
                id="p1",
                name="Support agent",
                slug="support-agent",
                created_by_user_id=env.users["admin"],
            )
        )
        db.add(
            Project(
                id="p2",
                name="Secret",
                slug="secret",
                created_by_user_id=env.users["admin"],
            )
        )
        db.flush()
        db.add(
            ProjectMembership(
                project_id="p1", user_id=env.users["sara"], role=ProjectRole.MEMBER
            )
        )
        db.commit()
    body = {"subject": "product", "message": "Runs are slow to open"}
    assert env.client.post("/v1/feedback", json=body).status_code == 422
    assert (
        env.client.post("/v1/feedback", json={**body, "project_id": "p2"}).status_code
        == 403
    )
    r = env.client.post("/v1/feedback", json={**body, "project_id": "support-agent"})
    assert r.status_code == 201
    detail = env.client.get(f"/v1/feedback/{r.json()['id']}").json()["request"]
    assert (
        detail["subject"] == "product" and detail["project"]["slug"] == "support-agent"
    )
    bad_target = env.client.post(
        "/v1/feedback",
        json={**body, "project_id": "p1", "target": {"kind": "run", "id": "nope"}},
    )
    assert bad_target.status_code == 422
    env.act_as("admin")
    assert (
        env.client.post("/v1/feedback", json={**body, "project_id": "p2"}).status_code
        == 201
    )


def test_messages_are_validated_paged_and_deletable(env):
    rid = draft(env)
    assert (
        env.client.post(
            f"/v1/feedback/{rid}/messages", json={"content": "   "}
        ).status_code
        == 422
    )
    assert (
        env.client.post(
            f"/v1/feedback/{rid}/messages", json={"content": "x" * 4001}
        ).status_code
        == 422
    )
    env.client.post(f"/v1/feedback/{rid}/turn")
    first = env.client.get(f"/v1/feedback/{rid}/messages?limit=1").json()
    assert (
        len(first["messages"]) == 1
        and first["has_more"]
        and first["messages"][0]["role"] == "assistant"
    )
    older = env.client.get(
        f"/v1/feedback/{rid}/messages?before_seq={first['messages'][0]['seq']}"
    ).json()
    assert older["messages"][0]["role"] == "user" and not older["has_more"]
    assert env.client.delete(f"/v1/feedback/{rid}").status_code == 204
    assert env.client.get(f"/v1/feedback/{rid}").status_code == 404
    from qym_platform.db.feedback_models import FeedbackMessage
    from qym_platform.db.models import AuditLog

    with env.db() as db:
        assert db.query(FeedbackMessage).count() == 0
        assert (
            db.query(AuditLog).filter_by(action="feedback.draft_deleted").count() == 1
        )


def test_reading_writes_nothing(env):
    rid = draft(env)
    env.confirmed("omar", "A request", number=1)
    from sqlalchemy import event

    writes = []

    @event.listens_for(env.engine, "before_cursor_execute")
    def watch(conn, cursor, statement, params, context, executemany):  # noqa: ANN001
        if statement.lstrip().split(" ", 1)[0].upper() in (
            "INSERT",
            "UPDATE",
            "DELETE",
        ):
            writes.append(statement)

    for path in (
        "/v1/feedback/status",
        "/v1/feedback",
        f"/v1/feedback/{rid}",
        f"/v1/feedback/{rid}/messages",
        "/v1/feedback/FB-0001",
    ):
        assert env.client.get(path).status_code == 200, path
    event.remove(env.engine, "before_cursor_execute", watch)
    assert writes == []


def test_rate_limits_answer_429_with_retry_after(env, monkeypatch):
    monkeypatch.setenv("QYM_FEEDBACK_DRAFTS_PER_DAY", "2")
    monkeypatch.setenv("QYM_FEEDBACK_MESSAGES_PER_HOUR", "3")
    draft(env)
    rid = draft(env)
    r = env.client.post(
        "/v1/feedback", json={"subject": "platform", "message": "third"}
    )
    assert (
        r.status_code == 429
        and r.json()["code"] == "rate_limited"
        and int(r.headers["Retry-After"]) > 0
    )
    r = env.client.post(
        f"/v1/feedback/{rid}/messages", json={"content": "second message"}
    )
    assert r.status_code == 200
    r = env.client.post(
        f"/v1/feedback/{rid}/messages", json={"content": "over the hour limit"}
    )
    assert r.status_code == 429


def test_the_list_filters_sorts_pages_and_groups_confirmed_duplicates(env):
    a = env.confirmed(
        "omar",
        "Export the compare page as PDF",
        number=1,
        priority="high",
        complexity="M",
    )
    b = env.confirmed(
        "omar",
        "PDF export of the compare view",
        number=2,
        priority="low",
        complexity="S",
    )
    env.confirmed(
        "sara",
        "Dark mode for charts",
        number=3,
        subject="platform",
        status="accepted",
        priority="critical",
        complexity="XL",
    )
    from qym_platform.db.feedback_models import FeedbackRequest

    with env.db() as db:
        db.get(FeedbackRequest, b).duplicate_of_id = a
        db.commit()
    body = env.client.get("/v1/feedback").json()
    assert (
        [i["ref"] for i in body["items"]]
        and body["total"] == 2
        and body["matching"] == 3
    )
    assert [c["ref"] for c in body["children"][a]] == ["FB-0002"]
    assert body["children"][a][0]["duplicate_of"] == "FB-0001"
    assert body["counts"] == {"all": 3, "new": 2, "duplicate_pairs": 1}
    # A duplicate whose canonical request is filtered out is a top-level row.
    only_low = env.client.get("/v1/feedback?priority=low").json()
    assert [i["ref"] for i in only_low["items"]] == ["FB-0002"] and only_low[
        "children"
    ] == {}
    assert [
        i["ref"]
        for i in env.client.get("/v1/feedback?sort=priority:desc").json()["items"]
    ][0] == "FB-0003"
    assert [
        i["ref"]
        for i in env.client.get("/v1/feedback?sort=complexity:desc").json()["items"]
    ][0] == "FB-0003"
    assert [
        i["ref"] for i in env.client.get("/v1/feedback?status=accepted").json()["items"]
    ] == ["FB-0003"]
    assert [
        i["ref"] for i in env.client.get("/v1/feedback?q=dark").json()["items"]
    ] == ["FB-0003"]
    assert [
        i["ref"] for i in env.client.get("/v1/feedback?q=FB-0001").json()["items"]
    ] == ["FB-0001"]
    assert [
        i["ref"] for i in env.client.get("/v1/feedback?mine=true").json()["items"]
    ] == ["FB-0003"]
    assert [
        i["ref"] for i in env.client.get("/v1/feedback?complexity=XL,S").json()["items"]
    ]
    assert env.client.get("/v1/feedback?page_size=1&page=2").json()["items"][0][
        "ref"
    ] in ("FB-0001", "FB-0003")
    assert env.client.get("/v1/feedback?about=product").json()["items"] == []


def test_targets_list_a_projects_items_for_members_of_that_project_only(env):
    from qym_platform.db.models import (Dataset, Project, ProjectMembership,
                                        ProjectRole)

    with env.db() as db:
        db.add(
            Project(
                id="p1",
                name="Support agent",
                slug="support-agent",
                created_by_user_id=env.users["admin"],
            )
        )
        db.flush()
        db.add(
            ProjectMembership(
                project_id="p1", user_id=env.users["sara"], role=ProjectRole.MEMBER
            )
        )
        db.add(
            Dataset(
                id="d1",
                project_id="p1",
                name="tickets",
                slug="tickets",
                created_by_user_id=env.users["admin"],
            )
        )
        db.commit()
    r = env.client.get("/v1/feedback/targets?project_id=support-agent&kind=dataset")
    assert r.status_code == 200 and r.json()["items"] == [
        {"id": "d1", "label": "tickets"}
    ]
    assert env.client.get("/v1/feedback/targets?project_id=p1&kind=run").json() == {
        "items": []
    }
    assert (
        env.client.get("/v1/feedback/targets?project_id=p1&kind=nope").status_code
        == 422
    )
    env.act_as("omar")
    assert (
        env.client.get("/v1/feedback/targets?project_id=p1&kind=dataset").status_code
        == 403
    )


def test_stop_without_a_running_turn_is_a_no_op_and_only_for_the_submitter(env):
    rid = draft(env)
    assert env.client.post(f"/v1/feedback/{rid}/stop").status_code == 204
    env.act_as("omar")
    assert env.client.post(f"/v1/feedback/{rid}/stop").status_code == 404
