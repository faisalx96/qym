"""What the Performance pages read: Home, history, setup, a run, its questions, log and events, the runner.

Field names are those of ``frontend/src/api/performance.ts``. Every function
takes the clock as ``now`` (naive UTC) and writes nothing: a status that a
silence rule has changed is derived on read, here and in SQL, and stored by the
maintenance sweep. Token values never appear in any payload.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterator, Mapping, Optional, Sequence

from sqlalchemy import and_, case, false, func, or_, select
from sqlalchemy.orm import Session, defer
from sqlalchemy.sql.elements import ColumnElement

from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    ApiKey,
    Dataset,
    DatasetItem,
    DatasetVersion,
    DatasetVersionStatus,
    PERFORMANCE_STATUS_REASONS,
    PerformanceEvent,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceReport,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    Project,
    User,
)
from qym_platform.services import performance_plan as plan_rules
from qym_platform.services import performance_state as state
from qym_platform.services import performance_targets as targets
from qym_platform.services.live_events import redact_details
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.settings import PlatformSettings

# The key of the runner row that is made when a Manager chooses the runner key
# before any runner has connected; the first registration takes the row over.
DEFAULT_RUNNER_KEY = "runner-1"
DEFAULT_RUNNER_NAME = "Runner"
RUNS_PAGE_SIZE = 25
TREND_RUNS = 30
RUN_EVENTS_MAX = 1000
QUESTION_STATUSES = ("ok", "error", "interrupted")
QUESTION_SORTS = ("seq", "-seq", "duration_ms", "-duration_ms", "ttfb_ms", "-ttfb_ms")
CSV_COLUMNS = (
    "seq",
    "asked_at",
    "elapsed_s",
    "stage",
    "level",
    "user",
    "tier",
    "question_id",
    "is_followup",
    "question",
    "status",
    "http_status",
    "error_kind",
    "duration_ms",
    "ttfb_ms",
    "quality",
    "no_data",
    "warmup",
    "attempts",
    "answer",
    "answer_truncated",
)


def utcnow() -> datetime:
    """qym's clock as naive UTC; the page routes read it here."""
    return utc_now_naive()


@dataclass(frozen=True)
class Access:
    """What the person asking may do in this project, decided by the API."""

    writer: bool  # a member who may change things: not a Viewer
    manager: bool
    archived: bool  # the project is read-only

    @property
    def can_start(self) -> bool:
        return self.writer and not self.archived

    @property
    def can_manage(self) -> bool:
        return self.manager and not self.archived


