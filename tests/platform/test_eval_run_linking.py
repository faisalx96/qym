"""Ingest run-linking protocol and ``origin = official`` (plan §11, issue #17)."""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunEvent,
    RunOrigin,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.eval_dispatcher import default_add_launch_token
from qym_platform.services.eval_experiments import (
    hash_launch_token,
    launch_token_hash_for_job,
)
from qym_platform.services.eval_run_linking import (
    link_official_run,
    merge_run_metadata,
    strip_launch_token,
)

TOKEN = "launch-token-secret-QQQQ7777"
ENV_INGEST_KEY = "env-ingest-key"
OTHER_PROJECT_KEY = "other-project-key"


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def sessions(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'link.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(engine)
    try:
        yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    finally:
        engine.dispose()


def _api_key(user_id: str, project_id: str, token: str) -> ApiKey:
    return ApiKey(
        id=str(uuid4()),
        user_id=user_id,
        project_id=project_id,
        name="k",
        prefix=api_key_prefix(token),
        key_hash=hash_api_key(token),
        scopes=[],
    )


@pytest.fixture()
def seed(sessions):
    """Creator + env ingest principal in project A, a key for project B, one job."""
    with sessions() as db:
        creator = User(id="creator", email="creator@example.com", role=UserRole.MEMBER)
        ingest = User(id="ingest", email="ingest@example.com", role=UserRole.MEMBER)
        db.add_all([creator, ingest])
        db.flush()
        project_a = Project(
            id="project-a", name="A", slug="proj-a", created_by_user_id=creator.id
        )
        project_b = Project(
            id="project-b", name="B", slug="proj-b", created_by_user_id=creator.id
        )
        db.add_all([project_a, project_b])
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id=project_a.id, user_id=creator.id, role=ProjectRole.MANAGER
                ),
                ProjectMembership(
                    project_id=project_a.id, user_id=ingest.id, role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id=project_b.id, user_id=ingest.id, role=ProjectRole.MEMBER
                ),
                _api_key(ingest.id, project_a.id, ENV_INGEST_KEY),
                _api_key(ingest.id, project_b.id, OTHER_PROJECT_KEY),
            ]
        )
        env = EvalEnvironment(
            project_id=project_a.id,
            name="staging",
            base_url="https://staging.example",
            health_status="ok",
        )
        db.add(env)
        db.flush()
        schema = EvalEnvironmentSchema(
            environment_id=env.id, schema_hash="h1", schema_json={}
        )
        db.add(schema)
        db.flush()
        experiment = EvalExperiment(
            project_id=project_a.id,
            created_by_user_id=creator.id,
            name="exp",
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
            launch_token_hash=hash_launch_token(TOKEN),
            # Ingest may beat the dispatcher recording the submit.
            status=EvalJobStatus.SUBMITTING,
        )
        db.add(job)
        db.commit()
        return {
            "env_id": env.id,
            "experiment_id": experiment.id,
            "job_id": job.id,
        }


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


def _launch(seed, token=TOKEN, **overrides):
    launch = {
        "experiment_id": seed["experiment_id"],
        "job_id": seed["job_id"],
        "environment_id": seed["env_id"],
        "combo_index": 0,
    }
    if token is not None:
        launch["token"] = token
    launch.update(overrides)
    return launch


def _create(client, launch, key=ENV_INGEST_KEY, extra=None):
    metadata = {"team": "rag", "qym_config": {"schema_hash": "h1"}}
    if launch is not None:
        metadata["qym_launch"] = launch
    metadata.update(extra or {})
    response = client.post(
        "/v1/runs",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "task": "t",
            "dataset": "d",
            "metrics": [],
            "run_metadata": metadata,
            "run_config": {},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["run_id"]


def _event(run_id, seq, etype, payload):
    return json.dumps(
        {
            "schema_version": 1,
            "event_id": str(uuid4()),
            "sequence": seq,
            "sent_at": "2026-03-23T00:00:00Z",
            "type": etype,
            "run_id": run_id,
            "payload": payload,
        }
    )


def _send(client, run_id, events, key=ENV_INGEST_KEY):
    return client.post(
        f"/v1/runs/{run_id}/events",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/x-ndjson",
        },
        content="\n".join(events) + "\n",
    )


def _run(sessions, run_id) -> Run:
    with sessions() as db:
        run = db.get(Run, run_id)
        db.expunge(run)
        return run


def _job(sessions, job_id) -> EvalExperimentJob:
    with sessions() as db:
        job = db.get(EvalExperimentJob, job_id)
        db.expunge(job)
        return job


