"""Run page navigation and view state, against the real app (P1 round 2).

- C044 part 1: previous / next run arrows in the run header follow the Runs
  list order the reader came from (filters, search and sort, across page
  ends); a direct link follows the default order. Real links, reachable with
  Tab, disabled at the ends.
- C045: the run page's item filters, search, sort, page and Display layout
  live in the URL and open on the first paint; the Overview trend range and
  its picked task live in the URL.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from urllib.parse import parse_qs, quote, urlparse

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
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

RUNS = 66
ITEMS = 25
MODELS = ("acme/m-alpha", "m-beta", "zeta/m-gamma")


def _status(n):
    return RunWorkflowStatus.FAILED if n % 7 == 3 else RunWorkflowStatus.COMPLETED


@pytest.fixture()
def factory(monkeypatch):
    from qym_platform.tools import seed_chart_showcase as showcase

    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    now = datetime.utcnow().replace(microsecond=0)
    with make() as db:
        db.add_all(
            [
                User(id="dev", email="dev@local", display_name="Dev", role=UserRole.ADMIN),
                Project(id="pa", name="Support bot", slug="pa", created_by_user_id="dev"),
            ]
        )
        db.flush()
        for n in range(RUNS):
            run_id = f"run-{n:03d}"
            started = now - timedelta(hours=n + 1)
            db.add(
                Run(
                    id=run_id,
                    project_id="pa",
                    created_by_user_id="dev",
                    owner_user_id="dev",
                    task="support-qa" if n % 2 == 0 else "sql-gen",
                    dataset="golden" if n % 4 < 2 else "hard",
                    model=MODELS[n % 3],
                    metrics=["accuracy", "faithfulness"],
                    run_metadata={},
                    run_config={"run_name": f"Run {n:03d}"},
                    status=_status(n),
                    started_at=started,
                    ended_at=started + timedelta(minutes=2),
                    created_at=started,
                )
            )
            db.flush()
            db.add(RunMetricSpec(run_id=run_id, metric_name="accuracy", position=0, score_type="boolean", direction="maximize"))
            db.add(RunMetricSpec(run_id=run_id, metric_name="faithfulness", position=1, score_type="score", direction="maximize"))
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
                        item_metadata={"complexity": ("easy", "medium", "hard")[i % 3]},
                    )
                )
                db.add(RunItemScore(run_id=run_id, item_id=f"item-{i}", metric_name="accuracy",
                                    score_numeric=float((i + n) % 2), score_raw=float((i + n) % 2)))
                db.add(RunItemScore(run_id=run_id, item_id=f"item-{i}", metric_name="faithfulness",
                                    score_numeric=(i % 10) / 10, score_raw=(i % 10) / 10))
        db.commit()
        # A repeat run (5 passes) for the Display layout.
        showcase._seed_profile(db, db.get(Project, "pa"), showcase.PROFILES[0], now - timedelta(days=5))
        db.commit()
    _publish(make)
    yield make
    engine.dispose()


@pytest.fixture()
def app(browser, factory):  # noqa: F811
    instance = App(browser, factory)
    instance.context.set_default_timeout(20000)
    instance.page.set_default_timeout(20000)
    yield instance
    instance.close()
    assert instance.errors == [], instance.errors


def _runs_ready(page):
    page.locator("#runs-tbody a.run-id").first.wait_for()
    page.wait_for_function("() => document.getElementById('table-view')?.getAttribute('aria-busy') !== 'true'")


def _row_ids(page):
    hrefs = page.locator("#runs-tbody a.run-id").evaluate_all("links => links.map(link => link.getAttribute('href'))")
    return [urlparse(href).path.rsplit("/", 1)[-1] for href in hrefs], hrefs


def _pager_ready(page, run_id):
    page.wait_for_function(
        "runId => location.pathname.endsWith('/runs/' + runId) && document.querySelector('#run-pager-pos .hero-pager__num')",
        arg=run_id,
    )
    return page.locator("#run-pager-pos").inner_text().strip()


def _step(page, which):
    return page.locator(f'#run-pager [data-run-pager="{which}"]')


def test_arrows_step_through_the_runs_list_order_across_its_pages(app):
    app.page.set_viewport_size({"width": 1280, "height": 900})
    page = app.goto("/projects/pa?status=COMPLETED&sort=model-desc")
    _runs_ready(page)
    page.evaluate("window.__noReload = true")
    first_page, hrefs = _row_ids(page)
    context = quote("status=COMPLETED&sort=model-desc", safe="")
    # Every run link carries the list it came from (C044).
    assert all(href.endswith("?list=" + context) for href in hrefs), hrefs[:2]
    page.locator('#table-pagination [aria-label="Next page"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('page') === '2'")
    _runs_ready(page)
    second_page, _ = _row_ids(page)
    order = first_page + second_page
    total = sum(1 for n in range(RUNS) if _status(n) == RunWorkflowStatus.COMPLETED) + 1
    assert len(first_page) == 50 and len(order) == total
    page.locator('#table-pagination [aria-label="Previous page"]').click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('page')")
    _runs_ready(page)

    # The last run of page 1: its next run is the first of page 2.
    page.locator("#runs-tbody a.run-id").nth(49).click()
    assert _pager_ready(page, order[49]) == f"50 of {total}"
    assert _step(page, "previous").get_attribute("href") == f"/projects/pa/runs/{order[48]}?list={context}"
    assert _step(page, "next").get_attribute("href") == f"/projects/pa/runs/{order[50]}?list={context}"
    assert _step(page, "next").get_attribute("aria-label") == f"Next run: Run {order[50][4:]}"
    assert "you came from" in page.locator("#run-pager-pos").get_attribute("title")

    # Keyboard: Tab from the header actions reaches the arrows; Enter follows.
    page.locator("#export-share-btn").focus()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.dataset.runPager") == "previous"
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.dataset.runPager") == "next"
    page.keyboard.press("Enter")
    assert _pager_ready(page, order[50]) == f"51 of {total}"
    assert urlparse(page.url).query == "list=" + context

    _step(page, "next").click()
    assert _pager_ready(page, order[51]) == f"52 of {total}"
    _step(page, "previous").click()
    _step(page, "previous").wait_for()
    assert _pager_ready(page, order[50]) == f"51 of {total}"
    # In-app navigation all the way: no full reload.
    assert page.evaluate("window.__noReload === true")


def test_a_direct_link_uses_the_default_order_and_the_ends_are_disabled(app):
    newest = "run-000"
    page = app.goto(f"/projects/pa/runs/{newest}")
    total = RUNS + 1
    assert _pager_ready(page, newest) == f"1 of {total}"
    assert "newest first" in page.locator("#run-pager-pos").get_attribute("title")
    previous = _step(page, "previous")
    assert previous.get_attribute("href") is None
    assert previous.get_attribute("aria-disabled") == "true"
    assert previous.get_attribute("aria-label") == "No previous run"
    # A direct link carries no list: the arrows link plain run URLs.
    assert _step(page, "next").get_attribute("href") == "/projects/pa/runs/run-001"
    # A disabled arrow is not a Tab stop.
    page.locator("#export-share-btn").focus()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.dataset.runPager") == "next"

    # The oldest run is the showcase run (five days back): no next run.
    oldest = "showcase-balanced-analysis"
    page = app.goto(f"/projects/pa/runs/{oldest}")
    assert _pager_ready(page, oldest) == f"{total} of {total}"
    assert _step(page, "next").get_attribute("aria-disabled") == "true"
    assert _step(page, "previous").get_attribute("href") == f"/projects/pa/runs/run-{RUNS - 1:03d}"

    # The pager row is there from the first paint: its answer moves nothing.
    page = app.goto(f"/projects/pa/runs/{newest}")
    page.locator("#run-pager").wait_for()
    before = page.evaluate("() => [document.querySelector('.run-summary-card').getBoundingClientRect().height, document.querySelector('.hero-meta-grid').getBoundingClientRect().top]")
    _pager_ready(page, newest)
    after = page.evaluate("() => [document.querySelector('.run-summary-card').getBoundingClientRect().height, document.querySelector('.hero-meta-grid').getBoundingClientRect().top]")
    assert before == after


def test_the_pager_previews_each_arrow_and_follows_j_and_k(app):
    """One capsule, ‹ position ›: hovering an arrow previews the run it opens
    (name, model, primary metric, its key); J and K step through the list,
    except while typing. The arrows hold still from run to run."""
    page = app.goto("/projects/pa/runs/run-001")
    assert _pager_ready(page, "run-001") == f"2 of {RUNS + 1}"
    page.evaluate("window.__noReload = true")
    before = _step(page, "next").bounding_box()

    _step(page, "next").hover()
    peek = page.locator("#run-pager-peek.is-open")
    peek.wait_for()
    text = peek.inner_text()
    assert "Next run" in text and "Run 002" in text, text
    assert "m-gamma" in text and "accuracy" in text, text
    assert page.locator("#run-pager-peek .hero-pager__key").inner_text() == "J"
    assert _step(page, "next").get_attribute("title") is None  # no second tooltip
    page.mouse.move(5, 5)
    page.wait_for_function("() => !document.querySelector('#run-pager-peek.is-open')")

    page.keyboard.press("j")
    assert _pager_ready(page, "run-002") == f"3 of {RUNS + 1}"
    assert _step(page, "next").bounding_box() == before
    page.keyboard.press("k")
    assert _pager_ready(page, "run-001") == f"2 of {RUNS + 1}"

    # Typing a J in a field types it.
    search = page.locator("#items-search")
    search.focus()
    page.keyboard.press("j")
    page.wait_for_timeout(300)
    assert urlparse(page.url).path.endswith("/runs/run-001")
    assert page.evaluate("window.__noReload === true")


def test_a_run_no_longer_in_its_list_falls_back_to_the_default_order(app):
    failed = next(f"run-{n:03d}" for n in range(RUNS) if _status(n) == RunWorkflowStatus.FAILED)
    page = app.goto(f"/projects/pa/runs/{failed}?list=" + quote("status=COMPLETED", safe=""))
    position = _pager_ready(page, failed)
    assert position == f"{int(failed[4:]) + 1} of {RUNS + 1}"
    assert "no longer in the Runs list" in page.locator("#run-pager-pos").get_attribute("title")
    # The default order's links carry no list.
    assert "?" not in _step(page, "next").get_attribute("href")


VIEW_URL_STATE = "() => Object.fromEntries(new URLSearchParams(location.search))"


def test_run_view_lives_in_the_url_and_opens_on_the_first_paint(app):
    page = app.goto("/projects/pa/runs/run-003")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.evaluate(VIEW_URL_STATE) == {}

    page.fill("#items-search", "Question 1")
    page.wait_for_function("() => new URLSearchParams(location.search).get('q') === 'Question 1'")
    page.evaluate("""() => {
      const sort = document.getElementById('sort-select');
      sort.value = 'latency_desc';
      sort.dispatchEvent(new Event('change'));
      const metric = document.getElementById('items-metric-select');
      metric.value = 'faithfulness';
      metric.dispatchEvent(new Event('change'));
    }""")
    page.locator('.dist-chart-col[data-metric="faithfulness"][data-bucket-min]').nth(1).click()
    page.wait_for_function("() => new URLSearchParams(location.search).has('filters')")
    state = page.evaluate(VIEW_URL_STATE)
    assert state["q"] == "Question 1" and state["sort"] == "latency_desc"
    assert state["metric"] == "faithfulness"
    assert json.loads(state["filters"]) == {"score": [0.1, 0.2]}
    count = page.locator("#filter-count").inner_text()
    assert count.startswith("2 of 25")  # items 1 and 11

    # A new tab on that URL opens the same view, filtered from the first paint.
    url = page.url
    app.page.add_init_script("""(() => {
      window.__firstCounts = [];
      new MutationObserver(() => {
        const node = document.getElementById('filter-count');
        if (node && node.textContent.trim()) window.__firstCounts.push(node.textContent.trim());
      }).observe(document, {childList: true, subtree: true, characterData: true});
    })()""")
    page = app.goto(urlparse(url).path + "?" + urlparse(url).query)
    page.locator("#items-grid .item-card").first.wait_for()
    page.wait_for_timeout(300)
    assert page.evaluate("window.__firstCounts[0]") == count
    assert page.input_value("#items-search") == "Question 1"
    assert page.input_value("#sort-select") == "latency_desc"
    assert page.input_value("#items-metric-select") == "faithfulness"
    assert page.evaluate(VIEW_URL_STATE) == state
    assert page.locator("#items-grid .item-card").first.get_attribute("data-item-id") == "item-11"

    # Clear puts the default view back, and the URL with it.
    page.locator("#clear-all-btn").click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('filters')")
    assert page.evaluate(VIEW_URL_STATE) == {"metric": "faithfulness"}


def test_a_chart_click_filter_shows_in_the_filters_panel_and_removes_from_there(app):
    page = app.goto("/projects/pa/runs/run-003?metric=faithfulness")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#active-filter-count").inner_text().strip() == "0"

    page.locator('.dist-chart-col[data-metric="faithfulness"][data-bucket-min]').nth(1).click()
    page.wait_for_function("() => new URLSearchParams(location.search).has('filters')")
    assert page.locator("#active-filter-count").inner_text().strip() == "1"

    page.locator("#btn-item-filters").click()
    chips = page.locator("#filter-builder-page [data-fb-page]")
    assert chips.count() == 1
    assert chips.first.inner_text().startswith("faithfulness 10–20%")
    assert page.locator("#builder-rule-count").inner_text() == "1 from the page"

    # A second filter set from the page joins it while the panel is open.
    page.keyboard.press("Escape")
    page.locator(".dist-chart-col[data-lat-min]").first.click()
    page.locator("#btn-item-filters").click()
    assert chips.count() == 2
    assert page.locator("#active-filter-count").inner_text().strip() == "2"

    # Removing a chip clears that filter only; the panel stays open.
    chips.first.click()
    page.wait_for_function("() => !(new URLSearchParams(location.search).get('filters') || '').includes('score')")
    assert page.locator("#item-filter-builder").is_visible()
    assert chips.count() == 1
    assert page.locator("#active-filter-count").inner_text().strip() == "1"
    chips.first.click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('filters')")
    assert page.locator("#filter-builder-page").is_hidden()
    assert page.locator("#builder-rule-count").inner_text() == "no rules yet"
    assert page.locator("#filter-count").inner_text().startswith("25 of 25")


def test_rules_bar_filters_and_page_round_trip_through_the_url(app):
    rules = {"op": "and", "children": [{"field": "latency", "oper": "gte", "value": 110}]}
    filters = quote(json.dumps({"rules": rules, "complexity": ["easy", "hard"]}), safe="")
    page = app.goto(f"/projects/pa/runs/run-003?filters={filters}")
    page.locator("#items-grid .item-card").first.wait_for()
    # Latency 110..124 (items 10-24) that are easy or hard: 10 items.
    assert page.locator("#filter-count").inner_text().startswith("10 of 25")
    # The Filters badge counts the rule and the complexity filter.
    assert page.locator("#active-filter-count").inner_text().strip() == "2"
    assert json.loads(page.evaluate(VIEW_URL_STATE)["filters"]) == {"rules": rules, "complexity": ["easy", "hard"]}

    # show= (a Pass / Fail bar click) and page= reopen as written.
    page = app.goto("/projects/pa/runs/run-003?show=failed")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#filter-count").inner_text().startswith("12 of 25")
    assert page.locator("#item-filter-banner").is_visible()
    # The pass threshold of the analysis metric decides what "failed" holds.
    page = app.goto("/projects/pa/runs/run-003?metric=faithfulness&threshold=60&show=failed")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#filter-count").inner_text().startswith("17 of 25")
    assert page.locator("#threshold-value").inner_text() == "60%"
    assert page.evaluate(VIEW_URL_STATE) == {"metric": "faithfulness", "threshold": "60", "show": "failed"}
    page = app.goto("/projects/pa/runs/run-003?page=2")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#items-grid .item-card").first.get_attribute("data-item-id") == "item-20"
    page.locator('#pagination [aria-label="Previous page"]').click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('page')")

    # A broken or foreign view in the URL is ignored, never an error. A
    # threshold means nothing for a pass / fail metric (accuracy).
    page = app.goto("/projects/pa/runs/run-003?filters=%7Bnot-json&sort=evil&metric=nope&show=x&view=heatmap&page=-4&threshold=60")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#filter-count").inner_text().startswith("25 of 25")
    assert page.evaluate(VIEW_URL_STATE) == {}


def test_the_display_layout_of_a_repeat_run_lives_in_the_url(app):
    run_id = "showcase-balanced-analysis"
    page = app.goto(f"/projects/pa/runs/{run_id}?view=heatmap")
    page.wait_for_selector("#items-grid.heatmap-mode")
    assert page.locator('[data-items-view="heatmap"]').get_attribute("aria-pressed") == "true"
    page.click("#btn-item-display")
    page.locator('[data-items-view="cards"]').click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('view')")
    page.locator('[data-items-view="heatmap"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('view') === 'heatmap'")


def test_back_from_the_next_run_restores_the_view_of_the_one_before(app):
    page = app.goto("/projects/pa/runs/run-003?list=" + quote("sort=time-asc", safe=""))
    _pager_ready(page, "run-003")
    page.fill("#items-search", "Question 2")
    page.wait_for_function("() => new URLSearchParams(location.search).get('q') === 'Question 2'")
    count = page.locator("#filter-count").inner_text()
    # time-asc lists the oldest first: after run-003 comes the newer run-002.
    _step(page, "next").click()
    _pager_ready(page, "run-002")
    assert page.input_value("#items-search") == ""
    page.go_back()
    _pager_ready(page, "run-003")
    # The path changes before the shell swaps the page in, and the outgoing
    # run's pager and cards match the selectors above until it does: wait for
    # the restored view itself, not for elements both pages share.
    page.wait_for_function("() => document.querySelector('#items-search')?.value === 'Question 2'")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.input_value("#items-search") == "Question 2"
    assert page.locator("#filter-count").inner_text() == count
    assert parse_qs(urlparse(page.url).query)["list"] == ["sort=time-asc"]


def test_overview_range_and_trend_task_live_in_the_url(app):
    page = app.goto("/projects/pa/overview?range=30d")
    page.wait_for_function("document.querySelectorAll('#trend-chart .ovt-hit').length === 30")
    assert page.locator('#trend-range [data-days="30"]').get_attribute("aria-pressed") == "true"
    page.locator('#trend-range [data-days="90"]').click()
    page.wait_for_function("document.querySelectorAll('#trend-chart .ovt-hit').length === 90")
    assert page.evaluate(VIEW_URL_STATE) == {"range": "90d"}

    options = page.locator("#trend-task option").all_text_contents()
    assert len(options) > 1
    page.locator("#trend-task").select_option(index=1)
    page.wait_for_function("() => new URLSearchParams(location.search).has('task')")
    state = page.evaluate(VIEW_URL_STATE)
    task, dataset = re.match(r"(.+) · (.+) \(\d+\)", options[1]).groups()
    assert state == {"range": "90d", "task": task, "dataset": dataset}
    subtitle = page.locator("#trend-subtitle").inner_text()

    page = app.goto("/projects/pa/overview?" + "&".join(f"{k}={quote(v)}" for k, v in state.items()))
    page.wait_for_function("document.querySelectorAll('#trend-chart .ovt-hit').length === 90")
    assert page.locator('#trend-range [data-days="90"]').get_attribute("aria-pressed") == "true"
    assert page.locator("#trend-subtitle").inner_text() == subtitle
    page.locator('#trend-range [data-days="7"]').click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('range')")
    assert page.evaluate(VIEW_URL_STATE) == {"task": task, "dataset": dataset}


# Review fixes (P1 round 2) ----------------------------------------------------


def test_a_one_sided_custom_range_reaches_the_run_page_and_survives_a_reload(app):
    """The Range picker allows a start date alone. The list bounds the runs on
    that side; a reload, a shared link and the run page's arrows must too."""
    page = app.goto("/projects/pa")
    _runs_ready(page)
    since = page.evaluate("() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA'); }")
    page.locator('.filter-btn[data-filter="custom"]').click()
    page.fill("#time-range-from", since)
    page.locator("#time-range-apply").click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('from')")
    _runs_ready(page)
    expected = page.evaluate(
        """async since => {
          const [y, m, d] = since.split('-').map(Number);
          const response = await fetch('/api/dashboard/runs', {method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({project_slug: 'pa', filters: {since: new Date(y, m - 1, d).toISOString()}, limit: 1})});
          return (await response.json()).total_runs;
        }""",
        since,
    )
    assert 1 < expected < RUNS + 1  # the range leaves some runs out

    # Reloading the list's URL keeps the range (it used to fall back to all).
    page = app.goto(f"/projects/pa?range=custom&from={since}")
    _runs_ready(page)
    assert page.evaluate(VIEW_URL_STATE) == {"range": "custom", "from": since}
    assert page.locator('.filter-btn[data-filter="custom"]').get_attribute("aria-pressed") == "true"
    first, hrefs = _row_ids(page)
    assert hrefs[0].endswith("?list=" + quote(f"range=custom&from={since}", safe=""))

    # The run page counts and steps through the same runs as the list.
    page.locator("#runs-tbody a.run-id").first.click()
    assert _pager_ready(page, first[0]) == f"1 of {expected}"
    assert "you came from" in page.locator("#run-pager-pos").get_attribute("title")


