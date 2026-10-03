"""Queue cancel service and experiment aggregate status (plan §4.5, §13.1, issue #19).

Cancel tests reuse the dispatcher's fakes (``test_eval_dispatcher``): an in-memory
Evaluation Service, here with ``POST /evals/{id}/cancel``, and a fake clock that the
cancel service shares with the dispatcher.
"""

from __future__ import annotations

import sys
import threading
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.auth import Principal
from qym_platform.db.models import (
    AuditLog,
    EvalExperiment,
    EvalExperimentJob,
    EvalExperimentStatus,
    EvalJobStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
)
from qym_platform.services import eval_dispatcher, eval_experiments
from qym_platform.services.eval_dispatcher import RETRY_BACKOFF_MAX
from qym_platform.services.eval_experiments import aggregate_status, cancel_jobs
from qym_platform.services.eval_service_client import (
    NotCancellable,
    RemoteNotFound,
    RetryableError,
)
from test_eval_dispatcher import (  # noqa: F401  (clock, sessions, _env: fixtures)
    FakeService,
    _dispatcher,
    _env,
    _experiment_status,
    _job,
    _link_run,
    _seed,
    _update_job,
    clock,
    sessions,
)

# --------------------------------------------------------------------------- aggregate

Q, BL = "QUEUED", "BLOCKED"
SG, SD, RU, CG = "SUBMITTING", "SUBMITTED", "RUNNING", "CANCELLING"
OK, FA, CA, TO = "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"


@pytest.mark.parametrize(
    "statuses, expected",
    [
        # Nothing has moved yet.
        ([], "QUEUED"),
        ([Q], "QUEUED"),
        ([Q, Q, Q], "QUEUED"),
        # Anything in flight.
        ([SG], "RUNNING"),
        ([SD, Q], "RUNNING"),
        ([RU, OK], "RUNNING"),
        ([CG], "RUNNING"),
        ([CG, CA], "RUNNING"),
        ([SG, BL], "RUNNING"),
        # Queued jobs next to jobs that have moved on.
        ([Q, OK], "RUNNING"),
        ([Q, CA], "RUNNING"),
        ([Q, BL], "RUNNING"),
        ([Q, FA], "RUNNING"),
        # Settled: terminal or BLOCKED.
        ([OK], "COMPLETED"),
        ([OK, OK], "COMPLETED"),
        ([OK, FA], "PARTIAL"),
        ([OK, CA], "PARTIAL"),
        ([OK, TO], "PARTIAL"),
        ([OK, BL], "PARTIAL"),
        ([CA], "CANCELLED"),
        ([CA, CA], "CANCELLED"),
        ([CA, FA], "FAILED"),
        ([CA, BL], "FAILED"),
        ([FA], "FAILED"),
        ([TO], "FAILED"),
        ([BL], "FAILED"),
        ([BL, BL], "FAILED"),
    ],
)
def test_aggregate_status_table(statuses, expected):
    jobs = [EvalJobStatus(s) for s in statuses]
    assert aggregate_status(jobs) == EvalExperimentStatus(expected)
    assert aggregate_status(reversed(jobs)) == EvalExperimentStatus(expected)


def test_dispatcher_uses_the_shared_aggregate_status():
    assert eval_dispatcher.aggregate_status is aggregate_status
    assert not hasattr(eval_dispatcher, "_counted_jobs")


# --------------------------------------------------------------------------- fakes


class CancelService(FakeService):
    """``FakeService`` plus ``POST /evals/{id}/cancel`` and a submit hook."""

    def __init__(self, clock):
        super().__init__(clock)
        self.cancel_calls = []
        self.cancel_errors = []  # raised in order, one per call
        self.on_submit = None

    async def submit(self, body):
        if self.on_submit is not None:
            self.on_submit(body)
        return await super().submit(body)

    async def cancel(self, job_id, user_id):
        with self.lock:
            self.cancel_calls.append((job_id, user_id))
            if self.cancel_errors:
                raise self.cancel_errors.pop(0)
            if job_id not in self.jobs:
                raise RemoteNotFound("eval job not found", status_code=404)
            job = self.jobs[job_id]
            if job["status"] not in ("PENDING", "RUNNING"):
                raise NotCancellable(
                    f"cannot cancel job in status {job['status']}",
                    status=job["status"],
                )
            job.update(status="CANCELLED", cancelled_by_user_id=user_id)
            return dict(job)


@pytest.fixture()
def service(clock):
    return CancelService(clock)


@pytest.fixture(autouse=True)
def _same_clock(monkeypatch, clock):
    # cancel_job stamps times and checks leases on the dispatcher's (fake) clock.
    monkeypatch.setattr(eval_experiments, "utc_now_naive", clock)


# --------------------------------------------------------------------------- helpers


def _principal(db, user_id):
    return Principal(user=db.get(User, user_id), auth_type="proxy_headers")


def _cancel(sessions, job_ids, user_id, reason=None, project_id=None):
    with sessions() as db:
        outcomes = cancel_jobs(
            db, job_ids, _principal(db, user_id), reason, project_id=project_id
        )
        db.commit()
        return outcomes


def _add_user(sessions, project_id=None, role=None):
    with sessions() as db:
        user = User(email=f"{uuid4().hex[:8]}@example.com")
        db.add(user)
        db.flush()
        if project_id and role:
            db.add(ProjectMembership(project_id=project_id, user_id=user.id, role=role))
        db.commit()
        return user.id


def _add_experiment(sessions, seed, user_id, project_id=None):
    """Another experiment with one QUEUED job; returns the job id."""
    with sessions() as db:
        experiment = EvalExperiment(
            project_id=project_id or seed["project_id"],
            created_by_user_id=user_id,
            name="other",
            environment_ids=[seed["env_id"]],
            job_count=1,
        )
        db.add(experiment)
        db.flush()
        job = EvalExperimentJob(
            experiment_id=experiment.id,
            environment_id=seed["env_id"],
            combo_index=0,
            schema_id=seed["schema_id"],
            params={},
            request_body={},
            status=EvalJobStatus.QUEUED,
        )
        db.add(job)
        db.commit()
        return job.id


