"""Operator maintenance jobs: queued in the database, executed by the worker.

A job handler implements ``step(ctx) -> bool``: do one bounded unit of work
(a batch of deletes, one index, one table), persist its cursor in
``ctx.progress`` and return ``True`` when finished. The runner commits after
every step and re-reads the row, so cancel requests and pod restarts are honoured
at step granularity. Handlers must be idempotent per step.

Statements that cannot run inside a transaction (``VACUUM``,
``CREATE INDEX CONCURRENTLY``) use ``ctx.autocommit()``.
"""

from __future__ import annotations

import logging
import socket
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Iterator, List, Optional
from uuid import uuid4

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from qym_platform.db.maintenance_models import MaintenanceJob

logger = logging.getLogger(__name__)

LEASE_SECONDS = 120
LOG_LINES = 200


class JobCancelled(Exception):
    pass


class JobLeaseLost(Exception):
    pass


class JobContext:
    """What a handler gets: the job row's params/progress, a logger, and DB access."""

    def __init__(self, job: MaintenanceJob, session_factory: Callable[[], Session], engine: Engine):
        self.job_id = job.id
        self.lease_owner = job.lease_owner
        self.kind = job.kind
        self.params: Dict[str, Any] = dict(job.params or {})
        self.progress: Dict[str, Any] = dict(job.progress or {})
        self.session_factory = session_factory
        self.engine = engine
        self._log: List[str] = []
        self.dialect = engine.dialect.name

    def log(self, message: str) -> None:
        stamp = datetime.utcnow().strftime("%H:%M:%S")
        self._log.append(f"{stamp} {message}")
        logger.info("maintenance[%s %s] %s", self.kind, self.job_id[:8], message)

    def drain_log(self) -> List[str]:
        lines, self._log = self._log, []
        return lines

    @contextmanager
    def session(self) -> Iterator[Session]:
        db = self.session_factory()
        try:
            # Maintenance never enqueues dashboard change events for the rows it touches.
            db.info["dashboard_projection_worker"] = True
            yield db
        finally:
            db.close()

    @contextmanager
    def autocommit(self):
        """Raw connection in autocommit mode (VACUUM, CREATE INDEX CONCURRENTLY)."""
        conn = self.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        try:
            if self.is_postgres():
                # VACUUM / CREATE INDEX CONCURRENTLY / ALTER TABLE legitimately run for
                # minutes; the pool's statement_timeout must not cancel them.
                conn.execute(text("SET statement_timeout = 0"))
                conn.execute(text("SET lock_timeout = '30s'"))
            yield conn
        finally:
            conn.close()

    def scalar(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as conn:
            return conn.execute(text(sql), params).scalar()

    def is_postgres(self) -> bool:
        return self.dialect == "postgresql"


Handler = Callable[[JobContext], bool]
_REGISTRY: Dict[str, Dict[str, Any]] = {}


def register(kind: str, *, irreversible: bool = False, description: str = "") -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        doc = (fn.__doc__ or "").strip().splitlines()
        _REGISTRY[kind] = {
            "handler": fn,
            "irreversible": irreversible,
            "description": description or (doc[0] if doc else ""),
        }
        return fn

    return deco


def registry() -> Dict[str, Dict[str, Any]]:
    return {k: {"irreversible": v["irreversible"], "description": v["description"]} for k, v in _REGISTRY.items()}


def is_irreversible(kind: str) -> bool:
    return bool(_REGISTRY.get(kind, {}).get("irreversible"))


# --------------------------------------------------------------------------------------
# Queue operations
# --------------------------------------------------------------------------------------


def enqueue(db: Session, kind: str, params: Optional[Dict[str, Any]] = None, *, requested_by: Optional[str] = None) -> MaintenanceJob:
    if kind not in _REGISTRY:
        raise ValueError(f"unknown maintenance job kind: {kind}")
    active = db.execute(
        select(MaintenanceJob).where(MaintenanceJob.kind == kind, MaintenanceJob.status.in_(("queued", "running", "cancel_requested")))
    ).scalars().first()
    if active:
        raise ValueError(f"a {kind} job is already {active.status} ({active.id})")
    job = MaintenanceJob(kind=kind, params=params or {}, progress={}, log="", requested_by_user_id=requested_by)
    db.add(job)
    db.flush()
    return job


def request_start(db: Session, job_id: str) -> Optional[MaintenanceJob]:
    """Release a ``paused`` job (queued by a migration for the operator to sequence)."""
    job = db.get(MaintenanceJob, job_id)
    if job and job.status == "paused":
        job.status = "queued"
    return job


def request_cancel(db: Session, job_id: str) -> Optional[MaintenanceJob]:
    job = db.get(MaintenanceJob, job_id)
    if not job:
        return None
    if job.status in ("queued", "paused"):
        job.status = "cancelled"
        job.finished_at = datetime.utcnow()
    elif job.status == "running":
        job.status = "cancel_requested"
    return job


def list_jobs(db: Session, limit: int = 50) -> List[MaintenanceJob]:
    return list(db.execute(select(MaintenanceJob).order_by(MaintenanceJob.created_at.desc()).limit(limit)).scalars())


def _claim(db: Session, owner: str) -> Optional[MaintenanceJob]:
    now = datetime.utcnow()
    stmt = (
        select(MaintenanceJob)
        .where(
            (MaintenanceJob.status == "queued")
            | ((MaintenanceJob.status.in_(("running", "cancel_requested"))) & ((MaintenanceJob.lease_until.is_(None)) | (MaintenanceJob.lease_until < now)))
        )
        .order_by(MaintenanceJob.created_at)
        .limit(1)
    )
    if db.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    job = db.execute(stmt).scalars().first()
    if not job:
        return None
    if job.status == "queued":
        job.status = "running"
        job.started_at = now
    job.lease_owner = owner
    job.lease_until = now + timedelta(seconds=LEASE_SECONDS)
    db.commit()
    return job


def _append_log(job: MaintenanceJob, lines: List[str]) -> None:
    if not lines:
        return
    existing = (job.log or "").splitlines()
    existing.extend(lines)
    job.log = "\n".join(existing[-LOG_LINES:])


def run_job(job_id: str, session_factory: Callable[[], Session], engine: Engine, *, owner: str, step_budget_seconds: float = 30.0, should_stop: Optional[Callable[[], bool]] = None) -> str:
    """Drive one job to completion (or cancellation/failure). Returns final status."""
    with session_factory() as db:
        job = db.get(MaintenanceJob, job_id)
        if not job:
            return "missing"
        if job.lease_owner != owner:
            return "lease_lost"
        handler = _REGISTRY[job.kind]["handler"]
        ctx = JobContext(job, session_factory, engine)
        db.expunge(job)

    while True:
        if should_stop and should_stop():
            return "running"  # lease expires; another worker (or this one after restart) resumes
        started = time.perf_counter()
        status = "running"
        error: Optional[str] = None
        done = False
        try:
            # Run steps for up to step_budget_seconds before persisting progress.
            while True:
                done = bool(handler(ctx))
                if done or (time.perf_counter() - started) >= step_budget_seconds:
                    break
        except JobLeaseLost:
            return "lease_lost"
        except JobCancelled:
            status = "cancelled"
        except Exception as exc:  # noqa: BLE001 - recorded on the job row
            logger.exception("maintenance job %s (%s) failed", job_id, ctx.kind)
            status = "failed"
            error = f"{type(exc).__name__}: {exc}"[:4000]
            ctx.log(f"FAILED: {error}")
        with session_factory() as db:
            job = db.scalar(
                select(MaintenanceJob)
                .where(MaintenanceJob.id == job_id)
                .with_for_update()
            )
            if job is None:
                return "missing"
            if job.lease_owner != owner:
                return "lease_lost"
            _append_log(job, ctx.drain_log())
            job.progress = dict(ctx.progress)
            job.lease_until = datetime.utcnow() + timedelta(seconds=LEASE_SECONDS)
            job.lease_owner = owner
            if status == "failed":
                job.status, job.error, job.finished_at = "failed", error, datetime.utcnow()
            elif status == "cancelled" or job.status == "cancel_requested":
                job.status, job.finished_at = "cancelled", datetime.utcnow()
                _append_log(job, ["cancelled by operator"])
                status = "cancelled"
            elif done:
                job.status, job.finished_at = "succeeded", datetime.utcnow()
                job.lease_owner = job.lease_until = None
                status = "succeeded"
            db.commit()
            if status != "running":
                return status


class MaintenanceWorker:
    """Polls for claimable jobs and runs them one at a time in this process."""

    def __init__(self, session_factory: Callable[[], Session], engine: Engine, *, interval: float = 3.0, retention_interval: float = 3600.0):
        self.session_factory = session_factory
        self.engine = engine
        self.interval = interval
        self.retention_interval = retention_interval
        self._next_retention = time.monotonic() + 60.0  # first pass a minute after start
        self.owner = f"{socket.gethostname()[:24]}:{uuid4().hex}"
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.current_job_id: Optional[str] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="qym-maintenance", daemon=True)
        self._thread.start()

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def stop(self, *, timeout: float = 10.0) -> bool:
        self._stop.set()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=timeout)
        return not thread or not thread.is_alive()

    def tick(self) -> Optional[str]:
        with self.session_factory() as db:
            job = _claim(db, self.owner)
            if not job:
                return None
            job_id = job.id
        self.current_job_id = job_id
        try:
            return run_job(job_id, self.session_factory, self.engine, owner=self.owner, should_stop=self._stop.is_set)
        finally:
            self.current_job_id = None

    def _maybe_run_retention(self) -> None:
        if self.retention_interval <= 0 or time.monotonic() < self._next_retention:
            return
        self._next_retention = time.monotonic() + self.retention_interval
        from qym_platform.services.retention import run_retention

        settings = ingest_settings_for_maintenance()
        try:
            run_retention(self.engine, span_retention_days=settings.span_retention_days, deleted_run_grace_days=settings.deleted_run_grace_days)
        except Exception:  # noqa: BLE001
            logger.exception("scheduled retention failed")

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                result = self.tick()
                if not result:
                    self._maybe_run_retention()
            except Exception:  # noqa: BLE001
                logger.exception("maintenance worker tick failed")
                result = None
            self._stop.wait(0.2 if result else self.interval)


