"""Instant hide marker on dashboard_run_dimensions (set by delete, cleared by restore)."""

import sqlalchemy as sa
from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dashboard_run_dimensions", sa.Column("hidden_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("dashboard_run_dimensions", "hidden_at")
