"""Run page structure (C058, C064, C065, C068) on the shipped run page.

C058: a sticky section nav over the same page (links, scroll-spy, counts,
Filters + Clear in the bar, the builder as a dropdown), one section header
recipe, and the reader's section kept still while others re-render; the
shared segmented control no longer rewrites its class every frame.
C065: a Pass/Fail bar click lands on the filtered list with a banner, and
every failing row shows why it failed and where that came from.
C064: many metrics never scroll the page sideways and keep the input visible.
C068: structured item metadata never renders as "[object Object]".
"""

from __future__ import annotations

import json
from urllib.parse import urlparse

import pytest

from qym_platform.services.run_payloads import reason_fields
from test_performance_views_browser import ViewFixture

pytestmark = pytest.mark.browser

LONG_REASON = "Result rows differ from the gold rows. " * 10  # dropped by the index
EXPLANATION = "The query filters on ship_date instead of delivered_date. " * 3


class StructureFixture(ViewFixture):
    """Run page rows with every reason source; reasons served like the API."""

    def __init__(self, browser, *, count=30, metrics=None, samples=1, compact=True):
        super().__init__(browser, "run", compact=compact, count=count, samples=samples)
        self.page.set_default_timeout(8000)
        self.reason_requests = []
        self.metric_names = metrics or ["accuracy", "count"]
        for data in self.data.values():
            snapshot = data["snapshot"]
            for row in snapshot["rows"]:
                i = row["index"]
                row["status"], row["error"] = "completed", ""
                row["metric_meta"] = {"accuracy": {}, "count": {}}
                row["item_metadata"] = {"complexity": "hard", "domain": "finance"}
            rows = snapshot["rows"]
            # accuracy is True on odd rows: even rows fail it.
            sources = {
                0: {"reason": "Expected 12 rows, got 9"},
                2: {"error": "Empty output"},
                4: {"status": "error", "error": "judge 429"},
                6: {"explanation": EXPLANATION},
                8: {"label": "mismatch"},
                10: {},
                12: {"reason": LONG_REASON},
            }
            for i, meta in sources.items():
                if i < len(rows):
                    rows[i]["metric_meta"]["accuracy"] = dict(meta)
            if len(rows) > 14:
                rows[14].update(
                    status="error", error="Provider timeout after final retry"
                )
            if len(rows) > 1:
                rows[1]["item_metadata"]["metric_analyses"] = {
                    "accuracy": {"root_cause_issues": [], "source": "human"}
                }
                rows[1]["item_metadata"]["provenance"] = {
                    "source": "import",
                    "batch": 3,
                }
            if metrics:
                data["run"]["metric_names"] = list(metrics)
                snapshot["metric_names"] = list(metrics)
                snapshot["metric_specs"] = {
                    name: {"score_type": "percentage", "direction": "maximize"}
                    for name in metrics
                }
                for row in rows:
                    row["metric_values"] = [
                        round(((row["index"] * 7 + k * 13) % 100) / 100, 2)
                        for k in range(len(metrics))
                    ]
                    row["metric_meta"] = {name: {} for name in metrics}
                    if samples > 1:
                        row["pass_scores"] = {
                            name: [row["metric_values"][k]] * samples
                            for k, name in enumerate(metrics)
                        }
                        row["pass_metric_meta"] = {
                            name: [{}] * samples for name in metrics
                        }
        self.page.route("**/api/runs/*/items/reasons", self.reasons)

    def reasons(self, route):
        body = route.request.post_data_json
        run_id = urlparse(route.request.url).path.split("/")[3]
        self.reason_requests.append(body)
        rows = {row["item_id"]: row for row in self.data[run_id]["snapshot"]["rows"]}
        route.fulfill(
            json={
                "metric": body["metric"],
                "pass_number": body.get("pass_number"),
                "reasons": {
                    item_id: reason_fields(
                        (rows[item_id].get("metric_meta") or {}).get(body["metric"])
                    )
                    for item_id in body["item_ids"]
                },
            }
        )

    def scroll_host(self, expression):
        return self.page.evaluate(
            "(() => { const host = document.querySelector('.run-container'); return "
            + expression
            + "; })()"
        )


def head_top(page, key):
    return page.evaluate(
        f"Math.round(document.querySelector('#run-section-{key}').getBoundingClientRect().top)"
    )


def nav_bottom(page):
    return page.evaluate(
        "Math.round(document.querySelector('#run-section-nav').getBoundingClientRect().bottom)"
    )


