from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from pydantic import ValidationError
from qym_platform.services.eval_config import (
    ConfigValidationError,
    EvaluatorRequestConfig,
    empty_config_document,
    evaluator_config_descriptor,
    find_placeholders,
    find_sweeps,
    is_placeholder,
    materialize_job_body,
    reserved_metadata_keys,
    slot_placeholder,
    validate_config_document,
)
from qym_platform.services.eval_model_slots import detect_model_slots
from qym_platform.services.eval_schema_form import build_form_descriptor

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"


@pytest.fixture(scope="module")
def schema():
    return json.loads(FIXTURE.read_text())


@pytest.fixture(scope="module")
def descriptor(schema):
    return build_form_descriptor(schema)


@pytest.fixture(scope="module")
def slots(descriptor):
    return [s.to_dict() for s in detect_model_slots(descriptor)]


def _doc(**overrides):
    doc = {
        "schema_hash": "h1",
        "evaluator": {
            "dataset": "playground_set_v2",
            "dataset_version": None,
            "config": {
                "samples": 3,
                "report_k": 1,
                "max_concurrency": 5,
                "run_metadata": {"team": "rag"},
            },
        },
        "slot_bindings": {"endpoint:primary": {"connection_id": "c-gpt4o"}},
        "env_overrides": {
            "TABLE_SELECTION_MODE": "rag",
            "MILVUS_SEARCH_THRESHOLD": 0.7,
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"timeout": 60, "max_attempts": 3}},
                "main": {"endpoint": "primary", "temperature": 0.2},
            },
        },
    }
    doc.update(overrides)
    return doc


def _validate(doc, schema, slots, **kwargs):
    return validate_config_document(doc, env_schema=schema, slots=slots, **kwargs)


def _by_rule(result, rule):
    return [e for e in result.errors if e["rule"] == rule]


# --------------------------------------------------------------------------- happy path


def test_valid_document_materializes_placeholders(schema, slots):
    result = _validate(_doc(), schema, slots, schema_hash="h1")
    assert result.ok, result.errors
    assert result.warnings == []
    body = result.body
    primary = body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert primary["model"] == slot_placeholder("endpoint:primary", "model")
    assert primary["api_key"] == slot_placeholder("endpoint:primary", "api_key")
    assert primary["timeout"] == 60
    # evaluator.model and config.model follow the primary slot (§7.4).
    assert body["evaluator"]["model"] == primary["model"]
    assert body["evaluator"]["config"]["model"] == primary["model"]
    # nulls stripped
    assert "dataset_version" not in body["evaluator"]
    assert json.loads(json.dumps(result.to_dict()))["ok"] is True
    assert sorted(find_placeholders(body)) == sorted(
        [
            "/env_overrides/LLM_OVERRIDES/endpoints/primary/model",
            "/env_overrides/LLM_OVERRIDES/endpoints/primary/base_url",
            "/env_overrides/LLM_OVERRIDES/endpoints/primary/api_key",
            "/evaluator/model",
            "/evaluator/config/model",
        ]
    )


def test_materialize_strips_nulls_and_empty_objects_but_keeps_run_metadata(slots):
    doc = _doc(
        slot_bindings={"endpoint:primary": {"inherit": True}},
        env_overrides={
            "MILVUS_SEARCH_THRESHOLD": None,
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"timeout": None}},
                "main": {"temperature": None},
            },
        },
    )
    doc["evaluator"]["config"]["run_metadata"] = {"note": None}
    body = materialize_job_body(doc, slots, user_id="u1", priority="HIGH")
    assert body["env_overrides"] == {}
    assert body["evaluator"]["config"]["run_metadata"] == {"note": None}
    assert "model" not in body["evaluator"]
    assert body["user_id"] == "u1" and body["priority"] == "HIGH"
    # The input document is never mutated.
    assert doc["env_overrides"]["LLM_OVERRIDES"]["main"] == {"temperature": None}


def test_materialize_temporary_and_custom_resolver(schema, descriptor, slots):
    doc = _doc(
        slot_bindings={
            "endpoint:primary": {"connection_id": "c1"},
            "flat:VIZ_LLM": {
                "temporary": {
                    "label": "trial",
                    "model": "gpt-4o-mini",
                    "api_key": {"$secret": "k1"},
                }
            },
            "endpoint:fast": None,
        }
    )
    body = materialize_job_body(doc, slots, descriptor=descriptor)
    assert body["env_overrides"]["VIZ_LLM_MODEL"] == "gpt-4o-mini"

    def resolver(slot_key, binding, role):
        return {"model": "gpt-4o", "base_url": None, "api_key": "sk-x"}[role]

    body = materialize_job_body(doc, slots, descriptor=descriptor, resolver=resolver)
    primary = body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert primary == {
        "timeout": 60,
        "max_attempts": 3,
        "model": "gpt-4o",
        "api_key": "sk-x",
    }
    assert body["evaluator"]["model"] == "gpt-4o"
    assert find_placeholders(body) == []


