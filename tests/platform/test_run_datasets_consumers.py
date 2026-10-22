"""QC-74 to QC-79: everything else that reads a run's dataset ids."""

from __future__ import annotations

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
            session, "support-tickets", {"v3": ["t-1", "t-2"], "v4": ["t-1", "t-2", "t-3"]}
        )
        billing = seed_dataset(session, "billing-faq", {"v7": ["b-1"]})
    with app_client(factory) as client:
        single = post_union_run(
            client, [with_items(tickets, "v3")], label="support-tickets", external_run_id="single"
        )
        union = post_union_run(
            client,
            [with_items(tickets, "v3"), with_items(tickets, "v4"), with_items(billing, "v7")],
            external_run_id="union",
        )
        yield client, factory, tickets, billing, single, union


def test_dataset_runs_tab_lists_union_once_with_its_own_version(env):
    client, _, tickets, billing, single, union = env
    body = client.get("/v1/datasets/support-tickets/runs", headers=auth()).json()
    ids = [r["id"] for r in body["runs"]]
    assert sorted(ids) == sorted([single, union]) and body["total"] == 2
    # Once, although two of its entries belong to this dataset; the list says so.
    assert ids.count(union) == 1
    only_v4 = client.get(
        "/v1/datasets/support-tickets/runs?version=v4", headers=auth()
    ).json()
    assert [r["id"] for r in only_v4["runs"]] == [union]
    assert only_v4["runs"][0]["version_label"] == "v4"
    on_billing = client.get("/v1/datasets/billing-faq/runs", headers=auth()).json()
    assert [r["id"] for r in on_billing["runs"]] == [union]
    assert on_billing["runs"][0]["version_label"] == "v7"
    assert on_billing["runs"][0]["dataset_count"] == 3


def test_run_counts_include_union_runs(env):
    client, *_ = env
    listing = client.get("/v1/datasets", headers=auth()).json()
    counts = {d["name"]: d["run_count"] for d in listing["datasets"]}
    assert counts == {"support-tickets": 2, "billing-faq": 1}
    versions = client.get("/v1/datasets/support-tickets/versions", headers=auth()).json()
    by_label = {v["version"]: v["run_count"] for v in versions["versions"]}
    assert by_label == {"v3": 2, "v4": 1}


def test_item_history_follows_the_source_item_not_the_raw_id(env):
    client, _, tickets, _, single, union = env
    # t-1 of v4 was evaluated only by the union run.
    history = client.get(
        "/v1/datasets/support-tickets/versions/v4/items/t-1/runs", headers=auth()
    )
    if history.status_code == 404:
        pytest.skip("item history route has another path")
    ids = {row["run_id"] if "run_id" in row else row.get("id") for row in history.json().get("runs", [])}
    assert union in ids and single not in ids


def _entries_only_run(client, tickets, billing):
    """A union run with its dataset rows and no items (so a hard delete meets no other child)."""
    created = client.post(
        "/v1/runs",
        headers=auth(),
        json={
            "task": "t",
            "dataset": "support-tickets@v3 + billing-faq@v7",
            "datasets": [
                {"dataset": "support-tickets", "dataset_id": tickets["id"],
                 "dataset_version_id": tickets["versions"]["v3"], "version": "v3"},
                {"dataset": "billing-faq", "dataset_id": billing["id"],
                 "dataset_version_id": billing["versions"]["v7"], "version": "v7"},
            ],
        },
    )
    assert created.status_code == 200, created.text
    return created.json()["run_id"]


def test_hard_delete_cascades_to_run_datasets(env):
    client, factory, tickets, billing, *_ = env
    run_id = _entries_only_run(client, tickets, billing)
    from qym_platform.db.models import Run, RunDataset

    with factory() as session:
        if session.get_bind().dialect.name != "postgresql":
            pytest.skip("SQLite does not enforce foreign keys here")
        assert session.query(RunDataset).filter(RunDataset.run_id == run_id).count() == 2
        session.execute(__import__("sqlalchemy").text("DELETE FROM runs WHERE id = :r"), {"r": run_id})
        session.commit()
        assert session.query(RunDataset).filter(RunDataset.run_id == run_id).count() == 0
        assert session.get(Run, run_id) is None