def reason_cells(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('#items-grid .item-card.item-collapsed')).map(card => {
              const cell = card.querySelector('.rdi-reason');
              return {
                id: card.dataset.itemId,
                text: cell?.querySelector('.rdi-reason__text')?.textContent || '',
                source: cell?.querySelector('.rdi-reason__source')?.textContent || '',
                title: cell?.getAttribute('title') || '',
                loading: !!cell?.classList.contains('rdi-reason--loading'),
              };
            })"""
    )


# ── C058: sticky section nav ─────────────────────────────────────────────────


def test_section_nav_links_counts_jump_and_follow_the_reader(browser):
    fixture = StructureFixture(browser)
    page = fixture.page
    try:
        fixture.goto()
        nav = page.locator("#run-section-nav")
        # The breakdowns (Categories, Errors) render just after the items.
        nav.locator('[data-run-section-link="errors"]:not([hidden])').wait_for()
        visible = nav.locator("[data-run-section-link]:not([hidden])")
        labels = [label.split("\n")[0].strip() for label in visible.all_inner_texts()]
        # Today's section order; sections without content have no link.
        assert labels[0] == "Overview"
        assert labels[-1].startswith("Items")
        assert "Errors" in " ".join(labels)
        assert (
            nav.locator(
                '[data-run-section-link="items"] .run-section-nav__count'
            ).inner_text()
            == "30"
        )
        errors = nav.locator('[data-run-section-link="errors"] .run-section-nav__count')
        assert (
            errors.inner_text()
            == page.evaluate(
                "document.querySelector('#error-distribution-section .breakdown-errors .breakdown-metric').textContent.trim()"
            )
            or int(errors.inner_text()) > 0
        )
        assert "qym-tag--danger" in errors.get_attribute("class")
        # No proportional widths or percentages in the bar.
        assert "%" not in nav.inner_text()

        assert nav.get_attribute("class") == "run-section-nav"  # not stuck at the top
        nav.locator('[data-run-section-link="items"]').click()
        page.wait_for_function(
            "document.querySelector('[data-run-section-link=\"items\"]').getAttribute('aria-current') === 'location'"
        )
        page.wait_for_function(
            "document.querySelector('#run-section-nav').classList.contains('is-stuck')"
        )
        page.wait_for_timeout(400)
        # The jumped-to header sits just below the stuck bar.
        assert 0 <= head_top(page, "items") - nav_bottom(page) <= 24
        identity = nav.locator(".run-section-nav__identity")
        assert identity.locator(".run-section-nav__name").inner_text() == "run-1"
        assert identity.locator(".run-section-nav__status").inner_text() == "COMPLETED"
        assert nav.locator(".run-section-nav__top").is_visible()

        # Scroll-spy: scrolling to the Overview header underlines Overview.
        page.evaluate(
            "document.querySelector('.run-container').scrollTop = document.querySelector('#run-section-latency') ? 1 : 0"
        )
        nav.locator(".run-section-nav__top").click()
        page.wait_for_function(
            "document.querySelector('.run-container').scrollTop === 0"
        )
        page.wait_for_function(
            "document.querySelector('[data-run-section-link=\"overview\"]').getAttribute('aria-current') === 'location'"
        )
        ink = page.evaluate(
            "(() => { const ink = document.querySelector('.run-section-nav__ink'); const link = document.querySelector('[data-run-section-link=\"overview\"]'); return [Math.round(parseFloat(ink.style.width)), link.offsetWidth]; })()"
        )
        assert ink[0] == ink[1]
    finally:
        fixture.close()


def test_filters_and_clear_live_in_the_nav_and_the_builder_drops_down(browser):
    fixture = StructureFixture(browser)
    page = fixture.page
    try:
        fixture.goto()
        nav = page.locator("#run-section-nav")
        toolbar = page.locator(".qym-item-toolbar")
        assert nav.locator("#btn-item-filters").count() == 1
        assert nav.locator("#clear-all-btn").count() == 1
        assert toolbar.locator("#btn-item-filters, #clear-all-btn").count() == 0
        # Search, count, Display and CSV stay in the Items toolbar.
        for selector in (
            "#items-search",
            "#filter-count",
            "#btn-item-display",
            "#export-filtered-btn",
        ):
            assert toolbar.locator(selector).count() == 1

        assert not page.locator("#clear-all-btn").is_visible()  # nothing to clear yet
        page.locator("#btn-item-filters").click()
        builder = page.locator("#item-filter-builder")
        builder.wait_for(state="visible")
        box = builder.bounding_box()
        assert box["y"] >= nav_bottom(page)  # hangs under the bar
        assert builder.evaluate("node => getComputedStyle(node).position") == "absolute"
        page.keyboard.press("Escape")
        builder.wait_for(state="hidden")
        assert page.evaluate("document.activeElement.id") == "btn-item-filters"

        page.locator("#btn-item-filters").click()
        builder.wait_for(state="visible")
        builder.locator("[data-fb-addc]").first.click()  # a click inside keeps it open
        assert builder.is_visible()
        page.mouse.click(400, 900)
        builder.wait_for(state="hidden")

        # Clear sits in the bar once a filter applies, and clears every one.
        page.locator(".metric-bool-seg.fail-seg").first.click()
        page.locator("#clear-all-btn").wait_for(state="visible")
        assert page.locator("#run-section-nav #clear-all-btn").is_visible()
        page.locator("#clear-all-btn").click()
        page.wait_for_function(
            "document.querySelector('#filter-count').textContent.includes('30 of 30')"
        )
    finally:
        fixture.close()


def test_every_section_uses_one_header_recipe(browser):
    fixture = StructureFixture(browser)
    page = fixture.page
    try:
        fixture.goto()
        page.locator("#run-section-errors").wait_for()
        page.locator("#run-section-categories").wait_for()
        heads = page.evaluate(
            """() => Array.from(document.querySelectorAll('#run-content .run-section-head'))
                .filter(head => head.getClientRects().length)
                .map(head => {
                  const title = head.querySelector('.run-section-head__title');
                  const desc = head.querySelector('.run-section-head__desc');
                  const style = getComputedStyle(head);
                  return {
                    key: head.dataset.runSection,
                    title: title.textContent,
                    size: getComputedStyle(title).fontSize,
                    descSize: desc ? getComputedStyle(desc).fontSize : null,
                    descLines: desc ? Math.round(desc.getBoundingClientRect().height / parseFloat(getComputedStyle(desc).lineHeight)) : 0,
                    border: style.borderTopWidth + ' ' + style.borderTopStyle,
                    marginTop: style.marginTop,
                  };
                })"""
        )
        keys = [head["key"] for head in heads]
        assert keys[0] == "overview" and keys[-1] == "items"
        assert {"errors", "categories", "items"} <= set(keys)
        # The old mix of title styles is gone.
        assert page.locator("#run-content h3.section-title:visible").count() == 0
        for head in heads:
            assert head["size"] == "18px", head
            assert head["descSize"] == "12px" and head["descLines"] == 1, head
        for head in heads[1:]:
            assert head["border"] == "1px solid", head
            assert head["marginTop"] == "48px", head
        assert heads[0]["border"].startswith("0px")
    finally:
        fixture.close()


def test_the_section_being_read_stays_still_while_sections_above_change(browser):
    fixture = StructureFixture(browser)
    page = fixture.page
    try:
        fixture.goto()
        # Isolate the page's own anchoring from the browser's.
        page.add_style_tag(content=".run-container { overflow-anchor: none; }")
        page.locator('[data-run-section-link="categories"]').click()
        page.wait_for_timeout(700)
        page.mouse.move(700, 600)
        page.mouse.wheel(0, 90)
        page.wait_for_timeout(400)
        before = head_top(page, "categories")
        # A section above grows (as a filter re-render would make it).
        page.evaluate(
            "(() => { const grow = document.createElement('div'); grow.id = 'grow'; grow.style.height = '320px'; document.querySelector('#overview-primary-section').appendChild(grow); })()"
        )
        page.wait_for_timeout(100)
        assert head_top(page, "categories") == before
        page.evaluate("document.getElementById('grow').remove()")
        page.wait_for_timeout(100)
        assert head_top(page, "categories") == before

        # A real filter change re-renders every section above the reader.
        page.locator("#btn-item-filters").click()
        page.locator("#item-filter-builder").wait_for(state="visible")
        page.keyboard.press("Escape")
        page.evaluate(
            "(() => { const input = document.querySelector('#items-search'); input.value = 'Question 1'; input.dispatchEvent(new Event('input', { bubbles: true })); })()"
        )
        page.wait_for_function(
            "!document.querySelector('#filter-count').textContent.includes('30 of 30')"
        )
        page.wait_for_timeout(500)
        assert head_top(page, "categories") == before

        # The reader's own scrolling still moves the page.
        page.mouse.wheel(0, 200)
        page.wait_for_timeout(400)
        assert head_top(page, "categories") < before - 100
    finally:
        fixture.close()


def test_segmented_controls_do_not_rewrite_their_class_while_idle(browser):
    fixture = StructureFixture(browser, samples=3)
    page = fixture.page
    try:
        fixture.goto()
        assert page.locator(".qym-segmented").count() >= 2
        page.wait_for_timeout(500)
        writes = page.evaluate("""() => new Promise(resolve => {
                  let writes = 0;
                  const observer = new MutationObserver(records => {
                    writes += records.filter(record => record.target.classList?.contains('qym-segmented')).length;
                  });
                  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
                  setTimeout(() => { observer.disconnect(); resolve(writes); }, 600);
                })""")
        assert writes == 0
        # The indicator still follows a selection.
        toggle = page.locator(".items-view-toggle")
        assert (
            "qym-segmented--ready" in (toggle.get_attribute("class") or "")
            or not toggle.is_visible()
        )
    finally:
        fixture.close()


# ── C065: why an item failed ────────────────────────────────────────────────


def test_fail_bar_click_lands_on_the_filtered_list_with_a_banner(browser):
    fixture = StructureFixture(browser)
    page = fixture.page
    try:
        fixture.goto()
        page.locator(".metric-bool-seg.fail-seg[data-metric='accuracy']").click()
        banner = page.locator("#item-filter-banner")
        banner.wait_for(state="visible")
        count = int(page.locator("#filter-count .count-num").inner_text())
        assert count < 30
        assert banner.locator(".rdi-filter-banner__text").inner_text() == (
            f"Filtered to {count} items that fail accuracy. The overview above is filtered too."
        )
        # The banner sits above the toolbar, and the list is what the reader sees.
        assert (
            banner.bounding_box()["y"]
            < page.locator(".qym-item-toolbar").bounding_box()["y"]
        )
        page.wait_for_timeout(700)
        assert 0 <= head_top(page, "items") - nav_bottom(page) <= 24
        assert banner.is_visible() and banner.bounding_box()["y"] < 600
        help_toggle = banner.get_by_role("button", name="How the reason is chosen")
        help_toggle.click()
        popover = page.locator("#rdi-reason-order")
        popover.wait_for(state="visible")
        steps = [step.split(":")[0] for step in popover.locator("li").all_inner_texts()]
        assert steps == [
            "task error",
            "scorer error",
            "reason",
            "explanation",
            "label",
            "no reason recorded",
        ]
        page.keyboard.press("Escape")
        popover.wait_for(state="hidden")
        assert help_toggle.get_attribute("aria-expanded") == "false"
        assert (
            page.locator(".run-section-nav__count").last.inner_text() == f"{count} / 30"
        )

        banner.get_by_role("button", name="Clear filter").click()
        banner.wait_for(state="hidden")
        page.wait_for_function(
            "document.querySelector('#filter-count').textContent.includes('30 of 30')"
        )
    finally:
        fixture.close()


def test_every_failing_row_shows_its_reason_and_source(browser):
    fixture = StructureFixture(browser)
    page = fixture.page
    try:
        fixture.goto()
        page.wait_for_function(
            "!document.querySelector('#items-grid .rdi-reason--loading')"
        )
        cells = {cell["id"]: cell for cell in reason_cells(page)}
        expected = {
            "item-0": ("Expected 12 rows, got 9", "reason"),
            "item-2": ("Empty output", "reason"),
            "item-4": ("judge 429", "scorer error"),
            "item-6": (EXPLANATION.strip(), "explanation"),
            "item-8": ("mismatch", "label"),
            "item-10": ("Scored False, pass needs True", "no reason recorded"),
            "item-12": (LONG_REASON.strip(), "reason"),
            "item-14": ("Provider timeout after final retry", "task error"),
        }
        for item_id, (text, source) in expected.items():
            assert cells[item_id]["text"] == text, item_id
            assert cells[item_id]["source"] == source, item_id
            assert cells[item_id]["title"] == text, item_id  # full text on hover
        for i in range(1, 20, 2):  # passing rows leave the column empty
            assert cells[f"item-{i}"]["text"] == "", i
        # Only rows whose reason the index cannot hold were fetched, once.
        assert len(fixture.reason_requests) == 1
        fetched = set(fixture.reason_requests[0]["item_ids"])
        assert {"item-6", "item-12", "item-10", "item-8"} <= fetched
        assert not fetched & {"item-0", "item-4", "item-14", "item-1", "item-3"}
        assert fixture.reason_requests[0]["metric"] == "accuracy"
        # One line each, so the row keeps its height.
        lines = page.evaluate(
            "Array.from(document.querySelectorAll('.rdi-reason__text')).map(node => node.getClientRects().length === 1 && node.scrollHeight <= 16)"
        )
        assert all(lines)
    finally:
        fixture.close()


def test_opened_rows_and_full_payloads_need_no_reason_request(browser):
    fixture = StructureFixture(browser, compact=False)
    page = fixture.page
    try:
        fixture.goto()
        cells = {cell["id"]: cell for cell in reason_cells(page)}
        assert cells["item-6"]["source"] == "explanation"
        assert cells["item-12"]["text"] == LONG_REASON.strip()
        assert fixture.reason_requests == []
    finally:
        fixture.close()


# 1088: this page has no shell sidebar, so a 1088px viewport gives the list
# the width it has on a 1280px screen with the sidebar open (1018px).
@pytest.mark.parametrize("width", [1024, 1088, 1280, 1440, 1920])
def test_item_rows_are_aligned_columns(browser, width):
    fixture = StructureFixture(browser)
    page = fixture.page
    page.set_viewport_size({"width": width, "height": 1100})
    try:
        fixture.goto()
        page.wait_for_function(
            "!document.querySelector('#items-grid .rdi-reason--loading')"
        )
        columns = page.evaluate(
            """() => Array.from(document.querySelectorAll('#items-grid .item-card.item-collapsed > .item-header')).map(header => {
                  const left = selector => Math.round(header.querySelector(selector).getBoundingClientRect().left);
                  const right = selector => Math.round(header.querySelector(selector).getBoundingClientRect().right);
                  return {
                    index: left('.item-index'), status: left('.rdi-status'), input: left('.item-title'),
                    reason: left('.rdi-reason'), reasonRight: right('.rdi-reason'),
                    metrics: right('.rdi-metrics'), metricLeft: left('.rdi-metrics'),
                    height: Math.round(header.getBoundingClientRect().height),
                  };
                })"""
        )
        assert len(columns) == 20
        for key in (
            "index",
            "status",
            "input",
            "reason",
            "reasonRight",
            "metrics",
            "metricLeft",
        ):
            assert len({column[key] for column in columns}) == 1, (
                key,
                {c[key] for c in columns},
            )
        reason_width = columns[0]["reasonRight"] - columns[0]["reason"]
        assert reason_width <= 320
        # The list's width picks the layout: one line from a 1280px screen
        # with the sidebar up (C065: "below about 1280px" the metrics wrap).
        list_width = page.evaluate("document.querySelector('#items-grid').clientWidth")
        if width == 1088:
            assert 1000 <= list_width < 1100, list_width
        if list_width >= 1000:
            # One line: the metrics sit to the right of the reason.
            assert columns[0]["metricLeft"] >= columns[0]["reasonRight"]
        else:
            # Narrower: the metrics take a second line instead of clipping.
            assert columns[0]["metricLeft"] < columns[0]["reason"]
            assert columns[0]["metrics"] <= columns[0]["reasonRight"]
        assert (
            page.evaluate(
                "document.querySelector('.run-container').scrollWidth - document.querySelector('.run-container').clientWidth"
            )
            == 0
        )
    finally:
        fixture.close()


# ── C064: many metrics ──────────────────────────────────────────────────────

WIDE = [
    f"metric_{chr(97 + k)}_{'quality' if k % 2 else 'grounding'}" for k in range(22)
]


@pytest.mark.parametrize("width", [1024, 1440])
def test_many_metrics_never_scroll_the_page_sideways(browser, width):
    fixture = StructureFixture(browser, metrics=WIDE)
    page = fixture.page
    page.set_viewport_size({"width": width, "height": 1000})
    try:
        fixture.goto()
        page.locator('[data-run-section-link="items"]').click()
        page.wait_for_timeout(500)
        overflow = page.evaluate(
            "document.querySelector('.run-container').scrollWidth - document.querySelector('.run-container').clientWidth"
        )
        assert overflow == 0
        rows = page.evaluate(
            """() => Array.from(document.querySelectorAll('#items-grid .item-card.item-collapsed')).map(card => {
                  const cardBox = card.getBoundingClientRect();
                  const visible = Array.from(card.querySelectorAll('[data-qym-metric-column]:not(.rdi-metric-hidden)'));
                  const more = card.querySelector('.rdi-metric-more');
                  return {
                    title: Math.round(card.querySelector('.item-title').getBoundingClientRect().width),
                    within: visible.every(cell => cell.getBoundingClientRect().right <= cardBox.right + 0.5),
                    first: visible.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0]?.querySelector('.metric-score-name')?.textContent,
                    more: more && !more.hidden ? more.textContent : '',
                    moreTitle: more ? more.title : '',
                  };
                })"""
        )
        for row in rows:
            assert row["title"] >= 200, row
            assert row["within"], row
            assert row["first"] == WIDE[0]  # the displayed metric stays visible
            assert row["more"].startswith("+") and row["more"].endswith(" more"), row
            assert WIDE[-1] in row["moreTitle"]
        hidden = int(rows[0]["more"].split()[0][1:])
        assert 0 < hidden < len(WIDE)

        # Switching the displayed metric brings it to the front.
        page.evaluate(
            f"(() => {{ __viewTest.state.selectedMetric = '{WIDE[20]}'; __viewTest.renderItems(); }})()"
        )
        first = page.evaluate(
            """() => { const visible = Array.from(document.querySelector('#items-grid .item-card.item-collapsed').querySelectorAll('[data-qym-metric-column]:not(.rdi-metric-hidden)'));
                return visible.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0].querySelector('.metric-score-name').textContent; }"""
        )
        assert first == WIDE[20]
    finally:
        fixture.close()


def test_repeat_metric_switcher_scrolls_inside_its_own_region(browser):
    fixture = StructureFixture(browser, metrics=WIDE, samples=3)
    page = fixture.page
    page.set_viewport_size({"width": 1024, "height": 1000})
    group = {
        "metric": WIDE[0],
        "threshold": 0.8,
        "samples": 3,
        "report_k": None,
        "group": {
            "total_items": 30,
            "pass_at_k": 0.5,
            "pass_hat_k": 0.3,
            "avg_at_k": 0.4,
            "max_at_k": 0.6,
            "consistency": 0.7,
            "reliability": 0.6,
        },
        "band": {},
        "distribution": [],
    }
    page.route("**/api/runs/*/group-metrics*", lambda route: route.fulfill(json=group))
    try:
        fixture.goto()
        tabs = page.locator(".samples-metric-tabs")
        tabs.wait_for(state="attached")
        assert tabs.locator(
            ".samples-metric-tab, [data-samples-metric]"
        ).count() >= len(WIDE) or tabs.locator("button").count() >= len(WIDE)
        sizes = tabs.evaluate(
            "node => [node.scrollWidth, node.clientWidth, getComputedStyle(node).overflowX]"
        )
        assert sizes[0] > sizes[1] and sizes[2] == "auto"
        overflow = page.evaluate(
            "document.querySelector('.run-container').scrollWidth - document.querySelector('.run-container').clientWidth"
        )
        assert overflow == 0
    finally:
        fixture.close()


# ── C068: structured metadata ───────────────────────────────────────────────


@pytest.mark.parametrize("kind", ["run", "compare"])
def test_structured_item_metadata_never_renders_object_object(browser, kind):
    fixture = ViewFixture(browser, kind, count=4)
    for data in fixture.data.values():
        row = data["snapshot"]["rows"][1]
        row["item_metadata"] = {
            "complexity": "hard",
            "domain": ["finance", {"nested": True}],
            "metric_analyses": {
                "accuracy": {"root_cause_issues": [], "source": "human"}
            },
            "provenance": {"source": "import", "batch": 3},
        }
    page = fixture.page
    try:
        fixture.goto()
        page.locator("[data-item-expand]").nth(1).click()
        card = page.locator(
            ".item-card:not(.item-collapsed), .item-comparison-row:not(.item-collapsed)"
        ).first
        card.locator(".item-metadata-row").wait_for()
        text = card.locator(".item-metadata-row").inner_text()
        assert "[object Object]" not in page.locator("body").inner_text()
        assert "hard" in text and "finance" in text
        assert "metric_analyses" not in text
        assert '{"source":"import","batch":3}' in text and "provenance:" in text
    finally:
        fixture.close()
