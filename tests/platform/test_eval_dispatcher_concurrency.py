"""Several dispatcher pods against one database (plan §13, §13.1, §16 P6, issue #40).

Each pod is an ``EvalDispatcher`` with its own engine, sessions and lease owner, ticking
in its own thread. They run concurrently, one round at a time, against a thread-safe fake
Evaluation Service that injects latency, timeouts after the service accepted the job,
5xx answers, ``409`` HIGH conflicts, pod crashes mid-submit and cancel failures
(``eval_dispatch_loadtest``). The tests assert:

- exactly one remote job per qym job (no double submit), however the POSTs failed;
- no remote cancel of a job that is already cancelled (no double cancel);
- the per-environment in-flight cap is never exceeded, neither remotely (checked by the
  fake on every change) nor in the database (sampled while the pods run);
- every job ends terminal and the experiment's aggregate status is settled.

SQLite runs with 4 pods (writers are serialized by the database lock, so more threads
only queue up on it). Postgres, where ``FOR UPDATE SKIP LOCKED`` and the environment row
lock matter, runs with 8 when ``QYM_TEST_POSTGRES_URL`` is set. The full 64-job sweep
is ``slow`` and runs only with ``QYM_TEST_SLOW=1``. Results:
``docs/internal/EVAL_DISPATCHER_LOAD_TEST.md``.
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_dispatch_loadtest import (  # noqa: E402
    FakeClock,
    Faults,
    LoadTestService,
    create_postgres_schema,
    drop_postgres_schema,
    duplicate_submissions,
    experiment_status_of,
    job_rows,
    postgres_engine_factory,
    run_sweep,
    seed_sweep,
    sqlite_engine_factory,
)
from qym_platform.auth import Principal  # noqa: E402
from qym_platform.db.base import Base  # noqa: E402
from qym_platform.db.models import (  # noqa: E402
    EvalExperimentJob,
    EvalJobStatus,
    User,
)
from qym_platform.services import eval_dispatcher as dispatcher_module  # noqa: E402
from qym_platform.services import eval_experiments  # noqa: E402
from qym_platform.services.eval_experiments import cancel_jobs  # noqa: E402

PG_URL = os.environ.get("QYM_TEST_POSTGRES_URL")


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
                not PG_URL, reason="QYM_TEST_POSTGRES_URL not configured"
            ),
        ),
    ]


class Backend:
    def __init__(self, name, make_engine):
        self.name = name
        self.make_engine = make_engine
        self.engine = make_engine()
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)

    @property
    def workers(self) -> int:
        return 8 if self.name == "postgres" else 4


@pytest.fixture(params=_backends())
def backend(request, tmp_path):
    if request.param == "sqlite":
        db = Backend("sqlite", sqlite_engine_factory(tmp_path / "pods.db"))
        try:
            yield db
        finally:
            db.engine.dispose()
        return
    schema = create_postgres_schema(PG_URL)
    db = None
    try:
        db = Backend("postgres", postgres_engine_factory(PG_URL, schema))
        yield db
    finally:
        if db is not None:
            db.engine.dispose()
        drop_postgres_schema(PG_URL, schema)


@pytest.fixture()
def clock(monkeypatch):
    clock = FakeClock()
    # cancel_jobs stamps times and checks leases on the dispatcher's clock.
    monkeypatch.setattr(eval_experiments, "utc_now_naive", clock)
    return clock


def _sweep(backend, clock, *, envs=2, jobs_per_env=8, cap=3, faults=None, seed=40):
    setup = seed_sweep(backend.sessions, envs=envs, jobs_per_env=jobs_per_env, cap=cap)
    service = LoadTestService(clock, setup["caps"], faults=faults, seed=seed)
    return setup, service


def _run(backend, clock, setup, service, **kwargs):
    kwargs.setdefault("workers", backend.workers)
    kwargs.setdefault("batch", 2)
    return run_sweep(
        backend.make_engine,
        service,
        clock,
        setup["job_ids"],
        caps_by_env_id={env_id: service.caps[url] for env_id, url in _env_urls(setup)},
        **kwargs,
    )


def _env_urls(setup):
    return list(zip(setup["env_ids"], setup["caps"]))


def _assert_safe(setup, service, result):
    assert result.worker_errors == []
    assert duplicate_submissions(service) == {}
    assert service.stats.cap_violations == []
    assert result.db_cap_violations == []
    assert service.stats.double_cancels == []
    assert result.all_terminal, result.final_status


# --------------------------------------------------------------------------- submit


def test_pods_never_double_submit_and_never_exceed_the_cap(backend, clock):
    """Timeouts after accept, 5xx and 409 HIGH, with latency, across several pods."""
    faults = Faults(
        timeout_after_accept=0.15,
        submit_5xx=0.15,
        high=0.15,
        list_5xx=0.1,
        latency=(0.0, 0.004),
        first_submits=("timeout", "5xx", "high"),
    )
    setup, service = _sweep(backend, clock, faults=faults)
    result = _run(backend, clock, setup, service)

    _assert_safe(setup, service, result)
    stats = service.stats
    # Every job reached the service exactly once, whatever the earlier POSTs did.
    assert sorted(stats.created) == sorted(setup["job_ids"])
    assert set(stats.created.values()) == {1}
    for fault in ("timeout", "5xx", "high"):
        assert stats.outcomes[fault] > 0, stats.outcomes
    assert stats.list_calls > 0  # ambiguous POSTs were reconciled, not resubmitted
    # The caps were reached (the test is meaningful) and never exceeded.
    assert set(result.db_max_inflight.values()) == {3}
    assert max(stats.max_occupied.values()) <= 3
    # Work was spread over the pods.
    assert len([n for n in result.claims_by_worker.values() if n]) > 1
    rows = job_rows(backend.sessions, setup["job_ids"])
    assert {r.status for r in rows.values()} == {EvalJobStatus.SUCCEEDED}
    assert all(r.lease_owner is None for r in rows.values())
    assert all(r.remote_job_id in service.jobs for r in rows.values())
    assert experiment_status_of(backend.sessions, setup["experiment_id"]) == (
        "COMPLETED"
    )


def test_crashed_pods_leave_submitting_jobs_that_reconcile_without_duplicates(
    backend, clock
):
    """A pod dies after the SUBMITTING marker, before or after the service accepted
    the job. Its lease expires, another pod reconciles (adopts or resubmits once)."""
    faults = Faults(
        crash_before_post=0.2,
        crash_after_accept=0.2,
        latency=(0.0, 0.002),
        first_submits=("crash_after_accept", "crash_before_post"),
    )
    setup, service = _sweep(backend, clock, faults=faults, seed=7)
    result = _run(backend, clock, setup, service)

    _assert_safe(setup, service, result)
    stats = service.stats
    assert stats.outcomes["crash_before_post"] > 0
    assert stats.outcomes["crash_after_accept"] > 0
    assert result.crashes == result.restarts > 0
    assert stats.list_calls > 0
    assert set(stats.created.values()) == {1}
    assert sorted(stats.created) == sorted(setup["job_ids"])
    rows = job_rows(backend.sessions, setup["job_ids"])
    assert {r.status for r in rows.values()} == {EvalJobStatus.SUCCEEDED}
    # A job whose POST crashed after acceptance was adopted, not resubmitted: its
    # remote job carries its own qym job id.
    for job_id, row in rows.items():
        remote = service.jobs[row.remote_job_id]
        assert (
            remote["eval_input"]["config"]["run_metadata"]["qym_launch"]["job_id"]
            == job_id
        )


# --------------------------------------------------------------------------- cancel


def _principal(sessions, user_id):
    db = sessions()
    return db, Principal(user=db.get(User, user_id), auth_type="proxy_headers")


def test_queue_cancel_racing_pods_never_double_cancels(backend, clock):
    """Bulk cancels of a whole environment land (twice) while pods submit and poll."""
    faults = Faults(
        timeout_after_accept=0.1,
        submit_5xx=0.1,
        cancel_5xx=0.25,
        latency=(0.0, 0.004),
        first_cancels_5xx=1,
    )
    setup, service = _sweep(backend, clock, faults=faults, seed=11)
    env0 = setup["env_ids"][0]
    with backend.sessions() as db:
        env0_jobs = [
            j.id
            for j in db.query(EvalExperimentJob).filter(
                EvalExperimentJob.environment_id == env0
            )
        ]
    outcomes = []
    cancel_errors = []

    def cancel_env0():
        try:
            db, principal = _principal(backend.sessions, setup["user_id"])
            with db:
                outcomes.append(cancel_jobs(db, env0_jobs, principal, "bulk"))
                db.commit()
        except Exception as exc:  # noqa: BLE001 - surfaced by the assertion below
            cancel_errors.append(repr(exc))

    result = _run(
        backend,
        clock,
        setup,
        service,
        during_round={3: cancel_env0, 4: cancel_env0, 6: cancel_env0},
    )

    _assert_safe(setup, service, result)
    assert cancel_errors == []
    assert len(outcomes) == 3
    first = outcomes[0]
    assert set(first.values()) <= {"cancelled", "cancelling", "already_terminal"}
    assert "cancelling" in first.values()  # some were live remotely
    stats = service.stats
    assert set(stats.created.values()) == {1}  # still no double submit
    rows = job_rows(backend.sessions, setup["job_ids"])
    ok_cancels = [rid for rid, answer in stats.cancel_calls if answer == "200"]
    assert len(ok_cancels) == len(set(ok_cancels))
    assert any(answer == "5xx" for _, answer in stats.cancel_calls)
    for job_id in env0_jobs:
        row = rows[job_id]
        assert row.status in (EvalJobStatus.CANCELLED, EvalJobStatus.SUCCEEDED)
        if row.status == EvalJobStatus.CANCELLED and row.remote_job_id:
            assert service.jobs[row.remote_job_id]["status"] == "CANCELLED"
        if row.status == EvalJobStatus.CANCELLED and first.get(job_id) == "cancelled":
            # Cancelled while queued: never reached the service afterwards.
            assert stats.created[job_id] == 0
    for job_id in set(setup["job_ids"]) - set(env0_jobs):
        assert rows[job_id].status == EvalJobStatus.SUCCEEDED
    # Env 1 finished; env 0 was cancelled: the experiment is partial.
    assert experiment_status_of(backend.sessions, setup["experiment_id"]) == "PARTIAL"


# --------------------------------------------------------------------------- aggregate


def test_sibling_jobs_settling_at_once_complete_the_experiment(backend, clock):
    """Regression (#40): two pods settle the last two jobs in overlapping
    transactions. On Postgres each used to read the other's job as still running
    (READ COMMITTED) and the experiment stayed RUNNING with every job SUCCEEDED."""
    setup = seed_sweep(backend.sessions, envs=1, jobs_per_env=2, cap=2)
    first, second = setup["job_ids"]
    with backend.sessions() as db:
        for job in db.query(EvalExperimentJob):
            job.status = EvalJobStatus.RUNNING
        dispatcher_module.recompute_experiment_status(db, setup["experiment_id"])
        db.commit()
    assert experiment_status_of(backend.sessions, setup["experiment_id"]) == "RUNNING"

    other_engine = backend.make_engine()
    other_sessions = sessionmaker(bind=other_engine, autoflush=False)
    errors = []

    def settle(sessions, job_id):
        with sessions() as db:
            db.get(EvalExperimentJob, job_id).status = EvalJobStatus.SUCCEEDED
            db.flush()
            dispatcher_module.recompute_experiment_status(db, setup["experiment_id"])
            db.commit()

    def settle_second():
        try:
            settle(other_sessions, second)
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))

    try:
        with backend.sessions() as db:
            db.get(EvalExperimentJob, first).status = EvalJobStatus.SUCCEEDED
            db.flush()
            dispatcher_module.recompute_experiment_status(db, setup["experiment_id"])
            # The second pod settles its job while this transaction is still open.
            thread = threading.Thread(target=settle_second)
            thread.start()
            thread.join(timeout=0.5)
            db.commit()
        thread.join(timeout=60)
    finally:
        other_engine.dispose()
    assert not thread.is_alive()
    assert errors == []
    assert experiment_status_of(backend.sessions, setup["experiment_id"]) == (
        "COMPLETED"
    )


@pytest.mark.parametrize("first", ["settle", "cancel"])
def test_queue_cancel_racing_a_dispatcher_settle_settles_the_experiment(
    backend, clock, first
):
    """Regression: a queue cancel of the last queued job overlaps a dispatcher
    transaction settling the last running one. ``cancel_jobs`` recomputed without the
    experiment row lock, so on Postgres each side read the other's job as still
    active and the experiment stayed ``RUNNING`` with every job settled."""
    setup = seed_sweep(backend.sessions, envs=1, jobs_per_env=2, cap=2)
    running, queued = setup["job_ids"]
    with backend.sessions() as db:
        db.get(EvalExperimentJob, running).status = EvalJobStatus.RUNNING
        dispatcher_module.recompute_experiment_status(db, setup["experiment_id"])
        db.commit()
    assert experiment_status_of(backend.sessions, setup["experiment_id"]) == "RUNNING"

    other_engine = backend.make_engine()
    other_sessions = sessionmaker(bind=other_engine, autoflush=False)
    outcomes = []
    errors = []

    def settle(db):
        # The dispatcher's order: job row (locked), then the experiment row.
        job = db.execute(
            select(EvalExperimentJob)
            .where(EvalExperimentJob.id == running)
            .with_for_update()
        ).scalar_one()
        job.status = EvalJobStatus.SUCCEEDED
        db.flush()
        dispatcher_module.recompute_experiment_status(db, setup["experiment_id"])

    def cancel(db):
        principal = Principal(user=db.get(User, setup["user_id"]), auth_type="x")
        outcomes.append(cancel_jobs(db, [queued], principal, "queue"))

    steps = {"settle": settle, "cancel": cancel}
    second = "cancel" if first == "settle" else "settle"

    def run_second():
        try:
            with other_sessions() as db:
                steps[second](db)
                db.commit()
        except Exception as exc:  # noqa: BLE001 - surfaced by the assertion below
            errors.append(repr(exc))

    try:
        with backend.sessions() as db:
            steps[first](db)
            # The other side runs while this transaction is still open.
            thread = threading.Thread(target=run_second)
            thread.start()
            thread.join(timeout=0.5)
            db.commit()
        thread.join(timeout=60)
    finally:
        other_engine.dispose()
    assert not thread.is_alive()
    assert errors == []
    assert outcomes == [{queued: "cancelled"}]
    rows = job_rows(backend.sessions, setup["job_ids"])
    assert rows[running].status == EvalJobStatus.SUCCEEDED
    assert rows[queued].status == EvalJobStatus.CANCELLED
    status = experiment_status_of(backend.sessions, setup["experiment_id"])
    assert status == "PARTIAL"


# --------------------------------------------------------------------------- load


@pytest.mark.parametrize("faulty", [False, True], ids=["clean", "faults"])
@pytest.mark.slow
@pytest.mark.skipif(not os.environ.get("QYM_TEST_SLOW"), reason="QYM_TEST_SLOW not set")
def test_64_job_sweep_across_two_environments(backend, clock, faulty):
    """The issue's load test: 2 environments × 32 combos, cap 4 each, all pods."""
    faults = Faults(latency=(0.0, 0.005))
    if faulty:
        faults = Faults(
            timeout_after_accept=0.08,
            submit_5xx=0.08,
            high=0.08,
            crash_before_post=0.03,
            crash_after_accept=0.03,
            list_5xx=0.05,
            latency=(0.0, 0.005),
        )
    setup, service = _sweep(backend, clock, jobs_per_env=32, cap=4, faults=faults)
    workers = 16 if backend.name == "postgres" else 8
    result = _run(backend, clock, setup, service, workers=workers, batch=4)

    _assert_safe(setup, service, result)
    assert len(service.stats.created) == 64
    assert set(service.stats.created.values()) == {1}
    assert set(result.db_max_inflight.values()) == {4}
    assert max(service.stats.max_occupied.values()) <= 4
    assert result.final_status == {"SUCCEEDED": 64}
    assert experiment_status_of(backend.sessions, setup["experiment_id"]) == (
        "COMPLETED"
    )
