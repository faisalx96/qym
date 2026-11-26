"""Dashboard read projections; large discovery/result tables are paged separately."""

from __future__ import annotations

from datetime import timedelta
from functools import cmp_to_key
from typing import Any

from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import PerformanceDashboardStep as Step
from qym_platform.db.models import PerformanceRun
from qym_platform.services import performance_platform as p
from qym_platform.services import performance_platform_ingest as ingest
from qym_platform.services import performance_platform_schema as schema
from qym_platform.services import performance_state as state
from qym_platform.services import performance_targets as targets
from qym_platform.services import performance_views as views
from qym_platform.settings import PlatformSettings
from sqlalchemy import case, func, or_, select

STEP_FIELDS = tuple(schema.Step.model_fields)


def without_rows(value):
    return {k: v for k, v in value.items() if k != "dashboards"} if value else None


def target_of(run):
    t = run.config["target"]
    return {k: t[k] for k in ("id", "name", "kind", "is_production", "base_url")}


def run_row(run, now, names, reports):
    summary = run.summary or {}
    coverage, counts = (
        ingest.coverage(run.discovery, 0) if run.discovery else (None, None)
    )
    if summary:
        coverage, counts = summary["coverage"], summary["coverage_counts"]
    elif run.progress:
        coverage, counts = run.progress.get("coverage", coverage), run.progress.get(
            "coverage_counts", counts
        )
    row = dict(
        id=run.id,
        number=run.number,
        target_kind=p.KIND,
        test_type=run.test_type,
        status=state.effective_status(run, now=now),
        verdict=run.verdict,
        target=target_of(run),
        requested_by=names.get(run.requested_by_user_id or ""),
        requested_by_user_id=run.requested_by_user_id,
        requested_at=to_api_timestamp(run.requested_at),
        started_at=to_api_timestamp(run.started_at),
        finished_at=to_api_timestamp(state.effective_finished_at(run, now=now)),
        discovery_counts=run.discovery["counts"] if run.discovery else None,
        coverage=coverage,
        coverage_counts=counts,
        status_reason=views.status_reason(
            run, state.effective_status(run, now=now), names
        ),
        note=run.config.get("note", ""),
        has_report=run.id in reports,
    )
    for key in (
        "duration_s",
        "safe_load_users",
        "breaking_level_users",
        "breaking_reason",
        "recommended_max_users",
        "p95_at_safe_load_ms",
        "p95_at_break_ms",
        "open_p95_ms",
        "filter_p95_ms",
        "error_rate_pct",
        "highest_tested_users",
        "opens_measured",
        "opens_total",
        "filters_total",
        "charts_drawn",
        "charts_failed",
    ):
        row[key] = getattr(run, key)
    row["max_users"] = run.config["plan"].get("max_users", 1)
    return row


def active(run, now, names):
    row = run_row(run, now, names, set())
    result = {
        k: row[k]
        for k in (
            "id",
            "number",
            "target_kind",
            "test_type",
            "status",
            "target",
            "requested_by",
            "requested_by_user_id",
            "requested_at",
            "started_at",
        )
    }
    result.update(
        progress=run.progress or None,
        seconds_since_report=views._seconds_since(run.last_report_at, now),
        stop_requested=run.stop_requested_at is not None,
        token_needed=run.token_needed,
    )
    return result


def expired(run, now):
    return run.finished_at is not None and run.finished_at < now - timedelta(
        days=PlatformSettings().performance_detail_retention_days
    )


def complete_run_read(db, project, run, value, now):
    value["summary"] = without_rows(run.summary)
    value["discovery"] = without_rows(run.discovery)
    value["dashboard_results"] = dict(
        total=len((run.discovery or {}).get("dashboards", [])),
        url=f"/api/projects/{project.slug}/performance/runs/{run.id}/dashboards",
    )
    value["counts"].pop("questions_received")
    value["counts"].pop("questions_dropped")
    stored = (
        0
        if expired(run, now)
        else db.scalar(select(func.count(Step.id)).where(Step.run_id == run.id)) or 0
    )
    value["counts"].update(
        steps_received=run.steps_received,
        steps_dropped=run.steps_dropped,
        steps_stored=stored,
    )
    return value


