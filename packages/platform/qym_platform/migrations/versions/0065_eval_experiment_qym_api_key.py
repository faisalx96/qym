"""Evaluation Service experiments: the submitting user's qym API key.

``POST /evals`` takes a top-level ``qym_api_key``: a qym platform API key of the user
who submits the job, scoped to the target project. The service's worker uses it as the
SDK's ``QYM_API_KEY`` to upload the run. The platform mints one dedicated key per
experiment at launch (``services/eval_submitter_keys.py``) and revokes it once every
current job is terminal. This revision adds two nullable columns to
``eval_experiments``:

- ``qym_api_key_id``: FK to ``api_keys.id`` (``ON DELETE SET NULL``, named
  ``fk_eval_experiments_qym_api_key_id``, indexed). It keeps pointing at the key
  after revocation, for audit.
- ``qym_api_key_encrypted``: the raw key, Fernet-encrypted with
  ``QYM_LLM_CONFIG_ENCRYPTION_KEY`` (``secrets.encrypt_llm_api_key``), so key
  rotation and ``tools/reencrypt_llm_keys`` cover it. Cleared on revocation.

Existing experiments get ``NULL`` in both: their queued jobs are blocked with "the
submitting user's qym API key is unavailable" until retried, which mints a key.

SQLite can't ``ALTER … ADD CONSTRAINT`` but accepts ``REFERENCES`` inline in
``ADD COLUMN`` (as in ``0061``), and 3.35+ drops such a column in place.

Revision ID: 0065
Revises: 0064
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None

TABLE = "eval_experiments"
KEY_FK = "fk_eval_experiments_qym_api_key_id"
KEY_INDEX = "ix_eval_experiments_qym_api_key_id"


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        op.execute(
            f"ALTER TABLE {TABLE} ADD COLUMN qym_api_key_id VARCHAR(36) "
            f"CONSTRAINT {KEY_FK} REFERENCES api_keys (id) ON DELETE SET NULL"
        )
    else:
        op.add_column(
            TABLE, sa.Column("qym_api_key_id", sa.String(length=36), nullable=True)
        )
        op.create_foreign_key(
            KEY_FK,
            TABLE,
            "api_keys",
            ["qym_api_key_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.add_column(TABLE, sa.Column("qym_api_key_encrypted", sa.Text(), nullable=True))
    op.create_index(KEY_INDEX, TABLE, ["qym_api_key_id"])


def downgrade() -> None:
    op.drop_index(KEY_INDEX, table_name=TABLE)
    op.drop_column(TABLE, "qym_api_key_encrypted")
    if op.get_bind().dialect.name == "sqlite":
        op.execute(f"ALTER TABLE {TABLE} DROP COLUMN qym_api_key_id")
    else:
        op.drop_constraint(KEY_FK, TABLE, type_="foreignkey")
        op.drop_column(TABLE, "qym_api_key_id")
