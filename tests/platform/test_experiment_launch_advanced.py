"""Advanced panel of the launch form (plan §8.4, issue #24).

The static ``EvaluatorRequestConfig`` descriptor and its endpoint (D5), server-side rejection of
``qym_*`` run_metadata keys and platform-owned fields, and a JSON <-> spec round trip
at the API level: the document the Raw JSON tab shows is exactly what is launched, and
the stored ``qym_config`` loads back as the same document.
"""

from __future__ import annotations

import copy
import json

import pytest
from qym_platform.services.eval_config import (
    EVALUATOR_INPUT_FIELDS,
    PLATFORM_METADATA_KEYS,
    PLATFORM_OWNED_CONFIG_FIELDS,
    evaluator_config_descriptor,
    evaluator_inputs_panel,
    platform_owned_pointers,
    validate_config_document,
)
from qym_platform.services.eval_schema_form import build_form_descriptor

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    CONN_KEY,
    FIXTURE,
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

TEMP_KEY = "sk-advanced-temporary-KEY-4242"
PANEL_URL = f"/v1/projects/{P1}/experiments/evaluator-config"


def _document(conn_id: str) -> dict:
    """What the Raw JSON tab shows for a form using every Advanced feature."""
    return {
        "evaluator": {
            "dataset": "playground_set_v2",
            "config": {
                "samples": 3,
                "report_k": 2,
                "max_concurrency": 4,
                "timeout": 120.5,
                "task_name": "sql-agent",
                "git_branch": "main",
                "force_model_override": True,
                "run_metadata": {"team": "rag", "ticket": 42, "flags": {"a": [1]}},
            },
        },
        "slot_bindings": {PRIMARY: {"connection_id": conn_id}},
        "env_overrides": {
            "MILVUS_SEARCH_THRESHOLD": 0.7,
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"timeout": 60}},
                "main": {"endpoint": "primary", "temperature": 0.2, "seed": 7},
                "router": {
                    "max_tokens": 512,
                    "reasoning_enabled": False,
                    "response_format": {"type": "json_object"},
                },
            },
        },
    }


def _request(env_id: str, spec: dict, **extra) -> dict:
    return {
        "name": "advanced round trip",
        "environment_ids": [env_id],
        "spec": spec,
        "base_source": {"kind": "blank"},
        "dry_run": False,
        "secrets": {},
        "save_to_project_models": [],
        **extra,
    }


# --------------------------------------------------------------------------- descriptor


def test_panel_descriptor_covers_every_evaluator_config_field():
    panel = evaluator_inputs_panel()
    fields = panel["descriptor"]["fields"]
    names = {entry["name"] for entry in fields.values()}
    editable = set(panel["fields"])
    owned = set(panel["platform_owned"]["config"])
    assert editable == set(EVALUATOR_INPUT_FIELDS)
    assert owned == set(PLATFORM_OWNED_CONFIG_FIELDS)
    # Every field of the static model is either editable, platform-owned or metadata.
    # versioning_details is platform-owned but only in v1.1 schemas (not the mirror).
    assert editable | (owned & names) | {"run_metadata"} == names
    assert owned - names == {"versioning_details"}
    assert panel["source"] == "static" and panel["environments"] == []
    assert not editable & owned
    for name in editable:
        assert fields["/" + name]["read_only"] is False, name
    for name in owned & names:
        assert fields["/" + name]["read_only"] is True, name
    assert panel["reserved_metadata_prefix"] == "qym_"
    assert panel["platform_metadata_keys"] == list(PLATFORM_METADATA_KEYS)
    assert panel["platform_owned"]["evaluator"] == ["model"]
    assert panel["descriptor"] == evaluator_config_descriptor()
    json.dumps(panel)


