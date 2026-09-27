"""Browser regressions for dataset editing and import (design review C003, C004, C016-C019).

- C003: the items table has no inline cell editor (items are edited on the item page).
- C017: item page Save sends only edited fields and keeps each value's JSON type;
  history/compare diffs show type-only changes.
- C016: the import wizard validates every JSON/JSONL record and shows inline errors.
- C018: "Create dataset" never appends to an existing dataset; "new version" is explicit.
- C019: Windows-1256 CSVs are detected, and the encoding can be changed.
"""

import re
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.browser

ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
STATIC = ROOT / "packages/platform/qym_platform/_static/dashboard"
EXPORTS = (
    "openUploadWizard, renderItemsTab, renderItemPageDetails, saveItemPageItem, "
    "historyDiffBody, diffValueTexts, detectCSVEncoding, slugifyDatasetName, overflowMenuButton, "
)

SETUP_JS = """() => {
  window.requests = [];
  window.toasts = [];
  window.fileReads = 0;
  window.replyFor = () => null;
  const NativeFileReader = window.FileReader;
  window.FileReader = class extends NativeFileReader {
    constructor() {
      super();
      this.addEventListener('loadend', () => { window.fileReads += 1; });
    }
  };
  window.QymShell = {
    apiUrl: path => path,
    toast: (message, kind) => toasts.push({message, kind}),
    getProject: () => ({slug: 'project', name: 'Project'}),
    setBreadcrumbs: () => {},
    identicon: () => document.createElement('span'),
  };
  window.QymAuth = {requireAuth: () => new Promise(() => {})};
  window.fetch = (url, options) => {
    options = options || {};
    let body = options.body;
    if (body instanceof FormData) {
      const form = {};
      for (const [key, value] of body.entries()) form[key] = typeof value === 'string' ? value : {name: value.name};
      body = {form};
    } else if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { /* keep text */ }
    }
    const request = {url: String(url), method: options.method || 'GET', body};
    requests.push(request);
    const reply = window.replyFor(request);
    if (!reply) return new Promise(() => {});
    return Promise.resolve(new Response(JSON.stringify(reply.body),
      {status: reply.status || 200, headers: {'content-type': 'application/json'}}));
  };
}"""


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
            body='<main id="dsx-root"><div id="host"></div></main>',
            content_type="text/html",
        ),
    )
    page.goto("http://qym.test/projects/project/datasets/demo")
    page.evaluate(SETUP_JS)
    page.add_script_tag(path=str(STATIC / "metrics.js"))
    page.add_script_tag(path=str(STATIC / "qym_table.js"))
    source = re.findall(
        r"<script(?:\s[^>]*)?>([\s\S]*?)</script>",
        (STATIC / "datasets.html").read_text(),
    )[-1]
    assert "window.__dsx = { state," in source
    source = source.replace("window.__dsx = { state,", "window.__dsx = { " + EXPORTS + "state,")
    page.add_script_tag(content=source)
    page.evaluate("""() => Object.assign(__dsx.state, {slug: 'project', datasetRef: 'demo',
      dataset: {id: 'ds-demo', name: 'Demo', slug: 'demo'}, versionLabel: 'v1'})""")
    yield page
    context.close()
    assert errors == []


def _requests(page, method=None):
    reqs = page.evaluate("requests")
    return [r for r in reqs if method is None or r["method"] == method]


def _choose_file(page, name, content: bytes):
    before = page.evaluate("fileReads")
    page.locator('input[type="file"]').set_input_files(
        {"name": name, "mimeType": "application/octet-stream", "buffer": content}
    )
    page.wait_for_function("count => fileReads > count", arg=before)


def _continue(page):
    page.get_by_role("button", name="Continue →", exact=True).click()


def _active_step(page) -> str:
    return page.locator(".dsx-wizard-step.active").inner_text()


# ---------------------------------------------------------------------------
# C003
# ---------------------------------------------------------------------------


