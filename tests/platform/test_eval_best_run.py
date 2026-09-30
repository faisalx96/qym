"""Best-run ranking service + API (plan §10.2, §5.1; issue #37)."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Dataset,
    DatasetAlias,
    DatasetVersion,
    DatasetVersionStatus,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    EvalRunScore,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunOrigin,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.services.eval_best_run import rank_best_runs

T0 = datetime(2026, 9, 30, 12, 0, 0)
NOW = T0 + timedelta(hours=2)
P1 = "project-1"
MEMBER = "member@example.com"
OUTSIDER = "outsider@example.com"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )


@pytest.fixture()
def sessions():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def seed(sessions):
    """Project + members, two environments, a dataset with three versions."""
    with sessions() as db:
        db.add_all(
            [
                User(id="creator", email="creator@example.com", role=UserRole.MEMBER),
                User(id="member", email=MEMBER, role=UserRole.MEMBER),
                User(id="outsider", email=OUTSIDER, role=UserRole.MEMBER),
            ]
        )
        db.flush()
        db.add_all(
            [
                Project(id=P1, name="One", slug="p1", created_by_user_id="creator"),
                Project(
                    id="project-2", name="Two", slug="p2", created_by_user_id="creator"
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id=P1, user_id="creator", role=ProjectRole.MANAGER
                ),
                ProjectMembership(
                    project_id=P1, user_id="member", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id="project-2", user_id="outsider", role=ProjectRole.MANAGER
                ),
            ]
        )
        env = EvalEnvironment(
            id="env-a", project_id=P1, name="staging", base_url="https://a.example"
        )
        other_env = EvalEnvironment(
            id="env-b", project_id=P1, name="prod", base_url="https://b.example"
        )
        dataset = Dataset(
            id="ds-1",
            project_id=P1,
            name="Golden",
            slug="golden",
            created_by_user_id="creator",
        )
        db.add_all([env, other_env, dataset])
        db.flush()
        versions = [
            DatasetVersion(
                id=f"dv-{n}",
                dataset_id=dataset.id,
                version=f"v{n}",
                status=DatasetVersionStatus.PUBLISHED,
                created_by_user_id="creator",
                created_at=T0 + timedelta(days=n),
                published_at=T0 + timedelta(days=n),
            )
            for n in (1, 2, 3)
        ]
        db.add_all(versions)
        db.add_all(
            [
                EvalEnvironmentSchema(
                    id="schema-a",
                    environment_id="env-a",
                    schema_hash="h",
                    schema_json={},
                ),
                EvalEnvironmentSchema(
                    id="schema-b",
                    environment_id="env-b",
                    schema_hash="h",
                    schema_json={},
                ),
            ]
        )
        db.flush()
        db.add(
            EvalExperiment(
                id="exp-1",
                project_id=P1,
                created_by_user_id="creator",
                name="exp",
                environment_ids=["env-a", "env-b"],
                job_count=1,
            )
        )
        db.commit()


_COMBO = {"n": 0}


def _run(
    sessions,
    *,
    mean,
    metric="accuracy",
    direction="maximize",
    version="dv-1",
    env_id="env-a",
    origin=RunOrigin.OFFICIAL,
    status=RunWorkflowStatus.COMPLETED,
    deleted=False,
    pass_at_k=None,
    item_count=10,
    errors=0,
    completed_at=T0,
    score=True,
    job_fields=None,
    run_metadata=None,
    extra_metrics=(),
):
    """An official run linked to a job, with its ``eval_run_scores`` row(s)."""
    _COMBO["n"] += 1
    with sessions() as db:
        job = EvalExperimentJob(
            experiment_id="exp-1",
            environment_id=env_id,
            combo_index=_COMBO["n"],
            schema_id="schema-a" if env_id == "env-a" else "schema-b",
            params={},
            request_body={},
            status=EvalJobStatus.SUCCEEDED,
            **(job_fields or {}),
        )
        db.add(job)
        db.flush()
        run = Run(
            project_id=P1,
            created_by_user_id="creator",
            owner_user_id="creator",
            task="t",
            dataset="golden",
            dataset_id="ds-1" if version else None,
            dataset_version_id=version,
            metrics=[metric],
            status=status,
            origin=origin,
            experiment_job_id=job.id,
            ended_at=completed_at,
            created_at=completed_at,
            deleted_at=T0 if deleted else None,
            run_metadata=run_metadata or {},
        )
        db.add(run)
        db.flush()
        job.run_id = run.id
        if score:
            for name, value, dirn in [(metric, mean, direction), *extra_metrics]:
                db.add(
                    EvalRunScore(
                        run_id=run.id,
                        metric_name=name,
                        project_id=P1,
                        environment_id=env_id,
                        dataset_id="ds-1" if version else None,
                        dataset_version_id=version,
                        mean_score=value,
                        direction=dirn,
                        pass_at_k=pass_at_k,
                        item_count=item_count,
                        error_item_count=errors,
                        completed_at=completed_at,
                    )
                )
        db.commit()
        return run.id


def _rank(sessions, **kwargs):
    kwargs.setdefault("dataset_id", "ds-1")
    kwargs.setdefault("dataset_version_id", "dv-1")
    with sessions() as db:
        env = db.get(EvalEnvironment, kwargs.pop("env_id", "env-a"))
        return rank_best_runs(db, env, now=NOW, **kwargs)


def _ids(result):
    return [run["run_id"] for run in result["runs"]]


# --------------------------------------------------------------------------- eligibility


def test_only_eligible_runs_are_ranked(sessions, seed):
    good = _run(sessions, mean=0.5)
    _run(sessions, mean=0.9, origin=RunOrigin.LOCAL)
    _run(sessions, mean=0.9, deleted=True)
    _run(sessions, mean=0.9, status=RunWorkflowStatus.RUNNING)
    _run(sessions, mean=0.9, status=RunWorkflowStatus.REJECTED)
    _run(sessions, mean=0.9, env_id="env-b")  # another environment's job
    _run(sessions, mean=0.9, version="dv-2")  # another dataset version
    _run(sessions, mean=0.9, score=False)  # no score row
    _run(sessions, mean=0.9, metric="latency")  # another metric
    approved = _run(sessions, mean=0.4, status=RunWorkflowStatus.APPROVED)

    result = _rank(sessions, metric="accuracy")
    assert _ids(result) == [good, approved]
    assert result["eligible_count"] == 2
    assert result["reason"] is None
    assert result["dataset_version"]["version"] == "v1"


def test_custom_dataset_runs_are_never_eligible(sessions, seed):
    _run(sessions, mean=0.9, version=None)
    result = _rank(sessions, dataset_id="my-custom-string", dataset_version_id=None)
    assert result["runs"] == []
    assert result["reason"] == "custom_dataset"
    assert result["dataset"] is None


def test_version_resolution(sessions, seed):
    on_v2 = _run(sessions, mean=0.5, version="dv-2")
    on_v3 = _run(sessions, mean=0.5, version="dv-3")
    # By version name or alias, with the dataset by slug.
    assert _ids(
        _rank(
            sessions, dataset_id="golden", dataset_version_id=None, dataset_version="v2"
        )
    ) == [on_v2]
    # No version: latest published (v3), then the production alias wins.
    assert _ids(_rank(sessions, dataset_version_id=None)) == [on_v3]
    with sessions() as db:
        db.add(
            DatasetAlias(
                dataset_id="ds-1",
                alias="production",
                dataset_version_id="dv-2",
                updated_by_user_id="creator",
            )
        )
        db.commit()
    assert _ids(_rank(sessions, dataset_version_id=None)) == [on_v2]
    unknown = _rank(sessions, dataset_version_id=None, dataset_version="v9")
    assert unknown["reason"] == "unknown_dataset_version"


# --------------------------------------------------------------------------- metric + direction


def test_minimize_metric_ranks_lowest_first(sessions, seed):
    slow = _run(sessions, mean=2.0, metric="latency", direction="minimize")
    fast = _run(sessions, mean=0.5, metric="latency", direction="minimize")
    mid = _run(sessions, mean=1.0, metric="latency", direction="minimize")
    result = _rank(sessions, metric="latency")
    assert result["direction"] == "minimize"
    assert _ids(result) == [fast, mid, slow]
    assert [r["rank"] for r in result["runs"]] == [1, 2, 3]


def test_maximize_metric_ranks_highest_first(sessions, seed):
    low = _run(sessions, mean=0.2)
    high = _run(sessions, mean=0.8)
    result = _rank(sessions, metric="accuracy")
    assert result["direction"] == "maximize"
    assert _ids(result) == [high, low]


def test_metric_defaults_to_environment_then_most_common(sessions, seed):
    _run(sessions, mean=0.5, extra_metrics=[("latency", 1.0, "minimize")])
    _run(sessions, mean=0.6, extra_metrics=[("latency", 2.0, "minimize")])
    _run(sessions, mean=3.0, metric="latency", direction="minimize")
    most_common = _rank(sessions)
    assert most_common["metric"] == "latency"
    assert most_common["metric_source"] == "most_common"
    assert most_common["metrics"] == [
        {"name": "latency", "run_count": 3},
        {"name": "accuracy", "run_count": 2},
    ]
    with sessions() as db:
        db.get(EvalEnvironment, "env-a").ranking_metric = "accuracy"
        db.commit()
    configured = _rank(sessions)
    assert configured["metric"] == "accuracy"
    assert configured["metric_source"] == "environment"
    requested = _rank(sessions, metric="latency")
    assert requested["metric_source"] == "request"


def test_requested_metric_without_runs(sessions, seed):
    _run(sessions, mean=0.5)
    result = _rank(sessions, metric="nope")
    assert result["runs"] == []
    assert result["reason"] == "no_runs_for_metric"


# --------------------------------------------------------------------------- tie-breakers


def test_tie_breakers_pass_at_k_then_items_then_recency(sessions, seed):
    no_pass = _run(sessions, mean=0.7, pass_at_k=None, item_count=100)
    low_pass = _run(sessions, mean=0.7, pass_at_k={"3": 0.5}, item_count=100)
    high_pass_small = _run(sessions, mean=0.7, pass_at_k={"3": 0.9}, item_count=10)
    high_pass_big_old = _run(
        sessions, mean=0.7, pass_at_k={"3": 0.9}, item_count=20, completed_at=T0
    )
    high_pass_big_new = _run(
        sessions,
        mean=0.7,
        pass_at_k={"3": 0.9},
        item_count=20,
        completed_at=T0 + timedelta(minutes=5),
    )
    best = _run(sessions, mean=0.8)
    result = _rank(sessions, metric="accuracy", k=3, limit=10)
    assert _ids(result) == [
        best,
        high_pass_big_new,
        high_pass_big_old,
        high_pass_small,
        low_pass,
        no_pass,
    ]
    assert result["k"] == 3
    assert result["runs"][1]["pass_at_k_value"] == 0.9
    assert result["runs"][-1]["pass_at_k_value"] is None


def test_without_k_pass_at_k_is_not_a_tie_breaker(sessions, seed):
    big = _run(sessions, mean=0.7, pass_at_k={"3": 0.1}, item_count=50)
    small = _run(sessions, mean=0.7, pass_at_k={"3": 0.9}, item_count=10)
    assert _ids(_rank(sessions, metric="accuracy")) == [big, small]
    with sessions() as db:
        db.get(EvalEnvironment, "env-a").ranking_k = 3  # environment default k
        db.commit()
    assert _ids(_rank(sessions, metric="accuracy")) == [small, big]


def test_pass_at_k_tie_across_the_limit_cut_off(sessions, seed):
    # SQL orders ties by item_count; the pass@k winner has the fewest items.
    for n in range(4):
        _run(sessions, mean=0.5, pass_at_k={"1": 0.1}, item_count=50 + n)
    winner = _run(sessions, mean=0.5, pass_at_k={"1": 0.99}, item_count=5)
    result = _rank(sessions, metric="accuracy", k=1, limit=2)
    assert len(result["runs"]) == 2
    assert result["runs"][0]["run_id"] == winner


# --------------------------------------------------------------------------- error filter


def test_error_ratio_filter_is_toggleable(sessions, seed):
    crashy = _run(sessions, mean=0.95, item_count=10, errors=3)  # 30%
    edge = _run(sessions, mean=0.9, item_count=10, errors=2)  # exactly 20%
    clean = _run(sessions, mean=0.5, item_count=10, errors=0)
    default = _rank(sessions, metric="accuracy")
    assert _ids(default) == [edge, clean]
    assert default["eligible_count"] == 3
    assert default["excluded_errored_count"] == 1
    assert default["max_error_ratio"] == 0.2
    everything = _rank(sessions, metric="accuracy", exclude_errored=False)
    assert _ids(everything) == [crashy, edge, clean]
    assert everything["excluded_errored_count"] == 0
    assert everything["runs"][0]["error_ratio"] == pytest.approx(0.3)


def test_all_runs_excluded(sessions, seed):
    _run(sessions, mean=0.95, item_count=4, errors=4)
    result = _rank(sessions, metric="accuracy")
    assert result["runs"] == []
    assert result["reason"] == "all_excluded"


# --------------------------------------------------------------------------- versioning + payload


def test_remote_versioning_and_legacy_fallback(sessions, seed):
    stored = _run(
        sessions,
        mean=0.9,
        job_fields={
            "remote_versioning": {"agent_version": "1.12", "kb_version": "381"},
            "remote_result": {"versioning_metadata": {"agent_version": "old"}},
        },
    )
    nested = _run(
        sessions,
        mean=0.8,
        job_fields={
            "remote_result": {
                "versioning_metadata": {"agent_version": "1.11", "kb_version": "370"}
            }
        },
    )
    legacy = _run(
        sessions,
        mean=0.7,
        job_fields={"remote_result": {"agent_version": "1.0", "kb_version": "12"}},
    )
    missing = _run(sessions, mean=0.6)
    runs = {r["run_id"]: r for r in _rank(sessions, metric="accuracy")["runs"]}
    assert runs[stored]["remote_versioning"] == {
        "agent_version": "1.12",
        "kb_version": "381",
    }
    assert runs[nested]["remote_versioning"] == {
        "agent_version": "1.11",
        "kb_version": "370",
    }
    assert runs[legacy]["remote_versioning"] == {
        "agent_version": "1.0",
        "kb_version": "12",
    }
    assert runs[missing]["remote_versioning"] is None


def test_payload_params_summary_and_age(sessions, seed):
    run_id = _run(
        sessions,
        mean=0.84,
        pass_at_k={"1": 0.8, "3": 0.9},
        run_metadata={
            "qym_config": {
                "schema_hash": "h",
                "base_source": {"kind": "official", "preset_version_id": "pv-1"},
                "evaluator": {"dataset": "golden", "config": {"samples": 3}},
                "slot_bindings": {
                    "endpoint:primary": {
                        "connection_id": "c-1",
                        "name": "GPT",
                        "model": "gpt-4o",
                    },
                    "endpoint:fast": {
                        "temporary": {"model": "m", "api_key": {"$secret": "k1"}}
                    },
                },
                "sweep": {"/env_overrides/TEMP": 0.2, "/env_overrides/api_token": "x"},
            }
        },
    )
    [run] = _rank(sessions, metric="accuracy", k=3)["runs"]
    assert run["run_id"] == run_id
    assert run["score"] == 0.84
    assert run["pass_at_k"] == {"1": 0.8, "3": 0.9}
    assert run["completed_at"] == "2026-09-30T12:00:00Z"
    assert run["age_seconds"] == 7200
    assert run["job_id"] and run["experiment_id"] == "exp-1"
    params = run["params"]
    assert params["samples"] == 3
    assert params["base_source"] == {"kind": "official", "preset_version_id": "pv-1"}
    assert params["slot_bindings"]["endpoint:primary"]["model"] == "gpt-4o"
    assert params["sweep"]["/env_overrides/TEMP"] == 0.2
    assert "k1" not in str(params)  # secret refs dropped
    assert params["sweep"]["/env_overrides/api_token"] == "[REDACTED]"


# --------------------------------------------------------------------------- no runs on version


def test_points_to_latest_version_with_runs(sessions, seed):
    _run(sessions, mean=0.5, version="dv-1")
    _run(sessions, mean=0.5, version="dv-2")
    _run(sessions, mean=0.6, version="dv-2")
    _run(sessions, mean=0.9, version="dv-3", origin=RunOrigin.LOCAL)  # not eligible
    result = _rank(sessions, dataset_version_id="dv-3")
    assert result["runs"] == []
    assert result["reason"] == "no_runs_on_version"
    assert result["latest_version_with_runs"] == {
        "id": "dv-2",
        "version": "v2",
        "name": "",
        "run_count": 2,
    }
    # Metric default falls back to the environment-wide most common metric.
    assert result["metric"] == "accuracy"


def test_no_runs_anywhere(sessions, seed):
    result = _rank(sessions)
    assert result["runs"] == []
    assert result["reason"] == "no_runs_on_version"
    assert result["latest_version_with_runs"] is None
    assert result["metric"] is None


# --------------------------------------------------------------------------- query count


def test_ranking_query_count_does_not_grow_with_runs(sessions, seed):
    def count_queries(n_runs):
        for i in range(n_runs):
            _run(sessions, mean=0.1 * i, version="dv-2", item_count=10 + i)
        with sessions() as db:
            env = db.get(EvalEnvironment, "env-a")
            statements = []
            listener = lambda *a: statements.append(a[2])  # noqa: E731
            event.listen(db.get_bind(), "before_cursor_execute", listener)
            try:
                result = rank_best_runs(
                    db, env, dataset_version_id="dv-2", metric="accuracy", now=NOW
                )
            finally:
                event.remove(db.get_bind(), "before_cursor_execute", listener)
        assert result["runs"]
        return len(statements)

    one = count_queries(1)
    many = count_queries(6)
    assert many <= one + 1  # +1: the tie check once the limit is reached


# --------------------------------------------------------------------------- API


@pytest.fixture()
def client(sessions, seed):
    app = create_app()

    def override_get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _headers(email):
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


URL = f"/v1/projects/{P1}/eval-environments/env-a/best-runs"


def test_api_member_reads_ranked_runs(client, sessions):
    second = _run(sessions, mean=0.5)
    first = _run(sessions, mean=0.9)
    response = client.get(
        URL,
        params={
            "dataset_id": "ds-1",
            "dataset_version_id": "dv-1",
            "metric": "accuracy",
        },
        headers=_headers(MEMBER),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [r["run_id"] for r in body["runs"]] == [first, second]
    assert body["environment_id"] == "env-a"


def test_api_limit_and_toggle(client, sessions):
    for mean in (0.1, 0.2, 0.3):
        _run(sessions, mean=mean)
    _run(sessions, mean=0.99, item_count=10, errors=5)
    response = client.get(
        URL,
        params={
            "dataset_id": "golden",
            "dataset_version": "v1",
            "limit": 2,
            "exclude_errored": "false",
        },
        headers=_headers(MEMBER),
    )
    body = response.json()
    assert len(body["runs"]) == 2
    assert body["runs"][0]["score"] == 0.99


def test_api_access_and_validation(client, sessions):
    assert (
        client.get(
            URL, params={"dataset_id": "ds-1"}, headers=_headers(OUTSIDER)
        ).status_code
        == 403
    )
    missing_env = f"/v1/projects/{P1}/eval-environments/nope/best-runs"
    assert (
        client.get(
            missing_env, params={"dataset_id": "ds-1"}, headers=_headers(MEMBER)
        ).status_code
        == 404
    )
    assert client.get(URL, headers=_headers(MEMBER)).status_code == 400
    assert (
        client.get(
            URL, params={"dataset_version_id": "dv-missing"}, headers=_headers(MEMBER)
        ).status_code
        == 404
    )
    assert (
        client.get(
            URL, params={"dataset_id": "ds-1", "limit": 0}, headers=_headers(MEMBER)
        ).status_code
        == 422
    )
    # A version of another project's dataset is not found.
    with sessions() as db:
        db.add(
            Dataset(
                id="ds-x",
                project_id="project-2",
                name="X",
                slug="x",
                created_by_user_id="creator",
            )
        )
        db.flush()
        db.add(
            DatasetVersion(
                id="dv-x", dataset_id="ds-x", version="v1", created_by_user_id="creator"
            )
        )
        db.commit()
    assert (
        client.get(
            URL, params={"dataset_version_id": "dv-x"}, headers=_headers(MEMBER)
        ).status_code
        == 404
    )
