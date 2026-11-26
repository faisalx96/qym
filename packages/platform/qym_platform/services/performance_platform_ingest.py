"""Atomic discovery, bounded step detail, and validated dashboard measurements."""

from __future__ import annotations

import math
from copy import deepcopy
from datetime import datetime
from typing import Any

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from qym_platform.datetime_utils import to_storage_utc
from qym_platform.db.models import PerformanceDashboardStep
from qym_platform.services import performance_ingest as ingest
from qym_platform.services import performance_platform as p
from qym_platform.services import performance_platform_schema as schema
from qym_platform.services import performance_redaction as redaction
from qym_platform.services import performance_state as state
from qym_platform.services.performance_validation import safe_errors
from sqlalchemy import select


def checked(model, value):
    try:
        return model.model_validate(value).model_dump()
    except ValidationError as exc:
        raise RequestValidationError(safe_errors(model, exc)) from None


def mismatch(message="Measurements do not match the saved discovery or plan"):
    raise RequestValidationError(
        [{"loc": ("body",), "type": "value_error", "msg": message}]
    )


def coverage(discovery, exercised):
    if discovery is None:
        c = dict(
            dashboards_selected=0,
            dashboards_runnable=0,
            dashboards_exercised=0,
            dashboards_unexercised=0,
            dashboards_unusable=0,
            charts_found=0,
            charts_usable=0,
            charts_unusable=0,
            discovery_partial=True,
            discovery_reasons=["list_incomplete"],
            selection_limited=False,
        )
        return "incomplete", c
    counts = discovery["counts"]
    c = {
        k: counts[k]
        for k in (
            "dashboards_selected",
            "dashboards_runnable",
            "charts_found",
            "charts_usable",
            "charts_unusable",
        )
    }
    c.update(
        dashboards_exercised=exercised,
        dashboards_unexercised=counts["dashboards_runnable"] - exercised,
        dashboards_unusable=counts["dashboards_selected"]
        - counts["dashboards_runnable"],
        discovery_partial=discovery["partial"],
        discovery_reasons=discovery["partial_reasons"],
        selection_limited=discovery["selection_limited"],
    )
    incomplete = (
        c["discovery_partial"]
        or c["charts_unusable"]
        or c["dashboards_unusable"]
        or c["dashboards_unexercised"]
        or any(not d["detail_loaded"] for d in discovery["dashboards"])
    )
    return "incomplete" if incomplete else "complete", c


def check_coverage(run, value, exercised=None):
    reported = value["coverage_counts"]
    if exercised is None:
        exercised = reported["dashboards_exercised"]
    if exercised > ((run.discovery or {}).get("counts") or {}).get(
        "dashboards_runnable", 0
    ):
        mismatch()
    expected, counts = coverage(run.discovery, exercised)
    if reported != counts or value["coverage"] != expected:
        mismatch("Coverage differs from discovery and exercised dashboards")


def sanitize(value, mask):
    """Redact free content while keeping validated protocol keys and literals."""
    value = deepcopy(value)
    for key in (
        "title",
        "message",
        "error_code",
        "source_verdict_reason",
        "verdict_reason",
        "target_url",
    ):
        if isinstance(value.get(key), str):
            value[key] = mask.text(value[key])
    for key in ("id", "dashboard_id", "insight_id", "control"):
        if key in value:
            value[key] = mask.json(value[key])
    if "identity" in value:
        value["identity"] = {
            key: mask.text(item) if isinstance(item, str) and key != "run_id" else item
            for key, item in value["identity"].items()
        }
    for key in ("dashboards", "charts_unusable"):
        if isinstance(value.get(key), list):
            value[key] = [sanitize(item, mask) for item in value[key]]
    for key in ("plan", "resolved_plan"):
        if value.get(key):
            value[key]["dashboard_ids"] = mask.json(value[key]["dashboard_ids"])
    return value


