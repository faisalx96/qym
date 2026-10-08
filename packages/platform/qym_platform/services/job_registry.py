"""Cross-process view of in-process background jobs.

Analyses, rule inference and product evals run on threads of the API process
that accepted them. With several web worker processes (``QYM_WEB_WORKERS``)
the browser's next poll, the "active job" lookup of a newly opened page, a
cancel click or a project archive can reach any process. Each running job
therefore publishes its snapshot to ``background_jobs``:

* the owning process inserts the row on submit, flushes changes within
  ``FLUSH_SECONDS`` and terminal states at once, and heartbeats every
  ``HEARTBEAT_SECONDS`` while the job runs;
* any process reads the row for status and active-job lookups;
* any process can request cancellation by flagging the row; the owner's next
  flush sees the flag and cancels the job locally;
* a row whose heartbeat is older than ``STALE_AFTER_SECONDS`` belongs to a
  process that stopped (restart, crash, deploy), so readers report it as lost.

In split mode (``QYM_SERVICE=main``, services/job_executor.py) the table is
also the job queue: the HTTP process inserts a ``queued`` row carrying the
job's ``payload`` and a workers process claims it (``claim``: ``SELECT ...
FOR UPDATE SKIP LOCKED`` on PostgreSQL, a compare-and-set update elsewhere),
then owns and heartbeats it like a local job. A queued row has no owner, so it
is never reported lost; it expires (reads as failed) when no worker claims it
within ``QYM_JOB_QUEUE_TIMEOUT_SECONDS``.

Otherwise the table is only an exchange point: the job stays in its process. An
in-memory SQLite database cannot be shared between processes or even between
pooled connections safely, so the registry is off there (tests, embedded use).
"""

from __future__ import annotations

import os
import socket
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional
from uuid import uuid4

from sqlalchemy import DateTime, delete, func, insert, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.background_job_models import BackgroundJob
from qym_platform.log import get_logger

logger = get_logger(__name__)

FLUSH_SECONDS = 0.5
HEARTBEAT_SECONDS = 2.0
STALE_AFTER_SECONDS = 15.0
RETAIN_FINISHED = timedelta(days=7)
PRUNE_EVERY_SECONDS = 600.0

_TABLE = BackgroundJob.__table__
_ANY = object()
LOST_ERROR = "The server process running this job stopped before it finished."
EXPIRED_ERROR = (
    "No workers service picked up this job in time. Check that the workers "
    "service is running, then start it again."
)
DEFAULT_QUEUE_TIMEOUT_SECONDS = 1800.0
_queue_timeout: Optional[float] = None


def queue_timeout_seconds() -> float:
    """``QYM_JOB_QUEUE_TIMEOUT_SECONDS`` (read once per process)."""
    global _queue_timeout
    if _queue_timeout is None:
        try:
            from qym_platform.settings import PlatformSettings

            _queue_timeout = float(PlatformSettings().job_queue_timeout_seconds)
        except Exception:  # settings unavailable (no database URL): the default
            _queue_timeout = DEFAULT_QUEUE_TIMEOUT_SECONDS
    return _queue_timeout


class ActiveJobExists(Exception):
    """Another process already runs the job for this scope (``row``)."""

    def __init__(self, row: Dict[str, Any]) -> None:
        super().__init__(row.get("id"))
        self.row = row

_process_lock = threading.Lock()
_process_identity: Optional[tuple] = None


def process_id() -> str:
    """``host:pid:boot`` of this process (recomputed after a fork)."""
    global _process_identity
    pid = os.getpid()
    with _process_lock:
        if _process_identity is None or _process_identity[0] != pid:
            host = socket.gethostname()[:100]
            _process_identity = (pid, f"{host}:{pid}:{uuid4().hex[:12]}")
        return _process_identity[1]


