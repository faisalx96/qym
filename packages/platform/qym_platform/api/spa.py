"""Serve the React SPA (``frontend/``, built to ``_static/app/``) under ``/app``.

History-API fallback: every ``/app/*`` path that is not a built asset returns
``index.html`` so client-side routes deep-link. The page carries the runtime
bootstrap the client needs (``window.__QYM_APP__``: root path, auth mode,
environment) and a ``<base href>`` so relative asset URLs resolve under
``QYM_ROOT_PATH``/``QYM_MAIN_PREFIX``.

Guards mirror the legacy pages: an unauthenticated session is bounced to the
SPA login route before the bundle loads; ``/app/login`` sends a signed-in user
on to ``next``. Nothing here answers for ``/v1``, ``/api``, ``/static``,
``/ui``, ``/healthz``, ``/api-docs``, ``/ingestion`` or ``/workers``: those
prefixes are registered on their own routers and never reach this one, and a
path with a file extension under ``/app`` is a 404, never ``index.html``.
"""

from __future__ import annotations

import html as html_lib
import json
from pathlib import Path
from typing import Any
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

SPA_PREFIX = "/app"
SPA_ASSETS_PREFIX = "/app/assets/"
BOOTSTRAP_MARKER = "<!--__QYM_APP_BOOTSTRAP__-->"
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
    base = f'<base href="{html_lib.escape(root + SPA_PREFIX + "/", quote=True)}">'
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
    next_value = sanitize_next(full_path, default=f"{root}{SPA_PREFIX}/")
    return RedirectResponse(url=f"{root}{SPA_PREFIX}/login?next={quote(next_value, safe='/')}", status_code=303)


def _serve_index(request: Request, settings: PlatformSettings) -> HTMLResponse:
    idx = spa_index()
    if not idx.exists():
        raise HTTPException(
            status_code=404,
            detail="The app bundle is not built. Run `npm run build` in frontend/ (or use the Vite dev server).",
        )
    root = request_root_path(request)
    return HTMLResponse(render_spa_index(idx.read_text(encoding="utf-8"), settings, root), media_type="text/html; charset=utf-8")


@router.get(f"{SPA_PREFIX}/login", response_model=None, include_in_schema=False)
def spa_login(request: Request, db: Session = Depends(get_db)) -> Any:
    settings = PlatformSettings()
    if session_auth_enabled(settings) and get_session_user_and_provider(db, request):
        root = request_root_path(request)
        target = sanitize_next(request.query_params.get("next"), default=f"{root}{SPA_PREFIX}/")
        return RedirectResponse(url=target, status_code=303)
    return _serve_index(request, settings)


@router.get(SPA_PREFIX, response_model=None, include_in_schema=False)
@router.get(f"{SPA_PREFIX}/", response_model=None, include_in_schema=False)
@router.get(SPA_PREFIX + "/{rest:path}", response_model=None, include_in_schema=False)
def spa_fallback(request: Request, rest: str = "", db: Session = Depends(get_db)) -> Any:
    settings = PlatformSettings()
    if rest.startswith("assets/") or rest.lower().endswith(_NON_ROUTE_SUFFIXES):
        # A missing built asset is a plain 404; never hand index.html to a <script> tag.
        return JSONResponse({"detail": "Not found"}, status_code=404)
    if session_auth_enabled(settings) and not get_session_user_and_provider(db, request):
        return _login_redirect(request, request_root_path(request))
    return _serve_index(request, settings)