def _env(sessions, env_id) -> EvalEnvironment:
    with sessions() as db:
        env = db.get(EvalEnvironment, env_id)
        db.expunge(env)
        return env


def _assert_no_token_stored(sessions):
    with sessions() as db:
        for run in db.query(Run).all():
            assert TOKEN not in json.dumps(run.run_metadata)
            assert TOKEN not in json.dumps(run.run_config)
        for event in db.query(RunEvent).all():
            assert TOKEN not in json.dumps(event.payload)
        for job in db.query(EvalExperimentJob).all():
            assert TOKEN not in json.dumps(job.request_body)


# ------------------------------------------------------------------ linking


def test_valid_token_links_official_run(client, sessions, seed, caplog):
    caplog.set_level(logging.DEBUG)
    run_id = _create(client, _launch(seed))

    run = _run(sessions, run_id)
    assert run.origin == RunOrigin.OFFICIAL
    assert run.experiment_job_id == seed["job_id"]
    assert run.owner_user_id == "creator"
    assert run.created_by_user_id == "ingest"  # audit: the ingest principal
    launch = run.run_metadata["qym_launch"]
    assert "token" not in launch
    assert launch["job_id"] == seed["job_id"]
    assert run.run_metadata["qym_config"] == {"schema_hash": "h1"}
    assert _job(sessions, seed["job_id"]).run_id == run_id
    assert _env(sessions, seed["env_id"]).health_error is None
    _assert_no_token_stored(sessions)
    assert TOKEN not in caplog.text


def test_env_principal_can_stream_events_to_official_run(client, sessions, seed):
    run_id = _create(client, _launch(seed))
    response = _send(
        client,
        run_id,
        [
            _event(
                run_id,
                1,
                "run_started",
                {
                    "task": "t",
                    "dataset": "d",
                    "metrics": [],
                    "started_at": "2026-03-23T00:00:00Z",
                    "total_items": 1,
                    "run_metadata": {"team": "rag", "qym_launch": _launch(seed)},
                },
            )
        ],
    )
    assert response.status_code == 200, response.text
    assert _run(sessions, run_id).run_metadata["total_items"] == 1


@pytest.mark.parametrize(
    "launch_kwargs",
    [
        pytest.param({"token": "wrong-token"}, id="wrong-token"),
        pytest.param({"token": None}, id="missing-token"),
        pytest.param({"job_id": "no-such-job"}, id="unknown-job"),
        pytest.param({"job_id": None}, id="missing-job-id"),
    ],
)
def test_mismatch_stays_local(client, sessions, seed, launch_kwargs, caplog):
    caplog.set_level(logging.DEBUG)
    launch = _launch(seed, **{k: v for k, v in launch_kwargs.items() if k == "token"})
    if "job_id" in launch_kwargs:
        if launch_kwargs["job_id"] is None:
            launch.pop("job_id")
        else:
            launch["job_id"] = launch_kwargs["job_id"]
    run_id = _create(client, launch)

    run = _run(sessions, run_id)
    assert run.origin == RunOrigin.LOCAL
    assert run.experiment_job_id is None
    assert run.owner_user_id == "ingest"
    assert "token" not in run.run_metadata["qym_launch"]
    assert _job(sessions, seed["job_id"]).run_id is None
    # A bad token can't flag the environment.
    assert _env(sessions, seed["env_id"]).health_error is None
    _assert_no_token_stored(sessions)
    assert TOKEN not in caplog.text


@pytest.mark.parametrize("keep_previous", [True, False])
def test_launch_before_key_rotation_links_official_after_it(
    client, sessions, seed, monkeypatch, keep_previous
):
    """Launched under the old key, dispatched after rotating, ingested: official.

    The dispatcher derives the token with the previous key that matches the stored
    ``launch_token_hash``; ingest only hashes what it receives. Once the old key is
    dropped the current-key token no longer matches and the run is local.
    """
    old_key = Fernet.generate_key().decode("utf-8")
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", old_key)
    job_id = seed["job_id"]
    with sessions() as db:  # what api/experiments stores at launch
        db.get(EvalExperimentJob, job_id).launch_token_hash = launch_token_hash_for_job(
            job_id
        )
        db.commit()

    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    if keep_previous:
        monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS", old_key)
    else:
        monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS", raising=False)
    stored_hash = _job(sessions, job_id).launch_token_hash
    sent = default_add_launch_token(
        {"evaluator": {"config": {"run_metadata": {}}}},
        job_id,
        expected_hash=stored_hash,
    )
    token = sent["evaluator"]["config"]["run_metadata"]["qym_launch"]["token"]

    run_id = _create(client, _launch(seed, token=token))

    run = _run(sessions, run_id)
    if keep_previous:
        assert run.origin == RunOrigin.OFFICIAL
        assert _job(sessions, job_id).run_id == run_id
    else:
        assert run.origin == RunOrigin.LOCAL
        assert _job(sessions, job_id).run_id is None
    assert "token" not in run.run_metadata["qym_launch"]


