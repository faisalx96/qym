from __future__ import annotations

from typing import Any, AsyncGenerator, Callable, Generator, TypeVar, Union

from fastapi import Depends
from qym_platform.db import session as session_module
from qym_platform.db.session import AppAsyncSession, SessionLocal
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

T = TypeVar("T")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class SyncSessionBridge:
    """A sync ``Session`` behind the ``AsyncSession`` calls the async handlers use.

    ``run_sync(fn, *args)`` calls ``fn(session, *args)`` on the request thread
    pool, the way a sync handler runs; ``commit``, ``rollback`` and ``close``
    go there too. The handlers are written once against this surface and the
    real ``AsyncSession`` (whose ``run_sync`` runs ``fn`` against the async
    driver), so they work with and without an async driver, and under a test's
    ``get_db`` override.
    """

    def __init__(self, session: Session) -> None:
        self.sync = session

    async def run_sync(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        return await run_in_threadpool(fn, self.sync, *args, **kwargs)

    async def commit(self) -> None:
        await run_in_threadpool(self.sync.commit)

    async def rollback(self) -> None:
        await run_in_threadpool(self.sync.rollback)

    async def close(self) -> None:
        await run_in_threadpool(self.sync.close)

    @property
    def sync_bind(self) -> Engine:
        """The sync engine, for work that runs on its own thread later."""
        return self.sync.get_bind()


AsyncDb = Union[AppAsyncSession, SyncSessionBridge]


async def get_async_db(db: Session = Depends(get_db)) -> AsyncGenerator[AsyncDb, None]:
    """A database handle for ``async def`` handlers that never blocks the loop.

    With an async driver configured (``db/session.py``), and the request on
    the app's own engine, this is an ``AsyncSession`` on the async pool; the
    sync session the auth dependencies used is closed first, so the request
    holds one connection, not two. Otherwise (no driver installed,
    ``QYM_DB_ASYNC_DRIVER=off``, or a test that overrides ``get_db``) the
    request's sync session is wrapped so its work runs on the thread pool.
    """
    factory = session_module.async_session_factory()
    if factory is None or db.get_bind() is not session_module.engine:
        yield SyncSessionBridge(db)
        return
    db.close()
    async_db = factory()
    try:
        yield async_db
    finally:
        await async_db.close()
