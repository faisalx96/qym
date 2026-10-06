"""Dataset read tokens: admin-issued, per-project service tokens.

A token is sent next to a user's API key on dataset item reads (header
``X-Qym-Dataset-Read-Token``) and lets that read see a private test set's
items in the token's project. It never identifies a user and grants nothing
else. Only the PBKDF2 hash is stored.

Revision ID: 0070
Revises: 0069
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dataset_read_tokens",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("prefix", sa.String(length=16), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_dataset_read_tokens_project_id", "dataset_read_tokens", ["project_id"])
    op.create_index("ix_dataset_read_tokens_prefix", "dataset_read_tokens", ["prefix"])
    op.create_index(
        "ix_dataset_read_tokens_created_by_user_id", "dataset_read_tokens", ["created_by_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_dataset_read_tokens_created_by_user_id", table_name="dataset_read_tokens")
    op.drop_index("ix_dataset_read_tokens_prefix", table_name="dataset_read_tokens")
    op.drop_index("ix_dataset_read_tokens_project_id", table_name="dataset_read_tokens")
    op.drop_table("dataset_read_tokens")
