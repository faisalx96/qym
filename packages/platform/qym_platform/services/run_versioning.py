"""Filterable run versioning: the Evaluation Service's ``versioning_metadata``.

A run dispatched by an experiment job carries the job's versioning
(``eval_best_run.job_versioning``: ``remote_versioning``, else the job's result
with the legacy flat-key fallback). Nothing here knows the key names: any key
the service reports (``agent_version``, ``kb_version`` or a future one) is
shown and filterable.

Values are normalized to strings (:func:`normalize_versioning`) and stored one
row per run and key in ``dashboard_run_versions``. The dashboard projection
worker maintains those rows with the run's dimension (:func:`sync_run_versions`),
and the run's descriptor carries the same mapping as ``versioning``. A job whose
versioning changes requeues its run (``dashboard_outbox``).

Filters are ``{key: [values]}``: values of one key are alternatives (OR) and
keys must all match (AND). ``__empty__`` matches runs without the key and
``__none__`` matches nothing, like the other dashboard facets.

``versioning_details`` is different: a free-form JSON object the run's creator
supplies (``EvaluatorConfig.versioning_details``, ``--versioning-detail``) and
an experiment adds to the runs it launches. It is stored as-is on the run (and
the experiment) and shown, not filtered: :func:`normalize_versioning_details`
only bounds and validates it.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from sqlalchemy import exists, false, or_, select
from sqlalchemy.orm import Session

from qym_platform.db.dashboard_models import DashboardRunVersion as RunVersion

EMPTY = "__empty__"
NONE = "__none__"
MAX_KEYS = 32
MAX_KEY_LENGTH = 100
MAX_VALUE_LENGTH = 500
# Bounds on a filter request (the dashboard filter JSON or ``key=value`` params).
MAX_FILTER_KEYS = 32
MAX_FILTER_VALUES = 1000


def normalize_versioning(raw: Any) -> Dict[str, str]:
    """``{key: value}`` with string values, ready to store and compare.

    ``None`` and blank values are dropped, so the run counts as missing the key.
    Booleans become ``true``/``false`` and nested values compact JSON. Keys or
    values longer than the column are dropped rather than truncated, since a
    truncated value would match a different version. At most ``MAX_KEYS`` keys,
    taken in sorted order so the result is deterministic.
    """
    if not isinstance(raw, Mapping):
        return {}
    result: Dict[str, str] = {}
    for key in sorted(raw, key=str):
        if len(result) >= MAX_KEYS:
            break
        name = str(key).strip()
        value = raw[key]
        if not name or len(name) > MAX_KEY_LENGTH or value is None:
            continue
        if isinstance(value, bool):
            text = "true" if value else "false"
        elif isinstance(value, (str, int, float)):
            text = str(value).strip()
        else:
            text = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
        if text and len(text) <= MAX_VALUE_LENGTH:
            result[name] = text
    return result


MAX_DETAIL_KEYS = 50
MAX_DETAILS_CHARS = 16_000


def normalize_versioning_details(raw: Any) -> Dict[str, Any]:
    """A validated copy of a ``versioning_details`` object. Raises ``ValueError``.

    ``None`` is ``{}``. Keys are trimmed, non-blank strings of at most
    ``MAX_KEY_LENGTH`` characters; ``None`` values are dropped. Values may be any
    JSON (other values become strings). At most ``MAX_DETAIL_KEYS`` keys and
    ``MAX_DETAILS_CHARS`` characters of compact JSON.
    """
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise ValueError("versioning_details must be a JSON object")
    result: Dict[str, Any] = {}
    for key, value in raw.items():
        name = key.strip() if isinstance(key, str) else ""
        if not name or len(name) > MAX_KEY_LENGTH:
            raise ValueError(
                "versioning_details keys must be non-blank strings of at most "
                f"{MAX_KEY_LENGTH} characters"
            )
        if value is not None:
            result[name] = value
    if len(result) > MAX_DETAIL_KEYS:
        raise ValueError(f"versioning_details has more than {MAX_DETAIL_KEYS} keys")
    try:
        text = json.dumps(result, separators=(",", ":"), default=str, allow_nan=False)
    except ValueError:
        raise ValueError("versioning_details must be valid JSON (no NaN)") from None
    if len(text) > MAX_DETAILS_CHARS:
        raise ValueError(
            f"versioning_details is larger than {MAX_DETAILS_CHARS} characters of JSON"
        )
    return json.loads(text)


def merge_versioning_details(*layers: Any) -> Dict[str, Any]:
    """Stored ``versioning_details`` objects merged; later layers win per key."""
    merged: Dict[str, Any] = {}
    for layer in layers:
        if isinstance(layer, Mapping):
            merged.update(layer)
    return merged


def resolve_job_versioning(
    db: Session, rows: Iterable[Tuple[str, Any, Optional[str]]]
) -> Dict[str, Dict[str, str]]:
    """``{job_id: versioning}`` from ``(job_id, remote_versioning, remote_status)``.

    Jobs that succeeded before ``remote_versioning`` was stored are read from their
    result (``versioning_metadata``, else the legacy flat keys), in one more query
    over only those jobs. Jobs without versioning are left out.
    """
    from qym_platform.db.models import EvalExperimentJob as Job
    from qym_platform.services.eval_dispatcher import extract_versioning
    from qym_platform.services.eval_experiments import redact_secret_refs

    found: Dict[str, Any] = {}
    legacy = []
    for job_id, stored, remote_status in rows:
        if isinstance(stored, Mapping) and stored:
            found[job_id] = stored
        elif str(remote_status or "").upper() == "SUCCEEDED":
            legacy.append(job_id)
    if legacy:
        for job_id, remote_result in db.execute(
            select(Job.id, Job.remote_result).where(Job.id.in_(legacy))
        ):
            found[job_id] = extract_versioning(remote_result)
    result = {}
    for job_id, raw in found.items():
        versioning = normalize_versioning(
            redact_secret_refs(dict(raw)) if isinstance(raw, Mapping) else None
        )
        if versioning:
            result[job_id] = versioning
    return result


def versioning_for_jobs(
    db: Session, job_ids: Iterable[Optional[str]]
) -> Dict[str, Dict[str, str]]:
    """The normalized versioning of each experiment job, in one query."""
    from qym_platform.db.models import EvalExperimentJob as Job

    ids = {job_id for job_id in job_ids if job_id}
    if not ids:
        return {}
    return resolve_job_versioning(
        db,
        db.execute(
            select(Job.id, Job.remote_versioning, Job.remote_status).where(
                Job.id.in_(ids)
            )
        ),
    )


def run_versioning(db: Session, job_id: Optional[str]) -> Dict[str, str]:
    """The normalized versioning of the experiment job a run is linked to."""
    return versioning_for_jobs(db, [job_id]).get(job_id or "", {})


def sync_run_versions(
    db: Session, run_key: str, project_key: str, versioning: Mapping[str, str]
) -> None:
    """Make the run's ``dashboard_run_versions`` rows equal ``versioning``."""
    existing = {
        row.key: row
        for row in db.scalars(select(RunVersion).where(RunVersion.run_key == run_key))
    }
    for key, row in existing.items():
        if key not in versioning:
            db.delete(row)
        elif row.value != versioning[key] or row.project_key != project_key:
            row.value, row.project_key = versioning[key], project_key
    for key, value in versioning.items():
        if key not in existing:
            db.add(
                RunVersion(
                    run_key=run_key, key=key, project_key=project_key, value=value
                )
            )


