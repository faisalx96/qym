"""P1 final review fixes on the shipped run page.

C028/C058: filtering from an Errors card keeps that card still even when a
section above it is the one the nav reads (the nav and the page no longer
correct the scroll against each other).
C059/C058: a deep-linked item lands with its header below the sticky nav.
C039/C028: the step latency remount when a live run ends keeps a hidden panel
hidden until its data arrives (no "Loading" card flashing in and out).
"""

from __future__ import annotations

import time

import pytest

from test_run_page_structure_browser import StructureFixture

pytestmark = pytest.mark.browser

CARD = "#error-distribution-section .error-card"


def _scroll_card_to(page, card, target):
    page.mouse.move(700, 300)
    for _ in range(60):
        top = card.bounding_box()["y"]
        if abs(top - target) <= 40:
            break
        page.mouse.wheel(0, max(-250, min(250, top - target)))
        page.wait_for_timeout(90)
    page.wait_for_timeout(500)


def test_error_card_filter_keeps_the_card_still_below_the_reading_section(browser):
    fixture = StructureFixture(browser, count=60)
    page = fixture.page
    page.set_viewport_size({"width": 1440, "height": 900})
    try:
        fixture.goto()
        # Isolate the page's own anchoring from the browser's.
        page.add_style_tag(content=".run-container { overflow-anchor: none; }")
        card = page.locator(CARD).first
        card.wait_for()
        _scroll_card_to(page, card, 650)
        reading = page.evaluate(
            "document.querySelector('[data-run-section-link][aria-current=\"location\"]')?.dataset.runSectionLink"
        )
        # The bug needed a section above Errors to be the one being read.
        assert reading != "errors", reading
        before = card.bounding_box()["y"]
        page.evaluate(
            """(selector) => {
              window.__tops = [];
              const label = document.querySelector(selector).dataset.errorLabel;
              const t0 = performance.now();
              const tick = () => {
                const node = Array.from(document.querySelectorAll(selector))
                  .find(candidate => candidate.dataset.errorLabel === label);
                if (node) window.__tops.push(node.getBoundingClientRect().top);
                if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }""",
            CARD,
        )
        card.click()
        page.wait_for_function(
            "!document.querySelector('#filter-count').textContent.includes('60 of 60')"
        )
        page.wait_for_timeout(1600)
        tops = page.evaluate("window.__tops")
        assert tops, "no frames sampled"
        drift = max(abs(top - before) for top in tops)
        assert drift <= 1, (before, sorted(set(round(top) for top in tops)))
    finally:
        fixture.close()


@pytest.mark.parametrize("width", [600, 1280, 1440])
def test_deep_linked_item_header_lands_below_the_section_nav(browser, width):
    fixture = StructureFixture(browser, count=60)
    page = fixture.page
    page.set_viewport_size({"width": width, "height": 900})
    try:
        fixture.goto("?item=item-30")
        page.wait_for_function(
            "document.querySelector('#items-grid .item-card[data-item-id=\"item-30\"]')"
        )
        # The landing loop stops once the card holds still for 500 ms.
        page.wait_for_timeout(2500)
        geometry = page.evaluate(
            """() => {
              const nav = document.querySelector('#run-section-nav').getBoundingClientRect();
              const card = document.querySelector('#items-grid .item-card[data-item-id="item-30"]');
              const header = card.querySelector('.item-header') || card;
              const rect = header.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
              return {
                navBottom: nav.bottom,
                headerTop: rect.top,
                coveredByNav: !!(hit && hit.closest('#run-section-nav')),
              };
            }"""
        )
        assert geometry["headerTop"] >= geometry["navBottom"] - 1, geometry
        assert not geometry["coveredByNav"], geometry
    finally:
        fixture.close()


def test_reloading_trace_timings_keeps_an_empty_subsection_hidden(browser):
    fixture = StructureFixture(browser, count=30)
    page = fixture.page
    delay = {"ms": 0}

    def no_spans(route):
        if delay["ms"]:
            time.sleep(delay["ms"] / 1000)
        route.fulfill(json={"run_ids": ["run-1"], "passes": [], "trace_count": 0, "groups": []})

    # A run without spans: no trace timings, so Inside the traces stays out.
    page.route("**/api/runs/step-latency**", no_spans)
    hidden = "() => document.querySelector('#latency-traces-panel [data-lt=\"inside\"]')?.hidden === true"
    try:
        fixture.goto()
        page.wait_for_function(hidden)

        def reload(quiet):
            return page.evaluate(
                """(quiet) => new Promise(resolve => {
                  const inside = document.querySelector('#latency-traces-panel [data-lt="inside"]');
                  const seen = [];
                  const t0 = performance.now();
                  const tick = () => {
                    seen.push(!inside.hidden);
                    if (performance.now() - t0 < 900) requestAnimationFrame(tick);
                    else resolve(seen);
                  };
                  window.QymLatencyTraces.reload({ quiet });
                  tick();
                })""",
                quiet,
            )

        delay["ms"] = 400
        # Neither the live run's quiet reload nor a plain one shows a loading
        # block for a run that recorded no spans: nothing below it moves.
        assert not any(reload(True))
        assert not any(reload(False))
        page.wait_for_function(hidden)
    finally:
        fixture.close()
