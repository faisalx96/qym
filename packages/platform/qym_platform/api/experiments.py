"""Evaluation Service experiments: launch, list, detail, cancel, retry and clone.

Routes live under ``/v1/projects/{project_id}/experiments`` (plan §14).
``GET .../experiments/evaluator-config`` serves the static ``EvaluatorRequestConfig``
descriptor for the launch form's Advanced panel (§8.4, D5; ``eval_config``).

- Members may create (``dry_run`` previews without persisting), list, read and clone.
  ``HIGH`` priority needs a project manager and ``acknowledge_preemption: true``
  (stored as ``preemption_acknowledged_at``); every environment's ``max_priority`` caps
  the requested priority (plan §5.3). A dry run reports the warning instead of
  requiring the acknowledgement. Retrying a ``HIGH`` job re-checks all three.
- Cancel and retry are for the experiment's creator or a project manager.
- Creation is rate-limited per user: ``QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT``
  launches (default 30, ``0`` disables) per
  ``QYM_EVAL_EXPERIMENT_CREATE_RATE_WINDOW_SECONDS`` (default 3600). The count comes
  from ``eval_experiments`` rows, so it holds across API processes. Dry runs are not
  counted.

``base_source`` (#31, plan §8.2/§9.2) records where the form started. ``official`` and
``saved`` must name a version (``preset_version_id``) of that kind of preset belonging
to one of the selected environments; ``clone`` an experiment (and optional
``job_id``) of this project. Both are stored canonically. "Run official defaults" is
a plain create with ``base_source: {kind: official, preset_version_id}`` and the
version's config re-mapped onto the environment's current schema.

Sweeps (#32): ``eval_sweeps.expand`` turns the spec (``{"sweep": [...]}`` values and
``links``) into combinations; each (combination, environment) becomes one job with the
combination's ``combo_index``, run name, ``params`` and ``qym_config``. The job count is
capped by ``QYM_EVAL_SWEEP_MAX_JOBS`` (default 64) before anything is validated or
created. Every (combination, environment) document is validated with placeholders only
(``eval_config``), and bindings are checked without decrypting anything
(``eval_bindings``, ``decrypt=False``). Keys are resolved by the dispatcher.

Multi-environment launches (§6, #33): one spec applies to every selected environment
(there are no per-environment overrides). A field the spec sets that environment B's
schema does not declare is a ``not_in_environment`` error for B only, carrying
``environment_id``/``environment_name``; the dry run lists it and a real launch
answers 422 before any row is written. The user resets the field or deselects B.

Temporary models (§7.5, #12, ``services/eval_temporary_models``): a binding
``{"temporary": {"label", "model", "base_url", "api_key": {"$secret": ref}}}`` with the
raw key in the request's ``secrets: {ref: key}``. Keys are Fernet-encrypted into
``secrets_encrypted`` (JSON ``{ref: key}``), never returned, and cleared once every
current job has settled; a retry after that needs ``temporary_keys: {slot_key: key}``
(422 ``temporary_key_required`` otherwise). ``save_to_project_models: [slot_key]``
(project managers) turns those temporary models into project connections instead.
Clone never copies keys.

Stored per job:

- ``params``: ``{"slot_bindings": {slot_key: binding | null}}`` for the combination,
  plus ``"sweep": {pointer: value}`` when the spec sweeps. Connection bindings are
  ``{"connection_id", "name", "model"}``; temporary bindings keep their key ref (the
  dispatcher resolves it), which responses strip.
- ``request_body``: the placeholder ``EvalJobCreate`` with ``user_id`` (creator),
  ``priority``, ``evaluator.config.run_name``/``live_mode`` and the reserved
  ``run_metadata.qym_launch`` (no token) and ``qym_config`` (§10.1), both built by
  ``eval_experiments.build_qym_launch``/``build_qym_config``. ``qym_config`` shows
  secret refs as ``{"$secret": "redacted"}``. The dispatcher adds the token with
  ``eval_experiments.body_with_launch_token``.
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
    EvalConfigPreset,
    EvalConfigPresetKind,
    EvalConfigPresetVersion,
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
from qym_platform.services import eval_sweeps
from qym_platform.services.eval_bindings import resolve_slot_bindings
from qym_platform.services.eval_config import (
    binding_kind,
    evaluator_inputs_panel,
    is_sweep,
    validate_config_document,
)
from qym_platform.services.eval_experiments import (
    ALREADY_TERMINAL,
    CANCELLED,
    RETRYABLE_STATUSES,
    TERMINAL_JOB_STATUSES,
    build_qym_config,
    build_qym_launch,
    can_control_experiment,
    cancel_job,
    cancel_jobs,
    current_jobs,
    launch_token_hash_for_job,
    recompute_experiment_status,
    redact_secret_refs,
    superseded_job_ids,
)
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)
from qym_platform.services.eval_priority import (
    PREEMPTION_ACK_REQUIRED,
    high_priority_warning,
)
from qym_platform.services.eval_run_scores import (
    run_metric_summaries as _run_metrics,
)
from qym_platform.services.eval_temporary_models import (
    TemporaryModelError,
    decrypt_secrets,
    encrypt_secrets,
    missing_retry_keys,
    referenced_secrets,
    retry_secrets,
    save_as_connection,
    stored_binding as stored_temporary_binding,
    temporary_binding_errors,
)
from qym_platform.settings import PlatformSettings
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

router = APIRouter()

_PREFIX = "/v1/projects/{project_id}/experiments"
_PRIORITY_ORDER = {EvalPriority.LOW: 0, EvalPriority.NORMAL: 1, EvalPriority.HIGH: 2}
_BASE_KINDS = {"official", "saved", "best_run", "blank", "clone"}
_MAX_ENVIRONMENTS = 20


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #


class ExperimentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    environment_ids: List[str] = Field(..., min_length=1, max_length=_MAX_ENVIRONMENTS)
    # The §8.1 config document; values may be {"sweep": [...]}, plus "links".
    spec: Dict[str, Any]
    base_source: Optional[Dict[str, Any]] = None
    priority: Optional[EvalPriority] = None
    acknowledge_preemption: bool = False
    dry_run: bool = False
    # Temporary-model keys ``{ref: key}`` for ``{"$secret": ref}`` in the spec (#12).
    # ``Any`` so a malformed value is reported by us, never echoed by validation.
    secrets: Dict[str, Any] = Field(default_factory=dict, repr=False)
    # Slot keys whose temporary model is saved as a project connection (#12).
    save_to_project_models: List[str] = Field(default_factory=list, max_length=50)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class CancelRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=1000)


class RetryRequest(BaseModel):
    # Required (true) when the retried job runs at HIGH (plan §5.3).
    acknowledge_preemption: bool = False
    # Re-entered temporary-model keys ``{slot_key: key}`` once they were cleared.
    temporary_keys: Dict[str, Any] = Field(default_factory=dict, repr=False)


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
    if can_control_experiment(db, principal, experiment):
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


def _require_preemption_ack(
    priority: EvalPriority, envs: List[EvalEnvironment], acknowledged: bool
) -> None:
    """HIGH preempts every LOW/NORMAL job on the env for all users: make it explicit."""
    if priority == EvalPriority.HIGH and not acknowledged:
        raise HTTPException(
            status_code=422,
            detail={
                "code": PREEMPTION_ACK_REQUIRED,
                "message": high_priority_warning(env.name for env in envs)
                + " Send acknowledge_preemption: true to launch.",
            },
        )


def _document_errors(
    spec: Mapping[str, Any], secrets: Mapping[str, Any]
) -> List[Dict[str, Any]]:
    """Checks that don't depend on an environment."""
    errors: List[Dict[str, Any]] = []
    errors += temporary_binding_errors(spec, secrets, _settings())
    return errors


