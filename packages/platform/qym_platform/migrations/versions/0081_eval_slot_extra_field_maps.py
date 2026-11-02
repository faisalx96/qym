"""Eval model slots: ``extra_field_maps``.

One model slot (a named group) can fill several sets of LLM keys: ``field_map``
is the first set and ``extra_field_maps`` holds the others, each shaped like
``field_map`` (``model`` required, ``base_url`` / ``api_key`` optional). A model
bound to the slot is written into every set.

Revision ID: 0081
Revises: 0080
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0081"
down_revision = "0080"
branch_labels = None
depends_on = None

BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "eval_model_slots",
        sa.Column("extra_field_maps", BIG_JSON, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    with op.batch_alter_table("eval_model_slots") as batch_op:
        batch_op.drop_column("extra_field_maps")
