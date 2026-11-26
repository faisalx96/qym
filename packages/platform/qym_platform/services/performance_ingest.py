"""Store what the performance runner reports (docs/performance-runner-protocol-v1.0.md).

The runner routes in ``api/performance_ingest.py`` call these functions. Each
takes qym's receive time as ``now`` (naive UTC) and leaves the commit to its
caller. A refusal is a ``PerformanceError`` with the code and the exact words of
guide section 7; every check comes before the first write, so a refused request
changes nothing.
"""

from __future__ import annotations

import hashlib
import json
import zlib
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from cryptography.fernet import InvalidToken
from qym_platform import secrets as secret_storage
from qym_platform.auth import Principal
from qym_platform.datetime_utils import to_api_timestamp, to_storage_utc, utc_now_naive
from qym_platform.db.models import (
    PERFORMANCE_TOKEN_NAMES,
    AuditLog,
    DatasetItem,
    PerformanceEvent,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceReport,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTargetToken,
    Project,
)
from qym_platform.services import (
    performance_control,
    performance_redaction,
    performance_state,
    performance_views,
)
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.settings import PlatformSettings
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from qym_platform.api.performance_ingest import (
        PerformanceEventBody,
        PerformanceLogLineBody,
        PerformanceQuestionRecordBody,
        PerformanceSummaryHeadlineBody,
    )

# code -> (HTTP status, exact detail); guide section 7.
REFUSALS: dict[str, tuple[int, str]] = {
    "runner_not_found": (404, "performance runner not found"),
    "run_not_found": (404, "performance run not found"),
    "runner_limit_reached": (409, "this project already has a runner"),
    "instance_mismatch": (409, "another runner process holds this runner or run"),
    "run_not_queued": (409, "run is not waiting to be claimed"),
    "run_not_claimed": (409, "run has not been claimed"),
    "stop_requested": (409, "stop requested"),
    "run_finished": (409, "run already finished"),
    "run_closed": (409, "run no longer accepts results"),
    "invalid_transition": (409, "status cannot follow the current status"),
    "token_version_conflict": (409, "a newer token is saved"),
    "tokens_not_disclosed": (403, "this API key is not the runner key"),
    "counters_must_not_decrease": (422, "counters must not decrease"),
    "too_many_records": (422, "too many records"),
    "too_many_lines": (422, "too many lines"),
    "too_many_events": (422, "too many events"),
    "report_not_utf8": (422, "report is not UTF-8"),
    "contains_token": (422, "the body contains a sign-in token"),
    "secret_cannot_be_decrypted": (500, "secret cannot be decrypted"),
}

# Which reported status may follow which stored status (guide 2.2). Nothing
# returns to ``queued``, and ``finished`` never follows ``starting``.
FOLLOWS: dict[str, tuple[str, ...]] = {
    "starting": ("starting", "running", "stopping", "stopped", "failed", "interrupted"),
    "running": ("running", "stopping", "finished", "stopped", "failed", "interrupted"),
    "stopping": ("stopping", "finished", "stopped", "failed", "interrupted"),
}

ANSWER_COUNTERS = ("sent", "finished", "ok", "errors", "interrupted")
# Heartbeat states in which the runner is working on the run it names.
WORKING_STATES = ("preflight", "running", "stopping", "finishing")
ERROR_CHARS_MAX = 2000
NAME_CHARS_MAX = 200
QUESTION_ID_CHARS_MAX = 200
# qym's event that holds the highest seq counted as dropped, per stream.
LIMIT_EVENTS = {
    "steps": "steps_limit_reached",
    "questions": "questions_limit_reached",
    "log lines": "log_limit_reached",
}
HEADLINE_COLUMNS = (
    "safe_load_users",
    "breaking_level_users",
    "breaking_reason",
    "recommended_max_users",
    "p95_at_safe_load_ms",
    "answers_measured",
    "answers_total",
    "errors_total",
    "error_rate_pct",
    "p95_ms",
    "ttfb_p95_ms",
    "max_users",
    "duration_s",
    "quality_mean",
)
REPORT_CONTENT_TYPE = "text/html; charset=utf-8"
REPLACED_MESSAGE = "A new runner process took over; the run was ended"


def utcnow() -> datetime:
    """Return qym's receive time as naive UTC."""
    return utc_now_naive()


def refusal(code: str, details: Optional[dict[str, Any]] = None) -> PerformanceError:
    """The refusal ``code`` with its status and exact words."""
    status, message = REFUSALS[code]
    return PerformanceError(code, status, message, details)


def _strip_nul(value: str) -> str:
    return value.replace("\x00", "")


def _is_count(value: Any) -> bool:
    return type(value) is int and value >= 0


