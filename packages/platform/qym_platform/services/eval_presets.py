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

A document authored on another schema hash is carried onto the current one with
:func:`remap` (§9.3); :func:`remap_version` does it for a stored version without
touching it. Both also check ``evaluator`` against the environment's current
evaluator schema (guide v1.1 §3.4; the static mirror on older services), so an
``evaluator.config`` key the service no longer accepts is dropped and listed, even
when the env-overrides hash did not change.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
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
    User,
)
from qym_platform.services.eval_config import binding_kind, validate_config_document
from qym_platform.services.eval_evaluator_schema import environment_evaluator_schema
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    detect_model_slots,
    list_model_slots,
    missing_pointers,
    propose_endpoint_slot,
)
from qym_platform.services.eval_schema_form import (
    escape_pointer_segment,
    json_pointer,
    match_pointer,
    split_pointer,
)
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.log import get_logger

logger = get_logger(__name__)

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
            422, "Release notes are required to publish the default preset"
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
                    "project model before publishing the default preset",
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
        evaluator_schema=environment_evaluator_schema(db, env),
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
        logger.info("eval preset write conflicted: %s", conflict)
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
                    "message": "This environment already has a default preset; "
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
    _flush(db, "This environment already has a default preset")
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


# --------------------------------------------------------------------------- remap

# Document and section roots: never dropped wholesale by the validation pass.
_REMAP_ROOTS = ("", "/evaluator", "/env_overrides", "/slot_bindings")
_MAX_REMAP_PASSES = 10
# Errors about a whole collection or a sweep: dropping values cannot fix them.
_UNFIXABLE_RULES = ("sweep", "required_keys", "min_items")


def _is_collection_item(descriptor: Mapping[str, Any], pointer: str) -> bool:
    """True for an entry of an open-ended map (``/env_overrides/…/endpoints/fast``)."""
    prefix = "/env_overrides/"
    if not pointer.startswith(prefix):
        return False
    template = match_pointer(dict(descriptor), pointer[len(prefix) - 1 :])
    entry = (descriptor.get("fields") or {}).get(template) if template else None
    if not entry or entry.get("kind") == "role_table":
        return False
    last = entry["path"][-1]
    return len(last) > 2 and last[0] == "{" and last[-1] == "}"


@dataclass
class RemapResult:
    """A config document re-mapped onto another schema (plan §9.3).

    ``config`` is the remapped document, pinned to the target hash. ``dropped`` lists
    every setting that did not survive, each shaped like an ``eval_config`` error::

        {"section": "env_overrides" | "evaluator" | "slot_bindings" | "document",
         "pointer": "/env_overrides/LLM_OVERRIDES/brief",   # in the source document
         "form_pointer": "/env_overrides/LLM_OVERRIDES/{role}",  # source descriptor
         "params": {"role": "brief"},
         "label": "LLM_OVERRIDES.brief",                  # short name for the summary
         "reason": "removed" | "invalid" | "slot_removed" | "slot_stale",
         "rule": "removed" | <eval_config rule>, "message": "…",
         "slot_key": "endpoint:fast"}                     # bindings only

    Values are never echoed. ``errors`` holds validation errors that dropping values
    cannot fix (e.g. a field the target schema newly requires); ``summary`` is the
    human line ("3 settings no longer supported: …") or ``None``.
    """

    config: Dict[str, Any]
    dropped: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    from_schema_hash: Optional[str] = None
    to_schema_hash: Optional[str] = None

    @property
    def summary(self) -> Optional[str]:
        if not self.dropped:
            return None
        count = len(self.dropped)
        noun = "setting" if count == 1 else "settings"
        labels = ", ".join(item["label"] for item in self.dropped)
        return f"{count} {noun} no longer supported: {labels}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from_schema_hash": self.from_schema_hash,
            "to_schema_hash": self.to_schema_hash,
            "config": copy.deepcopy(self.config),
            "dropped": copy.deepcopy(self.dropped),
            "errors": copy.deepcopy(self.errors),
            "summary": self.summary,
            "ok": not self.errors,
        }


