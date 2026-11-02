"""Official defaults and saved presets of an environment (plan §5.1, §9.1).

Routes live under ``/v1/projects/{project_id}/eval-environments/{env_id}/presets``.
Project members read every preset and create ``saved`` ones; a saved preset's creator
or a project manager publishes its next version; only project managers (or platform
admins) create or publish the ``official`` preset. Versions are append-only: there is
no route that updates or deletes one. ``GET …/versions/{n}?remap=current`` returns a
version re-mapped onto the environment's current schema without storing it (§9.3).

``GET /v1/projects/{project_id}/eval-environments/{env_id}/promote-prefill`` (#39)
returns the official-defaults editor prefill for a saved preset, an official run or
a job (matrix cell). It is read-only: promoting always goes through the editor and
the publish routes above.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from qym_platform.api.eval_environments import _current_schema, _get_environment
from qym_platform.api.projects import _require_project_access, _require_project_manager
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import (
    EvalConfigPreset,
    EvalConfigPresetKind,
    EvalEnvironment,
)
from qym_platform.deps import get_db
from qym_platform.permissions import is_project_manager, require_project_writable
from qym_platform.services import eval_presets, eval_promote
from qym_platform.services.eval_presets import PresetError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.log import get_logger

logger = get_logger(__name__)

router = APIRouter()

_PREFIX = "/v1/projects/{project_id}/eval-environments/{env_id}/presets"


class PresetCreateRequest(BaseModel):
    kind: EvalConfigPresetKind = EvalConfigPresetKind.SAVED
    name: Optional[str] = Field(default=None, max_length=200)
    config: Dict[str, Any]
    notes: Optional[str] = Field(default=None, max_length=5000)


class PresetPublishRequest(BaseModel):
    config: Dict[str, Any]
    notes: Optional[str] = Field(default=None, max_length=5000)


def _http(exc: PresetError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The presets changed at the same time; reload and retry",
        )


def _is_manager(db: Session, principal: Principal, project_id: str) -> bool:
    return is_project_manager(db, principal, project_id)


def _preset_payload(
    db: Session,
    env: EvalEnvironment,
    preset: EvalConfigPreset,
    *,
    user_id: Optional[str],
    is_manager: bool,
) -> Dict[str, Any]:
    current = eval_presets.current_version(db, preset)
    current_payload = (
        eval_presets.version_payloads(db, env, [current])[0] if current else None
    )
    return eval_presets.preset_payload(
        preset,
        current_payload,
        can_publish_versions=eval_presets.can_publish(
            preset, user_id=user_id, is_manager=is_manager
        ),
        created_by=eval_presets.user_briefs(db, [preset.created_by_user_id]).get(
            preset.created_by_user_id or ""
        ),
    )


@router.get(_PREFIX)
def list_presets(
    project_id: str,
    env_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    is_manager = _is_manager(db, principal, project_id)
    presets = eval_presets.list_presets(db, env)
    return {
        "environment_id": env.id,
        "can_publish_official": is_manager,
        "presets": [
            _preset_payload(
                db, env, p, user_id=principal.user.id, is_manager=is_manager
            )
            for p in presets
        ],
    }


@router.post(_PREFIX)
def create_preset(
    project_id: str,
    env_id: str,
    req: PresetCreateRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    if req.kind == EvalConfigPresetKind.OFFICIAL:
        _require_project_manager(db, principal, project_id)
    else:
        _require_project_access(db, principal, project_id)
    require_project_writable(db, project_id)
    env = _get_environment(db, project_id, env_id)
    schema = _current_schema(db, env)
    try:
        preset, _version, warnings = eval_presets.create_preset(
            db,
            env,
            schema,
            kind=req.kind,
            name=req.name,
            config=req.config,
            notes=req.notes,
            user_id=principal.user.id,
        )
    except PresetError as exc:
        db.rollback()
        raise _http(exc)
    _commit(db)
    db.refresh(preset)
    logger.info("Evaluation preset %s created in project %s", preset.id, project_id)
    payload = _preset_payload(
        db,
        env,
        preset,
        user_id=principal.user.id,
        is_manager=_is_manager(db, principal, project_id),
    )
    return {"preset": payload, "warnings": warnings}


@router.get(_PREFIX + "/{preset_id}")
def get_preset(
    project_id: str,
    env_id: str,
    preset_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    try:
        preset = eval_presets.get_preset(db, env, preset_id)
    except PresetError as exc:
        raise _http(exc)
    return {
        "preset": _preset_payload(
            db,
            env,
            preset,
            user_id=principal.user.id,
            is_manager=_is_manager(db, principal, project_id),
        )
    }


@router.get(_PREFIX + "/{preset_id}/versions")
def list_preset_versions(
    project_id: str,
    env_id: str,
    preset_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    try:
        preset = eval_presets.get_preset(db, env, preset_id)
    except PresetError as exc:
        raise _http(exc)
    versions = eval_presets.list_versions(db, preset)
    return {
        "preset_id": preset.id,
        "current_version_id": preset.current_version_id,
        "versions": eval_presets.version_payloads(db, env, versions),
    }


@router.get(_PREFIX + "/{preset_id}/versions/{version}")
def get_preset_version(
    project_id: str,
    env_id: str,
    preset_id: str,
    version: int,
    remap: Optional[str] = Query(default=None, pattern="^current$"),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """One version; ``?remap=current`` adds it re-mapped onto the current schema.

    The stored version is never changed; ``remap`` holds the remapped document and
    the settings that were dropped (plan §9.3).
    """
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    try:
        preset = eval_presets.get_preset(db, env, preset_id)
        row = eval_presets.get_version(db, preset, version)
    except PresetError as exc:
        raise _http(exc)
    payload: Dict[str, Any] = {
        "version": eval_presets.version_payloads(db, env, [row])[0]
    }
    if remap == "current":
        schema = _current_schema(db, env)
        payload["remap"] = eval_presets.remap_version(db, row, schema).to_dict()
    return payload


@router.post(_PREFIX + "/{preset_id}/versions")
def publish_preset_version(
    project_id: str,
    env_id: str,
    preset_id: str,
    req: PresetPublishRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_project_access(db, principal, project_id)
    require_project_writable(db, project_id)
    env = _get_environment(db, project_id, env_id)
    try:
        preset = eval_presets.get_preset(db, env, preset_id)
    except PresetError as exc:
        raise _http(exc)
    is_manager = _is_manager(db, principal, project_id)
    if not eval_presets.can_publish(
        preset, user_id=principal.user.id, is_manager=is_manager
    ):
        detail = (
            "Project manager access required"
            if preset.kind == EvalConfigPresetKind.OFFICIAL
            else "Only the preset's creator or a project manager can publish it"
        )
        raise HTTPException(status_code=403, detail=detail)
    schema = _current_schema(db, env)
    try:
        version, warnings = eval_presets.publish_version(
            db,
            env,
            schema,
            preset,
            config=req.config,
            notes=req.notes,
            user_id=principal.user.id,
        )
    except PresetError as exc:
        db.rollback()
        raise _http(exc)
    _commit(db)
    db.refresh(preset)
    logger.info("Evaluation preset %s version %s published", preset.id, getattr(version, "id", None))
    return {
        "preset": _preset_payload(
            db, env, preset, user_id=principal.user.id, is_manager=is_manager
        ),
        "version": eval_presets.version_payloads(db, env, [version])[0],
        "warnings": warnings,
    }


@router.get("/v1/projects/{project_id}/eval-environments/{env_id}/promote-prefill")
def promote_prefill(
    project_id: str,
    env_id: str,
    kind: str = Query(..., pattern="^(saved|run|job)$"),
    source_id: str = Query(..., alias="id", min_length=1, max_length=36),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """"Promote to official" prefill (plan §9.1): never publishes, never writes.

    Managers only (the editor it feeds publishes official defaults). The source must
    belong to this project and environment. The config is re-mapped onto the current
    schema and temporary-model slots come back unbound, listed in ``unbound``.
    """
    _require_project_manager(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    if not env.is_active:
        raise HTTPException(
            status_code=409,
            detail="This environment is disabled; re-enable it to change its presets",
        )
    schema = _current_schema(db, env)
    try:
        payload = eval_promote.promote_prefill(
            db, env, schema, kind=kind, source_id=source_id
        )
    except PresetError as exc:
        raise _http(exc)
    finally:
        db.rollback()  # read-only: nothing from this request is ever committed
    return payload
