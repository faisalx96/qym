from __future__ import annotations

import copy
import hashlib
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.db.base import Base
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalModelSlot,
    EvalModelSlotKind,
    EvalModelSlotStatus,
    Project,
    User,
)
from qym_platform.services.eval_model_slots import (
    DEFAULT_SLOT_RULES,
    SlotCollectionRule,
    SlotFieldRule,
    SlotRules,
    SlotValidationError,
    confirm_model_slots,
    detect_model_slots,
    list_model_slots,
    missing_pointers,
    propose_endpoint_slot,
    slot_to_dict,
    slots_need_confirmation,
    sync_model_slots,
    validate_slots,
)
from qym_platform.services.eval_schema_form import build_form_descriptor

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
EP = "/LLM_OVERRIDES/endpoints"

CONFIRMED = EvalModelSlotStatus.CONFIRMED
PROPOSED = EvalModelSlotStatus.PROPOSED
STALE = EvalModelSlotStatus.STALE


def _nullable(type_: str) -> dict:
    return {"anyOf": [{"type": type_}, {"type": "null"}], "default": None}


@pytest.fixture()
def schema() -> dict:
    return json.loads(FIXTURE.read_text())


def _by_key(proposals):
    return {p.slot_key: p for p in proposals}


# --------------------------------------------------------------------------- detection


def test_structural_detection_proposes_required_primary(schema):
    slots = detect_model_slots(build_form_descriptor(schema))
    assert [s.slot_key for s in slots] == ["endpoint:primary", "flat:VIZ_LLM"]
    primary = slots[0]
    assert primary.kind == EvalModelSlotKind.ENDPOINT
    assert primary.required is True
    assert primary.label == "Primary model"
    assert primary.field_map == {
        "model": f"{EP}/primary/model",
        "base_url": f"{EP}/primary/base_url",
        "api_key": f"{EP}/primary/api_key",
    }
    assert primary.transport_fields == {
        name: f"{EP}/primary/{name}"
        for name in (
            "timeout",
            "max_attempts",
            "max_connections",
            "max_keepalive",
            "connect_timeout",
        )
    }
    assert primary.to_dict()["kind"] == "endpoint"


def test_extra_endpoints_are_optional_slots(schema):
    descriptor = build_form_descriptor(schema)
    slots = _by_key(detect_model_slots(descriptor, extra_endpoints=["fast", "primary"]))
    assert list(slots) == ["endpoint:primary", "endpoint:fast", "flat:VIZ_LLM"]
    fast = slots["endpoint:fast"]
    assert fast.required is False
    assert fast.field_map["model"] == f"{EP}/fast/model"
    assert fast.label == "Fast model"

    added = propose_endpoint_slot(descriptor, "a/b")
    assert added.slot_key == "endpoint:a/b"
    assert added.field_map["model"] == f"{EP}/a~1b/model"
    assert missing_pointers(descriptor, added.field_map, added.transport_fields) == []


def test_primary_is_required_even_if_schema_does_not_say_so(schema):
    schema["$defs"]["LlmOverrides"]["properties"]["endpoints"].pop("required", None)
    descriptor = build_form_descriptor(schema)
    primary = _by_key(detect_model_slots(descriptor))["endpoint:primary"]
    assert primary.required is True


def test_name_based_flat_detection(schema):
    props = schema["properties"]
    props["JUDGE_LLM_MODEL_NAME"] = _nullable("string")
    props["JUDGE_LLM_BASE_URL"] = _nullable("string")
    props["JUDGE_LLM_URL"] = _nullable("string")  # lower priority than _BASE_URL
    props["JUDGE_LLM_API_KEY"] = _nullable("string")
    props["JUDGE_LLM_MAX_ATTEMPTS"] = _nullable("integer")
    props["EMBED_ENDPOINT"] = _nullable("string")  # no model -> not a slot
    props["EMBED_KEY"] = _nullable("string")
    props["CACHE_MODEL"] = _nullable("boolean")  # not a string -> ignored
    slots = _by_key(detect_model_slots(build_form_descriptor(schema)))

    assert set(slots) == {"endpoint:primary", "flat:VIZ_LLM", "flat:JUDGE_LLM"}
    viz = slots["flat:VIZ_LLM"]
    assert viz.kind == EvalModelSlotKind.FLAT
    assert viz.required is False
    assert viz.label == "VIZ LLM model"
    # A model-only group is a valid slot.
    assert viz.field_map == {
        "model": "/VIZ_LLM_MODEL",
        "base_url": None,
        "api_key": None,
    }
    assert viz.transport_fields == {"timeout": "/VIZ_LLM_TIMEOUT"}

    judge = slots["flat:JUDGE_LLM"]
    assert judge.field_map == {
        "model": "/JUDGE_LLM_MODEL_NAME",
        "base_url": "/JUDGE_LLM_BASE_URL",
        "api_key": "/JUDGE_LLM_API_KEY",
    }
    assert judge.transport_fields == {"max_attempts": "/JUDGE_LLM_MAX_ATTEMPTS"}


