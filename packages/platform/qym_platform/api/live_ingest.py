"""API-key authenticated ingestion of project live evaluation state."""

from __future__ import annotations

import json
import math
from copy import deepcopy
from datetime import date, datetime
from typing import Any, Awaitable, Callable, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from qym_platform.api.ingest import (
    _read_ingest_body,
    ingest_settings,
    require_ingest_open,
)
from qym_platform.auth import Principal, require_api_key_principal
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import LiveDay, LiveSource, Project
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import require_project_writable
from qym_platform.services import live_control, live_events, live_ingest, live_jobs
from qym_platform.services.live_worker_settings import SettingsError

logger = get_logger(__name__)

# Every live write honours the maintenance window exactly like the run ingest routes.
live_ingest_router = APIRouter(
    prefix="/v1/projects/{project_id}/live",
    tags=["live-ingest"],
    dependencies=[Depends(require_ingest_open)],
)
_SOURCE_KEY_PATTERN = r"^[A-Za-z0-9_.:-]{1,100}$"
_CHART_REF_PATTERN = r"^[A-Za-z0-9_.:-]{1,100}$"
_BODY_SCHEMAS: dict[str, Any] = {}


class SourceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=200)
    environment: str = Field(..., min_length=1, max_length=50)
    product: Optional[str] = Field(default=None, max_length=100)
    worker: dict[str, Any] = Field(default_factory=dict)
    day_key_timezone: Optional[str] = Field(default=None, min_length=1, max_length=40)

    @field_validator("day_key_timezone")
    @classmethod
    def _known_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError, OSError):
                raise ValueError("day_key_timezone is not a known timezone") from None
        return value


class HeartbeatBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: datetime
    last_poll_at: Optional[datetime] = None
    current_day: Optional[date] = None
    worker: Optional[dict[str, Any]] = None


class JobProgressBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["running", "done", "failed", "cancelled"]
    progress: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None

    @field_validator("progress")
    @classmethod
    def _safe_progress(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value, allow_nan=False)
            return value
        except (TypeError, ValueError, RecursionError):
            raise ValueError("progress must be finite JSON") from None


class EventBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: datetime
    level: Literal["error", "warning"]
    component: str = Field(min_length=1, max_length=30, pattern=r"^[a-z_]+$")
    code: str = Field(min_length=1, max_length=60, pattern=r"^[a-z0-9_]+$")
    message: str = Field(min_length=1, max_length=2000)
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("details")
    @classmethod
    def _safe_details(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value, allow_nan=False)
            return live_events.redact_details(value)
        except (TypeError, ValueError, RecursionError):
            raise ValueError("details must be JSON-serialisable") from None


class EventsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[EventBody]


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

    @field_validator("pass_threshold")
    @classmethod
    def _finite_threshold(cls, value: Optional[float]) -> Optional[float]:
        """Reject non-finite pass thresholds."""
        if value is not None and not math.isfinite(value):
            raise ValueError("pass_threshold must be finite")
        return value


class MetricSpecsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specs: list[MetricSpecBody]

    @field_validator("specs")
    @classmethod
    def _one_primary(cls, specs: list[MetricSpecBody]) -> list[MetricSpecBody]:
        """Reject metric sets with more than one primary metric."""
        if sum(spec.is_primary for spec in specs) > 1:
            raise ValueError("at most one metric may be primary")
        return specs


class DayBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_ref: Optional[str] = Field(default=None, max_length=100)
    status: Literal["running", "closed"] = "running"
    turns_seen: int = Field(default=0, ge=0, le=2147483647)
    evaluated: int = Field(default=0, ge=0, le=2147483647)
    failed: int = Field(default=0, ge=0, le=2147483647)
    incomplete: int = Field(default=0, ge=0, le=2147483647)
    excluded: int = Field(default=0, ge=0, le=2147483647)
    first_poll_at: Optional[datetime] = None
    last_poll_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class ScoreBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_name: str = Field(..., min_length=1, max_length=200)
    score_numeric: Optional[float] = None
    score_raw: Any = None
    label: Optional[str] = Field(default=None, max_length=200)
    explanation: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict)
    skipped: bool = False
    skip_reason: Optional[str] = Field(default=None, max_length=200)

    @field_validator("score_numeric")
    @classmethod
    def _finite_score(cls, value: Optional[float]) -> Optional[float]:
        """Reject non-finite numeric scores."""
        if value is not None and not math.isfinite(value):
            raise ValueError("score_numeric must be finite")
        return value


class TurnBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_id: str = Field(..., min_length=1, max_length=200)
    turn_at: datetime
    status: Literal["completed", "failed", "incomplete_ingest"]
    question: str
    day: Optional[date] = None
    conversation_id: Optional[str] = Field(default=None, max_length=200)
    turn_index: Optional[int] = Field(default=None, ge=0, le=2147483647)
    evaluated_at: Optional[datetime] = None
    user_ref: Optional[str] = Field(default=None, max_length=200)
    mode: Optional[str] = Field(default=None, max_length=50)
    outcome: Optional[str] = Field(default=None, max_length=30)
    label: Optional[str] = Field(default=None, max_length=60)
    label_reason: Optional[str] = None
    answer: Optional[str] = None
    sql: list[dict[str, Any]] = Field(default_factory=list)
    latency_ms: Optional[float] = None
    result_rows: Optional[int] = Field(default=None, ge=0, le=2147483647)
    tool_calls: Optional[int] = Field(default=None, ge=0, le=2147483647)
    trace_url: Optional[str] = Field(default=None, max_length=2000)
    eval_trace_url: Optional[str] = Field(default=None, max_length=2000)
    summary: dict[str, Any] = Field(default_factory=dict)
    detail: Optional[dict[str, Any]] = None
    scores: list[ScoreBody] = Field(default_factory=list)

    @field_validator("latency_ms")
    @classmethod
    def _finite_latency(cls, value: Optional[float]) -> Optional[float]:
        """Reject non-finite turn latencies."""
        if value is not None and not math.isfinite(value):
            raise ValueError("latency_ms must be finite")
        return value


class TurnsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turns: list[Any] = Field(..., min_length=1)


class CanaryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canary: str = Field(..., min_length=1, max_length=50)
    checked_at: datetime
    status: Literal["ok", "failed", "skipped"]
    fault: Optional[str] = Field(default=None, max_length=20)
    latency_ms: Optional[float] = None
    detail: dict[str, Any] = Field(default_factory=dict)
    eval_code_version: Optional[str] = Field(default=None, max_length=100)

    @field_validator("latency_ms")
    @classmethod
    def _finite_latency(cls, value: Optional[float]) -> Optional[float]:
        """Reject non-finite canary latencies."""
        if value is not None and not math.isfinite(value):
            raise ValueError("latency_ms must be finite")
        return value


class CanariesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[CanaryBody]


def _body_openapi(model: type[BaseModel]) -> dict[str, Any]:
    """Document a custom-parsed body and collect its reusable component schemas."""
    schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
    _BODY_SCHEMAS.update(schema.pop("$defs", {}))
    _BODY_SCHEMAS[model.__name__] = schema
    return {
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": f"#/components/schemas/{model.__name__}"}
                }
            },
        }
    }


def install_live_ingest_openapi(app: FastAPI) -> None:
    """Include custom-parsed body models in each ingest app's OpenAPI components."""
    original_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        document = original_openapi()
        document.setdefault("components", {}).setdefault("schemas", {}).update(
            deepcopy(_BODY_SCHEMAS)
        )
        return document

    app.openapi = openapi


