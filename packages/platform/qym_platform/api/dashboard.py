"""Authorized, bounded dashboard reads over durable numeric projections."""

from __future__ import annotations

import bisect
import copy
import hashlib
import json
import math
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import and_, case, false, func, or_, select, true
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.dashboard_models import (
    DashboardRunDimension as Dimension,
    DashboardRunSummary as Summary,
)
from qym_platform.db.models import Project, ProjectMembership, UserRole
from qym_platform.deps import get_db
from qym_platform.db.dashboard_models import DashboardRunVersion as RunVersion
from qym_platform.permissions import project_for_read_by_slug
from qym_platform.settings import PlatformSettings
from qym_platform.services.dashboard_cache import DashboardSnapshotCache
from qym_platform.services.run_versioning import (
    EMPTY as VERSIONING_EMPTY,
    parse_versioning_filter,
    versioning_conditions,
)

# Entries are keyed by the catalog revision, which moves with every published
# change, so the TTL only bounds how long an idle entry holds memory.
_SNAPSHOT_TTL_SECONDS = 300.0
_overview_cache = DashboardSnapshotCache(ttl=_SNAPSHOT_TTL_SECONDS)
_page_cache = DashboardSnapshotCache(ttl=_SNAPSHOT_TTL_SECONDS)
_catalog_cache = DashboardSnapshotCache(
    max_entries=4, max_bytes=16 * 1024 * 1024, ttl=_SNAPSHOT_TTL_SECONDS
)
_kpi_cache = DashboardSnapshotCache(ttl=_SNAPSHOT_TTL_SECONDS)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])
_FILTER_COLUMNS = {
    "tasks": Dimension.task,
    "models": Dimension.model,
    "datasets": Dimension.dataset,
    "statuses": Dimension.status,
    "versions": Dimension.version,
    "users": Dimension.owner,
    # Descriptors published before origin existed are local runs.
    "origins": func.coalesce(Dimension.descriptor["origin"].as_string(), "local"),
}
_ORIGIN_FILTER_VALUES = {"official", "local", "__none__"}
# Values listed per versioning key in the facets, newest first.
_VERSIONING_FACET_LIMIT = 500


_MAX_SEARCH_LENGTH = 200


def _parse_filters(raw: Optional[str]) -> dict:
    try:
        value = json.loads(raw or "{}")
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid dashboard filters") from None
    if not isinstance(value, dict) or set(value) - (
        set(_FILTER_COLUMNS) | {"since", "until", "versioning", "q"}
    ):
        raise HTTPException(400, "Invalid dashboard filters")
    try:
        # ``{key: [values]}`` over any versioning_metadata key; see run_versioning.
        value["versioning"] = parse_versioning_filter(value.get("versioning"))
    except ValueError:
        raise HTTPException(400, "Invalid versioning filter") from None
    if not value["versioning"]:
        value.pop("versioning")
    if "q" in value:
        if value["q"] is not None and (
            not isinstance(value["q"], str) or len(value["q"]) > _MAX_SEARCH_LENGTH
        ):
            raise HTTPException(400, "Invalid search text")
        # One cache entry per distinct search; blank text is no search. Inner
        # spaces stay: run names are stored with theirs.
        value["q"] = (value["q"] or "").strip().lower()
        if not value["q"]:
            del value["q"]
    for key in _FILTER_COLUMNS:
        values = value.get(key, [])
        if (
            not isinstance(values, list)
            or len(values) > 1000
            or any(not isinstance(item, str) or len(item) > 1000 for item in values)
        ):
            raise HTTPException(400, f"Invalid {key} filter")
    if set(value.get("origins", [])) - _ORIGIN_FILTER_VALUES:
        raise HTTPException(400, "Invalid origins filter")
    for key in ("since", "until"):
        if value.get(key) is not None:
            try:
                parsed = datetime.fromisoformat(value[key].replace("Z", "+00:00"))
                value[key] = (
                    parsed.astimezone(timezone.utc).replace(tzinfo=None)
                    if parsed.tzinfo
                    else parsed
                )
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(400, f"Invalid {key} timestamp") from None
    return value


def _project(db, principal, slug):
    query = select(Project).where(Project.is_active.is_(True))
    if slug:
        # Archived projects stay readable to their members (read-only).
        project = project_for_read_by_slug(db, principal, slug)
    else:
        if principal.auth_type != "none" and principal.user.role != UserRole.ADMIN:
            query = query.join(
                ProjectMembership, ProjectMembership.project_id == Project.id
            ).where(ProjectMembership.user_id == principal.user.id)
        project = db.scalar(query.order_by(Project.name, Project.id).limit(1))
    if project is None:
        return None
    from qym_platform.api.projects import _project_payload

    role = (
        "MANAGER"
        if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN
        else db.scalar(
            select(ProjectMembership.role).where(
                ProjectMembership.project_id == project.id,
                ProjectMembership.user_id == principal.user.id,
            )
        )
    )
    return _project_payload(
        db,
        project,
        principal,
        run_counts={project.id: 0},
        role=getattr(role, "value", role) or "",
    )


def _snapshot_project(db, project):
    if project is not None:
        project["run_count"] = (
            db.scalar(
                select(func.count())
                .select_from(Dimension)
                .where(
                    Dimension.project_key == project["id"], Dimension.present.is_(True)
                )
            )
            or 0
        )
    return project


