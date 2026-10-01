"""Sweep UI of the launch form (plan §8.3, §12.2, §8.1; issue #34).

Static contract checks on ``experiment_launch_sweeps.js``/``.css``, the hooks in
``experiment_launch.js`` and the Raw JSON round trip in
``experiment_launch_advanced.js`` (no browser or ``node`` needed), plus API round
trips with the spec the UI builds. ``ui_spec()`` mirrors ``buildSpec()``: swept
values are stored as ``{"sweep": [...]}`` in ``st.values`` (flattened pointers,
nested by ``buildOverrides``), a model sweep is ``st.bindings[slot] = {kind: 'raw',
value: {sweep: [binding, ...]}}``, and "Link selected" writes ``st.links``. The P4
exit criterion: 2 models × 2 thresholds × 2 environments = 8 runs from one submit.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from test_eval_sweeps import conn2  # noqa: F401  (fixture)
from test_experiments_api import (  # noqa: F401  (fixtures)
    CONN_KEY,
    MEMBER,
    PRIMARY,
    _add_env,
    _create,
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
LAUNCH = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")
ADVANCED = (DASHBOARD / "experiment_launch_advanced.js").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "experiment_launch_sweeps.js").read_text(encoding="utf-8")
STYLES = (DASHBOARD / "experiment_launch_sweeps.css").read_text(encoding="utf-8")

THR = "/env_overrides/MILVUS_SEARCH_THRESHOLD"
TEMP = "/env_overrides/LLM_OVERRIDES/main/temperature"
BIND = "/slot_bindings/endpoint:primary"
TEMP_KEY = "sk-swept-temporary-KEY-7777"


# --------------------------------------------------------------------------- JS mirror


def expand_range(start: float, stop: float, step: float) -> List[float]:
    """Mirror of expandRange() in experiment_launch_sweeps.js."""

    def decimals(num: float) -> int:
        text = repr(num)
        return len(text.split(".")[1]) if "." in text else 0

    count = int((stop - start) / step + 1e-9) + 1
    places = max(decimals(start), decimals(step))
    return [round(start + i * step, places) for i in range(count)]


def build_overrides(values: Dict[str, Any]) -> Dict[str, Any]:
    """Mirror of buildOverrides(): flat {pointer: value} → nested env_overrides."""
    out: Dict[str, Any] = {}
    for pointer in sorted(values):
        segments = [
            s.replace("~1", "/").replace("~0", "~") for s in pointer.split("/")[1:]
        ]
        node = out
        for segment in segments[:-1]:
            node = node.setdefault(segment, {})
        node[segments[-1]] = values[pointer]
    return out


def ui_spec(
    bindings: Dict[str, Any],
    values: Dict[str, Any],
    links: Optional[list] = None,
    config: Optional[dict] = None,
) -> Dict[str, Any]:
    """Mirror of buildSpec() for a blank base with a project dataset."""
    evaluator: Dict[str, Any] = {"dataset": "playground_set_v2"}
    if config:
        evaluator["config"] = config  # the Advanced panel's decorateSpec()
    spec: Dict[str, Any] = {
        "evaluator": evaluator,
        "slot_bindings": bindings,
        "env_overrides": build_overrides(values),
    }
    if links:
        spec["links"] = links
    return spec


def ui_request(
    env_ids: List[str], spec: dict, *, dry_run: bool, secrets: Optional[dict] = None
) -> dict:
    """Mirror of buildRequest()."""
    return {
        "name": "rag-vs-model",
        "environment_ids": env_ids,
        "spec": spec,
        "base_source": {"kind": "blank"},
        "dry_run": dry_run,
        "secrets": secrets or {},
        "save_to_project_models": [],
    }


def _post(client, body: dict):
    return client.post(_url(), headers=_headers(MEMBER), json=body)


def _p4_spec(conn_a: str, conn_b: str, **kwargs) -> dict:
    # "+ models" then checking two project models on the primary card; "+ values"
    # on the threshold, then the range helper 0.5 → 0.7 step 0.2.
    thresholds = expand_range(0.5, 0.7, 0.2)
    assert thresholds == [0.5, 0.7]
    return ui_spec(
        {PRIMARY: {"sweep": [{"connection_id": conn_a}, {"connection_id": conn_b}]}},
        {
            "/LLM_OVERRIDES/endpoints/primary/timeout": 60,
            "/LLM_OVERRIDES/main/endpoint": "primary",
            "/MILVUS_SEARCH_THRESHOLD": {"sweep": thresholds},
        },
        **kwargs,
    )


# --------------------------------------------------------------------------- page + hooks


def test_page_loads_the_sweeps_assets_before_the_form(client):
    assets = re.findall(r'(?:src|href)="/static/([^"?]+)', PAGE)
    for asset in ("experiment_launch_sweeps.js", "experiment_launch_sweeps.css"):
        assert asset in assets, asset
        assert client.get(f"/static/{asset}").status_code == 200, asset
    assert PAGE.index('src="/static/experiment_launch_sweeps.js') < PAGE.index(
        'src="/static/experiment_launch.js'
    )
    assert "'static/experiment_launch_sweeps.css" in LAUNCH


def test_launch_form_hooks_are_small_and_can_be_disabled():
    assert "'data-xl-sweeps': '1'" in LAUNCH
    assert "const api = window.QymLaunchSweeps;" in LAUNCH
    assert "sweeps = api.mount(host, sweepsApi());" in LAUNCH
    # Editor mode (#30) and other forms without sweeps: mount({ sweeps: false }).
    assert "opts.sweeps === false" in LAUNCH
    for call in (
        "sweeps.localErrors()",
        "sweeps.onSpecChange()",
        "sweeps.modelCard(slot, { head, fills })",
        "sweeps.modelToggle(slot)",
        "sweeps.editor({",
        "sweeps.toggle({",
        "sweeps.previewAxes(st.preview)",
    ):
        assert LAUNCH.count(call) == 1, call
    assert "if (sweeps) sweeps.teardown();" in LAUNCH
    # Every hook is guarded, so the form works without the module.
    assert "sweeps ? sweeps.modelCard" in LAUNCH
    assert "if (!sweeps || boundBy" in LAUNCH
    # Advanced sees the module (or null) and shares the role-cell helper.
    assert "sweeps, // #34: null when sweeps are off" in LAUNCH
    assert "api.fillCell(td, control, entry, pointer, bound[pointer]" in ADVANCED


def test_swept_values_live_in_the_form_state():
    # One source of truth: {"sweep": [...]} in st.values / st.bindings, links in st.links.
    assert "set: (value) => sweepTarget(pointer).set(value)" in LAUNCH
    assert "api.setBinding(slot.slot_key, { kind: 'raw', value: { sweep: " in MODULE
    assert "st.links = model.groups.concat([picked]);" in MODULE
    assert "if (st.links) spec.links = deepCopy(st.links);" in LAUNCH
    # Links of values that stop being swept are dropped; base switches keep them.
    assert "const groups = cleanLinks(st.links, sweptSet());" in MODULE
    assert "st.clone.linkedGroups) : links;" in LAUNCH
    # A sweep editor writes the state itself; the leaf listener only re-marks.
    assert "if (!control.hasAttribute('data-xs-sweep'))" in LAUNCH


def test_widgets():
    assert "window.QymLaunchSweeps = { mount, sweepable, checkValues, bindingKey };" in MODULE
    # "+ values" on every sweepable field: scalars only, never keys.
    assert "text: '+ values'" in MODULE
    assert "SCALAR_TYPES = ['integer', 'number', 'boolean', 'enum', 'string']" in MODULE
    assert "entry.secret || entry.widget === 'secret'" in MODULE
    # Booleans: [true, false] in one click.
    assert "if (o.entry.type === 'boolean') start = [true, false];" in MODULE
    # Enums, booleans and endpoint references: a multi-select of pressed chips.
    assert "className: 'qym-chip xs-chip', 'aria-pressed':" in MODULE
    assert "o.entry.type === 'enum'" in MODULE and "'endpoint-ref'" in MODULE
    # Numbers: typed lists and a start/stop/step range expanded client-side.
    assert "function expandRange(entry, startRaw, stopRaw, stepRaw)" in MODULE
    assert "RANGE_MAX = 100" in MODULE
    assert "'Add range'" in MODULE and "'Range…'" in MODULE
    # Back to one value.
    assert "'Single value'" in MODULE and "'Single model'" in MODULE


def test_models_multi_select_per_slot():
    assert "text: '+ models'" in MODULE
    assert "api.slotConnections(slot)" in MODULE
    assert "chip('inherit', { inherit: true }, 'Inherit'" in MODULE
    # Temporary models may be swept; their keys go straight to the form's memory.
    assert "api.rememberSecret(result.secretRef, result.apiKey)" in MODULE
    assert "canSaveToProject: false" in MODULE
    assert "rememberSecret: (ref, key) => { st.secrets[ref] = key; }" in LAUNCH
    # Keys of swept temporary models are sent in `secrets` and survive edits.
    assert "bindingSecretRefs(b).forEach((ref) => { if (has(st.secrets, ref))" in LAUNCH
    assert "clearBinding(slotKey, bindingSecretRefs(binding));" in LAUNCH


def test_linked_groups_ui():
    assert "text: 'Sweeps'" in MODULE
    assert "text: 'Link selected'" in MODULE and "text: 'Unlink'" in MODULE
    assert "'data-xl-pointer': '/links'" in MODULE  # link errors focus the card
    assert "Linked values need the same number of values" in MODULE
    assert "function checkLinks(doc)" in MODULE


def test_preview_runs_and_cap():
    assert "'Preview ' + count + ' run'" in LAUNCH
    assert "st.preview.combo_count" in LAUNCH
    assert "if (res.data && res.data.max_jobs != null) st.maxJobs = res.data.max_jobs;" in LAUNCH
    # Submit is disabled over the cap, on the dry run's count or the local estimate.
    assert "disabled: st.launching || !st.selected.length || overCap," in LAUNCH
    assert "if (st.launching || overRunLimit()) return;" in LAUNCH
    assert "return estimate > cap || runCount() > cap;" in LAUNCH
    assert "function jobEstimate()" in MODULE
    assert "'data-xl-over-cap': '1'" in LAUNCH


def test_raw_json_round_trips_sweeps():
    assert "not editable in this form yet" not in ADVANCED
    assert "adv.links" not in ADVANCED
    assert "api.sweeps.checkValues(entry, value)" in ADVANCED
    assert "api.sweeps.checkLinks(doc)" in ADVANCED
    assert "next[slotKey] = { kind: 'raw', value: { sweep: items } };" in ADVANCED
    assert "st.links = result.links || undefined;" in ADVANCED
    assert "api.sweeps.editor({" in ADVANCED  # evaluation inputs are sweepable too
    # Without the module, JSON sweeps are refused rather than silently dropped.
    assert "if (!api.sweeps) { errors.push({ pointer, message: SWEEP_MESSAGE });" in ADVANCED


def test_nothing_parses_as_html_and_keys_are_never_read():
    for banned in (
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "console.",
        "st.secrets",
    ):
        assert banned not in MODULE, banned
    assert "node.textContent" not in MODULE  # nodes come from api.el()
    assert LAUNCH.count("innerHTML") == 2  # still only the escaped temporary chip


def test_styles_follow_the_design_language():
    assert not re.search(r"font-size:\s*\d", STYLES)
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", STYLES)
    assert "qym-" not in STYLES  # shared components are never restyled
    body = re.sub(r"/\*.*?\*/", "", STYLES, flags=re.S)
    for selector in re.findall(r"(?:^|\})\s*([^{}]+?)\s*\{", body):
        for part in selector.split(","):
            classes = re.findall(r"\.([\w-]+)", part)
            assert classes and all(c.startswith("xs-") for c in classes), part
    assert not re.search(r"fontSize:\s*['\"]\d", MODULE)
    assert not re.search(r"#[0-9a-fA-F]{6}\b", MODULE)


# --------------------------------------------------------------------------- API


def test_range_helper_mirror():
    assert expand_range(0.1, 0.5, 0.1) == [0.1, 0.2, 0.3, 0.4, 0.5]
    assert expand_range(1, 10, 3) == [1, 4, 7, 10]
    assert expand_range(0.5, 0.75, 0.1) == [0.5, 0.6, 0.7]


def test_p4_two_models_two_thresholds_two_envs_is_eight_runs(
    client, session_factory, env, conn, conn2  # noqa: F811
):
    prod = _add_env(session_factory, "prod")
    spec = _p4_spec(conn.id, conn2.id)
    envs = [env.id, prod.id]

    preview = _post(client, ui_request(envs, spec, dry_run=True))
    assert preview.status_code == 200, preview.text
    data = preview.json()
    # What the "Preview N runs" panel shows.
    assert data["ok"], data["errors"]
    assert data["combo_count"] == 4 and data["job_count"] == 8
    assert data["max_jobs"] == 64 and len(data["jobs"]) == 8
    assert [a["pointers"] for a in data["axes"]] == [[BIND], [THR]]
    assert [a["length"] for a in data["axes"]] == [2, 2]
    names = sorted(j["run_name"] for j in data["jobs"])
    assert "rag-vs-model · primary=qwen-72b thr=0.7 · prod" in names

    # One submit: the same body without dry_run.
    res = _post(client, ui_request(envs, spec, dry_run=False))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["job_count"] == 8 and len(body["jobs"]) == 8
    jobs = _jobs(session_factory, body["id"])
    assert {(j.combo_index, j.environment_id) for j in jobs} == {
        (c, e) for c in range(4) for e in envs
    }
    assert sorted(j["run_name"] for j in body["jobs"]) == names
    thresholds = {
        j.request_body["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] for j in jobs
    }
    assert thresholds == {0.5, 0.7}
    assert CONN_KEY not in json.dumps(body)


def test_linked_groups_from_the_ui_zip_into_one_axis(
    client, session_factory, env, conn, conn2  # noqa: F811
):
    prod = _add_env(session_factory, "prod")
    spec = _p4_spec(conn.id, conn2.id, links=[[BIND, TEMP]])
    # "+ values" on the main role's temperature cell, then "Link selected".
    spec["env_overrides"]["LLM_OVERRIDES"]["main"]["temperature"] = {
        "sweep": [0.2, 0.7]
    }
    data = _post(client, ui_request([env.id, prod.id], spec, dry_run=True)).json()
    assert data["ok"], data["errors"]
    assert data["combo_count"] == 4 and data["job_count"] == 8
    assert [a["linked"] for a in data["axes"]] == [True, False]
    labels = sorted({j["label"] for j in data["jobs"]})
    assert labels == [
        "primary=gpt-4o temp=0.2 thr=0.5",
        "primary=gpt-4o temp=0.2 thr=0.7",
        "primary=qwen-72b temp=0.7 thr=0.5",
        "primary=qwen-72b temp=0.7 thr=0.7",
    ]
    # Uneven linked groups are refused (the UI refuses to link them, too).
    spec["env_overrides"]["LLM_OVERRIDES"]["main"]["temperature"] = {
        "sweep": [0.2, 0.7, 0.9]
    }
    bad = _post(client, ui_request([env.id], spec, dry_run=True)).json()
    assert not bad["ok"]
    assert any(e["pointer"] == "/links/0" for e in bad["errors"])


def test_over_the_cap_the_preview_reports_it_and_submit_is_refused(
    client, session_factory, env, conn, conn2, monkeypatch  # noqa: F811
):
    monkeypatch.setenv("QYM_EVAL_SWEEP_MAX_JOBS", "4")
    prod = _add_env(session_factory, "prod")
    spec = _p4_spec(conn.id, conn2.id)
    envs = [env.id, prod.id]
    data = _post(client, ui_request(envs, spec, dry_run=True)).json()
    # overRunLimit(): job_count > max_jobs disables Launch.
    assert data["ok"] is False and data["jobs"] == []
    assert data["job_count"] == 8 and data["max_jobs"] == 4
    assert data["errors"][0]["rule"] == "sweep_cap"
    assert _post(client, ui_request(envs, spec, dry_run=False)).status_code == 422
    # One environment fits.
    assert _post(client, ui_request([env.id], spec, dry_run=False)).status_code == 200


def test_swept_temporary_model_and_evaluation_input(
    client, session_factory, env, conn  # noqa: F811
):
    # A temporary model added to a model sweep: only {"$secret": ref} in the spec,
    # the key in `secrets`; plus "+ values" on evaluation input `samples`.
    temporary = {
        "temporary": {
            "label": "trial",
            "model": "gpt-4o-mini",
            "base_url": "https://llm.example.com/v1",
            "api_key": {"$secret": "tmp-ref-1"},
        }
    }
    spec = ui_spec(
        {PRIMARY: {"sweep": [{"connection_id": conn.id}, temporary]}},
        {
            "/LLM_OVERRIDES/endpoints/primary/timeout": 60,
            "/LLM_OVERRIDES/main/endpoint": "primary",
        },
        config={"samples": {"sweep": [1, 2]}, "report_k": 1},
    )
    request = ui_request([env.id], spec, dry_run=True, secrets={"tmp-ref-1": TEMP_KEY})
    res = _post(client, request)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["ok"], data["errors"]
    assert data["combo_count"] == 4 and data["job_count"] == 4
    assert TEMP_KEY not in res.text
    launched = _post(client, {**request, "dry_run": False})
    assert launched.status_code == 200, launched.text
    assert TEMP_KEY not in launched.text
    jobs = _jobs(session_factory, launched.json()["id"])
    assert {j.request_body["evaluator"]["config"]["samples"] for j in jobs} == {1, 2}
    for job in jobs:
        assert TEMP_KEY not in json.dumps(job.request_body)
        assert TEMP_KEY not in json.dumps(job.params)


@pytest.mark.parametrize(
    "value,pointer",
    [
        ({"sweep": []}, THR),
        ({"sweep": [0.5, 0.5]}, THR + "/sweep/1"),
        ({"sweep": [0.5, {"x": 1}]}, THR + "/sweep/1"),
    ],
)
def test_invalid_sweeps_point_at_the_chip(
    client, env, conn, value, pointer  # noqa: F811
):
    # The editor refuses these locally; the service points at the same place.
    spec = ui_spec(
        {PRIMARY: {"connection_id": conn.id}},
        {"/LLM_OVERRIDES/endpoints/primary/timeout": 60, "/MILVUS_SEARCH_THRESHOLD": value},
    )
    data = _post(client, ui_request([env.id], spec, dry_run=True)).json()
    assert not data["ok"]
    assert data["errors"][0]["pointer"] == pointer
