"""Feedback API (``/v1/feedback*``) and the Admin connection of the feedback assistant (``/v1/admin/feedback-agent*``).

UI principal only (SDK API keys get 401 from ``require_ui_principal``). Spec: docs/internal/feature-rounds/2026-10-ai-feedback/spec-e.md.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.feedback_models import (FeedbackAgentConnection,
                                             FeedbackMessage, FeedbackRequest,
                                             FeedbackRequestEvent)
from qym_platform.deps import get_db
from qym_platform.feedback_agent import agent as agent_mod
from qym_platform.feedback_agent import connection as conn_mod
from qym_platform.feedback_agent import export as export_mod
from qym_platform.feedback_agent import lifecycle, triage
from qym_platform.feedback_agent.constants import (DEFAULT_MAX_USER_MESSAGES,
                                                   DEFAULT_RETENTION_DAYS,
                                                   MAX_USER_MESSAGES_RANGE,
                                                   RETENTION_DAYS_RANGE)
from qym_platform.feedback_agent.search import request_ref
from qym_platform.feedback_agent.store import (FeedbackError, add_message,
                                               audit, error, event_payload,
                                               filter_conditions, is_admin,
                                               load_own_draft, load_visible,
                                               lookup_maps, order_clauses,
                                               user_name)
from qym_platform.llm_endpoint_security import (LlmEndpointValidationError,
                                                validate_llm_base_url)
from qym_platform.log import get_logger
from qym_platform.secrets import build_llm_config_storage, encryption_available
from qym_platform.settings import PlatformSettings
from sqlalchemy import func
from sqlalchemy.orm import Session, sessionmaker

logger = get_logger(__name__)

router = APIRouter(tags=["feedback"])

PING_SECONDS = 15.0


async def feedback_error_handler(_request: Request, exc: FeedbackError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.body(), headers=exc.headers)


def _require_admin(principal: Principal) -> None:
    if not is_admin(principal):
        raise error(403, "not_admin", "Admin only")


# ---------------------------------------------------------------------------------------------- status


@router.get("/v1/feedback/status")
def feedback_status(
    db: Session = Depends(get_db), principal: Principal = Depends(require_ui_principal)
) -> dict[str, Any]:
    return lifecycle.status_payload(db, principal)


# ------------------------------------------------------------------------------------------------ list


@router.get("/v1/feedback")
def list_feedback(
    status: Optional[str] = None,
    about: Optional[str] = None,
    project_id: Optional[str] = None,
    priority: Optional[str] = None,
    complexity: Optional[str] = None,
    q: Optional[str] = None,
    mine: bool = False,
    sort: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    return lifecycle.list_requests(
        db,
        principal,
        status=status,
        about=about,
        project_id=project_id,
        priority=priority,
        complexity=complexity,
        q=q,
        mine=mine,
        sort=sort,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------------------------- export


def _export(
    fmt: str,
    db: Session,
    principal: Principal,
    status: Optional[str],
    about: Optional[str],
    project_id: Optional[str],
    priority: Optional[str],
    complexity: Optional[str],
    q: Optional[str],
    sort: Optional[str],
) -> Response:
    _require_admin(principal)
    if fmt not in export_mod.FORMATS:
        raise error(
            422,
            "validation",
            "Unknown format. Accepted values: " + ", ".join(export_mod.FORMATS),
            accepted=list(export_mod.FORMATS),
        )
    conds = filter_conditions(
        db,
        status=status,
        about=about,
        project_id=project_id,
        priority=priority,
        complexity=complexity,
        q=q,
    )
    rows = db.query(FeedbackRequest).filter(*conds).order_by(*order_clauses(sort)).all()
    users, projects, refs = lookup_maps(db, rows)
    for r in rows:
        refs.setdefault(r.id, request_ref(r.number))
    records = export_mod.export_records(rows, users, projects, refs)
    body = export_mod.render(fmt, records)
    audit(
        db,
        principal.user.id,
        "feedback.export",
        "list",
        {},
        {
            "format": fmt,
            "rows": len(records),
            "filter": {
                k: v
                for k, v in dict(
                    status=status,
                    about=about,
                    project_id=project_id,
                    priority=priority,
                    complexity=complexity,
                    q=q,
                    sort=sort,
                ).items()
                if v
            },
        },
    )
    db.commit()
    content_type, _ext = export_mod.FORMATS[fmt]
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{export_mod.filename(fmt)}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/v1/feedback/export")
def export_feedback(
    format: str = "csv",
    status: Optional[str] = None,
    about: Optional[str] = None,
    project_id: Optional[str] = None,
    priority: Optional[str] = None,
    complexity: Optional[str] = None,
    q: Optional[str] = None,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    return _export(
        format, db, principal, status, about, project_id, priority, complexity, q, sort
    )


@router.get("/v1/feedback/export.csv")
def export_feedback_csv(
    status: Optional[str] = None,
    about: Optional[str] = None,
    project_id: Optional[str] = None,
    priority: Optional[str] = None,
    complexity: Optional[str] = None,
    q: Optional[str] = None,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    return _export(
        "csv", db, principal, status, about, project_id, priority, complexity, q, sort
    )


# ----------------------------------------------------------------------------------------------- create


class TargetBody(BaseModel):
    kind: str
    id: str


class CreateBody(BaseModel):
    subject: str
    project_id: Optional[str] = None
    target: Optional[TargetBody] = None
    message: str


def _require_configured(db: Session) -> FeedbackAgentConnection:
    conn = conn_mod.get_connection(db)
    if not conn_mod.is_configured(conn):
        raise error(
            503, "feedback_not_configured", "The feedback assistant is not set up"
        )
    return conn  # type: ignore[return-value]


@router.post("/v1/feedback", status_code=201)
def create_feedback(
    body: CreateBody,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    _require_configured(db)
    req = lifecycle.create_draft(db, principal, body.model_dump())
    db.commit()
    return {"id": req.id, "status": "draft"}


@router.get("/v1/feedback/targets")
def feedback_targets(
    project_id: str,
    kind: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    """Items a product request can point at (names only; the person picks, never types: QE-D5)."""
    from qym_platform.db.models import Dataset, EvalExperiment, Project, Run
    from qym_platform.permissions import has_project_access
    from sqlalchemy import or_

    project = (
        db.query(Project)
        .filter(or_(Project.id == project_id, Project.slug == project_id))
        .first()
    )
    if project is None:
        raise error(404, "not_found", "Project not found")
    if not has_project_access(db, principal, project.id):
        raise error(403, "no_project_access", "You do not have access to this project")
    if kind == "run":
        rows = (
            db.query(Run.id, Run.task, Run.dataset)
            .filter(Run.project_id == project.id, Run.deleted_at.is_(None))
            .order_by(Run.created_at.desc())
            .limit(50)
            .all()
        )
        items = [{"id": r[0], "label": f"{r[1]} on {r[2]}"} for r in rows]
    elif kind == "experiment":
        rows = (
            db.query(EvalExperiment.id, EvalExperiment.name)
            .filter(EvalExperiment.project_id == project.id)
            .order_by(EvalExperiment.created_at.desc())
            .limit(50)
            .all()
        )
        items = [{"id": r[0], "label": r[1]} for r in rows]
    elif kind == "dataset":
        rows = (
            db.query(Dataset.id, Dataset.name)
            .filter(Dataset.project_id == project.id, Dataset.deleted_at.is_(None))
            .order_by(Dataset.name)
            .limit(100)
            .all()
        )
        items = [{"id": r[0], "label": r[1]} for r in rows]
    else:
        raise error(422, "validation", "Unknown kind", field="kind")
    return {"items": items}


# ------------------------------------------------------------------------------------------------ read


@router.get("/v1/feedback/{ref}")
def get_feedback(
    ref: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    req = load_visible(db, principal, ref)
    return lifecycle.detail_payload(db, principal, req)


@router.get("/v1/feedback/{ref}/messages")
def get_messages(
    ref: str,
    before_seq: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    req = load_visible(db, principal, ref)
    return lifecycle.messages_payload(db, req, before_seq, limit)


# ----------------------------------------------------------------------------------------------- turns


class MessageBody(BaseModel):
    content: str


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode(
        "utf-8"
    )


def _public_error(data: dict[str, Any], admin: bool) -> dict[str, Any]:
    detail = data.get("admin_detail") or ""
    return {
        "code": data.get("code"),
        "message": detail if (admin and detail) else data.get("message"),
        "retryable": bool(data.get("retryable")),
    }


async def _turn_response(
    request: Request,
    db: Session,
    principal: Principal,
    req: FeedbackRequest,
    preface: list[tuple[str, dict[str, Any]]],
) -> Response:
    engine = db.get_bind()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    request_id = req.id
    admin = is_admin(principal)
    queue: "asyncio.Queue[Optional[tuple[str, dict[str, Any]]]]" = asyncio.Queue()
    runner = agent_mod.TurnRunner(factory, request_id, queue=queue)
    task = asyncio.get_running_loop().create_task(runner.run())
    agent_mod.RUNNING[request_id] = task
    wants_json = "text/event-stream" not in request.headers.get(
        "accept", ""
    ) and "application/json" in request.headers.get("accept", "")

    if wants_json:
        events: list[tuple[str, dict[str, Any]]] = list(preface)
        while True:
            item = await queue.get()
            if item is None:
                break
            events.append(item)
        text = "".join(d.get("text", "") for e, d in events if e == "delta")
        err = next((d for e, d in events if e == "error"), None)
        if err:
            pub = _public_error(err, admin)
            return JSONResponse(
                status_code=502,
                content={
                    "detail": pub["message"],
                    "code": pub["code"],
                    "retryable": pub["retryable"],
                },
            )
        done = next((d for e, d in events if e == "done"), {})
        checklist = next((d for e, d in reversed(events) if e == "checklist"), None)
        proposal = next((d for e, d in reversed(events) if e == "proposal"), None)
        return JSONResponse(
            {"text": text, **done, "checklist": checklist, "proposal": proposal}
        )

    async def stream():
        for event, data in preface:
            yield _sse(event, data)
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), PING_SECONDS)
            except asyncio.TimeoutError:
                yield b": ping\n\n"
                continue
            if item is None:
                return
            event, data = item
            if event == "error":
                data = _public_error(data, admin)
            yield _sse(event, data)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _begin_turn(db: Session, req: FeedbackRequest) -> None:
    # The stored phase is the truth (it is committed before the `done` event); a task that is still unwinding is not a turn.
    if lifecycle.turn_in_progress(req):
        raise error(
            409,
            "turn_in_progress",
            "The assistant is already answering in another window.",
        )


@router.post("/v1/feedback/{ref}/messages")
async def post_message(
    ref: str,
    body: MessageBody,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    req = load_own_draft(db, principal, ref)
    _require_configured(db)
    content = lifecycle.clean_message(body.content)
    _begin_turn(db, req)
    lifecycle.check_message_rate(db, principal.user.id)
    msg = add_message(db, req.id, "user", content)
    if req.proposal and not req.proposal.get("superseded"):
        req.proposal = {**req.proposal, "superseded": True}
    now = datetime.utcnow()
    req.phase = "thinking"
    req.turn_started_at = now
    req.last_activity_at = now
    preface = [
        (
            "message",
            {
                "id": msg.id,
                "seq": msg.seq,
                "role": "user",
                "created_at": to_api_timestamp(msg.created_at),
            },
        )
    ]
    db.commit()
    return await _turn_response(request, db, principal, req, preface)


@router.post("/v1/feedback/{ref}/turn")
async def post_turn(
    ref: str,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    req = load_own_draft(db, principal, ref)
    _require_configured(db)
    _begin_turn(db, req)
    last = (
        db.query(FeedbackMessage)
        .filter(
            FeedbackMessage.request_id == req.id,
            FeedbackMessage.role.in_(("user", "assistant")),
        )
        .order_by(FeedbackMessage.seq.desc())
        .first()
    )
    if last is None or last.role != "user":
        raise error(
            409, "nothing_to_answer", "There is no message waiting for an answer"
        )
    now = datetime.utcnow()
    req.phase = "thinking"
    req.turn_started_at = now
    db.commit()
    return await _turn_response(request, db, principal, req, [])


@router.post("/v1/feedback/{ref}/stop", status_code=204)
async def stop_turn(
    ref: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    req = load_own_draft(db, principal, ref)
    task = agent_mod.RUNNING.get(req.id)
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except BaseException:  # noqa: BLE001 - the runner re-raises its cancellation
            pass
    return Response(status_code=204)


# --------------------------------------------------------------------------------------- confirm/delete


class ConfirmBody(BaseModel):
    title: str
    description: str
    priority: str
    complexity: str
    proposal_seq: int


@router.post("/v1/feedback/{ref}/confirm")
def confirm_feedback(
    ref: str,
    body: ConfirmBody,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    req = load_visible(db, principal, ref)
    if req.status != "draft":
        raise error(
            409,
            "already_confirmed",
            "This request is already submitted",
            request=request_ref(req.number),
        )
    if req.submitter_user_id != principal.user.id:
        raise error(404, "not_found", "This request does not exist or is not yours")
    if lifecycle.turn_in_progress(req):
        raise error(409, "turn_in_progress", "The assistant is still answering.")
    lifecycle.confirm(db, principal, req, body.model_dump())
    db.commit()
    return lifecycle.detail_payload(db, principal, req)


@router.delete("/v1/feedback/{ref}", status_code=204)
def delete_feedback(
    ref: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    req = load_own_draft(db, principal, ref)
    task = agent_mod.RUNNING.get(req.id)
    if task is not None and not task.done():
        task.cancel()
    lifecycle.delete_draft(db, principal, req)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------------------------------ triage


class TriageBody(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    complexity: Optional[str] = None
    duplicate_of: Optional[str] = None
    note: Optional[str] = None
    decline_reason: Optional[str] = None
    expected_updated_at: Optional[str] = None


@router.patch("/v1/feedback/{ref}/triage")
def triage_feedback(
    ref: str,
    body: TriageBody,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    _require_admin(principal)
    req = load_visible(db, principal, ref)
    new_events = triage.apply_triage(
        db, principal, req, body.model_dump(exclude_unset=True)
    )
    db.commit()
    payload = lifecycle.detail_payload(db, principal, req)
    users = {u.id: u for u in [principal.user]}
    payload["new_events"] = [event_payload(e, users) for e in new_events]
    return payload


# ----------------------------------------------------------------------------------- Admin: connection


class ConnectionBody(BaseModel):
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    draft_retention_days: Optional[int] = None
    max_user_messages: Optional[int] = None


def _admin_payload(db: Session) -> dict[str, Any]:
    conn = conn_mod.get_connection(db)
    week = datetime.utcnow() - timedelta(days=7)
    requests = (
        db.query(func.count(FeedbackRequest.id))
        .filter(FeedbackRequest.status != "draft")
        .scalar()
        or 0
    )
    new = (
        db.query(func.count(FeedbackRequest.id))
        .filter(FeedbackRequest.status == "new")
        .scalar()
        or 0
    )
    drafts = (
        db.query(func.count(FeedbackRequest.id))
        .filter(FeedbackRequest.status == "draft")
        .scalar()
        or 0
    )
    calls = (
        db.query(func.count(FeedbackMessage.id))
        .filter(FeedbackMessage.role == "assistant", FeedbackMessage.created_at >= week)
        .scalar()
        or 0
    )
    return {
        "configured": conn_mod.is_configured(conn),
        "encryption_ready": conn_mod.encryption_ready(),
        "connection": {
            "llm_base_url": conn.llm_base_url if conn else "",
            "llm_model": conn.llm_model if conn else "",
            "llm_api_key_set": bool(conn and conn.llm_api_key_encrypted),
            "llm_api_key_hint": conn_mod.api_key_hint(conn),
        },
        "behaviour": {
            "draft_retention_days": lifecycle.retention_days(conn),
            "max_user_messages": lifecycle.max_user_messages(conn),
        },
        "last_test": {
            "at": to_api_timestamp(conn.last_test_at) if conn else None,
            "ok": conn.last_test_ok if conn else None,
            "detail": (conn.last_test_detail if conn else None),
        },
        "counts": {
            "requests": int(requests),
            "new": int(new),
            "open_drafts": int(drafts),
            "assistant_calls_7d": int(calls),
        },
        "updated_at": to_api_timestamp(conn.updated_at) if conn else None,
    }


@router.get("/v1/admin/feedback-agent")
def get_agent_connection(
    db: Session = Depends(get_db), principal: Principal = Depends(require_ui_principal)
) -> dict[str, Any]:
    _require_admin(principal)
    return _admin_payload(db)


def _validated_url(value: str, settings: PlatformSettings) -> str:
    try:
        url = validate_llm_base_url(
            value, allow_private=settings.allow_private_llm_base_urls
        )
    except LlmEndpointValidationError as exc:
        code = "private_url" if "non-public" in str(exc) else "validation"
        raise error(400, code, str(exc)) from exc
    if not settings.allow_private_llm_base_urls and not url.lower().startswith(
        "https://"
    ):
        raise error(400, "https_required", "An https:// URL is required.")
    return url


@router.put("/v1/admin/feedback-agent")
def put_agent_connection(
    body: ConnectionBody,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    _require_admin(principal)
    settings = PlatformSettings()
    conn = conn_mod.get_connection(db)
    created = conn is None
    if conn is None:
        conn = FeedbackAgentConnection(
            id=1,
            draft_retention_days=DEFAULT_RETENTION_DAYS,
            max_user_messages=DEFAULT_MAX_USER_MESSAGES,
            llm_base_url="",
            llm_model="",
            llm_api_key_encrypted="",
            llm_api_key_last4="",
        )
        db.add(conn)
    before = {
        "llm_base_url": conn.llm_base_url,
        "llm_model": conn.llm_model,
        "llm_api_key_set": bool(conn.llm_api_key_encrypted),
        "llm_api_key_hint": conn_mod.api_key_hint(conn),
        "draft_retention_days": conn.draft_retention_days,
        "max_user_messages": conn.max_user_messages,
    }
    if body.draft_retention_days is not None:
        lo, hi = RETENTION_DAYS_RANGE
        if not lo <= body.draft_retention_days <= hi:
            raise error(
                422,
                "validation",
                f"Keep drafts for {lo} to {hi} days.",
                field="draft_retention_days",
            )
        conn.draft_retention_days = body.draft_retention_days
    if body.max_user_messages is not None:
        lo, hi = MAX_USER_MESSAGES_RANGE
        if not lo <= body.max_user_messages <= hi:
            raise error(
                422,
                "validation",
                f"Most messages per request: {lo} to {hi}.",
                field="max_user_messages",
            )
        conn.max_user_messages = body.max_user_messages
    touches = any(
        v is not None for v in (body.llm_base_url, body.llm_model, body.llm_api_key)
    )
    if touches:
        url = (
            _validated_url(body.llm_base_url, settings)
            if body.llm_base_url is not None
            else conn.llm_base_url
        )
        model = body.llm_model.strip() if body.llm_model is not None else conn.llm_model
        if not url:
            raise error(
                422, "validation", "Base URL is required.", field="llm_base_url"
            )
        if not model:
            raise error(422, "validation", "Model is required.", field="llm_model")
        key = (
            (body.llm_api_key or "").strip()
            if body.llm_api_key is not None
            else "__KEEP__"
        )
        if key == "__KEEP__":
            if not conn.llm_api_key_encrypted:
                raise error(
                    422, "validation", "An API key is required.", field="llm_api_key"
                )
        elif not key:
            raise error(
                422, "validation", "An API key is required.", field="llm_api_key"
            )
        else:
            if not encryption_available(settings):
                raise error(
                    400,
                    "encryption_not_configured",
                    "LLM config encryption is not configured (QYM_LLM_CONFIG_ENCRYPTION_KEY)",
                )
            stored = build_llm_config_storage(
                base_url=url, model=model, api_key=key, settings=settings
            )
            conn.llm_api_key_encrypted = stored["llm_api_key_encrypted"]
            conn.llm_api_key_last4 = stored["llm_api_key_last4"]
        conn.llm_base_url, conn.llm_model = url, model
    conn.updated_by_user_id = principal.user.id
    conn.updated_at = datetime.utcnow()
    db.flush()
    after = {
        "llm_base_url": conn.llm_base_url,
        "llm_model": conn.llm_model,
        "llm_api_key_set": bool(conn.llm_api_key_encrypted),
        "llm_api_key_hint": conn_mod.api_key_hint(conn),
        "draft_retention_days": conn.draft_retention_days,
        "max_user_messages": conn.max_user_messages,
    }
    audit(
        db,
        principal.user.id,
        "feedback.agent_connection_updated",
        "connection",
        before if not created else {},
        after,
    )
    db.commit()
    logger.info("feedback agent connection updated")
    return _admin_payload(db)


@router.delete("/v1/admin/feedback-agent", status_code=204)
def delete_agent_connection(
    db: Session = Depends(get_db), principal: Principal = Depends(require_ui_principal)
) -> Response:
    _require_admin(principal)
    conn = conn_mod.get_connection(db)
    if conn is not None:
        before = {
            "llm_base_url": conn.llm_base_url,
            "llm_model": conn.llm_model,
            "llm_api_key_set": bool(conn.llm_api_key_encrypted),
        }
        # Keep the behaviour numbers; clear the connection and its key.
        conn.llm_base_url = conn.llm_model = conn.llm_api_key_encrypted = (
            conn.llm_api_key_last4
        ) = ""
        conn.last_test_at = conn.last_test_ok = conn.last_test_detail = None
        audit(
            db,
            principal.user.id,
            "feedback.agent_connection_removed",
            "connection",
            before,
            {"llm_api_key_set": False},
        )
        db.commit()
    return Response(status_code=204)


@router.post("/v1/admin/feedback-agent/test")
async def test_agent_connection(
    body: Optional[ConnectionBody] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    _require_admin(principal)
    body = body or ConnectionBody()
    settings = PlatformSettings()
    conn = conn_mod.get_connection(db)
    url = (body.llm_base_url or "").strip() or (conn.llm_base_url if conn else "")
    model = (body.llm_model or "").strip() or (conn.llm_model if conn else "")
    key = (body.llm_api_key or "").strip()
    stored_key = False
    if not key or key == "__KEEP__":
        if conn is None or not conn.llm_api_key_encrypted:
            raise error(
                422, "validation", "An API key is required.", field="llm_api_key"
            )
        try:
            key = conn_mod.read_api_key(conn, settings)
        except conn_mod.AgentError as exc:
            result = {
                "ok": False,
                "model": model,
                "latency_ms": 0,
                "tool_call": False,
                "detail": exc.admin_detail or exc.message,
            }
            return result
        stored_key = True
    if not url or not model:
        raise error(422, "validation", "Base URL and model are required.")
    url = _validated_url(url, settings)
    result = await conn_mod.test_connection(url, model, key)
    if (
        conn is not None
        and stored_key
        and url == conn.llm_base_url
        and model == conn.llm_model
    ):
        conn.last_test_at = datetime.utcnow()
        conn.last_test_ok = bool(result["ok"])
        conn.last_test_detail = (result.get("detail") or "")[:500] or None
    audit(
        db,
        principal.user.id,
        "feedback.agent_connection_tested",
        "connection",
        {},
        {"ok": bool(result["ok"]), "latency_ms": result["latency_ms"]},
    )
    db.commit()
    return result
