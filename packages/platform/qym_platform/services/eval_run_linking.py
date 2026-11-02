"""Official-run link protocol at ingest (plan §11).

A run is *official* only when ingest verifies the one-time launch token the dispatcher
put in ``run_metadata.qym_launch.token``:

1. ``qym_launch.job_id`` names an existing ``EvalExperimentJob``;
2. ``sha256(token) == job.launch_token_hash`` (constant time);
3. ``job.run_id IS NULL AND job.run_linked_at IS NULL`` (one-time use), claimed with
   a guarded ``UPDATE … WHERE run_id IS NULL AND run_linked_at IS NULL`` so two
   concurrent ingests can't both link. ``run_linked_at`` is never cleared: ``run_id``
   is ``ON DELETE SET NULL``, and a hard-deleted run must not reopen the job;
4. the run's project is the experiment's project. A mismatch with a *valid* token
   means the run was not uploaded with the ``qym_api_key`` the dispatcher sent (that
   key is bound to the experiment's project): the environment's worker ingests with
   some other key, e.g. its own ingest key of another project. The environment gets
   ``health_error = "runs arriving in project X"``.

On success the run gets ``origin = official``, ``experiment_job_id`` and
``owner_user_id = experiment.created_by_user_id``; ``created_by_user_id`` stays the
ingest principal for audit. The experiment's ``versioning_details`` are merged into
the run's. Which side wins a key both set depends on whether the job sent them to the
service (B23): when ``evaluator.config.versioning_details`` was in the job's request
(guide v1.1), the service already merged them over its own ``agent_version`` /
``image_version`` / ``kb_version`` (``kb_version`` always being the KB it served), so
**the run's** value wins and the experiment's keys only fill gaps. Otherwise (an older
service) the experiment's value wins, as before. Anything else leaves the run ``local``.

Re-runs. The Evaluation Service can run one job twice with the same token (Celery
redelivers a task whose worker was lost or killed by the task time limit, Beat
re-enqueues a ``PENDING`` job, someone re-runs it by hand). Step 3 then sees the job
already linked. If the first run is **dead** (``FAILED``; ``STOPPED`` with a soft
reason, i.e. ``lease_timeout`` / ``upload_incomplete``; soft-deleted; or still
``RUNNING`` but silent for ``QYM_RUN_STALE_TIMEOUT_SECONDS``) the re-run is the
legitimate continuation: it takes the link (``official``, ``experiment_job_id``, the
job's ``run_id``) and the first run is closed as ``STOPPED`` / ``superseded`` (a
hard stop, so late events from the first worker can't reopen it). Both runs record
the hand-over in ``qym_launch`` (``supersedes_run_id`` / ``superseded_by_run_id``).
If the first run is alive or finished (``COMPLETED``, in review, cancelled), the
re-run is a duplicate and stays ``local``, flagged with
``qym_launch.link_outcome = "already_linked"`` and ``linked_run_id``. Every verdict
is recorded as ``qym_launch.link_outcome`` so duplicates can be found in the data.

Ingest principal. The dispatcher sends ``qym_api_key``, the creator's per-experiment
key (``eval_submitter_keys``), so a conforming worker creates the run as the creator:
``created_by_user_id == owner_user_id == creator``. A worker that still uploads with
the environment's own ingest key keeps working: the run links the same way, and
ingest lets its ``created_by_user_id`` stream events to the official run.

The token is **always** stripped from whatever ingest stores (run metadata, event log
payloads) and is never logged. The reserved ``qym_*`` metadata keys are fixed when the
run is created: later ``run_started`` / ``metadata_update`` / ``run_completed`` merges
can't add, change or remove them (so they can't re-add the token either). ``origin`` is
a column that only ``create_run`` sets.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Mapping, Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import ensure_utc, utc_now_naive
from qym_platform.db.models import (
    EvalEnvironment,
    EvalExperiment,
    EvalExperimentJob,
    Project,
    Run,
    RunOrigin,
    RunWorkflowStatus,
)
from qym_platform.services.eval_config import RESERVED_METADATA_PREFIX
from qym_platform.services.eval_experiments import verify_launch_token
from qym_platform.services.run_lifecycle import (
    RUN_STATUS_REASON_SUPERSEDED,
    SOFT_STOP_REASONS,
)
from qym_platform.services.run_versioning import merge_versioning_details
from qym_platform.settings import PlatformSettings
from qym_platform.log import get_logger

logger = get_logger(__name__)

LAUNCH_KEY = "qym_launch"
TOKEN_KEY = "token"
_MAX_DEPTH = 32


def strip_launch_token(value: Any, _depth: int = 0) -> Any:
    """A copy of ``value`` with ``token`` removed from every ``qym_launch`` mapping.

    Walks nested dicts and lists, so the token can't survive in a copied or nested
    metadata block (e.g. ``summary.run_metadata.qym_launch``).
    """
    if _depth > _MAX_DEPTH:
        return value
    if isinstance(value, Mapping):
        out: dict[Any, Any] = {}
        for key, item in value.items():
            if key == LAUNCH_KEY and isinstance(item, Mapping):
                out[key] = {
                    k: strip_launch_token(v, _depth + 1)
                    for k, v in item.items()
                    if k != TOKEN_KEY
                }
            else:
                out[key] = strip_launch_token(item, _depth + 1)
        return out
    if isinstance(value, list):
        return [strip_launch_token(item, _depth + 1) for item in value]
    return value


def _is_reserved(key: Any) -> bool:
    return isinstance(key, str) and key.startswith(RESERVED_METADATA_PREFIX)


def merge_run_metadata(
    current: Any, updates: Any, *, replace: bool = False
) -> dict[str, Any]:
    """Merge client ``updates`` into stored run metadata without touching ``qym_*``.

    ``replace=True`` is the ``run_started`` semantics (the client's metadata replaces
    the stored one), except that the stored reserved keys always survive. Reserved
    keys in ``updates`` are ignored, and the result never contains a launch token.
    """
    stored = dict(current) if isinstance(current, Mapping) else {}
    incoming = updates if isinstance(updates, Mapping) else {}
    base = (
        {k: v for k, v in stored.items() if _is_reserved(k)} if replace else stored
    )
    merged = dict(base)
    for key, value in incoming.items():
        if _is_reserved(key):
            continue
        merged[key] = value
    return strip_launch_token(merged)


def _short(value: Any, limit: int = 80) -> str:
    text = str(value)
    return text if len(text) <= limit else text[:limit] + "…"


LINK_OUTCOME_KEY = "link_outcome"


def _note_launch(run: Run, **fields: Any) -> None:
    """Record ``fields`` under the run's stored ``qym_launch`` (never the token).

    Reserved keys are fixed at creation, so this is the one place they are written;
    later client merges can't change or remove them (``merge_run_metadata``).
    """
    metadata = dict(run.run_metadata) if isinstance(run.run_metadata, Mapping) else {}
    launch = metadata.get(LAUNCH_KEY)
    launch = dict(launch) if isinstance(launch, Mapping) else {}
    launch.pop(TOKEN_KEY, None)
    launch.update(fields)
    metadata[LAUNCH_KEY] = launch
    run.run_metadata = metadata  # reassigned: JSON columns don't track mutation


def _naive(value: Optional[datetime]) -> Optional[datetime]:
    normalized = ensure_utc(value)
    return normalized.replace(tzinfo=None) if normalized is not None else None


def _stale_after() -> timedelta:
    try:
        seconds = PlatformSettings().run_stale_timeout_seconds
    except Exception:  # noqa: BLE001 - settings unavailable: keep the default
        seconds = 180
    return timedelta(seconds=max(1, int(seconds)))


def is_dead_linked_run(
    run: Run, *, now: Optional[datetime] = None, stale_after: Optional[timedelta] = None
) -> bool:
    """Whether a linked run can't finish on its own, so a re-run may replace it.

    Dead: soft-deleted, ``FAILED``, ``STOPPED`` for a platform-inferred reason
    (``lease_timeout`` / ``upload_incomplete``), or ``RUNNING`` / ``PENDING`` with no
    event for ``stale_after`` (``QYM_RUN_STALE_TIMEOUT_SECONDS``). Not dead:
    ``COMPLETED``, in review, user-cancelled, or still streaming.
    """
    if run.deleted_at is not None:
        return True
    if run.status == RunWorkflowStatus.FAILED:
        return True
    if run.status == RunWorkflowStatus.STOPPED:
        return run.status_reason in SOFT_STOP_REASONS
    if run.status in (RunWorkflowStatus.RUNNING, RunWorkflowStatus.PENDING):
        last_seen = _naive(run.last_event_at or run.started_at or run.created_at)
        if last_seen is None:
            return False
        current = _naive(now) or utc_now_naive()
        return current - last_seen >= (stale_after or _stale_after())
    return False


def _retire_superseded_run(previous: Run, run: Run, now: datetime) -> None:
    """Close the dead first attempt ``previous`` in favour of ``run``."""
    if previous.status in (RunWorkflowStatus.RUNNING, RunWorkflowStatus.PENDING) or (
        previous.status == RunWorkflowStatus.STOPPED
        and previous.status_reason in SOFT_STOP_REASONS
    ):
        previous.status = RunWorkflowStatus.STOPPED
        previous.status_reason = RUN_STATUS_REASON_SUPERSEDED
        previous.ended_at = _naive(previous.last_event_at) or now
    _note_launch(previous, superseded_by_run_id=run.id)


def link_official_run(
    db: Session, run: Run, raw_metadata: Mapping[str, Any]
) -> bool:
    """Apply the §11 link protocol to a new, flushed ``run`` inside the caller's tx.

    ``raw_metadata`` is the metadata as received (the only place the token is read).
    Returns ``True`` when the run is now official. The caller commits; the job's
    ``run_id`` claim and the run's ``origin`` are then written atomically.
    """
    launch = raw_metadata.get(LAUNCH_KEY) if isinstance(raw_metadata, Mapping) else None
    if not isinstance(launch, Mapping):
        return False
    job_id = launch.get("job_id")
    token = launch.get(TOKEN_KEY)
    if not isinstance(job_id, str) or not job_id:
        logger.warning("run %s: qym_launch without a job_id; stored as local", run.id)
        _note_launch(run, link_outcome="missing_job_id")
        return False
    job = db.get(EvalExperimentJob, job_id)
    if job is None:
        logger.warning(
            "run %s: qym_launch names unknown job %s; stored as local",
            run.id,
            _short(job_id),
        )
        _note_launch(run, link_outcome="unknown_job")
        return False
    if not verify_launch_token(token, job.launch_token_hash):
        logger.warning(
            "run %s: launch token for job %s did not verify; stored as local",
            run.id,
            job.id,
        )
        _note_launch(run, link_outcome="token_mismatch")
        return False
    now = utc_now_naive()
    previous: Optional[Run] = None
    if job.run_id is not None or job.run_linked_at is not None:
        # A re-run of the job (same token). Only a dead first run can be replaced.
        linked = db.get(Run, job.run_id) if job.run_id else None
        if linked is None or not is_dead_linked_run(linked, now=now):
            logger.warning(
                "run %s: job %s is already linked to run %s (%s); the re-run is "
                "stored as a local duplicate",
                run.id,
                job.id,
                job.run_id or "a since-deleted run",
                _enum_value(linked.status) if linked is not None else "-",
            )
            _note_launch(
                run, link_outcome="already_linked", linked_run_id=job.run_id
            )
            return False
        previous = linked
    experiment = db.get(EvalExperiment, job.experiment_id)
    if experiment is None:
        _note_launch(run, link_outcome="unknown_experiment")
        return False
    if run.project_id != experiment.project_id:
        # Only a verified token gets here, so a stranger can't flag an environment.
        project = db.get(Project, run.project_id)
        label = (project.slug or project.name) if project else run.project_id
        env = db.get(EvalEnvironment, job.environment_id)
        if env is not None:
            env.health_error = f"runs arriving in project {label}"
        logger.warning(
            "run %s: job %s belongs to another project; run arrived in project %s "
            "and is stored as local",
            run.id,
            job.id,
            label,
        )
        _note_launch(run, link_outcome="wrong_project")
        return False
    # One-time claim: exactly one run can take the job, even under concurrency. A
    # re-run claims it from the dead run it replaces (the guard pins that run id).
    claim = update(EvalExperimentJob).where(
        EvalExperimentJob.id == job.id,
        EvalExperimentJob.launch_token_hash == job.launch_token_hash,
    )
    if previous is None:
        claim = claim.where(
            EvalExperimentJob.run_id.is_(None),
            EvalExperimentJob.run_linked_at.is_(None),
        )
    else:
        claim = claim.where(EvalExperimentJob.run_id == previous.id)
    claimed = db.execute(
        claim.values(run_id=run.id, run_linked_at=now).execution_options(
            synchronize_session=False
        )
    )
    if int(getattr(claimed, "rowcount", 0) or 0) != 1:
        logger.warning(
            "run %s: job %s was linked concurrently; stored as local", run.id, job.id
        )
        db.expire(job, ["run_id", "run_linked_at"])
        _note_launch(run, link_outcome="already_linked", linked_run_id=job.run_id)
        return False
    db.expire(job, ["run_id", "run_linked_at"])
    run.origin = RunOrigin.OFFICIAL
    run.experiment_job_id = job.id
    if previous is not None:
        _retire_superseded_run(previous, run, now)
        _note_launch(run, link_outcome="linked", supersedes_run_id=previous.id)
        logger.warning(
            "run %s: job %s re-ran; replaced its dead run %s (%s/%s) as the "
            "official run",
            run.id,
            job.id,
            previous.id,
            _enum_value(previous.status),
            previous.status_reason or "-",
        )
    else:
        _note_launch(run, link_outcome="linked")
    if experiment.versioning_details:
        if sent_versioning_details(job):
            # The service merged them already and owns kb_version: the run wins.
            run.versioning_details = merge_versioning_details(
                experiment.versioning_details, run.versioning_details
            )
        else:
            # The experiment's keys win: they are what the launch form recorded.
            run.versioning_details = merge_versioning_details(
                run.versioning_details, experiment.versioning_details
            )
    if experiment.created_by_user_id:
        run.owner_user_id = experiment.created_by_user_id
    return True


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def sent_versioning_details(job: EvalExperimentJob) -> bool:
    """Whether the job's request carried ``evaluator.config.versioning_details``."""
    body = job.request_body if isinstance(job.request_body, Mapping) else {}
    evaluator = body.get("evaluator")
    config = evaluator.get("config") if isinstance(evaluator, Mapping) else None
    return isinstance(config, Mapping) and isinstance(
        config.get("versioning_details"), Mapping
    )


__all__ = [
    "LAUNCH_KEY",
    "LINK_OUTCOME_KEY",
    "is_dead_linked_run",
    "link_official_run",
    "merge_run_metadata",
    "sent_versioning_details",
    "strip_launch_token",
]
