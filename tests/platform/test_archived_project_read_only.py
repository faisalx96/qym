"""An archived project is read-only everywhere.

Admins and its members still read it: its runs (list, run page, compare,
review history, exports), dashboard, datasets and settings, by slug or by id.
Every write answers 409 "Project is archived; unarchive it to make changes"
through one helper, permissions.require_project_writable, and its API keys
keep answering 409. Non-members still get "Project not found" (404), as
before. Revoking a key and removing a member stay allowed.

``test_every_write_route_is_classified`` is the guard that keeps it that way:
a new POST/PUT/PATCH/DELETE route fails it until it is listed below as refused,
hidden, API-key-only or deliberately allowed.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.auth import clear_api_key_cache
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalyzerDocument,
    ApiKey,
    Approval,
    Project,
    ProjectLlmConnection,
    ProjectMembership,
    ProjectRole,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.permissions import (
    ARCHIVED_PROJECT_DETAIL,
    PROJECT_STATE_HEADER,
    require_project_writable,
)
from qym_platform.security import api_key_prefix, hash_api_key

ORIGIN = "http://localhost:8000"
ADMIN = {"X-User-Email": "admin@x.com", "Origin": ORIGIN}
MGR = {"X-User-Email": "mgr@x.com", "Origin": ORIGIN}
MEMBER = {"X-User-Email": "member@x.com", "Origin": ORIGIN}
OUTSIDER = {"X-User-Email": "outsider@x.com", "Origin": ORIGIN}
KEY_TOKEN = "tok-archived-project-key"
KEY = {"Authorization": f"Bearer {KEY_TOKEN}"}


def _run(run_id: str, **fields) -> Run:
    values = dict(
        id=run_id,
        project_id="pa",
        created_by_user_id="mgr",
        owner_user_id="mgr",
        task="t",
        dataset="d",
        metrics=["m"],
        run_metadata={},
        run_config={"run_name": run_id},
        status=RunWorkflowStatus.COMPLETED,
    )
    values.update(fields)
    return Run(**values)


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    clear_api_key_cache()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
                User(id="member", email="member@x.com", role=UserRole.MEMBER),
                User(id="outsider", email="outsider@x.com", role=UserRole.MEMBER),
                Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin", is_active=True),
            ]
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER),
                ProjectMembership(project_id="pa", user_id="member", role=ProjectRole.MEMBER),
                _run("r1"),
                _run("r-trash", deleted_at=datetime.utcnow()),
                _run("r-review", status=RunWorkflowStatus.SUBMITTED),
                ApiKey(
                    id="key-mgr",
                    user_id="mgr",
                    project_id="pa",
                    name="ci",
                    prefix=api_key_prefix(KEY_TOKEN),
                    key_hash=hash_api_key(KEY_TOKEN),
                    scopes=[],
                ),
                ProjectLlmConnection(id="llm1", project_id="pa", name="default", is_default=True),
                AnalyzerDocument(
                    id="doc1",
                    project_id="pa",
                    uploaded_by_user_id="mgr",
                    name="guide.md",
                    content="text",
                    characters=4,
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                RunItem(run_id="r1", item_id="i1", index=0, input="q", output="a"),
                RunItemScore(run_id="r1", item_id="i1", metric_name="m", score_numeric=0.5),
                Approval(run_id="r-review", submitted_by_user_id="mgr"),
                ReviewCorrection(
                    id=1,
                    run_id="r1",
                    item_id="i1",
                    metric_name="m",
                    task="t",
                    ai_root_cause="format",
                    human_root_cause="format",
                ),
            ]
        )
        db.commit()
    try:
        yield factory
    finally:
        clear_api_key_cache()
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def archived(client):
    response = client.post("/v1/admin/projects/pa/archive", headers=ADMIN)
    assert response.status_code == 200
    return client


def _call(client, method, path, kwargs, headers):
    return client.request(method, path, headers=headers, **(kwargs or {}))


# ── Route inventory ──────────────────────────────────────────────────────────
# (method, route template, concrete path, request kwargs, caller headers)

_FILE = {"files": {"file": ("notes.md", b"text", "text/markdown")}}

REFUSED = [
    # Runs: review workflow, score and diagnosis edits, delete/restore.
    ("POST", "/v1/runs/{run_id}/submit", "/v1/runs/r1/submit", None, MGR),
    ("POST", "/v1/runs/{run_id}/approve", "/v1/runs/r-review/approve", {"json": {}}, MGR),
    ("POST", "/v1/runs/{run_id}/reject", "/v1/runs/r-review/reject", {"json": {}}, MGR),
    ("POST", "/v1/runs/{run_id}/unapprove", "/v1/runs/r-review/unapprove", None, MGR),
    ("POST", "/v1/runs/{run_id}/unreject", "/v1/runs/r-review/unreject", None, MGR),
    (
        "POST",
        "/api/runs/update_metric",
        "/api/runs/update_metric",
        {"json": {"file_path": "r1", "row_index": 0, "metric_name": "m", "new_score": 0.9}},
        MGR,
    ),
    (
        "POST",
        "/api/runs/update_root_cause_issue",
        "/api/runs/update_root_cause_issue",
        {"json": {"run_id": "r1", "item_id": "i1", "metric_name": "m", "action": "approve"}},
        MGR,
    ),
    (
        "POST",
        "/api/runs/update_root_cause",
        "/api/runs/update_root_cause",
        {"json": {"run_id": "r1", "item_id": "i1", "root_cause": "format"}},
        MGR,
    ),
    ("POST", "/api/runs/delete", "/api/runs/delete", {"json": {"file_path": "r1"}}, MGR),
    ("POST", "/api/runs/restore", "/api/runs/restore", {"json": {"run_id": "r-trash"}}, ADMIN),
    ("POST", "/api/runs/{run_id}/force-stop", "/api/runs/r1/force-stop", None, ADMIN),
    ("DELETE", "/api/runs/{run_id}/passes/{pass_number}", "/api/runs/r1/passes/1", None, MGR),
    ("DELETE", "/api/runs/{run_id}/passes", "/api/runs/r1/passes", {"json": {"pass_numbers": [1]}}, MGR),
    # Analysis and diagnosis writes addressed by run id.
    ("POST", "/api/runs/{run_id:path}/aggregate-analysis", "/api/runs/r1/aggregate-analysis", {"json": {}}, MGR),
    ("POST", "/api/runs/{run_id:path}/analysis-jobs", "/api/runs/r1/analysis-jobs", {"json": {}}, MGR),
    ("POST", "/api/runs/{run_id:path}/analyze", "/api/runs/r1/analyze", {"json": {}}, MGR),
    ("POST", "/api/runs/{run_id:path}/analyze-stream", "/api/runs/r1/analyze-stream", {"json": {}}, MGR),
    ("POST", "/api/runs/{run_id:path}/analysis-documents", "/api/runs/r1/analysis-documents", _FILE, MGR),
    (
        "PATCH",
        "/api/runs/{run_id:path}/analysis-documents/{document_id}",
        "/api/runs/r1/analysis-documents/doc1",
        {"json": {"selected": False}},
        MGR,
    ),
    (
        "DELETE",
        "/api/runs/{run_id:path}/analysis-documents/{document_id}",
        "/api/runs/r1/analysis-documents/doc1",
        None,
        MGR,
    ),
    ("PATCH", "/api/runs/{run_id:path}/analysis-context", "/api/runs/r1/analysis-context", {"json": {}}, MGR),
    ("POST", "/api/runs/{run_id:path}/analysis-rules/infer", "/api/runs/r1/analysis-rules/infer", {"json": {}}, MGR),
    ("POST", "/api/runs/{run_id:path}/analysis-rule-jobs", "/api/runs/r1/analysis-rule-jobs", {"json": {}}, MGR),
    (
        "POST",
        "/api/runs/{run_id:path}/analysis-rule-versions",
        "/api/runs/r1/analysis-rule-versions",
        {"json": {}},
        MGR,
    ),
    (
        "POST",
        "/api/runs/{run_id:path}/analysis-rule-versions/{version_ref}:publish",
        "/api/runs/r1/analysis-rule-versions/1:publish",
        {"json": {}},
        MGR,
    ),
    (
        "POST",
        "/api/runs/{run_id:path}/analysis-rule-aliases/{alias_name}",
        "/api/runs/r1/analysis-rule-aliases/production",
        {"json": {"version": "1"}},
        MGR,
    ),
    (
        "POST",
        "/api/runs/{run_id:path}/analysis-rule-versions/{target_ref}:merge",
        "/api/runs/r1/analysis-rule-versions/1:merge",
        {"json": {"source_version": "2"}},
        MGR,
    ),
    (
        "POST",
        "/api/runs/{run_id:path}/analysis-rule-versions/{version_id}/activate",
        "/api/runs/r1/analysis-rule-versions/v1/activate",
        None,
        MGR,
    ),
    (
        "DELETE",
        "/api/runs/{run_id:path}/analysis-rule-versions/{version_id}",
        "/api/runs/r1/analysis-rule-versions/v1",
        None,
        MGR,
    ),
    (
        "POST",
        "/api/runs/{run_id:path}/analysis-rule-versions/{version_id}/restore",
        "/api/runs/r1/analysis-rule-versions/v1/restore",
        None,
        ADMIN,
    ),
    (
        "DELETE",
        "/api/runs/{run_id:path}/analysis-rule-versions/{version_id}/permanent",
        "/api/runs/r1/analysis-rule-versions/v1/permanent",
        None,
        ADMIN,
    ),
    # Review corrections (reviews page and run page).
    ("PUT", "/api/corrections/{correction_id}", "/api/corrections/1", {"json": {"human_root_cause": "x"}}, MGR),
    ("POST", "/api/corrections/{correction_id}/approve", "/api/corrections/1/approve", {"json": {}}, MGR),
    (
        "POST",
        "/api/corrections/approve-metric-analysis",
        "/api/corrections/approve-metric-analysis",
        {"json": {"run_id": "r1", "item_id": "i1", "metric_name": "m"}},
        MGR,
    ),
    ("POST", "/api/corrections/{correction_id}/reject", "/api/corrections/1/reject", {"json": {}}, MGR),
    ("POST", "/api/corrections/{correction_id}/reset", "/api/corrections/1/reset", None, MGR),
    ("POST", "/api/corrections/bulk", "/api/corrections/bulk", {"json": {"ids": [1], "action": "approve"}}, MGR),
    ("DELETE", "/api/corrections/{correction_id}", "/api/corrections/1", None, MGR),
    # Project settings addressed by project id.
    ("POST", "/v1/projects/{project_id}/api-keys", "/v1/projects/pa/api-keys", {"json": {"name": "new"}}, MGR),
    ("POST", "/v1/projects/{project_id}/members", "/v1/projects/pa/members", {"json": {"user_id": "outsider"}}, MGR),
    (
        "PATCH",
        "/v1/projects/{project_id}/members/{user_id}",
        "/v1/projects/pa/members/member",
        {"json": {"role": "MANAGER"}},
        MGR,
    ),
    ("POST", "/v1/projects/{project_id}/llm-connections", "/v1/projects/pa/llm-connections", {"json": {"name": "b"}}, MGR),
    (
        "PUT",
        "/v1/projects/{project_id}/llm-connections/{connection_id}",
        "/v1/projects/pa/llm-connections/llm1",
        {"json": {"name": "renamed"}},
        MGR,
    ),
    (
        "DELETE",
        "/v1/projects/{project_id}/llm-connections/{connection_id}",
        "/v1/projects/pa/llm-connections/llm1",
        None,
        MGR,
    ),
    (
        "POST",
        "/v1/projects/{project_id}/llm-connections/{connection_id}/set-default",
        "/v1/projects/pa/llm-connections/llm1/set-default",
        None,
        MGR,
    ),
    (
        "PUT",
        "/v1/projects/{project_id}/analysis-prompts",
        "/v1/projects/pa/analysis-prompts",
        {"json": {"llm_analyzer": "a", "aggregator": "b", "rules_writer": "c"}},
        MGR,
    ),
    (
        "PATCH",
        "/v1/projects/{project_id}/analysis-prompts/{prompt_key}",
        "/v1/projects/pa/analysis-prompts/aggregator",
        {"json": {"value": "b"}},
        MGR,
    ),
]

_P = "/api/projects/{project_slug}"
_Q = "?project_slug=pa"
# Project-slug writes. The archived project is readable to its members, so
# its writes reach the shared 409 like every other write.
PROJECT_SLUG_WRITES = [
    ("PUT", f"{_P}/analysis-category-catalog", "/api/projects/pa/analysis-category-catalog", {"json": {}}, MGR),
    (
        "POST",
        f"{_P}/analysis-category-catalog/versions/{{version_id}}:restore",
        "/api/projects/pa/analysis-category-catalog/versions/c1:restore",
        {"json": {}},
        MGR,
    ),
    (
        "POST",
        f"{_P}/analysis-category-catalog/{{version_ref}}/restore",
        "/api/projects/pa/analysis-category-catalog/1/restore",
        {"json": {}},
        MGR,
    ),
    ("POST", f"{_P}/analysis-documents", "/api/projects/pa/analysis-documents", _FILE, MGR),
    (
        "PATCH",
        f"{_P}/analysis-documents/{{document_id}}",
        "/api/projects/pa/analysis-documents/doc1",
        {"json": {"selected": False}},
        MGR,
    ),
    ("DELETE", f"{_P}/analysis-documents/{{document_id}}", "/api/projects/pa/analysis-documents/doc1", None, MGR),
    ("PATCH", f"{_P}/analysis-context", "/api/projects/pa/analysis-context", {"json": {}}, MGR),
    ("POST", f"{_P}/analysis-rules/infer", "/api/projects/pa/analysis-rules/infer", {"json": {}}, MGR),
    ("POST", f"{_P}/analysis-rule-jobs", "/api/projects/pa/analysis-rule-jobs", {"json": {}}, MGR),
    ("POST", f"{_P}/analysis-rule-versions", "/api/projects/pa/analysis-rule-versions", {"json": {}}, MGR),
    (
        "POST",
        f"{_P}/analysis-rule-versions/{{version_ref}}:publish",
        "/api/projects/pa/analysis-rule-versions/1:publish",
        {"json": {}},
        MGR,
    ),
    (
        "POST",
        f"{_P}/analysis-rule-aliases/{{alias_name}}",
        "/api/projects/pa/analysis-rule-aliases/production",
        {"json": {"version": "1"}},
        MGR,
    ),
    (
        "POST",
        f"{_P}/analysis-rule-versions/{{target_ref}}:merge",
        "/api/projects/pa/analysis-rule-versions/1:merge",
        {"json": {"source_version": "2"}},
        MGR,
    ),
    (
        "POST",
        f"{_P}/analysis-rule-versions/{{version_id}}/activate",
        "/api/projects/pa/analysis-rule-versions/v1/activate",
        None,
        MGR,
    ),
    ("DELETE", f"{_P}/analysis-rule-versions/{{version_id}}", "/api/projects/pa/analysis-rule-versions/v1", None, MGR),
    (
        "POST",
        f"{_P}/analysis-rule-versions/{{version_id}}/restore",
        "/api/projects/pa/analysis-rule-versions/v1/restore",
        None,
        ADMIN,
    ),
    (
        "DELETE",
        f"{_P}/analysis-rule-versions/{{version_id}}/permanent",
        "/api/projects/pa/analysis-rule-versions/v1/permanent",
        None,
        ADMIN,
    ),
]

# Dataset writes by a UI session naming the project (API keys get 409 below).
DATASET_WRITES = [
    ("POST", "/v1/datasets", "/v1/datasets", {"json": {"name": "n", "project_slug": "pa"}}, MGR),
    ("PATCH", "/v1/datasets/{dataset_ref}", "/v1/datasets/golden" + _Q, {"json": {}}, MGR),
    ("DELETE", "/v1/datasets/{dataset_ref}", "/v1/datasets/golden" + _Q, None, MGR),
    ("POST", "/v1/datasets/{dataset_ref}/versions", "/v1/datasets/golden/versions" + _Q, {"json": {}}, MGR),
    (
        "POST",
        "/v1/datasets/{dataset_ref}/versions/{version_ref}:publish",
        "/v1/datasets/golden/versions/v1:publish" + _Q,
        {"json": {}},
        MGR,
    ),
    (
        "PATCH",
        "/v1/datasets/{dataset_ref}/versions/{version_ref}",
        "/v1/datasets/golden/versions/v1" + _Q,
        {"json": {}},
        MGR,
    ),
    (
        "POST",
        "/v1/datasets/{dataset_ref}/aliases/{alias_name}",
        "/v1/datasets/golden/aliases/production" + _Q,
        {"json": {"version": "v1"}},
        MGR,
    ),
    (
        "POST",
        "/v1/datasets/{dataset_ref}/versions/{version_ref}/items",
        "/v1/datasets/golden/versions/v1/items" + _Q,
        {"json": {"input": "q"}},
        MGR,
    ),
    (
        "PATCH",
        "/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}",
        "/v1/datasets/golden/versions/v1/items/i1" + _Q,
        {"json": {}},
        MGR,
    ),
    (
        "DELETE",
        "/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}",
        "/v1/datasets/golden/versions/v1/items/i1" + _Q,
        None,
        MGR,
    ),
    (
        "POST",
        "/v1/datasets/{dataset_ref}/versions/{version_ref}/items:bulk",
        "/v1/datasets/golden/versions/v1/items:bulk" + _Q,
        {"json": {}},
        MGR,
    ),
    (
        "POST",
        "/v1/datasets:upload",
        "/v1/datasets:upload",
        {"data": {"name": "n", "project_slug": "pa"}, "files": {"file": ("d.csv", b"input\nq\n", "text/csv")}},
        MGR,
    ),
]

REFUSED += PROJECT_SLUG_WRITES + DATASET_WRITES

# Routes only an API key can call: the key itself is refused (C023).
KEY_ONLY = [
    ("POST", "/v1/runs", "/v1/runs", {"json": {"task": "t", "dataset": "d"}}),
    ("POST", "/v1/runs/{run_id}/events", "/v1/runs/r1/events", {"content": b""}),
    (
        "POST",
        "/v1/runs:upload",
        "/v1/runs:upload",
        {"data": {"task": "t", "dataset": "d"}, "files": {"file": ("r.csv", b"input\nq\n", "text/csv")}},
    ),
    ("POST", "/v1/product-evals", "/v1/product-evals", {"json": {}}),
    ("POST", "/v1/product-evals/jobs/{job_id}/stop", "/v1/product-evals/jobs/j1/stop", None),
    ("POST", "/v1/product-evals/{identifier}/stop", "/v1/product-evals/r1/stop", None),
]

# Allowed on purpose, with the reason.
ALLOWED = {
    # Not project data: sign-in, users, new projects, platform maintenance.
    ("POST", "/v1/auth/login/password"): "sign-in",
    ("POST", "/v1/auth/signup/password"): "sign-up",
    ("POST", "/v1/auth/logout"): "sign-out",
    ("POST", "/v1/auth/password/change"): "own password",
    ("POST", "/v1/auth/bootstrap-admin"): "first admin",
    ("POST", "/v1/admin/users"): "user admin",
    ("PUT", "/v1/admin/users/{user_id}"): "user admin",
    ("DELETE", "/v1/admin/users/{user_id}"): "user admin",
    ("POST", "/v1/admin/users/{user_id}/reset-password"): "user admin",
    ("POST", "/v1/projects"): "creates a new project",
    ("POST", "/v1/admin/projects"): "creates a new project",
    ("POST", "/api/admin/maintenance/jobs"): "platform maintenance",
    ("POST", "/api/admin/maintenance/jobs/{job_id}/start"): "platform maintenance",
    ("POST", "/api/admin/maintenance/jobs/{job_id}/cancel"): "platform maintenance",
    # The admin project lifecycle: archive, unarchive, rename, delete.
    ("PATCH", "/v1/admin/projects/{project_id}"): "admin lifecycle",
    ("POST", "/v1/admin/projects/{project_id}/archive"): "admin lifecycle",
    ("POST", "/v1/admin/projects/{project_id}/unarchive"): "admin lifecycle",
    ("DELETE", "/v1/admin/projects/{project_id}"): "admin lifecycle",
    # Reads sent as POST (large filters and id lists).
    ("POST", "/api/projects/{project_slug}/analysis-examples"): "read",
    ("POST", "/api/dashboard/models"): "read",
    ("POST", "/api/dashboard/runs"): "read",
    ("POST", "/api/dashboard/overview"): "read",
    ("POST", "/api/dashboard/kpis"): "read",
    ("POST", "/api/dashboard/points"): "read",
    ("POST", "/api/runs/{run_id}/items/details"): "read",
    ("POST", "/api/runs/{run_id}/items/search"): "read",
    ("POST", "/api/runs/{run_id:path}/analysis-examples"): "read",
    ("POST", "/api/runs/{run_id:path}/analyze-preview"): "read (prompt preview)",
    # Dry runs that store nothing.
    ("POST", "/api/runs/{run_id:path}/analyze-test"): "dry run, stores nothing",
    ("POST", "/v1/projects/{project_id}/llm-connections/{connection_id}/test"): "dry run, stores nothing",
    # Taking access or work away stays possible without unarchiving (which
    # would switch the project's API keys back on).
    ("DELETE", "/v1/projects/{project_id}/members/{user_id}"): "removes access",
    ("DELETE", "/v1/projects/{project_id}/api-keys/{key_id}"): "revokes a key",
    ("POST", "/api/runs/{run_id:path}/analysis-jobs/{job_id}/cancel"): "stops a running job",
    ("POST", "/api/runs/{run_id:path}/analysis-rule-jobs/{job_id}/cancel"): "stops a running job",
    ("POST", "/api/projects/{project_slug}/analysis-rule-jobs/{job_id}/cancel"): "stops a running job",
}


def _ids(rows):
    return [f"{row[0]} {row[1]}" for row in rows]


def test_every_write_route_is_classified():
    """A new write route must be listed as refused, key-only or allowed."""
    app = create_app()
    routes = {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods - {"GET", "HEAD", "OPTIONS"}
    }
    classified = [
        *((m, t) for m, t, *_ in REFUSED),
        *((m, t) for m, t, *_ in KEY_ONLY),
        *ALLOWED,
    ]
    assert len(classified) == len(set(classified)), "a route is listed twice"
    unclassified = sorted(routes - set(classified))
    stale = sorted(set(classified) - routes)
    assert not unclassified, (
        "New write routes: call permissions.require_project_writable after the "
        f"access check and list them in REFUSED (or justify them in ALLOWED): {unclassified}"
    )
    assert not stale, f"Listed routes that no longer exist: {stale}"


@pytest.mark.parametrize("method,template,path,kwargs,headers", REFUSED, ids=_ids(REFUSED))
def test_writes_to_an_archived_project_are_refused(archived, method, template, path, kwargs, headers):
    response = _call(archived, method, path, kwargs, headers)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == ARCHIVED_PROJECT_DETAIL
    assert response.headers[PROJECT_STATE_HEADER] == "archived"


@pytest.mark.parametrize("method,template,path,kwargs,headers", REFUSED, ids=_ids(REFUSED))
def test_the_same_writes_still_reach_their_handler_on_an_active_project(
    client, method, template, path, kwargs, headers
):
    """The refusal comes from the archive, not from the request shape."""
    response = _call(client, method, path, kwargs, headers)
    assert response.headers.get(PROJECT_STATE_HEADER) is None
    assert response.json().get("detail") != ARCHIVED_PROJECT_DETAIL


_SLUG_WRITES = PROJECT_SLUG_WRITES + DATASET_WRITES


@pytest.mark.parametrize("method,template,path,kwargs,headers", _SLUG_WRITES, ids=_ids(_SLUG_WRITES))
def test_project_slug_writes_hide_an_archived_project_from_non_members(
    archived, method, template, path, kwargs, headers
):
    """A non-member learns nothing new: the archived project stays "not found"."""
    response = _call(archived, method, path, kwargs, OUTSIDER)
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Project not found"


_DATASET_KEY_WRITES = [row[:4] for row in DATASET_WRITES]


@pytest.mark.parametrize("method,template,path,kwargs", [*_DATASET_KEY_WRITES, *KEY_ONLY], ids=_ids([*_DATASET_KEY_WRITES, *KEY_ONLY]))
def test_api_key_writes_to_an_archived_project_are_refused(archived, method, template, path, kwargs):
    response = _call(archived, method, path, kwargs, KEY)
    assert response.status_code == 409, response.text
    assert response.headers["X-Qym-Key-State"] == "project_archived"


def test_refused_writes_change_nothing(archived, session_factory):
    edits = [
        ("POST", "/api/runs/update_metric", {"json": {"file_path": "r1", "row_index": 0, "metric_name": "m", "new_score": 0.9}}),
        ("POST", "/api/runs/delete", {"json": {"file_path": "r1"}}),
        ("POST", "/v1/runs/r1/submit", None),
        ("POST", "/v1/projects/pa/api-keys", {"json": {"name": "new"}}),
        ("POST", "/api/corrections/1/approve", {"json": {}}),
    ]
    for method, path, kwargs in edits:
        assert _call(archived, method, path, kwargs, MGR).status_code == 409
    with session_factory() as db:
        run = db.get(Run, "r1")
        assert run.deleted_at is None
        assert run.status == RunWorkflowStatus.COMPLETED
        score = db.query(RunItemScore).filter_by(run_id="r1", item_id="i1", metric_name="m").one()
        assert score.score_numeric == 0.5
        assert db.query(ApiKey).filter(ApiKey.project_id == "pa").count() == 1
        assert db.get(ReviewCorrection, 1).status.value == "pending"


def test_non_members_still_get_403_not_the_archive_state(archived):
    response = archived.post(
        "/api/runs/update_metric",
        headers=OUTSIDER,
        json={"file_path": "r1", "row_index": 0, "metric_name": "m", "new_score": 0.9},
    )
    assert response.status_code == 403
    assert archived.post("/v1/projects/pa/api-keys", headers=OUTSIDER, json={"name": "k"}).status_code == 403


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("GET", "/api/runs/r1", None),
        ("GET", "/api/runs/r1?view=compact", None),
        ("GET", "/api/compare?files=r1", None),
        ("GET", "/api/runs/r1/review-history", None),
        ("GET", "/api/runs/r1/export-html", None),
        ("GET", "/api/runs/r1/passes", None),
        ("GET", "/v1/projects/pa", None),
        ("GET", "/v1/projects/pa/api-keys", None),
        ("POST", "/api/runs/r1/items/details", {"json": {"item_ids": ["i1"]}}),
        (
            "POST",
            "/api/runs/r1/items/search",
            {"json": {"conditions": [{"id": "c1", "field": "all", "value": "q"}]}},
        ),
        ("POST", "/api/runs/r1/analysis-examples", {"json": {}}),
    ],
)
def test_reads_of_an_archived_project_keep_working(archived, method, path, kwargs):
    response = _call(archived, method, path, kwargs, MGR)
    assert response.status_code == 200, response.text
    if path.startswith("/api/runs/r1") and method == "GET" and "export" not in path and "passes" not in path and "history" not in path:
        assert response.json()["run"]["project"]["archived"] is True


def test_run_payload_marks_the_project_archived_only_when_it_is(client):
    assert client.get("/api/runs/r1", headers=MGR).json()["run"]["project"]["archived"] is False
    client.post("/v1/admin/projects/pa/archive", headers=ADMIN)
    assert client.get("/api/runs/r1", headers=MGR).json()["run"]["project"]["archived"] is True
    compare = client.get("/api/compare?files=r1", headers=MGR).json()
    assert compare["runs"][0]["run"]["project"]["archived"] is True


def test_access_removal_and_job_cancel_stay_allowed(archived, session_factory):
    revoked = archived.delete("/v1/projects/pa/api-keys/key-mgr", headers=MGR)
    assert revoked.status_code == 200, revoked.text
    removed = archived.delete("/v1/projects/pa/members/member", headers=MGR)
    assert removed.status_code == 200, removed.text
    # No job exists: the answer is "not found", never the archive refusal.
    for path in (
        "/api/runs/r1/analysis-jobs/j1/cancel",
        "/api/runs/r1/analysis-rule-jobs/j1/cancel",
    ):
        response = archived.post(path, headers=MGR)
        assert response.status_code == 404, response.text
    with session_factory() as db:
        assert db.get(ApiKey, "key-mgr").revoked_at is not None
        assert db.query(ProjectMembership).filter_by(project_id="pa", user_id="member").count() == 0


def test_archiving_stops_the_projects_running_jobs(client, session_factory):
    """Archived keys cannot call the product-eval stop routes, and nothing an
    analysis job produces can be saved: archiving stops that work itself."""
    from qym_platform.api.product_evals import job_manager
    from qym_platform.services.analysis_jobs import (
        AnalysisJob,
        analysis_job_manager,
        rule_inference_job_manager,
    )
    from qym_platform.services.product_evals import ProductEvalJob

    with session_factory() as db:
        db.add(_run("r-live", status=RunWorkflowStatus.RUNNING, started_at=datetime.utcnow()))
        db.commit()
    evals = {
        "pa": ProductEvalJob(job_id="eval_pa", preset="p", project_id="pa", status="RUNNING"),
        "other": ProductEvalJob(job_id="eval_other", preset="p", project_id="other", status="RUNNING"),
    }
    evals["pa"].runs.append({"attempt": 1, "qym_run_id": "r-live", "status": "RUNNING"})

    def analysis(job_id, scope):
        return AnalysisJob(
            run_id=scope, user_id="mgr", auth_type="ui", request_payload={}, job_id=job_id, status="running"
        )

    analyses = {"run": analysis("an_pa", "r1"), "other": analysis("an_other", "elsewhere")}
    rules = {"project": analysis("rule_pa", "project:pa"), "other": analysis("rule_other", "project:pb")}
    for job in evals.values():
        job_manager._jobs[job.job_id] = job
    for manager, jobs in ((analysis_job_manager, analyses), (rule_inference_job_manager, rules)):
        for job in jobs.values():
            manager._jobs[job.job_id] = job
    try:
        response = client.post("/v1/admin/projects/pa/archive", headers=ADMIN)
        assert response.status_code == 200, response.text
        assert evals["pa"].stop_requested() and evals["pa"].to_dict()["status"] == "STOPPED"
        assert not evals["other"].stop_requested()
        assert analyses["run"].cancel_requested and analyses["run"].status == "cancelled"
        assert rules["project"].cancel_requested
        assert analyses["other"].status == "running" and rules["other"].status == "running"
        with session_factory() as db:
            live = db.get(Run, "r-live")
            assert live.status == RunWorkflowStatus.STOPPED
            assert live.status_reason == "product_eval_stopped"
    finally:
        for job in evals.values():
            job_manager._jobs.pop(job.job_id, None)
        for manager, jobs in ((analysis_job_manager, analyses), (rule_inference_job_manager, rules)):
            for job in jobs.values():
                manager._jobs.pop(job.job_id, None)


def test_admin_lifecycle_stays_allowed_on_an_archived_project(archived, session_factory):
    assert archived.post("/v1/admin/projects/pa/archive", headers=ADMIN).status_code == 200
    assert archived.get("/v1/admin/projects/pa/deletion", headers=ADMIN).status_code == 200
    assert archived.post("/v1/admin/projects/pa/unarchive", headers=ADMIN).status_code == 200
    # Unarchived, writes work again.
    response = archived.post(
        "/api/runs/update_metric",
        headers=MGR,
        json={"file_path": "r1", "row_index": 0, "metric_name": "m", "new_score": 0.9},
    )
    assert response.status_code == 200, response.text

    # An archived project without runs can still be deleted.
    created = archived.post("/v1/admin/projects", headers=ADMIN, json={"name": "Empty", "slug": "empty"})
    project_id = created.json()["id"]
    assert archived.post(f"/v1/admin/projects/{project_id}/archive", headers=ADMIN).status_code == 200
    deleted = archived.delete(f"/v1/admin/projects/{project_id}?confirm=empty", headers=ADMIN)
    assert deleted.status_code == 200, deleted.text


def test_review_queue_leaves_out_archived_projects(client):
    assert client.get("/api/corrections", headers=MGR).json()["total"] == 1
    client.post("/v1/admin/projects/pa/archive", headers=ADMIN)
    assert client.get("/api/corrections", headers=MGR).json()["total"] == 0


def test_trash_marks_runs_of_archived_projects(archived):
    rows = archived.get("/api/runs/trash", headers=ADMIN).json()
    assert [(row["id"], row["project_archived"]) for row in rows] == [("r-trash", True)]


def test_helper_refuses_only_archived_projects(session_factory):
    with session_factory() as db:
        require_project_writable(db, "pa")
        require_project_writable(db, None)
        require_project_writable(db, "missing")
        db.get(Project, "pa").is_active = False
        db.commit()
        with pytest.raises(HTTPException) as exc:
            require_project_writable(db, "pa")
        assert exc.value.status_code == 409
        assert exc.value.detail == ARCHIVED_PROJECT_DETAIL


def test_analysis_saves_refuse_once_the_project_is_archived(session_factory):
    """A job that was running when the project was archived saves nothing."""
    from qym_platform.api.analysis import _lock_run_for_save, _run_analysis_job
    from qym_platform.services.analysis_jobs import AnalysisJob

    with session_factory() as db:
        run = db.get(Run, "r1")
        assert _lock_run_for_save(db, run).id == "r1"
        db.get(Project, "pa").is_active = False
        db.commit()
        with pytest.raises(HTTPException) as exc:
            _lock_run_for_save(db, db.get(Run, "r1"))
        assert exc.value.status_code == 409

    job = AnalysisJob(run_id="r1", user_id="mgr", auth_type="proxy_headers", request_payload={})
    with pytest.raises(RuntimeError, match="Project is archived"):
        asyncio.run(_run_analysis_job(job, session_factory=session_factory))


def test_pass_analysis_saves_refuse_once_the_project_is_archived(session_factory):
    """Repeat runs save diagnoses per pass; that save phase checks the archive too."""
    from qym_platform.api.analysis import (
        AnalysisResult,
        PASS_ANALYSIS_META_KEY,
        _save_pass_analysis_results,
    )
    from qym_platform.db.models import RunItemPassScore

    with session_factory() as db:
        db.add(_run("r-repeat", samples=2))
        db.flush()
        db.add(RunItem(run_id="r-repeat", item_id="i1", index=0, input="q", output="a"))
        db.add(RunItemPassScore(run_id="r-repeat", item_id="i1", metric_name="m", pass_number=1, score_numeric=0.5))
        db.commit()
        # Archived while the analyzer's model call was running.
        db.get(Project, "pa").is_active = False
        db.commit()
        result = AnalysisResult(
            item_id="i1",
            metric_name="m",
            root_cause="Hallucination",
            root_causes=["Hallucination"],
            root_cause_note="Made up an answer",
            confidence=0.9,
        )
        with pytest.raises(HTTPException) as exc:
            _save_pass_analysis_results(db, db.get(Run, "r-repeat"), [result], 1)
        assert exc.value.status_code == 409
        assert exc.value.detail == ARCHIVED_PROJECT_DETAIL
        db.rollback()
        score = db.query(RunItemPassScore).filter_by(run_id="r-repeat", pass_number=1).one()
        assert PASS_ANALYSIS_META_KEY not in (score.meta or {})


def test_rule_inference_saves_nothing_once_the_project_is_archived(client, session_factory, monkeypatch):
    """The rule writer runs for minutes; an archive in the meantime wins."""
    from qym_platform.api import analysis as analysis_api
    from qym_platform.db.models import ProjectAnalysisRuleVersion

    monkeypatch.setattr(
        analysis_api,
        "_get_llm_config",
        lambda db, project_id, connection_id=None: {"llm_model": "m", "connection_id": "llm1"},
    )
    monkeypatch.setattr(analysis_api, "build_client", lambda config: MagicMock())

    async def infer_analysis_rules(**_kwargs):
        with session_factory() as other:
            other.get(Project, "pa").is_active = False
            other.commit()
        return [{"title": "Cite evidence", "instruction": "Flag answers without evidence."}]

    monkeypatch.setattr(analysis_api, "infer_analysis_rules", infer_analysis_rules)
    response = client.post(
        "/api/runs/r1/analysis-rules/infer",
        headers=MGR,
        json={"include_documents": True, "include_examples": False},
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == ARCHIVED_PROJECT_DETAIL
    with session_factory() as db:
        assert db.query(ProjectAnalysisRuleVersion).filter_by(project_id="pa").count() == 0


# ── Run links of an archived project ─────────────────────────────────────────


_READABLE_PAGES = (
    "/projects/pa",
    "/projects/pa/overview",
    "/projects/pa/charts",
    "/projects/pa/models",
    "/projects/pa/datasets",
    "/projects/pa/datasets/golden",
    "/projects/pa/datasets/golden/compare",
    "/projects/pa/settings",
    "/projects/pa/runs/r1",
)
# Pages that exist to change things stay hidden while the project is archived.
_HIDDEN_PAGES = (
    "/projects/pa/reviews",
    "/projects/pa/analysis",
    "/projects/pa/runs/r1/analyzer",
)


@pytest.mark.parametrize("headers", [ADMIN, MGR, MEMBER], ids=["admin", "manager", "member"])
def test_project_pages_of_an_archived_project_open_read_only(archived, headers):
    for path in _READABLE_PAGES:
        response = archived.get(path, headers=headers, follow_redirects=False)
        assert response.status_code == 200, (path, response.status_code)
    for path in _HIDDEN_PAGES:
        response = archived.get(path, headers=headers, follow_redirects=False)
        assert response.status_code == 404, (path, response.status_code)
        assert "Project not found" in response.text


def test_project_pages_of_an_archived_project_stay_not_found_to_non_members(archived):
    """A non-member learns nothing new: "Project not found", as before."""
    for path in _READABLE_PAGES + _HIDDEN_PAGES:
        response = archived.get(path, headers=OUTSIDER, follow_redirects=False)
        assert response.status_code == 404, (path, response.status_code)
        assert "Project not found" in response.text
    # An active project answers a non-member "Access denied", unchanged.
    archived.post("/v1/admin/projects/pa/unarchive", headers=ADMIN)
    assert archived.get("/projects/pa/settings", headers=OUTSIDER).status_code == 403


def test_project_run_links_of_an_archived_project_open_the_run_page(archived):
    """SDK live links and bookmarks use /projects/{slug}/runs/{id}; the run page
    opens there, in the project's read-only context."""
    response = archived.get("/projects/pa/runs/r1?pass=1", headers=MGR, follow_redirects=False)
    assert response.status_code == 200, response.text
    assert 'id="run-content"' in response.text
    assert archived.get("/run/r1", headers=MGR).status_code == 200
    response = archived.get("/projects/pa/runs/r1", headers=OUTSIDER, follow_redirects=False)
    assert response.status_code == 404
    assert "Project not found" in response.text


