"""The run page redraws only what changed and keeps the reader still (C028),
follows a running run (C039), shows only captured trace stats (C143), and the
analyzer loads one sample's rows in place (C027).

These drive the shipped run.html / analyzer.html with production scripts and
compact run payloads (test_performance_views_browser.ViewFixture).
"""

from __future__ import annotations

import copy
import mimetypes
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import pytest

from test_performance_views_browser import STATIC, ViewFixture, browser  # noqa: F401


class RunPage(ViewFixture):
    """The run page, with motion on (entrance animations are under test) and
    a live-status probe whose answers the test sets."""

    def __init__(self, browser, **kwargs):
        super().__init__(browser, "run", **kwargs)
        self.context.close()
        self.context = browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self.route)
        self.live = None
        self.live_requests = 0

    def route(self, route):
        path = urlparse(route.request.url).path
        if path.endswith("/live-status"):
            self.live_requests += 1
            route.fulfill(json=dict(self.live or {}, run_id="run-1"))
            return
        super().route(route)

    def mark(self, selector):
        return self.page.evaluate(
            """selector => {
              const nodes = [...document.querySelectorAll(selector)];
              nodes.forEach((node, index) => { node.__keep = 'kept-' + index; });
              return nodes.length;
            }""",
            selector,
        )

    def marks(self, selector):
        return self.page.evaluate(
            "selector => [...document.querySelectorAll(selector)].map(node => node.__keep || null)",
            selector,
        )

    def watch_list(self):
        """Count moments where the item list lost its cards (a flash)."""
        self.page.evaluate("""() => {
              window.__flashes = 0;
              const grid = document.getElementById('items-grid');
              new MutationObserver(() => {
                if (!grid.querySelector('.item-card')) window.__flashes++;
              }).observe(grid, {childList: true, subtree: true, characterData: true});
            }""")

    def top(self, selector):
        return self.page.evaluate(
            "selector => document.querySelector(selector).getBoundingClientRect().top",
            selector,
        )


CARDS = "#items-grid > .item-card"
OVERVIEW = "#overview-primary-section .metric-card, #overview-deep-section > *"


def test_opening_an_item_redraws_only_that_card(browser):
    view = RunPage(browser)
    try:
        view.goto()
        page = view.page
        page.wait_for_selector("#overview-primary-section .metric-card")
        cards = view.mark(CARDS)
        overview = view.mark(OVERVIEW)
        latency = len(view.latency_selections())
        details = sum(1 for _, verb, _ in view.requests if verb == "details")

        page.locator(CARDS).nth(2).click()
        page.wait_for_selector(CARDS + ":nth-child(3) .item-input-row")
        marks = view.marks(CARDS)
        assert len(marks) == cards
        assert marks[2] is None, "the opened card is redrawn"
        assert all(mark for index, mark in enumerate(marks) if index != 2), marks
        assert all(view.marks(OVERVIEW)) and len(view.marks(OVERVIEW)) == overview
        assert (
            len(view.latency_selections()) == latency
        ), "step latency is not refetched"
        assert (
            sum(1 for _, verb, _ in view.requests if verb == "details") == details + 1
        )

        # Close it with the keyboard: focus stays on the card it toggled.
        header = page.locator(CARDS + ":nth-child(3) [data-item-expand]")
        header.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(CARDS + ":nth-child(3).item-collapsed")
        assert page.evaluate(
            "() => document.activeElement.closest('.item-card') === document.querySelector('#items-grid > .item-card:nth-child(3)')"
        )
        marks = view.marks(CARDS)
        assert all(mark for index, mark in enumerate(marks) if index != 2), marks
    finally:
        view.close()


def test_sort_page_and_display_changes_keep_the_overview_and_step_latency(browser):
    view = RunPage(browser)
    try:
        view.goto()
        page = view.page
        page.wait_for_selector("#overview-primary-section .metric-card")
        page.wait_for_timeout(1200)
        overview = view.mark(OVERVIEW)
        latency = len(view.latency_selections())
        first = page.locator(CARDS).first.get_attribute("data-item-id")

        page.evaluate("""() => {
              const select = document.getElementById('sort-select');
              select.value = 'latency_desc';
              select.dispatchEvent(new Event('change'));
            }""")
        page.wait_for_function(
            "first => document.querySelector('#items-grid > .item-card').dataset.itemId !== first",
            arg=first,
        )
        page.locator('#pagination [aria-label="Next page"]').click()
        view.settled()
        page.evaluate("() => document.getElementById('item-text-mode')?.click()")
        view.settled()
        assert view.marks(OVERVIEW) == [f"kept-{index}" for index in range(overview)]
        assert len(view.latency_selections()) == latency
    finally:
        view.close()


