"""How fast a stop shows on the runs list and the run page.

Cancelling a running evaluation job is asynchronous: the run stays ``RUNNING``
until the dispatcher's remote cancel. Meanwhile the run reports
``stop_requested`` (the pages show "Stopping…"), the runs list's projection is
republished at once (not only when the remote cancel lands), and pages that
performed a stop tell every open runs list / run page to re-read now.
"""

from __future__ import annotations

import re
from datetime import datetime
import sys
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.auth import Principal  # noqa: E402
from qym_platform.db.dashboard_models import (  # noqa: E402
    DashboardChangeEvent,
    DashboardRunDimension,
)
from qym_platform.db.models import (  # noqa: E402
    EvalJobStatus,
    Run,
    RunWorkflowStatus,
    User,
)
from qym_platform.services import dashboard_summaries  # noqa: E402
from qym_platform.services.run_lifecycle import (  # noqa: E402
    is_run_stop_requested,
    stop_requested_job_ids,
)
from test_eval_dispatcher import _env, _job, _link_run, clock, sessions  # noqa: E402,F401
from test_eval_queue import (  # noqa: E402,F401
    _cancel,
    _same_clock,
    _submitted,
    service,
)

STATIC = PLATFORM_SRC / "qym_platform" / "_static" / "dashboard"


def _run_changes(sessions, run_id):
    """Run-level outbox events queued for ``run_id`` (descriptor republishes)."""
    with sessions() as db:
        return db.scalar(
            select(func.count())
            .select_from(DashboardChangeEvent)
            .where(
                DashboardChangeEvent.partition_key == run_id,
                DashboardChangeEvent.record_kind == "run",
            )
        )


def _drain(sessions):
    for _ in range(20):
        with sessions() as db:
            processed = dashboard_summaries.drain_dashboard_changes(db)
            db.commit()
        if not processed:
            return


def _descriptor(sessions, run_id):
    with sessions() as db:
        dimension = db.get(DashboardRunDimension, run_id)
        return dict(dimension.descriptor or {}) if dimension else {}


def _live_run(sessions, service, clock):
    seed, dispatcher, remote = _submitted(sessions, service, clock)
    job_id = seed["job_ids"][0]
    service.set_status(remote[job_id], "RUNNING")
    run_id = _link_run(
        sessions, seed, job_id, status=RunWorkflowStatus.RUNNING, started_at=clock()
    )
    return seed, dispatcher, remote, job_id, run_id


def test_cancelling_job_marks_its_run_stop_requested_until_stopped(
    sessions, service, clock
):
    seed, dispatcher, _remote, job_id, run_id = _live_run(sessions, service, clock)
    _drain(sessions)
    assert _descriptor(sessions, run_id).get("stop_requested") is False
    with sessions() as db:
        assert not is_run_stop_requested(db, db.get(Run, run_id))
    before = _run_changes(sessions, run_id)

    assert _cancel(sessions, [job_id], seed["user_id"]) == {job_id: "cancelling"}

    # The API answered before the remote cancel: the run is still RUNNING, but
    # its stop is requested and its runs-list row was queued for republishing.
    with sessions() as db:
        run = db.get(Run, run_id)
        assert run.status == RunWorkflowStatus.RUNNING
        assert is_run_stop_requested(db, run)
        assert stop_requested_job_ids(db, [job_id, None, "missing"]) == {job_id}
    assert _run_changes(sessions, run_id) > before
    _drain(sessions)
    assert _descriptor(sessions, run_id)["stop_requested"] is True
    assert _descriptor(sessions, run_id)["status"] == "RUNNING"

    # The dispatcher's remote cancel stops the run; it is no longer "stopping".
    clock.advance(1)
    dispatcher.tick()
    with sessions() as db:
        run = db.get(Run, run_id)
        assert run.status == RunWorkflowStatus.STOPPED
        assert run.status_reason == "cancelled_by_user"
        assert not is_run_stop_requested(db, run)
    _drain(sessions)
    descriptor = _descriptor(sessions, run_id)
    assert descriptor["status"] == "STOPPED"
    assert descriptor["stop_requested"] is False


