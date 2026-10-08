"""Datasets: ``private_test_set`` flag.

A private test set's item contents (dataset items, and the inputs, expected
values, outputs and traces of runs evaluated against it) are visible to
platform admins only. Everyone else keeps seeing the dataset, its versions and
run scores.

Revision ID: 0079
Revises: 0078
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0079"
down_revision = "0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "private_test_set",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "private_test_set")
