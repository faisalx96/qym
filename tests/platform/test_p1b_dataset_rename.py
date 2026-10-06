"""Renaming a dataset's display name is audited (P1 round 2, decision on C066).

Any member may rename a dataset's display name. The rename writes a
``dataset.renamed`` AuditLog row with the old and new name. SDK/CI uploads
that still use the old name keep failing, and the error names the new name.
"""

from __future__ import annotations

from qym_platform.db.models import AuditLog

from test_dataset_p1_datasets import MEM, MEM2, MGR, _upload, env  # noqa: F401  (fixture)

ROWS = [("a", "hello", "world", "billing")]


def _renames(factory):
    with factory() as db:
        return [
            (row.actor_user_id, row.before.get("name"), row.after.get("name"), row.before.get("dataset_slug"))
            for row in db.query(AuditLog).filter(AuditLog.action == "dataset.renamed").order_by(AuditLog.id)
        ]


def test_a_display_name_rename_is_audited_with_old_and_new_name(env):
    client, factory, _ = env
    assert _upload(client, MGR, "Support QA", ROWS, publish="true").status_code == 200
    renamed = client.patch(
        "/v1/datasets/support-qa", params={"project_slug": "pa"}, json={"name": "  Support QA v2 "}, headers=MEM
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["dataset"]["name"] == "Support QA v2"
    assert _renames(factory) == [("mem", "Support QA", "Support QA v2", "support-qa")]
    # Saving the same name, or other fields only, is not a rename.
    for body in ({"name": "Support QA v2"}, {"description": "Golden set"}, {"tags": ["golden"]}):
        response = client.patch("/v1/datasets/support-qa", params={"project_slug": "pa"}, json=body, headers=MEM2)
        assert response.status_code == 200, response.text
    assert len(_renames(factory)) == 1


def test_uploads_by_the_old_name_fail_and_name_the_new_one(env):
    client, factory, _ = env
    assert _upload(client, MGR, "Support QA", ROWS, publish="true").status_code == 200
    assert client.patch(
        "/v1/datasets/support-qa", params={"project_slug": "pa"}, json={"name": "Support Golden"}, headers=MEM
    ).status_code == 200

    refused = _upload(client, MGR, "Support QA", [("b", "x", "y", "t")], publish="true")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == (
        "Dataset 'Support QA' was renamed to 'Support Golden'. "
        "Upload with the name 'Support Golden' or the slug 'support-qa'."
    )
    # Case does not matter for the old name either.
    assert "was renamed to 'Support Golden'" in _upload(client, MGR, "support qa", ROWS).json()["detail"]
    # The new name and the slug still append to the dataset.
    assert _upload(client, MGR, "Support Golden", [("b", "x", "y", "t")], publish="true").status_code == 200
    assert _upload(client, MGR, "support-qa", [("c", "x", "y", "t")], publish="true").status_code == 200
    listed = client.get("/v1/datasets", params={"project_slug": "pa"}, headers=MGR).json()
    assert [d["name"] for d in listed["datasets"]] == ["Support Golden"]


def test_an_unrelated_name_with_the_same_slug_keeps_the_conflict_message(env):
    client, _, _ = env
    assert _upload(client, MGR, "Support QA", ROWS, publish="true").status_code == 200
    refused = _upload(client, MGR, "Support-QA!", ROWS)
    assert refused.status_code == 409
    assert refused.json()["detail"].startswith("Dataset slug 'support-qa' is already used by dataset 'Support QA'.")
