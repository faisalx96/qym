"""Metadata filters, facets and batch edits (WP-A, A3-43 to A3-64).

The SQL filter cases run on SQLite and, with ``QYM_TEST_POSTGRES_URL`` set, on
PostgreSQL (``json_extract`` versus ``#>>``); the API cases run on SQLite.
"""

from __future__ import annotations

import os
import time
from uuid import uuid4

import pytest
from _dataset_access_env import (ADMIN, MEM, MEM2, MGR, dataset_world,
                                 new_dataset, new_version, seed_items)
from qym_platform.db.base import Base
from qym_platform.db.models import (AuditLog, Dataset, DatasetItem,
                                    DatasetItemRevision, DatasetVersion,
                                    Project, User)
from qym_platform.services import dataset_meta
from qym_platform.services.dataset_meta import (apply_meta_filters,
                                                parse_meta_params)
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

PARAMS = {"project_slug": "pa"}
BASE = "/v1/datasets/qa/versions/{v}"


def _meta(n: int) -> dict:
    return {
        "domain": ["finance", "health", "retail"][n % 3],
        "difficulty": n % 4,
        "flag": n % 2 == 0,
        "ratio": 0.5,
        "note": "a:b",
        "tags": ["x", "y"],
        "source": {"region": {"code": ["sa", "ae"][n % 2]}, "channel": "web"},
        "deep": {"a": {"b": {"c": "too deep"}}},
    }


@pytest.fixture()
def world(monkeypatch):
    with dataset_world(monkeypatch) as env:
        yield env


@pytest.fixture()
def draft(world):
    """A draft ``v1`` of dataset ``qa`` with 12 items carrying nested metadata."""
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(factory, version["id"], [_meta(n) for n in range(12)])
    return client, factory, version


def _items(client, version="v1", headers=MGR, **params):
    return client.get(
        BASE.format(v=version) + "/items", params={**PARAMS, **params}, headers=headers
    )


def _ids(response):
    return [i["item_id"] for i in response.json()["items"]]


def _batch(client, body, version="v1", headers=MGR):
    return client.post(
        BASE.format(v=version) + "/items:batch",
        params=PARAMS,
        headers=headers,
        json=body,
    )


# --------------------------------------------------------------- meta= on reads (A3-43 to A3-45)


def test_meta_filter_exact_match_and_and_across_parameters(draft):
    client, _, _ = draft
    assert _ids(_items(client, meta="domain:finance")) == ["i0", "i3", "i6", "i9"]
    both = _items(client, meta=["domain:finance", "difficulty:3"])
    assert _ids(both) == ["i3", "i7"] or _ids(both) == ["i3"]
    assert set(_ids(both)) == {f"i{n}" for n in range(12) if n % 3 == 0 and n % 4 == 3}
    assert (
        _items(client, meta="domain:Finance").json()["total"] == 0
    )  # exact, case sensitive


def test_meta_numbers_booleans_and_values_with_colons(draft):
    client, _, _ = draft
    assert _items(client, meta="difficulty:2").json()["total"] == 3
    assert _items(client, meta="flag:true").json()["total"] == 6
    assert _items(client, meta="flag:false").json()["total"] == 6
    assert _items(client, meta="ratio:0.5").json()["total"] == 12
    assert (
        _items(client, meta="note:a:b").json()["total"] == 12
    )  # split on the first colon only


def test_meta_nested_paths_and_misses_match_nothing_without_error(draft):
    client, _, _ = draft
    assert _items(client, meta="source.region.code:sa").json()["total"] == 6
    assert _items(client, meta="source.channel:web").json()["total"] == 12
    for miss in (
        "missing:x",
        "domain.sub:x",
        "source:web",
        "source.region:sa",
        "tags:x",
        "tags.0:x",
    ):
        response = _items(client, meta=miss)
        assert response.status_code == 200 and response.json()["total"] == 0, miss


