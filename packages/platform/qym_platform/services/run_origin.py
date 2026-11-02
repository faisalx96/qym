"""Run origin (official vs local) for run listings (plan §11).

``Run.origin`` is ``official`` only when ingest verified a launch token
(``services/eval_run_linking.py``). Listings expose it as ``origin`` plus a small
``experiment`` reference so the UI can badge the run and link to the experiment.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Tuple

from sqlalchemy.orm import Session

from qym_platform.db.models import EvalExperiment, EvalExperimentJob, RunOrigin

ORIGIN_VALUES = tuple(origin.value for origin in RunOrigin)


def parse_origin_filter(raw: Optional[str]) -> Optional[RunOrigin]:
    """``official`` / ``local`` → that origin; empty or ``all`` → no filter.

    Raises ``ValueError`` for anything else. A non-string (an unresolved FastAPI
    ``Query`` default when the endpoint is called directly) means no filter.
    """
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    if value in ("", "all"):
        return None
    try:
        return RunOrigin(value)
    except ValueError:
        raise ValueError(
            f"Invalid origin: {raw!r} (expected one of: all, "
            + ", ".join(ORIGIN_VALUES)
            + ")"
        ) from None


def _ref(
    job_id: str, experiment_id: str, name: Optional[str], latency: Any
) -> Dict[str, Any]:
    """The ``experiment`` reference of a run (``latency_sensitive`` is immutable)."""
    return {
        "id": experiment_id,
        "name": name or "",
        "job_id": job_id,
        "latency_sensitive": bool(latency),
    }


def experiment_refs_for_jobs(
    db: Session, job_ids: Iterable[Optional[str]]
) -> Dict[str, Dict[str, Any]]:
    """``{job_id: {"id", "name", "job_id", "latency_sensitive"}}``, in one query."""
    ids = {job_id for job_id in job_ids if job_id}
    if not ids:
        return {}
    rows = (
        db.query(
            EvalExperimentJob.id,
            EvalExperiment.id,
            EvalExperiment.name,
            EvalExperiment.latency_sensitive,
        )
        .join(EvalExperiment, EvalExperiment.id == EvalExperimentJob.experiment_id)
        .filter(EvalExperimentJob.id.in_(ids))
        .all()
    )
    return {
        job_id: _ref(job_id, experiment_id, name, latency)
        for job_id, experiment_id, name, latency in rows
    }


def experiment_refs_and_versioning(
    db: Session, job_ids: Iterable[Optional[str]]
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, str]]]:
    """:func:`experiment_refs_for_jobs` plus each job's versioning, in one query."""
    from qym_platform.services.run_versioning import resolve_job_versioning

    ids = {job_id for job_id in job_ids if job_id}
    if not ids:
        return {}, {}
    rows = (
        db.query(
            EvalExperimentJob.id,
            EvalExperiment.id,
            EvalExperiment.name,
            EvalExperiment.latency_sensitive,
            EvalExperimentJob.remote_versioning,
            EvalExperimentJob.remote_status,
        )
        .join(EvalExperiment, EvalExperiment.id == EvalExperimentJob.experiment_id)
        .filter(EvalExperimentJob.id.in_(ids))
        .all()
    )
    refs = {
        job_id: _ref(job_id, experiment_id, name, latency)
        for job_id, experiment_id, name, latency, _, _ in rows
    }
    versioning = resolve_job_versioning(
        db, ((job_id, stored, status) for job_id, _, _, _, stored, status in rows)
    )
    return refs, versioning


def run_origin_fields(
    run: Any, experiments: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    """The ``origin`` / ``experiment`` fields a run listing row carries."""
    origin = getattr(run.origin, "value", run.origin) or RunOrigin.LOCAL.value
    job_id = getattr(run, "experiment_job_id", None)
    experiment = experiments.get(job_id) if job_id else None
    return {
        "origin": str(origin),
        "experiment": dict(experiment) if experiment else None,
    }
