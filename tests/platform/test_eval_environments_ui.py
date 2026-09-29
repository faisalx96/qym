"""Project Settings → Environments tab (plan §12.1, §7.2; issue #8).

Static contract checks for the tab, the 3-step add dialog, the detail drawer and the
slot editor (``eval_environments.js``), plus the P1 exit flow the UI drives over the
API: register two environments, load their generated forms, confirm their slots.
No browser is needed (``node`` is not required either).
"""

from __future__ import annotations

import re
from pathlib import Path

# Reuse the environments API fixtures (fake Evaluation Service, users, projects).
from test_eval_environments_api import (  # noqa: F401  (pytest fixtures)
    KEY,
    MANAGER,
    MEMBER,
    _headers,
    _url,
    client,
    service,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
SETTINGS = (DASHBOARD / "project_settings.html").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "eval_environments.js").read_text(encoding="utf-8")
STYLES = (DASHBOARD / "eval_environments.css").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- static


def test_settings_page_has_environments_tab_and_panel():
    tab = re.search(r'<button[^>]*id="settings-tab-environments"[^>]*>', SETTINGS)
    assert tab, "Environments tab missing"
    for attr in (
        'role="tab"',
        'data-tab="environments"',
        'aria-controls="panel-environments"',
        "qym-tabs__tab",
    ):
        assert attr in tab.group(0)
    panel = re.search(r'<div[^>]*id="panel-environments"[^>]*>', SETTINGS)
    assert panel and 'role="tabpanel"' in panel.group(0) and "hidden" in panel.group(0)
    # Tab order: right after LLM Connections.
    assert SETTINGS.index("settings-tab-llm") < SETTINGS.index(
        "settings-tab-environments"
    )
    # Table columns required by §12.1.
    for column in (
        "Environment",
        "URL",
        "Health",
        "Schema",
        "LLM slots",
        "Official preset",
        "Priority cap",
        "In-flight cap",
    ):
        assert f">{column}</th>" in SETTINGS, column


def test_settings_page_loads_module_and_gates_writes_on_manager_role():
    assert '<script src="/static/eval_environments.js' in SETTINGS
    assert 'href="/static/eval_environments.css' in SETTINGS
    # Page-local styles load before the shared primitives (DESIGN_LANGUAGE §3).
    assert SETTINGS.index("eval_environments.css") < SETTINGS.index(
        "ui_components.css"
    )
    # The add button starts hidden and the panel is mounted with the manager check.
    assert re.search(r'id="add-environment-btn"[^>]*hidden', SETTINGS)
    assert "canManage: canManageMembers()" in SETTINGS
    assert "mountEnvironmentsPanel(" in SETTINGS
    assert "onGotoApiKeys" in SETTINGS and "settings-tab-apikeys" in SETTINGS


def test_module_public_api_and_endpoints():
    assert "window.QymEvalEnvironments = {" in MODULE
    for name in (
        "mountEnvironmentsPanel",
        "openAddDialog",
        "openEnvironmentDrawer",
        "createSlotEditor",
        "renderFormPreview",
    ):
        assert re.search(rf"\bfunction {name}\(", MODULE), name
    for path in (
        "/eval-environments",
        "/schema/refresh",
        "/model-slots",
        "propose_endpoint=",
        "/form",
        "/test",
    ):
        assert path in MODULE, path


def test_add_dialog_has_three_steps_and_ingest_reminder():
    for label in ("'Connect'", "'Review settings'", "'Group LLM settings'"):
        assert label in MODULE
    assert "Ingest with this project's key." in MODULE
    assert "QYM_API_KEY" in MODULE
    assert "data-env-goto-keys" in MODULE
    assert "EVAL_SERVER_PREFIX" in MODULE
    # Step 2 is a read-only grouped preview with a field count.
    assert "settings</span>" in MODULE and "read-only preview" in MODULE
    # Step 3 can be skipped (the launch form still works) or confirmed.
    assert "data-env-skip" in MODULE and "data-env-confirm" in MODULE


def test_slot_editor_supports_rename_merge_split_remove_add_confirm():
    for hook in (
        "data-slot-label",  # rename
        "data-slot-merge",  # merge flat slots
        "data-slot-role",  # re-map / unmap a field (split)
        "data-slot-detach",  # unmap a transport field (split)
        "data-slot-remove",
        "data-slot-restore",
        "data-add-endpoint",  # manual endpoint slot via propose_endpoint
        "data-add-flat",  # manual slot from a picked model field
        "data-slot-confirm",
    ):
        assert hook in MODULE, hook
    # Required slots (endpoint:primary) cannot be removed from the UI.
    assert "slot.required ? '' :" in MODULE
    # 422 {errors:[{slot_key, message}]} is mapped back onto the slot cards.
    assert "detail.errors.forEach" in MODULE


