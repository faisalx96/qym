"""Pause Trash purging of an archived project's deleted runs.

Restore refuses runs of archived projects, so retention no longer purges them
while their project is archived. ``projects.archived_at`` records when the
pause started; unarchiving moves each deleted run's new
``runs.purge_clock_started_at`` forward by the time since, so purging resumes
where it paused. Both columns are nullable (instant DDL). Projects already
archived start their pause now: the purge ran for them until this version.
"""

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("projects", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.add_column("runs", sa.Column("purge_clock_started_at", sa.DateTime(), nullable=True))
    # A handful of project rows, never the runs table.
    op.execute(
        sa.text("UPDATE projects SET archived_at = :now WHERE is_active = :archived").bindparams(
            now=datetime.utcnow(), archived=False
        )
    )


def downgrade():
    op.drop_column("runs", "purge_clock_started_at")
    op.drop_column("projects", "archived_at")
