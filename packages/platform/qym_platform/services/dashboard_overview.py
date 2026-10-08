"""The Runs, Charts and Models overview, aggregated inside PostgreSQL (C037).

``services/dashboard_views.py`` builds the same payload in Python: it streams
every run's descriptor and summary JSON out of the database and reduces them
one by one, once per catalog revision. Here one statement does that work next
to the data and returns small per-group aggregates; Python only assembles the
payload.

The statement reads each run's overview inputs from ``dashboard_run_overview``
(typed columns, written by the summary worker when it publishes the run, and
by the ``backfill_dashboard_overview`` job for older runs). A row counts only
while its ``revision`` equals the summary's ``projection_revision``; for any
other run the statement reads the inputs from the JSON (``facts_select``), so
a missing or stale row is slower, never wrong.

The payload has two parts:

- the whole-project part (``aggregations``, metric names, types and specs,
  owners, all models), which depends only on the catalog revision, and
- the filtered part (chart data, facets, sort values, KPIs, counts), which
  also depends on the filters and the sort.

``build_overview_postgres`` computes both, or only the filtered part when the
caller already has the whole-project part for this revision; then it reads
the JSON of filtered runs only. ``shared_overview`` stores both parts in
``dashboard_overview_snapshots``, keyed by project, catalog revision, day,
hidden tasks, filters and sort, so every process and pod reuses them.

The numbers are the Python reducers' numbers, to the last bit:

- Float sums add in the same order as the Python loops: ``sum(x ORDER BY
  position)`` adds one float8 at a time, like Python. The positions are the
  orders the Python build reads rows in: the project's group order for the
  whole-project part, and the requested sort for the chart data.
- The chart reducer restarts a model's metric count whenever the running sum
  before a run is exactly 0 (``dashboard.js`` did the same); the restart point
  comes from a running sum over the same order.
- Dictionaries keep the Python insertion order (first appearance), and lists
  keep their order and their ties.
- Values that are not JSON numbers read as the Python reducers read them
  (``_number``: null, and text that is not a number, count as 0).
- Numbers keep the Python build's types (a sum is the int 0 until a float is
  added), for the values the platform writes: success rates, latencies and
  medians are floats. PostgreSQL's JSON writes a whole float as ``1``, so the
  assembly turns such sums back into floats.
- Floats leave the database as text that reads back as the same float: the
  statement runs with ``extra_float_digits = 3``, whatever the server sets.
- Days and the latest time read the typed ``timestamp`` column, not the
  descriptor's ``timestamp`` text: ``_sync_dimension`` writes both from the
  same value, at full precision, so they are the same instant.

``tests/platform/test_overview_sql_equivalence.py`` compares this build with
the Python build on seeded projects.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import (
    Boolean,
    Float,
    Numeric,
    Text,
    and_,
    case,
    cast,
    column,
    false,
    func,
    literal,
    literal_column,
    or_,
    select,
    true,
    union_all,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import aggregate_order_by, array
from sqlalchemy.orm import aliased
from sqlalchemy.types import JSON

from qym_platform.services.dashboard_views import _iso, _utf16_key
from qym_platform.log import get_logger

logger = get_logger(__name__)

# Each run's descriptor and published summary are parsed once, into these.
_DESCRIPTOR_FIELDS = (
    ("task_name", Text),
    ("dataset_name", Text),
    ("metrics", JSON),
    ("metric_specs", JSON),
    ("trace_stats", JSON),
    ("owner", JSON),
    ("git_commit", Text),
)
# The KPIs read these as CAST(data ->> k AS FLOAT); a float column of the
# same record reads them the same way.
_KPI_FIELDS = (
    "task_error_count",
    "metric_error_count",
    "execution_error_count",
    "error_count",
    "execution_count",
    "execution_success_count",
    "success_count",
)
_SUMMARY_FIELDS = (
    ("metric_averages", JSON),
    ("total_items", JSON),
    ("success_rate", JSON),
    ("avg_latency_ms", JSON),
    ("median_latency_ms", JSON),
    *((name, Float) for name in _KPI_FIELDS),
)
_NUMERIC_TEXT = r"^\s*[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?\s*$"
_PLAIN_DECIMAL = r"^-?[0-9]{1,17}(\.[0-9]{1,20})?$"
_ISO_MICROSECONDS = 'YYYY-MM-DD"T"HH24:MI:SS.US'

def kpi_record():
    """The summary fields the KPIs read, as floats, from one parse per run."""
    from qym_platform.db.dashboard_models import DashboardRunSummary as Summary

    return (
        func.json_to_record(Summary.data)
        .table_valued(*(column(name, Float) for name in (*_KPI_FIELDS, "total_items")))
        .render_derived(name="kpi_fields", with_types=True)
    )


# --- reading JSON values the way the Python reducers read them --------------


def _typeof(value):
    return func.json_typeof(value, type_=Text)


def _text(value):
    """A JSON value as text, strings unquoted (like ``->>``)."""
    return value.op("#>>", return_type=Text)(literal_column("'{}'"))


def _field(value, key):
    return value.op("->>", return_type=Text)(literal(key, Text))


def _float(number_text):
    """A number's text as float8, or NULL when float8 cannot hold it.

    Short plain decimals (what Python writes for run means) cast directly;
    anything else goes through ``numeric`` so an out-of-range number reads as
    missing (Python's float() makes it infinite, which the reducers drop)
    instead of failing the statement.
    """
    number = cast(number_text, Numeric)
    # "+ 0.0" turns -0.0 into 0.0, as ``_number`` does (``-0.0 or 0``).
    return case(
        (number_text.op("~")(_PLAIN_DECIMAL), cast(number_text, Float) + 0.0),
        # Python's float() rounds these to infinity; the reducers drop them.
        (func.abs(number) >= literal_column("1.797693134862315807937e308"), None),
        # ... and these to zero, where PostgreSQL would refuse them.
        (func.abs(number) < literal_column("2.4703282292062328e-324"), 0.0),
        else_=cast(number, Float) + 0.0,
    )


def _python_number(value):
    """``dashboard_views._number``: the number, else 0.0."""
    kind, text = _typeof(value), _text(value)
    return func.coalesce(
        case(
            (kind == "number", _float(text)),
            (kind == "boolean", case((text == "true", 1.0), else_=0.0)),
            (
                kind == "string",
                case((text.op("~")(_NUMERIC_TEXT), _float(func.trim(text)))),
            ),
        ),
        0.0,
    )


def _plain_number(value):
    """A value added as is (``row.get(k) or 0``); NULL adds nothing."""
    kind, text = _typeof(value), _text(value)
    return case(
        (kind == "number", _float(text)),
        (and_(kind == "boolean", text == "true"), 1.0),
    )


def _truthy_number(value):
    """``if row.get(k): total += row[k]`` (a number that reads as 0 is skipped)."""
    number = _plain_number(value)
    return case((number != 0, number))


def _item_count(value):
    """``row.get("total_items") or 0``, summed exactly (item counts are ints)."""
    kind, text = _typeof(value), _text(value)
    return case(
        (kind == "number", cast(text, Numeric)),
        (and_(kind == "boolean", text == "true"), 1),
        else_=0,
    )


def _truthy_json(value):
    """``isinstance(value, dict) or bool(value)``."""
    kind, text = _typeof(value), _text(value)
    return case(
        (kind == "object", true()),
        (kind == "array", func.json_array_length(value) > 0),
        (kind == "string", text != ""),
        # As Python reads it: an underflow is 0.0 (false), an overflow inf.
        (kind == "number", func.coalesce(_float(text) != 0, true())),
        (kind == "boolean", text == "true"),
        else_=false(),
    )


def _when(kind, value):
    return case((_typeof(value) == kind, value))


def _empty(sql_type):
    return literal_column(f"'{{}}'::{sql_type}")


def _rows(query, *names):
    """A JSON array of [column, ...] rows ('[]' when there are none)."""
    subquery = query.subquery()
    return (
        select(
            func.coalesce(
                func.json_agg(func.json_build_array(*(subquery.c[n] for n in names))),
                literal_column("'[]'::json"),
            )
        )
        .select_from(subquery)
        .scalar_subquery()
    )


def _row(query):
    subquery = query.subquery()
    return select(func.json_build_array(*subquery.c)).scalar_subquery()


def _digest(text):
    return func.encode(func.sha256(func.convert_to(func.coalesce(text, ""), "UTF8")), "hex")


def _materialized(query, name):
    # Materialized: an inlined subquery would repeat its expressions (and its
    # JSON parsing) wherever its columns are used.
    return query.cte(name).prefix_with("MATERIALIZED")


FACT_COLUMNS = (
    "run_key",
    "revision",
    "combo_task",
    "combo_dataset",
    "dataset_name",
    "git_commit",
    "owner_email",
    "owner_name",
    "success",
    "item_count",
    "latency",
    "median",
    "trace",
    "kpi_items",
    "kpi_executions",
    "kpi_successes",
    "kpi_errored",
    "mean_names",
    "mean_values",
    "metric_names",
    "spec_names",
    "spec_types",
    "spec_objects",
    "spec_json",
)


def facts_select(keys=None):
    """Each run's overview inputs (``DashboardRunOverview``'s columns), read
    from its descriptor and summary JSON: each document parsed once.

    The one place that reads the JSON: the summary worker and the backfill
    store its rows, and the overview reads it directly for runs whose stored
    row is missing or stale. ``keys`` (a selectable with ``run_key``) drives
    the read, so only those runs are parsed.
    """
    from qym_platform.api.dashboard import Dimension, Summary, _kpi_values

    descriptor = (
        func.json_to_record(Dimension.descriptor)
        .table_valued(*(column(name, kind) for name, kind in _DESCRIPTOR_FIELDS))
        .render_derived(name="ov_descriptor", with_types=True)
    )
    summary = (
        func.json_to_record(Summary.data)
        .table_valued(*(column(name, kind) for name, kind in _SUMMARY_FIELDS))
        .render_derived(name="ov_summary", with_types=True)
    )
    j = {**dict(descriptor.c.items()), **dict(summary.c.items())}
    entry = (
        func.json_each(_when("object", j["metric_averages"]))
        .table_valued(column("key", Text), column("value", JSON), with_ordinality="ordinality")
        .render_derived(name="ov_mean")
    )
    means = select(
        func.array_agg(aggregate_order_by(entry.c.key, entry.c.ordinality)).label("names"),
        func.array_agg(
            aggregate_order_by(_python_number(entry.c.value), entry.c.ordinality)
        ).label("numbers"),
    ).lateral("ov_means")
    listed = (
        func.json_array_elements_text(_when("array", j["metrics"]))
        .table_valued("value", with_ordinality="ordinality")
        .render_derived(name="ov_listed")
    )
    names = select(
        func.array_agg(aggregate_order_by(listed.c.value, listed.c.ordinality)).label("names")
    ).lateral("ov_names")
    spec = (
        func.json_each(_when("object", j["metric_specs"]))
        .table_valued(column("key", Text), column("value", JSON), with_ordinality="ordinality")
        .render_derived(name="ov_spec")
    )
    specs = select(
        func.array_agg(aggregate_order_by(spec.c.key, spec.c.ordinality)).label("names"),
        func.array_agg(
            aggregate_order_by(_field(spec.c.value, "score_type"), spec.c.ordinality)
        ).label("types"),
        func.array_agg(
            aggregate_order_by(_typeof(spec.c.value) == "object", spec.c.ordinality)
        ).label("objects"),
        func.array_agg(
            aggregate_order_by(cast(spec.c.value, Text), spec.c.ordinality)
        ).label("json"),
    ).lateral("ov_specs")
    kpi = _kpi_values(
        lambda name: cast(_text(j["total_items"]), Float)
        if name == "total_items"
        else j[name]
    )
    values = {
        "run_key": Dimension.run_key,
        "revision": Summary.projection_revision,
        "combo_task": func.coalesce(j["task_name"], ""),
        "combo_dataset": func.coalesce(j["dataset_name"], ""),
        "dataset_name": j["dataset_name"],
        "git_commit": func.coalesce(j["git_commit"], ""),
        "owner_email": _field(j["owner"], "email"),
        "owner_name": _field(j["owner"], "display_name"),
        "success": _plain_number(j["success_rate"]),
        "item_count": _item_count(j["total_items"]),
        "latency": _truthy_number(j["avg_latency_ms"]),
        "median": _truthy_number(j["median_latency_ms"]),
        "trace": _truthy_json(j["trace_stats"]),
        **kpi,
        "mean_names": means.c.names,
        "mean_values": means.c.numbers,
        "metric_names": names.c.names,
        "spec_names": specs.c.names,
        "spec_types": specs.c.types,
        "spec_objects": specs.c.objects,
        "spec_json": specs.c.json,
    }
    runs = Dimension.__table__.join(
        Summary.__table__, Summary.run_key == Dimension.run_key
    )
    if keys is not None:
        runs = keys.join(runs, Dimension.run_key == keys.c.run_key)
    return select(*(values[name].label(name) for name in FACT_COLUMNS)).select_from(
        runs.join(descriptor, true())
        .join(summary, true())
        .join(means, true())
        .join(names, true())
        .join(specs, true())
    )


def _upsert(condition):
    """INSERT the overview inputs of the runs matching ``condition`` (over
    the dimension and summary tables). A row never moves back to an older
    revision: the worker may store a newer publication while the backfill
    still holds an older one."""
    from sqlalchemy.dialects.postgresql import insert

    from qym_platform.db.dashboard_models import DashboardRunOverview as Facts

    statement = insert(Facts).from_select(
        list(FACT_COLUMNS), facts_select().where(condition)
    )
    return statement.on_conflict_do_update(
        index_elements=[Facts.run_key],
        set_={name: statement.excluded[name] for name in FACT_COLUMNS if name != "run_key"},
        where=statement.excluded.revision >= Facts.revision,
    )


def store_overview_facts(db, condition) -> int:
    """Write the overview inputs of the runs matching ``condition``.
    PostgreSQL only."""
    return db.execute(_upsert(condition)).rowcount or 0


# SQLAlchemy cannot cache the compiled form of an INSERT ... SELECT ... ON
# CONFLICT statement; building and compiling it took longer than running it,
# so the worker's one-run upsert is compiled once per process.
_ONE_RUN: Dict[Tuple[str, str], Tuple[str, Dict[str, Any]]] = {}


def _store_one_run(db, run_id) -> None:
    from sqlalchemy import bindparam

    from qym_platform.api.dashboard import Dimension

    connection = db.connection()
    dialect = connection.dialect
    key = (dialect.name, dialect.driver)
    if key not in _ONE_RUN:
        compiled = _upsert(Dimension.run_key == bindparam("overview_run_key")).compile(
            dialect=dialect
        )
        _ONE_RUN[key] = (str(compiled), dict(compiled.params))
    sql, params = _ONE_RUN[key]
    connection.exec_driver_sql(sql, {**params, "overview_run_key": run_id})


def refresh_run_overview(db, run_id) -> None:
    """Store one run's overview inputs after the summary worker writes it.

    In a savepoint: a value the inputs cannot read must not fail the
    publication. The overview then reads that run's JSON instead.
    """
    if db.get_bind().dialect.name != "postgresql":
        return
    db.flush()
    try:
        with db.begin_nested():
            _store_one_run(db, run_id)
    except Exception:  # noqa: BLE001 - the overview falls back to the JSON
        logger.warning("Could not store overview inputs of run %s", run_id, exc_info=True)


def build_overview_postgres(
    db,
    project,
    filters,
    sort="time-desc",
    collation=None,
    *,
    now=None,
    include_global=True,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """``api.dashboard._build_overview``'s payload (without ``project`` and
    the freshness fields) from one PostgreSQL statement.

    Returns ``(whole_project_part, filtered_part)``; the first is None when
    ``include_global`` is false.
    """
    from qym_platform.api.dashboard import (
        Dimension,
        Summary,
        _FILTER_COLUMNS,
        _base_conditions,
        _filter_conditions,
        _kpi_result,
        _kpi_totals,
        _ordered_query,
        _search_condition,
        _sort,
        _versioning_facets,
    )
    from qym_platform.db.dashboard_models import DashboardRunOverview as Facts

    now = now or datetime.now(timezone.utc)
    facet_flags = {
        name: and_(true(), *_filter_conditions({name: filters.get(name) or []}, facets=True))
        for name in _FILTER_COLUMNS
    }
    # Versioning keys narrow every facet, the chart and the list alike.
    terms = _filter_conditions(
        {k: filters[k] for k in ("since", "until", "versioning") if k in filters}
    )
    if filters.get("q"):
        # The search as a semi-join, which the trigram index serves (C060); as
        # a per-row flag it would read every run's JSON.
        searched = aliased(Dimension)
        terms.append(
            Dimension.run_key.in_(
                select(searched.run_key).where(
                    searched.project_key == project["id"] if project else false(),
                    _search_condition(filters["q"], searched),
                )
            )
        )
    rest = and_(true(), *terms)
    active = _filter_conditions(filters)
    # "Select none" in a filter empties the list; facets ignore it.
    none_selected = any(
        "__none__" in (filters.get(name) or []) for name in _FILTER_COLUMNS
    )
    in_chart = false() if none_selected else and_(rest, *facet_flags.values())

    # Positions and filter flags first, over narrow rows. The project's group
    # order is the Python catalog's stream order; the requested order is its
    # chart order.
    query, legacy = _ordered_query(_base_conditions(project), Dimension.run_key)
    order = _materialized(
        query.add_columns(
            Dimension.task.collate("C").label("task"),
            Dimension.model.collate("C").label("model"),
            Dimension.dataset.collate("C").label("dataset"),
            Dimension.status.collate("C").label("status"),
            Dimension.version.collate("C").label("version"),
            Dimension.owner.collate("C").label("owner_id"),
            _FILTER_COLUMNS["origins"].collate("C").label("origin"),
            Dimension.timestamp.label("timestamp"),
            Summary.projection_revision.label("revision"),
            func.row_number().over(order_by=legacy).label("pos_g"),
            func.row_number().over(order_by=[*_sort(sort, collation), *legacy]).label("pos_c"),
            *(flag.label("ff_" + name) for name, flag in facet_flags.items()),
            rest.label("ff_rest"),
            in_chart.label("in_chart"),
        ),
        "ov_order",
    )
    o = order.c

    # Each run's inputs: the stored row when it matches the published
    # revision, else read from the JSON (every run's for the whole-project
    # part, only the filtered runs' otherwise).
    fresh = select(*(Facts.__table__.c[name] for name in FACT_COLUMNS)).select_from(
        order.join(
            Facts.__table__,
            and_(Facts.run_key == o.run_key, Facts.revision == o.revision),
        )
    )
    missing = _materialized(
        select(o.run_key)
        .select_from(
            order.outerjoin(
                Facts.__table__,
                and_(Facts.run_key == o.run_key, Facts.revision == o.revision),
            )
        )
        .where(Facts.run_key.is_(None), true() if include_global else o.in_chart),
        "ov_missing",
    )
    facts = _materialized(union_all(fresh, facts_select(missing)), "ov_facts")
    f = facts.c
    # Grouping keys compare bytewise (COLLATE "C"): equality is the same as
    # under the database collation, and the payload orders groups itself.
    texts = ("combo_task", "combo_dataset", "dataset_name", "git_commit", "owner_name")
    scope = _materialized(
        select(
            *(o[name] for name in o.keys()),
            *(f[name].collate("C").label(name) for name in texts),
            *(f[name] for name in FACT_COLUMNS[2:] if name not in texts),
        ).select_from(order.outerjoin(facts, f.run_key == o.run_key)),
        "ov_scope",
    )
    s = scope.c

    entry = (
        func.unnest(s.mean_names, s.mean_values)
        .table_valued(column("metric", Text), column("number", Float), with_ordinality="ordinality")
        .render_derived(name="ov_entry")
    )
    means = _materialized(
        select(
            s.pos_g,
            s.pos_c,
            s.in_chart,
            s.combo_task.label("task"),
            s.combo_dataset.label("dataset"),
            s.model,
            entry.c.metric.collate("C").label("metric"),
            entry.c.ordinality,
            entry.c.number,
        ).select_from(scope.join(entry, true())),
        "ov_means",
    )
    listed = (
        func.unnest(s.metric_names)
        .table_valued("metric", with_ordinality="ordinality")
        .render_derived(name="ov_name")
    )
    names = _materialized(
        select(
            s.pos_c,
            s.in_chart,
            s.combo_task.label("task"),
            s.combo_dataset.label("dataset"),
            listed.c.metric.collate("C").label("metric"),
            listed.c.ordinality,
        ).select_from(scope.join(listed, true())),
        "ov_names",
    )

    parts: Dict[str, Any] = {}
    if include_global:
        parts.update(_global_parts(scope, means, names, now))
    parts.update(_chart_parts(scope, means, names))
    parts.update(_filter_parts(scope, _FILTER_COLUMNS))
    parts["kpis"] = (
        select(
            func.json_build_array(
                *_kpi_totals(
                    {name: s[name] for name in ("kpi_items", "kpi_executions", "kpi_successes", "kpi_errored")},
                    s.model,
                )
            )
        )
        .where(s.in_chart)
        .scalar_subquery()
    )
    statement = select(
        func.json_build_object(*[item for key, value in parts.items() for item in (key, value)])
    )
    raw = _overview_scalar(db, statement)
    if isinstance(raw, str):
        raw = json.loads(raw)
    whole = _assemble_global(raw, now) if include_global else None
    filtered = _assemble_chart(raw)
    filtered["kpis"] = _kpi_result(raw["kpis"], filtered=bool(active))
    filtered["facets"]["versioning"] = _versioning_facets(
        db, _base_conditions(project), filters
    )
    return whole, filtered


def _overview_scalar(db, statement):
    """Run ``statement`` with JIT off and exact float text, then restore the
    request's settings.

    The set-returning functions make the planner expect millions of rows;
    JIT compiling for that costs seconds and saves nothing here. The float
    sums leave PostgreSQL as JSON text: with ``extra_float_digits`` at 0 or
    below (a server, database or role may set it) that text is rounded, and
    the numbers would no longer be the Python build's. 3 writes text that
    reads back as the same float on every version.
    """
    settings = ("jit", "extra_float_digits")
    previous = db.execute(
        select(*(func.current_setting(name) for name in settings))
    ).one()
    db.execute(sql_text("SET LOCAL jit = off"))
    db.execute(sql_text("SET LOCAL extra_float_digits = 3"))
    value = db.execute(statement).scalar()
    db.execute(
        select(
            *(func.set_config(name, setting, True) for name, setting in zip(settings, previous))
        )
    )
    return value


def _global_parts(scope, means, names, now):
    s, m = scope.c, means.c
    overall = select(
        func.count(),
        func.coalesce(func.sum(s.item_count), 0),
        func.sum(aggregate_order_by(s.success, s.pos_g)),
        func.bool_or(s.trace),
    ).select_from(scope)

    def by(key):
        return select(
            key.label("key"),
            func.min(s.pos_g).label("first"),
            func.count().label("runs"),
            func.coalesce(func.sum(s.item_count), 0).label("items"),
            func.sum(aggregate_order_by(s.success, s.pos_g)).label("success"),
            func.bool_or(s.success != 0).label("added"),
        ).group_by(key)

    days = _days(now)
    day = func.date(s.timestamp)
    by_day = (
        select(
            func.to_char(day, "YYYY-MM-DD").label("key"),
            func.count().label("runs"),
            func.sum(aggregate_order_by(s.success, s.pos_g)).label("success"),
            func.bool_or(s.success != 0).label("added"),
        )
        .where(
            s.timestamp >= datetime.combine(days[0], datetime.min.time()),
            s.timestamp < datetime.combine(days[-1] + timedelta(days=1), datetime.min.time()),
        )
        .group_by(day)
    )

    # Metric types and specs, read in the project's group order. The Python
    # loop stops reading a metric after the first run whose mean is outside
    # [0, 1] (that run still counts): ``done`` is that run's position.
    out_of_range = or_(m.number > 1, m.number < 0)
    done = (
        select(
            m.metric,
            func.min(case((out_of_range, m.pos_g))).label("done"),
        )
        .group_by(m.metric)
        .subquery("ov_done")
    )
    spec_entry = (
        func.unnest(s.spec_names, s.spec_types, s.spec_objects, s.spec_json)
        .table_valued(
            column("metric", Text),
            column("score_type", Text),
            column("is_object", Boolean),
            column("spec", Text),
        )
        .render_derived(name="ov_spec")
    )
    specs = (
        select(
            s.pos_g,
            spec_entry.c.metric.collate("C").label("metric"),
            spec_entry.c.score_type,
            spec_entry.c.is_object,
            spec_entry.c.spec,
        )
        .select_from(scope.join(spec_entry, true()))
        .subquery("ov_specs")
    )
    # A spec's kind. Without a declared kind it follows the run's own mean:
    # numeric only when that mean is outside [0, 1], which among the runs
    # read is the run at ``done`` and no other.
    kinds = _materialized(
        select(
            specs.c.metric,
            specs.c.pos_g,
            specs.c.spec,
            case(
                (specs.c.score_type == "boolean", "boolean"),
                (specs.c.score_type == "percentage", "score"),
                (specs.c.score_type.in_(["count", "number"]), "numeric"),
                (specs.c.pos_g == done.c.done, "numeric"),
                else_="score",
            ).label("kind"),
        )
        .select_from(specs.outerjoin(done, done.c.metric == specs.c.metric))
        .where(
            specs.c.is_object,
            func.coalesce(specs.c.score_type, "") != "legacy",
            or_(done.c.done.is_(None), specs.c.pos_g <= done.c.done),
        ),
        "ov_kinds",
    )
    k = kinds.c
    return {
        "overall": _row(overall),
        "by_model": _rows(by(s.model), "key", "first", "runs", "items", "success", "added"),
        "by_task": _rows(by(s.combo_task), "key", "first", "runs", "items", "success", "added"),
        "by_day": _rows(by_day, "key", "runs", "success", "added"),
        "numeric": _rows(select(done.c.metric).where(done.c.done.isnot(None)), "metric"),
        "kinds": _rows(
            select(
                k.metric,
                func.count(func.distinct(k.kind)).label("count"),
                func.min(k.kind).label("kind"),
            ).group_by(k.metric),
            "metric",
            "count",
            "kind",
        ),
        "metric_specs": _rows(
            select(k.metric, k.pos_g.label("first"), cast(k.spec, JSON).label("spec"))
            .distinct(k.metric)
            .order_by(k.metric, k.pos_g),
            "metric",
            "first",
            "spec",
        ),
        "all_metrics": select(
            func.coalesce(func.array_agg(func.distinct(names.c.metric)), _empty("text[]"))
        ).scalar_subquery(),
        "owners": _rows(
            select(s.owner_id, s.owner_email.label("email"), s.owner_name.label("name"))
            .where(func.coalesce(s.owner_id, "") != "", func.coalesce(s.owner_email, "") != "")
            .distinct(s.owner_id)
            .order_by(s.owner_id, s.timestamp.desc(), s.run_key),
            "owner_id",
            "email",
            "name",
        ),
        "all_models": select(
            func.coalesce(func.array_agg(func.distinct(s.model)), _empty("text[]"))
        ).scalar_subquery(),
    }


def _chart_parts(scope, means, names):
    s, n = scope.c, names.c
    chart = select(scope).where(s.in_chart).subquery("ov_chart")
    c = chart.c
    stamp = func.concat("[", cast(func.to_json(c.run_key), Text), ",", cast(c.revision, Text), "]\n")
    stamps = func.string_agg(stamp, aggregate_order_by(literal_column("''"), c.pos_c))
    combos = select(
        c.combo_task.label("task"),
        c.combo_dataset.label("dataset"),
        func.min(c.pos_c).label("first"),
        func.count().label("runs"),
        _digest(stamps).label("revision"),
    ).group_by(c.combo_task, c.combo_dataset)
    first_listed = func.min(array([n.pos_c, n.ordinality])).label("first")
    combo_metrics = (
        select(n.task, n.dataset, n.metric, first_listed)
        .where(n.in_chart)
        .group_by(n.task, n.dataset, n.metric)
    )
    chart_metrics = select(n.metric, first_listed).where(n.in_chart).group_by(n.metric)
    models = select(
        c.combo_task.label("task"),
        c.combo_dataset.label("dataset"),
        c.model.label("model"),
        func.min(c.pos_c).label("first"),
        func.count().label("runs"),
        func.coalesce(func.sum(c.item_count), 0).label("items"),
        # Six fractional digits always: JSON drops trailing zeros (".12"),
        # which datetime.fromisoformat refuses before Python 3.11.
        func.to_char(func.max(c.timestamp), _ISO_MICROSECONDS).label("latest"),
        func.sum(aggregate_order_by(c.latency, c.pos_c)).label("latency_sum"),
        func.count(c.latency).label("latency_count"),
        func.array_agg(aggregate_order_by(c.median, c.median))
        .filter(c.median.isnot(None))
        .label("medians"),
    ).group_by(c.combo_task, c.combo_dataset, c.model)

    # Each model's metric means in chart order, with the running sum before
    # each run: the reducer restarts its count where that sum is 0.
    m = means.c
    group = (m.task, m.dataset, m.model, m.metric)
    running = (
        select(
            *group,
            m.pos_c,
            m.ordinality,
            m.number,
            func.sum(m.number)
            .over(partition_by=group, order_by=m.pos_c, rows=(None, -1))
            .label("before"),
        )
        .where(m.in_chart)
        .subquery("ov_running")
    )
    r = running.c
    rgroup = (r.task, r.dataset, r.model, r.metric)
    restarted = select(
        *rgroup,
        r.pos_c,
        r.ordinality,
        r.number,
        func.max(case((func.coalesce(r.before, 0) == 0, r.pos_c)))
        .over(partition_by=rgroup)
        .label("restart"),
    ).subquery("ov_restarted")
    q = restarted.c
    model_metrics = select(
        q.task,
        q.dataset,
        q.model,
        q.metric,
        func.min(array([q.pos_c, q.ordinality])).label("first"),
        func.sum(aggregate_order_by(q.number, q.pos_c)).label("total"),
        func.count().filter(q.pos_c >= q.restart).label("count"),
    ).group_by(q.task, q.dataset, q.model, q.metric)
    frequency = select(
        c.model.label("model"), func.min(c.pos_c).label("first"), func.count().label("runs")
    ).group_by(c.model)
    chart_overall = select(func.count(), func.bool_or(c.trace), _digest(stamps)).select_from(chart)
    return {
        "combos": _rows(combos, "task", "dataset", "first", "runs", "revision"),
        "combo_metrics": _rows(combo_metrics, "task", "dataset", "metric", "first"),
        "chart_metrics": _rows(chart_metrics, "metric", "first"),
        "models": _rows(
            models, "task", "dataset", "model", "first", "runs", "items", "latest",
            "latency_sum", "latency_count", "medians",
        ),
        "model_metrics": _rows(
            model_metrics, "task", "dataset", "model", "metric", "first", "total", "count"
        ),
        "frequency": _rows(frequency, "model", "first", "runs"),
        "chart": _row(chart_overall),
    }


def _filter_parts(scope, filter_names):
    s = scope.c
    columns = {
        "tasks": s.task,
        "models": s.model,
        "datasets": s.dataset,
        "statuses": s.status,
        "versions": s.version,
        "users": s.owner_id,
        "origins": s.origin,
    }
    sort_columns = {
        "tasks": s.task,
        "models": s.model,
        "dataset_names": s.dataset_name,
        "git_commits": s.git_commit,
        "owner_names": func.coalesce(s.owner_name, ""),
    }
    # One grouped pass: each distinct combination of the listed values, with
    # whether it is in each facet's scope and in the filtered list.
    facet_scope = {
        name: and_(s.ff_rest, *(s["ff_" + other] for other in filter_names if other != name))
        for name in filter_names
    }
    labels = {**{"f_" + n: c for n, c in columns.items()}, **{"v_" + n: c for n, c in sort_columns.items()}}
    values = (
        select(
            *(expression.label(label) for label, expression in labels.items()),
            *(func.bool_or(condition).label("in_" + name) for name, condition in facet_scope.items()),
            func.bool_or(s.in_chart).label("in_chart"),
        )
        .group_by(*labels.values())
        .subquery("ov_values")
    )
    v = values.c

    def distinct(label, condition):
        return func.coalesce(
            func.array_agg(func.distinct(v[label])).filter(condition), _empty("text[]")
        )

    listed = select(
        func.json_build_object(
            *[
                item
                for name in filter_names
                for item in (name, distinct("f_" + name, v["in_" + name]))
            ]
        ),
        func.json_build_object(
            *[
                item
                for name in sort_columns
                for item in (name, distinct("v_" + name, v.in_chart))
            ]
        ),
    ).select_from(values)
    return {"listed": _row(listed)}


def _days(now):
    return [(now - timedelta(days=offset)).date() for offset in range(6, -1, -1)]


def _first(value):
    return tuple(value) if isinstance(value, list) else (value,)


def _median(values):
    """``statistics.median`` of the sorted values (0 when there are none)."""
    size = len(values)
    if not size:
        return 0
    if size % 2:
        return values[size // 2]
    return (values[size // 2 - 1] + values[size // 2]) / 2


def _timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return (
        parsed.replace(tzinfo=timezone.utc)
        if parsed.tzinfo is None
        else parsed.astimezone(timezone.utc)
    )


def _float_sum(total, added):
    """A Python sum's value and type: ``total += row.get(k) or 0`` from an
    int 0 is a float once a float was added, else the int 0. The platform
    writes success rates, latencies and medians as floats; PostgreSQL's JSON
    writes a whole float without its ".0"."""
    return float(total) if added else 0


def _groups(rows):
    groups = {}
    for key, _, runs, items, success, added in sorted(rows, key=lambda row: row[1]):
        success = _float_sum(success, added)
        groups[key] = {
            "runs": runs,
            "items": items,
            "successSum": success,
            "avgSuccess": success / runs,
        }
    return groups


def _assemble_global(raw: Dict[str, Any], now) -> Dict[str, Any]:
    runs, items, success_total, has_any_trace = raw["overall"]
    by_model, by_task = _groups(raw["by_model"]), _groups(raw["by_task"])
    by_day = {day.isoformat(): {"runs": 0, "successSum": 0} for day in _days(now)}
    for key, count, success, added in raw["by_day"]:
        if key in by_day:
            by_day[key] = {"runs": count, "successSum": _float_sum(success, added)}
    success_total = 0.0 if success_total is None else success_total
    metrics = set(raw["all_metrics"] or [])
    numeric = {row[0] for row in raw["numeric"]}
    kinds = {name: (count, kind) for name, count, kind in raw["kinds"]}

    def metric_type(name):
        count, kind = kinds.get(name, (0, None))
        # One kind across the runs read, else numeric (the Python loop's rule).
        specified = kind if count == 1 else ("numeric" if count else None)
        return specified or ("numeric" if name in numeric else "score")

    return {
        "aggregations": {
            "totalRuns": runs,
            "totalTasks": len(by_task),
            "totalModels": len(by_model),
            "totalItems": items,
            "avgSuccess": success_total / runs if runs else 0.0,
            "byModel": by_model,
            "byTask": by_task,
            "byDay": by_day,
        },
        "all_models": sorted(raw["all_models"] or [], key=str.casefold),
        "all_metrics": sorted(metrics, key=_utf16_key),
        "metric_specs": {
            name: spec
            for name, _, spec in sorted(raw["metric_specs"], key=lambda row: (row[1], row[0]))
        },
        "metric_types": {name: metric_type(name) for name in metrics},
        "has_any_trace_stats": bool(has_any_trace),
        "owners": {
            owner: {"id": owner, "email": email, "display_name": name}
            for owner, email, name in raw["owners"]
        },
        "total_count": runs,
    }


def _assemble_chart(raw: Dict[str, Any]) -> Dict[str, Any]:
    model_values: Dict[tuple, Dict[str, Any]] = {}
    for (
        task, dataset, model, _, count, total_items, latest,
        latency_sum, latency_count, medians,
    ) in sorted(raw["models"], key=lambda row: row[3]):
        model_values.setdefault((task, dataset), {})[model] = {
            "runs": count,
            "runsList": [],
            "totalItems": total_items,
            "latestTimestamp": _iso(_timestamp(latest)),
            "metricSums": {},
            "metricCounts": {},
            "latencySum": _float_sum(latency_sum, latency_count),
            "latencyCount": latency_count,
            "metricAverages": {},
            "avgLatencyMs": latency_sum / latency_count if latency_count else 0,
            "medianLatencyMs": float(_median(medians)) if medians else 0,
        }
    for task, dataset, model, metric, _, total, count in sorted(
        raw["model_metrics"], key=lambda row: _first(row[4])
    ):
        values = model_values[(task, dataset)][model]
        # ``_number`` adds floats only.
        total = float(total)
        values["metricSums"][metric] = total
        values["metricCounts"][metric] = count
        values["metricAverages"][metric] = total / (count or 1)
    metric_lists: Dict[tuple, list] = {}
    for task, dataset, metric, _ in sorted(raw["combo_metrics"], key=lambda row: _first(row[3])):
        metric_lists.setdefault((task, dataset), []).append(metric)
    combos, tasks = [], {}
    for task, dataset, _, count, revision in sorted(
        raw["combos"], key=lambda row: (-row[3], row[2])
    ):
        combo = {
            "task": task,
            "dataset": dataset,
            "models": model_values.get((task, dataset), {}),
            "metrics": metric_lists.get((task, dataset), []),
            "totalRuns": count,
            "revision": revision,
        }
        combos.append(combo)
        tasks.setdefault(task, {"task": task, "datasets": []})["datasets"].append(combo)
    frequency = {
        model: count for model, _, count in sorted(raw["frequency"], key=lambda row: row[1])
    }
    chart_models = sorted(frequency, key=lambda model: -frequency[model])
    chart_metrics = [
        metric for metric, _ in sorted(raw["chart_metrics"], key=lambda row: _first(row[1]))
    ]
    chart_runs, chart_trace, filtered_revision = raw["chart"]
    facet_values, sort_values = raw["listed"]
    facets = {}
    for name, values in facet_values.items():
        normalized = {
            str(value) if value is not None and str(value).strip() else "__empty__"
            for value in values or []
        }
        facets[name] = sorted(normalized - {"__empty__"}, key=str.casefold) + (
            ["__empty__"] if "__empty__" in normalized else []
        )
    return {
        "chart_data": {
            "combos": combos,
            "tasks": sorted(
                tasks.values(),
                key=lambda task: -sum(combo["totalRuns"] for combo in task["datasets"]),
            ),
            "models": chart_models,
            "metrics": chart_metrics,
            "modelIndex": {name: index for index, name in enumerate(chart_models)},
            "model_frequency": frequency,
        },
        "filtered_revision": filtered_revision,
        "metrics": sorted(chart_metrics, key=_utf16_key),
        "total_runs": chart_runs,
        "has_trace_stats": bool(chart_trace),
        "facets": facets,
        "sort_values": {name: list(values or []) for name, values in sort_values.items()},
    }


# --- the overview shared by every process and pod ------------------------------

# Entries of a replaced catalog revision stay this long for readers still on
# an older snapshot; any entry goes after a day; a project keeps at most
# SHARED_PER_PROJECT filter entries (every distinct filter, search and sort is
# one). Its project parts (one per revision, day and hidden-task policy) are
# not counted: every filter reuses them.
SHARED_GRACE = timedelta(minutes=2)
SHARED_MAX_AGE = timedelta(days=1)
SHARED_PER_PROJECT = 200
# Entries of every project older than SHARED_MAX_AGE are pruned by at most one
# writer per process in this interval; the per-project prune runs on each write.
SHARED_GLOBAL_PRUNE_INTERVAL = timedelta(minutes=10)
_next_global_prune = 0.0
# Namespace of the shared store's pg_try_advisory_xact_lock keys.
_STORE_LOCK_SPACE = "qym.dashboard_overview_snapshots:"
# Bump when the stored payload changes shape, so pods of a new release never
# read an entry an older release stored for the same revision. 2: a filter
# entry holds only its filtered part. 3: the filtered facets carry origins
# and versioning.
SHARED_SHAPE = 3
# Key prefixes: the whole-project part and one filter's part.
_PROJECT_PART = "p:"
_FILTER_PART = "f:"


def _shared_key(kind: str, *parts) -> str:
    import hashlib

    text = json.dumps(
        [SHARED_SHAPE, *parts], sort_keys=True, separators=(",", ":"), default=str
    )
    # 64 characters: the kind's prefix and 62 hex digits of the hash.
    return kind + hashlib.sha256(text.encode("utf-8")).hexdigest()[: 64 - len(kind)]


def _stable_bounds(filters) -> bool:
    """Whether the time range is one a later request repeats.

    Today and a custom range are whole days (whole minutes in UTC). Last 7
    and 30 days are now minus N days to the millisecond, a bound no later
    request sends again: an entry stored for it would never be read.
    """
    for name in ("since", "until"):
        bound = filters.get(name)
        if isinstance(bound, datetime) and (bound.second or bound.microsecond):
            return False
    return True


def load_shared(db, keys) -> Dict[str, Any]:
    """The stored overview parts among ``keys``, read in the request's own
    snapshot (an entry never changes once written). A store that cannot be
    read only costs a recompute."""
    from qym_platform.db.dashboard_models import DashboardOverviewSnapshot as Snapshot

    try:
        # A savepoint keeps the request's transaction usable if the read fails.
        with db.begin_nested():
            rows = db.execute(
                select(Snapshot.cache_key, Snapshot.payload).where(Snapshot.cache_key.in_(keys))
            ).all()
    except Exception:  # noqa: BLE001 - the store only saves work
        logger.warning("Could not read the shared overview cache", exc_info=True)
        return {}
    return {key: json.loads(payload) for key, payload in rows}


def _store_lock_key(name: str):
    """A 64-bit advisory lock key for one project (or the global prune).

    Advisory locks are database-wide: the key includes the schema, so two
    deployments (or test schemas) sharing a database never block each other.
    """
    return func.hashtextextended(
        func.current_schema() + literal(":" + _STORE_LOCK_SPACE + name), 0
    )


def _try_store_lock(connection, name: str) -> bool:
    """Take a transaction-scoped advisory lock without waiting.

    Readers that miss the cache together all try to store the same entries
    and prune the same rows; one writer per project proceeds and the others
    skip (a skipped write only costs a later recompute). Databases without
    advisory locks always proceed.
    """
    if connection.dialect.name != "postgresql":
        return True
    return bool(
        connection.execute(
            select(func.pg_try_advisory_xact_lock(_store_lock_key(name)))
        ).scalar()
    )


def _global_prune_due() -> bool:
    """At most one prune of every project's old entries per interval."""
    import time

    global _next_global_prune
    now = time.monotonic()
    if now < _next_global_prune:
        return False
    _next_global_prune = now + SHARED_GLOBAL_PRUNE_INTERVAL.total_seconds()
    return True


