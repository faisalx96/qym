"""Several dataset versions and a task per environment in one experiment.

Spec shape (``eval_experiments.spec.evaluator``, change request v1.4):

- ``datasets``: ``[{dataset, version, alias}, ...]`` with 2 to ``QYM_EVAL_MAX_DATASETS``
  entries. One entry collapses to today's scalar form (``dataset``, ``dataset_version``,
  ``config.dataset_alias``), so a one-pair experiment is stored byte for byte as before.
  ``evaluator.dataset`` / ``dataset_version`` / ``config.dataset_alias`` always mirror
  entry 0.
- ``run_shape``: ``combined`` (default) | ``one_each``. Platform-only: it is never sent to
  a service and never stored in a job body or ``qym_config``.
- ``task``: a task id (applies to every selected environment) or an object keyed by
  environment id (``null`` = the worker's default).

``units`` turns one combination of that spec into the jobs one environment gets:
one combined job (the service takes a list), or one job per pair (the F3 fan-out for a
service without ``datasets``, and ``one_each``). Pure functions, no database access,
except :func:`check_tasks` which reads the services' task lists.
"""

from __future__ import annotations

import asyncio
import copy
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from qym_platform.log import get_logger
from qym_platform.services.eval_service_client import EvalServiceClient

logger = get_logger(__name__)

RUN_SHAPES = ("combined", "one_each")
DEFAULT_RUN_SHAPE = "combined"
TASK_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
ENTRY_KEYS = ("dataset", "version", "alias")
SWEEP_DATASETS_MESSAGE = (
    "Dataset versions cannot be swept; choose “One run each” to run each one."
)
TASK_CHECK_TIMEOUT_SECONDS = 5.0

MODE_SINGLE = "single"
MODE_COMBINED = "combined"
MODE_FAN_OUT = "fan_out"
REASON_OLD_SERVICE = "service_without_datasets"
REASON_RUN_SHAPE = "run_shape"


def _is_sweep(value: Any) -> bool:
    return isinstance(value, Mapping) and "sweep" in value


def _contains_sweep(value: Any) -> bool:
    if _is_sweep(value):
        return True
    if isinstance(value, Mapping):
        return any(_contains_sweep(v) for v in value.values())
    if isinstance(value, list):
        return any(_contains_sweep(v) for v in value)
    return False


def _error(
    pointer: str,
    rule: str,
    message: str,
    *,
    environment_id: Optional[str] = None,
    environment_name: Optional[str] = None,
) -> Dict[str, Any]:
    error: Dict[str, Any] = {
        "section": "evaluator",
        "pointer": pointer,
        "form_pointer": pointer,
        "field": None,
        "params": {},
        "rule": rule,
        "message": message,
    }
    if environment_id is not None:
        error["environment_id"] = environment_id
        error["environment_name"] = environment_name
    return error


def ref_label(entry: Mapping[str, Any]) -> str:
    """``support-tickets v3`` / ``support-tickets production`` / ``... latest``."""
    ref = entry.get("version") or entry.get("alias") or "latest"
    return f"{entry.get('dataset')} {ref}"


def entries(evaluator: Any) -> List[Dict[str, Any]]:
    """The normalized ``datasets`` list of an evaluator mapping (empty when absent)."""
    raw = evaluator.get("datasets") if isinstance(evaluator, Mapping) else None
    if not isinstance(raw, list):
        return []
    return [
        {
            "dataset": e.get("dataset"),
            "version": e.get("version"),
            "alias": e.get("alias"),
        }
        for e in raw
        if isinstance(e, Mapping)
    ]


def run_shape_of(evaluator: Any) -> str:
    value = evaluator.get("run_shape") if isinstance(evaluator, Mapping) else None
    return value if value in RUN_SHAPES else DEFAULT_RUN_SHAPE


# --------------------------------------------------------------------------- normalize


