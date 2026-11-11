"""Partial index for outbox retention: published dashboard events in source order (C074).

``prune_dashboard_events`` walks published rows of ``dashboard_change_events``
in ``source_version`` order. The table can be large on production (about 2 GB
measured), so there the index is built CONCURRENTLY by a maintenance job.

Revision ID: 0093
Revises: 0092
"""

import sqlalchemy as sa
from alembic import op

from qym_platform.db.migration_helpers import enqueue_job, is_large

revision = "0093"
down_revision = "0092"
branch_labels = None
depends_on = None

INDEXES = [
    {
        "name": "ix_dashboard_event_published",
        "table": "dashboard_change_events",
        "columns": ["source_version"],
        "where": "published_at IS NOT NULL",
    },
]


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and is_large(bind, "dashboard_change_events", 256 * 1024 * 1024):
        enqueue_job(
            bind,
            "create_deferred_indexes",
            {"indexes": INDEXES},
            note="queued by migration 0093: dashboard_change_events too large to index during startup",
        )
        return
    for spec in INDEXES:
        where = sa.text(spec["where"])
        kwargs = {"postgresql_where": where} if bind.dialect.name == "postgresql" else {"sqlite_where": where}
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
