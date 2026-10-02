"""Stored search text for the Runs search box (C060, final review).

0070's ``ix_dashboard_run_dimensions_search_trgm`` indexed expressions over
``dashboard_run_dimensions.descriptor``. The summary worker rewrites a live
run's descriptor on every publication (its last event moves), and an index
over the descriptor made each of those updates a non-HOT update: a new entry
in every index of the table, and a growing GIN pending list.

``dashboard_run_dimensions.search_text`` (nullable, instant DDL) holds the
text the search matches; the worker writes it with the descriptor, and it
changes only when a run's names do, so the descriptor-only updates stay HOT.
The ``build_runs_search_index`` job is queued again (unless one is still
waiting): it fills the column for existing rows, builds the partial index of
rows still without it, and rebuilds the trigram index over the column,
CONCURRENTLY. Until the job reaches a row, the search reads that row's names
from its descriptor, with the same results.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dashboard_run_dimensions", sa.Column("search_text", sa.Text(), nullable=True))
    # A job 0070 queued that has not started yet runs this release's code,
    # which does all of the above: one job is enough.
    now = datetime.utcnow()
    op.execute(
        sa.text(
            "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
            "SELECT :id, 'build_runs_search_index', 'queued', :params, '{}', :log, :now, :now "
            "WHERE NOT EXISTS (SELECT 1 FROM maintenance_jobs "
            "WHERE kind = 'build_runs_search_index' AND status IN ('queued', 'paused'))"
        ).bindparams(
            id=str(uuid4()),
            params=json.dumps({}),
            log="queued by migration 0071: store each run's search text, then rebuild the Runs search index over it",
            now=now,
        )
    )


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_dashboard_run_dimensions_search_trgm")
        op.execute("DROP INDEX IF EXISTS ix_dashboard_run_dimensions_unsearchable")
    op.drop_column("dashboard_run_dimensions", "search_text")
