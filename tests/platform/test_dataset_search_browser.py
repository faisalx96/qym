"""Search responses cannot overwrite a newer query or dataset version."""

import re
from pathlib import Path

import pytest

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


@pytest.fixture()
def page(browser):
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(5000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route(
        "http://qym.test/**",
        lambda route: route.fulfill(
            body='<main id="host"></main>', content_type="text/html"
        ),
    )
    page.goto("http://qym.test/projects/project/datasets/demo")
    page.evaluate("""() => {
      window.toasts = [];
      window.pendingSearches = [];
      window.QymShell = {apiUrl: path => path, toast: message => toasts.push(message)};
      window.QymAuth = {requireAuth: () => new Promise(() => {})};
      window.fetch = url => new Promise((resolve, reject) => pendingSearches.push({url, resolve, reject}));
    }""")
    page.add_script_tag(path=str(STATIC / "metrics.js"))
    page.add_script_tag(path=str(STATIC / "qym_table.js"))
    source = re.findall(
        r"<script(?:\s[^>]*)?>([\s\S]*?)</script>",
        (STATIC / "datasets.html").read_text(),
    )[-1]
    source = source.replace(
        "window.__dsx = { state,", "window.__dsx = { renderItemsTab, state,"
    )
    page.add_script_tag(content=source)
    page.evaluate("""() => {
      Object.assign(__dsx.state, {mode: 'detail', slug: 'project', datasetRef: 'demo',
        tab: 'items', versionLabel: 'v1', activeVersion: {id: 'v1', version: 'v1', status: 'published'}});
      __dsx.renderItemsTab(document.querySelector('#host'));
    }""")
    respond(page, 0, "initial")
    yield page
    assert errors == []
    context.close()


def respond(page, index, item_id=None, *, status=200):
    page.wait_for_function("index => pendingSearches.length > index", arg=index)
    items = (
        [
            {
                "id": index + 1,
                "item_id": item_id,
                "index": index,
                "input": "السعودية",
                "expected_output": "الرياض",
            }
        ]
        if item_id
        else []
    )
    page.evaluate(
        """({index, body, status}) => pendingSearches[index].resolve(
      new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}}))""",
        {
            "index": index,
            "body": {"items": items, "total": len(items)},
            "status": status,
        },
    )


def search(page, query, count):
    page.locator(".dsx-itemsearch").fill(query)
    page.wait_for_function("count => pendingSearches.length === count", arg=count)


@pytest.mark.parametrize("old_status", [200, 503])
def test_latest_search_wins_over_late_success_or_failure(page, old_status):
    search(page, "س", 2)
    search(page, "السعودية", 3)
    respond(page, 2, "latest")
    page.locator('tr[data-item-id="latest"]').wait_for()
    respond(page, 1, "obsolete", status=old_status)
    assert page.locator('tr[data-item-id="latest"]').is_visible()
    assert page.locator('tr[data-item-id="obsolete"]').count() == 0
    assert page.evaluate("__dsx.state.itemsList.items[0].item_id") == "latest"
    assert page.evaluate("toasts") == []


def test_typing_invalidates_a_response_before_debounce_finishes(page):
    search(page, "س", 2)
    page.evaluate("""() => {
      const input = document.querySelector('.dsx-itemsearch');
      input.value = 'السعودية';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      pendingSearches[1].resolve(new Response(JSON.stringify({items: [{id: 9, item_id: 'obsolete'}], total: 1}),
        {headers: {'content-type': 'application/json'}}));
    }""")
    assert page.evaluate("__dsx.state.itemsList.items[0].item_id") == "initial"
    respond(page, 2, "latest")
    page.locator('tr[data-item-id="latest"]').wait_for()


def test_old_version_response_cannot_replace_new_version(page):
    search(page, "السعودية", 2)
    page.evaluate("""() => {
      const host = document.querySelector('#host');
      host.innerHTML = '';
      __dsx.state.activeVersion = {id: 'v2', version: 'v2', status: 'published'};
      __dsx.state.versionLabel = 'v2';
      __dsx.renderItemsTab(host);
    }""")
    respond(page, 2, "new-version")
    respond(page, 1, "old-version")
    page.locator('tr[data-item-id="new-version"]').wait_for()
    assert page.evaluate("__dsx.state.itemsList.items[0].item_id") == "new-version"


def test_zero_search_matches_does_not_claim_the_dataset_is_empty(page):
    search(page, "مفقود", 2)
    respond(page, 1)
    page.get_by_text("No items match these filters", exact=True).wait_for()
    assert "This version has no items" not in page.locator("#host").inner_text()
    search(page, "", 3)
    respond(page, 2, "restored")
    page.locator('tr[data-item-id="restored"]').wait_for()
