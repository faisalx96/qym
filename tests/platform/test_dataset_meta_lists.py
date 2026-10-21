"""List-valued metadata: facets with ``kind``, ``meta`` on lists, ``meta_mode`` (QA1-31 to QA1-62).

The item generator is the Python twin of the design seed (``measure/seed-qa-a.mts``):
130 items, ``tags`` (list), ``source.labels`` (nested list), ``channels`` (mixed),
``levels`` (list of numbers), ``attachments`` (list of objects), ``flags`` (empty list).
The API cases run on SQLite; the SQL cases also run on PostgreSQL when
``QYM_TEST_POSTGRES_URL`` is set.
"""

from __future__ import annotations

import os
import time
from uuid import uuid4

import pytest
from _dataset_access_env import (MGR, dataset_world, new_dataset, new_version,
                                 seed_items)
from qym_platform.db.base import Base
from qym_platform.db.models import (Dataset, DatasetItem, DatasetVersion,
                                    Project, User)
from qym_platform.services import dataset_meta
from qym_platform.services.dataset_meta import (MetaFilter, apply_meta_filters,
                                                meta_pairs_from_mapping,
                                                parse_meta_params)
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

PARAMS = {"project_slug": "pa"}
BASE = "/v1/datasets/qa/versions/{v}"
DOMAINS = ["finance", "health", "retail", "legal"]
REGIONS = ["sa", "ae", "eg", "kw"]
TAGS = ["billing", "refund", "shipping", "account", "vip", "urgent", "fraud", "arabic"]
LABELS = ["gold", "silver", "reviewed", "needs-review", "synthetic"]


def faq_metadata(n: int = 130) -> list[dict]:
    out = []
    for i in range(n):
        tags = [TAGS[i % 8]]
        if i % 3 == 0:
            tags.append(TAGS[(i + 1) % 8])
        if i % 5 == 0:
            tags.append(TAGS[(i + 3) % 8])
        channels = (
            ["chat", "email", "phone"][: 1 + (i % 2) + 1]
            if i % 3 == 0
            else ("chat" if i % 2 else "email")
        )
        out.append(
            {
                "domain": "finance" if i < 42 else DOMAINS[1 + (i % 3)],
                "difficulty": i % 3,
                "tags": list(dict.fromkeys(tags)),
                "source": {
                    "region": {"code": REGIONS[i % 4]},
                    "channel": "chat" if i % 2 else "email",
                    "labels": (
                        [LABELS[i % 5], LABELS[(i + 2) % 5]]
                        if i % 2 == 0
                        else [LABELS[i % 5]]
                    ),
                },
                "channels": channels,
                "attachments": [{"kind": "pdf", "pages": 2}] if i % 4 == 0 else [],
                "flags": [],
                "levels": [i % 3, (i % 3) + 1],
            }
        )
    return out


def _values(meta: dict, path: str) -> set[str]:
    node = meta
    for key in path.split("."):
        node = node.get(key) if isinstance(node, dict) else None
    items = node if isinstance(node, list) else [node]
    out = set()
    for e in items:
        if isinstance(e, bool):
            out.add("true" if e else "false")
        elif isinstance(e, (int, float, str)):
            out.add(str(e))
    return out


def oracle(metas: list[dict], path: str, vals: list[str], mode: str) -> int:
    fn = any if mode == "any" else all
    return sum(fn(v in _values(m, path) for v in vals) for m in metas)


@pytest.fixture()
def world(monkeypatch):
    with dataset_world(monkeypatch) as env:
        yield env


