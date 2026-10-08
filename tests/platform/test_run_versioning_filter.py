"""Filtering runs and experiments on the Evaluation Service's ``versioning_metadata``.

Any key is filterable (``services/run_versioning.py``): values of one key are
alternatives, different keys must all match, ``__empty__`` matches runs without
the key. Rows live in ``dashboard_run_versions``, kept by the projection worker.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.api import experiments as experiments_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.dashboard_models import DashboardRunDimension as Dimension
from qym_platform.db.dashboard_models import DashboardRunVersion as RunVersion
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    RunOrigin,
    RunWorkflowStatus,
    User,
)
from qym_platform.deps import get_db
from qym_platform.services import dashboard_summaries as service
from qym_platform.services.run_versioning import (
    MAX_KEYS,
    normalize_versioning,
    parse_versioning_filter,
    parse_versioning_params,
)
from test_dashboard_durable_summaries import drain, item, run

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)

# run id -> (experiment, stored remote_versioning, legacy remote_result, started day)
RUNS = {
    "a": ("first", {"agent_version": "v1", "kb_version": "381"}, None, 1),
    "b": (
        "first",
        {"agent_version": "v2", "kb_version": "381", "prompt_version": "p7"},
        None,
        2,
    ),
    # Finished before remote_versioning was stored: read from the result.
    "c": ("second", None, {"agent_version": "v1", "kb_version": "400"}, 3),
}


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
        experiments = {}
        for name in ("first", "second", "pending"):
            experiments[name] = EvalExperiment(
                project_id="p",
                created_by_user_id="u",
                name=name,
                environment_ids=[env.id],
                job_count=1,
            )
            db.add(experiments[name])
        db.flush()
        jobs = {}
        for index, (run_id, (experiment, stored, result, day)) in enumerate(
            {**RUNS, "d": ("pending", None, None, 4)}.items()
        ):
            job = EvalExperimentJob(
                experiment_id=experiments[experiment].id,
                environment_id=env.id,
                combo_index=index,
                schema_id=schema.id,
                params={},
                request_body={},
                launch_token_hash=str(index) * 64,
                remote_versioning=stored,
                remote_result=result,
                remote_status="SUCCEEDED" if stored or result else None,
            )
            db.add(job)
            db.flush()
            jobs[run_id] = job.id
            run(
                db,
                run_id=run_id,
                status=RunWorkflowStatus.COMPLETED,
                origin=RunOrigin.OFFICIAL,
                experiment_job_id=job.id,
                started_at=datetime(2026, 9, day, 12),
            )
            job.run_id = run_id
            item(db, run_id=run_id)
        run(db, run_id="local", status=RunWorkflowStatus.COMPLETED)
        item(db, run_id="local")
        db.commit()
        return {name: x.id for name, x in experiments.items()}, jobs


@pytest.fixture
def client(database):  # noqa: F811
    app = FastAPI()
    app.include_router(dashboard.router)
    app.include_router(runs_api.router)
    app.include_router(experiments_api.router)

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


def _dashboard(client, endpoint, filters):
    return client.post(
        f"/api/dashboard/{endpoint}",
        json={"project_slug": "test", "filters": filters},
    )


def _run_ids(client, versioning):
    response = _dashboard(client, "runs", {"versioning": versioning})
    assert response.status_code == 200, response.text
    return sorted(row["run_id"] for row in response.json()["rows"])


def _api_runs(client, *versioning):
    response = client.get(
        "/api/runs",
        params=[("project_slug", "test")] + [("versioning", v) for v in versioning],
    )
    assert response.status_code == 200, response.text
    return sorted(
        row["run_id"]
        for models in response.json()["tasks"].values()
        for group in models.values()
        for row in group
    )


def test_normalize_versioning():
    assert normalize_versioning(None) == {}
    assert normalize_versioning(["agent_version"]) == {}
    assert normalize_versioning(
        {
            "agent_version": " v1.12 ",
            "kb_version": 381,
            "ratio": 0.5,
            "stable": True,
            "nested": {"b": 1, "a": [2]},
            "missing": None,
            "blank": "  ",
            " ": "no key",
            "long": "x" * 501,
        }
    ) == {
        "agent_version": "v1.12",
        "kb_version": "381",
        "ratio": "0.5",
        "stable": "true",
        "nested": '{"a":[2],"b":1}',
    }
    many = normalize_versioning({f"k{i:03d}": "v" for i in range(MAX_KEYS + 5)})
    assert list(many) == [f"k{i:03d}" for i in range(MAX_KEYS)]


def test_parse_versioning_params_and_filter():
    assert parse_versioning_params(None) == {}
    assert parse_versioning_params(
        ["agent_version=v1", "kb_version=a=b", "agent_version=v2", "agent_version=v1"]
    ) == {"agent_version": ["v1", "v2"], "kb_version": ["a=b"]}
    for bad in (["agent_version"], ["=v1"]):
        with pytest.raises(ValueError):
            parse_versioning_params(bad)
    assert parse_versioning_filter({"agent_version": []}) == {}
    for bad in (
        ["agent_version"],
        {"agent_version": "v1"},
        {"agent_version": [1]},
        {"k" * 101: ["v1"]},
        {f"k{i}": ["v"] for i in range(33)},
    ):
        with pytest.raises(ValueError):
            parse_versioning_filter(bad)


def test_projection_stores_any_versioning_key(database):  # noqa: F811
    _seed(database)
    drain(database)
    with Session(database) as db:
        assert db.get(Dimension, "b").descriptor["versioning"] == {
            "agent_version": "v2",
            "kb_version": "381",
            "prompt_version": "p7",
        }
        # The legacy flat keys of an older result are read the same way.
        assert db.get(Dimension, "c").descriptor["versioning"] == {
            "agent_version": "v1",
            "kb_version": "400",
        }
        assert db.get(Dimension, "local").descriptor["versioning"] == {}
        rows = db.execute(
            select(RunVersion.run_key, RunVersion.key, RunVersion.value).order_by(
                RunVersion.run_key, RunVersion.key
            )
        ).all()
    assert [tuple(row) for row in rows] == [
        ("a", "agent_version", "v1"),
        ("a", "kb_version", "381"),
        ("b", "agent_version", "v2"),
        ("b", "kb_version", "381"),
        ("b", "prompt_version", "p7"),
        ("c", "agent_version", "v1"),
        ("c", "kb_version", "400"),
    ]


def test_dashboard_versioning_filter(database, client):  # noqa: F811
    _seed(database)
    drain(database)
    assert _run_ids(client, {"agent_version": ["v1"]}) == ["a", "c"]
    assert _run_ids(client, {"agent_version": ["v1", "v2"]}) == ["a", "b", "c"]
    # Keys must all match.
    assert _run_ids(client, {"agent_version": ["v1"], "kb_version": ["381"]}) == ["a"]
    # A key no hard-coded list knows about.
    assert _run_ids(client, {"prompt_version": ["p7"]}) == ["b"]
    assert _run_ids(client, {"prompt_version": ["__empty__"]}) == [
        "a",
        "c",
        "d",
        "local",
    ]
    assert _run_ids(client, {"agent_version": ["v1", "__empty__"]}) == [
        "a",
        "c",
        "d",
        "local",
    ]
    assert _run_ids(client, {"agent_version": ["__none__"]}) == []
    assert _run_ids(client, {"agent_version": ["v9"]}) == []
    # Composes with the other facets.
    page = _dashboard(
        client,
        "runs",
        {"origins": ["official"], "versioning": {"kb_version": ["381"]}},
    ).json()
    assert page["total_runs"] == 2 and page["total_count"] == 5

    models = client.post(
        "/api/dashboard/models",
        json={
            "project_slug": "test",
            "filters": {"versioning": {"agent_version": ["v1"]}},
        },
    ).json()
    assert sum(model["total_runs"] for model in models["models"]) == 2

    for bad in (
        {"versioning": ["agent_version"]},
        {"versioning": {"agent_version": "v1"}},
        {"versioning": {"agent_version": [1]}},
    ):
        assert _dashboard(client, "runs", bad).status_code == 400


def test_dashboard_versioning_facets(database, client):  # noqa: F811
    _seed(database)
    drain(database)
    facets = _dashboard(client, "overview", {}).json()["facets"]["versioning"]
    # Newest value first; __empty__ when some listed run lacks the key.
    assert facets == {
        "agent_version": ["v1", "v2", "__empty__"],
        "kb_version": ["400", "381", "__empty__"],
        "prompt_version": ["p7", "__empty__"],
    }
    facets = _dashboard(
        client, "overview", {"versioning": {"agent_version": ["v2"]}}
    ).json()["facets"]["versioning"]
    # A key's own selection doesn't narrow its values; it narrows the others.
    assert facets == {
        "agent_version": ["v1", "v2", "__empty__"],
        "kb_version": ["381"],
        "prompt_version": ["p7"],
    }
    facets = _dashboard(client, "overview", {"origins": ["local"]}).json()["facets"]
    assert facets["versioning"] == {}
    assert _dashboard(
        client, "overview", {"versioning": {"kb_version": ["400"]}}
    ).json()["facets"]["origins"] == ["official"]


def test_versioning_reported_after_publication_is_republished(
    database, client
):  # noqa: F811
    _, jobs = _seed(database)
    drain(database)
    assert _run_ids(client, {"agent_version": ["v3"]}) == []
    with Session(database) as db:
        job = db.get(EvalExperimentJob, jobs["d"])
        job.remote_status = "SUCCEEDED"
        job.remote_versioning = {"agent_version": "v3", "eval_suite": "s1"}
        db.commit()
    drain(database)
    assert _run_ids(client, {"agent_version": ["v3"]}) == ["d"]
    assert _run_ids(client, {"eval_suite": ["s1"]}) == ["d"]
    with Session(database) as db:
        db.get(EvalExperimentJob, jobs["d"]).remote_versioning = {"agent_version": "v4"}
        db.commit()
    drain(database)
    assert _run_ids(client, {"agent_version": ["v4"]}) == ["d"]
    assert _run_ids(client, {"eval_suite": ["s1"]}) == []


def test_descriptor_without_versioning_is_requeued(database, client):  # noqa: F811
    _seed(database)
    drain(database)
    with Session(database) as db:
        for run_id in ("a", "local"):
            dimension = db.get(Dimension, run_id)
            stale = dict(dimension.descriptor)
            stale.pop("versioning")
            dimension.descriptor = stale
        for row in db.scalars(select(RunVersion).where(RunVersion.run_key == "a")):
            db.delete(row)
        db.commit()
    assert _run_ids(client, {"agent_version": ["v1"]}) == ["c"]
    with Session(database) as db:
        # Local runs have no job: only the linked run is requeued.
        assert service.reconcile_summary_shapes(db) == 1
        assert db.get(Partition, "a").queue_state == "pending"
        assert db.get(Partition, "local").queue_state == "ready"
        db.commit()
    drain(database)
    assert _run_ids(client, {"agent_version": ["v1"]}) == ["a", "c"]


@pytest.mark.parametrize("published", [False, True])
def test_api_runs_versioning_filter(database, client, published):  # noqa: F811
    _seed(database)
    if published:
        drain(database)
    else:
        # Before publication the listing builds rows from source; filtering
        # needs the version rows the worker writes with the pending dimension.
        with Session(database, autoflush=False) as db:
            db.info["dashboard_projection_worker"] = True
            for run_id in ("a", "b", "c", "d", "local"):
                service.ensure_pending_summary(db, run_id, 0)
            db.commit()
    assert _api_runs(client) == ["a", "b", "c", "d", "local"]
    assert _api_runs(client, "agent_version=v1") == ["a", "c"]
    assert _api_runs(client, "agent_version=v1", "kb_version=381") == ["a"]
    assert _api_runs(client, "agent_version=v1", "agent_version=v2") == ["a", "b", "c"]
    assert _api_runs(client, "prompt_version=__empty__") == ["a", "c", "d", "local"]
    response = client.get(
        "/api/runs", params={"project_slug": "test", "versioning": "agent_version"}
    )
    assert response.status_code == 400
    assert "key=value" in response.json()["detail"]
    rows = client.get("/api/runs", params={"project_slug": "test"}).json()["tasks"]
    by_id = {
        row["run_id"]: row
        for models in rows.values()
        for group in models.values()
        for row in group
    }
    assert by_id["c"]["versioning"] == {"agent_version": "v1", "kb_version": "400"}
    assert by_id["local"]["versioning"] == {}


def test_api_runs_versioning_direct_call_defaults(database):  # noqa: F811
    _seed(database)
    drain(database)
    with Session(database) as db:
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
            origin=None,
            db=db,
            principal=Principal(user=db.get(User, "u"), auth_type="none"),
        )
    assert response["total_count"] == 5
    with Session(database) as db, pytest.raises(HTTPException):
        runs_api.legacy_list_runs(
            limit=100,
            offset=0,
            project_slug="test",
            status=None,
            exclude_live=False,
            include_total=True,
            user=None,
            user_id=None,
            owner_user_id=None,
            origin=None,
            versioning=["bad"],
            db=db,
            principal=Principal(user=db.get(User, "u"), auth_type="none"),
        )


def test_experiments_versioning_filter_and_facets(database, client):  # noqa: F811
    experiments, _ = _seed(database)
    drain(database)
    path = "/v1/projects/p/experiments"

    def names(*versioning, **params):
        response = client.get(
            path, params=[("versioning", v) for v in versioning] + list(params.items())
        )
        assert response.status_code == 200, response.text
        return sorted(x["name"] for x in response.json()["experiments"])

    assert names() == ["first", "pending", "second"]
    assert names("agent_version=v1") == ["first", "second"]
    assert names("kb_version=381") == ["first"]
    assert names("prompt_version=p7") == ["first"]
    # Keys must match on the same job's run: "first" has v2 and 400 on no job.
    assert names("agent_version=v2", "kb_version=400") == []
    assert names("agent_version=__empty__") == ["pending"]
    assert client.get(path, params={"versioning": "nope"}).status_code == 400

    plain = client.get(path).json()
    assert "versioning_facets" not in plain
    facets = client.get(path, params={"include_versioning_facets": "true"}).json()
    assert facets["versioning_facets"] == {
        "agent_version": ["v1", "v2"],
        "kb_version": ["400", "381"],
        "prompt_version": ["p7"],
    }


def test_versioning_filter_static_contract():
    source = (STATIC / "dashboard.js").read_text()
    assert "filters.versioning = versioningFilters();" in source
    assert "facets?.versioning" in source
    assert "filterVersioning:" in source
    for page in ("index.html", "charts.html", "models.html"):
        markup = (STATIC / page).read_text()
        assert 'id="versioning-filters"' in markup, page
    experiments = (STATIC / "experiments.js").read_text()
    assert "include_versioning_facets" in experiments
    assert (
        "params.append('versioning', key + '=' + state.versioning[key])" in experiments
    )
