"""Evaluation inputs card built from the environment's evaluator schema (guide v1.1
§3.4, decision B22): experiment_launch_advanced.js in a real browser.

The card renders ``GET …/experiments/evaluator-config?environment_id=…`` with the
launch form's widgets and any-value rules, falls back to the standard inputs for a
service without the endpoint, and reloads when a schema refresh finds a new one.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from qym_platform.services.eval_config import (
    EvaluatorPanelSource,
    evaluator_inputs_panel,
)

from test_experiment_launch_browser import ENV, LaunchFixture

pytestmark = pytest.mark.browser

EVALUATOR_SCHEMA = json.loads(
    (Path(__file__).parent / "fixtures" / "eval_evaluator_schema.json").read_text()
)
PRESET = {
    "evaluator": {
        "config": {
            "metric_concurrency": 2,
            "max_retries": "lots",  # not an integer: edited as JSON (B20)
            "legacy_flag": True,  # no input for it: "Other values"
            "samples": 3,
        }
    }
}


class EvaluatorFixture(LaunchFixture):
    def __init__(self, browser):
        super().__init__(browser)
        self.bodies = []
        self.panel_queries = []
        self.evaluator_schema = EVALUATOR_SCHEMA
        # A refresh that finds a new evaluator schema switches to this one.
        self.next_evaluator_schema = None

    def _evaluator_block(self):
        if self.evaluator_schema is None:
            return {"status": "unsupported", "schema_id": None, "schema_hash": None}
        return {"status": "available", "schema_id": "es1", "schema_hash": "eh1"}

    def route(self, route):
        url = urlparse(route.request.url)
        path = url.path
        method = route.request.method
        env = dict(ENV, official_preset_id="o1", official_preset_version=1)
        if path == "/v1/projects/p/eval-environments":
            route.fulfill(json={"environments": [env]})
        elif path == "/v1/projects/p/eval-environments/e1/form":
            self.form_loads += 1
            from test_experiment_launch_browser import DESCRIPTOR

            route.fulfill(
                json={
                    "environment_id": "e1",
                    "schema_id": "s1",
                    "schema_hash": "old",
                    "descriptor": DESCRIPTOR,
                    "evaluator": self._evaluator_block(),
                }
            )
        elif path == "/v1/projects/p/experiments/evaluator-config":
            ids = parse_qs(url.query).get("environment_id", [])
            self.panel_queries.append(ids)
            sources = [
                EvaluatorPanelSource(
                    environment_id=i,
                    name="Staging",
                    schema=self.evaluator_schema,
                    schema_hash="eh1" if self.evaluator_schema else None,
                    status=self._evaluator_block()["status"],
                )
                for i in ids
            ]
            route.fulfill(json=evaluator_inputs_panel(sources))
        elif (
            path == "/v1/projects/p/eval-environments/e1/schema/refresh"
            and method == "POST"
        ):
            self.posts.append(path)
            if self.hold_refresh:
                self.held.append(route)
                return
            route.fulfill(json=self._refresh_answer())
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

    def _refresh_answer(self):
        changed = self.next_evaluator_schema is not None
        if changed:
            self.evaluator_schema = self.next_evaluator_schema
            self.next_evaluator_schema = None
        return {
            "changed": changed,
            "added": [],
            "removed": [],
            "evaluator": {
                "changed": changed,
                "added": ["/metric_concurrency"] if changed else [],
                "removed": [],
            },
            "schema_hash": "old",
            "slots": [],
            "needs_confirmation": False,
        }

    def release_refresh(self):
        held, self.held = self.held, []
        for route in held:
            route.fulfill(json=self._refresh_answer())

    def config(self):
        """evaluator.config of the latest preview/launch request."""
        if not self.bodies:
            return None
        spec = self.bodies[-1].get("spec") or {}
        return (spec.get("evaluator") or {}).get("config") or {}

    def wait_config(self, predicate):
        self.wait(lambda: self.config() is not None and predicate(self.config()))


@pytest.fixture
def launch(browser):  # noqa: F811
    view = EvaluatorFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def _inputs(launch, start="official"):
    page = launch.page
    page.locator(f'[data-xl-view="entry"] [data-xl-start="{start}"]').click()
    launch.customize("config")
    panel = page.locator('[data-xa-panel="inputs"]')
    panel.locator("[data-xa-config]").wait_for()
    return panel


def _control(panel, name):
    return panel.locator(f'[data-xl-pointer="/evaluator/config/{name}"]').first


def test_inputs_come_from_the_environment_evaluator_schema(launch):
    launch.open()
    panel = _inputs(launch)
    panel.locator('[data-xa-field="metric_concurrency"]').wait_for()
    assert panel.locator("[data-xa-config]").get_attribute("data-xa-config") == (
        "environment"
    )
    assert launch.panel_queries[-1] == ["e1"]
    note = panel.locator('[data-xa-source="environment"]').inner_text()
    assert "evaluator schema of Staging" in note
    # The new key sits next to max_concurrency, with the preset's value.
    order = panel.locator("[data-xa-config] [data-xa-field]").evaluate_all(
        "ns => ns.map(n => n.dataset.xaField)"
    )
    assert order.index("metric_concurrency") == order.index("max_concurrency") + 1
    metric = _control(panel, "metric_concurrency")
    assert metric.input_value() == "2"
    hint = panel.locator('[data-xa-field="metric_concurrency"] .xl-hint').inner_text()
    assert "≥ 1" in hint
    # A value that does not fit its widget is edited as JSON, not hidden.
    retries = _control(panel, "max_retries")
    assert retries.evaluate("n => n.tagName") == "TEXTAREA"
    assert retries.get_attribute("data-xa-json") == "integer"
    assert json.loads(retries.input_value()) == "lots"
    # A key no input shows is listed under Other values.
    other = panel.locator("[data-xa-other]")
    assert json.loads(_control(other, "legacy_flag").input_value()) is True
    # versioning_details comes from the Setup tab's Versioning details.
    owned = panel.locator("[data-xa-owned]").inner_text()
    assert "versioning_details" in owned

    metric.fill("5")
    retries.fill("4")
    launch.wait_config(
        lambda c: c.get("metric_concurrency") == 5 and c.get("max_retries") == 4
    )
    assert launch.config()["legacy_flag"] is True
    panel.locator('[data-xa-other-remove="legacy_flag"]').click()
    launch.wait_config(lambda c: "legacy_flag" not in c)
    assert panel.locator("[data-xa-other]").count() == 0
    # Invalid text is refused locally, never sent.
    metric = _control(panel, "metric_concurrency")
    metric.fill("x")
    error = panel.locator('[data-xa-field="metric_concurrency"] .xl-error-text')
    assert error.first.inner_text() == "Enter a number"


def test_an_older_service_falls_back_to_the_standard_inputs(launch):
    launch.evaluator_schema = None
    launch.open()
    panel = _inputs(launch)
    panel.locator('[data-xa-field="samples"]').wait_for()
    assert panel.locator("[data-xa-config]").get_attribute("data-xa-config") == "static"
    note = panel.locator("[data-xa-source]").inner_text()
    assert "does not publish an evaluator schema" in note
    config = panel.locator("[data-xa-config]")
    assert config.locator('[data-xa-field="metric_concurrency"]').count() == 0
    assert panel.locator(".xl-callout--error").count() == 0
    # The preset's metric_concurrency is not an input there: listed, removable.
    other = panel.locator("[data-xa-other]")
    assert json.loads(_control(other, "metric_concurrency").input_value()) == 2
    owned = panel.locator("[data-xa-owned]").inner_text()
    assert "versioning_details" not in owned


def test_a_refreshed_evaluator_schema_reloads_the_inputs(launch):
    launch.evaluator_schema = None
    launch.next_evaluator_schema = EVALUATOR_SCHEMA
    launch.hold_refresh = True
    launch.open()
    panel = _inputs(launch, start="blank")
    panel.locator('[data-xa-config="static"] [data-xa-field="samples"]').wait_for()
    assert panel.locator('[data-xa-field="metric_concurrency"]').count() == 0
    launch.wait(lambda: launch.held)
    launch.release_refresh()
    panel.locator('[data-xa-config] [data-xa-field="metric_concurrency"]').wait_for()
    assert panel.locator("[data-xa-config]").get_attribute("data-xa-config") == (
        "environment"
    )
    assert launch.panel_queries[-1] == ["e1"]
    assert len(launch.panel_queries) >= 2  # loaded again for the new schema