def _audits(sessions):
    with sessions() as db:
        return {
            a.entity_id: a.after
            for a in db.query(AuditLog).filter(AuditLog.action == "eval_job.cancel")
        }


def _submitted(sessions, service, clock, jobs=1):
    """Seed and submit every job; returns (seed, dispatcher, {job_id: remote_id})."""
    seed = _seed(sessions, jobs=jobs)
    d = _dispatcher(sessions, service, clock)
    assert d.tick() == jobs
    remote = {j: _job(sessions, j).remote_job_id for j in seed["job_ids"]}
    assert all(remote.values())
    return seed, d, remote


# --------------------------------------------------------------------------- cancel


def test_bulk_cancel_mixed_statuses(sessions, service, clock):
    seed = _seed(sessions, jobs=6)
    q, blocked, leased, submitted, running, done = seed["job_ids"]
    S = EvalJobStatus
    _update_job(sessions, blocked, status=S.BLOCKED)
    _update_job(
        sessions,
        leased,
        lease_owner="worker-1",
        lease_until=clock() + timedelta(minutes=1),
    )
    _update_job(sessions, submitted, status=S.SUBMITTED, remote_job_id="r-1")
    _update_job(sessions, running, status=S.RUNNING, remote_job_id="r-2")
    _update_job(sessions, done, status=S.SUCCEEDED)
    member = _add_user(sessions, seed["project_id"], ProjectRole.MEMBER)
    members_job = _add_experiment(sessions, seed, member)
    with sessions() as db:
        elsewhere = Project(
            name="Q", slug="q-" + uuid4().hex[:6], created_by_user_id=member
        )
        db.add(elsewhere)
        db.commit()
        elsewhere_id = elsewhere.id
    foreign_job = _add_experiment(
        sessions, seed, seed["user_id"], project_id=elsewhere_id
    )

    outcomes = _cancel(
        sessions,
        [*seed["job_ids"], members_job, foreign_job, "missing", q],
        seed["user_id"],
        reason="bulk",
        project_id=seed["project_id"],
    )

    assert outcomes == {
        q: "cancelled",
        blocked: "cancelled",
        leased: "cancelling",  # the dispatcher is submitting it
        submitted: "cancelling",
        running: "cancelling",
        done: "already_terminal",
        members_job: "forbidden",  # another member's experiment
        foreign_job: "not_found",  # another project
        "missing": "not_found",
    }
    jobs = {j: _job(sessions, j) for j in outcomes if j != "missing"}
    assert jobs[q].status == S.CANCELLED and jobs[q].finished_at == clock()
    assert jobs[blocked].status == S.CANCELLED
    assert jobs[leased].status == S.QUEUED and jobs[leased].cancel_requested_at
    for job_id in (submitted, running):
        job = jobs[job_id]
        assert job.status == S.CANCELLING
        assert job.next_attempt_at == clock()  # due on the next tick
        assert job.wait_reason == "Cancelling"
        assert job.cancel_reason == "bulk"
        assert job.cancelled_by_user_id == seed["user_id"]
    for job_id in (done, members_job, foreign_job):
        assert jobs[job_id].cancel_requested_at is None
    assert jobs[members_job].status == S.QUEUED
    # One audit entry per cancelled/cancelling job, none for the others.
    audits = _audits(sessions)
    assert set(audits) == {q, blocked, leased, submitted, running}
    assert audits[submitted]["outcome"] == "cancelling"
    assert audits[q] == {
        "outcome": "cancelled",
        "reason": "bulk",
        "experiment_id": seed["experiment_id"],
        "status": "CANCELLED",
    }
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.RUNNING
    )

    # A project manager may cancel anyone's job.
    manager = _add_user(sessions, seed["project_id"], ProjectRole.MANAGER)
    assert _cancel(sessions, [members_job], manager) == {members_job: "cancelled"}
    assert _job(sessions, members_job).cancelled_by_user_id == manager


@pytest.mark.parametrize("rejected", [False, True])
def test_cancel_racing_submit(sessions, service, clock, rejected):
    """A cancel landing while ``POST /evals`` is in flight wins after the answer."""
    seed = _seed(sessions)
    (job_id,) = seed["job_ids"]
    outcomes = []

    def cancel_during_submit(body):
        assert _job(sessions, job_id).status == EvalJobStatus.SUBMITTING
        outcomes.append(_cancel(sessions, [job_id], seed["user_id"]))

    service.on_submit = cancel_during_submit
    service.reject = rejected
    d = _dispatcher(sessions, service, clock)
    assert d.tick() == 1
    assert outcomes == [{job_id: "cancelling"}]
    job = _job(sessions, job_id)
    if rejected:
        # 422: the service created nothing, so the cancel completes locally.
        assert job.status == EvalJobStatus.CANCELLED
        assert service.cancel_calls == []
    else:
        # 202: cancel remotely on the next tick (due now).
        assert job.status == EvalJobStatus.CANCELLING
        assert job.remote_job_id and job.lease_owner is None
        assert d.tick() == 1
        job = _job(sessions, job_id)
        assert job.status == EvalJobStatus.CANCELLED
        assert service.cancel_calls == [(job.remote_job_id, seed["user_id"])]
        assert service.jobs[job.remote_job_id]["status"] == "CANCELLED"
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.CANCELLED
    )
    assert d.tick() == 0


def _cancel_in_thread(sessions, job_id, user_id, outcomes, errors, wait):
    """``_cancel`` on its own connection and thread, as a concurrent API request.

    Joins for at most ``wait`` seconds and returns the thread: on Postgres a cancel
    of a job whose row the dispatcher holds ``FOR UPDATE`` waits for that commit.
    """

    def run():
        try:
            outcomes.append(_cancel(sessions, [job_id], user_id))
        except Exception as exc:  # noqa: BLE001 - surfaced by the caller's assertion
            errors.append(repr(exc))

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout=wait)
    return thread


