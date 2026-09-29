"""Detect, reconcile and confirm LLM model slots for an Evaluation Service schema.

A *model slot* groups the schema fields that together describe one LLM (model name,
base URL, API key) so the launch form can bind a project model to them (plan §7, R3).
Detection reads the form descriptor from ``eval_schema_form`` and never the raw JSON
Schema.

Detection (§7.1), driven by the one rule table ``DEFAULT_SLOT_RULES``:

1. **Structural:** every collection named in ``SlotRules.collections`` whose item has a
   ``model`` child (``LLM_OVERRIDES.endpoints``) yields ``endpoint:<key>`` slots. Keys
   come from the rule's and the descriptor's ``required_keys`` (``primary`` is always
   proposed and required) plus any ``extra_endpoints`` the caller asks for.
2. **Name-based:** top-level fields ending in a role suffix (``_MODEL``, ``_BASE_URL``,
   ``_API_KEY``, ...) are grouped by prefix into ``flat:<PREFIX>`` slots. A group needs a
   model field; URL and key are optional. ``<PREFIX>_TIMEOUT`` style fields become
   transport fields.

Slot shape (``SlotProposal.to_dict`` and ``slot_to_dict``)::

    {
      "slot_key": "endpoint:primary",
      "kind": "endpoint",                       # or "flat"
      "label": "Primary model",
      "field_map": {"model": "/LLM_OVERRIDES/endpoints/primary/model",
                    "base_url": "<ptr>" | None, "api_key": "<ptr>" | None},
      "transport_fields": {"timeout": "/LLM_OVERRIDES/endpoints/primary/timeout", ...},
      "required": True,
    }

Pointers are concrete (no ``{param}`` segments): they are what a binding writes into
``env_overrides``.

Schema drift (§7.3) is handled by ``sync_model_slots``: confirmed slots whose
``field_map`` pointers still exist are carried forward as ``confirmed``; the others
become ``stale`` unless a new candidate with the same key replaces them. New candidates
are ``proposed``; candidates the user already removed on the previous schema are not
proposed again unless required. ``confirm_model_slots`` stores the user's edited list.

Database helpers only ``flush``; the caller owns the transaction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Mapping, Optional, Sequence

from sqlalchemy.orm import Session

from ..datetime_utils import utc_now_naive
from ..db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalModelSlot,
    EvalModelSlotKind,
    EvalModelSlotStatus,
)
from .eval_schema_form import (
    DESCRIPTOR_VERSION,
    build_form_descriptor,
    escape_pointer_segment,
    expand_pointer,
    match_pointer,
    split_pointer,
)

# --------------------------------------------------------------------------- rules


@dataclass(frozen=True)
class SlotFieldRule:
    """One ``field_map`` role and how to recognise it."""

    role: str
    # Child names inside a structural entry (case-insensitive).
    names: tuple[str, ...]
    # Flat env-var suffixes, highest priority first.
    suffixes: tuple[str, ...]
    # Descriptor ``type`` values the field may have.
    types: tuple[str, ...] = ("string",)


@dataclass(frozen=True)
class SlotCollectionRule:
    """A map of LLM entries whose keys become structural slots."""

    name: str
    key_prefix: str
    required_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class SlotRules:
    fields: tuple[SlotFieldRule, ...]
    # Per-slot transport settings (child names, or ``<PREFIX>_<NAME>`` for flat slots).
    transport: tuple[str, ...]
    collections: tuple[SlotCollectionRule, ...]
    flat_prefix: str = "flat"

    @property
    def roles(self) -> tuple[str, ...]:
        return tuple(rule.role for rule in self.fields)

    def role_rule(self, role: str) -> Optional[SlotFieldRule]:
        return next((rule for rule in self.fields if rule.role == role), None)

    def kind_for_prefix(self, prefix: str) -> Optional[EvalModelSlotKind]:
        if prefix == self.flat_prefix:
            return EvalModelSlotKind.FLAT
        if any(c.key_prefix == prefix for c in self.collections):
            return EvalModelSlotKind.ENDPOINT
        return None


DEFAULT_SLOT_RULES = SlotRules(
    fields=(
        SlotFieldRule(
            "model",
            ("model", "model_name"),
            ("_MODEL_NAME", "_MODEL"),
            ("string", "enum"),
        ),
        SlotFieldRule(
            "base_url", ("base_url", "url"), ("_BASE_URL", "_URL", "_ENDPOINT")
        ),
        SlotFieldRule("api_key", ("api_key",), ("_API_KEY", "_KEY")),
    ),
    transport=(
        "timeout",
        "max_attempts",
        "max_connections",
        "max_keepalive",
        "connect_timeout",
    ),
    collections=(SlotCollectionRule("endpoints", "endpoint", ("primary",)),),
)

_SCALAR_TYPES = {"boolean", "integer", "number", "string", "enum"}
_ACRONYMS = {"ai", "api", "id", "llm", "rag", "sql", "url", "viz"}
_TEMPLATE_SEGMENT = re.compile(r"^\{.+\}$")
_MAX_SLOT_KEY = 200


# --------------------------------------------------------------------------- detection


@dataclass
class SlotProposal:
    slot_key: str
    kind: EvalModelSlotKind
    label: str
    field_map: dict[str, Optional[str]]
    transport_fields: dict[str, str] = field(default_factory=dict)
    required: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot_key": self.slot_key,
            "kind": self.kind.value,
            "label": self.label,
            "field_map": dict(self.field_map),
            "transport_fields": dict(self.transport_fields),
            "required": self.required,
        }


def _humanize(name: str) -> str:
    words = [w for w in re.split(r"[_\-\s.]+", name.strip()) if w]
    out = [w.upper() if w.lower() in _ACRONYMS else w.lower() for w in words]
    if out and out[0].islower():
        out[0] = out[0].capitalize()
    return " ".join(out) or name


def default_slot_label(slot_key: str) -> str:
    """``endpoint:primary`` → "Primary model", ``flat:VIZ_LLM`` → "VIZ LLM model"."""
    return f"{_humanize(slot_key.partition(':')[2])} model"


def _empty_field_map(rules: SlotRules) -> dict[str, Optional[str]]:
    return {role: None for role in rules.roles}


def _structural_role(name: str, rules: SlotRules) -> Optional[SlotFieldRule]:
    lowered = name.lower()
    return next((r for r in rules.fields if lowered in r.names), None)


def _endpoint_slots(
    descriptor: Mapping[str, Any],
    rules: SlotRules,
    extra_keys: Iterable[str],
) -> list[SlotProposal]:
    fields = descriptor.get("fields") or {}
    extra = [k for k in extra_keys if isinstance(k, str) and k]
    proposals: list[SlotProposal] = []
    for collection_rule in rules.collections:
        for entry in fields.values():
            if (
                entry.get("kind") != "collection"
                or entry.get("name") != collection_rule.name
                or entry.get("params")  # nested inside another template: no fixed keys
            ):
                continue
            item = fields.get(entry.get("item_pointer") or "")
            if not item or item.get("kind") != "object":
                continue
            role_ptrs: dict[str, str] = {}
            transport_ptrs: dict[str, str] = {}
            for child_ptr in item.get("children") or []:
                child = fields.get(child_ptr)
                if not child or child.get("kind") != "field":
                    continue
                rule = _structural_role(child["name"], rules)
                if rule and child.get("type") in rule.types:
                    role_ptrs.setdefault(rule.role, child_ptr)
                elif child["name"] in rules.transport:
                    transport_ptrs[child["name"]] = child_ptr
            if "model" not in role_ptrs:
                continue
            required = list(
                dict.fromkeys(
                    list(collection_rule.required_keys)
                    + list(entry.get("required_keys") or [])
                )
            )
            param = entry["key_param"]
            for key in dict.fromkeys(required + extra):
                values = {param: key}
                field_map = _empty_field_map(rules)
                field_map.update(
                    {r: expand_pointer(p, values) for r, p in role_ptrs.items()}
                )
                slot_key = f"{collection_rule.key_prefix}:{key}"
                proposals.append(
                    SlotProposal(
                        slot_key=slot_key,
                        kind=EvalModelSlotKind.ENDPOINT,
                        label=default_slot_label(slot_key),
                        field_map=field_map,
                        transport_fields={
                            n: expand_pointer(p, values)
                            for n, p in transport_ptrs.items()
                        },
                        required=key in required,
                    )
                )
    return proposals


def _flat_slots(descriptor: Mapping[str, Any], rules: SlotRules) -> list[SlotProposal]:
    fields = descriptor.get("fields") or {}
    suffixes = sorted(
        (
            (suffix, rule, priority)
            for rule in rules.fields
            for priority, suffix in enumerate(rule.suffixes)
        ),
        key=lambda item: -len(item[0]),
    )
    # prefix -> role -> (suffix priority, pointer)
    groups: dict[str, dict[str, tuple[int, str]]] = {}
    root_by_name: dict[str, dict[str, Any]] = {}
    for pointer in descriptor.get("root") or []:
        entry = fields.get(pointer)
        if not entry or entry.get("kind") != "field":
            continue
        name = entry["name"]
        root_by_name[name.upper()] = entry
        upper = name.upper()
        for suffix, rule, priority in suffixes:
            if upper.endswith(suffix) and len(upper) > len(suffix):
                if entry.get("type") in rule.types:
                    prefix = name[: -len(suffix)]
                    roles = groups.setdefault(prefix, {})
                    current = roles.get(rule.role)
                    if current is None or priority < current[0]:
                        roles[rule.role] = (priority, pointer)
                break
    proposals = []
    for prefix, roles in groups.items():
        if "model" not in roles:
            continue
        field_map = _empty_field_map(rules)
        field_map.update({role: ptr for role, (_, ptr) in roles.items()})
        transport = {}
        for name in rules.transport:
            entry = root_by_name.get(f"{prefix}_{name}".upper())
            if entry and entry.get("type") in _SCALAR_TYPES:
                transport[name] = entry["pointer"]
        slot_key = f"{rules.flat_prefix}:{prefix}"
        proposals.append(
            SlotProposal(
                slot_key=slot_key,
                kind=EvalModelSlotKind.FLAT,
                label=default_slot_label(slot_key),
                field_map=field_map,
                transport_fields=transport,
            )
        )
    return proposals


def detect_model_slots(
    descriptor: Mapping[str, Any],
    *,
    extra_endpoints: Iterable[str] = (),
    rules: SlotRules = DEFAULT_SLOT_RULES,
) -> list[SlotProposal]:
    """Propose slots for a form descriptor: endpoint slots first, then flat ones."""
    proposals: dict[str, SlotProposal] = {}
    for proposal in _endpoint_slots(descriptor, rules, extra_endpoints) + _flat_slots(
        descriptor, rules
    ):
        proposals.setdefault(proposal.slot_key, proposal)
    return list(proposals.values())


def propose_endpoint_slot(
    descriptor: Mapping[str, Any],
    endpoint: str,
    *,
    rules: SlotRules = DEFAULT_SLOT_RULES,
) -> Optional[SlotProposal]:
    """Build the slot for an extra endpoint key (e.g. ``fast``) the user adds."""
    return next(
        (
            p
            for p in _endpoint_slots(descriptor, rules, [endpoint])
            if p.slot_key.partition(":")[2] == endpoint
        ),
        None,
    )


# --------------------------------------------------------------------------- pointers


def slot_pointers(
    field_map: Mapping[str, Any], transport_fields: Optional[Mapping[str, Any]] = None
) -> list[str]:
    """Every non-null pointer a slot fills."""
    pointers = [p for p in (field_map or {}).values() if isinstance(p, str) and p]
    pointers += [
        p for p in (transport_fields or {}).values() if isinstance(p, str) and p
    ]
    return pointers


def resolve_field(descriptor: Mapping[str, Any], pointer: Any) -> Optional[dict]:
    """Descriptor entry of a concrete leaf-field pointer, else ``None``."""
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        return None
    try:
        segments = split_pointer(pointer)
    except ValueError:
        return None
    if any(_TEMPLATE_SEGMENT.match(s) for s in segments):
        return None
    template = match_pointer(dict(descriptor), pointer)
    entry = (descriptor.get("fields") or {}).get(template) if template else None
    if not entry or entry.get("kind") != "field":
        return None
    return entry


def missing_pointers(
    descriptor: Mapping[str, Any],
    field_map: Mapping[str, Any],
    transport_fields: Optional[Mapping[str, Any]] = None,
) -> list[str]:
    """Pointers of a slot that no longer resolve to a field of ``descriptor``."""
    return [
        p
        for p in slot_pointers(field_map, transport_fields)
        if resolve_field(descriptor, p) is None
    ]


# --------------------------------------------------------------------------- validation


class SlotValidationError(ValueError):
    """A confirmation payload is invalid; ``errors`` lists ``{slot_key, message}``."""

    def __init__(self, errors: list[dict[str, Optional[str]]]) -> None:
        self.errors = errors
        super().__init__("; ".join(e["message"] or "" for e in errors))


def validate_slots(
    descriptor: Mapping[str, Any],
    slots: Sequence[Mapping[str, Any]],
    *,
    rules: SlotRules = DEFAULT_SLOT_RULES,
) -> list[SlotProposal]:
    """Normalize user-edited slots against ``descriptor``; raise ``SlotValidationError``.

    Each slot needs ``slot_key`` (``<prefix>:<name>``) and ``field_map`` with a model
    pointer; ``label``, ``kind`` and ``transport_fields`` are optional. Pointers must be
    concrete leaf fields of the schema, no pointer may belong to two slots and required
    slots (``endpoint:primary``) cannot be removed.
    """
    errors: list[dict[str, Optional[str]]] = []
    fields = descriptor.get("fields") or {}
    detected = {p.slot_key: p for p in detect_model_slots(descriptor, rules=rules)}
    collections = {
        c.key_prefix: [
            e["pointer"]
            for e in fields.values()
            if e.get("kind") == "collection"
            and e.get("name") == c.name
            and not e.get("params")
        ]
        for c in rules.collections
    }
    used: dict[str, str] = {}
    out: list[SlotProposal] = []
    seen: set[str] = set()

    def fail(key: Optional[str], message: str) -> None:
        errors.append({"slot_key": key, "message": message})

    if not isinstance(slots, (list, tuple)):
        raise SlotValidationError(
            [{"slot_key": None, "message": "slots must be a list"}]
        )
    for raw in slots:
        if not isinstance(raw, Mapping):
            fail(None, "each slot must be an object")
            continue
        key = raw.get("slot_key")
        if not isinstance(key, str) or not key.strip():
            fail(None, "slot_key is required")
            continue
        key = key.strip()
        prefix, sep, name = key.partition(":")
        kind = rules.kind_for_prefix(prefix) if sep else None
        if kind is None or not name or len(key) > _MAX_SLOT_KEY:
            fail(key, f"invalid slot_key {key!r}")
            continue
        if raw.get("kind") not in (None, kind.value):
            fail(key, f"slot {key} must have kind {kind.value!r}")
            continue
        if key in seen:
            fail(key, f"duplicate slot {key}")
            continue
        seen.add(key)

        field_map_raw = raw.get("field_map")
        if not isinstance(field_map_raw, Mapping):
            fail(key, f"slot {key}: field_map must be an object")
            continue
        field_map = _empty_field_map(rules)
        for role, pointer in field_map_raw.items():
            rule = rules.role_rule(role)
            if rule is None:
                fail(key, f"slot {key}: unknown field role {role!r}")
                continue
            if pointer in (None, ""):
                continue
            entry = resolve_field(descriptor, pointer)
            if entry is None:
                fail(key, f"slot {key}: {pointer!r} is not a field of this schema")
            elif entry.get("type") not in rule.types:
                fail(key, f"slot {key}: {pointer} cannot hold a {role}")
            else:
                field_map[role] = pointer
        if not field_map.get("model"):
            fail(key, f"slot {key} needs a model field")

        transport_raw = raw.get("transport_fields") or {}
        transport: dict[str, str] = {}
        if not isinstance(transport_raw, Mapping):
            fail(key, f"slot {key}: transport_fields must be an object")
        else:
            for name_, pointer in transport_raw.items():
                entry = resolve_field(descriptor, pointer)
                if not isinstance(name_, str) or not name_:
                    fail(key, f"slot {key}: invalid transport field name")
                elif entry is None or entry.get("type") not in _SCALAR_TYPES:
                    fail(key, f"slot {key}: {pointer!r} is not a scalar schema field")
                else:
                    transport[name_] = pointer

        if kind == EvalModelSlotKind.ENDPOINT:
            bases = [
                f"{c}/{escape_pointer_segment(name)}/"
                for c in collections.get(prefix, [])
            ]
            outside = [
                p
                for p in slot_pointers(field_map, transport)
                if not any(p.startswith(b) for b in bases)
            ]
            if outside:
                fail(key, f"slot {key}: {outside[0]} is outside endpoint {name!r}")

        own = slot_pointers(field_map, transport)
        if len(set(own)) != len(own):
            fail(key, f"slot {key} uses the same field twice")
        for pointer in own:
            if pointer in used and used[pointer] != key:
                fail(key, f"{pointer} is used by both {used[pointer]} and {key}")
            used.setdefault(pointer, key)

        label = raw.get("label")
        label = label.strip() if isinstance(label, str) else ""
        proposal = detected.get(key)
        out.append(
            SlotProposal(
                slot_key=key,
                kind=kind,
                label=(
                    label or (proposal.label if proposal else default_slot_label(key))
                )[:200],
                field_map=field_map,
                transport_fields=transport,
                required=bool(proposal and proposal.required),
            )
        )
    for key, proposal in detected.items():
        if proposal.required and key not in seen:
            fail(key, f"slot {key} is required and cannot be removed")
    if errors:
        raise SlotValidationError(errors)
    return out


# --------------------------------------------------------------------------- persistence


def descriptor_for_schema(schema: EvalEnvironmentSchema) -> dict[str, Any]:
    """The cached form descriptor, rebuilt when missing or from an older version."""
    cached = schema.form_descriptor
    if (
        isinstance(cached, dict)
        and cached.get("descriptor_version") == DESCRIPTOR_VERSION
    ):
        return cached
    return build_form_descriptor(schema.schema_json or {})


def _order(slot: Any) -> tuple[int, int, str]:
    kind = slot.kind.value if hasattr(slot.kind, "value") else slot.kind
    return (0 if kind == "endpoint" else 1, 0 if slot.required else 1, slot.slot_key)


def list_model_slots(session: Session, schema_id: str) -> list[EvalModelSlot]:
    """Slots of one schema: endpoint slots (required first), then flat slots."""
    rows = session.query(EvalModelSlot).filter(EvalModelSlot.schema_id == schema_id)
    return sorted(rows.all(), key=_order)


def slot_to_dict(slot: EvalModelSlot) -> dict[str, Any]:
    return {
        "id": slot.id,
        "environment_id": slot.environment_id,
        "schema_id": slot.schema_id,
        "slot_key": slot.slot_key,
        "kind": slot.kind.value,
        "label": slot.label,
        "field_map": dict(slot.field_map or {}),
        "transport_fields": dict(slot.transport_fields or {}),
        "required": bool(slot.required),
        "status": slot.status.value,
        "confirmed_by_user_id": slot.confirmed_by_user_id,
        "confirmed_at": slot.confirmed_at.isoformat() if slot.confirmed_at else None,
    }


def slots_need_confirmation(slots: Iterable[EvalModelSlot]) -> bool:
    """True while any slot is proposed or stale (the "Group LLM settings" banner)."""
    return any(s.status != EvalModelSlotStatus.CONFIRMED for s in slots)


@dataclass
class _Spec:
    proposal: SlotProposal
    status: EvalModelSlotStatus
    confirmed_by_user_id: Optional[str] = None
    confirmed_at: Optional[datetime] = None


def _proposal_of(slot: EvalModelSlot) -> SlotProposal:
    return SlotProposal(
        slot_key=slot.slot_key,
        kind=slot.kind,
        label=slot.label,
        field_map=dict(slot.field_map or {}),
        transport_fields=dict(slot.transport_fields or {}),
        required=bool(slot.required),
    )


def _write_slots(
    session: Session,
    environment: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    specs: list[_Spec],
) -> list[EvalModelSlot]:
    existing = {s.slot_key: s for s in list_model_slots(session, schema.id)}
    wanted = {spec.proposal.slot_key for spec in specs}
    for key, stale_row in existing.items():
        if key not in wanted:
            session.delete(stale_row)
    session.flush()
    for spec in specs:
        p = spec.proposal
        row = existing.get(p.slot_key)
        if row is None:
            row = EvalModelSlot(
                environment_id=environment.id, schema_id=schema.id, slot_key=p.slot_key
            )
            session.add(row)
        row.kind = p.kind
        row.label = p.label
        row.field_map = dict(p.field_map)
        row.transport_fields = dict(p.transport_fields)
        row.required = p.required
        row.status = spec.status
        row.confirmed_by_user_id = spec.confirmed_by_user_id
        row.confirmed_at = spec.confirmed_at
    session.flush()
    return list_model_slots(session, schema.id)


def _latest_schema_with_slots(
    session: Session, environment_id: str, exclude: str
) -> Optional[str]:
    row = (
        session.query(EvalEnvironmentSchema.id)
        .join(EvalModelSlot, EvalModelSlot.schema_id == EvalEnvironmentSchema.id)
        .filter(
            EvalEnvironmentSchema.environment_id == environment_id,
            EvalEnvironmentSchema.id != exclude,
        )
        .order_by(
            EvalEnvironmentSchema.first_seen_at.desc(), EvalEnvironmentSchema.id.desc()
        )
        .first()
    )
    return row[0] if row else None


def _reconcile(
    source: list[EvalModelSlot],
    previous_descriptor: Optional[Mapping[str, Any]],
    descriptor: Mapping[str, Any],
    rules: SlotRules,
) -> list[_Spec]:
    proposals = detect_model_slots(descriptor, rules=rules)
    by_key = {p.slot_key: p for p in proposals}
    result: dict[str, _Spec] = {}
    for slot in source:
        carried = _proposal_of(slot)
        candidate = by_key.get(slot.slot_key)
        carried.required = carried.required or bool(candidate and candidate.required)
        gone = missing_pointers(descriptor, carried.field_map)
        if not gone:
            # Drop vanished transport fields and pick up newly detected ones.
            transport = {
                n: p
                for n, p in carried.transport_fields.items()
                if resolve_field(descriptor, p) is not None
            }
            for name, pointer in (
                candidate.transport_fields if candidate else {}
            ).items():
                transport.setdefault(name, pointer)
            carried.transport_fields = transport
        if slot.status == EvalModelSlotStatus.PROPOSED:
            if not gone:
                result[slot.slot_key] = _Spec(carried, EvalModelSlotStatus.PROPOSED)
            continue
        # Confirmed stays confirmed while its fields exist; a stale slot whose fields
        # came back (e.g. a reverted schema) is confirmed again.
        status = EvalModelSlotStatus.STALE if gone else EvalModelSlotStatus.CONFIRMED
        result[slot.slot_key] = _Spec(
            carried, status, slot.confirmed_by_user_id, slot.confirmed_at
        )

    previous_keys = (
        {p.slot_key for p in detect_model_slots(previous_descriptor, rules=rules)}
        if previous_descriptor is not None
        else set()
    )
    used = {
        ptr
        for spec in result.values()
        if spec.status != EvalModelSlotStatus.STALE
        for ptr in slot_pointers(spec.proposal.field_map)
    }
    for proposal in proposals:
        current = result.get(proposal.slot_key)
        if current is not None:
            if current.status == EvalModelSlotStatus.STALE:
                # A new candidate supersedes the stale slot; keep the user's label.
                proposal.label = current.proposal.label or proposal.label
                proposal.required = proposal.required or current.proposal.required
                result[proposal.slot_key] = _Spec(
                    proposal, EvalModelSlotStatus.PROPOSED
                )
            continue
        if not proposal.required:
            # Removed by the user on the previous schema, or regrouped elsewhere.
            if proposal.slot_key in previous_keys:
                continue
            if used.intersection(slot_pointers(proposal.field_map)):
                continue
        result[proposal.slot_key] = _Spec(proposal, EvalModelSlotStatus.PROPOSED)
    return list(result.values())


def sync_model_slots(
    session: Session,
    environment: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    *,
    previous_schema_id: Optional[str] = None,
    rules: SlotRules = DEFAULT_SLOT_RULES,
) -> list[EvalModelSlot]:
    """Create or reconcile the slots of ``schema`` (run on every new schema hash).

    The slots are carried over from ``previous_schema_id``, which defaults to
    ``environment.current_schema_id`` when that is another schema, so call this before
    moving ``current_schema_id`` or pass the previous id explicitly. If the environment
    has no earlier slots, every candidate is proposed. Re-syncing a schema against
    itself keeps its slots and only restores missing required ones. Only flushes.
    """
    descriptor = descriptor_for_schema(schema)
    existing = list_model_slots(session, schema.id)
    source_id = previous_schema_id
    if source_id is None:
        if environment.current_schema_id and environment.current_schema_id != schema.id:
            source_id = environment.current_schema_id
        elif not existing:
            source_id = _latest_schema_with_slots(session, environment.id, schema.id)

    source_schema: Optional[EvalEnvironmentSchema] = None
    source: list[EvalModelSlot] = []
    if source_id and source_id != schema.id:
        source_schema = session.get(EvalEnvironmentSchema, source_id)
        if source_schema is not None and source_schema.environment_id == environment.id:
            source = list_model_slots(session, source_id)

    if source and source_schema is not None:
        specs = _reconcile(
            source, descriptor_for_schema(source_schema), descriptor, rules
        )
    else:
        specs = [
            _Spec(_proposal_of(s), s.status, s.confirmed_by_user_id, s.confirmed_at)
            for s in existing
        ]
        present = {s.slot_key for s in existing}
        for proposal in detect_model_slots(descriptor, rules=rules):
            if proposal.slot_key not in present and (not existing or proposal.required):
                specs.append(_Spec(proposal, EvalModelSlotStatus.PROPOSED))
    return _write_slots(session, environment, schema, specs)


def confirm_model_slots(
    session: Session,
    environment: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    slots: Sequence[Mapping[str, Any]],
    *,
    user_id: Optional[str],
    rules: SlotRules = DEFAULT_SLOT_RULES,
) -> list[EvalModelSlot]:
    """Replace the slots of ``schema`` with the user's edited list, all ``confirmed``.

    Slots left out are removed (their fields stay plain inputs). An already confirmed
    slot submitted unchanged keeps its original ``confirmed_by``/``confirmed_at``.
    Raises ``SlotValidationError``; only flushes.
    """
    if schema.environment_id != environment.id:
        raise ValueError("schema does not belong to this environment")
    specs_in = validate_slots(descriptor_for_schema(schema), slots, rules=rules)
    existing = {s.slot_key: s for s in list_model_slots(session, schema.id)}
    now = utc_now_naive()
    specs = []
    for proposal in specs_in:
        row = existing.get(proposal.slot_key)
        if row is not None:
            proposal.required = proposal.required or bool(row.required)
        if (
            row is not None
            and row.status == EvalModelSlotStatus.CONFIRMED
            and row.label == proposal.label
            and dict(row.field_map or {}) == proposal.field_map
            and dict(row.transport_fields or {}) == proposal.transport_fields
        ):
            specs.append(
                _Spec(
                    proposal,
                    EvalModelSlotStatus.CONFIRMED,
                    row.confirmed_by_user_id,
                    row.confirmed_at,
                )
            )
        else:
            specs.append(_Spec(proposal, EvalModelSlotStatus.CONFIRMED, user_id, now))
    return _write_slots(session, environment, schema, specs)
