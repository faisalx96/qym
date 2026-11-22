"""Bridge rules open groups, not categories.

A bridge rule extends an item into other groups of the factory's grouping key
(another table a query joins, another product a conversation brings in), so
its targets are group values: the new ``factory_rules.bridge_to_groups`` JSON
list. The category targets a bridge had (``factory_rule_links`` rows with role
``bridge``) are dropped, and such a bridge becomes a plain rule until someone
names the groups it opens (the editor, or a new analysis). Quick DDL on a
small table.

Revision ID: 0107
Revises: 0106
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0107"
down_revision = "0106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("factory_rules") as batch:
        batch.add_column(
            sa.Column(
                "bridge_to_groups",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            )
        )
    op.execute(sa.text("DELETE FROM factory_rule_links WHERE role = 'bridge'"))
    op.execute(sa.text("UPDATE factory_rules SET kind = 'rule' WHERE kind = 'bridge'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE factory_rules SET kind = 'rule' WHERE kind = 'bridge'"))
    with op.batch_alter_table("factory_rules") as batch:
        batch.drop_column("bridge_to_groups")
