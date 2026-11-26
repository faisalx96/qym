"""Estishraf Platform constants and frozen workload settings."""

from __future__ import annotations

import json
import math
import re
from typing import Any
from urllib.parse import unquote, urlsplit

from qym_platform.services.performance_runs import PerformanceError

KIND = "estishraf_platform"
ERROR_CLASSES = (
    "auth",
    "chart_unavailable",
    "callback_error",
    "timeout",
    "server_error",
    "client_error",
)
STAGES = ("baseline", "ramp", "hold", "cooldown", "steady")
TYPES = ("open", "filter", "error")
PARTIAL_REASONS = (
    "time_budget",
    "list_incomplete",
    "details_incomplete",
    "charts_incomplete",
    "final_sign_in_unchecked",
)
MESSAGES = {
    "wrong_target_kind": "This operation does not match the target kind.",
    "target_kind_immutable": "A target's kind cannot be changed. Add another target.",
    "target_address_has_path": "Use the address origin only; put any path prefix in the route settings.",
    "target_route_invalid": "A route template is invalid or leaves the target origin.",
    "runner_kind_unsupported": "This runner cannot run Estishraf Platform tests. Connect a runner that supports Estishraf Platform.",
    "unsupported_test_type": "Estishraf Platform supports Smoke and Breakpoint only.",
    "session_cookie_required": "Save a session cookie before starting.",
    "session_cookie_expired": "The saved sign-in has expired. Save a new session cookie.",
    "session_cookie_invalid": "Paste the whole Cookie header value as name=value pairs.",
    "plan_exceeds_duration": "The resolved test is longer than the allowed run duration.",
    "discovery_invalid": "Dashboard discovery returned an unsupported or inconsistent response.",
    "discovery_limit_exceeded": "Discovery is too large to record. Set a smaller maximum number of dashboards.",
    "discovery_conflict": "A different discovery result is already saved for this run.",
    "discovery_required": "Save the discovery result before sending dashboard measurements.",
    "plan_mismatch": "The plan qym computed differs from the plan the suite would run.",
}
ROUTES = {
    "session": "/api/auth/session",
    "token_refresh": "/api/auth/oauth2/token",
    "health_check": "/api/user-management/user/health-check",
    "my_topics": "/api/core/topic/user",
    "dashboards": "/api/core/dashboard/client-dashboard?page={page}&pageSize={page_size}",
    "dashboard": "/api/core/dashboard/client-dashboard/{dashboard_id}",
    "dashboard_logo": "/api/core/dashboard/client-dashboard/{dashboard_id}/logo",
    "latest_insights": "/api/core/insight/client-insight",
    "dashboard_background": "/api/core/dashboard/background-image/{dashboard_id}",
    "insight_last_update": "/api/core/insight/last-update/{insight_id}",
    "siblings": "/api/core/dashboard/client-dashboard/?topicId={topic_id}",
    "chart_wrapper": "/api/chart?insightId={insight_id}&theme={theme}",
    "chart_layout": "/chart-assets/{insight_id}/_dash-layout?theme={theme}",
    "chart_dependencies": "/chart-assets/{insight_id}/_dash-dependencies?theme={theme}",
    "chart_callback": "/chart-assets/{insight_id}/_dash-update-component?theme={theme}",
}
FIXED_LIMITS = dict(
    steps_batch_max=200,
    steps_max_bytes=1048576,
    step_max_bytes=8192,
    session_cookie_max_bytes=16384,
    percentile_samples_max=1000000,
    report_input_max_bytes=67108864,
    route_chars_max=2048,
    client_id_chars_max=200,
    title_chars_max=500,
    id_chars_max=200,
    id_json_max_bytes=1024,
    id_depth_max=8,
    platform_users_max=200,
    platform_levels_max=200,
    handoffs_max=100,
)
SETTING_LIMITS = {
    "platform_progress_max_bytes": ("progress_max_bytes", 262144),
    "platform_summary_max_bytes": ("summary_max_bytes", 16777216),
    "discovery_max_bytes": ("discovery_max_bytes", 16777216),
    "dashboards_per_run_max": ("max_dashboards", 10000),
    "chart_associations_per_run_max": ("max_chart_associations", 100000),
    "steps_per_run_max": ("steps_per_run_max", 50000),
}