def test_drawer_has_refresh_diff_ranking_k_and_policies():
    for hook in (
        "data-drawer-refresh",
        "function diffHtml",
        "changed_types",
        'id="env-drawer-metric"',
        'id="env-drawer-k"',  # plan review: k next to the ranking metric
        "ranking_k",
        'id="env-drawer-max-priority"',
        'id="env-drawer-connection-keys"',
        'id="env-drawer-inflight"',
        "allow_connection_keys",
        "max_inflight_jobs",
    ):
        assert hook in MODULE, hook
    # Official preset version: rendered as an empty state until presets exist.
    assert "function officialPresetVersionHtml" in MODULE
    assert "official_preset_version" in MODULE


def test_drawer_and_row_write_controls_are_manager_only():
    # Every write control is emitted behind a canManage / canEdit check.
    for hook in (
        "data-drawer-test",
        "data-drawer-refresh",
        "data-drawer-save",
        "data-drawer-delete",
        "data-env-test",
    ):
        line = next(ln for ln in MODULE.splitlines() if hook in ln and "<button" in ln)
        prefix = MODULE[: MODULE.index(line)].splitlines()[-3:] + [line]
        assert any("canManage" in ln for ln in prefix), hook
    assert "canEdit: canManage && st.editing" in MODULE


def test_api_keys_are_never_rendered_or_kept():
    # Only the masked hint is displayed.
    assert "api_key_hint" in MODULE
    assert not re.search(r"\$\{[^}]*\.api_key\b(?!_)", MODULE)
    # Key inputs are password fields that are cleared after a successful submit.
    assert MODULE.count('type="password"') == 2
    assert "keyInput.value = ''" in MODULE
    # A blank key in the drawer is omitted so the stored key is kept.
    assert "if (apiKey) body.api_key = apiKey" in MODULE


def test_server_strings_are_escaped():
    # Server-provided names/URLs/errors interpolated into markup go through esc().
    # (Toasts use textContent and confirm dialogs escape, so they may interpolate.)
    raw = re.compile(
        r"\$\{(?:st\.)?(?:env|slot|group|other|entry|w|c|e)\.(?:name|base_url|health_error"
        r"|label|slot_key|description|message|pointer)\b(?!\s*\?)"
    )

    def strip_esc(line: str) -> str:
        """Drop every ``esc(...)`` call (balanced parentheses) from a line."""
        out, i = [], 0
        while i < len(line):
            if line.startswith("esc(", i):
                depth, i = 1, i + 4
                while i < len(line) and depth:
                    depth += {"(": 1, ")": -1}.get(line[i], 0)
                    i += 1
                continue
            out.append(line[i])
            i += 1
        return "".join(out)

    markup_lines = [ln for ln in MODULE.splitlines() if re.search(r"<[a-z]", ln)]
    offenders = [ln.strip() for ln in markup_lines if raw.search(strip_esc(ln))]
    assert not offenders, offenders
    assert "function esc(value)" in MODULE


def test_styles_use_tokens_and_page_prefix():
    assert not re.search(r"font-size:\s*\d", STYLES)
    css = re.sub(r"/\*.*?\*/", "", STYLES, flags=re.S)
    css = re.sub(r"@media[^{]*\{", "", css)
    selectors = re.findall(r"(?:^|\})\s*([^{}]+?)\s*\{", css)
    assert selectors
    for selector in selectors:
        for part in selector.split(","):
            classes = re.findall(r"\.([\w-]+)", part)
            assert any(
                c.startswith("env-") for c in classes
            ), f"page-local selector must use the env- prefix: {part.strip()}"


# --------------------------------------------------------------------------- P1 flow


