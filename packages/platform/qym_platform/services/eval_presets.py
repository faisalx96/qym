"""Official defaults and saved presets for an environment (plan §4.4, §9.1).

A preset is a named starting point holding immutable, numbered versions of a §8.1
config document (no sweeps, no links, no secrets):

- ``official``: the environment's manager-published defaults. At most one per
  environment (partial unique index; a lost race maps to :class:`PresetError` 409).
  Every publish requires release notes and adds ``version = n + 1``. Temporary-model
  bindings must be rebound to project connections first.
- ``saved``: any project member may create one; its creator or a project manager may
  publish further versions. Temporary models keep label/model/base_url only; their
  key reference is dropped (plan §7.5: presets never copy the key).

Rules the database does not enforce and this module does:

- versions are never updated (see also the ``before_update`` guard on
  ``EvalConfigPresetVersion``) and there is no update or delete path for them;
- ``current_version_id`` always points at a version of the same preset;
- saved preset names are unique per environment, case-insensitively (best effort:
  checked before insert, not backed by an index). The official preset is identified
  by its kind, not its name, which defaults to ``Official defaults``.

Bindings to connections that were deleted (or hidden from experiments) are reported as
**warnings**, never errors, both when saving and when reading a version, so the UI can
show them and the launch form can require re-picking the model (§9.1).
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    EvalConfigPreset,
    EvalConfigPresetKind,
    EvalConfigPresetVersion,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalModelSlot,
    EvalModelSlotStatus,
    ProjectLlmConnection,
)
from qym_platform.services.eval_config import binding_kind, validate_config_document
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)
from qym_platform.services.eval_schema_form import escape_pointer_segment
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

OFFICIAL_DEFAULT_NAME = "Official defaults"
MAX_NAME_LENGTH = 200
MAX_NOTES_LENGTH = 5000


class PresetError(Exception):
    """A preset operation failed; ``status_code``/``detail`` map onto HTTP."""

    def __init__(self, status_code: int, detail: Any) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


# --------------------------------------------------------------------------- helpers


def _binding_pointer(slot_key: str) -> str:
    return "/slot_bindings/" + escape_pointer_segment(str(slot_key))


def _issue(
    rule: str,
    message: str,
    *,
    slot_key: Optional[str] = None,
    pointer: Optional[str] = None,
    section: str = "slot_bindings",
    **extra: Any,
) -> Dict[str, Any]:
    """An error/warning object shaped like ``eval_config`` errors."""
    issue: Dict[str, Any] = {
        "section": section,
        "pointer": (
            pointer
            if pointer is not None
            else (_binding_pointer(slot_key) if slot_key else "")
        ),
        "rule": rule,
        "message": message,
    }
    if slot_key is not None:
        issue["slot_key"] = slot_key
    issue.update(extra)
    return issue


def _bindings(config: Any) -> Mapping[str, Any]:
    if not isinstance(config, Mapping):
        return {}
    bindings = config.get("slot_bindings")
    return bindings if isinstance(bindings, Mapping) else {}


def _connection_ids(configs: Iterable[Any]) -> set[str]:
    ids: set[str] = set()
    for config in configs:
        for binding in _bindings(config).values():
            if binding_kind(binding) == "connection":
                cid = binding.get("connection_id")
                if isinstance(cid, str) and cid:
                    ids.add(cid)
    return ids


def _load_connections(
    db: Session, project_id: str, ids: Iterable[str]
) -> Dict[str, ProjectLlmConnection]:
    ids = list(ids)
    if not ids:
        return {}
    rows = (
        db.query(ProjectLlmConnection)
        .filter(
            ProjectLlmConnection.project_id == project_id,
            ProjectLlmConnection.id.in_(ids),
        )
        .all()
    )
    return {row.id: row for row in rows}


def connection_warnings(
    config: Any, connections: Mapping[str, ProjectLlmConnection]
) -> List[Dict[str, Any]]:
    """Warnings for bindings whose project connection is gone or hidden."""
    warnings: List[Dict[str, Any]] = []
    for slot_key, binding in _bindings(config).items():
        if binding_kind(binding) != "connection":
            continue
        cid = binding.get("connection_id")
        connection = connections.get(cid) if isinstance(cid, str) else None
        label = binding.get("name") or cid
        if connection is None:
            warnings.append(
                _issue(
                    "connection_missing",
                    f"Model {label!r} no longer exists; pick another model before "
                    "launching",
                    slot_key=str(slot_key),
                    connection_id=cid,
                )
            )
        elif not connection.available_for_experiments:
            warnings.append(
                _issue(
                    "connection_unavailable",
                    f"Model {connection.name!r} is not available for experiments",
                    slot_key=str(slot_key),
                    connection_id=cid,
                )
            )
    return warnings


def _normalize_name(name: Optional[str], kind: EvalConfigPresetKind) -> str:
    value = (name or "").strip()
    if not value and kind == EvalConfigPresetKind.OFFICIAL:
        value = OFFICIAL_DEFAULT_NAME
    if not value:
        raise PresetError(422, "A preset name is required")
    if len(value) > MAX_NAME_LENGTH:
        raise PresetError(422, f"Preset names are at most {MAX_NAME_LENGTH} characters")
    return value


def _normalize_notes(notes: Optional[str], kind: EvalConfigPresetKind) -> str:
    value = (notes or "").strip()
    if kind == EvalConfigPresetKind.OFFICIAL and not value:
        raise PresetError(
            422, "Release notes are required to publish official defaults"
        )
    if len(value) > MAX_NOTES_LENGTH:
        raise PresetError(422, f"Notes are at most {MAX_NOTES_LENGTH} characters")
    return value


def _ensure_writable(env: EvalEnvironment) -> None:
    if not env.is_active:
        raise PresetError(
            409, "This environment is disabled; re-enable it to change its presets"
        )


def _ensure_name_available(db: Session, env: EvalEnvironment, name: str) -> None:
    query = db.query(EvalConfigPreset.id).filter(
        EvalConfigPreset.environment_id == env.id,
        EvalConfigPreset.kind == EvalConfigPresetKind.SAVED,
        func.lower(EvalConfigPreset.name) == name.lower(),
    )
    if query.first() is not None:
        raise PresetError(409, "A preset with that name already exists")


def _active_slots(db: Session, schema: EvalEnvironmentSchema) -> List[EvalModelSlot]:
    return [
        slot
        for slot in list_model_slots(db, schema.id)
        if slot.status != EvalModelSlotStatus.STALE
    ]


# --------------------------------------------------------------------------- config


def prepare_config(
    db: Session,
    env: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    config: Any,
    *,
    official: bool,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Validate a preset document on ``schema``; return ``(stored, warnings)``.

    Raises :class:`PresetError` 422 with ``{"errors", "warnings"}`` when invalid.
    The stored copy is pinned to ``schema``'s hash and never carries a temporary
    model's key reference.
    """
    if not isinstance(config, Mapping):
        raise PresetError(
            422,
            {
                "errors": [
                    _issue(
                        "type",
                        "The config document must be an object",
                        section="document",
                    )
                ],
                "warnings": [],
            },
        )
    document = copy.deepcopy(dict(config))
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []

    if "links" in document:
        errors.append(
            _issue(
                "sweep",
                "Presets hold one configuration; linked sweeps are not allowed",
                section="document",
                pointer="/links",
            )
        )

    for slot_key, binding in _bindings(document).items():
        if binding_kind(binding) != "temporary":
            continue
        temporary = binding.get("temporary")
        label = None
        if isinstance(temporary, Mapping):
            label = temporary.get("label") or temporary.get("model")
        if official:
            errors.append(
                _issue(
                    "temporary_binding",
                    f"Temporary model {label or slot_key!r} must be rebound to a "
                    "project model before publishing official defaults",
                    slot_key=str(slot_key),
                )
            )
        elif isinstance(temporary, Mapping) and "api_key" in temporary:
            # Presets copy label, model and base URL, never the key (§7.5).
            binding["temporary"] = {
                k: v for k, v in temporary.items() if k != "api_key"
            }
            if temporary.get("api_key") is not None:
                warnings.append(
                    _issue(
                        "temporary_key_dropped",
                        f"The key of temporary model {label or slot_key!r} is not "
                        "saved; it is asked for again at launch",
                        slot_key=str(slot_key),
                    )
                )

    result = validate_config_document(
        document,
        env_schema=schema.schema_json or {},
        slots=_active_slots(db, schema),
        descriptor=descriptor_for_schema(schema),
        schema_hash=schema.schema_hash,
        require_dataset=False,
    )
    errors += result.errors
    warnings += result.warnings
    connections = _load_connections(db, env.project_id, _connection_ids([document]))
    warnings += connection_warnings(document, connections)
    if errors:
        raise PresetError(422, {"errors": errors, "warnings": warnings})
    # A submitted older hash yields a warning above; the stored copy validated on
    # ``schema`` and is pinned to it.
    document["schema_hash"] = schema.schema_hash
    return document, warnings


