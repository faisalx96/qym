"""Data factory: connect a dataset, categories, rules, approvals, access and the jobs.

The fixture is the archived-project one (project ``pa``; ``mgr`` manages it,
``member`` is a member, ``outsider`` is not; datasets ``faq`` (connected as
factory ``f1`` with categories ``fc1`` General and ``fc2`` Format, rule
``fr1`` and the queued job ``fj1``) and ``spare``). The route-role and
archived-project suites cover the Viewer and archive refusals of the write
routes. Model calls are faked: ``complete_json`` is replaced by a scripted
function and the client build by a stub.
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
import test_archived_project_read_only as arch
from alembic.migration import MigrationContext
from alembic.operations import Operations
from qym_platform.db.models import (
    Base,
    DataFactory,
    Dataset,
    DatasetItem,
    DatasetVersion,
    FactoryJob,
    FactoryRule,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.services import data_factory as svc
from test_archived_project_read_only import client  # noqa: F401 (fixtures)
from test_archived_project_read_only import session_factory  # noqa: F401 (fixtures)
from test_migrations import _load_migration

MEMBER, MGR, OUTSIDER, ADMIN = arch.MEMBER, arch.MGR, arch.OUTSIDER, arch.ADMIN
OTHER = {"X-User-Email": "other@x.com", "Origin": arch.ORIGIN}
FACTORY_TABLES = {
    "data_factories",
    "factory_grants",
    "factory_rule_categories",
    "factory_rules",
    "factory_rule_links",
    "factory_jobs",
}


def _seed_items(session_factory, rows):
    with session_factory() as db:
        for index, (item_id, topic, question, answer) in enumerate(rows):
            db.add(
                DatasetItem(
                    dataset_version_id="dsv1",
                    item_id=item_id,
                    index=index,
                    input={"question": question},
                    expected_output=answer,
                    item_metadata=(
                        topic
                        if isinstance(topic, dict)
                        else {"topic": topic} if topic else {}
                    ),
                    labels=[],
                    fingerprint=f"fp-{item_id}",
                )
            )
        version = db.get(DatasetVersion, "dsv1")
        version.item_count = len(rows)
        db.commit()


def _add_member(session_factory, user_id: str, email: str, role=ProjectRole.MEMBER):
    with session_factory() as db:
        db.add(User(id=user_id, email=email, role=UserRole.MEMBER))
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id=user_id, role=role))
        db.commit()


@pytest.fixture()
def fake_llm(monkeypatch):
    """Scripted model: ``script(system, user) -> dict``; records every prompt."""
    calls = []
    state = {"script": None}

    class _Client:
        async def close(self):
            return None

    monkeypatch.setattr(svc, "llm_connection_for", lambda db, factory: object())
    monkeypatch.setattr(svc, "build_client", lambda conn: (_Client(), "fake-model"))

    async def complete_json(client, model, system, user, *, temperature=0.2):
        calls.append({"system": system, "user": user, "temperature": temperature})
        result = state["script"](system, user)
        if inspect.isawaitable(result):
            result = await result
        return result

    monkeypatch.setattr(svc, "complete_json", complete_json)

    def install(script):
        state["script"] = script
        return calls

    return install


def _detail(client, headers=MEMBER, factory_id="f1"):
    response = client.get(f"/api/factories/{factory_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _rules(client, headers=MEMBER, **params):
    response = client.get("/api/factories/f1/rules", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _run_jobs(session_factory):
    worker = svc.FactoryWorker(session_factory)
    results = []
    while True:
        result = worker.tick()
        if result is None:
            return results
        results.append(result)


# ── Connecting ───────────────────────────────────────────────────────────────


def test_connecting_a_dataset_seeds_the_general_category(client):
    response = client.post(
        "/api/projects/pa/factories",
        json={"dataset_ref": "spare", "group_metadata_key": " topic "},
        headers=MEMBER,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["dataset"]["slug"] == "spare"
    assert body["group_metadata_key"] == "topic"
    assert body["access_mode"] == "project"
    assert [c["key"] for c in body["categories"]] == ["general"]
    assert body["source_version"] is None  # spare has no published version
    assert body["permissions"]["can_modify"] and body["permissions"]["is_creator"]
    assert body["permissions"]["can_disconnect"]  # the creator may disconnect
    assert not body["permissions"]["can_approve"]

    again = client.post(
        "/api/projects/pa/factories", json={"dataset_ref": "spare"}, headers=MEMBER
    )
    assert again.status_code == 409

    listed = client.get("/api/projects/pa/factories", headers=MEMBER).json()
    assert {f["dataset"]["slug"] for f in listed["factories"]} == {"faq", "spare"}
    assert set(listed["connected_dataset_ids"]) == {"ds1", "ds2"}


def test_connecting_needs_the_dataset_and_project_access(client, session_factory):
    assert (
        client.post(
            "/api/projects/pa/factories",
            json={"dataset_ref": "spare"},
            headers=OUTSIDER,
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/projects/pa/factories", json={"dataset_ref": "nope"}, headers=MEMBER
        ).status_code
        == 404
    )
    with session_factory() as db:
        dataset = db.get(Dataset, "ds2")
        dataset.private_test_set = True
        db.commit()
    refused = client.post(
        "/api/projects/pa/factories", json={"dataset_ref": "spare"}, headers=ADMIN
    )
    assert refused.status_code == 422
    assert "private test set" in refused.json()["detail"].lower()
    # A restricted dataset the member cannot modify cannot be connected by them.
    with session_factory() as db:
        dataset = db.get(Dataset, "ds2")
        dataset.private_test_set = False
        dataset.access_mode = "restricted"
        db.commit()
    assert (
        client.post(
            "/api/projects/pa/factories", json={"dataset_ref": "spare"}, headers=MEMBER
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/projects/pa/factories", json={"dataset_ref": "spare"}, headers=MGR
        ).status_code
        == 201
    )


def test_the_detail_lists_metadata_keys_of_the_source_version(client, session_factory):
    _seed_items(
        session_factory,
        [
            ("i1", "billing", "How do I pay?", "By card."),
            ("i2", "shipping", "When?", "Two days."),
            ("i3", "", "Hi", "Hello"),
        ],
    )
    body = _detail(client)
    assert (
        body["source_version"]["version"] == "v1"
        and body["source_version"]["item_count"] == 3
    )
    keys = {k["key"]: k for k in body["metadata_keys"]}
    assert set(keys) == {"topic"}
    assert sorted(keys["topic"]["values"]) == ["billing", "shipping"]
    assert keys["topic"]["kind"] == "scalar"
    assert body["llm_connections"][0]["id"] == "llm1"
    assert body["active_job"]["id"] == "fj1"


def test_outsiders_get_not_found_and_disconnect_is_for_the_creator_or_a_manager(
    client, session_factory
):
    assert client.get("/api/factories/f1", headers=OUTSIDER).status_code == 404
    assert client.get("/api/factories/missing", headers=MEMBER).status_code == 404
    # f1 was connected by mgr: the member may not disconnect it.
    assert client.delete("/api/factories/f1", headers=MEMBER).status_code == 403
    # ... and a queued job blocks the disconnect until cancelled.
    assert client.delete("/api/factories/f1", headers=MGR).status_code == 409
    assert (
        client.post("/api/factories/f1/jobs/fj1:cancel", headers=MGR).status_code == 200
    )
    assert client.delete("/api/factories/f1", headers=MGR).status_code == 200
    with session_factory() as db:
        assert db.get(DataFactory, "f1") is None
        assert db.query(FactoryRule).count() == 0
        assert db.query(FactoryJob).count() == 0
    assert client.get("/api/factories/f1", headers=MGR).status_code == 404


def test_settings_patch_clears_the_key_with_null_and_keeps_it_when_omitted(client):
    body = client.patch(
        "/api/factories/f1",
        json={"group_metadata_key": "topic", "analysis_instructions": " be terse "},
        headers=MEMBER,
    )
    assert body.status_code == 200, body.text
    assert body.json()["group_metadata_key"] == "topic"
    assert body.json()["analysis_instructions"] == "be terse"
    kept = client.patch(
        "/api/factories/f1", json={"generation_instructions": "x"}, headers=MEMBER
    ).json()
    assert kept["group_metadata_key"] == "topic"
    cleared = client.patch(
        "/api/factories/f1", json={"group_metadata_key": None}, headers=MEMBER
    ).json()
    assert cleared["group_metadata_key"] is None
    assert (
        client.patch(
            "/api/factories/f1", json={"llm_connection_id": "nope"}, headers=MEMBER
        ).status_code
        == 404
    )
    assert (
        client.patch(
            "/api/factories/f1", json={"llm_connection_id": "llm1"}, headers=MEMBER
        ).json()["llm_connection"]["id"]
        == "llm1"
    )


# ── Access ───────────────────────────────────────────────────────────────────


def test_restricted_access_and_the_approve_grant(client, session_factory):
    _add_member(session_factory, "other", "other@x.com")
    # Project mode: every member modifies, nobody but managers approves.
    assert _detail(client, OTHER)["permissions"] == {
        "access_level": "modify",
        "can_modify": True,
        "can_approve": False,
        "can_manage_access": False,
        "can_disconnect": False,
        "is_creator": False,
    }
    # An approve grant counts in project mode too.
    assert (
        client.put(
            "/api/factories/f1/access",
            json={
                "access_mode": "project",
                "grants": [{"user_id": "other", "level": "approve"}],
            },
            headers=MEMBER,
        ).status_code
        == 403
    )
    saved = client.put(
        "/api/factories/f1/access",
        json={
            "access_mode": "project",
            "grants": [{"user_id": "other", "level": "approve"}],
        },
        headers=MGR,
    )
    assert saved.status_code == 200, saved.text
    assert (
        saved.json()["grants"][0]["user"]["id"] == "other"
        and saved.json()["grants"][0]["level"] == "approve"
    )
    assert saved.json()["levels"] == ["view", "modify", "approve"]
    assert _detail(client, OTHER)["permissions"]["can_approve"]
    assert not _detail(client, MEMBER)["permissions"]["can_approve"]
    # Restricted: only listed people (and the creator) open it.
    restricted = client.put(
        "/api/factories/f1/access",
        json={
            "access_mode": "restricted",
            "grants": [{"user_id": "other", "level": "view"}],
        },
        headers=MGR,
    )
    assert restricted.status_code == 200
    assert client.get("/api/factories/f1", headers=MEMBER).status_code == 403
    listed = client.get("/api/projects/pa/factories", headers=MEMBER).json()
    assert listed["factories"] == [] and listed["connected_dataset_ids"] == ["ds1"]
    other = _detail(client, OTHER)
    assert (
        other["permissions"]["access_level"] == "view"
        and not other["permissions"]["can_modify"]
    )
    assert other["llm_connections"] == []  # view level: no settings choices
    assert (
        client.post(
            "/api/factories/f1/rules",
            json={"category_id": "fc1", "title": "x"},
            headers=OTHER,
        ).status_code
        == 403
    )
    # Bad grants are refused as a whole.
    assert (
        client.put(
            "/api/factories/f1/access",
            json={
                "access_mode": "restricted",
                "grants": [{"user_id": "other", "level": "owner"}],
            },
            headers=MGR,
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/factories/f1/access",
            json={
                "access_mode": "restricted",
                "grants": [{"user_id": "outsider", "level": "view"}],
            },
            headers=MGR,
        ).status_code
        == 422
    )
    access = client.get("/api/factories/f1/access", headers=OTHER).json()
    assert (
        access["your_level"] == "view"
        and not access["can_manage_access"]
        and access["candidates"] == []
    )


# ── Categories ───────────────────────────────────────────────────────────────


def test_categories_carry_a_strict_schema(client):
    schema = {
        "type": "object",
        "required": ["field"],
        "properties": {"field": {"type": "string"}},
        "additionalProperties": False,
    }
    created = client.post(
        "/api/factories/f1/categories",
        json={
            "name": "Field constraints",
            "description": "Rules about one field",
            "json_schema": schema,
        },
        headers=MEMBER,
    )
    assert created.status_code == 201, created.text
    category = created.json()
    assert (
        category["key"] == "field-constraints"
        and category["json_schema"] == schema
        and category["position"] == 1
    )
    assert (
        client.post(
            "/api/factories/f1/categories",
            json={"name": "Field constraints"},
            headers=MEMBER,
        ).status_code
        == 409
    )
    bad = client.post(
        "/api/factories/f1/categories",
        json={"name": "Bad", "json_schema": {"type": "nope"}},
        headers=MEMBER,
    )
    assert bad.status_code == 422 and "schema" in bad.json()["detail"].lower()
    assert (
        client.post(
            "/api/factories/f1/categories",
            json={"name": "Bad", "json_schema": []},
            headers=MEMBER,
        ).status_code
        == 422
    )

    # A rule body must follow the category schema; the General category takes any object or none.
    assert (
        client.post(
            "/api/factories/f1/rules",
            json={"category_id": category["id"], "title": "r", "body": {"other": 1}},
            headers=MEMBER,
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/factories/f1/rules",
            json={"category_id": category["id"], "title": "r"},
            headers=MEMBER,
        ).status_code
        == 422
    )
    ok = client.post(
        "/api/factories/f1/rules",
        json={"category_id": category["id"], "title": "r", "body": {"field": "x"}},
        headers=MEMBER,
    )
    assert ok.status_code == 201, ok.text
    assert (
        ok.json()["category_key"] == "field-constraints"
        and ok.json()["source"] == "manual"
    )

    patched = client.patch(
        f"/api/factories/f1/categories/{category['id']}",
        json={"name": "Fields", "json_schema": None},
        headers=MEMBER,
    )
    assert (
        patched.status_code == 200
        and patched.json()["json_schema"] is None
        and patched.json()["rule_count"] == 1
    )
    removed = client.delete(
        f"/api/factories/f1/categories/{category['id']}", headers=MEMBER
    )
    assert removed.status_code == 200 and removed.json()["rules_removed"] == 1
    assert (
        client.delete("/api/factories/f1/categories/fc2", headers=MEMBER).status_code
        == 200
    )
    assert (
        client.delete("/api/factories/f1/categories/fc1", headers=MEMBER).status_code
        == 409
    )  # the last one stays


# ── Rules ────────────────────────────────────────────────────────────────────


def test_rules_are_official_only_through_the_approve_level(client):
    assert (
        client.post("/api/factories/f1/rules/fr1:approve", headers=MEMBER).status_code
        == 403
    )
    approved = client.post("/api/factories/f1/rules/fr1:approve", headers=MGR)
    assert approved.status_code == 200, approved.text
    assert approved.json()["official"] and approved.json()["approved_by"]["id"] == "mgr"
    assert approved.json()["approved_at"]
    # Official rules lead the list; the filters and the group totals work.
    created = client.post(
        "/api/factories/f1/rules",
        json={
            "category_id": "fc2",
            "group_value": "billing",
            "title": "Prices in SAR",
            "description": "Every amount is in SAR.",
        },
        headers=MEMBER,
    )
    assert created.status_code == 201
    body = _rules(client)
    assert [r["id"] for r in body["rules"]][0] == "fr1" and body["total"] == 2
    assert body["groups"] == [
        {"value": "billing", "count": 1, "official": 0},
        {"value": "", "count": 1, "official": 1},
    ]
    assert [r["title"] for r in _rules(client, status="proposed")["rules"]] == [
        "Prices in SAR"
    ]
    assert _rules(client, group="")["total"] == 1
    assert _rules(client, category_id="fc2")["total"] == 1
    assert _rules(client, q="sar")["total"] == 1
    # A member's edit of an official rule takes the official status away; a manager's keeps it.
    edited = client.patch(
        "/api/factories/f1/rules/fr1",
        json={"description": "At most one sentence."},
        headers=MEMBER,
    )
    assert (
        edited.status_code == 200
        and not edited.json()["official"]
        and edited.json()["approved_by"] is None
    )
    assert client.post("/api/factories/f1/rules/fr1:approve", headers=MGR).json()[
        "official"
    ]
    assert client.patch(
        "/api/factories/f1/rules/fr1", json={"title": "One sentence"}, headers=MGR
    ).json()["official"]
    # An official rule is deleted only with the approve level; revoke takes it back.
    assert (
        client.delete("/api/factories/f1/rules/fr1", headers=MEMBER).status_code == 403
    )
    assert not client.post("/api/factories/f1/rules/fr1:revoke", headers=MGR).json()[
        "official"
    ]
    assert (
        client.delete("/api/factories/f1/rules/fr1", headers=MEMBER).status_code == 200
    )
    assert (
        client.delete("/api/factories/f1/rules/fr1", headers=MEMBER).status_code == 404
    )
    # Moving a rule to a category with a schema checks its body.
    schema = {"type": "object", "required": ["n"]}
    cat = client.post(
        "/api/factories/f1/categories",
        json={"name": "Numbers", "json_schema": schema},
        headers=MEMBER,
    ).json()
    rule_id = created.json()["id"]
    assert (
        client.patch(
            f"/api/factories/f1/rules/{rule_id}",
            json={"category_id": cat["id"]},
            headers=MEMBER,
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/factories/f1/rules/{rule_id}",
            json={"category_id": cat["id"], "body": {"n": 1}},
            headers=MEMBER,
        ).status_code
        == 200
    )


# ── Jobs ─────────────────────────────────────────────────────────────────────


def test_starting_a_job_checks_the_model_the_version_and_the_single_active_job(
    client, session_factory
):
    # fj1 is queued: a second job is refused until it ends.
    refused = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert refused.status_code == 409
    assert (
        "no api key" in refused.json()["detail"].lower()
    )  # llm1 has no key: checked first
    with session_factory() as db:
        job = db.get(FactoryJob, "fj1")
        job.status = "succeeded"
        db.commit()
    assert (
        client.post(
            "/api/factories/f1/jobs",
            json={"kind": "generation", "params": {"max_layers": 9}},
            headers=MEMBER,
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/factories/f1/jobs",
            json={"kind": "generation", "params": {"branching": "3"}},
            headers=MEMBER,
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/factories/f1/jobs", json={"kind": "other"}, headers=MEMBER
        ).status_code
        == 422
    )
    jobs = client.get("/api/factories/f1/jobs", headers=MEMBER).json()["jobs"]
    assert [j["id"] for j in jobs] == ["fj1"] and jobs[0]["status"] == "succeeded"
    assert client.get("/api/factories/f1/jobs/fj1", headers=MEMBER).json()["log"] == ""
    assert (
        client.post("/api/factories/f1/jobs/fj1:cancel", headers=MEMBER).status_code
        == 409
    )


def test_analysis_extracts_rules_per_group_and_drops_duplicates_in_any_wording(
    client, session_factory, fake_llm
):
    _seed_items(
        session_factory,
        [
            ("i1", "billing", "How do I pay?", "By card, in SAR."),
            ("i2", "billing", "Refund?", "Within 14 days."),
            ("i3", "shipping", "When?", "Two days."),
            ("i4", "", "Hi", "Hello"),
        ],
    )
    client.patch(
        "/api/factories/f1", json={"group_metadata_key": "topic"}, headers=MEMBER
    )
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()

    def script(system, user):
        if system.startswith("You deduplicate"):
            # Billing: "Prices in riyals" says what "Amounts in SAR" says.
            if '"Prices in riyals"' in user:
                return {"duplicates": [{"candidate": "c1", "of": "c0"}]}
            return {"duplicates": []}
        assert "business" in system.lower() and "Rule categories" in user
        if "'topic' is 'billing'" in user:
            return {
                "rules": [
                    {
                        "title": "Amounts in SAR",
                        "description": "Every amount is in SAR.",
                        "categories": ["general", "format"],
                        "body": None,
                        "evidence": ["i1", "zzz"],
                    },
                    {
                        "title": "Prices in riyals",
                        "description": "Prices are given in Saudi riyals.",
                        "categories": ["general"],
                    },
                    {
                        "title": "  amounts in sar ",
                        "description": "dup by title",
                        "categories": ["general"],
                    },
                    {"title": "", "description": "no title"},
                    {
                        "title": "One sentence answers",
                        "description": "Answers are one sentence.",
                        "same_as": "fr1",
                    },
                    {
                        "title": "Offer delivery",
                        "description": "A payment answer offers the delivery options.",
                        "categories": ["general"],
                        "kind": "bridge",
                        "bridge_to": ["format"],
                        "evidence": ["i1"],
                    },
                    {
                        "title": "Mention the receipt",
                        "description": "The answer says a receipt is sent.",
                        "categories": ["nope"],
                        "kind": "bridge",
                        "bridge_to": ["nope"],
                    },
                ]
            }
        if "'topic' is 'shipping'" in user:
            return {
                "rules": [
                    {
                        "title": "Delivery in two days",
                        "description": "Standard delivery takes two days.",
                        "categories": ["format"],
                    }
                ]
            }
        return {
            "rules": [
                {
                    "title": "Greet back",
                    "description": "A greeting is answered with a greeting.",
                }
            ]
        }

    calls = fake_llm(script)
    started = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert started.status_code == 202, started.text
    job_id = started.json()["id"]
    assert started.json()["status"] == "queued"
    assert _run_jobs(session_factory) == ["succeeded"]
    # One extraction call per group (one batch each) and one consolidation call per group.
    extractions = [c for c in calls if not c["system"].startswith("You deduplicate")]
    consolidations = [c for c in calls if c["system"].startswith("You deduplicate")]
    assert len(extractions) == 3 and len(consolidations) == 3
    # Every call lists both categories and the global fixture rule fr1 with its id.
    assert all(
        '"key": "format"' in c["user"] and '"id": "fr1"' in c["user"]
        for c in extractions
    )
    assert all(
        "Existing rules: " in c["user"] and '"id": "fr1"' in c["user"]
        for c in consolidations
    )
    job = client.get(f"/api/factories/f1/jobs/{job_id}", headers=MEMBER).json()
    assert job["status"] == "succeeded"
    # Billing keeps 3 of 7 (same_as, a title duplicate and a reworded duplicate go), shipping 1, ungrouped 1.
    assert job["progress"]["rules_added"] == 5 and job["progress"]["rules_skipped"] == 3
    assert job["progress"]["done"] == 6 and job["progress"]["total"] == 6
    assert (
        "5 rule(s) added" in job["log"]
        and "1 reworded duplicate(s) dropped" in job["log"]
    )
    rules = _rules(client)["rules"]
    by_title = {r["title"]: r for r in rules if r["id"] != "fr1"}
    assert set(by_title) == {
        "Amounts in SAR",
        "Offer delivery",
        "Mention the receipt",
        "Delivery in two days",
        "Greet back",
    }
    sar = by_title["Amounts in SAR"]
    assert sar["group_value"] == "billing" and sar["category_id"] == "fc1"
    assert [c["key"] for c in sar["categories"]] == ["general", "format"]
    assert sar["kind"] == "rule" and sar["bridge_to"] == []
    assert sar["evidence"] == ["i1"]  # unknown item ids are dropped
    bridge = by_title["Offer delivery"]
    assert bridge["kind"] == "bridge" and [c["key"] for c in bridge["bridge_to"]] == [
        "format"
    ]
    # A bridge without a known target is a plain rule in the first category.
    assert by_title["Mention the receipt"]["kind"] == "rule"
    assert [c["key"] for c in by_title["Mention the receipt"]["categories"]] == [
        "general"
    ]
    assert by_title["Greet back"]["group_value"] == ""
    assert by_title["Greet back"]["category_id"] == "fc1"
    assert all(
        not r["official"] and r["source"] == "agent" and r["job_id"] == job_id
        for r in by_title.values()
    )
    # The category filter finds a rule by any of its categories; the kind filter finds bridges.
    assert {r["title"] for r in _rules(client, category_id="fc2")["rules"]} == {
        "Amounts in SAR",
        "Delivery in two days",
    }
    assert [r["title"] for r in _rules(client, kind="bridge")["rules"]] == [
        "Offer delivery"
    ]
    counts = {c["key"]: c["rule_count"] for c in _detail(client)["categories"]}
    assert counts == {"general": 5, "format": 2}
    assert _detail(client)["last_analyzed_at"]
    # A second analysis sees the new rules, proposes nothing and needs no consolidation.
    calls.clear()
    assert (
        client.post(
            "/api/factories/f1/jobs",
            json={"kind": "analysis", "params": {"group_values": ["billing"]}},
            headers=MEMBER,
        ).status_code
        == 202
    )
    fake_llm(lambda system, user: {"rules": []})
    assert _run_jobs(session_factory) == ["succeeded"]
    assert len(calls) == 1 and '"title": "Amounts in SAR"' in calls[0]["user"]
    assert _rules(client)["total"] == 6


def test_rule_categories_and_bridge_targets_are_checked(client):
    added = client.post(
        "/api/factories/f1/categories",
        json={"key": "joins", "name": "Joins", "description": "How tables combine."},
        headers=MEMBER,
    )
    assert added.status_code == 201, added.text
    joins = added.json()["id"]
    base = {"category_id": "fc1", "title": "Join customers", "description": "x"}
    # A bridge needs a target outside its own categories; unknown categories are refused.
    assert (
        client.post(
            "/api/factories/f1/rules", json={**base, "kind": "bridge"}, headers=MEMBER
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/factories/f1/rules",
            json={**base, "kind": "bridge", "bridge_to_category_ids": ["fc1"]},
            headers=MEMBER,
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/factories/f1/rules",
            json={**base, "category_ids": ["nope"]},
            headers=MEMBER,
        ).status_code
        == 422
    )
    created = client.post(
        "/api/factories/f1/rules",
        json={
            **base,
            "category_ids": ["fc1", "fc2", "fc2"],
            "kind": "bridge",
            "bridge_to_category_ids": [joins, "fc2", joins],
        },
        headers=MEMBER,
    )
    assert created.status_code == 201, created.text
    rule = created.json()
    assert [c["id"] for c in rule["categories"]] == ["fc1", "fc2"]
    assert rule["kind"] == "bridge" and [c["id"] for c in rule["bridge_to"]] == [joins]
    # Edits keep the links unless given; turning the kind back to "rule" drops the targets.
    patched = client.patch(
        f"/api/factories/f1/rules/{rule['id']}",
        json={"title": "Join the customers table"},
        headers=MEMBER,
    )
    assert patched.status_code == 200 and [
        c["id"] for c in patched.json()["bridge_to"]
    ] == [joins]
    patched = client.patch(
        f"/api/factories/f1/rules/{rule['id']}", json={"kind": "rule"}, headers=MEMBER
    )
    assert patched.status_code == 200
    assert patched.json()["kind"] == "rule" and patched.json()["bridge_to"] == []
    assert [c["id"] for c in patched.json()["categories"]] == ["fc1", "fc2"]
    patched = client.patch(
        f"/api/factories/f1/rules/{rule['id']}",
        json={"kind": "bridge", "bridge_to_category_ids": [joins], "category_ids": []},
        headers=MEMBER,
    )
    assert patched.status_code == 200
    assert [c["id"] for c in patched.json()["categories"]] == ["fc1"]
    assert [c["id"] for c in patched.json()["bridge_to"]] == [joins]
    # Removing the target category turns the bridge into a plain rule.
    assert (
        client.delete(
            f"/api/factories/f1/categories/{joins}", headers=MEMBER
        ).status_code
        == 200
    )
    listed = {r["id"]: r for r in _rules(client)["rules"]}
    assert (
        listed[rule["id"]]["kind"] == "rule" and listed[rule["id"]]["bridge_to"] == []
    )


def test_bridge_rules_open_other_categories_in_generation(
    client, session_factory, fake_llm
):
    _seed_items(
        session_factory,
        [("q1", "", "SELECT name FROM customers", "SELECT name FROM customers;")],
    )
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.delete(db.get(FactoryRule, "fr1"))
        db.commit()
    for title, category, kind, bridge in (
        ("Filter by date", "fc1", "rule", []),
        ("Format as table", "fc2", "rule", []),
        ("Join orders", "fc1", "bridge", ["fc2"]),
    ):
        created = client.post(
            "/api/factories/f1/rules",
            json={
                "category_id": category,
                "title": title,
                "description": f"{title} rule",
                "kind": kind,
                "bridge_to_category_ids": bridge,
            },
            headers=MEMBER,
        )
        assert created.status_code == 201, created.text
        assert (
            client.post(
                f"/api/factories/f1/rules/{created.json()['id']}:approve", headers=MGR
            ).status_code
            == 200
        )

    def script(system, user):
        assert "When the new rule is a bridge" in system
        rule = user.split("New rule to apply")[1]
        if '"Join orders"' in rule:
            assert "a bridge into: Format" in rule
        return {"input": "SELECT ...", "expected_output": "SELECT ...;", "note": "n"}

    fake_llm(script)
    started = client.post(
        "/api/factories/f1/jobs",
        json={
            "kind": "generation",
            "params": {"max_layers": 3, "branching": 5, "max_items": 50},
        },
        headers=MEMBER,
    )
    assert started.status_code == 202, started.text
    assert _run_jobs(session_factory) == ["succeeded"]
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    # Layer 1: the three rules. Layer 2: General stays General unless the bridge opened Format:
    # Filter -> Join; Join -> Filter, Join -> Format; Format -> nothing. Layer 3: the third rule each.
    assert job["status"] == "succeeded" and job["progress"]["generated"] == 9
    with session_factory() as db:
        version = (
            db.query(DatasetVersion)
            .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
            .filter(Dataset.slug == "faq-gen-1")
            .one()
        )
        items = (
            db.query(DatasetItem)
            .filter(DatasetItem.dataset_version_id == version.id)
            .all()
        )
    by_layer = {}
    for item in items:
        meta = item.item_metadata["factory"]
        by_layer.setdefault(meta["layer"], []).append(meta)
    assert {n: len(v) for n, v in by_layer.items()} == {1: 3, 2: 3, 3: 3}
    assert {tuple(m["rule_titles"]) for m in by_layer[2]} == {
        ("Filter by date", "Join orders"),
        ("Join orders", "Filter by date"),
        ("Join orders", "Format as table"),
    }
    assert all(m["bridges"] == ["Join orders"] for m in by_layer[2])
    assert all(m["categories"] == ["format", "general"] for m in by_layer[2])
    only_format = next(
        m for m in by_layer[1] if m["rule_titles"] == ["Format as table"]
    )
    assert only_format["categories"] == ["format"] and only_format["bridges"] == []
    assert all(len(m["rule_titles"]) == 3 for m in by_layer[3])


def test_analysis_without_items_fails_with_a_plain_reason(
    client, session_factory, fake_llm
):
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()
    fake_llm(lambda system, user: {"rules": []})
    started = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert started.status_code == 202
    assert _run_jobs(session_factory) == ["failed"]
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    assert job["status"] == "failed" and "no active items" in job["error"]


def test_generation_branches_items_into_a_new_dataset(
    client, session_factory, fake_llm
):
    _seed_items(
        session_factory,
        [
            ("i1", "billing", "How do I pay?", "By card."),
            ("i2", "shipping", "When?", "Two days."),
            ("i3", "", "Hi", "Hello"),
        ],
    )
    client.patch(
        "/api/factories/f1", json={"group_metadata_key": "topic"}, headers=MEMBER
    )
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()
    # Rules: two billing (one official), one global official, one shipping non-official.
    for title, group, official in (
        ("SAR", "billing", True),
        ("Refund", "billing", False),
        ("Polite", "", True),
        ("Fast", "shipping", False),
    ):
        created = client.post(
            "/api/factories/f1/rules",
            json={
                "category_id": "fc1",
                "group_value": group,
                "title": title,
                "description": f"{title} rule",
            },
            headers=MEMBER,
        )
        assert created.status_code == 201
        if official:
            assert (
                client.post(
                    f"/api/factories/f1/rules/{created.json()['id']}:approve",
                    headers=MGR,
                ).status_code
                == 200
            )
    # fr1 (global, non-official) stays out with official_only.

    def script(system, user):
        assert "one business rule" in system
        rule = user.split("New rule to apply")[1]
        name = "SAR" if '"SAR"' in rule else "Polite" if '"Polite"' in rule else "?"
        return {
            "input": {"question": f"[{name}] q"},
            "expected_output": f"[{name}] a",
            "note": f"applied {name}",
        }

    calls = fake_llm(script)
    started = client.post(
        "/api/factories/f1/jobs",
        json={
            "kind": "generation",
            "params": {
                "max_layers": 2,
                "branching": 5,
                "max_items": 50,
                "dataset_name": "Faq variations",
            },
        },
        headers=MEMBER,
    )
    assert started.status_code == 202, started.text
    assert started.json()["params"] == {
        "max_layers": 2,
        "branching": 5,
        "max_items": 50,
        "official_only": True,
        "group_values": None,
        "dataset_name": "Faq variations",
    }
    assert _run_jobs(session_factory) == ["succeeded"]
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    assert job["status"] == "succeeded", job
    assert (
        job["output_dataset"]["name"] == "Faq variations"
        and job["output_dataset"]["slug"] == "faq-gen-1"
    )
    # Layer 1: i1 gets SAR and Polite (2), i2 gets Polite (1), i3 gets Polite (1) = 4.
    # Layer 2: i1's two children each get the other rule (2); i2's and i3's have no rule left = 2.
    assert job["progress"]["generated"] == 6 and job["progress"]["layer"] == 2
    assert len(calls) == 6
    with session_factory() as db:
        output = db.query(Dataset).filter(Dataset.slug == "faq-gen-1").one()
        assert output.tags == ["factory"] and output.created_by_user_id == "member"
        version = (
            db.query(DatasetVersion)
            .filter(DatasetVersion.dataset_id == output.id)
            .one()
        )
        assert (
            version.version == "v1"
            and version.status.value == "draft"
            and version.item_count == 6
        )
        assert version.source_type == "factory"
        items = (
            db.query(DatasetItem)
            .filter(DatasetItem.dataset_version_id == version.id)
            .order_by(DatasetItem.index)
            .all()
        )
        ids = [item.item_id for item in items]
        assert len(ids) == 6 and len(set(ids)) == 6
        layer1 = [item for item in items if item.item_metadata["factory"]["layer"] == 1]
        layer2 = [item for item in items if item.item_metadata["factory"]["layer"] == 2]
        assert len(layer1) == 4 and len(layer2) == 2
        assert all(item.item_metadata["topic"] == "billing" for item in layer2)
        assert all(
            len(item.item_metadata["factory"]["rule_titles"]) == 2 for item in layer2
        )
        assert {
            tuple(sorted(item.item_metadata["factory"]["rule_titles"]))
            for item in layer2
        } == {("Polite", "SAR")}
        child = layer2[0]
        assert child.item_metadata["factory"]["base_item_id"] == "i1"
        assert child.item_metadata["factory"]["parent_item_id"] in ids
        assert child.input == {"question": "[SAR] q"} or child.input == {
            "question": "[Polite] q"
        }
        assert child.item_metadata["factory"]["job_id"] == job["id"]
        assert items[0].search_text  # the search index text is written with the item
    # The dataset shows in the catalog with the generated items visible to the member.
    listed = client.get("/v1/datasets", params={"project_slug": "pa"}, headers=MEMBER)
    assert listed.status_code == 200
    assert any(d["slug"] == "faq-gen-1" for d in listed.json()["datasets"])
    # A second run gets the next slug.
    calls.clear()
    assert (
        client.post(
            "/api/factories/f1/jobs",
            json={
                "kind": "generation",
                "params": {"max_layers": 1, "branching": 1, "max_items": 2},
            },
            headers=MEMBER,
        ).status_code
        == 202
    )
    assert _run_jobs(session_factory) == ["succeeded"]
    jobs = client.get("/api/factories/f1/jobs", headers=MEMBER).json()["jobs"]
    assert (
        jobs[0]["output_dataset"]["slug"] == "faq-gen-2"
        and jobs[0]["progress"]["generated"] == 2
    )


def test_generation_refuses_without_an_applicable_rule_and_one_failed_call_is_skipped(
    client, session_factory, fake_llm
):
    _seed_items(session_factory, [("i1", "", "Hi", "Hello")])
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()
    refused = client.post(
        "/api/factories/f1/jobs", json={"kind": "generation"}, headers=MEMBER
    )
    assert refused.status_code == 409 and "approve" in refused.json()["detail"].lower()
    state = {"n": 0}

    def script(system, user):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("boom")
        return {"input": "new", "expected_output": "out"}

    fake_llm(script)
    # Non-official rules allowed: fr1 applies; the first call fails, the job still succeeds with 0 items...
    started = client.post(
        "/api/factories/f1/jobs",
        json={
            "kind": "generation",
            "params": {"official_only": False, "max_layers": 1, "branching": 3},
        },
        headers=MEMBER,
    )
    assert started.status_code == 202, started.text
    assert _run_jobs(session_factory) == ["succeeded"]
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    assert job["progress"]["generated"] == 0 and job["progress"]["failed_calls"] == 1
    assert "model call failed" in job["log"]
    assert job["output_dataset"]["slug"] == "faq-gen-1"


def test_a_running_job_stops_at_the_next_batch_when_cancelled(
    client, session_factory, fake_llm
):
    _seed_items(session_factory, [(f"i{n}", "", f"q{n}", f"a{n}") for n in range(6)])
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()

    def script(system, user):
        with session_factory() as db:
            running = (
                db.query(FactoryJob).filter(FactoryJob.status == "running").first()
            )
            if running is not None:
                running.status = "cancel_requested"
                db.commit()
        return {"input": "new", "expected_output": "out"}

    fake_llm(script)
    started = client.post(
        "/api/factories/f1/jobs",
        json={
            "kind": "generation",
            "params": {"official_only": False, "max_layers": 3, "branching": 1},
        },
        headers=MEMBER,
    )
    assert started.status_code == 202
    assert _run_jobs(session_factory) == ["cancelled"]
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    assert job["status"] == "cancelled" and job["finished_at"]
    assert 0 < job["progress"]["generated"] <= 6
    assert "Cancelled" in job["log"]
    with session_factory() as db:
        version = (
            db.query(DatasetVersion)
            .join(Dataset)
            .filter(Dataset.slug == "faq-gen-1")
            .one()
        )
        assert (
            version.item_count == job["progress"]["generated"]
        )  # items written before the stop stay
    # A queued job cancels at once; the factory can start another.
    queued = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert queued.status_code == 202
    cancelled = client.post(
        f"/api/factories/f1/jobs/{queued.json()['id']}:cancel", headers=MEMBER
    )
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert _run_jobs(session_factory) == []


def test_the_heartbeat_renews_the_lease_and_a_cancel_interrupts_a_call_in_flight(
    client, session_factory, fake_llm, monkeypatch
):
    monkeypatch.setattr(svc, "HEARTBEAT_SECONDS", 0.05)
    _seed_items(session_factory, [("i1", "", "Hi", "Hello")])
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()
    started = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert started.status_code == 202, started.text
    job_id = started.json()["id"]
    seen = {}

    async def script(system, user):
        with session_factory() as db:
            seen["lease_at_start"] = db.get(FactoryJob, job_id).lease_until
        await asyncio.sleep(0.25)
        with session_factory() as db:
            job = db.get(FactoryJob, job_id)
            seen["lease_later"] = job.lease_until
            job.status = "cancel_requested"
            db.commit()
        # The heartbeat sees the request and cancels this task long before it returns.
        await asyncio.sleep(10)
        return {"rules": []}

    fake_llm(script)
    assert _run_jobs(session_factory) == ["cancelled"]
    assert seen["lease_later"] > seen["lease_at_start"]
    job = client.get(f"/api/factories/f1/jobs/{job_id}", headers=MEMBER).json()
    assert job["status"] == "cancelled" and "Cancelled" in job["log"]
    assert "answered" not in job["log"]


def test_the_model_client_gets_the_timeout_and_one_retry(monkeypatch):
    import openai

    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    monkeypatch.setattr(svc, "resolve_llm_api_key", lambda row, settings: "k")
    monkeypatch.setattr(svc, "validate_llm_base_url", lambda url, allow_private: url)
    monkeypatch.setattr(svc, "create_llm_http_client", lambda allow_private: None)
    monkeypatch.setenv("QYM_FACTORY_LLM_TIMEOUT_SECONDS", "45")
    conn = SimpleNamespace(
        llm_api_key_encrypted="x", llm_base_url="https://m.example/v1", llm_model="m1"
    )
    client_obj, model = svc.build_client(conn)
    assert isinstance(client_obj, FakeClient) and model == "m1"
    assert captured["timeout"] == 45.0 and captured["max_retries"] == 1


def test_the_analysis_batch_size_is_a_setting_and_every_call_is_logged(
    client, session_factory, fake_llm, monkeypatch
):
    monkeypatch.setenv("QYM_FACTORY_ANALYSIS_BATCH_ITEMS", "5")
    _seed_items(session_factory, [(f"i{n}", "", f"q{n}", f"a{n}") for n in range(7)])
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()
    calls = fake_llm(lambda system, user: {"rules": []})
    started = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert started.status_code == 202, started.text
    assert _run_jobs(session_factory) == ["succeeded"]
    # 7 items in batches of 5: two extraction calls; nothing proposed, so no consolidation call.
    assert len(calls) == 2
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    assert job["progress"]["total"] == 3 and job["progress"]["done"] == 3
    assert "ungrouped: call 2 of 2 answered" in job["log"]


def test_an_expired_lease_is_taken_over(session_factory):
    from datetime import datetime, timedelta

    with session_factory() as db:
        job = db.get(FactoryJob, "fj1")
        job.status = "running"
        job.lease_owner = "dead-host:1"
        job.lease_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    with session_factory() as db:
        claimed = svc.claim_job(db, "me:2")
        assert (
            claimed is not None
            and claimed.id == "fj1"
            and claimed.lease_owner == "me:2"
        )
    with session_factory() as db:
        assert svc.claim_job(db, "me:3") is None  # the fresh lease holds


def test_list_valued_group_key_files_items_in_every_group_and_prompts_carry_examples(
    client, session_factory, fake_llm
):
    """A key holding a list (the tables a query reads) puts an item in each group it lists: the
    analysis reads it in every one of them and generation offers the rules of all of them. A
    generation prompt shows the source items a rule's evidence names, the item itself left out."""
    _seed_items(
        session_factory,
        [
            ("i1", {"tables": ["orders", "customers"]}, "Orders per customer?", "JOIN"),
            ("i2", {"tables": ["orders"]}, "Orders today?", "WHERE day"),
            ("i3", {}, "Hi", "Hello"),
        ],
    )
    client.patch(
        "/api/factories/f1", json={"group_metadata_key": "tables"}, headers=MEMBER
    )
    keys = {k["key"]: k for k in _detail(client)["metadata_keys"]}
    assert keys["tables"]["kind"] == "list" and sorted(keys["tables"]["values"]) == [
        "customers",
        "orders",
    ]
    with session_factory() as db:
        db.get(FactoryJob, "fj1").status = "cancelled"
        db.commit()

    def analysis(system, user):
        if system.startswith("You deduplicate"):
            return {"duplicates": []}
        for group in ("orders", "customers"):
            if f"'tables' is '{group}' (or lists it)" in user:
                return {
                    "rules": [
                        {
                            "title": f"Rule of {group}",
                            "description": f"About {group}.",
                            "categories": ["general"],
                            "evidence": ["i1", "i2"],
                        }
                    ]
                }
        return {"rules": []}

    calls = fake_llm(analysis)
    started = client.post(
        "/api/factories/f1/jobs", json={"kind": "analysis"}, headers=MEMBER
    )
    assert started.status_code == 202, started.text
    assert _run_jobs(session_factory) == ["succeeded"]
    extractions = [c for c in calls if not c["system"].startswith("You deduplicate")]
    by_group = {}
    for call in extractions:
        group = call["user"].split("Group: ")[1].split("\n")[0]
        by_group[group] = call["user"]
    # Three groups: customers (i1), orders (i1 and i2), ungrouped (i3); i1 is read in two of them.
    assert len(by_group) == 3
    customers = next(v for k, v in by_group.items() if "'customers'" in k)
    orders = next(v for k, v in by_group.items() if "'orders'" in k)
    ungrouped = next(v for k, v in by_group.items() if "ungrouped" in k)
    assert '"item_id": "i1"' in customers and '"item_id": "i2"' not in customers
    assert '"item_id": "i1"' in orders and '"item_id": "i2"' in orders
    assert '"item_id": "i3"' in ungrouped and '"item_id": "i1"' not in ungrouped
    rules = {r["title"]: r for r in _rules(client)["rules"]}
    assert rules["Rule of orders"]["group_value"] == "orders"
    assert rules["Rule of customers"]["group_value"] == "customers"
    # Only i1 lists customers, so the customers rule keeps i1 alone as evidence of its group's items.
    assert rules["Rule of customers"]["evidence"] == ["i1"]
    assert rules["Rule of orders"]["evidence"] == ["i1", "i2"]
    # Approve both and add a global rule with no evidence; then generate one layer.
    for title in ("Rule of orders", "Rule of customers"):
        assert (
            client.post(
                f"/api/factories/f1/rules/{rules[title]['id']}:approve", headers=MGR
            ).status_code
            == 200
        )
    created = client.post(
        "/api/factories/f1/rules",
        json={"category_id": "fc1", "title": "Global", "description": "Everywhere."},
        headers=MEMBER,
    )
    assert created.status_code == 201
    assert (
        client.post(
            f"/api/factories/f1/rules/{created.json()['id']}:approve", headers=MGR
        ).status_code
        == 200
    )

    def generation(system, user):
        assert "apply the rule the way they do" in system
        return {"input": {"question": "q"}, "expected_output": "a", "note": "n"}

    # The fake keeps every prompt of the test: the generation calls are the ones after the analysis.
    calls = fake_llm(generation)
    before = len(calls)
    started = client.post(
        "/api/factories/f1/jobs",
        json={
            "kind": "generation",
            "params": {"max_layers": 1, "branching": 5, "max_items": 50},
        },
        headers=MEMBER,
    )
    assert started.status_code == 202, started.text
    assert _run_jobs(session_factory) == ["succeeded"]
    job = client.get(
        f"/api/factories/f1/jobs/{started.json()['id']}", headers=MEMBER
    ).json()
    calls = calls[before:]
    # i1 takes the orders, customers and global rules (3); i2 orders and global (2); i3 global (1).
    assert job["progress"]["generated"] == 6 and len(calls) == 6

    def prompt(base: str, title: str) -> str:
        return next(
            c["user"]
            for c in calls
            if f'"question": "{base}"' in c["user"].split("Base item expected")[0]
            and f'"title": "{title}"' in c["user"].split("New rule to apply")[1]
        )

    examples = "Items of the dataset that already follow the new rule"
    # i2 + orders: the example is i1 (i2 itself is left out). i1 + orders: the example is i2.
    tail = prompt("Orders today?", "Rule of orders").split(examples)[1]
    assert "Orders per customer?" in tail and "Orders today?" not in tail
    tail = prompt("Orders per customer?", "Rule of orders").split(examples)[1]
    assert "Orders today?" in tail and "Orders per customer?" not in tail
    # i2 + customers never happens (i2 is not in that group); i1 + customers has no other evidence.
    assert examples not in prompt("Orders per customer?", "Rule of customers")
    assert not any(
        '"title": "Rule of customers"' in c["user"].split("New rule to apply")[1]
        and '"question": "Orders today?"' in c["user"].split("Base item expected")[0]
        for c in calls
    )
    # The global rule has no evidence: no examples section.
    assert examples not in prompt("Hi", "Global")
    # group_values restricts the base items to the ones listing a wanted group.
    calls = fake_llm(generation)
    before = len(calls)
    started = client.post(
        "/api/factories/f1/jobs",
        json={
            "kind": "generation",
            "params": {"max_layers": 1, "branching": 5, "group_values": ["customers"]},
        },
        headers=MEMBER,
    )
    assert started.status_code == 202, started.text
    assert _run_jobs(session_factory) == ["succeeded"]
    calls = calls[before:]
    assert len(calls) == 3 and all(
        '"question": "Orders per customer?"' in c["user"] for c in calls
    )


