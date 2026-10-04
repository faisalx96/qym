"""Review workflow history and the execution outcome kept during review.

``run_workflow_events`` is an append-only log of submit/approve/reject/
unapprove/unreject transitions (C012). ``approvals.execution_status`` keeps the
run's execution outcome while ``runs.status`` shows its review state, so
withdrawing a decision restores FAILED instead of reporting COMPLETED (C014).

Quick DDL only: a new empty table and a nullable column. Reviews started
before this revision have no stored outcome; it is resolved lazily from the
run's own ``run_completed`` event when a decision is withdrawn. Their last
submission and decision are copied from the approval row into the history
(``reconstructed``) by the first transition recorded after the upgrade.
"""

import sqlalchemy as sa
from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "run_workflow_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id",
            sa.String(length=36),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("from_status", sa.String(length=20), nullable=False),
        sa.Column("to_status", sa.String(length=20), nullable=False),
        sa.Column(
            "actor_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column(
            "reconstructed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_index(
        "ix_run_workflow_events_run", "run_workflow_events", ["run_id", "id"]
    )
    op.add_column(
        "approvals", sa.Column("execution_status", sa.String(length=20), nullable=True)
    )


def downgrade():
    op.drop_column("approvals", "execution_status")
    op.drop_index("ix_run_workflow_events_run", table_name="run_workflow_events")
    op.drop_table("run_workflow_events")