def _save_to_project_models(
    db: Session,
    principal: Principal,
    project_id: str,
    req: ExperimentCreateRequest,
    spec: Dict[str, Any],
) -> List[str]:
    """Save to project models (§7.5): swap temporary bindings for new connections.

    Project managers only. A dry run checks without creating anything. Returns the new
    connection ids; nothing is committed here.
    """
    slot_keys = list(dict.fromkeys(req.save_to_project_models))
    if not slot_keys:
        return []
    if not is_project_manager(db, principal, project_id):
        raise HTTPException(
            status_code=403,
            detail="Saving to project models requires a project manager",
        )
    bindings = spec.get("slot_bindings")
    bindings = dict(bindings) if isinstance(bindings, Mapping) else {}
    created: List[str] = []
    for slot_key in slot_keys:
        binding = bindings.get(slot_key)
        if binding_kind(binding) != "temporary" or not isinstance(
            binding.get("temporary"), Mapping
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Slot {slot_key!r} is not bound to a temporary model",
            )
        temporary = binding["temporary"]
        ref = (temporary.get("api_key") or {}).get("$secret")
        api_key = req.secrets.get(ref) if isinstance(ref, str) else None
        if req.dry_run:
            continue
        try:
            conn = save_as_connection(
                db,
                project_id=project_id,
                user_id=principal.user.id,
                temporary=temporary,
                api_key=api_key.strip() if isinstance(api_key, str) else None,
            )
        except TemporaryModelError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"message": str(exc), "code": exc.code, "slot_key": slot_key},
            )
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="A project model with that name already exists",
            )
        bindings[slot_key] = {"connection_id": conn.id}
        created.append(conn.id)
    spec["slot_bindings"] = bindings
    return created


