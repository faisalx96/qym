"""Service split: a job queue in ``background_jobs`` and workers heartbeats.

With ``QYM_SERVICE=main`` analyses, rule inference and product evals are not
run by the HTTP process: it inserts a ``queued`` row with the job's
``payload`` and a workers process claims it (``claimed_by``/``claimed_at``,
lease = ``heartbeat_at``). ``service_heartbeats`` lets the admin page show
whether the workers service is alive.

``background_jobs`` is small (finished rows are pruned after 7 days): adding
NOT NULL columns with a constant default is metadata-only on PostgreSQL 11+,
and the partial index covers only queued rows, so no CONCURRENTLY is needed.
The new table starts empty.

Revision ID: 0083
Revises: 0082
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0083"
down_revision = "0082"
branch_labels = None
depends_on = None

QUEUED_WHERE = "queued AND active"


def upgrade() -> None:
    with op.batch_alter_table("background_jobs") as batch_op:
        batch_op.add_column(
            sa.Column("queued", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column("payload", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column("claimed_by", sa.String(length=160), nullable=True)
        )
        batch_op.add_column(sa.Column("claimed_at", sa.DateTime(), nullable=True))
    op.create_index(
        "ix_background_jobs_queue",
        "background_jobs",
        ["kind", "created_at"],
        postgresql_where=sa.text(QUEUED_WHERE),
        sqlite_where=sa.text(QUEUED_WHERE),
    )
    op.create_table(
        "service_heartbeats",
        sa.Column("id", sa.String(length=160), primary_key=True),
        sa.Column("service", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=False),
        sa.Column("info", sa.JSON(), nullable=False),
    )
    op.create_index(
        "ix_service_heartbeats_service",
        "service_heartbeats",
        ["service", "heartbeat_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_service_heartbeats_service", table_name="service_heartbeats")
    op.drop_table("service_heartbeats")
    op.drop_index("ix_background_jobs_queue", table_name="background_jobs")
    with op.batch_alter_table("background_jobs") as batch_op:
        batch_op.drop_column("claimed_at")
        batch_op.drop_column("claimed_by")
        batch_op.drop_column("payload")
        batch_op.drop_column("queued")
