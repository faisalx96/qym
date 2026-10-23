"""Per-dataset score breakdown of a union run (``GET /api/runs/{run_id}/datasets``).

Read-only: one grouped query over the run's items, one over the aggregate scores
(both grouped by ``run_items.dataset_position``), one over ``run_datasets`` and one
over the metric specs, whatever the number of items or datasets. The means follow the
rule the Overview cards use (``services/run_means``: errors count as 0, or are left
out of a lower-is-better metric), so the item-weighted mean of the rows equals the
summary row exactly.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import (
    Dataset,
    Run,
    RunDataset,
    RunItem,
    RunItemPassScore,
    RunItemScore,
)
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import can_view_run
from qym_platform.services.run_means import (
    MetricTotals,
    completed_review_runs,
    metric_directions,
    metric_error_candidates,
    mean_task_errors,
    not_received_clause,
    run_metric_count,
    run_metric_mean,
    task_error_pass_candidates,
)
from qym_platform.services.run_review import REVIEW_STATUSES

logger = get_logger(__name__)
router = APIRouter(tags=["runs"])


def _entry_deleted(dataset_id: Optional[str], version: Optional[str], slug: Optional[str]) -> bool:
    return bool((dataset_id is None and version is not None) or (dataset_id and not slug))


def _metrics_payload(
    metrics: List[str],
    totals: Dict[str, MetricTotals],
    directions: Dict[str, Optional[str]],
    task_errors: int,
) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for metric in metrics:
        metric_totals = totals.get(metric) or MetricTotals()
        metric_totals.direction = directions.get(metric)
        count = run_metric_count(metric_totals, task_errors)
        mean = run_metric_mean(metric_totals, task_errors) if count else None
        out[metric] = {"mean": mean, "count": count}
    return out


def _merge(into: Dict[str, MetricTotals], other: Dict[str, MetricTotals]) -> None:
    for metric, source in other.items():
        target = into.setdefault(metric, MetricTotals())
        target.score_sum += source.score_sum
        target.score_count += source.score_count
        target.error_score_sum += source.error_score_sum
        target.error_score_count += source.error_score_count
        target.unscored_errors += source.unscored_errors


@router.get("/api/runs/{run_id}/datasets")
def run_dataset_breakdown(
    run_id: str,
    pass_number: Optional[int] = Query(default=None, alias="pass", ge=1),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    run = Run.active(db).filter(Run.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")

    if int(run.dataset_count or 1) <= 1:
        from qym_platform.api.runs import _dataset_version_info_map
        from qym_platform.services.run_datasets import datasets_for_runs

        entries = datasets_for_runs(db, [run], _dataset_version_info_map(db, [run]))[run.id]
        return {
            "dataset_count": 1,
            "breakdown": False,
            "datasets": [
                {
                    "position": 0,
                    "dataset": entries[0]["dataset"],
                    "dataset_slug": entries[0]["dataset_slug"],
                    "version": entries[0]["version"],
                    "alias": entries[0]["alias"],
                    "items": None,
                    "deleted": entries[0]["deleted"],
                }
            ],
        }

    samples = int(run.samples or 1)
    repeat = samples > 1
    metrics = [str(m) for m in (run.metrics or [])]
    in_review = (
        completed_review_runs(db, [run.id]) if run.status in REVIEW_STATUSES else frozenset()
    )
    not_received = not_received_clause(RunItem, Run, in_review)

    # 1. Items per position: rows, task errors, items that never reached the platform.
    item_stats: Dict[Optional[int], Dict[str, int]] = {}
    for position, items, errors, missing, finished in (
        db.query(
            RunItem.dataset_position,
            func.count(RunItem.id),
            func.sum(case((RunItem.error.isnot(None), 1), else_=0)),
            func.sum(case((not_received, 1), else_=0)),
            func.sum(
                case(
                    (and_(RunItem.error.is_(None), RunItem.latency_ms.isnot(None)), 1),
                    else_=0,
                )
            ),
        )
        .join(Run, Run.id == RunItem.run_id)
        .filter(RunItem.run_id == run.id)
        .group_by(RunItem.dataset_position)
    ):
        item_stats[position] = {
            "items": int(items or 0),
            "errors": int(errors or 0),
            "not_received": int(missing or 0),
            "completed": int(finished or 0),
        }

    # 2. Scores per position and metric, with the scorer-error part split out.
    if pass_number is not None and repeat:
        score_model = RunItemPassScore
        candidates = or_(
            metric_error_candidates(RunItemPassScore),
            task_error_pass_candidates(RunItemPassScore),
        )
        extra = [RunItemPassScore.pass_number == pass_number]
        counted = None
    else:
        score_model = RunItemScore
        candidates = metric_error_candidates(RunItemScore)
        extra = []
        counted = and_(or_(Run.samples > 1, RunItem.error.is_(None)), ~not_received)
    score = score_model.score_numeric
    query = (
        db.query(
            RunItem.dataset_position,
            score_model.metric_name,
            func.sum(score),
            func.count(score),
            func.sum(case((candidates, score))),
            func.count(case((candidates, score))),
            func.sum(case((and_(candidates, score.is_(None)), 1), else_=0)),
        )
        .join(
            RunItem,
            and_(RunItem.run_id == score_model.run_id, RunItem.item_id == score_model.item_id),
        )
        .join(Run, Run.id == RunItem.run_id)
        .filter(score_model.run_id == run.id, *extra)
    )
    if counted is not None:
        query = query.filter(counted)
    by_position: Dict[Optional[int], Dict[str, MetricTotals]] = {}
    for position, metric, total, count, err_sum, err_count, unscored in query.group_by(
        RunItem.dataset_position, score_model.metric_name
    ):
        by_position.setdefault(position, {})[metric] = MetricTotals(
            score_sum=float(total or 0.0),
            score_count=int(count or 0),
            error_score_sum=float(err_sum or 0.0),
            error_score_count=int(err_count or 0),
            unscored_errors=int(unscored or 0),
        )

    # 3. The entries (stored names and versions; the live dataset only for its slug).
    rows = (
        db.query(RunDataset, Dataset.slug)
        .outerjoin(
            Dataset,
            and_(Dataset.id == RunDataset.dataset_id, Dataset.deleted_at.is_(None)),
        )
        .filter(RunDataset.run_id == run.id)
        .order_by(RunDataset.position)
        .all()
    )
    # 4. Declared directions (a lower-is-better metric leaves errors out).
    directions = metric_directions(db, [run.id]).get(run.id, {})

    def task_errors_of(stats: Optional[Dict[str, int]]) -> int:
        return mean_task_errors(samples, (stats or {}).get("errors", 0)) if stats else 0

    datasets: List[Dict[str, Any]] = []
    run_totals: Dict[str, MetricTotals] = {}
    run_stats = {"items": 0, "completed": 0, "errors": 0}
    run_task_errors = 0
    for entry, slug in rows:
        stats = item_stats.get(entry.position) or {
            "items": 0, "errors": 0, "not_received": 0, "completed": 0,
        }
        totals = by_position.get(entry.position) or {}
        datasets.append(
            {
                "position": entry.position,
                "dataset": entry.dataset,
                "dataset_slug": None if _entry_deleted(entry.dataset_id, entry.version, slug) else slug,
                "version": entry.version,
                "alias": entry.alias,
                "items": stats["items"],
                "completed": stats["completed"],
                "errors": stats["errors"],
                "deleted": _entry_deleted(entry.dataset_id, entry.version, slug),
                "metrics": _metrics_payload(metrics, totals, directions, task_errors_of(stats)),
            }
        )
        _merge(run_totals, totals)
        for key in run_stats:
            run_stats[key] += stats[key]
        run_task_errors += task_errors_of(stats)
    body: Dict[str, Any] = {
        "dataset_count": int(run.dataset_count),
        "breakdown": True,
        "datasets": datasets,
    }
    stray = item_stats.get(None)
    known = {entry.position for entry, _ in rows}
    stray_stats = {
        key: sum(v[key] for pos, v in item_stats.items() if pos not in known)
        for key in ("items", "completed", "errors", "not_received")
    }
    if stray_stats["items"] > 0:
        body["unassigned"] = {"items": stray_stats["items"]}
        for key in run_stats:
            run_stats[key] += stray_stats[key]
        for pos, totals in by_position.items():
            if pos not in known:
                _merge(run_totals, totals)
        run_task_errors += mean_task_errors(samples, stray_stats["errors"])
    del stray
    body["run"] = {
        **run_stats,
        "metrics": _metrics_payload(metrics, run_totals, directions, run_task_errors),
    }
    return body
