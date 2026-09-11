"""Empty analytical sections disappear and return when filters expose data."""

from __future__ import annotations

from urllib.parse import urlparse

import pytest

from test_performance_views_browser import ViewFixture, browser

pytestmark = pytest.mark.browser


class ReportFixture(ViewFixture):
    def __init__(self, browser, kind, *, empty=False, scores=True):
        super().__init__(browser, kind, compact=False, count=0 if empty else 4)
        self.page.set_default_timeout(5000)
        self.repeat_group = None
        for data in self.data.values():
            rows = data["snapshot"]["rows"]
            for index, row in enumerate(rows):
                row.update(
                    input=f"reported question {index}",
                    input_full=f"reported question {index}",
                    metric_values=[0.25 + index * 0.2, index + 1]
                    if scores
                    else [None, None],
                    metric_meta={},
                    latency_ms=None,
                    retry_count=0,
                    status="completed",
                    error="",
                    item_metadata={"domain": "finance"},
                )
            if rows:
                if scores:
                    rows[0]["status"] = "error"
                    rows[0]["error"] = "Timeout: upstream unavailable"
                rows[1]["item_metadata"]["metric_analyses"] = {
                    "accuracy": {
                        "root_cause_issues": [
                            {
                                "category": "Reasoning Error",
                                "subcategory": "Missed evidence",
                            }
                        ],
                    }
                }
                rows[3].update(
                    input="clean question",
                    input_full="clean question",
                    metric_values=[0.95, None] if scores else [None, None],
                    item_metadata={},
                )
            data["snapshot"]["metric_specs"]["accuracy"]["score_type"] = "percentage"

    def route(self, route):
        path = urlparse(route.request.url).path
        if path == "/api/runs/step-latency":
            route.fulfill(json={"passes": [], "trace_count": 0, "groups": []})
            return
        if self.repeat_group is not None and path.endswith("/group-metrics"):
            route.fulfill(json=self.repeat_group)
            return
        if self.repeat_group is not None and path.endswith("/passes"):
            route.fulfill(json={"passes": [], "metrics": []})
            return
        super().route(route)

    def search(self, text, count):
        self.page.locator("#items-search").fill(text)
        self.page.wait_for_function(
            "count => __viewTest.getFilteredItems().length === count",
            arg=count,
        )
        self.settled()


