"""Multi-worker harness and load test for ``EvalDispatcher`` (plan §16 P6, issue #40).

Several dispatcher instances (one thread, one engine and one lease owner each, like
separate pods) tick concurrently against one database while a thread-safe fake
Evaluation Service records every call. The fake injects latency and failures:

- ``timeout``: the service creates the job, then the client times out (ambiguous).
- ``5xx``: the service answers 503 before creating anything (ambiguous too).
- ``high``: ``409`` while a HIGH job is active (back to ``QUEUED`` with backoff).
- ``crash``: the worker "pod" dies mid-submit (after the ``SUBMITTING`` marker, before
  or after the service created the job). It is restarted with a new lease owner.
- ``cancel_5xx``: ``POST /evals/{id}/cancel`` answers 503 without cancelling.

Time is a shared fake clock. It is frozen while the workers run one *round* (every
worker ticks once, concurrently) and advanced between rounds, so a lease never expires
while its owner is mid-call. That matches production, where ``LEASE_SECONDS`` (120s) is
well above the client's 35s timeout.

Run it as a script for the load test (``--help`` for the options)::

    python tests/platform/eval_dispatch_loadtest.py --workers 8 --jobs-per-env 32
    QYM_TEST_POSTGRES_URL=postgresql+psycopg://... python tests/platform/eval_dispatch_loadtest.py

``tests/platform/test_eval_dispatcher_concurrency.py`` uses the same harness.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import random
import sys
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
for _src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(_src) not in sys.path:
        sys.path.insert(0, str(_src))

from qym_platform.db.base import Base  # noqa: E402
from qym_platform.db.models import (  # noqa: E402
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Project,
    ProjectMembership,
    User,
)
from qym_platform.secrets import encrypt_llm_api_key  # noqa: E402
from qym_platform.services.eval_dispatcher import (  # noqa: E402
    INFLIGHT_JOB_STATUSES,
    EvalDispatcher,
    launch_job_id,
)
from qym_platform.services.eval_experiments import (  # noqa: E402
    TERMINAL_JOB_STATUSES,
)
from qym_platform.services.eval_submitter_keys import (  # noqa: E402
    issue_experiment_api_key,
)
from qym_platform.services.eval_service_client import (  # noqa: E402
    HighPriorityActive,
    NotCancellable,
    RemoteNotFound,
    RetryableError,
)
from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

T0 = datetime(2020, 1, 1, 12, 0, 0)
ENV_KEY = "env-service-key-LOAD0040"


class WorkerCrash(BaseException):
    """Simulated pod death: not an ``Exception``, so ``tick()`` does not catch it."""


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


@dataclass
class Faults:
    """Per-call fault probabilities (drawn from one seeded RNG)."""

    timeout_after_accept: float = 0.0
    submit_5xx: float = 0.0
    high: float = 0.0
    crash_before_post: float = 0.0
    crash_after_accept: float = 0.0
    cancel_5xx: float = 0.0
    list_5xx: float = 0.0
    latency: Tuple[float, float] = (0.0, 0.0)  # seconds, uniform
    # Forced outcomes for the first POSTs / cancels, in call order, so a test can
    # rely on each fault happening at least once whatever the random draws do.
    first_submits: Tuple[str, ...] = ()
    first_cancels_5xx: int = 0


@dataclass
class ServiceStats:
    post_calls: int = 0
    created: Counter = field(default_factory=Counter)  # qym job id -> remote jobs
    outcomes: Counter = field(default_factory=Counter)
    get_calls: int = 0
    list_calls: int = 0
    cancel_calls: List[Tuple[str, str]] = field(default_factory=list)  # (rid, result)
    double_cancels: List[str] = field(default_factory=list)
    max_occupied: Counter = field(default_factory=Counter)  # env -> max seen
    max_concurrent_posts: int = 0


class LoadTestService:
    """Thread-safe fake Evaluation Service, one remote queue per environment URL.

    ``occupied(env)`` = remote jobs ``PENDING``/``RUNNING`` + ``POST /evals`` calls in
    progress, recorded on every change ("at any instant" for this fake). The
    platform has no in-flight cap: the real service bounds and queues runs itself.
    """

    def __init__(
        self,
        clock: FakeClock,
        *,
        faults: Optional[Faults] = None,
        seed: int = 40,
    ) -> None:
        self.clock = clock
        self.faults = faults or Faults()
        self.rng = random.Random(seed)
        self.lock = threading.Lock()
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.env_of: Dict[str, str] = {}
        self.order: List[str] = []  # newest first
        self.posts_in_progress: Counter = Counter()
        self.stats = ServiceStats()

    # -- bookkeeping (call with the lock held) ----------------------------------

    def _roll(self, p: float) -> bool:
        return p > 0 and self.rng.random() < p

    def _occupied(self, env: str) -> int:
        active = sum(
            1
            for rid, job in self.jobs.items()
            if self.env_of[rid] == env and job["status"] in ("PENDING", "RUNNING")
        )
        return active + self.posts_in_progress[env]

    def _track_occupied(self, env: str) -> None:
        occupied = self._occupied(env)
        if occupied > self.stats.max_occupied[env]:
            self.stats.max_occupied[env] = occupied

    def _latency(self) -> float:
        low, high = self.faults.latency
        return self.rng.uniform(low, high) if high > 0 else 0.0

    # -- API ---------------------------------------------------------------------

    async def submit(self, env: str, body: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            self.stats.post_calls += 1
            self.posts_in_progress[env] += 1
            self.stats.max_concurrent_posts = max(
                self.stats.max_concurrent_posts, sum(self.posts_in_progress.values())
            )
            self._track_occupied(env)
            delay = self._latency()
            f = self.faults
            forced = f.first_submits
            if self.stats.post_calls <= len(forced):
                fault = forced[self.stats.post_calls - 1]
            elif self._roll(f.crash_before_post):
                fault = "crash_before_post"
            elif self._roll(f.submit_5xx):
                fault = "5xx"
            elif self._roll(f.high):
                fault = "high"
            elif self._roll(f.timeout_after_accept):
                fault = "timeout"
            elif self._roll(f.crash_after_accept):
                fault = "crash_after_accept"
            else:
                fault = "accepted"
        try:
            if delay:
                await asyncio.sleep(delay)
            with self.lock:
                self.stats.outcomes[fault] += 1
                if fault == "crash_before_post":
                    raise WorkerCrash("pod died before the POST")
                if fault == "5xx":
                    raise RetryableError(
                        "Evaluation service returned 503", status_code=503
                    )
                if fault == "high":
                    raise HighPriorityActive(
                        "HIGH priority job active", job_id="high-1", priority="NORMAL"
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
                self.env_of[rid] = env
                self.order.insert(0, rid)
                self.stats.created[launch_job_id(job)] += 1
                self.posts_in_progress[env] -= 1
                self._track_occupied(env)
                if fault == "timeout":
                    raise RetryableError("Evaluation service request timed out")
                if fault == "crash_after_accept":
                    raise WorkerCrash("pod died after the service accepted the job")
                return copy.deepcopy(job)
        finally:
            with self.lock:
                if fault in ("crash_before_post", "5xx", "high"):
                    self.posts_in_progress[env] -= 1

    async def get(self, env: str, rid: str) -> Dict[str, Any]:
        with self.lock:
            self.stats.get_calls += 1
            if rid not in self.jobs or self.env_of[rid] != env:
                raise RemoteNotFound("eval job not found", status_code=404)
            return copy.deepcopy(self.jobs[rid])

    async def list(
        self,
        env: str,
        *,
        status: Any = None,
        user_id: Any = None,
        priority: Any = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        with self.lock:
            self.stats.list_calls += 1
            if self._roll(self.faults.list_5xx):
                raise RetryableError("Evaluation service returned 502", status_code=502)
            items = [
                self.jobs[rid]
                for rid in self.order
                if self.env_of[rid] == env
                and (user_id is None or self.jobs[rid]["user_id"] == user_id)
                and (status is None or self.jobs[rid]["status"] == status)
            ]
            page = items[offset : offset + (limit or 50)]
            return {
                "total": len(items),
                "limit": limit,
                "offset": offset,
                "items": copy.deepcopy(page),
            }

    async def cancel(self, env: str, rid: str, user_id: str) -> Dict[str, Any]:
        with self.lock:
            forced = len(self.stats.cancel_calls) < self.faults.first_cancels_5xx
            if forced or self._roll(self.faults.cancel_5xx):
                self.stats.cancel_calls.append((rid, "5xx"))
                raise RetryableError("Evaluation service returned 503", status_code=503)
            if rid not in self.jobs or self.env_of[rid] != env:
                self.stats.cancel_calls.append((rid, "404"))
                raise RemoteNotFound("eval job not found", status_code=404)
            job = self.jobs[rid]
            if job["status"] == "CANCELLED":
                self.stats.double_cancels.append(rid)
            if job["status"] not in ("PENDING", "RUNNING"):
                self.stats.cancel_calls.append((rid, "409"))
                raise NotCancellable(
                    f"cannot cancel job in status {job['status']}",
                    status=job["status"],
                )
            self.stats.cancel_calls.append((rid, "200"))
            job.update(status="CANCELLED", cancelled_by_user_id=user_id)
            self._track_occupied(env)
            return copy.deepcopy(job)

    # -- remote progress (called by the driver between rounds) -------------------

    def advance(self, *, start: float = 0.5, finish: float = 0.35) -> None:
        """Move remote jobs along: PENDING → RUNNING → SUCCEEDED, at random."""
        with self.lock:
            for rid in list(self.order):
                job = self.jobs[rid]
                if job["status"] == "PENDING" and self.rng.random() < start:
                    job["status"] = "RUNNING"
                elif job["status"] == "RUNNING" and self.rng.random() < finish:
                    job["status"] = "SUCCEEDED"
                    job["result"] = {"versioning_metadata": {"agent_version": "a1"}}

    def client_factory(self) -> Callable[[str, str], "EnvClient"]:
        def factory(base_url: str, api_key: str) -> EnvClient:
            assert api_key == ENV_KEY
            return EnvClient(self, base_url)

        return factory


class EnvClient:
    """What ``EvalDispatcher`` sees: an ``EvalServiceClient`` for one environment."""

    def __init__(self, service: LoadTestService, env: str) -> None:
        self.service = service
        self.env = env

    async def submit(self, body):
        return await self.service.submit(self.env, body)

    async def get(self, rid):
        return await self.service.get(self.env, rid)

    async def list(self, **kwargs):
        return await self.service.list(self.env, **kwargs)

    async def cancel(self, rid, user_id):
        return await self.service.cancel(self.env, rid, user_id)

    async def aclose(self):
        return None


# --------------------------------------------------------------------------- database


def sqlite_engine_factory(path: Path) -> Callable[[], Any]:
    url = f"sqlite:///{path}"

    def make():
        return create_engine(
            url, connect_args={"check_same_thread": False, "timeout": 60}
        )

    return make


def postgres_engine_factory(url: str, schema: str) -> Callable[[], Any]:
    def make():
        return create_engine(
            url, connect_args={"options": f"-csearch_path={schema}"}, pool_size=4
        )

    return make


def create_postgres_schema(url: str) -> str:
    schema = "eval_loadtest_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    admin.dispose()
    return schema


def drop_postgres_schema(url: str, schema: str) -> None:
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


def _body(user_id: str, experiment_id: str, job_id: str, combo: int) -> Dict[str, Any]:
    return {
        "user_id": user_id,
        "priority": "NORMAL",
        "evaluator": {
            "dataset": "playground",
            "config": {
                "samples": 1,
                "temperature": round(0.1 * (combo % 8), 1),
                "run_metadata": {
                    "qym_launch": {"experiment_id": experiment_id, "job_id": job_id},
                },
            },
        },
    }


def seed_sweep(
    sessions: Callable[[], Any], *, envs: int = 2, jobs_per_env: int = 32
) -> Dict[str, Any]:
    """One experiment: ``envs`` environments × ``jobs_per_env`` QUEUED combos.

    The same rows a sweep launch creates (#32): one job per (environment, combo),
    each with its stored request body and ``qym_launch.job_id``.
    """
    with sessions() as db:
        user = User(email=f"{uuid4().hex[:8]}@example.com")
        db.add(user)
        db.flush()
        project = Project(
            name="Load", slug="load-" + uuid4().hex[:6], created_by_user_id=user.id
        )
        db.add(project)
        db.flush()
        db.add(ProjectMembership(project_id=project.id, user_id=user.id))
        env_rows = []
        for index in range(envs):
            env = EvalEnvironment(
                project_id=project.id,
                name=f"env-{index}",
                base_url=f"https://env-{index}.example",
                api_key_encrypted=encrypt_llm_api_key(ENV_KEY),
                health_status="ok",
            )
            db.add(env)
            db.flush()
            schema = EvalEnvironmentSchema(
                environment_id=env.id, schema_hash=f"h{index}", schema_json={}
            )
            db.add(schema)
            db.flush()
            env_rows.append((env, schema))
        experiment = EvalExperiment(
            project_id=project.id,
            created_by_user_id=user.id,
            name="sweep",
            environment_ids=[env.id for env, _ in env_rows],
            job_count=envs * jobs_per_env,
        )
        db.add(experiment)
        db.flush()
        issue_experiment_api_key(db, experiment)  # as a real launch does
        job_ids: List[str] = []
        combo = 0
        for env, schema in env_rows:
            for _ in range(jobs_per_env):
                job_id = str(uuid4())
                db.add(
                    EvalExperimentJob(
                        id=job_id,
                        experiment_id=experiment.id,
                        environment_id=env.id,
                        combo_index=combo,
                        schema_id=schema.id,
                        params={},
                        request_body=_body(user.id, experiment.id, job_id, combo),
                        created_at=T0 + timedelta(milliseconds=combo),
                        updated_at=T0,
                    )
                )
                job_ids.append(job_id)
                combo += 1
        db.commit()
        return {
            "user_id": user.id,
            "project_id": project.id,
            "experiment_id": experiment.id,
            "env_ids": [env.id for env, _ in env_rows],
            "job_ids": job_ids,
        }


def inflight_by_env(sessions: Callable[[], Any]) -> Dict[str, int]:
    job = EvalExperimentJob
    with sessions() as db:
        rows = db.execute(
            select(job.environment_id, func.count())
            .where(job.status.in_(INFLIGHT_JOB_STATUSES))
            .group_by(job.environment_id)
        ).all()
    return {env_id: int(count) for env_id, count in rows}


def job_rows(sessions: Callable[[], Any], job_ids: Sequence[str]) -> Dict[str, Any]:
    with sessions() as db:
        rows = db.execute(
            select(EvalExperimentJob).where(EvalExperimentJob.id.in_(list(job_ids)))
        ).scalars()
        out = {}
        for row in rows:
            db.expunge(row)
            out[row.id] = row
        return out


def experiment_status_of(sessions: Callable[[], Any], experiment_id: str) -> str:
    with sessions() as db:
        return db.get(EvalExperiment, experiment_id).status.value


# --------------------------------------------------------------------------- harness


@dataclass
class SweepResult:
    rounds: int
    wall_seconds: float
    tick_seconds: List[float]
    claims_by_worker: Counter
    crashes: int
    restarts: int
    worker_errors: List[str]
    db_max_inflight: Dict[str, int]
    final_status: Counter
    all_terminal: bool


class Pod:
    """One dispatcher "pod": its own engine, sessions and lease owner."""

    def __init__(
        self,
        name: str,
        make_engine: Callable[[], Any],
        service: LoadTestService,
        clock: FakeClock,
        batch: int,
    ) -> None:
        self.name = name
        self.engine = make_engine()
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)
        self.service = service
        self.clock = clock
        self.batch = batch
        self.generation = 0
        self.dispatcher = self._new_dispatcher()

    def _new_dispatcher(self) -> EvalDispatcher:
        return EvalDispatcher(
            self.sessions,
            client_factory=self.service.client_factory(),
            clock=self.clock,
            owner=f"{self.name}-g{self.generation}-{uuid4().hex[:6]}",
            batch=self.batch,
            add_launch_token=lambda body, job_id: body,
        )

    def restart(self) -> None:
        """A crashed pod comes back with a fresh process: new lease owner."""
        self.dispatcher.close()
        self.generation += 1
        self.dispatcher = self._new_dispatcher()

    def close(self) -> None:
        self.dispatcher.close()
        self.engine.dispose()


def run_sweep(
    make_engine: Callable[[], Any],
    service: LoadTestService,
    clock: FakeClock,
    job_ids: Sequence[str],
    *,
    workers: int = 4,
    batch: int = 4,
    advance_seconds: float = 15.0,
    max_rounds: int = 400,
    during_round: Optional[Dict[int, Callable[[], Any]]] = None,
    sample_db: bool = True,
) -> SweepResult:
    """Tick ``workers`` pods concurrently, one round at a time, until all jobs end.

    Each round: every pod ticks once in its own thread (released together by a
    barrier) while an optional action for that round (e.g. a queue cancel) runs in
    another thread and a sampler records the per-environment in-flight count in the
    database. Between rounds the service moves remote jobs along and the clock
    advances. A pod whose tick raised ``WorkerCrash`` is restarted before the next
    round with a new lease owner; its leases expire on their own.
    """
    observer_engine = make_engine()
    observe = sessionmaker(bind=observer_engine, autoflush=False)
    pods = [Pod(f"pod{i}", make_engine, service, clock, batch) for i in range(workers)]
    during_round = during_round or {}
    claims: Counter = Counter()
    errors: List[str] = []
    crashed: List[Pod] = []
    crashes = restarts = 0
    tick_seconds: List[float] = []
    db_max: Counter = Counter()
    state_lock = threading.Lock()
    start_barrier = threading.Barrier(workers + 1)
    end_barrier = threading.Barrier(workers + 1)
    stop = threading.Event()

    def pod_loop(pod: Pod) -> None:
        while True:
            start_barrier.wait()
            if stop.is_set():
                return
            began = time.perf_counter()
            try:
                n = pod.dispatcher.tick()
                with state_lock:
                    claims[pod.name] += n
            except WorkerCrash:
                with state_lock:
                    crashed.append(pod)
            except BaseException as exc:  # noqa: BLE001
                with state_lock:
                    errors.append(f"{pod.name}: {type(exc).__name__}: {exc}")
            finally:
                with state_lock:
                    tick_seconds.append(time.perf_counter() - began)
                end_barrier.wait()

    def sampler(done: threading.Event) -> None:
        while not done.is_set():
            try:
                counts = inflight_by_env(observe)
            except Exception:  # noqa: BLE001 - a busy SQLite read; sample again
                continue
            for env_id, count in counts.items():
                db_max[env_id] = max(db_max[env_id], count)
            done.wait(0.002)

    threads = [
        threading.Thread(target=pod_loop, args=(pod,), daemon=True) for pod in pods
    ]
    for t in threads:
        t.start()

    wall_start = time.perf_counter()
    rounds = 0
    all_terminal = False
    try:
        for rounds in range(1, max_rounds + 1):
            done = threading.Event()
            samplers = []
            if sample_db:
                samplers.append(threading.Thread(target=sampler, args=(done,)))
            action = during_round.get(rounds)
            if action is not None:
                samplers.append(threading.Thread(target=action))
            for t in samplers:
                t.start()
            start_barrier.wait()
            end_barrier.wait()
            done.set()
            for t in samplers:
                t.join(timeout=120)
            for pod in crashed:
                crashes += 1
                pod.restart()
                restarts += 1
            crashed.clear()
            statuses = {j.status for j in job_rows(observe, job_ids).values()}
            if statuses <= set(TERMINAL_JOB_STATUSES):
                all_terminal = True
                break
            service.advance()
            clock.advance(advance_seconds)
    finally:
        stop.set()
        start_barrier.wait()
        for t in threads:
            t.join(timeout=30)
        for pod in pods:
            pod.close()
    wall = time.perf_counter() - wall_start
    final = Counter(j.status.value for j in job_rows(observe, job_ids).values())
    observer_engine.dispose()
    return SweepResult(
        rounds=rounds,
        wall_seconds=wall,
        tick_seconds=tick_seconds,
        claims_by_worker=claims,
        crashes=crashes,
        restarts=restarts,
        worker_errors=errors,
        db_max_inflight=dict(db_max),
        final_status=final,
        all_terminal=all_terminal,
    )


def duplicate_submissions(service: LoadTestService) -> Dict[str, int]:
    """qym job ids with more than one remote job (must be empty)."""
    return {job: n for job, n in service.stats.created.items() if n > 1}


# --------------------------------------------------------------------------- CLI


def _percentile(values: Sequence[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--envs", type=int, default=2)
    parser.add_argument("--jobs-per-env", type=int, default=32)
    parser.add_argument("--advance", type=float, default=15.0)
    parser.add_argument("--latency-ms", type=float, default=5.0)
    parser.add_argument("--faults", action="store_true", help="inject failures")
    parser.add_argument("--seed", type=int, default=40)
    parser.add_argument(
        "--postgres",
        default=os.environ.get("QYM_TEST_POSTGRES_URL"),
        help="Postgres URL (default: $QYM_TEST_POSTGRES_URL; SQLite file otherwise)",
    )
    parser.add_argument("--json", action="store_true", help="print JSON only")
    args = parser.parse_args(argv)

    if not os.environ.get("QYM_LLM_CONFIG_ENCRYPTION_KEY"):
        from cryptography.fernet import Fernet

        os.environ["QYM_LLM_CONFIG_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

    schema = None
    tmpdir = None
    if args.postgres:
        schema = create_postgres_schema(args.postgres)
        make_engine = postgres_engine_factory(args.postgres, schema)
        backend = "postgresql"
    else:
        import tempfile

        tmpdir = tempfile.TemporaryDirectory()
        make_engine = sqlite_engine_factory(Path(tmpdir.name) / "loadtest.db")
        backend = "sqlite"
    faults = Faults(latency=(0.0, args.latency_ms / 1000.0))
    if args.faults:
        faults = Faults(
            timeout_after_accept=0.08,
            submit_5xx=0.08,
            high=0.08,
            crash_before_post=0.03,
            crash_after_accept=0.03,
            list_5xx=0.05,
            latency=(0.0, args.latency_ms / 1000.0),
        )
    try:
        setup = make_engine()
        Base.metadata.create_all(setup)
        sessions = sessionmaker(bind=setup, autoflush=False)
        seed = seed_sweep(sessions, envs=args.envs, jobs_per_env=args.jobs_per_env)
        clock = FakeClock()
        service = LoadTestService(clock, faults=faults, seed=args.seed)
        result = run_sweep(
            make_engine,
            service,
            clock,
            seed["job_ids"],
            workers=args.workers,
            batch=args.batch,
            advance_seconds=args.advance,
        )
        rows = job_rows(sessions, seed["job_ids"])
        experiment_status = experiment_status_of(sessions, seed["experiment_id"])
        setup.dispose()
    finally:
        if schema:
            drop_postgres_schema(args.postgres, schema)
        if tmpdir is not None:
            tmpdir.cleanup()

    stats = service.stats
    report = {
        "backend": backend,
        "workers": args.workers,
        "batch": args.batch,
        "jobs": len(seed["job_ids"]),
        "envs": args.envs,
        "faults": args.faults,
        "rounds": result.rounds,
        "simulated_seconds": result.rounds * args.advance,
        "wall_seconds": round(result.wall_seconds, 2),
        "tick_ms_p50": round(1000 * _percentile(result.tick_seconds, 0.5), 1),
        "tick_ms_p95": round(1000 * _percentile(result.tick_seconds, 0.95), 1),
        "tick_ms_max": round(1000 * max(result.tick_seconds or [0.0]), 1),
        "claims_by_worker": dict(sorted(result.claims_by_worker.items())),
        "post_calls": stats.post_calls,
        "post_outcomes": dict(stats.outcomes),
        "remote_jobs_created": sum(stats.created.values()),
        "duplicate_submissions": duplicate_submissions(service),
        "max_submit_attempts": max(r.submit_attempts for r in rows.values()),
        "get_calls": stats.get_calls,
        "list_calls": stats.list_calls,
        "crashes": result.crashes,
        "remote_max_occupied": dict(stats.max_occupied),
        "db_max_inflight": sorted(result.db_max_inflight.values()),
        "max_concurrent_posts": stats.max_concurrent_posts,
        "worker_errors": result.worker_errors,
        "final_status": dict(result.final_status),
        "all_terminal": result.all_terminal,
        "experiment_status": experiment_status,
    }
    ok = (
        result.all_terminal
        and not report["duplicate_submissions"]
        and not result.worker_errors
        and experiment_status == "COMPLETED"
    )
    report["ok"] = ok
    print(json.dumps(report, indent=None if args.json else 2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
