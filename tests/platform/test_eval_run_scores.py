"""Best-run score index ``eval_run_scores`` (plan §4.7, §13; issue #36)."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.api import experiments as experiments_api
from qym_platform.api import runs as runs_api
from qym_platform.app import create_app
from qym_platform.auth import Principal
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    Dataset,
    DatasetVersion,
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
    RunItem,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunOrigin,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.eval_dispatcher import EvalDispatcher
from qym_platform.services.eval_experiments import hash_launch_token
from qym_platform.services.eval_run_scores import (
    backfill_run_scores,
    refresh_run_scores,
    run_metric_summaries,
    sync_job_scores,
)
from qym_platform.services.repeat_analysis import build_repeat_analysis
from qym_platform.tools import backfill_eval_run_scores as backfill_tool

T0 = datetime(2026, 9, 30, 12, 0, 0)
TOKEN = "launch-token-scores-QQQQ"
INGEST_KEY = "env-ingest-key-scores"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )


def _backends():
    return [
        "sqlite",
        pytest.param(
            "postgres",
            marks=pytest.mark.skipif(
                not os.environ.get("QYM_TEST_POSTGRES_URL"),
                reason="QYM_TEST_POSTGRES_URL not configured",
            ),
        ),
    ]


@pytest.fixture(params=_backends())
def sessions(request, tmp_path):
    if request.param == "sqlite":
        engine = create_engine(
            f"sqlite:///{tmp_path / 'scores.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(engine)
        try:
            yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
        finally:
            engine.dispose()
        return
    url = os.environ["QYM_TEST_POSTGRES_URL"]
    schema = "eval_run_scores_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture()
def seed(sessions):
    """Creator + ingest principal in one project, an environment and a dataset version."""
    with sessions() as db:
        creator = User(id="creator", email="creator@example.com", role=UserRole.MEMBER)
        ingest = User(id="ingest", email="ingest@example.com", role=UserRole.MEMBER)
        db.add_all([creator, ingest])
        db.flush()
        project = Project(
            id="project-a", name="A", slug="proj-a", created_by_user_id=creator.id
        )
        db.add(project)
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id=project.id, user_id=creator.id, role=ProjectRole.MANAGER
                ),
                ProjectMembership(
                    project_id=project.id, user_id=ingest.id, role=ProjectRole.MEMBER
                ),
                ApiKey(
                    id=str(uuid4()),
                    user_id=ingest.id,
                    project_id=project.id,
                    name="k",
                    prefix=api_key_prefix(INGEST_KEY),
                    key_hash=hash_api_key(INGEST_KEY),
                    scopes=[],
                ),
            ]
        )
        env = EvalEnvironment(
            project_id=project.id,
            name="staging",
            base_url="https://staging.example",
            health_status="ok",
        )
        dataset = Dataset(
            project_id=project.id,
            name="golden",
            slug="golden",
            created_by_user_id=creator.id,
        )
        db.add_all([env, dataset])
        db.flush()
        version = DatasetVersion(
            dataset_id=dataset.id, version="v1", created_by_user_id=creator.id
        )
        schema = EvalEnvironmentSchema(
            environment_id=env.id, schema_hash="h1", schema_json={}
        )
        db.add_all([version, schema])
        db.flush()
        experiment = EvalExperiment(
            project_id=project.id,
            created_by_user_id=creator.id,
            name="exp",
            environment_ids=[env.id],
            job_count=1,
        )
        db.add(experiment)
        db.commit()
        return {
            "project_id": project.id,
            "env_id": env.id,
            "schema_id": schema.id,
            "experiment_id": experiment.id,
            "dataset_id": dataset.id,
            "dataset_version_id": version.id,
        }


def _job(db, seed, combo_index=0, **fields) -> EvalExperimentJob:
    job = EvalExperimentJob(
        experiment_id=seed["experiment_id"],
        environment_id=seed["env_id"],
        combo_index=combo_index,
        schema_id=seed["schema_id"],
        params={},
        request_body={},
        launch_token_hash=hash_launch_token(TOKEN),
        **fields,
    )
    db.add(job)
    db.flush()
    return job


def _scored_run(
    sessions,
    seed,
    *,
    job_status=EvalJobStatus.SUCCEEDED,
    run_status=RunWorkflowStatus.COMPLETED,
    origin=RunOrigin.OFFICIAL,
    combo_index=0,
    job_fields=None,
):
    """An official run linked to a job, with four items.

    ``accuracy`` (maximize): i1=1.0, i2=0.5, i3 errored, i4 unscored → 1.5 / 3 = 0.5.
    ``latency`` (minimize): i1=0.2 only → 0.2 / 2 = 0.1.
    """
    with sessions() as db:
        job = _job(db, seed, combo_index, status=job_status, **(job_fields or {}))
        run = Run(
            project_id=seed["project_id"],
            created_by_user_id="ingest",
            owner_user_id="creator",
            task="t",
            dataset="golden",
            dataset_id=seed["dataset_id"],
            dataset_version_id=seed["dataset_version_id"],
            metrics=["accuracy", "latency"],
            status=run_status,
            origin=origin,
            experiment_job_id=job.id,
            ended_at=T0,
        )
        db.add(run)
        db.flush()
        job.run_id = run.id
        for index, (item_id, error) in enumerate(
            [("i1", None), ("i2", None), ("i3", "boom"), ("i4", None)]
        ):
            db.add(
                RunItem(
                    run_id=run.id,
                    item_id=item_id,
                    index=index,
                    input={},
                    output=None if error else "o",
                    error=error,
                )
            )
        for item_id, metric, score in [
            ("i1", "accuracy", 1.0),
            ("i2", "accuracy", 0.5),
            ("i1", "latency", 0.2),
        ]:
            db.add(
                RunItemScore(
                    run_id=run.id,
                    item_id=item_id,
                    metric_name=metric,
                    score_numeric=score,
                )
            )
        db.add_all(
            [
                RunMetricSpec(
                    run_id=run.id,
                    metric_name="accuracy",
                    position=0,
                    score_type="percentage",
                    direction="maximize",
                ),
                RunMetricSpec(
                    run_id=run.id,
                    metric_name="latency",
                    position=1,
                    score_type="number",
                    direction="minimize",
                ),
            ]
        )
        db.commit()
        return run.id, job.id


def _rows(sessions, run_id=None):
    with sessions() as db:
        query = db.query(EvalRunScore)
        if run_id:
            query = query.filter(EvalRunScore.run_id == run_id)
        rows = query.order_by(EvalRunScore.run_id, EvalRunScore.metric_name).all()
        for row in rows:
            db.expunge(row)
        return rows


def _refresh(sessions, run_id):
    with sessions() as db:
        written = refresh_run_scores(db, db.get(Run, run_id))
        db.commit()
        return written


def _set(sessions, model, row_id, **fields):
    with sessions() as db:
        row = db.get(model, row_id)
        for key, value in fields.items():
            setattr(row, key, value)
        db.commit()


def _comparable(rows):
    return [
        {
            c.name: getattr(row, c.name)
            for c in EvalRunScore.__table__.columns
            if c.name != "computed_at"
        }
        for row in rows
    ]


# ------------------------------------------------------------------ computation


def test_rows_follow_the_runs_list_mean_and_metric_specs(sessions, seed):
    run_id, _ = _scored_run(sessions, seed)
    assert _refresh(sessions, run_id) == 2

    accuracy, latency = _rows(sessions, run_id)
    assert accuracy.metric_name == "accuracy"
    assert accuracy.mean_score == pytest.approx(0.5)  # errored item counts as 0
    assert accuracy.direction == "maximize"
    assert latency.mean_score == pytest.approx(0.1)
    assert latency.direction == "minimize"
    for row in (accuracy, latency):
        assert row.project_id == seed["project_id"]
        assert row.environment_id == seed["env_id"]
        assert row.dataset_id == seed["dataset_id"]
        assert row.dataset_version_id == seed["dataset_version_id"]
        assert (row.item_count, row.error_item_count) == (4, 1)
        assert row.completed_at == T0
        assert row.pass_at_k is None  # single-pass run, no service value


def test_experiments_api_shares_the_mean_implementation(sessions, seed):
    assert experiments_api._run_metrics is run_metric_summaries
    run_id, _ = _scored_run(sessions, seed)
    with sessions() as db:
        summary = run_metric_summaries(db, {run_id: db.get(Run, run_id)})[run_id]
    assert summary["means"] == {
        "accuracy": pytest.approx(0.5),
        "latency": pytest.approx(0.1),
    }
    assert summary["directions"] == {"accuracy": "maximize", "latency": "minimize"}


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"job_status": EvalJobStatus.RUNNING}, id="job-not-terminal"),
        pytest.param({"job_status": EvalJobStatus.BLOCKED}, id="job-blocked"),
        pytest.param({"run_status": RunWorkflowStatus.RUNNING}, id="run-running"),
        pytest.param({"run_status": RunWorkflowStatus.FAILED}, id="run-failed"),
        pytest.param({"origin": RunOrigin.LOCAL}, id="local-run"),
    ],
)
def test_no_rows_until_official_run_completed_and_job_terminal(
    sessions, seed, overrides
):
    run_id, _ = _scored_run(sessions, seed, **overrides)
    assert _refresh(sessions, run_id) == 0
    assert _rows(sessions) == []


@pytest.mark.parametrize(
    "status",
    [
        EvalJobStatus.SUCCEEDED,
        EvalJobStatus.FAILED,
        EvalJobStatus.CANCELLED,
        EvalJobStatus.TIMED_OUT,
    ],
)
def test_any_terminal_job_status_with_a_completed_run_is_scored(sessions, seed, status):
    run_id, _ = _scored_run(sessions, seed, job_status=status)
    assert _refresh(sessions, run_id) == 2


def test_run_in_review_counts_as_completed(sessions, seed):
    run_id, _ = _scored_run(sessions, seed, run_status=RunWorkflowStatus.APPROVED)
    assert _refresh(sessions, run_id) == 2


def test_refresh_is_idempotent_and_replaces_stale_rows(sessions, seed):
    run_id, _ = _scored_run(sessions, seed)
    _refresh(sessions, run_id)
    first = _comparable(_rows(sessions, run_id))
    _refresh(sessions, run_id)
    assert _comparable(_rows(sessions, run_id)) == first

    # A metric that lost all its scores is dropped; the others are updated.
    with sessions() as db:
        db.query(RunItemScore).filter(RunItemScore.metric_name == "latency").delete()
        score = (
            db.query(RunItemScore)
            .filter(
                RunItemScore.item_id == "i2", RunItemScore.metric_name == "accuracy"
            )
            .one()
        )
        score.score_numeric = 0.8
        db.commit()
    assert _refresh(sessions, run_id) == 1
    (row,) = _rows(sessions, run_id)
    assert row.metric_name == "accuracy"
    assert row.mean_score == pytest.approx(0.6)

    # A run that stops being scorable loses its rows.
    _set(sessions, Run, run_id, status=RunWorkflowStatus.RUNNING)
    assert _refresh(sessions, run_id) == 0
    assert _rows(sessions) == []


def test_repeat_run_pass_at_k_matches_repeat_analysis(sessions, seed):
    run_id, _ = _scored_run(sessions, seed)
    passes = {"i1": [1.0, 0.0, 1.0], "i2": [0.0, 0.0, 0.6], "i4": [0.0, None, 0.0]}
    with sessions() as db:
        run = db.get(Run, run_id)
        run.samples = 3
        db.query(RunMetricSpec).filter(
            RunMetricSpec.run_id == run_id, RunMetricSpec.metric_name == "accuracy"
        ).one().pass_threshold = 0.5
        for item_id, scores in passes.items():
            for number, score in enumerate(scores, start=1):
                db.add(
                    RunItemPassScore(
                        run_id=run_id,
                        item_id=item_id,
                        metric_name="accuracy",
                        pass_number=number,
                        score_numeric=score,
                    )
                )
        db.commit()
    _refresh(sessions, run_id)
    accuracy, latency = _rows(sessions, run_id)

    expected = build_repeat_analysis(
        {k: [v if v is not None else 0.0 for v in s] for k, s in passes.items()},
        threshold=0.5,
        samples=3,
    )["band"]
    assert set(accuracy.pass_at_k) == {"1", "2", "3"}
    for k, value in accuracy.pass_at_k.items():
        assert value == pytest.approx(expected[int(k)]["pass_at_k"])
    assert latency.pass_at_k is None  # no stored passes for this metric


def test_service_result_pass_at_k_is_the_fallback(sessions, seed):
    run_id, _ = _scored_run(
        sessions,
        seed,
        job_fields={
            "remote_result": {"analysis_metric": "accuracy", "pass_at_k": 0.75}
        },
    )
    _refresh(sessions, run_id)
    accuracy, latency = _rows(sessions, run_id)
    assert accuracy.pass_at_k == {"1": 0.75}
    assert latency.pass_at_k is None


# ------------------------------------------------------------------ hooks


def test_dispatcher_hook_writes_rows_when_the_job_turns_terminal(sessions, seed):
    run_id, job_id = _scored_run(sessions, seed, job_status=EvalJobStatus.RUNNING)
    dispatcher = EvalDispatcher(sessions, clock=lambda: T0)
    _set(
        sessions,
        EvalExperimentJob,
        job_id,
        lease_owner=dispatcher.owner,
        lease_until=T0 + timedelta(minutes=5),
    )
    # A non-terminal save leaves the index alone ...
    dispatcher._with_job(job_id, lambda db, job: dispatcher._save(job, changed=False))
    assert _rows(sessions) == []
    # ... the terminal transition writes it, in the same transaction.
    _set(sessions, EvalExperimentJob, job_id, lease_owner=dispatcher.owner)
    dispatcher._with_job(
        job_id,
        lambda db, job: dispatcher._set_status(job, EvalJobStatus.SUCCEEDED),
    )
    assert [row.metric_name for row in _rows(sessions, run_id)] == [
        "accuracy",
        "latency",
    ]


def test_sync_job_scores_never_raises(sessions, seed, monkeypatch):
    from qym_platform.services import eval_run_scores

    run_id, job_id = _scored_run(sessions, seed)

    def boom(*_args, **_kwargs):
        raise RuntimeError("scores unavailable")

    monkeypatch.setattr(eval_run_scores, "compute_run_scores", boom)
    with sessions() as db:
        job = db.get(EvalExperimentJob, job_id)
        job.error = "kept"
        assert sync_job_scores(db, job) == 0
        db.commit()  # the caller's own change survives
    with sessions() as db:
        assert db.get(EvalExperimentJob, job_id).error == "kept"
    assert _rows(sessions) == []


@pytest.fixture()
def client(sessions):
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


def _event(run_id, seq, etype, payload):
    return json.dumps(
        {
            "schema_version": 1,
            "event_id": str(uuid4()),
            "sequence": seq,
            "sent_at": "2026-09-30T12:00:00Z",
            "type": etype,
            "run_id": run_id,
            "payload": payload,
        }
    )


def _ingest_official_run(client, job_id, seed):
    headers = {"Authorization": f"Bearer {INGEST_KEY}"}
    response = client.post(
        "/v1/runs",
        headers=headers,
        json={
            "task": "t",
            "dataset": "d",
            "metrics": ["accuracy"],
            "run_metadata": {
                "qym_launch": {
                    "experiment_id": seed["experiment_id"],
                    "job_id": job_id,
                    "environment_id": seed["env_id"],
                    "combo_index": 0,
                    "token": TOKEN,
                }
            },
            "run_config": {},
        },
    )
    assert response.status_code == 200, response.text
    run_id = response.json()["run_id"]
    events = [
        _event(
            run_id,
            1,
            "run_started",
            {
                "task": "t",
                "dataset": "d",
                "metrics": ["accuracy"],
                "started_at": "2026-09-30T12:00:00Z",
            },
        ),
        _event(run_id, 2, "item_started", {"item_id": "a", "index": 0, "input": 1}),
        _event(
            run_id,
            3,
            "item_completed",
            {"item_id": "a", "index": 0, "output": 1, "latency_ms": 1.0},
        ),
        _event(
            run_id,
            4,
            "metric_scored",
            {"item_id": "a", "metric_name": "accuracy", "score_numeric": 0.9},
        ),
        _event(run_id, 5, "run_completed", {"ended_at": "2026-09-30T12:05:00Z"}),
    ]
    response = client.post(
        f"/v1/runs/{run_id}/events",
        headers={**headers, "Content-Type": "application/x-ndjson"},
        content="\n".join(events) + "\n",
    )
    assert response.status_code == 200, response.text
    return run_id


def test_ingest_run_completed_writes_rows_when_job_already_terminal(
    client, sessions, seed
):
    with sessions() as db:
        job_id = _job(db, seed, status=EvalJobStatus.SUCCEEDED).id
        db.commit()
    run_id = _ingest_official_run(client, job_id, seed)
    (row,) = _rows(sessions, run_id)
    assert row.metric_name == "accuracy"
    assert row.mean_score == pytest.approx(0.9)
    assert row.environment_id == seed["env_id"]
    assert row.completed_at == datetime(2026, 9, 30, 12, 5, 0)


def test_ingest_waits_for_the_job_then_dispatcher_writes(client, sessions, seed):
    with sessions() as db:
        job_id = _job(db, seed, status=EvalJobStatus.RUNNING).id
        db.commit()
    run_id = _ingest_official_run(client, job_id, seed)
    assert _rows(sessions) == []

    with sessions() as db:
        job = db.get(EvalExperimentJob, job_id)
        job.status = EvalJobStatus.SUCCEEDED
        assert sync_job_scores(db, job) == 1
        db.commit()
    assert [row.run_id for row in _rows(sessions)] == [run_id]


def test_score_edit_refreshes_rows(sessions, seed):
    run_id, _ = _scored_run(sessions, seed)
    _refresh(sessions, run_id)
    with sessions() as db:
        principal = Principal(user=db.get(User, "creator"), auth_type="none")
        runs_api.update_metric(
            {
                "file_path": run_id,
                "row_index": 1,  # i2
                "metric_name": "accuracy",
                "new_score": 0.2,
            },
            db=db,
            principal=principal,
        )
    accuracy = _rows(sessions, run_id)[0]
    assert accuracy.mean_score == pytest.approx((1.0 + 0.2) / 3)


# ------------------------------------------------------------------ backfill


def test_backfill_is_idempotent(sessions, seed):
    scored, _ = _scored_run(sessions, seed, combo_index=0)
    waiting, _ = _scored_run(
        sessions, seed, combo_index=1, job_status=EvalJobStatus.RUNNING
    )
    local, _ = _scored_run(sessions, seed, combo_index=2, origin=RunOrigin.LOCAL)
    # A stale row the index should not have (e.g. from an older computation).
    with sessions() as db:
        db.add(
            EvalRunScore(
                run_id=waiting,
                metric_name="accuracy",
                project_id=seed["project_id"],
                environment_id=seed["env_id"],
                mean_score=0.99,
            )
        )
        db.commit()

    with sessions() as db:
        first_stats = backfill_run_scores(db, batch_size=1)
    first = _comparable(_rows(sessions))
    with sessions() as db:
        second_stats = backfill_run_scores(db, batch_size=1)
    assert _comparable(_rows(sessions)) == first
    assert (
        first_stats
        == second_stats
        == {
            "runs": 2,  # official runs only
            "scored_runs": 1,
            "rows": 2,
            "failed": 0,
        }
    )
    assert {row.run_id for row in _rows(sessions)} == {scored}
    assert local not in {row.run_id for row in _rows(sessions)}


def test_backfill_tool_entry_point(sessions, seed, capsys):
    run_id, _ = _scored_run(sessions, seed)
    assert backfill_tool.main([], session_factory=sessions) == 0
    assert json.loads(capsys.readouterr().out) == {
        "failed": 0,
        "rows": 2,
        "runs": 1,
        "scored_runs": 1,
    }
    assert (
        backfill_tool.main(["--project-slug", "proj-a"], session_factory=sessions) == 0
    )
    assert len(_rows(sessions, run_id)) == 2
    assert (
        backfill_tool.main(["--project-slug", "missing"], session_factory=sessions) == 3
    )
