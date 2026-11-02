"""Span reads scoped to one run's partition (C184).

``spans`` is partitioned by ``run_created_at``, the run's own ``created_at``
(api/ingest.py writes it from the run, and the 0053 copy joined the runs row).
A filter on ``run_id`` alone makes Postgres plan every partition (about 75 with
daily partitions and 60-day retention); adding ``run_created_at`` prunes to one.
SQLite has no partitions, so there the filter stays on ``run_id``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from qym_platform.db.models import Run, Span


def _partitioned(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def span_run_clause(db: Session, run_id: str, run_created_at: Optional[datetime]):
    """``Span.run_id == run_id``, plus the partition key on Postgres when it is known."""
    clause = Span.run_id == run_id
    if run_created_at is not None and _partitioned(db):
        clause = and_(clause, Span.run_created_at == run_created_at)
    return clause


def spans_of_runs_clause(db: Session, run_ids: Iterable[str]):
    """The spans of several runs, each bound to its partition on Postgres."""
    ids = list(dict.fromkeys(run_ids))
    if not _partitioned(db):
        return Span.run_id.in_(ids)
    created: Dict[str, datetime] = dict(db.query(Run.id, Run.created_at).filter(Run.id.in_(ids)).all())
    return or_(*(span_run_clause(db, run_id, created.get(run_id)) for run_id in ids))
