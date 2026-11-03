"""Build the worker control document and its conditional-request validator."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, object_session

from qym_platform.auth import Principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    ApiKey,
    LiveJob,
    LiveSource,
    ProjectLlmConnection,
    User,
)
from qym_platform.services.live_worker_settings import (
    current_version,
    resolved_secrets,
    secrets_digest,
    version_summary,
)
from qym_platform.settings import PlatformSettings


def _user_name(db: Optional[Session], user_id: Optional[str]) -> Optional[str]:
    if db is None or user_id is None:
        return None
    user = db.get(User, user_id)
    return user.display_name if user is not None else None


def job_dict(job: LiveJob) -> dict:
    """Serialize a job attached to a session, resolving its requester's name."""
    return {
        "id": job.id,
        "kind": job.kind,
        "params": job.params,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "requested_by": _user_name(object_session(job), job.requested_by_user_id),
        "requested_at": to_api_timestamp(job.requested_at),
        "started_at": to_api_timestamp(job.started_at),
        "finished_at": to_api_timestamp(job.finished_at),
        "cancel_requested": job.cancel_requested_at is not None,
    }


def control_document(
    db: Session,
    source: LiveSource,
    principal: Principal,
    settings: PlatformSettings,
    now: datetime,
) -> tuple[dict, str]:
    """Resolve current settings, disclosing secrets only to the selected worker."""
    row = current_version(db, source)
    settings_body = None
    digest = ""
    connection_signal = None
    disclose = False
    if row is not None:
        resolved, errors = resolved_secrets(db, source, row)
        digest = secrets_digest(resolved)
        summary = version_summary(row, lambda user_id: _user_name(db, user_id))
        settings_body = {
            "version": summary["version"],
            "created_at": summary["created_at"],
            "created_by": summary["created_by"],
            "values": row.values,
            "secrets_digest": digest,
            "errors": errors,
        }
        if (
            source.worker_key_id is not None
            and source.worker_key_id == principal.api_key_id
        ):
            key = db.get(ApiKey, source.worker_key_id)
            disclose = key is not None and key.revoked_at is None
        if disclose:
            settings_body["secrets"] = resolved
        else:
            settings_body["secrets_withheld"] = True
        connection = (
            db.query(ProjectLlmConnection)
            .filter_by(
                id=row.values["models"]["connection_id"], project_id=source.project_id
            )
            .first()
        )
        if connection is not None:
            connection_signal = to_api_timestamp(connection.updated_at)

    jobs = (
        db.query(LiveJob)
        .filter(
            LiveJob.source_id == source.id, LiveJob.status.in_(("queued", "running"))
        )
        .order_by(LiveJob.requested_at, LiveJob.id)
        .all()
    )
    body = {
        "state": source.desired_state,
        "state_changed_at": to_api_timestamp(source.state_changed_at),
        "state_changed_by": _user_name(db, source.state_changed_by_user_id),
        "settings": settings_body,
        "jobs": [
            {
                "id": job.id,
                "kind": job.kind,
                "params": job.params,
                "status": job.status,
                "progress": job.progress,
                "cancel_requested": job.cancel_requested_at is not None,
            }
            for job in jobs
        ],
    }
    signal = [
        source.desired_state,
        to_api_timestamp(source.state_changed_at),
        row.version if row is not None else 0,
        digest,
        connection_signal,
        source.worker_key_id,
        [
            {
                "id": job.id,
                "status": job.status,
                "progress": job.progress,
                "cancel_requested": job.cancel_requested_at is not None,
                "updated_at": to_api_timestamp(job.updated_at),
            }
            for job in jobs
        ],
        # Withheld and disclosed representations must never validate each other.
        disclose,
    ]
    content = json.dumps(signal, sort_keys=True, separators=(",", ":"))
    etag = 'W/"' + hashlib.sha256(content.encode("utf-8")).hexdigest()[:32] + '"'
    return body, etag
