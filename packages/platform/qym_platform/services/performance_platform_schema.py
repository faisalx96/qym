"""Closed platform wire objects; all measurement fields are required, including nulls."""

from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Annotated, Any, Literal, Optional

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from qym_platform.services import performance_platform as platform

Count = Annotated[int, Field(strict=True, ge=0)]
Positive = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
Number = Annotated[
    float,
    Field(ge=0, allow_inf_nan=False),
    BeforeValidator(
        lambda v: (
            v
            if type(v) in (int, float)
            else (_ for _ in ()).throw(ValueError("Expected a finite number"))
        )
    ),
]
Percent = Annotated[Number, Field(le=100)]
Text = Annotated[str, Field(max_length=2000)]
Title = Annotated[str, Field(max_length=500)]
Kind = Literal["estishraf_platform"]
StageName = Literal["baseline", "ramp", "hold", "cooldown", "steady"]
ErrorClass = Literal[
    "auth",
    "chart_unavailable",
    "callback_error",
    "timeout",
    "server_error",
    "client_error",
]
Reason = Literal[
    "time_budget",
    "list_incomplete",
    "details_incomplete",
    "charts_incomplete",
    "final_sign_in_unchecked",
]


def utc(value):
    if not isinstance(value, str):
        raise ValueError("Expected a UTC timestamp")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Expected a UTC timestamp") from None
    if dt.tzinfo is None or dt.utcoffset().total_seconds() != 0:
        raise ValueError("Expected a UTC timestamp")
    return value


Time = Annotated[str, AfterValidator(utc)]


def identifier(value):
    def check(item, depth=0):
        if depth > 8:
            raise ValueError("ID exceeds maximum depth")
        if isinstance(item, dict):
            if not all(isinstance(k, str) for k in item):
                raise ValueError("Invalid ID")
            for v in item.values():
                check(v, depth + 1)
        elif isinstance(item, list):
            for v in item:
                check(v, depth + 1)
        elif item is not None and type(item) not in (str, int, float, bool):
            raise ValueError("Invalid ID")

    if type(value) not in (str, int, float, dict) or (
        isinstance(value, str) and len(value) > 200
    ):
        raise ValueError("Invalid ID")
    check(value)
    if len(platform.canonical(value).encode("utf-8")) > 1024:
        raise ValueError("ID exceeds maximum size")
    return value


ID = Annotated[Any, BeforeValidator(identifier)]


class Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class Target(Closed):
    kind: Optional[Literal["chat", "estishraf_platform"]] = None
    name: str = Field(min_length=1, max_length=200)
    is_production: bool
    base_url: str = Field(min_length=1, max_length=500)
    max_users: Optional[int] = None
    max_duration_s: Optional[int] = None
    settings: dict[str, Any] = Field(default_factory=dict)


class Start(Closed):
    target_kind: Kind
    target_id: str = Field(min_length=1, max_length=36)
    test_type: str
    plan: dict[str, Any]
    note: str = Field(default="", max_length=500)
    confirm_target: Optional[str] = Field(default=None, max_length=200)


class Errors(Closed):
    auth: Count
    chart_unavailable: Count
    callback_error: Count
    timeout: Count
    server_error: Count
    client_error: Count


class DiscoveryCounts(Closed):
    dashboards_visible: Optional[Count]
    dashboards_discovered: Count
    dashboards_selected: Count
    dashboards_runnable: Count
    charts_found: Count
    charts_usable: Count
    charts_unusable: Count
    filters_found: Count
    skipped_by_budget: Count


class UnusableChart(Closed):
    id: ID
    reason_class: Literal[
        "auth",
        "timeout",
        "server_error",
        "client_error",
        "wrapper_invalid",
        "layout_invalid",
        "dependencies_invalid",
        "clientside_only",
        "no_server_callback",
        "invalid_callback",
        "budget",
    ]
    http_status: Optional[Annotated[int, Field(ge=0, le=599)]]


