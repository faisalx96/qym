"""API tests for /api/runs/step-latency (qym_platform.api.step_latency)."""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItemAttempt,
    RunWorkflowStatus,
    Span,
    User,
    UserRole,
)
from qym_platform.deps import get_db


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-secret")


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory, _auth_mode):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _headers(email: str) -> dict:
    return {"X-User-Email": email}


def _span(run_id, span_id, name, parent=None, dur=None, status="OK",
          trace="trace-1", attrs=None):
    return Span(
        run_id=run_id, trace_id=trace, span_id=span_id,
        parent_span_id=parent, name=name, kind="INTERNAL",
        start_time_ns=0, end_time_ns=0, duration_ms=dur, status=status,
        attributes=attrs or {}, events=[], links=[],
    )


def _tool_attrs(name, **extra):
    return {"openinference.span.kind": "TOOL", "tool.name": name, **extra}


def _llm_attrs(model):
    return {"openinference.span.kind": "LLM", "llm.model_name": model}


def _seed(session: Session, run_id: str = "run-1", trace: str = "trace-1") -> None:
    owner = session.get(User, "user-owner")
    if owner is None:
        project = Project(id="project-1", name="P1", slug="p1",
                          created_by_user_id="user-owner")
        owner = User(id="user-owner", email="owner@example.com", role=UserRole.MEMBER)
        outsider = User(id="user-other", email="other@example.com", role=UserRole.MEMBER)
        membership = ProjectMembership(project_id="project-1", user_id="user-owner",
                                       role=ProjectRole.MEMBER)
        session.add_all([project, owner, outsider, membership])
    run = Run(
        id=run_id, project_id="project-1", created_by_user_id="user-owner",
        owner_user_id="user-owner", task="t", dataset="d",
        status=RunWorkflowStatus.COMPLETED, metrics=[], run_metadata={},
        run_config={},
    )
    spans = [
        _span(run_id, f"{trace}-root", "eval-item", trace=trace),
        _span(run_id, f"{trace}-task", "chat_task", parent=f"{trace}-root", trace=trace),
        _span(run_id, f"{trace}-s1", "sql_execute", parent=f"{trace}-task", dur=100.0,
              trace=trace, attrs=_tool_attrs("sql_execute")),
        _span(run_id, f"{trace}-s2", "sql_execute", parent=f"{trace}-task", dur=300.0,
              trace=trace, attrs=_tool_attrs("sql_execute")),
        _span(run_id, f"{trace}-err", "sql_execute", parent=f"{trace}-task", dur=9999.0,
              status="ERROR", trace=trace, attrs=_tool_attrs("sql_execute")),
        _span(run_id, f"{trace}-l1", "ChatCompletion", parent=f"{trace}-task",
              dur=1000.0, trace=trace, attrs=_llm_attrs("m1")),
        _span(run_id, f"{trace}-em", "eval_metrics", parent=f"{trace}-root", trace=trace),
        _span(run_id, f"{trace}-s3", "sql_execute", parent=f"{trace}-em", dur=500.0,
              trace=trace, attrs=_tool_attrs("sql_execute")),
    ]
    attempt = RunItemAttempt(
        run_id=run_id, item_id="item-1", pass_number=1, attempt_number=1,
        status="COMPLETED", trace_id=trace, is_last_attempt=True,
    )
    session.add(run)
    session.add_all(spans)
    session.add(attempt)
    session.commit()