def setup(db, project, existing, now):
    cfg = PlatformSettings()
    runner = views.project_runner(db, project.id)
    capable = p.KIND in p.supported(runner)
    blocked = existing["blocked"]
    if not capable:
        blocked = dict(
            code="runner_kind_unsupported",
            message=p.MESSAGES["runner_kind_unsupported"],
        )
    ranges = {k: list(v) for k, v in p.RANGES.items()}
    for k in ("baseline_users", "max_users", "step_users"):
        ranges[k][1] = min(200, cfg.performance_max_users)
    ranges["smoke_max_duration_seconds"][1] = cfg.performance_max_duration_seconds
    ranges["max_dashboards"][1] = cfg.performance_platform_max_dashboards
    limits = p.limits(cfg)
    ranges.update(
        max_total_seconds=cfg.performance_max_duration_seconds,
        **{
            k: limits[k]
            for k in (
                "dashboards_per_run_max",
                "discovery_max_bytes",
                "steps_per_run_max",
            )
        },
    )
    existing["platform"] = dict(
        supported=capable,
        blocked=blocked,
        defaults=dict(
            test_type="breakpoint",
            breakpoint=p.defaults("breakpoint"),
            smoke=p.defaults("smoke"),
        ),
        limits=ranges,
        target_defaults=dict(settings=p.target_settings({})),
    )
    return existing


def home(db, project, access, result, now):
    all_targets = targets.list_targets(db, project.id)
    chat = [t for t in all_targets if t.kind != p.KIND]
    platform = [t for t in all_targets if t.kind == p.KIND]
    result["targets"] = targets.target_summaries(
        db, chat, now
    ) + targets.target_payloads(
        db,
        platform,
        now=now,
        can_write=access.can_start,
        is_manager=access.manager,
        full=True,
    )
    eligible = list(
        db.scalars(
            select(PerformanceRun)
            .where(
                PerformanceRun.project_id == project.id,
                PerformanceRun.test_type == "breakpoint",
                PerformanceRun.status == "finished",
                PerformanceRun.verdict.in_(["breakpoint_found", "not_reached"]),
                PerformanceRun.finished_at.is_not(None),
            )
            .order_by(PerformanceRun.finished_at.desc(), PerformanceRun.number.desc())
        )
    )
    latest = {}
    for run in eligible:
        latest.setdefault((run.target_id, run.target_kind), run)
    cards = []
    for target in all_targets:
        run = latest.get((target.id, target.kind))
        t = dict(
            id=target.id,
            name=target.name,
            kind=target.kind,
            is_production=target.is_production,
            base_url=target.base_url,
        )
        found = None
        if run:
            found = dict(
                run_id=run.id,
                number=run.number,
                finished_at=to_api_timestamp(run.finished_at),
                verdict=run.verdict,
                safe_load_users=run.safe_load_users,
                breaking_level_users=run.breaking_level_users,
                recommended_max_users=run.recommended_max_users,
                p95_at_safe_load_ms=run.p95_at_safe_load_ms,
                highest_tested_users=(
                    run.highest_tested_users
                    if run.target_kind == p.KIND
                    else run.max_users
                ),
                coverage=(run.summary or {}).get("coverage"),
            )
        cards.append(
            dict(
                target=t,
                kind=target.kind,
                metric="dashboard_open_p95" if target.kind == p.KIND else "answer_p95",
                label=(
                    "Dashboard open p95 at safe load"
                    if target.kind == p.KIND
                    else "Answer p95 at safe load"
                ),
                result=found,
            )
        )
    result["capacity_cards"] = cards
    runs = [r for r in eligible if r.target_kind == p.KIND][:20]
    result["platform_safe_load_trend"] = [
        dict(
            run_id=r.id,
            number=r.number,
            target_id=r.target_id,
            kind=p.KIND,
            finished_at=to_api_timestamp(r.finished_at),
            safe_load_users=r.safe_load_users,
            breaking_level_users=r.breaking_level_users,
            max_users=r.max_users,
            coverage=(r.summary or {}).get("coverage"),
        )
        for r in reversed(runs)
    ]
    return result


