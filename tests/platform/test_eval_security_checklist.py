"""Security checklist (plan §15, issue #42), verified end to end through the API.

Each test names the §15 item it covers; ``docs/internal/EVAL_SECURITY_CHECKLIST.md``
maps every item to its enforcing code and to these and the per-feature tests.

The Evaluation Service is an ``httpx.MockTransport`` behind the **real**
``EvalServiceClient``, so the D1 redaction runs on every response exactly as in
production. The service echoes provider keys in ``env_overrides`` (as a flattened JSON
string, like the real service) and the launch token in ``eval_input``.
"""

from __future__ import annotations

import copy
import json
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.api.eval_environments import get_eval_client_factory
from qym_platform.app import create_app
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    EvalEnvironment,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunOrigin,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.eval_dispatcher import EvalDispatcher
from qym_platform.services.eval_experiments import launch_token_for_job
from qym_platform.services.eval_remote_queue import RemoteQueueSnapshotter
from qym_platform.services.eval_service_client import EvalServiceClient

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
P1, P2 = "project-1", "project-2"
ADMIN = "admin@example.com"
MANAGER = "manager@example.com"
MEMBER = "member@example.com"
MEMBER2 = "member2@example.com"
ENV_URL = "https://eval.example.com/prefix"
ENV_KEY = "env-service-key-SECRET-7777"
CONN_KEY = "sk-connection-SECRET-8888"
TEMP_KEY = "sk-temporary-SECRET-9999"
INGEST_KEY = "one-ingest-key-for-project-one"
OTHER_INGEST_KEY = "two-ingest-key-for-project-two"
PRIMARY = "endpoint:primary"
TEMPORARY = {
    "label": "mini trial",
    "model": "gpt-4o-mini",
    "base_url": "https://llm.example.com/v1",
}


def _headers(email: str) -> Dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def _envs_url(project_id: str = P1, suffix: str = "") -> str:
    return f"/v1/projects/{project_id}/eval-environments{suffix}"


def _exp_url(project_id: str = P1, suffix: str = "") -> str:
    return f"/v1/projects/{project_id}/experiments{suffix}"


def _queue_url(project_id: str = P1, suffix: str = "") -> str:
    return f"/v1/projects/{project_id}/eval-queue{suffix}"


# --------------------------------------------------------------------------- fakes


class Clock:
    def __init__(self) -> None:
        self.now = utc_now_naive() + timedelta(seconds=1)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


