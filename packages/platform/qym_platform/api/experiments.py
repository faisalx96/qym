"""Evaluation Service experiments: launch, list, detail, cancel, retry and clone.

Routes live under ``/v1/projects/{project_id}/experiments`` (plan §14).

- Members may create (``dry_run`` previews without persisting), list, read and clone.
  ``HIGH`` priority needs a project manager; every environment's ``max_priority`` caps
  the requested priority. The preemption acknowledgement is recorded when sent, and
  enforcing it is left to the HIGH policy (#14).
- Cancel and retry are for the experiment's creator or a project manager.
- Creation is rate-limited per user: ``QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT``
  launches (default 30, ``0`` disables) per
  ``QYM_EVAL_EXPERIMENT_CREATE_RATE_WINDOW_SECONDS`` (default 3600). The count comes
  from ``eval_experiments`` rows, so it holds across API processes. Dry runs are not
  counted.

This change launches **one** combination (no sweeps; #32/#33) on one or more
environments: one job per environment, all ``combo_index`` 0. The document is
validated per environment with placeholders only (``eval_config``), and bindings are
checked without decrypting anything (``eval_bindings``, ``decrypt=False``). Keys are
resolved by the dispatcher.

Temporary models (§7.5, #12) are **rejected** with a 422 (``code:
temporary_unsupported``) until #12 adds key storage. ``secrets_encrypted`` stays null.
Its format is a Fernet-encrypted JSON ``{ref: key}``, and clone never copies it.

Stored per job:

- ``params``: ``{"slot_bindings": {slot_key: binding | null}}``. Connection bindings
  are ``{"connection_id", "name", "model"}``.
- ``request_body``: the placeholder ``EvalJobCreate`` with ``user_id`` (creator),
  ``priority``, ``evaluator.config.run_name``/``live_mode`` and the reserved
  ``run_metadata.qym_launch`` (no token) and ``qym_config`` (§10.1). The dispatcher
  adds the token with ``eval_experiments.body_with_launch_token``.
- ``launch_token_hash``: sha256 of the derived one-time token. The raw token is never
  stored, logged or returned.

Secret refs (``{"$secret": ref}``) are stripped from every response and from clones.
"""

from __future__ import annotations

import copy
from datetime import timedelta
from typing import Any, Dict, List, Mapping, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from qym_platform.api.projects import _require_project_access
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    AuditLog,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalExperimentStatus,
    EvalJobStatus,
    EvalModelSlotStatus,
    EvalPriority,
    Run,
    User,
)
from qym_platform.deps import get_db
from qym_platform.permissions import is_project_manager
from qym_platform.secrets import encryption_available
from qym_platform.services.eval_bindings import resolve_slot_bindings
from qym_platform.services.eval_config import binding_kind, validate_config_document
from qym_platform.services.eval_experiments import (
    ALREADY_TERMINAL,
    CANCELLED,
    RETRYABLE_STATUSES,
    TERMINAL_JOB_STATUSES,
    cancel_job,
    current_jobs,
    launch_token_hash_for_job,
    recompute_experiment_status,
    superseded_job_ids,
)
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)
from qym_platform.services.eval_schema_form import escape_pointer_segment
from qym_platform.settings import PlatformSettings
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

router = APIRouter()

_PREFIX = "/v1/projects/{project_id}/experiments"
_PRIORITY_ORDER = {EvalPriority.LOW: 0, EvalPriority.NORMAL: 1, EvalPriority.HIGH: 2}
_BASE_KINDS = {"official", "saved", "best_run", "blank", "clone"}
_RUN_NAME_MAX = 200
_MAX_ENVIRONMENTS = 20


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #


class ExperimentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    environment_ids: List[str] = Field(..., min_length=1, max_length=_MAX_ENVIRONMENTS)
    # The §8.1 config document for one combination (no sweeps yet).
    spec: Dict[str, Any]
    base_source: Optional[Dict[str, Any]] = None
    priority: Optional[EvalPriority] = None
    acknowledge_preemption: bool = False
    dry_run: bool = False

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class CancelRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=1000)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _settings() -> PlatformSettings:
    return PlatformSettings()


