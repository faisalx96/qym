"""Project-scoped live evaluation reads and worker controls."""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any, Callable, Iterator, Literal, NoReturn, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    LiveDay,
    LiveJob,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveWorkerEvent,
    LiveWorkerSettings,
    Project,
    ProjectLlmConnection,
    User,
)
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import (
    project_for_read_by_slug,
    require_project_writer,
    require_project_writable,
)
from qym_platform.services import (
    live_control,
    live_events,
    live_jobs,
    live_overview,
    live_turns,
    live_worker_settings,
)
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)
live_router = APIRouter(tags=["live"])


def _sources(db: Session, project_id: str) -> list[LiveSource]:
    """Order project sources by the most recently received heartbeat."""
    return (
        db.query(LiveSource)
        .filter(LiveSource.project_id == project_id)
        .order_by(LiveSource.last_heartbeat_at.desc().nullslast(), LiveSource.key)
        .all()
    )


def _default_source(sources: list[LiveSource]) -> Optional[LiveSource]:
    """Prefer the sole active source, then the most recently heard from."""
    active = [source for source in sources if source.is_active]
    if len(active) == 1:
        return active[0]
    return next(
        (source for source in sources if source.last_heartbeat_at is not None), None
    )


def _selected_source(
    db: Session, principal: Principal, project_slug: str, source: Optional[str]
) -> LiveSource:
    """Resolve a source only after checking the project's read permission."""
    project = project_for_read_by_slug(db, principal, project_slug)
    sources = _sources(db, project.id)
    selected = (
        next((row for row in sources if row.key == source), None)
        if source is not None
        else _default_source(sources)
    )
    if selected is None:
        raise HTTPException(status_code=404, detail="live source not found")
    return selected


def _specs(db: Session, source: LiveSource) -> list[LiveMetricSpec]:
    """Load the selected source's metric definitions in display order."""
    return (
        db.query(LiveMetricSpec)
        .filter(LiveMetricSpec.source_id == source.id)
        .order_by(LiveMetricSpec.position, LiveMetricSpec.metric_name)
        .all()
    )


def _turn_filters(request: Request) -> live_turns.TurnFilters:
    """Preserve repeated filters and report malformed query values as 422."""
    params = {key: request.query_params.getlist(key) for key in request.query_params}
    try:
        return live_turns.TurnFilters.from_query(params)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@live_router.get("/api/projects/{project_slug}/live")
