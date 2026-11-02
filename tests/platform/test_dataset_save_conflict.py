"""A second save of the same dataset item no longer overwrites the first (C015).

The editor sends the item's updated_at as it loaded it. When someone saved the
item since, the save answers 409 with the saved version, who saved it and when;
sending the new updated_at ("Keep mine") saves.
"""

from __future__ import annotations

from test_dataset_p1_datasets import MEM, MGR, _upload, env  # noqa: F401  (fixture)

ROWS = [("a", "hello", "world", "billing")]
Q = {"project_slug": "pa"}


def test_a_stale_save_gets_409_with_their_version_and_keep_mine_saves(env):
    client, _, _ = env
    assert _upload(client, MGR, "Support QA", ROWS, publish="true").status_code == 200
    draft = client.post("/v1/datasets/support-qa/versions", params=Q, json={"from_version": "v1"}, headers=MGR)
    version = draft.json()["version"]["version"]
    url = f"/v1/datasets/support-qa/versions/{version}/items/a"
    loaded = client.get(url, params=Q, headers=MEM).json()["item"]["updated_at"]

    theirs = client.patch(url, params=Q, json={"expected_output": "theirs", "expected_updated_at": loaded}, headers=MGR)
    assert theirs.status_code == 200, theirs.text

    mine = client.patch(url, params=Q, json={"expected_output": "mine", "expected_updated_at": loaded}, headers=MEM)
    assert mine.status_code == 409, mine.text
    detail = mine.json()["detail"]
    assert detail["code"] == "item_changed"
    assert detail["item"]["expected_output"] == "theirs"
    assert detail["changed_by"]["email"] == "mgr@x.com"

    kept = client.patch(
        url, params=Q, json={"expected_output": "mine", "expected_updated_at": detail["changed_at"]}, headers=MEM
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["item"]["expected_output"] == "mine"
    # without the field (History revert, the SDK) the save goes through as before
    assert client.patch(url, params=Q, json={"expected_output": "plain"}, headers=MGR).status_code == 200
