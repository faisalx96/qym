"""Remote queue snapshots: a redacted, periodically refreshed copy of each
environment's Evaluation Service queue (plan §4.6a, §13).

``RemoteQueueSnapshotter`` is a background thread started next to ``EvalDispatcher``
(``worker.py``, and the API process when ``QYM_ROLE=all``). Every ``interval`` seconds
it refreshes each **active** environment that has local jobs in progress
(``QUEUED``/``SUBMITTING``/``SUBMITTED``/``RUNNING``/``CANCELLING``) and whose snapshot
is older than 30s. A refresh calls ``GET /evals?status=PENDING`` and
``?status=RUNNING`` (``limit=500``) and stores an allow-listed copy of each item:

    {remote_job_id, status, priority, user_id, created_at, run_name}

Nothing else from the service response is kept, so ``env_overrides``, ``eval_input``
(which may echo the launch token), ``result`` and any key the service adds later never
reach the database (D1). ``run_name`` is read from ``eval_input.config.run_name``.

The snapshot filters by status only, not by ``user_id``. That relies on D8: qym is the
service's only caller, so every remote job belongs to this platform.

**Page views.** The plan also refreshes while a queue page viewed the environment in
the last 5 minutes. There is no ``last_viewed_at`` column yet, so the queue API (#21)
calls :func:`refresh_snapshot_on_view` (for example in a FastAPI ``BackgroundTasks``)
whenever it serves the snapshot. It refreshes only when the stored snapshot is older
than 30s, so a page that polls keeps its environment fresh without the request itself
ever waiting on the service. The same compare-and-set guard applies, so concurrent
viewers and pods don't stampede.

**Several pods.** A refresh is claimed with a compare-and-set on ``fetched_at``:
``UPDATE … SET fetched_at = now WHERE fetched_at <= now - 30s`` (or the first
``INSERT`` of the row, where a primary-key conflict means another pod won). Only the
winner calls the service. The fetch is bounded by ``FETCH_TIMEOUT_SECONDS`` (< 30s), so
the claim outlives it and a second pod can't start a parallel fetch. The result is then
stored only if ``fetched_at`` still holds this claim, so a stale worker never
overwrites newer data. A pod that dies mid-fetch just delays the next refresh by 30s.

``fetched_at`` is therefore the time of the **last refresh attempt**. When
``fetch_error`` is set, that attempt failed and ``items`` are from the last success.

**Paused environments.** An environment with ``health_status == "error"`` (401) is not
called; its snapshot only gets ``fetch_error`` saying so. The dispatcher probes and
resumes it. A 401 during a refresh pauses the environment, exactly as the dispatcher
does.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timedelta
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Mapping,
    Optional,
    Tuple,
    TypeVar,
)

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from ..datetime_utils import utc_now_naive
from ..db.models import (
    EvalEnvironment,
    EvalExperimentJob,
    EvalJobStatus,
    EvalRemoteQueueSnapshot,
)
from ..secrets import decrypt_llm_api_key
from .eval_dispatcher import (
    ENV_AUTH_ERROR,
    ClientFactory,
    _rowcount,
    _short,
    default_client_factory,
)
from .eval_service_client import (
    EnvAuthError,
    EvalServiceClient,
    EvalServiceError,
    redact_text,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

REFRESH_INTERVAL = timedelta(seconds=30)
SCAN_INTERVAL_SECONDS = 5.0
FETCH_LIMIT = 500
# Both list calls together must finish well inside REFRESH_INTERVAL, so a claim
# always outlives its fetch (see the module docstring).
FETCH_TIMEOUT_SECONDS = 25.0
REMOTE_QUEUE_STATUSES = ("PENDING", "RUNNING")
FETCH_ERROR_MAX = 500
FIELD_MAX = 200
NOT_FETCHED_YET = "Not fetched yet"
PAUSED_AUTH = "Environment unhealthy: API key rejected"
PAUSED_UNHEALTHY = "Environment unhealthy"
# A snapshot showing one of these already explains why it isn't refreshing.
PAUSED_ERRORS = (ENV_AUTH_ERROR, PAUSED_AUTH, PAUSED_UNHEALTHY)

SNAPSHOT_FIELDS = (
    "remote_job_id",
    "status",
    "priority",
    "user_id",
    "created_at",
    "run_name",
)

# Local jobs that keep an environment's snapshot refreshing in the background.
# BLOCKED waits on a user action, not on the remote queue, so it doesn't count.
ACTIVE_LOCAL_STATUSES = (
    EvalJobStatus.QUEUED,
    EvalJobStatus.SUBMITTING,
    EvalJobStatus.SUBMITTED,
    EvalJobStatus.RUNNING,
    EvalJobStatus.CANCELLING,
)


# ------------------------------------------------------------------ allow-list


def _text_field(value: Any) -> Optional[str]:
    if value is None or isinstance(value, (dict, list)):
        return None
    text = str(value)
    return text if len(text) <= FIELD_MAX else text[:FIELD_MAX]


def _run_name(item: Mapping[str, Any]) -> Optional[str]:
    eval_input = item.get("eval_input")
    config = eval_input.get("config") if isinstance(eval_input, Mapping) else None
    name = config.get("run_name") if isinstance(config, Mapping) else None
    if not isinstance(name, str) or not name:
        return None
    return _text_field(redact_text(name))


def snapshot_item(item: Any) -> Optional[Dict[str, Any]]:
    """The allow-listed copy of one ``EvalJobRead``; ``None`` without an id.

    Only :data:`SNAPSHOT_FIELDS` are built. Nothing is copied wholesale, so fields
    such as ``env_overrides`` or ``eval_input`` can never leak into a snapshot.
    """
    if not isinstance(item, Mapping):
        return None
    remote_job_id = _text_field(item.get("id"))
    if not remote_job_id:
        return None
    status = _text_field(item.get("status"))
    priority = _text_field(item.get("priority"))
    return {
        "remote_job_id": remote_job_id,
        "status": status.upper() if status else None,
        "priority": priority.upper() if priority else None,
        "user_id": _text_field(item.get("user_id")),
        "created_at": _text_field(item.get("created_at")),
        "run_name": _run_name(item),
    }


def build_snapshot_items(pages: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Merge the per-status list responses into snapshot items.

    ``pages`` maps each queried status to its ``GET /evals`` response. ``RUNNING``
    comes first, then ``PENDING``, each newest first as the service returns them. A job
    that moved from ``PENDING`` to ``RUNNING`` between the two calls appears once, as
    ``RUNNING``.
    """
    items: List[Dict[str, Any]] = []
    seen = set()
    for status in ("RUNNING", "PENDING"):
        page = pages.get(status)
        raw = page.get("items") if isinstance(page, Mapping) else None
        for entry in raw if isinstance(raw, list) else []:
            item = snapshot_item(entry)
            if item is None or item["remote_job_id"] in seen:
                continue
            seen.add(item["remote_job_id"])
            items.append(item)
    return items