def page_rows(rows, filters):
    page, size = filters["page"], filters["page_size"]
    return dict(
        rows=rows[(page - 1) * size : page * size],
        total=len(rows),
        page=page,
        page_size=size,
    )


def matches(row, query, id_key):
    return (
        not query
        or query.casefold() in row["title"].casefold()
        or query.casefold() in p.canonical(row[id_key]).casefold()
    )


def discovery_page(run, filters):
    p.require_kind(run)
    rows = (run.discovery or {}).get("dashboards", [])
    rows = [
        r
        for r in rows
        if matches(r, filters.get("q"), "id")
        and (filters.get("runnable") is None or r["runnable"] == filters["runnable"])
    ]
    return dict(discovery=without_rows(run.discovery), **page_rows(rows, filters))


def step_row(row):
    value = {k: getattr(row, k) for k in STEP_FIELDS}
    value["at"] = to_api_timestamp(row.at)
    return value


def step_conditions(run, filters):
    conditions = [Step.run_id == run.id]
    for name in ("type", "stage", "level", "error_class"):
        if filters.get(name):
            conditions.append(getattr(Step, name).in_(filters[name]))
    if filters.get("dashboard"):
        conditions.append(Step.dashboard_key.in_(filters["dashboard"]))
    if filters.get("after_seq") is not None:
        conditions.append(Step.seq > filters["after_seq"])
    if filters.get("q"):
        pattern = views._like(filters["q"])
        conditions.append(
            or_(
                Step.title.ilike(pattern, escape="\\"),
                Step.dashboard_key.ilike(pattern, escape="\\"),
            )
        )
    if filters.get("has_errors") is not None:
        errors = or_(
            Step.type == "error",
            *(Step.errors[k].as_integer() > 0 for k in p.ERROR_CLASSES),
        )
        conditions.append(errors if filters["has_errors"] else ~errors)
    return conditions


def step_order(sort):
    col = Step.duration_ms if sort.lstrip("-") == "duration_ms" else Step.seq
    return (
        case((col.is_(None), 1), else_=0),
        col.desc() if sort.startswith("-") else col.asc(),
        Step.seq.asc(),
    )


def steps_page(db, run, filters, now):
    p.require_kind(run)
    if expired(run, now):
        return dict(
            rows=[],
            total=0,
            page=filters["page"],
            page_size=filters["page_size"],
            last_seq=0,
            counts=dict(
                received=run.steps_received, dropped=run.steps_dropped, retained=0
            ),
            facets=dict(types=[], stages=[], levels=[], error_classes=[]),
            details_expired=True,
        )
    conditions = step_conditions(run, filters)
    total = db.scalar(select(func.count(Step.id)).where(*conditions)) or 0
    rows = db.scalars(
        select(Step)
        .where(*conditions)
        .order_by(*step_order(filters["sort"]))
        .offset((filters["page"] - 1) * filters["page_size"])
        .limit(filters["page_size"])
    )
    facets = {}
    for key, column, order in (
        ("types", Step.type, p.TYPES),
        ("stages", Step.stage, p.STAGES),
        ("levels", Step.level, None),
        ("error_classes", Step.error_class, p.ERROR_CLASSES),
    ):
        values = set(
            db.scalars(
                select(column)
                .where(Step.run_id == run.id, column.is_not(None))
                .distinct()
            )
        )
        facets[key] = [v for v in order if v in values] if order else sorted(values)
    retained, last_seq = db.execute(
        select(func.count(Step.id), func.max(Step.seq)).where(Step.run_id == run.id)
    ).one()
    return dict(
        rows=[step_row(r) for r in rows],
        total=total,
        page=filters["page"],
        page_size=filters["page_size"],
        last_seq=last_seq or 0,
        counts=dict(
            received=run.steps_received, dropped=run.steps_dropped, retained=retained
        ),
        facets=facets,
        details_expired=expired(run, now),
    )