# --------------------------------------------------------------------------- lookups


def find_runner(
    db: Session, project_id: str, key: str, *, lock: bool = False
) -> Optional[PerformanceRunner]:
    """The runner row of a runner key, optionally locked for a write."""
    query = select(PerformanceRunner).where(
        PerformanceRunner.project_id == project_id, PerformanceRunner.key == key
    )
    if lock:
        # The row as committed by whoever held the lock before, not a copy read earlier.
        query = query.with_for_update().execution_options(populate_existing=True)
    return db.scalars(query).first()


def registered_runner(
    db: Session, project_id: str, key: str, instance: str, *, lock: bool = False
) -> PerformanceRunner:
    """The runner for a runner route: registered, and by this very process."""
    runner = find_runner(db, project_id, key, lock=lock)
    if runner is None or runner.registered_at is None:
        raise refusal("runner_not_found")
    if runner.instance_id != instance:
        raise refusal("instance_mismatch")
    return runner


def find_run(
    db: Session, project_id: str, key: str, run_id: str, *, lock: bool = False
) -> tuple[PerformanceRunner, PerformanceRun]:
    """A run of the runner key in the path; unknown runs and runs of another runner are 404."""
    runner = find_runner(db, project_id, key)
    if runner is None:
        raise refusal("run_not_found")
    query = select(PerformanceRun).where(
        PerformanceRun.id == run_id, PerformanceRun.runner_id == runner.id
    )
    if lock:
        query = query.with_for_update()
    run = db.scalars(query).first()
    if run is None:
        raise refusal("run_not_found")
    return runner, run


def require_claimer(run: PerformanceRun, instance: str) -> None:
    """Only the instance that claimed a run may speak for it."""
    if run.claim_instance_id is None:
        raise refusal("run_not_claimed")
    if run.claim_instance_id != instance:
        raise refusal("instance_mismatch")


def require_results_open(run: PerformanceRun, instance: str, now: datetime) -> None:
    """Results are taken from the claimer while the run is going on and in the late window."""
    require_claimer(run, instance)
    if not performance_state.accepts_results(run, now=now):
        raise refusal("run_closed")


# --------------------------------------------------------------------------- runner


def register_runner(
    db: Session,
    *,
    project_id: str,
    key: str,
    instance: str,
    name: str,
    info: dict[str, Any],
    principal: Principal,
    now: datetime,
) -> tuple[PerformanceRunner, bool, Optional[str]]:
    """Register a runner process; returns ``(runner, first registration, interrupted run id)``.

    A project has one runner. A row that was made when a Manager chose the
    runner key before any runner connected is taken over, whatever its key. A new
    instance ends the run an earlier instance had claimed as ``interrupted`` in
    the same transaction; the same instance registering again ends nothing.
    """
    # One registration per project at a time, so two keys cannot both be first.
    db.execute(select(Project.id).where(Project.id == project_id).with_for_update())
    rows = db.scalars(
        select(PerformanceRunner)
        .where(PerformanceRunner.project_id == project_id)
        .order_by(PerformanceRunner.created_at, PerformanceRunner.id)
        .with_for_update()
    ).all()
    masker = performance_redaction.masker(db, project_id=project_id)
    name = masker.text(name)[:NAME_CHARS_MAX]
    runner = next((row for row in rows if row.key == key), None)
    if runner is None:
        runner = next((row for row in rows if row.registered_at is None), None)
        if runner is not None:
            runner.key = key
        elif rows:
            raise refusal("runner_limit_reached")
        else:
            runner = PerformanceRunner(
                project_id=project_id, key=key, name=name, info={}
            )
            db.add(runner)
    first = runner.registered_at is None
    if first:
        runner.created_at = now

    interrupted_run_id = None
    if runner.instance_id != instance:
        if runner.id is not None:
            run = db.scalars(
                select(PerformanceRun)
                .where(
                    PerformanceRun.runner_id == runner.id,
                    PerformanceRun.status.in_(performance_state.CLAIMED_STATUSES),
                )
                .with_for_update()
            ).first()
            if run is not None:
                ended_by_silence = performance_state.end_if_stale(db, run, now=now)
                if run.status == "interrupted":
                    interrupted_run_id = run.id
                # Still going on: this registration ends it.
                if not ended_by_silence and (
                    run.status in performance_state.CLAIMED_STATUSES
                ):
                    interrupted_run_id = run.id
                    performance_state.finish_run(
                        run,
                        status="interrupted",
                        at=now,
                        error=run.error or REPLACED_MESSAGE,
                        reason="runner_restarted",
                    )
                    performance_state.add_event(
                        db,
                        runner_id=runner.id,
                        run_id=run.id,
                        at=now,
                        code="interrupted",
                        level="error",
                        message=REPLACED_MESSAGE,
                    )
        runner.reported_state = "idle"
        runner.current_run_id = None

    from qym_platform.services import performance_platform as platform

    if platform.KIND not in info.get("supported_target_kinds", ["chat"]) and runner.id:
        for queued in db.scalars(
            select(PerformanceRun)
            .where(
                PerformanceRun.runner_id == runner.id,
                PerformanceRun.status == "queued",
                PerformanceRun.target_kind == platform.KIND,
            )
            .with_for_update()
        ):
            performance_state.finish_run(
                queued,
                status="failed",
                at=now,
                error=platform.MESSAGES["runner_kind_unsupported"],
                reason="runner_kind_unsupported",
            )
    runner.name = name
    sanitized_info = masker.json(performance_redaction.drop_credential_keys(info))
    if "supported_target_kinds" in info:
        # Validated protocol literals must survive values that also occur in cookies.
        sanitized_info["supported_target_kinds"] = info["supported_target_kinds"]
    runner.info = sanitized_info
    runner.instance_id = instance
    runner.registered_at = now
    runner.registered_key_id = principal.api_key_id
    runner.last_heartbeat_at = now
    runner.updated_at = now
    db.flush()
    return runner, first, interrupted_run_id


