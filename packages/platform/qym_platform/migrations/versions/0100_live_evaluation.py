"""Live evaluation: sources, metric specs, days, turns, scores and canaries.

Feature round 2026-11-live-evaluation. Six new empty tables (quick DDL, no backfill).

Revision ID: 0100
Revises: 0099
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def _json() -> sa.types.TypeEngine:
    from sqlalchemy.dialects import postgresql

    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _big_id() -> sa.types.TypeEngine:
    return sa.Integer().with_variant(sa.BigInteger(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "live_sources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("environment", sa.String(50), nullable=False),
        sa.Column("product", sa.String(100), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("last_turn_at", sa.DateTime(), nullable=True),
        sa.Column("last_poll_at", sa.DateTime(), nullable=True),
        sa.Column("worker", _json(), nullable=False),
        sa.Column("day_key_timezone", sa.String(40), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "key", name="uq_live_source_key"),
    )

    op.create_table(
        "live_metric_specs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_id", sa.String(36), sa.ForeignKey("live_sources.id"), nullable=False
        ),
        sa.Column("metric_name", sa.String(200), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("score_type", sa.String(30), nullable=False),
        sa.Column("direction", sa.String(20), nullable=True),
        sa.Column("pass_threshold", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(80), nullable=True),
        sa.Column("precision", sa.Integer(), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("group", sa.String(50), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("values", _json(), nullable=True),
        sa.UniqueConstraint("source_id", "metric_name", name="uq_live_metric_spec"),
    )

    op.create_table(
        "live_days",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_id", sa.String(36), sa.ForeignKey("live_sources.id"), nullable=False
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("run_ref", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("turns_seen", sa.Integer(), nullable=False),
        sa.Column("evaluated", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("incomplete", sa.Integer(), nullable=False),
        sa.Column("excluded", sa.Integer(), nullable=False),
        sa.Column("first_poll_at", sa.DateTime(), nullable=True),
        sa.Column("last_poll_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("polls", sa.Integer(), nullable=False),
        sa.Column("max_poll_gap_s", sa.Integer(), nullable=False),
        sa.Column("parameters", _json(), nullable=False),
        sa.UniqueConstraint("source_id", "day", name="uq_live_day"),
    )

    op.create_table(
        "live_turns",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "source_id", sa.String(36), sa.ForeignKey("live_sources.id"), nullable=False
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("turn_id", sa.String(200), nullable=False),
        sa.Column("conversation_id", sa.String(200), nullable=True),
        sa.Column("turn_index", sa.Integer(), nullable=True),
        sa.Column("turn_at", sa.DateTime(), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.Column("user_ref", sa.String(200), nullable=True),
        sa.Column("mode", sa.String(50), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("outcome", sa.String(30), nullable=True),
        sa.Column("label", sa.String(60), nullable=True),
        sa.Column("label_reason", sa.Text(), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("sql", _json(), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("result_rows", sa.Integer(), nullable=True),
        sa.Column("tool_calls", sa.Integer(), nullable=True),
        sa.Column("trace_url", sa.String(2000), nullable=True),
        sa.Column("eval_trace_url", sa.String(2000), nullable=True),
        sa.Column("summary", _json(), nullable=False),
        sa.Column("detail", _json(), nullable=True),
        sa.Column("rejected", _json(), nullable=True),
        sa.UniqueConstraint("source_id", "turn_id", name="uq_live_turn"),
    )
    op.create_index("ix_live_turns_source_day", "live_turns", ["source_id", "day"])
    op.create_index(
        "ix_live_turns_source_turn_at", "live_turns", ["source_id", "turn_at"]
    )
    op.create_index("ix_live_turns_source_label", "live_turns", ["source_id", "label"])
    op.create_index(
        "ix_live_turns_source_conv",
        "live_turns",
        ["source_id", "conversation_id", "turn_at"],
    )
    op.create_index(
        "ix_live_turns_source_user", "live_turns", ["source_id", "user_ref"]
    )

    op.create_table(
        "live_turn_scores",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "turn_pk",
            _big_id(),
            sa.ForeignKey("live_turns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("metric_name", sa.String(200), nullable=False),
        sa.Column("score_numeric", sa.Float(), nullable=True),
        sa.Column("score_raw", _json(), nullable=True),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("meta", _json(), nullable=False),
        sa.Column("skipped", sa.Boolean(), nullable=False),
        sa.Column("skip_reason", sa.String(200), nullable=True),
        sa.UniqueConstraint("turn_pk", "metric_name", name="uq_live_turn_metric"),
    )

    op.create_table(
        "live_canary_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "source_id", sa.String(36), sa.ForeignKey("live_sources.id"), nullable=False
        ),
        sa.Column("canary", sa.String(50), nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("fault", sa.String(20), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("detail", _json(), nullable=False),
        sa.Column("eval_code_version", sa.String(100), nullable=True),
        sa.UniqueConstraint(
            "source_id", "canary", "checked_at", name="uq_live_canary_result"
        ),
    )
    op.create_index(
        "ix_live_canary_results_source_canary_checked",
        "live_canary_results",
        ["source_id", "canary", "checked_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_live_canary_results_source_canary_checked", table_name="live_canary_results"
    )
    op.drop_table("live_canary_results")
    op.drop_table("live_turn_scores")
    op.drop_index("ix_live_turns_source_user", table_name="live_turns")
    op.drop_index("ix_live_turns_source_conv", table_name="live_turns")
    op.drop_index("ix_live_turns_source_label", table_name="live_turns")
    op.drop_index("ix_live_turns_source_turn_at", table_name="live_turns")
    op.drop_index("ix_live_turns_source_day", table_name="live_turns")
    op.drop_table("live_turns")
    op.drop_table("live_days")
    op.drop_table("live_metric_specs")
    op.drop_table("live_sources")
