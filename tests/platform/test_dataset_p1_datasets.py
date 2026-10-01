"""P1 datasets group: indexed search (C031), lineage/version/sort/item-runs cost
(C033), dataset permissions, audit and restore (C066), compare ordered by time
with timestamps (C321) and paged compare diffs (C181)."""

from __future__ import annotations

import io
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.auth import clear_api_key_cache
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AuditLog,
    DatasetItem,
    DatasetItemRevision,
    DatasetVersion,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    clear_api_key_cache()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
                User(id="mem", email="mem@x.com", role=UserRole.MEMBER),
                User(id="mem2", email="mem2@x.com", role=UserRole.MEMBER),
                Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin", is_active=True),
            ]
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER),
                ProjectMembership(project_id="pa", user_id="mem", role=ProjectRole.MEMBER),
                ProjectMembership(project_id="pa", user_id="mem2", role=ProjectRole.MEMBER),
            ]
        )
        db.commit()
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, factory, engine
    app.dependency_overrides.clear()
    clear_api_key_cache()
    engine.dispose()


def _as(email: str) -> dict:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


MGR, MEM, MEM2 = _as("mgr@x.com"), _as("mem@x.com"), _as("mem2@x.com")


def _upload(client, headers, name, rows, **fields):
    body = "id,input,expected_output,topic\n" + "".join(f"{r[0]},{r[1]},{r[2]},{r[3]}\n" for r in rows)
    data = {"name": name, "project_slug": "pa", "id_col": "id", "metadata_cols": "topic"}
    data.update(fields)
    response = client.post(
        "/v1/datasets:upload",
        headers=headers,
        data=data,
        files={"file": ("data.csv", io.BytesIO(body.encode("utf-8")), "text/csv")},
    )
    return response


def _audit_actions(factory) -> list[tuple[str, str]]:
    with factory() as db:
        return [(row.action, row.actor_user_id) for row in db.query(AuditLog).filter(AuditLog.entity_type == "dataset").order_by(AuditLog.id)]


# ---------------------------------------------------------------- C031 search


def test_search_uses_stored_text_including_metadata_and_legacy_rows(env):
    client, factory, _ = env
    assert _upload(client, MGR, "qa", [("a", "hello", "world", "billing"), ("b", "other", "thing", "shipping")], publish="true").status_code == 200
    with factory() as db:
        texts = {item.item_id: item.search_text for item in db.query(DatasetItem)}
    assert "billing" in texts["a"] and "hello" in texts["a"]
    # Metadata values are found (they used to answer "No items match").
    found = client.get("/v1/datasets/qa/versions/v1/items", params={"project_slug": "pa", "search": "SHIPPING"}, headers=MGR).json()
    assert [item["item_id"] for item in found["items"]] == ["b"] and found["total"] == 1
    # A row written before migration 0068 (search_text NULL) still matches.
    with factory() as db:
        db.execute(update(DatasetItem).where(DatasetItem.item_id == "a").values(search_text=None))
        db.commit()
    legacy = client.get("/v1/datasets/qa/versions/v1/items", params={"project_slug": "pa", "search": "billing"}, headers=MGR).json()
    assert [item["item_id"] for item in legacy["items"]] == ["a"]


