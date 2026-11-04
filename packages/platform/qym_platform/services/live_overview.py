"""Aggregate source activity and scores for the live overview."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from math import ceil
from typing import Any, Optional

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    LiveCanaryResult,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
)
from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)


def utcnow() -> datetime:
    """Return qym's current time as naive UTC."""
    return utc_now_naive()


def source_status(
    source: LiveSource, settings: PlatformSettings, now: datetime
) -> dict[str, Any]:
    """Describe the source and freshness of its last received heartbeat."""
    elapsed = (
        max(0.0, (now - source.last_heartbeat_at).total_seconds())
        if source.last_heartbeat_at is not None
        else None
    )
    worker = source.worker if isinstance(source.worker, dict) else {}
    control = worker.get("control") if isinstance(worker.get("control"), dict) else {}
    errors_last_hour = control.get("errors_last_hour")
    return {
        "desired_state": source.desired_state,
        "worker_key_set": source.worker_key_id is not None,
        "errors_last_hour": (
            errors_last_hour
            if type(errors_last_hour) is int and errors_last_hour >= 0
            else 0
        ),
        "id": source.id,
        "key": source.key,
        "name": source.name,
        "environment": source.environment,
        "product": source.product,
        "stale": elapsed is None or elapsed > settings.live_stale_after_seconds,
        "seconds_since_heartbeat": int(elapsed) if elapsed is not None else None,
        "last_heartbeat_at": to_api_timestamp(source.last_heartbeat_at),
        "last_turn_at": to_api_timestamp(source.last_turn_at),
        "worker": source.worker,
    }


def _spec_payload(spec: LiveMetricSpec) -> dict[str, Any]:
    """Serialize a metric definition using the public group field."""
    return {
        "metric_name": spec.metric_name,
        "group": spec.group_name,
        "label": spec.label,
        "score_type": spec.score_type,
        "direction": spec.direction,
        "pass_threshold": spec.pass_threshold,
        "unit": spec.unit,
        "precision": spec.precision,
        "is_primary": spec.is_primary,
        "position": spec.position,
        "description": spec.description,
        "values": spec.values,
    }


def _day_payload(row: LiveDay) -> dict[str, Any]:
    """Serialize worker counters without changing the pushed calendar day."""
    return {
        "id": row.id,
        "source_id": row.source_id,
        "day": row.day.isoformat(),
        "run_ref": row.run_ref,
        "status": row.status,
        "turns_seen": row.turns_seen,
        "evaluated": row.evaluated,
        "failed": row.failed,
        "incomplete": row.incomplete,
        "excluded": row.excluded,
        "first_poll_at": to_api_timestamp(row.first_poll_at),
        "last_poll_at": to_api_timestamp(row.last_poll_at),
        "closed_at": to_api_timestamp(row.closed_at),
        "polls": row.polls,
        "max_poll_gap_s": row.max_poll_gap_s,
        "parameters": row.parameters,
    }


def label_mix(db: Session, source: LiveSource, day: date) -> dict[str, int]:
    """Count labeled turns by their pushed day."""
    return dict(
        db.query(LiveTurn.label, func.count(LiveTurn.id))
        .filter(
            LiveTurn.source_id == source.id,
            LiveTurn.day == day,
            LiveTurn.label.isnot(None),
        )
        .group_by(LiveTurn.label)
        .all()
    )


def metric_means(db: Session, source: LiveSource, day: date) -> list[dict[str, Any]]:
    """Average non-skipped numeric scores while retaining unscored specs."""
    totals = {
        name: (mean, n)
        for name, mean, n in (
            db.query(
                LiveTurnScore.metric_name,
                func.avg(LiveTurnScore.score_numeric),
                func.count(LiveTurnScore.score_numeric),
            )
            .join(LiveTurn, LiveTurn.id == LiveTurnScore.turn_pk)
            .filter(
                LiveTurn.source_id == source.id,
                LiveTurn.day == day,
                LiveTurnScore.skipped.is_(False),
            )
            .group_by(LiveTurnScore.metric_name)
        )
    }
    specs = (
        db.query(LiveMetricSpec)
        .filter(LiveMetricSpec.source_id == source.id)
        .order_by(LiveMetricSpec.position, LiveMetricSpec.metric_name)
        .all()
    )
    return [
        {
            "metric_name": spec.metric_name,
            "mean": totals.get(spec.metric_name, (None, 0))[0],
            "n": totals.get(spec.metric_name, (None, 0))[1],
            "spec": _spec_payload(spec),
        }
        for spec in specs
    ]


def _score_spec_join() -> ColumnElement[bool]:
    """Match scores to definitions belonging to the same source."""
    return and_(
        LiveMetricSpec.source_id == LiveTurn.source_id,
        LiveMetricSpec.metric_name == LiveTurnScore.metric_name,
    )


