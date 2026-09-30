"""Multi-environment launches (plan §6, issue #33): fields missing from one env.

The launch form renders the union of the selected environments' descriptors. A field
set in the spec but absent from environment B's schema is a per-environment
``not_in_environment`` error for B, reported by the dry run (the form's live preview)
and refused with a 422 by a real launch before any row is written, never passed on to
the Evaluation Service.
"""

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
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalModelSlotStatus,
)
from qym_platform.services.eval_config import (
    NOT_IN_ENVIRONMENT,
    validate_config_document,
)
from qym_platform.services.eval_model_slots import sync_model_slots
from test_experiments_api import (  # noqa: F401  (fixtures)
    FIXTURE,
    P1,
    _create,
    _created,
    _jobs,
    _spec,
    client,
    encryption,
    session_factory,
)

THR = "/env_overrides/MILVUS_SEARCH_THRESHOLD"
AUDIT = "/env_overrides/LLM_OVERRIDES/audit"


def _full_schema() -> dict:
    return json.loads(FIXTURE.read_text())


def _schema_without(*names: str, roles: tuple[str, ...] = ()) -> dict:
    schema = _full_schema()
    for name in names:
        del schema["properties"][name]
    for role in roles:
        del schema["$defs"]["LlmOverrides"]["properties"][role]
    return schema


def _open(schema: dict) -> dict:
    """The same schema without any ``additionalProperties: false`` (extra="ignore")."""

    def walk(node):
        if isinstance(node, dict):
            if node.get("additionalProperties") is False:
                del node["additionalProperties"]
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    schema = copy.deepcopy(schema)
    walk(schema)
    return schema


def _add_env(session_factory, name: str, schema_json: dict) -> EvalEnvironment:
    with session_factory() as s:
        env = EvalEnvironment(
            project_id=P1,
            name=name,
            base_url=f"https://{name}.example.com",
            allow_connection_keys=True,
        )
        s.add(env)
        s.flush()
        schema = EvalEnvironmentSchema(
            environment_id=env.id, schema_hash="h-" + name, schema_json=schema_json
        )
        s.add(schema)
        s.flush()
        for slot in sync_model_slots(s, env, schema):
            slot.status = EvalModelSlotStatus.CONFIRMED
        env.current_schema_id = schema.id
        s.commit()
        s.refresh(env)
        s.expunge(env)
        return env


@pytest.fixture()
def envs(session_factory):
    """Env "alpha" has every field; "beta" lacks MILVUS_SEARCH_THRESHOLD and ``audit``."""
    alpha = _add_env(session_factory, "alpha", _full_schema())
    beta = _add_env(
        session_factory,
        "beta",
        _schema_without("MILVUS_SEARCH_THRESHOLD", roles=("audit",)),
    )
    return alpha, beta


def _counts(session_factory) -> tuple[int, int]:
    with session_factory() as s:
        return s.query(EvalExperiment).count(), s.query(EvalExperimentJob).count()


def _doc(**env_overrides) -> dict:
    return {
        "evaluator": {"dataset": "d", "config": {"samples": 2}},
        "slot_bindings": {},
        "env_overrides": {
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"model": "gpt-4o"}},
                "main": {"endpoint": "primary"},
            },
            **env_overrides,
        },
    }


def _only(errors: list, rule: str) -> list:
    return [e for e in errors if e["rule"] == rule]


# --------------------------------------------------------------------------- units


def test_missing_field_is_not_in_environment_and_names_it():
    schema = _schema_without("MILVUS_SEARCH_THRESHOLD")
    result = validate_config_document(
        _doc(MILVUS_SEARCH_THRESHOLD=0.7), env_schema=schema, environment_name="beta"
    )
    [error] = result.errors
    assert error["rule"] == NOT_IN_ENVIRONMENT
    assert error["pointer"] == THR
    assert error["section"] == "env_overrides"
    assert error["form_pointer"] == "/env_overrides"
    assert (
        error["message"] == "'MILVUS_SEARCH_THRESHOLD' is not in environment \"beta\""
    )
    assert result.body is None

    # Without a name the message still says where the key is missing.
    [unnamed] = validate_config_document(
        _doc(MILVUS_SEARCH_THRESHOLD=0.7), env_schema=schema
    ).errors
    assert "this environment's schema" in unnamed["message"]


def test_the_same_document_passes_where_the_field_exists():
    result = validate_config_document(
        _doc(MILVUS_SEARCH_THRESHOLD=0.7),
        env_schema=_full_schema(),
        environment_name="alpha",
    )
    assert result.ok, result.errors


def test_missing_role_row_is_not_in_environment():
    schema = _schema_without(roles=("audit",))
    doc = _doc()
    doc["env_overrides"]["LLM_OVERRIDES"]["audit"] = {"temperature": 0.2}
    [error] = validate_config_document(
        doc, env_schema=schema, environment_name="beta"
    ).errors
    assert error["rule"] == NOT_IN_ENVIRONMENT
    assert error["pointer"] == AUDIT
    assert error["form_pointer"] == "/env_overrides/LLM_OVERRIDES"
    assert '"beta"' in error["message"]


