"""Best-run ranking for "Start from best run" (plan §10.2, §5.1, §4.7; issues #37, #38).

``rank_best_runs`` ranks the official runs of one environment from the
``eval_run_scores`` index (``services/eval_run_scores.py``), and is served by
``GET /v1/projects/{pid}/eval-environments/{eid}/best-runs``.

Scope (§10.2): the launch form asks the user for a dataset, a dataset version and
``versioning_metadata`` values **before** it retrieves anything. Each choice narrows the
ranking; whatever is left unchosen is not constrained, so choosing nothing ranks the
environment's runs globally:

- ``dataset_version_id`` (or ``dataset_id`` + ``dataset_version``, a version or alias):
  runs on that version only;
- ``dataset_id`` alone: runs on any version of that dataset;
- ``versioning`` (``{key: [values]}``, any key; ``services/run_versioning.py``): runs
  whose job reported matching versions. Values of a key are alternatives, keys must all
  match, ``__empty__`` matches runs without the key;
- nothing: every eligible run of the environment, across datasets and versions
  (including runs on a custom dataset string). Scores from different datasets or
  versions are not strictly comparable; the UI says so.

``best_run_scope`` lists what can be chosen: the datasets and versions that have
eligible runs, and the versioning keys and values those runs reported.

Eligibility (every rule is in the SQL, so nothing is filtered after the limit):

- ``runs.origin = official``, linked to a job (``runs.experiment_job_id``) of **this**
  environment, in the environment's project, not soft-deleted;
- the run completed: ``COMPLETED``, or a review status a completed run moves on to
  (``SUBMITTED``/``APPROVED``). ``REJECTED`` runs are never a base;
- an ``eval_run_scores`` row for the metric, in the scope;
- unless ``exclude_errored`` is off, ``error_item_count / item_count <= 20%``, so a run
  that "wins" by crashing on hard items is not picked.

Metric: the request's, else ``environment.ranking_metric``, else the metric most runs in
the scope have (then on the whole environment). Direction is the majority
``direction`` of the metric's rows. ``k``: the request's, else ``environment.ranking_k``;
with no ``k`` the pass@k tie-breaker is skipped (each run still lists its values).

Order: ``mean_score`` (by direction) → ``pass_at_k[k]`` (higher first, missing last) →
``item_count`` (larger first) → most recent (``completed_at``, else run creation) →
``run_id``. SQL orders by the indexed ``mean_score`` and fetches ``limit`` rows plus any
row tied with the last one on ``mean_score``; the pass@k tie-break (JSON) is then applied
in Python. Runs, jobs and scores come back in that one joined query (no N+1).

Loading: only the columns the payload needs are read. The configuration summary comes
from ``run_metadata.qym_config`` extracted in SQL (``eval_config_snapshot``): the rest of
``run_metadata``, ``run_config`` and the job's ``request_body``/``remote_result`` are
never loaded (``remote_result`` is read, in one query, only for jobs that finished
before ``remote_versioning`` was stored).

Versioning: ``remote_versioning`` is the job's stored value; for jobs finished before it
was stored, it is read from the job's ``remote_result`` (``versioning_metadata``, else the
legacy flat ``agent_version``/``kb_version`` keys, guide §5).

When a chosen version has no eligible run, ``latest_version_with_runs`` points to the
newest version of the same dataset that has one (any metric).

Response shape (what #38 consumes)::

    {
      "environment_id": "…",
      "dataset": {"id": "…", "name": "…", "slug": "…"} | null,
      "dataset_version": {"id": "…", "version": "v3", "name": "…"} | null,
      "scope": {"dataset": {…} | null, "dataset_version": {…} | null,
                "versioning": {key: [values]}, "global": true | false},
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
          "dataset": {"id": "…", "name": "…"} | null,
          "dataset_version": {"id": "…", "version": "v3"} | null,
          "remote_versioning": {"agent_version": "…", "kb_version": "…"} | null,
          "params": {"sweep": {…}, "slot_bindings": {…}, "base_source": {…} | null,
                     "schema_hash": "…" | null, "samples": 3 | null, "has_config": true}
        }, …
      ],
      "reason": null | "custom_dataset" | "unknown_dataset_version" | "no_metric"
                     | "no_runs_on_version" | "no_runs_in_scope" | "no_runs_for_metric"
                     | "all_excluded",
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
from sqlalchemy.orm import Session, load_only

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
from qym_platform.db.dashboard_models import DashboardRunVersion as RunVersion
from qym_platform.services.eval_config_snapshot import QYM_CONFIG
from qym_platform.services.eval_dispatcher import extract_versioning
from qym_platform.services.eval_experiments import redact_secret_refs
from qym_platform.services.run_experiment_panel import params_summary
from qym_platform.services.run_versioning import versioning_conditions

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
class _Scope:
    """What the user chose to rank on; ``None`` / empty means not constrained."""

    dataset: Optional[Dataset]
    version: Optional[DatasetVersion]
    versioning: Dict[str, List[str]]
    reason: Optional[str]

    @property
    def is_global(self) -> bool:
        return self.dataset is None and self.version is None and not self.versioning


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


def resolve_scope(
    db: Session,
    env: EvalEnvironment,
    *,
    dataset_id: Optional[str] = None,
    dataset_version_id: Optional[str] = None,
    dataset_version: Optional[str] = None,
    versioning: Optional[Mapping[str, List[str]]] = None,
) -> _Scope:
    """The scope to rank in; each part the user did not choose stays open (§10.2).

    ``dataset_version_id`` wins (it must belong to the project, and to ``dataset_id``
    when both are given). Otherwise ``dataset_id`` (id, slug or name) narrows to that
    dataset, and ``dataset_version`` (version or alias) to one of its versions. No
    dataset ranks across every dataset. A dataset string that is not a qym dataset is
    a custom dataset: nothing to rank, not an error.
    """
    project_id = env.project_id
    chosen = {key: list(values) for key, values in (versioning or {}).items() if values}
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
        return _Scope(dataset, version, chosen, None)
    ref = (dataset_version or "").strip()
    if not dataset_id:
        if ref:
            raise BestRunError(400, "dataset_version needs dataset_id")
        return _Scope(None, None, chosen, None)
    dataset = _find_dataset(db, project_id, dataset_id)
    if dataset is None:
        return _Scope(None, None, chosen, "custom_dataset")
    if not ref:
        return _Scope(dataset, None, chosen, None)
    version = _version_by_ref(db, dataset, ref)
    if version is None:
        return _Scope(dataset, None, chosen, "unknown_dataset_version")
    return _Scope(dataset, version, chosen, None)


# --------------------------------------------------------------------------- queries


def _eligible(query, env: EvalEnvironment):
    """Join runs and jobs onto an ``EvalRunScore`` select and apply eligibility."""
    return (
        query.join(Run, Run.id == EvalRunScore.run_id)
        .join(EvalExperimentJob, EvalExperimentJob.id == Run.experiment_job_id)
        .where(
            EvalRunScore.environment_id == env.id,
            EvalRunScore.project_id == env.project_id,
            Run.project_id == env.project_id,
            Run.origin == RunOrigin.OFFICIAL,
            Run.status.in_(ELIGIBLE_RUN_STATUSES),
            Run.deleted_at.is_(None),
            # Guards a stale denormalized row (the run's version is the truth).
            Run.dataset_version_id.is_not_distinct_from(
                EvalRunScore.dataset_version_id
            ),
            EvalExperimentJob.environment_id == env.id,
        )
    )


def _in_scope(query, scope: _Scope):
    """Narrow an eligible query to what the user chose."""
    if scope.version is not None:
        query = query.where(EvalRunScore.dataset_version_id == scope.version.id)
    elif scope.dataset is not None:
        query = query.where(EvalRunScore.dataset_id == scope.dataset.id)
    if scope.versioning:
        query = query.where(*versioning_conditions(Run.id, scope.versioning))
    return query


def _error_ok():
    """``error_item_count / item_count <= MAX_ERROR_PERCENT%`` in integer arithmetic."""
    return (
        EvalRunScore.error_item_count * 100
        <= EvalRunScore.item_count * MAX_ERROR_PERCENT
    )


def _metric_counts(
    db: Session, env: EvalEnvironment, scope: Optional[_Scope]
) -> List[Tuple[str, int]]:
    """``[(metric, run_count)]`` most common first (in the scope, or env-wide)."""
    query = _eligible(
        select(EvalRunScore.metric_name, func.count(EvalRunScore.run_id)), env
    )
    if scope is not None:
        query = _in_scope(query, scope)
    rows = db.execute(query.group_by(EvalRunScore.metric_name)).all()
    return sorted(((str(m), int(n)) for m, n in rows), key=lambda r: (-r[1], r[0]))


def _direction_counts(
    db: Session, env: EvalEnvironment, scope: _Scope, metric: str
) -> Tuple[Optional[str], int, int]:
    """(majority direction, eligible count, count hidden by the error filter)."""
    rows = db.execute(
        _in_scope(
            _eligible(
                select(
                    EvalRunScore.direction,
                    func.count(),
                    func.sum(case((_error_ok(), 0), else_=1)),
                ),
                env,
            ),
            scope,
        )
        .where(EvalRunScore.metric_name == metric)
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
    return _redacted_versioning(value)


def _redacted_versioning(value: Any) -> Optional[Dict[str, Any]]:
    return (
        redact_secret_refs(dict(value))
        if isinstance(value, Mapping) and value
        else None
    )


def _versionings(
    db: Session, stored: Mapping[str, Any]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """``{job_id: versioning}`` from ``{job_id: remote_versioning}``.

    Jobs without a stored value fall back to their ``remote_result``, read in one
    query for those jobs only (the rest of the job row is never loaded).
    """
    out: Dict[str, Optional[Dict[str, Any]]] = {}
    legacy = []
    for job_id, value in stored.items():
        if isinstance(value, Mapping) and value:
            out[job_id] = _redacted_versioning(value)
        else:
            legacy.append(job_id)
    if legacy:
        for job_id, result in db.execute(
            select(EvalExperimentJob.id, EvalExperimentJob.remote_result).where(
                EvalExperimentJob.id.in_(legacy)
            )
        ):
            out[job_id] = _redacted_versioning(extract_versioning(result))
    return out


# Finished jobs scanned for the newest reported versioning (older ones may not have it).
_LATEST_VERSIONING_SCAN = 50


def latest_versioning(db: Session, env: EvalEnvironment) -> Optional[Dict[str, Any]]:
    """The newest ``remote_versioning`` a finished job of ``env`` reported (#38).

    ``{"versioning", "job_id", "run_id", "finished_at"}`` or ``None``. This is what
    the environment runs now, as far as the platform knows: the Evaluation Service
    exposes no version endpoint, so the latest job result is the source.
    """
    rows = db.execute(
        select(
            EvalExperimentJob.id,
            EvalExperimentJob.run_id,
            EvalExperimentJob.finished_at,
            EvalExperimentJob.remote_versioning,
        )
        .where(
            EvalExperimentJob.environment_id == env.id,
            EvalExperimentJob.finished_at.isnot(None),
        )
        .order_by(EvalExperimentJob.finished_at.desc(), EvalExperimentJob.id.desc())
        .limit(_LATEST_VERSIONING_SCAN)
    ).all()
    versionings = _versionings(db, {row[0]: row[3] for row in rows})
    for job_id, run_id, finished_at, _ in rows:
        value = versionings.get(job_id)
        if value:
            return {
                "versioning": value,
                "job_id": job_id,
                "run_id": run_id,
                "finished_at": to_api_timestamp(finished_at),
            }
    return None


# Columns the ranking payload reads; nothing else of the run or job row is loaded.
_RUN_COLUMNS = (
    Run.id,
    Run.external_run_id,
    Run.task,
    Run.model,
    Run.status,
    Run.samples,
    Run.ended_at,
    Run.created_at,
)
_JOB_COLUMNS = (
    EvalExperimentJob.id,
    EvalExperimentJob.experiment_id,
    EvalExperimentJob.combo_index,
    EvalExperimentJob.params,
    EvalExperimentJob.remote_versioning,
)


@dataclass
class _Candidate:
    score: EvalRunScore
    run: Run
    job: EvalExperimentJob
    qym_config: Any
    dataset_name: Optional[str]
    dataset_version: Optional[str]


def _candidates(
    db: Session,
    env: EvalEnvironment,
    *,
    scope: _Scope,
    metric: str,
    direction: str,
    limit: int,
    exclude_errored: bool,
) -> List[_Candidate]:
    """Top ``limit`` rows by mean plus every row tied with the last one."""
    base = (
        _in_scope(
            _eligible(
                select(
                    EvalRunScore,
                    Run,
                    EvalExperimentJob,
                    Run.run_metadata[QYM_CONFIG].label("qym_config"),
                    Dataset.name,
                    DatasetVersion.version,
                ),
                env,
            ),
            scope,
        )
        .outerjoin(Dataset, Dataset.id == EvalRunScore.dataset_id)
        .outerjoin(DatasetVersion, DatasetVersion.id == EvalRunScore.dataset_version_id)
        .where(EvalRunScore.metric_name == metric)
        .options(
            load_only(*_RUN_COLUMNS, raiseload=True),
            load_only(*_JOB_COLUMNS, raiseload=True),
        )
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
        seen = [row[0].run_id for row in rows]
        rows += list(
            db.execute(
                base.where(
                    EvalRunScore.mean_score == rows[-1][0].mean_score,
                    EvalRunScore.run_id.notin_(seen),
                )
            ).all()
        )
    return [_Candidate(*row) for row in rows]


def _run_payload(
    rank: int,
    candidate: _Candidate,
    *,
    versioning: Optional[Dict[str, Any]],
    direction: str,
    k: Optional[int],
    now: datetime,
) -> Dict[str, Any]:
    score, run, job = candidate.score, candidate.run, candidate.job
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
        "dataset": (
            {"id": score.dataset_id, "name": candidate.dataset_name or ""}
            if score.dataset_id
            else None
        ),
        "dataset_version": (
            {"id": score.dataset_version_id, "version": candidate.dataset_version or ""}
            if score.dataset_version_id
            else None
        ),
        "remote_versioning": versioning,
        "params": params_summary(
            candidate.qym_config, run_samples=run.samples, job_params=job.params
        ),
    }


def _dataset_payload(dataset: Optional[Dataset]) -> Optional[Dict[str, Any]]:
    return (
        {"id": dataset.id, "name": dataset.name, "slug": dataset.slug}
        if dataset
        else None
    )


def _version_payload(version: Optional[DatasetVersion]) -> Optional[Dict[str, Any]]:
    return (
        {"id": version.id, "version": version.version, "name": version.name or ""}
        if version
        else None
    )


def rank_best_runs(
    db: Session,
    env: EvalEnvironment,
    *,
    dataset_id: Optional[str] = None,
    dataset_version_id: Optional[str] = None,
    dataset_version: Optional[str] = None,
    versioning: Optional[Mapping[str, List[str]]] = None,
    metric: Optional[str] = None,
    k: Optional[int] = None,
    limit: int = DEFAULT_LIMIT,
    exclude_errored: bool = True,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """The ranked candidates (shape in the module docstring)."""
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    now = now or utc_now_naive()
    scope = resolve_scope(
        db,
        env,
        dataset_id=dataset_id,
        dataset_version_id=dataset_version_id,
        dataset_version=dataset_version,
        versioning=versioning,
    )
    dataset, version = scope.dataset, scope.version
    k = k if k is not None else env.ranking_k
    out: Dict[str, Any] = {
        "environment_id": env.id,
        "scope": {
            "dataset": _dataset_payload(dataset),
            "dataset_version": _version_payload(version),
            "versioning": dict(scope.versioning),
            "global": scope.is_global,
        },
        "dataset": _dataset_payload(dataset),
        "dataset_version": _version_payload(version),
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
        "reason": scope.reason,
        "latest_version_with_runs": None,
        "latest_remote_versioning": latest_versioning(db, env),
    }
    if scope.reason is not None:
        return out

    counts = _metric_counts(db, env, scope)
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
        if version is not None:
            out["reason"] = "no_runs_on_version"
            if dataset is not None:
                out["latest_version_with_runs"] = _latest_version_with_runs(
                    db, env, dataset, version.id
                )
        else:
            out["reason"] = "no_runs_in_scope"
        return out
    if metric is None:
        out["reason"] = "no_metric"
        return out

    direction, eligible, hidden = _direction_counts(db, env, scope, metric)
    out["eligible_count"] = eligible
    out["excluded_errored_count"] = hidden if exclude_errored else 0
    if direction is None:
        out["reason"] = "no_runs_for_metric"
        return out
    out["direction"] = direction

    candidates = _candidates(
        db,
        env,
        scope=scope,
        metric=metric,
        direction=direction,
        limit=limit,
        exclude_errored=exclude_errored,
    )
    candidates.sort(key=lambda c: sort_key(c.score, c.run, direction=direction, k=k))
    top = candidates[:limit]
    versionings = _versionings(db, {c.job.id: c.job.remote_versioning for c in top})
    out["runs"] = [
        _run_payload(
            rank,
            candidate,
            versioning=versionings.get(candidate.job.id),
            direction=direction,
            k=k,
            now=now,
        )
        for rank, candidate in enumerate(top, start=1)
    ]
    if not out["runs"]:
        out["reason"] = "all_excluded"
    return out


def best_run_scope(db: Session, env: EvalEnvironment) -> Dict[str, Any]:
    """What the scope prompt offers: datasets, versions and versioning with runs.

    ``{"datasets": [{"id", "name", "slug", "run_count", "versions": [{"id",
    "version", "name", "run_count"}]}], "other_run_count": n, "versioning": {key:
    [{"value", "run_count"}]}, "total_runs": n}``. Counts are distinct eligible runs
    (any metric, before the error filter). ``other_run_count`` counts runs on a custom
    dataset string or a deleted dataset: they are ranked only when no dataset is
    chosen. Versions and values are listed newest first.
    """
    runs = func.count(func.distinct(EvalRunScore.run_id))
    latest = func.max(func.coalesce(EvalRunScore.completed_at, Run.created_at))
    rows = db.execute(
        _eligible(
            select(
                Dataset.id,
                Dataset.name,
                Dataset.slug,
                DatasetVersion.id,
                DatasetVersion.version,
                DatasetVersion.name,
                runs,
                latest,
            ).select_from(EvalRunScore),
            env,
        )
        .outerjoin(
            Dataset,
            (Dataset.id == EvalRunScore.dataset_id) & Dataset.deleted_at.is_(None),
        )
        .outerjoin(DatasetVersion, DatasetVersion.id == EvalRunScore.dataset_version_id)
        .group_by(
            Dataset.id,
            Dataset.name,
            Dataset.slug,
            DatasetVersion.id,
            DatasetVersion.version,
            DatasetVersion.name,
        )
    ).all()
    datasets: Dict[str, Dict[str, Any]] = {}
    other = 0
    for ds_id, ds_name, slug, dv_id, dv_version, dv_name, count, at in rows:
        if ds_id is None:
            other += int(count)
            continue
        entry = datasets.setdefault(
            ds_id,
            {
                "id": ds_id,
                "name": ds_name,
                "slug": slug,
                "run_count": 0,
                "versions": [],
            },
        )
        entry["run_count"] += int(count)
        if dv_id is not None:
            entry["versions"].append(
                {
                    "id": dv_id,
                    "version": dv_version,
                    "name": dv_name or "",
                    "run_count": int(count),
                    "_at": at,
                }
            )
    for entry in datasets.values():
        entry["versions"].sort(key=lambda v: (v["_at"] or datetime.min), reverse=True)
        for item in entry["versions"]:
            item.pop("_at")
    values: Dict[str, List[Dict[str, Any]]] = {}
    for key, value, count, _ in db.execute(
        _eligible(
            select(RunVersion.key, RunVersion.value, runs, latest).select_from(
                EvalRunScore
            ),
            env,
        )
        .join(RunVersion, RunVersion.run_key == EvalRunScore.run_id)
        .group_by(RunVersion.key, RunVersion.value)
        .order_by(RunVersion.key, latest.desc(), RunVersion.value)
    ):
        values.setdefault(key, []).append({"value": value, "run_count": int(count)})
    total = db.scalar(_eligible(select(runs).select_from(EvalRunScore), env)) or 0
    return {
        "environment_id": env.id,
        "datasets": sorted(datasets.values(), key=lambda d: str(d["name"]).casefold()),
        "other_run_count": other,
        "versioning": values,
        "total_runs": int(total),
    }


__all__ = [
    "BestRunError",
    "best_run_scope",
    "ELIGIBLE_RUN_STATUSES",
    "job_versioning",
    "latest_versioning",
    "MAX_ERROR_PERCENT",
    "rank_best_runs",
    "resolve_scope",
    "sort_key",
]
