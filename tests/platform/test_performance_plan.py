"""The load plan rules in Python, against the cases the page's port also runs."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qym_platform.services import performance_plan as plan_rules

CASES_FILE = Path(__file__).parent / "performance" / "plan_cases.json"
DATA = json.loads(CASES_FILE.read_text(encoding="utf-8"))
CASES = DATA["cases"]

# Each dispute has two readings. D1 to D4: the suite's (how the test tool runs the
# plan, and how its terminal tool rounds). D5 to D7: the reading the undisputed
# cases above already use ("timeout below the limit" is bad, "suite defaults" has
# a short hold, the rule "steady" fixes Smoke), because a port cannot pass those
# cases and the other reading at once.
SUITE_READING = {"D1", "D2", "D3", "D4"}


def _chosen(case: dict) -> bool:
    from_kit = case["reading"].startswith("kit.js")
    return from_kit != (case["dispute"] in SUITE_READING)


DISPUTED = [case for case in DATA["disputed_cases"] if _chosen(case)]
REJECTED = [case for case in DATA["disputed_cases"] if not _chosen(case)]


def _built(case: dict) -> dict:
    config = case["config"]
    return plan_rules.build_plan(config["test_type"], config)


def _assert_case(case: dict) -> None:
    config, expect = case["config"], case["expect"]
    test_type = config["test_type"]
    plan = _built(case)
    checks = plan_rules.plan_checks(test_type, plan)
    assert plan["levels"] == expect["levels"]
    assert plan["total_seconds"] == expect["total_seconds"]
    assert plan["stages"][-1]["end_s"] == expect["total_seconds"]
    hold = (
        plan_rules.recommended_hold_seconds(config["limit_ms"])
        if test_type == "breakpoint"
        else None
    )
    assert hold == expect["recommended_hold_seconds"]
    assert (
        plan_rules.recommended_timeout_seconds(config["limit_ms"])
        == expect["recommended_timeout_seconds"]
    )
    assert [check["tone"] for check in checks] == expect["checks"]
    assert [check["code"] for check in checks] == expect["check_codes"]
    assert all(check["message"] for check in checks)
    if "first_stage" in expect:
        first = expect["first_stage"]
        stage = plan["stages"][0]
        assert {
            "role": stage["role"],
            "from_users": plan_rules.stage_start_users(plan["stages"], 0),
            "to_users": stage["target_users"],
            "start_second": stage["start_s"],
            "end_second": stage["end_s"],
        } == first
    if "planned_users_at_second_30" in expect:
        assert (
            plan_rules.planned_users_at(plan["stages"], 30)
            == expect["planned_users_at_second_30"]
        )
    if "warmup_seconds" in expect:
        assert plan["warmup_seconds"] == expect["warmup_seconds"]


def test_the_cases_file_holds_what_this_test_expects():
    assert len(CASES) == 26
    assert len(DATA["disputed_cases"]) == 16
    assert {case["dispute"] for case in DATA["disputed_cases"]} == {
        f"D{n}" for n in range(1, 8)
    }
    # One reading per pair is run; D6 has two pairs.
    assert len(DISPUTED) == len(REJECTED) == 8
    assert [case["dispute"] for case in DISPUTED] == [
        "D1",
        "D2",
        "D3",
        "D4",
        "D5",
        "D6",
        "D6",
        "D7",
    ]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_plan_case(case):
    _assert_case(case)


@pytest.mark.parametrize("case", DISPUTED, ids=[case["name"] for case in DISPUTED])
def test_disputed_case_in_the_chosen_reading(case):
    _assert_case(case)


@pytest.mark.parametrize("case", REJECTED, ids=[case["name"] for case in REJECTED])
def test_the_other_reading_of_a_dispute_does_not_hold(case):
    with pytest.raises(AssertionError):
        _assert_case(case)


def test_stages_follow_each_other_without_gaps():
    for case in CASES:
        stages = _built(case)["stages"]
        assert stages[0]["start_s"] == 0
        assert all(
            before["end_s"] == after["start_s"]
            for before, after in zip(stages, stages[1:])
        )
        assert all(stage["end_s"] > stage["start_s"] for stage in stages)


def test_breakpoint_plan_is_the_guides_sample_run():
    plan = plan_rules.build_plan(
        "breakpoint",
        {
            "baseline_users": 5,
            "max_users": 20,
            "step_users": 10,
            "hold_seconds": 60,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 540,
        },
    )
    assert plan == {
        "baseline_users": 5,
        "max_users": 20,
        "step_users": 10,
        "hold_seconds": 60,
        "follow_up_rate": 0.3,
        "abort_on_break": True,
        "limit_ms": 180000,
        "max_error_rate_pct": 10,
        "timeout_seconds": 540,
        "users": None,
        "duration_seconds": None,
        "min_quality": None,
        "max_no_data_pct": None,
        "levels": [10, 20],
        "total_seconds": 300,
        "warmup_seconds": 30,
        "stages": [
            {"role": "baseline", "target_users": 5, "start_s": 0, "end_s": 60},
            {"role": "ramp", "target_users": 10, "start_s": 60, "end_s": 90},
            {"role": "hold", "target_users": 10, "start_s": 90, "end_s": 150},
            {"role": "ramp", "target_users": 20, "start_s": 150, "end_s": 180},
            {"role": "hold", "target_users": 20, "start_s": 180, "end_s": 240},
            {"role": "cooldown", "target_users": 5, "start_s": 240, "end_s": 270},
            {"role": "cooldown", "target_users": 0, "start_s": 270, "end_s": 300},
        ],
    }
    assert plan_rules.peak_users(plan) == 20


def test_smoke_is_one_user_for_three_minutes_whatever_is_asked():
    plan = plan_rules.build_plan(
        "smoke",
        {
            "users": 30,
            "duration_seconds": 3600,
            "max_users": 80,
            "hold_seconds": 600,
            "limit_ms": 60000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 180,
        },
    )
    assert (plan["users"], plan["duration_seconds"]) == (1, 180)
    assert plan["stages"] == [
        {"role": "steady", "target_users": 1, "start_s": 0, "end_s": 180}
    ]
    assert plan["max_users"] is None and plan["hold_seconds"] is None
    assert plan["follow_up_rate"] is None and plan["abort_on_break"] is None
    assert (plan["min_quality"], plan["max_no_data_pct"]) == (70, 20)


def test_soak_keeps_its_users_length_and_quality_limits():
    plan = plan_rules.build_plan(
        "soak",
        {
            "users": 20,
            "duration_seconds": 7200,
            "limit_ms": 60000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 180,
            "min_quality": 80,
            "max_no_data_pct": 5,
        },
    )
    assert plan["levels"] == [20]
    assert plan["total_seconds"] == 7200
    assert (plan["min_quality"], plan["max_no_data_pct"]) == (80, 5)
    assert plan_rules.planned_users_at(plan["stages"], 0) == 20
    assert plan_rules.peak_users(plan) == 20


def test_planned_users_move_in_a_straight_line_inside_a_stage():
    stages = plan_rules.build_plan(
        "breakpoint",
        {
            "baseline_users": 5,
            "max_users": 20,
            "step_users": 10,
            "hold_seconds": 60,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 540,
        },
    )["stages"]
    assert plan_rules.planned_users_at(stages, 0) == 1
    assert plan_rules.planned_users_at(stages, 60) == 5
    assert plan_rules.planned_users_at(stages, 75) == 7.5
    assert plan_rules.planned_users_at(stages, 120) == 10
    assert plan_rules.planned_users_at(stages, 285) == 2.5
    assert plan_rules.planned_users_at(stages, 9999) == 0
    assert plan_rules.planned_users_at([], 10) == 0


def test_a_high_baseline_counts_as_the_plans_peak():
    plan = plan_rules.build_plan(
        "breakpoint",
        {
            "baseline_users": 80,
            "max_users": 20,
            "step_users": 10,
            "hold_seconds": 450,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 540,
        },
    )
    assert plan_rules.peak_users(plan) == 80


def test_checks_against_a_limit_come_last_and_stop_the_run():
    plan = plan_rules.build_plan(
        "breakpoint",
        {
            "baseline_users": 5,
            "max_users": 60,
            "step_users": 10,
            "hold_seconds": 450,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "timeout_seconds": 540,
        },
    )
    checks = plan_rules.plan_checks(
        "breakpoint", plan, max_users=50, max_total_seconds=1800
    )
    assert [(check["code"], check["tone"]) for check in checks] == [
        ("hold_ok", "ok"),
        ("over_max_users", "bad"),
        ("over_max_duration", "bad"),
    ]
    assert "60 users" in checks[1]["message"] and "50" in checks[1]["message"]
    assert "50 min" in checks[2]["message"] and "30 min" in checks[2]["message"]
    inside = plan_rules.plan_checks(
        "breakpoint", plan, max_users=60, max_total_seconds=3000
    )
    assert [check["code"] for check in inside] == ["hold_ok"]


def test_halves_round_up():
    assert [plan_rules.round_half_up(value) for value in (0.5, 1.5, 2.5, 4.4)] == [
        1,
        2,
        3,
        4,
    ]
    # 2.5 x 150 / 30 = 12.5: rounding halves to even would give 360.
    assert plan_rules.recommended_hold_seconds(150000) == 390


def test_an_unknown_test_type_is_refused():
    with pytest.raises(ValueError):
        plan_rules.build_plan("stress", {"limit_ms": 1000})
