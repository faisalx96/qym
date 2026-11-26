"""The load plan of a performance run: levels, stages, length and checks.

The suite's own rules (its Breakpoint script builds the same ladder), written
once more in Python so the start route can enforce limits before anything
runs. The page has a third copy for its picture; the three share one file of
cases, ``tests/platform/performance/plan_cases.json``. Pure functions: no
database, no settings, no clock.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Optional, Sequence

TEST_TYPES = ("breakpoint", "smoke", "soak")
TIERS = ("simple", "medium", "complex")

# Breakpoint ladder: one baseline stage, per level a ramp and a hold, two cooldown stages.
BASELINE_SECONDS = 60
RAMP_SECONDS = 30
# The suite starts every ramping test with one user, so the baseline stage is a ramp from 1.
START_USERS = 1
# Answers that begin in the first seconds of a run are not measured, in all three tests.
WARMUP_SECONDS = 30
# Smoke is always one user for three minutes, whatever the request says.
SMOKE_USERS = 1
SMOKE_SECONDS = 180
# One answer takes about this long; used to estimate how many a level collects.
ANSWER_SECONDS = 55
FEW_ANSWERS = 20

DEFAULT_MIN_QUALITY = 70
DEFAULT_MAX_NO_DATA_PCT = 20
DEFAULT_FOLLOW_UP_RATE = 0.3
DEFAULT_MIX = {"simple": 50, "medium": 35, "complex": 15}
SINGLE_KIND_MIX = {"simple": 0, "medium": 100, "complex": 0}

# Lowest and highest value of each field, before the platform's own caps
# (highest number of users, longest run) are applied.
FIELD_RANGES: dict[str, tuple[float, float]] = {
    "hold_seconds": (30, 3600),
    "limit_ms": (1000, 900000),
    "max_error_rate_pct": (1, 100),
    "follow_up_rate": (0, 1),
    "timeout_seconds": (30, 900),
}
LIMIT_MS_STEP = 1000
MIN_USERS = 1
MIN_DURATION_SECONDS = 60

PLAN_INPUT_FIELDS = (
    "baseline_users",
    "max_users",
    "step_users",
    "hold_seconds",
    "follow_up_rate",
    "abort_on_break",
    "limit_ms",
    "max_error_rate_pct",
    "timeout_seconds",
    "users",
    "duration_seconds",
    "min_quality",
    "max_no_data_pct",
)
_SHARED_FIELDS = ("limit_ms", "max_error_rate_pct", "timeout_seconds")
# The plan fields each test reads; a start ignores the others (``normalize_input``).
PLAN_FIELDS = {
    "breakpoint": (
        *_SHARED_FIELDS,
        "baseline_users",
        "max_users",
        "step_users",
        "hold_seconds",
        "follow_up_rate",
        "abort_on_break",
    ),
    "smoke": (*_SHARED_FIELDS, "min_quality", "max_no_data_pct"),
    "soak": (
        *_SHARED_FIELDS,
        "users",
        "duration_seconds",
        "min_quality",
        "max_no_data_pct",
    ),
}


def round_half_up(value: float) -> int:
    """Round a positive number with halves going up (the built-in rounds halves to even)."""
    return math.floor(value + 0.5)


def recommended_hold_seconds(limit_ms: float) -> int:
    """About 2.5 times the limit, in steps of 30 s, at least 120 s.

    The limit is rounded to whole seconds first, as the suite's terminal tool does.
    """
    limit_s = round_half_up(limit_ms / 1000)
    return max(120, round_half_up(2.5 * limit_s / 30) * 30)


def recommended_timeout_seconds(limit_ms: float) -> int:
    """Three times the limit in whole seconds (rounded up), between 180 and 900."""
    return min(900, max(180, math.ceil(3 * limit_ms / 1000)))


def levels(max_users: int, step_users: int) -> list[int]:
    """The measured levels: the step, twice the step, and so on up to the maximum.

    A maximum that is not a multiple of the step is not reached; a step above
    the maximum gives no level.
    """
    if step_users < 1:
        return []
    return list(range(step_users, max_users + 1, step_users))


def _stage(role: str, target_users: int, start_s: int, seconds: int) -> dict[str, Any]:
    return {
        "role": role,
        "target_users": target_users,
        "start_s": start_s,
        "end_s": start_s + seconds,
    }


def normalize_input(test_type: str, values: Mapping[str, Any]) -> dict[str, Any]:
    """The plan input as it is stored: fields of other test types are null.

    Smoke is fixed at one user for 180 s. Breakpoint gets the suite's follow-up
    rate and auto-stop when they are absent; Smoke and Soak get the suite's
    quality limits.
    """
    if test_type not in TEST_TYPES:
        raise ValueError(f"unknown test type: {test_type}")
    plan: dict[str, Any] = {name: None for name in PLAN_INPUT_FIELDS}
    for name in ("limit_ms", "max_error_rate_pct", "timeout_seconds"):
        plan[name] = values.get(name)
    if test_type == "breakpoint":
        for name in ("baseline_users", "max_users", "step_users", "hold_seconds"):
            plan[name] = values.get(name)
        rate = values.get("follow_up_rate")
        plan["follow_up_rate"] = DEFAULT_FOLLOW_UP_RATE if rate is None else rate
        abort = values.get("abort_on_break")
        plan["abort_on_break"] = True if abort is None else bool(abort)
        return plan
    if test_type == "smoke":
        plan["users"] = SMOKE_USERS
        plan["duration_seconds"] = SMOKE_SECONDS
    else:
        plan["users"] = values.get("users")
        plan["duration_seconds"] = values.get("duration_seconds")
    quality = values.get("min_quality")
    plan["min_quality"] = DEFAULT_MIN_QUALITY if quality is None else quality
    no_data = values.get("max_no_data_pct")
    plan["max_no_data_pct"] = DEFAULT_MAX_NO_DATA_PCT if no_data is None else no_data
    return plan


def build_plan(test_type: str, values: Mapping[str, Any]) -> dict[str, Any]:
    """The plan with what qym computes from it: levels, stages, length, warm-up.

    ``values`` holds the fields of ``PLAN_INPUT_FIELDS`` that belong to the test
    type. The result is the object stored in a run's frozen settings.
    """
    plan = normalize_input(test_type, values)
    stages: list[dict[str, Any]] = []
    if test_type == "breakpoint":
        plan_levels = levels(plan["max_users"], plan["step_users"])
        stages.append(_stage("baseline", plan["baseline_users"], 0, BASELINE_SECONDS))
        for level in plan_levels:
            stages.append(_stage("ramp", level, stages[-1]["end_s"], RAMP_SECONDS))
            stages.append(
                _stage("hold", level, stages[-1]["end_s"], plan["hold_seconds"])
            )
        stages.append(
            _stage(
                "cooldown", plan["baseline_users"], stages[-1]["end_s"], RAMP_SECONDS
            )
        )
        stages.append(_stage("cooldown", 0, stages[-1]["end_s"], RAMP_SECONDS))
    else:
        plan_levels = [plan["users"]]
        stages.append(_stage("steady", plan["users"], 0, plan["duration_seconds"]))
    plan["levels"] = plan_levels
    plan["total_seconds"] = stages[-1]["end_s"]
    plan["warmup_seconds"] = WARMUP_SECONDS
    plan["stages"] = stages
    return plan


def peak_users(plan: Mapping[str, Any]) -> int:
    """The most users the plan puts on the target at once."""
    return max([stage["target_users"] for stage in plan["stages"]] or [0])


def stage_start_users(stages: Sequence[Mapping[str, Any]], index: int) -> int:
    """Users at the start of a stage: the previous stage's target, or one for the first.

    A steady stage (Smoke, Soak) has its users from the first second.
    """
    stage = stages[index]
    if stage["role"] == "steady":
        return stage["target_users"]
    return START_USERS if index == 0 else stages[index - 1]["target_users"]


def planned_users_at(stages: Sequence[Mapping[str, Any]], second: float) -> float:
    """Planned users at a moment of the run; every stage moves in a straight line to its target."""
    if not stages:
        return 0.0
    index = next(
        (i for i, stage in enumerate(stages) if second < stage["end_s"]),
        len(stages) - 1,
    )
    stage = stages[index]
    start = stage_start_users(stages, index)
    length = stage["end_s"] - stage["start_s"]
    share = 1.0 if length <= 0 else (second - stage["start_s"]) / length
    share = min(1.0, max(0.0, share))
    return start + (stage["target_users"] - start) * share


def _check(code: str, tone: str, message: str) -> dict[str, str]:
    return {"code": code, "tone": tone, "message": message}


def _duration_words(seconds: int) -> str:
    minutes, rest = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    parts = []
    if hours:
        parts.append(f"{hours} h")
    if minutes:
        parts.append(f"{minutes} min")
    if rest or not parts:
        parts.append(f"{rest} s")
    return " ".join(parts)


def _seconds_words(limit_ms: float) -> str:
    seconds = limit_ms / 1000
    return f"{int(seconds)} s" if seconds == int(seconds) else f"{seconds:g} s"


def plan_checks(
    test_type: str,
    plan: Mapping[str, Any],
    *,
    max_users: Optional[int] = None,
    max_total_seconds: Optional[int] = None,
) -> list[dict[str, str]]:
    """What the rules say about a built plan, in a fixed order; ``bad`` means it cannot start.

    With ``max_users`` or ``max_total_seconds`` the plan is also held against a
    limit (``over_max_users``, ``over_max_duration``); without them only the
    plan's own values are judged.
    """
    checks: list[dict[str, str]] = []
    if test_type == "breakpoint":
        plan_levels = plan["levels"]
        limit_words = _seconds_words(plan["limit_ms"])
        hold = plan["hold_seconds"]
        recommended = recommended_hold_seconds(plan["limit_ms"])
        if not plan_levels:
            checks.append(
                _check(
                    "no_levels",
                    "bad",
                    f"The step ({plan['step_users']}) is larger than the highest number of "
                    f"users ({plan['max_users']}), so no level would be measured.",
                )
            )
        elif plan["max_users"] % plan["step_users"]:
            checks.append(
                _check(
                    "max_not_multiple_of_step",
                    "warn",
                    f"The last measured level is {plan_levels[-1]} users. {plan['max_users']} "
                    "is not a multiple of the step, so it is not reached.",
                )
            )
        if plan["timeout_seconds"] < plan["limit_ms"] / 1000:
            checks.append(
                _check(
                    "timeout_below_limit",
                    "bad",
                    f"An answer is given up after {plan['timeout_seconds']} s, before it can "
                    f"reach the {limit_words} time limit. Raise the timeout.",
                )
            )
        if hold < recommended:
            checks.append(
                _check(
                    "hold_short",
                    "warn",
                    f"A hold of {hold} s is short for a {limit_words} time limit: slow answers "
                    f"barely fit. Recommended hold: {recommended} s.",
                )
            )
        else:
            checks.append(
                _check(
                    "hold_ok",
                    "ok",
                    f"Each level is held {_duration_words(hold)}, long enough to measure a "
                    f"{limit_words} time limit.",
                )
            )
        if plan_levels and plan_levels[0] * hold / ANSWER_SECONDS < FEW_ANSWERS:
            answers = round_half_up(plan_levels[0] * hold / ANSWER_SECONDS)
            checks.append(
                _check(
                    "first_level_few_answers",
                    "warn",
                    f"The first level will collect about {answers} answers. Fewer than "
                    f"{FEW_ANSWERS} makes its p95 unreliable.",
                )
            )
    elif test_type == "smoke":
        checks.append(
            _check(
                "steady_ok", "ok", "One user for 3 minutes: two or three real answers."
            )
        )
    else:
        checks.append(
            _check(
                "steady_ok",
                "ok",
                f"{plan['users']} users for {_duration_words(plan['duration_seconds'])}.",
            )
        )
    peak = peak_users(plan)
    if max_users is not None and peak > max_users:
        checks.append(
            _check(
                "over_max_users",
                "bad",
                f"This plan goes to {peak} users. At most {max_users} are allowed.",
            )
        )
    if max_total_seconds is not None and plan["total_seconds"] > max_total_seconds:
        checks.append(
            _check(
                "over_max_duration",
                "bad",
                f"This plan takes {_duration_words(plan['total_seconds'])}. The longest "
                f"run allowed is {_duration_words(max_total_seconds)}.",
            )
        )
    return checks
