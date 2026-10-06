"""Overview inputs per run and a shared overview cache (C037).

``dashboard_run_overview`` holds each run's overview inputs, read once from
its descriptor and summary JSON, so the Runs, Charts and Models overview is
aggregated in PostgreSQL over typed values instead of being built in Python
from every run on each catalog revision. The summary worker keeps a run's row
current when it publishes the run; a row whose revision differs from the
summary's is ignored (the overview reads that run's JSON), so the table is
never a source of truth.

``dashboard_overview_snapshots`` shares computed overviews between processes
and pods, keyed by project, catalog revision, filters and sort.

Two new empty tables (instant DDL). Existing runs are filled by the
``backfill_dashboard_overview`` maintenance job queued here; until it reaches
a run, the overview reads that run's JSON as before.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def _array(item):
    from sqlalchemy.dialects.postgresql import ARRAY

    return sa.JSON().with_variant(ARRAY(item), "postgresql")


def upgrade():
    version = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "dashboard_run_overview",
        sa.Column(
            "run_key",
            sa.String(length=36),
            sa.ForeignKey("dashboard_run_summaries.run_key", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", version, nullable=False),
        sa.Column("combo_task", sa.Text(), nullable=False),
        sa.Column("combo_dataset", sa.Text(), nullable=False),
        sa.Column("dataset_name", sa.Text(), nullable=True),
        sa.Column("git_commit", sa.Text(), nullable=False),
        sa.Column("owner_email", sa.Text(), nullable=True),
        sa.Column("owner_name", sa.Text(), nullable=True),
        sa.Column("success", sa.Float(), nullable=True),
        sa.Column("item_count", sa.Numeric(), nullable=False),
        sa.Column("latency", sa.Float(), nullable=True),
        sa.Column("median", sa.Float(), nullable=True),
        sa.Column("trace", sa.Boolean(), nullable=False),
        sa.Column("kpi_items", sa.Float(), nullable=True),
        sa.Column("kpi_executions", sa.Float(), nullable=True),
        sa.Column("kpi_successes", sa.Float(), nullable=True),
        sa.Column("kpi_errored", sa.Integer(), nullable=False),
        sa.Column("mean_names", _array(sa.Text()), nullable=True),
        sa.Column("mean_values", _array(sa.Float()), nullable=True),
        sa.Column("metric_names", _array(sa.Text()), nullable=True),
        sa.Column("spec_names", _array(sa.Text()), nullable=True),
        sa.Column("spec_types", _array(sa.Text()), nullable=True),
        sa.Column("spec_objects", _array(sa.Boolean()), nullable=True),
        sa.Column("spec_json", _array(sa.Text()), nullable=True),
    )
    op.create_table(
        "dashboard_overview_snapshots",
        sa.Column("cache_key", sa.String(length=64), primary_key=True),
        sa.Column("project_key", sa.String(length=36), nullable=False),
        sa.Column("catalog_revision", sa.String(length=160), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_dashboard_overview_snapshots_project",
        "dashboard_overview_snapshots",
        ["project_key", "created_at"],
    )
    op.create_index(
        "ix_dashboard_overview_snapshots_created",
        "dashboard_overview_snapshots",
        ["created_at"],
    )
    # Queued on every database: on SQLite, or with no runs, it finishes at once.
    now = datetime.utcnow()
    op.execute(
        sa.text(
            "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
            "VALUES (:id, 'backfill_dashboard_overview', 'queued', :params, '{}', :log, :now, :now)"
        ).bindparams(
            id=str(uuid4()),
            params=json.dumps({}),
            log="queued by migration 0069: store each run's overview inputs",
            now=now,
        )
    )


def downgrade():
    op.drop_index(
        "ix_dashboard_overview_snapshots_created", table_name="dashboard_overview_snapshots"
    )
    op.drop_index(
        "ix_dashboard_overview_snapshots_project", table_name="dashboard_overview_snapshots"
    )
    op.drop_table("dashboard_overview_snapshots")
    op.drop_table("dashboard_run_overview")
