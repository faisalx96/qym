"""Remote queue snapshots: refresh cadence, redaction and multi-worker safety
(plan §4.6a, §13, issue #20).

Runs on SQLite, and also on Postgres when ``QYM_TEST_POSTGRES_URL`` is set (each test
gets its own schema). The Evaluation Service is an in-memory fake and time is a fake
clock.
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
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
    EvalJobStatus,
    EvalRemoteQueueSnapshot,
    Project,
    User,
)
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services import eval_remote_queue as rq
from qym_platform.services.eval_dispatcher import ENV_AUTH_ERROR
from qym_platform.services.eval_remote_queue import (
    NOT_FETCHED_YET,
    SNAPSHOT_FIELDS,
    RemoteQueueSnapshotter,
    build_snapshot_items,
    read_snapshot,
    refresh_snapshot_on_view,
    snapshot_item,
)
from qym_platform.services.eval_service_client import (
    EnvAuthError,
    EvalServiceClient,
    RetryableError,
)

T0 = datetime(2020, 1, 1, 12, 0, 0)
ENV_KEY = "env-service-key-XXXX9999"
MODEL_KEY = "sk-model-secret-key-AAAA1111"
LAUNCH_TOKEN = "launch-token-secret-ZZZZ"
PLAIN_TOKEN = "plain-token-secret-YYYY"
SECRETS = (ENV_KEY, MODEL_KEY, LAUNCH_TOKEN, PLAIN_TOKEN)


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


def _remote_job(rid: str, status: str, **extra) -> Dict[str, Any]:
    """An ``EvalJobRead`` as the service returns it, secrets and all (D1)."""
    job = {
        "id": rid,
        "status": status,
        "priority": "NORMAL",
        "user_id": "user-1",
        "cancelled_by_user_id": None,
        "created_at": "2020-01-01T11:59:00+00:00",
        "updated_at": None,
        "env_overrides": {
            "LLM_OVERRIDES": json.dumps(
                {"endpoints": {"judge": {"api_key": MODEL_KEY, "model": "gpt"}}}
            ),
            "OPENAI_API_KEY": MODEL_KEY,
        },
        "eval_input": {
            "dataset": "playground",
            "config": {
                "run_name": f"run-{rid}",
                "run_metadata": {
                    "qym_launch": {"job_id": "j", "token": LAUNCH_TOKEN},
                },
            },
        },
        "api_key": ENV_KEY,
        "token": PLAIN_TOKEN,
        "result": {"token": PLAIN_TOKEN},
        "error": None,
    }
    job.update(extra)
    return job


class FakeService:
    """Records ``list`` calls; returns jobs filtered by status."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.jobs: List[Dict[str, Any]] = []
        self.calls: List[Dict[str, Any]] = []
        self.error: Optional[Exception] = None
        self.delay = 0.0
        self.total_override: Optional[int] = None
        self.on_list = None  # callback(status) run before answering

    async def list(
        self, *, status=None, user_id=None, priority=None, limit=50, offset=0
    ):
        with self.lock:
            self.calls.append({"status": status, "user_id": user_id, "limit": limit})
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.on_list is not None:
            self.on_list(status)
        if self.error is not None:
            raise self.error
        with self.lock:
            items = [j for j in self.jobs if status is None or j["status"] == status]
            return {
                "total": self.total_override or len(items),
                "limit": limit,
                "offset": offset,
                "items": copy.deepcopy(items[:limit]),
            }

    async def aclose(self):
        return None

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
            f"sqlite:///{tmp_path / 'snapshots.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(engine)
        try:
            yield sessionmaker(bind=engine, autoflush=False)
        finally:
            engine.dispose()
        return
    url = os.environ["QYM_TEST_POSTGRES_URL"]
    schema = "eval_snap_" + uuid4().hex
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
def service():
    svc = FakeService()
    svc.jobs = [
        _remote_job("r-pending", "PENDING"),
        _remote_job("r-running", "RUNNING", priority="HIGH"),
    ]
    return svc


def _snapshotter(sessions, service, clock, **kwargs):
    return RemoteQueueSnapshotter(
        sessions, client_factory=service.factory, clock=clock, **kwargs
    )