class Dashboard(Closed):
    id: ID
    title: str
    detail_loaded: bool
    runnable: bool
    charts_found: Count
    charts_usable: Count
    filters_found: Count
    charts_unusable: list[UnusableChart]

    @field_validator("id")
    @classmethod
    def scalar(cls, value):
        if isinstance(value, dict):
            raise ValueError("Discovery dashboard ID must be scalar")
        return value

    @model_validator(mode="after")
    def consistent(self):
        if self.runnable != (self.charts_usable > 0):
            raise ValueError("Runnable count differs from chart count")
        if self.charts_found != self.charts_usable + len(self.charts_unusable):
            raise ValueError("Chart counts differ")
        if not self.detail_loaded and (self.charts_found or self.filters_found):
            raise ValueError("Unloaded details cannot have counts")
        keys = [platform.canonical(c.id) for c in self.charts_unusable]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate chart ID")
        return self


class Stage(Closed):
    role: Literal["baseline", "ramp", "hold", "cooldown"]
    target_users: Count
    start_s: Number
    end_s: Number


class ResolvedPlan(Closed):
    users: Optional[Positive]
    iterations: Optional[Count]
    smoke_max_duration_seconds: Optional[Positive]
    levels: list[Positive] = Field(max_length=200)
    stages: list[Stage]
    total_seconds: Number
    dashboard_ids: list[ID] = Field(max_length=10000)
    theme: Literal["blue", "black"]
    chart_batch: Literal[6]
    baseline_seconds: Literal[60]
    abort_grace_seconds: Literal[30]


class Discovery(Closed):
    schema: Literal[1]
    target_kind: Kind
    started_at: Time
    ended_at: Time
    duration_s: Number
    active_duration_s: Number
    partial: bool
    partial_reasons: list[Reason]
    selection_limited: bool
    counts: DiscoveryCounts
    dashboards: list[Dashboard] = Field(max_length=10000)
    titles_truncated: Count
    resolved_plan: Optional[ResolvedPlan]

    @model_validator(mode="after")
    def consistent(self):
        if self.partial != bool(self.partial_reasons) or len(
            set(self.partial_reasons)
        ) != len(self.partial_reasons):
            raise ValueError("Partial reasons differ")
        if self.active_duration_s > self.duration_s or self.ended_at < self.started_at:
            raise ValueError("Discovery times differ")
        ids = [str(d.id) for d in self.dashboards]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate dashboard ID")
        c = self.counts
        expected = dict(
            dashboards_selected=len(self.dashboards),
            dashboards_runnable=sum(d.runnable for d in self.dashboards),
            charts_found=sum(d.charts_found for d in self.dashboards),
            charts_usable=sum(d.charts_usable for d in self.dashboards),
            charts_unusable=sum(len(d.charts_unusable) for d in self.dashboards),
            filters_found=sum(d.filters_found for d in self.dashboards),
        )
        if (
            any(getattr(c, k) != v for k, v in expected.items())
            or c.dashboards_discovered < c.dashboards_selected
        ):
            raise ValueError("Discovery counts differ from rows")
        if (
            c.dashboards_visible is not None
            and c.dashboards_visible < c.dashboards_discovered
        ):
            raise ValueError("Visible count is too small")
        return self


class CoverageCounts(Closed):
    dashboards_selected: Count
    dashboards_runnable: Count
    dashboards_exercised: Count
    dashboards_unexercised: Count
    dashboards_unusable: Count
    charts_found: Count
    charts_usable: Count
    charts_unusable: Count
    discovery_partial: bool
    discovery_reasons: list[Reason]
    selection_limited: bool


class LiveStage(Stage):
    index: Positive
    of: Positive


class LiveLevel(Closed):
    level: Positive
    state: Literal["running", "done"]
    hold_elapsed_s: Number
    hold_elapsed_pct: Percent
    dashboard_opens: Count
    filter_changes: Count
    charts_drawn: Count
    charts_failed: Count
    errors_by_class: Errors
    open_p50_ms: Optional[Number]
    open_p95_ms: Optional[Number]
    filter_p95_ms: Optional[Number]
    requests: None
    error_rate_pct: None
    per_minute: Number
    result: None


class Records(Closed):
    received: Count
    dropped: Count
    malformed: Count
    uploaded: Count


class LiveMeasurement(Closed):
    basis: Literal["completed_records"]
    complete: bool
    percentiles_complete: bool


class TokenVersions(Closed):
    session_cookie: Positive


