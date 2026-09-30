"""EvalDispatcher: leased submit/poll loop and status model (plan §13, issue #15).

Runs on SQLite, and also on Postgres when ``QYM_TEST_POSTGRES_URL`` is set (each test
gets its own schema). The Evaluation Service is an in-memory fake, and time is a fake
clock, so no test sleeps.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.db.base import Base
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalExperimentStatus,
    EvalJobStatus,
    EvalModelSlot,
    EvalModelSlotStatus,
    Project,
    ProjectLlmConnection,
    Run,
    RunWorkflowStatus,
    User,
)
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services import eval_dispatcher as dispatcher_module
from qym_platform.services.eval_config import is_placeholder, materialize_job_body
from qym_platform.services.eval_dispatcher import (
    ENV_AUTH_ERROR,
    EvalDispatcher,
    aggregate_status,
    extract_versioning,
    high_backoff,
    launch_job_id,
    poll_interval,
)
from qym_platform.services.eval_experiments import (
    LaunchTokenUnavailable,
    build_qym_config,
    build_qym_launch,
    launch_token_for_job,
)
from qym_platform.services.eval_model_slots import detect_model_slots
from qym_platform.services.eval_schema_form import build_form_descriptor
from qym_platform.services.eval_service_client import (
    EnvAuthError,
    HighPriorityActive,
    RemoteNotFound,
    RequestRejected,
    RetryableError,
)

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
T0 = datetime(2020, 1, 1, 12, 0, 0)  # far from real time: onupdate bumps would show
ENV_KEY = "env-service-key-XXXX9999"
MODEL_KEY = "sk-model-secret-key-AAAA1111"
LAUNCH_TOKEN = "launch-token-secret-ZZZZ"


# --------------------------------------------------------------------------- fakes


class FakeClock:
    def __init__(self, start: datetime = T0) -> None:
        self.now = start
        self._lock = threading.Lock()

    def __call__(self) -> datetime:
        with self._lock:
            return self.now

    def advance(self, seconds: float) -> None:
        with self._lock:
            self.now += timedelta(seconds=seconds)


class FakeService:
    """In-memory Evaluation Service shared by every client (thread-safe)."""

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.lock = threading.Lock()
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.order: List[str] = []
        self.submitted_job_ids: List[str] = []  # qym job ids, one per POST that created
        self.bodies: List[Dict[str, Any]] = []
        self.high_active: Optional[str] = None
        self.reject = False
        self.auth_fail = False
        self.drop_response = False  # create the job, then fail like a timeout
        self.submit_delay = 0.0
        self.calls: Dict[str, int] = {"submit": 0, "get": 0, "list": 0}
        self.max_active = 0

    def active(self) -> int:
        return sum(
            1 for j in self.jobs.values() if j["status"] in ("PENDING", "RUNNING")
        )

    async def submit(self, body):
        if self.submit_delay:
            await asyncio.sleep(self.submit_delay)
        with self.lock:
            self.calls["submit"] += 1
            if self.auth_fail:
                raise EnvAuthError("rejected", status_code=401)
            if self.high_active:
                raise HighPriorityActive(
                    "cannot accept NORMAL priority job while HIGH priority job "
                    f"{self.high_active} is active",
                    job_id=self.high_active,
                    priority="NORMAL",
                )
            if self.reject:
                raise RequestRejected(
                    "Evaluation service rejected the request: evaluator.config.x: "
                    "extra fields not permitted",
                    errors=[{"loc": ["body", "x"], "msg": "extra", "type": "x"}],
                )
            rid = str(uuid4())
            job = {
                "id": rid,
                "status": "PENDING",
                "priority": body.get("priority"),
                "user_id": body.get("user_id"),
                "created_at": self.clock().isoformat() + "+00:00",
                "eval_input": copy.deepcopy(body.get("evaluator")),
                "result": None,
                "error": None,
            }
            self.jobs[rid] = job
            self.order.insert(0, rid)
            self.submitted_job_ids.append(launch_job_id(job))
            self.bodies.append(copy.deepcopy(body))
            self.max_active = max(self.max_active, self.active())
            if self.drop_response:
                raise RetryableError("Evaluation service request timed out")
            return copy.deepcopy(job)

    async def get(self, job_id):
        with self.lock:
            self.calls["get"] += 1
            if self.auth_fail:
                raise EnvAuthError("rejected", status_code=401)
            if job_id not in self.jobs:
                raise RemoteNotFound("eval job not found", status_code=404)
            return copy.deepcopy(self.jobs[job_id])

    async def list(
        self, *, status=None, user_id=None, priority=None, limit=50, offset=0
    ):
        with self.lock:
            self.calls["list"] += 1
            if self.auth_fail:
                raise EnvAuthError("rejected", status_code=401)
            items = [
                self.jobs[i]
                for i in self.order
                if user_id is None or self.jobs[i]["user_id"] == user_id
            ]
            page = items[offset : offset + (limit or 50)]
            return {
                "total": len(items),
                "limit": limit,
                "offset": offset,
                "items": copy.deepcopy(page),
            }

    async def aclose(self):
        return None

    def set_status(self, rid, status, **fields):
        with self.lock:
            self.jobs[rid].update(status=status, **fields)

    def factory(self, base_url, api_key):
        assert api_key == ENV_KEY
        return self


# --------------------------------------------------------------------------- fixtures


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )


def _backends():
    params = ["sqlite"]
    params.append(
        pytest.param(
            "postgres",
            marks=pytest.mark.skipif(
                not os.environ.get("QYM_TEST_POSTGRES_URL"),
                reason="QYM_TEST_POSTGRES_URL not configured",
            ),
        )
    )
    return params


@pytest.fixture(params=_backends())
def sessions(request, tmp_path):
    if request.param == "sqlite":
        engine = create_engine(
            f"sqlite:///{tmp_path / 'dispatch.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(engine)
        try:
            yield sessionmaker(bind=engine, autoflush=False)
        finally:
            engine.dispose()
        return
    url = os.environ["QYM_TEST_POSTGRES_URL"]
    schema = "eval_dispatch_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        yield sessionmaker(bind=engine, autoflush=False)
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture()
def clock():
    return FakeClock()


@pytest.fixture()
def service(clock):
    return FakeService(clock)


def _dispatcher(sessions, service, clock, **kwargs):
    kwargs.setdefault("add_launch_token", lambda body, job_id: body)
    return EvalDispatcher(
        sessions,
        client_factory=service.factory,
        clock=clock,
        owner=kwargs.pop("owner", None),
        **kwargs,
    )


def _body(user_id, experiment_id, job_id):
    return {
        "user_id": user_id,
        "priority": "NORMAL",
        "evaluator": {
            "dataset": "playground",
            "config": {
                "samples": 1,
                "run_metadata": {
                    "team": "rag",
                    "qym_launch": {"experiment_id": experiment_id, "job_id": job_id},
                },
            },
        },
    }


def _seed(sessions, *, jobs=1, cap=5, schema_json=None, allow_keys=False):
    """User, project, environment, schema, one experiment with ``jobs`` QUEUED jobs."""
    with sessions() as db:
        user = User(email=f"{uuid4().hex[:8]}@example.com")
        db.add(user)
        db.flush()
        project = Project(
            name="P", slug="p-" + uuid4().hex[:6], created_by_user_id=user.id
        )
        db.add(project)
        db.flush()
        env = EvalEnvironment(
            project_id=project.id,
            name="staging",
            base_url="https://staging.example",
            api_key_encrypted=encrypt_llm_api_key(ENV_KEY),
            max_inflight_jobs=cap,
            allow_connection_keys=allow_keys,
            health_status="ok",
        )
        db.add(env)
        db.flush()
        schema = EvalEnvironmentSchema(
            environment_id=env.id, schema_hash="h1", schema_json=schema_json or {}
        )
        db.add(schema)
        db.flush()
        experiment = EvalExperiment(
            project_id=project.id,
            created_by_user_id=user.id,
            name="exp",
            environment_ids=[env.id],
            job_count=jobs,
        )
        db.add(experiment)
        db.flush()
        job_ids = []
        for index in range(jobs):
            job_id = str(uuid4())
            db.add(
                EvalExperimentJob(
                    id=job_id,
                    experiment_id=experiment.id,
                    environment_id=env.id,
                    combo_index=index,
                    schema_id=schema.id,
                    params={},
                    request_body=_body(user.id, experiment.id, job_id),
                    created_at=T0 + timedelta(milliseconds=index),
                    updated_at=T0,
                )
            )
            job_ids.append(job_id)
        db.commit()
        return {
            "user_id": user.id,
            "project_id": project.id,
            "env_id": env.id,
            "schema_id": schema.id,
            "experiment_id": experiment.id,
            "job_ids": job_ids,
        }


def _job(sessions, job_id) -> EvalExperimentJob:
    with sessions() as db:
        job = db.get(EvalExperimentJob, job_id)
        db.expunge(job)
        return job


def _experiment_status(sessions, experiment_id):
    with sessions() as db:
        return db.get(EvalExperiment, experiment_id).status


def _update_job(sessions, job_id, **fields):
    with sessions() as db:
        job = db.get(EvalExperimentJob, job_id)
        for key, value in fields.items():
            setattr(job, key, value)
        db.commit()


def _statuses(sessions, job_ids):
    return [_job(sessions, j).status for j in job_ids]


# --------------------------------------------------------------------------- pure helpers


def test_aggregate_status_rules():
    S = EvalJobStatus
    assert aggregate_status([S.QUEUED, S.QUEUED]) == EvalExperimentStatus.QUEUED
    assert aggregate_status([S.QUEUED, S.SUCCEEDED]) == EvalExperimentStatus.RUNNING
    assert aggregate_status([S.SUBMITTING, S.BLOCKED]) == EvalExperimentStatus.RUNNING
    assert (
        aggregate_status([S.SUCCEEDED, S.SUCCEEDED]) == EvalExperimentStatus.COMPLETED
    )
    assert aggregate_status([S.SUCCEEDED, S.TIMED_OUT]) == EvalExperimentStatus.PARTIAL
    assert aggregate_status([S.SUCCEEDED, S.CANCELLED]) == EvalExperimentStatus.PARTIAL
    assert aggregate_status([S.FAILED, S.CANCELLED]) == EvalExperimentStatus.FAILED
    assert aggregate_status([S.BLOCKED]) == EvalExperimentStatus.FAILED
    assert (
        aggregate_status([S.CANCELLED, S.CANCELLED]) == EvalExperimentStatus.CANCELLED
    )


def test_poll_and_high_backoff_schedules():
    assert poll_interval(0) == 10
    assert poll_interval(299) == 10
    assert poll_interval(300) == 30
    assert poll_interval(29 * 60) == 30
    assert poll_interval(30 * 60) == 60
    assert poll_interval(3 * 3600) == 60
    assert [high_backoff(n) for n in range(1, 8)] == [30, 60, 120, 240, 300, 300, 300]


def test_versioning_nested_and_legacy_fallback():
    nested = {"versioning_metadata": {"agent_version": "a1", "kb_version": "k1"}}
    assert extract_versioning(nested) == {"agent_version": "a1", "kb_version": "k1"}
    legacy = {"agent_version": "a0", "kb_version": "k0", "run_name": "x"}
    assert extract_versioning(legacy) == {"agent_version": "a0", "kb_version": "k0"}
    assert extract_versioning({"run_name": "x"}) is None
    assert extract_versioning(None) is None


def test_launch_job_id_reads_nested_and_string_metadata():
    item = {"eval_input": {"config": {"run_metadata": {"qym_launch": {"job_id": "j"}}}}}
    assert launch_job_id(item) == "j"
    item["eval_input"]["config"]["run_metadata"] = json.dumps(
        {"qym_launch": {"job_id": "k"}}
    )
    assert launch_job_id(item) == "k"
    assert launch_job_id({"eval_input": {}}) is None


# --------------------------------------------------------------------------- submit


def test_submit_accepted_stores_remote_id_and_recomputes_experiment(
    sessions, service, clock
):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    d = _dispatcher(sessions, service, clock)
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTED
    assert job.remote_job_id in service.jobs
    assert job.remote_status == "PENDING"
    assert job.submit_attempts == 1
    assert job.lease_owner is None and job.lease_until is None
    assert job.wait_reason == "Queued on the evaluation service"
    assert job.next_attempt_at == clock() + timedelta(seconds=10)
    assert service.submitted_job_ids == [job_id]
    body = service.bodies[0]
    assert body["user_id"] == seed["user_id"]
    assert body["evaluator"]["config"]["run_metadata"]["qym_launch"]["job_id"] == job_id
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.RUNNING
    )
    # Not due yet: nothing is claimed.
    assert d.tick() == 0


def test_inflight_cap_limits_submissions_and_sets_wait_reason(sessions, service, clock):
    seed = _seed(sessions, jobs=4, cap=2)
    d = _dispatcher(sessions, service, clock)
    d.tick()
    statuses = _statuses(sessions, seed["job_ids"])
    assert statuses.count(EvalJobStatus.SUBMITTED) == 2
    assert statuses.count(EvalJobStatus.QUEUED) == 2
    waiting = [_job(sessions, j) for j in seed["job_ids"][2:]]
    assert {j.wait_reason for j in waiting} == {"Inflight cap 2/2"}
    assert all(j.next_attempt_at == clock() + timedelta(seconds=10) for j in waiting)
    assert service.max_active == 2

    # Still full after the recheck interval.
    clock.advance(10)
    d.tick()
    assert len(service.submitted_job_ids) == 2

    # One finishes remotely: its poll frees a slot, and a queued job takes it.
    first = _job(sessions, seed["job_ids"][0])
    service.set_status(first.remote_job_id, "SUCCEEDED", result={"run_name": "x"})
    clock.advance(10)
    d.tick()
    d.tick()
    assert len(service.submitted_job_ids) == 3
    assert service.max_active == 2


def test_high_priority_conflict_backs_off_30s_to_5m(sessions, service, clock):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    service.high_active = "high-1"
    d = _dispatcher(sessions, service, clock)
    delays = []
    for _ in range(7):
        assert d.tick() == 1
        job = _job(sessions, job_id)
        assert job.status == EvalJobStatus.QUEUED
        assert job.wait_reason == "HIGH job high-1 active"
        assert job.lease_owner is None
        delay = (job.next_attempt_at - clock()).total_seconds()
        delays.append(delay)
        assert d.tick() == 0  # not due before the backoff expires
        clock.advance(delay)
    assert delays == [30, 60, 120, 240, 300, 300, 300]
    service.high_active = None
    d.tick()
    assert _job(sessions, job_id).status == EvalJobStatus.SUBMITTED
    assert service.submitted_job_ids == [job_id]


def test_422_blocks_job_with_error(sessions, service, clock):
    seed = _seed(sessions)
    service.reject = True
    _dispatcher(sessions, service, clock).tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.BLOCKED
    assert job.wait_reason == "Rejected by the evaluation service"
    assert "evaluator.config.x" in job.error
    assert job.next_attempt_at is None and job.lease_owner is None
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.FAILED
    )


def test_401_marks_env_unhealthy_and_pauses_until_probe_succeeds(
    sessions, service, clock
):
    seed = _seed(sessions, jobs=3)
    service.auth_fail = True
    d = _dispatcher(sessions, service, clock, batch=1)
    d.tick()
    with sessions() as db:
        env = db.get(EvalEnvironment, seed["env_id"])
        assert env.health_status == "error"
        assert env.health_error == ENV_AUTH_ERROR
    first = _job(sessions, seed["job_ids"][0])
    assert first.status == EvalJobStatus.QUEUED
    assert first.wait_reason == "Environment unhealthy: API key rejected"
    assert service.calls["submit"] == 1

    # The rest of the queue is paused: no submit calls and no probe inside 5 minutes.
    d.batch = 10
    for _ in range(4):
        clock.advance(60)
        d.tick()
    assert service.calls["submit"] == 1
    assert service.calls["list"] == 0
    assert {
        j.wait_reason for j in map(lambda i: _job(sessions, i), seed["job_ids"])
    } == {"Environment unhealthy: API key rejected"}

    # After the probe interval the probe still fails: stays paused.
    clock.advance(120)
    d.tick()
    assert service.calls["list"] == 1
    assert service.calls["submit"] == 1

    # Key fixed on the service side; the next probe resumes the queue.
    service.auth_fail = False
    clock.advance(300)
    d.tick()
    with sessions() as db:
        assert db.get(EvalEnvironment, seed["env_id"]).health_status == "ok"
    d.tick()
    assert sorted(service.submitted_job_ids) == sorted(seed["job_ids"])


def test_binding_problem_blocks_before_submit(sessions, service, clock):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    _update_job(
        sessions,
        job_id,
        params={
            "slot_bindings": {
                "endpoint:primary": {"connection_id": "gone", "name": "GPT"}
            }
        },
    )
    _dispatcher(sessions, service, clock).tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.BLOCKED
    assert job.wait_reason
    assert service.calls["submit"] == 0


def test_resolved_keys_and_launch_token_never_persisted_or_logged(
    sessions, service, clock, caplog
):
    schema_json = json.loads(FIXTURE.read_text())
    descriptor = build_form_descriptor(schema_json)
    proposals = detect_model_slots(descriptor)
    seed = _seed(sessions, schema_json=schema_json, allow_keys=True)
    job_id = seed["job_ids"][0]
    with sessions() as db:
        for p in proposals:
            db.add(
                EvalModelSlot(
                    environment_id=seed["env_id"],
                    schema_id=seed["schema_id"],
                    slot_key=p.slot_key,
                    kind=p.kind,
                    label=p.label,
                    field_map=dict(p.field_map),
                    transport_fields=dict(p.transport_fields),
                    required=p.required,
                    status=EvalModelSlotStatus.CONFIRMED,
                )
            )
        conn = ProjectLlmConnection(
            project_id=seed["project_id"],
            name="gpt4o",
            llm_model="gpt-4o",
            llm_base_url="https://llm.example/v1",
            llm_api_key_encrypted=encrypt_llm_api_key(MODEL_KEY),
            llm_api_key_last4=MODEL_KEY[-4:],
        )
        db.add(conn)
        db.flush()
        bindings = {"endpoint:primary": {"connection_id": conn.id}}
        doc = {
            "schema_hash": "h1",
            "evaluator": {"dataset": "d", "config": {"samples": 1}},
            "slot_bindings": bindings,
            "env_overrides": {
                "LLM_OVERRIDES": {
                    "endpoints": {"primary": {"timeout": 60}},
                    "main": {"endpoint": "primary"},
                }
            },
        }
        body = materialize_job_body(
            doc, [p.to_dict() for p in proposals], descriptor=descriptor, user_id="u"
        )
        body["evaluator"]["config"]["run_metadata"] = {"qym_launch": {"job_id": job_id}}
        job = db.get(EvalExperimentJob, job_id)
        job.request_body = body
        job.params = {"slot_bindings": bindings}
        db.commit()

    def add_token(body, jid):
        body["evaluator"]["config"]["run_metadata"]["qym_launch"][
            "token"
        ] = LAUNCH_TOKEN
        return body

    caplog.set_level(logging.DEBUG)
    _dispatcher(sessions, service, clock, add_launch_token=add_token).tick()
    assert _job(sessions, job_id).status == EvalJobStatus.SUBMITTED
    sent = json.dumps(service.bodies[0])
    assert MODEL_KEY in sent and LAUNCH_TOKEN in sent
    with sessions() as db:
        row = (
            db.execute(
                text("SELECT * FROM eval_experiment_jobs WHERE id = :id"),
                {"id": job_id},
            )
            .mappings()
            .one()
        )
    stored = json.dumps({k: str(v) for k, v in row.items()})
    assert MODEL_KEY not in stored and LAUNCH_TOKEN not in stored
    assert "{{qym:slot:endpoint:primary:api_key}}" in stored
    assert MODEL_KEY not in caplog.text and LAUNCH_TOKEN not in caplog.text


def test_cancel_requested_while_queued_cancels_locally(sessions, service, clock):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    _update_job(sessions, job_id, cancel_requested_at=T0)
    _dispatcher(sessions, service, clock).tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED
    assert job.finished_at == clock()
    assert service.calls["submit"] == 0
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.CANCELLED
    )


# --------------------------------------------------------------------------- crash safety


def test_transport_error_mid_submit_reconciles_instead_of_resubmitting(
    sessions, service, clock
):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    service.drop_response = True  # the service creates the job; we never see the 202
    d = _dispatcher(sessions, service, clock)
    d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTING
    assert job.remote_job_id is None
    assert "checking before resubmitting" in job.wait_reason
    service.drop_response = False
    clock.advance((job.next_attempt_at - clock()).total_seconds())
    d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTED
    assert job.remote_job_id == service.order[0]
    assert service.calls["submit"] == 1
    assert service.submitted_job_ids == [job_id]


def test_crash_mid_submit_adopts_remote_job_after_lease_expires(
    sessions, service, clock
):
    seed = _seed(sessions, jobs=2)
    job_id = seed["job_ids"][0]
    # Worker "dead" took the SUBMITTING marker, the POST reached the service, then the
    # pod died before recording the 202.
    _update_job(
        sessions,
        job_id,
        status=EvalJobStatus.SUBMITTING,
        submit_attempts=1,
        submitted_at=clock(),
        lease_owner="dead",
        lease_until=clock() + timedelta(seconds=120),
    )
    asyncio.run(service.submit(_body(seed["user_id"], seed["experiment_id"], job_id)))
    # Other jobs of the same user are ignored by the matcher.
    other_id = seed["job_ids"][1]
    d = _dispatcher(sessions, service, clock)
    d.tick()  # the lease is still live: only the other job is claimed
    assert _job(sessions, job_id).status == EvalJobStatus.SUBMITTING
    assert _job(sessions, other_id).status == EvalJobStatus.SUBMITTED
    clock.advance(121)
    d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTED
    assert (
        service.jobs[job.remote_job_id]["eval_input"]["config"]["run_metadata"][
            "qym_launch"
        ]["job_id"]
        == job_id
    )
    assert sorted(service.submitted_job_ids) == sorted([job_id, other_id])
    assert service.calls["list"] >= 1


def test_crash_before_post_resubmits_exactly_once(sessions, service, clock):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    _update_job(
        sessions,
        job_id,
        status=EvalJobStatus.SUBMITTING,
        submit_attempts=1,
        submitted_at=clock() - timedelta(seconds=300),
        lease_owner="dead",
        lease_until=clock() - timedelta(seconds=1),
    )
    d = _dispatcher(sessions, service, clock)
    d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTED
    assert job.submit_attempts == 2
    assert service.submitted_job_ids == [job_id]
    assert service.calls["list"] == 1


def test_401_during_reconcile_keeps_job_submitting(sessions, service, clock):
    """An uncertain submit must never fall back to QUEUED (which skips reconcile)."""
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    service.drop_response = True
    d = _dispatcher(sessions, service, clock)
    d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTING
    # The re-check waits at least a lease length after an uncertain POST.
    assert job.next_attempt_at - clock() >= timedelta(seconds=120)
    service.drop_response = False
    service.auth_fail = True
    clock.advance(121)
    d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTING
    assert job.wait_reason == "Environment unhealthy: API key rejected"
    with sessions() as db:
        assert db.get(EvalEnvironment, seed["env_id"]).health_status == "error"
    # Key fixed: the probe resumes, reconcile adopts the job, nothing is resubmitted.
    service.auth_fail = False
    for _ in range(8):
        clock.advance(60)
        d.tick()
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUBMITTED
    assert service.calls["submit"] == 1
    assert job.remote_job_id == service.order[0]


def test_reconcile_pages_through_remote_jobs(sessions, service, clock, monkeypatch):
    monkeypatch.setattr(dispatcher_module, "RECONCILE_PAGE_SIZE", 2)
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]
    _update_job(
        sessions,
        job_id,
        status=EvalJobStatus.SUBMITTING,
        submitted_at=clock(),
        lease_owner="dead",
        lease_until=clock() - timedelta(seconds=1),
    )
    asyncio.run(service.submit(_body(seed["user_id"], seed["experiment_id"], job_id)))
    for _ in range(5):  # newer unrelated jobs push the match to page 3
        asyncio.run(service.submit(_body(seed["user_id"], seed["experiment_id"], "x")))
    _dispatcher(sessions, service, clock).tick()
    assert _job(sessions, job_id).status == EvalJobStatus.SUBMITTED
    assert service.calls["list"] == 3


# --------------------------------------------------------------------------- polling


def _submitted(sessions, service, clock, **seed_kwargs):
    seed = _seed(sessions, **seed_kwargs)
    d = _dispatcher(sessions, service, clock)
    d.tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.SUBMITTED
    return seed, d, job.id, job.remote_job_id


def _poll(d, sessions, clock, job_id):
    job = _job(sessions, job_id)
    clock.advance(max(0.0, (job.next_attempt_at - clock()).total_seconds()))
    assert d.tick() >= 1
    return _job(sessions, job_id)


def test_poll_backoff_10s_then_30s_then_60s(sessions, service, clock):
    seed, d, job_id, _ = _submitted(sessions, service, clock)
    gaps = []
    start = clock()
    while clock() - start < timedelta(minutes=40):
        job = _poll(d, sessions, clock, job_id)
        polled_at = (clock() - start).total_seconds()
        gaps.append((polled_at, (job.next_attempt_at - clock()).total_seconds()))
    early = {gap for t, gap in gaps if t < 300}
    middle = {gap for t, gap in gaps if 300 <= t < 1800}
    late = {gap for t, gap in gaps if t >= 1800}
    assert early == {10} and middle == {30} and late == {60}
    job = _job(sessions, job_id)
    assert job.last_polled_at == clock()
    assert job.status == EvalJobStatus.SUBMITTED  # remote still PENDING


def test_remote_running_then_succeeded_stores_result_and_versioning(
    sessions, service, clock
):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.RUNNING
    assert job.remote_status == "RUNNING"
    assert job.wait_reason is None
    result = {
        "run_name": "r",
        "versioning_metadata": {"agent_version": "a1", "kb_version": "k1"},
        "pass_at_k": {"1": 0.5},
    }
    service.set_status(rid, "SUCCEEDED", result=result)
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.SUCCEEDED
    assert job.remote_result == result
    assert job.remote_versioning == {"agent_version": "a1", "kb_version": "k1"}
    assert job.finished_at == clock()
    assert job.next_attempt_at is None
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.COMPLETED
    )
    assert d.tick() == 0


def test_remote_legacy_versioning_and_failed_status(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock, jobs=2)
    service.set_status(
        rid, "SUCCEEDED", result={"agent_version": "a0", "kb_version": "k0"}
    )
    job = _poll(d, sessions, clock, job_id)
    assert job.remote_versioning == {"agent_version": "a0", "kb_version": "k0"}
    other = _job(sessions, seed["job_ids"][1])
    service.set_status(other.remote_job_id, "FAILED", error="boom api_key=sk-leak")
    other = _poll(d, sessions, clock, other.id)
    assert other.status == EvalJobStatus.FAILED
    assert "sk-leak" not in other.error
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.PARTIAL
    )


LEAKED = "sk-leaked-by-service-QQQQ7777"


class LeakyService(FakeService):
    """A service whose client forgot to redact: secrets in every answer and error."""

    def __init__(self, clock: FakeClock) -> None:
        super().__init__(clock)
        self.submit_errors: Dict[str, Exception] = {}  # qym job id -> raised on POST
        self.get_errors: List[Exception] = []  # raised by the next GETs, in order
        self.list_error: Optional[Exception] = None

    async def submit(self, body):
        job_id = body["evaluator"]["config"]["run_metadata"]["qym_launch"]["job_id"]
        if job_id in self.submit_errors:
            raise self.submit_errors[job_id]
        remote = await super().submit(body)
        # The launch token and a key echoed back, as a raw service answer would.
        remote["eval_input"]["config"]["run_metadata"]["qym_launch"]["token"] = LEAKED
        remote["env_overrides"] = {"LLM_OVERRIDES": json.dumps({"api_key": LEAKED})}
        return remote

    async def get(self, job_id):
        if self.get_errors:
            raise self.get_errors.pop(0)
        return await super().get(job_id)

    async def list(self, **kwargs):
        if self.list_error is not None:
            raise self.list_error
        return await super().list(**kwargs)


def _secret_columns(sessions, secret):
    """``table.column`` of every stored eval value that contains ``secret``."""
    found = []
    with sessions() as db:
        for model in (EvalExperimentJob, EvalExperiment, EvalEnvironment):
            for row in db.query(model):
                for column in model.__table__.columns:
                    value = getattr(row, column.key)
                    text_value = (
                        json.dumps(value, default=str)
                        if isinstance(value, (dict, list))
                        else str(value)
                    )
                    if secret in text_value:
                        found.append(f"{model.__tablename__}.{column.key}")
    return found


def test_unredacted_service_answers_are_redacted_before_storing(
    sessions, clock, caplog
):
    """Defence in depth: the dispatcher redacts whatever the service returns, even
    when the client did not (remote_result, remote_versioning, error, wait_reason,
    the environment's health_error, logs)."""
    caplog.set_level(logging.DEBUG)
    service = LeakyService(clock)
    seed = _seed(sessions, jobs=4)
    ok, failed, rejected, ambiguous = seed["job_ids"]
    service.submit_errors = {
        rejected: RequestRejected(
            f"Evaluation service rejected the request: api_key={LEAKED}",
            errors=[{"loc": ["body", "api_key"], "msg": LEAKED, "type": "x"}],
        ),
        ambiguous: RetryableError(f"timed out; Authorization: Bearer {LEAKED}"),
    }
    d = _dispatcher(sessions, service, clock)
    d.tick()
    assert _statuses(sessions, seed["job_ids"]) == [
        EvalJobStatus.SUBMITTED,
        EvalJobStatus.SUBMITTED,
        EvalJobStatus.BLOCKED,
        EvalJobStatus.SUBMITTING,
    ]

    # A poll that fails with a secret in its message is logged, not stored.
    service.get_errors = [RetryableError(f"502 from upstream token={LEAKED}")]
    job = _poll(d, sessions, clock, failed)
    assert job.status == EvalJobStatus.SUBMITTED

    result = {
        "run_name": "r",
        "pass_at_k": {"1": 0.5},
        "api_key": LEAKED,
        "judge": {"name": "gpt", "client_secret": LEAKED},
        "config": {"LLM_OVERRIDES": json.dumps({"openai_api_key": LEAKED})},
        "versioning_metadata": {"agent_version": "a1", "access_token": LEAKED},
    }
    service.set_status(_job(sessions, ok).remote_job_id, "SUCCEEDED", result=result)
    job = _poll(d, sessions, clock, ok)
    assert job.status == EvalJobStatus.SUCCEEDED
    assert job.remote_result["pass_at_k"] == {"1": 0.5}
    assert job.remote_result["api_key"] == "[REDACTED]"
    assert job.remote_versioning == {
        "agent_version": "a1",
        "access_token": "[REDACTED]",
    }

    service.set_status(
        _job(sessions, failed).remote_job_id,
        "FAILED",
        error={"message": f"boom password={LEAKED}", "secret": LEAKED},
    )
    job = _poll(d, sessions, clock, failed)
    assert job.status == EvalJobStatus.FAILED
    assert "boom" in job.error

    # The ambiguous job is reconciled after a lease length; the environment is paused
    # and its probe fails with a secret in the message (-> health_error).
    with sessions() as db:
        env = db.get(EvalEnvironment, seed["env_id"])
        env.health_status = "error"
        env.health_checked_at = None
        db.commit()
    service.list_error = RetryableError(f"probe failed: secret={LEAKED}")
    job = _poll(d, sessions, clock, ambiguous)
    assert job.status == EvalJobStatus.SUBMITTING
    with sessions() as db:
        assert "probe failed" in db.get(EvalEnvironment, seed["env_id"]).health_error

    assert _secret_columns(sessions, LEAKED) == []
    assert LEAKED not in caplog.text


def _link_run(sessions, seed, job_id, **fields):
    with sessions() as db:
        run = Run(
            project_id=seed["project_id"],
            created_by_user_id=seed["user_id"],
            owner_user_id=seed["user_id"],
            task="t",
            dataset="d",
            experiment_job_id=job_id,
            **fields,
        )
        db.add(run)
        db.flush()
        db.get(EvalExperimentJob, job_id).run_id = run.id
        db.commit()
        return run.id


def test_linked_run_failed_wins_over_remote_running(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    _poll(d, sessions, clock, job_id)
    _link_run(sessions, seed, job_id, status=RunWorkflowStatus.FAILED, ended_at=clock())
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.FAILED
    assert job.remote_status == "RUNNING"
    assert job.error == "The linked run failed"


def test_linked_run_marks_job_running_while_remote_pending(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    _link_run(
        sessions, seed, job_id, status=RunWorkflowStatus.RUNNING, started_at=clock()
    )
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.RUNNING


def test_linked_run_completed_waits_for_result_then_succeeds(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    _link_run(
        sessions, seed, job_id, status=RunWorkflowStatus.COMPLETED, ended_at=clock()
    )
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.RUNNING
    assert job.wait_reason == "Run completed; waiting for the service result"
    clock.advance(11 * 60)
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.SUCCEEDED
    assert job.remote_result is None


def test_linked_run_stopped_by_lease_timeout_is_not_final(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    _link_run(
        sessions,
        seed,
        job_id,
        status=RunWorkflowStatus.STOPPED,
        status_reason="lease_timeout",
    )
    assert _poll(d, sessions, clock, job_id).status == EvalJobStatus.RUNNING
    with sessions() as db:
        run = db.get(Run, _job(sessions, job_id).run_id)
        run.status_reason = "admin_force_stopped"
        db.commit()
    assert _poll(d, sessions, clock, job_id).status == EvalJobStatus.CANCELLED


def test_timed_out_after_2h15m_without_change(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    _poll(d, sessions, clock, job_id)
    changed_at = clock()
    while True:
        job = _poll(d, sessions, clock, job_id)
        if job.status != EvalJobStatus.RUNNING:
            break
        # No-change polls must not move updated_at (the "last change" reference).
        assert job.updated_at == changed_at
        assert clock() - changed_at < timedelta(hours=2, minutes=15)
    assert job.status == EvalJobStatus.TIMED_OUT
    assert clock() - changed_at >= timedelta(hours=2, minutes=15)
    assert clock() - changed_at < timedelta(hours=2, minutes=16)
    assert "2h15m" in job.error
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.FAILED
    )


def test_run_activity_prevents_timeout(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    run_id = _link_run(
        sessions, seed, job_id, status=RunWorkflowStatus.RUNNING, started_at=clock()
    )
    for _ in range(4):  # 4h of polling, with run events every hour
        clock.advance(3600)
        with sessions() as db:
            db.get(Run, run_id).last_event_at = clock()
            db.commit()
        assert _poll(d, sessions, clock, job_id).status == EvalJobStatus.RUNNING


def test_remote_pending_job_never_times_out(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    job = _job(sessions, job_id)
    while clock() - job.submitted_at <= timedelta(hours=4):
        job = _poll(d, sessions, clock, job_id)
        assert job.status == EvalJobStatus.SUBMITTED
    # It starts running: the 2h15m clock starts now, not at submit.
    service.set_status(rid, "RUNNING")
    started = clock()
    while True:
        job = _poll(d, sessions, clock, job_id)
        if job.status != EvalJobStatus.RUNNING:
            break
    assert job.status == EvalJobStatus.TIMED_OUT
    assert clock() - started >= timedelta(hours=2, minutes=15)


def test_run_in_review_counts_as_completed(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    _link_run(
        sessions, seed, job_id, status=RunWorkflowStatus.APPROVED, ended_at=clock()
    )
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.RUNNING
    assert job.wait_reason == "Run completed; waiting for the service result"
    clock.advance(11 * 60)
    assert _poll(d, sessions, clock, job_id).status == EvalJobStatus.SUCCEEDED


def test_no_timeout_while_the_service_cannot_be_observed(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.set_status(rid, "RUNNING")
    _poll(d, sessions, clock, job_id)
    service.auth_fail = True  # env paused for 3h: nothing observable about the job
    job = _job(sessions, job_id)
    while clock() - job.submitted_at <= timedelta(hours=3):
        job = _poll(d, sessions, clock, job_id)
        assert job.status == EvalJobStatus.RUNNING
    assert job.status == EvalJobStatus.RUNNING
    assert job.wait_reason == "Environment unhealthy; status may be stale"


def test_poll_401_pauses_env_and_remote_404_fails_job(sessions, service, clock):
    seed, d, job_id, rid = _submitted(sessions, service, clock)
    service.auth_fail = True
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.SUBMITTED
    assert job.wait_reason == "Environment unhealthy; status may be stale"
    with sessions() as db:
        assert db.get(EvalEnvironment, seed["env_id"]).health_status == "error"
    service.auth_fail = False
    clock.advance(301)
    del service.jobs[rid]
    service.order.remove(rid)
    job = _poll(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.FAILED
    assert "no longer knows" in job.error


# --------------------------------------------------------------------------- leases


def test_claim_is_exclusive_between_workers(sessions, service, clock):
    seed = _seed(sessions, jobs=3)
    a = _dispatcher(sessions, service, clock, owner="a")
    b = _dispatcher(sessions, service, clock, owner="b")
    assert sorted(a.claim()) == sorted(seed["job_ids"])
    assert b.claim() == []
    clock.advance(121)  # a's lease expired (it died)
    assert sorted(b.claim()) == sorted(seed["job_ids"])
    # a comes back: it no longer owns the jobs and must not act on them.
    with pytest.raises(dispatcher_module.LeaseLost):
        a._process(seed["job_ids"][0])
    assert _job(sessions, seed["job_ids"][0]).lease_owner == "b"
    assert service.calls["submit"] == 0


def test_stale_candidates_cannot_steal_a_lease_or_submit(sessions, service, clock):
    """Both workers saw the same free rows; only the first compare-and-set wins,
    and a worker that lost the lease cannot take the SUBMITTING marker."""
    seed = _seed(sessions, jobs=2)
    a = _dispatcher(sessions, service, clock, owner="a")
    b = _dispatcher(sessions, service, clock, owner="b")
    ids = seed["job_ids"]
    with sessions() as db:
        assert sorted(a._take_leases(db, ids, clock())) == sorted(ids)
        db.commit()
    with sessions() as db:
        assert b._take_leases(db, ids, clock()) == []  # stale candidate list
        db.commit()
    # b believes it holds job 0 (e.g. it was claimed before a's lease): its submit
    # step must notice the lease belongs to a and do nothing.
    with pytest.raises(dispatcher_module.LeaseLost):
        b._try_submit(ids[0], first=True)
    assert service.calls["submit"] == 0
    assert _job(sessions, ids[0]).lease_owner == "a"
    # The submit CAS itself also requires the lease.
    with sessions() as db:
        job = db.get(EvalExperimentJob, ids[0])
        env = db.get(EvalEnvironment, job.environment_id)
        assert not b._begin_submit(db, job, env, first=True)
        assert a._begin_submit(db, job, env, first=True)
        db.commit()
    assert _job(sessions, ids[0]).status == EvalJobStatus.SUBMITTING


@pytest.mark.parametrize("rounds", [6])
def test_two_workers_never_double_submit(sessions, service, clock, rounds):
    seed = _seed(sessions, jobs=12, cap=5)
    service.submit_delay = 0.005  # widen the window between claim and record
    workers = [
        _dispatcher(sessions, service, clock, owner=f"w{i}", batch=4) for i in range(2)
    ]
    errors: List[BaseException] = []

    def run(worker, barrier):
        try:
            barrier.wait()
            worker.tick()
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    for _ in range(rounds):
        barrier = threading.Barrier(len(workers))
        threads = [threading.Thread(target=run, args=(w, barrier)) for w in workers]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert not errors
        assert service.max_active <= 5
        # Finish whatever is running so the queue drains.
        for rid, remote in list(service.jobs.items()):
            if remote["status"] == "PENDING":
                service.set_status(rid, "SUCCEEDED", result={})
        clock.advance(10)
    for _ in range(4):
        for w in workers:
            w.tick()
        for rid, remote in list(service.jobs.items()):
            if remote["status"] == "PENDING":
                service.set_status(rid, "SUCCEEDED", result={})
        clock.advance(10)

    assert len(service.submitted_job_ids) == len(set(service.submitted_job_ids))
    assert sorted(service.submitted_job_ids) == sorted(seed["job_ids"])
    assert service.max_active <= 5
    assert set(_statuses(sessions, seed["job_ids"])) == {EvalJobStatus.SUCCEEDED}
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.COMPLETED
    )
    for w in workers:
        w.close()


def test_concurrent_submitters_respect_cap_under_contention(sessions, service, clock):
    """Many workers race for the last in-flight slots of one environment."""
    seed = _seed(sessions, jobs=10, cap=3)
    service.submit_delay = 0.01
    workers = [
        _dispatcher(sessions, service, clock, owner=f"w{i}", batch=1) for i in range(5)
    ]
    barrier = threading.Barrier(len(workers))

    def run(worker):
        barrier.wait()
        worker.tick()

    threads = [threading.Thread(target=run, args=(w,)) for w in workers]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert service.max_active <= 3
    assert len(service.submitted_job_ids) == len(set(service.submitted_job_ids))
    with sessions() as db:
        inflight = db.execute(
            text(
                "SELECT count(*) FROM eval_experiment_jobs WHERE status IN "
                "('SUBMITTING','SUBMITTED','RUNNING')"
            )
        ).scalar()
    assert inflight <= 3
    for w in workers:
        w.close()


def test_worker_thread_starts_and_stops(sessions, service, clock):
    _seed(sessions)
    d = _dispatcher(sessions, service, clock, interval=0.01)
    d.start()
    try:
        for _ in range(200):
            if service.calls["submit"]:
                break
            threading.Event().wait(0.01)
    finally:
        assert d.stop(timeout=5)
    assert service.calls["submit"] == 1


# --------------------------------------------------------------------------- run metadata (#16)


def test_superseded_retry_is_left_out_of_aggregate_status(sessions, service, clock):
    seed = _seed(sessions, jobs=2)
    first, second = seed["job_ids"]
    experiment_id = seed["experiment_id"]
    _update_job(sessions, first, status=EvalJobStatus.FAILED)
    _update_job(sessions, second, status=EvalJobStatus.SUCCEEDED)
    retry_id = str(uuid4())
    with sessions() as db:
        db.add(
            EvalExperimentJob(
                id=retry_id,
                experiment_id=experiment_id,
                environment_id=seed["env_id"],
                combo_index=0,
                attempt=1,
                retry_of_job_id=first,
                schema_id=seed["schema_id"],
                params={},
                request_body=_body(seed["user_id"], experiment_id, retry_id),
                created_at=T0,
                updated_at=T0,
            )
        )
        db.commit()
        status = dispatcher_module.recompute_experiment_status(db, experiment_id)
        assert status == EvalExperimentStatus.RUNNING
        db.commit()

    _dispatcher(sessions, service, clock).tick()
    assert service.submitted_job_ids == [retry_id]
    assert _experiment_status(sessions, experiment_id) == EvalExperimentStatus.RUNNING

    # Without the filter the FAILED first attempt would still count (PARTIAL).
    _update_job(sessions, retry_id, status=EvalJobStatus.SUCCEEDED)
    with sessions() as db:
        status = dispatcher_module.recompute_experiment_status(db, experiment_id)
        assert status == EvalExperimentStatus.COMPLETED
    _update_job(sessions, retry_id, status=EvalJobStatus.CANCELLED)
    with sessions() as db:
        status = dispatcher_module.recompute_experiment_status(db, experiment_id)
        assert status == EvalExperimentStatus.PARTIAL


_USER_PLACEHOLDER = "{{qym:slot:endpoint:primary:api_key}}"
_TOKEN_POINTER = "/evaluator/config/run_metadata/qym_launch/token"
_MISSING = object()


def _seed_bound_job(sessions):
    """One QUEUED job whose body binds ``endpoint:primary`` to a saved connection.

    Its ``run_metadata`` holds ``qym_launch``/``qym_config`` as the API stores them,
    plus a user key that *looks* like a slot placeholder.
    """
    schema_json = json.loads(FIXTURE.read_text())
    descriptor = build_form_descriptor(schema_json)
    proposals = detect_model_slots(descriptor)
    seed = _seed(sessions, schema_json=schema_json, allow_keys=True)
    job_id = seed["job_ids"][0]
    with sessions() as db:
        for p in proposals:
            db.add(
                EvalModelSlot(
                    environment_id=seed["env_id"],
                    schema_id=seed["schema_id"],
                    slot_key=p.slot_key,
                    kind=p.kind,
                    label=p.label,
                    field_map=dict(p.field_map),
                    transport_fields=dict(p.transport_fields),
                    required=p.required,
                    status=EvalModelSlotStatus.CONFIRMED,
                )
            )
        conn = ProjectLlmConnection(
            project_id=seed["project_id"],
            name="gpt4o",
            llm_model="gpt-4o",
            llm_base_url="https://llm.example/v1",
            llm_api_key_encrypted=encrypt_llm_api_key(MODEL_KEY),
            llm_api_key_last4=MODEL_KEY[-4:],
        )
        db.add(conn)
        db.flush()
        bindings = {"endpoint:primary": {"connection_id": conn.id}}
        doc = {
            "schema_hash": "h1",
            "evaluator": {
                "dataset": "d",
                "config": {"samples": 1, "run_metadata": {"note": _USER_PLACEHOLDER}},
            },
            "slot_bindings": bindings,
            "env_overrides": {
                "LLM_OVERRIDES": {
                    "endpoints": {"primary": {"timeout": 60}},
                    "main": {"endpoint": "primary"},
                }
            },
        }
        body = materialize_job_body(
            doc, [p.to_dict() for p in proposals], descriptor=descriptor, user_id="u"
        )
        body["priority"] = "NORMAL"  # the API always stores user_id and priority
        metadata = body["evaluator"]["config"].setdefault("run_metadata", {})
        metadata["qym_launch"] = build_qym_launch(
            experiment_id=seed["experiment_id"],
            job_id=job_id,
            environment_id=seed["env_id"],
            combo_index=0,
        )
        metadata["qym_config"] = build_qym_config(
            doc,
            schema_hash="h1",
            base_source={"kind": "blank"},
            models={"endpoint:primary": {"name": "gpt4o", "model": "gpt-4o"}},
        )
        job = db.get(EvalExperimentJob, job_id)
        job.request_body = body
        job.params = {"slot_bindings": bindings}
        db.commit()
        return seed, job_id, conn.id, body


def _diffs(stored, sent, pointer=""):
    """``(pointer, stored, sent)`` wherever the submitted body differs."""
    if isinstance(stored, dict) and isinstance(sent, dict):
        out = []
        for key in list(stored) + [k for k in sent if k not in stored]:
            out += _diffs(
                stored.get(key, _MISSING), sent.get(key, _MISSING), f"{pointer}/{key}"
            )
        return out
    return [] if stored == sent else [(pointer, stored, sent)]


def test_submitted_body_is_stored_body_plus_launch_token(
    sessions, service, clock, caplog
):
    seed, job_id, conn_id, stored = _seed_bound_job(sessions)
    token = launch_token_for_job(job_id)
    caplog.set_level(logging.DEBUG)
    _dispatcher(
        sessions,
        service,
        clock,
        add_launch_token=dispatcher_module.default_add_launch_token,
    ).tick()
    assert _job(sessions, job_id).status == EvalJobStatus.SUBMITTED
    (sent,) = service.bodies

    # Only slot placeholders were resolved, and only the token was added.
    diffs = _diffs(stored, sent)
    assert _TOKEN_POINTER in [pointer for pointer, _, _ in diffs]
    for pointer, before, after in diffs:
        if pointer == _TOKEN_POINTER:
            assert (before, after) == (_MISSING, token)
        else:
            assert is_placeholder(before), pointer
            assert not pointer.startswith("/evaluator/config/run_metadata"), pointer

    metadata = sent["evaluator"]["config"]["run_metadata"]
    # A user value that looks like a placeholder is not filled: no key reaches the run.
    assert metadata["note"] == _USER_PLACEHOLDER
    assert MODEL_KEY not in json.dumps(metadata)
    assert metadata["qym_launch"] == {
        "experiment_id": seed["experiment_id"],
        "job_id": job_id,
        "environment_id": seed["env_id"],
        "combo_index": 0,
        "attempt": 0,
        "token": token,
    }
    assert metadata["qym_config"]["slot_bindings"] == {
        "endpoint:primary": {
            "connection_id": conn_id,
            "name": "gpt4o",
            "model": "gpt-4o",
        }
    }
    assert MODEL_KEY in json.dumps(sent)  # the key itself still goes to the service

    with sessions() as db:
        rows = [
            *db.execute(text("SELECT * FROM eval_experiment_jobs")).mappings().all(),
            *db.execute(text("SELECT * FROM eval_experiments")).mappings().all(),
        ]
    persisted = json.dumps([{k: str(v) for k, v in r.items()} for r in rows])
    assert token not in persisted and MODEL_KEY not in persisted
    assert token not in caplog.text and MODEL_KEY not in caplog.text


def test_missing_launch_token_key_waits_instead_of_submitting(
    sessions, service, clock, monkeypatch
):
    seed = _seed(sessions)
    job_id = seed["job_ids"][0]

    def unavailable(body, job_id):
        raise LaunchTokenUnavailable("no key")

    monkeypatch.setattr(dispatcher_module, "body_with_launch_token", unavailable)
    _dispatcher(
        sessions,
        service,
        clock,
        add_launch_token=dispatcher_module.default_add_launch_token,
    ).tick()
    job = _job(sessions, job_id)
    assert service.calls["submit"] == 0
    assert job.status == EvalJobStatus.QUEUED
    assert "QYM_LLM_CONFIG_ENCRYPTION_KEY" in (job.wait_reason or "")
    assert job.lease_owner is None
