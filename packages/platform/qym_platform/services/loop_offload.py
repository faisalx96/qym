"""Run a coroutine that also makes synchronous database calls off the request loop.

Some request paths are coroutines that await a model call and, between the
awaits, query and write through a synchronous ``Session`` (the analysis
aggregation and the rule writer; the same code runs inside analysis jobs on
their own thread). Awaited directly from a request handler, every one of
those synchronous calls stalls the event loop for every other request.

``run_blocking_coroutine`` runs such a coroutine on a worker thread with a
private event loop (what ``services/analysis_jobs.py`` does for a job), so
the request loop only waits on a future. The thread pool is separate from
the request thread pool: a model call lasting minutes must not take one of
the few threads that serve sync handlers.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")

# One model call at a time per thread; a request waits for a free thread
# instead of starting an unbounded number of model calls.
MAX_WORKERS = 8
_executor: ThreadPoolExecutor | None = None


def _pool() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(
            max_workers=MAX_WORKERS, thread_name_prefix="qym-offload"
        )
    return _executor


def _run(factory: Callable[[], Awaitable[T]]) -> T:
    # ``asyncio.run`` gives the thread its own loop and closes it afterwards,
    # with every transport the coroutine opened.
    return asyncio.run(_await(factory))


async def _await(factory: Callable[[], Awaitable[T]]) -> T:
    return await factory()


async def run_blocking_coroutine(factory: Callable[[], Awaitable[T]]) -> T:
    """Await ``factory()`` on a worker thread's own event loop.

    ``factory`` is called on that thread, so anything bound to an event loop
    (an ``AsyncOpenAI`` client, an ``httpx.AsyncClient``) is created inside it
    and not shared with the request loop. Exceptions propagate unchanged.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_pool(), _run, factory)


__all__ = ["MAX_WORKERS", "run_blocking_coroutine"]