def _normalize_entries(
    raw: Any, max_datasets: int
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    base = "/evaluator/datasets"
    if not isinstance(raw, list) or not raw:
        return [], [
            _error(base, "datasets_invalid", "datasets must be a list with at least one entry")
        ]
    errors: List[Dict[str, Any]] = []
    out: List[Dict[str, Any]] = []
    for index, item in enumerate(raw):
        pointer = f"{base}/{index}"
        if not isinstance(item, Mapping):
            errors.append(
                _error(pointer, "datasets_invalid", "each entry must be an object")
            )
            continue
        unknown = [str(k) for k in item if k not in ENTRY_KEYS]
        if unknown:
            errors.append(
                _error(
                    pointer,
                    "datasets_invalid",
                    f"unknown key “{unknown[0]}”; use dataset, version or alias",
                )
            )
            continue
        dataset = item.get("dataset")
        if not isinstance(dataset, str) or not dataset.strip() or len(dataset.strip()) > 200:
            errors.append(
                _error(
                    pointer,
                    "datasets_invalid",
                    "dataset must be a name of 1 to 200 characters",
                )
            )
            continue
        bad = next(
            (
                key
                for key in ("version", "alias")
                if item.get(key) is not None
                and (
                    not isinstance(item.get(key), str)
                    or not item[key].strip()
                    or len(item[key]) > 100
                )
            ),
            None,
        )
        if bad is not None:
            errors.append(
                _error(
                    pointer,
                    "datasets_invalid",
                    f"{bad} must be a string of 1 to 100 characters or null",
                )
            )
            continue
        version = item.get("version")
        alias = item.get("alias")
        if version is not None and alias is not None:
            errors.append(
                _error(
                    pointer, "datasets_invalid", "give a version or an alias, not both"
                )
            )
            continue
        out.append(
            {
                "dataset": dataset.strip(),
                "version": version.strip() if isinstance(version, str) else None,
                "alias": alias.strip() if isinstance(alias, str) else None,
            }
        )
    if errors:
        return [], errors
    seen: Dict[Tuple[Any, Any, Any], int] = {}
    for index, entry in enumerate(out):
        key = (entry["dataset"], entry["version"], entry["alias"])
        if key in seen:
            errors.append(
                _error(
                    f"{base}/{index}",
                    "datasets_duplicate",
                    f"{ref_label(entry)} is chosen twice.",
                )
            )
        seen.setdefault(key, index)
    if len(out) > max_datasets:
        errors.append(
            _error(
                base,
                "datasets_limit",
                f"At most {max_datasets} dataset versions per experiment.",
            )
        )
    return out, errors


def _task_value_errors(pointer: str, value: Any) -> List[Dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, str) or not TASK_ID_RE.match(value):
        return [
            _error(
                pointer,
                "task_invalid",
                "A task id is 1 to 100 characters: letters, digits, “_”, “.”, “:” and “-”.",
            )
        ]
    return []


def _normalize_task(
    raw: Any, environment_ids: Sequence[str]
) -> Tuple[Any, List[Dict[str, Any]]]:
    """``(stored task or None, errors)``; nulls and an emptied object are dropped."""
    base = "/evaluator/task"
    errors: List[Dict[str, Any]] = []
    if raw is None:
        return None, errors
    if _is_sweep(raw):
        values = raw.get("sweep")
        for i, v in enumerate(values if isinstance(values, list) else []):
            errors += _task_value_errors(f"{base}/sweep/{i}", v)
        return copy.deepcopy(raw), errors
    if isinstance(raw, str):
        problems = _task_value_errors(base, raw)
        return (None if problems else raw), problems
    if not isinstance(raw, Mapping):
        return None, [
            _error(
                base,
                "task_invalid",
                "task must be a task id or an object keyed by environment id",
            )
        ]
    out: Dict[str, Any] = {}
    for env_id, value in raw.items():
        pointer = f"{base}/{env_id}"
        if env_id not in environment_ids:
            errors.append(
                _error(
                    pointer,
                    "task_unknown_environment",
                    f"Environment id “{env_id}” is not part of this launch.",
                )
            )
            continue
        if _is_sweep(value):
            items = value.get("sweep")
            for i, v in enumerate(items if isinstance(items, list) else []):
                errors += _task_value_errors(f"{pointer}/sweep/{i}", v)
            out[env_id] = copy.deepcopy(value)
            continue
        problems = _task_value_errors(pointer, value)
        errors += problems
        if value is not None and not problems:
            out[env_id] = value
    return (out or None), errors


def normalize(
    spec: Mapping[str, Any], environment_ids: Sequence[str], *, max_datasets: int
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """The spec as stored (one pair collapsed, mirrors filled, ``task`` cleaned) + errors.

    Runs first on the request's spec. Without ``datasets``, ``run_shape`` and ``task``
    the spec is returned unchanged (a deep copy), so single-dataset launches are stored
    exactly as before.
    """
    out = copy.deepcopy(dict(spec))
    evaluator = out.get("evaluator")
    if not isinstance(evaluator, dict):
        return out, []
    errors: List[Dict[str, Any]] = []
    has_datasets = "datasets" in evaluator
    config = evaluator.get("config")

    # Sweeps: the dataset list and the shape are never swept; with a list present the
    # scalars mirror entry 0 and cannot be swept either.
    sweeps = [
        pointer
        for pointer, value in (
            ("/evaluator/datasets", evaluator.get("datasets")),
            ("/evaluator/run_shape", evaluator.get("run_shape")),
        )
        if _contains_sweep(value)
    ]
    if has_datasets:
        sweeps += [
            f"/evaluator/{key}"
            for key in ("dataset", "dataset_version")
            if _contains_sweep(evaluator.get(key))
        ]
        if isinstance(config, Mapping) and _contains_sweep(config.get("dataset_alias")):
            sweeps.append("/evaluator/config/dataset_alias")
    for pointer in sweeps:
        errors.append(_error(pointer, "sweep", SWEEP_DATASETS_MESSAGE))
    if "task" in evaluator:
        task, task_errors = _normalize_task(evaluator.get("task"), environment_ids)
        errors += task_errors
        if task is None:
            evaluator.pop("task", None)
        else:
            evaluator["task"] = task
    if errors:
        return out, errors

    shape_present = "run_shape" in evaluator
    shape = evaluator.get("run_shape")
    if shape_present and shape not in RUN_SHAPES:
        errors.append(
            _error(
                "/evaluator/run_shape",
                "run_shape_invalid",
                "run_shape must be “combined” or “one_each”.",
            )
        )
    if not has_datasets:
        if shape_present and shape in RUN_SHAPES:
            if shape == DEFAULT_RUN_SHAPE:
                evaluator.pop("run_shape")
            else:
                errors.append(_run_shape_without_datasets())
        return out, errors

    pairs, entry_errors = _normalize_entries(evaluator.get("datasets"), max_datasets)
    errors += entry_errors
    if entry_errors:
        return out, errors
    first = pairs[0]
    # Caller-supplied scalars must agree with entry 0.
    scalar_checks = (
        ("/evaluator/dataset", evaluator.get("dataset"), first["dataset"], "dataset"),
        (
            "/evaluator/dataset_version",
            evaluator.get("dataset_version"),
            first["version"],
            "dataset_version",
        ),
    )
    for pointer, supplied, expected, name in scalar_checks:
        if supplied is not None and supplied != expected:
            errors.append(
                _error(
                    pointer,
                    "datasets_conflict",
                    f"evaluator.{name} must equal the first dataset in evaluator.datasets"
                    if name == "dataset"
                    else "evaluator.dataset_version must equal the first dataset's version",
                )
            )
    supplied_alias = config.get("dataset_alias") if isinstance(config, Mapping) else None
    if supplied_alias is not None and supplied_alias != first["alias"]:
        errors.append(
            _error(
                "/evaluator/config/dataset_alias",
                "datasets_conflict",
                "evaluator.config.dataset_alias must equal the first dataset's alias",
            )
        )
    if errors:
        return out, errors

    mirror(evaluator, first)
    if len(pairs) == 1:
        evaluator.pop("datasets", None)
        if shape_present and shape == DEFAULT_RUN_SHAPE:
            evaluator.pop("run_shape", None)
        elif shape_present and shape in RUN_SHAPES:
            errors.append(_run_shape_without_datasets())
        return out, errors
    evaluator["datasets"] = pairs
    evaluator["run_shape"] = shape if shape in RUN_SHAPES else DEFAULT_RUN_SHAPE
    return out, errors


def _run_shape_without_datasets() -> Dict[str, Any]:
    return _error(
        "/evaluator/run_shape",
        "run_shape_without_datasets",
        "run_shape needs two or more datasets in evaluator.datasets.",
    )


def mirror(evaluator: Dict[str, Any], pair: Mapping[str, Any]) -> None:
    """Write a pair onto the scalar fields (``dataset``, ``dataset_version``, alias)."""
    evaluator["dataset"] = pair["dataset"]
    if pair.get("version") is not None:
        evaluator["dataset_version"] = pair["version"]
    else:
        evaluator.pop("dataset_version", None)
    config = evaluator.get("config")
    if pair.get("alias") is not None:
        if not isinstance(config, dict):
            config = evaluator["config"] = {}
        config["dataset_alias"] = pair["alias"]
    elif isinstance(config, dict) and "dataset_alias" in config:
        config.pop("dataset_alias")


# --------------------------------------------------------------------------- units


@dataclass(frozen=True)
class Unit:
    """One job of one (combination, environment): a combined job or one pair."""

    index: int  # ``dataset_index``
    mode: str  # single | combined | fan_out
    pair: Optional[Dict[str, Any]] = None
    datasets: Optional[List[Dict[str, Any]]] = None


def plan_units(
    evaluator: Any, *, accepts_datasets: bool
) -> Tuple[str, Optional[str], List[Unit]]:
    """``(mode, reason, units)`` for an environment (section 3.3 of the spec)."""
    pairs = entries(evaluator)
    if len(pairs) < 2:
        return MODE_SINGLE, None, [Unit(0, MODE_SINGLE)]
    if run_shape_of(evaluator) == DEFAULT_RUN_SHAPE and accepts_datasets:
        return MODE_COMBINED, None, [Unit(0, MODE_COMBINED, datasets=pairs)]
    reason = REASON_RUN_SHAPE if run_shape_of(evaluator) != DEFAULT_RUN_SHAPE else REASON_OLD_SERVICE
    return (
        MODE_FAN_OUT,
        reason,
        [Unit(i, MODE_FAN_OUT, pair=pair) for i, pair in enumerate(pairs)],
    )


def unit_count(evaluator: Any, *, accepts_datasets: bool) -> int:
    return len(plan_units(evaluator, accepts_datasets=accepts_datasets)[2])


def task_for_environment(evaluator: Any, environment_id: str) -> Optional[str]:
    """The task id one environment gets from ``evaluator.task`` (string or object)."""
    raw = evaluator.get("task") if isinstance(evaluator, Mapping) else None
    if isinstance(raw, str):
        return raw
    if isinstance(raw, Mapping):
        value = raw.get(environment_id)
        return value if isinstance(value, str) else None
    return None


def unit_document(
    document: Mapping[str, Any],
    unit: Unit,
    *,
    environment_id: str,
    task: Optional[str],
    supports_task: bool,
) -> Dict[str, Any]:
    """The document one job is validated and stored from.

    Never carries ``run_shape``. ``task`` is the environment's resolved id; it is left
    out when the environment does not declare ``task`` (reported separately).
    """
    doc = copy.deepcopy(dict(document))
    evaluator = doc.get("evaluator")
    if not isinstance(evaluator, dict):
        return doc
    evaluator.pop("run_shape", None)
    if unit.mode == MODE_FAN_OUT and unit.pair is not None:
        evaluator.pop("datasets", None)
        mirror(evaluator, unit.pair)
    elif unit.mode == MODE_SINGLE:
        evaluator.pop("datasets", None)
    evaluator.pop("task", None)
    if task is not None and supports_task:
        evaluator["task"] = task
    return doc


def pair_label(unit: Unit) -> Optional[str]:
    return ref_label(unit.pair) if unit.pair else None


# --------------------------------------------------------------------------- task check


@dataclass
class TaskList:
    """What one service said about its tasks (``ok`` | ``unverified``)."""

    status: str
    names: Dict[str, str]
    reason: Optional[str] = None


ClientFactory = Callable[[str, str], EvalServiceClient]


async def _read_tasks(
    client: EvalServiceClient, timeout: float
) -> TaskList:
    try:
        data = await asyncio.wait_for(client.tasks_list(), timeout)
    except asyncio.TimeoutError:
        return TaskList("unverified", {}, "timed out")
    except Exception as exc:  # noqa: BLE001 - any failure is "unverified", never an error
        logger.warning("Reading tasks failed: %s", type(exc).__name__)
        return TaskList("unverified", {}, type(exc).__name__)
    finally:
        await client.aclose()
    if data is None:
        return TaskList("unverified", {}, "the service does not list tasks")
    names = {
        str(item["id"]): str(item.get("name") or item["id"])
        for item in data
        if isinstance(item.get("id"), str)
    }
    return TaskList("ok", names)


def check_tasks(
    targets: Mapping[str, Tuple[str, str]],
    client_factory: ClientFactory,
    *,
    timeout: float = TASK_CHECK_TIMEOUT_SECONDS,
) -> Dict[str, TaskList]:
    """Read ``GET /evals/tasks`` of each environment in parallel (one call each).

    ``targets`` maps an environment id to ``(base_url, api_key)``. Failures are
    ``unverified`` results, never raised: the service validates at submit.
    """
    if not targets:
        return {}

    async def run() -> Dict[str, TaskList]:
        ids = list(targets)
        results = await asyncio.gather(
            *(
                _read_tasks(client_factory(targets[i][0], targets[i][1]), timeout)
                for i in ids
            )
        )
        return dict(zip(ids, results))

    return asyncio.run(run())
