"""BigInteger ids for run_events/spans and jsonb for large JSON columns.

``ALTER COLUMN ... TYPE`` rewrites the table under an ACCESS EXCLUSIVE lock, so
on PostgreSQL each table is converted inline only when it is small (< 1 GiB);
otherwise an ``alter_column_types`` maintenance job is queued and the worker
performs the rewrite during a maintenance window. SQLite keeps its types
(the models use ``with_variant`` so nothing changes there).
"""

import sqlalchemy as sa
from alembic import op

from qym_platform.db.migration_helpers import (
    COLUMN_TYPE_CONVERSIONS,
    column_type_statements,
    enqueue_job,
    is_large,
)

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    deferred = []
    for table in COLUMN_TYPE_CONVERSIONS:
        if is_large(bind, table):
            deferred.append(table)
            continue
        for stmt in column_type_statements(table):
            op.execute(sa.text(stmt))
    if deferred:
        enqueue_job(
            bind,
            "alter_column_types",
            {"tables": deferred},
            note="paused by migration 0052: tables too large to rewrite during startup: " + ", ".join(deferred) + ". Run reclaim_run_events first, then Start this in maintenance mode.",
            paused=True,
        )


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in COLUMN_TYPE_CONVERSIONS:
        for stmt in column_type_statements(table, downgrade=True):
            op.execute(sa.text(stmt))
