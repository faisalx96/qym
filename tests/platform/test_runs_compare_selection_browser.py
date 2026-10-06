"""C043: runs ticked for Compare on the Runs list stay ticked through Back,
Forward and in-app navigation, per project, until the user clears them; runs
that no longer exist drop out. Against the real app."""

from __future__ import annotations

from datetime import datetime

import pytest

from qym_platform.db.models import Project, Run, RunWorkflowStatus
from test_archived_project_browser import _publish, browser  # noqa: F401
from test_dashboard_paging_browser import DashboardFixture, make_runs
from test_p1_navigation_browser import _runs_ready, app, factory  # noqa: F401

pytestmark = pytest.mark.browser

SELECTION_KEY = "qym:runs-selection:"


def _select(page, *run_ids):
    if page.locator("#select-mode-btn").get_attribute("aria-pressed") != "true":
        page.locator("#select-mode-btn").click()
    for run_id in run_ids:
        page.get_by_role("checkbox", name=f"Select run {run_id}", exact=True).check()


def _selection(page):
    """What the Runs list shows as selected right now."""
    return page.evaluate(
        """() => {
          const panel = document.getElementById('compare-panel');
          const shown = !!panel && getComputedStyle(panel).display !== 'none';
          return {
            mode: document.getElementById('select-mode-btn').getAttribute('aria-pressed'),
            count: shown ? document.getElementById('compare-count').textContent.trim() : '',
            clear: shown ? document.getElementById('compare-clear').textContent.trim() : '',
            ticked: [...document.querySelectorAll('#runs-tbody tr[data-file] .row-checkbox')]
              .filter(box => box.checked)
              .map(box => decodeURIComponent(box.closest('tr').dataset.file)),
          };
        }"""
    )


def _wait_for_count(page, text):
    page.wait_for_function(
        """text => {
          const panel = document.getElementById('compare-panel');
          return !!panel && getComputedStyle(panel).display !== 'none'
            && document.getElementById('compare-count').textContent.trim() === text;
        }""",
        arg=text,
    )


def _nav(page, name):
    page.locator(f'.sidebar .nav-item[data-page="{name}"]').first.click()


def test_selection_survives_compare_back_forward_and_in_app_navigation(app):
    page = app.goto("/projects/pa?page=2")
    _runs_ready(page)
    page.evaluate("window.__noReload = true")
    _select(page, "run-060")
    _wait_for_count(page, "1 execution selected")
    # The sidebar's Runs link opens page 1 as a new entry; the pick from
    # page 2 is still part of the selection there.
    _nav(page, "runs")
    page.wait_for_function("() => location.pathname === '/projects/pa' && !location.search")
    _runs_ready(page)
    _wait_for_count(page, "1 execution selected")
    _select(page, "run-001", "run-003")
    _wait_for_count(page, "3 executions selected")

    page.locator("#compare-view").click()
    page.wait_for_url("**/compare?**")
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    _wait_for_count(page, "3 executions selected")
    state = _selection(page)
    assert state["mode"] == "true"
    assert sorted(state["ticked"]) == ["run-001", "run-003"]

    page.go_forward()
    page.wait_for_url("**/compare?**")
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    _wait_for_count(page, "3 executions selected")

    # Away through the sidebar and back to Runs: a new history entry, same
    # selection.
    _nav(page, "overview")
    page.wait_for_url("**/projects/pa/overview")
    _nav(page, "runs")
    page.wait_for_function("() => location.pathname === '/projects/pa' && !location.search")
    _runs_ready(page)
    _wait_for_count(page, "3 executions selected")
    assert sorted(_selection(page)["ticked"]) == ["run-001", "run-003"]
    assert page.evaluate("window.__noReload === true")

    # Clear is the way out, and it holds across navigation too.
    page.locator("#compare-clear").click()
    page.locator("#runs-tbody a.run-id").first.click()
    page.wait_for_url("**/projects/pa/runs/**")
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    page.wait_for_timeout(300)
    state = _selection(page)
    assert state["count"] == "" and state["ticked"] == []
    assert page.evaluate(
        "k => sessionStorage.getItem(k)", SELECTION_KEY + "pa"
    ) is None