def _seed(sessions, *, job_status=EvalJobStatus.QUEUED, active=True, health="ok"):
    """Project, environment and (unless ``job_status`` is None) one local job."""
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
            name="staging-" + uuid4().hex[:6],
            base_url=f"https://{uuid4().hex[:8]}.example",
            api_key_encrypted=encrypt_llm_api_key(ENV_KEY),
            health_status=health,
            is_active=active,
        )
        db.add(env)
        db.flush()
        if job_status is not None:
            schema = EvalEnvironmentSchema(
                environment_id=env.id, schema_hash="h1", schema_json={}
            )
            db.add(schema)
            db.flush()
            experiment = EvalExperiment(
                project_id=project.id,
                created_by_user_id=user.id,
                name="exp",
                environment_ids=[env.id],
                job_count=1,
            )
            db.add(experiment)
            db.flush()
            db.add(
                EvalExperimentJob(
                    experiment_id=experiment.id,
                    environment_id=env.id,
                    combo_index=0,
                    schema_id=schema.id,
                    params={},
                    request_body={},
                    status=job_status,
                )
            )
        db.commit()
        return env.id


def _snapshot(sessions, env_id) -> Optional[EvalRemoteQueueSnapshot]:
    with sessions() as db:
        snap = db.get(EvalRemoteQueueSnapshot, env_id)
        if snap is not None:
            db.expunge(snap)
        return snap


def _raw_row(sessions, env_id) -> str:
    """Every stored column as text, straight from SQL."""
    with sessions() as db:
        row = db.execute(
            text(
                "SELECT fetched_at, fetch_error, items FROM "
                "eval_remote_queue_snapshots WHERE environment_id = :e"
            ),
            {"e": env_id},
        ).one()
    return " ".join(str(value) for value in row)


# --------------------------------------------------------------------------- allow-list


def test_snapshot_item_keeps_only_allowed_fields():
    item = snapshot_item(_remote_job("r1", "pending", priority="high"))
    assert item == {
        "remote_job_id": "r1",
        "status": "PENDING",
        "priority": "HIGH",
        "user_id": "user-1",
        "created_at": "2020-01-01T11:59:00+00:00",
        "run_name": "run-r1",
    }
    assert tuple(item) == SNAPSHOT_FIELDS
    assert snapshot_item({"status": "PENDING"}) is None  # no id
    assert snapshot_item("junk") is None
    odd = snapshot_item({"id": "r2", "user_id": {"nested": "x"}, "eval_input": "x"})
    assert odd["user_id"] is None and odd["run_name"] is None


def test_build_items_orders_running_first_and_dedupes():
    moved = _remote_job("r-moved", "RUNNING")
    pages = {
        "PENDING": {
            "items": [_remote_job("r-p", "PENDING"), dict(moved, status="PENDING")]
        },
        "RUNNING": {"items": [moved]},
    }
    items = build_snapshot_items(pages)
    assert [(i["remote_job_id"], i["status"]) for i in items] == [
        ("r-moved", "RUNNING"),
        ("r-p", "PENDING"),
    ]


# --------------------------------------------------------------------------- refresh


def test_refresh_stores_redacted_snapshot_and_queries_pending_running(
    sessions, service, clock
):
    """Acceptance: env_overrides/eval_input (and any secret) are never stored."""
    env_id = _seed(sessions)
    snap = _snapshotter(sessions, service, clock)
    assert snap.tick() == 1
    assert sorted(c["status"] for c in service.calls) == ["PENDING", "RUNNING"]
    assert all(c["limit"] == 500 and c["user_id"] is None for c in service.calls)

    stored = _snapshot(sessions, env_id)
    assert stored.fetch_error is None
    assert stored.fetched_at == T0
    assert [i["remote_job_id"] for i in stored.items] == ["r-running", "r-pending"]
    for item in stored.items:
        assert set(item) == set(SNAPSHOT_FIELDS)
    raw = _raw_row(sessions, env_id)
    for forbidden in ("env_overrides", "eval_input", "api_key", "token", "result"):
        assert forbidden not in raw
    for secret in SECRETS:
        assert secret not in raw