# --------------------------------------------------------------------------------------
# Handlers
# --------------------------------------------------------------------------------------


@register("db_stats", description="Collect table, index and payload sizes (read-only).")
def _db_stats(ctx: JobContext) -> bool:
    from qym_platform.tools.perf.db_stats import collect

    stats = collect(ctx.engine, top=15, sample_pct=float(ctx.params.get("sample_pct", 2.0)))
    ctx.progress["stats"] = stats
    ctx.progress["message"] = "collected"
    ctx.log(f"database size {stats['database']['size_bytes']:,} bytes")
    return True


@register("drop_redundant_indexes", description="Drop indexes fully covered by unique constraints (frees disk instantly).")
def _drop_redundant_indexes(ctx: JobContext) -> bool:
    names = ctx.params.get("indexes") or ["ix_run_events_run_id", "ix_run_events_event_id", "ix_spans_run_id"]
    freed = 0
    with ctx.autocommit() as conn:
        for name in names:
            size = conn.execute(text("SELECT pg_relation_size(to_regclass(:n))"), {"n": name}).scalar() if ctx.is_postgres() else 0
            if size is None:
                ctx.log(f"{name}: not present")
                continue
            conn.execute(text(f"DROP INDEX {'CONCURRENTLY' if ctx.is_postgres() else ''} IF EXISTS {name}"))
            freed += int(size or 0)
            ctx.log(f"dropped {name} ({int(size or 0):,} bytes)")
    ctx.progress["bytes_freed"] = freed
    ctx.progress["message"] = f"freed {freed:,} bytes"
    return True


