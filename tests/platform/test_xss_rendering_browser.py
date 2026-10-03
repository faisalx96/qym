"""Stored names and run text never become markup on the shipped pages (C006, C013).

Every user- or SDK-controlled string below carries a payload that runs script
when it reaches an innerHTML sink as markup, and adds a marker attribute when it
breaks out of a quoted attribute. The pages must render all of it as text.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from test_dashboard_paging_browser import DashboardFixture, make_runs
from test_performance_views_browser import ViewFixture

pytestmark = pytest.mark.browser

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)
SQL = "SELECT (n * sum_xy - sum_x * sum_y) * 1.0 AS slope FROM t WHERE name LIKE '*a*'"
PROSE = 'Answer: **bold** and *soft*. See [docs](https://x.test/" onmouseover="window.__md=1" data-x=").'


def payload(tag: str) -> str:
    """Breaks out of text, double- and single-quoted attributes alike."""
    return (
        f"{tag}'\"><img src=x data-xss={tag} onerror=window.__xss=1>"
        f"\" data-xssattr=\"{tag}' data-xssattr='{tag}"
    )


INJECTED = """() => ({
  xss: window.__xss || window.__md || null,
  markers: Array.from(document.querySelectorAll('[data-xss], [data-xssattr], [onmouseover]'))
    .map(node => node.tagName.toLowerCase() + ':' + (node.getAttribute('data-xss') || node.getAttribute('data-xssattr') || 'onmouseover')),
})"""


def assert_inert(page):
    assert page.evaluate(INJECTED) == {"xss": None, "markers": []}


def poisoned_runs(count: int = 3):
    rows = make_runs(count)
    for i, row in enumerate(rows):
        row.update(
            external_run_id=payload(f"run_name_{i}"),
            run_name=payload(f"run_name_{i}"),
            task_name=payload("task"),
            model_name=payload("model"),
            dataset_name=payload("dataset"),
            owner={
                "id": "owner",
                "display_name": payload("owner_name"),
                "email": payload("owner_email"),
            },
            git_branch=payload("git_branch"),
            git_commit=payload("git_commit"),
        )
    return rows


def test_runs_table_renders_stored_names_as_text(browser):
    rows = poisoned_runs()
    fixture = DashboardFixture(browser, runs=rows)
    page = fixture.page
    try:
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function("__dashboardTest.state.flatRuns.length === 3")
        row = page.locator('tr[data-file="run-000"]')
        assert payload("run_name_0") in row.locator(".run-id").inner_text()
        assert payload("dataset") in row.locator(".runs-dataset-tag").inner_text()
        assert payload("owner_name") in row.locator(".owner-name").inner_text()
        assert row.locator(".owner-name").get_attribute("title") == payload(
            "owner_email"
        )
        assert row.locator(".tag.model").get_attribute("title") == payload("model")
        version = row.locator(".version-badge")
        assert version.inner_text() == payload("git_branch") + "/" + payload(
            "git_commit"
        )
        assert_inert(page)
    finally:
        fixture.close()


def test_charts_render_task_dataset_and_model_names_as_text(browser):
    rows = poisoned_runs()
    for row in rows:
        row["metric_averages"] = {"accuracy": 0.5}
    fixture = DashboardFixture(browser, view="charts", runs=rows)
    page = fixture.page
    try:
        fixture.open()
        tab = page.locator(".chart-dataset-tab").first
        assert tab.get_attribute("data-dataset") == payload("dataset")
        assert tab.get_attribute("data-task") == payload("task")
        assert payload("dataset") in tab.inner_text()
        assert page.locator(".chart-task-name").first.inner_text() == payload("task")
        labels = page.locator(".chart-bar-label.clickable-run")
        titles = labels.evaluate_all(
            "nodes => nodes.map(node => node.getAttribute('title'))"
        )
        assert sorted(title.split("\n")[0] for title in titles) == [
            "Run name: " + payload(f"run_name_{i}") for i in range(3)
        ]
        assert (
            payload("git_branch") + "/" + payload("git_commit")
            in labels.first.inner_text()
        )
        assert_inert(page)
    finally:
        fixture.close()


def poison_view(fixture: ViewFixture):
    for run_id, data in fixture.data.items():
        data["run"].update(
            run_name=payload(f"run_name_{run_id}"),
            model_name=payload("model"),
            task_name=payload("task"),
            dataset_name=payload("dataset"),
        )
        for row in data["snapshot"]["rows"][:3]:
            row["input"] = row["input_full"] = PROSE
            row["expected"] = row["expected_full"] = SQL
            row["output"] = row["output_full"] = (
                SQL + "\n" + PROSE + "\n" + payload("output")
            )
            row["item_metadata"] = {
                "complexity": payload("complexity"),
                payload("meta_key"): payload("meta_value"),
            }


def test_run_page_shows_text_as_stored_with_opt_in_safe_rendering(browser):
    fixture = ViewFixture(browser, "run", compact=False, count=6)
    poison_view(fixture)
    page = fixture.page
    try:
        page.add_init_script(
            "try { localStorage.removeItem('qym.textMode'); } catch (e) {}"
        )
        fixture.goto()
        page.locator(".item-header-expand").first.click()
        card = page.locator(".item-card:not(.item-collapsed)").first
        output = card.locator(".output-text .qym-text")
        expected = card.locator(".expected-text .qym-text")
        # Raw by default: SQL keeps every asterisk, markdown syntax stays visible.
        assert page.evaluate("QymSafe.getTextMode()") == "raw"
        assert SQL in expected.inner_text()
        assert expected.get_attribute("class") == "qym-text qym-text--code"
        assert "**bold**" in card.locator(".input-text .qym-text").inner_text()
        assert (
            card.locator(".input-text .qym-text").get_attribute("class")
            == "qym-text qym-text--prose"
        )
        assert output.inner_text().startswith(SQL)
        assert card.locator("em, strong, a.qym-text__link").count() == 0
        assert_inert(page)

        # Rendered is opt-in, remembered, and still safe.
        page.locator("#btn-item-display").click()
        page.locator('#item-text-mode [data-qym-text-mode="rendered"]').click()
        page.wait_for_function("QymSafe.getTextMode() === 'rendered'")
        card = page.locator(".item-card:not(.item-collapsed)").first
        prose = card.locator(".input-text .qym-text")
        assert prose.get_attribute("data-qym-text-mode") == "rendered"
        assert prose.locator("strong").inner_text() == "bold"
        assert prose.locator("em").inner_text() == "soft"
        # A link whose target tries to add attributes is left as plain text.
        assert prose.locator("a").count() == 0
        assert '[docs](https://x.test/"' in prose.inner_text()
        # SQL and code are never rewritten, even in Rendered mode.
        assert SQL in card.locator(".expected-text .qym-text").inner_text()
        assert card.locator(".expected-text em").count() == 0
        assert card.locator(".output-text .qym-text").inner_text().startswith(SQL)
        assert page.evaluate("localStorage.getItem('qym.textMode')") == "rendered"
        assert_inert(page)
    finally:
        fixture.close()


def test_compare_page_renders_run_names_and_outputs_as_text(browser):
    fixture = ViewFixture(browser, "compare", compact=False, count=6)
    poison_view(fixture)
    page = fixture.page
    try:
        page.add_init_script(
            "try { localStorage.removeItem('qym.textMode'); } catch (e) {}"
        )
        fixture.goto()
        page.locator(".item-header-expand").first.click()
        row = page.locator(".item-comparison-row:not(.item-collapsed)").first
        assert SQL in row.locator(".expected-text .qym-text").inner_text()
        assert row.locator(".output-text .qym-text").first.inner_text().startswith(SQL)
        assert row.locator("em, strong").count() == 0
        assert (
            payload("run_name_run-1")
            in page.locator(".compare-run-title").first.inner_text()
        )
        assert_inert(page)
        page.locator("#btn-item-display").click()
        page.locator('#item-text-mode [data-qym-text-mode="rendered"]').click()
        page.wait_for_function("QymSafe.getTextMode() === 'rendered'")
        row = page.locator(".item-comparison-row:not(.item-collapsed)").first
        assert row.locator(".input-text strong").inner_text() == "bold"
        assert SQL in row.locator(".expected-text .qym-text").inner_text()
        assert_inert(page)
    finally:
        fixture.close()


def test_run_html_export_inlines_the_shared_layer_and_opens_offline(browser, tmp_path):
    from test_performance_views_browser import source_run_api

    with source_run_api(count=3) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    html = response.text
    assert '<script src="/static/qym_safe.js' not in html
    # Nothing is left to load from the server (review history, step latency).
    assert 'src="/static/' not in html
    assert html.index("global.QymSafe = {") < html.index("window.QymMetrics")
    target = tmp_path / "run.html"
    target.write_text(html, encoding="utf-8")
    context = browser.new_context(offline=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "requestfailed",
        lambda request: errors.append("request failed: " + request.url)
        if request.url.startswith("file:")
        else None,
    )
    try:
        page.goto(target.as_uri())
        page.wait_for_function(
            "document.querySelector('#filter-count')?.textContent.includes('3')"
        )
        page.locator(".item-header-expand").first.click()
        page.wait_for_selector(".item-card:not(.item-collapsed) .qym-text")
        assert page.locator("#item-text-mode [data-qym-text-mode]").count() == 2
        assert not errors
    finally:
        context.close()


# Stored text that breaks naive export splicing: String.replace patterns ($' $` $&
# $$) and an unclosed comment that would swallow the data script's end tag.
EXPORT_TEXT = "Total $$5 ($&) $` $'" + payload("export") + " <!--<script>old()"


def open_offline(browser, target):
    context = browser.new_context(offline=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(target.as_uri())
    return context, page, errors


def test_run_html_export_embeds_hostile_text_as_data(browser, tmp_path, monkeypatch):
    import qym_platform.api.runs as runs_api
    from test_performance_views_browser import source_run_api

    build = runs_api._build_run_data

    def hostile(db, run):
        data = build(db, run)
        data["run"]["run_name"] = EXPORT_TEXT
        data["snapshot"]["rows"][0]["output"] = EXPORT_TEXT
        data["snapshot"]["rows"][0]["output_full"] = EXPORT_TEXT
        return data

    monkeypatch.setattr(runs_api, "_build_run_data", hostile)
    with source_run_api(count=3) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    assert "<!--<script>" not in response.text
    target = tmp_path / "run.html"
    target.write_text(response.text, encoding="utf-8")
    context, page, errors = open_offline(browser, target)
    try:
        page.wait_for_function(
            "document.querySelector('#filter-count')?.textContent.includes('3')"
        )
        assert page.evaluate("window.__QYM_EXPORT_DATA__.run.run_name") == EXPORT_TEXT
        assert_inert(page)
        assert not errors
    finally:
        context.close()


def test_compare_share_export_embeds_hostile_text_as_data(browser, tmp_path):
    fixture = ViewFixture(browser, "compare", compact=False, count=6)
    for data in fixture.data.values():
        row = data["snapshot"]["rows"][0]
        row["output"] = row["output_full"] = EXPORT_TEXT
    page = fixture.page
    try:
        fixture.goto()
        with page.expect_download() as download:
            page.locator("#export-share-btn").click()
        target = tmp_path / "compare.html"
        download.value.save_as(str(target))
        html = target.read_text(encoding="utf-8")
        assert "<!--<script>" not in html
    finally:
        fixture.close()
    context, page, errors = open_offline(browser, target)
    try:
        page.wait_for_function("Boolean(window.__QYM_COMPARE_DATA__)")
        outputs = page.evaluate(
            "window.__QYM_COMPARE_DATA__.runs.map(r => r.snapshot.rows[0].output)"
        )
        assert outputs == [EXPORT_TEXT, EXPORT_TEXT]
        page.wait_for_timeout(500)
        assert_inert(page)
    finally:
        context.close()


@pytest.fixture
def safe_page(browser):
    context = browser.new_context()
    page = context.new_page()
    page.goto("about:blank")
    page.add_script_tag(path=str(STATIC / "qym_safe.js"))
    try:
        yield page
    finally:
        context.close()


def test_shared_escaping_is_safe_in_text_and_attributes(safe_page):
    result = safe_page.evaluate("""() => {
          const host = document.createElement('div');
          const value = `"><img src=x onerror=window.__xss=1>' data-x='1`;
          host.innerHTML = `<span title="${QymSafe.escapeHtml(value)}" data-y='${QymSafe.escapeAttr(value)}'>${QymSafe.escapeHtml(value)}</span>`;
          const span = host.firstElementChild;
          const tagged = QymSafe.html`<b title="${value}">${value}${QymSafe.raw('<i>ok</i>')}${[value, QymSafe.html`<u>${'&'}</u>`]}</b>`;
          host.innerHTML = tagged;
          return {
            escaped: QymSafe.escapeHtml(`&<>"'`),
            nothing: [QymSafe.escapeHtml(null), QymSafe.escapeHtml(undefined), QymSafe.escapeHtml(false), QymSafe.escapeHtml(0)],
            title: span.getAttribute('title'),
            single: span.getAttribute('data-y'),
            text: span.textContent,
            children: span.children.length,
            taggedTitle: host.firstElementChild.getAttribute('title'),
            taggedMarkup: host.querySelectorAll('img').length,
            trusted: host.querySelectorAll('i, u').length,
            urls: ['https://x.test/a', '/runs/1', 'javascript:alert(1)', 'java\\nscript:alert(1)', 'data:text/html,x', 'mailto:a@b.c']
              .map(QymSafe.safeUrl),
          };
        }""")
    value = "\"><img src=x onerror=window.__xss=1>' data-x='1"
    assert result["escaped"] == "&amp;&lt;&gt;&quot;&#39;"
    assert result["nothing"] == ["", "", "", "0"]
    assert result["title"] == value
    assert result["single"] == value
    assert result["text"] == value
    assert result["children"] == 0
    assert result["taggedTitle"] == value
    assert result["taggedMarkup"] == 0
    assert result["trusted"] == 2
    assert result["urls"] == ["https://x.test/a", "/runs/1", "", "", "", "mailto:a@b.c"]
    assert safe_page.evaluate("window.__xss || null") is None


def test_rendered_markdown_is_a_safe_subset_that_keeps_code_intact(safe_page):
    render = lambda text: safe_page.evaluate(
        "t => QymSafe.renderMarkdown(t)", text
    )  # noqa: E731
    assert (
        render("(n * sum_xy - sum_x * sum_y) * 1.0")
        == "(n * sum_xy - sum_x * sum_y) * 1.0"
    )
    assert render("**bold** *em* a*b*c") == "<strong>bold</strong> <em>em</em> a*b*c"
    assert render("`a * b * c`") == '<code class="qym-text__code">a * b * c</code>'
    assert render("```sql\nSELECT a * b * c\n```") == (
        '<pre class="qym-text__pre"><code>SELECT a * b * c</code></pre>'
    )
    assert render("Run:\n```\nx * y * z\n```\nthen *stop*") == (
        'Run:<pre class="qym-text__pre"><code>x * y * z</code></pre>then <em>stop</em>'
    )
    assert render("open ``` fence *x*") == "open ``` fence <em>x</em>"
    assert (
        render("<img src=x onerror=alert(1)>") == "&lt;img src=x onerror=alert(1)&gt;"
    )
    assert render("[x](javascript:alert(1))") == "[x](javascript:alert(1))"
    assert render('[x](https://x.test/" onmouseover="y")') == (
        "[x](https://x.test/&quot; onmouseover=&quot;y&quot;)"
    )
    assert render('[x](https://x.test/"onmouseover="y")') == (
        '<a class="qym-text__link" href="https://x.test/&quot;onmouseover=&quot;y&quot;" '
        'target="_blank" rel="noopener noreferrer">x</a>'
    )
    code = safe_page.evaluate("""() => [
          'SELECT a FROM t',
          'WITH x AS (SELECT 1) SELECT * FROM x',
          'def f(x):\\n    return x * 2',
          'const a = 1;\\nconst b = a * 2;',
          'The answer is 42.\\nIt uses *emphasis* here.',
          'Paris',
        ].map(QymSafe.looksLikeCode)""")
    assert code == [True, True, True, True, False, False]
    blocks = safe_page.evaluate("""() => [
          QymSafe.textBlock('SELECT a * b FROM t', { mode: 'rendered' }),
          QymSafe.textBlock('Hi **there** <b>', { mode: 'raw' }),
          QymSafe.textBlock('Hi **there**', { mode: 'rendered', dir: 'rtl' }),
        ]""")
    assert blocks == [
        '<div class="qym-text qym-text--code" data-qym-text-mode="raw">SELECT a * b FROM t</div>',
        '<div class="qym-text qym-text--prose" data-qym-text-mode="raw">Hi **there** &lt;b&gt;</div>',
        '<div class="qym-text qym-text--prose" data-qym-text-mode="rendered" dir="rtl">Hi <strong>there</strong></div>',
    ]


def test_sql_after_an_intro_is_code_and_english_openers_are_prose(safe_page):
    # SQL that follows a short intro line must never be rewritten by Rendered
    # mode ("a.*, b.*" used to become "a.<em>, b.</em>"), and prose that merely
    # starts with a SQL keyword ("With", "Update", ...) is not code.
    cases = {
        "Here is the query:\nSELECT a.*, b.* FROM a JOIN b ON a.id = b.id": True,
        "Result:\nselect SUM(x)*y*(z)\nfrom t": True,
        "SELECT 1;": True,
        "UPDATE users\nSET name = 'x' WHERE id = 1": True,
        "with recent as (select 1) select * from recent": True,
        "EXPLAIN ANALYZE SELECT * FROM t": True,
        "With the given data, the answer is 42.": False,
        "Update: the model now returns **two** rows.": False,
        "Update the set of rules for *all* users.": False,
        "Select the best option: *B* is correct.": False,
        "Explain why the query fails.": False,
        "Select one option.\n\nThe data comes from the survey.": False,
        # A fenced query stays verbatim inside Rendered prose.
        "Answer:\n```sql\nSELECT a.*, b.* FROM t\n```": False,
    }
    detected = safe_page.evaluate(
        "texts => texts.map(t => QymSafe.looksLikeCode(t))", list(cases)
    )
    assert dict(zip(cases, detected)) == cases
    rendered = safe_page.evaluate("""() => [
          'Here is the query:\\nSELECT a.*, b.* FROM a JOIN b ON a.id = b.id',
          'Answer:\\n```sql\\nSELECT a.*, b.* FROM t\\n```',
          'Update: the model now returns **two** rows.',
        ].map(t => QymSafe.textBlock(t, { mode: 'rendered' }))""")
    assert rendered == [
        '<div class="qym-text qym-text--code" data-qym-text-mode="raw">'
        "Here is the query:\nSELECT a.*, b.* FROM a JOIN b ON a.id = b.id</div>",
        '<div class="qym-text qym-text--prose" data-qym-text-mode="rendered">Answer:'
        '<pre class="qym-text__pre"><code>SELECT a.*, b.* FROM t</code></pre></div>',
        '<div class="qym-text qym-text--prose" data-qym-text-mode="rendered">'
        "Update: the model now returns <strong>two</strong> rows.</div>",
    ]
