"""Official defaults editor, publish and history UI; saved presets list (#30).

- API round trip exactly as ``eval_official_defaults.js`` drives it (P3 exit: a
  manager publishes v1): the drawer reads ``can_publish_official``/``can_publish``,
  the editor publishes the §8.1 document it builds (no dataset needed, schema hash
  pinned) with required release notes, and members see the history (notes, author,
  date) but are refused when they try to publish.
- Static checks: the launch form's editor mode (mountEditor), the drawer section,
  the settings page wiring and the new stylesheet (no browser needed).
"""

from __future__ import annotations

import re
from pathlib import Path

from qym_platform.db.models import EvalConfigPresetVersion

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MANAGER,
    MEMBER,
    MEMBER2,
    P1,
    PRIMARY,
    _headers,
    _spec,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
LAUNCH = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "eval_official_defaults.js").read_text(encoding="utf-8")
STYLES = (DASHBOARD / "eval_official_defaults.css").read_text(encoding="utf-8")
ENVIRONMENTS_JS = (DASHBOARD / "eval_environments.js").read_text(encoding="utf-8")
SETTINGS = (DASHBOARD / "project_settings.html").read_text(encoding="utf-8")
EXPERIMENTS = (DASHBOARD / "experiments.html").read_text(encoding="utf-8")


def _presets(env_id: str, suffix: str = "") -> str:
    return f"/v1/projects/{P1}/eval-environments/{env_id}/presets{suffix}"


def _editor_document(env, conn_id: str | None) -> dict:
    """What the editor's editorConfig() sends: no empty dataset, the env's hash."""
    doc = _spec(conn_id)
    doc["evaluator"].pop("dataset")
    doc["schema_hash"] = "h-" + env.name
    return doc


# --------------------------------------------------------------------------- API