def test_cohort_a_survives_opening_a_run_and_coming_back(app):
    page = app.goto("/projects/pa")
    _runs_ready(page)
    _select(page, "run-001", "run-002")
    page.locator("#cohort-view").click()
    _wait_for_count(page, "Cohort B 0/2 executions")
    _select(page, "run-004")
    page.locator("#runs-tbody a.run-id").nth(5).click()
    page.wait_for_url("**/projects/pa/runs/**")
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    _wait_for_count(page, "Cohort B 1/2 executions")
    state = _selection(page)
    assert state["clear"] == "Cancel Cohort"
    assert state["ticked"] == ["run-004"]


def test_deleted_runs_drop_out_of_the_kept_selection(app, factory):  # noqa: F811
    page = app.goto("/projects/pa")
    _runs_ready(page)
    _select(page, "run-001", "run-002", "run-003")
    _wait_for_count(page, "3 executions selected")
    page.locator("#runs-tbody a.run-id").first.click()
    page.wait_for_url("**/projects/pa/runs/**")

    # Someone deletes one of the picked runs while the reader is away.
    response = app.client.post("/api/runs/delete", json={"file_path": "run-002"})
    assert response.status_code == 200, response.text
    _publish(factory)

    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    _wait_for_count(page, "2 executions selected")
    page.wait_for_function(
        "() => !document.querySelector('#runs-tbody tr[data-file=\"run-002\"]')"
    )
    assert sorted(_selection(page)["ticked"]) == ["run-001", "run-003"]
    # The dropped run is not written back on the way out.
    _nav(page, "overview")
    page.wait_for_url("**/projects/pa/overview")
    stored = page.evaluate("k => sessionStorage.getItem(k)", SELECTION_KEY + "pa")
    assert stored is not None and "run-002" not in stored and "run-001" in stored


def test_kept_off_page_picks_count_and_compare_right_before_the_list_answers(
    app, factory  # noqa: F811
):
    """Back shows the cached rows at once and revalidates. A kept pick from
    another page (a repeat run of three passes) must already count as its
    three executions and open Compare as three pass columns then; before,
    the cached page held no data for it until the list answered, so it
    counted as one and Compare got the whole run (its final-pass outputs in
    one misleading column)."""
    with factory() as db:
        db.get(Run, "run-060").samples = 3
        db.commit()
    _publish(factory)
    page = app.goto("/projects/pa?page=2")
    _runs_ready(page)
    _select(page, "run-060")
    _wait_for_count(page, "3 executions selected")
    _nav(page, "runs")
    page.wait_for_function("() => location.pathname === '/projects/pa' && !location.search")
    _runs_ready(page)
    _select(page, "run-001")
    _wait_for_count(page, "4 executions selected")
    page.locator("#runs-tbody a.run-id").nth(3).click()
    page.wait_for_url("**/projects/pa/runs/**")

    # Hold the revalidation so the cached rows are what the reader acts on.
    held = []
    page.route("**/api/dashboard/runs*", lambda route: held.append(route))
    try:
        page.go_back()
        page.wait_for_function("() => location.pathname === '/projects/pa'")
        page.wait_for_function(
            "() => document.getElementById('table-view')?.getAttribute('aria-busy') === 'true'"
            " && !!document.querySelector('#runs-tbody a.run-id')"
        )
        assert held, "the list request should still be pending"
        assert _selection(page)["count"] == "4 executions selected"
        page.locator("#compare-view").click()
        page.wait_for_url("**/compare?**")
        runs = page.evaluate("() => new URLSearchParams(location.search).getAll('runs')")
        assert sorted(runs) == [
            "run-001", "run-060::pass1", "run-060::pass2", "run-060::pass3",
        ]
    finally:
        page.unroute("**/api/dashboard/runs*")
        for route in held:
            try:
                route.continue_()
            except Exception:  # the page that asked has gone
                pass


def _add_second_project(factory):  # noqa: F811
    now = datetime.utcnow()
    with factory() as db:
        db.add(Project(id="pb", name="Other bot", slug="pb", created_by_user_id="dev"))
        db.flush()
        db.add(
            Run(
                id="pb-run",
                project_id="pb",
                created_by_user_id="dev",
                owner_user_id="dev",
                task="other",
                dataset="golden",
                model="m-a",
                metrics=["accuracy"],
                run_metadata={},
                run_config={},
                status=RunWorkflowStatus.COMPLETED,
                started_at=now,
                ended_at=now,
                created_at=now,
            )
        )
        db.commit()
    _publish(factory)


