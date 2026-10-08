"""runs_order.js (C044): the Runs list order outside the list.

The context a run link carries, the dashboard filters and sort the run page
asks the neighbours endpoint for (the same the list sends for that URL), and
the collation of the text sorts, which the list and the run page share.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

DASHBOARD = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "platform"
    / "qym_platform"
    / "_static"
    / "dashboard"
)


def run_js(body: str):
    """Evaluate ``body`` (a function body using ``api``) and return its value."""
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required")
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {}, URLSearchParams });
const source = fs.readFileSync(process.argv[1], 'utf8');
vm.runInContext(source, ctx);
vm.runInContext(source, ctx);  // shell.js re-runs page scripts
ctx.api = ctx.window.QymRunsOrder;
const value = vm.runInContext('(() => {' + process.argv[2] + '})()', ctx);
process.stdout.write(JSON.stringify(value));
"""
    result = subprocess.run(
        [node, "-e", script, str(DASHBOARD / "runs_order.js"), body],
        text=True,
        capture_output=True,
        timeout=60,
        # Local days are the viewer's: a fixed zone keeps the range bounds known.
        env={**os.environ, "TZ": "Asia/Riyadh"},
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_context_is_the_list_view_without_its_page():
    assert run_js(
        """return [
          api.contextFromParams({ page: '3', sort: 'model-asc', model: ['m-b', 'm-a'], range: 'week', q: '  run  1 ' }),
          api.contextFromParams({ sort: 'time-desc', page: '2', task: [], range: null, q: '' }),
          api.contextFromParams({ range: 'custom', from: '2026-01-01', to: '2026-01-31', owner: ['u1'] }),
        ];"""
    ) == [
        "range=week&model=m-b&model=m-a&q=run+1&sort=model-asc",
        "",
        "range=custom&from=2026-01-01&to=2026-01-31&owner=u1",
    ]


def test_a_context_from_a_url_keeps_only_the_list_view():
    assert run_js(
        """return [
          api.normalizeContext('page=4&sort=run-asc&item=x&task=a&task=b&evil=1'),
          api.normalizeContext(null),
          api.normalizeContext('sort=time-desc'),
          api.runHref('/projects/pa/runs/r1', 'page=2'),
          api.runHref('/projects/pa/runs/r1', 'status=FAILED&sort=model-asc'),
        ];"""
    ) == [
        "task=a&task=b&sort=run-asc",
        "",
        "",
        "/projects/pa/runs/r1",
        "/projects/pa/runs/r1?list=status%3DFAILED%26sort%3Dmodel-asc",
    ]


def test_query_sends_the_filters_and_sort_the_list_sends():
    result = run_js(
        """const now = new Date(2026, 9, 2, 15, 30);  // 2 Oct 2026 15:30 local
        return [
          api.query('model=m-a&model=m-b|||reasoning&model=__none__&model=m-a&task=t&status=FAILED&owner=u1&version=main/abc&dataset=d1&q=%20Run%20%201&sort=model-asc', now),
          api.query('range=today', now),
          api.query('range=week&sort=bad sort', now),
          api.query('range=custom&from=2026-09-01&to=2026-09-30', now),
          api.query('range=custom&from=2026-09-01', now),
          api.query('range=custom&to=2026-09-30', now),
          api.query('range=custom&from=bad&to=', now),
          api.query('', now),
        ];"""
    )
    first, today, week, custom, from_only, to_only, no_dates, empty = result
    assert first == {
        "filters": {
            "tasks": ["t"],
            # A plain model name covers both of its variants (dashboard.js
            # applyDashboardUrlState); variant keys and "none" stay as they are.
            "models": ["m-a|||plain", "m-a|||reasoning", "m-b|||reasoning", "__none__"],
            "datasets": ["d1"],
            "statuses": ["FAILED"],
            "versions": ["main/abc"],
            "users": ["u1"],
            "q": "Run 1",
        },
        "sort": "model-asc",
    }
    # Local days in Asia/Riyadh (UTC+3).
    assert (today["filters"]["since"], today["filters"]["until"]) == (
        "2026-10-01T21:00:00.000Z",
        "2026-10-02T21:00:00.000Z",
    )
    assert week["filters"]["since"] == "2026-09-25T12:30:00.000Z"
    assert "until" not in week["filters"]
    assert week["sort"] == "time-desc"
    assert (custom["filters"]["since"], custom["filters"]["until"]) == (
        "2026-08-31T21:00:00.000Z",
        "2026-09-30T21:00:00.000Z",
    )
    # The Range picker allows one side only ("From" or "Until" a date); the
    # list bounds it on that side (dashboard.js timeFilterBounds), and so must
    # the run page, or its arrows step through runs the list does not show.
    assert from_only["filters"]["since"] == "2026-08-31T21:00:00.000Z"
    assert "until" not in from_only["filters"]
    assert to_only["filters"]["until"] == "2026-09-30T21:00:00.000Z"
    assert "since" not in to_only["filters"]
    assert "since" not in no_dates["filters"] and "until" not in no_dates["filters"]
    assert empty == {
        "filters": {"tasks": [], "models": [], "datasets": [], "statuses": [], "versions": [], "users": []},
        "sort": "time-desc",
    }


def test_the_origin_toggle_carries_into_the_run_page_order():
    """The list's Origin toggle (official/local) narrows the neighbors too."""
    assert run_js(
        """return [
          api.contextFromParams({ origin: 'official', task: ['t'], sort: 'run-asc' }),
          api.normalizeContext('origin=local&origin=official&page=2'),
          api.query('origin=official').filters.origins,
          api.query('origin=local').filters.origins,
          api.query('origin=all').filters.origins === undefined,
          api.query('origin=verified').filters.origins === undefined,
        ];"""
    ) == [
        "task=t&origin=official&sort=run-asc",
        "origin=local",
        ["official"],
        ["local"],
        True,
        True,
    ]


def test_text_sorts_collate_like_the_list():
    assert run_js(
        """return [
          api.collation('model-asc', ['qwen/zeta|||plain', 'alpha|||reasoning', 'openai/alpha|||plain', 'Beta|||plain']),
          api.collation('dataset-desc', ['b', 'A', 'a', 'c']),
          api.collation('owner-asc', ['Zed', 'amy']),
          api.collation('time-desc', ['x']),
          api.collation('metric-accuracy-asc', ['x']),
          api.collatedColumn('version-asc'),
          api.collatedColumn('constructor-asc'),
        ];"""
    ) == [
        # By the name the list shows (no provider), plain before reasoning.
        ["openai/alpha|||plain", "alpha|||reasoning", "Beta|||plain", "qwen/zeta|||plain"],
        ["a", "A", "b", "c"],
        ["amy", "Zed"],
        None,
        None,
        "git_commits",
        None,
    ]


def test_values_that_compare_equal_collate_the_same_whatever_their_order():
    """One model name from two providers shows the same label: the list and
    the run page collate separately fetched value lists, so ties must not keep
    the order the database happened to return."""
    assert run_js(
        """const models = ['openai/gpt-4o|||plain', 'azure/gpt-4o|||plain', 'acme/alpha|||plain'];
        // Two spellings of one text (composed and decomposed accent) that
        // localeCompare calls equal.
        const datasets = ['caf\\u00e9', 'cafe\\u0301', 'b'];
        return [
          api.collation('model-asc', models),
          api.collation('model-desc', models.slice().reverse()),
          api.collation('dataset-asc', datasets).map(escape),
          api.collation('dataset-asc', datasets.slice().reverse()).map(escape),
        ];"""
    ) == [
        ["acme/alpha|||plain", "azure/gpt-4o|||plain", "openai/gpt-4o|||plain"],
        ["acme/alpha|||plain", "azure/gpt-4o|||plain", "openai/gpt-4o|||plain"],
        ["b", "cafe%u0301", "caf%E9"],
        ["b", "cafe%u0301", "caf%E9"],
    ]


def test_dashboard_collation_comes_from_the_shared_helper():
    source = (DASHBOARD / "dashboard.js").read_text(encoding="utf-8")
    start = source.index("function dashboardCollation(")
    body = source[start : source.index("\n  }\n", start)]
    assert "window.QymRunsOrder.collation(sortKey" in body
    assert "localeCompare" not in body
    for page in ("index.html", "charts.html", "models.html", "run.html"):
        html = (DASHBOARD / page).read_text(encoding="utf-8")
        assert '<script src="/static/runs_order.js?v=p1-20261006-1"></script>' in html, page
        if page != "run.html":
            assert html.index("runs_order.js") < html.index("dashboard.js?v="), page
