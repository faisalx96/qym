"""New-experiment launch form in a real browser: one Advanced disclosure,
"All roles" values and schema refresh (experiment_launch*.js)."""

from __future__ import annotations

import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlparse

import pytest
from qym_platform.services.eval_schema_form import build_form_descriptor
from test_dashboard_paging_browser import browser  # noqa: F401

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)
FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
DESCRIPTOR = build_form_descriptor(json.loads(FIXTURE.read_text()))
TABLE = DESCRIPTOR["fields"]["/LLM_OVERRIDES/{role}"]
ROLES = [row["key"] for row in TABLE["rows"]]
pytestmark = pytest.mark.browser

ENV = {
    "id": "e1",
    "name": "Staging",
    "health_status": "ok",
    "schema_hash": "old",
    "max_priority": "NORMAL",
    "model_slots": {"needs_confirmation": False},
}


class LaunchFixture:
    def __init__(self, browser):
        self.errors = []
        self.posts = []
        self.refresh = {"changed": False, "added": [], "removed": []}
        self.form_loads = 0
        self.manager = True
        self.context = browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        path = url.path
        method = route.request.method
        if path.startswith("/static/"):
            file = STATIC / path.split("/static/", 1)[1]
            if file.is_file():
                route.fulfill(
                    path=str(file),
                    content_type=mimetypes.guess_type(file.name)[0]
                    or "application/octet-stream",
                )
            else:
                route.fulfill(status=404, body="")
            return
        if path == "/projects/demo/experiments":
            source = (STATIC / "experiments.html").read_text()
            source = re.sub(
                r'<script src="/static/(?:auth|shell)\.js[^\"]*"></script>', "", source
            )
            route.fulfill(body=source, content_type="text/html")
        elif path == "/v1/me":
            route.fulfill(
                json={"id": "owner", "role": "ADMIN" if self.manager else "USER"}
            )
        elif path == "/v1/projects/by-slug/demo":
            role = "MANAGER" if self.manager else "MEMBER"
            route.fulfill(
                json={"id": "p", "slug": "demo", "name": "Demo", "role": role}
            )
        elif path == "/v1/projects/p/eval-environments":
            route.fulfill(json={"environments": [dict(ENV)]})
        elif path == "/v1/projects/p/eval-environments/e1/form":
            self.form_loads += 1
            route.fulfill(
                json={
                    "environment_id": "e1",
                    "schema_id": "s1",
                    "schema_hash": "old",
                    "descriptor": DESCRIPTOR,
                }
            )
        elif path == "/v1/projects/p/eval-environments/e1/model-slots":
            route.fulfill(json={"slots": [], "needs_confirmation": False})
        elif (
            path == "/v1/projects/p/eval-environments/e1/schema/refresh"
            and method == "POST"
        ):
            self.posts.append(path)
            route.fulfill(
                json={
                    **self.refresh,
                    "schema_hash": "new",
                    "slots": [],
                    "needs_confirmation": False,
                }
            )
        elif path == "/v1/projects/p/experiments" and method == "POST":
            route.fulfill(json={"errors": [], "runs": []})
        else:
            route.fulfill(status=404, json={"detail": path})

    def open(self):
        self.page.goto("https://qym.test/projects/demo/experiments?new=1")
        self.page.wait_for_selector("[data-xl-launch-form]")
        # shell.js is stripped from the page: record its toasts instead.
        self.page.evaluate(
            "window.toasts = []; window.QymShell = {"
            " toast: (message, type) => window.toasts.push([message, type]) };"
        )
        self.page.locator('[data-xl-env="e1"]').check()


@pytest.fixture
def launch(browser):  # noqa: F811
    view = LaunchFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_advanced_configuration_is_the_only_disclosure(launch):
    launch.open()
    page = launch.page
    outer = page.locator("[data-xl-advanced-config]")
    # No disclosure or tabs inside it: one card per part, in this order.
    assert outer.locator("details:not([data-xl-group])").count() == 0
    assert outer.locator("[role=tablist]").count() == 0
    order = outer.locator(
        "[data-xl-section], [data-xa-section], [data-xl-sweeps]"
    ).evaluate_all(
        "ns => ns.map(n => n.dataset.xlSection || n.dataset.xaSection || 'sweeps')"
    )
    assert order == ["settings", "roles", "sweeps", "inputs", "json"]
    outer.locator("summary").first.click()
    page.wait_for_selector('[data-xa-panel="roles"] [data-xa-row]')
    assert page.locator('[data-xa-panel="inputs"]').is_visible()
    # Closing and reopening the one disclosure shows the cards again.
    outer.locator("summary").first.click()
    assert not outer.evaluate("n => n.open")
    outer.locator("summary").first.click()
    assert page.locator('[data-xa-panel="roles"] [data-xa-row]').first.is_visible()


