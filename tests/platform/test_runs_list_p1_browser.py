"""Runs list in the browser: wrapping command bar, keyed rows, quiet polls,
safe shortcuts, run search and review actions that show at once
(C054, C029, C025, C071, C060, C040)."""

from __future__ import annotations

import json
from urllib.parse import urlparse

import pytest

from test_dashboard_paging_browser import DashboardFixture, make_runs

pytestmark = pytest.mark.browser


class RunsFixture(DashboardFixture):
    """The paging fixture plus the run review endpoints."""

    def __init__(self, browser, view="table", runs=None, viewport=None):
        super().__init__(browser, view=view, runs=runs)
        if viewport:
            self.page.set_viewport_size(viewport)
        self.workflow_calls = []
        self.workflow_response = {"ok": True, "status": "SUBMITTED"}
        self.workflow_status = 200

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path.startswith("/v1/runs/") and route.request.method == "POST":
            self.workflow_calls.append(url.path)
            route.fulfill(status=self.workflow_status, json=self.workflow_response)
            return
        super().route(route)

    def rows(self):
        return self.page.locator("#runs-tbody > tr[data-file]")

    def poll(self):
        self.page.evaluate("() => window.__dashboardTest.fetchRuns()")
        self.page.wait_for_function(
            "() => !window.__dashboardTest.state.runsFetchMeta.inFlight"
        )


@pytest.fixture
def runs_page(browser):  # noqa: F811
    view = RunsFixture(browser)
    view.open()
    try:
        yield view
    finally:
        view.close()


def _mark_rows(page):
    page.evaluate(
        "() => document.querySelectorAll('#runs-tbody > tr[data-file]').forEach((row, i) => { row.__mark = i; })"
    )


def _marked_rows(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#runs-tbody > tr[data-file]')).filter(row => row.__mark !== undefined).length"
    )


# C054 ------------------------------------------------------------------------


SIDEBAR_WIDTH = 192


@pytest.mark.parametrize("view", ["table", "charts"])
@pytest.mark.parametrize("viewport_width", [1024, 1280])
def test_command_bar_wraps_instead_of_widening_the_page(
    browser, view, viewport_width
):  # noqa: F811
    # The shell's 192px sidebar leaves 832/1088px of content at 1024/1280, but
    # media queries still see the full viewport.
    fixture = RunsFixture(
        browser, view=view, viewport={"width": viewport_width, "height": 900}
    )
    try:
        fixture.open()
        page = fixture.page
        page.add_style_tag(
            content=f"body {{ margin-left: {SIDEBAR_WIDTH}px !important; }}"
        )
        # An active filter shows the Clear button, which must stay on screen.
        page.evaluate(
            "() => { const t = window.__dashboardTest; t.state.filterVersions = new Set(['early-version']); t.render(); }"
        )
        page.wait_for_function(
            "() => document.getElementById('clear-all-filters').classList.contains('is-visible')"
        )
        metrics = page.evaluate("""() => {
              const bar = document.querySelector('.command-bar');
              const clear = document.getElementById('clear-all-filters').getBoundingClientRect();
              const root = document.scrollingElement;
              return {
                bar: [bar.scrollWidth, bar.clientWidth],
                page: [root.scrollWidth, root.clientWidth],
                clearRight: clear.right,
                lastFilterRight: Math.max(...Array.from(document.querySelectorAll('.filter-dropdowns .multi-select-btn'))
                  .map(button => button.getBoundingClientRect().right)),
              };
            }""")
        assert metrics["bar"][0] <= metrics["bar"][1], metrics
        assert metrics["page"][0] <= metrics["page"][1], metrics
        assert metrics["clearRight"] <= viewport_width, metrics
        assert metrics["lastFilterRight"] <= viewport_width, metrics
    finally:
        fixture.close()


# C029 ------------------------------------------------------------------------


def test_focus_selection_and_keys_patch_rows_instead_of_rebuilding(runs_page):
    page = runs_page.page
    _mark_rows(page)
    rows = runs_page.rows()

    rows.nth(3).locator("td.col-duration").click()
    assert (
        page.evaluate("document.querySelector('#runs-tbody > tr.focused').dataset.idx")
        == "3"
    )
    page.mouse.click(5, 5)
    page.keyboard.press("j")
    page.keyboard.press("j")
    assert (
        page.evaluate("document.querySelector('#runs-tbody > tr.focused').dataset.idx")
        == "5"
    )
    assert page.locator("#runs-tbody > tr.focused").count() == 1

    page.click("#select-mode-btn")
    rows.nth(1).locator(".run-select-control").click()
    page.mouse.click(5, 5)
    page.keyboard.press("x")
    assert page.locator("#runs-tbody > tr.selected").count() == 2
    assert page.locator("#compare-panel").is_visible()
    assert "2 executions selected" in page.inner_text("#compare-count")
    # None of that replaced a row, and the filter menus were not rebuilt.
    assert _marked_rows(page) == 50
    page.click("#compare-clear")
    assert page.locator("#runs-tbody > tr.selected").count() == 0
    assert _marked_rows(page) == 50