@contextmanager
def _read_snapshot(auth_db):
    """Release auth checkout before owning one repeatable-read connection.

    Writes a read queues with ``after_snapshot`` (the shared overview cache)
    run once that connection is back in the pool, so a request never waits
    for a second connection while it holds one.
    """
    bind = auth_db.get_bind()
    auth_db.close()
    queued = []
    with bind.connect() as connection:
        if connection.dialect.name == "postgresql":
            connection = connection.execution_options(isolation_level="REPEATABLE READ")
        elif connection.dialect.name == "sqlite":
            # sqlite3's legacy mode otherwise does not start a transaction for SELECT.
            connection.exec_driver_sql("BEGIN")
        with Session(bind=connection, autoflush=False) as db:
            db.info[_AFTER_SNAPSHOT] = queued
            yield db
    for write in queued:
        write()


_AFTER_SNAPSHOT = "dashboard_after_snapshot"


def after_snapshot(db, write):
    """Run ``write`` (it opens its own connection) after the request's
    snapshot connection is released; at once outside ``_read_snapshot``."""
    queued = db.info.get(_AFTER_SNAPSHOT)
    if queued is None:
        write()
    else:
        queued.append(write)


def _base_conditions(project):
    conditions = [
        Dimension.project_key == project["id"] if project else false(),
        Dimension.present.is_(True),
        Dimension.hidden_at.is_(None),
    ]
    hidden = [
        task.strip().lower()
        for task in PlatformSettings().hidden_tasks.split(",")
        if task.strip()
    ]
    if hidden:
        conditions.append(~func.lower(Dimension.task).in_(hidden))
    return conditions


def _filter_conditions(filters, *, skip=None, skip_versioning=None, facets=False):
    conditions = versioning_conditions(
        Dimension.run_key,
        {
            key: values
            for key, values in (filters.get("versioning") or {}).items()
            if key != skip_versioning
        },
        facets=facets,
    )
    for name, column in _FILTER_COLUMNS.items():
        values = filters.get(name, [])
        if name == skip or not values:
            continue
        if "__none__" in values:
            # Existing dropdowns ignore a select-none constraint in OTHER facets.
            if not facets:
                conditions.append(false())
            continue
        ordinary = [value for value in values if value != "__empty__"]
        terms = [column.in_(ordinary)] if ordinary else []
        if "__empty__" in values:
            terms.append(or_(column.is_(None), func.trim(column) == ""))
        conditions.append(or_(*terms))
    if filters.get("since") is not None:
        conditions.append(Dimension.timestamp >= filters["since"])
    if filters.get("until") is not None:
        conditions.append(Dimension.timestamp < filters["until"])
    if filters.get("q"):
        conditions.append(_search_condition(filters["q"]))
    return conditions


RUNS_SEARCH_INDEX = "ix_dashboard_run_dimensions_search_trgm"
# The rows whose ``search_text`` is still NULL. Empty once the
# build_runs_search_index job has filled them; it lets the planner serve the
# search's branch for such rows from an index too.
RUNS_UNSEARCHABLE_INDEX = "ix_dashboard_run_dimensions_unsearchable"


def run_search_text(external_run_id, run_name) -> str:
    """What the Runs search box matches (``Dimension.search_text``): the name
    the list shows (the external run id) and the run name, lowercased, on two
    lines. A search never contains a line break, so a match never spans the
    two names.

    A column of its own, written only by the summary worker's dimension sync:
    the trigram index over it (``RUNS_SEARCH_INDEX``) leaves the descriptor
    rewrites of a live run HOT, which an index over descriptor expressions
    did not.
    """
    return (
        ("" if external_run_id is None else str(external_run_id))
        + "\n"
        + ("" if run_name is None else str(run_name))
    ).lower()


def _search_name(table, key):
    return func.coalesce(table.descriptor[key].as_string(), "")


def _descriptor_search_text(table=Dimension):
    """``run_search_text`` read from the descriptor, for a row written before
    ``search_text`` existed that the job has not filled yet."""
    return func.lower(
        _search_name(table, "external_run_id") + "\n" + _search_name(table, "run_name")
    )


def _search_condition(text, table=Dimension):
    """Find a run by the name the list shows, its run name, or its id.

    The stored text is what ``RUNS_SEARCH_INDEX`` serves. A row without it is
    matched on its descriptor (``RUNS_UNSEARCHABLE_INDEX`` keeps that branch
    indexable), so the results never depend on the job's progress.
    """
    needle = text.lower()
    return or_(
        table.search_text.contains(needle, autoescape=True),
        and_(
            table.search_text.is_(None),
            _descriptor_search_text(table).contains(needle, autoescape=True),
        ),
        func.lower(table.run_key).startswith(needle, autoescape=True),
    )


def runs_search_index_ddl():
    """CREATE INDEX for the Runs search: trigrams of the stored search text
    and of the lowercased run id (the id matches by prefix). Neither changes
    when a live run's descriptor does."""
    from sqlalchemy.dialects import postgresql

    dialect = postgresql.dialect()

    def compiled(expression):
        return str(expression.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))

    return (
        f"CREATE INDEX CONCURRENTLY {RUNS_SEARCH_INDEX} ON dashboard_run_dimensions "
        f"USING gin (search_text gin_trgm_ops, "
        f"({compiled(func.lower(Dimension.run_key))}) gin_trgm_ops)"
    )