def test_rules_table_is_extensible(schema):
    schema["properties"]["VIZ_LLM_DEPLOYMENT"] = _nullable("string")
    schema["properties"]["VIZ_LLM_SECRET"] = _nullable("string")
    rules = SlotRules(
        fields=(
            SlotFieldRule("model", ("model",), ("_DEPLOYMENT",)),
            SlotFieldRule("api_key", ("api_key",), ("_SECRET",)),
        ),
        transport=(),
        collections=(SlotCollectionRule("endpoints", "ep", ("primary", "fast")),),
        flat_prefix="env",
    )
    slots = _by_key(detect_model_slots(build_form_descriptor(schema), rules=rules))
    assert set(slots) == {"ep:primary", "ep:fast", "env:VIZ_LLM"}
    assert slots["ep:fast"].required is True
    assert slots["ep:primary"].field_map == {
        "model": f"{EP}/primary/model",
        "api_key": f"{EP}/primary/api_key",
    }
    assert slots["env:VIZ_LLM"].field_map == {
        "model": "/VIZ_LLM_DEPLOYMENT",
        "api_key": "/VIZ_LLM_SECRET",
    }
    assert DEFAULT_SLOT_RULES.kind_for_prefix("endpoint") == EvalModelSlotKind.ENDPOINT


def test_schema_without_llm_fields_has_no_slots():
    descriptor = build_form_descriptor(
        {"type": "object", "properties": {"SQL_RESULT_LIMIT": {"type": "integer"}}}
    )
    assert detect_model_slots(descriptor) == []


# --------------------------------------------------------------------------- validation


def _payload(descriptor, *extra):
    return [p.to_dict() for p in detect_model_slots(descriptor, extra_endpoints=extra)]


def test_validate_slots_errors(schema):
    descriptor = build_form_descriptor(schema)
    ok = validate_slots(descriptor, _payload(descriptor))
    assert [s.slot_key for s in ok] == ["endpoint:primary", "flat:VIZ_LLM"]

    def errors(slots):
        with pytest.raises(SlotValidationError) as exc:
            validate_slots(descriptor, slots)
        return [e["message"] for e in exc.value.errors]

    viz = {"slot_key": "flat:VIZ_LLM", "field_map": {"model": "/VIZ_LLM_MODEL"}}
    assert any("required" in m for m in errors([viz]))

    primary = _payload(descriptor)[0]
    bad = [
        primary,
        {"slot_key": "nope:x", "field_map": {"model": "/VIZ_LLM_MODEL"}},
        {"slot_key": "flat:A", "field_map": {"model": "/MISSING"}},
        {"slot_key": "flat:B", "field_map": {"model": "/VIZ_LLM_ENABLED"}},
        {"slot_key": "flat:C", "field_map": {"model": f"{EP}/{{endpoint}}/model"}},
        {"slot_key": "flat:D", "field_map": {"base_url": "/VIZ_LLM_MODEL"}},
        {"slot_key": "flat:E", "field_map": {"model": "/VIZ_LLM_MODEL", "x": None}},
        {"slot_key": "flat:F", "field_map": {"model": f"{EP}/primary/model"}},
        {"slot_key": "endpoint:fast", "field_map": {"model": "/VIZ_LLM_MODEL"}},
        {"slot_key": "flat:G", "kind": "endpoint", "field_map": {}},
    ]
    messages = errors(bad)
    assert any("invalid slot_key" in m for m in messages)
    assert any("'/MISSING' is not a field" in m for m in messages)
    assert any("cannot hold a model" in m for m in messages)
    assert any("{endpoint}" in m for m in messages)
    assert any("needs a model field" in m for m in messages)
    assert any("unknown field role 'x'" in m for m in messages)
    assert any("used by both endpoint:primary and flat:F" in m for m in messages)
    assert any("outside endpoint 'fast'" in m for m in messages)
    assert any("must have kind 'flat'" in m for m in messages)

    twice = {"model": "/VIZ_LLM_MODEL", "base_url": "/VIZ_LLM_MODEL"}
    messages = errors([primary, {"slot_key": "flat:VIZ_LLM", "field_map": twice}])
    assert messages == ["slot flat:VIZ_LLM uses the same field twice"]


# --------------------------------------------------------------------------- persistence


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def env(db):
    user = User(email="owner@example.com")
    db.add(user)
    db.flush()
    project = Project(name="P", slug="p", created_by_user_id=user.id)
    db.add(project)
    db.flush()
    environment = EvalEnvironment(
        project_id=project.id, name="staging", base_url="https://eval.example"
    )
    db.add(environment)
    db.flush()
    return user, environment


