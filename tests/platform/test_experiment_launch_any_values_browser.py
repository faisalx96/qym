"""Launch form shows every value, whatever its schema shape (experiment_launch.js)."""

from __future__ import annotations

import json

import pytest
from qym_platform.services.eval_schema_form import build_form_descriptor

from test_experiment_launch_browser import ENV, LaunchFixture

pytestmark = pytest.mark.browser

SCHEMA = {
    "title": "EnvOverrides",
    "type": "object",
    "properties": {
        "THRESHOLD": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "MODE": {"anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]},
        "FLAG": {"type": "boolean"},
        "OPTIONS": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "additionalProperties": {"type": "integer"},
        },
        "TAGS": {"type": "array", "items": {"type": "string"}},
        "WHEN": {"type": "string", "format": "date-time"},
        "LIMITS": {"type": "object", "properties": {"max": {"type": "integer"}}},
    },
}
DESCRIPTOR = build_form_descriptor(SCHEMA)
PRESET = {
    "env_overrides": {
        "THRESHOLD": {"low": 0.1},  # not a number: edited as JSON
        "FLAG": "yes",  # not a boolean
        "OPTIONS": {"name": "a", "retries": 3},
        "LIMITS": 5,  # a scalar where the schema has a group: no setting shows it
    }
}


class AnyValuesFixture(LaunchFixture):
    def __init__(self, browser):
        super().__init__(browser)
        self.bodies = []

    def route(self, route):
        path = route.request.url.split("qym.test", 1)[-1].split("?", 1)[0]
        method = route.request.method
        env = dict(ENV, official_preset_id="o1", official_preset_version=1)
        if path == "/v1/projects/p/eval-environments":
            route.fulfill(json={"environments": [env]})
        elif path == "/v1/projects/p/eval-environments/e1" and method == "GET":
            route.fulfill(
                json=dict(
                    env,
                    base_url="https://staging.example",
                    api_key_set=True,
                    is_active=True,
                )
            )
        elif path == "/v1/projects/p/eval-environments/e1/form":
            route.fulfill(
                json={
                    "environment_id": "e1",
                    "schema_id": "s1",
                    "schema_hash": "old",
                    "descriptor": DESCRIPTOR,
                }
            )
        elif path == "/v1/projects/p/eval-environments/e1/presets":
            route.fulfill(
                json={
                    "presets": [
                        {
                            "id": "o1",
                            "kind": "official",
                            "name": "Default",
                            "current_version": {"version": 1},
                        }
                    ]
                }
            )
        elif path == "/v1/projects/p/eval-environments/e1/presets/o1/versions/1":
            route.fulfill(
                json={
                    "version": {"id": "v1", "version": 1},
                    "remap": {"config": PRESET, "dropped": [], "errors": []},
                }
            )
        elif path == "/v1/projects/p/experiments" and method == "POST":
            self.bodies.append(json.loads(route.request.post_data or "{}"))
            route.fulfill(json={"errors": [], "runs": []})
        else:
            super().route(route)

    def overrides(self):
        """env_overrides of the latest preview/launch request."""

        def find(node):
            if isinstance(node, dict):
                if isinstance(node.get("env_overrides"), dict):
                    return node["env_overrides"]
                for value in node.values():
                    found = find(value)
                    if found is not None:
                        return found
            return None

        return find(self.bodies[-1]) if self.bodies else None


@pytest.fixture
def launch(browser):  # noqa: F811
    view = AnyValuesFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def _settings(launch):
    page = launch.page
    page.locator('[data-xl-view="entry"] [data-xl-start="official"]').click()
    launch.customize(4)
    for details in page.locator("details[data-xl-group]").all():
        details.evaluate("d => { d.open = true; }")
    return page


def _field(page, pointer):
    return page.locator(f'[data-xl-pointer="/env_overrides{pointer}"]').first


def _wait_overrides(launch, predicate):
    launch.wait(
        lambda: launch.overrides() is not None and predicate(launch.overrides())
    )


def test_values_that_do_not_fit_their_widget_are_shown_as_json(launch):
    launch.open()
    page = _settings(launch)
    threshold = _field(page, "/THRESHOLD")
    threshold.wait_for()
    assert threshold.evaluate("n => n.tagName") == "TEXTAREA"
    assert threshold.get_attribute("data-xl-json-fallback") == "number"
    assert json.loads(threshold.input_value()) == {"low": 0.1}
    flag = _field(page, "/FLAG")
    assert json.loads(flag.input_value()) == "yes"
    # Typing a number keeps the value JSON and sends a real number.
    threshold.fill("0.5")
    _wait_overrides(launch, lambda o: o.get("THRESHOLD") == 0.5)
    # Text in the fallback editor is rejected, not silently sent as a string.
    threshold.fill("abc")
    assert _field(page, "/THRESHOLD").evaluate("n => n.tagName") == "TEXTAREA"


def test_union_fields_take_plain_text_and_json(launch):
    launch.open()
    page = _settings(launch)
    mode = _field(page, "/MODE")
    mode.wait_for()
    mode.fill("fast")
    _wait_overrides(launch, lambda o: o.get("MODE") == "fast")
    mode.fill("7")
    _wait_overrides(launch, lambda o: o.get("MODE") == 7)
    hint = page.locator('[data-xl-leaf="/MODE"] .xl-hint').inner_text()
    assert "integer or string" in hint


def test_extra_keys_of_an_object_are_shown_added_and_removed(launch):
    launch.open()
    page = _settings(launch)
    retries = _field(page, "/OPTIONS/retries")
    retries.wait_for()
    assert retries.input_value() == "3"
    container = page.locator('[data-xl-pointer="/env_overrides/OPTIONS"]')
    container.locator("[data-xl-extra-key]").fill("timeout")
    container.locator("[data-xl-extra-add]").click()
    timeout = _field(page, "/OPTIONS/timeout")
    timeout.fill("30")
    _wait_overrides(
        launch, lambda o: o.get("OPTIONS") == {"name": "a", "retries": 3, "timeout": 30}
    )
    page.locator('[data-xl-extra-remove="retries"]').click()
    _wait_overrides(launch, lambda o: o.get("OPTIONS") == {"name": "a", "timeout": 30})


def test_values_without_a_setting_are_listed_under_other_values(launch):
    launch.open()
    page = _settings(launch)
    group = page.locator('details[data-xl-group="unmatched"]')
    group.wait_for()
    assert group.evaluate("d => d.open")
    limits = group.locator('[data-xl-pointer="/env_overrides/LIMITS"]')
    assert json.loads(limits.input_value()) == 5
    limits.fill("6")
    _wait_overrides(launch, lambda o: o.get("LIMITS") == 6)
    group.locator('[data-xl-extra-remove="/LIMITS"]').click()
    _wait_overrides(launch, lambda o: "LIMITS" not in o)
    assert page.locator('details[data-xl-group="unmatched"]').count() == 0


def test_a_fallback_value_goes_back_to_its_widget_and_hints_describe_types(launch):
    launch.open()
    page = _settings(launch)
    flag = _field(page, "/FLAG")
    flag.wait_for()
    assert flag.evaluate("n => n.tagName") == "TEXTAREA"
    flag.fill("true")
    _wait_overrides(launch, lambda o: o.get("FLAG") is True)
    hint = page.locator('[data-xl-leaf="/WHEN"] .xl-hint').inner_text()
    assert "date-time" in hint
    tags = page.locator('[data-xl-leaf="/TAGS"] .xl-hint').inner_text()
    assert "list of string" in tags
