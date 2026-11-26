"""Performance retention and the stale sweep, as the maintenance loop calls them."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    NOW,
    seed_event,
    seed_log_lines,
    seed_performance,
    seed_questions,
    seed_report,
    seed_run,
    seed_runner,
    seed_target,
    use_encryption_key,
)
from qym_platform.db.models import (
    AuditLog,
    PerformanceEvent,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceReport,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    PerformanceTargetToken,
    Project,
)
from qym_platform.services import maintenance, performance_retention, performance_views

MODELS = {
    "runs": PerformanceRun,
    "questions": PerformanceQuestion,
    "log_lines": PerformanceLogLine,
    "reports": PerformanceReport,
    "events": PerformanceEvent,
}


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_performance(db)
        db.commit()
    return factory


def old_run(
    session_factory,
    days: float,
    *,
    status: str = "finished",
    base: datetime = NOW,
    questions: int = 3,
    log_lines: int = 2,
    report: bool = True,
    **changes,
) -> str:
    """A run that ended ``days`` before ``base``, with questions, log lines, a report and an event."""
    when = base - timedelta(days=days)
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        runner = db.scalars(
            select(PerformanceRunner).where(PerformanceRunner.key == "runner-1")
        ).one()
        target = db.scalars(
            select(PerformanceTarget).where(PerformanceTarget.name == "QA - Preprod")
        ).one()
        run = seed_run(db, project, runner, target, status=status, now=when, **changes)
        seed_questions(db, run, questions)
        seed_log_lines(db, run, log_lines)
        if report:
            seed_report(db, run, received_at=when)
        seed_event(db, runner, run=run, at=when)
        db.commit()
        return run.id


def rows_of(session_factory, run_id: str) -> dict[str, int]:
    """How many rows of each kind a run still has."""
    with session_factory() as db:
        counts = {}
        for name, model in MODELS.items():
            column = model.id if name == "runs" else model.run_id
            counts[name] = db.scalar(
                select(func.count()).select_from(model).where(column == run_id)
            )
        return counts


def retention_audits(session_factory) -> list[AuditLog]:
    with session_factory() as db:
        return list(
            db.scalars(
                select(AuditLog).where(AuditLog.action == "performance_retention")
            ).all()
        )


def test_details_reports_runs_and_events_each_go_at_their_own_age(session_factory):
    fresh = old_run(session_factory, 10)
    past_details = old_run(session_factory, 100)
    past_report = old_run(session_factory, 200)
    past_everything = old_run(session_factory, 800)

    counts = performance_retention.purge_performance(session_factory, now=NOW)

    assert counts == {
        "questions": 9,
        "log_lines": 6,
        "reports": 2,
        "runs": 1,
        "events": 3,
    }
    assert rows_of(session_factory, fresh) == {
        "runs": 1,
        "questions": 3,
        "log_lines": 2,
        "reports": 1,
        "events": 1,
    }
    assert rows_of(session_factory, past_details) == {
        "runs": 1,
        "questions": 0,
        "log_lines": 0,
        "reports": 1,
        "events": 0,
    }
    assert rows_of(session_factory, past_report) == {
        "runs": 1,
        "questions": 0,
        "log_lines": 0,
        "reports": 0,
        "events": 0,
    }
    assert rows_of(session_factory, past_everything) == dict.fromkeys(MODELS, 0)
    (audit,) = retention_audits(session_factory)
    assert audit.after == counts
    assert (audit.actor_user_id, audit.entity_type, audit.entity_id) == (
        None,
        "performance_run",
        "all",
    )
    with session_factory() as db:
        # Targets, their tokens and the runner are kept.
        assert db.scalar(select(func.count()).select_from(PerformanceTarget)) == 1
        assert db.scalar(select(func.count()).select_from(PerformanceTargetToken)) == 2
        assert db.scalar(select(func.count()).select_from(PerformanceRunner)) == 1
        # The run keeps its headline and says that its report was once stored.
        run = db.get(PerformanceRun, past_report)
        assert run.report_received_at is not None
        assert run.questions_received == 3


def test_a_run_that_lost_its_report_says_so_on_the_run_page(session_factory):
    run_id = old_run(session_factory, 200)
    performance_retention.purge_performance(session_factory, now=NOW)
    with session_factory() as db:
        page = performance_views.run_read(
            db,
            db.get(Project, "performance-project-1"),
            db.get(PerformanceRun, run_id),
            performance_views.Access(writer=True, manager=True, archived=False),
            NOW,
        )
    assert page["report"] is None
    assert page["report_expired"] is True
    assert page["run"]["has_report"] is False


@pytest.mark.parametrize("status", ["queued", "starting", "running", "stopping"])
def test_a_run_that_has_not_ended_is_never_touched(session_factory, status):
    run_id = old_run(session_factory, 800, status=status)
    counts = performance_retention.purge_performance(session_factory, now=NOW)
    # Only the runner event of that day is old enough to go.
    assert counts == {
        "questions": 0,
        "log_lines": 0,
        "reports": 1,
        "runs": 0,
        "events": 1,
    }
    assert rows_of(session_factory, run_id) == {
        "runs": 1,
        "questions": 3,
        "log_lines": 2,
        "reports": 0,
        "events": 0,
    }


def test_the_limits_are_not_reached_one_second_early(session_factory, monkeypatch):
    monkeypatch.setenv("QYM_PERFORMANCE_DETAIL_RETENTION_DAYS", "1")
    monkeypatch.setenv("QYM_PERFORMANCE_REPORT_RETENTION_DAYS", "1")
    monkeypatch.setenv("QYM_PERFORMANCE_RETENTION_DAYS", "1")
    monkeypatch.setenv("QYM_PERFORMANCE_EVENTS_RETENTION_DAYS", "1")
    run_id = old_run(session_factory, 1)
    assert performance_retention.purge_performance(
        session_factory, now=NOW
    ) == dict.fromkeys(("questions", "log_lines", "reports", "runs", "events"), 0)
    assert retention_audits(session_factory) == []
    later = performance_retention.purge_performance(
        session_factory, now=NOW + timedelta(seconds=1)
    )
    assert later == {
        "questions": 3,
        "log_lines": 2,
        "reports": 1,
        "runs": 1,
        "events": 1,
    }
    assert rows_of(session_factory, run_id) == dict.fromkeys(MODELS, 0)


def test_rows_go_in_batches_and_all_of_them_go(session_factory, monkeypatch):
    monkeypatch.setattr(performance_retention, "BATCH_SIZE", 2)
    monkeypatch.setattr(performance_retention, "RUN_BATCH_SIZE", 1)
    runs = [
        old_run(session_factory, 800 + number, questions=5, log_lines=3)
        for number in range(3)
    ]
    kept = old_run(session_factory, 1, questions=5, log_lines=3)
    counts = performance_retention.purge_performance(session_factory, now=NOW)
    assert counts == {
        "questions": 15,
        "log_lines": 9,
        "reports": 3,
        "runs": 3,
        "events": 3,
    }
    for run_id in runs:
        assert rows_of(session_factory, run_id) == dict.fromkeys(MODELS, 0)
    assert rows_of(session_factory, kept)["questions"] == 5
    assert len(retention_audits(session_factory)) == 1


def test_switched_off_nothing_is_deleted_or_swept(session_factory, monkeypatch):
    monkeypatch.setenv("QYM_PERFORMANCE_ENABLED", "false")
    run_id = old_run(session_factory, 800)
    silent = old_run(session_factory, 1, status="running")
    assert not any(
        performance_retention.purge_performance(session_factory, now=NOW).values()
    )
    assert performance_retention.sweep_stale(session_factory, now=NOW) == 0
    assert rows_of(session_factory, run_id)["runs"] == 1
    with session_factory() as db:
        assert db.get(PerformanceRun, silent).status == "running"


# ---------------------------------------------------------------------------
# The maintenance loop
# ---------------------------------------------------------------------------


@pytest.fixture()
def worker(session_factory, database, monkeypatch):
    """The maintenance worker with the other areas' retention replaced by notes."""
    calls: list[str] = []
    monkeypatch.setattr(
        "qym_platform.services.retention.run_retention",
        lambda *args, **kwargs: calls.append("runs"),
    )
    monkeypatch.setattr(
        "qym_platform.feedback_agent.retention.run_purge",
        lambda *args, **kwargs: calls.append("feedback"),
    )
    monkeypatch.setattr(
        "qym_platform.services.live_retention.purge_live",
        lambda *args, **kwargs: calls.append("live"),
    )
    made = maintenance.MaintenanceWorker(session_factory, database)
    made.calls = calls
    return made


