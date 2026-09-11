"""Browser regressions for step latency requests, trace details, and exports."""

from __future__ import annotations

import html
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "packages/platform/qym_platform/_static/dashboard/step_latency.js"


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


def payload(latency=222, *, step="llm:test", tokens=500):
    return {
        "passes": [1, 2],
        "trace_count": 1,
        "groups": [
            {
                "phase": "task",
                "kind": "LLM",
                "step_type": step,
                "n": 2,
                "error_count": 0,
                "mean_ms": latency,
                "median_ms": latency,
                "min_ms": latency,
                "max_ms": latency,
                "p5_ms": latency,
                "p25_ms": latency,
                "p75_ms": latency,
                "p95_ms": latency,
                "cv": 0,
                "tokens_total": tokens,
                "tokens_prompt": tokens - 100,
                "tokens_completion": 100,
            }
        ],
    }


def trace_strip():
    labels = [
        "Avg Tokens",
        "Avg LLM Calls",
        "Avg Trace Latency",
        "Avg Task latency",
        "Avg Evaluator Latency",
    ]
    return (
        '<div class="trace-pills-row qym-stat-strip">'
        + "".join(
            '<div class="trace-pill"><span class="trace-pill-label">'
            + html.escape(label)
            + '</span><span class="trace-pill-val">100ms</span></div>'
            for label in labels
        )
        + "</div>"
    )


class Panel:
    def __init__(self, page):
        self.page = page

    def mount(self, refs=None, opts=None):
        self.page.evaluate(
            """({refs, opts}) => QymStepLatency.mount(
              document.querySelector('#panel'), refs, opts)""",
            {"refs": refs or ["run-1"], "opts": opts or {}},
        )

    def wait_requests(self, count):
        self.page.wait_for_function(
            "count => window.latencyRequests.length >= count", arg=count
        )

    def requests(self):
        return self.page.evaluate(
            "latencyRequests.map(r => ({url: r.url, settled: r.settled}))"
        )

    def respond_since(self, start, data=None):
        """Complete this selection's requests, including auxiliary name groups."""
        self.wait_requests(start + 1)
        for index, request in enumerate(self.requests()[start:], start):
            if not request["settled"]:
                self.respond(index, data)

    def respond(self, index, data=None, *, outcome="success"):
        self.page.evaluate(
            """({index, data, outcome}) => {
              const request = latencyRequests[index];
              request.settled = true;
              if (outcome === 'network-error') {
                request.reject(new Error('obsolete network failure'));
              } else {
                request.resolve({ok: outcome === 'success',
                  status: outcome === 'success' ? 200 : 503,
                  json: async () => data});
              }
            }""",
            {"index": index, "data": data or payload(), "outcome": outcome},
        )

    def select(self, control, value):
        self.page.locator(f'[data-sl-seg="{control}"] [data-sl-val="{value}"]').click()

    def expect_latency(self, value):
        self.page.wait_for_function(
            """value => document.querySelector('.sl-plot')?.textContent
              .includes('mean ' + value + 'ms')""",
            arg=value,
        )
        assert "Failed to load" not in self.page.locator("#panel").inner_text()

    def tile(self, label):
        return self.page.locator(f'[data-sl-ts="{label}"]')


