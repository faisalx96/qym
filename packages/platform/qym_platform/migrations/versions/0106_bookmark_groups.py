"""Bookmark groups.

Bookmarks move into groups: a new ``bookmark_groups`` table (a user's named
folder in a project, pinned or not) and ``run_bookmarks.group_id``. Every
existing bookmark is filed in a ``General`` group of its author in its
project, created here, so the column can be NOT NULL. Pinning moves to the
group: ``run_bookmarks.pinned`` and ``pinned_at`` are dropped (a pinned
bookmark pins its author's General group, so nothing a person pinned is
lost). Small tables; quick on every database.

Revision ID: 0106
Revises: 0105
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0106"
down_revision = "0105"
branch_labels = None
depends_on = None

DEFAULT_GROUP_NAME = "General"


def upgrade() -> None:
    op.create_table(
        "bookmark_groups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column(
            "owner_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pinned_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "project_id", "owner_user_id", "name", name="uq_bookmark_groups_owner_name"
        ),
    )
    op.create_index("ix_bookmark_groups_project_id", "bookmark_groups", ["project_id"])
    op.create_index(
        "ix_bookmark_groups_owner_user_id", "bookmark_groups", ["owner_user_id"]
    )
    with op.batch_alter_table("run_bookmarks") as batch:
        batch.add_column(sa.Column("group_id", sa.String(36), nullable=True))

    # One General group per author and project, pinned when any of their
    # bookmarks there was pinned; every bookmark goes into it.
    connection = op.get_bind()
    now = datetime.utcnow()
    rows = connection.execute(
        sa.text(
            "SELECT project_id, user_id, MAX(CASE WHEN pinned THEN 1 ELSE 0 END) AS pinned, "
            "MAX(pinned_at) AS pinned_at FROM run_bookmarks GROUP BY project_id, user_id"
        )
    ).fetchall()
    for project_id, user_id, pinned, pinned_at in rows:
        group_id = str(uuid4())
        connection.execute(
            sa.text(
                "INSERT INTO bookmark_groups (id, project_id, owner_user_id, name, description, "
                "pinned, pinned_at, created_at, updated_at) VALUES (:id, :project_id, :owner, "
                ":name, '', :pinned, :pinned_at, :now, :now)"
            ),
            {
                "id": group_id,
                "project_id": project_id,
                "owner": user_id,
                "name": DEFAULT_GROUP_NAME,
                "pinned": bool(pinned),
                "pinned_at": pinned_at if pinned else None,
                "now": now,
            },
        )
        connection.execute(
            sa.text(
                "UPDATE run_bookmarks SET group_id = :group_id "
                "WHERE project_id = :project_id AND user_id = :user_id"
            ),
            {"group_id": group_id, "project_id": project_id, "user_id": user_id},
        )

    with op.batch_alter_table("run_bookmarks") as batch:
        batch.alter_column("group_id", existing_type=sa.String(36), nullable=False)
        batch.create_foreign_key(
            "fk_run_bookmarks_group_id_bookmark_groups",
            "bookmark_groups",
            ["group_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_index("ix_run_bookmarks_group_id", ["group_id"])
        batch.drop_column("pinned_at")
        batch.drop_column("pinned")


def downgrade() -> None:
    with op.batch_alter_table("run_bookmarks") as batch:
        batch.add_column(
            sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("pinned_at", sa.DateTime(), nullable=True))
        batch.drop_index("ix_run_bookmarks_group_id")
        batch.drop_constraint(
            "fk_run_bookmarks_group_id_bookmark_groups", type_="foreignkey"
        )
        batch.drop_column("group_id")
    op.drop_index("ix_bookmark_groups_owner_user_id", table_name="bookmark_groups")
    op.drop_index("ix_bookmark_groups_project_id", table_name="bookmark_groups")
    op.drop_table("bookmark_groups")
