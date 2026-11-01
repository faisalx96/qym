"""Covering indexes for the numbers of pass scores and spans (C073).

Pass-score rows average 1.6 KB (the judge explanation and meta sit beside the
number) and span rows 2.5 KB (the attributes JSON), so a cold read of a run's
numbers touched about 30x more pages than it needs. With these indexes the
reads of /passes, /group-metrics, step latency and compare become index-only
scans. Large tables (production) get them CONCURRENTLY from a maintenance job,
which also vacuums the finished span partitions (an index-only scan needs
their visibility map).

Revision ID: 0096
Revises: 0095
"""

import sqlalchemy as sa
from alembic import op

from qym_platform.db.migration_helpers import (
    COVERING_SCORE_INDEX,
    COVERING_SPAN_INDEX,
    enqueue_job,
    table_bytes,
)

revision = "0096"
down_revision = "0095"
branch_labels = None
depends_on = None

INLINE_LIMIT = 256 * 1024 * 1024
INDEXES = [COVERING_SCORE_INDEX, COVERING_SPAN_INDEX]


def _bytes(bind, table: str) -> int:
    """A table's size; for a partitioned table, the sum of its partitions."""
    if bind.dialect.name != "postgresql":
        return 0
    partitions = bind.execute(
        sa.text(
            "SELECT coalesce(sum(pg_total_relation_size(i.inhrelid)), 0) FROM pg_inherits i "
            "WHERE i.inhparent = to_regclass(:t)"
        ),
        {"t": table},
    ).scalar()
    return int(partitions or 0) + table_bytes(bind, table)


def upgrade():
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    deferred = [spec for spec in INDEXES if postgres and _bytes(bind, spec["table"]) > INLINE_LIMIT]
    if deferred:
        enqueue_job(
            bind,
            "create_deferred_indexes",
            {"indexes": deferred},
            note="queued by migration 0096: tables too large to index during startup",
        )
    for spec in INDEXES:
        if spec in deferred:
            continue
        kwargs = {"postgresql_include": spec["include"]} if postgres else {}
        # On a partitioned table, CREATE INDEX builds the index on every partition.
        op.create_index(spec["name"], spec["table"], spec["columns"], **kwargs)


def downgrade():
    bind = op.get_bind()
    for spec in INDEXES:
        if bind.dialect.name == "postgresql":
            op.execute(sa.text(f"DROP INDEX IF EXISTS {spec['name']}"))
        else:
            existing = {ix["name"] for ix in sa.inspect(bind).get_indexes(spec["table"])}
            if spec["name"] in existing:
                op.drop_index(spec["name"], table_name=spec["table"])
