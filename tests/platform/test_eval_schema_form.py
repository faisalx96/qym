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

from qym_platform.services.eval_schema_form import (build_form_descriptor,
                                                    expand_pointer,
                                                    json_pointer,
                                                    match_pointer,
                                                    split_pointer)

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"

# The abbreviated response of GET /evals/env-overrides/schema, verbatim from
# docs/evaluation-service-api-integration.md §3.3 (placeholders included).
GUIDE_EXAMPLE_SCHEMA = {
    "$defs": {
        "EndpointConfig": {
            "additionalProperties": False,
            "properties": {"...": "..."},
        },
        "RoleConfig": {"...": "..."},
        "LlmOverrides": {"...": "..."},
        "ResponseFormat": {"...": "..."},
    },
    "additionalProperties": False,
    "properties": {
        "LLM_OVERRIDES": {
            "anyOf": [{"$ref": "#/$defs/LlmOverrides"}, {"type": "null"}]
        },
        "MILVUS_SEARCH_THRESHOLD": {
            "anyOf": [
                {"maximum": 1.0, "minimum": 0.0, "type": "number"},
                {"type": "null"},
            ]
        },
        "...": "one entry per whitelisted env var in §4.3",
    },
    "title": "EnvOverrides",
    "type": "object",
}


@pytest.fixture(scope="module")
def full_schema() -> dict:
    return json.loads(FIXTURE.read_text())


@pytest.fixture(scope="module")
def descriptor(full_schema) -> dict:
    return build_form_descriptor(full_schema)


def _role_names(schema: dict) -> list[str]:
    props = schema["$defs"]["LlmOverrides"]["properties"]
    return [name for name in props if name != "endpoints"]


# --------------------------------------------------------------------------- guide


def test_guide_example_schema_builds_without_crashing():
    desc = build_form_descriptor(GUIDE_EXAMPLE_SCHEMA)

    json.dumps(desc)  # JSON-serializable
    assert desc["title"] == "EnvOverrides"
    assert desc["root"] == ["/LLM_OVERRIDES", "/MILVUS_SEARCH_THRESHOLD"]

    threshold = desc["fields"]["/MILVUS_SEARCH_THRESHOLD"]
    assert threshold["type"] == "number"
    assert threshold["nullable"] is True
    assert threshold["bounds"] == {"minimum": 0.0, "maximum": 1.0}
    assert threshold["widget"] == "number-range"
    assert threshold["sweepable"] is True
    assert threshold["group"] == "rag"

    llm = desc["fields"]["/LLM_OVERRIDES"]
    assert llm["nullable"] is True
    assert llm["group"] == "llm_routing"
    # The placeholder "..." entries are reported, not rendered.
    assert any(w["pointer"] == "/..." for w in desc["warnings"])
    assert "/..." not in desc["fields"]


# --------------------------------------------------------------------------- full


def test_descriptor_is_json_serializable_and_stable(full_schema, descriptor):
    assert json.loads(json.dumps(descriptor)) == descriptor
    pristine = copy.deepcopy(full_schema)
    assert build_form_descriptor(full_schema) == descriptor
    assert full_schema == pristine  # the input schema is never mutated
    assert descriptor["descriptor_version"] == 1
    assert descriptor["warnings"] == []


def test_every_top_level_env_var_is_emitted_in_schema_order(full_schema, descriptor):
    assert descriptor["root"] == [json_pointer([n]) for n in full_schema["properties"]]


def test_nullable_scalars_collapse_any_of(descriptor):
    fields = descriptor["fields"]
    toggle = fields["/BRIEF_ENABLED"]
    assert toggle["type"] == "boolean"
    assert toggle["widget"] == "toggle"
    assert toggle["nullable"] is True
    assert "real_boolean" in toggle["quirks"]
    assert toggle["has_default"] is False  # null default => inherited from env

    mode = fields["/TABLE_SELECTION_MODE"]
    assert mode["type"] == "enum"
    assert mode["enum"] == ["rag", "llm_direct", "pure_llm"]
    assert mode["value_type"] == "string"
    assert mode["widget"] == "select"
    assert mode["sweepable"] is True

    limit = fields["/SQL_RESULT_LIMIT"]
    assert limit["type"] == "integer"
    assert limit["bounds"] == {"minimum": 1, "maximum": 100000}

    timeout = fields["/REQUEST_TIMEOUT"]
    assert timeout["bounds"] == {"exclusiveMinimum": 0, "maximum": 3600}
    assert timeout["widget"] == "number-range"

    assert fields["/VIZ_MAX_GROUPS"]["widget"] == "number"
    assert fields["/VIZ_LLM_MODEL"]["widget"] == "model-name"
    assert fields["/MILVUS_SEARCH_THRESHOLD"]["label"] == "Milvus Search Threshold"


