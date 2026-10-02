"""Dashboard projection: filterable run versioning (any ``versioning_metadata`` key).

Adds ``dashboard_run_versions``: one row per run and versioning key, with the
normalized string value (``services/run_versioning.py``). The dashboard worker
maintains it next to ``dashboard_run_dimensions``; the run list, the CLI and the
experiments list filter through it.

No data is copied here. The worker's shape reconcile requeues every run linked to
an experiment job whose descriptor predates ``versioning``, and republishing the
run fills both the descriptor and this table.

Like the other dashboard projection tables it has no foreign keys; the retention
purge deletes its rows with the run's other projection rows.

Revision ID: 0066
Revises: 0065
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None

TABLE = "dashboard_run_versions"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("run_key", sa.String(length=36), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("project_key", sa.String(length=36), nullable=False),
        sa.Column("value", sa.String(length=500), nullable=False),
        sa.PrimaryKeyConstraint("run_key", "key"),
    )
    op.create_index("ix_dashboard_run_versions_key_value", TABLE, ["key", "value"])
    op.create_index(
        "ix_dashboard_run_versions_project_key",
        TABLE,
        ["project_key", "key", "value"],
    )


def downgrade() -> None:
    op.drop_index("ix_dashboard_run_versions_project_key", table_name=TABLE)
    op.drop_index("ix_dashboard_run_versions_key_value", table_name=TABLE)
    op.drop_table(TABLE)
