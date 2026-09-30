"""Official/saved/clone bases and "Run official defaults" (plan §8.2, §9.2; #31).

- Server: ``base_source`` of kind ``official``/``saved`` must name a version of that
  kind of preset belonging to a selected environment, and ``clone`` an experiment
  (and job) of the project; all are stored canonically.
- The one-click path exactly as ``eval_environments.js`` ``runOfficialDefaults``
  drives it: read the current official version re-mapped onto the current schema,
  then create a 1-job experiment with ``base_source = {kind: official, …}`` (P3 exit
  criterion: a member launches official defaults in one click).
- Clone prefill data for ``?clone=<xid>&job=<jid>`` and a relaunch from it.
- Static checks on the launch form and the environments tab (no browser needed).
"""

from __future__ import annotations

import re
from pathlib import Path

from qym_platform.db.models import (
    EvalConfigPresetKind,
    EvalExperiment,
    EvalPriority,
)

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MANAGER,
    MEMBER,
    OUTSIDER,
    P1,
    P2,
    PRIMARY,
    _add_env,
    _add_preset_version,
    _headers,
    _jobs,
    _spec,
    _url,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
MODULE = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")
STYLES = (DASHBOARD / "experiment_launch.css").read_text(encoding="utf-8")
ENVIRONMENTS_JS = (DASHBOARD / "eval_environments.js").read_text(encoding="utf-8")
SETTINGS = (DASHBOARD / "project_settings.html").read_text(encoding="utf-8")


def _envs_url(project_id: str = P1, suffix: str = "") -> str:
    return f"/v1/projects/{project_id}/eval-environments{suffix}"


def _version_url(env_id: str, preset_id: str, version: int) -> str:
    return _envs_url(
        suffix=f"/{env_id}/presets/{preset_id}/versions/{version}?remap=current"
    )


def _launch(client, env_ids, base_source, email=MEMBER, spec=None, **extra):
    return client.post(
        _url(),
        headers=_headers(email),
        json={
            "name": "from a base",
            "environment_ids": env_ids,
            "spec": spec if spec is not None else _spec(),
            "base_source": base_source,
            **extra,
        },
    )


def _detail(res) -> str:
    detail = res.json()["detail"]
    return detail if isinstance(detail, str) else detail.get("message", "")


# --------------------------------------------------------------------------- env payload


def test_environment_payload_names_its_official_defaults(
    client, session_factory, env, conn
):
    (listed,) = client.get(_envs_url(), headers=_headers(MEMBER)).json()[
        "environments"
    ]
    assert listed["official_preset_version"] is None
    assert listed["official_preset_id"] is None
    assert listed["official_preset_version_id"] is None

    _add_preset_version(session_factory, env, _spec(conn.id), version=1)
    latest = _add_preset_version(session_factory, env, _spec(conn.id), version=2)
    # A saved preset is not "official defaults".
    _add_preset_version(
        session_factory, env, _spec(), kind=EvalConfigPresetKind.SAVED, name="mine"
    )
    (listed,) = client.get(_envs_url(), headers=_headers(MEMBER)).json()[
        "environments"
    ]
    single = client.get(_envs_url(suffix=f"/{env.id}"), headers=_headers(MEMBER))
    for payload in (listed, single.json()):
        assert payload["official_preset_version"] == 2
        assert payload["official_preset_version_id"] == latest.id
        assert payload["official_preset_id"] == latest.preset_id


# --------------------------------------------------------------------------- one click


