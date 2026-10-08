"""Convert an Evaluation Service ``env_overrides`` JSON Schema into a form descriptor.

The browser never interprets ``$ref``/``anyOf``: this module resolves them once and
emits a flat, JSON-serializable descriptor that the launch form, model-slot detection,
config validation and the multi-environment union form all read (plan §6, R2).

Descriptor shape (``DESCRIPTOR_VERSION`` = 1)::

    {
      "descriptor_version": 1,
      "title": "EnvOverrides",
      "root": ["/LLM_OVERRIDES", "/MILVUS_SEARCH_THRESHOLD", ...],  # top-level, schema order
      "fields": {<pointer>: <entry>, ...},                          # every node, DFS order
      "groups": [{"id": "llm_routing", "label": "LLM routing", "pointers": [...]}, ...],
      "rules": [<cross-field rule>, ...],
      "warnings": [{"pointer": ..., "message": ...}, ...],
    }

Pointers are RFC 6901 JSON pointers relative to ``env_overrides``. Open-ended parts use
a ``{param}`` template segment: ``/LLM_OVERRIDES/endpoints/{endpoint}/model`` (a map
entry) and ``/LLM_OVERRIDES/{role}/temperature`` (a role-table column). Use
``match_pointer`` to map a concrete pointer onto its template and ``expand_pointer`` to
go the other way.

Every entry carries the same keys::

    pointer, name, label, description, path (segments), parent (pointer | None),
    params (template names in the pointer), kind, type, widget, group, required,
    nullable, has_default, default, sweepable, secret, enum, value_type, bounds,
    pattern, format, quirks

- ``kind``: ``field`` (a leaf input), ``object`` (fixed properties, see ``children``),
  ``collection`` (a map with a templated item) or ``role_table``.
- ``type``: ``boolean | integer | number | string | enum | object | array | json``.
  ``json`` covers shapes a generic input cannot express (free-form objects, unions,
  recursive refs); it is edited as raw JSON.
- ``widget``: ``toggle | select | number | number-range | text | url | secret |
  model-name | endpoint-ref | json`` for fields and ``group | collection | role-table``
  for containers.
- ``has_default``/``default``: only a non-null schema ``default`` counts (D6). A null
  default means "not overridden", so the UI shows "inherited from environment".
- ``bounds``: the numeric/length keywords present in the schema (``minimum``,
  ``maximum``, ``exclusiveMinimum``, ``exclusiveMaximum``, ``multipleOf``,
  ``minLength``, ``maxLength``).
- ``sweepable``: every scalar field except secrets (keys must never land in sweep params).
- ``quirks``: service behaviour tags, e.g. ``real_boolean`` (send ``true``/``false``,
  never the strings the service also accepts), ``rag_iteration`` (see ``hints``),
  ``endpoint_ref``.

Kind-specific keys:

- ``object``: ``children`` (child pointers, schema order; a role table appears once).
- ``collection``: ``key_param`` (``"endpoint"``), ``item_pointer`` (the templated entry
  describing one value), ``children`` (``[item_pointer]``), ``required_keys`` (keys that
  must exist and cannot be removed, e.g. ``primary``), ``min_items``, ``max_items``,
  ``key_pattern``.
- ``role_table``: ``row_param`` (``"role"``), ``rows`` (``[{key, pointer, label,
  description, required, nullable}]``, one per role found in the schema), ``columns``
  (child pointers, i.e. the shared ``RoleConfig`` fields), ``children`` (= columns) and
  ``ref`` (the shared definition name). Rows are detected structurally: sibling
  properties that resolve to the same object definition, so roles added by the service
  appear without a qym change.
- ``endpoint-ref`` fields: ``ref_collection`` (pointer of the collection whose keys are
  valid values).
- ``RAG_ITERATION``: ``hints`` = ``{"values": ["", "latest"], "pattern": "^[0-9]+$", ...}``.

Any-value keys (every entry, so no schema shape is dropped):

- ``accepts``: the JSON types a ``json`` field takes (``["integer", "string"]`` for a
  ``string | integer`` union), or ``None`` when anything goes. The form edits such a
  field as JSON and, when ``"string"`` is accepted, keeps text that is not JSON as a
  string.
- ``item_type``: for ``array`` fields, the items' type (``string``, ``object``, …) or
  ``None``.
- ``additional_pointer``: on ``object`` entries whose schema also allows extra keys
  (an explicit ``additionalProperties`` or ``patternProperties``), the templated entry
  (``/<object>/{key}``) describing an extra key's value. It is not in ``children``;
  ``match_pointer`` maps extra keys onto it.

A schema node without ``type`` gets one inferred from its keywords (``properties`` →
object, ``items`` → array, ``minimum`` → number, ``pattern`` → string, …); a node that
says nothing is a ``json`` field accepting any value.

``rules`` lists the cross-field checks the service enforces so validation can mirror
them: ``{"rule": "required_keys", "pointer", "keys"}``, ``{"rule": "min_items",
"pointer", "min"}`` and ``{"rule": "endpoint_ref", "pointer", "collection"}``.
"""