def runner_payload(
    db: Session,
    runner: PerformanceRunner,
    principal: Principal,
    interrupted_run_id: Optional[str],
) -> dict[str, Any]:
    """The answer to a registration."""
    return {
        "id": runner.id,
        "key": runner.key,
        "name": runner.name,
        "info": runner.info,
        "instance_id": runner.instance_id,
        "tokens_disclosed": performance_control.is_chosen_key(db, runner, principal),
        "interrupted_run_id": interrupted_run_id,
        "created_at": to_api_timestamp(runner.created_at),
        "registered_at": to_api_timestamp(runner.registered_at),
    }


def record_heartbeat(
    db: Session,
    runner: PerformanceRunner,
    *,
    state: str,
    run_id: Optional[str],
    now: datetime,
) -> None:
    """Move the runner's heartbeat; a sign of life for the run it names and works on.

    Only a heartbeat whose ``run_id`` is the run this instance claimed and whose
    ``state`` is not ``idle`` keeps that run alive: a runner that went back to
    idle, or works on something else, has left the run, which then ends by the
    silence rule. A run that was already silent for the stale limit is ended
    here, never revived. A ``run_id`` that is not a run of this runner is not
    kept.
    """
    runner.last_heartbeat_at = now
    runner.reported_state = state
    run = db.scalars(
        select(PerformanceRun)
        .where(
            PerformanceRun.runner_id == runner.id,
            PerformanceRun.status.in_(performance_state.CLAIMED_STATUSES),
            PerformanceRun.claim_instance_id == runner.instance_id,
        )
        .with_for_update()
    ).first()
    own = run_id is not None and (
        (run is not None and run.id == run_id)
        or db.scalar(
            select(PerformanceRun.id).where(
                PerformanceRun.id == run_id, PerformanceRun.runner_id == runner.id
            )
        )
        is not None
    )
    runner.current_run_id = run_id if own else None
    if run is None or performance_state.end_if_stale(db, run, now=now):
        return
    if (
        run.status in performance_state.CLAIMED_STATUSES
        and run.id == run_id
        and state in WORKING_STATES
    ):
        run.last_seen_at = now


# --------------------------------------------------------------------------- claim


