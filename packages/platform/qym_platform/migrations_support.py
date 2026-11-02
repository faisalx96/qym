"""Partition helpers shared by migrations and maintenance jobs.

``spans`` is range-partitioned by ``run_created_at``. Partitions created
before migration 0085 are monthly (``spans_yYYYYmMM``); new ones are daily
(``spans_yYYYYmMMdDD``). Both forms coexist: every helper here decides from
the partitions' actual bounds, never from their names, so a daily partition
is never created inside a range a monthly one already covers.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Engine

PARTITIONS_SQL = (
    "SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) "
    "FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid "
    "WHERE i.inhparent = 'spans'::regclass"
)

Bound = Tuple[datetime, datetime]


def month_start(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month(value: datetime) -> datetime:
    return (value.replace(day=28) + timedelta(days=4)).replace(day=1)


def day_start(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def month_partition_name(start: datetime) -> str:
    return f"spans_y{start.year:04d}m{start.month:02d}"


def day_partition_name(start: datetime) -> str:
    return f"spans_y{start.year:04d}m{start.month:02d}d{start.day:02d}"


def parse_bounds(expr: Optional[str]) -> Optional[Bound]:
    """Parse "FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2026-02-01 00:00:00')".

    None for the DEFAULT partition (or anything unparseable).
    """
    m = re.search(r"FROM \('([^']+)'\) TO \('([^']+)'\)", expr or "")
    if not m:
        return None
    fmt = "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(m.group(1)[:19], fmt), datetime.strptime(m.group(2)[:19], fmt)


def partition_bounds(conn: Any) -> List[Tuple[str, Optional[Bound]]]:
    """(name, bounds) of every ``spans`` partition; bounds None for DEFAULT."""
    return [(row[0], parse_bounds(row[1])) for row in conn.execute(text(PARTITIONS_SQL))]


def overlaps(start: datetime, end: datetime, bounds: List[Bound]) -> bool:
    return any(lower < end and start < upper for lower, upper in bounds)


def ensure_month_partitions_between(engine: Engine, first: datetime, last: datetime) -> List[str]:
    """Cover [first, last] with ``spans`` partitions (PostgreSQL).

    Used to make room for historic rows (the ``migrate_spans`` backfill), so
    a month that no partition touches yet still gets one monthly partition
    rather than ~30 daily ones. A month partly covered already (the month in
    which daily partitions took over) gets daily partitions for its uncovered
    days up to ``last``, so the two forms never overlap.
    """
    if engine.dialect.name != "postgresql":
        return []
    created: List[str] = []
    with engine.begin() as conn:
        rows = partition_bounds(conn)
        names = {name for name, _ in rows}
        bounds = [b for _, b in rows if b]

        def create(name: str, start: datetime, end: datetime) -> None:
            conn.execute(
                text(f"CREATE TABLE {name} PARTITION OF spans FOR VALUES FROM (:s) TO (:e)").bindparams(s=start, e=end)
            )
            bounds.append((start, end))
            created.append(name)

        start = month_start(first)
        stop = month_start(last)
        last_day = day_start(last)
        while start <= stop:
            end = next_month(start)
            name = month_partition_name(start)
            if not overlaps(start, end, bounds) and name not in names:
                create(name, start, end)
            else:
                day = start
                while day < end and day <= last_day:
                    following = day + timedelta(days=1)
                    name = day_partition_name(day)
                    if not overlaps(day, following, bounds) and name not in names:
                        create(name, day, following)
                    day = following
            start = end
    return created