def test_refresh_only_every_30s_and_only_with_active_local_jobs(
    sessions, service, clock
):
    busy = _seed(sessions, job_status=EvalJobStatus.RUNNING)
    idle = _seed(sessions, job_status=None)
    blocked = _seed(sessions, job_status=EvalJobStatus.BLOCKED)
    done = _seed(sessions, job_status=EvalJobStatus.SUCCEEDED)
    disabled = _seed(sessions, active=False)
    snap = _snapshotter(sessions, service, clock)
    assert snap.due_environment_ids() == [busy]
    snap.tick()
    assert len(service.calls) == 2
    clock.advance(29)
    assert snap.tick() == 0
    assert len(service.calls) == 2
    clock.advance(1)
    assert snap.tick() == 1
    assert len(service.calls) == 4
    for env_id in (idle, blocked, done, disabled):
        assert _snapshot(sessions, env_id) is None
    assert snap.refresh(disabled) == "inactive"
    assert snap.refresh("nope") == "missing"


def test_failed_fetch_keeps_previous_items_and_redacts_error(sessions, service, clock):
    env_id = _seed(sessions)
    snap = _snapshotter(sessions, service, clock)
    snap.tick()
    before = _snapshot(sessions, env_id).items
    service.error = RetryableError(
        f"Evaluation service unreachable: api_key={MODEL_KEY} Bearer {ENV_KEY}"
    )
    clock.advance(30)
    assert snap.refresh(env_id) == "failed"
    stored = _snapshot(sessions, env_id)
    assert stored.items == before
    assert stored.fetch_error.startswith("Evaluation service unreachable")
    assert MODEL_KEY not in stored.fetch_error and ENV_KEY not in stored.fetch_error
    assert stored.fetched_at == clock()  # the attempt time
    service.error = None
    clock.advance(30)
    assert snap.refresh(env_id) == "refreshed"
    assert _snapshot(sessions, env_id).fetch_error is None


def test_first_fetch_failure_leaves_empty_items_with_error(sessions, service, clock):
    env_id = _seed(sessions)
    service.error = RuntimeError(f"weird {MODEL_KEY}")
    assert _snapshotter(sessions, service, clock).refresh(env_id) == "failed"
    stored = _snapshot(sessions, env_id)
    assert stored.items == []
    assert stored.fetch_error == "Remote queue fetch failed: RuntimeError"


def test_401_pauses_env_and_stops_calling_it(sessions, service, clock):
    env_id = _seed(sessions)
    snap = _snapshotter(sessions, service, clock)
    snap.tick()
    service.error = EnvAuthError("rejected", status_code=401)
    clock.advance(30)
    assert snap.refresh(env_id) == "failed"
    with sessions() as db:
        env = db.get(EvalEnvironment, env_id)
        assert env.health_status == "error"
        assert env.health_error == ENV_AUTH_ERROR
    stored = _snapshot(sessions, env_id)
    assert stored.fetch_error == ENV_AUTH_ERROR
    assert len(stored.items) == 2  # previous items kept
    calls = len(service.calls)
    for _ in range(5):
        clock.advance(30)
        snap.tick()
    assert len(service.calls) == calls
    assert _snapshot(sessions, env_id).fetch_error == ENV_AUTH_ERROR
    assert snap.due_environment_ids() == []  # no churn while paused
    # Resumed (dispatcher probe or /test): refreshing picks up again.
    with sessions() as db:
        env = db.get(EvalEnvironment, env_id)
        env.health_status, env.health_error = "ok", None
        db.commit()
    service.error = None
    assert snap.tick() == 1
    assert _snapshot(sessions, env_id).fetch_error is None


def test_fetch_timeout_is_recorded(sessions, service, clock):
    env_id = _seed(sessions)
    service.delay = 0.2
    snap = _snapshotter(sessions, service, clock, fetch_timeout=0.05)
    assert snap.refresh(env_id) == "failed"
    assert (
        _snapshot(sessions, env_id).fetch_error
        == "Evaluation service did not answer in time"
    )
    snap.close()