def test_manager_publishes_v1_and_members_read_history_but_cannot_publish(
    client, session_factory, env, conn
):
    """P3 exit: a manager publishes v1 from the editor; members only read."""
    # Drawer as a member: nothing published, no publish permission.
    listed = client.get(_presets(env.id), headers=_headers(MEMBER))
    assert listed.status_code == 200, listed.text
    assert listed.json()["can_publish_official"] is False
    assert listed.json()["presets"] == []
    # Drawer as a manager: "Publish v1".
    listed = client.get(_presets(env.id), headers=_headers(MANAGER)).json()
    assert listed["can_publish_official"] is True

    doc = _editor_document(env, conn.id)
    refused = client.post(
        _presets(env.id),
        headers=_headers(MEMBER),
        json={"kind": "official", "config": doc, "notes": "sneaky"},
    )
    assert refused.status_code == 403
    no_notes = client.post(
        _presets(env.id),
        headers=_headers(MANAGER),
        json={"kind": "official", "config": doc, "notes": "   "},
    )
    assert no_notes.status_code == 422
    assert "Release notes are required" in no_notes.text

    published = client.post(
        _presets(env.id),
        headers=_headers(MANAGER),
        json={"kind": "official", "config": doc, "notes": "First defaults"},
    )
    assert published.status_code == 200, published.text
    preset = published.json()["preset"]
    v1 = preset["current_version"]
    assert preset["kind"] == "official" and v1["version"] == 1
    assert v1["notes"] == "First defaults"
    assert v1["published_by"] == {"id": "manager-1", "name": "manager"}
    assert v1["published_at"]
    assert v1["config"]["slot_bindings"][PRIMARY] == {"connection_id": conn.id}
    assert "dataset" not in v1["config"]["evaluator"]

    # The environments list (table column, "Run official defaults") names v1.
    (card,) = client.get(
        f"/v1/projects/{P1}/eval-environments", headers=_headers(MEMBER)
    ).json()["environments"]
    assert card["official_preset_version"] == 1
    assert card["official_preset_id"] == preset["id"]

    # A member sees the history with notes, author and date, but cannot publish.
    member_view = client.get(_presets(env.id), headers=_headers(MEMBER)).json()
    (official,) = member_view["presets"]
    assert member_view["can_publish_official"] is False
    assert official["can_publish"] is False
    history = client.get(
        _presets(env.id, f"/{preset['id']}/versions"), headers=_headers(MEMBER)
    )
    assert history.status_code == 200
    (row,) = history.json()["versions"]
    assert (row["version"], row["notes"], row["published_by"]["name"]) == (
        1,
        "First defaults",
        "manager",
    )
    member_publish = client.post(
        _presets(env.id, f"/{preset['id']}/versions"),
        headers=_headers(MEMBER),
        json={"config": doc, "notes": "mine now"},
    )
    assert member_publish.status_code == 403

    # The manager publishes v2; v1 is untouched and still readable (read-only view).
    changed = _editor_document(env, conn.id)
    changed["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = 0.8
    v2 = client.post(
        _presets(env.id, f"/{preset['id']}/versions"),
        headers=_headers(MANAGER),
        json={"config": changed, "notes": "Raise the threshold"},
    )
    assert v2.status_code == 200, v2.text
    assert v2.json()["version"]["version"] == 2
    old = client.get(
        _presets(env.id, f"/{preset['id']}/versions/1?remap=current"),
        headers=_headers(MEMBER),
    )
    assert old.status_code == 200
    assert old.json()["version"]["config"]["env_overrides"][
        "MILVUS_SEARCH_THRESHOLD"
    ] == 0.7
    assert old.json()["remap"]["ok"] is True
    with session_factory() as s:
        versions = (
            s.query(EvalConfigPresetVersion)
            .filter(EvalConfigPresetVersion.preset_id == preset["id"])
            .order_by(EvalConfigPresetVersion.version)
            .all()
        )
        assert [v.version for v in versions] == [1, 2]
        assert versions[0].config["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7


def test_publish_refuses_temporary_models_and_sweeps_with_pointed_errors(
    client, env
):
    doc = _editor_document(env, None)
    doc["slot_bindings"] = {
        PRIMARY: {"temporary": {"label": "trial", "model": "gpt-4o-mini"}}
    }
    res = client.post(
        _presets(env.id),
        headers=_headers(MANAGER),
        json={"kind": "official", "config": doc, "notes": "try"},
    )
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert any(e["rule"] == "temporary_binding" for e in errors)
    # The editor focuses the field an error points at.
    assert all(e["pointer"].startswith("/") for e in errors)

    swept = _editor_document(env, None)
    swept["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    res = client.post(
        _presets(env.id),
        headers=_headers(MANAGER),
        json={"kind": "official", "config": swept, "notes": "sweep"},
    )
    assert res.status_code == 422


def test_saved_presets_list_names_author_and_update_time(client, env, conn):
    created = client.post(
        _presets(env.id),
        headers=_headers(MEMBER2),
        json={"kind": "saved", "name": "Low threshold", "config": _spec(conn.id)},
    )
    assert created.status_code == 200, created.text
    listed = client.get(_presets(env.id), headers=_headers(MEMBER)).json()
    (saved,) = [p for p in listed["presets"] if p["kind"] == "saved"]
    assert saved["name"] == "Low threshold"
    assert saved["created_by"] == {"id": "member-2", "name": "member2"}
    assert saved["updated_at"] and saved["current_version"]["version"] == 1


# --------------------------------------------------------------------------- static


def test_launch_form_has_a_small_editor_mode():
    assert "function mountEditor(options)" in LAUNCH
    assert "{ mount, mountEditor, BASE_OPTIONS }" in LAUNCH
    assert "opts.mode === 'editor'" in LAUNCH
    # Editor mode drops environments, priority, name and the dry-run preview.
    layout = LAUNCH[LAUNCH.index("function renderEditorLayout()") :]
    layout = layout[: layout.index("function editorErrors()")]
    for section in ("'dataset'", "'base'", "'models'", "'settings'", "data-xl-advanced"):
        assert section in layout
    for section in ("'environments'", "'run'", "Launch"):
        assert section not in layout
    assert "if (editor) { renderPreviewSoon(); return; }" in LAUNCH
    assert "if (editor) { renderEditorPanel(host); return; }" in LAUNCH
    # One configuration: sweeps and (for official defaults) temporary models refused.
    assert "Sweeps are not allowed here" in LAUNCH
    assert "opts.allowTemporary === false" in LAUNCH
    # Output is a config document handed to onSave, never a launch.
    assert "opts.onSave({ config: editorConfig()" in LAUNCH
    assert "delete spec.slot_bindings[key].temporary.api_key" in LAUNCH
    # Diff vs base reuses #31's counting; notes can be required.
    assert "diff: diffVsBase()" in LAUNCH
    assert "opts.notesRequired" in LAUNCH
    # #34 sweeps can tell the modes apart.
    assert "mode: editor ? 'editor' : 'launch'" in LAUNCH


def test_launch_form_opens_a_saved_preset_from_the_url():
    assert "params.get('preset')" in LAUNCH
    assert "params.get('base')) === 'saved'" in LAUNCH
    assert "st.savedPresetId = presetParam" in LAUNCH


def test_drawer_section_publish_history_and_saved_presets():
    for needle in (
        "function renderDrawerSection(container, options)",
        "function openEditor(options)",
        "can_publish_official",
        "can_publish",
        "'/versions'",
        "?remap=current",
        "kind: 'official'",
        "notesRequired: true",
        "notesLabel: 'Release notes'",
        "allowTemporary: false",
        "Version history",
        "published_by",
        "Config document (read-only)",
        "Only project managers publish official defaults",
        "&base=saved&preset=",
        "Saved presets",
        "created_by",
        "launch.mountEditor(",
    ):
        assert needle in MODULE, needle
    # Write actions only when the API says so and a host can mount the editor.
    assert "if (!data.canPublishOfficial) return false;" in MODULE
    assert "typeof opts.onEdit === 'function'" in MODULE
    # Nothing is parsed as HTML.
    assert "innerHTML" not in MODULE
    assert "ensureStylesheet()" in MODULE


def test_environment_drawer_and_settings_page_are_wired():
    assert "presets: presetsSection" in ENVIRONMENTS_JS
    assert "window.QymOfficialDefaults.renderDrawerSection(target" in ENVIRONMENTS_JS
    assert "onEditOfficial: ctl.opts.onEditOfficial" in ENVIRONMENTS_JS
    for script in (
        "eval_temporary_model.js",
        "experiment_launch_advanced.js",
        "experiment_launch.js",
        "eval_official_defaults.js",
    ):
        assert f'src="/static/{script}' in SETTINGS, script
    assert 'href="/static/eval_official_defaults.css' in SETTINGS
    assert 'id="env-editor-host"' in SETTINGS
    assert "onEditOfficial: openOfficialDefaultsEditor" in SETTINGS
    assert "window.QymOfficialDefaults.openEditor({" in SETTINGS
    # Both pages load the same launch-form build.
    version = re.search(r"experiment_launch\.js\?v=([\w-]+)", SETTINGS).group(1)
    assert f"experiment_launch.js?v={version}" in EXPERIMENTS


def test_new_styles_follow_the_design_language():
    assert not re.search(r"font-size:\s*\d", STYLES)
    assert "var(--text-dim)" not in STYLES
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", STYLES)
    rules = re.sub(r"/\*.*?\*/", "", STYLES, flags=re.S)
    selectors = re.findall(r"([^{}]+)\{", rules)
    for selector in selectors:
        for part in selector.split(","):
            assert part.strip().startswith(".odx-"), part