def test_a_pass_opened_from_the_list_carries_the_list(app):
    page = app.goto("/projects/pa?sort=run-desc")
    _runs_ready(page)
    run_id = "showcase-balanced-analysis"
    page.locator(f'.samples-toggle[data-run-id="{run_id}"]').click()
    page.locator('tr.pass-member[data-pass-number="2"]').first.click()
    page.wait_for_function("runId => location.pathname.endsWith('/runs/' + runId)", arg=run_id)
    params = parse_qs(urlparse(page.url).query)
    assert params["pass"] == ["2"] and params["list"] == ["sort=run-desc"]
    position = _pager_ready(page, run_id)
    assert "you came from" in page.locator("#run-pager-pos").get_attribute("title"), position


def _add_metadata_run(make, run_id="run-meta"):
    """A run whose items carry four metadata categories and metric fields."""
    now = datetime.utcnow().replace(microsecond=0)
    with make() as db:
        db.add(
            Run(
                id=run_id, project_id="pa", created_by_user_id="dev", owner_user_id="dev",
                task="support-qa", dataset="golden", model=MODELS[0], metrics=["faithfulness"],
                run_metadata={}, run_config={"run_name": "Metadata run"},
                status=RunWorkflowStatus.COMPLETED, started_at=now - timedelta(days=2),
                ended_at=now - timedelta(days=2) + timedelta(minutes=2), created_at=now - timedelta(days=2),
            )
        )
        db.flush()
        db.add(RunMetricSpec(run_id=run_id, metric_name="faithfulness", position=0, score_type="score", direction="maximize"))
        for i in range(12):
            db.add(
                RunItem(
                    run_id=run_id, item_id=f"item-{i}", index=i, input=f"Question {i}",
                    expected=f"Answer {i}", output=f"Output {i}", latency_ms=100 + i,
                    item_metadata={
                        "lang": ("en", "ar")[i % 2], "region": ("eu", "us", "asia")[i % 3],
                        "source": ("web", "api")[i % 2], "tier": ("gold", "silver", "bronze")[i % 3],
                    },
                )
            )
            db.add(
                RunItemScore(
                    run_id=run_id, item_id=f"item-{i}", metric_name="faithfulness",
                    score_numeric=(i % 10) / 10, score_raw=(i % 10) / 10,
                    meta={"judge": "j-1", "rationale": f"Because {i}"},
                )
            )
        db.commit()
    return run_id