def refusal(code: str, status: int = 409, details=None) -> PerformanceError:
    return PerformanceError(code, status, MESSAGES[code], details)


def require_kind(run, kind=KIND):
    if (run.target_kind or "chat") != kind:
        raise refusal("wrong_target_kind")


def supported(runner):
    return (
        (runner.info or {}).get("supported_target_kinds", ["chat"])
        if runner
        else ["chat"]
    )


def require_capability(runner):
    if KIND not in supported(runner):
        raise refusal(
            "runner_kind_unsupported",
            details={"required_kind": KIND, "supported_kinds": supported(runner)},
        )


def limits(settings):
    return {
        **FIXED_LIMITS,
        **{
            key: min(ceiling, getattr(settings, "performance_platform_" + attr))
            for key, (attr, ceiling) in SETTING_LIMITS.items()
        },
    }


def invalid(field, message="Invalid field"):
    from qym_platform.services.performance_targets import FieldError

    raise FieldError((field,), message)


def closed(value, keys, field):
    if not isinstance(value, dict):
        invalid(field, "Invalid object")
    unknown = len(set(value) - set(keys))
    if unknown:
        from fastapi.exceptions import RequestValidationError

        raise RequestValidationError(
            [
                {
                    "type": "extra_forbidden",
                    "loc": ("body", *field.split(".")),
                    "msg": "Unknown fields are not allowed",
                    "ctx": {"count": unknown},
                }
            ]
        )


def target_settings(value):
    closed(value, ("routes", "client_id", "request_timeout_seconds"), "settings")
    routes = value.get("routes", {})
    closed(routes, ROUTES, "settings.routes")
    result = dict(ROUTES)
    for key, route in routes.items():
        if not isinstance(route, str) or not 1 <= len(route) <= 2048:
            raise refusal("target_route_invalid", 422)
        decoded = route
        for _ in range(8):
            next_value = unquote(decoded)
            if next_value == decoded:
                break
            decoded = next_value
        placeholders = re.findall(r"\{[^{}]*\}", route)
        expected = re.findall(r"\{[^{}]*\}", ROUTES[key])
        if (
            not decoded.startswith("/")
            or decoded.startswith("//")
            or "#" in decoded
            or re.search(r"[\x00-\x20\x7f\\]", decoded)
            or any(part in (".", "..") for part in urlsplit(decoded).path.split("/"))
            or sorted(placeholders) != sorted(expected)
            or re.search(r"[{}]", re.sub(r"\{[^{}]*\}", "", route))
        ):
            raise refusal("target_route_invalid", 422)
        result[key] = route
    client = value.get("client_id", "estishraf")
    if (
        not isinstance(client, str)
        or not 1 <= len(client) <= 200
        or re.search(r"[\x00-\x1f\x7f]", client)
    ):
        invalid("settings.client_id")
    timeout = value.get("request_timeout_seconds")
    if timeout is not None and (type(timeout) is not int or not 30 <= timeout <= 900):
        invalid("settings.request_timeout_seconds")
    return dict(routes=result, client_id=client, request_timeout_seconds=timeout)


def auth_settings(target):
    settings = target.settings or {}
    routes = settings.get("routes", {})
    return (
        target.base_url,
        routes.get("session"),
        routes.get("token_refresh"),
        settings.get("client_id"),
    )


