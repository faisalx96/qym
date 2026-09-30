"""Sweep expansion for experiment specs (plan §8.1, §8.3; issue #32).

An experiment spec is a §8.1 config document in which any scalar value, or a whole
slot binding, may be ``{"sweep": [v1, v2, …]}``. A top-level ``"links"`` list of
pointer groups declares **linked groups**::

    {
      "slot_bindings": {"endpoint:primary": {"sweep": [{"connection_id": "a"},
                                                       {"connection_id": "b"}]}},
      "env_overrides": {"MILVUS_SEARCH_THRESHOLD": {"sweep": [0.5, 0.7]},
                        "LLM_OVERRIDES": {"main": {"temperature": {"sweep": [0.2, 0.7]}}}},
      "links": [["/slot_bindings/endpoint:primary",
                 "/env_overrides/LLM_OVERRIDES/main/temperature"]]
    }

Expansion (``expand``):

- Every unlinked sweep is one **axis**. A linked group zips its members (their lists
  must have equal length) and is **one** axis.
- Axes are ordered by section (``slot_bindings``, ``evaluator``, ``env_overrides``)
  then document order; a linked group sits at its first member. Combinations are the
  Cartesian product with the last axis varying fastest, and ``combo_index`` is the
  position in that product: deterministic for a given spec.
- Jobs = ``∏ axis lengths × environments``. Over ``QYM_EVAL_SWEEP_MAX_JOBS`` (default
  64) the plan carries a ``sweep_cap`` error and no combinations are built.
- Each ``Combo`` holds the concrete one-combination document (sweeps resolved,
  ``links`` dropped) that ``eval_config.validate_config_document`` validates per
  environment, a short deterministic label (``primary=gpt-4o thr=0.7``) and secret-free
  ``params``.

Sweep values must be scalars (``null`` = inherit), except at a slot binding
(``/slot_bindings/<slot_key>``), where each value is a binding. Errors use the
``eval_config`` error shape and never echo values. Temporary-model key refs
(``{"$secret": ref}``) never reach labels, ``params`` or ``axes`` summaries.
"""

from __future__ import annotations

import copy
import itertools
import json
import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from ..db.models import ProjectLlmConnection
from ..settings import PlatformSettings
from .eval_config import _error, binding_kind, find_sweeps, is_sweep
from .eval_schema_form import escape_pointer_segment, split_pointer

DEFAULT_MAX_JOBS = 64
LABEL_MAX = 120
RUN_NAME_MAX = 200
SWEEP_SECTIONS = ("slot_bindings", "evaluator", "env_overrides")

# Short keys for common field names (the label is "key=value …").
_ABBREVIATIONS = {
    "threshold": "thr",
    "temperature": "temp",
    "concurrency": "conc",
    "max_concurrency": "conc",
    "attempts": "att",
    "max_attempts": "att",
    "timeout": "timeout",
    "samples": "samples",
    "report_k": "k",
}


def max_sweep_jobs(settings: Optional[PlatformSettings] = None) -> int:
    return (settings or PlatformSettings()).eval_sweep_max_jobs


# --------------------------------------------------------------------------- types


@dataclass(frozen=True)
class SweepAxis:
    """One grid axis: a single sweep, or a linked group zipped together."""

    pointers: Tuple[str, ...]
    steps: Tuple[Tuple[Any, ...], ...]  # steps[i][j] = value of pointers[j] at step i

    @property
    def linked(self) -> bool:
        return len(self.pointers) > 1

    def __len__(self) -> int:
        return len(self.steps)

    def summary(self) -> Dict[str, Any]:
        """Secret-free description for previews."""
        return {
            "pointers": list(self.pointers),
            "linked": self.linked,
            "length": len(self.steps),
            "values": [[redact_value(v) for v in step] for step in self.steps],
        }


@dataclass
class Combo:
    index: int
    values: Dict[str, Any]  # pointer -> raw value (may hold secret refs: internal)
    document: Dict[str, Any]  # one-combination document (may hold secret refs)
    label: str

    @property
    def params(self) -> Dict[str, Any]:
        """The swept values, secret-free (``{pointer: value}``)."""
        return {p: redact_value(v) for p, v in self.values.items()}