def test_items_search_runs_the_filter_once_and_can_skip_context(env):
    client, _, engine = env
    _upload(client, MGR, "qa", [(f"i{n}", f"text {n}", "x", "t") for n in range(12)], publish="true")
    statements: list[str] = []

    def capture(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        page = client.get(
            "/v1/datasets/qa/versions/v1/items",
            params={"project_slug": "pa", "search": "text 1", "limit": 2, "include_context": "false"},
            headers=MGR,
        ).json()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert page["total"] == 3  # text 1, text 10, text 11
    assert [item["item_id"] for item in page["items"]] == ["i1", "i10"]
    assert "dataset" not in page and "version" not in page
    searches = [s for s in statements if "search_text" in s and "LIKE" in s.upper()]
    # Count and page come from one statement (count(*) OVER ()).
    assert len(searches) == 1, searches


def test_item_page_neighbors_follow_the_list_sort_without_loading_every_row(env):
    client, _, _ = env
    _upload(client, MGR, "qa", [("a", "zeta", "x", "t"), ("b", "alpha", "x", "t"), ("c", "mid", "x", "t")], publish="true")
    params = {"project_slug": "pa", "sort": "input_asc"}
    listed = client.get("/v1/datasets/qa/versions/v1/items", params=params, headers=MGR).json()
    order = [item["item_id"] for item in listed["items"]]
    assert order == ["b", "c", "a"]
    middle = client.get("/v1/datasets/qa/versions/v1/items/c/neighbors", params=params, headers=MGR).json()
    assert (middle["previous"]["item_id"], middle["next"]["item_id"], middle["index"], middle["total"]) == ("b", "a", 1, 3)
    first = client.get("/v1/datasets/qa/versions/v1/items/b/neighbors", params=params, headers=MGR).json()
    assert first["previous"] is None and first["next"]["item_id"] == "c"


# ---------------------------------------------------------------- C033 cost


def test_lineage_reads_stored_counts_of_published_versions(env, monkeypatch):
    client, factory, _ = env
    _upload(client, MGR, "qa", [("a", "one", "x", "t"), ("b", "two", "x", "t")], publish="true")
    draft = client.post("/v1/datasets/qa/versions", params={"project_slug": "pa"}, json={"from_version": "v1"}, headers=MGR).json()["version"]
    client.patch(f"/v1/datasets/qa/versions/{draft['version']}/items/a", params={"project_slug": "pa"}, json={"input": "changed"}, headers=MGR)
    client.post(f"/v1/datasets/qa/versions/{draft['version']}/items", params={"project_slug": "pa"}, json={"item_id": "c", "input": "new"}, headers=MGR)
    assert client.post(f"/v1/datasets/qa/versions/{draft['version']}:publish", params={"project_slug": "pa"}, json={}, headers=MGR).status_code == 200
    with factory() as db:
        stored = {v.version: v.change_counts for v in db.query(DatasetVersion)}
    assert stored == {"v1": {"added": 2, "modified": 0, "deleted": 0, "unchanged": 0}, "v2": {"added": 1, "modified": 1, "deleted": 0, "unchanged": 1}}

    import qym_platform.services.dataset_versions as dataset_versions

    def no_diff(*_args, **_kwargs):
        raise AssertionError("published versions must not be diffed per request")

    monkeypatch.setattr(dataset_versions, "compute_change_counts", no_diff)
    lineage = client.get("/v1/datasets/qa/lineage", params={"project_slug": "pa"}, headers=MGR).json()
    assert {v["version"]: v["change_counts"]["modified"] for v in lineage["versions"]} == {"v1": 0, "v2": 1}
    # Changes come oldest first and name who made them.
    times = [change["created_at"] for change in lineage["changes"]]
    assert times == sorted(times)
    assert {change["actor"]["email"] for change in lineage["changes"]} == {"mgr@x.com"}


def test_editing_a_draft_parent_clears_its_childs_stored_counts(env):
    client, factory, _ = env
    _upload(client, MGR, "qa", [("a", "one", "x", "t")], publish="true")
    parent = client.post("/v1/datasets/qa/versions", params={"project_slug": "pa"}, json={"from_version": "v1"}, headers=MGR).json()["version"]
    with factory() as db:
        draft = db.query(DatasetVersion).filter(DatasetVersion.version == parent["version"]).one()
        child = DatasetVersion(id="child", dataset_id=draft.dataset_id, version="v9", status="published", parent_version_id=draft.id, created_by_user_id="mgr", change_counts={"added": 0, "modified": 0, "deleted": 0, "unchanged": 1})
        db.add(child)
        db.commit()
    client.patch(f"/v1/datasets/qa/versions/{parent['version']}/items/a", params={"project_slug": "pa"}, json={"input": "edited"}, headers=MGR)
    with factory() as db:
        assert db.get(DatasetVersion, "child").change_counts is None


def test_version_list_uses_a_fixed_number_of_queries(env):
    client, _, engine = env
    _upload(client, MGR, "qa", [("a", "one", "x", "t")], publish="true")

    def count_queries() -> int:
        seen = []
        listener = lambda *args: seen.append(1)  # noqa: E731
        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert client.get("/v1/datasets/qa/versions", params={"project_slug": "pa"}, headers=MGR).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen)

    few = count_queries()
    for _ in range(6):
        client.post("/v1/datasets/qa/versions", params={"project_slug": "pa"}, json={"from_version": "v1"}, headers=MGR)
    assert count_queries() == few


