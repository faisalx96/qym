"""Presets API and service (plan §4.4, §9.1): official vs saved, versioning, warnings."""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.api.eval_environments import get_eval_client_factory
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    EvalConfigPreset,
    EvalConfigPresetKind,
    EvalConfigPresetVersion,
    EvalEnvironment,
    EvalEnvironmentSchema,
    Project,
    ProjectLlmConnection,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.services import eval_presets
from qym_platform.services.eval_config import validate_config_document
from qym_platform.services.eval_model_slots import detect_model_slots
from qym_platform.services.eval_schema_form import build_form_descriptor
from qym_platform.services.eval_service_client import EvalServiceClient

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
P1, P2 = "project-1", "project-2"
ADMIN = "admin@example.com"
MANAGER = "manager@example.com"
MEMBER = "member@example.com"
MEMBER2 = "member2@example.com"
OUTSIDER = "outsider@example.com"
KEY = "eval-secret-key-9876"
URL = "https://eval.example.com/prefix"


def _headers(email: str) -> dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


class FakeService:
    def __init__(self) -> None:
        self.schema = json.loads(FIXTURE.read_text())

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/evals/env-overrides/schema"):
            return httpx.Response(200, json=self.schema)
        if path.endswith("/evals"):
            return httpx.Response(
                200, json={"total": 0, "limit": 1, "offset": 0, "items": []}
            )
        return httpx.Response(404, json={"detail": "Not Found"})


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as s:
        s.add_all(
            [
                User(id="admin-1", email=ADMIN, role=UserRole.ADMIN),
                User(id="manager-1", email=MANAGER, role=UserRole.MEMBER),
                User(id="member-1", email=MEMBER, role=UserRole.MEMBER),
                User(id="member-2", email=MEMBER2, role=UserRole.MEMBER),
                User(id="outsider-1", email=OUTSIDER, role=UserRole.MEMBER),
                Project(id=P1, name="One", slug="p1", created_by_user_id="admin-1"),
                Project(id=P2, name="Two", slug="p2", created_by_user_id="admin-1"),
            ]
        )
        s.flush()
        s.add_all(
            [
                ProjectMembership(
                    project_id=P1, user_id="manager-1", role=ProjectRole.MANAGER
                ),
                ProjectMembership(
                    project_id=P1, user_id="member-1", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id=P1, user_id="member-2", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id=P2, user_id="outsider-1", role=ProjectRole.MANAGER
                ),
                ProjectLlmConnection(
                    id="c-gpt4o", project_id=P1, name="gpt-4o", llm_model="gpt-4o"
                ),
                ProjectLlmConnection(
                    id="c-hidden",
                    project_id=P1,
                    name="analyzer",
                    available_for_experiments=False,
                ),
                ProjectLlmConnection(id="c-other", project_id=P2, name="theirs"),
            ]
        )
        s.commit()
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    service = FakeService()
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    def override_factory():
        def factory(base_url: str, api_key: str) -> EvalServiceClient:
            http = httpx.AsyncClient(transport=httpx.MockTransport(service.handler))
            return EvalServiceClient(
                base_url, api_key, allow_private=True, http_client=http
            )

        return factory

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_eval_client_factory] = override_factory
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def env(client) -> dict:
    res = client.post(
        f"/v1/projects/{P1}/eval-environments",
        headers=_headers(MANAGER),
        json={"name": "staging", "base_url": URL, "api_key": KEY},
    )
    assert res.status_code == 200, res.text
    return res.json()["environment"]


def _presets_url(env_id: str, suffix: str = "", project_id: str = P1) -> str:
    return f"/v1/projects/{project_id}/eval-environments/{env_id}/presets{suffix}"


def _doc(connection_id: str = "c-gpt4o", **overrides) -> dict:
    doc = {
        "evaluator": {
            "dataset": "playground_set_v2",
            "config": {"samples": 3, "report_k": 1, "run_metadata": {"team": "rag"}},
        },
        "slot_bindings": {"endpoint:primary": {"connection_id": connection_id}},
        "env_overrides": {
            "TABLE_SELECTION_MODE": "rag",
            "MILVUS_SEARCH_THRESHOLD": 0.7,
            "LLM_OVERRIDES": {
                "endpoints": {"primary": {"timeout": 60}},
                "main": {"endpoint": "primary", "temperature": 0.2},
            },
        },
    }
    doc.update(overrides)
    return doc