def store_discovery(db, run, payload, settings, now):
    p.require_kind(run)
    value = checked(schema.Discovery, payload)
    cap = p.limits(settings)
    c = value["counts"]
    if (
        max(c["dashboards_selected"], c["dashboards_discovered"])
        > cap["dashboards_per_run_max"]
        or c["charts_found"] > cap["chart_associations_per_run_max"]
    ):
        raise p.refusal("discovery_limit_exceeded", 422)
    frozen = run.config["plan"]
    selected_cap = frozen["max_dashboards"]
    if selected_cap is not None and c["dashboards_selected"] > selected_cap:
        mismatch()
    runnable = [d for d in value["dashboards"] if d["runnable"]]
    resolved = value["resolved_plan"]
    if resolved is not None:
        if not runnable:
            raise p.refusal("plan_mismatch", 422)
        expected = p.resolve_plan(
            run.test_type,
            frozen,
            [d["id"] for d in runnable],
            max(d["filters_found"] for d in runnable),
            run.config["target"]["max_duration_s"],
            resolved["theme"],
        )
        if resolved != expected:
            raise p.refusal("plan_mismatch", 422)
    mask = redaction.masker(db, target_id=run.target_id)
    value = sanitize(value, mask)
    for row in value["dashboards"]:
        if len(row["title"]) > 500:
            row["title"] = row["title"][:500]
            value["titles_truncated"] += 1
    if run.discovery is not None:
        if run.discovery != value:
            raise p.refusal("discovery_conflict")
        return
    run.discovery = value
    state.add_event(
        db,
        runner_id=run.runner_id,
        run_id=run.id,
        at=now,
        code="discovery_partial" if value["partial"] else "discovery_completed",
        message=(
            "Dashboard discovery is incomplete"
            if value["partial"]
            else "Dashboard discovery finished"
        ),
        details={"counts": c},
    )
    db.flush()


def require_discovery(run):
    p.require_kind(run)
    if not run.discovery or not run.discovery.get("resolved_plan"):
        raise p.refusal("discovery_required")


def store_steps(db, run, records, settings, now):
    require_discovery(run)
    if not isinstance(records, list) or not 1 <= len(records) <= 200:
        raise ingest.refusal("too_many_records")
    mask = redaction.masker(db, target_id=run.target_id)
    dashboards = {p.canonical(d["id"]): d for d in run.discovery["dashboards"]}
    seqs = [
        r.get("seq")
        for r in records
        if isinstance(r, dict) and type(r.get("seq")) is int
    ]
    known = ingest._stored_seqs(db, PerformanceDashboardStep, run.id, seqs)
    cap = settings.performance_platform_steps_per_run_max
    room = cap - run.steps_received
    answer = dict(accepted=0, duplicates=0, rejected=0, dropped=0, results=[])
    dropped = []
    for raw in records:
        seq = (
            raw.get("seq")
            if isinstance(raw, dict) and type(raw.get("seq")) is int
            else None
        )
        try:
            if len(p.canonical(raw).encode("utf-8")) > 8192:
                raise ValueError("Record exceeds maximum size")
            value = schema.Step.model_validate(raw).model_dump()
            value = sanitize(value, mask)
            key = p.canonical(value["dashboard_id"])
            dashboard = dashboards.get(key)
            if dashboard is None or not dashboard["runnable"]:
                raise ValueError("Dashboard does not match discovery")
            value["title"] = dashboard["title"]
        except ValidationError as exc:
            unknown = sum(
                error["type"] == "extra_forbidden"
                for error in exc.errors(include_input=False)
            )
            answer["rejected"] += 1
            message = (
                f"Unknown fields are not allowed (count: {unknown})"
                if unknown
                else "Invalid dashboard step"
            )
            answer["results"].append(dict(seq=seq, status="rejected", error=message))
            continue
        except (ValueError, TypeError, OverflowError, RecursionError):
            answer["rejected"] += 1
            answer["results"].append(
                dict(seq=seq, status="rejected", error="Invalid dashboard step")
            )
            continue
        if seq in known:
            answer["duplicates"] += 1
            status = "duplicate"
        elif room <= 0:
            answer["dropped"] += 1
            dropped.append(seq)
            status = "dropped"
        else:
            known.add(seq)
            room -= 1
            value["at"] = to_storage_utc(
                datetime.fromisoformat(value["at"].replace("Z", "+00:00"))
            )
            db.add(PerformanceDashboardStep(run_id=run.id, dashboard_key=key, **value))
            answer["accepted"] += 1
            status = "created"
        answer["results"].append(dict(seq=seq, status=status, error=None))
    new_drops = ingest._new_drops(
        db, run, what="steps", limit=cap, seqs=dropped, now=now
    )
    run.steps_received += answer["accepted"] + new_drops
    run.steps_dropped += new_drops
    if answer["rejected"]:
        state.add_event(
            db,
            runner_id=run.runner_id,
            run_id=run.id,
            at=now,
            code="records_dropped",
            level="warning",
            message="Some dashboard steps could not be recorded",
            details={"count": answer["rejected"]},
        )
    db.flush()
    return answer