def _validated_body(
    model: type[BaseModel],
    max_bytes: Optional[int] = None,
) -> Callable[[Request], Awaitable[BaseModel]]:
    """Cap and validate JSON before dispatching a synchronous ingest handler."""

    async def read_body(request: Request) -> BaseModel:
        raw = await _read_ingest_body(
            request,
            (
                max_bytes
                if max_bytes is not None
                else ingest_settings().live_ingest_max_body_bytes
            ),
        )
        content_type = (
            request.headers.get("content-type", "application/json")
            .split(";", 1)[0]
            .strip()
            .lower()
        )
        payload = raw
        if content_type == "application/json" or (
            content_type.startswith("application/") and content_type.endswith("+json")
        ):
            try:
                payload = json.loads(raw)
            except RecursionError:
                raise RequestValidationError(
                    [
                        {
                            "type": "json_invalid",
                            "loc": ("body",),
                            "msg": "JSON nesting too deep",
                        }
                    ]
                ) from None
            except (ValueError, UnicodeError) as exc:
                raise RequestValidationError(
                    [
                        {
                            "type": "json_invalid",
                            "loc": ("body", getattr(exc, "pos", 0)),
                            "msg": "JSON decode error",
                            "ctx": {"error": str(exc)},
                        }
                    ]
                ) from None
        try:
            return model.model_validate(payload)
        except ValidationError as exc:
            # Raw inputs can contain NaN/Infinity, which cannot appear in a JSON
            # error response. Keep the field locations and validation messages.
            raise RequestValidationError(
                [
                    {**error, "loc": ("body", *error["loc"])}
                    for error in exc.errors(include_input=False, include_context=False)
                ]
            ) from None

    return read_body


async def _chart_image_body(request: Request) -> bytes:
    """Read a bounded raw PNG body before the synchronous ingest handler."""
    content_type = (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    )
    if content_type != "image/png":
        raise HTTPException(status_code=415, detail="unsupported content type")
    return await _read_ingest_body(
        request, ingest_settings().live_chart_image_max_bytes
    )


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
    require_project_writable(db, project_id)
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
    except (DataError, IntegrityError):
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
        "day_key_timezone": source.day_key_timezone,
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


# Register the image path before every PUT with a greedy source key.
@live_ingest_router.put(
    "/sources/{key}/turns/{turn_id:path}/charts/{ref}/image",
    status_code=204,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "image/png": {"schema": {"type": "string", "format": "binary"}}
            },
        }
    },
)
def put_chart_image(
    scope: tuple[Project, Principal] = Depends(_source_scope),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    turn_id: str = Path(..., min_length=1, max_length=200),
    ref: str = Path(..., pattern=_CHART_REF_PATTERN),
    data: bytes = Depends(_chart_image_body),
    db: Session = Depends(get_db),
) -> Response:
    source = _source(db, scope[0].id, key)
    try:
        live_ingest.upsert_chart_image(db, source, turn_id, ref, data, ingest_settings())
    except live_ingest.ChartImageError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid PNG") from None
    _commit(db)
    return Response(status_code=204)


