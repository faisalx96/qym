"""API tests for /api/runs/step-latency (qym_platform.api.step_latency)."""

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")

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


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-secret")


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
        # Containers: the item root, its task span and eval_metrics (the phase
        # parents) are timed, but never step rows.
        _span(run_id, f"{trace}-root", "eval-item", dur=2500.0, trace=trace),
        _span(run_id, f"{trace}-task", "chat_task", parent=f"{trace}-root", dur=1600.0,
              trace=trace),
        _span(run_id, f"{trace}-s1", "sql_execute", parent=f"{trace}-task", dur=100.0,
              trace=trace, attrs=_tool_attrs("sql_execute")),
        _span(run_id, f"{trace}-s2", "sql_execute", parent=f"{trace}-task", dur=300.0,
              trace=trace, attrs=_tool_attrs("sql_execute")),
        _span(run_id, f"{trace}-err", "sql_execute", parent=f"{trace}-task", dur=9999.0,
              status="ERROR", trace=trace, attrs=_tool_attrs("sql_execute")),
        _span(run_id, f"{trace}-l1", "ChatCompletion", parent=f"{trace}-task",
              dur=1000.0, trace=trace, attrs=_llm_attrs("m1")),
        _span(run_id, f"{trace}-em", "eval_metrics", parent=f"{trace}-root", dur=700.0,
              trace=trace),
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


def test_summary_json_carries_phase_parent_distributions(client, session_factory):
    """Phase headers plot each trace's phase parent span (C143): the task span
    under the item root and eval_metrics, which step groups leave out."""
    with session_factory() as session:
        _seed(session)
    headers = _headers("owner@example.com")
    payload = client.get("/api/runs/run-1/step-latency", headers=headers).json()
    phases = {p["phase"]: p for p in payload["phases"]}
    assert list(phases) == ["task", "eval"]
    assert phases["task"]["n"] == 1 and phases["task"]["error_count"] == 0
    assert phases["task"]["mean_ms"] == pytest.approx(1600.0)  # not the 2.5s root
    assert phases["eval"]["n"] == 1
    assert phases["eval"]["median_ms"] == pytest.approx(700.0)
    for field in ("p5_ms", "p25_ms", "p75_ms", "p95_ms", "min_ms", "max_ms", "cv",
                  "tokens_total"):
        assert field in phases["task"]
    # The CSV summary stays one row per step group.
    csv_text = client.get("/api/runs/run-1/step-latency?format=csv", headers=headers).text
    assert len(csv_text.strip().splitlines()) == 1 + len(payload["groups"])


def test_phase_parents_follow_the_pass_scope(client, session_factory):
    with session_factory() as session:
        _seed(session)
        _seed_second_pass(session)
    headers = _headers("owner@example.com")

    def phases(query):
        body = client.get("/api/runs/run-1/step-latency" + query, headers=headers).json()
        return {p["phase"]: p for p in body["phases"]}

    both = phases("")
    assert both["task"]["n"] == 2  # trace-1's task span + pass 2's eval-less root
    assert (both["task"]["min_ms"], both["task"]["max_ms"]) == (900.0, 1600.0)
    second = phases("?pass_number=2")
    assert list(second) == ["task"]
    assert second["task"]["mean_ms"] == pytest.approx(900.0)
    first = phases("?pass_number=1")
    assert first["task"]["mean_ms"] == pytest.approx(1600.0)
    assert first["eval"]["n"] == 1


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
        _span(run_id, "p2-root", "eval-item", dur=900.0, trace=trace),
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