def test_item_runs_reads_only_that_items_scores(env):
    client, factory, engine = env
    _upload(client, MGR, "qa", [("a", "one", "x", "t"), ("b", "two", "x", "t")], publish="true")
    with factory() as db:
        version = db.query(DatasetVersion).one()
        db.add(Run(id="r1", project_id="pa", created_by_user_id="mgr", owner_user_id="mgr", task="t", dataset="qa", dataset_id=version.dataset_id, dataset_version_id=version.id, metrics=["m"], run_metadata={}, run_config={}, status=RunWorkflowStatus.COMPLETED))
        db.flush()
        db.add_all([RunItem(run_id="r1", item_id=i, input="x") for i in ("a", "b")])
        db.add_all([RunItemScore(run_id="r1", item_id=i, metric_name="m", score_numeric=v) for i, v in (("a", 1.0), ("b", 0.0))])
        db.commit()
    rows: list[int] = []

    def count_rows(conn, cursor, statement, params, context, executemany):
        if "FROM run_item_scores" in statement:
            rows.append(statement.count("run_item_scores.item_id IN"))

    event.listen(engine, "after_cursor_execute", count_rows)
    try:
        body = client.get("/v1/datasets/qa/versions/v1/items/a/runs", params={"project_slug": "pa"}, headers=MGR).json()
    finally:
        event.remove(engine, "after_cursor_execute", count_rows)
    assert body["aggregates"]["metrics"]["m"]["avg"] == 1.0
    assert rows and all(rows), "the score query must filter by the item"


# ---------------------------------------------------------------- C066 rights


def test_members_cannot_rename_slug_move_production_or_delete_others_datasets(env):
    client, factory, _ = env
    assert _upload(client, MGR, "golden", [("a", "one", "x", "t")], publish="true", set_alias="production").status_code == 200
    _upload(client, MGR, "golden", [("a", "two", "x", "t")], publish="true")
    # Metadata edits stay open to members.
    assert client.patch("/v1/datasets/golden", params={"project_slug": "pa"}, json={"description": "d"}, headers=MEM).status_code == 200
    rename = client.patch("/v1/datasets/golden", params={"project_slug": "pa"}, json={"slug": "gold"}, headers=MEM)
    assert rename.status_code == 403 and "slug" in rename.json()["detail"]
    move = client.post("/v1/datasets/golden/aliases/production", params={"project_slug": "pa"}, json={"version": "v2"}, headers=MEM)
    assert move.status_code == 403 and "production" in move.json()["detail"]
    publish_move = _upload(client, MEM, "golden", [("a", "three", "x", "t")], publish="true", set_alias="production")
    assert publish_move.status_code == 403
    assert client.delete("/v1/datasets/golden", params={"project_slug": "pa"}, headers=MEM).status_code == 403
    with factory() as db:
        assert db.query(DatasetVersion).count() == 2  # the refused upload wrote nothing
    perms = client.get("/v1/datasets/golden", params={"project_slug": "pa"}, headers=MEM).json()["dataset"]["permissions"]
    assert perms == {
        "can_manage": False,
        "is_creator": False,
        "can_rename_slug": False,
        "can_move_production": False,
        "can_delete": False,
        "can_restore": False,
        "can_set_production": False,
    }
    # A manager does all of it, and every action is audited with the actor.
    assert client.post("/v1/datasets/golden/aliases/production", params={"project_slug": "pa"}, json={"version": "v2"}, headers=MGR).status_code == 200
    assert client.patch("/v1/datasets/golden", params={"project_slug": "pa"}, json={"slug": "gold"}, headers=MGR).status_code == 200
    assert client.delete("/v1/datasets/gold", params={"project_slug": "pa"}, headers=MGR).status_code == 200
    actions = _audit_actions(factory)
    assert ("dataset.alias_moved", "mgr") in actions
    assert ("dataset.slug_renamed", "mgr") in actions
    assert ("dataset.deleted", "mgr") in actions
    assert ("dataset.version_published", "mgr") in actions
    with factory() as db:
        moved = db.query(AuditLog).filter(AuditLog.action == "dataset.alias_moved").order_by(AuditLog.id.desc()).first()
        assert (moved.before["version"], moved.after["version"]) == ("v1", "v2")


