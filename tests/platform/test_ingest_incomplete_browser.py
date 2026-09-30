"""The incomplete-ingest flag on the run page and the runs list (C024).

A run completed with events the platform rejected shows an "Incomplete data"
banner naming them on its page and an "Incomplete" tag in the runs list. The
names come from the client (item ids, error text), so they render as text.
"""

from __future__ import annotations

import pytest
from test_dashboard_paging_browser import (
    DashboardFixture,
    browser,
    make_runs,
)  # noqa: F401
from test_performance_views_browser import ViewFixture
from test_xss_rendering_browser import assert_inert, payload

pytestmark = pytest.mark.browser


def test_run_page_names_rejected_events_as_text(browser):
    fixture = ViewFixture(browser, "run", compact=False, count=6)
    fixture.data["run-1"]["run"]["metadata"] = {
        "ingest_incomplete": {
            "expected_items": 6,
            "received_items": 5,
            "rejected_events": 12,
            "rejected": [
                {
                    "type": "item_completed",
                    "item_id": payload("item_id"),
                    "sequence": 7,
                    "error": payload("error"),
                },
                {
                    "type": "metric_scored",
                    "item_id": None,
                    "sequence": 0,
                    "error": None,
                },
            ],
            "reason": "unused by the page",
        },
        "ingest_rejected": {"count": 12, "events": []},
    }
    page = fixture.page
    try:
        fixture.goto()
        banner = page.locator(".ingest-warning-banner")
        assert banner.count() == 1
        text = banner.inner_text()
        assert (
            banner.locator(".ingest-warning-title").text_content() == "Incomplete data"
        )
        assert "only 5 reached the platform (1 missing)" in text
        assert "The platform rejected 12 events from this run" in text
        items = banner.locator(".ingest-rejected-list li")
        assert items.count() == 3
        assert items.nth(0).inner_text() == (
            f"item_completed for item {payload('item_id')}: {payload('error')}"
        )
        assert items.nth(1).inner_text() == "metric_scored #0: rejected"
        assert items.nth(2).inner_text() == "and 10 more"
        # The tally is not shown as a metadata chip.
        assert "ingest_rejected" not in page.locator("#run-summary").inner_text()
        assert_inert(page)
    finally:
        fixture.close()


def test_run_page_without_a_flag_has_no_banner(browser):
    fixture = ViewFixture(browser, "run", compact=False, count=6)
    page = fixture.page
    try:
        fixture.goto()
        assert page.locator(".ingest-warning-banner").count() == 0
    finally:
        fixture.close()


def test_runs_list_tags_flagged_runs(browser):
    rows = make_runs(3)
    rows[0]["ingest_incomplete"] = {
        "missing_items": 0,
        "rejected_events": 1,
        "reason": "The platform rejected 1 event: item_completed for item "
        + payload("reason"),
    }
    rows[1]["ingest_incomplete"] = None
    fixture = DashboardFixture(browser, runs=rows)
    page = fixture.page
    try:
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function("__dashboardTest.state.flatRuns.length === 3")
        tag = page.locator('tr[data-file="run-000"] .status-incomplete')
        assert tag.inner_text() == "Incomplete"
        assert tag.get_attribute("title") == (
            "Incomplete data. The platform rejected 1 event: item_completed for item "
            + payload("reason")
        )
        assert page.locator(".status-incomplete").count() == 1
        assert_inert(page)
    finally:
        fixture.close()


def test_item_whose_completion_was_rejected_says_its_output_never_arrived(browser):
    """Its scores arrived, so it reads like a model that answered nothing
    unless the card says why the output and duration are missing. In a
    completed run the item is not received (its row state): no verdict, and
    left out of Execution success and the means."""
    fixture = ViewFixture(browser, "run", compact=False, count=6)
    run = fixture.data["run-1"]
    run["run"]["metadata"] = {
        "ingest_incomplete": {"expected_items": 6, "received_items": 6, "rejected_events": 1}
    }
    rejected = run["snapshot"]["rows"][2]
    rejected.update(
        status="not_received",
        output="",
        output_full="",
        latency_ms=0,
        output_received=False,
    )
    page = fixture.page
    try:
        fixture.goto()
        cards = page.locator("#items-grid .item-card")
        tag = cards.nth(2).locator(".qym-tag")
        assert tag.inner_text() == "Not received"
        assert "qym-tag--warning" in tag.get_attribute("class")
        cards.nth(2).locator(".item-header-expand").click()
        note = cards.nth(2).locator(".output-missing-note")
        note.wait_for()
        assert note.inner_text() == (
            "Output not received: the platform rejected this item's outcome event"
            " (see the notice above). The item is left out of Execution success"
            " and of the means."
        )
        # Items whose completion arrived carry no note.
        cards.nth(1).locator(".item-header-expand").click()
        cards.nth(1).locator(".output-text").wait_for()
        assert cards.nth(1).locator(".output-missing-note").count() == 0
        assert fixture.errors == []
    finally:
        fixture.close()
