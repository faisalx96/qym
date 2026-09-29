"""Force a password change after an admin issues a temporary password."""

import sqlalchemy as sa
from alembic import op

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "local_auth_credentials",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("local_auth_credentials", "must_change_password")
