"""C002: the frozen Runs columns never hide keyboard focus or the Actions column,
and the reader chooses which identity columns are frozen."""

from __future__ import annotations

import json

import pytest

from test_dashboard_paging_browser import DashboardFixture, make_runs

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


def test_a_mouse_click_beside_the_frozen_block_reaches_its_control(browser):
    """Only keyboard focus moves the table; pointer focus keeps it still."""
    runs = wide_identity_runs()
    for run in runs:  # room to bring an Analyze link up to the frozen edge
        run["git_commit"] = "release-candidate-build-2026-09-27-0001-nightly-rebuild"
    view = open_runs(browser, 1440, runs=runs)
    try:
        _click_beside_the_frozen_block(view.page)
    finally:
        view.close()


def _click_beside_the_frozen_block(page):
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


# ── C002 follow-up: the reader chooses which identity columns are frozen ──

IDENTITY = ["run", "status", "task", "model", "dataset", "owner", "time"]
STORAGE_KEY = "qym:runs-frozen-columns"

FROZEN_STATE = """() => {
  const table = document.querySelector('.runs-table');
  const scroller = document.getElementById('runs-table-scroll');
  const key = cell => cell.className.match(/\\bcol-([a-z]+)/)[1];
  const headers = [...table.querySelectorAll('thead th')];
  const frozen = headers.filter(th => {
    const style = getComputedStyle(th);
    return style.position === 'sticky' && style.left !== 'auto';
  });
  let stored = null;
  try { stored = localStorage.getItem('qym:runs-frozen-columns'); } catch (e) {}
  return {
    attr: table.dataset.frozenColumns,
    edges: table.dataset.frozenEdges,
    frozen: frozen.map(key),
    lefts: frozen.map(th => parseFloat(getComputedStyle(th).left)),
    widths: frozen.map(th => th.getBoundingClientRect().width),
    shadows: headers.filter(th => getComputedStyle(th, '::before').boxShadow !== 'none').map(key),
    width: Math.max(0, ...frozen.map(th =>
      parseFloat(getComputedStyle(th).left) + th.getBoundingClientRect().width)),
    portLeft: scroller.getBoundingClientRect().left + scroller.clientLeft,
    clientWidth: scroller.clientWidth,
    stored,
  };
}"""

# Is a control fully clear of the frozen block, as laid out right now?
FOCUS_STATE = """selector => {
  const scroller = document.getElementById('runs-table-scroll');
  const target = selector ? document.querySelector(selector) : document.activeElement;
  const cell = target.closest('td, th');
  const frozen = [...scroller.querySelectorAll('.runs-table thead th')].filter(th => {
    const style = getComputedStyle(th);
    return style.position === 'sticky' && style.left !== 'auto';
  });
  const width = Math.max(0, ...frozen.map(th =>
    parseFloat(getComputedStyle(th).left) + th.getBoundingClientRect().width));
  const portLeft = scroller.getBoundingClientRect().left + scroller.clientLeft;
  const box = target.getBoundingClientRect();
  const shows = x => {
    const hit = document.elementFromPoint(x, box.top + box.height / 2);
    return !!hit && (hit === target || target.contains(hit));
  };
  const cellStyle = cell && getComputedStyle(cell);
  return {
    inTable: scroller.contains(target),
    inFrozenCell: !!cellStyle && cellStyle.position === 'sticky' && cellStyle.left !== 'auto',
    left: box.left, right: box.right, edge: portLeft + width,
    viewRight: portLeft + scroller.clientWidth,
    visible: shows(box.left + box.width / 2),
    // Nothing frozen covers any part of it: left edge, middle and right edge.
    clear: [box.left + 1, box.left + box.width / 2, box.right - 1].every(shows),
    label: target.getAttribute('aria-label') || target.textContent.trim().slice(0, 30),
  };
}"""


def long_identity_runs(count=20):
    # Real identity values (long model and dataset names, error markers in
    # STATUS) make the default frozen block wider than a 1280 px table.
    runs = make_runs(count)
    for index, run in enumerate(runs):
        run["model_name"] = "provider-reasoning-model-2026-09-large"
        run["dataset_name"] = "customer-support-escalations-v12"
        run["task_name"] = "text2sql-join-heavy-queries"
        run["owner"] = {"id": "owner", "display_name": "Evaluation Owner"}
        if index % 2 == 0:
            run.update(
                task_error_count=1,
                metric_error_count=1,
                metric_error_counts={"accuracy": 1},
                execution_error_count=2,
            )
    return runs