def _base_ref(source: Mapping[str, Any], key: str, *, required: bool) -> Optional[str]:
    value = source.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 64:
        raise HTTPException(
            status_code=422,
            detail=f"base_source.{key} is required for a {source.get('kind')} base",
        )
    return value.strip()


def _preset_base_source(
    db: Session, source: Mapping[str, Any], envs: List[EvalEnvironment]
) -> Dict[str, Any]:
    """``official``/``saved``: a version of that kind of preset of a selected env.

    Stored canonically as ``{kind, preset_id, preset_version_id, version,
    environment_id}``. A version that does not exist and one of an environment that
    is not part of the launch get the same answer, so nothing leaks across projects.
    """
    kind = source.get("kind")
    version_id = _base_ref(source, "preset_version_id", required=True)
    row = (
        db.query(EvalConfigPresetVersion, EvalConfigPreset)
        .join(EvalConfigPreset, EvalConfigPreset.id == EvalConfigPresetVersion.preset_id)
        .filter(EvalConfigPresetVersion.id == version_id)
        .first()
    )
    if row is None or row[1].environment_id not in {env.id for env in envs}:
        raise HTTPException(
            status_code=422,
            detail=(
                "base_source.preset_version_id is not a preset version of the "
                "selected environments"
            ),
        )
    version, preset = row
    expected = (
        EvalConfigPresetKind.OFFICIAL if kind == "official" else EvalConfigPresetKind.SAVED
    )
    if preset.kind != expected:
        raise HTTPException(
            status_code=422,
            detail=(
                "base_source.preset_version_id is not a version of the official "
                "defaults"
                if kind == "official"
                else "base_source.preset_version_id is not a saved preset version"
            ),
        )
    return {
        "kind": kind,
        "preset_id": preset.id,
        "preset_version_id": version.id,
        "version": version.version,
        "environment_id": preset.environment_id,
    }


