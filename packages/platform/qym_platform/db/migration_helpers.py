"""Helpers for migrations that must stay instant on large production tables.

Production runs the Alembic upgrade in the pod entrypoint before the readiness
probe passes, so a migration may not rewrite or scan a big table. Instead it
performs the change inline when the table is small and otherwise queues a
``maintenance_jobs`` row that the worker executes later (see
``services/maintenance.py``).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

import sqlalchemy as sa

DEFAULT_INLINE_BYTES = 1 * 1024 * 1024 * 1024  # 1 GiB


def table_bytes(bind, table: str) -> int:
    if bind.dialect.name != "postgresql":
        return 0
    value = bind.execute(sa.text("SELECT pg_total_relation_size(to_regclass(:t))"), {"t": table}).scalar()
    return int(value or 0)


def is_large(bind, table: str, limit_bytes: int = DEFAULT_INLINE_BYTES) -> bool:
    return table_bytes(bind, table) > limit_bytes


def enqueue_job(bind, kind: str, params: Optional[Dict[str, Any]] = None, *, note: str = "", paused: bool = False) -> str:
    """Insert a maintenance job from inside a migration (table from 0051).

    ``paused`` jobs wait for the operator to press Start so heavy rewrites can be
    sequenced (e.g. reclaim space before rewriting a table).
    """
    job_id = str(uuid4())
    now = datetime.utcnow()
    bind.execute(
        sa.text(
            "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
            "VALUES (:id, :kind, :status, :params, '{}', :log, :now, :now)"
        ),
        {"id": job_id, "kind": kind, "status": "paused" if paused else "queued", "params": json.dumps(params or {}), "log": note, "now": now},
    )
    return job_id


# --- migration 0052: bigint ids + jsonb ------------------------------------------------
# table -> list of (column, new_type, using). Shared by the migration (small tables,
# inline) and the ``alter_column_types`` maintenance job (large tables, deferred).
COLUMN_TYPE_CONVERSIONS = {
    "run_events": [("id", "bigint", None), ("payload", "jsonb", "payload::jsonb")],
    "spans": [("id", "bigint", None), ("attributes", "jsonb", "attributes::jsonb"), ("events", "jsonb", "events::jsonb"), ("links", "jsonb", "links::jsonb")],
    "run_items": [("input", "jsonb", "input::jsonb"), ("expected", "jsonb", "expected::jsonb"), ("output", "jsonb", "output::jsonb"), ("item_metadata", "jsonb", "item_metadata::jsonb")],
    "run_item_attempts": [("output", "jsonb", "output::jsonb")],
    "run_item_scores": [("score_raw", "jsonb", "score_raw::jsonb"), ("meta", "jsonb", "meta::jsonb")],
    "run_item_pass_scores": [("meta", "jsonb", "meta::jsonb")],
    # run_trace_aggregates.raw_bucket stays json: its named buckets are order-sensitive.
}
ID_SEQUENCES = {"run_events": "run_events_id_seq", "spans": "spans_id_seq"}


def column_type_statements(table: str, *, downgrade: bool = False) -> list:
    parts = []
    for column, new_type, using in COLUMN_TYPE_CONVERSIONS[table]:
        if downgrade:
            parts.append(f"ALTER COLUMN {column} TYPE integer" if new_type == "bigint" else f"ALTER COLUMN {column} TYPE json USING {column}::json")
        else:
            parts.append(f"ALTER COLUMN {column} TYPE {new_type}" + (f" USING {using}" if using else ""))
    stmts = [f"ALTER TABLE {table} " + ", ".join(parts)]
    if table in ID_SEQUENCES:
        stmts.append(f"ALTER SEQUENCE IF EXISTS {ID_SEQUENCES[table]} AS {'integer' if downgrade else 'bigint'}")
    return stmts