def test_no_launch_metadata_is_local(client, sessions, seed):
    run_id = _create(client, None)
    run = _run(sessions, run_id)
    assert run.origin == RunOrigin.LOCAL
    assert run.experiment_job_id is None


def test_replayed_token_is_local_and_keeps_first_link(client, sessions, seed):
    first = _create(client, _launch(seed))
    second = _create(client, _launch(seed))

    assert _run(sessions, first).origin == RunOrigin.OFFICIAL
    replay = _run(sessions, second)
    assert replay.origin == RunOrigin.LOCAL
    assert replay.experiment_job_id is None
    assert replay.owner_user_id == "ingest"
    assert _job(sessions, seed["job_id"]).run_id == first
    _assert_no_token_stored(sessions)


def test_deleted_linked_run_does_not_reopen_the_job(client, sessions, seed):
    """``run_id`` is ON DELETE SET NULL; ``run_linked_at`` keeps the job closed."""
    first = _create(client, _launch(seed))
    job = _job(sessions, seed["job_id"])
    assert job.run_id == first and job.run_linked_at is not None
    linked_at = job.run_linked_at

    # Hard-delete the linked run with FKs enforced: the job's ``run_id`` is SET NULL.
    with sessions() as db:
        db.execute(text("PRAGMA foreign_keys=ON"))
        db.execute(delete(RunEvent).where(RunEvent.run_id == first))
        db.execute(delete(Run).where(Run.id == first))
        db.commit()
    job = _job(sessions, seed["job_id"])
    assert job.run_id is None and job.run_linked_at == linked_at

    replay = _create(client, _launch(seed))
    run = _run(sessions, replay)
    assert run.origin == RunOrigin.LOCAL
    assert run.experiment_job_id is None
    assert _job(sessions, seed["job_id"]).run_id is None
    _assert_no_token_stored(sessions)


def test_wrong_project_is_local_and_flags_environment(client, sessions, seed):
    run_id = _create(client, _launch(seed), key=OTHER_PROJECT_KEY)

    run = _run(sessions, run_id)
    assert run.project_id == "project-b"
    assert run.origin == RunOrigin.LOCAL
    assert run.experiment_job_id is None
    assert _job(sessions, seed["job_id"]).run_id is None
    assert _env(sessions, seed["env_id"]).health_error == "runs arriving in project proj-b"
    _assert_no_token_stored(sessions)

    # The job is still unclaimed, so the correctly routed run links afterwards.
    good = _create(client, _launch(seed))
    assert _run(sessions, good).origin == RunOrigin.OFFICIAL


def test_concurrent_claim_links_exactly_one_run(sessions, seed):
    """A stale job snapshot can't relink: the guarded UPDATE matches no row."""
    with sessions() as a, sessions() as b:
        # Session A reads the unclaimed job first ...
        assert a.get(EvalExperimentJob, seed["job_id"]).run_id is None
        # ... session B links and commits in between ...
        run_b = Run(
            project_id="project-a",
            created_by_user_id="ingest",
            owner_user_id="ingest",
            task="t",
            dataset="d",
        )
        b.add(run_b)
        b.flush()
        assert link_official_run(b, run_b, {"qym_launch": _launch(seed)})
        b.commit()
        # ... so A's claim (from its stale identity map) must lose.
        run_a = Run(
            project_id="project-a",
            created_by_user_id="ingest",
            owner_user_id="ingest",
            task="t",
            dataset="d",
        )
        a.add(run_a)
        a.flush()
        assert not link_official_run(a, run_a, {"qym_launch": _launch(seed)})
        a.commit()
        assert run_a.origin == RunOrigin.LOCAL
        assert run_a.experiment_job_id is None
        assert run_a.owner_user_id == "ingest"
        run_b_id = run_b.id
    assert _job(sessions, seed["job_id"]).run_id == run_b_id


# ------------------------------------------------------------ metadata merges