def test_truncated_listing_is_logged(sessions, service, clock, caplog):
    env_id = _seed(sessions)
    service.total_override = 900
    _snapshotter(sessions, service, clock).refresh(env_id)
    assert "snapshot truncated" in caplog.text
    assert len(_snapshot(sessions, env_id).items) == 2


def test_real_client_list_response_is_allow_listed(sessions, clock):
    """Through the real ``EvalServiceClient``: ``redact_payload`` misses a plain
    ``token`` key, but the allow-list never copies it."""
    import httpx

    env_id = _seed(sessions)
    payload = {
        "total": 1,
        "limit": 500,
        "offset": 0,
        "items": [_remote_job("r-real", "PENDING")],
    }
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params))
        status = request.url.params.get("status")
        body = dict(payload, items=payload["items"] if status == "PENDING" else [])
        return httpx.Response(200, json=body)

    def factory(base_url, api_key):
        return EvalServiceClient(
            base_url,
            api_key,
            allow_private=True,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )

    snap = RemoteQueueSnapshotter(sessions, client_factory=factory, clock=clock)
    assert snap.refresh(env_id) == "refreshed"
    assert {p["status"] for p in seen} == {"PENDING", "RUNNING"}
    assert all(p["limit"] == "500" for p in seen)
    raw = _raw_row(sessions, env_id)
    for secret in SECRETS:
        assert secret not in raw
    assert "eval_input" not in raw and "env_overrides" not in raw
    snap.close()


# --------------------------------------------------------------------------- multi-worker


def test_only_one_worker_fetches_per_interval(sessions, service, clock):
    env_id = _seed(sessions)
    workers = [_snapshotter(sessions, service, clock) for _ in range(4)]
    service.delay = 0.02  # widen the window between claim and store
    barrier = threading.Barrier(len(workers))
    outcomes: List[str] = []
    errors: List[BaseException] = []

    def run(worker):
        try:
            barrier.wait()
            outcomes.append(worker.refresh(env_id))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    for round_ in range(3):
        threads = [threading.Thread(target=run, args=(w,)) for w in workers]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert not errors
        assert len(service.calls) == 2 * (round_ + 1)
        clock.advance(30)
    assert outcomes.count("refreshed") == 3
    assert _snapshot(sessions, env_id).fetch_error is None
    for w in workers:
        w.close()


def test_superseded_claim_does_not_overwrite_newer_snapshot(sessions, service, clock):
    env_id = _seed(sessions)
    slow = _snapshotter(sessions, service, clock)
    fast = _snapshotter(sessions, service, clock)
    slow.refresh(env_id)
    clock.advance(30)
    newer: Dict[str, Any] = {}

    def on_list(status):
        # While the slow worker is fetching, its claim goes stale and another
        # worker refreshes with different data.
        if status == "RUNNING" and not newer:
            newer["done"] = True
            service.on_list = None
            clock.advance(30)
            service.jobs = [_remote_job("r-new", "PENDING")]
            # Another pod: its own thread and event loop.
            result: List[str] = []
            other = threading.Thread(target=lambda: result.append(fast.refresh(env_id)))
            other.start()
            other.join(timeout=30)
            assert result == ["refreshed"]
            service.jobs = [_remote_job("r-old", "PENDING")]

    service.on_list = on_list
    assert slow.refresh(env_id) == "superseded"
    stored = _snapshot(sessions, env_id)
    assert [i["remote_job_id"] for i in stored.items] == ["r-new"]


# --------------------------------------------------------------------------- page views


def test_view_refresh_only_when_stale(sessions, service, clock):
    env_id = _seed(sessions, job_status=None)  # no local jobs: background skips it
    snap = _snapshotter(sessions, service, clock)
    assert snap.tick() == 0
    kwargs = dict(client_factory=service.factory, clock=clock)
    assert refresh_snapshot_on_view(sessions, env_id, **kwargs) == "refreshed"
    assert len(service.calls) == 2
    clock.advance(10)
    assert refresh_snapshot_on_view(sessions, env_id, **kwargs) == "fresh"
    assert len(service.calls) == 2
    with sessions() as db:
        view = read_snapshot(db, env_id, now=clock())
    assert view["stale"] is False and len(view["items"]) == 2
    clock.advance(20)
    with sessions() as db:
        assert read_snapshot(db, env_id, now=clock())["stale"] is True
        assert read_snapshot(db, "nope") is None
    assert refresh_snapshot_on_view(sessions, env_id, **kwargs) == "refreshed"
    assert len(service.calls) == 4