class EvalService:
    """A leaky Evaluation Service: echoes every key and token it receives (D1)."""

    def __init__(self) -> None:
        self.schema = json.loads(FIXTURE.read_text())
        self.lock = threading.Lock()
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.bodies: List[Dict[str, Any]] = []
        self.cancels: List[str] = []

    def _read(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """``EvalJobRead`` with ``LLM_OVERRIDES`` flattened to a JSON string."""
        out = copy.deepcopy(job)
        overrides = dict(out.get("env_overrides") or {})
        if "LLM_OVERRIDES" in overrides:
            overrides["LLM_OVERRIDES"] = json.dumps(overrides["LLM_OVERRIDES"])
        out["env_overrides"] = overrides
        return out

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {ENV_KEY}":
            return httpx.Response(401, json={"detail": "Invalid or missing API key"})
        path = request.url.path.removeprefix("/prefix")
        with self.lock:
            if path == "/evals/env-overrides/schema":
                return httpx.Response(200, json=self.schema)
            if path == "/evals" and request.method == "POST":
                body = json.loads(request.content)
                self.bodies.append(copy.deepcopy(body))
                rid = str(uuid4())
                self.jobs[rid] = {
                    "id": rid,
                    "status": "PENDING",
                    "priority": body.get("priority"),
                    "user_id": body.get("user_id"),
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "env_overrides": body.get("env_overrides") or {},
                    "eval_input": body.get("evaluator"),
                    "result": None,
                    "error": None,
                }
                return httpx.Response(202, json=self._read(self.jobs[rid]))
            if path == "/evals":
                status = request.url.params.get("status")
                items = [
                    self._read(job)
                    for job in self.jobs.values()
                    if status is None or job["status"] == status
                ]
                return httpx.Response(
                    200,
                    json={
                        "total": len(items),
                        "limit": 50,
                        "offset": 0,
                        "items": items,
                    },
                )
            parts = path.split("/")  # ["", "evals", id, ("cancel")]
            job = self.jobs.get(parts[2]) if len(parts) >= 3 else None
            if job is None:
                return httpx.Response(404, json={"detail": "eval job not found"})
            if len(parts) == 4 and parts[3] == "cancel":
                if job["status"] not in ("PENDING", "RUNNING"):
                    return httpx.Response(
                        409,
                        json={"detail": f"cannot cancel job in status {job['status']}"},
                    )
                self.cancels.append(job["id"])
                job["status"] = "CANCELLED"
                return httpx.Response(200, json=self._read(job))
            return httpx.Response(200, json=self._read(job))

    def factory(self, base_url: str, api_key: str) -> EvalServiceClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
        return EvalServiceClient(
            base_url, api_key, allow_private=False, http_client=http
        )


# --------------------------------------------------------------------------- fixtures


@pytest.fixture()
def sessions(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "false")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as s:
        s.add_all(
            [
                User(id="admin-1", email=ADMIN, role=UserRole.ADMIN),
                User(id="manager-1", email=MANAGER, role=UserRole.MEMBER),
                User(id="member-1", email=MEMBER, role=UserRole.MEMBER),
                User(id="member-2", email=MEMBER2, role=UserRole.MEMBER),
                User(id="ingest-1", email="ingest@example.com", role=UserRole.MEMBER),
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
                    project_id=P1, user_id="ingest-1", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id=P2, user_id="ingest-1", role=ProjectRole.MEMBER
                ),
            ]
        )
        for project_id, token in ((P1, INGEST_KEY), (P2, OTHER_INGEST_KEY)):
            s.add(
                ApiKey(
                    id=str(uuid4()),
                    user_id="ingest-1",
                    project_id=project_id,
                    name="env ingest",
                    prefix=api_key_prefix(token),
                    key_hash=hash_api_key(token),
                    scopes=[],
                )
            )
        s.commit()
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def service() -> EvalService:
    return EvalService()


@pytest.fixture()
def client(sessions, service):
    app = create_app()

    def override_get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_eval_client_factory] = lambda: service.factory
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


# --------------------------------------------------------------------------- helpers


def _create_env(client, **extra) -> Dict[str, Any]:
    """Register the environment through the API and confirm its proposed slots."""
    body = {
        "name": "staging",
        "base_url": ENV_URL,
        "api_key": ENV_KEY,
        "allow_connection_keys": True,
        **extra,
    }
    res = client.post(_envs_url(), headers=_headers(MANAGER), json=body)
    assert res.status_code == 200, res.text
    created = res.json()
    env_id = created["environment"]["id"]
    confirm = client.put(
        _envs_url(suffix=f"/{env_id}/model-slots"),
        headers=_headers(MANAGER),
        json={
            "slots": created["slots"],
            "schema_id": created["environment"]["current_schema_id"],
        },
    )
    assert confirm.status_code == 200, confirm.text
    return created["environment"]