def test_search_keeps_rows_on_screen_and_the_toolbar_still(browser):
    view = RunPage(browser)
    try:
        view.goto()
        page = view.page
        page.wait_for_timeout(1200)
        view.watch_list()
        page.evaluate(
            "() => document.querySelector('.items-comparison').scrollIntoView()"
        )
        before = view.top("#items-search")
        page.fill("#items-search", "needle-1")
        page.wait_for_function(
            "() => !document.querySelector('#filter-count').textContent.includes('260 of')"
        )
        view.settled()
        page.wait_for_timeout(300)
        assert (
            page.evaluate("window.__flashes") == 0
        ), "the list never collapses to a loading line"
        assert (
            abs(view.top("#items-search") - before) < 2
        ), "the search box does not move"
        # The overview's cards updated in place without replaying their entrance.
        assert page.evaluate(
            """() => [...document.querySelectorAll('#overview-primary-section .metric-card')]
              .every(card => getComputedStyle(card).animationName === 'none')"""
        )
        assert page.locator("#items-grid.is-refreshing").count() == 0
    finally:
        view.close()


def test_a_chart_filter_keeps_its_section_in_place(browser):
    """A score-distribution bar filters without moving the overview (C028).
    A Pass/Fail bar is the exception the C065 decision asks for: it lands on
    the filtered item list."""
    view = RunPage(browser)
    run = view.data["run-1"]
    for row in run["snapshot"]["rows"]:
        row["metric_values"][1] = 0.05 if row["index"] % 2 else 0.95
    run["snapshot"]["metric_specs"]["count"] = {
        "score_type": "percentage",
        "direction": "maximize",
    }
    try:
        view.goto()
        page = view.page
        bar = "#overview-primary-section .dist-chart .dist-chart-col[data-bucket-min]"
        page.wait_for_selector(bar)
        page.wait_for_timeout(1200)
        page.evaluate("""() => {
              const host = document.querySelector('.run-container');
              const section = document.getElementById('overview-primary-section');
              host.scrollTop += section.getBoundingClientRect().top - 120;
            }""")
        before = view.top("#overview-primary-section")
        page.locator(bar).first.click()
        page.wait_for_function(
            "() => !document.querySelector('#filter-count').textContent.includes('260 of')"
        )
        page.wait_for_timeout(300)
        assert abs(view.top("#overview-primary-section") - before) < 2
    finally:
        view.close()


def test_an_empty_score_bar_is_not_a_filter(browser):
    """Clicking a bar with no items used to filter to nothing: the overview
    vanished and the page jumped to the top, taking the chart with it."""
    view = RunPage(browser)
    run = view.data["run-1"]
    for row in run["snapshot"]["rows"]:
        row["metric_values"][1] = 0.05 if row["index"] % 2 else 0.95
    run["snapshot"]["metric_specs"]["count"] = {
        "score_type": "percentage",
        "direction": "maximize",
    }
    try:
        view.goto()
        page = view.page
        chart = "#overview-primary-section .dist-chart"
        page.wait_for_selector(chart + " .dist-chart-col.is-empty")
        empty = page.locator(chart + " .dist-chart-col.is-empty")
        assert empty.count() == 9, "bins 10% to 80% and 100% hold no items"
        assert page.locator(chart + " .dist-chart-col.is-empty[data-bucket-min]").count() == 0
        assert empty.first.evaluate("node => getComputedStyle(node).cursor") == "default"
        count = page.locator("#filter-count").inner_text()
        empty.nth(3).click()
        page.wait_for_timeout(300)
        assert page.locator("#filter-count").inner_text() == count
        assert page.locator("#overview-primary-section .metric-card").count() > 0
        # A bar with items still filters.
        page.locator(chart + " .dist-chart-col[data-bucket-min]").first.click()
        page.wait_for_function(
            "count => document.querySelector('#filter-count').textContent !== count",
            arg=count,
        )
    finally:
        view.close()


