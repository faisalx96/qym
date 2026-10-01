"""Project review rules for corrections, and runs submitted on behalf of their owner.

- ``projects.correction_approvers``: who may approve, reject or reset
  diagnosis corrections, ``members`` (every project member, the behaviour so
  far) or ``managers`` (project managers and platform admins).
- ``projects.correction_require_different_reviewer``: when on, the person who
  wrote a correction cannot decide it. Off, as before.
- ``run_workflow_events.on_behalf_of_user_id``: the run owner when a manager
  or admin submitted the run for them (NULL otherwise).

Quick DDL only: two NOT NULL columns with a constant server default on the
small projects table and one nullable column on run_workflow_events. Postgres
11+ adds a column with a constant default without rewriting the table.
"""

import sqlalchemy as sa
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column(
            "correction_approvers",
            sa.String(20),
            nullable=False,
            server_default="members",
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "correction_require_different_reviewer",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "run_workflow_events",
        sa.Column("on_behalf_of_user_id", sa.String(36), nullable=True),
    )


def downgrade():
    with op.batch_alter_table("run_workflow_events") as batch:
        batch.drop_column("on_behalf_of_user_id")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("correction_require_different_reviewer")
        batch.drop_column("correction_approvers")
