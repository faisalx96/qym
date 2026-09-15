"""Record the SQL a block of code emits and assert budgets over it.

    with record_queries(engine) as log:
        client.get("/api/runs/r1")
    assert_query_budget(log, max_statements=25, forbid_tables=["run_events"])

Works on any SQLAlchemy ``Engine`` (sqlite or postgres). The recorder hooks
``before_cursor_execute`` so it sees exactly what the driver executes, including
bulk ``executemany`` batches (counted once each).
"""

from __future__ import annotations

import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterable, Iterator, List, Optional, Sequence, Set

from sqlalchemy import event
from sqlalchemy.engine import Engine

SOURCE_HISTORY_TABLES = (
    "run_events",
    "run_items",
    "run_item_attempts",
    "run_item_scores",
    "run_item_pass_scores",
    "spans",
)

_TABLE_RE = re.compile(r"\b(?:from|join|into|update|delete\s+from)\s+\"?([a-z_][a-z0-9_]*)\"?", re.IGNORECASE)


@dataclass
class Statement:
    sql: str
    duration_ms: float
    executemany: bool

    @property
    def tables(self) -> Set[str]:
        return {m.group(1).lower() for m in _TABLE_RE.finditer(self.sql)}


@dataclass
class QueryLog:
    statements: List[Statement] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.statements)

    @property
    def total_ms(self) -> float:
        return sum(s.duration_ms for s in self.statements)

    @property
    def tables_touched(self) -> Set[str]:
        out: Set[str] = set()
        for s in self.statements:
            out |= s.tables
        return out

    def touching(self, table: str) -> List[Statement]:
        table = table.lower()
        return [s for s in self.statements if table in s.tables]

    def mentioning(self, needle: str) -> List[Statement]:
        needle = needle.lower()
        return [s for s in self.statements if needle in s.sql.lower()]

    def summary(self, limit: int = 20) -> str:
        lines = [f"{self.count} statements, {self.total_ms:.1f} ms, tables={sorted(self.tables_touched)}"]
        for s in sorted(self.statements, key=lambda s: -s.duration_ms)[:limit]:
            flat = " ".join(s.sql.split())
            lines.append(f"  {s.duration_ms:7.1f} ms  {flat[:160]}")
        return "\n".join(lines)


@contextmanager
def record_queries(engine: Engine) -> Iterator[QueryLog]:
    log = QueryLog()
    starts: List[float] = []

    def before(conn, cursor, sql, params, context, executemany):
        starts.append(time.perf_counter())

    def after(conn, cursor, sql, params, context, executemany):
        started = starts.pop() if starts else time.perf_counter()
        log.statements.append(Statement(sql=sql, duration_ms=(time.perf_counter() - started) * 1000.0, executemany=bool(executemany)))

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    try:
        yield log
    finally:
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)


def assert_query_budget(
    log: QueryLog,
    *,
    max_statements: Optional[int] = None,
    forbid_tables: Iterable[str] = (),
    forbid_sql: Iterable[str] = (),
) -> None:
    """Fail with the offending statements listed when a budget is exceeded."""
    problems: List[str] = []
    if max_statements is not None and log.count > max_statements:
        problems.append(f"{log.count} statements exceeds budget of {max_statements}")
    for table in forbid_tables:
        hits = log.touching(table)
        if hits:
            problems.append(f"{len(hits)} statement(s) touch forbidden table {table!r}")
    for needle in forbid_sql:
        hits = log.mentioning(needle)
        if hits:
            problems.append(f"{len(hits)} statement(s) contain forbidden SQL {needle!r}")
    if problems:
        raise AssertionError("; ".join(problems) + "\n" + log.summary())


def assert_no_source_scan(log: QueryLog, tables: Sequence[str] = SOURCE_HISTORY_TABLES) -> None:
    """The published read path must never touch item/event/span history."""
    assert_query_budget(log, forbid_tables=tables)
