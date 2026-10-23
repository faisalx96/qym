"""AI-assisted feedback: requests, messages, events and the agent connection.

Four new empty tables (instant DDL). ``feedback_agent_connection`` is a singleton (``id = 1``) holding the
platform-level OpenAI-compatible connection of the feedback assistant, its encrypted key and its two numbers
(draft retention days, most user messages per request).

Revision ID: 0091
Revises: 0088

``down_revision`` is ``0088`` on the ``feat/ai-feedback`` branch; the integration merge re-points it to
``0090`` once the multi-dataset round (``0089``, ``0090``) has landed.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0091"
down_revision = "0088"
branch_labels = None
depends_on = None


def _json() -> sa.types.TypeEngine:
    from sqlalchemy.dialects import postgresql

    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _big_id() -> sa.types.TypeEngine:
    return sa.Integer().with_variant(sa.BigInteger(), "postgresql")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "feedback_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("subject", sa.String(16), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("target_kind", sa.String(16), nullable=True),
        sa.Column("target_id", sa.String(200), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("summary", sa.String(400), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("business_need", sa.Text(), nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(16), nullable=True),
        sa.Column("complexity", sa.String(4), nullable=True),
        sa.Column("agent_priority", sa.String(16), nullable=True),
        sa.Column("agent_complexity", sa.String(4), nullable=True),
        sa.Column("agent_reasoning", _json(), nullable=False),
        sa.Column("checklist", _json(), nullable=False),
        sa.Column("proposal", _json(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("phase", sa.String(16), nullable=True),
        sa.Column("decline_reason", sa.Text(), nullable=True),
        sa.Column(
            "duplicate_of_id",
            sa.String(36),
            sa.ForeignKey("feedback_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("conflicts", _json(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("submitter_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("prompt_version", sa.String(32), nullable=True),
        sa.Column("turn_started_at", sa.DateTime(), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("number", name="uq_feedback_number"),
        sa.CheckConstraint(_in("subject", ("platform", "product")), name="ck_feedback_subject"),
        sa.CheckConstraint(
            "subject <> 'product' OR project_id IS NOT NULL", name="ck_feedback_product_project"
        ),
        sa.CheckConstraint(
            _in("status", ("draft", "new", "accepted", "planned", "done", "declined")),
            name="ck_feedback_status",
        ),
        sa.CheckConstraint(
            "priority IS NULL OR " + _in("priority", ("low", "medium", "high", "critical")),
            name="ck_feedback_priority",
        ),
        sa.CheckConstraint(
            "complexity IS NULL OR " + _in("complexity", ("S", "M", "L", "XL")),
            name="ck_feedback_complexity",
        ),
    )
    op.create_index("ix_feedback_status_created", "feedback_requests", ["status", "created_at"])
    op.create_index("ix_feedback_submitter_status", "feedback_requests", ["submitter_user_id", "status"])
    op.create_index("ix_feedback_project", "feedback_requests", ["project_id"])
    op.create_index("ix_feedback_duplicate_of", "feedback_requests", ["duplicate_of_id"])
    op.create_index("ix_feedback_draft_activity", "feedback_requests", ["status", "last_activity_at"])

    op.create_table(
        "feedback_messages",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "request_id",
            sa.String(36),
            sa.ForeignKey("feedback_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tool_name", sa.String(64), nullable=True),
        sa.Column("tool_payload", _json(), nullable=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("request_id", "seq", name="uq_feedback_message_seq"),
        sa.CheckConstraint(_in("role", ("user", "assistant", "tool")), name="ck_feedback_message_role"),
        sa.CheckConstraint(
            _in("status", ("ok", "stopped", "interrupted")), name="ck_feedback_message_status"
        ),
    )

    op.create_table(
        "feedback_request_events",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "request_id",
            sa.String(36),
            sa.ForeignKey("feedback_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("before", _json(), nullable=False),
        sa.Column("after", _json(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            _in(
                "kind",
                (
                    "submitted",
                    "status",
                    "priority",
                    "complexity",
                    "duplicate",
                    "duplicate_cleared",
                    "declined",
                ),
            ),
            name="ck_feedback_event_kind",
        ),
    )
    op.create_index(
        "ix_feedback_events_request_created", "feedback_request_events", ["request_id", "created_at"]
    )

    op.create_table(
        "feedback_agent_connection",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("llm_base_url", sa.String(500), nullable=False),
        sa.Column("llm_model", sa.String(200), nullable=False),
        sa.Column("llm_api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("llm_api_key_last4", sa.String(8), nullable=False),
        sa.Column("draft_retention_days", sa.Integer(), nullable=False),
        sa.Column("max_user_messages", sa.Integer(), nullable=False),
        sa.Column("last_test_at", sa.DateTime(), nullable=True),
        sa.Column("last_test_ok", sa.Boolean(), nullable=True),
        sa.Column("last_test_detail", sa.String(500), nullable=True),
        sa.Column("updated_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_feedback_agent_connection_singleton"),
    )


def downgrade() -> None:
    op.drop_table("feedback_agent_connection")
    op.drop_index("ix_feedback_events_request_created", table_name="feedback_request_events")
    op.drop_table("feedback_request_events")
    op.drop_table("feedback_messages")
    op.drop_index("ix_feedback_draft_activity", table_name="feedback_requests")
    op.drop_index("ix_feedback_duplicate_of", table_name="feedback_requests")
    op.drop_index("ix_feedback_project", table_name="feedback_requests")
    op.drop_index("ix_feedback_submitter_status", table_name="feedback_requests")
    op.drop_index("ix_feedback_status_created", table_name="feedback_requests")
    op.drop_table("feedback_requests")
