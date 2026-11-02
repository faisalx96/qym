"""Evaluation Service experiments: dataset read token and latency-sensitive runs.

Feature 4 (per-experiment dataset read token, ``services/eval_dataset_tokens.py``):

- ``eval_experiments.dataset_read_token_id``: FK to ``dataset_read_tokens.id``
  (``ON DELETE SET NULL``, named ``fk_eval_experiments_dataset_read_token_id``,
  indexed). Kept after revocation, for audit.
- ``eval_experiments.dataset_read_token_encrypted``: the raw token, Fernet-encrypted
  like ``qym_api_key_encrypted``; cleared on revocation.
- ``dataset_read_tokens.kind`` (``'admin'`` default | ``'experiment'``, check
  ``ck_dataset_read_tokens_kind``) and ``dataset_read_tokens.experiment_id`` (FK to
  ``eval_experiments.id``, ``ON DELETE SET NULL``, indexed): the token list tells
  admin tokens from experiment tokens and links to the experiment.

Feature 5 (latency-sensitive runs, guide v1.3 section 2.2):

- ``eval_experiments.latency_sensitive`` BOOLEAN NOT NULL DEFAULT false.
- ``eval_environments.latency_sensitive_min_role`` (``'member'`` default |
  ``'manager'``, check ``ck_eval_environments_latency_min_role``).
- ``eval_experiment_jobs``: ``admitted_at``, ``deferrals``, ``deferral_reason`` and
  ``contaminated_attempts``, copied from every poll of the service.

Only nullable columns and constant defaults, so this is quick DDL on both dialects.
It does not touch any table of revision 0087 (dataset access).

SQLite can't ``ALTER ... ADD CONSTRAINT`` but accepts inline ``REFERENCES`` and
``CHECK`` clauses in ``ADD COLUMN`` (as in ``0077``), and drops such a column in place.

Revision ID: 0088
Revises: 0087
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0088"
down_revision = "0087"
branch_labels = None
depends_on = None

EXPERIMENTS = "eval_experiments"
TOKENS = "dataset_read_tokens"
ENVIRONMENTS = "eval_environments"
JOBS = "eval_experiment_jobs"

EXPERIMENT_TOKEN_FK = "fk_eval_experiments_dataset_read_token_id"
EXPERIMENT_TOKEN_INDEX = "ix_eval_experiments_dataset_read_token_id"
TOKEN_EXPERIMENT_FK = "fk_dataset_read_tokens_experiment_id"
TOKEN_EXPERIMENT_INDEX = "ix_dataset_read_tokens_experiment_id"
TOKEN_KIND_CHECK = "ck_dataset_read_tokens_kind"
ROLE_CHECK = "ck_eval_environments_latency_min_role"


def _fk_column(table: str, column: str, target: str, fk_name: str) -> None:
    """Add a nullable ``VARCHAR(36)`` FK column (``ON DELETE SET NULL``)."""
    if op.get_bind().dialect.name == "sqlite":
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR(36) "
            f"CONSTRAINT {fk_name} REFERENCES {target} (id) ON DELETE SET NULL"
        )
        return
    op.add_column(table, sa.Column(column, sa.String(length=36), nullable=True))
    op.create_foreign_key(fk_name, table, target, [column], ["id"], ondelete="SET NULL")


def _drop_fk_column(table: str, column: str, fk_name: str) -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(fk_name, table, type_="foreignkey")
    op.drop_column(table, column)


def upgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"

    # Feature 4: experiment -> token, token -> experiment.
    _fk_column(EXPERIMENTS, "dataset_read_token_id", TOKENS, EXPERIMENT_TOKEN_FK)
    op.add_column(
        EXPERIMENTS, sa.Column("dataset_read_token_encrypted", sa.Text(), nullable=True)
    )
    op.create_index(EXPERIMENT_TOKEN_INDEX, EXPERIMENTS, ["dataset_read_token_id"])

    if sqlite:
        op.execute(
            f"ALTER TABLE {TOKENS} ADD COLUMN kind VARCHAR(16) NOT NULL "
            f"DEFAULT 'admin' CONSTRAINT {TOKEN_KIND_CHECK} "
            "CHECK (kind IN ('admin', 'experiment'))"
        )
    else:
        op.add_column(
            TOKENS,
            sa.Column(
                "kind", sa.String(length=16), nullable=False, server_default="admin"
            ),
        )
        op.create_check_constraint(
            TOKEN_KIND_CHECK, TOKENS, "kind IN ('admin', 'experiment')"
        )
    _fk_column(TOKENS, "experiment_id", EXPERIMENTS, TOKEN_EXPERIMENT_FK)
    op.create_index(TOKEN_EXPERIMENT_INDEX, TOKENS, ["experiment_id"])

    # Feature 5: the flag, the environment gate, the admission state of a job.
    op.add_column(
        EXPERIMENTS,
        sa.Column(
            "latency_sensitive",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    if sqlite:
        op.execute(
            f"ALTER TABLE {ENVIRONMENTS} ADD COLUMN latency_sensitive_min_role "
            f"VARCHAR(10) NOT NULL DEFAULT 'member' CONSTRAINT {ROLE_CHECK} "
            "CHECK (latency_sensitive_min_role IN ('member', 'manager'))"
        )
    else:
        op.add_column(
            ENVIRONMENTS,
            sa.Column(
                "latency_sensitive_min_role",
                sa.String(length=10),
                nullable=False,
                server_default="member",
            ),
        )
        op.create_check_constraint(
            ROLE_CHECK,
            ENVIRONMENTS,
            "latency_sensitive_min_role IN ('member', 'manager')",
        )
    op.add_column(JOBS, sa.Column("admitted_at", sa.DateTime(), nullable=True))
    op.add_column(
        JOBS,
        sa.Column("deferrals", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        JOBS, sa.Column("deferral_reason", sa.String(length=500), nullable=True)
    )
    op.add_column(
        JOBS,
        sa.Column(
            "contaminated_attempts", sa.Integer(), nullable=False, server_default="0"
        ),
    )


def downgrade() -> None:
    for column in (
        "contaminated_attempts",
        "deferral_reason",
        "deferrals",
        "admitted_at",
    ):
        op.drop_column(JOBS, column)
    op.drop_column(ENVIRONMENTS, "latency_sensitive_min_role")
    op.drop_column(EXPERIMENTS, "latency_sensitive")

    op.drop_index(TOKEN_EXPERIMENT_INDEX, table_name=TOKENS)
    _drop_fk_column(TOKENS, "experiment_id", TOKEN_EXPERIMENT_FK)
    op.drop_column(TOKENS, "kind")

    op.drop_index(EXPERIMENT_TOKEN_INDEX, table_name=EXPERIMENTS)
    op.drop_column(EXPERIMENTS, "dataset_read_token_encrypted")
    _drop_fk_column(EXPERIMENTS, "dataset_read_token_id", EXPERIMENT_TOKEN_FK)
