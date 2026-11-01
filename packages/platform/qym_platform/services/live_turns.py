"""Filter, inspect and export turns belonging to one live source."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from itertools import islice
from math import isfinite
from typing import Any, Iterator, Mapping, Optional, Sequence

from sqlalchemy import JSON, and_, case, column, func, or_, select, type_coerce
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Query, Session, load_only
from sqlalchemy.sql.elements import ColumnElement

from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import LiveMetricSpec, LiveSource, LiveTurn, LiveTurnScore
from qym_platform.log import get_logger
from qym_platform.services.live_overview import _spec_payload

logger = get_logger(__name__)

_ROW_FIELDS = (
    "turn_id",
    "turn_at",
    "day",
    "question",
    "mode",
    "label",
    "label_reason",
    "status",
    "outcome",
    "latency_ms",
    "result_rows",
    "user_ref",
    "conversation_id",
    "turn_index",
)
_CSV_FIELDS = (
    "turn_at",
    "day",
    "turn_id",
    "conversation_id",
    "user_ref",
    "mode",
    "status",
    "outcome",
    "label",
    "label_reason",
    "latency_ms",
    "result_rows",
)


@dataclass
class TurnFilters:
    """Hold validated query filters and pagination for a source's turns."""

    day: Optional[date] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    labels: list[str] = field(default_factory=list)
    statuses: list[str] = field(default_factory=list)
    outcomes: list[str] = field(default_factory=list)
    modes: list[str] = field(default_factory=list)
    metric: Optional[str] = None
    min_score: Optional[float] = None
    max_score: Optional[float] = None
    service: Optional[str] = None
    service_status: Optional[str] = None
    charts: Optional[str] = None
    user: Optional[str] = None
    conversation: Optional[str] = None
    q: Optional[str] = None
    sort: str = "-turn_at"
    page: int = 1
    page_size: int = 50

    @classmethod
    def from_query(cls, params: Mapping[str, list[str]]) -> TurnFilters:
        """Parse repeated query parameters or raise a short validation error."""
        values: dict[str, Any] = {}
        for key, attr in (
            ("label", "labels"),
            ("status", "statuses"),
            ("outcome", "outcomes"),
            ("mode", "modes"),
        ):
            values[attr] = list(params.get(key, []))
        for key in (
            "metric",
            "service",
            "service_status",
            "charts",
            "user",
            "conversation",
            "q",
            "sort",
        ):
            if params.get(key):
                values[key] = params[key][-1]
        for key, attr in (
            ("day", "day"),
            ("from", "date_from"),
            ("to", "date_to"),
            ("min", "min_score"),
            ("max", "max_score"),
            ("page", "page"),
            ("page_size", "page_size"),
        ):
            if params.get(key):
                values[attr] = _parse_value(key, params[key][-1])
        filters = cls(**values)
        filters._validate()
        return filters

    def _validate(self) -> None:
        """Reject invalid ranges, choices and incomplete filter pairs."""
        if self.page < 1 or not 1 <= self.page_size <= 200:
            raise ValueError("page must be positive; page_size must be 1 to 200")
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("from must not be after to")
        if self.min_score is not None or self.max_score is not None:
            if not self.metric:
                raise ValueError("min and max require metric")
            if (
                self.min_score is not None
                and self.max_score is not None
                and self.min_score > self.max_score
            ):
                raise ValueError("min must not exceed max")
        if self.service_status not in (None, "ok", "not_ok"):
            raise ValueError("invalid service_status")
        if self.service_status and not self.service:
            raise ValueError("service_status requires service")
        if self.charts not in (None, "any", "failed", "none"):
            raise ValueError("invalid charts")
        sort = self.sort.removeprefix("-")
        if sort not in ("turn_at", "latency_ms") and not (
            sort.startswith("metric:") and sort[len("metric:") :].strip()
        ):
            raise ValueError("invalid sort")