def test_extra_endpoint_slot_is_bound_without_a_slot_row(schema, slots):
    doc = _doc()
    doc["slot_bindings"]["endpoint:fast"] = {"connection_id": "c-mini"}
    doc["env_overrides"]["LLM_OVERRIDES"]["router"] = {"endpoint": "fast"}
    result = _validate(doc, schema, slots)
    assert result.ok, result.errors
    fast = result.body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["fast"]
    assert fast["model"] == slot_placeholder("endpoint:fast", "model")


# --------------------------------------------------------------------------- cross-field


def test_endpoints_must_contain_primary(schema, slots):
    doc = _doc(slot_bindings={"endpoint:fast": {"connection_id": "c-mini"}})
    doc["env_overrides"]["LLM_OVERRIDES"] = {
        "endpoints": {},
        "main": {"endpoint": "fast"},
    }
    result = _validate(doc, schema, slots)
    [error] = _by_rule(result, "required_keys")
    assert error["pointer"] == "/env_overrides/LLM_OVERRIDES/endpoints"
    assert error["form_pointer"] == "/env_overrides/LLM_OVERRIDES/endpoints"
    assert error["field"] == "/LLM_OVERRIDES/endpoints"
    assert "'primary'" in error["message"]
    assert result.body is None


def test_endpoints_must_not_be_empty(schema, slots):
    doc = _doc(slot_bindings={})
    doc["env_overrides"]["LLM_OVERRIDES"] = {"endpoints": {}, "main": {}}
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"] = {"primary": {}}
    # emptied objects are stripped, so LLM_OVERRIDES disappears: valid (inherit).
    assert _validate(doc, schema, slots).ok
    doc["env_overrides"]["LLM_OVERRIDES"] = {
        "endpoints": {},
        "main": {"temperature": 0.1},
    }
    result = _validate(doc, schema, slots)
    pointers = {e["pointer"] for e in result.errors}
    assert "/env_overrides/LLM_OVERRIDES/endpoints" in pointers
    assert {e["rule"] for e in result.errors} & {
        "required",
        "required_keys",
        "min_items",
    }


def test_min_items_rule_without_required_keys(schema, slots):
    descriptor = copy.deepcopy(build_form_descriptor(schema))
    descriptor["rules"] = [
        {"rule": "min_items", "pointer": "/LLM_OVERRIDES/endpoints", "min": 2}
    ]
    result = _validate(_doc(), schema, slots, descriptor=descriptor)
    [error] = _by_rule(result, "min_items")
    assert error["pointer"] == "/env_overrides/LLM_OVERRIDES/endpoints"


def test_role_endpoint_must_exist(schema, slots):
    doc = _doc()
    doc["env_overrides"]["LLM_OVERRIDES"]["router"] = {"endpoint": "fast"}
    result = _validate(doc, schema, slots)
    [error] = _by_rule(result, "endpoint_ref")
    assert error["pointer"] == "/env_overrides/LLM_OVERRIDES/router/endpoint"
    assert error["form_pointer"] == "/env_overrides/LLM_OVERRIDES/{role}/endpoint"
    assert error["field"] == "/LLM_OVERRIDES/{role}/endpoint"
    assert error["params"] == {"role": "router"}
    assert "'fast'" in error["message"]


def test_report_k_must_not_exceed_samples(schema, slots):
    doc = _doc()
    doc["evaluator"]["config"].update(samples=2, report_k=3)
    [error] = _by_rule(_validate(doc, schema, slots), "report_k")
    assert error["pointer"] == "/evaluator/config/report_k"
    assert error["form_pointer"] == "/evaluator/config/report_k"
    assert error["field"] == "/report_k"


def test_report_k_top_level_and_default_samples(schema, slots):
    doc = _doc()
    doc["evaluator"]["report_k"] = 4
    [error] = _by_rule(_validate(doc, schema, slots), "report_k")
    assert error["pointer"] == "/evaluator/report_k"

    doc = _doc()
    del doc["evaluator"]["config"]["samples"]
    doc["evaluator"]["config"]["report_k"] = 2  # samples defaults to 1
    assert _by_rule(_validate(doc, schema, slots), "report_k")

    doc["evaluator"]["config"]["report_k"] = 1
    assert _validate(doc, schema, slots).ok


