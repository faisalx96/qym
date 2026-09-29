"""The §8.1 config document: materialize one combination and validate it.

Presets, experiment specs, best-run snapshots (``run_metadata.qym_config``) and the raw
JSON editor all share one JSON document (plan §8.1)::

    {
      "schema_hash": "…" | null,        # env schema the document was authored on
      "evaluator": {                     # EvaluatorInputs (guide §4.1)
        "dataset": "playground_set_v2",
        "dataset_version": null,
        "report_k": null,                # optional top-level override
        "config": {                      # EvaluatorRequestConfig (guide §4.2)
          "samples": 3, "report_k": 1, "max_concurrency": 5,
          "run_metadata": {"team": "rag"}   # user keys only; qym_* is reserved
        }
      },
      "slot_bindings": {                 # keyed by eval_model_slots slot_key
        "endpoint:primary": {"connection_id": "c-gpt4o"},
        "endpoint:fast": {"temporary": {"label": "mini trial", "model": "gpt-4o-mini",
                                        "base_url": "https://…",
                                        "api_key": {"$secret": "k1"}}},
        "flat:VIZ_LLM": {"inherit": true}      # or null / omitted: worker's own env
      },
      "env_overrides": {…},              # non-slot fields only, never secrets
      "links": [[…]],                    # optional, sweeps only (spec)
      "base_source": {…}                 # optional, informational (qym_config)
    }

Binding forms: ``{"connection_id": id}`` (extra display keys such as ``name`` and
``model`` are allowed, as ``qym_config`` stores them), ``{"temporary": {...}}`` whose
key is only ever ``{"$secret": ref}``, and ``{"inherit": true}``/``null`` (slot omitted).
An experiment spec may hold ``{"sweep": [...]}`` in place of any value; this module
validates **one** combination, so sweeps must be expanded first (``eval_sweeps``).

``materialize_job_body`` turns a document into a concrete ``EvalJobCreate`` body:
nulls and emptied objects are stripped (an unset value means "inherit"), and every
bound slot writes its ``field_map`` pointers through a *resolver*. The default resolver
writes placeholders (``{{qym:slot:<slot_key>:<role>}}``; temporary models write their
literal model/base_url). Dispatch (#11) passes a resolver that returns real values.
When ``endpoint:primary`` is bound, ``evaluator.model`` and ``evaluator.config.model``
are set to its model so the Models page groups runs correctly (§7.4).

``validate_config_document`` checks the document's structure, the reserved
``run_metadata`` prefix, bindings, literal secrets in ``env_overrides``, then validates
the materialized body with ``jsonschema`` Draft 2020-12 (the environment's
``env_overrides`` schema and the static ``EvaluatorInputs`` schema, D5) and mirrors the
service's cross-field rules: ``required_keys``/``min_items``/``endpoint_ref`` from the form
descriptor (``endpoints`` contains ``primary``; a role's ``endpoint`` exists) and the
effective ``report_k <= samples``. Schema errors caused by placeholders are ignored.

Every error is a JSON object::

    {
      "section": "env_overrides" | "evaluator" | "slot_bindings" | "document",
      "pointer": "/env_overrides/LLM_OVERRIDES/main/endpoint",  # concrete, document-relative
      "form_pointer": "/env_overrides/LLM_OVERRIDES/{role}/endpoint",
      "field": "/LLM_OVERRIDES/{role}/endpoint",   # key in the section descriptor, or null
      "params": {"role": "main"},                  # values of the template segments
      "rule": "schema" | "unknown_key" | "required" | "required_keys" | "min_items" |
              "endpoint_ref" | "report_k" | "reserved_key" | "secret_literal" |
              "binding" | "binding_conflict" | "sweep" | "type",
      "message": "…",
      "slot_key": "endpoint:primary"               # only for slot_bindings errors
    }

``field`` indexes the env descriptor (``build_form_descriptor``) for ``env_overrides``
and ``evaluator_config_descriptor()`` for ``/evaluator/config`` errors. Nothing here
touches the database; the module is pure and every result is JSON-serializable.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Mapping,
    Optional,
    Sequence,
    Union,
)

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError, best_match
from pydantic import BaseModel, ConfigDict, Field

from .eval_model_slots import propose_endpoint_slot, resolve_field
from .eval_schema_form import (
    build_form_descriptor,
    escape_pointer_segment,
    json_pointer,
    match_pointer,
    split_pointer,
)
from .eval_service_client import redact_text

# --------------------------------------------------------------------------- constants

DOCUMENT_KEYS = (
    "schema_hash",
    "evaluator",
    "slot_bindings",
    "env_overrides",
    "links",
    "base_source",
)
RESERVED_METADATA_PREFIX = "qym_"
PRIMARY_SLOT_KEY = "endpoint:primary"
# EvaluatorRequestConfig fields the platform owns (§8.4); shown read-only in the form.
PLATFORM_OWNED_CONFIG_FIELDS = (
    "run_name",
    "live_mode",
    "model",
    "models",
    "model_full",
)
DEFAULT_SAMPLES = 1

_PLACEHOLDER = re.compile(r"^\{\{qym:slot:(?P<slot>.+):(?P<role>[a-z_]+)\}\}$")
_SECTIONS = ("env_overrides", "evaluator", "slot_bindings")


# --------------------------------------------------------------------------- D5 models


class EvaluatorRequestConfig(BaseModel):
    """Static mirror of the service's ``EvaluatorRequestConfig`` (guide §4.2, D5)."""

    model_config = ConfigDict(extra="forbid", title="EvaluatorRequestConfig")

    run_name: Optional[str] = None
    task_name: Optional[str] = None
    max_concurrency: int = Field(10, ge=1)
    max_metric_concurrency: int = Field(1, ge=1)
    timeout: Optional[float] = Field(300, gt=0)
    metric_timeout: Optional[float] = Field(180.0, gt=0)
    metric_max_retries: int = Field(2, ge=0)
    max_retries: int = Field(2, ge=0)
    samples: int = Field(DEFAULT_SAMPLES, ge=1)
    report_k: Optional[int] = Field(None, ge=1)
    run_metadata: Dict[str, Any] = Field(default_factory=dict)
    git_branch: Optional[str] = None
    git_commit: Optional[str] = None
    model: Optional[str] = None
    model_full: Optional[str] = None
    # The service also accepts a comma-separated string and normalizes it.
    models: Optional[Union[List[str], str]] = None
    force_model_override: bool = False
    dataset_version: Optional[str] = None
    dataset_alias: Optional[str] = None
    live_mode: Literal["local", "platform", "auto"] = "platform"