def _parse_value(key: str, value: str) -> Any:
    """Parse a date, finite score or integer query value."""
    try:
        if key in ("day", "from", "to"):
            return date.fromisoformat(value)
        if key in ("page", "page_size"):
            return int(value)
        number = float(value)
        if isfinite(number):
            return number
    except (ValueError, OverflowError):
        pass
    raise ValueError(f"invalid {key}")


def _json_array(db: Session, column_path: ColumnElement[Any]) -> ColumnElement[Any]:
    """Normalize missing, null and non-array JSON values to an empty array."""
    if db.get_bind().dialect.name == "postgresql":
        return case(
            (func.jsonb_typeof(column_path) == "array", column_path),
            else_=type_coerce([], JSONB),
        )
    return case(
        (func.json_type(column_path) == "array", column_path),
        else_=type_coerce([], JSON),
    )


def _json_array_length(
    db: Session, column_path: ColumnElement[Any]
) -> ColumnElement[int]:
    """Count JSON array entries using the current database's JSON functions."""
    array = _json_array(db, column_path)
    if db.get_bind().dialect.name == "postgresql":
        return func.jsonb_array_length(array)
    return func.json_array_length(array)


def _charts_filter(db: Session, value: str) -> ColumnElement[bool]:
    """Match chart presence or non-empty issue lists entirely in SQL."""
    charts = LiveTurn.summary["charts"]
    if value == "none":
        return _json_array_length(db, charts) == 0
    if value == "any":
        return _json_array_length(db, charts) > 0
    array = _json_array(db, charts)
    if db.get_bind().dialect.name == "postgresql":
        entries = func.jsonb_array_elements(array).table_valued(column("value", JSONB))
        chart = entries.c.value
    else:
        entries = func.json_each(array).table_valued("value", "type")
        chart = type_coerce(
            case((entries.c.type == "object", entries.c.value), else_="{}"), JSON
        )
    return (
        select(1)
        .select_from(entries)
        .where(_json_array_length(db, chart["issues"]) > 0)
        .correlate(LiveTurn)
        .exists()
    )


def _score_query(source: LiveSource, metric: str) -> Any:
    """Select non-skipped scores correlated to a turn in the selected source."""
    return (
        select(LiveTurnScore.score_numeric)
        .where(
            LiveTurn.source_id == source.id,
            LiveTurnScore.turn_pk == LiveTurn.id,
            LiveTurnScore.metric_name == metric,
            LiveTurnScore.skipped.is_(False),
        )
        .correlate(LiveTurn)
    )


def _service_filter(source: LiveSource, filters: TurnFilters) -> ColumnElement[bool]:
    """Match a service score against its source's threshold when requested."""
    query = _score_query(source, f"service.{filters.service}").outerjoin(
        LiveMetricSpec,
        and_(
            LiveMetricSpec.source_id == source.id,
            LiveMetricSpec.metric_name == LiveTurnScore.metric_name,
        ),
    )
    threshold = func.coalesce(LiveMetricSpec.pass_threshold, 1.0)
    if filters.service_status == "ok":
        query = query.where(LiveTurnScore.score_numeric >= threshold)
    elif filters.service_status == "not_ok":
        query = query.where(LiveTurnScore.score_numeric < threshold)
    return query.exists()


