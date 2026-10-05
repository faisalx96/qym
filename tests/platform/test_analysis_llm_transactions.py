"""LLM phases never hold a database transaction open (C005).

Production Postgres terminates a connection that stays idle in a transaction
for ``db_idle_in_transaction_timeout_ms`` (60 s). Analysis and rule-inference
used to await the model inside the load transaction, so a slow model made the
save fail after every paid call had finished. These tests emulate that timeout
on SQLite (and use the real setting on Postgres when configured), make every
fake model call outlast it, and require (a) no open transaction while the
model runs and (b) the results to be saved afterwards.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect as sa_inspect, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")

from qym_platform.api import analysis as analysis_api
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalyzerDocument,
    Project,
    ProjectAnalysisRuleVersion,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItem,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.services.analysis_jobs import AnalysisJob
from qym_platform.services.llm_analyzer import AnalysisResult
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY

IDLE_TIMEOUT_SECONDS = 0.5
LLM_SECONDS = 1.2
OWNER = {"X-User-Email": "owner@example.com", "Origin": "http://localhost:8000"}
MANAGER = {"X-User-Email": "manager@example.com", "Origin": "http://localhost:8000"}


class TransactionTracker:
    """Track open transactions; optionally kill idle ones like Postgres.

    With ``kill_after`` set, a statement or COMMIT on a connection whose
    transaction sat idle longer than that fails the way Postgres fails it
    after ``idle_in_transaction_session_timeout`` terminated the backend.
    """

    def __init__(self, engine, kill_after: float | None) -> None:
        self.kill_after = kill_after
        self.last_activity: dict[int, float] = {}
        self.killed = 0
        event.listen(engine, "begin", self._begin)
        event.listen(engine, "commit", self._commit)
        event.listen(engine, "rollback", self._end)
        event.listen(engine, "before_cursor_execute", self._before_execute)
        event.listen(engine, "after_cursor_execute", self._after_execute)

    @property
    def open_transactions(self) -> int:
        return len(self.last_activity)

    def _begin(self, conn) -> None:
        self.last_activity[id(conn)] = time.monotonic()

    def _check(self, conn) -> None:
        last = self.last_activity.get(id(conn))
        if (
            self.kill_after is not None
            and last is not None
            and time.monotonic() - last > self.kill_after
        ):
            self.last_activity.pop(id(conn), None)
            self.killed += 1
            raise OperationalError(
                "idle-in-transaction",
                {},
                Exception("terminating connection due to idle-in-transaction timeout"),
            )

    def _commit(self, conn) -> None:
        self._check(conn)
        self.last_activity.pop(id(conn), None)

    def _end(self, conn) -> None:
        self.last_activity.pop(id(conn), None)

    def _before_execute(self, conn, *_args) -> None:
        self._check(conn)

    def _after_execute(self, conn, *_args) -> None:
        if id(conn) in self.last_activity:
            self.last_activity[id(conn)] = time.monotonic()


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    admin = None
    schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_llm_txn_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        timeout_ms = int(IDLE_TIMEOUT_SECONDS * 1000)
        engine = create_engine(
            url,
            connect_args={
                "options": f"-csearch_path={schema} "
                f"-c idle_in_transaction_session_timeout={timeout_ms}"
            },
            pool_pre_ping=True,
        )
        kill_after = None  # Postgres enforces the real timeout.
    else:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        kill_after = IDLE_TIMEOUT_SECONDS

    def cleanup():
        engine.dispose()
        if admin:
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()

    request.addfinalizer(cleanup)
    Base.metadata.create_all(engine)
    tracker = TransactionTracker(engine, kill_after)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(
        analysis_api,
        "_get_llm_config",
        lambda *_args, **_kwargs: {"llm_model": "test-model"},
    )
    monkeypatch.setattr(analysis_api, "build_client", lambda *_args: object())
    return factory, tracker


@pytest.fixture
def client(env):
    factory, _ = env
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


def _seed(factory, *, samples: int = 1, pass_analysis: bool = False) -> None:
    with factory() as db:
        owner = User(id="owner", email="owner@example.com", role=UserRole.MEMBER)
        manager = User(id="manager", email="manager@example.com", role=UserRole.MEMBER)
        db.add_all([owner, manager])
        db.flush()
        db.add(Project(id="project", name="P", slug="p", created_by_user_id="owner"))
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id="project", user_id="owner", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id="project", user_id="manager", role=ProjectRole.MANAGER
                ),
                Run(
                    id="run-1",
                    project_id="project",
                    created_by_user_id="owner",
                    owner_user_id="owner",
                    task="task",
                    dataset="dataset",
                    metrics=["judge"],
                    samples=samples,
                    status=RunWorkflowStatus.COMPLETED,
                    run_metadata={},
                    run_config={"samples": samples},
                ),
            ]
        )
        db.flush()
        saved_analysis = {
            "source": "ai",
            "root_cause": "Wrong Format",
            "root_causes": ["Wrong Format"],
            "root_cause_detail": "Saved detail",
        }
        db.add(
            RunItem(
                run_id="run-1",
                item_id="item-1",
                index=0,
                input={"prompt": "hello"},
                expected={"answer": "world"},
                output={"answer": "nope"},
                item_metadata={}
                if pass_analysis
                else {"metric_analyses": {"judge": dict(saved_analysis)}},
            )
        )
        db.add(
            RunItemScore(
                run_id="run-1",
                item_id="item-1",
                metric_name="judge",
                score_numeric=0.2,
                score_raw=0.2,
                meta={},
            )
        )
        for pass_number in range(1, samples + 1) if samples > 1 else ():
            db.add(
                RunItemPassScore(
                    run_id="run-1",
                    item_id="item-1",
                    metric_name="judge",
                    pass_number=pass_number,
                    score_numeric=0.2,
                    meta={PASS_ANALYSIS_META_KEY: dict(saved_analysis)}
                    if pass_analysis
                    else {},
                )
            )
        db.add(
            AnalyzerDocument(
                project_id="project",
                uploaded_by_user_id="manager",
                name="policy.md",
                content="Answers must cite evidence.",
                characters=len("Answers must cite evidence."),
                enabled=True,
            )
        )
        db.commit()


def _fake_llm(monkeypatch, tracker):
    """Install slow fake model calls that record open transactions."""
    observed: list[tuple[str, int]] = []

    async def slow_call(name: str) -> None:
        observed.append((name, tracker.open_transactions))
        await asyncio.sleep(LLM_SECONDS)
        observed.append((name, tracker.open_transactions))

    async def analyze_items_batch(
        client,
        model,
        items,
        concurrency=20,
        config=None,
        metric_name=None,
        temperature=None,
        max_tokens=None,
        request_timeout_seconds=None,
        max_timeout_retries=1,
        progress_callback=None,
        retry_callback=None,
    ):
        # The real analyzer reads the loaded rows while the model runs; that
        # must not lazily reopen a transaction.
        for item, scores, _metric in items:
            for attr in sa_inspect(RunItem).column_attrs:
                getattr(item, attr.key)
            for score in scores.values():
                for attr in sa_inspect(type(score)).column_attrs:
                    getattr(score, attr.key)
        await slow_call("analyze")
        results = []
        for completed, (item, _scores, metric) in enumerate(items, start=1):
            result = AnalysisResult(
                item_id=item.item_id,
                metric_name=metric,
                root_cause="Hallucination",
                root_causes=["Hallucination"],
                root_cause_note="Made up an answer",
                confidence=0.9,
            )
            results.append(result)
            if progress_callback is not None:
                await progress_callback(result, completed, len(items))
        return results

    async def aggregate_analysis_categories(_client, _model, results, **_kwargs):
        await slow_call("aggregate")
        for result in results:
            result.root_cause_detail = "Canonical detail"
        return {"Hallucination": len(results)}

    async def infer_analysis_rules(**_kwargs):
        await slow_call("rules")
        return [
            {
                "title": "Cite evidence",
                "instruction": "Flag answers that do not cite evidence.",
            }
        ]

    monkeypatch.setattr(analysis_api, "analyze_items_batch", analyze_items_batch)
    monkeypatch.setattr(
        analysis_api, "aggregate_analysis_categories", aggregate_analysis_categories
    )
    monkeypatch.setattr(analysis_api, "infer_analysis_rules", infer_analysis_rules)
    return observed


def _assert_no_transaction_during_llm(observed, tracker, *names):
    assert {name for name, _ in observed} == set(names)
    assert all(count == 0 for _, count in observed), observed
    assert tracker.killed == 0


def _item_analysis(factory) -> dict:
    with factory() as db:
        item = db.query(RunItem).filter_by(run_id="run-1", item_id="item-1").one()
        return item.item_metadata["metric_analyses"]["judge"]


def _aggregation_status(factory) -> dict:
    with factory() as db:
        return db.get(Run, "run-1").run_metadata["analysis_aggregation"]


def test_background_analysis_job_saves_after_a_long_model_call(env, monkeypatch):
    factory, tracker = env
    _seed(factory)
    observed = _fake_llm(monkeypatch, tracker)
    job = AnalysisJob(
        run_id="run-1",
        user_id="owner",
        auth_type="proxy_headers",
        request_payload={"item_filter": "all", "only_unanalyzed": False},
    )

    result = asyncio.run(analysis_api._run_analysis_job(job, session_factory=factory))

    _assert_no_transaction_during_llm(observed, tracker, "analyze", "aggregate")
    assert result["errors"] == 0
    assert [row["persistence_status"] for row in result["results"]] == ["persisted"]
    assert _item_analysis(factory)["root_cause"] == "Hallucination"
    assert _aggregation_status(factory)["status"] == "succeeded"


def test_sync_analyze_endpoint_saves_after_a_long_model_call(
    env, client, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    observed = _fake_llm(monkeypatch, tracker)

    response = client.post(
        "/api/runs/run-1/analyze",
        headers=OWNER,
        json={"item_filter": "all", "only_unanalyzed": False},
    )

    assert response.status_code == 200, response.text
    _assert_no_transaction_during_llm(observed, tracker, "analyze", "aggregate")
    assert response.json()["results"][0]["persistence_status"] == "persisted"
    assert _item_analysis(factory)["root_cause"] == "Hallucination"
    assert _aggregation_status(factory)["status"] == "succeeded"


def test_streaming_analyze_endpoint_saves_after_a_long_model_call(
    env, client, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    observed = _fake_llm(monkeypatch, tracker)

    response = client.post(
        "/api/runs/run-1/analyze-stream",
        headers=OWNER,
        json={"item_filter": "all", "only_unanalyzed": False},
    )

    assert response.status_code == 200, response.text
    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert events[-1]["type"] == "done", events[-1]
    _assert_no_transaction_during_llm(observed, tracker, "analyze", "aggregate")
    assert _item_analysis(factory)["root_cause"] == "Hallucination"


def test_saved_analysis_aggregation_saves_after_a_long_model_call(
    env, client, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    observed = _fake_llm(monkeypatch, tracker)

    response = client.post("/api/runs/run-1/aggregate-analysis", headers=OWNER, json={})

    assert response.status_code == 200, response.text
    _assert_no_transaction_during_llm(observed, tracker, "aggregate")
    assert _item_analysis(factory)["root_cause_detail"] == "Canonical detail"
    assert _aggregation_status(factory)["status"] == "succeeded"


def test_saved_pass_aggregation_saves_after_a_long_model_call(
    env, client, monkeypatch
):
    factory, tracker = env
    _seed(factory, samples=2, pass_analysis=True)
    observed = _fake_llm(monkeypatch, tracker)

    response = client.post(
        "/api/runs/run-1/aggregate-analysis", headers=OWNER, json={"pass_number": 1}
    )

    assert response.status_code == 200, response.text
    assert response.json()["aggregated"] == 1
    _assert_no_transaction_during_llm(observed, tracker, "aggregate")
    with factory() as db:
        score = (
            db.query(RunItemPassScore)
            .filter_by(run_id="run-1", pass_number=1)
            .one()
        )
        assert score.meta[PASS_ANALYSIS_META_KEY]["root_cause_detail"] == (
            "Canonical detail"
        )


def test_rule_inference_endpoint_saves_after_a_long_model_call(
    env, client, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    observed = _fake_llm(monkeypatch, tracker)

    response = client.post(
        "/api/runs/run-1/analysis-rules/infer",
        headers=MANAGER,
        json={"include_documents": True, "include_examples": False},
    )

    assert response.status_code == 200, response.text
    _assert_no_transaction_during_llm(observed, tracker, "rules")
    with factory() as db:
        [version] = db.query(ProjectAnalysisRuleVersion).all()
        assert [rule["title"] for rule in version.rules] == ["Cite evidence"]


def test_rule_inference_job_appends_to_rules_edited_during_the_model_call(
    env, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    observed = _fake_llm(monkeypatch, tracker)
    with factory() as db:
        draft = analysis_api._create_analysis_rule_version(
            db,
            project_id="project",
            rules=[{"title": "Existing", "instruction": "Keep this rule."}],
            source="manual",
            actor_user_id="manager",
        )
        db.commit()
        draft_id = draft.id

    real_infer = analysis_api.infer_analysis_rules

    async def infer_while_a_reviewer_edits(**kwargs):
        # A concurrent editor commits while the model runs; with no
        # transaction held by the job, it neither blocks nor is overwritten.
        with factory() as peer:
            peer_draft = peer.get(ProjectAnalysisRuleVersion, draft_id)
            peer_draft.rules = list(peer_draft.rules) + [
                {"title": "Concurrent", "instruction": "Added by a reviewer."}
            ]
            peer.commit()
        return await real_infer(**kwargs)

    monkeypatch.setattr(
        analysis_api, "infer_analysis_rules", infer_while_a_reviewer_edits
    )
    job = AnalysisJob(
        run_id="run-1",
        user_id="manager",
        auth_type="proxy_headers",
        request_payload={
            "include_documents": True,
            "include_examples": False,
            "rule_version_id": draft_id,
        },
    )

    result = asyncio.run(
        analysis_api._run_rule_inference_job(job, session_factory=factory)
    )

    _assert_no_transaction_during_llm(observed, tracker, "rules")
    assert result["generated_rule_count"] == 1
    with factory() as db:
        titles = [
            rule["title"]
            for rule in db.get(ProjectAnalysisRuleVersion, draft_id).rules
        ]
    assert titles == ["Existing", "Concurrent", "Cite evidence"]


def _traced_item_with_real_analyzer(factory, monkeypatch, tracker):
    """Give item-1 a stored span and run the real analyzer on a slow provider.

    The real prompt builder reads the item's spans (``RunItem.trace_content``)
    inside the model phase, so this is the path a fake analyzer cannot cover.
    """
    from types import SimpleNamespace

    from qym_platform.db.models import Span
    from qym_platform.services import llm_analyzer

    with factory() as db:
        item = db.query(RunItem).filter_by(run_id="run-1", item_id="item-1").one()
        item.trace_id = "trace-1"
        db.add(
            Span(
                run_id="run-1",
                trace_id="trace-1",
                span_id="span-1",
                name="lookup_tool",
                kind="INTERNAL",
                start_time_ns=1,
                end_time_ns=2,
                attributes={
                    "openinference.span.kind": "TOOL",
                    "tool.name": "lookup_tool",
                    "output.value": "tool-evidence-marker",
                },
            )
        )
        db.commit()
    monkeypatch.setattr(
        analysis_api, "analyze_items_batch", llm_analyzer.analyze_items_batch
    )
    monkeypatch.setattr(
        analysis_api, "analyze_single_item", llm_analyzer.analyze_single_item
    )
    provider_calls: list[dict] = []

    async def slow_provider(_client, **kwargs):
        provider_calls.append(
            {
                "open_transactions": tracker.open_transactions,
                "prompt": json.dumps(kwargs.get("messages")),
            }
        )
        await asyncio.sleep(LLM_SECONDS)
        provider_calls.append({"open_transactions": tracker.open_transactions})
        content = json.dumps(
            {
                "root_causes": ["Hallucination"],
                "root_cause_detail": "Made up an answer",
                "root_cause_reason": "No evidence",
                "confidence": 0.9,
                "solution": "Cite the tool output",
            }
        )
        return SimpleNamespace(
            id="response-1",
            usage=None,
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    message=SimpleNamespace(content=content, reasoning=None),
                )
            ],
        )

    monkeypatch.setattr(llm_analyzer, "create_chat_completion_compat", slow_provider)
    return provider_calls


def _assert_traced_prompt_built_without_transaction(provider_calls, tracker):
    assert provider_calls, "the real analyzer never called the provider"
    assert all(
        call["open_transactions"] == 0 for call in provider_calls
    ), provider_calls
    # The spans were still read for the prompt, on a short-lived session.
    assert "tool-evidence-marker" in provider_calls[0]["prompt"]
    assert tracker.killed == 0


def test_job_with_traced_items_keeps_no_transaction_during_the_model_call(
    env, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    _fake_llm(monkeypatch, tracker)
    provider_calls = _traced_item_with_real_analyzer(factory, monkeypatch, tracker)
    job = AnalysisJob(
        run_id="run-1",
        user_id="owner",
        auth_type="proxy_headers",
        request_payload={"item_filter": "all", "only_unanalyzed": False},
    )

    result = asyncio.run(analysis_api._run_analysis_job(job, session_factory=factory))

    _assert_traced_prompt_built_without_transaction(provider_calls, tracker)
    assert [row["persistence_status"] for row in result["results"]] == ["persisted"]
    assert _item_analysis(factory)["root_cause"] == "Hallucination"


def test_analyze_test_with_traced_items_keeps_no_transaction_during_the_model_call(
    env, client, monkeypatch
):
    factory, tracker = env
    _seed(factory)
    _fake_llm(monkeypatch, tracker)
    provider_calls = _traced_item_with_real_analyzer(factory, monkeypatch, tracker)

    response = client.post(
        "/api/runs/run-1/analyze-test",
        headers=OWNER,
        json={"item_ids": ["item-1"], "metric": "judge"},
    )

    assert response.status_code == 200, response.text
    _assert_traced_prompt_built_without_transaction(provider_calls, tracker)


def test_llm_connection_test_keeps_no_transaction_during_the_provider_call(
    env, client, monkeypatch
):
    from types import SimpleNamespace

    from qym_platform.api import projects as projects_api
    from qym_platform.db.models import ProjectLlmConnection
    from qym_platform.secrets import encrypt_llm_api_key

    factory, tracker = env
    _seed(factory)
    with factory() as db:
        db.add(
            ProjectLlmConnection(
                id="connection-1",
                project_id="project",
                name="Default",
                llm_base_url="https://llm.example.com/v1",
                llm_model="test-model",
                llm_api_key_encrypted=encrypt_llm_api_key("sk-test-only"),
                llm_api_key_last4="only",
            )
        )
        db.commit()
    observed: list[int] = []

    async def slow_provider(_client, **_kwargs):
        observed.append(tracker.open_transactions)
        await asyncio.sleep(LLM_SECONDS)
        observed.append(tracker.open_transactions)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
        )

    monkeypatch.setattr(projects_api, "create_chat_completion_compat", slow_provider)
    monkeypatch.setattr(projects_api, "_validate_llm_base_url", lambda url, _s: url)

    response = client.post(
        "/v1/projects/project/llm-connections/connection-1/test", headers=MANAGER
    )

    assert response.status_code == 200, response.text
    assert response.json()["response"] == "ok"
    assert observed == [0, 0]
    assert tracker.killed == 0


LLM_CALLS = {
    "analyze_items_batch",
    "_analyze_targets_batch",
    "analyze_single_item",
    "aggregate_analysis_categories",
    "infer_analysis_rules",
}


def test_every_model_await_with_a_session_releases_its_transaction_first():
    """Review rule as a test: no model await while a session holds a transaction.

    Any function in api/analysis.py that can reach ``db`` and awaits a model
    call must call ``_release_transaction_for_llm`` before it (or, for a
    nested task, in an enclosing function).
    """
    import ast
    import inspect as py_inspect

    functions = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)
    tree = ast.parse(py_inspect.getsource(analysis_api))
    violations = []
    checked = []

    def own_nodes(function):
        """Nodes of one function body, not of the functions nested in it."""
        stack = list(ast.iter_child_nodes(function))
        while stack:
            node = stack.pop()
            yield node
            if not isinstance(node, functions):
                stack.extend(ast.iter_child_nodes(node))

    def called_name(node):
        func = node.func
        return func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)

    def releases(function):
        return [
            node.lineno
            for node in own_nodes(function)
            if isinstance(node, ast.Call)
            and called_name(node) == "_release_transaction_for_llm"
        ]

    def visit(function, scopes):
        scopes = scopes + [function]
        uses_db = any(
            (isinstance(node, ast.Name) and node.id == "db")
            or (isinstance(node, ast.arg) and node.arg == "db")
            for scope in scopes
            for node in own_nodes(scope)
        )
        for node in own_nodes(function):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(node, scopes)
                continue
            if not (
                uses_db
                and isinstance(node, ast.Await)
                and isinstance(node.value, ast.Call)
                and called_name(node.value) in LLM_CALLS
            ):
                continue
            checked.append(function.name)
            released_here = any(line < node.lineno for line in releases(function))
            released_by_parent = any(releases(scope) for scope in scopes[:-1])
            if not (released_here or released_by_parent):
                violations.append(f"{function.name}:{node.lineno}")

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            visit(node, [])
    assert {
        "_run_analysis_job",
        "_aggregate_run_analysis_results",
        "_aggregate_pass_analysis_results",
        "_infer_project_analysis_rules_impl",
        "analyze_run_items",
        "run_batch",
        "analyze_test",
    } <= set(checked)
    assert violations == []


def test_job_save_keeps_run_metadata_written_during_the_model_call(env, monkeypatch):
    factory, tracker = env
    _seed(factory)
    _fake_llm(monkeypatch, tracker)
    real_aggregate = analysis_api.aggregate_analysis_categories

    async def aggregate_while_ingest_updates_run(*args, **kwargs):
        with factory() as peer:
            run = peer.get(Run, "run-1")
            run.run_metadata = {**run.run_metadata, "langfuse_url": "https://lf"}
            peer.commit()
        return await real_aggregate(*args, **kwargs)

    monkeypatch.setattr(
        analysis_api,
        "aggregate_analysis_categories",
        aggregate_while_ingest_updates_run,
    )
    job = AnalysisJob(
        run_id="run-1",
        user_id="owner",
        auth_type="proxy_headers",
        request_payload={"item_filter": "all", "only_unanalyzed": False},
    )

    asyncio.run(analysis_api._run_analysis_job(job, session_factory=factory))

    with factory() as db:
        metadata = db.get(Run, "run-1").run_metadata
    # The save re-reads the run under lock instead of writing back the
    # snapshot loaded before the model call.
    assert metadata["langfuse_url"] == "https://lf"
    assert metadata["analysis_aggregation"]["status"] == "succeeded"