def parse_versioning_filter(raw: Any) -> Dict[str, List[str]]:
    """Validate a ``{key: [values]}`` filter. Raises ``ValueError``."""
    if raw is None:
        return {}
    if not isinstance(raw, Mapping) or len(raw) > MAX_FILTER_KEYS:
        raise ValueError("Invalid versioning filter")
    parsed: Dict[str, List[str]] = {}
    for key, values in raw.items():
        if (
            not isinstance(key, str)
            or not key.strip()
            or len(key) > MAX_KEY_LENGTH
            or not isinstance(values, list)
            or len(values) > MAX_FILTER_VALUES
            or any(
                not isinstance(value, str) or len(value) > MAX_VALUE_LENGTH
                for value in values
            )
        ):
            raise ValueError("Invalid versioning filter")
        if values:
            parsed[key.strip()] = list(dict.fromkeys(values))
    return parsed


def parse_versioning_params(raw: Optional[Iterable[str]]) -> Dict[str, List[str]]:
    """``["agent_version=v1.12", "kb_version=381"]`` → a versioning filter.

    Repeating a key ORs its values; the value may contain ``=``. Raises
    ``ValueError`` for an entry without ``=`` or an empty key.
    """
    if not raw or isinstance(raw, (str, bytes)) or not isinstance(raw, Iterable):
        # A non-list is an unresolved FastAPI ``Query`` default (direct calls).
        return {}
    grouped: Dict[str, List[str]] = {}
    for entry in raw:
        key, sep, value = str(entry).partition("=")
        if not sep or not key.strip():
            raise ValueError(
                f"Invalid versioning filter {entry!r} (expected key=value)"
            )
        grouped.setdefault(key.strip(), []).append(value.strip())
    return parse_versioning_filter(grouped)


