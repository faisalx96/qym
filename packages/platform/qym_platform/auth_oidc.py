from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform.db.models import User, UserIdentity, UserRole, UserSession
from qym_platform.settings import PlatformSettings


SESSION_USER_ID_KEY = "qym_user_id"
SESSION_PROVIDER_KEY = "qym_auth_provider"
SESSION_NEXT_KEY = "qym_auth_next"
SESSION_ID_KEY = "qym_sid"

# Idle lifetime of a sign-in. The cookie is re-signed on every response, so an
# active user stays signed in; the server-side row mirrors the same window.
SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
# Refresh ``last_seen_at`` at most this often (one small write per session).
_SESSION_TOUCH_INTERVAL = timedelta(minutes=10)
# The row outlives the cookie by one touch interval so the server never ends a
# session the browser still considers valid.
_SESSION_IDLE_LIMIT = timedelta(seconds=SESSION_MAX_AGE_SECONDS) + _SESSION_TOUCH_INTERVAL


@dataclass(frozen=True)
class ProviderIdentity:
    provider: str
    subject: str
    email: str
    email_verified: bool
    display_name: str
    raw_claims: Dict[str, Any]


def auth_mode_is_oidc(settings: PlatformSettings) -> bool:
    return str(settings.auth_mode).lower() == "oidc"


def local_auth_enabled(settings: PlatformSettings) -> bool:
    return bool(settings.auth_local_enabled) and str(settings.auth_mode).lower() != "none"


def session_auth_enabled(settings: PlatformSettings) -> bool:
    return auth_mode_is_oidc(settings) or local_auth_enabled(settings)


def enabled_provider_names(settings: PlatformSettings) -> list[str]:
    enabled: list[str] = []
    if settings.auth_google_client_id and settings.auth_google_client_secret:
        enabled.append("google")
    if settings.auth_github_client_id and settings.auth_github_client_secret:
        enabled.append("github")
    if settings.auth_gitlab_url and settings.auth_gitlab_client_id and settings.auth_gitlab_client_secret:
        enabled.append("gitlab")
    return enabled


def provider_catalog(settings: PlatformSettings) -> list[dict[str, Any]]:
    enabled = set(enabled_provider_names(settings)) if auth_mode_is_oidc(settings) else set()
    providers = [
        {
            "id": "google",
            "label": "Continue with Google",
            "enabled": "google" in enabled,
            "kind": "social",
        },
        {
            "id": "github",
            "label": "Continue with GitHub",
            "enabled": "github" in enabled,
            "kind": "social",
        },
        {
            "id": "gitlab",
            "label": "Continue with GitLab",
            "enabled": "gitlab" in enabled,
            "kind": "social",
        },
        {
            "id": "sso",
            "label": "Continue with SSO",
            "enabled": False,
            "kind": "enterprise",
            "coming_soon": True,
        },
    ]
    return providers


def request_root_path(request: Request) -> str:
    """Return the URL prefix the app is mounted under (e.g. ``/qym``) or ``""``."""
    return (request.scope.get("root_path") or "").rstrip("/")


def with_root_path(request: Request, path: str) -> str:
    """Prepend the request's root_path to an absolute path, leaving others alone."""
    if not path:
        return request_root_path(request) + "/"
    if path.startswith("/") and not path.startswith("//"):
        return request_root_path(request) + path
    return path


def sanitize_next(next_value: Optional[str], default: str = "/") -> str:
    value = (next_value or "").strip()
    if not value:
        return default
    if not value.startswith("/"):
        return default
    if value.startswith("//"):
        return default
    return value


def _session_store(request: Request) -> dict[str, Any]:
    session = request.scope.get("session")
    if isinstance(session, dict):
        return session
    return {}


def store_login_next(request: Request, next_value: Optional[str]) -> str:
    default = with_root_path(request, "/")
    sanitized = sanitize_next(next_value, default=default)
    request.scope.setdefault("session", {})[SESSION_NEXT_KEY] = sanitized
    return sanitized


def pop_login_next(request: Request) -> str:
    default = with_root_path(request, "/")
    return sanitize_next(_session_store(request).pop(SESSION_NEXT_KEY, default), default=default)


def _session_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def set_authenticated_session(db: Session, request: Request, user: User, provider: str) -> None:
    """Start a new server-side session and point the cookie at it.

    Signing in always rotates the session: any session the cookie carried
    before is ended, and only the post-login redirect target is kept.
    """
    session = request.scope.setdefault("session", {})
    now = datetime.utcnow()
    previous = session.get(SESSION_ID_KEY)
    if previous:
        db.query(UserSession).filter(UserSession.id == _session_digest(str(previous))).delete(
            synchronize_session=False
        )
    # Sessions idle past their lifetime can no longer authenticate; drop them.
    db.query(UserSession).filter(UserSession.last_seen_at < now - _SESSION_IDLE_LIMIT).delete(
        synchronize_session=False
    )
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            id=_session_digest(token),
            user_id=str(user.id),
            provider=provider,
            created_at=now,
            last_seen_at=now,
        )
    )
    db.commit()
    next_value = session.get(SESSION_NEXT_KEY)
    session.clear()
    if next_value:
        session[SESSION_NEXT_KEY] = next_value
    session[SESSION_ID_KEY] = token
    session[SESSION_USER_ID_KEY] = str(user.id)
    session[SESSION_PROVIDER_KEY] = provider


