"""The shipped Runs page keeps task errors, metric errors and retries distinct."""

import pytest

from test_dashboard_paging_browser import DashboardFixture, browser, make_runs

pytestmark = pytest.mark.browser


def test_error_symbols_colors_and_drilldown(browser):
    rows = make_runs(3)
    rows[0].update(
        task_error_count=0,
        metric_error_count=2,
        metric_error_counts={"accuracy": 2},
        execution_error_count=1,
    )
    rows[1].update(
        task_error_count=3,
        metric_error_count=0,
        metric_error_counts={},
        execution_error_count=3,
        total_retries=4,
    )
    # Old publications must never present the combined count as task failures.
    rows[2].update(execution_error_count=5)
    fixture = DashboardFixture(browser, runs=rows)
    page = fixture.page
    try:
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function("__dashboardTest.state.flatRuns.length === 3")
        metric = page.locator(
            'tr[data-file="run-000"] .col-status .status-error-detail'
        )
        assert metric.inner_text() == "2⚠"
        assert "metric errors" in metric.get_attribute("aria-label")
        assert metric.evaluate("e => getComputedStyle(e).color") == "rgb(234, 179, 8)"
        metric.click()
        dialog = page.get_by_role("dialog")
        assert "2 metric checks failed" in dialog.inner_text()
        assert "accuracy" in dialog.inner_text()
        assert "Task outputs are available" in dialog.inner_text()
        dialog.get_by_role("button", name="Close error details").press("Escape")
        assert page.get_by_role("dialog").count() == 0
        assert metric.evaluate("e => e === document.activeElement")
        task = page.locator('tr[data-file="run-001"] .col-status .status-error-detail')
        assert task.inner_text() == "3⚠"
        assert task.evaluate("e => getComputedStyle(e).color") == "rgb(239, 68, 68)"
        retry = page.locator('tr[data-file="run-001"] .status-retries')
        assert retry.inner_text() == "4↻"
        assert retry.evaluate("e => getComputedStyle(e).color") == "rgb(59, 130, 246)"
        unknown = page.locator('tr[data-file="run-002"] .status-errors-pending')
        assert unknown.inner_text() == "5⚠"
        assert "breakdown is updating" in unknown.get_attribute("title")
        warning = page.locator('tr[data-file="run-000"] .metric-error-indicator')
        assert warning.inner_text() == "⚠"
        warning.click()
        assert "accuracy" in page.get_by_role("dialog").inner_text()
    finally:
        fixture.close()


def test_repeat_pass_errors_keep_their_types_after_expansion(browser):
    row = make_runs(1)[0]
    row.update(
        samples=2,
        task_error_count=1,
        metric_error_count=2,
        metric_error_counts={"accuracy": 2},
        execution_error_count=2,
    )
    passes = [
        dict(
            pass_number=1,
            status="completed",
            metric_means={"accuracy": 0},
            task_error_count=1,
            metric_error_count=0,
            metric_error_counts={},
            error_count=1,
            retry_count=2,
        ),
        dict(
            pass_number=2,
            status="completed",
            metric_means={"accuracy": 0.8},
            task_error_count=0,
            metric_error_count=2,
            metric_error_counts={"accuracy": 2},
            error_count=1,
            retry_count=0,
        ),
    ]
    row["pass_summaries"] = passes
    fixture = DashboardFixture(browser, runs=[row])
    page = fixture.page
    page.route(
        "**/api/runs/run-000/passes",
        lambda route: route.fulfill(
            json={"samples": 2, "metrics": ["accuracy"], "passes": passes},
        ),
    )
    page.route(
        "**/api/runs/run-000/group-metrics*",
        lambda route: route.fulfill(
            json={"metric": "accuracy", "samples": 2},
        ),
    )
    try:
        page.goto("https://qym.test/projects/demo")
        page.locator('.samples-toggle[data-run-id="run-000"]').click()
        page.wait_for_function(
            "__dashboardTest.state._samplesData['run-000']?.passes.samples === 2"
        )
        first = page.locator('tr.pass-member[data-pass-number="1"] .col-status')
        second = page.locator('tr.pass-member[data-pass-number="2"] .col-status')
        assert first.locator(".status-error-detail").inner_text() == "1⚠"
        assert first.locator(".status-metric-errors").count() == 0
        assert first.locator(".status-retries").inner_text() == "2↻"
        assert second.locator(".status-metric-errors").inner_text() == "2⚠"
        second.locator(".status-metric-errors").click()
        assert (
            "2 metric checks failed in this pass"
            in page.get_by_role("dialog").inner_text()
        )
    finally:
        fixture.close()


def test_null_score_pass_warning_survives_optimistic_and_loaded_rendering(browser):
    row = make_runs(1)[0]
    row.update(
        samples=2,
        metric_error_count=1,
        task_error_count=0,
        metric_error_counts={"accuracy": 1},
        execution_error_count=1,
    )
    passes = [
        dict(
            pass_number=1,
            status="completed",
            metric_means={},
            task_error_count=0,
            metric_error_count=1,
            metric_error_counts={"accuracy": 1},
            error_count=1,
        ),
        dict(
            pass_number=2,
            status="queued",
            metric_means={},
            task_error_count=0,
            metric_error_count=0,
            metric_error_counts={},
            error_count=0,
        ),
    ]
    row["pass_summaries"] = passes
    fixture = DashboardFixture(browser, runs=[row])
    page = fixture.page
    pending = []
    page.route("**/api/runs/run-000/passes", lambda route: pending.append(route))
    page.route(
        "**/api/runs/run-000/group-metrics*",
        lambda route: route.fulfill(json={"metric": "accuracy", "samples": 2}),
    )
    try:
        page.goto("https://qym.test/projects/demo")
        page.locator('.samples-toggle[data-run-id="run-000"]').click()
        warning = page.locator(
            'tr.pass-member[data-pass-number="1"] .col-metric-value .metric-error-indicator'
        )
        warning.wait_for()
        assert (
            page.locator(
                'tr.pass-member[data-pass-number="2"] .metric-error-indicator'
            ).count()
            == 0
        )
        warning.click()
        assert "accuracy" in page.get_by_role("dialog").inner_text()
        page.get_by_role("button", name="Close error details").press("Escape")
        assert pending
        pending[0].fulfill(
            json={"samples": 2, "metrics": ["accuracy"], "passes": passes}
        )
        page.wait_for_function(
            "__dashboardTest.state._samplesData['run-000']?.passes.samples === 2"
        )
        warning.wait_for()
        warning.click()
        assert (
            "1 metric check failed in this pass"
            in page.get_by_role("dialog").inner_text()
        )
        assert page.url == "https://qym.test/projects/demo"
        assert (
            page.locator(
                'tr.pass-member[data-pass-number="2"] .metric-error-indicator'
            ).count()
            == 0
        )
    finally:
        fixture.close()