def _seconds_since(moment: Optional[datetime], now: datetime) -> Optional[int]:
    if moment is None:
        return None
    return max(0, int((now - moment).total_seconds()))


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def project_runner(
    db: Session, project_id: str, *, lock: bool = False
) -> Optional[PerformanceRunner]:
    """The project's runner: one per project in this version (the most recently heard from)."""
    query = (
        select(PerformanceRunner)
        .where(
            PerformanceRunner.project_id == project_id,
            PerformanceRunner.is_active.is_(True),
        )
        .order_by(
            PerformanceRunner.last_heartbeat_at.desc().nulls_last(),
            PerformanceRunner.key,
        )
        .limit(1)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return db.scalars(query).first()


def runner_registered(runner: Optional[PerformanceRunner]) -> bool:
    """A runner process has connected at least once (the row may exist before that)."""
    return runner is not None and runner.registered_at is not None


def runner_key(db: Session, runner: Optional[PerformanceRunner]) -> Optional[ApiKey]:
    """The API key a Manager chose for the runner, while it is not revoked."""
    if runner is None or not runner.runner_key_id:
        return None
    key = db.get(ApiKey, runner.runner_key_id)
    if key is None or key.revoked_at is not None or key.project_id != runner.project_id:
        return None
    return key


def runner_is_fresh(
    runner: PerformanceRunner, now: datetime, settings: PlatformSettings
) -> bool:
    seconds = _seconds_since(runner.last_heartbeat_at, now)
    return seconds is not None and seconds <= settings.performance_runner_fresh_seconds


def runner_status(
    db: Session,
    runner: Optional[PerformanceRunner],
    now: datetime,
    settings: PlatformSettings,
) -> Optional[dict[str, Any]]:
    """The runner as the pages see it; ``None`` until a runner has registered."""
    if not runner_registered(runner):
        return None
    assert runner is not None
    seconds = _seconds_since(runner.last_heartbeat_at, now)
    key = runner_key(db, runner)
    errors = db.scalar(
        select(func.count(PerformanceEvent.id)).where(
            PerformanceEvent.runner_id == runner.id,
            PerformanceEvent.level == "error",
            PerformanceEvent.at >= now - timedelta(hours=1),
        )
    )
    return {
        "id": runner.id,
        "key": runner.key,
        "name": runner.name,
        "info": runner.info if isinstance(runner.info, dict) else {},
        "reported_state": runner.reported_state,
        "current_run_id": runner.current_run_id,
        "last_heartbeat_at": to_api_timestamp(runner.last_heartbeat_at),
        "seconds_since_heartbeat": seconds,
        "fresh": runner_is_fresh(runner, now, settings),
        "stale": seconds is None or seconds >= settings.performance_stale_after_seconds,
        "runner_key_set": key is not None,
        "runner_key_matches": (
            None
            if key is None or runner.registered_key_id is None
            else runner.registered_key_id == key.id
        ),
        "errors_last_hour": int(errors or 0),
        "registered_at": to_api_timestamp(runner.registered_at),
    }


def blocked_reason(
    db: Session,
    runner: Optional[PerformanceRunner],
    now: datetime,
    settings: PlatformSettings,
) -> Optional[PerformanceError]:
    """Why no run can be started right now, whatever the form says; ``None`` when nothing blocks.

    The same refusals, in the same order, as the start route gives.
    """
    if not targets.encryption_ready():
        return PerformanceError(
            "encryption_key_missing",
            409,
            "Tokens cannot be stored: this platform has no encryption key configured.",
        )
    if not runner_registered(runner):
        return PerformanceError(
            "runner_missing",
            409,
            "No runner has connected to this project yet. Start the runner first.",
        )
    assert runner is not None
    key = runner_key(db, runner)
    if key is None:
        return PerformanceError(
            "runner_key_missing",
            409,
            "No API key is chosen for the runner. A Manager chooses it on the Runner page.",
        )
    if runner.registered_key_id != key.id:
        # The sign-in is handed only to the chosen key: this runner would never get it.
        return PerformanceError(
            "runner_key_mismatch",
            409,
            "The runner connected with another API key than the one chosen for it, so "
            "it cannot receive the sign-in. Restart the runner with the chosen key, or "
            "choose its key on the Runner page.",
        )
    if not runner_is_fresh(runner, now, settings):
        seconds = _seconds_since(runner.last_heartbeat_at, now)
        return PerformanceError(
            "runner_stale",
            409,
            "The runner has not answered for "
            f"{seconds if seconds is not None else 'many'} seconds. Check that it is running.",
            {"seconds_since_heartbeat": seconds},
        )
    run = targets.active_run(db, now=now, runner_id=runner.id)
    if run is not None:
        return PerformanceError(
            "runner_busy",
            409,
            f"Run {run.number} is in progress. The runner takes one run at a time: stop "
            "it or wait until it ends.",
            {"run_id": run.id},
        )
    return None


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def effective_status_sql(now: datetime) -> Any:
    """``performance_state.effective_status`` as a SQL expression, for filters and counts.

    The two limits are read where the state rules read them, so both agree.
    """
    settings = state.performance_settings()
    stale_before = now - timedelta(seconds=settings.performance_stale_after_seconds)
    expired_before = now - timedelta(seconds=settings.performance_queue_timeout_seconds)
    seen = func.coalesce(PerformanceRun.last_seen_at, PerformanceRun.claimed_at)
    return case(
        (
            and_(
                PerformanceRun.status.in_(state.CLAIMED_STATUSES), seen <= stale_before
            ),
            "interrupted",
        ),
        (
            and_(
                PerformanceRun.status == "queued",
                PerformanceRun.requested_at <= expired_before,
            ),
            "expired",
        ),
        else_=PerformanceRun.status,
    )


def _derived_reason(run: PerformanceRun, status: str) -> Optional[str]:
    """The reason of a run whose row carries none.

    That is a run whose end is derived on read and not stored yet (its runner
    went silent, or nobody claimed it), and a row that was ended without a
    reason being written.
    """
    if status == "expired":
        return "not_claimed"
    if status == "stopped":
        if run.claimed_at is None:
            return "stopped_before_claim"
        return "stopped_by_person" if run.stop_requested_at else "runner_shutdown"
    if status == "failed":
        return "preflight_failed" if run.started_at is None else "k6_failed"
    if status == "interrupted":
        silent = run.status != "interrupted" or run.error in (
            None,
            state.INTERRUPTED_MESSAGE,
        )
        return "runner_silent" if silent else "runner_shutdown"
    return None


def _reason_words(
    code: str, run: PerformanceRun, status: str, person: Optional[str]
) -> str:
    """One sentence in plain words for a reason code."""
    if code == "stopped_before_claim":
        if person:
            return f"Stopped by {person} before the runner picked it up."
        return "Stopped before the runner picked it up."
    if code == "stopped_by_person":
        return f"Stopped by {person}." if person else "Stopped by a person."
    if code == "preflight_failed":
        return run.error or "The run could not start."
    if code == "k6_failed":
        return run.error or "The test ended with an error."
    if code == "runner_restarted":
        return "The runner was started again during the run; the run was ended."
    if code == "runner_silent":
        return state.INTERRUPTED_MESSAGE
    if code == "stopped_while_runner_silent":
        return "Stop was pressed while the runner was not answering; the run was ended."
    if code == "not_claimed":
        return "No runner picked the run up in time, so it never started."
    # runner_shutdown: the runner ended the run by itself.
    if status == "stopped":
        return run.error or "The runner stopped the test by itself."
    return run.error or "The runner shut down during the run."


def status_reason(
    run: PerformanceRun, status: str, names: Mapping[str, str]
) -> Optional[dict[str, str]]:
    """Why the run ended other than by running to its end; ``None`` while all is normal.

    The code is the one stored with the final status (``status_reason``); the
    sentence is made here from the code.
    """
    if status not in state.TERMINAL_STATUSES or status == "finished":
        return None
    code = run.status_reason if run.status == status else None
    if run.target_kind == "estishraf_platform" and code == "runner_kind_unsupported":
        from qym_platform.services.performance_platform import MESSAGES
        return {"code": code, "message": MESSAGES[code]}
    if code not in PERFORMANCE_STATUS_REASONS:
        code = _derived_reason(run, status)
    if code is None:
        return None
    person = names.get(run.stop_requested_by_user_id or "")
    return {"code": code, "message": _reason_words(code, run, status, person)}


def _config(run: PerformanceRun) -> dict[str, Any]:
    return run.config if isinstance(run.config, dict) else {}


def _part(config: Mapping[str, Any], name: str) -> dict[str, Any]:
    value = config.get(name)
    return value if isinstance(value, dict) else {}


def _target_of(run: PerformanceRun) -> dict[str, Any]:
    target = _part(_config(run), "target")
    return {
        "id": run.target_id,
        "name": str(target.get("name") or ""),
        "is_production": bool(target.get("is_production")),
    }


def run_row(
    run: PerformanceRun,
    *,
    now: datetime,
    names: Mapping[str, str],
    reports: set[str],
) -> dict[str, Any]:
    """One row of the history table; ``status`` is the status derived on read."""
    if run.target_kind == "estishraf_platform":
        from qym_platform.services.performance_platform_views import run_row as platform_row
        return platform_row(run, now, names, reports)
    config = _config(run)
    dataset, plan = _part(config, "dataset"), _part(config, "plan")
    status = state.effective_status(run, now=now)
    finished_at = state.effective_finished_at(run, now=now)
    duration = run.duration_s
    if duration is None and run.started_at is not None and finished_at is not None:
        duration = max(0.0, (finished_at - run.started_at).total_seconds())
    max_users = run.max_users
    if max_users is None:
        max_users = max(plan.get("levels") or [0]) or None
    reason = status_reason(run, status, names)
    return {
        "id": run.id,
        "number": run.number,
        "test_type": run.test_type,
        "status": status,
        "verdict": run.verdict,
        "target": _target_of(run),
        "dataset": {
            "id": run.dataset_id,
            "name": str(dataset.get("name") or ""),
            "version": str(dataset.get("version") or ""),
        },
        "requested_by": names.get(run.requested_by_user_id or ""),
        "requested_by_user_id": run.requested_by_user_id,
        "requested_at": to_api_timestamp(run.requested_at),
        "started_at": to_api_timestamp(run.started_at),
        "finished_at": to_api_timestamp(finished_at),
        "duration_s": duration,
        "safe_load_users": run.safe_load_users,
        "breaking_level_users": run.breaking_level_users,
        "breaking_reason": run.breaking_reason,
        "recommended_max_users": run.recommended_max_users,
        "p95_at_safe_load_ms": run.p95_at_safe_load_ms,
        "p95_ms": run.p95_ms,
        "limit_ms": plan.get("limit_ms") or 0,
        "answers_measured": run.answers_measured,
        "answers_total": run.answers_total,
        "errors_total": run.errors_total,
        "error_rate_pct": run.error_rate_pct,
        "max_users": max_users,
        "quality_mean": run.quality_mean,
        "status_reason": reason["message"] if reason else None,
        "note": str(config.get("note") or ""),
        "has_report": run.id in reports,
    }


def _report_ids(db: Session, run_ids: Sequence[str]) -> set[str]:
    """Which of the runs have a stored report file, without reading a file."""
    if not run_ids:
        return set()
    return set(
        db.scalars(
            select(PerformanceReport.run_id).where(
                PerformanceReport.run_id.in_(run_ids)
            )
        ).all()
    )


def _run_names(db: Session, runs: Sequence[PerformanceRun]) -> dict[str, str]:
    return targets.user_names(
        db,
        [
            *(run.requested_by_user_id for run in runs),
            *(run.stop_requested_by_user_id for run in runs),
        ],
    )


@dataclass
class RunFilters:
    """Query of the history; lists are repeated query parameters."""

    page: int = 1
    page_size: int = RUNS_PAGE_SIZE
    target_kind: Optional[str] = None
    status: list[str] = field(default_factory=list)
    verdict: list[str] = field(default_factory=list)
    target: Optional[str] = None
    test_type: list[str] = field(default_factory=list)
    #: Words to look for: a run number, a target, dataset or person name (case-insensitive).
    q: Optional[str] = None


def _search_number(text: str) -> Optional[int]:
    """'12', '#12' or 'run 12' -> 12; anything else is not a run number."""
    digits = text.strip().lower()
    if digits.startswith("run"):
        digits = digits[3:]
    digits = digits.strip().lstrip("#").strip()
    return int(digits) if digits.isdigit() and len(digits) <= 9 else None


def _run_search(text: str) -> Any:
    """One condition: the run's number, the target and dataset names as stored on the run (the names its row
    shows, also after a rename), or the requesting person by name or email; all in the same statement.
    """
    pattern = _like(text)
    matches = [
        PerformanceRun.config[("target", "name")]
        .as_string()
        .ilike(pattern, escape="\\"),
        PerformanceRun.config[("dataset", "name")]
        .as_string()
        .ilike(pattern, escape="\\"),
        PerformanceRun.requested_by_user_id.in_(
            select(User.id).where(
                or_(
                    User.display_name.ilike(pattern, escape="\\"),
                    User.email.ilike(pattern, escape="\\"),
                )
            )
        ),
    ]
    number = _search_number(text)
    if number is not None:
        matches.append(PerformanceRun.number == number)
    return or_(*matches)


def runs_page(
    db: Session, project: Project, filters: RunFilters, now: datetime
) -> dict[str, Any]:
    """A page of the history, newest first, in a fixed number of statements."""
    conditions = [PerformanceRun.project_id == project.id]
    if not db.info.get("performance_platform_read"):
        conditions.append(PerformanceRun.target_kind == "chat")
    if filters.target_kind:
        conditions.append(PerformanceRun.target_kind == filters.target_kind)
    if filters.status:
        conditions.append(effective_status_sql(now).in_(filters.status))
    if filters.verdict:
        conditions.append(PerformanceRun.verdict.in_(filters.verdict))
    if filters.target:
        conditions.append(PerformanceRun.target_id == filters.target)
    if filters.test_type:
        conditions.append(PerformanceRun.test_type.in_(filters.test_type))
    if filters.q and filters.q.strip():
        conditions.append(_run_search(filters.q.strip()))
    total = db.scalar(select(func.count(PerformanceRun.id)).where(*conditions))
    runs = db.scalars(
        select(PerformanceRun)
        .where(*conditions)
        .options(defer(PerformanceRun.summary), defer(PerformanceRun.progress))
        .order_by(PerformanceRun.requested_at.desc(), PerformanceRun.number.desc())
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).all()
    names = _run_names(db, runs)
    reports = _report_ids(db, [run.id for run in runs])
    return {
        "rows": [run_row(run, now=now, names=names, reports=reports) for run in runs],
        "total": int(total or 0),
        "page": filters.page,
        "page_size": filters.page_size,
    }


def active_run_payload(
    run: PerformanceRun, now: datetime, names: Mapping[str, str]
) -> dict[str, Any]:
    """The run that is queued or active now, in short."""
    if run.target_kind == "estishraf_platform":
        from qym_platform.services.performance_platform_views import active
        return active(run, now, names)
    plan = _part(_config(run), "plan")
    progress = run.progress if isinstance(run.progress, dict) else {}
    answers = (
        progress.get("answers") if isinstance(progress.get("answers"), dict) else {}
    )
    stages, levels = plan.get("stages"), progress.get("levels")
    return {
        "id": run.id,
        "number": run.number,
        "test_type": run.test_type,
        "status": state.effective_status(run, now=now),
        "target": _target_of(run),
        "requested_by": names.get(run.requested_by_user_id or ""),
        "requested_by_user_id": run.requested_by_user_id,
        "requested_at": to_api_timestamp(run.requested_at),
        "started_at": to_api_timestamp(run.started_at),
        "elapsed_s": progress.get("elapsed_s"),
        "planned_s": plan.get("total_seconds") or 0,
        "phase": progress.get("phase"),
        "level": progress.get("level"),
        "users": progress.get("users"),
        "answers_finished": answers.get("finished"),
        "answers_in_flight": answers.get("in_flight"),
        "errors": answers.get("errors"),
        "p95_ms": progress.get("p95_ms"),
        "limit_ms": plan.get("limit_ms") or 0,
        "stop_requested": run.stop_requested_at is not None,
        "token_needed": run.token_needed,
        "seconds_since_report": _seconds_since(run.last_report_at, now),
        # For the stepladder on Home: planned users over time, and each level so far.
        "stages": stages if isinstance(stages, list) else [],
        "levels": levels if isinstance(levels, list) else [],
    }


def _project_active_run(
    db: Session, project_id: str, now: datetime
) -> Optional[PerformanceRun]:
    runs = db.scalars(
        select(PerformanceRun)
        .where(
            PerformanceRun.project_id == project_id,
            PerformanceRun.status.in_(state.ACTIVE_STATUSES),
        )
        .order_by(PerformanceRun.requested_at.desc())
    ).all()
    return next(
        (
            run
            for run in runs
            if state.effective_status(run, now=now) in state.ACTIVE_STATUSES
        ),
        None,
    )


def _active_payload(
    db: Session, project_id: str, now: datetime
) -> Optional[dict[str, Any]]:
    run = _project_active_run(db, project_id, now)
    if run is None or (run.target_kind == "estishraf_platform" and not db.info.get("performance_platform_read")):
        return None
    return active_run_payload(run, now, _run_names(db, [run]))


def home(
    db: Session, project: Project, access: Access, now: datetime
) -> dict[str, Any]:
    """The Home page: runner, the run in progress, targets, first history page, the trend."""
    settings = PlatformSettings()
    runner = project_runner(db, project.id)
    trend = db.execute(
        select(
            PerformanceRun.id,
            PerformanceRun.number,
            PerformanceRun.target_id,
            PerformanceRun.finished_at,
            PerformanceRun.safe_load_users,
            PerformanceRun.breaking_level_users,
            PerformanceRun.max_users,
        )
        .where(
            PerformanceRun.project_id == project.id,
            PerformanceRun.test_type == "breakpoint",
            PerformanceRun.target_kind == "chat",
            PerformanceRun.status == "finished",
            PerformanceRun.safe_load_users.is_not(None),
            PerformanceRun.finished_at.is_not(None),
        )
        .order_by(PerformanceRun.finished_at.desc(), PerformanceRun.number.desc())
        .limit(TREND_RUNS)
    ).all()
    result = {
        "server_time": to_api_timestamp(now),
        "runner": runner_status(db, runner, now, settings),
        "active_run": _active_payload(db, project.id, now),
        "targets": targets.target_summaries(
            db, targets.list_targets(db, project.id), now
        ),
        "runs": runs_page(db, project, RunFilters(), now),
        "safe_load_trend": [
            {
                "run_id": row.id,
                "number": row.number,
                "target_id": row.target_id,
                "finished_at": to_api_timestamp(row.finished_at),
                "safe_load_users": row.safe_load_users,
                "breaking_level_users": row.breaking_level_users,
                "max_users": row.max_users,
            }
            for row in reversed(trend)
        ],
        "can": {"start": access.can_start, "manage": access.can_manage},
    }

    if db.info.get("performance_platform_read"):
        from qym_platform.services.performance_platform_views import home as platform_home
        return platform_home(db, project, access, result, now)
    return result


# ---------------------------------------------------------------------------
# New run: setup and datasets
# ---------------------------------------------------------------------------


def starts_used(
    db: Session, user_id: str, now: datetime
) -> tuple[int, Optional[datetime]]:
    """How many runs this person started in the last hour, and when the oldest was."""
    count, oldest = db.execute(
        select(
            func.count(PerformanceRun.id), func.min(PerformanceRun.requested_at)
        ).where(
            PerformanceRun.requested_by_user_id == user_id,
            PerformanceRun.requested_at > now - timedelta(hours=1),
        )
    ).one()
    return int(count or 0), oldest


def plan_limits(
    db: Session, user_id: str, now: datetime, settings: PlatformSettings
) -> dict[str, Any]:
    """Lowest and highest value the start route accepts for each field."""
    users = [plan_rules.MIN_USERS, settings.performance_max_users]
    per_hour = settings.performance_starts_per_hour
    left: Optional[int] = None  # None: the limit is switched off
    if per_hour > 0:
        left = max(0, per_hour - starts_used(db, user_id, now)[0])
    ranges = plan_rules.FIELD_RANGES
    return {
        "baseline_users": users,
        "max_users": users,
        "step_users": users,
        "hold_seconds": list(ranges["hold_seconds"]),
        "limit_ms": list(ranges["limit_ms"]),
        "max_error_rate_pct": list(ranges["max_error_rate_pct"]),
        "follow_up_rate": list(ranges["follow_up_rate"]),
        "timeout_seconds": list(ranges["timeout_seconds"]),
        "users": users,
        "duration_seconds": [
            plan_rules.MIN_DURATION_SECONDS,
            settings.performance_max_duration_seconds,
        ],
        "max_total_seconds": settings.performance_max_duration_seconds,
        "starts_per_hour": per_hour,
        "starts_left": left,
    }


def plan_defaults() -> dict[str, Any]:
    """The values each test starts with: the sample run of the design."""
    shared = {"limit_ms": 180000, "max_error_rate_pct": 10, "timeout_seconds": 540}
    inputs = {
        "breakpoint": {
            **shared,
            "baseline_users": 5,
            "max_users": 60,
            "step_users": 10,
            "hold_seconds": 450,
        },
        "smoke": dict(shared),
        "soak": {**shared, "users": 20, "duration_seconds": 7200},
    }
    return {
        test_type: {
            "plan": plan_rules.normalize_input(test_type, values),
            "mix": dict(plan_rules.DEFAULT_MIX),
        }
        for test_type, values in inputs.items()
    }


def store_answers_default(is_production: bool) -> bool:
    """Answers are stored with the questions, except for a production target."""
    return not is_production


def setup(
    db: Session, project: Project, user_id: str, access: Access, now: datetime
) -> dict[str, Any]:
    """Everything the New run page needs except the datasets."""
    settings = PlatformSettings()
    runner = project_runner(db, project.id)
    blocked = blocked_reason(db, runner, now, settings)
    blocked_payload: Optional[dict[str, Any]] = None
    if blocked is not None:
        blocked_payload = {"code": blocked.code, "message": blocked.message}
        if "run_id" in blocked.details:
            blocked_payload["run_id"] = blocked.details["run_id"]
    result = {
        "server_time": to_api_timestamp(now),
        "runner": runner_status(db, runner, now, settings),
        "targets": targets.target_payloads(
            db,
            targets.list_targets(db, project.id, include_archived=False),
            now=now,
            can_write=access.can_start,
            is_manager=access.manager,
        ),
        "can_manage_targets": access.can_manage,
        "limits": plan_limits(db, user_id, now, settings),
        "defaults": plan_defaults(),
        "encryption_ready": targets.encryption_ready(),
        "store_answers_default": {
            "production": store_answers_default(True),
            "other": store_answers_default(False),
        },
        "blocked": blocked_payload,
    }

    if db.info.get("performance_platform_read"):
        from qym_platform.services.performance_platform_views import setup as platform_setup
        return platform_setup(db, project, result, now)
    return result


@dataclass(frozen=True)
class DatasetFacts:
    """What a run needs to know about the questions of one dataset version."""

    item_count: int
    tier_counts: dict[str, int]
    untiered: int
    single_kind: bool
    follow_ups: int


def item_kind() -> ColumnElement[str]:
    """Resolve a stored item's kind in SQL, for both counts and runner items.

    A valid tier wins over complexity. The result is always the lowercase
    word, so the runner gets ``simple`` for a stored ``" Simple "`` as well.
    """
    tier = func.lower(func.trim(DatasetItem.item_metadata["tier"].as_string()))
    complexity = func.lower(
        func.trim(DatasetItem.item_metadata["complexity"].as_string())
    )
    return case(
        (tier.in_(plan_rules.TIERS), tier),
        (complexity.in_(plan_rules.TIERS), complexity),
        else_=None,
    )


def facts_by_version(
    db: Session, version_ids: Sequence[Optional[str]]
) -> dict[str, DatasetFacts]:
    """Count the usable items of several versions per kind, in one statement.

    The kind is resolved by ``item_kind``; a follow-up is a
    ``metadata.follow_up`` that is not empty. The database
    counts, so no item is read. Disabled items are left out, as the runner's
    item route leaves them out. A version in which no item has a kind runs as
    one kind: all its questions count as ``medium``.
    """
    ids = sorted({version_id for version_id in version_ids if version_id})
    counted: dict[str, dict[str, int]] = {version_id: {} for version_id in ids}
    follow_ups = dict.fromkeys(ids, 0)
    if ids:
        follow_up = DatasetItem.item_metadata["follow_up"].as_string()
        kind = item_kind()
        has_follow_up = case(
            (func.coalesce(func.trim(follow_up), "") != "", 1), else_=0
        )
        rows = db.execute(
            select(
                DatasetItem.dataset_version_id,
                kind,
                func.count(DatasetItem.id),
                func.sum(has_follow_up),
            )
            .where(
                DatasetItem.dataset_version_id.in_(ids),
                DatasetItem.disabled_at.is_(None),
            )
            .group_by(DatasetItem.dataset_version_id, kind)
        ).all()
        for version_id, name, count, with_follow_up in rows:
            counted[version_id][name or ""] = int(count or 0)
            follow_ups[version_id] += int(with_follow_up or 0)
    facts = {}
    for version_id in ids:
        counts = {tier: counted[version_id].get(tier, 0) for tier in plan_rules.TIERS}
        tiered = sum(counts.values())
        total = tiered + counted[version_id].get("", 0)
        single_kind = total > 0 and tiered == 0
        if single_kind:
            counts["medium"] = total
        facts[version_id] = DatasetFacts(
            item_count=total,
            tier_counts=counts,
            untiered=total - tiered,
            single_kind=single_kind,
            follow_ups=follow_ups[version_id],
        )
    return facts


def dataset_facts(db: Session, version_id: str) -> DatasetFacts:
    """The counts of one version (see ``facts_by_version``)."""
    return facts_by_version(db, [version_id])[version_id]


NO_FACTS = DatasetFacts(0, {tier: 0 for tier in plan_rules.TIERS}, 0, False, 0)


def datasets_list(db: Session, project: Project) -> dict[str, Any]:
    """The project's datasets a run could use, in three statements whatever their number.

    Each with its latest published version, or ``None`` when it has only a
    draft; the counts are those of that version, or of the newest draft. A
    private test set and a restricted dataset are left out: the start route
    refuses them.
    """
    rows = db.execute(
        select(
            Dataset.id,
            Dataset.name,
            Dataset.slug,
            Dataset.updated_at,
            Dataset.created_by_user_id,
            DatasetVersion.id,
            DatasetVersion.version,
            DatasetVersion.status,
            DatasetVersion.published_at,
            DatasetVersion.created_at,
            DatasetVersion.updated_at,
            DatasetVersion.published_by_user_id,
            DatasetVersion.created_by_user_id,
        )
        .outerjoin(
            DatasetVersion,
            and_(
                DatasetVersion.dataset_id == Dataset.id,
                DatasetVersion.status.in_(
                    [DatasetVersionStatus.PUBLISHED, DatasetVersionStatus.DRAFT]
                ),
            ),
        )
        .where(
            Dataset.project_id == project.id,
            Dataset.deleted_at.is_(None),
            Dataset.private_test_set.is_(False),
            Dataset.access_mode != "restricted",
        )
        .order_by(func.lower(Dataset.name), Dataset.id)
    ).all()
    datasets: dict[str, dict[str, Any]] = {}
    for (
        dataset_id,
        name,
        slug,
        dataset_updated_at,
        dataset_creator,
        version_id,
        version,
        status,
        published_at,
        created_at,
        version_updated_at,
        publisher,
        version_creator,
    ) in rows:
        entry = datasets.setdefault(
            dataset_id,
            {
                "id": dataset_id,
                "name": name,
                "slug": slug,
                "updated_at": dataset_updated_at,
                "updated_by": dataset_creator,
                "version": None,
            },
        )
        if version_id is None:
            continue
        published = status == DatasetVersionStatus.PUBLISHED
        # A published version beats a draft; among equals the newest wins.
        moment = (published_at if published else None) or created_at or datetime.min
        rank = (published, moment, version_id)
        if entry["version"] is None or rank > entry["version"]["rank"]:
            entry["version"] = {
                "rank": rank,
                "id": version_id,
                "name": version,
                "published": published,
                "updated_at": max(
                    (
                        at
                        for at in (version_updated_at, published_at, created_at)
                        if at is not None
                    ),
                    default=None,
                ),
                "updated_by": (publisher if published else None) or version_creator,
            }
    facts = facts_by_version(
        db, [entry["version"]["id"] for entry in datasets.values() if entry["version"]]
    )
    names = targets.user_names(
        db,
        [
            (entry["version"] or entry)["updated_by"] or entry["updated_by"]
            for entry in datasets.values()
        ],
    )
    payload = []
    for entry in datasets.values():
        chosen = entry["version"]
        counts = facts[chosen["id"]] if chosen else NO_FACTS
        changed_by = (chosen["updated_by"] if chosen else None) or entry["updated_by"]
        changed_at = entry["updated_at"]
        newer = chosen["updated_at"] if chosen else None
        if newer is not None and (changed_at is None or newer > changed_at):
            changed_at = newer
        payload.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "slug": entry["slug"],
                "latest_published_version": (
                    {"id": chosen["id"], "name": chosen["name"]}
                    if chosen and chosen["published"]
                    else None
                ),
                "item_count": counts.item_count,
                "tier_counts": dict(counts.tier_counts),
                "follow_ups": counts.follow_ups,
                "single_kind": counts.single_kind,
                "updated_by": names.get(changed_by or ""),
                "updated_by_user_id": changed_by,
                "updated_at": to_api_timestamp(changed_at),
            }
        )
    return {"datasets": payload}