def test_params_and_group_helpers():
    assert svc.validate_params("generation", None) == {
        "max_layers": 1,
        "branching": 3,
        "max_items": 500,
        "official_only": True,
        "group_values": None,
        "dataset_name": None,
    }
    with pytest.raises(ValueError):
        svc.validate_params("generation", {"max_items": 0})
    with pytest.raises(ValueError):
        svc.validate_params("analysis", {"sample_per_group": True})
    with pytest.raises(ValueError):
        svc.validate_params("nope", {})
    assert svc.group_value_of({"a": {"b": 3}}, "a.b") == "3"
    assert svc.group_value_of({"a": True}, "a") == "true"
    assert svc.group_value_of({"a": [1]}, "a") == "1"
    assert svc.group_value_of({"a": " x "}, "a") == "x"
    assert svc.group_value_of({"a": 1}, None) == ""
    assert svc.group_value_of("not a dict", "a") == ""
    # A list at the key: one group per distinct scalar, in order; nothing usable is ungrouped.
    assert svc.group_values_of({"t": ["orders", " customers ", "orders", 7]}, "t") == [
        "orders",
        "customers",
        "7",
    ]
    assert svc.group_values_of({"t": []}, "t") == [""]
    assert svc.group_values_of({"t": [None, {"a": 1}, [2]]}, "t") == [""]
    assert svc.group_values_of({"t": {"a": 1}}, "t") == [""]
    assert svc.group_values_of({"t": "x"}, None) == [""]
    assert svc.slugify_key("  Field Constraints! ") == "field-constraints"
    assert svc.check_json_schema({"type": "object"}) is None
    assert svc.check_json_schema({"type": 3}) is not None
    assert svc.body_problem(None, None) is None
    assert svc.body_problem([1], None) is not None