def runs_unsearchable_index_ddl():
    return (
        f"CREATE INDEX CONCURRENTLY {RUNS_UNSEARCHABLE_INDEX} ON dashboard_run_dimensions "
        "(project_key) WHERE search_text IS NULL"
    )


def _query(*columns):
    return (
        select(*(columns or (Dimension, Summary)))
        .select_from(Dimension)
        .join(Summary, Summary.run_key == Dimension.run_key)
    )


def _ordered_query(conditions, *columns):
    # First-seen groups are established before dropdown/time filtering in the UI.
    # Window maxima over the project's present runs give each run its group
    # order in one pass; joining two GROUP BY subqueries made the planner loop
    # an index scan once per group. Models group by the typed model column:
    # reading the name out of every run's JSON descriptor dominated the query.
    raw_model = Dimension.model
    first = (
        select(
            Dimension.run_key.label("run_key"),
            func.max(Dimension.created_at)
            .over(partition_by=Dimension.task)
            .label("task_first"),
            func.max(Dimension.created_at)
            .over(partition_by=(Dimension.task, raw_model))
            .label("model_first"),
        )
        .where(conditions[0], Dimension.present.is_(True))
        .subquery()
    )
    query = (
        _query(*columns)
        .join(first, first.c.run_key == Dimension.run_key)
        .where(*conditions)
    )
    order = [
        first.c.task_first.desc(),
        Dimension.task,
        first.c.model_first.desc(),
        raw_model,
        Dimension.created_at.desc(),
        Dimension.run_key,
    ]
    return query, order


def _sort_columns():
    success = func.coalesce(Summary.data["success_count"].as_float(), 0)
    errors = func.coalesce(Summary.data["error_count"].as_float(), 0)
    # Execution success: item passes in repeat runs (older summaries: items).
    executions = func.coalesce(
        Summary.data["execution_count"].as_float(), success + errors
    )
    executed = func.coalesce(
        Summary.data["execution_success_count"].as_float(), success
    )
    return {
        "time": Dimension.timestamp,
        "created": Dimension.created_at,
        "activity": Dimension.descriptor["_activity_sort_at"].as_string(),
        "date": Dimension.timestamp,
        "success": case((executions > 0, executed / executions), else_=-1),
        "items": func.coalesce(Summary.data["total_items"].as_float(), 0),
        "task": Dimension.task,
        "model": Dimension.model,
        "dataset": Dimension.descriptor["dataset_name"].as_string(),
        "version": func.coalesce(Dimension.descriptor["git_commit"].as_string(), ""),
        "owner": func.coalesce(
            Dimension.descriptor["owner"]["display_name"].as_string(), ""
        ),
        "status": func.coalesce(
            Summary.data["execution_error_count"].as_float(), errors
        ),
        # The Run column shows the external run id, else the run id: sort by
        # that text (case-folded), not by the hidden id alone.
        "run": func.lower(
            func.coalesce(
                func.nullif(Dimension.descriptor["external_run_id"].as_string(), ""),
                Dimension.run_key,
            )
        ),
        "latency": Summary.avg_latency_ms,
        "median-latency": Summary.median_latency_ms,
        "duration": func.coalesce(Summary.data["duration_ms"].as_float(), 0),
    }


def _parse_collation(raw):
    try:
        values = json.loads(raw) if raw else []
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid collation order") from None
    if (
        not isinstance(values, list)
        or len(values) > 10000
        or any(not isinstance(value, str) or len(value) > 1000 for value in values)
    ):
        raise HTTPException(400, "Invalid collation order")
    return list(dict.fromkeys(values))


def _sort(key, collation=None):
    field, _, direction = key.rpartition("-")
    if direction not in ("asc", "desc"):
        raise HTTPException(400, "Invalid dashboard sort")
    column = _sort_columns().get(field)
    if column is None and field.startswith("metric-") and len(field) > 7:
        column = func.coalesce(
            Summary.data["metric_averages"][field[7:]].as_float(), -1
        )
    if (
        column is None
        and field.startswith("trace-")
        and field[6:]
        in {"avg_tokens", "avg_llm_calls", "avg_tool_calls", "tool_success_rate"}
    ):
        column = func.coalesce(
            Dimension.descriptor["trace_stats"][field[6:]].as_float(), -1
        )
    if column is None:
        raise HTTPException(400, "Invalid dashboard sort")
    if collation and field in {"task", "model", "dataset", "version", "owner"}:
        column = case(
            {value: index for index, value in enumerate(collation)},
            value=column,
            else_=len(collation),
        )
    return [
        column.desc() if direction == "desc" else column.asc(),
        *([Dimension.created_at.desc()] if field == "activity" else []),
    ]


def _row(dimension, summary):
    return {
        **(dimension.descriptor or {}),
        **(summary.data or {}),
        "_revision": summary.projection_revision,
        "summary_state": "published" if summary.projection_revision else "pending",
        "model_key": dimension.model,
    }


def _tasks(rows):
    tasks = {}
    for row in rows:
        tasks.setdefault(row["task_name"], {}).setdefault(
            row.get("model_name") or "nomodel", []
        ).append(row)
    return tasks


def _stream(db, conditions, sort=None, collation=None):
    # The overview uses display payloads only. Avoid hydrating two ORM objects
    # and all internal accumulator columns for every historical run.
    query, order = _ordered_query(
        conditions,
        Dimension.descriptor,
        Summary.data,
        Dimension.model,
        Summary.projection_revision,
    )
    query = query.order_by(*(_sort(sort, collation) if sort else []), *order)
    for descriptor, data, model, revision in db.execute(
        query.execution_options(yield_per=200)
    ):
        yield {
            **(descriptor or {}),
            **(data or {}),
            "model_key": model,
            "_revision": revision,
        }


