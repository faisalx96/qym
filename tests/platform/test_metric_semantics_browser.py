"""Pages follow the declared metric direction and primary metric (C008)."""

import os

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_models_paging_browser import ModelsFixture  # noqa: E402
from test_performance_views_browser import ViewFixture, browser  # noqa: E402,F401


def _reorder_metrics(fixture):
    """Declare count before accuracy, so position order is not alphabetical."""
    for data in fixture.data.values():
        data["run"]["metric_names"] = ["count", "accuracy"]
        data["snapshot"]["metric_names"] = ["count", "accuracy"]
        for row in data["snapshot"]["rows"]:
            row["metric_values"] = [row["metric_values"][1], row["metric_values"][0]]


def _score_colored(locator):
    """Whether any element inside carries a good/bad score color class."""
    return locator.evaluate(
        "el => [...el.querySelectorAll('*')].some(node => /\\bscore-[1-5]\\b/.test(node.className?.baseVal ?? node.className))"
    )


def _set_specs(fixture, specs):
    for data in fixture.data.values():
        data["snapshot"]["metric_specs"] = specs


def test_compare_opens_on_first_metric_by_position_not_alphabetical(browser):
    fixture = ViewFixture(browser, "compare", count=20)
    _reorder_metrics(fixture)
    _set_specs(fixture, {})
    try:
        fixture.goto()
        state = fixture.page.evaluate(
            "({metric: __viewTest.state.selectedOverviewMetric, all: __viewTest.state.allMetrics})"
        )
        assert state == {"metric": "count", "all": ["count", "accuracy"]}
    finally:
        fixture.close()


def test_compare_opens_on_declared_primary_metric(browser):
    fixture = ViewFixture(browser, "compare", count=20)
    _set_specs(
        fixture,
        {
            "accuracy": {"score_type": "boolean", "direction": "maximize"},
            "count": {"score_type": "number", "direction": "maximize", "primary": True},
        },
    )
    try:
        fixture.goto()
        assert fixture.page.evaluate("__viewTest.state.selectedOverviewMetric") == "count"
    finally:
        fixture.close()


def test_compare_best_value_follows_lower_is_better(browser):
    fixture = ViewFixture(browser, "compare", count=20)
    _set_specs(
        fixture,
        {
            "accuracy": {"score_type": "boolean", "direction": "minimize"},
            "count": {"score_type": "number", "direction": "maximize"},
        },
    )
    # run-2 is True on every item: worse when lower is better.
    for row in fixture.data["run-2"]["snapshot"]["rows"]:
        row["metric_values"][0] = 1
    try:
        fixture.goto()
        row = fixture.page.locator("#metrics-table tr").filter(has_text="accuracy").first
        cells = row.locator(".metric-val")
        assert "best" in cells.nth(0).get_attribute("class")
        assert "best" not in cells.nth(1).get_attribute("class")
        # run-1 (50% True) colors better than run-2 (100% True).
        assert "score-1" in cells.nth(1).get_attribute("class")
        assert fixture.page.evaluate("__viewTest.state.metricDirections.accuracy") == "minimize"
    finally:
        fixture.close()


def test_compare_without_direction_is_neutral(browser):
    fixture = ViewFixture(browser, "compare", count=20)
    _set_specs(fixture, {})
    for row in fixture.data["run-2"]["snapshot"]["rows"]:
        row["metric_values"][0] = 1
    try:
        fixture.goto()
        page = fixture.page
        row = page.locator("#metrics-table tr").filter(has_text="accuracy").first
        assert row.locator(".metric-val.best").count() == 0
        assert not _score_colored(row)
        note = page.locator(".metric-direction-note")
        assert note.count() == 1 and "declares no direction" in note.inner_text()
        assert page.get_by_text("Winner Breakdown").count() == 0
        page.locator("#items-grid .item-header-expand").first.click()
        assert page.locator("#items-grid .qym-tag--success, #items-grid .qym-tag--danger").filter(
            has_text="Pass"
        ).count() == 0
        assert page.locator("#threshold-control").is_hidden()
    finally:
        fixture.close()


def test_run_page_opens_on_primary_and_hides_verdicts_without_direction(browser):
    fixture = ViewFixture(browser, "run", count=20)
    _set_specs(
        fixture,
        {
            "accuracy": {"score_type": "boolean", "direction": "minimize"},
            "count": {"score_type": "number", "direction": "maximize", "primary": True},
        },
    )
    try:
        fixture.goto()
        page = fixture.page
        assert page.evaluate("__viewTest.state.selectedMetric") == "count"
        legend = page.locator(".metric-bool-legend").first.inner_text()
        assert "Pass (False)" in legend and "Fail (True)" in legend
    finally:
        fixture.close()

    fixture = ViewFixture(browser, "run", count=20)
    _set_specs(fixture, {})
    try:
        fixture.goto()
        page = fixture.page
        assert page.evaluate("__viewTest.state.selectedMetric") == "accuracy"
        legend = page.locator(".metric-bool-legend").first.inner_text()
        assert "True" in legend and "Pass" not in legend
        assert page.locator(".metric-bool-seg.pass-seg, .metric-bool-seg.fail-seg").count() == 0
        assert not _score_colored(page.locator(".metric-card").first)
        cards = page.locator("#items-grid .item-card")
        assert cards.count() > 0
        assert page.locator("#items-grid .qym-tag").filter(has_text="Pass").count() == 0
        assert page.locator("#items-grid .qym-tag").filter(has_text="Fail").count() == 0
    finally:
        fixture.close()