def _temporary_doc() -> dict:
    return _doc(
        slot_bindings={
            "endpoint:primary": {
                "temporary": {
                    "label": "mini trial",
                    "model": "gpt-4o-mini",
                    "base_url": "https://llm.example.com/v1",
                    "api_key": {"$secret": "k1"},
                }
            }
        }
    )


def _create(client, env_id, email=MANAGER, **body):
    body.setdefault("config", _doc())
    return client.post(_presets_url(env_id), headers=_headers(email), json=body)


def _official(client, env_id, **body) -> dict:
    body.setdefault("notes", "Initial defaults")
    res = _create(client, env_id, kind="official", **body)
    assert res.status_code == 200, res.text
    return res.json()["preset"]


def _publish(client, env_id, preset_id, email=MANAGER, **body):
    body.setdefault("config", _doc())
    return client.post(
        _presets_url(env_id, f"/{preset_id}/versions"),
        headers=_headers(email),
        json=body,
    )


# --------------------------------------------------------------------------- create


def test_member_creates_saved_preset(client, env, session_factory):
    res = _create(client, env["id"], email=MEMBER, name="RAG baseline")
    assert res.status_code == 200, res.text
    body = res.json()
    preset = body["preset"]
    assert body["warnings"] == []
    assert preset["kind"] == "saved" and preset["name"] == "RAG baseline"
    assert preset["can_publish"] is True
    current = preset["current_version"]
    assert current["version"] == 1 and current["notes"] == ""
    assert current["schema_id"] == env["current_schema_id"]
    assert current["schema_current"] is True and current["warnings"] == []
    # Pinned to the schema it was validated against.
    assert current["config"]["schema_hash"] == env["schema_hash"]

    listing = client.get(_presets_url(env["id"]), headers=_headers(MEMBER2)).json()
    assert listing["can_publish_official"] is False
    assert [p["id"] for p in listing["presets"]] == [preset["id"]]
    # Another member may read it but not publish on it.
    assert listing["presets"][0]["can_publish"] is False


def test_saved_preset_needs_a_unique_name(client, env):
    assert _create(client, env["id"], name="Baseline").status_code == 200
    assert _create(client, env["id"], name="   ").status_code == 422
    res = _create(client, env["id"], email=MEMBER, name=" baseline ")
    assert res.status_code == 409
    # The official preset is identified by kind, so a saved name never blocks it.
    assert _create(client, env["id"], name="Official defaults").status_code == 200
    _official(client, env["id"])


def test_only_managers_create_official_and_notes_are_required(client, env):
    res = _create(client, env["id"], email=MEMBER, kind="official", notes="x")
    assert res.status_code == 403
    res = _create(client, env["id"], kind="official")
    assert res.status_code == 422
    assert "notes" in res.json()["detail"].lower()
    preset = _official(client, env["id"])
    assert preset["kind"] == "official"
    assert preset["name"] == eval_presets.OFFICIAL_DEFAULT_NAME
    assert preset["current_version"]["notes"] == "Initial defaults"


def test_one_official_per_environment(client, env):
    first = _official(client, env["id"])
    res = _create(client, env["id"], kind="official", name="Other", notes="again")
    assert res.status_code == 409
    assert res.json()["detail"]["preset_id"] == first["id"]
    # Admins are managers too, and still limited to one.
    res = _create(client, env["id"], email=ADMIN, kind="official", notes="again")
    assert res.status_code == 409


def test_official_index_race_maps_to_409(client, env, monkeypatch, session_factory):
    _official(client, env["id"])
    # Simulate losing the race: the pre-check misses the concurrent insert.
    monkeypatch.setattr(eval_presets, "official_preset", lambda db, env: None)
    res = _create(client, env["id"], kind="official", name="Racer", notes="v1")
    assert res.status_code == 409
    with session_factory() as s:
        assert (
            s.query(EvalConfigPreset)
            .filter_by(kind=EvalConfigPresetKind.OFFICIAL)
            .count()
            == 1
        )
        assert s.query(EvalConfigPresetVersion).count() == 1


