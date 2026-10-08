from __future__ import annotations

import json
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.auth_oidc import (
    auth_mode_is_oidc,
    begin_provider_login,
    clear_authenticated_session,
    end_user_sessions,
    exchange_provider_identity,
    get_session_user_and_provider,
    local_auth_enabled,
    pop_login_next,
    provider_catalog,
    request_root_path,
    resolve_or_provision_user,
    sanitize_next,
    session_auth_enabled,
    set_authenticated_session,
    store_login_next,
    with_root_path,
)
from qym_platform.db.models import LocalAuthCredential, User, UserIdentity, UserRole
from qym_platform.deps import get_db
from qym_platform.login_throttle import client_key, login_throttle
from qym_platform.security import hash_password, verify_password
from qym_platform.settings import PlatformSettings


from qym_platform.log import get_logger

logger = get_logger(__name__)

router = APIRouter()


def _platform_static_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "_static"


def _signup_allowed(db: Session, settings: PlatformSettings) -> bool:
    """Self sign-up needs QYM_AUTH_LOCAL_SIGNUP, except before any admin exists.

    Until someone holds the admin role, the first person must be able to
    create an account and claim it with the bootstrap token.
    """
    if not local_auth_enabled(settings):
        return False
    if settings.auth_local_signup:
        return True
    admin_exists = (
        db.query(User.id)
        .filter(User.role == UserRole.ADMIN, User.is_active.is_(True))
        .first()
        is not None
    )
    return not admin_exists


def _login_bootstrap_payload(db: Session, settings: PlatformSettings) -> Dict[str, Any]:
    local_enabled = local_auth_enabled(settings)
    return {
        "auth_mode": settings.auth_mode,
        "providers": provider_catalog(settings),
        "local_auth": {
            "enabled": local_enabled,
            "signup_enabled": _signup_allowed(db, settings),
        },
    }


def _resolve_next(request: Request) -> str:
    default = with_root_path(request, "/")
    return sanitize_next(request.query_params.get("next"), default=default)


def _normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if not value or "@" not in value:
        raise HTTPException(status_code=400, detail="A valid email address is required")
    return value


def _default_display_name(email: str, display_name: str = "") -> str:
    value = (display_name or "").strip()
    if value:
        return value
    local = (email or "").split("@", 1)[0].strip()
    if not local:
        return email
    parts = [part for part in local.replace(".", " ").replace("_", " ").replace("-", " ").split() if part]
    return " ".join(part.capitalize() for part in parts) if parts else email


def _ensure_local_auth_enabled(settings: PlatformSettings) -> None:
    if not local_auth_enabled(settings):
        raise HTTPException(status_code=400, detail="Email/password auth is not enabled")


def _invalid_credentials() -> HTTPException:
    return HTTPException(status_code=401, detail="Invalid email or password")


_DUMMY_PASSWORD_HASH: Optional[bytes] = None


def _dummy_password_hash() -> bytes:
    global _DUMMY_PASSWORD_HASH
    if _DUMMY_PASSWORD_HASH is None:
        _DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(24))
    return _DUMMY_PASSWORD_HASH


def _verified_local_credential(
    db: Session, request: Request, email: str, password: str
) -> tuple[User, LocalAuthCredential]:
    """Check an email and password, throttling failures per email and client.

    Wrong attempts lock the email only for the client that made them; the
    email's ceiling across all clients is much higher (login_throttle.py).
    Every failure costs one password hash, whether or not the account exists,
    so neither the answer nor its timing tells which emails have accounts.
    """
    normalized = _normalize_email(email)
    throttle = login_throttle(request)
    # Checked and counted as a failure in one step, so concurrent wrong
    # passwords cannot all pass the check while the first is being verified.
    attempt = throttle.begin(normalized, client_key(request))
    try:
        user = db.query(User).filter(User.email == normalized).first()
        credential = (
            db.query(LocalAuthCredential).filter(LocalAuthCredential.user_id == user.id).first()
            if user is not None and user.is_active
            else None
        )
        stored_hash = credential.password_hash if credential is not None else _dummy_password_hash()
        password_ok = verify_password(password, stored_hash)
    except BaseException:
        throttle.cancel(attempt)
        raise
    if credential is None or not password_ok:
        logger.info("password sign-in failed")
        throttle.failed(attempt)
        raise _invalid_credentials()
    throttle.succeeded(attempt)
    return user, credential


