"""Durable maintenance jobs: operator-triggered, resumable background work.

Production runs on Kubernetes with no shell access, so every heavy operation
(space reclaim, index builds, span migration, purges) is a row in this table
that the worker process executes in bounded, committed steps. Progress lives in
the row, so a pod restart resumes instead of restarting.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

JOB_STATUSES = ("paused", "queued", "running", "succeeded", "failed", "cancel_requested", "cancelled")


class MaintenanceJob(Base):
    __tablename__ = "maintenance_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    kind: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Free-form, handler-owned: cursor, counts, bytes, human message.
    progress: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Last ~200 log lines, newline separated (bounded by the runner).
    log: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requested_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    lease_owner: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_maintenance_jobs_status_created", "status", "created_at"),)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "params": self.params or {},
            "progress": self.progress or {},
            "log": self.log or "",
            "error": self.error,
            "requested_by_user_id": self.requested_by_user_id,
            "lease_owner": self.lease_owner,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
