"""A run's life: claimed once, the state rules, silence, stop, and late results."""

from __future__ import annotations

import threading
from datetime import timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    INSTANCE,
    NOW,
    TOKENS,
    at_time,
    get_run,
    log_line,
    make_run,
    press_stop,
    progress_numbers,
    progress_report,
    question_record,
    runner_headers,
    runner_path,
    seed_performance,
    stamp,
    summary_body,
    supply_token,
    use_encryption_key,
)
from qym_platform.db.models import (
    PERFORMANCE_STATUS_REASONS,
    PerformanceEvent,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceReport,
    PerformanceRun,
    User,
)
from qym_platform.services import (
    performance_ingest,
    performance_runs,
    performance_state,
)
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.settings import PlatformSettings

PROJECT = "performance-project-1"
BASE = runner_path(PROJECT)
REPORT = b"<!doctype html><title>QA - report</title><p>Level 10 passed.</p>"
UNCLAIMED = dict(
    claimed_at=None,
    claim_instance_id=None,
    last_seen_at=None,
    started_at=None,
    last_report_at=None,
    progress_seq=0,
)


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    at_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_performance(db)
        db.commit()
    return factory


def _refused(response, status: int, code: str, detail: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert (body["error"]["code"], body["detail"]) == (code, detail)


def _run_path(run_id: str) -> str:
    return f"{BASE}/runs/{run_id}"


def _claim(client, run_id, instance=INSTANCE):
    return client.post(
        _run_path(run_id) + "/claim", headers=runner_headers(instance=instance), json={}
    )


def _progress(
    client, run_id, seq, status="running", progress=None, instance=INSTANCE, **extra
):
    return client.post(
        _run_path(run_id) + "/progress",
        headers=runner_headers(instance=instance),
        json=progress_report(seq, status, progress, **extra),
    )


def _heartbeat(client, state="running", run_id=None):
    return client.post(
        BASE + "/heartbeat",
        headers=runner_headers(),
        json={"at": stamp(NOW), "state": state, "run_id": run_id},
    )


def _events(factory, run_id) -> list[tuple[str, str]]:
    with factory() as db:
        rows = db.scalars(
            select(PerformanceEvent)
            .where(PerformanceEvent.run_id == run_id)
            .order_by(PerformanceEvent.id)
        )
        return [(row.code, row.source) for row in rows]


def _send_results(client, run_id, instance=INSTANCE):
    """The four results a runner sends after the test ended."""
    headers = runner_headers(instance=instance)
    path = _run_path(run_id)
    return [
        client.post(
            path + "/questions", headers=headers, json={"records": [question_record(1)]}
        ),
        client.post(path + "/log", headers=headers, json={"lines": [log_line(1)]}),
        client.put(path + "/summary", headers=headers, json=summary_body()),
        client.put(
            path + "/report",
            headers={**headers, "Content-Type": "text/html"},
            content=REPORT,
        ),
    ]


# --------------------------------------------------------------------------- claim


def test_a_queued_run_is_claimed_once(client, session_factory, monkeypatch):
    run_id = make_run(session_factory)
    at_time(monkeypatch, NOW + timedelta(seconds=3))
    response = _claim(client, run_id)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": run_id,
        "status": "starting",
        "claimed_at": "2026-11-20T11:00:03Z",
    }
    run = get_run(session_factory, run_id)
    assert (run.status, run.claim_instance_id) == ("starting", INSTANCE)
    # The claim is the first sign of life.
    assert run.claimed_at == run.last_seen_at == NOW + timedelta(seconds=3)
    assert _events(session_factory, run_id) == [("claimed", "qym")]

    # The answer was lost: the same instance asks again and gets the first claim back.
    at_time(monkeypatch, NOW + timedelta(seconds=9))
    again = _claim(client, run_id)
    assert again.status_code == 200 and again.json() == response.json()
    assert get_run(session_factory, run_id).last_seen_at == NOW + timedelta(seconds=3)
    assert _events(session_factory, run_id) == [("claimed", "qym")]