def test_cancel_between_claim_and_lock_never_submits(sessions, service, clock):
    """The cancel lands after the claim (lease held, job still QUEUED) and before
    the dispatcher locks the row to submit: the job is cancelled, never submitted."""
    seed = _seed(sessions)
    (job_id,) = seed["job_ids"]
    outcomes, errors = [], []
    d = _dispatcher(sessions, service, clock)
    step_queued = d._step_queued

    def cancel_then_step(claimed_id):
        assert _job(sessions, claimed_id).lease_owner == d.owner
        thread = _cancel_in_thread(
            sessions, job_id, seed["user_id"], outcomes, errors, wait=30
        )
        assert not thread.is_alive()  # no row lock is held here
        step_queued(claimed_id)

    d._step_queued = cancel_then_step
    assert d.tick() == 1
    assert errors == []
    assert outcomes == [{job_id: "cancelling"}]  # the lease was held
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED and job.lease_owner is None
    assert service.calls["submit"] == 0


def test_cancel_racing_the_submit_commit_still_cancels(
    sessions, service, clock, monkeypatch
):
    """The dispatcher's submit completes (SUBMITTING -> SUBMITTED) between the
    cancel's "remote" and "submitting" steps: the request must not be lost."""
    seed = _seed(sessions)
    (job_id,) = seed["job_ids"]
    _update_job(
        sessions,
        job_id,
        status=EvalJobStatus.SUBMITTING,
        lease_owner="worker-1",
        lease_until=clock() + timedelta(minutes=1),
    )
    real_update = eval_experiments._guarded_update
    calls = []

    def guarded_update(db, job_id_, conditions, values):
        calls.append(values.get("status"))
        if len(calls) == 3:  # step 3, "being submitted": the submit lands first
            real_update(
                db,
                job_id_,
                [],
                {"status": EvalJobStatus.SUBMITTED, "lease_owner": None},
            )
        return real_update(db, job_id_, conditions, values)

    monkeypatch.setattr(eval_experiments, "_guarded_update", guarded_update)
    assert _cancel(sessions, [job_id], seed["user_id"]) == {job_id: "cancelling"}
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLING
    assert job.cancel_requested_at is not None and job.next_attempt_at is not None


def test_cancel_while_the_dispatcher_holds_the_job_row(sessions, service, clock):
    """The cancel arrives, from another connection, while the dispatcher is inside
    its submit transaction (job read, SUBMITTING marker not yet written).

    SQLite has no row lock: the cancel commits first and the marker's
    ``cancel_requested_at IS NULL`` guard stops the submit. On Postgres the cancel
    waits for the dispatcher's ``FOR UPDATE`` row lock, so it is ordered after the
    marker: the job is submitted once and cancelled remotely on the next tick.
    Either way it ends ``CANCELLED`` with nothing left running on the service.
    """
    seed = _seed(sessions)
    (job_id,) = seed["job_ids"]
    outcomes, errors, threads, waiting = [], [], [], []

    def cancel_then_add_token(body, _job_id):
        thread = _cancel_in_thread(
            sessions, job_id, seed["user_id"], outcomes, errors, wait=0.5
        )
        threads.append(thread)
        waiting.append(thread.is_alive())  # still blocked on the row lock?
        return body

    d = _dispatcher(sessions, service, clock, add_launch_token=cancel_then_add_token)
    assert d.tick() == 1
    (thread,) = threads
    thread.join(timeout=30)
    assert not thread.is_alive()
    assert errors == []
    assert outcomes == [{job_id: "cancelling"}]
    postgres = sessions.kw["bind"].dialect.name == "postgresql"
    assert waiting == [postgres]
    if not postgres:
        job = _job(sessions, job_id)
        assert job.status == EvalJobStatus.CANCELLED and job.lease_owner is None
        assert service.calls["submit"] == 0
        return
    assert service.calls["submit"] == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLING
    assert job.cancel_requested_at is not None
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED
    assert service.jobs[job.remote_job_id]["status"] == "CANCELLED"
    assert service.calls["submit"] == 1


def test_cancelling_retries_transport_errors(sessions, service, clock):
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    service.set_status(remote[job_id], "RUNNING")
    assert _cancel(sessions, [job_id], seed["user_id"]) == {job_id: "cancelling"}
    service.cancel_errors = [
        RetryableError("Evaluation service request timed out"),
        RetryableError("Evaluation service returned 503"),
    ]

    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLING
    assert job.next_attempt_at > clock()
    assert "retrying" in job.wait_reason
    assert d.tick() == 0  # backing off

    clock.advance(RETRY_BACKOFF_MAX)
    assert d.tick() == 1
    assert _job(sessions, job_id).status == EvalJobStatus.CANCELLING
    clock.advance(RETRY_BACKOFF_MAX)
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED
    assert len(service.cancel_calls) == 3
    assert service.jobs[remote[job_id]]["status"] == "CANCELLED"


def test_cancelling_gives_up_after_the_hard_limit(sessions, service, clock):
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    _cancel(sessions, [job_id], seed["user_id"])
    service.cancel_errors = [RetryableError("down"), RetryableError("down")]
    assert d.tick() == 1
    clock.advance(3 * 3600)
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED
    assert "gave up" in job.error


def test_cancel_conflict_repolls_the_real_final_status(sessions, service, clock):
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    _cancel(sessions, [job_id], seed["user_id"])
    # It finished remotely before the cancel reached the service.
    service.set_status(remote[job_id], "SUCCEEDED", result={"agent_version": "a1"})
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.RUNNING and job.next_attempt_at == clock()
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.SUCCEEDED
    assert job.remote_versioning == {"agent_version": "a1"}
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.COMPLETED
    )


def test_cancel_remote_not_found_cancels_with_a_note(sessions, service, clock):
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    _cancel(sessions, [job_id], seed["user_id"])
    del service.jobs[remote[job_id]]
    assert d.tick() == 1
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED
    assert job.error == "The evaluation service no longer knows this job"