def _truncated(pages: Mapping[str, Any]) -> bool:
    for page in pages.values():
        total = page.get("total") if isinstance(page, Mapping) else None
        items = page.get("items") if isinstance(page, Mapping) else None
        if isinstance(total, int) and isinstance(items, list) and total > len(items):
            return True
    return False


# ------------------------------------------------------------------ read helper


def read_snapshot(
    db: Session,
    environment_id: str,
    *,
    now: Optional[datetime] = None,
    max_age: timedelta = REFRESH_INTERVAL,
) -> Optional[Dict[str, Any]]:
    """The stored snapshot as a dict (``None`` if never fetched), with ``stale``."""
    snapshot = db.get(EvalRemoteQueueSnapshot, environment_id)
    if snapshot is None:
        return None
    now = now or utc_now_naive()
    return {
        "environment_id": snapshot.environment_id,
        "fetched_at": snapshot.fetched_at,
        "fetch_error": snapshot.fetch_error,
        "items": [
            {key: item.get(key) for key in SNAPSHOT_FIELDS}
            for item in snapshot.items or []
            if isinstance(item, Mapping)
        ],
        "stale": snapshot.fetched_at is None or now - snapshot.fetched_at >= max_age,
    }


# ------------------------------------------------------------------ snapshotter


class RemoteQueueSnapshotter:
    """Refreshes ``eval_remote_queue_snapshots``; safe with many workers."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        client_factory: Optional[ClientFactory] = None,
        clock: Optional[Callable[[], datetime]] = None,
        wait: Optional[Callable[[float], Any]] = None,
        interval: float = SCAN_INTERVAL_SECONDS,
        refresh_interval: timedelta = REFRESH_INTERVAL,
        fetch_timeout: float = FETCH_TIMEOUT_SECONDS,
    ) -> None:
        self.session_factory = session_factory
        self._client_factory = client_factory
        self.clock = clock or utc_now_naive
        self.interval = interval
        self.refresh_interval = refresh_interval
        self.fetch_timeout = fetch_timeout
        self._stop = threading.Event()
        self._wait = wait or self._stop.wait
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # -- thread lifecycle ------------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="qym-eval-remote-queue", daemon=True
        )
        self._thread.start()

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def stop(self, *, timeout: float = 10.0) -> bool:
        self._stop.set()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=timeout)
        return not thread or not thread.is_alive()

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    self.tick()
                except Exception:  # noqa: BLE001
                    logger.exception("remote queue snapshot tick failed")
                self._wait(self.interval)
        finally:
            self.close()

    def close(self) -> None:
        if self._loop is not None and not self._loop.is_closed():
            self._loop.close()
        self._loop = None

    def _await(self, coro: Awaitable[T]) -> T:
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.new_event_loop()
        return self._loop.run_until_complete(coro)

    @property
    def client_factory(self) -> ClientFactory:
        if self._client_factory is None:
            self._client_factory = default_client_factory()
        return self._client_factory

    # -- scheduling ------------------------------------------------------------

    def tick(self) -> int:
        """Refresh every due environment. Returns how many were fetched."""
        fetched = 0
        for env_id in self.due_environment_ids():
            try:
                if self.refresh(env_id) in ("refreshed", "failed"):
                    fetched += 1
            except OperationalError:
                logger.warning("remote queue %s: database busy, retrying later", env_id)
            except Exception:  # noqa: BLE001
                logger.exception("remote queue %s: refresh failed", env_id)
        return fetched

    def due_environment_ids(self) -> List[str]:
        """Active environments with local jobs in progress and a stale snapshot."""
        threshold = self.clock() - self.refresh_interval
        env = EvalEnvironment
        snap = EvalRemoteQueueSnapshot
        has_jobs = (
            select(EvalExperimentJob.id)
            .where(
                EvalExperimentJob.environment_id == env.id,
                EvalExperimentJob.status.in_(ACTIVE_LOCAL_STATUSES),
            )
            .exists()
        )
        stmt = (
            select(env.id)
            .outerjoin(snap, snap.environment_id == env.id)
            .where(
                env.is_active.is_(True),
                has_jobs,
                # A paused environment is not called. It stays due only until its
                # snapshot shows an error, so paused envs don't churn every scan.
                (env.health_status != "error")
                | snap.environment_id.is_(None)
                | snap.fetch_error.is_(None)
                | snap.fetch_error.notin_(PAUSED_ERRORS),
                (snap.environment_id.is_(None)) | (snap.fetched_at <= threshold),
            )
            .order_by(env.id)
        )
        with self.session_factory() as db:
            return [row[0] for row in db.execute(stmt)]

    # -- one refresh -----------------------------------------------------------

    def refresh(self, environment_id: str, *, force: bool = False) -> str:
        """Refresh one environment's snapshot if it is due and this worker wins it.

        Returns ``refreshed``, ``failed`` (fetched but the call failed; previous items
        kept), ``superseded`` (fetched, but a newer claim took over, so the result was
        dropped), ``fresh`` (not due, or another worker holds the claim), ``paused``
        (environment unhealthy or unusable, not called), ``inactive`` or ``missing``.
        ``force`` shortens the minimum age from 30s to the fetch timeout (a claim
        younger than that may still be fetching, so it is always honoured).
        """
        client: Optional[EvalServiceClient] = None
        try:
            with self.session_factory() as db:
                env = db.get(EvalEnvironment, environment_id)
                if env is None:
                    return "missing"
                if not env.is_active:
                    return "inactive"
                if not force and self._is_fresh(db, environment_id):
                    return "fresh"
                client, paused_reason = self._client_for(env)
                if client is None:
                    self._note_paused(db, environment_id, paused_reason)
                    return "paused"
                claim = self._claim(db, environment_id, force=force)
                if claim is None:
                    return "fresh"
            pages, error, auth_failed = self._fetch(client)
        finally:
            self._close(client)
        return self._store(environment_id, claim, pages, error, auth_failed)

    def _client_for(
        self, env: EvalEnvironment
    ) -> Tuple[Optional[EvalServiceClient], str]:
        if env.health_status == "error":
            if env.health_error == ENV_AUTH_ERROR:
                return None, PAUSED_AUTH
            return None, PAUSED_UNHEALTHY
        if not env.api_key_encrypted:
            return None, "Environment has no API key"
        try:
            api_key = decrypt_llm_api_key(env.api_key_encrypted)
        except Exception:  # noqa: BLE001 - never surface key material
            return None, "Environment API key cannot be decrypted"
        try:
            return self.client_factory(env.base_url, api_key), ""
        except Exception as exc:  # noqa: BLE001 - e.g. URL now refused by policy
            return None, _short("Environment unavailable: " + type(exc).__name__)
        finally:
            del api_key

    def _note_paused(self, db: Session, environment_id: str, reason: str) -> None:
        """Say why the snapshot isn't refreshing, without calling the service."""
        snapshot = db.get(EvalRemoteQueueSnapshot, environment_id)
        if snapshot is None:
            db.add(
                EvalRemoteQueueSnapshot(
                    environment_id=environment_id,
                    fetched_at=self.clock(),
                    fetch_error=reason,
                    items=[],
                )
            )
        elif snapshot.fetch_error != reason:
            snapshot.fetch_error = reason
        else:
            return
        try:
            db.commit()
        except IntegrityError:  # another worker inserted it first
            db.rollback()

    def _is_fresh(self, db: Session, environment_id: str) -> bool:
        """Cheap pre-check that skips building a client for a fresh snapshot."""
        fetched_at = db.scalar(
            select(EvalRemoteQueueSnapshot.fetched_at).where(
                EvalRemoteQueueSnapshot.environment_id == environment_id
            )
        )
        return fetched_at is not None and fetched_at > self.clock() - (
            self.refresh_interval
        )

    def _claim(
        self, db: Session, environment_id: str, *, force: bool
    ) -> Optional[datetime]:
        """Compare-and-set ``fetched_at``; returns the claim value, or ``None`` if lost."""
        now = self.clock()
        snap = EvalRemoteQueueSnapshot
        # Even a forced refresh waits for a claim younger than the fetch timeout.
        min_age = (
            timedelta(seconds=self.fetch_timeout) if force else self.refresh_interval
        )
        result = db.execute(
            update(snap)
            .where(
                snap.environment_id == environment_id, snap.fetched_at <= now - min_age
            )
            .values(fetched_at=now)
            .execution_options(synchronize_session=False)
        )
        if _rowcount(result) == 1:
            db.commit()
            return now
        if db.get(snap, environment_id) is not None:
            db.rollback()
            return None
        db.add(
            snap(
                environment_id=environment_id,
                fetched_at=now,
                fetch_error=NOT_FETCHED_YET,
                items=[],
            )
        )
        try:
            db.commit()
        except IntegrityError:  # another worker inserted it first
            db.rollback()
            return None
        return now

    def _fetch(
        self, client: EvalServiceClient
    ) -> Tuple[Dict[str, Any], Optional[str], bool]:
        """Both status pages, or a short redacted error. Never raises."""

        async def fetch_all() -> Dict[str, Any]:
            # PENDING first: a job that starts in between shows up in both pages
            # and is kept once, as RUNNING, instead of being missed.
            return {
                status: await client.list(status=status, limit=FETCH_LIMIT)
                for status in REMOTE_QUEUE_STATUSES
            }

        try:
            pages = self._await(asyncio.wait_for(fetch_all(), self.fetch_timeout))
        except EnvAuthError:
            return {}, ENV_AUTH_ERROR, True
        except EvalServiceError as exc:
            return {}, _short(redact_text(str(exc)), FETCH_ERROR_MAX), False
        except asyncio.TimeoutError:
            return {}, "Evaluation service did not answer in time", False
        except Exception as exc:  # noqa: BLE001 - keep details out of the snapshot
            logger.warning("remote queue fetch failed: %s", type(exc).__name__)
            return {}, f"Remote queue fetch failed: {type(exc).__name__}", False
        return pages, None, False

    def _store(
        self,
        environment_id: str,
        claim: datetime,
        pages: Mapping[str, Any],
        error: Optional[str],
        auth_failed: bool,
    ) -> str:
        now = self.clock()
        snap = EvalRemoteQueueSnapshot
        if error is None:
            values: Dict[str, Any] = {
                "items": build_snapshot_items(pages),
                "fetch_error": None,
                "fetched_at": now,
            }
            if _truncated(pages):
                logger.warning(
                    "remote queue %s: more than %s jobs per status; snapshot truncated",
                    environment_id,
                    FETCH_LIMIT,
                )
        else:
            # Keep the previous items; ``fetched_at`` stays at the attempt time.
            values = {"fetch_error": error}
        with self.session_factory() as db:
            result = db.execute(
                update(snap)
                .where(snap.environment_id == environment_id, snap.fetched_at == claim)
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            if _rowcount(result) != 1:
                # A newer claim owns the row: drop this result, and don't let a
                # stale 401 (e.g. from before a key rotation) pause the environment.
                db.rollback()
                logger.info(
                    "remote queue %s: claim superseded; result dropped", environment_id
                )
                return "superseded"
            if auth_failed:
                self._mark_env_unauthorized(db, environment_id, now)
            db.commit()
        return "refreshed" if error is None else "failed"

    @staticmethod
    def _mark_env_unauthorized(db: Session, environment_id: str, now: datetime) -> None:
        env = db.get(EvalEnvironment, environment_id)
        if env is None:
            return
        env.health_status = "error"
        env.health_error = ENV_AUTH_ERROR
        env.health_checked_at = now
        logger.warning(
            "eval environment %s rejected its API key; queue paused", environment_id
        )

    def _close(self, client: Optional[EvalServiceClient]) -> None:
        if client is None:
            return
        try:
            self._await(client.aclose())
        except Exception:  # noqa: BLE001
            logger.debug("closing eval service client failed", exc_info=True)


# ------------------------------------------------------------------ page-view seam

_view_lock = threading.Lock()
_views_in_progress: set = set()


def refresh_snapshot_on_view(
    session_factory: Callable[[], Session],
    environment_id: str,
    *,
    client_factory: Optional[ClientFactory] = None,
    clock: Optional[Callable[[], datetime]] = None,
) -> str:
    """Refresh a snapshot because a queue page is showing it (for the #21 API).

    Call it after the response, e.g. ``background_tasks.add_task(...)``: the page
    renders the stored snapshot and never waits on the service. It is a no-op while
    the snapshot is younger than 30s, while another refresh of the same environment
    runs in this process (``busy``), or when another pod holds the claim.
    """
    with _view_lock:
        if environment_id in _views_in_progress:
            return "busy"
        _views_in_progress.add(environment_id)
    snapshotter = RemoteQueueSnapshotter(
        session_factory, client_factory=client_factory, clock=clock
    )
    try:
        return snapshotter.refresh(environment_id)
    finally:
        snapshotter.close()
        with _view_lock:
            _views_in_progress.discard(environment_id)


__all__ = (
    "FETCH_LIMIT",
    "REFRESH_INTERVAL",
    "SNAPSHOT_FIELDS",
    "RemoteQueueSnapshotter",
    "build_snapshot_items",
    "read_snapshot",
    "refresh_snapshot_on_view",
    "snapshot_item",
)
