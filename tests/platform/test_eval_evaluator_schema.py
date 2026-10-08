"""The ``evaluator`` schema of an environment (guide v1.1 §3.4, decision B22).

Pure parts: extracting ``evaluator.config`` from ``GET /evals/evaluator/schema``,
its form descriptor (any value, B20), the Evaluation inputs panel (one or several
environments, static fallback) and validation against it.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from qym_platform.services.eval_config import (
    EVALUATOR_INPUT_FIELDS,
    PLATFORM_OWNED_CONFIG_FIELDS,
    EvaluatorPanelSource,
    environment_evaluator_descriptor,
    evaluator_inputs_panel,
    validate_config_document,
)
from qym_platform.services.eval_evaluator_schema import (
    accepts_config_key,
    config_keys,
    config_schema,
    evaluator_schema_diff,
    input_fields,
    schema_hash,
)

FIXTURES = Path(__file__).parent / "fixtures"
ENV_SCHEMA = json.loads((FIXTURES / "eval_env_overrides_schema.json").read_text())


@pytest.fixture()
def schema() -> dict:
    return json.loads((FIXTURES / "eval_evaluator_schema.json").read_text())


def _config_props(schema: dict) -> dict:
    return schema["$defs"]["EvaluatorRequestConfig"]["properties"]


def _doc(**config) -> dict:
    return {
        "evaluator": {"dataset": "playground", "config": dict(config)},
        "env_overrides": {},
    }


def _validate(doc, **kwargs):
    return validate_config_document(doc, env_schema=ENV_SCHEMA, **kwargs)


# --------------------------------------------------------------------------- extract


def test_config_schema_follows_the_nullable_ref(schema):
    config = config_schema(schema)
    assert config["additionalProperties"] is False
    assert "metric_concurrency" in config["properties"]
    assert "EvaluatorRequestConfig" in config["$defs"]  # nested refs still resolve
    assert config_keys(schema)[:3] == ["run_name", "task_name", "max_concurrency"]
    assert accepts_config_key(schema, "versioning_details")
    assert not accepts_config_key(None, "versioning_details")


def test_config_schema_falls_back_to_defs_or_inline_or_empty(schema):
    no_prop = copy.deepcopy(schema)
    no_prop["properties"].pop("config")
    assert "samples" in config_schema(no_prop)["properties"]
    inline = {"properties": {"config": {"type": "object", "properties": {"x": {}}}}}
    assert list(config_schema(inline)["properties"]) == ["x"]
    assert config_schema({"type": "object"})["properties"] == {}
    assert config_keys({}) == []


def test_schema_hash_is_canonical(schema):
    reordered = json.loads(json.dumps(schema, sort_keys=True))
    assert schema_hash(schema) == schema_hash(reordered)
    changed = copy.deepcopy(schema)
    _config_props(changed).pop("metric_concurrency")
    assert schema_hash(changed) != schema_hash(schema)


# --------------------------------------------------------------------------- descriptor


def test_descriptor_marks_platform_fields_and_handles_any_value(schema):
    props = _config_props(schema)
    # A union no single widget can show, and an open object with extra keys (B20).
    props["judge"] = {"anyOf": [{"type": "string"}, {"type": "integer"}]}
    props["labels"] = {
        "type": "object",
        "properties": {"team": {"type": "string"}},
        "additionalProperties": {"type": "string"},
    }
    fields = environment_evaluator_descriptor(schema)["fields"]
    assert fields["/metric_concurrency"]["type"] == "integer"
    assert fields["/metric_concurrency"]["nullable"] is True
    assert fields["/metric_concurrency"]["bounds"] == {"minimum": 1}
    assert fields["/live_mode"]["type"] == "enum" and fields["/live_mode"]["read_only"]
    assert fields["/versioning_details"]["read_only"] is True
    assert fields["/run_metadata"]["reserved_prefix"] == "qym_"
    assert fields["/judge"]["type"] == "json"
    assert sorted(fields["/judge"]["accepts"]) == ["integer", "string"]
    assert fields["/labels"]["additional_pointer"] == "/labels/{key}"
    assert fields["/labels/team"]["read_only"] is False


def test_input_fields_keep_the_platform_order_and_place_new_keys(schema):
    props = _config_props(schema)
    props["brand_new"] = {"type": "boolean"}
    descriptor = environment_evaluator_descriptor(schema)
    fields = input_fields(
        descriptor,
        preferred=EVALUATOR_INPUT_FIELDS,
        skip=(*PLATFORM_OWNED_CONFIG_FIELDS, "run_metadata"),
    )
    assert fields[: fields.index("metric_concurrency")] == [
        "samples",
        "report_k",
        "max_concurrency",
    ]
    # After its nearest shown schema sibling (live_mode is platform-owned).
    assert fields[fields.index("dataset_alias") + 1] == "brand_new"
    assert not set(fields) & set(PLATFORM_OWNED_CONFIG_FIELDS)
    assert "run_metadata" not in fields


def test_diff_against_the_static_mirror(schema):
    static = environment_evaluator_descriptor(None)
    fetched = environment_evaluator_descriptor(schema)
    diff = evaluator_schema_diff(static, fetched)
    assert set(diff["added"]) == {"/metric_concurrency", "/versioning_details"}
    assert diff["removed"] == [] and diff["changed_types"] == []
    assert evaluator_schema_diff(fetched, fetched)["added"] == []


# --------------------------------------------------------------------------- panel


def test_panel_single_environment(schema):
    panel = evaluator_inputs_panel(
        [EvaluatorPanelSource("e1", "Staging", schema, "h1", "available")]
    )
    assert panel["source"] == "environment" and panel["missing"] == {}
    assert panel["environments"] == [
        {
            "environment_id": "e1",
            "name": "Staging",
            "source": "environment",
            "status": "available",
            "schema_hash": "h1",
        }
    ]
    assert "metric_concurrency" in panel["fields"]
    assert "versioning_details" in panel["platform_owned_present"]
    assert panel["descriptor"]["fields"]["/metric_concurrency"]["read_only"] is False


def test_panel_union_reports_fields_missing_per_environment(schema):
    narrow = copy.deepcopy(schema)
    _config_props(narrow).pop("git_commit")
    narrow_source = EvaluatorPanelSource("e2", "Narrow", narrow, "h2", "available")
    panel = evaluator_inputs_panel(
        [
            EvaluatorPanelSource("e1", "Old", None, None, "unsupported"),
            narrow_source,
        ]
    )
    assert panel["source"] == "mixed"
    assert panel["missing"] == {
        "git_commit": ["e2"],
        "metric_concurrency": ["e1"],
    }
    # Static fields first (the first environment), the new one after.
    assert panel["fields"][: len(EVALUATOR_INPUT_FIELDS)] == list(EVALUATOR_INPUT_FIELDS)
    assert panel["fields"][-1] == "metric_concurrency"
    assert "/versioning_details" in panel["descriptor"]["fields"]


def test_panel_without_environments_is_the_static_mirror():
    panel = evaluator_inputs_panel()
    assert panel["source"] == "static"
    assert panel["fields"] == list(EVALUATOR_INPUT_FIELDS)
    assert "versioning_details" not in panel["platform_owned_present"]


# --------------------------------------------------------------------------- validation


def test_validation_on_the_environment_schema(schema):
    ok = _validate(_doc(metric_concurrency=4, samples=2), evaluator_schema=schema)
    assert ok.ok, ok.errors
    assert ok.body["evaluator"]["config"]["metric_concurrency"] == 4

    bad = _validate(
        _doc(metric_concurrency=0, typo=1, versioning_details={"a": 1}),
        evaluator_schema=schema,
        environment_name="Staging",
    )
    errors = {e["pointer"]: e for e in bad.errors}
    assert errors["/evaluator/config/metric_concurrency"]["rule"] == "schema"
    assert errors["/evaluator/config/metric_concurrency"]["field"] == (
        "/metric_concurrency"
    )
    assert errors["/evaluator/config/typo"]["rule"] == "not_in_environment"
    assert 'environment "Staging"' in errors["/evaluator/config/typo"]["message"]
    assert errors["/evaluator/config/versioning_details"]["rule"] == "platform_owned"


def test_top_level_unknown_keys_and_dataset(schema):
    doc = _doc()
    doc["evaluator"]["metrics"] = ["exact_match"]  # silently dropped by the service
    del doc["evaluator"]["dataset"]
    errors = {
        e["pointer"]: e["rule"]
        for e in _validate(doc, evaluator_schema=schema).errors
    }
    assert errors == {
        "/evaluator/metrics": "unknown_key",
        "/evaluator/dataset": "required",
    }
    presets = _validate(doc, evaluator_schema=schema, require_dataset=False).errors
    assert [e["pointer"] for e in presets] == ["/evaluator/metrics"]


def test_report_k_uses_the_schema_default_samples(schema):
    _config_props(schema)["samples"]["default"] = 5
    assert _validate(_doc(report_k=3), evaluator_schema=schema).ok
    assert not _validate(_doc(report_k=3)).ok  # the mirror's default is 1


def test_an_invalid_evaluator_schema_is_reported_not_raised():
    result = _validate(_doc(samples=2), evaluator_schema={"type": 5})
    assert [(e["section"], e["rule"]) for e in result.errors] == [
        ("evaluator", "schema")
    ]
    assert result.body is None


def test_static_mirror_without_environment_keeps_unknown_key():
    result = _validate(_doc(metric_concurrency=2))
    assert [e["rule"] for e in result.errors] == ["unknown_key"]
    named = _validate(_doc(metric_concurrency=2), environment_name="Old")
    assert [e["rule"] for e in named.errors] == ["not_in_environment"]
