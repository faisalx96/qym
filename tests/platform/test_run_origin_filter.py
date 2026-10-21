"""Origin facet (official / local / all) across /api/runs and the dashboard projection.

Plan §11: a run is official only when ingest verified its launch token; listings
expose ``origin`` plus an ``experiment`` reference, and ``origin`` is a filter.
"""

from __future__ import annotations


import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.dashboard_models import DashboardRunDimension as Dimension
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    Run,
    RunOrigin,
    RunWorkflowStatus,
    User,
)
from qym_platform.deps import get_db
from qym_platform.services import dashboard_summaries as service
from qym_platform.services.run_origin import parse_origin_filter
from test_dashboard_durable_summaries import drain, item, run


def _seed(engine):
    with Session(engine) as db:
        env = EvalEnvironment(
            project_id="p", name="staging", base_url="https://staging.example"
        )
        db.add(env)
        db.flush()
        schema = EvalEnvironmentSchema(
            environment_id=env.id, schema_hash="h1", schema_json={}
        )
        db.add(schema)
        db.flush()
        experiment = EvalExperiment(
            project_id="p",
            created_by_user_id="u",
            name="Sweep <b>temps</b>",
            environment_ids=[env.id],
            job_count=1,
        )
        db.add(experiment)
        db.flush()
        job = EvalExperimentJob(
            experiment_id=experiment.id,
            environment_id=env.id,
            combo_index=0,
            schema_id=schema.id,
            params={},
            request_body={},
            launch_token_hash="0" * 64,
        )
        db.add(job)
        db.flush()
        run(
            db,
            run_id="official",
            status=RunWorkflowStatus.COMPLETED,
            origin=RunOrigin.OFFICIAL,
            experiment_job_id=job.id,
        )
        item(db, run_id="official")
        for run_id in ("local-1", "local-2"):
            run(db, run_id=run_id, status=RunWorkflowStatus.COMPLETED)
            item(db, run_id=run_id)
        db.commit()
        return experiment.id


def _list(engine, **kwargs):
    with Session(engine) as db:
        response = runs_api.legacy_list_runs(
            limit=100,
            offset=0,
            project_slug="test",
            status=None,
            exclude_live=False,
            include_total=True,
            user=None,
            user_id=None,
            owner_user_id=None,
            db=db,
            principal=Principal(user=db.get(User, "u"), auth_type="none"),
            **kwargs,
        )
    return response


def _rows(response):
    return {
        row["run_id"]: row
        for models in response["tasks"].values()
        for group in models.values()
        for row in group
    }


@pytest.fixture
def client(database):  # noqa: F811
    app = FastAPI()
    app.include_router(dashboard.router)
    app.include_router(runs_api.router)

    def get_session():
        with Session(database) as db:
            yield db

    with Session(database) as db:
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        db.expunge(principal.user)
    app.dependency_overrides[get_db] = get_session
    app.dependency_overrides[require_ui_principal] = lambda: principal
    with TestClient(app) as test_client:
        yield test_client


def test_parse_origin_filter():
    assert parse_origin_filter(None) is None
    assert parse_origin_filter("") is None
    assert parse_origin_filter("All") is None
    assert parse_origin_filter(" official ") is RunOrigin.OFFICIAL
    assert parse_origin_filter("LOCAL") is RunOrigin.LOCAL
    with pytest.raises(ValueError):
        parse_origin_filter("verified")


@pytest.mark.parametrize("published", [False, True])
def test_api_runs_origin_filter(database, published):  # noqa: F811
    experiment_id = _seed(database)
    if published:
        drain(database)
    everything = _rows(_list(database))
    assert set(everything) == {"official", "local-1", "local-2"}
    assert _rows(_list(database, origin="all")).keys() == everything.keys()

    official = _list(database, origin="official")
    assert official["total_count"] == 1
    row = _rows(official)["official"]
    assert row["origin"] == "official"
    assert row["experiment"]["id"] == experiment_id
    assert row["experiment"]["name"] == "Sweep <b>temps</b>"

    local = _list(database, origin="local")
    assert local["total_count"] == 2
    assert {r["origin"] for r in _rows(local).values()} == {"local"}
    assert all(r["experiment"] is None for r in _rows(local).values())

    with pytest.raises(HTTPException) as exc:
        _list(database, origin="bogus")
    assert exc.value.status_code == 400


def test_api_runs_origin_http_and_experiment_lookup_is_batched(database, client):  # noqa: F811
    _seed(database)
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        response = client.get("/api/runs", params={"project_slug": "test"})
    finally:
        event.remove(database, "before_cursor_execute", capture)
    assert response.status_code == 200
    # One join resolves every page row's experiment (no per-run lookups).
    assert sum("eval_experiment_jobs" in sql for sql in statements) == 1

    assert client.get(
        "/api/runs", params={"project_slug": "test", "origin": "official"}
    ).json()["total_count"] == 1
    bad = client.get("/api/runs", params={"project_slug": "test", "origin": "x"})
    assert bad.status_code == 400
    assert "origin" in bad.json()["detail"].lower()


