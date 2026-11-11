"""A dataset's "updated" time follows its content (C065).

The catalog shows and sorts by ``updated_at`` ("Last updated"). It must move on a
new version, a new or changed item, a publish and a production move, not only on a
rename, so the dataset that changed today sorts first.
"""

from __future__ import annotations

from datetime import datetime

from qym_platform.db.models import Dataset

from test_dataset_p1_datasets import MGR, _upload, env  # noqa: F401  (fixture)

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
