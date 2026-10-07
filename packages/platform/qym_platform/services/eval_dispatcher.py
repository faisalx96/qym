"""Evaluation Service dispatcher: leased submit/poll loop and status model (plan §13).

``EvalDispatcher`` is a background thread, started by ``worker.py`` and by the API
process when ``QYM_ROLE=all``, that mirrors ``MaintenanceWorker``. Each tick:

1. **Claim** due jobs (``QUEUED``/``SUBMITTING``/``SUBMITTED``/``RUNNING`` whose
   ``next_attempt_at`` has passed and whose lease is free or expired). On Postgres the
   candidate rows are selected ``FOR UPDATE SKIP LOCKED``. Every dialect then takes the
   lease with a compare-and-set ``UPDATE … WHERE lease is free``, so SQLite (no row
   locks) is correct too, and two workers never hold the same job.
2. **Submit** a ``QUEUED`` job. There is no platform-side in-flight cap: the
   Evaluation Service limits concurrent runs and queues the rest itself. The
   ``QUEUED → SUBMITTING`` transition is one conditional ``UPDATE`` (still ``QUEUED``,
   leased by this worker, no cancel requested). ``SUBMITTING`` is committed *before*
   ``POST /evals``. It is the crash-safety marker.
3. **Reconcile** a ``SUBMITTING`` job whose lease expired (a crash or a timeout
   mid-submit). The worker lists ``GET /evals?user_id=…`` and matches
   ``eval_input.config.run_metadata.qym_launch.job_id``. It adopts the remote job if
   found and resubmits only if not.
4. **Poll** ``SUBMITTED``/``RUNNING`` jobs every 10s for the first 5 minutes after
   submit, then every 30s until 30 minutes, then every 60s. The linked qym run's status
   is merged in (D2): a terminal run wins over a remote ``PENDING``/``RUNNING``. A
   ``RUNNING`` job with no remote change and no run activity for 2h15m
   (``QYM_EVAL_JOB_TIMEOUT_SECONDS``) becomes ``TIMED_OUT``. The clock doesn't run while the job is still ``PENDING`` remotely or
   while the service can't be observed. Before the transition the dispatcher makes a
   best-effort ``POST /evals/{id}/cancel`` (``_time_out``); its outcome is appended
   to ``error`` and a failure never blocks the transition.

Settle sweep (every ``SETTLE_SWEEP_SECONDS``, ``settle_sweep``): once a job has been
``SUCCEEDED`` for ``KEY_REVOKE_GRACE``, a linked run that never got ``run_completed``
is closed out (``COMPLETED`` when every item arrived, else ``STOPPED`` /
``upload_incomplete``), and an experiment whose jobs all finished that long ago gets
its creator's qym API key revoked. Revoking at the moment of settling rejected the
SDK's last events (including ``run_completed``) and left finished runs ``STOPPED``.

Stale remote jobs: a job that is terminal locally (``TIMED_OUT`` after a failed
cancel, or ``CANCELLED`` by the ``CANCELLING`` give-up) may still be ``PENDING`` or
``RUNNING`` on the service. Those ids are read from the environment's stored remote
snapshot (``stale_remote_job_ids``, no service call), and managers can cancel them
from the queue (``eval_queue.cancel_remote_orphans``).

Submit outcomes: ``202`` → ``SUBMITTED``. A ``409`` while a HIGH job is active →
back to ``QUEUED`` with a 30s → 5m backoff. ``422`` → ``BLOCKED``. ``401`` →
the environment is marked unhealthy and its queue pauses (every job of that environment
waits). While paused, the dispatcher probes the environment every 5 minutes and resumes
when the probe succeeds (a successful ``/test`` or a key change in the API resumes it
too). A transport error or 5xx leaves the job ``SUBMITTING``, so it is reconciled (after
at least one lease length) before any resubmit. A 401 during that reconcile also keeps
it ``SUBMITTING``.

``wait_reason`` always says why a non-terminal job isn't progressing. After every status
change, the experiment's aggregate status is recomputed (``recompute_experiment_status``).

``updated_at`` on a job means "last meaningful change". Lease and poll bookkeeping
preserve it, and the timeout is measured against it (plus the linked run's activity).

Secrets: the resolved body (decrypted model keys, launch token, ``qym_api_key``)
exists only in memory between ``prepare_dispatch`` and the client call. It is never
stored, logged or put in an exception. Service responses are redacted by ``EvalServiceClient``, and again here
(``redact_payload`` / ``_redacted_text``) before anything from the service is stored
(``remote_result``, ``remote_versioning``, ``error``, ``wait_reason``, the
environment's ``health_error``): a client that forgets to redact leaks nothing.

Run metadata (#16): the submitted ``run_metadata`` is the stored one (``qym_config``,
``qym_launch``, user keys) plus ``qym_launch.token``, nothing else. It is copied from
``job.request_body`` *after* placeholders are filled, so a ``{{qym:slot:…}}`` string a
user put in their metadata can never pull a key into ``runs.run_metadata``.

Seams for later issues (all constructor arguments):

- ``add_launch_token(body, job_id)`` inserts the one-time launch token (#13/#16). The
  default is ``services.eval_experiments.body_with_launch_token``. Without
  ``QYM_LLM_CONFIG_ENCRYPTION_KEY`` the job waits (``QUEUED``) instead of submitting.
- ``submitter_key_for(db, experiment)``: the raw top-level ``qym_api_key`` (the
  creator's per-experiment platform key, ``services.eval_submitter_keys``). It is set
  next to the launch token, overriding anything in the stored body. When it raises
  ``SubmitterKeyUnavailable`` (key missing, revoked or unreadable; creator gone,
  disabled or no longer in the project) the job is ``BLOCKED`` with that reason
  instead of being submitted. The raw key is also scrubbed, as a literal, from
  whatever the service answers before anything of it is kept.
- ``slot_bindings_for_job(job, experiment)``: the combination's bindings. The default is
  ``job.params["slot_bindings"]``, then the ``qym_config`` copy in the stored body.
- ``secret_lookup_for(experiment)``: resolves temporary-model key refs (#12). The default
  decrypts ``experiment.secrets_encrypted`` (Fernet JSON ``{ref: key}``).
- Remote queue snapshots (#20) run in the sibling ``RemoteQueueSnapshotter``
  (``services.eval_remote_queue``). Ingest linking (#17) is separate.

Cancel (plan §13.1, #19). ``eval_experiments.cancel_jobs`` cancels queued/blocked jobs
locally and moves submitted/running ones to ``CANCELLING`` (due now). The dispatcher
claims ``CANCELLING`` jobs and calls ``POST /evals/{id}/cancel`` (``_step_cancel``):
``200`` → ``CANCELLED``; ``404`` → ``CANCELLED`` with a note; ``409`` (already terminal)
→ back to ``RUNNING`` and due now, so the next poll records the real final status; a
transport error or 5xx → retry with backoff, still ``CANCELLING``; ``401`` → the
environment pauses. After a remote cancel the linked run is marked ``STOPPED``
(``cancelled_from_queue``) unless it already ended (``stop_linked_run``).

A cancel requested while the job is leased only sets ``cancel_requested_at``. The
dispatcher checks it before the submit (the ``QUEUED → SUBMITTING`` update requires it
unset), after it (``202`` → ``CANCELLING``; any answer that created no remote job →
``CANCELLED``), after a reconcile, and on every poll (a ``SUBMITTED``/``RUNNING`` job
with a request moves to ``CANCELLING``, in case a concurrent write undid the move).
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import socket
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Set,
    Tuple,
    TypeVar,
)
from uuid import uuid4

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..datetime_utils import utc_now_naive
from ..db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    EvalRemoteQueueSnapshot,
    Run,
    RunItem,
    RunWorkflowStatus,
)
from ..secrets import decrypt_llm_api_key
from ..settings import PlatformSettings
from .eval_bindings import (
    WAIT_REASON_MAX,
    DispatchPreparation,
    SecretLookup,
    mark_job_blocked,
    prepare_dispatch,
)
from .eval_experiments import (
    ACTIVE_JOB_STATUSES,
    CANCELLING_WAIT_REASON,
    TERMINAL_JOB_STATUSES,
    LaunchTokenUnavailable,
    aggregate_status,
    body_with_launch_token,
    current_jobs,
    recompute_experiment_status,
    stop_linked_run,
)
from .eval_model_slots import descriptor_for_schema, list_model_slots
from .eval_run_scores import sync_job_scores, sync_run_scores
from .eval_service_client import (
    REDACTED,
    EnvAuthError,
    EvalServiceClient,
    EvalServiceError,
    HighPriorityActive,
    RemoteConflict,
    RemoteNotFound,
    RequestRejected,
    RetryableError,
    redact_payload,
    redact_text,
)
from .eval_submitter_keys import (
    KEY_REVOKE_GRACE,
    SubmitterKeyUnavailable,
    resolve_submitter_key,
    settled_long_enough,
)
from .eval_temporary_models import secret_lookup as temporary_secret_lookup
from .run_lifecycle import (
    RUN_STATUS_REASON_ADMIN_FORCE_STOP,
    RUN_STATUS_REASON_LEASE_TIMEOUT,
    RUN_STATUS_REASON_UPLOAD_INCOMPLETE,
    RUN_STATUS_REASONS_CANCELLED,
    SOFT_STOP_REASONS,
    mark_run_terminal,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

# ------------------------------------------------------------------ tunables

# The lease must outlive one HTTP call (client timeout: 5s connect + 30s read) by a
# wide margin. A SUBMITTING job is only reconciled after its lease expired, so the
# original POST has certainly finished by then.
LEASE_SECONDS = 120
CLAIM_BATCH = 20
HIGH_BACKOFF_MIN = 30.0
HIGH_BACKOFF_MAX = 300.0
RETRY_BACKOFF_MIN = 15.0
RETRY_BACKOFF_MAX = 300.0
SUBMIT_RECHECK_SECONDS = 10.0
ENV_PAUSE_RECHECK_SECONDS = 60.0
ENV_PROBE_INTERVAL_SECONDS = 300.0
POLL_SCHEDULE: Tuple[Tuple[float, float], ...] = (
    (5 * 60.0, 10.0),  # first 5 minutes after submit
    (30 * 60.0, 30.0),  # then until 30 minutes
)
POLL_SLOW_SECONDS = 60.0
# Default for ``QYM_EVAL_JOB_TIMEOUT_SECONDS``: the service's Celery hard limit (7200s,
# guide §2) + margin. No remote change and no run activity for this long → TIMED_OUT.
JOB_TIMEOUT = timedelta(hours=2, minutes=15)
# How often the settle sweep (late key revocation, run close-out) runs.
SETTLE_SWEEP_SECONDS = 60.0
SETTLE_SWEEP_BATCH = 100
# A linked run that completed while the service still says RUNNING: keep polling this
# long for the service's ``result`` before settling on the run's outcome (D2).
RESULT_GRACE = timedelta(minutes=10)
RECONCILE_PAGE_SIZE = 500
RECONCILE_MAX_PAGES = 20
# Remote ``created_at`` may be skewed against our clock.
RECONCILE_CLOCK_SKEW = timedelta(minutes=10)

ENV_AUTH_ERROR = "Evaluation service rejected the environment API key"

def format_duration(value: timedelta) -> str:
    """``2h15m`` / ``45m`` / ``1h``: the compact form used in job errors."""
    minutes = int(value.total_seconds() // 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours}h{minutes}m"
    return f"{hours}h" if hours else f"{minutes}m"


def timeout_error(job_timeout: timedelta) -> str:
    return (
        "No progress from the evaluation service or the linked run for "
        f"{format_duration(job_timeout)}"
    )


TIMEOUT_ERROR = timeout_error(JOB_TIMEOUT)


def configured_job_timeout() -> timedelta:
    """``QYM_EVAL_JOB_TIMEOUT_SECONDS`` (default :data:`JOB_TIMEOUT`)."""
    try:
        return timedelta(seconds=PlatformSettings().eval_job_timeout_seconds)
    except Exception:  # noqa: BLE001 - settings unavailable (e.g. no database URL)
        return JOB_TIMEOUT

# Submitted (or being submitted) and not finished yet.
INFLIGHT_JOB_STATUSES = ACTIVE_JOB_STATUSES
# Statuses this dispatcher claims.
CLAIMABLE_JOB_STATUSES = (
    EvalJobStatus.QUEUED,
    EvalJobStatus.SUBMITTING,
    EvalJobStatus.SUBMITTED,
    EvalJobStatus.RUNNING,
    EvalJobStatus.CANCELLING,
)

REMOTE_TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED"}
# Remote statuses that still hold a service worker or queue slot.
REMOTE_ACTIVE = ("PENDING", "RUNNING")
_STALE_QUERY_CHUNK = 500

ClientFactory = Callable[[str, str], EvalServiceClient]
LaunchTokenAdder = Callable[[Dict[str, Any], str], Dict[str, Any]]
SlotBindingsFor = Callable[
    [EvalExperimentJob, EvalExperiment], Optional[Mapping[str, Any]]
]
SecretLookupFor = Callable[[EvalExperiment], Optional[SecretLookup]]
SubmitterKeyFor = Callable[[Session, EvalExperiment], str]


# ------------------------------------------------------------------ pure helpers


def poll_interval(elapsed_seconds: float) -> float:
    for limit, interval in POLL_SCHEDULE:
        if elapsed_seconds < limit:
            return interval
    return POLL_SLOW_SECONDS


def high_backoff(attempts: int) -> float:
    """30s, 60s, 120s, 240s, then 5 minutes."""
    return min(HIGH_BACKOFF_MAX, HIGH_BACKOFF_MIN * (2 ** max(0, attempts - 1)))


def retry_backoff(attempts: int) -> float:
    return min(RETRY_BACKOFF_MAX, RETRY_BACKOFF_MIN * (2 ** max(0, attempts - 1)))


def extract_versioning(result: Any) -> Optional[Dict[str, Any]]:
    """``result.versioning_metadata``, falling back to legacy flat keys (guide §5)."""
    if not isinstance(result, Mapping):
        return None
    nested = result.get("versioning_metadata")
    if isinstance(nested, Mapping):
        return dict(nested)
    legacy = {
        key: result.get(key) for key in ("agent_version", "kb_version") if key in result
    }
    return legacy or None


def launch_job_id(item: Any) -> Optional[str]:
    """``eval_input.config.run_metadata.qym_launch.job_id`` of a remote job."""
    try:
        metadata = item["eval_input"]["config"]["run_metadata"]
    except (KeyError, TypeError):
        return None
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            return None
    launch = metadata.get("qym_launch") if isinstance(metadata, Mapping) else None
    job_id = launch.get("job_id") if isinstance(launch, Mapping) else None
    return str(job_id) if job_id else None


def _parse_remote_time(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _short(text: Any, limit: int = WAIT_REASON_MAX) -> str:
    value = str(text)
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _scrub_literal(value: Any, secret: Optional[str]) -> Any:
    """A copy of ``value`` with every occurrence of ``secret`` masked (keys and text)."""
    if not secret:
        return value
    if isinstance(value, str):
        return value.replace(secret, REDACTED)
    if isinstance(value, Mapping):
        return {
            _scrub_literal(k, secret): _scrub_literal(v, secret)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub_literal(item, secret) for item in value]
    return value


def _scrub_outcome(outcome: "_Outcome", secret: Optional[str]) -> "_Outcome":
    """Mask the submitted ``qym_api_key`` wherever the service may have echoed it.

    Key-named fields are already redacted by the client; this also catches the bare
    value in free text (a 422 message, an unexpected field).
    """
    if not secret:
        return outcome
    return _Outcome(
        outcome.kind,
        remote=_scrub_literal(outcome.remote, secret),
        message=_scrub_literal(outcome.message, secret),
        high_job_id=_scrub_literal(outcome.high_job_id, secret),
    )


def _redacted_text(value: Any) -> str:
    """Text to store (error, wait reason) with every credential masked.

    Defence in depth over ``EvalServiceClient``'s own redaction: structured values
    are redacted by key, then serialized; strings (JSON or free text) are redacted
    by key and by pattern. Redact before truncating, so a cut can't hide a secret.
    """
    if isinstance(value, (Mapping, list)):
        text = json.dumps(redact_payload(value), default=str)
    else:
        text = str(redact_payload(str(value)))
    return redact_text(text)


# A finished run may move on into the review flow (submitted/approved/rejected).
RUN_FINISHED_STATUSES = frozenset(
    {
        RunWorkflowStatus.COMPLETED,
        RunWorkflowStatus.SUBMITTED,
        RunWorkflowStatus.APPROVED,
        RunWorkflowStatus.REJECTED,
    }
)


def _is_run_terminal(run: Run) -> bool:
    if run.status in RUN_FINISHED_STATUSES or run.status == RunWorkflowStatus.FAILED:
        return True
    # A lease-timeout STOPPED run reopens on the next live event, so it isn't final.
    return (
        run.status == RunWorkflowStatus.STOPPED
        and run.status_reason not in SOFT_STOP_REASONS
    )


def is_stale_remote(remote_status: Any, local_status: Any) -> bool:
    """A remote job still active on the service whose local job is already terminal.

    This happens after ``TIMED_OUT`` (when the best-effort remote cancel failed) and
    after a ``CANCELLING`` give-up: qym stopped tracking the job, but it may still
    hold a service worker.
    """
    return str(remote_status or "").upper() in REMOTE_ACTIVE and (
        local_status in TERMINAL_JOB_STATUSES
    )


def stale_remote_job_ids(db: Session, environment_id: str) -> Set[str]:
    """Remote ids in the environment's latest snapshot that are stale (see above).

    Reads the stored snapshot only (no service call), so it is cheap enough for the
    dispatcher's cap check. The snapshot is at most ~30s old while the environment
    has local jobs in progress; a job that just finished locally may count for that
    long, which errs on the side of not overloading the service.
    """
    snapshot = db.get(EvalRemoteQueueSnapshot, environment_id)
    if snapshot is None or not snapshot.items:
        return set()
    active = sorted(
        {
            str(item.get("remote_job_id"))
            for item in snapshot.items
            if isinstance(item, Mapping)
            and item.get("remote_job_id")
            and str(item.get("status") or "").upper() in REMOTE_ACTIVE
        }
    )
    latest: Dict[str, Any] = {}
    table = EvalExperimentJob
    for start in range(0, len(active), _STALE_QUERY_CHUNK):
        rows = db.execute(
            select(table.remote_job_id, table.status)
            .where(
                table.environment_id == environment_id,
                table.remote_job_id.in_(active[start : start + _STALE_QUERY_CHUNK]),
            )
            .order_by(table.created_at)
        )
        for remote_job_id, status in rows:
            latest[str(remote_job_id)] = status  # the newest row wins
    return {rid for rid, status in latest.items() if status in TERMINAL_JOB_STATUSES}


# ------------------------------------------------------------------ default seams


def default_client_factory() -> ClientFactory:
    allow_private = PlatformSettings().allow_private_llm_base_urls

    def factory(base_url: str, api_key: str) -> EvalServiceClient:
        return EvalServiceClient(base_url, api_key, allow_private=allow_private)

    return factory


def _stored_run_metadata(job: EvalExperimentJob) -> Optional[Dict[str, Any]]:
    """A copy of the job's stored ``evaluator.config.run_metadata`` (or ``None``)."""
    try:
        metadata = job.request_body["evaluator"]["config"]["run_metadata"]
    except (KeyError, TypeError):
        return None
    return copy.deepcopy(dict(metadata)) if isinstance(metadata, Mapping) else None


