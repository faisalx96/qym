"""Upload size limits: refused before parsing, and bounded reads (QYM_MAX_UPLOAD_BYTES)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, File, UploadFile
from fastapi.testclient import TestClient

from qym_platform.uploads import UploadLimitMiddleware, read_upload

from test_endpoint_security import _auth_headers, _seed_api_key


def _app(limit: int) -> FastAPI:
    app = FastAPI()

    @app.post("/upload")
    async def upload(file: UploadFile = File(...)):
        return {"size": len(await read_upload(file, limit))}

    app.add_middleware(UploadLimitMiddleware, max_upload_bytes=limit)
    return app


def test_middleware_refuses_bodies_over_the_limit_before_parsing():
    small = TestClient(_app(limit=10))
    ok = small.post("/upload", files={"file": ("a.csv", b"12345", "text/csv")})
    assert ok.status_code == 200 and ok.json() == {"size": 5}
    # The header check allows the multipart overhead; the read cap catches the rest.
    over_cap = small.post("/upload", files={"file": ("a.csv", b"x" * 11, "text/csv")})
    assert over_cap.status_code == 413
    huge = small.post(
        "/upload",
        files={"file": ("a.csv", b"x" * (2 * 1024 * 1024), "text/csv")},
    )
    assert huge.status_code == 413
    assert "QYM_MAX_UPLOAD_BYTES" in huge.json()["detail"]


@pytest.mark.asyncio
async def test_middleware_needs_a_content_length_for_multipart():
    middleware = UploadLimitMiddleware(app=None, max_upload_bytes=10)  # never reached
    sent = []

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "headers": [(b"content-type", b"multipart/form-data; boundary=x")],
    }
    await middleware(scope, None, send)
    assert sent[0]["status"] == 411
    # Other bodies (JSON ingest) are not this middleware's business.
    passed = []

    async def app(scope, receive, send):
        passed.append(scope)

    await UploadLimitMiddleware(app, max_upload_bytes=10)(
        {"type": "http", "headers": [(b"content-type", b"application/json")]}, None, send
    )
    assert passed


@pytest.fixture()
def small_limit(monkeypatch, session_factory):  # noqa: F811
    monkeypatch.setenv("QYM_MAX_UPLOAD_BYTES", "64")


def test_run_and_dataset_uploads_are_capped(
    small_limit, client, session_factory  # noqa: F811
):
    with session_factory() as session:
        _seed_api_key(
            session, token="cap-token", scopes=["runs:write", "datasets:write"]
        )
    body = "input,expected_output\n" + "q,a\n" * 40  # 160 bytes > 64
    run = client.post(
        "/v1/runs:upload",
        headers=_auth_headers("cap-token"),
        data={"task": "task", "dataset": "dataset", "model": "model"},
        files={"file": ("run.csv", body, "text/csv")},
    )
    assert run.status_code == 413, run.text
    dataset = client.post(
        "/v1/datasets:upload",
        headers=_auth_headers("cap-token"),
        data={"name": "capped"},
        files={"file": ("d.csv", body, "text/csv")},
    )
    assert dataset.status_code == 413, dataset.text