@register("create_deferred_indexes", description="Build indexes CONCURRENTLY that were too large for a startup migration.")
def _create_deferred_indexes(ctx: JobContext) -> bool:
    specs = list(ctx.params.get("indexes") or [])
    done = set(ctx.progress.get("done") or [])
    for spec in specs:
        if spec["name"] in done:
            continue
        cols = ", ".join(spec["columns"])
        where = f" WHERE {spec['where']}" if spec.get("where") else ""
        with ctx.autocommit() as conn:
            if ctx.is_postgres():
                # An earlier interrupted build leaves an INVALID index behind; rebuild it.
                conn.execute(text(f"DROP INDEX IF EXISTS {spec['name']}"))
                started = time.perf_counter()
                conn.execute(text(f"CREATE INDEX CONCURRENTLY {spec['name']} ON {spec['table']} ({cols}){where}"))
                ctx.log(f"created {spec['name']} on {spec['table']}({cols}){where} in {time.perf_counter() - started:.0f}s")
            else:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {spec['name']} ON {spec['table']} ({cols}){where}"))
                ctx.log(f"created {spec['name']}")
        done.add(spec["name"])
        ctx.progress["done"] = sorted(done)
        return len(done) >= len(specs)  # one index per step so progress is persisted
    ctx.progress["message"] = f"{len(done)}/{len(specs)} indexes"
    return True


@register("reclaim_run_events", description="Delete legacy span_completed rows from run_events in batches, vacuuming as it goes.")
def _reclaim_run_events(ctx: JobContext) -> bool:
    """Delete legacy ``span_completed`` rows per run, VACUUM periodically.

    Cursor = last processed run id (runs ordered by id). Space becomes reusable
    after VACUUM; the file shrinks only via a later repack/swap job.
    """
    batch_runs = int(ctx.params.get("batch_runs", 10))
    vacuum_every = int(ctx.params.get("vacuum_every", 20))
    cursor = ctx.progress.get("cursor") or ""
    if "total_runs" not in ctx.progress:
        ctx.progress["total_runs"] = int(ctx.scalar("SELECT count(*) FROM runs"))
        ctx.progress["rows_deleted"] = 0
        ctx.progress["runs_done"] = 0
        ctx.progress["batches"] = 0
        ctx.log(f"{ctx.progress['total_runs']:,} runs to scan")
    with ctx.session() as db:
        run_ids = [r[0] for r in db.execute(text("SELECT id FROM runs WHERE id > :c ORDER BY id LIMIT :n"), {"c": cursor, "n": batch_runs})]
        if not run_ids:
            ctx.progress["message"] = f"done: {ctx.progress['rows_deleted']:,} rows deleted"
            ctx.log(ctx.progress["message"])
            return True
        if ctx.is_postgres():
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
        deleted = db.execute(
            text("DELETE FROM run_events WHERE run_id = ANY(:ids) AND type = 'span_completed'") if ctx.is_postgres() else text("DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE id > :lo AND id <= :hi) AND type = 'span_completed'"),
            {"ids": run_ids} if ctx.is_postgres() else {"lo": cursor, "hi": run_ids[-1]},
        ).rowcount
        db.commit()
    ctx.progress["cursor"] = run_ids[-1]
    ctx.progress["rows_deleted"] += int(deleted or 0)
    ctx.progress["runs_done"] += len(run_ids)
    ctx.progress["batches"] += 1
    ctx.progress["message"] = f"{ctx.progress['runs_done']:,}/{ctx.progress['total_runs']:,} runs, {ctx.progress['rows_deleted']:,} rows deleted"
    if ctx.progress["batches"] % vacuum_every == 0 and ctx.is_postgres():
        with ctx.autocommit() as conn:
            started = time.perf_counter()
            conn.execute(text("VACUUM run_events"))
        ctx.log(f"{ctx.progress['message']}; VACUUM run_events took {time.perf_counter() - started:.0f}s")
    return False


@register("vacuum_analyze", description="VACUUM (ANALYZE) the given tables.")
def _vacuum_analyze(ctx: JobContext) -> bool:
    tables = list(ctx.params.get("tables") or ["run_events", "spans", "run_items"])
    if not ctx.is_postgres():
        ctx.log("skipped: not PostgreSQL")
        return True
    done = list(ctx.progress.get("done") or [])
    for table in tables:
        if table in done:
            continue
        with ctx.autocommit() as conn:
            started = time.perf_counter()
            conn.execute(text(f"VACUUM (ANALYZE) {table}"))
        ctx.log(f"vacuumed {table} in {time.perf_counter() - started:.0f}s")
        done.append(table)
        ctx.progress["done"] = done
        return len(done) >= len(tables)
    return True


