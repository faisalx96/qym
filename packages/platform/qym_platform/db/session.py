from __future__ import annotations

import importlib.util
import re
import threading
from typing import Callable, Dict, List, Optional

from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

logger = get_logger(__name__)

# Sync driver -> async driver, in the order ``db_async_driver=auto`` tries them.
ASYNC_DRIVERS: Dict[str, List[str]] = {
    "postgresql": ["asyncpg", "psycopg"],
    "sqlite": ["aiosqlite"],
}


def _server_options(settings: PlatformSettings, role: str) -> List[str]:
    """``-c name=value`` libpq options shared by the sync and async engines."""
    statement_timeout = (
        settings.db_worker_statement_timeout_ms
        if role == "worker"
        else settings.db_statement_timeout_ms
    )
    return [
        f"-c statement_timeout={int(statement_timeout)}",
        f"-c lock_timeout={int(settings.db_lock_timeout_ms)}",
        f"-c idle_in_transaction_session_timeout={int(settings.db_idle_in_transaction_timeout_ms)}",
        f"-c application_name=qym-{role}",
    ]


def _pool_kwargs(settings: PlatformSettings, role: str) -> dict:
    if role == "worker":
        pool_size, max_overflow = (
            settings.db_worker_pool_size,
            settings.db_worker_max_overflow,
        )
    else:
        pool_size, max_overflow = settings.db_pool_size, settings.db_max_overflow
    return dict(
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_recycle=settings.db_pool_recycle_seconds,
    )


def build_engine(
    settings: PlatformSettings | None = None, *, role: str = "api"
) -> Engine:
    """Engine with an explicit pool and server-side timeouts.

    ``role="api"`` sizes the pool for request handlers; ``role="worker"`` gives
    the background loops a small pool of their own so a busy backfill can never
    starve requests, and a longer statement timeout for batch work.
    """
    settings = settings or PlatformSettings()
    url = settings.database_url
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("postgresql"):
        # Preserve any libpq options already on the URL (e.g. -csearch_path=...);
        # connect_args would otherwise replace them.
        parsed = make_url(url)
        existing_options = parsed.query.get("options")
        if existing_options:
            url = parsed.difference_update_query(["options"]).render_as_string(
                hide_password=False
            )
        options = ([existing_options] if existing_options else []) + _server_options(
            settings, role
        )
        kwargs.update(
            _pool_kwargs(settings, role), connect_args={"options": " ".join(options)}
        )
    # future=True by default in SQLAlchemy 2.x
    engine = create_engine(url, **kwargs)
    # Never the URL: it carries the database password.
    logger.info(
        "database engine created (role=%s, backend=%s, pool_size=%s, max_overflow=%s)",
        role,
        engine.dialect.name,
        kwargs.get("pool_size", "-"),
        kwargs.get("max_overflow", "-"),
    )
    return engine


# --------------------------------------------------------------------------- async


def _installed(package: str) -> bool:
    return importlib.util.find_spec(package) is not None


def async_database_url(
    settings: PlatformSettings | None = None,
    *,
    installed: Callable[[str], bool] = _installed,
) -> Optional[str]:
    """The async form of ``database_url``, or ``None`` when there is none.

    ``QYM_DATABASE_ASYNC_URL`` wins outright. Otherwise ``QYM_DB_ASYNC_DRIVER``
    names the driver, or ``auto`` takes the first installed one for the
    backend (``asyncpg`` then ``psycopg`` for PostgreSQL, ``aiosqlite`` for a
    SQLite file). An in-memory SQLite database is never shared: a second
    engine would open a second, empty database.
    """
    settings = settings or PlatformSettings()
    if settings.database_async_url:
        return settings.database_async_url
    if settings.db_async_driver == "off":
        return None
    parsed = make_url(settings.database_url)
    backend = parsed.get_backend_name()
    if backend == "sqlite" and parsed.database in (None, "", ":memory:"):
        return None
    candidates = ASYNC_DRIVERS.get(backend, [])
    if settings.db_async_driver != "auto":
        candidates = (
            [settings.db_async_driver] if settings.db_async_driver in candidates else []
        )
    for driver in candidates:
        if installed(driver):
            return parsed.set(drivername=f"{backend}+{driver}").render_as_string(
                hide_password=False
            )
    return None


