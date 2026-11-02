"""Run page **Experiment** panel payload (plan §11, §12.3, issue #26).

``run_experiment_panel`` returns ``None`` for local runs. For an official run it builds
the panel from ``run_metadata`` alone (``qym_launch`` + the secret-free ``qym_config``,
§10.1), so the panel still renders when the job row is gone, and enriches it from the
linked ``EvalExperimentJob`` when that row exists: remote job id and status, the
service ``result``, ``remote_versioning``, and the environment and experiment names.

Nothing here carries a secret: the launch token is never read, ``{"$secret": ref}``
values are dropped and literal values under secret-looking keys are masked
(``redact_secret_refs``) in every mapping that leaves this module.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    EvalEnvironment,
    EvalExperiment,
    EvalExperimentJob,
    Run,
    RunOrigin,
)
from qym_platform.services.eval_experiments import redact_secret_refs

_LAUNCH_FIELDS = ("experiment_id", "job_id", "environment_id", "combo_index", "attempt")


def _clean(value: Any) -> Any:
    """Secret-free copy: refs dropped, secret-looking literals masked."""
    return _drop_refs(redact_secret_refs(value))


def _drop_refs(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            k: _drop_refs(v)
            for k, v in value.items()
            if not (isinstance(v, Mapping) and "$secret" in v)
        }
    if isinstance(value, list):
        return [
            _drop_refs(v)
            for v in value
            if not (isinstance(v, Mapping) and "$secret" in v)
        ]
    return value


def _mapping(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def run_params_summary(
    run: Run, job: Optional[EvalExperimentJob] = None
) -> Dict[str, Any]:
    """The secret-free launch parameters of an official run, without any query.

    ``{"sweep": {pointer: value}, "slot_bindings": {slot: binding}, "base_source":
    {...} | None, "schema_hash": str | None, "samples": int | None, "has_config":
    bool}``, read from ``qym_config`` with the job row (when given) as the fallback
    for the swept values, as the panel does.
    """
    return params_summary(
        _mapping(run.run_metadata).get("qym_config"),
        run_samples=run.samples,
        job_params=job.params if job is not None else None,
    )


def params_summary(
    qym_config: Any, *, run_samples: Any = None, job_params: Any = None
) -> Dict[str, Any]:
    """:func:`run_params_summary` from an already extracted ``qym_config``.

    The best-run ranking reads only ``run_metadata.qym_config`` in SQL
    (``eval_config_snapshot``) and passes it here with the run's ``samples`` and
    the job's ``params``.
    """
    config = _mapping(qym_config)
    evaluator = _mapping(config.get("evaluator"))
    samples = _mapping(evaluator.get("config")).get("samples")
    sweep = _clean(_mapping(config.get("sweep")))
    if not sweep and job_params is not None:
        sweep = _clean(_mapping(_mapping(job_params).get("sweep")))
    return {
        "sweep": sweep,
        "slot_bindings": _clean(_mapping(config.get("slot_bindings"))),
        "base_source": _clean(_mapping(config.get("base_source"))) or None,
        "schema_hash": config.get("schema_hash"),
        "samples": (
            samples
            if isinstance(samples, int) and not isinstance(samples, bool)
            else (int(run_samples) if run_samples else None)
        ),
        "has_config": bool(config),
    }


def run_experiment_panel(db: Session, run: Run) -> Optional[Dict[str, Any]]:
    """The panel payload for an official run, ``None`` otherwise."""
    if run.origin != RunOrigin.OFFICIAL:
        return None
    metadata = _mapping(run.run_metadata)
    launch = _mapping(metadata.get("qym_launch"))
    config = _mapping(metadata.get("qym_config"))

    panel: Dict[str, Any] = {
        "origin": RunOrigin.OFFICIAL.value,
        # Whitelisted launch fields only; the token never leaves ingest.
        **{key: launch.get(key) for key in _LAUNCH_FIELDS},
        "schema_hash": config.get("schema_hash"),
        "base_source": _clean(_mapping(config.get("base_source"))) or None,
        "sweep": _clean(_mapping(config.get("sweep"))),
        "slot_bindings": _clean(_mapping(config.get("slot_bindings"))),
        "has_config": bool(config),
        "experiment_name": None,
        "experiment_status": None,
        "experiment_available": False,
        "environment_name": None,
        "job_available": False,
        "job_status": None,
        "remote_job_id": None,
        "remote_status": None,
        "remote_result": None,
        "remote_versioning": None,
        "error": None,
        "submitted_at": None,
        "finished_at": None,
    }

    job = db.get(EvalExperimentJob, run.experiment_job_id) if run.experiment_job_id else None
    experiment = None
    if job is not None:
        experiment = db.get(EvalExperiment, job.experiment_id)
        # Links are only trusted inside the run's own project.
        if experiment is None or experiment.project_id != run.project_id:
            job, experiment = None, None
    if job is None and panel["experiment_id"]:
        candidate = db.get(EvalExperiment, str(panel["experiment_id"]))
        if candidate is not None and candidate.project_id == run.project_id:
            experiment = candidate

    if job is not None:
        # The verified link is the source of truth for the ids.
        panel.update(
            {
                "job_id": job.id,
                "experiment_id": job.experiment_id,
                "environment_id": job.environment_id,
                "combo_index": job.combo_index,
                "attempt": job.attempt,
                "job_available": True,
                "job_status": job.status.value if job.status else None,
                "remote_job_id": job.remote_job_id,
                "remote_status": job.remote_status,
                "remote_result": (
                    _clean(job.remote_result) if job.remote_result is not None else None
                ),
                "remote_versioning": (
                    _clean(job.remote_versioning)
                    if job.remote_versioning is not None
                    else None
                ),
                "error": job.error,
                "submitted_at": to_api_timestamp(job.submitted_at),
                "finished_at": to_api_timestamp(job.finished_at),
            }
        )
        if not panel["sweep"]:
            params = _mapping(job.params)
            panel["sweep"] = _clean(_mapping(params.get("sweep")))
    if experiment is not None:
        panel["experiment_available"] = True
        panel["experiment_name"] = experiment.name
        panel["experiment_status"] = (
            experiment.status.value if experiment.status else None
        )
        if not panel["base_source"]:
            panel["base_source"] = _clean(_mapping(experiment.base_source)) or None
    if panel["environment_id"]:
        env = db.get(EvalEnvironment, str(panel["environment_id"]))
        if env is not None and env.project_id == run.project_id:
            panel["environment_name"] = env.name
    return panel
