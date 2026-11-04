"""Coalesce recurring worker errors within a rolling time window."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_storage_utc
from qym_platform.db.models import LiveSource, LiveWorkerEvent


def redact_details(value: Any) -> Any:
    """Drop credential keys recursively while preserving other JSON values."""
    if isinstance(value, dict):
        secret_names = (
            "api_key",
            "apikey",
            "password",
            "secret",
            "token",
            "credential",
            "authorization",
            "cookie",
        )
        return {
            key: redact_details(item)
            for key, item in value.items()
            if not any(name in key.lower() for name in secret_names)
        }
    if isinstance(value, list):
        return [redact_details(item) for item in value]
    return value


def fingerprint(component: str, code: str, message: str) -> str:
    """Ignore case, whitespace, hex identifiers and numbers in recurring errors."""
    normalized = " ".join(message.lower().split())
    # Replace hex identifiers before digits can break their token boundaries.
    normalized = re.sub(r"\b[0-9a-f]{16,}\b", "*", normalized)
    normalized = re.sub(r"\d+", "#", normalized)
    content = component + "\n" + code + "\n" + normalized
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def ingest_events(
    db: Session,
    source: LiveSource,
    events: list,
    now: datetime,
    window: timedelta = timedelta(minutes=15),
) -> int:
    """Insert or update events, returning the number of distinct rows touched."""
    touched = set()
    for event in events:
        at = to_storage_utc(event.at)
        digest = fingerprint(event.component, event.code, event.message)
        row = (
            db.query(LiveWorkerEvent)
            .filter(
                LiveWorkerEvent.source_id == source.id,
                LiveWorkerEvent.fingerprint == digest,
                LiveWorkerEvent.last_at >= at - window,
                LiveWorkerEvent.first_at <= at + window,
            )
            .order_by(LiveWorkerEvent.last_at.desc(), LiveWorkerEvent.id.desc())
            .with_for_update()
            .first()
        )
        if row is None:
            row = LiveWorkerEvent(
                source_id=source.id,
                level=event.level,
                component=event.component,
                code=event.code,
                message=event.message,
                details=event.details,
                fingerprint=digest,
                count=1,
                first_at=at,
                last_at=at,
            )
            db.add(row)
        else:
            row.count += 1
            row.first_at = min(row.first_at, at)
            row.last_at = max(row.last_at, at)
            row.details = event.details
        # Ingest sessions disable autoflush; make this row visible to the batch.
        db.flush()
        touched.add(row.id)
    return len(touched)
