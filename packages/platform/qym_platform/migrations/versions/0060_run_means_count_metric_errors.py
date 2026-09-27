"""Republish run means with scorer errors counted as 0 (C015)."""

import sqlalchemy as sa
from alembic import op

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade():
    partitions = sa.table(
        "dashboard_partition_state",
        sa.column("queue_state"),
        sa.column("backfill_complete"),
        sa.column("updated_at"),
    )
    # Means are rebuilt from the existing numeric records, which already carry
    # each scorer error; the worker refreshes summaries without rescanning
    # source data. Active backfills and operator-visible failures are kept.
    op.execute(
        partitions.update()
        .where(
            partitions.c.backfill_complete.is_(True),
            partitions.c.queue_state == "ready",
        )
        .values(queue_state="pending", updated_at=sa.func.current_timestamp())
    )


def downgrade():
    # The extra summary field is compatible with the previous application.
    pass
