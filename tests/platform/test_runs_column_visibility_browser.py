"""Display > Columns shows and hides every Runs column, the frozen identity
columns included; the frozen block closes up around hidden columns."""

from __future__ import annotations

import json
import re

import pytest

from test_dashboard_paging_browser import DashboardFixture, make_runs
from test_runs_frozen_columns_browser import settle

pytestmark = pytest.mark.browser

RUN_COLUMNS = [
    "Run name",
    "Status",
    "Task",
    "Model",
    "Dataset",
    "Owner",
    "Date",
    "Analysis",
    "Experiment",
    "Version",
    "Duration",
]
STORAGE_KEY = "qym_visible_metrics"

LAYOUT = """() => {
  const table = document.querySelector('.runs-table');
  const key = cell => cell.className.match(/\\bcol-([a-z]+)/)[1];
  const shown = el => getComputedStyle(el).display !== 'none';
  const headers = [...table.querySelectorAll('thead th')].filter(shown);
  const frozen = headers.filter(th => {
    const style = getComputedStyle(th);
    return style.position === 'sticky' && style.left !== 'auto';
  });
  const row = document.querySelector('#runs-tbody tr[data-idx]');
  let stored = null;
  try { stored = sessionStorage.getItem('qym_visible_metrics'); } catch (e) {}
  return {
    headers: headers.map(key),
    cells: [...row.children].filter(shown).map(key),
    hiddenAttr: table.dataset.hiddenColumns || '',
    frozen: frozen.map(key),
    lefts: frozen.map(th => parseFloat(getComputedStyle(th).left)),
    widths: frozen.map(th => th.getBoundingClientRect().width),
    boxes: frozen.map(th => [th.getBoundingClientRect().left, th.getBoundingClientRect().right]),
    edges: table.dataset.frozenEdges,
    shadows: headers.filter(th => getComputedStyle(th, '::before').boxShadow !== 'none').map(key),
    stored,
  };
}"""


def open_runs(browser, seed=None, width=2560):
    view = DashboardFixture(browser, runs=make_runs(20))
    view.page.set_viewport_size({"width": width, "height": 900})
    if seed is not None:
        # Seed once: a reload keeps whatever the page saved since.
        view.page.add_init_script(
            "try { if (!sessionStorage.getItem('__seeded')) {"
            " sessionStorage.setItem('__seeded', '1');"
            " sessionStorage.setItem(%s, %s); } } catch (e) {}"
            % (json.dumps(STORAGE_KEY), json.dumps(json.dumps(seed)))
        )
    goto(view.page)
    return view


def goto(page):
    page.goto("https://qym.test/projects/demo")
    page.wait_for_function(
        "() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0"
    )
    settle(page)


def open_menu(page):
    page.locator("#metric-visibility-btn").click()
    return page.locator("#metric-visibility-dropdown")


def run_column_box(page, label):
    return (
        page.locator(
            "#metric-visibility-dropdown label:has(> input[data-mv-metric^='__runs_col_'])"
        )
        .filter(has_text=re.compile(rf"^\s*{re.escape(label)}\s*$"))
        .locator("input")
    )


def toggle(page, label):
    run_column_box(page, label).locator("xpath=..").click()
    settle(page)


def assert_contiguous(layout):
    """Frozen headers sit side by side from the left edge: no gap, no overlap."""
    assert layout["lefts"][0] == 0
    for index in range(1, len(layout["frozen"])):
        assert layout["lefts"][index] == pytest.approx(
            layout["lefts"][index - 1] + layout["widths"][index - 1], abs=0.5
        )
        assert layout["boxes"][index][0] == pytest.approx(
            layout["boxes"][index - 1][1], abs=0.5
        )


def test_every_run_column_is_offered_and_checked_by_default(browser):
    view = open_runs(browser)
    try:
        page = view.page
        open_menu(page)
        labels = page.evaluate(
            """() => [...document.querySelectorAll(
              '#metric-visibility-dropdown input[data-mv-metric^="__runs_col_"]')]
              .map(cb => [cb.nextElementSibling.textContent.trim(), cb.checked, cb.disabled])"""
        )
        assert labels == [[label, True, False] for label in RUN_COLUMNS]
        assert page.locator("#metric-visibility-btn").inner_text() == "Columns"
        assert view.errors == []
    finally:
        view.close()


def test_hiding_a_frozen_column_closes_the_frozen_block(browser):
    view = open_runs(browser)
    try:
        page = view.page
        before = page.evaluate(LAYOUT)
        assert before["frozen"][:7] == [
            "run", "status", "task", "model", "dataset", "owner", "time"
        ]
        open_menu(page)
        toggle(page, "Status")
        toggle(page, "Model")
        after = page.evaluate(LAYOUT)
        assert "status" not in after["headers"] and "model" not in after["headers"]
        assert "status" not in after["cells"] and "model" not in after["cells"]
        assert after["hiddenAttr"] == "status model"
        assert after["frozen"] == ["run", "task", "dataset", "owner", "time"]
        assert_contiguous(after)
        assert after["edges"] == "time"
        assert after["shadows"] == ["time"]
        # The Frozen columns options for hidden columns wait until they show.
        frozen = page.get_by_role("group", name="Frozen columns")
        status = frozen.get_by_role("checkbox", name="Status", exact=True)
        assert status.is_disabled() and status.is_checked()
        assert frozen.get_by_role("checkbox", name="Task", exact=True).is_enabled()
        stored = json.loads(after["stored"])
        assert stored["version"] == 2
        assert "__runs_col_status__" not in stored["visible"]
        assert "__runs_col_run__" in stored["visible"]
        assert "accuracy" in stored["visible"]
        assert page.locator("#metric-visibility-btn").inner_text().endswith("Columns")
        # Showing Status again restores it in place, still frozen.
        toggle(page, "Status")
        again = page.evaluate(LAYOUT)
        assert again["frozen"] == ["run", "status", "task", "dataset", "owner", "time"]
        assert_contiguous(again)
        assert view.errors == []
    finally:
        view.close()