class LiveAuth(Closed):
    state: Literal["checking", "ok", "retrying", "rejected", "recovered"]
    token_versions: TokenVersions
    session_expires_at: Optional[Time]
    rejected_at: Optional[Time]
    recovered_at: Optional[Time]
    wait_deadline_at: Optional[Time]
    incidents: Count
    refresh_ok: Count
    refresh_failed: Count


class Dropped(Closed):
    log_lines: Count


class Progress(Closed):
    target_kind: Kind
    phase: Literal[
        "preflight",
        "baseline",
        "ramp",
        "hold",
        "cooldown",
        "steady",
        "stopping",
        "finishing",
    ]
    step: Optional[
        Literal[
            "certificate_check", "sign_in", "discovery", "plan_check", "starting_k6"
        ]
    ]
    message: Text
    error_code: Optional[str]
    elapsed_s: Number
    preflight_elapsed_s: Number
    planned_s: Optional[Number]
    stage: Optional[LiveStage]
    level: Optional[Positive]
    users: Optional[Count]
    users_sample_age_s: Optional[Number]
    users_max: Positive
    discovery_counts: Optional[DiscoveryCounts]
    discovery_ready: bool
    dashboard_opens: Count
    filter_changes: Count
    charts_drawn: Count
    charts_failed: Count
    errors_by_class: Errors
    requests: None
    error_rate_pct: None
    open_p50_ms: Optional[Number]
    open_p95_ms: Optional[Number]
    filter_p95_ms: Optional[Number]
    levels: list[LiveLevel] = Field(max_length=200)
    records: Records
    measurement: LiveMeasurement
    auth: LiveAuth
    waiting_for_token: Optional[Literal["session_cookie"]]
    dropped: Dropped
    coverage: Literal["complete", "incomplete"]
    coverage_counts: CoverageCounts


class Step(Closed):
    seq: Positive
    at: Time
    elapsed_s: Number
    stage: StageName
    level: Optional[Positive]
    user_number: int = Field(ge=1, le=200)
    type: Literal["open", "filter", "error"]
    dashboard_id: ID
    title: str
    insight_id: Optional[ID]
    control: Optional[ID]
    step: Optional[
        Literal[
            "dashboard",
            "background",
            "logo",
            "last-update",
            "siblings",
            "wrapper",
            "layout",
            "dependencies",
            "callback",
            "filter",
        ]
    ]
    http_status: Optional[Annotated[int, Field(ge=0, le=599)]]
    error_class: Optional[ErrorClass]
    duration_ms: Optional[Number]
    charts: Optional[Count]
    charts_ok: Optional[Count]
    errors: Errors

    @model_validator(mode="after")
    def consistent(self):
        if self.type == "error":
            if (
                self.step is None
                or self.http_status is None
                or self.error_class is None
                or any(
                    v is not None
                    for v in (
                        self.control,
                        self.duration_ms,
                        self.charts,
                        self.charts_ok,
                    )
                )
                or any(self.errors.model_dump().values())
            ):
                raise ValueError("Invalid error record")
        else:
            if (
                any(
                    v is not None
                    for v in (
                        self.insight_id,
                        self.step,
                        self.http_status,
                        self.error_class,
                    )
                )
                or self.duration_ms is None
                or self.charts is None
            ):
                raise ValueError("Invalid operation record")
            if self.type == "open" and (
                self.control is not None
                or self.charts_ok is None
                or self.charts_ok > self.charts
            ):
                raise ValueError("Invalid open record")
            if self.type == "filter" and (
                self.control is None or self.charts_ok is not None
            ):
                raise ValueError("Invalid filter record")
        return self


class Identity(Closed):
    run_id: str = Field(min_length=1, max_length=36)
    run_number: Positive
    project_name: str = Field(max_length=200)
    target_name: str = Field(max_length=200)


class Headline(Closed):
    safe_load_users: Optional[Count]
    recommended_max_users: Optional[Count]
    breaking_level_users: Optional[Positive]
    breaking_reason: Optional[Literal["latency", "errors", "both"]]
    p95_at_safe_load_ms: Optional[Number]
    p95_at_break_ms: Optional[Number]
    error_rate_pct: Optional[Percent]
    open_p95_ms: Optional[Number]
    filter_p95_ms: Optional[Number]
    opens_measured: Count
    opens_total: Count
    filters_total: Count
    charts_drawn: Count
    charts_failed: Optional[Count]
    duration_s: Number
    max_users: Positive
    highest_tested_users: Count