def store_shared(engine, entries, project_key: str, catalog_revision: str) -> None:
    """Store overview parts (``{key: value}``) for every process and pod, and
    prune entries of replaced revisions and old ones.

    Its own short transaction, on a connection taken after the request's
    snapshot connection was released (``api.dashboard.after_snapshot``). A
    failed or skipped write only costs the next reader a recompute.

    One writer per project at a time (a non-blocking advisory lock): readers
    that missed the cache together never wait on, or deadlock over, each
    other's inserts and prunes. Other projects' old entries are pruned only
    occasionally, so a request rarely touches rows outside its project.
    """
    from sqlalchemy import delete
    from sqlalchemy.dialects.postgresql import insert

    from qym_platform.db.dashboard_models import DashboardOverviewSnapshot as Snapshot

    now = datetime.utcnow()
    try:
        with engine.begin() as connection:
            if not _try_store_lock(connection, "project:" + project_key):
                return
            connection.execute(
                insert(Snapshot)
                .values(
                    [
                        {
                            "cache_key": key,
                            "project_key": project_key,
                            "catalog_revision": catalog_revision,
                            "payload": json.dumps(value, separators=(",", ":"), default=str),
                            "created_at": now,
                        }
                        for key, value in entries.items()
                    ]
                )
                .on_conflict_do_nothing(index_elements=[Snapshot.cache_key])
            )
            connection.execute(
                delete(Snapshot).where(
                    Snapshot.project_key == project_key,
                    or_(
                        and_(
                            Snapshot.catalog_revision != catalog_revision,
                            Snapshot.created_at < now - SHARED_GRACE,
                        ),
                        Snapshot.created_at < now - SHARED_MAX_AGE,
                    ),
                )
            )
            newest = (
                select(Snapshot.cache_key)
                .where(
                    Snapshot.project_key == project_key,
                    Snapshot.cache_key.startswith(_FILTER_PART),
                )
                .order_by(Snapshot.created_at.desc())
                .offset(SHARED_PER_PROJECT)
            )
            connection.execute(
                delete(Snapshot).where(
                    Snapshot.project_key == project_key,
                    Snapshot.cache_key.in_(newest.scalar_subquery()),
                )
            )
            if _global_prune_due() and _try_store_lock(connection, "global-prune"):
                connection.execute(
                    delete(Snapshot).where(Snapshot.created_at < now - SHARED_MAX_AGE)
                )
    except Exception:  # noqa: BLE001 - the store only saves work
        logger.warning("Could not write the shared overview cache", exc_info=True)


