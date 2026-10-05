"""Navigation across the shipped pages, against the real app (P1 group).

- C043: Back from a run restores the Runs page, sort and scroll position, and
  shows the cached rows at once.
- C044: run, dataset, model, task, owner and review references are links.
- C045: Runs, Reviews and Compare keep their view in the URL, so a link opens
  the same view in a new tab.
- C051: run names, chart run labels and dataset cards are real links; sort
  headers are buttons with aria-sort; j/k move real focus.
- C059: ?item= opens and lands on the item; Copy link on items (a run or a
  comparison is linked by its address bar); the HTML file is "Export HTML".
- C069: in-app navigation leaves no document/window listeners behind and no
  stale handler acts on a later page; the latest click wins.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.db.base import Base
from qym_platform.db.models import (
    Dataset,
    DatasetVersion,
    DatasetVersionStatus,
    Project,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
    UserRole,
)
from test_archived_project_browser import App, _publish, browser  # noqa: F401

pytestmark = pytest.mark.browser

RUNS = 70
ITEMS = 25


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
    now = datetime.utcnow()
    with make() as db:
        db.add_all(
            [
                User(id="dev", email="dev@local", display_name="Dev", role=UserRole.ADMIN),
                Project(id="pa", name="Support bot", slug="pa", created_by_user_id="dev"),
            ]
        )
        db.flush()
        db.add(Dataset(id="ds", project_id="pa", name="Golden set", slug="golden-set", created_by_user_id="dev"))
        db.flush()
        db.add(
            DatasetVersion(
                id="dsv",
                dataset_id="ds",
                version="v1",
                status=DatasetVersionStatus.PUBLISHED,
                created_by_user_id="dev",
                item_count=ITEMS,
            )
        )
        db.flush()
        for n in range(RUNS):
            run_id = f"run-{n:03d}"
            started = now - timedelta(hours=n)
            db.add(
                Run(
                    id=run_id,
                    project_id="pa",
                    created_by_user_id="dev",
                    owner_user_id="dev",
                    task="support-qa",
                    dataset="golden",
                    dataset_id="ds" if n == 0 else None,
                    dataset_version_id="dsv" if n == 0 else None,
                    model="m-a" if n % 2 == 0 else "m-b",
                    metrics=["accuracy"],
                    run_metadata={},
                    run_config={"run_name": f"Run {n:03d}"},
                    status=RunWorkflowStatus.COMPLETED,
                    started_at=started,
                    ended_at=started + timedelta(minutes=2),
                    created_at=started,
                )
            )
            db.flush()
            db.add(RunMetricSpec(run_id=run_id, metric_name="accuracy", position=0, score_type="boolean"))
            for i in range(ITEMS):
                db.add(
                    RunItem(
                        run_id=run_id,
                        item_id=f"item-{i}",
                        index=i,
                        input=f"Question {i}",
                        expected=f"Answer {i}",
                        output=f"Output {i} of {run_id}",
                        latency_ms=100 + i,
                    )
                )
                db.add(
                    RunItemScore(
                        run_id=run_id,
                        item_id=f"item-{i}",
                        metric_name="accuracy",
                        score_numeric=float((i + n) % 2),
                        score_raw=float((i + n) % 2),
                    )
                )
        for i in range(3):
            db.add(
                ReviewCorrection(
                    run_id="run-001",
                    item_id=f"item-{i}",
                    metric_name="accuracy",
                    task="support-qa",
                    ai_root_cause="Reasoning",
                    human_root_cause="Retrieval",
                    corrected_by_user_id="dev",
                    input_snapshot=f"Question {i}",
                    output_snapshot=f"Output {i}",
                )
            )
        db.commit()
    _publish(make)
    yield make
    engine.dispose()


@pytest.fixture()
def app(browser, factory):  # noqa: F811
    instance = App(browser, factory)
    instance.context.set_default_timeout(15000)
    instance.page.set_default_timeout(15000)
    yield instance
    instance.close()
    assert instance.errors == [], instance.errors


def _runs_ready(page):
    page.locator("#runs-tbody a.run-id").first.wait_for()
    page.wait_for_function("() => document.getElementById('table-view')?.getAttribute('aria-busy') !== 'true'")


def _first_run_name(page):
    return page.locator("#runs-tbody a.run-id").first.inner_text()


def _stub_clipboard(page):
    page.evaluate("() => { window.__copied = []; QymShell.copyText = text => { window.__copied.push(String(text)); return Promise.resolve(true); }; }")


def test_back_restores_runs_page_sort_and_scroll(app):
    app.page.set_viewport_size({"width": 1280, "height": 640})
    page = app.goto("/projects/pa")
    _runs_ready(page)
    page.evaluate("window.__noReload = true")

    # Sorting is a keyboard-reachable button and announces itself (C051).
    model_header = page.locator("#table-header-row th.col-model")
    model_header.locator(".th-sort-button").focus()
    page.keyboard.press("Enter")
    page.wait_for_function("() => location.search.includes('sort=model-asc')")
    assert model_header.get_attribute("aria-sort") == "ascending"
    assert page.locator("#table-header-row th.col-time").get_attribute("aria-sort") == "none"
    _runs_ready(page)

    page.locator('#table-pagination [aria-label="Next page"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('page') === '2'")
    _runs_ready(page)
    first = _first_run_name(page)
    scroller = page.locator(".runs-page-main")
    scroller.evaluate("node => { node.scrollTop = 240; }")
    page.wait_for_timeout(400)  # the shell saves offsets after scrolling settles
    target_scroll = scroller.evaluate("node => node.scrollTop")
    assert target_scroll > 100

    page.locator("#runs-tbody a.run-id").nth(12).click()
    page.wait_for_url("**/projects/pa/runs/**")
    page.locator("#items-grid .item-card").first.wait_for()

    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    params = page.evaluate("Object.fromEntries(new URLSearchParams(location.search))")
    assert params == {"sort": "model-asc", "page": "2"}
    _runs_ready(page)
    assert _first_run_name(page) == first
    page.wait_for_function(
        f"() => Math.abs(document.querySelector('.runs-page-main').scrollTop - {target_scroll}) <= 2"
    )
    assert page.locator("#table-pagination [aria-label='Page number']").input_value() == "2"
    # Soft navigation all the way: no full reload happened.
    assert page.evaluate("window.__noReload === true")


def test_back_shows_cached_rows_before_the_list_revalidates(app):
    page = app.goto("/projects/pa")
    _runs_ready(page)
    first = _first_run_name(page)
    page.locator("#runs-tbody a.run-id").first.click()
    page.wait_for_url("**/projects/pa/runs/**")
    page.locator("#items-grid .item-card").first.wait_for()

    # Hold the revalidation: the rows must still be on screen right away.
    held = []
    page.route("**/api/dashboard/runs", lambda route: held.append(route))
    page.go_back()
    page.locator("#runs-tbody a.run-id").first.wait_for()
    assert _first_run_name(page) == first
    page.wait_for_function("() => document.getElementById('table-view').getAttribute('aria-busy') === 'true'")
    page.unroute("**/api/dashboard/runs")
    for route in held:
        app._forward(route)
    page.wait_for_function("() => document.getElementById('table-view').getAttribute('aria-busy') !== 'true'")


def test_runs_view_opens_from_its_url_in_a_new_tab(app):
    page = app.goto("/projects/pa?task=support-qa&sort=run-asc&page=2&range=week")
    _runs_ready(page)
    assert page.locator("#filter-task-btn").inner_text().strip() == "support-qa"
    assert page.locator("#table-pagination [aria-label='Page number']").input_value() == "2"
    assert page.locator("#table-header-row th.col-run").get_attribute("aria-sort") == "ascending"
    assert page.locator('.filter-btn[data-filter="week"]').get_attribute("aria-pressed") == "true"
    # Sorted by name, page 2 starts at the 51st run.
    assert page.locator("#runs-tbody a.run-id").first.inner_text() == "run-050"
    assert page.evaluate("Object.fromEntries(new URLSearchParams(location.search))") == {
        "range": "week", "task": "support-qa", "sort": "run-asc", "page": "2",
    }

    page = app.goto("/projects/pa?model=m-b")
    _runs_ready(page)
    assert page.locator("#filter-model-btn").inner_text().strip() == "m-b"
    names = page.locator("#runs-tbody a.run-id").all_inner_texts()
    assert len(names) == RUNS // 2 and all(int(name.split("-")[-1]) % 2 == 1 for name in names)
    # A plain model name in the URL stays plain (no variant suffix).
    assert page.evaluate("location.search") == "?model=m-b"


def test_runs_url_keeps_search_30_days_and_a_date_range(app):
    """The runs-list search (?q=), 30d and Range (C060) round-trip through the
    view URL (C045) like the other filters."""
    page = app.goto("/projects/pa?range=month&q=run-01")
    _runs_ready(page)
    assert page.locator('.filter-btn[data-filter="month"]').get_attribute("aria-pressed") == "true"
    assert page.locator("#runs-search").input_value() == "run-01"
    params = page.evaluate("Object.fromEntries(new URLSearchParams(location.search))")
    assert params["range"] == "month" and params["q"] == "run-01"

    page = app.goto("/projects/pa?range=custom&from=2020-01-01&to=2099-12-31")
    _runs_ready(page)
    params = page.evaluate("Object.fromEntries(new URLSearchParams(location.search))")
    assert params == {"range": "custom", "from": "2020-01-01", "to": "2099-12-31"}
    assert page.evaluate("window.__dashboardTest ? window.__dashboardTest.state.quickFilter : null") in (None, "custom")


def test_run_names_chart_labels_and_dataset_cards_are_links(app):
    page = app.goto("/projects/pa")
    _runs_ready(page)
    link = page.locator("#runs-tbody a.run-id").first
    assert link.get_attribute("href").endswith("/projects/pa/runs/run-000")
    # j moves real focus to the run's link; Enter opens it in-app.
    page.locator("body").click(position={"x": 5, "y": 5})
    page.keyboard.press("Escape")
    page.keyboard.press("j")
    assert page.evaluate("document.activeElement.matches('#runs-tbody a.run-id')")
    page.keyboard.press("j")
    focused = page.evaluate("document.activeElement.getAttribute('href')")
    page.keyboard.press("Enter")
    page.wait_for_function(f"() => location.href === {json.dumps(focused)}")

    page = app.goto("/projects/pa/charts")
    page.locator("a.chart-bar-label.clickable-run").first.wait_for()
    assert "/projects/pa/runs/" in page.locator("a.chart-bar-label.clickable-run").first.get_attribute("href")
    legend = page.locator("#charts-legend button.legend-item").first
    assert legend.get_attribute("aria-pressed") == "true"
    legend.click()
    assert legend.get_attribute("aria-pressed") == "false" or page.locator("#charts-legend button.legend-item[aria-pressed='false']").count() >= 1

    page = app.goto("/projects/pa/models")
    page.locator("#models-view, #empty, #loading").first.wait_for(state="attached")
    assert page.locator('label[for="models-metric-select"]').count() == 1
    assert page.locator('label[for="models-k-input"]').count() == 1

    page = app.goto("/projects/pa/datasets")
    card = page.locator("a.dsx-card").first
    card.wait_for()
    assert card.get_attribute("href").endswith("/projects/pa/datasets/golden-set?tab=items")
    card.focus()
    page.keyboard.press("Enter")
    page.wait_for_function("() => location.pathname.endsWith('/datasets/golden-set')")
    page.locator('[data-tab="runs"], #dsx-detail-tabs button:has-text("Runs")').first.click()
    run_link = page.locator(".dsx-table a.run-name").first
    run_link.wait_for()
    assert run_link.get_attribute("href").endswith("/projects/pa/runs/run-000")


def test_the_shell_paints_the_remembered_user_before_me_answers(app):
    """The Platform section, the user menu and the project breadcrumb used to
    pop in a round trip after the sidebar. The shell now paints them from the
    last /v1/me answer, and the sidebar logo comes with the stylesheet."""
    page = app.goto("/projects/pa")
    _runs_ready(page)
    remembered = page.evaluate("JSON.parse(localStorage.getItem('qym:me'))")
    assert remembered["role"] == "ADMIN"
    assert {"slug": "pa", "name": "Support bot"} in remembered["projects"]

    held = []
    page.route("**/v1/me", lambda route: held.append(route))  # unanswered: only memory can paint
    page.goto("http://qym.test/projects/pa/runs/run-000", wait_until="domcontentloaded")
    page.wait_for_selector("#qym-sidebar")
    assert page.locator('#qym-sidebar .nav-item[data-page="admin"]').is_visible()
    assert page.locator("#shell-user-name").inner_text() == "Dev"
    crumbs = page.locator("#shell-breadcrumbs").inner_text()
    assert "Support bot" in crumbs and "Runs" in crumbs and "run-000" in crumbs, crumbs
    logo = page.evaluate("getComputedStyle(document.querySelector('.logo-icon-img')).backgroundImage")
    assert logo.startswith('url("data:image/png;base64,'), logo[:40]

    page.unroute("**/v1/me")
    for route in held:
        app._forward(route)
    page.wait_for_function("() => document.getElementById('shell-breadcrumbs').innerText.includes('run-000')")
    assert "Support bot" in page.locator("#shell-breadcrumbs").inner_text()


def test_a_reload_keeps_the_frame_and_the_topbar_numbers_in_place(app):
    """A list page used to paint bare (full width, no sidebar or top bar)
    before the shell wrapped it, then blanked the top bar's numbers until
    they reloaded. The shell's frame now stands in from the first paint, and
    the numbers last shown at the URL stay until the page's own arrive."""
    page = app.goto("/projects/pa")
    _runs_ready(page)
    page.wait_for_function("() => document.querySelector('#shell-topbar-stats .topbar-stat-value')")
    numbers = page.locator("#shell-topbar-stats").inner_text()
    assert page.evaluate("document.documentElement.classList.contains('qym-shell-pending')") is False

    held = []
    page.route("**/api/dashboard/runs*", lambda route: held.append(route))
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#qym-sidebar")
    for _ in range(50):  # the page has asked for its numbers, unanswered
        if held:
            break
        page.wait_for_timeout(100)
    assert held
    page.wait_for_timeout(300)
    assert page.locator("#shell-topbar-stats").inner_text() == numbers
    assert page.evaluate("document.documentElement.classList.contains('qym-shell-pending')") is False
    # Before the shell is built, shell.css hides the page behind its frame.
    hidden = page.evaluate("""() => {
      const probe = document.createElement('div');
      document.documentElement.classList.add('qym-shell-pending');
      document.body.appendChild(probe);
      const visibility = getComputedStyle(probe).visibility;
      probe.remove();
      document.documentElement.classList.remove('qym-shell-pending');
      return visibility;
    }""")
    assert hidden == "hidden"

    page.unroute("**/api/dashboard/runs*")
    for route in held:
        app._forward(route)
    _runs_ready(page)
    assert page.locator("#shell-topbar-stats").inner_text() == numbers


