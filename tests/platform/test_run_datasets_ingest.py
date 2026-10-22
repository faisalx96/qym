"""QC-51 to QC-62, QC-80: ingest of union runs (migration 0089)."""

from __future__ import annotations

import io
import json

import pytest
from _helpers import app_client
from _union_run import auth, post_union_run, seed_api_key, seed_dataset, with_items
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def env(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as session:
        seed_api_key(session)
        tickets = seed_dataset(
            session,
            "support-tickets",
            {"v3": ["t-1", "t-2", "t-3"], "v4": ["t-1", "t-2"]},
            aliases={"production": "v3"},
        )
        billing = seed_dataset(
            session, "billing-faq", {"v7": ["b-1", "b-2"]}, aliases={"production": "v7"}
        )
    with app_client(factory) as client:
        yield client, factory, tickets, billing


def _run(factory, run_id):
    from qym_platform.db.models import Run

    with factory() as session:
        run = session.get(Run, run_id)
        session.expunge(run)
        return run


def _rows(factory, run_id):
    from qym_platform.db.models import RunDataset

    with factory() as session:
        return [
            (r.position, r.dataset, r.dataset_id, r.dataset_version_id, r.version, r.alias, r.item_count)
            for r in session.query(RunDataset)
            .filter(RunDataset.run_id == run_id)
            .order_by(RunDataset.position)
        ]


def test_single_run_has_no_rows_and_default_count(env):
    client, factory, tickets, _ = env
    run_id = post_union_run(client, [with_items(tickets, "v3")])
    assert _rows(factory, run_id) == []
    run = _run(factory, run_id)
    assert run.dataset_count == 1
    assert run.dataset_version_id == tickets["versions"]["v3"]


def test_union_run_stores_rows_ids_and_positions(env):
    client, factory, tickets, billing = env
    entries = [
        with_items(tickets, "v3"),
        with_items(tickets, "v4"),
        with_items(billing, "v7", alias="production"),
    ]
    run_id = post_union_run(client, entries)
    run = _run(factory, run_id)
    assert run.dataset_count == 3
    assert run.dataset == "support-tickets@v3 + support-tickets@v4 + billing-faq@v7"
    assert run.dataset_id == tickets["id"]
    assert run.dataset_version_id == tickets["versions"]["v3"]
    rows = _rows(factory, run_id)
    assert [r[0] for r in rows] == [0, 1, 2]
    assert [r[4] for r in rows] == ["v3", "v4", "v7"]
    assert rows[2][5] == "production"
    assert rows[1][3] == tickets["versions"]["v4"]

    from qym_platform.db.models import RunItem

    with factory() as session:
        items = session.query(RunItem).filter(RunItem.run_id == run_id).all()
    assert len(items) == 7
    by_id = {i.item_id: i for i in items}
    assert by_id["support-tickets@v3/t-1"].dataset_position == 0
    assert by_id["support-tickets@v4/t-1"].dataset_position == 1
    assert by_id["billing-faq@v7/b-2"].dataset_position == 2
    # The source-item link goes through (version, qym_item_id), not the namespaced id.
    assert by_id["support-tickets@v4/t-2"].dataset_item_pk == tickets["items"]["v4"]["t-2"]
    assert by_id["billing-faq@v7/b-1"].dataset_item_pk == billing["items"]["v7"]["b-1"]
    assert by_id["support-tickets@v3/t-1"].item_metadata["qym_item_id"] == "t-1"


def test_run_started_fills_table_when_create_had_no_datasets_and_is_idempotent(env):
    client, factory, tickets, billing = env
    entries = [with_items(tickets, "v3"), with_items(billing, "v7")]
    run_id = post_union_run(client, entries, send_datasets_on_create=False)
    assert len(_rows(factory, run_id)) == 2
    assert _run(factory, run_id).dataset_count == 2
    # The same run_started again leaves two rows.
    clean = [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
    line = json.dumps(
        {
            "schema_version": 1,
            "event_id": "00000000-0000-0000-0000-0000000000aa",
            "sequence": 900,
            "sent_at": "2026-10-22T00:00:00Z",
            "type": "run_started",
            "run_id": run_id,
            "payload": {
                "task": "answer-ticket",
                "dataset": "x",
                "metrics": [],
                "started_at": "2026-10-22T00:00:00Z",
                "datasets": clean,
            },
        }
    )
    for _ in range(2):
        r = client.post(
            f"/v1/runs/{run_id}/events",
            headers={**auth(), "Content-Type": "application/x-ndjson"},
            content=line + "\n",
        )
        assert r.status_code in (200, 409), r.text
    assert len(_rows(factory, run_id)) == 2


def test_untagged_items_have_null_position(env):
    client, factory, tickets, billing = env
    run_id = post_union_run(
        client, [with_items(tickets, "v3"), with_items(billing, "v7")], tag=False
    )
    from qym_platform.db.models import RunItem

    with factory() as session:
        positions = {
            i.dataset_position for i in session.query(RunItem).filter(RunItem.run_id == run_id)
        }
    assert positions == {None}


def test_single_entry_list_stores_no_rows_and_takes_ids(env):
    client, factory, tickets, _ = env
    response = client.post(
        "/v1/runs",
        headers=auth(),
        json={
            "task": "t",
            "dataset": "support-tickets",
            "datasets": [
                {
                    "dataset": "support-tickets",
                    "dataset_id": tickets["id"],
                    "dataset_version_id": tickets["versions"]["v3"],
                    "version": "v3",
                }
            ],
        },
    )
    assert response.status_code == 200
    run = _run(factory, response.json()["run_id"])
    assert run.dataset_count == 1
    assert run.dataset_version_id == tickets["versions"]["v3"]
    assert _rows(factory, run.id) == []


def test_entry_without_ids_is_resolved_by_name_and_alias(env):
    client, factory, tickets, billing = env
    response = client.post(
        "/v1/runs",
        headers=auth(),
        json={
            "task": "t",
            "dataset": "a + b",
            "datasets": [
                {"dataset": "support-tickets", "alias": "production"},
                {"dataset": "billing-faq", "version": "v7"},
                {"dataset": "label-only"},
            ],
        },
    )
    assert response.status_code == 200, response.text
    rows = _rows(factory, response.json()["run_id"])
    assert rows[0][3] == tickets["versions"]["v3"]
    assert rows[1][3] == billing["versions"]["v7"]
    assert rows[2][2:4] == (None, None)
    run = _run(factory, response.json()["run_id"])
    assert run.dataset_version_id == tickets["versions"]["v3"]


def test_unknown_ids_store_null_and_keep_name(env):
    client, factory, *_ = env
    response = client.post(
        "/v1/runs",
        headers=auth(),
        json={
            "task": "t",
            "dataset": "x + y",
            "datasets": [
                {"dataset": "x", "dataset_id": "nope", "dataset_version_id": "nope", "version": "v1"},
                {"dataset": "y", "dataset_id": "nope2", "dataset_version_id": "nope2", "version": "v2"},
            ],
        },
    )
    assert response.status_code == 200, response.text
    rows = _rows(factory, response.json()["run_id"])
    assert [(r[1], r[2], r[3]) for r in rows] == [("x", None, None), ("y", None, None)]


def test_limits_and_duplicates_are_422(env):
    client, _, tickets, _ = env
    dup = {"dataset": "a", "dataset_version_id": tickets["versions"]["v3"]}
    r = client.post(
        "/v1/runs", headers=auth(), json={"task": "t", "dataset": "a", "datasets": [dup, dup]}
    )
    assert r.status_code == 422
    assert r.json()["detail"].endswith("is listed twice")
    many = [{"dataset": f"d{i}", "version": "v1"} for i in range(51)]
    r = client.post(
        "/v1/runs", headers=auth(), json={"task": "t", "dataset": "a", "datasets": many}
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "at most 50 datasets per run"
    pair = [{"dataset": "s", "version": "v3"}, {"dataset": "s", "version": "v3"}]
    r = client.post(
        "/v1/runs", headers=auth(), json={"task": "t", "dataset": "a", "datasets": pair}
    )
    assert r.json()["detail"] == "dataset s v3 is listed twice"
    long = [{"dataset": "x" * 201, "version": "v1"}, {"dataset": "y", "version": "v1"}]
    r = client.post(
        "/v1/runs", headers=auth(), json={"task": "t", "dataset": "a", "datasets": long}
    )
    assert r.status_code == 422


def test_upload_field_datasets_sets_rows_and_positions(env):
    client, factory, tickets, billing = env
    rows = [
        {
            "item_id": "support-tickets@v3/t-1",
            "input": "q1",
            "expected_output": "a",
            "output": "a",
            "exact_match_score": "1",
            "item_metadata": json.dumps({"qym_dataset_index": 0, "qym_item_id": "t-1"}),
        },
        {
            "item_id": "billing-faq@v7/b-1",
            "input": "q2",
            "expected_output": "a",
            "output": "a",
            "exact_match_score": "0",
            "item_metadata": json.dumps({"qym_dataset_index": 1, "qym_item_id": "b-1"}),
        },
    ]
    import csv

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
    entries = [
        {k: v for k, v in with_items(tickets, "v3").items() if not k.startswith("_")},
        {k: v for k, v in with_items(billing, "v7").items() if not k.startswith("_")},
    ]
    response = client.post(
        "/v1/runs:upload",
        headers=auth(),
        data={"task": "t", "dataset": "support-tickets@v3 + billing-faq@v7", "datasets": json.dumps(entries)},
        files={"file": ("r.csv", buf.getvalue().encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    run_id = response.json()["run_id"]
    assert len(_rows(factory, run_id)) == 2
    assert _run(factory, run_id).dataset_count == 2
    bad = client.post(
        "/v1/runs:upload",
        headers=auth(),
        data={"task": "t", "dataset": "d", "datasets": "{not json"},
        files={"file": ("r.csv", b"a,b\n1,2\n", "text/csv")},
    )
    assert bad.status_code == 422


def test_union_ingest_adds_a_constant_number_of_statements(database):
    """QC-58, QC-80: positions come from a dict lookup, so a union run costs the same per item as a single run."""
    from sqlalchemy import event

    factory = sessionmaker(bind=database, autoflush=False)
    extra = {}
    for size in (10, 40):
        ids_a = [f"a{n}" for n in range(size // 2)]
        ids_b = [f"b{n}" for n in range(size // 2)]
        with factory() as session:
            if size == 10:
                seed_api_key(session)
            a = seed_dataset(session, f"ds-a-{size}", {"v1": ids_a})
            b = seed_dataset(session, f"ds-b-{size}", {"v1": ids_b})
            whole = seed_dataset(session, f"ds-all-{size}", {"v1": ids_a + ids_b})
        with app_client(factory) as client:
            counts = {}
            for name, entries in (
                ("single", [with_items(whole, "v1")]),
                ("union", [with_items(a, "v1"), with_items(b, "v1")]),
            ):
                statements = []

                def count(conn, cursor, statement, *args):
                    statements.append(statement)

                event.listen(database, "before_cursor_execute", count)
                try:
                    post_union_run(client, entries, label=name)
                finally:
                    event.remove(database, "before_cursor_execute", count)
                counts[name] = len(statements)
        extra[size] = counts["union"] - counts["single"]
    assert extra[10] == extra[40], extra
    assert extra[10] <= 12, extra  # entry resolution and the rows: a handful, whatever the size