def _field_checked(page, dropdown, key):
    return page.evaluate(
        "([dropdown, key]) => [...document.querySelectorAll('#' + dropdown + ' [data-field-key]')]"
        ".find(node => node.dataset.fieldKey === key)?.querySelector('input').checked",
        [dropdown, key],
    )


def test_display_columns_live_in_the_url(app, factory):
    """Display > Columns (the item and metric fields shown) is part of the
    Display tab, so it is in the URL like the layout and the metric."""
    run_id = _add_metadata_run(factory)
    page = app.goto(f"/projects/pa/runs/{run_id}?hide_field=lang&hide_field=nosuch&hide_metric_field=judge")
    page.locator("#items-grid .item-card").first.wait_for()
    assert _field_checked(page, "metadata-fields-dropdown", "lang") is False
    assert _field_checked(page, "metadata-fields-dropdown", "tier") is True
    assert _field_checked(page, "metric-meta-fields-dropdown", "judge") is False
    assert _field_checked(page, "metric-meta-fields-dropdown", "rationale") is True
    # An unknown field is ignored and dropped from the URL.
    assert parse_qs(urlparse(page.url).query) == {"hide_field": ["lang"], "hide_metric_field": ["judge"]}

    # Turning a field off (or back on) writes the URL.
    page.evaluate(
        "() => [...document.querySelectorAll('#metadata-fields-dropdown [data-field-key]')]"
        ".find(node => node.dataset.fieldKey === 'tier').querySelector('input').click()"
    )
    page.wait_for_function("() => new URLSearchParams(location.search).getAll('hide_field').includes('tier')")
    page.evaluate(
        "() => [...document.querySelectorAll('#metric-meta-fields-dropdown [data-field-key]')]"
        ".find(node => node.dataset.fieldKey === 'judge').querySelector('input').click()"
    )
    page.wait_for_function("() => !new URLSearchParams(location.search).has('hide_metric_field')")
    assert parse_qs(urlparse(page.url).query) == {"hide_field": ["lang", "tier"]}


