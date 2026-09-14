"""Refresh retained dashboard records for execution errors and retry counts."""

import sqlalchemy as sa
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade():
    # Replay source rows through the bounded worker. Existing numeric records
    # are replaced by newer snapshots, so totals are not counted twice.
    # Failed partitions keep their operator-visible failure state.
    partitions = sa.table(
        "dashboard_partition_state",
        sa.column("queue_state"),
        sa.column("backfill_complete"),
        sa.column("backfill_kind"),
        sa.column("backfill_cursor"),
        sa.column("oldest_pending_event"),
        sa.column("updated_at"),
    )
    op.execute(
        partitions.update()
        .where(partitions.c.queue_state.in_(("ready", "pending", "backfill")))
        .values(
            queue_state="backfill",
            backfill_complete=False,
            backfill_kind="item",
            backfill_cursor=0,
            oldest_pending_event=sa.func.coalesce(
                partitions.c.oldest_pending_event, sa.func.current_timestamp()
            ),
            updated_at=sa.func.current_timestamp(),
        )
    )


def downgrade():
    # Retained source data and schemas are unchanged. A queued refresh can
    # also finish under the previous worker implementation.
    pass
