"""Best-run score index ``eval_run_scores`` (plan §4.7, §13 completion hook).

A run gets one row per metric once it is *scorable*:

- ``runs.origin = official`` and linked to a job (``runs.experiment_job_id``);
- the job is terminal (``TERMINAL_JOB_STATUSES``);
- the run completed (``COMPLETED``, or a review status a completed run moves on to).

Both conditions arrive separately (the run's ``run_completed`` at ingest, the job's
terminal status in the dispatcher), so both call :func:`refresh_run_scores` and
whichever comes last writes the rows. Re-scoring (score edits, pass deletion, late
score events) calls it again. A refresh recomputes the run's rows from its scores and
replaces them: metrics that no longer have a mean are removed, and a run that is not
(or no longer) scorable has none. That makes every call, including the backfill,
idempotent.

The mean is the runs-list rule shared with the experiments API
(:func:`run_metric_summaries`): errored items count as 0, unscored items are left out.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (
    EvalExperimentJob,
    EvalRunScore,
    Run,
    RunItem,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunOrigin,
    RunWorkflowStatus,
)
from qym_platform.services.eval_experiments import TERMINAL_JOB_STATUSES
from qym_platform.services.repeat_analysis import pass_at_k_curve

logger = logging.getLogger(__name__)

# A completed run may move on into the review flow; its scores still count.
SCORABLE_RUN_STATUSES = frozenset(
    {
        RunWorkflowStatus.COMPLETED,
        RunWorkflowStatus.SUBMITTED,
        RunWorkflowStatus.APPROVED,
        RunWorkflowStatus.REJECTED,
    }
)
# Repeat-run pass@k threshold when the metric spec has none (as the run page).
DEFAULT_PASS_THRESHOLD = 0.8


def run_metric_summaries(
    db: Session, runs: Mapping[str, Run]
) -> Dict[str, Dict[str, Any]]:
    """Per run: means, directions and item counts.

    ``{"means": {metric: mean | None}, "directions": {metric: direction},
    "item_count": n, "error_item_count": e}``. Means follow the runs list
    (``api/runs.py``): errored items count as 0 and unscored items are left out of
    the denominator; a metric without any scored item has mean ``None``.
    """
    run_ids = list(runs)
    if not run_ids:
        return {}
    counts = {
        run_id: (int(total or 0), int(errors or 0))
        for run_id, total, errors in db.query(
            RunItem.run_id,
            func.count(),
            func.count(RunItem.error),
        )
        .filter(RunItem.run_id.in_(run_ids))
        .group_by(RunItem.run_id)
        .all()
    }
    sums: Dict[str, Dict[str, Tuple[float, int]]] = {}
    rows = (
        db.query(
            RunItemScore.run_id,
            RunItemScore.metric_name,
            func.sum(RunItemScore.score_numeric),
            func.count(RunItemScore.score_numeric),
        )
        .join(
            RunItem,
            (RunItem.run_id == RunItemScore.run_id)
            & (RunItem.item_id == RunItemScore.item_id),
        )
        .filter(RunItemScore.run_id.in_(run_ids), RunItem.error.is_(None))
        .group_by(RunItemScore.run_id, RunItemScore.metric_name)
        .all()
    )
    for run_id, metric, total, count in rows:
        sums.setdefault(run_id, {})[metric] = (float(total or 0.0), int(count or 0))
    directions: Dict[str, Dict[str, str]] = {}
    for spec in db.query(RunMetricSpec).filter(RunMetricSpec.run_id.in_(run_ids)):
        directions.setdefault(spec.run_id, {})[spec.metric_name] = spec.direction
    out: Dict[str, Dict[str, Any]] = {}
    for run_id, run in runs.items():
        scored = sums.get(run_id, {})
        item_count, error_count = counts.get(run_id, (0, 0))
        names = [m for m in (run.metrics or []) if isinstance(m, str)]
        names += [m for m in scored if m not in names]
        means: Dict[str, Optional[float]] = {}
        for metric in names:
            total, count = scored.get(metric, (0.0, 0))
            means[metric] = total / (count + error_count) if count else None
        out[run_id] = {
            "means": means,
            "directions": directions.get(run_id, {}),
            "item_count": item_count,
            "error_item_count": error_count,
        }
    return out


def _direction(value: Any) -> str:
    return "minimize" if str(value or "").strip().lower() == "minimize" else "maximize"


def _pass_at_k(
    db: Session, run: Run, thresholds: Mapping[str, float]
) -> Dict[str, Dict[str, float]]:
    """Repeat runs: ``{metric: {"k": pass@k}}`` from the stored per-pass scores."""
    if int(run.samples or 1) <= 1:
        return {}
    items: Dict[str, Dict[str, List[float]]] = {}
    rows = (
        db.query(
            RunItemPassScore.metric_name,
            RunItemPassScore.item_id,
            RunItemPassScore.score_numeric,
        )
        .filter(RunItemPassScore.run_id == run.id)
        .order_by(
            RunItemPassScore.metric_name,
            RunItemPassScore.item_id,
            RunItemPassScore.pass_number,
        )
        .all()
    )
    for metric, item_id, score in rows:
        # As the run page's group metrics: an unscored pass counts as 0.
        value = float(score) if score is not None else 0.0
        items.setdefault(metric, {}).setdefault(str(item_id), []).append(value)
    return {
        metric: {
            str(k): value
            for k, value in pass_at_k_curve(
                scores, threshold=thresholds.get(metric, DEFAULT_PASS_THRESHOLD)
            ).items()
        }
        for metric, scores in items.items()
    }


def _service_pass_at_k(
    job: EvalExperimentJob, run: Run
) -> Optional[Tuple[str, Dict[str, float]]]:
    """The service ``result``'s pass@k for its ``analysis_metric`` (k = samples).

    Fallback for a metric without stored per-pass scores; the service reports one
    number, for ``k`` = the run's passes.
    """
    result = job.remote_result if isinstance(job.remote_result, Mapping) else {}
    metric = result.get("analysis_metric")
    value = result.get("pass_at_k")
    if (
        not isinstance(metric, str)
        or isinstance(value, bool)
        or not isinstance(value, (int, float))
    ):
        return None
    return metric, {str(max(1, int(run.samples or 1))): float(value)}


def _scorable_job(db: Session, run: Run) -> Optional[EvalExperimentJob]:
    """The run's job when the run is scorable (see module docstring), else ``None``."""
    if (
        run.origin != RunOrigin.OFFICIAL
        or not run.experiment_job_id
        or run.status not in SCORABLE_RUN_STATUSES
    ):
        return None
    job = db.get(EvalExperimentJob, run.experiment_job_id)
    if job is None or job.status not in TERMINAL_JOB_STATUSES:
        return None
    return job


