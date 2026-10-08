"""Delta-maintained trace statistics with durable, indexed item contributions.

A run row lock serializes source mutations and projection updates. Existing runs
are backfilled once; subsequent refreshes read only touched traces/items. Public
metadata contains the original presentation schema, never the private ledger.

Memory and lock time stay bounded on the ingest path:

* spans are read as the handful of columns the bucket reducer needs (never
  their events or links), one bounded chunk of traces at a time;
* a rebuild (one-time backfill, or an explicit full rebuild) streams items in
  keyset chunks as ``(id, item_id, trace_id, error, item_metadata)`` and
  writes contributions with bulk inserts instead of ORM entities;
* a refresh that fails does not drop the ledger (that turned every following
  batch into a full rebuild under the run lock). The summary is marked stale
  instead, remembering what the failed batch touched, and later refreshes back
  off exponentially before repairing those traces incrementally.
"""

from __future__ import annotations

import copy
import math
import time
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import bindparam, insert
from sqlalchemy.orm import Session
from sqlalchemy.orm.util import identity_key

from qym_platform.db.models import (
    Run,
    RunItem,
    RunTraceAggregate,
    RunTraceContribution,
    RunTraceNamedContribution,
    RunTraceSummary,
    Span,
)

# Private marker kept in ``RunTraceSummary.totals`` while the ledger needs repair.
STALE_KEY = "_stale"
# Past this many remembered ids the marker asks for a full rebuild instead.
STALE_MAX_IDS = 20_000
STALE_BACKOFF_BASE_SECONDS = 30
STALE_BACKOFF_MAX_SECONDS = 3600
# Bounded working sets for rebuilds.
TRACE_CHUNK = 100
ITEM_CHUNK = 500

_AGGREGATE_FIELDS = (
    "span_count",
    "tokens",
    "cost",
    "llm_calls",
    "tool_calls",
    "tool_errors",
    "malformed_tool_calls",
    "noisy_reasoning",
    "provider_errors",
    "has_reasoning",
    "has_reasoning_tokens",
    "reasoning_tokens",
)


def _chunks(values, size=400):
    values = list(values)
    return (values[pos : pos + size] for pos in range(0, len(values), size))


def _named_entries(bucket):
    totals = bucket.get("outer_scope_parent_span_ms") or {}
    counts = bucket.get("outer_scope_parent_span_counts") or {}
    for position, (name, value) in enumerate(totals.items()):
        try:
            duration = float(value)
            count = int(counts.get(name) or 0)
        except (TypeError, ValueError):
            continue
        if count > 0 and math.isfinite(duration) and duration >= 0:
            yield name, duration, count, position


def _apply_delta(totals, bucket, sign):
    totals["items"] += sign
    numeric = totals["bucket"]
    for key, value in bucket.items():
        if isinstance(value, (int, float)) and math.isfinite(value):
            numeric[key] = numeric.get(key, 0) + sign * value
    for name, duration, count, _ in _named_entries(bucket):
        entry = totals["names"].setdefault(name, {"total": 0.0, "count": 0})
        entry["total"] += sign * duration
        entry["count"] += sign * count
        if entry["count"] <= 0:
            totals["names"].pop(name, None)


def _load_spans(db: Session, run_id: str, trace_ids: Iterable[str]) -> list:
    """The reducer's columns for ``trace_ids``, in arrival order per trace.

    Rows (not ORM entities): span events/links and the identity map stay out.
    """
    rows = []
    for chunk in _chunks(trace_ids):
        rows.extend(
            db.query(
                Span.trace_id,
                Span.span_id,
                Span.parent_span_id,
                Span.name,
                Span.status,
                Span.duration_ms,
                Span.attributes,
            )
            .filter(Span.run_id == run_id, Span.trace_id.in_(chunk))
            .order_by(Span.id)
            .all()
        )
    return rows