def test_a_category_filter_in_the_url_shows_on_its_chip(app, factory):
    """A category filter only exists on a shown category (a chip click turns
    both off together). One from the URL selects its category, and a category
    this run does not have is ignored instead of hiding every item."""
    run_id = _add_metadata_run(factory)
    filters = quote(json.dumps({"categories": {"tier": ["gold"]}}), safe="")
    page = app.goto(f"/projects/pa/runs/{run_id}?filters={filters}")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#filter-count").inner_text().startswith("4 of 12")
    chip = page.locator('.category-chip[data-chip-key="tier"]')
    chip.wait_for()
    assert chip.get_attribute("aria-pressed") == "true"
    # The categories chosen by default stay shown.
    assert page.locator('.category-chip[data-chip-key="lang"]').get_attribute("aria-pressed") == "true"

    for foreign in ({"nosuch": ["x"]}, {"__proto__": ["x"]}):
        page = app.goto(f"/projects/pa/runs/{run_id}?filters=" + quote(json.dumps({"categories": foreign}), safe=""))
        page.locator("#items-grid .item-card").first.wait_for()
        assert page.locator("#filter-count").inner_text().startswith("12 of 12"), foreign
        assert page.evaluate(VIEW_URL_STATE) == {}, foreign


# Leftovers (P1 round 2 reviews) ----------------------------------------------

