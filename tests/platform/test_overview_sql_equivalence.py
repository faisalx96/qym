"""C037: the overview aggregated in PostgreSQL equals the Python build.

``api.dashboard._build_overview_python`` reduces every run in Python (the
shipped definition, still used on SQLite). ``build_overview_postgres`` does
the work in one statement over each run's stored overview inputs, reading a
run's JSON when its stored row is missing or stale. For seeded projects (real
classic and repeat runs through the ingest endpoint and the summary worker,
with task errors and lower-is-better metrics, plus projection rows that cover
every value the reducers read: zero and negative means, means outside [0, 1],
every metric spec kind, hidden and pending runs, hidden tasks) both builds
must give the same payload, to the last bit and in the same order, for every
filter and sort; with the stored inputs, without them, and with a mix.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta

import pytest
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.db.dashboard_models import (
    DashboardRunDimension as Dimension,
    DashboardRunOverview as Facts,
    DashboardRunSummary as Summary,
)
from qym_platform.services.dashboard_overview import (
    build_overview_postgres,
    store_overview_facts,
)
from test_dashboard_durable_summaries import database, drain  # noqa: F401
from test_lost_outcome_events import emitter  # noqa: F401

PROJECT = {"id": "p"}
# Dict keys whose order the Python build leaves to set or DISTINCT order.
UNORDERED = {"metric_specs", "metric_types", "owners"}
METRICS = ["q", "h", "u", "delta", "count", "b", "p", "late", "mixed"]
# Run means as the platform publishes them (the metric sort itself casts them
# to float, so text is out of scope here; see the reader test below).
MEANS = [0.0, 0.0, 0.5, 1.0, 0.25, 0.123456789, 1 / 3, -0.5, 0.5, 3, 7.5, None, 1e-05, 0.1, 0.2, 0.7]
SPECS = [
    {"score_type": "boolean"},
    {"score_type": "percentage", "direction": "minimize"},
    {"score_type": "count"},
    {"score_type": "number"},
    {"score_type": "numeric", "direction": "maximize"},
    {"score_type": "legacy"},
    {"direction": "maximize"},
    None,
    "x",
]
OWNERS = {
    "u": {"id": "u", "email": "owner@example.test", "display_name": "Owner"},
    "u2": {"id": "u2", "email": "second@example.test", "display_name": None},
    "u3": None,
}
CASES = [
    ({}, "time-desc", None),
    ({}, "time-asc", None),
    ({}, "created-desc", None),
    ({"statuses": ["COMPLETED"]}, "metric-q-desc", None),
    ({}, "metric-delta-asc", None),
    ({"tasks": ["__empty__", "task-a"]}, "success-desc", None),
    ({"models": ["__none__"]}, "time-desc", None),
    ({"q": "run 1"}, "time-asc", None),
    ({"q": '"q"'}, "run-asc", None),
    ({"since": "2026-09-25T00:00:00Z", "until": "2026-10-01T00:00:00Z"}, "owner-asc", None),
    ({}, "task-asc", ["task-b", "task-a", "t", ""]),
    ({}, "model-desc", None),
    ({"datasets": ["ds-a", "__empty__"]}, "dataset-asc", None),
    ({"versions": ["main/abc"]}, "version-desc", None),
    ({"users": ["u2"]}, "items-desc", None),
    ({}, "activity-desc", None),
    ({}, "duration-asc", None),
    ({}, "trace-avg_tokens-desc", None),
    ({}, "status-asc", None),
    ({}, "latency-asc", None),
    ({"statuses": ["RUNNING", "FAILED"], "tasks": ["task-b"]}, "median-latency-desc", None),
]


@pytest.fixture
def pg(database):  # noqa: F811
    if database.dialect.name != "postgresql":
        pytest.skip("the overview is aggregated in PostgreSQL only")
    return database


def _seed_projection(engine, *, count=72, seed=37):
    """Projection rows (as the worker writes them) with every value the
    overview reducers read, in deterministic random combinations."""
    rng = random.Random(seed)
    now = datetime.utcnow().replace(microsecond=0)
    with Session(engine) as db:
        for index in range(count):
            key = f"edge-{index:03}" if index != 7 else 'edge-"q"-7'
            task = rng.choice(["task-a", "task-a", "task-b", "", "hidden-task"])
            raw_model = rng.choice(["model-a", "model-b", "nomodel"])
            model = raw_model + rng.choice(["|||plain", "|||plain", "|||reasoning"])
            dataset = rng.choice(["ds-a", "ds-b", "", None])
            version = rng.choice([None, "v1"])
            owner = rng.choice(list(OWNERS))
            commit = rng.choice([None, "abc", ""])
            # Ties on purpose: several runs share a timestamp.
            stamp = now - timedelta(days=rng.choice([0, 1, 2, 3, 6, 9, 30]), hours=rng.choice([0, 0, 5]))
            listed = rng.sample(METRICS, rng.randint(0, 5))
            if listed and rng.random() < 0.2:
                listed.append(listed[0])  # a duplicate name
            means = {
                metric: rng.choice(MEANS)
                for metric in rng.sample(METRICS, rng.randint(0, 6))
            }
            if "delta" in means:
                means["delta"] = rng.choice([-0.5, 0.5, 0.25, 0.0])
            specs = {
                metric: rng.choice(SPECS)
                for metric in rng.sample(METRICS, rng.randint(0, 5))
            }
            descriptor = {
                "run_id": key,
                "file_path": key,
                "run_name": f"Run {index}",
                "external_run_id": rng.choice([f"exp-{index}", "", f"Run {index} copy"]),
                "task_name": task,
                "model_name": raw_model,
                "dataset_name": dataset,
                "timestamp": stamp.isoformat() + "Z",
                "_activity_sort_at": (stamp + timedelta(minutes=index)).isoformat() + "Z",
                "owner": OWNERS[owner],
                "metrics": listed if rng.random() > 0.05 else None,
                "metric_specs": specs if rng.random() > 0.1 else rng.choice([None, {}]),
                "trace_stats": rng.choice(
                    [None, {}, {"avg_tokens": index}, [], ["x"], "", "x", 0, 2]
                ),
                "git_commit": commit,
                "status": "COMPLETED",
            }
            revision = rng.choice([1, 2, 3, 0]) if index % 9 else 0
            data = (
                {}
                if revision == 0
                else {
                    "metric_averages": means if rng.random() > 0.05 else None,
                    "total_items": rng.choice([10, 0, None, 3, 100]),
                    # Floats, as the summary worker writes them.
                    "success_rate": rng.choice([0.5, 0.0, None, 1.0, 1 / 3, 0.1, 0.2]),
                    "avg_latency_ms": rng.choice([0.0, None, 1234.5, 10.0, 0.1]),
                    "median_latency_ms": rng.choice([0.0, None, 1000.0, 3.5, 7.0]),
                    "duration_ms": rng.choice([None, 10, 20.5]),
                    **{
                        name: rng.choice([0, 1, 2, None])
                        for name in rng.sample(
                            [
                                "task_error_count",
                                "metric_error_count",
                                "execution_error_count",
                                "error_count",
                                "execution_count",
                                "execution_success_count",
                                "success_count",
                            ],
                            rng.randint(0, 7),
                        )
                    },
                }
            )
            db.add(
                Dimension(
                    run_key=key,
                    project_key="p",
                    task=task,
                    model=model,
                    dataset=(dataset or "") + ("␟" + version if version else ""),
                    version=("main/" + commit) if commit else "",
                    owner=owner,
                    status=rng.choice(["COMPLETED", "COMPLETED", "FAILED", "RUNNING"]),
                    timestamp=stamp,
                    created_at=stamp - timedelta(minutes=rng.choice([0, 1])),
                    present=index % 17 != 5,
                    hidden_at=now if index % 19 == 4 else None,
                    descriptor=descriptor,
                )
            )
            db.add(Summary(run_key=key, project_key="p", data=data, projection_revision=revision))
        db.commit()


def _real_runs(emitter):  # noqa: F811
    """A clean classic run, one with a task error, and a repeat run with a
    failed pass, through the ingest endpoint (h is lower-is-better)."""
    clean = emitter("overview-clean", 1, ["q", "h", "u"])
    events = clean.started(2)
    events += clean.passed("a", 0, 1, {"q": 1.0, "h": 0.2, "u": 0.0})
    events += clean.passed("b", 1, 1, {"q": 0.5, "h": 0.4, "u": 0.0})
    clean.post(events)
    clean.post(clean.completed(2, 0))
    errors = emitter("overview-errors", 1, ["q", "h"])
    events = errors.started(2)
    events += errors.passed("a", 0, 1, {"q": 0.0, "h": 0.3})
    events += errors.failed("b", 1, 1, error="boom", attempt_error="boom")
    errors.post(events)
    errors.post(errors.completed(2, 0))
    repeat = emitter("overview-repeat", 3, ["h", "q", "u"])
    events = repeat.started(2)
    for pass_number in (1, 2, 3):
        events += repeat.passed("a", 0, pass_number, {"h": 0.2, "q": 1.0, "u": 0.5})
        if pass_number == 2:
            events += repeat.failed("x", 1, pass_number, error="tool", attempt_error="tool")
        else:
            events += repeat.passed("x", 1, pass_number, {"h": 0.4, "q": 1.0, "u": 0.8})
    repeat.post(events)
    repeat.post(repeat.completed(2, 0))
    # One run stays live: no run_completed.
    live = emitter("overview-live", 1, ["q"])
    live.post(live.started(3) + live.passed("a", 0, 1, {"q": 0.9}))


def _diff(expected, actual, path=""):
    """Every difference, including dict key order and float bits."""
    problems = []
    if isinstance(expected, dict) and isinstance(actual, dict):
        # The payload's own keys are read by name; nested orders are shown.
        ordered = path and path.rsplit(".", 1)[-1] not in UNORDERED
        if ordered and list(expected) != list(actual):
            problems.append(f"{path}: keys {list(expected)} != {list(actual)}")
        for key in set(expected) | set(actual):
            if key not in expected or key not in actual:
                problems.append(f"{path}.{key}: only in one")
            else:
                problems += _diff(expected[key], actual[key], f"{path}.{key}")
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            problems.append(f"{path}: {len(expected)} != {len(actual)} items")
        for index, (left, right) in enumerate(zip(expected, actual)):
            problems += _diff(left, right, f"{path}[{index}]")
    elif isinstance(expected, float) and isinstance(actual, float):
        if expected.hex() != actual.hex():
            problems.append(f"{path}: {expected!r} != {actual!r}")
    elif type(expected) is not type(actual) or expected != actual:
        # Types too: the JSON text of 1 and 1.0 differs.
        problems.append(f"{path}: {expected!r} != {actual!r}")
    return problems


def _assert_same(engine, filters, sort, collation):
    parsed = dashboard._parse_filters(json.dumps(filters))
    with Session(engine) as db:
        expected = dashboard._build_overview_python(db, PROJECT, parsed, sort, collation)
        whole, part = build_overview_postgres(db, PROJECT, parsed, sort, collation)
        _, alone = build_overview_postgres(
            db, PROJECT, parsed, sort, collation, include_global=False
        )
    for key in ("project", "revision", "catalog_revision", "freshness"):
        expected.pop(key)
    actual = {**whole, **part}
    for payload in (expected, actual):
        # The Python build lists sort values in DISTINCT order.
        payload["sort_values"] = {
            name: sorted(values, key=lambda value: (value is None, str(value)))
            for name, values in payload["sort_values"].items()
        }
    assert set(actual) == set(expected)
    problems = _diff(expected, actual)
    assert not problems, (filters, sort, problems[:10])
    # The filtered part alone (the whole-project part cached) is the same.
    alone["sort_values"] = actual["sort_values"]
    assert alone == part


def _store_all(engine):
    with Session(engine) as db:
        store_overview_facts(db, Dimension.project_key == "p")
        db.commit()


def _stored(engine):
    with Session(engine) as db:
        return db.query(Facts).count()


def test_overview_matches_the_python_build_for_every_filter_and_sort(
    pg, emitter, monkeypatch  # noqa: F811
):
    _real_runs(emitter)
    drain(pg)
    # The summary worker stored the published runs' inputs.
    assert _stored(pg) >= 4
    _seed_projection(pg)
    monkeypatch.setenv("QYM_HIDDEN_TASKS", "hidden-task")

    # Read from the JSON for the seeded rows (no stored inputs yet).
    for filters, sort, collation in CASES:
        _assert_same(pg, filters, sort, collation)

    # Stored inputs for every run.
    _store_all(pg)
    for filters, sort, collation in CASES:
        _assert_same(pg, filters, sort, collation)

    # A mix: some rows missing, some stale (published again since stored).
    with Session(pg) as db:
        keys = sorted(db.scalars(Dimension.__table__.select().with_only_columns(Dimension.run_key)))
        db.execute(delete(Facts).where(Facts.run_key.in_(keys[::3])))
        db.execute(
            update(Summary)
            .where(Summary.run_key.in_(keys[1::5]))
            .values(projection_revision=Summary.projection_revision + 1)
        )
        db.commit()
    for filters, sort, collation in CASES:
        _assert_same(pg, filters, sort, collation)

    # No hidden tasks.
    monkeypatch.delenv("QYM_HIDDEN_TASKS")
    for filters, sort, collation in CASES[:4]:
        _assert_same(pg, filters, sort, collation)


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_overview_matches_the_python_build_on_other_projects(pg, seed):
    _seed_projection(pg, count=40, seed=seed)
    _store_all(pg)
    for filters, sort, collation in CASES[:6] + CASES[10:12]:
        _assert_same(pg, filters, sort, collation)


def test_float_sums_add_in_the_python_order(pg):
    """Oldest first, newest first and run-key order give three different
    float sums for these means: the SQL sums must add in the Python order."""
    values = [0.15, 0.7, 2 / 3, 0.6, 0.1, 1 / 3, 0.2]
    rank = {value: index for index, value in enumerate(sorted(values))}
    start = datetime(2026, 9, 20)
    with Session(pg) as db:
        for index, value in enumerate(values):
            key = f"order-{rank[value]}"
            stamp = start + timedelta(hours=index)
            db.add(
                Dimension(
                    run_key=key, project_key="p", task="t", model="m|||plain", dataset="d",
                    version="", owner="u", status="COMPLETED", timestamp=stamp,
                    created_at=stamp, present=True,
                    # As _sync_dimension writes it: the column's own time.
                    descriptor={
                        "run_id": key, "task_name": "t", "dataset_name": "d", "metrics": ["q"],
                        "timestamp": stamp.isoformat() + "Z",
                    },
                )
            )
            db.add(
                Summary(
                    run_key=key, project_key="p", projection_revision=1,
                    data={"metric_averages": {"q": value}, "success_rate": value,
                          "avg_latency_ms": value, "total_items": 1},
                )
            )
        db.commit()
    for stored in (False, True):
        if stored:
            _store_all(pg)
        for sort in ("time-asc", "time-desc", "metric-q-desc", "metric-q-asc"):
            _assert_same(pg, {}, sort, None)


def test_an_empty_or_unknown_project_matches(pg):
    for project in ({"id": "p"}, None):
        parsed = dashboard._parse_filters("{}")
        with Session(pg) as db:
            expected = dashboard._build_overview_python(db, project, parsed)
            whole, part = build_overview_postgres(db, project, parsed)
        for key in ("project", "revision", "catalog_revision", "freshness"):
            expected.pop(key)
        assert not _diff(expected, {**whole, **part})


READER_VALUES = [
    "0", "0.0", "-0.0", "1", "0.1", "0.3333333333333333", "-2.5", "1e-05",
    "1.5e300", "1e400", "-1e400", "1e-400", "5e-324", "123456789012345678901234567890",
    "null", "true", "false", '"0.5"', '" 2 "', '"1e3"', '"abc"', '""', '".5"',
    '"1."', "[]", "[1]", "{}", '{"a": 1}',
]


def test_json_values_read_as_the_python_reducers_read_them(pg):
    """``_number``, ``row.get(k) or 0`` and truthiness, in SQL, for any JSON."""
    from sqlalchemy import cast, literal, select
    from sqlalchemy.types import JSON, Text

    from qym_platform.services import dashboard_overview as overview
    from qym_platform.services.dashboard_views import _number

    with Session(pg) as db:
        for raw in READER_VALUES:
            loaded = json.loads(raw)
            document = cast(literal(raw, Text), JSON)
            number, truthy, added = db.execute(
                select(
                    overview._python_number(document),
                    overview._truthy_json(document),
                    overview._truthy_number(document),
                )
            ).one()
            expected = _number(loaded)
            assert (number, repr(number)) == (expected, repr(float(expected))), raw
            assert truthy == (isinstance(loaded, dict) or bool(loaded)), raw
            if isinstance(loaded, (int, float)) and not isinstance(loaded, bool):
                finite = abs(loaded) != float("inf")
                assert added == (float(loaded) if loaded and finite else None), raw
