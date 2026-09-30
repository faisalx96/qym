"""Experiments API (plan §14, issue #13): launch, list, detail, cancel, retry, clone."""

from __future__ import annotations

import json
import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.api.experiments import strip_secret_refs
from qym_platform.app import create_app
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AuditLog,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalExperimentStatus,
    EvalJobStatus,
    EvalModelSlotStatus,
    EvalPriority,
    Project,
    ProjectLlmConnection,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services.eval_experiments import (
    LaunchTokenUnavailable,
    aggregate_status,
    body_with_launch_token,
    cancel_job,
    hash_launch_token,
    launch_token_for_job,
    launch_token_hash_for_job,
    verify_launch_token,
)
from qym_platform.services.eval_model_slots import sync_model_slots

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
P1, P2 = "project-1", "project-2"
ADMIN = "admin@example.com"
MANAGER = "manager@example.com"
MEMBER = "member@example.com"
MEMBER2 = "member2@example.com"
OUTSIDER = "outsider@example.com"
CONN_KEY = "sk-connection-secret-ZZZZ9999"
PRIMARY = "endpoint:primary"

def _url(project_id: str = P1, suffix: str = "") -> str:
    return f"/v1/projects/{project_id}/experiments{suffix}"


def _headers(email: str) -> dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


# --------------------------------------------------------------------------- fixtures


@pytest.fixture()
def encryption(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )


@pytest.fixture()
def session_factory(encryption):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as s:
        s.add_all(
            [
                User(id="admin-1", email=ADMIN, role=UserRole.ADMIN),
                User(id="manager-1", email=MANAGER, role=UserRole.MEMBER),
                User(id="member-1", email=MEMBER, role=UserRole.MEMBER),
                User(id="member-2", email=MEMBER2, role=UserRole.MEMBER),
                User(id="outsider-1", email=OUTSIDER, role=UserRole.MEMBER),
                Project(id=P1, name="One", slug="p1", created_by_user_id="admin-1"),
                Project(id=P2, name="Two", slug="p2", created_by_user_id="admin-1"),
            ]
        )
        s.flush()
        s.add_all(
            [
                ProjectMembership(
                    project_id=P1, user_id="manager-1", role=ProjectRole.MANAGER
                ),
                ProjectMembership(
                    project_id=P1, user_id="member-1", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id=P1, user_id="member-2", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id=P2, user_id="outsider-1", role=ProjectRole.MANAGER
                ),
            ]
        )
        s.commit()
    try:
        yield SessionLocal
    finally:
        engine.dispose()


def _add_env(
    session_factory, name: str, project_id: str = P1, **values
) -> EvalEnvironment:
    with session_factory() as s:
        env = EvalEnvironment(
            project_id=project_id,
            name=name,
            base_url=f"https://{name}.example.com",
            allow_connection_keys=True,
            **values,
        )
        s.add(env)
        s.flush()
        schema = EvalEnvironmentSchema(
            environment_id=env.id,
            schema_hash="h-" + name,
            schema_json=json.loads(FIXTURE.read_text()),
        )
        s.add(schema)
        s.flush()
        for slot in sync_model_slots(s, env, schema):
            slot.status = EvalModelSlotStatus.CONFIRMED
        env.current_schema_id = schema.id
        s.commit()
        s.refresh(env)
        s.expunge(env)
        return env


@pytest.fixture()
def env(session_factory) -> EvalEnvironment:
    return _add_env(session_factory, "staging")


