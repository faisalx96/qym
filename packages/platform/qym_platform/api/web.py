from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.auth_oidc import end_user_sessions, local_auth_enabled
from qym_platform.api.projects import serialize_project_payloads
from qym_platform.db.models import (
    AuditLog,
    LocalAuthCredential,
    Project,
    ProjectMembership,
    User,
    UserIdentity,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import generate_temporary_password, hash_password
from qym_platform.settings import PlatformSettings


router = APIRouter()


def _require_admin(principal: Principal) -> None:
    if principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")


@router.get("/v1/me")
def me(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    u = principal.user
    if u.role == UserRole.ADMIN:
        project_models = db.query(Project).filter(Project.is_active == True).order_by(Project.name).all()
    else:
        memberships = (
            db.query(ProjectMembership, Project)
            .join(Project, Project.id == ProjectMembership.project_id)
            .filter(ProjectMembership.user_id == u.id, Project.is_active == True)
            .order_by(Project.name)
            .all()
        )
        project_models = [project for membership, project in memberships]
    projects = serialize_project_payloads(db, project_models, principal)
    default_project = projects[0] if projects else None

    admin_exists = db.query(User.id).filter(User.role == UserRole.ADMIN, User.is_active == True).first() is not None
    can_bootstrap_admin = (
        principal.auth_type in {"oidc", "local_password"}
        and u.role != UserRole.ADMIN
        and bool(PlatformSettings().admin_bootstrap_token)
        and not admin_exists
    )

    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "title": u.title,
        "role": u.role.value if hasattr(u.role, "value") else u.role,
        "auth_type": principal.auth_type,
        "auth_provider": principal.provider,
        "needs_admin_bootstrap": not admin_exists,
        "can_bootstrap_admin": can_bootstrap_admin,
        "projects": projects,
        "default_project": default_project,
    }


@router.get("/v1/users")
def list_users(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> list[Dict[str, Any]]:
    # The whole user directory is for admins. Project managers look people up
    # through GET /v1/projects/{id}/member-candidates instead.
    _require_admin(principal)
    users = db.query(User).filter(User.is_active == True).order_by(User.email).all()
    return [
        {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "title": user.title,
            "role": user.role.value,
        }
        for user in users
    ]


class CreateUserRequest(BaseModel):
    email: str
    display_name: str = ""
    role: UserRole = UserRole.MEMBER
    is_active: bool = True


class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


@router.get("/v1/admin/users")
def admin_list_users(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> list[Dict[str, Any]]:
    _require_admin(principal)
    users = db.query(User).order_by(User.email).all()
    return [
        {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "title": user.title,
            "role": user.role.value,
            "is_active": user.is_active,
        }
        for user in users
    ]


@router.post("/v1/admin/users")
def admin_create_user(
    req: CreateUserRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_admin(principal)
    email = req.email.strip().lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        return {"id": existing.id, "email": existing.email, "existing": True}

    user = User(
        email=email,
        display_name=req.display_name.strip(),
        role=req.role,
        is_active=req.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email}


def _other_active_admins_locked(db: Session, user_id: str) -> List[str]:
    """Active admins other than ``user_id``, with every active admin row locked.

    Rows are locked in id order before counting: two admins disabling,
    demoting or deleting each other at once then run one after the other, and
    the second sees the first's change (Postgres re-checks the filter on rows
    it waited for). SQLite ignores FOR UPDATE and serialises writers anyway.
    """
    active_admin_ids = [
        row.id
        for row in db.query(User.id)
        .filter(User.role == UserRole.ADMIN, User.is_active.is_(True))
        .order_by(User.id)
        .with_for_update()
        .all()
    ]
    return [admin_id for admin_id in active_admin_ids if admin_id != user_id]


@router.put("/v1/admin/users/{user_id}")
def admin_update_user(
    user_id: str,
    req: UpdateUserRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_admin(principal)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.email is not None:
        next_email = req.email.strip().lower()
        conflict = db.query(User).filter(User.email == next_email, User.id != user.id).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = next_email
    if req.display_name is not None:
        user.display_name = req.display_name.strip()
    if req.is_active is False and user.id == principal.user.id:
        raise HTTPException(status_code=400, detail="You cannot disable your own account")
    if (
        user.id == principal.user.id
        and user.role == UserRole.ADMIN
        and req.role is not None
        and req.role != UserRole.ADMIN
    ):
        # Another admin can change it; demoting yourself ends your admin access
        # in the middle of the page that manages it.
        raise HTTPException(status_code=409, detail="You cannot remove your own admin role")
    will_be_admin = (req.role if req.role is not None else user.role) == UserRole.ADMIN and (
        req.is_active if req.is_active is not None else user.is_active
    )
    if user.role == UserRole.ADMIN and user.is_active and not will_be_admin:
        other_admins = _other_active_admins_locked(db, user.id)
        if not other_admins:
            # Nobody could sign in to undo this: the bootstrap token only
            # works while there are no users at all.
            raise HTTPException(status_code=409, detail="At least one active admin must remain")
    if req.role is not None:
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active
        if not req.is_active:
            # A later re-enable must not revive sessions from before the disable.
            end_user_sessions(db, user.id)

    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "ok": True}


def _store_temporary_password(db: Session, user: User, actor_id: str, password_hash: bytes) -> None:
    credential = db.query(LocalAuthCredential).filter(LocalAuthCredential.user_id == user.id).first()
    had_password = credential is not None
    if credential is None:
        # Users who only signed in through a provider get a password login too.
        credential = LocalAuthCredential(user_id=user.id, password_hash=b"")
        db.add(credential)
    credential.password_hash = password_hash
    credential.must_change_password = True
    # A new credential is an INSERT, which the password hook does not see; a
    # reset always signs the user out everywhere.
    end_user_sessions(db, user.id)

    has_identity = (
        db.query(UserIdentity.id)
        .filter(UserIdentity.user_id == user.id, UserIdentity.provider == "local_password")
        .first()
        is not None
    )
    if not has_identity:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="local_password",
                subject=user.id,
                email=user.email,
                raw_claims={"email": user.email, "auth_type": "local_password"},
            )
        )
    db.add(
        AuditLog(
            actor_user_id=actor_id,
            action="user.password_reset",
            entity_type="user",
            entity_id=user.id,
            before={"had_password": had_password},
            after={"must_change_password": True},
        )
    )


@router.post("/v1/admin/users/{user_id}/reset-password")
def admin_reset_user_password(
    user_id: str,
    response: Response,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Issue a one-time password; the user must choose a new one at next sign-in."""
    _require_admin(principal)
    if not local_auth_enabled(PlatformSettings()):
        raise HTTPException(status_code=400, detail="Email/password auth is not enabled")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    temporary_password = generate_temporary_password()
    password_hash = hash_password(temporary_password)
    actor_id = principal.user.id
    # Two first resets can both see no credential. The second insert then fails
    # on the unique key; one retry updates the committed row, so the last reset wins.
    for attempt in range(2):
        try:
            _store_temporary_password(db, user, actor_id, password_hash)
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt:
                raise
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "user_id": user.id, "temporary_password": temporary_password}


@router.delete("/v1/admin/users/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    _require_admin(principal)
    if user_id == principal.user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (
        user.role == UserRole.ADMIN
        and user.is_active
        and not _other_active_admins_locked(db, user.id)
    ):
        raise HTTPException(status_code=409, detail="At least one active admin must remain")

    db.delete(user)
    db.commit()
    return {"ok": True, "deleted_id": user_id}