def strip_secret_refs(value: Any) -> Any:
    """A copy without ``{"$secret": ref}`` values (temporary-model key refs)."""
    if isinstance(value, Mapping):
        return {
            key: strip_secret_refs(child)
            for key, child in value.items()
            if not (isinstance(child, Mapping) and "$secret" in child)
        }
    if isinstance(value, list):
        return [
            strip_secret_refs(v)
            for v in value
            if not (isinstance(v, Mapping) and "$secret" in v)
        ]
    return copy.deepcopy(value)


def _get_experiment(db: Session, project_id: str, experiment_id: str) -> EvalExperiment:
    experiment = (
        db.query(EvalExperiment)
        .filter(
            EvalExperiment.id == experiment_id,
            EvalExperiment.project_id == project_id,
        )
        .first()
    )
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return experiment


def _get_job(db: Session, experiment: EvalExperiment, job_id: str) -> EvalExperimentJob:
    job = (
        db.query(EvalExperimentJob)
        .filter(
            EvalExperimentJob.id == job_id,
            EvalExperimentJob.experiment_id == experiment.id,
        )
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _require_control(
    db: Session, principal: Principal, experiment: EvalExperiment
) -> None:
    """Cancel/retry: the experiment's creator or a project manager (plan §14)."""
    if experiment.created_by_user_id and (
        experiment.created_by_user_id == principal.user.id
    ):
        return
    if is_project_manager(db, principal, experiment.project_id):
        return
    raise HTTPException(
        status_code=403,
        detail="Only the experiment's creator or a project manager can do this",
    )


def _audit(
    db: Session,
    principal: Principal,
    action: str,
    entity_type: str,
    entity_id: str,
    after: Dict[str, Any],
) -> None:
    db.add(
        AuditLog(
            actor_user_id=principal.user.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before={},
            after=after,
        )
    )


def _check_rate_limit(db: Session, principal: Principal) -> None:
    settings = _settings()
    limit = settings.eval_experiment_create_rate_limit
    if limit <= 0:
        return
    window = timedelta(seconds=settings.eval_experiment_create_rate_window_seconds)
    since = utc_now_naive() - window
    count, oldest = (
        db.query(func.count(EvalExperiment.id), func.min(EvalExperiment.created_at))
        .filter(
            EvalExperiment.created_by_user_id == principal.user.id,
            EvalExperiment.created_at >= since,
        )
        .one()
    )
    if count < limit:
        return
    retry_after = 1
    if oldest is not None:
        retry_after = max(1, int((oldest + window - utc_now_naive()).total_seconds()))
    raise HTTPException(
        status_code=429,
        detail=(
            f"Experiment launch limit reached ({limit} per "
            f"{settings.eval_experiment_create_rate_window_seconds}s); "
            "try again later"
        ),
        headers={"Retry-After": str(retry_after)},
    )


def _load_environments(
    db: Session, project_id: str, environment_ids: List[str]
) -> List[EvalEnvironment]:
    ordered = list(dict.fromkeys(environment_ids))
    rows = {
        env.id: env
        for env in db.query(EvalEnvironment).filter(
            EvalEnvironment.project_id == project_id,
            EvalEnvironment.id.in_(ordered),
        )
    }
    missing = [eid for eid in ordered if eid not in rows]
    if missing:
        raise HTTPException(
            status_code=404, detail=f"Environment not found: {', '.join(missing)}"
        )
    envs = [rows[eid] for eid in ordered]
    disabled = [env.name for env in envs if not env.is_active]
    if disabled:
        raise HTTPException(
            status_code=409,
            detail=f"Environment is disabled: {', '.join(disabled)}",
        )
    return envs


def _resolve_priority(
    db: Session,
    principal: Principal,
    project_id: str,
    envs: List[EvalEnvironment],
    requested: Optional[EvalPriority],
) -> EvalPriority:
    priority = requested or min(
        (env.default_priority for env in envs), key=_PRIORITY_ORDER.__getitem__
    )
    over = [
        env.name
        for env in envs
        if _PRIORITY_ORDER[priority] > _PRIORITY_ORDER[env.max_priority]
    ]
    if over:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Priority {priority.value} exceeds the maximum allowed on: "
                f"{', '.join(over)}"
            ),
        )
    if priority == EvalPriority.HIGH and not is_project_manager(
        db, principal, project_id
    ):
        raise HTTPException(
            status_code=403, detail="HIGH priority requires a project manager"
        )
    return priority


