"""Model slot binding resolution at dispatch time (plan §7.4, issue #11)."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
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
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Project,
    ProjectLlmConnection,
    User,
)
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services.eval_bindings import (
    KEYS_NOT_ALLOWED_REASON,
    BindingResolutionError,
    connection_options,
    mark_job_blocked,
    prepare_dispatch,
    resolve_slot_bindings,
)
from qym_platform.services.eval_config import (
    find_placeholders,
    materialize_job_body,
    validate_config_document,
)
from qym_platform.services.eval_model_slots import detect_model_slots
from qym_platform.services.eval_schema_form import build_form_descriptor

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
PRIMARY = "endpoint:primary"
VIZ = "flat:VIZ_LLM"
KEY_1 = "sk-first-secret-key-AAAA1111"
KEY_2 = "sk-rotated-secret-key-BBBB2222"
TEMP_KEY = "sk-temporary-secret-CCCC3333"


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )


@pytest.fixture(scope="module")
def schema():
    return json.loads(FIXTURE.read_text())


@pytest.fixture(scope="module")
def descriptor(schema):
    return build_form_descriptor(schema)


@pytest.fixture(scope="module")
def slots(descriptor):
    return [s.to_dict() for s in detect_model_slots(descriptor)]


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
def project(db):
    user = User(email="owner@example.com")
    db.add(user)
    db.flush()
    project = Project(name="P", slug="p", created_by_user_id=user.id)
    other = Project(name="Q", slug="q", created_by_user_id=user.id)
    db.add_all([project, other])
    db.flush()
    return user, project, other


def _env(db, project, *, allow_keys=True, name="staging"):
    env = EvalEnvironment(
        project_id=project.id,
        name=name,
        base_url=f"https://{name}.example",
        allow_connection_keys=allow_keys,
    )
    db.add(env)
    db.flush()
    return env


@pytest.fixture()
def env(db, project):
    return _env(db, project[1])


def _conn(db, project, *, name="gpt4o", model="gpt-4o", key=KEY_1, **kwargs):
    conn = ProjectLlmConnection(
        project_id=project.id,
        name=name,
        llm_model=model,
        llm_base_url=kwargs.pop("base_url", "https://llm.example/v1"),
        llm_api_key_encrypted=encrypt_llm_api_key(key) if key else "",
        llm_api_key_last4=key[-4:] if key else "",
        **kwargs,
    )
    db.add(conn)
    db.flush()
    return conn


def _doc(bindings):
    return {
        "schema_hash": "h1",
        "evaluator": {
            "dataset": "playground_set_v2",
            "config": {"samples": 3, "report_k": 1},
        },
        "slot_bindings": bindings,
        "env_overrides": {
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"timeout": 60}},
                "main": {"endpoint": "primary"},
            }
        },
    }


def _primary(body):
    return body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]


def _stored_body(doc, slots, descriptor):
    """What #13 stores in ``request_body``: the placeholder materialization."""
    return materialize_job_body(doc, slots, descriptor=descriptor, user_id="u1")


def _job(db, env, user, body):
    schema_row = EvalEnvironmentSchema(
        environment_id=env.id, schema_hash="h1", schema_json={}
    )
    db.add(schema_row)
    db.flush()
    experiment = EvalExperiment(
        project_id=env.project_id,
        created_by_user_id=user.id,
        name="x",
        environment_ids=[env.id],
    )
    db.add(experiment)
    db.flush()
    job = EvalExperimentJob(
        experiment_id=experiment.id,
        environment_id=env.id,
        combo_index=0,
        schema_id=schema_row.id,
        request_body=body,
        params={},
    )
    db.add(job)
    db.flush()
    return job


# --------------------------------------------------------------------------- resolve


