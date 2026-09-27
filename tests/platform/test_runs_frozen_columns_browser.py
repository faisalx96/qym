"""C002: the frozen Runs columns never hide keyboard focus or the Actions column."""

from __future__ import annotations

import pytest

from test_dashboard_paging_browser import DashboardFixture, browser, make_runs

pytestmark = pytest.mark.browser

GEOMETRY = """selector => {
  const scroller = document.getElementById('runs-table-scroll');
  const view = scroller.getBoundingClientRect();
  const frozen = [...scroller.querySelectorAll('.runs-table thead th')].filter(th => {
    const style = getComputedStyle(th);
    return style.position === 'sticky' && style.left !== 'auto';
  });
  const frozenRight = Math.max(...frozen.map(th => th.getBoundingClientRect().right));
  const target = selector ? document.querySelector(selector) : document.activeElement;
  const box = target.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    frozenRight, viewRight: view.left + scroller.clientWidth,
    left: box.left, right: box.right,
    visible: !!hit && (hit === target || target.contains(hit)),
    scrollLeft: scroller.scrollLeft, max: scroller.scrollWidth - scroller.clientWidth,
  };
}"""


def wide_identity_runs():
    # Longer identity values widen the frozen block so most of the scrolling
    # columns pass underneath it, as on real projects at 1440 px.
    runs = make_runs(20)
    for run in runs:
        run["model_name"] = "provider-model-2026-09"
        run["dataset_name"] = "dataset-name-v12"
    return runs


@pytest.fixture
def table(browser):
    view = DashboardFixture(browser, runs=wide_identity_runs())
    view.page.set_viewport_size({"width": 1440, "height": 900})
    view.page.goto("https://qym.test/projects/demo")
    view.page.wait_for_function(
        "() => window.__dashboardTest?.state.dashboardPage?.rows.length === 20"
    )
    view.page.wait_for_timeout(100)
    try:
        yield view
    finally:
        view.close()


def scroll_to(page, left):
    page.evaluate(
        """left => { const s = document.getElementById('runs-table-scroll');
          s.scrollLeft = left === 'end' ? s.scrollWidth : left; }""",
        left,
    )


def test_focused_control_in_a_scrolling_cell_clears_the_frozen_block(table):
    page = table.page
    geometry = page.evaluate(GEOMETRY, "#runs-table-scroll")
    assert geometry["frozenRight"] < geometry["viewRight"] - 120
    # At the end of the table the first scrolling column sits under the
    # frozen block; focusing its Analyze link must bring it back into view.
    scroll_to(page, "end")
    link = page.locator("#runs-tbody tr[data-idx] .run-analysis-start").nth(3)
    link.focus()
    focused = page.evaluate(GEOMETRY, None)
    assert focused["visible"]
    assert focused["left"] >= focused["frozenRight"]
    assert focused["right"] <= focused["viewRight"]
    # Tabbing on through the row keeps every scrolling-cell stop in view.
    for _ in range(4):
        page.keyboard.press("Tab")
        stop = page.evaluate(GEOMETRY, None)
        in_frozen_cell = page.evaluate("""() => {
          const cell = document.activeElement.closest('td, th');
          const style = cell && getComputedStyle(cell);
          return !!style && style.position === 'sticky' && style.left !== 'auto';
        }""")
        if page.evaluate(
            "document.getElementById('runs-table-scroll').contains(document.activeElement)"
        ):
            assert stop["visible"], stop
            if not in_frozen_cell:
                assert stop["left"] >= stop["frozenRight"], stop


def test_a_mouse_click_beside_the_frozen_block_reaches_its_control(table):
    """Only keyboard focus moves the table; pointer focus keeps it still."""
    page = table.page
    page.evaluate(
        """() => { window.__clicks = [];
          document.addEventListener('click', event => {
            window.__clicks.push(event.target.closest('.run-analysis-start') ? 'link' : event.target.tagName);
            event.preventDefault(); event.stopImmediatePropagation();
          }, true); }"""
    )
    # Let only the right edge of an Analyze link peek out beside the frozen
    # block, then click that visible part.
    peek = page.evaluate(
        """() => {
          const scroller = document.getElementById('runs-table-scroll');
          const link = document.querySelectorAll('#runs-tbody tr[data-idx] .run-analysis-start')[3];
          const frozenRight = Math.max(...[...scroller.querySelectorAll('.runs-table thead th')]
            .filter(th => getComputedStyle(th).position === 'sticky' && getComputedStyle(th).left !== 'auto')
            .map(th => th.getBoundingClientRect().right));
          scroller.scrollLeft += link.getBoundingClientRect().right - (frozenRight + 8);
          const box = link.getBoundingClientRect();
          const x = frozenRight + 4, y = box.top + box.height / 2;
          return { x, y, scrollLeft: scroller.scrollLeft,
                   onLink: !!document.elementFromPoint(x, y)?.closest('.run-analysis-start') };
        }"""
    )
    assert peek["onLink"], peek
    page.mouse.click(peek["x"], peek["y"])
    assert page.evaluate("window.__clicks") == ["link"]
    assert (
        page.evaluate("document.getElementById('runs-table-scroll').scrollLeft")
        == peek["scrollLeft"]
    )


def test_focusing_a_frozen_cell_control_does_not_jump_the_table(table):
    page = table.page
    page.get_by_role("button", name="Select", exact=True).click()
    page.wait_for_function(
        "document.querySelector('#runs-tbody tr[data-idx] .run-select-control input')"
    )
    scroll_to(page, 300)
    before = page.evaluate("document.getElementById('runs-table-scroll').scrollLeft")
    page.locator("#runs-tbody tr[data-idx] .run-select-control input").nth(2).focus()
    after = page.evaluate("document.getElementById('runs-table-scroll').scrollLeft")
    assert before == after == 300


def test_table_stays_at_its_end_so_the_actions_column_is_not_cut(table):
    page = table.page
    scroll_to(page, "end")
    at_end = page.evaluate(GEOMETRY, ".runs-table thead th.col-actions")
    assert at_end["scrollLeft"] == at_end["max"]
    # A refresh that widens the table (a longer version, a new action icon)
    # used to leave the reader short of the end, cutting "ACTIONS" to "AC".
    page.evaluate("""() => {
      const t = window.__dashboardTest;
      t.state.dashboardPage.rows.forEach(run => { run.git_commit = 'release-candidate-build-2026-09-27-0001'; });
      t.render();
    }""")
    page.wait_for_function(
        """() => { const s = document.getElementById('runs-table-scroll');
          return s.scrollWidth - s.clientWidth > %d; }""" % at_end["max"]
    )
    page.evaluate(
        "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
    )
    header = page.evaluate(GEOMETRY, ".runs-table thead th.col-actions")
    assert header["scrollLeft"] == header["max"]
    assert header["right"] <= header["viewRight"] + 0.5
    assert header["left"] >= header["frozenRight"]
    assert header["visible"]
    # Anyone mid-table stays exactly where they were across the same refresh.
    scroll_to(page, 250)
    page.evaluate("() => window.__dashboardTest.render()")
    page.evaluate(
        "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
    )
    assert (
        page.evaluate("document.getElementById('runs-table-scroll').scrollLeft") == 250
    )