def _write_aggregate(db, run_id, aggregates, trace_id, bucket, sanitize):
    agg = aggregates.get(trace_id)
    if agg is None:
        agg = RunTraceAggregate(run_id=run_id, trace_id=trace_id)
        aggregates[trace_id] = agg
        db.add(agg)
    for key in _AGGREGATE_FIELDS:
        setattr(agg, key, bucket.get(key, 0))
    agg.raw_bucket = sanitize(bucket)


def _item_projection(item_metadata, error, bucket, public_bucket, sanitize):
    """``(included, metadata)`` for one item given its trace bucket."""
    has_spans = int(bucket.get("span_count") or 0) > 0
    included = has_spans and not error
    metadata = dict(item_metadata or {})
    if has_spans:
        metadata["trace_stats"] = sanitize(public_bucket(bucket))
    else:
        metadata.pop("trace_stats", None)
    return bool(included), sanitize(metadata)


# --------------------------------------------------------------------------------------
# Stale marker (failure back-off)
# --------------------------------------------------------------------------------------


def _merge_stale(stale, trace_ids, item_ids, *, failed, now):
    stale = dict(stale or {})
    if stale.get("rebuild") != "full":
        traces = set(stale.get("traces") or ()) | set(trace_ids or ())
        items = set(stale.get("items") or ()) | set(item_ids or ())
        if len(traces) + len(items) > STALE_MAX_IDS:
            stale["rebuild"] = "full"
            stale.pop("traces", None)
            stale.pop("items", None)
        else:
            stale["traces"] = sorted(traces)
            stale["items"] = sorted(items)
    if failed:
        failures = int(stale.get("failures") or 0) + 1
        stale["failures"] = failures
        delay = min(
            STALE_BACKOFF_MAX_SECONDS,
            STALE_BACKOFF_BASE_SECONDS * (2 ** min(failures - 1, 16)),
        )
        stale["retry_at"] = now + delay
    return stale


def mark_trace_statistics_stale(
    db: Session,
    run_id: str,
    *,
    touched_trace_ids: Optional[Iterable[str]] = None,
    touched_item_ids: Optional[Iterable[str]] = None,
    failed: bool = True,
) -> None:
    """Remember a refresh that did not happen; never deletes the ledger.

    A failed refresh backs off exponentially, so a statement timeout cannot
    turn every later batch into another expensive attempt. Without a ledger
    yet, an empty one is created that asks for the one-time backfill.
    """
    summary = (
        db.query(RunTraceSummary).filter_by(run_id=run_id).populate_existing().first()
    )
    now = time.time()
    if summary is None:
        summary = RunTraceSummary(
            run_id=run_id,
            totals={"items": 0, "bucket": {}, "names": {}},
        )
        db.add(summary)
        base = {"rebuild": "backfill"}
    else:
        base = (summary.totals or {}).get(STALE_KEY)
    totals = dict(summary.totals or {"items": 0, "bucket": {}, "names": {}})
    totals[STALE_KEY] = _merge_stale(
        base, touched_trace_ids, touched_item_ids, failed=failed, now=now
    )
    summary.totals = totals
    db.flush()


# --------------------------------------------------------------------------------------
# Refresh
# --------------------------------------------------------------------------------------


def refresh_trace_statistics(
    db: Session,
    run: Run,
    *,
    touched_trace_ids: Optional[set[str]] = None,
    touched_item_ids: Optional[set[str]] = None,
    defer_on_backoff: bool = False,
) -> bool:
    """Refresh trace statistics; ``False`` when deferred by a failure back-off.

    ``touched_trace_ids=None`` asks for a full rebuild from spans (maintenance
    and tests). Ingest always passes the touched sets: without a ledger yet,
    that is the one-time backfill; otherwise only the touched traces/items are
    read.
    """
    db.flush()
    db.query(Run.id).filter(Run.id == run.id).with_for_update().one()
    summary = (
        db.query(RunTraceSummary).filter_by(run_id=run.id).populate_existing().first()
    )
    stale = (summary.totals or {}).get(STALE_KEY) if summary is not None else None
    if touched_trace_ids is None:
        mode = "full"
    elif summary is None:
        mode = "backfill"
    elif stale:
        if defer_on_backoff and float(stale.get("retry_at") or 0) > time.time():
            mark_trace_statistics_stale(
                db,
                run.id,
                touched_trace_ids=touched_trace_ids,
                touched_item_ids=touched_item_ids,
                failed=False,
            )
            return False
        touched_trace_ids = set(touched_trace_ids) | set(stale.get("traces") or ())
        touched_item_ids = set(touched_item_ids or ()) | set(stale.get("items") or ())
        mode = stale.get("rebuild") or "incremental"
    else:
        mode = "incremental"

    if mode == "incremental":
        _refresh_incremental(db, run, summary, touched_trace_ids, touched_item_ids)
    else:
        _rebuild(db, run, summary, touched_trace_ids, full=mode == "full")
    return True