def project_live_sources(
    project_slug: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    """List the live sources visible to this project's reader."""
    project = project_for_read_by_slug(db, principal, project_slug)
    sources = _sources(db, project.id)
    default = _default_source(sources)
    settings = PlatformSettings()
    now = live_overview.utcnow()
    return {
        "sources": [
            live_overview.source_status(source, settings, now) for source in sources
        ],
        "default_source": default.key if default else None,
    }


@live_router.get("/api/projects/{project_slug}/live/overview")
def project_live_overview(
    project_slug: str,
    source: Optional[str] = Query(default=None),
    day: Optional[date] = Query(default=None),
    trend_days: int = Query(default=14),
    days_page: int = Query(default=1, ge=1, le=1_000_000),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    """Return the selected source's overview after checking project read access."""
    selected = _selected_source(db, principal, project_slug, source)
    return live_overview.overview_payload(
        db,
        selected,
        day,
        trend_days,
        PlatformSettings(),
        live_overview.utcnow(),
        page=days_page,
    )


@live_router.get("/api/projects/{project_slug}/live/turns")
def project_live_turns(
    project_slug: str,
    request: Request,
    source: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    """Return filtered turns and facets for the selected source."""
    selected = _selected_source(db, principal, project_slug, source)
    return live_turns.list_turns(
        db, selected, _turn_filters(request), _specs(db, selected)
    )


def _csv_chunks(rows: Iterator[list[str]]) -> Iterator[str]:
    """Encode CSV rows without buffering the complete export."""
    yield "\ufeff"
    with io.StringIO(newline="") as buffer:
        writer = csv.writer(buffer)
        for row in rows:
            writer.writerow(row)
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)


@live_router.get("/api/projects/{project_slug}/live/turns.csv")
def project_live_turns_csv(
    project_slug: str,
    request: Request,
    source: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> StreamingResponse:
    """Stream every matching turn with one CSV column per metric spec."""
    selected = _selected_source(db, principal, project_slug, source)
    filters = _turn_filters(request)
    period = "all"
    if filters.day:
        period = filters.day.isoformat()
    elif filters.date_from or filters.date_to:
        period = f"{filters.date_from or 'all'}_{filters.date_to or 'all'}"
    rows = live_turns.export_rows(db, selected, filters, _specs(db, selected))
    return StreamingResponse(
        _csv_chunks(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="live-turns-{period}.csv"'
        },
    )


@live_router.get(
    "/api/projects/{project_slug}/live/chart-image",
    response_class=Response,
)
def project_live_chart_image(
    project_slug: str,
    request: Request,
    turn_id: str = Query(..., min_length=1, max_length=200),
    ref: str = Query(..., pattern=r"^[A-Za-z0-9_.:-]{1,100}$"),
    source: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Response:
    """Return a chart image after checking the project's read permission."""
    selected = _selected_source(db, principal, project_slug, source)
    row = live_turns.chart_image(db, selected, turn_id, ref)
    if row is None:
        raise HTTPException(status_code=404, detail="chart image not found")
    etag = f'"{row.sha256}"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=86400"}
    if any(
        value.strip().removeprefix("W/") == etag
        for value in request.headers.get("if-none-match", "").split(",")
    ):
        return Response(status_code=304, headers=headers)
    headers["Content-Length"] = str(row.byte_size)
    return Response(content=row.image, media_type=row.content_type, headers=headers)


@live_router.get("/api/projects/{project_slug}/live/turns/{turn_id:path}")
def project_live_turn_detail(
    project_slug: str,
    turn_id: str,
    request: Request,
    source: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    """Return turn evidence and conversation context within the selected source."""
    selected = _selected_source(db, principal, project_slug, source)
    payload = live_turns.turn_detail(
        db,
        selected,
        turn_id,
        _specs(db, selected),
        project_slug=project_slug,
        root_path=request.scope.get("root_path", ""),
    )
    if payload is None:
        raise HTTPException(status_code=404, detail="turn not found")
    return payload


class WorkerStateBody(BaseModel):
    state: Literal["running", "paused"]


class WorkerKeyBody(BaseModel):
    api_key_id: Optional[str]


class WorkerSettingsBody(BaseModel):
    values: live_worker_settings.WorkerSettingsValues
    secrets: dict[str, str] = Field(default_factory=dict)
    note: Optional[str] = Field(default=None, max_length=500)


class WorkerJobBody(BaseModel):
    kind: Literal["backfill_preview", "backfill"]
    since_day: date
    until_day: date
    limit: int


def _worker_project(db: Session, principal: Principal, project_slug: str) -> Project:
    """Keep worker controls hidden from other projects' members."""
    try:
        return project_for_read_by_slug(db, principal, project_slug)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise HTTPException(status_code=404, detail="Project not found") from exc
        raise


def _worker_source(
    project_slug: str,
    source: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> LiveSource:
    try:
        return _selected_source(db, principal, project_slug, source)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise HTTPException(status_code=404, detail="Project not found") from exc
        raise


def _writable_worker_source(
    project_slug: str,
    source: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> LiveSource:
    # Dependencies run before body validation, including for incomplete settings.
    project = _worker_project(db, principal, project_slug)
    require_project_writer(db, project.id)
    require_project_writable(db, project.id)
    selected = _selected_source(db, principal, project_slug, source)
    # Serialize UI mutations and capture audit snapshots after obtaining the lock.
    return (
        db.query(LiveSource)
        .filter_by(id=selected.id)
        .populate_existing()
        .with_for_update()
        .one()
    )


def _worker_state(source: LiveSource, user_name: Callable) -> dict:
    return {
        "desired": source.desired_state,
        "changed_at": to_api_timestamp(source.state_changed_at),
        "changed_by": user_name(source.state_changed_by_user_id),
    }


def _worker_key(
    source: LiveSource, key: Optional[ApiKey], user_name: Callable
) -> Optional[dict]:
    if key is None or key.revoked_at is not None:
        return None
    return {
        "id": key.id,
        "name": key.name,
        "prefix": key.prefix,
        "changed_at": to_api_timestamp(source.worker_key_changed_at),
        "changed_by": user_name(source.worker_key_changed_by_user_id),
    }


def _worker_audit(
    db: Session,
    principal: Principal,
    source: LiveSource,
    action: str,
    before: dict,
    after: dict,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=principal.user.id,
            action=action,
            entity_type="live_source",
            entity_id=source.id,
            before=before,
            after=after,
        )
    )


def _settings_snapshot(row: Optional[LiveWorkerSettings]) -> dict:
    if row is None:
        return {}
    return {
        "version": row.version,
        "values": row.values,
        "secret_hints": row.secret_hints,
    }


def _settings_error(exc: live_worker_settings.SettingsError) -> NoReturn:
    """Translate service validation into the UI's field-addressable errors."""
    if exc.status == 422 and isinstance(exc.detail, str):
        if exc.detail == "connection not found":
            loc = ["body", "values", "models", "connection_id"]
        elif exc.detail.startswith(("missing secret ", "unknown secret ")):
            loc = ["body", "secrets", exc.detail.split(" ", 2)[2]]
        else:
            loc = ["body", "values"]
        raise RequestValidationError(
            [{"loc": loc, "msg": exc.detail, "type": "value_error"}]
        ) from exc
    raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@live_router.get("/api/projects/{project_slug}/live/worker")
def project_live_worker(
    selected: LiveSource = Depends(_worker_source),
    db: Session = Depends(get_db),
) -> dict:
    versions = live_worker_settings.list_versions(db, selected)
    jobs = (
        db.query(LiveJob)
        .filter_by(source_id=selected.id)
        .order_by(LiveJob.requested_at.desc(), LiveJob.id.desc())
        .limit(20)
        .all()
    )
    keys = (
        db.query(ApiKey)
        .filter_by(project_id=selected.project_id, revoked_at=None)
        .order_by(ApiKey.name, ApiKey.id)
        .all()
    )
    connections = (
        db.query(ProjectLlmConnection)
        .filter_by(project_id=selected.project_id)
        .order_by(ProjectLlmConnection.name, ProjectLlmConnection.id)
        .all()
    )
    user_ids = {
        selected.state_changed_by_user_id,
        selected.worker_key_changed_by_user_id,
        *(row.created_by_user_id for row in versions),
        *(job.requested_by_user_id for job in jobs),
    } - {None}
    names = (
        dict(db.query(User.id, User.display_name).filter(User.id.in_(user_ids)).all())
        if user_ids
        else {}
    )
    worker = selected.worker if isinstance(selected.worker, dict) else {}
    running = worker.get("control") if isinstance(worker.get("control"), dict) else None
    models = (running or {}).get("models")
    model_ids = models.get("ids") if isinstance(models, dict) else None
    if not isinstance(model_ids, list) or not all(
        isinstance(item, str) for item in model_ids
    ):
        model_ids = []
    key = next((key for key in keys if key.id == selected.worker_key_id), None)
    now = live_overview.utcnow()
    status = live_overview.source_status(selected, PlatformSettings(), now)
    today = now.date()
    day = db.query(LiveDay).filter_by(source_id=selected.id, day=today).first()
    in_qym = (
        db.query(func.count(LiveTurn.id))
        .filter(LiveTurn.source_id == selected.id, LiveTurn.day == today)
        .scalar()
    )
    return {
        "state": _worker_state(selected, names.get),
        "worker": selected.worker,
        "running": running,
        "stale": status["stale"],
        "status": status,
        "today": {
            "day": today.isoformat(),
            "turns_seen": day.turns_seen if day else 0,
            "evaluated": day.evaluated if day else 0,
            "failed": day.failed if day else 0,
            "in_qym": in_qym,
        },
        "worker_key": _worker_key(selected, key, names.get),
        "api_keys": [
            {"id": key.id, "name": key.name, "prefix": key.prefix} for key in keys
        ],
        "settings": (
            live_worker_settings.version_payload(versions[0], names.get)
            if versions
            else None
        ),
        "versions": [
            live_worker_settings.version_summary(row, names.get) for row in versions
        ],
        "jobs": [live_control.job_dict(job, names.get) for job in jobs],
        "connections": [
            {
                "id": row.id,
                "name": row.name,
                "base_url": row.llm_base_url,
                "api_key_last4": row.llm_api_key_last4,
            }
            for row in connections
        ],
        "model_ids": model_ids,
    }


@live_router.put("/api/projects/{project_slug}/live/worker/state")
def project_live_worker_state(
    body: WorkerStateBody,
    selected: LiveSource = Depends(_writable_worker_source),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict:
    if selected.desired_state != body.state:
        before = {"state": selected.desired_state}
        selected.desired_state = body.state
        selected.state_changed_at = live_overview.utcnow()
        selected.state_changed_by_user_id = principal.user.id
        _worker_audit(
            db, principal, selected, "live.worker.state", before, {"state": body.state}
        )
    payload = {
        "state": _worker_state(selected, lambda uid: live_control._user_name(db, uid))
    }
    db.commit()
    return payload


@live_router.put("/api/projects/{project_slug}/live/worker/key")
def project_live_worker_key(
    body: WorkerKeyBody,
    selected: LiveSource = Depends(_writable_worker_source),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict:
    key = None
    if body.api_key_id is not None:
        key = (
            db.query(ApiKey)
            .filter_by(
                id=body.api_key_id, project_id=selected.project_id, revoked_at=None
            )
            .first()
        )
        if key is None:
            raise HTTPException(status_code=422, detail="api key not found")
    previous = (
        db.get(ApiKey, selected.worker_key_id) if selected.worker_key_id else None
    )
    before = {"prefix": previous.prefix if previous else None}
    selected.worker_key_id = body.api_key_id
    selected.worker_key_changed_at = live_overview.utcnow()
    selected.worker_key_changed_by_user_id = principal.user.id
    _worker_audit(
        db,
        principal,
        selected,
        "live.worker.key",
        before,
        {"prefix": key.prefix if key else None},
    )
    payload = {
        "worker_key": _worker_key(
            selected, key, lambda uid: live_control._user_name(db, uid)
        )
    }
    db.commit()
    return payload


@live_router.post("/api/projects/{project_slug}/live/worker/settings", status_code=201)
def project_live_worker_settings(
    body: WorkerSettingsBody,
    selected: LiveSource = Depends(_writable_worker_source),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict:
    previous = live_worker_settings.current_version(db, selected)
    try:
        row = live_worker_settings.create_version(
            db,
            selected,
            body.values.model_dump(),
            body.secrets,
            body.note,
            principal.user.id,
            now=live_overview.utcnow(),
        )
    except live_worker_settings.SettingsError as exc:
        _settings_error(exc)
    _worker_audit(
        db,
        principal,
        selected,
        "live.worker.settings",
        _settings_snapshot(previous),
        _settings_snapshot(row),
    )
    payload = {"version": row.version}
    db.commit()
    return payload


@live_router.post(
    "/api/projects/{project_slug}/live/worker/settings/{version}/restore",
    status_code=201,
)
def project_live_worker_restore(
    version: int,
    selected: LiveSource = Depends(_writable_worker_source),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict:
    previous = live_worker_settings.current_version(db, selected)
    try:
        row = live_worker_settings.restore_version(
            db, selected, version, principal.user.id, now=live_overview.utcnow()
        )
    except live_worker_settings.SettingsError as exc:
        _settings_error(exc)
    _worker_audit(
        db,
        principal,
        selected,
        "live.worker.restore",
        _settings_snapshot(previous),
        _settings_snapshot(row),
    )
    payload = {"version": row.version}
    db.commit()
    return payload


@live_router.post("/api/projects/{project_slug}/live/worker/jobs", status_code=201)
def project_live_worker_job(
    body: WorkerJobBody,
    selected: LiveSource = Depends(_writable_worker_source),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict:
    try:
        job = live_jobs.create_job(
            db,
            selected,
            body.kind,
            body.since_day,
            body.until_day,
            body.limit,
            PlatformSettings(),
            principal.user.id,
            live_overview.utcnow(),
        )
    except live_jobs.JobError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
    _worker_audit(db, principal, selected, "live.worker.job", {}, job.params)
    payload = live_control.job_dict(job)
    db.commit()
    return payload


@live_router.post("/api/projects/{project_slug}/live/worker/jobs/{job_id}/cancel")
def project_live_worker_cancel(
    job_id: str,
    selected: LiveSource = Depends(_writable_worker_source),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict:
    try:
        job = live_jobs.cancel_job(db, selected, job_id, live_overview.utcnow())
    except live_jobs.JobError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
    payload = live_control.job_dict(job)
    _worker_audit(
        db,
        principal,
        selected,
        "live.worker.job.cancel",
        {},
        {
            "job_id": job.id,
            "status": job.status,
            "cancel_requested": payload["cancel_requested"],
        },
    )
    db.commit()
    return payload


@live_router.get("/api/projects/{project_slug}/live/worker/events")
def project_live_worker_events(
    selected: LiveSource = Depends(_worker_source),
    component: Optional[str] = Query(default=None),
    level: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(LiveWorkerEvent).filter_by(source_id=selected.id)
    if component is not None:
        query = query.filter_by(component=component)
    if level is not None:
        query = query.filter_by(level=level)
    rows = (
        query.order_by(LiveWorkerEvent.last_at.desc(), LiveWorkerEvent.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "events": [
            {
                "id": row.id,
                "level": row.level,
                "component": row.component,
                "code": row.code,
                "message": row.message,
                "details": live_events.redact_details(row.details),
                "count": row.count,
                "first_at": to_api_timestamp(row.first_at),
                "last_at": to_api_timestamp(row.last_at),
            }
            for row in rows
        ]
    }