def test_connection_binding_fills_model_base_url_key_and_evaluator_model(
    db, env, project, slots, descriptor
):
    conn = _conn(db, project[1])
    doc = _doc({PRIMARY: {"connection_id": conn.id}, VIZ: {"inherit": True}})
    resolution = resolve_slot_bindings(db, env, doc["slot_bindings"], slots)
    assert resolution.ok
    body = materialize_job_body(
        doc, slots, descriptor=descriptor, resolver=resolution.resolver
    )
    primary = _primary(body)
    assert primary == {
        "timeout": 60,
        "model": "gpt-4o",
        "base_url": "https://llm.example/v1",
        "api_key": KEY_1,
    }
    assert body["evaluator"]["model"] == "gpt-4o"
    assert body["evaluator"]["config"]["model"] == "gpt-4o"
    # Inherit omits the slot entirely.
    assert "VIZ_LLM_MODEL" not in body["env_overrides"]
    assert find_placeholders(body) == []
    assert resolution.models == {
        PRIMARY: {
            "kind": "connection",
            "connection_id": conn.id,
            "name": "gpt4o",
            "model": "gpt-4o",
            "base_url": "https://llm.example/v1",
        }
    }


def test_placeholder_validated_body_resolves_to_same_result(
    db, env, project, slots, descriptor, schema
):
    conn = _conn(db, project[1])
    doc = _doc({PRIMARY: {"connection_id": conn.id}})
    validated = validate_config_document(doc, env_schema=schema, slots=slots)
    assert validated.ok, validated.errors
    prep = prepare_dispatch(
        db, env, body=validated.body, slot_bindings=doc["slot_bindings"], slots=slots
    )
    assert prep.ok
    direct = materialize_job_body(
        doc,
        slots,
        descriptor=descriptor,
        resolver=resolve_slot_bindings(db, env, doc["slot_bindings"], slots).resolver,
    )
    assert prep.body == direct
    # The stored body is not mutated.
    assert find_placeholders(validated.body)


def test_connection_without_key_omits_api_key_field(
    db, env, project, slots, descriptor
):
    conn = _conn(db, project[1], key="", base_url="")
    doc = _doc({PRIMARY: {"connection_id": conn.id}})
    prep = prepare_dispatch(
        db,
        env,
        body=_stored_body(doc, slots, descriptor),
        slot_bindings=doc["slot_bindings"],
        slots=slots,
    )
    assert prep.ok
    assert _primary(prep.body) == {"timeout": 60, "model": "gpt-4o"}


def test_rotated_key_and_model_are_used_on_retry(db, env, project, slots, descriptor):
    conn = _conn(db, project[1])
    doc = _doc({PRIMARY: {"connection_id": conn.id}})
    stored = _stored_body(doc, slots, descriptor)
    first = prepare_dispatch(
        db, env, body=stored, slot_bindings=doc["slot_bindings"], slots=slots
    )
    assert _primary(first.body)["api_key"] == KEY_1

    conn.llm_api_key_encrypted = encrypt_llm_api_key(KEY_2)
    conn.llm_model = "gpt-4.1"
    db.commit()

    retry = prepare_dispatch(
        db, env, body=stored, slot_bindings=doc["slot_bindings"], slots=slots
    )
    assert _primary(retry.body)["api_key"] == KEY_2
    assert _primary(retry.body)["model"] == "gpt-4.1"
    assert retry.body["evaluator"]["model"] == "gpt-4.1"


def test_deleted_connection_blocks_job_with_wait_reason(
    db, env, project, slots, descriptor
):
    conn = _conn(db, project[1], name="GPT-4o prod")
    doc = _doc({PRIMARY: {"connection_id": conn.id}})
    stored = _stored_body(doc, slots, descriptor)
    job = _job(db, env, project[0], stored)
    db.delete(conn)
    db.commit()

    prep = prepare_dispatch(
        db,
        env,
        body=job.request_body,
        # qym_config/params carry the display name; the bare id is the fallback.
        slot_bindings={PRIMARY: {"connection_id": conn.id, "name": "GPT-4o prod"}},
        slots=slots,
    )
    assert not prep.ok and prep.body is None
    assert [p.code for p in prep.problems] == ["connection_missing"]
    mark_job_blocked(job, prep.problems)
    db.commit()
    db.refresh(job)
    assert job.status == EvalJobStatus.BLOCKED
    assert job.wait_reason == 'Model "GPT-4o prod" no longer exists'
    assert job.error == job.wait_reason
    assert job.next_attempt_at is None

    bare = resolve_slot_bindings(db, env, doc["slot_bindings"], slots)
    assert bare.wait_reason == f'Model "{conn.id}" no longer exists'