class EvaluatorInputs(BaseModel):
    """``evaluator`` of the document and of ``EvalJobCreate`` (guide §4.1).

    Stricter than the service, which silently drops unknown keys (e.g. ``metrics``):
    the document rejects them so a typo never becomes a silent no-op.
    """

    model_config = ConfigDict(extra="forbid", title="EvaluatorInputs")

    dataset: str = Field(..., min_length=1)
    dataset_version: Optional[str] = None
    model: Optional[Union[str, List[str]]] = None
    config: EvaluatorRequestConfig = Field(default_factory=EvaluatorRequestConfig)
    report_k: Optional[int] = Field(None, ge=1)


@lru_cache(maxsize=1)
def _evaluator_config_descriptor() -> dict[str, Any]:
    descriptor = build_form_descriptor(EvaluatorRequestConfig.model_json_schema())
    for pointer, entry in descriptor["fields"].items():
        entry["read_only"] = entry["name"] in PLATFORM_OWNED_CONFIG_FIELDS
        if pointer == "/run_metadata":
            entry["reserved_prefix"] = RESERVED_METADATA_PREFIX
    return descriptor


def evaluator_config_descriptor() -> dict[str, Any]:
    """Form descriptor for ``evaluator.config`` (same shape as ``eval_schema_form``).

    Platform-owned fields carry ``read_only: true``; ``/run_metadata`` carries
    ``reserved_prefix: "qym_"``.
    """
    return copy.deepcopy(_evaluator_config_descriptor())


@lru_cache(maxsize=2)
def _evaluator_validator(require_dataset: bool) -> Draft202012Validator:
    schema = EvaluatorInputs.model_json_schema()
    if not require_dataset:
        schema["required"] = [k for k in schema.get("required", []) if k != "dataset"]
    return Draft202012Validator(schema)


# --------------------------------------------------------------------------- document


def empty_config_document(schema_hash: Optional[str] = None) -> dict[str, Any]:
    """A blank document (the "blank" base of the launch form)."""
    return {
        "schema_hash": schema_hash,
        "evaluator": {"dataset": None, "dataset_version": None, "config": {}},
        "slot_bindings": {},
        "env_overrides": {},
    }


def reserved_metadata_keys(document: Mapping[str, Any]) -> list[str]:
    """User ``run_metadata`` keys that use the reserved ``qym_`` prefix."""
    metadata = _get(document, ("evaluator", "config", "run_metadata"))
    if not isinstance(metadata, Mapping):
        return []
    return [k for k in metadata if _is_reserved(k)]