def assert_absent(page, selector):
    """An omitted report must take up no layout space, including its heading."""
    page.wait_for_function(
        "selector => [...document.querySelectorAll(selector)].every(element => element.getClientRects().length === 0)",
        arg=selector,
    )
    assert page.locator(selector).evaluate_all(
        "elements => elements.every(element => element.getClientRects().length === 0)"
    ), selector


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_reports_disappear_on_filtered_data_and_return(browser, kind):
    fixture = ReportFixture(browser, kind)
    try:
        fixture.goto()
        page = fixture.page
        for selector in (
            "#error-distribution-section",
            "#root-cause-section",
            "#metadata-breakdown",
        ):
            page.locator(selector).wait_for(state="visible")
            assert page.locator(selector).is_visible()
        assert "Reasoning Error" in page.locator("#root-cause-section").inner_text()
        if kind == "run":
            assert page.locator("#overview-deep-section").is_visible()

        fixture.search("clean question", 1)
        for selector in (
            "#error-distribution-section",
            "#root-cause-section",
            "#metadata-breakdown",
        ):
            assert_absent(page, selector)
        if kind == "run":
            assert_absent(page, "#overview-deep-section")
        fallback = (
            "#items-auto-analyze-btn" if kind == "run" else "#compare-auto-analyze-btn"
        )
        assert page.locator(fallback).is_visible()

        fixture.search("no matching question", 0)
        for selector in (
            "#error-distribution-section",
            "#root-cause-section",
            "#metadata-breakdown",
        ):
            assert_absent(page, selector)
        if kind == "run":
            assert_absent(page, "#overview-primary-section")
            assert_absent(page, "#overview-deep-section")
        else:
            assert_absent(page, "#comparison-stats")
            # Per-Run Averages retains its whole-run scope when item filters change.
            assert page.locator(".metrics-comparison").is_visible()
        assert page.locator("#items-search").is_visible()

        fixture.search("", 4)
        for selector in (
            "#error-distribution-section",
            "#root-cause-section",
            "#metadata-breakdown",
        ):
            page.locator(selector).wait_for(state="visible")
            assert page.locator(selector).is_visible()
        if kind == "run":
            assert page.locator("#overview-deep-section").is_visible()
        else:
            assert page.locator("#comparison-stats").is_visible()
            assert page.locator(".metrics-comparison").is_visible()
    finally:
        fixture.close()


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_error_report_has_only_populated_groups_and_top_spacing(browser, kind):
    fixture = ReportFixture(browser, kind)
    try:
        fixture.goto()
        section = fixture.page.locator("#error-distribution-section")
        section.locator(".breakdown-errors").wait_for(state="visible")
        assert section.locator(".breakdown-errors").count() == 1
        assert "Task Errors" in section.inner_text()
        assert "No errors" not in section.inner_text()
        assert (
            section.evaluate("element => getComputedStyle(element).marginTop") == "32px"
        )
    finally:
        fixture.close()


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_run_without_items_has_no_analytical_or_item_sections(browser, kind):
    fixture = ReportFixture(browser, kind, empty=True)
    try:
        fixture.goto()
        page = fixture.page
        for selector in (
            "#error-distribution-section",
            "#root-cause-section",
            "#metadata-breakdown",
            ".items-comparison",
        ):
            assert_absent(page, selector)
        if kind == "run":
            assert_absent(page, "#overview-primary-section")
            assert_absent(page, "#overview-deep-section")
        else:
            assert_absent(page, "#comparison-stats")
            assert_absent(page, ".metrics-comparison")
    finally:
        fixture.close()


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_category_metadata_without_scores_has_no_performance_report(browser, kind):
    fixture = ReportFixture(browser, kind, scores=False)
    try:
        fixture.goto()
        assert_absent(fixture.page, "#metadata-breakdown")
        if kind == "run":
            assert_absent(fixture.page, "#overview-deep-section")
        else:
            assert_absent(fixture.page, "#comparison-stats")
            assert_absent(fixture.page, ".metrics-comparison")
    finally:
        fixture.close()


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_empty_local_selections_keep_controls_to_restore_reports(browser, kind):
    fixture = ReportFixture(browser, kind)
    try:
        fixture.goto()
        page = fixture.page
        root = page.locator("#root-cause-section")
        root.locator("#root-cause-metric-select").select_option("count")
        assert root.locator(".section-title").count() == 0
        assert root.locator(".comparison-stats").count() == 0
        assert root.locator("#root-cause-metric-select").is_visible()
        root.locator("#root-cause-metric-select").select_option("accuracy")
        assert root.locator(".rc-category-card").is_visible()

        categories = page.locator("#metadata-breakdown")
        selected_keys = categories.locator(
            "[data-chip-key][aria-pressed='true']"
        ).evaluate_all("chips => chips.map(chip => chip.dataset.chipKey)")
        for key in selected_keys:
            categories.locator(f"[data-chip-key='{key}']").click()
        page.wait_for_function(
            "!document.querySelector('#metadata-breakdown .section-title')"
        )
        assert categories.locator(".section-title").count() == 0
        assert categories.locator(".comparison-stats").count() == 0
        assert categories.locator("[data-chip-key='domain']").is_visible()
        categories.locator("[data-chip-key='domain']").click()
        categories.locator(".comparison-stats").wait_for(state="visible")
        assert categories.locator(".comparison-stats").is_visible()
    finally:
        fixture.close()


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_recorded_zero_latency_is_reported_as_a_value(browser, kind):
    fixture = ReportFixture(browser, kind, scores=False)
    for data in fixture.data.values():
        for row in data["snapshot"]["rows"]:
            row["latency_ms"] = 0
    try:
        fixture.goto()
        page = fixture.page
        report = page.locator(
            "#overview-deep-section" if kind == "run" else ".metrics-comparison"
        )
        report.wait_for(state="visible")
        assert "0ms" in report.inner_text()
    finally:
        fixture.close()


@pytest.mark.parametrize("populated", [False, True])
def test_repeat_report_omits_empty_charts_and_distributions(browser, populated):
    fixture = ReportFixture(browser, "run", scores=populated)
    fixture.data["run-1"]["run"]["samples"] = 3
    fixture.repeat_group = {
        "metric": "accuracy",
        "threshold": 0.8,
        "group": {
            "total_items": 4 if populated else 0,
            "avg_at_k": 0.6 if populated else None,
        },
        "band": {},
        "distribution": [0, 0, 0, 0],
    }
    try:
        fixture.goto()
        fixture.page.wait_for_load_state("networkidle")
        report = fixture.page.locator("#samples-analysis-section")
        if populated:
            assert report.is_visible()
            assert "Avg Score" in report.inner_text()
        else:
            assert_absent(fixture.page, "#samples-analysis-section")
        assert report.locator(".samples-performance-section").count() == 0
        assert report.locator(".samples-distribution-panel").count() == 0
        assert report.locator(".samples-stability-section").count() == 0
    finally:
        fixture.close()
