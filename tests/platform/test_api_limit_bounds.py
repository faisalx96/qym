"""A negative or zero page size is a client error (422), not a server error (C191)."""

import pytest
from _helpers import api_routes
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def bare_client(session_factory):
    """The runs and datasets routers alone, with auth stubbed: only query validation answers."""
    from qym_platform.api import datasets, runs
    from qym_platform.auth import require_ui_principal
    from qym_platform.deps import get_db

    app = FastAPI()
    app.include_router(runs.router)
    app.include_router(datasets.router)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_ui_principal] = lambda: object()
    app.dependency_overrides[datasets.dataset_principal] = lambda: object()
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize(
    "path",
    [
        "/api/runs?limit=-1",
        "/api/runs?limit=0",
        "/v1/datasets/any/versions/v1/items?limit=-1",
        "/v1/datasets/any/versions/v1/items?limit=0",
    ],
)
def test_limit_below_one_is_422(bare_client, path):
    response = bare_client.get(path)
    assert response.status_code == 422, response.text


def test_every_limit_and_offset_query_has_a_lower_bound():
    """Each limit or offset query parameter declares ge, so FastAPI answers 422 for bad values."""
    import inspect

    from fastapi.params import Query as QueryParam

    from qym_platform.app import create_app

    app = create_app()
    missing = []
    for _, route in api_routes(app.routes):
        endpoint = route.endpoint
        for name, param in inspect.signature(endpoint).parameters.items():
            if not (name.endswith("limit") or name.endswith("offset")):
                continue
            default = param.default
            if isinstance(default, QueryParam):
                bounds = [m for m in default.metadata if hasattr(m, "ge") or hasattr(m, "gt")]
                if not bounds:
                    missing.append(f"{getattr(route, 'path', '?')} {name}")
    assert not missing, missing
