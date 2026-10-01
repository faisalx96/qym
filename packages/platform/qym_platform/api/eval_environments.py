"""Evaluation Service environments: CRUD, connection test, schema refresh, slots.

Routes live under ``/v1/projects/{project_id}/eval-environments`` (plan §5.1).
Project members may read; project managers (or platform admins) may write, test
and refresh, because those calls send the decrypted environment key outbound.

Security (plan §15): the environment key is Fernet-encrypted and only shown as
``••••last4``; creation is refused without ``QYM_LLM_CONFIG_ENCRYPTION_KEY``;
URLs must be HTTPS unless ``QYM_ALLOW_PRIVATE_LLM_BASE_URLS`` is set; an active
URL belongs to exactly one project.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from qym_platform.api.projects import _require_project_access, _require_project_manager
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db import models as db_models
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalModelSlot,
    EvalModelSlotStatus,
    EvalPriority,
    Project,
)
from qym_platform.deps import get_db
from qym_platform.llm_endpoint_security import (
    LlmEndpointValidationError,
    validate_llm_base_url,
)
from qym_platform.secrets import (
    decrypt_llm_api_key,
    encrypt_llm_api_key,
    encryption_available,
)
from qym_platform.services.eval_bindings import connection_options
from qym_platform.services.eval_model_slots import (
    SlotValidationError,
    confirm_model_slots,
    descriptor_for_schema,
    list_model_slots,
    propose_endpoint_slot,
    slot_to_dict,
    slots_need_confirmation,
    sync_model_slots,
)
from qym_platform.services.eval_schema_form import build_form_descriptor
from qym_platform.services.eval_service_client import (
    REDACTED,
    EnvAuthError,
    EvalServiceClient,
    EvalServiceError,
    RemoteNotFound,
    RequestRejected,
    RetryableError,
    redact_text,
)
from qym_platform.settings import PlatformSettings
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

router = APIRouter()

_PREFIX = "/v1/projects/{project_id}/eval-environments"
_PRIORITY_ORDER = {EvalPriority.LOW: 0, EvalPriority.NORMAL: 1, EvalPriority.HIGH: 2}
_KEEP_KEY = "__KEEP__"
# Keys shorter than this get no last4 hint, so the hint never reveals most of a key.
_MIN_KEY_LENGTH_FOR_HINT = 8
# Tables whose rows keep an environment alive (soft-disable instead of delete).
# Looked up by name so the environment API does not depend on later migrations.
_REFERENCING_MODELS = ("EvalExperimentJob", "EvalExperiment", "EvalConfigPreset")

EvalClientFactory = Callable[[str, str], EvalServiceClient]


def get_eval_client_factory() -> EvalClientFactory:
    """Build clients for an environment; tests override this dependency."""
    allow_private = PlatformSettings().allow_private_llm_base_urls

    def factory(base_url: str, api_key: str) -> EvalServiceClient:
        return EvalServiceClient(base_url, api_key, allow_private=allow_private)

    return factory


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #


class EnvironmentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    base_url: str = Field(..., min_length=1, max_length=500)
    api_key: str = Field(..., min_length=1, max_length=4096)
    default_priority: EvalPriority = EvalPriority.NORMAL
    max_priority: EvalPriority = EvalPriority.NORMAL
    max_inflight_jobs: int = Field(default=5, ge=1, le=1000)
    allow_connection_keys: bool = False
    ranking_metric: Optional[str] = Field(default=None, max_length=200)
    ranking_k: Optional[int] = Field(default=None, ge=1, le=1000)


class EnvironmentUpdateRequest(BaseModel):
    """Omitted fields keep their value. A blank ``api_key`` keeps the stored key."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    base_url: Optional[str] = Field(default=None, min_length=1, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=4096)
    default_priority: Optional[EvalPriority] = None
    max_priority: Optional[EvalPriority] = None
    max_inflight_jobs: Optional[int] = Field(default=None, ge=1, le=1000)
    allow_connection_keys: Optional[bool] = None
    ranking_metric: Optional[str] = Field(default=None, max_length=200)
    ranking_k: Optional[int] = Field(default=None, ge=1, le=1000)
    is_active: Optional[bool] = None


