"""Global model on the Models step, in a real browser (experiment_launch.js).

One picker at the top of the Models step sets the model of every LLM endpoint
(every ``endpoint:<name>`` slot binding). Endpoints changed afterwards are
"custom"; a later global change sets them again; clearing keeps them. Nothing new
is stored: presets, clones and sweeps round-trip through ``slot_bindings`` (and
``links``), and the global value is derived back when every endpoint shares it.
"""

from __future__ import annotations

import copy
import json
from urllib.parse import parse_qs, urlparse

import pytest
from test_experiment_launch_browser import DESCRIPTOR
from test_experiment_launch_presets_browser import PresetFixture

from qym_platform.services.eval_model_slots import (
    detect_model_slots,
    propose_endpoint_slot,
)

pytestmark = pytest.mark.browser

PRIMARY = "endpoint:primary"
FAST = "endpoint:fast"
VIZ = "flat:VIZ_LLM"
LINKED = [["/slot_bindings/endpoint:primary", "/slot_bindings/endpoint:fast"]]
CONNECTIONS = [
    {"connection_id": "c1", "name": "GPT 4o", "model": "gpt-4o", "available": True},
    {"connection_id": "c2", "name": "Mini", "model": "gpt-4o-mini", "available": True},
]


def _doc(slot_bindings, links=None, overrides=None):
    doc = {
        "evaluator": {"dataset": "playground_set_v2"},
        "slot_bindings": slot_bindings,
        "env_overrides": overrides or {},
    }
    if links is not None:
        doc["links"] = links
    return doc


class GlobalFixture(PresetFixture):
    def __init__(self, browser):
        self.preset_doc = _doc({})
        self.clone_spec = None
        super().__init__(browser)
        fast = propose_endpoint_slot(DESCRIPTOR, "fast").to_dict()
        self.slots = [
            dict(s.to_dict(), status="confirmed") for s in detect_model_slots(DESCRIPTOR)
        ] + [dict(fast, status="confirmed")]

    def route(self, route):
        url = urlparse(route.request.url)
        path = url.path
        method = route.request.method
        envs = "/v1/projects/p/eval-environments/e1"
        if path == envs + "/presets/s1/versions/1":
            route.fulfill(
                json={
                    "version": {"id": "v1", "version": 1, "notes": "", "warnings": []},
                    "remap": {
                        "config": copy.deepcopy(self.preset_doc),
                        "dropped": [],
                        "errors": [],
                        "summary": None,
                    },
                }
            )
        elif path == envs + "/model-options":
            route.fulfill(
                json={
                    "environment_id": "e1",
                    "temporary_keys_allowed": True,
                    "temporary_keys_reason": None,
                    "connections": copy.deepcopy(CONNECTIONS),
                }
            )
        elif path == envs + "/model-slots" and "propose_endpoint" in url.query:
            name = parse_qs(url.query)["propose_endpoint"][0]
            proposal = propose_endpoint_slot(DESCRIPTOR, name)
            route.fulfill(
                json={
                    "slots": self.slots,
                    "schema_id": "s1",
                    "needs_confirmation": False,
                    "proposal": proposal.to_dict() if proposal else None,
                }
            )
        elif path == "/v1/projects/p/experiments/x1/clone" and method == "POST":
            route.fulfill(
                json={
                    "name": "Old (copy)",
                    "environment_ids": ["e1"],
                    "spec": copy.deepcopy(self.clone_spec),
                    "base_source": {"kind": "clone", "experiment_id": "x1"},
                }
            )
        else:
            super().route(route)

    def open_clone(self):
        self.page.goto("https://qym.test/projects/demo/experiments?new=1&clone=x1")
        self.page.wait_for_selector("[data-xl-launch-form]")
        self.page.evaluate(
            "window.toasts = []; window.QymShell = {"
            " toast: (message, type) => window.toasts.push([message, type]) };"
        )

    def models(self):
        self.customize(3)
        self.page.wait_for_selector("[data-xl-global-model]")

    def slot_value(self, slot_key):
        return self.page.locator(f'[data-xl-slot="{slot_key}"]').input_value()

    def global_value(self):
        return self.page.locator("[data-xl-global-select]").input_value()

    def state(self, slot_key):
        tag = self.page.locator(
            f'[data-xl-model-card="{slot_key}"] [data-xl-global-state]'
        )
        return tag.get_attribute("data-xl-global-state") if tag.count() else None


