"""Read a run's stored launch config without loading whole JSON columns.

``runs.run_metadata`` also holds what the SDK reports (summaries, trace stats, …) and
can be large; the launch config is one key of it, ``qym_config`` (§10.1), which is
where ``env_overrides``, ``evaluator`` and ``slot_bindings`` live. The job row keeps a
copy at ``request_body.evaluator.config.run_metadata.qym_config``, next to the whole
materialized request.

These helpers extract only the requested keys with SQL JSON paths (``->`` / ``#>`` on
PostgreSQL, ``JSON_EXTRACT`` on SQLite), in one query per call however many runs or
jobs are asked for. The best-run ranking, the best-run base and promote use them, so
neither ``run_metadata``, ``run_config`` nor the job's ``request_body`` /
``remote_result`` is loaded to read a configuration.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Mapping, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from qym_platform.db.models import EvalExperimentJob, Run

QYM_CONFIG = "qym_config"
QYM_LAUNCH = "qym_launch"
# request_body → evaluator.config.run_metadata.qym_config
JOB_CONFIG_PATH = ("evaluator", "config", "run_metadata", QYM_CONFIG)


def run_metadata_values(
    db: Session, run_ids: Iterable[Optional[str]], keys: Sequence[str]
) -> Dict[str, Dict[str, Any]]:
    """``{run_id: {key: value}}`` for top-level ``run_metadata`` keys.

    Missing keys (and JSON ``null``) are left out, so ``.get`` works as on the
    whole mapping.
    """
    ids = sorted({run_id for run_id in run_ids if run_id})
    if not ids or not keys:
        return {}
    columns = [Run.run_metadata[key].label(f"k{i}") for i, key in enumerate(keys)]
    result: Dict[str, Dict[str, Any]] = {}
    for row in db.execute(select(Run.id, *columns).where(Run.id.in_(ids))):
        result[row[0]] = {
            key: value for key, value in zip(keys, row[1:]) if value is not None
        }
    return result


def run_qym_config(db: Session, run_id: Optional[str]) -> Optional[Mapping[str, Any]]:
    """The run's ``run_metadata.qym_config``, or ``None``."""
    value = run_metadata_values(db, [run_id], [QYM_CONFIG]).get(run_id or "", {})
    config = value.get(QYM_CONFIG)
    return config if isinstance(config, Mapping) else None


def job_qym_configs(
    db: Session, job_ids: Iterable[Optional[str]]
) -> Dict[str, Mapping[str, Any]]:
    """``{job_id: qym_config}`` from the jobs' request bodies (missing ones left out)."""
    ids = sorted({job_id for job_id in job_ids if job_id})
    if not ids:
        return {}
    path = EvalExperimentJob.request_body[JOB_CONFIG_PATH]
    return {
        job_id: value
        for job_id, value in db.execute(
            select(EvalExperimentJob.id, path).where(EvalExperimentJob.id.in_(ids))
        )
        if isinstance(value, Mapping)
    }


def job_qym_config(db: Session, job_id: Optional[str]) -> Optional[Mapping[str, Any]]:
    """The job's ``request_body…run_metadata.qym_config``, or ``None``."""
    return job_qym_configs(db, [job_id]).get(job_id or "")


__all__ = [
    "JOB_CONFIG_PATH",
    "QYM_CONFIG",
    "QYM_LAUNCH",
    "job_qym_config",
    "job_qym_configs",
    "run_metadata_values",
    "run_qym_config",
]