def settle(page):
    page.evaluate(
        "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
    )


def open_runs(browser, width, frozen=None, runs=None):
    view = DashboardFixture(browser, runs=runs or long_identity_runs())
    view.page.set_viewport_size({"width": width, "height": 900})
    if frozen is not None:
        view.page.add_init_script(
            "try { localStorage.setItem(%s, %s); } catch (e) {}"
            % (json.dumps(STORAGE_KEY), json.dumps(json.dumps(frozen)))
        )
    view.page.goto("https://qym.test/projects/demo")
    view.page.wait_for_function(
        "() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0"
    )
    settle(view.page)
    return view


def frozen_section(page):
    page.locator("#metric-visibility-btn").click()
    return page.get_by_role("group", name="Frozen columns")


def toggle_with_keyboard(page, *names):
    for name in names:
        page.get_by_role("group", name="Frozen columns").get_by_role(
            "checkbox", name=name, exact=True
        ).focus()
        page.keyboard.press("Space")
    settle(page)


def scroll_to_metric(page, state):
    """Bring the accuracy column to the frozen edge; is it visible there?"""
    return page.evaluate(
        """edge => {
          const scroller = document.getElementById('runs-table-scroll');
          const header = document.querySelector('.runs-table thead th[data-sort^="metric-accuracy"]');
          scroller.scrollLeft += header.getBoundingClientRect().left - edge;
          const cell = document.querySelector('#runs-tbody tr[data-idx] td.col-metric-value');
          const probe = el => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !!hit && (hit === el || el.contains(hit));
          };
          return { header: probe(header), cell: probe(cell) };
        }""",
        state["portLeft"] + state["width"] + 2,
    )


def test_default_keeps_the_seven_identity_columns_frozen_as_before(browser):
    # Wide enough for all seven: narrower windows fit the block (below).
    view = open_runs(browser, 2560, runs=wide_identity_runs())
    try:
        page = view.page
        state = page.evaluate(FROZEN_STATE)
        assert state["attr"] == " ".join(IDENTITY)
        assert state["frozen"] == IDENTITY
        assert state["stored"] is None
        # One contiguous block from the left edge: each frozen column starts
        # where the one before it ends, and Date alone casts the shadow.
        assert state["lefts"][0] == 0
        for index in range(1, len(IDENTITY)):
            assert state["lefts"][index] == pytest.approx(
                state["lefts"][index - 1] + state["widths"][index - 1], abs=0.5
            )
        assert state["edges"] == "time"
        assert state["shadows"] == ["time"]
        assert page.evaluate(
            """() => [...document.querySelector('#runs-tbody tr[data-idx]').children]
              .slice(0, 7).every(td => getComputedStyle(td).position === 'sticky')"""
        )
        section = frozen_section(page)
        boxes = section.get_by_role("checkbox")
        assert boxes.count() == 7
        assert [
            boxes.nth(i).evaluate("e => e.closest('label').textContent.trim()")
            for i in range(7)
        ] == ["Run name", "Status", "Task", "Model", "Dataset", "Owner", "Date"]
        assert all(boxes.nth(i).is_checked() for i in range(7))
        reset = page.get_by_role("button", name="Reset to default")
        assert reset.get_attribute("aria-disabled") == "true"
        # "Search columns..." finds frozen columns by name too.
        page.locator("#metric-visibility-dropdown .model-search-input").fill("dat")
        visible = page.evaluate(
            """() => [...document.querySelectorAll('#metric-visibility-dropdown .multi-select-option')]
              .filter(opt => opt.style.display !== 'none').map(opt => opt.textContent.trim())"""
        )
        # Run columns (show/hide) then Frozen columns.
        assert visible == ["Dataset", "Date", "Dataset", "Date"]
    finally:
        view.close()