@pytest.fixture
def launch(browser):  # noqa: F811
    view = GlobalFixture(browser)
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_global_model_sets_every_endpoint_and_custom_ones_are_shown(launch):
    launch.open()
    launch.models()
    page = launch.page
    assert launch.global_value() == ""
    assert launch.state(PRIMARY) is None  # no global model: no follow tags

    page.locator("[data-xl-global-select]").select_option("c1")
    assert launch.slot_value(PRIMARY) == "c1"
    assert launch.slot_value(FAST) == "c1"
    assert launch.slot_value(VIZ) == "__inherit"  # a flat slot is not an endpoint
    assert launch.state(PRIMARY) == launch.state(FAST) == "follows"
    spec = launch.last_spec()
    assert spec["slot_bindings"] == {
        PRIMARY: {"connection_id": "c1"},
        FAST: {"connection_id": "c1"},
    }

    # An endpoint changed afterwards diverges and says so.
    page.locator(f'[data-xl-slot="{FAST}"]').select_option("c2")
    assert launch.state(PRIMARY) == "follows"
    assert launch.state(FAST) == "custom"
    status = page.locator("[data-xl-global-status]").inner_text()
    assert "Custom: Fast model" in status
    assert launch.global_value() == "c1"

    # A later global change sets every endpoint again, the custom one too.
    page.locator("[data-xl-global-select]").select_option("c2")
    assert launch.slot_value(PRIMARY) == launch.slot_value(FAST) == "c2"
    assert launch.state(FAST) == "follows"

    # Clearing the global model keeps every endpoint's model.
    page.locator(f'[data-xl-slot="{PRIMARY}"]').select_option("c1")
    page.locator("[data-xl-global-clear]").click()
    assert launch.global_value() == ""
    assert launch.slot_value(PRIMARY) == "c1"
    assert launch.slot_value(FAST) == "c2"
    assert launch.state(PRIMARY) is None
    spec = launch.last_spec()
    assert spec["slot_bindings"] == {
        PRIMARY: {"connection_id": "c1"},
        FAST: {"connection_id": "c2"},
    }


def test_apply_to_all_and_added_endpoints_follow_the_global_model(launch):
    launch.open()
    launch.models()
    page = launch.page
    page.locator("[data-xl-global-select]").select_option("c1")
    page.locator(f'[data-xl-slot="{FAST}"]').select_option("__inherit")
    assert launch.state(FAST) == "custom"
    page.locator("[data-xl-global-apply]").click()
    assert launch.slot_value(FAST) == "c1"
    assert page.locator("[data-xl-global-apply]").count() == 0

    # "+ Add LLM endpoint" starts the new endpoint on the global model.
    page.locator("[data-xl-new-endpoint]").fill("slow")
    page.locator("[data-xl-add-endpoint]").click()
    page.wait_for_selector('[data-xl-slot="endpoint:slow"]')
    assert launch.slot_value("endpoint:slow") == "c1"
    assert launch.state("endpoint:slow") == "follows"
    spec = launch.last_spec()
    assert spec["slot_bindings"]["endpoint:slow"] == {"connection_id": "c1"}


def test_a_preset_whose_endpoints_share_a_model_shows_it_as_global(launch):
    shared = {"connection_id": "c2"}
    launch.preset_doc = _doc({PRIMARY: shared, FAST: shared, VIZ: {"connection_id": "c1"}})
    launch.open()
    launch.pick_saved_preset()
    launch.models()
    assert launch.global_value() == "c2"
    assert launch.state(PRIMARY) == launch.state(FAST) == "follows"
    # What is sent (and what a preset saves) is still just the slot bindings.
    spec = launch.last_spec()
    assert spec["slot_bindings"] == {
        PRIMARY: shared,
        FAST: shared,
        VIZ: {"connection_id": "c1"},
    }


def test_a_preset_with_different_endpoint_models_has_no_global_model(launch):
    launch.preset_doc = _doc({PRIMARY: {"connection_id": "c1"}, FAST: {"connection_id": "c2"}})
    launch.open()
    launch.pick_saved_preset()
    launch.models()
    assert launch.global_value() == ""
    assert launch.slot_value(PRIMARY) == "c1"
    assert launch.slot_value(FAST) == "c2"


def test_a_clone_whose_endpoints_share_a_model_shows_it_as_global(launch):
    launch.clone_spec = _doc({PRIMARY: {"connection_id": "c1"}, FAST: {"connection_id": "c1"}})
    launch.open_clone()
    launch.models()
    launch.page.wait_for_function(
        "() => document.querySelector('[data-xl-global-select]').value === 'c1'"
    )
    assert launch.state(FAST) == "follows"


def test_global_temporary_model_shares_one_key_across_endpoints(launch):
    launch.open()
    launch.models()
    page = launch.page
    page.locator("[data-xl-global-temporary]").click()
    form = page.locator("[data-xl-global-model] .tmpm-form")
    form.get_by_label("Model").fill("llama-3")
    form.get_by_label("Base URL").fill("https://llm.example/v1")
    form.get_by_label("API key").fill("sk-global-KEY-1234")
    form.locator('[data-role="add"]').click()
    assert launch.state(PRIMARY) == launch.state(FAST) == "follows"
    launch.last_spec()
    body = launch.dry_runs[-1]
    primary = body["spec"]["slot_bindings"][PRIMARY]["temporary"]
    fast = body["spec"]["slot_bindings"][FAST]["temporary"]
    assert primary == fast
    assert primary["model"] == "llama-3"
    ref = primary["api_key"]["$secret"]
    assert body["secrets"] == {ref: "sk-global-KEY-1234"}
    assert "sk-global-KEY-1234" not in json.dumps(body["spec"])

    # Changing one endpoint keeps the key the other endpoint still uses.
    page.locator(f'[data-xl-slot="{FAST}"]').select_option("c1")
    launch.last_spec()
    assert launch.dry_runs[-1]["secrets"] == {ref: "sk-global-KEY-1234"}


