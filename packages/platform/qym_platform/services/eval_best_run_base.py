"""A best run as a launch-form base (plan §10.3, §7.5, §9.3; issue #38).

``run_base(db, env, run_id)`` turns one official run of ``env`` into a launch-ready
§8.1 document, served by
``GET /v1/projects/{pid}/eval-environments/{eid}/best-runs/{run_id}/base``:

1. **Which runs.** ``official_run_job`` accepts a run of the environment's project that
   is not soft-deleted, has ``origin = official`` and is linked to a job on one of the
   given environments. The launch's ``base_source: {kind: best_run, run_id}`` is
   validated with the same function (``api/experiments.py``).
2. **Config.** The run's ``run_metadata.qym_config`` (§10.1), else the job row's copy
   (``request_body…run_metadata.qym_config``), else the experiment spec expanded at the
   job's ``combo_index`` with the job's ``params.slot_bindings``. Only ``evaluator``,
   ``env_overrides`` and ``slot_bindings`` are kept; secret refs are dropped and
   reserved ``run_metadata`` keys (``qym_launch``/``qym_config``) removed.
3. **Re-map** onto the environment's current schema with ``eval_presets.remap`` (§9.3):
   dropped settings and unfixable errors are reported, never raised.
4. **Temporary models** become unbound (``eval_temporary_models.unbind_temporary``):
   the slot is ``null`` and ``prompts`` lists ``{slot_key, label, model, base_url,
   reason}`` so the form can ask for a project model or the key again (§7.5).
5. **Connections are re-resolved** fresh (``eval_bindings.resolve_slot_bindings``,
   nothing decrypted). A deleted, hidden or otherwise unusable connection becomes an
   unbound slot with a ``warnings`` entry (``code`` says why); a usable one is shown
   with its current name and model.
6. **Versioning drift.** ``versioning`` is the run's ``remote_versioning``;
   ``latest_versioning`` the newest finished job on the environment that reported one
   (``eval_best_run.latest_versioning``). ``drift.status`` is ``same``, ``changed``
   (``changes`` lists ``{key, run, latest}``) or ``unknown`` (either side missing).

Response::

    {
      "environment_id": "…",
      "run": {"id", "external_run_id", "task", "model", "status", "completed_at",
              "dataset_version_id"},
      "base_source": {"kind": "best_run", "run_id", "job_id", "experiment_id",
                      "environment_id"},
      "config_source": "run" | "job" | "experiment",
      "config": {"schema_hash", "evaluator", "env_overrides", "slot_bindings"},
      "score": {"metric", "score", "direction", "pass_at_k", "item_count"} | null,
      "remap": {"from_schema_hash", "to_schema_hash", "dropped", "errors", "summary",
                "ok"},
      "warnings": [{"section": "slot_bindings", "pointer", "slot_key", "rule",
                    "code", "message", "connection_id"}],
      "prompts": [{"slot_key", "label", "model", "base_url", "reason"}],
      "versioning": {...} | null,
      "latest_versioning": {"versioning", "job_id", "run_id", "finished_at"} | null,
      "drift": {"status": "same" | "changed" | "unknown", "changes": [...]}
    }

Nothing here carries a secret: temporary-model keys are never stored in a snapshot,
connection keys are never decrypted, and versioning is the redacted copy.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalRunScore,
    Run,
    RunOrigin,
)
from qym_platform.services import eval_sweeps
from qym_platform.services.eval_best_run import (
    BestRunError,
    job_versioning,
    latest_versioning,
)
from qym_platform.services.eval_bindings import resolve_slot_bindings
from qym_platform.services.eval_config import binding_kind
from qym_platform.services.eval_experiments import (
    is_secret_ref,
    redact_secret_refs,
)
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)
from qym_platform.services.eval_presets import remap
from qym_platform.services.eval_schema_form import escape_pointer_segment
from qym_platform.services.eval_temporary_models import unbind_temporary

DOCUMENT_KEYS = ("evaluator", "env_overrides", "slot_bindings")
# Written by the platform at dispatch; never part of a base.
RESERVED_METADATA_KEYS = ("qym_launch", "qym_config")
# A spec was validated under the sweep cap when it launched; expanding it again only
# needs a bound that cannot refuse it.
_EXPAND_LIMIT = 1_000_000


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


# --------------------------------------------------------------------------- lookup


def official_run_job(
    db: Session,
    project_id: str,
    run_id: str,
    environment_ids: Iterable[str],
) -> Tuple[Run, EvalExperimentJob]:
    """The run and its job, when the run can be a base on ``environment_ids``.

    404 for a run that does not exist, belongs to another project or was deleted;
    422 for a local run (or one without a job) and for a job on another environment.
    """
    run = db.get(Run, run_id) if run_id else None
    if run is None or run.project_id != project_id or run.deleted_at is not None:
        raise BestRunError(404, "Run not found")
    if run.origin != RunOrigin.OFFICIAL or not run.experiment_job_id:
        raise BestRunError(
            422, "Only an official run launched from an experiment can be a base"
        )
    job = db.get(EvalExperimentJob, run.experiment_job_id)
    wanted = set(environment_ids)
    if job is None or job.environment_id not in wanted:
        raise BestRunError(
            422,
            "The run was not launched on "
            + ("this environment" if len(wanted) == 1 else "the selected environments"),
        )
    experiment = db.get(EvalExperiment, job.experiment_id)
    if experiment is None or experiment.project_id != project_id:
        raise BestRunError(404, "Run not found")
    return run, job


# --------------------------------------------------------------------------- config


def _strip_refs(value: Any) -> Any:
    """A copy without ``{"$secret": ref}`` values."""
    if isinstance(value, Mapping):
        return {
            key: _strip_refs(child)
            for key, child in value.items()
            if not is_secret_ref(child)
        }
    if isinstance(value, list):
        return [_strip_refs(v) for v in value if not is_secret_ref(v)]
    return copy.deepcopy(value)


def _document(snapshot: Any) -> Optional[Dict[str, Any]]:
    """The §8.1 part of a snapshot, secret-free, or ``None`` when it has none."""
    snapshot = _mapping(snapshot)
    doc = {
        key: copy.deepcopy(dict(snapshot[key]))
        for key in DOCUMENT_KEYS
        if isinstance(snapshot.get(key), Mapping)
    }
    if not doc:
        return None
    doc = _strip_refs(redact_secret_refs(doc))
    config = _mapping(_mapping(doc.get("evaluator")).get("config"))
    metadata = config.get("run_metadata")
    if isinstance(metadata, dict):
        for key in RESERVED_METADATA_KEYS:
            metadata.pop(key, None)
    return doc


def _job_snapshot(job: EvalExperimentJob) -> Any:
    body = _mapping(job.request_body)
    config = _mapping(_mapping(body.get("evaluator")).get("config"))
    return _mapping(config.get("run_metadata")).get("qym_config")


def _experiment_combo(db: Session, job: EvalExperimentJob) -> Optional[Dict[str, Any]]:
    """The experiment spec at the job's combination (jobs without a snapshot)."""
    experiment = db.get(EvalExperiment, job.experiment_id)
    spec = _mapping(experiment.spec if experiment is not None else None)
    if not spec:
        return None
    plan = eval_sweeps.expand(spec, environment_count=1, max_jobs=_EXPAND_LIMIT)
    combo = next((c for c in plan.combos if c.index == job.combo_index), None)
    if combo is None:
        return None
    document = dict(combo.document)
    bindings = _mapping(job.params).get("slot_bindings")
    if isinstance(bindings, Mapping):
        document["slot_bindings"] = bindings
    return document


