"""Review-stage checks for WP-C criteria that had no direct test (QC-26, QC-73 scope, QC-85)."""

from __future__ import annotations

import pytest
from _helpers import app_client
from _union_run import post_union_run, seed_api_key, seed_dataset, with_items
from sqlalchemy.orm import sessionmaker


@pytest.fixture(autouse=True)
def _auth_none(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")


@pytest.fixture()
def env(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as session:
        seed_api_key(session)
        tickets = seed_dataset(session, "support-tickets", {"v3": ["a-1", "a-2"]})
        billing = seed_dataset(session, "billing-faq", {"v7": ["b-1"]})
    with app_client(factory) as client:
        yield client, tickets, billing


def test_export_html_embeds_the_dataset_list_of_a_union_run(env):
    """QC-26: the offline export is built from the run payload, which lists every entry."""
    client, tickets, billing = env
    run_id = post_union_run(client, [with_items(tickets, "v3"), with_items(billing, "v7")])
    response = client.get(f"/api/runs/{run_id}/export-html")
    assert response.status_code == 200
    html = response.text
    assert '"dataset_count": 2' in html or '"dataset_count":2' in html
    assert "billing-faq" in html and "support-tickets" in html
    assert "datasetEntryLine" in html  # the header renders one plain-text line per entry


def test_single_run_export_has_no_union_header(env):
    client, tickets, _ = env
    run_id = post_union_run(client, [with_items(tickets, "v3")], label="support-tickets")
    html = client.get(f"/api/runs/{run_id}/export-html").text
    assert '"dataset_count": 1' in html or '"dataset_count":1' in html


def test_union_run_payload_keys_are_additive(env):
    """QC-85: a single run and a union run expose the same run keys."""
    client, tickets, billing = env
    union = post_union_run(client, [with_items(tickets, "v3"), with_items(billing, "v7")])
    single = post_union_run(client, [with_items(tickets, "v3")], label="support-tickets")
    keys = lambda rid: set(client.get(f"/api/runs/{rid}?view=summary").json()["run"])  # noqa: E731
    assert keys(union) == keys(single)


def test_runs_list_sorts_a_union_run_by_the_label_that_starts_with_its_first_entry(env, database):
    """QC-U35 / QC-65: sorting by the Dataset column uses Run.dataset, the label."""
    from test_dashboard_durable_summaries import drain

    client, tickets, billing = env
    union = post_union_run(client, [with_items(tickets, "v3"), with_items(billing, "v7")], external_run_id="u")
    single = post_union_run(client, [with_items(billing, "v7")], label="billing-faq", external_run_id="s")
    drain(database, max_partitions=50)

    def order(direction):
        body = client.post(
            "/api/dashboard/runs",
            json={"project_slug": "test", "limit": 50, "filters": {}, "sort": f"dataset-{direction}"},
        ).json()
        return [r["run_id"] for r in body["rows"]]

    assert order("asc") == [single, union]
    assert order("desc") == [union, single]