@register(
    "prune_dashboard_events",
    description="Delete already-published dashboard outbox rows older than N days.",
)
def _prune_dashboard_events(ctx: JobContext) -> bool:
    from qym_platform.db.dashboard_models import (
        DashboardChangeEvent,
        DashboardEventCause,
    )

    days = int(ctx.params.get("days", 7))
    batch = int(ctx.params.get("batch", 20000))
    cutoff = datetime.utcnow() - timedelta(days=days)
    with ctx.session() as db:
        candidates = (
            select(DashboardChangeEvent.source_version)
            .where(
                DashboardChangeEvent.published_at.isnot(None),
                DashboardChangeEvent.published_at < cutoff,
            )
            .order_by(DashboardChangeEvent.source_version)
            .limit(batch)
        )
        versions = list(db.scalars(candidates))
        deleted = 0
        if versions:
            db.execute(
                delete(DashboardEventCause).where(
                    DashboardEventCause.source_version.in_(versions)
                )
            )
            deleted = db.execute(
                delete(DashboardChangeEvent).where(
                    DashboardChangeEvent.source_version.in_(versions)
                )
            ).rowcount
        db.commit()
    ctx.progress["rows_deleted"] = int(ctx.progress.get("rows_deleted") or 0) + int(
        deleted or 0
    )
    ctx.progress["message"] = f"{ctx.progress['rows_deleted']:,} rows deleted"
    return (deleted or 0) < batch


@register(
    "alter_column_types",
    description="Rewrite large tables to bigint ids / jsonb (migration 0052, deferred). Run in maintenance mode.",
)
def _alter_column_types(ctx: JobContext) -> bool:
    """One table per step; each ALTER rewrites the table under an exclusive lock."""
    from qym_platform.db.migration_helpers import column_type_statements

    tables = list(ctx.params.get("tables") or [])
    done = list(ctx.progress.get("done") or [])
    if not ctx.is_postgres():
        ctx.log("skipped: not PostgreSQL")
        return True
    for table in tables:
        if table in done:
            continue
        with ctx.autocommit() as conn:
            started = time.perf_counter()
            conn.execute(text("SET lock_timeout = '30s'"))
            for stmt in column_type_statements(table):
                conn.execute(text(stmt))
        ctx.log(f"rewrote {table} in {time.perf_counter() - started:.0f}s")
        done.append(table)
        ctx.progress["done"] = done
        ctx.progress["message"] = f"{len(done)}/{len(tables)} tables"
        return len(done) >= len(tables)
    return True


@register("validate_foreign_keys", description="VALIDATE the NOT VALID cascading foreign keys added by migration 0054.")
def _validate_foreign_keys(ctx: JobContext) -> bool:
    specs = list(ctx.params.get("constraints") or [])
    done = list(ctx.progress.get("done") or [])
    if not ctx.is_postgres():
        return True
    for spec in specs:
        key = f"{spec['table']}.{spec['constraint']}"
        if key in done:
            continue
        with ctx.autocommit() as conn:
            started = time.perf_counter()
            conn.execute(text(f"ALTER TABLE {spec['table']} VALIDATE CONSTRAINT {spec['constraint']}"))
        ctx.log(f"validated {key} in {time.perf_counter() - started:.0f}s")
        done.append(key)
        ctx.progress["done"] = done
        ctx.progress["message"] = f"{len(done)}/{len(specs)} constraints"
        return len(done) >= len(specs)
    return True


_MIGRATE_SPANS_SQL = """
INSERT INTO spans (run_created_at, run_id, trace_id, span_id, parent_span_id, name, kind,
                   start_time_ns, end_time_ns, duration_ms, status, attributes, events, links,
                   oi_kind, usage_scope, model_name, tool_name, token_total, token_prompt, token_completion)
SELECT r.created_at, s.run_id, s.trace_id, s.span_id, s.parent_span_id, s.name, s.kind,
       s.start_time_ns, s.end_time_ns, s.duration_ms, s.status,
       s.attributes::jsonb, s.events::jsonb, s.links::jsonb,
       left(upper(COALESCE(s.attributes::jsonb ->> 'openinference.span.kind', s.attributes::jsonb ->> 'ai.openinference.span.kind')), 20),
       left(lower(s.attributes::jsonb ->> 'qym.usage_scope'), 20),
       left(s.attributes::jsonb ->> 'llm.model_name', 200),
       left(s.attributes::jsonb ->> 'tool.name', 200),
       NULLIF(regexp_replace(COALESCE(s.attributes::jsonb ->> 'llm.token_count.total', ''), '[^0-9]', '', 'g'), '')::bigint,
       NULLIF(regexp_replace(COALESCE(s.attributes::jsonb ->> 'llm.token_count.prompt', ''), '[^0-9]', '', 'g'), '')::bigint,
       NULLIF(regexp_replace(COALESCE(s.attributes::jsonb ->> 'llm.token_count.completion', ''), '[^0-9]', '', 'g'), '')::bigint
FROM spans_legacy s JOIN runs r ON r.id = s.run_id
WHERE s.run_id = ANY(:ids) AND r.created_at >= :cutoff
ON CONFLICT ON CONSTRAINT uq_span DO NOTHING
"""