def test_draft_items_table_has_no_inline_cell_editor(page):
    page.evaluate("""() => {
      window.replyFor = req => req.url.includes('/items?') ? {body: {items: [
        {id: 1, item_id: 'case-1', index: 0, input: 'q', expected_output: '51', metadata: {topic: 'm'}, labels: ['gold']},
      ], total: 1}} : null;
      Object.assign(__dsx.state, {mode: 'detail', tab: 'items',
        activeVersion: {id: 'v2', version: 'v2', status: 'draft'}});
      __dsx.renderItemsTab(document.querySelector('#host'));
    }""")
    row = page.locator('tr[data-item-id="case-1"]')
    row.wait_for()
    for cell in ("td.col-input", "td.col-expected", "td.col-metadata"):
        target = row.locator(cell)
        assert "double-click" not in (target.get_attribute("title") or "")
        target.dispatch_event("dblclick")
    assert page.locator("#host textarea").count() == 0
    assert _requests(page, "PATCH") == []


# ---------------------------------------------------------------------------
# C017
# ---------------------------------------------------------------------------

ITEM_JS = """(item) => {
  const host = document.querySelector('#host');
  host.innerHTML = '';
  host.className = 'dsx-item-page';
  window.currentItem = item;
  window.currentVersion = {id: 'v2', version: 'v2', status: 'draft'};
  __dsx.renderItemPageDetails(host, item, window.currentVersion);
}"""


def _render_item(page, **overrides):
    item = {
        "id": 7,
        "item_id": "case-1",
        "index": 0,
        "input": "What is 50+1?",
        "expected_output": "51",
        "metadata": {"topic": "math"},
        "labels": ["gold"],
    }
    item.update(overrides)
    page.evaluate(ITEM_JS, item)


def _save(page):
    page.evaluate("() => { __dsx.saveItemPageItem(currentItem, currentVersion); }")


def _field(page, key):
    return page.locator(f'textarea[data-field="{key}"]')


def _panel(page, key):
    return page.locator(".dsx-item-panel").filter(has=page.locator(f'textarea[data-field="{key}"]'))


def test_item_page_save_sends_only_edited_fields(page):
    _render_item(page)
    assert _panel(page, "expected_output").locator(".dsx-item-type").inner_text() == "string"

    _save(page)
    assert _requests(page, "PATCH") == []
    assert page.evaluate("toasts")[-1]["message"] == "No changes to save"

    _field(page, "input").fill("What is 50+2?")
    _save(page)
    page.wait_for_function("requests.some(r => r.method === 'PATCH')")
    patch = _requests(page, "PATCH")[0]
    assert patch["url"] == "/v1/datasets/demo/versions/v2/items/case-1?project_slug=project"
    # Untouched expected_output ("51" string), metadata and labels are not sent at all.
    assert patch["body"] == {"input": "What is 50+2?"}


def test_item_page_save_does_not_resend_untouched_multiline_text(page):
    # A textarea reads "\r\n" back as "\n"; an untouched value must still count as unchanged.
    _render_item(page, input="line 1\r\nline 2")
    assert _panel(page, "input").locator(".dsx-item-field-state").inner_text().strip() == "unchanged"
    _save(page)
    assert _requests(page, "PATCH") == []
    assert page.evaluate("toasts")[-1]["message"] == "No changes to save"

    _field(page, "expected_output").fill("52")
    _save(page)
    page.wait_for_function("requests.some(r => r.method === 'PATCH')")
    assert _requests(page, "PATCH")[0]["body"] == {"expected_output": "52"}


def test_item_page_keeps_string_type_unless_switched_to_json(page):
    _render_item(page)
    _field(page, "expected_output").fill("52")
    _save(page)
    page.wait_for_function("requests.some(r => r.method === 'PATCH')")
    assert _requests(page, "PATCH")[0]["body"] == {"expected_output": "52"}

    page.evaluate("requests.length = 0")
    _render_item(page)
    panel = _panel(page, "expected_output")
    panel.get_by_role("button", name="JSON", exact=True).click()
    assert panel.locator(".dsx-item-type").inner_text() == "string → number"
    assert "will be saved as number" in panel.locator(".dsx-item-field-state").inner_text()
    _save(page)
    page.wait_for_function("requests.some(r => r.method === 'PATCH')")
    assert _requests(page, "PATCH")[0]["body"] == {"expected_output": 51}


def test_item_page_json_values_stay_json_and_invalid_json_is_not_saved(page):
    _render_item(page, expected_output=7)
    panel = _panel(page, "expected_output")
    assert panel.locator(".dsx-item-type").inner_text() == "number"
    assert panel.get_by_role("button", name="JSON", exact=True).get_attribute("aria-pressed") == "true"
    _field(page, "expected_output").fill("abc")
    assert _field(page, "expected_output").get_attribute("aria-invalid") == "true"
    _save(page)
    assert _requests(page, "PATCH") == []
    assert "Expected output" in page.evaluate("toasts")[-1]["message"]

    _field(page, "expected_output").fill("8")
    _save(page)
    page.wait_for_function("requests.some(r => r.method === 'PATCH')")
    assert _requests(page, "PATCH")[0]["body"] == {"expected_output": 8}


