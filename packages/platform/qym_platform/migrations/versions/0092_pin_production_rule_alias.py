"""Pin each project's production rule alias (C016).

Before this, a project with published analysis rule versions but no ``production`` alias treated its newest
published version as live, so every publish went live even with "Set as production" off. The platform now sets the
alias on a project's first publish and moves it later only when asked. This data migration pins the alias, in every
project that has published versions and no alias, to the version that was live: the newest published one
(``published_at``, then the version number). A project whose versions name no user (the alias needs one) keeps the
runtime fallback. Quick: one SELECT and one INSERT per such project; no DDL. The downgrade removes nothing (the alias
rows are valid data either way).

Revision ID: 0092
Revises: 0091
"""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "0092"
down_revision = "0091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT v.project_id, v.id, COALESCE(v.published_by_user_id, v.created_by_user_id),
                   v.published_at, v.version
            FROM project_analysis_rule_versions v
            WHERE v.status = 'published' AND v.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM project_analysis_rule_aliases a
                WHERE a.project_id = v.project_id AND a.alias = 'production'
              )
            """
        )
    ).fetchall()
    live: dict[str, tuple[tuple[bool, datetime, int], str, str | None]] = {}
    for project_id, version_id, actor, published_at, number in rows:
        # The order the runtime fallback used: published_at descending (nulls last), then the version number.
        key = (published_at is not None, published_at or datetime.min, int(number or 0))
        if project_id not in live or key > live[project_id][0]:
            live[project_id] = (key, version_id, actor)
    now = datetime.utcnow()
    for project_id, (_, version_id, actor) in live.items():
        if actor is None:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO project_analysis_rule_aliases "
                "(project_id, alias, rule_version_id, updated_by_user_id, updated_at) "
                "VALUES (:project_id, 'production', :version_id, :actor, :now)"
            ),
            {"project_id": project_id, "version_id": version_id, "actor": actor, "now": now},
        )


def downgrade() -> None:
    pass