def shared_engine(bind: Any) -> Optional[Engine]:
    """The engine to publish through, or None when it cannot be shared."""
    if bind is None:
        return None
    engine = getattr(bind, "engine", bind)
    url = getattr(engine, "url", None)
    if url is None:
        return None
    if url.get_backend_name() == "sqlite":
        database = url.database or ""
        if database in ("", ":memory:") or "mode=memory" in str(url):
            return None
    return engine


def _engine_of_session(db: Any) -> Optional[Engine]:
    if db is None:
        return None
    try:
        return shared_engine(db.get_bind())
    except Exception:  # pragma: no cover - unbound session
        return None


@contextmanager
def _read_connection(db: Any, engine: Engine) -> Iterator[Any]:
    """The request session's own connection, else a pooled one.

    A request already holds a pooled connection through its session; opening
    a second one per poll would let a burst of polls wait on each other until
    the pool timeout once every connection is held.
    """
    if isinstance(db, OrmSession):
        yield db.connection()
        return
    with engine.connect() as conn:
        yield conn


@dataclass
class JobDescription:
    """What the owning manager reports about one job."""

    scope_id: Optional[str]
    status: str
    active: bool
    snapshot: Dict[str, Any]
    project_id: Optional[str] = None
    pass_number: Optional[int] = None
    owner_user_id: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


@dataclass
class _Handle:
    engine: Engine
    kind: str
    job_id: str
    describe: Callable[[], JobDescription]
    on_cancel: Callable[[], None]
    dirty: bool = False
    closed: bool = False
    last_published: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


def _uses_db_clock(conn: Any) -> bool:
    return getattr(getattr(conn, "dialect", None), "name", "") == "postgresql"


def _heartbeat_now(conn: Any) -> Any:
    """The value written to ``heartbeat_at``: the database's UTC clock.

    Owner and reader may run on different nodes; taking both the heartbeat and
    the staleness check from the one database clock keeps a skew between the
    nodes' clocks from making a live job look lost. SQLite (one host) keeps the
    process clock.
    """
    if _uses_db_clock(conn):
        return func.timezone("utc", func.now(), type_=DateTime)
    return utc_now_naive()


def _job_select(conn: Any) -> Any:
    """``select(background_jobs)`` plus the database clock for ``_row_dict``."""
    stmt = select(_TABLE)
    if _uses_db_clock(conn):
        stmt = stmt.add_columns(
            func.timezone("utc", func.now(), type_=DateTime).label("_db_now")
        )
    return stmt


def _row_dict(row: Any) -> Dict[str, Any]:
    data = dict(row._mapping)
    now = data.pop("_db_now", None) or utc_now_naive()
    heartbeat = data.get("heartbeat_at")
    queued = bool(data.get("queued"))
    # A queued row has no owner yet: its heartbeat is the enqueue time, not a
    # lease, so it only expires after the (much longer) queue timeout.
    limit = queue_timeout_seconds() if queued else STALE_AFTER_SECONDS
    data["queued"] = queued
    data["lost"] = bool(
        data.get("active")
        and heartbeat is not None
        and heartbeat < now - timedelta(seconds=limit)
    )
    data["lost_reason"] = (EXPIRED_ERROR if queued else LOST_ERROR) if data["lost"] else None
    data["snapshot"] = dict(data.get("snapshot") or {})
    # Never hand the payload (it may hold encrypted secrets) to readers.
    data.pop("payload", None)
    return data