_clock = [datetime(2026, 1, 1)]


def _add_schema(db, environment, schema_json, *, cache_descriptor=True):
    _clock[0] += timedelta(minutes=1)
    canonical = json.dumps(schema_json, sort_keys=True, separators=(",", ":"))
    row = EvalEnvironmentSchema(
        environment_id=environment.id,
        schema_hash=hashlib.sha256(canonical.encode()).hexdigest(),
        schema_json=schema_json,
        form_descriptor=(
            build_form_descriptor(schema_json) if cache_descriptor else None
        ),
        first_seen_at=_clock[0],
    )
    db.add(row)
    db.flush()
    return row


def _refresh(db, environment, schema_json):
    """What the schema refresh endpoint does: new row, sync, move the pointer."""
    row = _add_schema(db, environment, schema_json)
    slots = sync_model_slots(db, environment, row)
    environment.current_schema_id = row.id
    db.commit()
    return row, slots


def _state(slots):
    return {s.slot_key: s.status for s in slots}


def test_first_sync_proposes_and_is_idempotent(db, env, schema):
    _, environment = env
    row, slots = _refresh(db, environment, schema)
    assert _state(slots) == {"endpoint:primary": PROPOSED, "flat:VIZ_LLM": PROPOSED}
    assert slots_need_confirmation(slots)
    primary = slot_to_dict(slots[0])
    assert primary["required"] is True
    assert primary["kind"] == "endpoint" and primary["status"] == "proposed"

    again = sync_model_slots(db, environment, row)
    assert [s.id for s in again] == [s.id for s in slots]


def test_sync_without_cached_descriptor(db, env, schema):
    _, environment = env
    row = _add_schema(db, environment, schema, cache_descriptor=False)
    slots = sync_model_slots(db, environment, row)
    assert _state(slots) == {"endpoint:primary": PROPOSED, "flat:VIZ_LLM": PROPOSED}


def test_confirmation_persists(db, env, schema):
    user, environment = env
    row, _ = _refresh(db, environment, schema)
    descriptor = build_form_descriptor(schema)
    payload = _payload(descriptor, "fast")
    payload[0]["label"] = "Main model"
    payload[1]["field_map"]["api_key"] = None
    payload[1]["transport_fields"] = {}
    payload = [p for p in payload if p["slot_key"] != "flat:VIZ_LLM"]  # removed

    confirmed = confirm_model_slots(db, environment, row, payload, user_id=user.id)
    db.commit()
    db.expire_all()

    stored = list_model_slots(db, row.id)
    assert [s.slot_key for s in stored] == ["endpoint:primary", "endpoint:fast"]
    assert [s.id for s in stored] == [s.id for s in confirmed]
    assert all(s.status == CONFIRMED for s in stored)
    assert all(s.confirmed_by_user_id == user.id and s.confirmed_at for s in stored)
    assert not slots_need_confirmation(stored)
    assert stored[0].label == "Main model"
    assert stored[0].required is True and stored[1].required is False
    assert stored[1].field_map["model"] == f"{EP}/fast/model"

    # Re-confirming an unchanged slot keeps who/when; an edited one is re-stamped.
    first_at = stored[0].confirmed_at
    payload[1]["label"] = "Fast lane"
    confirm_model_slots(db, environment, row, payload, user_id=None)
    db.commit()
    db.expire_all()
    stored = list_model_slots(db, row.id)
    assert (
        stored[0].confirmed_at == first_at and stored[0].confirmed_by_user_id == user.id
    )
    assert stored[1].label == "Fast lane" and stored[1].confirmed_by_user_id is None

    # Primary cannot be removed; nothing changes on a failed confirmation.
    with pytest.raises(SlotValidationError):
        confirm_model_slots(db, environment, row, payload[1:], user_id=user.id)
    assert len(list_model_slots(db, row.id)) == 2


def test_confirm_rejects_foreign_schema(db, env, schema):
    user, environment = env
    other = EvalEnvironment(
        project_id=environment.project_id, name="prod", base_url="https://prod.example"
    )
    db.add(other)
    db.flush()
    row = _add_schema(db, other, schema)
    with pytest.raises(ValueError):
        confirm_model_slots(db, environment, row, [], user_id=user.id)


