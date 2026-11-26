"""Project-scoped performance pages: Home, history, New run, a run, targets and the runner.

``B`` is ``/api/projects/{project_slug}/performance``. Every member of the
project reads; a Member starts and stops runs and saves sign-in tokens; a
Manager adds, changes and archives targets, chooses the runner key and is the
only one who may put load on a production target. The role checks run as
dependencies, so they answer before the request body is looked at.

A refusal a person can act on answers ``{"error": {"code", "message",
"details"}}`` with the codes of ``frontend/src/api/performance.ts``. Token
values are accepted in two request bodies and never returned.
"""

from __future__ import annotations

import csv
import io
import zlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterator, Literal, NoReturn, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp, to_storage_utc
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    PerformanceReport,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    Project,
)
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import (
    VIEWER_DETAIL,
    is_project_manager,
    is_project_viewer,
    project_for_read_by_slug,
    require_project_writable,
)
from qym_platform.services import performance_platform as platform
from qym_platform.services import performance_platform_schema as platform_schema
from qym_platform.services.performance_platform_ingest import checked
from qym_platform.services import performance_plan as plan_rules
from qym_platform.services import performance_runs
from qym_platform.services import performance_state as state
from qym_platform.services import performance_targets as targets
from qym_platform.services import performance_views as views
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)
performance_router = APIRouter(tags=["performance"])

BASE = "/api/projects/{project_slug}/performance"
RUNNER_ENTITY = "performance_runner"

TestType = Literal["breakpoint", "smoke", "soak"]
RunStatus = Literal[
    "queued",
    "starting",
    "running",
    "stopping",
    "finished",
    "stopped",
    "failed",
    "interrupted",
    "expired",
]
Verdict = Literal[
    "breakpoint_found", "not_reached", "invalid_auth", "invalid_no_data", "pass", "fail"
]
Tier = Literal["simple", "medium", "complex"]
TokenName = Literal["refresh_token", "access_token", "session_cookie"]
LogLevel = Literal["info", "warning", "error"]
QuestionStatus = Literal["ok", "error", "interrupted"]
QuestionSort = Literal[
    "seq", "-seq", "duration_ms", "-duration_ms", "ttfb_ms", "-ttfb_ms"
]


# ---------------------------------------------------------------------------
# Who asks, and refusals
# ---------------------------------------------------------------------------


@dataclass
class Context:
    """The project of the request and what the person asking may do in it."""

    project: Project
    principal: Principal
    access: views.Access


def _refuse(exc: PerformanceError) -> NoReturn:
    """Answer a refusal with its code, its sentence and its details."""
    headers = None
    if "retry_after_s" in exc.details:
        headers = {"Retry-After": str(exc.details["retry_after_s"])}
    # "Target not found" names its own code (target_not_found) in the platform's
    # error body; every other refusal carries its code with it.
    detail: Any = exc.message
    if exc.status != 404 or exc.details:
        detail = {"code": exc.code, "message": exc.message, "details": exc.details}
    raise HTTPException(status_code=exc.status, detail=detail, headers=headers) from exc


def _invalid(exc: targets.FieldError) -> NoReturn:
    """Answer an unusable field as the platform answers every invalid body."""
    raise RequestValidationError(
        [{"loc": ("body", *exc.loc), "msg": exc.message, "type": "value_error"}]
    ) from exc


def _forbidden(message: str) -> HTTPException:
    return HTTPException(
        status_code=403, detail={"code": "forbidden", "message": message}
    )