def test_connection_of_another_project_counts_as_missing(db, env, project, slots):
    foreign = _conn(db, project[2])
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": foreign.id}}, slots
    )
    assert [p.code for p in resolution.problems] == ["connection_missing"]


def test_connection_made_unavailable_blocks(db, env, project, slots):
    conn = _conn(db, project[1], available_for_experiments=False)
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": conn.id}}, slots
    )
    assert [p.code for p in resolution.problems] == ["connection_unavailable"]
    assert "no longer available for experiments" in resolution.wait_reason


def test_connection_without_model_name_blocks(db, env, project, slots):
    conn = _conn(db, project[1], model="  ")
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": conn.id}}, slots
    )
    assert [p.code for p in resolution.problems] == ["connection_no_model"]


def test_undecryptable_key_blocks_without_leaking(db, env, project, slots, caplog):
    conn = _conn(db, project[1])
    conn.llm_api_key_encrypted = "not-a-fernet-token"
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": conn.id}}, slots
    )
    assert [p.code for p in resolution.problems] == ["key_unavailable"]
    assert "not-a-fernet-token" not in resolution.wait_reason


def test_invalid_and_sweep_bindings_block(db, env, slots):
    resolution = resolve_slot_bindings(
        db,
        env,
        {PRIMARY: {"sweep": [{"connection_id": "a"}]}, VIZ: {"oops": 1}},
        slots,
    )
    assert [p.code for p in resolution.problems] == [
        "invalid_binding",
        "invalid_binding",
    ]
    assert "sweep" in resolution.problems[0].message


def test_unbound_placeholder_in_stored_body_blocks(db, env, project, slots, descriptor):
    conn = _conn(db, project[1])
    stored = _stored_body(
        _doc({PRIMARY: {"connection_id": conn.id}}), slots, descriptor
    )
    prep = prepare_dispatch(
        db, env, body=stored, slot_bindings={PRIMARY: {"inherit": True}}, slots=slots
    )
    assert not prep.ok
    assert [(p.slot_key, p.code) for p in prep.problems] == [
        (PRIMARY, "invalid_binding")
    ]


def test_resolver_refuses_unresolved_slots(db, env, slots):
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": "gone"}}, slots
    )
    with pytest.raises(BindingResolutionError):
        resolution.resolver(PRIMARY, {"connection_id": "gone"}, "model")


def test_problems_convert_to_config_errors(db, env, slots):
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": "gone"}}, slots, decrypt=False
    )
    (error,) = resolution.to_errors()
    assert error["section"] == "slot_bindings"
    assert error["pointer"] == "/slot_bindings/endpoint:primary"
    assert error["rule"] == "binding"
    assert error["code"] == "connection_missing"
    assert error["slot_key"] == PRIMARY


def test_wait_reason_is_truncated_to_column_size(db, env, slots):
    bindings = {
        f"endpoint:e{i}": {"connection_id": f"missing-{i}", "name": "x" * 80}
        for i in range(5)
    }
    resolution = resolve_slot_bindings(db, env, bindings, slots)
    assert len(resolution.problems) == 5
    assert len(resolution.wait_reason) <= 200


# --------------------------------------------------------------------------- key opt-in


def test_keys_never_sent_without_opt_in(db, project, slots, descriptor):
    env = _env(db, project[1], allow_keys=False, name="closed")
    conn = _conn(db, project[1])
    doc = _doc({PRIMARY: {"connection_id": conn.id}})
    prep = prepare_dispatch(
        db,
        env,
        body=_stored_body(doc, slots, descriptor),
        slot_bindings=doc["slot_bindings"],
        slots=slots,
    )
    assert not prep.ok and prep.body is None
    assert [p.code for p in prep.problems] == ["keys_not_allowed"]
    # Fail closed: neither the key nor model/base_url are resolvable for this slot.
    resolution = resolve_slot_bindings(db, env, doc["slot_bindings"], slots)
    for role in ("api_key", "model", "base_url"):
        with pytest.raises(BindingResolutionError):
            resolution.value(PRIMARY, role)
    assert KEY_1 not in repr(prep) + repr(resolution)