def steps_export(db, run, filters, now):
    p.require_kind(run)
    yield list(STEP_FIELDS)
    if expired(run, now):
        return
    rows = db.scalars(
        select(Step)
        .where(*step_conditions(run, filters))
        .order_by(*step_order(filters["sort"]))
        .execution_options(yield_per=500)
    )
    for row in rows:
        value = step_row(row)
        yield [
            views.csv_safe(
                ""
                if value[k] is None
                else (
                    p.canonical(value[k])
                    if isinstance(value[k], (dict, list))
                    else str(value[k])
                )
            )
            for k in STEP_FIELDS
        ]


def percentile(samples, percent):
    if not samples:
        return None
    samples = sorted(samples)
    rank = (len(samples) - 1) * percent
    index = int(rank)
    return samples[index] + (rank - index) * (
        samples[min(index + 1, len(samples) - 1)] - samples[index]
    )


def dashboards_page(db, run, filters, now):
    p.require_kind(run)
    if run.summary:
        rows = run.summary["dashboards"]
        source = "summary"
        coverage, counts = run.summary["coverage"], run.summary["coverage_counts"]
        complete = run.summary["measurements"]["source_complete"]
    else:
        source = "retained_steps"
        complete = (
            not run.steps_dropped
            and not expired(run, now)
            and not (run.progress or {}).get("records", {}).get("dropped", 0)
        )
        rows, by_id, samples = [], {}, {}
        for d in (run.discovery or {}).get("dashboards", []):
            row = dict(
                dashboard_id=d["id"],
                title=d["title"],
                opens=0,
                filters=0,
                charts_drawn=0,
                charts_failed=0,
                errors_by_class=dict.fromkeys(p.ERROR_CLASSES, 0),
                charts_unusable=len(d["charts_unusable"]),
                detail_loaded=d["detail_loaded"],
                measurement_complete=complete,
                open_p50_ms=None,
                open_p95_ms=None,
                filter_p95_ms=None,
            )
            key = p.canonical(d["id"])
            rows.append(row)
            by_id[key] = row
            samples[key] = ([], [])
        for step in (
            []
            if expired(run, now)
            else db.scalars(
                select(Step)
                .where(Step.run_id == run.id)
                .execution_options(yield_per=500)
            )
        ):
            row = by_id.get(step.dashboard_key)
            if row is None:
                continue
            if step.type == "open":
                row["opens"] += 1
                row["charts_drawn"] += step.charts_ok
                row["charts_failed"] += step.charts - step.charts_ok
                samples[step.dashboard_key][0].append(step.duration_ms)
            elif step.type == "filter":
                row["filters"] += 1
                samples[step.dashboard_key][1].append(step.duration_ms)
            else:
                row["errors_by_class"][step.error_class] += 1
        for key, row in by_id.items():
            opens, filters_sample = samples[key]
            row.update(
                open_p50_ms=percentile(opens, 0.5),
                open_p95_ms=percentile(opens, 0.95),
                filter_p95_ms=percentile(filters_sample, 0.95),
            )
        coverage, counts = ingest.coverage(
            run.discovery, sum(r["opens"] > 0 for r in rows)
        )
    wanted = filters.get("dashboard", [])
    rows = [
        r
        for r in rows
        if matches(r, filters.get("q"), "dashboard_id")
        and (not wanted or p.canonical(r["dashboard_id"]) in wanted)
    ]
    sort = filters.get("sort", "title")
    key = sort.lstrip("-")

    def compare(a, b):
        x, y = a[key], b[key]
        if x is None or y is None:
            if x is not y:
                return 1 if x is None else -1
        elif x != y:
            sign = 1 if x > y else -1
            return -sign if sort.startswith("-") else sign
        x, y = p.canonical(a["dashboard_id"]), p.canonical(b["dashboard_id"])
        return (x > y) - (x < y)

    rows.sort(key=cmp_to_key(compare))
    return dict(
        **page_rows(rows, filters),
        source=source,
        coverage=coverage,
        coverage_counts=counts,
        records_complete=complete,
    )
