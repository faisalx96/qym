"""Evaluation Service experiments, jobs, remote queue snapshots and run origin.

Second part of the Evaluation Service integration (plan §4.5, §4.6, §4.6a,
§4.8). The plan calls this "0058 part 2"; it follows ``0072``. Presets and
best-run scores come in later revisions.

- ``eval_experiments``: one launch (a sweep over one or more environments),
  with the config ``spec``, encrypted temporary secrets, priority and the
  aggregate status.
- ``eval_experiment_jobs``: one combination x one environment, unique per
  ``(experiment_id, environment_id, combo_index)``, with dispatcher lease,
  retry/backoff, remote state, cancel request and ``wait_reason`` columns.
- ``eval_remote_queue_snapshots``: latest redacted view of each environment's
  remote queue, one row per environment.
- ``runs.origin`` (``local`` | ``official``, default ``local``, indexed) and
  ``runs.experiment_job_id`` (FK, ``ON DELETE SET NULL``).

Existing runs are backfilled to ``local`` through the constant server default,
so adding the column doesn't rewrite the table on PostgreSQL 11+ (adding the
``origin`` CHECK takes one validation scan).

Revision ID: 0073
Revises: 0072
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None

BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
RUN_EXPERIMENT_JOB_FK = "fk_runs_experiment_job_id"
RUN_ORIGIN_CHECK = "ck_runs_origin"
RUN_ORIGIN_CHECK_SQL = "origin IN ('local', 'official')"
PRIORITIES = "('LOW', 'NORMAL', 'HIGH')"
EXPERIMENT_STATUSES = (
    "('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')"
)
JOB_STATUSES = (
    "('QUEUED', 'SUBMITTING', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', "
    "'BLOCKED', 'CANCELLING', 'CANCELLED', 'TIMED_OUT')"
)


def _user_fk(column: str) -> sa.Column:
    return sa.Column(
        column,
        sa.String(length=36),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def upgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"

    op.create_table(
        "eval_experiments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _user_fk("created_by_user_id"),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("environment_ids", BIG_JSON, nullable=False),
        sa.Column("base_source", BIG_JSON, nullable=False),
        sa.Column("spec", BIG_JSON, nullable=False),
        sa.Column("secrets_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "priority", sa.String(length=10), nullable=False, server_default="NORMAL"
        ),
        sa.Column("preemption_acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column(
            "status", sa.String(length=10), nullable=False, server_default="QUEUED"
        ),
        sa.Column("job_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        _user_fk("cancelled_by_user_id"),
        sa.CheckConstraint(
            f"priority IN {PRIORITIES}", name="ck_eval_experiments_priority"
        ),
        sa.CheckConstraint(
            f"status IN {EXPERIMENT_STATUSES}", name="ck_eval_experiments_status"
        ),
        sa.CheckConstraint("job_count >= 0", name="ck_eval_experiments_job_count"),
    )
    op.create_index(
        "ix_eval_experiments_project_created",
        "eval_experiments",
        ["project_id", "created_at"],
    )

    op.create_table(
        "eval_experiment_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "experiment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Cascades so a project hard-delete (which reaches jobs through both
        # experiments and environments) succeeds. The API soft-disables an
        # environment that jobs reference instead of deleting it.
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("combo_index", sa.Integer(), nullable=False),
        sa.Column("params", BIG_JSON, nullable=False),
        sa.Column("request_body", BIG_JSON, nullable=False),
        sa.Column(
            "schema_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environment_schemas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("launch_token_hash", sa.String(length=64), nullable=True),
        sa.Column("remote_job_id", sa.String(length=100), nullable=True),
        sa.Column("remote_status", sa.String(length=20), nullable=True),
        sa.Column("remote_result", BIG_JSON, nullable=True),
        sa.Column("remote_versioning", BIG_JSON, nullable=True),
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="QUEUED"
        ),
        sa.Column(
            "run_id",
            sa.String(length=36),
            sa.ForeignKey("runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("submit_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("lease_owner", sa.String(length=100), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("wait_reason", sa.String(length=200), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(), nullable=True),
        _user_fk("cancelled_by_user_id"),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "experiment_id",
            "environment_id",
            "combo_index",
            name="uq_eval_experiment_job_combo",
        ),
        sa.CheckConstraint(
            "combo_index >= 0", name="ck_eval_experiment_jobs_combo_index"
        ),
        sa.CheckConstraint(
            "submit_attempts >= 0", name="ck_eval_experiment_jobs_submit_attempts"
        ),
        sa.CheckConstraint(
            f"status IN {JOB_STATUSES}", name="ck_eval_experiment_jobs_status"
        ),
    )
    # Dispatcher claim order and the per-environment queue view.
    op.create_index(
        "ix_eval_experiment_jobs_status_next_attempt",
        "eval_experiment_jobs",
        ["status", "next_attempt_at"],
    )
    op.create_index(
        "ix_eval_experiment_jobs_environment_status",
        "eval_experiment_jobs",
        ["environment_id", "status"],
    )
    # A run links to at most one job (the launch token is single-use).
    op.create_index(
        "ix_eval_experiment_jobs_run_id",
        "eval_experiment_jobs",
        ["run_id"],
        unique=True,
    )

    op.create_table(
        "eval_remote_queue_snapshots",
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("fetch_error", sa.Text(), nullable=True),
        sa.Column("items", BIG_JSON, nullable=False),
    )

    # runs <-> eval_experiment_jobs is an FK cycle. SQLite can't ALTER ADD
    # CONSTRAINT but accepts CHECK/REFERENCES inline in ADD COLUMN (the
    # server default backfills existing rows either way).
    if sqlite:
        op.execute(
            "ALTER TABLE runs ADD COLUMN origin VARCHAR(10) DEFAULT 'local' NOT NULL "
            f"CONSTRAINT {RUN_ORIGIN_CHECK} CHECK ({RUN_ORIGIN_CHECK_SQL})"
        )
        op.execute(
            "ALTER TABLE runs ADD COLUMN experiment_job_id VARCHAR(36) "
            f"CONSTRAINT {RUN_EXPERIMENT_JOB_FK} REFERENCES eval_experiment_jobs (id) "
            "ON DELETE SET NULL"
        )
    else:
        op.add_column(
            "runs",
            sa.Column(
                "origin", sa.String(length=10), nullable=False, server_default="local"
            ),
        )
        op.create_check_constraint(RUN_ORIGIN_CHECK, "runs", RUN_ORIGIN_CHECK_SQL)
        op.add_column(
            "runs",
            sa.Column("experiment_job_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            RUN_EXPERIMENT_JOB_FK,
            "runs",
            "eval_experiment_jobs",
            ["experiment_job_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_runs_origin", "runs", ["origin"])
    op.create_index("ix_runs_experiment_job_id", "runs", ["experiment_job_id"])


def downgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    op.drop_index("ix_runs_experiment_job_id", table_name="runs")
    op.drop_index("ix_runs_origin", table_name="runs")
    if sqlite:
        # SQLite 3.35+ drops a column along with its inline constraints.
        op.execute("ALTER TABLE runs DROP COLUMN experiment_job_id")
        op.execute("ALTER TABLE runs DROP COLUMN origin")
    else:
        op.drop_constraint(RUN_EXPERIMENT_JOB_FK, "runs", type_="foreignkey")
        op.drop_column("runs", "experiment_job_id")
        op.drop_constraint(RUN_ORIGIN_CHECK, "runs", type_="check")
        op.drop_column("runs", "origin")
    op.drop_table("eval_remote_queue_snapshots")
    op.drop_table("eval_experiment_jobs")
    op.drop_table("eval_experiments")
