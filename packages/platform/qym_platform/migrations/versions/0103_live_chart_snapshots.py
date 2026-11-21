"""Live chart snapshots and their stylesheets.

A snapshot is the drawn chart of a live turn as compressed HTML text; the
stylesheet it needs is stored once per source and content hash. Two new empty
tables (quick DDL, no backfill).

Revision ID: 0103
Revises: 0102
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0103"
down_revision = "0102"
branch_labels = None
depends_on = None


def _big_id() -> sa.types.TypeEngine:
    return sa.Integer().with_variant(sa.BigInteger(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "live_chart_snapshots",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "turn_pk",
            _big_id(),
            sa.ForeignKey("live_turns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ref", sa.String(100), nullable=False),
        sa.Column("html", sa.LargeBinary(), nullable=False),
        sa.Column("html_size", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("style_sha256", sa.String(64), nullable=False),
        sa.Column("viewport_width", sa.Integer(), nullable=False),
        sa.Column("viewport_height", sa.Integer(), nullable=True),
        sa.Column("box_x", sa.Integer(), nullable=False),
        sa.Column("box_y", sa.Integer(), nullable=False),
        sa.Column("box_width", sa.Integer(), nullable=False),
        sa.Column("box_height", sa.Integer(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("turn_pk", "ref", name="uq_live_chart_snapshot"),
    )
    op.create_index(
        "ix_live_chart_snapshots_turn_pk", "live_chart_snapshots", ["turn_pk"]
    )
    op.create_index(
        "ix_live_chart_snapshots_style_sha256", "live_chart_snapshots", ["style_sha256"]
    )
    op.create_table(
        "live_chart_styles",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "source_id",
            sa.String(36),
            sa.ForeignKey("live_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("css", sa.LargeBinary(), nullable=False),
        sa.Column("css_size", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("source_id", "sha256", name="uq_live_chart_style"),
    )


def downgrade() -> None:
    op.drop_table("live_chart_styles")
    op.drop_index(
        "ix_live_chart_snapshots_style_sha256", table_name="live_chart_snapshots"
    )
    op.drop_index("ix_live_chart_snapshots_turn_pk", table_name="live_chart_snapshots")
    op.drop_table("live_chart_snapshots")