def _refresh_incremental(db, run, summary, touched_trace_ids, touched_item_ids):
    from qym_platform.api.ingest import (
        _build_trace_buckets_from_spans,
        _empty_trace_bucket,
        _public_trace_bucket,
        _sanitize_for_json,
        _trace_bucket_from_aggregate,
    )

    totals = copy.deepcopy(summary.totals)
    totals.pop(STALE_KEY, None)
    rebuild_traces = set(touched_trace_ids or ())
    ids = set(touched_item_ids or ())
    # IDs are queried in bounded chunks; unrelated raw item payloads are
    # never loaded. Include both old and new mappings, including deletions.
    item_map = {}
    for chunk in _chunks(rebuild_traces):
        for item in db.query(RunItem).filter(
            RunItem.run_id == run.id, RunItem.trace_id.in_(chunk)
        ):
            item_map[item.item_id] = item
        ids.update(
            row[0]
            for row in db.query(RunTraceContribution.item_id).filter(
                RunTraceContribution.run_id == run.id,
                RunTraceContribution.trace_id.in_(chunk),
            )
        )
    ids.update(item_map)
    for chunk in _chunks(ids - item_map.keys()):
        for item in db.query(RunItem).filter(
            RunItem.run_id == run.id, RunItem.item_id.in_(chunk)
        ):
            item_map[item.item_id] = item
    items = sorted(item_map.values(), key=lambda item: item.id)
    existing = {}
    for chunk in _chunks(ids):
        for row in db.query(RunTraceContribution).filter(
            RunTraceContribution.run_id == run.id,
            RunTraceContribution.item_id.in_(chunk),
        ):
            existing[row.item_id] = row
    relevant_traces = rebuild_traces | {
        item.trace_id for item in items if item.trace_id
    }
    aggregates = {}
    for chunk in _chunks(relevant_traces):
        for row in db.query(RunTraceAggregate).filter(
            RunTraceAggregate.run_id == run.id,
            RunTraceAggregate.trace_id.in_(chunk),
        ):
            aggregates[row.trace_id] = row
    # A newly linked trace may predate its cache. Rebuild only that trace.
    rebuild_traces.update(relevant_traces - aggregates.keys())
    rebuilt = _build_trace_buckets_from_spans(_load_spans(db, run.id, rebuild_traces))
    for trace_id in rebuild_traces:
        _write_aggregate(
            db,
            run.id,
            aggregates,
            trace_id,
            rebuilt.get(trace_id) or _empty_trace_bucket(),
            _sanitize_for_json,
        )

    affected_ids = set(existing) | {item.item_id for item in items}
    affected_names = set()
    for old in existing.values():
        if old.included:
            _apply_delta(totals, old.bucket, -1)
            affected_names.update(name for name, *_ in _named_entries(old.bucket))
    for chunk in _chunks(affected_ids):
        db.query(RunTraceNamedContribution).filter(
            RunTraceNamedContribution.run_id == run.id,
            RunTraceNamedContribution.item_id.in_(chunk),
        ).delete(synchronize_session=False)
    named_rows = []
    retained = set()
    for item in items:
        retained.add(item.item_id)
        agg = aggregates.get(item.trace_id)
        bucket = (
            _trace_bucket_from_aggregate(agg)
            if agg is not None
            else _empty_trace_bucket()
        )
        included, item.item_metadata = _item_projection(
            item.item_metadata,
            item.error,
            bucket,
            _public_trace_bucket,
            _sanitize_for_json,
        )
        state = existing.get(item.item_id)
        if state is None:
            state = RunTraceContribution(run_id=run.id, item_id=item.item_id)
            db.add(state)
        state.item_order, state.trace_id = item.id, item.trace_id
        state.included, state.bucket = included, _sanitize_for_json(bucket)
        if included:
            _apply_delta(totals, bucket, 1)
            for name, _, _, position in _named_entries(bucket):
                affected_names.add(name)
                named_rows.append(
                    dict(
                        run_id=run.id,
                        item_id=item.item_id,
                        name=name,
                        item_order=item.id,
                        name_position=position,
                    )
                )
    for item_id in set(existing) - retained:
        db.delete(existing[item_id])
    for chunk in _chunks(named_rows):
        db.execute(insert(RunTraceNamedContribution), chunk)
    db.flush()
    _finalize(db, run, summary, totals, affected_names)