def _binding_error(slot_key: str, code: str, message: str) -> Dict[str, Any]:
    pointer = "/slot_bindings/" + escape_pointer_segment(slot_key)
    return {
        "section": "slot_bindings",
        "pointer": pointer,
        "form_pointer": pointer,
        "field": None,
        "params": {},
        "rule": "binding",
        "code": code,
        "message": message,
        "slot_key": slot_key,
        "environment_id": None,
    }


def _document_errors(spec: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Checks that don't depend on an environment."""
    errors: List[Dict[str, Any]] = []
    if spec.get("links"):
        errors.append(
            {
                "section": "document",
                "pointer": "/links",
                "form_pointer": "/links",
                "field": None,
                "params": {},
                "rule": "sweep",
                "message": "Sweeps and linked groups are not supported yet",
                "environment_id": None,
            }
        )
    bindings = spec.get("slot_bindings")
    if isinstance(bindings, Mapping):
        for slot_key, binding in bindings.items():
            if binding_kind(binding) == "temporary":
                # Hook for #12: temporary keys need experiment secret storage.
                errors.append(
                    _binding_error(
                        str(slot_key),
                        "temporary_unsupported",
                        "Temporary models are not supported yet; bind a project "
                        "model instead",
                    )
                )
    return errors


def _base_source(req: ExperimentCreateRequest) -> Dict[str, Any]:
    raw: Any = req.base_source
    if raw is None:
        raw = req.spec.get("base_source")
    source: Dict[str, Any] = (
        dict(raw) if isinstance(raw, Mapping) and raw else {"kind": "blank"}
    )
    if source.get("kind") not in _BASE_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"base_source.kind must be one of {sorted(_BASE_KINDS)}",
        )
    return strip_secret_refs(source)


def _stored_bindings(
    bindings: Any, models: Mapping[str, Mapping[str, Any]]
) -> Dict[str, Any]:
    """Bindings with display names: ``{connection_id, name, model}`` or ``null``."""
    out: Dict[str, Any] = {}
    if not isinstance(bindings, Mapping):
        return out
    for slot_key, binding in bindings.items():
        kind = binding_kind(binding)
        if kind == "inherit":
            out[slot_key] = None
        elif kind == "connection":
            resolved = models.get(slot_key) or {}
            out[slot_key] = {
                "connection_id": binding.get("connection_id"),
                "name": resolved.get("name") or binding.get("name"),
                "model": resolved.get("model") or binding.get("model"),
            }
        else:
            out[slot_key] = strip_secret_refs(binding)
    return out


def _run_name(name: str, env: EvalEnvironment, multi_env: bool) -> str:
    run_name = f"{name} · {env.name}" if multi_env else name
    return run_name[:_RUN_NAME_MAX]


def _environment_plan(
    db: Session,
    env: EvalEnvironment,
    spec: Mapping[str, Any],
) -> Tuple[Optional[EvalEnvironmentSchema], Dict[str, Any]]:
    """Validate the document on one environment (placeholders; nothing decrypted)."""
    schema = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if env.current_schema_id
        else None
    )
    if schema is None:
        error: Dict[str, Any] = {
            "section": "document",
            "pointer": "",
            "form_pointer": "",
            "field": None,
            "params": {},
            "rule": "schema",
            "message": f'Environment "{env.name}" has no schema yet; refresh it first',
        }
        return None, {"errors": [error], "warnings": [], "body": None, "models": {}}
    descriptor = descriptor_for_schema(schema)
    slots = [
        slot
        for slot in list_model_slots(db, schema.id)
        if slot.status == EvalModelSlotStatus.CONFIRMED
    ]
    result = validate_config_document(
        spec,
        env_schema=schema.schema_json or {},
        slots=slots,
        descriptor=descriptor,
        schema_hash=schema.schema_hash,
    )
    resolution = resolve_slot_bindings(
        db,
        env,
        spec.get("slot_bindings"),
        slots,
        descriptor=descriptor,
        decrypt=False,
    )
    return schema, {
        "errors": result.errors + resolution.to_errors(),
        "warnings": result.warnings,
        "body": result.body,
        "models": resolution.models,
    }