def test_panel_endpoint(client):
    res = client.get(PANEL_URL, headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    assert res.json() == evaluator_inputs_panel()
    assert client.get(PANEL_URL, headers=_headers(OUTSIDER)).status_code == 403
    # The static path is not captured by /{experiment_id}.
    assert "fields" in res.json() and "jobs" not in res.json()


# --------------------------------------------------------------------------- server rules


@pytest.fixture(scope="module")
def schema():
    return json.loads(FIXTURE.read_text())


def _valid(doc, schema):
    return validate_config_document(doc, env_schema=schema, schema_hash=None)


@pytest.mark.parametrize(
    "path,value",
    [
        (("config", "run_name"), "mine"),
        (("config", "live_mode"), "local"),
        (("config", "model"), "gpt-4o"),
        (("config", "models"), ["a", "b"]),
        (("config", "model_full"), "openai/gpt-4o"),
        (("model",), "gpt-4o"),
    ],
)
def test_platform_owned_fields_are_rejected(schema, path, value):
    doc = _document("c1")
    doc["slot_bindings"] = {}
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]["model"] = "gpt-4o"
    target = doc["evaluator"]
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    pointer = "/evaluator/" + "/".join(path)
    assert platform_owned_pointers(doc) == [pointer]
    result = _valid(doc, schema)
    errors = [e for e in result.errors if e["rule"] == "platform_owned"]
    assert [e["pointer"] for e in errors] == [pointer]
    assert errors[0]["section"] == "evaluator"
    assert errors[0]["form_pointer"] == pointer
    assert result.body is None


def test_unset_platform_owned_fields_and_user_metadata_are_fine(schema):
    doc = _document("c1")
    doc["slot_bindings"] = {}
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]["model"] = "gpt-4o"
    doc["evaluator"]["model"] = None
    doc["evaluator"]["config"].update({"run_name": None, "live_mode": None})
    assert platform_owned_pointers(doc) == []
    result = _valid(doc, schema)
    assert result.ok, result.errors
    config = result.body["evaluator"]["config"]
    assert "run_name" not in config and "live_mode" not in config
    assert config["run_metadata"] == {"team": "rag", "ticket": 42, "flags": {"a": [1]}}


@pytest.mark.parametrize("key", ["qym_launch", "qym_config", "QYM_custom", "qym_"])
def test_reserved_metadata_keys_are_rejected(schema, key):
    doc = _document("c1")
    doc["slot_bindings"] = {}
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]["model"] = "gpt-4o"
    doc["evaluator"]["config"]["run_metadata"][key] = {"forged": True}
    result = _valid(doc, schema)
    errors = [e for e in result.errors if e["rule"] == "reserved_key"]
    assert [e["pointer"] for e in errors] == ["/evaluator/config/run_metadata/" + key]


def test_api_rejects_platform_owned_and_reserved_keys(
    client, session_factory, env, conn
):
    spec = _document(conn.id)
    spec["evaluator"]["config"]["run_name"] = "forged"
    spec["evaluator"]["config"]["live_mode"] = "local"
    spec["evaluator"]["config"]["run_metadata"]["qym_launch"] = {"token": "forged"}
    res = client.post(
        _url(), headers=_headers(MEMBER), json=_request(env.id, spec, dry_run=True)
    )
    assert res.status_code == 200, res.text
    errors = res.json()["errors"]
    by_rule = {(e["rule"], e["pointer"]) for e in errors}
    assert ("platform_owned", "/evaluator/config/run_name") in by_rule
    assert ("platform_owned", "/evaluator/config/live_mode") in by_rule
    assert ("reserved_key", "/evaluator/config/run_metadata/qym_launch") in by_rule
    launch = client.post(_url(), headers=_headers(MEMBER), json=_request(env.id, spec))
    assert launch.status_code == 422


# --------------------------------------------------------------------------- round trip