def _freshness(db, project):
    from qym_platform.services.dashboard_summaries import dashboard_freshness

    # One read per repeatable-read snapshot: the page, overview and KPIs of a
    # request all key their caches on the same revision.
    key = ("dashboard_freshness", project["id"] if project else None)
    if key not in db.info:
        db.info[key] = dashboard_freshness(db, [project["id"]] if project else [])
    return copy.deepcopy(db.info[key])


def _facets(db, base, filters):
    result = {}
    for name, column in _FILTER_COLUMNS.items():
        values = db.scalars(
            _query(column)
            .where(*base, *_filter_conditions(filters, skip=name, facets=True))
            .distinct()
        )
        normalized = {
            str(value) if value is not None and str(value).strip() else "__empty__"
            for value in values
        }
        result[name] = sorted(normalized - {"__empty__"}, key=str.casefold) + (
            ["__empty__"] if "__empty__" in normalized else []
        )
    result["versioning"] = _versioning_facets(db, base, filters)
    return result


def _versioning_facet_values(db, conditions, key=None):
    """``{key: [values]}`` among runs matching ``conditions``, newest first.

    ``__empty__`` is appended when some matching run lacks the key.
    """
    query = (
        _query(RunVersion.key, RunVersion.value, func.max(Dimension.timestamp))
        .join(RunVersion, RunVersion.run_key == Dimension.run_key)
        .where(*conditions)
        .group_by(RunVersion.key, RunVersion.value)
    )
    if key is not None:
        query = query.where(RunVersion.key == key)
    latest = {}
    for name, value, at in db.execute(query):
        latest.setdefault(name, []).append((at, value))
    if not latest:
        return {}
    total = db.scalar(_query(func.count()).where(*conditions)) or 0
    counts = dict(
        db.execute(
            _query(RunVersion.key, func.count())
            .join(RunVersion, RunVersion.run_key == Dimension.run_key)
            .where(*conditions, RunVersion.key.in_(list(latest)))
            .group_by(RunVersion.key)
        ).all()
    )
    result = {}
    for name, entries in latest.items():
        entries.sort(
            key=lambda entry: (entry[0] or datetime.min, entry[1]), reverse=True
        )
        values = [value for _, value in entries[:_VERSIONING_FACET_LIMIT]]
        if counts.get(name, 0) < total:
            values.append(VERSIONING_EMPTY)
        result[name] = values
    return result


def _versioning_facets(db, base, filters):
    """Versioning facet values, each key computed without its own selection."""
    selected = filters.get("versioning") or {}
    result = {
        name: values
        for name, values in _versioning_facet_values(
            db, base + _filter_conditions(filters, facets=True)
        ).items()
        if name not in selected
    }
    for name in selected:
        values = _versioning_facet_values(
            db,
            base + _filter_conditions(filters, skip_versioning=name, facets=True),
            key=name,
        ).get(name)
        if values:
            result[name] = values
    return dict(sorted(result.items(), key=lambda item: item[0].casefold()))


def _kpis(db, conditions, *, filtered):
    """Headline KPIs: the one definition behind the Overview cards and topbars.

    One aggregate over the runs in scope (the whole project, or the active
    filter); a summary that is not published yet adds a run but no items.
    Execution success is weighted by executions: items, and item passes in
    repeat runs. Task and metric errors are counted as runs with errors. Models
    are distinct model names, so reasoning and plain variants of one model
    count once.
    """
    if db.get_bind().dialect.name == "postgresql":
        # Parse each summary once: every ->> on a json column parses it again.
        from qym_platform.services.dashboard_overview import kpi_record

        record = kpi_record()
        query = _query(
            *_kpi_aggregates(lambda name: record.c[name], Dimension.model)
        ).join(record, true())
    else:
        query = _query(
            *_kpi_aggregates(lambda name: Summary.data[name].as_float(), Dimension.model)
        )
    return _kpi_result(db.execute(query.where(*conditions)).one(), filtered=filtered)


def _kpi_values(field):
    """Each run's KPI inputs, reading summary field ``name`` as ``field(name)``."""
    task, metric = field("task_error_count"), field("metric_error_count")
    # Summaries published before the task/metric split carry one error count.
    errors = case(
        (and_(task.isnot(None), metric.isnot(None)), task + metric),
        else_=func.coalesce(field("execution_error_count"), field("error_count"), 0),
    )
    # Summaries published before shape 4 carry item counts only.
    return {
        "kpi_items": field("total_items"),
        "kpi_executions": func.coalesce(field("execution_count"), field("total_items")),
        "kpi_successes": func.coalesce(
            field("execution_success_count"), field("success_count")
        ),
        "kpi_errored": case((errors > 0, 1), else_=0),
    }


def _kpi_totals(values, model):
    """The KPI aggregates over per-run ``_kpi_values``."""
    name = func.replace(func.replace(model, "|||reasoning", ""), "|||plain", "")
    return (
        func.count(),
        func.count(func.distinct(case((name != "nomodel", name)))),
        func.coalesce(func.sum(values["kpi_items"]), 0),
        func.coalesce(func.sum(values["kpi_executions"]), 0),
        func.coalesce(func.sum(values["kpi_successes"]), 0),
        func.coalesce(func.sum(values["kpi_errored"]), 0),
    )


