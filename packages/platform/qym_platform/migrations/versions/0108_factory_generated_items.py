"""The generated items of a factory job, with their review.

``factory_generated_items`` keeps, per generation job, one row per item it
wrote: the layer, the parent and base items, the rule applied at that step
and the review state (``pending`` | ``approved`` | ``rejected``), so the
Generation tab draws the layers and reviews the items without reading every
item's metadata. Rows go with their job (``ON DELETE CASCADE``). Items of
jobs run before this migration are not backfilled: their attempt pages show
the counts from the job's progress and no item to review. Quick DDL.

Revision ID: 0108
Revises: 0107
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0108"
down_revision = "0107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "factory_generated_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("factory_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "factory_id",
            sa.String(length=36),
            sa.ForeignKey("data_factories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("dataset_version_id", sa.String(length=36), nullable=False),
        sa.Column("item_id", sa.String(length=200), nullable=False),
        sa.Column("base_item_id", sa.String(length=200), nullable=False),
        sa.Column("parent_item_id", sa.String(length=200), nullable=False),
        sa.Column("layer", sa.Integer(), nullable=False),
        sa.Column("rule_id", sa.String(length=36), nullable=True),
        sa.Column(
            "rule_title",
            sa.String(length=300),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "review",
            sa.String(length=16),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "reviewed_by_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "job_id", "item_id", name="uq_factory_generated_items_job_item"
        ),
    )
    op.create_index(
        "ix_factory_generated_items_job_id", "factory_generated_items", ["job_id"]
    )
    op.create_index(
        "ix_factory_generated_items_factory_id",
        "factory_generated_items",
        ["factory_id"],
    )
    op.create_index(
        "ix_factory_generated_items_job_layer",
        "factory_generated_items",
        ["job_id", "layer"],
    )
    op.create_index(
        "ix_factory_generated_items_job_review",
        "factory_generated_items",
        ["job_id", "review"],
    )


def downgrade() -> None:
    op.drop_table("factory_generated_items")