@dataclass
class SweepPlan:
    axes: List[SweepAxis] = field(default_factory=list)
    combos: List[Combo] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    combo_count: int = 0
    job_count: int = 0
    max_jobs: int = DEFAULT_MAX_JOBS

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def swept(self) -> bool:
        return bool(self.axes)

    def summary(self) -> Dict[str, Any]:
        return {
            "axes": [axis.summary() for axis in self.axes],
            "combo_count": self.combo_count,
            "job_count": self.job_count,
            "max_jobs": self.max_jobs,
        }


# --------------------------------------------------------------------------- values


def _is_secret_ref(value: Any) -> bool:
    return isinstance(value, Mapping) and "$secret" in value


def redact_value(value: Any) -> Any:
    """A copy without ``{"$secret": ref}`` values."""
    if isinstance(value, Mapping):
        return {k: redact_value(v) for k, v in value.items() if not _is_secret_ref(v)}
    if isinstance(value, list):
        return [redact_value(v) for v in value if not _is_secret_ref(v)]
    return copy.deepcopy(value)


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, bool, int, float))


def _canonical(value: Any) -> str:
    return json.dumps(redact_value(value), sort_keys=True, default=str)


def _is_binding_pointer(pointer: str) -> bool:
    return len(split_pointer(pointer)) == 2 and pointer.startswith("/slot_bindings/")


def _section(pointer: str) -> str:
    segments = split_pointer(pointer)
    return segments[0] if segments and segments[0] in SWEEP_SECTIONS else "document"


def _sweep_error(pointer: str, rule: str, message: str) -> Dict[str, Any]:
    error = _error(_section(pointer), pointer, rule, message)
    segments = split_pointer(pointer)
    if len(segments) >= 2 and segments[0] == "slot_bindings":
        error["slot_key"] = segments[1]
    return error


def _set(document: Dict[str, Any], pointer: str, value: Any) -> None:
    segments = split_pointer(pointer)
    target: Any = document
    for segment in segments[:-1]:
        target = target[int(segment)] if isinstance(target, list) else target[segment]
    last = segments[-1]
    if isinstance(target, list):
        target[int(last)] = copy.deepcopy(value)
    else:
        target[last] = copy.deepcopy(value)


# --------------------------------------------------------------------------- parse