def _summary_events(run_id, seed):
    leaked = _launch(seed, job_id="other", experiment_id="forged")
    return [
        _event(
            run_id,
            1,
            "run_started",
            {
                "task": "t",
                "dataset": "d",
                "metrics": [],
                "started_at": "2026-03-23T00:00:00Z",
                "run_metadata": {
                    "team": "rag2",
                    "qym_launch": leaked,
                    "qym_config": {"schema_hash": "forged"},
                    "nested": {"qym_launch": {"token": TOKEN}},
                },
                "run_config": {"qym_launch": {"token": TOKEN}},
            },
        ),
        _event(
            run_id,
            2,
            "metadata_update",
            {
                "langfuse_url": "https://lf.example/x",
                "extra": {"qym_launch": leaked, "qym_new": 1, "origin": "official"},
            },
        ),
        _event(
            run_id,
            3,
            "run_completed",
            {
                "ended_at": "2026-03-23T00:01:00Z",
                "final_status": "COMPLETED",
                "summary": {
                    "run_metadata": {
                        "langfuse_url": "https://lf.example/y",
                        "qym_launch": leaked,
                        "qym_config": {"schema_hash": "forged"},
                    }
                },
            },
        ),
    ]


@pytest.mark.parametrize("official", [True, False], ids=["official", "local"])
def test_summary_merge_never_readds_token_or_changes_origin(
    client, sessions, seed, official, monkeypatch
):
    # Full event-log mode stores payloads verbatim; the token must still go.
    from qym_platform.services import event_storage

    event_storage.ingest_settings.cache_clear()
    monkeypatch.setenv("QYM_EVENT_LOG_MODE", "full")
    try:
        launch = _launch(seed) if official else _launch(seed, token="wrong")
        run_id = _create(client, launch)
        before = _run(sessions, run_id).run_metadata
        response = _send(client, run_id, _summary_events(run_id, seed))
        assert response.status_code == 200, response.text
    finally:
        event_storage.ingest_settings.cache_clear()

    run = _run(sessions, run_id)
    assert run.origin == (RunOrigin.OFFICIAL if official else RunOrigin.LOCAL)
    md = run.run_metadata
    # qym_* keys are fixed at create_run.
    assert md["qym_launch"] == before["qym_launch"]
    assert md["qym_config"] == {"schema_hash": "h1"}
    assert "qym_new" not in md
    assert md["team"] == "rag2"
    assert md["langfuse_url"] == "https://lf.example/y"
    assert md["nested"] == {"qym_launch": {}}
    _assert_no_token_stored(sessions)
    if official:
        assert _job(sessions, seed["job_id"]).run_id == run_id


def test_malformed_event_log_omits_input(client, sessions, seed, caplog):
    caplog.set_level(logging.DEBUG)
    run_id = _create(client, _launch(seed))
    bad = json.dumps(
        {
            "schema_version": 1,
            "event_id": "not-a-uuid",
            "sequence": "x",
            "type": "run_started",
            "run_id": run_id,
            "payload": {"run_metadata": {"qym_launch": {"token": TOKEN}}},
        }
    )
    response = _send(client, run_id, [bad])
    # A batch with nothing usable is a 422 (C005) that never echoes the input.
    assert response.status_code == 422
    assert TOKEN not in response.text
    assert TOKEN not in caplog.text

    # A valid envelope with an invalid payload is rejected without echoing input.
    invalid_payload = _event(
        run_id,
        1,
        "run_started",
        {"run_metadata": {"qym_launch": {"token": TOKEN}}},  # no task/dataset/...
    )
    response = _send(client, run_id, [invalid_payload])
    assert response.status_code == 422
    assert TOKEN not in response.text
    assert "started_at" in response.json()["rejected_events"][0]["error"]
    assert TOKEN not in caplog.text
    _assert_no_token_stored(sessions)


# ------------------------------------------------------------------- helpers


def test_strip_launch_token_is_deep_and_non_mutating():
    original = {
        "qym_launch": {"job_id": "j", "token": TOKEN},
        "list": [{"qym_launch": {"token": TOKEN, "x": 1}}],
        "token": "unrelated",
    }
    stripped = strip_launch_token(original)
    assert stripped == {
        "qym_launch": {"job_id": "j"},
        "list": [{"qym_launch": {"x": 1}}],
        "token": "unrelated",
    }
    assert original["qym_launch"]["token"] == TOKEN


def test_merge_run_metadata_protects_reserved_keys():
    current = {"qym_launch": {"job_id": "j"}, "a": 1}
    assert merge_run_metadata(current, {"qym_launch": {"token": TOKEN}, "b": 2}) == {
        "qym_launch": {"job_id": "j"},
        "a": 1,
        "b": 2,
    }
    assert merge_run_metadata(current, {"b": 2}, replace=True) == {
        "qym_launch": {"job_id": "j"},
        "b": 2,
    }
