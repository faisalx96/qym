"""Datasets: per-dataset access (``access_mode``, ``dataset_grants``) and item state.

- ``datasets.access_mode``: ``'project'`` (default, every member) or ``'restricted'``.
- ``dataset_grants``: per-user ``view`` / ``modify`` grants, kept when the mode is
  switched back to ``project``.
- ``dataset_items.disabled_at / disabled_by_user_id / disabled_reason``: a per-row
  flag edited in drafts only, plus the index ``(dataset_version_id, disabled_at)``.

Columns carry constant defaults only, so this is quick DDL on both dialects.

Revision ID: 0087
Revises: 0086
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0087"
down_revision = "0086"
branch_labels = None
depends_on = None

INDEX = "ix_dataset_items_version_disabled"


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column("access_mode", sa.String(length=16), nullable=False, server_default="project"),
    )
    op.create_table(
        "dataset_grants",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "dataset_id",
            sa.String(length=36),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column(
            "granted_by_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("dataset_id", "user_id", name="uq_dataset_grant_user"),
    )
    op.create_index("ix_dataset_grants_dataset_id", "dataset_grants", ["dataset_id"])
    op.create_index("ix_dataset_grants_user_id", "dataset_grants", ["user_id"])

    op.add_column("dataset_items", sa.Column("disabled_at", sa.DateTime(), nullable=True))
    op.add_column(
        "dataset_items", sa.Column("disabled_by_user_id", sa.String(length=36), nullable=True)
    )
    op.add_column(
        "dataset_items",
        sa.Column("disabled_reason", sa.String(length=500), nullable=False, server_default=""),
    )
    op.create_index(INDEX, "dataset_items", ["dataset_version_id", "disabled_at"])


def downgrade() -> None:
    op.drop_index(INDEX, table_name="dataset_items")
    with op.batch_alter_table("dataset_items") as batch:
        batch.drop_column("disabled_reason")
        batch.drop_column("disabled_by_user_id")
        batch.drop_column("disabled_at")
    op.drop_index("ix_dataset_grants_user_id", table_name="dataset_grants")
    op.drop_index("ix_dataset_grants_dataset_id", table_name="dataset_grants")
    op.drop_table("dataset_grants")
    with op.batch_alter_table("datasets") as batch:
        batch.drop_column("access_mode")