@pytest.fixture()
def conn(session_factory) -> ProjectLlmConnection:
    with session_factory() as s:
        row = ProjectLlmConnection(
            project_id=P1,
            name="GPT-4o prod",
            llm_model="gpt-4o",
            llm_base_url="https://llm.example.com/v1",
            llm_api_key_encrypted=encrypt_llm_api_key(CONN_KEY),
            llm_api_key_last4=CONN_KEY[-4:],
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        s.expunge(row)
        return row


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _spec(conn_id: str | None = None, **evaluator) -> dict:
    bindings = {PRIMARY: {"connection_id": conn_id}} if conn_id else {}
    # Without a bound primary slot, the schema requires a literal model name.
    primary = {"timeout": 60} if conn_id else {"timeout": 60, "model": "gpt-4o"}
    return {
        "evaluator": {
            "dataset": "playground_set_v2",
            "config": {"samples": 2, "report_k": 1, "run_metadata": {"team": "rag"}},
            **evaluator,
        },
        "slot_bindings": bindings,
        "env_overrides": {
            "LLM_OVERRIDES": {
                "endpoints": {"primary": primary},
                "main": {"endpoint": "primary"},
            },
            "MILVUS_SEARCH_THRESHOLD": 0.7,
        },
    }


def _create(client, env_ids, email=MEMBER, spec=None, **extra):
    body = {
        "name": "rag-vs-model",
        "environment_ids": env_ids,
        "spec": spec if spec is not None else _spec(),
        **extra,
    }
    return client.post(_url(), headers=_headers(email), json=body)


def _created(client, env_ids, **kwargs) -> dict:
    res = _create(client, env_ids, **kwargs)
    assert res.status_code == 200, res.text
    return res.json()


def _jobs(session_factory, experiment_id: str) -> list[EvalExperimentJob]:
    with session_factory() as s:
        rows = (
            s.query(EvalExperimentJob)
            .filter(EvalExperimentJob.experiment_id == experiment_id)
            .all()
        )
        for row in rows:
            s.expunge(row)
        return rows


def _set_job(session_factory, job_id: str, **values) -> None:
    with session_factory() as s:
        job = s.get(EvalExperimentJob, job_id)
        for key, value in values.items():
            setattr(job, key, value)
        s.commit()


# --------------------------------------------------------------------------- units


def test_launch_token_is_derived_per_job_and_only_hash_is_comparable(encryption):
    token = launch_token_for_job("job-1")
    assert token.startswith("qlt_") and token == launch_token_for_job("job-1")
    assert token != launch_token_for_job("job-2")
    assert launch_token_hash_for_job("job-1") == hash_launch_token(token)
    assert len(hash_launch_token(token)) == 64 and token not in hash_launch_token(token)
    assert verify_launch_token(token, launch_token_hash_for_job("job-1"))
    assert not verify_launch_token(token, launch_token_hash_for_job("job-2"))
    assert not verify_launch_token(None, launch_token_hash_for_job("job-1"))
    assert not verify_launch_token(token, None)

    stored = {"evaluator": {"config": {"run_metadata": {"qym_launch": {"a": 1}}}}}
    ready = body_with_launch_token(stored, "job-1")
    assert ready["evaluator"]["config"]["run_metadata"]["qym_launch"] == {
        "a": 1,
        "job_id": "job-1",
        "token": token,
    }
    assert "token" not in stored["evaluator"]["config"]["run_metadata"]["qym_launch"]


def test_launch_token_changes_with_key_and_needs_one(monkeypatch, encryption):
    before = launch_token_for_job("job-1")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    assert launch_token_for_job("job-1") != before
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", "")
    with pytest.raises(LaunchTokenUnavailable):
        launch_token_for_job("job-1")


@pytest.mark.parametrize(
    "statuses, expected",
    [
        ([], "QUEUED"),
        (["QUEUED", "BLOCKED"], "QUEUED"),
        (["QUEUED", "SUBMITTED"], "RUNNING"),
        (["QUEUED", "SUCCEEDED"], "RUNNING"),
        (["SUCCEEDED", "SUCCEEDED"], "COMPLETED"),
        (["SUCCEEDED", "FAILED"], "PARTIAL"),
        (["SUCCEEDED", "CANCELLED"], "PARTIAL"),
        (["CANCELLED", "CANCELLED"], "CANCELLED"),
        (["FAILED", "CANCELLED"], "FAILED"),
        (["TIMED_OUT"], "FAILED"),
    ],
)
def test_aggregate_status(statuses, expected):
    result = aggregate_status([EvalJobStatus(s) for s in statuses])
    assert result == EvalExperimentStatus(expected)


def test_strip_secret_refs_removes_refs_only():
    value = {
        "a": {"temporary": {"model": "m", "api_key": {"$secret": "k1"}}},
        "b": [{"$secret": "x"}, {"keep": 1}],
    }
    assert strip_secret_refs(value) == {
        "a": {"temporary": {"model": "m"}},
        "b": [{"keep": 1}],
    }
    assert value["a"]["temporary"]["api_key"] == {"$secret": "k1"}  # not mutated


@pytest.mark.parametrize(
    "status, lease_minutes, outcome, final",
    [
        ("QUEUED", None, "cancelled", "CANCELLED"),
        ("BLOCKED", None, "cancelled", "CANCELLED"),
        ("QUEUED", -1, "cancelled", "CANCELLED"),  # expired lease
        ("QUEUED", 1, "cancelling", "QUEUED"),  # dispatcher is submitting it
        ("SUBMITTING", 1, "cancelling", "SUBMITTING"),
        ("SUBMITTED", 1, "cancelling", "CANCELLING"),
        ("RUNNING", None, "cancelling", "CANCELLING"),
        ("CANCELLING", None, "cancelling", "CANCELLING"),
        ("SUCCEEDED", None, "already_terminal", "SUCCEEDED"),
        ("CANCELLED", None, "already_terminal", "CANCELLED"),
    ],
)
def test_cancel_job_outcomes(
    session_factory, env, status, lease_minutes, outcome, final
):
    with session_factory() as s:
        experiment = EvalExperiment(
            project_id=P1, created_by_user_id="member-1", name="x"
        )
        s.add(experiment)
        s.flush()
        job = EvalExperimentJob(
            experiment_id=experiment.id,
            environment_id=env.id,
            combo_index=0,
            schema_id=env.current_schema_id,
            params={},
            request_body={},
            status=EvalJobStatus(status),
            lease_owner="worker-1" if lease_minutes is not None else None,
            lease_until=(
                utc_now_naive() + timedelta(minutes=lease_minutes)
                if lease_minutes is not None
                else None
            ),
        )
        s.add(job)
        s.commit()

        assert cancel_job(s, job, user_id="member-1", reason="done") == outcome
        s.commit()
        assert job.status == EvalJobStatus(final)
        if outcome == "already_terminal" or status == "CANCELLING":
            assert job.cancel_requested_at is None  # nothing new was requested
        else:
            assert job.cancel_requested_at is not None
            assert job.cancelled_by_user_id == "member-1"
            assert job.cancel_reason == "done"
        assert (job.finished_at is not None) == (outcome == "cancelled")


# --------------------------------------------------------------------------- create


def test_create_persists_queued_job_with_hashed_token_and_named_bindings(
    client, session_factory, env, conn
):
    body = _created(client, [env.id], spec=_spec(conn.id))
    assert body["status"] == "QUEUED" and body["job_count"] == 1
    assert body["priority"] == "NORMAL"
    assert body["created_by_email"] == MEMBER
    assert "secrets_encrypted" not in body
    assert body["spec"]["slot_bindings"][PRIMARY] == {
        "connection_id": conn.id,
        "name": "GPT-4o prod",
        "model": "gpt-4o",
    }
    (job,) = _jobs(session_factory, body["id"])
    assert job.status == EvalJobStatus.QUEUED
    assert (job.combo_index, job.attempt, job.retry_of_job_id) == (0, 0, None)
    assert job.environment_id == env.id and job.schema_id == env.current_schema_id
    assert job.params == {"slot_bindings": body["spec"]["slot_bindings"]}

    # Only the sha256 of the derived token is stored; the raw token is nowhere.
    token = launch_token_for_job(job.id)
    assert job.launch_token_hash == hash_launch_token(token)
    stored = json.dumps(job.request_body) + json.dumps(job.params)
    res_text = client.get(_url(suffix=f"/{body['id']}"), headers=_headers(MEMBER)).text
    for text in (stored, json.dumps(body), res_text):
        assert token not in text
        assert CONN_KEY not in text

    request = job.request_body
    assert request["user_id"] == "member-1" and request["priority"] == "NORMAL"
    config = request["evaluator"]["config"]
    assert config["run_name"] == "rag-vs-model"
    assert config["live_mode"] == "platform"
    metadata = config["run_metadata"]
    assert metadata["team"] == "rag"
    assert metadata["qym_launch"] == {
        "experiment_id": body["id"],
        "job_id": job.id,
        "environment_id": env.id,
        "combo_index": 0,
        "attempt": 0,
    }
    assert metadata["qym_config"]["slot_bindings"] == body["spec"]["slot_bindings"]
    assert metadata["qym_config"]["schema_hash"] == "h-staging"
    assert metadata["qym_config"]["base_source"] == {"kind": "blank"}
    # Keys stay placeholders until dispatch; the model is bound for grouping.
    primary = request["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert primary["api_key"] == "{{qym:slot:endpoint:primary:api_key}}"
    assert request["evaluator"]["model"] == "{{qym:slot:endpoint:primary:model}}"

    with session_factory() as s:
        experiment = s.get(EvalExperiment, body["id"])
        assert experiment.secrets_encrypted is None
        assert experiment.created_by_user_id == "member-1"
        audits = s.query(AuditLog).filter(AuditLog.action == "eval_experiment.created")
        assert audits.count() == 1


def test_create_on_several_environments_makes_one_job_each(
    client, session_factory, env
):
    other = _add_env(session_factory, "prod")
    body = _created(client, [env.id, other.id, env.id])
    assert body["environment_ids"] == [env.id, other.id]
    assert body["job_count"] == 2
    names = sorted(j["run_name"] for j in body["jobs"])
    assert names == ["rag-vs-model · prod", "rag-vs-model · staging"]
    assert {j["environment_id"] for j in body["jobs"]} == {env.id, other.id}


def test_dry_run_previews_without_persisting_or_rate_limiting(
    client, session_factory, env, monkeypatch
):
    monkeypatch.setenv("QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT", "1")
    for _ in range(3):
        res = _create(client, [env.id], dry_run=True)
        assert res.status_code == 200, res.text
    preview = res.json()
    assert preview["dry_run"] is True and preview["ok"] is True
    assert preview["job_count"] == 1
    (job,) = preview["jobs"]
    assert job["run_name"] == "rag-vs-model" and job["errors"] == []
    assert job["request_body"]["evaluator"]["dataset"] == "playground_set_v2"
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0

    bad = _create(client, [env.id], dry_run=True, spec=_spec(dataset=None))
    assert bad.status_code == 200 and bad.json()["ok"] is False
    assert bad.json()["jobs"][0]["errors"]


def test_invalid_documents_are_rejected_with_pointed_errors(
    client, session_factory, env, conn
):
    spec = _spec(conn.id)
    spec["evaluator"]["config"]["run_metadata"]["qym_launch"] = {"token": "forged"}
    res = _create(client, [env.id], spec=spec)
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert any(e["rule"] == "reserved_key" for e in errors)
    assert all(e["environment_id"] == env.id for e in errors)

    missing = _create(client, [env.id], spec=_spec("no-such-connection"))
    assert missing.status_code == 422
    codes = {e.get("code") for e in missing.json()["detail"]["errors"]}
    assert "connection_missing" in codes

    swept = _spec()
    swept["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": []}
    assert _create(client, [env.id], spec=swept).status_code == 422

    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0


def test_temporary_model_without_its_key_is_rejected(client, session_factory, env):
    # Temporary models (#12) are covered in test_eval_temporary_models.py.
    spec = _spec()
    spec["slot_bindings"] = {
        PRIMARY: {
            "temporary": {
                "label": "trial",
                "model": "gpt-4o-mini",
                "base_url": "https://llm.example.com/v1",
                "api_key": {"$secret": "k1"},
            }
        }
    }
    res = _create(client, [env.id], spec=spec)
    assert res.status_code == 422
    codes = {e.get("code") for e in res.json()["detail"]["errors"]}
    assert "temporary_key_required" in codes
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0


def test_create_permissions_and_environment_scoping(client, session_factory, env):
    assert _create(client, [env.id], email=OUTSIDER).status_code == 403
    foreign = _add_env(session_factory, "foreign", project_id=P2)
    assert _create(client, [foreign.id]).status_code == 404
    assert _create(client, ["missing"]).status_code == 404

    disabled = _add_env(session_factory, "old", is_active=False)
    res = _create(client, [env.id, disabled.id])
    assert res.status_code == 409 and "disabled" in res.json()["detail"]

    no_schema = _add_env(session_factory, "fresh")
    with session_factory() as s:
        s.get(EvalEnvironment, no_schema.id).current_schema_id = None
        s.commit()
    res = _create(client, [no_schema.id])
    assert res.status_code == 422
    assert "no schema" in res.json()["detail"]["errors"][0]["message"]


def test_priority_caps_and_high_gating(client, session_factory, env):
    res = _create(client, [env.id], priority="HIGH", email=MANAGER)
    assert res.status_code == 422 and "exceeds" in res.json()["detail"]

    high_env = _add_env(
        session_factory,
        "high",
        max_priority=EvalPriority.HIGH,
        default_priority=EvalPriority.LOW,
    )
    assert _create(client, [high_env.id], priority="HIGH").status_code == 403
    # A non-manager is refused even with the acknowledgement.
    res = _create(client, [high_env.id], priority="HIGH", acknowledge_preemption=True)
    assert res.status_code == 403
    body = _created(
        client,
        [high_env.id],
        priority="HIGH",
        email=MANAGER,
        acknowledge_preemption=True,
    )
    assert body["priority"] == "HIGH" and body["preemption_acknowledged_at"]
    (job,) = _jobs(session_factory, body["id"])
    assert job.request_body["priority"] == "HIGH"

    # Without a requested priority, the lowest environment default is used.
    assert _created(client, [high_env.id, env.id])["priority"] == "LOW"


def test_high_priority_requires_preemption_acknowledgement(
    client, session_factory, env
):
    high_env = _add_env(session_factory, "high", max_priority=EvalPriority.HIGH)
    warning = (
        "Launching at HIGH cancels every running LOW/NORMAL job on high for all users."
    )

    res = _create(client, [high_env.id], priority="HIGH", email=MANAGER)
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "preemption_acknowledgement_required"
    assert warning in detail["message"]
    res = _create(
        client,
        [high_env.id],
        priority="HIGH",
        email=MANAGER,
        acknowledge_preemption=False,
    )
    assert res.status_code == 422
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0

    # A HIGH environment default counts as a HIGH request.
    default_high = _add_env(
        session_factory,
        "default-high",
        max_priority=EvalPriority.HIGH,
        default_priority=EvalPriority.HIGH,
    )
    res = _create(client, [default_high.id], email=MANAGER)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"

    # A dry run previews the warning instead of requiring the acknowledgement.
    preview = _create(
        client, [high_env.id], priority="HIGH", email=MANAGER, dry_run=True
    ).json()
    assert preview["ok"] is True and preview["preemption_warning"] == warning
    normal = _create(client, [env.id], dry_run=True).json()
    assert normal["preemption_warning"] is None

    # The acknowledgement flag is irrelevant below HIGH.
    body = _created(client, [env.id], acknowledge_preemption=True)
    assert body["priority"] == "NORMAL" and body["preemption_acknowledged_at"] is None


def test_high_retry_rechecks_manager_cap_and_acknowledgement(client, session_factory):
    high_env = _add_env(session_factory, "high", max_priority=EvalPriority.HIGH)
    created = _created(
        client,
        [high_env.id],
        priority="HIGH",
        email=MANAGER,
        acknowledge_preemption=True,
    )
    (job,) = _jobs(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.FAILED)
    retry_path = _url(suffix=f"/{created['id']}/jobs/{job.id}/retry")
    ack = {"acknowledge_preemption": True}

    # Missing acknowledgement (no body, or false) is refused before anything changes.
    res = client.post(retry_path, headers=_headers(MANAGER))
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"
    res = client.post(
        retry_path, headers=_headers(MANAGER), json={"acknowledge_preemption": False}
    )
    assert res.status_code == 422
    assert len(_jobs(session_factory, created["id"])) == 1

    # The environment cap is re-checked.
    with session_factory() as s:
        s.get(EvalEnvironment, high_env.id).max_priority = EvalPriority.NORMAL
        s.commit()
    res = client.post(retry_path, headers=_headers(MANAGER), json=ack)
    assert res.status_code == 422 and "exceeds" in res.json()["detail"]
    with session_factory() as s:
        s.get(EvalEnvironment, high_env.id).max_priority = EvalPriority.HIGH
        s.commit()

    res = client.post(retry_path, headers=_headers(MANAGER), json=ack)
    assert res.status_code == 200, res.text
    new = next(j for j in _jobs(session_factory, created["id"]) if j.id != job.id)
    assert new.request_body["priority"] == "HIGH"
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        assert experiment.preemption_acknowledged_at is not None
        audit = s.query(AuditLog).filter(AuditLog.action == "eval_job.retry").one()
        assert audit.after["priority"] == "HIGH"


def test_high_retry_by_non_manager_creator_is_refused(client, session_factory):
    high_env = _add_env(session_factory, "high", max_priority=EvalPriority.HIGH)
    created = _created(
        client,
        [high_env.id],
        priority="HIGH",
        email=MANAGER,
        acknowledge_preemption=True,
    )
    (job,) = _jobs(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.FAILED)
    # The creator is demoted to member: a HIGH retry now needs a manager.
    with session_factory() as s:
        membership = (
            s.query(ProjectMembership)
            .filter_by(project_id=P1, user_id=created["created_by_user_id"])
            .one()
        )
        membership.role = ProjectRole.MEMBER
        s.commit()
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"),
        headers=_headers(MANAGER),
        json={"acknowledge_preemption": True},
    )
    assert res.status_code == 403
    assert len(_jobs(session_factory, created["id"])) == 1


def test_creation_is_rate_limited_per_user(client, env, monkeypatch):
    monkeypatch.setenv("QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT", "2")
    monkeypatch.setenv("QYM_EVAL_EXPERIMENT_CREATE_RATE_WINDOW_SECONDS", "600")
    _created(client, [env.id])
    _created(client, [env.id])
    res = _create(client, [env.id])
    assert res.status_code == 429
    assert 1 <= int(res.headers["Retry-After"]) <= 600
    # Another user has their own budget; 0 disables the limit.
    _created(client, [env.id], email=MANAGER)
    monkeypatch.setenv("QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT", "0")
    _created(client, [env.id])


# --------------------------------------------------------------------------- read


def test_list_filters_by_status_environment_and_creator(client, session_factory, env):
    other = _add_env(session_factory, "prod")
    first = _created(client, [env.id])
    second = _created(client, [other.id], email=MANAGER)
    with session_factory() as s:
        s.get(EvalExperiment, second["id"]).status = EvalExperimentStatus.COMPLETED
        s.commit()

    def ids(**params):
        res = client.get(_url(), headers=_headers(MEMBER), params=params)
        assert res.status_code == 200, res.text
        return [x["id"] for x in res.json()["experiments"]]

    assert set(ids()) == {first["id"], second["id"]}
    assert ids(status="COMPLETED") == [second["id"]]
    assert ids(environment_id=env.id) == [first["id"]]
    assert ids(created_by="manager-1") == [second["id"]]
    assert ids(mine="true") == [first["id"]]
    assert len(ids(limit=1, offset=1)) == 1
    listed = client.get(_url(), headers=_headers(MEMBER)).json()
    assert listed["total"] == 2
    counts = {x["id"]: x["job_counts"] for x in listed["experiments"]}
    assert counts[first["id"]] == {"QUEUED": 1}
    assert client.get(_url(), headers=_headers(OUTSIDER)).status_code == 403
    assert client.get(_url(P2), headers=_headers(OUTSIDER)).json()["total"] == 0


def test_detail_has_job_matrix_and_linked_run_summary(client, session_factory, env):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    with session_factory() as s:
        run = Run(
            project_id=P1,
            created_by_user_id="member-1",
            owner_user_id="member-1",
            task="agent",
            dataset="playground_set_v2",
            model="gpt-4o",
            status=RunWorkflowStatus.RUNNING,
        )
        s.add(run)
        s.flush()
        row = s.get(EvalExperimentJob, job.id)
        row.run_id = run.id
        row.status = EvalJobStatus.RUNNING
        s.commit()
        run_id = run.id

    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER2))
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["environments"] == [
        {"id": env.id, "name": "staging", "is_active": True}
    ]
    (row,) = payload["jobs"]
    assert row["status"] == "RUNNING" and row["environment_name"] == "staging"
    assert row["run"]["id"] == run_id and row["run"]["status"] == "RUNNING"
    assert row["run"]["model"] == "gpt-4o" and row["superseded"] is False
    assert "launch_token_hash" not in row and "request_body" not in row

    missing = client.get(_url(suffix="/missing"), headers=_headers(MEMBER))
    assert missing.status_code == 404
    elsewhere = client.get(_url(P2, f"/{created['id']}"), headers=_headers(OUTSIDER))
    assert elsewhere.status_code == 404


