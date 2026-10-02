"""C037: each run's stored overview inputs and the shared overview cache.

The summary worker stores a run's overview inputs when it publishes the run,
the ``backfill_dashboard_overview`` job stores them for older runs, and
PostgreSQL aggregates the overview over them. One computed overview per
catalog revision is stored for every process and pod. These tests follow runs
through live publication, the backfill, purge and project deletion, check
that a request holds one connection, and check the SQLite fallback.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, event, func, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.api import dashboard
from qym_platform.db.dashboard_models import (
    DashboardOverviewSnapshot as Snapshot,
    DashboardRunDimension as Dimension,
    DashboardRunOverview as Facts,
    DashboardRunSummary as Summary,
)
from qym_platform.db.maintenance_models import MaintenanceJob
from qym_platform.db.models import Project, Run
from qym_platform.services import dashboard_overview, maintenance, retention
from qym_platform.services.dashboard_cache import DashboardSnapshotCache
from qym_platform.services.dashboard_overview import (
    FACT_COLUMNS,
    facts_select,
    store_overview_facts,
)
from test_dashboard_durable_summaries import database, drain  # noqa: F401
from test_lost_outcome_events import emitter, rid  # noqa: F401
from test_overview_sql_equivalence import _diff, _seed_projection, pg  # noqa: F401

PROJECT = {"id": "p"}
VOLATILE = ("project", "revision", "catalog_revision", "freshness")


@pytest.fixture(autouse=True)
def no_process_cache(monkeypatch):
    """Every read is a new process (or another pod): only the shared store
    can save work."""
    monkeypatch.setattr(dashboard, "_overview_cache", DashboardSnapshotCache(max_entries=0))
    monkeypatch.setattr(dashboard, "_kpi_cache", DashboardSnapshotCache(max_entries=0))
    monkeypatch.setattr(dashboard, "_catalog_cache", DashboardSnapshotCache(max_entries=0))


def _served(engine, filters=None, sort="time-desc"):
    """The overview as a request reads it: one repeatable-read snapshot."""
    parsed = dashboard._parse_filters(json.dumps(filters or {}))
    with Session(engine) as auth:
        with dashboard._read_snapshot(auth) as reader:
            return dashboard._overview(reader, PROJECT, parsed, sort)


def _python(engine, filters=None, sort="time-desc"):
    parsed = dashboard._parse_filters(json.dumps(filters or {}))
    with Session(engine) as db:
        return dashboard._build_overview_python(db, PROJECT, parsed, sort)


def _assert_same(served, expected):
    actual, expected = dict(served), dict(expected)
    for payload in (actual, expected):
        for key in VOLATILE:
            payload.pop(key, None)
        # The Python build lists sort values in DISTINCT order.
        payload["sort_values"] = {
            name: sorted(values, key=lambda value: (value is None, str(value)))
            for name, values in payload["sort_values"].items()
        }
    # Through JSON, as the shared store and the response carry it.
    actual = json.loads(json.dumps(actual, default=str))
    expected = json.loads(json.dumps(expected, default=str))
    problems = _diff(expected, actual)
    assert not problems, problems[:10]


def _stored_row(engine, run_id):
    with Session(engine) as db:
        row = db.execute(
            select(*(Facts.__table__.c[name] for name in FACT_COLUMNS)).where(
                Facts.run_key == run_id
            )
        ).mappings().first()
        return dict(row) if row else None


def _read_from_json(engine, run_id):
    with Session(engine) as db:
        return dict(
            db.execute(facts_select().where(Dimension.run_key == run_id)).mappings().one()
        )


def _published_revision(engine, run_id):
    with Session(engine) as db:
        return db.get(Summary, run_id).projection_revision


def _snapshots(engine, project_key="p"):
    with Session(engine) as db:
        return db.execute(
            select(Snapshot.cache_key, Snapshot.catalog_revision).where(
                Snapshot.project_key == project_key
            )
        ).all()


def _model_values(overview):
    (combo,) = overview["chart_data"]["combos"]
    (values,) = combo["models"].values()
    return values


def test_the_worker_keeps_a_live_runs_inputs_current(pg, emitter):  # noqa: F811
    live = emitter("store-live", 1, ["q"])
    run_id = rid("store-live")
    live.post(live.started(3) + live.passed("a", 0, 1, {"q": 1.0}))
    drain(pg)
    first = _stored_row(pg, run_id)
    assert first is not None
    assert first["revision"] == _published_revision(pg, run_id) > 0
    assert first == _read_from_json(pg, run_id)
    before = _served(pg)
    assert _model_values(before)["metricAverages"] == {"q": 1.0}
    _assert_same(before, _python(pg))

    # The live run publishes again: its stored row follows, and the next
    # read serves the new numbers, not the stored overview of the old ones.
    live.post(live.passed("b", 1, 1, {"q": 0.0}))
    drain(pg)
    second = _stored_row(pg, run_id)
    assert second["revision"] == _published_revision(pg, run_id) > first["revision"]
    assert second == _read_from_json(pg, run_id)
    after = _served(pg)
    assert after["catalog_revision"] != before["catalog_revision"]
    assert _model_values(after)["metricAverages"] == {"q": 0.5}
    assert after["kpis"]["items"] == 2
    _assert_same(after, _python(pg))


def test_one_overview_per_revision_is_shared_by_every_process(pg, emitter):  # noqa: F811
    run = emitter("store-shared", 1, ["q"])
    run.post(run.started(2) + run.passed("a", 0, 1, {"q": 1.0}))
    drain(pg)
    builder = dashboard_overview.build_overview_postgres
    with patch.object(dashboard_overview, "build_overview_postgres", wraps=builder) as build:
        first = _served(pg)
        assert build.call_count == 1 and build.call_args.kwargs["include_global"] is True
        # The whole-project part and the filtered overview, for this revision.
        stored = _snapshots(pg)
        assert len(stored) == 2
        assert {revision for _, revision in stored} == {first["catalog_revision"]}

        # Another process (or pod) reads the stored overview: nothing is built.
        assert _served(pg) == first
        assert build.call_count == 1

        # A new filter builds only its filtered part; the project part is reused.
        _assert_same(_served(pg, {"statuses": ["RUNNING"]}), _python(pg, {"statuses": ["RUNNING"]}))
        assert build.call_count == 2 and build.call_args.kwargs["include_global"] is False

        # A publication moves the catalog revision: the next read builds again.
        run.post(run.passed("b", 1, 1, {"q": 0.0}))
        drain(pg)
        current = _served(pg)
        assert build.call_count == 3 and build.call_args.kwargs["include_global"] is True
        assert current["catalog_revision"] != first["catalog_revision"]
        _assert_same(current, _python(pg))

    # Entries of a replaced revision go once they are past the grace period.
    with Session(pg) as db:
        db.execute(
            update(Snapshot)
            .where(Snapshot.catalog_revision == first["catalog_revision"])
            .values(created_at=datetime.utcnow() - timedelta(minutes=10))
        )
        db.commit()
    _served(pg, {"statuses": ["COMPLETED"]})
    assert {revision for _, revision in _snapshots(pg)} == {current["catalog_revision"]}


def test_a_request_never_waits_for_a_second_connection(pg, emitter):  # noqa: F811
    """The shared store is read on the request's own snapshot connection and
    written after that connection is released: with one pooled connection the
    request neither waits for the pool nor loses the write."""
    run = emitter("store-pool", 1, ["q"])
    run.post(run.started(1) + run.passed("a", 0, 1, {"q": 1.0}))
    drain(pg)
    with pg.connect() as connection:
        schema = connection.execute(text("SELECT current_schema()")).scalar()
    single = create_engine(
        pg.url.render_as_string(hide_password=False),
        pool_size=1,
        max_overflow=0,
        pool_timeout=3,
        connect_args={"options": f"-csearch_path={schema}"},
    )
    try:
        started = time.perf_counter()
        served = _served(single)
        elapsed = time.perf_counter() - started
        assert elapsed < 3, elapsed
        assert len(_snapshots(pg)) == 2
        # ... and the next request reads it on its one connection.
        assert _served(single) == served
    finally:
        single.dispose()


def test_a_failed_store_never_fails_the_publication(pg, emitter, monkeypatch):  # noqa: F811
    def failing(db, run_id):
        db.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(dashboard_overview, "_store_one_run", failing)
    run = emitter("store-failing", 1, ["q"])
    run_id = rid("store-failing")
    run.post(run.started(1) + run.passed("a", 0, 1, {"q": 0.25}))
    run.post(run.completed(1, 0))
    drain(pg)
    # Published, with no stored row: the overview reads the run's JSON.
    assert _published_revision(pg, run_id) > 0
    assert _stored_row(pg, run_id) is None
    served = _served(pg)
    assert _model_values(served)["metricAverages"] == {"q": 0.25}
    _assert_same(served, _python(pg))


def test_a_stored_row_never_moves_back_to_an_older_revision(pg):  # noqa: F811
    """The worker may store a newer publication while the backfill still
    holds an older one: the older write must not win."""
    _seed_projection(pg, count=6)
    with Session(pg) as db:
        store_overview_facts(db, Dimension.project_key == "p")
        key = db.scalars(select(Facts.run_key).order_by(Facts.run_key)).first()
        db.execute(update(Facts).where(Facts.run_key == key).values(revision=Facts.revision + 5))
        newer = db.get(Facts, key).revision
        store_overview_facts(db, Dimension.project_key == "p")
        db.commit()
    assert _stored_row(pg, key)["revision"] == newer


def _run_jobs(engine):
    worker = maintenance.MaintenanceWorker(sessionmaker(bind=engine), engine, retention_interval=0)
    status = None
    for _ in range(20):
        status = worker.tick()
        if status in ("succeeded", "failed", None):
            break
    return status


def test_the_backfill_job_stores_missing_and_stale_rows_in_windows(pg):  # noqa: F811
    _seed_projection(pg, count=30)
    with Session(pg) as db:
        keys = sorted(db.scalars(select(Dimension.run_key)))
        # Five rows stored already, two of them stale since.
        store_overview_facts(db, Dimension.run_key.in_(keys[:5]))
        db.execute(
            update(Summary)
            .where(Summary.run_key.in_(keys[:2]))
            .values(projection_revision=Summary.projection_revision + 1)
        )
        maintenance.enqueue(db, "backfill_dashboard_overview", {"window": 7})
        db.commit()
    inserts = []

    def count(conn, cursor, statement, *rest):
        if statement.lstrip().upper().startswith("INSERT INTO DASHBOARD_RUN_OVERVIEW"):
            inserts.append(statement)

    event.listen(pg, "before_cursor_execute", count)
    try:
        assert _run_jobs(pg) == "succeeded"
    finally:
        event.remove(pg, "before_cursor_execute", count)
    # 27 runs to store in windows of 7: four statements.
    assert len(inserts) == 4
    with Session(pg) as db:
        job = db.scalars(select(MaintenanceJob).where(MaintenanceJob.kind == "backfill_dashboard_overview")).one()
        assert job.progress["runs_stored"] == 27
        assert "done: 27 runs stored" in job.log
        fresh = db.scalar(
            select(func.count())
            .select_from(Facts)
            .join(Summary, Summary.run_key == Facts.run_key)
            .where(Facts.revision == Summary.projection_revision)
        )
    assert fresh == len(keys)
    for key in keys:
        assert _stored_row(pg, key) == _read_from_json(pg, key), key


def test_the_backfill_job_finishes_at_once_on_sqlite(database):  # noqa: F811
    if database.dialect.name != "sqlite":
        pytest.skip("SQLite builds the overview in Python")
    _seed_projection(database, count=3)
    with Session(database) as db:
        maintenance.enqueue(db, "backfill_dashboard_overview", {})
        db.commit()
    assert _run_jobs(database) == "succeeded"
    with Session(database) as db:
        job = db.scalars(select(MaintenanceJob)).one()
        assert "skipped: not PostgreSQL" in job.log
        assert db.scalar(select(func.count()).select_from(Facts)) == 0


def _cascade_run_children(engine, run_id):
    """The migrated schema deletes a run's source rows with it (ON DELETE
    CASCADE); the test schema built from the models does not."""
    from qym_platform.db.base import Base

    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            for key in table.foreign_keys:
                if key.column.table.name == "runs" and table.name != "runs":
                    connection.execute(table.delete().where(key.parent == run_id))


def test_purge_removes_the_runs_inputs_and_the_projects_stored_overviews(database, emitter):  # noqa: F811
    for name in ("purge-keep", "purge-gone"):
        run = emitter(name, 1, ["q"])
        run.post(run.started(1) + run.passed("a", 0, 1, {"q": 1.0 if name == "purge-keep" else 0.0}))
        run.post(run.completed(1, 0))
    drain(database)
    gone = rid("purge-gone")
    with Session(database) as db:
        db.get(Run, gone).deleted_at = datetime.utcnow() - timedelta(days=40)
        db.commit()
    drain(database)
    postgres = database.dialect.name == "postgresql"
    if postgres:
        assert _stored_row(database, gone) is not None
        _served(database)
    else:
        # SQLite never stores overviews; a stray row must still go.
        with Session(database) as db:
            db.add(Snapshot(cache_key="k", project_key="p", catalog_revision="r", payload="{}"))
            db.commit()
    assert _snapshots(database)

    _cascade_run_children(database, gone)
    assert retention.purge_soft_deleted_runs(database, grace_days=30) == [gone]

    assert _snapshots(database) == []
    if postgres:
        assert _stored_row(database, gone) is None
        assert _stored_row(database, rid("purge-keep")) is not None
        served = _served(database)
        assert served["aggregations"]["totalRuns"] == 1
        _assert_same(served, _python(database))


def test_deleting_a_project_removes_its_stored_overviews(database):  # noqa: F811
    from qym_platform.api.projects import _delete_project_rows

    with Session(database) as db:
        db.add(Project(id="q", name="Q", slug="q", created_by_user_id="u"))
        for project in ("p", "q"):
            db.add(Snapshot(cache_key=project, project_key=project, catalog_revision="r", payload="{}"))
        db.commit()
        _delete_project_rows(db, "q")
        db.commit()
    assert _snapshots(database, "q") == []
    assert len(_snapshots(database, "p")) == 1


def test_sqlite_builds_the_overview_in_python_and_stores_nothing(database, emitter, monkeypatch):  # noqa: F811
    if database.dialect.name != "sqlite":
        pytest.skip("the SQLite fallback")

    def refused(*args, **kwargs):
        raise AssertionError("PostgreSQL only")

    monkeypatch.setattr(dashboard_overview, "build_overview_postgres", refused)
    monkeypatch.setattr(dashboard_overview, "shared_overview", refused)
    run = emitter("sqlite-run", 1, ["q"])
    run.post(run.started(1) + run.passed("a", 0, 1, {"q": 0.5}))
    drain(database)
    with Session(database) as db:
        assert db.scalar(select(func.count()).select_from(Facts)) == 0
    served = _served(database)
    assert _model_values(served)["metricAverages"] == {"q": 0.5}
    assert _snapshots(database) == []