def stored_config(
    db: Session, run: Run, job: EvalExperimentJob
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """``(document, source)``: the run's ``qym_config``, else the job row's."""
    for source, snapshot in (
        ("run", _mapping(run.run_metadata).get("qym_config")),
        ("job", _job_snapshot(job)),
    ):
        doc = _document(snapshot)
        if doc is not None:
            return doc, source
    doc = _document(_experiment_combo(db, job))
    return (doc, "experiment") if doc is not None else (None, None)


# --------------------------------------------------------------------------- bindings


def _warning(
    slot_key: str, code: str, message: str, connection_id: Any
) -> Dict[str, Any]:
    pointer = "/slot_bindings/" + escape_pointer_segment(slot_key)
    warning: Dict[str, Any] = {
        "section": "slot_bindings",
        "pointer": pointer,
        "slot_key": slot_key,
        "rule": "connection_unbound",
        "code": code,
        "message": f"{message}; model slot {slot_key} is unbound, pick another model",
    }
    if isinstance(connection_id, str):
        warning["connection_id"] = connection_id
    return warning


def rebind_connections(
    db: Session,
    env: EvalEnvironment,
    config: Dict[str, Any],
    slots: List[Any],
    descriptor: Mapping[str, Any],
) -> List[Dict[str, Any]]:
    """Re-resolve connection bindings in place; unusable ones are unbound (warnings)."""
    bindings = config.get("slot_bindings")
    if not isinstance(bindings, dict):
        return []
    resolution = resolve_slot_bindings(
        db, env, bindings, slots, descriptor=descriptor, decrypt=False
    )
    warnings: List[Dict[str, Any]] = []
    for problem in resolution.problems:
        binding = bindings.get(problem.slot_key)
        if binding_kind(binding) == "inherit":
            continue
        cid = binding.get("connection_id") if isinstance(binding, Mapping) else None
        bindings[problem.slot_key] = None
        warnings.append(_warning(problem.slot_key, problem.code, problem.message, cid))
    for slot_key, model in resolution.models.items():
        if model.get("kind") == "connection":
            bindings[slot_key] = {
                "connection_id": model["connection_id"],
                "name": model["name"],
                "model": model["model"],
            }
    return warnings


# --------------------------------------------------------------------------- payload


def versioning_drift(
    run_versioning: Optional[Mapping[str, Any]],
    latest: Optional[Mapping[str, Any]],
) -> Dict[str, Any]:
    """``same``/``changed``/``unknown`` between a run's versions and the latest ones."""
    latest_values = _mapping(_mapping(latest).get("versioning"))
    if not run_versioning or not latest_values:
        return {"status": "unknown", "changes": []}
    changes = [
        {"key": key, "run": run_versioning.get(key), "latest": latest_values.get(key)}
        for key in sorted(set(run_versioning) | set(latest_values))
        if run_versioning.get(key) != latest_values.get(key)
    ]
    return {"status": "changed" if changes else "same", "changes": changes}


def _score(
    db: Session, env: EvalEnvironment, run: Run, metric: Optional[str]
) -> Optional[Dict[str, Any]]:
    rows = {
        row.metric_name: row
        for row in db.query(EvalRunScore).filter(EvalRunScore.run_id == run.id)
    }
    if not rows:
        return None
    if metric:
        name = metric
    else:
        name = env.ranking_metric if env.ranking_metric in rows else sorted(rows)[0]
    row = rows.get(name)
    if row is None:
        return None
    return {
        "metric": row.metric_name,
        "score": float(row.mean_score),
        "direction": row.direction,
        "pass_at_k": (
            dict(row.pass_at_k) if isinstance(row.pass_at_k, Mapping) else None
        ),
        "item_count": int(row.item_count or 0),
    }


def run_base(
    db: Session,
    env: EvalEnvironment,
    run_id: str,
    *,
    metric: Optional[str] = None,
) -> Dict[str, Any]:
    """The launch-ready base of one official run of ``env`` (shape in the docstring)."""
    run, job = official_run_job(db, env.project_id, run_id, [env.id])
    to_schema = (
        db.get(EvalEnvironmentSchema, env.current_schema_id)
        if env.current_schema_id
        else None
    )
    if to_schema is None:
        raise BestRunError(409, "The environment has no schema yet; refresh it first")
    document, source = stored_config(db, run, job)
    if document is None:
        raise BestRunError(422, "The run has no stored configuration to start from")

    slots = list_model_slots(db, to_schema.id)
    result = remap(
        document,
        db.get(EvalEnvironmentSchema, job.schema_id),
        to_schema,
        to_slots=slots,
    )
    config, prompts = unbind_temporary(result.config)
    warnings = rebind_connections(
        db, env, config, slots, descriptor_for_schema(to_schema)
    )
    remap_payload = result.to_dict()
    remap_payload.pop("config")

    versioning = job_versioning(job)
    latest = latest_versioning(db, env)
    completed = run.ended_at
    return {
        "environment_id": env.id,
        "run": {
            "id": run.id,
            "external_run_id": run.external_run_id,
            "task": run.task,
            "model": run.model,
            "status": run.status.value if run.status else None,
            "completed_at": to_api_timestamp(completed),
            "dataset_version_id": run.dataset_version_id,
        },
        "base_source": {
            "kind": "best_run",
            "run_id": run.id,
            "job_id": job.id,
            "experiment_id": job.experiment_id,
            "environment_id": job.environment_id,
        },
        "config_source": source,
        "config": config,
        "score": _score(db, env, run, metric),
        "remap": remap_payload,
        "warnings": warnings,
        "prompts": prompts,
        "versioning": versioning,
        "latest_versioning": latest,
        "drift": versioning_drift(versioning, latest),
    }


__all__ = [
    "official_run_job",
    "rebind_connections",
    "run_base",
    "stored_config",
    "versioning_drift",
]