def clear_authenticated_session(db: Session, request: Request) -> None:
    """End this browser's session on the server and clear its cookie."""
    session = _session_store(request)
    token = session.get(SESSION_ID_KEY)
    if token:
        db.query(UserSession).filter(UserSession.id == _session_digest(str(token))).delete(
            synchronize_session=False
        )
        db.commit()
    session.clear()


def end_user_sessions(db: Session, user_id: str) -> int:
    """End every browser session of a user. The caller commits."""
    return (
        db.query(UserSession)
        .filter(UserSession.user_id == str(user_id))
        .delete(synchronize_session=False)
    )


def get_session_user_and_provider(db: Session, request: Request) -> Optional[tuple[User, Optional[str]]]:
    session = _session_store(request)
    user_id = session.get(SESSION_USER_ID_KEY)
    if not user_id:
        return None
    token = session.get(SESSION_ID_KEY)
    # Cookies issued before server-side sessions carry no token and cannot be
    # revoked, so they are not trusted; those users sign in once more.
    row = db.get(UserSession, _session_digest(str(token))) if token else None
    now = datetime.utcnow()
    if row is None or row.user_id != str(user_id) or row.last_seen_at < now - _SESSION_IDLE_LIMIT:
        session.clear()
        return None
    provider = row.provider or session.get(SESSION_PROVIDER_KEY)
    if now - row.last_seen_at >= _SESSION_TOUCH_INTERVAL:
        row.last_seen_at = now
        db.commit()
    user = db.query(User).filter(User.id == str(user_id)).first()
    if not user or not user.is_active:
        session.clear()
        return None
    return user, provider


def _default_display_name(email: str, display_name: str = "") -> str:
    display_name = (display_name or "").strip()
    if display_name:
        return display_name
    local = (email or "").split("@", 1)[0].strip()
    if not local:
        return email
    parts = [part for part in local.replace(".", " ").replace("_", " ").replace("-", " ").split() if part]
    if not parts:
        return email
    return " ".join(part.capitalize() for part in parts)


