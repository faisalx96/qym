"""Create, list, show, confirm, delete: the non-model operations on feedback requests."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.auth import Principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.feedback_models import (
    FeedbackAgentConnection,
    FeedbackMessage,
    FeedbackRequest,
    FeedbackRequestEvent,
)
from qym_platform.db.models import Project, User
from qym_platform.feedback_agent import connection as conn_mod
from qym_platform.feedback_agent.constants import (
    COMPLEXITIES,
    DEFAULT_MAX_USER_MESSAGES,
    DEFAULT_RETENTION_DAYS,
    MAX_MESSAGE_CHARS,
    PRIORITIES,
    TARGET_KINDS,
    TURN_STALE_SECONDS,
)
from qym_platform.feedback_agent.search import request_ref
from qym_platform.feedback_agent.store import (
    add_event,
    add_message,
    audit,
    draft_days_left,
    error,
    event_payload,
    filter_conditions,
    is_admin,
    lookup_maps,
    message_payload,
    order_clauses,
    row_payload,
    user_name,
)
from qym_platform.feedback_agent.text import search_text
from qym_platform.feedback_agent.tools import checklist_items
from qym_platform.permissions import has_project_access
from qym_platform.settings import PlatformSettings


def retention_days(conn: Optional[FeedbackAgentConnection]) -> int:
    return int(conn.draft_retention_days) if conn and conn.draft_retention_days else DEFAULT_RETENTION_DAYS


def max_user_messages(conn: Optional[FeedbackAgentConnection]) -> int:
    return int(conn.max_user_messages) if conn and conn.max_user_messages else DEFAULT_MAX_USER_MESSAGES


# ---------------------------------------------------------------------------------------------- limits


def _retry_after(oldest: Optional[datetime], window: timedelta) -> int:
    if oldest is None:
        return 1
    return max(1, int((oldest + window - datetime.utcnow()).total_seconds()) + 1)


def check_message_rate(db: Session, user_id: str, settings: Optional[PlatformSettings] = None) -> None:
    limit = (settings or PlatformSettings()).feedback_messages_per_hour
    if limit <= 0:
        return
    since = datetime.utcnow() - timedelta(hours=1)
    q = (
        db.query(FeedbackMessage.created_at)
        .join(FeedbackRequest, FeedbackRequest.id == FeedbackMessage.request_id)
        .filter(FeedbackRequest.submitter_user_id == user_id, FeedbackMessage.role == "user", FeedbackMessage.created_at >= since)
        .order_by(FeedbackMessage.created_at)
    )
    rows = q.all()
    if len(rows) >= limit:
        wait = _retry_after(rows[0][0], timedelta(hours=1))
        raise error(429, "rate_limited", f"Too many messages. Try again in {wait} seconds.", headers={"Retry-After": str(wait)}, retry_after=wait)


def check_draft_rate(db: Session, user_id: str, settings: Optional[PlatformSettings] = None) -> None:
    limit = (settings or PlatformSettings()).feedback_drafts_per_day
    if limit <= 0:
        return
    since = datetime.utcnow() - timedelta(days=1)
    rows = (
        db.query(FeedbackRequest.created_at)
        .filter(FeedbackRequest.submitter_user_id == user_id, FeedbackRequest.created_at >= since)
        .order_by(FeedbackRequest.created_at)
        .all()
    )
    if len(rows) >= limit:
        wait = _retry_after(rows[0][0], timedelta(days=1))
        raise error(429, "rate_limited", f"Too many new requests today. Try again in {wait} seconds.", headers={"Retry-After": str(wait)}, retry_after=wait)


def turn_in_progress(req: FeedbackRequest) -> bool:
    if req.phase != "thinking" or req.turn_started_at is None:
        return False
    return (datetime.utcnow() - req.turn_started_at).total_seconds() < TURN_STALE_SECONDS


def clean_message(content: Any) -> str:
    text = str(content or "").strip()
    if not text:
        raise error(422, "validation", "The message cannot be empty.", field="content")
    if len(text) > MAX_MESSAGE_CHARS:
        raise error(422, "validation", "4,000 characters at most", field="content")
    return text


# ----------------------------------------------------------------------------------------------- status


def status_payload(db: Session, principal: Principal) -> dict[str, Any]:
    conn = conn_mod.get_connection(db)
    return {
        "configured": conn_mod.is_configured(conn),
        "encryption_ready": conn_mod.encryption_ready(),
        "can_configure": is_admin(principal),
    }


# ------------------------------------------------------------------------------------------------ create


def _target(db: Session, project: Project, target: Optional[dict[str, Any]]) -> tuple[Optional[str], Optional[str]]:
    if not target:
        return None, None
    kind, tid = str(target.get("kind") or ""), str(target.get("id") or "")
    if kind not in TARGET_KINDS or not tid:
        raise error(422, "validation", "Unknown target", field="target")
    from qym_platform.db.models import Dataset, EvalExperiment, Run

    model = {"run": Run, "experiment": EvalExperiment, "dataset": Dataset}[kind]
    found = db.query(model.id).filter(model.id == tid, model.project_id == project.id).first()
    if found is None:
        raise error(422, "validation", "That item is not in this project", field="target")
    return kind, tid


def create_draft(db: Session, principal: Principal, body: dict[str, Any]) -> FeedbackRequest:
    subject = body.get("subject")
    if subject not in ("platform", "product"):
        raise error(422, "validation", "Choose what the feedback is about", field="subject")
    message = clean_message(body.get("message"))
    project_id = kind = tid = None
    if subject == "product":
        ref = str(body.get("project_id") or "").strip()
        project = (
            db.query(Project).filter(or_(Project.id == ref, Project.slug == ref)).first() if ref else None
        )
        if project is None:
            raise error(422, "validation", "Choose a project", field="project_id")
        if not has_project_access(db, principal, project.id):
            raise error(403, "no_project_access", "You do not have access to this project")
        project_id = project.id
        kind, tid = _target(db, project, body.get("target"))
    check_draft_rate(db, principal.user.id)
    req = FeedbackRequest(
        subject=subject,
        project_id=project_id,
        target_kind=kind,
        target_id=tid,
        status="draft",
        phase="thinking",
        checklist={},
        conflicts=[],
        agent_reasoning={},
        submitter_user_id=principal.user.id,
        last_activity_at=datetime.utcnow(),
    )
    db.add(req)
    db.flush()
    add_message(db, req.id, "user", message)
    return req


# ------------------------------------------------------------------------------------------------- list


def _drafts(db: Session, principal: Principal, conn: Optional[FeedbackAgentConnection]) -> list[dict[str, Any]]:
    rows = (
        db.query(FeedbackRequest)
        .filter(FeedbackRequest.status == "draft", FeedbackRequest.submitter_user_id == principal.user.id)
        .order_by(FeedbackRequest.last_activity_at.desc())
        .limit(20)
        .all()
    )
    if not rows:
        return []
    counts = dict(
        db.query(FeedbackMessage.request_id, func.count(FeedbackMessage.id))
        .filter(FeedbackMessage.request_id.in_([r.id for r in rows]), FeedbackMessage.role.in_(("user", "assistant")))
        .group_by(FeedbackMessage.request_id)
        .all()
    )
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_({r.project_id for r in rows if r.project_id})).all()}
    days = retention_days(conn)
    return [
        {
            "id": r.id,
            "title": r.title or "",
            "subject": r.subject,
            "project": {"id": p.id, "name": p.name, "slug": p.slug} if (p := projects.get(r.project_id or "")) else None,
            "message_count": int(counts.get(r.id, 0)),
            "last_activity_at": to_api_timestamp(r.last_activity_at),
            "days_left": draft_days_left(r, days),
        }
        for r in rows
    ]


def list_requests(
    db: Session,
    principal: Principal,
    *,
    status: Optional[str] = None,
    about: Optional[str] = None,
    project_id: Optional[str] = None,
    priority: Optional[str] = None,
    complexity: Optional[str] = None,
    q: Optional[str] = None,
    mine: bool = False,
    sort: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    conds = filter_conditions(
        db,
        status=status,
        about=about,
        project_id=project_id,
        priority=priority,
        complexity=complexity,
        q=q,
        mine_user_id=principal.user.id if mine else None,
    )
    matching_ids = select(FeedbackRequest.id).where(*conds)
    top = or_(FeedbackRequest.duplicate_of_id.is_(None), FeedbackRequest.duplicate_of_id.not_in(matching_ids))
    total = db.query(func.count(FeedbackRequest.id)).filter(*conds, top).scalar() or 0
    matching = db.query(func.count(FeedbackRequest.id)).filter(*conds).scalar() or 0
    rows = (
        db.query(FeedbackRequest)
        .filter(*conds, top)
        .order_by(*order_clauses(sort))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    ids = [r.id for r in rows]
    child_rows = (
        db.query(FeedbackRequest)
        .filter(*conds, FeedbackRequest.duplicate_of_id.in_(ids))
        .order_by(FeedbackRequest.created_at)
        .all()
        if ids
        else []
    )
    all_rows = rows + child_rows
    users, projects, refs = lookup_maps(db, all_rows)
    for r in rows:
        refs.setdefault(r.id, request_ref(r.number))
    children: dict[str, list[dict[str, Any]]] = {}
    for c in child_rows:
        children.setdefault(c.duplicate_of_id or "", []).append(row_payload(c, users, projects, refs))
    non_draft = FeedbackRequest.status != "draft"
    total_all = db.query(func.count(FeedbackRequest.id)).filter(non_draft).scalar() or 0
    new_all = db.query(func.count(FeedbackRequest.id)).filter(FeedbackRequest.status == "new").scalar() or 0
    pairs = (
        db.query(func.count(func.distinct(FeedbackRequest.duplicate_of_id)))
        .filter(FeedbackRequest.duplicate_of_id.is_not(None), non_draft)
        .scalar()
        or 0
    )
    project_facets = (
        db.query(Project.id, Project.name, Project.slug, func.count(FeedbackRequest.id))
        .join(FeedbackRequest, FeedbackRequest.project_id == Project.id)
        .filter(non_draft)
        .group_by(Project.id, Project.name, Project.slug)
        .order_by(Project.name)
        .all()
    )
    conn = conn_mod.get_connection(db)
    return {
        "items": [row_payload(r, users, projects, refs) for r in rows],
        "children": children,
        "total": int(total),
        "matching": int(matching),
        "page": page,
        "page_size": page_size,
        "facets": {"projects": [{"id": i, "name": n, "slug": s, "count": int(c)} for i, n, s, c in project_facets]},
        "counts": {"all": int(total_all), "new": int(new_all), "duplicate_pairs": int(pairs)},
        "drafts": _drafts(db, principal, conn),
        "draft_retention_days": retention_days(conn),
        "configured": conn_mod.is_configured(conn),
    }


# ------------------------------------------------------------------------------------------------ detail


def _related(db: Session, req: FeedbackRequest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    refs = [c.get("request_id") for c in (req.conflicts or []) if isinstance(c, dict)]
    numbers = {}
    for ref in refs:
        try:
            numbers[ref] = int(str(ref).split("-")[-1])
        except ValueError:
            continue
    rows = {
        r.number: r
        for r in db.query(FeedbackRequest).filter(FeedbackRequest.number.in_(set(numbers.values()))).all()
    } if numbers else {}
    for c in req.conflicts or []:
        if not isinstance(c, dict):
            continue
        other = rows.get(numbers.get(c.get("request_id")))
        if other is None or other.status == "draft":
            continue
        out.append(
            {
                "kind": c.get("kind"),
                "note": c.get("note") or "",
                "direction": "outgoing",
                "request": {"id": other.id, "ref": request_ref(other.number), "title": other.title, "status": other.status},
            }
        )
    if req.duplicate_of_id:
        canon = db.get(FeedbackRequest, req.duplicate_of_id)
        if canon is not None:
            out.insert(
                0,
                {
                    "kind": "duplicate",
                    "note": "Marked as a duplicate of this request.",
                    "direction": "canonical",
                    "request": {"id": canon.id, "ref": request_ref(canon.number), "title": canon.title, "status": canon.status},
                },
            )
    dups = (
        db.query(FeedbackRequest)
        .filter(FeedbackRequest.duplicate_of_id == req.id, FeedbackRequest.status != "draft")
        .order_by(FeedbackRequest.created_at)
        .all()
    )
    for d in dups:
        out.append(
            {
                "kind": "duplicate",
                "note": "Marked as a duplicate of this request.",
                "direction": "duplicate",
                "request": {"id": d.id, "ref": request_ref(d.number), "title": d.title, "status": d.status},
            }
        )
    return out


def detail_payload(db: Session, principal: Principal, req: FeedbackRequest) -> dict[str, Any]:
    users, projects, refs = lookup_maps(db, [req])
    refs.setdefault(req.id, request_ref(req.number))
    base = row_payload(req, users, projects, refs)
    conn = conn_mod.get_connection(db)
    target = None
    if req.target_kind and req.target_id:
        accessible = bool(req.project_id) and has_project_access(db, principal, req.project_id)
        target = {"kind": req.target_kind, "id": req.target_id, "accessible": accessible}
    events = (
        db.query(FeedbackRequestEvent)
        .filter(FeedbackRequestEvent.request_id == req.id)
        .order_by(FeedbackRequestEvent.created_at.desc(), FeedbackRequestEvent.id.desc())
        .all()
    )
    ev_users = {u.id: u for u in db.query(User).filter(User.id.in_({e.actor_user_id for e in events if e.actor_user_id})).all()} if events else {}
    reasoning = req.agent_reasoning or {}
    payload: dict[str, Any] = {
        "request": {
            **base,
            "description": req.description,
            "business_need": req.business_need,
            "justification": req.justification,
            "decline_reason": req.decline_reason,
            "target": target,
            "phase": req.phase,
            "agent": {
                "priority": req.agent_priority,
                "complexity": req.agent_complexity,
                "priority_reasoning": reasoning.get("priority"),
                "complexity_reasoning": reasoning.get("complexity"),
            },
            "updated_at": to_api_timestamp(req.updated_at),
        },
        "events": [event_payload(e, ev_users) for e in events],
        "related": _related(db, req) if req.status != "draft" else [],
        "checklist": checklist_items(req.checklist) if req.status == "draft" else [],
        "proposal": req.proposal if req.status == "draft" else None,
    }
    if req.status == "draft":
        user_msgs = (
            db.query(func.count(FeedbackMessage.id))
            .filter(FeedbackMessage.request_id == req.id, FeedbackMessage.role == "user")
            .scalar()
            or 0
        )
        payload["draft"] = {
            "retention_days": retention_days(conn),
            "days_left": draft_days_left(req, retention_days(conn)),
            "last_activity_at": to_api_timestamp(req.last_activity_at),
            "user_message_count": int(user_msgs),
            "max_user_messages": max_user_messages(conn),
            "configured": conn_mod.is_configured(conn),
        }
    return payload


def messages_payload(db: Session, req: FeedbackRequest, before_seq: Optional[int], limit: int) -> dict[str, Any]:
    limit = max(1, min(limit, 200))
    q = db.query(FeedbackMessage).filter(FeedbackMessage.request_id == req.id)
    if before_seq:
        q = q.filter(FeedbackMessage.seq < before_seq)
    rows = q.order_by(FeedbackMessage.seq.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    submitter = db.get(User, req.submitter_user_id)
    return {
        "messages": [message_payload(m) for m in rows],
        "has_more": has_more,
        "author": user_name(submitter),
        "submitted_at": to_api_timestamp(req.confirmed_at),
    }


# ----------------------------------------------------------------------------------------------- confirm


def confirm(db: Session, principal: Principal, req: FeedbackRequest, body: dict[str, Any]) -> None:
    if req.status != "draft":
        raise error(409, "already_confirmed", "This request is already submitted", request=request_ref(req.number))
    proposal = req.proposal
    if not proposal:
        raise error(409, "no_proposal", "There is no proposal to submit")
    if proposal.get("superseded") or int(body.get("proposal_seq") or -1) != int(proposal.get("seq") or -2):
        raise error(409, "proposal_stale", "The conversation moved on. Ask the assistant to propose again.")
    title = " ".join(str(body.get("title") or "").split())
    description = str(body.get("description") or "").strip()
    if not title or len(title) > 200:
        raise error(422, "validation", "Title is required (up to 200 characters).", field="title")
    if not description or len(description) > 4000:
        raise error(422, "validation", "The description cannot be empty.", field="description")
    priority, complexity = body.get("priority"), body.get("complexity")
    if priority not in PRIORITIES:
        raise error(422, "validation", "Choose a priority", field="priority")
    if complexity not in COMPLEXITIES:
        raise error(422, "validation", "Choose a complexity", field="complexity")
    now = datetime.utcnow()
    req.title = title
    req.summary = proposal.get("summary") or title
    req.description = description
    req.business_need = proposal.get("business_need") or ""
    req.justification = proposal.get("justification") or ""
    req.priority, req.complexity = priority, complexity
    req.agent_priority = (proposal.get("priority") or {}).get("level")
    req.agent_complexity = (proposal.get("complexity") or {}).get("level")
    req.agent_reasoning = {
        "priority": (proposal.get("priority") or {}).get("reasoning"),
        "complexity": (proposal.get("complexity") or {}).get("reasoning"),
    }
    req.conflicts = [
        {"request_id": r.get("request_id"), "kind": r.get("kind"), "note": r.get("note")}
        for r in (proposal.get("related") or [])
    ]
    req.search_text = search_text(req.title, req.summary, req.business_need)
    req.status, req.phase = "new", None
    req.confirmed_at = req.last_activity_at = req.updated_at = now
    for attempt in range(6):
        number = int(db.query(func.coalesce(func.max(FeedbackRequest.number), 0)).scalar() or 0) + 1 + attempt
        try:
            with db.begin_nested():
                req.number = number
                db.flush()
            break
        except IntegrityError:
            req.number = None
    else:
        raise error(409, "conflict", "Could not allocate a request number. Try again.")
    add_event(db, req.id, principal.user.id, "submitted", {}, {"priority": priority, "complexity": complexity}, "", now)
    audit(db, principal.user.id, "feedback.confirmed", req.id, {}, {"ref": request_ref(req.number), "priority": priority, "complexity": complexity})


def delete_draft(db: Session, principal: Principal, req: FeedbackRequest) -> None:
    db.query(FeedbackMessage).filter(FeedbackMessage.request_id == req.id).delete(synchronize_session=False)
    db.query(FeedbackRequestEvent).filter(FeedbackRequestEvent.request_id == req.id).delete(synchronize_session=False)
    audit(db, principal.user.id, "feedback.draft_deleted", req.id, {"messages": True}, {})
    db.delete(req)