def test_refresh_keeps_unchanged_rows_and_rebuilds_only_changed_ones(runs_page):
    page = runs_page.page
    _mark_rows(page)
    runs_page.poll()
    assert _marked_rows(page) == 50

    runs_page.runs[2]["status"] = "FAILED"
    runs_page.poll()
    assert _marked_rows(page) == 49
    assert "FAILED" in runs_page.rows().nth(2).locator(".status-badge").inner_text()
    # Stripes and indexes follow the new order without new nodes.
    assert runs_page.rows().nth(2).get_attribute("data-idx") == "2"


# C025 ------------------------------------------------------------------------


def test_poll_keeps_an_open_filter_and_its_focus(runs_page):
    page = runs_page.page
    page.click("#filter-status-btn")
    search = page.locator("#filter-status-dropdown .model-search-input")
    search.click()
    search.type("comp")
    page.evaluate(
        "() => { window.__statusMenu = document.querySelector('#filter-status-dropdown .model-search-input'); }"
    )

    # Unchanged data, then changed data, while the menu is open.
    runs_page.poll()
    runs_page.runs[0]["status"] = "FAILED"
    runs_page.poll()

    assert page.evaluate("document.activeElement === window.__statusMenu")
    assert page.input_value("#filter-status-dropdown .model-search-input") == "comp"
    assert page.locator("#filter-status-dropdown").evaluate(
        "el => el.classList.contains('open')"
    )
    # A stray letter typed into the search stays there.
    page.keyboard.type("l")
    assert page.input_value("#filter-status-dropdown .model-search-input") == "compl"
    assert page.locator("#table-view").is_visible()


def test_hidden_tab_does_not_poll_and_refreshes_when_shown(runs_page):
    page = runs_page.page
    page.clock.install()
    # The refresh after this fetch schedules the idle poll on the fake clock.
    runs_page.poll()
    page.evaluate(
        "() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })"
    )
    count = len(runs_page.requests)
    page.clock.fast_forward(125000)
    page.wait_for_timeout(1000)
    assert len(runs_page.requests) == count

    page.evaluate("""() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
        }""")
    page.wait_for_timeout(1000)
    assert len(runs_page.requests) > count


# C071 ------------------------------------------------------------------------


def test_stray_view_keys_never_blank_the_runs_table(runs_page):
    page = runs_page.page
    page.mouse.click(5, 5)
    for key in ["h", "m", "t", "Control+c", "Meta+j"]:
        page.keyboard.press(key)
    assert page.locator("#table-view").is_visible()
    assert page.evaluate("window.__dashboardTest.state.currentView") == "table"
    assert page.locator("#runs-tbody > tr.focused").count() == 0


def test_last_row_shortcut_reaches_the_last_run_of_the_list(runs_page):
    page = runs_page.page
    page.mouse.click(5, 5)
    page.keyboard.press("Shift+G")
    page.wait_for_function(
        "() => document.querySelector('#runs-tbody > tr.focused')?.dataset.idx === '122'"
    )
    assert "101–123 of 123" in page.inner_text("#table-pagination")
    page.keyboard.press("g")
    page.wait_for_function(
        "() => document.querySelector('#runs-tbody > tr.focused')?.dataset.idx === '0'"
    )


def test_single_key_shortcuts_can_be_turned_off(runs_page):
    page = runs_page.page
    page.mouse.click(5, 5)
    page.keyboard.press("?")
    assert page.locator("#help-modal").is_visible()
    assert "Search runs" in page.inner_text("#help-modal")
    page.uncheck("#single-key-shortcuts-toggle")
    page.keyboard.press("Escape")
    assert not page.locator("#help-modal").is_visible()
    page.mouse.click(5, 5)
    for key in ["j", "2", "/"]:
        page.keyboard.press(key)
    assert page.locator("#runs-tbody > tr.focused").count() == 0
    assert page.evaluate("window.__dashboardTest.state.quickFilter") == "all"
    assert page.evaluate("document.activeElement.id") != "runs-search"
    assert page.evaluate("localStorage.getItem('qym:single-key-shortcuts')") == "off"
    # With '?' off too, a keyboard user still reaches the switch to turn the
    # shortcuts back on.
    trigger = page.locator(".help-trigger")
    assert trigger.evaluate("el => el.tagName") == "BUTTON"
    trigger.focus()
    page.keyboard.press("Enter")
    assert page.locator("#help-modal").is_visible()
    page.check("#single-key-shortcuts-toggle")
    page.keyboard.press("Escape")
    page.mouse.click(5, 5)
    page.keyboard.press("j")
    assert page.locator("#runs-tbody > tr.focused").count() == 1
    page.evaluate("localStorage.removeItem('qym:single-key-shortcuts')")