def test_evaluator_config_forbids_unknown_keys(schema, slots):
    doc = _doc()
    doc["evaluator"]["config"]["output_dir"] = "/tmp"
    doc["evaluator"]["metrics"] = ["exact_match"]
    doc["evaluator"]["config_typo"] = 1
    result = _validate(doc, schema, slots)
    errors = {e["pointer"]: e for e in _by_rule(result, "unknown_key")}
    assert errors["/evaluator/config/output_dir"]["form_pointer"] == "/evaluator/config"
    assert errors["/evaluator/config/output_dir"]["field"] is None
    assert "/evaluator/metrics" in errors
    assert errors["/evaluator/config_typo"]["section"] == "evaluator"
    with pytest.raises(ValidationError):
        EvaluatorRequestConfig(output_dir="/tmp")


def test_evaluator_config_schema_errors_map_to_form_pointers(schema, slots):
    doc = _doc()
    doc["evaluator"]["config"].update(timeout=0, max_concurrency="many")
    result = _validate(doc, schema, slots)
    errors = {e["pointer"]: e for e in result.errors}
    assert errors["/evaluator/config/timeout"]["field"] == "/timeout"
    assert errors["/evaluator/config/max_concurrency"]["rule"] == "schema"


def test_dataset_required_unless_disabled(schema, slots):
    doc = _doc()
    doc["evaluator"]["dataset"] = None
    [error] = _by_rule(_validate(doc, schema, slots), "required")
    assert error["pointer"] == "/evaluator/dataset"
    assert _validate(doc, schema, slots, require_dataset=False).ok


# --------------------------------------------------------------------------- env schema


def test_env_schema_errors_map_to_form_pointers(schema, slots):
    doc = _doc()
    doc["env_overrides"].update(MILVUS_SEARCH_THRESHOLD=3, NOT_A_SETTING=1)
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]["timeout"] = -5
    doc["env_overrides"]["LLM_OVERRIDES"]["main"]["temperature"] = "hot"
    result = _validate(doc, schema, slots)
    errors = {e["pointer"]: e for e in result.errors}
    assert errors["/env_overrides/MILVUS_SEARCH_THRESHOLD"]["field"] == (
        "/MILVUS_SEARCH_THRESHOLD"
    )
    unknown = errors["/env_overrides/NOT_A_SETTING"]
    assert unknown["rule"] == "unknown_key" and unknown["form_pointer"] == (
        "/env_overrides"
    )
    timeout = errors["/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout"]
    assert timeout["field"] == "/LLM_OVERRIDES/endpoints/{endpoint}/timeout"
    assert timeout["params"] == {"endpoint": "primary"}
    temp = errors["/env_overrides/LLM_OVERRIDES/main/temperature"]
    assert temp["form_pointer"] == "/env_overrides/LLM_OVERRIDES/{role}/temperature"
    assert "number" in temp["message"]


def test_strings_are_not_booleans(schema, slots):
    doc = _doc()
    doc["env_overrides"]["BRIEF_ENABLED"] = "true"
    result = _validate(doc, schema, slots)
    assert [e["pointer"] for e in result.errors] == ["/env_overrides/BRIEF_ENABLED"]


def test_inherited_primary_with_transport_fields_needs_a_model(schema, slots):
    doc = _doc(slot_bindings={"endpoint:primary": {"inherit": True}})
    result = _validate(doc, schema, slots)
    [error] = _by_rule(result, "required")
    assert error["pointer"] == "/env_overrides/LLM_OVERRIDES/endpoints/primary/model"
    assert error["field"] == "/LLM_OVERRIDES/endpoints/{endpoint}/model"


def test_invalid_env_schema_is_reported(slots):
    result = validate_config_document(
        _doc(env_overrides={}, slot_bindings={}), env_schema={"type": 5}
    )
    assert any("schema is invalid" in e["message"] for e in result.errors)


def test_schema_hash_mismatch_is_a_warning(schema, slots):
    result = _validate(_doc(), schema, slots, schema_hash="h2")
    assert result.ok
    assert [w["rule"] for w in result.warnings] == ["schema_hash"]


# --------------------------------------------------------------------------- reserved


