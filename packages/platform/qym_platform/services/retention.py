"""Retention: monthly span partitions and purge of soft-deleted runs.

Age-based span retention preserves items, attempts, scores, and summaries.
Raw spans older than ``QYM_SPAN_RETENTION_DAYS`` are removed by dropping whole
monthly partitions — instant, no dead tuples, disk returned immediately.
Soft-deleted runs older than ``QYM_DELETED_RUN_GRACE_DAYS`` are hard-deleted
(children cascade via migration 0054). Purging pauses while a run's project is
archived (Restore is refused there too) and resumes on unarchive where it
stopped: ``resume_purge_clocks`` moves the run's purge clock forward.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import bindparam, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PARTITIONS = text(
    """
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid)
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'spans'::regclass
    """
)


def _month_start(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month(value: datetime) -> datetime:
    return (value.replace(day=28) + timedelta(days=4)).replace(day=1)


def _bounds(expr: str):
    """Parse "FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2026-02-01 00:00:00')"."""
    import re

    m = re.search(r"FROM \('([^']+)'\) TO \('([^']+)'\)", expr or "")
    if not m:
        return None
    fmt = "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(m.group(1)[:19], fmt), datetime.strptime(m.group(2)[:19], fmt)


def ensure_span_partitions(engine: Engine, *, months_ahead: int = 3, now: datetime = None) -> List[str]:
    """Create monthly partitions through now + months_ahead. Postgres only."""
    if engine.dialect.name != "postgresql":
        return []
    now = now or datetime.utcnow()
    created: List[str] = []
    with engine.begin() as conn:
        existing = {row[0] for row in conn.execute(_PARTITIONS)}
        start = _month_start(now)
        for _ in range(months_ahead + 1):
            name = f"spans_y{start.year:04d}m{start.month:02d}"
            if name not in existing:
                conn.execute(text(f"CREATE TABLE {name} PARTITION OF spans FOR VALUES FROM (:s) TO (:e)").bindparams(s=start, e=_next_month(start)))
                created.append(name)
            start = _next_month(start)
    if created:
        logger.info("created span partitions %s", created)
    return created


def drop_expired_span_partitions(engine: Engine, *, retention_days: int, now: datetime = None) -> List[str]:
    """Drop monthly partitions whose upper bound is older than the retention window."""
    if engine.dialect.name != "postgresql" or retention_days <= 0:
        return []
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=retention_days)
    dropped: List[str] = []
    with engine.connect() as conn:
        rows = conn.execute(_PARTITIONS).fetchall()
    for name, expr in rows:
        bounds = _bounds(expr)
        if not bounds or bounds[1] > cutoff:
            continue
        # Plain DETACH (CONCURRENTLY is unavailable while a DEFAULT partition exists);
        # it holds the parent's lock for milliseconds, once an hour at most.
        with engine.begin() as conn:
            conn.execute(text("SET LOCAL lock_timeout = '10s'"))
            conn.execute(text(f"ALTER TABLE spans DETACH PARTITION {name}"))
            conn.execute(text(f"DROP TABLE {name}"))
        dropped.append(name)
        logger.info("dropped expired span partition %s (upper bound %s)", name, bounds[1])
    return dropped


def purge_due_at(
    deleted_at: Optional[datetime],
    grace_days: int,
    purge_clock_started_at: Optional[datetime] = None,
) -> Optional[datetime]:
    """When ``purge_soft_deleted_runs`` may hard-delete a run (None: never).

    The grace period counts from ``purge_clock_started_at`` once an unarchive
    has moved it forward, else from ``deleted_at``. A run of an archived
    project is not purged at all until the project is unarchived.
    """
    if deleted_at is None or grace_days <= 0:
        return None
    return max(deleted_at, purge_clock_started_at or deleted_at) + timedelta(days=grace_days)


def resume_purge_clocks(db: Session, project_id: str, paused: timedelta) -> int:
    """Credit the time a project spent archived to its deleted runs' purge clocks.

    Runs as part of the unarchive transaction, through the session's connection
    so the dashboard outbox does not see a source change. A project's Trash is
    small; each run keeps its own clock, so a run deleted between two archive
    periods is credited only for the second.
    """
    from qym_platform.db.models import Run

    if paused <= timedelta(0):
        return 0
    runs = Run.__table__
    conn = db.connection()
    rows = conn.execute(
        select(runs.c.id, runs.c.deleted_at, runs.c.purge_clock_started_at).where(
            runs.c.project_id == project_id, runs.c.deleted_at.isnot(None)
        )
    ).all()
    if not rows:
        return 0
    conn.execute(
        update(runs)
        .where(runs.c.id == bindparam("run_id"))
        .values(purge_clock_started_at=bindparam("clock")),
        [
            {"run_id": row.id, "clock": max(row.deleted_at, row.purge_clock_started_at or row.deleted_at) + paused}
            for row in rows
        ],
    )
    return len(rows)


# A deleted run is due once its purge clock ran out and its project is active.
# ``deleted_at`` never runs ahead of the clock, so its index still bounds the
# scan; the clock and project checks only filter that range. Kept in one place
# for the candidate query, the per-run recheck and the DELETE itself.
_PURGE_DUE = (
    "deleted_at IS NOT NULL AND deleted_at < :c"
    " AND (purge_clock_started_at IS NULL OR purge_clock_started_at < :c)"
    " AND EXISTS (SELECT 1 FROM projects p WHERE p.id = runs.project_id AND p.is_active = :active)"
)


# Heavy children of a run, deleted in keyset batches (each its own short
# transaction) before the run row itself, so the final cascade is small. The
# key column leads, after ``run_id``, an index of the table; deleting whole
# keys keeps every batch an index range scan instead of re-reading the rows
# earlier batches already removed. Spans first: the largest by far.
_PURGE_BATCHES = (
    ("spans", "span_id"),
    ("run_events", "sequence"),
    ("run_item_pass_scores", "item_id"),
    ("run_item_scores", "item_id"),
    ("run_item_attempts", "item_id"),
    ("run_items", "item_id"),
)
PURGE_BATCH_ROWS = 5000


def _delete_children_in_batches(
    engine: Engine, guard: Any, run_id: str, *, batch_size: int
) -> int:
    """Delete a run's heavy child rows in short committed batches (Postgres).

    ``guard`` is the purge transaction holding the run row ``FOR UPDATE``, so
    a restore waits for the whole purge instead of finding a half-emptied run.
    It is pinged between batches so it never trips
    ``idle_in_transaction_session_timeout`` while the batches run. Rows the
    batches miss (inserted meanwhile) still go with the run's cascade.
    """
    total = 0
    for table, key in _PURGE_BATCHES:
        last: Any = None
        while True:
            after = "" if last is None else f" AND {key} > :last"
            statement = text(
                f"DELETE FROM {table} WHERE run_id = :r AND {key} IN ("
                f"SELECT {key} FROM {table} WHERE run_id = :r{after}"
                f" ORDER BY {key} LIMIT :n) RETURNING {key}"
            )
            params: Dict[str, Any] = {"r": run_id, "n": batch_size}
            if last is not None:
                params["last"] = last
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                keys = [row[0] for row in conn.execute(statement, params)]
            guard.execute(text("SELECT 1"))
            if not keys:
                break
            total += len(keys)
            last = max(keys)
            if len(keys) < batch_size:
                break
    return total


def _purge_one(
    engine: Engine, run_id: str, due: Dict[str, Any], *, batch_size: int
) -> bool:
    """Hard-delete one due run; False when it was skipped."""
    postgres = engine.dialect.name == "postgresql"
    with engine.begin() as conn:
        if postgres:
            conn.execute(text("SET LOCAL lock_timeout = '5s'"))
        # Rechecked: the project may have been archived since the scan.
        candidate = f"SELECT id FROM runs WHERE id = :r AND {_PURGE_DUE}"
        if postgres:
            candidate += " FOR UPDATE SKIP LOCKED"
        if conn.execute(text(candidate), {**due, "r": run_id}).scalar() is None:
            return False
        # The dashboard worker must remove this run's bucket contributions
        # before its numeric source records disappear. It can catch up on a
        # later tick even if it was stopped for the entire grace period.
        visible = text("SELECT present FROM dashboard_run_dimensions WHERE run_key = :r")
        if conn.execute(visible, {"r": run_id}).scalar():
            return False
        if postgres:
            # Bulk children go in short batches first, so the run's DELETE
            # below no longer holds every spans partition and millions of row
            # locks in one long statement.
            _delete_children_in_batches(engine, conn, run_id, batch_size=batch_size)
        # Cascade source rows before taking the partition lock: backfill
        # and normal writes also lock source rows before their partition.
        deleted = conn.execute(
            text(f"DELETE FROM runs WHERE id = :r AND {_PURGE_DUE}"),
            {**due, "r": run_id},
        ).rowcount
        if not deleted:
            return False
        partition = "SELECT partition_key FROM dashboard_partition_state WHERE partition_key = :r"
        if postgres:
            partition += " FOR UPDATE"
        conn.execute(text(partition), {"r": run_id}).first()
        if conn.execute(visible, {"r": run_id}).scalar():
            conn.rollback()
            return False
        conn.execute(
            text(
                "DELETE FROM dashboard_event_causes WHERE source_version IN (SELECT source_version FROM dashboard_change_events WHERE partition_key = :r)"
            ),
            {"r": run_id},
        )
        # Stored overviews of the project hold this run's names and numbers
        # (C037); its stored overview inputs go with its summary (ON DELETE
        # CASCADE). With the bulk children gone in batches above, this
        # transaction is short, so the project's snapshot rows are locked
        # only briefly.
        conn.execute(
            text(
                "DELETE FROM dashboard_overview_snapshots WHERE project_key IN (SELECT project_key FROM dashboard_run_summaries WHERE run_key = :r)"
            ),
            {"r": run_id},
        )
        for table in (
            "dashboard_run_summaries",
            "dashboard_run_dimensions",
            "dashboard_run_versions",
            "dashboard_record_state",
            "dashboard_record_causes",
        ):
            conn.execute(text(f"DELETE FROM {table} WHERE run_key = :r"), {"r": run_id})
        conn.execute(
            text("DELETE FROM dashboard_partition_state WHERE partition_key = :r"),
            {"r": run_id},
        )
        conn.execute(
            text("DELETE FROM dashboard_change_events WHERE partition_key = :r"),
            {"r": run_id},
        )
        conn.execute(
            text("DELETE FROM dashboard_dead_letters WHERE partition_key = :r"),
            {"r": run_id},
        )
    return True


def purge_soft_deleted_runs(
    engine: Engine,
    *,
    grace_days: int,
    limit: int = 50,
    now: datetime = None,
    batch_size: int = PURGE_BATCH_ROWS,
) -> List[str]:
    """Hard-delete runs soft-deleted more than ``grace_days`` ago.

    On PostgreSQL the bulk children (spans, events, items and their scores)
    are deleted in ``batch_size`` keyset batches, each committed on its own,
    while the purge transaction holds the run row; the run's DELETE then
    cascades only what is left. Runs of an archived project are skipped:
    purging pauses until an admin unarchives it (``resume_purge_clocks`` then
    credits the paused time).
    """
    if grace_days <= 0:
        return []
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=grace_days)
    due = {"c": cutoff, "active": True}
    purged: List[str] = []
    with engine.begin() as conn:
        # The legacy FK still prevents cascades while the span copy is pending.
        # Keep restorable source data until that migration has finished.
        if (
            engine.dialect.name == "postgresql"
            and conn.execute(text("SELECT to_regclass('spans_legacy')")).scalar()
            is not None
        ):
            return []
        ids = [
            r[0]
            for r in conn.execute(
                text(f"SELECT id FROM runs WHERE {_PURGE_DUE} ORDER BY deleted_at LIMIT :n"),
                {**due, "n": limit},
            )
        ]
    for run_id in ids:
        try:
            if _purge_one(engine, run_id, due, batch_size=batch_size):
                purged.append(run_id)
        except OperationalError as exc:
            # A lock or statement timeout: leave the run for the next tick.
            logger.warning("purge of run %s deferred: %s", run_id, exc.orig or exc)
    if purged:
        logger.info("purged %d soft-deleted runs", len(purged))
    return purged


def run_retention(engine: Engine, *, span_retention_days: int, deleted_run_grace_days: int) -> Dict[str, List[str]]:
    return {
        "partitions_created": ensure_span_partitions(engine),
        "partitions_dropped": drop_expired_span_partitions(engine, retention_days=span_retention_days),
        "runs_purged": purge_soft_deleted_runs(engine, grace_days=deleted_run_grace_days),
    }
