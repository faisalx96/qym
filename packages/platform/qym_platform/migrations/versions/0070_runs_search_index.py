"""Trigram index for the Runs search box (C060).

The Runs list searches run names and ids (``q``) with a substring match over
each run's shown name and run name. ``ix_dashboard_run_dimensions_search_trgm``
indexes that text with pg_trgm. The index is built CONCURRENTLY by the
``build_runs_search_index`` maintenance job queued here, so this migration is
one insert. Where pg_trgm cannot be created, the job logs that the index was
skipped and finishes; the search works without the index, as before.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade():
    now = datetime.utcnow()
    op.execute(
        sa.text(
            "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
            "VALUES (:id, 'build_runs_search_index', 'queued', :params, '{}', :log, :now, :now)"
        ).bindparams(
            id=str(uuid4()),
            params=json.dumps({}),
            log="queued by migration 0070: build the trigram index for the Runs search",
            now=now,
        )
    )


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_dashboard_run_dimensions_search_trgm")