def test_model_only_slot_works_without_opt_in(db, project, slots, descriptor):
    env = _env(db, project[1], allow_keys=False, name="closed")
    conn = _conn(db, project[1], model="gpt-4o-mini")
    doc = _doc({VIZ: {"connection_id": conn.id}})
    prep = prepare_dispatch(
        db,
        env,
        body=_stored_body(doc, slots, descriptor),
        slot_bindings=doc["slot_bindings"],
        slots=slots,
    )
    assert prep.ok
    assert prep.body["env_overrides"]["VIZ_LLM_MODEL"] == "gpt-4o-mini"
    assert KEY_1 not in json.dumps(prep.body)


def test_keyless_connection_works_without_opt_in(db, project, slots):
    env = _env(db, project[1], allow_keys=False, name="closed")
    conn = _conn(db, project[1], key="")
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": conn.id}}, slots
    )
    assert resolution.ok
    assert resolution.value(PRIMARY, "api_key") is None


def test_decrypt_false_checks_without_decrypting(db, env, project, slots, monkeypatch):
    conn = _conn(db, project[1])
    import qym_platform.services.eval_bindings as mod

    def boom(*args, **kwargs):
        raise AssertionError("must not decrypt")

    monkeypatch.setattr(mod, "decrypt_llm_api_key", boom)
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": conn.id}}, slots, decrypt=False
    )
    assert resolution.ok
    assert resolution.value(PRIMARY, "api_key") is None
    assert resolution.value(PRIMARY, "model") == "gpt-4o"


# --------------------------------------------------------------------------- temporary


def _temporary(ref="k1"):
    temporary = {"label": "mini trial", "model": "gpt-4o-mini", "base_url": "https://t"}
    if ref:
        temporary["api_key"] = {"$secret": ref}
    return {PRIMARY: {"temporary": temporary}}


def test_temporary_model_uses_secret_lookup_hook(db, env, slots, descriptor):
    doc = _doc(_temporary())
    prep = prepare_dispatch(
        db,
        env,
        body=_stored_body(doc, slots, descriptor),
        slot_bindings=doc["slot_bindings"],
        slots=slots,
        secret_lookup={"k1": TEMP_KEY}.get,
    )
    assert prep.ok
    assert _primary(prep.body) == {
        "timeout": 60,
        "model": "gpt-4o-mini",
        "base_url": "https://t",
        "api_key": TEMP_KEY,
    }
    assert prep.body["evaluator"]["model"] == "gpt-4o-mini"


def test_temporary_key_missing_blocks(db, env, slots):
    resolution = resolve_slot_bindings(db, env, _temporary(), slots)
    assert [p.code for p in resolution.problems] == ["temporary_key_missing"]
    assert "enter it again" in resolution.wait_reason


def test_temporary_key_refused_without_opt_in(db, project, slots):
    env = _env(db, project[1], allow_keys=False, name="closed")
    resolution = resolve_slot_bindings(
        db, env, _temporary(), slots, secret_lookup={"k1": TEMP_KEY}.get
    )
    assert [p.code for p in resolution.problems] == ["keys_not_allowed"]
    keyless = resolve_slot_bindings(db, env, _temporary(ref=None), slots)
    assert keyless.ok


# --------------------------------------------------------------------------- secrets


