"""Reviews as a keyboard-driven queue, in a real browser against the real app.

C063: Reviews opens on the pending queue with how many are left, progress, a
sort and priority tags. C026: it renders one page of compact cards and adds
the next page on scroll. C042: an older, slower response never replaces the
list for a newer filter (and bulk actions wait for it); on the run page a slow
earlier metric never replaces the chosen sample-analysis tab, and a failed
load says so with a Retry. C050: j/k move, a approves and moves on, focus never
drops to <body>, the status tabs are keyboard tabs and ? lists the keys.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urljoin, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    CorrectionStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    ReviewCorrection,
    Run,
    RunItem,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db

pytestmark = pytest.mark.browser

NOW = datetime.utcnow().replace(microsecond=0)
# Delays the first matching response in the page, after it arrives, so it
# lands after a later request: the order a slow network produces.
DELAY_FIRST = """([needle, ms]) => {
  const original = window.fetch;
  let seen = 0;
  window.fetch = function (input) {
    const url = String((input && input.url) || input);
    const response = original.apply(this, arguments);
    if (url.includes(needle) && ++seen === 1) {
      return response.then(r => new Promise(resolve => setTimeout(() => resolve(r), ms)));
    }
    return response;
  };
}"""


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


def _run(run_id, task, **fields):
    values = dict(
        id=run_id,
        project_id="pa",
        created_by_user_id="owner",
        owner_user_id="owner",
        task=task,
        dataset="golden",
        model="openai/gpt-4o",
        metrics=["accuracy"],
        run_metadata={},
        run_config={"run_name": f"{task} nightly"},
        status=RunWorkflowStatus.COMPLETED,
        created_at=NOW - timedelta(days=40),
    )
    values.update(fields)
    return Run(**values)


@pytest.fixture()
def factory(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add(
            User(id="owner", email="dev@local", display_name="Dev", role=UserRole.ADMIN)
        )
        db.flush()
        db.add(
            Project(id="pa", name="Support bot", slug="pa", created_by_user_id="owner")
        )
        db.flush()
        db.add(
            ProjectMembership(
                project_id="pa", user_id="owner", role=ProjectRole.MANAGER
            )
        )
        db.add_all([_run("r-sql", "text2sql"), _run("r-router", "router")])
        db.flush()
        for index in range(36):
            run_id = "r-sql" if index % 2 == 0 else "r-router"
            item_id = f"item-{index:02d}"
            status = (
                CorrectionStatus.APPROVED if index >= 30 else CorrectionStatus.PENDING
            )
            db.add(
                RunItem(
                    run_id=run_id,
                    item_id=item_id,
                    index=index,
                    input={"q": index},
                    item_metadata={},
                )
            )
            db.add(
                ReviewCorrection(
                    run_id=run_id,
                    item_id=item_id,
                    metric_name="accuracy",
                    task="text2sql" if run_id == "r-sql" else "router",
                    input_snapshot={
                        "question": f"Question number {index}",
                        "context": "c" * 3000,
                    },
                    expected_snapshot={"answer": "expected " * 300},
                    output_snapshot={"answer": "output " * 300},
                    scores_snapshot={"accuracy": 0.1},
                    ai_root_cause="Wrong join",
                    ai_root_causes=["Wrong join"],
                    human_root_cause="Wrong join",
                    human_root_causes=["Wrong join"],
                    ai_confidence=0.3 if index == 3 else 0.9,
                    is_active=True,
                    status=status,
                    corrected_by_user_id="owner",
                    created_at=NOW - timedelta(days=3, minutes=100 - index),
                )
            )
        db.commit()
    yield make
    engine.dispose()


class App:
    """Serve every browser request from the real app through a TestClient."""

    def __init__(self, browser, make, width=1440):
        app = create_app()

        def session():
            db = make()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.errors = []
        self.requests = []
        self.context = browser.new_context(viewport={"width": width, "height": 900})
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self._forward)

    def _forward(self, route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname != "qym.test":
            return route.abort()
        target = url.path + (f"?{url.query}" if url.query else "")
        self.requests.append((request.method, target, request.post_data))
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() in {"content-type", "accept"}
        }
        response = self.client.request(
            request.method,
            target,
            headers=headers,
            content=request.post_data_buffer,
            follow_redirects=False,
        )
        if response.is_redirect:
            location = urljoin(request.url, response.headers["location"])
            return route.fulfill(
                status=200,
                headers={"content-type": "text/html"},
                body=f"<script>location.replace({json.dumps(location)})</script>",
            )
        route.fulfill(
            status=response.status_code,
            headers={
                "content-type": response.headers.get("content-type", "text/plain")
            },
            body=response.content,
        )

    def goto(self, path):
        self.page.goto(f"http://qym.test{path}")
        return self.page

    def list_requests(self):
        return [
            parse_qs(urlparse(target).query)
            for method, target, _ in self.requests
            if method == "GET" and urlparse(target).path == "/api/corrections"
        ]

    def close(self):
        self.context.close()
        self.client.close()


@pytest.fixture()
def app(browser, factory):
    instance = App(browser, factory)
    yield instance
    instance.close()


def _open_reviews(app, query=""):
    page = app.goto("/projects/pa/reviews" + query)
    page.locator(".correction-card").first.wait_for()
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'false'"
    )
    return page


def _card_ids(page):
    return page.eval_on_selector_all(
        ".correction-card", "cards => cards.map(c => Number(c.dataset.id))"
    )


def test_reviews_opens_on_the_pending_queue_one_page_at_a_time(app):
    page = _open_reviews(app)
    selected = page.locator('[role="tablist"] [role="tab"][aria-selected="true"]')
    assert selected.get_attribute("data-filter") == "pending"
    assert "To review" in selected.inner_text()
    meta = " ".join(page.locator(".reviews-meta").inner_text().split())
    assert "Queue: 30 to review" in meta
    assert "6 of 36 reviewed" in meta
    assert page.locator("#reviews-progress").get_attribute("aria-valuenow") == "17"

    first = app.list_requests()[0]
    assert first["status"] == ["pending"]
    assert first["sort"] == ["oldest"]
    assert first["limit"] == ["25"]
    # One page of compact cards, oldest first, with collapsed previews.
    assert page.locator(".correction-card").count() == 25
    assert page.locator(".correction-card.status-approved").count() == 0
    assert page.locator("#result-count").inner_text() == "Showing 25 of 30"
    assert page.locator("#list-error").is_hidden()
    assert page.locator(".correction-card .detail-snapshot").count() == 0
    assert (
        "Question number 0"
        in page.locator(".correction-card .preview-text").first.inner_text()
    )
    heights = page.eval_on_selector_all(
        ".correction-card",
        "cards => cards.slice(0, 5).map(c => c.getBoundingClientRect().height)",
    )
    assert max(heights) < 450, heights
    assert page.evaluate("document.querySelectorAll('*').length") < 4000

    # Low AI confidence marks the item high priority, with its reason.
    chip = page.locator('.correction-card:has-text("item-03") .card-priority')
    assert chip.inner_text() == "High priority"
    assert "AI confidence 30%" in chip.get_attribute("title")

    page.locator("#reviews-body").evaluate(
        "body => body.scrollTo(0, body.scrollHeight)"
    )
    page.wait_for_function(
        "document.querySelectorAll('.correction-card').length === 30"
    )
    assert len(set(_card_ids(page))) == 30
    assert app.list_requests()[-1]["cursor"]
    assert page.locator("#reviews-more").is_hidden()

    # Sorting asks the server again and is remembered.
    page.select_option("#sort-select", "newest")
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'false'"
    )
    assert app.list_requests()[-1]["sort"] == ["newest"]
    assert "item-29" in page.locator(".correction-card").first.inner_text()
    assert app.errors == []


def test_an_older_slower_response_never_replaces_the_newer_filter(app):
    page = _open_reviews(app)
    page.evaluate(DELAY_FIRST, ["search=text2sql", 1500])
    page.fill("#search-input", "text2sql")
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'true'"
    )
    # The list on screen belongs to the previous filter: no bulk action now.
    assert page.locator("#select-all").is_disabled()
    page.fill("#search-input", "router")
    page.wait_for_timeout(2600)
    texts = page.locator(".correction-card .card-context").all_inner_texts()
    assert len(texts) == 15
    assert all("router" in text for text in texts)
    assert page.locator("#result-count").inner_text() == "15 corrections"
    assert not page.locator("#select-all").is_disabled()

    page.check("#select-all")
    assert page.locator("#bulk-count").inner_text() == "15"
    page.click("#bulk-reject")
    description = page.locator("#modal-desc").inner_text()
    assert 'To review · matching "router"' in description
    page.fill("#modal-comment", "duplicate")
    page.click("#modal-confirm")
    page.wait_for_function("document.querySelectorAll('.correction-card').length === 0")
    _method, _target, body = next(
        r for r in reversed(app.requests) if r[1] == "/api/corrections/bulk"
    )
    sent = json.loads(body)
    assert sent["expected_count"] == 15
    # The tab the selection came from: the server refuses rows that left it.
    assert sent["expected_status"] == "pending"
    assert sent["action"] == "reject"
    assert page.locator("#stat-rejected").inner_text() == "15"
    assert app.errors == []


def test_keyboard_review_flow_keeps_focus_on_the_queue(app):
    page = _open_reviews(app)
    ids = _card_ids(page)
    page.keyboard.press("j")
    assert page.evaluate("Number(document.activeElement.dataset.id)") == ids[0]
    page.keyboard.press("j")
    page.keyboard.press("k")
    page.keyboard.press("j")
    assert page.evaluate("Number(document.activeElement.dataset.id)") == ids[1]

    page.keyboard.press("a")
    page.wait_for_function(
        f"!document.querySelector('.correction-card[data-id=\"{ids[1]}\"]')"
    )
    # Approve-and-next: the next correction is current and holds focus.
    assert page.evaluate("Number(document.activeElement.dataset.id)") == ids[2]
    assert page.locator(".correction-card.is-current").get_attribute("data-id") == str(
        ids[2]
    )
    assert page.locator("#stat-pending").inner_text() == "29"
    assert page.locator("#stat-approved").inner_text() == "7"
    # Only counts were re-read; the loaded list was patched, not refetched.
    assert app.list_requests()[-1]["limit"] == ["1"]

    page.keyboard.press("x")
    assert page.locator("#bulk-count").inner_text() == "1"
    page.keyboard.press("o")
    page.locator(
        f"#detail-{ids[2]} .history-list, #detail-{ids[2]} .detail-snapshot"
    ).first.wait_for()
    assert "expected expected" in page.locator(f"#detail-{ids[2]}").inner_text()
    page.keyboard.press("e")
    assert page.evaluate("document.activeElement.dataset.issueField") == "category"
    page.keyboard.press("Escape")
    assert page.evaluate("Number(document.activeElement.dataset.id)") == ids[2]

    page.keyboard.press("r")
    assert page.locator("#action-modal").evaluate("m => m.classList.contains('open')")
    page.keyboard.press("Escape")
    assert page.evaluate("Number(document.activeElement.dataset.id)") == ids[2]

    page.keyboard.press("?")
    assert page.locator("#shortcuts-modal").evaluate(
        "m => m.classList.contains('open')"
    )
    assert (
        "Approve and move to the next" in page.locator("#shortcuts-modal").inner_text()
    )
    page.keyboard.press("Escape")
    assert not page.locator("#shortcuts-modal").evaluate(
        "m => m.classList.contains('open')"
    )

    # Mouse approve also moves focus to the next card instead of <body>.
    page.locator(f'.correction-card[data-id="{ids[3]}"] [data-approve]').click()
    page.wait_for_function(
        f"!document.querySelector('.correction-card[data-id=\"{ids[3]}\"]')"
    )
    assert page.evaluate("document.activeElement.classList.contains('correction-card')")

    # Status tabs are a keyboard tablist.
    page.locator('[role="tab"][data-filter="pending"]').focus()
    page.keyboard.press("ArrowRight")
    page.wait_for_function(
        "document.querySelector('[role=tab][aria-selected=true]').dataset.filter === 'approved'"
    )
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'false'"
    )
    assert page.locator(".correction-card").count() == 8
    assert app.list_requests()[-1]["status"] == ["approved"]
    assert app.errors == []


def test_nothing_picked_on_the_dimmed_list_is_selected_after_it_loads(app):
    page = _open_reviews(app)
    page.evaluate(DELAY_FIRST, ["search=router", 1500])
    page.fill("#search-input", "router")
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'true'"
    )
    # item-00 is a text2sql correction: it is not in the "router" results.
    page.locator('.correction-card:has-text("item-00") [data-check]').click()
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'false'"
    )
    assert page.locator('.correction-card:has-text("item-00")').count() == 0
    assert page.locator("#bulk-count").inner_text() == "0"
    assert not page.locator("#bulk-bar").evaluate(
        "bar => bar.classList.contains('visible')"
    )
    page.keyboard.press("Shift+A")
    assert not page.locator("#action-modal").evaluate(
        "m => m.classList.contains('open')"
    )
    assert app.errors == []


def test_approve_moves_to_the_next_pending_card_in_the_all_tab(app):
    page = _open_reviews(app)
    page.click('[role="tab"][data-filter=""]')
    page.wait_for_function(
        "document.getElementById('correction-list').getAttribute('aria-busy') === 'false'"
    )
    ids = _card_ids(page)
    # Letter keys work straight after clicking a status tab.
    page.keyboard.press("j")
    assert page.evaluate("Number(document.activeElement.dataset.id)") == ids[0]
    page.keyboard.press("a")
    page.wait_for_function(
        f"document.querySelector('.correction-card[data-id=\"{ids[0]}\"]').classList.contains('status-approved')"
    )
    # The approved card stays in All; the keyboard place moves on.
    page.wait_for_function(
        f"Number(document.activeElement.dataset.id) === {ids[1]}"
    )
    page.keyboard.press("a")
    page.wait_for_function(
        f"document.querySelector('.correction-card[data-id=\"{ids[1]}\"]').classList.contains('status-approved')"
    )
    page.wait_for_function(
        f"Number(document.activeElement.dataset.id) === {ids[2]}"
    )
    assert page.locator("#stat-approved").inner_text() == "8"
    # Snapshot regions are named after their section and key.
    page.keyboard.press("o")
    page.locator(f"#detail-{ids[2]} .detail-snapshot").first.wait_for()
    labels = page.eval_on_selector_all(
        f"#detail-{ids[2]} .detail-snapshot",
        "nodes => nodes.map(node => node.getAttribute('aria-label'))",
    )
    assert "Input: Question" in labels, labels
    assert app.errors == []


def test_a_failed_load_says_so_and_retries(app):
    page = _open_reviews(app)
    page.evaluate("""() => {
      const original = window.fetch;
      let failed = false;
      window.fetch = function (input) {
        const url = String((input && input.url) || input);
        if (!failed && url.includes('api/corrections?') && url.includes('search=nothing')) {
          failed = true;
          return Promise.resolve(new Response('{"detail": "boom"}', { status: 500 }));
        }
        return original.apply(this, arguments);
      };
    }""")
    page.fill("#search-input", "nothing")
    page.locator("#list-error").wait_for()
    assert page.locator("#correction-list").is_hidden()
    assert page.locator("#empty-state").is_hidden()
    page.click("#list-retry")
    page.locator("#empty-state").wait_for()
    assert page.locator("#list-error").is_hidden()
    assert (
        page.locator("#empty-state .empty-title").inner_text()
        == "No corrections match these filters"
    )


def test_overview_pending_items_open_that_correction_in_the_queue(app):
    page = app.goto("/projects/pa/overview")
    link = page.locator("#pending-reviews-body a.review-item").first
    link.wait_for()
    assert link.get_attribute("href").startswith("/projects/pa/reviews?id=")
    # #30 is pending but beyond the first page (oldest first): it is added on top.
    page = app.goto("/projects/pa/reviews?id=30")
    page.wait_for_function(
        "document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id === '30'"
    )
    assert (
        page.locator('[role="tab"][aria-selected="true"]').get_attribute("data-filter")
        == "pending"
    )
    assert _card_ids(page)[0] == 30
    page.locator("#detail-30.open .detail-snapshot").first.wait_for()
    assert app.errors == []


def test_a_linked_correction_opens_expanded_and_in_focus(app):
    page = app.goto("/projects/pa/reviews?id=31")
    page.wait_for_function(
        "document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id === '31'"
    )
    # #31 is approved: the page switches to its tab rather than hiding it.
    assert (
        page.locator('[role="tab"][aria-selected="true"]').get_attribute("data-filter")
        == "approved"
    )
    page.locator("#detail-31.open .detail-snapshot").first.wait_for()
    assert app.errors == []


def test_run_sample_tabs_keep_the_chosen_metric_and_report_failures(browser, factory):
    from qym_platform.tools import seed_chart_showcase as showcase

    with factory() as db:
        project = db.get(Project, "pa")
        showcase._seed_profile(
            db, project, showcase.PROFILES[0], NOW - timedelta(hours=1)
        )
        db.commit()
    app = App(browser, factory)
    try:
        page = app.goto(f"/projects/pa/runs/{showcase.PROFILES[0].run_id}")
        page.locator(".samples-metric-tab").first.wait_for(timeout=30000)
        page.wait_for_timeout(500)
        tabs = page.eval_on_selector_all(
            ".samples-metric-tab", "t => t.map(b => b.dataset.samplesMetric)"
        )
        active = page.locator(".samples-metric-tab.active").get_attribute(
            "data-samples-metric"
        )
        slow, chosen = [name for name in tabs if name != active][:2]
        page.evaluate(DELAY_FIRST, [f"/group-metrics?metric={slow}", 1500])
        page.click(f'.samples-metric-tab[data-samples-metric="{slow}"]')
        page.wait_for_timeout(250)
        page.click(f'.samples-metric-tab[data-samples-metric="{chosen}"]')
        page.wait_for_timeout(2500)
        assert (
            page.locator(".samples-metric-tab.active").get_attribute(
                "data-samples-metric"
            )
            == chosen
        )

        page.evaluate("""() => {
          const original = window.fetch;
          window.fetch = function (input) {
            const url = String((input && input.url) || input);
            if (url.includes('/group-metrics')) return Promise.resolve(new Response('{}', { status: 500 }));
            return original.apply(this, arguments);
          };
        }""")
        page.click(f'.samples-metric-tab[data-samples-metric="{slow}"]')
        alert = page.locator('#samples-analysis-section [role="alert"]')
        alert.wait_for()
        assert "Could not load sample analysis" in alert.inner_text()
        assert alert.locator("[data-samples-retry]").is_visible()
        assert app.errors == []
    finally:
        app.close()
