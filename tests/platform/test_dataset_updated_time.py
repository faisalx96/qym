"""A dataset's "updated" time follows its content (C065).

The catalog shows and sorts by ``updated_at`` ("Last updated"). It must move on a
new version, a new or changed item, a publish and a production move, not only on a
rename, so the dataset that changed today sorts first.
"""

from __future__ import annotations

from datetime import datetime

from qym_platform.db.models import Dataset

from test_dataset_p1_datasets import MEM, MEM2, MGR, _upload, env  # noqa: F401  (fixture)

ROWS = [("a", "hello", "world", "billing")]
OLD = datetime(2026, 1, 1)


def _age(factory) -> None:
    with factory() as db:
        db.query(Dataset).update({Dataset.updated_at: OLD})
        db.commit()


def _updated(factory) -> datetime:
    with factory() as db:
        return db.query(Dataset).one().updated_at


def test_versions_items_publish_and_production_move_the_updated_time(env):
    client, factory, _ = env
    assert _upload(client, MGR, "Support QA", ROWS, publish="true", set_alias="production").status_code == 200
    q = {"project_slug": "pa"}

    _age(factory)
    created = client.post("/v1/datasets/support-qa/versions", params=q, json={}, headers=MGR)
    assert created.status_code == 200, created.text
    draft = created.json()["version"]["version"]
    assert _updated(factory) > OLD

    _age(factory)
    item = client.post(
        f"/v1/datasets/support-qa/versions/{draft}/items",
        params=q,
        json={"item_id": "b", "input": "new question", "expected_output": "new answer"},
        headers=MGR,
    )
    assert item.status_code == 200, item.text
    assert _updated(factory) > OLD

    _age(factory)
    published = client.post(f"/v1/datasets/support-qa/versions/{draft}:publish", params=q, json={}, headers=MGR)
    assert published.status_code == 200, published.text
    assert _updated(factory) > OLD

    _age(factory)
    moved = client.post(
        "/v1/datasets/support-qa/aliases/production", params=q, json={"version": "v1"}, headers=MGR
    )
    assert moved.status_code == 200, moved.text
    assert _updated(factory) > OLD

    listed = client.get("/v1/datasets", params=q, headers=MGR).json()["datasets"]
    assert listed[0]["updated_at"] > OLD.isoformat()


def _editor(client) -> tuple[str, str]:
    """(updated_by id, updated_at) from the catalog, checked against the dataset read."""
    q = {"project_slug": "pa"}
    listed = client.get("/v1/datasets", params=q, headers=MGR).json()["datasets"][0]
    single = client.get("/v1/datasets/support-qa", params=q, headers=MGR).json()["dataset"]
    assert single["updated_by"] == listed["updated_by"]
    assert single["updated_at"] == listed["updated_at"]
    return listed["updated_by"]["id"], listed["updated_at"]


def test_updated_by_is_the_creator_until_another_user_edits_or_publishes(env):
    """The hero and the catalog card name who last changed the dataset (D5/D7)."""
    client, _, _ = env
    q = {"project_slug": "pa"}
    assert _upload(client, MGR, "Support QA", ROWS, publish="true", set_alias="production").status_code == 200
    who, created_at = _editor(client)
    assert who == "mgr"
    listed = client.get("/v1/datasets", params=q, headers=MGR).json()["datasets"][0]
    assert listed["created_by"]["id"] == "mgr"

    created = client.post("/v1/datasets/support-qa/versions", params=q, json={}, headers=MGR)
    assert created.status_code == 200, created.text
    draft = created.json()["version"]["version"]

    # A second user adds an item to the draft: an item edit does not touch the dataset
    # row, but the payload still names that user and moves the time with them.
    item = client.post(
        f"/v1/datasets/support-qa/versions/{draft}/items",
        params=q,
        json={"item_id": "b", "input": "new question", "expected_output": "new answer"},
        headers=MEM,
    )
    assert item.status_code == 200, item.text
    who, edited_at = _editor(client)
    assert who == "mem"
    assert edited_at >= created_at

    # A third user publishes: they are now the last editor.
    published = client.post(f"/v1/datasets/support-qa/versions/{draft}:publish", params=q, json={}, headers=MEM2)
    assert published.status_code == 200, published.text
    who, published_at = _editor(client)
    assert who == "mem2"
    assert published_at >= edited_at

    # The creator never changes.
    listed = client.get("/v1/datasets", params=q, headers=MGR).json()["datasets"][0]
    assert listed["created_by"]["id"] == "mgr"
