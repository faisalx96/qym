""""Promote to official" prefill (plan §9.1, §9.3, §7.5; issue #39).

A manager can start the official-defaults editor from (a) a saved preset, (b) a
completed official run or (c) an experiment matrix cell (one job). This module
builds the editor's prefill for such a source; it **never publishes**: nothing is
written to the database here, and the only way to create an official version stays
the normal publish routes in ``api/eval_presets.py``.

The prefill is the source's §8.1 document (``schema_hash``, ``evaluator``,
``slot_bindings``, ``env_overrides``; no sweep, base source or links), secret refs
stripped, re-mapped onto the environment's current schema (``eval_presets.remap``)
and with temporary-model slots unbound (``eval_temporary_models.unbind_temporary``):
official defaults cannot hold a temporary model, so the editor asks the manager to
rebind those slots to project models before Publish is enabled.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Mapping, Optional, Tuple

from qym_platform.db.models import (
    EvalConfigPresetKind,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    Run,
    RunOrigin,
)
from qym_platform.services import eval_presets
from qym_platform.services.eval_best_run import ELIGIBLE_RUN_STATUSES
from qym_platform.services.eval_experiments import redact_secret_refs
from qym_platform.services.eval_model_slots import list_model_slots
from qym_platform.services.eval_presets import PresetError
from qym_platform.services.eval_temporary_models import unbind_temporary
from sqlalchemy.orm import Session

SOURCE_KINDS = ("saved", "run", "job")
# The parts of a stored config that make up one configuration (§8.1).
DOCUMENT_KEYS = ("schema_hash", "evaluator", "slot_bindings", "env_overrides")

REBIND_REASON = (
    "The source used a temporary model; official defaults need a project model"
)


def _strip_secrets(value: Any) -> Any:
    """A copy without ``{"$secret": ref}`` values; literal secrets masked."""
    value = redact_secret_refs(value)
    if isinstance(value, Mapping):
        return {
            key: _strip_secrets(child)
            for key, child in value.items()
            if not (isinstance(child, Mapping) and "$secret" in child)
        }
    if isinstance(value, list):
        return [
            _strip_secrets(v)
            for v in value
            if not (isinstance(v, Mapping) and "$secret" in v)
        ]
    return copy.deepcopy(value)


def _document(snapshot: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        key: _strip_secrets(snapshot[key])
        for key in DOCUMENT_KEYS
        if snapshot.get(key) is not None
    }


def _mapping(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _schema_by_hash(
    db: Session, env: EvalEnvironment, schema_hash: Any
) -> Optional[EvalEnvironmentSchema]:
    if not isinstance(schema_hash, str) or not schema_hash:
        return None
    return (
        db.query(EvalEnvironmentSchema)
        .filter(
            EvalEnvironmentSchema.environment_id == env.id,
            EvalEnvironmentSchema.schema_hash == schema_hash,
        )
        .first()
    )


def _job_snapshot(job: EvalExperimentJob) -> Optional[Mapping[str, Any]]:
    """The job's ``run_metadata.qym_config`` as stored in its request body."""
    body = _mapping(job.request_body)
    config = _mapping(_mapping(body.get("evaluator")).get("config"))
    snapshot = _mapping(config.get("run_metadata")).get("qym_config")
    return snapshot if isinstance(snapshot, Mapping) else None


def _from_saved(
    db: Session, env: EvalEnvironment, source_id: str
) -> Tuple[Dict[str, Any], Optional[EvalEnvironmentSchema], Dict[str, Any]]:
    preset = eval_presets.get_preset(db, env, source_id)  # 404 outside this env
    if preset.kind != EvalConfigPresetKind.SAVED:
        raise PresetError(
            422, "Only saved presets are promoted; edit official versions directly"
        )
    version = eval_presets.current_version(db, preset)
    if version is None:
        raise PresetError(422, "This preset has no version to promote")
    source = {
        "kind": "saved",
        "id": preset.id,
        "label": f"Saved preset “{preset.name}” v{version.version}",
        "name": preset.name,
        "version": version.version,
        "version_id": version.id,
    }
    from_schema = db.get(EvalEnvironmentSchema, version.schema_id)
    return _document(version.config or {}), from_schema, source