def compute_run_scores(db: Session, run: Run) -> List[Dict[str, Any]]:
    """The ``eval_run_scores`` rows for ``run`` (empty when it isn't scorable)."""
    job = _scorable_job(db, run)
    if job is None:
        return []
    summary = run_metric_summaries(db, {run.id: run}).get(run.id) or {}
    means = {m: v for m, v in (summary.get("means") or {}).items() if v is not None}
    if not means:
        return []
    specs = {
        spec.metric_name: spec
        for spec in db.query(RunMetricSpec).filter(RunMetricSpec.run_id == run.id)
    }
    thresholds = {
        name: float(spec.pass_threshold)
        for name, spec in specs.items()
        if spec.pass_threshold is not None
    }
    pass_at_k = _pass_at_k(db, run, thresholds)
    service = _service_pass_at_k(job, run)
    if service is not None and not pass_at_k.get(service[0]):
        pass_at_k[service[0]] = service[1]
    now = utc_now_naive()
    return [
        {
            "run_id": run.id,
            "metric_name": metric,
            "project_id": run.project_id,
            "environment_id": job.environment_id,
            "dataset_id": run.dataset_id,
            "dataset_version_id": run.dataset_version_id,
            "mean_score": float(mean),
            "direction": _direction(
                specs[metric].direction if metric in specs else None
            ),
            "pass_at_k": pass_at_k.get(metric) or None,
            "item_count": int(summary.get("item_count") or 0),
            "error_item_count": int(summary.get("error_item_count") or 0),
            "completed_at": run.ended_at,
            "computed_at": now,
        }
        for metric, mean in means.items()
    ]


