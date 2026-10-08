"""Presets in the new-experiment form, in a real browser: every value a saved
preset holds shows on the Evaluation config tab, and what is shown is sent."""

from __future__ import annotations

import copy
import json
import os
from urllib.parse import urlparse

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")

from qym_platform.services.eval_config import evaluator_inputs_panel  # noqa: E402
from test_experiment_launch_browser import LaunchFixture  # noqa: E402

pytestmark = pytest.mark.browser

PRESET_DOC = {
    "evaluator": {
        "dataset": "playground_set_v2",
        "report_k": 2,
        "config": {
            "samples": 3,
            "max_retries": 4,
            "force_model_override": True,
            "run_metadata": {"team": "rag", "tier": 2},
        },
    },
    "slot_bindings": {},
    "env_overrides": {
        "TABLE_SELECTION_MODE": "rag",
        "MILVUS_SEARCH_THRESHOLD": 0.7,
        "SQL_RESULT_LIMIT": 50,
        "BRIEF_ENABLED": False,
        "LLM_OVERRIDES": {
            "endpoints": {"primary": {"timeout": 60}},
            "main": {"temperature": 0.2},
        },
    },
}


class PresetFixture(LaunchFixture):
    def __init__(self, browser):
        self.version_loads = 0
        self.dry_runs = []
        super().__init__(browser)

    def route(self, route):
        url = urlparse(route.request.url)
        path = url.path
        method = route.request.method
        base = "/v1/projects/p/eval-environments/e1/presets"
        if path == base:
            route.fulfill(
                json={
                    "presets": [
                        {
                            "id": "s1",
                            "kind": "saved",
                            "name": "RAG baseline",
                            "current_version": {"version": 1},
                            "created_by": {"id": "u", "name": "member"},
                        }
                    ]
                }
            )
        elif path == base + "/s1/versions/1":
            self.version_loads += 1
            route.fulfill(
                json={
                    "version": {"id": "v1", "version": 1, "notes": "", "warnings": []},
                    "remap": {
                        "config": copy.deepcopy(PRESET_DOC),
                        "dropped": [],
                        "errors": [],
                        "summary": None,
                    },
                }
            )
        elif path == "/v1/projects/p/experiments/evaluator-config":
            route.fulfill(json=evaluator_inputs_panel())
        elif path == "/v1/projects/p/experiments" and method == "POST":
            self.dry_runs.append(json.loads(route.request.post_data))
            route.fulfill(json={"errors": [], "jobs": [], "job_count": 1})
        else:
            super().route(route)

    def pick_saved_preset(self):
        card = self.page.locator('[data-xl-start="saved"]')
        card.wait_for()
        card.click()
        self.page.wait_for_function(
            "() => /RAG baseline/.test(document.querySelector('[data-xl-base-label]')"
            " && document.querySelector('[data-xl-base-label]').textContent)"
        )

    def last_spec(self):
        """The spec of the latest dry run, after the debounce settles."""
        count = len(self.dry_runs)
        self.wait(lambda: len(self.dry_runs) > count)
        self.page.wait_for_timeout(700)
        return self.dry_runs[-1]["spec"]


@pytest.fixture
def launch(browser):  # noqa: F811
    view = PresetFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def _value(page, pointer):
    return page.locator(f'[data-xl-pointer="{pointer}"]').first.input_value()


