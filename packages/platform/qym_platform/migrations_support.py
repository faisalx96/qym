"""Partition helpers shared by migrations and maintenance jobs."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List

from sqlalchemy import text
from sqlalchemy.engine import Engine


def month_start(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month(value: datetime) -> datetime:
    return (value.replace(day=28) + timedelta(days=4)).replace(day=1)


def ensure_month_partitions_between(engine: Engine, first: datetime, last: datetime) -> List[str]:
    """Create monthly ``spans`` partitions covering [first, last] (PostgreSQL)."""
    if engine.dialect.name != "postgresql":
        return []
    created: List[str] = []
    with engine.begin() as conn:
        existing = {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid "
                    "WHERE i.inhparent = 'spans'::regclass"
                )
            )
        }
        start = month_start(first)
        stop = month_start(last)
        while start <= stop:
            name = f"spans_y{start.year:04d}m{start.month:02d}"
            if name not in existing:
                conn.execute(text(f"CREATE TABLE {name} PARTITION OF spans FOR VALUES FROM (:s) TO (:e)").bindparams(s=start, e=next_month(start)))
                created.append(name)
            start = next_month(start)
    return created
