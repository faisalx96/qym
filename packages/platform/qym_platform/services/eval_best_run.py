"""Best-run ranking for "Start from best run" (plan §10.2, §5.1, §4.7; issue #37).

``rank_best_runs`` ranks the official runs of one environment on one dataset version
from the ``eval_run_scores`` index (``services/eval_run_scores.py``), and is served by
``GET /v1/projects/{pid}/eval-environments/{eid}/best-runs``.

Eligibility (every rule is in the SQL, so nothing is filtered after the limit):

- ``runs.origin = official``, linked to a job (``runs.experiment_job_id``) of **this**
  environment, in the environment's project, not soft-deleted;
- the run completed: ``COMPLETED``, or a review status a completed run moves on to
  (``SUBMITTED``/``APPROVED``). ``REJECTED`` runs are never a base;
- an ``eval_run_scores`` row for the metric, on the **same** ``dataset_version_id``.
  Scores on other versions are not comparable, so there is no cross-version mode.
  A custom dataset string (no qym dataset / version) is never eligible;
- unless ``exclude_errored`` is off, ``error_item_count / item_count <= 20%``, so a run
  that "wins" by crashing on hard items is not picked.

Metric: the request's, else ``environment.ranking_metric``, else the metric most runs on
the version have (then on the whole environment). Direction is the majority
``direction`` of the metric's rows. ``k``: the request's, else ``environment.ranking_k``;
with no ``k`` the pass@k tie-breaker is skipped (each run still lists its values).

Order: ``mean_score`` (by direction) → ``pass_at_k[k]`` (higher first, missing last) →
``item_count`` (larger first) → most recent (``completed_at``, else run creation) →
``run_id``. SQL orders by the indexed ``mean_score`` and fetches ``limit`` rows plus any
row tied with the last one on ``mean_score``; the pass@k tie-break (JSON) is then applied
in Python. Runs, jobs and scores come back in that one joined query (no N+1).

Versioning: ``remote_versioning`` is the job's stored value; for jobs finished before it
was stored, it is read from the job's ``remote_result`` (``versioning_metadata``, else the
legacy flat ``agent_version``/``kb_version`` keys, guide §5).

When the version has no eligible run at all, ``latest_version_with_runs`` points to the
newest version of the same dataset that has one (any metric).

Response shape (what #38 consumes)::

    {
      "environment_id": "…",
      "dataset": {"id": "…", "name": "…", "slug": "…"} | null,
      "dataset_version": {"id": "…", "version": "v3", "name": "…"} | null,
      "metric": "accuracy" | null,
      "metric_source": "request" | "environment" | "most_common" | null,
      "direction": "maximize" | "minimize" | null,
      "k": 3 | null,
      "exclude_errored": true,
      "max_error_ratio": 0.2,
      "metrics": [{"name": "accuracy", "run_count": 12}, …],   # on this version
      "eligible_count": 12,            # before the error filter
      "excluded_errored_count": 2,     # hidden by the error filter
      "runs": [
        {
          "rank": 1,
          "run_id": "…", "external_run_id": "…" | null, "task": "…", "model": "…" | null,
          "status": "COMPLETED",
          "job_id": "…", "experiment_id": "…", "combo_index": 0,
          "metric": "accuracy", "direction": "maximize",
          "score": 0.84,                      # mean_score
          "pass_at_k": {"1": 0.8, "3": 0.9} | null,
          "pass_at_k_value": 0.9 | null,      # pass_at_k[k]
          "item_count": 50, "error_item_count": 1, "error_ratio": 0.02,
          "completed_at": "2026-09-30T12:00:00Z" | null,
          "age_seconds": 3600 | null,
          "remote_versioning": {"agent_version": "…", "kb_version": "…"} | null,
          "params": {"sweep": {…}, "slot_bindings": {…}, "base_source": {…} | null,
                     "schema_hash": "…" | null, "samples": 3 | null, "has_config": true}
        }, …
      ],
      "reason": null | "custom_dataset" | "unknown_dataset_version" | "no_metric"
                     | "no_runs_on_version" | "no_runs_for_metric" | "all_excluded",
      "latest_version_with_runs": {"id": "…", "version": "v2", "name": "…",
                                   "run_count": 4} | null,
      "latest_remote_versioning": {"versioning": {…}, "job_id": "…",
                                   "run_id": "…" | null, "finished_at": "…"} | null
    }

``latest_remote_versioning`` (#38) is the newest versioning a finished job of the
environment reported (``latest_versioning``); the launch form compares a run's
``remote_versioning`` with it to warn about agent/KB drift.

Nothing here carries a secret: params go through the run panel's redaction and
``remote_versioning`` is the redacted copy.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Tuple

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    Dataset,
    DatasetAlias,
    DatasetVersion,
    DatasetVersionStatus,
    EvalEnvironment,
    EvalExperimentJob,
    EvalRunScore,
    Run,
    RunOrigin,
    RunWorkflowStatus,
)
from qym_platform.services.eval_dispatcher import extract_versioning
from qym_platform.services.eval_experiments import redact_secret_refs
from qym_platform.services.run_experiment_panel import run_params_summary

# Runs in these statuses completed; review may have moved them on. REJECTED is out.
ELIGIBLE_RUN_STATUSES = (
    RunWorkflowStatus.COMPLETED,
    RunWorkflowStatus.SUBMITTED,
    RunWorkflowStatus.APPROVED,
)
# Runs with more than this share of errored items are excluded by default.
MAX_ERROR_PERCENT = 20
DEFAULT_LIMIT = 5
MAX_LIMIT = 50


class BestRunError(Exception):
    """A request the API answers with ``status_code`` (bad or foreign ids)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class _Target:
    dataset: Optional[Dataset]
    version: Optional[DatasetVersion]
    reason: Optional[str]