def _sweep_pointers(spec: Mapping[str, Any]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Sweep pointers in axis order, plus sweeps outside the sweepable sections."""
    errors: List[Dict[str, Any]] = []
    pointers: List[str] = []
    for key, value in spec.items():
        if key in SWEEP_SECTIONS or key == "links":
            continue
        for pointer in find_sweeps(value, "/" + escape_pointer_segment(str(key))):
            errors.append(_sweep_error(pointer, "sweep", "This value cannot be swept"))
    for section in SWEEP_SECTIONS:
        if section in spec:
            pointers += find_sweeps(spec[section], "/" + section)
    return pointers, errors


def _check_values(
    spec: Mapping[str, Any], pointer: str
) -> Tuple[Optional[List[Any]], List[Dict[str, Any]]]:
    node: Any = spec
    for segment in split_pointer(pointer):
        node = node[int(segment)] if isinstance(node, list) else node[segment]
    values = node.get("sweep")
    if not isinstance(values, list) or not values:
        return None, [
            _sweep_error(pointer, "sweep", "A sweep needs a non-empty list of values")
        ]
    errors: List[Dict[str, Any]] = []
    if pointer.startswith("/slot_bindings/"):
        if not _is_binding_pointer(pointer):
            return None, [
                _sweep_error(
                    pointer,
                    "sweep",
                    "Sweep the whole slot binding, not one of its fields",
                )
            ]
        for i, value in enumerate(values):
            if binding_kind(value) is None:
                errors.append(
                    _sweep_error(
                        f"{pointer}/sweep/{i}",
                        "sweep",
                        "Each swept binding must be {connection_id}, {temporary} "
                        "or {inherit: true}",
                    )
                )
    else:
        for i, value in enumerate(values):
            if not _is_scalar(value) or (
                isinstance(value, float) and not math.isfinite(value)
            ):
                errors.append(
                    _sweep_error(
                        f"{pointer}/sweep/{i}",
                        "sweep",
                        "Sweep values must be strings, numbers, booleans or null",
                    )
                )
    if not errors:
        seen = set()
        for i, value in enumerate(values):
            key = _canonical(value)
            if key in seen:
                errors.append(
                    _sweep_error(
                        f"{pointer}/sweep/{i}",
                        "sweep",
                        "Duplicate sweep value",
                    )
                )
            seen.add(key)
    return (None if errors else list(values)), errors


def _link_groups(
    spec: Mapping[str, Any], sweep_pointers: Sequence[str]
) -> Tuple[List[List[str]], List[Dict[str, Any]]]:
    links = spec.get("links")
    if links is None:
        return [], []
    if not isinstance(links, list):
        return [], [
            _error("document", "/links", "type", "links must be a list of lists")
        ]
    errors: List[Dict[str, Any]] = []
    groups: List[List[str]] = []
    claimed: Dict[str, int] = {}
    known = set(sweep_pointers)
    for g, group in enumerate(links):
        where = f"/links/{g}"
        if not isinstance(group, list) or not all(isinstance(p, str) for p in group):
            errors.append(
                _error(
                    "document", where, "type", "A linked group is a list of pointers"
                )
            )
            continue
        members: List[str] = []
        for m, pointer in enumerate(group):
            at = f"{where}/{m}"
            if pointer not in known:
                errors.append(
                    _error(
                        "document",
                        at,
                        "link",
                        f"{pointer} is not a swept value",
                    )
                )
            elif pointer in claimed:
                errors.append(
                    _error(
                        "document",
                        at,
                        "link",
                        f"{pointer} is already linked in /links/{claimed[pointer]}",
                    )
                )
            else:
                claimed[pointer] = g
                members.append(pointer)
        if len(group) < 2:
            errors.append(
                _error(
                    "document", where, "link", "A linked group needs two or more values"
                )
            )
        groups.append(members)
    return groups, errors


def parse_sweeps(
    spec: Mapping[str, Any],
) -> Tuple[List[SweepAxis], List[Dict[str, Any]]]:
    """The spec's grid axes in order, or errors (then the axes are unusable)."""
    if not isinstance(spec, Mapping):
        return [], [
            _error("document", "", "type", "The config document must be an object")
        ]
    pointers, errors = _sweep_pointers(spec)
    values: Dict[str, List[Any]] = {}
    for pointer in pointers:
        found, problems = _check_values(spec, pointer)
        errors += problems
        if found is not None:
            values[pointer] = found
    groups, link_errors = _link_groups(spec, pointers)
    errors += link_errors

    for g, group in enumerate(groups):
        lengths = {len(values[p]) for p in group if p in values}
        if len(lengths) > 1:
            errors.append(
                _error(
                    "document",
                    f"/links/{g}",
                    "link",
                    "Linked values need the same number of values "
                    f"(got {', '.join(str(len(values[p])) for p in group if p in values)})",
                )
            )
    if errors:
        return [], errors

    group_of = {p: g for g, group in enumerate(groups) for p in group}
    axes: List[SweepAxis] = []
    done: set = set()
    for pointer in pointers:
        if pointer in group_of:
            g = group_of[pointer]
            if g in done:
                continue
            done.add(g)
            members = [p for p in pointers if group_of.get(p) == g]
            steps = tuple(zip(*(values[p] for p in members)))
            axes.append(SweepAxis(tuple(members), steps))
        else:
            axes.append(SweepAxis((pointer,), tuple((v,) for v in values[pointer])))
    return axes, []


# --------------------------------------------------------------------------- labels


def _short_key(pointer: str) -> str:
    segments = split_pointer(pointer)
    if _is_binding_pointer(pointer):
        return segments[1].rsplit(":", 1)[-1]
    last = segments[-1]
    lowered = last.lower()
    if lowered in _ABBREVIATIONS:
        return _ABBREVIATIONS[lowered]
    word = re.split(r"[_\-.]", lowered)[-1] or lowered
    return _ABBREVIATIONS.get(word, word)


def _long_key(pointer: str, depth: int) -> str:
    segments = split_pointer(pointer)
    if _is_binding_pointer(pointer):
        return segments[1]
    return ".".join(s.lower() for s in segments[-depth:])


def _keys(pointers: Sequence[str]) -> Dict[str, str]:
    """Short, unique label keys: grow a colliding key until it is unique."""
    keys = {p: _short_key(p) for p in pointers}
    depth = 1
    while len(set(keys.values())) < len(keys) and depth < 8:
        counts: Dict[str, int] = {}
        for key in keys.values():
            counts[key] = counts.get(key, 0) + 1
        keys = {
            p: (_long_key(p, depth) if counts[k] > 1 else k) for p, k in keys.items()
        }
        depth += 1
    return keys


def _format_value(value: Any, connection_labels: Mapping[str, str]) -> str:
    if value is None:
        return "inherit"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return str(value)
    kind = binding_kind(value)
    if kind == "inherit":
        return "inherit"
    if kind == "connection":
        cid = value.get("connection_id")
        return str(
            connection_labels.get(cid) or value.get("model") or value.get("name") or cid
        )
    if kind == "temporary":
        temporary = value.get("temporary") or {}
        return str(temporary.get("model") or temporary.get("label") or "temporary")
    return "?"


def combo_label(
    values: Mapping[str, Any],
    connection_labels: Optional[Mapping[str, str]] = None,
    keys: Optional[Mapping[str, str]] = None,
) -> str:
    """``primary=gpt-4o thr=0.7`` (deterministic, secret-free, truncated)."""
    keys = keys or _keys(list(values))
    labels = connection_labels or {}
    parts = [f"{keys[p]}={_format_value(v, labels)}" for p, v in values.items()]
    label = " ".join(parts)
    return label if len(label) <= LABEL_MAX else label[: LABEL_MAX - 1] + "…"


def run_name(name: str, label: str = "", environment_name: Optional[str] = None) -> str:
    """``{name} · {label}`` plus ``· {environment}`` when launching on several."""
    parts = [name] + [p for p in (label, environment_name) if p]
    return " · ".join(parts)[:RUN_NAME_MAX]


def connection_labels(
    db: Session, project_id: str, spec: Mapping[str, Any]
) -> Dict[str, str]:
    """``{connection_id: model}`` for every connection bound in ``spec`` (sweeps too)."""
    ids = set()
    bindings = spec.get("slot_bindings") if isinstance(spec, Mapping) else None
    if isinstance(bindings, Mapping):
        for binding in bindings.values():
            candidates = binding.get("sweep") if is_sweep(binding) else [binding]
            for candidate in candidates if isinstance(candidates, list) else []:
                if binding_kind(candidate) == "connection" and isinstance(
                    candidate.get("connection_id"), str
                ):
                    ids.add(candidate["connection_id"])
    if not ids:
        return {}
    rows = db.query(ProjectLlmConnection).filter(
        ProjectLlmConnection.project_id == project_id,
        ProjectLlmConnection.id.in_(sorted(ids)),
    )
    return {row.id: (row.llm_model or "").strip() or row.name or row.id for row in rows}


# --------------------------------------------------------------------------- expand


def expand(
    spec: Mapping[str, Any],
    *,
    environment_count: int,
    max_jobs: Optional[int] = None,
    connection_labels: Optional[Mapping[str, str]] = None,
) -> SweepPlan:
    """Expand ``spec`` into combinations (see the module docstring).

    The cap is checked before any combination is built. A spec without sweeps yields
    one combination (index 0, empty label) whose document is the spec minus ``links``.
    """
    cap = max_sweep_jobs() if max_jobs is None else max_jobs
    plan = SweepPlan(max_jobs=cap)
    axes, errors = parse_sweeps(spec)
    if errors:
        plan.errors = errors
        return plan
    plan.axes = axes
    plan.combo_count = math.prod(len(axis) for axis in axes) if axes else 1
    plan.job_count = plan.combo_count * max(environment_count, 0)
    if plan.job_count > cap:
        plan.errors = [
            _error(
                "document",
                "",
                "sweep_cap",
                f"This launch would create {plan.job_count} jobs "
                f"({plan.combo_count} combinations × {environment_count} "
                f"environments); the limit is {cap}",
            )
        ]
        return plan

    base = {k: copy.deepcopy(v) for k, v in spec.items() if k != "links"}
    pointers = [p for axis in axes for p in axis.pointers]
    keys = _keys(pointers)
    for index, steps in enumerate(itertools.product(*(axis.steps for axis in axes))):
        values: Dict[str, Any] = {}
        for axis, step in zip(axes, steps):
            values.update(zip(axis.pointers, step))
        document = copy.deepcopy(base)
        for pointer, value in values.items():
            _set(document, pointer, value)
        plan.combos.append(
            Combo(
                index=index,
                values=values,
                document=document,
                label=combo_label(values, connection_labels, keys) if values else "",
            )
        )
    return plan
