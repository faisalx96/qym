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
        self.slots = []
        self.put_bodies = []
        # hold_refresh: schema refresh answers wait for release_refresh().
        self.hold_refresh = False
        self.held = []
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
        elif path == "/v1/projects/p/eval-environments/e1" and method == "GET":
            route.fulfill(
                json=dict(
                    ENV,
                    base_url="https://staging.example",
                    api_key_set=True,
                    is_active=True,
                )
            )
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
        elif (
            path == "/v1/projects/p/eval-environments/e1/model-slots"
            and method == "PUT"
        ):
            body = json.loads(route.request.post_data)
            self.put_bodies.append(body)
            self.slots = [dict(s, status="confirmed") for s in body["slots"]]
            route.fulfill(
                json={
                    "slots": self.slots,
                    "schema_id": "s1",
                    "needs_confirmation": False,
                }
            )
        elif path == "/v1/projects/p/eval-environments/e1/model-slots":
            route.fulfill(
                json={
                    "slots": self.slots,
                    "schema_id": "s1",
                    "needs_confirmation": False,
                }
            )
        elif (
            path == "/v1/projects/p/eval-environments/e1/schema/refresh"
            and method == "POST"
        ):
            self.posts.append(path)
            if self.hold_refresh:
                self.held.append(route)
                return
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

    def release_refresh(self):
        """Answers the held schema refreshes (see hold_refresh)."""
        held, self.held = self.held, []
        for route in held:
            route.fulfill(
                json={
                    **self.refresh,
                    "schema_hash": "new",
                    "slots": [],
                    "needs_confirmation": False,
                }
            )

    def customize(self, step):
        """Entry screen → Customize, on wizard step `step`."""
        self.page.locator("[data-xl-customize]").click()
        self.page.wait_for_selector('[data-xl-view="customize"]')
        self.page.locator(f'[data-xl-step="{step}"]').click()

    def wait(self, predicate, timeout=10):
        """Polls a Python-side condition (route counters) while the page runs."""
        for _ in range(int(timeout * 20)):
            if predicate():
                return
            self.page.wait_for_timeout(50)
        raise AssertionError("condition not met")


@pytest.fixture
def launch(browser):  # noqa: F811
    view = LaunchFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_entry_screen_then_customize_wizard(launch):
    launch.open()
    page = launch.page
    entry = page.locator('[data-xl-view="entry"]')
    # Entry: where it runs (environment and dataset) and the starting points.
    sections = entry.locator("[data-xl-section]").evaluate_all(
        "ns => ns.map(n => n.dataset.xlSection)"
    )
    assert sections == ["environments", "dataset"]
    for kind in ("official", "best_run", "clone", "blank"):
        assert entry.locator(f'[data-xl-start="{kind}"]').count() == 1, kind
    assert entry.locator("[data-xl-launch]").inner_text() == "Launch as is"
    # From scratch is chosen with one click; the bar says what launches.
    entry.locator('[data-xl-start="blank"]').click()
    assert (
        entry.locator('[data-xl-start="blank"]').get_attribute("aria-pressed") == "true"
    )
    # Customize: five steps, one shown at a time.
    entry.locator("[data-xl-customize]").click()
    wizard = page.locator('[data-xl-view="customize"]')
    wizard.wait_for()
    assert wizard.locator("[data-xl-step]").count() == 5
    visible = "ns => ns.filter(n => !n.hidden).map(n => n.dataset.xlStepGroup)"
    assert wizard.locator("[data-xl-step-group]").evaluate_all(visible) == ["1"]
    wizard.locator("[data-xl-step-next]").click()
    assert wizard.locator("[data-xl-step-group]").evaluate_all(visible) == ["2"]
    # Settings: overrides, role overrides, sweeps, evaluation inputs, raw JSON.
    wizard.locator('[data-xl-step="4"]').click()
    step = wizard.locator('[data-xl-step-group="4"]')
    assert step.locator("details:not([data-xl-group])").count() == 0
    order = step.locator(
        "[data-xl-section], [data-xa-section], [data-xl-sweeps]"
    ).evaluate_all(
        "ns => ns.map(n => n.dataset.xlSection || n.dataset.xaSection || 'sweeps')"
    )
    assert order == ["settings", "roles", "sweeps", "inputs", "json"]
    page.wait_for_selector('[data-xa-panel="roles"] [data-xa-row]')
    # Review and launch takes the preview into the main column.
    wizard.locator('[data-xl-step="5"]').click()
    assert wizard.locator('[data-xl-step-group="5"] .xl-preview').count() == 1
    assert wizard.locator("[data-xl-side]").is_hidden()
    # Back to the entry screen keeps the choices.
    wizard.locator(".xl-back").click()
    assert (
        page.locator('[data-xl-start="blank"]').get_attribute("aria-pressed") == "true"
    )


def test_a_problem_outside_the_entry_screen_opens_its_step(launch):
    launch.open()
    page = launch.page
    page.locator('[data-xl-view="entry"] [data-xl-entry-fix]').wait_for()
    # "Name the experiment" is on the entry screen itself.
    page.locator("[data-xl-entry-fix]").click()
    assert page.locator('[data-xl-view="entry"]').count() == 1