@router.get("/login", response_model=None)
def login_page(
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    settings = PlatformSettings()
    next_value = _resolve_next(request)
    if session_auth_enabled(settings):
        resolved = get_session_user_and_provider(db, request)
        if resolved:
            return RedirectResponse(url=next_value, status_code=303)
    idx = _platform_static_dir() / "dashboard" / "login.html"
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Login UI not found")
    html = idx.read_text(encoding="utf-8")
    root_path = request_root_path(request)
    html = html.replace("__QYM_LOGIN_BOOTSTRAP_JSON__", json.dumps(_login_bootstrap_payload(db, settings)))
    html = html.replace("__QYM_ROOT_PATH_JSON__", json.dumps(root_path))
    html = html.replace("__QYM_PREFIX__", root_path)
    html = html.replace(
        "<!--__QYM_LOCAL_AUTH_MARKER__-->",
        '<meta name="qym-local-auth" content="enabled">' if local_auth_enabled(settings) else "",
    )
    return HTMLResponse(html)


@router.get("/v1/auth/providers")
def auth_providers(db: Session = Depends(get_db)) -> Dict[str, Any]:
    settings = PlatformSettings()
    return _login_bootstrap_payload(db, settings)


@router.get("/v1/auth/login/{provider}", response_model=None)
async def auth_login(provider: str, request: Request):
    settings = PlatformSettings()
    if not auth_mode_is_oidc(settings):
        raise HTTPException(status_code=400, detail="OIDC auth mode is not enabled")
    if provider not in {item["id"] for item in provider_catalog(settings)}:
        raise HTTPException(status_code=404, detail="Unknown provider")
    store_login_next(request, request.query_params.get("next"))
    return await begin_provider_login(request, provider, settings)


@router.get("/v1/auth/callback/{provider}", response_model=None)
async def auth_callback(
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
):
    settings = PlatformSettings()
    if not auth_mode_is_oidc(settings):
        raise HTTPException(status_code=400, detail="OIDC auth mode is not enabled")
    identity = await exchange_provider_identity(request, provider, settings)
    user = resolve_or_provision_user(db, identity)
    set_authenticated_session(db, request, user, provider)
    return RedirectResponse(url=pop_login_next(request), status_code=303)


class PasswordLoginRequest(BaseModel):
    email: str
    password: str


class PasswordSignupRequest(PasswordLoginRequest):
    display_name: str = ""


class PasswordChangeRequest(BaseModel):
    email: str
    current_password: str
    new_password: str


@router.post("/v1/auth/login/password", response_model=None)
def auth_login_password(
    payload: PasswordLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    settings = PlatformSettings()
    _ensure_local_auth_enabled(settings)

    user, credential = _verified_local_credential(db, request, payload.email, payload.password)
    if credential.must_change_password:
        # A temporary password only unlocks the change-password step; no session yet.
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "detail": "Set a new password to finish signing in.",
                "code": "password_change_required",
            },
        )

    credential.last_login_at = datetime.utcnow()
    db.commit()
    set_authenticated_session(db, request, user, "local_password")
    logger.info("user %s signed in with a password", user.id)
    return {"ok": True, "next": _resolve_next(request)}


