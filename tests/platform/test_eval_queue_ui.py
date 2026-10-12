"""Queue page API round trips (plan 12.2a, 12.3, 13.1, 14.1; issue 25).

The endpoints the queue page and the experiment detail queue strip call: the
P2 exit (a QUEUED and a RUNNING job cancelled from the queue page), cancel-all in
an experiment and role gating of the remote view. The UI is covered by
frontend/e2e/experiments/queue.spec.ts."""

from __future__ import annotations


from qym_platform.db.models import EvalJobStatus, ProjectRole

# Reuse the queue API fixtures (sessions, fake clock, fake service, TestClient).
from test_eval_queue import (  # noqa: F401  (pytest fixtures)
    _add_experiment,
    _add_user,
    _as,
    _env,
    _job,
    _join,
    _queue_seed,
    _queue_url,
    _remote_item,
    _same_clock,
    _store_snapshot,
    _submitted,
    api,
    clock,
    service,
    sessions,
)

# --------------------------------------------------------------------------- data


def test_queue_strip_payload_for_an_experiment(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    body = api.get(
        _queue_url(seed),
        headers=_as(sessions, seed["user_id"]),
        params={"experiment_id": seed["experiment_id"], "limit": 1000},
    ).json()
    by_status = {}
    for job in body["jobs"]:
        by_status.setdefault(job["status"], []).append(job)
        for key in ("environment_id", "environment_name", "queue_position", "status"):
            assert key in job, key
    assert sorted(j["queue_position"] for j in by_status["QUEUED"]) == [1, 2]
    assert [j["id"] for j in by_status["RUNNING"]] == [running]


def test_p2_exit_cancel_a_queued_and_a_running_job_from_the_queue_page(
    api, sessions, service, clock
):
    """The page's calls: GET the queue, POST /cancel for the selection, poll again."""
    seed, dispatcher, remote = _submitted(sessions, service, clock)
    (running,) = seed["job_ids"]
    _join(sessions, seed, user_id=seed["user_id"])
    creator = _as(sessions, seed["user_id"])

    # The submitted job starts running on the service; a second job waits here.
    service.set_status(remote[running], "RUNNING")
    job = _job(sessions, running)
    clock.advance(max(0.0, (job.next_attempt_at - clock()).total_seconds()))
    dispatcher.tick()
    assert _job(sessions, running).status == EvalJobStatus.RUNNING
    queued = _add_experiment(sessions, seed, seed["user_id"])

    listed = api.get(_queue_url(seed), headers=creator)
    assert listed.status_code == 200, listed.text
    jobs = {j["id"]: j for j in listed.json()["jobs"]}
    assert jobs[queued]["status"] == "QUEUED" and jobs[queued]["can_cancel"]
    assert jobs[running]["status"] == "RUNNING" and jobs[running]["can_cancel"]

    # Bulk cancel of both selected rows, with the optional reason.
    res = api.post(
        _queue_url(seed, "/cancel"),
        headers=creator,
        json={"job_ids": [queued, running], "reason": "P2 exit"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {
        "outcomes": {queued: "cancelled", running: "cancelling"},
        "counts": {"cancelled": 1, "cancelling": 1},
    }
    assert _job(sessions, queued).status == EvalJobStatus.CANCELLED
    assert _job(sessions, queued).cancel_reason == "P2 exit"
    assert service.cancel_calls == []  # the queued job never reached the service

    # The next poll shows the running job stopping; the dispatcher hard-stops it.
    polled = api.get(_queue_url(seed), headers=creator).json()
    assert [(j["id"], j["status"]) for j in polled["jobs"]] == [(running, "CANCELLING")]
    dispatcher.tick()
    assert [c[0] for c in service.cancel_calls] == [remote[running]]
    assert service.jobs[remote[running]]["status"] == "CANCELLED"
    stopped = _job(sessions, running)
    assert stopped.status == EvalJobStatus.CANCELLED
    assert stopped.cancel_reason == "P2 exit"
    assert api.get(_queue_url(seed), headers=creator).json()["jobs"] == []


def test_cancel_all_queued_in_experiment_as_the_page_sends_it(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    res = api.post(
        _queue_url(seed, "/cancel"),
        headers=_as(sessions, seed["user_id"]),
        json={
            "experiment_id": seed["experiment_id"],
            "statuses": ["QUEUED", "BLOCKED"],
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["outcomes"] == {
        fresh: "cancelled",
        blocked: "cancelled",
        backoff: "cancelled",
    }
    assert _job(sessions, running).status == EvalJobStatus.RUNNING


def test_remote_view_gates_orphan_cancel_by_role(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    _store_snapshot(
        sessions, seed["env_id"], [_remote_item("r-ours"), _remote_item("r-orphan")]
    )
    member_view = api.get(
        _queue_url(seed, "/remote"), headers=_as(sessions, seed["user_id"])
    ).json()
    assert member_view["can_cancel_orphans"] is False
    items = {i["remote_job_id"]: i for i in member_view["environments"][0]["items"]}
    assert items["r-orphan"]["orphan"] is True and items["r-ours"]["orphan"] is False
    manager_view = api.get(
        _queue_url(seed, "/remote"), headers=_as(sessions, manager)
    ).json()
    assert manager_view["can_cancel_orphans"] is True