def _label(pointer: str, slot_key: Optional[str] = None) -> str:
    if slot_key is not None:
        return f"model slot {slot_key}"
    segments = split_pointer(pointer)
    if segments[:1] == ["env_overrides"]:
        segments = segments[1:]
    return ".".join(segments) or pointer


def _source_location(
    descriptor: Optional[Mapping[str, Any]], pointer: str
) -> Tuple[str, Dict[str, str]]:
    """Form pointer and template params of a document pointer on the source form."""
    prefix = "/env_overrides"
    if descriptor is None or not pointer.startswith(prefix + "/"):
        return pointer, {}
    relative = pointer[len(prefix) :]
    template = match_pointer(dict(descriptor), relative)
    if template is None:
        return pointer, {}
    params = {}
    for seg, tmpl in zip(split_pointer(relative), split_pointer(template)):
        if len(tmpl) > 2 and tmpl[0] == "{" and tmpl[-1] == "}":
            params[tmpl[1:-1]] = seg
    return prefix + template, params


def _dropped(
    pointer: str,
    reason: str,
    rule: str,
    message: str,
    *,
    source_descriptor: Optional[Mapping[str, Any]],
    slot_key: Optional[str] = None,
) -> Dict[str, Any]:
    section = split_pointer(pointer)[0] if pointer else "document"
    if section not in ("env_overrides", "evaluator", "slot_bindings"):
        section = "document"
    form_pointer, params = _source_location(source_descriptor, pointer)
    item: Dict[str, Any] = {
        "section": section,
        "pointer": pointer,
        "form_pointer": form_pointer,
        "params": params,
        "label": _label(pointer, slot_key),
        "reason": reason,
        "rule": rule,
        "message": message,
    }
    if slot_key is not None:
        item["slot_key"] = slot_key
    return item


def _remap_env(
    value: Any,
    relative: str,
    descriptor: Mapping[str, Any],
    dropped: List[Tuple[str, str, str]],
) -> Any:
    """Keep the parts of ``value`` whose pointer exists in ``descriptor``.

    Returns the kept value, or ``None`` when nothing survives. A field (including a
    ``json`` field) is kept whole; its type is checked by the validation pass.
    """
    template = match_pointer(dict(descriptor), relative) if relative else ""
    if template is None:
        dropped.append((relative, "removed", "No longer in the environment's schema"))
        return None
    entry = (descriptor.get("fields") or {}).get(template) if template else None
    if entry is not None and entry.get("kind") == "field":
        return value
    if not isinstance(value, Mapping):
        dropped.append((relative, "invalid", "Now a group of settings, not a value"))
        return None
    kept: Dict[str, Any] = {}
    for key, child in value.items():
        child_ptr = relative + "/" + escape_pointer_segment(str(key))
        if child is None:
            # An explicit "inherit" stays as authored, or silently goes with its field.
            if match_pointer(dict(descriptor), child_ptr) is not None:
                kept[key] = None
            continue
        result = _remap_env(child, child_ptr, descriptor, dropped)
        if result is not None:
            kept[key] = result
    if value and not kept:
        return None  # emptied by drops: inherit
    return kept


def _slot_status(slot: Any) -> Optional[str]:
    status = slot.get("status") if isinstance(slot, Mapping) else slot.status
    return getattr(status, "value", status)


def _slot_attr(slot: Any, name: str) -> Any:
    return slot.get(name) if isinstance(slot, Mapping) else getattr(slot, name, None)