def test_a_shorter_list_near_the_page_end_keeps_the_toolbar_still(browser):
    """Switching to the heatmap at the end of the page shrinks the list under
    the reader: the browser used to clamp the scroll and slide the toolbar."""
    view = RunPage(browser, count=40, samples=3)
    try:
        view.goto()
        page = view.page
        page.wait_for_timeout(1200)
        # The search box near the top of the screen, the list's end in view.
        page.evaluate("""() => {
              const host = document.querySelector('.run-container');
              const search = document.getElementById('items-search');
              host.scrollTop += search.getBoundingClientRect().top - host.getBoundingClientRect().top - 120;
            }""")
        assert page.evaluate("""() => {
              const host = document.querySelector('.run-container');
              return host.scrollHeight - host.clientHeight - host.scrollTop < 1200;
            }"""), "the list ends less than the heatmap's saving below the screen"
        page.locator("#btn-item-display").click()
        before = view.top("#items-search")
        page.locator('[data-items-view="heatmap"]').click()
        page.wait_for_selector("#items-grid.heatmap-mode")
        page.wait_for_timeout(300)
        assert abs(view.top("#items-search") - before) < 2
        # Scrolling back up takes the spare room away again.
        page.evaluate("() => { document.querySelector('.run-container').scrollTop = 0; }")
        page.wait_for_timeout(100)
        assert page.evaluate(
            "() => (document.querySelector('.run-scroll-reserve')?.offsetHeight || 0)"
        ) == 0
    finally:
        view.close()


def test_closing_an_item_at_the_page_end_keeps_it_in_place(browser):
    view = RunPage(browser, count=10)
    try:
        view.goto()
        page = view.page
        last = CARDS + ":last-child"
        page.locator(last).click()
        page.wait_for_selector(last + " .item-input-row")
        page.evaluate("""() => {
              const host = document.querySelector('.run-container');
              host.scrollTop = host.scrollHeight;
            }""")
        before = view.top(last)
        page.locator(last + " [data-item-expand]").click()
        page.wait_for_selector(last + ".item-collapsed")
        assert abs(view.top(last) - before) < 2
    finally:
        view.close()


def test_root_cause_metric_without_results_keeps_the_select_still(browser):
    """A metric without root causes shows only the select (no empty report),
    but its row used to lose the title's height, so the select jumped up
    under the pointer."""
    view = RunPage(browser, count=40)
    for row in view.data["run-1"]["snapshot"]["rows"]:
        if row["index"] % 4 == 0:
            row["item_metadata"]["metric_analyses"] = {
                "accuracy": {
                    "root_cause_issues": [
                        {"category": "Reasoning Error", "subcategory": "Skipped a step"}
                    ]
                }
            }
    try:
        view.goto()
        page = view.page
        select = "#root-cause-metric-select"
        page.wait_for_selector(select)
        page.wait_for_timeout(1200)
        page.evaluate(
            "s => document.querySelector(s).scrollIntoView({block: 'center'})", select
        )
        before = view.top(select)
        page.select_option(select, "count")
        page.wait_for_function(
            "() => !document.querySelector('#root-cause-section .rc-category-card')"
        )
        assert abs(view.top(select) - before) < 2
        assert page.locator("#root-cause-section .section-title").count() == 0
        page.select_option(select, "accuracy")
        page.wait_for_selector("#root-cause-section .rc-category-card")
        assert abs(view.top(select) - before) < 2
    finally:
        view.close()


def _scroll_to_the_end(page):
    page.evaluate("""() => {
          const host = document.querySelector('.run-container');
          host.scrollTop = host.scrollHeight;
        }""")
    page.wait_for_timeout(150)


def _on_screen(view, selector):
    top = view.top(selector)
    assert 0 < top < view.page.viewport_size["height"] - 40, (selector, top)
    return top


def test_section_controls_near_the_page_end_keep_their_place(browser):
    """A control that redraws its own section (the root-cause metric, a
    category chip, the category view) used to slide down under the pointer
    near the page end: the section got shorter, the browser clamped the
    scroll, and everything above moved by the difference."""
    view = RunPage(browser, count=6)
    for row in view.data["run-1"]["snapshot"]["rows"]:
        if row["index"] % 2 == 0:
            row["item_metadata"]["metric_analyses"] = {
                "accuracy": {
                    "root_cause_issues": [
                        {"category": "Reasoning Error", "subcategory": "Skipped a step"}
                    ]
                }
            }
    try:
        view.page.set_viewport_size({"width": 1440, "height": 1700})
        view.goto()
        page = view.page
        select = "#root-cause-metric-select"
        page.wait_for_selector("#root-cause-section .rc-category-card")
        page.wait_for_timeout(1200)

        _scroll_to_the_end(page)
        before = _on_screen(view, select)
        page.select_option(select, "count")
        page.wait_for_function(
            "() => !document.querySelector('#root-cause-section .rc-category-card')"
        )
        page.wait_for_timeout(100)
        assert abs(view.top(select) - before) < 2, "the shorter section moved it"
        page.select_option(select, "accuracy")
        page.wait_for_selector("#root-cause-section .rc-category-card")
        page.wait_for_timeout(100)
        assert abs(view.top(select) - before) < 2, "the taller section moved it"
    finally:
        view.close()