def test_all_roles_sets_a_column_on_every_role_shown(launch):
    launch.open()
    page = launch.page
    page.locator("[data-xl-advanced-config] summary").first.click()
    panel = page.locator('[data-xa-panel="roles"]')
    page.wait_for_selector('[data-xa-panel="roles"] [data-xa-row]')
    all_temperature = panel.get_by_label("All roles · temperature", exact=True)
    all_temperature.fill("0.3")
    all_temperature.press("Enter")
    for role in ROLES:
        assert (
            panel.get_by_label(f"{role} · temperature", exact=True).input_value()
            == "0.3"
        )
    assert (
        panel.get_by_label("All roles · temperature", exact=True).input_value() == "0.3"
    )
    # With a search, only the roles shown change.
    panel.get_by_label("Search roles").fill(ROLES[0])
    all_temperature = panel.get_by_label("All roles · temperature", exact=True)
    all_temperature.fill("0.9")
    all_temperature.press("Enter")
    panel.get_by_label("Search roles").fill("")
    assert (
        panel.get_by_label(f"{ROLES[0]} · temperature", exact=True).input_value()
        == "0.9"
    )
    assert (
        panel.get_by_label(f"{ROLES[1]} · temperature", exact=True).input_value()
        == "0.3"
    )
    assert (
        panel.get_by_label("All roles · temperature", exact=True).get_attribute(
            "placeholder"
        )
        == "Mixed"
    )
    # Clearing it resets every role to the service default.
    all_temperature = panel.get_by_label("All roles · temperature", exact=True)
    all_temperature.fill("x")
    all_temperature.fill("")
    all_temperature.press("Enter")
    for role in ROLES:
        assert (
            panel.get_by_label(f"{role} · temperature", exact=True).input_value() == ""
        )


def test_managers_refresh_the_schema_from_the_form(launch):
    launch.open()
    page = launch.page
    page.wait_for_function("() => document.querySelector('[data-xa-edit-roles]')")
    loads = launch.form_loads
    page.locator('[data-xl-env-refresh="e1"]').click()
    page.wait_for_function("() => window.toasts.length === 1")
    assert page.evaluate("window.toasts") == [
        ["Schema for Staging is up to date", "success"]
    ]
    assert launch.posts == ["/v1/projects/p/eval-environments/e1/schema/refresh"]
    assert page.locator(
        '[data-xl-env="e1"]'
    ).is_checked()  # the click did not toggle it
    assert launch.form_loads == loads  # unchanged schema: nothing to reload
    # A changed schema reloads the selected environment's form.
    launch.refresh = {"changed": True, "added": ["/A"], "removed": []}
    page.locator('[data-xl-env-refresh="e1"]').click()
    page.wait_for_function("() => window.toasts.length === 2")
    assert page.evaluate("window.toasts[1]") == [
        "Schema updated for Staging (1 added, 0 removed)",
        "success",
    ]
    page.wait_for_function("() => document.querySelector('[data-xa-edit-roles]')")
    assert launch.form_loads == loads + 1
    assert page.locator('[data-xl-env-refresh="e1"]').inner_text() == "Refresh schema"


def test_members_get_no_refresh_button(launch):
    launch.manager = False
    launch.open()
    page = launch.page
    page.wait_for_function("() => document.querySelector('[data-xa-edit-roles]')")
    assert page.locator("[data-xl-env-refresh]").count() == 0


def test_all_entries_sets_a_setting_on_every_collection_entry(launch):
    launch.open()
    page = launch.page
    page.locator("[data-xl-advanced-config] summary").first.click()
    settings = page.locator('[data-xl-section="settings"]')
    page.wait_for_function("() => document.querySelector('[data-xa-edit-roles]')")
    settings.locator("details[data-xl-group]").evaluate_all(
        "nodes => nodes.forEach(n => { n.open = true; })"
    )
    settings.get_by_label("New endpoint name").fill("secondary")
    settings.get_by_role("button", name="+ Add endpoint").click()
    all_timeout = settings.get_by_label("All endpoints · Timeout", exact=True)
    all_timeout.fill("30")
    all_timeout.press("Enter")
    for key in ("primary", "secondary"):
        pointer = f"/env_overrides/LLM_OVERRIDES/endpoints/{key}/timeout"
        assert settings.locator(f'[data-xl-pointer="{pointer}"]').input_value() == "30"
    # Keys are set through model slots: no "All" control for them.
    assert settings.get_by_label("All endpoints · Api Key", exact=True).count() == 0
