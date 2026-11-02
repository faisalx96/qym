"""Daily ``spans`` partitions from today on.

``spans`` was partitioned monthly (``spans_yYYYYmMM``) and migration 0053 /
the hourly retention pass kept about three months created ahead. From now on
partitions are daily (``spans_yYYYYmMMdDD``, see services/retention.py), so
retention drops a day at a time instead of a month.

Existing monthly partitions stay: those holding data (the current month and
history) keep working until retention drops them once their whole month is
past the window. Monthly partitions that start after today are still empty
(spans are keyed by their run's creation time); they are dropped here so
daily partitions take over from the next month instead of after the
pre-created ones run out. Each is locked and checked for rows first; one that
holds rows is kept, and daily partitions simply start after it.

Then daily partitions are created for today through 14 days ahead, skipping
any day an existing partition covers. The hourly retention pass extends them
(``QYM_SPAN_PARTITION_DAYS_AHEAD``).

Downgrade leaves the daily partitions in place: they remain valid partitions
of ``spans``. The older code's retention pass would then fail to create a
monthly partition overlapping them and log it; recreate monthly ones by hand
if you need to run that code for long.

Revision ID: 0085
Revises: 0084
"""

from __future__ import annotations

from datetime import datetime, timedelta

import sqlalchemy as sa
from alembic import op

from qym_platform.migrations_support import (
    day_partition_name,
    day_start,
    overlaps,
    partition_bounds,
)

revision = "0085"
down_revision = "0084"
branch_labels = None
depends_on = None

DAYS_AHEAD = 14


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    today = day_start(datetime.utcnow())

    future_months = [
        name
        for name, bounds in partition_bounds(bind)
        if bounds and bounds[0] > today and bounds[1] - bounds[0] > timedelta(days=1)
    ]
    if future_months:
        # DETACH needs ACCESS EXCLUSIVE on ``spans`` anyway; taking it first
        # (parent before partition, the order inserts use) means no row can
        # land between the emptiness check and the drop, without deadlocking
        # against a concurrent insert. Held only for this short transaction.
        bind.execute(sa.text("LOCK TABLE spans IN ACCESS EXCLUSIVE MODE"))
        for name in future_months:
            if bind.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {name})")).scalar():
                continue
            bind.execute(sa.text(f"ALTER TABLE spans DETACH PARTITION {name}"))
            bind.execute(sa.text(f"DROP TABLE {name}"))

    rows = partition_bounds(bind)
    names = {name for name, _ in rows}
    bounds = [b for _, b in rows if b]
    start = today
    for _ in range(DAYS_AHEAD + 1):
        end = start + timedelta(days=1)
        name = day_partition_name(start)
        if name not in names and not overlaps(start, end, bounds):
            bind.execute(
                sa.text(f"CREATE TABLE {name} PARTITION OF spans FOR VALUES FROM (:s) TO (:e)").bindparams(
                    s=start, e=end
                )
            )
            bounds.append((start, end))
        start = end


def downgrade():
    pass