def _rebuild(db, run, summary, touched_trace_ids, *, full):
    """Recompute the ledger with bounded memory.

    ``full`` recomputes every trace aggregate from its spans. Otherwise (the
    one-time backfill) only touched traces and traces without a cached
    aggregate are recomputed: older installations can have cached aggregates
    whose raw spans are gone, and those must be kept.
    """
    from qym_platform.api.ingest import (
        _build_trace_buckets_from_spans,
        _empty_trace_bucket,
        _public_trace_bucket,
        _sanitize_for_json,
        _trace_bucket_from_aggregate,
    )

    run_id = run.id
    db.query(RunTraceContribution).filter_by(run_id=run_id).delete(
        synchronize_session=False
    )
    db.query(RunTraceNamedContribution).filter_by(run_id=run_id).delete(
        synchronize_session=False
    )
    if summary is None:
        summary = RunTraceSummary(run_id=run_id)
        db.add(summary)

    cached = {
        row[0]
        for row in db.query(RunTraceAggregate.trace_id).filter(
            RunTraceAggregate.run_id == run_id
        )
    }
    if full:
        rebuild_traces = cached | {
            row[0]
            for row in db.query(Span.trace_id).filter(Span.run_id == run_id).distinct()
        }
    else:
        rebuild_traces = set(touched_trace_ids or ()) | (
            {
                row[0]
                for row in db.query(RunItem.trace_id)
                .filter(RunItem.run_id == run_id, RunItem.trace_id.isnot(None))
                .distinct()
            }
            - cached
        )

    # 1. Trace aggregates, a bounded chunk of traces at a time.
    for chunk in _chunks(sorted(rebuild_traces), TRACE_CHUNK):
        rebuilt = _build_trace_buckets_from_spans(_load_spans(db, run_id, chunk))
        aggregates = {
            row.trace_id: row
            for row in db.query(RunTraceAggregate).filter(
                RunTraceAggregate.run_id == run_id,
                RunTraceAggregate.trace_id.in_(chunk),
            )
        }
        for trace_id in chunk:
            _write_aggregate(
                db,
                run_id,
                aggregates,
                trace_id,
                rebuilt.get(trace_id) or _empty_trace_bucket(),
                _sanitize_for_json,
            )
        db.flush()
        for agg in aggregates.values():
            db.expunge(agg)
        del rebuilt, aggregates

    # 2. Contributions, streaming items in keyset chunks of projected columns.
    totals = {"items": 0, "bucket": {}, "names": {}}
    affected_names = set()
    items_table = RunItem.__table__
    update_metadata = (
        items_table.update()
        .where(items_table.c.id == bindparam("_pk"))
        .values(item_metadata=bindparam("_metadata"))
    )
    last_id = None
    while True:
        query = db.query(
            RunItem.id,
            RunItem.item_id,
            RunItem.trace_id,
            RunItem.error,
            RunItem.item_metadata,
        ).filter(RunItem.run_id == run_id)
        if last_id is not None:
            query = query.filter(RunItem.id > last_id)
        rows = query.order_by(RunItem.id).limit(ITEM_CHUNK).all()
        if not rows:
            break
        last_id = rows[-1].id
        buckets: Dict[str, Dict[str, Any]] = {}
        for chunk in _chunks({row.trace_id for row in rows if row.trace_id}):
            for agg in db.query(
                RunTraceAggregate.trace_id,
                RunTraceAggregate.raw_bucket,
                *(getattr(RunTraceAggregate, key) for key in _AGGREGATE_FIELDS),
            ).filter(
                RunTraceAggregate.run_id == run_id,
                RunTraceAggregate.trace_id.in_(chunk),
            ):
                buckets[agg.trace_id] = _trace_bucket_from_aggregate(agg)
        contributions, named_rows, metadata_updates = [], [], []
        for row in rows:
            bucket = buckets.get(row.trace_id) or _empty_trace_bucket()
            # Pending changes were flushed above, so the row is current.
            included, metadata = _item_projection(
                row.item_metadata,
                row.error,
                bucket,
                _public_trace_bucket,
                _sanitize_for_json,
            )
            if metadata != (row.item_metadata or {}):
                # An item the caller holds is updated through its entity so a
                # later change in the same batch does not write a stale value.
                entity = db.identity_map.get(identity_key(RunItem, row.id))
                if entity is not None:
                    entity.item_metadata = metadata
                else:
                    metadata_updates.append({"_pk": row.id, "_metadata": metadata})
            contributions.append(
                dict(
                    run_id=run_id,
                    item_id=row.item_id,
                    item_order=row.id,
                    trace_id=row.trace_id,
                    included=included,
                    bucket=_sanitize_for_json(bucket),
                )
            )
            if included:
                _apply_delta(totals, bucket, 1)
                for name, _, _, position in _named_entries(bucket):
                    affected_names.add(name)
                    named_rows.append(
                        dict(
                            run_id=run_id,
                            item_id=row.item_id,
                            name=name,
                            item_order=row.id,
                            name_position=position,
                        )
                    )
        db.execute(insert(RunTraceContribution), contributions)
        if named_rows:
            db.execute(insert(RunTraceNamedContribution), named_rows)
        if metadata_updates:
            # Core statement: only ``trace_stats`` changes here, which the
            # dashboard outbox does not project; no ORM entities are loaded.
            db.execute(update_metadata, metadata_updates)
        del rows, buckets, contributions, named_rows, metadata_updates
    db.flush()
    _finalize(db, run, summary, totals, affected_names)


