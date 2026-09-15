"""Standalone background worker: ``python -m qym_platform.worker``.

Runs the dashboard summary loop and the maintenance loop without serving HTTP.
Deploy it as its own pod/container with ``QYM_ROLE=worker``; the API pods then
run with ``QYM_ROLE=api``. Migrations are applied by the API entrypoint, so the
worker container sets ``QYM_SKIP_MIGRATIONS=1``.
"""

from __future__ import annotations

import logging
import signal
import threading

from sqlalchemy.orm import configure_mappers, sessionmaker

from qym_platform.db.session import build_engine
from qym_platform.services.dashboard_summaries import DashboardSummaryWorker
from qym_platform.services.maintenance import MaintenanceWorker
from qym_platform.settings import PlatformSettings


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # Register every model and its outbox hooks before either thread can issue
    # an ORM query. Concurrent lazy imports can expose half-defined mappings.
    from qym_platform.db import models  # noqa: F401

    configure_mappers()
    settings = PlatformSettings()
    engine = build_engine(settings, role="worker")
    sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    summary = DashboardSummaryWorker(sessions)
    maintenance = MaintenanceWorker(sessions, engine)
    stop = threading.Event()

    def _stop(*_args) -> None:
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _stop)
    summary.start()
    maintenance.start()
    logging.getLogger(__name__).info("qym worker started (role=%s)", settings.role)
    try:
        while not stop.is_set():
            stop.wait(1.0)
            if not summary.is_alive():
                logging.getLogger(__name__).error("dashboard summary worker died; restarting")
                summary.start()
            if not maintenance.is_alive():
                logging.getLogger(__name__).error("maintenance worker died; restarting")
                maintenance.start()
    finally:
        maintenance.stop()
        summary.stop()
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
