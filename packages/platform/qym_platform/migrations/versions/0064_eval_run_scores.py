"""Evaluation Service: best-run score index and one-time run link marker.

Two independent changes (issue #36 and the #17 follow-up):

1. ``eval_run_scores`` (plan §4.7): one row per ``(run_id, metric_name)`` of an
   official run whose job is terminal and whose run completed. It denormalizes the
   project, environment and dataset (version) so ranking (§10.2) is one indexed query
   on ``(environment_id, dataset_version_id, metric_name, mean_score)``. ``direction``
   is a string with a named CHECK (``maximize``/``minimize``), ``pass_at_k`` is JSON
   (``{"1": …, "2": …}`` for repeat runs). Rows cascade with the run, project and
   environment; a deleted dataset (version) only clears the pointer.

   The migration is **data-free**: rows are written by
   ``services/eval_run_scores.py`` (completion hook, re-score refresh) and existing
   official runs are filled by the idempotent backfill
   ``python -m qym_platform.tools.backfill_eval_run_scores``. Computing means needs the
   run-list mean rule and pass@k in Python, which doesn't belong in a schema
   migration, and a separate command can be re-run safely at any time.

2. ``eval_experiment_jobs.run_linked_at`` (nullable ``DateTime``) records when ingest
   linked a run to the job (plan §11). ``run_id`` is ``ON DELETE SET NULL``, so after
   a hard delete of the linked run ``run_id IS NULL`` alone would make the job linkable
   again and a replayed launch token could relink it. The guarded claim in
   ``services/eval_run_linking.py`` also requires ``run_linked_at IS NULL``, and the
   marker is never cleared. Existing linked jobs are backfilled with ``updated_at``.

Both are plain ``CREATE TABLE`` / ``ADD COLUMN`` / ``DROP …`` on either dialect
(SQLite >= 3.35 drops a plain column in place).

Revision ID: 0064
Revises: 0063
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None

JOBS = "eval_experiment_jobs"
SCORES = "eval_run_scores"
BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
RANKING_INDEX = "ix_eval_run_scores_ranking"


def upgrade() -> None:
    op.create_table(
        SCORES,
        sa.Column(
            "run_id",
            sa.String(length=36),
            sa.ForeignKey(
                "runs.id", ondelete="CASCADE", name="fk_eval_run_scores_run_id"
            ),
            primary_key=True,
        ),
        sa.Column("metric_name", sa.String(length=200), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey(
                "projects.id", ondelete="CASCADE", name="fk_eval_run_scores_project_id"
            ),
            nullable=False,
        ),
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey(
                "eval_environments.id",
                ondelete="CASCADE",
                name="fk_eval_run_scores_environment_id",
            ),
            nullable=False,
        ),
        sa.Column(
            "dataset_id",
            sa.String(length=36),
            sa.ForeignKey(
                "datasets.id", ondelete="SET NULL", name="fk_eval_run_scores_dataset_id"
            ),
            nullable=True,
        ),
        sa.Column(
            "dataset_version_id",
            sa.String(length=36),
            sa.ForeignKey(
                "dataset_versions.id",
                ondelete="SET NULL",
                name="fk_eval_run_scores_dataset_version_id",
            ),
            nullable=True,
        ),
        sa.Column("mean_score", sa.Float(), nullable=False),
        sa.Column(
            "direction",
            sa.String(length=10),
            nullable=False,
            server_default="maximize",
        ),
        sa.Column("pass_at_k", BIG_JSON, nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "direction IN ('maximize', 'minimize')",
            name="ck_eval_run_scores_direction",
        ),
        sa.CheckConstraint(
            "item_count >= 0 AND error_item_count >= 0 "
            "AND error_item_count <= item_count",
            name="ck_eval_run_scores_counts",
        ),
    )
    op.create_index(
        RANKING_INDEX,
        SCORES,
        ["environment_id", "dataset_version_id", "metric_name", "mean_score"],
    )

    op.add_column(JOBS, sa.Column("run_linked_at", sa.DateTime(), nullable=True))
    op.execute(
        sa.text(
            f"UPDATE {JOBS} SET run_linked_at = updated_at "
            "WHERE run_id IS NOT NULL AND run_linked_at IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column(JOBS, "run_linked_at")
    op.drop_index(RANKING_INDEX, table_name=SCORES)
    op.drop_table(SCORES)