def test_run_header_links_and_export(app):
    data = app.client.get("/api/runs/run-000?view=compact").json()["run"]
    assert (data["dataset_slug"], data["dataset_version"]) == ("golden-set", "v1")
    assert app.client.get("/api/runs/run-001?view=compact").json()["run"]["dataset_slug"] is None

    page = app.goto("/projects/pa/runs/run-000")
    page.locator(".hero-meta-link").first.wait_for()
    links = dict(
        page.evaluate(
            "() => [...document.querySelectorAll('.hero-meta-item')].map(item => [item.querySelector('.hero-meta-label').textContent.trim(), item.querySelector('a.hero-meta-link')?.getAttribute('href') || null])"
        )
    )
    assert links["Dataset"] == "/projects/pa/datasets/golden-set?tab=runs&v=v1"
    assert links["Model"] == "/projects/pa?model=m-a"
    assert links["Task"] == "/projects/pa?task=support-qa"
    assert links["Owner"] == "/projects/pa?owner=dev"
    assert page.locator("#export-share-btn").inner_text().strip() == "Export HTML"
    assert page.locator("#copy-run-link-btn").count() == 0

    page = app.goto("/projects/pa/runs/run-001")
    page.locator(".hero-meta-link").first.wait_for()
    dataset = page.locator(".hero-meta-item", has_text="Dataset").locator("a.hero-meta-link")
    # A label-only dataset opens the Runs list filtered to it.
    assert dataset.get_attribute("href") == "/projects/pa?dataset=golden"
    page.locator(".hero-meta-item", has_text="Model").locator("a.hero-meta-link").click()
    page.wait_for_function("() => location.pathname === '/projects/pa' && location.search === '?model=m-b'")
    _runs_ready(page)
    assert page.locator("#filter-model-btn").inner_text().strip() == "m-b"
    assert "35 of 70" in page.locator("#status-filter").inner_text()