def test_cancel_marks_linked_run_stopped_unless_it_ended(sessions, service, clock):
    seed, d, remote = _submitted(sessions, service, clock, jobs=3)
    live, finished, lease_timed_out = seed["job_ids"]
    for job_id in seed["job_ids"]:
        service.set_status(remote[job_id], "RUNNING")
    runs = {
        live: _link_run(
            sessions, seed, live, status=RunWorkflowStatus.RUNNING, started_at=clock()
        ),
        finished: _link_run(
            sessions,
            seed,
            finished,
            status=RunWorkflowStatus.COMPLETED,
            ended_at=clock(),
        ),
        lease_timed_out: _link_run(
            sessions,
            seed,
            lease_timed_out,
            status=RunWorkflowStatus.STOPPED,
            status_reason="lease_timeout",
        ),
    }
    outcomes = _cancel(sessions, seed["job_ids"], seed["user_id"])
    assert set(outcomes.values()) == {"cancelling"}
    # The API answers before the remote cancel: runs are untouched so far.
    with sessions() as db:
        assert db.get(Run, runs[live]).status == RunWorkflowStatus.RUNNING

    clock.advance(1)
    assert d.tick() == 3
    with sessions() as db:
        got = {job_id: db.get(Run, run_id) for job_id, run_id in runs.items()}
        for job_id in (live, lease_timed_out):
            assert got[job_id].status == RunWorkflowStatus.STOPPED
            assert got[job_id].status_reason == "cancelled_from_queue"
            assert got[job_id].ended_at == clock()
        assert got[finished].status == RunWorkflowStatus.COMPLETED
        assert got[finished].status_reason is None
    for job_id in seed["job_ids"]:
        job = _job(sessions, job_id)
        assert job.status == EvalJobStatus.CANCELLED
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.CANCELLED
    )
    # Terminal jobs are never claimed again, so nothing reopens the runs.
    clock.advance(3600)
    assert d.tick() == 0


def test_cancel_request_lost_to_a_concurrent_write_is_recovered(
    sessions, service, clock
):
    """A poll that overwrote CANCELLING (no row locks on SQLite) re-cancels."""
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    _cancel(sessions, [job_id], seed["user_id"])
    _update_job(
        sessions, job_id, status=EvalJobStatus.SUBMITTED, next_attempt_at=clock()
    )
    assert d.tick() == 1  # poll: back to CANCELLING, due now
    assert _job(sessions, job_id).status == EvalJobStatus.CANCELLING
    assert d.tick() == 1
    assert _job(sessions, job_id).status == EvalJobStatus.CANCELLED


# --------------------------------------------------------------------------- queue API
# Issue #21 (plan §14.1): GET /eval-queue, GET /eval-queue/remote,
# POST /eval-queue/cancel and POST /eval-queue/remote/cancel.


@pytest.fixture()
def api(sessions, service, monkeypatch):
    from fastapi.testclient import TestClient
    from qym_platform.api import eval_queue as eval_queue_api
    from qym_platform.api.eval_environments import get_eval_client_factory
    from qym_platform.app import create_app
    from qym_platform.deps import get_db

    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    refreshes = []
    monkeypatch.setattr(
        eval_queue_api,
        "refresh_snapshot_on_view",
        lambda factory, env_id, **kwargs: refreshes.append(env_id),
    )
    app = create_app()

    def override_get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_eval_client_factory] = lambda: service.factory
    with TestClient(app) as client:
        client.refreshes = refreshes
        yield client
    app.dependency_overrides.clear()


def _as(sessions, user_id):
    with sessions() as db:
        email = db.get(User, user_id).email
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def _queue_url(seed, suffix=""):
    return f"/v1/projects/{seed['project_id']}/eval-queue{suffix}"


def _join(sessions, seed, role=ProjectRole.MEMBER, user_id=None):
    """Add ``user_id`` (default: a new user) to the seed project."""
    if user_id is None:
        return _add_user(sessions, seed["project_id"], role)
    with sessions() as db:
        existing = (
            db.query(ProjectMembership)
            .filter_by(project_id=seed["project_id"], user_id=user_id)
            .one_or_none()
        )
        if existing is not None:  # the seed's creator is already a member
            existing.role = role
        else:
            db.add(
                ProjectMembership(
                    project_id=seed["project_id"], user_id=user_id, role=role
                )
            )
        db.commit()
    return user_id


def _queue_seed(sessions, clock):
    """Five jobs: one done, two QUEUED (one backing off), one RUNNING, one BLOCKED."""
    from qym_platform.db.models import RunItem

    seed = _seed(sessions, jobs=5)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    S = EvalJobStatus
    _join(sessions, seed, user_id=seed["user_id"])
    _update_job(sessions, done, status=S.SUCCEEDED)
    _update_job(
        sessions,
        backoff,
        next_attempt_at=clock() + timedelta(seconds=60),
        wait_reason="HIGH job r-9 active",
    )
    _update_job(
        sessions,
        running,
        status=S.RUNNING,
        remote_job_id="r-ours",
        next_attempt_at=clock() + timedelta(seconds=10),
    )
    _update_job(sessions, blocked, status=S.BLOCKED, wait_reason="model missing")
    run_id = _link_run(
        sessions,
        seed,
        running,
        status=RunWorkflowStatus.RUNNING,
        run_metadata={"total_items": 5},
    )
    with sessions() as db:
        for index in range(2):
            db.add(RunItem(run_id=run_id, item_id=f"i{index}", index=index, input={}))
        db.commit()
    return seed, run_id


def test_queue_lists_jobs_in_dispatch_order_with_wait_reason(
    api, sessions, service, clock
):
    seed, run_id = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    creator = _as(sessions, seed["user_id"])

    resp = api.get(_queue_url(seed), headers=creator)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # COALESCE(next_attempt_at, created_at), created_at, combo_index; no terminal jobs.
    assert [j["id"] for j in body["jobs"]] == [fresh, blocked, running, backoff]
    assert body["total"] == 4
    jobs = {j["id"]: j for j in body["jobs"]}
    assert jobs[backoff]["wait_reason"] == "HIGH job r-9 active"
    assert jobs[blocked]["wait_reason"] == "model missing"
    assert jobs[fresh]["wait_reason"] is None
    assert jobs[fresh]["queue_position"] == 1
    assert jobs[backoff]["queue_position"] == 2
    assert jobs[running]["queue_position"] is None
    assert jobs[fresh]["priority"] == "NORMAL"
    assert jobs[fresh]["experiment_name"] == "exp"
    assert jobs[fresh]["environment_name"] == "staging"
    assert jobs[fresh]["can_cancel"] is True
    assert jobs[fresh]["run"] is None
    run = jobs[running]["run"]
    assert run["id"] == run_id and run["status"] == "RUNNING"
    assert (run["items_done"], run["items_total"]) == (2, 5)
    (env,) = body["environments"]
    assert env["id"] == seed["env_id"]
    assert (env["inflight"], env["queued"], env["blocked"]) == (1, 2, 1)
    assert "max_inflight_jobs" not in env and env["high_active"] is False

    # The dispatcher claims the claimable ones in exactly this order.
    clock.advance(120)
    claimed = _dispatcher(sessions, service, clock).claim()
    assert claimed == [fresh, running, backoff]