def _finalize(db, run, summary, totals, affected_names):
    from qym_platform.api.ingest import _build_run_trace_stats, _sanitize_for_json

    for name in affected_names:
        entry = totals["names"].get(name)
        if entry is not None:
            first = (
                db.query(
                    RunTraceNamedContribution.item_order,
                    RunTraceNamedContribution.name_position,
                )
                .filter_by(run_id=run.id, name=name)
                .order_by(
                    RunTraceNamedContribution.item_order,
                    RunTraceNamedContribution.name_position,
                )
                .first()
            )
            entry["order"] = list(first) if first else [0, 0]

    bucket = dict(totals["bucket"])
    names = sorted(
        totals["names"].items(), key=lambda pair: pair[1].get("order", [0, 0])
    )
    bucket["outer_scope_parent_span_ms"] = {
        name: entry["total"] for name, entry in names
    }
    bucket["outer_scope_parent_span_counts"] = {
        name: entry["count"] for name, entry in names
    }
    if totals["items"]:
        # Aggregate latencies and tool success use sums/counts; item averages
        # alone need the number of eligible items rather than one summed bucket.
        public = _build_run_trace_stats([bucket])
        for key in (
            "avg_tokens",
            "avg_llm_calls",
            "avg_tool_calls",
            "avg_reasoning_tokens",
        ):
            public[key] /= totals["items"]
    else:
        public = {"has_spans": False}
    totals.pop(STALE_KEY, None)
    summary.totals = _sanitize_for_json(totals)
    metadata = dict(run.run_metadata or {})
    metadata["trace_stats"] = _sanitize_for_json(public)
    run.run_metadata = metadata