from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

DESCRIPTOR_VERSION = 1

_MAX_DEPTH = 32
_SCALAR_TYPES = {"boolean", "integer", "number", "string", "enum"}
_BOUND_KEYS = (
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
)
_ANNOTATION_KEYS = ("title", "description", "default", "examples", "deprecated")
_JSON_TYPES = ("null", "boolean", "integer", "number", "string", "array", "object")
# Keywords that only make sense for one JSON type: used when ``type`` is missing.
_TYPE_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "object",
        (
            "properties",
            "additionalProperties",
            "patternProperties",
            "propertyNames",
            "minProperties",
            "maxProperties",
            "required",
        ),
    ),
    (
        "array",
        ("items", "prefixItems", "minItems", "maxItems", "uniqueItems", "contains"),
    ),
    ("string", ("pattern", "minLength", "maxLength", "format", "contentMediaType")),
    (
        "number",
        ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"),
    ),
)

_SECRET_NAME = re.compile(r"^(api_key|.+_api_key|.+_token)$", re.IGNORECASE)
_MODEL_NAME = re.compile(r"^(model|model_name|.+_model|.+_model_name)$", re.IGNORECASE)
_URL_NAME = re.compile(r"^(url|base_url|.+_url|.+_base_url)$", re.IGNORECASE)

