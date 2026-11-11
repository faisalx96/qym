"""Per-job priority: ``eval_experiment_jobs.priority`` (round 9, decision I2).

A run of an experiment may carry its own LOW / NORMAL / HIGH priority. The column is
nullable ``VARCHAR(10)``; launches always set it. Backfill: every existing job gets the
priority its stored ``request_body`` was (or will be) submitted with, else its
experiment's, read in Python so it works the same on SQLite and PostgreSQL.

Quick DDL (nullable column, no default).

Revision ID: 0102
Revises: 0101
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0102"
down_revision = "0101"
branch_labels = None
depends_on = None

JOBS = "eval_experiment_jobs"
EXPERIMENTS = "eval_experiments"
VALID = ("LOW", "NORMAL", "HIGH")


def upgrade() -> None:
    op.add_column(JOBS, sa.Column("priority", sa.String(length=10), nullable=True))
    bind = op.get_bind()
    jobs = sa.table(
        JOBS,
        sa.column("id", sa.String),
        sa.column("experiment_id", sa.String),
        sa.column("request_body", sa.JSON),
        sa.column("priority", sa.String),
    )
    experiments = sa.table(
        EXPERIMENTS, sa.column("id", sa.String), sa.column("priority", sa.String)
    )
    default = {
        row[0]: row[1] for row in bind.execute(sa.select(experiments.c.id, experiments.c.priority))
    }
    rows = bind.execute(
        sa.select(jobs.c.id, jobs.c.experiment_id, jobs.c.request_body)
    ).all()
    for job_id, experiment_id, body in rows:
        value = body.get("priority") if isinstance(body, dict) else None
        value = value.upper() if isinstance(value, str) else None
        if value not in VALID:
            value = str(default.get(experiment_id) or "NORMAL").upper()
        bind.execute(jobs.update().where(jobs.c.id == job_id).values(priority=value))


def downgrade() -> None:
    with op.batch_alter_table(JOBS) as batch:
        batch.drop_column("priority")
