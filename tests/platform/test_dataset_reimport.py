"""Re-importing a file into a draft does not overwrite edited items unasked (C006).

``items:bulk`` takes ``on_existing`` ("replace", the default and the old
behaviour, or "skip") and ``dry_run``. The import wizard counts the matching
records with a dry run, and then skips them unless the user chooses Replace.
"""

from __future__ import annotations

import json

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    DatasetItem,
    DatasetItemRevision,
    DatasetVersion,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

AUTH = {"Authorization": "Bearer token-1"}
BULK = "/v1/datasets/{slug}/versions/v1/items:bulk"


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as session:
        user = User(
            id="user-1", email="dev@local", display_name="Dev", role=UserRole.ADMIN
        )
        project = Project(
            id="project-1", name="Project", slug="project", created_by_user_id=user.id
        )
        session.add_all(
            [
                user,
                project,
                ProjectMembership(
                    project_id=project.id, user_id=user.id, role=ProjectRole.MANAGER
                ),
                ApiKey(
                    id="key-1",
                    user_id=user.id,
                    project_id=project.id,
                    name="test",
                    prefix=api_key_prefix("token-1"),
                    key_hash=hash_api_key("token-1"),
                    scopes=["datasets:read", "datasets:write", "datasets:delete"],
                ),
            ]
        )
        session.commit()
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, factory
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _draft(client, name: str, rows: list[dict], **fields) -> dict:
    content = "\n".join(json.dumps(row) for row in rows).encode("utf-8")
    resp = client.post(
        "/v1/datasets:upload",
        headers=AUTH,
        data={"name": name, **fields},
        files={"file": ("items.jsonl", content, "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _bulk(client, slug: str, body: dict):
    return client.post(BULK.format(slug=slug), headers=AUTH, json=body)


def _state(factory, version_id: str) -> dict:
    """Everything a bulk request can change: items, revisions and the item count."""
    with factory() as db:
        items = {
            item.item_id: (
                item.index,
                item.input,
                item.expected_output,
                item.item_metadata,
                item.labels,
            )
            for item in db.query(DatasetItem).filter(
                DatasetItem.dataset_version_id == version_id
            )
        }
        revisions = (
            db.query(DatasetItemRevision)
            .filter(DatasetItemRevision.dataset_version_id == version_id)
            .count()
        )
        version = db.get(DatasetVersion, version_id)
        return {
            "items": items,
            "revisions": revisions,
            "item_count": version.item_count,
        }


FAQ = [
    {"item_id": f"faq-10{n}", "input": f"q{n}", "expected_output": f"a{n}"}
    for n in range(1, 5)
]
REVIEWED = "a1. Reviewed by support lead."


def _reviewed_draft(client) -> dict:
    """The finding's draft: 4 FAQ items plus 3 others, and a reviewed edit on faq-101."""
    body = _draft(
        client,
        "Support FAQ",
        FAQ + [{"item_id": f"other-{n}", "input": n} for n in range(3)],
    )
    edit = client.patch(
        "/v1/datasets/support-faq/versions/v1/items/faq-101",
        headers=AUTH,
        json={"expected_output": REVIEWED},
    )
    assert edit.status_code == 200, edit.text
    return body


def _item(client, item_id: str) -> dict:
    resp = client.get(
        f"/v1/datasets/support-faq/versions/v1/items/{item_id}", headers=AUTH
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["item"]


def test_skip_keeps_an_edited_item_and_adds_only_new_records(env):
    client, factory = env
    body = _reviewed_draft(client)
    before = _state(factory, body["version"]["id"])
    resp = _bulk(
        client,
        "support-faq",
        {
            "upserts": FAQ + [{"item_id": "faq-105", "input": "q5"}],
            "on_existing": "skip",
        },
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["summary"] == {"created": 1, "updated": 0, "skipped": 4, "deleted": 0}
    assert out["skipped"] == ["faq-101", "faq-102", "faq-103", "faq-104"]
    assert [row["item_id"] for row in out["created"]] == ["faq-105"]
    assert out["updated"] == []
    assert _item(client, "faq-101")["expected_output"] == REVIEWED
    after = _state(factory, body["version"]["id"])
    assert after["item_count"] == 8
    # Only the new item has a revision: a skipped item gets no "updated" revision.
    assert after["revisions"] == before["revisions"] + 1
    assert {k: v for k, v in after["items"].items() if k != "faq-105"} == before[
        "items"
    ]


def test_replace_is_still_the_default_for_callers_that_do_not_choose(env):
    client, factory = env
    _reviewed_draft(client)
    resp = _bulk(client, "support-faq", {"upserts": FAQ})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["summary"] == {"created": 0, "updated": 4, "skipped": 0, "deleted": 0}
    assert out["skipped"] == []
    assert _item(client, "faq-101")["expected_output"] == "a1"
    explicit = _bulk(
        client, "support-faq", {"upserts": FAQ[:1], "on_existing": "replace"}
    )
    assert explicit.status_code == 200 and explicit.json()["summary"]["updated"] == 1


def test_a_dry_run_counts_the_matching_records_and_writes_nothing(env):
    client, factory = env
    body = _reviewed_draft(client)
    before = _state(factory, body["version"]["id"])
    upserts = FAQ + [{"item_id": "faq-105", "input": "q5"}, {"input": "no id"}]
    skip = _bulk(
        client,
        "support-faq",
        {"upserts": upserts, "on_existing": "skip", "dry_run": True},
    )
    assert skip.status_code == 200, skip.text
    assert skip.json() == {
        "dry_run": True,
        "matched": 4,
        "summary": {"created": 2, "updated": 0, "skipped": 4, "deleted": 0},
    }
    replace = _bulk(client, "support-faq", {"upserts": upserts, "dry_run": True})
    assert replace.json()["summary"] == {
        "created": 2,
        "updated": 4,
        "skipped": 0,
        "deleted": 0,
    }
    assert replace.json()["matched"] == 4
    # The wizard sends the IDs only: an entry with no input is enough to count.
    ids_only = _bulk(
        client,
        "support-faq",
        {
            "upserts": [{"item_id": row["item_id"]} for row in FAQ],
            "dry_run": True,
            "on_existing": "skip",
        },
    )
    assert ids_only.status_code == 200 and ids_only.json()["matched"] == 4
    assert _state(factory, body["version"]["id"]) == before


def test_on_existing_takes_replace_or_skip_only(env):
    client, _ = env
    _draft(client, "Choice", [{"item_id": "a", "input": "a"}])
    resp = _bulk(
        client,
        "choice",
        {"upserts": [{"item_id": "a", "input": "b"}], "on_existing": "merge"},
    )
    assert resp.status_code == 422


def test_a_dry_run_on_a_published_version_is_refused_like_an_apply(env):
    client, _ = env
    _draft(client, "Published", [{"item_id": "a", "input": "a"}], publish="true")
    resp = _bulk(client, "published", {"upserts": [{"item_id": "a"}], "dry_run": True})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Only draft dataset versions can be edited"


# Indexes 0, 1 and 2, so generated IDs start at item-4 and item-6 is taken.
SEED = [
    {"item_id": "a", "input": "a"},
    {"item_id": "b", "input": "b"},
    {"item_id": "item-6", "input": "x"},
]
GEN = {"input": "no id"}

# Each case is a request body without on_existing. The dry run must give the
# counts (or the 409) that the apply then gives, in both modes.
PREVIEW_CASES = {
    "new and matching": {
        "upserts": [{"item_id": "a", "input": 1}, {"item_id": "n", "input": 2}]
    },
    "a repeated new id": {
        "upserts": [{"item_id": "n", "input": 1}, {"item_id": "n", "input": 2}]
    },
    "a repeated matching id": {
        "upserts": [{"item_id": "a", "input": 1}, {"item_id": " a ", "input": 2}]
    },
    "blank and generated ids": {"upserts": [{"item_id": "  ", "input": 1}, GEN]},
    "a generated id named later": {"upserts": [GEN, {"item_id": "item-4", "input": 2}]},
    "a generated id that is taken": {"upserts": [GEN, GEN, GEN]},
    "a deleted id is free for a generated one": {
        "deletes": ["item-6"],
        "upserts": [GEN, GEN, GEN, GEN],
    },
    "delete then upsert": {
        "deletes": ["a", " a ", "missing"],
        "upserts": [{"item_id": "a", "input": 1}, {"item_id": "b", "input": 2}, GEN],
    },
    "create of a taken id": {
        "upserts": [
            {"item_id": "n", "input": 1},
            {"item_id": "b", "op": "create", "input": 2},
        ]
    },
    "create of a new id": {"upserts": [{"item_id": "n", "op": "CREATE", "input": 1}]},
    # Replace flushes at the repeated "n" and meets the taken item-6 first.
    # Skip does not flush there and meets the create of "a" first.
    "the first conflict depends on the mode": {
        "upserts": [
            GEN,
            GEN,
            GEN,
            {"item_id": "n"},
            {"item_id": "n"},
            {"item_id": "a", "op": "create"},
        ]
    },
}


@pytest.mark.parametrize("on_existing", ["replace", "skip"])
@pytest.mark.parametrize("case", sorted(PREVIEW_CASES))
def test_a_dry_run_gives_the_counts_or_the_conflict_of_the_apply(
    env, case, on_existing
):
    client, factory = env
    body = _draft(client, "Mirror", SEED)
    request = {**PREVIEW_CASES[case], "on_existing": on_existing}
    before = _state(factory, body["version"]["id"])
    preview = _bulk(client, "mirror", {**request, "dry_run": True})
    assert _state(factory, body["version"]["id"]) == before
    applied = _bulk(client, "mirror", request)
    assert preview.status_code == applied.status_code, (preview.text, applied.text)
    if applied.status_code != 200:
        assert preview.json()["detail"] == applied.json()["detail"]
        return
    assert preview.json()["summary"] == applied.json()["summary"]