def _upsert(db: Session, rows: List[Dict[str, Any]]) -> None:
    table = EvalRunScore.__table__
    factory = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    statement = factory(table).values(rows)
    keys = {"run_id", "metric_name"}
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[table.c.run_id, table.c.metric_name],
            set_={
                column.name: statement.excluded[column.name]
                for column in table.columns
                if column.name not in keys
            },
        )
    )


def refresh_run_scores(db: Session, run: Run) -> int:
    """Recompute ``run``'s rows inside the caller's transaction; returns the count.

    Upserts the current metrics and deletes the run's other rows, so it is safe to
    call any number of times and in any order. The caller commits.
    """
    db.flush()
    rows = compute_run_scores(db, run)
    stale = delete(EvalRunScore).where(EvalRunScore.run_id == run.id)
    if rows:
        stale = stale.where(
            EvalRunScore.metric_name.notin_([row["metric_name"] for row in rows])
        )
        _upsert(db, rows)
    db.execute(stale.execution_options(synchronize_session=False))
    return len(rows)


def sync_run_scores(db: Session, run: Optional[Run]) -> int:
    """Hook form of :func:`refresh_run_scores`: never raises into the caller.

    Runs in a savepoint, so a failure only drops the index update (the backfill can
    repair it) and never the caller's own changes.
    """
    if run is None or run.origin != RunOrigin.OFFICIAL:
        return 0  # local runs never have rows
    try:
        with db.begin_nested():
            return refresh_run_scores(db, run)
    except Exception:  # noqa: BLE001
        logger.warning(
            "eval_run_scores: refresh failed for run %s", run.id, exc_info=True
        )
        return 0


def sync_job_scores(db: Session, job: EvalExperimentJob) -> int:
    """Dispatcher completion hook: refresh the linked run once the job is terminal."""
    if job.status not in TERMINAL_JOB_STATUSES:
        return 0
    run = None
    if job.run_id:
        run = db.get(Run, job.run_id)
    if run is None:
        run = db.execute(
            select(Run).where(Run.experiment_job_id == job.id).limit(1)
        ).scalar_one_or_none()
    return sync_run_scores(db, run)


def backfill_run_scores(
    db: Session,
    *,
    project_id: Optional[str] = None,
    batch_size: int = 200,
) -> Dict[str, int]:
    """Refresh every official, linked run (optionally in one project).

    Idempotent: each run is recomputed from its scores and its rows replaced, so the
    backfill can be re-run at any time (e.g. after a failed hook). Commits per batch;
    a run that fails is logged, counted in ``failed`` and skipped.
    """
    stats = {"runs": 0, "scored_runs": 0, "rows": 0, "failed": 0}
    last_id = ""
    while True:
        query = (
            select(Run)
            .where(
                Run.origin == RunOrigin.OFFICIAL,
                Run.experiment_job_id.isnot(None),
                Run.id > last_id,
            )
            .order_by(Run.id)
            .limit(batch_size)
        )
        if project_id:
            query = query.where(Run.project_id == project_id)
        runs: Iterable[Run] = db.execute(query).scalars().all()
        if not runs:
            break
        for run in runs:
            last_id = run.id
            stats["runs"] += 1
            try:
                with db.begin_nested():
                    written = refresh_run_scores(db, run)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "eval_run_scores backfill: run %s failed", run.id, exc_info=True
                )
                stats["failed"] += 1
                continue
            stats["rows"] += written
            stats["scored_runs"] += 1 if written else 0
        db.commit()
        db.expunge_all()
    return stats


__all__ = [
    "SCORABLE_RUN_STATUSES",
    "backfill_run_scores",
    "compute_run_scores",
    "refresh_run_scores",
    "run_metric_summaries",
    "sync_job_scores",
    "sync_run_scores",
]