# --------------------------------------------------------------------------- cancel


def test_cancel_permissions_creator_or_manager(client, session_factory, env):
    created = _created(client, [env.id])
    path = _url(suffix=f"/{created['id']}/cancel")
    assert client.post(path, headers=_headers(MEMBER2)).status_code == 403
    assert client.post(path, headers=_headers(OUTSIDER)).status_code == 403
    (job,) = _jobs(session_factory, created["id"])
    job_path = _url(suffix=f"/{created['id']}/jobs/{job.id}/cancel")
    assert client.post(job_path, headers=_headers(MEMBER2)).status_code == 403

    res = client.post(path, headers=_headers(MANAGER), json={"reason": "not needed"})
    assert res.status_code == 200, res.text
    assert res.json()["outcomes"] == {job.id: "cancelled"}
    experiment = res.json()["experiment"]
    assert experiment["status"] == "CANCELLED" and experiment["cancelled_at"]
    (job,) = _jobs(session_factory, created["id"])
    assert job.status == EvalJobStatus.CANCELLED
    assert job.cancelled_by_user_id == "manager-1"
    assert job.cancel_reason == "not needed" and job.finished_at is not None

    again = client.post(job_path, headers=_headers(MEMBER))
    assert again.status_code == 200 and again.json()["outcome"] == "already_terminal"


