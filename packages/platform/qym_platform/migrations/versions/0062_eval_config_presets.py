"""Evaluation Service config presets and immutable preset versions.

Third part of the Evaluation Service integration (plan §4.4, §9, R4). Follows
``0061``. The presets service and API come in a later change.

- ``eval_config_presets``: named config presets per environment, ``kind``
  ``official`` | ``saved``, pointing at their ``current_version_id``. A partial
  unique index allows at most one ``official`` preset per environment.
- ``eval_config_preset_versions``: immutable versions, unique per
  ``(preset_id, version)``, with the schema the config was authored against,
  the config document (no sweeps, secret-free), release notes and publisher.

Every path from a project to these rows cascades (project -> environment ->
preset -> version, and environment -> schema -> version), so a project
hard-delete succeeds while presets exist. The environments API soft-disables
an environment that has presets instead of deleting it.

New tables only, so this is instant DDL.

Revision ID: 0062
Revises: 0061
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None

BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
CURRENT_VERSION_FK = "fk_eval_config_presets_current_version"
OFFICIAL_PRESET_INDEX = "ux_eval_config_presets_official_env"


def _user_fk(column: str) -> sa.Column:
    return sa.Column(
        column,
        sa.String(length=36),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def upgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    # presets.current_version_id <-> versions.preset_id is a cycle. SQLite
    # accepts a forward reference in CREATE TABLE (and can't ALTER ADD
    # CONSTRAINT); other dialects get the FK once both tables exist.
    current_version_fk = (
        [
            sa.ForeignKeyConstraint(
                ["current_version_id"],
                ["eval_config_preset_versions.id"],
                name=CURRENT_VERSION_FK,
                ondelete="SET NULL",
            )
        ]
        if sqlite
        else []
    )
    op.create_table(
        "eval_config_presets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("current_version_id", sa.String(length=36), nullable=True),
        _user_fk("created_by_user_id"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('official', 'saved')", name="ck_eval_config_presets_kind"
        ),
        *current_version_fk,
    )
    op.create_index(
        "ix_eval_config_presets_environment_id",
        "eval_config_presets",
        ["environment_id"],
    )
    # At most one official preset per environment.
    op.create_index(
        OFFICIAL_PRESET_INDEX,
        "eval_config_presets",
        ["environment_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'official'"),
        sqlite_where=sa.text("kind = 'official'"),
    )

    op.create_table(
        "eval_config_preset_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "preset_id",
            sa.String(length=36),
            sa.ForeignKey("eval_config_presets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        # Cascades like eval_experiment_jobs.schema_id: schemas are only
        # deleted with their environment, which takes its presets anyway.
        sa.Column(
            "schema_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environment_schemas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("config", BIG_JSON, nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        _user_fk("published_by_user_id"),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "preset_id", "version", name="uq_eval_config_preset_version"
        ),
        sa.CheckConstraint(
            "version >= 1", name="ck_eval_config_preset_versions_version"
        ),
    )
    op.create_index(
        "ix_eval_config_preset_versions_schema_id",
        "eval_config_preset_versions",
        ["schema_id"],
    )

    if not sqlite:
        op.create_foreign_key(
            CURRENT_VERSION_FK,
            "eval_config_presets",
            "eval_config_preset_versions",
            ["current_version_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    # Break the presets <-> versions cycle before dropping either table.
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(
            CURRENT_VERSION_FK, "eval_config_presets", type_="foreignkey"
        )
    op.drop_table("eval_config_preset_versions")
    op.drop_table("eval_config_presets")