@pytest.fixture
def panel(browser):
    context = browser.new_context(accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(5000)
    page.route(
        "http://qym.test/fixture",
        lambda route: route.fulfill(
            content_type="text/html",
            body='<div id="stats"></div><div id="panel"></div>',
        ),
    )
    page.goto("http://qym.test/fixture")
    page.evaluate(
        """() => {
          window.latencyRequests = [];
          // Keep obsolete requests deliverable even if their signal is aborted.
          // Result guards must also cover responses already being decoded.
          window.fetch = url => new Promise((resolve, reject) => {
            latencyRequests.push({url: String(url), resolve, reject, settled: false});
          });
        }"""
    )
    page.add_script_tag(path=str(SCRIPT))
    yield Panel(page)
    context.close()


@pytest.mark.parametrize("change", ["rollup", "pass", "remount"])
@pytest.mark.parametrize("outcome", ["success", "http-error", "network-error"])
def test_obsolete_requests_cannot_replace_current_plot(panel, change, outcome):
    panel.mount()
    panel.wait_requests(1)
    old_index, latest_start = 0, 1
    if change == "pass":
        panel.respond(0)
        panel.expect_latency(222)
        panel.select("passNum", "1")
        latest_start = len(panel.requests())
        panel.select("passNum", "2")
        old_index = 1
    elif change == "rollup":
        panel.select("rollup", "kind")
    else:
        panel.mount(["new-run"])
    panel.respond_since(latest_start, payload(222))
    panel.expect_latency(222)
    panel.respond(old_index, payload(111), outcome=outcome)
    # evaluate() returns after the response promise and its continuations drain.
    panel.expect_latency(222)
    assert "mean 111ms" not in panel.page.locator(".sl-plot").text_content()


@pytest.mark.parametrize("outcome", ["success", "http-error"])
def test_obsolete_comparison_lane_cannot_break_a_new_mount(panel, outcome):
    panel.mount(["old-run"], {"pooled": True})
    panel.wait_requests(2)
    panel.mount(["new-run"], {"pooled": True})
    panel.wait_requests(4)
    panel.respond(2)
    panel.respond(3)
    panel.expect_latency(222)
    panel.respond(0, payload(111))
    panel.respond(1, payload(111), outcome=outcome)
    panel.expect_latency(222)
    assert "mean 111ms" not in panel.page.locator(".sl-plot").text_content()


def test_reselected_comparison_lane_keeps_the_current_result(panel):
    panel.mount(["run-1", "run-2"], {"pooled": True})
    panel.respond_since(0, payload(100))
    panel.expect_latency(100)
    second_run = panel.page.locator('[data-sl-run="run-2"]')
    second_run.click()
    new_rollup = len(panel.requests())
    panel.select("rollup", "kind")
    panel.respond_since(new_rollup, payload(100, step="llm"))
    panel.expect_latency(100)

    # This lane has not yet loaded the new rollup. Its first request remains
    # pending while the user removes and then adds the lane again.
    old_request = len(panel.requests())
    second_run.click()
    panel.wait_requests(old_request + 1)
    second_run.click()
    second_run.click()
    requests = panel.requests()
    current_request = len(requests) - 1
    panel.respond(current_request, payload(222, step="llm"))
    panel.expect_latency(222)
    # Reusing the pending request is also valid. If reselection issued another
    # request, an older failure must not replace its successful current result.
    for index in range(old_request, current_request):
        if not requests[index]["settled"]:
            panel.respond(index, outcome="http-error")
    panel.expect_latency(222)


@pytest.mark.parametrize("pooled", [False, True])
def test_empty_step_latency_panel_hides_and_returns_on_refresh(panel, pooled):
    empty = {"groups": [], "passes": [1, 2], "trace_count": 0}
    panel.mount(opts={"pooled": pooled})
    panel.respond_since(0, empty)
    assert not panel.page.locator("#panel").is_visible()
    assert panel.page.locator("#panel").inner_html() == ""

    next_request = len(panel.requests())
    panel.mount(opts={"pooled": pooled})
    panel.respond_since(next_request)
    panel.expect_latency(222)
    assert panel.page.locator("#panel").is_visible()

    next_request = len(panel.requests())
    panel.mount(opts={"pooled": pooled})
    panel.respond_since(next_request, empty)
    assert not panel.page.locator("#panel").is_visible()


@pytest.mark.parametrize("pooled", [False, True])
def test_obsolete_data_cannot_restore_an_empty_panel(panel, pooled):
    panel.mount(["old-run"], {"pooled": pooled})
    old_count = 2 if pooled else 1
    panel.wait_requests(old_count)
    panel.mount(["new-run"], {"pooled": pooled})
    panel.respond_since(old_count, {"groups": [], "passes": []})
    assert not panel.page.locator("#panel").is_visible()
    for index in range(old_count):
        panel.respond(index)
    assert not panel.page.locator("#panel").is_visible()
    assert panel.page.locator("#panel").inner_html() == ""


@pytest.mark.parametrize("pooled", [False, True])
@pytest.mark.parametrize("observation", ["zero-latency", "errors-only", "no-samples"])
def test_step_latency_requires_observations_but_preserves_zero_and_errors(
    panel, pooled, observation
):
    data = payload(0)
    if observation != "zero-latency":
        data["groups"][0]["n"] = 0
        data["groups"][0]["error_count"] = 3 if observation == "errors-only" else 0
    panel.mount(opts={"pooled": pooled})
    panel.respond_since(0, data)
    if observation == "no-samples":
        assert not panel.page.locator("#panel").is_visible()
    else:
        assert panel.page.locator(".sl-plot").is_visible()
        expected = "err=3" if observation == "errors-only" else "mean 0"
        assert expected in panel.page.locator(".sl-plot").text_content()


@pytest.mark.parametrize("pooled", [False, True])
def test_empty_phase_keeps_only_filters_and_can_restore_report(panel, pooled):
    panel.mount(opts={"pooled": pooled})
    panel.respond_since(0)
    panel.expect_latency(222)
    panel.select("phase", "eval")
    assert panel.page.locator("#panel").is_visible()
    assert panel.page.locator(".sl-card, .sl-plot, .section-title, .sl-empty").count() == 0
    assert panel.page.locator("#panel a[download]").count() == 0
    panel.select("phase", "all")
    panel.expect_latency(222)


def test_empty_repeat_pass_keeps_filters_and_can_restore_report(panel):
    panel.mount()
    panel.respond_since(0)
    panel.expect_latency(222)
    next_request = len(panel.requests())
    panel.select("passNum", "1")
    panel.respond_since(next_request, {"groups": [], "passes": [1, 2]})
    assert panel.page.locator(".sl-card, .sl-plot, .section-title, .sl-empty").count() == 0
    next_request = len(panel.requests())
    panel.select("passNum", "")
    panel.respond_since(next_request)
    panel.expect_latency(222)


def test_empty_locked_pass_hides_panel(panel):
    panel.page.evaluate("history.replaceState(null, '', '?pass=2')")
    panel.mount()
    panel.respond_since(0, {"groups": [], "passes": [1, 2]})
    assert not panel.page.locator("#panel").is_visible()


def test_deselecting_comparison_lanes_keeps_controls_for_reselection(panel):
    panel.mount(["run-1"], {"pooled": True})
    panel.respond_since(0)
    panel.expect_latency(222)
    panel.page.locator('[data-sl-run="run-1"]').click()
    assert panel.page.locator(".sl-card, .sl-plot, .section-title, .sl-empty").count() == 0
    panel.page.locator('[data-sl-run="run-1"]').click()
    panel.expect_latency(222)


def test_step_latency_load_failure_remains_visible(panel):
    panel.mount()
    panel.respond(0, outcome="http-error")
    assert panel.page.locator("#panel").is_visible()
    assert "Failed to load step latency" in panel.page.locator("#panel").inner_text()


@pytest.mark.parametrize("replace_strip", [False, True])
def test_trace_accordions_survive_remount_without_duplicates(panel, replace_strip):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup", trace_strip()
    )
    panel.mount()
    panel.respond(0)
    panel.tile("Avg Tokens").click()
    assert "llm:test" in panel.page.locator(".sl-ts-inset").inner_text()

    if replace_strip:
        # renderOverview replaces the trace strip before mounting its new panel.
        panel.page.locator("#stats").evaluate(
            "(el, markup) => el.innerHTML = markup", trace_strip()
        )
    panel.mount()
    panel.respond(1)
    panel.tile("Avg LLM Calls").click()
    assert "per trace" in panel.page.locator(".sl-ts-inset").inner_text()
    panel.tile("Avg Trace Latency").click()
    names = panel.page.locator(".sl-ts-inset .sl-ts-name").all_text_contents()
    assert names == ["Task", "Evaluator"]