def _create(client, name: str, url: str) -> dict:
    res = client.post(
        _url(),
        headers=_headers(MANAGER),
        json={"name": name, "base_url": url, "api_key": KEY},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_p1_exit_register_two_envs_review_forms_confirm_slots(client):
    """What the Environments tab drives: two envs → forms → confirmed slots."""
    first = _create(client, "staging", "https://eval-a.example.com/prefix")
    second = _create(client, "prod-mirror", "https://eval-b.example.com/prefix")

    listed = client.get(_url(), headers=_headers(MEMBER)).json()["environments"]
    assert [e["name"] for e in listed] == ["prod-mirror", "staging"]
    for env in listed:
        # Columns the table renders.
        for key in (
            "base_url",
            "health_status",
            "schema_hash",
            "schema_fetched_at",
            "model_slots",
            "max_priority",
            "max_inflight_jobs",
            "api_key_hint",
        ):
            assert key in env, key
        assert env["model_slots"]["needs_confirmation"] is True
        assert KEY not in str(env)

    for created in (first, second):
        env_id = created["environment"]["id"]
        # Step 2: the generated form (members may read it).
        form = client.get(_url(suffix=f"/{env_id}/form"), headers=_headers(MEMBER))
        assert form.status_code == 200
        descriptor = form.json()["descriptor"]
        assert descriptor["groups"] and any(
            f["kind"] == "field" for f in descriptor["fields"].values()
        )

        # Step 3: edit the proposal like the slot editor does and confirm it.
        slots = {s["slot_key"]: s for s in created["slots"]}
        primary = slots["endpoint:primary"]
        edited = [
            {
                "slot_key": "endpoint:primary",
                "kind": "endpoint",
                "label": "Main LLM",  # rename
                "field_map": {**primary["field_map"], "api_key": None},  # split
                "transport_fields": primary["transport_fields"],
            }
        ]
        preview = client.get(
            _url(suffix=f"/{env_id}/model-slots"),
            headers=_headers(MANAGER),
            params={"propose_endpoint": "fast"},
        ).json()
        edited.append({**preview["proposal"], "label": "Fast LLM"})  # add manually
        # flat:VIZ_LLM is left out: removed, its fields stay plain inputs.

        # Members cannot confirm.
        denied = client.put(
            _url(suffix=f"/{env_id}/model-slots"),
            headers=_headers(MEMBER),
            json={"slots": edited, "schema_id": created["environment"]["current_schema_id"]},
        )
        assert denied.status_code == 403

        res = client.put(
            _url(suffix=f"/{env_id}/model-slots"),
            headers=_headers(MANAGER),
            json={"slots": edited, "schema_id": created["environment"]["current_schema_id"]},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["needs_confirmation"] is False
        confirmed = {s["slot_key"]: s for s in body["slots"]}
        assert set(confirmed) == {"endpoint:primary", "endpoint:fast"}
        assert confirmed["endpoint:primary"]["label"] == "Main LLM"
        assert confirmed["endpoint:primary"]["field_map"]["api_key"] is None
        assert all(s["status"] == "confirmed" for s in body["slots"])

    listed = client.get(_url(), headers=_headers(MEMBER)).json()["environments"]
    assert all(not e["model_slots"]["needs_confirmation"] for e in listed)
    assert all(e["model_slots"]["counts"]["confirmed"] == 2 for e in listed)


def test_slot_editor_errors_come_back_per_slot(client):
    created = _create(client, "staging", "https://eval-a.example.com/prefix")
    env_id = created["environment"]["id"]
    res = client.put(
        _url(suffix=f"/{env_id}/model-slots"),
        headers=_headers(MANAGER),
        json={
            "slots": [
                {
                    "slot_key": "flat:VIZ_LLM",
                    "kind": "flat",
                    "field_map": {"model": "/VIZ_LLM_MODEL"},
                }
            ]
        },
    )
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    # The UI maps these onto cards by slot_key (primary is required).
    assert any(e["slot_key"] == "endpoint:primary" for e in errors)


def test_drawer_save_payload_round_trips(client):
    created = _create(client, "staging", "https://eval-a.example.com/prefix")
    env_id = created["environment"]["id"]
    body = {
        "name": "staging",
        "base_url": "https://eval-a.example.com/prefix",
        "ranking_metric": "exact_match",
        "ranking_k": 3,
        "max_priority": "HIGH",
        "default_priority": "NORMAL",
        "max_inflight_jobs": 7,
        "allow_connection_keys": True,
    }
    res = client.put(_url(suffix=f"/{env_id}"), headers=_headers(MANAGER), json=body)
    assert res.status_code == 200, res.text
    env = res.json()
    assert env["ranking_metric"] == "exact_match" and env["ranking_k"] == 3
    assert env["max_priority"] == "HIGH" and env["max_inflight_jobs"] == 7
    assert env["allow_connection_keys"] is True
    assert env["api_key_hint"] == "••••" + KEY[-4:]
    # Clearing the metric and k (blank inputs) sends nulls.
    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MANAGER),
        json={**body, "ranking_metric": None, "ranking_k": None},
    )
    assert res.json()["ranking_metric"] is None and res.json()["ranking_k"] is None
