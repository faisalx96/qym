"""Repair repeat runs whose failed passes the dashboard never saw.

C011: Execution success now counts repeat-run item passes. Live ingest stored
item events without projecting them, so a pass that failed only through an
``item_failed`` event (no failed final attempt) is missing from published task
errors and execution success. New events are projected as they arrive; this
queues a ``project_item_failure_events`` maintenance job that walks repeat runs
in bounded windows and rebuilds only the affected runs. No DDL.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    has_repeat_runs = bind.execute(
        sa.text("SELECT 1 FROM runs WHERE samples > 1 LIMIT 1")
    ).first()
    if has_repeat_runs:
        now = datetime.utcnow()
        op.execute(
            sa.text(
                "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
                "VALUES (:id, 'project_item_failure_events', 'queued', :params, '{}', :log, :now, :now)"
            ).bindparams(
                id=str(uuid4()),
                params=json.dumps({}),
                log="queued by migration 0064: count repeat-run passes that failed only through item_failed",
                now=now,
            )
        )


def downgrade():
    # The queued job only requests dashboard rebuilds; nothing to undo.
    pass
