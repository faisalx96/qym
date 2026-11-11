"""API keys: ``kind`` and ``experiment_id`` so Evaluation Service keys are scoped and grouped.

- ``api_keys.kind`` (``'user'`` default | ``'experiment'``): the key minted for an Evaluation
  Service experiment (``services/eval_submitter_keys``) is told apart from a key a user created.
  Only ``'experiment'`` keys have their scopes enforced (``auth.require_api_key_scope``).
- ``api_keys.experiment_id`` (nullable FK to ``eval_experiments.id``, ``ON DELETE SET NULL``,
  indexed): the experiment an experiment key belongs to.

Backfill: a key is marked an experiment key only when its name starts with
``Evaluation Service · `` **and** an experiment references it through
``eval_experiments.qym_api_key_id`` (a name match alone is not enough). Those keys also get
the scopes the worker needs, ``runs:write`` and ``datasets:read``, because enforcement now
reads them and old keys carry only ``runs:write``.

Quick DDL (nullable column, constant default). SQLite takes the inline ``REFERENCES`` clause
in ``ADD COLUMN`` (as in ``0088``) and drops the column in place.

Revision ID: 0098
Revises: 0097
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0098"
down_revision = "0097"
branch_labels = None
depends_on = None

KEYS = "api_keys"
EXPERIMENTS = "eval_experiments"
FK_NAME = "fk_api_keys_experiment_id"
INDEX_NAME = "ix_api_keys_experiment_id"
NAME_PREFIX = "Evaluation Service · "
SCOPES = ["runs:write", "datasets:read"]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(
            f"ALTER TABLE {KEYS} ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'user'"
        )
        op.execute(
            f"ALTER TABLE {KEYS} ADD COLUMN experiment_id VARCHAR(36) "
            f"CONSTRAINT {FK_NAME} REFERENCES {EXPERIMENTS} (id) ON DELETE SET NULL"
        )
    else:
        op.add_column(
            KEYS,
            sa.Column("kind", sa.String(length=16), nullable=False, server_default="user"),
        )
        op.add_column(KEYS, sa.Column("experiment_id", sa.String(length=36), nullable=True))
        op.create_foreign_key(
            FK_NAME, KEYS, EXPERIMENTS, ["experiment_id"], ["id"], ondelete="SET NULL"
        )
    op.create_index(INDEX_NAME, KEYS, ["experiment_id"])

    keys = sa.table(
        KEYS,
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("kind", sa.String),
        sa.column("experiment_id", sa.String),
        sa.column("scopes", sa.JSON),
    )
    experiments = sa.table(
        EXPERIMENTS, sa.column("id", sa.String), sa.column("qym_api_key_id", sa.String)
    )
    rows = bind.execute(
        sa.select(keys.c.id, sa.func.min(experiments.c.id))
        .select_from(keys.join(experiments, experiments.c.qym_api_key_id == keys.c.id))
        .where(keys.c.name.like(NAME_PREFIX + "%"))
        .group_by(keys.c.id)
    ).all()
    for key_id, experiment_id in rows:
        bind.execute(
            keys.update()
            .where(keys.c.id == key_id)
            .values(kind="experiment", experiment_id=experiment_id, scopes=list(SCOPES))
        )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name=KEYS)
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(FK_NAME, KEYS, type_="foreignkey")
    op.drop_column(KEYS, "experiment_id")
    op.drop_column(KEYS, "kind")