@pytest.mark.parametrize("width", [1280, 1440, 1920])
def test_unfreezing_task_to_date_reveals_the_metric_columns(browser, width):
    view = open_runs(browser, width)
    try:
        page = view.page
        before = page.evaluate(FROZEN_STATE)
        # The seven frozen columns used to be wider than a 1280 px table, so
        # no score could be brought into view. Trailing ones now scroll until
        # the block fits, before the reader changes anything.
        assert before["width"] <= before["clientWidth"] * 0.55
        assert scroll_to_metric(page, before) == {"header": True, "cell": True}
        frozen_section(page)
        toggle_with_keyboard(page, "Task", "Model", "Dataset", "Owner", "Date")
        # A background refresh rebuilds the menu; focus stays on the option.
        page.evaluate("() => window.__dashboardTest.render()")
        settle(page)
        assert page.evaluate("document.activeElement.dataset.frozenColumn") == "time"
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == ["run", "status"]
        assert state["attr"] == "run status"
        assert json.loads(state["stored"]) == ["run", "status"]
        # Offsets come from the frozen set only; STATUS now casts the edge.
        assert state["lefts"] == [0, pytest.approx(state["widths"][0], abs=0.5)]
        assert state["edges"] == "status"
        assert state["shadows"] == ["status"]
        assert state["width"] < state["clientWidth"] / 2
        # Unfrozen identity cells scroll; their headers stay sticky on top
        # and pass beneath the frozen headers.
        cells = page.evaluate(
            """() => {
              const style = el => getComputedStyle(el);
              const th = document.querySelector('.runs-table thead th.col-task');
              const td = document.querySelector('#runs-tbody tr[data-idx] td.col-task');
              const frozen = document.querySelector('.runs-table thead th.col-status');
              return { thPosition: style(th).position, thTop: style(th).top,
                       thLeft: style(th).left, thZ: style(th).zIndex,
                       tdPosition: style(td).position, frozenZ: style(frozen).zIndex };
            }"""
        )
        assert cells == {
            "thPosition": "sticky",
            "thTop": "0px",
            "thLeft": "auto",
            "thZ": "10",
            "tdPosition": "static",
            "frozenZ": "12",
        }
        assert scroll_to_metric(page, state) == {"header": True, "cell": True}
        # Row striping still paints the frozen cells like the rest of the row.
        backgrounds = page.evaluate(
            """() => {
              const row = document.querySelector('#runs-tbody tr[data-idx]');
              const bg = el => getComputedStyle(el).backgroundColor;
              return [bg(row), bg(row.querySelector('td.col-run'))];
            }"""
        )
        assert backgrounds[0] == backgrounds[1]
    finally:
        view.close()


def test_frozen_choice_persists_across_reload_and_resets_to_default(browser):
    view = open_runs(browser, 2560, runs=wide_identity_runs())
    try:
        page = view.page
        section = frozen_section(page)
        # Mouse users click the option row (its label), as in every menu.
        section.locator("label", has_text="Model").click()
        section.locator("label", has_text="Owner").click()
        settle(page)
        expected = ["run", "status", "task", "dataset", "time"]
        assert page.evaluate(FROZEN_STATE)["frozen"] == expected
        reset = page.get_by_role("button", name="Reset to default")
        assert reset.get_attribute("aria-disabled") == "false"

        page.reload()
        page.wait_for_function(
            "() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0"
        )
        settle(page)
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == expected
        # A split block: each frozen run that ends before a scrolling column
        # casts the separator shadow.
        assert state["edges"] == "task dataset time"
        section = frozen_section(page)
        assert not section.get_by_role("checkbox", name="Model", exact=True).is_checked()
        assert section.get_by_role("checkbox", name="Date", exact=True).is_checked()

        reset = page.get_by_role("button", name="Reset to default")
        reset.focus()
        page.keyboard.press("Enter")
        settle(page)
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == IDENTITY
        assert state["stored"] is None
        assert reset.get_attribute("aria-disabled") == "true"
        assert reset.evaluate("e => e === document.activeElement")
        boxes = section.get_by_role("checkbox")
        assert all(boxes.nth(i).is_checked() for i in range(7))
    finally:
        view.close()


def test_split_frozen_block_offsets_skip_the_scrolling_columns(browser):
    runs = long_identity_runs()
    for run in runs:  # enough scrolling columns for Date to reach Run name
        run["git_commit"] = "release-candidate-build-2026-09-27-0001-nightly-rebuild"
    view = open_runs(browser, 1440, frozen=["run", "time"], runs=runs)
    try:
        page = view.page
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == ["run", "time"]
        assert state["lefts"] == [0, pytest.approx(state["widths"][0], abs=0.5)]
        assert state["shadows"] == ["run", "time"]
        # Scrolled, Date closes up against Run name over what scrolls between.
        scroll_to(page, "end")
        settle(page)
        edges = page.evaluate(
            """() => {
              const box = c => document.querySelector(`.runs-table thead th.${c}`).getBoundingClientRect();
              return [box('col-run').right, box('col-time').left];
            }"""
        )
        assert edges[1] == pytest.approx(edges[0], abs=0.5)
    finally:
        view.close()


