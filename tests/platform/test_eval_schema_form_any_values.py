"""Schema detection accepts any shape: nothing is dropped, odd types become JSON fields."""

from __future__ import annotations

import json

import pytest
from qym_platform.services.eval_schema_form import (build_form_descriptor,
                                                    match_pointer)


def _fields(props: dict, **root) -> dict:
    schema = {"type": "object", "properties": props, **root}
    return build_form_descriptor(schema)["fields"]


def _one(node, name: str = "X") -> dict:
    return _fields({name: node})["/" + name]


@pytest.mark.parametrize(
    "node, type_, widget, accepts",
    [
        ({}, "json", "json", None),
        (True, "json", "json", None),
        ({"description": "anything"}, "json", "json", None),
        ({"type": "null"}, "json", "json", ["null"]),
        ({"enum": [None]}, "json", "json", ["null"]),
        (
            {"anyOf": [{"type": "string"}, {"type": "integer"}]},
            "json",
            "json",
            ["integer", "string"],
        ),
        (
            {
                "oneOf": [
                    {"type": "string"},
                    {"type": "array", "items": {"type": "string"}},
                ]
            },
            "json",
            "json",
            ["string", "array"],
        ),
        ({"type": ["string", "object", "null"]}, "json", "json", ["string", "object"]),
        ({"anyOf": [{"type": "string"}, {}]}, "json", "json", None),
        (
            {
                "anyOf": [
                    {"type": "object", "properties": {"a": {"type": "string"}}},
                    {"type": "object", "properties": {"b": {"type": "integer"}}},
                ]
            },
            "json",
            "json",
            ["object"],
        ),
        (
            {"anyOf": [{"const": "auto"}, {"type": "number"}]},
            "json",
            "json",
            ["integer", "number", "string"],
        ),
    ],
)
def test_shapes_without_a_widget_are_json_fields(node, type_, widget, accepts):
    entry = _one(node)
    assert (entry["kind"], entry["type"], entry["widget"]) == ("field", type_, widget)
    assert entry["accepts"] == accepts
    json.dumps(entry)


@pytest.mark.parametrize(
    "node, type_, widget",
    [
        ({"minimum": 0, "maximum": 1}, "number", "number-range"),
        ({"exclusiveMinimum": 0}, "number", "number"),
        ({"pattern": "^a"}, "string", "text"),
        ({"format": "date-time"}, "string", "text"),
        ({"maxLength": 3}, "string", "text"),
        ({"items": {"type": "integer"}}, "array", "json"),
        ({"minItems": 1}, "array", "json"),
        ({"additionalProperties": {"type": "string"}}, "object", "collection"),
        ({"properties": {"a": {"type": "boolean"}}}, "object", "group"),
    ],
)
def test_missing_type_is_inferred_from_keywords(node, type_, widget):
    entry = _one(node)
    assert (entry["type"], entry["widget"]) == (type_, widget)


def test_scalars_keep_their_widgets():
    fields = _fields(
        {
            "I": {"type": "integer"},
            "N": {"type": "number"},
            "IN": {"type": ["integer", "number", "null"]},
            "B": {"type": "boolean"},
            "BS": {"anyOf": [{"type": "boolean"}, {"type": "string"}]},
            "D": {"type": "string", "format": "date"},
            "E": {"enum": ["a", 1, True, {"k": 1}, [1]]},
            "C": {"const": 3},
        }
    )
    assert fields["/I"]["type"] == "integer"
    assert fields["/N"]["type"] == "number"
    assert (fields["/IN"]["type"], fields["/IN"]["nullable"]) == ("number", True)
    assert fields["/B"]["widget"] == "toggle"
    assert fields["/BS"]["type"] == "boolean"
    assert (fields["/D"]["type"], fields["/D"]["format"]) == ("string", "date")
    assert fields["/E"]["type"] == "enum"
    assert fields["/E"]["enum"] == ["a", 1, True, {"k": 1}, [1]]
    assert fields["/C"]["enum"] == [3]
    assert all(fields[p]["sweepable"] for p in ("/I", "/N", "/B", "/E"))