def test_json_document_round_trips_through_the_api(client, session_factory, env, conn):
    document = _document(conn.id)
    # The Raw JSON tab's document is the launch spec, as is.
    preview = client.post(
        _url(), headers=_headers(MEMBER), json=_request(env.id, document, dry_run=True)
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["errors"] == []
    res = client.post(_url(), headers=_headers(MEMBER), json=_request(env.id, document))
    assert res.status_code == 200, res.text
    (job,) = _jobs(session_factory, res.json()["id"])
    body = job.request_body
    config = body["evaluator"]["config"]

    # Evaluation inputs arrive as typed; the platform fills what it owns.
    for name, value in document["evaluator"]["config"].items():
        if name != "run_metadata":
            assert config[name] == value, name
    assert config["run_name"] == "advanced round trip"
    assert config["live_mode"] == "platform"
    metadata = config["run_metadata"]
    assert {k: metadata[k] for k in ("team", "ticket", "flags")} == {
        "team": "rag",
        "ticket": 42,
        "flags": {"a": [1]},
    }
    assert set(metadata) - {"team", "ticket", "flags"} == set(PLATFORM_METADATA_KEYS)
    # Role overrides land on their roles; unset cells stay unset.
    roles = body["env_overrides"]["LLM_OVERRIDES"]
    assert roles["main"] == {"endpoint": "primary", "temperature": 0.2, "seed": 7}
    assert roles["router"] == document["env_overrides"]["LLM_OVERRIDES"]["router"]

    # JSON <- spec: the stored snapshot loads back as the same document.
    snapshot = metadata["qym_config"]
    assert snapshot["evaluator"] == document["evaluator"]
    assert snapshot["env_overrides"] == document["env_overrides"]
    assert snapshot["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    reloaded = {
        "evaluator": snapshot["evaluator"],
        "slot_bindings": {PRIMARY: {"connection_id": conn.id}},
        "env_overrides": snapshot["env_overrides"],
    }
    again = client.post(
        _url(), headers=_headers(MEMBER), json=_request(env.id, reloaded, dry_run=True)
    )
    assert again.status_code == 200 and again.json()["errors"] == []
    first = copy.deepcopy(preview.json()["jobs"][0]["request_body"])
    second = copy.deepcopy(again.json()["jobs"][0]["request_body"])
    assert first == second
    assert CONN_KEY not in json.dumps(body)


def test_temporary_keys_only_appear_as_refs(client, session_factory, env):
    document = _document("unused")
    del document["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    document["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"] = {"timeout": 60}
    document["slot_bindings"] = {
        PRIMARY: {
            "temporary": {
                "label": "trial",
                "model": "gpt-4o-mini",
                "base_url": "https://llm.example.com/v1",
                "api_key": {"$secret": "k1"},
            }
        }
    }
    request = _request(env.id, document, secrets={"k1": TEMP_KEY})
    preview = client.post(
        _url(), headers=_headers(MEMBER), json={**request, "dry_run": True}
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["errors"] == []
    assert TEMP_KEY not in preview.text
    res = client.post(_url(), headers=_headers(MEMBER), json=request)
    assert res.status_code == 200, res.text
    assert TEMP_KEY not in res.text
    (job,) = _jobs(session_factory, res.json()["id"])
    assert TEMP_KEY not in json.dumps(job.request_body)
    assert TEMP_KEY not in json.dumps(job.params)
    # A literal key in the document (what the JSON tab refuses) is refused here too.
    literal = copy.deepcopy(document)
    literal["slot_bindings"][PRIMARY]["temporary"]["api_key"] = TEMP_KEY
    bad = client.post(
        _url(), headers=_headers(MEMBER), json=_request(env.id, literal, dry_run=True)
    )
    assert TEMP_KEY not in bad.text
    assert bad.status_code == 422 or bad.json()["errors"]


def test_role_rows_come_from_the_schema():
    descriptor = build_form_descriptor(json.loads(FIXTURE.read_text()))
    table = descriptor["fields"]["/LLM_OVERRIDES/{role}"]
    assert table["kind"] == "role_table"
    rows = [row["key"] for row in table["rows"]]
    assert rows[:3] == ["main", "router", "brief"]
    columns = [c.rsplit("/", 1)[-1] for c in table["columns"]]
    for column in (
        "endpoint",
        "temperature",
        "max_tokens",
        "top_p",
        "seed",
        "reasoning_enabled",
        "reasoning_effort",
        "response_format",
    ):
        assert column in columns, column
    endpoint = descriptor["fields"]["/LLM_OVERRIDES/{role}/endpoint"]
    assert endpoint["widget"] == "endpoint-ref"
