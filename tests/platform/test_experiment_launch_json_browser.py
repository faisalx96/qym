"""JSON settings edited as fields (experiment_launch_json.js) in a real browser."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import pytest

from test_dashboard_paging_browser import browser  # noqa: F401

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)
pytestmark = pytest.mark.browser

# Hosts one editor the way experiment_launch.js does; window.changes records onChange
# and window.inputs the bubbling `input` events the form listens to.
HARNESS = """<!doctype html><html><body><div id="host"></div>
<script src="/static/experiment_launch_json.js"></script>
<script>
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    [].concat(children == null ? [] : children).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  window.changes = [];
  window.inputs = 0;
  window.raw = 0;
  window.mountEditor = (value) => {
    const node = window.QymLaunchJson.editor({
      el, value, label: 'SETTING',
      onChange: (next) => window.changes.push(next),
      onRaw: () => { window.raw += 1; },
    });
    node.addEventListener('input', () => { window.inputs += 1; });
    document.getElementById('host').replaceChildren(node);
  };
</script></body></html>"""

ROUTES = [
    {"name": "a", "weight": 1, "enabled": True},
    {"name": "b", "weight": 2, "enabled": True},
]


class Harness:
    def __init__(self, browser):
        self.errors = []
        self.context = browser.new_context(viewport={"width": 1280, "height": 800})
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self.route)
        self.page.goto("https://qym.test/harness")

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path == "/harness":
            route.fulfill(body=HARNESS, content_type="text/html")
        elif url.path.startswith("/static/"):
            route.fulfill(
                path=str(STATIC / url.path.split("/static/", 1)[1]),
                content_type="application/javascript; charset=utf-8",
            )
        else:
            route.fulfill(status=404, json={"detail": url.path})

    def mount(self, value):
        self.page.evaluate("(v) => window.mountEditor(v)", value)

    def last(self):
        return self.page.evaluate("window.changes[window.changes.length - 1]")


@pytest.fixture
def harness(browser):  # noqa: F811
    view = Harness(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_container_reads_values_and_json_text(harness):
    page = harness.page
    assert page.evaluate("QymLaunchJson.container([1], 'json')") == [1]
    assert page.evaluate("QymLaunchJson.container('[1, 2]', 'string')") == [1, 2]
    assert page.evaluate("QymLaunchJson.container(' {\"a\": 1}', 'string')") == {"a": 1}
    assert page.evaluate("QymLaunchJson.container('plain', 'string')") is None
    assert page.evaluate("QymLaunchJson.container('[broken', 'string')") is None
    assert page.evaluate("QymLaunchJson.container(3, 'json')") is None
    assert page.evaluate("QymLaunchJson.uniformKeys([{a: 1, b: 2}, {b: 3, a: 4}])") == [
        "a",
        "b",
    ]
    assert page.evaluate("QymLaunchJson.uniformKeys([{a: 1}, {b: 2}])") is None
    assert page.evaluate("QymLaunchJson.uniformKeys([1, 2])") is None


def test_same_key_objects_are_a_table_with_an_all_items_row(harness):
    page = harness.page
    harness.mount(ROUTES)
    assert page.locator("table.xlj-table thead th").all_text_contents() == [
        "#",
        "name",
        "weight",
        "enabled",
        "",
    ]
    all_weight = page.get_by_label("SETTING · * · weight (all items)", exact=True)
    assert all_weight.input_value() == ""  # 1 and 2 differ
    assert all_weight.get_attribute("placeholder") == "Mixed"
    all_weight.fill("5")
    assert harness.last() == [
        {"name": "a", "weight": 5, "enabled": True},
        {"name": "b", "weight": 5, "enabled": True},
    ]
    # Every row shows the global value, typed as a number.
    assert page.get_by_label("SETTING · 0 · weight", exact=True).input_value() == "5"
    assert page.get_by_label("SETTING · 1 · weight", exact=True).input_value() == "5"
    # Booleans: the "All items" select applies to every item.
    page.get_by_label("SETTING · * · enabled (all items)", exact=True).select_option("false")
    assert [item["enabled"] for item in harness.last()] == [False, False]
    # One cell edit; the global name cell then shows "Mixed" again.
    page.get_by_label("SETTING · 1 · name", exact=True).fill("c")
    assert [item["name"] for item in harness.last()] == ["a", "c"]
    # Each edit is one bubbling input event on the editor root.
    assert page.evaluate("window.inputs") == len(page.evaluate("window.changes"))


def test_rows_are_added_as_copies_and_removed(harness):
    page = harness.page
    harness.mount(ROUTES)
    page.get_by_role("button", name="+ Add item").click()
    assert harness.last() == ROUTES + [ROUTES[-1]]
    assert page.locator("table.xlj-table tbody tr").count() == 4  # "All items" + 3
    page.get_by_role("button", name="Remove item 1").click()
    assert harness.last() == [ROUTES[1], ROUTES[1]]


def test_numbers_reject_text_without_committing(harness):
    page = harness.page
    harness.mount(ROUTES)
    cell = page.get_by_label("SETTING · 0 · weight", exact=True)
    cell.fill("abc")
    assert cell.get_attribute("aria-invalid") == "true"
    assert page.evaluate("window.changes") == []
    cell.fill("7")
    assert cell.get_attribute("aria-invalid") is None
    assert harness.last()[0]["weight"] == 7


def test_objects_and_scalar_lists_become_fields(harness):
    page = harness.page
    harness.mount({"threshold": 0.4, "tables": ["a", "b"], "nested": {"on": False}})
    page.get_by_label("SETTING · threshold", exact=True).fill("0.6")
    assert harness.last()["threshold"] == 0.6
    page.get_by_label("SETTING · tables · 1", exact=True).fill("z")
    assert harness.last()["tables"] == ["a", "z"]
    page.get_by_label("SETTING · nested · on", exact=True).select_option("true")
    assert harness.last()["nested"] == {"on": True}
    # New keys read typed text as JSON when it parses, else as a string. The
    # top-level "+ Add key" comes last (after the nested object's own).
    page.get_by_label("new key", exact=True).last.fill("limit")
    page.get_by_role("button", name="+ Add key").last.click()
    page.get_by_label("SETTING · limit", exact=True).fill("[1, 2]")
    assert harness.last()["limit"] == [1, 2]
    page.get_by_label("SETTING · limit", exact=True).fill("hello")
    assert harness.last()["limit"] == "hello"
    page.get_by_role("button", name="Remove limit").click()
    assert "limit" not in harness.last()


def test_mixed_lists_are_cards_and_raw_json_is_one_click(harness):
    page = harness.page
    harness.mount([{"a": 1}, {"b": {"deep": "x"}}])
    assert page.locator("table.xlj-table").count() == 0
    assert page.get_by_text("Item 2").is_visible()
    page.get_by_label("SETTING · 1 · b · deep", exact=True).fill("y")
    assert harness.last() == [{"a": 1}, {"b": {"deep": "y"}}]
    page.get_by_role("button", name="Edit as JSON").click()
    assert page.evaluate("window.raw") == 1


def test_values_are_text_never_html(harness):
    page = harness.page
    payload = '<img src=x onerror="window.pwned=1">'
    harness.mount([{payload: payload}])
    assert page.locator("#host img").count() == 0
    assert page.evaluate("window.pwned") is None