def default_add_launch_token(
    body: Dict[str, Any], job_id: str, expected_hash: Optional[str] = None
) -> Dict[str, Any]:
    """Insert the one-time launch token (raises ``LaunchTokenUnavailable`` without a key).

    ``expected_hash`` is the job's ``launch_token_hash``: after a key rotation the
    token is derived with the previous key that matches it.
    """
    if expected_hash:
        return body_with_launch_token(body, job_id, expected_hash=expected_hash)
    return body_with_launch_token(body, job_id)


def default_slot_bindings_for_job(
    job: EvalExperimentJob, experiment: EvalExperiment
) -> Optional[Mapping[str, Any]]:
    params = job.params if isinstance(job.params, Mapping) else {}
    bindings = params.get("slot_bindings")
    if isinstance(bindings, Mapping):
        return bindings
    try:
        config = job.request_body["evaluator"]["config"]
        bindings = config["run_metadata"]["qym_config"]["slot_bindings"]
    except (KeyError, TypeError):
        return None
    return bindings if isinstance(bindings, Mapping) else None


def default_secret_lookup_for(experiment: EvalExperiment) -> Optional[SecretLookup]:
    """Temporary-model keys from ``experiment.secrets_encrypted`` (#12).

    Unreadable or cleared keys resolve to nothing, so the job is blocked with
    ``temporary_key_missing`` ("enter it again").
    """
    return temporary_secret_lookup(experiment)