def test_selection_belongs_to_its_project(app, factory):  # noqa: F811
    _add_second_project(factory)
    page = app.goto("/projects/pb")
    _runs_ready(page)
    page.evaluate("window.__noReload = true")
    page.evaluate("QymShell.navigateTo('/projects/pa')")
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    _select(page, "run-001", "run-003")
    _wait_for_count(page, "2 executions selected")

    # Back to the other project in the same tab: by the time the Runs page of
    # pa saves, the address already shows pb; the selection still belongs
    # to pa only.
    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pb'")
    _runs_ready(page)
    page.wait_for_timeout(300)
    state = _selection(page)
    assert state["mode"] == "false" and state["count"] == "" and state["ticked"] == []
    assert page.evaluate("window.__noReload === true")

    page.go_forward()
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    _wait_for_count(page, "2 executions selected")

    page = app.goto("/projects/pb")
    _runs_ready(page)
    page.wait_for_timeout(300)
    assert _selection(page)["ticked"] == []


def test_back_to_another_project_keeps_each_projects_filters(app, factory):  # noqa: F811
    """The outgoing page saves its filters under its own project, not under
    the project the address already shows after Back."""
    _add_second_project(factory)
    page = app.goto("/projects/pb")
    _runs_ready(page)
    page.evaluate("window.__noReload = true")
    page.evaluate("QymShell.navigateTo('/projects/pa?model=m-b')")
    page.wait_for_function("() => location.pathname === '/projects/pa'")
    _runs_ready(page)
    assert page.locator("#filter-model-btn").inner_text().strip() == "m-b"

    page.go_back()
    page.wait_for_function("() => location.pathname === '/projects/pb'")
    # The rows of pa can still be on screen, so wait for the rows of pb.
    page.wait_for_function("() => [...document.querySelectorAll('#runs-tbody a.run-id')].map(a => a.textContent.trim()).join() === 'pb-run'")
    _runs_ready(page)
    assert page.locator("#runs-tbody a.run-id").all_inner_texts() == ["pb-run"]
    assert page.evaluate("location.search") == ""
    assert page.evaluate("window.__noReload === true")


def test_a_kept_pass_pick_drops_out_when_the_runs_passes_changed(browser):  # noqa: F811
    """A pass reference names a pass as numbered when it was picked. Kept
    across visits, it still drops out once the run's passes changed (a new
    pass_revision), as it does within one visit."""
    runs = make_runs(3)
    passes = [
        dict(pass_number=n, status="completed", metric_means={"accuracy": 0.5 + n / 10})
        for n in (1, 2)
    ]
    runs[0].update(samples=2, pass_summaries=passes, pass_revision=1)
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
    picked = "() => [...window.__dashboardTest.state.selectedRuns].sort()"
    loaded = "() => window.__dashboardTest?.state.dashboardPage?.rows.length === 3"
    try:
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function(loaded)
        page.locator('.samples-toggle[data-run-id="run-000"]').click()
        page.wait_for_function(
            "__dashboardTest.state._samplesData['run-000']?.passes?.samples === 2"
        )
        page.locator("#select-mode-btn").click()
        page.locator('.pass-checkbox[data-pass-ref="run-000::pass2"]').check()
        page.get_by_role("checkbox", name="Select run run-001", exact=True).check()
        assert page.evaluate(picked) == ["run-000::pass2", "run-001"]

        page.reload()  # pagehide saves, the new page restores
        page.wait_for_function(loaded)
        page.wait_for_function(
            "() => document.getElementById('table-view').getAttribute('aria-busy') !== 'true'"
        )
        assert page.evaluate(picked) == ["run-000::pass2", "run-001"]

        runs[0]["pass_revision"] = 2  # passes renumbered while away
        page.reload()
        page.wait_for_function(loaded)
        page.wait_for_function(
            "() => document.getElementById('table-view').getAttribute('aria-busy') !== 'true'"
        )
        assert page.evaluate(picked) == ["run-001"]
        _wait_for_count(page, "1 execution selected")
        assert view.errors == []
    finally:
        view.close()


