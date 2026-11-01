"""API-key authenticated ingestion of project live evaluation state."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.api.ingest import require_ingest_open
from qym_platform.auth import Principal, require_api_key_principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import LiveDay, LiveSource, Project
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import (
    ARCHIVED_PROJECT_DETAIL,
    PROJECT_STATE_HEADER,
    is_project_archived,
)
from qym_platform.services import live_ingest

logger = get_logger(__name__)

# Every live write honours the maintenance window exactly like the run ingest routes.
live_ingest_router = APIRouter(
    prefix="/v1/projects/{project_id}/live",
    tags=["live-ingest"],
    dependencies=[Depends(require_ingest_open)],
)
_SOURCE_KEY_PATTERN = r"^[A-Za-z0-9_.:-]{1,100}$"


class SourceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=200)
    environment: str = Field(..., min_length=1, max_length=50)
    product: Optional[str] = Field(default=None, max_length=100)
    worker: dict[str, Any] = Field(default_factory=dict)
    day_key_timezone: str = Field(default="UTC", min_length=1, max_length=40)


class HeartbeatBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: datetime
    last_poll_at: Optional[datetime] = None
    current_day: Optional[date] = None
    worker: Optional[dict[str, Any]] = None


class MetricSpecBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_name: str = Field(..., min_length=1, max_length=200)
    group: str = Field(..., min_length=1, max_length=50)
    label: str = Field(..., min_length=1, max_length=120)
    score_type: Literal["percentage", "boolean", "numeric", "categorical", "duration"]
    direction: Optional[Literal["maximize", "minimize"]] = None
    pass_threshold: Optional[float] = None
    unit: Optional[str] = Field(default=None, max_length=80)
    precision: Optional[int] = Field(default=None, ge=0)
    is_primary: bool = False
    position: int = Field(default=0, ge=0)
    description: Optional[str] = None
    values: Optional[list[dict[str, Any]]] = None


class MetricSpecsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specs: list[MetricSpecBody]


class DayBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_ref: Optional[str] = Field(default=None, max_length=100)
    status: Literal["running", "closed"] = "running"
    turns_seen: int = Field(default=0, ge=0)
    evaluated: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    incomplete: int = Field(default=0, ge=0)
    excluded: int = Field(default=0, ge=0)
    first_poll_at: Optional[datetime] = None
    last_poll_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


def _source_scope(
    project_id: str,
    principal: Principal = Depends(require_api_key_principal),
    db: Session = Depends(get_db),
) -> tuple[Project, Principal]:
    """Allow writes only within the API key's active project."""
    if principal.project_id != project_id:
        raise HTTPException(
            status_code=403, detail="API key belongs to another project"
        )
    if is_project_archived(db, project_id):
        raise HTTPException(
            status_code=409,
            detail=ARCHIVED_PROJECT_DETAIL,
            headers={PROJECT_STATE_HEADER: "archived"},
        )
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project, principal


def _source(db: Session, project_id: str, key: str) -> LiveSource:
    """Lock an existing source for a scoped ingest write."""
    source = (
        db.query(LiveSource)
        .filter(LiveSource.project_id == project_id, LiveSource.key == key)
        .with_for_update()
        .first()
    )
    if source is None:
        raise HTTPException(status_code=404, detail="live source not found")
    return source


def _commit(db: Session) -> None:
    """Commit an ingest write or report a conflicting request."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Live ingest conflicts with existing data"
        ) from None


def _source_payload(source: LiveSource) -> dict[str, Any]:
    """Serialize the source configuration returned by an upsert."""
    return {
        "id": source.id,
        "key": source.key,
        "name": source.name,
        "environment": source.environment,
        "product": source.product,
        "worker": source.worker,
        "created_at": to_api_timestamp(source.created_at),
    }


def _day_payload(row: LiveDay) -> dict[str, Any]:
    """Serialize a day with UTC timestamps and an ISO date."""
    return {
        "id": row.id,
        "source_id": row.source_id,
        "day": row.day.isoformat(),
        "run_ref": row.run_ref,
        "status": row.status,
        "turns_seen": row.turns_seen,
        "evaluated": row.evaluated,
        "failed": row.failed,
        "incomplete": row.incomplete,
        "excluded": row.excluded,
        "first_poll_at": to_api_timestamp(row.first_poll_at),
        "last_poll_at": to_api_timestamp(row.last_poll_at),
        "closed_at": to_api_timestamp(row.closed_at),
        "polls": row.polls,
        "max_poll_gap_s": row.max_poll_gap_s,
        "parameters": row.parameters,
    }


@live_ingest_router.post("/sources/{key:path}/heartbeat", status_code=204)
def heartbeat(
    body: HeartbeatBody,
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> Response:
    source = _source(db, scope[0].id, key)
    live_ingest.record_heartbeat(
        db,
        source,
        body.at,
        body.last_poll_at,
        body.current_day,
        body.worker,
        live_ingest.utcnow(),
    )
    _commit(db)
    return Response(status_code=204)


@live_ingest_router.put("/sources/{key:path}/metric-specs")
def put_metric_specs(
    body: MetricSpecsBody,
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    source = _source(db, scope[0].id, key)
    count = live_ingest.replace_metric_specs(db, source, body.specs)
    _commit(db)
    return {"count": count}


@live_ingest_router.put("/sources/{key:path}/days/{day}")
def put_day(
    day: date,
    body: DayBody,
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    source = _source(db, scope[0].id, key)
    row = live_ingest.upsert_day(db, source, day, body)
    _commit(db)
    return _day_payload(row)


# Match slashes too so invalid keys receive 422; keep this after the child routes.
@live_ingest_router.put("/sources/{key:path}")
def put_source(
    body: SourceBody,
    response: Response,
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    source, created = live_ingest.upsert_source(db, scope[0].id, key, body)
    _commit(db)
    response.status_code = 201 if created else 200
    return _source_payload(source)
