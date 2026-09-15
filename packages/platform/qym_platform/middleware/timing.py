"""Per-request timing: wall time, DB time and statement count.

Enabled with ``QYM_REQUEST_TIMING=1``. Adds a ``Server-Timing`` header
(``app;dur=…, db;dur=…, db-count;dur=N``) readable in browser dev tools and by
``tools/perf/bench.py``, and logs one structured line per request. DB accounting
uses a ``contextvars`` counter fed by engine cursor hooks, so it is correct
under the threadpool that runs the sync routes.
"""

from __future__ import annotations

import contextvars
import logging
import time
from typing import Any, Dict, Optional

from sqlalchemy import event
from sqlalchemy.engine import Engine
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("qym.timing")

_db_stats: contextvars.ContextVar[Optional[Dict[str, float]]] = contextvars.ContextVar("qym_db_stats", default=None)
_installed_engines: set = set()


def install_engine_hooks(engine: Engine) -> None:
    """Attach cursor hooks once per engine; safe to call repeatedly."""
    if id(engine) in _installed_engines:
        return
    _installed_engines.add(id(engine))

    def before(conn, cursor, sql, params, context, executemany):
        stats = _db_stats.get()
        if stats is not None:
            conn.info.setdefault("_qym_timing_starts", []).append(time.perf_counter())

    def after(conn, cursor, sql, params, context, executemany):
        stats = _db_stats.get()
        if stats is None:
            return
        starts = conn.info.get("_qym_timing_starts") or []
        started = starts.pop() if starts else time.perf_counter()
        stats["count"] += 1
        stats["ms"] += (time.perf_counter() - started) * 1000.0

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)


class RequestTimingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, *, slow_ms: float = 1000.0) -> None:
        super().__init__(app)
        self.slow_ms = slow_ms

    async def dispatch(self, request: Request, call_next):
        stats: Dict[str, float] = {"count": 0, "ms": 0.0}
        token = _db_stats.set(stats)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            _db_stats.reset(token)
        wall_ms = (time.perf_counter() - started) * 1000.0
        response.headers["Server-Timing"] = f"app;dur={wall_ms:.1f}, db;dur={stats['ms']:.1f}, db-count;dur={int(stats['count'])}"
        level = logging.WARNING if wall_ms >= self.slow_ms else logging.INFO
        logger.log(
            level,
            "request method=%s path=%s status=%s wall_ms=%.1f db_ms=%.1f db_count=%d",
            request.method,
            request.url.path,
            response.status_code,
            wall_ms,
            stats["ms"],
            int(stats["count"]),
        )
        return response
