"""C060: the trigram indexes behind the Runs and dataset search boxes.

``build_runs_search_index`` (queued by migration 0070) and
``backfill_dataset_search_text`` (0068) build their pg_trgm indexes
CONCURRENTLY. Where the server cannot create pg_trgm (the package is not
installed, or the role may not create extensions), both jobs log that the
index was skipped and finish, and the searches keep working without it.

The missing-extension tests make the server refuse the extension for real:
the job's ``CREATE EXTENSION pg_trgm`` reaches PostgreSQL as a request for an
extension that is not installed, so the job sees the same error a server
without the pg_trgm package raises.

Skipped unless QYM_TEST_POSTGRES_URL points at a database these tests may
create schemas in.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, select, text, update
from sqlalchemy.orm import sessionmaker

from qym_platform.api import dashboard
from qym_platform.db.base import Base
from qym_platform.db.dashboard_models import DashboardRunDimension as Dimension
from qym_platform.db.maintenance_models import MaintenanceJob
from qym_platform.db.models import Dataset, DatasetItem, DatasetVersion, Project, User
from qym_platform.services import maintenance

MISSING_EXTENSION = "qym_test_extension_that_is_not_installed"


@pytest.fixture()
def pg_engine():
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_search_index_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    # public stays on the path for extensions (pg_trgm's operator classes).
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema},public"})
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine)
    with make() as db:
        db.add(User(id="u", email="u@x.com"))
        db.flush()
        db.add(Project(id="p", name="P", slug="p", created_by_user_id="u"))
        db.commit()
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@contextmanager
def without_pg_trgm(engine):
    """The server refuses pg_trgm, as one without the package does."""

    def refuse(conn, cursor, statement, parameters, context, executemany):
        if "CREATE EXTENSION" in statement.upper() and "PG_TRGM" in statement.upper():
            statement = f"CREATE EXTENSION IF NOT EXISTS {MISSING_EXTENSION}"
        return statement, parameters

    event.listen(engine, "before_cursor_execute", refuse, retval=True)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", refuse)


def _run(engine, kind, params=None):
    make = sessionmaker(bind=engine)
    with make() as db:
        maintenance.enqueue(db, kind, params or {})
        db.commit()
    worker = maintenance.MaintenanceWorker(make, engine, retention_interval=0)
    status = None
    for _ in range(20):
        status = worker.tick()
        if status in ("succeeded", "failed", None):
            break
    with make() as db:
        job = db.scalars(select(MaintenanceJob).where(MaintenanceJob.kind == kind)).one()
        return status, job.log, job.progress


def _indexes(engine, table):
    with engine.connect() as conn:
        return {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename = :t AND schemaname = current_schema()"
                ),
                {"t": table},
            )
        }


def _seed_runs(engine):
    """Runs named as the list shows them (external id) and by run name."""
    start = datetime(2026, 9, 1)
    names = [
        ("baseline-qwen3.5-0818", "Baseline Qwen"),
        ("candidate-gpt-0901", "Candidate GPT"),
        ("", "Nightly 100% pass"),
    ] + [(f"bulk-{index:03}", f"Bulk {index}") for index in range(40)]
    make = sessionmaker(bind=engine)
    with make() as db:
        for index, (external, name) in enumerate(names):
            key = f"{index:04}-{uuid4().hex[:8]}"
            stamp = start + timedelta(hours=index)
            db.add(
                Dimension(
                    run_key=key, project_key="p", task="t", model="m|||plain", dataset="d",
                    version="", owner="u", status="COMPLETED", timestamp=stamp,
                    created_at=stamp, present=True,
                    descriptor={"run_id": key, "external_run_id": external, "run_name": name},
                )
            )
        db.commit()


def _search(engine, needle):
    """The Runs list's search predicate (``q``), as the API applies it."""
    make = sessionmaker(bind=engine)
    with make() as db:
        filters = dashboard._parse_filters(json.dumps({"q": needle}))
        return sorted(
            db.scalars(
                select(Dimension.descriptor["run_name"].as_string()).where(
                    Dimension.project_key == "p", *dashboard._filter_conditions(filters)
                )
            )
        )