def _dashboard(client, endpoint, filters):
    return client.post(
        f"/api/dashboard/{endpoint}",
        json={"project_slug": "test", "filters": filters},
    )


def test_dashboard_projection_origin_filter(database, client):  # noqa: F811
    experiment_id = _seed(database)
    drain(database)
    with Session(database) as db:
        descriptor = db.get(Dimension, "official").descriptor
    assert descriptor["origin"] == "official"
    assert descriptor["experiment"]["id"] == experiment_id

    page = _dashboard(client, "runs", {"origins": ["official"]}).json()
    assert [row["run_id"] for row in page["rows"]] == ["official"]
    assert page["rows"][0]["experiment"]["id"] == experiment_id
    assert page["total_runs"] == 1 and page["total_count"] == 3

    page = _dashboard(client, "runs", {"origins": ["local"]}).json()
    assert sorted(row["run_id"] for row in page["rows"]) == ["local-1", "local-2"]
    assert _dashboard(client, "runs", {}).json()["total_runs"] == 3

    overview = _dashboard(client, "overview", {"origins": ["official"]}).json()
    assert overview["total_runs"] == 1
    assert overview["facets"]["origins"] == ["local", "official"]

    models = client.post(
        "/api/dashboard/models",
        json={"project_slug": "test", "filters": {"origins": ["local"]}},
    ).json()
    assert sum(model["total_runs"] for model in models["models"]) == 2

    assert _dashboard(client, "runs", {"origins": ["verified"]}).status_code == 400
    assert _dashboard(client, "runs", {"origins": "official"}).status_code == 400


def test_descriptor_without_origin_counts_as_local_and_is_requeued(database, client):  # noqa: F811
    _seed(database)
    drain(database)
    with Session(database) as db:
        for run_id in ("official", "local-1"):
            dimension = db.get(Dimension, run_id)
            stale = dict(dimension.descriptor)
            stale.pop("origin")
            stale.pop("experiment")
            dimension.descriptor = stale
        db.commit()
    # Pre-origin descriptors read as local until the worker republishes them.
    page = _dashboard(client, "runs", {"origins": ["local"]}).json()
    assert page["total_runs"] == 3
    with Session(database) as db:
        # Only the official run is stale enough to requeue.
        assert service.reconcile_summary_shapes(db) == 1
        assert db.get(Partition, "official").queue_state == "pending"
        assert db.get(Partition, "local-1").queue_state == "ready"
        db.commit()
    drain(database)
    page = _dashboard(client, "runs", {"origins": ["official"]}).json()
    assert [row["run_id"] for row in page["rows"]] == ["official"]


# ── experiment.latency_sensitive (QA3-1, QA3-3, QA3-9) ─────────────────────


def _flag_experiment(engine, experiment_id, value=True):
    with Session(engine) as db:
        db.get(EvalExperiment, experiment_id).latency_sensitive = value
        db.commit()


@pytest.mark.parametrize("flagged", [False, True])
@pytest.mark.parametrize("published", [False, True])
def test_runs_list_experiment_ref_carries_latency_sensitive(
    database, flagged, published
):  # noqa: F811
    experiment_id = _seed(database)
    _flag_experiment(database, experiment_id, flagged)
    if published:
        drain(database)
    rows = _rows(_list(database))
    experiment = rows["official"]["experiment"]
    assert experiment["latency_sensitive"] is flagged
    assert set(experiment) == {"id", "name", "job_id", "latency_sensitive"}
    assert rows["local-1"]["experiment"] is None


def test_descriptor_without_latency_sensitive_is_requeued_and_republished(
    database, client
):  # noqa: F811
    experiment_id = _seed(database)
    _flag_experiment(database, experiment_id, True)
    drain(database)
    with Session(database) as db:
        dimension = db.get(Dimension, "official")
        assert dimension.descriptor["experiment"]["latency_sensitive"] is True
        stale = dict(dimension.descriptor)
        stale["experiment"] = {
            k: v for k, v in stale["experiment"].items() if k != "latency_sensitive"
        }
        dimension.descriptor = stale
        db.commit()
    # Until republished the field is absent (the UI reads absent as false).
    page = _dashboard(client, "runs", {"origins": ["official"]}).json()
    assert "latency_sensitive" not in page["rows"][0]["experiment"]
    with Session(database) as db:
        assert service._descriptor_origin_stale(
            db.get(Run, "official"), db.get(Dimension, "official")
        )
        assert service.reconcile_summary_shapes(db) == 1
        db.commit()
    drain(database)
    page = _dashboard(client, "runs", {"origins": ["official"]}).json()
    assert page["rows"][0]["experiment"]["latency_sensitive"] is True
    with Session(database) as db:
        assert service.reconcile_summary_shapes(db) == 0