def service_rates(db: Session, source: LiveSource, day: date) -> list[dict[str, Any]]:
    """Count service passes and failure faults from non-skipped numeric scores."""
    threshold = func.coalesce(LiveMetricSpec.pass_threshold, 1.0)
    ok = LiveTurnScore.score_numeric >= threshold
    fault = LiveTurnScore.meta["fault"].as_string()
    rows = (
        db.query(LiveTurnScore.metric_name, ok, fault, func.count(LiveTurnScore.id))
        .join(LiveTurn, LiveTurn.id == LiveTurnScore.turn_pk)
        .join(LiveMetricSpec, _score_spec_join())
        .filter(
            LiveTurn.source_id == source.id,
            LiveTurn.day == day,
            LiveMetricSpec.group_name == "service",
            LiveTurnScore.skipped.is_(False),
            LiveTurnScore.score_numeric.isnot(None),
        )
        .group_by(LiveTurnScore.metric_name, ok, fault)
        .all()
    )
    services: dict[str, dict[str, Any]] = {}
    for name, passed, fault_name, n in rows:
        item = services.setdefault(
            name, {"name": name, "ok_rate": 0, "n": 0, "fault_breakdown": {}}
        )
        item["n"] += n
        if passed:
            item["ok_rate"] += n
        elif fault_name is not None:
            faults = item["fault_breakdown"]
            faults[fault_name] = faults.get(fault_name, 0) + n
    for item in services.values():
        item["ok_rate"] /= item["n"]
    return [services[name] for name in sorted(services)]


def latency_stats(db: Session, source: LiveSource, day: date) -> dict[str, Any]:
    """Compute interpolated percentiles by selecting at most four ranked latencies."""
    ranked = (
        db.query(
            LiveTurn.latency_ms.label("latency"),
            (func.row_number().over(order_by=LiveTurn.latency_ms) - 1).label("rank"),
            func.count().over().label("n"),
            func.sum(case((LiveTurn.latency_ms > 300000, 1), else_=0))
            .over()
            .label("over_5min"),
        )
        .filter(
            LiveTurn.source_id == source.id,
            LiveTurn.day == day,
            LiveTurn.latency_ms.isnot(None),
        )
        .subquery()
    )
    median_rank = (ranked.c.n - 1) * 0.5
    p90_rank = (ranked.c.n - 1) * 0.9
    # Open bounds select floor/ceiling ranks without dialect-specific rounding.
    rows = (
        db.query(ranked)
        .filter(
            or_(
                and_(ranked.c.rank > median_rank - 1, ranked.c.rank < median_rank + 1),
                and_(ranked.c.rank > p90_rank - 1, ranked.c.rank < p90_rank + 1),
            )
        )
        .all()
    )
    if not rows:
        return {"median_ms": None, "p90_ms": None, "over_5min": 0}
    values = {row.rank: row.latency for row in rows}

    def percentile(fraction: float) -> float:
        """Interpolate between the selected neighboring ranks."""
        position = (rows[0].n - 1) * fraction
        lower = int(position)
        return values[lower] + (values[ceil(position)] - values[lower]) * (
            position - lower
        )

    return {
        "median_ms": percentile(0.5),
        "p90_ms": percentile(0.9),
        "over_5min": rows[0].over_5min,
    }


def latest_canaries(db: Session, source: LiveSource) -> list[dict[str, Any]]:
    """Read only the most recent result of each source canary."""
    latest = (
        db.query(
            LiveCanaryResult.canary,
            func.max(LiveCanaryResult.checked_at).label("checked_at"),
        )
        .filter(LiveCanaryResult.source_id == source.id)
        .group_by(LiveCanaryResult.canary)
        .subquery()
    )
    rows = (
        db.query(LiveCanaryResult)
        .join(
            latest,
            and_(
                LiveCanaryResult.canary == latest.c.canary,
                LiveCanaryResult.checked_at == latest.c.checked_at,
            ),
        )
        .filter(LiveCanaryResult.source_id == source.id)
        .order_by(LiveCanaryResult.canary)
        .all()
    )
    return [
        {
            "canary": row.canary,
            "status": row.status,
            "fault": row.fault,
            "latency_ms": row.latency_ms,
            "checked_at": to_api_timestamp(row.checked_at),
        }
        for row in rows
    ]


def _daily_numbers(
    db: Session, source: LiveSource, start: date, end: date, primary_name: Optional[str]
) -> tuple[dict[date, int], dict[date, dict[str, int]], dict[date, Optional[float]]]:
    """Aggregate counts, labels and primary scores over a bounded day window."""
    scope = (LiveTurn.source_id == source.id, LiveTurn.day.between(start, end))
    counts: dict[date, int] = {}
    mixes: dict[date, dict[str, int]] = {}
    for day, label, n in (
        db.query(LiveTurn.day, LiveTurn.label, func.count(LiveTurn.id))
        .filter(*scope)
        .group_by(LiveTurn.day, LiveTurn.label)
    ):
        counts[day] = counts.get(day, 0) + n
        if label is not None:
            mixes.setdefault(day, {})[label] = n
    if primary_name is None:
        return counts, mixes, {}
    rates = dict(
        db.query(LiveTurn.day, func.avg(LiveTurnScore.score_numeric))
        .join(LiveTurnScore, LiveTurnScore.turn_pk == LiveTurn.id)
        .filter(
            *scope,
            LiveTurnScore.metric_name == primary_name,
            LiveTurnScore.skipped.is_(False),
        )
        .group_by(LiveTurn.day)
        .all()
    )
    return counts, mixes, rates