def claim_run(
    db: Session, run: PerformanceRun, *, instance: str, now: datetime
) -> PerformanceRun:
    """Give a queued run to ``instance``, once.

    The write is conditional on ``queued``, so of two claims exactly one wins.
    The winner asking again gets the same answer while the run is not final;
    every other claim is refused, and no claim ever resumes a run.
    """
    from qym_platform.services import performance_platform as platform

    if run.target_kind == platform.KIND:
        platform.require_capability(db.get(PerformanceRunner, run.runner_id))
    if run.status == "queued":
        result = db.execute(
            update(PerformanceRun)
            .where(PerformanceRun.id == run.id, PerformanceRun.status == "queued")
            .values(
                status="starting",
                claimed_at=now,
                claim_instance_id=instance,
                last_seen_at=now,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        db.refresh(run)
        if result.rowcount == 1:
            performance_state.add_event(
                db,
                runner_id=run.runner_id,
                run_id=run.id,
                at=now,
                code="claimed",
                message="The runner took the run",
            )
            return run
    if (
        run.claim_instance_id == instance
        and run.status in performance_state.CLAIMED_STATUSES
    ):
        return run
    raise refusal("run_not_queued")


def claim_payload(run: PerformanceRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "status": run.status,
        "claimed_at": to_api_timestamp(run.claimed_at),
    }


# --------------------------------------------------------------------------- progress


def check_progress_shape(progress: dict[str, Any]) -> None:
    """Check the fields of guide 4.3 that qym reads; unknown keys are kept.

    Raises ``ValueError`` with one short sentence.
    """
    try:
        json.dumps(progress, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise ValueError("progress must be finite JSON") from None
    answers = progress.get("answers")
    if answers is not None:
        if not isinstance(answers, dict):
            raise ValueError("answers must be an object")
        for name in ANSWER_COUNTERS:
            value = answers.get(name)
            if value is not None and not _is_count(value):
                raise ValueError(f"answers.{name} must be a whole number, 0 or more")
    kinds = progress.get("errors_by_kind")
    if kinds is not None:
        if not isinstance(kinds, dict) or not all(
            _is_count(value) for value in kinds.values()
        ):
            raise ValueError("errors_by_kind must be an object of whole numbers")
    levels = progress.get("levels")
    if levels is not None:
        if not isinstance(levels, list):
            raise ValueError("levels must be a list")
        seen = set()
        for entry in levels:
            if not isinstance(entry, dict) or not _is_count(entry.get("level")):
                raise ValueError("every entry of levels needs a whole-number level")
            if entry["level"] in seen:
                raise ValueError("levels must not repeat a level")
            seen.add(entry["level"])
            if entry.get("answers") is not None and not _is_count(entry["answers"]):
                raise ValueError("levels[].answers must be a whole number, 0 or more")
    waiting = progress.get("waiting_for_token")
    if waiting is not None and waiting not in PERFORMANCE_TOKEN_NAMES:
        raise ValueError("waiting_for_token must be a token name or null")
    auth = progress.get("auth")
    if auth is not None:
        if not isinstance(auth, dict):
            raise ValueError("auth must be an object")
        versions = auth.get("token_versions")
        if versions is not None and (
            not isinstance(versions, dict)
            or not all(_is_count(value) for value in versions.values())
        ):
            raise ValueError("auth.token_versions must be an object of whole numbers")


def _went_down(before: Any, after: Any) -> bool:
    return _is_count(before) and (after if _is_count(after) else 0) < before


def counters_decreased(old: dict[str, Any], new: dict[str, Any]) -> bool:
    """True when a counter that only rises went down, or a level disappeared."""
    old_answers = old.get("answers") if isinstance(old.get("answers"), dict) else {}
    new_answers = new.get("answers") if isinstance(new.get("answers"), dict) else {}
    if any(
        _went_down(old_answers.get(name), new_answers.get(name))
        for name in ANSWER_COUNTERS
    ):
        return True
    old_kinds = (
        old.get("errors_by_kind") if isinstance(old.get("errors_by_kind"), dict) else {}
    )
    new_kinds = (
        new.get("errors_by_kind") if isinstance(new.get("errors_by_kind"), dict) else {}
    )
    if any(_went_down(value, new_kinds.get(kind)) for kind, value in old_kinds.items()):
        return True
    new_levels = {
        entry.get("level"): entry
        for entry in (new.get("levels") or [])
        if isinstance(entry, dict)
    }
    for entry in old.get("levels") or []:
        if not isinstance(entry, dict):
            continue
        current = new_levels.get(entry.get("level"))
        if current is None or _went_down(entry.get("answers"), current.get("answers")):
            return True
    return False


def final_reason(run: PerformanceRun, status: str) -> Optional[str]:
    """Why a run ends with the final status its runner reports (``status_reason``).

    ``finished`` has no reason: the test ran to its own end, also when a stop
    was on its way. ``stopped`` is a person's stop when one was requested.
    ``failed`` before the first ``running`` report is a failed pre-flight,
    afterwards the suite broke. ``interrupted`` from the runner itself is its
    shutdown.
    """
    if status == "stopped":
        return "stopped_by_person" if run.stop_requested_at is not None else None
    if status == "failed":
        return "preflight_failed" if run.started_at is None else "k6_failed"
    if status == "interrupted":
        return "runner_shutdown"
    return None


def _apply_token_request(
    db: Session, run: PerformanceRun, progress: dict[str, Any]
) -> None:
    """Ask a person for a token only when nothing newer than the runner's is saved."""
    name = progress.get("waiting_for_token")
    if name is None:
        run.token_needed = None
        return
    auth = progress.get("auth") if isinstance(progress.get("auth"), dict) else {}
    held = (auth.get("token_versions") or {}).get(name)
    saved = performance_control.token_versions(db, run.target_id).get(name)
    if saved is None or held == saved:
        run.token_needed = name


def report_progress(
    db: Session,
    run: PerformanceRun,
    *,
    instance: str,
    seq: int,
    status: str,
    progress: dict[str, Any],
    error: Optional[str],
    exit_code: Optional[int],
    now: datetime,
) -> dict[str, Any]:
    """Apply one progress report of the claiming instance and build its answer.

    A report that is not newer than the stored one is ignored (``accepted`` is
    false). An accepted or ignored report is a sign of life; a refused one is not.
    """
    from qym_platform.services import (
        performance_platform as platform,
        performance_platform_ingest as platform_ingest,
    )

    if run.target_kind == platform.KIND:
        if progress and progress.get("target_kind") != platform.KIND:
            raise platform.refusal("wrong_target_kind")
        if seq > run.progress_seq:
            platform_ingest.check_progress(run, progress, status)
    elif progress.get("target_kind") == platform.KIND:
        raise platform.refusal("wrong_target_kind")
    require_claimer(run, instance)
    if run.status in performance_state.TERMINAL_STATUSES:
        raise refusal("run_finished", {"status": run.status})
    accepted = seq > run.progress_seq
    if accepted:
        if status in ("starting", "running") and run.stop_requested_at is not None:
            raise refusal("stop_requested")
        if status not in FOLLOWS[run.status]:
            raise refusal("invalid_transition")
        if progress and counters_decreased(run.progress or {}, progress):
            raise refusal("counters_must_not_decrease")
        if status == "finished" and run.started_at is None:
            # It never reported running, so it cannot have run to its end: a stop
            # (``stopping`` came first) ended it.
            status = "stopped"
        masker = performance_redaction.masker(db, target_id=run.target_id)
        # An empty object carries no numbers: it never wipes the last ones.
        if progress or not run.progress:
            run.progress = (
                platform_ingest.sanitize(progress, masker)
                if run.target_kind == platform.KIND
                else masker.json(progress)
            )
        run.progress_seq = seq
        run.last_report_at = now
        if status == "running" and run.started_at is None:
            run.started_at = now
        if exit_code is not None:
            run.exit_code = exit_code
        if progress:
            _apply_token_request(db, run, progress)
        text = None
        if error is not None and status in ("failed", "interrupted", "stopped"):
            text = masker.text(_strip_nul(error))[:ERROR_CHARS_MAX]
        if status in performance_state.TERMINAL_STATUSES:
            run.status_reason = final_reason(run, status)
            performance_state.finish_run(run, status=status, at=now, error=text)
        else:
            run.status = status
    run.last_seen_at = now
    db.flush()
    return {
        "id": run.id,
        "status": run.status,
        "accepted": accepted,
        "stop_requested": run.stop_requested_at is not None,
        "stop_reason": run.stop_reason,
        "token_needed": run.token_needed,
        "token_versions": performance_control.token_versions(db, run.target_id),
    }


# --------------------------------------------------------------------------- records


def _stored_seqs(db: Session, model: Any, run_id: str, seqs: list[int]) -> set[int]:
    if not seqs:
        return set()
    return set(
        db.scalars(select(model.seq).where(model.run_id == run_id, model.seq.in_(seqs)))
    )


def _new_drops(
    db: Session,
    run: PerformanceRun,
    *,
    what: str,
    limit: int,
    seqs: list[int],
    now: Optional[datetime],
) -> int:
    """How many of the dropped ``seqs`` were not counted before.

    A dropped record is never stored, so its resend would be dropped again. qym
    keeps the highest ``seq`` it counted as dropped in its own event on the run
    (written at the first drop) and counts a drop only above it. The caller
    holds the run's row lock.
    """
    if not seqs:
        return 0
    code = LIMIT_EVENTS[what]
    mark = db.scalars(
        select(PerformanceEvent).where(
            PerformanceEvent.run_id == run.id,
            PerformanceEvent.code == code,
            PerformanceEvent.source == "qym",
        )
    ).first()
    through = (mark.details or {}).get("dropped_through_seq", 0) if mark else 0
    highest = max(seqs)
    if mark is None:
        performance_state.add_event(
            db,
            runner_id=run.runner_id,
            run_id=run.id,
            at=now or utcnow(),
            code=code,
            level="warning",
            message=(
                f"The run reached its limit of {limit:,} {what}; "
                "later ones are counted as dropped, not stored"
            ),
            details={"limit": limit, "dropped_through_seq": highest},
        )
    elif highest > through:
        mark.details = {**(mark.details or {}), "dropped_through_seq": highest}
    return len({seq for seq in seqs if seq > through})


def store_questions(
    db: Session,
    run: PerformanceRun,
    records: list["PerformanceQuestionRecordBody"],
    settings: PlatformSettings,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Store question records; identity is ``(run_id, seq)``.

    A ``seq`` that is already stored is a duplicate and is left as it is. Above
    the per-run limit a record is answered as dropped and not stored; the run
    counts each dropped ``seq`` once, also when its batch is sent again. Text
    is cut, NULs are removed, and no answer is kept when the run was started
    without answers.
    """
    masker = performance_redaction.masker(db, target_id=run.target_id)
    options = (run.config or {}).get("options") or {}
    keep_answers = options.get("store_answers") is not False
    known = _stored_seqs(
        db, PerformanceQuestion, run.id, [record.seq for record in records]
    )
    room = settings.performance_questions_per_run_max - run.questions_received
    report: dict[str, Any] = {
        "accepted": 0,
        "duplicates": 0,
        "rejected": 0,
        "dropped": 0,
        "results": [],
    }

    dropped: list[int] = []

    def note(record: "PerformanceQuestionRecordBody", status: str) -> None:
        report["results"].append({"seq": record.seq, "status": status, "error": None})

    for record in records:
        if record.seq in known:
            report["duplicates"] += 1
            note(record, "duplicate")
            continue
        if room <= 0:
            report["dropped"] += 1
            dropped.append(record.seq)
            note(record, "dropped")
            continue
        known.add(record.seq)
        room -= 1
        question = masker.exact(_strip_nul(record.question))
        answer = record.answer if keep_answers else None
        cut = False
        if answer is not None:
            answer = masker.exact(_strip_nul(answer))
            cut = len(answer) > settings.performance_answer_chars_max
            answer = answer[: settings.performance_answer_chars_max]
        db.add(
            PerformanceQuestion(
                run_id=run.id,
                seq=record.seq,
                asked_at=to_storage_utc(record.asked_at),
                elapsed_s=record.elapsed_s,
                stage=record.stage,
                level=record.level,
                user_number=record.user,
                tier=record.tier,
                question_id=masker.text(_strip_nul(record.question_id))[
                    :QUESTION_ID_CHARS_MAX
                ],
                is_followup=record.is_followup,
                question=question[: settings.performance_question_chars_max],
                status=record.status,
                http_status=record.http_status,
                error_kind=record.error_kind,
                duration_ms=record.duration_ms,
                ttfb_ms=record.ttfb_ms,
                quality=record.quality,
                no_data=record.no_data,
                warmup=record.warmup,
                attempts=record.attempts,
                answer=answer,
                answer_truncated=record.answer_truncated or cut,
            )
        )
        report["accepted"] += 1
        note(record, "created")
    run.questions_received += report["accepted"]
    run.questions_dropped += _new_drops(
        db,
        run,
        what="questions",
        limit=settings.performance_questions_per_run_max,
        seqs=dropped,
        now=now,
    )
    db.flush()
    return report


def store_log_lines(
    db: Session,
    run: PerformanceRun,
    lines: list["PerformanceLogLineBody"],
    settings: PlatformSettings,
    now: Optional[datetime] = None,
) -> dict[str, int]:
    """Store log lines, masked and cut; identity is ``(run_id, seq)``.

    Dropped lines are counted as for questions: each ``seq`` once.
    """
    masker = performance_redaction.masker(db, target_id=run.target_id)
    known = _stored_seqs(db, PerformanceLogLine, run.id, [line.seq for line in lines])
    room = settings.performance_log_lines_per_run_max - run.log_lines_received
    report = {"accepted": 0, "duplicates": 0, "rejected": 0, "dropped": 0}
    dropped: list[int] = []
    for line in lines:
        if line.seq in known:
            report["duplicates"] += 1
            continue
        if room <= 0:
            report["dropped"] += 1
            dropped.append(line.seq)
            continue
        known.add(line.seq)
        room -= 1
        message = masker.text(_strip_nul(line.message))
        db.add(
            PerformanceLogLine(
                run_id=run.id,
                seq=line.seq,
                at=to_storage_utc(line.at),
                level=line.level,
                message=message[: settings.performance_log_message_chars_max],
            )
        )
        report["accepted"] += 1
    run.log_lines_received += report["accepted"]
    run.log_lines_dropped += _new_drops(
        db,
        run,
        what="log lines",
        limit=settings.performance_log_lines_per_run_max,
        seqs=dropped,
        now=now,
    )
    db.flush()
    return report


def store_events(
    db: Session,
    runner: PerformanceRunner,
    events: list["PerformanceEventBody"],
    settings: PlatformSettings,
) -> int:
    """Store runner events; a repeat of ``(runner, run_id, at, code)`` is ignored.

    Messages are masked, credential keys are dropped from ``details``. A
    ``run_id`` that is not a run of this runner is not kept, so an event can
    never land on another runner's timeline.
    """
    masker = performance_redaction.masker(db, project_id=runner.project_id)
    named = {event.run_id for event in events if event.run_id}
    own = (
        set(
            db.scalars(
                select(PerformanceRun.id).where(
                    PerformanceRun.runner_id == runner.id, PerformanceRun.id.in_(named)
                )
            )
        )
        if named
        else set()
    )
    accepted = 0
    seen = set()
    for event in events:
        at = to_storage_utc(event.at)
        run_id = event.run_id if event.run_id in own else None
        code = "redacted" if masker.contains(event.code) else event.code
        identity = (run_id, at, code)
        if identity in seen:
            continue
        seen.add(identity)
        stored = db.scalar(
            select(PerformanceEvent.id)
            .where(
                PerformanceEvent.runner_id == runner.id,
                (
                    PerformanceEvent.run_id.is_(None)
                    if run_id is None
                    else PerformanceEvent.run_id == run_id
                ),
                PerformanceEvent.at == at,
                PerformanceEvent.code == code,
            )
            .limit(1)
        )
        if stored is not None:
            continue
        message = masker.text(_strip_nul(event.message))
        db.add(
            PerformanceEvent(
                runner_id=runner.id,
                run_id=run_id,
                at=at,
                level=event.level,
                code=code,
                message=message[: settings.performance_log_message_chars_max],
                details=masker.json(
                    performance_redaction.drop_credential_keys(event.details)
                ),
                source="runner",
            )
        )
        accepted += 1
    db.flush()
    return accepted


# --------------------------------------------------------------------------- result


def store_summary(
    db: Session,
    run: PerformanceRun,
    *,
    summary: dict[str, Any],
    headline: "PerformanceSummaryHeadlineBody",
    exit_code: Optional[int],
) -> str:
    """Store the result, masked, and copy its headline to the run; returns the verdict.

    Every string of the summary, keys included, is masked like a log line:
    current token values in every spelling and token-shaped text. The
    headline numbers and the verdict are fixed words and numbers.
    """
    masker = performance_redaction.masker(db, target_id=run.target_id)
    run.summary = masker.json(summary)
    run.verdict = summary["verdict"]
    for column in HEADLINE_COLUMNS:
        setattr(run, column, getattr(headline, column))
    if exit_code is not None and run.exit_code is None:
        run.exit_code = exit_code
    db.flush()
    return run.verdict


def store_report(db: Session, run: PerformanceRun, data: bytes, now: datetime) -> None:
    """Store the report file compressed, with its download size and SHA-256; a repeat replaces it."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise refusal("report_not_utf8") from None
    tokens = performance_redaction.token_values(db, target_id=run.target_id)
    # A JWT-shaped string is an access token the target handed out during the
    # run: qym never saw it, so only its shape can give it away.
    if performance_redaction.contains_token(
        text, tokens
    ) or performance_redaction.contains_jwt(text):
        raise refusal("contains_token")
    compressed = zlib.compress(data, 6)
    row = db.get(PerformanceReport, run.id)
    if row is None:
        row = PerformanceReport(run_id=run.id)
        db.add(row)
    row.content_type = REPORT_CONTENT_TYPE
    row.html = compressed
    row.html_size = len(data)
    # The size of the file as a person downloads it; the compressed size stays
    # internal (the length of ``html``) and is never answered.
    row.byte_size = len(data)
    row.sha256 = hashlib.sha256(data).hexdigest()
    row.received_at = now
    run.report_received_at = now
    db.flush()


def read_report(db: Session, run_id: str) -> Optional[tuple[bytes, PerformanceReport]]:
    """The stored report file of a run, decompressed, with its row; ``None`` when there is none."""
    row = db.get(PerformanceReport, run_id)
    if row is None:
        return None
    return zlib.decompress(row.html), row


# --------------------------------------------------------------------------- dataset


def parse_after(after: Optional[str]) -> Optional[tuple[int, int]]:
    """Decode the ``next_after`` of a page (``<index>:<row id>``)."""
    if after is None:
        return None
    index, _, row_id = after.partition(":")
    return int(index), int(row_id)


def dataset_items_page(
    db: Session, run: PerformanceRun, *, after: Optional[tuple[int, int]], limit: int
) -> dict[str, Any]:
    """One page of the items of the dataset version the run pinned, in dataset order.

    Disabled items are left out. Paged by ``(index, row id)``, so a page never
    repeats or skips an item.
    """
    if run.dataset_version_id is None:
        return {"items": [], "next_after": None, "total": 0}
    in_version = (
        DatasetItem.dataset_version_id == run.dataset_version_id,
        DatasetItem.disabled_at.is_(None),
    )
    total = db.scalar(select(func.count(DatasetItem.id)).where(*in_version))
    query = select(
        DatasetItem.id,
        DatasetItem.index,
        DatasetItem.item_id,
        DatasetItem.input,
        DatasetItem.expected_output,
        DatasetItem.item_metadata,
        DatasetItem.labels,
        performance_views.item_kind().label("runner_tier"),
    ).where(*in_version)
    if after is not None:
        last_index, last_id = after
        query = query.where(
            (DatasetItem.index > last_index)
            | ((DatasetItem.index == last_index) & (DatasetItem.id > last_id))
        )
    rows = db.execute(
        query.order_by(DatasetItem.index, DatasetItem.id).limit(limit + 1)
    ).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": [
            {
                "item_id": row.item_id,
                "index": row.index,
                "input": row.input,
                "expected_output": row.expected_output,
                "metadata": (
                    {**(row.item_metadata or {}), "tier": row.runner_tier}
                    if row.runner_tier is not None
                    and (row.item_metadata or {}).get("tier") != row.runner_tier
                    else row.item_metadata or {}
                ),
                "labels": row.labels or [],
            }
            for row in rows
        ],
        "next_after": f"{rows[-1].index}:{rows[-1].id}" if more else None,
        "total": int(total or 0),
    }


# --------------------------------------------------------------------------- tokens


def rotate_token(
    db: Session,
    run: PerformanceRun,
    runner: PerformanceRunner,
    principal: Principal,
    *,
    name: str,
    value: str,
    replaces_version: int,
    expires_at: Optional[datetime],
    now: datetime,
) -> dict[str, Any]:
    """Save a token the target handed out in place of the one the runner used.

    A compare-and-set on the version: a token a person saved in the meantime is
    never overwritten. The repeat of a request that already succeeded gets the
    same answer. Only the chosen runner key may write a token.
    """
    from qym_platform.services import performance_platform as platform
    from qym_platform.services import performance_targets as targets

    if (run.target_kind == platform.KIND) != (name == "session_cookie"):
        raise platform.refusal("wrong_target_kind")
    if name == "session_cookie":
        value = platform.clean_cookie(value)
        target = targets.hold_target(db, run.target_id) if run.target_id else None
        from types import SimpleNamespace

        frozen = SimpleNamespace(**run.config["target"])
        if (
            target is None
            or target.archived_at is not None
            or platform.auth_settings(target) != platform.auth_settings(frozen)
        ):
            raise refusal("token_version_conflict")
    if not performance_control.is_chosen_key(db, runner, principal):
        raise refusal("tokens_not_disclosed")
    row = None
    if run.target_id is not None:
        row = db.scalars(
            select(PerformanceTargetToken)
            .where(
                PerformanceTargetToken.target_id == run.target_id,
                PerformanceTargetToken.name == name,
            )
            .with_for_update()
        ).first()
    if (
        row is None
        or not row.token_encrypted
        or (name == "session_cookie" and row.generation != run.credential_generation)
    ):
        raise refusal("token_version_conflict")
    try:
        if row.version == replaces_version + 1 and (
            secret_storage.decrypt_llm_api_key(row.token_encrypted) == value
        ):
            return {"name": name, "version": row.version, "hint": row.token_hint}
        if row.version != replaces_version:
            raise refusal("token_version_conflict")
        encrypted = secret_storage.encrypt_llm_api_key(value)
    except (RuntimeError, ValueError, TypeError, InvalidToken) as exc:
        raise refusal("secret_cannot_be_decrypted") from exc
    before = {"name": name, "version": row.version, "hint": row.token_hint}
    if name == "session_cookie":
        platform.remember_cookie(row, now, value)
    row.token_encrypted = encrypted
    row.token_hint = (
        platform.cookie_hint(value, now)
        if name == "session_cookie"
        else performance_redaction.hint_for(value)
    )
    row.version += 1
    row.expires_at = to_storage_utc(expires_at)
    row.updated_by_user_id = None
    row.updated_at = now
    if run.token_needed == name:
        run.token_needed = None
    after = {"name": name, "version": row.version, "hint": row.token_hint}
    db.add(
        AuditLog(
            actor_user_id=principal.user.id,
            action="performance.token.rotated",
            entity_type="performance_target",
            entity_id=run.target_id,
            before=before,
            after={**after, "run_id": run.id, "by": "runner"},
        )
    )
    if name == "session_cookie":
        # The event masker must see the newly saved jar as well as its history.
        db.flush()
    performance_state.add_event(
        db,
        runner_id=run.runner_id,
        run_id=run.id,
        at=now,
        code="token_rotated",
        message=f"The target replaced the {name.replace('_', ' ')}; the new one is saved",
        details={"name": name, "version": row.version, "hint": row.token_hint},
    )
    db.flush()
    return after