class JobRegistry:
    """Publishes this process's jobs and reads everyone's."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._handles: Dict[str, _Handle] = {}
        self._thread: Optional[threading.Thread] = None
        self._wake = threading.Event()
        self._last_prune: Dict[str, float] = {}

    # -- owner side ---------------------------------------------------------

    def track(
        self,
        bind: Any,
        *,
        kind: str,
        job_id: str,
        describe: Callable[[], JobDescription],
        on_cancel: Callable[[], None],
        exclusive: bool = False,
    ) -> bool:
        """Publish a new local job; False when the database is not shareable.

        ``exclusive`` claims the job's scope (kind, scope, pass) before the job
        starts and raises :class:`ActiveJobExists` when another process holds
        it; a holder whose process stopped is marked failed and replaced.
        """
        engine = shared_engine(bind)
        if engine is None:
            return False
        handle = _Handle(engine, kind, job_id, describe, on_cancel)
        if exclusive:
            try:
                self._claim(handle)
            except ActiveJobExists:
                raise
            except Exception:
                logger.exception("Could not publish background job %s", job_id)
                return False
        # Registered before the first write: a change made meanwhile (a job
        # that finishes at once) waits for the insert and is then published.
        with self._lock:
            self._handles[job_id] = handle
        try:
            self._publish(handle)
        except Exception:
            logger.exception("Could not publish background job %s", job_id)
            self._forget(handle)
            return False
        if handle.closed:
            return True
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(
                    target=self._loop, name="qym-job-registry", daemon=True
                )
                self._thread.start()
        self._maybe_prune(engine)
        return True

    def _claim(self, handle: _Handle, *, payload: Optional[Dict[str, Any]] = None) -> None:
        for _ in range(3):
            try:
                with handle.engine.begin() as conn:
                    self._insert(conn, handle, handle.describe(), payload=payload)
                return
            except IntegrityError:
                pass
            desc = handle.describe()
            with handle.engine.begin() as conn:
                row = conn.execute(
                    _job_select(conn).where(
                        _TABLE.c.kind == handle.kind,
                        _TABLE.c.scope_id == desc.scope_id,
                        _TABLE.c.pass_key == int(desc.pass_number or 0),
                        _TABLE.c.active.is_(True),
                    )
                ).first()
                if row is None:
                    continue  # the holder finished meanwhile
                holder = _row_dict(row)
                if not holder["lost"]:
                    raise ActiveJobExists(holder)
                now = utc_now_naive()
                # cancel_requested: a holder that was only stalled (slow
                # database, exhausted pool) stops its job at its next flush
                # instead of running a duplicate next to the new one.
                conn.execute(
                    update(_TABLE)
                    .where(_TABLE.c.id == holder["id"], _TABLE.c.active.is_(True))
                    .values(active=False, status="failed",
                            error=holder.get("lost_reason") or LOST_ERROR,
                            cancel_requested=True, queued=False, payload=None,
                            updated_at=now, completed_at=now)
                )
        raise RuntimeError(f"could not claim background job {handle.job_id}")

    def _insert(
        self,
        conn: Any,
        handle: _Handle,
        desc: JobDescription,
        *,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        now = utc_now_naive()
        queued = payload is not None
        conn.execute(
            insert(_TABLE).values(
                id=handle.job_id,
                kind=handle.kind,
                scope_id=desc.scope_id,
                project_id=desc.project_id,
                pass_number=desc.pass_number,
                pass_key=int(desc.pass_number or 0),
                owner_user_id=desc.owner_user_id,
                cancel_requested=False,
                created_at=desc.created_at or now,
                status=desc.status[:32],
                active=bool(desc.active),
                snapshot=desc.snapshot,
                error=desc.error,
                process_id=process_id(),
                heartbeat_at=_heartbeat_now(conn),
                updated_at=desc.updated_at or now,
                completed_at=desc.completed_at,
                queued=queued,
                payload=payload,
            )
        )
        handle.last_published = time.monotonic()

    def enqueue(
        self,
        bind: Any,
        *,
        kind: str,
        job_id: str,
        description: JobDescription,
        payload: Dict[str, Any],
        exclusive: bool = False,
    ) -> Dict[str, Any]:
        """Queue a job for a workers process; returns its row.

        ``exclusive`` raises :class:`ActiveJobExists` when the scope already
        has an unfinished job (queued or running), like :meth:`track`.
        Raises ``RuntimeError`` when the database cannot be shared.
        """
        engine = shared_engine(bind)
        if engine is None:
            raise RuntimeError("The job queue needs a shared database (not in-memory SQLite).")
        handle = _Handle(engine, kind, job_id, lambda: description, lambda: None)
        if exclusive:
            self._claim(handle, payload=dict(payload))
        else:
            with engine.begin() as conn:
                self._insert(conn, handle, description, payload=dict(payload))
        self._maybe_prune(engine)
        with engine.connect() as conn:
            row = conn.execute(_job_select(conn).where(_TABLE.c.id == job_id)).first()
        if row is None:  # pragma: no cover - deleted between insert and read
            raise RuntimeError(f"queued job {job_id} disappeared")
        return _row_dict(row)

    def claim(self, bind: Any, kind: str, *, limit: int = 1) -> List[Dict[str, Any]]:
        """Take up to ``limit`` queued jobs of ``kind`` for this process.

        PostgreSQL: ``FOR UPDATE SKIP LOCKED``, so concurrent workers never
        wait on or double-claim a row. Every database: the update re-checks
        ``queued`` (compare-and-set), so a row cancelled or claimed meanwhile
        is skipped. Returned rows include the ``payload``.
        """
        engine = shared_engine(bind)
        if engine is None or limit < 1:
            return []
        claimed: List[Dict[str, Any]] = []
        now = utc_now_naive()
        not_expired = now - timedelta(seconds=queue_timeout_seconds())
        with engine.begin() as conn:
            stmt = (
                select(_TABLE)
                .where(
                    _TABLE.c.kind == kind,
                    _TABLE.c.queued.is_(True),
                    _TABLE.c.active.is_(True),
                    _TABLE.c.cancel_requested.is_(False),
                    _TABLE.c.heartbeat_at >= not_expired,
                )
                .order_by(_TABLE.c.created_at, _TABLE.c.id)
                .limit(int(limit))
            )
            if _uses_db_clock(conn):
                stmt = stmt.with_for_update(skip_locked=True)
            rows = [dict(row._mapping) for row in conn.execute(stmt)]
            me = process_id()
            for row in rows:
                values = {
                    "queued": False,
                    "claimed_by": me,
                    "claimed_at": now,
                    "process_id": me,
                    "heartbeat_at": _heartbeat_now(conn),
                    "updated_at": now,
                    # The claimer keeps the payload in memory only: secrets
                    # leave the table as soon as a worker owns the job.
                    "payload": None,
                }
                result = conn.execute(
                    update(_TABLE)
                    .where(
                        _TABLE.c.id == row["id"],
                        _TABLE.c.queued.is_(True),
                        _TABLE.c.active.is_(True),
                        _TABLE.c.cancel_requested.is_(False),
                    )
                    .values(**values)
                )
                if result.rowcount:
                    payload = row.get("payload")
                    row.update(values, heartbeat_at=now)
                    row["payload"] = dict(payload or {})
                    row["snapshot"] = dict(row.get("snapshot") or {})
                    claimed.append(row)
        return claimed

    def fail(self, bind: Any, job_id: str, *, status: str, error: str) -> None:
        """Mark a claimed job that could not start as finished with ``error``."""
        engine = shared_engine(bind)
        if engine is None:
            return
        now = utc_now_naive()
        with engine.begin() as conn:
            current = conn.execute(
                select(_TABLE.c.snapshot).where(_TABLE.c.id == job_id)
            ).scalar()
            snapshot = dict(current or {})
            snapshot.update(status=status, error=error)
            if isinstance(snapshot.get("progress"), dict):
                snapshot["progress"] = {**snapshot["progress"], "phase": "failed"}
            conn.execute(
                update(_TABLE)
                .where(_TABLE.c.id == job_id, _TABLE.c.active.is_(True))
                .values(
                    snapshot=snapshot,
                    active=False,
                    queued=False,
                    payload=None,
                    status=status[:32],
                    error=error,
                    updated_at=now,
                    completed_at=now,
                )
            )

    def count_active(self, bind: Any, kind: str) -> int:
        """Unfinished (queued or running, not lost) jobs of ``kind`` in every process."""
        engine = shared_engine(bind)
        if engine is None:
            return 0
        with OrmSession(engine) as db:
            return len(self.active(db, kind))

    def changed(self, job_id: str, *, flush: bool = False) -> None:
        """Note a change of a tracked job; ``flush`` publishes it now."""
        with self._lock:
            handle = self._handles.get(job_id)
        if handle is None or handle.closed:
            return
        handle.dirty = True
        if flush:
            try:
                self._publish(handle)
            except Exception:
                logger.exception("Could not publish background job %s", job_id)

    def _forget(self, handle: _Handle) -> None:
        handle.closed = True
        with self._lock:
            if self._handles.get(handle.job_id) is handle:
                self._handles.pop(handle.job_id, None)

    def _publish(self, handle: _Handle) -> None:
        with handle.lock:
            if handle.closed:
                return
            desc = handle.describe()
            handle.dirty = False
            now = utc_now_naive()
            values = {
                "status": desc.status[:32],
                "active": bool(desc.active),
                "snapshot": desc.snapshot,
                "error": desc.error,
                "process_id": process_id(),
                "updated_at": desc.updated_at or now,
                "completed_at": desc.completed_at,
            }
            if not desc.active:
                # A finished job's payload (encrypted secrets included) is wiped.
                values["payload"] = None
            cancel_requested = False
            with handle.engine.begin() as conn:
                values["heartbeat_at"] = _heartbeat_now(conn)
                result = conn.execute(
                    update(_TABLE)
                    .where(
                        _TABLE.c.id == handle.job_id,
                        _TABLE.c.cancel_requested.is_(False),
                    )
                    .values(**values)
                )
                if not result.rowcount:
                    row = conn.execute(
                        select(_TABLE.c.cancel_requested).where(
                            _TABLE.c.id == handle.job_id
                        )
                    ).first()
                    if row is None:  # first write of this job
                        self._insert(conn, handle, desc)
                    else:
                        cancel_requested = bool(row[0])
            handle.last_published = time.monotonic()
            finished = not desc.active
        if cancel_requested:
            # Another process asked to cancel: its row already reads cancelled.
            self._forget(handle)
            try:
                handle.on_cancel()
            except Exception:
                logger.exception("Cancelling background job %s failed", handle.job_id)
        elif finished:
            self._forget(handle)

    def _loop(self) -> None:
        while True:
            # Progress changes are coalesced: at most one write per job and tick.
            self._wake.wait(FLUSH_SECONDS)
            self._wake.clear()
            with self._lock:
                handles = list(self._handles.values())
                if not handles:
                    self._thread = None
                    return
            now = time.monotonic()
            for handle in handles:
                if handle.closed:
                    continue
                if handle.dirty or now - handle.last_published >= HEARTBEAT_SECONDS:
                    try:
                        self._publish(handle)
                    except Exception:
                        logger.warning(
                            "Could not publish background job %s", handle.job_id,
                            exc_info=True,
                        )

    def _maybe_prune(self, engine: Engine) -> None:
        key = str(engine.url)
        now = time.monotonic()
        with self._lock:
            if now - self._last_prune.get(key, -PRUNE_EVERY_SECONDS) < PRUNE_EVERY_SECONDS:
                return
            self._last_prune[key] = now
        try:
            cutoff = utc_now_naive() - RETAIN_FINISHED
            with engine.begin() as conn:
                conn.execute(
                    delete(_TABLE).where(
                        _TABLE.c.updated_at < cutoff,
                        (_TABLE.c.active.is_(False))
                        | (_TABLE.c.heartbeat_at < cutoff),
                    )
                )
        except Exception:
            logger.warning("Could not prune finished background jobs", exc_info=True)

    def flush_all(self) -> None:
        """Publish every tracked job now (tests and shutdown)."""
        with self._lock:
            handles = list(self._handles.values())
        for handle in handles:
            try:
                self._publish(handle)
            except Exception:
                logger.warning("Could not publish background job %s", handle.job_id, exc_info=True)

    def is_tracked(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._handles

    # -- reader side --------------------------------------------------------

    def fetch(self, db: Any, kind: str, job_id: str) -> Optional[Dict[str, Any]]:
        engine = _engine_of_session(db)
        if engine is None:
            return None
        with _read_connection(db, engine) as conn:
            row = conn.execute(
                _job_select(conn).where(_TABLE.c.id == job_id, _TABLE.c.kind == kind)
            ).first()
        return _row_dict(row) if row is not None else None

    def active(
        self,
        db: Any,
        kind: str,
        *,
        scope_ids: Optional[Iterable[str]] = None,
        project_id: Optional[str] = None,
        pass_number: Any = _ANY,
    ) -> List[Dict[str, Any]]:
        """Unfinished jobs whose process is alive, newest first."""
        engine = _engine_of_session(db)
        if engine is None:
            return []
        stmt = select(_TABLE).where(_TABLE.c.kind == kind, _TABLE.c.active.is_(True))
        if scope_ids is not None:
            wanted = sorted(set(scope_ids))
            if not wanted:
                return []
            stmt = stmt.where(_TABLE.c.scope_id.in_(wanted))
        if project_id is not None:
            stmt = stmt.where(_TABLE.c.project_id == project_id)
        if pass_number is not _ANY:
            stmt = stmt.where(
                _TABLE.c.pass_number.is_(None)
                if pass_number is None
                else _TABLE.c.pass_number == int(pass_number)
            )
        stmt = stmt.order_by(_TABLE.c.created_at.desc())
        with _read_connection(db, engine) as conn:
            if _uses_db_clock(conn):
                stmt = stmt.add_columns(
                    func.timezone("utc", func.now(), type_=DateTime).label("_db_now")
                )
            rows = [_row_dict(row) for row in conn.execute(stmt)]
        return [row for row in rows if not row["lost"]]

    def request_cancel(
        self,
        db: Any,
        kind: str,
        job_id: str,
        *,
        status: str,
        mark: Callable[[Dict[str, Any]], Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Flag another process's job for cancellation and show it cancelled.

        ``mark`` turns the published snapshot into the cancelled one that
        pollers see until the owner stops. Returns the updated row.
        """
        engine = _engine_of_session(db)
        if engine is None:
            return None
        now = utc_now_naive()
        with engine.begin() as conn:
            row = conn.execute(
                _job_select(conn)
                .where(_TABLE.c.id == job_id, _TABLE.c.kind == kind)
                .with_for_update()
            ).first()
            if row is None:
                return None
            data = _row_dict(row)
            if not data["active"]:
                return data
            snapshot = mark(dict(data["snapshot"]))
            conn.execute(
                update(_TABLE)
                .where(_TABLE.c.id == job_id)
                .values(
                    cancel_requested=True,
                    status=status,
                    active=False,
                    # A queued job is never claimed now; drop what it carried.
                    queued=False,
                    payload=None,
                    snapshot=snapshot,
                    updated_at=now,
                    completed_at=data.get("completed_at") or now,
                )
            )
        data.update(
            cancel_requested=True,
            status=status,
            active=False,
            snapshot=snapshot,
            updated_at=now,
            completed_at=data.get("completed_at") or now,
            lost=False,
            lost_reason=None,
            queued=False,
        )
        return data


job_registry = JobRegistry()


__all__ = [
    "FLUSH_SECONDS",
    "HEARTBEAT_SECONDS",
    "STALE_AFTER_SECONDS",
    "ActiveJobExists",
    "EXPIRED_ERROR",
    "LOST_ERROR",
    "JobDescription",
    "JobRegistry",
    "job_registry",
    "process_id",
    "shared_engine",
]