def _span_copy_cutoff(ctx: JobContext) -> datetime:
    """Keep the retention boundary fixed across batches and worker restarts."""
    if ctx.progress.get("cutoff"):
        return datetime.fromisoformat(ctx.progress["cutoff"])
    days = int(
        ctx.params.get(
            "retention_days", ingest_settings_for_maintenance().span_retention_days
        )
    )
    if days < 0:
        raise ValueError("retention_days must be non-negative")
    cutoff = datetime.utcnow() - timedelta(days=days) if days else datetime.min
    ctx.progress.update(cutoff=cutoff.isoformat(), retention_days=days)
    return cutoff


@register("migrate_spans", description="Copy spans_legacy into the partitioned spans table (retention-aware, per-run batches).")
def _migrate_spans(ctx: JobContext) -> bool:
    if not ctx.is_postgres():
        ctx.log("skipped: not PostgreSQL")
        return True
    if ctx.scalar("SELECT to_regclass('spans_legacy')") is None:
        ctx.log("spans_legacy does not exist; nothing to migrate")
        return True
    cutoff = _span_copy_cutoff(ctx)
    batch_runs = int(ctx.params.get("batch_runs", 10))
    cursor = ctx.progress.get("cursor") or ""
    if "total_runs" not in ctx.progress:
        ctx.progress["total_runs"] = int(ctx.scalar("SELECT count(*) FROM runs"))
        ctx.progress.update(runs_done=0, rows_copied=0, runs_skipped_by_retention=0)
        ctx.log(f"copying spans for runs created since {cutoff:%Y-%m-%d}; {ctx.progress['total_runs']:,} runs to scan")
        from qym_platform.services.retention import ensure_span_partitions

        first = ctx.scalar("SELECT min(created_at) FROM runs")
        if first and first < cutoff:
            first = cutoff
        if first:
            # Partitions for every month the copy can touch.
            from qym_platform.migrations_support import ensure_month_partitions_between

            created = ensure_month_partitions_between(ctx.engine, first, datetime.utcnow())
            if created:
                ctx.log(f"created partitions {created}")
        ensure_span_partitions(ctx.engine)
    with ctx.session() as db:
        rows = db.execute(text("SELECT id, created_at, deleted_at FROM runs WHERE id > :c ORDER BY id LIMIT :n"), {"c": cursor, "n": batch_runs}).fetchall()
        if not rows:
            ctx.progress["message"] = f"done: {ctx.progress['rows_copied']:,} spans copied for {ctx.progress['runs_done']:,} runs"
            ctx.log(ctx.progress["message"])
            return True
        ids = [r[0] for r in rows]
        # Soft deletion is reversible. Preserve traces for those runs until
        # ordinary retention or an actual hard delete removes them.
        eligible = [r[0] for r in rows if r[1] >= cutoff]
        copied = 0
        if eligible:
            db.execute(text("SET LOCAL lock_timeout = '10s'"))
            copied = db.execute(text(_MIGRATE_SPANS_SQL), {"ids": eligible, "cutoff": cutoff}).rowcount or 0
        db.commit()
    ctx.progress["cursor"] = ids[-1]
    ctx.progress["runs_done"] += len(ids)
    ctx.progress["runs_skipped_by_retention"] += len(ids) - len(eligible)
    ctx.progress["rows_copied"] += int(copied)
    ctx.progress["message"] = f"{ctx.progress['runs_done']:,}/{ctx.progress['total_runs']:,} runs, {ctx.progress['rows_copied']:,} spans copied"
    return False


@register(
    "drop_legacy_spans",
    irreversible=True,
    description="DROP spans_legacy after migrate_spans has been verified. Returns the disk immediately.",
)
def _drop_legacy_spans(ctx: JobContext) -> bool:
    if not ctx.is_postgres():
        return True
    if ctx.scalar("SELECT to_regclass('spans_legacy')") is None:
        ctx.log("spans_legacy already gone")
        return True
    if not ingest_settings_for_maintenance().maintenance_mode:
        raise RuntimeError(
            "Enable QYM_MAINTENANCE_MODE before verifying and dropping spans_legacy"
        )
    cutoff = _span_copy_cutoff(ctx)
    with ctx.engine.begin() as conn:
        conn.execute(text("SET LOCAL statement_timeout = 0"))
        conn.execute(text("SET LOCAL lock_timeout = '30s'"))
        # Verification can exceed the worker lease. Keep another worker from
        # claiming this job until the verification and DROP commit together.
        job = conn.execute(
            text(
                "SELECT status, lease_owner FROM maintenance_jobs WHERE id = :id FOR UPDATE"
            ),
            {"id": ctx.job_id},
        ).first()
        if job is None or job.lease_owner != ctx.lease_owner:
            raise JobLeaseLost()
        if job.status == "cancel_requested":
            raise JobCancelled()
        # Freeze the eligibility set, the legacy source, and the destination.
        # This also excludes concurrent retention and old-image span writers.
        conn.execute(text("LOCK TABLE runs IN SHARE MODE"))
        conn.execute(text("LOCK TABLE spans_legacy IN ACCESS EXCLUSIVE MODE"))
        conn.execute(text("LOCK TABLE spans IN SHARE MODE"))
        missing = conn.execute(
            text("""
                SELECT s.run_id, s.span_id
                FROM spans_legacy s JOIN runs r ON r.id = s.run_id
                WHERE r.created_at >= :cutoff AND NOT EXISTS (
                    SELECT 1 FROM spans d
                    WHERE d.run_id = s.run_id AND d.span_id = s.span_id
                      AND d.run_created_at = r.created_at
                )
                LIMIT 1
            """),
            {"cutoff": cutoff},
        ).first()
        if missing is not None:
            ctx.progress["missing_span"] = {
                "run_id": missing.run_id,
                "span_id": missing.span_id,
            }
            raise RuntimeError(
                f"spans_legacy contains an uncopied span ({missing.run_id}, {missing.span_id}); run migrate_spans before dropping it"
            )
        ctx.progress.pop("missing_span", None)
        size = int(
            conn.execute(text("SELECT pg_total_relation_size('spans_legacy')")).scalar()
            or 0
        )
        conn.execute(text("DROP TABLE spans_legacy"))
        # Cover the short gap before run_job persists its final result.
        conn.execute(
            text("UPDATE maintenance_jobs SET lease_until = :until WHERE id = :id"),
            {
                "until": datetime.utcnow() + timedelta(seconds=LEASE_SECONDS),
                "id": ctx.job_id,
            },
        )
    ctx.progress["bytes_freed"] = size
    ctx.progress["message"] = f"dropped spans_legacy, freed {size:,} bytes"
    ctx.log(ctx.progress["message"])
    return True