def dataset_version(
    db: Session, project_id: str, version_id: str
) -> Optional[tuple[Dataset, DatasetVersion]]:
    """A dataset version of this project with its dataset; ``None`` when there is none."""
    row = db.execute(
        select(Dataset, DatasetVersion)
        .join(DatasetVersion, DatasetVersion.dataset_id == Dataset.id)
        .where(
            DatasetVersion.id == version_id,
            Dataset.project_id == project_id,
            Dataset.deleted_at.is_(None),
        )
    ).first()
    return (row[0], row[1]) if row else None


def dataset_refusal(
    dataset: Dataset, version: DatasetVersion
) -> Optional[PerformanceError]:
    """Why a run cannot use this version, before its items are looked at."""
    status = (
        version.status.value
        if isinstance(version.status, DatasetVersionStatus)
        else str(version.status)
    )
    if status != DatasetVersionStatus.PUBLISHED.value:
        return PerformanceError(
            "dataset_not_published",
            422,
            f"{dataset.name} {version.version} is {'a draft' if status == 'draft' else status}. "
            "A run needs a published version, because a draft can still change.",
            {"status": status},
        )
    if bool(dataset.private_test_set):
        return PerformanceError(
            "dataset_not_allowed",
            422,
            f"{dataset.name} is a private test set. Its questions would be shown on the "
            "run page, so a run cannot use it.",
            {"reason": "private_test_set"},
        )
    if dataset.access_mode == "restricted":
        return PerformanceError(
            "dataset_not_allowed",
            422,
            f"{dataset.name} is restricted to some members. Its questions would be shown "
            "on the run page, so a run cannot use it.",
            {"reason": "restricted"},
        )
    return None