def _kpi_aggregates(field, model):
    """The KPI aggregates, reading summary field ``name`` as ``field(name)``."""
    return _kpi_totals(_kpi_values(field), model)


def _kpi_result(values, *, filtered):
    runs, models, items, executions, successes, errored = values
    return {
        "scope": "filtered" if filtered else "project",
        "runs": int(runs),
        "models": int(models),
        "items": int(items),
        "execution_success": float(successes) / executions if executions else None,
        "runs_with_errors": int(errored),
    }


def _scoped_kpis(db, project, filters, freshness):
    """KPIs for the project or its active filter, reused per projection revision."""
    active = _filter_conditions(filters)
    conditions = _base_conditions(project) + active
    if not project or not freshness["revision"]:
        return _kpis(db, conditions, filtered=bool(active))
    key = (
        db.get_bind().engine,
        project["id"],
        freshness["catalog_revision"],
        PlatformSettings().hidden_tasks,
        json.dumps(filters, sort_keys=True, default=str),
    )
    return _kpi_cache.get_or_compute(
        key, lambda: _kpis(db, conditions, filtered=bool(active))
    )


def _overview(db, project, filters, sort="time-desc", collation=None):
    freshness = _freshness(db, project)
    if not project or not freshness["revision"]:
        return _build_overview(db, project, filters, sort, collation)
    # The revision is read in the same repeatable-read transaction as the page.
    # Never reuse filters, hidden-task policy or permissions across scopes.
    key = (
        db.get_bind().engine,
        project["id"],
        freshness["catalog_revision"],
        PlatformSettings().hidden_tasks,
        json.dumps(filters, sort_keys=True, default=str),
        sort,
        tuple(collation or ()),
    )

    def compute():
        if db.get_bind().dialect.name == "postgresql":
            # C037: computed in the database once per revision and shared by
            # every process and pod; this process keeps a small copy.
            from qym_platform.services.dashboard_overview import shared_overview

            return shared_overview(
                db,
                project,
                filters,
                sort,
                collation,
                catalog_revision=freshness["catalog_revision"],
                hidden_tasks=PlatformSettings().hidden_tasks,
            )
        value = _build_overview(db, project, filters, sort, collation)
        return {
            k: v
            for k, v in value.items()
            if k not in {"project", "revision", "catalog_revision", "freshness"}
        }

    cached = _overview_cache.get_or_compute(key, compute)
    return {**cached, "project": project, **freshness}


def _build_overview(db, project, filters, sort="time-desc", collation=None):
    if db.get_bind().dialect.name == "postgresql":
        # C037: aggregated in the database, one statement, same numbers.
        from qym_platform.services.dashboard_overview import build_overview_postgres

        whole, part = build_overview_postgres(db, project, filters, sort, collation)
        result = {**whole, **part, "project": project}
        result.update(_freshness(db, project))
        return result
    return _build_overview_python(db, project, filters, sort, collation)


def _build_overview_python(db, project, filters, sort="time-desc", collation=None):
    """The overview reduced in Python from every run (SQLite, and the
    reference the PostgreSQL build is tested against)."""
    from qym_platform.services.dashboard_views import build_overview_data, _global_data

    base = _base_conditions(project)
    filtered = base + _filter_conditions(filters)
    freshness = _freshness(db, project)
    now = datetime.now(timezone.utc)

    def catalog():
        all_rows = list(_stream(db, base))
        return {row["run_id"]: row for row in all_rows}, _global_data(
            iter(all_rows), now
        )

    if project and freshness["revision"]:
        key = (
            db.get_bind().engine,
            project["id"],
            freshness["catalog_revision"],
            PlatformSettings().hidden_tasks,
            now.date(),
        )
        by_id, global_data = _catalog_cache.get_or_compute(key, catalog)
    else:
        by_id, global_data = catalog()
    ordered, order = _ordered_query(filtered, Dimension.run_key)
    filtered_ids = db.scalars(ordered.order_by(*_sort(sort, collation), *order))
    result = build_overview_data(
        (), (by_id[run_id] for run_id in filtered_ids), global_data=global_data
    )
    result.update(
        total_count=db.scalar(_query(func.count()).where(*base)) or 0,
        total_runs=db.scalar(_query(func.count()).where(*filtered)) or 0,
        facets=_facets(db, base, filters),
        kpis=_scoped_kpis(db, project, filters, freshness),
        project=project,
    )
    owners = db.execute(
        _query(
            Dimension.owner,
            Dimension.descriptor["owner"]["email"].as_string(),
            Dimension.descriptor["owner"]["display_name"].as_string(),
        )
        .where(*base)
        .distinct()
    )
    result["owners"] = {
        owner: {"id": owner, "email": email, "display_name": name}
        for owner, email, name in owners
        if owner and email
    }
    result["all_models"] = sorted(
        db.scalars(_query(Dimension.model).where(*base).distinct()), key=str.casefold
    )
    columns = _sort_columns()
    result["sort_values"] = {
        name: list(db.scalars(_query(columns[field]).where(*filtered).distinct()))
        for name, field in (
            ("tasks", "task"),
            ("models", "model"),
            ("dataset_names", "dataset"),
            ("git_commits", "version"),
            ("owner_names", "owner"),
        )
    }
    result.update(_freshness(db, project))
    return result