def test_cancel_submitted_and_leased_jobs_defers_to_dispatcher(
    client, session_factory, env
):
    other = _add_env(session_factory, "prod")
    created = _created(client, [env.id, other.id])
    jobs = {j.environment_id: j for j in _jobs(session_factory, created["id"])}
    running, leased = jobs[env.id], jobs[other.id]
    _set_job(session_factory, running.id, status=EvalJobStatus.RUNNING)
    _set_job(
        session_factory,
        leased.id,
        lease_owner="worker-1",
        lease_until=utc_now_naive() + timedelta(minutes=1),
    )

    res = client.post(_url(suffix=f"/{created['id']}/cancel"), headers=_headers(MEMBER))
    assert res.status_code == 200
    assert res.json()["outcomes"] == {
        running.id: "cancelling",
        leased.id: "cancelling",
    }
    after = {j.id: j for j in _jobs(session_factory, created["id"])}
    assert after[running.id].status == EvalJobStatus.CANCELLING
    assert after[running.id].cancel_requested_at is not None
    # The dispatcher holds the lease: only the request is recorded.
    assert after[leased.id].status == EvalJobStatus.QUEUED
    assert after[leased.id].cancel_requested_at is not None
    assert res.json()["experiment"]["status"] == "RUNNING"

    # An expired lease no longer protects a queued job.
    _set_job(
        session_factory, leased.id, lease_until=utc_now_naive() - timedelta(minutes=1)
    )
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{leased.id}/cancel"),
        headers=_headers(MEMBER),
    )
    assert res.json()["outcome"] == "cancelled"