def test_saved_preset_fills_every_field_of_the_evaluation_config_tab(launch):
    launch.open()
    page = launch.page
    launch.pick_saved_preset()
    launch.customize("config")
    tab = page.locator('[data-xl-tab-panel="config"]')
    assert tab.is_visible()
    # Environment overrides: scalars, enums, booleans and nested values.
    page.wait_for_selector('[data-xl-pointer="/env_overrides/MILVUS_SEARCH_THRESHOLD"]', state="attached")
    assert _value(page, "/env_overrides/MILVUS_SEARCH_THRESHOLD") == "0.7"
    assert _value(page, "/env_overrides/SQL_RESULT_LIMIT") == "50"
    selected = "(p) => { const s = document.querySelector('[data-xl-pointer=\"' + p + '\"]'); return s.options[s.selectedIndex].text; }"
    assert page.evaluate(selected, "/env_overrides/TABLE_SELECTION_MODE") == "rag"
    assert page.evaluate(selected, "/env_overrides/BRIEF_ENABLED") == "false"
    assert _value(page, "/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout") == "60"
    roles = page.locator('[data-xa-panel="roles"]')
    page.wait_for_selector('[data-xa-panel="roles"] [data-xa-row]')
    assert roles.get_by_label("main · temperature", exact=True).input_value() == "0.2"
    # The preset's values are the starting point, not changes.
    count = page.locator("[data-xl-config-count]")
    assert count.is_hidden() and count.text_content() == "0"
    # Evaluation inputs: evaluator.config, run_metadata and report_k.
    inputs = page.locator('[data-xa-panel="inputs"]')
    page.wait_for_selector('[data-xa-field="samples"]')
    assert inputs.locator('[data-xa-field="samples"] input').input_value() == "3"
    assert inputs.locator('[data-xa-field="max_retries"] input').input_value() == "4"
    assert inputs.locator('[data-xa-field="force_model_override"] select').input_value() == "true"
    assert "xl-field--changed" not in inputs.locator('[data-xa-field="samples"]').get_attribute("class")
    rows = inputs.locator("[data-xa-meta-row]")
    meta = rows.evaluate_all("rs => rs.map(r => Array.from(r.querySelectorAll('input')).map(i => i.value))")
    assert meta == [["team", "rag"], ["tier", "2"]]
    assert "evaluator.report_k = 2" in inputs.locator("[data-xa-extras]").inner_text()
    # What the tab shows is what is sent.
    page.locator('[data-xl-tab="setup"]').click()
    page.locator('[data-xl-entry-name], [data-xl-pointer="#name"]').first.fill("x")
    spec = launch.last_spec()
    assert spec["env_overrides"] == PRESET_DOC["env_overrides"]
    assert spec["evaluator"]["config"] == PRESET_DOC["evaluator"]["config"]
    assert spec["evaluator"]["report_k"] == 2


def test_clearing_a_preset_input_removes_it_and_edits_survive_leaving_customize(launch):
    launch.open()
    page = launch.page
    launch.pick_saved_preset()
    launch.customize("config")
    inputs = page.locator('[data-xa-panel="inputs"]')
    page.wait_for_selector('[data-xa-field="samples"]')
    # Cleared: no longer sent (it used to come back from the preset).
    inputs.locator('[data-xa-field="samples"] input').fill("")
    inputs.locator('[data-xa-field="max_retries"] input').fill("5")
    assert "xl-field--changed" in inputs.locator('[data-xa-field="max_retries"]').get_attribute("class")
    spec = launch.last_spec()
    assert "samples" not in spec["evaluator"]["config"]
    assert spec["evaluator"]["config"]["max_retries"] == 5
    # Start screen and back: the panel is rebuilt with the same edits.
    page.locator(".xl-back").click()
    page.locator("[data-xl-customize]").click()
    page.wait_for_selector('[data-xl-tab-panel="config"]:not([hidden]) [data-xa-field="samples"]')
    assert inputs.locator('[data-xa-field="samples"] input').input_value() == ""
    assert inputs.locator('[data-xa-field="max_retries"] input').input_value() == "5"
    # Reset puts the preset's value back.
    inputs.locator('[data-xa-field="samples"] .xl-reset').click()
    assert inputs.locator('[data-xa-field="samples"] input').input_value() == "3"


