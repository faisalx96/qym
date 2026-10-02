"""Versioning dropdowns on the shipped dashboard: one per versioning_metadata key."""

from __future__ import annotations

import json

import pytest

from test_dashboard_paging_browser import (
    DashboardFixture,
    browser,
    make_runs,
)  # noqa: F401

pytestmark = pytest.mark.browser

VERSIONINGS = [
    {"agent_version": "v1", "kb_version": "381"},
    {"agent_version": "v2", "kb_version": "400"},
    {},  # a local run
]


def versioned_runs():
    runs = make_runs(12)
    for index, run in enumerate(runs):
        run["versioning"] = dict(VERSIONINGS[index % 3])
    return runs


def matches(run, versioning, skip=None):
    for key, values in versioning.items():
        if key == skip:
            continue
        value = run["versioning"].get(key) or "__empty__"
        if "__none__" in values or value not in values:
            return False
    return True


class VersioningFixture(DashboardFixture):
    """The paging fixture's fake API, plus the versioning filter and facets."""

    def scope(self, filters):
        self.last_filters = filters
        return [
            run
            for run in super().scope(filters)
            if matches(run, filters.get("versioning", {}))
        ]

    def overview(self, scoped):
        result = super().overview(scoped)
        filters = getattr(self, "last_filters", {})
        selected = filters.get("versioning", {})
        facets = {}
        for key in ("agent_version", "kb_version"):
            pool = [run for run in self.runs if matches(run, selected, skip=key)]
            values = sorted(
                {run["versioning"][key] for run in pool if key in run["versioning"]}
            )
            if any(key not in run["versioning"] for run in pool):
                values.append("__empty__")
            if values:
                facets[key] = values
        result["facets"]["versioning"] = facets
        return result

    def open(self):
        self.page.goto("https://qym.test/projects/demo")
        self.page.wait_for_function(
            "() => window.__dashboardTest?.state.dashboardPage?.rows.length === 12"
        )


@pytest.fixture
def dashboard(browser):  # noqa: F811
    view = VersioningFixture(browser, runs=versioned_runs())
    view.open()
    try:
        yield view
    finally:
        view.close()


def wrapper(page, key):
    return page.locator(f'#versioning-filters [data-versioning-key="{key}"]')


def choose_only(page, key, value):
    wrapper(page, key).locator(".multi-select-btn").click()
    option = wrapper(page, key).locator(f'.multi-select-option[data-value="{value}"]')
    option.hover()
    option.locator(".ms-only-btn").click()


def last_filters(view):
    path, query = [r for r in view.requests if r[0].endswith("/runs")][-1]
    return json.loads(query.get("filters", ["{}"])[0])


def test_one_dropdown_per_key_filters_runs(dashboard):
    page = dashboard.page
    assert page.locator("#versioning-filters").is_visible()
    buttons = page.locator("#versioning-filters .multi-select-btn")
    assert buttons.all_inner_texts() == ["All agent versions", "All KB versions"]

    choose_only(page, "agent_version", "v1")
    page.wait_for_function(
        "() => window.__dashboardTest.state.dashboardPage?.rows.length === 4"
    )
    assert last_filters(dashboard)["versioning"] == {"agent_version": ["v1"]}
    assert (
        wrapper(page, "agent_version").locator(".multi-select-btn").inner_text() == "v1"
    )
    assert "agent version: v1" in page.locator("#status-filter").inner_text()
    assert page.locator("#active-filter-count").text_content() == "1"
    assert page.locator("#clear-all-filters").get_attribute("aria-hidden") == "false"
    # The other key's values narrow to what the selection leaves.
    kb = wrapper(page, "kb_version").locator(".multi-select-option")
    assert kb.evaluate_all("nodes => nodes.map(n => n.dataset.value)") == ["381"]

    page.keyboard.press("Escape")
    page.locator("#clear-all-filters").click()
    page.wait_for_function(
        "() => window.__dashboardTest.state.dashboardPage?.rows.length === 12"
    )
    assert "versioning" not in last_filters(dashboard)
    assert buttons.all_inner_texts() == ["All agent versions", "All KB versions"]


def test_missing_key_option_and_state_survives_reload(dashboard):
    page = dashboard.page
    choose_only(page, "agent_version", "__empty__")
    page.wait_for_function(
        "() => window.__dashboardTest.state.dashboardPage?.rows.length === 4"
    )
    assert last_filters(dashboard)["versioning"] == {"agent_version": ["__empty__"]}
    assert (
        wrapper(page, "agent_version").locator(".multi-select-btn").inner_text()
        == "Empty / Missing"
    )

    page.reload()
    page.wait_for_function(
        "() => window.__dashboardTest?.state.dashboardPage?.rows.length === 4"
    )
    assert page.evaluate("window.__dashboardTest.dashboardFilters().versioning") == {
        "agent_version": ["__empty__"]
    }
