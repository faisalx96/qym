"""Project role Viewer (C033).

A viewer opens every project page, compares runs and exports; every write
route answers 403. Postgres stores the role as the enum type ``projectrole``,
so the new value is added outside the migration transaction (quick DDL, no
rewrite). SQLite stores it as text.

Revision ID: 0099
Revises: 0098
"""

from alembic import op

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE projectrole ADD VALUE IF NOT EXISTS 'VIEWER' BEFORE 'MEMBER'")


def downgrade():
    # Postgres cannot drop an enum value; viewers become members first.
    op.execute("UPDATE project_memberships SET role = 'MEMBER' WHERE role = 'VIEWER'")