def test_migration_0105_matches_the_models_and_downgrades(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from alembic.autogenerate import compare_metadata

    migration = _load_migration("0105_data_factory.py")
    engine = sa.create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[t for t in Base.metadata.sorted_tables if t.name not in FACTORY_TABLES],
    )
    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert FACTORY_TABLES <= set(inspector.get_table_names())
        assert {
            fk["referred_table"]: fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("data_factories")
        } == {
            "projects": None,
            "datasets": "CASCADE",
            "project_llm_connections": "SET NULL",
            "users": None,
        }
        assert {
            fk["referred_table"]: fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("factory_rules")
        } == {
            "data_factories": "CASCADE",
            "factory_rule_categories": "CASCADE",
            "users": "SET NULL",
        }
        assert {
            fk["referred_table"]: fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("factory_rule_links")
        } == {"factory_rules": "CASCADE", "factory_rule_categories": "CASCADE"}

        def only_factory(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
            table = obj if kind == "table" else getattr(obj, "table", None)
            return getattr(table, "name", name) in FACTORY_TABLES

        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": only_factory}
        )
        diffs = compare_metadata(context, Base.metadata)
        assert diffs == [], diffs
        migration.downgrade()
        assert not (FACTORY_TABLES & set(sa.inspect(connection).get_table_names()))
    engine.dispose()