def test_category_controls_near_the_page_end_keep_their_section_still(browser):
    view = RunPage(browser, count=6)
    try:
        view.page.set_viewport_size({"width": 1440, "height": 1700})
        view.goto()
        page = view.page
        chips = "#metadata-breakdown .category-chip.selected"
        page.wait_for_selector(chips)
        page.wait_for_timeout(1200)
        # Hiding a category group shortens the section under the reader.
        _scroll_to_the_end(page)
        before = _on_screen(view, "#metadata-breakdown")
        page.locator(chips).first.click()
        page.wait_for_timeout(400)  # the debounced breakdown redraw too
        assert abs(view.top("#metadata-breakdown") - before) < 2, "a category chip"
        page.locator("#metadata-breakdown .category-chip:not(.selected)").first.click()
        page.wait_for_timeout(400)
        assert abs(view.top("#metadata-breakdown") - before) < 2, "the chip again"
        # The Compare view is shorter than the cards.
        _scroll_to_the_end(page)
        before = _on_screen(view, "#metadata-breakdown")
        page.locator('#metadata-breakdown [data-category-view="compare"]').click()
        page.wait_for_selector('#metadata-breakdown [data-category-view="compare"].active')
        page.wait_for_timeout(200)
        assert abs(view.top("#metadata-breakdown") - before) < 2, "the view toggle"
    finally:
        view.close()


def test_closing_step_latency_near_the_page_end_keeps_its_header_still(browser):
    view = RunPage(browser, count=4)
    try:
        view.page.set_viewport_size({"width": 1440, "height": 1700})
        view.page.add_init_script(
            "try { localStorage.setItem('qym.stepLatency.open', '1'); } catch (e) {}"
        )
        view.goto()
        page = view.page
        page.wait_for_selector("#step-latency-panel .sl-plot")
        page.wait_for_timeout(1200)
        _scroll_to_the_end(page)
        disclosure = "#step-latency-panel [data-sl-disclosure]"
        before = _on_screen(view, disclosure)
        page.locator(disclosure).click()
        page.wait_for_function(
            "() => !document.querySelector('#step-latency-panel .sl-plot')"
        )
        page.wait_for_timeout(100)
        assert abs(view.top(disclosure) - before) < 2
    finally:
        view.close()


def test_live_refresh_during_a_text_search_keeps_the_cards(browser):
    """A live refresh forgets earlier search answers, so the redraw waits on a
    new search. It used to lose its in-place option there and rebuild every
    card on screen."""
    view = RunPage(browser, count=30)
    run = view.data["run-1"]
    run["run"]["status"] = "RUNNING"
    run["run"]["started_at"] = "2026-10-01T00:00:00Z"
    all_rows = run["snapshot"]["rows"]
    run["snapshot"]["rows"] = all_rows[:24]
    view.count = 24
    view.live = {"status": "RUNNING", "live": True, "revision": "r1"}
    page = view.page
    try:
        page.clock.install(time=datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc))
        view.goto()
        page.fill("#items-search", "needle-1")
        page.clock.run_for(400)
        page.wait_for_function(
            "() => document.querySelector('#filter-count').textContent.includes('11 of 24')"
        )
        view.settled()
        cards = view.mark(CARDS)
        assert cards == 11

        # The list is never dimmed or blocked by a live refresh.
        page.evaluate("""() => {
              window.__dimmed = 0;
              const grid = document.getElementById('items-grid');
              new MutationObserver(() => {
                if (grid.classList.contains('is-refreshing')) window.__dimmed++;
              }).observe(grid, {attributes: true, attributeFilter: ['class']});
            }""")
        run["snapshot"]["rows"] = all_rows
        view.live = {"status": "RUNNING", "live": True, "revision": "r2"}
        page.clock.run_for(3500)
        page.wait_for_function(
            "() => document.querySelector('#filter-count').textContent.includes('of 30')"
        )
        view.settled()
        assert view.marks(CARDS) == [f"kept-{index}" for index in range(cards)]
        assert page.evaluate("window.__dimmed") == 0

        # A new revision without new or changed rows asks for no new search.
        searches = sum(1 for _, verb, _ in view.requests if verb == "search")
        view.live = {"status": "RUNNING", "live": True, "revision": "r3"}
        page.clock.run_for(3500)
        page.wait_for_timeout(300)
        assert sum(1 for _, verb, _ in view.requests if verb == "search") == searches
        assert page.evaluate("window.__dimmed") == 0
    finally:
        view.close()