def test_charts_page_has_no_runs_shortcuts(browser):  # noqa: F811
    fixture = RunsFixture(browser, view="charts")
    try:
        fixture.open()
        page = fixture.page
        page.mouse.click(5, 5)
        for key in ["m", "h", "t", "1", "j"]:
            page.keyboard.press(key)
        assert page.evaluate("window.__dashboardTest.state.currentView") == "charts"
        assert page.locator("#charts-view").is_visible()
    finally:
        fixture.close()


# C060 ------------------------------------------------------------------------


def _last_runs_filters(fixture):
    runs_requests = [
        query for path, query in fixture.requests if path.endswith("/runs")
    ]
    return json.loads(runs_requests[-1]["filters"][0])


def test_search_box_sends_q_keeps_it_in_the_url_and_focuses_with_slash(runs_page):
    page = runs_page.page
    page.mouse.click(5, 5)
    page.keyboard.press("/")
    assert page.evaluate("document.activeElement.id") == "runs-search"
    page.keyboard.type("Run 1")
    page.wait_for_function("() => window.__dashboardTest.state.searchQuery === 'Run 1'")
    page.wait_for_function("() => !window.__dashboardTest.state.runsFetchMeta.inFlight")
    assert _last_runs_filters(runs_page)["q"] == "Run 1"
    assert "q=Run+1" in page.url
    assert 'search: "Run 1"' in page.inner_text("#status-filter")
    assert page.locator("#clear-all-filters").evaluate(
        "el => el.classList.contains('is-visible')"
    )

    page.keyboard.press("Escape")
    page.wait_for_function("() => window.__dashboardTest.state.searchQuery === ''")
    assert "q=" not in page.url
    page.wait_for_function("() => !window.__dashboardTest.state.runsFetchMeta.inFlight")
    assert "q" not in _last_runs_filters(runs_page)


def test_custom_date_range_and_thirty_days(runs_page):
    page = runs_page.page
    page.click('.filter-btn[data-filter="month"]')
    page.wait_for_function("() => !window.__dashboardTest.state.runsFetchMeta.inFlight")
    filters = _last_runs_filters(runs_page)
    assert "since" in filters and "until" not in filters

    page.click('.filter-btn[data-filter="custom"]')
    assert page.locator("#time-range-dropdown").is_visible()
    page.fill("#time-range-from", "2026-09-25")
    page.fill("#time-range-to", "2026-09-20")
    page.click("#time-range-apply")
    assert "after the end date" in page.inner_text("#time-range-error")
    page.fill("#time-range-to", "2026-09-27")
    page.click("#time-range-apply")
    page.wait_for_function(
        "() => window.__dashboardTest.state.quickFilter === 'custom'"
    )
    page.wait_for_function("() => !window.__dashboardTest.state.runsFetchMeta.inFlight")
    filters = _last_runs_filters(runs_page)
    since = page.evaluate("new Date(2026, 8, 25).toISOString()")
    until = page.evaluate("new Date(2026, 8, 28).toISOString()")
    assert filters["since"].startswith(since[:19]) and filters["until"].startswith(
        until[:19]
    )
    assert page.inner_text('.filter-btn[data-filter="custom"]') == "Sep 25 – Sep 27"
    assert not page.locator("#time-range-dropdown").is_visible()


# C040 ------------------------------------------------------------------------


def test_submit_shows_the_new_status_at_once_and_says_why_a_submit_fails(runs_page):
    page = runs_page.page
    first = runs_page.rows().first
    assert first.locator(".submit-run").count() == 1
    first.locator(".submit-run").click()
    # Submit confirms first (C061); confirm without a comment.
    page.locator("#confirm-workflow-btn").click()
    # The mocked list still says COMPLETED; the row shows the confirmed status
    # and stops offering Submit.
    page.wait_for_function(
        "() => document.querySelector('#runs-tbody > tr[data-file]').querySelector('.status-badge').textContent.includes('SUBMITTED')"
    )
    page.wait_for_function("() => !window.__dashboardTest.state.runsFetchMeta.inFlight")
    assert first.locator(".submit-run").count() == 0
    assert runs_page.workflow_calls == ["/v1/runs/run-000/submit"]

    runs_page.workflow_status = 409
    runs_page.workflow_response = {
        "detail": "Only a completed, failed or rejected run can be submitted"
    }
    second = runs_page.rows().nth(1)
    second.locator(".submit-run").click()
    page.locator("#confirm-workflow-btn").click()
    toast = page.locator(".toast", has_text="Submit failed").last
    toast.wait_for()
    assert (
        "Only a completed, failed or rejected run can be submitted"
        in toast.inner_text()
    )