def test_all_roles_sets_a_column_on_every_role_shown(launch):
    launch.open()
    page = launch.page
    launch.customize(4)
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


def test_selecting_an_environment_refreshes_its_schema_once(launch):
    launch.open()
    page = launch.page
    launch.wait(lambda: launch.posts and launch.form_loads >= 1)
    page.wait_for_timeout(300)
    # No manual button: the schema is re-read when the environment is selected.
    assert page.locator("[data-xl-env-refresh]").count() == 0
    assert launch.posts == ["/v1/projects/p/eval-environments/e1/schema/refresh"]
    loads = launch.form_loads
    # Unchanged: quiet, and the form is not reloaded.
    assert page.evaluate("window.toasts") == []
    # Selecting it again on the same page does not refresh again.
    page.locator('[data-xl-env="e1"]').uncheck()
    page.locator('[data-xl-env="e1"]').check()
    page.wait_for_timeout(300)
    assert len(launch.posts) == 1
    assert launch.form_loads >= loads


def test_a_changed_schema_reloads_the_form(launch):
    launch.refresh = {"changed": True, "added": ["/A"], "removed": []}
    launch.hold_refresh = True
    launch.open()
    page = launch.page
    launch.wait(lambda: launch.held)
    launch.release_refresh()
    page.wait_for_function("() => window.toasts.length === 1")
    assert page.evaluate("window.toasts[0]") == [
        "Schema updated for Staging (1 added, 0 removed)",
        "info",
    ]
    # The environment's form is loaded again from the new schema.
    launch.wait(lambda: launch.form_loads >= 2)


def test_members_also_get_the_refresh(launch):
    launch.manager = False
    launch.open()
    launch.wait(lambda: launch.posts)
    assert launch.page.locator("[data-xl-env-refresh]").count() == 0


def test_all_entries_sets_a_setting_on_every_collection_entry(launch):
    launch.open()
    page = launch.page
    launch.customize(4)
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


def test_settings_groups_stay_closed_unless_the_user_opens_them(launch):
    launch.open()
    page = launch.page
    launch.customize(4)
    settings = page.locator('[data-xl-section="settings"]')
    page.wait_for_function("() => document.querySelector('[data-xa-edit-roles]')")
    groups = settings.locator("details[data-xl-group]")
    is_open = "ns => ns.map(n => n.open)"
    assert not any(groups.evaluate_all(is_open))
    # The user opens one; a re-render (e.g. a schema refresh) keeps exactly that.
    first = groups.first.get_attribute("data-xl-group")
    groups.first.locator("summary").click()
    page.locator('[data-xl-step="1"]').click()
    page.locator('[data-xl-env="e1"]').uncheck()
    page.locator('[data-xl-env="e1"]').check()
    page.locator('[data-xl-step="4"]').click()
    page.wait_for_function("() => document.querySelector('[data-xa-edit-roles]')")
    states = dict(
        settings.locator("details[data-xl-group]").evaluate_all(
            "ns => ns.map(n => [n.dataset.xlGroup, n.open])"
        )
    )
    assert states.pop(first) is True and not any(states.values())
    # A search opens matching groups only while it is active.
    search = settings.get_by_placeholder("Search settings")
    search.fill("temperature")
    assert any(settings.locator("details[data-xl-group]").evaluate_all(is_open))
    search.fill("")
    states = dict(
        settings.locator("details[data-xl-group]").evaluate_all(
            "ns => ns.map(n => [n.dataset.xlGroup, n.open])"
        )
    )
    assert states.pop(first) is True and not any(states.values())


def test_dataset_has_no_custom_string(launch):
    launch.open()
    dataset = launch.page.locator('[data-xl-section="dataset"]')
    assert dataset.get_by_role("button", name="Custom string").count() == 0
    assert dataset.get_by_label("Custom dataset string").count() == 0


def test_llm_groups_pop_up_moves_keys_into_another_group(launch):
    from qym_platform.services.eval_model_slots import detect_model_slots

    launch.slots = [
        dict(p.to_dict(), status="confirmed") for p in detect_model_slots(DESCRIPTOR)
    ]
    launch.open()
    page = launch.page
    launch.customize(3)
    page.locator('[data-xl-edit-groups="e1"]').click()
    dialog = page.locator("#env-grouping-dialog")
    primary = dialog.locator('[data-slot-key="endpoint:primary"]')
    primary.wait_for()
    assert primary.locator(".env-keyset").count() == 1
    # "+ Add another set of keys" adds an empty set; Remove takes it away again.
    primary.get_by_role("button", name="+ Add another set of keys").click()
    assert primary.locator(".env-keyset").count() == 2
    primary.locator("[data-slot-remove-set]").click()
    assert primary.locator(".env-keyset").count() == 1
    # Moving the VIZ group's keys makes them a second key set of the primary group.
    dialog.locator(
        '[data-slot-key="flat:VIZ_LLM"] select[data-slot-merge]'
    ).select_option(label="Primary model")
    assert primary.locator(".env-keyset").count() == 2
    dialog.locator("[data-grouping-save]").click()
    page.wait_for_function("() => !document.querySelector('#env-grouping-dialog')")
    (body,) = launch.put_bodies
    (saved,) = body["slots"]
    assert saved["slot_key"] == "endpoint:primary"
    assert saved["extra_field_maps"] == [
        {"model": "/VIZ_LLM_MODEL", "base_url": None, "api_key": None}
    ]
    # The launch form reloads the environment: the card says what it fills.
    page.wait_for_function(
        "() => /in 2 key sets/.test(document.querySelector('[data-xl-section=\"models\"]').innerText)"
    )


