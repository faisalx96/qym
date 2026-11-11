"""Idempotency keys for run creation (C190).

One new empty table (instant DDL): ``POST /v1/runs`` with an ``Idempotency-Key``
header stores the key with the run it created, so a client that retries after a
timeout gets the same run back, not a second one. Keys are kept 24 hours.

Revision ID: 0095
Revises: 0094
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0095"
down_revision = "0094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "run_create_keys",
        sa.Column("project_id", sa.String(36), primary_key=True),
        sa.Column("idempotency_key", sa.String(200), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_run_create_keys_created_at", "run_create_keys", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_run_create_keys_created_at", table_name="run_create_keys")
    op.drop_table("run_create_keys")
