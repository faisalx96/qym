"""Live chart images attached to live turns.

One new empty table (quick DDL, no backfill).

Revision ID: 0099
Revises: 0098
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def _big_id() -> sa.types.TypeEngine:
    return sa.Integer().with_variant(sa.BigInteger(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "live_chart_images",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "turn_pk",
            _big_id(),
            sa.ForeignKey("live_turns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ref", sa.String(100), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("turn_pk", "ref", name="uq_live_chart_image"),
    )
    op.create_index("ix_live_chart_images_turn_pk", "live_chart_images", ["turn_pk"])


def downgrade() -> None:
    op.drop_index("ix_live_chart_images_turn_pk", table_name="live_chart_images")
    op.drop_table("live_chart_images")