def test_history_and_compare_diffs_show_type_only_changes(page):
    text = page.evaluate("""() => {
      const node = __dsx.historyDiffBody({input: 'q', expected_output: '51'}, {input: 'q', expected_output: 51});
      document.querySelector('#host').appendChild(node);
      return node.innerText;
    }""")
    assert "type changed: string → number" in text
    assert '"51"' in text
    assert "No field changes recorded" not in text
    same = page.evaluate("() => __dsx.diffValueTexts('a b', 'a c')")
    assert same == {"before": "a b", "after": "a c", "note": ""}
    typed = page.evaluate("() => __dsx.diffValueTexts('true', true)")
    assert typed == {"before": '"true"', "after": "true", "note": "type changed: string → boolean"}


# ---------------------------------------------------------------------------
# C016
# ---------------------------------------------------------------------------


def _open_wizard(page, **opts):
    page.evaluate("opts => __dsx.openUploadWizard(opts)", opts)


def test_invalid_jsonl_lines_block_continue_with_line_numbers(page):
    _open_wizard(page, mode="add-to-draft", ref="demo", versionLabel="v1")
    _choose_file(page, "rows.jsonl", b'{"input": "ok"}\n{bad json}\n\n["array"]\n{"input": "fine"}\n')
    alert = page.locator("#dsx-wiz-file-error")
    alert.wait_for()
    text = alert.inner_text()
    assert "2 of 4 lines cannot be imported" in text
    assert "Line 2 is not valid JSON" in text
    assert "Line 4 must be a JSON object" in text
    _continue(page)
    assert "Source" in _active_step(page)
    assert page.locator(".dsx-preview-table").count() == 0
    assert _requests(page) == []


def test_json_array_file_imports_every_item_with_aliases(page):
    _open_wizard(page, mode="add-to-draft", ref="demo", versionLabel="v1")
    _choose_file(page, "rows.json", b'[{"id": 1, "input": "q1", "expected": "a1", "extra": true}, {"item_id": "b", "input": {"q": 2}}]')
    assert "JSON" in page.locator("#dsx-wiz-fmt").inner_text()
    _continue(page)
    review = page.locator("#dsx-wiz-body").inner_text()
    assert "2 rows" in review
    assert "Not imported: 1 key (extra)" in review
    page.get_by_role("button", name="Add items", exact=True).click()
    page.wait_for_function("requests.length === 1")
    request = _requests(page)[0]
    assert request["body"]["upserts"] == [
        {"item_id": "1", "input": "q1", "expected_output": "a1"},
        {"item_id": "b", "input": {"q": 2}},
    ]


def test_draft_json_import_reads_ids_and_labels_like_the_server(page):
    # The server's JSON/JSONL parser accepts "a,b" label strings and non-string list items;
    # the draft import must send the same labels instead of a body the bulk API rejects.
    _open_wizard(page, mode="add-to-draft", ref="demo", versionLabel="v1")
    _choose_file(
        page,
        "rows.jsonl",
        b'{"item_id": " a ", "input": "q1", "labels": "gold, hard"}\n{"id": 0, "input": "q2", "labels": ["x", 3, ""]}\n',
    )
    _continue(page)
    page.get_by_role("button", name="Add items", exact=True).click()
    page.wait_for_function("requests.length === 1")
    assert _requests(page)[0]["body"]["upserts"] == [
        {"item_id": "a", "input": "q1", "labels": ["gold", "hard"]},
        {"input": "q2", "labels": ["x", "3"]},
    ]


def test_required_fields_are_marked_inline_not_only_in_toasts(page):
    _open_wizard(page, mode="new")
    _continue(page)
    name = page.locator("#dsx-wiz-name")
    assert name.get_attribute("aria-invalid") == "true"
    assert "Enter a name for the dataset." in page.locator("#dsx-wiz-name-error").inner_text()
    assert "Choose a file to upload." in page.locator("#dsx-wiz-file-error").inner_text()
    assert page.evaluate("toasts") == []


