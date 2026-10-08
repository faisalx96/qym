"""The ``evaluator`` schema of an environment (guide v1.1 §3.4).

``GET /evals/evaluator/schema`` returns ``EvaluatorInputs.model_json_schema()``,
with ``EvaluatorRequestConfig`` under ``$defs``. It is the counterpart of
``GET /evals/env-overrides/schema`` and is handled the same way:

- **Storage.** Each distinct schema (sha256 of canonical JSON) is an immutable
  ``EvalEnvironmentEvaluatorSchema`` row; ``EvalEnvironment.current_evaluator_schema_id``
  points at the one in use. :func:`adopt_evaluator_schema` stores and adopts a
  fetched schema; a refresh that finds the same content only bumps ``fetched_at``.
- **Older services.** A service without the endpoint answers 404 and the client
  returns ``None``: the environment is marked ``unsupported`` and keeps no current
  evaluator schema. Everything then falls back to the platform's static
  ``EvaluatorRequestConfig`` mirror (``eval_config``), which matches guide v1.0. A
  fetch that fails for another reason (timeout, 5xx) leaves the stored state alone.
- **Form.** :func:`evaluator_config_descriptor_for` builds the ``evaluator.config``
  descriptor with ``eval_schema_form.build_form_descriptor`` (so any value and any
  schema shape is handled as for env_overrides, B20), marking platform-owned fields
  ``read_only``. :func:`evaluator_panel` is the launch form's "Evaluation inputs"
  contract for one or more environments (a union, like the env-overrides form).
- **Validation.** ``eval_config.validate_config_document`` takes the environment's
  evaluator schema (``evaluator_schema=``) and validates ``evaluator`` against it,
  closed: an ``evaluator.config`` key the environment does not declare is a
  ``not_in_environment`` error, as for env_overrides.
- **Presets.** ``eval_presets.remap`` validates against the current evaluator schema
  too, so a config key the service dropped is listed in ``dropped`` (B19's
  ``remap=current`` re-fetch).

The platform owns ``evaluator.config.versioning_details`` (B22): it is filled from
the experiment's "Versioning details" at launch, only for environments whose schema
declares it (:func:`accepts_config_key`).
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import EvalEnvironment, EvalEnvironmentEvaluatorSchema
from qym_platform.services.eval_schema_form import (
    DESCRIPTOR_VERSION,
    build_form_descriptor,
)

STATUS_UNKNOWN = "unknown"
STATUS_AVAILABLE = "available"
STATUS_UNSUPPORTED = "unsupported"

CONFIG_DEF = "EvaluatorRequestConfig"


def schema_hash(schema_json: Any) -> str:
    """sha256 of the canonical JSON (the same digest as env-overrides schemas)."""
    canonical = json.dumps(
        schema_json, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- pure


def _defs(schema: Mapping[str, Any]) -> Dict[str, Any]:
    defs = schema.get("$defs")
    if not isinstance(defs, Mapping):
        defs = schema.get("definitions")
    return dict(defs) if isinstance(defs, Mapping) else {}


def _ref_target(node: Any, defs: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """The object schema a ``config`` property points at (``$ref`` or nullable union)."""
    if not isinstance(node, Mapping):
        return None
    ref = node.get("$ref")
    if isinstance(ref, str):
        name = ref.rsplit("/", 1)[-1]
        target = defs.get(name)
        return dict(target) if isinstance(target, Mapping) else None
    for key in ("anyOf", "oneOf", "allOf"):
        branches = node.get(key)
        if isinstance(branches, list):
            for branch in branches:
                target = _ref_target(branch, defs)
                if target is not None:
                    return target
    if isinstance(node.get("properties"), Mapping):
        return dict(node)
    return None


def config_schema(schema_json: Mapping[str, Any]) -> Dict[str, Any]:
    """The standalone ``evaluator.config`` schema (``$defs`` kept for nested refs).

    Taken from ``properties.config`` (``anyOf[$ref, null]``), else
    ``$defs.EvaluatorRequestConfig``; an empty object schema when neither exists.
    """
    defs = _defs(schema_json)
    props = schema_json.get("properties")
    target = None
    if isinstance(props, Mapping):
        target = _ref_target(props.get("config"), defs)
    if target is None and isinstance(defs.get(CONFIG_DEF), Mapping):
        target = dict(defs[CONFIG_DEF])
    if target is None:
        target = {"type": "object", "properties": {}}
    out = copy.deepcopy(target)
    if defs:
        out["$defs"] = copy.deepcopy(defs)
    return out


def config_keys(schema_json: Optional[Mapping[str, Any]]) -> List[str]:
    """``evaluator.config`` keys a schema declares, in schema order."""
    if not isinstance(schema_json, Mapping):
        return []
    props = config_schema(schema_json).get("properties")
    return list(props) if isinstance(props, Mapping) else []


def accepts_config_key(schema_json: Optional[Mapping[str, Any]], key: str) -> bool:
    """Whether an environment's evaluator schema declares ``evaluator.config[key]``."""
    return key in config_keys(schema_json)


def evaluator_config_descriptor_for(
    schema_json: Mapping[str, Any],
    *,
    platform_owned: Sequence[str],
    reserved_prefix: str,
) -> Dict[str, Any]:
    """``evaluator.config`` form descriptor of a fetched schema (``eval_schema_form``)."""
    descriptor = build_form_descriptor(config_schema(schema_json))
    for pointer, entry in descriptor["fields"].items():
        entry["read_only"] = entry.get("parent") is None and entry["name"] in (
            platform_owned
        )
        if pointer == "/run_metadata":
            entry["reserved_prefix"] = reserved_prefix
    return descriptor


