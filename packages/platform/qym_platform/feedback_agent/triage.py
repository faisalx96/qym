"""Administrator triage of confirmed requests (spec-e section 7, QE-97 to QE-108)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from qym_platform.auth import Principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.feedback_models import FeedbackRequest
from qym_platform.feedback_agent.constants import (COMPLEXITIES, PRIORITIES,
                                                   TRIAGE_STATUSES)
from qym_platform.feedback_agent.search import request_ref
from qym_platform.feedback_agent.store import (add_event, audit, error,
                                               find_request, is_admin)
from sqlalchemy.orm import Session


def _norm_ts(value: Optional[str]) -> str:
    return (value or "").strip().replace("+00:00", "Z")


def apply_triage(
    db: Session, principal: Principal, req: FeedbackRequest, body: dict[str, Any]
) -> list[Any]:
    """Apply the changed fields of ``body``; returns the new events. Raises ``FeedbackError``."""
    if not is_admin(principal):
        raise error(
            403, "not_admin", "Only platform administrators can triage requests"
        )
    if req.status == "draft":
        raise error(409, "not_confirmed", "A draft cannot be triaged")
    expected = _norm_ts(body.get("expected_updated_at"))
    if not expected:
        raise error(422, "validation", "expected_updated_at is required")
    if expected != _norm_ts(to_api_timestamp(req.updated_at)):
        raise error(
            409,
            "stale",
            "Someone else changed this request. Reload to see their changes.",
        )

    note = str(body.get("note") or "").strip()
    actor = principal.user.id
    now = datetime.utcnow()
    events: list[Any] = []
    changed: dict[str, Any] = {}

    status = body.get("status")
    if status is not None and status != req.status:
        if status not in TRIAGE_STATUSES:
            raise error(422, "validation", "Unknown status")
        decline_reason = str(body.get("decline_reason") or "").strip()
        if status == "declined" and not decline_reason:
            raise error(
                422,
                "validation",
                "Say why it is declined. The submitter sees this.",
                field="decline_reason",
            )
        before = {"status": req.status}
        req.status = status
        if status == "declined":
            req.decline_reason = decline_reason
            events.append(
                add_event(
                    db,
                    req.id,
                    actor,
                    "declined",
                    before,
                    {"status": status},
                    decline_reason,
                    now,
                )
            )
            audit(
                db,
                actor,
                "feedback.declined",
                req.id,
                before,
                {"status": status, "decline_reason": decline_reason},
            )
        else:
            req.decline_reason = None
            events.append(
                add_event(
                    db, req.id, actor, "status", before, {"status": status}, note, now
                )
            )
            audit(
                db, actor, "feedback.status_changed", req.id, before, {"status": status}
            )
        changed["status"] = status

    for field_name, allowed, kind, action in (
        ("priority", PRIORITIES, "priority", "feedback.priority_revised"),
        ("complexity", COMPLEXITIES, "complexity", "feedback.complexity_revised"),
    ):
        value = body.get(field_name)
        if value is None or value == getattr(req, field_name):
            continue
        if value not in allowed:
            raise error(422, "validation", f"Unknown {field_name}", field=field_name)
        if not note:
            raise error(
                422,
                "validation",
                "Add a note: it is shown in the history.",
                field="note",
            )
        before = {field_name: getattr(req, field_name)}
        setattr(req, field_name, value)
        events.append(
            add_event(db, req.id, actor, kind, before, {field_name: value}, note, now)
        )
        audit(db, actor, action, req.id, before, {field_name: value})
        changed[field_name] = value

    if "duplicate_of" in body:
        target_ref = body.get("duplicate_of")
        current = req.duplicate_of_id
        if target_ref:
            target = find_request(db, str(target_ref))
            if target is None or target.status == "draft":
                raise error(
                    422,
                    "validation",
                    "That request does not exist",
                    field="duplicate_of",
                )
            if target.id == req.id:
                raise error(
                    422,
                    "validation",
                    "A request cannot be a duplicate of itself",
                    field="duplicate_of",
                )
            if target.duplicate_of_id:
                raise error(
                    409,
                    "duplicate_chain",
                    "That request is itself a duplicate. Pick the original.",
                )
            has_children = (
                db.query(FeedbackRequest.id)
                .filter(FeedbackRequest.duplicate_of_id == req.id)
                .first()
            )
            if has_children:
                raise error(409, "has_duplicates", "Move its duplicates first.")
            if target.id != current:
                if not note:
                    raise error(
                        422,
                        "validation",
                        "Add a note: it is shown in the history.",
                        field="note",
                    )
                before = {
                    "duplicate_of": (
                        request_ref(db.get(FeedbackRequest, current).number)
                        if current
                        else None
                    )
                }
                req.duplicate_of_id = target.id
                after = {"duplicate_of": request_ref(target.number)}
                events.append(
                    add_event(db, req.id, actor, "duplicate", before, after, note, now)
                )
                audit(db, actor, "feedback.duplicate_marked", req.id, before, after)
                changed["duplicate_of"] = after["duplicate_of"]
        elif current:
            if not note:
                raise error(
                    422,
                    "validation",
                    "Add a note: it is shown in the history.",
                    field="note",
                )
            before = {
                "duplicate_of": request_ref(db.get(FeedbackRequest, current).number)
            }
            req.duplicate_of_id = None
            events.append(
                add_event(
                    db,
                    req.id,
                    actor,
                    "duplicate_cleared",
                    before,
                    {"duplicate_of": None},
                    note,
                    now,
                )
            )
            audit(
                db,
                actor,
                "feedback.duplicate_cleared",
                req.id,
                before,
                {"duplicate_of": None},
            )
            changed["duplicate_of"] = None

    if events:
        req.updated_at = now
    db.flush()
    return events