def test_review_step_lists_columns_that_will_not_be_imported(page):
    page.evaluate("() => { __dsx.state.datasets = []; }")
    _open_wizard(page, mode="new")
    page.locator("#dsx-wiz-name").fill("Probe")
    _choose_file(page, "probe.csv", b"input,expected_output,category,difficulty\nq,a,geo,easy\n")
    _continue(page)
    _continue(page)
    ignored = page.locator("#dsx-wiz-ignored").inner_text()
    assert "Not imported: 2 columns (category, difficulty)" in ignored


# ---------------------------------------------------------------------------
# C018 + C004
# ---------------------------------------------------------------------------

EXISTING = [{"id": "ds-1", "name": "ragbench-100", "slug": "ragbench-100", "latest_version": {"version": "v13"}}]


def test_create_dataset_blocks_existing_name_and_offers_explicit_new_version(page):
    page.evaluate("datasets => { __dsx.state.datasets = datasets; }", EXISTING)
    _open_wizard(page, mode="new")
    page.locator("#dsx-wiz-name").fill("RAGBench-100")
    error = page.locator("#dsx-wiz-name-error")
    assert 'A dataset named "ragbench-100" already exists' in error.inner_text()
    _choose_file(page, "probe.csv", b"input,expected_output\nq,a\n")
    _continue(page)
    assert "Source" in _active_step(page)

    page.get_by_role("button", name='Upload as a new version of "ragbench-100"').click()
    assert page.locator("#dsx-wiz-title").inner_text() == "Upload new version"
    _continue(page)
    _continue(page)
    review = page.locator("#dsx-wiz-body").inner_text()
    assert 'as version v14' in review
    publish = page.get_by_label("Publish immediately")
    production = page.get_by_label("Set as production alias")
    assert not publish.is_checked()
    assert not production.is_checked() and production.is_disabled()
    page.get_by_role("button", name="Create version", exact=True).click()
    page.wait_for_function("requests.length === 1")
    form = _requests(page)[0]["body"]["form"]
    assert form["dataset_ref"] == "ds-1"
    assert "create_only" not in form
    assert "publish" not in form and "set_alias" not in form
    assert form["format"] == "csv" and form["encoding"] == "utf-8"


def test_create_dataset_sends_create_only_and_shows_slug(page):
    page.evaluate("datasets => { __dsx.state.datasets = datasets; }", EXISTING)
    _open_wizard(page, mode="new")
    page.locator("#dsx-wiz-name").fill("بيانات التقييم")
    assert "Slug: بيانات-التقييم" in page.locator("#dsx-wiz-slug").inner_text()
    _choose_file(page, "probe.csv", b"input,expected_output\nq,a\n")
    _continue(page)
    _continue(page)
    assert "بيانات-التقييم" in page.locator(".dsx-wiz-slug").inner_text()
    page.evaluate("""() => { window.replyFor = req => req.url.includes(':upload')
      ? {status: 409, body: {detail: "A dataset named 'x' already exists (slug 'x')."}} : null; }""")
    page.get_by_role("button", name="Create dataset", exact=True).click()
    page.locator("#dsx-wiz-submit-error").wait_for()
    assert "already exists" in page.locator("#dsx-wiz-submit-error").inner_text()
    form = _requests(page)[0]["body"]["form"]
    assert form["create_only"] == "true"
    assert form["name"] == "بيانات التقييم"
    assert form["publish"] == "true" and form["set_alias"] == "production"


def test_dataset_page_menu_offers_new_version_upload(page):
    page.evaluate("""() => {
      Object.assign(__dsx.state, {activeVersion: {id: 'v2', version: 'v2', status: 'published'},
        versions: [{version: 'v1'}, {version: 'v2'}]});
      document.querySelector('#host').appendChild(__dsx.overflowMenuButton());
    }""")
    page.get_by_role("button", name="More actions").click()
    page.get_by_text("↑ Upload file as new version…").click()
    assert page.locator("#dsx-wiz-title").inner_text() == "Upload new version"
    _choose_file(page, "probe.csv", b"input,expected_output\nq,a\n")
    _continue(page)
    _continue(page)
    assert 'Adds this file to "Demo" as version v3' in page.locator("#dsx-wiz-body").inner_text()
    # A new version of an existing dataset stays a draft and leaves production alone by default.
    assert not page.get_by_label("Publish immediately").is_checked()
    assert not page.get_by_label("Set as production alias").is_checked()
    page.get_by_role("button", name="Create version", exact=True).click()
    page.wait_for_function("requests.length === 1")
    form = _requests(page)[0]["body"]["form"]
    assert form["dataset_ref"] == "ds-demo" and form["name"] == "Demo"
    assert "create_only" not in form and "publish" not in form and "set_alias" not in form