def _is_reserved(key: Any) -> bool:
    return isinstance(key, str) and key.lower().startswith(RESERVED_METADATA_PREFIX)


def is_sweep(value: Any) -> bool:
    return isinstance(value, Mapping) and set(value) == {"sweep"}


def find_sweeps(value: Any, pointer: str = "") -> list[str]:
    """Pointers of every ``{"sweep": [...]}`` value in a document."""
    if is_sweep(value):
        return [pointer]
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            found += find_sweeps(
                child, pointer + "/" + escape_pointer_segment(str(key))
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found += find_sweeps(child, f"{pointer}/{index}")
    return found


# --------------------------------------------------------------------------- bindings

BindingResolver = Callable[[str, Mapping[str, Any], str], Any]
"""``resolver(slot_key, binding, role) -> value``; ``None`` leaves the field unset."""


def slot_placeholder(slot_key: str, role: str) -> str:
    return "{{qym:slot:%s:%s}}" % (slot_key, role)


def is_placeholder(value: Any) -> bool:
    return isinstance(value, str) and _PLACEHOLDER.match(value) is not None


def find_placeholders(value: Any, pointer: str = "") -> list[str]:
    """Pointers of unresolved placeholders (dispatch must see none)."""
    if is_placeholder(value):
        return [pointer]
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            found += find_placeholders(
                child, pointer + "/" + escape_pointer_segment(str(key))
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found += find_placeholders(child, f"{pointer}/{index}")
    return found


def binding_kind(binding: Any) -> Optional[str]:
    """``connection``, ``temporary``, ``inherit`` or ``None`` when malformed."""
    if binding is None:
        return "inherit"
    if not isinstance(binding, Mapping):
        return None
    if set(binding) == {"inherit"} and binding["inherit"] is True:
        return "inherit"
    if "connection_id" in binding and "temporary" not in binding:
        return "connection"
    if "temporary" in binding and "connection_id" not in binding:
        return "temporary"
    return None


def placeholder_resolver(slot_key: str, binding: Mapping[str, Any], role: str) -> Any:
    """Default resolver: placeholders, except a temporary model's literal fields."""
    if binding_kind(binding) == "temporary":
        temporary = binding.get("temporary") or {}
        if role == "api_key":
            return (
                slot_placeholder(slot_key, role) if temporary.get("api_key") else None
            )
        return temporary.get(role)
    return slot_placeholder(slot_key, role)


def _binding_errors(slot_key: str, binding: Any) -> list[str]:
    kind = binding_kind(binding)
    if kind is None:
        return [
            (
                "Binding must be {connection_id}, {temporary} or {inherit: true}"
                if not is_sweep(binding)
                else "Sweeps must be expanded before validating a single combination"
            )
        ]
    if kind == "connection":
        cid = binding.get("connection_id")
        if not isinstance(cid, str) or not cid:
            return ["connection_id must be a non-empty string"]
    if kind == "temporary":
        temporary = binding.get("temporary")
        if not isinstance(temporary, Mapping):
            return ["temporary must be an object"]
        errors = []
        unknown = sorted(set(temporary) - {"label", "model", "base_url", "api_key"})
        if unknown:
            errors.append(f"Unknown temporary model keys: {', '.join(unknown)}")
        if not isinstance(temporary.get("model"), str) or not temporary["model"]:
            errors.append("A temporary model needs a model name")
        for key in ("label", "base_url"):
            if temporary.get(key) is not None and not isinstance(temporary[key], str):
                errors.append(f"temporary.{key} must be a string")
        key = temporary.get("api_key")
        if key is not None and not (
            isinstance(key, Mapping)
            and set(key) == {"$secret"}
            and isinstance(key["$secret"], str)
        ):
            errors.append('temporary.api_key must be a {"$secret": ref}, never a value')
        return errors
    return []


def _slot_index(slots: Sequence[Any]) -> dict[str, dict[str, Any]]:
    """Slot dicts (or ``EvalModelSlot`` rows) keyed by ``slot_key``."""
    index: dict[str, dict[str, Any]] = {}
    for slot in slots:
        if isinstance(slot, Mapping):
            key, field_map = slot.get("slot_key"), slot.get("field_map")
        else:
            key = getattr(slot, "slot_key", None)
            field_map = getattr(slot, "field_map", None)
        if key:
            index[key] = {"slot_key": key, "field_map": dict(field_map or {})}
    return index


def _slot_for(
    slot_key: str, index: dict[str, dict[str, Any]], descriptor: Mapping[str, Any]
) -> Optional[dict[str, Any]]:
    """A known slot, or an extra endpoint slot (``endpoint:fast``) the user added."""
    if slot_key in index:
        return index[slot_key]
    prefix, _, name = slot_key.partition(":")
    if prefix == "endpoint" and name:
        proposal = propose_endpoint_slot(descriptor, name)
        if proposal is not None:
            return {"slot_key": slot_key, "field_map": dict(proposal.field_map)}
    return None


# --------------------------------------------------------------------------- materialize


@dataclass
class _Materialized:
    body: dict[str, Any]
    # concrete env_overrides pointer -> slot_key, for values written by bindings
    bound: dict[str, str] = field(default_factory=dict)
    # document pointers (e.g. /evaluator/model) -> slot_key
    derived: dict[str, str] = field(default_factory=dict)
    errors: list[dict[str, Any]] = field(default_factory=list)


def _strip(value: Any) -> Any:
    """Drop ``None`` values and objects left empty; ``run_metadata`` is kept verbatim."""
    if isinstance(value, Mapping):
        out = {}
        for key, child in value.items():
            if key == "run_metadata" and isinstance(child, Mapping):
                out[key] = copy.deepcopy(dict(child))
                continue
            if child is None:
                continue
            stripped = _strip(child)
            if isinstance(child, Mapping) and not stripped:
                continue  # an emptied (or empty) object means "inherit"
            out[key] = stripped
        return out
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def _get(obj: Any, path: Sequence[str]) -> Any:
    for segment in path:
        if not isinstance(obj, Mapping):
            return None
        obj = obj.get(segment)
    return obj


def _set(obj: dict[str, Any], segments: Sequence[str], value: Any) -> Optional[str]:
    """Set a nested value creating objects; returns the blocking pointer on failure."""
    for depth, segment in enumerate(segments[:-1]):
        child = obj.get(segment)
        if child is None:
            child = obj[segment] = {}
        if not isinstance(child, dict):
            return json_pointer(list(segments[: depth + 1]))
        obj = child
    obj[segments[-1]] = value
    return None


def _materialize(
    document: Mapping[str, Any],
    slots: Sequence[Any],
    descriptor: Mapping[str, Any],
    resolver: BindingResolver,
) -> _Materialized:
    evaluator = document.get("evaluator")
    env = document.get("env_overrides")
    evaluator = _strip(evaluator) if isinstance(evaluator, Mapping) else {}
    env = _strip(env) if isinstance(env, Mapping) else {}
    result = _Materialized(body={"evaluator": evaluator, "env_overrides": env})

    bindings = document.get("slot_bindings")
    if not isinstance(bindings, Mapping):
        return result
    index = _slot_index(slots)
    for slot_key, binding in bindings.items():
        # A sweep is reported by validation; bind it with placeholders meanwhile so
        # its absence does not cause follow-up errors (e.g. a missing model).
        sweep = is_sweep(binding)
        kind = binding_kind(binding)
        if not sweep and (
            kind in (None, "inherit") or _binding_errors(slot_key, binding)
        ):
            continue
        slot = _slot_for(slot_key, index, descriptor)
        if slot is None:
            continue
        for role, pointer in slot["field_map"].items():
            if not isinstance(pointer, str) or not pointer:
                continue
            if sweep:
                value: Any = slot_placeholder(slot_key, role)
            else:
                value = resolver(slot_key, binding, role)
            if value is None:
                continue
            blocked = _set(env, split_pointer(pointer), value)
            if blocked is not None:
                result.errors.append(
                    _error(
                        "slot_bindings",
                        _binding_pointer(slot_key),
                        "binding",
                        f"Cannot write {pointer}: {blocked} is not an object",
                        slot_key=slot_key,
                    )
                )
                continue
            result.bound[pointer] = slot_key
            if slot_key == PRIMARY_SLOT_KEY and role == "model":
                evaluator["model"] = value
                config = evaluator.setdefault("config", {})
                if isinstance(config, dict):
                    config["model"] = value
                    result.derived["/evaluator/config/model"] = slot_key
                result.derived["/evaluator/model"] = slot_key
    return result


def materialize_job_body(
    document: Mapping[str, Any],
    slots: Sequence[Any] = (),
    *,
    descriptor: Optional[Mapping[str, Any]] = None,
    env_schema: Optional[Mapping[str, Any]] = None,
    resolver: BindingResolver = placeholder_resolver,
    user_id: Optional[str] = None,
    priority: Optional[str] = None,
) -> dict[str, Any]:
    """A concrete ``EvalJobCreate`` body for one combination (no validation).

    ``slots`` are slot dicts (``slot_to_dict``/``SlotProposal.to_dict``). ``descriptor``
    (or ``env_schema`` to build it) is only needed for endpoint slots missing from
    ``slots``. Malformed bindings are skipped; call ``validate_config_document`` first.
    """
    if descriptor is None:
        descriptor = build_form_descriptor(dict(env_schema)) if env_schema else {}
    body = _materialize(document, slots, descriptor, resolver).body
    if user_id is not None:
        body["user_id"] = user_id
    if priority is not None:
        body["priority"] = priority
    return body


# --------------------------------------------------------------------------- errors


def _binding_pointer(slot_key: str) -> str:
    return "/slot_bindings/" + escape_pointer_segment(slot_key)


def _error(
    section: str,
    pointer: str,
    rule: str,
    message: str,
    *,
    form_pointer: Optional[str] = None,
    field_pointer: Optional[str] = None,
    params: Optional[dict[str, str]] = None,
    slot_key: Optional[str] = None,
) -> dict[str, Any]:
    error = {
        "section": section,
        "pointer": pointer,
        "form_pointer": form_pointer if form_pointer is not None else pointer,
        "field": field_pointer,
        "params": params or {},
        "rule": rule,
        "message": message,
    }
    if slot_key is not None:
        error["slot_key"] = slot_key
    return error


def _form_location(
    descriptor: Mapping[str, Any], relative: str
) -> tuple[Optional[str], dict[str, str], str]:
    """(descriptor pointer, template params, matched concrete prefix) for a pointer.

    Walks up to the nearest ancestor the descriptor knows (an unknown key maps onto
    its parent object).
    """
    segments = split_pointer(relative) if relative else []
    while segments:
        concrete = json_pointer(segments)
        template = match_pointer(dict(descriptor), concrete)
        if template is not None:
            params = {}
            for seg, tmpl in zip(segments, split_pointer(template)):
                if len(tmpl) > 2 and tmpl[0] == "{" and tmpl[-1] == "}" and seg != tmpl:
                    params[tmpl[1:-1]] = seg
            return template, params, concrete
        segments = segments[:-1]
    return None, {}, ""


def _located(
    section_prefix: str,
    descriptor: Optional[Mapping[str, Any]],
    relative: str,
    section: str,
    rule: str,
    message: str,
) -> dict[str, Any]:
    pointer = section_prefix + relative
    if descriptor is None:
        return _error(section, pointer, rule, message)
    template, params, _ = _form_location(descriptor, relative)
    return _error(
        section,
        pointer,
        rule,
        message,
        form_pointer=section_prefix + (template or ""),
        field_pointer=template,
        params=params,
    )


def _locate(
    pointer: str,
    rule: str,
    message: str,
    env_descriptor: Mapping[str, Any],
    mat: Optional[_Materialized] = None,
) -> dict[str, Any]:
    """Build an error for a document pointer, mapped onto its form pointer."""
    if mat is not None:
        slot_key = mat.derived.get(pointer)
        if pointer.startswith("/env_overrides/"):
            relative = pointer[len("/env_overrides") :]
            slot_key = slot_key or mat.bound.get(relative)
        if slot_key is not None:
            binding_ptr = _binding_pointer(slot_key)
            return _error(
                "slot_bindings", binding_ptr, "binding", message, slot_key=slot_key
            )
    if _under(pointer, "/env_overrides"):
        relative = pointer[len("/env_overrides") :]
        return _located(
            "/env_overrides", env_descriptor, relative, "env_overrides", rule, message
        )
    if _under(pointer, "/evaluator/config"):
        relative = pointer[len("/evaluator/config") :]
        return _located(
            "/evaluator/config",
            _evaluator_config_descriptor(),
            relative,
            "evaluator",
            rule,
            message,
        )
    if _under(pointer, "/evaluator"):
        return _error("evaluator", pointer, rule, message)
    if _under(pointer, "/slot_bindings"):
        return _error("slot_bindings", pointer, rule, message)
    return _error("document", pointer, rule, message)


def _under(pointer: str, prefix: str) -> bool:
    return pointer == prefix or pointer.startswith(prefix + "/")


def _schema_errors(
    validator: Draft202012Validator, instance: Any, prefix: str
) -> list[tuple[str, str, str]]:
    """``(pointer, rule, message)`` for every jsonschema error, sorted by path."""
    out: list[tuple[str, str, str]] = []
    errors = sorted(
        validator.iter_errors(instance),
        key=lambda e: [str(p) for p in e.absolute_path],
    )
    for error in errors:
        out += _flatten(error, prefix)
    return out


def _flatten(error: ValidationError, prefix: str) -> list[tuple[str, str, str]]:
    path = prefix + json_pointer([str(p) for p in error.absolute_path])
    if error.validator in ("anyOf", "oneOf") and error.context:
        # A nullable field reports anyOf[X, null]; surface X's own error.
        branches: dict[Any, list[ValidationError]] = {}
        for sub in error.context:
            branch = sub.relative_schema_path[0] if sub.relative_schema_path else None
            branches.setdefault(branch, []).append(sub)
        real = [
            subs
            for subs in branches.values()
            if not all(
                e.validator == "type" and e.validator_value == "null" for e in subs
            )
        ]
        if len(real) == 1:
            out: list[tuple[str, str, str]] = []
            for sub in real[0]:
                out += _flatten(sub, prefix)
            return out
        if real:
            return _flatten(best_match(error.context), prefix)
    if error.validator == "additionalProperties" and isinstance(error.instance, dict):
        known = set((error.schema or {}).get("properties") or {})
        extras = [k for k in error.instance if k not in known]
        return [
            (
                path + "/" + escape_pointer_segment(k),
                "unknown_key",
                f"Unknown key {k!r}",
            )
            for k in extras
        ] or [(path, "unknown_key", error.message)]
    if error.validator == "required" and isinstance(error.instance, dict):
        missing = [k for k in error.validator_value if k not in error.instance]
        return [
            (path + "/" + escape_pointer_segment(k), "required", f"{k!r} is required")
            for k in missing
        ] or [(path, "required", error.message)]
    return [(path, "schema", error.message)]


# --------------------------------------------------------------------------- validation


@dataclass
class ConfigValidationResult:
    """Outcome of ``validate_config_document``; ``to_dict`` is JSON-serializable."""

    errors: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    body: Optional[dict[str, Any]]

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "errors": copy.deepcopy(self.errors),
            "warnings": copy.deepcopy(self.warnings),
            "body": copy.deepcopy(self.body),
        }

    def raise_for_errors(self) -> None:
        if self.errors:
            raise ConfigValidationError(self.errors)


class ConfigValidationError(ValueError):
    """A config document is invalid; ``errors`` holds the error objects."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors
        super().__init__("; ".join(f"{e['pointer']}: {e['message']}" for e in errors))


def _structure_errors(document: Any) -> list[dict[str, Any]]:
    if not isinstance(document, Mapping):
        return [_error("document", "", "type", "The config document must be an object")]
    errors = []
    for key in document:
        if key not in DOCUMENT_KEYS:
            errors.append(
                _error(
                    "document",
                    "/" + escape_pointer_segment(str(key)),
                    "unknown_key",
                    f"Unknown key {key!r}",
                )
            )
    schema_hash = document.get("schema_hash")
    if schema_hash is not None and not isinstance(schema_hash, str):
        errors.append(
            _error("document", "/schema_hash", "type", "schema_hash must be a string")
        )
    for section in _SECTIONS:
        value = document.get(section)
        if section == "evaluator" and value is None:
            errors.append(
                _error("evaluator", "/evaluator", "required", "evaluator is required")
            )
        elif value is not None and not isinstance(value, Mapping):
            errors.append(
                _error(section, "/" + section, "type", f"{section} must be an object")
            )
    return errors


def _rule_errors(
    env: Mapping[str, Any],
    descriptor: Mapping[str, Any],
    existing: set[str],
) -> list[tuple[str, str, str]]:
    """Mirror the descriptor's cross-field rules against materialized env_overrides."""
    out: list[tuple[str, str, str]] = []
    rules = descriptor.get("rules") or []
    for rule in rules:
        kind = rule.get("rule")
        pointer = rule.get("pointer") or ""
        if kind in ("required_keys", "min_items"):
            try:
                value = _get(env, split_pointer(pointer))
            except ValueError:
                continue
            if not isinstance(value, Mapping):
                continue
            doc_ptr = "/env_overrides" + pointer
            if kind == "required_keys":
                missing = [k for k in rule.get("keys") or [] if k not in value]
                if missing:
                    out.append(
                        (
                            doc_ptr,
                            "required_keys",
                            f"Must contain {', '.join(repr(k) for k in missing)}",
                        )
                    )
                    existing.add(doc_ptr)
            elif len(value) < int(rule.get("min") or 0) and doc_ptr not in existing:
                out.append(
                    (doc_ptr, "min_items", f"Needs at least {rule['min']} entries")
                )
                existing.add(doc_ptr)
    ref_rules = {
        r["pointer"]: r.get("collection")
        for r in rules
        if r.get("rule") == "endpoint_ref" and r.get("pointer") and r.get("collection")
    }
    if ref_rules:
        for pointer, value in _leaves(env, ""):
            template = match_pointer(dict(descriptor), pointer)
            if template not in ref_rules or not isinstance(value, str):
                continue  # non-strings are already a schema error
            collection = _get(env, split_pointer(ref_rules[template] or ""))
            keys = list(collection) if isinstance(collection, Mapping) else []
            if value not in keys:
                name = split_pointer(ref_rules[template])[-1]
                out.append(
                    (
                        "/env_overrides" + pointer,
                        "endpoint_ref",
                        f"{value!r} is not defined in {name}"
                        + (f" (defined: {', '.join(keys)})" if keys else ""),
                    )
                )
    return out


def _redacted_message(pointer: str, message: str, descriptor: Mapping[str, Any]) -> str:
    if pointer.startswith("/env_overrides/"):
        entry = resolve_field(descriptor, pointer[len("/env_overrides") :])
        if entry and entry.get("secret"):
            return "Invalid value for a secret field"
    # Messages about a parent object repr its children, keys included.
    return redact_text(message)


def _leaves(value: Any, pointer: str):
    if isinstance(value, Mapping):
        for key, child in value.items():
            yield from _leaves(child, pointer + "/" + escape_pointer_segment(str(key)))
    else:
        yield pointer, value


def _report_k_errors(evaluator: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    """``report_k <= samples`` for the effective (top-level wins) and config values.

    ``samples`` defaults to the service default (1) when unset. The config-level value
    is checked too because ``EvaluatorRequestConfig`` validates its own pair.
    """
    config = evaluator.get("config")
    config = config if isinstance(config, Mapping) else {}
    samples = config.get("samples", DEFAULT_SAMPLES)
    if not _is_int(samples):
        return []
    out = []
    for report_k, pointer in (
        (evaluator.get("report_k"), "/evaluator/report_k"),
        (config.get("report_k"), "/evaluator/config/report_k"),
    ):
        if _is_int(report_k) and report_k > samples:
            out.append(
                (
                    pointer,
                    "report_k",
                    f"report_k ({report_k}) must not exceed samples ({samples})",
                )
            )
    return out


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _secret_literal_errors(
    env: Any, descriptor: Mapping[str, Any]
) -> list[tuple[str, str, str]]:
    out = []
    if not isinstance(env, Mapping):
        return out
    for pointer, value in _leaves(env, ""):
        if value is None:
            continue
        entry = resolve_field(descriptor, pointer)
        if entry and entry.get("secret"):
            out.append(
                (
                    "/env_overrides" + pointer,
                    "secret_literal",
                    "Keys come from a slot binding and are never stored in the config",
                )
            )
    return out


def validate_config_document(
    document: Any,
    *,
    env_schema: Mapping[str, Any],
    slots: Sequence[Any] = (),
    descriptor: Optional[Mapping[str, Any]] = None,
    resolver: BindingResolver = placeholder_resolver,
    schema_hash: Optional[str] = None,
    require_dataset: bool = True,
) -> ConfigValidationResult:
    """Validate one combination of a config document for one environment.

    ``env_schema`` is the environment's ``env_overrides`` JSON Schema; ``descriptor`` its
    form descriptor (built when omitted); ``slots`` its model slots. ``schema_hash`` is
    the environment's current hash (a mismatch is a warning; re-mapping is §9.3).
    ``require_dataset=False`` suits presets that leave the dataset to the launch form.
    The result's ``body`` is the materialized ``EvalJobCreate`` (without ``user_id``),
    or ``None`` when there are errors.
    """
    errors = _structure_errors(document)
    warnings: list[dict[str, Any]] = []
    if errors and any(e["rule"] == "type" and e["pointer"] == "" for e in errors):
        return ConfigValidationResult(errors, warnings, None)
    if descriptor is None:
        descriptor = build_form_descriptor(dict(env_schema))

    doc_hash = document.get("schema_hash")
    if schema_hash and doc_hash and doc_hash != schema_hash:
        warnings.append(
            _error(
                "document",
                "/schema_hash",
                "schema_hash",
                "Authored on a different schema version; re-map before launching",
            )
        )

    located: list[tuple[str, str, str]] = []
    for pointer in find_sweeps(
        {k: document.get(k) for k in _SECTIONS if k in document}
    ):
        located.append(
            (
                pointer,
                "sweep",
                "Sweeps must be expanded before validating a single combination",
            )
        )
    sweep_ptrs = {p for p, _, _ in located}

    for key in reserved_metadata_keys(document):
        located.append(
            (
                "/evaluator/config/run_metadata/" + escape_pointer_segment(key),
                "reserved_key",
                f"run_metadata keys starting with {RESERVED_METADATA_PREFIX!r} "
                "are reserved for the platform",
            )
        )
    located += _secret_literal_errors(document.get("env_overrides"), descriptor)

    # Bindings.
    bindings = document.get("slot_bindings")
    env_doc = document.get("env_overrides")
    env_doc = env_doc if isinstance(env_doc, Mapping) else {}
    if isinstance(bindings, Mapping):
        index = _slot_index(slots)
        for slot_key, binding in bindings.items():
            ptr = _binding_pointer(str(slot_key))
            if ptr in sweep_ptrs:
                continue
            for message in _binding_errors(slot_key, binding):
                errors.append(
                    _error("slot_bindings", ptr, "binding", message, slot_key=slot_key)
                )
            if binding_kind(binding) in (None, "inherit"):
                continue
            slot = _slot_for(slot_key, index, descriptor)
            if slot is None:
                errors.append(
                    _error(
                        "slot_bindings",
                        ptr,
                        "binding",
                        f"Unknown model slot {slot_key!r}",
                        slot_key=slot_key,
                    )
                )
                continue
            for role, pointer in slot["field_map"].items():
                if not isinstance(pointer, str) or not pointer:
                    continue
                if resolve_field(descriptor, pointer) is None:
                    errors.append(
                        _error(
                            "slot_bindings",
                            ptr,
                            "binding",
                            f"Slot field {pointer} is not in this environment's "
                            "schema",
                            slot_key=slot_key,
                        )
                    )
                elif _get(env_doc, split_pointer(pointer)) is not None:
                    located.append(
                        (
                            "/env_overrides" + pointer,
                            "binding_conflict",
                            f"Set by the {slot_key!r} binding; remove this value or "
                            "unbind the slot",
                        )
                    )

    mat = _materialize(document, slots, descriptor, resolver)
    errors += mat.errors
    body = mat.body

    # jsonschema Draft 2020-12 against the materialized body.
    schema_located: list[tuple[str, str, str]] = []
    try:
        Draft202012Validator.check_schema(dict(env_schema))
        env_validator = Draft202012Validator(dict(env_schema))
    except SchemaError as exc:
        errors.append(
            _error(
                "env_overrides",
                "/env_overrides",
                "schema",
                f"The environment's schema is invalid: {exc.message}",
            )
        )
        env_validator = None
    if env_validator is not None:
        schema_located += _schema_errors(
            env_validator, body["env_overrides"], "/env_overrides"
        )
    schema_located += _schema_errors(
        _evaluator_validator(require_dataset), body["evaluator"], "/evaluator"
    )
    # Placeholders are not real values: ignore their pattern/enum/format errors.
    # jsonschema messages echo the value: never for a secret field.
    schema_located = [
        (p, r, _redacted_message(p, m, descriptor))
        for p, r, m in schema_located
        if not is_placeholder(_get(body, split_pointer(p)))
        and not any(p == s or p.startswith(s + "/") for s in sweep_ptrs)
    ]

    existing = {p for p, _, _ in schema_located}
    rule_located = _rule_errors(body["env_overrides"], descriptor, existing)
    rule_located += _report_k_errors(body["evaluator"])

    seen: set[tuple[str, str]] = set()
    tagged = [(item, None) for item in located]
    tagged += [(item, mat) for item in rule_located + schema_located]
    for (pointer, rule, message), origin in tagged:
        # Only materialized-body errors map back onto the binding that wrote them.
        error = _locate(pointer, rule, message, descriptor, origin)
        key = (error["pointer"], error["message"])
        if key in seen:
            continue
        seen.add(key)
        errors.append(error)
    # An invalid document may carry literal secrets or junk: never hand it on.
    return ConfigValidationResult(errors, warnings, None if errors else body)
