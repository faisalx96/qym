from __future__ import annotations

import time

import threading

import hashlib

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.db.models import ApiKey, User, UserIdentity, UserRole
from qym_platform.auth_oidc import get_session_user_and_provider, session_auth_enabled
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, verify_api_key
from qym_platform.settings import PlatformSettings


@dataclass(frozen=True)
class Principal:
    user: User
    auth_type: str  # api_key|proxy_headers|oidc|local_password|none
    scopes: tuple[str, ...] = ()
    provider: Optional[str] = None
    project_id: Optional[str] = None


def _default_display_name(email: str) -> str:
    local = (email or "").split("@", 1)[0].strip()
    if not local:
        return email
    parts = [part for part in local.replace(".", " ").replace("_", " ").replace("-", " ").split() if part]
    if not parts:
        return email
    return " ".join(part.capitalize() for part in parts)


def _provision_proxy_header_user(db: Session, email: str) -> User:
    user = User(
        email=email,
        display_name=_default_display_name(email),
        role=UserRole.MEMBER,
    )
    db.add(user)
    db.flush()
    db.add(
        UserIdentity(
            user_id=user.id,
            provider="proxy_headers",
            subject=email,
            email=email,
            raw_claims={"email": email},
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.is_active:
            return existing
        raise
    db.refresh(user)
    return user


def _session_auth_type(provider: Optional[str]) -> str:
    if provider == "local_password":
        return "local_password"
    return "oidc"


def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


# PBKDF2 verification costs ~100 ms of CPU; SDK clients send several batches per
# second, so remember a successful verification for a short while. The cache key
# is a digest of the token, never the token; revocation is still checked on every
# request through the ``revoked_at IS NULL`` lookup above.
_API_KEY_CACHE_TTL_SECONDS = 300.0
_API_KEY_CACHE_MAX = 1024
_api_key_cache: "dict[str, tuple[str, float]]" = {}
_api_key_cache_lock = threading.Lock()


def _verify_api_key_cached(token: str, key_id: str, key_hash: bytes) -> bool:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.monotonic()
    with _api_key_cache_lock:
        hit = _api_key_cache.get(digest)
        if hit and hit[0] == key_id and hit[1] > now:
            return True
    if not verify_api_key(token, key_hash):
        return False
    with _api_key_cache_lock:
        if len(_api_key_cache) >= _API_KEY_CACHE_MAX:
            _api_key_cache.clear()
        _api_key_cache[digest] = (key_id, now + _API_KEY_CACHE_TTL_SECONDS)
    return True


def clear_api_key_cache() -> None:
    with _api_key_cache_lock:
        _api_key_cache.clear()


def require_api_key_principal(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
) -> Principal:
    token = _bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing Bearer API key")

    prefix = api_key_prefix(token)
    row = (
        db.query(ApiKey)
        .filter(ApiKey.prefix == prefix)
        .filter(ApiKey.revoked_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not _verify_api_key_cached(token, row.id, row.key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")

    user = db.query(User).filter(User.id == row.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=403, detail="User disabled")
    scopes = tuple(str(scope).strip() for scope in (row.scopes or []) if str(scope).strip())
    return Principal(user=user, auth_type="api_key", scopes=scopes, project_id=row.project_id)


def require_api_key_scope(principal: Principal, required_scope: str) -> None:
    # Scope enforcement is intentionally disabled: any valid API key is granted full
    # access to its project. Authentication (a valid, non-revoked key) and project
    # membership still gate access; per-key scopes are no longer checked. The
    # `required_scope` argument is kept so call sites don't need to change, and so
    # enforcement can be reinstated here later without touching every endpoint.
    return


def require_ui_principal(
    request: Request,
    db: Session = Depends(get_db),
    x_user_email: Optional[str] = Header(default=None, alias="X-User-Email"),
    x_email: Optional[str] = Header(default=None, alias="X-Email"),
    x_admin_bootstrap: Optional[str] = Header(default=None, alias="X-Admin-Bootstrap"),
) -> Principal:
    """UI auth for internal deployments.

    - Prefer reverse-proxy headers (X-User-Email / X-Email)
    - Support first-admin bootstrap via X-Admin-Bootstrap == QYM_ADMIN_BOOTSTRAP_TOKEN
    """
    settings = PlatformSettings()
    auth_mode = str(settings.auth_mode).lower()

    # Local dev mode: no auth headers required. Create or reuse a stable dev user.
    if auth_mode == "none":
        email = "dev@local"
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(email=email, display_name="Dev User", role=UserRole.ADMIN)
            db.add(user)
            db.commit()
            db.refresh(user)
        return Principal(user=user, auth_type="none")

    if session_auth_enabled(settings):
        resolved = get_session_user_and_provider(db, request)
        if resolved:
            user, provider = resolved
            return Principal(user=user, auth_type=_session_auth_type(provider), provider=provider)
        if auth_mode == "oidc":
            raise HTTPException(status_code=401, detail="Not authenticated")

    email = (x_user_email or x_email or "").strip().lower()

    if email:
        user = db.query(User).filter(User.email == email).first()
        if user and user.is_active:
            return Principal(user=user, auth_type="proxy_headers", provider="proxy_headers")
        if auth_mode == "proxy_headers" and settings.auto_provision_users:
            user = _provision_proxy_header_user(db, email)
            return Principal(user=user, auth_type="proxy_headers", provider="proxy_headers")

    # Bootstrap if allowed and no users exist
    has_any = db.query(User.id).limit(1).first() is not None
    if not has_any and settings.admin_bootstrap_token and x_admin_bootstrap == settings.admin_bootstrap_token:
        if not email:
            raise HTTPException(status_code=400, detail="Bootstrap requires X-User-Email")
        user = User(email=email, display_name=email, role=UserRole.ADMIN)
        db.add(user)
        db.commit()
        db.refresh(user)
        return Principal(user=user, auth_type="proxy_headers", provider="proxy_headers")

    raise HTTPException(status_code=401, detail="Missing user identity headers")