# --------------------------------------------------------------------------- retry


def test_retry_creates_a_new_attempt_row_with_a_new_token(client, session_factory, env):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    retry_path = _url(suffix=f"/{created['id']}/jobs/{job.id}/retry")

    assert client.post(retry_path, headers=_headers(MEMBER)).status_code == 409
    _set_job(
        session_factory,
        job.id,
        status=EvalJobStatus.FAILED,
        finished_at=utc_now_naive(),
    )
    assert client.post(retry_path, headers=_headers(MEMBER2)).status_code == 403

    res = client.post(retry_path, headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    new_id = res.json()["job_id"]
    rows = {j.id: j for j in _jobs(session_factory, created["id"])}
    assert set(rows) == {job.id, new_id}
    old, new = rows[job.id], rows[new_id]
    assert old.status == EvalJobStatus.FAILED  # kept for history
    assert new.status == EvalJobStatus.QUEUED
    assert (new.combo_index, new.attempt, new.retry_of_job_id) == (0, 1, job.id)
    assert new.environment_id == old.environment_id
    assert new.schema_id == old.schema_id and new.params == old.params
    assert new.launch_token_hash == launch_token_hash_for_job(new_id)
    assert new.launch_token_hash != old.launch_token_hash
    launch = new.request_body["evaluator"]["config"]["run_metadata"]["qym_launch"]
    assert launch["job_id"] == new_id and launch["retry_of_job_id"] == job.id
    assert launch["attempt"] == 1 and "token" not in launch
    assert new.request_body["env_overrides"] == old.request_body["env_overrides"]

    experiment = res.json()["experiment"]
    assert experiment["status"] == "QUEUED"  # the failed attempt is superseded
    assert experiment["job_counts"] == {"QUEUED": 1}
    by_id = {j["id"]: j for j in experiment["jobs"]}
    assert by_id[job.id]["superseded"] is True
    assert by_id[new_id]["superseded"] is False

    # Only the latest attempt can be retried.
    again = client.post(retry_path, headers=_headers(MANAGER))
    assert again.status_code == 409 and new_id in again.json()["detail"]

    _set_job(session_factory, new_id, status=EvalJobStatus.SUCCEEDED)
    succeeded = client.post(
        _url(suffix=f"/{created['id']}/jobs/{new_id}/retry"), headers=_headers(MEMBER)
    )
    assert succeeded.status_code == 409


def test_retry_of_blocked_job_cancels_it_and_manager_may_retry(
    client, session_factory, env
):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    _set_job(
        session_factory,
        job.id,
        status=EvalJobStatus.BLOCKED,
        wait_reason='Model "GPT" no longer exists',
    )
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MANAGER)
    )
    assert res.status_code == 200, res.text
    rows = {j.id: j for j in _jobs(session_factory, created["id"])}
    assert rows[job.id].status == EvalJobStatus.CANCELLED
    assert rows[res.json()["job_id"]].attempt == 1


