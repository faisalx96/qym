"""Evaluation Service: one-time run link marker.

``eval_experiment_jobs.run_linked_at`` (nullable ``DateTime``) records when ingest
linked a run to the job (plan §11). ``run_id`` is ``ON DELETE SET NULL``, so after a
hard delete of the linked run ``run_id IS NULL`` alone would make the job linkable
again and a replayed launch token could relink it. The guarded claim in
``services/eval_run_linking.py`` also requires ``run_linked_at IS NULL``, and the
marker is never cleared.

Existing linked jobs are backfilled with ``updated_at`` as their link time, so a
job whose run is deleted after the upgrade stays closed too.

Revision ID: 0064
Revises: 0063
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None

JOBS = "eval_experiment_jobs"


def upgrade() -> None:
    op.add_column(JOBS, sa.Column("run_linked_at", sa.DateTime(), nullable=True))
    op.execute(
        sa.text(
            f"UPDATE {JOBS} SET run_linked_at = updated_at "
            "WHERE run_id IS NOT NULL AND run_linked_at IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column(JOBS, "run_linked_at")