def test_a_cohort_a_pass_pick_drops_out_when_the_runs_passes_changed(browser):  # noqa: F811
    """Cohort A names passes the same way as the checked runs: a locked pass
    reference drops out once its run's passes changed (a new pass_revision),
    both within one visit and when Cohort A is kept across visits. Before,
    only the checked runs were reconciled, so Cohort A kept naming a pass
    that now meant another execution."""
    runs = make_runs(4)
    passes = [
        dict(pass_number=n, status="completed", metric_means={"accuracy": 0.5 + n / 10})
        for n in (1, 2)
    ]
    runs[0].update(samples=2, pass_summaries=passes, pass_revision=1)
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
    anchor = "[...(window.__dashboardTest.state.cohortAnchorRuns || [])].sort()"
    loaded = "() => window.__dashboardTest?.state.dashboardPage?.rows.length === 4"
    settled = (
        "() => document.getElementById('table-view').getAttribute('aria-busy') !== 'true'"
    )

    def lock_cohort_a(pass_ref, run_id):
        page.locator('.samples-toggle[data-run-id="run-000"]').click()
        page.wait_for_function(
            "__dashboardTest.state._samplesData['run-000']?.passes?.samples === 2"
        )
        if page.locator("#select-mode-btn").get_attribute("aria-pressed") != "true":
            page.locator("#select-mode-btn").click()
        page.locator(f'.pass-checkbox[data-pass-ref="{pass_ref}"]').check()
        page.get_by_role("checkbox", name=f"Select run {run_id}", exact=True).check()
        page.locator("#cohort-view").click()
        page.wait_for_function(f"() => {anchor}.length === 2")

    try:
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function(loaded)

        # Kept across visits: the pick survives a reload, then drops out once
        # the run's passes were renumbered while away.
        lock_cohort_a("run-000::pass2", "run-001")
        assert page.evaluate(f"() => {anchor}") == ["run-000::pass2", "run-001"]
        page.reload()  # pagehide saves, the new page restores
        page.wait_for_function(loaded)
        page.wait_for_function(settled)
        assert page.evaluate(f"() => {anchor}") == ["run-000::pass2", "run-001"]
        runs[0]["pass_revision"] = 2
        page.reload()
        page.wait_for_function(loaded)
        page.wait_for_function(settled)
        assert page.evaluate(f"() => {anchor}") == ["run-001"]
        _wait_for_count(page, "Cohort B 0/1 executions")

        # Within one visit: a poll that brings a new pass_revision drops it.
        page.locator("#compare-clear").click()
        page.wait_for_function(f"() => {anchor}.length === 0")
        lock_cohort_a("run-000::pass1", "run-002")
        runs[0]["pass_revision"] = 3
        page.evaluate("() => window.__dashboardTest.fetchRuns()")
        page.wait_for_function(f"() => {anchor}.join(' ') === 'run-002'")
        _wait_for_count(page, "Cohort B 0/1 executions")
        assert view.errors == []
    finally:
        view.close()


# Sign-out (P1 round 2 leftover) ----------------------------------------------


def test_signing_out_clears_the_tabs_selection_and_saved_filters(app):
    """The kept selection, the saved filters and the runs cache live in this
    tab's sessionStorage. Nothing cleared them at sign-out, so the next person
    to sign in in the same tab got the previous user's picks and filters back.
    The sign-in page now starts the tab clean; a reload by the same user
    still keeps them."""
    page = app.goto("/projects/pa?model=m-b")
    _runs_ready(page)
    _select(page, "run-001", "run-003")
    _wait_for_count(page, "2 executions selected")
    page.reload()
    _runs_ready(page)
    _wait_for_count(page, "2 executions selected")
    saved = set(page.evaluate("() => Object.keys(sessionStorage)"))
    assert {SELECTION_KEY + "pa", "qym:dashboard-state:pa"} <= saved, saved

    page.locator("#shell-user-trigger").click()
    page.locator("#shell-signout-btn").click()
    page.wait_for_url("**/login?**")
    page.locator("#auth-root").wait_for()
    assert page.evaluate("() => Object.keys(sessionStorage)") == []

    # The next person to sign in in this tab: no picks, no saved filters.
    page = app.goto("/projects/pa")
    _runs_ready(page)
    page.wait_for_timeout(300)
    assert _selection(page)["count"] == ""
    assert page.evaluate("() => location.search") == ""
    assert " of " not in page.locator("#status-filter").inner_text()


# The pager with a kept selection (P1 round 2 leftover) -----------------------