def _metric_number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _neighbors(db, conditions, rows):
    """Read adjacent distinct means for page values without fetching history.

    One query reads the metric means of the page's (task, model, dataset)
    groups; a query per metric made the page cost grow with every metric.
    """
    dataset = Dimension.descriptor["dataset_name"].as_string()
    wanted = {}
    for row in rows:
        row["metric_neighbor_values"] = {}
        group = (row["task_name"], row["model_key"], row.get("dataset_name") or "")
        for metric, value in (row.get("metric_averages") or {}).items():
            if _metric_number(value) is not None:
                wanted.setdefault(group, set()).add(metric)
    if not wanted:
        return
    distinct = {}
    for task, model, data, averages in db.execute(
        _query(
            Dimension.task, Dimension.model, dataset, Summary.data["metric_averages"]
        )
        .where(
            *conditions,
            or_(
                *(
                    and_(
                        Dimension.task == task,
                        Dimension.model == model,
                        dataset == data,
                    )
                    for task, model, data in wanted
                )
            ),
        )
        .execution_options(yield_per=500)
    ):
        group = (task, model, data)
        metrics = wanted.get(group)
        if not metrics or not isinstance(averages, dict):
            continue
        for metric in metrics:
            number = _metric_number(averages.get(metric))
            if number is not None:
                distinct.setdefault((group, metric), set()).add(number)
    ordered = {key: sorted(values) for key, values in distinct.items()}
    for row in rows:
        group = (row["task_name"], row["model_key"], row.get("dataset_name") or "")
        for metric, value in (row.get("metric_averages") or {}).items():
            number = _metric_number(value)
            values = ordered.get((group, metric))
            if number is None or not values:
                continue
            index = bisect.bisect_left(values, number)
            if index >= len(values) or values[index] != number:
                continue
            row["metric_neighbor_values"][metric] = [
                values[index - 1] if index > 0 else None,
                values[index + 1] if index + 1 < len(values) else None,
            ]


def _requested_ids(raw):
    try:
        ids = json.loads(raw or "[]")
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid run ids") from None
    if (
        not isinstance(ids, list)
        or len(ids) > 100
        or any(
            not isinstance(value, str) or not value or len(value) > 128 for value in ids
        )
    ):
        raise HTTPException(400, "Run ids must contain at most 100 identifiers")
    return list(dict.fromkeys(ids))


def _config_groups(db, conditions):
    key = Dimension.descriptor["config_group_key"].as_string()
    ranked = (
        _query(
            key.label("key"),
            Dimension.descriptor["run_name"].as_string().label("label"),
            func.count().over(partition_by=key).label("total_runs"),
            func.row_number()
            .over(
                partition_by=key,
                order_by=(
                    Dimension.timestamp.desc(),
                    Dimension.created_at.desc(),
                    Dimension.run_key,
                ),
            )
            .label("rank"),
        )
        .where(*conditions)
        .subquery()
    )
    return [
        {
            "key": row.key or "__ungrouped__",
            "label": row.label or "Unnamed run",
            "total_runs": row.total_runs,
        }
        for row in db.execute(
            select(ranked)
            .where(ranked.c.rank == 1)
            .order_by(ranked.c.total_runs.desc(), ranked.c.key)
        )
    ]


def _page(
    db,
    project,
    filters,
    *,
    limit,
    offset,
    sort,
    ids=None,
    task=None,
    dataset=None,
    include_config_groups=False,
    include_neighbors=True,
    collation=None,
):
    freshness = _freshness(db, project)
    kwargs = dict(
        limit=limit,
        offset=offset,
        sort=sort,
        ids=ids,
        task=task,
        dataset=dataset,
        include_config_groups=include_config_groups,
        include_neighbors=include_neighbors,
        collation=collation,
    )
    if not project or not freshness["revision"]:
        return _build_page(db, project, filters, **kwargs)
    key = (
        db.get_bind().engine,
        project["id"],
        freshness["catalog_revision"],
        PlatformSettings().hidden_tasks,
        json.dumps(filters, sort_keys=True, default=str),
        json.dumps(kwargs, sort_keys=True, default=str),
    )

    def compute():
        value = _build_page(db, project, filters, **kwargs)
        return {
            k: v
            for k, v in value.items()
            if k not in {"project", "revision", "catalog_revision", "freshness"}
        }

    return {**_page_cache.get_or_compute(key, compute), "project": project, **freshness}


def _build_page(
    db,
    project,
    filters,
    *,
    limit,
    offset,
    sort,
    ids=None,
    task=None,
    dataset=None,
    include_config_groups=False,
    include_neighbors=True,
    collation=None,
):
    base = _base_conditions(project)
    filtered = base + _filter_conditions(filters)
    if task is not None:
        filtered.append(Dimension.task == task)
    if dataset is not None:
        filtered.append(Dimension.descriptor["dataset_name"].as_string() == dataset)
    total = db.scalar(_query(func.count()).where(*filtered)) or 0
    # Order and page over narrow keys first, then read only the page's wide
    # descriptor and summary rows.
    query, legacy_order = _ordered_query(filtered, Dimension.run_key)
    page_ids = list(
        db.scalars(
            query.order_by(*_sort(sort, collation), *legacy_order)
            .offset(offset)
            .limit(limit)
        )
    )
    by_id = (
        {
            dimension.run_key: _row(dimension, summary)
            for dimension, summary in db.execute(
                _query().where(Dimension.run_key.in_(page_ids))
            )
        }
        if page_ids
        else {}
    )
    rows = [by_id[run_id] for run_id in page_ids if run_id in by_id]
    if include_neighbors:
        _neighbors(db, filtered, rows)
    pinned = []
    if ids:
        lookup = {
            dimension.run_key: _row(dimension, summary)
            for dimension, summary in db.execute(
                _query().where(*base, Dimension.run_key.in_(ids))
            )
        }
        pinned = [lookup[run_id] for run_id in ids if run_id in lookup]
    result = {
        "tasks": _tasks(rows),
        "rows": rows,
        "pinned_rows": pinned,
        "total_runs": total,
        "total_count": db.scalar(_query(func.count()).where(*base)) or 0,
        "has_more": offset + len(rows) < total,
        "offset": offset,
        "limit": limit,
        "project": project,
    }
    if include_config_groups:
        result["config_groups"] = _config_groups(db, filtered)
    result.update(_freshness(db, project))
    return result


