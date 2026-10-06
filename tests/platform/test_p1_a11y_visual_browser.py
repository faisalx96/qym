"""Accessibility and failure states from the P1 design review.

- C047: the closed trace drawer is inert (no Tab stops, not a modal); opening
  it moves focus in and keeps Tab inside, closing returns focus to Trace.
- C049: dialogs share one focus contract (QymUIComponents.openDialog). Enter
  on Cancel cancels, destructive confirms start on Cancel, Tab stays inside,
  Escape closes and focus returns to the trigger.
- C053: Arabic text in Reviews reads right to left with lang="ar" and the
  taller Arabic leading.
- C038: a failed request is an error with Retry, never an empty or "not
  found" state; a failed Runs refresh keeps the rows, dimmed, under a banner.
"""

from __future__ import annotations

import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlparse

import pytest

from test_dashboard_paging_browser import DashboardFixture

pytestmark = pytest.mark.browser

STATIC = Path(__file__).resolve().parents[2] / "packages/platform/qym_platform/_static/dashboard"
AR_Q = "ما هي أكبر مدينة في المملكة من حيث عدد السكان (2021-2025)؟"
AR_A = "- الرياض: 4.80% نمو سنوي.\n- جدة: ثاني أكبر مدينة."
ME = {
    "id": "admin",
    "email": "admin@example.com",
    "display_name": "Admin",
    "role": "ADMIN",
    "projects": [{"id": "p", "slug": "demo", "name": "Demo", "role": "ADMIN"}],
}