def test_a_cloned_global_temporary_model_asks_for_its_key_once(launch):
    temporary = {"temporary": {"label": "llama", "model": "llama-3"}}
    launch.clone_spec = _doc({PRIMARY: temporary, FAST: temporary})
    launch.open_clone()
    launch.models()
    page = launch.page
    page.wait_for_selector("[data-xl-global-key]")
    page.locator("[data-xl-global-key]").fill("sk-again-5678")
    page.locator("[data-xl-global-model]").get_by_role("button", name="Use key").click()
    launch.last_spec()
    body = launch.dry_runs[-1]
    refs = {
        body["spec"]["slot_bindings"][k]["temporary"]["api_key"]["$secret"]
        for k in (PRIMARY, FAST)
    }
    assert len(refs) == 1
    assert body["secrets"] == {refs.pop(): "sk-again-5678"}
    assert page.locator("[data-xl-reenter-key]").count() == 0


def test_global_model_sweep_links_every_endpoint_into_one_axis(launch):
    launch.open()
    launch.models()
    page = launch.page
    page.locator("[data-xl-global-select]").select_option("c1")
    page.locator("[data-xl-global-sweep]").click()
    page.locator('[data-xs-model-item="__global|c:c2"]').click()
    spec = launch.last_spec()
    sweep = {"sweep": [{"connection_id": "c1"}, {"connection_id": "c2"}]}
    assert spec["slot_bindings"] == {PRIMARY: sweep, FAST: sweep}
    assert spec["links"] == LINKED
    assert launch.state(PRIMARY) == launch.state(FAST) == "follows"
    # Two linked endpoints sweep together: 2 runs, not 2 × 2.
    page.locator('[data-xl-tab="config"]').click()
    page.wait_for_function(
        "() => /= 2 runs?$/.test(document.querySelector('[data-xs-math]').textContent.trim())"
    )


def test_a_clone_with_a_linked_endpoint_sweep_shows_a_global_sweep(launch):
    # Presets hold no sweeps; a rerun (clone) of a global model sweep does.
    sweep = {"sweep": [{"connection_id": "c1"}, {"connection_id": "c2"}]}
    launch.clone_spec = _doc({PRIMARY: sweep, FAST: sweep}, links=LINKED)
    launch.open_clone()
    launch.models()
    page = launch.page
    card = page.locator("[data-xl-global-model] [data-xs-model-sweep]")
    card.wait_for()
    assert card.locator('[data-xs-model-item="__global|c:c2"]').get_attribute("aria-pressed") == "true"
    # "Single model" turns every endpoint back into one model.
    card.locator('[data-xs-model-single="__global"]').click()
    assert launch.global_value() == "c1"
    assert launch.slot_value(PRIMARY) == launch.slot_value(FAST) == "c1"
    spec = launch.last_spec()
    assert spec["slot_bindings"] == {
        PRIMARY: {"connection_id": "c1"},
        FAST: {"connection_id": "c1"},
    }
    assert "links" not in spec


def test_unlinked_endpoint_sweeps_are_no_global_model(launch):
    sweep = {"sweep": [{"connection_id": "c1"}, {"connection_id": "c2"}]}
    launch.clone_spec = _doc({PRIMARY: sweep, FAST: sweep})
    launch.open_clone()
    launch.models()
    launch.page.wait_for_selector(f'[data-xl-model-card="{FAST}"][data-xs-model-sweep]')
    assert launch.global_value() == ""


def test_raw_endpoints_get_a_slot_and_the_global_model(launch):
    # An endpoint the preset only has raw values for (no confirmed slot).
    launch.preset_doc = _doc(
        {},
        overrides={"LLM_OVERRIDES": {"endpoints": {"slow": {"model": "old-model", "timeout": 30}}}},
    )
    launch.open()
    launch.pick_saved_preset()
    launch.models()
    page = launch.page
    page.locator("[data-xl-global-select]").select_option("c2")
    page.wait_for_selector('[data-xl-slot="endpoint:slow"]')
    assert launch.slot_value("endpoint:slow") == "c2"
    spec = launch.last_spec()
    assert spec["slot_bindings"]["endpoint:slow"] == {"connection_id": "c2"}
    # The bound fields are dropped from the raw values; other settings stay.
    assert spec["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["slow"] == {"timeout": 30}


def test_evaluation_config_tab_still_shows_bound_endpoint_fields(launch):
    launch.open()
    launch.models()
    page = launch.page
    page.locator("[data-xl-global-select]").select_option("c1")
    page.locator('[data-xl-tab="config"]').click()
    assert page.locator('[data-xl-tab-panel="config"]').is_visible()
    assert page.locator("[data-xl-global-model]").is_hidden()