def test_live_page_starts_from_the_revision_its_rows_were_served_at(browser):
    """The first probe used to always reload the whole run."""
    view = RunPage(browser, count=10)
    run = view.data["run-1"]
    run["run"]["status"] = "RUNNING"
    run["run"]["live_revision"] = "r1"
    view.count = 10
    view.live = {"status": "RUNNING", "live": True, "revision": "r1"}
    page = view.page
    try:
        page.clock.install(time=datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc))
        view.goto()
        loads = sum(1 for _, verb, _ in view.requests if verb == "snapshot")
        page.clock.run_for(3500)
        page.clock.run_for(3500)
        page.wait_for_function("() => document.getElementById('run-live-indicator')")
        assert view.live_requests >= 2
        assert sum(1 for _, verb, _ in view.requests if verb == "snapshot") == loads
    finally:
        view.close()


def test_live_reloads_of_a_repeat_run_count_its_passes(browser):
    """A repeat run's rows carry every pass, so a reload costs the server
    rows x passes. 200 items x 3 passes used to reload every 3 s like a
    200-row run."""
    view = RunPage(browser, count=200, samples=3)
    run = view.data["run-1"]
    run["run"]["status"] = "RUNNING"
    run["run"]["live_revision"] = "r1"
    view.count = 200
    view.live = {"status": "RUNNING", "live": True, "revision": "r1"}
    page = view.page
    try:
        page.clock.install(time=datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc))
        view.goto()
        loads = sum(1 for _, verb, _ in view.requests if verb == "snapshot")
        view.live = {"status": "RUNNING", "live": True, "revision": "r2"}
        page.clock.run_for(3500)
        page.clock.run_for(3500)
        page.wait_for_timeout(300)
        assert view.live_requests >= 2
        assert sum(1 for _, verb, _ in view.requests if verb == "snapshot") == loads
        page.clock.run_for(4000)
        for _ in range(50):
            if sum(1 for _, verb, _ in view.requests if verb == "snapshot") > loads:
                break
            page.wait_for_timeout(100)
        assert sum(1 for _, verb, _ in view.requests if verb == "snapshot") == loads + 1
    finally:
        view.close()


def test_export_keeps_the_bodies_of_items_opened_in_place(browser):
    """Closing the export dialog releases bodies of items not on screen. Items
    opened in place used to count as not on screen, so their bodies went and
    had to be fetched again."""
    view = RunPage(browser, count=30)
    try:
        view.goto()
        page = view.page
        page.locator(CARDS).nth(2).click()
        page.wait_for_selector(CARDS + ":nth-child(3) .item-input-row")
        page.locator("#export-filtered-btn").click()
        page.locator("#export-modal-cancel").click()
        details = sum(1 for _, verb, _ in view.requests if verb == "details")
        header = CARDS + ":nth-child(3) [data-item-expand]"
        page.locator(header).click()
        page.wait_for_selector(CARDS + ":nth-child(3).item-collapsed")
        page.locator(CARDS + ":nth-child(3)").click()
        page.wait_for_selector(CARDS + ":nth-child(3) .item-input-row")
        page.wait_for_timeout(200)
        assert sum(1 for _, verb, _ in view.requests if verb == "details") == details
    finally:
        view.close()


def test_folded_trace_tiles_never_paint_on_a_redraw(browser):
    """Per-agent latency tiles fold into Trace latency. They used to fold on a
    250 ms timer, so each overview redraw showed them, then took them away."""
    view = _trace_stats_page(
        browser,
        {
            "has_spans": True,
            "avg_tokens": 1510,
            "avg_llm_calls": 2.1,
            "avg_tool_calls": 2.4,
            "tool_success_rate": 0.94,
            "avg_llm_ms": 1040,
            "avg_tool_ms": 470,
            "avg_top_level_chain_ms": 2110,
            "outer_scope_parent_spans": [
                {"name": "planner", "avg_ms": 800},
                {"name": "writer", "avg_ms": 900},
            ],
        },
    )
    try:
        page = view.page
        visible_folded = """() => [...document.querySelectorAll('.system-trace-card .trace-pill')]
              .filter(pill => /^Avg (planner|writer) latency$/.test(pill.querySelector('.trace-pill-label').textContent))
              .filter(pill => pill.offsetHeight > 0).length"""
        page.wait_for_function(f"({visible_folded})() === 0")
        page.wait_for_selector(".metric-bool-seg[data-bool-filter]")
        # Redraw the overview with a filter and look in the same task, before
        # any timer can run.
        shown = page.evaluate(f"""() => {{
              document.querySelector('.metric-bool-seg[data-bool-filter]').click();
              return ({visible_folded})();
            }}""")
        assert shown == 0
    finally:
        view.close()


