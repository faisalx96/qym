"""API-key authenticated routes of the performance runner.

The twelve routes of docs/performance-runner-protocol-v1.0.md. A separate,
headless runner calls them: it registers, reads what qym wants, claims one run,
and reports status, questions, log lines and the result. qym never calls the
runner. Mounted like the Live ingest routes.
"""

from __future__ import annotations

import functools
import json
from datetime import datetime
from typing import Annotated, Any, Awaitable, Callable, Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
)
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from qym_platform.services.performance_validation import safe_errors
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    StrictBool,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from qym_platform.api.ingest import (
    _read_ingest_body,
    ingest_settings,
    require_ingest_open,
)
from qym_platform.api.live_ingest import _body_openapi
from qym_platform.auth import Principal, require_api_key_principal
from qym_platform.datetime_utils import to_storage_utc
from qym_platform.db.models import PERFORMANCE_TEST_TYPES, Project
from qym_platform.deps import get_db
from qym_platform.error_body import error_body
from qym_platform.permissions import require_project_writable
from qym_platform.services import (
    performance_control,
    performance_ingest,
    performance_state,
)
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.services import (
    performance_platform as platform,
    performance_platform_schema as platform_schema,
    performance_platform_ingest as platform_ingest,
)
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

# Every runner route honours the maintenance window exactly like the run ingest routes.
performance_ingest_router = APIRouter(
    prefix="/v1/projects/{project_id}/performance",
    tags=["performance-ingest"],
    dependencies=[Depends(require_ingest_open)],
)

# Separate router keeps the original chat surface independently mountable.
performance_platform_ingest_router = APIRouter(
    prefix="/v1/projects/{project_id}/performance",
    tags=["performance-ingest"],
    dependencies=[Depends(require_ingest_open)],
)

INSTANCE_HEADER = "X-Qym-Runner-Instance"
# Objects and arrays nest at most this deep in a JSON body (the body itself is 1).
JSON_DEPTH_MAX = 32
_RUNNER_KEY_PATTERN = r"^[A-Za-z0-9_.:-]{1,100}$"
_INSTANCE_PATTERN = r"^[A-Za-z0-9_.:-]{1,64}$"
_AFTER_PATTERN = r"^\d{1,10}:\d{1,18}$"
_INT_MAX = 2147483647

RunnerKey = Annotated[str, Path(pattern=_RUNNER_KEY_PATTERN)]
# A new id at every process start; it ties each request to one runner process.
Instance = Annotated[str, Header(alias=INSTANCE_HEADER, pattern=_INSTANCE_PATTERN)]

VERDICTS: dict[str, tuple[str, ...]] = {
    "breakpoint": (
        "breakpoint_found",
        "not_reached",
        "invalid_auth",
        "invalid_no_data",
    ),
    "smoke": ("pass", "fail"),
    "soak": ("pass", "fail"),
}


def _finite_json(value: Any, name: str) -> Any:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise ValueError(f"{name} must be finite JSON") from None
    return value


def _storable_time(value: datetime) -> datetime:
    """A time qym can store: it must still be a valid date once moved to UTC."""
    try:
        to_storage_utc(value)
    except (OverflowError, ValueError):
        raise ValueError("time must fall between the years 1 and 9999 in UTC") from None
    return value


Time = Annotated[datetime, AfterValidator(_storable_time)]


