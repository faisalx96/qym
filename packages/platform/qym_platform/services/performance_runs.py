"""Start, stop and read the state of performance runs.

Shared by the runner routes (``api/performance_ingest.py``) and the page routes
(``api/performance.py``). Every function takes the clock as ``now`` (naive UTC,
as the columns store it) and leaves the commit to its caller.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.db.models import (
    PERFORMANCE_ACTIVE_RUN_STATUSES,
    PERFORMANCE_FINAL_RUN_STATUSES,
    PERFORMANCE_TOKEN_NAMES,
    AuditLog,
    PerformanceRun,
    PerformanceTarget,
    PerformanceTargetToken,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.settings import PlatformSettings


class PerformanceError(Exception):
    """A refusal a person or the runner can act on.

    ``code`` is the ``error.code`` of the answer (the words the two contracts
    list, for example ``runner_busy`` or ``target_busy``), ``status`` the HTTP
    status, ``message`` one sentence in plain words, ``details`` the optional
    ``error.details`` object (for example ``{"run_id": ...}``).
    """

    def __init__(
        self,
        code: str,
        status: int,
        message: str,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        self.code = code
        self.status = status
        self.message = message
        self.details = details or {}
        super().__init__(message)


def start_run(
    db: Session, *, project: Project, user: User, body: Any, now: datetime
) -> PerformanceRun:
    """Queue a run for the project's runner and return it (status ``queued``).

    ``body`` is the validated start request: ``target_id``, ``test_type``,
    ``dataset_version_id``, ``plan``, ``mix``, ``options``, ``note``,
    ``confirm_target``. Checks every precondition (runner fresh, runner key
    chosen, encryption ready, sign-in saved, dataset version usable, plan inside
    the platform and target limits, nothing active on the runner or the target,
    production rules, starts per hour), freezes the settings into ``config`` and
    gives the run the project's next ``number``. Two starts at the same moment:
    exactly one is stored, the other raises a 409.

    Raises ``PerformanceError`` for every refusal.
    """
    from qym_platform.services import performance_plan as plan_rules
    from qym_platform.services import performance_state as state
    from qym_platform.services import performance_targets as targets
    from qym_platform.services import performance_views as views

    settings = PlatformSettings()
    test_type = _field(body, "test_type")

    # The request itself: target, production rules, dataset, mix, plan.
    target = targets.get_target(db, project.id, _field(body, "target_id"))
    from qym_platform.services import performance_platform as platform

    if target.kind != (_field(body, "target_kind") or "chat"):
        raise platform.refusal("wrong_target_kind")
    _check_target(db, project, user, body, target)
    seen = _where_load_goes(target)
    found = views.dataset_version(db, project.id, _field(body, "dataset_version_id"))
    if found is None:
        raise PerformanceError(
            "dataset_not_found",
            422,
            "The dataset version was not found in this project.",
        )
    dataset, version = found
    refusal = views.dataset_refusal(dataset, version)
    if refusal is not None:
        raise refusal
    facts = views.dataset_facts(db, version.id)
    mix = _checked_mix(_field(body, "mix"), facts)
    plan = _checked_plan(test_type, _field(body, "plan"), target, settings)

    # The system: one start per project at a time, then runner, sign-in, busy, starts per hour.
    # The lock order is the area's one order: the runner row here, the target row below.
    runner = views.project_runner(db, project.id, lock=True)
    blocked = views.blocked_reason(db, runner, now, settings)
    if blocked is not None:
        raise blocked
    assert runner is not None
    _check_sign_in(target, now)
    busy = targets.active_run(db, now=now, target_id=target.id)
    if busy is not None:
        raise _target_busy(busy)
    per_hour = settings.performance_starts_per_hour
    if per_hour > 0:
        used, oldest = views.starts_used(db, user.id, now)
        if used >= per_hour:
            retry = 60
            if oldest is not None:
                retry = max(1, int((oldest + timedelta(hours=1) - now).total_seconds()))
            raise PerformanceError(
                "too_many_starts",
                429,
                f"You have started {used} runs in the last hour; the limit is {per_hour}. "
                f"Try again in {max(1, round(retry / 60))} minutes.",
                {"retry_after_s": retry},
            )

    # Hold the target from here to the commit, and judge it again as it is now: a
    # Manager's archive, new address or token removal that committed during the
    # checks above is seen here; one that comes later waits and then sees this run.
    target_id = target.id
    target = targets.hold_target(db, target_id)
    if target is None:
        raise targets.target_not_found()
    _check_target(db, project, user, body, target)
    if _where_load_goes(target) != seen:
        raise PerformanceError(
            "target_changed",
            409,
            f"The address or the sign-in settings of {target.name} changed while the run "
            "was being started. Check the target, then start again.",
            {"target_id": target_id},
        )
    plan = _checked_plan(test_type, _field(body, "plan"), target, settings)
    _check_sign_in(target, now)
    # Runs a silence rule has ended get their end written, so the database's
    # "one active run per runner and per target" counts only live ones.
    stale = db.scalars(
        select(PerformanceRun).where(
            PerformanceRun.status.in_(PERFORMANCE_ACTIVE_RUN_STATUSES),
            (PerformanceRun.runner_id == runner.id)
            | (PerformanceRun.target_id == target_id),
        )
    ).all()
    for other in stale:
        state.end_if_stale(db, other, now=now)

    options = _field(body, "options")
    store_answers = _field(options, "store_answers") if options is not None else None
    stored = target.settings or {}
    by_name = {token.name: token for token in target.tokens}
    config = {
        "schema": 1,
        "test_type": test_type,
        "target": {
            "id": target.id,
            "name": target.name,
            "is_production": target.is_production,
            "base_url": target.base_url,
            "chat_path": target.chat_path,
            "auth_server": stored.get("auth_server"),
            "token_refresh_path": target.auth_path,
            "refresh_cookie_name": stored.get("refresh_cookie_name"),
        },
        "tokens": [
            {
                "name": name,
                "hint": by_name[name].token_hint,
                "version": by_name[name].version,
            }
            for name in PERFORMANCE_TOKEN_NAMES
            if name in by_name
        ],
        "plan": plan,
        "mix": mix,
        "dataset": {
            "id": dataset.id,
            "name": dataset.name,
            "version_id": version.id,
            "version": version.version,
            "item_count": facts.item_count,
            "content_hash": version.content_hash or "",
            "tier_counts": dict(facts.tier_counts),
            "single_kind": facts.single_kind,
        },
        "options": {
            "store_answers": (
                views.store_answers_default(target.is_production)
                if store_answers is None
                else bool(store_answers)
            ),
            "question_sent_lines": True,
        },
        "note": str(_field(body, "note") or "").strip(),
    }
    number = db.scalar(
        select(func.coalesce(func.max(PerformanceRun.number), 0)).where(
            PerformanceRun.project_id == project.id
        )
    )
    run = PerformanceRun(
        project_id=project.id,
        number=int(number or 0) + 1,
        runner_id=runner.id,
        target_id=target.id,
        dataset_id=dataset.id,
        dataset_version_id=version.id,
        test_type=test_type,
        status="queued",
        config=config,
        requested_by_user_id=user.id,
        requested_at=now,
        updated_at=now,
    )
    runner_id, target_id = runner.id, target.id
    try:
        # The unique indexes decide a race the checks above could not see.
        with db.begin_nested():
            db.add(run)
            db.flush()
    except IntegrityError as exc:
        raise _lost_race(db, runner_id, target_id) from exc
    db.add(
        AuditLog(
            actor_user_id=user.id,
            action="performance.run.start",
            entity_type=RUN_ENTITY,
            entity_id=run.id,
            before={},
            after={
                "number": run.number,
                "test_type": test_type,
                "target": {
                    "id": target.id,
                    "name": target.name,
                    "is_production": target.is_production,
                },
                "dataset": {
                    "version_id": version.id,
                    "name": dataset.name,
                    "version": version.version,
                },
                "plan": {
                    name: plan[name]
                    for name in (
                        *plan_rules.PLAN_INPUT_FIELDS,
                        "levels",
                        "total_seconds",
                    )
                },
                "mix": mix,
            },
        )
    )
    state.add_event(
        db,
        runner_id=runner.id,
        run_id=run.id,
        at=now,
        code="queued",
        message=f"Run {run.number} was started by {user.display_name or user.email}",
    )
    return run


RUN_ENTITY = "performance_run"


def _field(source: Any, name: str) -> Any:
    """A field of the start request, whether it came as an object or as a mapping."""
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


def _timestamp(moment: Optional[datetime]) -> Optional[str]:
    from qym_platform.datetime_utils import to_api_timestamp

    return to_api_timestamp(moment)


def _is_manager(db: Session, project: Project, user: User) -> bool:
    """A project Manager or a platform admin (the role that may load production)."""
    from qym_platform.auth import PRINCIPAL_INFO_KEY
    from qym_platform.permissions import is_project_manager

    principal = db.info.get(PRINCIPAL_INFO_KEY)
    if principal is not None and principal.user.id == user.id:
        return is_project_manager(db, principal, project.id)
    if user.role == UserRole.ADMIN:
        return True
    role = db.scalar(
        select(ProjectMembership.role).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == project.id,
        )
    )
    return role == ProjectRole.MANAGER


def _check_target(
    db: Session, project: Project, user: User, body: Any, target: PerformanceTarget
) -> None:
    """The target can take a run from this person: not archived, production rules kept."""
    if target.archived_at is not None:
        raise PerformanceError(
            "target_archived",
            409,
            "This target is archived. Restore it or choose another target.",
        )
    if target.is_production:
        if not _is_manager(db, project, user):
            raise PerformanceError(
                "production_requires_manager",
                403,
                "Only a project Manager can start a run on a production target.",
            )
        if (_field(body, "confirm_target") or "").strip() != target.name:
            raise PerformanceError(
                "confirm_target_mismatch",
                422,
                "Type the target's name exactly to confirm a run on production.",
            )


def _where_load_goes(target: PerformanceTarget) -> tuple[Any, ...]:
    """Where the run would send its questions and its sign-in, as the start first read it."""
    from qym_platform.services import performance_targets as targets

    return (
        *targets.sign_in_route(target.base_url, target.auth_path, target.settings),
        target.chat_path,
    )


def _check_sign_in(target: PerformanceTarget, now: datetime) -> None:
    """A refresh token is saved for the target and has not run out."""
    from qym_platform.services import performance_targets as targets

    refresh = next(
        (token for token in target.tokens if token.name == targets.REFRESH_TOKEN), None
    )
    if refresh is None:
        raise PerformanceError(
            "sign_in_missing",
            409,
            f"No sign-in is saved for {target.name}. Paste the refresh token first.",
            {"missing": [targets.REFRESH_TOKEN]},
        )
    if targets.token_expired(refresh, now):
        raise PerformanceError(
            "token_expired",
            409,
            f"The refresh token saved for {target.name} has run out. Paste a new one.",
            {"name": refresh.name, "expires_at": _timestamp(refresh.expires_at)},
        )


def _runner_busy(run: PerformanceRun) -> PerformanceError:
    return PerformanceError(
        "runner_busy",
        409,
        f"Run {run.number} is in progress. The runner takes one run at a time: stop it "
        "or wait until it ends.",
        {"run_id": run.id},
    )


def _target_busy(run: PerformanceRun) -> PerformanceError:
    return PerformanceError(
        "target_busy",
        409,
        f"Run {run.number} is in progress on this target. Two runs on one system spoil "
        "both measurements: stop it or wait until it ends.",
        {"run_id": run.id},
    )


def _lost_race(db: Session, runner_id: str, target_id: str) -> PerformanceError:
    """The refusal for a start that the database turned down: somebody else was first."""
    stored = PerformanceRun.status.in_(PERFORMANCE_ACTIVE_RUN_STATUSES)
    other = db.scalars(
        select(PerformanceRun).where(stored, PerformanceRun.runner_id == runner_id)
    ).first()
    if other is not None:
        return _runner_busy(other)
    other = db.scalars(
        select(PerformanceRun).where(stored, PerformanceRun.target_id == target_id)
    ).first()
    if other is not None:
        return _target_busy(other)
    return PerformanceError(
        "runner_busy",
        409,
        "Another run was started at the same moment. Look at the run in progress, "
        "then try again.",
    )


def _checked_mix(mix: Any, facts: Any) -> dict[str, int]:
    """The share of each kind as it is stored, held against what the dataset has."""
    from qym_platform.services import performance_plan as plan_rules
    from qym_platform.services import performance_views as views

    shares = {tier: int(_field(mix, tier) or 0) for tier in plan_rules.TIERS}
    if facts.item_count == 0:
        raise PerformanceError(
            "mix_tier_empty",
            422,
            views.EMPTY_DATASET,
            {"tiers": [tier for tier in plan_rules.TIERS if shares[tier] > 0]},
        )
    if facts.single_kind:
        # No question has a kind: they all count as one, and the mix is not used.
        return dict(plan_rules.SINGLE_KIND_MIX)
    total = sum(shares.values())
    if total != 100 or any(share < 0 for share in shares.values()):
        raise PerformanceError(
            "mix_invalid",
            422,
            f"The shares of the three kinds add up to {total}%, not 100%.",
            {"sum": total},
        )
    empty = [
        tier
        for tier in plan_rules.TIERS
        if shares[tier] > 0 and not facts.tier_counts.get(tier)
    ]
    if empty:
        raise PerformanceError(
            "mix_tier_empty",
            422,
            f"The mix asks for {' and '.join(empty)} questions, but this dataset version "
            "has none. Set that share to 0 or choose another dataset.",
            {"tiers": empty},
        )
    return shares


def _checked_plan(
    test_type: str, plan: Any, target: PerformanceTarget, settings: PlatformSettings
) -> dict[str, Any]:
    """The plan as it is stored, inside the platform's limits and the target's own."""
    from qym_platform.services import performance_plan as plan_rules

    values = plan.model_dump() if hasattr(plan, "model_dump") else dict(plan or {})
    # Fields of another test type are not read, so they cannot refuse the start.
    values = {
        name: value
        for name, value in values.items()
        if name in plan_rules.PLAN_FIELDS[test_type]
    }
    required = {
        "breakpoint": ("baseline_users", "max_users", "step_users", "hold_seconds"),
        "smoke": (),
        "soak": ("users", "duration_seconds"),
    }[test_type]
    shared = ("limit_ms", "max_error_rate_pct", "timeout_seconds")
    missing = [name for name in (*required, *shared) if values.get(name) is None]
    if missing:
        raise PerformanceError(
            "plan_invalid",
            422,
            f"The plan is not complete: {', '.join(missing)} must be set.",
            {"checks": []},
        )
    cap = settings.performance_max_users
    user_fields = {
        "breakpoint": ("baseline_users", "max_users", "step_users"),
        "smoke": (),
        "soak": ("users",),
    }[test_type]
    for name in user_fields:
        value = values.get(name)
        if value is not None and value > cap:
            raise PerformanceError(
                "over_platform_limit",
                422,
                f"This platform allows at most {cap} users; the plan asks for {value}.",
                {"field": "max_users", "limit": cap, "value": value},
            )
    built = plan_rules.build_plan(test_type, values)
    checks = plan_rules.plan_checks(test_type, built)
    bad = [check for check in checks if check["tone"] == "bad"]
    if bad:
        raise PerformanceError(
            "plan_invalid", 422, bad[0]["message"], {"checks": checks}
        )
    longest = settings.performance_max_duration_seconds
    total = built["total_seconds"]
    if total > longest:
        raise PerformanceError(
            "over_platform_limit",
            422,
            f"This plan takes {total} seconds; the longest run this platform allows is "
            f"{longest} seconds.",
            {"field": "total_seconds", "limit": longest, "value": total},
        )
    peak = plan_rules.peak_users(built)
    if target.max_users is not None and peak > target.max_users:
        raise PerformanceError(
            "over_target_limit",
            422,
            f"{target.name} allows at most {target.max_users} users. This plan goes to "
            f"{peak}.",
            {"field": "max_users", "limit": target.max_users, "value": peak},
        )
    if target.max_duration_s is not None and total > target.max_duration_s:
        raise PerformanceError(
            "over_target_limit",
            422,
            f"{target.name} allows runs of at most {target.max_duration_s} seconds. This "
            f"plan takes {total}.",
            {"field": "total_seconds", "limit": target.max_duration_s, "value": total},
        )
    return built


def stop_outcome(before: str, run: PerformanceRun) -> str:
    """What a press on Stop did, from the status before it and the run after it."""
    if before in PERFORMANCE_FINAL_RUN_STATUSES:
        return "already_ended"
    if run.status == "stopped":
        return "stopped"
    if run.status == "stopping":
        return "stop_requested"
    if run.status == "interrupted":
        return "interrupted"
    return "already_ended"


def stop_run(
    db: Session,
    *,
    run: PerformanceRun,
    user: User,
    reason: Optional[str],
    now: datetime,
) -> PerformanceRun:
    """Stop a run for a person and return it.

    A queued run becomes ``stopped`` at once. A claimed run becomes ``stopping``
    and carries the stop request to the runner; when its runner has been silent
    past the stale limit it becomes ``interrupted`` at once. Stopping a run that
    is already stopping or final changes nothing and is not an error.
    """
    from qym_platform.services import performance_state as state
    from qym_platform.services import performance_targets as targets

    # Hold the row, so a report of the runner and this press cannot both write it.
    run = db.scalars(
        select(PerformanceRun)
        .where(PerformanceRun.id == run.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    before = run.status
    if before in PERFORMANCE_FINAL_RUN_STATUSES:
        return run
    words = (reason or "").strip()
    if run.target_kind == "estishraf_platform":
        from qym_platform.services.performance_redaction import masker

        words = masker(db, target_id=run.target_id).text(words)
    words = words[:500] or None

    def note_request() -> None:
        run.stop_requested_at = now
        run.stop_requested_by_user_id = user.id
        run.stop_reason = words
        targets.touch(run, now)

    name = user.display_name or user.email
    if state.end_if_stale(db, run, now=now):
        # Nobody claimed it in time, or its runner is silent: the rule has ended it.
        if run.status == "interrupted":
            note_request()
            # The press found the runner gone: say so, not only that it was silent.
            run.status_reason = "stopped_while_runner_silent"
    elif run.status in PERFORMANCE_FINAL_RUN_STATUSES or run.status == "stopping":
        return run
    elif run.status == "queued":
        state.finish_run(run, status="stopped", at=now, reason="stopped_before_claim")
        note_request()
        state.add_event(
            db,
            runner_id=run.runner_id,
            run_id=run.id,
            at=now,
            code="stopped",
            message=f"Stopped by {name} before the runner picked the run up",
        )
    else:
        run.status = "stopping"
        note_request()
        state.add_event(
            db,
            runner_id=run.runner_id,
            run_id=run.id,
            at=now,
            code="stop_requested",
            message=f"Stop requested by {name}",
        )
    db.add(
        AuditLog(
            actor_user_id=user.id,
            action="performance.run.stop",
            entity_type=RUN_ENTITY,
            entity_id=run.id,
            before={"status": before},
            after={
                "status": run.status,
                "outcome": stop_outcome(before, run),
                "reason": words,
            },
        )
    )
    db.flush()
    return run


def handoff_token(
    db: Session,
    *,
    run: PerformanceRun,
    user: User,
    name: str,
    value: str,
    now: datetime,
    expires_at: Optional[datetime] = None,
) -> PerformanceTargetToken:
    """Save a new token for the target of a run that is still going on.

    Stores ``value`` encrypted with its last 4 characters as the hint, raises the
    token's ``version`` by 1 and clears the run's ``token_needed``, so that the
    runner finds the new token in its next control read. Returns the token row;
    the value itself is never returned or logged.

    ``expires_at`` is when the token runs out, if the person said so. The run
    stops asking only when the token it waits for is the one handed over.

    Raises ``PerformanceError`` when the run has ended, has no target, the
    encryption key is missing or the value is empty.
    """
    from qym_platform.services import performance_state as state
    from qym_platform.services import performance_targets as targets

    status = state.effective_status(run, now=now)
    if status in PERFORMANCE_FINAL_RUN_STATUSES:
        raise PerformanceError(
            "run_ended",
            409,
            "The run has ended, so it cannot take a new token.",
            {"status": status},
        )
    target = None
    if run.target_id:
        # Hold the target, so two people saving a token do not both insert it.
        target = targets.hold_target(db, run.target_id)
    if target is None:
        raise PerformanceError(
            "target_missing", 409, "The target of this run no longer exists."
        )
    before = next(
        (
            {"name": row.name, "hint": row.token_hint, "version": row.version}
            for row in target.tokens
            if row.name == name
        ),
        {},
    )
    token = targets.save_token(
        db,
        target=target,
        name=name,
        value=value,
        expires_at=expires_at,
        user=user,
        now=now,
        action=None,
    )
    # Hold the run last (the area's lock order: target, token, run) and read what it
    # waits for now: a runner report may have asked for another token meanwhile.
    run = db.scalars(
        select(PerformanceRun)
        .where(PerformanceRun.id == run.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if run.token_needed in (None, name):
        run.token_needed = None
    targets.touch(run, now)
    db.add(
        AuditLog(
            actor_user_id=user.id,
            action="performance.run.token",
            entity_type=RUN_ENTITY,
            entity_id=run.id,
            before=before,
            after={
                "name": token.name,
                "hint": token.token_hint,
                "version": token.version,
                "target_id": target.id,
            },
        )
    )
    state.add_event(
        db,
        runner_id=run.runner_id,
        run_id=run.id,
        at=now,
        code="token_supplied",
        message=f"{user.display_name or user.email} saved a new {name.replace('_', ' ')}",
        details={"name": name, "version": token.version},
    )
    db.flush()
    return token


def effective_status(run: PerformanceRun, *, now: datetime) -> str:
    """The run's status after the rules that are derived on read.

    A claimed run (``starting``, ``running``, ``stopping``) without a sign of life
    for ``performance_stale_after_seconds`` reads as ``interrupted``; a queued run
    not claimed within ``performance_queue_timeout_seconds`` reads as ``expired``;
    otherwise the stored status. Reads only the run row and the settings, and
    writes nothing.
    """
    from qym_platform.services import performance_state

    return performance_state.effective_status(run, now=now)