def _remap_bindings(
    bindings: Mapping[str, Any],
    descriptor: Mapping[str, Any],
    slots: Sequence[Any],
    dropped: List[Tuple[str, str, str, str]],
) -> Dict[str, Any]:
    """Carry bindings forward by ``slot_key`` (§7.3)."""
    index = {_slot_attr(s, "slot_key"): s for s in slots if _slot_attr(s, "slot_key")}
    kept: Dict[str, Any] = {}
    for slot_key, binding in bindings.items():
        slot_key = str(slot_key)
        slot = index.get(slot_key)
        field_map: Optional[Mapping[str, Any]] = None
        if slot is not None and _slot_status(slot) == EvalModelSlotStatus.STALE.value:
            if binding_kind(binding) != "inherit":
                dropped.append(
                    (
                        slot_key,
                        "slot_stale",
                        "slot_stale",
                        f"Model slot {slot_key!r} lost its fields in the new "
                        "schema; group LLM settings again and re-pick the model",
                    )
                )
            continue
        if slot is not None:
            field_map = _slot_attr(slot, "field_map") or {}
        else:
            prefix, _, name = slot_key.partition(":")
            proposal = (
                propose_endpoint_slot(descriptor, name)
                if prefix == "endpoint" and name
                else None
            )
            field_map = proposal.field_map if proposal is not None else None
        if field_map is None or missing_pointers(descriptor, field_map):
            if binding_kind(binding) != "inherit":
                dropped.append(
                    (
                        slot_key,
                        "slot_removed",
                        "slot_removed",
                        f"Model slot {slot_key!r} no longer exists",
                    )
                )
            continue
        kept[slot_key] = copy.deepcopy(binding)
    return kept


def _pop_pointer(document: Dict[str, Any], pointer: str) -> bool:
    """Remove the value at ``pointer``; prune objects it leaves empty in a section."""
    segments = split_pointer(pointer)
    if not segments:
        return False
    parents: List[Tuple[Dict[str, Any], str]] = []
    node: Any = document
    for segment in segments[:-1]:
        if not isinstance(node, dict) or segment not in node:
            return False
        parents.append((node, segment))
        node = node[segment]
    if not isinstance(node, dict) or segments[-1] not in node:
        return False
    del node[segments[-1]]
    # Prune emptied objects below the section root (``env_overrides`` itself stays).
    while len(parents) > 1 and node == {}:
        parent, key = parents.pop()
        if parents[0][1] != "env_overrides":
            break
        del parent[key]
        node = parent
    return True