def _reader(
    project_slug: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Context:
    """Any member of the project, a Viewer included; an archived project still reads."""
    if not PlatformSettings().performance_enabled:
        raise HTTPException(status_code=404, detail="Performance is switched off")
    project = project_for_read_by_slug(db, principal, project_slug)
    header = request.headers.get("X-Qym-Performance-Platform")
    if request.method == "GET" and header not in (None, "1"):
        raise RequestValidationError([{"loc": ("header", "X-Qym-Performance-Platform"), "type": "value_error", "msg": "Expected 1"}])
    db.info["performance_platform_read"] = request.method != "GET" or header == "1"
    if request.method == "GET":
        response.headers["Vary"] = "X-Qym-Performance-Platform"
        response.headers["Cache-Control"] = "private, no-store"
    return Context(
        project=project,
        principal=principal,
        access=views.Access(
            writer=not is_project_viewer(db, principal, project.id),
            manager=is_project_manager(db, principal, project.id),
            archived=not project.is_active,
        ),
    )


def _stopper(context: Context = Depends(_reader)) -> Context:
    """A Member; allowed in an archived project too, because it only takes work away.

    A Viewer gets the platform's own refusal, exactly as on every other route
    (``detail`` is the sentence, ``error.code`` ``viewers_cannot_change_this_project``);
    every write route depends on this one.
    """
    if not context.access.writer:
        raise HTTPException(status_code=403, detail=VIEWER_DETAIL)
    return context


def _member(
    context: Context = Depends(_stopper), db: Session = Depends(get_db)
) -> Context:
    """A Member of a project that is not archived."""
    require_project_writable(db, context.project.id)
    return context


def _manager(
    context: Context = Depends(_stopper), db: Session = Depends(get_db)
) -> Context:
    """A Manager of a project that is not archived."""
    if not context.access.manager:
        raise _forbidden("Only a project Manager can do this.")
    require_project_writable(db, context.project.id)
    return context


def _run(db: Session, context: Context, run_id: str) -> PerformanceRun:
    try:
        run = views.get_run(db, context.project.id, run_id)
        if run.target_kind == platform.KIND and not db.info.get("performance_platform_read"):
            raise PerformanceError("run_not_found", 404, "Run not found")
        return run
    except PerformanceError as exc:
        _refuse(exc)


def _production_guard(context: Context, target: Optional[PerformanceTarget]) -> None:
    """Saving a sign-in for a production target is a Manager's action, as starting a run on it."""
    if target is not None and target.is_production and not context.access.manager:
        _refuse(
            PerformanceError(
                "production_requires_manager",
                403,
                "Only a project Manager can save a sign-in for a production target.",
            )
        )


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class PlanBody(BaseModel):
    """What the person sets for a run; fields of another test type are ignored."""

    baseline_users: Optional[int] = Field(default=None, ge=plan_rules.MIN_USERS)
    max_users: Optional[int] = Field(default=None, ge=plan_rules.MIN_USERS)
    step_users: Optional[int] = Field(default=None, ge=plan_rules.MIN_USERS)
    hold_seconds: Optional[int] = Field(default=None, ge=30, le=3600)
    follow_up_rate: Optional[float] = Field(default=None, ge=0, le=1)
    abort_on_break: Optional[bool] = None
    limit_ms: int = Field(ge=1000, le=900000)
    max_error_rate_pct: int = Field(ge=1, le=100)
    timeout_seconds: int = Field(ge=30, le=900)
    users: Optional[int] = Field(default=None, ge=plan_rules.MIN_USERS)
    duration_seconds: Optional[int] = Field(
        default=None, ge=plan_rules.MIN_DURATION_SECONDS
    )
    min_quality: Optional[float] = Field(default=None, ge=0, le=100)
    max_no_data_pct: Optional[float] = Field(default=None, ge=0, le=100)

    @field_validator("limit_ms")
    @classmethod
    def whole_seconds(cls, value: int) -> int:
        if value % plan_rules.LIMIT_MS_STEP:
            raise ValueError("the time limit must be a whole number of seconds")
        return value


class MixBody(BaseModel):
    simple: int = Field(ge=0, le=100)
    medium: int = Field(ge=0, le=100)
    complex: int = Field(ge=0, le=100)


class StartOptionsBody(BaseModel):
    store_answers: Optional[bool] = None


class StartRunBody(BaseModel):
    target_id: str = Field(min_length=1, max_length=36)
    test_type: TestType
    dataset_version_id: str = Field(min_length=1, max_length=36)
    plan: PlanBody
    mix: MixBody
    options: Optional[StartOptionsBody] = None
    note: str = Field(default="", max_length=500)
    confirm_target: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="before")
    @classmethod
    def only_the_fields_of_the_test(cls, data: Any) -> Any:
        """Drop plan fields the test type does not read, before they are judged."""
        if isinstance(data, dict) and isinstance(data.get("plan"), dict):
            test_type = data.get("test_type")
            used = (
                plan_rules.PLAN_FIELDS.get(test_type)
                if isinstance(test_type, str)
                else None
            )
            if used is not None:
                plan = {
                    name: value for name, value in data["plan"].items() if name in used
                }
                data = {**data, "plan": plan}
        return data

    @model_validator(mode="after")
    def plan_fits_the_test(self) -> "StartRunBody":
        needed = {
            "breakpoint": ("baseline_users", "max_users", "step_users", "hold_seconds"),
            "smoke": (),
            "soak": ("users", "duration_seconds"),
        }[self.test_type]
        missing = [name for name in needed if getattr(self.plan, name) is None]
        if missing:
            raise ValueError(f"a {self.test_type} plan needs {', '.join(missing)}")
        return self


class StopBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class TokenBody(BaseModel):
    """A token a person pasted. Write-only: no route returns it.

    Any value is taken here and judged by the service, so that an unusable one
    is refused as empty and never comes back in a validation answer. A body that
    is not a JSON object (a bare string, a list, plain text, a form) is read as
    an object without a token: the pasted text is never part of the answer.
    """

    token: Any = None
    expires_at: Optional[datetime] = None

    @model_validator(mode="before")
    @classmethod
    def an_object(cls, data: Any) -> Any:
        return data if isinstance(data, dict) else {}


class HandoffBody(TokenBody):
    name: TokenName


class TargetSettingsBody(BaseModel):
    auth_server: Optional[str] = Field(default=None, max_length=500)
    refresh_cookie_name: Optional[str] = Field(default=None, max_length=100)


class TargetBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    is_production: bool
    base_url: str = Field(min_length=1, max_length=500)
    chat_path: Optional[str] = Field(default=None, max_length=500)
    token_refresh_path: Optional[str] = Field(default=None, max_length=500)
    settings: Optional[TargetSettingsBody] = None
    max_users: Optional[int] = None
    max_duration_s: Optional[int] = None

    def values(self) -> dict[str, Any]:
        data = self.model_dump(exclude={"settings"})
        data["settings"] = (
            self.settings.model_dump(exclude_unset=True) if self.settings else {}
        )
        return data


def _target_values(body, target=None):
    kind = body.get("kind", target.kind if target else "chat")
    if target is not None and kind != target.kind:
        raise platform.refusal("target_kind_immutable")
    if kind == platform.KIND:
        return checked(platform_schema.Target, body)
    if kind != "chat":
        raise targets.FieldError(("kind",), "Unknown target kind")
    try:
        return TargetBody.model_validate(body).values()
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_input=False, include_context=False)) from None


class RunnerKeyBody(BaseModel):
    api_key_id: Optional[str] = Field(max_length=36)


# ---------------------------------------------------------------------------
# Home, history, setup
# ---------------------------------------------------------------------------