def test_the_hourly_pass_purges_performance_data_after_live(worker, session_factory):
    gone = old_run(session_factory, 800, base=datetime.utcnow())
    kept = old_run(session_factory, 1, base=datetime.utcnow())
    worker._maybe_run_retention()
    # The first pass waits a minute after the start: nothing has run yet.
    assert worker.calls == []
    worker._next_retention = 0
    worker._maybe_run_retention()
    assert worker.calls == ["runs", "feedback", "live"]
    assert rows_of(session_factory, gone) == dict.fromkeys(MODELS, 0)
    assert rows_of(session_factory, kept)["questions"] == 3
    assert len(retention_audits(session_factory)) == 1


def test_a_failing_performance_purge_does_not_stop_the_loop(worker, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(performance_retention, "purge_performance", broken)
    monkeypatch.setattr(performance_retention, "sweep_stale", broken)
    worker._next_retention = 0
    worker._maybe_run_retention()
    worker._next_performance_sweep = 0
    worker._maybe_sweep_performance()
    assert worker.calls == ["runs", "feedback", "live"]


def test_the_loop_ends_silent_and_unclaimed_runs(worker, session_factory):
    now = datetime.utcnow()
    silent = old_run(
        session_factory,
        0,
        base=now - timedelta(minutes=30),
        status="running",
        report=False,
    )
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        second_runner = seed_runner(db, project, key="runner-2")
        second_target = seed_target(
            db,
            project,
            name="QA - Second",
            base_url="https://second.example.test",
            tokens={},
        )
        unclaimed = seed_run(
            db,
            project,
            second_runner,
            second_target,
            status="queued",
            now=now - timedelta(minutes=30),
        ).id
        db.commit()

    worker._maybe_sweep_performance()
    with session_factory() as db:
        # The first sweep comes a few seconds after the start.
        assert db.get(PerformanceRun, silent).status == "running"
    worker._next_performance_sweep = 0
    worker._maybe_sweep_performance()
    with session_factory() as db:
        ended = db.get(PerformanceRun, silent)
        assert ended.status == "interrupted"
        assert ended.finished_at is not None
        expired = db.get(PerformanceRun, unclaimed)
        assert expired.status == "expired"
        codes = db.scalars(
            select(PerformanceEvent.code)
            .where(PerformanceEvent.source == "qym")
            .order_by(PerformanceEvent.code)
        ).all()
        assert codes == ["expired", "interrupted"]
    # What was measured is kept.
    assert rows_of(session_factory, silent)["questions"] == 3


def test_the_sweep_runs_at_most_once_per_interval(worker, monkeypatch):
    swept: list[datetime] = []
    monkeypatch.setattr(
        performance_retention,
        "sweep_stale",
        lambda factory, *, now: swept.append(now) or 0,
    )
    clock = [1000.0]
    monkeypatch.setattr(maintenance.time, "monotonic", lambda: clock[0])
    worker._next_performance_sweep = 1000.0
    worker._maybe_sweep_performance()
    worker._maybe_sweep_performance()
    assert len(swept) == 1
    clock[0] += maintenance.PERFORMANCE_SWEEP_INTERVAL - 0.5
    worker._maybe_sweep_performance()
    assert len(swept) == 1
    clock[0] += 0.5
    worker._maybe_sweep_performance()
    assert len(swept) == 2


def test_a_run_whose_runner_still_answers_is_left_alone(session_factory):
    run_id = old_run(session_factory, 0, status="running", report=False)
    assert (
        performance_retention.sweep_stale(
            session_factory, now=NOW + timedelta(seconds=119)
        )
        == 0
    )
    with session_factory() as db:
        assert db.get(PerformanceRun, run_id).status == "running"
    assert (
        performance_retention.sweep_stale(
            session_factory, now=NOW + timedelta(seconds=120)
        )
        == 1
    )
    with session_factory() as db:
        assert db.get(PerformanceRun, run_id).status == "interrupted"
