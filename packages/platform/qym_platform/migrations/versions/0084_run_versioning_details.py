"""Runs and experiments: free-form ``versioning_details``.

``runs.versioning_details`` holds the JSON object the run's creator sent at
``POST /v1/runs`` (``EvaluatorConfig.versioning_details``, the CLI's
``--versioning-detail``), merged with the launching experiment's
``eval_experiments.versioning_details`` when ingest links an official run.
Unlike the Evaluation Service's ``versioning_metadata`` (0078) it is shown, not
filtered, so it has no projection table or index.

Both columns are nullable without a default: adding them is metadata-only on
PostgreSQL and SQLite, and existing rows read as ``{}``. No data is copied.

Revision ID: 0084
Revises: 0083
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None

TABLES = ("runs", "eval_experiments")
COLUMN = "versioning_details"


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    for table in reversed(TABLES):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_column(COLUMN)