def _poll_interval_s(source: LiveSource) -> int:
    """Normalize the worker's poll interval, defaulting invalid values to 60 seconds."""
    value = (source.worker or {}).get("poll_interval_s")
    if isinstance(value, str) and value.isdigit():
        try:
            value = int(value)
        except ValueError:
            return 60
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        try:
            return int(value)
        except OverflowError:
            return 60
    return 60


def _worker_gap(source: LiveSource, gap: int) -> bool:
    """Mark gaps exceeding three configured poll intervals."""
    return gap > 3 * _poll_interval_s(source)


def trend(
    db: Session,
    source: LiveSource,
    end_day: date,
    days: int,
    primary_name: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Return one point for each calendar day, including quiet days."""
    start = end_day - timedelta(days=days - 1)
    counts, mixes, rates = _daily_numbers(db, source, start, end_day, primary_name)
    gaps = dict(
        db.query(LiveDay.day, LiveDay.max_poll_gap_s)
        .filter(LiveDay.source_id == source.id, LiveDay.day.between(start, end_day))
        .all()
    )
    return [
        {
            "day": day.isoformat(),
            "turns": counts.get(day, 0),
            "counts_by_label": mixes.get(day, {}),
            "primary_rate": rates.get(day),
            "worker_gap": _worker_gap(source, gaps.get(day, 0)),
        }
        for day in (start + timedelta(days=offset) for offset in range(days))
    ]


def days_page(
    db: Session,
    source: LiveSource,
    page: int,
    page_size: int = 30,
    primary_name: Optional[str] = None,
) -> dict[str, Any]:
    """Page worker days newest first with counts and primary means from pushed days."""
    query = db.query(LiveDay).filter(LiveDay.source_id == source.id)
    total = query.count()
    rows = (
        query.order_by(LiveDay.day.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    counts, mixes, rates = (
        _daily_numbers(db, source, rows[-1].day, rows[0].day, primary_name)
        if rows
        else ({}, {}, {})
    )
    return {
        "rows": [
            {
                "day": row.day.isoformat(),
                "status": row.status,
                "turns_seen": row.turns_seen,
                "evaluated": row.evaluated,
                "failed": row.failed,
                "in_qym": counts.get(row.day, 0),
                "primary_rate": rates.get(row.day),
                "label_mix": mixes.get(row.day, {}),
                "worker_gap": _worker_gap(source, row.max_poll_gap_s),
                "polls": row.polls,
                "max_poll_gap_s": row.max_poll_gap_s,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def overview_payload(
    db: Session,
    source: LiveSource,
    day: Optional[date],
    trend_days: int,
    settings: PlatformSettings,
    now: datetime,
    page: int = 1,
) -> dict[str, Any]:
    """Assemble the selected day's activity and the source's overview context."""
    if day is None:
        day = (
            db.query(func.max(LiveDay.day))
            .filter(LiveDay.source_id == source.id)
            .scalar()
            or now.date()
        )
    row = (
        db.query(LiveDay)
        .filter(LiveDay.source_id == source.id, LiveDay.day == day)
        .first()
    )
    in_qym = (
        db.query(func.count(LiveTurn.id))
        .filter(LiveTurn.source_id == source.id, LiveTurn.day == day)
        .scalar()
    )
    means = metric_means(db, source, day)
    specs = [metric["spec"] for metric in means]
    # metric_means orders specs by (position, metric_name), including legacy duplicates.
    primary = next((spec for spec in specs if spec["is_primary"]), None)
    primary_name = primary["metric_name"] if primary else None
    return {
        "status": source_status(source, settings, now),
        "day": {
            "row": _day_payload(row) if row else None,
            "in_qym": in_qym,
            "not_in_qym": max(0, (row.turns_seen if row else 0) - in_qym),
            "label_mix": label_mix(db, source, day),
            "metric_means": means,
            "services": service_rates(db, source, day),
            "latency": latency_stats(db, source, day),
            "worker_gap_s": row.max_poll_gap_s if row else 0,
        },
        "canaries": latest_canaries(db, source),
        "trend": trend(
            db,
            source,
            day,
            max(1, min(trend_days, settings.live_trend_max_days)),
            primary_name=primary_name,
        ),
        "days": days_page(db, source, page, primary_name=primary_name),
        "specs": specs,
        "primary_metric": primary_name,
    }