def test_rag_iteration_quirk(descriptor):
    field = descriptor["fields"]["/RAG_ITERATION"]
    assert field["type"] == "string"
    assert field["widget"] == "text"
    assert field["hints"]["values"] == ["", "latest"]
    assert field["hints"]["pattern"] == "^[0-9]+$"
    assert "rag_iteration" in field["quirks"]
    assert field["sweepable"] is True


def test_rag_iteration_quirk_forces_string_on_unions():
    schema = {
        "type": "object",
        "properties": {
            "RAG_ITERATION": {
                "anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]
            }
        },
    }
    field = build_form_descriptor(schema)["fields"]["/RAG_ITERATION"]
    assert field["type"] == "string"
    assert field["nullable"] is True
    assert field["sweepable"] is True


def test_endpoints_map_becomes_collection_with_fixed_primary(descriptor):
    fields = descriptor["fields"]
    llm = fields["/LLM_OVERRIDES"]
    assert llm["kind"] == "object"
    assert llm["children"] == ["/LLM_OVERRIDES/endpoints", "/LLM_OVERRIDES/{role}"]

    endpoints = fields["/LLM_OVERRIDES/endpoints"]
    assert endpoints["kind"] == "collection"
    assert endpoints["key_param"] == "endpoint"
    assert endpoints["required"] is True
    assert endpoints["required_keys"] == ["primary"]
    assert endpoints["min_items"] == 1
    assert endpoints["item_pointer"] == "/LLM_OVERRIDES/endpoints/{endpoint}"

    item = fields["/LLM_OVERRIDES/endpoints/{endpoint}"]
    assert item["kind"] == "object"
    assert item["params"] == ["endpoint"]
    assert item["children"] == [
        "/LLM_OVERRIDES/endpoints/{endpoint}/" + name
        for name in (
            "model",
            "base_url",
            "api_key",
            "timeout",
            "max_attempts",
            "max_connections",
            "max_keepalive",
            "connect_timeout",
        )
    ]

    model = fields["/LLM_OVERRIDES/endpoints/{endpoint}/model"]
    assert model["required"] is True
    assert model["nullable"] is False
    assert model["widget"] == "model-name"
    assert fields["/LLM_OVERRIDES/endpoints/{endpoint}/base_url"]["widget"] == "url"

    api_key = fields["/LLM_OVERRIDES/endpoints/{endpoint}/api_key"]
    assert api_key["secret"] is True
    assert api_key["widget"] == "secret"
    assert api_key["sweepable"] is False

    timeout = fields["/LLM_OVERRIDES/endpoints/{endpoint}/timeout"]
    assert timeout["sweepable"] is True
    assert timeout["group"] == "llm_routing"

    assert {
        "rule": "required_keys",
        "pointer": "/LLM_OVERRIDES/endpoints",
        "keys": ["primary"],
    } in descriptor["rules"]
    assert {
        "rule": "min_items",
        "pointer": "/LLM_OVERRIDES/endpoints",
        "min": 1,
    } in descriptor["rules"]


def test_role_blocks_collapse_into_role_table(full_schema, descriptor):
    fields = descriptor["fields"]
    table = fields["/LLM_OVERRIDES/{role}"]
    assert table["kind"] == "role_table"
    assert table["widget"] == "role-table"
    assert table["row_param"] == "role"
    assert table["ref"] == "RoleConfig"
    assert [row["key"] for row in table["rows"]] == _role_names(full_schema)
    assert table["rows"][0] == {
        "key": "main",
        "pointer": "/LLM_OVERRIDES/main",
        "label": "main",
        "description": None,
        "required": False,
        "nullable": True,
    }
    assert table["columns"] == [
        "/LLM_OVERRIDES/{role}/" + name
        for name in (
            "endpoint",
            "temperature",
            "max_tokens",
            "reasoning_enabled",
            "reasoning_effort",
            "top_p",
            "seed",
            "response_format",
        )
    ]
    # Individual roles are not emitted as separate fields.
    assert "/LLM_OVERRIDES/main" not in fields

    temperature = fields["/LLM_OVERRIDES/{role}/temperature"]
    assert temperature["bounds"] == {"minimum": 0, "maximum": 2}
    assert temperature["sweepable"] is True
    assert temperature["params"] == ["role"]

    effort = fields["/LLM_OVERRIDES/{role}/reasoning_effort"]
    assert effort["enum"] == ["low", "medium", "high"]

    response_format = fields["/LLM_OVERRIDES/{role}/response_format"]
    assert response_format["kind"] == "object"
    assert response_format["label"] == "response_format"  # not the def title
    assert fields["/LLM_OVERRIDES/{role}/response_format/type"]["enum"] == [
        "text",
        "json_object",
    ]