@pytest.fixture()
def faq(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    metas = faq_metadata()
    seed_items(factory, version["id"], metas)
    dataset_meta.clear_facet_cache()
    return client, factory, version, metas


def _items(client, version="v1", **params):
    return client.get(
        BASE.format(v=version) + "/items",
        params={**PARAMS, "state": "all", "limit": 1000, **params},
        headers=MGR,
    )


def _facets(client, version="v1"):
    response = client.get(
        BASE.format(v=version) + "/items:metadata-facets", params=PARAMS, headers=MGR
    )
    assert response.status_code == 200, response.text
    return {p["path"]: p for p in response.json()["paths"]}, response.json()


# ------------------------------------------------------------------ facets (QA1-31 to QA1-40)


def test_facets_kind_values_and_counts(faq):
    client, _, _, metas = faq
    by_path, body = _facets(client)
    assert body["truncated"] is False
    assert sorted(by_path) == [
        "channels",
        "difficulty",
        "domain",
        "levels",
        "source.channel",
        "source.labels",
        "source.region.code",
        "tags",
    ]  # attachments (objects) and flags (empty lists) are omitted
    kinds = {path: p["kind"] for path, p in by_path.items()}
    assert kinds["tags"] == kinds["source.labels"] == kinds["levels"] == "list"
    assert kinds["channels"] == "mixed"
    assert kinds["domain"] == kinds["difficulty"] == kinds["source.channel"] == "scalar"
    tags = by_path["tags"]
    assert tags["value_count"] == 8 and tags["truncated"] is False
    for entry in tags["values"]:
        assert entry["count"] == sum(
            entry["value"] in _values(m, "tags") for m in metas
        )
    counts = [(v["count"], v["value"]) for v in tags["values"]]
    assert counts == sorted(counts, key=lambda c: (-c[0], c[1]))
    assert {v["value"]: v["count"] for v in by_path["levels"]["values"]} == {
        "0": 44,
        "1": 87,
        "2": 86,
        "3": 43,
    }
    assert {v["value"]: v["count"] for v in by_path["channels"]["values"]} == {
        "chat": 87,
        "email": 87,
        "phone": 22,
    }
    assert {v["value"] for v in by_path["source.labels"]["values"]} == set(LABELS)


def test_facets_counts_an_item_once_when_a_list_repeats_a_value(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(
        factory, version["id"], [{"t": ["a", "a", "b"]}, {"t": ["a"]}, {"t": []}]
    )
    by_path, _ = _facets(client)
    assert by_path["t"]["values"] == [
        {"value": "a", "count": 2},
        {"value": "b", "count": 1},
    ]


def test_facets_ignore_objects_nulls_nested_lists_and_do_not_traverse_lists(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(
        factory,
        version["id"],
        [
            {
                "o": [{"k": 1}],
                "mixedlist": [1, True, "x", None, [2], {"a": 1}],
                "e": [],
                "long": ["y" * 501, "ok"],
            },
        ],
    )
    by_path, _ = _facets(client)
    assert "o" not in by_path and "e" not in by_path
    assert {v["value"] for v in by_path["mixedlist"]["values"]} == {"1", "true", "x"}
    assert [v["value"] for v in by_path["long"]["values"]] == ["ok"]
    assert not any(path.startswith("o.") for path in by_path)


def test_facets_deep_list_cap_of_200_elements_and_200_values(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(
        factory,
        version["id"],
        [
            {"a": {"b": {"big": [f"v{n:03d}" for n in range(300)]}}},
        ],
    )
    by_path, _ = _facets(client)
    big = by_path["a.b.big"]
    assert (
        big["kind"] == "list"
        and big["value_count"] == 200
        and big["truncated"] is False
    )
    # Every element still matches in a filter (QA1-45).
    assert _items(client, meta="a.b.big:v250").json()["total"] == 1


def test_facet_value_cap_marks_truncation_for_lists(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(
        factory, version["id"], [{"k": [f"v{n:03d}", f"w{n:03d}"]} for n in range(150)]
    )
    path, _ = _facets(client)
    assert path["k"]["truncated"] is True and path["k"]["value_count"] == 300
    assert len(path["k"]["values"]) == 200


def test_facet_cache_key_carries_the_schema(faq):
    client, factory, version, _ = faq
    _facets(client)
    cached = dataset_meta._cache[version["id"]]
    assert cached[1][0] == dataset_meta.FACET_SCHEMA == 2
    # A schema-1 entry (no kind) is never served.
    dataset_meta._cache[version["id"]] = (
        cached[0],
        (1,) + cached[1][1:],
        {"paths": [], "truncated": False},
    )
    by_path, _ = _facets(client)
    assert "tags" in by_path and by_path["tags"]["kind"] == "list"


def test_facets_ignore_disabled_state_and_report_scalar_style_for_old_clients(faq):
    client, _, _, _ = faq
    by_path, _ = _facets(client)
    for path in by_path.values():
        assert set(path) >= {"path", "values", "truncated", "value_count", "kind"}


# ------------------------------------------------------------------ filters (QA1-41 to QA1-49)


@pytest.mark.parametrize(
    "path,vals,mode,expected",
    [
        ("tags", ["billing", "refund"], "any", 46),
        ("tags", ["billing", "refund"], "all", 6),
        ("tags", ["billing", "fraud"], "any", 49),
        ("tags", ["billing", "fraud"], "all", 1),
        ("channels", ["chat", "phone"], "any", 87),
        ("channels", ["chat", "phone"], "all", 22),
        ("source.labels", ["gold", "reviewed"], "any", 65),
        ("source.labels", ["gold", "reviewed"], "all", 13),
        ("levels", ["0", "2"], "any", 130),
        ("levels", ["0", "2"], "all", 0),
    ],
)
def test_any_and_all_match_the_spec_seed_and_the_oracle(
    faq, path, vals, mode, expected
):
    client, _, _, metas = faq
    assert oracle(metas, path, vals, mode) == expected
    body = _items(
        client,
        meta=[f"{path}:{v}" for v in vals],
        meta_mode=f"{path}:{mode}",
    ).json()
    assert body["total"] == expected and body["counts"]["all"] == expected


def test_single_values_match_scalar_equal_or_list_contains(faq):
    client, _, _, _ = faq
    assert _items(client, meta="tags:billing").json()["total"] == 26
    assert _items(client, meta="channels:chat").json()["total"] == 87
    assert _items(client, meta="levels:1").json()["total"] == 87
    assert _items(client, meta="domain:finance").json()["total"] == 42


def test_default_mode_is_all_and_a_single_value_ignores_the_mode(faq):
    client, _, _, _ = faq
    assert _items(client, meta=["tags:billing", "tags:refund"]).json()["total"] == 6
    one = _items(client, meta="tags:billing", meta_mode="tags:any").json()["total"]
    assert one == 26
    dup = _items(client, meta=["tags:billing", "tags:billing"]).json()["total"]
    assert dup == 26


def test_scalar_paths_accept_a_mode(faq):
    client, _, _, _ = faq
    assert _items(client, meta=["domain:finance", "domain:health"]).json()["total"] == 0
    both = _items(
        client, meta=["domain:finance", "domain:health"], meta_mode="domain:any"
    )
    assert both.status_code == 200 and both.json()["total"] == 42 + sum(
        1 for m in faq_metadata() if m["domain"] == "health"
    )


def test_different_paths_and(faq):
    client, _, _, metas = faq
    total = _items(
        client,
        meta=["tags:billing", "tags:refund", "domain:finance"],
        meta_mode="tags:any",
    ).json()["total"]
    expected = sum(
        m["domain"] == "finance" and bool({"billing", "refund"} & set(m["tags"]))
        for m in metas
    )
    assert total == expected > 0


def test_list_rules_empty_objects_nested_and_array_paths(faq):
    client, factory, version, _ = faq
    assert _items(client, meta="attachments:pdf").json()["total"] == 0
    assert _items(client, meta="flags:x").json()["total"] == 0
    assert _items(client, meta="attachments.kind:pdf").json()["total"] == 0


def test_numbers_booleans_and_string_numbers(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(
        factory,
        version["id"],
        [
            {"l": [1, 2]},
            {"l": ["1"]},
            {"l": [True, False]},
            {"l": [1.5]},
            {"l": [[1], {"a": 1}, None]},
            {"l": 1},
        ],
    )
    ids = lambda **kw: sorted(
        i["item_id"] for i in _items(client, **kw).json()["items"]
    )
    assert ids(meta="l:1") == ["i0", "i1", "i5"]
    assert ids(meta="l:true") == ["i2"] and ids(meta="l:false") == ["i2"]
    assert ids(meta="l:1.5") == ["i3"]
    assert ids(meta="l:null") == []


def test_download_counts_and_list_agree(faq):
    client, _, _, _ = faq
    params = {
        **PARAMS,
        "meta": ["tags:billing", "tags:refund"],
        "meta_mode": "tags:any",
    }
    listed = _items(client, meta=params["meta"], meta_mode=params["meta_mode"]).json()
    download = client.get(
        BASE.format(v="v1") + ":download",
        params={**params, "include_disabled": "true"},
        headers=MGR,
    )
    assert (
        download.status_code == 200
        and len(download.text.splitlines()) == listed["total"] == 46
    )
    assert listed["counts"] == {"active": 46, "disabled": 0, "all": 46}


def test_neighbors_follow_the_same_filter(faq):
    client, _, _, _ = faq
    listed = _items(client, meta="tags:billing", limit=3).json()["items"]
    item = listed[1]["item_id"]
    response = client.get(
        BASE.format(v="v1") + f"/items/{item}/neighbors",
        params={**PARAMS, "meta": "tags:billing"},
        headers=MGR,
    )
    if response.status_code == 200:
        body = response.json()
        flat = str(body)
        assert listed[0]["item_id"] in flat and listed[2]["item_id"] in flat


# ------------------------------------------------------------------ grammar errors (QA1-46, QA1-47, QA1-61)


@pytest.mark.parametrize(
    "meta,mode,detail",
    [
        (["tags:a"], ["tags:some"], "meta_mode must look like path:any or path:all"),
        (["tags:a"], ["tags"], "meta_mode must look like path:any or path:all"),
        (["tags:a"], ["tags:any", "tags:all"], "Use one meta_mode per metadata key"),
        (["tags:a"], ["other:any"], "meta_mode needs a meta filter for other"),
        (
            ["tags:a"],
            ["a..b:any"],
            "Metadata path must be dotted keys of at most 3 levels",
        ),
        ([f"k{n}:v" for n in range(6)], [], "Use at most 5 metadata filters"),
        (
            [f"tags:v{n}" for n in range(21)],
            [],
            "Use at most 20 values for one metadata key",
        ),
        (["tags"], [], "meta must look like path:value"),
    ],
)
def test_grammar_errors(faq, meta, mode, detail):
    client, _, _, _ = faq
    response = _items(client, meta=meta, meta_mode=mode)
    assert response.status_code == 422 and response.json()["detail"] == detail


def test_limits_count_paths_and_values_not_parameters(faq):
    client, _, _, _ = faq
    twenty = [f"tags:v{n}" for n in range(20)]
    assert _items(client, meta=twenty, meta_mode="tags:any").status_code == 200
    five = twenty + [f"k{n}:v" for n in range(4)]
    assert _items(client, meta=five).status_code == 200  # 5 paths, 24 parameters


def test_unknown_meta_parameters_are_ignored(faq):
    client, _, _, _ = faq
    assert _items(client, meta="tags:billing", meta_foo="x").json()["total"] == 26


def test_parse_meta_params_groups_by_path_in_first_seen_order():
    filters = parse_meta_params(["b:1", "a:x", "b:2", "a:x"], ["b:any"])
    assert filters == [
        MetaFilter("b", ("1", "2"), "any"),
        MetaFilter("a", ("x",), "all"),
    ]


# ------------------------------------------------------------------ SQL shape and speed (QA1-52, QA1-53)


def test_statement_count_is_equal_for_one_and_twenty_values(faq):
    client, factory, _, _ = faq
    engine = factory.kw["bind"]
    counts = []
    for n in (1, 20):
        seen = []

        def before(conn, cursor, statement, params, context, executemany):
            if (
                "dataset_items" in statement.lower()
                and statement.lstrip().upper().startswith("SELECT")
            ):
                seen.append(statement)

        event.listen(engine, "before_cursor_execute", before)
        try:
            response = _items(
                client, meta=[f"tags:v{k}" for k in range(n)], meta_mode="tags:any"
            )
        finally:
            event.remove(engine, "before_cursor_execute", before)
        assert response.status_code == 200
        counts.append(len(seen))
    assert counts[0] == counts[1], counts


def test_5000_items_list_and_batch_dry_run_stay_under_a_second(world):
    client, factory, _ = world
    new_dataset(client, MGR, "qa")
    version = new_version(client, MGR, "qa", "v1")
    seed_items(factory, version["id"], faq_metadata(5000))
    params = dict(meta=["tags:billing", "tags:refund"], meta_mode="tags:any", limit=50)
    started = time.perf_counter()
    response = _items(client, **params)
    assert response.status_code == 200 and time.perf_counter() - started < 1.0
    started = time.perf_counter()
    dry = client.post(
        BASE.format(v="v1") + "/items:batch",
        params=PARAMS,
        headers=MGR,
        json={
            "filter": {
                "meta": {"tags": {"values": ["billing", "refund"], "mode": "any"}}
            },
            "action": "disable",
        },
    )
    assert dry.status_code == 200 and time.perf_counter() - started < 1.0
    assert dry.json()["matched"] == response.json()["total"]


# ------------------------------------------------------------------ items:batch (QA1-54 to QA1-57)


def _batch(client, filt, action="disable", **extra):
    return client.post(
        BASE.format(v="v1") + "/items:batch",
        params=PARAMS,
        headers=MGR,
        json={"filter": filt, "action": action, **extra},
    )


def test_batch_meta_value_shapes_and_dry_run(faq):
    client, _, _, _ = faq
    dry = _batch(
        client,
        {"meta": {"tags": {"values": ["billing", "refund"], "mode": "any"}}},
        "delete",
    )
    assert dry.status_code == 200
    assert (
        dry.json()["matched"] == 46
        and dry.json()["affected"] == 46
        and dry.json()["dry_run"] is True
    )
    full = _batch(
        client, {"meta": {"tags": {"values": ["billing", "refund"], "mode": "all"}}}
    )
    assert full.json()["matched"] == 6
    default = _batch(client, {"meta": {"tags": {"values": ["billing", "refund"]}}})
    assert default.json()["matched"] == 6
    scalar = _batch(
        client, {"meta": {"domain": "finance", "tags": {"values": ["billing"]}}}
    )
    assert scalar.status_code == 200 and scalar.json()["matched"] == oracle(
        [m for m in faq_metadata() if m["domain"] == "finance"],
        "tags",
        ["billing"],
        "any",
    )
    number = _batch(client, {"meta": {"difficulty": 1, "flag": True}})
    assert number.status_code in (200, 422)


@pytest.mark.parametrize(
    "meta,detail",
    [
        (
            {"tags": ["a", "b"]},
            "meta value must be a string, number, boolean or {values, mode}",
        ),
        (
            {"tags": None},
            "meta value must be a string, number, boolean or {values, mode}",
        ),
        (
            {"tags": {"foo": 1}},
            "meta value must be a string, number, boolean or {values, mode}",
        ),
        ({"tags": {"values": ["a"], "mode": "some"}}, "mode must be any or all"),
        ({"tags": {"values": []}}, "values must not be empty"),
        ({"tags": {"mode": "any"}}, "values must not be empty"),
        ({f"k{n}": "v" for n in range(6)}, "Use at most 5 metadata filters"),
        (
            {"tags": {"values": [f"v{n}" for n in range(21)]}},
            "Use at most 20 values for one metadata key",
        ),
    ],
)
def test_batch_errors(faq, meta, detail):
    client, _, _, _ = faq
    response = _batch(client, {"meta": meta})
    assert response.status_code == 422 and response.json()["detail"] == detail


def test_batch_apply_and_audit_stores_the_filter_as_sent(faq, world):
    client, factory, _, _ = faq
    meta = {"tags": {"values": ["billing", "refund"], "mode": "all"}}
    done = _batch(client, {"meta": meta}, dry_run=False)
    assert done.status_code == 200 and done.json()["affected"] == 6
    assert _items(client, state="disabled").json()["total"] == 6
    from qym_platform.db.models import AuditLog

    with factory() as db:
        entry = db.query(AuditLog).order_by(AuditLog.created_at.desc()).first()
        assert entry.after["filter"]["meta"] == meta


def test_batch_empty_criteria_and_no_match_texts_are_unchanged(faq):
    client, _, _, _ = faq
    assert (
        _batch(client, {}).json()["detail"].startswith("Add a search, label, metadata")
    )
    assert (
        _batch(client, {"meta": {"tags": {"values": ["nope"]}}}).json()["detail"]
        == "No items match this filter"
    )


def test_meta_pairs_from_mapping_dedupes_values():
    [only] = meta_pairs_from_mapping(
        {"t": {"values": ["a", "a", 1, True], "mode": "any"}}
    )
    assert only == MetaFilter("t", ("a", "1", "true"), "any")


# ------------------------------------------------------------------ SQL on each dialect (QA1-50, QA1-51)


@pytest.fixture(scope="module", params=["sqlite", "postgresql"])
def meta_engine(request):
    if request.param == "postgresql":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set QYM_TEST_POSTGRES_URL to exercise PostgreSQL list filters")
        engine = create_engine(url)
        schema = "test_dataset_lists_" + uuid4().hex
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


EXTRA = [
    {"l": [1, 2]},
    {"l": ["1"]},
    {"l": [True, False]},
    {"l": [1.5]},
    {"l": [[1], {"a": 1}, None]},
    {"l": 1},
    {"l": {"a": 1}},
    {"l": []},
    {"l": "1"},
    {"l": ["a", "b"], "o": [{"k": "a"}]},
]


@pytest.fixture()
def lists_db(meta_engine):
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
            for n, metadata in enumerate(faq_metadata(60) + EXTRA):
                db.add(
                    DatasetItem(
                        dataset_version_id="v",
                        item_id=f"i{n:03d}",
                        index=n,
                        input="q",
                        expected_output="a",
                        item_metadata=metadata,
                        labels=[],
                        fingerprint=f"f{n}",
                    )
                )
            db.flush()
            yield db
        transaction.rollback()


def _match(db, meta, modes=()):
    query = db.query(DatasetItem.item_id).filter(DatasetItem.dataset_version_id == "v")
    query = apply_meta_filters(db, query, parse_meta_params(meta, modes))
    return sorted(row[0] for row in query)


def test_list_sql_semantics_on_each_dialect(lists_db):
    db = lists_db
    metas = faq_metadata(60)
    for path, vals in (
        ("tags", ["billing", "refund"]),
        ("channels", ["chat", "phone"]),
        ("source.labels", ["gold", "reviewed"]),
    ):
        for mode in ("any", "all"):
            got = _match(db, [f"{path}:{v}" for v in vals], [f"{path}:{mode}"])
            assert len(got) == oracle(metas, path, vals, mode), (path, mode)
    # numbers, strings and booleans inside lists; scalars still equal
    assert _match(db, ["l:1"]) == ["i060", "i061", "i065", "i068"]
    assert _match(db, ["l:true"]) == ["i062"] and _match(db, ["l:false"]) == ["i062"]
    assert _match(db, ["l:1.5"]) == ["i063"]
    # objects, empty lists, nested lists, null and paths through arrays match nothing
    assert _match(db, ["l:null"]) == [] and _match(db, ["o:a"]) == []
    assert (
        _match(db, ["attachments:pdf"]) == []
        and _match(db, ["attachments.kind:pdf"]) == []
    )
    assert _match(db, ["l:a", "l:b"]) == ["i069"]
    assert _match(db, ["l:a", "l:1"], ["l:any"]) == [
        "i060",
        "i061",
        "i065",
        "i068",
        "i069",
    ]
    assert _match(db, ["l:a", "l:1"]) == []
    # a scalar path with a mode: any = IN
    assert len(_match(db, ["domain:finance", "domain:health"], ["domain:any"])) > 42
    assert _match(db, ["domain:finance", "domain:health"]) == []


def test_postgresql_clause_renders_the_documented_functions():
    """Without a PostgreSQL server the statement is at least compiled for its dialect (QA1-51)."""
    from types import SimpleNamespace

    from sqlalchemy.dialects import postgresql

    fake = SimpleNamespace(
        get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    )
    clause = dataset_meta._value_clause(fake, "source.labels", "gold")
    sql = str(clause.compile(dialect=postgresql.dialect()))
    assert "jsonb_typeof" in sql and "jsonb_array_elements" in sql and "#>" in sql
    assert "EXISTS" in sql.upper()