# --------------------------------------------------------------------------- dataset


def _find_dataset(db: Session, project_id: str, ref: str) -> Optional[Dataset]:
    """A live dataset of the project by id, else by slug, else by name."""
    base = select(Dataset).where(
        Dataset.project_id == project_id, Dataset.deleted_at.is_(None)
    )
    for column in (Dataset.id, Dataset.slug, Dataset.name):
        found = db.execute(base.where(column == ref).limit(1)).scalar_one_or_none()
        if found is not None:
            return found
    return None


def _version_by_ref(
    db: Session, dataset: Dataset, ref: str
) -> Optional[DatasetVersion]:
    """A version by its ``vN`` name, else by alias (as ``api/datasets.py``)."""
    version = db.execute(
        select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset.id, DatasetVersion.version == ref
        )
    ).scalar_one_or_none()
    if version is not None:
        return version
    alias = db.execute(
        select(DatasetAlias).where(
            DatasetAlias.dataset_id == dataset.id, DatasetAlias.alias == ref
        )
    ).scalar_one_or_none()
    return db.get(DatasetVersion, alias.dataset_version_id) if alias else None


def _default_version(db: Session, dataset: Dataset) -> Optional[DatasetVersion]:
    """What a run with no version resolves to: ``production`` alias, else latest published."""
    version = _version_by_ref(db, dataset, "production")
    if version is not None:
        return version
    return db.execute(
        select(DatasetVersion)
        .where(
            DatasetVersion.dataset_id == dataset.id,
            DatasetVersion.status == DatasetVersionStatus.PUBLISHED,
        )
        .order_by(
            DatasetVersion.published_at.desc().nullslast(),
            DatasetVersion.created_at.desc(),
        )
        .limit(1)
    ).scalar_one_or_none()


def resolve_target(
    db: Session,
    env: EvalEnvironment,
    *,
    dataset_id: Optional[str] = None,
    dataset_version_id: Optional[str] = None,
    dataset_version: Optional[str] = None,
) -> _Target:
    """The dataset version to rank on.

    ``dataset_version_id`` wins (it must belong to the project, and to ``dataset_id``
    when both are given). Otherwise ``dataset_id`` (id, slug or name, as the launch
    form's ``evaluator.dataset`` string) with ``dataset_version`` (version or alias),
    else the version a run without one resolves to. A dataset string that is not a
    qym dataset is a custom dataset: never eligible, not an error.
    """
    project_id = env.project_id
    if dataset_version_id:
        version = db.get(DatasetVersion, dataset_version_id)
        dataset = db.get(Dataset, version.dataset_id) if version else None
        if (
            version is None
            or dataset is None
            or dataset.project_id != project_id
            or dataset.deleted_at is not None
        ):
            raise BestRunError(404, "Dataset version not found")
        if dataset_id and dataset_id not in (dataset.id, dataset.slug, dataset.name):
            raise BestRunError(400, "dataset_version_id is not a version of dataset_id")
        return _Target(dataset, version, None)
    if not dataset_id:
        raise BestRunError(400, "dataset_id or dataset_version_id is required")
    dataset = _find_dataset(db, project_id, dataset_id)
    if dataset is None:
        return _Target(None, None, "custom_dataset")
    ref = (dataset_version or "").strip()
    version = (
        _version_by_ref(db, dataset, ref) if ref else _default_version(db, dataset)
    )
    if version is None:
        return _Target(
            dataset, None, "unknown_dataset_version" if ref else "custom_dataset"
        )
    return _Target(dataset, version, None)


