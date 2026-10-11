"""Current versions on the Models step, in a real browser (experiment_launch.js).

For each selected environment the step shows what a job started now would
record as ``versioning_details`` (``GET …/eval-environments/{id}/versioning-details``,
guide v1.2 §3.5): agent / image / kb with "not set" for a missing key, a
"Couldn't read" state with the service's reason, "Not supported" for an older
service, and a loading state. Read once when the step is shown, and again on
Refresh, never on a re-render.
"""

from __future__ import annotations

from urllib.parse import urlparse

import pytest
from test_experiment_launch_browser import LaunchFixture

pytestmark = pytest.mark.browser

PATH = "/v1/projects/p/eval-environments/e1/versioning-details"


class VersionsFixture(LaunchFixture):
    def __init__(self, browser):
        self.answer = {
            "environment_id": "e1",
            "status": "ok",
            "versioning_details": {"agent_version": "v2.4.0", "kb_version": "4b0535c"},
            "error": None,
            "fetched_at": "2026-10-11T10:00:00Z",
        }
        self.answer_status = 200
        self.reads = 0
        self.hold = False
        self.held = []
        super().__init__(browser)

    def route(self, route):
        if urlparse(route.request.url).path == PATH:
            self.reads += 1
            if self.hold:
                self.held.append(route)
                return
            route.fulfill(status=self.answer_status, json=dict(self.answer))
        else:
            super().route(route)

    def release(self):
        held, self.held = self.held, []
        for route in held:
            route.fulfill(json=dict(self.answer))

    def row(self):
        return self.page.locator('[data-xl-env-version="e1"]')

    def status(self):
        return self.row().get_attribute("data-xl-env-version-status")

    def value(self, key):
        return self.row().locator(f'[data-xl-version-key="{key}"] dd').inner_text()


@pytest.fixture
def launch(browser):  # noqa: F811
    view = VersionsFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_models_step_shows_the_current_versions_once(launch):
    launch.open()
    page = launch.page
    # Not read before the Models step is shown.
    launch.customize(1)
    page.wait_for_timeout(200)
    assert launch.reads == 0
    launch.step(3)
    page.wait_for_selector(
        '[data-xl-env-version="e1"][data-xl-env-version-status="ok"]'
    )
    assert launch.reads == 1
    assert launch.value("agent_version") == "v2.4.0"
    assert launch.value("kb_version") == "4b0535c"
    assert launch.value("image_version") == "not set"
    block = page.locator("[data-xl-env-versions]")
    assert "Staging" in block.inner_text()
    assert "Current versions" in block.inner_text()

    # Re-renders of the step (leaving and coming back) do not read again.
    launch.step("env")
    launch.step(3)
    page.wait_for_timeout(200)
    assert launch.reads == 1
    assert launch.status() == "ok"

    # Refresh reads again and shows the new values.
    launch.answer["versioning_details"] = {
        "agent_version": "v2.5.0",
        "image_version": "2026.10.11",
        "kb_version": "4b0535c",
    }
    launch.hold = True
    page.locator("[data-xl-env-versions-refresh]").click()
    page.wait_for_selector(
        '[data-xl-env-version="e1"][data-xl-env-version-status="loading"]'
    )
    assert page.locator("[data-xl-env-versions-refresh]").is_disabled()
    launch.release()
    page.wait_for_function(
        "() => { const dd = document.querySelector('[data-xl-version-key=\"agent_version\"] dd');"
        " return !!dd && dd.textContent === 'v2.5.0'; }"
    )
    assert launch.reads == 2
    assert launch.value("image_version") == "2026.10.11"
    assert page.locator("[data-xl-env-versions-refresh]").is_enabled()


def test_unsupported_and_error_states(launch):
    launch.answer = {
        "environment_id": "e1",
        "status": "unsupported",
        "versioning_details": {},
        "error": None,
        "fetched_at": "2026-10-11T10:00:00Z",
    }
    launch.open()
    launch.customize(3)
    page = launch.page
    page.wait_for_selector('[data-xl-env-version-status="unsupported"]')
    assert "Not supported by this environment" in launch.row().inner_text()

    launch.answer = {
        "environment_id": "e1",
        "status": "error",
        "versioning_details": {},
        "error": "could not read KB version: database unreachable",
        "fetched_at": "2026-10-11T10:00:00Z",
    }
    page.locator("[data-xl-env-versions-refresh]").click()
    page.wait_for_selector('[data-xl-env-version-status="error"]')
    assert (
        "Couldn't read: could not read KB version: database unreachable"
        in launch.row().inner_text()
    )


def test_a_failed_request_is_shown_in_place(launch):
    launch.answer = {"detail": "No API key configured for this environment"}
    launch.answer_status = 400
    launch.open()
    launch.customize(3)
    page = launch.page
    page.wait_for_selector('[data-xl-env-version-status="error"]')
    assert "Couldn't read: No API key configured" in launch.row().inner_text()
    assert not launch.errors