# A provider's whole error text, as an LLM API returns it: several KB.
LONG_ERROR = "RateLimitError: " + " ".join(f"quota detail {n} for org-123" for n in range(300))
SHORT_ERROR = "Timeout: no answer in 30 s"


def _add_error_run(make, run_id="run-errors"):
    """Twelve items: four fail with a long error, two with a short one."""
    now = datetime.utcnow().replace(microsecond=0)
    with make() as db:
        db.add(
            Run(
                id=run_id, project_id="pa", created_by_user_id="dev", owner_user_id="dev",
                task="support-qa", dataset="golden", model=MODELS[0], metrics=["faithfulness"],
                run_metadata={}, run_config={"run_name": "Errors run"},
                status=RunWorkflowStatus.COMPLETED, started_at=now - timedelta(days=3),
                ended_at=now - timedelta(days=3) + timedelta(minutes=2), created_at=now - timedelta(days=3),
            )
        )
        db.flush()
        db.add(RunMetricSpec(run_id=run_id, metric_name="faithfulness", position=0, score_type="score", direction="maximize"))
        for i in range(12):
            error = LONG_ERROR if i < 4 else SHORT_ERROR if i < 6 else None
            db.add(
                RunItem(
                    run_id=run_id, item_id=f"item-{i}", index=i, input=f"Question {i}",
                    expected=f"Answer {i}", output=None if error else f"Output {i}",
                    error=error, latency_ms=100 + i, item_metadata={},
                )
            )
            if not error:
                db.add(RunItemScore(run_id=run_id, item_id=f"item-{i}", metric_name="faithfulness",
                                    score_numeric=0.5, score_raw=0.5))
        db.commit()
    return run_id


