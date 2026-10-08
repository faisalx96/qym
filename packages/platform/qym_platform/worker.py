"""Standalone background worker: ``python -m qym_platform.worker``.

Runs the dashboard summary loop, the maintenance loop, the Evaluation Service
dispatcher, its remote queue snapshotter, the executor for jobs a ``main``
service queued, and the workers heartbeat (services/workers_runtime.py)
without serving HTTP.

This process is optional. The default ``QYM_ROLE=all`` runs the loops inside
the API process. To split them, deploy this as its own pod/container with
``QYM_ROLE=worker`` and run the API pods with ``QYM_ROLE=api``. The service
split (``QYM_SERVICE=workers``) runs the same runtime inside a small HTTP app
instead, so it can be probed at ``{QYM_WORKERS_PREFIX}/healthz``. Migrations
are applied by a migration job or the API entrypoint, so the worker container
sets ``QYM_SKIP_MIGRATIONS=1``.
"""

from __future__ import annotations

import signal
import threading

from sqlalchemy.orm import configure_mappers

from qym_platform.services.dashboard_summaries import DashboardSummaryWorker  # noqa: F401
from qym_platform.services.eval_dispatcher import EvalDispatcher  # noqa: F401
from qym_platform.services.eval_remote_queue import RemoteQueueSnapshotter  # noqa: F401
from qym_platform.services.maintenance import MaintenanceWorker  # noqa: F401
from qym_platform.log import configure_logging, get_logger
from qym_platform.settings import PlatformSettings

logger = get_logger("qym_platform.worker")


def main() -> int:
    configure_logging()
    # Register every model and its outbox hooks before either thread can issue
    # an ORM query. Concurrent lazy imports can expose half-defined mappings.
    from qym_platform.db import models  # noqa: F401
    from qym_platform.services.workers_runtime import WorkersRuntime

    configure_mappers()
    settings = PlatformSettings()
    runtime = WorkersRuntime(settings)
    stop = threading.Event()

    def _stop(*_args) -> None:
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _stop)
    runtime.start()
    logger.info(
        "qym worker started (role=%s, service=%s)", settings.role, settings.service or "-"
    )
    try:
        while not stop.is_set():
            stop.wait(1.0)
            runtime.supervise_once()
    except Exception:
        logger.exception("qym worker supervision failed; stopping")
        raise
    finally:
        runtime.stop()
        logger.info("qym worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