@router.get("/runs")
def dashboard_runs(
    project_slug: Optional[str] = None,
    filters: Optional[str] = None,
    sort: str = "time-desc",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    ids: Optional[str] = None,
    include_overview: bool = False,
    include_config_groups: bool = False,
    collation: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    project, parsed, requested = (
        _project(db, principal, project_slug),
        _parse_filters(filters),
        _requested_ids(ids),
    )
    with _read_snapshot(db) as reader:
        project = _snapshot_project(reader, project)
        result = _page(
            reader,
            project,
            parsed,
            limit=limit,
            offset=offset,
            sort=sort,
            ids=requested,
            include_config_groups=include_config_groups,
            collation=_parse_collation(collation),
        )
        if include_overview:
            result["overview"] = _overview(
                reader, project, parsed, sort, _parse_collation(collation)
            )
        return result


@router.get("/overview")
def dashboard_overview(
    project_slug: Optional[str] = None,
    filters: Optional[str] = None,
    sort: str = "time-desc",
    collation: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    project, parsed = _project(db, principal, project_slug), _parse_filters(filters)
    with _read_snapshot(db) as reader:
        project = _snapshot_project(reader, project)
        return _overview(reader, project, parsed, sort, _parse_collation(collation))


@router.get("/kpis")
def dashboard_kpis(
    project_slug: Optional[str] = None,
    filters: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """Headline KPIs only, without the overview's chart and facet payload."""
    project, parsed = _project(db, principal, project_slug), _parse_filters(filters)
    with _read_snapshot(db) as reader:
        project = _snapshot_project(reader, project)
        freshness = _freshness(reader, project)
        return {
            "kpis": _scoped_kpis(reader, project, parsed, freshness),
            "project": project,
            **freshness,
        }


@router.get("/points")
def dashboard_points(
    project_slug: Optional[str] = None,
    filters: Optional[str] = None,
    sort: str = "time-desc",
    collation: Optional[str] = None,
    task: Optional[str] = None,
    dataset: Optional[str] = None,
    limit: int = Query(500, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    project, parsed = _project(db, principal, project_slug), _parse_filters(filters)
    with _read_snapshot(db) as reader:
        project = _snapshot_project(reader, project)
        return _page(
            reader,
            project,
            parsed,
            limit=limit,
            offset=offset,
            sort=sort,
            collation=_parse_collation(collation),
            task=task,
            dataset=dataset,
            include_neighbors=False,
        )


@router.get("/models")
def dashboard_models(
    project_slug: Optional[str] = None,
    filters: Optional[str] = None,
    k: int = Query(5, ge=1, le=100),
    selected: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    project, parsed = _project(db, principal, project_slug), _parse_filters(filters)
    try:
        selections = json.loads(selected or "{}")
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid model selection") from None
    if not isinstance(selections, dict) or any(
        not isinstance(model, str) or not isinstance(ids, list)
        for model, ids in selections.items()
    ):
        raise HTTPException(400, "Invalid model selection")
    if len(selections) > 100:
        raise HTTPException(400, "At most 100 model selections are supported")
    selections = {
        model: _requested_ids(json.dumps(values))
        for model, values in selections.items()
    }
    with _read_snapshot(db) as reader:
        project = _snapshot_project(reader, project)
        conditions = _base_conditions(project) + _filter_conditions(parsed)
        scope = {
            name: sorted(
                reader.scalars(_query(column).where(*conditions).distinct()),
                key=str.casefold,
            )
            for name, column in (
                ("tasks", Dimension.task),
                ("datasets", Dimension.dataset),
            )
        }
        counts = dict(
            reader.execute(
                _query(Dimension.model, func.count())
                .where(*conditions)
                .group_by(Dimension.model)
            ).all()
        )
        ranked = (
            _query(
                Dimension.run_key.label("id"),
                Dimension.model.label("model"),
                func.row_number()
                .over(
                    partition_by=Dimension.model,
                    order_by=(
                        Dimension.timestamp.desc(),
                        Dimension.created_at.desc(),
                        Dimension.run_key,
                    ),
                )
                .label("rank"),
            )
            .where(*conditions)
            .subquery()
        )
        chosen = select(ranked.c.id).where(
            or_(
                ranked.c.rank <= k,
                *(
                    and_(ranked.c.model == model, ranked.c.id.in_(values))
                    for model, values in selections.items()
                ),
            )
        )
        rows = reader.execute(
            _query()
            .where(*conditions, Dimension.run_key.in_(chosen))
            .order_by(
                Dimension.timestamp.desc(),
                Dimension.created_at.desc(),
                Dimension.run_key,
            )
        )
        models = {
            model: {"model_key": model, "total_runs": count, "rows": []}
            for model, count in counts.items()
        }
        for dimension, summary in rows:
            models[dimension.model]["rows"].append(_row(dimension, summary))
        metric_summary = {}
        filtered_hash = hashlib.sha256()
        for run_key, revision, averages, metrics in reader.execute(
            _query(
                Dimension.run_key,
                Summary.projection_revision,
                Summary.data["metric_averages"],
                Dimension.descriptor["metrics"],
            )
            .where(*conditions)
            .order_by(Dimension.run_key)
            .execution_options(yield_per=200)
        ):
            filtered_hash.update(
                json.dumps([run_key, revision], separators=(",", ":")).encode()
            )
            for metric in metrics or []:
                metric_summary.setdefault(
                    metric, {"is_boolean": True, "is_numeric": False}
                )
            for metric, value in (averages or {}).items():
                info = metric_summary.setdefault(
                    metric, {"is_boolean": True, "is_numeric": False}
                )
                if value is None:
                    continue
                try:
                    number = float(value)
                except (TypeError, ValueError):
                    continue
                if number < 0 or number > 1:
                    info["is_numeric"], info["is_boolean"] = True, False
                elif abs(number) > 0.0001 and abs(number - 1) > 0.0001:
                    info["is_boolean"] = False
        result = {
            "models": list(models.values()),
            "filtered_revision": filtered_hash.hexdigest(),
            "selected_revision": hashlib.sha256(
                json.dumps(
                    sorted(
                        (row["run_id"], row["_revision"])
                        for model in models.values()
                        for row in model["rows"]
                    ),
                    separators=(",", ":"),
                ).encode()
            ).hexdigest(),
            "scope": scope,
            "metrics": sorted(metric_summary),
            "metric_summary": metric_summary,
            "project": project,
        }
        result.update(_freshness(reader, project))
        return result


@router.post("/models")
def dashboard_models_selection(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    if set(payload) - {"project_slug", "filters", "k", "selected"}:
        raise HTTPException(400, "Invalid model selection request")
    k = payload.get("k", 5)
    if isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= 100:
        raise HTTPException(400, "k must be between 1 and 100")
    slug = payload.get("project_slug")
    if slug is not None and not isinstance(slug, str):
        raise HTTPException(400, "Invalid project slug")
    return dashboard_models(
        project_slug=slug,
        filters=json.dumps(payload.get("filters", {})),
        k=k,
        selected=json.dumps(payload.get("selected", {})),
        db=db,
        principal=principal,
    )


def _body_parameters(payload, allowed):
    if set(payload) - allowed:
        raise HTTPException(400, "Invalid dashboard query")
    slug = payload.get("project_slug")
    if slug is not None and (not isinstance(slug, str) or len(slug) > 400):
        raise HTTPException(400, "Invalid project slug")
    result = {"project_slug": slug, "filters": json.dumps(payload.get("filters", {}))}
    for key, default, minimum, maximum in (
        ("limit", 50, 1, 500),
        ("offset", 0, 0, None),
    ):
        if key in allowed:
            value = payload.get(key, default)
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < minimum
                or maximum is not None
                and value > maximum
            ):
                raise HTTPException(400, f"Invalid {key}")
            result[key] = value
    if "sort" in allowed and "ids" not in allowed:
        if not isinstance(payload.get("sort", "time-desc"), str):
            raise HTTPException(400, "Invalid dashboard sort")
        result["sort"] = payload.get("sort", "time-desc")
        result["collation"] = json.dumps(payload.get("collation", []))
    return result


@router.post("/runs")
def dashboard_runs_query(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    args = _body_parameters(
        payload,
        {
            "project_slug",
            "filters",
            "sort",
            "limit",
            "offset",
            "ids",
            "include_overview",
            "include_config_groups",
            "collation",
        },
    )
    for key in ("include_overview", "include_config_groups"):
        if key in payload and not isinstance(payload[key], bool):
            raise HTTPException(400, f"Invalid {key}")
        args[key] = payload.get(key, False)
    if not isinstance(payload.get("sort", "time-desc"), str):
        raise HTTPException(400, "Invalid dashboard sort")
    return dashboard_runs(
        **args,
        sort=payload.get("sort", "time-desc"),
        ids=json.dumps(payload.get("ids", [])),
        collation=json.dumps(payload.get("collation", [])),
        db=db,
        principal=principal,
    )


@router.post("/overview")
def dashboard_overview_query(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    return dashboard_overview(
        **_body_parameters(payload, {"project_slug", "filters", "sort", "collation"}),
        db=db,
        principal=principal,
    )


@router.post("/kpis")
def dashboard_kpis_query(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    return dashboard_kpis(
        **_body_parameters(payload, {"project_slug", "filters"}),
        db=db,
        principal=principal,
    )


@router.post("/points")
def dashboard_points_query(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    args = _body_parameters(
        payload,
        {
            "project_slug",
            "filters",
            "task",
            "dataset",
            "limit",
            "offset",
            "sort",
            "collation",
        },
    )
    for key in ("task", "dataset"):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > 1000):
            raise HTTPException(400, f"Invalid {key}")
        args[key] = value
    return dashboard_points(**args, db=db, principal=principal)
