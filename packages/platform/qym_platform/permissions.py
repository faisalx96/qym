from __future__ import annotations

from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy import false
from sqlalchemy.orm import Query, Session

from qym_platform.auth import Principal
from qym_platform.db.models import (
    Dataset,
    DatasetVersion,
    ProjectMembership,
    ProjectRole,
    Run,
    UserRole,
)


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
    if run.owner_user_id == principal.user.id:
        return True
    return is_project_manager(db, principal, run.project_id)


def apply_reviewable_run_filter(query: Query, db: Session, principal: Principal) -> Query:
    # Review candidates are editable only while their run is active.  Keep
    # this invariant in the shared filter so soft-deleted runs cannot leak into
    # the queue (where the mutation endpoints correctly reject them).
    query = query.filter(Run.deleted_at.is_(None))
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


def private_test_set_run_ids(db: Session, runs: Iterable[Run]) -> set[str]:
    """Ids of ``runs`` evaluated against a private test set.

    A run is linked by ``dataset_id``, by ``dataset_version_id``, or (for runs
    uploaded without either) by its dataset name matching a private dataset's
    slug or name in the same project.
    """
    runs = [run for run in runs if run is not None]
    if not runs:
        return set()
    private = (
        db.query(Dataset.id, Dataset.project_id, Dataset.slug, Dataset.name)
        .filter(Dataset.private_test_set.is_(True))
        .all()
    )
    if not private:
        return set()
    private_ids = {row.id for row in private}
    private_names = {(row.project_id, row.slug) for row in private} | {
        (row.project_id, row.name) for row in private
    }
    version_ids = {run.dataset_version_id for run in runs if run.dataset_version_id and not run.dataset_id}
    private_version_ids: set[str] = set()
    if version_ids:
        private_version_ids = {
            row[0]
            for row in db.query(DatasetVersion.id)
            .filter(DatasetVersion.id.in_(version_ids), DatasetVersion.dataset_id.in_(private_ids))
            .all()
        }
    out: set[str] = set()
    for run in runs:
        if run.dataset_id:
            if run.dataset_id in private_ids:
                out.add(run.id)
        elif run.dataset_version_id:
            if run.dataset_version_id in private_version_ids:
                out.add(run.id)
        elif (run.project_id, run.dataset) in private_names:
            out.add(run.id)
    return out


def run_is_private_test_set(db: Session, run: Run) -> bool:
    return run.id in private_test_set_run_ids(db, [run])


def can_view_run_items(db: Session, principal: Principal, run: Run) -> bool:
    """Whether ``principal`` may see ``run``'s item contents."""
    if is_platform_admin(principal):
        return True
    return not run_is_private_test_set(db, run)


def hidden_item_run_ids(db: Session, principal: Principal, runs: Iterable[Run]) -> set[str]:
    """Ids of ``runs`` whose item contents ``principal`` may not see."""
    if is_platform_admin(principal):
        return set()
    return private_test_set_run_ids(db, runs)


def require_run_items_visible(db: Session, principal: Principal, run: Run) -> None:
    if not can_view_run_items(db, principal, run):
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


def _redact_metric_meta(meta: Any) -> Any:
    if isinstance(meta, list):
        return [_redact_metric_meta(entry) for entry in meta]
    if not isinstance(meta, dict):
        # A bare score value (``scores_snapshot``) or a missing pass.
        return meta if meta is None or isinstance(meta, (bool, int, float, str)) else None
    safe: dict[str, Any] = {}
    for key, value in meta.items():
        if value is None or isinstance(value, (bool, int, float)):
            safe[key] = value
        elif key == "error" and value:
            # Truthiness drives the metric-error state in the UI.
            safe[key] = PRIVATE_TEST_SET_PLACEHOLDER
        elif key in _METRIC_META_SAFE_STRINGS and isinstance(value, str):
            safe[key] = value
    return safe


def _redact(value: Any) -> None:
    if isinstance(value, list):
        for entry in value:
            _redact(entry)
        return
    if not isinstance(value, dict):
        return
    for key in list(value.keys()):
        entry = value[key]
        if key in _METRIC_META_KEYS and isinstance(entry, dict):
            value[key] = {
                metric: _redact_metric_meta(meta) for metric, meta in entry.items()
            }
        elif isinstance(key, str) and _is_content_key(key):
            if entry not in (None, "", [], {}):
                value[key] = PRIVATE_TEST_SET_PLACEHOLDER
        elif key in _ITEM_CONTENT_CLEARED_KEYS:
            value[key] = [] if isinstance(entry, list) else {} if isinstance(entry, dict) else None
        else:
            _redact(entry)


def redact_item_content(payload: Any) -> Any:
    """Redact item content in place from an item-shaped dict (or a list of
    them), recursing into nested values such as ``pass_attempts`` and metric
    explanations. Marks each top-level dict ``content_restricted``."""
    if isinstance(payload, list):
        for entry in payload:
            redact_item_content(entry)
        return payload
    if isinstance(payload, dict):
        _redact(payload)
        payload["content_restricted"] = True
    return payload