# ------------------------------------------------------------------ dispatcher


@dataclass
class _EnvAccess:
    """A client for an environment, or why its queue is paused."""

    client: Optional[EvalServiceClient] = None
    paused_reason: Optional[str] = None


@dataclass
class _Outcome:
    kind: str  # accepted | high | rejected | auth | conflict | ambiguous
    remote: Optional[Dict[str, Any]] = None
    message: Optional[str] = None
    high_job_id: Optional[str] = None


class LeaseLost(Exception):
    """Another worker owns the job now; drop the in-memory work."""


class EvalDispatcher:
    """Leased submit/poll loop for ``eval_experiment_jobs``; safe with many workers."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        client_factory: Optional[ClientFactory] = None,
        clock: Optional[Callable[[], datetime]] = None,
        wait: Optional[Callable[[float], Any]] = None,
        interval: float = 2.0,
        batch: int = CLAIM_BATCH,
        owner: Optional[str] = None,
        add_launch_token: Optional[LaunchTokenAdder] = None,
        slot_bindings_for_job: Optional[SlotBindingsFor] = None,
        secret_lookup_for: Optional[SecretLookupFor] = None,
        submitter_key_for: Optional[SubmitterKeyFor] = None,
        job_timeout: Optional[timedelta] = None,
    ) -> None:
        self.session_factory = session_factory
        self.job_timeout = job_timeout or configured_job_timeout()
        self._next_settle_at: Optional[datetime] = None
        self._client_factory = client_factory
        self.clock = clock or utc_now_naive
        self.interval = interval
        self.batch = batch
        self.owner = owner or f"{socket.gethostname()[:24]}:{uuid4().hex}"[:100]
        self.add_launch_token = add_launch_token or default_add_launch_token
        self.slot_bindings_for_job = (
            slot_bindings_for_job or default_slot_bindings_for_job
        )
        self.secret_lookup_for = secret_lookup_for or default_secret_lookup_for
        self.submitter_key_for = submitter_key_for or resolve_submitter_key
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
            target=self._run, name="qym-eval-dispatcher", daemon=True
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
                    processed = self.tick()
                except Exception:  # noqa: BLE001
                    logger.exception("eval dispatcher tick failed")
                    processed = 0
                self._wait(0.2 if processed else self.interval)
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

    # -- tick ------------------------------------------------------------------

    def tick(self) -> int:
        """Claim due jobs and advance each one step. Returns the number claimed."""
        self._maybe_settle()
        claimed = self.claim()
        for job_id in claimed:
            try:
                self._process(job_id)
            except LeaseLost:
                logger.info("eval job %s: lease lost to another worker", job_id)
            except OperationalError:
                # Lock contention (SQLite "database is locked", PG lock timeout). The
                # transaction rolled back; the lease expires and the job is retried.
                logger.warning("eval job %s: database busy, retrying later", job_id)
            except Exception:  # noqa: BLE001
                logger.exception("eval job %s: dispatcher step failed", job_id)
                self._release_after_error(job_id)
        return len(claimed)

    def claim(self) -> List[str]:
        """Lease up to ``batch`` due jobs for this worker (compare-and-set per row)."""
        now = self.clock()
        job = EvalExperimentJob
        lease_free = or_(job.lease_until.is_(None), job.lease_until < now)
        due = or_(job.next_attempt_at.is_(None), job.next_attempt_at <= now)
        with self.session_factory() as db:
            stmt = (
                select(job.id)
                .where(job.status.in_(CLAIMABLE_JOB_STATUSES), due, lease_free)
                .order_by(
                    func.coalesce(job.next_attempt_at, job.created_at),
                    job.created_at,
                    job.combo_index,
                )
                .limit(self.batch)
            )
            if _is_postgres(db):
                stmt = stmt.with_for_update(skip_locked=True)
            try:
                ids = [row[0] for row in db.execute(stmt)]
                claimed = self._take_leases(db, ids, now)
                db.commit()
            except OperationalError:
                db.rollback()
                logger.info("eval dispatcher: claim lost a lock race; retrying")
                return []
        return claimed

    def _take_leases(self, db: Session, ids: Sequence[str], now: datetime) -> List[str]:
        """Compare-and-set the lease on each candidate; returns the ones won.

        The candidate list may be stale (SQLite has no row locks, and a Postgres
        worker may have read before another committed): the ``UPDATE`` re-checks
        that the lease is still free, so only one worker ever wins a row.
        """
        job = EvalExperimentJob
        claimed = []
        for job_id in ids:
            result = db.execute(
                update(job)
                .where(
                    job.id == job_id,
                    job.status.in_(CLAIMABLE_JOB_STATUSES),
                    or_(job.lease_until.is_(None), job.lease_until < now),
                )
                .values(
                    lease_owner=self.owner,
                    lease_until=now + timedelta(seconds=LEASE_SECONDS),
                    updated_at=job.updated_at,
                )
                .execution_options(synchronize_session=False)
            )
            if _rowcount(result) == 1:
                claimed.append(job_id)
        return claimed

    def _renew_lease(self, db: Session, job_id: str) -> bool:
        """Extend our lease before working on a job (a batch may outlast it)."""
        now = self.clock()
        table = EvalExperimentJob
        result = db.execute(
            update(table)
            .where(table.id == job_id, table.lease_owner == self.owner)
            .values(
                lease_until=now + timedelta(seconds=LEASE_SECONDS),
                updated_at=table.updated_at,
            )
            .execution_options(synchronize_session=False)
        )
        return _rowcount(result) == 1

    def _process(self, job_id: str) -> None:
        with self.session_factory() as db:
            if not self._renew_lease(db, job_id):
                db.rollback()
                raise LeaseLost(job_id)
            db.commit()
            job = db.get(EvalExperimentJob, job_id)
            if job is None:
                return
            status = job.status
            env_id = job.environment_id
        # A paused environment's health probe is an HTTP call: make it here,
        # before any step takes the job row FOR UPDATE.
        if env_id:
            self._probe_paused_env(env_id)
        if status == EvalJobStatus.QUEUED:
            self._step_queued(job_id)
        elif status == EvalJobStatus.SUBMITTING:
            self._step_submitting(job_id)
        elif status in (EvalJobStatus.SUBMITTED, EvalJobStatus.RUNNING):
            self._step_poll(job_id)
        elif status == EvalJobStatus.CANCELLING:
            self._step_cancel(job_id)
        else:
            self._with_job(job_id, lambda db, job: self._save(job, changed=False))

    # -- DB helpers ------------------------------------------------------------

    def _locked_job(self, db: Session, job_id: str) -> EvalExperimentJob:
        stmt = select(EvalExperimentJob).where(EvalExperimentJob.id == job_id)
        if _is_postgres(db):
            stmt = stmt.with_for_update()
        job = db.execute(stmt).scalar_one_or_none()
        if job is None or job.lease_owner != self.owner:
            raise LeaseLost(job_id)
        return job

    def _with_job(
        self, job_id: str, fn: Callable[[Session, EvalExperimentJob], T]
    ) -> T:
        """Run ``fn`` on the leased job in its own transaction and commit."""
        with self.session_factory() as db:
            job = self._locked_job(db, job_id)
            result = fn(db, job)
            sync_job_scores(db, job)  # completion hook (§13): no-op until terminal
            recompute_experiment_status(db, job.experiment_id, now=self.clock())
            db.commit()
            return result

    @staticmethod
    def _release(job: EvalExperimentJob) -> None:
        job.lease_owner = None
        job.lease_until = None

    def _save(self, job: EvalExperimentJob, *, changed: bool) -> None:
        """Release the lease. ``updated_at`` moves only on a meaningful change."""
        self._release(job)
        if changed:
            job.updated_at = self.clock()
        else:
            flag_modified(job, "updated_at")  # keep the value; suppress onupdate

    def _set_status(
        self,
        job: EvalExperimentJob,
        status: EvalJobStatus,
        *,
        wait_reason: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        job.status = status
        job.wait_reason = _short(_redacted_text(wait_reason)) if wait_reason else None
        if error is not None:
            job.error = _redacted_text(error)
        if status in TERMINAL_JOB_STATUSES:
            job.finished_at = self.clock()
            job.next_attempt_at = None

    def _defer(
        self,
        job: EvalExperimentJob,
        seconds: float,
        wait_reason: Optional[str],
    ) -> None:
        reason = _short(_redacted_text(wait_reason)) if wait_reason else None
        changed = job.wait_reason != reason
        job.wait_reason = reason
        job.next_attempt_at = self.clock() + timedelta(seconds=seconds)
        self._save(job, changed=changed)

    def _release_after_error(self, job_id: str) -> None:
        try:
            with self.session_factory() as db:
                job = db.get(EvalExperimentJob, job_id)
                if job is None or job.lease_owner != self.owner:
                    return
                job.next_attempt_at = self.clock() + timedelta(
                    seconds=RETRY_BACKOFF_MAX
                )
                self._save(job, changed=False)
                db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("eval job %s: could not release the lease", job_id)

    # -- environment access ----------------------------------------------------

    def _client_for(self, env: EvalEnvironment) -> _EnvAccess:
        """A client for ``env`` (whatever its health), or why there is none."""
        if not env.api_key_encrypted:
            return _EnvAccess(paused_reason="Environment has no API key")
        try:
            api_key = decrypt_llm_api_key(env.api_key_encrypted)
        except Exception:  # noqa: BLE001 - never surface key material
            return _EnvAccess(paused_reason="Environment API key cannot be decrypted")
        try:
            client = self.client_factory(env.base_url, api_key)
        except Exception as exc:  # noqa: BLE001 - e.g. URL now refused by policy
            return _EnvAccess(
                paused_reason=_short(
                    "Environment unavailable: " + redact_text(type(exc).__name__)
                )
            )
        finally:
            del api_key
        return _EnvAccess(client=client)

    def _env_access(self, db: Session, env: EvalEnvironment) -> _EnvAccess:
        """A client for ``env``, or the reason its queue is paused.

        A paused environment (``health_status == "error"``) stays paused here;
        ``_probe_paused_env`` (run before the job row is locked) probes it at
        most every ``ENV_PROBE_INTERVAL_SECONDS`` and marks it healthy again.
        """
        if env.health_status == "error":
            if not env.api_key_encrypted:
                return _EnvAccess(paused_reason="Environment has no API key")
            return _EnvAccess(paused_reason=self._paused_reason(env))
        return self._client_for(env)

    def _probe_paused_env(self, env_id: str) -> None:
        """Probe a paused environment whose recheck is due, holding no row lock.

        The probe is claimed first (compare-and-set on ``health_checked_at`` in a
        short transaction) so concurrent workers probe once; its outcome is
        written in a second short transaction, unless the environment changed
        meanwhile (an admin edit or another probe).
        """
        now = self.clock()
        with self.session_factory() as db:
            env = db.get(EvalEnvironment, env_id)
            if env is None or env.health_status != "error":
                return
            checked = env.health_checked_at
            if checked is not None and now - checked < timedelta(
                seconds=ENV_PROBE_INTERVAL_SECONDS
            ):
                return
            table = EvalEnvironment
            claimed = db.execute(
                update(table)
                .where(
                    table.id == env_id,
                    table.health_status == "error",
                    (
                        table.health_checked_at.is_(None)
                        if checked is None
                        else table.health_checked_at == checked
                    ),
                )
                .values(health_checked_at=now)
                .execution_options(synchronize_session=False)
            )
            if _rowcount(claimed) != 1:
                db.rollback()
                return
            db.commit()
            access = self._client_for(env)
        client = access.client
        if client is None:
            return
        healthy = False
        error: Optional[str] = None
        try:
            self._await(client.list(limit=1))
            healthy = True
        except EnvAuthError:
            error = ENV_AUTH_ERROR
        except EvalServiceError as exc:
            error = _short(_redacted_text(exc), 500)
        finally:
            self._close(client)
        with self.session_factory() as db:
            table = EvalEnvironment
            values: Dict[str, Any] = (
                {"health_status": "ok", "health_error": None}
                if healthy
                else {"health_error": error}
            )
            result = db.execute(
                update(table)
                .where(
                    table.id == env_id,
                    table.health_status == "error",
                    table.health_checked_at == now,
                )
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            db.commit()
        if healthy and _rowcount(result) == 1:
            logger.info("eval environment %s is healthy again; resuming", env_id)

    @staticmethod
    def _paused_reason(env: EvalEnvironment) -> str:
        if env.health_error == ENV_AUTH_ERROR:
            return "Environment unhealthy: API key rejected"
        return "Environment unhealthy"

    def _mark_env_unauthorized(self, db: Session, env_id: str) -> None:
        env = db.get(EvalEnvironment, env_id)
        if env is None:
            return
        env.health_status = "error"
        env.health_error = ENV_AUTH_ERROR
        env.health_checked_at = self.clock()
        logger.warning("eval environment %s rejected its API key; queue paused", env_id)

    def _close(self, client: Optional[EvalServiceClient]) -> None:
        if client is None:
            return
        try:
            self._await(client.aclose())
        except Exception:  # noqa: BLE001
            logger.debug("closing eval service client failed", exc_info=True)

    # -- submit ----------------------------------------------------------------

    def _prepare(
        self,
        db: Session,
        job: EvalExperimentJob,
        experiment: EvalExperiment,
        env: EvalEnvironment,
    ) -> DispatchPreparation:
        schema = db.get(EvalEnvironmentSchema, job.schema_id)
        slots = list_model_slots(db, job.schema_id) if schema is not None else []
        descriptor = descriptor_for_schema(schema) if schema is not None else None
        return prepare_dispatch(
            db,
            env,
            body=job.request_body or {},
            slot_bindings=self.slot_bindings_for_job(job, experiment),
            slots=slots,
            descriptor=descriptor,
            secret_lookup=self.secret_lookup_for(experiment),
        )

    def _submit_body(
        self,
        resolved: Dict[str, Any],
        job: EvalExperimentJob,
        experiment: EvalExperiment,
        qym_api_key: str,
    ) -> Dict[str, Any]:
        """Final in-memory body: user, priority, ``qym_launch`` token, ``qym_api_key``.

        ``run_metadata`` is the stored one, not the placeholder-filled copy: it is
        persisted by the run, so it must never carry a resolved key.
        """
        body = copy.deepcopy(resolved)
        body.setdefault("user_id", _service_user_id(experiment))
        body.setdefault("priority", _enum_value(experiment.priority))
        evaluator = body.setdefault("evaluator", {})
        config = evaluator.setdefault("config", {})
        stored = _stored_run_metadata(job)
        if stored is not None:
            config["run_metadata"] = stored
        metadata = config.get("run_metadata")
        if not isinstance(metadata, dict):
            metadata = config["run_metadata"] = {}
        launch = metadata.get("qym_launch")
        if not isinstance(launch, dict):
            launch = metadata["qym_launch"] = {}
        # Reconcile-after-crash matches on this id; #13 stores the rest of qym_launch.
        launch["job_id"] = job.id
        if self.add_launch_token is default_add_launch_token:
            body = default_add_launch_token(
                body, job.id, expected_hash=job.launch_token_hash
            )
        else:
            body = self.add_launch_token(body, job.id)
        # Always the platform's value: nothing stored can choose whose key is sent.
        body["qym_api_key"] = qym_api_key
        return body

    def _begin_submit(
        self,
        db: Session,
        job: EvalExperimentJob,
        env: EvalEnvironment,
        *,
        first: bool,
    ) -> bool:
        """Take the SUBMITTING marker (a first submit only from QUEUED, uncancelled).

        No in-flight cap: the Evaluation Service bounds concurrent runs and queues
        the rest, so every queued job is submitted as soon as it is ready.
        """
        now = self.clock()
        table = EvalExperimentJob
        conditions = [table.id == job.id, table.lease_owner == self.owner]
        if first:
            conditions += [
                table.status == EvalJobStatus.QUEUED,
                # A cancel that landed after this worker read the job wins.
                table.cancel_requested_at.is_(None),
            ]
        else:
            conditions.append(table.status == EvalJobStatus.SUBMITTING)
        result = db.execute(
            update(table)
            .where(*conditions)
            .values(
                status=EvalJobStatus.SUBMITTING,
                submit_attempts=table.submit_attempts + 1,
                submitted_at=now,
                lease_until=now + timedelta(seconds=LEASE_SECONDS),
                next_attempt_at=None,
                wait_reason="Submitting to the evaluation service",
                error=None,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        return _rowcount(result) == 1

    def _step_queued(self, job_id: str) -> None:
        self._try_submit(job_id, first=True)

    def _try_submit(self, job_id: str, *, first: bool) -> None:
        client: Optional[EvalServiceClient] = None
        body: Optional[Dict[str, Any]] = None
        qym_api_key: Optional[str] = None
        try:
            with self.session_factory() as db:
                job = self._locked_job(db, job_id)
                experiment = db.get(EvalExperiment, job.experiment_id)
                env = db.get(EvalEnvironment, job.environment_id)
                if experiment is None or env is None:
                    return self._block_orphan(db, job)
                if job.cancel_requested_at is not None:
                    self._set_status(job, EvalJobStatus.CANCELLED)
                    self._save(job, changed=True)
                    recompute_experiment_status(db, experiment.id, now=self.clock())
                    db.commit()
                    return
                if not env.is_active:
                    self._set_status(
                        job,
                        EvalJobStatus.BLOCKED,
                        wait_reason="Environment is disabled",
                        error="Environment is disabled",
                    )
                    job.next_attempt_at = None
                    self._save(job, changed=True)
                    recompute_experiment_status(db, experiment.id, now=self.clock())
                    db.commit()
                    return
                access = self._env_access(db, env)
                if access.client is None:
                    self._defer(job, ENV_PAUSE_RECHECK_SECONDS, access.paused_reason)
                    db.commit()
                    return
                client = access.client
                prep = self._prepare(db, job, experiment, env)
                if not prep.ok:
                    mark_job_blocked(job, prep.problems)
                    self._save(job, changed=True)
                    recompute_experiment_status(db, experiment.id, now=self.clock())
                    db.commit()
                    return
                try:
                    qym_api_key = self.submitter_key_for(db, experiment)
                except SubmitterKeyUnavailable as exc:
                    del prep
                    self._set_status(
                        job,
                        EvalJobStatus.BLOCKED,
                        wait_reason=str(exc),
                        error=str(exc),
                    )
                    job.next_attempt_at = None
                    self._save(job, changed=True)
                    recompute_experiment_status(db, experiment.id, now=self.clock())
                    db.commit()
                    return
                try:
                    body = self._submit_body(
                        prep.body or {}, job, experiment, qym_api_key
                    )
                except LaunchTokenUnavailable:
                    del prep
                    self._defer(
                        job,
                        ENV_PAUSE_RECHECK_SECONDS,
                        "Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY",
                    )
                    db.commit()
                    return
                del prep
                db.flush()
                if not self._begin_submit(db, job, env, first=first):
                    db.rollback()
                    job = self._locked_job(db, job_id)
                    # Still QUEUED: nothing was sent, so a pending cancel is local.
                    if job.status == EvalJobStatus.QUEUED and (
                        self._cancel_if_requested(db, job)
                    ):
                        recompute_experiment_status(db, experiment.id, now=self.clock())
                        db.commit()
                        return
                    if job.status not in (
                        EvalJobStatus.QUEUED,
                        EvalJobStatus.SUBMITTING,
                    ):
                        self._save(job, changed=False)  # e.g. cancelled meanwhile
                        db.commit()
                        return
                    self._defer(
                        job,
                        SUBMIT_RECHECK_SECONDS,
                        "Waiting to submit to the evaluation service",
                    )
                    db.commit()
                    return
                recompute_experiment_status(db, experiment.id, now=self.clock())
                db.commit()  # the SUBMITTING marker is durable before the POST
            outcome = _scrub_outcome(self._post(client, body), qym_api_key)
        finally:
            body = None
            qym_api_key = None
            self._close(client)
        self._apply_submit_outcome(job_id, outcome)

    def _post(self, client: EvalServiceClient, body: Dict[str, Any]) -> _Outcome:
        try:
            remote = self._await(client.submit(body))
        except HighPriorityActive as exc:
            return _Outcome("high", high_job_id=exc.job_id)
        except RequestRejected as exc:
            return _Outcome("rejected", message=str(exc))
        except EnvAuthError:
            return _Outcome("auth")
        except RetryableError as exc:
            return _Outcome("ambiguous", message=str(exc))
        except RemoteConflict as exc:
            return _Outcome("conflict", message=str(exc))
        except EvalServiceError as exc:
            if exc.status_code is not None and 400 <= exc.status_code < 500:
                return _Outcome("rejected", message=str(exc))
            return _Outcome("ambiguous", message=str(exc))
        except Exception as exc:  # noqa: BLE001 - outcome unknown: reconcile first
            logger.warning("eval submit failed unexpectedly: %s", type(exc).__name__)
            return _Outcome("ambiguous", message=type(exc).__name__)
        if not isinstance(remote, Mapping) or not remote.get("id"):
            return _Outcome("ambiguous", message="Submit response had no job id")
        return _Outcome("accepted", remote=dict(remote))

    def _apply_submit_outcome(self, job_id: str, outcome: _Outcome) -> None:
        def apply(db: Session, job: EvalExperimentJob) -> None:
            if job.status != EvalJobStatus.SUBMITTING:
                self._save(job, changed=False)
                return
            if outcome.kind in ("high", "rejected", "auth", "conflict"):
                if outcome.kind == "auth":
                    self._mark_env_unauthorized(db, job.environment_id)
                # The service created no job: a pending cancel completes locally.
                if self._cancel_if_requested(db, job):
                    return
            if outcome.kind == "accepted":
                self._adopt_remote(job, outcome.remote or {})
            elif outcome.kind == "high":
                self._set_status(
                    job,
                    EvalJobStatus.QUEUED,
                    wait_reason=f"HIGH job {outcome.high_job_id} active",
                )
                job.next_attempt_at = self.clock() + timedelta(
                    seconds=high_backoff(job.submit_attempts)
                )
                self._save(job, changed=True)
            elif outcome.kind == "rejected":
                self._set_status(
                    job,
                    EvalJobStatus.BLOCKED,
                    wait_reason="Rejected by the evaluation service",
                    error=outcome.message or "Rejected by the evaluation service",
                )
                job.next_attempt_at = None
                self._save(job, changed=True)
            elif outcome.kind == "auth":
                self._set_status(
                    job,
                    EvalJobStatus.QUEUED,
                    wait_reason="Environment unhealthy: API key rejected",
                )
                job.next_attempt_at = self.clock() + timedelta(
                    seconds=ENV_PAUSE_RECHECK_SECONDS
                )
                self._save(job, changed=True)
            elif outcome.kind == "conflict":
                self._set_status(
                    job,
                    EvalJobStatus.QUEUED,
                    wait_reason=f"Evaluation service conflict: {outcome.message}",
                )
                job.next_attempt_at = self.clock() + timedelta(
                    seconds=retry_backoff(job.submit_attempts)
                )
                self._save(job, changed=True)
            else:  # ambiguous: the remote job may exist; reconcile before resubmit
                job.wait_reason = _short(
                    "Evaluation service unreachable; checking before resubmitting"
                )
                job.error = _redacted_text(outcome.message) if outcome.message else None
                # Wait at least a lease length: the service may still be handling
                # the request the client gave up on.
                job.next_attempt_at = self.clock() + timedelta(
                    seconds=max(LEASE_SECONDS, retry_backoff(job.submit_attempts))
                )
                self._save(job, changed=True)

        self._with_job(job_id, apply)

    def _adopt_remote(self, job: EvalExperimentJob, remote: Mapping[str, Any]) -> None:
        """Record an accepted (or reconciled) remote job: ``SUBMITTED``/``RUNNING``."""
        now = self.clock()
        remote = redact_payload(remote)
        job.remote_job_id = str(remote.get("id"))
        remote_status = str(remote.get("status") or "PENDING").upper()
        job.remote_status = remote_status
        job.submitted_at = now
        job.error = None
        if job.cancel_requested_at is not None:
            # Cancel arrived while the submit was in flight: cancel remotely now.
            self._set_status(
                job, EvalJobStatus.CANCELLING, wait_reason=CANCELLING_WAIT_REASON
            )
            job.next_attempt_at = now
        elif remote_status == "RUNNING":
            self._set_status(job, EvalJobStatus.RUNNING)
            job.next_attempt_at = now + timedelta(seconds=poll_interval(0))
        else:
            self._set_status(
                job,
                EvalJobStatus.SUBMITTED,
                wait_reason="Queued on the evaluation service",
            )
            job.next_attempt_at = now + timedelta(seconds=poll_interval(0))
        self._save(job, changed=True)
        if remote_status in REMOTE_TERMINAL:
            # Rare but possible on reconcile: settle it on the next poll right away.
            job.next_attempt_at = now

    # -- reconcile a SUBMITTING job -------------------------------------------

    def _step_submitting(self, job_id: str) -> None:
        client: Optional[EvalServiceClient] = None
        try:
            with self.session_factory() as db:
                job = self._locked_job(db, job_id)
                experiment = db.get(EvalExperiment, job.experiment_id)
                env = db.get(EvalEnvironment, job.environment_id)
                if experiment is None or env is None:
                    return self._block_orphan(db, job)
                access = self._env_access(db, env)
                if access.client is None:
                    self._defer(job, ENV_PAUSE_RECHECK_SECONDS, access.paused_reason)
                    db.commit()
                    return
                client = access.client
                user_id = str(
                    (job.request_body or {}).get("user_id")
                    or _service_user_id(experiment)
                )
                since = (job.created_at or self.clock()) - RECONCILE_CLOCK_SKEW
                db.commit()
            try:
                found = self._await(self._find_remote(client, user_id, job_id, since))
            except EnvAuthError:
                # Stay SUBMITTING: the remote job may exist, so the check must
                # still run before any resubmit once the key works again.
                self._with_job(job_id, self._pause_submitting)
                return
            except EvalServiceError as exc:
                self._apply_submit_outcome(
                    job_id, _Outcome("ambiguous", message=str(exc))
                )
                return
        finally:
            self._close(client)
        if found is not None:
            logger.info(
                "eval job %s: reconciled with remote job %s", job_id, found.get("id")
            )
            self._apply_submit_outcome(job_id, _Outcome("accepted", remote=found))
            return
        cancelled = self._with_job(job_id, self._cancel_if_requested)
        if not cancelled:
            self._try_submit(job_id, first=False)

    def _block_orphan(self, db: Session, job: EvalExperimentJob) -> None:
        """The experiment or environment row is gone: stop retrying the job."""
        reason = "Experiment or environment no longer exists"
        self._set_status(job, EvalJobStatus.BLOCKED, wait_reason=reason, error=reason)
        job.next_attempt_at = None
        self._save(job, changed=True)
        db.commit()

    def _pause_submitting(self, db: Session, job: EvalExperimentJob) -> None:
        self._mark_env_unauthorized(db, job.environment_id)
        self._defer(
            job,
            ENV_PAUSE_RECHECK_SECONDS,
            "Environment unhealthy: API key rejected",
        )

    def _cancel_if_requested(self, db: Session, job: EvalExperimentJob) -> bool:
        if job.cancel_requested_at is None or job.status in TERMINAL_JOB_STATUSES:
            return False
        self._set_status(job, EvalJobStatus.CANCELLED)
        self._save(job, changed=True)
        return True

    async def _find_remote(
        self,
        client: EvalServiceClient,
        user_id: str,
        job_id: str,
        since: datetime,
    ) -> Optional[Dict[str, Any]]:
        """Page ``GET /evals?user_id=`` (newest first) until older than ``since``."""
        offset = 0
        for _ in range(RECONCILE_MAX_PAGES):
            page = await client.list(
                user_id=user_id, limit=RECONCILE_PAGE_SIZE, offset=offset
            )
            items = page.get("items") if isinstance(page, Mapping) else None
            if not items:
                return None
            for item in items:
                if launch_job_id(item) == job_id:
                    return dict(item)
            oldest = _parse_remote_time(items[-1].get("created_at"))
            if oldest is not None and oldest < since:
                return None
            offset += len(items)
            total = page.get("total")
            if isinstance(total, int) and offset >= total:
                return None
        logger.warning("eval job %s: reconcile gave up after %s pages", job_id, offset)
        return None

    # -- poll ------------------------------------------------------------------

    def _step_poll(self, job_id: str) -> None:
        client: Optional[EvalServiceClient] = None
        remote: Optional[Dict[str, Any]] = None
        remote_error: Optional[str] = None  # auth | not_found | retry | paused
        try:
            with self.session_factory() as db:
                job = self._locked_job(db, job_id)
                env = db.get(EvalEnvironment, job.environment_id)
                remote_job_id = job.remote_job_id
                access = self._env_access(db, env) if env is not None else _EnvAccess()
                client = access.client
                db.commit()
            if client is None or not remote_job_id:
                remote_error = "paused"
            else:
                try:
                    remote = self._await(client.get(remote_job_id))
                except EnvAuthError:
                    remote_error = "auth"
                except RemoteNotFound:
                    remote_error = "not_found"
                except EvalServiceError as exc:
                    logger.info(
                        "eval job %s: poll failed: %s", job_id, _redacted_text(exc)
                    )
                    remote_error = "retry"
        finally:
            self._close(client)
        timed_out = self._with_job(
            job_id, lambda db, job: self._apply_poll(db, job, remote, remote_error)
        )
        if timed_out:
            self._time_out(job_id)

    def _apply_poll(
        self,
        db: Session,
        job: EvalExperimentJob,
        remote: Optional[Mapping[str, Any]],
        remote_error: Optional[str],
    ) -> bool:
        """Apply one poll. ``True`` means the job timed out: the caller cancels it
        remotely and then marks it ``TIMED_OUT`` (:meth:`_time_out`), still holding
        the lease."""
        now = self.clock()
        if job.status not in (EvalJobStatus.SUBMITTED, EvalJobStatus.RUNNING):
            self._save(job, changed=False)
            return False
        job.last_polled_at = now
        changed = False
        if remote_error == "auth":
            self._mark_env_unauthorized(db, job.environment_id)
        if remote is not None:
            remote = redact_payload(remote)
            remote_status = str(remote.get("status") or "").upper() or None
            if remote_status and remote_status != job.remote_status:
                job.remote_status = remote_status
                changed = True
            if remote_status == "SUCCEEDED":
                result = remote.get("result")
                job.remote_result = (
                    dict(result) if isinstance(result, Mapping) else None
                )
                job.remote_versioning = redact_payload(extract_versioning(result))
                self._set_status(job, EvalJobStatus.SUCCEEDED)
                self._save(job, changed=True)
                return False
            if remote_status in ("FAILED", "CANCELLED"):
                error = remote.get("error")
                self._set_status(
                    job,
                    EvalJobStatus(remote_status),
                    error=_redacted_text(error) if error else None,
                )
                if remote_status == "CANCELLED" and job.cancel_requested_at:
                    stop_linked_run(db, job, now=now)
                self._save(job, changed=True)
                return False

        run = _linked_run(db, job)
        target = self._merge_run(job, run, now)
        if target is not None:
            status, error = target
            self._set_status(job, status, error=error)
            self._save(job, changed=True)
            return False
        if job.cancel_requested_at is not None:
            # Still live remotely although a cancel was requested (e.g. a concurrent
            # write undid the move to CANCELLING): cancel it on the next tick.
            self._set_status(
                job, EvalJobStatus.CANCELLING, wait_reason=CANCELLING_WAIT_REASON
            )
            job.next_attempt_at = now
            self._save(job, changed=True)
            return False
        if remote_error == "not_found":
            self._set_status(
                job,
                EvalJobStatus.FAILED,
                error="The evaluation service no longer knows this job",
            )
            self._save(job, changed=True)
            return False

        running = job.remote_status == "RUNNING" or (
            run is not None and run.status != RunWorkflowStatus.PENDING
        )
        wait_reason: Optional[str]
        if running:
            new_status = EvalJobStatus.RUNNING
            wait_reason = None
            if run is not None and run.status in RUN_FINISHED_STATUSES:
                wait_reason = "Run completed; waiting for the service result"
        else:
            new_status = EvalJobStatus.SUBMITTED
            wait_reason = "Queued on the evaluation service"
        if remote_error in ("auth", "paused"):
            wait_reason = "Environment unhealthy; status may be stale"
        elif remote_error == "retry":
            wait_reason = "Evaluation service unreachable; retrying"
        if new_status != job.status:
            job.status = new_status
            changed = True
        job.wait_reason = wait_reason

        last_change = max(
            t
            for t in (
                None if changed else job.updated_at,
                job.submitted_at,
                run.last_event_at if run is not None else None,
                run.started_at if run is not None else None,
                now if changed else None,
            )
            if t is not None
        )
        # The timeout is the D2 fallback for a job stuck RUNNING. A job still PENDING
        # in the service's queue is waiting, not stuck, and still holds a remote slot.
        # Only time out on what we could observe: an unreachable or paused service
        # says nothing about the job.
        observed = remote is not None or run is not None
        stuck = observed and job.status == EvalJobStatus.RUNNING
        if stuck and now - last_change >= self.job_timeout:
            # Keep the lease and the status: the remote cancel runs outside this
            # transaction, then ``_apply_timeout`` settles the job. A crash in
            # between leaves it RUNNING, so the next poll times it out again.
            flag_modified(job, "updated_at")  # keep the value; suppress onupdate
            return True

        elapsed = (now - (job.submitted_at or now)).total_seconds()
        job.next_attempt_at = now + timedelta(seconds=poll_interval(elapsed))
        self._save(job, changed=changed)
        return False

    # -- remote cancel ---------------------------------------------------------

    def _step_cancel(self, job_id: str) -> None:
        """``POST /evals/{id}/cancel`` for a ``CANCELLING`` job (plan §13.1)."""
        client: Optional[EvalServiceClient] = None
        kind = "retry"  # cancelled | not_found | terminal | auth | retry | paused
        message: Optional[str] = None
        try:
            with self.session_factory() as db:
                job = self._locked_job(db, job_id)
                experiment = db.get(EvalExperiment, job.experiment_id)
                env = db.get(EvalEnvironment, job.environment_id)
                remote_job_id = job.remote_job_id
                if not remote_job_id or env is None:
                    # Nothing to cancel remotely (never accepted, or the environment
                    # is gone): settle locally.
                    note = "Environment no longer exists" if remote_job_id else None
                    self._apply_cancel(db, job, "cancelled", note)
                    recompute_experiment_status(db, job.experiment_id, now=self.clock())
                    db.commit()
                    return
                user_id = job.cancelled_by_user_id or (
                    _service_user_id(experiment)
                    if experiment is not None
                    else f"qym-experiment-{job.experiment_id}"
                )
                access = self._env_access(db, env)
                client = access.client
                message = access.paused_reason
                db.commit()
            if client is None:
                kind = "paused"
            else:
                kind, error = self._remote_cancel(
                    client, job_id, remote_job_id, user_id
                )
                message = error or message
        finally:
            self._close(client)
        self._with_job(
            job_id, lambda db, job: self._apply_cancel(db, job, kind, message)
        )

    def _remote_cancel(
        self,
        client: EvalServiceClient,
        job_id: str,
        remote_job_id: str,
        user_id: str,
    ) -> Tuple[str, Optional[str]]:
        """``POST /evals/{id}/cancel``; never raises.

        Returns ``(kind, message)`` with kind ``cancelled``, ``not_found``,
        ``terminal`` (409, already finished), ``auth`` or ``retry`` (transport error,
        5xx, anything unexpected; ``message`` says what and is not yet redacted).
        """
        try:
            self._await(client.cancel(remote_job_id, user_id))
        except RemoteNotFound:
            return "not_found", None
        except RemoteConflict:  # NotCancellable: already terminal remotely
            return "terminal", None
        except EnvAuthError:
            return "auth", None
        except EvalServiceError as exc:
            return "retry", str(exc)
        except Exception as exc:  # noqa: BLE001 - retry; never crash the loop
            logger.warning(
                "eval job %s: cancel failed unexpectedly: %s",
                job_id,
                type(exc).__name__,
            )
            return "retry", type(exc).__name__
        return "cancelled", None

    # -- settle sweep ----------------------------------------------------------

    def _maybe_settle(self) -> None:
        now = self.clock()
        if self._next_settle_at is not None and now < self._next_settle_at:
            return
        self._next_settle_at = now + timedelta(seconds=SETTLE_SWEEP_SECONDS)
        try:
            self.settle_sweep()
        except Exception:  # noqa: BLE001
            logger.exception("eval dispatcher: settle sweep failed")

    def settle_sweep(self) -> int:
        """Close out finished experiments once ``KEY_REVOKE_GRACE`` has passed.

        For each experiment that still holds its creator's key: the run of every
        ``SUCCEEDED`` job finished ``KEY_REVOKE_GRACE`` ago that never got its final
        event is closed out (:meth:`_close_out_run`), then the experiment status is
        recomputed, which revokes the key once every job is terminal and past the
        grace. Returns the number of runs closed out.
        """
        now = self.clock()
        with self.session_factory() as db:
            ids = [
                row[0]
                for row in db.execute(
                    select(EvalExperiment.id)
                    .where(EvalExperiment.qym_api_key_encrypted.is_not(None))
                    .order_by(EvalExperiment.updated_at)
                    .limit(SETTLE_SWEEP_BATCH)
                )
            ]
        closed = 0
        for experiment_id in ids:
            try:
                with self.session_factory() as db:
                    jobs = current_jobs(
                        db.query(EvalExperimentJob)
                        .filter(EvalExperimentJob.experiment_id == experiment_id)
                        .all()
                    )
                    closed_here = 0
                    for job in jobs:
                        if (
                            job.status == EvalJobStatus.SUCCEEDED
                            and job.finished_at is not None
                            and now - job.finished_at >= KEY_REVOKE_GRACE
                            and self._close_out_run(db, job, now)
                        ):
                            closed_here += 1
                    # Leave live experiments to the job steps: only recompute (and so
                    # revoke) once everything finished past the grace, or a run changed.
                    revocable = bool(jobs) and all(
                        job.status in TERMINAL_JOB_STATUSES for job in jobs
                    ) and settled_long_enough(jobs, now=now)
                    if closed_here or revocable:
                        recompute_experiment_status(db, experiment_id, now=now)
                        db.commit()
                    else:
                        db.rollback()
                    closed += closed_here
            except OperationalError:
                logger.info(
                    "eval experiment %s: settle sweep lost a lock race", experiment_id
                )
        return closed

    def _close_out_run(self, db: Session, job: EvalExperimentJob, now: datetime) -> bool:
        """Finish the linked run of a ``SUCCEEDED`` job that never sent ``run_completed``.

        The service finished the job but the run is still ``RUNNING`` (or a
        lease-timeout ``STOPPED``): its final events were lost, e.g. rejected after
        the key was revoked or dropped when the worker exited. If every item arrived
        the run is ``COMPLETED``; otherwise it is ``STOPPED`` / ``upload_incomplete``.
        Both stay open to a late ``run_completed`` (``run_lifecycle``).
        """
        run = _linked_run(db, job)
        if run is None:
            return False
        open_run = run.status in (
            RunWorkflowStatus.PENDING,
            RunWorkflowStatus.RUNNING,
        ) or (
            run.status == RunWorkflowStatus.STOPPED
            and run.status_reason == RUN_STATUS_REASON_LEASE_TIMEOUT
        )
        if not open_run:
            return False
        run = (
            db.query(Run)
            .filter(Run.id == run.id)
            .with_for_update()
            .populate_existing()
            .one()
        )
        metadata = run.run_metadata if isinstance(run.run_metadata, dict) else {}
        try:
            expected = int(metadata.get("total_items"))
        except (TypeError, ValueError):
            expected = None
        received = (
            db.query(func.count(RunItem.id)).filter(RunItem.run_id == run.id).scalar()
            or 0
        )
        ended_at = run.last_event_at or now
        if expected is not None and received >= expected:
            mark_run_terminal(run, RunWorkflowStatus.COMPLETED, ended_at=ended_at)
            db.flush()
            sync_run_scores(db, run)
            logger.info(
                "run %s: job %s succeeded without run_completed; all %d items "
                "arrived, marked COMPLETED",
                run.id,
                job.id,
                received,
            )
        else:
            run.status = RunWorkflowStatus.STOPPED
            run.status_reason = RUN_STATUS_REASON_UPLOAD_INCOMPLETE
            run.ended_at = ended_at
            logger.warning(
                "run %s: job %s succeeded but the run is missing events "
                "(%d of %s items); marked STOPPED/upload_incomplete",
                run.id,
                job.id,
                received,
                expected if expected is not None else "?",
            )
        return True

    # -- timeout ---------------------------------------------------------------

    def _time_out(self, job_id: str) -> None:
        """Best-effort remote cancel of a timed-out job, then ``TIMED_OUT``.

        The service may still run the job (D2: it doesn't always report ``FAILED``),
        and once the job is terminal locally the queue cancel no longer reaches it.
        Whatever the cancel answers, the job becomes ``TIMED_OUT`` and the outcome is
        appended to its ``error``. If the cancel failed, the remote job shows as
        *stale* in the Queue page's remote queue, where a manager can cancel it.
        """
        client: Optional[EvalServiceClient] = None
        kind = "none"  # none | paused | cancelled | not_found | terminal | auth | retry
        message: Optional[str] = None
        user_id = ""
        try:
            with self.session_factory() as db:
                job = self._locked_job(db, job_id)
                experiment = db.get(EvalExperiment, job.experiment_id)
                env = db.get(EvalEnvironment, job.environment_id)
                remote_job_id = job.remote_job_id
                if remote_job_id and env is not None:
                    user_id = (
                        _service_user_id(experiment)
                        if experiment is not None
                        else f"qym-experiment-{job.experiment_id}"
                    )
                    access = self._env_access(db, env)
                    client = access.client
                    if client is None:
                        kind, message = "paused", access.paused_reason
                db.commit()
            if client is not None and remote_job_id:
                kind, message = self._remote_cancel(
                    client, job_id, remote_job_id, user_id
                )
        finally:
            self._close(client)
        if kind not in ("none", "cancelled", "not_found", "terminal"):
            logger.warning(
                "eval job %s: remote cancel after timeout failed (%s): %s",
                job_id,
                kind,
                _redacted_text(message) if message else "-",
            )
        self._with_job(
            job_id, lambda db, job: self._apply_timeout(db, job, kind, message)
        )

    def _apply_timeout(
        self,
        db: Session,
        job: EvalExperimentJob,
        kind: str,
        message: Optional[str],
    ) -> None:
        if job.status not in (EvalJobStatus.SUBMITTED, EvalJobStatus.RUNNING):
            self._save(job, changed=False)  # e.g. cancelled from the queue meanwhile
            return
        if kind == "cancelled":
            note = "cancelled on the evaluation service"
            job.remote_status = "CANCELLED"
        elif kind == "not_found":
            note = "unknown to the evaluation service"
        elif kind == "terminal":
            note = "already finished on the evaluation service"
        elif kind == "none":
            note = "not cancelled: no remote job or environment"
        elif kind == "auth":
            self._mark_env_unauthorized(db, job.environment_id)
            note = "not cancelled: the environment API key was rejected"
        elif kind == "paused":
            note = f"not cancelled: {message or 'environment unhealthy'}"
        else:
            note = "not cancelled: the evaluation service could not be reached"
            if message:
                note += f" ({message})"
        self._set_status(
            job,
            EvalJobStatus.TIMED_OUT,
            error=f"{timeout_error(self.job_timeout)}. Remote job {note}",
        )
        self._save(job, changed=True)

    def _apply_cancel(
        self,
        db: Session,
        job: EvalExperimentJob,
        kind: str,
        message: Optional[str],
    ) -> None:
        if job.status != EvalJobStatus.CANCELLING:
            self._save(job, changed=False)
            return
        now = self.clock()
        if kind in ("cancelled", "not_found"):
            error = message
            if kind == "not_found":
                error = "The evaluation service no longer knows this job"
            elif job.remote_job_id:
                job.remote_status = "CANCELLED"
            self._set_status(job, EvalJobStatus.CANCELLED, error=error)
            stop_linked_run(db, job, now=now)
            self._save(job, changed=True)
        elif kind == "terminal":
            # Already finished remotely: poll it right away to record the outcome.
            self._set_status(
                job,
                EvalJobStatus.RUNNING,
                wait_reason="Already finished on the evaluation service; "
                "checking its final status",
            )
            job.next_attempt_at = now
            self._save(job, changed=True)
        elif now - (job.cancel_requested_at or now) >= self.job_timeout:
            # Past the service's hard limit the remote job has ended either way.
            if kind == "auth":
                self._mark_env_unauthorized(db, job.environment_id)
            self._set_status(
                job,
                EvalJobStatus.CANCELLED,
                error="The evaluation service could not be reached to cancel; "
                f"gave up after {format_duration(self.job_timeout)}",
            )
            stop_linked_run(db, job, now=now)
            self._save(job, changed=True)
        elif kind == "auth":
            self._mark_env_unauthorized(db, job.environment_id)
            self._defer(
                job,
                ENV_PAUSE_RECHECK_SECONDS,
                "Cancelling; environment unhealthy: API key rejected",
            )
        elif kind == "paused":
            self._defer(
                job,
                ENV_PAUSE_RECHECK_SECONDS,
                f"Cancelling; {message or 'environment unhealthy'}",
            )
        else:
            requested = job.cancel_requested_at or now
            elapsed = (now - requested).total_seconds()
            job.error = _redacted_text(message) if message else None
            self._defer(
                job,
                min(RETRY_BACKOFF_MAX, max(RETRY_BACKOFF_MIN, elapsed)),
                "Cancelling; evaluation service unreachable, retrying",
            )

    def _merge_run(
        self, job: EvalExperimentJob, run: Optional[Run], now: datetime
    ) -> Optional[Tuple[EvalJobStatus, Optional[str]]]:
        """A terminal linked run wins over a remote PENDING/RUNNING (D2)."""
        if run is None or not _is_run_terminal(run):
            return None
        if run.status == RunWorkflowStatus.FAILED:
            return EvalJobStatus.FAILED, "The linked run failed"
        if run.status == RunWorkflowStatus.STOPPED:
            if (
                job.cancel_requested_at is not None
                or run.status_reason == RUN_STATUS_REASON_ADMIN_FORCE_STOP
                or run.status_reason in RUN_STATUS_REASONS_CANCELLED
            ):
                return EvalJobStatus.CANCELLED, "The linked run was stopped"
            return EvalJobStatus.FAILED, "The linked run stopped before completing"
        # COMPLETED: give the service a moment to publish ``result``.
        ended = run.ended_at or run.last_event_at or now
        if now - ended < RESULT_GRACE:
            return None
        return EvalJobStatus.SUCCEEDED, None


# ------------------------------------------------------------------ module helpers


def _rowcount(result: Any) -> int:
    """Rows matched by a compare-and-set ``UPDATE``."""
    return int(getattr(result, "rowcount", 0) or 0)


def _is_postgres(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _service_user_id(experiment: EvalExperiment) -> str:
    """The ``user_id`` the service records: the experiment creator's qym user id."""
    return experiment.created_by_user_id or f"qym-experiment-{experiment.id}"


def _linked_run(db: Session, job: EvalExperimentJob) -> Optional[Run]:
    if job.run_id:
        return db.get(Run, job.run_id)
    return db.execute(
        select(Run).where(Run.experiment_job_id == job.id).limit(1)
    ).scalar_one_or_none()


__all__: Sequence[str] = (
    "EvalDispatcher",
    "aggregate_status",
    "extract_versioning",
    "high_backoff",
    "is_stale_remote",
    "launch_job_id",
    "poll_interval",
    "recompute_experiment_status",
    "stale_remote_job_ids",
)