def test_summary_json(client, session_factory):
    with session_factory() as session:
        _seed(session)
    resp = client.get("/api/runs/run-1/step-latency",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 200
    payload = resp.json()
    groups = {(g["phase"], g["step_type"]): g for g in payload["groups"]}

    task_sql = groups[("task", "sql_execute")]
    assert task_sql["n"] == 2
    assert task_sql["error_count"] == 1
    assert task_sql["mean_ms"] == pytest.approx(200.0)
    assert task_sql["max_ms"] == 300.0  # ERROR span's 9999 excluded

    assert groups[("eval", "sql_execute")]["n"] == 1
    assert groups[("task", "llm:m1")]["n"] == 1


def test_summary_csv(client, session_factory):
    with session_factory() as session:
        _seed(session)
    resp = client.get("/api/runs/run-1/step-latency?format=csv",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    lines = resp.text.strip().splitlines()
    assert lines[0].startswith("phase,step_type,kind,n,error_count,mean_ms")
    assert len(lines) >= 4  # header + 3 groups


def test_raw_span_csv(client, session_factory):
    with session_factory() as session:
        _seed(session)
    resp = client.get("/api/runs/run-1/step-latency?format=csv&level=spans",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 200
    lines = resp.text.strip().splitlines()
    # 4 task-tool/llm rows (incl. error) + 1 eval tool row
    assert len(lines) == 1 + 5


def test_multi_run_pooling(client, session_factory):
    with session_factory() as session:
        _seed(session, run_id="run-1", trace="trace-1")
        _seed(session, run_id="run-2", trace="trace-2")
    resp = client.get("/api/runs/step-latency?run_ids=run-1,run-2",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 200
    groups = {(g["phase"], g["step_type"]): g for g in resp.json()["groups"]}
    assert groups[("task", "sql_execute")]["n"] == 4  # pooled as one dataset
    assert groups[("task", "sql_execute")]["error_count"] == 2


def test_access_denied_for_non_member(client, session_factory):
    with session_factory() as session:
        _seed(session)
    resp = client.get("/api/runs/run-1/step-latency",
                      headers=_headers("other@example.com"))
    assert resp.status_code == 403


def test_unknown_run_404(client, session_factory):
    with session_factory() as session:
        _seed(session)
    resp = client.get("/api/runs/nope/step-latency",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 404


def _seed_second_pass(
    session: Session, run_id: str = "run-1", trace: str = "trace-p2"
) -> None:
    """Add a pass-2 attempt with its own trace and one slow tool span."""
    session.add(RunItemAttempt(
        run_id=run_id, item_id="item-1", pass_number=2, attempt_number=1,
        status="COMPLETED", trace_id=trace, is_last_attempt=True,
    ))
    session.add_all([
        _span(run_id, "p2-root", "eval-item", trace=trace),
        _span(run_id, "p2-s1", "sql_execute", parent="p2-root", dur=800.0,
              trace=trace, attrs=_tool_attrs("sql_execute")),
    ])
    session.commit()


def test_pass_filter_and_passes_list(client, session_factory):
    with session_factory() as session:
        _seed(session)
        _seed_second_pass(session)

    all_resp = client.get("/api/runs/run-1/step-latency",
                          headers=_headers("owner@example.com"))
    assert all_resp.json()["passes"] == [1, 2]
    assert all_resp.json()["trace_count"] == 2  # trace-1 + trace-p2
    all_sql = next(g for g in all_resp.json()["groups"]
                   if g["phase"] == "task" and g["step_type"] == "sql_execute")
    assert all_sql["n"] == 3  # both passes pooled when no filter

    p1 = client.get("/api/runs/run-1/step-latency?pass_number=1",
                    headers=_headers("owner@example.com"))
    p1_sql = next(g for g in p1.json()["groups"]
                  if g["phase"] == "task" and g["step_type"] == "sql_execute")
    assert p1_sql["n"] == 2
    assert p1_sql["max_ms"] == 300.0  # pass-2's 800ms excluded

    p2 = client.get("/api/runs/run-1/step-latency?pass_number=2",
                    headers=_headers("owner@example.com"))
    p2_sql = next(g for g in p2.json()["groups"]
                  if g["phase"] == "task" and g["step_type"] == "sql_execute")
    assert p2_sql["n"] == 1
    assert p2_sql["mean_ms"] == pytest.approx(800.0)


def test_pass_ref_in_run_ids(client, session_factory):
    """A "<run_id>::pass<N>" ref scopes to that pass without a pass_number."""
    with session_factory() as session:
        _seed(session)
        _seed_second_pass(session)

    resp = client.get("/api/runs/step-latency?run_ids=run-1::pass2",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 200
    g = next(x for x in resp.json()["groups"]
             if x["phase"] == "task" and x["step_type"] == "sql_execute")
    assert g["n"] == 1
    assert g["mean_ms"] == pytest.approx(800.0)


def test_mixed_refs_union_whole_run_and_single_pass(client, session_factory):
    """A cohort mixing a whole run with one pass of another unions both."""
    with session_factory() as session:
        _seed(session, run_id="run-1", trace="trace-1")
        _seed_second_pass(session, run_id="run-1")
        _seed(session, run_id="run-2", trace="trace-2")

    resp = client.get("/api/runs/step-latency?run_ids=run-2,run-1::pass2",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 200
    g = next(x for x in resp.json()["groups"]
             if x["phase"] == "task" and x["step_type"] == "sql_execute")
    # run-2 contributes its 2 successes, run-1 pass 2 contributes 1
    assert g["n"] == 3
    assert g["max_ms"] == 800.0
    assert g["error_count"] == 1  # run-2's errored span only


def test_unknown_base_in_pass_ref_404s(client, session_factory):
    with session_factory() as session:
        _seed(session)
    resp = client.get("/api/runs/step-latency?run_ids=nope::pass1",
                      headers=_headers("owner@example.com"))
    assert resp.status_code == 404


@pytest.mark.parametrize("selection", [
    "/api/runs/run-1/step-latency?pass_number=1",
    "/api/runs/step-latency?run_ids=run-1::pass1",
    "/api/runs/step-latency?run_ids=run-2,run-1::pass1",
])
def test_pass_selection_excludes_private_runs_with_shared_traces(
    client, session_factory, selection
):
    with session_factory() as session:
        _seed(session, run_id="run-1", trace="shared-trace")
        _seed(session, run_id="run-2", trace="other-trace")
        _seed(session, run_id="private-run", trace="shared-trace")
        session.add(Project(
            id="private-project", name="Private", slug="private",
            created_by_user_id="user-other",
        ))
        private_run = session.get(Run, "private-run")
        private_run.project_id = "private-project"
        private_run.owner_user_id = "user-other"
        private_run.created_by_user_id = "user-other"
        session.commit()

    headers = _headers("owner@example.com")
    denied = client.get("/api/runs/private-run/step-latency", headers=headers)
    assert denied.status_code == 403

    response = client.get(selection + "&level=spans", headers=headers)
    assert response.status_code == 200
    expected_runs = {"run-1", "run-2"} if "run-2," in selection else {"run-1"}
    rows = response.json()["spans"]
    assert {row["run_id"] for row in rows} == expected_runs
    assert len(rows) == 5 * len(expected_runs)


def test_pass_refs_keep_shared_trace_ids_bound_to_each_run(client, session_factory):
    with session_factory() as session:
        _seed(session, run_id="run-1", trace="trace-a")
        _seed_second_pass(session, run_id="run-1", trace="trace-b")
        _seed(session, run_id="run-2", trace="trace-a")
        _seed_second_pass(session, run_id="run-2", trace="trace-b")

    response = client.get(
        "/api/runs/step-latency?run_ids=run-1::pass1,run-2::pass2&level=spans",
        headers=_headers("owner@example.com"),
    )
    assert response.status_code == 200
    rows = response.json()["spans"]
    assert {(row["run_id"], row["trace_id"]) for row in rows} == {
        ("run-1", "trace-a"), ("run-2", "trace-b"),
    }
    assert len(rows) == 6


def test_pooled_runs_keep_shared_trace_ancestry_separate(client, session_factory):
    with session_factory() as session:
        _seed(session, run_id="run-1", trace="shared-trace")
        _seed(session, run_id="run-2", trace="shared-trace")
        container = session.query(Span).filter(
            Span.run_id == "run-2", Span.span_id == "shared-trace-em"
        ).one()
        container.name = "task_container"
        session.commit()

    response = client.get(
        "/api/runs/step-latency?run_ids=run-1,run-2&level=spans",
        headers=_headers("owner@example.com"),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["trace_count"] == 2
    phases = {
        row["run_id"]: row["phase"] for row in payload["spans"]
        if row["span_id"] == "shared-trace-s3"
    }
    assert phases == {"run-1": "eval", "run-2": "task"}
