"""Retention: monthly span partitions and purge of soft-deleted runs.

Derived data (items, attempts, scores, summaries, aggregates) is never pruned.
Raw spans older than ``QYM_SPAN_RETENTION_DAYS`` are removed by dropping whole
monthly partitions — instant, no dead tuples, disk returned immediately.
Soft-deleted runs older than ``QYM_DELETED_RUN_GRACE_DAYS`` are hard-deleted
(children cascade via migration 0054).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List

from sqlalchemy import text
from sqlalchemy.engine import Engine

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


def purge_soft_deleted_runs(engine: Engine, *, grace_days: int, limit: int = 50, now: datetime = None) -> List[str]:
    """Hard-delete runs soft-deleted more than ``grace_days`` ago (children cascade)."""
    if grace_days <= 0:
        return []
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=grace_days)
    purged: List[str] = []
    with engine.begin() as conn:
        ids = [r[0] for r in conn.execute(text("SELECT id FROM runs WHERE deleted_at IS NOT NULL AND deleted_at < :c ORDER BY deleted_at LIMIT :n"), {"c": cutoff, "n": limit})]
    for run_id in ids:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                conn.execute(text("SET LOCAL lock_timeout = '5s'"))
            for table in ("dashboard_run_summaries", "dashboard_run_dimensions", "dashboard_record_state", "dashboard_record_causes"):
                conn.execute(text(f"DELETE FROM {table} WHERE run_key = :r"), {"r": run_id})
            conn.execute(text("DELETE FROM dashboard_partition_state WHERE partition_key = :r"), {"r": run_id})
            conn.execute(text("DELETE FROM dashboard_change_events WHERE partition_key = :r"), {"r": run_id})
            conn.execute(text("DELETE FROM runs WHERE id = :r"), {"r": run_id})
        purged.append(run_id)
    if purged:
        logger.info("purged %d soft-deleted runs", len(purged))
    return purged


def run_retention(engine: Engine, *, span_retention_days: int, deleted_run_grace_days: int) -> Dict[str, List[str]]:
    return {
        "partitions_created": ensure_span_partitions(engine),
        "partitions_dropped": drop_expired_span_partitions(engine, retention_days=span_retention_days),
        "runs_purged": purge_soft_deleted_runs(engine, grace_days=deleted_run_grace_days),
    }