def test_qym_run_metadata_keys_are_rejected(schema, slots):
    doc = _doc()
    doc["evaluator"]["config"]["run_metadata"] = {
        "team": "rag",
        "qym_launch": {"token": "x"},
        "QYM_config": {},
    }
    assert reserved_metadata_keys(doc) == ["qym_launch", "QYM_config"]
    result = _validate(doc, schema, slots)
    errors = _by_rule(result, "reserved_key")
    assert [e["pointer"] for e in errors] == [
        "/evaluator/config/run_metadata/qym_launch",
        "/evaluator/config/run_metadata/QYM_config",
    ]
    assert {e["form_pointer"] for e in errors} == {"/evaluator/config/run_metadata"}
    assert {e["field"] for e in errors} == {"/run_metadata"}
    with pytest.raises(ConfigValidationError) as exc:
        result.raise_for_errors()
    assert "qym_launch" in str(exc.value)


_USER_PLACEHOLDER = "{{qym:slot:endpoint:primary:api_key}}"


@pytest.mark.parametrize(
    "path, pointer, section",
    [
        (
            ("env_overrides", "TABLE_SELECTION_MODE"),
            "/env_overrides/TABLE_SELECTION_MODE",
            "env_overrides",
        ),
        (
            ("env_overrides", "LLM_OVERRIDES", "main", "endpoint"),
            "/env_overrides/LLM_OVERRIDES/main/endpoint",
            "env_overrides",
        ),
        (
            ("evaluator", "config", "run_metadata", "team"),
            "/evaluator/config/run_metadata/team",
            "evaluator",
        ),
        (("evaluator", "dataset"), "/evaluator/dataset", "evaluator"),
    ],
)
def test_user_written_placeholders_are_rejected(schema, slots, path, pointer, section):
    doc = _doc()
    target = doc
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = "prefix " + _USER_PLACEHOLDER  # substring, not just full match
    result = _validate(doc, schema, slots)
    assert not result.ok and result.body is None
    errors = _by_rule(result, "reserved_placeholder")
    assert [e["pointer"] for e in errors] == [pointer]
    assert errors[0]["section"] == section
    assert "{{qym:" in errors[0]["message"]


def test_placeholder_in_temporary_model_and_keys_are_rejected(schema, slots):
    doc = _doc(
        slot_bindings={
            "endpoint:primary": {
                "temporary": {"model": "m", "base_url": "{{qym:slot:x:base_url}}"}
            }
        }
    )
    doc["evaluator"]["config"]["run_metadata"] = {"{{qym:anything}}": "v"}
    result = _validate(doc, schema, slots)
    pointers = sorted(e["pointer"] for e in _by_rule(result, "reserved_placeholder"))
    assert pointers == [
        "/evaluator/config/run_metadata/{{qym:anything}}",
        "/slot_bindings/endpoint:primary/temporary/base_url",
    ]
    assert result.body is None


def test_platform_placeholders_from_bindings_still_validate(schema, slots):
    result = _validate(_doc(), schema, slots)
    assert result.ok, result.errors
    assert find_placeholders(result.body)  # generated by the binding, not the user


def test_secret_literals_in_env_overrides_are_rejected(schema, slots):
    doc = _doc(slot_bindings={})
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"].update(
        model="gpt-4o", api_key="sk-live"
    )
    result = _validate(doc, schema, slots)
    [error] = _by_rule(result, "secret_literal")
    assert error["pointer"] == "/env_overrides/LLM_OVERRIDES/endpoints/primary/api_key"
    assert result.body is None
    assert "sk-live" not in json.dumps(result.to_dict())


# --------------------------------------------------------------------------- bindings


def test_binding_errors(schema, slots):
    doc = _doc(
        slot_bindings={
            "endpoint:primary": {"connection_id": ""},
            "flat:NOPE": {"connection_id": "c1"},
            "flat:VIZ_LLM": {"temporary": {"model": "m", "api_key": "sk-raw"}},
            "endpoint:fast": {"connection_id": "c1", "temporary": {}},
        }
    )
    result = _validate(doc, schema, slots)
    errors = _by_rule(result, "binding")
    by_slot = {}
    for error in errors:
        by_slot.setdefault(error["slot_key"], []).append(error["message"])
        assert error["pointer"] == "/slot_bindings/" + error["slot_key"]
    assert "non-empty" in by_slot["endpoint:primary"][0]
    assert "Unknown model slot" in by_slot["flat:NOPE"][0]
    assert "$secret" in by_slot["flat:VIZ_LLM"][0]
    assert "connection_id" in by_slot["endpoint:fast"][0]


def test_binding_conflicts_with_env_value(schema, slots):
    doc = _doc()
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]["model"] = "x"
    result = _validate(doc, schema, slots)
    [error] = _by_rule(result, "binding_conflict")
    assert error["pointer"] == "/env_overrides/LLM_OVERRIDES/endpoints/primary/model"
    assert error["section"] == "env_overrides"