def test_a_cancel_that_finds_the_job_finished_clears_stop_requested(
    sessions, service, clock
):
    """The service already finished the job (409): the job leaves CANCELLING
    through the ORM, which republishes the run so "Stopping…" goes away."""
    seed, dispatcher, remote, job_id, run_id = _live_run(sessions, service, clock)
    assert _cancel(sessions, [job_id], seed["user_id"]) == {job_id: "cancelling"}
    _drain(sessions)
    assert _descriptor(sessions, run_id)["stop_requested"] is True
    before = _run_changes(sessions, run_id)

    service.set_status(remote[job_id], "SUCCEEDED")
    clock.advance(1)
    dispatcher.tick()
    assert _job(sessions, job_id).status != EvalJobStatus.CANCELLING
    assert _run_changes(sessions, run_id) > before
    _drain(sessions)
    assert _descriptor(sessions, run_id)["stop_requested"] is False


def test_run_page_endpoints_report_stop_requested(sessions, service, clock):
    from qym_platform.api.runs import _summarize_runs_for_admin, run_live_status

    seed, _dispatcher, _remote, job_id, run_id = _live_run(sessions, service, clock)
    # The probe infers a lease timeout on the wall clock; the run is fresh.
    with sessions() as db:
        db.get(Run, run_id).last_event_at = datetime.utcnow()
        db.commit()

    def probe():
        with sessions() as db:
            principal = Principal(
                user=db.get(User, seed["user_id"]), auth_type="proxy_headers"
            )
            return run_live_status(run_id, db=db, principal=principal)

    assert probe()["stop_requested"] is False
    _cancel(sessions, [job_id], seed["user_id"])
    body = probe()
    assert body["stop_requested"] is True and body["live"] is True
    with sessions() as db:
        rows = _summarize_runs_for_admin(db, [db.get(Run, run_id)])
        assert rows[0]["stop_requested"] is True


def test_runs_without_a_cancelling_job_are_never_stop_requested(sessions):
    with sessions() as db:
        assert stop_requested_job_ids(db, []) == set()
        assert stop_requested_job_ids(db, [None, ""]) == set()
        run = Run(status=RunWorkflowStatus.RUNNING, experiment_job_id=None)
        assert not is_run_stop_requested(db, run)
        done = Run(status=RunWorkflowStatus.COMPLETED, experiment_job_id="job")
        assert not is_run_stop_requested(db, done)


# --------------------------------------------------------------------------- pages


def _read(name):
    return (STATIC / name).read_text(encoding="utf-8")


def test_shell_broadcasts_run_status_changes_across_pages_and_tabs():
    shell = _read("shell.js")
    assert "announceRunStatus: announceRunStatus" in shell
    assert "new BroadcastChannel('qym-run-status')" in shell
    assert "'qym:run-status'" in shell
    # Every stop action announces its stop.
    assert "announceRunStatus?.({ runIds: [runId], status: 'STOPPED' })" in _read(
        "admin.html"
    )
    experiments = _read("experiments.js")
    assert "announceStops([job]);" in experiments
    assert "announceStops(stopRunning ? running : pending);" in experiments
    assert "announceRunStatus?.({ runIds: [], status: 'STOPPING' })" in _read(
        "eval_queue.js"
    )


def test_runs_list_shows_stopping_and_polls_fast_while_a_stop_is_under_way():
    js = _read("dashboard.js")
    assert "const STOPPING_REFRESH_INTERVAL_MS = 2000;" in js
    assert re.search(r"const intervalMs = stopping \? STOPPING_REFRESH_INTERVAL_MS", js)
    assert "function isStoppingRun(run)" in js
    assert "const badgeLabel = stopping ? 'STOPPING…' : status;" in js
    # The stopping badge reuses the warning (stopped) tone: no new CSS.
    assert "const badgeStatus = stopping ? 'STOPPED' : status;" in js
    assert "document.addEventListener('qym:run-status'" in js
    assert "state._announcedStopUntil = Date.now() + ANNOUNCED_STOP_WINDOW_MS;" in js
    # A slow-to-confirm stop falls back to the live cadence.
    assert "now - state._stoppingSince < 60000" in js
    index = _read("index.html")
    assert "dashboard.js?v=p1-20261008-stop" in index


def test_run_page_shows_stopping_and_reacts_at_once():
    html = _read("run.html")
    assert "const stopping = !pass && !!run.stop_requested && isLiveStatus(run.status);" in html
    assert "const statusText = stopping ? 'STOPPING…'" in html
    assert "const stopChanged = !ended && !!info.stop_requested !== !!state.run?.stop_requested;" in html
    assert "if (ended || stopChanged ||" in html
    assert "return info.stop_requested ? 1500 : undefined;" in html
    assert "liveRun.poller.now()" in html