# --------------------------------------------------------------------------- clone


def test_clone_prefills_form_without_secrets(client, session_factory, env, conn):
    created = _created(client, [env.id], spec=_spec(conn.id))
    # Simulate a temporary model (#12) stored with a key ref and an encrypted blob.
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        spec = json.loads(json.dumps(experiment.spec))
        spec["slot_bindings"]["endpoint:fast"] = {
            "temporary": {
                "label": "trial",
                "model": "gpt-4o-mini",
                "base_url": "https://llm.example.com/v1",
                "api_key": {"$secret": "k1"},
            }
        }
        experiment.spec = spec
        experiment.secrets_encrypted = encrypt_llm_api_key('{"k1": "sk-temp-XYZ"}')
        s.commit()
        blob = experiment.secrets_encrypted

    res = client.post(_url(suffix=f"/{created['id']}/clone"), headers=_headers(MEMBER2))
    assert res.status_code == 200, res.text
    prefill = res.json()
    text = json.dumps(prefill)
    assert "secrets_encrypted" not in text and blob not in text
    assert "$secret" not in text and "sk-temp-XYZ" not in text
    assert prefill["name"] == "rag-vs-model (copy)"
    assert prefill["environment_ids"] == [env.id]
    assert prefill["base_source"] == {"kind": "clone", "experiment_id": created["id"]}
    assert prefill["spec"]["slot_bindings"]["endpoint:fast"] == {
        "temporary": {
            "label": "trial",
            "model": "gpt-4o-mini",
            "base_url": "https://llm.example.com/v1",
        }
    }
    assert prefill["spec"]["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    # Nothing is persisted by a clone, and detail never shows secrets either.
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 1
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER))
    assert "$secret" not in detail.text and blob not in detail.text

    outsider = client.post(
        _url(suffix=f"/{created['id']}/clone"), headers=_headers(OUTSIDER)
    )
    assert outsider.status_code == 403