def forget_shared(db, project_key: str) -> None:
    """Drop a project's stored overviews (a session or connection's work):
    they hold names and numbers of runs that are being removed."""
    from sqlalchemy import delete

    from qym_platform.db.dashboard_models import DashboardOverviewSnapshot as Snapshot

    db.execute(delete(Snapshot).where(Snapshot.project_key == project_key))


def shared_overview(
    db, project, filters, sort, collation, *, catalog_revision, hidden_tasks, now=None
) -> Dict[str, Any]:
    """The overview for one published catalog revision, computed once for
    every process and pod.

    The whole-project part is stored per revision and day, so a new filter,
    search or sort only computes the filtered part (and reads only the
    filtered runs); a filter's entry holds that part only, and a read joins
    the two. A time range no later request repeats (Last 7 or 30 days) has no
    entry of its own. ``db`` is the request's repeatable-read snapshot, which
    ``catalog_revision`` was read from; what this request computes is stored
    after that snapshot's connection is released.
    """
    from qym_platform.api.dashboard import after_snapshot

    now = now or datetime.now(timezone.utc)
    engine = db.get_bind().engine
    base = (project["id"], catalog_revision, hidden_tasks, now.date().isoformat())
    whole_key = _shared_key(_PROJECT_PART, *base)
    key = (
        _shared_key(_FILTER_PART, *base, filters, sort, list(collation or ()))
        if _stable_bounds(filters)
        else None
    )
    stored = load_shared(db, [whole_key] + ([key] if key else []))
    whole, part = stored.get(whole_key), stored.get(key) if key else None
    if whole is not None and part is not None:
        return {**whole, **part}
    built, part = build_overview_postgres(
        db, project, filters, sort, collation, now=now, include_global=whole is None
    )
    entries = {}
    if whole is None:
        whole = entries[whole_key] = built
    if key:
        entries[key] = part
    if entries:
        after_snapshot(
            db, lambda: store_shared(engine, entries, project["id"], catalog_revision)
        )
    return {**whole, **part}