def test_drift_carries_confirmed_marks_stale_and_proposes_new(db, env, schema):
    user, environment = env
    v1, _ = _refresh(db, environment, schema)
    descriptor = build_form_descriptor(schema)
    confirm_model_slots(
        db, environment, v1, _payload(descriptor, "fast"), user_id=user.id
    )
    db.commit()

    v2_json = copy.deepcopy(schema)
    props = v2_json["properties"]
    del props["VIZ_LLM_MODEL"]
    del props["VIZ_LLM_TIMEOUT"]
    props["JUDGE_MODEL"] = _nullable("string")
    props["JUDGE_API_KEY"] = _nullable("string")
    endpoint_props = v2_json["$defs"]["EndpointConfig"]["properties"]
    del endpoint_props["max_keepalive"]
    endpoint_props["read_timeout"] = _nullable("number")
    v2, slots = _refresh(db, environment, v2_json)

    assert _state(slots) == {
        "endpoint:primary": CONFIRMED,
        "endpoint:fast": CONFIRMED,
        "flat:VIZ_LLM": STALE,
        "flat:JUDGE": PROPOSED,
    }
    assert slots_need_confirmation(slots)
    by_key = {s.slot_key: s for s in slots}
    primary = by_key["endpoint:primary"]
    assert primary.schema_id == v2.id and primary.required
    assert primary.confirmed_by_user_id == user.id
    assert "max_keepalive" not in primary.transport_fields
    assert primary.transport_fields["timeout"] == f"{EP}/primary/timeout"
    assert by_key["flat:VIZ_LLM"].field_map["model"] == "/VIZ_LLM_MODEL"
    assert by_key["flat:JUDGE"].field_map == {
        "model": "/JUDGE_MODEL",
        "base_url": None,
        "api_key": "/JUDGE_API_KEY",
    }
    # History: v1 slots are untouched.
    assert _state(list_model_slots(db, v1.id))["flat:VIZ_LLM"] == CONFIRMED

    # Reverting the schema brings the stale slot back as confirmed.
    v3_json = copy.deepcopy(schema)
    v3_json["title"] = "EnvOverrides v3"
    _, slots = _refresh(db, environment, v3_json)
    assert _state(slots) == {
        "endpoint:primary": CONFIRMED,
        "endpoint:fast": CONFIRMED,
        "flat:VIZ_LLM": CONFIRMED,
    }
    assert {s.slot_key: s for s in slots}["flat:VIZ_LLM"].transport_fields == {
        "timeout": "/VIZ_LLM_TIMEOUT"
    }


def test_drift_does_not_repropose_removed_slots(db, env, schema):
    user, environment = env
    v1, _ = _refresh(db, environment, schema)
    primary_only = _payload(build_form_descriptor(schema))[:1]
    confirm_model_slots(db, environment, v1, primary_only, user_id=user.id)
    db.commit()

    v2_json = copy.deepcopy(schema)
    v2_json["properties"]["SQL_TIMEOUT"] = _nullable("number")
    _, slots = _refresh(db, environment, v2_json)
    assert _state(slots) == {"endpoint:primary": CONFIRMED}
    assert not slots_need_confirmation(slots)


def test_drift_replaces_stale_slot_with_new_candidate_of_same_key(db, env, schema):
    user, environment = env
    schema["properties"]["VIZ_LLM_API_KEY"] = _nullable("string")
    v1, _ = _refresh(db, environment, schema)
    payload = _payload(build_form_descriptor(schema))
    payload[1]["label"] = "Charts"
    confirm_model_slots(db, environment, v1, payload, user_id=user.id)
    db.commit()

    v2_json = copy.deepcopy(schema)
    del v2_json["properties"]["VIZ_LLM_API_KEY"]
    _, slots = _refresh(db, environment, v2_json)
    viz = {s.slot_key: s for s in slots}["flat:VIZ_LLM"]
    assert viz.status == PROPOSED
    assert viz.label == "Charts"
    assert viz.field_map == {
        "model": "/VIZ_LLM_MODEL",
        "base_url": None,
        "api_key": None,
    }
    assert viz.confirmed_at is None


def test_drift_stale_primary_is_reproposed(db, env, schema):
    user, environment = env
    v1, _ = _refresh(db, environment, schema)
    confirm_model_slots(
        db, environment, v1, _payload(build_form_descriptor(schema)), user_id=user.id
    )
    db.commit()

    v2_json = copy.deepcopy(schema)
    endpoint = v2_json["$defs"]["EndpointConfig"]
    endpoint["properties"]["model_name"] = endpoint["properties"].pop("model")
    endpoint["required"] = ["model_name"]
    _, slots = _refresh(db, environment, v2_json)
    primary = {s.slot_key: s for s in slots}["endpoint:primary"]
    assert primary.status == PROPOSED and primary.required
    assert primary.field_map["model"] == f"{EP}/primary/model_name"


def test_drift_carries_unconfirmed_proposals(db, env, schema):
    _, environment = env
    _refresh(db, environment, schema)
    v2_json = copy.deepcopy(schema)
    v2_json["title"] = "EnvOverrides v2"
    _, slots = _refresh(db, environment, v2_json)
    assert _state(slots) == {"endpoint:primary": PROPOSED, "flat:VIZ_LLM": PROPOSED}
    assert db.query(EvalModelSlot).count() == 4