@performance_router.get(BASE)
def performance_home(
    context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Home: the runner, the run in progress, the targets and the first history page."""
    return views.home(db, context.project, context.access, views.utcnow())


@performance_router.get(BASE + "/runs")
def performance_runs_list(
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=views.RUNS_PAGE_SIZE, ge=1, le=200),
    status: Optional[list[RunStatus]] = Query(default=None),
    verdict: Optional[list[Verdict]] = Query(default=None),
    target: Optional[str] = Query(default=None, max_length=36),
    test_type: Optional[list[TestType]] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    target_kind: Optional[Literal["chat", "estishraf_platform"]] = Query(default=None),
    context: Context = Depends(_reader),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The history, newest first; filters are repeated query parameters, `q` searches."""
    filters = views.RunFilters(
        page=page,
        page_size=page_size,
        status=list(status or []),
        verdict=list(verdict or []),
        target=target or None,
        test_type=list(test_type or []),
        q=q or None,
        target_kind=target_kind,
    )
    return views.runs_page(db, context.project, filters, views.utcnow())


@performance_router.get(BASE + "/setup")
def performance_setup(
    context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """What the New run page needs: runner, targets with sign-in hints, limits, defaults."""
    return views.setup(
        db, context.project, context.principal.user.id, context.access, views.utcnow()
    )


@performance_router.get(BASE + "/datasets")
def performance_datasets(
    context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """The project's datasets a run could use, with their questions counted per kind."""
    return views.datasets_list(db, context.project)


@performance_router.get(BASE + "/dataset-tiers")
def performance_dataset_tiers(
    dataset_version_id: str = Query(..., min_length=1, max_length=36),
    context: Context = Depends(_reader),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Questions per kind and follow-ups of one dataset version, and whether a run can use it."""
    try:
        return views.dataset_tiers(db, context.project, dataset_version_id)
    except PerformanceError as exc:
        _refuse(exc)


@performance_router.post(BASE + "/runs", status_code=201)
def performance_start(
    body: dict[str, Any],
    context: Context = Depends(_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Queue a run for the project's runner, after every check that can be made before it starts."""
    try:
        if body.get("target_kind", "chat") not in ("chat", platform.KIND):
            raise targets.FieldError(("target_kind",), "Unknown target kind")
        if isinstance(body.get("target_id"), str):
            selected = targets.get_target(db, context.project.id, body["target_id"])
            if selected.kind != body.get("target_kind", "chat"):
                raise platform.refusal("wrong_target_kind")
        if body.get("target_kind") == platform.KIND:
            body = checked(platform_schema.Start, body)
            run = platform.start_run(db, context.project, context.principal.user, body, views.utcnow())
        else:
            body = StartRunBody.model_validate(body)
            run = performance_runs.start_run(
            db,
            project=context.project,
            user=context.principal.user,
            body=body,
            now=views.utcnow(),
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    except targets.FieldError as exc:
        db.rollback()
        _invalid(exc)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_input=False, include_context=False)) from None
    payload = {
        "id": run.id,
        "number": run.number,
        "status": "queued",
        "requested_at": to_api_timestamp(run.requested_at),
        "plan": run.config["plan"],
    }
    db.commit()
    return payload


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


@performance_router.get(BASE + "/runs/{run_id}")
def performance_run(
    run_id: str, context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """The run page, live and finished."""
    run = _run(db, context, run_id)
    return views.run_read(db, context.project, run, context.access, views.utcnow())


def _question_filters(
    after_seq: Optional[int] = Query(default=None, ge=0),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=50, ge=1, le=200),
    status: Optional[list[QuestionStatus]] = Query(default=None),
    level: Optional[list[int]] = Query(default=None),
    tier: Optional[list[Tier]] = Query(default=None),
    followup: Optional[bool] = Query(default=None),
    no_data: Optional[bool] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    sort: Optional[QuestionSort] = Query(default=None),
) -> views.QuestionFilters:
    return views.QuestionFilters(
        after_seq=after_seq,
        page=page,
        page_size=page_size,
        status=list(status or []),
        level=list(level or []),
        tier=list(tier or []),
        followup=followup,
        no_data=no_data,
        q=q,
        sort=sort or "",
    )


@performance_router.get(BASE + "/runs/{run_id}/questions")
def performance_questions(
    run_id: str,
    filters: views.QuestionFilters = Depends(_question_filters),
    context: Context = Depends(_reader),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The questions asked, newest first; with ``after_seq`` the ones that came since."""
    run = _run(db, context, run_id)
    try:
        platform.require_kind(run, "chat")
    except PerformanceError as exc:
        _refuse(exc)
    filters.sort = filters.sort or "-seq"
    return views.questions_page(db, run, filters)


def _csv_chunks(rows: Iterator[list[str]]) -> Iterator[str]:
    """Encode CSV rows one by one, so the whole file is never held in memory."""
    yield "﻿"
    with io.StringIO(newline="") as buffer:
        writer = csv.writer(buffer)
        for row in rows:
            writer.writerow(row)
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)


_DOWNLOAD_HEADERS = {
    "Vary": "X-Qym-Performance-Platform",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
}


def _attachment(name: str) -> dict[str, str]:
    return {
        "Vary": "X-Qym-Performance-Platform",
        "Content-Disposition": f'attachment; filename="{name}"',
        **_DOWNLOAD_HEADERS,
    }


@performance_router.get(BASE + "/runs/{run_id}/questions.csv")
def performance_questions_csv(
    run_id: str,
    filters: views.QuestionFilters = Depends(_question_filters),
    context: Context = Depends(_reader),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Every question that matches the filters, as a file; oldest first unless a sort is given."""
    run = _run(db, context, run_id)
    try:
        platform.require_kind(run, "chat")
    except PerformanceError as exc:
        _refuse(exc)
    filters.sort = filters.sort or "seq"
    return StreamingResponse(
        _csv_chunks(views.questions_export(db, run, filters)),
        media_type="text/csv; charset=utf-8",
        headers=_attachment(f"performance-run-{run.number}-questions.csv"),
    )


@performance_router.get(BASE + "/runs/{run_id}/log")
def performance_log(
    run_id: str,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    level: Optional[list[LogLevel]] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    context: Context = Depends(_reader),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Log lines in order after ``after_seq``."""
    run = _run(db, context, run_id)
    filters = views.LogFilters(
        after_seq=after_seq, limit=limit, level=list(level or []), q=q
    )
    return views.log_page(db, run, filters)


@performance_router.get(BASE + "/runs/{run_id}/log.txt")
def performance_log_text(
    run_id: str, context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> StreamingResponse:
    """The whole log as a text file."""
    run = _run(db, context, run_id)
    return StreamingResponse(
        views.log_text(db, run),
        media_type="text/plain; charset=utf-8",
        headers=_attachment(f"performance-run-{run.number}-log.txt"),
    )


@performance_router.get(BASE + "/runs/{run_id}/events")
def performance_run_events(
    run_id: str, context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """The run's timeline, oldest first."""
    return views.run_events(db, _run(db, context, run_id))


@performance_router.get(BASE + "/runs/{run_id}/report", response_class=Response)
def performance_report(
    run_id: str, context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> Response:
    """The report file as a download. It holds scripts, so it is never shown as a page of qym."""
    run = _run(db, context, run_id)
    row = db.get(PerformanceReport, run.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return Response(
        content=zlib.decompress(row.html),
        media_type="text/html; charset=utf-8",
        headers={
            **_attachment(f"performance-run-{run.number}-report.html"),
            "Content-Security-Policy": "sandbox",
        },
    )


@performance_router.post(BASE + "/runs/{run_id}/stop")
def performance_stop(
    run_id: str,
    body: Optional[StopBody] = Body(default=None),
    context: Context = Depends(_stopper),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Stop a run. A repeat, and a run that has already ended, also answer 200."""
    run = _run(db, context, run_id)
    before = run.status
    now = views.utcnow()
    run = performance_runs.stop_run(
        db,
        run=run,
        user=context.principal.user,
        reason=body.reason if body else None,
        now=now,
    )
    payload = {
        "id": run.id,
        "status": state.effective_status(run, now=now),
        "outcome": performance_runs.stop_outcome(before, run),
        "stop_requested_at": to_api_timestamp(run.stop_requested_at),
    }
    db.commit()
    return payload


@performance_router.post(BASE + "/runs/{run_id}/tokens")
def performance_handoff(
    run_id: str,
    body: HandoffBody,
    context: Context = Depends(_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Give a run that is going on a new token; the runner finds it within seconds."""
    run = _run(db, context, run_id)
    target = db.get(PerformanceTarget, run.target_id) if run.target_id else None
    _production_guard(context, target)
    try:
        token = performance_runs.handoff_token(
            db,
            run=run,
            user=context.principal.user,
            name=body.name,
            value=body.token,
            now=views.utcnow(),
            expires_at=to_storage_utc(body.expires_at),
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    except targets.FieldError as exc:
        db.rollback()
        _invalid(exc)
    payload = {"name": token.name, "hint": token.token_hint, "version": token.version}
    db.commit()
    return payload


# ---------------------------------------------------------------------------
# Targets and their sign-in tokens
# ---------------------------------------------------------------------------


def _target_payload(
    db: Session, context: Context, target: PerformanceTarget, now: datetime
) -> dict[str, Any]:
    return targets.target_payloads(
        db,
        [target],
        now=now,
        can_write=context.access.can_start,
        is_manager=context.access.manager,
        full=True,
    )[0]


def _target(
    db: Session, context: Context, target_id: str, *, lock: bool = True
) -> PerformanceTarget:
    try:
        return targets.get_target(db, context.project.id, target_id, lock=lock)
    except PerformanceError as exc:
        _refuse(exc)


@performance_router.get(BASE + "/targets")
def performance_targets(
    context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """All targets, archived ones too, with sign-in hints and their latest run."""
    settings = PlatformSettings()
    return {
        "targets": targets.target_payloads(
            db,
            targets.list_targets(db, context.project.id),
            now=views.utcnow(),
            can_write=context.access.can_start,
            is_manager=context.access.manager,
            full=True,
        ),
        "can_manage": context.access.can_manage,
        "encryption_ready": targets.encryption_ready(),
        "platform_limits": {
            "max_users": settings.performance_max_users,
            "max_duration_s": settings.performance_max_duration_seconds,
        },
    }


@performance_router.post(BASE + "/targets", status_code=201)
def performance_target_create(
    body: dict[str, Any],
    context: Context = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Add a target. Name and address are unique among targets that are not archived."""
    now = views.utcnow()
    try:
        target = targets.create_target(
            db,
            project=context.project,
            user=context.principal.user,
            values=_target_values(body),
            now=now,
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    except targets.FieldError as exc:
        _invalid(exc)
    payload = _target_payload(db, context, target, now)
    db.commit()
    return payload


@performance_router.put(BASE + "/targets/{target_id}")
def performance_target_update(
    target_id: str,
    body: dict[str, Any],
    context: Context = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Change a target. A new address removes its saved tokens."""
    now = views.utcnow()
    target = _target(db, context, target_id)
    try:
        target = targets.update_target(
            db,
            target=target,
            user=context.principal.user,
            values=_target_values(body, target),
            now=now,
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    except targets.FieldError as exc:
        db.rollback()
        _invalid(exc)
    payload = _target_payload(db, context, target, now)
    db.commit()
    return payload


@performance_router.delete(BASE + "/targets/{target_id}", status_code=204)
def performance_target_archive(
    target_id: str,
    context: Context = Depends(_manager),
    db: Session = Depends(get_db),
) -> Response:
    """Archive a target: hidden from new runs, kept for the history. Never deleted."""
    target = _target(db, context, target_id)
    try:
        targets.archive_target(
            db, target=target, user=context.principal.user, now=views.utcnow()
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    db.commit()
    return Response(status_code=204)


@performance_router.post(BASE + "/targets/{target_id}/restore")
def performance_target_restore(
    target_id: str,
    context: Context = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Bring an archived target back, unless its name or address is taken meanwhile."""
    now = views.utcnow()
    target = _target(db, context, target_id)
    try:
        target = targets.restore_target(
            db, target=target, user=context.principal.user, now=now
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    payload = _target_payload(db, context, target, now)
    db.commit()
    return payload


@performance_router.put(BASE + "/targets/{target_id}/tokens/{name}")
def performance_target_token_save(
    target_id: str,
    name: TokenName,
    body: TokenBody,
    context: Context = Depends(_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Save or replace one token of a target; answers its name, last 4 characters and version."""
    now = views.utcnow()
    target = _target(db, context, target_id)
    _production_guard(context, target)
    try:
        token = targets.save_token(
            db,
            target=target,
            name=name,
            value=body.token,
            expires_at=to_storage_utc(body.expires_at),
            user=context.principal.user,
            now=now,
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    except targets.FieldError as exc:
        db.rollback()
        _invalid(exc)
    names = targets.user_names(db, [token.updated_by_user_id])
    payload = targets.token_hint(token, names, now)
    db.commit()
    return payload


@performance_router.delete(BASE + "/targets/{target_id}/tokens/{name}", status_code=204)
def performance_target_token_delete(
    target_id: str,
    name: TokenName,
    context: Context = Depends(_member),
    db: Session = Depends(get_db),
) -> Response:
    """Remove one saved token. A repeat changes nothing."""
    target = _target(db, context, target_id)
    _production_guard(context, target)
    try:
        targets.delete_token(
            db,
            target=target,
            name=name,
            user=context.principal.user,
            now=views.utcnow(),
        )
    except PerformanceError as exc:
        db.rollback()
        _refuse(exc)
    except targets.FieldError as exc:
        db.rollback()
        _invalid(exc)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# The runner
# ---------------------------------------------------------------------------


@performance_router.get(BASE + "/runner")
def performance_runner(
    context: Context = Depends(_reader), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """The Runner page: status, the key that receives the tokens, how to connect."""
    return views.runner_page(db, context.project, context.access, views.utcnow())


def _default_runner(db: Session, project: Project, now: datetime) -> PerformanceRunner:
    """The project's runner row, made here when no runner has connected yet.

    The row is marked as never connected (no registration time); the runner's
    first registration takes it over, whatever key it registers under.
    """
    # The same lock a registering runner takes, so the two cannot both make a row.
    db.execute(select(Project.id).where(Project.id == project.id).with_for_update())
    runner = views.project_runner(db, project.id, lock=True)
    if runner is not None:
        return runner
    runner = PerformanceRunner(
        project_id=project.id,
        key=views.DEFAULT_RUNNER_KEY,
        name=views.DEFAULT_RUNNER_NAME,
        info={},
        created_at=now,
        updated_at=now,
    )
    try:
        with db.begin_nested():
            db.add(runner)
            db.flush()
    except IntegrityError:
        # SQLite has no row lock: somebody made the row a moment ago.
        runner = views.project_runner(db, project.id, lock=True)
        if runner is None:
            raise
    return runner


@performance_router.put(BASE + "/runner/key")
def performance_runner_key(
    body: RunnerKeyBody,
    context: Context = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Choose the API key that receives the tokens; null removes the choice."""
    now = views.utcnow()
    project = context.project
    key = None
    if body.api_key_id is not None:
        key = db.scalars(
            select(ApiKey).where(
                ApiKey.id == body.api_key_id,
                ApiKey.project_id == project.id,
                ApiKey.kind == "user",
            )
        ).first()
        if key is None:
            raise HTTPException(status_code=404, detail="API key not found")
        if key.revoked_at is not None:
            _refuse(
                PerformanceError(
                    "api_key_revoked",
                    409,
                    "This API key has been revoked. Choose another key.",
                )
            )
    runner = _default_runner(db, project, now)
    if runner.runner_key_id != body.api_key_id:
        run = targets.active_run(db, now=now, runner_id=runner.id)
        if run is not None:
            db.rollback()
            _refuse(
                PerformanceError(
                    "runner_busy",
                    409,
                    f"Run {run.number} is in progress and uses the current key. Stop it "
                    "or wait until it ends, then change the key.",
                    {"run_id": run.id},
                )
            )
        previous = (
            db.get(ApiKey, runner.runner_key_id) if runner.runner_key_id else None
        )
        runner.runner_key_id = body.api_key_id
        runner.runner_key_changed_at = now
        runner.runner_key_changed_by_user_id = context.principal.user.id
        targets.touch(runner, now)
        db.add(
            AuditLog(
                actor_user_id=context.principal.user.id,
                action="performance.runner.key",
                entity_type=RUNNER_ENTITY,
                entity_id=runner.id,
                before={"prefix": previous.prefix if previous else None},
                after={"prefix": key.prefix if key else None},
            )
        )
        db.flush()
    payload = {"runner_key": views.runner_key_payload(db, runner, key)}
    db.commit()
    return payload


@performance_router.get(BASE + "/runner/events")
def performance_runner_events(
    page: int = Query(default=1, ge=1, le=1_000_000),
    limit: int = Query(default=10, ge=1, le=100),
    level: Optional[list[LogLevel]] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    context: Context = Depends(_reader),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The runner's problems and notes, newest first; `q` searches the message."""
    return views.runner_events(
        db,
        context.project,
        page=page,
        limit=limit,
        levels=list(level or []),
        q=q or None,
    )


def _platform_filters(request: Request, table: str, *, export: bool = False):
    """Parse repeated dashboard filters without coercing malformed IDs or booleans."""
    import json
    from qym_platform.services.performance_platform_schema import identifier
    params = request.query_params
    def bad():
        raise RequestValidationError([{"loc": ("query",), "type": "value_error", "msg": "Invalid dashboard filters"}])
    def integer(key, default, low, high):
        value = params.get(key)
        if value is None:
            return default
        if not value.isdigit() or not low <= int(value) <= high:
            bad()
        return int(value)
    filters = dict(page=integer("page", 1, 1, 1000000), page_size=integer("page_size", 50, 1, 200), q=params.get("q", ""))
    if len(filters["q"]) > 200:
        bad()
    enums = {"type": platform.TYPES, "stage": platform.STAGES, "error_class": platform.ERROR_CLASSES}
    for key in ("type", "stage", "error_class", "level", "dashboard"):
        values = params.getlist(key)
        if len(values) > 200:
            bad()
        if key in enums and any(v not in enums[key] for v in values):
            bad()
        if key == "level":
            if any(not v.isdigit() or not 1 <= int(v) <= 2147483647 for v in values):
                bad()
            values = [int(v) for v in values]
        if key == "dashboard":
            try:
                values = [platform.canonical(identifier(json.loads(v))) for v in values]
            except (ValueError, TypeError, RecursionError):
                bad()
        filters[key] = values
    for key in ("has_errors", "runnable"):
        value = params.get(key)
        if value not in (None, "true", "false"):
            bad()
        filters[key] = None if value is None else value == "true"
    filters["after_seq"] = integer("after_seq", None, 0, 2147483647)
    default_sort = "seq" if export or filters["after_seq"] is not None else "-seq"
    filters["sort"] = params.get("sort", "title" if table == "dashboards" else default_sort)
    allowed = ("title", "-title", "opens", "-opens", "open_p95_ms", "-open_p95_ms") if table == "dashboards" else ("seq", "-seq", "duration_ms", "-duration_ms")
    if filters["sort"] not in allowed or (filters["after_seq"] is not None and (filters["page"] != 1 or filters["sort"] != "seq")):
        bad()
    return filters


@performance_router.get(BASE + "/runs/{run_id}/discovery")
def performance_discovery(run_id: str, request: Request, context: Context = Depends(_reader), db: Session = Depends(get_db)):
    from qym_platform.services import performance_platform_views as platform_views
    run = _run(db, context, run_id)
    try:
        return platform_views.discovery_page(run, _platform_filters(request, "discovery"))
    except PerformanceError as exc:
        _refuse(exc)


@performance_router.get(BASE + "/runs/{run_id}/steps")
def performance_steps(run_id: str, request: Request, context: Context = Depends(_reader), db: Session = Depends(get_db)):
    from qym_platform.services import performance_platform_views as platform_views
    run = _run(db, context, run_id)
    try:
        return platform_views.steps_page(db, run, _platform_filters(request, "steps"), views.utcnow())
    except PerformanceError as exc:
        _refuse(exc)


@performance_router.get(BASE + "/runs/{run_id}/steps.csv")
def performance_steps_csv(run_id: str, request: Request, context: Context = Depends(_reader), db: Session = Depends(get_db)):
    from qym_platform.services import performance_platform_views as platform_views
    run = _run(db, context, run_id)
    try:
        platform.require_kind(run)
    except PerformanceError as exc:
        _refuse(exc)
    rows = platform_views.steps_export(db, run, _platform_filters(request, "steps", export=True), views.utcnow())
    return StreamingResponse(_csv_chunks(rows), media_type="text/csv; charset=utf-8", headers=_attachment(f"performance-run-{run.number}-steps.csv"))


@performance_router.get(BASE + "/runs/{run_id}/dashboards")
def performance_dashboards(run_id: str, request: Request, context: Context = Depends(_reader), db: Session = Depends(get_db)):
    from qym_platform.services import performance_platform_views as platform_views
    run = _run(db, context, run_id)
    try:
        return platform_views.dashboards_page(db, run, _platform_filters(request, "dashboards"), views.utcnow())
    except PerformanceError as exc:
        _refuse(exc)
