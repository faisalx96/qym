from __future__ import annotations

from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import false, select
from sqlalchemy.orm import Query, Session

from qym_platform.auth import Principal
from qym_platform.db.models import (
    Dataset,
    DatasetGrant,
    DatasetVersion,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    UserRole,
)

ARCHIVED_PROJECT_DETAIL = "Project is archived; unarchive it to make changes"
# Lets clients tell this refusal from other 409s (e.g. a run under review).
PROJECT_STATE_HEADER = "X-Qym-Project-State"


def is_project_archived(db: Session, project_id: Optional[str]) -> bool:
    if not project_id:
        return False
    active = db.query(Project.is_active).filter(Project.id == project_id).scalar()
    return active is False


def require_project_writable(db: Session, project_id: Optional[str]) -> None:
    """Refuse a change to an archived project: it is read-only until unarchived.

    Every route that changes a project's data (runs, items, scores, reviews,
    analysis, datasets, settings, members, API keys) calls this after its
    access check, so a non-member still gets 403/404 rather than learning the
    project state. Reads never call it. Exempt on purpose: the admin archive,
    unarchive and delete endpoints, and actions that only take access or work
    away (revoking a key, removing a member, cancelling a running analysis job).
    tests/platform/test_archived_project_read_only.py lists every write route.
    """
    if is_project_archived(db, project_id):
        raise HTTPException(
            status_code=409,
            detail=ARCHIVED_PROJECT_DETAIL,
            headers={PROJECT_STATE_HEADER: "archived"},
        )


def project_for_read_by_slug(db: Session, principal: Principal, project_slug: str) -> Project:
    """The project a UI read names by slug, archived or not.

    An archived project is read-only, not hidden: admins and its members still
    open its pages and read its runs, datasets and settings, while every write
    answers 409 through ``require_project_writable``. Anyone else is refused
    exactly as before: an archived project stays "Project not found" (404) to
    them, an active one "Access denied" (403).
    """
    project = db.query(Project).filter(Project.slug == project_slug).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not has_project_access(db, principal, project.id):
        if not project.is_active:
            raise HTTPException(status_code=404, detail="Project not found")
        raise HTTPException(status_code=403, detail="Access denied")
    return project


def get_project_membership(db: Session, user_id: str, project_id: str) -> ProjectMembership | None:
    return (
        db.query(ProjectMembership)
        .filter(ProjectMembership.user_id == user_id, ProjectMembership.project_id == project_id)
        .first()
    )


def visible_project_ids(db: Session, principal: Principal) -> set[str]:
    if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
        rows = db.query(ProjectMembership.project_id).distinct().all()
        return {row[0] for row in rows}
    rows = db.query(ProjectMembership.project_id).filter(ProjectMembership.user_id == principal.user.id).all()
    return {row[0] for row in rows}


def has_project_access(db: Session, principal: Principal, project_id: str) -> bool:
    if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
        return True
    return get_project_membership(db, principal.user.id, project_id) is not None


def is_project_manager(db: Session, principal: Principal, project_id: str) -> bool:
    if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
        return True
    membership = get_project_membership(db, principal.user.id, project_id)
    return bool(membership and membership.role == ProjectRole.MANAGER)


def can_manage_project_members(db: Session, principal: Principal, project_id: str) -> bool:
    return is_project_manager(db, principal, project_id)


def can_view_run(db: Session, principal: Principal, run: Run) -> bool:
    return has_project_access(db, principal, run.project_id)


def can_modify_run(db: Session, principal: Principal, run: Run) -> bool:
    return has_project_access(db, principal, run.project_id)


def can_review_run(db: Session, principal: Principal, run: Run) -> bool:
    return has_project_access(db, principal, run.project_id)


def can_approve_run(db: Session, principal: Principal, run: Run) -> bool:
    if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
        return True
    return is_project_manager(db, principal, run.project_id)


def can_delete_run(db: Session, principal: Principal, run: Run) -> bool:
    if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
        return True
    # Ownership grants rights only while the owner is still a project member.
    if not has_project_access(db, principal, run.project_id):
        return False
    if run.owner_user_id == principal.user.id:
        return True
    return is_project_manager(db, principal, run.project_id)


def apply_reviewable_run_filter(query: Query, db: Session, principal: Principal) -> Query:
    # Review candidates are editable only while their run is active.  Keep
    # this invariant in the shared filter so soft-deleted runs cannot leak into
    # the queue (where the mutation endpoints correctly reject them). Runs of
    # archived projects are read-only, so they leave the queue as well.
    query = query.filter(Run.deleted_at.is_(None))
    query = query.filter(
        Run.project_id.in_(select(Project.id).where(Project.is_active.is_(True)))
    )
    if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
        return query

    project_ids = visible_project_ids(db, principal)
    if not project_ids:
        return query.filter(false())

    return query.filter(Run.project_id.in_(project_ids))