def test_group_by_ref_returns_each_lane_as_if_requested_alone(client, session_factory):
    """Compare draws a lane per run or pass; one request serves every lane."""
    with session_factory() as session:
        _seed(session, run_id="run-1", trace="trace-a")
        _seed_second_pass(session, run_id="run-1", trace="trace-b")
        # run-2 reuses run-1's trace ids; lanes must stay bound to their run.
        _seed(session, run_id="run-2", trace="trace-b")
    headers = _headers("owner@example.com")
    refs = ["run-1::pass1", "run-1::pass2", "run-2", "run-1"]
    for extra in ("", "&pass_number=2", "&rollup=kind"):
        pooled = client.get(
            "/api/runs/step-latency?run_ids=" + ",".join(refs) + "&group_by=ref" + extra,
            headers=headers,
        )
        assert pooled.status_code == 200, pooled.text
        body = pooled.json()
        alone = client.get(
            "/api/runs/step-latency?run_ids=" + ",".join(refs) + extra, headers=headers
        ).json()
        assert body["groups"] == alone["groups"]
        assert body["phases"] == alone["phases"]
        assert "groups_by_ref" not in alone and "phases_by_ref" not in alone
        assert list(body["groups_by_ref"]) == refs
        assert list(body["phases_by_ref"]) == refs
        for ref in refs:
            single = client.get(
                f"/api/runs/step-latency?run_ids={ref}" + extra, headers=headers
            ).json()
            assert body["groups_by_ref"][ref] == single["groups"], (ref, extra)
            assert body["phases_by_ref"][ref] == single["phases"], (ref, extra)
    lane = next(
        group for group in body["groups_by_ref"]["run-1::pass2"]
        if group["phase"] == "task"
    )
    assert lane["n"] == 1 and lane["mean_ms"] == pytest.approx(800.0)
    # Each lane's phase header has its own parent spans.
    phase_lane = body["phases_by_ref"]["run-1::pass2"]
    assert [p["phase"] for p in phase_lane] == ["task"]
    assert phase_lane[0]["mean_ms"] == pytest.approx(900.0)
    rejected = client.get(
        "/api/runs/step-latency?run_ids=run-1&group_by=run", headers=headers
    )
    assert rejected.status_code == 422


def test_run_count_is_capped(client, session_factory):
    from qym_platform.api.step_latency import MAX_STEP_LATENCY_RUNS

    ids = ",".join(f"run-{index}" for index in range(MAX_STEP_LATENCY_RUNS + 1))
    resp = client.get(
        f"/api/runs/step-latency?run_ids={ids}", headers=_headers("owner@example.com")
    )
    assert resp.status_code == 422
    assert str(MAX_STEP_LATENCY_RUNS) in resp.json()["detail"]


