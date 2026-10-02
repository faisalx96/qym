"""Reviews All tab: bulk actions act only on the rows they fit (real browser).

Approve and reject decide pending corrections; reset withdraws a decision.
In the All tab a selection can mix statuses: each bulk button sends only the
rows it fits, says how many it acts on, and the result names how many were
skipped (P1 round 2, final-review decision on C042/C074).
"""

from __future__ import annotations

import json

import pytest

from test_reviews_queue_browser import (  # noqa: F401  (fixtures)
    _open_reviews,
    app,
    browser,
    factory,
)

pytestmark = pytest.mark.browser

BUSY_DONE = "document.getElementById('correction-list').getAttribute('aria-busy') === 'false'"


def _all_tab_newest_first(app):
    page = _open_reviews(app)
    page.select_option("#sort-select", "newest")
    page.wait_for_function(BUSY_DONE)
    page.click('[role="tab"][data-filter=""]')
    page.wait_for_function(BUSY_DONE)
    page.locator(".correction-card.status-approved").first.wait_for()
    return page


def _select(page, status, count):
    ids = []
    for index in range(count):
        card = page.locator(f".correction-card.status-{status}").nth(index)
        card.locator("[data-check]").check()
        ids.append(int(card.get_attribute("data-id")))
    return ids


def _bulk_bodies(app, action):
    return [
        json.loads(body)
        for method, target, body in app.requests
        if method == "POST" and target.startswith("/api/corrections/bulk") and json.loads(body)["action"] == action
    ]


def test_all_tab_bulk_approve_sends_only_pending_rows_and_names_the_skipped(app):
    page = _all_tab_newest_first(app)
    pending = _select(page, "pending", 2)
    approved = _select(page, "approved", 3)
    assert page.locator("#bulk-count").inner_text() == "5"
    # Each decision button says how many of the selection it acts on.
    assert page.locator("#bulk-approve").inner_text().split() == ["Approve", "2"]
    assert page.locator("#bulk-reject").inner_text().split() == ["Reject", "2"]
    assert page.locator("#bulk-reset").inner_text().split() == ["Reset", "3"]
    assert "3 are not pending and will be skipped" in page.locator("#bulk-approve").get_attribute("title")

    page.click("#bulk-approve")
    page.wait_for_function("document.getElementById('action-modal').classList.contains('open')")
    description = page.locator("#modal-desc").inner_text()
    assert "2 selected corrections in All will be approved" in description
    assert "3 selected corrections are not pending and will be skipped." in description
    page.click("#modal-confirm")
    page.wait_for_function(
        "[...document.querySelectorAll('.toast, [role=\"status\"], [role=\"alert\"]')]"
        ".some(node => node.textContent.includes('2 corrections approved. 3 skipped (not pending) and still selected.'))"
    )
    bodies = _bulk_bodies(app, "approve")
    assert [sorted(body["ids"]) for body in bodies] == [sorted(pending)]
    assert bodies[0]["expected_count"] == 2 and "expected_status" not in bodies[0]
    for correction_id in pending:
        page.wait_for_function(
            f"document.querySelector('.correction-card[data-id=\"{correction_id}\"]').classList.contains('status-approved')"
        )
    # The skipped rows stay selected; nothing pending is left in the selection.
    assert page.locator("#bulk-count").inner_text() == "3"
    assert page.locator("#bulk-approve").get_attribute("aria-disabled") == "true"
    assert page.locator("#bulk-reset").inner_text() == "Reset"
    assert app.errors == []


def test_a_bulk_action_that_fits_no_selected_row_sends_nothing(app):
    page = _all_tab_newest_first(app)
    _select(page, "approved", 2)
    assert page.locator("#bulk-approve").get_attribute("aria-disabled") == "true"
    assert "Approve works on pending corrections only" in page.locator("#bulk-approve").get_attribute("title")
    # aria-disabled keeps the button focusable; a click (or Shift+A) says why.
    page.click("#bulk-approve", force=True)
    page.wait_for_function(
        "[...document.querySelectorAll('.toast, [role=\"status\"], [role=\"alert\"]')]"
        ".some(node => node.textContent.includes('None of the 2 selected corrections fits. Approve works on pending corrections only.'))"
    )
    page.locator(".correction-card.status-approved").first.focus()
    page.keyboard.press("Shift+A")
    assert not page.locator("#action-modal").evaluate("m => m.classList.contains('open')")
    assert _bulk_bodies(app, "approve") == []
    # Reset fits both and goes through.
    page.click("#bulk-reset")
    page.wait_for_function(
        "[...document.querySelectorAll('.toast, [role=\"status\"], [role=\"alert\"]')]"
        ".some(node => node.textContent.includes('2 corrections reset to pending.'))"
    )
    assert len(_bulk_bodies(app, "reset")) == 1
    assert app.errors == []