def input_fields(
    descriptor: Mapping[str, Any],
    *,
    preferred: Sequence[str],
    skip: Sequence[str],
) -> List[str]:
    """Editable top-level fields in display order.

    Known fields keep the platform's order (``preferred``); a field new in the schema
    goes right after its nearest preceding schema sibling that is shown (so
    ``metric_concurrency`` sits next to ``max_concurrency``), else at the end.
    """
    fields = descriptor.get("fields") or {}
    schema_order = [
        str(entry.get("name"))
        for pointer, entry in fields.items()
        if entry.get("parent") is None and entry.get("name") not in skip
    ]
    present = set(schema_order)
    out = [name for name in preferred if name in present]
    for index, name in enumerate(schema_order):
        if name in out:
            continue
        anchor = next(
            (prev for prev in reversed(schema_order[:index]) if prev in out), None
        )
        out.insert(out.index(anchor) + 1 if anchor else len(out), name)
    return out


# --------------------------------------------------------------------------- storage


def current_evaluator_schema(
    db: Session, env: EvalEnvironment
) -> Optional[EvalEnvironmentEvaluatorSchema]:
    """The environment's evaluator schema row, or ``None`` (static fallback)."""
    schema_id = getattr(env, "current_evaluator_schema_id", None)
    return db.get(EvalEnvironmentEvaluatorSchema, schema_id) if schema_id else None


def evaluator_schema_json(
    row: Optional[EvalEnvironmentEvaluatorSchema],
) -> Optional[Dict[str, Any]]:
    """The schema of a row, ``None`` for the static fallback."""
    if row is None or not isinstance(row.schema_json, dict):
        return None
    return row.schema_json


def descriptor_for_row(
    row: EvalEnvironmentEvaluatorSchema,
    *,
    platform_owned: Sequence[str],
    reserved_prefix: str,
) -> Dict[str, Any]:
    """The cached descriptor, rebuilt when missing or from an older version."""
    cached = row.form_descriptor
    if isinstance(cached, dict) and cached.get("descriptor_version") == (
        DESCRIPTOR_VERSION
    ):
        return copy.deepcopy(cached)
    return evaluator_config_descriptor_for(
        row.schema_json or {},
        platform_owned=platform_owned,
        reserved_prefix=reserved_prefix,
    )


def _store(
    db: Session, env: EvalEnvironment, schema_json: Dict[str, Any]
) -> EvalEnvironmentEvaluatorSchema:
    from qym_platform.services.eval_config import (  # cycle: eval_config imports us
        PLATFORM_OWNED_CONFIG_FIELDS,
        RESERVED_METADATA_PREFIX,
    )

    digest = schema_hash(schema_json)
    now = utc_now_naive()
    row = (
        db.query(EvalEnvironmentEvaluatorSchema)
        .filter(
            EvalEnvironmentEvaluatorSchema.environment_id == env.id,
            EvalEnvironmentEvaluatorSchema.schema_hash == digest,
        )
        .first()
    )
    if row is not None:
        row.fetched_at = now
        return row
    row = EvalEnvironmentEvaluatorSchema(
        environment_id=env.id,
        schema_hash=digest,
        schema_json=schema_json,
        form_descriptor=evaluator_config_descriptor_for(
            schema_json,
            platform_owned=PLATFORM_OWNED_CONFIG_FIELDS,
            reserved_prefix=RESERVED_METADATA_PREFIX,
        ),
        fetched_at=now,
        first_seen_at=now,
    )
    db.add(row)
    db.flush()
    return row


def adopt_evaluator_schema(
    db: Session, env: EvalEnvironment, schema_json: Optional[Dict[str, Any]]
) -> Tuple[
    Optional[EvalEnvironmentEvaluatorSchema],
    Optional[EvalEnvironmentEvaluatorSchema],
]:
    """Make a fetched evaluator schema current; ``None`` marks the service unsupported.

    Returns ``(current, previous)`` rows (either may be ``None``). Rows are never
    deleted: an environment whose service is downgraded keeps its history.
    """
    previous = current_evaluator_schema(db, env)
    if schema_json is None:
        env.current_evaluator_schema_id = None
        env.evaluator_schema_status = STATUS_UNSUPPORTED
        return None, previous
    row = _store(db, env, schema_json)
    env.current_evaluator_schema_id = row.id
    env.evaluator_schema_status = STATUS_AVAILABLE
    return row, previous


def evaluator_schema_diff(
    old: Optional[Mapping[str, Any]], new: Optional[Mapping[str, Any]]
) -> Dict[str, Any]:
    """Added/removed/retyped ``evaluator.config`` pointers between two descriptors.

    ``None`` stands for the static mirror's descriptor (an unsupported service).
    """
    old_fields = (old or {}).get("fields") or {}
    new_fields = (new or {}).get("fields") or {}
    added = [p for p in new_fields if p not in old_fields]
    removed = [p for p in old_fields if p not in new_fields]
    changed_types = []
    for pointer, entry in new_fields.items():
        before = old_fields.get(pointer)
        if before is not None and before.get("type") != entry.get("type"):
            changed_types.append(
                {"pointer": pointer, "from": before.get("type"), "to": entry.get("type")}
            )
    return {"added": added, "removed": removed, "changed_types": changed_types}


__all__ = [
    "STATUS_AVAILABLE",
    "STATUS_UNKNOWN",
    "STATUS_UNSUPPORTED",
    "accepts_config_key",
    "adopt_evaluator_schema",
    "config_keys",
    "config_schema",
    "current_evaluator_schema",
    "descriptor_for_row",
    "evaluator_config_descriptor_for",
    "evaluator_schema_diff",
    "evaluator_schema_json",
    "input_fields",
    "schema_hash",
]