EMPTY_DATASET = "This dataset version has no questions."


def dataset_tiers(db: Session, project: Project, version_id: str) -> dict[str, Any]:
    """Counts per kind of one dataset version, for the mix and the "kind is empty" check."""
    found = dataset_version(db, project.id, version_id)
    if found is None:
        raise PerformanceError(
            "dataset_version_not_found", 404, "Dataset version not found"
        )
    dataset, version = found
    refusal = dataset_refusal(dataset, version)
    hidden = refusal is not None and refusal.code == "dataset_not_allowed"
    facts = NO_FACTS if hidden else dataset_facts(db, version.id)
    reason = refusal.message if refusal else None
    if reason is None and facts.item_count == 0:
        reason = EMPTY_DATASET
    return {
        "dataset_id": dataset.id,
        "dataset_version_id": version.id,
        "version": version.version,
        "published": version.status == DatasetVersionStatus.PUBLISHED,
        "item_count": facts.item_count,
        "tier_counts": facts.tier_counts,
        "untiered": facts.untiered,
        "single_kind": facts.single_kind,
        "follow_ups": facts.follow_ups,
        "usable": reason is None,
        "reason": reason,
    }


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


def get_run(db: Session, project_id: str, run_id: str) -> PerformanceRun:
    run = db.scalars(
        select(PerformanceRun).where(
            PerformanceRun.id == run_id, PerformanceRun.project_id == project_id
        )
    ).first()
    if run is None:
        raise PerformanceError("run_not_found", 404, "Run not found")
    return run


