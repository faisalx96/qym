"""Evaluation Service jobs: ``dataset_index`` for the per-dataset fan-out.

An experiment may run several dataset versions (``evaluator.datasets``). For an
environment whose service takes no list, or when the user chose "One run each", the
platform submits one job per dataset pair, so two jobs of one environment and one
sweep combination must coexist. This revision:

- adds ``eval_experiment_jobs.dataset_index`` (``INTEGER NOT NULL DEFAULT 0``,
  ``CHECK (dataset_index >= 0)``): the pair's position in ``evaluator.datasets``;
  0 for every other job (existing rows get 0 through the default);
- replaces ``uq_eval_experiment_job_attempt`` with a unique key on
  ``(experiment_id, environment_id, combo_index, dataset_index, attempt)``.

PostgreSQL alters the table in place. SQLite can't drop a table-level UNIQUE, so the
table is rebuilt through a batch operation. With ``PRAGMA foreign_keys=ON`` dropping
the old table fires ``runs.experiment_job_id ON DELETE SET NULL``, so the run links
are saved first and restored afterwards (as in ``0075``).

Downgrade refuses (with a clear error) while any job has ``dataset_index > 0``: those
rows cannot coexist under the previous key and deleting them would lose history.

Revision ID: 0090
Revises: 0089
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None

TABLE = "eval_experiment_jobs"
UNIQUE = "uq_eval_experiment_job_attempt"
CHECK = "ck_eval_experiment_jobs_dataset_index"
OLD_COLUMNS = ["experiment_id", "environment_id", "combo_index", "attempt"]
NEW_COLUMNS = ["experiment_id", "environment_id", "combo_index", "dataset_index", "attempt"]


def _sqlite_batch(columns: list[str], *, add_column: bool) -> None:
    bind = op.get_bind()
    run_links = bind.execute(
        sa.text(
            "SELECT id, experiment_job_id FROM runs WHERE experiment_job_id IS NOT NULL"
        )
    ).all()
    with op.batch_alter_table(TABLE, recreate="always") as batch:
        batch.drop_constraint(UNIQUE, type_="unique")
        if add_column:
            batch.add_column(
                sa.Column(
                    "dataset_index", sa.Integer(), nullable=False, server_default="0"
                )
            )
            batch.create_check_constraint(CHECK, "dataset_index >= 0")
        else:
            batch.drop_constraint(CHECK, type_="check")
            batch.drop_column("dataset_index")
        batch.create_unique_constraint(UNIQUE, columns)
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
        _sqlite_batch(NEW_COLUMNS, add_column=True)
        return
    op.add_column(
        TABLE,
        sa.Column("dataset_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(CHECK, TABLE, "dataset_index >= 0")
    op.drop_constraint(UNIQUE, TABLE, type_="unique")
    op.create_unique_constraint(UNIQUE, TABLE, NEW_COLUMNS)


def downgrade() -> None:
    bind = op.get_bind()
    fanned_out = bind.execute(
        sa.text(f"SELECT COUNT(*) FROM {TABLE} WHERE dataset_index > 0")
    ).scalar()
    if fanned_out:
        raise RuntimeError(
            f"Cannot downgrade 0090: {fanned_out} job(s) belong to a per-dataset "
            "fan-out (dataset_index > 0) and cannot coexist under the previous "
            "unique key. Delete those experiments first."
        )
    if bind.dialect.name == "sqlite":
        _sqlite_batch(OLD_COLUMNS, add_column=False)
        return
    op.drop_constraint(UNIQUE, TABLE, type_="unique")
    op.create_unique_constraint(UNIQUE, TABLE, OLD_COLUMNS)
    op.drop_constraint(CHECK, TABLE, type_="check")
    op.drop_column(TABLE, "dataset_index")
