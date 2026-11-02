"""Evaluation Service environments: the ``evaluator`` schema (guide v1.1 §3.4).

``GET /evals/evaluator/schema`` is the counterpart of ``GET
/evals/env-overrides/schema`` for the ``evaluator`` object. Its history is kept
like the env-overrides one (0072):

- ``eval_environment_evaluator_schemas``: immutable schema rows, unique per
  ``(environment_id, schema_hash)``, with the ``evaluator.config`` form descriptor.
- ``eval_environments.current_evaluator_schema_id``: the schema in use (``SET NULL``
  when its row goes).
- ``eval_environments.evaluator_schema_status``: ``unknown`` (never fetched, the
  default for existing rows), ``available`` or ``unsupported`` (an older service
  that answers 404; the platform keeps its static ``EvaluatorRequestConfig``).

A new table and two columns with a constant default only, so this is quick DDL.

Revision ID: 0086
Revises: 0085
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None

BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
TABLE = "eval_environment_evaluator_schemas"
CURRENT_FK = "fk_eval_environments_current_evaluator_schema"
ENV_INDEX = "ix_eval_environment_evaluator_schemas_environment_id"


def upgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("schema_hash", sa.String(length=64), nullable=False),
        sa.Column("schema_json", BIG_JSON, nullable=False),
        sa.Column("form_descriptor", BIG_JSON, nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "environment_id",
            "schema_hash",
            name="uq_eval_environment_evaluator_schema_hash",
        ),
    )
    op.create_index(ENV_INDEX, TABLE, ["environment_id"])
    status = sa.Column(
        "evaluator_schema_status",
        sa.String(length=20),
        nullable=False,
        server_default="unknown",
    )
    if sqlite:
        # SQLite can't ALTER ADD CONSTRAINT, but a NULL column may carry an inline
        # REFERENCES clause; this avoids rebuilding a table other tables point at.
        op.execute(
            "ALTER TABLE eval_environments ADD COLUMN current_evaluator_schema_id "
            f"VARCHAR(36) CONSTRAINT {CURRENT_FK} REFERENCES {TABLE} (id) "
            "ON DELETE SET NULL"
        )
        op.add_column("eval_environments", status)
        return
    op.add_column(
        "eval_environments",
        sa.Column("current_evaluator_schema_id", sa.String(36), nullable=True),
    )
    op.add_column("eval_environments", status)
    op.create_foreign_key(
        CURRENT_FK,
        "eval_environments",
        TABLE,
        ["current_evaluator_schema_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    if sqlite:
        # The inline FK is reflected without a name; dropping its column in batch
        # mode (a table rebuild) drops it too.
        with op.batch_alter_table("eval_environments") as batch_op:
            batch_op.drop_column("evaluator_schema_status")
            batch_op.drop_column("current_evaluator_schema_id")
    else:
        op.drop_constraint(CURRENT_FK, "eval_environments", type_="foreignkey")
        op.drop_column("eval_environments", "evaluator_schema_status")
        op.drop_column("eval_environments", "current_evaluator_schema_id")
    op.drop_index(ENV_INDEX, table_name=TABLE)
    op.drop_table(TABLE)