class ModelSlotsUpdateRequest(BaseModel):
    slots: List[Dict[str, Any]]
    # Guards against confirming slots of a schema that was refreshed meanwhile.
    schema_id: Optional[str] = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def normalize_environment_url(value: str, settings: PlatformSettings) -> str:
    """Validate and canonicalize an environment base URL.

    Strips surrounding whitespace, trailing ``/`` and a trailing ``/evals``
    (the client appends it), lower-cases scheme and host, drops default ports and
    rejects query strings. HTTPS is required unless private URLs are allowed.
    The result is what is stored and compared for the one-project-per-URL rule.
    """
    allow_private = settings.allow_private_llm_base_urls
    try:
        validated = validate_llm_base_url(value, allow_private=allow_private)
    except LlmEndpointValidationError as exc:
        raise HTTPException(
            status_code=400, detail=str(exc).replace("LLM base URL", "Base URL")
        )
    parts = urlsplit(validated)
    scheme = parts.scheme.lower()
    if scheme != "https" and not allow_private:
        raise HTTPException(
            status_code=400,
            detail=(
                "Environment URL must use https://. Set "
                "QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true only for trusted local services."
            ),
        )
    if parts.query:
        raise HTTPException(
            status_code=400, detail="Environment URL cannot contain a query string"
        )
    host = (parts.hostname or "").lower()
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    port = parts.port
    if port and not (
        (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
    ):
        host = f"{host}:{port}"
    path = parts.path.rstrip("/")
    while path.lower().endswith("/evals"):
        path = path[: -len("/evals")].rstrip("/")
    return urlunsplit((scheme, host, path, "", ""))


def _schema_hash(schema_json: Any) -> str:
    canonical = json.dumps(
        schema_json, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _key_hint(last4: str) -> str:
    return ("••••" + last4) if last4 else ""


def _store_key(env: EvalEnvironment, api_key: str, settings: PlatformSettings) -> None:
    if not encryption_available(settings):
        raise HTTPException(
            status_code=400,
            detail=(
                "Environment key encryption is not configured "
                "(set QYM_LLM_CONFIG_ENCRYPTION_KEY)"
            ),
        )
    if any(ch.isspace() or not ch.isprintable() for ch in api_key):
        raise HTTPException(
            status_code=400,
            detail="The API key cannot contain whitespace or control characters",
        )
    env.api_key_encrypted = encrypt_llm_api_key(api_key, settings)
    env.api_key_last4 = api_key[-4:] if len(api_key) >= _MIN_KEY_LENGTH_FOR_HINT else ""


def _stored_key(env: EvalEnvironment, settings: PlatformSettings) -> str:
    if not env.api_key_encrypted:
        raise HTTPException(
            status_code=400, detail="No API key configured for this environment"
        )
    try:
        return decrypt_llm_api_key(env.api_key_encrypted, settings)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _safe_message(exc: BaseException, api_key: str) -> str:
    """Redacted, bounded error text; the raw key is scrubbed even if echoed."""
    message = redact_text(str(exc) or type(exc).__name__)
    if api_key:
        message = message.replace(api_key, REDACTED)
    return message[:1000]


def _remote_http_error(exc: Exception, api_key: str) -> HTTPException:
    """Map a client/transport error to the HTTP answer of this API."""
    message = _safe_message(exc, api_key)
    if isinstance(exc, LlmEndpointValidationError):
        return HTTPException(status_code=400, detail=message)
    if isinstance(exc, EnvAuthError):
        return HTTPException(
            status_code=400,
            detail="Evaluation service rejected the environment API key",
        )
    if isinstance(exc, RemoteNotFound):
        return HTTPException(
            status_code=502,
            detail=(
                "Evaluation service endpoint not found; check the base URL "
                "(include EVAL_SERVER_PREFIX, not /evals)"
            ),
        )
    if isinstance(exc, RequestRejected):
        return HTTPException(status_code=502, detail=message)
    if isinstance(exc, RetryableError):
        return HTTPException(status_code=502, detail=message)
    return HTTPException(status_code=502, detail=message)


_REMOTE_ERRORS = (EvalServiceError, LlmEndpointValidationError)


async def _probe(
    factory: EvalClientFactory, base_url: str, api_key: str
) -> Dict[str, Any]:
    """Auth probe (``GET /evals?limit=1``) then fetch the env-overrides schema."""
    client = factory(base_url, api_key)
    try:
        await client.list(limit=1)
        schema = await client.env_overrides_schema()
    finally:
        await client.aclose()
    if not isinstance(schema, dict):
        raise EvalServiceError("Evaluation service returned an invalid schema")
    return schema


def _get_environment(db: Session, project_id: str, env_id: str) -> EvalEnvironment:
    env = (
        db.query(EvalEnvironment)
        .filter(EvalEnvironment.id == env_id, EvalEnvironment.project_id == project_id)
        .first()
    )
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")
    return env


def _current_schema(db: Session, env: EvalEnvironment) -> EvalEnvironmentSchema:
    schema = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if env.current_schema_id
        else None
    )
    if schema is None:
        raise HTTPException(
            status_code=409,
            detail="Environment has no schema yet; refresh its schema first",
        )
    return schema


def _ensure_url_available(
    db: Session, base_url: str, *, project_id: str, exclude_env_id: Optional[str]
) -> None:
    """Refuse a URL that an active environment already uses (plan §4.1)."""
    query = db.query(EvalEnvironment).filter(
        EvalEnvironment.base_url == base_url, EvalEnvironment.is_active.is_(True)
    )
    if exclude_env_id:
        query = query.filter(EvalEnvironment.id != exclude_env_id)
    other = query.first()
    if other is None:
        return
    if other.project_id == project_id:
        raise HTTPException(
            status_code=409,
            detail=f"This environment is already registered in this project as "
            f"'{other.name}'",
        )
    owner = db.get(Project, other.project_id)
    owner_name = owner.name if owner else other.project_id
    raise HTTPException(
        status_code=409,
        detail=f"This environment already belongs to project '{owner_name}'",
    )


def _ensure_name_available(
    db: Session, project_id: str, name: str, *, exclude_env_id: Optional[str]
) -> None:
    query = db.query(EvalEnvironment.id).filter(
        EvalEnvironment.project_id == project_id, EvalEnvironment.name == name
    )
    if exclude_env_id:
        query = query.filter(EvalEnvironment.id != exclude_env_id)
    if query.first() is not None:
        raise HTTPException(
            status_code=409, detail="An environment with that name already exists"
        )


def _check_priorities(env: EvalEnvironment) -> None:
    if _PRIORITY_ORDER[env.default_priority] > _PRIORITY_ORDER[env.max_priority]:
        raise HTTPException(
            status_code=400,
            detail="default_priority cannot be higher than max_priority",
        )


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Lost a race against the name or active-URL unique index.
        raise HTTPException(
            status_code=409,
            detail="An environment with that name or URL already exists",
        )


def _environment_in_use(db: Session, env: EvalEnvironment) -> bool:
    for model_name in _REFERENCING_MODELS:
        model = getattr(db_models, model_name, None)
        column = getattr(model, "environment_id", None) if model is not None else None
        if column is None:
            continue
        if db.query(column).filter(column == env.id).first() is not None:
            return True
    return False


def _store_schema(
    db: Session, env: EvalEnvironment, schema_json: Dict[str, Any]
) -> Tuple[EvalEnvironmentSchema, bool]:
    """Return the schema row for this content, inserting it if new (immutable)."""
    digest = _schema_hash(schema_json)
    now = utc_now_naive()
    row = (
        db.query(EvalEnvironmentSchema)
        .filter(
            EvalEnvironmentSchema.environment_id == env.id,
            EvalEnvironmentSchema.schema_hash == digest,
        )
        .first()
    )
    if row is not None:
        row.fetched_at = now
        return row, False
    row = EvalEnvironmentSchema(
        environment_id=env.id,
        schema_hash=digest,
        schema_json=schema_json,
        form_descriptor=build_form_descriptor(schema_json),
        fetched_at=now,
        first_seen_at=now,
    )
    db.add(row)
    db.flush()
    return row, True


def _adopt_schema(
    db: Session, env: EvalEnvironment, schema_json: Dict[str, Any]
) -> Tuple[EvalEnvironmentSchema, Optional[EvalEnvironmentSchema]]:
    """Make ``schema_json`` current; sync slots before moving the pointer."""
    previous = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if (env.current_schema_id)
        else None
    )
    row, _ = _store_schema(db, env, schema_json)
    if previous is None or previous.id != row.id:
        # Must run before current_schema_id moves (A->B->A keeps B's confirmations).
        sync_model_slots(
            db, env, row, previous_schema_id=previous.id if previous else None
        )
        env.current_schema_id = row.id
    return row, previous


