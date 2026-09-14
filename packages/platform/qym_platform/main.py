from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from qym_platform.app import create_app
from qym_platform.settings import PlatformSettings


def build_app() -> FastAPI:
    settings = PlatformSettings()
    inner = create_app(settings)

    prefix = settings.root_path.rstrip("/")
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
    outer.mount(prefix, inner)
    return outer


app = build_app()
