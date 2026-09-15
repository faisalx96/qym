"""Maintenance job queue; drop redundant run_events/spans indexes; type-aware event index.

Instant DDL only. ``run_events`` and ``spans`` on production are tens of GB, so
the new ``(run_id, type, sequence)`` index is created inline only when the
table is small; otherwise a ``create_deferred_indexes`` maintenance job is
queued and built CONCURRENTLY by the worker (see services/maintenance.py).

Dropped indexes are prefix-covered by existing unique constraints:
- ix_run_events_run_id   ⊂ uq_run_event_event_id (run_id, event_id)
- ix_run_events_event_id (never used alone; lookups are by run_id + event_id)
- ix_spans_run_id        ⊂ uq_span (run_id, span_id) and ix_span_run_trace
Dropping them frees disk immediately, which matters on a full volume.
"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

DEFERRED_INDEXES = [
    {"name": "ix_run_events_run_type_seq", "table": "run_events", "columns": ["run_id", "type", "sequence"]},
]
INLINE_ROW_LIMIT = 1_000_000


def _estimated_rows(bind, table: str) -> float:
    if bind.dialect.name != "postgresql":
        return 0.0
    value = bind.execute(sa.text("SELECT reltuples FROM pg_class WHERE relname = :t"), {"t": table}).scalar()
    return float(value or 0.0)


def upgrade():
    bind = op.get_bind()
    op.create_table(
        "maintenance_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("log", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("requested_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("lease_owner", sa.String(length=64), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_maintenance_jobs_status_created", "maintenance_jobs", ["status", "created_at"])

    for name, table in (
        ("ix_run_events_run_id", "run_events"),
        ("ix_run_events_event_id", "run_events"),
        ("ix_spans_run_id", "spans"),
    ):
        if bind.dialect.name == "postgresql":
            op.execute(sa.text(f"DROP INDEX IF EXISTS {name}"))
        else:
            existing = {ix["name"] for ix in sa.inspect(bind).get_indexes(table)}
            if name in existing:
                op.drop_index(name, table_name=table)

    deferred = []
    for spec in DEFERRED_INDEXES:
        if _estimated_rows(bind, spec["table"]) > INLINE_ROW_LIMIT:
            deferred.append(spec)
        else:
            op.create_index(spec["name"], spec["table"], spec["columns"])
    if deferred:
        now = datetime.utcnow()
        op.execute(
            sa.text(
                "INSERT INTO maintenance_jobs (id, kind, status, params, progress, log, created_at, updated_at) "
                "VALUES (:id, 'create_deferred_indexes', 'queued', :params, '{}', :log, :now, :now)"
            ).bindparams(
                id=str(uuid4()),
                params=json.dumps({"indexes": deferred}),
                log="queued by migration 0051: table too large to index during startup",
                now=now,
            )
        )


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("DROP INDEX IF EXISTS ix_run_events_run_type_seq"))
    else:
        existing = {ix["name"] for ix in sa.inspect(bind).get_indexes("run_events")}
        if "ix_run_events_run_type_seq" in existing:
            op.drop_index("ix_run_events_run_type_seq", table_name="run_events")
    op.create_index("ix_run_events_run_id", "run_events", ["run_id"])
    op.create_index("ix_run_events_event_id", "run_events", ["event_id"])
    op.create_index("ix_spans_run_id", "spans", ["run_id"])
    op.drop_index("ix_maintenance_jobs_status_created", table_name="maintenance_jobs")
    op.drop_table("maintenance_jobs")