# --- Private test sets --------------------------------------------------------
#
# A dataset flagged ``private_test_set`` keeps its item contents admin-only:
# dataset items, and the inputs / expected values / outputs / errors / item
# metadata / traces of every run evaluated against it. Members still see the
# dataset, its versions and runs' scores.

PRIVATE_TEST_SET_PLACEHOLDER = "[private test set: visible to admins only]"
# Shown in place of item content when the reader has no access to a restricted dataset.
DATASET_ACCESS_PLACEHOLDER = "Hidden: you don\u2019t have access to this dataset\u2019s items."
PRIVATE_TEST_SET_DETAIL = "This dataset is a private test set; its items are visible to admins only."

# Keys of item-shaped payloads (run rows, dataset items, correction snapshots)
# that carry item content.
_ITEM_CONTENT_KEYS = frozenset(
    {
        "input",
        "input_full",
        "expected",
        "expected_full",
        "expected_output",
        "output",
        "output_full",
        "error",
        "input_snapshot",
        "expected_snapshot",
        "output_snapshot",
        "input_preview",
        "expected_preview",
        "output_preview",
        "__execution_error",
        # Judge explanations routinely quote the input or expected answer.
        "explanation",
        "reasoning",
        "rationale",
    }
)
_ITEM_CONTENT_CLEARED_KEYS = frozenset(
    {
        "metadata",
        "item_metadata",
        "metadata_snapshot",
        "trace_content",
        # OTEL span payloads; span names and timings stay visible.
        "attributes",
        "events",
    }
)


def is_platform_admin(principal: Principal) -> bool:
    return principal.auth_type == "none" or principal.user.role == UserRole.ADMIN


def can_view_dataset_items(principal: Principal, dataset: Dataset | None) -> bool:
    if dataset is None or not bool(getattr(dataset, "private_test_set", False)):
        return True
    return is_platform_admin(principal)


def _runs_on_datasets(db: Session, runs: list[Run], datasets: list[Any]) -> set[str]:
    """Ids of ``runs`` evaluated against one of ``datasets`` (rows with ``id``,
    ``project_id``, ``slug`` and ``name``).

    A run is linked by ``dataset_id``, by ``dataset_version_id``, or (for runs
    uploaded without either) by its dataset name matching a dataset's slug or
    name in the same project.
    """
    if not runs or not datasets:
        return set()
    dataset_ids = {row.id for row in datasets}
    names = {(row.project_id, row.slug) for row in datasets} | {
        (row.project_id, row.name) for row in datasets
    }
    version_ids = {run.dataset_version_id for run in runs if run.dataset_version_id and not run.dataset_id}
    matching_versions: set[str] = set()
    if version_ids:
        matching_versions = {
            row[0]
            for row in db.query(DatasetVersion.id)
            .filter(DatasetVersion.id.in_(version_ids), DatasetVersion.dataset_id.in_(dataset_ids))
            .all()
        }
    out: set[str] = set()
    for run in runs:
        if run.dataset_id:
            if run.dataset_id in dataset_ids:
                out.add(run.id)
        elif run.dataset_version_id:
            if run.dataset_version_id in matching_versions:
                out.add(run.id)
        elif (run.project_id, run.dataset) in names:
            out.add(run.id)
    return out


def private_test_set_run_ids(db: Session, runs: Iterable[Run]) -> set[str]:
    """Ids of ``runs`` evaluated against a private test set."""
    runs = [run for run in runs if run is not None]
    if not runs:
        return set()
    private = (
        db.query(Dataset.id, Dataset.project_id, Dataset.slug, Dataset.name)
        .filter(Dataset.private_test_set.is_(True))
        .all()
    )
    return _runs_on_datasets(db, runs, private)


def run_is_private_test_set(db: Session, run: Run) -> bool:
    return run.id in private_test_set_run_ids(db, [run])


# --- Per-dataset access --------------------------------------------------------
#
# ``datasets.access_mode`` is ``project`` (every member views and modifies, the
# default) or ``restricted`` (only managers, admins, the creator and users with
# a ``DatasetGrant``). ``dataset_access_level`` is the single decision point.

DATASET_ACCESS_DENIED_DETAIL = "You don't have access to this dataset"
DATASET_VIEW_ONLY_DETAIL = "You can view this dataset but not change it"
DATASET_ACCESS_MANAGE_DETAIL = "Only project managers and admins can change dataset access"
DATASET_LEVELS = ("none", "view", "modify", "manage")
_LEVEL_RANK = {name: rank for rank, name in enumerate(DATASET_LEVELS)}