@live_ingest_router.post(
    "/sources/{key:path}/heartbeat",
    status_code=204,
    openapi_extra=_body_openapi(HeartbeatBody),
)
def heartbeat(
    body: HeartbeatBody = Depends(_validated_body(HeartbeatBody)),
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


@live_ingest_router.put(
    "/sources/{key:path}/metric-specs", openapi_extra=_body_openapi(MetricSpecsBody)
)
def put_metric_specs(
    body: MetricSpecsBody = Depends(_validated_body(MetricSpecsBody)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    source = _source(db, scope[0].id, key)
    count = live_ingest.replace_metric_specs(db, source, body.specs)
    _commit(db)
    return {"count": count}


@live_ingest_router.put(
    "/sources/{key:path}/days/{day}", openapi_extra=_body_openapi(DayBody)
)
def put_day(
    day: date,
    body: DayBody = Depends(_validated_body(DayBody)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    source = _source(db, scope[0].id, key)
    row = live_ingest.upsert_day(db, source, day, body)
    _commit(db)
    return _day_payload(row)


@live_ingest_router.post(
    "/sources/{key:path}/turns", openapi_extra=_body_openapi(TurnsBody)
)
def post_turns(
    body: TurnsBody = Depends(_validated_body(TurnsBody)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    settings = ingest_settings()
    if len(body.turns) > settings.live_turn_batch_max:
        raise HTTPException(
            status_code=422, detail="Turn batch exceeds the configured limit"
        )
    source = _source(db, scope[0].id, key)
    turns, results = [], []
    for raw in body.turns:
        if not isinstance(raw, dict):
            results.append(
                {
                    "turn_id": None,
                    "status": "rejected",
                    "error": "turn must be a JSON object",
                    "notes": [],
                }
            )
            continue
        try:
            turns.append(TurnBody.model_validate(raw))
            results.append(None)
        except ValidationError as exc:
            error = "; ".join(
                f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
                for item in exc.errors(include_input=False)
            )
            results.append(
                {
                    "turn_id": (
                        raw.get("turn_id")
                        if isinstance(raw.get("turn_id"), str)
                        else None
                    ),
                    "status": "rejected",
                    "error": " ".join(error.splitlines()),
                    "notes": [],
                }
            )
    report = live_ingest.upsert_turns(db, source, turns, settings)
    applied = iter(report["results"])
    report["results"] = [
        next(applied) if result is None else result for result in results
    ]
    report["rejected"] += len(body.turns) - len(turns)
    _commit(db)
    return report


@live_ingest_router.post(
    "/sources/{key:path}/canaries", openapi_extra=_body_openapi(CanariesBody)
)
def post_canaries(
    body: CanariesBody = Depends(_validated_body(CanariesBody)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    source = _source(db, scope[0].id, key)
    accepted = live_ingest.insert_canaries(db, source, body.results)
    _commit(db)
    return {"accepted": accepted}


@live_ingest_router.get("/sources/{key:path}/turns/ids")
def get_turn_ids(
    day: date,
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, list[str]]:
    source = _source(db, scope[0].id, key)
    return {"turn_ids": live_ingest.turn_ids_for_day(db, source, day)}


@live_ingest_router.get("/sources/{key:path}/control")
def get_control(
    request: Request,
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> Response:
    source = _source(db, scope[0].id, key)
    try:
        body, etag = live_control.control_document(
            db, source, scope[1], ingest_settings(), live_ingest.utcnow()
        )
    except SettingsError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    for header in request.headers.getlist("if-none-match"):
        for candidate in header.split(","):
            if candidate.strip().removeprefix("W/") == etag.removeprefix("W/"):
                return Response(status_code=304, headers={"ETag": etag})
    return JSONResponse(body, headers={"ETag": etag, "Cache-Control": "no-store"})


@live_ingest_router.post(
    "/sources/{key:path}/jobs/{job_id}/progress",
    openapi_extra=_body_openapi(JobProgressBody),
)
def post_job_progress(
    job_id: str,
    body: JobProgressBody = Depends(_validated_body(JobProgressBody)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    source = _source(db, scope[0].id, key)
    try:
        job = live_jobs.report_progress(
            db, source, job_id, body.status, body.progress, body.error, live_ingest.utcnow()
        )
    except live_jobs.JobError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    _commit(db)
    return {"id": job.id, "status": job.status, "progress": job.progress}


@live_ingest_router.post(
    "/sources/{key:path}/events", openapi_extra=_body_openapi(EventsBody)
)
def post_events(
    body: EventsBody = Depends(_validated_body(EventsBody, max_bytes=256 * 1024)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    if len(body.events) > ingest_settings().live_events_batch_max:
        raise HTTPException(status_code=422, detail="too many events")
    source = _source(db, scope[0].id, key)
    accepted = live_events.ingest_events(db, source, body.events, live_ingest.utcnow())
    _commit(db)
    return {"accepted": accepted}


# Match slashes too so invalid keys receive 422; keep this after the child routes.
@live_ingest_router.put("/sources/{key:path}", openapi_extra=_body_openapi(SourceBody))
def put_source(
    response: Response,
    body: SourceBody = Depends(_validated_body(SourceBody)),
    key: str = Path(..., pattern=_SOURCE_KEY_PATTERN),
    scope: tuple[Project, Principal] = Depends(_source_scope),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    source, created = live_ingest.upsert_source(db, scope[0].id, key, body)
    _commit(db)
    response.status_code = 201 if created else 200
    return _source_payload(source)