def _trace_stats_page(browser, trace_stats):
    view = RunPage(browser)
    view.data["run-1"]["run"]["trace_stats"] = trace_stats
    view.goto()
    view.page.wait_for_selector(".system-trace-card")
    return view


def test_trace_stats_show_only_what_was_captured(browser):
    view = _trace_stats_page(
        browser,
        {
            "has_spans": True,
            "avg_tokens": 0,
            "avg_llm_calls": 0.0,
            "avg_tool_calls": 0.0,
            "tool_success_rate": None,
            "avg_llm_ms": None,
            "avg_tool_ms": None,
            "avg_retriever_ms": None,
            "avg_top_level_chain_ms": 1200,
            "avg_evaluator_ms": 300,
        },
    )
    try:
        card = view.page.locator(".system-trace-card")
        labels = card.locator(".trace-pill-label").all_text_contents()
        assert labels == ["Avg Trace Latency", "Avg Evaluator Latency"]
        note = card.locator(".trace-not-captured")
        assert "LLM and tool spans were not captured for this run" in note.inner_text()
        assert "#sdk-guide/results" in note.locator("a").get_attribute("href")
        text = card.inner_text()
        for emoji in ("⚡", "\U0001f4dd", "\U0001f9e0", "\U0001f527", "\U0001f50e"):
            assert emoji not in text
        # Values read in the primary text color, not decorative tints.
        assert card.locator(".trace-pill-val[style]").count() == 0
        assert card.locator(".trace-pill-icon svg").count() == 2
    finally:
        view.close()


def test_trace_stats_keep_captured_llm_and_tool_tiles(browser):
    view = _trace_stats_page(
        browser,
        {
            "has_spans": True,
            "avg_tokens": 1510,
            "avg_llm_calls": 2.1,
            "avg_tool_calls": 2.4,
            "tool_success_rate": 0.94,
            "avg_llm_ms": 1040,
            "avg_tool_ms": 470,
            "avg_retriever_ms": None,
            "avg_top_level_chain_ms": 2110,
            "avg_evaluator_ms": None,
        },
    )
    try:
        card = view.page.locator(".system-trace-card")
        assert card.locator(".trace-pill-label").all_text_contents() == [
            "Avg Tokens",
            "Avg LLM Calls",
            "Avg Tool Calls",
            "Tool Success",
            "Avg LLM Latency",
            "Avg Tool Latency",
            "Avg Trace Latency",
        ]
        assert card.locator(".trace-not-captured").count() == 0
    finally:
        view.close()


def test_execution_context_has_no_decorative_dots(browser):
    view = RunPage(browser)
    view.data["run-1"]["run"]["config"] = {"temperature": 0.2, "max_retries": 2}
    try:
        view.goto()
        assert view.page.locator(".context-cell").count() == 2
        assert view.page.locator(".context-cell-dot").count() == 0
    finally:
        view.close()


def test_step_latency_starts_collapsed_on_the_run_page(browser):
    view = RunPage(browser)
    try:
        view.goto()
        page = view.page
        disclosure = page.locator("#step-latency-panel [data-sl-disclosure]")
        disclosure.wait_for()
        assert disclosure.get_attribute("aria-expanded") == "false"
        assert page.locator("#step-latency-panel .sl-plot").count() == 0
        assert "1 step" in page.locator("#step-latency-panel .sl-summary").inner_text()
        disclosure.click()
        page.wait_for_selector("#step-latency-panel .sl-plot svg")
        assert (
            page.locator("#step-latency-panel [data-sl-disclosure]").get_attribute(
                "aria-expanded"
            )
            == "true"
        )
        # Opening it used the data already loaded.
        assert len(view.latency_selections()) == 1
    finally:
        view.close()