# --------------------------------------------------------------------------- queries


def _eligible(query, env: EvalEnvironment):
    """Join runs and jobs onto an ``EvalRunScore`` select and apply eligibility."""
    return (
        query.join(Run, Run.id == EvalRunScore.run_id)
        .join(EvalExperimentJob, EvalExperimentJob.id == Run.experiment_job_id)
        .where(
            EvalRunScore.environment_id == env.id,
            EvalRunScore.project_id == env.project_id,
            EvalRunScore.dataset_version_id.isnot(None),
            Run.project_id == env.project_id,
            Run.origin == RunOrigin.OFFICIAL,
            Run.status.in_(ELIGIBLE_RUN_STATUSES),
            Run.deleted_at.is_(None),
            # Guards a stale denormalized row (the run's version is the truth).
            Run.dataset_version_id == EvalRunScore.dataset_version_id,
            EvalExperimentJob.environment_id == env.id,
        )
    )


def _error_ok():
    """``error_item_count / item_count <= MAX_ERROR_PERCENT%`` in integer arithmetic."""
    return (
        EvalRunScore.error_item_count * 100
        <= EvalRunScore.item_count * MAX_ERROR_PERCENT
    )


def _metric_counts(
    db: Session, env: EvalEnvironment, version_id: Optional[str]
) -> List[Tuple[str, int]]:
    """``[(metric, run_count)]`` most common first (on the version, or env-wide)."""
    query = _eligible(
        select(EvalRunScore.metric_name, func.count(EvalRunScore.run_id)), env
    )
    if version_id is not None:
        query = query.where(EvalRunScore.dataset_version_id == version_id)
    rows = db.execute(query.group_by(EvalRunScore.metric_name)).all()
    return sorted(((str(m), int(n)) for m, n in rows), key=lambda r: (-r[1], r[0]))


def _direction_counts(
    db: Session, env: EvalEnvironment, version_id: str, metric: str
) -> Tuple[Optional[str], int, int]:
    """(majority direction, eligible count, count hidden by the error filter)."""
    rows = db.execute(
        _eligible(
            select(
                EvalRunScore.direction,
                func.count(),
                func.sum(case((_error_ok(), 0), else_=1)),
            ),
            env,
        )
        .where(
            EvalRunScore.dataset_version_id == version_id,
            EvalRunScore.metric_name == metric,
        )
        .group_by(EvalRunScore.direction)
    ).all()
    if not rows:
        return None, 0, 0
    by_direction = {str(d): int(n) for d, n, _ in rows}
    direction = (
        "minimize"
        if by_direction.get("minimize", 0) > by_direction.get("maximize", 0)
        else "maximize"
    )
    return (
        direction,
        sum(by_direction.values()),
        sum(int(e or 0) for _, _, e in rows),
    )


