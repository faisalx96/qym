"""Evaluation Service job attempts: retries as new rows of the same combination.

Retrying a job (plan §13) clones it into a new row with a new launch token and keeps
the old row for history. ``0061`` made ``(experiment_id, environment_id,
combo_index)`` unique, which leaves no room for that second row, so this revision:

- adds ``eval_experiment_jobs.attempt`` (``INTEGER NOT NULL DEFAULT 0``,
  ``CHECK (attempt >= 0)``): 0 for the first submission, +1 per retry;
- adds ``eval_experiment_jobs.retry_of_job_id`` (FK to the job it retries,
  ``ON DELETE SET NULL``, indexed);
- replaces ``uq_eval_experiment_job_combo`` with
  ``uq_eval_experiment_job_attempt`` on ``(experiment_id, environment_id,
  combo_index, attempt)``.

Existing rows become attempt 0 through the server default. PostgreSQL alters the
table in place. SQLite can't drop a table-level UNIQUE, so the table is rebuilt with
every column, CHECK, FK and index of ``0061``. With ``PRAGMA foreign_keys=ON`` the
drop of the old table fires ``runs.experiment_job_id ON DELETE SET NULL``, so the
run links are saved first and restored after the rebuild.

Downgrade keeps only the latest attempt of each combination (older attempts are
history that the old unique constraint cannot hold); runs linked to a removed
attempt are unlinked by the FK.

Revision ID: 0063
Revises: 0062
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None

TABLE = "eval_experiment_jobs"
TMP_TABLE = "_tmp_eval_experiment_jobs_0063"
BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
OLD_UNIQUE = "uq_eval_experiment_job_combo"
NEW_UNIQUE = "uq_eval_experiment_job_attempt"
ATTEMPT_CHECK = "ck_eval_experiment_jobs_attempt"
RETRY_FK = "fk_eval_experiment_jobs_retry_of_job_id"
RETRY_INDEX = "ix_eval_experiment_jobs_retry_of_job_id"
JOB_STATUSES = (
    "('QUEUED', 'SUBMITTING', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', "
    "'BLOCKED', 'CANCELLING', 'CANCELLED', 'TIMED_OUT')"
)
# Indexes of 0061 (recreated after a SQLite rebuild): name -> (columns, unique).
BASE_INDEXES = {
    "ix_eval_experiment_jobs_status_next_attempt": (
        ["status", "next_attempt_at"],
        False,
    ),
    "ix_eval_experiment_jobs_environment_status": (["environment_id", "status"], False),
    "ix_eval_experiment_jobs_run_id": (["run_id"], True),
}
BASE_COLUMNS = (
    "id",
    "experiment_id",
    "environment_id",
    "combo_index",
    "params",
    "request_body",
    "schema_id",
    "launch_token_hash",
    "remote_job_id",
    "remote_status",
    "remote_result",
    "remote_versioning",
    "status",
    "run_id",
    "error",
    "submit_attempts",
    "next_attempt_at",
    "lease_owner",
    "lease_until",
    "submitted_at",
    "last_polled_at",
    "finished_at",
    "wait_reason",
    "cancel_requested_at",
    "cancelled_by_user_id",
    "cancel_reason",
    "created_at",
    "updated_at",
)


def _create_jobs_table(name: str, *, attempts: bool) -> None:
    """Create the 0061 job table, plus the 0063 columns and key when ``attempts``."""
    extra: list = []
    if attempts:
        extra = [
            sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "retry_of_job_id",
                sa.String(length=36),
                sa.ForeignKey(f"{TABLE}.id", ondelete="SET NULL", name=RETRY_FK),
                nullable=True,
            ),
            sa.UniqueConstraint(
                "experiment_id",
                "environment_id",
                "combo_index",
                "attempt",
                name=NEW_UNIQUE,
            ),
            sa.CheckConstraint("attempt >= 0", name=ATTEMPT_CHECK),
        ]
    else:
        extra = [
            sa.UniqueConstraint(
                "experiment_id", "environment_id", "combo_index", name=OLD_UNIQUE
            )
        ]
    op.create_table(
        name,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "experiment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
        sa.Column(
            "cancelled_by_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        *extra,
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


def _sqlite_rebuild(*, attempts: bool) -> None:
    """Rebuild the job table on SQLite, keeping rows, indexes and run links."""
    bind = op.get_bind()
    run_links = bind.execute(
        sa.text(
            "SELECT id, experiment_job_id FROM runs WHERE experiment_job_id IS NOT NULL"
        )
    ).all()
    # The self-FK names the final table, which the rename below makes valid.
    _create_jobs_table(TMP_TABLE, attempts=attempts)
    columns = list(BASE_COLUMNS) + (["attempt", "retry_of_job_id"] if attempts else [])
    source_columns = list(BASE_COLUMNS) + (
        ["0", "NULL"] if attempts else []
    )  # upgrade: existing rows are attempt 0
    bind.execute(
        sa.text(
            f"INSERT INTO {TMP_TABLE} ({', '.join(columns)}) "
            f"SELECT {', '.join(source_columns)} FROM {TABLE}"
        )
    )
    op.drop_table(TABLE)
    op.rename_table(TMP_TABLE, TABLE)
    for name, (cols, unique) in BASE_INDEXES.items():
        op.create_index(name, TABLE, cols, unique=unique)
    if attempts:
        op.create_index(RETRY_INDEX, TABLE, ["retry_of_job_id"])
    for run_id, job_id in run_links:
        bind.execute(
            sa.text(
                "UPDATE runs SET experiment_job_id = :job WHERE id = :run "
                f"AND EXISTS (SELECT 1 FROM {TABLE} WHERE id = :job)"
            ),
            {"job": job_id, "run": run_id},
        )


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        _sqlite_rebuild(attempts=True)
        return
    op.add_column(
        TABLE,
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(ATTEMPT_CHECK, TABLE, "attempt >= 0")
    op.add_column(
        TABLE, sa.Column("retry_of_job_id", sa.String(length=36), nullable=True)
    )
    op.create_foreign_key(
        RETRY_FK, TABLE, TABLE, ["retry_of_job_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index(RETRY_INDEX, TABLE, ["retry_of_job_id"])
    op.drop_constraint(OLD_UNIQUE, TABLE, type_="unique")
    op.create_unique_constraint(
        NEW_UNIQUE,
        TABLE,
        ["experiment_id", "environment_id", "combo_index", "attempt"],
    )


def downgrade() -> None:
    # Keep the latest attempt of each combination; older ones can't coexist
    # under the 0061 unique key.
    op.execute(
        sa.text(
            f"DELETE FROM {TABLE} WHERE EXISTS ("
            f"SELECT 1 FROM {TABLE} AS newer "
            f"WHERE newer.experiment_id = {TABLE}.experiment_id "
            f"AND newer.environment_id = {TABLE}.environment_id "
            f"AND newer.combo_index = {TABLE}.combo_index "
            f"AND newer.attempt > {TABLE}.attempt)"
        )
    )
    if op.get_bind().dialect.name == "sqlite":
        _sqlite_rebuild(attempts=False)
        return
    op.drop_constraint(NEW_UNIQUE, TABLE, type_="unique")
    op.create_unique_constraint(
        OLD_UNIQUE, TABLE, ["experiment_id", "environment_id", "combo_index"]
    )
    op.drop_index(RETRY_INDEX, table_name=TABLE)
    op.drop_constraint(RETRY_FK, TABLE, type_="foreignkey")
    op.drop_column(TABLE, "retry_of_job_id")
    op.drop_constraint(ATTEMPT_CHECK, TABLE, type_="check")
    op.drop_column(TABLE, "attempt")