@pytest.mark.parametrize(
    "width,frozen",
    [
        (1280, ["run", "status"]),
        (1440, ["run", "status"]),
        (1920, ["run", "status"]),
        (1280, ["run", "time"]),
        (1440, ["run", "time"]),
        (1920, ["run", "time"]),
        (1280, []),
        # The default block used to cover the table at 1280/1440 with these
        # values; it now fits, leaving room for the controls.
        (1280, None),
        (1440, None),
        (1920, None),
    ],
    ids=[
        "name-and-status-1280",
        "name-and-status-1440",
        "name-and-status-1920",
        "split-1280",
        "split-1440",
        "split-1920",
        "none-1280",
        "default-1280",
        "default-1440",
        "default-1920",
    ],
)
def test_tab_focus_never_hides_under_the_chosen_frozen_block(browser, width, frozen):
    view = open_runs(browser, width, frozen=frozen)
    try:
        page = view.page
        page.get_by_role("button", name="Select", exact=True).click()
        page.wait_for_function(
            "document.querySelector('#runs-tbody tr[data-idx] .run-select-control input')"
        )
        settle(page)
        scroll_to(page, "end")
        # From the end of the table, tab through rows of checkboxes, STATUS
        # error buttons, Analyze links, score markers and row actions.
        page.locator("#runs-tbody tr[data-idx] .row-checkbox").first.focus()
        seen = 0
        for _ in range(24):
            page.keyboard.press("Tab")
            stop = page.evaluate(FOCUS_STATE, None)
            if not stop["inTable"]:
                continue
            seen += 1
            assert stop["visible"], stop
            if not stop["inFrozenCell"]:
                assert stop["clear"], stop
                assert stop["right"] <= stop["viewRight"] + 0.5, stop
                if frozen != ["run", "time"]:
                    # A contiguous block: focus lands right of its edge.
                    assert stop["left"] >= stop["edge"], stop
        assert seen >= 12
    finally:
        view.close()


def test_actions_column_stays_clear_when_the_frozen_set_changes_at_the_end(browser):
    view = open_runs(browser, 1280, frozen=["run", "status"])
    try:
        page = view.page
        scroll_to(page, "end")
        settle(page)
        header = page.evaluate(FOCUS_STATE, ".runs-table thead th.col-actions")
        assert header["visible"] and header["left"] >= header["edge"], header
        # Freezing one more column while reading the end keeps the reader at
        # the end, with ACTIONS whole and right of the wider frozen block.
        frozen_section(page)
        toggle_with_keyboard(page, "Task")
        page.locator("#metric-visibility-btn").click()
        settle(page)
        position = page.evaluate(
            """() => { const s = document.getElementById('runs-table-scroll');
              return [s.scrollLeft, s.scrollWidth - s.clientWidth]; }"""
        )
        assert position[0] == position[1]
        header = page.evaluate(FOCUS_STATE, ".runs-table thead th.col-actions")
        assert header["visible"], header
        assert header["left"] >= header["edge"], header
        assert header["right"] <= header["viewRight"] + 0.5, header
    finally:
        view.close()


def test_repeat_run_pass_rows_follow_the_frozen_set(browser):
    runs = long_identity_runs(3)
    passes = [
        dict(pass_number=n, status="completed", metric_means={"accuracy": 0.5 + n / 10})
        for n in (1, 2)
    ]
    runs[0].update(samples=2, pass_summaries=passes)
    view = DashboardFixture(browser, runs=runs)
    page = view.page
    page.route(
        "**/api/runs/run-000/passes",
        lambda route: route.fulfill(
            json={"samples": 2, "metrics": ["accuracy"], "passes": passes}
        ),
    )
    page.route(
        "**/api/runs/run-000/group-metrics*",
        lambda route: route.fulfill(json={"metric": "accuracy", "samples": 2}),
    )
    page.add_init_script(
        "try { localStorage.setItem(%s, '[\"run\"]'); } catch (e) {}"
        % json.dumps(STORAGE_KEY)
    )
    try:
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto("https://qym.test/projects/demo")
        page.locator('.samples-toggle[data-run-id="run-000"]').click()
        page.wait_for_function(
            "__dashboardTest.state._samplesData['run-000']?.passes?.samples === 2"
        )
        page.get_by_role("button", name="Select", exact=True).click()
        settle(page)
        scroll_to(page, 600)
        settle(page)
        cells = page.evaluate(
            """() => [...document.querySelectorAll('#runs-tbody tr.pass-member')].map(tr => {
              const style = s => getComputedStyle(tr.querySelector(s));
              const run = tr.querySelector('td.col-run');
              return [style('td.col-run').position, style('td.col-run').left,
                      style('td.col-status').position, style('td.col-task').position,
                      getComputedStyle(run, '::before').boxShadow !== 'none',
                      getComputedStyle(run).boxShadow.includes('inset')];
            })"""
        )
        # Run name stays put with the group's accent bar and the frozen edge
        # shadow together; the other identity cells scroll with the data.
        assert cells == [["sticky", "0px", "static", "static", True, True]] * 2
        covered = page.evaluate(
            """() => {
              const td = document.querySelector('#runs-tbody tr.pass-member td.col-run');
              const b = td.getBoundingClientRect();
              const hit = document.elementFromPoint(b.right - 4, b.top + b.height / 2);
              return !(hit === td || td.contains(hit));
            }"""
        )
        assert not covered
    finally:
        view.close()