def test_raw_json_can_remove_a_preset_input(launch):
    launch.open()
    page = launch.page
    launch.pick_saved_preset()
    launch.customize("config")
    page.wait_for_selector('[data-xa-field="samples"]')
    doc = copy.deepcopy(PRESET_DOC)
    del doc["evaluator"]["config"]["max_retries"]
    del doc["evaluator"]["report_k"]
    page.wait_for_selector('[data-xa-panel="json"] .cm-content, [data-xa-panel="json"] textarea')
    textarea = page.locator('[data-xa-panel="json"] textarea')
    if textarea.count():
        textarea.fill(json.dumps(doc))
    else:
        page.locator('[data-xa-panel="json"] .cm-content').click()
        page.keyboard.press("Control+A")
        page.keyboard.insert_text(json.dumps(doc))
    page.locator("[data-xa-json-apply]").click()
    inputs = page.locator('[data-xa-panel="inputs"]')
    page.wait_for_function(
        "() => document.querySelector('[data-xa-field=\"max_retries\"] input').value === ''"
    )
    assert inputs.locator("[data-xa-extras]").count() == 0
    spec = launch.last_spec()
    assert "max_retries" not in spec["evaluator"]["config"]
    assert "report_k" not in spec["evaluator"]
    assert spec["evaluator"]["config"]["samples"] == 3


def test_a_changed_schema_reloads_the_preset_onto_it(launch):
    launch.refresh = {"changed": True, "added": ["/A"], "removed": []}
    launch.hold_refresh = True
    launch.open()
    page = launch.page
    launch.pick_saved_preset()
    loads = launch.version_loads
    launch.wait(lambda: launch.held)
    launch.release_refresh()
    # The preset is re-mapped onto the new schema (fetched again), values intact.
    launch.wait(lambda: launch.version_loads > loads)
    launch.customize("config")
    page.wait_for_selector('[data-xl-pointer="/env_overrides/MILVUS_SEARCH_THRESHOLD"]', state="attached")
    assert _value(page, "/env_overrides/MILVUS_SEARCH_THRESHOLD") == "0.7"


# ------------------------------------------------------- evaluator schema (v1.1)


class EvaluatorPresetFixture(PresetFixture):
    """The environment publishes ``GET /evals/evaluator/schema`` (guide v1.1)."""

    def __init__(self, browser):
        from pathlib import Path

        self.evaluator_schema = json.loads(
            (Path(__file__).parent / "fixtures" / "eval_evaluator_schema.json").read_text()
        )
        super().__init__(browser)

    def route(self, route):
        from qym_platform.services.eval_config import EvaluatorPanelSource

        url = urlparse(route.request.url)
        if url.path == "/v1/projects/p/experiments/evaluator-config":
            ids = [p.split("=", 1)[1] for p in url.query.split("&") if p]
            route.fulfill(
                json=evaluator_inputs_panel(
                    [
                        EvaluatorPanelSource(i, "Staging", self.evaluator_schema, "eh1")
                        for i in ids
                    ]
                )
            )
        elif url.path == base_url_of_version():
            self.version_loads += 1
            doc = copy.deepcopy(PRESET_DOC)
            doc["evaluator"]["config"]["metric_concurrency"] = 6
            route.fulfill(
                json={
                    "version": {"id": "v1", "version": 1, "notes": "", "warnings": []},
                    "remap": {"config": doc, "dropped": [], "errors": [], "summary": None},
                }
            )
        else:
            super().route(route)


def base_url_of_version():
    return "/v1/projects/p/eval-environments/e1/presets/s1/versions/1"


@pytest.fixture
def evaluator_launch(browser):  # noqa: F811
    view = EvaluatorPresetFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_a_preset_input_from_the_evaluator_schema_is_shown_and_sent(evaluator_launch):
    launch = evaluator_launch
    launch.open()
    page = launch.page
    launch.pick_saved_preset()
    launch.customize("config")
    field = page.locator(
        '[data-xa-config="environment"] [data-xl-pointer="/evaluator/config/metric_concurrency"]'
    )
    field.wait_for()
    assert field.input_value() == "6"
    # The preset's value is the starting point, sent as is, and editable.
    assert launch.last_spec()["evaluator"]["config"]["metric_concurrency"] == 6
    field.fill("8")
    assert launch.last_spec()["evaluator"]["config"]["metric_concurrency"] == 8
