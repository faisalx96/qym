"""Disabled dataset items: state on reads, enable and disable routes, revisions, hashes, compare (WP-A, A2-49 to A2-66)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event

from _dataset_access_env import ADMIN, MEM, MEM2, MGR, dataset_world, upload
from qym_platform.db.models import AuditLog, Dataset, DatasetItem, DatasetItemRevision, DatasetVersion

PARAMS = {"project_slug": "pa"}
ROWS = [(f"i{n}", f"question {n}", f"answer {n}", "t") for n in range(1, 7)]
ITEMS = "/v1/datasets/qa/versions/{v}/items"


@pytest.fixture()
def world(monkeypatch):
    with dataset_world(monkeypatch) as env:
        yield env


def _published(client, headers=MGR, name="qa", rows=ROWS):
    response = upload(client, headers, name, rows, publish="true")
    assert response.status_code == 200, response.text


def _draft(client, headers=MGR, version="v2", from_version="v1", name="qa"):
    response = client.post(
        f"/v1/datasets/{name}/versions", params=PARAMS, headers=headers, json={"version": version, "from_version": from_version}
    )
    assert response.status_code == 200, response.text
    return response.json()["version"]


def _disable(client, item, version="v2", headers=MGR, reason=None, ref="qa"):
    body = {} if reason is None else {"reason": reason}
    return client.post(f"/v1/datasets/{ref}/versions/{version}/items/{item}:disable", params=PARAMS, headers=headers, json=body)


def _enable(client, item, version="v2", headers=MGR, ref="qa"):
    return client.post(f"/v1/datasets/{ref}/versions/{version}/items/{item}:enable", params=PARAMS, headers=headers)


def _list(client, version="v2", headers=MGR, **params):
    return client.get(ITEMS.format(v=version), params={**PARAMS, **params}, headers=headers)


def _ids(response):
    return [item["item_id"] for item in response.json()["items"]]


# --------------------------------------------------------------- reads (A2-49 to A2-53)


def test_reads_default_to_active_and_carry_state(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    assert _disable(client, "i2", reason="bad label").status_code == 200
    assert _disable(client, "i4").status_code == 200
    body = _list(client).json()
    assert [i["item_id"] for i in body["items"]] == ["i1", "i3", "i5", "i6"]
    assert all(i["state"] == "active" and i["disabled"] is None for i in body["items"])
    assert body["total"] == 4
    only_disabled = _list(client, state="disabled")
    assert _ids(only_disabled) == ["i2", "i4"] and only_disabled.json()["total"] == 2
    first = only_disabled.json()["items"][0]
    assert first["state"] == "disabled"
    assert set(first["disabled"]) == {"at", "by", "reason"}
    assert first["disabled"]["reason"] == "bad label"
    assert first["disabled"]["by"]["email"] == "mgr@x.com"
    assert set(first["disabled"]["by"]) == {"id", "email", "display_name"}
    everything = _list(client, state="all")
    assert _ids(everything) == ["i1", "i2", "i3", "i4", "i5", "i6"] and everything.json()["total"] == 6


def test_unknown_state_is_a_422_with_the_exact_text(world):
    client, _, _ = world
    _published(client)
    response = _list(client, version="v1", state="sleeping")
    assert response.status_code == 422 and response.json()["detail"] == "state must be active, disabled or all"


def test_pagination_follows_the_state_filter(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    for item in ("i1", "i2", "i3"):
        _disable(client, item)
    page = _list(client, limit=2).json()
    assert [i["item_id"] for i in page["items"]] == ["i4", "i5"] and page["total"] == 3 and page["next_offset"] == 2
    last = _list(client, limit=2, offset=2).json()
    assert [i["item_id"] for i in last["items"]] == ["i6"] and last["next_offset"] is None


def test_get_item_returns_it_whatever_its_state(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i3", reason="r")
    body = client.get("/v1/datasets/qa/versions/v2/items/i3", params=PARAMS, headers=MGR).json()["item"]
    assert body["state"] == "disabled" and body["disabled"]["reason"] == "r"
    active = client.get("/v1/datasets/qa/versions/v2/items/i1", params=PARAMS, headers=MGR).json()["item"]
    assert active["state"] == "active" and active["disabled"] is None


def test_counts_ignore_state_and_follow_search_label_and_meta(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i2")
    _disable(client, "i3")
    for state in ("active", "disabled", "all"):
        assert _list(client, state=state).json()["counts"] == {"active": 4, "disabled": 2, "all": 6}
    assert _list(client, search="question 2").json()["counts"] == {"active": 0, "disabled": 1, "all": 1}
    assert _list(client, search="question", state="disabled").json()["counts"]["all"] == 6
    assert _list(client, meta="topic:t").json()["counts"] == {"active": 4, "disabled": 2, "all": 6}
    assert _list(client, meta="topic:other").json()["counts"] == {"active": 0, "disabled": 0, "all": 0}


def test_counts_cost_one_grouped_statement(world):
    client, _, engine = world
    _published(client)
    _draft(client)
    statements: list[str] = []

    def capture(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        _list(client, include_context="false")
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    grouped = [s for s in statements if "GROUP BY" in s.upper() and "dataset_items" in s and "disabled_at" in s]
    assert len(grouped) == 1


def test_version_payloads_carry_disabled_count(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1")
    _disable(client, "i2")
    versions = {v["version"]: v for v in client.get("/v1/datasets/qa/versions", params=PARAMS, headers=MGR).json()["versions"]}
    assert versions["v2"]["disabled_count"] == 2 and versions["v2"]["item_count"] == 6
    assert versions["v1"]["disabled_count"] == 0
    detail = client.get("/v1/datasets/qa/versions/v2", params=PARAMS, headers=MGR).json()["version"]
    assert detail["disabled_count"] == 2
    context = _list(client).json()
    assert context["version"]["disabled_count"] == 2
    dataset = client.get("/v1/datasets/qa", params=PARAMS, headers=MGR).json()["dataset"]
    assert dataset["latest_version"]["disabled_count"] == 2


# --------------------------------------------------------------- writes (A2-54 to A2-59, A2-65)


def test_disable_and_enable_responses(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    response = _disable(client, "i1", reason="  noisy  ")
    assert response.status_code == 200
    body = response.json()
    assert body["changed"] is True and body["item"]["state"] == "disabled"
    assert body["item"]["disabled"]["reason"] == "noisy"
    enabled = _enable(client, "i1")
    assert enabled.status_code == 200 and enabled.json()["changed"] is True
    assert enabled.json()["item"]["state"] == "active" and enabled.json()["item"]["disabled"] is None


def test_published_version_refuses_state_changes_with_the_exact_text(world):
    client, _, _ = world
    _published(client)
    for response in (_disable(client, "i1", version="v1"), _enable(client, "i1", version="v1")):
        assert response.status_code == 409 and response.json()["detail"] == "Create a draft to change item state"


def test_reason_limit_and_unknown_item(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    assert _disable(client, "i1", reason="x" * 500).status_code == 200
    too_long = _disable(client, "i2", reason="x" * 501)
    assert too_long.status_code == 422 and too_long.json()["detail"] == "Reason must be 500 characters or fewer"
    missing = _disable(client, "nope")
    assert missing.status_code == 404 and missing.json()["detail"] == "Dataset item not found"
    assert _enable(client, "nope").status_code == 404


def test_toggles_are_idempotent_and_write_nothing_the_second_time(world):
    client, factory, _ = world
    _published(client)
    _draft(client)
    assert _enable(client, "i1").json()["changed"] is False  # already active
    assert _disable(client, "i1").json()["changed"] is True
    again = _disable(client, "i1", reason="other")
    assert again.status_code == 200 and again.json()["changed"] is False
    assert again.json()["item"]["disabled"]["reason"] == ""  # the first call's state stays
    with factory() as db:
        revisions = db.query(DatasetItemRevision).filter(DatasetItemRevision.change_type.in_(["disabled", "enabled"])).count()
        audits = db.query(AuditLog).filter(AuditLog.action.in_(["dataset.item_disabled", "dataset.item_enabled"])).count()
    assert revisions == 1 and audits == 1


def test_revisions_and_audit_record_who_and_why(world):
    client, factory, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1", reason="duplicate")
    _enable(client, "i1")
    history = client.get("/api/datasets/qa/versions/v2/items/i1/revisions", params=PARAMS, headers=MGR).json()
    rows = history["revisions"] if "revisions" in history else history
    kinds = [row["change_type"] for row in rows]
    assert kinds == ["enabled", "disabled"]  # newest first
    disabled = rows[1]
    assert disabled["before"]["disabled"] is False and disabled["after"] == {
        "item_id": "i1", "disabled": True, "reason": "duplicate"
    }
    assert disabled["actor_email"] == "mgr@x.com" and disabled["actor_user_id"] == "mgr"
    with factory() as db:
        actions = [(row.action, row.actor_user_id) for row in db.query(AuditLog).filter(AuditLog.action.like("dataset.item_%")).order_by(AuditLog.id)]
    assert actions == [("dataset.item_disabled", "mgr"), ("dataset.item_enabled", "mgr")]


def test_a_new_draft_copies_the_flag_and_enabling_it_leaves_the_parent_alone(world):
    client, factory, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1", reason="why")
    assert client.post("/v1/datasets/qa/versions/v2:publish", params=PARAMS, headers=MGR, json={}).status_code == 200
    _draft(client, version="v3", from_version="v2")
    copied = _list(client, version="v3", state="disabled").json()["items"]
    assert [i["item_id"] for i in copied] == ["i1"]
    assert copied[0]["disabled"]["reason"] == "why" and copied[0]["disabled"]["by"]["id"] == "mgr"
    assert _enable(client, "i1", version="v3").status_code == 200
    assert _ids(_list(client, version="v2", state="disabled")) == ["i1"]  # parent unchanged
    assert _ids(_list(client, version="v3", state="disabled")) == []


def test_other_item_writes_still_need_a_draft_and_keep_the_flag(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1", reason="r")
    published = client.patch("/v1/datasets/qa/versions/v1/items/i1", params=PARAMS, headers=MGR, json={"input": "z"})
    assert published.status_code == 409 and published.json()["detail"] == "Only draft dataset versions can be edited"
    patched = client.patch("/v1/datasets/qa/versions/v2/items/i1", params=PARAMS, headers=MGR, json={"input": "edited"})
    assert patched.status_code == 200 and patched.json()["item"]["state"] == "disabled"
    bulk = client.post(
        "/v1/datasets/qa/versions/v2/items:bulk",
        params=PARAMS,
        headers=MGR,
        json={"upserts": [{"item_id": "i1", "input": "bulk", "expected_output": "e"}, {"item_id": "new", "input": "n"}]},
    )
    assert bulk.status_code == 200, bulk.text
    states = {i["item_id"]: i["state"] for i in _list(client, state="all").json()["items"]}
    assert states["i1"] == "disabled" and states["new"] == "active"
    # The state is not a field of the PATCH body: a body naming it is ignored.
    ignored = client.patch("/v1/datasets/qa/versions/v2/items/i2", params=PARAMS, headers=MGR, json={"input": "k", "disabled_at": "2020-01-01T00:00:00"})
    assert ignored.status_code == 200 and ignored.json()["item"]["state"] == "active"


def test_state_changes_need_modify_level_and_scope(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    client.put("/v1/datasets/qa/access", params=PARAMS, headers=MGR, json={"access_mode": "restricted", "grants": [{"user_id": "mem2", "level": "view"}]})
    for response in (_disable(client, "i1", headers=MEM2), _enable(client, "i1", headers=MEM2)):
        assert response.status_code == 403 and response.json()["detail"] == "You can view this dataset but not change it"
    assert _disable(client, "i1", headers=MEM).status_code == 403  # level none
    assert _disable(client, "i1", headers=ADMIN).status_code == 200


# --------------------------------------------------------------- hashes, download, compare, lineage


def test_flag_changes_content_hash_but_not_fingerprint_or_search_text(world):
    client, factory, _ = world
    _published(client)
    _draft(client, version="v2")
    _draft(client, version="v3")
    with factory() as db:
        before = {r.item_id: (r.fingerprint, r.search_text) for r in db.query(DatasetItem).join(DatasetVersion).filter(DatasetVersion.version == "v2")}
    _disable(client, "i1", version="v3")
    with factory() as db:
        after = {r.item_id: (r.fingerprint, r.search_text) for r in db.query(DatasetItem).join(DatasetVersion).filter(DatasetVersion.version == "v3")}
    assert before == after
    for version in ("v2", "v3"):
        assert client.post(f"/v1/datasets/qa/versions/{version}:publish", params=PARAMS, headers=MGR, json={}).status_code == 200
    with factory() as db:
        hashes = {v.version: v.content_hash for v in db.query(DatasetVersion)}
    assert hashes["v1"] == hashes["v2"]  # a version without disabled items keeps its digest
    assert hashes["v3"] != hashes["v2"]


def test_content_hash_reference_includes_disabled_only_when_set():
    from qym_platform.api.datasets import _ContentHasher, _content_hash

    class Row:
        def __init__(self, item_id, disabled_at=None):
            self.item_id, self.index, self.input, self.expected_output = item_id, 0, "q", "a"
            self.item_metadata, self.labels, self.fingerprint, self.disabled_at = {}, [], "fp", disabled_at

    from datetime import datetime

    rows = [Row("a"), Row("b", datetime(2026, 1, 1))]
    hasher = _ContentHasher()
    for row in rows:
        hasher.update(row.item_id, row.input, row.expected_output, row.item_metadata, row.labels, row.fingerprint, row.disabled_at is not None)
    assert hasher.hexdigest() == _content_hash(rows)
    assert _content_hash(rows) != _content_hash([Row("a"), Row("b")])


def test_download_omits_disabled_unless_asked(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i2")
    _disable(client, "i3")
    default = client.get("/v1/datasets/qa/versions/v2:download", params=PARAMS, headers=MGR)
    lines = [json.loads(line) for line in default.text.splitlines()]
    assert [l["item_id"] for l in lines] == ["i1", "i4", "i5", "i6"]
    assert set(lines[0]) == {"item_id", "input", "expected_output", "metadata", "labels"}  # no extra field
    full = client.get("/v1/datasets/qa/versions/v2:download", params={**PARAMS, "include_disabled": "true"}, headers=MGR)
    assert len(full.text.splitlines()) == 6
    assert set(json.loads(full.text.splitlines()[1])) == set(lines[0])


def test_compare_reports_state_as_a_changed_field_and_summary_counts(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1")
    _disable(client, "i2")
    client.post("/v1/datasets/qa/versions/v2:publish", params=PARAMS, headers=MGR, json={})
    _draft(client, version="v3", from_version="v2")
    _enable(client, "i2", version="v3")
    first = client.get("/v1/datasets/qa/versions/v2:compare", params={**PARAMS, "base": "v1", "include_diffs": 1}, headers=MGR).json()
    assert first["summary"] == {"added": 0, "removed": 0, "changed": 2, "unchanged": 4, "disabled": 2, "enabled": 0}
    entry = next(e for e in first["changed"] if e["item_id"] == "i1")
    assert entry["fields"] == ["state"]
    diff = next(d for d in first["field_diffs"] if d["item_id"] == "i1")
    assert diff["before"]["state"] == "active" and diff["after"]["state"] == "disabled"
    second = client.get("/v1/datasets/qa/versions/v3:compare", params={**PARAMS, "base": "v2"}, headers=MGR).json()
    assert second["summary"]["enabled"] == 1 and second["summary"]["changed"] == 1 and second["summary"]["disabled"] == 0
    # A state flip plus a content edit keeps both field names.
    client.patch("/v1/datasets/qa/versions/v3/items/i2", params=PARAMS, headers=MGR, json={"input": "edited"})
    third = client.get("/v1/datasets/qa/versions/v3:compare", params={**PARAMS, "base": "v2"}, headers=MGR).json()
    assert sorted(next(e for e in third["changed"] if e["item_id"] == "i2")["fields"]) == ["input", "state"]


def test_lineage_change_counts_gain_disabled_and_enabled(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1")
    client.post("/v1/datasets/qa/versions/v2:publish", params=PARAMS, headers=MGR, json={})
    _draft(client, version="v3", from_version="v2")
    _enable(client, "i1", version="v3")
    _disable(client, "i5", version="v3")
    client.post("/v1/datasets/qa/versions/v3:publish", params=PARAMS, headers=MGR, json={})
    lineage = client.get("/v1/datasets/qa/lineage", params=PARAMS, headers=MGR).json()
    counts = {v["version"]: v["change_counts"] for v in lineage["versions"]}
    assert counts["v2"]["disabled"] == 1 and counts["v2"]["enabled"] == 0 and counts["v2"]["modified"] == 1
    assert counts["v3"]["disabled"] == 1 and counts["v3"]["enabled"] == 1 and counts["v3"]["modified"] == 2
    assert counts["v1"]["disabled"] == 0


def test_sdk_style_read_without_state_gets_active_items_only(world):
    client, _, _ = world
    _published(client)
    _draft(client)
    _disable(client, "i1")
    client.post("/v1/datasets/qa/versions/v2:publish", params=PARAMS, headers=MGR, json={})
    response = client.get("/v1/datasets/qa/versions/v2/items", params={"project_slug": "pa", "limit": 1000}, headers=MGR)
    assert "i1" not in _ids(response) and response.json()["total"] == 5


# --------------------------------------------------------------- migration


def _migration():
    path = Path(__file__).resolve().parents[2] / "packages/platform/qym_platform/migrations/versions/0087_dataset_access_and_item_state.py"
    spec = importlib.util.spec_from_file_location("migration_0087", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_0087_round_trips_on_sqlite(monkeypatch):
    migration = _migration()
    assert (migration.revision, migration.down_revision) == ("0087", "0086")
    engine = sa.create_engine("sqlite://")
    meta = sa.MetaData()
    sa.Table("users", meta, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table("datasets", meta, sa.Column("id", sa.String(36), primary_key=True), sa.Column("name", sa.String(200)))
    sa.Table(
        "dataset_items",
        meta,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("dataset_version_id", sa.String(36), nullable=False),
        sa.Column("item_id", sa.String(200)),
    )
    meta.create_all(engine)
    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO datasets (id, name) VALUES ('d1', 'qa')"))
        connection.execute(sa.text("INSERT INTO dataset_items (dataset_version_id, item_id) VALUES ('v', 'a')"))
        ops = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", ops)
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert connection.execute(sa.text("SELECT access_mode FROM datasets")).scalar_one() == "project"
        row = connection.execute(sa.text("SELECT disabled_at, disabled_by_user_id, disabled_reason FROM dataset_items")).one()
        assert tuple(row) == (None, None, "")
        assert "ix_dataset_items_version_disabled" in {i["name"] for i in inspector.get_indexes("dataset_items")}
        grants = inspector.get_columns("dataset_grants")
        assert {c["name"] for c in grants} == {"id", "dataset_id", "user_id", "level", "granted_by_user_id", "created_at", "updated_at"}
        assert any(set(u["column_names"]) == {"dataset_id", "user_id"} for u in inspector.get_unique_constraints("dataset_grants"))
        migration.downgrade()
        inspector = sa.inspect(connection)
        assert "dataset_grants" not in inspector.get_table_names()
        assert not {"disabled_at", "disabled_by_user_id", "disabled_reason"} & {c["name"] for c in inspector.get_columns("dataset_items")}
        assert "access_mode" not in {c["name"] for c in inspector.get_columns("datasets")}
        assert connection.execute(sa.text("SELECT item_id FROM dataset_items")).scalar_one() == "a"
        migration.upgrade()  # re-upgrading after a downgrade is clean
    engine.dispose()