_OPTION = re.compile(r"-c\s*([A-Za-z_][A-Za-z0-9_.]*)=(\S+)")


def _asyncpg_server_settings(options: List[str]) -> Dict[str, str]:
    """``-c name=value`` tokens as asyncpg's ``server_settings`` mapping."""
    return {name: value for name, value in _OPTION.findall(" ".join(options))}


def build_async_engine(settings: PlatformSettings | None = None, *, role: str = "api"):
    """An ``AsyncEngine`` over ``async_database_url``, or ``None`` without one.

    Same pool sizes and server-side timeouts as :func:`build_engine` for the
    role. The application name says ``-async`` so ``pg_stat_activity`` tells
    the two pools apart.
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    settings = settings or PlatformSettings()
    url = async_database_url(settings)
    if url is None:
        return None
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("postgresql"):
        parsed = make_url(url)
        existing_options = parsed.query.get("options")
        if existing_options:
            url = parsed.difference_update_query(["options"]).render_as_string(
                hide_password=False
            )
        options = ([existing_options] if existing_options else []) + _server_options(
            settings, f"{role}-async"
        )
        if parsed.get_driver_name() == "asyncpg":
            # asyncpg has no libpq ``options``; the same settings go as
            # ``server_settings``.
            connect_args = {"server_settings": _asyncpg_server_settings(options)}
        else:
            connect_args = {"options": " ".join(options)}
        kwargs.update(_pool_kwargs(settings, role), connect_args=connect_args)
    engine = create_async_engine(url, **kwargs)
    logger.info(
        "async database engine created (role=%s, driver=%s, pool_size=%s, max_overflow=%s)",
        role,
        engine.dialect.driver,
        kwargs.get("pool_size", "-"),
        kwargs.get("max_overflow", "-"),
    )
    return engine


def request_threadpool_size(settings: PlatformSettings) -> int:
    """Threads for sync request handlers: the API pool's connection ceiling.

    Starlette runs sync handlers on AnyIO's default limiter (40 threads), more
    than the API pool's ``db_pool_size + db_max_overflow`` connections, so
    under load the surplus threads waited ``db_pool_timeout_seconds`` and
    failed. Capping the threads instead queues those requests, and never
    raises the number of Postgres connections a process can open.
    ``QYM_HTTP_THREADPOOL_SIZE`` overrides it.
    """
    if settings.http_threadpool_size > 0:
        return int(settings.http_threadpool_size)
    return max(1, int(settings.db_pool_size) + int(settings.db_max_overflow))


def _build_engine():
    return build_engine()


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class AppAsyncSession(AsyncSession):
    """The app's ``AsyncSession``: also names the sync engine of the same database."""

    @property
    def sync_bind(self) -> Engine:
        return engine


_async_lock = threading.Lock()
_async_factory = None
_async_resolved = False


def async_session_factory():
    """The process's ``async_sessionmaker`` for the API role, or ``None``.

    Built on first use (never at import: the driver may be absent, and a
    worker process has no use for it) and cached. ``reset_async_engine``
    drops it, for tests and after a settings change.
    """
    global _async_factory, _async_resolved
    if _async_resolved:
        return _async_factory
    with _async_lock:
        if not _async_resolved:
            factory = None
            try:
                async_engine = build_async_engine()
            except Exception:  # pragma: no cover - a misconfigured driver
                logger.exception(
                    "async database engine not available; async handlers use the thread pool"
                )
                async_engine = None
            if async_engine is not None:
                from sqlalchemy.ext.asyncio import async_sessionmaker

                factory = async_sessionmaker(
                    bind=async_engine,
                    class_=AppAsyncSession,
                    autoflush=False,
                    expire_on_commit=False,
                )
            _async_factory = factory
            _async_resolved = True
    return _async_factory


def reset_async_engine() -> None:
    """Forget the cached async engine (the next call builds it again)."""
    global _async_factory, _async_resolved
    with _async_lock:
        factory = _async_factory
        _async_factory = None
        _async_resolved = False
    if factory is not None:
        try:
            factory.kw["bind"].sync_engine.dispose()
        except Exception:  # pragma: no cover - best effort
            logger.debug("could not dispose the async engine", exc_info=True)
