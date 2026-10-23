"""AI-assisted feedback: requests (drafts included), their messages and events, and the agent connection.

A *draft* is a ``feedback_requests`` row with ``status = 'draft'``: only its submitter sees it, it is kept
until ``feedback_agent_connection.draft_retention_days`` pass without activity, and it has no ``number``
(``FB-nnnn`` is assigned at confirmation). Confirmed requests are readable by everyone signed in; only
platform administrators triage them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import (JSON, BigInteger, Boolean, CheckConstraint, DateTime,
                        ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

_JSON = JSON().with_variant(JSONB(), "postgresql")
_BIG_ID = Integer().with_variant(BigInteger(), "postgresql")

FEEDBACK_SUBJECTS = ("platform", "product")
FEEDBACK_STATUSES = ("draft", "new", "accepted", "planned", "done", "declined")
FEEDBACK_PHASES = ("asking", "thinking", "proposed")
FEEDBACK_PRIORITIES = ("low", "medium", "high", "critical")
FEEDBACK_COMPLEXITIES = ("S", "M", "L", "XL")
FEEDBACK_TARGET_KINDS = ("run", "experiment", "dataset")
FEEDBACK_MESSAGE_ROLES = ("user", "assistant", "tool")
FEEDBACK_MESSAGE_STATUSES = ("ok", "stopped", "interrupted")
FEEDBACK_EVENT_KINDS = (
    "submitted",
    "status",
    "priority",
    "complexity",
    "duplicate",
    "duplicate_cleared",
    "declined",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class FeedbackRequest(Base):
    __tablename__ = "feedback_requests"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    # FB-0001 style; set at confirmation (drafts have none).
    number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    subject: Mapped[str] = mapped_column(String(16))
    project_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("projects.id"), nullable=True
    )
    target_kind: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    target_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    summary: Mapped[str] = mapped_column(String(400), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    business_need: Mapped[str] = mapped_column(Text, default="")
    justification: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    complexity: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    # What the assistant proposed; never edited afterwards.
    agent_priority: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    agent_complexity: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    agent_reasoning: Mapped[dict[str, Any]] = mapped_column(_JSON, default=dict)
    # The information checklist (key -> {state, value}) the assistant keeps current.
    checklist: Mapped[dict[str, Any]] = mapped_column(_JSON, default=dict)
    # The latest valid proposal (with ``seq`` of its tool message and ``superseded``).
    proposal: Mapped[Optional[dict[str, Any]]] = mapped_column(_JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    phase: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    decline_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duplicate_of_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("feedback_requests.id", ondelete="SET NULL"), nullable=True
    )
    # [{request_id, kind: duplicate|conflict|related, note}] as confirmed by the submitter.
    conflicts: Mapped[list[Any]] = mapped_column(_JSON, default=list)
    search_text: Mapped[str] = mapped_column(Text, default="")
    submitter_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    model: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    turn_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("number", name="uq_feedback_number"),
        CheckConstraint(_in("subject", FEEDBACK_SUBJECTS), name="ck_feedback_subject"),
        CheckConstraint(
            "subject <> 'product' OR project_id IS NOT NULL",
            name="ck_feedback_product_project",
        ),
        CheckConstraint(_in("status", FEEDBACK_STATUSES), name="ck_feedback_status"),
        CheckConstraint(
            "priority IS NULL OR " + _in("priority", FEEDBACK_PRIORITIES),
            name="ck_feedback_priority",
        ),
        CheckConstraint(
            "complexity IS NULL OR " + _in("complexity", FEEDBACK_COMPLEXITIES),
            name="ck_feedback_complexity",
        ),
        Index("ix_feedback_status_created", "status", "created_at"),
        Index("ix_feedback_submitter_status", "submitter_user_id", "status"),
        Index("ix_feedback_project", "project_id"),
        Index("ix_feedback_duplicate_of", "duplicate_of_id"),
        Index("ix_feedback_draft_activity", "status", "last_activity_at"),
    )


class FeedbackMessage(Base):
    __tablename__ = "feedback_messages"

    id: Mapped[int] = mapped_column(_BIG_ID, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(
        ForeignKey("feedback_requests.id", ondelete="CASCADE")
    )
    seq: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    tool_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    tool_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(_JSON, nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    prompt_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("request_id", "seq", name="uq_feedback_message_seq"),
        CheckConstraint(
            _in("role", FEEDBACK_MESSAGE_ROLES), name="ck_feedback_message_role"
        ),
        CheckConstraint(
            _in("status", FEEDBACK_MESSAGE_STATUSES), name="ck_feedback_message_status"
        ),
    )


class FeedbackRequestEvent(Base):
    """One administrator (or submitter) action on a confirmed request, with its note."""

    __tablename__ = "feedback_request_events"

    id: Mapped[int] = mapped_column(_BIG_ID, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(
        ForeignKey("feedback_requests.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(24))
    before: Mapped[dict[str, Any]] = mapped_column(_JSON, default=dict)
    after: Mapped[dict[str, Any]] = mapped_column(_JSON, default=dict)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            _in("kind", FEEDBACK_EVENT_KINDS), name="ck_feedback_event_kind"
        ),
        Index("ix_feedback_events_request_created", "request_id", "created_at"),
    )


class FeedbackAgentConnection(Base):
    """The one platform-level OpenAI-compatible connection of the feedback assistant (decision G3)."""

    __tablename__ = "feedback_agent_connection"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    llm_base_url: Mapped[str] = mapped_column(String(500), default="")
    llm_model: Mapped[str] = mapped_column(String(200), default="")
    llm_api_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    llm_api_key_last4: Mapped[str] = mapped_column(String(8), default="")
    draft_retention_days: Mapped[int] = mapped_column(Integer, default=30)
    max_user_messages: Mapped[int] = mapped_column(Integer, default=30)
    last_test_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_test_ok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    last_test_detail: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    updated_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_feedback_agent_connection_singleton"),
    )
