"""Data factory.

Six new empty tables (quick DDL, no backfill): ``data_factories`` (a project
dataset connected to the factory, with its own access mode), ``factory_grants``
(per-user view / modify / approve levels), ``factory_rule_categories`` (the
kinds of rules the agent extracts, each with an optional JSON schema),
``factory_rules`` (the extracted or hand-written business rules, official or
not, plain or bridge), ``factory_rule_links`` (a rule's further categories and a
bridge's target categories) and ``factory_jobs`` (rule analysis and data generation jobs run by the
workers loop). Rows go with their factory (``ON DELETE CASCADE``); a factory
goes with its dataset.

Revision ID: 0104
Revises: 0103
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "data_factories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column(
            "dataset_id",
            sa.String(36),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("group_metadata_key", sa.String(200), nullable=True),
        sa.Column(
            "llm_connection_id",
            sa.String(36),
            sa.ForeignKey("project_llm_connections.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "access_mode", sa.String(16), nullable=False, server_default="project"
        ),
        sa.Column(
            "analysis_instructions", sa.Text(), nullable=False, server_default=""
        ),
        sa.Column(
            "generation_instructions", sa.Text(), nullable=False, server_default=""
        ),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("last_analyzed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_data_factories_project_id", "data_factories", ["project_id"])

    op.create_table(
        "factory_grants",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "factory_id",
            sa.String(36),
            sa.ForeignKey("data_factories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column(
            "granted_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("factory_id", "user_id", name="uq_factory_grant_user"),
    )
    op.create_index("ix_factory_grants_factory_id", "factory_grants", ["factory_id"])
    op.create_index("ix_factory_grants_user_id", "factory_grants", ["user_id"])

    op.create_table(
        "factory_rule_categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "factory_id",
            sa.String(36),
            sa.ForeignKey("data_factories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("json_schema", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("factory_id", "key", name="uq_factory_category_key"),
    )
    op.create_index(
        "ix_factory_rule_categories_factory_id",
        "factory_rule_categories",
        ["factory_id"],
    )

    op.create_table(
        "factory_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "factory_id",
            sa.String(36),
            sa.ForeignKey("data_factories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("factory_rule_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("group_value", sa.String(500), nullable=False, server_default=""),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("body", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("official", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("kind", sa.String(16), nullable=False, server_default="rule"),
        sa.Column("source", sa.String(16), nullable=False, server_default="agent"),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "approved_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_factory_rules_factory_id", "factory_rules", ["factory_id"])
    op.create_index("ix_factory_rules_category_id", "factory_rules", ["category_id"])
    op.create_index(
        "ix_factory_rules_factory_group", "factory_rules", ["factory_id", "group_value"]
    )

    op.create_table(
        "factory_rule_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "rule_id",
            sa.String(36),
            sa.ForeignKey("factory_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("factory_rule_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.UniqueConstraint(
            "rule_id",
            "category_id",
            "role",
            name="uq_factory_rule_links_rule_category_role",
        ),
    )
    op.create_index("ix_factory_rule_links_rule_id", "factory_rule_links", ["rule_id"])
    op.create_index(
        "ix_factory_rule_links_category_id", "factory_rule_links", ["category_id"]
    )
    op.create_table(
        "factory_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "factory_id",
            sa.String(36),
            sa.ForeignKey("data_factories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("log", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("output_dataset_id", sa.String(36), nullable=True),
        sa.Column(
            "requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("lease_owner", sa.String(64), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_factory_jobs_factory_id", "factory_jobs", ["factory_id"])
    op.create_index(
        "ix_factory_jobs_status_created", "factory_jobs", ["status", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_factory_jobs_status_created", table_name="factory_jobs")
    op.drop_index("ix_factory_jobs_factory_id", table_name="factory_jobs")
    op.drop_table("factory_jobs")
    op.drop_index("ix_factory_rule_links_category_id", table_name="factory_rule_links")
    op.drop_index("ix_factory_rule_links_rule_id", table_name="factory_rule_links")
    op.drop_table("factory_rule_links")
    op.drop_index("ix_factory_rules_factory_group", table_name="factory_rules")
    op.drop_index("ix_factory_rules_category_id", table_name="factory_rules")
    op.drop_index("ix_factory_rules_factory_id", table_name="factory_rules")
    op.drop_table("factory_rules")
    op.drop_index(
        "ix_factory_rule_categories_factory_id", table_name="factory_rule_categories"
    )
    op.drop_table("factory_rule_categories")
    op.drop_index("ix_factory_grants_user_id", table_name="factory_grants")
    op.drop_index("ix_factory_grants_factory_id", table_name="factory_grants")
    op.drop_table("factory_grants")
    op.drop_index("ix_data_factories_project_id", table_name="data_factories")
    op.drop_table("data_factories")
