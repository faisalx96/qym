"""Dataset score cells take their colour from the metric's declared direction.

Every page colours a score only for a metric that declares a direction. The
datasets page reads that direction from its payloads: one run's row uses the
run's own direction, and a value that spans runs uses the direction its runs
share (None, and so no colour, when they disagree or declare none).
"""

import json
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.browser

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)

METRICS = ["acc", "lat", "mix"]
# 0.95 is a top score when higher is better and a bottom one when lower is.
TOP, BOTTOM, NEUTRAL = "metric-score score-5", "metric-score score-1", "metric-score"
SHARED = {"acc": "maximize", "lat": "minimize", "mix": None}
RUN_A = {"acc": "maximize", "lat": "minimize", "mix": "maximize"}
RUN_B = {"acc": "maximize", "lat": "minimize", "mix": "minimize"}


def _scores():
    return [
        {"metric_name": metric, "score_numeric": 0.95, "score_raw": None}
        for metric in METRICS
    ]


def _item_runs():
    return {
        "item": {"id": 1, "item_id": "case-1", "index": 0},
        "aggregates": {
            "run_count": 2,
            "error_count": 0,
            "metrics": {metric: {"avg": 0.95} for metric in METRICS},
            "metric_directions": SHARED,
        },
        "runs": [
            {
                "run_id": run_id,
                "run_name": run_id,
                "scores": _scores(),
                "metric_directions": dirs,
            }
            for run_id, dirs in (("run-a", RUN_A), ("run-b", RUN_B))
        ],
    }


ROUTES = [
    ("/items/case-1/runs", _item_runs()),
    (
        "/runs?",
        {
            "runs": [
                {
                    "id": run_id,
                    "run_name": run_id,
                    "status": "COMPLETED",
                    "version_label": "v1",
                    "metric_averages": {metric: 0.95 for metric in METRICS},
                    "metric_directions": dirs,
                }
                for run_id, dirs in (("run-a", RUN_A), ("run-b", RUN_B))
            ],
            "total": 2,
            "metric_names": METRICS,
        },
    ),
    (
        "/items?",
        {
            "items": [
                {
                    "id": 1,
                    "item_id": "case-1",
                    "index": 0,
                    "result_summary": {
                        "run_count": 2,
                        "metrics": {metric: {"avg": 0.95} for metric in METRICS},
                    },
                }
            ],
            "total": 1,
            "metric_names": METRICS,
            "metric_directions": SHARED,
        },
    ),
]


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
    page.evaluate(
        """routes => {
      window.toasts = [];
      window.QymShell = {apiUrl: path => path, toast: message => toasts.push(message),
        getProject: () => ({slug: 'project', name: 'Project'}), setBreadcrumbs: () => {},
        identicon: () => document.createElement('span')};
      window.QymAuth = {requireAuth: () => new Promise(() => {})};
      window.fetch = url => {
        const route = routes.find(([part]) => String(url).includes(part));
        return Promise.resolve(new Response(JSON.stringify(route ? route[1] : {}),
          {headers: {'content-type': 'application/json'}}));
      };
    }""",
        ROUTES,
    )
    page.add_script_tag(path=str(STATIC / "qym_safe.js"))
    page.add_script_tag(path=str(STATIC / "metrics.js"))
    page.add_script_tag(path=str(STATIC / "qym_table.js"))
    source = re.findall(
        r"<script(?:\s[^>]*)?>([\s\S]*?)</script>",
        (STATIC / "datasets.html").read_text(),
    )[-1]
    source = source.replace(
        "window.__dsx = { state,",
        "window.__dsx = { renderItemsTab, renderRunsTab, renderItemPageRuns, state,",
    )
    page.add_script_tag(content=source)
    page.evaluate(
        """() => Object.assign(__dsx.state, {mode: 'detail', slug: 'project',
      datasetRef: 'demo', versionLabel: 'v1',
      activeVersion: {id: 'v1', version: 'v1', status: 'published'}})"""
    )
    yield page
    assert errors == []
    assert page.evaluate("toasts") == []
    context.close()


def _classes(page, selector, count):
    """The class of each score in ``selector``, once ``count`` are drawn."""
    page.wait_for_function(
        "([selector, count]) => document.querySelectorAll(selector + ' .metric-score').length === count",
        arg=[selector, count],
    )
    return page.evaluate(
        "selector => [...document.querySelectorAll(selector + ' .metric-score')].map(node => node.className)",
        selector,
    )


def _run_rows(page, selector):
    """The score classes of each run row in ``selector``, by run name."""
    _classes(page, selector, 6)
    return page.evaluate(
        """selector => Object.fromEntries([...document.querySelectorAll(selector + ' tr')].map(row => [
      row.querySelector('.run-name, .run-link').textContent,
      [...row.querySelectorAll('.metric-score')].map(node => node.className)]))""",
        selector,
    )


# mix is maximize in run-a and minimize in run-b.
RUN_ROWS = {"run-a": [TOP, BOTTOM, TOP], "run-b": [TOP, BOTTOM, BOTTOM]}


def test_items_table_colours_each_item_mean_by_the_shared_direction(page):
    page.evaluate("() => __dsx.renderItemsTab(document.querySelector('#host'))")
    assert _classes(page, "#host tr[data-item-id='case-1']", 3) == [
        TOP,
        BOTTOM,
        NEUTRAL,
    ]


def test_runs_tab_colours_each_run_by_its_own_direction(page):
    page.evaluate("() => __dsx.renderRunsTab(document.querySelector('#host'))")
    assert _run_rows(page, "#host tbody") == RUN_ROWS


def test_item_page_runs_colour_tiles_by_shared_and_rows_by_own_direction(page):
    page.evaluate(
        """() => __dsx.renderItemPageRuns(document.querySelector('#host'),
      {id: 1, item_id: 'case-1'}, __dsx.state.activeVersion)"""
    )
    assert _classes(page, "#host .dsx-run-aggregate", 3) == [TOP, BOTTOM, NEUTRAL]
    assert _run_rows(page, "#host tbody") == RUN_ROWS
