"""Project-scoped UI reads for live evaluation sources, overview and turns."""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any, Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import LiveMetricSpec, LiveSource
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import project_for_read_by_slug
from qym_platform.services import live_overview, live_turns
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
