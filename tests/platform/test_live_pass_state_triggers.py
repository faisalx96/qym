"""When a repeat run's pass state replays the event log, and the live refresh interval.

The replay (``_repeat_pass_event_state_from_events``) reads every event of the run and
costs about a second per request for 100 items x 30 metrics x 20 passes. It runs only
for a real gap (a pass below the highest pass that has rows) or for a live run whose SDK
never recorded attempt starts.
"""

from __future__ import annotations

import pytest
from qym_platform.api import runs
from qym_platform.api.runs import legacy_run_data, run_live_status
from qym_platform.auth import Principal
from qym_platform.db.models import User
from sqlalchemy.orm import Session
from test_pass_ingest_regressions import (_complete,  # noqa: F401  (fixture)
                                          _finish, _start, pass_api)


def _spy_replay(monkeypatch):
    """Record every replay's keyword arguments (event_types, min_pass) and run the real one."""
    calls = []
    original = runs._repeat_pass_event_state_from_events

    def spy(*args, **kwargs):
        calls.append(kwargs)
        return original(*args, **kwargs)

    monkeypatch.setattr(runs, "_repeat_pass_event_state_from_events", spy)
    return calls


def _reduced(call):
    types = call.get("event_types")
    return (
        types is not None
        and "metric_scored" not in types
        and "pass_completed" not in types
    )


def test_live_run_between_attempts_reads_lifecycle_events_of_its_pass_only(
    pass_api, monkeypatch
):
    """Pass 1 done, pass 2 not started, nothing executing (the common state while metrics score)."""
    _, _, post, read = pass_api
    _start(post, 1)
    _finish(post, 1)
    _complete(post, 1, "first")
    calls = _spy_replay(monkeypatch)
    row, passes = read()
    assert calls and all(_reduced(c) for c in calls), calls
    assert all(c.get("min_pass") == 1 for c in calls), calls
    assert row["pass_attempts"][0]["status"] == "completed"
    assert passes[0]["completed_count"] == 1
    # the pass that has not started is pending, not a gap
    assert passes[1]["status"] == "pending"
    assert passes[1]["completed_count"] == 0


def test_live_run_in_a_later_pass_skips_earlier_passes_events(pass_api, monkeypatch):
    """Rows for passes 1 and 2, nothing executing: only pass 2's lifecycle events are read."""
    _, _, post, read = pass_api
    for pass_number, output in ((1, "first"), (2, "second")):
        _start(post, pass_number)
        _finish(post, pass_number)
        _complete(post, pass_number, output)
    calls = _spy_replay(monkeypatch)
    row, passes = read()
    assert calls and all(_reduced(c) and c.get("min_pass") == 2 for c in calls), calls
    assert [a["status"] for a in row["pass_attempts"]] == ["completed", "completed"]
    assert [p["completed_count"] for p in passes] == [1, 1]


def test_live_run_without_attempt_starts_still_sees_its_outcomes(pass_api, monkeypatch):
    """An older SDK records no attempt starts: the reduced replay still carries the item outcomes."""
    _, _, post, read = pass_api
    _finish(post, 1)
    _complete(post, 1, "first")
    calls = _spy_replay(monkeypatch)
    row, passes = read()
    assert calls and all(_reduced(c) for c in calls), calls
    assert row["pass_attempts"][0]["status"] == "completed"
    assert passes[0]["completed_count"] == 1


def test_gap_below_the_highest_pass_replays_everything(pass_api, monkeypatch):
    """Rows for pass 2 only: pass 1 is a real gap (legacy run or deleted pass), the whole log is read."""
    _, _, post, read = pass_api
    _start(post, 2)
    _finish(post, 2)
    _complete(post, 2, "second")
    calls = _spy_replay(monkeypatch)
    row, passes = read()
    assert calls and all(
        c.get("event_types") is None and c.get("min_pass") is None for c in calls
    ), calls
    assert row["pass_attempts"][1]["status"] == "completed"


def test_in_flight_attempt_needs_no_replay(pass_api, monkeypatch):
    """An item executing in pass 2 is a RUNNING row; pass 1 done: no replay."""
    _, _, post, read = pass_api
    _start(post, 1)
    _finish(post, 1)
    _complete(post, 1, "first")
    _start(post, 2)
    monkeypatch.setattr(
        runs,
        "_repeat_pass_event_state_from_events",
        lambda *a, **kw: pytest.fail(
            "Replayed the event log with a RUNNING attempt row"
        ),
    )
    row, passes = read()
    assert row["pass_attempts"][1]["status"] == "running"
    assert passes[1]["running_count"] == 1


def test_live_refresh_seconds_is_served_from_the_setting(pass_api, monkeypatch):
    engine, run_id, post, _ = pass_api
    _start(post, 1)
    monkeypatch.setenv("QYM_RUN_LIVE_REFRESH_SECONDS", "7")
    with Session(engine) as db:
        principal = Principal(user=db.get(User, "owner"), auth_type="proxy_headers")
        status = run_live_status(run_id=run_id, db=db, principal=principal)
        assert status["live"] is True
        assert status["live_refresh_seconds"] == 7.0
        summary = legacy_run_data(
            run_id=run_id, db=db, principal=principal, view="summary"
        )
        assert summary["run"]["live_refresh_seconds"] == 7.0
        assert summary["run"]["live_revision"]
        rows = legacy_run_data(
            run_id=run_id, db=db, principal=principal, view="compact", fields="scores"
        )
        assert rows["run"]["live_refresh_seconds"] == 7.0
    monkeypatch.delenv("QYM_RUN_LIVE_REFRESH_SECONDS")
    with Session(engine) as db:
        principal = Principal(user=db.get(User, "owner"), auth_type="proxy_headers")
        assert (
            run_live_status(run_id=run_id, db=db, principal=principal)[
                "live_refresh_seconds"
            ]
            == 15.0
        )