def test_permissions_and_scoping(client, env):
    preset = _official(client, env["id"])
    assert (
        client.get(_presets_url(env["id"]), headers=_headers(OUTSIDER)).status_code
        == 403
    )
    assert _create(client, env["id"], email=OUTSIDER, name="x").status_code == 403
    # Environment of project 1 addressed through project 2.
    res = client.get(_presets_url(env["id"], project_id=P2), headers=_headers(OUTSIDER))
    assert res.status_code == 404
    res = client.get(
        _presets_url(env["id"], "/missing/versions"), headers=_headers(MEMBER)
    )
    assert res.status_code == 404
    res = client.get(
        _presets_url(env["id"], f"/{preset['id']}/versions/9"), headers=_headers(MEMBER)
    )
    assert res.status_code == 404


def test_invalid_config_is_rejected(client, env):
    bad = _doc()
    bad["evaluator"]["config"]["run_metadata"] = {"qym_origin": "x"}
    res = _create(client, env["id"], name="bad", config=bad)
    assert res.status_code == 422
    rules = {e["rule"] for e in res.json()["detail"]["errors"]}
    assert "reserved_key" in rules

    secret = _doc()
    secret["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"][
        "api_key"
    ] = "sk-literal-secret"
    res = _create(client, env["id"], name="secret", config=secret)
    assert res.status_code == 422
    assert "sk-literal-secret" not in res.text

    swept = _doc(links=[["/env_overrides/A", "/env_overrides/B"]])
    res = _create(client, env["id"], name="swept", config=swept)
    assert res.status_code == 422
    assert {e["rule"] for e in res.json()["detail"]["errors"]} >= {"sweep"}

    sweep = _doc()
    sweep["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    assert _create(client, env["id"], name="sweep", config=sweep).status_code == 422


def test_disabled_environment_refuses_writes(client, env, session_factory):
    preset = _official(client, env["id"])
    with session_factory() as s:
        s.get(EvalEnvironment, env["id"]).is_active = False
        s.commit()
    assert _create(client, env["id"], name="x").status_code == 409
    assert _publish(client, env["id"], preset["id"], notes="v2").status_code == 409
    # Reading still works.
    assert (
        client.get(_presets_url(env["id"]), headers=_headers(MEMBER)).status_code == 200
    )


# --------------------------------------------------------------------------- versions


def test_publishing_appends_versions_and_never_mutates_old_ones(
    client, env, session_factory
):
    preset = _official(client, env["id"])
    v1 = preset["current_version"]

    res = _publish(client, env["id"], preset["id"], email=MEMBER, notes="nope")
    assert res.status_code == 403
    res = _publish(client, env["id"], preset["id"], notes="  ")
    assert res.status_code == 422

    changed = _doc()
    changed["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = 0.9
    res = _publish(client, env["id"], preset["id"], config=changed, notes="Tighter")
    assert res.status_code == 200, res.text
    v2 = res.json()["version"]
    assert v2["version"] == 2 and v2["id"] != v1["id"]
    assert res.json()["preset"]["current_version_id"] == v2["id"]
    res = _publish(client, env["id"], preset["id"], notes="Back to 0.7")
    v3 = res.json()["version"]
    assert v3["version"] == 3

    history = client.get(
        _presets_url(env["id"], f"/{preset['id']}/versions"), headers=_headers(MEMBER)
    ).json()
    assert history["current_version_id"] == v3["id"]
    assert [v["version"] for v in history["versions"]] == [3, 2, 1]
    old = history["versions"][2]
    assert old["id"] == v1["id"]
    assert old["config"] == v1["config"]
    assert old["notes"] == "Initial defaults"
    assert old["published_at"] == v1["published_at"]
    assert (
        history["versions"][1]["config"]["env_overrides"]["MILVUS_SEARCH_THRESHOLD"]
        == 0.9
    )

    single = client.get(
        _presets_url(env["id"], f"/{preset['id']}/versions/1"),
        headers=_headers(MEMBER),
    ).json()["version"]
    assert single == old


def test_no_route_mutates_a_version(client, env):
    preset = _official(client, env["id"])
    url = _presets_url(env["id"], f"/{preset['id']}/versions/1")
    for method in ("put", "patch", "delete"):
        res = getattr(client, method)(url, headers=_headers(ADMIN))
        assert res.status_code == 405, method


def test_orm_refuses_to_update_a_version(client, env, session_factory):
    preset = _official(client, env["id"])
    with session_factory() as s:
        row = s.get(EvalConfigPresetVersion, preset["current_version_id"])
        row.notes = "rewritten"
        with pytest.raises(ValueError, match="immutable"):
            s.commit()
        s.rollback()
    with session_factory() as s:
        row = s.get(EvalConfigPresetVersion, preset["current_version_id"])
        assert row.notes == "Initial defaults"


def test_current_version_must_belong_to_the_preset(client, env, session_factory):
    official = _official(client, env["id"])
    saved = _create(client, env["id"], name="mine").json()["preset"]
    with session_factory() as s:
        row = s.get(EvalConfigPreset, saved["id"])
        row.current_version_id = official["current_version_id"]
        s.commit()
    got = client.get(
        _presets_url(env["id"], f"/{saved['id']}"), headers=_headers(MEMBER)
    ).json()["preset"]
    assert got["current_version"] is None
    # Publishing repairs the pointer with the preset's own next version.
    res = _publish(client, env["id"], saved["id"])
    assert res.status_code == 200, res.text
    assert res.json()["version"]["version"] == 2
    assert res.json()["preset"]["current_version"]["preset_id"] == saved["id"]


def test_saved_preset_versions_by_creator_or_manager(client, env):
    preset = _create(client, env["id"], email=MEMBER, name="mine").json()["preset"]
    assert _publish(client, env["id"], preset["id"], email=MEMBER2).status_code == 403
    res = _publish(client, env["id"], preset["id"], email=MEMBER)
    assert res.status_code == 200 and res.json()["version"]["version"] == 2
    res = _publish(client, env["id"], preset["id"], email=MANAGER, notes="tidy")
    assert res.status_code == 200 and res.json()["version"]["version"] == 3


def test_version_on_older_schema_warns(client, env, session_factory):
    preset = _official(client, env["id"])
    with session_factory() as s:
        row = s.get(EvalEnvironment, env["id"])
        schema = EvalEnvironmentSchema(
            environment_id=row.id,
            schema_hash="new-hash",
            schema_json=json.loads(FIXTURE.read_text()),
        )
        s.add(schema)
        s.flush()
        row.current_schema_id = schema.id
        s.commit()
    got = client.get(
        _presets_url(env["id"], f"/{preset['id']}"), headers=_headers(MEMBER)
    ).json()["preset"]["current_version"]
    assert got["schema_current"] is False
    assert [w["rule"] for w in got["warnings"]] == ["schema_hash"]

    # Republishing the old document unchanged warns that it was authored on the
    # previous schema, then pins the new version to the current one.
    res = _publish(
        client, env["id"], preset["id"], config=got["config"], notes="unchanged"
    )
    assert res.status_code == 200, res.text
    assert [w["rule"] for w in res.json()["warnings"]] == ["schema_hash"]
    version = res.json()["version"]
    assert version["schema_current"] is True
    assert version["config"]["schema_hash"] == "new-hash"


# --------------------------------------------------------------------------- bindings


def test_official_rejects_temporary_models_pointing_at_the_slot(client, env):
    res = _create(
        client, env["id"], kind="official", notes="v1", config=_temporary_doc()
    )
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    temp = [e for e in errors if e["rule"] == "temporary_binding"]
    assert len(temp) == 1
    assert temp[0]["slot_key"] == "endpoint:primary"
    assert temp[0]["pointer"] == "/slot_bindings/endpoint:primary"
    assert "mini trial" in temp[0]["message"]

    preset = _official(client, env["id"])
    res = _publish(
        client, env["id"], preset["id"], config=_temporary_doc(), notes="try"
    )
    assert res.status_code == 422
    assert any(e["rule"] == "temporary_binding" for e in res.json()["detail"]["errors"])


def test_saved_preset_keeps_temporary_model_without_its_key(
    client, env, session_factory
):
    res = _create(
        client, env["id"], email=MEMBER, name="trial", config=_temporary_doc()
    )
    assert res.status_code == 200, res.text
    assert [w["rule"] for w in res.json()["warnings"]] == ["temporary_key_dropped"]
    config = res.json()["preset"]["current_version"]["config"]
    assert config["slot_bindings"]["endpoint:primary"] == {
        "temporary": {
            "label": "mini trial",
            "model": "gpt-4o-mini",
            "base_url": "https://llm.example.com/v1",
        }
    }
    with session_factory() as s:
        stored = s.query(EvalConfigPresetVersion).one().config
        assert "$secret" not in json.dumps(stored)


def test_deleted_connection_warns_but_does_not_block(client, env, session_factory):
    preset = _official(client, env["id"])
    assert preset["current_version"]["warnings"] == []

    with session_factory() as s:
        s.delete(s.get(ProjectLlmConnection, "c-gpt4o"))
        s.commit()

    listing = client.get(_presets_url(env["id"]), headers=_headers(MEMBER)).json()
    warnings = listing["presets"][0]["current_version"]["warnings"]
    assert warnings == [
        {
            "section": "slot_bindings",
            "pointer": "/slot_bindings/endpoint:primary",
            "rule": "connection_missing",
            "message": warnings[0]["message"],
            "slot_key": "endpoint:primary",
            "connection_id": "c-gpt4o",
        }
    ]
    history = client.get(
        _presets_url(env["id"], f"/{preset['id']}/versions"), headers=_headers(MEMBER)
    ).json()
    assert history["versions"][0]["warnings"][0]["rule"] == "connection_missing"

    # Publishing with a missing binding still succeeds, with the warning.
    res = _publish(client, env["id"], preset["id"], notes="still missing")
    assert res.status_code == 200, res.text
    assert [w["rule"] for w in res.json()["warnings"]] == ["connection_missing"]


def test_hidden_and_foreign_connections_warn(client, env):
    res = _create(client, env["id"], name="hidden", config=_doc("c-hidden"))
    assert res.status_code == 200
    assert [w["rule"] for w in res.json()["warnings"]] == ["connection_unavailable"]
    # Another project's connection is treated as missing, never resolved.
    res = _create(client, env["id"], name="foreign", config=_doc("c-other"))
    assert res.status_code == 200
    assert [w["rule"] for w in res.json()["warnings"]] == ["connection_missing"]
    assert "theirs" not in res.text


def test_env_with_presets_soft_disables_on_delete(client, env, session_factory):
    _create(client, env["id"], email=MEMBER, name="mine")
    res = client.delete(
        f"/v1/projects/{P1}/eval-environments/{env['id']}", headers=_headers(MANAGER)
    )
    assert res.json()["disabled"] is True
    with session_factory() as s:
        assert s.query(EvalConfigPresetVersion).count() == 1


# --------------------------------------------------------------------------- remap


def _schema_v2() -> dict:
    """The fixture after a service release: every kind of drift at once."""
    schema = json.loads(FIXTURE.read_text())
    props = schema["properties"]
    defs = schema["$defs"]
    del props["TABLE_SELECTION_MODE"]  # field removed
    props["MILVUS_SEARCH_THRESHOLD"]["anyOf"][0] = {  # type changed
        "type": "integer",
        "minimum": 0,
        "maximum": 100,
    }
    props["NEW_FEATURE_ENABLED"] = {  # field added
        "anyOf": [{"type": "boolean"}, {"type": "null"}],
        "default": None,
    }
    props["CHART_LLM_MODEL"] = props.pop("VIZ_LLM_MODEL")  # flat slot renamed
    roles = defs["LlmOverrides"]["properties"]
    roles["planner"] = copy.deepcopy(roles.pop("brief"))  # role removed + added
    effort = defs["RoleConfig"]["properties"]["reasoning_effort"]["anyOf"][0]
    effort["enum"] = ["low", "high"]  # enum narrowed
    return schema


def _schemas():
    v1 = EvalEnvironmentSchema(
        schema_hash="hash-v1", schema_json=json.loads(FIXTURE.read_text())
    )
    v2 = EvalEnvironmentSchema(schema_hash="hash-v2", schema_json=_schema_v2())
    return v1, v2


def _drift_doc() -> dict:
    doc = _doc(schema_hash="hash-v1")
    doc["slot_bindings"] = {
        "endpoint:primary": {"connection_id": "c-gpt4o"},
        "endpoint:fast": {"connection_id": "c-mini"},
        "flat:VIZ_LLM": {"connection_id": "c-qwen"},
    }
    doc["env_overrides"] = {
        "TABLE_SELECTION_MODE": "rag",
        "MILVUS_SEARCH_THRESHOLD": 0.7,
        "SQL_RESULT_LIMIT": 500,
        "LLM_OVERRIDES": {
            "endpoints": {"primary": {"timeout": 60}, "fast": {"timeout": 30}},
            "main": {"endpoint": "fast", "temperature": 0.2},
            "brief": {"temperature": 0.5},
            "router": {"reasoning_effort": "medium", "max_tokens": 256},
        },
    }
    return doc


def test_remap_across_schema_hashes():
    v1, v2 = _schemas()
    source = _drift_doc()
    before = copy.deepcopy(source)
    # The document is valid where it was authored.
    v1_slots = [
        p.to_dict() for p in detect_model_slots(build_form_descriptor(v1.schema_json))
    ]
    assert validate_config_document(
        source, env_schema=v1.schema_json, slots=v1_slots, require_dataset=False
    ).ok

    result = eval_presets.remap(source, v1, v2)
    assert source == before  # never mutated
    assert result.errors == []
    assert result.from_schema_hash == "hash-v1"
    assert result.to_schema_hash == "hash-v2"

    config = result.config
    assert config["schema_hash"] == "hash-v2"
    assert config["evaluator"] == before["evaluator"]
    # Bindings carried by slot_key; the renamed flat slot is gone.
    assert config["slot_bindings"] == {
        "endpoint:primary": {"connection_id": "c-gpt4o"},
        "endpoint:fast": {"connection_id": "c-mini"},
    }
    # Values whose pointer exists and validates are kept (templated endpoint and
    # role pointers included); new fields and the new role stay unset.
    assert config["env_overrides"] == {
        "SQL_RESULT_LIMIT": 500,
        "LLM_OVERRIDES": {
            "endpoints": {"primary": {"timeout": 60}, "fast": {"timeout": 30}},
            "main": {"endpoint": "fast", "temperature": 0.2},
            "router": {"max_tokens": 256},
        },
    }

    dropped = {d["pointer"]: d for d in result.dropped}
    assert set(dropped) == {
        "/env_overrides/TABLE_SELECTION_MODE",
        "/env_overrides/LLM_OVERRIDES/brief",
        "/slot_bindings/flat:VIZ_LLM",
        "/env_overrides/MILVUS_SEARCH_THRESHOLD",
        "/env_overrides/LLM_OVERRIDES/router/reasoning_effort",
    }
    assert dropped["/env_overrides/TABLE_SELECTION_MODE"]["reason"] == "removed"
    brief = dropped["/env_overrides/LLM_OVERRIDES/brief"]
    assert brief["reason"] == "removed"
    assert brief["form_pointer"] == "/env_overrides/LLM_OVERRIDES/{role}"
    assert brief["params"] == {"role": "brief"}
    assert brief["section"] == "env_overrides"
    viz = dropped["/slot_bindings/flat:VIZ_LLM"]
    assert viz["reason"] == "slot_removed" and viz["slot_key"] == "flat:VIZ_LLM"
    assert viz["section"] == "slot_bindings"
    milvus = dropped["/env_overrides/MILVUS_SEARCH_THRESHOLD"]
    assert milvus["reason"] == "invalid" and milvus["rule"] == "schema"
    effort = dropped["/env_overrides/LLM_OVERRIDES/router/reasoning_effort"]
    assert effort["reason"] == "invalid"
    assert effort["form_pointer"] == (
        "/env_overrides/LLM_OVERRIDES/{role}/reasoning_effort"
    )
    assert effort["params"] == {"role": "router"}

    assert result.summary.startswith("5 settings no longer supported: ")
    assert "TABLE_SELECTION_MODE" in result.summary
    assert "LLM_OVERRIDES.brief" in result.summary
    assert "model slot flat:VIZ_LLM" in result.summary

    payload = result.to_dict()
    assert json.loads(json.dumps(payload)) == payload
    assert payload["ok"] is True and payload["summary"] == result.summary
    # Values are never echoed in the dropped list.
    assert "rag" not in json.dumps(payload["dropped"])

    # The remapped document validates on the target schema.
    check = validate_config_document(
        config,
        env_schema=v2.schema_json,
        schema_hash="hash-v2",
        require_dataset=False,
    )
    assert check.errors == [] and check.warnings == []


def test_remap_onto_the_same_schema_is_a_no_op():
    v1, _ = _schemas()
    source = _drift_doc()
    result = eval_presets.remap(source, v1, v1)
    assert result.dropped == [] and result.errors == []
    assert result.summary is None
    assert result.config == source


def test_remap_drops_stale_slot_bindings_and_cascades():
    v1, v2 = _schemas()
    slots = [
        {
            "slot_key": "endpoint:primary",
            "status": "confirmed",
            "field_map": {
                "model": "/LLM_OVERRIDES/endpoints/primary/model",
                "base_url": "/LLM_OVERRIDES/endpoints/primary/base_url",
                "api_key": "/LLM_OVERRIDES/endpoints/primary/api_key",
            },
        },
        {
            "slot_key": "endpoint:fast",
            "status": "stale",
            "field_map": {"model": "/LLM_OVERRIDES/endpoints/fast/model"},
        },
    ]
    result = eval_presets.remap(_drift_doc(), v1, v2, to_slots=slots)
    assert result.errors == []
    reasons = {d["pointer"]: d["reason"] for d in result.dropped}
    assert reasons["/slot_bindings/endpoint:fast"] == "slot_stale"
    # Without its model the fast endpoint no longer validates, and neither does the
    # role that referenced it.
    assert reasons["/env_overrides/LLM_OVERRIDES/endpoints/fast"] == "invalid"
    assert reasons["/env_overrides/LLM_OVERRIDES/main/endpoint"] == "invalid"
    llm = result.config["env_overrides"]["LLM_OVERRIDES"]
    assert llm["endpoints"] == {"primary": {"timeout": 60}}
    assert llm["main"] == {"temperature": 0.2}
    assert list(result.config["slot_bindings"]) == ["endpoint:primary"]


def test_remap_never_drops_a_whole_collection_for_a_missing_key():
    v1, v2 = _schemas()
    slots = [
        {"slot_key": "endpoint:primary", "status": "stale", "field_map": {}},
        {
            "slot_key": "endpoint:fast",
            "status": "confirmed",
            "field_map": {"model": "/LLM_OVERRIDES/endpoints/fast/model"},
        },
    ]
    result = eval_presets.remap(_drift_doc(), v1, v2, to_slots=slots)
    reasons = {d["pointer"]: d["reason"] for d in result.dropped}
    assert reasons["/slot_bindings/endpoint:primary"] == "slot_stale"
    assert reasons["/env_overrides/LLM_OVERRIDES/endpoints/primary"] == "invalid"
    # The fast endpoint and the role using it survive; the missing primary is
    # reported for the user to rebind instead of wiping every endpoint.
    llm = result.config["env_overrides"]["LLM_OVERRIDES"]
    assert llm["endpoints"] == {"fast": {"timeout": 30}}
    assert llm["main"] == {"endpoint": "fast", "temperature": 0.2}
    assert [e["rule"] for e in result.errors] == ["required_keys"]


def test_remap_reports_what_it_cannot_fix():
    v1, v2 = _schemas()
    v2.schema_json["properties"]["NEW_FEATURE_ENABLED"] = {"type": "boolean"}
    v2.schema_json["required"] = ["NEW_FEATURE_ENABLED"]
    result = eval_presets.remap(_drift_doc(), v1, v2)
    assert [e["pointer"] for e in result.errors] == [
        "/env_overrides/NEW_FEATURE_ENABLED"
    ]
    assert result.to_dict()["ok"] is False
    # Unrelated values are still kept.
    assert result.config["env_overrides"]["SQL_RESULT_LIMIT"] == 500


def test_version_read_can_remap_onto_current_schema(client, env, session_factory):
    doc = _doc()
    doc["env_overrides"]["LLM_OVERRIDES"]["brief"] = {"temperature": 0.5}
    doc["slot_bindings"]["flat:VIZ_LLM"] = {"connection_id": "c-gpt4o"}
    preset = _official(client, env["id"], config=doc)
    stored = preset["current_version"]["config"]
    url = _presets_url(env["id"], f"/{preset['id']}/versions/1")

    same = client.get(url + "?remap=current", headers=_headers(MEMBER)).json()
    assert same["remap"]["dropped"] == [] and same["remap"]["summary"] is None

    with session_factory() as s:
        row = s.get(EvalEnvironment, env["id"])
        schema = EvalEnvironmentSchema(
            environment_id=row.id, schema_hash="hash-v2", schema_json=_schema_v2()
        )
        s.add(schema)
        s.flush()
        row.current_schema_id = schema.id
        s.commit()

    plain = client.get(url, headers=_headers(MEMBER)).json()
    assert "remap" not in plain
    assert client.get(url + "?remap=bogus", headers=_headers(MEMBER)).status_code == 422

    res = client.get(url + "?remap=current", headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["version"]["schema_current"] is False
    assert body["version"]["config"] == stored
    remapped = body["remap"]
    assert remapped["to_schema_hash"] == "hash-v2"
    assert remapped["from_schema_hash"] == env["schema_hash"]
    assert remapped["config"]["schema_hash"] == "hash-v2"
    assert {d["pointer"] for d in remapped["dropped"]} == {
        "/env_overrides/TABLE_SELECTION_MODE",
        "/env_overrides/LLM_OVERRIDES/brief",
        "/slot_bindings/flat:VIZ_LLM",
        "/env_overrides/MILVUS_SEARCH_THRESHOLD",
    }
    assert remapped["summary"].startswith("4 settings no longer supported")
    assert remapped["config"]["slot_bindings"] == {
        "endpoint:primary": {"connection_id": "c-gpt4o"}
    }

    # The stored version is untouched.
    with session_factory() as s:
        version = s.get(EvalConfigPresetVersion, preset["current_version_id"])
        assert version.config == stored


def test_saved_preset_round_trips_every_evaluation_value(client, env):
    """What the launch form saves is what it loads back (Evaluation config tab):
    nested overrides, role cells, evaluator.config inputs, run_metadata, report_k."""
    doc = _doc()
    doc["evaluator"]["report_k"] = 2
    doc["evaluator"]["config"].update(
        {"max_retries": 4, "force_model_override": True, "timeout": 120.5}
    )
    doc["evaluator"]["config"]["run_metadata"] = {"team": "rag", "tier": 2}
    doc["env_overrides"]["BRIEF_ENABLED"] = False
    doc["env_overrides"]["SQL_RESULT_LIMIT"] = 50
    res = _create(client, env["id"], email=MEMBER, name="Everything", config=doc)
    assert res.status_code == 200, res.text
    preset = res.json()["preset"]
    url = _presets_url(env["id"], f"/{preset['id']}/versions/1?remap=current")
    body = client.get(url, headers=_headers(MEMBER)).json()
    remapped = body["remap"]
    assert remapped["dropped"] == [] and remapped["errors"] == []
    for section in ("evaluator", "slot_bindings", "env_overrides"):
        assert remapped["config"][section] == doc[section], section
        assert body["version"]["config"][section] == doc[section], section