class _Typed(BaseModel):
    """A request object with fixed fields: unknown fields and non-finite numbers are refused."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PerformanceRegisterBody(_Typed):
    name: str = Field(..., min_length=1, max_length=200)
    info: dict[str, Any] = Field(default_factory=dict)

    @field_validator("info")
    @classmethod
    def _small_info(cls, value: dict[str, Any]) -> dict[str, Any]:
        kinds = value.get("supported_target_kinds", ["chat"])
        if (
            not isinstance(kinds, list)
            or not 1 <= len(kinds) <= 2
            or any(k not in ("chat", platform.KIND) for k in kinds)
            or len(set(kinds)) != len(kinds)
        ):
            raise ValueError("Invalid supported target kinds")
        _finite_json(value, "info")
        limit = ingest_settings().performance_info_max_bytes
        size = len(
            json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        )
        if size > limit:
            raise ValueError(f"info must be at most {limit} bytes of JSON")
        return value


class PerformanceHeartbeatBody(_Typed):
    at: Time
    state: Literal["idle", "preflight", "running", "stopping", "finishing"]
    run_id: Optional[str] = Field(default=None, max_length=36)


class PerformanceClaimBody(_Typed):
    """The empty object: the instance travels in the header."""


class PerformanceProgressBody(_Typed):
    seq: int = Field(..., ge=1, le=_INT_MAX)
    status: Literal[
        "starting",
        "running",
        "stopping",
        "finished",
        "stopped",
        "failed",
        "interrupted",
    ]
    at: Time
    progress: dict[str, Any]
    error: Optional[str] = None
    exit_code: Optional[int] = Field(default=None, ge=-_INT_MAX, le=_INT_MAX)

    @field_validator("progress")
    @classmethod
    def _known_fields(cls, value: dict[str, Any]) -> dict[str, Any]:
        if value.get("target_kind") == platform.KIND:
            platform_schema.Progress.model_validate(value)
        else:
            performance_ingest.check_progress_shape(value)
        return value

    @model_validator(mode="after")
    def _reason_in_words(self) -> "PerformanceProgressBody":
        if self.status in ("failed", "interrupted") and not (self.error or "").strip():
            raise ValueError(
                "error is required when the status is failed or interrupted"
            )
        return self


class PerformanceQuestionRecordBody(_Typed):
    seq: int = Field(..., ge=1, le=_INT_MAX)
    asked_at: Time
    elapsed_s: float = Field(..., ge=0)
    stage: Literal["baseline", "ramp", "hold", "cooldown", "steady"]
    level: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    user: int = Field(..., ge=1, le=_INT_MAX)
    tier: Literal["simple", "medium", "complex"]
    question_id: str = Field(..., min_length=1, max_length=200)
    is_followup: bool = False
    question: str
    status: Literal["ok", "error", "interrupted"]
    http_status: int = Field(..., ge=0, le=599)
    error_kind: Optional[
        Literal["auth", "rate_limit", "server", "network", "run_failed", "other"]
    ] = None
    duration_ms: float = Field(..., ge=0)
    ttfb_ms: Optional[float] = Field(default=None, ge=0)
    quality: Optional[float] = Field(default=None, ge=0, le=100)
    no_data: bool = False
    warmup: bool = False
    attempts: int = Field(default=1, ge=1, le=_INT_MAX)
    answer: Optional[str] = None
    answer_truncated: bool = False


class PerformanceQuestionsBody(_Typed):
    records: list[Any] = Field(..., min_length=1)


class PerformanceLogLineBody(_Typed):
    seq: int = Field(..., ge=1, le=_INT_MAX)
    at: Time
    level: Literal["info", "warning", "error"]
    message: str = Field(..., min_length=1)


class PerformanceLogBody(_Typed):
    lines: list[Any] = Field(..., min_length=1)


class PerformanceEventBody(_Typed):
    at: Time
    level: Literal["info", "warning", "error"]
    code: str = Field(..., min_length=1, max_length=60, pattern=r"^[a-z0-9_]+$")
    message: str = Field(..., min_length=1, max_length=2000)
    details: dict[str, Any] = Field(default_factory=dict)
    run_id: Optional[str] = Field(default=None, max_length=36)

    @field_validator("details")
    @classmethod
    def _safe_details(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _finite_json(value, "details")


class PerformanceEventsBody(_Typed):
    events: list[PerformanceEventBody]


class PerformanceTokenBody(_Typed):
    value: str = Field(..., min_length=1, max_length=8192)
    replaces_version: int = Field(..., ge=0, le=_INT_MAX)
    expires_at: Optional[Time] = None


class PerformanceCookieBody(_Typed):
    value: Any
    replaces_version: int = Field(..., ge=1, le=_INT_MAX)
    expires_at: Optional[Time] = None


class _Open(BaseModel):
    """A result object: the fields qym reads are checked, keys it does not know are kept."""

    model_config = ConfigDict(extra="allow", allow_inf_nan=False)


class PerformanceSummaryHeadlineBody(_Open):
    safe_load_users: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    breaking_level_users: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    breaking_reason: Optional[Literal["latency", "errors", "both"]] = None
    recommended_max_users: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    p95_at_safe_load_ms: Optional[float] = Field(default=None, ge=0)
    answers_measured: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    duration_s: Optional[float] = Field(default=None, ge=0)
    p95_ms: Optional[float] = Field(default=None, ge=0)
    answers_total: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    errors_total: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    error_rate_pct: Optional[float] = Field(default=None, ge=0, le=100)
    ttfb_p95_ms: Optional[float] = Field(default=None, ge=0)
    max_users: Optional[int] = Field(default=None, ge=0, le=_INT_MAX)
    quality_mean: Optional[float] = Field(default=None, ge=0, le=100)


class PerformanceSummaryThresholdBody(_Open):
    scope: str = Field(..., min_length=1, max_length=50)
    metric: str = Field(..., min_length=1, max_length=200)
    expression: str = Field(..., min_length=1, max_length=200)
    measured: Optional[float] = None
    ok: bool


class PerformanceSummaryTierBody(_Open):
    answers: Optional[int] = Field(..., ge=0, le=_INT_MAX)
    avg_ms: Optional[float] = Field(..., ge=0)
    p95_ms: Optional[float] = Field(..., ge=0)


class PerformanceSummaryTiersBody(_Open):
    simple: PerformanceSummaryTierBody
    medium: PerformanceSummaryTierBody
    complex: PerformanceSummaryTierBody


# Guide 4.7: null only on a level without data (has_data false).
_LEVEL_DATA_NUMBERS = ("answers", "hold_elapsed_pct", "error_pct", "per_minute")


class PerformanceSummaryLevelBody(_Open):
    """One level of a Breakpoint result (guide 4.7), one entry per planned level.

    The run page reads these fields with no fallback: an entry without them was
    stored and then read as a hold that never finished, so it is refused (422).
    A number the suite has no value for is sent as null, never left out.
    ``answers``, ``hold_elapsed_pct``, ``error_pct`` and ``per_minute`` may be
    null only on a level without data (``has_data: false``); a level with data
    must send them as numbers.
    ``by_tier`` may be dropped to fit the size cap (413); when sent it is checked.
    """

    level: int = Field(..., ge=0, le=_INT_MAX)
    answers: Optional[int] = Field(..., ge=0, le=_INT_MAX)
    result: Literal["pass", "break", "auth", "no_data"]
    # JSON true or false only: a "yes" would be read as a level with data.
    has_data: StrictBool
    passed: StrictBool
    latency_breach: StrictBool
    error_breach: StrictBool
    hold_elapsed_pct: Optional[float] = Field(..., ge=0, le=100)
    error_pct: Optional[float] = Field(..., ge=0, le=100)
    per_minute: Optional[float] = Field(..., ge=0)
    p50_ms: Optional[float] = Field(..., ge=0)
    p95_ms: Optional[float] = Field(..., ge=0)
    p99_ms: Optional[float] = Field(..., ge=0)
    ttfb_p95_ms: Optional[float] = Field(..., ge=0)
    no_data_pct: Optional[float] = Field(..., ge=0, le=100)
    quality_mean: Optional[float] = Field(..., ge=0, le=100)
    by_tier: Optional[PerformanceSummaryTiersBody] = None

    @model_validator(mode="after")
    def _numbers_with_data(self) -> "PerformanceSummaryLevelBody":
        if self.has_data:
            missing = [
                name for name in _LEVEL_DATA_NUMBERS if getattr(self, name) is None
            ]
            if missing:
                raise ValueError(
                    "a level with data (has_data true) must send these as numbers, not null: "
                    + ", ".join(missing)
                )
        return self


class PerformanceSummaryBody(_Open):
    schema_version: Literal[1] = Field(..., alias="schema")
    test_type: Literal["breakpoint", "smoke", "soak"]
    verdict: str = Field(..., min_length=1, max_length=30)
    verdict_reason: Optional[str]
    ended_by: Literal["plan", "auto_stop", "stop", "runner", "error"]
    exit_code: Optional[int] = Field(..., ge=-_INT_MAX, le=_INT_MAX)
    started_at: Time
    ended_at: Time
    target_url: str = Field(..., min_length=1, max_length=2000)
    headline: PerformanceSummaryHeadlineBody
    thresholds: list[PerformanceSummaryThresholdBody]
    levels: list[PerformanceSummaryLevelBody]

    @model_validator(mode="after")
    def _suite_word(self) -> "PerformanceSummaryBody":
        if self.verdict not in VERDICTS[self.test_type]:
            raise ValueError(
                f"verdict of a {self.test_type} test must be one of: "
                + ", ".join(VERDICTS[self.test_type])
            )
        return self


assert set(VERDICTS) == set(PERFORMANCE_TEST_TYPES)


# --------------------------------------------------------------------------- plumbing


def performance_error_response(exc: PerformanceError) -> JSONResponse:
    """The platform's error body for a refusal, with the refusal's own code."""
    body = error_body(
        exc.status, exc.message, code=exc.code, details=exc.details or None
    )
    return JSONResponse(status_code=exc.status, content=jsonable_encoder(body))


def answers_refusals(handler: Callable[..., Any]) -> Callable[..., Any]:
    """Answer a ``PerformanceError`` raised by a route with its error body."""

    @functools.wraps(handler)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return handler(*args, **kwargs)
        except PerformanceError as exc:
            return performance_error_response(exc)

    return wrapper


def _is_json(request: Request) -> bool:
    content_type = (
        request.headers.get("content-type", "application/json")
        .split(";", 1)[0]
        .strip()
        .lower()
    )
    return content_type == "application/json" or (
        content_type.startswith("application/") and content_type.endswith("+json")
    )


def _too_deep(value: Any) -> bool:
    """True when objects and arrays nest deeper than ``JSON_DEPTH_MAX`` (the body is 1)."""
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, dict):
            children: Any = item.values()
        elif isinstance(item, list):
            children = item
        else:
            continue
        if depth > JSON_DEPTH_MAX:
            return True
        stack.extend((child, depth + 1) for child in children)
    return False


def _without_nul(value: Any) -> Any:
    """The JSON value with every NUL character removed from its strings and keys.

    Called only after the depth check, so the recursion is at most
    ``JSON_DEPTH_MAX`` deep.
    """
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {_without_nul(key): _without_nul(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_without_nul(item) for item in value]
    return value


_TOO_DEEP = {
    "type": "json_too_deep",
    "loc": ("body",),
    "msg": f"JSON must not nest objects and arrays deeper than {JSON_DEPTH_MAX} levels",
}


async def _payload(request: Request, limit: int) -> tuple[Any, bytes]:
    """The size-capped body, parsed when it is JSON; the bytes come along.

    A JSON body nested deeper than ``JSON_DEPTH_MAX`` is refused before any
    model sees it, and NUL characters are removed from all its strings, so
    nothing that is stored can break a page or the database.
    """
    raw = await _read_ingest_body(request, limit)
    if not _is_json(request):
        return raw, raw
    try:
        payload = json.loads(raw)
    except RecursionError:
        raise RequestValidationError([_TOO_DEEP]) from None
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
    if _too_deep(payload):
        raise RequestValidationError([_TOO_DEEP])
    return (
        payload
        if request.url.path.endswith("/tokens/session_cookie")
        else _without_nul(payload)
    ), raw


def _validated(model: type[BaseModel], payload: Any) -> Any:
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        # Raw inputs can contain NaN/Infinity, which cannot appear in a JSON
        # error response. Keep the field locations and validation messages.
        raise RequestValidationError(safe_errors(model, exc)) from None


def _body(
    model: type[BaseModel], limit_setting: str
) -> Callable[[Request], Awaitable[Any]]:
    """Cap the body at a setting of this qym, then validate it."""

    async def read_body(request: Request, db: Session = Depends(get_db)) -> Any:
        from qym_platform.db.models import PerformanceRun

        run = db.get(PerformanceRun, request.path_params.get("run_id", ""))
        is_platform = run is not None and run.target_kind == platform.KIND
        setting = (
            "performance_platform_progress_max_bytes"
            if model is PerformanceProgressBody and is_platform
            else limit_setting
        )
        payload, _raw = await _payload(request, getattr(ingest_settings(), setting))
        if (
            model is PerformanceTokenBody
            and request.path_params.get("name") == "session_cookie"
        ):
            return _validated(PerformanceCookieBody, payload)
        return _validated(model, payload)

    return read_body


async def _register_body(request: Request) -> PerformanceRegisterBody:
    # ``info`` has its own limit; a JSON string spends at most six bytes on one of UTF-8.
    limit = 6 * ingest_settings().performance_info_max_bytes + 4096
    payload, _raw = await _payload(request, limit)
    return _validated(PerformanceRegisterBody, payload)


async def _summary_body(
    request: Request,
    db: Session = Depends(get_db),
) -> tuple[PerformanceSummaryBody, dict[str, Any]]:
    """The checked summary and the object as it was sent."""
    from qym_platform.db.models import PerformanceRun

    run = db.get(PerformanceRun, request.path_params.get("run_id", ""))
    is_platform = run is not None and run.target_kind == platform.KIND
    limit = (
        ingest_settings().performance_platform_summary_max_bytes
        if is_platform
        else ingest_settings().performance_summary_max_bytes
    )
    payload, _raw = await _payload(request, limit)
    if (
        isinstance(payload, dict)
        and payload.get("target_kind") is not None
        and (payload.get("target_kind") == platform.KIND) != is_platform
    ):
        exc = platform.refusal("wrong_target_kind")
        raise HTTPException(
            status_code=exc.status, detail={"code": exc.code, "message": exc.message}
        )
    body = _validated(
        platform_schema.Summary if is_platform else PerformanceSummaryBody, payload
    )
    _validated_finite(payload)
    return body, payload


def _validated_finite(payload: Any) -> None:
    try:
        json.dumps(payload, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise RequestValidationError(
            [
                {
                    "type": "finite_number",
                    "loc": ("body",),
                    "msg": "The body must be finite JSON",
                }
            ]
        ) from None


async def _report_body(request: Request) -> bytes:
    """Read a bounded raw report file before the synchronous handler."""
    content_type = (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    )
    if content_type != "text/html":
        raise HTTPException(status_code=415, detail="unsupported content type")
    return await _read_ingest_body(
        request, ingest_settings().performance_report_max_bytes
    )


def _scope(
    project_id: str,
    principal: Principal = Depends(require_api_key_principal),
    db: Session = Depends(get_db),
) -> tuple[Project, Principal]:
    """Allow the runner only within the API key's active project."""
    if principal.project_id != project_id:
        raise HTTPException(
            status_code=403, detail="API key belongs to another project"
        )
    require_project_writable(db, project_id)
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not ingest_settings().performance_enabled:
        raise HTTPException(status_code=404, detail="Performance is switched off")
    return project, principal