class PageFixture:
    """Serves a shipped page with its static assets and mocked API answers."""

    def __init__(self, browser, pages, api, width=1440):
        self.pages = pages
        self.api = api
        self.requests = []
        self.errors = []
        self.context = browser.new_context(viewport={"width": width, "height": 900}, reduced_motion="reduce")
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("http://qym.test/**", self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        path = url.path
        self.requests.append((route.request.method, path, url.query))
        if path in self.pages:
            body = self.pages[path]
            if isinstance(body, Path):
                body = body.read_text(encoding="utf-8")
            return route.fulfill(body=body, content_type="text/html")
        if "/static/" in path:
            file = STATIC / path.split("/static/", 1)[1]
            if file.is_file():
                return route.fulfill(
                    path=str(file),
                    content_type=mimetypes.guess_type(file.name)[0] or "application/octet-stream",
                )
            return route.fulfill(status=404, body="")
        if path == "/v1/me":
            return route.fulfill(json=ME)
        for prefix, handler in self.api:
            if path.startswith(prefix):
                return handler(route, url)
        return route.fulfill(json={})

    def goto(self, path):
        self.page.goto("http://qym.test" + path)

    def close(self):
        self.context.close()


def _active(page, expr="document.activeElement.id"):
    return page.evaluate(f"() => {expr}")


# ── C047: trace drawer ───────────────────────────────────────────────────────

TRACE_PAGE = """<!doctype html><html lang="en"><head>
<link rel="stylesheet" href="/static/dashboard.css"><link rel="stylesheet" href="/static/ui_components.css">
<script src="/static/qym_safe.js"></script><script src="/static/ui_components.js"></script>
<script src="/static/trace_viewer.js"></script></head><body>
<button id="before" type="button">Before</button>
<button id="trace-trigger" type="button" class="trace-drawer-btn"
  data-trace-endpoint="/api/runs/r1/items/i1/trace" data-trace-title="Item 1">Trace</button>
<button id="after" type="button">After</button>
<script>QymTraceViewer.init({ exportMode: false });</script>
</body></html>"""


def _trace_answer(route, url):
    route.fulfill(json={"spans": [], "attempts": []})


@pytest.mark.parametrize("width", [1280, 1440])
def test_closed_trace_drawer_is_inert_and_focus_moves_in_and_back(browser, width):
    view = PageFixture(browser, {"/trace": TRACE_PAGE}, [("/api/runs/", _trace_answer)], width=width)
    try:
        view.goto("/trace")
        page = view.page
        shell = page.locator(".tv-shell")
        assert shell.get_attribute("inert") is not None
        assert shell.get_attribute("aria-hidden") == "true"
        assert page.locator(".tv-drawer").get_attribute("aria-modal") is None
        # Closed: Tab never lands on the off-screen drawer controls.
        page.locator("#before").focus()
        stops = []
        for _ in range(6):
            page.keyboard.press("Tab")
            stops.append(_active(page, "document.activeElement.closest('.tv-shell') ? 'drawer' : document.activeElement.id"))
        assert "drawer" not in stops

        page.locator("#trace-trigger").focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(".tv-shell.open")
        assert shell.get_attribute("inert") is None
        assert page.locator(".tv-drawer").get_attribute("aria-modal") == "true"
        assert page.evaluate("() => !!document.activeElement.closest('.tv-drawer')")
        for _ in range(8):
            page.keyboard.press("Tab")
            assert page.evaluate("() => !!document.activeElement.closest('.tv-drawer')")
        page.keyboard.press("Shift+Tab")
        assert page.evaluate("() => !!document.activeElement.closest('.tv-drawer')")

        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('.tv-shell.open')")
        assert _active(page) == "trace-trigger"
        assert shell.get_attribute("inert") is not None
        assert page.locator(".tv-drawer").get_attribute("aria-modal") is None
        assert view.errors == []
    finally:
        view.close()


# ── C049: shell dialogs ──────────────────────────────────────────────────────

def _shell_page(browser, width=1440):
    view = PageFixture(browser, {"/profile": STATIC / "profile.html"}, [], width=width)
    view.goto("/profile")
    view.page.wait_for_function("() => Boolean(window.QymShell && window.QymShell.getUser() && window.QymUIComponents)")
    view.page.evaluate(
        """() => {
          const trigger = document.createElement('button');
          trigger.id = 'dialog-trigger';
          trigger.type = 'button';
          trigger.textContent = 'Open';
          document.body.appendChild(trigger);
          trigger.addEventListener('click', () => {
            window.__result = undefined;
            const open = window.__open || (() => QymShell.openConfirmDialog({
              title: 'Delete item?', description: 'Gone for good.', confirmLabel: 'Delete',
              confirmClass: 'shell-btn-danger',
            }));
            open().then(result => { window.__result = result; });
          });
        }"""
    )
    return view


@pytest.mark.parametrize("width", [1280, 1440])
def test_enter_on_cancel_cancels_and_destructive_confirms_start_on_cancel(browser, width):
    view = _shell_page(browser, width)
    page = view.page
    try:
        page.locator("#dialog-trigger").focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("#shell-confirm-dialog")
        modal = page.locator("#shell-confirm-dialog .shell-modal")
        assert modal.get_attribute("role") == "dialog"
        assert modal.get_attribute("aria-modal") == "true"
        assert _active(page) == "shell-confirm-cancel"
        page.keyboard.press("Enter")
        page.wait_for_function("() => window.__result !== undefined")
        assert page.evaluate("() => window.__result.confirmed") is False
        assert _active(page) == "dialog-trigger"

        # Tab stays inside; Enter on the focused Delete button confirms.
        page.keyboard.press("Enter")
        page.wait_for_selector("#shell-confirm-dialog")
        for _ in range(5):
            page.keyboard.press("Tab")
            assert page.evaluate("() => !!document.activeElement.closest('#shell-confirm-dialog')")
        page.locator("#shell-confirm-submit").focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => window.__result !== undefined")
        assert page.evaluate("() => window.__result.confirmed") is True

        # Escape cancels and returns focus.
        page.locator("#dialog-trigger").focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("#shell-confirm-dialog")
        page.keyboard.press("Escape")
        page.wait_for_function("() => window.__result !== undefined")
        assert page.evaluate("() => window.__result.confirmed") is False
        assert page.locator("#shell-confirm-dialog").count() == 0
        assert _active(page) == "dialog-trigger"
        assert view.errors == []
    finally:
        view.close()


def test_danger_confirm_looks_destructive_and_starts_on_cancel(browser):
    """Dataset and connection deletes pass `danger: true` (no confirmClass):
    the confirm button is the danger button and focus starts on Cancel."""
    view = _shell_page(browser)
    page = view.page
    try:
        page.evaluate(
            """() => { window.__open = () => QymShell.openConfirmDialog({
                title: 'Delete dataset?', description: 'Gone.', confirmLabel: 'Delete dataset', danger: true,
            }); }"""
        )
        page.locator("#dialog-trigger").click()
        page.wait_for_selector("#shell-confirm-dialog")
        classes = page.locator("#shell-confirm-submit").get_attribute("class").split()
        assert "shell-btn-danger" in classes and "shell-btn-primary" not in classes
        assert _active(page) == "shell-confirm-cancel"
    finally:
        view.close()


def test_form_dialog_is_labelled_and_enter_on_cancel_cancels(browser):
    view = _shell_page(browser)
    page = view.page
    try:
        page.evaluate(
            """() => { window.__open = () => QymShell.openFormDialog({
                title: 'Rename', fields: [{ name: 'name', label: 'Name', value: 'x' }],
            }); }"""
        )
        page.locator("#dialog-trigger").click()
        page.wait_for_selector("#shell-form-dialog")
        modal = page.locator("#shell-form-dialog .shell-modal")
        title_id = modal.get_attribute("aria-labelledby")
        assert title_id and page.locator("#" + title_id).inner_text() == "Rename"
        assert _active(page) == "shell-form-field-0"
        page.locator("#shell-form-cancel").focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => window.__result !== undefined")
        assert page.evaluate("() => window.__result.confirmed") is False

        # Enter in the text field still submits.
        page.locator("#dialog-trigger").click()
        page.wait_for_selector("#shell-form-dialog")
        page.keyboard.press("Enter")
        page.wait_for_function("() => window.__result !== undefined")
        assert page.evaluate("() => window.__result.confirmed") is True
    finally:
        view.close()


def test_create_project_dialog_is_a_labelled_modal_that_returns_focus(browser):
    view = _shell_page(browser)
    page = view.page
    try:
        page.evaluate("() => { window.__open = () => { QymShell.openCreateProjectDialog(); return new Promise(() => {}); }; }")
        has_api = page.evaluate("() => typeof QymShell.openCreateProjectDialog === 'function'")
        if not has_api:
            page.locator(".popover-create, #shell-create-project-btn").first.click()
        else:
            page.locator("#dialog-trigger").click()
        page.wait_for_selector("#shell-create-project-dialog")
        modal = page.locator("#shell-create-project-dialog .shell-modal")
        assert modal.get_attribute("role") == "dialog"
        assert modal.get_attribute("aria-modal") == "true"
        assert page.locator("label[for='shell-new-project-name']").count() == 1
        assert page.locator("label[for='shell-new-project-slug']").count() == 1
        page.wait_for_function("() => document.activeElement.id === 'shell-new-project-name'")
        for _ in range(6):
            page.keyboard.press("Tab")
            assert page.evaluate("() => !!document.activeElement.closest('#shell-create-project-dialog')")
        page.keyboard.press("Escape")
        assert page.locator("#shell-create-project-dialog").count() == 0
        if has_api:
            assert _active(page) == "dialog-trigger"
    finally:
        view.close()


# ── C049 + C038: Runs page ───────────────────────────────────────────────────

@pytest.fixture
def runs_view(browser):
    view = DashboardFixture(browser)
    view.page.set_viewport_size({"width": 1280, "height": 900})
    view.page.goto("https://qym.test/projects/demo")
    view.page.wait_for_function("() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0")
    try:
        yield view
    finally:
        view.close()


def test_runs_delete_and_help_modals_manage_focus(runs_view):
    page = runs_view.page
    deletes = []
    page.on("request", lambda request: deletes.append(request.url) if "api/runs/delete" in request.url else None)
    trigger = page.locator("#runs-tbody tr a.delete-run").first
    trigger.focus()
    page.keyboard.press("Enter")
    page.wait_for_selector("#delete-modal", state="visible")
    panel = page.locator("#delete-modal .modal-content")
    assert panel.get_attribute("role") == "dialog"
    assert panel.get_attribute("aria-labelledby") == "delete-modal-title"
    assert _active(page, "document.activeElement.textContent.trim()") == "Cancel"
    for _ in range(4):
        page.keyboard.press("Tab")
        assert page.evaluate("() => !!document.activeElement.closest('#delete-modal')")
    page.locator("#delete-modal .btn-secondary").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector("#delete-modal", state="hidden")
    assert deletes == []
    assert page.evaluate("() => document.activeElement.classList.contains('delete-run')")

    page.keyboard.press("Enter")
    page.wait_for_selector("#delete-modal", state="visible")
    page.keyboard.press("Escape")
    page.wait_for_selector("#delete-modal", state="hidden")
    assert deletes == []

    # '?' opens the shortcuts dialog with focus inside; shortcuts do not act behind it.
    page.locator("body").click(position={"x": 2, "y": 2})
    page.keyboard.press("Shift+Slash")
    page.wait_for_selector("#help-modal", state="visible")
    assert page.evaluate("() => !!document.activeElement.closest('#help-modal')")
    focused_before = page.evaluate("() => window.__dashboardTest.state.focusedIndex")
    page.keyboard.press("j")
    assert page.evaluate("() => window.__dashboardTest.state.focusedIndex") == focused_before
    page.keyboard.press("Escape")
    page.wait_for_selector("#help-modal", state="hidden")
    assert runs_view.errors == []


def test_failed_runs_refresh_keeps_rows_dimmed_under_a_banner(runs_view):
    page = runs_view.page
    rows = page.locator("#runs-tbody tr").count()
    page.route("**/api/dashboard/**", lambda route: route.fulfill(status=503, body="busy"))
    page.locator(".quick-filters [data-filter='week']").click()
    banner = page.locator("#runs-stale-banner")
    banner.wait_for()
    text = banner.inner_text()
    assert "Couldn’t refresh runs" in text
    assert "not applied" in text
    assert page.locator("#table-view").get_attribute("aria-busy") == "false"
    assert "qym-is-stale" in page.locator("#table-view").get_attribute("class")
    assert page.locator("#runs-tbody tr").count() == rows
    page.unroute("**/api/dashboard/**")
    banner.locator("[data-runs-retry]").click()
    page.wait_for_function("() => !document.getElementById('runs-stale-banner')")
    assert "qym-is-stale" not in (page.locator("#table-view").get_attribute("class") or "")


def test_an_unchanged_refresh_after_a_failure_clears_the_stale_banner(runs_view):
    page = runs_view.page
    page.route("**/api/dashboard/**", lambda route: route.fulfill(status=503, body="busy"))
    page.evaluate("() => window.__dashboardTest.fetchRuns().catch(() => {})")
    page.locator("#runs-stale-banner").wait_for()
    page.unroute("**/api/dashboard/**")
    # Same filters, same rows: the answer equals the shown page.
    page.evaluate("() => window.__dashboardTest.fetchRuns()")
    page.wait_for_function("() => !document.getElementById('runs-stale-banner')")
    assert "qym-is-stale" not in (page.locator("#table-view").get_attribute("class") or "")


def test_first_runs_load_failure_is_an_error_with_retry(browser):
    view = DashboardFixture(browser)
    try:
        view.page.route("**/api/dashboard/**", lambda route: route.abort())
        view.page.goto("https://qym.test/projects/demo")
        view.page.wait_for_selector("#loading .qym-error-state")
        text = view.page.locator("#loading").inner_text()
        assert "Couldn’t load runs" in text
        assert "Is the server running" not in text
        assert view.page.locator("#loading [data-qym-retry]").count() == 1
        assert view.page.locator("#status-filter").inner_text() == "Runs not loaded"
        view.page.unroute("**/api/dashboard/**")
        view.page.locator("#loading [data-qym-retry]").click()
        view.page.wait_for_function("() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0")
    finally:
        view.close()


# ── C038: Datasets and Compare ───────────────────────────────────────────────

def _datasets_view(browser, handler, path="/projects/demo/datasets"):
    pages = {path: STATIC / "datasets.html"}
    view = PageFixture(browser, pages, [("/v1/datasets", handler)])
    view.goto(path)
    return view


@pytest.mark.parametrize("failure", ["abort", 500, 403, 401])
def test_failed_dataset_list_is_an_error_not_no_datasets_yet(browser, failure):
    def handler(route, url):
        if failure == "abort":
            route.abort()
        else:
            route.fulfill(status=failure, json={"detail": "nope"})

    view = _datasets_view(browser, handler)
    try:
        page = view.page
        page.wait_for_selector(".qym-error-state")
        assert page.get_by_text("No datasets yet").count() == 0
        assert page.get_by_text("Create your first dataset").count() == 0
        state = page.locator(".qym-error-state")
        kind = state.get_attribute("data-error-kind")
        assert kind == {"abort": "network", 500: "server", 403: "forbidden", 401: "auth"}[failure]
        if failure in ("abort", 500):
            assert state.locator("[data-qym-retry]").count() == 1
        if failure == 401:
            assert state.get_by_role("link", name="Sign in").count() == 1
    finally:
        view.close()


def test_dataset_detail_says_not_found_only_for_a_404(browser):
    def handler(route, url):
        if "/missing" in url.path:
            route.fulfill(status=404, json={"detail": "Dataset not found"})
        else:
            route.fulfill(status=500, json={"detail": "boom"})

    view = PageFixture(
        browser,
        {"/projects/demo/datasets/missing": STATIC / "datasets.html", "/projects/demo/datasets/broken": STATIC / "datasets.html"},
        [("/v1/datasets", handler)],
    )
    try:
        view.goto("/projects/demo/datasets/missing")
        view.page.wait_for_selector(".qym-error-state")
        assert view.page.locator(".qym-error-state__title").inner_text() == "Dataset not found"
        view.goto("/projects/demo/datasets/broken")
        view.page.wait_for_selector(".qym-error-state")
        assert view.page.locator(".qym-error-state__title").inner_text() == "Couldn’t load this dataset"
        assert "HTTP 500" in view.page.locator(".qym-error-state").inner_text()
        assert view.page.locator("[data-qym-retry]").count() == 1
    finally:
        view.close()


def _compare_view(browser, handler):
    view = PageFixture(browser, {"/compare": STATIC / "compare.html"}, [("/api/compare", handler)])
    view.goto("/compare?runs=r1&runs=r2")
    return view


def test_failed_compare_is_an_error_not_no_runs_to_compare(browser):
    calls = []

    def handler(route, url):
        calls.append(url.query)
        route.fulfill(status=500, body="Internal Server Error")

    view = _compare_view(browser, handler)
    try:
        page = view.page
        page.wait_for_selector("#compare-load-error .qym-error-state")
        assert not page.locator("#empty").is_visible()
        assert page.locator(".qym-error-state").get_attribute("data-error-kind") == "server"
        page.locator("[data-qym-retry]").click()
        page.wait_for_function("() => true")
        page.wait_for_selector("#compare-load-error .qym-error-state")
        assert len(calls) == 2
    finally:
        view.close()


def test_compare_names_runs_the_server_could_not_return(browser):
    def handler(route, url):
        route.fulfill(json={"runs": [], "missing_runs": [{"run_id": "r1"}, {"run_id": "r2"}]})

    view = _compare_view(browser, handler)
    try:
        page = view.page
        page.wait_for_selector("#compare-load-error .qym-error-state")
        text = page.locator(".qym-error-state").inner_text()
        assert "Runs in this comparison were not found" in text
        assert "2 of 2 runs in this link were deleted or are not visible to you" in text
        assert "Missing: r1, r2" in text
        assert "HTTP" not in text
        assert not page.locator("#empty").is_visible()
    finally:
        view.close()


# ── C053 + C049: Reviews ─────────────────────────────────────────────────────

CORRECTIONS = {
    "corrections": [{
        "id": 7, "status": "pending", "item_id": "ar-1", "task": "qa", "metric_name": "accuracy",
        "run_name": "run-ar", "ai_confidence": 0.8, "input_snapshot": AR_Q, "expected_snapshot": AR_A,
        "output_snapshot": json.dumps({"answer": AR_A, "sql": "SELECT 1"}, ensure_ascii=False),
        "input_preview": AR_Q, "expected_preview": AR_A,
        "created_at": "2026-09-30T10:00:00Z",
    }],
    "stats": {"total": 1, "pending": 1, "approved": 0, "rejected": 0},
    "tasks": ["qa"], "datasets": [], "models": [], "run_names": ["run-ar"],
}


def _reviews_view(browser, answer):
    return PageFixture(
        browser,
        {"/projects/demo/reviews": STATIC / "reviews.html"},
        [("/api/corrections", answer)],
    )


def _corrections_answer(route, url):
    # The list carries short previews; GET /api/corrections/{id} the full record.
    if url.path.rstrip("/").endswith("/7"):
        route.fulfill(json=CORRECTIONS["corrections"][0])
    else:
        route.fulfill(json=CORRECTIONS)


@pytest.mark.parametrize("width", [1280, 1440])
def test_reviews_arabic_reads_right_to_left_with_arabic_language(browser, width):
    view = _reviews_view(browser, _corrections_answer)
    view.page.set_viewport_size({"width": width, "height": 900})
    try:
        view.goto("/projects/demo/reviews")
        page = view.page
        page.wait_for_selector(".correction-card .preview-text")
        previews = page.evaluate(
            "() => Array.from(document.querySelectorAll('.correction-card .preview-text'), el => [el.getAttribute('dir'), el.getAttribute('lang')])"
        )
        assert ["rtl", "ar"] in previews
        page.locator("[data-expand='7']").click()
        page.wait_for_selector(".correction-card .detail-snapshot")
        blocks = page.evaluate(
            """() => Array.from(document.querySelectorAll('.correction-card .detail-snapshot')).map(el => ({
                text: el.textContent.trim().slice(0, 12), dir: el.getAttribute('dir'), lang: el.getAttribute('lang'),
                direction: getComputedStyle(el).direction,
                leading: parseFloat(getComputedStyle(el).lineHeight) / parseFloat(getComputedStyle(el).fontSize),
            }))"""
        )
        arabic = [b for b in blocks if b["dir"] == "rtl"]
        assert len(arabic) >= 2
        for block in arabic:
            assert block["lang"] == "ar"
            assert block["direction"] == "rtl"
            assert abs(block["leading"] - 1.7) < 0.01
        sql = [b for b in blocks if b["text"].startswith("SELECT")]
        assert sql and sql[0]["dir"] == "auto" and sql[0]["direction"] == "ltr"
        assert view.errors == []
    finally:
        view.close()


def test_reviews_action_modal_and_toasts_are_accessible(browser):
    view = _reviews_view(browser, lambda route, url: route.fulfill(json=CORRECTIONS))
    try:
        view.goto("/projects/demo/reviews")
        page = view.page
        page.wait_for_selector(".correction-card")
        assert page.locator("#conf-min").get_attribute("aria-label") == "Minimum confidence"
        assert page.locator("#conf-max").get_attribute("aria-label") == "Maximum confidence"
        assert page.locator("[data-check='7']").get_attribute("aria-label") == "Select correction #7"
        assert page.locator(".model-reasoning-badge[aria-label]:not([role='img'])").count() == 0
        reject = page.locator("[data-reject='7']")
        reject.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("#action-modal.open")
        content = page.locator("#action-modal .reviews-modal-content")
        assert content.get_attribute("role") == "dialog"
        assert content.get_attribute("aria-labelledby") == "modal-title"
        assert _active(page) == "modal-comment"
        for _ in range(5):
            page.keyboard.press("Tab")
            assert page.evaluate("() => !!document.activeElement.closest('#action-modal')")
        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('#action-modal.open')")
        assert _active(page, "document.activeElement.getAttribute('data-reject')") == "7"
    finally:
        view.close()


def test_reviews_failed_load_is_an_error_not_no_corrections(browser):
    view = _reviews_view(browser, lambda route, url: route.fulfill(status=500, body="boom"))
    try:
        view.goto("/projects/demo/reviews")
        page = view.page
        page.wait_for_selector("#reviews-load-error .qym-error-state")
        assert not page.locator("#empty-state").is_visible()
        assert page.locator("#reviews-load-error [data-qym-retry]").count() == 1
    finally:
        view.close()


# ── C038: run page ───────────────────────────────────────────────────────────

def test_run_page_names_the_failure_instead_of_blaming_the_network(browser):
    def runs(route, url):
        if url.path.startswith("/api/runs/gone"):
            route.fulfill(json={"error": "Run not found"})
        elif url.path.startswith("/api/runs/broken"):
            route.fulfill(status=500, body="boom")
        else:
            route.fulfill(json={})

    pages = {
        "/projects/demo/runs/gone": STATIC / "run.html",
        "/projects/demo/runs/broken": STATIC / "run.html",
    }
    view = PageFixture(browser, pages, [("/api/runs/", runs)])
    try:
        page = view.page
        view.goto("/projects/demo/runs/gone")
        page.wait_for_selector("#error-state", state="visible")
        assert page.locator("#error-title").inner_text() == "Run not found"
        assert "HTTP" not in page.locator("#error-message").inner_text()
        view.goto("/projects/demo/runs/broken")
        page.wait_for_selector("#error-state", state="visible")
        assert page.locator("#error-title").inner_text() == "Server error"
        message = page.locator("#error-message").inner_text()
        assert "HTTP 500" in message
        assert "Could not connect" not in message
    finally:
        view.close()


def test_run_page_server_failure_offers_retry_and_not_found_does_not(browser):
    calls = {"broken": 0}

    def runs(route, url):
        if url.path.startswith("/api/runs/gone"):
            route.fulfill(json={"error": "Run not found"})
        elif url.path == "/api/runs/broken":
            calls["broken"] += 1
            route.fulfill(status=503, body="busy")
        else:
            route.fulfill(json={})

    pages = {
        "/projects/demo/runs/gone": STATIC / "run.html",
        "/projects/demo/runs/broken": STATIC / "run.html",
    }
    view = PageFixture(browser, pages, [("/api/runs/", runs)])
    try:
        page = view.page
        view.goto("/projects/demo/runs/gone")
        page.wait_for_selector("#error-state", state="visible")
        assert page.locator("#error-retry").is_hidden()
        view.goto("/projects/demo/runs/broken")
        page.wait_for_selector("#error-state", state="visible")
        retry = page.locator("#error-retry")
        assert retry.is_visible()
        assert calls["broken"] == 1
        retry.click()
        page.wait_for_selector("#error-state", state="visible")
        page.wait_for_function("() => document.querySelector('#error-retry') && !document.querySelector('#error-retry').hidden")
        assert calls["broken"] == 2
        assert view.errors == []
    finally:
        view.close()


# ── Review fixes: keyboard inside the open trace drawer ──────────────────────

TRACE_SPANS = {"spans": [
    {"span_id": "s1", "trace_id": "t", "parent_span_id": None, "name": "root", "kind": "chain",
     "start_time": "2026-01-01T00:00:00Z", "end_time": "2026-01-01T00:00:01Z",
     "attributes": {"input": "hello", "output": "world"}},
    {"span_id": "s2", "trace_id": "t", "parent_span_id": "s1", "name": "llm", "kind": "llm",
     "start_time": "2026-01-01T00:00:00Z", "end_time": "2026-01-01T00:00:01Z", "attributes": {"input": "hi"}},
    {"span_id": "s3", "trace_id": "t", "parent_span_id": "s1", "name": "tool", "kind": "tool",
     "start_time": "2026-01-01T00:00:00.5Z", "end_time": "2026-01-01T00:00:01Z", "attributes": {"input": "x"}},
], "attempts": []}

SELECTED_SPAN = "() => document.querySelector('.tv-drawer [data-span].sel')?.dataset.span || ''"


def test_enter_activates_buttons_inside_the_open_trace_drawer(browser):
    """Focus now lands in the drawer, so Enter on its buttons must work; the
    drawer's span shortcuts used to swallow Enter on Close."""
    view = PageFixture(browser, {"/trace": TRACE_PAGE}, [("/api/runs/", lambda route, url: route.fulfill(json=TRACE_SPANS))])
    try:
        view.goto("/trace")
        page = view.page
        page.locator("#trace-trigger").focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(".tv-shell.open .tv-drawer [data-span]")
        # Span shortcuts still work from the drawer itself.
        before = page.evaluate(SELECTED_SPAN)
        page.keyboard.press("k" if before == "s3" else "j")
        assert page.evaluate(SELECTED_SPAN) not in ("", before)
        # Enter on Close closes the drawer and returns focus to Trace.
        page.locator(".tv-drawer .tv-close").focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => !document.querySelector('.tv-shell.open')")
        assert _active(page) == "trace-trigger"
        assert view.errors == []
    finally:
        view.close()