def test_queue_filters(api, sessions, service, clock):
    seed, _ = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    creator = _as(sessions, seed["user_id"])
    other = _join(sessions, seed)
    others_job = _add_experiment(sessions, seed, other)

    def ids(**params):
        resp = api.get(_queue_url(seed), headers=creator, params=params)
        assert resp.status_code == 200, resp.text
        return [j["id"] for j in resp.json()["jobs"]]

    assert others_job in ids()
    # created now (real clock), long after the seed jobs
    assert ids(status="QUEUED") == [fresh, backoff, others_job]
    assert ids(status=["BLOCKED", "RUNNING"]) == [blocked, running]
    assert ids(mine="true") == [fresh, blocked, running, backoff]
    assert ids(experiment_id=seed["experiment_id"]) == [
        fresh,
        blocked,
        running,
        backoff,
    ]
    assert ids(environment_id=seed["env_id"], limit=2) == [fresh, blocked]
    assert (
        api.get(_queue_url(seed), headers=creator, params={"status": "SUCCEEDED"})
    ).status_code == 422
    assert (
        api.get(_queue_url(seed), headers=creator, params={"experiment_id": "nope"})
    ).status_code == 404
    assert (
        api.get(_queue_url(seed), headers=creator, params={"environment_id": "nope"})
    ).status_code == 404


def test_queue_permissions(api, sessions, service, clock):
    seed, _ = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    member = _join(sessions, seed)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    outsider = _add_user(sessions)
    url = _queue_url(seed, "/cancel")

    # Members see the whole project queue, but can't cancel others' jobs.
    assert api.get(_queue_url(seed), headers=_as(sessions, outsider)).status_code == 403
    body = api.get(_queue_url(seed), headers=_as(sessions, member)).json()
    assert len(body["jobs"]) == 4 and not any(j["can_cancel"] for j in body["jobs"])
    managed = api.get(_queue_url(seed), headers=_as(sessions, manager)).json()
    assert all(j["can_cancel"] for j in managed["jobs"])
    assert (
        api.post(url, headers=_as(sessions, outsider), json={"job_ids": [fresh]})
    ).status_code == 403

    resp = api.post(
        url, headers=_as(sessions, member), json={"job_ids": [fresh, running]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "outcomes": {fresh: "forbidden", running: "forbidden"},
        "counts": {"forbidden": 2},
    }
    assert _job(sessions, fresh).status == EvalJobStatus.QUEUED

    # The creator cancels: queued → cancelled locally, running → cancelling.
    resp = api.post(
        url,
        headers=_as(sessions, seed["user_id"]),
        json={"job_ids": [fresh, running, done, "missing"], "reason": "wrong data"},
    )
    assert resp.json()["outcomes"] == {
        fresh: "cancelled",
        running: "cancelling",
        done: "already_terminal",
        "missing": "not_found",
    }
    assert _job(sessions, fresh).cancel_reason == "wrong data"
    assert set(_audits(sessions)) == {fresh, running}

    # A manager cancels anyone's jobs; the experiment form takes QUEUED by default.
    members_job = _add_experiment(sessions, seed, member)
    resp = api.post(
        url,
        headers=_as(sessions, manager),
        json={"experiment_id": seed["experiment_id"]},
    )
    assert resp.json() == {
        "outcomes": {backoff: "cancelled"},
        "counts": {"cancelled": 1},
    }
    assert _job(sessions, blocked).status == EvalJobStatus.BLOCKED
    resp = api.post(
        url,
        headers=_as(sessions, manager),
        json={"experiment_id": seed["experiment_id"], "statuses": ["BLOCKED"]},
    )
    assert resp.json()["outcomes"] == {blocked: "cancelled"}
    assert (
        api.post(url, headers=_as(sessions, manager), json={"job_ids": [members_job]})
    ).json()["outcomes"] == {members_job: "cancelled"}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"job_ids": []},
        {"job_ids": ["a"] * 201},
        {"job_ids": ["a"], "experiment_id": "x"},
        {"job_ids": ["a"], "statuses": ["QUEUED"]},
        {"experiment_id": "x", "statuses": ["SUCCEEDED"]},
        {"job_ids": ["a"], "reason": "r" * 1001},
    ],
)
def test_queue_cancel_validation(api, sessions, service, clock, body):
    seed = _seed(sessions)
    _join(sessions, seed, user_id=seed["user_id"])
    resp = api.post(
        _queue_url(seed, "/cancel"), headers=_as(sessions, seed["user_id"]), json=body
    )
    assert resp.status_code == 422


def _foreign_project(sessions, seed):
    """Another project with its own environment; returns (project_id, env_id)."""
    from qym_platform.db.models import EvalEnvironment

    with sessions() as db:
        project = Project(
            name="Q", slug="q-" + uuid4().hex[:6], created_by_user_id=seed["user_id"]
        )
        db.add(project)
        db.flush()
        env = EvalEnvironment(
            project_id=project.id,
            name="other",
            base_url="https://other-" + uuid4().hex[:6] + ".example",
        )
        db.add(env)
        db.commit()
        return project.id, env.id