def _schema_diff(old: Optional[Dict[str, Any]], new: Dict[str, Any]) -> Dict[str, Any]:
    old_fields = (old or {}).get("fields") or {}
    new_fields = new.get("fields") or {}
    added = [p for p in new_fields if p not in old_fields]
    removed = [p for p in old_fields if p not in new_fields]
    changed_types = []
    for pointer, entry in new_fields.items():
        before = old_fields.get(pointer)
        if before is None:
            continue
        old_type, new_type = before.get("type"), entry.get("type")
        if old_type != new_type:
            changed_types.append({"pointer": pointer, "from": old_type, "to": new_type})
    return {"added": added, "removed": removed, "changed_types": changed_types}


def _record_health(
    env: EvalEnvironment, *, ok: bool, error: Optional[str] = None
) -> None:
    env.health_status = "ok" if ok else "error"
    env.health_checked_at = utc_now_naive()
    env.health_error = None if ok else error


def _slot_summary(slots: List[EvalModelSlot]) -> Dict[str, Any]:
    counts = {status.value: 0 for status in EvalModelSlotStatus}
    for slot in slots:
        counts[slot.status.value] += 1
    return {
        "needs_confirmation": slots_need_confirmation(slots),
        "counts": counts,
    }


def _official_presets(db: Session, env_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Per environment: its published official defaults (plan §9.2), if any.

    ``{env_id: {"preset_id", "version_id", "version"}}``; environments without an
    official preset, or whose preset has no current version, are left out.
    """
    if not env_ids:
        return {}
    Preset = db_models.EvalConfigPreset
    Version = db_models.EvalConfigPresetVersion
    rows = (
        db.query(Preset.environment_id, Preset.id, Version.id, Version.version)
        .join(
            Version,
            (Version.id == Preset.current_version_id)
            & (Version.preset_id == Preset.id),
        )
        .filter(
            Preset.environment_id.in_(env_ids),
            Preset.kind == db_models.EvalConfigPresetKind.OFFICIAL,
        )
        .all()
    )
    return {
        env_id: {"preset_id": preset_id, "version_id": version_id, "version": version}
        for env_id, preset_id, version_id, version in rows
    }


def _serialize_environment(
    env: EvalEnvironment,
    schema: Optional[EvalEnvironmentSchema],
    slot_summary: Dict[str, Any],
    official: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    official = official or {}
    return {
        "id": env.id,
        "project_id": env.project_id,
        "name": env.name,
        "description": env.description,
        "base_url": env.base_url,
        "api_key_set": bool(env.api_key_encrypted),
        "api_key_hint": _key_hint(env.api_key_last4),
        "default_priority": env.default_priority.value,
        "max_priority": env.max_priority.value,
        "max_inflight_jobs": env.max_inflight_jobs,
        "allow_connection_keys": bool(env.allow_connection_keys),
        "ranking_metric": env.ranking_metric,
        "ranking_k": env.ranking_k,
        "current_schema_id": env.current_schema_id,
        "schema_hash": schema.schema_hash if schema else None,
        "schema_fetched_at": to_api_timestamp(schema.fetched_at) if schema else None,
        "health_status": env.health_status,
        "health_checked_at": to_api_timestamp(env.health_checked_at),
        "health_error": env.health_error,
        "is_active": bool(env.is_active),
        "model_slots": slot_summary,
        # Published official defaults ("Run official defaults", plan §9.2).
        "official_preset_id": official.get("preset_id"),
        "official_preset_version_id": official.get("version_id"),
        "official_preset_version": official.get("version"),
        "created_by_user_id": env.created_by_user_id,
        "created_at": to_api_timestamp(env.created_at),
        "updated_at": to_api_timestamp(env.updated_at),
    }


def _environment_payload(db: Session, env: EvalEnvironment) -> Dict[str, Any]:
    schema = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if env.current_schema_id
        else None
    )
    slots = list_model_slots(db, schema.id) if schema else []
    return _serialize_environment(
        env, schema, _slot_summary(slots), _official_presets(db, [env.id]).get(env.id)
    )


def _slots_payload(slots: List[EvalModelSlot]) -> Dict[str, Any]:
    return {
        "slots": [slot_to_dict(s) for s in slots],
        "needs_confirmation": slots_need_confirmation(slots),
    }


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@router.get(_PREFIX)
def list_environments(
    project_id: str,
    active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    query = db.query(EvalEnvironment).filter(EvalEnvironment.project_id == project_id)
    if active is not None:
        query = query.filter(EvalEnvironment.is_active.is_(active))
    envs = query.order_by(EvalEnvironment.is_active.desc(), EvalEnvironment.name).all()

    schema_ids = [e.current_schema_id for e in envs if e.current_schema_id]
    schemas: Dict[str, EvalEnvironmentSchema] = {}
    counts: Dict[str, Dict[str, int]] = {}
    if schema_ids:
        for row in db.query(EvalEnvironmentSchema).filter(
            EvalEnvironmentSchema.id.in_(schema_ids)
        ):
            schemas[row.id] = row
        for schema_id, status, total in (
            db.query(EvalModelSlot.schema_id, EvalModelSlot.status, func.count())
            .filter(EvalModelSlot.schema_id.in_(schema_ids))
            .group_by(EvalModelSlot.schema_id, EvalModelSlot.status)
        ):
            counts.setdefault(schema_id, {})[status.value] = total

    officials = _official_presets(db, [e.id for e in envs])
    payload = []
    for env in envs:
        by_status = {s.value: 0 for s in EvalModelSlotStatus}
        by_status.update(counts.get(env.current_schema_id or "", {}))
        summary = {
            "needs_confirmation": bool(
                by_status[EvalModelSlotStatus.PROPOSED.value]
                or by_status[EvalModelSlotStatus.STALE.value]
            ),
            "counts": by_status,
        }
        payload.append(
            _serialize_environment(
                env,
                schemas.get(env.current_schema_id or ""),
                summary,
                officials.get(env.id),
            )
        )
    return {"environments": payload}


@router.get(_PREFIX + "/{env_id}")
def get_environment(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    return _environment_payload(db, _get_environment(db, project_id, env_id))


@router.post(_PREFIX)
async def create_environment(
    project_id: str,
    req: EnvironmentCreateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    client_factory: EvalClientFactory = Depends(get_eval_client_factory),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    settings = PlatformSettings()
    if not encryption_available(settings):
        raise HTTPException(
            status_code=400,
            detail=(
                "Environment key encryption is not configured "
                "(set QYM_LLM_CONFIG_ENCRYPTION_KEY)"
            ),
        )
    name = req.name.strip()
    api_key = req.api_key.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A name is required")
    if not api_key:
        raise HTTPException(status_code=400, detail="An API key is required")
    base_url = normalize_environment_url(req.base_url, settings)
    _ensure_name_available(db, project_id, name, exclude_env_id=None)
    _ensure_url_available(db, base_url, project_id=project_id, exclude_env_id=None)

    env = EvalEnvironment(
        project_id=project_id,
        name=name,
        description=req.description.strip(),
        base_url=base_url,
        default_priority=req.default_priority,
        max_priority=req.max_priority,
        max_inflight_jobs=req.max_inflight_jobs,
        allow_connection_keys=req.allow_connection_keys,
        ranking_metric=(req.ranking_metric or "").strip() or None,
        ranking_k=req.ranking_k,
        created_by_user_id=principal.user.id,
    )
    _check_priorities(env)
    _store_key(env, api_key, settings)

    try:
        schema_json = await _probe(client_factory, base_url, api_key)
    except _REMOTE_ERRORS as exc:
        raise _remote_http_error(exc, api_key)

    db.add(env)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An environment with that name or URL already exists",
        )
    schema, _ = _adopt_schema(db, env, schema_json)
    _record_health(env, ok=True)
    _commit(db)
    db.refresh(env)
    slots = list_model_slots(db, schema.id)
    return {
        "environment": _serialize_environment(env, schema, _slot_summary(slots)),
        **_slots_payload(slots),
    }


@router.put(_PREFIX + "/{env_id}")
def update_environment(
    project_id: str,
    env_id: str,
    req: EnvironmentUpdateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    settings = PlatformSettings()
    env = _get_environment(db, project_id, env_id)
    fields = req.model_fields_set

    if req.name is not None:
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="A name is required")
        _ensure_name_available(db, project_id, name, exclude_env_id=env.id)
        env.name = name
    if req.description is not None:
        env.description = req.description.strip()

    url_changed = False
    if req.base_url is not None:
        base_url = normalize_environment_url(req.base_url, settings)
        url_changed = base_url != env.base_url
        env.base_url = base_url

    reactivating = req.is_active is True and not env.is_active
    if req.is_active is not None:
        env.is_active = req.is_active
    if env.is_active and (url_changed or reactivating):
        try:
            _ensure_url_available(
                db, env.base_url, project_id=project_id, exclude_env_id=env.id
            )
        except HTTPException as exc:
            if reactivating:
                raise HTTPException(
                    status_code=409,
                    detail=f"Cannot reactivate: {exc.detail[0].lower()}{exc.detail[1:]}",
                )
            raise

    api_key = (req.api_key or "").strip()
    key_changed = bool(api_key) and api_key != _KEEP_KEY
    if key_changed:
        _store_key(env, api_key, settings)

    if req.default_priority is not None:
        env.default_priority = req.default_priority
    if req.max_priority is not None:
        env.max_priority = req.max_priority
    _check_priorities(env)
    if req.max_inflight_jobs is not None:
        env.max_inflight_jobs = req.max_inflight_jobs
    if req.allow_connection_keys is not None:
        env.allow_connection_keys = req.allow_connection_keys
    elif url_changed:
        # The opt-in was given for the old host; a new host must be opted in again.
        env.allow_connection_keys = False
    if "ranking_metric" in fields:
        env.ranking_metric = (req.ranking_metric or "").strip() or None
    if "ranking_k" in fields:
        env.ranking_k = req.ranking_k

    if url_changed or key_changed:
        # The stored health describes the old URL/key; run /test to re-check.
        env.health_status = "unknown"
        env.health_checked_at = None
        env.health_error = None
    _commit(db)
    db.refresh(env)
    return _environment_payload(db, env)


@router.delete(_PREFIX + "/{env_id}")
def delete_environment(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    if _environment_in_use(db, env):
        env.is_active = False
        db.commit()
        return {"ok": True, "id": env_id, "deleted": False, "disabled": True}
    # Break the env <-> current schema cycle, then remove children explicitly so
    # this works without database-level cascades (e.g. SQLite without FK pragma).
    env.current_schema_id = None
    db.flush()
    db.query(EvalModelSlot).filter(EvalModelSlot.environment_id == env.id).delete(
        synchronize_session=False
    )
    db.query(EvalEnvironmentSchema).filter(
        EvalEnvironmentSchema.environment_id == env.id
    ).delete(synchronize_session=False)
    db.delete(env)
    db.commit()
    return {"ok": True, "id": env_id, "deleted": True, "disabled": False}


@router.post(_PREFIX + "/{env_id}/test")
async def test_environment(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    client_factory: EvalClientFactory = Depends(get_eval_client_factory),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    settings = PlatformSettings()
    env = _get_environment(db, project_id, env_id)
    api_key = _stored_key(env, settings)
    current = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if env.current_schema_id
        else None
    )
    try:
        schema_json = await _probe(client_factory, env.base_url, api_key)
    except _REMOTE_ERRORS as exc:
        error = _remote_http_error(exc, api_key).detail
        _record_health(env, ok=False, error=error)
        db.commit()
        return {"ok": False, "error": error, "health_status": env.health_status}
    _record_health(env, ok=True)
    db.commit()
    digest = _schema_hash(schema_json)
    return {
        "ok": True,
        "health_status": env.health_status,
        "schema_hash": digest,
        "schema_changed": current is None or current.schema_hash != digest,
    }


@router.post(_PREFIX + "/{env_id}/schema/refresh")
async def refresh_environment_schema(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    client_factory: EvalClientFactory = Depends(get_eval_client_factory),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    settings = PlatformSettings()
    env = _get_environment(db, project_id, env_id)
    api_key = _stored_key(env, settings)
    client = client_factory(env.base_url, api_key)
    try:
        schema_json = await client.env_overrides_schema()
    except _REMOTE_ERRORS as exc:
        http_error = _remote_http_error(exc, api_key)
        _record_health(env, ok=False, error=http_error.detail)
        db.commit()
        raise http_error
    finally:
        await client.aclose()
    if not isinstance(schema_json, dict):
        raise HTTPException(
            status_code=502, detail="Evaluation service returned an invalid schema"
        )

    schema, previous = _adopt_schema(db, env, schema_json)
    changed = previous is None or previous.id != schema.id
    diff = (
        _schema_diff(
            descriptor_for_schema(previous) if previous else None,
            descriptor_for_schema(schema),
        )
        if changed
        else {"added": [], "removed": [], "changed_types": []}
    )
    _record_health(env, ok=True)
    _commit(db)
    slots = list_model_slots(db, schema.id)
    return {
        "changed": changed,
        **diff,
        "schema_id": schema.id,
        "schema_hash": schema.schema_hash,
        "previous_schema_id": previous.id if previous else None,
        **_slots_payload(slots),
    }


@router.get(_PREFIX + "/{env_id}/form")
def get_environment_form(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    schema = _current_schema(db, env)
    return {
        "environment_id": env.id,
        "schema_id": schema.id,
        "schema_hash": schema.schema_hash,
        "descriptor": descriptor_for_schema(schema),
    }


@router.get(_PREFIX + "/{env_id}/model-slots")
def get_model_slots(
    project_id: str,
    env_id: str,
    propose_endpoint: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """List the current schema's slots; ``propose_endpoint`` previews an extra slot."""
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    schema = _current_schema(db, env)
    payload: Dict[str, Any] = {
        "environment_id": env.id,
        "schema_id": schema.id,
        **_slots_payload(list_model_slots(db, schema.id)),
    }
    if propose_endpoint:
        proposal = propose_endpoint_slot(
            descriptor_for_schema(schema), propose_endpoint.strip()
        )
        payload["proposal"] = proposal.to_dict() if proposal else None
    return payload


@router.get(_PREFIX + "/{env_id}/model-options")
def get_model_options(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Launch-form model picker (#23): project models per confirmed slot. Secret-free.

    Wraps ``eval_bindings.connection_options``: each connection's availability for
    the environment and for each confirmed slot, plus whether temporary-model keys
    are accepted (``temporary_keys_allowed``/``temporary_keys_reason``).
    """
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    schema = _current_schema(db, env)
    slots = [
        slot
        for slot in list_model_slots(db, schema.id)
        if slot.status == EvalModelSlotStatus.CONFIRMED
    ]
    return {
        "schema_id": schema.id,
        **connection_options(
            db, env, slots, descriptor=descriptor_for_schema(schema)
        ),
    }


@router.put(_PREFIX + "/{env_id}/model-slots")
def put_model_slots(
    project_id: str,
    env_id: str,
    req: ModelSlotsUpdateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_manager(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    schema = _current_schema(db, env)
    if req.schema_id and req.schema_id != schema.id:
        raise HTTPException(
            status_code=409,
            detail="The environment schema changed; reload the model slots",
        )
    try:
        slots = confirm_model_slots(
            db, env, schema, req.slots, user_id=principal.user.id
        )
    except SlotValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail={"errors": exc.errors})
    db.commit()
    return {
        "environment_id": env.id,
        "schema_id": schema.id,
        **_slots_payload(slots),
    }