class Threshold(Closed):
    scope: Literal["run", "level"]
    level: Optional[Positive]
    metric: Literal[
        "dashboard_ready", "j_level_ready", "journey_errors", "j_level_errors"
    ]
    expression: str
    measured: Optional[Number]
    ok: Optional[bool]


class Level(Closed):
    level: Positive
    role: Literal["hold", "steady"]
    start_s: Number
    end_s: Number
    actual_duration_s: Number
    hold_elapsed_pct: Percent
    per_minute: Number
    has_data: bool
    passed: bool
    latency_breach: bool
    error_breach: bool
    auth_contaminated: bool
    result: Literal["auth", "no_data", "pass", "break"]
    requests: Count
    request_outcomes: Count
    failed_request_outcomes: Count
    dashboards_opened: Count
    filters_applied: Count
    charts_drawn: Count
    chart_unavailable_errors: Count
    charts_failed: Optional[Count]
    errors_by_class: Errors
    open_p50_ms: Optional[Number]
    open_p95_ms: Optional[Number]
    open_p99_ms: Optional[Number]
    open_max_ms: Optional[Number]
    filter_p50_ms: Optional[Number]
    filter_p95_ms: Optional[Number]
    filter_max_ms: Optional[Number]
    error_rate_pct: Optional[Percent]
    auth_error_rate_pct: Optional[Percent]
    auth_waits: Count
    auth_wait_recovered: Count


class Overall(Closed):
    request_outcomes: Count
    failed_request_outcomes: Count
    error_rate_pct: Optional[Percent]
    errors_by_class: Errors
    chart_unavailable_errors: Count


class Counts(Closed):
    planned_iterations: Optional[Count]
    completed_iterations: Count
    records_received: Count
    records_dropped: Count


class Incident(Closed):
    first_failure_s: Number
    last_failure_s: Number
    contaminated_levels: list[Positive]
    clean_levels: list[Positive]


class Handoff(Closed):
    phase: Literal["discovery", "load"]
    rejected_at: Time
    recovered_at: Optional[Time]
    deadline_at: Time
    outcome: Literal["recovered", "timed_out", "run_ended", "stopped"]


class Auth(Closed):
    recovered: Count
    unrecovered: Count
    broker_pickups: Count
    refreshes: Count
    refresh_failures: Count
    waits: Count
    wait_recovered: Count
    incident: Optional[Incident]
    handoffs: list[Handoff] = Field(max_length=100)
    handoffs_omitted: Count


class Measurements(Closed):
    source_complete: bool
    percentiles_complete: bool
    percentile_basis: Literal["all_completed_steps"]
    reason: Optional[Literal["source_records_missing", "sample_limit"]]
    records_retained: Count


class DashboardResult(Closed):
    dashboard_id: ID
    title: Title
    opens: Count
    filters: Count
    open_p50_ms: Optional[Number]
    open_p95_ms: Optional[Number]
    filter_p95_ms: Optional[Number]
    charts_drawn: Count
    charts_failed: Optional[Count]
    errors_by_class: Errors
    charts_unusable: Count
    detail_loaded: bool
    measurement_complete: bool


class Summary(Closed):
    schema: Literal[1]
    target_kind: Kind
    test_type: Literal["smoke", "breakpoint"]
    identity: Identity
    verdict: Literal[
        "not_reached",
        "breakpoint_found",
        "invalid_auth",
        "invalid_no_data",
        "pass",
        "fail",
    ]
    verdict_reason: Text
    source_verdict_reason: Text
    ended_by: Literal["plan", "auto_stop", "stop", "runner", "error"]
    exit_code: Optional[int]
    started_at: Time
    ended_at: Time
    target_url: str
    headline: Headline
    thresholds: list[Threshold]
    levels: list[Level] = Field(max_length=200)
    overall: Overall
    auth: Auth
    counts: Counts
    plan: ResolvedPlan
    coverage: Literal["complete", "incomplete"]
    coverage_counts: CoverageCounts
    measurements: Measurements
    dashboards: list[DashboardResult] = Field(max_length=10000)
