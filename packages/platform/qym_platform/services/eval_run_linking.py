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

from typing import Any, Mapping, Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (
    EvalEnvironment,
    EvalExperiment,
    EvalExperimentJob,
    Project,
    Run,
    RunOrigin,
)
from qym_platform.services.eval_config import RESERVED_METADATA_PREFIX
from qym_platform.services.eval_experiments import verify_launch_token
from qym_platform.services.run_versioning import merge_versioning_details
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
        return False
    job = db.get(EvalExperimentJob, job_id)
    if job is None:
        logger.warning(
            "run %s: qym_launch names unknown job %s; stored as local",
            run.id,
            _short(job_id),
        )
        return False
    if not verify_launch_token(token, job.launch_token_hash):
        logger.warning(
            "run %s: launch token for job %s did not verify; stored as local",
            run.id,
            job.id,
        )
        return False
    if job.run_id is not None or job.run_linked_at is not None:
        logger.warning(
            "run %s: job %s was already linked (to run %s; replayed token); "
            "stored as local",
            run.id,
            job.id,
            job.run_id or "since deleted",
        )
        return False
    experiment = db.get(EvalExperiment, job.experiment_id)
    if experiment is None:
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
        return False
    # One-time claim: exactly one run can take the job, even under concurrency.
    claimed = db.execute(
        update(EvalExperimentJob)
        .where(
            EvalExperimentJob.id == job.id,
            EvalExperimentJob.run_id.is_(None),
            EvalExperimentJob.run_linked_at.is_(None),
            EvalExperimentJob.launch_token_hash == job.launch_token_hash,
        )
        .values(run_id=run.id, run_linked_at=utc_now_naive())
        .execution_options(synchronize_session=False)
    )
    if int(getattr(claimed, "rowcount", 0) or 0) != 1:
        logger.warning(
            "run %s: job %s was linked concurrently; stored as local", run.id, job.id
        )
        db.expire(job, ["run_id", "run_linked_at"])
        return False
    db.expire(job, ["run_id", "run_linked_at"])
    run.origin = RunOrigin.OFFICIAL
    run.experiment_job_id = job.id
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
    "link_official_run",
    "merge_run_metadata",
    "sent_versioning_details",
    "strip_launch_token",
]
