"""Use the shipped pages to preserve pass identity after sibling deletion."""

import copy
import os
import threading

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_auto_analysis_release_gate_browser import (
    _AnalyzerHandler,
    _AnalyzerServer,
    _url,
    _wait_ready,
)
from test_performance_views_browser import ViewFixture, browser, source_run_api


@pytest.fixture
def analyzer_page(browser):
    server = _AnalyzerServer(("127.0.0.1", 0), _AnalyzerHandler)
    server.mode = "ok"
    server.run_requests = 0
    for name in (
        "dashboard_queries",
        "occurrence_queries",
        "compare_queries",
        "example_queries",
    ):
        setattr(server, name, [])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        yield page, server
    finally:
        context.close()
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
        assert not errors, errors


def test_remaining_pass_is_reachable_and_stale_edits_are_rejected(browser):
    fixtures = []
    try:
        with source_run_api(count=2) as client:
            response = client.delete("/api/runs/run-1/passes/3")
            assert response.status_code == 200, response.text
            stale = ViewFixture(browser, "run", count=2, samples=2)
            fixtures.append(stale)
            stale.api_client = client
            stale.goto("?pass=1")
            assert (
                stale.page.evaluate("__viewTest.state.run.metadata.pass_revision") == 1
            )

            response = client.delete(
                "/api/runs/run-1/passes/1", params={"expected_pass_version": 1}
            )
            assert response.status_code == 200, response.text
            stale.page.locator("#items-grid .item-header-expand").first.click()
            stale.page.locator("#items-grid .metric-edit-open").first.click()
            editor = stale.page.locator("#items-grid .metric-edit-input:visible").first
            editor.fill("0")
            with stale.page.expect_response(
                lambda response: response.url.endswith("/update_metric")
            ) as rejected:
                editor.press("Enter")
            assert rejected.value.status == 409
            assert rejected.value.request.post_data_json["expected_pass_version"] == 1
            assert len(stale.errors) == 1 and ": 409 " in stale.errors[0]
            stale.errors.clear()  # This response is the expected stale-edit rejection.
            assert (
                "Passes changed"
                in stale.page.locator(".toast-message").last.inner_text()
            )

            fresh = ViewFixture(browser, "run", count=2, samples=1)
            fixtures.append(fresh)
            fresh.api_client = client
            fresh.goto()
            link = fresh.page.locator('.hero-pass-pill[href$="?pass=1"]')
            assert link.text_content() == "Pass 1"
            link.click()
            fresh.ready()
            assert fresh.page.evaluate("__viewTest.state.viewPass") == 1
            assert (
                fresh.page.evaluate("__viewTest.state.snapshot.rows[0].output")
                == "pass-2 output 0"
            )
            assert (
                fresh.page.evaluate(
                    "__viewTest.state.snapshot.rows[0].metric_values[0]"
                )
                == 1
            )
            fresh.page.locator("#items-grid .item-header-expand").first.click()
            fresh.page.locator("#items-grid .metric-edit-open").first.click()
            editor = fresh.page.locator("#items-grid .metric-edit-input:visible").first
            editor.fill("0")
            with fresh.page.expect_response(
                lambda response: response.url.endswith("/update_metric")
            ) as saved:
                editor.press("Enter")
            assert saved.value.status == 200
            body = saved.value.request.post_data_json
            assert (body["pass_number"], body["expected_pass_version"]) == (1, 2)
            fresh.page.wait_for_function(
                "__viewTest.state.snapshot.rows[0].metric_values[0] === 0"
            )
            data = client.get("/api/runs/run-1").json()
            assert data["snapshot"]["rows"][0]["pass_scores"]["accuracy"] == [0]
    finally:
        for fixture in fixtures:
            fixture.close()