def test_role_endpoint_is_an_endpoint_ref(descriptor):
    field = descriptor["fields"]["/LLM_OVERRIDES/{role}/endpoint"]
    assert field["widget"] == "endpoint-ref"
    assert field["ref_collection"] == "/LLM_OVERRIDES/endpoints"
    assert "endpoint_ref" in field["quirks"]
    assert {
        "rule": "endpoint_ref",
        "pointer": "/LLM_OVERRIDES/{role}/endpoint",
        "collection": "/LLM_OVERRIDES/endpoints",
    } in descriptor["rules"]


def test_new_roles_appear_without_code_change(full_schema):
    schema = copy.deepcopy(full_schema)
    props = schema["$defs"]["LlmOverrides"]["properties"]
    props["sql_critic"] = {
        "anyOf": [{"$ref": "#/$defs/RoleConfig"}, {"type": "null"}],
        "default": None,
    }
    desc = build_form_descriptor(schema)
    rows = [row["key"] for row in desc["fields"]["/LLM_OVERRIDES/{role}"]["rows"]]
    assert rows[-1] == "sql_critic"
    assert (
        match_pointer(desc, "/LLM_OVERRIDES/sql_critic/temperature")
        == "/LLM_OVERRIDES/{role}/temperature"
    )


def test_role_table_detection_is_structural_for_inline_and_renamed_defs():
    role = {
        "type": "object",
        "properties": {"endpoint": {"type": "string"}, "seed": {"type": "integer"}},
    }
    schema = {
        "type": "object",
        "$defs": {"AgentSettings": {**role, "description": "Per-agent settings."}},
        "properties": {
            "endpoints": {
                "type": "object",
                "additionalProperties": {
                    "type": "object",
                    "properties": {"model": {"type": "string"}},
                },
            },
            "alpha": {"$ref": "#/$defs/AgentSettings"},
            "beta": {
                "anyOf": [{"$ref": "#/$defs/AgentSettings"}, {"type": "null"}],
                "description": "The beta agent.",
            },
            # Same shape, different annotations: still one table.
            "inline_a": {**copy.deepcopy(role), "title": "Inline A"},
            "inline_b": {**copy.deepcopy(role), "default": None},
            "solo": {"type": "object", "properties": {"x": {"type": "number"}}},
        },
    }
    desc = build_form_descriptor(schema)
    fields = desc["fields"]
    assert desc["root"] == [
        "/endpoints",
        "/{agent_settings}",
        "/{role}",
        "/solo",
    ]
    assert [r["key"] for r in fields["/{agent_settings}"]["rows"]] == ["alpha", "beta"]
    assert [r["key"] for r in fields["/{role}"]["rows"]] == ["inline_a", "inline_b"]
    assert fields["/{agent_settings}"]["nullable"] is False
    assert fields["/solo"]["kind"] == "object"
    agents = fields["/{agent_settings}"]
    assert agents["description"] == "Per-agent settings."
    assert [r["description"] for r in agents["rows"]] == [None, "The beta agent."]
    assert fields["/{role}"]["rows"][0]["label"] == "Inline A"
    assert fields["/{role}/endpoint"]["widget"] == "endpoint-ref"
    assert fields["/{agent_settings}/endpoint"]["ref_collection"] == "/endpoints"
    # The "primary" quirk follows the map's name, wherever the map sits.
    assert fields["/endpoints"]["required_keys"] == ["primary"]