def test_queue_cancel_experiment_of_another_project(api, sessions, service, clock):
    seed = _seed(sessions)
    _join(sessions, seed, user_id=seed["user_id"])
    elsewhere, _ = _foreign_project(sessions, seed)
    foreign_job = _add_experiment(sessions, seed, seed["user_id"], project_id=elsewhere)
    with sessions() as db:
        foreign_experiment = db.get(EvalExperimentJob, foreign_job).experiment_id
    resp = api.post(
        _queue_url(seed, "/cancel"),
        headers=_as(sessions, seed["user_id"]),
        json={"experiment_id": foreign_experiment},
    )
    assert resp.status_code == 404
    assert _job(sessions, foreign_job).status == EvalJobStatus.QUEUED


def _store_snapshot(sessions, env_id, items, *, age=timedelta(0)):
    from qym_platform.datetime_utils import utc_now_naive
    from qym_platform.db.models import EvalRemoteQueueSnapshot

    with sessions() as db:
        db.add(
            EvalRemoteQueueSnapshot(
                environment_id=env_id,
                fetched_at=utc_now_naive() - age,
                items=items,
            )
        )
        db.commit()


def _remote_item(rid, status="RUNNING", priority="NORMAL", user_id="u-1"):
    return {
        "remote_job_id": rid,
        "status": status,
        "priority": priority,
        "user_id": user_id,
        "created_at": "2020-01-01T11:00:00+00:00",
        "run_name": "run " + rid,
    }


def test_remote_queue_matches_own_jobs_and_flags_orphans(api, sessions, service, clock):
    seed, _ = _queue_seed(sessions, clock)
    running = seed["job_ids"][3]
    member = _join(sessions, seed)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    _store_snapshot(
        sessions,
        seed["env_id"],
        [_remote_item("r-ours"), _remote_item("r-orphan", "PENDING", "HIGH")],
    )

    resp = api.get(_queue_url(seed, "/remote"), headers=_as(sessions, member))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["can_cancel_orphans"] is False
    (env,) = body["environments"]
    assert env["environment_id"] == seed["env_id"]
    assert env["fetch_error"] is None and env["stale"] is False
    assert env["fetched_at"]
    assert env["orphan_count"] == 1
    ours, orphan = env["items"]
    assert ours["orphan"] is False
    assert ours["match"] == {
        "job_id": running,
        "experiment_id": seed["experiment_id"],
        "experiment_name": "exp",
        "status": "RUNNING",
    }
    assert orphan["orphan"] is True and orphan["match"] is None
    assert orphan["priority"] == "HIGH" and orphan["run_name"] == "run r-orphan"
    assert set(orphan) == {
        "remote_job_id",
        "status",
        "priority",
        "user_id",
        "created_at",
        "run_name",
        "orphan",
        "stale",
        "match",
    }
    assert ours["stale"] is False and orphan["stale"] is False
    assert env["stale_count"] == 0
    # A fresh snapshot is not refreshed; a remote HIGH job shows in the header.
    assert api.refreshes == []
    queue = api.get(_queue_url(seed), headers=_as(sessions, member)).json()
    assert queue["environments"][0]["high_active"] is True
    managed = api.get(_queue_url(seed, "/remote"), headers=_as(sessions, manager))
    assert managed.json()["can_cancel_orphans"] is True


def test_remote_queue_schedules_a_refresh_when_stale(api, sessions, service, clock):
    seed = _seed(sessions)
    _join(sessions, seed, user_id=seed["user_id"])
    headers = _as(sessions, seed["user_id"])
    # Never fetched: served empty, refresh scheduled.
    body = api.get(_queue_url(seed, "/remote"), headers=headers).json()
    (env,) = body["environments"]
    assert env["items"] == [] and env["fetched_at"] is None and env["stale"] is True
    assert api.refreshes == [seed["env_id"]]
    _store_snapshot(sessions, seed["env_id"], [], age=timedelta(minutes=5))
    api.get(
        _queue_url(seed, "/remote"),
        headers=headers,
        params={"environment_id": seed["env_id"]},
    )
    assert api.refreshes == [seed["env_id"]] * 2


def test_remote_orphan_cancel_is_manager_only(api, sessions, service, clock):
    seed, _ = _queue_seed(sessions, clock)
    member = _join(sessions, seed)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    for rid, status in (("r-orphan", "RUNNING"), ("r-done", "SUCCEEDED")):
        service.jobs[rid] = {"id": rid, "status": status, "user_id": "u-1"}
    service.jobs["r-ours"] = {"id": "r-ours", "status": "RUNNING"}
    _store_snapshot(
        sessions,
        seed["env_id"],
        [
            _remote_item("r-ours"),
            _remote_item("r-orphan"),
            _remote_item("r-done"),
            _remote_item("r-gone"),
        ],
    )
    url = _queue_url(seed, "/remote/cancel")
    body = {
        "environment_id": seed["env_id"],
        "remote_job_ids": ["r-orphan", "r-ours", "r-done", "r-gone", "r-unseen"],
        "reason": "stray",
    }

    for user in (member, seed["user_id"]):  # the job creator is not enough either
        resp = api.post(url, headers=_as(sessions, user), json=body)
        assert resp.status_code == 403
    assert service.cancel_calls == []

    resp = api.post(url, headers=_as(sessions, manager), json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "environment_id": seed["env_id"],
        "outcomes": {
            "r-orphan": "cancelled",
            "r-ours": "refused_local_job",
            "r-done": "already_terminal",
            "r-gone": "not_found",
            "r-unseen": "not_in_snapshot",
        },
        "errors": {},
        "counts": {
            "cancelled": 1,
            "refused_local_job": 1,
            "already_terminal": 1,
            "not_found": 1,
            "not_in_snapshot": 1,
        },
    }
    # Only orphans reached the service; our job stays untouched.
    assert [c[0] for c in service.cancel_calls] == ["r-orphan", "r-done", "r-gone"]
    assert all(c[1] == manager for c in service.cancel_calls)
    assert service.jobs["r-orphan"]["status"] == "CANCELLED"
    assert service.jobs["r-ours"]["status"] == "RUNNING"
    assert _job(sessions, seed["job_ids"][3]).status == EvalJobStatus.RUNNING
    with sessions() as db:
        audits = {
            a.entity_id: a
            for a in db.query(AuditLog).filter(
                AuditLog.action == "eval_remote_job.cancel"
            )
        }
    assert set(audits) == {"r-orphan", "r-done", "r-gone"}
    assert audits["r-orphan"].actor_user_id == manager
    assert audits["r-orphan"].after == {
        "outcome": "cancelled",
        "environment_id": seed["env_id"],
        "project_id": seed["project_id"],
        "reason": "stray",
        "orphan": True,
    }
    # Settled orphans leave the snapshot at once; a refresh is scheduled.
    remote = api.get(_queue_url(seed, "/remote"), headers=_as(sessions, manager))
    items = remote.json()["environments"][0]["items"]
    assert [i["remote_job_id"] for i in items] == ["r-ours"]
    assert seed["env_id"] in api.refreshes