def clean_cookie(value):
    def fail():
        raise refusal("session_cookie_invalid", 422)

    if not isinstance(value, str) or any(c in value for c in "\r\n\0"):
        fail()
    if not 1 <= len(value.encode("utf-8")) <= 16384:
        fail()
    value = value.strip()
    if value.lower().startswith("cookie:"):
        value = value[7:].strip()
    if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
        value = value[1:-1].strip()
    pairs = {}
    for part in value.split(";"):
        if not part.strip():
            continue
        if "=" not in part:
            fail()
        name, item = (p.strip() for p in part.split("=", 1))
        if not re.fullmatch(r"[A-Za-z0-9!#$%&'*+.^_`|~-]+", name):
            fail()
        pairs[name] = item
    clean = "; ".join(f"{name}={item}" for name, item in pairs.items())
    if (
        not pairs
        or not any(pairs.values())
        or not 1 <= len(clean.encode("utf-8")) <= 16384
    ):
        fail()
    return clean


def cookie_hint(value, now):
    from qym_platform.datetime_utils import to_api_timestamp

    count = len(value.split(";"))
    return f"{count} {'cookie' if count == 1 else 'cookies'}, saved {to_api_timestamp(now)}"


COMMON_DEFAULTS = dict(
    limit_ms=10000,
    max_error_rate_pct=5,
    filter_reference_ms=5000,
    pause_seconds=5,
    filters_per_dashboard="all",
    max_dashboards=None,
    timeout_seconds=None,
    handoff_wait_seconds=600,
    discovery_budget_seconds=300,
)
BP_DEFAULTS = dict(
    baseline_users=1,
    max_users=10,
    step_users=1,
    hold_seconds=120,
    ramp_seconds=30,
    abort_on_break=True,
    pick="random",
)
SMOKE_DEFAULTS = dict(users=1, smoke_max_duration_seconds=None, pick="roundrobin")
RANGES = dict(
    baseline_users=(1, 200),
    max_users=(1, 200),
    step_users=(1, 200),
    hold_seconds=(30, 3600),
    ramp_seconds=(1, 3600),
    limit_ms=(1000, 900000),
    max_error_rate_pct=(1, 100),
    filter_reference_ms=(1, 900000),
    users=(1, 1),
    smoke_max_duration_seconds=(1, 28800),
    pause_seconds=(0, 3600),
    filters_per_dashboard=(0, 10000),
    max_dashboards=(1, 10000),
    timeout_seconds=(30, 900),
    handoff_wait_seconds=(1, 3600),
    discovery_budget_seconds=(1, 3600),
)


def defaults(test_type):
    return {
        **COMMON_DEFAULTS,
        **(BP_DEFAULTS if test_type == "breakpoint" else SMOKE_DEFAULTS),
    }


def plan_input(
    test_type,
    values,
    settings,
    user_cap,
    duration_cap,
    dashboard_cap=10000,
    global_users=200,
):
    if test_type not in ("smoke", "breakpoint"):
        raise refusal("unsupported_test_type", 422)
    result = defaults(test_type)
    closed(values, result, "plan")
    result.update(values)
    for key, value in result.items():
        if key in ("pick", "abort_on_break"):
            continue
        if value is None and key in (
            "timeout_seconds",
            "max_dashboards",
            "smoke_max_duration_seconds",
        ):
            continue
        if key == "filters_per_dashboard" and value == "all":
            continue
        if key == "ramp_seconds" and type(value) is int and value < 1:
            invalid("plan.ramp_seconds", "Give at least 1 second to reach each level")
        low, high = RANGES[key]
        if key in ("baseline_users", "max_users", "users"):
            high = min(high, user_cap)
        elif key == "step_users":
            high = min(high, global_users)
        elif key == "max_dashboards":
            high = min(high, dashboard_cap)
        elif key == "smoke_max_duration_seconds":
            high = duration_cap
        numeric = key in ("limit_ms", "filter_reference_ms", "pause_seconds")
        if (
            type(value) not in ((int, float) if numeric else (int,))
            or not math.isfinite(value)
            or not low <= value <= high
        ):
            invalid("plan." + key, f"Expected a number from {low} to {high}")
    if result["pick"] not in (
        ("roundrobin",) if test_type == "smoke" else ("random", "roundrobin")
    ):
        invalid("plan.pick")
    if test_type == "breakpoint":
        if (
            type(result["abort_on_break"]) is not bool
            or result["baseline_users"] > result["max_users"]
        ):
            invalid("plan")
    if result["timeout_seconds"] is None:
        result["timeout_seconds"] = settings.get("request_timeout_seconds") or (
            60
            if test_type == "smoke"
            else min(900, max(60, math.ceil(3 * result["limit_ms"] / 1000)))
        )
    if test_type == "breakpoint":
        resolve_plan(test_type, result, [], 0, duration_cap)
    return result


