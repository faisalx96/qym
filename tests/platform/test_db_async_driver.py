"""The async database engine, the async-session dependency, and the two batch-size settings.

- ``async_database_url`` derives the async URL from ``QYM_DATABASE_URL`` (or takes
  ``QYM_DATABASE_ASYNC_URL``), only for an installed driver and never for an
  in-memory SQLite database.
- ``get_async_db`` hands an ``AsyncSession`` to a request on the app's own engine
  and wraps the request's sync session otherwise (a test's ``get_db`` override),
  with the same ``run_sync`` / ``commit`` / ``rollback`` surface.
- ``run_blocking_coroutine`` runs a coroutine on another thread's own loop.
- ``QYM_INGEST_WRITE_BATCH_SIZE`` bounds the rows of one ``run_events`` INSERT.
- ``QYM_DASHBOARD_WORKER_*`` reach the summary worker in the app and the workers service.
"""

from __future__ import annotations

import asyncio
import json
import threading
from uuid import uuid4

import pytest
from qym_platform.db import session as session_module
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
    Run,
    RunOrigin,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.db.session import (
    AppAsyncSession,
    _asyncpg_server_settings,
    async_database_url,
    build_async_engine,
    reset_async_engine,
)
from qym_platform.deps import SyncSessionBridge, get_async_db
from qym_platform.services.loop_offload import run_blocking_coroutine
from qym_platform.settings import PlatformSettings
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

PG = "postgresql+psycopg2://qym:secret@db.example/qym?options=-csearch_path%3Dtenant"


def _settings(**values) -> PlatformSettings:
    return PlatformSettings(database_url=values.pop("database_url", PG), **values)


# --------------------------------------------------------------------------- URL


@pytest.mark.parametrize(
    "settings, installed, expected",
    [
        (
            dict(),
            lambda _: True,
            "postgresql+asyncpg://qym:secret@db.example/qym?options=-csearch_path%3Dtenant",
        ),
        (
            dict(),
            lambda package: package in ("psycopg", "greenlet"),
            "postgresql+psycopg://qym:secret@db.example/qym?options=-csearch_path%3Dtenant",
        ),
        (dict(), lambda _: False, None),
        # The driver alone is not enough: SQLAlchemy's asyncio extension runs on greenlet.
        (dict(), lambda package: package != "greenlet", None),
        (dict(db_async_driver="asyncpg"), lambda package: package != "greenlet", None),
        (dict(db_async_driver="off"), lambda _: True, None),
        (
            dict(db_async_driver="psycopg"),
            lambda _: True,
            "postgresql+psycopg://qym:secret@db.example/qym?options=-csearch_path%3Dtenant",
        ),
        (dict(db_async_driver="asyncpg"), lambda driver: driver == "psycopg", None),
        (dict(db_async_driver="aiosqlite"), lambda _: True, None),
        (
            dict(database_async_url="postgresql+asyncpg://other/db"),
            lambda _: False,
            "postgresql+asyncpg://other/db",
        ),
        (dict(database_url="sqlite://"), lambda _: True, None),
        (dict(database_url="sqlite:///:memory:"), lambda _: True, None),
        (
            dict(database_url="sqlite:////srv/qym/dev.db"),
            lambda _: True,
            "sqlite+aiosqlite:////srv/qym/dev.db",
        ),
    ],
)
def test_the_async_url_follows_the_sync_url_and_the_installed_driver(
    settings, installed, expected
):
    assert async_database_url(_settings(**settings), installed=installed) == expected


def test_the_async_url_rejects_an_unknown_driver_name():
    with pytest.raises(ValueError):
        _settings(db_async_driver="trio")


def test_asyncpg_takes_the_server_settings_instead_of_libpq_options():
    options = [
        "-csearch_path=tenant",
        "-c statement_timeout=30000",
        "-c application_name=qym-api-async",
    ]
    assert _asyncpg_server_settings(options) == {
        "search_path": "tenant",
        "statement_timeout": "30000",
        "application_name": "qym-api-async",
    }


def test_the_async_engine_keeps_the_backend_and_the_api_pool():
    pytest.importorskip("asyncpg")
    engine = build_async_engine(_settings(db_pool_size=4, db_max_overflow=1))
    try:
        assert engine.url.drivername == "postgresql+asyncpg"
        assert engine.sync_engine.pool.size() == 4
        assert engine.sync_engine.pool._max_overflow == 1
    finally:
        asyncio.run(engine.dispose())


def test_no_async_engine_without_a_driver():
    assert build_async_engine(_settings(db_async_driver="off")) is None


# --------------------------------------------------------------------------- session


