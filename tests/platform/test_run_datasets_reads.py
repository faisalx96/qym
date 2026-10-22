"""QC-63 to QC-73: reads of union runs (run payload, breakdown route)."""

from __future__ import annotations

import pytest
from _helpers import app_client
from _union_run import post_union_run, seed_api_key, seed_dataset, with_items
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

IDS_A = [f"a-{i}" for i in range(8)]
IDS_B = [f"b-{i}" for i in range(5)]


def _score(position, raw, metric):
    # Deterministic, different per dataset and metric.
    base = {0: 0.5, 1: 0.8}[position]
    return base if metric == "exact_match" else base / 2 + (0.1 if raw.endswith("1") else 0.0)


@pytest.fixture()
def env(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as session:
        seed_api_key(session)
        tickets = seed_dataset(
            session, "support-tickets", {"v3": IDS_A}, aliases={"production": "v3"}
        )
        billing = seed_dataset(session, "billing-faq", {"v7": IDS_B})
    with app_client(factory) as client:
        yield client, factory, tickets, billing


def _make(client, tickets, billing, **kwargs):
    return post_union_run(
        client,
        [with_items(tickets, "v3", alias="production"), with_items(billing, "v7")],
        metrics=["exact_match", "judge"],
        score_for=_score,
        **kwargs,
    )


def _get(client, path):
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()


def test_run_payload_lists_datasets(env):
    client, _, tickets, billing = env
    run_id = _make(client, tickets, billing)
    run = _get(client, f"/api/runs/{run_id}?view=summary")["run"]
    assert run["dataset_count"] == 2
    assert run["dataset_name"] == "support-tickets@v3 + billing-faq@v7"
    first, second = run["datasets"]
    assert (first["position"], first["dataset"], first["version"], first["alias"]) == (
        0, "support-tickets", "v3", "production",
    )
    assert first["dataset_slug"] == "support-tickets" and first["deleted"] is False
    assert first["aliases"] == ["production"]
    assert first["items"] == 8 and second["items"] == 5
    assert run["dataset_version"] == "v3"  # the first entry's


def test_single_run_payload_has_one_synthesised_entry(env):
    client, _, tickets, _ = env
    run_id = post_union_run(client, [with_items(tickets, "v3")], label="support-tickets")
    run = _get(client, f"/api/runs/{run_id}?view=summary")["run"]
    assert run["dataset_count"] == 1
    assert len(run["datasets"]) == 1
    entry = run["datasets"][0]
    assert entry["dataset"] == "support-tickets" and entry["version"] == "v3"
    assert entry["items"] is None and entry["deleted"] is False
    breakdown = _get(client, f"/api/runs/{run_id}/datasets")
    assert breakdown["dataset_count"] == 1 and breakdown["breakdown"] is False
    assert "metrics" not in breakdown["datasets"][0]


def test_breakdown_matches_oracle_and_weighted_mean(env):
    client, _, tickets, billing = env
    run_id = _make(client, tickets, billing, error_ids=["a-3", "b-2"])
    body = _get(client, f"/api/runs/{run_id}/datasets")
    assert body["breakdown"] is True and body["dataset_count"] == 2
    a, b = body["datasets"]
    assert (a["items"], a["errors"], a["completed"]) == (8, 1, 7)
    assert (b["items"], b["errors"], b["completed"]) == (5, 1, 4)
    # Oracle: an errored item counts as 0 for a maximise metric.
    exact_a = sum(_score(0, r, "exact_match") for r in IDS_A if r != "a-3") / 8
    exact_b = sum(_score(1, r, "exact_match") for r in IDS_B if r != "b-2") / 5
    assert a["metrics"]["exact_match"]["mean"] == pytest.approx(exact_a)
    assert b["metrics"]["exact_match"]["mean"] == pytest.approx(exact_b)
    assert a["metrics"]["exact_match"]["count"] == 8
    run = body["run"]
    assert run["items"] == 13 and run["errors"] == 2
    weighted = (
        a["metrics"]["judge"]["mean"] * a["metrics"]["judge"]["count"]
        + b["metrics"]["judge"]["mean"] * b["metrics"]["judge"]["count"]
    ) / (a["metrics"]["judge"]["count"] + b["metrics"]["judge"]["count"])
    assert run["metrics"]["judge"]["mean"] == pytest.approx(weighted, abs=1e-9)
    assert "unassigned" not in body


def test_unassigned_items_are_reported(env):
    client, _, tickets, billing = env
    run_id = _make(client, tickets, billing, tag=False)
    body = _get(client, f"/api/runs/{run_id}/datasets")
    assert body["unassigned"] == {"items": 13}
    assert [d["items"] for d in body["datasets"]] == [0, 0]
    assert body["run"]["items"] == 13
    assert body["datasets"][0]["metrics"]["exact_match"]["mean"] is None


def test_breakdown_unknown_run_is_404(env):
    client, *_ = env
    assert client.get("/api/runs/nope/datasets").status_code == 404


def test_deleted_dataset_keeps_entry_text(env):
    client, factory, tickets, billing = env
    run_id = _make(client, tickets, billing)
    from qym_platform.db.models import Dataset

    with factory() as session:
        session.get(Dataset, billing["id"]).deleted_at = __import__("datetime").datetime.utcnow()
        session.commit()
    run = _get(client, f"/api/runs/{run_id}?view=summary")["run"]
    second = run["datasets"][1]
    assert second["deleted"] is True and second["dataset_slug"] is None
    assert second["dataset"] == "billing-faq" and second["version"] == "v7"
    breakdown = _get(client, f"/api/runs/{run_id}/datasets")["datasets"][1]
    assert breakdown["deleted"] is True and breakdown["items"] == 5


def test_breakdown_statement_count_does_not_grow(database):
    factory = sessionmaker(bind=database, autoflush=False)
    counts = {}
    for size in (10, 200):
        ids = [f"i{n}" for n in range(size)]
        with factory() as session:
            if size == 10:
                seed_api_key(session)
            one = seed_dataset(session, f"one-{size}", {"v1": ids})
            two = seed_dataset(session, f"two-{size}", {"v1": ids})
        with app_client(factory) as client:
            run_id = post_union_run(
                client,
                [with_items(one, "v1"), with_items(two, "v1")],
                metrics=["m1", "m2", "m3"],
            )
            client.get(f"/api/runs/{run_id}/datasets")  # warm-up
            statements = []

            def count(conn, cursor, statement, *args):
                statements.append(statement)

            engine = database
            event.listen(engine, "before_cursor_execute", count)
            try:
                assert client.get(f"/api/runs/{run_id}/datasets").status_code == 200
            finally:
                event.remove(engine, "before_cursor_execute", count)
            counts[size] = len(statements)
    assert counts[10] == counts[200], counts


def _dashboard_rows(client, database, **filters):
    from test_dashboard_durable_summaries import drain

    drain(database, max_partitions=50)
    return client.post(
        "/api/dashboard/runs",
        json={"project_slug": "test", "limit": 50, "filters": filters, "include_overview": True},
    ).json()


def test_runs_list_rows_filter_and_facets(env, database):
    """QC-65 and QC-66: count and entries on the list rows, the filter matches a member, the facet lists names."""
    client, _, tickets, billing = env
    union = _make(client, tickets, billing, external_run_id="union")
    single = post_union_run(client, [with_items(tickets, "v3")], label="support-tickets", external_run_id="single")
    body = _dashboard_rows(client, database)
    rows = {r["run_id"]: r for r in body["rows"]}
    assert set(rows) == {union, single}
    assert rows[union]["dataset_count"] == 2
    assert rows[union]["datasets"] == [
        {"dataset": "support-tickets", "version": "v3"},
        {"dataset": "billing-faq", "version": "v7"},
    ]
    assert rows[single]["dataset_count"] == 1 and "datasets" not in rows[single]
    # Filtering by a member's value finds the single run on it and the union run that includes it.
    both = _dashboard_rows(client, database, datasets=["support-tickets␟v3"])
    assert {r["run_id"] for r in both["rows"]} == {union, single}
    only_billing = _dashboard_rows(client, database, datasets=["billing-faq␟v7"])
    assert [r["run_id"] for r in only_billing["rows"]] == [union]
    facets = body["overview"]["facets"]["datasets"]
    assert sorted(facets) == ["billing-faq␟v7", "support-tickets␟v3"]
    assert not any("+" in f for f in facets)  # never a label