def resolve_plan(test_type, plan, ids, filters, duration_cap, theme="blue"):
    stages = []
    users = iterations = budget = None
    if test_type == "smoke":
        users, iterations = 1, len(ids)
        if plan["filters_per_dashboard"] != "all":
            filters = min(filters, plan["filters_per_dashboard"])
        estimate = len(ids) * (
            plan["limit_ms"] / 1000
            + filters * plan["filter_reference_ms"] / 1000
            + plan["pause_seconds"]
        )
        budget = plan["smoke_max_duration_seconds"] or max(
            600, math.ceil(estimate) + 60
        )
        levels, total = [1], budget
    else:
        maximum, step = plan["max_users"], plan["step_users"]
        levels = list(range(step, maximum + 1, step))
        if not levels or levels[-1] != maximum:
            levels.append(maximum)
        total = 0

        def stage(role, target, seconds):
            nonlocal total
            if seconds:
                stages.append(
                    dict(
                        role=role,
                        target_users=target,
                        start_s=total,
                        end_s=total + seconds,
                    )
                )
                total += seconds

        stage("baseline", plan["baseline_users"], 60)
        for level in levels:
            stage("ramp", level, plan["ramp_seconds"])
            stage("hold", level, plan["hold_seconds"])
        stage("cooldown", plan["baseline_users"], plan["ramp_seconds"])
        stage("cooldown", 0, plan["ramp_seconds"])
    if total > duration_cap:
        raise refusal("plan_exceeds_duration", 422)
    return dict(
        users=users,
        iterations=iterations,
        smoke_max_duration_seconds=budget,
        levels=levels,
        stages=stages,
        total_seconds=total,
        dashboard_ids=ids,
        theme=theme,
        chart_batch=6,
        baseline_seconds=60,
        abort_grace_seconds=30,
    )


def canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def clean_target(values, current=None):
    from qym_platform.services import performance_targets as targets
    from qym_platform.settings import PlatformSettings

    cfg = PlatformSettings()
    closed(
        values,
        (
            "kind",
            "name",
            "base_url",
            "is_production",
            "max_users",
            "max_duration_s",
            "settings",
        ),
        "target",
    )
    raw = values.get("base_url", "")
    try:
        path = urlsplit(raw).path if isinstance(raw, str) else ""
    except ValueError:
        invalid("base_url")
    if path not in ("", "/"):
        raise refusal("target_address_has_path", 422)
    name = " ".join(str(values.get("name") or "").split())
    if not 1 <= len(name) <= 200:
        invalid("name")
    if type(values.get("is_production")) is not bool:
        invalid("is_production")
    for key, lo, hi in (
        ("max_users", 1, min(200, cfg.performance_max_users)),
        ("max_duration_s", 60, cfg.performance_max_duration_seconds),
    ):
        value = values.get(key)
        if value is not None and (type(value) is not int or not lo <= value <= hi):
            invalid(key)
    return dict(
        kind=KIND,
        name=name,
        base_url=targets.normalize_origin(raw),
        is_production=values["is_production"],
        max_users=values.get("max_users"),
        max_duration_s=values.get("max_duration_s"),
        settings=target_settings(values.get("settings", {})),
        chat_path=ROUTES["session"],
        auth_path=ROUTES["token_refresh"],
    )