def _clone_base_source(
    db: Session, project_id: str, source: Mapping[str, Any]
) -> Dict[str, Any]:
    """``clone``: an experiment of this project and, optionally, one of its jobs."""
    experiment_id = _base_ref(source, "experiment_id", required=True)
    job_id = _base_ref(source, "job_id", required=False)
    experiment = (
        db.query(EvalExperiment.id)
        .filter(
            EvalExperiment.id == experiment_id,
            EvalExperiment.project_id == project_id,
        )
        .first()
    )
    if experiment is None:
        raise HTTPException(
            status_code=422,
            detail="base_source.experiment_id is not an experiment of this project",
        )
    out: Dict[str, Any] = {"kind": "clone", "experiment_id": experiment_id}
    if job_id is not None:
        job = (
            db.query(EvalExperimentJob.id)
            .filter(
                EvalExperimentJob.id == job_id,
                EvalExperimentJob.experiment_id == experiment_id,
            )
            .first()
        )
        if job is None:
            raise HTTPException(
                status_code=422,
                detail="base_source.job_id is not a job of that experiment",
            )
        out["job_id"] = job_id
    return out


def _base_source(
    db: Session,
    project_id: str,
    req: ExperimentCreateRequest,
    envs: List[EvalEnvironment],
) -> Dict[str, Any]:
    """Validate the launch's ``base_source`` (plan §8.2, §9.2).

    ``official``/``saved`` must name a version of that kind of preset belonging to one
    of the selected environments; ``clone`` an experiment (and job) of this project.
    ``best_run`` is passed through until #38 defines it.
    """
    raw: Any = req.base_source
    if raw is None:
        raw = req.spec.get("base_source")
    source: Dict[str, Any] = (
        dict(raw) if isinstance(raw, Mapping) and raw else {"kind": "blank"}
    )
    kind = source.get("kind")
    if kind not in _BASE_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"base_source.kind must be one of {sorted(_BASE_KINDS)}",
        )
    if kind in ("official", "saved"):
        return _preset_base_source(db, source, envs)
    if kind == "clone":
        return _clone_base_source(db, project_id, source)
    if kind == "blank":
        return {"kind": "blank"}
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
        elif kind == "temporary":
            # Keeps the key ref (never a key) for the dispatcher.
            out[slot_key] = stored_temporary_binding(binding)
        else:
            out[slot_key] = strip_secret_refs(binding)
    return out


def _named_spec_bindings(
    bindings: Mapping[str, Any], named: Mapping[str, Mapping[str, Any]]
) -> Dict[str, Any]:
    """Spec bindings as ``{connection_id, name, model}`` (sweep values too)."""

    def with_name(binding: Any) -> Any:
        if binding_kind(binding) == "connection":
            return named.get(binding.get("connection_id"), binding)
        return binding

    return {
        key: (
            {"sweep": [with_name(b) for b in value["sweep"]]}
            if is_sweep(value) and isinstance(value["sweep"], list)
            else with_name(value)
        )
        for key, value in bindings.items()
    }


def _environment_context(db: Session, env: EvalEnvironment) -> Dict[str, Any]:
    """The environment's schema, descriptor and confirmed slots (loaded once)."""
    schema = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if env.current_schema_id
        else None
    )
    if schema is None:
        return {"schema": None}
    return {
        "schema": schema,
        "descriptor": descriptor_for_schema(schema),
        "slots": [
            slot
            for slot in list_model_slots(db, schema.id)
            if slot.status == EvalModelSlotStatus.CONFIRMED
        ],
    }


def _encrypted_secrets(secrets: Mapping[str, str]) -> Optional[str]:
    try:
        return encrypt_secrets(secrets, _settings())
    except TemporaryModelError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