def test_meta_applies_to_counts_total_and_download(draft):
    client, _, _ = draft
    body = _items(client, meta="domain:health").json()
    assert body["total"] == 4 and body["counts"]["all"] == 4
    download = client.get(
        BASE.format(v="v1") + ":download",
        params={**PARAMS, "meta": "source.region.code:ae"},
        headers=MGR,
    )
    assert download.status_code == 200 and len(download.text.splitlines()) == 6


def test_meta_validation_texts(draft):
    client, _, _ = draft
    no_colon = _items(client, meta="domain")
    assert (
        no_colon.status_code == 422
        and no_colon.json()["detail"] == "meta must look like path:value"
    )
    path = "Metadata path must be dotted keys of at most 3 levels"
    for bad in ("a.b.c.d:x", ".a:x", "a..b:x", "a b:x", "a$:x", ":x", "a/b:x"):
        response = _items(client, meta=bad)
        assert response.status_code == 422 and response.json()["detail"] == path, bad
    too_many = _items(client, meta=[f"k{n}:v" for n in range(6)])
    assert (
        too_many.status_code == 422
        and too_many.json()["detail"] == "Use at most 5 metadata filters"
    )
    assert _items(client, meta=[f"k{n}:v" for n in range(5)]).status_code == 200


# --------------------------------------------------------------- facets (A3-46)


def test_facets_payload(draft):
    client, _, _ = draft
    body = client.get(
        BASE.format(v="v1") + "/items:metadata-facets", params=PARAMS, headers=MGR
    ).json()
    assert body["truncated"] is False
    by_path = {p["path"]: p for p in body["paths"]}
    assert set(by_path) == {
        "domain",
        "difficulty",
        "flag",
        "ratio",
        "note",
        "source.region.code",
        "source.channel",
    }
    domain = by_path["domain"]
    assert domain["values"] == [
        {"value": "finance", "count": 4},
        {"value": "health", "count": 4},
        {"value": "retail", "count": 4},
    ]
    assert domain["truncated"] is False and domain["value_count"] == 3
    assert [v["value"] for v in by_path["difficulty"]["values"]] == ["0", "1", "2", "3"]
    assert {v["value"] for v in by_path["flag"]["values"]} == {"true", "false"}
    assert "tags" not in by_path and not any(
        p.startswith("deep") for p in by_path
    )  # arrays and depth > 3 skipped
    assert [p["path"] for p in body["paths"]] == sorted(by_path)