def _filtered_turns(db: Session, source: LiveSource, filters: TurnFilters) -> Query:
    """Build the source-scoped turn query before ordering or pagination."""
    query = db.query(LiveTurn).filter(LiveTurn.source_id == source.id)
    for value, condition in (
        (filters.day, LiveTurn.day == filters.day if filters.day else None),
        (
            filters.date_from,
            LiveTurn.day >= filters.date_from if filters.date_from else None,
        ),
        (filters.date_to, LiveTurn.day <= filters.date_to if filters.date_to else None),
        (filters.user, LiveTurn.user_ref == filters.user),
        (filters.conversation, LiveTurn.conversation_id == filters.conversation),
    ):
        if value is not None:
            query = query.filter(condition)
    for values, attr in (
        (filters.labels, LiveTurn.label),
        (filters.statuses, LiveTurn.status),
        (filters.outcomes, LiveTurn.outcome),
        (filters.modes, LiveTurn.mode),
    ):
        if values:
            query = query.filter(attr.in_(values))
    if filters.metric:
        scores = _score_query(source, filters.metric)
        if filters.min_score is not None:
            scores = scores.where(LiveTurnScore.score_numeric >= filters.min_score)
        if filters.max_score is not None:
            scores = scores.where(LiveTurnScore.score_numeric <= filters.max_score)
        query = query.filter(scores.exists())
    if filters.service:
        query = query.filter(_service_filter(source, filters))
    if filters.charts:
        query = query.filter(_charts_filter(db, filters.charts))
    if filters.q:
        query = query.filter(
            or_(
                func.lower(LiveTurn.question).contains(
                    filters.q.lower(), autoescape=True
                ),
                func.lower(LiveTurn.answer).contains(
                    filters.q.lower(), autoescape=True
                ),
            )
        )
    return query


def _sort_value(source: LiveSource, filters: TurnFilters) -> ColumnElement[Any]:
    """Return the requested column or a correlated numeric metric score."""
    name = filters.sort.removeprefix("-")
    if name.startswith("metric:"):
        return _score_query(source, name[len("metric:") :]).scalar_subquery()
    return getattr(LiveTurn, name)


def _order(value: ColumnElement[Any], filters: TurnFilters) -> ColumnElement[Any]:
    """Place null values last in either sort direction."""
    return (value.desc() if filters.sort.startswith("-") else value.asc()).nulls_last()


def _turn_batch(
    db: Session,
    source: LiveSource,
    filters: TurnFilters,
    names: list[str],
    offset: int,
    limit: int,
) -> list[tuple[LiveTurn, dict[str, LiveTurnScore]]]:
    """Load a page of turns and its listed scores in one joined SELECT."""
    value = _sort_value(source, filters)
    page = (
        _filtered_turns(db, source, filters)
        .with_entities(LiveTurn.id, value.label("sort_value"))
        .order_by(_order(value, filters), LiveTurn.id)
        .offset(offset)
        .limit(limit)
        .subquery()
    )
    rows = (
        db.query(LiveTurn, LiveTurnScore)
        .join(page, page.c.id == LiveTurn.id)
        .outerjoin(
            LiveTurnScore,
            and_(
                LiveTurnScore.turn_pk == LiveTurn.id,
                LiveTurnScore.metric_name.in_(names),
            ),
        )
        .filter(LiveTurn.source_id == source.id)
        .options(
            load_only(
                *(getattr(LiveTurn, name) for name in _ROW_FIELDS), LiveTurn.summary
            )
        )
        .order_by(_order(page.c.sort_value, filters), LiveTurn.id)
    )
    turns: dict[int, tuple[LiveTurn, dict[str, LiveTurnScore]]] = {}
    for turn, score in rows:
        item = turns.setdefault(turn.id, (turn, {}))
        if score is not None:
            item[1][score.metric_name] = score
    return list(turns.values())


def _listed_metrics(specs: Sequence[LiveMetricSpec]) -> list[str]:
    """Choose the primary metric and the first three quality or chart specs."""
    ordered = sorted(specs, key=lambda spec: (spec.position, spec.metric_name))
    primary = next((spec for spec in ordered if spec.is_primary), None)
    others = [
        spec.metric_name
        for spec in ordered
        if spec is not primary and spec.group_name in ("quality", "charts")
    ][:3]
    return ([primary.metric_name] if primary else []) + others


def _columns(row: Any, names: Sequence[str]) -> dict[str, Any]:
    """Serialize named columns with the platform's UTC timestamp format."""
    result = {}
    for name in names:
        value = getattr(row, name)
        if isinstance(value, datetime):
            value = to_api_timestamp(value)
        elif isinstance(value, date):
            value = value.isoformat()
        result[name] = value
    return result