def test_slugify_matches_the_server(page):
    from qym_platform.api.datasets import _slugify

    for name in ["Customer Support QA!", "snake_case name", "بيانات التقييم", "قيِّم", "Café crème", "  a -- b  "]:
        assert page.evaluate("name => __dsx.slugifyDatasetName(name)", name) == _slugify(name)


# ---------------------------------------------------------------------------
# C019
# ---------------------------------------------------------------------------

ARABIC_CSV = "السؤال,الإجابة\nما هي عاصمة المملكة العربية السعودية؟,الرياض\nكم عدد أيام الأسبوع؟,سبعة\n"


def test_windows_1256_csv_is_detected_and_encoding_can_be_changed(page):
    _open_wizard(page, mode="add-to-draft", ref="demo", versionLabel="v1")
    _choose_file(page, "arabic.csv", ARABIC_CSV.encode("cp1256"))
    select = page.locator("#dsx-wiz-encoding")
    assert select.input_value() == "windows-1256"
    assert page.locator(".dsx-wiz-alert.warning").count() == 0
    _continue(page)
    assert "السؤال" in page.locator("#dsx-wiz-body").inner_text()
    page.get_by_role("button", name="← Back").click()

    page.locator("#dsx-wiz-encoding").select_option("windows-1252")
    warning = page.locator(".dsx-wiz-alert.warning")
    warning.wait_for()
    assert "looks garbled" in warning.inner_text()
    assert "CSV UTF-8" in warning.inner_text()

    page.locator("#dsx-wiz-encoding").select_option("utf-8")
    assert "not valid UTF-8" in page.locator("#dsx-wiz-file-error").inner_text()
    _continue(page)
    assert "Source" in _active_step(page)


def test_new_dataset_upload_sends_the_chosen_encoding(page):
    page.evaluate("() => { __dsx.state.datasets = []; }")
    _open_wizard(page, mode="new")
    page.locator("#dsx-wiz-name").fill("Arabic Excel")
    _choose_file(page, "arabic.csv", ARABIC_CSV.encode("cp1256"))
    _continue(page)
    page.locator(".dsx-mapping").wait_for()
    # Drag-free mapping: assign the Arabic question column as input.
    page.evaluate("""() => {
      const chip = Array.from(document.querySelectorAll('.dsx-mapping-bank .dsx-mapping-chip'))
        .find(node => node.textContent.trim() === 'السؤال');
      const target = Array.from(document.querySelectorAll('.dsx-mapping-field'))
        .find(node => node.textContent.includes('Input'));
      const data = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', {dataTransfer: data, bubbles: true}));
      target.dispatchEvent(new DragEvent('drop', {dataTransfer: data, bubbles: true}));
    }""")
    _continue(page)
    review = page.locator("#dsx-wiz-body").inner_text()
    assert "Windows-1256 (Arabic)" in review
    page.get_by_role("button", name="Create dataset", exact=True).click()
    page.wait_for_function("requests.length === 1")
    form = _requests(page)[0]["body"]["form"]
    assert form["encoding"] == "windows-1256"
    assert form["input_cols"] == "السؤال"


@pytest.mark.parametrize(
    "text,encoding",
    [
        (ARABIC_CSV, "cp1256"),
        ("q,a\nپرسش چيست؟,گزارش ژرف\n", "cp1256"),
        ("question;answer\nCafé?;Crème brûlée\nÇa va?;Très bien\n", "cp1252"),
        ("q,a\nGrüße aus der Straße,Schön\n", "cp1252"),
        ("q,a\nSeñor, ¿cómo está?,Muy bien\n", "cp1252"),
        ("q,a\nplain ascii,only\n", "utf-8"),
    ],
)
def test_browser_encoding_detection_matches_the_server(page, text, encoding):
    from qym_platform.api.datasets import _decode_csv

    raw = text.encode(encoding)
    _, server_label = _decode_csv(raw)
    browser_label = page.evaluate("bytes => __dsx.detectCSVEncoding(new Uint8Array(bytes))", list(raw))
    assert browser_label == server_label