def test_facets_order_by_count_then_value_and_truncate_values(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    metas = [{"k": f"v{n:03d}"} for n in range(205)] + [
        {"k": "v000"},
        {"k": "v000"},
        {"k": "v001"},
    ]
    seed_items(factory, version["id"], metas)
    path = client.get(
        BASE.format(v="v1") + "/items:metadata-facets", params=PARAMS, headers=MGR
    ).json()["paths"][0]
    assert (
        path["truncated"] is True
        and path["value_count"] == 205
        and len(path["values"]) == 200
    )
    assert path["values"][0] == {"value": "v000", "count": 3} and path["values"][1] == {
        "value": "v001",
        "count": 2,
    }
    assert path["values"][2]["value"] == "v002"


def test_facets_cap_the_number_of_paths(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(factory, version["id"], [{f"key{n:03d}": "x" for n in range(105)}])
    body = client.get(
        BASE.format(v="v1") + "/items:metadata-facets", params=PARAMS, headers=MGR
    ).json()
    assert body["truncated"] is True and len(body["paths"]) == 100


def test_facets_are_cached_and_invalidated_by_item_writes(draft):
    client, factory, version = draft
    dataset_meta.clear_facet_cache()
    url = BASE.format(v="v1") + "/items:metadata-facets"
    first = client.get(url, params=PARAMS, headers=MGR).json()
    scans: list[str] = []

    def capture(conn, cursor, statement, params, context, executemany):
        if "metadata" in statement and "SELECT dataset_items.metadata" in statement:
            scans.append(statement)

    engine = factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        assert client.get(url, params=PARAMS, headers=MGR).json() == first
        assert scans == []  # served from the cache: no column scan
        client.post(
            BASE.format(v="v1") + "/items",
            params=PARAMS,
            headers=MGR,
            json={"input": "q", "metadata": {"domain": "legal"}},
        )
        after = client.get(url, params=PARAMS, headers=MGR).json()
        assert len(scans) == 1  # one scan after the write
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    domain = next(p for p in after["paths"] if p["path"] == "domain")
    assert {"value": "legal", "count": 1} in domain["values"]


# --------------------------------------------------------------- batch (A3-47 to A3-64)


def test_dry_run_is_the_default_and_writes_nothing(draft):
    client, factory, _ = draft
    response = _batch(
        client, {"filter": {"meta": {"domain": "finance"}}, "action": "disable"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "matched": 4,
        "affected": 4,
        "sample_item_ids": ["i0", "i3", "i6", "i9"],
        "version_status": "draft",
        "dry_run": True,
    }
    with factory() as db:
        assert (
            db.query(DatasetItem).filter(DatasetItem.disabled_at.isnot(None)).count()
            == 0
        )
        assert db.query(DatasetItemRevision).count() == 0
        assert (
            db.query(AuditLog).filter(AuditLog.action == "dataset.items_batch").count()
            == 0
        )


def test_apply_disable_enable_writes_revisions_audit_and_updates_the_list(draft):
    client, factory, _ = draft
    applied = _batch(
        client,
        {
            "filter": {"meta": {"domain": "finance"}},
            "action": "disable",
            "reason": "noisy",
            "dry_run": False,
        },
    )
    assert (
        applied.status_code == 200
        and applied.json()["affected"] == 4
        and applied.json()["dry_run"] is False
    )
    disabled = _items(client, state="disabled").json()["items"]
    assert [i["item_id"] for i in disabled] == ["i0", "i3", "i6", "i9"]
    assert all(
        i["disabled"]["reason"] == "noisy" and i["disabled"]["by"]["id"] == "mgr"
        for i in disabled
    )
    with factory() as db:
        revisions = db.query(DatasetItemRevision).order_by(DatasetItemRevision.id).all()
        assert [r.change_type for r in revisions] == ["disabled"] * 4
        assert sorted(r.revision_number for r in revisions) == [1, 2, 3, 4]
        assert all(
            r.dataset_item_id is not None and r.actor_user_id == "mgr"
            for r in revisions
        )
        audit = (
            db.query(AuditLog).filter(AuditLog.action == "dataset.items_batch").one()
        )
        assert (
            audit.after["action"] == "disable"
            and audit.after["matched"] == 4
            and audit.after["affected"] == 4
        )
        assert (
            audit.after["filter"]["meta"] == {"domain": "finance"}
            and audit.actor_user_id == "mgr"
        )
    # Disabling again affects nothing (already disabled) but matches the same items.
    again = _batch(
        client,
        {
            "filter": {"meta": {"domain": "finance"}},
            "action": "disable",
            "dry_run": False,
        },
    ).json()
    assert again["matched"] == 4 and again["affected"] == 0
    enabled = _batch(
        client,
        {
            "filter": {"meta": {"domain": "finance"}},
            "action": "enable",
            "dry_run": False,
        },
    ).json()
    assert enabled["affected"] == 4
    assert _items(client, state="disabled").json()["total"] == 0
    with factory() as db:
        assert (
            db.query(DatasetItemRevision)
            .filter(DatasetItemRevision.change_type == "enabled")
            .count()
            == 4
        )


def test_apply_delete_removes_items_detaches_history_and_recounts(draft):
    client, factory, version = draft
    first = _batch(
        client,
        {
            "filter": {"meta": {"source.channel": "web"}, "search": "question 1"},
            "action": "delete",
            "dry_run": False,
        },
    )
    assert first.status_code == 200 and first.json()["affected"] == 3  # i1, i10, i11
    assert _items(client, state="all").json()["total"] == 9
    with factory() as db:
        assert db.get(DatasetVersion, version["id"]).item_count == 9
        deleted = (
            db.query(DatasetItemRevision)
            .filter(DatasetItemRevision.change_type == "deleted")
            .all()
        )
        assert len(deleted) == 3 and all(r.dataset_item_id is None for r in deleted)
        assert {r.before["item_id"] for r in deleted} == {"i1", "i10", "i11"}


def test_item_ids_filter_reports_missing_ids(draft):
    client, _, _ = draft
    response = _batch(
        client, {"filter": {"item_ids": ["i1", "i2", "ghost"]}, "action": "disable"}
    ).json()
    assert response["matched"] == 2 and response["affected"] == 2
    assert response["missing_item_ids"] == ["ghost"]
    too_many = _batch(
        client,
        {"filter": {"item_ids": [f"x{n}" for n in range(1001)]}, "action": "disable"},
    )
    assert too_many.status_code == 422


def test_state_in_the_filter_narrows_what_matches(draft):
    client, _, _ = draft
    _batch(
        client,
        {"filter": {"item_ids": ["i1", "i2"]}, "action": "disable", "dry_run": False},
    )
    only_active = _batch(
        client,
        {
            "filter": {"meta": {"source.channel": "web"}, "state": "active"},
            "action": "disable",
        },
    ).json()
    assert only_active["matched"] == 10 and only_active["affected"] == 10
    only_disabled = _batch(
        client,
        {
            "filter": {"meta": {"source.channel": "web"}, "state": "disabled"},
            "action": "enable",
        },
    ).json()
    assert only_disabled["matched"] == 2 and only_disabled["affected"] == 2
    bad = _batch(
        client,
        {
            "filter": {"meta": {"source.channel": "web"}, "state": "x"},
            "action": "enable",
        },
    )
    assert (
        bad.status_code == 422
        and bad.json()["detail"] == "state must be active, disabled or all"
    )


def test_search_and_label_have_the_list_semantics(draft):
    client, _, _ = draft
    searched = _batch(
        client, {"filter": {"search": "question 11"}, "action": "delete"}
    ).json()
    assert searched["matched"] == 1 and searched["sample_item_ids"] == ["i11"]
    assert (
        _batch(client, {"filter": {"search": "  "}, "action": "disable"}).status_code
        == 422
    )


def test_sample_is_capped_at_twenty(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(factory, version["id"], [{"g": "x"} for _ in range(30)])
    body = _batch(client, {"filter": {"meta": {"g": "x"}}, "action": "disable"}).json()
    assert body["matched"] == 30 and len(body["sample_item_ids"]) == 20


def test_error_texts_and_check_order(draft):
    client, _, _ = draft
    empty = _batch(client, {"filter": {}, "action": "disable", "dry_run": False})
    assert empty.status_code == 422
    assert (
        empty.json()["detail"]
        == "Add a search, label, metadata or item filter before a batch edit"
    )
    state_only = _batch(
        client, {"filter": {"state": "active"}, "action": "delete", "dry_run": False}
    )
    assert (
        state_only.status_code == 422
        and state_only.json()["detail"] == empty.json()["detail"]
    )
    nothing = _batch(
        client, {"filter": {"meta": {"domain": "legal"}}, "action": "disable"}
    )
    assert (
        nothing.status_code == 422
        and nothing.json()["detail"] == "No items match this filter"
    )
    action = _batch(client, {"filter": {"search": "q"}, "action": "archive"})
    assert (
        action.status_code == 422
        and action.json()["detail"] == "action must be disable, enable or delete"
    )
    reason = _batch(
        client,
        {"filter": {"search": "question"}, "action": "disable", "reason": "r" * 501},
    )
    assert (
        reason.status_code == 422
        and reason.json()["detail"] == "Reason must be 500 characters or fewer"
    )
    five = _batch(
        client,
        {"filter": {"meta": {f"k{n}": "v" for n in range(6)}}, "action": "disable"},
    )
    assert (
        five.status_code == 422
        and five.json()["detail"] == "Use at most 5 metadata filters"
    )
    path = _batch(client, {"filter": {"meta": {"a.b.c.d": "v"}}, "action": "disable"})
    assert (
        path.status_code == 422
        and path.json()["detail"]
        == "Metadata path must be dotted keys of at most 3 levels"
    )


def test_reason_is_ignored_for_enable_and_delete(draft):
    client, _, _ = draft
    _batch(
        client,
        {
            "filter": {"item_ids": ["i1"]},
            "action": "disable",
            "dry_run": False,
            "reason": "why",
        },
    )
    enabled = _batch(
        client,
        {
            "filter": {"item_ids": ["i1"]},
            "action": "enable",
            "dry_run": False,
            "reason": "ignored",
        },
    )
    assert enabled.status_code == 200
    item = client.get(
        BASE.format(v="v1") + "/items/i1", params=PARAMS, headers=MGR
    ).json()["item"]
    assert item["state"] == "active" and item["disabled"] is None


def test_published_versions_answer_409_before_any_422_even_for_a_dry_run(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(factory, version["id"], [_meta(n) for n in range(3)])
    assert (
        client.post(
            BASE.format(v="v1") + ":publish", params=PARAMS, headers=MGR, json={}
        ).status_code
        == 200
    )
    for body in (
        {"filter": {"meta": {"domain": "finance"}}, "action": "disable"},
        {
            "filter": {"meta": {"domain": "finance"}},
            "action": "delete",
            "dry_run": False,
        },
        {"filter": {}, "action": "nonsense"},
    ):
        response = _batch(client, body)
        assert (
            response.status_code == 409
            and response.json()["detail"] == "Create a draft to edit items"
        )


def test_expected_affected_guards_against_a_moved_count(draft):
    client, factory, _ = draft
    body = {
        "filter": {"meta": {"domain": "finance"}},
        "action": "disable",
        "dry_run": False,
    }
    stale = _batch(client, {**body, "expected_affected": 3})
    assert stale.status_code == 409
    assert (
        stale.json()["detail"]
        == "The matching items changed. Review the new count and try again."
    )
    with factory() as db:
        assert (
            db.query(DatasetItem).filter(DatasetItem.disabled_at.isnot(None)).count()
            == 0
        )
        assert db.query(DatasetItemRevision).count() == 0
    assert _batch(client, {**body, "expected_affected": 4}).json()["affected"] == 4


def test_batch_permissions_and_private_test_sets(draft):
    client, factory, _ = draft
    client.put(
        "/v1/datasets/qa/access",
        params=PARAMS,
        headers=MGR,
        json={
            "access_mode": "restricted",
            "grants": [{"user_id": "mem2", "level": "view"}],
        },
    )
    body = {"filter": {"meta": {"domain": "finance"}}, "action": "disable"}
    viewer = _batch(client, body, headers=MEM2)
    assert (
        viewer.status_code == 403
        and viewer.json()["detail"] == "You can view this dataset but not change it"
    )
    assert _batch(client, body, headers=MEM).status_code == 403
    with factory() as db:
        db.query(Dataset).one().private_test_set = True
        db.commit()
    private = _batch(client, body, headers=MGR)
    assert private.status_code == 403 and "private test set" in private.json()["detail"]
    assert _batch(client, body, headers=ADMIN).status_code == 200


def test_a_batch_of_5000_items_uses_a_constant_number_of_statements(world):
    client, factory, engine = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    with factory() as db:
        db.add_all(
            DatasetItem(
                dataset_version_id=version["id"],
                item_id=f"b{n}",
                index=n,
                input="q",
                expected_output="a",
                item_metadata={"bulk": "yes", "n": n % 7},
                labels=[],
                fingerprint=f"f{n}",
            )
            for n in range(5000)
        )
        db.get(DatasetVersion, version["id"]).item_count = 5000
        db.commit()

    def run(action: str, dry_run: bool):
        statements: list[str] = []

        def capture(conn, cursor, statement, params, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture)
        started = time.perf_counter()
        try:
            response = _batch(
                client,
                {
                    "filter": {"meta": {"bulk": "yes"}},
                    "action": action,
                    "dry_run": dry_run,
                },
            )
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        assert response.status_code == 200, response.text
        return len(statements), time.perf_counter() - started, response.json()

    dry_count, dry_seconds, dry = run("disable", True)
    assert dry["affected"] == 5000 and dry_seconds < 1.0, dry_seconds
    apply_count, apply_seconds, applied = run("disable", False)
    assert applied["affected"] == 5000 and apply_seconds < 1.0, apply_seconds
    delete_count, delete_seconds, deleted = run("delete", False)
    assert deleted["affected"] == 5000 and delete_seconds < 1.0, delete_seconds
    # No per-item statements: each call stays far below the item count.
    assert max(dry_count, apply_count, delete_count) < 40, (
        dry_count,
        apply_count,
        delete_count,
    )
    assert _items(client, state="all").json()["total"] == 0


# --------------------------------------------------------------- SQL semantics on both dialects


@pytest.fixture(scope="module", params=["sqlite", "postgresql"])
def meta_engine(request):
    if request.param == "postgresql":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip(
                "Set QYM_TEST_POSTGRES_URL to exercise PostgreSQL metadata filters"
            )
        engine = create_engine(url)
        schema = "test_dataset_meta_" + uuid4().hex
        with engine.begin() as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        engine = engine.execution_options(schema_translate_map={None: schema})
    else:
        engine = create_engine(
            "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
        )
        schema = None
    Base.metadata.create_all(engine)
    yield engine
    if request.param == "postgresql":
        with engine.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    engine.dispose()


@pytest.fixture()
def meta_db(meta_engine):
    with meta_engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection) as db:
            db.add(User(id="u", email="u@x.test", display_name="U"))
            db.flush()
            db.add(Project(id="p", name="P", slug="p", created_by_user_id="u"))
            db.flush()
            db.add(
                Dataset(
                    id="d", project_id="p", name="D", slug="d", created_by_user_id="u"
                )
            )
            db.flush()
            db.add(
                DatasetVersion(
                    id="v", dataset_id="d", version="v1", created_by_user_id="u"
                )
            )
            db.flush()
            for n in range(12):
                db.add(
                    DatasetItem(
                        dataset_version_id="v",
                        item_id=f"i{n}",
                        index=n,
                        input="q",
                        expected_output="a",
                        item_metadata=_meta(n),
                        labels=[],
                        fingerprint=f"f{n}",
                    )
                )
            db.add(
                DatasetItem(
                    dataset_version_id="v",
                    item_id="odd",
                    index=99,
                    input="q",
                    item_metadata={
                        "domain": {"x": 1},
                        "difficulty": None,
                        "flag": "true",
                    },
                    labels=[],
                    fingerprint="odd",
                )
            )
            db.flush()
            yield db
        transaction.rollback()


def _match(db, *values):
    query = db.query(DatasetItem.item_id).filter(DatasetItem.dataset_version_id == "v")
    query = apply_meta_filters(db, query, parse_meta_params(list(values)))
    return sorted(row[0] for row in query)


def test_meta_sql_semantics_on_each_dialect(meta_db):
    db = meta_db
    assert _match(db, "domain:finance") == ["i0", "i3", "i6", "i9"]
    assert _match(db, "domain:finance", "source.region.code:sa") == ["i0", "i6"]
    assert _match(db, "difficulty:3") == ["i11", "i3", "i7"]
    assert _match(db, "flag:true") == [
        "i0",
        "i10",
        "i2",
        "i4",
        "i6",
        "i8",
        "odd",
    ]  # JSON true and the string "true"
    assert _match(db, "ratio:0.5") == sorted(f"i{n}" for n in range(12))
    assert _match(db, "note:a:b") == sorted(f"i{n}" for n in range(12))
    assert _match(db, "domain.x:1") == ["odd"]  # nested scalar under an object
    assert (
        _match(db, "domain.finance:1") == []
    )  # a path through a string value matches nothing
    assert _match(db, "domain:1") == []  # objects never match a scalar
    assert (
        _match(db, "tags:x") == []
        and _match(db, "missing:x") == []
        and _match(db, "difficulty:null") == []
    )