Scope = Annotated[tuple[Project, Principal], Depends(_scope)]


def _commit(db: Session) -> None:
    """Commit a runner write or report a conflicting request."""
    try:
        db.commit()
    except (DataError, IntegrityError):
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Performance data conflicts with existing data"
        ) from None


def _run(db: Session, project: Project, key: str, run_id: str, now: datetime):
    """Lock a run of this runner key and write its end when a silence rule has ended it."""
    runner, run = performance_ingest.find_run(db, project.id, key, run_id, lock=True)
    if performance_state.end_if_stale(db, run, now=now):
        # Kept even when the request is refused next; the run is final from here on.
        _commit(db)
    return runner, run


def _checked_records(
    raws: list[Any], model: type[BaseModel]
) -> tuple[list[Any], list[Optional[dict[str, Any]]]]:
    """Check each record on its own: valid ones, and one result slot per input."""
    valid: list[Any] = []
    slots: list[Optional[dict[str, Any]]] = []
    for raw in raws:
        seq = raw.get("seq") if isinstance(raw, dict) else None
        seq = seq if type(seq) is int else None
        if not isinstance(raw, dict):
            slots.append(
                {
                    "seq": None,
                    "status": "rejected",
                    "error": "record must be a JSON object",
                }
            )
            continue
        try:
            valid.append(model.model_validate(raw))
            slots.append(None)
        except ValidationError as exc:
            error = "; ".join(
                (
                    f"Unknown fields are not allowed (count: {item['ctx']['count']})"
                    if item["type"] == "extra_forbidden"
                    else f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
                )
                for item in safe_errors(model, exc, prefix=())
            )
            slots.append(
                {
                    "seq": seq,
                    "status": "rejected",
                    "error": " ".join(error.splitlines()),
                }
            )
    return valid, slots