def _counted_verdict_reason(meta: Any) -> bool:
    """A score the pre-C010 rule counted as a scorer error but the current rule
    reads as a verdict reason: ``meta.error`` set without an error status."""
    from qym_platform.services.run_means import is_metric_error

    if not isinstance(meta, dict) or is_metric_error(meta):
        return False
    error = meta.get("error")
    return bool(error.strip()) if isinstance(error, str) else bool(error)


def _in_own_transaction(ctx: JobContext, work: Callable[[Session], Any], *, attempts: int = 3) -> Any:
    """Run ``work(db)`` and commit, alone in its transaction.

    A deadlock or lock timeout with the dashboard worker rolls back only this
    unit and is retried, instead of failing the whole job.
    """
    from sqlalchemy.exc import OperationalError

    for attempt in range(attempts):
        try:
            with ctx.session() as db:
                result = work(db)
                db.commit()
                return result
        except OperationalError as exc:
            if attempt + 1 >= attempts:
                raise
            ctx.log(f"retrying after {type(getattr(exc, 'orig', exc)).__name__}")
            time.sleep(0.2 * (attempt + 1))
    return None


def _mark_task_error_passes(ctx: JobContext, cursor: int, window: int) -> int:
    """Mark pass scores that ingest zero-filled for a failed task while they
    still carried the scorer's metadata or explanation (a cancel mid-scoring
    stored before the marker existed). The dashboard already reads those
    passes as failed tasks from their attempts; the marker makes the source
    rows agree. The pass's execution outcome decides before the explanation
    or metadata does: a failed final attempt, or an item_failed event (older
    SDKs sent no final attempt)."""
    from qym_platform.db.models import RunEvent, RunItemAttempt, RunItemPassScore
    from qym_platform.services.run_means import (
        METRIC_ERROR_STATUSES,
        TASK_ERROR_PASS_LABEL,
        TASK_ERROR_PASS_MARKER,
        is_metric_error,
        is_task_error_pass,
        task_error_pass_meta,
    )

    def unmarked_verdict(row) -> bool:
        # Rows the source rule already reads as failed tasks, scorer errors,
        # reviewer scores and marked scorer verdicts stay as they are.
        meta = row.meta if isinstance(row.meta, dict) else {}
        return (
            not is_task_error_pass(row.label, row.meta, row.explanation)
            and not is_metric_error(meta)
            and str(meta.get("modified") or "").strip().lower() != "true"
            and not isinstance(meta.get(TASK_ERROR_PASS_MARKER), bool)
        )

    def work(db: Session) -> int:
        rows = [
            row
            for row in db.execute(
                select(RunItemPassScore).where(
                    RunItemPassScore.id > cursor,
                    RunItemPassScore.id <= cursor + window,
                    func.lower(func.trim(RunItemPassScore.label)) == TASK_ERROR_PASS_LABEL,
                )
            ).scalars()
            if unmarked_verdict(row)
        ]
        if not rows:
            return 0
        run_ids = {row.run_id for row in rows}
        item_ids = {row.item_id for row in rows}
        failed = {
            tuple(row)
            for row in db.execute(
                select(
                    RunItemAttempt.run_id, RunItemAttempt.item_id, RunItemAttempt.pass_number
                ).where(
                    RunItemAttempt.run_id.in_(run_ids),
                    RunItemAttempt.item_id.in_(item_ids),
                    RunItemAttempt.is_last_attempt.is_(True),
                    func.lower(RunItemAttempt.status).in_(METRIC_ERROR_STATUSES),
                )
            )
        }
        for run_id, item_id, pass_number in db.execute(
            select(
                RunEvent.run_id,
                RunEvent.payload["item_id"].as_string(),
                RunEvent.payload["pass_number"].as_string(),
            ).where(
                RunEvent.run_id.in_(run_ids),
                RunEvent.type == "item_failed",
                RunEvent.payload["item_id"].as_string().in_(item_ids),
            )
        ):
            try:
                failed.add((run_id, item_id, max(1, int(pass_number or 1))))
            except (TypeError, ValueError):
                failed.add((run_id, item_id, 1))
        marked = 0
        for row in rows:
            if (row.run_id, row.item_id, int(row.pass_number)) in failed:
                row.meta = task_error_pass_meta(row.meta)
                marked += 1
        return marked

    return int(_in_own_transaction(ctx, work) or 0)