@pytest.mark.parametrize("empty_scope", [False, True])
def test_trace_tile_without_breakdown_does_not_open_an_empty_inset(panel, empty_scope):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup", trace_strip()
    )
    data = payload(tokens=0)
    data["groups"][0].update(tokens_prompt=0, tokens_completion=0)
    if empty_scope:
        data["groups"] = []
    panel.mount()
    panel.respond_since(0, data)
    tile = panel.tile("Avg Tokens")
    tile.wait_for(state="visible")
    assert "sl-ts-expandable" not in tile.get_attribute("class")
    assert not tile.locator(".sl-ts-chev").is_visible()
    tile.click()
    assert panel.page.locator(".sl-ts-inset").count() == 0
    assert tile.is_visible()


def test_open_trace_breakdown_collapses_after_empty_pass_and_can_return(panel):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup", trace_strip()
    )
    panel.mount()
    panel.respond_since(0)
    panel.tile("Avg Tokens").click()
    assert panel.page.locator(".sl-ts-inset").is_visible()
    next_request = len(panel.requests())
    panel.select("passNum", "1")
    assert "Loading" in panel.page.locator(".sl-ts-inset").inner_text()
    panel.respond_since(next_request, {"groups": [], "passes": [1, 2]})
    assert panel.page.locator(".sl-ts-inset, .sl-ts-active").count() == 0
    assert "sl-ts-expandable" not in panel.tile("Avg Tokens").get_attribute("class")

    next_request = len(panel.requests())
    panel.select("passNum", "")
    panel.respond_since(next_request)
    panel.tile("Avg Tokens").click()
    assert "llm:test" in panel.page.locator(".sl-ts-inset").inner_text()