def test_view_refresh_guards_concurrent_viewers(sessions, service, clock):
    env_id = _seed(sessions, job_status=None)
    service.delay = 0.05
    barrier = threading.Barrier(5)
    outcomes: List[str] = []

    def view():
        barrier.wait()
        outcomes.append(
            refresh_snapshot_on_view(
                sessions, env_id, client_factory=service.factory, clock=clock
            )
        )

    threads = [threading.Thread(target=view) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert outcomes.count("refreshed") == 1
    assert set(outcomes) <= {"refreshed", "busy", "fresh"}
    assert len(service.calls) == 2
    assert not rq._views_in_progress


def test_force_refresh_respects_in_progress_claim(sessions, service, clock):
    env_id = _seed(sessions)
    snap = _snapshotter(sessions, service, clock)
    snap.refresh(env_id)
    clock.advance(5)
    assert snap.refresh(env_id, force=True) == "fresh"
    clock.advance(25)
    assert snap.refresh(env_id, force=True) == "refreshed"


def test_initial_placeholder_row_before_first_fetch(sessions, service, clock):
    env_id = _seed(sessions)
    captured: Dict[str, Any] = {}

    def on_list(status):
        if not captured:
            captured["snap"] = _snapshot(sessions, env_id)

    service.on_list = on_list
    _snapshotter(sessions, service, clock).refresh(env_id)
    assert captured["snap"].fetch_error == NOT_FETCHED_YET
    assert captured["snap"].items == []


def test_worker_thread_starts_and_stops(sessions, service, clock):
    _seed(sessions)
    snap = _snapshotter(sessions, service, clock, interval=0.01)
    snap.start()
    try:
        for _ in range(200):
            if service.calls:
                break
            threading.Event().wait(0.01)
    finally:
        assert snap.stop(timeout=5)
    assert service.calls
    assert not snap.is_alive()


def test_paused_env_without_snapshot_gets_reason_row(sessions, service, clock):
    env_id = _seed(sessions, health="error")
    snap = _snapshotter(sessions, service, clock)
    assert snap.refresh(env_id) == "paused"
    stored = _snapshot(sessions, env_id)
    assert stored.fetch_error == "Environment unhealthy" and stored.items == []
    assert service.calls == []


def test_dispatcher_pause_is_noted_once_then_env_leaves_the_scan(
    sessions, service, clock
):
    env_id = _seed(sessions)
    snap = _snapshotter(sessions, service, clock)
    snap.tick()
    with sessions() as db:  # the dispatcher saw a 401
        env = db.get(EvalEnvironment, env_id)
        env.health_status, env.health_error = "error", ENV_AUTH_ERROR
        db.commit()
    clock.advance(30)
    assert snap.due_environment_ids() == [env_id]
    assert snap.refresh(env_id) == "paused"
    assert (
        _snapshot(sessions, env_id).fetch_error
        == "Environment unhealthy: API key rejected"
    )
    assert snap.due_environment_ids() == []
    assert len(service.calls) == 2


def test_superseded_401_does_not_pause_env(sessions, service, clock):
    env_id = _seed(sessions)
    slow = _snapshotter(sessions, service, clock)
    fast = _snapshotter(sessions, service, clock)
    slow.refresh(env_id)
    clock.advance(30)

    def on_list(status):
        # The old key fails; meanwhile another worker refreshes with the new key.
        service.on_list = None
        clock.advance(30)
        result: List[str] = []
        other = threading.Thread(target=lambda: result.append(fast.refresh(env_id)))
        other.start()
        other.join(timeout=30)
        assert result == ["refreshed"]
        service.error = EnvAuthError("rejected", status_code=401)

    service.on_list = on_list
    assert slow.refresh(env_id) == "superseded"
    with sessions() as db:
        assert db.get(EvalEnvironment, env_id).health_status == "ok"
    assert _snapshot(sessions, env_id).fetch_error is None
