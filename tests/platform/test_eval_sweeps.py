"""Sweep expansion (plan §8.1/§8.3, issue #32): grid, linked groups, cap, dry_run."""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.db.models import (
    EvalEnvironmentSchema,
    EvalExperiment,
    ProjectLlmConnection,
)
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services.eval_sweeps import (
    combo_label,
    expand,
    parse_sweeps,
    run_name,
)
from qym_platform.settings import PlatformSettings
from test_experiments_api import (  # noqa: F401  (fixtures)
    CONN_KEY,
    FIXTURE,
    MEMBER,
    PRIMARY,
    _add_env,
    _create,
    _created,
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

THR = "/env_overrides/MILVUS_SEARCH_THRESHOLD"
MODE = "/env_overrides/TABLE_SELECTION_MODE"
TEMP = "/env_overrides/LLM_OVERRIDES/main/temperature"
BIND = "/slot_bindings/endpoint:primary"
SECRET_REF = "k-secret-ref-123"


def _doc(**env_overrides) -> dict:
    return {
        "evaluator": {"dataset": "d", "config": {"samples": 2}},
        "slot_bindings": {},
        "env_overrides": env_overrides,
    }


# --------------------------------------------------------------------------- units


def test_default_cap_is_64(monkeypatch):
    monkeypatch.delenv("QYM_EVAL_SWEEP_MAX_JOBS", raising=False)
    assert PlatformSettings().eval_sweep_max_jobs == 64
    monkeypatch.setenv("QYM_EVAL_SWEEP_MAX_JOBS", "8")
    assert PlatformSettings().eval_sweep_max_jobs == 8


def test_no_sweeps_is_one_combination_without_links():
    spec = _doc(MILVUS_SEARCH_THRESHOLD=0.7)
    plan = expand(spec, environment_count=2, max_jobs=64)
    assert plan.ok and not plan.swept
    assert (plan.combo_count, plan.job_count) == (1, 2)
    (combo,) = plan.combos
    assert combo.index == 0 and combo.label == "" and combo.params == {}
    assert combo.document == spec


def test_grid_is_cartesian_last_axis_fastest_and_deterministic():
    spec = _doc(
        MILVUS_SEARCH_THRESHOLD={"sweep": [0.5, 0.7]},
        TABLE_SELECTION_MODE={"sweep": ["rag", "llm_direct", "pure_llm"]},
    )
    plan = expand(spec, environment_count=2, max_jobs=64)
    assert plan.ok
    assert (plan.combo_count, plan.job_count) == (6, 12)
    assert [a.pointers for a in plan.axes] == [(THR,), (MODE,)]
    values = [(c.values[THR], c.values[MODE]) for c in plan.combos]
    assert values == [
        (0.5, "rag"),
        (0.5, "llm_direct"),
        (0.5, "pure_llm"),
        (0.7, "rag"),
        (0.7, "llm_direct"),
        (0.7, "pure_llm"),
    ]
    assert [c.index for c in plan.combos] == list(range(6))
    first = plan.combos[0].document["env_overrides"]
    assert first == {"MILVUS_SEARCH_THRESHOLD": 0.5, "TABLE_SELECTION_MODE": "rag"}
    assert plan.combos[4].label == "thr=0.7 mode=llm_direct"
    # The spec is untouched and a second expansion is identical.
    assert spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == {"sweep": [0.5, 0.7]}
    again = expand(copy.deepcopy(spec), environment_count=2, max_jobs=64)
    assert [c.document for c in again.combos] == [c.document for c in plan.combos]


def test_linked_group_zips_into_one_axis():
    spec = _doc(
        MILVUS_SEARCH_THRESHOLD={"sweep": [0.5, 0.7, 0.9]},
        LLM_OVERRIDES={"main": {"temperature": {"sweep": [0.2, 0.7]}}},
    )
    spec["slot_bindings"] = {
        "endpoint:primary": {
            "sweep": [{"connection_id": "c-a"}, {"connection_id": "c-b"}]
        }
    }
    spec["links"] = [[BIND, TEMP]]
    plan = expand(
        spec,
        environment_count=1,
        max_jobs=64,
        connection_labels={"c-a": "gpt-4o", "c-b": "qwen"},
    )
    assert plan.ok, plan.errors
    assert plan.combo_count == 6  # 2 (linked) x 3
    assert plan.axes[0].pointers == (BIND, TEMP) and plan.axes[0].linked
    pairs = {(c.values[BIND]["connection_id"], c.values[TEMP]) for c in plan.combos}
    assert pairs == {("c-a", 0.2), ("c-b", 0.7)}
    assert plan.combos[0].label == "primary=gpt-4o temp=0.2 thr=0.5"
    assert "links" not in plan.combos[0].document
    assert plan.combos[0].document["slot_bindings"] == {
        "endpoint:primary": {"connection_id": "c-a"}
    }


@pytest.mark.parametrize(
    "links, rule, pointer",
    [
        ([[THR, TEMP]], "link", "/links/0"),  # unequal lengths
        ([[THR]], "link", "/links/0"),  # single member
        ([[THR, "/env_overrides/NOPE"]], "link", "/links/0/1"),  # not swept
        ([[THR, MODE], [MODE, TEMP]], "link", "/links/1/0"),  # linked twice
        ("nope", "type", "/links"),
    ],
)
def test_bad_links_are_pointed(links, rule, pointer):
    spec = _doc(
        MILVUS_SEARCH_THRESHOLD={"sweep": [0.5, 0.7]},
        TABLE_SELECTION_MODE={"sweep": ["rag", "pure_llm"]},
        LLM_OVERRIDES={"main": {"temperature": {"sweep": [0.1, 0.2, 0.3]}}},
    )
    spec["links"] = links
    plan = expand(spec, environment_count=1, max_jobs=64)
    assert not plan.ok and not plan.combos
    assert any(e["rule"] == rule and e["pointer"] == pointer for e in plan.errors)


@pytest.mark.parametrize(
    "value, pointer",
    [
        ({"sweep": []}, THR),
        ({"sweep": 0.5}, THR),
        ({"sweep": [0.5, {"x": 1}]}, THR + "/sweep/1"),
        ({"sweep": [0.5, 0.5]}, THR + "/sweep/1"),
    ],
)
def test_bad_sweep_values_are_pointed_and_not_echoed(value, pointer):
    axes, errors = parse_sweeps(_doc(MILVUS_SEARCH_THRESHOLD=value))
    assert axes == [] and errors
    assert errors[0]["pointer"] == pointer and errors[0]["rule"] == "sweep"
    assert "0.5" not in json.dumps(errors)


def test_binding_sweeps_must_be_whole_bindings():
    spec = _doc()
    spec["slot_bindings"] = {"endpoint:primary": {"connection_id": {"sweep": ["a"]}}}
    _, errors = parse_sweeps(spec)
    assert errors[0]["pointer"] == BIND + "/connection_id"
    assert errors[0]["slot_key"] == "endpoint:primary"
    spec["slot_bindings"] = {"endpoint:primary": {"sweep": [{"model": "x"}]}}
    _, errors = parse_sweeps(spec)
    assert errors[0]["pointer"] == BIND + "/sweep/0"


def test_cap_counts_environments_and_builds_nothing():
    spec = _doc(
        MILVUS_SEARCH_THRESHOLD={"sweep": [i / 10 for i in range(10)]},
        TABLE_SELECTION_MODE={"sweep": ["rag", "llm_direct", "pure_llm"]},
    )
    assert expand(spec, environment_count=2, max_jobs=60).ok
    plan = expand(spec, environment_count=3, max_jobs=64)
    assert not plan.ok and plan.combos == []
    assert plan.job_count == 90 and plan.combo_count == 30
    assert plan.errors[0]["rule"] == "sweep_cap"
    assert "90" in plan.errors[0]["message"] and "64" in plan.errors[0]["message"]


def test_labels_and_run_names_are_short_unique_and_secret_free():
    temporary = {
        "temporary": {
            "label": "trial",
            "model": "gpt-4o-mini",
            "api_key": {"$secret": SECRET_REF},
        }
    }
    values = {
        BIND: temporary,
        "/env_overrides/LLM_OVERRIDES/main/temperature": 0.2,
        "/env_overrides/LLM_OVERRIDES/router/temperature": 0.7,
        "/env_overrides/BRIEF_ENABLED": True,
        "/env_overrides/VIZ_LLM_MODEL": None,
    }
    label = combo_label(values)
    assert label == (
        "primary=gpt-4o-mini main.temperature=0.2 router.temperature=0.7 "
        "enabled=true model=inherit"
    )
    assert SECRET_REF not in label
    assert run_name("rag-vs-model", "primary=gpt-4o thr=0.7") == (
        "rag-vs-model · primary=gpt-4o thr=0.7"
    )
    assert run_name("x", "", "prod") == "x · prod"
    assert len(run_name("n" * 150, "l" * 150, "env")) == 200


def test_params_drop_secret_refs():
    spec = _doc()
    spec["slot_bindings"] = {
        "endpoint:primary": {
            "sweep": [
                {"connection_id": "c-a"},
                {"temporary": {"model": "m", "api_key": {"$secret": SECRET_REF}}},
            ]
        }
    }
    plan = expand(spec, environment_count=1, max_jobs=64)
    assert plan.ok
    dumped = json.dumps([c.params for c in plan.combos] + [plan.summary()])
    assert SECRET_REF not in dumped and "$secret" not in dumped


# --------------------------------------------------------------------------- API


@pytest.fixture()
def conn2(session_factory) -> ProjectLlmConnection:
    with session_factory() as s:
        row = ProjectLlmConnection(
            project_id="project-1",
            name="Qwen",
            llm_model="qwen-72b",
            llm_base_url="https://qwen.example.com/v1",
            llm_api_key_encrypted=encrypt_llm_api_key(CONN_KEY),
            llm_api_key_last4=CONN_KEY[-4:],
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        s.expunge(row)
        return row


def _swept_spec(conn_a: str, conn_b: str) -> dict:
    spec = _spec(conn_a)
    spec["slot_bindings"][PRIMARY] = {
        "sweep": [{"connection_id": conn_a}, {"connection_id": conn_b}]
    }
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    return spec


def test_two_models_by_two_thresholds_by_two_envs_is_eight_jobs(
    client, session_factory, env, conn, conn2
):
    prod = _add_env(session_factory, "prod")
    body = _created(client, [env.id, prod.id], spec=_swept_spec(conn.id, conn2.id))
    assert body["job_count"] == 8 and len(body["jobs"]) == 8
    jobs = _jobs(session_factory, body["id"])
    keys = {(j.combo_index, j.environment_id) for j in jobs}
    assert keys == {(c, e) for c in range(4) for e in (env.id, prod.id)}

    by_key = {(j.combo_index, j.environment_id): j for j in jobs}
    job = by_key[(3, prod.id)]
    config = job.request_body["evaluator"]["config"]
    assert config["run_name"] == "rag-vs-model · primary=qwen-72b thr=0.7 · prod"
    assert config["run_metadata"]["qym_launch"]["combo_index"] == 3
    qym_config = config["run_metadata"]["qym_config"]
    assert qym_config["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert qym_config["slot_bindings"][PRIMARY]["connection_id"] == conn2.id
    assert "links" not in qym_config
    assert job.request_body["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert job.params["slot_bindings"][PRIMARY] == {
        "connection_id": conn2.id,
        "name": "Qwen",
        "model": "qwen-72b",
    }
    assert job.params["sweep"]["/env_overrides/MILVUS_SEARCH_THRESHOLD"] == 0.7

    # Stored spec keeps the sweep, with names next to each connection id.
    swept = body["spec"]["slot_bindings"][PRIMARY]["sweep"]
    assert [b["name"] for b in swept] == ["GPT-4o prod", "Qwen"]
    for text in (json.dumps(body), json.dumps([j.request_body for j in jobs])):
        assert CONN_KEY not in text


def test_linked_launch_and_dry_run_preview(client, session_factory, env, conn, conn2):
    spec = _swept_spec(conn.id, conn2.id)
    spec["env_overrides"]["LLM_OVERRIDES"]["main"]["temperature"] = {
        "sweep": [0.2, 0.7]
    }
    spec["links"] = [["/slot_bindings/endpoint:primary", TEMP]]
    res = _create(client, [env.id], spec=spec, dry_run=True)
    assert res.status_code == 200, res.text
    preview = res.json()
    assert preview["ok"] and preview["job_count"] == 4 and preview["combo_count"] == 4
    assert preview["max_jobs"] == 64
    assert [a["linked"] for a in preview["axes"]] == [True, False]
    names = [j["run_name"] for j in preview["jobs"]]
    assert names == [
        "rag-vs-model · primary=gpt-4o temp=0.2 thr=0.5",
        "rag-vs-model · primary=gpt-4o temp=0.2 thr=0.7",
        "rag-vs-model · primary=qwen-72b temp=0.7 thr=0.5",
        "rag-vs-model · primary=qwen-72b temp=0.7 thr=0.7",
    ]
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0

    body = _created(client, [env.id], spec=spec)
    assert sorted(j["run_name"] for j in body["jobs"]) == sorted(names)
    assert body["spec"]["links"] == spec["links"]


def test_cap_is_enforced_before_creating_anything(
    client, session_factory, env, monkeypatch
):
    monkeypatch.setenv("QYM_EVAL_SWEEP_MAX_JOBS", "3")
    spec = _spec()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.1, 0.2]}
    other = _add_env(session_factory, "prod")
    res = _create(client, [env.id, other.id], spec=spec)
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["job_count"] == 4 and detail["max_jobs"] == 3
    assert detail["errors"][0]["rule"] == "sweep_cap"

    preview = _create(client, [env.id, other.id], spec=spec, dry_run=True).json()
    assert preview["ok"] is False and preview["job_count"] == 4
    assert preview["jobs"] == []
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0
    assert _create(client, [env.id], spec=spec).status_code == 200


def test_per_environment_validation_maps_errors_to_combo_and_pointer(
    client, session_factory, env
):
    strict = _add_env(session_factory, "strict")
    with session_factory() as s:
        schema = s.get(EvalEnvironmentSchema, strict.current_schema_id)
        schema_json = json.loads(FIXTURE.read_text())
        schema_json["properties"]["MILVUS_SEARCH_THRESHOLD"]["anyOf"][0][
            "maximum"
        ] = 0.6
        schema.schema_json = schema_json
        s.commit()

    spec = _spec()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    preview = _create(client, [env.id, strict.id], spec=spec, dry_run=True).json()
    assert preview["ok"] is False and preview["job_count"] == 4
    bad = [
        (j["combo_index"], j["environment_id"]) for j in preview["jobs"] if j["errors"]
    ]
    assert bad == [(1, strict.id)]
    (error,) = preview["errors"]
    assert error["pointer"] == THR
    assert (error["combo_index"], error["environment_id"]) == (1, strict.id)

    res = _create(client, [env.id, strict.id], spec=spec)
    assert res.status_code == 422
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0


def test_secrets_never_reach_params_qym_config_or_responses(
    client, session_factory, env, conn
):
    # Temporary models stay rejected until #12, even inside a sweep, and the key
    # ref is never echoed back.
    spec = _spec(conn.id)
    spec["slot_bindings"][PRIMARY] = {
        "sweep": [
            {"connection_id": conn.id},
            {
                "temporary": {
                    "label": "trial",
                    "model": "gpt-4o-mini",
                    "base_url": "https://llm.example.com/v1",
                    "api_key": {"$secret": SECRET_REF},
                }
            },
        ]
    }
    for dry_run in (True, False):
        res = _create(client, [env.id], spec=spec, dry_run=dry_run)
        text = res.text
        assert SECRET_REF not in text and CONN_KEY not in text
        codes = {
            e.get("code")
            for e in (res.json().get("errors") or res.json()["detail"]["errors"])
        }
        assert "temporary_unsupported" in codes

    # A connection sweep: nothing secret in stored params, qym_config or responses.
    spec["slot_bindings"][PRIMARY]["sweep"].pop()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    body = _created(client, [env.id], spec=spec)
    detail = client.get(_url(suffix=f"/{body['id']}"), headers=_headers(MEMBER)).text
    stored = json.dumps(
        [(j.params, j.request_body) for j in _jobs(session_factory, body["id"])]
    )
    for text in (json.dumps(body), detail, stored):
        assert CONN_KEY not in text and "$secret" not in text
