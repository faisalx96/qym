"""Rows, references, serialisation and the shared queries of the feedback feature (no model calls here)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from qym_platform.auth import Principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.feedback_models import (
    FeedbackMessage,
    FeedbackRequest,
    FeedbackRequestEvent,
)
from qym_platform.db.models import AuditLog, Project, User, UserRole
from qym_platform.feedback_agent.constants import (
    COMPLEXITIES,
    PRIORITIES,
    TRIAGE_STATUSES,
)
from qym_platform.feedback_agent.search import request_ref
from qym_platform.feedback_agent.text import normalize, stem, tokens

REF_RE = re.compile(r"^(?:FB-)?0*(\d{1,9})$", re.IGNORECASE)
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")

PRIORITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}
COMPLEXITY_RANK = {"XL": 4, "L": 3, "M": 2, "S": 1}


def is_admin(principal: Principal) -> bool:
    return principal.user.role == UserRole.ADMIN


class FeedbackError(Exception):
    """An API error answered as ``{detail, code, ...}`` (spec-e section 6)."""

    def __init__(self, status: int, code: str, detail: str, headers: Optional[dict[str, str]] = None, **extra: Any):
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        self.headers = headers or {}
        self.extra = extra

    def body(self) -> dict[str, Any]:
        return {"detail": self.detail, "code": self.code, **self.extra}


def error(status: int, code: str, detail: str, **extra: Any) -> FeedbackError:
    headers = extra.pop("headers", None)
    return FeedbackError(status, code, detail, headers, **extra)


def audit(
    db: Session,
    actor_id: Optional[str],
    action: str,
    entity_id: str,
    before: Optional[dict[str, Any]] = None,
    after: Optional[dict[str, Any]] = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_id,
            action=action,
            entity_type="feedback_request",
            entity_id=entity_id,
            before=before or {},
            after=after or {},
        )
    )


def parse_ref(ref: str) -> Optional[int]:
    m = REF_RE.match((ref or "").strip())
    return int(m.group(1)) if m and not UUID_RE.match(ref or "") else None


def find_request(db: Session, ref: str) -> Optional[FeedbackRequest]:
    """The row for a uuid or ``FB-0044``; None when missing. Visibility is checked by ``load_visible``."""
    ref = (ref or "").strip()
    if UUID_RE.match(ref):
        return db.get(FeedbackRequest, ref)
    number = parse_ref(ref)
    if number is None:
        return None
    return db.query(FeedbackRequest).filter(FeedbackRequest.number == number).first()


def load_visible(db: Session, principal: Principal, ref: str) -> FeedbackRequest:
    """Confirmed requests are visible to everyone signed in; a draft only to its submitter (QE-167)."""
    row = find_request(db, ref)
    if row is None or (row.status == "draft" and row.submitter_user_id != principal.user.id):
        raise error(404, "not_found", "This request does not exist or is not yours")
    return row


def load_own_draft(db: Session, principal: Principal, ref: str) -> FeedbackRequest:
    row = load_visible(db, principal, ref)
    if row.status != "draft":
        raise error(409, "already_confirmed", "This request is already submitted", request=request_ref(row.number))
    return row


def user_name(user: Optional[User]) -> str:
    if user is None:
        return ""
    return user.display_name or user.email.split("@")[0]


def _project_payload(project: Optional[Project]) -> Optional[dict[str, Any]]:
    if project is None:
        return None
    return {"id": project.id, "name": project.name, "slug": project.slug}


def row_payload(
    row: FeedbackRequest,
    users: dict[str, User],
    projects: dict[str, Project],
    refs: dict[str, str],
) -> dict[str, Any]:
    """One list row. ``refs`` maps request uuid to ``FB-nnnn`` for duplicate_of lookups."""
    possible = next(
        (c.get("request_id") for c in (row.conflicts or []) if isinstance(c, dict) and c.get("kind") == "duplicate"),
        None,
    )
    return {
        "id": row.id,
        "ref": request_ref(row.number),
        "number": row.number,
        "title": row.title,
        "summary": row.summary,
        "subject": row.subject,
        "project": _project_payload(projects.get(row.project_id)) if row.project_id else None,
        "priority": row.priority,
        "complexity": row.complexity,
        "status": row.status,
        "submitter": {"id": row.submitter_user_id, "name": user_name(users.get(row.submitter_user_id))},
        "created_at": to_api_timestamp(row.created_at),
        "confirmed_at": to_api_timestamp(row.confirmed_at),
        "duplicate_of": refs.get(row.duplicate_of_id) if row.duplicate_of_id else None,
        "possible_duplicate_of": possible if not row.duplicate_of_id else None,
    }


def lookup_maps(db: Session, rows: Iterable[FeedbackRequest]) -> tuple[dict, dict, dict]:
    rows = list(rows)
    user_ids = {r.submitter_user_id for r in rows}
    project_ids = {r.project_id for r in rows if r.project_id}
    dup_ids = {r.duplicate_of_id for r in rows if r.duplicate_of_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_(project_ids)).all()} if project_ids else {}
    refs: dict[str, str] = {}
    if dup_ids:
        for rid, number in db.query(FeedbackRequest.id, FeedbackRequest.number).filter(FeedbackRequest.id.in_(dup_ids)):
            refs[rid] = request_ref(number)
    return users, projects, refs


# --------------------------------------------------------------------------------------------- filters


def _csv(value: Optional[str]) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def resolve_project_ids(db: Session, values: list[str]) -> list[str]:
    if not values:
        return []
    rows = db.query(Project.id).filter(or_(Project.id.in_(values), Project.slug.in_(values))).all()
    return [r[0] for r in rows] or ["__none__"]


def filter_conditions(
    db: Session,
    *,
    status: Optional[str] = None,
    about: Optional[str] = None,
    project_id: Optional[str] = None,
    priority: Optional[str] = None,
    complexity: Optional[str] = None,
    q: Optional[str] = None,
    mine_user_id: Optional[str] = None,
) -> list[Any]:
    """The WHERE conditions shared by the list and the export (drafts are never included)."""
    conds: list[Any] = [FeedbackRequest.status != "draft"]
    statuses = [s for s in _csv(status) if s in TRIAGE_STATUSES]
    if _csv(status) and not statuses:
        statuses = ["__none__"]
    if statuses:
        conds.append(FeedbackRequest.status.in_(statuses))
    subjects = [s for s in _csv(about) if s in ("platform", "product")]
    if subjects:
        conds.append(FeedbackRequest.subject.in_(subjects))
    projects = resolve_project_ids(db, _csv(project_id))
    if projects:
        conds.append(FeedbackRequest.project_id.in_(projects))
    prios = [p for p in _csv(priority) if p in PRIORITIES]
    if prios:
        conds.append(FeedbackRequest.priority.in_(prios))
    comps = [c for c in _csv(complexity) if c in COMPLEXITIES]
    if comps:
        conds.append(FeedbackRequest.complexity.in_(comps))
    if mine_user_id:
        conds.append(FeedbackRequest.submitter_user_id == mine_user_id)
    text = (q or "").strip()
    if text:
        number = parse_ref(text)
        parts = []
        if number is not None:
            parts.append(FeedbackRequest.number == number)
        words = [stem(t) for t in tokens(text)][:8]
        if words:
            parts.append(and_(*[FeedbackRequest.search_text.like(f"%{w}%") for w in words]))
        elif number is None:
            parts.append(FeedbackRequest.search_text.like(f"%{normalize(text)}%"))
        conds.append(or_(*parts))
    return conds


def order_clauses(sort: Optional[str]) -> list[Any]:
    field, _, direction = (sort or "created_at:desc").partition(":")
    desc = direction != "asc"
    if field == "priority":
        expr = case(*[(FeedbackRequest.priority == k, v) for k, v in PRIORITY_RANK.items()], else_=0)
    elif field == "complexity":
        expr = case(*[(FeedbackRequest.complexity == k, v) for k, v in COMPLEXITY_RANK.items()], else_=0)
    elif field == "status":
        order = {"new": 0, "accepted": 1, "planned": 2, "done": 3, "declined": 4}
        expr = case(*[(FeedbackRequest.status == k, v) for k, v in order.items()], else_=9)
        desc = direction == "desc"
        return [expr.desc() if desc else expr.asc(), FeedbackRequest.created_at.desc(), FeedbackRequest.id]
    else:
        expr = FeedbackRequest.created_at
    return [expr.desc() if desc else expr.asc(), FeedbackRequest.created_at.desc(), FeedbackRequest.id]


def next_number(db: Session) -> int:
    return int(db.query(func.coalesce(func.max(FeedbackRequest.number), 0)).scalar() or 0) + 1


def next_seq(db: Session, request_id: str) -> int:
    return int(
        db.query(func.coalesce(func.max(FeedbackMessage.seq), 0)).filter(FeedbackMessage.request_id == request_id).scalar()
        or 0
    ) + 1


def add_message(
    db: Session,
    request_id: str,
    role: str,
    content: str,
    *,
    tool_name: Optional[str] = None,
    tool_payload: Optional[dict[str, Any]] = None,
    model: Optional[str] = None,
    prompt_tokens: Optional[int] = None,
    completion_tokens: Optional[int] = None,
    status: str = "ok",
) -> FeedbackMessage:
    msg = FeedbackMessage(
        request_id=request_id,
        seq=next_seq(db, request_id),
        role=role,
        content=content,
        tool_name=tool_name,
        tool_payload=tool_payload,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        status=status,
    )
    db.add(msg)
    db.flush()
    return msg


def message_payload(m: FeedbackMessage, users: Optional[dict[str, User]] = None, author: str = "") -> dict[str, Any]:
    payload = m.tool_payload if isinstance(m.tool_payload, dict) else {}
    return {
        "id": m.id,
        "seq": m.seq,
        "role": m.role,
        "content": m.content,
        "tool_name": m.tool_name,
        # What a tool line needs (ids to link, a summary); the call arguments and raw result stay server side.
        "ids": payload.get("ids") or [],
        "kind": payload.get("kind"),
        "status": m.status,
        "created_at": to_api_timestamp(m.created_at),
    }


def event_payload(e: FeedbackRequestEvent, users: dict[str, User]) -> dict[str, Any]:
    return {
        "id": e.id,
        "kind": e.kind,
        "actor": user_name(users.get(e.actor_user_id)) if e.actor_user_id else "",
        "before": e.before or {},
        "after": e.after or {},
        "note": e.note or "",
        "created_at": to_api_timestamp(e.created_at),
    }


def add_event(
    db: Session,
    request_id: str,
    actor_id: Optional[str],
    kind: str,
    before: Optional[dict[str, Any]] = None,
    after: Optional[dict[str, Any]] = None,
    note: str = "",
    when: Optional[datetime] = None,
) -> FeedbackRequestEvent:
    ev = FeedbackRequestEvent(
        request_id=request_id,
        actor_user_id=actor_id,
        kind=kind,
        before=before or {},
        after=after or {},
        note=note or "",
        created_at=when or datetime.utcnow(),
    )
    db.add(ev)
    return ev


def draft_days_left(row: FeedbackRequest, retention_days: int, now: Optional[datetime] = None) -> int:
    now = now or datetime.utcnow()
    deadline = row.last_activity_at + timedelta(days=retention_days)
    return max(0, (deadline - now).days)