def test_models_ranking_needs_a_direction(browser):
    fixture = ModelsFixture(browser)
    try:
        fixture.open()
        fixture.page.locator("#models-ranking h3").wait_for()
        title = fixture.page.locator("#models-ranking h3").inner_text()
        assert "declares no direction" in title
        assert "🥇" not in fixture.page.locator("#models-ranking").inner_text()
    finally:
        fixture.close()

    fixture = ModelsFixture(browser)
    for row in fixture.rows:
        row["metric_specs"] = {
            "accuracy": {"score_type": "boolean", "direction": "minimize"},
            "count": {"score_type": "number", "direction": "maximize"},
        }
    try:
        fixture.open()
        page = fixture.page
        page.locator("#models-ranking h3").wait_for()
        assert "lower is better" in page.locator("#models-ranking h3").inner_text()
        assert "🥇" in page.locator("#models-ranking").inner_text()
        stats = fixture.stats()
        ranked = page.evaluate(
            "[...document.querySelectorAll('#models-ranking .ranking-item')].map(el => el.textContent)"
        )
        lowest = min(stats, key=lambda model: stats[model]["avgScore"])
        assert lowest.split("|||")[0] in ranked[0]
    finally:
        fixture.close()


def test_models_pass_threshold_defaults_to_the_metrics_own(browser):
    """A fixed 80% made "Pass ≤ 80%" pass nearly every item of a
    lower-is-better metric; Compare and the run page default to 20%."""
    fixture = ModelsFixture(browser)
    for row in fixture.rows:
        row["metric_specs"] = {
            "accuracy": {"score_type": "percentage", "direction": "minimize"},
            "count": {"score_type": "number", "direction": "maximize"},
        }
    try:
        fixture.open()
        page = fixture.page
        page.locator("#models-ranking h3").wait_for()
        mvs = "window.__modelsTest.state.modelsViewState"
        assert page.evaluate(mvs + ".selectedMetric") == "accuracy"
        assert page.evaluate(mvs + ".threshold") == 0.2
        assert page.locator("#models-threshold-value").inner_text() == "20%"
        assert "≤" in page.locator("#models-threshold-row .filter-label").inner_text()
        # A threshold the user picks for the metric is kept.
        page.locator("#models-threshold-slider").evaluate(
            "el => { el.value = '35'; el.dispatchEvent(new Event('change')); }"
        )
        page.wait_for_function(mvs + ".threshold === 0.35")
        page.evaluate("window.__modelsTest.renderModelsView()")
        page.wait_for_function(mvs + ".threshold === 0.35")
        assert page.locator("#models-threshold-value").inner_text() == "35%"
    finally:
        fixture.close()

    fixture = ModelsFixture(browser)
    for row in fixture.rows:
        row["metric_specs"] = {
            "accuracy": {"score_type": "percentage", "direction": "maximize", "pass_threshold": 0.7},
        }
    try:
        fixture.open()
        page = fixture.page
        page.locator("#models-ranking h3").wait_for()
        assert page.evaluate("window.__modelsTest.state.modelsViewState.threshold") == 0.7
        assert page.locator("#models-threshold-value").inner_text() == "70%"
    finally:
        fixture.close()


def _minimize_boolean_with_errors(fixture):
    """accuracy: lower is better; items 1, 2 scorer errors, 4 a task error,
    5 and 6 True, the rest False."""
    _set_specs(
        fixture,
        {
            "accuracy": {"score_type": "boolean", "direction": "minimize"},
            "count": {"score_type": "number", "direction": "maximize"},
        },
    )
    for data in fixture.data.values():
        for row in data["snapshot"]["rows"]:
            i = row["index"]
            row["status"], row["error"] = "completed", ""
            row["metric_values"][0] = 1 if i in (5, 6) else 0
            row["metric_meta"]["accuracy"] = {}
            if i in (1, 2):
                row["metric_meta"]["accuracy"] = {"status": "error", "error": "judge 429"}
            if i == 4:
                row["status"], row["error"] = "error", "task boom"


def test_run_page_boolean_segments_match_their_filters_with_errors(browser):
    """C008 x C015: an errored item sits in one segment only, the one its
    filter lists; the legend says what errors count as."""
    fixture = ViewFixture(browser, "run", count=10)
    _minimize_boolean_with_errors(fixture)
    try:
        fixture.goto()
        page = fixture.page
        card = page.locator(".metric-card").filter(has=page.locator(".metric-bool-bar")).first
        segments = {}
        for kind in ("pass-seg", "fail-seg", "error-seg"):
            seg = card.locator(f".metric-bool-seg.{kind}")
            segments[kind] = int(seg.evaluate("el => el.style.flexGrow || el.style.flex.split(' ')[0]"))
        assert segments == {"pass-seg": 5, "fail-seg": 2, "error-seg": 3}
        # Lower is better: errors are left out of the mean (2 True of the 7
        # items without an error) and never read as a pass (C015 amended).
        legend = card.locator(".metric-bool-legend").inner_text()
        assert "not counted in the mean" in legend
        assert "counted as False (pass)" not in legend
        assert card.locator(".metric-card-value").inner_text() == "28.6%"
        note = card.locator(".metric-card-error-note")
        assert note.inner_text().endswith("3 errors · not counted in the mean")
        assert "2 scorer errors and 1 task error are not counted" in note.get_attribute("title")
        listed = {}
        for kind in ("pass-seg", "fail-seg", "error-seg"):
            fixture.goto()
            card = page.locator(".metric-card").filter(has=page.locator(".metric-bool-bar")).first
            card.locator(f".metric-bool-seg.{kind}").click()
            listed[kind] = sorted(
                page.evaluate(
                    "__viewTest.getFilteredItems().map(item => (item.row || item).index)"
                )
            )
        assert listed == {
            "pass-seg": [0, 3, 7, 8, 9],
            "fail-seg": [5, 6],
            "error-seg": [1, 2, 4],
        }
    finally:
        fixture.close()