def _request_body(
    body: Mapping[str, Any],
    *,
    experiment_id: str,
    job_id: str,
    env: EvalEnvironment,
    combo_index: int,
    attempt: int,
    user_id: str,
    priority: EvalPriority,
    run_name: str,
    qym_config: Mapping[str, Any],
    retry_of_job_id: Optional[str] = None,
) -> Dict[str, Any]:
    out = copy.deepcopy(dict(body))
    out["user_id"] = user_id
    out["priority"] = priority.value
    evaluator = out.setdefault("evaluator", {})
    config = evaluator.setdefault("config", {})
    config["run_name"] = run_name
    config["live_mode"] = "platform"
    metadata = config.setdefault("run_metadata", {})
    launch: Dict[str, Any] = {
        "experiment_id": experiment_id,
        "job_id": job_id,
        "environment_id": env.id,
        "combo_index": combo_index,
        "attempt": attempt,
    }
    if retry_of_job_id:
        launch["retry_of_job_id"] = retry_of_job_id
    metadata["qym_launch"] = launch
    metadata["qym_config"] = strip_secret_refs(qym_config)
    return out


def _qym_config(
    spec: Mapping[str, Any],
    schema: EvalEnvironmentSchema,
    base_source: Mapping[str, Any],
    bindings: Mapping[str, Any],
) -> Dict[str, Any]:
    return {
        "schema_hash": schema.schema_hash,
        "base_source": copy.deepcopy(dict(base_source)),
        "evaluator": copy.deepcopy(spec.get("evaluator") or {}),
        "slot_bindings": copy.deepcopy(dict(bindings)),
        "env_overrides": copy.deepcopy(spec.get("env_overrides") or {}),
    }


def _job_run_name(job: EvalExperimentJob) -> Optional[str]:
    body = job.request_body if isinstance(job.request_body, Mapping) else {}
    config = (body.get("evaluator") or {}).get("config") or {}
    name = config.get("run_name")
    return name if isinstance(name, str) else None


def _run_summary(run: Optional[Run]) -> Optional[Dict[str, Any]]:
    if run is None:
        return None
    return {
        "id": run.id,
        "status": run.status.value if run.status else None,
        "status_reason": run.status_reason,
        "task": run.task,
        "dataset": run.dataset,
        "model": run.model,
        "origin": run.origin.value if run.origin else None,
        "created_at": to_api_timestamp(run.created_at),
        "started_at": to_api_timestamp(run.started_at),
        "ended_at": to_api_timestamp(run.ended_at),
        "deleted": run.deleted_at is not None,
    }


def _serialize_job(
    job: EvalExperimentJob,
    *,
    env_names: Mapping[str, str],
    runs: Mapping[str, Run],
    superseded: set,
) -> Dict[str, Any]:
    return {
        "id": job.id,
        "experiment_id": job.experiment_id,
        "environment_id": job.environment_id,
        "environment_name": env_names.get(job.environment_id),
        "combo_index": job.combo_index,
        "attempt": job.attempt,
        "retry_of_job_id": job.retry_of_job_id,
        "superseded": job.id in superseded,
        "run_name": _job_run_name(job),
        "params": strip_secret_refs(job.params or {}),
        "schema_id": job.schema_id,
        "status": job.status.value,
        "remote_job_id": job.remote_job_id,
        "remote_status": job.remote_status,
        "remote_result": job.remote_result,
        "remote_versioning": job.remote_versioning,
        "error": job.error,
        "wait_reason": job.wait_reason,
        "submit_attempts": job.submit_attempts,
        "next_attempt_at": to_api_timestamp(job.next_attempt_at),
        "submitted_at": to_api_timestamp(job.submitted_at),
        "finished_at": to_api_timestamp(job.finished_at),
        "cancel_requested_at": to_api_timestamp(job.cancel_requested_at),
        "cancelled_by_user_id": job.cancelled_by_user_id,
        "cancel_reason": job.cancel_reason,
        "created_at": to_api_timestamp(job.created_at),
        "updated_at": to_api_timestamp(job.updated_at),
        "run_id": job.run_id,
        "run": _run_summary(runs.get(job.run_id)) if job.run_id else None,
    }