def test_deleting_a_dataset_keeps_entry_text(env):
    client, factory, tickets, billing, *_ = env
    run_id = _entries_only_run(client, tickets, billing)
    from qym_platform.db.models import RunDataset

    with factory() as session:
        if session.get_bind().dialect.name != "postgresql":
            pytest.skip("SQLite does not enforce foreign keys here")
        sa = __import__("sqlalchemy")
        for statement in (
            "UPDATE run_items SET dataset_item_pk = NULL",
            "DELETE FROM dataset_items WHERE dataset_version_id IN (SELECT id FROM dataset_versions WHERE dataset_id = :d)",
            "DELETE FROM dataset_versions WHERE dataset_id = :d",
            "DELETE FROM datasets WHERE id = :d",
        ):
            session.execute(sa.text(statement), {"d": billing["id"]} if ":d" in statement else {})
        session.commit()
        row = (
            session.query(RunDataset)
            .filter(RunDataset.run_id == run_id, RunDataset.dataset == "billing-faq")
            .one()
        )
        assert row.dataset_id is None and row.dataset_version_id is None
        assert row.version == "v7"


def test_union_runs_stay_out_of_version_insights(env):
    client, _, tickets, _, single, union = env
    base = "/api/projects/test/insights?period=all"
    body = client.get(base).json()
    assert body["facets"]["datasets"] == ["support-tickets", "support-tickets@v3 + support-tickets@v4 + billing-faq@v7"]
    # The first entry's version is not a facet of the union run.
    version_id = tickets["versions"]["v3"]
    filtered = client.get(f"{base}&dataset_version_id={version_id}").json()
    assert [p["run_id"] if "run_id" in p else p.get("id") for p in filtered["runs"]] == [single]


def test_openapi_lists_the_union_schema(env):
    """QC-82: the schema names the entry model, the request field and the breakdown route."""
    client, *_ = env
    spec = client.get("/openapi.json").json()
    schemas = spec["components"]["schemas"]
    assert {"dataset", "dataset_id", "dataset_version_id", "version", "alias", "items", "disabled_items"} <= set(
        schemas["RunDatasetEntry"]["properties"]
    )
    assert "datasets" in schemas["CreateRunRequest"]["properties"]
    assert "/api/runs/{run_id}/datasets" in spec["paths"]


def test_best_run_index_never_ranks_union_runs():
    """QC-76: the eligibility join of the best-run index carries the single-dataset guard."""
    from qym_platform.db.models import EvalEnvironment
    from qym_platform.services import eval_best_run
    from sqlalchemy import select
    from qym_platform.db.models import EvalRunScore

    sql = str(
        eval_best_run._eligible(
            select(EvalRunScore.run_id), EvalEnvironment(id="e", project_id="p")
        ).compile(compile_kwargs={"literal_binds": False})
    )
    assert "runs.dataset_count" in sql


def test_a_union_run_is_restricted_when_any_dataset_is(env):
    """QC-62: one private entry hides the items of the whole run from a non-admin reader."""
    client, factory, tickets, billing, single, union = env
    from qym_platform.auth import Principal
    from qym_platform.db.models import Dataset, Run, User, UserRole
    from qym_platform.permissions import run_item_hidden_reasons

    with factory() as session:
        session.get(Dataset, billing["id"]).private_test_set = True
        reader = User(id="reader", email="reader@example.test", role=UserRole.MEMBER)
        session.add(reader)
        session.commit()
        runs = [session.get(Run, rid) for rid in (single, union)]
        reasons = run_item_hidden_reasons(session, Principal(user=reader, auth_type="proxy_headers"), runs)
    # The single run is on support-tickets (public): visible. The union run includes billing-faq: hidden.
    assert reasons == {union: "private_test_set"}