def dataset_level_at_least(level: str, need: str) -> bool:
    """Whether access ``level`` is ``need`` or higher."""
    return _LEVEL_RANK.get(level, 0) >= _LEVEL_RANK[need]


def dataset_access_levels(
    db: Session, principal: Principal, datasets: Iterable[Dataset]
) -> dict[str, str]:
    """Access level of ``principal`` on each dataset, with a fixed number of queries.

    Platform admins and project managers get ``manage``; a non-member gets
    ``none``. Other members get ``modify`` in ``project`` mode; in ``restricted``
    mode the creator gets ``modify``, a granted user the grant's level and
    everyone else ``none``. Grants of a removed member are inert because the
    membership is required first.
    """
    datasets = [dataset for dataset in datasets if dataset is not None]
    if not datasets:
        return {}
    if is_platform_admin(principal):
        return {dataset.id: "manage" for dataset in datasets}
    project_ids = {dataset.project_id for dataset in datasets}
    roles = {
        row.project_id: row.role
        for row in db.query(ProjectMembership.project_id, ProjectMembership.role).filter(
            ProjectMembership.user_id == principal.user.id,
            ProjectMembership.project_id.in_(project_ids),
        )
    }
    restricted_ids = [
        dataset.id
        for dataset in datasets
        if dataset.access_mode == "restricted" and dataset.project_id in roles
    ]
    grants: dict[str, str] = {}
    if restricted_ids:
        grants = {
            row.dataset_id: row.level
            for row in db.query(DatasetGrant.dataset_id, DatasetGrant.level).filter(
                DatasetGrant.user_id == principal.user.id, DatasetGrant.dataset_id.in_(restricted_ids)
            )
        }
    levels: dict[str, str] = {}
    for dataset in datasets:
        role = roles.get(dataset.project_id)
        if role is None:
            levels[dataset.id] = "none"
        elif role == ProjectRole.MANAGER:
            levels[dataset.id] = "manage"
        elif dataset.access_mode != "restricted":
            levels[dataset.id] = "modify"
        elif dataset.created_by_user_id == principal.user.id:
            levels[dataset.id] = "modify"
        else:
            granted = grants.get(dataset.id)
            levels[dataset.id] = granted if granted in ("view", "modify") else "none"
    return levels


def dataset_access_level(db: Session, principal: Principal, dataset: Dataset) -> str:
    """``none`` | ``view`` | ``modify`` | ``manage`` for ``principal`` on ``dataset``."""
    return dataset_access_levels(db, principal, [dataset])[dataset.id]


def restricted_dataset_rows_without_access(
    db: Session, principal: Principal, project_ids: Iterable[str]
) -> list[Any]:
    """Restricted datasets of ``project_ids`` that ``principal`` cannot open."""
    if is_platform_admin(principal):
        return []
    project_ids = {pid for pid in project_ids if pid}
    if not project_ids:
        return []
    restricted = (
        db.query(Dataset)
        .filter(Dataset.project_id.in_(project_ids), Dataset.access_mode == "restricted")
        .all()
    )
    levels = dataset_access_levels(db, principal, restricted)
    return [dataset for dataset in restricted if levels.get(dataset.id) == "none"]


def run_item_hidden_reasons(
    db: Session, principal: Principal, runs: Iterable[Run]
) -> dict[str, str]:
    """``{run_id: reason}`` for ``runs`` whose item contents ``principal`` may not see.

    The reason is ``private_test_set`` (admin-only items; wins when both apply)
    or ``dataset_access`` (the reader has no access to the run's restricted dataset).
    """
    runs = [run for run in runs if run is not None]
    if not runs or is_platform_admin(principal):
        return {}
    reasons = {run_id: "private_test_set" for run_id in private_test_set_run_ids(db, runs)}
    rest = [run for run in runs if run.id not in reasons]
    if rest:
        blocked = restricted_dataset_rows_without_access(db, principal, {run.project_id for run in rest})
        for run_id in _runs_on_datasets(db, rest, blocked):
            reasons[run_id] = "dataset_access"
    return reasons


def run_items_restricted_reason(db: Session, principal: Principal, run: Run) -> Optional[str]:
    return run_item_hidden_reasons(db, principal, [run]).get(run.id)


def can_view_run_items(db: Session, principal: Principal, run: Run) -> bool:
    """Whether ``principal`` may see ``run``'s item contents."""
    return run_items_restricted_reason(db, principal, run) is None