def test_member_creates_publishes_and_deletes_their_own_dataset(env):
    client, factory, _ = env
    # First production of the member's own new dataset is allowed.
    assert _upload(client, MEM, "mine", [("a", "one", "x", "t")], publish="true", set_alias="production").status_code == 200
    assert client.delete("/v1/datasets/mine", params={"project_slug": "pa"}, headers=MEM2).status_code == 403
    assert client.delete("/v1/datasets/mine", params={"project_slug": "pa"}, headers=MEM).status_code == 200
    assert ("dataset.deleted", "mem") in _audit_actions(factory)


def test_deleted_datasets_are_listed_and_restored_by_managers(env):
    client, factory, _ = env
    _upload(client, MGR, "golden", [("a", "one", "x", "t")], publish="true", set_alias="production")
    dataset_id = client.get("/v1/datasets/golden", params={"project_slug": "pa"}, headers=MGR).json()["dataset"]["id"]
    client.delete("/v1/datasets/golden", params={"project_slug": "pa"}, headers=MGR)
    # Re-creating the slug tombstones the deleted one, like before.
    _upload(client, MGR, "golden", [("z", "new", "x", "t")], publish="true")
    deleted = client.get("/v1/datasets", params={"project_slug": "pa", "deleted": "true"}, headers=MEM).json()
    (row,) = deleted["datasets"]
    assert row["id"] == dataset_id and row["original_slug"] == "golden" and row["deleted_by"]["email"] == "mgr@x.com"
    assert row["deleted_at"]
    assert client.post(f"/v1/datasets/{dataset_id}:restore", params={"project_slug": "pa"}, headers=MEM).status_code == 403
    conflict = client.post(f"/v1/datasets/{dataset_id}:restore", params={"project_slug": "pa"}, headers=MGR)
    assert conflict.status_code == 409 and "golden" in conflict.json()["detail"]
    client.delete("/v1/datasets/golden", params={"project_slug": "pa"}, headers=MGR)
    restored = client.post(f"/v1/datasets/{dataset_id}:restore", params={"project_slug": "pa"}, headers=MGR)
    assert restored.status_code == 200 and restored.json()["dataset"]["slug"] == "golden"
    items = client.get("/v1/datasets/golden/versions/production/items", params={"project_slug": "pa"}, headers=MGR).json()
    assert [item["item_id"] for item in items["items"]] == ["a"]
    assert ("dataset.restored", "mgr") in _audit_actions(factory)


# ------------------------------------------------- C321 / C181 compare order


def _compare_fixture(client, factory):
    _upload(client, MGR, "qa", [(f"i{n}", f"text {n}", "x", "t") for n in range(6)], publish="true")
    draft = client.post("/v1/datasets/qa/versions", params={"project_slug": "pa"}, json={"from_version": "v1"}, headers=MGR).json()["version"]["version"]
    for item_id in ("i4", "i1", "i3"):
        client.patch(f"/v1/datasets/qa/versions/{draft}/items/{item_id}", params={"project_slug": "pa"}, json={"input": "edit " + item_id}, headers=MGR)
    # Give the revisions distinct, known times: i3 first, then i4, then i1.
    base = datetime(2026, 9, 1, 12, 0, 0)
    with factory() as db:
        for item_id, minutes in (("i3", 0), ("i4", 5), ("i1", 10)):
            for revision in db.query(DatasetItemRevision).all():
                if (revision.after or {}).get("item_id") == item_id:
                    revision.created_at = base + timedelta(minutes=minutes)
        db.commit()
    return draft


