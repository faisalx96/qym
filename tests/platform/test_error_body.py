"""One error body for /api and /v1 (C159)."""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from qym_platform.error_body import error_code, install_error_handlers
from qym_platform.middleware.request_context import RequestContextMiddleware


class Body(BaseModel):
    api_key: str
    count: int


@pytest.fixture()
def client():
    app = FastAPI()
    install_error_handlers(app)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/missing")
    def missing():
        raise HTTPException(status_code=404, detail="Run not found")

    @app.get("/long")
    def long():
        raise HTTPException(status_code=409, detail="This run is already approved, so it cannot be approved again.")

    @app.get("/structured")
    def structured():
        raise HTTPException(status_code=400, detail={"code": "https_required", "message": "An https:// URL is required."})

    @app.post("/validate")
    def validate(body: Body):
        return body

    return TestClient(app)


def test_http_errors_carry_code_message_details_request_id_and_the_old_detail(client):
    body = client.get("/missing", headers={"X-Request-ID": "req-1"}).json()
    assert body["error"] == {"code": "run_not_found", "message": "Run not found", "details": [], "request_id": "req-1"}
    assert body["detail"] == "Run not found"
    long = client.get("/long").json()
    assert long["error"]["code"] == "conflict" and long["detail"].startswith("This run")
    structured = client.get("/structured").json()["error"]
    assert structured["code"] == "https_required" and structured["message"] == "An https:// URL is required."


def test_unknown_routes_and_validation_errors_use_the_same_body(client):
    assert client.get("/no-such-route").json()["error"]["code"] == "not_found"
    response = client.post("/validate", json={"api_key": "sk-secret", "count": "x"})
    body = response.json()
    assert response.status_code == 422
    assert body["error"]["code"] == "validation_error" and body["error"]["details"] == body["detail"]
    assert "sk-secret" not in response.text


def test_codes_from_messages():
    assert error_code(403, "Admin only") == "admin_only"
    assert error_code(400, "A very long message that says much more than a code should.") == "bad_request"
