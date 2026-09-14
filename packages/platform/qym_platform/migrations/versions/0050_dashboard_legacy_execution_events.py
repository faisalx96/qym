"""Backfill numeric legacy execution evidence without invalidating published data."""

import sqlalchemy as sa
from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade():
    partitions = sa.table(
        "dashboard_partition_state",
        sa.column("queue_state"),
        sa.column("backfill_complete"),
        sa.column("backfill_kind"),
        sa.column("backfill_cursor"),
        sa.column("oldest_pending_event"),
        sa.column("updated_at"),
    )
    # In-progress 0049 scans retain their cursor and will visit the new event
    # stage after attempts. Completed scans only need the new numeric evidence.
    # Keep published summaries and operator-visible failure states intact.
    op.execute(
        partitions.update()
        .where(
            partitions.c.backfill_complete.is_(True),
            partitions.c.queue_state.in_(("ready", "pending", "backfill")),
        )
        .values(
            queue_state="backfill",
            backfill_complete=False,
            backfill_kind="event",
            backfill_cursor=0,
            oldest_pending_event=sa.func.coalesce(
                partitions.c.oldest_pending_event, sa.func.current_timestamp()
            ),
            updated_at=sa.func.current_timestamp(),
        )
    )


def downgrade():
    # Remove only derived legacy evidence. Source events remain available.
    for table in ("dashboard_change_events", "dashboard_record_state"):
        op.execute(
            sa.text(
                f"DELETE FROM {table} WHERE record_kind = 'attempt' AND substr(metric_key, 1, 13) = 'legacy_event:'"
            )
        )
    op.execute(
        sa.text(
            "UPDATE dashboard_partition_state SET backfill_kind = 'item', backfill_cursor = 0, backfill_complete = false, queue_state = 'backfill' WHERE backfill_kind = 'event' AND queue_state <> 'repair_required'"
        )
    )