def test_compare_lists_changes_by_time_with_their_timestamp(env):
    client, factory, _ = env
    draft = _compare_fixture(client, factory)
    body = client.get(f"/v1/datasets/qa/versions/{draft}:compare", params={"project_slug": "pa", "base": "v1", "include_diffs": 1}, headers=MGR).json()
    assert [row["item_id"] for row in body["changed"]] == ["i3", "i4", "i1"]
    assert [row["changed_at"] for row in body["changed"]] == ["2026-09-01T12:00:00Z", "2026-09-01T12:05:00Z", "2026-09-01T12:10:00Z"]
    assert {row["changed_at_source"] for row in body["changed"]} == {"revision"}
    assert [row["item_id"] for row in body["field_diffs"]] == ["i3", "i4", "i1"]
    assert all(row["fields"] == ["input"] for row in body["changed"])


def test_compare_pages_one_list_and_keeps_full_compat_without_limit(env):
    client, factory, _ = env
    draft = _compare_fixture(client, factory)
    params = {"project_slug": "pa", "base": "v1", "include_diffs": 1, "kind": "changed", "limit": 2}
    first = client.get(f"/v1/datasets/qa/versions/{draft}:compare", params=params, headers=MGR).json()
    assert [row["item_id"] for row in first["field_diffs"]] == ["i3", "i4"]
    assert first["page"] == {"kind": "changed", "offset": 0, "limit": 2, "total": 3, "next_offset": 2}
    assert first["summary"] == {"added": 0, "removed": 0, "changed": 3, "unchanged": 3}
    second = client.get(f"/v1/datasets/qa/versions/{draft}:compare", params=dict(params, offset=2), headers=MGR).json()
    assert [row["item_id"] for row in second["field_diffs"]] == ["i1"] and second["page"]["next_offset"] is None
    unchanged = client.get(f"/v1/datasets/qa/versions/{draft}:compare", params=dict(params, kind="unchanged", limit=10), headers=MGR).json()
    assert [row["item_id"] for row in unchanged["unchanged_items"]] == ["i0", "i2", "i5"]
    assert unchanged["field_diffs"] == []
    bad = client.get(f"/v1/datasets/qa/versions/{draft}:compare", params=dict(params, kind="nope"), headers=MGR)
    assert bad.status_code == 400


def test_compare_across_versions_keeps_each_edits_own_time(env):
    # v1 -> v2 (edit i1, published) -> v3 (edit i2). Comparing v1..v3 must show
    # i1 at the time it was edited in v2, not at v3's creation.
    client, factory, _ = env
    _upload(client, MGR, "qa", [(f"i{n}", f"text {n}", "x", "t") for n in range(3)], publish="true")
    v2 = client.post("/v1/datasets/qa/versions", params={"project_slug": "pa"}, json={"from_version": "v1"}, headers=MGR).json()["version"]["version"]
    client.patch(f"/v1/datasets/qa/versions/{v2}/items/i1", params={"project_slug": "pa"}, json={"input": "edit"}, headers=MGR)
    with factory() as db:
        for revision in db.query(DatasetItemRevision):
            revision.created_at = datetime(2026, 1, 2)
        db.commit()
    assert client.post(f"/v1/datasets/qa/versions/{v2}:publish", params={"project_slug": "pa"}, json={}, headers=MGR).status_code == 200
    v3 = client.post("/v1/datasets/qa/versions", params={"project_slug": "pa"}, json={"from_version": v2}, headers=MGR).json()["version"]["version"]
    client.patch(f"/v1/datasets/qa/versions/{v3}/items/i2", params={"project_slug": "pa"}, json={"input": "edit2"}, headers=MGR)
    body = client.get(f"/v1/datasets/qa/versions/{v3}:compare", params={"project_slug": "pa", "base": "v1"}, headers=MGR).json()
    rows = {row["item_id"]: row for row in body["changed"]}
    assert [row["item_id"] for row in body["changed"]] == ["i1", "i2"]
    assert (rows["i1"]["changed_at"], rows["i1"]["changed_at_source"]) == ("2026-01-02T00:00:00Z", "revision")
    assert rows["i2"]["changed_at_source"] == "revision"
    # Adjacent compare (v2..v3) still only attributes v3's own edit.
    adjacent = client.get(f"/v1/datasets/qa/versions/{v3}:compare", params={"project_slug": "pa", "base": v2}, headers=MGR).json()
    assert [row["item_id"] for row in adjacent["changed"]] == ["i2"]