STATUS_BAR_GEOMETRY = """() => {
  const box = node => {
    if (!node || getComputedStyle(node).display === 'none') return null;
    const rect = node.getBoundingClientRect();
    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
  };
  const bar = document.querySelector('.status-bar');
  const left = document.querySelector('.status-left');
  const mirror = document.querySelector('.qym-scroll-mirror');
  return {
    bar: box(bar),
    actions: box(document.getElementById('compare-panel')),
    actionsHidden: left.scrollWidth - left.clientWidth,
    pager: box(document.getElementById('table-pagination')),
    status: box(document.querySelector('.status-updated')),
    mirror: mirror && !mirror.hidden ? box(mirror) : null,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}"""


def _apart(first, second):
    return (
        first["right"] <= second["left"] + 0.5 or second["right"] <= first["left"] + 0.5
        or first["bottom"] <= second["top"] + 0.5 or second["bottom"] <= first["top"] + 0.5
    )


def _inside(inner, outer):
    return (
        inner["left"] >= outer["left"] - 0.5 and inner["right"] <= outer["right"] + 0.5
        and inner["top"] >= outer["top"] - 0.5 and inner["bottom"] <= outer["bottom"] + 0.5
    )


@pytest.mark.parametrize("width", [1280, 1440])
def test_the_pager_stays_usable_with_a_kept_selection(app, width):
    """C043 keeps the selection across navigation, but the status bar hid the
    pager while a selection was active, so a reader who came back to Runs
    could not page until they cleared it. The pager now stays, in one row
    with the selection actions and the status, all in full."""
    app.page.set_viewport_size({"width": width, "height": 900})
    page = app.goto("/projects/pa")
    _runs_ready(page)
    _select(page, "run-001", "run-003")
    _wait_for_count(page, "2 executions selected")
    # Away and back: the kept selection comes back with the pager.
    _nav(page, "overview")
    page.wait_for_url("**/projects/pa/overview")
    _nav(page, "runs")
    page.wait_for_function("() => location.pathname === '/projects/pa' && !location.search")
    _runs_ready(page)
    _wait_for_count(page, "2 executions selected")

    geometry = page.evaluate(STATUS_BAR_GEOMETRY)
    bar, actions, pager, status = (geometry[key] for key in ("bar", "actions", "pager", "status"))
    assert pager and actions and status, geometry
    for part in (actions, pager, status):
        assert _inside(part, bar), geometry
    assert _apart(actions, pager) and _apart(pager, status) and _apart(actions, status), geometry
    assert actions["right"] <= pager["left"] and pager["right"] <= status["left"], geometry
    assert geometry["actionsHidden"] == 0, geometry  # every action in view, none scrolled away
    assert round(bar["bottom"] - bar["top"]) == 38, geometry  # still one row
    assert geometry["pageOverflow"] == 0, geometry

    next_page = page.locator('#table-pagination [aria-label="Next page"]')
    assert next_page.is_visible() and next_page.is_enabled()
    next_page.click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('page') === '2'")
    _runs_ready(page)
    _wait_for_count(page, "2 executions selected")
    assert page.locator("#table-pagination .qym-pagination__input").input_value() == "2"


def test_a_narrow_bar_puts_the_pager_under_the_selection(app):
    """Where one row cannot hold the actions and the pager, the pager takes a
    second row; the table's scrollbar mirror stays above the taller bar."""
    app.page.set_viewport_size({"width": 1024, "height": 900})
    page = app.goto("/projects/pa")
    _runs_ready(page)
    _select(page, "run-001")
    _wait_for_count(page, "1 execution selected")
    page.wait_for_timeout(200)
    geometry = page.evaluate(STATUS_BAR_GEOMETRY)
    bar, actions, pager = geometry["bar"], geometry["actions"], geometry["pager"]
    assert pager and _inside(actions, bar) and _inside(pager, bar), geometry
    assert pager["top"] >= actions["bottom"], geometry
    assert geometry["actionsHidden"] == 0 and geometry["pageOverflow"] == 0, geometry
    assert geometry["mirror"] and abs(geometry["mirror"]["bottom"] - bar["top"]) <= 1, geometry
    page.locator('#table-pagination [aria-label="Next page"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('page') === '2'")

    # Clearing the selection gives the bar its own layout back, and the
    # mirror follows the bar's height.
    page.locator("#compare-clear").click()
    page.wait_for_function("() => !document.querySelector('.status-bar').classList.contains('selection-active')")
    page.wait_for_timeout(200)
    geometry = page.evaluate(STATUS_BAR_GEOMETRY)
    assert geometry["actions"] is None, geometry
    assert geometry["mirror"] and abs(geometry["mirror"]["bottom"] - geometry["bar"]["top"]) <= 1, geometry

