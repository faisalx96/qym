"""Repair databases stamped by the Live chain before the 2026-11-12 renumbering."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from qym_platform.log import configure_logging, get_logger
from qym_platform.settings import PlatformSettings
from sqlalchemy.engine import Connection
from sqlalchemy.pool import NullPool

logger = get_logger(__name__)

# A separate class from migration_guard's "QYM": Alembic takes that lock on
# another connection while this session keeps the whole repair serialized.
RECONCILE_LOCK_CLASS = 0x51594E
_LOCK_KEY = "CAST(:k AS integer), hashtext(current_schema())"
_RESUME_STAMPS = {"0091", "0092", "0093"}


@dataclass(frozen=True)
class Facts:
    live_sources: bool
    live_jobs: bool
    api_key_kind: bool
    job_priority: bool


def reconciliation_action(
    stamp: Optional[str], facts: Facts
) -> Literal["none", "repair", "stamp"]:
    """Recognize only the old Live head and this tool's interrupted states."""
    if not (facts.live_sources and facts.live_jobs):
        return "none"
    if stamp not in {"0100", "0102", *_RESUME_STAMPS}:
        return "none"
    if facts.api_key_kind and facts.job_priority:
        return "stamp" if stamp in _RESUME_STAMPS else "none"
    return "repair"


def _read_state(connection: Connection) -> tuple[Optional[str], Facts]:
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())
    stamp = None
    if "alembic_version" in tables:
        # Multiple heads cannot be one of the recognized legacy stamps.
        stamps = list(
            connection.scalars(sa.text("SELECT version_num FROM alembic_version"))
        )
        stamp = ",".join(sorted(stamps)) if stamps else None

    def has_column(table: str, column: str) -> bool:
        return table in tables and any(
            item["name"] == column for item in inspector.get_columns(table)
        )

    return stamp, Facts(
        live_sources="live_sources" in tables,
        live_jobs="live_jobs" in tables,
        api_key_kind=has_column("api_keys", "kind"),
        job_priority=has_column("eval_experiment_jobs", "priority"),
    )


def _reconcile(connection: Connection) -> None:
    # Inspect under the lock, never act on a state observed before waiting.
    stamp, facts = _read_state(connection)
    # Release inspection's transaction before Alembic's separate connections
    # perform DDL. The session advisory lock survives rollback and commit.
    connection.rollback()
    action = reconciliation_action(stamp, facts)
    state = (
        "stamp=%s live_sources=%s live_jobs=%s api_keys.kind=%s "
        "eval_experiment_jobs.priority=%s"
    )
    values = (
        stamp or "none",
        facts.live_sources,
        facts.live_jobs,
        facts.api_key_kind,
        facts.job_priority,
    )
    if action == "none":
        logger.info("migration order: no action (" + state + ")", *values)
        return

    logger.info("migration order: found " + state, *values)
    logger.info(
        "migration order: decision=%s",
        (
            "repair legacy migration order"
            if action == "repair"
            else "finish interrupted repair"
        ),
    )
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    config = Config(str(migrations / "alembic.ini"))
    # Resolve the packaged scripts independently of the caller's working directory.
    config.set_main_option("script_location", str(migrations))
    if action == "repair":
        if stamp in {"0100", "0102"}:
            logger.info("migration order: step=stamp 0091")
            command.stamp(config, "0091")
        logger.info("migration order: step=upgrade 0093")
        command.upgrade(config, "0093")
    logger.info("migration order: step=stamp 0102")
    command.stamp(config, "0102")
    final_stamp = connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
    logger.info("migration order: final stamp=%s", final_stamp)


def main() -> None:
    configure_logging()
    engine = sa.create_engine(PlatformSettings().database_url, poolclass=NullPool)
    try:
        if engine.dialect.name != "postgresql":
            logger.info("migration order: no action (dialect=%s)", engine.dialect.name)
            return
        with engine.connect() as connection:
            connection.execute(
                sa.text(f"SELECT pg_advisory_lock({_LOCK_KEY})"),
                {"k": RECONCILE_LOCK_CLASS},
            )
            connection.commit()
            try:
                _reconcile(connection)
            finally:
                connection.rollback()
                connection.execute(
                    sa.text(f"SELECT pg_advisory_unlock({_LOCK_KEY})"),
                    {"k": RECONCILE_LOCK_CLASS},
                )
                connection.commit()
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