@register(
    "reclassify_metric_errors",
    description=(
        "Rebuild dashboard numbers for runs whose metric verdict reasons were counted as "
        "scorer errors (C010), and mark repeat passes whose task failed after a metric was scored."
    ),
)
def _reclassify_metric_errors(ctx: JobContext) -> bool:
    """Scan score rows in id windows; repair each affected run once.

    Summaries and error counts come from numeric projection records whose
    error flag was computed when the score was stored. Rows that only carry a
    verdict reason in ``meta.error`` need their run rebuilt from source, which
    the dashboard worker does in the background after the repair request.
    Each run's repair request commits on its own, in the worker's lock order
    (a partition, then its buckets), and a deadlock with the worker is
    retried. The last phase marks task-failed pass scores
    (``_mark_task_error_passes``).
    """
    from qym_platform.db.models import RunItemPassScore, RunItemScore
    from qym_platform.services.dashboard_summaries import request_dashboard_repair

    window = max(1, int(ctx.params.get("window", 20000)))
    phases = (
        ("score", RunItemScore),
        ("pass_score", RunItemPassScore),
        ("task_error_pass", RunItemPassScore),
    )
    phase = ctx.progress.get("phase") or phases[0][0]
    names = [name for name, _ in phases]
    if phase not in names:
        return True
    model = dict(phases)[phase]
    cursor = int(ctx.progress.get("cursor") or 0)
    repaired = set(ctx.progress.get("runs") or [])
    with ctx.session() as db:
        max_key = phase + "_max_id"
        if max_key not in ctx.progress:
            # Rows stored after the upgrade already use the current rule.
            ctx.progress[max_key] = int(
                db.scalar(select(model.id).order_by(model.id.desc()).limit(1)) or 0
            )
        max_id = int(ctx.progress[max_key])
        affected = set()
        if phase != "task_error_pass":
            rows = db.execute(
                select(model.run_id, model.meta).where(
                    model.id > cursor,
                    model.id <= cursor + window,
                    model.meta["error"].as_string().isnot(None),
                )
            ).all()
            affected = {
                run_id for run_id, meta in rows if _counted_verdict_reason(meta)
            } - repaired
    if phase == "task_error_pass":
        marked = _mark_task_error_passes(ctx, cursor, window)
        ctx.progress["passes_marked"] = int(ctx.progress.get("passes_marked") or 0) + marked
    for run_id in sorted(affected):
        if _in_own_transaction(
            ctx, lambda db, run_id=run_id: request_dashboard_repair(db, run_id, publish=False)
        ):
            repaired.add(run_id)
            ctx.progress["runs"] = sorted(repaired)
    cursor += window
    ctx.progress["runs"] = sorted(repaired)
    ctx.progress["runs_repaired"] = len(repaired)
    if cursor >= max_id:
        position = names.index(phase) + 1
        if position >= len(names):
            ctx.progress["phase"] = "done"
            ctx.progress["message"] = (
                f"done: {len(repaired):,} runs queued for a dashboard rebuild; "
                f"{int(ctx.progress.get('passes_marked') or 0):,} task-failed passes marked"
            )
            ctx.log(ctx.progress["message"])
            return True
        ctx.progress["phase"], ctx.progress["cursor"] = names[position], 0
    else:
        ctx.progress["phase"], ctx.progress["cursor"] = phase, cursor
    ctx.progress["message"] = f"{phase} rows up to id {min(cursor, max_id):,}; {len(repaired):,} runs queued"
    return False


