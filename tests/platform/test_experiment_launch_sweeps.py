"""Sweep UI of the launch form (plan §8.3, §12.2, §8.1; issue #34).

API round trips with the spec the sweeps UI builds (the UI itself is covered by
frontend/e2e/experiments/launch/sweeps.spec.ts and launch/model/sweeps.test.ts).
``ui_spec()`` mirrors ``buildSpec()``: swept
values are stored as ``{"sweep": [...]}`` in ``st.values`` (flattened pointers,
nested by ``buildOverrides``), a model sweep is ``st.bindings[slot] = {kind: 'raw',
value: {sweep: [binding, ...]}}``, and "Link selected" writes ``st.links``. The P4
exit criterion: 2 models × 2 thresholds × 2 environments = 8 runs from one submit.
"""

from __future__ import annotations

import json
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
        {
            "/LLM_OVERRIDES/endpoints/primary/timeout": 60,
            "/MILVUS_SEARCH_THRESHOLD": value,
        },
    )
    data = _post(client, ui_request([env.id], spec, dry_run=True)).json()
    assert not data["ok"]
    assert data["errors"][0]["pointer"] == pointer
