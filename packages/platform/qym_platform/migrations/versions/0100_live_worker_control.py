"""Worker control: source state and worker key, settings versions, jobs, worker events.

Quick DDL, no backfill.

Revision ID: 0100
Revises: 0099
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def _json() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _big_id() -> sa.types.TypeEngine:
    return sa.Integer().with_variant(sa.BigInteger(), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("live_sources") as batch:
        batch.add_column(
            sa.Column(
                "desired_state", sa.String(10), nullable=False, server_default="running"
            )
        )
        batch.add_column(sa.Column("state_changed_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("state_changed_by_user_id", sa.String(36), nullable=True)
        )
        batch.add_column(sa.Column("worker_key_id", sa.String(36), nullable=True))
        batch.add_column(
            sa.Column("worker_key_changed_at", sa.DateTime(), nullable=True)
        )
        batch.add_column(
            sa.Column("worker_key_changed_by_user_id", sa.String(36), nullable=True)
        )
        batch.create_foreign_key(
            "fk_live_sources_state_changed_by",
            "users",
            ["state_changed_by_user_id"],
            ["id"],
        )
        batch.create_foreign_key(
            "fk_live_sources_worker_key",
            "api_keys",
            ["worker_key_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_foreign_key(
            "fk_live_sources_worker_key_changed_by",
            "users",
            ["worker_key_changed_by_user_id"],
            ["id"],
        )

    op.create_table(
        "live_worker_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_id",
            sa.String(36),
            sa.ForeignKey("live_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("values", _json(), nullable=False),
        sa.Column("secrets_encrypted", _json(), nullable=False),
        sa.Column("secret_hints", sa.JSON(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "source_id", "version", name="uq_live_worker_settings_version"
        ),
    )
    op.create_table(
        "live_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_id",
            sa.String(36),
            sa.ForeignKey("live_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("requested_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_live_jobs_source_status", "live_jobs", ["source_id", "status"])
    op.create_index(
        "uq_live_jobs_active",
        "live_jobs",
        ["source_id", "kind"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"),
        sqlite_where=sa.text("status IN ('queued','running')"),
    )
    op.create_table(
        "live_worker_events",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "source_id",
            sa.String(36),
            sa.ForeignKey("live_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("component", sa.String(30), nullable=False),
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("first_at", sa.DateTime(), nullable=False),
        sa.Column("last_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_live_worker_events_source_last",
        "live_worker_events",
        ["source_id", "last_at"],
    )
    op.create_index(
        "ix_live_worker_events_source_fp",
        "live_worker_events",
        ["source_id", "fingerprint"],
    )


def downgrade() -> None:
    op.drop_index("ix_live_worker_events_source_fp", table_name="live_worker_events")
    op.drop_index("ix_live_worker_events_source_last", table_name="live_worker_events")
    op.drop_table("live_worker_events")
    op.drop_index("uq_live_jobs_active", table_name="live_jobs")
    op.drop_index("ix_live_jobs_source_status", table_name="live_jobs")
    op.drop_table("live_jobs")
    op.drop_table("live_worker_settings")
    with op.batch_alter_table("live_sources") as batch:
        batch.drop_constraint(
            "fk_live_sources_worker_key_changed_by", type_="foreignkey"
        )
        batch.drop_constraint("fk_live_sources_worker_key", type_="foreignkey")
        batch.drop_constraint("fk_live_sources_state_changed_by", type_="foreignkey")
        batch.drop_column("worker_key_changed_by_user_id")
        batch.drop_column("worker_key_changed_at")
        batch.drop_column("worker_key_id")
        batch.drop_column("state_changed_by_user_id")
        batch.drop_column("state_changed_at")
        batch.drop_column("desired_state")