@pytest.fixture
def file_database(tmp_path):
    """A SQLite file (an in-memory database cannot be shared with a second engine)."""
    url = f"sqlite:///{tmp_path / 'qym.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(id="u1", email="u1@example.com", role=UserRole.MEMBER))
        db.commit()
    try:
        yield url, engine
    finally:
        engine.dispose()


def test_an_async_session_runs_sync_orm_code_against_the_async_driver(file_database):
    pytest.importorskip("aiosqlite")
    url, _ = file_database
    engine = build_async_engine(_settings(database_url=url))
    assert engine is not None and engine.url.drivername == "sqlite+aiosqlite"

    async def read() -> list[str]:
        from sqlalchemy.ext.asyncio import async_sessionmaker

        async with async_sessionmaker(bind=engine)() as db:
            return await db.run_sync(
                lambda sync: [u.email for u in sync.query(User).all()]
            )

    try:
        assert asyncio.run(read()) == ["u1@example.com"]
    finally:
        asyncio.run(engine.dispose())


@pytest.fixture
def app_engine(file_database, monkeypatch):
    """The file database as the app's own engine, with the async engine rebuilt for it."""
    pytest.importorskip("aiosqlite")
    url, engine = file_database
    monkeypatch.setenv("QYM_DATABASE_URL", url)
    monkeypatch.setattr(session_module, "engine", engine)
    reset_async_engine()
    try:
        yield engine
    finally:
        reset_async_engine()


async def _dependency(db: Session):
    """Drive ``get_async_db`` the way FastAPI does: take the value, then finalize."""
    generator = get_async_db(db=db)
    handle = await generator.__anext__()
    try:
        return (
            handle,
            await handle.run_sync(lambda sync: sync.query(User).count()),
            handle.sync_bind,
        )
    finally:
        try:
            await generator.__anext__()
        except StopAsyncIteration:
            pass


def test_get_async_db_serves_an_async_session_on_the_app_engine(app_engine):
    assert session_module.async_session_factory() is not None
    sync_db = Session(bind=app_engine)
    handle, count, bind = asyncio.run(_dependency(sync_db))
    assert isinstance(handle, AppAsyncSession)
    assert count == 1
    assert bind is app_engine


def test_get_async_db_wraps_a_session_on_another_engine(app_engine):
    from sqlalchemy.pool import StaticPool

    # The bridge runs on the thread pool: the engine must allow that, as the test
    # helpers' in-memory engines do.
    other = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(other)
    sync_db = Session(bind=other)
    try:
        handle, count, bind = asyncio.run(_dependency(sync_db))
        assert isinstance(handle, SyncSessionBridge)
        assert (
            count == 0
        )  # the other, empty database: the override's session is what runs
        assert bind is other
    finally:
        sync_db.close()
        other.dispose()


def test_get_async_db_wraps_the_session_without_a_driver(file_database, monkeypatch):
    url, engine = file_database
    monkeypatch.setenv("QYM_DATABASE_URL", url)
    monkeypatch.setenv("QYM_DB_ASYNC_DRIVER", "off")
    monkeypatch.setattr(session_module, "engine", engine)
    reset_async_engine()
    try:
        assert session_module.async_session_factory() is None
        handle, count, _ = asyncio.run(_dependency(Session(bind=engine)))
        assert isinstance(handle, SyncSessionBridge)
        assert count == 1
    finally:
        reset_async_engine()


def test_the_bridge_commits_and_rolls_back_through_the_sync_session(file_database):
    _, engine = file_database
    sync_db = Session(bind=engine)
    bridge = SyncSessionBridge(sync_db)

    async def scenario() -> tuple[int, int]:
        await bridge.run_sync(
            lambda s: s.add(User(id="u2", email="u2@example.com", role=UserRole.MEMBER))
        )
        await bridge.rollback()
        after_rollback = await bridge.run_sync(lambda s: s.query(User).count())
        await bridge.run_sync(
            lambda s: s.add(User(id="u3", email="u3@example.com", role=UserRole.MEMBER))
        )
        await bridge.commit()
        after_commit = await bridge.run_sync(lambda s: s.query(User).count())
        await bridge.close()
        return after_rollback, after_commit

    assert asyncio.run(scenario()) == (1, 2)


# --------------------------------------------------------------------------- loop offload


def test_run_blocking_coroutine_uses_another_thread_and_loop():
    async def probe() -> tuple[int, int]:
        return threading.get_ident(), id(asyncio.get_running_loop())

    async def scenario():
        here = threading.get_ident(), id(asyncio.get_running_loop())
        there = await run_blocking_coroutine(probe)
        return here, there

    (thread, loop), (other_thread, other_loop) = asyncio.run(scenario())
    assert other_thread != thread
    assert other_loop != loop


