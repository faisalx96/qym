"""Private test sets: item contents are admin-only everywhere they surface."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
os.environ.setdefault("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Dataset,
    DatasetItem,
    DatasetVersion,
    DatasetVersionStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    Span,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.permissions import (
    PRIVATE_TEST_SET_PLACEHOLDER,
    private_test_set_run_ids,
    redact_item_content,
)

SECRET_INPUT = "secret-question-42"
SECRET_EXPECTED = "secret-answer-42"
SECRET_OUTPUT = "secret-output-42"


@pytest.fixture()
def world(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as db:
        admin = User(id="admin-1", email="admin@example.com", role=UserRole.ADMIN)
        member = User(id="member-1", email="member@example.com", role=UserRole.MEMBER)
        project = Project(id="project-1", name="P", slug="p", created_by_user_id=admin.id)
        db.add_all([admin, member, project])
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id=project.id, user_id=admin.id, role=ProjectRole.MANAGER),
                ProjectMembership(project_id=project.id, user_id=member.id, role=ProjectRole.MANAGER),
            ]
        )
        for slug, private in (("secret", True), ("open", False)):
            dataset = Dataset(
                id=f"ds-{slug}",
                project_id=project.id,
                name=slug,
                slug=slug,
                private_test_set=private,
                created_by_user_id=admin.id,
            )
            version = DatasetVersion(
                id=f"dsv-{slug}",
                dataset_id=dataset.id,
                version="v1",
                status=DatasetVersionStatus.PUBLISHED,
                item_count=1,
                created_by_user_id=admin.id,
            )
            db.add_all([dataset, version])
            db.flush()
            db.add(
                DatasetItem(
                    dataset_version_id=version.id,
                    item_id="item-1",
                    input=SECRET_INPUT,
                    expected_output=SECRET_EXPECTED,
                    item_metadata={"topic": "hidden"},
                    fingerprint="f",
                )
            )
            run = Run(
                id=f"run-{slug}",
                project_id=project.id,
                created_by_user_id=member.id,
                owner_user_id=member.id,
                task="task",
                dataset=slug,
                dataset_id=dataset.id,
                dataset_version_id=version.id,
                metrics=["exact_match"],
                status=RunWorkflowStatus.DRAFT,
            )
            db.add(run)
            db.flush()
            db.add_all(
                [
                    RunItem(
                        run_id=run.id,
                        item_id="item-1",
                        index=0,
                        input=SECRET_INPUT,
                        expected=SECRET_EXPECTED,
                        output=SECRET_OUTPUT,
                        item_metadata={"topic": "hidden"},
                        trace_id="trace-1",
                    ),
                    RunItemScore(
                        run_id=run.id,
                        item_id="item-1",
                        metric_name="exact_match",
                        score_numeric=1.0,
                        explanation=f"matched {SECRET_EXPECTED}",
                        meta={
                            "judge_prompt": SECRET_INPUT,
                            "reference": {"answer": SECRET_EXPECTED},
                            "candidates": [SECRET_OUTPUT],
                            "tokens": 12,
                            "status": "ok",
                        },
                    ),
                    Span(
                        run_id=run.id,
                        trace_id="trace-1",
                        span_id="span-1",
                        name="llm",
                        start_time_ns=1,
                        end_time_ns=2,
                        attributes={"prompt": SECRET_INPUT},
                        events=[],
                    ),
                ]
            )
        db.commit()

    app = create_app()

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, SessionLocal
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _as(email: str) -> dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


ADMIN = _as("admin@example.com")
MEMBER = _as("member@example.com")


def _leaks(response) -> bool:
    text = response.text
    return any(secret in text for secret in (SECRET_INPUT, SECRET_EXPECTED, SECRET_OUTPUT))


def test_redact_item_content_recurses_and_marks_payload():
    row = {
        "item_id": "a",
        "input": {"q": 1},
        "output": "o",
        "error": "",
        "item_metadata": {"k": 1},
        "metric_meta": {
            "m": {
                "explanation": "x",
                "label": "ok",
                "judge_prompt": "q",
                "trace": {"input": "q"},
                "tokens": 7,
                "passed": True,
                "error": "judge saw q",
            }
        },
        "pass_metric_meta": {"m": [{"prompt": "q", "status": "ok"}, None]},
        "scores_snapshot": {"m": 1.0, "n": {"value": 0.5, "raw": "q"}},
        "pass_attempts": [{"output": "o", "latency_ms": 3}, None],
    }
    redact_item_content(row)
    assert row["input"] == PRIVATE_TEST_SET_PLACEHOLDER
    assert row["output"] == PRIVATE_TEST_SET_PLACEHOLDER
    assert row["error"] == ""
    assert row["item_metadata"] == {}
    # Metric metadata keeps only numbers/booleans and known UI flags.
    assert row["metric_meta"]["m"] == {
        "label": "ok",
        "tokens": 7,
        "passed": True,
        "error": PRIVATE_TEST_SET_PLACEHOLDER,
    }
    assert row["pass_metric_meta"]["m"] == [{"status": "ok"}, None]
    assert row["scores_snapshot"] == {"m": 1.0, "n": {"value": 0.5}}
    assert row["pass_attempts"][0] == {"output": PRIVATE_TEST_SET_PLACEHOLDER, "latency_ms": 3}
    assert row["content_restricted"] is True


def test_runs_link_to_private_sets_by_id_version_or_name(world):
    _, SessionLocal = world
    with SessionLocal() as db:
        by_id = Run(id="a", project_id="project-1", dataset="x", dataset_id="ds-secret")
        by_version = Run(id="b", project_id="project-1", dataset="x", dataset_version_id="dsv-secret")
        by_name = Run(id="c", project_id="project-1", dataset="secret")
        other_project = Run(id="d", project_id="project-2", dataset="secret")
        public = Run(id="e", project_id="project-1", dataset="open", dataset_id="ds-open")
        assert private_test_set_run_ids(db, [by_id, by_version, by_name, other_project, public]) == {"a", "b", "c"}


def test_member_cannot_read_private_dataset_items(world):
    client, _ = world
    listing = client.get("/v1/datasets", params={"project_slug": "p"}, headers=MEMBER)
    assert listing.status_code == 200
    flags = {ds["slug"]: ds["private_test_set"] for ds in listing.json()["datasets"]}
    assert flags == {"open": False, "secret": True}

    for path in (
        "/v1/datasets/secret/versions/v1/items",
        "/v1/datasets/secret/versions/v1/items/item-1",
        "/v1/datasets/secret/versions/v1:download",
        "/v1/datasets/secret/versions/v1/items/item-1/runs",
        "/api/datasets/secret/versions/v1/items/item-1/revisions",
    ):
        response = client.get(path, params={"project_slug": "p"}, headers=MEMBER)
        assert response.status_code == 403, path
        assert not _leaks(response)

    # Versions and metadata stay visible.
    assert client.get("/v1/datasets/secret/versions", params={"project_slug": "p"}, headers=MEMBER).status_code == 200
    # Public sets are unaffected.
    assert client.get("/v1/datasets/open/versions/v1/items", params={"project_slug": "p"}, headers=MEMBER).status_code == 200


def test_admin_reads_private_dataset_items(world):
    client, _ = world
    response = client.get("/v1/datasets/secret/versions/v1/items", params={"project_slug": "p"}, headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["items"][0]["input"] == SECRET_INPUT


def test_only_admins_toggle_private_flag(world):
    client, SessionLocal = world
    denied = client.patch(
        "/v1/datasets/open", params={"project_slug": "p"}, json={"private_test_set": True}, headers=MEMBER
    )
    assert denied.status_code == 403
    denied = client.post("/v1/datasets", json={"name": "new", "project_slug": "p", "private_test_set": True}, headers=MEMBER)
    assert denied.status_code == 403
    # Editing other fields without touching the flag still works for members.
    renamed = client.patch("/v1/datasets/secret", params={"project_slug": "p"}, json={"description": "d"}, headers=MEMBER)
    assert renamed.status_code == 200

    allowed = client.patch(
        "/v1/datasets/open", params={"project_slug": "p"}, json={"private_test_set": True}, headers=ADMIN
    )
    assert allowed.status_code == 200
    assert allowed.json()["dataset"]["private_test_set"] is True
    with SessionLocal() as db:
        assert db.get(Dataset, "ds-open").private_test_set is True


def test_member_run_views_redact_private_items(world):
    client, _ = world
    for view in (None, "compact"):
        params = {"view": view} if view else {}
        data = client.get("/api/runs/run-secret", params=params, headers=MEMBER)
        assert data.status_code == 200
        assert not _leaks(data)
        body = data.json()
        assert body["run"]["items_restricted"] is True
        row = body["snapshot"]["rows"][0]
        assert row["content_restricted"] is True
        assert row["metric_values"] == [1.0]
        assert row["metric_meta"]["exact_match"] == {"tokens": 12, "status": "ok"}

    details = client.post("/api/runs/run-secret/items/details", json={"item_ids": ["item-1"]}, headers=MEMBER)
    assert details.status_code == 200 and not _leaks(details)
    assert details.json()["rows"][0]["input"] == PRIVATE_TEST_SET_PLACEHOLDER

    search = client.post(
        "/api/runs/run-secret/items/search",
        json={"conditions": [{"id": "c", "field": "all", "operator": "contains", "value": "secret"}]},
        headers=MEMBER,
    )
    assert search.status_code == 200
    assert search.json()["matches"] == {"c": []}

    compare = client.get("/api/compare", params={"files": ["run-secret", "run-open"]}, headers=MEMBER)
    assert compare.status_code == 200
    runs = {run["run"]["run_id"]: run for run in compare.json()["runs"]}
    assert runs["run-secret"]["snapshot"]["rows"][0]["content_restricted"] is True
    assert runs["run-open"]["snapshot"]["rows"][0]["input"] == SECRET_INPUT

    for path in ("/api/runs/run-secret/spans", "/api/runs/run-secret/items/item-1/spans", "/api/runs/run-secret/items/item-1/trace"):
        response = client.get(path, headers=MEMBER)
        assert response.status_code == 200, path
        assert not _leaks(response), path

    exported = client.get("/api/runs/run-secret/export-html", headers=MEMBER)
    assert exported.status_code == 200
    assert not _leaks(exported)


def test_admin_and_public_run_views_unchanged(world):
    client, _ = world
    data = client.get("/api/runs/run-secret", headers=ADMIN).json()
    assert data["snapshot"]["rows"][0]["input"] == SECRET_INPUT
    assert data["snapshot"]["rows"][0]["metric_meta"]["exact_match"]["judge_prompt"] == SECRET_INPUT
    assert "items_restricted" not in data["run"]

    data = client.get("/api/runs/run-open", headers=MEMBER).json()
    assert data["snapshot"]["rows"][0]["input"] == SECRET_INPUT
    spans = client.get("/api/runs/run-open/spans", headers=MEMBER).json()["spans"]
    assert spans[0]["attributes"] == {"prompt": SECRET_INPUT}


def _add_corrections(SessionLocal) -> None:
    from qym_platform.db.models import CorrectionStatus

    with SessionLocal() as db:
        for slug in ("secret", "open"):
            db.add(
                ReviewCorrection(
                    run_id=f"run-{slug}",
                    item_id="item-1",
                    task="task",
                    metric_name="exact_match",
                    input_snapshot=SECRET_INPUT,
                    expected_snapshot=SECRET_EXPECTED,
                    output_snapshot=SECRET_OUTPUT,
                    ai_root_cause="Wrong answer",
                    ai_root_cause_note=f"model said {SECRET_OUTPUT}",
                    human_root_cause="Wrong answer",
                    status=CorrectionStatus.APPROVED,
                    is_active=True,
                )
            )
        db.commit()


def test_review_queue_redacts_private_corrections(world):
    client, SessionLocal = world
    _add_corrections(SessionLocal)

    rows = client.get("/api/corrections", params={"project_slug": "p"}, headers=MEMBER).json()["corrections"]
    by_run = {row["run_id"]: row for row in rows}
    assert by_run["run-secret"]["input_preview"] == PRIVATE_TEST_SET_PLACEHOLDER
    assert by_run["run-secret"]["content_restricted"] is True
    assert SECRET_OUTPUT not in str(by_run["run-secret"])
    assert by_run["run-open"]["input_preview"] == SECRET_INPUT

    # Per-run approved corrections span every run of the task in the project.
    rows = client.get("/api/runs/run-open/corrections", headers=MEMBER).json()["corrections"]
    assert sorted(row["input_snapshot"] for row in rows) == sorted([PRIVATE_TEST_SET_PLACEHOLDER, SECRET_INPUT])

    single = client.get(f"/api/corrections/{by_run['run-secret']['id']}", headers=MEMBER)
    assert single.status_code == 200 and not _leaks(single)

    admin_rows = client.get("/api/corrections", params={"project_slug": "p"}, headers=ADMIN).json()["corrections"]
    assert all(row["input_preview"] == SECRET_INPUT for row in admin_rows)


def test_analyzer_is_admin_only_on_private_runs(world):
    client, _ = world
    preview = client.post("/api/runs/run-secret/analyze-preview", json={"item_id": "item-1"}, headers=MEMBER)
    assert preview.status_code == 403
    assert not _leaks(preview)
    started = client.post("/api/runs/run-secret/analysis-jobs", json={}, headers=MEMBER)
    assert started.status_code == 403
    active = client.get("/api/runs/run-secret/analysis-jobs/active", headers=MEMBER)
    assert active.status_code == 200 and active.json() == {"job": None}


def _member_api_key(SessionLocal, project_id: str = "project-1") -> str:
    from qym_platform.db.models import ApiKey
    from qym_platform.security import generate_api_key

    token, prefix, key_hash = generate_api_key()
    with SessionLocal() as db:
        db.add(ApiKey(user_id="member-1", project_id=project_id, name="k", prefix=prefix, key_hash=key_hash))
        db.commit()
    return token


def test_only_admins_manage_dataset_read_tokens(world):
    client, _ = world
    path = "/v1/projects/project-1/dataset-read-tokens"
    assert client.post(path, json={"name": "svc"}, headers=MEMBER).status_code == 403
    assert client.get(path, headers=MEMBER).status_code == 403

    created = client.post(path, json={"name": "svc"}, headers=ADMIN)
    assert created.status_code == 200
    body = created.json()
    assert body["token"].startswith("qym_dr_")
    listed = client.get(path, headers=ADMIN).json()["tokens"]
    assert [t["id"] for t in listed] == [body["id"]]
    assert "token" not in listed[0]
    assert client.delete(f"{path}/{body['id']}", headers=MEMBER).status_code == 403


def test_dataset_read_token_lets_member_key_read_private_items(world):
    client, SessionLocal = world
    key = _member_api_key(SessionLocal)
    token = client.post("/v1/projects/project-1/dataset-read-tokens", json={}, headers=ADMIN).json()
    items_path = "/v1/datasets/secret/versions/v1/items"
    bearer = {"Authorization": f"Bearer {key}"}

    assert client.get(items_path, headers=bearer).status_code == 403
    with_token = {**bearer, "X-Qym-Dataset-Read-Token": token["token"]}
    for path in (items_path, "/v1/datasets/secret/versions/v1/items/item-1", "/v1/datasets/secret/versions/v1:download"):
        response = client.get(path, headers=with_token)
        assert response.status_code == 200, path
        assert SECRET_INPUT in response.text

    # Reads only: edits stay admin-only.
    edit = client.patch("/v1/datasets/secret/versions/v1/items/item-1", json={"input": "x"}, headers=with_token)
    assert edit.status_code == 403
    # A browser session can't use the token; it rides next to an API key only.
    ui = client.get(items_path, params={"project_slug": "p"}, headers={**MEMBER, "X-Qym-Dataset-Read-Token": token["token"]})
    assert ui.status_code == 403
    assert client.get(items_path, headers={**bearer, "X-Qym-Dataset-Read-Token": "qym_dr_wrong"}).status_code == 403

    client.delete(f"/v1/projects/project-1/dataset-read-tokens/{token['id']}", headers=ADMIN)
    assert client.get(items_path, headers=with_token).status_code == 403


def test_dataset_read_token_is_scoped_to_its_project(world):
    client, SessionLocal = world
    with SessionLocal() as db:
        db.add(Project(id="project-2", name="Q", slug="q", created_by_user_id="admin-1"))
        db.add(ProjectMembership(project_id="project-2", user_id="admin-1", role=ProjectRole.MANAGER))
        db.commit()
    other = client.post("/v1/projects/project-2/dataset-read-tokens", json={}, headers=ADMIN).json()
    key = _member_api_key(SessionLocal)
    response = client.get(
        "/v1/datasets/secret/versions/v1/items",
        headers={"Authorization": f"Bearer {key}", "X-Qym-Dataset-Read-Token": other["token"]},
    )
    assert response.status_code == 403
    assert not _leaks(response)
