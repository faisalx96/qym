"""Refresh published error counts from existing numeric projection records."""

import sqlalchemy as sa
from alembic import op

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade():
    partitions = sa.table(
        "dashboard_partition_state",
        sa.column("queue_state"),
        sa.column("backfill_complete"),
        sa.column("updated_at"),
    )
    # Preserve publications, active backfills and operator-visible failures.
    # The worker can refresh this derived shape without rescanning source data.
    op.execute(
        partitions.update()
        .where(
            partitions.c.backfill_complete.is_(True),
            partitions.c.queue_state == "ready",
        )
        .values(queue_state="pending", updated_at=sa.func.current_timestamp())
    )


def downgrade():
    # Extra summary fields are compatible with the previous application.
    pass