def test_schemas_without_additional_properties_are_validated_as_closed():
    # extra="ignore" schemas omit additionalProperties: an undeclared key would be
    # silently dropped by the service, so it is still reported.
    schema = _open(_schema_without("MILVUS_SEARCH_THRESHOLD", roles=("audit",)))
    doc = _doc(MILVUS_SEARCH_THRESHOLD=0.7)
    doc["env_overrides"]["LLM_OVERRIDES"]["audit"] = {"temperature": 0.2}
    doc["env_overrides"]["LLM_OVERRIDES"]["main"]["not_a_column"] = 1
    result = validate_config_document(doc, env_schema=schema, environment_name="beta")
    assert {e["pointer"] for e in _only(result.errors, NOT_IN_ENVIRONMENT)} == {
        THR,
        AUDIT,
        "/env_overrides/LLM_OVERRIDES/main/not_a_column",
    }
    # The caller's schema is never mutated.
    assert "additionalProperties" not in schema


def test_map_entries_and_explicit_open_objects_still_accept_extra_keys():
    schema = _open(_full_schema())
    doc = _doc()
    # endpoints is a map (additionalProperties: {$ref: EndpointConfig}).
    doc["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["fast"] = {"model": "mini"}
    assert validate_config_document(doc, env_schema=schema).ok

    schema["additionalProperties"] = True
    doc = _doc(SOME_PASSTHROUGH_VAR="x")
    assert validate_config_document(doc, env_schema=schema).ok


# --------------------------------------------------------------------------- API


def test_dry_run_reports_the_missing_field_for_that_environment_only(
    client, session_factory, envs
):
    alpha, beta = envs
    res = _create(client, [alpha.id, beta.id], spec=_spec(), dry_run=True)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["ok"] is False and data["job_count"] == 2
    [error] = data["errors"]
    assert error["environment_id"] == beta.id
    assert error["environment_name"] == "beta"
    assert error["rule"] == NOT_IN_ENVIRONMENT
    assert error["pointer"] == THR
    assert error["combo_index"] == 0
    assert '"beta"' in error["message"]
    by_env = {job["environment_id"]: job for job in data["jobs"]}
    assert by_env[alpha.id]["errors"] == []
    assert [e["pointer"] for e in by_env[beta.id]["errors"]] == [THR]
    assert _counts(session_factory) == (0, 0)


def test_dry_run_reports_it_on_every_swept_combination(client, envs):
    alpha, beta = envs
    spec = _spec()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    data = _create(client, [alpha.id, beta.id], spec=spec, dry_run=True).json()
    assert data["job_count"] == 4
    missing = _only(data["errors"], NOT_IN_ENVIRONMENT)
    assert sorted(e["combo_index"] for e in missing) == [0, 1]
    assert {e["environment_id"] for e in missing} == {beta.id}


def test_launch_is_refused_before_any_row_is_written(client, session_factory, envs):
    alpha, beta = envs
    res = _create(client, [alpha.id, beta.id], spec=_spec())
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    [error] = detail["errors"]
    assert (error["environment_id"], error["rule"], error["pointer"]) == (
        beta.id,
        NOT_IN_ENVIRONMENT,
        THR,
    )
    assert _counts(session_factory) == (0, 0)


def test_fields_in_both_environments_launch(client, session_factory, envs):
    alpha, beta = envs
    spec = _spec()
    del spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"]
    spec["env_overrides"]["TABLE_SELECTION_MODE"] = "rag"
    assert _create(client, [alpha.id, beta.id], spec=spec, dry_run=True).json()["ok"]
    created = _created(client, [alpha.id, beta.id], spec=spec)
    jobs = _jobs(session_factory, created["id"])
    assert {j.environment_id for j in jobs} == {alpha.id, beta.id}


def test_deselecting_the_environment_fixes_it(client, envs):
    alpha, _beta = envs
    data = _create(client, [alpha.id], spec=_spec(), dry_run=True).json()
    assert data["ok"] is True, data["errors"]


# --------------------------------------------------------------------------- form

MODULE = (
    ROOT / "packages/platform/qym_platform/_static/dashboard/experiment_launch.js"
).read_text()


def test_form_flags_missing_fields_locally_next_to_the_field():
    # Union badges on fields, objects and role rows.
    assert MODULE.count("tag('not in ' + envName(id), 'warning')") >= 4
    # Each selected env's own descriptor decides (mirrors match_pointer).
    assert "function matchPointer(descriptor, pointer)" in MODULE
    assert "!matchPointer(st.envData[id].form, pointer)" in MODULE
    # A set value missing from an env is a local error (blocks launch before submit),
    # shown inline under the field with the env name.
    assert "rule: 'not_in_environment', message: notInEnvMessage(p, id)" in MODULE
    assert "'data-xl-env-error': '1'" in MODULE
    assert "' is not in environment \"' + envName(id)" in MODULE
    # Edits no selected env knows are dropped, like bindings.
    assert "pruneOrphanValues();" in MODULE