def test_only_the_registered_instance_can_claim(client, session_factory):
    run_id = make_run(session_factory)
    stranger = _claim(client, run_id, instance="instance-2")
    _refused(
        stranger,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    assert get_run(session_factory, run_id).status == "queued"
    unknown = _claim(client, "no-such-run")
    _refused(unknown, 404, "run_not_found", "performance run not found")
    other_runner = client.post(
        f"{runner_path(PROJECT, 'runner-9')}/runs/{run_id}/claim",
        headers=runner_headers(),
        json={},
    )
    _refused(other_runner, 404, "run_not_found", "performance run not found")
    not_empty = client.post(
        _run_path(run_id) + "/claim",
        headers=runner_headers(),
        json={"instance_id": INSTANCE},
    )
    assert not_empty.status_code == 422


@pytest.mark.parametrize(
    "status", ["finished", "stopped", "failed", "interrupted", "expired"]
)
def test_a_run_that_ended_is_never_claimed_again(client, session_factory, status):
    """Also the instance that had claimed it is refused: nothing resumes."""
    run_id = make_run(session_factory, status=status)
    _refused(
        _claim(client, run_id),
        409,
        "run_not_queued",
        "run is not waiting to be claimed",
    )
    assert get_run(session_factory, run_id).status == status


def test_a_run_stopped_before_its_claim_is_not_given_out(client, session_factory):
    run_id = make_run(session_factory)
    with session_factory() as db:
        press_stop(db, db.get(PerformanceRun, run_id))
        db.commit()
    assert get_run(session_factory, run_id).status == "stopped"
    _refused(
        _claim(client, run_id),
        409,
        "run_not_queued",
        "run is not waiting to be claimed",
    )


def test_a_run_nobody_claimed_in_time_expires(client, session_factory, monkeypatch):
    run_id = make_run(session_factory)
    at_time(monkeypatch, NOW + timedelta(seconds=600))
    _refused(
        _claim(client, run_id),
        409,
        "run_not_queued",
        "run is not waiting to be claimed",
    )
    run = get_run(session_factory, run_id)
    assert run.status == "expired"
    assert run.finished_at == NOW + timedelta(seconds=600)
    assert run.error == "No runner picked the run up in time"
    assert run.status_reason == "not_claimed"
    assert run.claim_instance_id is None
    assert _events(session_factory, run_id) == [("expired", "qym")]


def test_of_two_claims_at_the_same_moment_exactly_one_wins(session_factory):
    """Both readers saw ``queued``; the conditional write lets one through."""
    run_id = make_run(session_factory)
    with session_factory() as first, session_factory() as second:
        seen_by_first = first.get(PerformanceRun, run_id)
        seen_by_second = second.get(PerformanceRun, run_id)
        assert seen_by_first.status == seen_by_second.status == "queued"
        performance_ingest.claim_run(
            first, seen_by_first, instance="instance-a", now=NOW
        )
        first.commit()
        with pytest.raises(PerformanceError) as refused:
            performance_ingest.claim_run(
                second, seen_by_second, instance="instance-b", now=NOW
            )
        assert (refused.value.code, refused.value.status) == ("run_not_queued", 409)
    assert get_run(session_factory, run_id).claim_instance_id == "instance-a"
    assert _events(session_factory, run_id) == [("claimed", "qym")]


def test_two_runner_processes_claiming_at_once_on_postgresql(database, session_factory):
    """Real connections racing for the row lock: one claim wins, the other is refused."""
    if database.dialect.name != "postgresql":
        pytest.skip(
            "needs row locks; the conditional write is covered above for SQLite"
        )
    run_id = make_run(session_factory)
    start = threading.Barrier(4)
    outcomes: list[str] = []

    def claim(instance: str) -> None:
        with session_factory() as db:
            start.wait(timeout=30)
            try:
                _runner, run = performance_ingest.find_run(
                    db, PROJECT, "runner-1", run_id, lock=True
                )
                performance_ingest.claim_run(db, run, instance=instance, now=NOW)
                db.commit()
                outcomes.append(instance)
            except PerformanceError as refused:
                db.rollback()
                outcomes.append(refused.code)

    threads = [
        threading.Thread(target=claim, args=(f"instance-{n}",)) for n in range(4)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    winners = [outcome for outcome in outcomes if outcome.startswith("instance-")]
    assert len(winners) == 1 and outcomes.count("run_not_queued") == 3, outcomes
    run = get_run(session_factory, run_id)
    assert (run.status, run.claim_instance_id) == ("starting", winners[0])
    assert _events(session_factory, run_id) == [("claimed", "qym")]


# --------------------------------------------------------------------------- state rules

ALLOWED = [
    ("starting", "starting"),
    ("starting", "running"),
    ("starting", "stopping"),
    ("starting", "stopped"),
    ("starting", "failed"),
    ("starting", "interrupted"),
    ("running", "running"),
    ("running", "stopping"),
    ("running", "finished"),
    ("running", "stopped"),
    ("running", "failed"),
    ("running", "interrupted"),
    ("stopping", "stopping"),
    ("stopping", "finished"),
    ("stopping", "stopped"),
    ("stopping", "failed"),
    ("stopping", "interrupted"),
]
REFUSED = [
    # A run cannot finish without having run.
    ("starting", "finished"),
    ("running", "starting"),
    # The runner said it is stopping: going back is an invalid step like any other.
    ("stopping", "running"),
    ("stopping", "starting"),
]


def _report_in(client, session_factory, stored: str, reported: str):
    run_id = make_run(session_factory, status=stored, stop_requested_at=None)
    extra = (
        {"error": "QA - reason in words"}
        if reported in ("failed", "interrupted")
        else {}
    )
    return run_id, _progress(client, run_id, 5, reported, **extra)


@pytest.mark.parametrize("stored,reported", ALLOWED)
def test_a_status_the_rules_allow_is_stored(client, session_factory, stored, reported):
    run_id, response = _report_in(client, session_factory, stored, reported)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == reported and response.json()["accepted"] is True
    run = get_run(session_factory, run_id)
    assert run.status == reported
    final = reported in performance_state.TERMINAL_STATUSES
    assert (run.finished_at == NOW) is final


@pytest.mark.parametrize("stored,reported", REFUSED)
def test_a_status_the_rules_forbid_is_refused(
    client, session_factory, stored, reported
):
    run_id, response = _report_in(client, session_factory, stored, reported)
    _refused(
        response, 409, "invalid_transition", "status cannot follow the current status"
    )
    run = get_run(session_factory, run_id)
    assert (run.status, run.progress_seq) == (stored, 0 if stored == "starting" else 1)


def test_the_first_running_report_starts_the_clock_and_a_final_one_closes_the_run(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory)
    assert _claim(client, run_id).status_code == 200
    assert get_run(session_factory, run_id).progress == {}

    preflight = _progress(
        client, run_id, 1, "starting", {"phase": "preflight", "step": "dataset"}
    )
    assert preflight.json() == {
        "id": run_id,
        "status": "starting",
        "accepted": True,
        "stop_requested": False,
        "stop_reason": None,
        "token_needed": None,
        "token_versions": {"refresh_token": 1, "access_token": 1},
    }
    assert get_run(session_factory, run_id).started_at is None

    started = at_time(monkeypatch, NOW + timedelta(seconds=20))
    assert (
        _progress(client, run_id, 2, "running", progress_numbers()).json()["status"]
        == "running"
    )
    at_time(monkeypatch, NOW + timedelta(seconds=25))
    _progress(client, run_id, 3, "running", progress_numbers())
    run = get_run(session_factory, run_id)
    assert run.started_at == started  # set once
    assert run.last_report_at == run.last_seen_at == NOW + timedelta(seconds=25)
    assert run.progress["levels"][1]["answers"] == 8

    ended = at_time(monkeypatch, NOW + timedelta(seconds=140))
    final = _progress(client, run_id, 4, "finished", progress_numbers(), exit_code=99)
    assert final.status_code == 200 and final.json()["status"] == "finished"
    run = get_run(session_factory, run_id)
    assert (run.status, run.finished_at, run.exit_code) == ("finished", ended, 99)

    # After a final status every progress report is refused, whatever it says.
    for status in ("running", "finished", "stopped"):
        late = _progress(client, run_id, 9, status)
        _refused(late, 409, "run_finished", "run already finished")
        assert late.json()["error"]["details"] == {"status": "finished"}
    assert get_run(session_factory, run_id).progress_seq == 4


def test_progress_needs_a_claim_and_the_claiming_instance(client, session_factory):
    queued = make_run(session_factory)
    _refused(
        _progress(client, queued, 1), 409, "run_not_claimed", "run has not been claimed"
    )
    with session_factory() as db:
        db.get(PerformanceRun, queued).status = "stopped"
        db.commit()
    running = make_run(session_factory, status="running")
    stranger = _progress(client, running, 2, instance="instance-2")
    _refused(
        stranger,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    _refused(
        _progress(client, "no-such-run", 1),
        404,
        "run_not_found",
        "performance run not found",
    )
    assert get_run(session_factory, running).progress_seq == 1


def test_a_report_that_is_not_newer_is_ignored_but_still_a_sign_of_life(
    client, session_factory, monkeypatch
):
    run_id = make_run(
        session_factory, status="running", progress_seq=7, progress=progress_numbers()
    )
    later = at_time(monkeypatch, NOW + timedelta(seconds=40))
    response = _progress(client, run_id, 7, "stopping", {"phase": "stopping"})
    assert response.status_code == 200, response.text
    assert (
        response.json()["accepted"] is False and response.json()["status"] == "running"
    )
    run = get_run(session_factory, run_id)
    assert (run.status, run.progress_seq, run.progress["phase"]) == (
        "running",
        7,
        "hold",
    )
    assert run.last_seen_at == later and run.last_report_at == NOW


def test_counters_never_go_down_and_levels_never_disappear(client, session_factory):
    run_id = make_run(session_factory, status="running", progress=progress_numbers())
    fewer = progress_numbers()
    fewer["answers"]["finished"] = 35
    kinds = progress_numbers()
    kinds["errors_by_kind"]["server"] = 0
    lost = progress_numbers(levels=progress_numbers()["levels"][:1])
    shrunk = progress_numbers()
    shrunk["levels"][0]["answers"] = 19
    for seq, progress in enumerate((fewer, kinds, lost, shrunk), start=2):
        response = _progress(client, run_id, seq, "running", progress)
        _refused(
            response, 422, "counters_must_not_decrease", "counters must not decrease"
        )
    assert get_run(session_factory, run_id).progress_seq == 1

    # An empty object carries no numbers and never wipes the last ones.
    assert _progress(client, run_id, 6, "running", {}).status_code == 200
    run = get_run(session_factory, run_id)
    assert run.progress_seq == 6 and run.progress["answers"]["finished"] == 36
    more = progress_numbers()
    more["answers"]["finished"] = 37
    assert _progress(client, run_id, 7, "running", more).status_code == 200
    assert get_run(session_factory, run_id).progress["answers"]["finished"] == 37


def test_progress_bodies_are_checked(client, session_factory, monkeypatch):
    run_id = make_run(session_factory, status="running")
    for body in (
        progress_report(0),
        progress_report(2, "done"),
        {"seq": 2, "status": "running", "at": stamp(NOW)},
        progress_report(2, "failed"),
        progress_report(2, "interrupted", error="  "),
        progress_report(2, progress={"answers": {"finished": -1}}),
        progress_report(2, progress={"levels": [{"state": "done"}]}),
        progress_report(2, progress={"waiting_for_token": "password"}),
        progress_report(2, instance_id=INSTANCE),
    ):
        response = client.post(
            _run_path(run_id) + "/progress", headers=runner_headers(), json=body
        )
        assert response.status_code == 422, (body, response.text)
        assert isinstance(response.json()["detail"], list)
    not_finite = client.post(
        _run_path(run_id) + "/progress",
        headers={**runner_headers(), "Content-Type": "application/json"},
        content=b'{"seq": 2, "status": "running", "at": "2026-11-20T11:00:00Z", "progress": {"p95_ms": Infinity}}',
    )
    assert not_finite.status_code == 422
    too_large = _progress(client, run_id, 2, "running", {"note": "x" * 65536})
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "payload_too_large"
    assert get_run(session_factory, run_id).progress_seq == 1


def test_the_reason_of_a_failure_is_kept_masked_and_cut(client, session_factory):
    run_id = make_run(session_factory, status="starting")
    secret = TOKENS["refresh_token"]
    words = f"The sign-in was refused for {secret}. " + "x" * 3000
    response = _progress(
        client, run_id, 1, "failed", {"phase": "preflight"}, error=words, exit_code=None
    )
    assert response.status_code == 200, response.text
    run = get_run(session_factory, run_id)
    assert run.status == "failed"
    assert run.error.startswith("The sign-in was refused for [REDACTED]. xxx")
    assert len(run.error) == 2000 and secret not in run.error


# --------------------------------------------------------------------------- stop


def test_a_stop_reaches_the_runner_and_the_result_of_a_cut_hold_is_kept(
    client, session_factory
):
    """Stop pressed during a hold: stopping, then stopped, with what was measured."""
    run_id = make_run(session_factory, status="running", progress=progress_numbers())
    with session_factory() as db:
        press_stop(db, db.get(PerformanceRun, run_id), reason="QA - target is needed")
        db.commit()

    # The runner has not heard yet and reports "running": refused, and that is the stop.
    unaware = _progress(client, run_id, 2, "running", progress_numbers())
    _refused(unaware, 409, "stop_requested", "stop requested")
    assert get_run(session_factory, run_id).progress_seq == 1
    # An overtaken report is ignored, and its answer carries the stop too.
    overtaken = _progress(client, run_id, 1, "running").json()
    assert (overtaken["accepted"], overtaken["stop_requested"]) == (False, True)
    assert overtaken["stop_reason"] == "QA - target is needed"

    stopping = _progress(
        client, run_id, 3, "stopping", progress_numbers(phase="stopping")
    )
    assert stopping.status_code == 200 and stopping.json()["status"] == "stopping"
    assert stopping.json()["stop_requested"] is True

    # The suite was interrupted and wrote its result: summary first, then the final status.
    summary = client.put(
        _run_path(run_id) + "/summary",
        headers=runner_headers(),
        json=summary_body(verdict="not_reached", ended_by="stop", exit_code=105),
    )
    assert summary.status_code == 200, summary.text
    stopped = _progress(
        client, run_id, 4, "stopped", progress_numbers(phase="finishing"), exit_code=105
    )
    assert stopped.status_code == 200 and stopped.json()["status"] == "stopped"

    run = get_run(session_factory, run_id)
    assert (run.status, run.exit_code, run.finished_at) == ("stopped", 105, NOW)
    assert run.stop_reason == "QA - target is needed"
    assert (run.verdict, run.safe_load_users) == ("not_reached", 10)
    # The level whose hold was cut short says how much of it ran.
    level = run.summary["levels"][1]
    assert {key: level[key] for key in ("level", "answers", "result", "hold_elapsed_pct")} == {
        "level": 20,
        "answers": 8,
        "result": "break",
        "hold_elapsed_pct": 53.3,
    }
    assert run.summary["ended_by"] == "stop"


def test_a_stop_during_pre_flight_is_not_overridden(client, session_factory):
    run_id = make_run(session_factory, status="starting")
    with session_factory() as db:
        press_stop(db, db.get(PerformanceRun, run_id))
        db.commit()
    for status in ("starting", "running"):
        _refused(
            _progress(client, run_id, 1, status),
            409,
            "stop_requested",
            "stop requested",
        )
    assert _progress(client, run_id, 2, "stopped").json()["status"] == "stopped"
    assert get_run(session_factory, run_id).started_at is None


# --------------------------------------------------------------------------- why it ended

REASONS = [
    # stored status, stop requested, reported status, the reason stored with it
    ("starting", False, "failed", "preflight_failed"),
    ("running", False, "failed", "k6_failed"),
    ("stopping", True, "failed", "k6_failed"),
    ("running", False, "interrupted", "runner_shutdown"),
    ("stopping", True, "stopped", "stopped_by_person"),
    # The runner stopped the suite by itself: no person, no reason code.
    ("stopping", False, "stopped", None),
    ("running", False, "finished", None),
    # The test reached its own end while a stop was on its way: it finished.
    ("stopping", True, "finished", None),
]


@pytest.mark.parametrize("stored,stop,reported,reason", REASONS)
def test_the_reason_a_run_ended_is_stored_with_its_final_status(
    client, session_factory, stored, stop, reported, reason
):
    changes = {} if stop else {"stop_requested_at": None}
    # A reason written earlier never outlives a final status that has none.
    run_id = make_run(
        session_factory, status=stored, status_reason="stopped_by_person", **changes
    )
    extra = {"error": "QA - reason in words"} if reported != "finished" else {}
    assert _progress(client, run_id, 5, reported, **extra).status_code == 200
    run = get_run(session_factory, run_id)
    assert (run.status, run.status_reason) == (reported, reason)
    assert reason is None or reason in PERFORMANCE_STATUS_REASONS


def test_a_failure_during_a_stopped_pre_flight_is_a_failed_pre_flight(
    client, session_factory
):
    run_id = make_run(session_factory, status="starting")
    with session_factory() as db:
        press_stop(db, db.get(PerformanceRun, run_id))
        db.commit()
    response = _progress(client, run_id, 1, "failed", error="QA - sign-in refused")
    assert response.status_code == 200, response.text
    assert get_run(session_factory, run_id).status_reason == "preflight_failed"


def test_finish_run_takes_the_reason_and_checks_it(session_factory):
    run_id = make_run(session_factory, status="running")
    with session_factory() as db:
        run = db.get(PerformanceRun, run_id)
        with pytest.raises(ValueError):
            performance_state.finish_run(
                run, status="interrupted", at=NOW, reason="because"
            )
        with pytest.raises(ValueError):
            performance_state.finish_run(run, status="running", at=NOW)
        assert run.status == "running"
        performance_state.finish_run(
            run, status="interrupted", at=NOW, reason="runner_restarted"
        )
        assert (run.status, run.status_reason) == ("interrupted", "runner_restarted")
        # Without a reason the stored one is kept.
        performance_state.finish_run(run, status="interrupted", at=NOW)
        assert run.status_reason == "runner_restarted"
        db.rollback()
    assert set(performance_state.SILENCE_REASONS.values()) <= set(
        PERFORMANCE_STATUS_REASONS
    )


# --------------------------------------------------------------------------- silence


def test_a_run_survives_119_seconds_of_silence_and_ends_at_120(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    at_time(monkeypatch, NOW + timedelta(seconds=119))
    assert _progress(client, run_id, 2).status_code == 200
    # A heartbeat alone keeps a run alive as well, when it names the run.
    at_time(monkeypatch, NOW + timedelta(seconds=238))
    assert _heartbeat(client, run_id=run_id).status_code == 204
    last_sign = NOW + timedelta(seconds=238)
    assert get_run(session_factory, run_id).last_seen_at == last_sign

    at_time(monkeypatch, last_sign + timedelta(seconds=120))
    lost = _progress(client, run_id, 3)
    _refused(lost, 409, "run_finished", "run already finished")
    assert lost.json()["error"]["details"] == {"status": "interrupted"}
    run = get_run(session_factory, run_id)
    assert run.status == "interrupted"
    # The run ended when the 120 seconds ran out.
    assert run.finished_at == last_sign + timedelta(seconds=120)
    assert run.error == "The runner stopped answering; the run was ended"
    assert run.status_reason == "runner_silent"
    assert run.progress_seq == 2
    assert _events(session_factory, run_id) == [("interrupted", "qym")]


def test_a_lost_run_is_not_revived_by_a_heartbeat_and_never_claimed_again(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    at_time(monkeypatch, NOW + timedelta(seconds=300))
    assert _heartbeat(client, run_id=run_id).status_code == 204
    run = get_run(session_factory, run_id)
    assert (run.status, run.finished_at) == (
        "interrupted",
        NOW + timedelta(seconds=120),
    )
    assert run.last_seen_at == NOW
    _refused(
        _claim(client, run_id),
        409,
        "run_not_queued",
        "run is not waiting to be claimed",
    )
    _refused(
        _progress(client, run_id, 2, "running"),
        409,
        "run_finished",
        "run already finished",
    )
    assert get_run(session_factory, run_id).status == "interrupted"
    assert _events(session_factory, run_id) == [("interrupted", "qym")]


def test_status_is_derived_on_read_without_a_write(session_factory):
    running = make_run(session_factory, status="running")
    with session_factory() as db:
        run = db.get(PerformanceRun, running)
        for seconds, expected in (
            (0, "running"),
            (119, "running"),
            (120, "interrupted"),
        ):
            now = NOW + timedelta(seconds=seconds)
            assert performance_state.effective_status(run, now=now) == expected
            # The shared entry point of the page routes answers the same.
            assert performance_runs.effective_status(run, now=now) == expected
        assert performance_state.is_runner_silent(run, now=NOW + timedelta(seconds=120))
        assert performance_state.effective_finished_at(
            run, now=NOW + timedelta(hours=1)
        ) == NOW + timedelta(seconds=120)
        assert run.status == "running" and not db.dirty
        run.status = "queued"
        assert (
            performance_state.effective_status(run, now=NOW + timedelta(seconds=599))
            == "queued"
        )
        assert (
            performance_state.effective_status(run, now=NOW + timedelta(seconds=600))
            == "expired"
        )
        for final in performance_state.TERMINAL_STATUSES:
            run.status = final
            assert (
                performance_state.effective_status(run, now=NOW + timedelta(days=9))
                == final
            )
        db.rollback()
    assert set(performance_state.ACTIVE_STATUSES) == {
        "queued",
        "starting",
        "running",
        "stopping",
    }
    assert set(performance_state.TERMINAL_STATUSES) == {
        "finished",
        "stopped",
        "failed",
        "interrupted",
        "expired",
    }
    assert PlatformSettings().performance_stale_after_seconds == 120
    assert PlatformSettings().performance_queue_timeout_seconds == 600
    assert PlatformSettings().performance_late_window_seconds == 600


def test_the_sweep_ends_silent_and_unclaimed_runs_once(session_factory):
    """One runner and one target carry one active run, so each case gets its own project."""
    with session_factory() as db:
        for suffix in ("2", "3", "4"):
            seed_performance(
                db,
                suffix=suffix,
                runner_token=f"t{suffix}-runner",
                other_token=f"t{suffix}-other",
            )
        db.commit()
    silent = make_run(session_factory, status="stopping")
    unclaimed = make_run(session_factory, project_id="performance-project-2")
    fresh = make_run(
        session_factory,
        project_id="performance-project-3",
        status="running",
        last_seen_at=NOW + timedelta(seconds=100),
    )
    done = make_run(
        session_factory, project_id="performance-project-4", status="finished"
    )

    with session_factory() as db:
        assert (
            performance_state.sweep_stale_runs(db, now=NOW + timedelta(seconds=119))
            == 0
        )
        assert (
            performance_state.sweep_stale_runs(db, now=NOW + timedelta(seconds=120))
            == 1
        )
        db.commit()
    with session_factory() as db:
        # Later the queued run has waited ten minutes; the silent one is not ended twice.
        assert (
            performance_state.sweep_stale_runs(db, now=NOW + timedelta(seconds=600))
            == 2
        )
        db.commit()
    with session_factory() as db:
        assert performance_state.sweep_stale_runs(db, now=NOW + timedelta(days=1)) == 0

    assert (
        get_run(session_factory, silent).status,
        get_run(session_factory, silent).finished_at,
    ) == (
        "interrupted",
        NOW + timedelta(seconds=120),
    )
    expired = get_run(session_factory, unclaimed)
    assert (expired.status, expired.finished_at) == (
        "expired",
        NOW + timedelta(seconds=600),
    )
    lost_later = get_run(session_factory, fresh)
    assert (lost_later.status, lost_later.finished_at) == (
        "interrupted",
        NOW + timedelta(seconds=220),
    )
    assert get_run(session_factory, done).finished_at == NOW
    assert _events(session_factory, silent) == [("interrupted", "qym")]
    assert _events(session_factory, unclaimed) == [("expired", "qym")]
    assert _events(session_factory, done) == []
    assert [
        get_run(session_factory, run_id).status_reason
        for run_id in (silent, unclaimed, fresh, done)
    ] == ["runner_silent", "not_claimed", "runner_silent", None]


def test_a_sign_of_life_that_arrives_first_wins_over_the_sweep(session_factory):
    """The sweep decided from an old row; the write is conditional on that row."""
    run_id = make_run(session_factory, status="running")
    with session_factory() as sweeper, session_factory() as route:
        stale_view = sweeper.get(PerformanceRun, run_id)
        assert stale_view.last_seen_at == NOW
        route.get(PerformanceRun, run_id).last_seen_at = NOW + timedelta(seconds=119)
        route.commit()
        assert not performance_state.end_if_stale(
            sweeper, stale_view, now=NOW + timedelta(seconds=121)
        )
        sweeper.commit()
    assert get_run(session_factory, run_id).status == "running"
    assert _events(session_factory, run_id) == []


# --------------------------------------------------------------------------- late results


def test_results_of_a_lost_run_are_kept_for_ten_minutes_and_do_not_revive_it(
    client, session_factory, monkeypatch
):
    """The runner lost the network mid-run, stopped the suite, and comes back."""
    run_id = make_run(session_factory, status="running")
    # Silent since 11:00:00: lost at 11:02:00, results are taken until 11:12:00.
    at_time(monkeypatch, NOW + timedelta(seconds=720))
    responses = _send_results(client, run_id)
    assert [response.status_code for response in responses] == [200, 200, 200, 204]
    assert responses[0].json()["accepted"] == 1 and responses[1].json()["accepted"] == 1

    run = get_run(session_factory, run_id)
    assert (run.status, run.finished_at) == (
        "interrupted",
        NOW + timedelta(seconds=120),
    )
    assert (run.verdict, run.questions_received, run.log_lines_received) == (
        "breakpoint_found",
        1,
        1,
    )
    assert run.report_received_at == NOW + timedelta(seconds=720)
    with session_factory() as db:
        assert db.scalars(select(PerformanceQuestion.seq)).all() == [1]
        assert db.scalars(select(PerformanceLogLine.seq)).all() == [1]
        assert db.get(PerformanceReport, run_id).html_size == len(REPORT)
    _refused(
        _progress(client, run_id, 2, "running"),
        409,
        "run_finished",
        "run already finished",
    )
    _refused(
        _claim(client, run_id),
        409,
        "run_not_queued",
        "run is not waiting to be claimed",
    )

    at_time(monkeypatch, NOW + timedelta(seconds=721))
    for response in _send_results(client, run_id):
        _refused(response, 409, "run_closed", "run no longer accepts results")
    assert get_run(session_factory, run_id).questions_received == 1


@pytest.mark.parametrize("status", ["finished", "stopped", "failed", "interrupted"])
def test_the_late_window_follows_every_final_status(
    client, session_factory, monkeypatch, status
):
    run_id = make_run(session_factory, status=status)
    at_time(monkeypatch, NOW + timedelta(seconds=600))
    assert [response.status_code for response in _send_results(client, run_id)] == [
        200,
        200,
        200,
        204,
    ]
    assert get_run(session_factory, run_id).status == status
    at_time(monkeypatch, NOW + timedelta(seconds=601))
    for response in _send_results(client, run_id):
        _refused(response, 409, "run_closed", "run no longer accepts results")


def test_results_are_taken_only_from_the_instance_that_claimed_the_run(
    client, session_factory
):
    run_id = make_run(session_factory, status="interrupted")
    for response in _send_results(client, run_id, instance="instance-2"):
        _refused(
            response,
            409,
            "instance_mismatch",
            "another runner process holds this runner or run",
        )
    queued = make_run(session_factory, status="stopped", **UNCLAIMED)
    for response in _send_results(client, queued):
        _refused(response, 409, "run_not_claimed", "run has not been claimed")
    for response in _send_results(client, "no-such-run"):
        _refused(response, 404, "run_not_found", "performance run not found")
    with session_factory() as db:
        assert db.scalars(select(PerformanceQuestion)).all() == []
        assert db.scalars(select(PerformanceReport)).all() == []


# --------------------------------------------------------------------------- token hand-off


def test_a_run_waits_for_a_new_token_and_carries_on(client, session_factory):
    """The sign-in runs out mid-run: a person is asked, saves a token, the run goes on."""
    run_id = make_run(session_factory, status="running", progress=progress_numbers())
    rejected = progress_numbers(waiting_for_token="refresh_token")
    rejected["auth"] = {
        "state": "rejected",
        "token_versions": {"refresh_token": 1, "access_token": 1},
    }
    asked = _progress(client, run_id, 2, "running", rejected).json()
    assert asked["token_needed"] == "refresh_token" and asked["status"] == "running"
    assert asked["token_versions"] == {"refresh_token": 1, "access_token": 1}
    assert get_run(session_factory, run_id).token_needed == "refresh_token"

    with session_factory() as db:
        supply_token(
            db,
            db.get(PerformanceRun, run_id),
            "refresh_token",
            "example-new-refresh-token-7a2e",
        )
        db.commit()
    # The runner still holds version 1 and says so: a newer token is on its way, nobody is asked.
    still_waiting = _progress(client, run_id, 3, "running", rejected).json()
    assert still_waiting["token_needed"] is None
    assert still_waiting["token_versions"]["refresh_token"] == 2
    assert get_run(session_factory, run_id).status == "running"

    recovered = progress_numbers(waiting_for_token=None)
    recovered["auth"] = {
        "state": "recovered",
        "token_versions": {"refresh_token": 2, "access_token": 1},
    }
    carried_on = _progress(client, run_id, 4, "running", recovered).json()
    assert carried_on["token_needed"] is None and carried_on["status"] == "running"

    # The new token is refused too: now the runner holds version 2, and a person is asked again.
    rejected["auth"]["token_versions"]["refresh_token"] = 2
    assert (
        _progress(client, run_id, 5, "running", rejected).json()["token_needed"]
        == "refresh_token"
    )
    # A run that ended asks nobody.
    assert (
        _progress(
            client, run_id, 6, "failed", rejected, error="QA - sign-in lost"
        ).status_code
        == 200
    )
    run = get_run(session_factory, run_id)
    assert (run.status, run.token_needed) == ("failed", None)
    assert "example-new-refresh-token-7a2e" not in str(run.progress)


# --------------------------------------------------------------------------- review fixes


def _person(db) -> User:
    return db.scalars(select(User).where(User.email.like("performance-user-%"))).first()


def _stop(factory, run_id, when) -> None:
    """A person presses Stop on the run page at ``when``."""
    with factory() as db:
        performance_runs.stop_run(
            db,
            run=db.get(PerformanceRun, run_id),
            user=_person(db),
            reason=None,
            now=when,
        )
        db.commit()


def test_idle_heartbeats_and_heartbeats_for_another_run_do_not_keep_a_run_alive(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory)
    assert _claim(client, run_id).status_code == 200
    # The final report is refused, so the runner forgets the run and goes back to idle.
    _refused(
        _progress(client, run_id, 1, "finished"),
        409,
        "invalid_transition",
        "status cannot follow the current status",
    )
    for seconds, state, named in (
        (40, "idle", None),
        (80, "running", "another-run-id"),
        (119, "idle", run_id),
    ):
        at_time(monkeypatch, NOW + timedelta(seconds=seconds))
        assert _heartbeat(client, state, named).status_code == 204
    assert get_run(session_factory, run_id).last_seen_at == NOW

    at_time(monkeypatch, NOW + timedelta(seconds=125))
    assert _heartbeat(client, "idle").status_code == 204
    run = get_run(session_factory, run_id)
    assert (run.status, run.status_reason, run.finished_at) == (
        "interrupted",
        "runner_silent",
        NOW + timedelta(seconds=120),
    )
    # The runner is free again: the next run is queued and claimed.
    assert _claim(client, make_run(session_factory)).status_code == 200


def test_a_heartbeat_keeps_a_run_alive_only_when_it_names_the_run_it_works_on(
    client, session_factory, monkeypatch
):
    from qym_platform.db.models import PerformanceRunner

    run_id = make_run(session_factory, status="running")
    for n, state in enumerate(("preflight", "running", "stopping", "finishing"), 1):
        at_time(monkeypatch, NOW + timedelta(seconds=100 * n))
        assert _heartbeat(client, state, run_id).status_code == 204
        assert get_run(session_factory, run_id).last_seen_at == NOW + timedelta(
            seconds=100 * n
        )
    with session_factory() as db:
        runner = db.scalars(select(PerformanceRunner)).one()
        assert (runner.reported_state, runner.current_run_id) == ("finishing", run_id)

    # A run id that is not a run of this runner is neither a sign of life nor kept.
    at_time(monkeypatch, NOW + timedelta(seconds=410))
    assert _heartbeat(client, "running", "not-a-run-of-this-runner").status_code == 204
    assert get_run(session_factory, run_id).last_seen_at == NOW + timedelta(seconds=400)
    with session_factory() as db:
        assert db.scalars(select(PerformanceRunner.current_run_id)).one() is None


def test_stop_pressed_while_only_idle_heartbeats_arrive_still_ends_the_run(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    at_time(monkeypatch, NOW + timedelta(seconds=60))
    assert _heartbeat(client, "idle").status_code == 204
    _stop(session_factory, run_id, NOW + timedelta(seconds=61))
    assert get_run(session_factory, run_id).status == "stopping"
    for seconds in (90, 119, 121):
        at_time(monkeypatch, NOW + timedelta(seconds=seconds))
        assert _heartbeat(client, "idle").status_code == 204
    run = get_run(session_factory, run_id)
    assert (run.status, run.status_reason, run.finished_at) == (
        "interrupted",
        "runner_silent",
        NOW + timedelta(seconds=120),
    )

    # Stop pressed once the silence has ended the run: the press says the runner was gone.
    later = NOW + timedelta(seconds=200)
    second = make_run(session_factory, status="running", now=later)
    at_time(monkeypatch, later + timedelta(seconds=60))
    assert _heartbeat(client, "idle").status_code == 204
    _stop(session_factory, second, later + timedelta(seconds=130))
    run = get_run(session_factory, second)
    assert (run.status, run.status_reason, run.finished_at) == (
        "interrupted",
        "stopped_while_runner_silent",
        later + timedelta(seconds=120),
    )


def test_a_run_that_never_reported_running_ends_stopped_not_finished(
    client, session_factory
):
    run_id = make_run(session_factory)
    assert _claim(client, run_id).status_code == 200
    assert _progress(client, run_id, 1, "stopping").json()["status"] == "stopping"
    answer = _progress(client, run_id, 2, "finished", exit_code=0)
    assert answer.status_code == 200, answer.text
    assert (answer.json()["status"], answer.json()["accepted"]) == ("stopped", True)
    run = get_run(session_factory, run_id)
    assert (run.status, run.started_at, run.status_reason) == ("stopped", None, None)

    # After a person's stop, the stop is the reason.
    second = make_run(session_factory)
    assert _claim(client, second).status_code == 200
    _stop(session_factory, second, NOW)
    assert _progress(client, second, 1, "finished").json()["status"] == "stopped"
    run = get_run(session_factory, second)
    assert (run.status, run.status_reason) == ("stopped", "stopped_by_person")

    # A runner that says the run failed is believed.
    third = make_run(session_factory)
    assert _claim(client, third).status_code == 200
    assert _progress(client, third, 1, "stopping").status_code == 200
    failed = _progress(client, third, 2, "failed", error="QA - preflight broke")
    assert failed.json()["status"] == "failed"
    assert get_run(session_factory, third).status_reason == "preflight_failed"


def test_a_registration_cannot_commit_between_the_claims_check_and_its_write(
    client, session_factory, database, monkeypatch
):
    """The claim checks the registered instance under the runner's row lock.

    A new process registers at the worst moment: right after the claim read the
    runner row. It must wait for the claim, and then end the run the replaced
    process claimed; no run is left with a process that is no longer registered.
    """
    if database.dialect.name != "postgresql":
        pytest.skip("needs row locks")
    run_id = make_run(session_factory)
    real = performance_ingest.find_runner
    outcome: dict[str, str] = {}

    def read_then_register(db, project_id, key, *, lock=False):
        runner = real(db, project_id, key, lock=lock)
        if not outcome:
            with session_factory() as registering:
                registering.execute(text("SET LOCAL lock_timeout = '100ms'"))
                try:
                    real(registering, project_id, key, lock=True).instance_id = (
                        "instance-2"
                    )
                    registering.commit()
                    outcome["registration"] = "committed in between"
                except OperationalError:
                    registering.rollback()
                    outcome["registration"] = "waited for the claim"
        return runner

    monkeypatch.setattr(performance_ingest, "find_runner", read_then_register)
    claimed = _claim(client, run_id)
    monkeypatch.setattr(performance_ingest, "find_runner", real)
    assert outcome == {"registration": "waited for the claim"}
    assert claimed.status_code == 200, claimed.text

    # The new process registers once the claim is in, and ends the claimed run.
    registered = client.put(
        BASE,
        headers=runner_headers(instance="instance-2"),
        json={"name": "QA - runner"},
    )
    assert registered.json()["interrupted_run_id"] == run_id
    run = get_run(session_factory, run_id)
    assert (run.status, run.status_reason) == ("interrupted", "runner_restarted")