def test_trace_breakdown_fetch_failure_preserves_feedback(panel):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup", trace_strip()
    )
    panel.mount()
    panel.tile("Avg Tokens").click()
    assert "Loading" in panel.page.locator(".sl-ts-inset").inner_text()
    panel.respond(0, outcome="http-error")
    assert "Breakdown unavailable" in panel.page.locator(".sl-ts-inset").inner_text()


def test_trace_latency_without_folded_values_does_not_expand(panel):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup", trace_strip().replace("100ms", "—")
    )
    panel.mount()
    panel.respond_since(0)
    tile = panel.tile("Avg Trace Latency")
    tile.wait_for(state="visible")
    assert "sl-ts-expandable" not in tile.get_attribute("class")
    tile.click()
    assert panel.page.locator(".sl-ts-inset").count() == 0


@pytest.mark.parametrize("errors_only", [False, True])
def test_trace_latency_breakdown_requires_timings_and_keeps_zero(panel, errors_only):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup",
        trace_strip().replace("Avg Tokens", "Avg LLM Latency"),
    )
    data = payload(0)
    if errors_only:
        data["groups"][0].update(n=0, error_count=2, median_ms=None, mean_ms=None)
    panel.mount()
    panel.respond_since(0, data)
    panel.tile("Avg LLM Latency").click()
    if errors_only:
        assert panel.page.locator(".sl-ts-inset").count() == 0
        assert "err=2" in panel.page.locator(".sl-plot").text_content()
    else:
        assert "median 0" in panel.page.locator(".sl-ts-inset").inner_text()


def test_pass_change_in_kind_view_reloads_trace_breakdown_names(panel):
    panel.page.locator("#stats").evaluate(
        "(el, markup) => el.innerHTML = markup", trace_strip()
    )
    panel.mount()
    panel.respond(0, payload(tokens=900))
    panel.tile("Avg Tokens").click()
    panel.select("rollup", "kind")
    panel.respond(1, payload(step="llm", tokens=900))
    panel.select("passNum", "1")
    panel.respond(2, payload(step="llm", tokens=500))
    panel.page.wait_for_function(
        """() => latencyRequests.some(r => {
          const q = new URL(r.url, location.href).searchParams;
          return q.get('pass_number') === '1' && q.get('rollup') === 'name';
        })"""
    )
    for index, request in enumerate(panel.requests()):
        query = parse_qs(urlparse(request["url"]).query)
        if not request["settled"] and query.get("rollup") == ["name"]:
            panel.respond(index, payload(step="llm:pass-one", tokens=500))
    panel.page.wait_for_function(
        """() => document.querySelector('.sl-ts-inset')?.textContent
          .includes('llm:pass-one')"""
    )
    inset = panel.page.locator(".sl-ts-inset").inner_text()
    assert "500" in inset
    assert "900" not in inset


