"""Serve the React SPA (``frontend/``, built to ``_static/app/``) at the canonical URLs.

The app answers every page URL (``/``, ``/login``, ``/projects/{slug}/...``,
``/admin/...``, ``/docs/...``, ``/compare``, ``/run/{id}``, ...) with the built
``index.html`` (history-API fallback) so client-side routes deep-link. The page
carries the runtime bootstrap the client needs (``window.__QYM_APP__``: root
path, auth mode, environment) and a ``<base href>`` so relative asset URLs
resolve under ``QYM_ROOT_PATH``/``QYM_MAIN_PREFIX``. Hashed assets live under
``/assets`` (mounted in ``app.py``).

Guards: an unauthenticated session is bounced to ``/login?next=...`` before the
bundle loads; ``/login`` sends a signed-in user on to ``next``. ``/app`` and
``/app/...`` (the migration-period prefix) redirect to the canonical URL, keeping
the query string, so links shared during the migration still work.

The fallback is the last route of the main app. API paths that match no route
(``/v1``, ``/api``, ``/ingestion``, ``/workers``, ``/assets``, ...) and any
path with a file extension answer a plain JSON 404, never ``index.html``. The
ingestion and workers apps do not include this router at all.
"""

from __future__ import annotations

import html as html_lib
import json
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from qym_platform.auth_oidc import (
    get_session_user_and_provider,
    request_root_path,
    sanitize_next,
    session_auth_enabled,
)
from qym_platform.deps import get_db
from qym_platform.settings import PlatformSettings

router = APIRouter()

SPA_ASSETS_PREFIX = "/assets/"
LEGACY_APP_PREFIX = "/app"
BOOTSTRAP_MARKER = "<!--__QYM_APP_BOOTSTRAP__-->"
# Path prefixes that are APIs or static mounts: an unmatched path under one is a 404, never the app.
RESERVED_PREFIXES = ("v1", "api", "api-docs", "openapi.json", "healthz", "assets", "static", "ui", "ingestion", "workers")
# Browsers ask for these next to index.html; they are never SPA routes.
_NON_ROUTE_SUFFIXES = (".js", ".css", ".map", ".json", ".png", ".svg", ".ico", ".txt", ".webmanifest", ".woff", ".woff2")


def spa_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "_static" / "app"


def spa_index() -> Path:
    return spa_dir() / "index.html"


def spa_bootstrap(settings: PlatformSettings, root: str) -> dict[str, Any]:
    """What ``window.__QYM_APP__`` carries (see frontend/src/lib/runtime.ts)."""
    return {
        "rootPath": root,
        "authMode": str(settings.auth_mode),
        "sessionAuth": session_auth_enabled(settings),
        "environment": str(settings.environment),
    }


def render_spa_index(html: str, settings: PlatformSettings, root: str) -> str:
    """Inject ``<base href>`` and the bootstrap script into the built index.html."""
    base = f'<base href="{html_lib.escape(root + "/", quote=True)}">'

    # "<" is escaped so no configured value can close the inline script early.
    def _js(value: Any) -> str:
        return json.dumps(value).replace("<", "\\u003c")

    script = (
        f"<script>window.__QYM_APP__ = {_js(spa_bootstrap(settings, root))};"
        f"window.__QYM_ROOT_PATH__ = {_js(root)};</script>"
    )
    injection = base + script
    if BOOTSTRAP_MARKER in html:
        return html.replace(BOOTSTRAP_MARKER, injection, 1)
    if "<head>" in html:
        return html.replace("<head>", "<head>" + injection, 1)
    return injection + html


def _login_redirect(request: Request, root: str) -> RedirectResponse:
    full_path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    next_value = sanitize_next(full_path, default=f"{root}/")
    return RedirectResponse(url=f"{root}/login?next={quote(next_value, safe='/')}", status_code=303)


def _serve_index(request: Request, settings: PlatformSettings) -> HTMLResponse:
    idx = spa_index()
    if not idx.exists():
        raise HTTPException(
            status_code=404,
            detail="The app bundle is not built. Run `npm run build` in frontend/ (or use the Vite dev server).",
        )
    root = request_root_path(request)
    return HTMLResponse(render_spa_index(idx.read_text(encoding="utf-8"), settings, root), media_type="text/html; charset=utf-8")


@router.get(LEGACY_APP_PREFIX, response_model=None, include_in_schema=False)
@router.get(LEGACY_APP_PREFIX + "/{rest:path}", response_model=None, include_in_schema=False)
def spa_legacy_prefix(request: Request, rest: str = "") -> RedirectResponse:
    """``/app/x?q`` -> ``/x?q`` (the URL prefix used while the app lived next to the old pages)."""
    root = request_root_path(request)
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(url=f"{root}/{rest}{query}", status_code=302)


@router.get("/login", response_model=None, include_in_schema=False)
def spa_login(request: Request, db: Session = Depends(get_db)) -> Any:
    settings = PlatformSettings()
    if session_auth_enabled(settings) and get_session_user_and_provider(db, request):
        root = request_root_path(request)
        target = sanitize_next(request.query_params.get("next"), default=f"{root}/")
        return RedirectResponse(url=target, status_code=303)
    return _serve_index(request, settings)


def make_fallback_route(reserved: Iterable[str] = RESERVED_PREFIXES):
    """The catch-all page route; include it after every other router."""
    reserved_prefixes = tuple(p.strip("/") for p in reserved if p.strip("/"))

    def spa_fallback(request: Request, rest: str = "", db: Session = Depends(get_db)) -> Any:
        settings = PlatformSettings()
        first = rest.split("/", 1)[0]
        if first in reserved_prefixes or rest.lower().endswith(_NON_ROUTE_SUFFIXES):
            # A missing built asset or API path is a plain 404; never hand index.html to a <script> tag.
            return JSONResponse({"detail": "Not found"}, status_code=404)
        if session_auth_enabled(settings) and not get_session_user_and_provider(db, request):
            return _login_redirect(request, request_root_path(request))
        return _serve_index(request, settings)

    return spa_fallback


def include_spa_fallback(app: Any, reserved: Iterable[str] = RESERVED_PREFIXES) -> None:
    """Register ``/`` and ``/{path}`` last, so every API route wins over the app."""
    handler = make_fallback_route(reserved)
    app.add_api_route("/", handler, methods=["GET"], response_model=None, include_in_schema=False)
    app.add_api_route("/{rest:path}", handler, methods=["GET"], response_model=None, include_in_schema=False)
