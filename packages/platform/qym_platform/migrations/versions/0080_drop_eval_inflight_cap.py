"""Eval environments: drop ``max_inflight_jobs``.

The platform no longer caps in-flight jobs per environment: the Evaluation
Service limits concurrent runs and queues the rest itself, so the dispatcher
submits every queued job as soon as it is ready.

Revision ID: 0080
Revises: 0079
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0080"
down_revision = "0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("eval_environments") as batch_op:
        batch_op.drop_constraint(
            "ck_eval_environments_max_inflight_jobs", type_="check"
        )
        batch_op.drop_column("max_inflight_jobs")


def downgrade() -> None:
    with op.batch_alter_table("eval_environments") as batch_op:
        batch_op.add_column(
            sa.Column(
                "max_inflight_jobs", sa.Integer(), nullable=False, server_default="5"
            )
        )
        batch_op.create_check_constraint(
            "ck_eval_environments_max_inflight_jobs", "max_inflight_jobs >= 1"
        )
