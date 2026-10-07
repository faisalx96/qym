"""Bounded, in-process lifecycle management for background analyses.

Analysis work is deliberately isolated from the request event loop.  Each
executor worker owns the event loop used by its analyzer runner and the
SQLAlchemy session created by the runner.  Jobs run in the process that
accepted them; all in-memory state is protected by a threading lock so progress
updates and polling are safe across worker threads.  When the submitting
request passes its database (``store_bind``), the job is also published to
``background_jobs`` (services/job_registry.py) so that other web worker
processes can report it, find it as the run's active job and cancel it.

In split mode (``QYM_SERVICE=main``) ``submit(..., enqueue=True)`` only
queues the job in ``background_jobs``; a workers process claims it and runs
it through :meth:`AnalysisJobManager.adopt` (services/job_executor.py).
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Iterable, Optional, Set, Tuple, Union
from uuid import uuid4

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.services.job_registry import (
    EXPIRED_ERROR,
    ActiveJobExists,
    JobDescription,
    job_registry,
)


ACTIVE_JOB_STATUSES = frozenset({"queued", "running", "cancelling"})
TERMINAL_JOB_STATUSES = frozenset({"completed", "failed", "cancelled"})


def _pass_number_from_payload(payload: Dict[str, Any]) -> Optional[int]:
    value = payload.get("pass_number")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass
class AnalysisJob:
    """Mutable state for one background run analysis."""

    run_id: str
    user_id: str
    auth_type: str
    request_payload: Dict[str, Any]
    job_id: str = field(default_factory=lambda: f"analysis_{uuid4().hex}")
    status: str = "queued"
    progress: Dict[str, Any] = field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    cancel_requested: bool = False
    created_at: datetime = field(default_factory=utc_now_naive)
    updated_at: datetime = field(default_factory=utc_now_naive)
    completed_at: Optional[datetime] = None
    # Kept as a compatibility field for callers that inspected the old task.
    # It now refers to the task on the worker-owned loop, not the request loop.
    task: Optional[asyncio.Task[Any]] = field(default=None, repr=False)
    future: Optional[Future[Any]] = field(default=None, repr=False)
    worker_loop: Optional[asyncio.AbstractEventLoop] = field(default=None, repr=False)
    request_wakeup_task: Optional[asyncio.Task[Any]] = field(default=None, repr=False)
    # True once the job is published to ``background_jobs``; a finished job's
    # full result then lives there and is released from memory (``released``).
    published: bool = field(default=False, repr=False)
    released: bool = field(default=False, repr=False)

    def touch(self) -> None:
        self.updated_at = utc_now_naive()

    def snapshot(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "run_id": self.run_id,
            "pass_number": _pass_number_from_payload(self.request_payload),
            "status": self.status,
            "progress": dict(self.progress),
            "result": self.result,
            "error": self.error,
            "cancel_requested": self.cancel_requested,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
        }


class RemoteAnalysisJob:
    """A job owned by another process, as published in ``background_jobs``."""

    def __init__(self, row: Dict[str, Any]) -> None:
        snapshot = dict(row.get("snapshot") or {})
        self.job_id = str(row["id"])
        self.run_id = str(row.get("scope_id") or snapshot.get("run_id") or "")
        self.status = str(row.get("status") or snapshot.get("status") or "")
        self.cancel_requested = bool(
            row.get("cancel_requested") or snapshot.get("cancel_requested")
        )
        self.lost = bool(row.get("lost"))
        self._snapshot = snapshot
        self._row = row
        if self.lost:
            # The owning process stopped (restart, crash or deploy) mid-job.
            self.status = "failed"

    def snapshot(self) -> Dict[str, Any]:
        snap = dict(self._snapshot)
        progress = dict(snap.get("progress") or {})
        if self.lost:
            progress["phase"] = "failed"
            snap["error"] = (
                EXPIRED_ERROR
                if self._row.get("lost_reason") == EXPIRED_ERROR
                else "The server process running this job stopped before it "
                "finished. Start it again."
            )
        snap.update(
            job_id=self.job_id,
            run_id=self.run_id,
            status=self.status,
            progress=progress,
            cancel_requested=self.cancel_requested,
            created_at=self._row.get("created_at"),
            updated_at=self._row.get("updated_at"),
            completed_at=self._row.get("completed_at")
            or (self._row.get("heartbeat_at") if self.lost else None),
        )
        return snap


AnyAnalysisJob = Union[AnalysisJob, RemoteAnalysisJob]


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


AnalysisRunner = Callable[[AnalysisJob], Awaitable[Dict[str, Any]]]


def _configured_worker_count() -> int:
    try:
        return max(1, int(os.getenv("QYM_ANALYSIS_JOB_MAX_WORKERS", "2")))
    except (TypeError, ValueError):
        return 2


class AnalysisJobManager:
    """Own analysis jobs independently from the request that started them."""

    def __init__(
        self,
        *,
        max_retained_jobs: int = 20,
        max_workers: Optional[int] = None,
        job_id_prefix: str = "analysis",
    ) -> None:
        self._jobs: Dict[str, AnalysisJob] = {}
        self._max_retained_jobs = max(1, int(max_retained_jobs))
        self._max_workers = max(1, int(max_workers or _configured_worker_count()))
        self._job_id_prefix = str(job_id_prefix or "analysis")
        self._lock = threading.RLock()
        self._executor: Optional[ThreadPoolExecutor] = None
        self._shutdown = False

    def _ensure_executor(self) -> ThreadPoolExecutor:
        with self._lock:
            if self._executor is None or self._shutdown:
                self._executor = ThreadPoolExecutor(
                    max_workers=self._max_workers,
                    thread_name_prefix="qym-analysis",
                )
                self._shutdown = False
            return self._executor

    def configure(self, *, max_workers: int) -> None:
        """Apply application settings before the executor is first used."""
        with self._lock:
            if self._executor is None:
                self._max_workers = max(1, int(max_workers))

    @property
    def kind(self) -> str:
        return self._job_id_prefix

    def get(self, job_id: str, db: Any = None) -> Optional[AnyAnalysisJob]:
        """This process's job, else (given ``db``) the one another process published.

        A finished local job whose result was released from memory is read
        back from its published row so pollers still get the full result.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            released = job is not None and job.released
        if db is None or (job is not None and not released):
            return job
        row = job_registry.fetch(db, self.kind, job_id)
        if row is not None:
            return RemoteAnalysisJob(row)
        return job

    def active_for_run(
        self, run_id: str, pass_number: Optional[int] = None, db: Any = None
    ) -> Optional[AnyAnalysisJob]:
        with self._lock:
            for job in reversed(list(self._jobs.values())):
                if (
                    job.run_id == run_id
                    and _pass_number_from_payload(job.request_payload) == pass_number
                    and job.status in ACTIVE_JOB_STATUSES
                ):
                    return job
        if db is None:
            return None
        for row in job_registry.active(
            db, self.kind, scope_ids=[run_id], pass_number=pass_number
        ):
            with self._lock:
                if row["id"] in self._jobs:
                    continue  # finished here since the scan above
            return RemoteAnalysisJob(row)
        return None

    def _describe(self, job: AnalysisJob) -> JobDescription:
        with self._lock:
            snap = job.snapshot()
        for key in ("created_at", "updated_at", "completed_at"):
            snap.pop(key, None)
        return JobDescription(
            scope_id=job.run_id,
            pass_number=_pass_number_from_payload(job.request_payload),
            owner_user_id=job.user_id,
            status=job.status,
            active=job.status in ACTIVE_JOB_STATUSES,
            snapshot=_json_safe(snap),
            error=job.error,
            created_at=job.created_at,
            updated_at=job.updated_at,
            completed_at=job.completed_at,
        )

    async def submit(
        self,
        *,
        run_id: str,
        user_id: str,
        auth_type: str,
        request_payload: Dict[str, Any],
        progress: Optional[Dict[str, Any]],
        runner: AnalysisRunner,
        store_bind: Any = None,
        enqueue: bool = False,
    ) -> Tuple[AnyAnalysisJob, bool]:
        """Create a job or return the existing active job for this run/pass.

        ``store_bind`` (the request's engine or connection) publishes the job
        for the other web worker processes and finds theirs. ``enqueue``
        (split mode) queues it for a workers process instead of running it
        here; ``runner`` is then unused (the worker has its own).
        """
        if enqueue:
            return await asyncio.to_thread(
                self._enqueue,
                run_id=run_id,
                user_id=user_id,
                auth_type=auth_type,
                request_payload=request_payload,
                progress=progress,
                store_bind=store_bind,
            )
        pass_number = _pass_number_from_payload(request_payload)
        with self._lock:
            existing = next(
                (
                    job
                    for job in reversed(list(self._jobs.values()))
                    if (
                        job.run_id == run_id
                        and _pass_number_from_payload(job.request_payload)
                        == pass_number
                        and job.status in ACTIVE_JOB_STATUSES
                    )
                ),
                None,
            )
            if existing is not None:
                return existing, False

            job = AnalysisJob(
                run_id=run_id,
                user_id=user_id,
                auth_type=auth_type,
                request_payload=dict(request_payload),
                progress=dict(progress or {}),
            )
            job.job_id = f"{self._job_id_prefix}_{uuid4().hex}"
            self._jobs[job.job_id] = job
        if store_bind is not None:
            # Claimed before it starts: a second start on another web worker
            # process gets this job back instead of a duplicate LLM run.
            try:
                published = job_registry.track(
                    store_bind,
                    kind=self.kind,
                    job_id=job.job_id,
                    describe=lambda: self._describe(job),
                    on_cancel=lambda: self.cancel(job.job_id),
                    exclusive=True,
                )
            except ActiveJobExists as conflict:
                with self._lock:
                    self._jobs.pop(job.job_id, None)
                return RemoteAnalysisJob(conflict.row), False
            with self._lock:
                job.published = bool(published)
        with self._lock:
            executor = self._ensure_executor()
            # A tiny caller-loop heartbeat makes thread-originated progress
            # and asyncio primitives observable immediately to the polling
            # request.  It also avoids relying on non-thread-safe Future wakeup
            # internals when a test/client callback signals from a worker.
            job.request_wakeup_task = asyncio.create_task(
                self._request_loop_heartbeat(job)
            )
            job.future = executor.submit(self._worker_entry, job, runner)
            self._prune_unlocked()
        return job, True

    def _enqueue(
        self,
        *,
        run_id: str,
        user_id: str,
        auth_type: str,
        request_payload: Dict[str, Any],
        progress: Optional[Dict[str, Any]],
        store_bind: Any,
    ) -> Tuple[AnyAnalysisJob, bool]:
        """Queue the job in ``background_jobs`` for a workers process."""
        if store_bind is None:
            raise RuntimeError("Queued analysis jobs need the request's database")
        job = AnalysisJob(
            run_id=run_id,
            user_id=user_id,
            auth_type=auth_type,
            request_payload=dict(request_payload),
            progress=dict(progress or {}),
        )
        job.job_id = f"{self._job_id_prefix}_{uuid4().hex}"
        payload = _json_safe(
            {
                "run_id": run_id,
                "user_id": user_id,
                "auth_type": auth_type,
                "request_payload": dict(request_payload),
                "progress": dict(progress or {}),
            }
        )
        try:
            # Exclusive like a local start: one unfinished job per run/pass
            # across the queue and every process.
            row = job_registry.enqueue(
                store_bind,
                kind=self.kind,
                job_id=job.job_id,
                description=self._describe(job),
                payload=payload,
                exclusive=True,
            )
        except ActiveJobExists as conflict:
            return RemoteAnalysisJob(conflict.row), False
        return RemoteAnalysisJob(row), True

    def free_slots(self) -> int:
        """Executor threads not busy with an unfinished job of this process."""
        with self._lock:
            busy = sum(
                1 for job in self._jobs.values() if job.status in ACTIVE_JOB_STATUSES
            )
        return max(0, self._max_workers - busy)

    def running_count(self) -> int:
        with self._lock:
            return sum(
                1 for job in self._jobs.values() if job.status in ACTIVE_JOB_STATUSES
            )

    def adopt(self, row: Dict[str, Any], runner: AnalysisRunner, store_bind: Any) -> AnalysisJob:
        """Run a job a ``main`` service queued (``row`` from ``job_registry.claim``).

        The job keeps its id; from here on this process owns, heartbeats and
        cancels it exactly like a job it accepted itself.
        """
        payload = dict(row.get("payload") or {})
        snapshot = dict(row.get("snapshot") or {})
        job = AnalysisJob(
            run_id=str(payload.get("run_id") or row.get("scope_id") or ""),
            user_id=str(payload.get("user_id") or row.get("owner_user_id") or ""),
            auth_type=str(payload.get("auth_type") or "none"),
            request_payload=dict(payload.get("request_payload") or {}),
            progress=dict(snapshot.get("progress") or payload.get("progress") or {}),
        )
        job.job_id = str(row["id"])
        if row.get("created_at") is not None:
            job.created_at = row["created_at"]
        with self._lock:
            self._jobs[job.job_id] = job
        published = job_registry.track(
            store_bind,
            kind=self.kind,
            job_id=job.job_id,
            describe=lambda: self._describe(job),
            on_cancel=lambda: self.cancel(job.job_id),
        )
        with self._lock:
            job.published = bool(published)
            executor = self._ensure_executor()
            job.future = executor.submit(self._worker_entry, job, runner)
            self._prune_unlocked()
        return job

    async def _request_loop_heartbeat(self, job: AnalysisJob) -> None:
        try:
            while True:
                await asyncio.sleep(0.01)
                with self._lock:
                    if job.status in TERMINAL_JOB_STATUSES:
                        return
        except asyncio.CancelledError:
            return

    def _worker_entry(self, job: AnalysisJob, runner: AnalysisRunner) -> None:
        """Run one job with a loop owned exclusively by this executor thread."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        task = loop.create_task(self._run(job, runner))
        with self._lock:
            job.worker_loop = loop
            job.task = task
        try:
            loop.run_until_complete(task)
        finally:
            try:
                pending = asyncio.all_tasks(loop)
                for pending_task in pending:
                    pending_task.cancel()
                if pending:
                    loop.run_until_complete(
                        asyncio.gather(*pending, return_exceptions=True)
                    )
            finally:
                loop.close()
                with self._lock:
                    job.worker_loop = None
                    job.task = None

    async def _run(self, job: AnalysisJob, runner: AnalysisRunner) -> None:
        with self._lock:
            if job.cancel_requested:
                self._finish_cancelled_unlocked(job)
                return
            job.status = "running"
            job.progress["phase"] = "running"
            job.touch()
        job_registry.changed(job.job_id)
        try:
            result = await runner(job)
            with self._lock:
                if job.cancel_requested:
                    self._finish_cancelled_unlocked(job)
                else:
                    job.result = result
                    job.status = "completed"
        except asyncio.CancelledError:
            with self._lock:
                self._finish_cancelled_unlocked(job)
        except Exception as exc:  # pragma: no cover - runner-specific failures
            with self._lock:
                job.status = "failed"
                job.progress["phase"] = "failed"
                job.error = str(exc)
        finally:
            with self._lock:
                if job.completed_at is None:
                    job.completed_at = utc_now_naive()
                job.touch()
                self._prune_unlocked()
            job_registry.changed(job.job_id, flush=True)
            self._release_if_persisted(job)

    def _release_if_persisted(self, job: AnalysisJob) -> None:
        """Drop a finished job's heavy state once ``background_jobs`` holds it.

        The terminal snapshot (with the full ``result``) is written by the
        flush above, and the registry forgets a job only after that write
        succeeded.  Without a shareable database (in-memory SQLite: tests,
        embedded use) the result stays in memory, bounded by
        ``max_retained_jobs``.
        """
        with self._lock:
            if (
                not job.published
                or job.released
                or job.status not in TERMINAL_JOB_STATUSES
                or job_registry.is_tracked(job.job_id)
            ):
                return
            job.result = None
            pass_number = _pass_number_from_payload(job.request_payload)
            job.request_payload = (
                {"pass_number": pass_number} if pass_number is not None else {}
            )
            job.released = True

    @staticmethod
    def _finish_cancelled_unlocked(job: AnalysisJob) -> None:
        job.status = "cancelled"
        job.progress["phase"] = "cancelled"
        job.result = None

    def cancel(self, job_id: str, db: Any = None) -> Optional[AnyAnalysisJob]:
        """Cancel a job of this process, or (given ``db``) flag another's."""
        with self._lock:
            local = job_id in self._jobs
        if not local:
            if db is None:
                return None
            row = job_registry.request_cancel(
                db, self.kind, job_id, status="cancelled", mark=_mark_cancelled
            )
            return RemoteAnalysisJob(row) if row is not None else None
        job = self._cancel_local(job_id)
        if job is not None:
            job_registry.changed(job_id, flush=True)
        return job

    def _cancel_local(self, job_id: str) -> Optional[AnalysisJob]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_JOB_STATUSES:
                return job
            job.cancel_requested = True
            # A queued Future can be removed without entering the worker.
            if job.status == "queued" and job.future is not None and job.future.cancel():
                self._finish_cancelled_unlocked(job)
                job.completed_at = utc_now_naive()
                job.touch()
                return job
            # Expose cancellation immediately to polling clients.  The worker
            # still receives ``cancel_requested`` and is interrupted at its
            # next await, so it cannot enter aggregation or persistence.
            job.status = "cancelled"
            job.progress["phase"] = "cancelled"
            job.result = None
            job.completed_at = utc_now_naive()
            job.touch()
            loop = job.worker_loop
            task = job.task
            if loop is not None and task is not None and not task.done():
                # Interrupt an in-flight await; the runner also checks the
                # cooperative flag before aggregation and persistence.
                loop.call_soon_threadsafe(task.cancel)
            return job

    def active_scope_ids(self, db: Any = None) -> Set[str]:
        """Run ids (or ``project:<slug>`` scopes) that have an unfinished job.

        Given ``db``, jobs of the other web worker processes count too.
        """
        with self._lock:
            scopes = {job.run_id for job in self._jobs.values() if job.status in ACTIVE_JOB_STATUSES}
        if db is not None:
            scopes.update(
                str(row["scope_id"])
                for row in job_registry.active(db, self.kind)
                if row.get("scope_id")
            )
        return scopes

    def cancel_scopes(self, scope_ids: Iterable[str], db: Any = None) -> int:
        """Cancel every unfinished job of these runs or scopes (all processes given ``db``)."""
        wanted = set(scope_ids)
        with self._lock:
            job_ids = [
                job.job_id
                for job in self._jobs.values()
                if job.run_id in wanted and job.status in ACTIVE_JOB_STATUSES
            ]
        if db is not None:
            job_ids.extend(
                row["id"]
                for row in job_registry.active(db, self.kind, scope_ids=wanted)
                if row["id"] not in job_ids
            )
        for job_id in job_ids:
            self.cancel(job_id, db=db)
        return len(job_ids)

    def update_progress(self, job: AnalysisJob, **values: Any) -> None:
        with self._lock:
            job.progress.update(values)
            job.touch()
        job_registry.changed(job.job_id)

    def snapshot(self, job: Optional[AnyAnalysisJob]) -> Optional[Dict[str, Any]]:
        if isinstance(job, RemoteAnalysisJob):
            return job.snapshot()
        with self._lock:
            return job.snapshot() if job is not None else None

    def clear(self) -> None:
        """Cancel and forget jobs; intended for application/test teardown."""
        with self._lock:
            job_ids = list(self._jobs)
        for job_id in job_ids:
            self.cancel(job_id)
        with self._lock:
            for job in self._jobs.values():
                heartbeat = job.request_wakeup_task
                if heartbeat is not None and not heartbeat.done():
                    heartbeat.cancel()
            self._jobs.clear()

    def shutdown(self, *, wait: bool = True) -> None:
        """Stop accepting work and release the bounded executor."""
        with self._lock:
            executor = self._executor
            self._shutdown = True
            job_ids = [
                job.job_id
                for job in self._jobs.values()
                if job.status not in TERMINAL_JOB_STATUSES
            ]
            self._executor = None
        for job_id in job_ids:
            self.cancel(job_id)
        if executor is not None:
            executor.shutdown(wait=wait, cancel_futures=True)

    def _prune_unlocked(self) -> None:
        if len(self._jobs) <= self._max_retained_jobs:
            return
        terminal = sorted(
            (
                job
                for job in self._jobs.values()
                if job.status in TERMINAL_JOB_STATUSES
            ),
            key=lambda job: job.updated_at,
        )
        for job in terminal[: max(0, len(self._jobs) - self._max_retained_jobs)]:
            self._jobs.pop(job.job_id, None)


def _mark_cancelled(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    progress = dict(snapshot.get("progress") or {})
    progress["phase"] = "cancelled"
    snapshot.update(
        status="cancelled", progress=progress, result=None, cancel_requested=True
    )
    return snapshot


analysis_job_manager = AnalysisJobManager()
rule_inference_job_manager = AnalysisJobManager(job_id_prefix="rule_inference")


__all__ = [
    "ACTIVE_JOB_STATUSES",
    "TERMINAL_JOB_STATUSES",
    "AnalysisJob",
    "AnalysisJobManager",
    "RemoteAnalysisJob",
    "analysis_job_manager",
    "rule_inference_job_manager",
]
