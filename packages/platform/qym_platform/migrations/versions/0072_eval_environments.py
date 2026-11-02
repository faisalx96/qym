"""Evaluation Service environments, schema history and LLM model slots.

First part of the Evaluation Service integration (plan §4.1-4.3, §4.9). The
plan calls this ``0058``, but 0058–0071 were already taken on ``main``. Later
phases add experiments, jobs, presets and scores in their own revisions.

- ``eval_environments``: one remote deployment per project, encrypted API key,
  priority caps, dispatcher throttle and health fields. Active environments
  share a platform-wide unique index on the normalized ``base_url``.
- ``eval_environment_schemas``: immutable ``env-overrides`` schema history,
  unique per ``(environment_id, schema_hash)``.
- ``eval_model_slots``: LLM field groupings proposed/confirmed per schema.
- ``project_llm_connections.available_for_experiments`` (default true).

New tables and a column with a constant default only, so this is instant DDL.

Revision ID: 0072
Revises: 0071
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None

BIG_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
CURRENT_SCHEMA_FK = "fk_eval_environments_current_schema"
ACTIVE_BASE_URL_INDEX = "ux_eval_environments_active_base_url"


def upgrade() -> None:
    sqlite = op.get_bind().dialect.name == "sqlite"
    # environments.current_schema_id <-> schemas.environment_id is a cycle.
    # SQLite accepts a forward reference in CREATE TABLE (and can't ALTER ADD
    # CONSTRAINT); other dialects get the FK once both tables exist.
    current_schema_fk = (
        [
            sa.ForeignKeyConstraint(
                ["current_schema_id"],
                ["eval_environment_schemas.id"],
                name=CURRENT_SCHEMA_FK,
                ondelete="SET NULL",
            )
        ]
        if sqlite
        else []
    )
    op.create_table(
        "eval_environments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "api_key_last4", sa.String(length=8), nullable=False, server_default=""
        ),
        sa.Column(
            "default_priority",
            sa.String(length=10),
            nullable=False,
            server_default="NORMAL",
        ),
        sa.Column(
            "max_priority",
            sa.String(length=10),
            nullable=False,
            server_default="NORMAL",
        ),
        sa.Column(
            "max_inflight_jobs", sa.Integer(), nullable=False, server_default="5"
        ),
        sa.Column(
            "allow_connection_keys",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("current_schema_id", sa.String(length=36), nullable=True),
        sa.Column("ranking_metric", sa.String(length=200), nullable=True),
        sa.Column("ranking_k", sa.Integer(), nullable=True),
        sa.Column(
            "health_status",
            sa.String(length=20),
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("health_checked_at", sa.DateTime(), nullable=True),
        sa.Column("health_error", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_by_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "project_id", "name", name="uq_eval_environment_project_name"
        ),
        sa.CheckConstraint(
            "max_inflight_jobs >= 1", name="ck_eval_environments_max_inflight_jobs"
        ),
        sa.CheckConstraint(
            "default_priority IN ('LOW', 'NORMAL', 'HIGH')",
            name="ck_eval_environments_default_priority",
        ),
        sa.CheckConstraint(
            "max_priority IN ('LOW', 'NORMAL', 'HIGH')",
            name="ck_eval_environments_max_priority",
        ),
        *current_schema_fk,
    )
    op.create_index(
        "ix_eval_environments_project_id", "eval_environments", ["project_id"]
    )
    # One environment URL = one project, for active environments only.
    op.create_index(
        ACTIVE_BASE_URL_INDEX,
        "eval_environments",
        ["base_url"],
        unique=True,
        postgresql_where=sa.text("is_active"),
        sqlite_where=sa.text("is_active"),
    )

    op.create_table(
        "eval_environment_schemas",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("schema_hash", sa.String(length=64), nullable=False),
        sa.Column("schema_json", BIG_JSON, nullable=False),
        sa.Column("form_descriptor", BIG_JSON, nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "environment_id", "schema_hash", name="uq_eval_environment_schema_hash"
        ),
    )
    op.create_index(
        "ix_eval_environment_schemas_environment_id",
        "eval_environment_schemas",
        ["environment_id"],
    )

    if not sqlite:
        op.create_foreign_key(
            CURRENT_SCHEMA_FK,
            "eval_environments",
            "eval_environment_schemas",
            ["current_schema_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_table(
        "eval_model_slots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "environment_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "schema_id",
            sa.String(length=36),
            sa.ForeignKey("eval_environment_schemas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slot_key", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("field_map", BIG_JSON, nullable=False),
        sa.Column("transport_fields", BIG_JSON, nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "status", sa.String(length=10), nullable=False, server_default="proposed"
        ),
        sa.Column(
            "confirmed_by_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "schema_id", "slot_key", name="uq_eval_model_slot_schema_key"
        ),
        sa.CheckConstraint(
            "kind IN ('endpoint', 'flat')", name="ck_eval_model_slots_kind"
        ),
        sa.CheckConstraint(
            "status IN ('proposed', 'confirmed', 'stale')",
            name="ck_eval_model_slots_status",
        ),
    )
    op.create_index(
        "ix_eval_model_slots_environment_id", "eval_model_slots", ["environment_id"]
    )
    op.create_index("ix_eval_model_slots_schema_id", "eval_model_slots", ["schema_id"])

    op.add_column(
        "project_llm_connections",
        sa.Column(
            "available_for_experiments",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("project_llm_connections", "available_for_experiments")
    op.drop_table("eval_model_slots")
    # Break the environments <-> schemas cycle before dropping either table.
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(CURRENT_SCHEMA_FK, "eval_environments", type_="foreignkey")
    op.drop_table("eval_environment_schemas")
    op.drop_table("eval_environments")
