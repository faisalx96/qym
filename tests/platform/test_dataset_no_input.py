"""A new dataset item needs an input (C013).

A JSON file whose records use other key names imported as empty items, and runs
then sent a null input. The server now refuses a new item without input: one
item, a bulk upsert (dry run and apply alike) and a JSON / JSONL upload.
"""

from __future__ import annotations

from test_dataset_p1_datasets import MGR, _upload, env  # noqa: F401  (fixture)

ROWS = [("a", "hello", "world", "billing")]
Q = {"project_slug": "pa"}


def _draft(client) -> str:
    assert _upload(client, MGR, "Support QA", ROWS, publish="true").status_code == 200
    created = client.post("/v1/datasets/support-qa/versions", params=Q, json={"from_version": "v1"}, headers=MGR)
    assert created.status_code == 200, created.text
    return created.json()["version"]["version"]


def test_one_item_and_a_bulk_upsert_need_an_input(env):
    client, _, _ = env
    draft = _draft(client)
    one = client.post(f"/v1/datasets/support-qa/versions/{draft}/items", params=Q, json={"input": None}, headers=MGR)
    assert one.status_code == 422, one.text
    assert one.json()["detail"] == "An item needs an input."
    body = {"upserts": [{"item_id": "n1", "expected_output": "x"}, {"input": "ok"}]}
    for dry in (True, False):
        bulk = client.post(
            f"/v1/datasets/support-qa/versions/{draft}/items:bulk",
            params=Q,
            json={**body, "dry_run": dry},
            headers=MGR,
        )
        assert bulk.status_code == 422, bulk.text
        assert bulk.json()["detail"] == "1 new item(s) have no input: n1"
    # replacing an existing item without an input is not a new item
    kept = client.post(
        f"/v1/datasets/support-qa/versions/{draft}/items:bulk",
        params=Q,
        json={"upserts": [{"item_id": "a", "expected_output": "y"}]},
        headers=MGR,
    )
    assert kept.status_code == 200, kept.text


def test_a_jsonl_upload_with_records_without_input_is_refused(env):
    client, _, _ = env
    body = b'{"question": "q1", "answer": "a1"}\n{"input": "q2"}\n'
    response = client.post(
        "/v1/datasets:upload",
        headers=MGR,
        data={"name": "Keys", "project_slug": "pa", "format": "jsonl"},
        files={"file": ("keys.jsonl", body, "application/x-ndjson")},
    )
    assert response.status_code == 400, response.text
    assert "line 1 has no input" in response.json()["detail"]