def test_member_launches_official_defaults_in_one_click(
    client, session_factory, env, conn
):
    """P3 exit: what runOfficialDefaults() sends, end to end."""
    version = _add_preset_version(session_factory, env, _spec(conn.id), version=3)
    (card,) = client.get(_envs_url(), headers=_headers(MEMBER)).json()["environments"]

    res = client.get(
        _version_url(
            env.id, card["official_preset_id"], card["official_preset_version"]
        ),
        headers=_headers(MEMBER),
    )
    assert res.status_code == 200, res.text
    remap = res.json()["remap"]
    assert remap["ok"] is True and remap["dropped"] == []
    assert remap["config"]["evaluator"]["dataset"]  # launchable as is

    created = client.post(
        _url(),
        headers=_headers(MEMBER),
        json={
            "name": f"{env.name} · official v3",
            "environment_ids": [env.id],
            "spec": remap["config"],
            "base_source": {"kind": "official", "preset_version_id": version.id},
        },
    )
    assert created.status_code == 200, created.text
    experiment = created.json()
    base_source = {
        "kind": "official",
        "preset_id": version.preset_id,
        "preset_version_id": version.id,
        "version": 3,
        "environment_id": env.id,
    }
    assert experiment["base_source"] == base_source
    assert experiment["job_count"] == 1
    assert experiment["created_by_user_id"] == "member-1"
    (job,) = _jobs(session_factory, experiment["id"])
    assert job.environment_id == env.id and job.combo_index == 0
    assert job.params["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    snapshot = job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    assert snapshot["base_source"] == base_source
    assert job.request_body["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7


def test_one_click_on_a_high_default_needs_a_manager_and_the_acknowledgement(
    client, session_factory, conn
):
    high = _add_env(
        session_factory,
        "urgent",
        max_priority=EvalPriority.HIGH,
        default_priority=EvalPriority.HIGH,
    )
    version = _add_preset_version(session_factory, high, _spec(conn.id))
    base = {"kind": "official", "preset_version_id": version.id}
    # A member cannot launch at the HIGH default: the UI opens the form instead.
    assert _launch(client, [high.id], base, spec=_spec(conn.id)).status_code == 403
    # A manager is asked for the §5.3 acknowledgement first.
    res = _launch(client, [high.id], base, email=MANAGER, spec=_spec(conn.id))
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"
    res = _launch(
        client,
        [high.id],
        base,
        email=MANAGER,
        spec=_spec(conn.id),
        acknowledge_preemption=True,
    )
    assert res.status_code == 200, res.text
    assert res.json()["priority"] == "HIGH" and res.json()["job_count"] == 1


# --------------------------------------------------------------------------- base_source


def test_official_base_must_be_an_official_version_of_a_selected_env(
    client, session_factory, env, conn
):
    other = _add_env(session_factory, "other")
    foreign = _add_env(session_factory, "theirs", project_id=P2)
    official = _add_preset_version(session_factory, env, _spec())
    saved = _add_preset_version(
        session_factory, env, _spec(), kind=EvalConfigPresetKind.SAVED, name="mine"
    )
    other_official = _add_preset_version(session_factory, other, _spec())
    foreign_official = _add_preset_version(session_factory, foreign, _spec())

    cases = [
        ({"kind": "official"}, "preset_version_id is required"),
        ({"kind": "official", "preset_version_id": ""}, "is required"),
        ({"kind": "official", "preset_version_id": 7}, "is required"),
        ({"kind": "official", "preset_version_id": "x" * 65}, "is required"),
        ({"kind": "official", "preset_version_id": "missing"}, "selected environments"),
        # A version of an environment that is not part of this launch…
        (
            {"kind": "official", "preset_version_id": other_official.id},
            "selected environments",
        ),
        # …or of another project's environment: the same answer, nothing leaks.
        (
            {"kind": "official", "preset_version_id": foreign_official.id},
            "selected environments",
        ),
        (
            {"kind": "official", "preset_version_id": saved.id},
            "not a version of the official defaults",
        ),
        (
            {"kind": "saved", "preset_version_id": official.id},
            "not a saved preset version",
        ),
        ({"kind": "nope"}, "base_source.kind"),
    ]
    for base, message in cases:
        for dry_run in (True, False):
            res = _launch(client, [env.id], base, dry_run=dry_run)
            assert res.status_code == 422, (base, res.text)
            assert message in _detail(res), (base, res.text)
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0

    # Two environments: the official version of either one is accepted.
    res = _launch(
        client,
        [env.id, other.id],
        {"kind": "official", "preset_version_id": other_official.id},
    )
    assert res.status_code == 200, res.text
    assert res.json()["base_source"]["environment_id"] == other.id


def test_saved_base_is_stored_canonically_and_extra_keys_are_dropped(
    client, session_factory, env
):
    saved = _add_preset_version(
        session_factory,
        env,
        _spec(),
        kind=EvalConfigPresetKind.SAVED,
        name="mine",
        version=2,
    )
    res = _launch(
        client,
        [env.id],
        {
            "kind": "saved",
            "preset_version_id": saved.id,
            "environment_id": "spoofed",
            "note": "<script>",
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["base_source"] == {
        "kind": "saved",
        "preset_id": saved.preset_id,
        "preset_version_id": saved.id,
        "version": 2,
        "environment_id": env.id,
    }
    blank = _launch(client, [env.id], {"kind": "blank", "junk": 1})
    assert blank.json()["base_source"] == {"kind": "blank"}


def test_clone_base_must_be_an_experiment_and_job_of_this_project(
    client, session_factory, env
):
    source = _launch(client, [env.id], {"kind": "blank"}).json()
    (job,) = _jobs(session_factory, source["id"])
    theirs_env = _add_env(session_factory, "theirs", project_id=P2)
    theirs = client.post(
        _url(P2),
        headers=_headers(OUTSIDER),
        json={"name": "x", "environment_ids": [theirs_env.id], "spec": _spec()},
    ).json()
    other = _launch(client, [env.id], {"kind": "blank"}).json()
    (other_job,) = _jobs(session_factory, other["id"])

    cases = [
        ({"kind": "clone"}, "experiment_id is required"),
        ({"kind": "clone", "experiment_id": theirs["id"]}, "of this project"),
        ({"kind": "clone", "experiment_id": "missing"}, "of this project"),
        (
            {"kind": "clone", "experiment_id": source["id"], "job_id": other_job.id},
            "not a job of that experiment",
        ),
    ]
    for base, message in cases:
        res = _launch(client, [env.id], base)
        assert res.status_code == 422, (base, res.text)
        assert message in _detail(res), (base, res.text)

    res = _launch(
        client,
        [env.id],
        {"kind": "clone", "experiment_id": source["id"], "job_id": job.id, "x": 1},
    )
    assert res.status_code == 200, res.text
    assert res.json()["base_source"] == {
        "kind": "clone",
        "experiment_id": source["id"],
        "job_id": job.id,
    }


# --------------------------------------------------------------------------- clone prefill


def test_clone_prefill_and_rerun_of_one_job(client, session_factory, env, conn):
    source = _launch(
        client, [env.id], {"kind": "blank"}, spec=_spec(conn.id)
    ).json()
    (job,) = _jobs(session_factory, source["id"])

    prefill = client.post(
        _url(suffix=f"/{source['id']}/clone"), headers=_headers(MEMBER)
    )
    assert prefill.status_code == 200, prefill.text
    data = prefill.json()
    assert data["environment_ids"] == [env.id]
    assert data["base_source"]["kind"] == "clone"
    assert data["spec"]["evaluator"]["dataset"] == "playground_set_v2"

    # With ?job=: the form reads that job's qym_config (secret-free).
    detail = client.get(_url(suffix=f"/{source['id']}"), headers=_headers(MEMBER))
    (row,) = detail.json()["jobs"]
    config = row["qym_config"]
    assert config["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    assert "$secret" not in str(config)

    # What buildRequest() sends back: bindings normalized to {connection_id}.
    rerun = _launch(
        client,
        [row["environment_id"]],
        {"kind": "clone", "experiment_id": source["id"], "job_id": job.id},
        spec={
            "evaluator": config["evaluator"],
            "slot_bindings": {PRIMARY: {"connection_id": conn.id}},
            "env_overrides": config["env_overrides"],
        },
    )
    assert rerun.status_code == 200, rerun.text
    assert rerun.json()["job_count"] == 1
    (new_job,) = _jobs(session_factory, rerun.json()["id"])
    assert new_job.request_body["env_overrides"] == job.request_body["env_overrides"]


# --------------------------------------------------------------------------- static UI


def test_launch_form_offers_official_and_saved_bases():
    base = re.search(r"const BASE_OPTIONS = \[(.*?)\];", MODULE, re.S).group(1)
    assert re.search(r"kind: 'official'[^}]*available: true", base)
    assert re.search(r"kind: 'saved'[^}]*available: true", base)
    assert re.search(r"kind: 'best_run'[^}]*available: true", base)  # #38
    assert "const CLONE_OPTION = { kind: 'clone'" in MODULE
    # Official defaults is the default when published; otherwise Blank, with a note.
    assert "if (!st.baseTouched) kind = 'official';" in MODULE
    assert "so the form starts from Blank." in MODULE
    assert "return official ? official.id : (envs[0] ? envs[0].id : null);" in MODULE
    # Presets load re-mapped onto the current schema; dropped settings are listed.
    assert "'/presets'" in MODULE and "'?remap=current'" in MODULE
    assert "remap.dropped" in MODULE and "data-xl-remap-dropped" in MODULE
    assert "(w) => w.rule !== 'schema_hash'" in MODULE
    # base_source names the version; the server checks it.
    assert "{ kind: st.base, preset_version_id: info.versionId }" in MODULE
    assert "pointer: '#base'" in MODULE and "if (pointer === '#base') return hosts.base;" in MODULE


def test_changed_dots_reset_to_base_diff_counter_and_switch_base():
    # "Changed" means different from the base, not merely set.
    assert "!sameValue(st.values[pointer], st.baseline.values[pointer])" in MODULE
    assert "const changed = isChanged(pointer);" in MODULE
    assert "(row._xlPointers || []).some(isChanged)" in MODULE
    # Reset puts the base value back.
    assert "st.values[pointer] = deepCopy(st.baseline.values[pointer])" in MODULE
    assert "'Reset all to base'" in MODULE and "function resetAllToBase()" in MODULE
    assert "'data-xl-binding-changed': '1'" in MODULE
    # Diff vs base in the base section, header meta and preview.
    assert "' vs base'" in MODULE
    assert "'data-xl-diff-count': '1'" in MODULE
    assert "'data-xl-base-meta': '1'" in MODULE
    assert "baseLabel() + ' · ' + diffText()" in MODULE
    # Switch base: confirmed, keeps the edits that exist on the new base.
    assert "title: 'Switch base?'" in MODULE and "confirmLabel: 'Switch base'" in MODULE
    assert "const edits = captureEdits();" in MODULE
    assert "if (!matchTemplate(fields, p)) { dropped += 1; return; }" in MODULE
    assert "if (slotKeys.indexOf(k) < 0) { dropped += 1; return; }" in MODULE
    # Base evaluator inputs are sent; settings no selected env knows are reported.
    assert "Object.assign(deepCopy(st.evaluatorExtra) || {}" in MODULE
    assert "' was dropped: not in any selected environment.'" in MODULE


def test_clone_prefill_asks_for_temporary_keys_again():
    assert "params.get('clone')" in MODULE and "params.get('job')" in MODULE
    assert "params.get('env')" in MODULE
    assert "'/clone' + (jobId ? '?job_id=' + encodeURIComponent(jobId) : '')" in MODULE
    assert "row.qym_config" in MODULE  # fallback without ?job_id= support
    assert "source.job_id = st.clone.jobId" in MODULE
    assert "Temporary models are copied without their API keys" in MODULE
    assert "secretRef: null, needsKey: true" in MODULE
    assert "type: 'password'" in MODULE and "'Use key'" in MODULE
    # Re-entered keys live only in st.secrets, like the temporary-model form's.
    assert "st.secrets[ref] = key;" in MODULE
    assert "function pruneSecrets()" in MODULE
    # Still no HTML parsing beyond the escaped chip, and no storage.
    assert MODULE.count("innerHTML") == 2
    for banned in ("localStorage", "sessionStorage", "console.", "history."):
        assert banned not in MODULE, banned


def test_environments_tab_runs_official_defaults_in_one_click():
    assert "data-env-run-official=\"${id}\"" in ENVIRONMENTS_JS
    assert ">Run official defaults</button>" in ENVIRONMENTS_JS
    # Only for active environments with a schema and a published version.
    assert (
        "env.is_active && env.current_schema_id && env.official_preset_id "
        "&& env.official_preset_version != null" in ENVIRONMENTS_JS
    )
    assert "button.dataset.envRunOfficial" in ENVIRONMENTS_JS
    assert "runOfficialDefaults," in ENVIRONMENTS_JS  # exported
    for needle in (
        "?remap=current",
        "base_source: { kind: 'official', preset_version_id: version.id }",
        "environment_ids: [env.id]",
        "spec: remap.config",
        "if (env.default_priority === 'HIGH')",
        "body.acknowledge_preemption = true",
        "highPriorityWarning(env.name)",
        "'preemption_acknowledgement_required'",
        "new=1&env=${encodeURIComponent(env.id)}",
        "experiment=${encodeURIComponent(launch.data.id)}",
    ):
        assert needle in ENVIRONMENTS_JS, needle
    # Not launchable as is → the launch form, never a silent change of model.
    fn = ENVIRONMENTS_JS[ENVIRONMENTS_JS.index("function officialLaunchBlocker") :]
    fn = fn[: fn.index("\n  }\n")]
    for needle in ("remap.errors", "evaluator.dataset", ".temporary", "connection_missing"):
        assert needle in fn, needle
    # The button title is escaped like every other interpolated string.
    assert "title=\"${esc(`Launch a 1-job experiment" in ENVIRONMENTS_JS
    assert "projectSlug: state.project.slug" in SETTINGS


def test_new_styles_follow_the_design_language():
    for selector in (".xl-base-status", ".xl-base-label", ".xl-callout-list", ".xl-model-key"):
        assert selector in STYLES, selector
    assert not re.search(r"font-size:\s*\d", STYLES)
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", STYLES)