_SLUG_READS = [
    ("GET", "/api/runs?project_slug=pa", None),
    ("GET", "/api/runs/live?project_slug=pa", None),
    ("POST", "/api/dashboard/runs", {"json": {"project_slug": "pa"}}),
    ("POST", "/api/dashboard/kpis", {"json": {"project_slug": "pa"}}),
    ("POST", "/api/dashboard/overview", {"json": {"project_slug": "pa"}}),
    ("GET", "/v1/datasets?project_slug=pa", None),
    ("GET", "/api/projects/pa/analysis-category-catalog", None),
    ("GET", "/api/projects/pa/analysis-config", None),
    ("GET", "/api/projects/pa/insights", None),
    ("GET", "/api/corrections?project_slug=pa", None),
]


@pytest.mark.parametrize("method,path,kwargs", _SLUG_READS, ids=[row[1] for row in _SLUG_READS])
def test_project_slug_reads_of_an_archived_project_serve_members(archived, method, path, kwargs):
    for headers in (MEMBER, MGR, ADMIN):
        response = _call(archived, method, path, kwargs, headers)
        assert response.status_code == 200, (headers["X-User-Email"], response.text)
    refused = _call(archived, method, path, kwargs, OUTSIDER)
    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Project not found"


def test_project_lookup_by_slug_is_unchanged_for_archived_projects(archived):
    """The shell opens an archived project from a link through this lookup."""
    for headers in (MEMBER, MGR, ADMIN):
        response = archived.get("/v1/projects/by-slug/pa", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False
    assert archived.get("/v1/projects/by-slug/pa", headers=OUTSIDER).status_code == 403


def test_archived_project_reads_return_its_data(archived, session_factory):
    runs = archived.get("/api/runs?project_slug=pa", headers=MEMBER).json()
    listed = {
        run["run_id"]
        for models in runs["tasks"].values()
        for rows in models.values()
        for run in rows
    }
    assert "r1" in listed and "r-trash" not in listed
    assert runs["project"]["slug"] == "pa"
    project = archived.get("/v1/projects/by-slug/pa", headers=MEMBER).json()
    assert project["is_active"] is False
    # The review queue left archived runs out: an empty queue, not an error.
    assert archived.get("/api/corrections?project_slug=pa", headers=MEMBER).json()["total"] == 0
    catalog = archived.get("/api/projects/pa/analysis-category-catalog", headers=MEMBER).json()
    assert "categories" in catalog
    # Settings reads by project id keep working, as before.
    for path in ("/v1/projects/pa/members", "/v1/projects/pa/api-keys", "/v1/projects/pa/llm-connections"):
        assert archived.get(path, headers=MGR).status_code == 200, path
        assert archived.get(path, headers=OUTSIDER).status_code == 403, path


def test_archived_projects_stay_out_of_the_project_switcher(archived):
    """/v1/me feeds the switcher and the landing page: active projects only."""
    for headers in (ADMIN, MGR, MEMBER):
        me = archived.get("/v1/me", headers=headers).json()
        assert "pa" not in [project["slug"] for project in me["projects"]]
    # Admin > Projects lists it, so an admin can open it from there.
    listed = archived.get("/v1/projects", headers=ADMIN).json()["projects"]
    assert [(p["slug"], p["is_active"]) for p in listed] == [("pa", False)]


def test_project_run_links_of_an_active_project_are_unchanged(client):
    response = client.get("/projects/pa/runs/r1", headers=MGR, follow_redirects=False)
    assert response.status_code == 200
    assert 'id="run-content"' in response.text


# ── Archive preview (runs that would lose results) ───────────────────────────


def _add_live_runs(session_factory, count: int, *, last_event_at: datetime | None = None) -> None:
    now = datetime.utcnow()
    with session_factory() as db:
        for index in range(count):
            db.add(
                _run(
                    f"live-{index}",
                    status=RunWorkflowStatus.RUNNING,
                    started_at=now - timedelta(minutes=index),
                    last_event_at=last_event_at or now,
                )
            )
        db.commit()


def test_archive_preview_lists_runs_still_in_progress(client, session_factory):
    _add_live_runs(session_factory, 7)
    now = datetime.utcnow()
    with session_factory() as db:
        # Not streaming: a lease that ran out, a deleted run, a finished run.
        db.add(_run("stale", status=RunWorkflowStatus.RUNNING, started_at=now, last_event_at=now - timedelta(hours=1)))
        db.add(_run("gone", status=RunWorkflowStatus.RUNNING, started_at=now, last_event_at=now, deleted_at=now))
        db.commit()

    body = client.get("/v1/admin/projects/pa/archive-preview", headers=ADMIN).json()
    assert body["running_count"] == 7
    # Newest first, capped; the dialog says "and 2 more".
    assert [row["run_id"] for row in body["running_runs"]] == [f"live-{i}" for i in range(5)]
    first = body["running_runs"][0]
    assert first["run_name"] == "live-0"
    assert first["started_at"].endswith("Z") or "+" in first["started_at"]


def test_archive_preview_leaves_out_pending_runs_that_never_started(client, session_factory):
    """No current version creates PENDING runs; an old one is not streaming."""
    now = datetime.utcnow()
    with session_factory() as db:
        db.add(_run("old-pending", status=RunWorkflowStatus.PENDING, created_at=now - timedelta(days=90)))
        db.add(_run("new-pending", status=RunWorkflowStatus.PENDING, created_at=now))
        db.commit()
    body = client.get("/v1/admin/projects/pa/archive-preview", headers=ADMIN).json()
    assert body["running_count"] == 1
    assert [row["run_id"] for row in body["running_runs"]] == ["new-pending"]


def test_archive_preview_is_empty_without_running_runs(client):
    body = client.get("/v1/admin/projects/pa/archive-preview", headers=ADMIN).json()
    assert body == {"project_id": "pa", "name": "Project A", "running_count": 0, "running_runs": []}


def test_archive_preview_is_admin_only(client):
    assert client.get("/v1/admin/projects/pa/archive-preview", headers=MGR).status_code == 403


def test_archive_dialogs_fetch_the_preview_before_archiving() -> None:
    dashboard = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
    shell = (dashboard / "shell.js").read_text(encoding="utf-8")
    for page in ("project_settings.html", "admin.html"):
        source = (dashboard / page).read_text(encoding="utf-8")
        assert "confirmArchiveProject" in source, page
    assert "/archive-preview" in shell
    assert "remaining results will be lost" in shell


def test_unarchive_dialogs_name_the_keys_first() -> None:
    dashboard = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
    shell = (dashboard / "shell.js").read_text(encoding="utf-8")
    for page in ("project_settings.html", "admin.html"):
        source = (dashboard / page).read_text(encoding="utf-8")
        assert "confirmUnarchiveProject" in source, page
        assert "revokeFirst" in source, page
    assert "/unarchive-preview" in shell
    assert "start working again" in shell


def test_docs_describe_archived_projects_as_decided() -> None:
    """Readable read-only, security actions kept, purge paused, reset signs out."""
    docs = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard" / "docs"
    guide = " ".join((docs / "platform-guide" / "projects-data-review.html").read_text(encoding="utf-8").split())
    assert "stay readable under a read-only notice" in guide
    assert "admins and managers revoke API keys and remove members" in guide
    assert "purge paused" in guide
    endpoints = (docs / "developer" / "endpoints.html").read_text(encoding="utf-8")
    assert "unarchive-preview" in endpoints and "purge_paused" in endpoints
    assert "Signs the user out of every browser" in endpoints
    user_guide = (ROOT / "packages" / "platform" / "docs" / "USER_GUIDE.md").read_text(encoding="utf-8")
    readme = (ROOT / "packages" / "platform" / "README.md").read_text(encoding="utf-8")
    for text in (user_guide, readme):
        assert "signs the user out of every browser" in text
        assert "read-only" in text
    operations = (ROOT / "docs" / "internal" / "OPERATIONS.md").read_text(encoding="utf-8")
    assert "alembic stamp 0058 && alembic upgrade head" in operations
    assert "Production never ran the pre-release branch" in operations
