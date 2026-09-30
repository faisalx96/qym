"""Queue cancel service and experiment aggregate status (plan §4.5, §13.1, issue #19).

Cancel tests reuse the dispatcher's fakes (``test_eval_dispatcher``): an in-memory
Evaluation Service, here with ``POST /evals/{id}/cancel``, and a fake clock that the
cancel service shares with the dispatcher.
"""

from __future__ import annotations

import sys
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


def test_cancel_between_claim_and_submit_never_submits(sessions, service, clock):
    seed = _seed(sessions)
    (job_id,) = seed["job_ids"]
    outcomes = []

    def cancel_then_add_token(body, _job_id):
        # The dispatcher holds the lease and the job is still QUEUED.
        outcomes.append(_cancel(sessions, [job_id], seed["user_id"]))
        return body

    d = _dispatcher(sessions, service, clock, add_launch_token=cancel_then_add_token)
    assert d.tick() == 1
    assert outcomes == [{job_id: "cancelling"}]
    job = _job(sessions, job_id)
    assert job.status == EvalJobStatus.CANCELLED and job.lease_owner is None
    assert service.calls["submit"] == 0


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