def test_item_link_opens_lands_and_copies(app):
    page = app.goto("/projects/pa/runs/run-001?item=item-22")
    card = page.locator('#items-grid .item-card[data-item-id="item-22"]')
    card.wait_for()
    assert "item-collapsed" not in card.get_attribute("class")
    page.wait_for_function(
        """() => {
          const card = document.querySelector('#items-grid .item-card[data-item-id="item-22"]');
          const host = document.querySelector('.run-container');
          const top = card.getBoundingClientRect().top - host.getBoundingClientRect().top;
          return card.classList.contains('item-card--target') && top >= 0 && top < host.clientHeight / 2;
        }"""
    )
    _stub_clipboard(page)
    card.locator('[data-copy-item-link="item-22"]').click()
    page.wait_for_function("() => window.__copied.length === 1")
    assert page.evaluate("window.__copied[0]") == "http://qym.test/projects/pa/runs/run-001?item=item-22"

    # Opening another item names it in the address bar; closing it removes it.
    other = page.locator('#items-grid .item-card.item-collapsed').first
    other_id = other.get_attribute("data-item-id")
    other.click()
    page.wait_for_function(f"() => new URLSearchParams(location.search).get('item') === {json.dumps(other_id)}")
    page.locator(f'#items-grid .item-card[data-item-id="{other_id}"] .item-header-expand').click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('item')")


