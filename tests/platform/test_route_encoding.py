"""Large-dict routes declare their return type, so FastAPI encodes them on the pydantic-core path (C193)."""

from _helpers import api_routes
from qym_platform.app import create_app

ANNOTATED = {
    ("GET", "/api/dashboard/runs"),
    ("POST", "/api/dashboard/runs"),
    ("GET", "/api/runs/{run_id}/spans"),
    ("GET", "/api/runs/{run_id}/items/{item_id}/spans"),
    ("GET", "/api/runs/step-latency"),
    ("GET", "/api/runs/{run_id}/step-latency"),
}


def test_large_dict_routes_have_a_response_field():
    app = create_app()
    found = {}
    for path, route in api_routes(app.routes):
        for method in route.methods:
            if (method, path) in ANNOTATED:
                found[(method, path)] = route.response_field is not None
    assert set(found) == ANNOTATED, sorted(ANNOTATED - set(found))
    assert all(found.values()), found
