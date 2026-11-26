"""Platform presets, route templates and cookie normalization."""

import pytest
from qym_platform.services import performance_platform as platform
from qym_platform.services.performance_runs import PerformanceError


def test_platform_defaults_and_ladder():
    plan = platform.plan_input("breakpoint", {}, {}, 200, 28800)
    assert (plan["max_users"], plan["hold_seconds"], plan["timeout_seconds"]) == (
        10,
        120,
        60,
    )
    resolved = platform.resolve_plan(
        "breakpoint", {**plan, "max_users": 5, "step_users": 2}, [101], 0, 28800
    )
    assert resolved["levels"] == [2, 4, 5]
    assert resolved["total_seconds"] == 570


def test_cookie_normalization_and_invalid_inputs():
    assert platform.clean_cookie('Cookie: "a=one; b=two; a=three"') == "a=three; b=two"
    for value in (
        "",
        "opaque",
        "a=",
        "a=x\r\nb=y",
        "bad name=value",
        "a=" + "x" * 16384,
    ):
        with pytest.raises(PerformanceError) as error:
            platform.clean_cookie(value)
        assert error.value.code == "session_cookie_invalid"


@pytest.mark.parametrize(
    "route",
    [
        "https://elsewhere.test/",
        "//elsewhere/",
        "/%2e%2e/x",
        "/a\\b",
        "/x#y",
        "/{unknown}",
    ],
)
def test_route_templates_stay_on_origin(route):
    with pytest.raises(PerformanceError) as error:
        platform.target_settings({"routes": {"session": route}})
    assert error.value.code == "target_route_invalid"


def test_round2_unknown_plan_fields_return_only_a_count():
    from fastapi.exceptions import RequestValidationError

    with pytest.raises(RequestValidationError) as error:
        platform.plan_input(
            "breakpoint",
            {"session=private_cookie": 1, "private_cookie": 2},
            {},
            200,
            28800,
        )
    errors = error.value.errors()
    assert errors[0]["msg"] == "Unknown fields are not allowed"
    assert errors[0]["ctx"]["count"] == 2
    assert "private_cookie" not in str(errors)