def test_groups_follow_prefix_table(full_schema, descriptor):
    groups = {g["id"]: g["pointers"] for g in descriptor["groups"]}
    assert [g["id"] for g in descriptor["groups"]] == [
        "llm_routing",
        "feature_toggles",
        "rag",
        "sql_runner",
        "context",
        "visualization",
        "misc",
    ]
    assert groups["llm_routing"] == ["/LLM_OVERRIDES"]
    assert "/VIZ_ENFORCEMENT_ENABLED" in groups["feature_toggles"]
    assert "/VIZ_ENFORCEMENT_ENABLED" not in groups["visualization"]
    assert groups["rag"] == [
        "/TABLE_SELECTION_MODE",
        "/USE_LLM_TABLE_SELECTION",
        "/RAG_ITERATION",
        "/MILVUS_SEARCH_THRESHOLD",
    ]
    assert groups["sql_runner"] == ["/SQL_RESULT_LIMIT"]
    assert groups["misc"] == ["/REQUEST_TIMEOUT"]
    assert "/VIZ_LLM_MODEL" in groups["visualization"]
    all_grouped = [p for g in descriptor["groups"] for p in g["pointers"]]
    assert sorted(all_grouped) == sorted(descriptor["root"])


def test_unknown_fields_fall_into_other_group():
    schema = {
        "type": "object",
        "properties": {
            "NEW_THING": {"type": "string"},
            "SQL_DIALECT": {"type": "string"},
            "SERVICE_TOKEN": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "DB_PASSWORD": {"type": "string", "format": "password"},
        },
    }
    desc = build_form_descriptor(schema)
    assert desc["groups"] == [
        {"id": "sql_runner", "label": "SQL runner", "pointers": ["/SQL_DIALECT"]},
        {
            "id": "other",
            "label": "Other",
            "pointers": ["/NEW_THING", "/SERVICE_TOKEN", "/DB_PASSWORD"],
        },
    ]
    token = desc["fields"]["/SERVICE_TOKEN"]
    assert token["secret"] is True
    assert token["sweepable"] is False
    password = desc["fields"]["/DB_PASSWORD"]
    assert (password["secret"], password["widget"]) == (True, "secret")
    assert password["sweepable"] is False


def test_defaults_are_kept_when_present():
    schema = {
        "type": "object",
        "properties": {
            "CONTEXT_KEEP_RECENT": {
                "anyOf": [{"type": "integer", "minimum": 0}, {"type": "null"}],
                "default": 6,
            },
            "MODE": {"$ref": "#/$defs/Mode", "default": "rag"},
            "FLAG": {"type": "boolean", "default": False},
        },
        "$defs": {"Mode": {"enum": ["rag", "llm"], "type": "string", "title": "Mode"}},
    }
    fields = build_form_descriptor(schema)["fields"]
    assert fields["/CONTEXT_KEEP_RECENT"]["default"] == 6
    assert fields["/CONTEXT_KEEP_RECENT"]["has_default"] is True
    assert fields["/MODE"]["default"] == "rag"
    assert fields["/MODE"]["enum"] == ["rag", "llm"]
    assert fields["/MODE"]["label"] == "MODE"
    assert fields["/FLAG"]["has_default"] is True
    assert fields["/FLAG"]["default"] is False


def test_nested_any_of_type_lists_and_null_enums():
    schema = {
        "type": "object",
        "properties": {
            "A": {
                "anyOf": [
                    {"anyOf": [{"type": "number", "maximum": 5}, {"type": "null"}]},
                    {"type": "null"},
                ]
            },
            "B": {"type": ["integer", "null"]},
            "C": {"enum": ["x", None]},
            "D": {"oneOf": [{"type": "boolean"}, {"type": "string"}]},
            "E": {"anyOf": [{"type": "string"}, {"type": "array"}]},
            "F": {"allOf": [{"$ref": "#/$defs/Num"}], "description": "wrapped"},
            "G": {"type": "array", "items": {"type": "string"}},
        },
        "$defs": {"Num": {"type": "number", "minimum": 1}},
    }
    fields = build_form_descriptor(schema)["fields"]
    assert fields["/A"]["type"] == "number"
    assert fields["/A"]["nullable"] is True
    assert fields["/A"]["bounds"] == {"maximum": 5}
    assert (fields["/B"]["type"], fields["/B"]["nullable"]) == ("integer", True)
    assert fields["/C"]["enum"] == ["x"]
    assert fields["/C"]["nullable"] is True
    assert fields["/D"]["type"] == "boolean"  # always sent as a real boolean
    assert fields["/E"]["type"] == "json"
    assert fields["/E"]["sweepable"] is False
    assert fields["/F"]["type"] == "number"
    assert fields["/F"]["bounds"] == {"minimum": 1}
    assert fields["/F"]["description"] == "wrapped"
    assert (fields["/G"]["type"], fields["/G"]["widget"]) == ("array", "json")


