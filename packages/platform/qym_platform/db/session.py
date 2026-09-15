from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import sessionmaker

from qym_platform.settings import PlatformSettings


def build_engine(settings: PlatformSettings | None = None, *, role: str = "api") -> Engine:
    """Engine with an explicit pool and server-side timeouts.

    ``role="api"`` sizes the pool for request handlers; ``role="worker"`` gives
    the background loops a small pool of their own so a busy backfill can never
    starve requests, and a longer statement timeout for batch work.
    """
    settings = settings or PlatformSettings()
    url = settings.database_url
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("postgresql"):
        # Preserve any libpq options already on the URL (e.g. -csearch_path=...);
        # connect_args would otherwise replace them.
        parsed = make_url(url)
        existing_options = parsed.query.get("options")
        if existing_options:
            url = parsed.difference_update_query(["options"]).render_as_string(hide_password=False)
        if role == "worker":
            pool_size, max_overflow = settings.db_worker_pool_size, settings.db_worker_max_overflow
            statement_timeout = settings.db_worker_statement_timeout_ms
        else:
            pool_size, max_overflow = settings.db_pool_size, settings.db_max_overflow
            statement_timeout = settings.db_statement_timeout_ms
        options = ([existing_options] if existing_options else []) + [
            f"-c statement_timeout={int(statement_timeout)}",
            f"-c lock_timeout={int(settings.db_lock_timeout_ms)}",
            f"-c idle_in_transaction_session_timeout={int(settings.db_idle_in_transaction_timeout_ms)}",
            f"-c application_name=qym-{role}",
        ]
        kwargs.update(
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_timeout=settings.db_pool_timeout_seconds,
            pool_recycle=settings.db_pool_recycle_seconds,
            connect_args={"options": " ".join(options)},
        )
    # future=True by default in SQLAlchemy 2.x
    return create_engine(url, **kwargs)


def _build_engine():
    return build_engine()


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
