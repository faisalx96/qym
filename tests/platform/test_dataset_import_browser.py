"""Draft imports submit every parsed item while keeping the preview bounded."""

import csv
import io
import json
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.browser

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
        lambda route: route.fulfill(body="<main></main>", content_type="text/html"),
    )
    page.goto("http://qym.test/projects/project/datasets/demo")
    page.evaluate("""() => {
      window.importRequests = [];
      window.fileReadComplete = false;
      const NativeFileReader = window.FileReader;
      window.FileReader = class extends NativeFileReader {
        constructor() {
          super();
          this.addEventListener('loadend', () => { window.fileReadComplete = true; });
        }
      };
      window.QymShell = {apiUrl: path => path, toast: () => {}};
      window.QymAuth = {requireAuth: () => new Promise(() => {})};
      window.fetch = (url, options) => {
        importRequests.push({url, method: options.method, body: JSON.parse(options.body)});
        return new Promise(() => {});
      };
    }""")
    source = re.findall(
        r"<script(?:\s[^>]*)?>([\s\S]*?)</script>",
        (STATIC / "datasets.html").read_text(),
    )[-1]
    source = source.replace(
        "window.__dsx = { state,", "window.__dsx = { openUploadWizard, state,"
    )
    page.add_script_tag(content=source)
    page.evaluate("""() => {
      Object.assign(__dsx.state, {slug: 'project', datasetRef: 'demo',
        dataset: {name: 'Demo'}, versionLabel: 'v1'});
      __dsx.openUploadWizard({mode: 'add-to-draft', ref: 'demo', versionLabel: 'v1'});
    }""")
    yield page
    context.close()
    assert errors == []


@pytest.mark.parametrize("file_format", ["csv", "tsv", "jsonl"])
@pytest.mark.parametrize("item_count", [3, 125])
def test_draft_import_submits_all_rows(page, file_format, item_count):
    items = [
        {
            "item_id": f"case-{index}",
            "input": f'Question {index}, "quoted"\tvalue',
            "expected_output": (
                'SELECT "customer_id", \'السعودية\' AS region\n'
                f"FROM customers WHERE id = {index};"
            ),
        }
        for index in range(item_count)
    ]
    if file_format == "jsonl":
        contents = "\n\n".join(json.dumps(item, ensure_ascii=False) for item in items)
    else:
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=list(items[0]),
            delimiter="\t" if file_format == "tsv" else ",",
        )
        writer.writeheader()
        writer.writerows(items)
        contents = output.getvalue()
    page.locator('input[type="file"]').set_input_files(
        {
            "name": f"items.{file_format}",
            "mimeType": "text/plain",
            "buffer": contents.encode(),
        }
    )
    page.wait_for_function("fileReadComplete")
    page.get_by_role("button", name="Continue →", exact=True).click()
    if file_format != "jsonl":
        page.get_by_role("button", name="Continue →", exact=True).click()
    assert page.locator(".dsx-preview-table tbody tr").count() == min(item_count, 10)
    review = page.locator("#dsx-wiz-body").inner_text()
    page.get_by_role("button", name="Add items", exact=True).click()
    page.wait_for_function("importRequests.length === 1")
    request = page.evaluate("importRequests[0]")
    assert request["url"] == "/v1/datasets/demo/versions/v1/items:bulk?project_slug=project"
    assert request["method"] == "POST"
    assert request["body"]["upserts"] == items
    assert f"{item_count} rows" in review
    assert f"preview shows first {min(item_count, 10)} rows" in review