def _latest_version_with_runs(
    db: Session, env: EvalEnvironment, dataset: Dataset, exclude_version_id: str
) -> Optional[Dict[str, Any]]:
    """The newest other version of ``dataset`` that has an eligible run (any metric)."""
    row = db.execute(
        _eligible(
            select(
                DatasetVersion.id,
                DatasetVersion.version,
                DatasetVersion.name,
                func.count(func.distinct(EvalRunScore.run_id)),
            ),
            env,
        )
        .join(DatasetVersion, DatasetVersion.id == EvalRunScore.dataset_version_id)
        .where(
            DatasetVersion.dataset_id == dataset.id,
            EvalRunScore.dataset_version_id != exclude_version_id,
        )
        .group_by(
            DatasetVersion.id,
            DatasetVersion.version,
            DatasetVersion.name,
            DatasetVersion.created_at,
        )
        .order_by(DatasetVersion.created_at.desc(), DatasetVersion.id.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    return {
        "id": row[0],
        "version": row[1],
        "name": row[2] or "",
        "run_count": int(row[3]),
    }


# --------------------------------------------------------------------------- ranking


def _pass_value(pass_at_k: Any, k: Optional[int]) -> Optional[float]:
    if k is None or not isinstance(pass_at_k, Mapping):
        return None
    value = pass_at_k.get(str(k))
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _recency(score: EvalRunScore, run: Run) -> datetime:
    return score.completed_at or run.ended_at or run.created_at or datetime.min


def sort_key(
    score: EvalRunScore, run: Run, *, direction: str, k: Optional[int]
) -> Tuple[Any, ...]:
    """Ascending key: best first (mean → pass@k → item_count → recency → id)."""
    mean = float(score.mean_score)
    passed = _pass_value(score.pass_at_k, k)
    recency = _recency(score, run)
    return (
        mean if direction == "minimize" else -mean,
        0 if passed is not None else 1,
        -(passed or 0.0),
        -int(score.item_count or 0),
        # Descending recency without timestamp(): ordinal days, then seconds.
        -recency.toordinal(),
        -(recency.hour * 3600 + recency.minute * 60 + recency.second),
        -recency.microsecond,
        run.id,
    )


def job_versioning(job: EvalExperimentJob) -> Optional[Dict[str, Any]]:
    """Stored ``remote_versioning``, else from the result (legacy flat keys too)."""
    value = job.remote_versioning
    if not isinstance(value, Mapping) or not value:
        value = extract_versioning(job.remote_result)
    return (
        redact_secret_refs(dict(value))
        if isinstance(value, Mapping) and value
        else None
    )


# Finished jobs scanned for the newest reported versioning (older ones may not have it).
_LATEST_VERSIONING_SCAN = 50


def latest_versioning(db: Session, env: EvalEnvironment) -> Optional[Dict[str, Any]]:
    """The newest ``remote_versioning`` a finished job of ``env`` reported (#38).

    ``{"versioning", "job_id", "run_id", "finished_at"}`` or ``None``. This is what
    the environment runs now, as far as the platform knows: the Evaluation Service
    exposes no version endpoint, so the latest job result is the source.
    """
    jobs = (
        db.query(EvalExperimentJob)
        .filter(
            EvalExperimentJob.environment_id == env.id,
            EvalExperimentJob.finished_at.isnot(None),
        )
        .order_by(EvalExperimentJob.finished_at.desc(), EvalExperimentJob.id.desc())
        .limit(_LATEST_VERSIONING_SCAN)
    )
    for job in jobs:
        value = job_versioning(job)
        if value:
            return {
                "versioning": value,
                "job_id": job.id,
                "run_id": job.run_id,
                "finished_at": to_api_timestamp(job.finished_at),
            }
    return None


def _candidates(
    db: Session,
    env: EvalEnvironment,
    *,
    version_id: str,
    metric: str,
    direction: str,
    limit: int,
    exclude_errored: bool,
) -> List[Tuple[EvalRunScore, Run, EvalExperimentJob]]:
    """Top ``limit`` rows by mean plus every row tied with the last one."""
    base = _eligible(select(EvalRunScore, Run, EvalExperimentJob), env).where(
        EvalRunScore.dataset_version_id == version_id,
        EvalRunScore.metric_name == metric,
    )
    if exclude_errored:
        base = base.where(_error_ok())
    mean_order = (
        EvalRunScore.mean_score.asc()
        if direction == "minimize"
        else EvalRunScore.mean_score.desc()
    )
    recency = func.coalesce(EvalRunScore.completed_at, Run.ended_at, Run.created_at)
    rows = list(
        db.execute(
            base.order_by(
                mean_order,
                EvalRunScore.item_count.desc(),
                recency.desc(),
                EvalRunScore.run_id,
            ).limit(limit)
        ).all()
    )
    if len(rows) == limit:
        # pass@k (JSON) may reorder runs tied on the mean across the cut-off.
        seen = [score.run_id for score, _, _ in rows]
        rows += list(
            db.execute(
                base.where(
                    EvalRunScore.mean_score == rows[-1][0].mean_score,
                    EvalRunScore.run_id.notin_(seen),
                )
            ).all()
        )
    return rows


def _run_payload(
    rank: int,
    score: EvalRunScore,
    run: Run,
    job: EvalExperimentJob,
    *,
    direction: str,
    k: Optional[int],
    now: datetime,
) -> Dict[str, Any]:
    item_count = int(score.item_count or 0)
    errors = int(score.error_item_count or 0)
    completed = score.completed_at or run.ended_at
    reference = completed or run.created_at
    return {
        "rank": rank,
        "run_id": run.id,
        "external_run_id": run.external_run_id,
        "task": run.task,
        "model": run.model,
        "status": run.status.value if run.status else None,
        "job_id": job.id,
        "experiment_id": job.experiment_id,
        "combo_index": job.combo_index,
        "metric": score.metric_name,
        "direction": score.direction or direction,
        "score": float(score.mean_score),
        "pass_at_k": (
            dict(score.pass_at_k) if isinstance(score.pass_at_k, Mapping) else None
        ),
        "pass_at_k_value": _pass_value(score.pass_at_k, k),
        "item_count": item_count,
        "error_item_count": errors,
        "error_ratio": (errors / item_count) if item_count else 0.0,
        "completed_at": to_api_timestamp(completed),
        "age_seconds": (
            max(0, int((now - reference).total_seconds())) if reference else None
        ),
        "remote_versioning": job_versioning(job),
        "params": run_params_summary(run, job),
    }


def rank_best_runs(
    db: Session,
    env: EvalEnvironment,
    *,
    dataset_id: Optional[str] = None,
    dataset_version_id: Optional[str] = None,
    dataset_version: Optional[str] = None,
    metric: Optional[str] = None,
    k: Optional[int] = None,
    limit: int = DEFAULT_LIMIT,
    exclude_errored: bool = True,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """The ranked candidates (shape in the module docstring)."""
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    now = now or utc_now_naive()
    target = resolve_target(
        db,
        env,
        dataset_id=dataset_id,
        dataset_version_id=dataset_version_id,
        dataset_version=dataset_version,
    )
    dataset, version = target.dataset, target.version
    k = k if k is not None else env.ranking_k
    out: Dict[str, Any] = {
        "environment_id": env.id,
        "dataset": (
            {"id": dataset.id, "name": dataset.name, "slug": dataset.slug}
            if dataset
            else None
        ),
        "dataset_version": (
            {"id": version.id, "version": version.version, "name": version.name or ""}
            if version
            else None
        ),
        "metric": None,
        "metric_source": None,
        "direction": None,
        "k": k,
        "exclude_errored": bool(exclude_errored),
        "max_error_ratio": MAX_ERROR_PERCENT / 100,
        "metrics": [],
        "eligible_count": 0,
        "excluded_errored_count": 0,
        "runs": [],
        "reason": target.reason,
        "latest_version_with_runs": None,
        "latest_remote_versioning": latest_versioning(db, env),
    }
    if version is None:
        return out

    counts = _metric_counts(db, env, version.id)
    out["metrics"] = [{"name": m, "run_count": n} for m, n in counts]
    requested = (metric or "").strip()
    if requested:
        metric, source = requested, "request"
    elif env.ranking_metric:
        metric, source = env.ranking_metric, "environment"
    else:
        common = counts or _metric_counts(db, env, None)
        metric, source = (common[0][0], "most_common") if common else (None, None)
    out["metric"], out["metric_source"] = metric, source

    if not counts:
        out["reason"] = "no_runs_on_version"
        if dataset is not None:
            out["latest_version_with_runs"] = _latest_version_with_runs(
                db, env, dataset, version.id
            )
        return out
    if metric is None:
        out["reason"] = "no_metric"
        return out

    direction, eligible, hidden = _direction_counts(db, env, version.id, metric)
    out["eligible_count"] = eligible
    out["excluded_errored_count"] = hidden if exclude_errored else 0
    if direction is None:
        out["reason"] = "no_runs_for_metric"
        return out
    out["direction"] = direction

    rows = _candidates(
        db,
        env,
        version_id=version.id,
        metric=metric,
        direction=direction,
        limit=limit,
        exclude_errored=exclude_errored,
    )
    rows.sort(key=lambda r: sort_key(r[0], r[1], direction=direction, k=k))
    out["runs"] = [
        _run_payload(rank, score, run, job, direction=direction, k=k, now=now)
        for rank, (score, run, job) in enumerate(rows[:limit], start=1)
    ]
    if not out["runs"]:
        out["reason"] = "all_excluded"
    return out


__all__ = [
    "BestRunError",
    "ELIGIBLE_RUN_STATUSES",
    "job_versioning",
    "latest_versioning",
    "MAX_ERROR_PERCENT",
    "rank_best_runs",
    "resolve_target",
    "sort_key",
]