def report_path(project_slug: str, run_id: str) -> str:
    return f"/api/projects/{project_slug}/performance/runs/{run_id}/report"


def can_hand_off(
    access: Access, status: str, target: Optional[PerformanceTarget]
) -> bool:
    """The person may give this run a new token: as starting a run on its target."""
    return (
        access.can_start
        and status in state.ACTIVE_STATUSES
        and target is not None
        and (access.manager or not target.is_production)
    )


def run_read(
    db: Session, project: Project, run: PerformanceRun, access: Access, now: datetime
) -> dict[str, Any]:
    """The run page, live and finished."""
    settings = PlatformSettings()
    status = state.effective_status(run, now=now)
    target = db.get(PerformanceTarget, run.target_id) if run.target_id else None
    tokens = list(target.tokens) if target is not None else []
    runner = db.get(PerformanceRunner, run.runner_id)
    report = db.execute(
        select(
            PerformanceReport.byte_size,
            PerformanceReport.sha256,
            PerformanceReport.received_at,
        ).where(PerformanceReport.run_id == run.id)
    ).first()
    events = db.scalar(
        select(func.count(PerformanceEvent.id)).where(PerformanceEvent.run_id == run.id)
    )
    names = targets.user_names(
        db,
        [
            run.requested_by_user_id,
            run.stop_requested_by_user_id,
            *(token.updated_by_user_id for token in tokens),
        ],
    )
    row = run_row(
        run, now=now, names=names, reports={run.id} if report is not None else set()
    )
    row.update(
        stored_status=run.status,
        claimed_at=to_api_timestamp(run.claimed_at),
        last_report_at=to_api_timestamp(run.last_report_at),
        stop_requested_at=to_api_timestamp(run.stop_requested_at),
        stop_requested_by=names.get(run.stop_requested_by_user_id or ""),
        stop_requested_by_user_id=run.stop_requested_by_user_id,
        stop_reason=run.stop_reason,
        error=run.error,
        exit_code=run.exit_code,
    )
    summary = None
    if isinstance(run.summary, dict):
        summary = {
            key: value for key, value in run.summary.items() if key != "suite_summary"
        }
    runner_short = None
    if runner_registered(runner):
        seconds = _seconds_since(runner.last_heartbeat_at, now)
        runner_short = {
            "name": runner.name,
            "reported_state": runner.reported_state,
            "seconds_since_heartbeat": seconds,
            "fresh": runner_is_fresh(runner, now, settings),
            "stale": seconds is None
            or seconds >= settings.performance_stale_after_seconds,
        }
    late_until = (
        None
        if run.claim_instance_id is None
        else state.accepts_results_until(run, now=now)
    )
    result = {
        "server_time": to_api_timestamp(now),
        "run": row,
        "effective_status": status,
        "status_reason": status_reason(run, status, names),
        "config": _config(run),
        "progress": run.progress if run.progress else None,
        "seconds_since_report": _seconds_since(run.last_report_at, now),
        "runner": runner_short,
        "stop_requested": run.stop_requested_at is not None,
        "token_needed": run.token_needed,
        "tokens": [targets.token_hint(token, names, now) for token in tokens if token.token_encrypted],
        "summary": summary,
        "report": (
            None
            if report is None
            else {
                "byte_size": report.byte_size,
                "sha256": report.sha256,
                "received_at": to_api_timestamp(report.received_at),
                "expires_at": to_api_timestamp(
                    report.received_at
                    + timedelta(days=settings.performance_report_retention_days)
                ),
                "url": report_path(project.slug, run.id),
            }
        ),
        "report_expired": report is None and run.report_received_at is not None,
        "counts": {
            "questions_received": run.questions_received,
            "questions_dropped": run.questions_dropped,
            "log_lines_received": run.log_lines_received,
            "log_lines_dropped": run.log_lines_dropped,
            "events": int(events or 0),
        },
        "late_results_until": to_api_timestamp(late_until),
        "can": {
            "stop": access.writer and status in state.ACTIVE_STATUSES,
            "hand_off_token": can_hand_off(access, status, target),
        },
    }

    if run.target_kind == "estishraf_platform":
        from qym_platform.services.performance_platform_views import complete_run_read
        return complete_run_read(db, project, run, result, now)
    return result


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