def test_run_blocking_coroutine_propagates_the_exception():
    async def boom() -> None:
        raise LookupError("no such thing")

    async def scenario():
        await run_blocking_coroutine(boom)

    with pytest.raises(LookupError, match="no such thing"):
        asyncio.run(scenario())


# --------------------------------------------------------------------------- ingest batch size


@pytest.fixture
def ingest_run():
    from qym_platform.auth import Principal
    from sqlalchemy.pool import StaticPool

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = Session(engine, autoflush=False)
    owner = User(id="owner", email="owner@example.com", role=UserRole.MEMBER)
    db.add(owner)
    db.flush()
    project = Project(id="p1", name="P", slug="p", created_by_user_id=owner.id)
    db.add(project)
    db.flush()
    run = Run(
        id=str(uuid4()),
        project_id=project.id,
        owner_user_id=owner.id,
        created_by_user_id=owner.id,
        task="t",
        dataset="d",
        metrics=["score"],
        origin=RunOrigin.LOCAL,
        status=RunWorkflowStatus.RUNNING,
        run_metadata={},
        run_config={},
    )
    db.add(run)
    db.commit()
    principal = Principal(user=owner, auth_type="api_key", project_id=project.id)
    try:
        yield engine, db, run, principal
    finally:
        db.close()
        engine.dispose()


def _events(run, count):
    return [
        dict(
            schema_version=1,
            run_id=run.id,
            event_id=str(uuid4()),
            sequence=n,
            sent_at="2026-11-17T00:00:00Z",
            type="item_started",
            payload={"item_id": f"item-{n}", "index": n - 1, "input": {"q": n}},
        )
        for n in range(1, count + 1)
    ]


@pytest.mark.parametrize("batch_size, expected_inserts", [(50, 1), (None, 1)])
def test_ingest_writes_run_events_in_batches_of_the_configured_size(
    ingest_run, monkeypatch, batch_size, expected_inserts
):
    from qym_platform.api import ingest
    from qym_platform.services.event_storage import ingest_settings

    engine, db, run, principal = ingest_run
    if batch_size is not None:
        monkeypatch.setenv("QYM_INGEST_WRITE_BATCH_SIZE", str(batch_size))
    ingest_settings.cache_clear()
    try:
        assert ingest_settings().ingest_write_batch_size == (batch_size or 400)
        inserts: list[str] = []

        def record(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith("INSERT INTO RUN_EVENTS"):
                inserts.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            body = "\n".join(json.dumps(e) for e in _events(run, 120)).encode()
            reply = json.loads(
                ingest._ingest_events_sync(run.id, body, db, principal).body
            )
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert reply["applied"] == 120
        # 120 events: one statement of 120 rows at the default, three of 50/50/20 at 50.
        assert len(inserts) == (3 if batch_size == 50 else expected_inserts)
    finally:
        ingest_settings.cache_clear()


def test_the_batch_size_has_a_floor_and_a_ceiling():
    with pytest.raises(ValueError):
        _settings(ingest_write_batch_size=10)
    with pytest.raises(ValueError):
        _settings(ingest_write_batch_size=100_000)


# --------------------------------------------------------------------------- dashboard worker


def test_worker_options_read_every_dashboard_worker_setting():
    from qym_platform.services.dashboard_summaries import worker_options

    settings = _settings(
        database_url="sqlite:///:memory:",
        dashboard_worker_interval_seconds=0.5,
        dashboard_worker_max_partitions=7,
        dashboard_worker_max_events=90,
        dashboard_worker_backfill_chunk=30,
        dashboard_live_refresh_seconds=4,
        dashboard_event_prune_interval_seconds=120,
    )
    assert worker_options(settings) == dict(
        interval=0.5,
        max_partitions=7,
        max_events=90,
        backfill_chunk=30,
        live_refresh_interval=4,
        event_prune_interval=120,
    )


def test_the_app_builds_its_summary_worker_from_the_settings():
    from qym_platform.app import create_app

    app = create_app(
        _settings(
            database_url="sqlite:///:memory:",
            dashboard_worker_interval_seconds=0.5,
            dashboard_worker_max_partitions=7,
            dashboard_worker_max_events=90,
            dashboard_worker_backfill_chunk=30,
            dashboard_event_prune_interval_seconds=120,
        )
    )
    worker = app.state.dashboard_summary_worker
    assert (
        worker.interval,
        worker.max_partitions,
        worker.max_events,
        worker.backfill_chunk,
    ) == (0.5, 7, 90, 30)
    assert worker.event_prune_interval == 120


def test_the_backfill_chunk_never_exceeds_max_events():
    from qym_platform.services.dashboard_summaries import DashboardSummaryWorker

    worker = DashboardSummaryWorker(sessionmaker(), max_events=10, backfill_chunk=50)
    assert worker.backfill_chunk == 10