def _from_job(
    db: Session, env: EvalEnvironment, source_id: str
) -> Tuple[Dict[str, Any], Optional[EvalEnvironmentSchema], Dict[str, Any]]:
    job = db.get(EvalExperimentJob, source_id)
    experiment = db.get(EvalExperiment, job.experiment_id) if job is not None else None
    if job is None or experiment is None or experiment.project_id != env.project_id:
        raise PresetError(404, "Job not found")
    if job.environment_id != env.id:
        raise PresetError(422, "This job ran on another environment")
    snapshot = _job_snapshot(job)
    if not snapshot:
        raise PresetError(422, "This job has no stored configuration")
    source = {
        "kind": "job",
        "id": job.id,
        "label": f"{experiment.name} · combination #{job.combo_index}",
        "experiment_id": experiment.id,
        "experiment_name": experiment.name,
        "combo_index": job.combo_index,
    }
    from_schema = db.get(EvalEnvironmentSchema, job.schema_id)
    return _document(snapshot), from_schema, source


def _from_run(
    db: Session, env: EvalEnvironment, source_id: str
) -> Tuple[Dict[str, Any], Optional[EvalEnvironmentSchema], Dict[str, Any]]:
    run = db.get(Run, source_id)
    if run is None or run.project_id != env.project_id or run.deleted_at is not None:
        raise PresetError(404, "Run not found")
    if run.origin != RunOrigin.OFFICIAL:
        raise PresetError(422, "Only official runs can be promoted")
    if run.status not in ELIGIBLE_RUN_STATUSES:
        raise PresetError(422, "Only completed runs can be promoted")
    metadata = _mapping(run.run_metadata)
    snapshot = _mapping(metadata.get("qym_config"))
    if not snapshot:
        raise PresetError(422, "This run has no stored configuration")
    job = (
        db.get(EvalExperimentJob, run.experiment_job_id)
        if run.experiment_job_id
        else None
    )
    env_id = (
        job.environment_id
        if job is not None
        else _mapping(metadata.get("qym_launch")).get("environment_id")
    )
    if env_id != env.id:
        raise PresetError(422, "This run ran on another environment")
    from_schema = (
        db.get(EvalEnvironmentSchema, job.schema_id)
        if job is not None
        else _schema_by_hash(db, env, snapshot.get("schema_hash"))
    )
    source = {
        "kind": "run",
        "id": run.id,
        "label": f"Run {run.external_run_id or run.task or run.id[:8]}",
    }
    return _document(snapshot), from_schema, source


_LOADERS = {"saved": _from_saved, "job": _from_job, "run": _from_run}


def promote_prefill(
    db: Session,
    env: EvalEnvironment,
    schema: EvalEnvironmentSchema,
    *,
    kind: str,
    source_id: str,
) -> Dict[str, Any]:
    """The official-defaults editor prefill for one source; read-only.

    Returns ``{"environment_id", "source", "config", "remap", "unbound",
    "warnings"}``: ``config`` is the remapped document with temporary slots set to
    ``None``; ``remap`` is ``RemapResult.to_dict()`` without its config; ``unbound``
    lists the slots to rebind (``{slot_key, label, model, base_url, reason}``);
    ``warnings`` are the connection warnings of the result (deleted or hidden
    project models). Raises :class:`PresetError` (404/422) for a bad source.
    """
    loader = _LOADERS.get(kind)
    if loader is None:
        raise PresetError(422, f"Unknown source kind {kind!r}")
    document, from_schema, source = loader(db, env, source_id)
    result = eval_presets.remap(
        document, from_schema, schema, to_slots=list_model_slots(db, schema.id)
    )
    config, unbound = unbind_temporary(result.config)
    for item in unbound:
        item["reason"] = REBIND_REASON
    connections = eval_presets._load_connections(
        db, env.project_id, eval_presets._connection_ids([config])
    )
    remap_payload = result.to_dict()
    remap_payload.pop("config", None)
    warnings: List[Dict[str, Any]] = eval_presets.connection_warnings(
        config, connections
    )
    return {
        "environment_id": env.id,
        "source": source,
        "config": config,
        "remap": remap_payload,
        "unbound": unbound,
        "warnings": warnings,
    }