# --------------------------------------------------------------------------- queries


def list_presets(db: Session, env: EvalEnvironment) -> List[EvalConfigPreset]:
    """The official preset first, then saved presets by name."""
    rows = (
        db.query(EvalConfigPreset)
        .filter(EvalConfigPreset.environment_id == env.id)
        .all()
    )
    return sorted(
        rows,
        key=lambda p: (
            0 if p.kind == EvalConfigPresetKind.OFFICIAL else 1,
            p.name.lower(),
            p.id,
        ),
    )


def get_preset(db: Session, env: EvalEnvironment, preset_id: str) -> EvalConfigPreset:
    preset = (
        db.query(EvalConfigPreset)
        .filter(
            EvalConfigPreset.id == preset_id,
            EvalConfigPreset.environment_id == env.id,
        )
        .first()
    )
    if preset is None:
        raise PresetError(404, "Preset not found")
    return preset


def official_preset(db: Session, env: EvalEnvironment) -> Optional[EvalConfigPreset]:
    return (
        db.query(EvalConfigPreset)
        .filter(
            EvalConfigPreset.environment_id == env.id,
            EvalConfigPreset.kind == EvalConfigPresetKind.OFFICIAL,
        )
        .first()
    )


def current_version(
    db: Session, preset: EvalConfigPreset
) -> Optional[EvalConfigPresetVersion]:
    """The preset's current version; never one belonging to another preset."""
    if not preset.current_version_id:
        return None
    return (
        db.query(EvalConfigPresetVersion)
        .filter(
            EvalConfigPresetVersion.id == preset.current_version_id,
            EvalConfigPresetVersion.preset_id == preset.id,
        )
        .first()
    )