def _turn_row(turn: LiveTurn, scores: dict[str, LiveTurnScore]) -> dict[str, Any]:
    """Serialize table columns, chart counts and service failures."""
    summary = turn.summary or {}
    charts = summary.get("charts")
    charts = charts if isinstance(charts, list) else []
    services = summary.get("services")
    services = services if isinstance(services, dict) else {}
    return {
        **_columns(turn, _ROW_FIELDS),
        "charts": {
            "count": len(charts),
            "failed": sum(
                1
                for chart in charts
                if isinstance(chart, dict)
                and isinstance(chart.get("issues"), list)
                and chart["issues"]
            ),
        },
        "services_not_ok": [
            {"name": name, "fault": service.get("fault")}
            for name, service in services.items()
            if isinstance(service, dict) and service.get("status") != "ok"
        ],
        "scores": {
            name: _columns(score, ("score_numeric", "label", "skipped"))
            for name, score in scores.items()
        },
    }


def _facets(db: Session, source: LiveSource, filters: TurnFilters) -> dict[str, Any]:
    """Count each facet with all filters except its own dimension applied."""
    counts = {}
    for name, attr in (
        ("labels", LiveTurn.label),
        ("statuses", LiveTurn.status),
        ("outcomes", LiveTurn.outcome),
        ("modes", LiveTurn.mode),
    ):
        query = _filtered_turns(db, source, replace(filters, **{name: []}))
        counts[name] = dict(
            query.with_entities(attr, func.count(LiveTurn.id))
            .filter(attr.isnot(None))
            .group_by(attr)
            .all()
        )
    services = (
        _filtered_turns(db, source, replace(filters, service=None, service_status=None))
        .join(LiveTurnScore, LiveTurnScore.turn_pk == LiveTurn.id)
        .outerjoin(
            LiveMetricSpec,
            and_(
                LiveMetricSpec.source_id == source.id,
                LiveMetricSpec.metric_name == LiveTurnScore.metric_name,
            ),
        )
        .with_entities(LiveTurnScore.metric_name, func.count(LiveTurnScore.id))
        .filter(
            LiveTurnScore.metric_name.startswith("service."),
            LiveTurnScore.skipped.is_(False),
            LiveTurnScore.score_numeric
            < func.coalesce(LiveMetricSpec.pass_threshold, 1.0),
        )
        .group_by(LiveTurnScore.metric_name)
        .all()
    )
    users = (
        _filtered_turns(db, source, replace(filters, user=None))
        .with_entities(LiveTurn.user_ref, func.count(LiveTurn.id).label("n"))
        .filter(LiveTurn.user_ref.isnot(None))
        .group_by(LiveTurn.user_ref)
        .order_by(func.count(LiveTurn.id).desc(), LiveTurn.user_ref)
        .limit(20)
        .all()
    )
    return {
        **counts,
        "services": {name.removeprefix("service."): n for name, n in services},
        "users": [{"user_ref": user, "n": n} for user, n in users],
    }


def list_turns(
    db: Session,
    source: LiveSource,
    filters: TurnFilters,
    specs: Sequence[LiveMetricSpec],
) -> dict[str, Any]:
    """Return a page of turn rows with totals and unpaginated facet counts."""
    query = _filtered_turns(db, source, filters)
    batch = _turn_batch(
        db,
        source,
        filters,
        _listed_metrics(specs),
        (filters.page - 1) * filters.page_size,
        filters.page_size,
    )
    return {
        "rows": [_turn_row(turn, scores) for turn, scores in batch],
        "total": query.count(),
        "facets": _facets(db, source, filters),
    }