def test_hiding_the_edge_column_moves_the_shadow(browser):
    view = open_runs(browser)
    try:
        page = view.page
        open_menu(page)
        toggle(page, "Date")
        layout = page.evaluate(LAYOUT)
        assert "time" not in layout["headers"]
        assert layout["frozen"] == ["run", "status", "task", "model", "dataset", "owner"]
        assert layout["edges"] == "owner"
        assert layout["shadows"] == ["owner"]
        assert_contiguous(layout)
    finally:
        view.close()


def test_hidden_run_name_keeps_only_its_checkbox_while_selecting(browser):
    view = open_runs(browser)
    try:
        page = view.page
        open_menu(page)
        toggle(page, "Run name")
        layout = page.evaluate(LAYOUT)
        assert layout["headers"][0] == "status"
        assert "run" not in layout["cells"]
        assert layout["frozen"][0] == "status"
        assert_contiguous(layout)
        page.keyboard.press("Escape")
        page.get_by_role("button", name="Select", exact=True).click()
        settle(page)
        selecting = page.evaluate(LAYOUT)
        assert selecting["headers"][0] == "run"
        assert selecting["frozen"][0] == "run"
        assert_contiguous(selecting)
        cell = page.evaluate(
            """() => {
              const td = document.querySelector('#runs-tbody tr[data-idx] td.col-run');
              const shown = el => getComputedStyle(el).display !== 'none';
              return { checkbox: shown(td.querySelector('.run-select-control')),
                       name: shown(td.querySelector('.run-id')),
                       width: td.getBoundingClientRect().width };
            }"""
        )
        assert cell["checkbox"] and not cell["name"]
        assert cell["width"] < 120
        page.locator("#runs-tbody tr[data-idx] .row-checkbox").first.check()
        assert page.evaluate("window.__dashboardTest.state.selectedRuns.size") == 1
        assert view.errors == []
    finally:
        view.close()


def test_none_keeps_run_name_so_the_table_is_never_empty(browser):
    view = open_runs(browser)
    try:
        page = view.page
        open_menu(page)
        page.locator("#mv-select-none").click()
        settle(page)
        layout = page.evaluate(LAYOUT)
        assert layout["headers"] == ["run", "actions"]
        assert layout["cells"] == ["run", "actions"]
        checked = page.evaluate(
            """() => [...document.querySelectorAll('#metric-visibility-dropdown input[data-mv-metric]')]
              .filter(cb => cb.checked).map(cb => cb.dataset.mvMetric)"""
        )
        assert checked == ["__runs_col_run__"]
        # Clearing that last box keeps it too.
        toggle(page, "Run name")
        assert page.evaluate(LAYOUT)["headers"] == ["run", "actions"]
        assert run_column_box(page, "Run name").is_checked()
        page.locator("#mv-select-all").click()
        settle(page)
        assert page.evaluate(LAYOUT)["hiddenAttr"] == ""
        assert page.evaluate(LAYOUT)["stored"] is None
    finally:
        view.close()


def test_a_choice_saved_before_run_columns_were_hideable_shows_them(browser):
    # Version 1: a bare list of the visible metric and system columns.
    view = open_runs(browser, seed=["accuracy", "latency"])
    try:
        page = view.page
        layout = page.evaluate(LAYOUT)
        assert layout["hiddenAttr"] == ""
        assert layout["headers"][:10] == [
            "run", "status", "task", "model", "dataset", "owner", "time",
            "analysis", "experiment", "version",
        ]
        assert "latency" in layout["headers"]
        assert page.locator(".runs-table thead th.col-latency-median").is_hidden()
        assert view.errors == []
    finally:
        view.close()


def test_a_saved_choice_survives_a_reload(browser):
    view = open_runs(browser)
    try:
        page = view.page
        open_menu(page)
        toggle(page, "Task")
        toggle(page, "Version")
        page.keyboard.press("Escape")
        goto(page)
        reloaded = page.evaluate(LAYOUT)
        assert "task" not in reloaded["headers"] and "version" not in reloaded["headers"]
        assert reloaded["hiddenAttr"] == "task version"
        assert reloaded["frozen"] == ["run", "status", "model", "dataset", "owner", "time"]
        assert_contiguous(reloaded)
        open_menu(page)
        assert not run_column_box(page, "Task").is_checked()
        assert run_column_box(page, "Model").is_checked()
    finally:
        view.close()


def test_a_saved_metric_only_table_keeps_its_choice(browser):
    # Version 2 lists the Runs columns: none listed means all were hidden.
    view = open_runs(browser, seed={"version": 2, "visible": ["accuracy"]})
    try:
        layout = view.page.evaluate(LAYOUT)
        assert layout["headers"] == ["metric", "actions"]
        assert layout["frozen"] == []
        assert view.errors == []
    finally:
        view.close()