@router.post("/v1/auth/password/change")
def auth_change_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    settings = PlatformSettings()
    _ensure_local_auth_enabled(settings)

    user, credential = _verified_local_credential(
        db, request, payload.email, payload.current_password
    )
    verified_hash = bytes(credential.password_hash)
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="The new password must be different from the current password")
    try:
        password_hash = hash_password(payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Write only if the hash is still the one verified above. A reset or another
    # change that committed in between makes this match no row, so a temporary
    # password is consumed once and a stale request cannot overwrite a newer one.
    now = datetime.utcnow()
    result = db.execute(
        update(LocalAuthCredential)
        .where(
            LocalAuthCredential.user_id == user.id,
            LocalAuthCredential.password_hash == verified_hash,
        )
        .values(password_hash=password_hash, must_change_password=False, updated_at=now, last_login_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise _invalid_credentials()
    # A bulk UPDATE skips the ORM password hook, so end the other sessions here.
    end_user_sessions(db, user.id)
    db.commit()
    logger.info("user %s changed their password; other sessions ended", user.id)
    set_authenticated_session(db, request, user, "local_password")
    return {"ok": True, "next": _resolve_next(request)}


@router.post("/v1/auth/signup/password", status_code=status.HTTP_201_CREATED)
def auth_signup_password(
    payload: PasswordSignupRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    settings = PlatformSettings()
    _ensure_local_auth_enabled(settings)
    if not _signup_allowed(db, settings):
        raise HTTPException(
            status_code=403,
            detail="Sign-up is turned off. Ask an admin to add your account.",
        )

    email = _normalize_email(payload.email)
    # "Already exists" answers tell which emails have accounts; they count as
    # failed attempts for the client like wrong passwords do, but never
    # against the email: sign-up must not lock that person's sign-in.
    # Checked and counted in one step, as at sign-in.
    throttle = login_throttle(request)
    attempt = throttle.begin_client(client_key(request))
    try:
        try:
            password_hash = hash_password(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        taken = db.query(User.id).filter(User.email == email).first() is not None
    except BaseException:
        throttle.cancel(attempt)
        raise
    if taken:
        throttle.failed(attempt)
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    throttle.succeeded(attempt)

    user = User(
        email=email,
        display_name=_default_display_name(email, payload.display_name),
        role=UserRole.MEMBER,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(
        LocalAuthCredential(
            user_id=user.id,
            password_hash=password_hash,
        )
    )
    db.add(
        UserIdentity(
            user_id=user.id,
            provider="local_password",
            subject=user.id,
            email=email,
            raw_claims={"email": email, "auth_type": "local_password"},
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.info("sign-up raced with an existing account")
        raise HTTPException(status_code=409, detail="An account with this email already exists") from exc
    db.refresh(user)
    logger.info("user %s signed up with a password", user.id)
    set_authenticated_session(db, request, user, "local_password")
    return {"ok": True, "next": _resolve_next(request)}


@router.post("/v1/auth/logout")
def auth_logout(request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    # Ends the session on the server too, so a copy of the cookie stops working.
    clear_authenticated_session(db, request)
    return {"ok": True}


class BootstrapAdminRequest(BaseModel):
    bootstrap_token: str


@router.post("/v1/auth/bootstrap-admin")
def bootstrap_admin(
    req: BootstrapAdminRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    settings = PlatformSettings()
    if not settings.admin_bootstrap_token or req.bootstrap_token != settings.admin_bootstrap_token:
        logger.warning("admin bootstrap refused: invalid bootstrap token")
        raise HTTPException(status_code=403, detail="Invalid bootstrap token")

    user = db.query(User).filter(User.id == principal.user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.ADMIN:
        return {"ok": True, "user_id": user.id, "role": user.role.value}
    admin_exists = db.query(User.id).filter(User.role == UserRole.ADMIN, User.is_active == True).first() is not None
    if admin_exists:
        raise HTTPException(status_code=409, detail="Admin already exists")
    user.role = UserRole.ADMIN
    db.commit()
    db.refresh(user)
    logger.info("user %s claimed the first admin role with the bootstrap token", user.id)
    return {"ok": True, "user_id": user.id, "role": user.role.value}
