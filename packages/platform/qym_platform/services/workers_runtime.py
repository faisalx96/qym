"""Everything the workers service runs, in one place.

``python -m qym_platform.worker`` (no HTTP) and the workers HTTP app
(``QYM_SERVICE=workers``, app_factories.create_workers_app) both start a
:class:`WorkersRuntime`:

* the four database-mediated loops (dashboard summaries, maintenance +
  retention, Evaluation Service dispatch, remote queue snapshots);
* the :class:`~qym_platform.services.job_executor.JobExecutor` that runs the
  jobs a ``main`` service queued;
* a heartbeat row in ``service_heartbeats`` so main's admin page can show
  whether the workers are alive.

Dead loops are restarted by :meth:`WorkersRuntime.supervise_once`.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import timedelta
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import delete, insert, select, update
from sqlalchemy.orm import sessionmaker

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.background_job_models import ServiceHeartbeat
from qym_platform.services.job_registry import process_id

logger = logging.getLogger(__name__)

_HEARTBEATS = ServiceHeartbeat.__table__
# A heartbeat older than this many intervals reads as a stopped process.
ALIVE_INTERVALS = 3
PRUNE_AFTER = timedelta(days=1)


class ServiceHeartbeatWriter:
    """Upserts this process's ``service_heartbeats`` row every ``interval`` s."""

    def __init__(
        self,
        engine: Any,
        *,
        service: str,
        interval: float,
        info: Callable[[], Dict[str, Any]],
    ) -> None:
        self.engine = engine
        self.service = service
        self.interval = float(interval)
        self.info = info
        self.started_at = utc_now_naive()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def beat(self) -> None:
        now = utc_now_naive()
        try:
            info = dict(self.info() or {})
        except Exception as exc:  # report, never skip the heartbeat
            info = {"error": f"{type(exc).__name__}: {exc}"[:300]}
        info["interval_seconds"] = self.interval
        me = process_id()
        with self.engine.begin() as conn:
            result = conn.execute(
                update(_HEARTBEATS)
                .where(_HEARTBEATS.c.id == me)
                .values(heartbeat_at=now, info=info, service=self.service)
            )
            if not result.rowcount:
                conn.execute(
                    insert(_HEARTBEATS).values(
                        id=me,
                        service=self.service,
                        started_at=self.started_at,
                        heartbeat_at=now,
                        info=info,
                    )
                )
            conn.execute(delete(_HEARTBEATS).where(_HEARTBEATS.c.heartbeat_at < now - PRUNE_AFTER))

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.beat()
            except Exception:
                logger.warning("Could not write the service heartbeat", exc_info=True)
            self._stop.wait(self.interval)

    def start(self) -> None:
        if self.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="qym-heartbeat", daemon=True)
        self._thread.start()

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(5)
        try:  # a clean shutdown leaves no stale "alive" row behind
            with self.engine.begin() as conn:
                conn.execute(delete(_HEARTBEATS).where(_HEARTBEATS.c.id == process_id()))
        except Exception:
            logger.warning("Could not remove the service heartbeat", exc_info=True)


def read_service_heartbeats(bind: Any, service: str = "workers") -> List[Dict[str, Any]]:
    """Heartbeat rows of ``service``, newest first, each with an ``alive`` flag."""
    engine = getattr(bind, "engine", bind)
    now = utc_now_naive()
    with engine.connect() as conn:
        rows = conn.execute(
            select(_HEARTBEATS)
            .where(_HEARTBEATS.c.service == service)
            .order_by(_HEARTBEATS.c.heartbeat_at.desc())
        ).all()
    out = []
    for row in rows:
        data = dict(row._mapping)
        info = dict(data.get("info") or {})
        interval = float(info.get("interval_seconds") or 10.0)
        age = (now - data["heartbeat_at"]).total_seconds()
        data["info"] = info
        data["age_seconds"] = round(age, 1)
        data["alive"] = age <= interval * ALIVE_INTERVALS
        out.append(data)
    return out


class WorkersRuntime:
    """The loops, the job executor and the heartbeat of one workers process."""

    def __init__(self, settings: Any = None, *, service: str = "workers") -> None:
        from qym_platform.db.session import build_engine
        from qym_platform.db.session import engine as job_engine
        from qym_platform.services.dashboard_summaries import DashboardSummaryWorker
        from qym_platform.services.eval_dispatcher import EvalDispatcher
        from qym_platform.services.eval_remote_queue import RemoteQueueSnapshotter
        from qym_platform.services.job_executor import JobExecutor
        from qym_platform.services.maintenance import MaintenanceWorker
        from qym_platform.settings import PlatformSettings

        self.settings = settings or PlatformSettings()
        self.service = service
        from qym_platform.services.analysis_jobs import (
            analysis_job_manager,
            rule_inference_job_manager,
        )

        analysis_job_manager.configure(max_workers=self.settings.analysis_job_max_workers)
        rule_inference_job_manager.configure(max_workers=self.settings.analysis_job_max_workers)
        # Loops: their own small pool, so a backfill cannot starve jobs.
        self.engine = build_engine(self.settings, role="worker")
        sessions = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.loops: Dict[str, Any] = {
            "dashboard_summary": DashboardSummaryWorker(sessions),
            "maintenance": MaintenanceWorker(sessions, self.engine),
            "eval_dispatcher": EvalDispatcher(sessions),
            "remote_queue_snapshotter": RemoteQueueSnapshotter(sessions),
        }
        self.executor = JobExecutor(
            job_engine, poll_interval=self.settings.job_poll_interval_seconds
        )
        self.heartbeat = ServiceHeartbeatWriter(
            self.engine,
            service=service,
            interval=self.settings.service_heartbeat_seconds,
            info=self.status,
        )
        self.started_at = time.time()

    def start(self) -> None:
        # Import the job runners (API modules) on this thread, before any
        # loop thread runs a query: concurrent first imports are unsafe.
        self.executor.prepare()
        for loop in self.loops.values():
            loop.start()
        self.executor.start()
        self.heartbeat.start()
        logger.info("qym workers runtime started (%s)", ", ".join([*self.loops, "job_executor"]))

    def supervise_once(self) -> None:
        """Restart whatever died (called about once a second)."""
        for name, loop in self.loops.items():
            if not loop.is_alive():
                logger.error("%s died; restarting", name)
                loop.start()
        if not self.executor.is_alive():
            logger.error("job executor died; restarting")
            self.executor.start()
        if not self.heartbeat.is_alive():
            self.heartbeat.start()

    def stop(self) -> None:
        self.heartbeat.stop()
        self.executor.stop()
        # Reverse start order, as the old worker did.
        for name in reversed(list(self.loops)):
            try:
                self.loops[name].stop()
            except Exception:
                logger.warning("Stopping %s failed", name, exc_info=True)
        from qym_platform.services.analysis_jobs import (
            analysis_job_manager,
            rule_inference_job_manager,
        )

        analysis_job_manager.shutdown(wait=False)
        rule_inference_job_manager.shutdown(wait=False)
        self.engine.dispose()

    def status(self) -> Dict[str, Any]:
        maintenance = self.loops.get("maintenance")
        return {
            "service": self.service,
            "process_id": process_id(),
            "uptime_seconds": round(time.time() - self.started_at, 1),
            "loops": {name: bool(loop.is_alive()) for name, loop in self.loops.items()},
            "maintenance_current_job": getattr(maintenance, "current_job_id", None),
            "job_executor": self.executor.status(),
        }


__all__ = [
    "ServiceHeartbeatWriter",
    "WorkersRuntime",
    "read_service_heartbeats",
]