def test_cyclic_refs_terminate_with_warning():
    schema = {
        "type": "object",
        "$defs": {
            "Node": {
                "type": "object",
                "properties": {
                    "value": {"type": "integer"},
                    "child": {"anyOf": [{"$ref": "#/$defs/Node"}, {"type": "null"}]},
                },
            },
            "Loop": {"$ref": "#/$defs/Loop"},
        },
        "properties": {
            "tree": {"$ref": "#/$defs/Node"},
            "loop": {"$ref": "#/$defs/Loop"},
            "missing": {"$ref": "#/$defs/Nope"},
        },
    }
    desc = build_form_descriptor(schema)
    fields = desc["fields"]
    assert fields["/tree"]["kind"] == "object"
    assert fields["/tree/value"]["type"] == "integer"
    assert fields["/tree/child"]["type"] == "json"
    assert fields["/loop"]["type"] == "json"
    assert fields["/missing"]["type"] == "json"
    warned = {w["pointer"] for w in desc["warnings"]}
    assert {"/tree/child", "/loop", "/missing"} <= warned


def test_free_form_objects_and_scalar_maps():
    schema = {
        "type": "object",
        "properties": {
            "META": {"type": "object", "additionalProperties": True},
            "WEIGHTS": {
                "type": "object",
                "additionalProperties": {"type": "number", "minimum": 0},
            },
            "LABEL_MAP": {"type": "object", "additionalProperties": {"type": "string"}},
            "a/b": {"type": "string"},
        },
    }
    desc = build_form_descriptor(schema)
    fields = desc["fields"]
    assert (fields["/META"]["kind"], fields["/META"]["type"]) == ("field", "object")
    assert fields["/META"]["widget"] == "json"
    weights = fields["/WEIGHTS"]
    assert weights["kind"] == "collection"
    assert weights["key_param"] == "weight"
    assert weights["required_keys"] == []
    assert weights["min_items"] == 0
    item = fields[weights["item_pointer"]]
    assert (item["type"], item["sweepable"]) == ("number", True)
    assert fields["/LABEL_MAP"]["item_pointer"] == "/LABEL_MAP/{key}"
    assert "/a~1b" in fields
    assert match_pointer(desc, "/a~1b") == "/a~1b"
    assert match_pointer(desc, "/WEIGHTS/anything") == "/WEIGHTS/{weight}"
    assert desc["rules"] == []


def test_match_and_expand_pointer(descriptor):
    assert (
        match_pointer(descriptor, "/LLM_OVERRIDES/endpoints/fast/model")
        == "/LLM_OVERRIDES/endpoints/{endpoint}/model"
    )
    assert (
        match_pointer(descriptor, "/LLM_OVERRIDES/router/response_format/type")
        == "/LLM_OVERRIDES/{role}/response_format/type"
    )
    assert match_pointer(descriptor, "/LLM_OVERRIDES/endpoints") == (
        "/LLM_OVERRIDES/endpoints"
    )
    assert match_pointer(descriptor, "/LLM_OVERRIDES/not_a_role") is None
    assert match_pointer(descriptor, "/NOT_WHITELISTED") is None
    assert match_pointer(descriptor, "/BRIEF_ENABLED/extra") is None
    assert (
        expand_pointer("/LLM_OVERRIDES/{role}/temperature", {"role": "main"})
        == "/LLM_OVERRIDES/main/temperature"
    )
    assert split_pointer("/a~1b/c~0d") == ["a/b", "c~d"]
    assert split_pointer("") == []
    with pytest.raises(ValueError):
        split_pointer("no-slash")


def test_rejects_non_object_schema():
    with pytest.raises(ValueError):
        build_form_descriptor(["not", "a", "schema"])  # type: ignore[arg-type]


def test_single_role_definition_is_still_a_table():
    schema = {
        "type": "object",
        "$defs": {
            "AgentRole": {
                "type": "object",
                "properties": {"seed": {"type": "integer"}},
            },
            "Controller": {"type": "object", "properties": {"x": {"type": "integer"}}},
        },
        "properties": {
            "main": {"$ref": "#/$defs/AgentRole"},
            "ctl": {"$ref": "#/$defs/Controller"},
        },
    }
    desc = build_form_descriptor(schema)
    assert desc["root"] == ["/{role}", "/ctl"]
    assert desc["fields"]["/{role}"]["rows"][0]["key"] == "main"
    assert desc["fields"]["/ctl"]["kind"] == "object"
