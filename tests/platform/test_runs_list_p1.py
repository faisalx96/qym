"""Runs list API: search by name, cheap pages on large catalogs, and review
actions that reach the list at once (C060, C037, C040)."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import Approval, RunWorkflowStatus, User
from qym_platform.deps import get_db
from test_dashboard_durable_summaries import Dimension, Summary, drain, run
from test_dashboard_projection_api import dataset, get, seed  # noqa: F401


def _ids(response):
    return [row["run_id"] for row in response.json()["rows"]]


# C060: find a run by name ------------------------------------------------------


def test_search_matches_shown_name_run_name_and_id_prefix(dataset):  # noqa: F811
    engine, client, _ = dataset
    seed(engine, count=30)
    with Session(engine) as db:
        dimension = db.get(Dimension, "run-0007")
        dimension.descriptor = {
            **dimension.descriptor,
            "external_run_id": "baseline-Qwen3.5-0818",
        }
        db.commit()

    # The name the list shows (external id), case-insensitive substring.
    assert _ids(get(client, filters={"q": "qwen3.5"})) == ["run-0007"]
    # The run name.
    assert set(_ids(get(client, filters={"q": "Run 2"}))) == {
        "run-0002",
        *{f"run-00{n}" for n in range(20, 30)},
    }
    # A run id prefix, not any substring of it.
    assert _ids(get(client, filters={"q": "RUN-0011"})) == ["run-0011"]
    assert _ids(get(client, filters={"q": "0011"})) == []
    # Blank text is no search; LIKE wildcards are literal.
    assert get(client, filters={"q": "   "}).json()["total_runs"] == 30
    assert get(client, filters={"q": "%"}).json()["total_runs"] == 0
    assert get(client, filters={"q": "run_"}).json()["total_runs"] == 0


def test_search_scopes_counts_facets_and_kpis(dataset):  # noqa: F811
    engine, client, _ = dataset
    seed(engine, count=12)
    page = get(client, filters={"q": "Run 1"}, include_overview="true").json()
    # Run 1, Run 10, Run 11.
    assert page["total_runs"] == 3 and page["total_count"] == 12
    overview = page["overview"]
    assert overview["total_runs"] == 3
    assert overview["kpis"]["runs"] == 3 and overview["kpis"]["scope"] == "filtered"
    assert overview["facets"]["tasks"] == ["task-a", "task-b"]
    only_a = get(client, filters={"q": "Run 1", "tasks": ["task-a"]}).json()
    assert _ids_from(only_a) == ["run-0010"]


def _ids_from(payload):
    return [row["run_id"] for row in payload["rows"]]


@pytest.mark.parametrize("value", [123, "x" * 201, ["Run"]])
def test_invalid_search_is_rejected(dataset, value):  # noqa: F811
    _, client, _ = dataset
    assert get(client, filters={"q": value}).status_code == 400


# C037: page cost does not grow with metrics or project size ------------------


def _statements(engine, call):
    statements = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        call()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return statements


def _add_metrics(engine, count):
    with Session(engine) as db:
        for summary in db.query(Summary).all():
            index = int(summary.run_key.rsplit("-", 1)[1])
            summary.data = {
                **summary.data,
                "metric_averages": {
                    f"metric_{n}": ((index * (n + 3)) % 7) / 7 for n in range(count)
                },
            }
        db.commit()


def test_page_reads_neighbours_in_one_query_whatever_the_metric_count(
    dataset,
):  # noqa: F811
    engine, client, _ = dataset
    seed(engine, count=40)
    _add_metrics(engine, 2)
    two = _statements(engine, lambda: get(client, limit=20, sort="time-asc"))
    dashboard._page_cache._entries.clear()
    _add_metrics(engine, 9)
    nine = _statements(engine, lambda: get(client, limit=20, sort="time-asc"))
    assert len(nine) == len(two)
    # One read of the projection revision per request, however many caches
    # the request consults.
    assert sum("dashboard_partition_state" in sql for sql in nine) == 1
    # Group order comes from window maxima, not GROUP BY joins.
    page_sql = [sql for sql in nine if "ORDER BY" in sql and "LIMIT" in sql]
    assert page_sql and not any("GROUP BY" in sql for sql in page_sql)


def test_neighbours_match_adjacent_distinct_means_in_the_group(dataset):  # noqa: F811
    engine, client, _ = dataset
    seed(engine, count=48)
    _add_metrics(engine, 3)
    rows = get(client, limit=48).json()["rows"]
    groups = {}
    for row in rows:
        key = (row["task_name"], row["model_key"], row["dataset_name"])
        for metric, value in row["metric_averages"].items():
            groups.setdefault((key, metric), set()).add(value)
    for row in rows:
        key = (row["task_name"], row["model_key"], row["dataset_name"])
        for metric, value in row["metric_averages"].items():
            values = sorted(groups[(key, metric)])
            index = values.index(value)
            expected = [
                values[index - 1] if index else None,
                values[index + 1] if index + 1 < len(values) else None,
            ]
            assert row["metric_neighbor_values"][metric] == expected


def test_snapshot_caches_rely_on_the_revision_not_a_short_ttl():
    for cache in (
        dashboard._page_cache,
        dashboard._overview_cache,
        dashboard._catalog_cache,
        dashboard._kpi_cache,
    ):
        assert cache.ttl >= 300


# C040: review actions reach the list without waiting for the worker -----------


@pytest.fixture
def review_client(database):  # noqa: F811
    app = FastAPI()
    app.include_router(runs_api.router)
    app.include_router(dashboard.router)
    with Session(database) as db:
        user = db.get(User, "u")
        _ = user.id, user.role, user.email
        db.expunge(user)
    principal = Principal(user=user, auth_type="local_password")

    def get_session():
        with Session(database) as db:
            yield db

    app.dependency_overrides[get_db] = get_session
    app.dependency_overrides[require_ui_principal] = lambda: principal
    with TestClient(app) as client:
        yield database, client


def _listed(client):
    response = client.post(
        "/api/dashboard/runs", json={"project_slug": "test", "limit": 50}
    )
    assert response.status_code == 200
    return {row["run_id"]: row for row in response.json()["rows"]}


def _status_facet(client, status):
    response = client.post(
        "/api/dashboard/runs",
        json={"project_slug": "test", "limit": 50, "filters": {"statuses": [status]}},
    )
    return response.json()["total_runs"]


def test_review_actions_show_in_the_list_before_the_worker_runs(review_client):
    engine, client = review_client
    with Session(engine) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        db.commit()
    drain(engine)
    # Warm the page cache with the old status.
    assert _listed(client)["r"]["status"] == "COMPLETED"

    assert client.post("/v1/runs/r/submit").json()["status"] == "SUBMITTED"
    row = _listed(client)["r"]
    assert row["status"] == "SUBMITTED"
    assert _status_facet(client, "SUBMITTED") == 1

    assert (
        client.post("/v1/runs/r/approve", json={"comment": "ship it"}).status_code
        == 200
    )
    row = _listed(client)["r"]
    assert row["status"] == "APPROVED"
    assert row["approval"]["decision"] == "APPROVED"
    assert row["approval"]["comment"] == "ship it"
    assert row["approval"]["decision_by"]["id"] == "u"

    assert client.post("/v1/runs/r/unapprove", json={}).status_code == 200
    assert _listed(client)["r"]["status"] == "COMPLETED"

    # The worker later publishes the same values.
    drain(engine)
    with Session(engine) as db:
        assert db.get(Dimension, "r").status == "COMPLETED"
        assert db.get(Dimension, "r").descriptor["approval"]["decision"] == "APPROVED"
        assert db.query(Approval).count() == 1


def test_bulk_submit_shows_in_the_list_before_the_worker_runs(review_client):
    """POST /v1/runs/submit (C061) publishes each run's new status at once,
    like the single-run submit (C040)."""
    engine, client = review_client
    with Session(engine) as db:
        run(db, "r", status=RunWorkflowStatus.COMPLETED)
        run(db, "r2", status=RunWorkflowStatus.COMPLETED)
        db.commit()
    drain(engine)
    listed = _listed(client)
    assert listed["r"]["status"] == listed["r2"]["status"] == "COMPLETED"

    response = client.post("/v1/runs/submit", json={"run_ids": ["r", "r2"]})
    assert response.status_code == 200, response.text
    listed = _listed(client)
    assert listed["r"]["status"] == listed["r2"]["status"] == "SUBMITTED"
    assert _status_facet(client, "SUBMITTED") == 2


def test_a_stale_second_submit_explains_itself(review_client):
    engine, client = review_client
    with Session(engine) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        db.commit()
    drain(engine)
    assert client.post("/v1/runs/r/submit").status_code == 200
    second = client.post("/v1/runs/r/submit")
    assert second.status_code == 409
    assert "submitted" in json.dumps(second.json()).lower()


def test_review_actions_and_deletes_keep_a_pending_run_pending(review_client):
    """A run whose summary is not published yet (backfill, or just finished)
    shows a review action or a delete at once, but stays pending: bumping its
    revision would list it as published with no numbers."""
    from qym_platform.services.dashboard_summaries import ensure_pending_summary

    engine, client = review_client
    with Session(engine) as db:
        run(db, "published", status=RunWorkflowStatus.COMPLETED)
        db.commit()
    drain(engine)
    with Session(engine) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        db.commit()
    with Session(engine) as db:
        ensure_pending_summary(db, "r", 1)
        db.commit()

    def unpublished():
        response = client.post("/api/dashboard/runs", json={"project_slug": "test"})
        return response.json()["freshness"]["unpublished_runs"]

    # Warm the page cache (a published run makes the catalog cacheable).
    assert _listed(client)["r"]["summary_state"] == "pending"
    assert unpublished() == 1

    assert client.post("/v1/runs/r/submit").status_code == 200
    row = _listed(client)["r"]
    assert (row["status"], row["summary_state"]) == ("SUBMITTED", "pending")
    assert unpublished() == 1
    with Session(engine) as db:
        assert db.get(Summary, "r").projection_revision == 0

    assert client.post("/api/runs/delete", json={"file_path": "r"}).status_code == 200
    assert "r" not in _listed(client)
    assert client.post("/api/runs/restore", json={"run_id": "r"}).status_code == 200
    row = _listed(client)["r"]
    assert (row["status"], row["summary_state"]) == ("SUBMITTED", "pending")
    with Session(engine) as db:
        assert db.get(Summary, "r").projection_revision == 0

    # The worker publishes the real numbers later.
    drain(engine)
    row = _listed(client)["r"]
    assert (row["status"], row["summary_state"]) == ("SUBMITTED", "published")