def test_arrays_report_their_item_type():
    defs = {"Item": {"type": "object", "properties": {"x": {"type": "integer"}}}}
    fields = build_form_descriptor(
        {
            "$defs": defs,
            "type": "object",
            "properties": {
                "S": {"type": "array", "items": {"type": "string"}},
                "O": {"type": "array", "items": {"$ref": "#/$defs/Item"}},
                "E": {"type": "array", "items": {"enum": ["a", "b"]}},
                "T": {"type": "array", "prefixItems": [{"type": "string"}]},
                "A": {"type": "array"},
                "NA": {
                    "anyOf": [
                        {"type": "array", "items": {"type": "number"}},
                        {"type": "null"},
                    ]
                },
            },
        }
    )["fields"]
    assert [fields[p]["item_type"] for p in ("/S", "/O", "/E", "/T", "/A", "/NA")] == [
        "string",
        "object",
        "enum",
        None,
        None,
        "number",
    ]
    assert all(fields[p]["type"] == "array" for p in ("/S", "/O", "/E", "/T", "/A"))
    assert fields["/NA"]["nullable"] is True


def test_object_with_properties_and_extra_keys_keeps_both():
    descriptor = build_form_descriptor(
        {
            "type": "object",
            "properties": {
                "OPTS": {
                    "type": "object",
                    "properties": {"a": {"type": "string"}},
                    "additionalProperties": {"type": "integer"},
                },
                "FREE": {
                    "type": "object",
                    "properties": {"b": {"type": "boolean"}},
                    "additionalProperties": True,
                },
                "PAT": {
                    "type": "object",
                    "properties": {"c": {"type": "string"}},
                    "patternProperties": {"^x_": {"type": "string"}},
                },
                "CLOSED": {
                    "type": "object",
                    "properties": {"d": {"type": "string"}},
                    "additionalProperties": False,
                },
            },
        }
    )
    fields = descriptor["fields"]
    opts = fields["/OPTS"]
    assert opts["kind"] == "object" and opts["children"] == ["/OPTS/a"]
    assert opts["additional_pointer"] == "/OPTS/{key}"
    assert fields["/OPTS/{key}"]["type"] == "integer"
    assert fields["/FREE/{key}"]["type"] == "json"
    assert fields["/FREE/{key}"]["accepts"] is None
    assert fields["/PAT"]["additional_pointer"] == "/PAT/{key}"
    assert "additional_pointer" not in fields["/CLOSED"]
    # Fixed keys win; any other key maps onto the extra-key template.
    assert match_pointer(descriptor, "/OPTS/a") == "/OPTS/a"
    assert match_pointer(descriptor, "/OPTS/zzz") == "/OPTS/{key}"
    assert match_pointer(descriptor, "/CLOSED/zzz") is None


def test_nested_objects_and_arrays_of_objects_are_all_emitted():
    schema = {
        "type": "object",
        "properties": {
            "OUTER": {
                "type": "object",
                "properties": {
                    "inner": {
                        "type": "object",
                        "properties": {
                            "deep": {
                                "type": "object",
                                "properties": {"leaf": {"type": "number"}},
                            },
                            "list": {"type": "array", "items": {"type": "object"}},
                        },
                    },
                },
            },
        },
    }
    fields = build_form_descriptor(schema)["fields"]
    assert fields["/OUTER/inner/deep/leaf"]["type"] == "number"
    assert fields["/OUTER/inner/list"]["type"] == "array"
    assert fields["/OUTER/inner/list"]["item_type"] == "object"


def test_bad_nodes_never_drop_the_field():
    descriptor = build_form_descriptor(
        {
            "type": "object",
            "properties": {
                "EXT": {"$ref": "https://example.com/schema.json"},
                "MISSING": {"$ref": "#/$defs/Nope"},
                "FALSE": False,
                "EMPTY_ENUM": {"enum": []},
                "BAD_UNION": {"anyOf": [{"type": "string"}, {"$ref": "#/nope"}]},
            },
        }
    )
    fields = descriptor["fields"]
    for name in ("EXT", "MISSING", "FALSE", "EMPTY_ENUM", "BAD_UNION"):
        assert fields["/" + name]["widget"] == "json", name
    assert descriptor["root"] == [
        "/EXT",
        "/MISSING",
        "/FALSE",
        "/EMPTY_ENUM",
        "/BAD_UNION",
    ]
    assert len(descriptor["warnings"]) >= 4


def test_defaults_of_any_type_round_trip():
    defaults = {
        "S": ("string", "x"),
        "I": ("integer", 0),
        "F": ("number", 0.5),
        "B": ("boolean", False),
        "A": ("array", [1, {"a": None}]),
        "O": ("object", {"k": [1, 2]}),
    }
    fields = _fields({k: {"type": t, "default": v} for k, (t, v) in defaults.items()})
    for key, (_, value) in defaults.items():
        assert fields["/" + key]["has_default"] is True
        assert fields["/" + key]["default"] == value