@register(
    "project_item_failure_events",
    description="Rebuild dashboard numbers for repeat runs with a pass that failed only through an item_failed event (C011).",
)
def _project_item_failure_events(ctx: JobContext) -> bool:
    """Walk repeat runs in id windows; repair each affected run once.

    Live ingest stored events without projecting them, so a repeat-run pass
    whose failure has no failed final attempt (a crash before the attempt, or
    a metric that raised after the task succeeded) is missing from published
    task errors and execution success. Only runs with such a pass whose event
    has no projection record are rebuilt, by the dashboard worker. Each window
    reads just the item_failed events of its runs, through the run_id index.
    """
    from qym_platform.db.dashboard_models import DashboardRecordState as Record
    from qym_platform.db.models import Run, RunEvent, RunItemAttempt
    from qym_platform.services.dashboard_outbox import execution_event_numbers
    from qym_platform.services.dashboard_summaries import request_dashboard_repair
    from qym_platform.services.run_means import METRIC_ERROR_STATUSES

    window = max(1, int(ctx.params.get("window", 200)))
    cursor = str(ctx.progress.get("cursor") or "")
    repaired = set(ctx.progress.get("runs") or [])
    affected = set()
    with ctx.session() as db:
        run_ids = list(
            db.scalars(
                select(Run.id)
                .where(Run.id > cursor, Run.samples > 1, Run.deleted_at.is_(None))
                .order_by(Run.id)
                .limit(window)
            )
        )
        events = {}
        if run_ids:
            for run_id, event_id, item_id, pass_number in db.execute(
                select(
                    RunEvent.run_id,
                    RunEvent.event_id,
                    RunEvent.payload["item_id"].as_string(),
                    RunEvent.payload["pass_number"].as_string(),
                ).where(RunEvent.run_id.in_(run_ids), RunEvent.type == "item_failed")
            ):
                numbers = execution_event_numbers(
                    "item_failed", {"item_id": item_id, "pass_number": pass_number}
                )
                if numbers["item_id"]:
                    events[run_id, event_id] = (
                        numbers["item_id"],
                        numbers["pass_number"],
                    )
        failing = sorted({run_id for run_id, _ in events})
        if failing:
            # A failed final attempt already carries the failure.
            failed = {
                (run_id, str(item_id), max(1, int(pass_number or 1)))
                for run_id, item_id, pass_number in db.execute(
                    select(
                        RunItemAttempt.run_id,
                        RunItemAttempt.item_id,
                        RunItemAttempt.pass_number,
                    ).where(
                        RunItemAttempt.run_id.in_(failing),
                        RunItemAttempt.is_last_attempt.is_(True),
                        func.lower(RunItemAttempt.status).in_(METRIC_ERROR_STATUSES),
                    )
                )
            }
            projected = set(
                db.execute(
                    select(Record.run_key, Record.metric_key).where(
                        Record.run_key.in_(failing),
                        Record.record_kind == "attempt",
                        Record.metric_key.startswith("legacy_event:"),
                        Record.present.is_(True),
                        Record.error > 0,
                    )
                ).tuples()
            )
            affected = {
                run_id
                for (run_id, event_id), (item_id, pass_number) in events.items()
                if (run_id, item_id, pass_number) not in failed
                and (run_id, "legacy_event:" + event_id) not in projected
            }
    # Each repair commits alone: holding one run's dashboard locks while
    # requesting the next can deadlock with the worker publishing that run.
    for run_id in sorted(affected - repaired):
        if _in_own_transaction(
            ctx, lambda db, run_id=run_id: request_dashboard_repair(db, run_id, publish=False)
        ):
            repaired.add(run_id)
    ctx.progress["runs"] = sorted(repaired)
    ctx.progress["runs_repaired"] = len(repaired)
    if len(run_ids) < window:
        ctx.progress["phase"] = "done"
        ctx.progress["message"] = (
            f"done: {len(repaired):,} runs queued for a dashboard rebuild"
        )
        ctx.log(ctx.progress["message"])
        return True
    ctx.progress["cursor"] = run_ids[-1]
    ctx.progress["message"] = (
        f"repeat runs up to {run_ids[-1]}; {len(repaired):,} runs queued"
    )
    return False


@register(
    "publish_ingest_flags",
    description="Show the incomplete-data flag of runs finished before C024 in the runs list.",
)
def _publish_ingest_flags(ctx: JobContext) -> bool:
    """Queue a runs-list refresh for runs whose metadata carries ``ingest_incomplete``.

    The runs list reads the flag from each run's dashboard descriptor, which
    the worker rebuilds only when the run changes. Runs flagged before the
    descriptor carried the flag get a run-level change event: the worker
    rebuilds the descriptor from the run row and republishes the summary from
    its numeric records, without rescanning items. Runs are read in bounded
    id windows.
    """
    from qym_platform.db.models import Run
    from qym_platform.services.dashboard_outbox import enqueue_snapshots

    window = max(1, int(ctx.params.get("window", 2000)))
    cursor = str(ctx.progress.get("cursor") or "")
    queued = int(ctx.progress.get("runs_queued") or 0)
    with ctx.session() as db:
        rows = db.execute(
            select(
                Run.id,
                Run.project_id,
                Run.run_metadata["ingest_incomplete"].as_string(),
            )
            .where(Run.id > cursor, Run.deleted_at.is_(None))
            .order_by(Run.id)
            .limit(window)
        ).all()
        flagged = [
            (
                dict(
                    partition_key=run_id,
                    project_key=project_id,
                    record_key=run_id + ":run",
                    record_kind="run",
                    operation="UPSERT",
                ),
                [],
            )
            for run_id, project_id, flag in rows
            if flag not in (None, "", "null")
        ]
        if flagged:
            enqueue_snapshots(db.connection(), flagged)
        db.commit()
    queued += len(flagged)
    ctx.progress["runs_queued"] = queued
    if len(rows) < window:
        ctx.progress["phase"] = "done"
        ctx.progress["message"] = f"done: {queued:,} flagged runs queued for the runs list"
        ctx.log(ctx.progress["message"])
        return True
    ctx.progress["cursor"] = rows[-1][0]
    ctx.progress["message"] = f"runs up to {rows[-1][0]}; {queued:,} flagged runs queued"
    return False


def ingest_settings_for_maintenance():
    from qym_platform.settings import PlatformSettings

    return PlatformSettings()


@register("run_retention", description="Create upcoming span partitions, drop expired ones, purge soft-deleted runs past their grace period.")
def _run_retention(ctx: JobContext) -> bool:
    from qym_platform.services.retention import run_retention

    settings = ingest_settings_for_maintenance()
    result = run_retention(ctx.engine, span_retention_days=int(ctx.params.get("span_retention_days", settings.span_retention_days)), deleted_run_grace_days=int(ctx.params.get("deleted_run_grace_days", settings.deleted_run_grace_days)))
    ctx.progress.update(result)
    ctx.progress["message"] = ", ".join(f"{k}={len(v)}" for k, v in result.items())
    ctx.log(ctx.progress["message"])
    return True
