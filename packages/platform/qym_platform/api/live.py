"""Project-scoped UI reads for live evaluation sources and their overview."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import LiveSource
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import project_for_read_by_slug
from qym_platform.services import live_overview
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
    days_page: int = Query(default=1, ge=1),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> dict[str, Any]:
    """Return the selected source's overview after checking project read access."""
    project = project_for_read_by_slug(db, principal, project_slug)
    sources = _sources(db, project.id)
    selected = (
        next((row for row in sources if row.key == source), None)
        if source is not None
        else _default_source(sources)
    )
    if selected is None:
        raise HTTPException(status_code=404, detail="live source not found")
    return live_overview.overview_payload(
        db,
        selected,
        day,
        trend_days,
        PlatformSettings(),
        live_overview.utcnow(),
        page=days_page,
    )
