from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from qym_platform.app import create_app, create_ingestion_app, create_workers_app
from qym_platform.service_layout import resolve_layout
from qym_platform.settings import PlatformSettings


def build_app() -> FastAPI:
    """The ASGI app of this process's service (``QYM_SERVICE``, else ``QYM_ROLE``).

    ``all``/``main``: the full platform under ``QYM_ROOT_PATH`` +
    ``QYM_MAIN_PREFIX``. ``ingestion``/``workers``: their own small apps,
    whose routes already carry ``QYM_INGESTION_PREFIX``/``QYM_WORKERS_PREFIX``,
    under ``QYM_ROOT_PATH``.
    """
    settings = PlatformSettings()
    layout = resolve_layout(settings)
    if layout.service == "ingestion":
        inner = create_ingestion_app(settings)
        prefix = layout.root_path
    elif layout.service == "workers":
        inner = create_workers_app(settings)
        prefix = layout.root_path
    else:
        inner = create_app(settings)
        prefix = layout.root_path + layout.main_prefix

    if not prefix:
        return inner

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # Mounted apps do not receive ASGI lifespan events automatically.
        # Forward the full lifecycle, including worker startup and cleanup.
        async with inner.router.lifespan_context(inner) as state:
            yield state

    # Mount the real app under the prefix so the ingress path is handled.
    outer = FastAPI(lifespan=lifespan)
    if layout.service != "all" or layout.main_prefix:
        # Probes may hit the pod at plain /healthz whatever the prefix.
        from qym_platform.api.service_status import healthz_router

        outer.include_router(healthz_router(service=layout.service, environment=settings.environment))
    outer.mount(prefix, inner)
    return outer


app = build_app()