def test_comparison_legends_and_svg_preserve_labels_as_text(panel, tmp_path):
    labels = [
        "Team A",
        'Team </title><image href="data:," onerror="window.injected=true"/> & "B"',
    ]
    cohorts = [
        {"label": label, "runIds": [f"run-{index}"]}
        for index, label in enumerate(labels)
    ]
    panel.mount(["run-0", "run-1"], {"pooled": True, "cohorts": cohorts})
    panel.wait_requests(3)
    for index in range(3):
        panel.respond(index, payload(100 + index))
    legend = panel.page.locator(".sl-legend")
    for label in labels:
        assert label in legend.text_content()
    assert panel.page.locator(".sl-plot image").count() == 0
    assert panel.page.evaluate("window.injected !== true")

    with panel.page.expect_download() as downloaded:
        panel.page.locator("[data-sl-download-svg]").click()
    destination = tmp_path / "step-latency.svg"
    downloaded.value.save_as(destination)
    svg = ET.parse(destination).getroot()
    namespace = {"svg": "http://www.w3.org/2000/svg"}
    visible_text = [
        "".join(node.itertext()) for node in svg.findall(".//svg:text", namespace)
    ]
    for label in labels:
        assert label in visible_text
    assert not svg.findall(".//svg:image", namespace)


def test_wide_comparison_labels_fit_live_and_exported_legends(panel, tmp_path):
    panel.page.add_style_tag(path=str(SCRIPT.parent / "dashboard.css"))
    labels = ["W" * 130, "界" * 100, "Short cohort"]
    cohorts = [
        {"label": label, "runIds": [f"run-{index}"]}
        for index, label in enumerate(labels)
    ]
    panel.mount(
        [f"run-{index}" for index in range(len(labels))],
        {"pooled": True, "cohorts": cohorts},
    )
    panel.respond_since(0)
    panel.expect_latency(222)
    panel.page.evaluate("document.fonts.ready")

    def assert_labels_fit(svg):
        bounds = svg.evaluate(
            """svg => {
              const view = svg.viewBox.baseVal;
              return [...svg.querySelectorAll('g')].flatMap(group => {
                const title = group.querySelector(':scope > title');
                const text = group.querySelector(':scope > text');
                if (!title || !text) return [];
                const box = text.getBBox();
                return [{label: title.textContent, shown: text.textContent,
                  left: box.x, right: box.x + box.width,
                  top: box.y, bottom: box.y + box.height,
                  width: view.width, height: view.height}];
              });
            }"""
        )
        assert [entry["label"] for entry in bounds] == labels
        for entry in bounds:
            assert entry["left"] >= 0
            assert entry["top"] >= 0
            assert entry["right"] <= entry["width"] + 0.5, entry
            assert entry["bottom"] <= entry["height"] + 0.5, entry
        assert bounds[0]["shown"].endswith("…")
        assert bounds[-1]["shown"] == labels[-1]

    assert_labels_fit(panel.page.locator(".sl-legend svg"))
    with panel.page.expect_download() as downloaded:
        panel.page.locator("[data-sl-download-svg]").click()
    destination = tmp_path / "wide-labels.svg"
    downloaded.value.save_as(destination)
    exported = panel.page.context.new_page()
    exported.set_content(destination.read_text())
    exported.evaluate("document.fonts.ready")
    assert_labels_fit(exported.locator("svg").first)
    exported.close()


def test_csv_exports_preserve_individual_repeat_pass_scopes(panel):
    refs = ["run-1::pass1", "run-2::pass2"]
    panel.mount(refs, {"pooled": True})
    panel.wait_requests(3)
    for index in range(3):
        panel.respond(index)
    links = panel.page.locator("#panel a[download]")
    assert links.count() == 2
    for href in links.evaluate_all("links => links.map(link => link.href)"):
        query = parse_qs(urlparse(href).query)
        assert query["run_ids"] == [",".join(refs)]
        assert query["format"] == ["csv"]