@dataclass
class QuestionFilters:
    """Query of the questions table and of its CSV file."""

    after_seq: Optional[int] = None
    page: int = 1
    page_size: int = 50
    status: list[str] = field(default_factory=list)
    level: list[int] = field(default_factory=list)
    tier: list[str] = field(default_factory=list)
    followup: Optional[bool] = None
    no_data: Optional[bool] = None
    q: Optional[str] = None
    sort: str = "-seq"


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _question_conditions(run_id: str, filters: QuestionFilters) -> list[Any]:
    question = PerformanceQuestion
    conditions: list[Any] = [question.run_id == run_id]
    if filters.status:
        conditions.append(question.status.in_(filters.status))
    if filters.level:
        conditions.append(question.level.in_(filters.level))
    if filters.tier:
        conditions.append(question.tier.in_(filters.tier))
    if filters.followup is not None:
        conditions.append(question.is_followup.is_(filters.followup))
    if filters.no_data is not None:
        conditions.append(question.no_data.is_(filters.no_data))
    text = (filters.q or "").strip()
    digits = text.removeprefix("#")
    number = int(digits) if digits.isascii() and digits.isdigit() else None
    # seq is a database Integer; an out-of-range number cannot match a row.
    by_number = question.seq == number if number is not None and number <= 2_147_483_647 else false()
    if text.startswith("#") and number is not None:
        conditions.append(by_number)
    elif text:
        pattern = _like(text)
        conditions.append(
            or_(
                by_number,
                question.question.ilike(pattern, escape="\\"),
                question.answer.ilike(pattern, escape="\\"),
                question.question_id.ilike(pattern, escape="\\"),
            )
        )
    return conditions