def test_charts_columns_menu_has_no_frozen_section(browser):
    view = DashboardFixture(browser, view="charts")
    try:
        view.open()
        view.page.locator("#metric-visibility-btn").click()
        assert view.page.locator("#metric-visibility-dropdown").is_visible()
        assert view.page.get_by_role("group", name="Frozen columns").count() == 0
        assert view.page.locator("[data-frozen-column]").count() == 0
    finally:
        view.close()


def test_blocked_storage_keeps_the_default_and_the_toggles_working(browser):
    view = DashboardFixture(browser, runs=wide_identity_runs())
    page = view.page
    page.add_init_script(
        """Object.defineProperty(window, 'localStorage', {
             configurable: true,
             get() { throw new DOMException('blocked', 'SecurityError'); } });"""
    )
    try:
        page.set_viewport_size({"width": 2560, "height": 900})
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function(
            "() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0"
        )
        settle(page)
        assert page.evaluate(FROZEN_STATE)["frozen"] == IDENTITY
        frozen_section(page)
        toggle_with_keyboard(page, "Date")
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == IDENTITY[:-1]
        assert state["shadows"] == ["owner"]
    finally:
        view.close()


# ── Fit: a frozen block too wide for the table lets trailing columns scroll ──

LABELS = dict(zip(IDENTITY, ["Run name", "Status", "Task", "Model", "Dataset", "Owner", "Date"]))

MENU_STATE = """() => {
  const note = document.getElementById('mv-frozen-fit');
  return {
    checked: [...document.querySelectorAll('#metric-visibility-dropdown input[data-frozen-column]')]
      .filter(cb => cb.checked).map(cb => cb.dataset.frozenColumn),
    note: note && !note.hidden ? note.textContent.trim() : '',
    noteVisible: !!note && !note.hidden && note.getBoundingClientRect().height > 0,
    describedBy: document.querySelector('#metric-visibility-dropdown [role="group"][aria-labelledby="mv-frozen-label"]')
      ?.getAttribute('aria-describedby'),
    reset: document.getElementById('mv-frozen-reset')?.getAttribute('aria-disabled'),
  };
}"""


def fit_note(keys):
    return "Unfrozen to fit this width: " + ", ".join(LABELS[key] for key in keys)


def resize(page, width):
    page.set_viewport_size({"width": width, "height": 900})
    page.wait_for_function(
        "w => document.getElementById('runs-table-scroll').clientWidth === w", arg=width
    )
    settle(page)
    settle(page)


def column_fully_visible(page, key, state):
    """Scroll a scrolling identity column to just right of the frozen edge;
    is all of it in view there?"""
    return page.evaluate(
        """([key, edge]) => {
          const scroller = document.getElementById('runs-table-scroll');
          const header = document.querySelector(`.runs-table thead th.col-${key}`);
          scroller.scrollLeft += header.getBoundingClientRect().left - edge;
          const cell = document.querySelector(`#runs-tbody tr[data-idx] td.col-${key}`);
          const b = cell.getBoundingClientRect();
          const view = scroller.getBoundingClientRect();
          const shows = x => { const hit = document.elementFromPoint(x, b.top + b.height / 2);
            return !!hit && (hit === cell || cell.contains(hit)); };
          return shows(b.left + 2) && shows(b.right - 2) && b.right <= view.left + scroller.clientWidth + 0.5;
        }""",
        [key, state["portLeft"] + state["width"] + 1],
    )


