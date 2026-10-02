"""Shared state of in-process background jobs (analyses, rule inference, product evals).

A job runs in the API process that accepted it, but with several web worker
processes the browser's next poll can land on any of them. Each running job
publishes its snapshot here, so every process can answer status, find the
active job of a run, and ask the owning process to cancel it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Product evals may share a scope; analyses and rule inference may not.
ACTIVE_EXCLUSIVE = "active AND kind IN ('analysis', 'rule_inference')"


class BackgroundJob(Base):
    __tablename__ = "background_jobs"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    # Run id, or another scope key such as ``project:<slug>``.
    scope_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    project_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    pass_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # pass_number or 0: one active analysis per run and pass across processes.
    pass_key: Mapped[int] = mapped_column(Integer, default=0)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    # JSON-safe job snapshot as the owning manager reports it.
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # hostname:pid:boot of the process running the job, and its last sign of life.
    process_id: Mapped[str] = mapped_column(String(160))
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_background_jobs_scope", "kind", "scope_id", "active"),
        Index("ix_background_jobs_project", "kind", "project_id", "active"),
        Index("ix_background_jobs_updated", "updated_at"),
        # Two processes starting the same run's analysis at once: one insert
        # wins, the other request answers with the winner's job.
        Index(
            "ux_background_jobs_active_scope",
            "kind", "scope_id", "pass_key",
            unique=True,
            postgresql_where=text(ACTIVE_EXCLUSIVE),
            sqlite_where=text(ACTIVE_EXCLUSIVE),
        ),
    )