def test_analyzer_sends_remaining_pass_version_for_preview_test_and_job(
    analyzer_page, monkeypatch
):
    import test_auto_analysis_release_gate_browser as fixture_module

    original = fixture_module._run_payload

    def remaining_pass(**kwargs):
        payload = copy.deepcopy(original(**kwargs))
        payload["run"].update(
            samples=1,
            metadata={"has_repeat_pass_context": True, "pass_revision": 2},
        )
        for row in payload["snapshot"]["rows"]:
            row["pass_scores"] = {"quality": [0.25], "latency": [0.95]}
            row["pass_metric_meta"] = {"quality": [{}], "latency": [{}]}
            row["pass_attempts"] = [
                {
                    "pass_number": 1,
                    "status": "completed",
                    "output": "Retained pass output",
                }
            ]
        return payload

    monkeypatch.setattr(fixture_module, "_run_payload", remaining_pass)
    page, server = analyzer_page
    requests = []
    page.on(
        "request",
        lambda request: requests.append(request) if request.method == "POST" else None,
    )
    page.route(
        "**/api/runs/run-1/passes",
        lambda route: route.fulfill(
            json={"samples": 1, "passes": [{"pass_number": 1, "status": "completed"}]}
        ),
    )
    page.route(
        "**/api/runs/run-1/analyze-test",
        lambda route: route.fulfill(json={"results": []}),
    )
    page.route(
        "**/api/runs/run-1/analysis-jobs",
        lambda route: route.fulfill(
            json={
                "job_id": "job-1",
                "status": "completed",
                "result": {"results": [], "analyzed": 0},
            }
        ),
    )
    page.goto(_url(server, "/projects/demo/runs/run-1/analyzer?pass=1"))
    _wait_ready(page)
    assert page.locator("#analysis-pass-select").input_value() == "1"
    page.locator("#analyzer-host .pg-item-target-row").first.click()
    page.wait_for_function(
        "document.querySelector('#pg-preview-content')?.textContent.includes('Release-gate preview item')"
    )
    with page.expect_request(
        lambda request: request.url.endswith("/analyze-test")
    ) as test:
        page.locator("#pg-test-btn").click()
    assert test.value.post_data_json["expected_pass_version"] == 2
    page.wait_for_function("!document.querySelector('#pg-runall-btn').disabled")
    with page.expect_request(
        lambda request: request.url.endswith("/analysis-jobs")
    ) as job:
        page.locator("#pg-runall-btn").click()
    assert job.value.post_data_json["expected_pass_version"] == 2
    expected_paths = ("/analyze-preview", "/analyze-test", "/analysis-jobs")
    for suffix in expected_paths:
        matching = [request for request in requests if request.url.endswith(suffix)]
        assert matching, suffix
        assert all(
            (
                request.post_data_json["pass_number"],
                request.post_data_json["expected_pass_version"],
            )
            == (1, 2)
            for request in matching
        )


def test_compare_edits_use_loaded_pass_version_after_deletion(browser):
    fixtures = []
    try:
        with source_run_api(count=2) as client:
            response = client.delete("/api/runs/run-1/passes/3")
            assert response.status_code == 200, response.text
            stale = ViewFixture(browser, "compare", count=2, samples=2)
            fixtures.append(stale)
            stale.api_client = client
            stale.goto()
            response = client.delete(
                "/api/runs/run-1/passes/1", params={"expected_pass_version": 1}
            )
            assert response.status_code == 200, response.text

            def edit_first(fixture):
                fixture.page.locator("#items-grid .item-header-expand").first.click()
                fixture.page.locator("#items-grid .metric-edit-open").first.click()
                editor = fixture.page.locator(
                    "#items-grid .metric-edit-input:visible"
                ).first
                editor.fill("0")
                with fixture.page.expect_response("**/api/runs/update_metric") as saved:
                    editor.press("Enter")
                return saved.value

            rejected = edit_first(stale)
            assert rejected.status == 409
            assert rejected.request.post_data_json["expected_pass_version"] == 1
            assert len(stale.errors) == 1 and ": 409 " in stale.errors[0]
            stale.errors.clear()
            assert (
                "Passes changed"
                in stale.page.locator(".toast-message").last.inner_text()
            )

            fresh = ViewFixture(browser, "compare", count=2, samples=1)
            fixtures.append(fresh)
            fresh.api_client = client
            fresh.goto()
            assert (
                fresh.page.evaluate("__viewTest.state.runs[0].run.file_path")
                == "run-1::pass1"
            )
            assert (
                fresh.page.evaluate("__viewTest.state.runs[0].snapshot.rows[0].output")
                == "pass-2 output 0"
            )
            saved = edit_first(fresh)
            assert saved.status == 200
            body = saved.request.post_data_json
            assert (body["pass_number"], body["expected_pass_version"]) == (1, 2)
            data = client.get("/api/runs/run-1").json()
            assert data["snapshot"]["rows"][0]["pass_scores"]["accuracy"] == [0]
    finally:
        for fixture in fixtures:
            fixture.close()
