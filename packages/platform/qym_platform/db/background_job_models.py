"""Shared state of in-process background jobs (analyses, rule inference, product evals).

A job runs in the API process that accepted it, but with several web worker
processes the browser's next poll can land on any of them. Each running job
publishes its snapshot here, so every process can answer status, find the
active job of a run, and ask the owning process to cancel it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text, false, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Product evals may share a scope; analyses and rule inference may not.
ACTIVE_EXCLUSIVE = "active AND kind IN ('analysis', 'rule_inference')"
QUEUED_WHERE = "queued AND active"


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
    # Split mode (QYM_SERVICE=main): the job waits here for a workers process.
    # ``queued`` rows have no owner yet, so their heartbeat is not a lease and
    # they are never reported lost (only expired after QYM_JOB_QUEUE_TIMEOUT_SECONDS).
    queued: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # What the worker needs to run the job; secrets inside are Fernet-encrypted
    # and the whole payload is cleared once the job finishes or is cancelled.
    # none_as_null: a wiped payload is SQL NULL, not the JSON value null.
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON(none_as_null=True), nullable=True)
    # The workers process that claimed it (its lease is ``heartbeat_at``).
    claimed_by: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

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
        Index(
            "ix_background_jobs_queue",
            "kind", "created_at",
            postgresql_where=text(QUEUED_WHERE),
            sqlite_where=text(QUEUED_WHERE),
        ),
    )


class ServiceHeartbeat(Base):
    """Liveness of a workers-service process, for admin status across services."""

    __tablename__ = "service_heartbeats"

    # hostname:pid:boot, as ``job_registry.process_id``.
    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    service: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Loop and job-executor liveness as the process reports it.
    info: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    __table_args__ = (Index("ix_service_heartbeats_service", "service", "heartbeat_at"),)
