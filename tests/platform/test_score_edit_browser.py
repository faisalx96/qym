"""The score editor rejects invalid input inline and never loses its chip (C009)."""

import os

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_performance_views_browser import ViewFixture


def _open_editor(fixture):
    fixture.page.locator("#items-grid .item-header-expand").first.click()
    chip = fixture.page.locator("#items-grid .metric-compare-row").filter(
        has_text="accuracy"
    ).first
    chip.locator(".metric-edit-open").click()
    return chip, chip.locator(".metric-edit-input")


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_invalid_stored_score_keeps_its_chip_and_rejects_bad_input(browser, kind):
    fixture = ViewFixture(browser, kind, count=20)
    # An older edit stored text as the score: the chip must stay editable.
    fixture.data["run-1"]["snapshot"]["rows"][0]["metric_values"][0] = "abc"
    try:
        fixture.goto()
        chip, editor = _open_editor(fixture)
        invalid = chip.locator(".metric-score-invalid")
        assert invalid.count() == 1
        assert "not a number" in invalid.get_attribute("title")

        for value, message in (
            ("abc", "Enter true or false (1 or 0)."),
            ("0.5", "Enter true or false (1 or 0)."),
            ("0,7", "Use a dot for decimals (0.7, not 0,7)."),
        ):
            editor.fill(value)
            editor.press("Enter")
            status = chip.locator(".metric-edit-status")
            assert status.inner_text() == message
            assert "is-error" in status.get_attribute("class")
            assert editor.get_attribute("aria-invalid") == "true"
            assert editor.is_visible()
        assert not [r for r in fixture.requests if r[1] == "update"]
        # Typing clears the error; a valid boolean saves as a number.
        editor.fill("true")
        assert chip.locator(".metric-edit-status").inner_text() == ""
        assert editor.get_attribute("aria-invalid") is None
        with fixture.page.expect_request("**/api/runs/update_metric") as sent:
            editor.press("Enter")
        assert sent.value.post_data_json["new_score"] == 1
        fixture.page.wait_for_function(
            """() => {
              const s = __viewTest.state;
              return (s.snapshot?.rows || s.runs?.[0]?.snapshot.rows)[0].metric_values[0] === 1;
            }"""
        )
    finally:
        fixture.close()


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_server_rejection_is_shown_next_to_the_input(browser, kind):
    fixture = ViewFixture(browser, kind, count=20)
    detail = "Unknown metric for this run: accuracy"
    try:
        fixture.goto()
        fixture.page.route(
            "**/api/runs/update_metric",
            lambda route: route.fulfill(status=422, json={"detail": detail}),
        )
        chip, editor = _open_editor(fixture)
        editor.fill("1")
        editor.press("Enter")
        status = chip.locator(".metric-edit-status")
        status.wait_for(state="visible")
        fixture.page.wait_for_function(
            "text => [...document.querySelectorAll('.metric-edit-status')].some(el => el.textContent === text)",
            arg=detail,
        )
        assert editor.is_visible()
        assert editor.get_attribute("aria-invalid") == "true"
        assert fixture.page.locator(".toast-message").count() == 0
    finally:
        fixture.close()