# Substrings of either name, any case; LIKE characters match literally.
# Searches shorter than three characters (no trigram) match the same way.
MATCHES = {
    "gp": ["Candidate GPT"],
    "0%": ["Nightly 100% pass"],
    "qwen3.5": ["Baseline Qwen"],
    "CANDIDATE": ["Candidate GPT"],
    "100%": ["Nightly 100% pass"],
    "bulk-03": sorted(f"Bulk {index}" for index in range(30, 40)),
}


def test_runs_search_index_job_builds_the_index_the_search_uses(pg_engine):
    _seed_runs(pg_engine)
    status, log, progress = _run(pg_engine, "build_runs_search_index")
    assert status == "succeeded", log
    assert progress["message"] == f"done: {dashboard.RUNS_SEARCH_INDEX} built"
    assert dashboard.RUNS_SEARCH_INDEX in _indexes(pg_engine, "dashboard_run_dimensions")
    with pg_engine.connect() as conn:
        assert conn.execute(
            text("SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"),
            {"name": dashboard.RUNS_SEARCH_INDEX},
        ).scalar()
        # The planner can serve the search box's predicate from the index:
        # its expression is compiled from the one the list filters on.
        conn.execute(text("SET enable_seqscan = off"))
        query = select(Dimension.run_key).where(
            dashboard._search_condition("candidate")
        ).compile(dialect=conn.dialect)
        plan = "\n".join(
            row[0] for row in conn.exec_driver_sql("EXPLAIN " + str(query), query.params)
        )
    assert dashboard.RUNS_SEARCH_INDEX in plan, plan
    for needle, expected in MATCHES.items():
        assert _search(pg_engine, needle) == expected, needle


def test_runs_search_index_job_without_pg_trgm_finishes_and_search_still_works(pg_engine):
    _seed_runs(pg_engine)
    with without_pg_trgm(pg_engine):
        status, log, progress = _run(pg_engine, "build_runs_search_index")
    assert status == "succeeded", log
    assert "runs search index skipped: pg_trgm is not available" in log
    assert progress["message"] == "done: index skipped (pg_trgm is not available)"
    assert dashboard.RUNS_SEARCH_INDEX not in _indexes(pg_engine, "dashboard_run_dimensions")
    for needle, expected in MATCHES.items():
        assert _search(pg_engine, needle) == expected, needle


def test_dataset_search_job_without_pg_trgm_finishes_and_search_still_works(pg_engine):
    from qym_platform.services.dataset_search import filter_dataset_item_search

    make = sessionmaker(bind=pg_engine)
    with make() as db:
        db.add(Dataset(id="d", project_id="p", name="D", slug="d", created_by_user_id="u"))
        db.flush()
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.flush()
        for index, value in enumerate(["refund policy", "shipping times", "سياسة الاسترداد"]):
            db.add(DatasetItem(dataset_version_id="v1", item_id=f"i{index}", index=index, input=value, fingerprint=str(index)))
        db.commit()
        db.execute(update(DatasetItem).values(search_text=None))
        db.commit()
    with without_pg_trgm(pg_engine):
        status, log, _ = _run(pg_engine, "backfill_dataset_search_text")
    assert status == "succeeded", log
    assert "search index skipped: pg_trgm is not available" in log
    indexes = _indexes(pg_engine, "dataset_items")
    assert "ix_dataset_items_search_trgm" not in indexes
    # The rest of the job ran: every row has its search text, and the probe index exists.
    assert "ix_dataset_items_unindexed_version" in indexes
    with make() as db:
        assert db.query(DatasetItem).filter(DatasetItem.search_text.is_(None)).count() == 0
        query = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == "v1")
        for needle, expected in (("refund", {"i0"}), ("TIMES", {"i1"}), ("الاسترداد", {"i2"})):
            found = {item.item_id for item in filter_dataset_item_search(db, query, needle, version_id="v1")}
            assert found == expected, needle
