from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import false, select
from sqlalchemy.orm import Query, Session

from qym_platform.auth import Principal
from qym_platform.db.models import Project, ProjectMembership, ProjectRole, Run, UserRole

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
    analysis, settings, members, API keys) calls this after its access check,
    so a non-member still gets 403/404 rather than learning the project state.
    Reads never call it. Exempt on purpose: the admin archive, unarchive and
    delete endpoints, and actions that only take access or work away (revoking
    a key, removing a member, cancelling a running analysis job).
    tests/platform/test_archived_project_read_only.py lists every write route.
    """
    if is_project_archived(db, project_id):
        raise HTTPException(
            status_code=409,
            detail=ARCHIVED_PROJECT_DETAIL,
            headers={PROJECT_STATE_HEADER: "archived"},
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