def test_keys_never_logged_persisted_or_repr(db, project, slots, descriptor, caplog):
    caplog.set_level(logging.DEBUG)
    user = project[0]
    env = _env(db, project[1], name="open")
    conn = _conn(db, project[1])
    doc = _doc({PRIMARY: {"connection_id": conn.id}})
    stored = _stored_body(doc, slots, descriptor)
    job = _job(db, env, user, stored)

    prep = prepare_dispatch(
        db, env, body=job.request_body, slot_bindings=doc["slot_bindings"], slots=slots
    )
    assert prep.ok and _primary(prep.body)["api_key"] == KEY_1
    resolution = resolve_slot_bindings(db, env, doc["slot_bindings"], slots)

    # Rotate to an undecryptable token and block the job with the problems.
    conn.llm_api_key_encrypted = "garbage"
    blocked = prepare_dispatch(
        db, env, body=job.request_body, slot_bindings=doc["slot_bindings"], slots=slots
    )
    mark_job_blocked(job, blocked.problems)
    db.commit()

    row = db.query(EvalExperimentJob).filter(EvalExperimentJob.id == job.id).one()
    persisted = json.dumps(
        {c.name: str(getattr(row, c.name)) for c in EvalExperimentJob.__table__.columns}
    )
    exposed = " ".join(
        [
            persisted,
            caplog.text,
            repr(prep),
            repr(resolution),
            repr(resolution._slots),
            json.dumps(resolution.models),
            json.dumps([p.to_dict() for p in blocked.problems]),
            json.dumps(resolution.to_errors()),
        ]
    )
    assert KEY_1 not in exposed
    assert find_placeholders(row.request_body)  # the stored body keeps placeholders


def test_resolution_errors_do_not_contain_keys(db, env, project, slots):
    conn = _conn(db, project[1])
    resolution = resolve_slot_bindings(
        db, env, {PRIMARY: {"connection_id": conn.id}}, slots
    )
    with pytest.raises(BindingResolutionError) as excinfo:
        resolution.value(VIZ, "api_key")
    assert KEY_1 not in str(excinfo.value)


# --------------------------------------------------------------------------- picker


def test_connection_options_for_picker(db, project, slots):
    closed = _env(db, project[1], allow_keys=False, name="closed")
    open_env = _env(db, project[1], allow_keys=True, name="open")
    keyed = _conn(db, project[1], name="keyed")
    keyless = _conn(db, project[1], name="keyless", key="")
    _conn(db, project[1], name="hidden", available_for_experiments=False)
    _conn(db, project[2], name="foreign")

    data = connection_options(db, closed, slots)
    assert data["allow_connection_keys"] is False
    assert data["temporary_keys_allowed"] is False
    assert data["temporary_keys_reason"] == KEYS_NOT_ALLOWED_REASON
    by_name = {o["name"]: o for o in data["connections"]}
    assert set(by_name) == {"keyed", "keyless"}
    assert by_name["keyed"]["connection_id"] == keyed.id
    assert by_name["keyed"]["available"] is False
    assert by_name["keyed"]["reason_code"] == "keys_not_allowed"
    assert by_name["keyed"]["reason"] == KEYS_NOT_ALLOWED_REASON
    assert by_name["keyed"]["slots"][PRIMARY]["available"] is False
    # A model-only slot never sends the key, so it stays selectable.
    assert by_name["keyed"]["slots"][VIZ] == {
        "available": True,
        "reason_code": None,
        "reason": None,
    }
    assert by_name["keyless"]["connection_id"] == keyless.id
    assert by_name["keyless"]["available"] is True
    assert by_name["keyed"]["api_key_hint"] == "••••" + KEY_1[-4:]
    assert KEY_1 not in json.dumps(data)

    open_data = connection_options(db, open_env, slots)
    assert all(o["available"] for o in open_data["connections"])
    assert open_data["temporary_keys_allowed"] is True


def test_failing_secret_lookup_counts_as_missing_key(db, env, slots):
    def lookup(ref):
        raise RuntimeError(f"cannot decrypt {TEMP_KEY}")

    resolution = resolve_slot_bindings(
        db, env, _temporary(), slots, secret_lookup=lookup
    )
    assert [p.code for p in resolution.problems] == ["temporary_key_missing"]
    assert TEMP_KEY not in json.dumps(resolution.to_errors())