def versioning_conditions(
    run_key_column: Any, filters: Mapping[str, List[str]], *, facets: bool = False
) -> List[Any]:
    """SQL conditions on ``run_key_column`` for a parsed versioning filter.

    Each key is an indexed ``IN`` / ``NOT EXISTS`` over ``dashboard_run_versions``.
    With ``facets=True`` a select-none key is ignored instead of matching
    nothing, as the other dashboard facets do.
    """
    conditions = []
    for key, values in filters.items():
        if not values:
            continue
        if NONE in values:
            if not facets:
                conditions.append(false())
            continue
        ordinary = [value for value in values if value != EMPTY]
        terms = []
        if ordinary:
            terms.append(
                run_key_column.in_(
                    select(RunVersion.run_key).where(
                        RunVersion.key == key, RunVersion.value.in_(ordinary)
                    )
                )
            )
        if EMPTY in values:
            # Correlated on the (run_key, key) primary key: an anti-join that
            # doesn't hash every run reporting the key across all projects.
            terms.append(
                ~exists().where(
                    RunVersion.run_key == run_key_column, RunVersion.key == key
                )
            )
        conditions.append(or_(*terms))
    return conditions


def project_versioning_values(
    db: Session, project_id: str, *, limit: int = 500
) -> Dict[str, List[str]]:
    """``{key: [values]}`` over the project's listed runs, newest value first."""
    from sqlalchemy import func

    from qym_platform.db.dashboard_models import DashboardRunDimension as Dimension

    rows = db.execute(
        select(RunVersion.key, RunVersion.value, func.max(Dimension.timestamp))
        .join(Dimension, Dimension.run_key == RunVersion.run_key)
        .where(
            RunVersion.project_key == project_id,
            Dimension.present.is_(True),
            Dimension.hidden_at.is_(None),
        )
        .group_by(RunVersion.key, RunVersion.value)
    )
    grouped: Dict[str, List[Any]] = {}
    for key, value, at in rows:
        grouped.setdefault(key, []).append((at, value))
    return {
        key: [
            value
            for _, value in sorted(
                entries,
                key=lambda entry: (entry[0] is not None, entry[0], entry[1]),
                reverse=True,
            )[:limit]
        ]
        for key, entries in sorted(grouped.items(), key=lambda item: item[0].casefold())
    }


__all__ = [
    "EMPTY",
    "merge_versioning_details",
    "normalize_versioning_details",
    "normalize_versioning",
    "parse_versioning_filter",
    "parse_versioning_params",
    "project_versioning_values",
    "resolve_job_versioning",
    "run_versioning",
    "sync_run_versions",
    "versioning_conditions",
    "versioning_for_jobs",
]
