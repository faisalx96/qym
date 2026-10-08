"""Runs the jobs a ``main`` service queued (split mode, ``QYM_SERVICE=workers``).

``main`` inserts analyses, rule inference and product evals into
``background_jobs`` as ``queued`` rows (services/job_registry.py). This
executor polls that queue every ``QYM_JOB_POLL_INTERVAL_SECONDS``, claims as
many rows per kind as its managers have free slots
(``QYM_ANALYSIS_JOB_MAX_WORKERS``, ``QYM_PRODUCT_EVAL_MAX_WORKERS``), and hands
each to the same manager that runs a job in single-server mode
(``adopt``). From then on the job is heartbeated, published and cancellable
through ``background_jobs`` exactly as before.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy.orm import sessionmaker

from qym_platform.services.job_registry import job_registry
from qym_platform.log import get_logger

logger = get_logger(__name__)


def _analysis_kinds(
    session_factory: Any,
) -> List[Tuple[str, Any, Callable[[Dict[str, Any], Any], Any], str]]:
    from qym_platform.api.analysis import _run_analysis_job, _run_rule_inference_job
    from qym_platform.services.analysis_jobs import (
        analysis_job_manager,
        rule_inference_job_manager,
    )

    async def run_analysis(job: Any) -> Dict[str, Any]:
        return await _run_analysis_job(job, session_factory=session_factory)

    async def run_rules(job: Any) -> Dict[str, Any]:
        return await _run_rule_inference_job(job, session_factory=session_factory)

    return [
        (
            analysis_job_manager.kind,
            analysis_job_manager,
            lambda row, bind: analysis_job_manager.adopt(row, run_analysis, bind),
            "failed",
        ),
        (
            rule_inference_job_manager.kind,
            rule_inference_job_manager,
            lambda row, bind: rule_inference_job_manager.adopt(row, run_rules, bind),
            "failed",
        ),
    ]


def _product_eval_kind() -> Tuple[str, Any, Callable[[Dict[str, Any], Any], Any], str]:
    from qym_platform.api.product_evals import job_manager
    from qym_platform.services.product_evals import PRODUCT_EVAL_JOB_KIND

    return (
        PRODUCT_EVAL_JOB_KIND,
        job_manager,
        lambda row, bind: job_manager.adopt(row, bind),
        "FAILED",
    )


class JobExecutor:
    """Background thread that claims queued jobs and starts them locally."""

    def __init__(
        self,
        engine: Any,
        *,
        poll_interval: float = 1.0,
        kinds: Optional[
            List[Tuple[str, Any, Callable[[Dict[str, Any], Any], Any], str]]
        ] = None,
    ) -> None:
        # Jobs open their own sessions on this engine (the API-sized pool;
        # connections are only opened while a job runs).
        self.engine = engine
        self.poll_interval = float(poll_interval)
        self._kinds = kinds
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.last_poll_at: Optional[float] = None
        self.claimed_total = 0
        self.last_error: Optional[str] = None

    def _resolve_kinds(
        self,
    ) -> List[Tuple[str, Any, Callable[[Dict[str, Any], Any], Any], str]]:
        if self._kinds is None:
            session_factory = sessionmaker(
                bind=self.engine, autoflush=False, autocommit=False
            )
            self._kinds = _analysis_kinds(session_factory) + [_product_eval_kind()]
        return self._kinds

    def prepare(self) -> None:
        """Import the job runners now (on the caller's thread)."""
        self._resolve_kinds()

    def poll_once(self) -> int:
        """Claim and start what fits now; returns how many jobs were started."""
        started = 0
        for kind, manager, adopt, failed_status in self._resolve_kinds():
            slots = manager.free_slots()
            if slots <= 0:
                continue
            for row in job_registry.claim(self.engine, kind, limit=slots):
                try:
                    adopt(row, self.engine)
                    started += 1
                    logger.info("Started queued %s job %s", kind, row["id"])
                except Exception as exc:  # the job, not the executor, fails
                    logger.exception(
                        "Could not start queued %s job %s", kind, row["id"]
                    )
                    job_registry.fail(
                        self.engine,
                        str(row["id"]),
                        status=failed_status,
                        error=f"The workers service could not start this job: {type(exc).__name__}",
                    )
        self.claimed_total += started
        self.last_poll_at = time.time()
        return started

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.poll_once()
                self.last_error = None
            except Exception as exc:  # database blip: retry next tick
                self.last_error = f"{type(exc).__name__}: {exc}"[:300]
                logger.warning("Job queue poll failed", exc_info=True)
            self._stop.wait(self.poll_interval)

    def start(self) -> None:
        if self.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="qym-job-executor", daemon=True
        )
        self._thread.start()

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def status(self) -> Dict[str, Any]:
        running: Dict[str, int] = {}
        try:
            for kind, manager, _adopt, _failed in self._resolve_kinds():
                running[kind] = int(manager.running_count())
        except Exception:  # pragma: no cover - import problems are reported, not raised
            logger.warning("Could not read job executor status", exc_info=True)
        return {
            "alive": self.is_alive(),
            "running": running,
            "claimed_total": self.claimed_total,
            "last_poll_age_seconds": (
                round(time.time() - self.last_poll_at, 1) if self.last_poll_at else None
            ),
            "last_error": self.last_error,
        }


__all__ = ["JobExecutor"]