def list_versions(
    db: Session, preset: EvalConfigPreset
) -> List[EvalConfigPresetVersion]:
    """Every version of a preset, newest first."""
    return (
        db.query(EvalConfigPresetVersion)
        .filter(EvalConfigPresetVersion.preset_id == preset.id)
        .order_by(EvalConfigPresetVersion.version.desc())
        .all()
    )


def get_version(
    db: Session, preset: EvalConfigPreset, version: int
) -> EvalConfigPresetVersion:
    row = (
        db.query(EvalConfigPresetVersion)
        .filter(
            EvalConfigPresetVersion.preset_id == preset.id,
            EvalConfigPresetVersion.version == version,
        )
        .first()
    )
    if row is None:
        raise PresetError(404, "Preset version not found")
    return row


def can_publish(
    preset: EvalConfigPreset, *, user_id: Optional[str], is_manager: bool
) -> bool:
    """Managers publish anything; a member only new versions of their own saved preset."""
    if is_manager:
        return True
    return preset.kind == EvalConfigPresetKind.SAVED and bool(
        user_id and preset.created_by_user_id == user_id
    )


# --------------------------------------------------------------------------- writes


def _flush(db: Session, conflict: str) -> None:
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise PresetError(409, conflict)


def _set_current(preset: EvalConfigPreset, version: EvalConfigPresetVersion) -> None:
    if version.preset_id != preset.id:  # pragma: no cover - programming error
        raise ValueError("current_version_id must belong to the same preset")
    preset.current_version_id = version.id
    preset.updated_at = utc_now_naive()


def create_preset(
    db: Session,
    env: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    *,
    kind: EvalConfigPresetKind,
    name: Optional[str],
    config: Any,
    notes: Optional[str],
    user_id: Optional[str],
) -> Tuple[EvalConfigPreset, EvalConfigPresetVersion, List[Dict[str, Any]]]:
    """Create a preset with version 1. The caller checks the role and commits."""
    _ensure_writable(env)
    official = kind == EvalConfigPresetKind.OFFICIAL
    clean_name = _normalize_name(name, kind)
    clean_notes = _normalize_notes(notes, kind)
    if official:
        existing = official_preset(db, env)
        if existing is not None:
            raise PresetError(
                409,
                {
                    "message": "This environment already has official defaults; "
                    "publish a new version instead",
                    "preset_id": existing.id,
                },
            )
    if not official:
        _ensure_name_available(db, env, clean_name)
    stored, warnings = prepare_config(db, env, schema, config, official=official)

    preset = EvalConfigPreset(
        environment_id=env.id,
        name=clean_name,
        kind=kind,
        created_by_user_id=user_id,
    )
    db.add(preset)
    _flush(db, "This environment already has official defaults")
    version = EvalConfigPresetVersion(
        preset_id=preset.id,
        version=1,
        schema_id=schema.id,
        config=stored,
        notes=clean_notes,
        published_by_user_id=user_id,
        published_at=utc_now_naive(),
    )
    db.add(version)
    _flush(db, "Could not publish the preset; retry")
    _set_current(preset, version)
    _flush(db, "Could not publish the preset; retry")
    return preset, version, warnings


