"""Stored step-latency summaries (C022).

One new empty table (instant DDL): the run page's step-latency summary of a run
(or one pass), stored the first time it is read, so later reads skip the scan
of every raw span. ``fingerprint`` names the span set it was built from; a late
span or a removed pass changes it, and the next read builds the summary again.

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


def _json() -> sa.types.TypeEngine:
    from sqlalchemy.dialects import postgresql

    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "run_step_latency_summaries",
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # 0 = every pass of the run
        sa.Column("pass_number", sa.Integer(), primary_key=True),
        sa.Column("rollup", sa.String(8), primary_key=True),
        sa.Column("fingerprint", sa.String(200), nullable=False),
        sa.Column("payload", _json(), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("run_step_latency_summaries")