def _error_card(page, title):
    return page.locator("#error-distribution-section .error-card").filter(
        has=page.locator(f'.error-card-title:text-is("{title}")')
    )


def test_an_error_card_filter_keeps_the_link_short_and_round_trips(app, factory):
    """C045: an Errors card filter is in the URL. A label of several KB went
    there whole, so a shared or reloaded link could pass a server's URL limit.
    A long label is now kept as its start plus a hash of the whole label, and
    a reload matches it back to the run's own error."""
    run_id = _add_error_run(factory)
    page = app.goto(f"/projects/pa/runs/{run_id}")
    page.locator("#items-grid .item-card").first.wait_for()
    _error_card(page, "RateLimitError").click()
    page.wait_for_function("() => new URLSearchParams(location.search).has('filters')")
    assert page.locator("#filter-count").inner_text().startswith("4 of 12")
    query = urlparse(page.url).query
    assert len(page.url) < 300, len(page.url)
    stored = json.loads(page.evaluate(VIEW_URL_STATE)["filters"])["errors"]["task"]
    assert stored["kind"] == "Task error" and "label" not in stored
    assert stored["prefix"] == LONG_ERROR[:40]
    assert re.fullmatch(r"[0-9a-z]+\.[0-9a-z]+", stored["hash"]), stored

    # A reload opens the same view: the same items, the card shown active,
    # and the URL written back unchanged.
    page = app.goto(f"/projects/pa/runs/{run_id}?{query}")
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#filter-count").inner_text().startswith("4 of 12")
    card = _error_card(page, "RateLimitError")
    assert card.get_attribute("aria-pressed") == "true"
    assert card.get_attribute("data-error-label") == LONG_ERROR
    assert urlparse(page.url).query == query

    # A short label stays readable in the URL, as before. (The cards count
    # the filtered items: turn the long one off first.)
    card.click()
    page.wait_for_function("() => !new URLSearchParams(location.search).has('filters')")
    _error_card(page, "Timeout").click()
    page.wait_for_function("() => (new URLSearchParams(location.search).get('filters') || '').includes('Timeout')")
    assert json.loads(page.evaluate(VIEW_URL_STATE)["filters"])["errors"]["task"] == {"kind": "Task error", "label": SHORT_ERROR}
    assert page.locator("#filter-count").inner_text().startswith("2 of 12")

    # A shortened label this run does not have is ignored, never applied.
    foreign = {"errors": {"task": {"kind": "Task error", "prefix": LONG_ERROR[:40], "hash": "zz.zz"}}}
    page = app.goto(f"/projects/pa/runs/{run_id}?filters=" + quote(json.dumps(foreign), safe=""))
    page.locator("#items-grid .item-card").first.wait_for()
    assert page.locator("#filter-count").inner_text().startswith("12 of 12")
    assert page.evaluate(VIEW_URL_STATE) == {}
