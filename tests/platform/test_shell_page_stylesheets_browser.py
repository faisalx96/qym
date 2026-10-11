"""A page reached in-app keeps its own stylesheets.

shell.js carried only ``<style>`` across client-side navigation, never a
page's ``<link rel="stylesheet">``: a run opened from another page painted its
versioning details, run metadata viewer and Latency and traces panels bare,
with the browser's white inputs and grey buttons, until a full reload.
"""

from __future__ import annotations

import pytest
from test_performance_views_browser import STATIC, ViewFixture

pytestmark = pytest.mark.browser

METADATA = {"prompt_version": "v7", "retrieval": {"top_k": 5, "rerank": True}}
VERSIONING = {"git_sha": "abc123", "prompt": "v7"}
RUN_SHEETS = ("latency_traces.css", "json_viewer.css", "run_versioning_details.css")

PROBE = """() => {
  const bg = (sel) => {
    const node = document.querySelector(sel);
    return node ? getComputedStyle(node).backgroundColor : null;
  };
  const token = (name) => {
    const probe = document.createElement('div');
    probe.style.background = 'var(' + name + ')';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  };
  return {
    sheets: Array.from(document.querySelectorAll('link[rel=stylesheet]'))
      .map((link) => link.href.split('/').pop().split('?')[0]),
    versioning: bg('.rvd-panel'),
    search: bg('.lt-search'),
    kind: bg('.lt-kind'),
    preview: bg('.qjv-preview'),
    surface: token('--bg-surface'),
    elevated: token('--bg-elevated'),
  };
}"""


class ShellFixture(ViewFixture):
    """The run page under the real shell, reachable in-app from Settings."""

    def __init__(self, browser, *, blocked=()):
        super().__init__(browser, "run", count=4)
        self.blocked = tuple(blocked)
        self.console = []
        self.page.on("console", lambda msg: self.console.append((msg.type, msg.text)))
        self.data["run-1"]["run"]["metadata"] = METADATA
        self.data["run-1"]["run"]["versioning_details"] = VERSIONING

    def route(self, route):
        path = route.request.url.split("http://qym.test", 1)[-1].split("?", 1)[0]
        if any(path.endswith("/" + name) for name in self.blocked):
            return route.fulfill(status=404, body="")
        if path == "/projects/demo/settings":
            return route.fulfill(
                body=(STATIC / "profile.html").read_text(encoding="utf-8"),
                content_type="text/html",
            )
        if path == "/projects/demo/runs/run-1":
            return route.fulfill(
                body=(STATIC / "run.html").read_text(encoding="utf-8"),
                content_type="text/html",
            )
        return super().route(route)

    def open_run_in_app(self):
        page = self.page
        page.goto("http://qym.test/projects/demo/settings")
        page.wait_for_function(
            "() => Boolean(window.QymShell && window.QymShell.getUser())"
        )
        page.evaluate("window.__stayedInApp = true")
        page.evaluate("QymShell.navigateTo('/projects/demo/runs/run-1')")
        page.wait_for_selector("#run-summary .qjv-preview")
        page.wait_for_selector(".rvd-panel")
        page.wait_for_selector(".lt-kind", timeout=15000)
        assert page.evaluate(
            "window.__stayedInApp === true"
        ), "fell back to a full reload"
        return page.evaluate(PROBE)


def test_in_app_navigation_carries_the_run_page_stylesheets(browser):
    fixture = ShellFixture(browser)
    try:
        probe = fixture.open_run_in_app()
        for name in RUN_SHEETS:
            assert probe["sheets"].count(name) == 1, (name, probe["sheets"])
        # Each panel sits on its design token, not the browser's defaults.
        assert probe["versioning"] == probe["surface"]
        assert probe["search"] == probe["elevated"]
        assert probe["preview"] == "rgba(0, 0, 0, 0)"
        assert probe["kind"] not in ("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)")
        assert not [m for m in fixture.console if m[0] == "error"], fixture.console
    finally:
        fixture.close()


def test_a_missing_page_stylesheet_is_reported_and_never_paints_white(browser):
    fixture = ShellFixture(browser, blocked=("latency_traces.css",))
    try:
        probe = fixture.open_run_in_app()
        # The other sheets still arrive; the failure is named, not swallowed.
        assert "latency_traces.css" not in probe["sheets"]
        assert "json_viewer.css" in probe["sheets"]
        assert probe["versioning"] == probe["surface"]
        failures = [
            m for m in fixture.console if "Page stylesheet failed to load" in m[1]
        ]
        assert failures and "latency_traces.css" in failures[0][1]
        # The document's dark color scheme keeps even an unstyled input dark.
        assert probe["search"] not in ("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)")
    finally:
        fixture.context.close()