def _create_connection(client) -> str:
    res = client.post(
        f"/v1/projects/{P1}/llm-connections",
        headers=_headers(MANAGER),
        json={
            "name": "GPT-4o prod",
            "llm_base_url": "https://llm.example.com/v1",
            "llm_model": "gpt-4o",
            "llm_api_key": CONN_KEY,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return (body.get("connection") or body)["id"]


def _spec(primary_binding: Any = None, **run_metadata) -> Dict[str, Any]:
    endpoint: Dict[str, Any] = {"timeout": 60}
    if primary_binding is None:
        endpoint["model"] = "gpt-4o"
    return {
        "evaluator": {
            "dataset": "playground_set_v2",
            "config": {
                "samples": 1,
                "report_k": 1,
                "run_metadata": {"team": "rag", **run_metadata},
            },
        },
        "slot_bindings": {PRIMARY: primary_binding} if primary_binding else {},
        "env_overrides": {
            "LLM_OVERRIDES": {
                "endpoints": {"primary": endpoint},
                "main": {"endpoint": "primary"},
            }
        },
    }


def _launch(client, env_id, spec, email=MEMBER, **extra):
    body = {"name": "security-e2e", "environment_ids": [env_id], "spec": spec, **extra}
    return client.post(_exp_url(), headers=_headers(email), json=body)


def _jobs(sessions, experiment_id: str) -> List[EvalExperimentJob]:
    with sessions() as s:
        rows = (
            s.query(EvalExperimentJob)
            .filter(EvalExperimentJob.experiment_id == experiment_id)
            .order_by(EvalExperimentJob.combo_index)
            .all()
        )
        for row in rows:
            s.expunge(row)
        return rows


def _dump_database(sessions) -> str:
    """Every column of every row of every table, as text."""
    chunks = []
    with sessions() as s:
        for table in Base.metadata.sorted_tables:
            for row in s.execute(text(f'SELECT * FROM "{table.name}"')).mappings():
                chunks.append(
                    table.name + " " + json.dumps({k: str(v) for k, v in row.items()})
                )
    return "\n".join(chunks)


def _log_text(caplog) -> str:
    lines = []
    for record in caplog.records:
        lines.append(record.getMessage())
        if record.exc_text:
            lines.append(record.exc_text)
    return "\n".join(lines)


def _assert_absent(secrets: List[str], where: str, haystack: str) -> None:
    for secret in secrets:
        assert secret not in haystack, f"secret leaked into {where}"


# --------------------------------------------------------------------------- §15: full flow


def test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel(
    client, sessions, service, caplog
):
    """§15 items 1, 5, 6: Fernet at rest; never returned, logged or stored in plain.

    One experiment sweeps the primary model over a saved connection and a temporary
    model. It is dispatched to a service that echoes every key and token back, one run
    is ingested with the launch metadata the SDK would send, then everything is
    cancelled from the queue and the orphan snapshot is refreshed. Afterwards no API
    response, log record (DEBUG, all loggers), audit row or any other database row
    holds the environment key, a provider key or a launch token.
    """
    caplog.set_level(logging.DEBUG)
    responses: List[httpx.Response] = []

    def call(method: str, url: str, email: str = MEMBER, **kwargs) -> httpx.Response:
        res = client.request(method, url, headers=_headers(email), **kwargs)
        responses.append(res)
        return res

    env = _create_env(client)
    conn_id = _create_connection(client)
    spec = _spec(
        {
            "sweep": [
                {"connection_id": conn_id},
                {"temporary": {**TEMPORARY, "api_key": {"$secret": "k1"}}},
            ]
        }
    )
    launched = _launch(client, env["id"], spec, secrets={"k1": TEMP_KEY})
    responses.append(launched)
    assert launched.status_code == 200, launched.text
    experiment_id = launched.json()["id"]
    jobs = _jobs(sessions, experiment_id)
    assert len(jobs) == 2
    tokens = [launch_token_for_job(job.id) for job in jobs]
    secrets = [ENV_KEY, CONN_KEY, TEMP_KEY, *tokens]

    # Stored encrypted: the ciphertext is there, the plaintext is not.
    with sessions() as s:
        env_row = s.get(EvalEnvironment, env["id"])
        assert env_row.api_key_encrypted and env_row.api_key_last4 == ENV_KEY[-4:]
        assert s.get(EvalExperiment, experiment_id).secrets_encrypted

    # Dispatch: the service receives the keys and the token (in memory only).
    clock = Clock()
    dispatcher = EvalDispatcher(sessions, client_factory=service.factory, clock=clock)
    try:
        dispatcher.tick()
        jobs = _jobs(sessions, experiment_id)
        assert [j.status for j in jobs] == [EvalJobStatus.SUBMITTED] * 2, [
            j.wait_reason for j in jobs
        ]
        sent = json.dumps(service.bodies)
        for secret in (CONN_KEY, TEMP_KEY, *tokens):
            assert secret in sent

        # Ingest: the environment's worker creates the run with the metadata it got.
        body = next(
            b
            for b in service.bodies
            if b["evaluator"]["config"]["run_metadata"]["qym_launch"]["job_id"]
            == jobs[0].id
        )
        metadata = body["evaluator"]["config"]["run_metadata"]
        created = client.post(
            "/v1/runs",
            headers={"Authorization": f"Bearer {INGEST_KEY}"},
            json={
                "task": "t",
                "dataset": "playground_set_v2",
                "metrics": [],
                "run_metadata": metadata,
                "run_config": {"evaluator": body["evaluator"]},
            },
        )
        responses.append(created)
        assert created.status_code == 200, created.text
        run_id = created.json()["run_id"]
        with sessions() as s:
            run = s.get(Run, run_id)
            assert run.origin == RunOrigin.OFFICIAL
            assert run.run_metadata["qym_launch"]["job_id"] == jobs[0].id
            assert "token" not in run.run_metadata["qym_launch"]

        # The service reports RUNNING; the dispatcher polls (the echo is redacted).
        for job in jobs:
            service.jobs[job.remote_job_id]["status"] = "RUNNING"
        clock.advance(60)
        dispatcher.tick()

        # Read everything a member can see while the jobs are live.
        for url in (
            _exp_url(),
            _exp_url(suffix=f"/{experiment_id}"),
            _queue_url(),
            _queue_url(suffix="/remote"),
            _envs_url(),
            _envs_url(suffix=f"/{env['id']}"),
            _envs_url(suffix=f"/{env['id']}/model-options"),
            f"/v1/projects/{P1}/llm-connections",
            f"/api/runs/{run_id}",
        ):
            assert call("GET", url).status_code == 200, url
        assert (
            call("POST", _exp_url(suffix=f"/{experiment_id}/clone")).status_code == 200
        )

        # The remote snapshot holds only allow-listed columns.
        snapshotter = RemoteQueueSnapshotter(
            sessions, client_factory=service.factory, clock=clock
        )
        try:
            snapshotter.refresh(env["id"], force=True)
        finally:
            snapshotter.close()
        assert call("GET", _queue_url(suffix="/remote")).status_code == 200

        # Cancel from the queue; the dispatcher performs the remote cancel.
        cancel = call(
            "POST",
            _queue_url(suffix="/cancel"),
            json={"job_ids": [j.id for j in jobs], "reason": "security e2e"},
        )
        assert cancel.status_code == 200, cancel.text
        assert set(cancel.json()["outcomes"].values()) == {"cancelling"}
        clock.advance(60)
        dispatcher.tick()
    finally:
        dispatcher.close()

    jobs = _jobs(sessions, experiment_id)
    assert [j.status for j in jobs] == [EvalJobStatus.CANCELLED] * 2
    assert sorted(service.cancels) == sorted(j.remote_job_id for j in jobs)
    with sessions() as s:
        # Temporary keys are cleared once every job settled.
        assert s.get(EvalExperiment, experiment_id).secrets_encrypted is None
        assert (
            s.query(AuditLog).filter(AuditLog.action == "eval_job.cancel").count() == 2
        )
    assert call("GET", _exp_url(suffix=f"/{experiment_id}")).status_code == 200
    assert call("GET", _queue_url(suffix="/remote")).status_code == 200

    for res in responses:
        _assert_absent(secrets, f"response {res.request.url}", res.text)
    _assert_absent(secrets, "logs", _log_text(caplog))
    _assert_absent(secrets, "database", _dump_database(sessions))


# --------------------------------------------------------------------------- §15: 422 echo


def test_validation_errors_never_echo_submitted_keys(client, sessions):
    """§15 item 1 (never returned): a malformed request is not a way to read a key back.

    FastAPI's default 422 echoes the whole body as ``input`` for a missing field.
    """
    cases = [
        (_envs_url(), {"base_url": ENV_URL, "api_key": ENV_KEY}),
        (_envs_url(), {"name": "n", "base_url": ENV_URL, "api_key": [ENV_KEY]}),
        (
            f"/v1/projects/{P1}/llm-connections",
            {"llm_base_url": "https://llm.example.com/v1", "llm_api_key": CONN_KEY},
        ),
        (
            _exp_url(),
            {"environment_ids": ["e"], "spec": {}, "secrets": {"k1": TEMP_KEY}},
        ),
        (
            "/v1/runs",
            {"run_metadata": {"qym_launch": {"token": "qlt_" + "x" * 20}}},
        ),
    ]
    for url, body in cases:
        headers = _headers(MANAGER)
        if url == "/v1/runs":
            headers = {"Authorization": f"Bearer {INGEST_KEY}"}
        res = client.post(url, headers=headers, json=body)
        assert res.status_code == 422, (url, res.text)
        assert res.json()["detail"], url
        _assert_absent([ENV_KEY, CONN_KEY, TEMP_KEY, "qlt_" + "x" * 20], url, res.text)
    # The error still says what is wrong.
    res = client.post(_envs_url(), headers=_headers(MANAGER), json=cases[0][1])
    assert res.json()["detail"][0]["loc"] == ["body", "name"]
    assert res.json()["detail"][0]["input"]["base_url"] == ENV_URL


# --------------------------------------------------------------------------- §15: base URLs


def test_base_url_policy_for_environments_connections_and_temporary_models(
    client, sessions, monkeypatch
):
    """§15 item 3: HTTPS-only environments; private addresses refused everywhere."""
    manager = _headers(MANAGER)
    for url in (
        "http://eval.example.com",
        "https://10.0.0.5",
        "https://127.0.0.1:8000",
    ):
        res = client.post(
            _envs_url(),
            headers=manager,
            json={"name": "x", "base_url": url, "api_key": ENV_KEY},
        )
        assert res.status_code == 400, (url, res.text)
    for url in ("https://10.0.0.5/v1", "http://169.254.169.254/latest"):
        res = client.post(
            f"/v1/projects/{P1}/llm-connections",
            headers=manager,
            json={"name": "c", "llm_base_url": url, "llm_api_key": CONN_KEY},
        )
        assert res.status_code == 400, (url, res.text)

    env = _create_env(client)
    for url in ("https://192.168.1.10/v1", "http://127.0.0.1:11434/v1"):
        temporary = {**TEMPORARY, "base_url": url, "api_key": {"$secret": "k1"}}
        res = _launch(
            client, env["id"], _spec({"temporary": temporary}), secrets={"k1": TEMP_KEY}
        )
        assert res.status_code == 422, (url, res.text)
        assert TEMP_KEY not in res.text
    assert _dump_database(sessions).count("eval_experiments ") == 0


# --------------------------------------------------------------------------- §15: opt-in


def test_connection_key_opt_in_is_manager_only_and_keys_follow_it(client, service):
    """§15 item 4: only a manager enables ``allow_connection_keys``; keys follow it."""
    env = _create_env(client, allow_connection_keys=False)
    conn_id = _create_connection(client)
    for email in (MEMBER, MEMBER2):
        res = client.put(
            _envs_url(suffix=f"/{env['id']}"),
            headers=_headers(email),
            json={"allow_connection_keys": True},
        )
        assert res.status_code == 403
    res = client.post(
        _envs_url(),
        headers=_headers(MEMBER),
        json={
            "name": "m",
            "base_url": "https://m.example.com",
            "api_key": ENV_KEY,
            "allow_connection_keys": True,
        },
    )
    assert res.status_code == 403

    # Without the opt-in a connection with a key is refused at launch.
    res = _launch(client, env["id"], _spec({"connection_id": conn_id}))
    assert res.status_code == 422, res.text
    assert "keys_not_allowed" in res.text
    assert CONN_KEY not in json.dumps(service.bodies)

    res = client.put(
        _envs_url(suffix=f"/{env['id']}"),
        headers=_headers(MANAGER),
        json={"allow_connection_keys": True},
    )
    assert res.status_code == 200, res.text
    assert res.json()["allow_connection_keys"] is True


# --------------------------------------------------------------------------- §15: placeholders


def test_user_placeholders_and_reserved_keys_are_refused_on_launch_and_presets(
    client, sessions
):
    """§15 item 6: user input can't set ``qym_*`` keys or write ``{{qym:`` placeholders.

    A placeholder in a free-text field would be filled with the bound key at dispatch
    and so copied into run metadata; it is refused before anything is stored.
    """
    env = _create_env(client)
    conn_id = _create_connection(client)
    attempts = [
        _spec({"connection_id": conn_id}, note="{{qym:slot:endpoint:primary:api_key}}"),
        _spec({"connection_id": conn_id}, qym_launch={"job_id": "forged"}),
        _spec({"connection_id": conn_id}, qym_config={"forged": True}),
    ]
    for spec in attempts:
        res = _launch(client, env["id"], spec)
        assert res.status_code == 422, res.text
        preset = client.post(
            _envs_url(suffix=f"/{env['id']}/presets"),
            headers=_headers(MEMBER),
            json={"kind": "saved", "name": "p-" + uuid4().hex[:6], "config": spec},
        )
        assert preset.status_code == 422, preset.text
    with sessions() as s:
        assert s.query(EvalExperiment).count() == 0


# --------------------------------------------------------------------------- §15: HIGH


def test_high_priority_needs_manager_cap_and_acknowledgement(client, sessions):
    """§15 item 7 (D9): HIGH is gated by the env cap, the role and the acknowledgement."""
    env = _create_env(client)
    spec = _spec()
    # Cap: the env allows NORMAL at most.
    res = _launch(
        client,
        env["id"],
        spec,
        email=MANAGER,
        priority="HIGH",
        acknowledge_preemption=True,
    )
    assert res.status_code == 422 and "exceeds the maximum" in res.text, res.text
    res = client.put(
        _envs_url(suffix=f"/{env['id']}"),
        headers=_headers(MANAGER),
        json={"max_priority": "HIGH"},
    )
    assert res.status_code == 200, res.text
    # Role: a member can't, even acknowledged.
    res = _launch(client, env["id"], spec, priority="HIGH", acknowledge_preemption=True)
    assert res.status_code == 403, res.text
    # Acknowledgement: a manager must acknowledge.
    res = _launch(client, env["id"], spec, email=MANAGER, priority="HIGH")
    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"
    res = _launch(
        client,
        env["id"],
        spec,
        email=MANAGER,
        priority="HIGH",
        acknowledge_preemption=True,
    )
    assert res.status_code == 200, res.text
    experiment_id = res.json()["id"]
    (job,) = _jobs(sessions, experiment_id)
    with sessions() as s:
        s.get(EvalExperimentJob, job.id).status = EvalJobStatus.FAILED
        s.commit()

    # Retry re-checks the policy.
    retry = _exp_url(suffix=f"/{experiment_id}/jobs/{job.id}/retry")
    res = client.post(retry, headers=_headers(MANAGER), json={})
    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"
    res = client.post(
        retry, headers=_headers(MEMBER), json={"acknowledge_preemption": True}
    )
    assert res.status_code == 403, res.text
    res = client.post(
        retry, headers=_headers(MANAGER), json={"acknowledge_preemption": True}
    )
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- §15: binding


def test_env_url_bound_to_one_project_and_foreign_ingest_stays_local(
    client, sessions, service
):
    """§15 item 8: one URL = one project; a valid token in another project is local."""
    env = _create_env(client)
    with sessions() as s:
        s.add(
            ProjectMembership(
                project_id=P2, user_id="manager-1", role=ProjectRole.MANAGER
            )
        )
        s.commit()
    dup = client.post(
        _envs_url(P2),
        headers=_headers(MANAGER),
        json={"name": "copy", "base_url": ENV_URL + "/", "api_key": ENV_KEY},
    )
    assert dup.status_code == 409, dup.text
    assert "One" in dup.json()["detail"]

    launched = _launch(client, env["id"], _spec())
    assert launched.status_code == 200, launched.text
    clock = Clock()
    dispatcher = EvalDispatcher(sessions, client_factory=service.factory, clock=clock)
    try:
        dispatcher.tick()
    finally:
        dispatcher.close()
    (job,) = _jobs(sessions, launched.json()["id"])
    metadata = service.bodies[0]["evaluator"]["config"]["run_metadata"]
    assert metadata["qym_launch"]["token"] == launch_token_for_job(job.id)

    # The deployment ingests with project two's key: valid token, wrong project.
    res = client.post(
        "/v1/runs",
        headers={"Authorization": f"Bearer {OTHER_INGEST_KEY}"},
        json={"task": "t", "dataset": "d", "metrics": [], "run_metadata": metadata},
    )
    assert res.status_code == 200, res.text
    with sessions() as s:
        run = s.get(Run, res.json()["run_id"])
        assert run.project_id == P2 and run.origin == RunOrigin.LOCAL
        assert "token" not in run.run_metadata["qym_launch"]
        assert s.get(EvalExperimentJob, job.id).run_id is None
        env_row = s.get(EvalEnvironment, env["id"])
        assert "runs arriving in project" in (env_row.health_error or "")


# --------------------------------------------------------------------------- §15: orphans


def test_orphan_cancel_is_manager_only_and_audited(client, sessions, service):
    """§15 item 9: orphan remote jobs are cancelled by managers only, one audit row each."""
    env = _create_env(client)
    service.jobs["orphan-1"] = {
        "id": "orphan-1",
        "status": "RUNNING",
        "priority": "NORMAL",
        "user_id": "someone",
        "created_at": "2026-01-01T00:00:00+00:00",
        "env_overrides": {
            "LLM_OVERRIDES": {"endpoints": {"primary": {"api_key": CONN_KEY}}}
        },
        "eval_input": {},
    }
    snapshotter = RemoteQueueSnapshotter(sessions, client_factory=service.factory)
    try:
        snapshotter.refresh(env["id"], force=True)
    finally:
        snapshotter.close()
    remote = client.get(_queue_url(suffix="/remote"), headers=_headers(MEMBER))
    assert remote.status_code == 200 and CONN_KEY not in remote.text
    assert remote.json()["can_cancel_orphans"] is False

    body = {"environment_id": env["id"], "remote_job_ids": ["orphan-1"], "reason": "x"}
    for email in (MEMBER, MEMBER2):
        res = client.post(
            _queue_url(suffix="/remote/cancel"), headers=_headers(email), json=body
        )
        assert res.status_code == 403
    assert service.cancels == []
    res = client.post(
        _queue_url(suffix="/remote/cancel"), headers=_headers(MANAGER), json=body
    )
    assert res.status_code == 200, res.text
    assert res.json()["outcomes"] == {"orphan-1": "cancelled"}
    assert service.cancels == ["orphan-1"]
    with sessions() as s:
        (audit,) = s.query(AuditLog).filter(AuditLog.action == "eval_remote_job.cancel")
        assert audit.actor_user_id == "manager-1" and audit.entity_id == "orphan-1"
        assert audit.after["orphan"] is True and audit.after["reason"] == "x"
    assert CONN_KEY not in _dump_database(sessions)