def remap(
    config: Mapping[str, Any],
    from_schema: Optional[EvalEnvironmentSchema],
    to_schema: EvalEnvironmentSchema,
    *,
    to_slots: Optional[Sequence[Any]] = None,
    require_dataset: bool = False,
    evaluator_schema: Optional[Mapping[str, Any]] = None,
) -> RemapResult:
    """Re-map a §8.1 document authored on ``from_schema`` onto ``to_schema`` (§9.3).

    - keeps values whose pointer still exists (templated endpoint/role pointers
      included) and still validates on ``to_schema``;
    - drops the rest and lists them in ``dropped``;
    - leaves fields new in ``to_schema`` unset (inherit);
    - carries slot bindings forward by ``slot_key``: a binding whose slot is gone,
      ``stale`` or whose fields no longer resolve is dropped.

    ``to_slots`` are the target schema's slot rows or dicts (stale ones included, so
    they are reported as such); by default the detected slots of ``to_schema``.
    ``from_schema`` only supplies form pointers for the dropped list and may be
    ``None``. ``evaluator_schema`` is the environment's current evaluator schema
    (``None``: the static mirror); ``evaluator`` values it rejects are dropped too.
    Pure: nothing is read from or written to the database, and ``config``
    is not modified. Sweeps are not expanded; a document holding them keeps them and
    reports them in ``errors``.
    """
    if not isinstance(config, Mapping):
        raise ValueError("The config document must be an object")
    to_descriptor = descriptor_for_schema(to_schema)
    from_descriptor = (
        descriptor_for_schema(from_schema) if from_schema is not None else None
    )
    if to_slots is None:
        to_slots = [p.to_dict() for p in detect_model_slots(to_descriptor)]

    document = copy.deepcopy(dict(config))
    document["schema_hash"] = to_schema.schema_hash
    dropped: List[Dict[str, Any]] = []

    env_dropped: List[Tuple[str, str, str]] = []
    env = document.get("env_overrides")
    if isinstance(env, Mapping):
        document["env_overrides"] = (
            _remap_env(env, "", to_descriptor, env_dropped) or {}
        )
    for relative, reason, message in env_dropped:
        rule = "removed" if reason == "removed" else "type"
        dropped.append(
            _dropped(
                "/env_overrides" + relative,
                reason,
                rule,
                message,
                source_descriptor=from_descriptor,
            )
        )

    binding_dropped: List[Tuple[str, str, str, str]] = []
    bindings = document.get("slot_bindings")
    if isinstance(bindings, Mapping):
        document["slot_bindings"] = _remap_bindings(
            bindings, to_descriptor, to_slots, binding_dropped
        )
    for slot_key, reason, rule, message in binding_dropped:
        dropped.append(
            _dropped(
                _binding_pointer(slot_key),
                reason,
                rule,
                message,
                source_descriptor=from_descriptor,
                slot_key=slot_key,
            )
        )

    # Drop whatever still fails validation on the target; cross-field rules can
    # cascade (a dropped endpoint invalidates a role's reference), hence the loop.
    active_slots = [s for s in to_slots if _slot_status(s) != "stale"]
    errors: List[Dict[str, Any]] = []
    for attempt in range(_MAX_REMAP_PASSES + 1):
        result = validate_config_document(
            document,
            env_schema=to_schema.schema_json or {},
            slots=active_slots,
            descriptor=to_descriptor,
            schema_hash=to_schema.schema_hash,
            require_dataset=require_dataset,
            evaluator_schema=evaluator_schema,
        )
        errors = []
        if attempt == _MAX_REMAP_PASSES:
            errors = list(result.errors)  # out of passes: report what is left
            break
        progressed = False
        for error in result.errors:
            slot_key = error.get("slot_key")
            pointer = (
                _binding_pointer(slot_key)
                if slot_key is not None
                else error.get("pointer") or ""
            )
            removed = (
                error.get("rule") not in _UNFIXABLE_RULES
                and pointer not in _REMAP_ROOTS
                and _pop_pointer(document, pointer)
            )
            if not removed and error.get("rule") == "required" and slot_key is None:
                # A collection entry missing a key it needs (an endpoint whose model
                # binding was dropped) goes as a whole; other objects keep their
                # values and the missing key is reported.
                parent = json_pointer(split_pointer(pointer)[:-1])
                if _is_collection_item(to_descriptor, parent) and _pop_pointer(
                    document, parent
                ):
                    pointer, removed = parent, True
            if not removed:
                errors.append(error)
                continue
            progressed = True
            dropped.append(
                _dropped(
                    pointer,
                    "invalid",
                    error.get("rule") or "schema",
                    error.get("message") or "Invalid value",
                    source_descriptor=from_descriptor,
                    slot_key=slot_key,
                )
            )
        if not progressed:
            break
    return RemapResult(
        config=document,
        dropped=dropped,
        errors=errors,
        from_schema_hash=(
            from_schema.schema_hash
            if from_schema is not None
            else (config.get("schema_hash") or None)
        ),
        to_schema_hash=to_schema.schema_hash,
    )


def remap_version(
    db: Session,
    version: EvalConfigPresetVersion,
    to_schema: EvalEnvironmentSchema,
) -> RemapResult:
    """Re-map a stored version onto ``to_schema``; the version is left untouched."""
    from_schema = db.get(EvalEnvironmentSchema, version.schema_id)
    return remap(
        version.config or {},
        from_schema,
        to_schema,
        # The persisted slots, as ``prepare_config`` validates against them.
        to_slots=list_model_slots(db, to_schema.id),
        evaluator_schema=environment_evaluator_schema(
            db, db.get(EvalEnvironment, to_schema.environment_id)
        ),
    )


# --------------------------------------------------------------------------- payloads


def user_briefs(db: Session, ids: Iterable[Optional[str]]) -> Dict[str, Dict[str, str]]:
    """``{user_id: {"id", "name"}}`` for authors shown in the UI (no emails)."""
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = db.query(User.id, User.display_name, User.email).filter(User.id.in_(wanted))
    return {
        row.id: {
            "id": row.id,
            "name": (row.display_name or "").strip()
            or (row.email or "").split("@")[0]
            or row.id,
        }
        for row in rows.all()
    }


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
    authors = user_briefs(db, (v.published_by_user_id for v in versions))
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
                "published_by": authors.get(version.published_by_user_id or ""),
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
    created_by: Optional[Dict[str, str]] = None,
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
        "created_by": created_by,
        "created_at": to_api_timestamp(preset.created_at),
        "updated_at": to_api_timestamp(preset.updated_at),
    }