def test_llm_groups_pop_up_requires_a_model_in_every_key_set(launch):
    from qym_platform.services.eval_model_slots import detect_model_slots

    launch.slots = [
        dict(p.to_dict(), status="confirmed") for p in detect_model_slots(DESCRIPTOR)
    ]
    launch.open()
    page = launch.page
    launch.customize(3)
    page.locator('[data-xl-edit-groups="e1"]').click()
    dialog = page.locator("#env-grouping-dialog")
    primary = dialog.locator('[data-slot-key="endpoint:primary"]')
    primary.get_by_role("button", name="+ Add another set of keys").click()
    dialog.locator("[data-grouping-save]").click()
    assert dialog.get_by_text(
        "Every set of keys needs a model field"
    ).first.is_visible()
    assert launch.put_bodies == []
    page.keyboard.press("Escape")
    assert page.locator("#env-grouping-dialog").count() == 0


def test_environments_tab_lists_and_opens_the_environment_page(launch):
    page = launch.page
    page.goto("https://qym.test/projects/demo/experiments?view=environments")
    tab = page.locator('[data-exp-tab="environments"]')
    tab.wait_for()
    assert tab.get_attribute("aria-selected") == "true"
    page.get_by_role("button", name="Manage").click()
    page.wait_for_selector('[data-env-page="e1"] [data-sec="status"] .env-section')
    assert "?environment=e1" in page.url
    assert page.locator("[data-env-page-title]").text_content() == "Staging"
    # The drawer's sections, as cards on the page; no drawer is opened.
    sections = page.locator("[data-env-page-body] > [data-sec]").evaluate_all(
        "ns => ns.map(n => n.dataset.sec)"
    )
    assert set(sections) == {"status", "schema", "slots", "presets", "settings"}
    assert page.locator("#shell-drawer").count() == 0
    page.locator("[data-env-page-back]").click()
    page.wait_for_function("() => location.search === '?view=environments'")


def test_typing_the_name_keeps_focus_and_does_not_rebuild_the_form(launch):
    """Regression: each keystroke rebuilt the entry bar (dropping the focus) and
    re-rendered the hidden Advanced panel in Customize."""
    launch.open()
    page = launch.page
    launch.wait(lambda: launch.form_loads >= 1)
    name = page.locator("[data-xl-entry-name]")
    page.evaluate("window.__name = document.querySelector('[data-xl-entry-name]')")
    name.press_sequentially("rag threshold", delay=30)
    # The debounced dry run lands too; the field survives it.
    page.wait_for_timeout(800)
    assert name.input_value() == "rag threshold"
    assert page.evaluate(
        "document.activeElement === window.__name"
        " && document.querySelector('[data-xl-entry-name]') === window.__name"
    )
    # Customize: typing the name leaves the (hidden) Settings step alone.
    launch.customize(1)
    page.wait_for_selector('[data-xa-panel="roles"] [data-xa-row]', state="attached")
    page.evaluate("""() => {
          window.__added = 0;
          new MutationObserver((ms) => {
            window.__added += ms.reduce((n, m) => n + m.addedNodes.length, 0);
          }).observe(document.querySelector('[data-xl-step-group="4"]'),
                     { childList: true, subtree: true });
        }""")
    field = page.locator('[data-xl-pointer="#name"]')
    field.fill("")
    field.press_sequentially(" on staging", delay=20)
    page.wait_for_timeout(800)
    assert field.input_value() == " on staging"
    assert page.evaluate("window.__added") == 0


def test_dataset_card_matches_the_environment_card_height(launch):
    launch.open()
    page = launch.page
    launch.wait(lambda: launch.form_loads >= 1)
    heights = (
        "() => ['environments', 'dataset'].map(k => Math.round("
        "document.querySelector('[data-xl-view=\"entry\"] [data-xl-section=\"' + k + '\"]')"
        ".getBoundingClientRect().height))"
    )
    env_h, data_h = page.evaluate(heights)
    assert env_h == data_h
    # It grows with the environment card (e.g. a long environment list).
    page.evaluate(
        "document.querySelector('[data-xl-section=\"environments\"] [data-xl-body]')"
        ".style.minHeight = '400px'"
    )
    env_h2, data_h2 = page.evaluate(heights)
    assert env_h2 > env_h and env_h2 == data_h2