def check_progress(run, value, status):
    p.require_kind(run)
    if not value:
        if status == "running":
            require_discovery(run)
        return
    checked(schema.Progress, value)
    if status == "running" or value["discovery_ready"]:
        require_discovery(run)
    check_coverage(run, value)
    if (
        value["discovery_ready"]
        and value["discovery_counts"] != run.discovery["counts"]
    ):
        mismatch()
    resolved = (run.discovery or {}).get("resolved_plan")
    if value["planned_s"] != (resolved["total_seconds"] if resolved else None):
        mismatch()
    if value["users_max"] != run.config["plan"].get("max_users", 1):
        mismatch()
    if (
        value["users_sample_age_s"] is not None
        and value["users_sample_age_s"] > 5
        and value["users"] is not None
    ):
        mismatch("A stale user gauge must be null")
    if (value["phase"] == "preflight") != (value["step"] is not None):
        mismatch()
    seen = [r["level"] for r in value["levels"]]
    if len(set(seen)) != len(seen):
        mismatch()
    old = run.progress or {}
    counters = ("dashboard_opens", "filter_changes", "charts_drawn", "charts_failed")

    def decreased(before, after):
        return any(after.get(k, 0) < before.get(k, 0) for k in counters) or any(
            after.get("errors_by_class", {}).get(k, 0)
            < before.get("errors_by_class", {}).get(k, 0)
            for k in p.ERROR_CLASSES
        )

    if decreased(old, value) or any(
        value["records"][k] < old.get("records", {}).get(k, 0) for k in value["records"]
    ):
        raise ingest.refusal("counters_must_not_decrease")
    levels = {r["level"]: r for r in value["levels"]}
    for row in old.get("levels", []):
        if row["level"] not in levels or decreased(row, levels[row["level"]]):
            raise ingest.refusal("counters_must_not_decrease")


def close_number(a, b):
    return (
        a is None
        and b is None
        or a is not None
        and b is not None
        and math.isclose(a, b, rel_tol=1e-8, abs_tol=1e-8)
    )