COOKIE_HISTORY_MAX = 256


def cookie_history(row, now):
    """Read encrypted history, including the undeployed first revision's jars."""
    from qym_platform import secrets

    if not row.history_encrypted:
        return []
    entries = json.loads(secrets.decrypt_llm_api_key(row.history_encrypted))
    converted = [
        (
            dict(value=item, replaced_at=(row.updated_at or now).isoformat())
            if isinstance(item, str)
            else item
        )
        for item in entries
    ]
    if converted != entries:
        _save_cookie_history(row, converted)
    return converted


def _save_cookie_history(row, entries):
    from qym_platform import secrets
    from sqlalchemy.orm.attributes import flag_modified

    row.history_encrypted = (
        secrets.encrypt_llm_api_key(json.dumps(entries)) if entries else None
    )
    if row.updated_at is not None:
        # Maintenance is not a new sign-in; suppress the column's onupdate.
        flag_modified(row, "updated_at")


def prune_cookie_history(db, row, now):
    """Keep a jar only while an earlier run can still send results."""
    from datetime import datetime, timedelta

    from qym_platform.db.models import PERFORMANCE_FINAL_RUN_STATUSES, PerformanceRun
    from qym_platform.settings import PlatformSettings
    from sqlalchemy import select

    entries = cookie_history(row, now)
    if not entries:
        return 0
    cfg = PlatformSettings()
    lifetime = timedelta(seconds=cfg.performance_late_window_seconds)
    runs = db.execute(
        select(
            PerformanceRun.requested_at,
            PerformanceRun.status,
            PerformanceRun.finished_at,
        ).where(PerformanceRun.target_id == row.target_id)
    ).all()
    kept = [
        entry
        for entry in entries
        if any(
            started <= datetime.fromisoformat(entry["replaced_at"])
            and (
                status not in PERFORMANCE_FINAL_RUN_STATUSES
                or finished is None
                or finished + lifetime >= now
            )
            for started, status, finished in runs
        )
    ]
    if kept != entries:
        _save_cookie_history(row, kept)
    return len(entries) - len(kept)


def remember_cookie(row, now, replacement=None):
    """Retain recent jars for masking without ever blocking a save at the cap."""
    from qym_platform import secrets
    from sqlalchemy.orm import object_session

    if not row.token_encrypted:
        return
    value = secrets.decrypt_llm_api_key(row.token_encrypted)
    if value == replacement:
        return
    db = object_session(row)
    entries = cookie_history(row, now)
    entries = [entry for entry in entries if entry["value"] != value]
    if value:
        entries.append(dict(value=value, replaced_at=now.isoformat()))
    _save_cookie_history(row, entries[-COOKIE_HISTORY_MAX:])
    if db is not None:
        prune_cookie_history(db, row, now)


def clear_cookie(row, now):
    remember_cookie(row, now)
    row.token_encrypted = ""
    row.token_hint = ""
    row.version += 1
    row.generation = (row.generation or 1) + 1
    row.expires_at = None
    row.updated_at = now


