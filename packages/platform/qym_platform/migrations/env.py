from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from dotenv import load_dotenv
load_dotenv()  # Load .env file

from alembic import context
from sqlalchemy import engine_from_config, pool

from qym_platform.db.base import Base
from qym_platform.db import models  # noqa: F401  (import models for metadata)
from qym_platform.db.migration_lock import migration_guard
from qym_platform.log import apply_platform_format, get_logger
from qym_platform.settings import PlatformSettings


config = context.config
if config.config_file_name is not None:
    import logging as _logging

    # Provide `sys` so alembic.ini handler args like `(sys.stderr,)` evaluate correctly.
    # Keep the platform's module loggers enabled (fileConfig disables every
    # logger it does not name by default), and give alembic.ini's handler the
    # platform format (QYM_LOG_FORMAT) and secret redaction.
    fileConfig(config.config_file_name, defaults={"sys": sys}, disable_existing_loggers=False)
    apply_platform_format(_logging.getLogger().handlers)

logger = get_logger("qym_platform.migrations")

target_metadata = Base.metadata


def get_url() -> str:
    return PlatformSettings().database_url


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # PostgreSQL: replicas starting together take turns (advisory lock)
        # and DDL waits at most QYM_MIGRATION_LOCK_TIMEOUT for its locks.
        with migration_guard(connection):
            context.configure(connection=connection, target_metadata=target_metadata)

            with context.begin_transaction():
                context.run_migrations()


try:
    if context.is_offline_mode():
        logger.info("running migrations offline")
        run_migrations_offline()
    else:
        logger.info("running migrations")
        run_migrations_online()
except Exception:
    logger.exception("migrations failed")
    raise
logger.info("migrations finished")