def test_back_to_a_run_restores_scroll_instead_of_jumping_to_the_open_item(app):
    app.page.set_viewport_size({"width": 1280, "height": 640})
    page = app.goto("/projects/pa/runs/run-001")
    page.locator("#items-grid .item-card.item-collapsed").first.click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('item') === 'item-0'")
    host = page.locator(".run-container")
    host.evaluate("node => { node.scrollTop = node.scrollHeight; }")
    page.wait_for_timeout(400)
    target = host.evaluate("node => node.scrollTop")
    assert target > 300
    # A click that does not scroll the header into view first (the reader
    # leaves from where they are).
    page.locator(".hero-meta-item", has_text="Model").locator("a.hero-meta-link").evaluate("link => link.click()")
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa/runs/run-001'")
    page.locator('#items-grid .item-card[data-item-id="item-0"] .item-input-row').wait_for()
    page.wait_for_function(
        f"() => Math.abs(document.querySelector('.run-container').scrollTop - {target}) <= 2"
    )
    # The open item must not pull the reader away once the position holds.
    page.wait_for_timeout(1500)
    assert abs(page.locator(".run-container").evaluate("node => node.scrollTop") - target) <= 2


def test_compare_view_round_trips_through_its_url(app):
    page = app.goto("/compare?runs=run-001&runs=run-002&sort=score_desc&item=item-3")
    header = page.locator('#items-grid [data-item-expand="item-3"][aria-expanded="true"]')
    header.wait_for()
    assert page.locator("#sort-select").input_value() == "score_desc"
    params = page.evaluate("[...new URLSearchParams(location.search)]")
    assert params == [["runs", "run-001"], ["runs", "run-002"], ["sort", "score_desc"], ["item", "item-3"]]
    hrefs = page.locator(".qym-output-card__link").evaluate_all("links => links.map(link => link.getAttribute('href'))")
    assert hrefs[:2] == [
        "http://qym.test/projects/pa/runs/run-001?item=item-3",
        "http://qym.test/projects/pa/runs/run-002?item=item-3",
    ]
    page.evaluate("() => { const s = document.getElementById('sort-select'); s.value = 'index'; s.dispatchEvent(new Event('change')); }")
    page.wait_for_function("() => !new URLSearchParams(location.search).has('sort')")
    assert page.locator("#export-share-btn").inner_text().strip() == "Export HTML"
    _stub_clipboard(page)
    page.locator("#copy-compare-link-btn").click()
    page.wait_for_function("() => window.__copied.length === 1")
    assert page.evaluate("window.__copied[0]") == "http://qym.test/compare?runs=run-001&runs=run-002&item=item-3"