def start_run(db, project, user, body, now):
    from datetime import timedelta

    from qym_platform.db.models import (
        PERFORMANCE_ACTIVE_RUN_STATUSES,
        AuditLog,
        PerformanceRun,
    )
    from qym_platform.services import performance_runs as runs
    from qym_platform.services import performance_state as state
    from qym_platform.services import performance_targets as targets
    from qym_platform.services import performance_views as views
    from qym_platform.settings import PlatformSettings
    from sqlalchemy import func, select
    from sqlalchemy.exc import IntegrityError

    cfg = PlatformSettings()
    runner = views.project_runner(db, project.id, lock=True)
    blocked = views.blocked_reason(db, runner, now, cfg)
    if blocked:
        raise blocked
    require_capability(runner)
    target = targets.get_target(db, project.id, body["target_id"], lock=True)
    if target.kind != KIND:
        raise refusal("wrong_target_kind")
    runs._check_target(db, project, user, body, target)
    token = next(
        (t for t in target.tokens if t.name == "session_cookie" and t.token_encrypted),
        None,
    )
    if token is None:
        raise refusal("session_cookie_required")
    if targets.token_expired(token, now):
        raise refusal("session_cookie_expired")
    busy = targets.active_run(db, now=now, target_id=target.id)
    if busy:
        raise runs._target_busy(busy)
    used, oldest = views.starts_used(db, user.id, now)
    if cfg.performance_starts_per_hour and used >= cfg.performance_starts_per_hour:
        retry = (
            max(1, int((oldest + timedelta(hours=1) - now).total_seconds()))
            if oldest
            else 60
        )
        raise PerformanceError(
            "too_many_starts",
            429,
            f"You have started {used} runs in the last hour; the limit is {cfg.performance_starts_per_hour}. Try again in {max(1, round(retry / 60))} minutes.",
            {"retry_after_s": retry},
        )
    user_cap = min(
        200, cfg.performance_max_users, target.max_users or cfg.performance_max_users
    )
    duration_cap = min(
        cfg.performance_max_duration_seconds,
        target.max_duration_s or cfg.performance_max_duration_seconds,
    )
    plan = plan_input(
        body["test_type"],
        body["plan"],
        target.settings,
        user_cap,
        duration_cap,
        cfg.performance_platform_max_dashboards,
        cfg.performance_max_users,
    )
    for old in db.scalars(
        select(PerformanceRun).where(
            PerformanceRun.status.in_(PERFORMANCE_ACTIVE_RUN_STATUSES),
            (PerformanceRun.runner_id == runner.id)
            | (PerformanceRun.target_id == target.id),
        )
    ):
        state.end_if_stale(db, old, now=now)
    from qym_platform.services.performance_redaction import masker

    mask = masker(db, target_id=target.id)
    config = dict(
        schema=1,
        test_type=body["test_type"],
        target=dict(
            id=target.id,
            name=mask.text(target.name),
            kind=KIND,
            is_production=target.is_production,
            base_url=target.base_url,
            settings=target.settings,
            max_users=user_cap,
            max_duration_s=duration_cap,
        ),
        tokens=[dict(name=token.name, hint=token.token_hint, version=token.version)],
        plan=plan,
        note=mask.text(body.get("note", "")),
    )
    number = (
        int(
            db.scalar(
                select(func.coalesce(func.max(PerformanceRun.number), 0)).where(
                    PerformanceRun.project_id == project.id
                )
            )
            or 0
        )
        + 1
    )
    run = PerformanceRun(
        project_id=project.id,
        number=number,
        runner_id=runner.id,
        target_id=target.id,
        target_kind=KIND,
        credential_generation=token.generation,
        dataset_id=None,
        dataset_version_id=None,
        test_type=body["test_type"],
        status="queued",
        config=config,
        requested_by_user_id=user.id,
        requested_at=now,
        updated_at=now,
        max_users=plan.get("max_users", 1),
    )
    try:
        with db.begin_nested():
            db.add(run)
            db.flush()
    except IntegrityError as exc:
        raise runs._lost_race(db, runner.id, target.id) from exc
    db.add(
        AuditLog(
            actor_user_id=user.id,
            action="performance.run.start",
            entity_type=runs.RUN_ENTITY,
            entity_id=run.id,
            before={},
            after={
                "number": number,
                "target_kind": KIND,
                "target_id": target.id,
                "test_type": run.test_type,
                "plan": plan,
            },
        )
    )
    state.add_event(
        db,
        runner_id=runner.id,
        run_id=run.id,
        at=now,
        code="queued",
        message=f"Run {number} was started by {user.display_name or user.email}",
    )
    return run