def _serialize_experiment(
    experiment: EvalExperiment,
    *,
    creator_email: Optional[str],
    job_counts: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    # Never includes secrets_encrypted.
    return {
        "id": experiment.id,
        "project_id": experiment.project_id,
        "name": experiment.name,
        "description": experiment.description,
        "environment_ids": list(experiment.environment_ids or []),
        "base_source": strip_secret_refs(experiment.base_source or {}),
        "spec": strip_secret_refs(experiment.spec or {}),
        "priority": experiment.priority.value,
        "preemption_acknowledged_at": to_api_timestamp(
            experiment.preemption_acknowledged_at
        ),
        "status": experiment.status.value,
        "job_count": experiment.job_count,
        "job_counts": job_counts or {},
        "created_by_user_id": experiment.created_by_user_id,
        "created_by_email": creator_email,
        "created_at": to_api_timestamp(experiment.created_at),
        "updated_at": to_api_timestamp(experiment.updated_at),
        "cancelled_at": to_api_timestamp(experiment.cancelled_at),
        "cancelled_by_user_id": experiment.cancelled_by_user_id,
    }


def _user_emails(db: Session, user_ids: List[Optional[str]]) -> Dict[str, str]:
    ids = sorted({uid for uid in user_ids if uid})
    if not ids:
        return {}
    return {u.id: u.email for u in db.query(User).filter(User.id.in_(ids))}


def _status_counts(jobs: List[EvalExperimentJob]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for job in current_jobs(jobs):
        counts[job.status.value] = counts.get(job.status.value, 0) + 1
    return counts


def _experiment_detail(db: Session, experiment: EvalExperiment) -> Dict[str, Any]:
    jobs = (
        db.query(EvalExperimentJob)
        .filter(EvalExperimentJob.experiment_id == experiment.id)
        .order_by(
            EvalExperimentJob.combo_index,
            EvalExperimentJob.environment_id,
            EvalExperimentJob.attempt,
        )
        .all()
    )
    env_ids = sorted(
        {j.environment_id for j in jobs} | set(experiment.environment_ids or [])
    )
    envs = (
        db.query(EvalEnvironment).filter(EvalEnvironment.id.in_(env_ids)).all()
        if env_ids
        else []
    )
    env_names = {env.id: env.name for env in envs}
    run_ids = [j.run_id for j in jobs if j.run_id]
    runs = (
        {r.id: r for r in db.query(Run).filter(Run.id.in_(run_ids))} if run_ids else {}
    )
    superseded = superseded_job_ids(jobs)
    emails = _user_emails(db, [experiment.created_by_user_id])
    payload = _serialize_experiment(
        experiment,
        creator_email=emails.get(experiment.created_by_user_id or ""),
        job_counts=_status_counts(jobs),
    )
    payload["environments"] = [
        {"id": env.id, "name": env.name, "is_active": env.is_active}
        for env in sorted(envs, key=lambda e: env_ids.index(e.id))
    ]
    payload["jobs"] = [
        _serialize_job(j, env_names=env_names, runs=runs, superseded=superseded)
        for j in jobs
    ]
    return payload


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@router.post(_PREFIX)
def create_experiment(
    project_id: str,
    req: ExperimentCreateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    if not req.dry_run:
        _check_rate_limit(db, principal)
        if not encryption_available():
            raise HTTPException(
                status_code=400,
                detail=(
                    "Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY to be "
                    "configured"
                ),
            )
    envs = _load_environments(db, project_id, req.environment_ids)
    priority = _resolve_priority(db, principal, project_id, envs, req.priority)
    base_source = _base_source(req)
    spec = {k: v for k, v in req.spec.items() if k != "base_source"}

    errors = _document_errors(spec)
    experiment_id = str(uuid4())
    multi_env = len(envs) > 1
    planned = []
    for env in envs:
        schema, plan = _environment_plan(db, env, spec)
        for item in plan["errors"]:
            errors.append({**item, "environment_id": env.id})
        bindings = _stored_bindings(spec.get("slot_bindings"), plan["models"])
        planned.append((env, schema, plan, bindings))

    preview = []
    for env, schema, plan, bindings in planned:
        preview.append(
            {
                "environment_id": env.id,
                "environment_name": env.name,
                "combo_index": 0,
                "run_name": _run_name(req.name, env, multi_env),
                "params": {"slot_bindings": bindings},
                "errors": [e for e in errors if e.get("environment_id") == env.id],
                "warnings": [{**w, "environment_id": env.id} for w in plan["warnings"]],
                "request_body": plan["body"],
            }
        )

    if req.dry_run:
        return {
            "dry_run": True,
            "ok": not errors,
            "job_count": len(envs),
            "priority": priority.value,
            "errors": errors,
            "jobs": preview,
        }
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "The configuration is not valid",
                "errors": errors,
                "jobs": preview,
            },
        )

    now = utc_now_naive()
    stored_spec = copy.deepcopy(spec)
    primary_bindings = planned[0][3]
    if isinstance(stored_spec.get("slot_bindings"), Mapping):
        # Keep names next to connection ids, so "Model X no longer exists" can name it.
        stored_spec["slot_bindings"] = {
            key: (
                primary_bindings.get(key)
                if binding_kind(value) == "connection"
                else value
            )
            for key, value in stored_spec["slot_bindings"].items()
        }
    experiment = EvalExperiment(
        id=experiment_id,
        project_id=project_id,
        created_by_user_id=principal.user.id,
        name=req.name,
        description=req.description,
        environment_ids=[env.id for env in envs],
        base_source=base_source,
        spec=strip_secret_refs(stored_spec),
        secrets_encrypted=None,
        priority=priority,
        preemption_acknowledged_at=(
            now
            if priority == EvalPriority.HIGH and req.acknowledge_preemption
            else None
        ),
        status=EvalExperimentStatus.QUEUED,
        job_count=len(envs),
        created_at=now,
        updated_at=now,
    )
    db.add(experiment)
    db.flush()
    for env, schema, plan, bindings in planned:
        assert schema is not None and plan["body"] is not None
        job_id = str(uuid4())
        run_name = _run_name(req.name, env, multi_env)
        db.add(
            EvalExperimentJob(
                id=job_id,
                experiment_id=experiment_id,
                environment_id=env.id,
                combo_index=0,
                attempt=0,
                params={"slot_bindings": bindings},
                request_body=_request_body(
                    plan["body"],
                    experiment_id=experiment_id,
                    job_id=job_id,
                    env=env,
                    combo_index=0,
                    attempt=0,
                    user_id=principal.user.id,
                    priority=priority,
                    run_name=run_name,
                    qym_config=_qym_config(spec, schema, base_source, bindings),
                ),
                schema_id=schema.id,
                launch_token_hash=launch_token_hash_for_job(job_id),
                status=EvalJobStatus.QUEUED,
                next_attempt_at=now,
                created_at=now,
                updated_at=now,
            )
        )
    _audit(
        db,
        principal,
        "eval_experiment.created",
        "eval_experiment",
        experiment_id,
        {
            "name": req.name,
            "environment_ids": [env.id for env in envs],
            "priority": priority.value,
            "job_count": len(envs),
        },
    )
    db.commit()
    db.refresh(experiment)
    return _experiment_detail(db, experiment)


@router.get(_PREFIX)
def list_experiments(
    project_id: str,
    status: Optional[EvalExperimentStatus] = Query(None),
    environment_id: Optional[str] = Query(None, max_length=36),
    created_by: Optional[str] = Query(None, max_length=36),
    mine: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    query = db.query(EvalExperiment).filter(EvalExperiment.project_id == project_id)
    if status is not None:
        query = query.filter(EvalExperiment.status == status)
    if mine:
        query = query.filter(EvalExperiment.created_by_user_id == principal.user.id)
    elif created_by:
        query = query.filter(EvalExperiment.created_by_user_id == created_by)
    if environment_id:
        query = query.filter(
            db.query(EvalExperimentJob.id)
            .filter(
                EvalExperimentJob.experiment_id == EvalExperiment.id,
                EvalExperimentJob.environment_id == environment_id,
            )
            .exists()
        )
    total = query.count()
    experiments = (
        query.order_by(EvalExperiment.created_at.desc(), EvalExperiment.id)
        .offset(offset)
        .limit(limit)
        .all()
    )
    jobs_by_experiment: Dict[str, List[EvalExperimentJob]] = {}
    if experiments:
        for job in db.query(EvalExperimentJob).filter(
            EvalExperimentJob.experiment_id.in_([x.id for x in experiments])
        ):
            jobs_by_experiment.setdefault(job.experiment_id, []).append(job)
    emails = _user_emails(db, [x.created_by_user_id for x in experiments])
    return {
        "experiments": [
            _serialize_experiment(
                x,
                creator_email=emails.get(x.created_by_user_id or ""),
                job_counts=_status_counts(jobs_by_experiment.get(x.id, [])),
            )
            for x in experiments
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get(_PREFIX + "/{experiment_id}")
def get_experiment(
    project_id: str,
    experiment_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    return _experiment_detail(db, _get_experiment(db, project_id, experiment_id))


def _cancel(
    db: Session,
    principal: Principal,
    experiment: EvalExperiment,
    jobs: List[EvalExperimentJob],
    reason: Optional[str],
) -> Dict[str, str]:
    outcomes: Dict[str, str] = {}
    for job in jobs:
        outcome = cancel_job(db, job, user_id=principal.user.id, reason=reason)
        outcomes[job.id] = outcome
        if outcome != ALREADY_TERMINAL:
            _audit(
                db,
                principal,
                "eval_job.cancel",
                "eval_experiment_job",
                job.id,
                {"outcome": outcome, "reason": reason},
            )
    recompute_experiment_status(db, experiment)
    return outcomes


@router.post(_PREFIX + "/{experiment_id}/cancel")
def cancel_experiment(
    project_id: str,
    experiment_id: str,
    req: Optional[CancelRequest] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    experiment = _get_experiment(db, project_id, experiment_id)
    _require_control(db, principal, experiment)
    reason = req.reason if req else None
    jobs = (
        db.query(EvalExperimentJob)
        .filter(
            EvalExperimentJob.experiment_id == experiment.id,
            EvalExperimentJob.status.notin_(list(TERMINAL_JOB_STATUSES)),
        )
        .all()
    )
    outcomes = _cancel(db, principal, experiment, jobs, reason)
    if any(o != ALREADY_TERMINAL for o in outcomes.values()):
        experiment.cancelled_at = utc_now_naive()
        experiment.cancelled_by_user_id = principal.user.id
    db.commit()
    db.refresh(experiment)
    return {"outcomes": outcomes, "experiment": _experiment_detail(db, experiment)}


@router.post(_PREFIX + "/{experiment_id}/jobs/{job_id}/cancel")
def cancel_experiment_job(
    project_id: str,
    experiment_id: str,
    job_id: str,
    req: Optional[CancelRequest] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    experiment = _get_experiment(db, project_id, experiment_id)
    job = _get_job(db, experiment, job_id)
    _require_control(db, principal, experiment)
    outcomes = _cancel(db, principal, experiment, [job], req.reason if req else None)
    db.commit()
    db.refresh(experiment)
    return {
        "outcome": outcomes[job.id],
        "experiment": _experiment_detail(db, experiment),
    }


@router.post(_PREFIX + "/{experiment_id}/jobs/{job_id}/retry")
def retry_experiment_job(
    project_id: str,
    experiment_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Clone a failed/cancelled/timed-out/blocked job into a new attempt (plan §13)."""
    _require_project_access(db, principal, project_id)
    experiment = _get_experiment(db, project_id, experiment_id)
    job = _get_job(db, experiment, job_id)
    _require_control(db, principal, experiment)
    if not encryption_available():
        raise HTTPException(
            status_code=400,
            detail="Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY to be configured",
        )
    newer = (
        db.query(EvalExperimentJob.id)
        .filter(EvalExperimentJob.retry_of_job_id == job.id)
        .first()
    )
    if newer is not None:
        raise HTTPException(
            status_code=409,
            detail=f"This job was already retried as {newer[0]}; retry that one",
        )
    if job.status not in RETRYABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"A {job.status.value} job cannot be retried",
        )
    env = db.get(EvalEnvironment, job.environment_id)
    if env is None or env.project_id != project_id or not env.is_active:
        raise HTTPException(
            status_code=409, detail="The job's environment is disabled or missing"
        )
    if job.status == EvalJobStatus.BLOCKED:
        # The blocked attempt is replaced: cancel it locally first.
        if (
            cancel_job(db, job, user_id=principal.user.id, reason="Retried")
            != CANCELLED
        ):
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="The job is being dispatched right now; try again shortly",
            )

    now = utc_now_naive()
    new_id = str(uuid4())
    attempt = job.attempt + 1
    body = copy.deepcopy(job.request_body or {})
    config = body.setdefault("evaluator", {}).setdefault("config", {})
    metadata = config.setdefault("run_metadata", {})
    launch = dict(metadata.get("qym_launch") or {})
    launch.pop("token", None)
    launch.update(
        {
            "experiment_id": experiment.id,
            "job_id": new_id,
            "environment_id": job.environment_id,
            "combo_index": job.combo_index,
            "attempt": attempt,
            "retry_of_job_id": job.id,
        }
    )
    metadata["qym_launch"] = launch
    retry = EvalExperimentJob(
        id=new_id,
        experiment_id=experiment.id,
        environment_id=job.environment_id,
        combo_index=job.combo_index,
        attempt=attempt,
        retry_of_job_id=job.id,
        params=copy.deepcopy(job.params or {}),
        request_body=body,
        schema_id=job.schema_id,
        launch_token_hash=launch_token_hash_for_job(new_id),
        status=EvalJobStatus.QUEUED,
        next_attempt_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(retry)
    try:
        db.flush()
    except IntegrityError:
        # A concurrent retry took this attempt number (unique per combination).
        db.rollback()
        raise HTTPException(status_code=409, detail="This job was already retried")
    recompute_experiment_status(db, experiment)
    _audit(
        db,
        principal,
        "eval_job.retry",
        "eval_experiment_job",
        new_id,
        {"retry_of_job_id": job.id, "attempt": attempt},
    )
    db.commit()
    db.refresh(experiment)
    return {"job_id": new_id, "experiment": _experiment_detail(db, experiment)}


@router.post(_PREFIX + "/{experiment_id}/clone")
def clone_experiment(
    project_id: str,
    experiment_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """A launch-form prefill from an experiment. Nothing is persisted.

    Never carries ``secrets_encrypted`` or a secret ref: temporary models keep their
    label, model and base URL, and the key must be entered again (§7.5).
    """
    _require_project_access(db, principal, project_id)
    experiment = _get_experiment(db, project_id, experiment_id)
    active = {
        env.id
        for env in db.query(EvalEnvironment).filter(
            EvalEnvironment.project_id == project_id,
            EvalEnvironment.id.in_(list(experiment.environment_ids or [])),
            EvalEnvironment.is_active.is_(True),
        )
    }
    environment_ids = [e for e in experiment.environment_ids or [] if e in active]
    return {
        "name": f"{experiment.name} (copy)"[:200],
        "description": experiment.description,
        "environment_ids": environment_ids,
        "unavailable_environment_ids": [
            e for e in experiment.environment_ids or [] if e not in active
        ],
        "base_source": {"kind": "clone", "experiment_id": experiment.id},
        "cloned_base_source": strip_secret_refs(experiment.base_source or {}),
        "priority": experiment.priority.value,
        "spec": strip_secret_refs(experiment.spec or {}),
    }