def _environment_plan(
    db: Session,
    env: EvalEnvironment,
    spec: Mapping[str, Any],
    context: Mapping[str, Any],
) -> Tuple[Optional[EvalEnvironmentSchema], Dict[str, Any]]:
    """Validate one combination on one environment (placeholders; nothing decrypted)."""
    schema = context["schema"]
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
    descriptor = context["descriptor"]
    slots = context["slots"]
    result = validate_config_document(
        spec,
        env_schema=schema.schema_json or {},
        slots=slots,
        descriptor=descriptor,
        schema_hash=schema.schema_hash,
        environment_name=env.name,
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
    metadata["qym_launch"] = build_qym_launch(
        experiment_id=experiment_id,
        job_id=job_id,
        environment_id=env.id,
        combo_index=combo_index,
        attempt=attempt,
        retry_of_job_id=retry_of_job_id,
    )
    metadata["qym_config"] = redact_secret_refs(qym_config)
    return out


def _qym_config(
    spec: Mapping[str, Any],
    schema: EvalEnvironmentSchema,
    base_source: Mapping[str, Any],
    models: Mapping[str, Mapping[str, Any]],
    sweep: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Secret-free §10.1 snapshot of this combination (``eval_experiments``)."""
    return build_qym_config(
        spec,
        schema_hash=schema.schema_hash,
        base_source=base_source,
        models=models,
        sweep=sweep,
    )


def _job_run_name(job: EvalExperimentJob) -> Optional[str]:
    body = job.request_body if isinstance(job.request_body, Mapping) else {}
    config = (body.get("evaluator") or {}).get("config") or {}
    name = config.get("run_name")
    return name if isinstance(name, str) else None


def _job_qym_config(job: EvalExperimentJob) -> Optional[Dict[str, Any]]:
    """The job's ``run_metadata.qym_config`` (§10.1), for "Save as preset".

    Secret refs are stripped like everywhere else in responses, so a temporary model
    shows label/model/base_url only (a preset never keeps its key either).
    """
    body = job.request_body if isinstance(job.request_body, Mapping) else {}
    config = (body.get("evaluator") or {}).get("config") or {}
    metadata = config.get("run_metadata") if isinstance(config, Mapping) else None
    snapshot = metadata.get("qym_config") if isinstance(metadata, Mapping) else None
    if not isinstance(snapshot, Mapping):
        return None
    return strip_secret_refs(redact_secret_refs(snapshot))


def _headline_metric(
    metrics: Optional[Mapping[str, Any]], ranking_metric: Optional[str]
) -> Optional[Dict[str, Any]]:
    """The environment's ranking metric when the run has it, else its first metric."""
    means = (metrics or {}).get("means") or {}
    if not means:
        return None
    name = ranking_metric if ranking_metric in means else next(iter(means))
    return {
        "name": name,
        "mean": means[name],
        "direction": ((metrics or {}).get("directions") or {}).get(name, "maximize"),
    }


def _run_summary(
    run: Optional[Run],
    metrics: Optional[Mapping[str, Any]] = None,
    ranking_metric: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if run is None:
        return None
    return {
        "metric_means": dict((metrics or {}).get("means") or {}),
        "headline_metric": _headline_metric(metrics, ranking_metric),
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
    run_metrics: Optional[Mapping[str, Mapping[str, Any]]] = None,
    ranking_metrics: Optional[Mapping[str, Optional[str]]] = None,
    combo_labels: Optional[Mapping[int, str]] = None,
) -> Dict[str, Any]:
    return {
        "id": job.id,
        "experiment_id": job.experiment_id,
        "environment_id": job.environment_id,
        "environment_name": env_names.get(job.environment_id),
        "combo_index": job.combo_index,
        "combo_label": (combo_labels or {}).get(job.combo_index, ""),
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
        "run": (
            _run_summary(
                runs.get(job.run_id),
                (run_metrics or {}).get(job.run_id),
                (ranking_metrics or {}).get(job.environment_id),
            )
            if job.run_id
            else None
        ),
        "qym_config": _job_qym_config(job),
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
        "temporary_keys_stored": bool(experiment.secrets_encrypted),
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
    """The experiment with every job, as the detail matrix (#35) renders it.

    Besides the stored fields, each job carries ``combo_label`` (the sweep label),
    ``qym_config`` (secret-free, for "Save as preset") and, when linked, the run's
    ``metric_means`` and ``headline_metric`` (the environment's ``ranking_metric``
    when the run has it, otherwise the run's first metric). ``sweep_keys`` maps each
    swept pointer to its short label key.
    """
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
    ranking = {env.id: env.ranking_metric for env in envs}
    payload["ranking_metrics"] = ranking
    # Matrix rows (§12.2): one short label per combination, as in the run names.
    sweeps: Dict[int, Mapping[str, Any]] = {}
    for j in jobs:
        sweep = (j.params or {}).get("sweep") if isinstance(j.params, Mapping) else None
        if isinstance(sweep, Mapping) and j.combo_index not in sweeps:
            sweeps[j.combo_index] = strip_secret_refs(sweep)
    pointers: List[str] = []
    for sweep in sweeps.values():
        pointers += [p for p in sweep if p not in pointers]
    keys = eval_sweeps.label_keys(pointers)
    labels = (
        eval_sweeps.connection_labels(db, experiment.project_id, experiment.spec or {})
        if sweeps
        else {}
    )
    combo_labels = {
        index: eval_sweeps.combo_label(sweep, labels, {p: keys[p] for p in sweep})
        for index, sweep in sweeps.items()
    }
    payload["sweep_keys"] = keys
    run_metrics = _run_metrics(db, runs)
    payload["jobs"] = [
        _serialize_job(
            j,
            env_names=env_names,
            runs=runs,
            superseded=superseded,
            run_metrics=run_metrics,
            ranking_metrics=ranking,
            combo_labels=combo_labels,
        )
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
    base_source = _base_source(db, project_id, req, envs)
    spec = {k: v for k, v in req.spec.items() if k != "base_source"}
    saved_connection_ids = _save_to_project_models(db, principal, project_id, req, spec)

    errors = [
        {**e, "environment_id": None, "combo_index": None}
        for e in _document_errors(spec, req.secrets)
    ]
    sweep = eval_sweeps.expand(
        spec,
        environment_count=len(envs),
        max_jobs=_settings().eval_sweep_max_jobs,
        connection_labels=eval_sweeps.connection_labels(db, project_id, spec),
    )
    errors += [{**e, "environment_id": None, "combo_index": None} for e in sweep.errors]
    if not req.dry_run and any(e["rule"] == "sweep_cap" for e in sweep.errors):
        # Over the cap: refuse before validating or creating anything.
        raise HTTPException(
            status_code=422,
            detail={
                "message": sweep.errors[0]["message"],
                "errors": errors,
                **sweep.summary(),
            },
        )
    experiment_id = str(uuid4())
    multi_env = len(envs) > 1
    contexts = {env.id: _environment_context(db, env) for env in envs}
    planned = []
    for combo in sweep.combos:
        for env in envs:
            schema, plan = _environment_plan(db, env, combo.document, contexts[env.id])
            plan["errors"] = [
                {
                    **item,
                    "environment_id": env.id,
                    "environment_name": env.name,
                    "combo_index": combo.index,
                }
                for item in plan["errors"]
            ]
            errors += plan["errors"]
            bindings = _stored_bindings(
                combo.document.get("slot_bindings"), plan["models"]
            )
            params: Dict[str, Any] = {"slot_bindings": bindings}
            if sweep.swept:
                params["sweep"] = combo.params
            run_name = eval_sweeps.run_name(
                req.name, combo.label, env.name if multi_env else None
            )
            planned.append(
                # params keep temporary key refs (never keys) for the dispatcher.
                (combo, env, schema, plan, params, run_name)
            )

    preview = [
        {
            "environment_id": env.id,
            "environment_name": env.name,
            "combo_index": combo.index,
            "label": combo.label,
            "run_name": run_name,
            "params": strip_secret_refs(params),
            "errors": plan["errors"],
            "warnings": [
                {**w, "environment_id": env.id, "combo_index": combo.index}
                for w in plan["warnings"]
            ],
            "request_body": strip_secret_refs(plan["body"]),
        }
        for combo, env, schema, plan, params, run_name in planned
    ]

    if req.dry_run:
        return {
            "dry_run": True,
            "ok": not errors,
            **sweep.summary(),
            "priority": priority.value,
            "preemption_warning": (
                high_priority_warning(env.name for env in envs)
                if priority == EvalPriority.HIGH
                else None
            ),
            "errors": errors,
            "jobs": preview,
        }
    _require_preemption_ack(priority, envs, req.acknowledge_preemption)
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
    if isinstance(stored_spec.get("slot_bindings"), Mapping):
        # Keep names next to connection ids, so "Model X no longer exists" can name it.
        named = {
            b["connection_id"]: b
            for *_, params, _name in planned
            for b in params["slot_bindings"].values()
            if isinstance(b, Mapping) and b.get("connection_id")
        }
        stored_spec["slot_bindings"] = _named_spec_bindings(
            stored_spec["slot_bindings"], named
        )
    experiment = EvalExperiment(
        id=experiment_id,
        project_id=project_id,
        created_by_user_id=principal.user.id,
        name=req.name,
        description=req.description,
        environment_ids=[env.id for env in envs],
        base_source=base_source,
        spec=strip_secret_refs(stored_spec),
        secrets_encrypted=_encrypted_secrets(referenced_secrets(spec, req.secrets)),
        priority=priority,
        preemption_acknowledged_at=now if priority == EvalPriority.HIGH else None,
        status=EvalExperimentStatus.QUEUED,
        job_count=len(planned),
        created_at=now,
        updated_at=now,
    )
    db.add(experiment)
    db.flush()
    for combo, env, schema, plan, params, run_name in planned:
        assert schema is not None and plan["body"] is not None
        job_id = str(uuid4())
        db.add(
            EvalExperimentJob(
                id=job_id,
                experiment_id=experiment_id,
                environment_id=env.id,
                combo_index=combo.index,
                attempt=0,
                params=params,
                request_body=_request_body(
                    plan["body"],
                    experiment_id=experiment_id,
                    job_id=job_id,
                    env=env,
                    combo_index=combo.index,
                    attempt=0,
                    user_id=principal.user.id,
                    priority=priority,
                    run_name=run_name,
                    qym_config=_qym_config(
                        combo.document,
                        schema,
                        base_source,
                        plan["models"],
                        sweep=params.get("sweep"),
                    ),
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
            "combo_count": sweep.combo_count,
            "job_count": len(planned),
            "saved_connection_ids": saved_connection_ids,
        },
    )
    db.commit()
    db.refresh(experiment)
    return _experiment_detail(db, experiment)


# Registered before ``/{experiment_id}`` so the static path is not captured by it.
@router.get(_PREFIX + "/evaluator-config")
def get_evaluator_config_panel(
    project_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Static ``EvaluatorRequestConfig`` descriptor for the Advanced panel (§8.4, D5)."""
    _require_project_access(db, principal, project_id)
    return evaluator_inputs_panel()


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
    """``cancel_jobs`` for jobs of an experiment the caller already controls."""
    return cancel_jobs(
        db,
        [job.id for job in jobs],
        principal,
        reason,
        project_id=experiment.project_id,
    )


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
    req: Optional[RetryRequest] = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Clone a failed/cancelled/timed-out/blocked job into a new attempt (plan §13).

    A HIGH retry preempts again, so it passes the launch policy again (§5.3).
    Temporary-model keys cleared since launch must be re-entered as
    ``temporary_keys: {slot_key: key}``; otherwise 422 ``temporary_key_required``
    lists the slots that need one.
    """
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
    _resolve_priority(db, principal, project_id, [env], experiment.priority)
    acknowledged = bool(req and req.acknowledge_preemption)
    _require_preemption_ack(experiment.priority, [env], acknowledged)
    secrets, missing = retry_secrets(
        job.params,
        decrypt_secrets(experiment.secrets_encrypted),
        req.temporary_keys if req else {},
    )
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Enter the API key of each temporary model again",
                "code": "temporary_key_required",
                "slots": [item.summary() for item in missing],
            },
        )
    if missing_retry_keys(job.params, {}):
        # The job uses temporary-model keys. Always write a fresh blob (see
        # eval_experiments.clear_secrets_when_settled).
        experiment.secrets_encrypted = _encrypted_secrets(secrets)
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
    metadata["qym_launch"] = build_qym_launch(
        experiment_id=experiment.id,
        job_id=new_id,
        environment_id=job.environment_id,
        combo_index=job.combo_index,
        attempt=attempt,
        retry_of_job_id=job.id,
    )
    if "qym_config" in metadata:
        metadata["qym_config"] = redact_secret_refs(metadata["qym_config"])
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
    if experiment.priority == EvalPriority.HIGH:
        experiment.preemption_acknowledged_at = now
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
        {
            "retry_of_job_id": job.id,
            "attempt": attempt,
            "priority": experiment.priority.value,
        },
    )
    db.commit()
    db.refresh(experiment)
    return {"job_id": new_id, "experiment": _experiment_detail(db, experiment)}


@router.post(_PREFIX + "/{experiment_id}/clone")
def clone_experiment(
    project_id: str,
    experiment_id: str,
    job_id: Optional[str] = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """A launch-form prefill from an experiment. Nothing is persisted.

    With ``job_id`` ("Rerun with this config" on the run page, #26) the prefill is that
    one combination: its secret-free ``qym_config`` document (sweeps resolved) on its
    own environment, instead of the experiment's whole sweep.

    Never carries ``secrets_encrypted`` or a secret ref: temporary models keep their
    label, model and base URL, and the key must be entered again (§7.5).
    """
    _require_project_access(db, principal, project_id)
    experiment = _get_experiment(db, project_id, experiment_id)
    job = _get_job(db, experiment, job_id) if job_id else None
    wanted = [job.environment_id] if job else list(experiment.environment_ids or [])
    active = {
        env.id
        for env in db.query(EvalEnvironment).filter(
            EvalEnvironment.project_id == project_id,
            EvalEnvironment.id.in_(wanted),
            EvalEnvironment.is_active.is_(True),
        )
    }
    prefill: Dict[str, Any] = {
        "name": f"{experiment.name} (copy)"[:200],
        "description": experiment.description,
        "environment_ids": [e for e in wanted if e in active],
        "unavailable_environment_ids": [e for e in wanted if e not in active],
        "base_source": {"kind": "clone", "experiment_id": experiment.id},
        "cloned_base_source": strip_secret_refs(experiment.base_source or {}),
        "priority": experiment.priority.value,
        "spec": strip_secret_refs(experiment.spec or {}),
    }
    if job is None:
        return prefill
    snapshot = _job_qym_config(job) or {}
    spec: Dict[str, Any] = {
        key: snapshot[key]
        for key in ("evaluator", "env_overrides", "slot_bindings")
        if isinstance(snapshot.get(key), Mapping)
    }
    prefill.update(
        {
            "name": f"{experiment.name} (rerun)"[:200],
            "base_source": {
                "kind": "clone",
                "experiment_id": experiment.id,
                "job_id": job.id,
            },
            "cloned_base_source": strip_secret_refs(
                snapshot.get("base_source") or experiment.base_source or {}
            ),
            # Without a stored snapshot (pre-#16 job) fall back to the whole spec.
            "spec": spec if spec else prefill["spec"],
            "combo": {
                "job_id": job.id,
                "combo_index": job.combo_index,
                "environment_id": job.environment_id,
                "schema_hash": snapshot.get("schema_hash"),
                "sweep": strip_secret_refs((job.params or {}).get("sweep") or {}),
                "from_snapshot": bool(spec),
            },
        }
    )
    return prefill
