"""Indexed dataset item search, stored lineage counts, who deleted a dataset.

C031: ``dataset_items.search_text`` holds each item's normalized item ID,
input, expected output and metadata, written on every insert and update, so a
search is a substring match a pg_trgm index can serve. C033:
``dataset_versions.change_counts`` stores a published version's added /
modified / deleted / unchanged counts against its parent, so the Lineage tab
stops diffing whole versions per request. C066: ``datasets.deleted_by_user_id``
names who deleted a dataset in Deleted datasets.

All three columns are nullable (instant DDL). Existing rows are filled by the
``backfill_dataset_search_text`` maintenance job queued here, which also builds
the trigram index CONCURRENTLY at the end; until it reaches a row, search and
lineage compute that row's values on read, as before.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dataset_items", sa.Column("search_text", sa.Text(), nullable=True))
    op.add_column("dataset_versions", sa.Column("change_counts", sa.JSON(), nullable=True))
    op.add_column("datasets", sa.Column("deleted_by_user_id", sa.String(length=36), nullable=True))
    bind = op.get_bind()
    has_items = bind.execute(sa.text("SELECT 1 FROM dataset_items LIMIT 1")).first()
    if has_items:
        now = datetime.utcnow()
        op.execute(
            sa.text(
                "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
                "VALUES (:id, 'backfill_dataset_search_text', 'queued', :params, '{}', :log, :now, :now)"
            ).bindparams(
                id=str(uuid4()),
                params=json.dumps({}),
                log="queued by migration 0068: fill dataset item search text and lineage counts, then index search",
                now=now,
            )
        )


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_dataset_items_search_trgm")
    op.drop_column("datasets", "deleted_by_user_id")
    op.drop_column("dataset_versions", "change_counts")
    op.drop_column("dataset_items", "search_text")
