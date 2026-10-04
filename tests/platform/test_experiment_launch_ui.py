"""New-experiment launch form (plan §12.2, issue #23).

Static contract checks on ``experiment_launch.js``/``.css`` and its wiring into the
Experiments page (no browser or ``node`` needed), the ``model-options`` picker
endpoint, and an API round trip with exactly the body the form builds: one official
launch with a project model bound to ``endpoint:primary`` (the P2 exit criterion).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalPriority,
)
from qym_platform.services.eval_bindings import prepare_dispatch
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    CONN_KEY,
    MANAGER,
    MEMBER,
    OUTSIDER,
    P1,
    PRIMARY,
    _headers,
    _jobs,
    _url,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
PAGE = (DASHBOARD / "experiments.html").read_text(encoding="utf-8")
PAGE_JS = (DASHBOARD / "experiments.js").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")
STYLES = (DASHBOARD / "experiment_launch.css").read_text(encoding="utf-8")
ENVIRONMENTS_JS = (DASHBOARD / "eval_environments.js").read_text(encoding="utf-8")


def _options_url(env_id: str, project_id: str = P1) -> str:
    return f"/v1/projects/{project_id}/eval-environments/{env_id}/model-options"


def _form_body(env_id: str, conn_id: str, **extra) -> dict:
    """The request experiment_launch.js buildRequest() sends for a blank base."""
    return {
        "name": "primary on gpt-4o",
        "environment_ids": [env_id],
        "spec": {
            "evaluator": {"dataset": "playground_set_v2"},
            "slot_bindings": {PRIMARY: {"connection_id": conn_id}},
            "env_overrides": {"MILVUS_SEARCH_THRESHOLD": 0.7},
        },
        "base_source": {"kind": "blank"},
        "dry_run": False,
        "secrets": {},
        "save_to_project_models": [],
        **extra,
    }


# --------------------------------------------------------------------------- page


def test_new_route_serves_the_page_with_the_form_assets(client):
    res = client.get("/projects/p1/experiments?new=1", headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    assert 'id="exp-root"' in res.text
    assets = re.findall(r'(?:src|href)="/static/([^"?]+)', PAGE)
    for asset in (
        "experiment_launch.js",
        "experiment_launch.css",
        "eval_environments.js",
        "eval_environments.css",
        "eval_temporary_model.js",
        "eval_temporary_model.css",
    ):
        assert asset in assets, asset
        assert client.get(f"/static/{asset}").status_code == 200, asset
    # The form's dependencies load before experiments.js mounts it.
    assert PAGE.index("experiment_launch.js") < PAGE.index("experiments.js")
    assert PAGE.index("eval_environments.js") < PAGE.index("experiment_launch.js")
    assert PAGE.index("eval_temporary_model.js") < PAGE.index("experiment_launch.js")


def test_experiments_page_only_routes_to_the_form():
    assert "params.get('new') === '1'" in PAGE_JS
    assert "window.QymExperimentLaunch.mount(" in PAGE_JS
    assert "if (state.creating) { mountLaunchForm(); return; }" in PAGE_JS
    assert "onLaunched: (experiment) => navigate(experimentUrl(experiment.id))" in PAGE_JS
    assert "state.launch.teardown()" in PAGE_JS
    # The entry point is enabled now.
    assert "navigate(projectPage('/experiments?new=1'))" in PAGE_JS
    assert "coming soon" not in PAGE_JS.lower()


def test_module_consumes_the_launch_and_picker_apis():
    for needle in (
        "'/eval-environments?active=true'",
        "'/form'",
        "'/model-slots'",
        "'/model-options'",
        "'v1/datasets?project_slug='",
        "'/versions?project_slug='",
        "projectPath('/experiments')",
        "dry_run: !!dryRun",
        "base_source: baseSource(),",
        "save_to_project_models: save",
    ):
        assert needle in MODULE, needle
    assert "window.QymExperimentLaunch = { mount, mountEditor, BASE_OPTIONS }" in MODULE


def test_start_from_options_with_extension_points():
    base = re.search(r"const BASE_OPTIONS = \[(.*?)\];", MODULE, re.S).group(1)
    available = re.findall(r"kind: '(\w+)'[^}]*available: true", base)
    # Official/saved arrived with #31 (tests/platform/test_experiment_launch_base.py);
    # best run arrived with #38 (tests/platform/test_experiment_launch_best_run.py).
    assert available == ["official", "best_run", "saved", "blank"]
    for kind in ("official", "best_run", "saved"):
        assert f"kind: '{kind}'" in base
    assert "'data-xl-advanced': '1'" in MODULE  # #24 Advanced panel host
    assert "function specValue(value)" in MODULE
    # #34 sweeps live in their own module (tests/platform/test_experiment_launch_sweeps.py).
    assert "'data-xl-sweeps': '1'" in MODULE
    assert "{ sweep:" not in MODULE and "links:" not in MODULE


def test_form_sections_and_preview():
    for section in ("'environments'", "'dataset'", "'base'", "'models'", "'settings'", "'run'"):
        assert f"section({section}" in MODULE, section
    # Project datasets only (no free-text string), addressable by the error pointer;
    # a dataset string a base carries is shown with "Remove".
    assert "'Custom string'" not in MODULE
    assert MODULE.count("'data-xl-pointer': '/evaluator/dataset'") == 1
    assert "'data-xl-custom-dataset': '1'" in MODULE and "function useProjectDataset(" in MODULE
    # Settings: grouped, searchable, "changed only", reset, union badges.
    assert "'Search settings'" in MODULE and "'Changed only'" in MODULE
    assert "details', { className: 'xl-group'" in MODULE
    assert "'not in ' + envName(id)" in MODULE
    # Preview: debounced dry run, run names, clickable errors that focus fields.
    assert "PREVIEW_DELAY_MS" in MODULE and "setTimeout(runPreview" in MODULE
    assert "generation !== st.generation" in MODULE
    assert "onClick: () => focusError(error)" in MODULE
    assert "'data-xl-launch': '1'" in MODULE


def test_model_cards_bindings_and_group_banner():
    assert "'Inherit (the worker\\'s own setting)'" in MODULE
    assert "{ connection_id: b.id }" in MODULE
    assert "window.QymTemporaryModel.createForm({" in MODULE
    assert "keysAllowed: keys.allowed" in MODULE
    assert "canSaveToProject: isManager" in MODULE
    assert "'Group LLM settings to pick project models'" in MODULE
    assert "openEnvironmentDrawer({" in MODULE
    # Slot-filled fields are locked so the spec never has a binding_conflict.
    assert "delete st.values[slot.field_map[role]]" in MODULE


def test_new_environment_reuses_the_environments_dialog():
    assert "api.openAddDialog({" in MODULE
    assert "'+ New environment'" in MODULE
    assert "openAddDialog," in ENVIRONMENTS_JS or "openAddDialog:" in ENVIRONMENTS_JS
    assert "highPriorityWarning," in ENVIRONMENTS_JS


def test_high_priority_is_gated_and_acknowledged():
    assert "p === 'HIGH' && !isManager" in MODULE
    assert "PRIORITY_ORDER[p] > PRIORITY_ORDER[cap]" in MODULE
    assert "api.highPriorityWarning(env.name)" in MODULE
    assert "st.preview.preemption_warning" in MODULE
    assert "body.acknowledge_preemption = true" in MODULE
    assert "'preemption_acknowledgement_required'" in MODULE


def test_keys_stay_in_memory_and_strings_never_parse_as_html():
    for banned in (
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "console.",
        "insertAdjacentHTML",
        "outerHTML",
        "document.write",
        "history.",
    ):
        assert banned not in MODULE, banned
    # The only innerHTML is the escaped temporary-model chip.
    assert MODULE.count("innerHTML") == 2  # one comment line + one assignment
    assert "chip.innerHTML = window.QymTemporaryModel ? window.QymTemporaryModel.renderChip(" in MODULE
    assert "node.textContent = String(value)" in MODULE
    # Keys: only in st.secrets and the request body; dropped on teardown/launch.
    assert "st.secrets[result.secretRef] = result.apiKey" in MODULE
    assert MODULE.count("st.secrets = {}") >= 2
    # Unbinding forgets the slot's keys (a model sweep's too, #34).
    assert "bindingSecretRefs(current).forEach((ref) => {" in MODULE
    assert "delete st.secrets[ref]" in MODULE


def test_styles_follow_the_design_language():
    assert not re.search(r"font-size:\s*\d", STYLES)
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", STYLES)
    assert "color: var(--text-dim)" not in STYLES.replace(
        ".xl-meta-sep { color: var(--text-dim); }", ""
    ).replace("color: var(--text-dim); font-size: var(--font-sm); transition", "")
    body = re.sub(r"/\*.*?\*/", "", STYLES, flags=re.S)
    body = re.sub(r"@media[^{]*\{", "", body)
    for selector in re.findall(r"(?:^|\})\s*([^{}]+?)\s*\{", body):
        for part in selector.split(","):
            classes = re.findall(r"\.([\w-]+)", part)
            assert classes and all(c.startswith("xl-") for c in classes), part.strip()


# --------------------------------------------------------------------------- picker API


def test_model_options_lists_project_models_per_slot(client, env, conn):
    res = client.get(_options_url(env.id), headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["environment_id"] == env.id
    assert data["temporary_keys_allowed"] is True
    assert data["temporary_keys_reason"] is None
    (option,) = data["connections"]
    assert option["connection_id"] == conn.id
    assert option["name"] == "GPT-4o prod" and option["model"] == "gpt-4o"
    assert option["available"] is True
    assert option["slots"][PRIMARY]["available"] is True
    assert CONN_KEY not in res.text
    assert option["api_key_hint"] == "••••" + CONN_KEY[-4:]


def test_model_options_explains_when_keys_are_not_sent(
    client, session_factory, env, conn
):
    with session_factory() as s:
        s.get(EvalEnvironment, env.id).allow_connection_keys = False
        s.commit()
    data = client.get(_options_url(env.id), headers=_headers(MEMBER)).json()
    assert data["temporary_keys_allowed"] is False
    assert data["temporary_keys_reason"]
    (option,) = data["connections"]
    assert option["slots"][PRIMARY]["available"] is False
    assert option["slots"][PRIMARY]["reason"]


def test_model_options_access(client, env):
    assert (
        client.get(_options_url(env.id), headers=_headers(OUTSIDER)).status_code
        in (403, 404)
    )
    assert (
        client.get(_options_url("missing"), headers=_headers(MEMBER)).status_code
        == 404
    )


# --------------------------------------------------------------------------- round trip


def test_form_launch_binds_a_project_model_to_primary(
    client, session_factory, env, conn
):
    # The debounced preview: a dry run of the same body.
    preview = client.post(
        _url(), headers=_headers(MEMBER), json=_form_body(env.id, conn.id, dry_run=True)
    )
    assert preview.status_code == 200, preview.text
    dry = preview.json()
    assert dry["ok"] is True and dry["errors"] == []
    assert dry["job_count"] == 1
    assert dry["preemption_warning"] is None
    (job_preview,) = dry["jobs"]
    assert job_preview["run_name"]
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0

    # Launch.
    res = client.post(_url(), headers=_headers(MEMBER), json=_form_body(env.id, conn.id))
    assert res.status_code == 200, res.text
    created = res.json()
    assert created["id"] and created["base_source"] == {"kind": "blank"}

    (job,) = _jobs(session_factory, created["id"])
    assert job.environment_id == env.id
    assert job.params["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    body = job.request_body
    snapshot = body["evaluator"]["config"]["run_metadata"]["qym_config"]
    assert snapshot["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    assert snapshot["base_source"] == {"kind": "blank"}
    # The slot fills the primary endpoint and names the run (§7.4); the stored body
    # holds placeholders that dispatch resolves from the connection (no key here).
    placeholder = "{{qym:slot:endpoint:primary:model}}"
    assert body["evaluator"]["model"] == placeholder
    primary = body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert primary["model"] == placeholder
    assert primary["api_key"] == "{{qym:slot:endpoint:primary:api_key}}"
    assert body["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert body["evaluator"]["dataset"] == "playground_set_v2"
    assert CONN_KEY not in str(body)

    # Dispatch resolves the binding to the project model (what the service receives).
    with session_factory() as s:
        environment = s.get(EvalEnvironment, env.id)
        schema = s.get(EvalEnvironmentSchema, job.schema_id)
        prep = prepare_dispatch(
            s,
            environment,
            body=job.request_body,
            slot_bindings=job.params["slot_bindings"],
            slots=list_model_slots(s, schema.id),
            descriptor=descriptor_for_schema(schema),
        )
    assert not prep.problems
    sent = prep.body
    assert sent["evaluator"]["model"] == "gpt-4o"
    sent_primary = sent["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert sent_primary["model"] == "gpt-4o"
    assert sent_primary["base_url"] == "https://llm.example.com/v1"
    assert sent_primary["api_key"] == CONN_KEY

    # onLaunched navigates to the detail, which loads.
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER))
    assert detail.status_code == 200 and detail.json()["id"] == created["id"]


def test_preview_errors_point_at_form_fields(client, env, conn):
    body = _form_body(env.id, conn.id, dry_run=True)
    body["spec"]["evaluator"]["dataset"] = None
    body["spec"]["env_overrides"] = {
        "MILVUS_SEARCH_THRESHOLD": "high",
        "LLM_OVERRIDES": {"endpoints": {"primary": {"model": "raw"}}},
    }
    data = client.post(_url(), headers=_headers(MEMBER), json=body).json()
    assert data["ok"] is False
    pointers = {e["pointer"] for e in data["errors"]}
    assert "/evaluator/dataset" in pointers
    assert "/env_overrides/MILVUS_SEARCH_THRESHOLD" in pointers
    # A raw value under a bound slot conflicts; the form locks those inputs.
    assert "/env_overrides/LLM_OVERRIDES/endpoints/primary/model" in pointers
    for error in data["errors"]:
        assert error["environment_id"] in (env.id, None)


@pytest.mark.parametrize("email,status", [(MEMBER, 403), (MANAGER, 422)])
def test_high_priority_needs_a_manager_and_an_acknowledgement(
    client, session_factory, env, conn, email, status
):
    with session_factory() as s:
        s.get(EvalEnvironment, env.id).max_priority = EvalPriority.HIGH
        s.commit()
    res = client.post(
        _url(), headers=_headers(email), json=_form_body(env.id, conn.id, priority="HIGH")
    )
    assert res.status_code == status, res.text
    if email == MANAGER:
        assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"
        dry = client.post(
            _url(),
            headers=_headers(email),
            json=_form_body(env.id, conn.id, priority="HIGH", dry_run=True),
        ).json()
        assert "HIGH" in dry["preemption_warning"]
        ok = client.post(
            _url(),
            headers=_headers(email),
            json=_form_body(
                env.id, conn.id, priority="HIGH", acknowledge_preemption=True
            ),
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["priority"] == "HIGH"


# --------------------------------------------------------------------------- layout & JSON fields

JSON_MODULE = (DASHBOARD / "experiment_launch_json.js").read_text(encoding="utf-8")
JSON_STYLES = (DASHBOARD / "experiment_launch_json.css").read_text(encoding="utf-8")
SETTINGS_PAGE = (DASHBOARD / "project_settings.html").read_text(encoding="utf-8")


def test_name_and_priority_first_and_overrides_under_advanced_configuration():
    layout = MODULE[MODULE.index("    function render() {") :]
    layout = layout[: layout.index("    function renderEditorLayout()")]
    order = [
        layout.index(f"section('{key}'")
        for key in ("run", "environments", "dataset", "base", "models")
    ]
    assert order == sorted(order)
    assert "section('run', 1, 'Name and priority'" in layout
    # env_overrides, sweeps and the Advanced panel live in one collapsed disclosure.
    disclosure = layout[layout.index("const advancedConfig") : layout.index("const main")]
    for host in ("section('settings'", "'data-xl-sweeps': '1'", "'data-xl-advanced': '1'"):
        assert host in disclosure, host
    assert "'Advanced configuration'" in disclosure
    assert "advancedConfig.open = st.advancedOpen;" in layout
    assert "summary.textContent = changed + ' changed';" in MODULE


def test_json_settings_are_edited_as_fields():
    for page in (PAGE, SETTINGS_PAGE):
        assert page.index("experiment_launch_json.js") < page.index(
            "experiment_launch.js?"
        )
    assert "'static/experiment_launch_json.css?v=" in MODULE
    assert "window.QymLaunchJson.editor({" in MODULE
    # Only the settings form gets fields; role-table cells stay compact.
    assert "leafControl(entry, pointer, model.fields, bound[pointer], label, true)" in MODULE
    assert "st.values[pointer] = encoding === 'string' ? JSON.stringify(next) : next;" in MODULE
    assert "text: 'Edit as fields'" in MODULE and "'Edit as JSON'" in JSON_MODULE
    assert "window.QymLaunchJson = { container, uniformKeys, editor };" in JSON_MODULE
    assert "text: 'All items'" in JSON_MODULE
    for banned in ("innerHTML", "insertAdjacentHTML", "localStorage", "console."):
        assert banned not in JSON_MODULE, banned


def test_json_styles_follow_the_design_language():
    assert not re.search(r"font-size:\s*\d", JSON_STYLES)
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", JSON_STYLES)
    assert "var(--text-dim)" not in JSON_STYLES
    body = re.sub(r"/\*.*?\*/", "", JSON_STYLES, flags=re.S)
    for selector in re.findall(r"(?:^|\})\s*([^{}]+?)\s*\{", body):
        for part in selector.split(","):
            classes = re.findall(r"\.([\w-]+)", part)
            assert classes and all(c.startswith("xlj-") for c in classes), part.strip()


# --------------------------------------------------------------------------- extra LLM endpoints


def test_add_llm_endpoint_controls_and_unconfirmed_slots():
    # "+ Add LLM endpoint" previews endpoint:<name> through model-slots?propose_endpoint
    # and keeps it on this experiment only (never PUT model-slots from the form).
    assert "'/model-slots?propose_endpoint=' + encodeURIComponent(name)" in MODULE
    assert "text: '+ Add LLM endpoint'" in MODULE
    assert "st.extraEndpoints.forEach((name) => st.selected.forEach((id) => {" in MODULE
    assert "tag('this experiment', 'accent'" in MODULE
    assert "removeExtraEndpoint(slot.slot_key.slice('endpoint:'.length))" in MODULE
    assert "sendJson('PUT'" not in MODULE and "method: 'PUT'" not in MODULE
    # Bases and clones bring their unconfirmed endpoint bindings back as extra slots.
    assert MODULE.count("await ensureExtraEndpoints(unconfirmedEndpoints(") == 2
    # Managers can still edit the environment's saved groupings from here.
    assert "text: 'Edit groupings'" in MODULE


def test_slot_preview_for_a_new_endpoint(client, env):
    url = f"/v1/projects/{P1}/eval-environments/{env.id}/model-slots"
    res = client.get(url, headers=_headers(MEMBER), params={"propose_endpoint": "fast"})
    assert res.status_code == 200, res.text
    proposal = res.json()["proposal"]
    assert proposal["slot_key"] == "endpoint:fast"
    assert proposal["field_map"]["model"] == "/LLM_OVERRIDES/endpoints/fast/model"


def test_form_launch_binds_a_project_model_to_an_added_endpoint(
    client, session_factory, env, conn
):
    # The body buildRequest() sends after "+ Add LLM endpoint" → fast → a project model.
    body = _form_body(env.id, conn.id)
    body["spec"]["slot_bindings"]["endpoint:fast"] = {"connection_id": conn.id}
    preview = client.post(_url(), headers=_headers(MEMBER), json=dict(body, dry_run=True))
    assert preview.status_code == 200, preview.text
    assert preview.json()["errors"] == []

    res = client.post(_url(), headers=_headers(MEMBER), json=body)
    assert res.status_code == 200, res.text
    (job,) = _jobs(session_factory, res.json()["id"])
    with session_factory() as s:
        environment = s.get(EvalEnvironment, env.id)
        schema = s.get(EvalEnvironmentSchema, job.schema_id)
        prep = prepare_dispatch(
            s,
            environment,
            body=job.request_body,
            slot_bindings=job.params["slot_bindings"],
            slots=list_model_slots(s, schema.id),
            descriptor=descriptor_for_schema(schema),
        )
    assert not prep.problems
    fast = prep.body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["fast"]
    assert fast["model"] == "gpt-4o"
    assert fast["api_key"] == CONN_KEY