def test_legacy_spans_read_only_the_attributes_used(client, session_factory):
    """Spans without promoted columns read their attributes from the JSON,
    by key in SQL, never the whole (possibly large) attributes document."""
    from sqlalchemy import event

    with session_factory() as session:
        _seed(session)
        session.add(
            _span(
                "run-1", "trace-1-tok", "ChatCompletion", parent="trace-1-task",
                dur=50.0,
                attrs={
                    **_llm_attrs("m2"),
                    "llm.token_count.prompt": 7,
                    "llm.token_count.completion": 5,
                    "input.value": "x" * 5000,
                },
            )
        )
        session.commit()
        engine = session.get_bind()
    statements = []

    def capture(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        resp = client.get(
            "/api/runs/run-1/step-latency?level=spans",
            headers=_headers("owner@example.com"),
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert resp.status_code == 200
    row = next(s for s in resp.json()["spans"] if s["span_id"] == "trace-1-tok")
    tokens = (row["tokens_total"], row["tokens_prompt"], row["tokens_completion"])
    assert tokens == (12, 7, 5)
    assert row["step_type"] == "llm:m2"
    assert not any("spans.attributes AS" in s for s in statements), statements


def test_call_site_rollup_names_models_and_keeps_them_in_csv(client, session_factory):
    with session_factory() as session:
        _seed(session)
    headers = _headers("owner@example.com")
    payload = client.get("/api/runs/run-1/step-latency?rollup=site", headers=headers).json()
    llm = next(g for g in payload["groups"] if g["kind"] == "LLM")
    assert (llm["step_type"], llm["model"], llm["agent"]) == ("ChatCompletion", "m1", None)
    assert payload["agents"] == []
    assert payload["traces"]["n"] == 1 and payload["traces"]["mean_ms"] == pytest.approx(2500.0)
    summary = client.get("/api/runs/run-1/step-latency?rollup=site&format=csv", headers=headers).text
    assert summary.splitlines()[0].startswith("phase,step_type,kind,model,agent,n,error_count")
    spans = client.get("/api/runs/run-1/step-latency?rollup=site&format=csv&level=spans", headers=headers).text
    assert spans.splitlines()[0].startswith("run_id,trace_id,span_id,phase,kind,step_type,name,model,agent,duration_ms")
    # The default rollup's CSV is unchanged.
    plain = client.get("/api/runs/run-1/step-latency?format=csv", headers=headers).text
    assert plain.splitlines()[0].startswith("phase,step_type,kind,n,error_count")


# C022: the run page's summary is stored on first read and served from the stored row while the span set holds.


def _stored(session_factory, run_id="run-1"):
    from qym_platform.db.models import RunStepLatencySummary

    with session_factory() as session:
        return session.query(RunStepLatencySummary).filter_by(run_id=run_id).all()


def test_run_page_summary_is_stored_and_served_without_the_spans(client, session_factory, monkeypatch):
    import qym_platform.api.step_latency as step_latency

    with session_factory() as session:
        _seed(session)
    headers = _headers("owner@example.com")
    url = "/api/runs/step-latency?run_ids=run-1&rollup=site"
    first = client.get(url, headers=headers)
    assert first.status_code == 200
    (row,) = _stored(session_factory)
    assert (row.pass_number, row.rollup) == (0, "site")

    def no_scan(*args, **kwargs):
        raise AssertionError("the stored summary must be served without loading spans")

    monkeypatch.setattr(step_latency, "_load_spans", no_scan)
    second = client.get(url, headers=headers)
    assert second.status_code == 200
    assert second.json() == first.json()


def test_a_late_span_rebuilds_the_stored_summary(client, session_factory):
    with session_factory() as session:
        _seed(session)
    headers = _headers("owner@example.com")
    url = "/api/runs/step-latency?run_ids=run-1&rollup=name"
    before = client.get(url, headers=headers).json()
    with session_factory() as session:
        session.add(
            _span("run-1", "trace-1-late", "sql_execute", parent="trace-1-task", dur=700.0,
                  attrs=_tool_attrs("sql_execute"))
        )
        session.commit()
    after = client.get(url, headers=headers).json()
    task_sql = lambda body: next(  # noqa: E731
        g for g in body["groups"] if (g["phase"], g["step_type"]) == ("task", "sql_execute")
    )
    assert task_sql(before)["n"] == 2
    assert task_sql(after)["n"] == 3


def test_stored_summary_keeps_access_checks(client, session_factory):
    with session_factory() as session:
        _seed(session)
    url = "/api/runs/step-latency?run_ids=run-1&rollup=site"
    assert client.get(url, headers=_headers("owner@example.com")).status_code == 200
    assert client.get(url, headers=_headers("other@example.com")).status_code == 403
    assert client.get("/api/runs/step-latency?run_ids=nope", headers=_headers("owner@example.com")).status_code == 404


def test_a_running_run_reuses_its_summary_for_a_few_seconds(client, session_factory):
    with session_factory() as session:
        _seed(session)
        session.get(Run, "run-1").status = RunWorkflowStatus.RUNNING
        session.commit()
    headers = _headers("owner@example.com")
    url = "/api/runs/step-latency?run_ids=run-1&rollup=name"
    before = client.get(url, headers=headers).json()
    with session_factory() as session:
        session.add(
            _span("run-1", "trace-1-late", "sql_execute", parent="trace-1-task", dur=700.0,
                  attrs=_tool_attrs("sql_execute"))
        )
        session.commit()
    # within LIVE_SUMMARY_REUSE the stored summary answers; the next build picks the new span up
    assert client.get(url, headers=headers).json() == before


def test_the_summary_writer_hook_builds_once_for_a_finished_run(session_factory):
    """C022 (owner: use the existing summary writers): the dashboard worker stores the summary after it publishes a run."""
    from qym_platform.api.step_latency import refresh_stored_summary

    with session_factory() as session:
        _seed(session)
        run = session.get(Run, "run-1")
        assert refresh_stored_summary(session, run) is True
        assert refresh_stored_summary(session, run) is False  # the fingerprint holds: nothing to rebuild
        session.add(_span("run-1", "trace-1-late", "sql_execute", parent="trace-1-task", dur=5.0,
                          attrs=_tool_attrs("sql_execute")))
        session.commit()
        assert refresh_stored_summary(session, run) is True  # a late span rebuilds it
    (row,) = _stored(session_factory)
    assert (row.pass_number, row.rollup) == (0, "site")


def test_the_summary_writer_rebuilds_a_live_run_at_most_every_interval(session_factory):
    from qym_platform.api.step_latency import refresh_stored_summary

    with session_factory() as session:
        _seed(session)
        run = session.get(Run, "run-1")
        run.status = RunWorkflowStatus.RUNNING
        session.commit()
        assert refresh_stored_summary(session, run) is True
        session.add(_span("run-1", "trace-1-late", "sql_execute", parent="trace-1-task", dur=5.0,
                          attrs=_tool_attrs("sql_execute")))
        session.commit()
        # a large running run is not rebuilt on every new span: once per LIVE_SUMMARY_REBUILD
        assert refresh_stored_summary(session, run) is False


def test_the_worker_stores_the_summary_after_publishing(session_factory):
    from qym_platform.db.models import RunStepLatencySummary
    from qym_platform.services.dashboard_summaries import DashboardSummaryWorker

    with session_factory() as session:
        _seed(session)
    worker = DashboardSummaryWorker.__new__(DashboardSummaryWorker)
    worker.session_factory = session_factory
    import logging

    worker._logger = logging.getLogger("test")
    worker._store_step_latency("run-1")
    with session_factory() as session:
        assert session.query(RunStepLatencySummary).count() == 1


# C072: a finished run's reads carry an ETag; a revisit with the same body is a 304 with no body.


@pytest.mark.parametrize(
    "path",
    [
        "/api/runs/run-1",
        "/api/runs/run-1?view=summary",
        "/api/runs/run-1/passes",
        "/api/runs/step-latency?run_ids=run-1&rollup=site",
        "/api/runs/run-1/step-latency",
        "/api/compare?files=run-1",
    ],
)
def test_finished_run_reads_answer_304_on_revisit(client, session_factory, path):
    with session_factory() as session:
        _seed(session)
    headers = _headers("owner@example.com")
    first = client.get(path, headers=headers)
    assert first.status_code == 200
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "private, no-cache"
    assert "x-qym-cacheable" not in first.headers
    again = client.get(path, headers={**headers, "If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag


def test_a_live_run_keeps_no_store(client, session_factory):
    with session_factory() as session:
        _seed(session)
        session.get(Run, "run-1").status = RunWorkflowStatus.RUNNING
        session.commit()
    response = client.get("/api/runs/run-1", headers=_headers("owner@example.com"))
    assert response.status_code == 200
    assert "etag" not in response.headers
    assert response.headers["cache-control"] == "no-store"


def test_an_outsider_gets_no_cached_body(client, session_factory):
    with session_factory() as session:
        _seed(session)
    first = client.get("/api/runs/run-1/step-latency", headers=_headers("owner@example.com"))
    denied = client.get(
        "/api/runs/run-1/step-latency",
        headers={**_headers("other@example.com"), "If-None-Match": first.headers["etag"]},
    )
    assert denied.status_code == 403