def store_summary(db, run, payload):
    require_discovery(run)
    value = checked(schema.Summary, payload)
    if value["target_url"] != run.config["target"]["base_url"]:
        mismatch()
    mask = redaction.masker(db, target_id=run.target_id)
    value = sanitize(value, mask)
    h, plan, rows = value["headline"], run.config["plan"], value["levels"]
    resolved = run.discovery["resolved_plan"]
    if (
        value["test_type"] != run.test_type
        or value["plan"] != resolved
        or value["identity"]["run_id"] != run.id
        or value["identity"]["run_number"] != run.number
    ):
        mismatch()
    if [r["level"] for r in rows] != resolved["levels"]:
        mismatch()
    discovered = run.discovery["dashboards"]
    if [p.canonical(r["dashboard_id"]) for r in value["dashboards"]] != [
        p.canonical(d["id"]) for d in discovered
    ]:
        mismatch()
    for row, d in zip(value["dashboards"], discovered):
        if (
            row["title"] != d["title"]
            or row["detail_loaded"] != d["detail_loaded"]
            or row["charts_unusable"] != len(d["charts_unusable"])
        ):
            mismatch()
        if not row["opens"] and any(
            row[k] is not None for k in ("open_p50_ms", "open_p95_ms")
        ):
            mismatch()
    check_coverage(run, value, sum(r["opens"] > 0 for r in value["dashboards"]))
    if (
        h["max_users"] != plan.get("max_users", 1)
        or h["highest_tested_users"]
        != max([r["level"] for r in rows if r["has_data"]] or [0])
        or h["opens_measured"] != sum(r["dashboards_opened"] for r in rows)
    ):
        mismatch()
    expected_thresholds = []

    def gates(scope, level, ready, errors):
        for metric, expression, measured, limit in (
            (
                "dashboard_ready" if scope == "run" else "j_level_ready",
                f'p(95)<{plan["limit_ms"]:g}',
                ready,
                plan["limit_ms"],
            ),
            (
                "journey_errors" if scope == "run" else "j_level_errors",
                f'rate<{plan["max_error_rate_pct"] / 100:g}',
                None if errors is None else errors / 100,
                plan["max_error_rate_pct"] / 100,
            ),
        ):
            expected_thresholds.append(
                dict(
                    scope=scope,
                    level=level,
                    metric=metric,
                    expression=expression,
                    measured=measured,
                    ok=None if measured is None else measured < limit,
                )
            )

    gates("run", None, h["open_p95_ms"], value["overall"]["error_rate_pct"])
    planned_holds = [s for s in resolved["stages"] if s["role"] == "hold"]
    for i, row in enumerate(rows):
        expected_result = (
            "auth"
            if row["auth_contaminated"]
            else (
                "no_data"
                if not row["has_data"]
                else "pass" if row["passed"] else "break"
            )
        )
        if row["result"] != expected_result:
            mismatch()
        if not row["has_data"] and (
            row["passed"] or row["latency_breach"] or row["error_breach"]
        ):
            mismatch()
        if (
            row["has_data"]
            and not row["auth_contaminated"]
            and row["passed"] == (row["latency_breach"] or row["error_breach"])
        ):
            mismatch("Level result differs from its breach flags")
        if run.test_type == "breakpoint":
            hold = planned_holds[i]
            if (row["role"], row["start_s"], row["end_s"]) != (
                "hold",
                hold["start_s"],
                hold["end_s"],
            ):
                mismatch()
        elif row["role"] != "steady":
            mismatch()
        actual = max(
            0, min(h["duration_s"] - row["start_s"], row["end_s"] - row["start_s"])
        )
        duration = row["end_s"] - row["start_s"]
        if (
            not close_number(row["actual_duration_s"], actual)
            or not close_number(
                row["hold_elapsed_pct"], 100 * actual / duration if duration else 0
            )
            or not close_number(
                row["per_minute"],
                row["dashboards_opened"] * 60 / actual if actual else 0,
            )
        ):
            mismatch()
        gates("level", row["level"], row["open_p95_ms"], row["error_rate_pct"])
    for row in [value["overall"], *rows]:
        denominator, numerator = row["request_outcomes"], row["failed_request_outcomes"]
        if numerator > denominator or not close_number(
            row["error_rate_pct"],
            100 * numerator / denominator if denominator else None,
        ):
            mismatch()
    if not close_number(h["error_rate_pct"], value["overall"]["error_rate_pct"]):
        mismatch()
    if len(value["thresholds"]) != len(expected_thresholds):
        mismatch()
    for got, expected in zip(value["thresholds"], expected_thresholds):
        if any(
            got[k] != expected[k]
            for k in ("scope", "level", "metric", "expression", "ok")
        ) or not close_number(got["measured"], expected["measured"]):
            mismatch("Thresholds differ from frozen limits")
    if run.test_type == "smoke":
        if value["verdict"] not in ("pass", "fail") or any(
            h[k] is not None
            for k in (
                "safe_load_users",
                "recommended_max_users",
                "breaking_level_users",
                "breaking_reason",
                "p95_at_safe_load_ms",
                "p95_at_break_ms",
            )
        ):
            mismatch()
        reason = (
            "Passed"
            if value["verdict"] == "pass"
            else "Failed: " + value["source_verdict_reason"]
        )
    else:
        if value["verdict"] not in (
            "not_reached",
            "breakpoint_found",
            "invalid_auth",
            "invalid_no_data",
        ):
            mismatch()
        safe = h["safe_load_users"]
        if h["recommended_max_users"] != (
            max(1, math.floor(safe * 0.8)) if safe is not None and safe >= 1 else 0
        ):
            mismatch()
        by_level = {r["level"]: r for r in rows}
        safe_row = by_level.get(safe)
        if safe and (
            not safe_row
            or not safe_row["has_data"]
            or not safe_row["passed"]
            or safe_row["auth_contaminated"]
            or safe_row["actual_duration_s"] <= 0
        ):
            mismatch("Safe load must be a tested, passing level with working sign-in")
        clean = [r for r in rows if r["has_data"] and not r["auth_contaminated"]]
        breaks = [r for r in clean if not r["passed"]]
        if value["verdict"] == "not_reached" and (
            not clean
            or breaks
            or safe != max((r["level"] for r in clean if r["passed"]), default=0)
        ):
            mismatch("Verdict differs from measured levels")
        if value["verdict"] == "invalid_no_data" and (
            any(r["has_data"] for r in rows) or safe
        ):
            mismatch("No measurement cannot have tested capacity")
        if value["verdict"] == "invalid_auth" and not (
            any(r["auth_contaminated"] for r in rows)
            or value["auth"]["unrecovered"]
            # A wait for a new sign-in that never ended (the hand-off ran out before any level).
            or value["auth"]["waits"] > value["auth"]["wait_recovered"]
        ):
            mismatch("Sign-in verdict requires an affected measurement")
        if not close_number(
            h["p95_at_safe_load_ms"],
            safe_row["open_p95_ms"] if safe_row and safe else None,
        ):
            mismatch()
        if value["verdict"] == "breakpoint_found":
            breaking = by_level.get(h["breaking_level_users"])
            if (
                not breaking
                or not breaks
                or breaking != breaks[0]
                or breaking["result"] != "break"
                or breaking["actual_duration_s"] <= 0
                or safe
                != max(
                    (
                        r["level"]
                        for r in clean
                        if r["passed"] and r["level"] < breaking["level"]
                    ),
                    default=0,
                )
            ):
                mismatch()
            why = (
                "both"
                if breaking["latency_breach"] and breaking["error_breach"]
                else "latency" if breaking["latency_breach"] else "errors"
            )
            if h["breaking_reason"] != why or not close_number(
                h["p95_at_break_ms"], breaking["open_p95_ms"]
            ):
                mismatch()
            reason = f'Breaks at {h["breaking_level_users"]} users ({"dashboard-open time" if why == "latency" else why})'
        else:
            if (
                h["breaking_level_users"] is not None
                or h["breaking_reason"] is not None
                or h["p95_at_break_ms"] is not None
            ):
                mismatch()
            reason = {
                "not_reached": f'No break up to {h["highest_tested_users"]} users',
                "invalid_auth": "Not valid: sign-in",
                "invalid_no_data": "No measurement",
            }[value["verdict"]]
    # The sentence is mapped by qym; the source sentence remains separately redacted.
    value["verdict_reason"] = mask.text(reason)[:2000]
    if value["measurements"]["source_complete"]:
        for count, key in (
            ("opens_total", "opens"),
            ("filters_total", "filters"),
            ("charts_drawn", "charts_drawn"),
        ):
            if h[count] != sum(d[key] for d in value["dashboards"]):
                mismatch()
    if not value["measurements"]["percentiles_complete"] and any(
        h[k] is not None for k in ("open_p95_ms", "filter_p95_ms")
    ):
        mismatch()
    if not value["measurements"]["percentiles_complete"]:
        if any(
            d["measurement_complete"]
            or any(
                d[k] is not None
                for k in ("open_p50_ms", "open_p95_ms", "filter_p95_ms")
            )
            for d in value["dashboards"]
        ):
            mismatch(
                "Incomplete percentile samples cannot supply dashboard percentiles"
            )
    if not value["measurements"]["source_complete"] and h["charts_failed"] is not None:
        mismatch()
    run.summary = value
    run.verdict = value["verdict"]
    for key, item in h.items():
        setattr(run, key, item)
    if run.exit_code is None:
        run.exit_code = value["exit_code"]
    db.flush()
    return run.verdict