def test_remote_orphan_cancel_errors_are_redacted(api, sessions, service, clock):
    from qym_platform.services.eval_service_client import EnvAuthError

    seed = _seed(sessions)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    _store_snapshot(
        sessions, seed["env_id"], [_remote_item("r-1"), _remote_item("r-2")]
    )
    service.cancel_errors = [EnvAuthError("rejected", status_code=401)]
    resp = api.post(
        _queue_url(seed, "/remote/cancel"),
        headers=_as(sessions, manager),
        json={"environment_id": seed["env_id"], "remote_job_ids": ["r-1", "r-2"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["outcomes"] == {"r-1": "error", "r-2": "error"}
    # After a 401 nothing more is sent; the env key never appears.
    assert len(service.cancel_calls) == 1
    assert "env-service-key" not in resp.text
    _, foreign_env = _foreign_project(sessions, seed)
    resp = api.post(
        _queue_url(seed, "/remote/cancel"),
        headers=_as(sessions, manager),
        json={"environment_id": foreign_env, "remote_job_ids": ["r-1"]},
    )
    assert resp.status_code == 404


# --------------------------------------------------------------------------- stale
# Remote jobs qym can no longer stop: the local job is terminal (TIMED_OUT, or
# CANCELLED by the CANCELLING give-up) but the service still runs it.


def _poll_until_settled(d, sessions, clock, job_id):
    while True:
        job = _job(sessions, job_id)
        clock.advance(max(0.0, (job.next_attempt_at - clock()).total_seconds()))
        assert d.tick() >= 1
        job = _job(sessions, job_id)
        if job.status != EvalJobStatus.RUNNING:
            return job


def test_timeout_cancels_the_remote_job_first(sessions, service, clock):
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    rid = remote[job_id]
    service.set_status(rid, "RUNNING")
    started = clock()

    job = _poll_until_settled(d, sessions, clock, job_id)

    assert job.status == EvalJobStatus.TIMED_OUT
    assert clock() - started >= timedelta(hours=2, minutes=15)
    assert service.cancel_calls == [(rid, seed["user_id"])]
    assert service.jobs[rid]["status"] == "CANCELLED"
    assert job.remote_status == "CANCELLED"
    assert "2h15m" in job.error
    assert "Remote job cancelled on the evaluation service" in job.error
    assert job.lease_owner is None and job.next_attempt_at is None
    assert (
        _experiment_status(sessions, seed["experiment_id"])
        == EvalExperimentStatus.FAILED
    )


@pytest.mark.parametrize(
    "error, expected",
    [
        (
            RetryableError("Evaluation service returned 503: Bearer tok-SECRET-123"),
            "could not be reached",
        ),
        (NotCancellable("already done", status="SUCCEEDED"), "already finished"),
        (RemoteNotFound("gone", status_code=404), "unknown to the evaluation service"),
    ],
)
def test_timeout_still_times_out_when_the_remote_cancel_fails(
    sessions, service, clock, caplog, error, expected
):
    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    rid = remote[job_id]
    service.set_status(rid, "RUNNING")
    service.cancel_errors = [error]

    with caplog.at_level("INFO", logger="qym_platform.services.eval_dispatcher"):
        job = _poll_until_settled(d, sessions, clock, job_id)

    assert job.status == EvalJobStatus.TIMED_OUT
    assert len(service.cancel_calls) == 1
    assert "2h15m" in job.error and expected in job.error
    assert job.remote_status == "RUNNING"
    assert "tok-SECRET-123" not in job.error
    assert "tok-SECRET-123" not in caplog.text
    if isinstance(error, RetryableError):
        assert "remote cancel after timeout failed" in caplog.text
    # Terminal: never claimed or cancelled again.
    clock.advance(3600)
    assert d.tick() == 0
    assert len(service.cancel_calls) == 1


def test_timeout_with_a_rejected_key_pauses_the_environment(sessions, service, clock):
    from qym_platform.db.models import EvalEnvironment
    from qym_platform.services.eval_service_client import EnvAuthError

    seed, d, remote = _submitted(sessions, service, clock)
    (job_id,) = seed["job_ids"]
    service.set_status(remote[job_id], "RUNNING")
    service.cancel_errors = [EnvAuthError("rejected", status_code=401)]
    job = _poll_until_settled(d, sessions, clock, job_id)
    assert job.status == EvalJobStatus.TIMED_OUT
    assert "API key was rejected" in job.error
    with sessions() as db:
        assert db.get(EvalEnvironment, seed["env_id"]).health_status == "error"


def test_stale_remote_jobs_do_not_hold_back_submissions(sessions, service, clock):
    """No platform cap: stale remote jobs are reported, never waited on."""
    from qym_platform.services.eval_dispatcher import stale_remote_job_ids

    seed = _seed(sessions, jobs=3)
    stale, first, second = seed["job_ids"]
    _update_job(
        sessions, stale, status=EvalJobStatus.TIMED_OUT, remote_job_id="r-stale"
    )
    _store_snapshot(
        sessions,
        seed["env_id"],
        [
            _remote_item("r-stale"),  # ours, finished locally: stale
            _remote_item("r-orphan"),  # not ours: an orphan, not stale (D8)
        ],
    )
    with sessions() as db:
        assert stale_remote_job_ids(db, seed["env_id"]) == {"r-stale"}
    d = _dispatcher(sessions, service, clock)
    d.tick()
    assert _job(sessions, first).status == EvalJobStatus.SUBMITTED
    assert _job(sessions, second).status == EvalJobStatus.SUBMITTED
    assert service.calls["submit"] == 2


def test_only_active_remote_jobs_of_terminal_local_jobs_are_stale(
    sessions, service, clock
):
    from qym_platform.services.eval_dispatcher import stale_remote_job_ids

    seed = _seed(sessions, jobs=3)
    cancelled, succeeded, running = seed["job_ids"]
    S = EvalJobStatus
    _update_job(sessions, cancelled, status=S.CANCELLED, remote_job_id="r-1")
    _update_job(sessions, succeeded, status=S.SUCCEEDED, remote_job_id="r-2")
    _update_job(sessions, running, status=S.RUNNING, remote_job_id="r-3")
    _store_snapshot(
        sessions,
        seed["env_id"],
        [
            _remote_item("r-1", "PENDING"),
            _remote_item("r-2", "SUCCEEDED"),  # not active remotely
            _remote_item("r-3"),  # tracked locally: our own in-flight job
        ],
    )
    with sessions() as db:
        assert stale_remote_job_ids(db, seed["env_id"]) == {"r-1"}


def _stale_seed(sessions, clock):
    """The queue seed plus a TIMED_OUT job still RUNNING on the service."""
    seed, _ = _queue_seed(sessions, clock)
    done = seed["job_ids"][0]
    _update_job(
        sessions,
        done,
        status=EvalJobStatus.TIMED_OUT,
        remote_job_id="r-stale",
        remote_status="RUNNING",
    )
    _store_snapshot(
        sessions,
        seed["env_id"],
        [_remote_item("r-ours"), _remote_item("r-stale"), _remote_item("r-orphan")],
    )
    return seed, done


def test_remote_queue_flags_stale_jobs(api, sessions, service, clock):
    seed, done = _stale_seed(sessions, clock)
    member = _join(sessions, seed)
    body = api.get(_queue_url(seed, "/remote"), headers=_as(sessions, member)).json()
    (env,) = body["environments"]
    items = {i["remote_job_id"]: i for i in env["items"]}
    assert items["r-stale"]["stale"] is True
    assert items["r-stale"]["orphan"] is False
    assert items["r-stale"]["match"] == {
        "job_id": done,
        "experiment_id": seed["experiment_id"],
        "experiment_name": "exp",
        "status": "TIMED_OUT",
    }
    assert items["r-ours"]["stale"] is False and items["r-ours"]["orphan"] is False
    assert items["r-orphan"]["stale"] is False and items["r-orphan"]["orphan"] is True
    assert env["stale_count"] == 1 and env["orphan_count"] == 1
    # The queue header reports it next to our own RUNNING job.
    queue = api.get(_queue_url(seed), headers=_as(sessions, member)).json()
    assert queue["environments"][0]["stale_remote"] == 1
    assert queue["environments"][0]["inflight"] == 1


def test_manager_cancels_a_stale_remote_job_with_audit(api, sessions, service, clock):
    seed, done = _stale_seed(sessions, clock)
    member = _join(sessions, seed)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    for rid in ("r-ours", "r-stale"):
        service.jobs[rid] = {"id": rid, "status": "RUNNING", "user_id": "u-1"}
    url = _queue_url(seed, "/remote/cancel")
    body = {
        "environment_id": seed["env_id"],
        "remote_job_ids": ["r-stale", "r-ours"],
        "reason": "timed out",
    }

    # Members, including the experiment's creator, are refused.
    for user in (member, seed["user_id"]):
        assert api.post(url, headers=_as(sessions, user), json=body).status_code == 403
    assert service.cancel_calls == []

    resp = api.post(url, headers=_as(sessions, manager), json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json()["outcomes"] == {
        "r-stale": "cancelled",
        # A non-terminal local job still goes through the queue cancel.
        "r-ours": "refused_local_job",
    }
    assert service.cancel_calls == [("r-stale", manager)]
    assert service.jobs["r-stale"]["status"] == "CANCELLED"
    assert service.jobs["r-ours"]["status"] == "RUNNING"
    job = _job(sessions, done)
    assert job.status == EvalJobStatus.TIMED_OUT
    assert job.remote_status == "CANCELLED"
    assert _job(sessions, seed["job_ids"][3]).status == EvalJobStatus.RUNNING
    with sessions() as db:
        audits = {
            a.entity_id: a
            for a in db.query(AuditLog).filter(
                AuditLog.action == "eval_remote_job.cancel"
            )
        }
    assert set(audits) == {"r-stale"}
    assert audits["r-stale"].actor_user_id == manager
    assert audits["r-stale"].after == {
        "outcome": "cancelled",
        "environment_id": seed["env_id"],
        "project_id": seed["project_id"],
        "reason": "timed out",
        "orphan": False,
        "stale": True,
        "job_id": done,
        "job_status": "TIMED_OUT",
    }
    # It leaves the snapshot at once.
    remote = api.get(_queue_url(seed, "/remote"), headers=_as(sessions, manager))
    ids = [i["remote_job_id"] for i in remote.json()["environments"][0]["items"]]
    assert "r-stale" not in ids


def test_non_terminal_local_match_is_still_refused(api, sessions, service, clock):
    seed, _ = _queue_seed(sessions, clock)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    _, backoff, fresh, _, blocked = seed["job_ids"]
    S = EvalJobStatus
    for job_id, status, rid in (
        (backoff, S.CANCELLING, "r-cancelling"),
        (fresh, S.SUBMITTED, "r-submitted"),
        (blocked, S.BLOCKED, "r-blocked"),
    ):
        _update_job(sessions, job_id, status=status, remote_job_id=rid)
    rids = ["r-ours", "r-cancelling", "r-submitted", "r-blocked"]
    _store_snapshot(sessions, seed["env_id"], [_remote_item(r) for r in rids])
    resp = api.post(
        _queue_url(seed, "/remote/cancel"),
        headers=_as(sessions, manager),
        json={"environment_id": seed["env_id"], "remote_job_ids": rids},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["outcomes"] == {rid: "refused_local_job" for rid in rids}
    assert service.cancel_calls == []
    body = api.get(_queue_url(seed, "/remote"), headers=_as(sessions, manager)).json()
    assert body["environments"][0]["stale_count"] == 0