def _question_order(sort: str) -> list[Any]:
    question = PerformanceQuestion
    name = sort.lstrip("-")
    if name == "seq":
        return [question.seq.desc() if sort.startswith("-") else question.seq.asc()]
    column = getattr(question, name)
    ordered = column.desc() if sort.startswith("-") else column.asc()
    return [ordered.nulls_last(), question.seq.asc()]


def question_row(row: PerformanceQuestion) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "asked_at": to_api_timestamp(row.asked_at),
        "elapsed_s": row.elapsed_s,
        "stage": row.stage,
        "level": row.level,
        "user": row.user_number,
        "tier": row.tier,
        "question_id": row.question_id,
        "is_followup": bool(row.is_followup),
        "question": row.question,
        "status": row.status,
        "http_status": row.http_status,
        "error_kind": row.error_kind,
        "duration_ms": row.duration_ms,
        "ttfb_ms": row.ttfb_ms,
        "quality": row.quality,
        "no_data": bool(row.no_data),
        "warmup": bool(row.warmup),
        "attempts": row.attempts,
        "answer": row.answer,
        "answer_truncated": bool(row.answer_truncated),
    }


def _question_facets(db: Session, run_id: str) -> tuple[dict[str, Any], int]:
    """Counts over the whole run and its highest ``seq``, in one statement."""
    question = PerformanceQuestion
    groups = db.execute(
        select(
            question.status,
            question.tier,
            question.level,
            question.error_kind,
            question.is_followup,
            question.no_data,
            func.count(question.id),
            func.max(question.seq),
        )
        .where(question.run_id == run_id)
        .group_by(
            question.status,
            question.tier,
            question.level,
            question.error_kind,
            question.is_followup,
            question.no_data,
        )
    ).all()
    statuses = {name: 0 for name in QUESTION_STATUSES}
    tiers = {name: 0 for name in plan_rules.TIERS}
    levels: dict[str, int] = {}
    error_kinds: dict[str, int] = {}
    followups = no_data = last_seq = 0
    for status, tier, level, error_kind, is_followup, has_no_data, count, seq in groups:
        statuses[status] = statuses.get(status, 0) + count
        tiers[tier] = tiers.get(tier, 0) + count
        key = "none" if level is None else str(level)
        levels[key] = levels.get(key, 0) + count
        if error_kind:
            error_kinds[error_kind] = error_kinds.get(error_kind, 0) + count
        if is_followup:
            followups += count
        if has_no_data:
            no_data += count
        last_seq = max(last_seq, seq or 0)
    facets = {
        "statuses": statuses,
        "tiers": tiers,
        "levels": levels,
        "error_kinds": error_kinds,
        "followups": followups,
        "no_data": no_data,
    }
    return facets, last_seq


def questions_page(
    db: Session, run: PerformanceRun, filters: QuestionFilters
) -> dict[str, Any]:
    """A page of asked questions, or with ``after_seq`` the rows that came since, oldest first."""
    question = PerformanceQuestion
    conditions = _question_conditions(run.id, filters)
    total = db.scalar(select(func.count(question.id)).where(*conditions))
    query = select(question).where(*conditions)
    page = filters.page
    if filters.after_seq is not None:
        page = 1
        query = query.where(question.seq > filters.after_seq).order_by(
            question.seq.asc()
        )
    else:
        query = query.order_by(*_question_order(filters.sort)).offset(
            (filters.page - 1) * filters.page_size
        )
    rows = db.scalars(query.limit(filters.page_size)).all()
    facets, last_seq = _question_facets(db, run.id)
    return {
        "rows": [question_row(row) for row in rows],
        "total": int(total or 0),
        "page": page,
        "page_size": filters.page_size,
        "last_seq": last_seq,
        "facets": facets,
    }


def csv_safe(value: str) -> str:
    """Keep a spreadsheet from reading a cell as a formula."""
    if value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def questions_export(
    db: Session, run: PerformanceRun, filters: QuestionFilters
) -> Iterator[list[str]]:
    """Every matching question as CSV rows, read from one cursor in chunks."""
    yield list(CSV_COLUMNS)
    rows = db.scalars(
        select(PerformanceQuestion)
        .where(*_question_conditions(run.id, filters))
        .order_by(*_question_order(filters.sort))
        .execution_options(yield_per=500)
    )
    for row in rows:
        values = question_row(row)
        yield [
            csv_safe("" if values[name] is None else str(values[name]))
            for name in CSV_COLUMNS
        ]


# ---------------------------------------------------------------------------
# Log and events
# ---------------------------------------------------------------------------


@dataclass
class LogFilters:
    after_seq: int = 0
    limit: int = 500
    level: list[str] = field(default_factory=list)
    q: Optional[str] = None


