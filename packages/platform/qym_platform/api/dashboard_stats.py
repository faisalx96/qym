"""Small dashboard aggregates computed next to the data.

- ``POST /api/dashboard/models/stats``: K-run statistics per model or group for
  the Models view and the Charts "Grouped" columns (C035), instead of every
  selected run's item rows.
- ``POST /api/dashboard/trend``: the Overview trend, the primary metric and
  execution success per day of one task on one dataset, over the dashboard
  projection (C056).
- ``GET /api/dashboard/previous-run``: the run a run detail page compares
  with: the previous finished run of the same task, model and dataset (C057).
- ``POST /api/dashboard/neighbors``: the runs before and after one run in the
  Runs list order the reader came from, for the run page's previous / next
  arrows (C044).
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from qym_platform.api.dashboard import (
    _base_conditions,
    _body_parameters,
    _filter_conditions,
    _freshness,
    _ordered_query,
    _parse_collation,
    _parse_filters,
    _project,
    _query,
    _read_snapshot,
    _snapshot_project,
    _sort,
    _sort_columns,
)
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.dashboard_models import (
    DashboardRunDimension as Dimension,
    DashboardRunSummary as Summary,
)
from qym_platform.db.models import Run, RunWorkflowStatus
from qym_platform.deps import get_db
from qym_platform.permissions import can_view_run
from qym_platform.services.dashboard_cache import DashboardSnapshotCache
from qym_platform.services.metric_semantics import declared_direction, primary_metric
from qym_platform.services.model_stats import group_stats_for_runs
from qym_platform.settings import PlatformSettings

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_stats_cache = DashboardSnapshotCache()
_trend_cache = DashboardSnapshotCache()

MAX_STAT_GROUPS = 100
MAX_STAT_RUNS = 2000
TREND_RANGES = (7, 30, 90)
# Runs still executing carry partial means: trends and baselines skip them.
_UNFINISHED = (RunWorkflowStatus.RUNNING.value, RunWorkflowStatus.PENDING.value)


# --------------------------------------------------------------------------
# Models / Charts group statistics (C035)
# --------------------------------------------------------------------------


def _stats_request(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) - {
        "metric",
        "threshold",
        "is_boolean",
        "direction",
        "groups",
    }:
        raise HTTPException(400, "Invalid model statistics request")
    metric = payload.get("metric")
    if not isinstance(metric, str) or not metric or len(metric) > 400:
        raise HTTPException(400, "Invalid metric")
    threshold = payload.get("threshold", 0.8)
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(threshold)
    ):
        raise HTTPException(400, "Invalid threshold")
    is_boolean = payload.get("is_boolean", False)
    direction = payload.get("direction")
    if not isinstance(is_boolean, bool) or direction not in (
        None,
        "maximize",
        "minimize",
    ):
        raise HTTPException(400, "Invalid metric direction")
    groups = payload.get("groups")
    if not isinstance(groups, list) or not groups or len(groups) > MAX_STAT_GROUPS:
        raise HTTPException(400, f"Send 1 to {MAX_STAT_GROUPS} groups")
    seen = set()
    total = 0
    parsed = []
    for group in groups:
        if (
            not isinstance(group, dict)
            or set(group) - {"key", "runs"}
            or not isinstance(group.get("key"), str)
            or group["key"] in seen
            or not isinstance(group.get("runs"), list)
            or any(
                not isinstance(r, str) or not r or len(r) > 200 for r in group["runs"]
            )
        ):
            raise HTTPException(400, "Invalid model statistics group")
        seen.add(group["key"])
        runs = list(dict.fromkeys(group["runs"]))
        total += len(runs)
        parsed.append({"key": group["key"], "runs": runs})
    if total > MAX_STAT_RUNS:
        raise HTTPException(400, f"At most {MAX_STAT_RUNS} runs per request")
    return {
        "metric": metric,
        "threshold": float(threshold),
        "is_boolean": is_boolean,
        "direction": direction,
        "groups": parsed,
    }


@router.post("/models/stats")
def dashboard_model_stats(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """Pass@K, Pass^K, Max@K, consistency, reliability, averages, latency,
    error counts and the per-item correct-count histogram, per group.

    Same numbers as the browser computed from ``/api/models/runs`` before
    (``metrics.js``), in a response of a few hundred bytes per group. Runs the
    caller cannot read, or that are deleted, come back in ``missing``.
    """
    from qym_platform.api.runs import _build_models_runs_data

    request = _stats_request(payload)
    run_ids = list(
        dict.fromkeys(run_id for group in request["groups"] for run_id in group["runs"])
    )
    runs = Run.active(db).filter(Run.id.in_(run_ids)).all()
    # Access is per project: check each project once, not once per run.
    access: Dict[str, bool] = {}
    readable = {}
    for run in runs:
        if run.project_id not in access:
            access[run.project_id] = can_view_run(db, principal, run)
        if access[run.project_id]:
            readable[run.id] = run
    missing = [run_id for run_id in run_ids if run_id not in readable]
    ordered = [readable[run_id] for run_id in run_ids if run_id in readable]
    revisions = (
        dict(
            db.execute(
                select(Summary.run_key, Summary.projection_revision).where(
                    Summary.run_key.in_(list(readable))
                )
            ).all()
        )
        if readable
        else {}
    )

    def compute():
        return group_stats_for_runs(
            lambda chunk: _build_models_runs_data(db, chunk, metric=request["metric"]),
            ordered,
            request["groups"],
            request["metric"],
            request["threshold"],
            request["is_boolean"],
            request["direction"],
        )

    # Reuse a result while every run's projection revision is unchanged (a
    # score edit or a new event moves it). Runs without a published summary
    # are always recomputed.
    if ordered and all(revisions.get(run.id) for run in ordered):
        key = (
            db.get_bind().engine,
            json.dumps(
                [
                    request["metric"],
                    request["threshold"],
                    request["is_boolean"],
                    request["direction"],
                    [[g["key"], g["runs"]] for g in request["groups"]],
                    sorted((run.id, revisions[run.id]) for run in ordered),
                ],
                default=str,
            ),
        )
        stats = _stats_cache.get_or_compute(key, compute)
    else:
        stats = compute()
    return {"groups": stats, "missing": missing}


# --------------------------------------------------------------------------
# Overview trend (C056)
# --------------------------------------------------------------------------


def _number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _trend(
    db,
    project,
    days: int,
    task: Optional[str],
    dataset: Optional[str],
    offset: int,
    now: datetime,
):
    """Daily points for one task and dataset over ``days`` local days, plus the
    period before. One dataset at a time: runs on another dataset score other
    items, so mixing them would read a change of dataset as a change of quality.
    """
    local_now = now + timedelta(minutes=offset)
    first_day = local_now.date() - timedelta(days=days - 1)
    since = datetime.combine(first_day, datetime.min.time()) - timedelta(minutes=offset)
    previous_since = since - timedelta(days=days)
    until = since + timedelta(days=days)
    conditions = _base_conditions(project) + [~Dimension.status.in_(_UNFINISHED)]
    in_window = conditions + [Dimension.timestamp >= since, Dimension.timestamp < until]

    tasks = [
        {"task": name, "dataset": data_set, "runs": int(count)}
        for name, data_set, count in db.execute(
            _query(Dimension.task, Dimension.dataset, func.count())
            .where(*in_window)
            .group_by(Dimension.task, Dimension.dataset)
            .order_by(func.count().desc(), Dimension.task, Dimension.dataset)
        ).all()
    ]
    latest = db.execute(
        _query(Dimension.timestamp, Dimension.task, Dimension.dataset)
        .where(*conditions)
        .order_by(Dimension.timestamp.desc())
        .limit(1)
    ).first()
    # The chosen task and dataset; a task alone takes its busiest dataset.
    chosen = next(
        (
            entry
            for entry in tasks
            if entry["task"] == task and dataset in (None, entry["dataset"])
        ),
        None,
    )
    if chosen is not None:
        task, dataset = chosen["task"], chosen["dataset"]
    elif tasks:
        task, dataset = tasks[0]["task"], tasks[0]["dataset"]
    elif latest:
        task, dataset = latest[1], latest[2]
    else:
        task = dataset = None
    result: Dict[str, Any] = {
        "days": days,
        "since": since.replace(tzinfo=timezone.utc).isoformat(),
        "until": until.replace(tzinfo=timezone.utc).isoformat(),
        "tasks": tasks,
        "task": task,
        "dataset": dataset,
        "metric": None,
        "direction": None,
        "latest_run_at": (
            latest[0].replace(tzinfo=timezone.utc).isoformat() if latest else None
        ),
        "points": [],
        "summary": None,
    }
    if task is None:
        return result
    # The metric the task's newest run leads with (declared primary, else first).
    newest = db.execute(
        _query(Dimension.descriptor["metrics"], Dimension.descriptor["metric_specs"])
        .where(*conditions, Dimension.task == task, Dimension.dataset == dataset)
        .order_by(Dimension.timestamp.desc(), Dimension.created_at.desc())
        .limit(1)
    ).first()
    metrics, specs = newest or (None, None)
    metric = primary_metric(metrics or [], specs or {})
    result["metric"] = metric
    result["direction"] = (
        declared_direction((specs or {}).get(metric)) if metric else None
    )

    data = Summary.data
    rows = db.execute(
        _query(
            Dimension.timestamp,
            data["metric_averages"][metric].as_float() if metric else Dimension.run_key,
            func.coalesce(
                data["execution_count"].as_float(), data["total_items"].as_float()
            ),
            func.coalesce(
                data["execution_success_count"].as_float(),
                data["success_count"].as_float(),
            ),
        ).where(
            *conditions,
            Dimension.task == task,
            Dimension.dataset == dataset,
            Dimension.timestamp >= previous_since,
            Dimension.timestamp < until,
        )
    ).all()
    buckets = {
        (first_day + timedelta(days=index)).isoformat(): {
            "runs": 0,
            "metric_sum": 0.0,
            "metric_runs": 0,
            "executions": 0.0,
            "successes": 0.0,
        }
        for index in range(days)
    }
    previous = {"runs": 0, "metric_sum": 0.0, "metric_runs": 0}
    for timestamp, value, executions, successes in rows:
        value = _number(value) if metric else None
        if timestamp < since:
            previous["runs"] += 1
            if value is not None:
                previous["metric_sum"] += value
                previous["metric_runs"] += 1
            continue
        bucket = buckets.get((timestamp + timedelta(minutes=offset)).date().isoformat())
        if bucket is None:
            continue
        bucket["runs"] += 1
        if value is not None:
            bucket["metric_sum"] += value
            bucket["metric_runs"] += 1
        bucket["executions"] += _number(executions) or 0.0
        bucket["successes"] += _number(successes) or 0.0
    points = []
    current = {
        "runs": 0,
        "metric_sum": 0.0,
        "metric_runs": 0,
        "executions": 0.0,
        "successes": 0.0,
    }
    for day, bucket in buckets.items():
        for key in current:
            current[key] += bucket[key]
        points.append(
            {
                "date": day,
                "runs": bucket["runs"],
                "metric_runs": bucket["metric_runs"],
                "metric_mean": (
                    bucket["metric_sum"] / bucket["metric_runs"]
                    if bucket["metric_runs"]
                    else None
                ),
                "execution_success": (
                    bucket["successes"] / bucket["executions"]
                    if bucket["executions"]
                    else None
                ),
            }
        )
    mean = (
        current["metric_sum"] / current["metric_runs"]
        if current["metric_runs"]
        else None
    )
    before = (
        previous["metric_sum"] / previous["metric_runs"]
        if previous["metric_runs"]
        else None
    )
    result["points"] = points
    result["summary"] = {
        "runs": current["runs"],
        "metric_mean": mean,
        "previous_runs": previous["runs"],
        "previous_metric_mean": before,
        "delta": mean - before if mean is not None and before is not None else None,
        "execution_success": (
            current["successes"] / current["executions"]
            if current["executions"]
            else None
        ),
    }
    return result


@router.post("/trend")
def dashboard_trend(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """The Overview trend: one task's primary metric and execution success per
    day on one dataset (``task`` and ``dataset``; default the pair with the
    most finished runs in the range), from the dashboard projection.

    Every finished run counts once in its day's mean (the run means of the
    runs list). ``summary`` compares the period with the one before it.
    Days are the viewer's local days (``tz_offset_minutes``, minutes east of UTC).
    """
    if not isinstance(payload, dict) or set(payload) - {
        "project_slug",
        "days",
        "task",
        "dataset",
        "tz_offset_minutes",
    }:
        raise HTTPException(400, "Invalid trend request")
    slug, days = payload.get("project_slug"), payload.get("days", 7)
    task, offset = payload.get("task"), payload.get("tz_offset_minutes", 0)
    if slug is not None and (not isinstance(slug, str) or len(slug) > 400):
        raise HTTPException(400, "Invalid project slug")
    if isinstance(days, bool) or days not in TREND_RANGES:
        raise HTTPException(400, "days must be 7, 30 or 90")
    if task is not None and (not isinstance(task, str) or len(task) > 1000):
        raise HTTPException(400, "Invalid task")
    dataset = payload.get("dataset")
    if dataset is not None and (not isinstance(dataset, str) or len(dataset) > 1000):
        raise HTTPException(400, "Invalid dataset")
    if isinstance(offset, bool) or not isinstance(offset, int) or abs(offset) > 14 * 60:
        raise HTTPException(400, "Invalid tz_offset_minutes")
    project = _project(db, principal, slug)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with _read_snapshot(db) as reader:
        project = _snapshot_project(reader, project)
        if project is None:
            return {
                "days": days,
                "tasks": [],
                "task": None,
                "dataset": None,
                "points": [],
                "summary": None,
            }
        freshness = _freshness(reader, project)
        if not freshness["revision"]:
            return _trend(reader, project, days, task, dataset, offset, now)
        # Same revision, same local day: the same answer.
        key = (
            reader.get_bind().engine,
            project["id"],
            freshness["catalog_revision"],
            PlatformSettings().hidden_tasks,
            days,
            task,
            dataset,
            offset,
            (now + timedelta(minutes=offset)).date().isoformat(),
        )
        return _trend_cache.get_or_compute(
            key, lambda: _trend(reader, project, days, task, dataset, offset, now)
        )


# --------------------------------------------------------------------------
# Previous run (C057)
# --------------------------------------------------------------------------


@router.get("/previous-run")
def dashboard_previous_run(
    run_id: str = Query(..., min_length=1, max_length=200),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """The previous finished run of the same project, task, model and dataset
    (any dataset version), started before this one; ``previous`` is null when
    there is none. ``primary`` compares the two runs' published means of this
    run's primary metric (no noise test: Compare shows the noise band).
    """
    from qym_platform.api.runs import (
        _dataset_version_fields,
        _dataset_version_info_map,
        _metric_specs_for_runs,
        _run_display_name,
    )

    run = Run.active(db).filter(Run.id == run_id).first()
    if run is None or not can_view_run(db, principal, run):
        raise HTTPException(404, "Run not found")
    started = run.started_at or run.created_at
    run_start = func.coalesce(Run.started_at, Run.created_at)
    previous = (
        Run.active(db)
        .filter(
            Run.project_id == run.project_id,
            Run.task == run.task,
            Run.model.is_(None) if run.model is None else Run.model == run.model,
            Run.dataset == run.dataset,
            Run.id != run.id,
            ~Run.status.in_([RunWorkflowStatus.RUNNING, RunWorkflowStatus.PENDING]),
            or_(
                run_start < started,
                (run_start == started) & (Run.created_at < run.created_at),
            ),
        )
        .order_by(run_start.desc(), Run.created_at.desc(), Run.id.desc())
        .first()
    )
    if previous is None:
        return {"run_id": run.id, "previous": None}
    info = _dataset_version_info_map(db, [run, previous])
    current_version = _dataset_version_fields(run, info)["dataset_version"]
    previous_version = _dataset_version_fields(previous, info)["dataset_version"]
    averages = dict(
        db.execute(
            select(Summary.run_key, Summary.data["metric_averages"]).where(
                Summary.run_key.in_([run.id, previous.id])
            )
        ).all()
    )
    specs = _metric_specs_for_runs(db, [run.id]).get(run.id, {})
    metric = primary_metric(run.metrics, specs)
    primary = None
    if metric:
        now_value = _number((averages.get(run.id) or {}).get(metric))
        then_value = _number((averages.get(previous.id) or {}).get(metric))
        primary = {
            "metric": metric,
            "direction": declared_direction(specs.get(metric)),
            "value": now_value,
            "previous_value": then_value,
            "delta": (
                now_value - then_value
                if now_value is not None and then_value is not None
                else None
            ),
        }
    previous_started = previous.started_at or previous.created_at
    return {
        "run_id": run.id,
        "previous": {
            "run_id": previous.id,
            "run_name": _run_display_name(previous),
            "status": getattr(previous.status, "value", previous.status),
            "started_at": (
                previous_started.replace(tzinfo=timezone.utc).isoformat()
                if previous_started
                else None
            ),
            "dataset_version": previous_version,
        },
        "dataset_version": current_version,
        "dataset_version_mismatch": bool(
            current_version and previous_version and current_version != previous_version
        ),
        "primary": primary,
    }


# --------------------------------------------------------------------------
# Previous / next run in the Runs list order (C044)
# --------------------------------------------------------------------------

# Text sorts the browser collates (runs_order.js collation()).
_COLLATED_SORTS = ("task", "model", "dataset", "version", "owner")


def _filtered(filters: Dict[str, Any]) -> bool:
    return any(value for value in filters.values())


def _list_position(db, project, run_id: str, filters, sort: str, collation):
    """Where ``run_id`` sits in the Runs list for ``filters`` and ``sort``:
    its position, the list's length and the runs on either side, or None when
    the run is not in that list. One query, ordered exactly as the list pages
    (``_build_page``): the sort, then the list's group order and the run id.
    """
    conditions = _base_conditions(project) + _filter_conditions(filters)
    query, legacy_order = _ordered_query(conditions, Dimension.run_key)
    order = [*_sort(sort, collation), *legacy_order]
    ranked = query.add_columns(
        func.row_number().over(order_by=order).label("position"),
        func.lag(Dimension.run_key).over(order_by=order).label("previous_key"),
        func.lead(Dimension.run_key).over(order_by=order).label("next_key"),
        func.count().over().label("total"),
    ).subquery()
    row = db.execute(
        select(
            ranked.c.position,
            ranked.c.previous_key,
            ranked.c.next_key,
            ranked.c.total,
        ).where(ranked.c.run_key == run_id)
    ).first()
    if row is None:
        return None
    keys = [key for key in (row.previous_key, row.next_key) if key]
    descriptors = (
        dict(
            db.execute(
                select(Dimension.run_key, Dimension.descriptor).where(
                    Dimension.run_key.in_(keys)
                )
            ).all()
        )
        if keys
        else {}
    )

    def neighbor(key):
        if not key:
            return None
        descriptor = descriptors.get(key) or {}
        name = descriptor.get("run_name") or descriptor.get("external_run_id") or key
        return {"run_id": key, "run_name": name}

    return {
        "position": int(row.position),
        "total": int(row.total),
        "previous": neighbor(row.previous_key),
        "next": neighbor(row.next_key),
    }


@router.post("/neighbors")
def dashboard_neighbors(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """The runs before and after ``run_id`` in the Runs list order.

    Takes the list's own request: ``filters``, ``sort`` and, for a text sort
    (task, model, dataset, version, owner), the ``collation`` the browser
    sorts the values in. A text sort without ``collation`` answers
    ``collation_needed`` with the ``sort_values`` to collate, and the caller
    asks again with them, as the list does.

    ``context`` says which order answered: ``list`` (the one asked for),
    ``default`` (newest first with no filters, when the run is not in the
    list asked for, or no list was given) or null (the run is in neither).
    """
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid dashboard query")
    args = _body_parameters(
        payload, {"project_slug", "run_id", "filters", "sort", "collation"}
    )
    run_id = payload.get("run_id")
    if not isinstance(run_id, str) or not run_id or len(run_id) > 200:
        raise HTTPException(400, "Invalid run id")
    if not args["project_slug"]:
        raise HTTPException(400, "Invalid project slug")
    filters = _parse_filters(args["filters"])
    sort, collation = args["sort"], _parse_collation(args["collation"])
    _sort(sort)  # an unknown sort is refused before any read
    field = sort.rpartition("-")[0]
    project = _project(db, principal, args["project_slug"])
    with _read_snapshot(db) as reader:
        if field in _COLLATED_SORTS and "collation" not in payload:
            values = reader.scalars(
                _query(_sort_columns()[field])
                .where(*_base_conditions(project), *_filter_conditions(filters))
                .distinct()
            )
            return {
                "run_id": run_id,
                "collation_needed": True,
                "sort": sort,
                "sort_values": [value for value in values if value is not None],
            }
        context = "list"
        found = _list_position(reader, project, run_id, filters, sort, collation)
        if found is None and (_filtered(filters) or sort != "time-desc"):
            context = "default"
            found = _list_position(reader, project, run_id, {}, "time-desc", [])
        if found is None:
            return {
                "run_id": run_id,
                "context": None,
                "position": None,
                "total": 0,
                "previous": None,
                "next": None,
            }
        return {"run_id": run_id, "context": context, **found}