# --------------------------------------------------------------------------- runner routes


@performance_ingest_router.put(
    "/runners/{key}", openapi_extra=_body_openapi(PerformanceRegisterBody)
)
@answers_refusals
def register_runner(
    response: Response,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceRegisterBody = Depends(_register_body),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Register this runner process; a new instance ends the run of the one before it."""
    project, principal = scope
    runner, first, interrupted_run_id = performance_ingest.register_runner(
        db,
        project_id=project.id,
        key=key,
        instance=instance,
        name=body.name,
        info=body.info,
        principal=principal,
        now=performance_ingest.utcnow(),
    )
    _commit(db)
    response.status_code = 201 if first else 200
    return performance_ingest.runner_payload(db, runner, principal, interrupted_run_id)


@performance_ingest_router.post(
    "/runners/{key}/heartbeat",
    status_code=204,
    openapi_extra=_body_openapi(PerformanceHeartbeatBody),
)
@answers_refusals
def heartbeat(
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceHeartbeatBody = Depends(
        _body(PerformanceHeartbeatBody, "performance_progress_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> Response:
    """Say the process is alive; a sign of life for the run it claimed."""
    runner = performance_ingest.registered_runner(
        db, scope[0].id, key, instance, lock=True
    )
    performance_ingest.record_heartbeat(
        db,
        runner,
        state=body.state,
        run_id=body.run_id,
        now=performance_ingest.utcnow(),
    )
    _commit(db)
    return Response(status_code=204)


@performance_ingest_router.get("/runners/{key}/control")
@answers_refusals
def get_control(
    request: Request,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    db: Session = Depends(get_db),
) -> Response:
    """Read what qym wants: the run to work on, a stop, the tokens. Writes nothing."""
    runner = performance_ingest.registered_runner(db, scope[0].id, key, instance)
    body, etag = performance_control.control_document(
        db, runner, scope[1], ingest_settings(), performance_ingest.utcnow()
    )
    for header in request.headers.getlist("if-none-match"):
        for candidate in header.split(","):
            if candidate.strip().removeprefix("W/") == etag.removeprefix("W/"):
                return Response(status_code=304, headers={"ETag": etag})
    return JSONResponse(body, headers={"ETag": etag, "Cache-Control": "no-store"})


@performance_ingest_router.post(
    "/runners/{key}/events", openapi_extra=_body_openapi(PerformanceEventsBody)
)
@answers_refusals
def post_events(
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceEventsBody = Depends(
        _body(PerformanceEventsBody, "performance_events_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Report what happened; events belong to the runner and are taken at any time."""
    settings = ingest_settings()
    if len(body.events) > settings.performance_events_batch_max:
        raise performance_ingest.refusal("too_many_events")
    runner = performance_ingest.registered_runner(
        db, scope[0].id, key, instance, lock=True
    )
    accepted = performance_ingest.store_events(db, runner, body.events, settings)
    _commit(db)
    return {"accepted": accepted}


# --------------------------------------------------------------------------- run routes


@performance_ingest_router.post(
    "/runners/{key}/runs/{run_id}/claim",
    openapi_extra=_body_openapi(PerformanceClaimBody),
)
@answers_refusals
def claim_run(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceClaimBody = Depends(
        _body(PerformanceClaimBody, "performance_progress_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Take a queued run, once. A claimed or ended run is never given out again."""
    now = performance_ingest.utcnow()
    # Locked, like registration does: a new process cannot register between this
    # check and the claim, and leave the run with the process it replaced.
    runner = performance_ingest.find_runner(db, scope[0].id, key, lock=True)
    if runner is None:
        raise performance_ingest.refusal("run_not_found")
    if runner.instance_id != instance:
        raise performance_ingest.refusal("instance_mismatch")
    _runner, run = _run(db, scope[0], key, run_id, now)
    run = performance_ingest.claim_run(db, run, instance=instance, now=now)
    _commit(db)
    return performance_ingest.claim_payload(run)


@performance_ingest_router.post(
    "/runners/{key}/runs/{run_id}/progress",
    openapi_extra=_body_openapi(PerformanceProgressBody),
)
@answers_refusals
def post_progress(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceProgressBody = Depends(
        _body(PerformanceProgressBody, "performance_progress_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Report status and progress; the answer carries a stop request and the token versions."""
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    answer = performance_ingest.report_progress(
        db,
        run,
        instance=instance,
        seq=body.seq,
        status=body.status,
        progress=body.progress,
        error=body.error,
        exit_code=body.exit_code,
        now=now,
    )
    _commit(db)
    return answer


@performance_ingest_router.post(
    "/runners/{key}/runs/{run_id}/questions",
    openapi_extra=_body_openapi(PerformanceQuestionsBody),
)
@answers_refusals
def post_questions(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceQuestionsBody = Depends(
        _body(PerformanceQuestionsBody, "performance_questions_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Send finished questions; each record is checked and stored on its own."""
    settings = ingest_settings()
    if len(body.records) > settings.performance_questions_batch_max:
        raise performance_ingest.refusal("too_many_records")
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    platform.require_kind(run, "chat")
    performance_ingest.require_results_open(run, instance, now)
    records, slots = _checked_records(body.records, PerformanceQuestionRecordBody)
    report = performance_ingest.store_questions(db, run, records, settings, now)
    stored = iter(report["results"])
    report["results"] = [next(stored) if slot is None else slot for slot in slots]
    report["rejected"] = len(body.records) - len(records)
    _commit(db)
    return report


@performance_ingest_router.post(
    "/runners/{key}/runs/{run_id}/log", openapi_extra=_body_openapi(PerformanceLogBody)
)
@answers_refusals
def post_log(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceLogBody = Depends(
        _body(PerformanceLogBody, "performance_log_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Send log lines; token text is masked before a line is stored."""
    settings = ingest_settings()
    if len(body.lines) > settings.performance_log_batch_max:
        raise performance_ingest.refusal("too_many_lines")
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    performance_ingest.require_results_open(run, instance, now)
    lines, _slots = _checked_records(body.lines, PerformanceLogLineBody)
    report = performance_ingest.store_log_lines(db, run, lines, settings, now)
    report["rejected"] = len(body.lines) - len(lines)
    _commit(db)
    return report


@performance_ingest_router.put(
    "/runners/{key}/runs/{run_id}/summary",
    openapi_extra=_body_openapi(PerformanceSummaryBody),
)
@answers_refusals
def put_summary(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: tuple[PerformanceSummaryBody, dict[str, Any]] = Depends(_summary_body),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Store the result; token text in it is masked before it is stored."""
    summary, payload = body
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    performance_ingest.require_results_open(run, instance, now)
    if summary.test_type != run.test_type:
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("body", "test_type"),
                    "msg": f"This run is a {run.test_type} test",
                }
            ]
        )
    if run.target_kind == platform.KIND:
        verdict = platform_ingest.store_summary(db, run, payload)
        _commit(db)
        return {"id": run.id, "verdict": verdict}
    verdict = performance_ingest.store_summary(
        db,
        run,
        summary=payload,
        headline=summary.headline,
        exit_code=summary.exit_code,
    )
    _commit(db)
    return {"id": run.id, "verdict": verdict}


@performance_ingest_router.put(
    "/runners/{key}/runs/{run_id}/report",
    status_code=204,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"text/html": {"schema": {"type": "string"}}},
        }
    },
)
@answers_refusals
def put_report(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    data: bytes = Depends(_report_body),
    db: Session = Depends(get_db),
) -> Response:
    """Store the report file; it is offered as a download only, never shown as a page."""
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    performance_ingest.require_results_open(run, instance, now)
    performance_ingest.store_report(db, run, data, now)
    _commit(db)
    return Response(status_code=204)


@performance_ingest_router.get("/runners/{key}/runs/{run_id}/dataset-items")
@answers_refusals
def get_dataset_items(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    limit: int = Query(default=500, ge=1, le=1000),
    after: Optional[str] = Query(default=None, pattern=_AFTER_PATTERN),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Read the questions of the dataset version the run pinned. Writes nothing."""
    now = performance_ingest.utcnow()
    _runner, run = performance_ingest.find_run(db, scope[0].id, key, run_id)
    platform.require_kind(run, "chat")
    performance_ingest.require_claimer(run, instance)
    status = performance_state.effective_status(run, now=now)
    if status in performance_state.TERMINAL_STATUSES:
        raise performance_ingest.refusal("run_finished", {"status": status})
    return performance_ingest.dataset_items_page(
        db, run, after=performance_ingest.parse_after(after), limit=limit
    )


@performance_ingest_router.put(
    "/runners/{key}/runs/{run_id}/tokens/{name}",
    openapi_extra=_body_openapi(PerformanceTokenBody),
)
@answers_refusals
def put_token(
    run_id: str,
    name: Literal["refresh_token", "session_cookie"],
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: PerformanceTokenBody = Depends(
        _body(PerformanceTokenBody, "performance_progress_max_bytes")
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Report a refresh token the target handed out in place of the saved one."""
    project, principal = scope
    now = performance_ingest.utcnow()
    runner, run = _run(db, project, key, run_id, now)
    performance_ingest.require_results_open(run, instance, now)
    answer = performance_ingest.rotate_token(
        db,
        run,
        runner,
        principal,
        name=name,
        value=body.value,
        replaces_version=body.replaces_version,
        expires_at=body.expires_at,
        now=now,
    )
    _commit(db)
    return answer


async def _discovery_body(request: Request):
    payload, _ = await _payload(
        request, ingest_settings().performance_platform_discovery_max_bytes
    )
    return payload


async def _steps_body(request: Request):
    payload, _ = await _payload(request, platform.FIXED_LIMITS["steps_max_bytes"])
    if not isinstance(payload, dict) or set(payload) != {"records"}:
        raise RequestValidationError(
            [
                {
                    "loc": ("body",),
                    "type": "value_error",
                    "msg": (
                        "Unknown fields are not allowed"
                        if isinstance(payload, dict) and set(payload) - {"records"}
                        else "Expected records"
                    ),
                    "ctx": {
                        "count": (
                            len(set(payload) - {"records"})
                            if isinstance(payload, dict)
                            else 0
                        )
                    },
                }
            ]
        )
    return payload["records"]


@performance_platform_ingest_router.put("/runners/{key}/runs/{run_id}/discovery")
@answers_refusals
def put_discovery(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: Any = Depends(_discovery_body),
    db: Session = Depends(get_db),
):
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    platform.require_kind(run)
    performance_ingest.require_results_open(run, instance, now)
    platform_ingest.store_discovery(db, run, body, ingest_settings(), now)
    _commit(db)
    return {"id": run.id, "accepted": True}


@performance_platform_ingest_router.post("/runners/{key}/runs/{run_id}/steps")
@answers_refusals
def post_steps(
    run_id: str,
    scope: Scope,
    key: RunnerKey,
    instance: Instance,
    body: Any = Depends(_steps_body),
    db: Session = Depends(get_db),
):
    now = performance_ingest.utcnow()
    _runner, run = _run(db, scope[0], key, run_id, now)
    platform.require_kind(run)
    performance_ingest.require_results_open(run, instance, now)
    answer = platform_ingest.store_steps(db, run, body, ingest_settings(), now)
    _commit(db)
    return answer