@pytest.mark.parametrize("width", [1280, 1440, 1920])
def test_default_block_fits_beside_the_scores_at_each_width(browser, width):
    view = open_runs(browser, width)
    try:
        page = view.page
        state = page.evaluate(FROZEN_STATE)
        frozen = state["frozen"]
        # Trailing columns let go from the right; Run name always stays.
        assert frozen[0] == "run" and frozen == IDENTITY[: len(frozen)]
        assert len(frozen) < len(IDENTITY)
        assert state["width"] <= state["clientWidth"] * 0.55 + 0.5
        assert state["attr"] == " ".join(frozen)
        assert state["edges"] == frozen[-1] and state["shadows"] == [frozen[-1]]
        # The reader's choice is untouched: nothing stored, all seven ticked.
        assert state["stored"] is None
        let_go = IDENTITY[len(frozen):]
        assert scroll_to_metric(page, state) == {"header": True, "cell": True}
        # Date is no longer cut off: it scrolls fully into view.
        assert column_fully_visible(page, "time", state)
        frozen_section(page)
        menu = page.evaluate(MENU_STATE)
        assert menu["checked"] == IDENTITY
        assert menu["reset"] == "true"
        assert menu["note"] == fit_note(let_go)
        assert menu["noteVisible"] and menu["describedBy"] == "mv-frozen-fit"
    finally:
        view.close()


def test_run_name_stays_frozen_however_narrow(browser):
    view = open_runs(browser, 720)
    try:
        page = view.page
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == ["run"]
        assert state["width"] > state["clientWidth"] * 0.55  # Run name alone
        frozen_section(page)
        assert page.evaluate(MENU_STATE)["note"] == fit_note(IDENTITY[1:])
    finally:
        view.close()


def test_fitting_keeps_the_saved_choice_and_follows_resizes(browser):
    choice = ["run", "status", "task", "dataset", "time"]
    view = open_runs(browser, 1280)
    try:
        page = view.page
        # Seeded once (not on every load), so the reload below reads back
        # only what the page itself saved.
        page.evaluate(
            "([key, value]) => localStorage.setItem(key, value)",
            [STORAGE_KEY, json.dumps(choice)],
        )
        page.reload()
        page.wait_for_function(
            "() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0"
        )
        settle(page)
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == ["run", "status", "task"]
        assert json.loads(state["stored"]) == choice
        frozen_section(page)
        menu = page.evaluate(MENU_STATE)
        assert menu["checked"] == choice
        assert menu["reset"] == "false"
        assert menu["note"] == fit_note(["dataset", "time"])

        # Narrower with the menu open: re-checked, and the note follows.
        resize(page, 720)
        assert page.evaluate(FROZEN_STATE)["frozen"] == ["run"]
        menu = page.evaluate(MENU_STATE)
        assert menu["note"] == fit_note(["status", "task", "dataset", "time"])
        assert menu["checked"] == choice

        # Wide enough again: the whole choice is frozen, no note.
        resize(page, 2560)
        state = page.evaluate(FROZEN_STATE)
        assert state["frozen"] == choice
        assert state["edges"] == "task dataset time"
        assert page.evaluate(MENU_STATE)["note"] == ""
        assert json.loads(state["stored"]) == choice

        # A change made while fitted saves exactly what the reader ticked.
        resize(page, 1280)
        toggle_with_keyboard(page, "Status")
        state = page.evaluate(FROZEN_STATE)
        assert json.loads(state["stored"]) == ["run", "task", "dataset", "time"]
        assert state["frozen"] == ["run", "task"]
        assert page.evaluate(MENU_STATE)["note"] == fit_note(["dataset", "time"])

        page.reload()
        page.wait_for_function(
            "() => window.__dashboardTest?.state.dashboardPage?.rows.length > 0"
        )
        settle(page)
        state = page.evaluate(FROZEN_STATE)
        assert json.loads(state["stored"]) == ["run", "task", "dataset", "time"]
        assert state["frozen"] == ["run", "task"]
        assert view.errors == []
    finally:
        view.close()


def test_a_table_that_does_not_scroll_keeps_every_chosen_column(browser):
    """Nothing scrolls sideways, so nothing needs letting go (and no note)."""
    # Wide enough for every default column, the Experiment column included.
    view = open_runs(browser, 2048, runs=wide_identity_runs())
    try:
        page = view.page
        assert page.evaluate(
            "() => { const s = document.getElementById('runs-table-scroll');"
            " return s.scrollWidth <= s.clientWidth; }"
        )
        assert page.evaluate(FROZEN_STATE)["frozen"] == IDENTITY
        frozen_section(page)
        assert page.evaluate(MENU_STATE)["note"] == ""
    finally:
        view.close()
