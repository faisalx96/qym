"""Serialize Alembic runs and bound their lock waits (PostgreSQL).

Every container start runs ``alembic upgrade head`` unless
``QYM_SKIP_MIGRATIONS=1``. Without a guard, replicas starting together race
on the same DDL, and one DDL statement queued behind a long query makes all
later queries on that table queue behind it for as long as it waits.

``migration_guard`` takes a session advisory lock (one per schema, so
replicas of one deployment take turns while separate schemas, e.g. tests,
do not) and then sets ``lock_timeout`` for the migration session from
``QYM_MIGRATION_LOCK_TIMEOUT`` (default ``10s``; ``0`` disables it). A
migration that cannot get its lock in time fails and the container restarts
and retries, instead of stalling traffic.
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy import text

from qym_platform.log import get_logger

logger = get_logger(__name__)

# pg_advisory_lock(int4, int4): a constant class id ("QYM") + the schema hash.
MIGRATION_LOCK_CLASS = 0x51594D
DEFAULT_MIGRATION_LOCK_TIMEOUT = "10s"
_TIMEOUT = re.compile(r"^\d+\s*(ms|s|min)?$")
_LOCK_KEY = "CAST(:k AS integer), hashtext(current_schema())"


def migration_lock_timeout() -> str:
    """``QYM_MIGRATION_LOCK_TIMEOUT``, validated (``10s``, ``500ms``, ``0``)."""
    value = (
        os.getenv("QYM_MIGRATION_LOCK_TIMEOUT") or DEFAULT_MIGRATION_LOCK_TIMEOUT
    ).strip()
    if not _TIMEOUT.match(value):
        raise ValueError(
            "QYM_MIGRATION_LOCK_TIMEOUT must be a duration like '10s', '500ms' or '0'"
        )
    return value


@contextmanager
def migration_guard(connection: Any) -> Iterator[None]:
    """Hold the migration advisory lock and a bounded lock_timeout (PostgreSQL).

    Leaves ``connection`` outside a transaction, so Alembic still manages
    its own. A no-op on other databases.
    """
    if connection.dialect.name != "postgresql":
        yield
        return
    timeout = migration_lock_timeout()
    # Wait for another replica's migration without a lock_timeout, then bound
    # every lock the migrations themselves take.
    connection.execute(text("SET lock_timeout = 0"))
    connection.execute(
        text(f"SELECT pg_advisory_lock({_LOCK_KEY})"), {"k": MIGRATION_LOCK_CLASS}
    )
    connection.execute(text(f"SET lock_timeout = '{timeout}'"))
    connection.commit()
    try:
        yield
    finally:
        try:
            if connection.in_transaction():
                connection.rollback()
            connection.execute(
                text(f"SELECT pg_advisory_unlock({_LOCK_KEY})"),
                {"k": MIGRATION_LOCK_CLASS},
            )
            connection.commit()
        except Exception:
            # A broken connection drops its session lock when it closes; do
            # not mask the migration's own error.
            logger.warning("could not release the migration advisory lock", exc_info=True)