def resolve_or_provision_user(db: Session, identity: ProviderIdentity) -> User:
    if not identity.email_verified or not identity.email:
        raise HTTPException(status_code=401, detail="Provider account does not expose a verified email")

    existing_identity = (
        db.query(UserIdentity)
        .filter(UserIdentity.provider == identity.provider, UserIdentity.subject == identity.subject)
        .first()
    )
    if existing_identity:
        user = db.query(User).filter(User.id == existing_identity.user_id).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=403, detail="User disabled")
        return user

    user = db.query(User).filter(User.email == identity.email).first()
    created_user = False
    if not user:
        user = User(
            email=identity.email,
            display_name=_default_display_name(identity.email, identity.display_name),
            role=UserRole.MEMBER,
            is_active=True,
        )
        db.add(user)
        db.flush()
        created_user = True
    elif not user.is_active:
        raise HTTPException(status_code=403, detail="User disabled")
    elif not user.display_name and identity.display_name:
        user.display_name = identity.display_name.strip()

    db.add(
        UserIdentity(
            user_id=user.id,
            provider=identity.provider,
            subject=identity.subject,
            email=identity.email,
            raw_claims=identity.raw_claims,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        resolved = db.query(User).filter(User.email == identity.email).first()
        if resolved and resolved.is_active:
            return resolved
        raise
    db.refresh(user)
    if created_user and not user.display_name:
        user.display_name = _default_display_name(identity.email)
        db.commit()
        db.refresh(user)
    return user


def _oauth_client(settings: PlatformSettings, provider: str):
    try:
        from authlib.integrations.starlette_client import OAuth
    except ImportError as exc:
        raise RuntimeError("Authlib is required for OIDC login. Install qym-platform with auth dependencies.") from exc

    oauth = OAuth()
    if provider == "google":
        oauth.register(
            name="google",
            client_id=settings.auth_google_client_id,
            client_secret=settings.auth_google_client_secret,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    elif provider == "github":
        oauth.register(
            name="github",
            client_id=settings.auth_github_client_id,
            client_secret=settings.auth_github_client_secret,
            access_token_url="https://github.com/login/oauth/access_token",
            authorize_url="https://github.com/login/oauth/authorize",
            api_base_url="https://api.github.com/",
            client_kwargs={"scope": "read:user user:email"},
        )
    elif provider == "gitlab":
        # Without an instance URL, discovery would fetch a relative path and 500.
        if "gitlab" not in enabled_provider_names(settings):
            raise HTTPException(status_code=400, detail="gitlab login is not configured")
        oauth.register(
            name="gitlab",
            client_id=settings.auth_gitlab_client_id,
            client_secret=settings.auth_gitlab_client_secret,
            server_metadata_url=f"{settings.auth_gitlab_url.rstrip('/')}/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    else:
        raise HTTPException(status_code=404, detail="Unknown provider")

    client = oauth.create_client(provider)
    if client is None:
        raise HTTPException(status_code=400, detail=f"{provider} login is not configured")
    return client


async def begin_provider_login(request: Request, provider: str, settings: PlatformSettings):
    if provider == "sso":
        raise HTTPException(status_code=501, detail="SSO login is not configured yet")
    client = _oauth_client(settings, provider)
    redirect_uri = f"{settings.base_url.rstrip('/')}/v1/auth/callback/{provider}"
    if provider == "google":
        return await client.authorize_redirect(request, redirect_uri, prompt="select_account")
    return await client.authorize_redirect(request, redirect_uri)


_OIDC_PROVIDER_LABELS = {"google": "Google", "gitlab": "GitLab"}


def _claim_is_true(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return value is True


def oidc_identity_from_claims(provider: str, claims: Dict[str, Any], issuer: str = "") -> ProviderIdentity:
    """Build an identity from standard OIDC claims, requiring a verified email.

    ``issuer`` scopes the subject: a ``sub`` is only unique within its issuer,
    and the GitLab issuer is configurable, so GitLab subjects are stored as
    ``<issuer>#<sub>`` (an OIDC issuer never contains a fragment).
    """
    label = _OIDC_PROVIDER_LABELS[provider]
    email = str(claims.get("email") or "").strip().lower()
    if not email or not _claim_is_true(claims.get("email_verified")):
        raise HTTPException(status_code=401, detail=f"{label} account must provide a verified email")
    subject = str(claims.get("sub") or "").strip()
    if not subject:
        raise HTTPException(status_code=401, detail=f"{label} identity is missing subject")
    if issuer:
        subject = f"{issuer}#{subject}"
    display_name = str(
        claims.get("name") or claims.get("given_name") or claims.get("preferred_username") or claims.get("nickname") or ""
    ).strip()
    return ProviderIdentity(
        provider=provider,
        subject=subject,
        email=email,
        email_verified=True,
        display_name=display_name,
        raw_claims=claims,
    )


async def exchange_provider_identity(request: Request, provider: str, settings: PlatformSettings) -> ProviderIdentity:
    client = _oauth_client(settings, provider)
    token = await client.authorize_access_token(request)

    if provider in _OIDC_PROVIDER_LABELS:
        claims = dict(token.get("userinfo") or {})
        issuer = ""
        if provider == "gitlab":
            # Authlib validated the ID token's iss against the discovery issuer.
            # Read it before the userinfo merge so a userinfo body cannot set it.
            issuer = str(claims.get("iss") or "").strip()
            if not issuer:
                raise HTTPException(status_code=401, detail="GitLab identity is missing issuer")
        # GitLab only puts email claims in the ID token for users with a public
        # email; the userinfo endpoint always returns the primary email.
        if not claims.get("email") or "email_verified" not in claims:
            fetched = dict(await client.userinfo(token=token))
            if claims.get("sub") and str(fetched.get("sub") or "") != str(claims["sub"]):
                raise HTTPException(status_code=401, detail="Provider userinfo does not match the ID token")
            claims = {**claims, **fetched}
        return oidc_identity_from_claims(provider, claims, issuer=issuer)

    if provider == "github":
        profile_response = await client.get("user", token=token)
        emails_response = await client.get("user/emails", token=token)
        profile = dict(profile_response.json())
        emails = list(emails_response.json() or [])
        verified_email = None
        for item in emails:
            if item.get("verified") and item.get("primary"):
                verified_email = item.get("email")
                break
        if not verified_email:
            for item in emails:
                if item.get("verified"):
                    verified_email = item.get("email")
                    break
        email = str(verified_email or "").strip().lower()
        if not email:
            raise HTTPException(status_code=401, detail="GitHub account must provide a verified email")
        subject = str(profile.get("id") or "").strip()
        if not subject:
            raise HTTPException(status_code=401, detail="GitHub identity is missing subject")
        display_name = str(profile.get("name") or profile.get("login") or "").strip()
        raw_claims = {"profile": profile, "emails": emails}
        return ProviderIdentity(
            provider="github",
            subject=subject,
            email=email,
            email_verified=True,
            display_name=display_name,
            raw_claims=raw_claims,
        )

    raise HTTPException(status_code=404, detail="Unknown provider")


def origin_matches_base(origin: str, base_url: str) -> bool:
    try:
        o = urlparse(origin)
        b = urlparse(base_url)
    except Exception:
        return False
    return bool(o.scheme and o.netloc and b.scheme and b.netloc and o.scheme == b.scheme and o.netloc == b.netloc)