def test_reviews_keep_filters_in_the_url_and_link_to_the_run_item(app):
    corrections = app.client.get("/api/corrections").json()["corrections"]
    assert {c["project_slug"] for c in corrections} == {"pa"}
    target = sorted(c["id"] for c in corrections)[1]

    page = app.goto(f"/reviews?id={target}")
    card = page.locator(f'.correction-card[data-id="{target}"]')
    card.wait_for()
    page.wait_for_function(f"() => document.querySelector('.correction-card[data-id=\"{target}\"]').classList.contains('correction-card--target')")
    # Global queue: each card says its project; the Run chip opens the item.
    assert card.locator("a.context-chip--link", has_text="Support bot").get_attribute("href") == "/projects/pa/reviews"
    item_id = next(c["item_id"] for c in corrections if c["id"] == target)
    assert card.locator("a.context-chip--link", has_text="Run 001").get_attribute("href") == f"/projects/pa/runs/run-001?item={item_id}"

    page = app.goto("/projects/pa/reviews")
    page.locator(".correction-card").first.wait_for()
    assert page.locator("a.context-chip--link", has_text="Support bot").count() == 0
    page.locator("#search-input").fill("item-2")
    page.wait_for_function("() => new URLSearchParams(location.search).get('q') === 'item-2'")
    page.locator('.stat-card[data-filter="pending"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('status') === 'pending'")

    fresh = app.goto("/projects/pa/reviews?status=pending&q=item-2")
    fresh.locator(".correction-card").first.wait_for()
    assert fresh.locator("#search-input").input_value() == "item-2"
    assert fresh.locator('.stat-card[data-filter="pending"]').get_attribute("class").count("active") == 1
    assert fresh.locator(".correction-card").count() == 1


def _listener_counts(cdp):
    counts = {}
    for target in ("document", "window"):
        handle = cdp.send("Runtime.evaluate", {"expression": target})["result"]["objectId"]
        for listener in cdp.send("DOMDebugger.getEventListeners", {"objectId": handle})["listeners"]:
            key = f"{target}:{listener['type']}"
            counts[key] = counts.get(key, 0) + 1
    return counts


def test_spa_navigation_leaves_no_listeners_or_stale_handlers(app):
    page = app.goto("/projects/pa")
    _runs_ready(page)
    cdp = app.context.new_cdp_session(page)
    route = [
        ("/projects/pa/charts", "a.chart-bar-label"),
        ("/projects/pa/overview", "#pending-reviews-body"),
        ("/projects/pa/runs/run-001", "#items-grid .item-card"),
        ("/compare?runs=run-001&runs=run-002", "#items-grid [data-item-expand]"),
        ("/projects/pa/reviews", ".correction-card"),
        ("/projects/pa/datasets", "a.dsx-card"),
        ("/projects/pa", "#runs-tbody a.run-id"),
    ]

    def cycle():
        for url, ready in route:
            page.evaluate(f"QymShell.navigateTo({json.dumps(url)})")
            page.locator(ready).first.wait_for()
            page.wait_for_timeout(250)
            for key in ("j", "k", "?", "Escape", "/", "Escape"):
                page.keyboard.press(key)
        _runs_ready(page)

    cycle()
    after_one = _listener_counts(cdp)
    cycle()
    cycle()
    assert _listener_counts(cdp) == after_one
    # Shared document keydown listeners, each installed once: the shell's
    # and ui_components.js's, including the scroll hold's (a key on a
    # control keeps it in place while the page redraws). Pages add none.
    assert after_one.get("document:keydown", 0) <= 4

    # No runs-list handler survives on the run page: arrow keys scroll it.
    page.evaluate("QymShell.navigateTo('/projects/pa/runs/run-001')")
    page.locator("#items-grid .item-card").first.wait_for()
    page.wait_for_timeout(300)
    prevented = page.evaluate(
        "() => { const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); document.body.dispatchEvent(event); return event.defaultPrevented; }"
    )
    assert prevented is False


def test_latest_click_wins_while_a_navigation_is_in_flight(app):
    page = app.goto("/projects/pa")
    _runs_ready(page)
    held = []
    page.route("**/projects/pa/datasets", lambda route: held.append(route))
    page.evaluate("QymShell.navigateTo('/projects/pa/datasets')")
    page.wait_for_function("() => document.getElementById('shell-content').classList.contains('is-navigating')")
    page.evaluate("QymShell.navigateTo('/projects/pa/charts')")
    page.wait_for_url("**/projects/pa/charts")
    page.locator("a.chart-bar-label").first.wait_for()
    page.unroute("**/projects/pa/datasets")
    for route in held:
        try:
            route.abort()
        except Exception:
            pass
    page.wait_for_timeout(300)
    assert page.url.endswith("/projects/pa/charts")
    assert page.locator("#charts-grid").count() == 1


def test_a_link_with_only_a_sort_or_page_ignores_the_tabs_saved_filters(app):
    # The tab remembers a model filter (sessionStorage) ...
    page = app.goto("/projects/pa?model=m-b")
    _runs_ready(page)
    assert page.locator("#runs-tbody a.run-id").count() == RUNS // 2
    page.evaluate("QymShell.navigateTo('/projects/pa/overview')")
    page.locator("#pending-reviews-body").wait_for()

    # ... but a shared link that carries only a sort and page (written with
    # no filters) opens exactly that view: all runs, sorted by name.
    page.goto("http://qym.test/projects/pa?sort=run-asc&page=2")
    _runs_ready(page)
    assert page.evaluate("Object.fromEntries(new URLSearchParams(location.search))") == {
        "sort": "run-asc", "page": "2",
    }
    assert page.locator("#runs-tbody a.run-id").first.inner_text() == "run-050"

    # A bare URL (the sidebar link) still restores the tab's filters.
    page.goto("http://qym.test/projects/pa?model=m-b")
    _runs_ready(page)
    page.goto("http://qym.test/projects/pa")
    _runs_ready(page)
    assert page.locator("#filter-model-btn").inner_text().strip() == "m-b"


def _scrolled_ancestor_top(page, selector):
    return page.evaluate(
        """selector => {
          let node = document.querySelector(selector);
          let top = 0;
          while (node && node !== document.body) { top = Math.max(top, node.scrollTop); node = node.parentElement; }
          return top;
        }""",
        selector,
    )


def test_back_to_a_shared_item_left_at_the_top_stays_at_the_top(app):
    # The reader opened a shared item link, scrolled back to the top and
    # left: Back returns to the top, not to the item again.
    app.page.set_viewport_size({"width": 1280, "height": 640})
    page = app.goto("/projects/pa/runs/run-001?item=item-22")
    page.wait_for_function(
        "() => document.querySelector('#items-grid .item-card[data-item-id=\"item-22\"]')?.classList.contains('item-card--target')"
    )
    host = page.locator(".run-container")
    assert host.evaluate("node => node.scrollTop") > 300
    host.evaluate("node => { node.scrollTop = 0; }")
    page.wait_for_timeout(400)
    page.locator(".hero-meta-item", has_text="Model").locator("a.hero-meta-link").click()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa/runs/run-001'")
    page.locator('#items-grid .item-card[data-item-id="item-22"] .item-input-row').wait_for()
    page.wait_for_timeout(1500)
    assert page.locator(".run-container").evaluate("node => node.scrollTop") == 0


def test_back_to_a_review_link_keeps_the_readers_place(app, factory):
    with factory() as db:
        for i in range(3, 24):
            db.add(
                ReviewCorrection(
                    run_id="run-002",
                    item_id=f"item-{i}",
                    metric_name="accuracy",
                    task="support-qa",
                    ai_root_cause="Reasoning",
                    human_root_cause="Retrieval",
                    corrected_by_user_id="dev",
                    input_snapshot=f"Question {i}",
                    output_snapshot=f"Output {i}",
                )
            )
        db.commit()
    app.page.set_viewport_size({"width": 1280, "height": 640})
    page = app.goto("/projects/pa/reviews")
    page.locator(".correction-card").first.wait_for()
    assert page.locator(".correction-card[data-id]").count() >= 20
    last = page.locator(".correction-card[data-id]").last.get_attribute("data-id")
    selector = f'.correction-card[data-id="{last}"]'

    page = app.goto(f"/projects/pa/reviews?id={last}")
    page.wait_for_function(
        f"() => document.querySelector('{selector}')?.classList.contains('correction-card--target')"
    )
    page.wait_for_timeout(300)
    assert _scrolled_ancestor_top(page, selector) > 300
    # Back at the top, the reader opens a run item from the first card.
    page.evaluate(
        """selector => {
          let node = document.querySelector(selector);
          while (node && node !== document.body) { node.scrollTop = 0; node = node.parentElement; }
        }""",
        selector,
    )
    page.wait_for_timeout(400)
    page.locator(".correction-card").first.locator("a.context-chip--link").first.click()
    page.wait_for_function("() => location.pathname.startsWith('/projects/pa/runs/')")
    page.locator("#items-grid .item-card").first.wait_for()
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa/reviews'")
    page.locator(selector).wait_for()
    page.wait_for_timeout(1500)
    assert _scrolled_ancestor_top(page, selector) == 0
    assert page.locator(".correction-card--target").count() == 0


def test_back_to_a_compare_item_left_at_the_top_stays_at_the_top(app):
    app.page.set_viewport_size({"width": 1280, "height": 640})
    page = app.goto("/compare?runs=run-001&runs=run-002&item=item-12")
    selector = '#items-grid [data-item-expand="item-12"]'
    page.locator(selector + '[aria-expanded="true"]').wait_for()
    page.wait_for_timeout(800)
    assert _scrolled_ancestor_top(page, selector) > 300
    page.evaluate(
        """selector => {
          let node = document.querySelector(selector);
          while (node && node !== document.body) { node.scrollTop = 0; node = node.parentElement; }
        }""",
        selector,
    )
    page.wait_for_timeout(400)
    page.locator(".qym-output-card__link").first.evaluate("link => link.click()")
    page.wait_for_function("() => location.pathname.startsWith('/projects/pa/runs/')")
    page.locator("#items-grid .item-card").first.wait_for()
    page.go_back()
    page.wait_for_function("() => location.pathname === '/compare'")
    page.locator(selector).wait_for()
    page.wait_for_timeout(1500)
    assert _scrolled_ancestor_top(page, selector) == 0