def test_running_run_follows_new_items_in_place(browser):
    view = RunPage(browser, count=30)
    run = view.data["run-1"]
    run["run"]["status"] = "RUNNING"
    run["run"]["started_at"] = "2026-10-01T00:00:00Z"
    all_rows = run["snapshot"]["rows"]
    run["snapshot"]["rows"] = all_rows[:24]
    view.count = 24
    view.live = {"status": "RUNNING", "live": True, "revision": "r1"}
    page = view.page
    try:
        page.clock.install(time=datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc))
        view.goto()
        page.locator(CARDS).nth(1).click()
        page.wait_for_selector(CARDS + ":nth-child(2) .item-input-row")
        cards = view.mark(CARDS)
        runtime = page.locator("#hero-runtime").inner_text()
        assert page.locator("#run-live-indicator").inner_text().startswith("Live")
        # It changes every second: no live region announcing each tick.
        assert page.evaluate("""() => {
              const node = document.getElementById('run-live-indicator');
              const region = node.closest('[role=status], [role=alert], [aria-live]');
              return !region || region.getAttribute('aria-live') === 'off';
            }""")

        # Six more items arrive.
        run["snapshot"]["rows"] = all_rows
        view.live = {"status": "RUNNING", "live": True, "revision": "r2"}
        page.clock.run_for(3500)
        page.wait_for_function(
            "() => document.querySelector('#filter-count').textContent.includes('30 of 30')"
        )
        assert (
            page.locator("#hero-runtime").inner_text() != runtime
        ), "Runtime counts up"
        # The page on screen did not change: its cards stay, the opened one too.
        assert view.marks(CARDS) == [f"kept-{index}" for index in range(cards)]
        assert page.locator(CARDS + ":nth-child(2) .item-input-row").count() == 1

        # The run ends: one last load, then the page stops following it.
        run["run"]["status"] = "COMPLETED"
        run["run"]["ended_at"] = "2026-10-01T00:01:30Z"
        view.live = {"status": "COMPLETED", "live": False, "revision": "r3"}
        page.clock.run_for(3500)
        page.wait_for_function(
            "() => document.querySelector('#run-summary .hero-status').textContent.includes('COMPLETED')"
        )
        page.wait_for_function("() => !document.getElementById('run-live-indicator')")
        probes = view.live_requests
        page.clock.run_for(15000)
        assert view.live_requests == probes
    finally:
        view.close()


def test_hidden_tab_is_not_polled(browser):
    view = RunPage(browser, count=10)
    view.data["run-1"]["run"]["status"] = "RUNNING"
    view.count = 10
    view.live = {"status": "RUNNING", "live": True, "revision": "r1"}
    page = view.page
    try:
        page.clock.install(time=datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc))
        view.goto()
        page.clock.run_for(3500)
        page.wait_for_function("() => document.getElementById('run-live-indicator')")
        page.evaluate("""() => {
              Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
              document.dispatchEvent(new Event('visibilitychange'));
            }""")
        page.clock.run_for(3500)
        probes = view.live_requests
        page.clock.run_for(20000)
        assert view.live_requests == probes
        page.evaluate("""() => {
              Object.defineProperty(document, 'hidden', {configurable: true, get: () => false});
              document.dispatchEvent(new Event('visibilitychange'));
            }""")
        for _ in range(50):
            if view.live_requests > probes:
                break
            page.wait_for_timeout(100)
        assert view.live_requests > probes, "polling resumes when the tab shows"
    finally:
        view.close()


# ── Analyzer (C027) ─────────────────────────────────────────────────────────


def _analyzer_run():
    rows = []
    for index in range(6):
        rows.append(
            {
                "item_id": f"item-{index}",
                "index": index,
                "input": {"question": f"question {index}"},
                "input_full": {"question": f"question {index}"},
                "output": f"answer {index}",
                "output_full": f"answer {index}",
                "metric_values": [0.4],
                "metric_meta": {"quality": {}},
                "item_metadata": {},
                "pass_scores": {"quality": [0.1, 0.9, 0.2]},
                "pass_attempts": [
                    {
                        "pass_number": number,
                        "status": "completed",
                        "output": f"pass {number}",
                    }
                    for number in (1, 2, 3)
                ],
            }
        )
    return {
        "run": {
            "run_id": "run-1",
            "file_path": "run-1",
            "run_name": "Repeat run",
            "metric_names": ["quality"],
            "samples": 3,
            "metadata": {},
        },
        "snapshot": {
            "metric_names": ["quality"],
            "metric_specs": {
                "quality": {"pass_threshold": 0.5, "direction": "maximize"}
            },
            "rows": rows,
        },
    }


