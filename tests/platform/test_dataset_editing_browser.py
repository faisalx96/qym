"""Browser regressions for dataset editing and import (design review C003, C004, C016-C019).

- C003: the items table has no inline cell editor (items are edited on the item page).
- C017: item page Save sends only edited fields and keeps each value's JSON type;
  history/compare diffs show type-only changes.
- C016: the import wizard validates every JSON/JSONL record and shows inline errors.
- C018: "Create dataset" never appends to an existing dataset; "new version" is explicit.
- C019: Windows-1256 CSVs are detected, and the encoding can be changed.
- C052: the upload wizard is a labelled modal dialog that keeps focus inside,
  maps columns with a select per column (unknown columns default to Metadata),
  and asks before Escape, the backdrop or Cancel throw away a loaded file.
- C048: row menus and the version switcher work from the keyboard.
- C181/C321: compare pages its lists, lists changes by time with their
  timestamp, opens the first rows, and diffs long fields within a budget.
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
    "historyDiffBody, diffValueTexts, detectCSVEncoding, legacyTextScore, slugifyDatasetName, overflowMenuButton, "
    "compareView, renderLineageTab, wordDiff, diffHtmlPair, versionSelectorPill, renderSettingsTab, "
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
    # Pages load the shared escaping layer before any other script.
    page.add_script_tag(path=str(STATIC / "qym_safe.js"))
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
    # Unknown columns are kept as Metadata by default (C052), never dropped silently.
    assert page.get_by_label("category").input_value() == "metadata"
    page.get_by_label("difficulty").select_option("ignore")
    _continue(page)
    ignored = page.locator("#dsx-wiz-ignored").inner_text()
    assert "Not imported: 1 column (difficulty)" in ignored
    page.get_by_role("button", name="Create dataset", exact=True).click()
    page.wait_for_function("requests.length === 1")
    form = _requests(page)[0]["body"]["form"]
    assert form["metadata_cols"] == "category"
    assert form["input_cols"] == "input" and form["expected_cols"] == "expected_output"


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
    page.locator(".dsx-mapping-table").wait_for()
    # Keyboard-operable mapping: each column has its own labelled select.
    page.get_by_label("السؤال").select_option("input")
    page.get_by_label("الإجابة").select_option("expected")
    _continue(page)
    review = page.locator("#dsx-wiz-body").inner_text()
    assert "Windows-1256 (Arabic)" in review
    page.get_by_role("button", name="Create dataset", exact=True).click()
    page.wait_for_function("requests.length === 1")
    form = _requests(page)[0]["body"]["form"]
    assert form["encoding"] == "windows-1256"
    assert form["input_cols"] == "السؤال"
    assert form["expected_cols"] == "الإجابة"


@pytest.mark.parametrize(
    "text,encoding",
    [
        (ARABIC_CSV, "cp1256"),
        ("q,a\nپرسش چيست؟,گزارش ژرف\n", "cp1256"),
        ("question;answer\nCafé?;Crème brûlée\nÇa va?;Très bien\n", "cp1252"),
        ("q,a\nGrüße aus der Straße,Schön\n", "cp1252"),
        ("q,a\nSeñor, ¿cómo está?,Muy bien\n", "cp1252"),
        ("q,a\nIl habite à Londres.,Oui\n", "cp1252"),
        ("q,a\nElle va à l'école à pied.,Oui\n", "cp1252"),
        ("q,a\n2 × 3,6\n", "cp1252"),
        ("q,a\n¬P,vrai\n", "cp1252"),
        ("q,a\nالشاي و القهوة,نعم\n", "cp1256"),
        ("q,a\nplain ascii,only\n", "utf-8"),
    ],
)
def test_browser_encoding_detection_matches_the_server(page, text, encoding):
    from qym_platform.api.datasets import _decode_csv

    raw = text.encode(encoding)
    _, server_label = _decode_csv(raw)
    browser_label = page.evaluate("bytes => __dsx.detectCSVEncoding(new Uint8Array(bytes))", list(raw))
    assert browser_label == server_label
    assert raw.decode(encoding) == text and server_label == {"cp1256": "windows-1256", "cp1252": "windows-1252"}.get(encoding, encoding)
    # The preview warns only about text that looks mis-decoded.
    suspicious = page.evaluate(
        "([bytes, label]) => __dsx.legacyTextScore(new TextDecoder(label).decode(new Uint8Array(bytes))) < 0",
        [list(raw), server_label],
    )
    assert suspicious is False


# ---------------------------------------------------------------------------
# C052: the upload wizard is an accessible dialog and does not lose work
# ---------------------------------------------------------------------------


def _mock_confirm(page, answer):
    page.evaluate("""answer => {
      window.confirms = [];
      window.QymShell.openConfirmDialog = options => { confirms.push(options.title); return Promise.resolve({confirmed: answer}); };
    }""", answer)


def test_wizard_is_a_labelled_dialog_that_keeps_focus_inside(page):
    page.evaluate("""() => { __dsx.state.datasets = [];
      const opener = document.createElement('button'); opener.id = 'opener'; opener.textContent = 'Import';
      document.querySelector('#host').appendChild(opener); opener.focus(); }""")
    _open_wizard(page, mode="new")
    dialog = page.get_by_role("dialog", name="Upload dataset")
    dialog.wait_for()
    assert dialog.get_attribute("aria-modal") == "true"
    page.wait_for_function("document.activeElement && document.activeElement.id === 'dsx-wiz-name'")
    assert page.get_by_role("button", name="Close").count() == 1
    # Labels are associated with their fields.
    assert page.get_by_label("Description").count() == 1
    assert page.get_by_role("button", name="File (CSV, TSV, JSON, or JSONL) * choose a file").count() == 1
    inside = []
    for _ in range(12):
        page.keyboard.press("Tab")
        inside.append(page.evaluate("() => !!document.activeElement.closest('[role=dialog]')"))
    assert all(inside)
    page.keyboard.press("Shift+Tab")
    assert page.evaluate("() => !!document.activeElement.closest('[role=dialog]')")
    # Without a file, Escape closes at once and focus returns to the opener.
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[role=dialog]')")
    assert page.evaluate("document.activeElement.id") == "opener"


def test_escape_backdrop_and_cancel_ask_before_discarding_a_loaded_file(page):
    page.evaluate("() => { __dsx.state.datasets = []; }")
    _mock_confirm(page, False)
    _open_wizard(page, mode="new")
    page.locator("#dsx-wiz-name").fill("Probe")
    _choose_file(page, "probe.csv", b"question,answer\nq,a\n")
    _continue(page)
    page.keyboard.press("Escape")
    page.wait_for_function("confirms.length === 1")
    # A click on the backdrop itself (shell.css is not loaded here, so dispatch it).
    page.evaluate("() => document.querySelector('.shell-modal-backdrop').dispatchEvent(new MouseEvent('click', {bubbles: true}))")
    page.wait_for_function("confirms.length === 2")
    page.get_by_role("button", name="Cancel", exact=True).click()
    page.wait_for_function("confirms.length === 3")
    assert page.evaluate("confirms") == ["Discard this upload?"] * 3
    # Kept: still on the mapping step with the auto-detected input.
    assert "Map columns" in _active_step(page)
    assert page.get_by_label("question").input_value() == "input"
    _mock_confirm(page, True)
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[role=dialog]')")


def test_column_mapping_works_from_the_keyboard(page):
    page.evaluate("() => { __dsx.state.datasets = []; }")
    _open_wizard(page, mode="new")
    page.locator("#dsx-wiz-name").fill("Probe")
    _choose_file(page, "probe.csv", b"prompt_text,gold,ref\nq,a,r1\n")
    _continue(page)
    # Nothing is recognised as input: Continue explains and focuses the first select.
    _continue(page)
    assert "Choose Input for at least one column" in page.locator("#dsx-wiz-mapping-error").inner_text()
    assert page.evaluate("document.activeElement.dataset.column") == "prompt_text"
    page.keyboard.press("ArrowUp")  # Metadata -> Expected output -> Input
    page.keyboard.press("ArrowUp")
    assert page.get_by_label("prompt_text").input_value() == "input"
    page.get_by_label("ref").select_option("id")
    page.get_by_label("gold").select_option("id")
    # One Item ID: the previous one becomes Metadata instead of vanishing.
    assert page.get_by_label("ref").input_value() == "metadata"
    _continue(page)
    page.get_by_role("button", name="Create dataset", exact=True).click()
    page.wait_for_function("requests.length === 1")
    form = _requests(page)[0]["body"]["form"]
    assert (form["input_cols"], form["id_col"], form["metadata_cols"]) == ("prompt_text", "gold", "ref")


def test_new_version_wizard_respects_the_production_rule(page):
    page.evaluate("""() => { Object.assign(__dsx.state.dataset, {permissions: {can_set_production: false}});
      Object.assign(__dsx.state, {activeVersion: {id: 'v2', version: 'v2', status: 'published'}, versions: [{version: 'v1'}, {version: 'v2'}]});
      document.querySelector('#host').appendChild(__dsx.overflowMenuButton()); }""")
    page.get_by_role("button", name="More actions").click()
    page.get_by_role("menuitem", name="↑ Upload file as new version…").click()
    _choose_file(page, "probe.csv", b"input,expected_output\nq,a\n")
    _continue(page)
    _continue(page)
    page.get_by_label("Publish immediately").check()
    production = page.get_by_label("Set as production alias")
    assert production.is_disabled() and not production.is_checked()


# ---------------------------------------------------------------------------
# C048: menus and the version switcher from the keyboard
# ---------------------------------------------------------------------------


def test_row_menu_is_a_keyboard_menu(page):
    page.evaluate("""() => {
      Object.assign(__dsx.state, {activeVersion: {id: 'v2', version: 'v2', status: 'published'}, versions: [{version: 'v1'}, {version: 'v2'}]});
      document.querySelector('#host').appendChild(__dsx.overflowMenuButton());
    }""")
    trigger = page.get_by_role("button", name="More actions")
    trigger.focus()
    page.keyboard.press("Enter")
    menu = page.get_by_role("menu")
    menu.wait_for()
    assert trigger.get_attribute("aria-expanded") == "true"
    first = page.evaluate("document.activeElement.getAttribute('role') + ':' + document.activeElement.textContent")
    assert first == "menuitem:Name version…"
    page.keyboard.press("ArrowDown")
    assert page.evaluate("document.activeElement.textContent") == "Compare…"
    page.keyboard.press("End")
    assert page.evaluate("document.activeElement.textContent") == "↑ Upload file as new version…"
    page.keyboard.press("Home")
    assert page.evaluate("document.activeElement.textContent") == "Name version…"
    page.keyboard.press("Escape")
    assert page.get_by_role("menu").count() == 0
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "More actions"
    assert trigger.get_attribute("aria-expanded") == "false"


def test_dialog_opened_from_a_menu_returns_focus_to_the_menu_trigger(page):
    # The catalog's "+ New dataset" and the version overflow menu open the upload
    # wizard from a menu item; closing the wizard must land on the trigger, not
    # on <body> (the menu item it was opened from no longer exists).
    page.evaluate("""() => {
      Object.assign(__dsx.state, {
        dataset: {id: 'd1', name: 'Golden', slug: 'golden', permissions: {}},
        activeVersion: {id: 'v2', version: 'v2', status: 'published'},
        versions: [{version: 'v1'}, {version: 'v2'}],
      });
      document.querySelector('#host').appendChild(__dsx.overflowMenuButton());
    }""")
    trigger = page.get_by_role("button", name="More actions")
    trigger.focus()
    page.keyboard.press("Enter")
    page.get_by_role("menu").wait_for()
    page.keyboard.press("End")
    assert page.evaluate("document.activeElement.textContent") == "↑ Upload file as new version…"
    page.keyboard.press("Enter")
    page.get_by_role("dialog").wait_for()
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[role=dialog]')")
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "More actions"


def test_version_switcher_is_a_listbox_with_arrow_keys_and_escape(page):
    page.evaluate("""() => {
      window.navigations = [];
      const versions = [
        {id: 'a', version: 'v1', status: 'published', created_at: '2026-09-01T00:00:00Z', aliases: []},
        {id: 'b', version: 'v2', status: 'published', created_at: '2026-09-02T00:00:00Z', aliases: ['production']},
        {id: 'c', version: 'v3', status: 'draft', created_at: '2026-09-03T00:00:00Z', aliases: []},
      ];
      Object.assign(__dsx.state, {mode: 'detail', tab: 'items', versions, activeVersion: versions[1]});
      document.querySelector('#host').appendChild(__dsx.versionSelectorPill());
    }""")
    pill = page.locator(".dsx-version-pill")
    pill.focus()
    page.keyboard.press("ArrowDown")
    listbox = page.get_by_role("listbox", name="Versions")
    listbox.wait_for()
    assert pill.get_attribute("aria-expanded") == "true"
    page.wait_for_function("document.activeElement.getAttribute('role') === 'combobox'")
    assert page.get_by_role("option").count() == 3
    active = lambda: page.evaluate("document.getElementById(document.activeElement.getAttribute('aria-activedescendant')).textContent")  # noqa: E731
    assert active().startswith("v2")  # opens on the current version
    page.keyboard.press("ArrowDown")
    assert active().startswith("v1")
    page.keyboard.press("Escape")
    assert page.get_by_role("listbox").count() == 0
    assert page.evaluate("document.activeElement.classList.contains('dsx-version-pill')")


def test_lineage_versions_are_links_and_changes_show_time_in_order(page):
    page.evaluate("""() => {
      window.replyFor = req => req.url.includes('/lineage') ? {body: {
        versions: [
          {id: 'a', version: 'v1', status: 'published', created_at: '2026-09-01T08:00:00Z', published_at: '2026-09-01T09:00:00Z', aliases: [], change_counts: {added: 2}},
          {id: 'b', version: 'v2', status: 'draft', parent_version_id: 'a', created_at: '2026-09-02T08:00:00Z', aliases: [], change_counts: {modified: 1}},
        ],
        changes: [
          {id: 3, dataset_version_id: 'b', change_summary: {type: 'created', from_version_id: 'a'}, actor: {display_name: 'Mona', email: 'm@x'}, created_at: '2026-09-02T08:00:00Z'},
          {id: 1, dataset_version_id: 'a', change_summary: {type: 'uploaded', item_count: 2}, created_at: '2026-09-01T08:00:00Z'},
          {id: 2, dataset_version_id: 'a', change_summary: {type: 'published', item_count: 2}, created_at: '2026-09-01T09:00:00Z'},
        ]}} : null;
      Object.assign(__dsx.state, {mode: 'detail', tab: 'lineage', activeVersion: {id: 'a', version: 'v1'}});
      __dsx.renderLineageTab(document.querySelector('#host'));
    }""")
    log = page.get_by_role("list", name="Change log")
    log.wait_for()
    rows = log.locator("li")
    assert [rows.nth(i).locator(".ctype").inner_text() for i in range(3)] == ["Uploaded", "Published", "Created"]
    times = [rows.nth(i).locator("time").get_attribute("datetime") for i in range(3)]
    assert times == sorted(times)
    assert all(rows.nth(i).locator("time").inner_text().strip() for i in range(3))
    assert "Mona" in rows.nth(2).inner_text()
    link = page.get_by_role("link", name="Open version v2")
    assert "v=v2" in link.get_attribute("href") and "tab=lineage" in link.get_attribute("href")
    assert "created " in page.locator(".dsx-lineage-times").first.inner_text()


# ---------------------------------------------------------------------------
# C181 / C321: paged compare, ordered by time, robust word diff
# ---------------------------------------------------------------------------


def _changed_row(n, minute):
    return {
        "item_id": f"item-{n}", "target_index": n, "fields": ["input"],
        "changed_at": f"2026-09-01T12:{minute:02d}:00Z", "changed_at_source": "revision",
        "before": {"input": f"old {n}"}, "after": {"input": f"new {n}"},
    }


def test_compare_pages_rows_shows_times_and_keeps_the_tab_in_the_url(page):
    page.evaluate("""() => {
      window.compareRows = n => Array.from({length: n}, (_, i) => i);
      window.replyFor = req => {
        if (!req.url.includes(':compare')) return null;
        const url = new URL(req.url, 'http://qym.test');
        const kind = url.searchParams.get('kind');
        const offset = Number(url.searchParams.get('offset') || 0);
        const total = kind === 'changed' ? 60 : 1;
        const count = Math.min(50, total - offset);
        const rows = Array.from({length: count}, (_, i) => {
          const n = offset + i;
          return {item_id: 'item-' + n, target_index: n, fields: ['input'], changed_at: '2026-09-01T12:' + String(n % 60).padStart(2, '0') + ':00Z',
            changed_at_source: 'revision', before: {input: 'old ' + n}, after: {input: 'new ' + n}, input: 'x', index: n};
        });
        return {body: {summary: {changed: 60, added: 1, removed: 0, unchanged: 0},
          field_diffs: kind === 'changed' ? rows : [], added_items: kind === 'added' ? rows : [],
          page: {kind, offset, limit: 50, total, next_offset: offset + 50 < total ? offset + 50 : null},
          target: {created_by: null}}};
      };
      Object.assign(__dsx.state, {mode: 'compare', slug: 'project', datasetRef: 'demo', baseVersion: 'v1', headVersion: 'v2', cmpTab: 'changed',
        dataset: {name: 'Demo', slug: 'demo'}, versions: [{version: 'v1', status: 'published'}, {version: 'v2', status: 'published'}]});
      document.querySelector('#host').appendChild(__dsx.compareView());
    }""")
    page.locator(".dsx-diff-row").first.wait_for()
    assert page.locator(".dsx-diff-row").count() == 50
    toggles = page.locator(".dsx-diff-toggle")
    assert [toggles.nth(i).get_attribute("aria-expanded") for i in range(4)] == ["true", "true", "true", "false"]
    assert "changed Sep 1, 2026" in toggles.first.inner_text()
    assert "oldest first" in page.locator(".dsx-compare-order").inner_text()
    first_request = [r for r in _requests(page) if ":compare" in r["url"]][0]["url"]
    assert "limit=50" in first_request and "kind=changed" in first_request
    # Keyboard: the header is a button that toggles its body.
    toggles.nth(3).focus()
    page.keyboard.press("Enter")
    assert toggles.nth(3).get_attribute("aria-expanded") == "true"
    page.get_by_role("button", name="Show 10 more").click()
    page.wait_for_function("document.querySelectorAll('.dsx-diff-row').length === 60")
    assert "Showing 60 of 60" in page.locator(".dsx-compare-count").inner_text()
    # Focus continues at the first newly loaded row.
    assert page.evaluate("document.activeElement.className") == "dsx-diff-toggle"
    assert "item-50" in page.evaluate("document.activeElement.textContent")
    page.locator("#dsx-cmp-tab-added").click()
    page.wait_for_function("location.search.includes('tab=added')")
    page.locator(".dsx-diff-row").first.wait_for()
    assert "+ added" in page.locator(".dsx-diff-row").first.inner_text()


def test_word_diff_marks_only_the_real_change_in_a_long_field(page):
    result = page.evaluate("""() => {
      const words = Array.from({length: 30000}, (_, i) => 'w' + i).join(' ');
      const edited = words.replace('w15000', 'CHANGED');
      const pair = __dsx.diffHtmlPair(words, edited);
      return {tooLarge: pair.tooLarge,
        removed: (pair.before.match(/dsx-diff-removed-tok/g) || []).length,
        added: (pair.after.match(/dsx-diff-added-tok/g) || []).length,
        hasChanged: pair.after.includes('>CHANGED<')};
    }""")
    # The old LCS gave up past 200k cells and marked the whole field.
    assert result == {"tooLarge": False, "removed": 1, "added": 1, "hasChanged": True}
    big = page.evaluate("""() => {
      const a = Array.from({length: 12000}, (_, i) => 'a' + i).join(' ');
      const b = Array.from({length: 12000}, (_, i) => 'b' + i).join(' ');
      const pair = __dsx.diffHtmlPair(a, b);
      return {tooLarge: pair.tooLarge, marked: pair.before.includes('dsx-diff-removed-tok')};
    }""")
    assert big == {"tooLarge": True, "marked": False}
    small = page.evaluate("() => __dsx.wordDiff('the cat sat', 'the dog sat').map(t => t.kind + ':' + t.txt.trim()).filter(t => !t.endsWith(':'))")
    assert small == ["same:the", "del:cat", "add:dog", "same:sat"]


def test_item_rows_are_links_and_previews_are_not_tab_stops(page):
    page.evaluate("""() => {
      window.replyFor = req => req.url.includes('/items?') ? {body: {items: [
        {id: 1, item_id: 'alpha', index: 0, input: 'question one', expected_output: 'a', metadata: {k: 'v'}},
        {id: 2, item_id: 'beta', index: 1, input: 'question two', expected_output: 'b', metadata: {}},
      ], total: 2}} : null;
      Object.assign(__dsx.state, {mode: 'detail', tab: 'items', activeVersion: {id: 'v1', version: 'v1', status: 'published'}});
      __dsx.renderItemsTab(document.querySelector('#host'));
    }""")
    link = page.get_by_role("link", name="Open item alpha")
    link.wait_for()
    assert "item=alpha" in link.get_attribute("href") and "tab=details" in link.get_attribute("href")
    # 2 rows: 2 row links, and no preview cell takes a tab stop (was 3 per row).
    assert page.locator(".dsx-preview[tabindex]").count() == 0
    assert page.locator("a.dsx-row-link").count() == 2
    request = [r for r in _requests(page) if "/items?" in r["url"]][0]["url"]
    assert "include_context=false" in request
    link.focus()
    page.keyboard.press("Enter")
    page.wait_for_function("location.search.includes('item=alpha')")


def test_settings_offer_delete_only_to_creator_or_manager_with_honest_copy(page):
    page.evaluate("""() => {
      Object.assign(__dsx.state.dataset, {description: '', tags: [], permissions: {can_delete: false, can_set_production: false}});
      __dsx.renderSettingsTab(document.querySelector('#host'));
    }""")
    text = page.locator("#host").inner_text()
    assert "Deleted datasets" in text and "restore" in text
    assert "removes all its versions" not in text
    assert page.get_by_role("button", name="Delete dataset").count() == 0
    assert "creator or a project manager" in page.get_by_role("note").inner_text()
    page.evaluate("""() => { document.querySelector('#host').innerHTML = '';
      __dsx.state.dataset.permissions = {can_delete: true};
      __dsx.renderSettingsTab(document.querySelector('#host')); }""")
    assert page.get_by_role("button", name="Delete dataset").count() == 1