def turn_detail(
    db: Session,
    source: LiveSource,
    turn_id: str,
    specs: Sequence[LiveMetricSpec],
) -> Optional[dict[str, Any]]:
    """Return a full turn with score definitions and ordered conversation siblings."""
    turn = (
        db.query(LiveTurn)
        .filter(LiveTurn.source_id == source.id, LiveTurn.turn_id == turn_id)
        .first()
    )
    if turn is None:
        return None
    definitions = {spec.metric_name: _spec_payload(spec) for spec in specs}
    scores = (
        db.query(LiveTurnScore)
        .join(LiveTurn, LiveTurn.id == LiveTurnScore.turn_pk)
        .filter(LiveTurn.source_id == source.id, LiveTurn.id == turn.id)
        .order_by(LiveTurnScore.metric_name)
        .all()
    )
    siblings = db.query(LiveTurn).filter(LiveTurn.source_id == source.id)
    siblings = siblings.filter(
        LiveTurn.conversation_id == turn.conversation_id
        if turn.conversation_id is not None
        else LiveTurn.id == turn.id
    ).order_by(LiveTurn.turn_at, LiveTurn.id)
    return {
        "turn": _columns(turn, [col.key for col in LiveTurn.__table__.columns]),
        "summary": turn.summary,
        "detail": turn.detail,
        "scores": [
            {
                **_columns(score, [col.key for col in LiveTurnScore.__table__.columns]),
                "spec": definitions.get(score.metric_name),
            }
            for score in scores
        ],
        "conversation": [
            {
                **_columns(
                    row, ("turn_id", "turn_at", "turn_index", "question", "label")
                ),
                "current": row.id == turn.id,
            }
            for row in siblings
        ],
        "specs": list(definitions.values()),
    }


def _csv_score(score: Optional[LiveTurnScore]) -> str:
    """Format a numeric or categorical score, leaving skipped scores empty."""
    if score is None or score.skipped:
        return ""
    if score.score_numeric is not None:
        return str(score.score_numeric)
    value = score.label if score.label is not None else score.score_raw
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _csv_safe(value: str) -> str:
    """Prevent spreadsheet applications from interpreting a cell as a formula."""
    if value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def _export_scores(
    db: Session, source: LiveSource, turn_ids: list[int], names: list[str]
) -> dict[int, dict[str, LiveTurnScore]]:
    """Load one export chunk's scores within the selected source."""
    rows = (
        db.query(LiveTurnScore)
        .join(LiveTurn, LiveTurn.id == LiveTurnScore.turn_pk)
        .filter(
            LiveTurn.source_id == source.id,
            LiveTurnScore.turn_pk.in_(turn_ids),
            LiveTurnScore.metric_name.in_(names),
        )
    )
    scores: dict[int, dict[str, LiveTurnScore]] = {}
    for score in rows:
        scores.setdefault(score.turn_pk, {})[score.metric_name] = score
    return scores


def export_rows(
    db: Session,
    source: LiveSource,
    filters: TurnFilters,
    specs: Sequence[LiveMetricSpec],
) -> Iterator[list[str]]:
    """Stream a safe CSV from one ordered turn cursor with scores loaded in chunks."""
    names = [
        spec.metric_name
        for spec in sorted(specs, key=lambda spec: (spec.position, spec.metric_name))
    ]
    yield [_csv_safe(value) for value in ["time", *_CSV_FIELDS[1:], *names]]
    turns = iter(
        _filtered_turns(db, source, filters)
        .options(load_only(*(getattr(LiveTurn, name) for name in _CSV_FIELDS)))
        .order_by(_order(_sort_value(source, filters), filters), LiveTurn.id)
        .yield_per(500)
    )
    while True:
        batch = list(islice(turns, 500))
        if not batch:
            return
        scores = _export_scores(db, source, [turn.id for turn in batch], names)
        for turn in batch:
            values = _columns(turn, _CSV_FIELDS)
            turn_scores = scores.get(turn.id, {})
            row = [
                "" if values[name] is None else str(values[name])
                for name in _CSV_FIELDS
            ] + [_csv_score(turn_scores.get(name)) for name in names]
            yield [_csv_safe(value) for value in row]
