"""Partial indexes that let bucket extrema repair read MIN/MAX from an index.

``dashboard_record_state`` holds one row per item/score/attempt of every run
(millions on production), so the indexes are built CONCURRENTLY by a
maintenance job when the table is large.
"""

import sqlalchemy as sa
from alembic import op

from qym_platform.db.migration_helpers import enqueue_job, is_large

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None

INDEXES = [
    {"name": "ix_dashboard_record_item_latency", "table": "dashboard_record_state", "columns": ["project_key", "bucket_key", "latency_ms"], "where": "present AND record_kind = 'item'"},
    {"name": "ix_dashboard_record_score_value", "table": "dashboard_record_state", "columns": ["project_key", "bucket_key", "score"], "where": "present AND record_kind = 'score'"},
]


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and is_large(bind, "dashboard_record_state", 256 * 1024 * 1024):
        enqueue_job(bind, "create_deferred_indexes", {"indexes": INDEXES}, note="queued by migration 0055: dashboard_record_state too large to index during startup")
        return
    for spec in INDEXES:
        kwargs = {"postgresql_where": sa.text(spec["where"])} if bind.dialect.name == "postgresql" else {"sqlite_where": sa.text(spec["where"])}
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
