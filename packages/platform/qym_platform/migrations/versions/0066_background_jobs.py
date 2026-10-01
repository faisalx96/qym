"""Shared background job state, so several web worker processes can serve one job.

Analyses, rule inference and product evals run inside the API process that
accepted them. With more than one web worker (``QYM_WEB_WORKERS``) the next
poll may reach another process, so each job publishes its snapshot to this
table. New empty table only (instant DDL).
"""

import sqlalchemy as sa
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None

ACTIVE_EXCLUSIVE = "active AND kind IN ('analysis', 'rule_inference')"


def upgrade():
    op.create_table(
        "background_jobs",
        sa.Column("id", sa.String(length=80), primary_key=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("scope_id", sa.String(length=255), nullable=True),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("pass_number", sa.Integer(), nullable=True),
        sa.Column("pass_key", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("process_id", sa.String(length=160), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_background_jobs_scope", "background_jobs", ["kind", "scope_id", "active"])
    op.create_index("ix_background_jobs_project", "background_jobs", ["kind", "project_id", "active"])
    op.create_index("ix_background_jobs_updated", "background_jobs", ["updated_at"])
    op.create_index(
        "ux_background_jobs_active_scope",
        "background_jobs",
        ["kind", "scope_id", "pass_key"],
        unique=True,
        postgresql_where=sa.text(ACTIVE_EXCLUSIVE),
        sqlite_where=sa.text(ACTIVE_EXCLUSIVE),
    )


def downgrade():
    op.drop_index("ux_background_jobs_active_scope", table_name="background_jobs")
    op.drop_index("ix_background_jobs_updated", table_name="background_jobs")
    op.drop_index("ix_background_jobs_project", table_name="background_jobs")
    op.drop_index("ix_background_jobs_scope", table_name="background_jobs")
    op.drop_table("background_jobs")
