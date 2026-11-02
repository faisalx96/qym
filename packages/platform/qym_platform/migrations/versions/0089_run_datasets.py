"""Union runs: the datasets of a run that evaluated several dataset versions.

One run may evaluate the concatenation of several dataset versions (SDK 2.1.0,
``DatasetRef`` lists). This revision adds:

- ``run_datasets``: one row per entry of a union run (runs with two or more
  datasets only; a single-dataset run has no rows and readers synthesise the one
  entry from ``runs.dataset*``). ``dataset_id`` and ``dataset_version_id`` are FKs
  with ``ON DELETE SET NULL`` so a deleted dataset keeps its name and version text;
  ``run_id`` cascades with the run. ``UNIQUE (run_id, position)``.
- ``runs.dataset_count`` INTEGER NOT NULL DEFAULT 1: 1 for every run created before
  and for single-dataset runs.
- ``run_items.dataset_position`` SMALLINT NULL: the entry an item came from; NULL on
  single-dataset runs.

Only nullable columns and a constant default are added to the big tables, so this is
quick DDL on both dialects; there is no backfill and no index on
``run_items.dataset_position`` (queries filter by ``run_id`` first).

Revision ID: 0089
Revises: 0088
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0089"
down_revision = "0088"
branch_labels = None
depends_on = None

TABLE = "run_datasets"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(length=36),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("dataset", sa.String(length=200), nullable=False),
        sa.Column(
            "dataset_id",
            sa.String(length=36),
            sa.ForeignKey("datasets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "dataset_version_id",
            sa.String(length=36),
            sa.ForeignKey("dataset_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("version", sa.String(length=100), nullable=True),
        sa.Column("alias", sa.String(length=100), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=True),
        sa.Column("disabled_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "position", name="uq_run_datasets_run_position"),
    )
    op.create_index("ix_run_datasets_run_id", TABLE, ["run_id"])
    op.create_index("ix_run_datasets_dataset_id", TABLE, ["dataset_id"])
    op.create_index("ix_run_datasets_version_id", TABLE, ["dataset_version_id"])
    op.add_column(
        "runs",
        sa.Column("dataset_count", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "run_items", sa.Column("dataset_position", sa.SmallInteger(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("run_items", "dataset_position")
    op.drop_column("runs", "dataset_count")
    op.drop_index("ix_run_datasets_version_id", table_name=TABLE)
    op.drop_index("ix_run_datasets_dataset_id", table_name=TABLE)
    op.drop_index("ix_run_datasets_run_id", table_name=TABLE)
    op.drop_table(TABLE)