def hidden_dataset_run_ids(db: Session, principal: Principal, runs: Iterable[Run]) -> set[str]:
    """Ids of ``runs`` whose item contents ``principal`` may not see (private
    test set or a restricted dataset without access)."""
    return set(run_item_hidden_reasons(db, principal, runs))


def hidden_item_run_ids(db: Session, principal: Principal, runs: Iterable[Run]) -> set[str]:
    """Alias of :func:`hidden_dataset_run_ids` kept for existing callers."""
    return hidden_dataset_run_ids(db, principal, runs)


def require_run_items_visible(db: Session, principal: Principal, run: Run) -> None:
    reason = run_items_restricted_reason(db, principal, run)
    if reason == "dataset_access":
        raise HTTPException(status_code=403, detail=DATASET_ACCESS_DENIED_DETAIL)
    if reason is not None:
        raise HTTPException(status_code=403, detail=PRIVATE_TEST_SET_DETAIL)


# Analyzer / reviewer free text that routinely quotes item content. Matched
# exactly or as a ``<prefix>_`` suffix (``ai_root_cause_detail``,
# ``human_solution_note``...).
_FREE_TEXT_SUFFIXES = (
    "root_cause_detail",
    "root_cause_reason",
    "reason",
    "note",
    "finding",
    "solution",
    "messages",
)


def _is_content_key(key: str) -> bool:
    if key in _ITEM_CONTENT_KEYS:
        return True
    return any(key == suffix or key.endswith("_" + suffix) for suffix in _FREE_TEXT_SUFFIXES)


# Per-metric metadata (``{metric: meta}`` or ``{metric: [meta per pass]}``)
# is free-form and metrics routinely stash the prompt, the judged output or
# the reference answer there. Keep only numbers/booleans and the few string
# flags the UI renders; drop everything else.
_METRIC_META_KEYS = frozenset(
    {"metric_meta", "pass_metric_meta", "metric_metadata", "scores_snapshot"}
)
_METRIC_META_SAFE_STRINGS = frozenset(
    {"label", "status", "sample_reducer", "modified"}
)


def _redact_metric_meta(meta: Any, placeholder: str = PRIVATE_TEST_SET_PLACEHOLDER) -> Any:
    if isinstance(meta, list):
        return [_redact_metric_meta(entry, placeholder) for entry in meta]
    if not isinstance(meta, dict):
        # A bare score value (``scores_snapshot``) or a missing pass.
        return meta if meta is None or isinstance(meta, (bool, int, float, str)) else None
    safe: dict[str, Any] = {}
    for key, value in meta.items():
        if value is None or isinstance(value, (bool, int, float)):
            safe[key] = value
        elif key == "error" and value:
            # Truthiness drives the metric-error state in the UI.
            safe[key] = placeholder
        elif key in _METRIC_META_SAFE_STRINGS and isinstance(value, str):
            safe[key] = value
    return safe


def _redact(value: Any, placeholder: str = PRIVATE_TEST_SET_PLACEHOLDER) -> None:
    if isinstance(value, list):
        for entry in value:
            _redact(entry, placeholder)
        return
    if not isinstance(value, dict):
        return
    for key in list(value.keys()):
        entry = value[key]
        if key in _METRIC_META_KEYS and isinstance(entry, dict):
            value[key] = {
                metric: _redact_metric_meta(meta, placeholder) for metric, meta in entry.items()
            }
        elif isinstance(key, str) and _is_content_key(key):
            if entry not in (None, "", [], {}):
                value[key] = placeholder
        elif key in _ITEM_CONTENT_CLEARED_KEYS:
            value[key] = [] if isinstance(entry, list) else {} if isinstance(entry, dict) else None
        else:
            _redact(entry, placeholder)


def placeholder_for(reason: Optional[str]) -> str:
    """The text that replaces item content: the access sentence for ``dataset_access``, else the private-test-set one."""
    return DATASET_ACCESS_PLACEHOLDER if reason == "dataset_access" else PRIVATE_TEST_SET_PLACEHOLDER


def redact_item_content(payload: Any, reason: Optional[str] = None) -> Any:
    """Redact item content in place from an item-shaped dict (or a list of
    them), recursing into nested values such as ``pass_attempts`` and metric
    explanations. Marks each top-level dict ``content_restricted``. ``reason`` is
    ``items_restricted_reason``: ``dataset_access`` words the placeholder for a
    restricted dataset, anything else keeps the private-test-set text."""
    if isinstance(payload, list):
        for entry in payload:
            redact_item_content(entry, reason)
        return payload
    if isinstance(payload, dict):
        _redact(payload, placeholder_for(reason))
        payload["content_restricted"] = True
    return payload