def _log_conditions(run_id: str, filters: LogFilters) -> list[Any]:
    conditions: list[Any] = [PerformanceLogLine.run_id == run_id]
    if filters.level:
        conditions.append(PerformanceLogLine.level.in_(filters.level))
    text = (filters.q or "").strip()
    if text:
        conditions.append(PerformanceLogLine.message.ilike(_like(text), escape="\\"))
    return conditions


def log_page(db: Session, run: PerformanceRun, filters: LogFilters) -> dict[str, Any]:
    """Log lines in ``seq`` order after ``after_seq``; ``next_after_seq`` says there is more."""
    line = PerformanceLogLine
    conditions = _log_conditions(run.id, filters)
    total = db.scalar(select(func.count(line.id)).where(*conditions))
    last_seq = db.scalar(select(func.max(line.seq)).where(line.run_id == run.id))
    rows = db.scalars(
        select(line)
        .where(*conditions, line.seq > filters.after_seq)
        .order_by(line.seq.asc())
        .limit(filters.limit + 1)
    ).all()
    more = len(rows) > filters.limit
    rows = rows[: filters.limit]
    return {
        "lines": [
            {
                "seq": row.seq,
                "at": to_api_timestamp(row.at),
                "level": row.level,
                "message": row.message,
            }
            for row in rows
        ],
        "next_after_seq": rows[-1].seq if more and rows else None,
        "last_seq": int(last_seq or 0),
        "total": int(total or 0),
        "dropped": int(run.log_lines_dropped or 0),
    }


def log_text(db: Session, run: PerformanceRun) -> Iterator[str]:
    """The whole log as text, one line per entry, read from one cursor in chunks."""
    rows = db.execute(
        select(
            PerformanceLogLine.at, PerformanceLogLine.level, PerformanceLogLine.message
        )
        .where(PerformanceLogLine.run_id == run.id)
        .order_by(PerformanceLogLine.seq.asc())
        .execution_options(yield_per=1000)
    )
    for at, level, message in rows:
        text = str(message).replace("\r", " ").replace("\n", " ")
        yield f"{to_api_timestamp(at)} {str(level).upper():<7} {text}\n"


def event_payload(row: PerformanceEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "at": to_api_timestamp(row.at),
        "level": row.level,
        "code": row.code,
        "message": row.message,
        "details": redact_details(row.details if isinstance(row.details, dict) else {}),
        "source": row.source,
        "run_id": row.run_id,
    }


def run_events(db: Session, run: PerformanceRun) -> dict[str, Any]:
    """The run's timeline, oldest first (the newest ``RUN_EVENTS_MAX`` entries)."""
    rows = db.scalars(
        select(PerformanceEvent)
        .where(PerformanceEvent.run_id == run.id)
        .order_by(PerformanceEvent.at.desc(), PerformanceEvent.id.desc())
        .limit(RUN_EVENTS_MAX)
    ).all()
    return {"events": [event_payload(row) for row in reversed(rows)]}


# ---------------------------------------------------------------------------
# The Runner page
# ---------------------------------------------------------------------------


def runner_key_payload(
    db: Session, runner: Optional[PerformanceRunner], key: Optional[ApiKey]
) -> Optional[dict[str, Any]]:
    """The chosen runner key with who chose it and when; never the key itself."""
    if runner is None or key is None:
        return None
    names = targets.user_names(db, [runner.runner_key_changed_by_user_id])
    return {
        "id": key.id,
        "name": key.name,
        "prefix": key.prefix,
        "changed_at": to_api_timestamp(runner.runner_key_changed_at),
        "changed_by": names.get(runner.runner_key_changed_by_user_id or ""),
        "changed_by_user_id": runner.runner_key_changed_by_user_id,
    }


def runner_path(project_id: str, key: str) -> str:
    return f"/v1/projects/{project_id}/performance/runners/{key}"


def runner_page(
    db: Session, project: Project, access: Access, now: datetime
) -> dict[str, Any]:
    """The Runner page: status, the key that receives the tokens, how to connect."""
    settings = PlatformSettings()
    runner = project_runner(db, project.id)
    keys = []
    if access.manager:
        keys = db.scalars(
            select(ApiKey)
            .where(
                ApiKey.project_id == project.id,
                ApiKey.revoked_at.is_(None),
                ApiKey.kind == "user",
            )
            .order_by(ApiKey.name, ApiKey.id)
        ).all()
    return {
        "server_time": to_api_timestamp(now),
        "runner": runner_status(db, runner, now, settings),
        "runner_key": runner_key_payload(db, runner, runner_key(db, runner)),
        "api_keys": [
            {"id": key.id, "name": key.name, "prefix": key.prefix} for key in keys
        ],
        "active_run": _active_payload(db, project.id, now),
        # How many problems and notes the runner has: the Events table's loading rows follow it (§7).
        "events_total": (
            int(
                db.scalar(
                    select(func.count(PerformanceEvent.id)).where(
                        PerformanceEvent.runner_id == runner.id
                    )
                )
                or 0
            )
            if runner is not None
            else 0
        ),
        "settings": {
            "fresh_within_s": settings.performance_runner_fresh_seconds,
            "stale_after_s": settings.performance_stale_after_seconds,
            "queue_timeout_s": settings.performance_queue_timeout_seconds,
            "late_window_s": settings.performance_late_window_seconds,
        },
        "connect": {
            "project_id": project.id,
            "runner_path": runner_path(
                project.id, runner.key if runner is not None else DEFAULT_RUNNER_KEY
            ),
        },
        "can_manage": access.can_manage,
    }


def runner_events(
    db: Session,
    project: Project,
    *,
    page: int,
    limit: int,
    levels: Sequence[str],
    q: Optional[str] = None,
) -> dict[str, Any]:
    """The runner's problems and notes, newest first; `q` looks in the message (case-insensitive)."""
    runner = project_runner(db, project.id)
    if runner is None:
        return {"events": [], "total": 0, "page": page, "limit": limit}
    conditions = [PerformanceEvent.runner_id == runner.id]
    if levels:
        conditions.append(PerformanceEvent.level.in_(levels))
    if q and q.strip():
        conditions.append(PerformanceEvent.message.ilike(_like(q.strip()), escape="\\"))
    total = db.scalar(select(func.count(PerformanceEvent.id)).where(*conditions))
    rows = db.scalars(
        select(PerformanceEvent)
        .where(*conditions)
        .order_by(PerformanceEvent.at.desc(), PerformanceEvent.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    return {
        "events": [event_payload(row) for row in rows],
        "total": int(total or 0),
        "page": page,
        "limit": limit,
    }
