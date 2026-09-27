"""Metric semantics: declared direction and primary metric; reclassify errors.

C008: ``run_metric_specs.direction`` becomes nullable (NULL = the metric
declared no direction and is shown neutrally) and ``is_primary`` records the
run's declared headline metric. Both are metadata-only DDL on PostgreSQL.

C010: only ``meta.status`` marks a scorer error now. Dashboard numbers already
published for runs whose metrics stored a verdict reason in ``meta.error``
still count those reasons as errors, so a ``reclassify_metric_errors``
maintenance job is queued to rebuild just those runs in the background.
Nothing heavy runs here: the job scans score rows in bounded id windows.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("run_metric_specs") as batch:
        batch.alter_column(
            "direction",
            existing_type=sa.String(length=20),
            nullable=True,
            server_default=None,
            existing_server_default="maximize",
        )
        batch.add_column(sa.Column("is_primary", sa.Boolean(), nullable=True))

    bind = op.get_bind()
    has_scores = bind.execute(sa.text("SELECT 1 FROM run_item_scores LIMIT 1")).first()
    if has_scores:
        now = datetime.utcnow()
        op.execute(
            sa.text(
                "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
                "VALUES (:id, 'reclassify_metric_errors', 'queued', :params, '{}', :log, :now, :now)"
            ).bindparams(
                id=str(uuid4()),
                params=json.dumps({}),
                log="queued by migration 0063: verdict reasons are no longer scorer errors",
                now=now,
            )
        )


def downgrade():
    # The queued job only requests dashboard rebuilds; nothing to undo there.
    # Undeclared directions fall back to the old default.
    op.execute(
        sa.text("UPDATE run_metric_specs SET direction = 'maximize' WHERE direction IS NULL")
    )
    with op.batch_alter_table("run_metric_specs") as batch:
        batch.drop_column("is_primary")
        batch.alter_column(
            "direction",
            existing_type=sa.String(length=20),
            nullable=False,
            server_default="maximize",
        )
