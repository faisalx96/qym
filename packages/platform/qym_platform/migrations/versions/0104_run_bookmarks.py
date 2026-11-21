"""Run bookmarks.

One new empty table (quick DDL, no backfill): ``run_bookmarks``, a user's
bookmark of a run with a markdown note, private to its author or public to
the project's members, optionally pinned to the top of the project's
bookmark list. Rows go with their run (``ON DELETE CASCADE``) and user.

Revision ID: 0104
Revises: 0103
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "run_bookmarks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "visibility", sa.String(10), nullable=False, server_default="private"
        ),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pinned_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "user_id", name="uq_run_bookmarks_run_user"),
    )
    op.create_index("ix_run_bookmarks_project_id", "run_bookmarks", ["project_id"])
    op.create_index("ix_run_bookmarks_user_id", "run_bookmarks", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_run_bookmarks_user_id", table_name="run_bookmarks")
    op.drop_index("ix_run_bookmarks_project_id", table_name="run_bookmarks")
    op.drop_table("run_bookmarks")