def test_stale_slot_pointer_is_reported(schema, slots):
    stale = [
        {"slot_key": "flat:OLD", "field_map": {"model": "/OLD_MODEL"}},
        *slots,
    ]
    doc = _doc()
    doc["slot_bindings"]["flat:OLD"] = {"connection_id": "c1"}
    result = _validate(doc, schema, stale)
    assert any(
        e["slot_key"] == "flat:OLD" and "/OLD_MODEL" in e["message"]
        for e in _by_rule(result, "binding")
    )


def test_placeholders_skip_value_checks_but_real_values_map_to_binding(slots):
    schema = json.loads(FIXTURE.read_text())
    schema["properties"]["VIZ_LLM_MODEL"] = {"enum": ["qwen", "llama"]}
    doc = _doc()
    doc["slot_bindings"]["flat:VIZ_LLM"] = {"connection_id": "c-qwen"}
    assert _validate(doc, schema, slots).ok

    def resolver(slot_key, binding, role):
        return "gpt-4o" if role == "model" else None

    result = _validate(doc, schema, slots, resolver=resolver)
    [error] = result.errors
    assert error["section"] == "slot_bindings"
    assert error["pointer"] == "/slot_bindings/flat:VIZ_LLM"
    assert error["slot_key"] == "flat:VIZ_LLM"


def test_sweeps_are_rejected_for_a_single_combo(schema, slots):
    doc = _doc()
    doc["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    doc["slot_bindings"]["endpoint:primary"] = {"sweep": [{"connection_id": "a"}]}
    assert find_sweeps(doc) == [
        "/slot_bindings/endpoint:primary",
        "/env_overrides/MILVUS_SEARCH_THRESHOLD",
    ]
    result = _validate(doc, schema, slots)
    assert sorted(e["pointer"] for e in result.errors) == [
        "/env_overrides/MILVUS_SEARCH_THRESHOLD",
        "/slot_bindings/endpoint:primary",
    ]
    assert {e["rule"] for e in result.errors} == {"sweep"}


# --------------------------------------------------------------------------- document


def test_document_structure(schema, slots):
    result = _validate({"evaluator": [], "extra": 1, "schema_hash": 3}, schema, slots)
    pointers = {e["pointer"]: e["rule"] for e in result.errors}
    assert pointers["/extra"] == "unknown_key"
    assert pointers["/schema_hash"] == "type"
    assert pointers["/evaluator"] == "type"
    assert _validate([], schema, slots).errors[0]["rule"] == "type"


def test_empty_document_is_valid_without_dataset(schema, slots):
    doc = empty_config_document("h1")
    assert _validate(doc, schema, slots, require_dataset=False).ok
    assert not _validate(doc, schema, slots).ok


def test_evaluator_config_descriptor():
    descriptor = evaluator_config_descriptor()
    fields = descriptor["fields"]
    assert fields["/samples"]["default"] == 1
    assert fields["/samples"]["bounds"] == {"minimum": 1}
    for name in ("run_name", "live_mode", "model", "models", "model_full"):
        assert fields["/" + name]["read_only"] is True
    assert fields["/samples"]["read_only"] is False
    assert fields["/run_metadata"]["reserved_prefix"] == "qym_"
    assert fields["/live_mode"]["enum"] == ["local", "platform", "auto"]
    # Returned copies are independent.
    descriptor["fields"]["/samples"]["default"] = 99
    assert evaluator_config_descriptor()["fields"]["/samples"]["default"] == 1
    json.dumps(descriptor)


def test_is_placeholder():
    assert is_placeholder(slot_placeholder("endpoint:primary", "base_url"))
    assert not is_placeholder("gpt-4o")
    assert not is_placeholder(None)


def test_resolved_secret_values_never_appear_in_errors(slots):
    schema = json.loads(FIXTURE.read_text())
    schema["$defs"]["EndpointConfig"]["properties"]["api_key"] = {
        "anyOf": [{"type": "string", "maxLength": 3}, {"type": "null"}]
    }

    def resolver(slot_key, binding, role):
        return {"model": "gpt-4o", "api_key": "sk-very-secret"}.get(role)

    result = _validate(_doc(), schema, slots, resolver=resolver)
    [error] = result.errors
    assert error["slot_key"] == "endpoint:primary"
    assert "sk-very-secret" not in json.dumps(result.to_dict())


def test_non_string_role_endpoint_is_a_schema_error_only(schema, slots):
    doc = _doc()
    doc["env_overrides"]["LLM_OVERRIDES"]["main"]["endpoint"] = 7
    result = _validate(doc, schema, slots)
    assert [e["rule"] for e in result.errors] == ["schema"]
    assert result.errors[0]["params"] == {"role": "main"}