# Display groups, mirroring guide §4.3. Exact names win over prefixes, and the longest
# prefix wins among prefixes. Unmatched top-level fields go to "other".
_GROUP_RULES: tuple[tuple[str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("llm_routing", "LLM routing", ("LLM_OVERRIDES",), ("LLM_",)),
    (
        "feature_toggles",
        "Feature toggles",
        (
            "ENABLE_RESPONSE_DRAFTING",
            "BRIEF_ENABLED",
            "SKILL_TRIGGERS_ENABLED",
            "ROUTER_SKILL_HINTS_ENABLED",
            "SKILL_TOOL_ENABLED",
            "VIZ_ENFORCEMENT_ENABLED",
        ),
        ("ENABLE_", "SKILL_", "ROUTER_", "BRIEF_"),
    ),
    (
        "rag",
        "Table selection / RAG",
        ("USE_LLM_TABLE_SELECTION",),
        ("TABLE_SELECTION_", "RAG_", "MILVUS_"),
    ),
    ("sql_runner", "SQL runner", (), ("SQL_",)),
    ("context", "Context management", (), ("CONTEXT_",)),
    ("visualization", "Visualization", (), ("VIZ_",)),
    ("misc", "Misc", ("REQUEST_TIMEOUT",), ()),
)
_OTHER_GROUP = ("other", "Other")

# Service quirks keyed by map property name: keys that must always be present.
_COLLECTION_REQUIRED_KEYS: dict[str, tuple[str, ...]] = {"endpoints": ("primary",)}

# Service quirks keyed by top-level env var name.
_FIELD_QUIRKS: dict[str, dict[str, Any]] = {
    "RAG_ITERATION": {
        "type": "string",
        "widget": "text",
        "quirk": "rag_iteration",
        "hints": {
            "values": ["", "latest"],
            "pattern": "^[0-9]+$",
            "text": 'Empty for the default, "latest", or an iteration number.',
        },
    },
}


# --------------------------------------------------------------------------- pointers


def escape_pointer_segment(segment: str) -> str:
    return segment.replace("~", "~0").replace("/", "~1")


def unescape_pointer_segment(segment: str) -> str:
    return segment.replace("~1", "/").replace("~0", "~")


def json_pointer(segments: list[str] | tuple[str, ...]) -> str:
    """Build a pointer; ``{param}`` template segments are kept verbatim."""
    return "".join("/" + escape_pointer_segment(s) for s in segments)


def split_pointer(pointer: str) -> list[str]:
    if not pointer:
        return []
    if not pointer.startswith("/"):
        raise ValueError(f"invalid JSON pointer: {pointer!r}")
    return [unescape_pointer_segment(s) for s in pointer[1:].split("/")]


def _template_param(segment: str) -> str | None:
    if len(segment) > 2 and segment.startswith("{") and segment.endswith("}"):
        return segment[1:-1]
    return None


def expand_pointer(template: str, params: dict[str, str]) -> str:
    """Fill ``{param}`` segments, e.g. ``{"role": "main"}``; missing params raise."""
    segments = []
    for segment in split_pointer(template):
        name = _template_param(segment)
        segments.append(params[name] if name is not None else segment)
    return json_pointer(segments)


def match_pointer(descriptor: dict[str, Any], pointer: str) -> str | None:
    """Return the descriptor pointer describing a concrete pointer, or ``None``.

    ``/LLM_OVERRIDES/main/temperature`` → ``/LLM_OVERRIDES/{role}/temperature`` and
    ``/LLM_OVERRIDES/endpoints/fast/model`` →
    ``/LLM_OVERRIDES/endpoints/{endpoint}/model``. Literal names win over role rows,
    which win over collection keys.
    """
    fields = descriptor.get("fields") or {}
    candidates: list[str] = list(descriptor.get("root") or [])
    current: str | None = None
    for segment in split_pointer(pointer):
        chosen = None
        for rank in ("literal", "row", "key"):
            for child in candidates:
                entry = fields.get(child)
                if entry is None:
                    continue
                last = entry["path"][-1]
                if rank == "literal" and _template_param(last) is None:
                    if last == segment:
                        chosen = child
                elif rank == "row" and entry["kind"] == "role_table":
                    if any(row["key"] == segment for row in entry["rows"]):
                        chosen = child
                elif rank == "key" and _template_param(last) is not None:
                    if entry["kind"] != "role_table":
                        chosen = child
                if chosen:
                    break
            if chosen:
                break
        if chosen is None:
            return None
        current = chosen
        candidates = list(fields[chosen].get("children") or [])
        extra = fields[chosen].get("additional_pointer")
        if extra:
            candidates.append(extra)
    return current


# --------------------------------------------------------------------------- builder


class _Resolved:
    """A schema node after ``$ref``/``allOf``/``anyOf`` resolution."""

    __slots__ = ("schema", "nullable", "ref", "refs", "error", "ref_description")

    def __init__(
        self,
        schema: dict[str, Any],
        nullable: bool = False,
        ref: str | None = None,
        refs: tuple[str, ...] = (),
        error: str | None = None,
        ref_description: str | None = None,
    ) -> None:
        self.schema = schema
        self.nullable = nullable
        self.ref = ref
        self.refs = refs
        self.error = error
        # Description of the referenced definition, to tell it from the property's own.
        self.ref_description = ref_description


def _ref_name(ref: str) -> str:
    return unescape_pointer_segment(ref.rsplit("/", 1)[-1])


def _singular(name: str) -> str:
    lowered = re.sub(r"[^0-9a-zA-Z_]", "_", name).lower().strip("_")
    if lowered.endswith("ies") and len(lowered) > 3:
        return lowered[:-3] + "y"
    if lowered.endswith("s") and not lowered.endswith("ss") and len(lowered) > 1:
        return lowered[:-1]
    return "key"


def _snake(name: str) -> str:
    out = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    return re.sub(r"[^0-9a-z_]", "_", out).strip("_") or "row"


def _is_role_def(ref: str | None) -> bool:
    """``RoleConfig``/``AgentRole`` yes, ``Controller`` no."""
    return bool(ref) and "role" in _snake(ref or "").split("_")


def _group_for(name: str) -> tuple[str, str]:
    for group_id, label, exact, _ in _GROUP_RULES:
        if name in exact:
            return group_id, label
    best: tuple[int, str, str] | None = None
    for group_id, label, _, prefixes in _GROUP_RULES:
        for prefix in prefixes:
            if name.startswith(prefix) and (best is None or len(prefix) > best[0]):
                best = (len(prefix), group_id, label)
    if best is not None:
        return best[1], best[2]
    return _OTHER_GROUP


def _fingerprint(resolved: _Resolved) -> str:
    if resolved.ref:
        return "ref:" + resolved.ref
    shape = {k: v for k, v in resolved.schema.items() if k not in _ANNOTATION_KEYS}
    return "inline:" + json.dumps(shape, sort_keys=True, default=str)


def _is_object_with_properties(schema: dict[str, Any]) -> bool:
    props = schema.get("properties")
    return isinstance(props, dict) and bool(props)


def _infer_type(schema: dict[str, Any]) -> str | None:
    """The type a ``type``-less node implies through its keywords, else ``None``."""
    for type_, keys in _TYPE_HINTS:
        if any(k in schema for k in keys):
            return type_
    return None


def _schema_types(schema: dict[str, Any]) -> list[str] | None:
    """JSON types one resolved node accepts; ``None`` for anything."""
    if isinstance(schema.get("x-accepts"), list):
        return list(schema["x-accepts"])
    if "x-accepts" in schema:
        return None
    values = schema.get("enum")
    if "const" in schema:
        values = [schema["const"]]
    if isinstance(values, list):
        return sorted({_value_type(v) for v in values}, key=_JSON_TYPES.index)
    type_ = schema.get("type")
    if type_ in _JSON_TYPES:
        return ["number", "integer"] if type_ == "number" else [type_]
    return None


def _accepted_types(schemas: list[dict[str, Any]]) -> list[str] | None:
    out: set[str] = set()
    for schema in schemas:
        types = _schema_types(schema)
        if types is None:
            return None
        out.update(types)
    return sorted(out, key=_JSON_TYPES.index)


def _value_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def _allows_extra_keys(schema: dict[str, Any]) -> bool:
    extra = schema.get("additionalProperties")
    return (
        extra is True
        or isinstance(extra, dict)
        or bool(schema.get("patternProperties"))
    )


class _Builder:
    def __init__(self, schema: dict[str, Any]) -> None:
        self.root_schema = schema
        self.fields: dict[str, dict[str, Any]] = {}
        self.rules: list[dict[str, Any]] = []
        self.warnings: list[dict[str, str]] = []

    # -- resolution ------------------------------------------------------------

    def warn(self, pointer: str, message: str) -> None:
        self.warnings.append({"pointer": pointer or "/", "message": message})

    def _lookup_ref(self, ref: str) -> Any:
        if not ref.startswith("#"):
            raise KeyError(f"external $ref not supported: {ref}")
        node: Any = self.root_schema
        for segment in split_pointer(ref[1:]):
            if not isinstance(node, dict) or segment not in node:
                raise KeyError(f"unresolvable $ref: {ref}")
            node = node[segment]
        return node

    def resolve(self, node: Any, refs: tuple[str, ...]) -> _Resolved:
        """Resolve refs and collapse nullable unions; ``refs`` guards against cycles."""
        if node is True:
            return _Resolved({}, refs=refs)
        if not isinstance(node, dict):
            return _Resolved({}, refs=refs, error=f"invalid schema node {node!r}")
        schema = dict(node)
        nullable = False
        ref: str | None = None
        ref_description: str | None = None
        for _ in range(_MAX_DEPTH):
            if "$ref" in schema:
                target_ref = schema.pop("$ref")
                if not isinstance(target_ref, str):
                    return _Resolved(schema, nullable, ref, refs, "invalid $ref")
                if target_ref in refs:
                    return _Resolved(
                        schema, nullable, ref, refs, f"recursive $ref {target_ref}"
                    )
                try:
                    target = self._lookup_ref(target_ref)
                except KeyError as exc:
                    return _Resolved(schema, nullable, ref, refs, str(exc.args[0]))
                if not isinstance(target, dict):
                    return _Resolved(
                        schema, nullable, ref, refs, f"invalid $ref target {target_ref}"
                    )
                refs = refs + (target_ref,)
                ref = _ref_name(target_ref)
                ref_description = target.get("description")
                # The definition's title is its class name; the property keeps its own.
                merged = {k: v for k, v in target.items() if k != "title"}
                merged.update(schema)
                schema = merged
                continue
            all_of = schema.get("allOf")
            if isinstance(all_of, list) and all_of:
                schema.pop("allOf")
                combined: dict[str, Any] = {}
                parts = [self.resolve(part, refs) for part in all_of]
                for part in parts:
                    if part.error:
                        return _Resolved(schema, nullable, ref, refs, part.error)
                    if part.ref:
                        ref, ref_description = part.ref, part.ref_description
                    for key, value in part.schema.items():
                        if key == "properties" and isinstance(
                            combined.get("properties"), dict
                        ):
                            combined["properties"] = {
                                **combined["properties"],
                                **value,
                            }
                        elif key == "required" and isinstance(
                            combined.get("required"), list
                        ):
                            combined["required"] = combined["required"] + list(value)
                        else:
                            combined[key] = value
                # allOf is an intersection: null is allowed only if every part allows it.
                nullable = nullable or all(part.nullable for part in parts)
                refs = tuple(dict.fromkeys(r for part in parts for r in part.refs))
                combined.update(schema)
                schema = combined
                continue
            union_key = next(
                (k for k in ("anyOf", "oneOf") if isinstance(schema.get(k), list)),
                None,
            )
            if union_key is not None:
                variants = schema.pop(union_key)
                outer = schema
                kept: list[_Resolved] = []
                for variant in variants:
                    if isinstance(variant, dict) and variant.get("type") == "null":
                        nullable = True
                        continue
                    resolved = self.resolve(variant, refs)
                    if resolved.error:
                        return _Resolved(outer, nullable, ref, refs, resolved.error)
                    nullable = nullable or resolved.nullable
                    if resolved.schema.get("type") == "null":
                        nullable = True
                        continue
                    if resolved.schema not in [k.schema for k in kept]:
                        kept.append(resolved)
                if not kept:
                    return _Resolved({**outer, "type": "null"}, True, ref, refs)
                chosen = self._pick_variant(kept)
                if chosen is None:
                    schema = {
                        **outer,
                        "type": "json",
                        "x-variants": len(kept),
                        "x-accepts": _accepted_types([k.schema for k in kept]),
                    }
                    break
                if chosen.ref:
                    ref, ref_description = chosen.ref, chosen.ref_description
                refs = chosen.refs
                schema = {**chosen.schema, **outer}
                continue
            break
        else:
            return _Resolved(schema, nullable, ref, refs, "schema nesting too deep")

        type_ = schema.get("type")
        if isinstance(type_, list):
            non_null = [t for t in type_ if t != "null"]
            nullable = nullable or len(non_null) != len(type_)
            if len(non_null) == 1:
                schema["type"] = non_null[0]
            elif set(non_null) <= {"integer", "number"} and non_null:
                schema["type"] = "number"
            elif "boolean" in non_null and set(non_null) <= {"boolean", "string"}:
                schema["type"] = "boolean"
            else:
                schema["type"] = "json"
                schema["x-accepts"] = (
                    sorted(
                        {t for t in non_null if t in _JSON_TYPES}, key=_JSON_TYPES.index
                    )
                    or None
                )
        if isinstance(schema.get("enum"), list) and None in schema["enum"]:
            nullable = True
            schema["enum"] = [v for v in schema["enum"] if v is not None]
            if not schema["enum"]:
                # ``enum: [null]``: only null; edited as JSON.
                schema.pop("enum")
                schema["type"] = "null"
        if "type" not in schema and "enum" not in schema and "const" not in schema:
            inferred = _infer_type(schema)
            if inferred:
                schema["type"] = inferred
        return _Resolved(schema, nullable, ref, refs, None, ref_description)

    @staticmethod
    def _pick_variant(kept: list[_Resolved]) -> _Resolved | None:
        """Choose one variant of a multi-type union, or ``None`` for raw JSON."""
        if len(kept) == 1:
            return kept[0]
        types = [k.schema.get("type") for k in kept]
        # Booleans accept strings on the service; the form always sends real booleans.
        if "boolean" in types and all(t in ("boolean", "string") for t in types):
            return kept[types.index("boolean")]
        if all(t in ("integer", "number") for t in types):
            return kept[types.index("number")] if "number" in types else kept[0]
        return None

    # -- walking ---------------------------------------------------------------

    def build(self) -> dict[str, Any]:
        root = self.resolve(self.root_schema, ())
        if root.error:
            self.warn("", root.error)
        root_children = self._walk_properties(
            root.schema, [], None, None, root.refs, depth=0
        )
        groups: dict[str, dict[str, Any]] = {}
        for pointer in root_children:
            group_id = self.fields[pointer]["group"]
            label = next(
                (g[1] for g in _GROUP_RULES if g[0] == group_id), _OTHER_GROUP[1]
            )
            groups.setdefault(
                group_id, {"id": group_id, "label": label, "pointers": []}
            )
            groups[group_id]["pointers"].append(pointer)
        order = [g[0] for g in _GROUP_RULES] + [_OTHER_GROUP[0]]
        return {
            "descriptor_version": DESCRIPTOR_VERSION,
            "title": self.root_schema.get("title"),
            "root": root_children,
            "fields": self.fields,
            "groups": [groups[g] for g in order if g in groups],
            "rules": self.rules,
            "warnings": self.warnings,
        }

    def _walk_properties(
        self,
        schema: dict[str, Any],
        path: list[str],
        parent: str | None,
        group: tuple[str, str] | None,
        refs: tuple[str, ...],
        depth: int,
    ) -> list[str]:
        props = schema.get("properties")
        if not isinstance(props, dict):
            return []
        required = set(schema.get("required") or [])

        resolved: dict[str, _Resolved] = {}
        for name, node in props.items():
            if not isinstance(node, (dict, bool)):
                self.warn(
                    json_pointer(path + [name]), f"ignored invalid schema {node!r}"
                )
                continue
            resolved[name] = self.resolve(node, refs)

        tables = self._detect_role_tables(resolved)
        table_of = {name: key for key, names in tables.items() for name in names}
        used_params = {p for p in (_template_param(s) for s in path) if p}

        children: list[str] = []
        emitted_tables: set[str] = set()
        for name, res in resolved.items():
            child_group = group or _group_for(name)
            if name in table_of:
                key = table_of[name]
                if key in emitted_tables:
                    continue
                emitted_tables.add(key)
                children.append(
                    self._emit_role_table(
                        [(n, resolved[n], n in required) for n in tables[key]],
                        path,
                        parent,
                        child_group,
                        used_params,
                        depth,
                    )
                )
                continue
            children.append(
                self._emit(
                    name, res, path, parent, child_group, name in required, depth + 1
                )
            )
        self._link_endpoint_refs(children)
        return children

    def _detect_role_tables(
        self, resolved: dict[str, _Resolved]
    ) -> dict[str, list[str]]:
        """Group sibling properties sharing one object definition (e.g. ``RoleConfig``)."""
        buckets: dict[str, list[str]] = {}
        for name, res in resolved.items():
            if res.error or not _is_object_with_properties(res.schema):
                continue
            buckets.setdefault(_fingerprint(res), []).append(name)
        tables = {}
        for key, names in buckets.items():
            if len(names) >= 2 or _is_role_def(resolved[names[0]].ref):
                tables[key] = names
        return tables

    def _base_entry(
        self,
        name: str,
        res: _Resolved,
        path: list[str],
        parent: str | None,
        group: tuple[str, str],
        required: bool,
    ) -> dict[str, Any]:
        schema = res.schema
        pointer = json_pointer(path)
        default = schema.get("default")
        return {
            "pointer": pointer,
            "name": name,
            "label": schema.get("title") or name,
            "description": schema.get("description"),
            "path": list(path),
            "parent": parent,
            "params": [p for p in (_template_param(s) for s in path) if p],
            "kind": "field",
            "type": "json",
            "widget": "json",
            "group": group[0],
            "required": required,
            "nullable": res.nullable,
            "has_default": default is not None,
            "default": deepcopy(default),
            "sweepable": False,
            "secret": False,
            "enum": None,
            "value_type": None,
            "bounds": {k: schema[k] for k in _BOUND_KEYS if k in schema},
            "pattern": schema.get("pattern"),
            "format": schema.get("format"),
            "quirks": [],
            "accepts": None,
            "item_type": None,
        }

    def _emit(
        self,
        name: str,
        res: _Resolved,
        parent_path: list[str],
        parent: str | None,
        group: tuple[str, str],
        required: bool,
        depth: int,
        path: list[str] | None = None,
    ) -> str:
        path = path if path is not None else parent_path + [name]
        entry = self._base_entry(name, res, path, parent, group, required)
        pointer = entry["pointer"]
        self.fields[pointer] = entry
        schema = res.schema
        if res.error:
            self.warn(pointer, res.error)
            return pointer
        if depth > _MAX_DEPTH:
            self.warn(pointer, "schema nesting too deep")
            return pointer

        type_ = schema.get("type")
        if "const" in schema and "enum" not in schema:
            schema = {**schema, "enum": [schema["const"]]}
        if isinstance(schema.get("enum"), list) and not schema["enum"]:
            self.warn(pointer, "empty enum; edited as JSON")
        elif isinstance(schema.get("enum"), list):
            entry.update(
                type="enum",
                widget="select",
                enum=list(schema["enum"]),
                value_type=type_ if isinstance(type_, str) else None,
            )
        elif type_ in ("boolean", "integer", "number", "string"):
            entry["type"] = type_
            entry["widget"] = self._scalar_widget(name, type_, schema)
        elif type_ == "array":
            entry["type"] = "array"
            entry["item_type"] = self._item_type(schema, res.refs)
        elif (
            type_ == "object"
            or "properties" in schema
            or "additionalProperties" in schema
        ):
            if _is_object_with_properties(schema):
                entry.update(type="object", kind="object", widget="group")
                entry["children"] = self._walk_properties(
                    schema, path, pointer, group, res.refs, depth
                )
                if _allows_extra_keys(schema):
                    entry["additional_pointer"] = self._emit_additional(
                        entry, schema, res.refs, group, depth
                    )
            elif (
                isinstance(schema.get("additionalProperties"), dict)
                and schema["additionalProperties"]
            ):
                self._fill_collection(entry, schema, res.refs, group, depth)
            else:
                entry["type"] = "object"

        if entry["type"] == "boolean":
            entry["quirks"].append("real_boolean")
        if entry["type"] == "json":
            entry["accepts"] = _schema_types(schema)
        if (
            _SECRET_NAME.match(name)
            or schema.get("writeOnly")
            or schema.get("format") == "password"
        ):
            if entry["type"] == "string":
                entry.update(secret=True, widget="secret")
        if len(path) == 1 and name in _FIELD_QUIRKS:
            quirk = _FIELD_QUIRKS[name]
            entry.update(type=quirk["type"], widget=quirk["widget"], enum=None)
            entry["hints"] = deepcopy(quirk["hints"])
            entry["quirks"].append(quirk["quirk"])
        entry["sweepable"] = (
            entry["kind"] == "field"
            and entry["type"] in _SCALAR_TYPES
            and not entry["secret"]
        )
        return pointer

    @staticmethod
    def _scalar_widget(name: str, type_: str, schema: dict[str, Any]) -> str:
        if type_ == "boolean":
            return "toggle"
        if type_ in ("integer", "number"):
            lower = "minimum" in schema or "exclusiveMinimum" in schema
            upper = "maximum" in schema or "exclusiveMaximum" in schema
            return "number-range" if lower and upper else "number"
        if schema.get("format") == "password":
            return "secret"
        if _MODEL_NAME.match(name):
            return "model-name"
        if _URL_NAME.match(name) or schema.get("format") in ("uri", "url"):
            return "url"
        return "text"

    def _item_type(self, schema: dict[str, Any], refs: tuple[str, ...]) -> str | None:
        items = schema.get("items")
        if not isinstance(items, dict):
            return None
        resolved = self.resolve(items, refs)
        if resolved.error:
            return None
        if isinstance(resolved.schema.get("enum"), list):
            return "enum"
        type_ = resolved.schema.get("type")
        return type_ if isinstance(type_, str) else None

    def _emit_additional(
        self,
        entry: dict[str, Any],
        schema: dict[str, Any],
        refs: tuple[str, ...],
        group: tuple[str, str],
        depth: int,
    ) -> str:
        """Templated entry for the extra keys of an object that also has properties."""
        param = "key"
        taken = set(entry["params"])
        while param in taken:
            param += "_key"
        extra = schema.get("additionalProperties")
        node = extra if isinstance(extra, dict) else True
        item = self.resolve(node, refs)
        return self._emit(
            param,
            item,
            entry["path"],
            entry["pointer"],
            group,
            False,
            depth + 1,
            entry["path"] + ["{" + param + "}"],
        )

    def _fill_collection(
        self,
        entry: dict[str, Any],
        schema: dict[str, Any],
        refs: tuple[str, ...],
        group: tuple[str, str],
        depth: int,
    ) -> None:
        name = entry["name"]
        path = entry["path"]
        param = _singular(name)
        taken = set(entry["params"])
        while param in taken:
            param += "_key"
        item_path = path + ["{" + param + "}"]
        item = self.resolve(schema["additionalProperties"], refs)
        item_pointer = self._emit(
            param, item, path, entry["pointer"], group, True, depth + 1, item_path
        )
        required_keys = list(schema.get("required") or [])
        for key in _COLLECTION_REQUIRED_KEYS.get(name, ()):
            if key not in required_keys:
                required_keys.append(key)
        min_items = max(int(schema.get("minProperties") or 0), len(required_keys))
        entry.update(
            kind="collection",
            type="object",
            widget="collection",
            key_param=param,
            item_pointer=item_pointer,
            children=[item_pointer],
            required_keys=required_keys,
            min_items=min_items,
            max_items=schema.get("maxProperties"),
            key_pattern=(schema.get("propertyNames") or {}).get("pattern"),
        )
        if required_keys:
            self.rules.append(
                {
                    "rule": "required_keys",
                    "pointer": entry["pointer"],
                    "keys": required_keys,
                }
            )
        if min_items:
            self.rules.append(
                {"rule": "min_items", "pointer": entry["pointer"], "min": min_items}
            )

    def _emit_role_table(
        self,
        members: list[tuple[str, _Resolved, bool]],
        parent_path: list[str],
        parent: str | None,
        group: tuple[str, str],
        used_params: set[str],
        depth: int,
    ) -> str:
        first = members[0][1]
        ref = first.ref
        param = "role" if not ref or _is_role_def(ref) else _snake(ref)
        while param in used_params:
            param += "_key"
        used_params.add(param)
        path = parent_path + ["{" + param + "}"]
        entry = self._base_entry(param, first, path, parent, group, False)
        pointer = entry["pointer"]
        entry.update(
            kind="role_table",
            type="object",
            widget="role-table",
            label=ref or param,
            description=first.ref_description,
            nullable=all(res.nullable for _, res, _ in members),
            has_default=False,
            default=None,
            row_param=param,
            ref=ref,
            rows=[
                {
                    "key": name,
                    "pointer": json_pointer(parent_path + [name]),
                    "label": res.schema.get("title") or name,
                    # Only a role's own description; the shared one sits on the table.
                    "description": (
                        None
                        if res.schema.get("description") == res.ref_description
                        else res.schema.get("description")
                    ),
                    "required": req,
                    "nullable": res.nullable,
                }
                for name, res, req in members
            ],
        )
        self.fields[pointer] = entry
        columns = self._walk_properties(
            first.schema, path, pointer, group, first.refs, depth + 1
        )
        entry["columns"] = columns
        entry["children"] = columns
        return pointer

    def _link_endpoint_refs(self, siblings: list[str]) -> None:
        """Mark role columns naming a sibling collection (``endpoint`` → ``endpoints``)."""
        collections = {
            self.fields[p]["name"]: p
            for p in siblings
            if self.fields[p]["kind"] == "collection"
        }
        if not collections:
            return
        for pointer in siblings:
            table = self.fields[pointer]
            if table["kind"] != "role_table":
                continue
            for column in table["columns"]:
                field = self.fields[column]
                if field["kind"] != "field" or field["type"] != "string":
                    continue
                target = collections.get(field["name"] + "s") or collections.get(
                    field["name"]
                )
                if target is None:
                    continue
                field["widget"] = "endpoint-ref"
                field["ref_collection"] = target
                field["quirks"].append("endpoint_ref")
                self.rules.append(
                    {"rule": "endpoint_ref", "pointer": column, "collection": target}
                )


def build_form_descriptor(schema: dict[str, Any]) -> dict[str, Any]:
    """Build the form descriptor for an ``env_overrides`` JSON Schema (see module doc)."""
    if not isinstance(schema, dict):
        raise ValueError("env_overrides schema must be a JSON object")
    return _Builder(schema).build()