def test_analyzer_loads_one_sample_and_switches_in_place(browser):
    from qym_platform.services.run_payloads import compact_row, scope_row_to_pass

    context = browser.new_context(
        viewport={"width": 1440, "height": 1000}, reduced_motion="reduce"
    )
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    requests = []
    held = []
    data = _analyzer_run()

    def route(route):
        request = route.request
        parsed = urlparse(request.url)
        path, query = parsed.path, parse_qs(parsed.query)
        if path.startswith("/static/"):
            file = STATIC / path.split("/static/", 1)[1]
            route.fulfill(
                path=str(file),
                content_type=mimetypes.guess_type(file.name)[0] or "text/plain",
            )
            return
        if path == "/projects/demo/runs/run-1/analyzer":
            route.fulfill(
                body=(STATIC / "analyzer.html").read_text(), content_type="text/html"
            )
            return
        if path == "/v1/me":
            route.fulfill(
                json={
                    "email": "a@example.test",
                    "projects": [
                        {"id": "p", "name": "Demo", "slug": "demo", "role": "manager"}
                    ],
                }
            )
            return
        if path == "/api/runs/run-1":
            view = query.get("view", ["full"])[0]
            requests.append(("run", view, query.get("pass_number", [None])[0]))
            payload = copy.deepcopy(data)
            if view == "summary":
                payload["snapshot"]["rows"] = []
            elif view == "compact":
                rows = [compact_row(row) for row in payload["snapshot"]["rows"]]
                if "pass_number" in query:
                    rows = [
                        scope_row_to_pass(row, int(query["pass_number"][0]))
                        for row in rows
                    ]
                payload["snapshot"]["rows"] = rows
            route.fulfill(json=payload)
            return
        if path == "/api/runs/run-1/passes":
            requests.append(("passes", None, None))
            route.fulfill(
                json={
                    "passes": [
                        {
                            "pass_number": number,
                            "status": "completed",
                            "items_scored": 6,
                            "items_total": 6,
                        }
                        for number in (1, 2, 3)
                    ]
                }
            )
            return
        if path == "/api/runs/run-1/items/details":
            body = request.post_data_json
            requests.append(("details", len(body["item_ids"]), None))
            rows = [
                dict(row, __details_loaded=True)
                for row in data["snapshot"]["rows"]
                if row["item_id"] in body["item_ids"]
            ]
            route.fulfill(json={"rows": rows})
            return
        if path.endswith("/analysis-config"):
            route.fulfill(
                json={
                    "llm_configured": True,
                    "model": "m",
                    "llm_connections": [
                        {
                            "id": "c",
                            "name": "C",
                            "llm_model": "m",
                            "llm_api_key_set": True,
                        }
                    ],
                }
            )
            return
        if path.endswith("/analysis-documents"):
            route.fulfill(json={"documents": []})
            return
        if path.endswith("/analysis-jobs") and request.method == "POST":
            held.append(route)  # still starting: no job id yet
            return
        route.fulfill(json={})

    page.route("**/*", route)
    try:
        page.goto("http://qym.test/projects/demo/runs/run-1/analyzer")
        page.wait_for_selector("#analysis-pass-picker-select")
        # The picker needs the run header and the sample list only.
        assert requests == [("run", "summary", None), ("passes", None, None)] or sorted(
            requests
        ) == sorted([("run", "summary", None), ("passes", None, None)])
        page.evaluate("() => { window.__samePage = true; }")
        page.select_option("#analysis-pass-picker-select", "2")
        page.click("#analysis-pass-picker-continue")
        page.wait_for_selector("#analysis-pass-select")
        assert ("run", "compact", "2") in requests
        assert not [entry for entry in requests if entry[:2] == ("run", "full")]
        assert "pass=2" in page.url
        assert page.evaluate("() => window.__samePage === true"), "no page reload"

        requests.clear()
        page.select_option("#analysis-pass-select", "3")
        page.wait_for_function("() => location.search.includes('pass=3')")
        assert requests[0] == ("run", "compact", "3")
        assert page.evaluate("() => window.__samePage === true"), "no page reload"
        link = page.locator(
            ".analysis-run-header > .analysis-secondary-link"
        ).get_attribute("href")
        assert link.endswith("?pass=3")

        # Results shown for the previous sample go with it.
        page.evaluate(
            "() => { document.getElementById('pg-runall-results').innerHTML = '<p>sample 3 result</p>'; }"
        )
        page.select_option("#analysis-pass-select", "2")
        page.wait_for_function("() => location.search.includes('pass=2')")
        assert page.locator("#pg-runall-results").inner_text() == ""

        # An analysis that is still starting (its job id not back yet, so no
        # Cancel shows) keeps its sample: no switch under it.
        page.select_option("#analysis-pass-select", "3")  # sample 3 has failures
        page.wait_for_function("() => location.search.includes('pass=3')")
        run_button = page.locator("#pg-runall-btn")
        page.wait_for_function("() => !document.getElementById('pg-runall-btn').disabled")
        run_button.click()
        for _ in range(50):
            if held:
                break
            page.wait_for_timeout(100)
        assert held, "the analysis job request is on its way"
        assert page.locator("#pg-cancel-btn").is_hidden()
        requests.clear()
        page.select_option("#analysis-pass-select", "1")
        page.wait_for_timeout(300)
        assert requests == []
        assert page.locator("#analysis-pass-select").input_value() == "3"
        assert "pass=3" in page.url
        assert not errors, errors
    finally:
        context.close()