def publish_version(
    db: Session,
    env: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    preset: EvalConfigPreset,
    *,
    config: Any,
    notes: Optional[str],
    user_id: Optional[str],
) -> Tuple[EvalConfigPresetVersion, List[Dict[str, Any]]]:
    """Append ``version = n + 1``; older versions are left untouched."""
    _ensure_writable(env)
    official = preset.kind == EvalConfigPresetKind.OFFICIAL
    clean_notes = _normalize_notes(notes, preset.kind)
    stored, warnings = prepare_config(db, env, schema, config, official=official)

    # Serialize concurrent publishes on PostgreSQL; the unique (preset_id, version)
    # constraint catches the race everywhere else.
    db.query(EvalConfigPreset.id).filter(
        EvalConfigPreset.id == preset.id
    ).with_for_update().first()
    latest = (
        db.query(func.max(EvalConfigPresetVersion.version))
        .filter(EvalConfigPresetVersion.preset_id == preset.id)
        .scalar()
    )
    version = EvalConfigPresetVersion(
        preset_id=preset.id,
        version=int(latest or 0) + 1,
        schema_id=schema.id,
        config=stored,
        notes=clean_notes,
        published_by_user_id=user_id,
        published_at=utc_now_naive(),
    )
    db.add(version)
    _flush(db, "Another version was published at the same time; reload and retry")
    _set_current(preset, version)
    _flush(db, "Another version was published at the same time; reload and retry")
    return version, warnings


# --------------------------------------------------------------------------- payloads


def version_payloads(
    db: Session,
    env: EvalEnvironment,
    versions: Sequence[EvalConfigPresetVersion],
) -> List[Dict[str, Any]]:
    """Serialize versions with current warnings (deleted models, older schema)."""
    schema_ids = {v.schema_id for v in versions}
    hashes = {
        row.id: row.schema_hash
        for row in (
            db.query(EvalEnvironmentSchema.id, EvalEnvironmentSchema.schema_hash)
            .filter(EvalEnvironmentSchema.id.in_(schema_ids))
            .all()
            if schema_ids
            else []
        )
    }
    connections = _load_connections(
        db, env.project_id, _connection_ids(v.config for v in versions)
    )
    payloads = []
    for version in versions:
        warnings = connection_warnings(version.config, connections)
        schema_current = version.schema_id == env.current_schema_id
        if not schema_current:
            warnings.insert(
                0,
                _issue(
                    "schema_hash",
                    "Authored on a different schema version; re-map before launching",
                    section="document",
                    pointer="/schema_hash",
                ),
            )
        payloads.append(
            {
                "id": version.id,
                "preset_id": version.preset_id,
                "version": version.version,
                "schema_id": version.schema_id,
                "schema_hash": hashes.get(version.schema_id),
                "schema_current": schema_current,
                "config": copy.deepcopy(version.config),
                "notes": version.notes,
                "published_by_user_id": version.published_by_user_id,
                "published_at": to_api_timestamp(version.published_at),
                "warnings": warnings,
            }
        )
    return payloads


def preset_payload(
    preset: EvalConfigPreset,
    current: Optional[Dict[str, Any]],
    *,
    can_publish_versions: bool,
) -> Dict[str, Any]:
    return {
        "id": preset.id,
        "environment_id": preset.environment_id,
        "name": preset.name,
        "kind": preset.kind.value,
        "current_version_id": preset.current_version_id,
        "current_version": current,
        "can_publish": can_publish_versions,
        "created_by_user_id": preset.created_by_user_id,
        "created_at": to_api_timestamp(preset.created_at),
        "updated_at": to_api_timestamp(preset.updated_at),
    }
