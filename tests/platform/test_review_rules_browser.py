"""Locked scores, the Edited badge and Reset on the shipped Run and Compare pages (C041)."""

import copy
import os

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_performance_views_browser import ViewFixture

pytestmark = pytest.mark.browser

EDIT = {
    "action": "edit",
    "by_user_id": "user-2",
    "by": "Mo Member",
    "at": "2026-09-30T10:15:00Z",
    "from": 1,
    "to": 0,
}


def _expand(fixture):
    fixture.page.locator("#items-grid .item-header-expand").first.click()
    return fixture.page.locator("#items-grid .metric-compare-row").filter(has_text="accuracy").first


@pytest.mark.parametrize("kind", ["run", "compare"])
@pytest.mark.parametrize("status", ["SUBMITTED", "APPROVED"])
def test_scores_of_a_reviewed_run_have_no_editor(browser, kind, status):
    fixture = ViewFixture(browser, kind, count=20)
    fixture.data["run-1"]["run"]["status"] = status
    try:
        fixture.goto()
        chip = _expand(fixture)
        chip.wait_for()
        if kind == "run":
            assert fixture.page.evaluate("document.body.classList.contains('run-scores-locked')")
            notice = fixture.page.locator("#run-scores-locked-notice")
            assert notice.is_visible()
            assert "Scores are locked." in notice.inner_text()
            assert fixture.page.locator(".metric-edit-open:visible").count() == 0
        else:
            # Run 1 is locked; run 2 (COMPLETED) keeps its editors.
            assert fixture.page.locator(".metric-edit-input[data-run-idx='0']").count() == 0
            assert fixture.page.locator(".metric-edit-input[data-run-idx='1']").count() > 0
        assert fixture.errors == []
    finally:
        fixture.close()


def test_edited_badge_names_the_editor_and_reset_restores_the_score(browser):
    fixture = ViewFixture(browser, "run", count=20)
    row = fixture.data["run-1"]["snapshot"]["rows"][0]
    row["metric_values"][0] = 0
    row["metric_meta"]["accuracy"] = {"modified": "true", "original_score": 1, "last_edit": EDIT}
    restored = copy.deepcopy(row)
    restored["metric_values"][0] = 1
    restored["metric_meta"]["accuracy"] = {}
    sent = []

    def reset_route(route):
        sent.append(route.request.post_data_json)
        route.fulfill(json={"ok": True, "row": restored})

    try:
        fixture.goto()
        fixture.page.route("**/api/runs/update_metric", reset_route)
        chip = _expand(fixture)
        badge = chip.locator(".metric-edit-badge")
        title = badge.get_attribute("title")
        assert title.startswith("Edited by Mo Member on Sep 30, 2026")
        assert "1 → 0" in title and "Original score: 1" in title
        # Edit bookkeeping is not shown as judge metadata.
        assert "last_edit" not in chip.inner_text()
        reset = chip.locator(".metric-reset-btn")
        assert reset.get_attribute("title") == "Reset to original (1)"
        box = reset.bounding_box()
        assert (box["width"], box["height"]) == (24, 24)
        reset.click()
        fixture.page.wait_for_function(
            "() => __viewTest.state.snapshot.rows[0].metric_values[0] === 1"
        )
        assert sent == [{"file_path": "run-1", "row_index": 0, "metric_name": "accuracy", "reset": True}]
        assert fixture.page.locator("#items-grid .metric-edit-badge").count() == 0
        assert fixture.errors == []
    finally:
        fixture.close()


def test_score_editor_save_and_cancel_are_the_same_size(browser):
    fixture = ViewFixture(browser, "run", count=20)
    try:
        fixture.goto()
        fixture.page.locator("#items-grid .item-header-expand").first.click()
        fixture.page.locator("#items-grid .metric-edit-open").first.click()
        controls = fixture.page.locator(".metric-edit-controls:not(.hidden)").first
        save = controls.locator(".metric-edit-save").bounding_box()
        cancel = controls.locator(".metric-edit-cancel").bounding_box()
        assert (save["width"], save["height"]) == (cancel["width"], cancel["height"])
    finally:
        fixture.close()
