"""ON DELETE CASCADE for every child of ``runs`` so a purge is one DELETE.

Constraints are re-created ``NOT VALID`` (instant; only new rows are checked)
and validated later by the ``validate_foreign_keys`` maintenance job, which
takes only a SHARE UPDATE EXCLUSIVE lock. SQLite enforces nothing here and
its constraints are declared by the models, so it is skipped.
"""

import sqlalchemy as sa
from alembic import op

from qym_platform.db.migration_helpers import enqueue_job

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None

# table -> (constraint name, column)
CHILDREN = {
    "run_items": ("run_items_run_id_fkey", "run_id"),
    "run_item_attempts": ("run_item_attempts_run_id_fkey", "run_id"),
    "run_item_scores": ("run_item_scores_run_id_fkey", "run_id"),
    "run_item_pass_scores": ("run_item_pass_scores_run_id_fkey", "run_id"),
    "run_metric_specs": ("run_metric_specs_run_id_fkey", "run_id"),
    "run_metric_analyses": ("run_metric_analyses_run_id_fkey", "run_id"),
    "approvals": ("approvals_run_id_fkey", "run_id"),
    "run_events": ("run_events_run_id_fkey", "run_id"),
    # spans: created with ON DELETE CASCADE in 0053 (partitioned tables cannot take NOT VALID FKs).
    "run_trace_aggregates": ("run_trace_aggregates_run_id_fkey", "run_id"),
    "root_cause_revisions": ("root_cause_revisions_run_id_fkey", "run_id"),
    "review_corrections": ("review_corrections_run_id_fkey", "run_id"),
}


def _existing_fk_names(bind, table):
    return {
        row[0]
        for row in bind.execute(
            sa.text(
                "SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
                "WHERE c.contype = 'f' AND t.relname = :t AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES runs(id)%'"
            ),
            {"t": table},
        )
    }


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    to_validate = []
    for table, (name, column) in CHILDREN.items():
        if bind.execute(sa.text("SELECT to_regclass(:t)"), {"t": table}).scalar() is None:
            continue
        for old in _existing_fk_names(bind, table):
            op.execute(sa.text(f"ALTER TABLE {table} DROP CONSTRAINT {old}"))
        op.execute(sa.text(f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY ({column}) REFERENCES runs(id) ON DELETE CASCADE NOT VALID"))
        to_validate.append({"table": table, "constraint": name})
    enqueue_job(bind, "validate_foreign_keys", {"constraints": to_validate}, note="queued by migration 0054: validate cascading run foreign keys")


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table, (name, column) in CHILDREN.items():
        if bind.execute(sa.text("SELECT to_regclass(:t)"), {"t": table}).scalar() is None:
            continue
        for old in _existing_fk_names(bind, table):
            op.execute(sa.text(f"ALTER TABLE {table} DROP CONSTRAINT {old}"))
        op.execute(sa.text(f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY ({column}) REFERENCES runs(id)"))
