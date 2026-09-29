"""Environments API (plan §5.1): permissions, key masking, URL rules, schema refresh."""

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

from qym_platform.api import eval_environments as env_api
from qym_platform.api.eval_environments import get_eval_client_factory
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalModelSlot,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.services.eval_service_client import EvalServiceClient

FIXTURE = Path(__file__).parent / "fixtures" / "eval_env_overrides_schema.json"
P1, P2 = "project-1", "project-2"
ADMIN = "admin@example.com"
MANAGER = "manager@example.com"
MEMBER = "member@example.com"
OUTSIDER = "outsider@example.com"
KEY = "eval-secret-key-9876"
URL = "https://eval.example.com/prefix"


def _url(project_id: str = P1, suffix: str = "") -> str:
    return f"/v1/projects/{project_id}/eval-environments{suffix}"


def _headers(email: str) -> dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


class FakeService:
    """In-memory Evaluation Service behind ``httpx.MockTransport``."""

    def __init__(self) -> None:
        self.schema = json.loads(FIXTURE.read_text())
        self.valid_keys = {KEY, "rotated-key-5555"}
        self.requests: list[httpx.Request] = []
        self.down = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("connection refused")
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if token not in self.valid_keys:
            return httpx.Response(401, json={"detail": "Invalid or missing API key"})
        path = request.url.path
        if path.endswith("/evals/env-overrides/schema"):
            return httpx.Response(200, json=self.schema)
        if path.endswith("/evals"):
            return httpx.Response(
                200, json={"total": 0, "limit": 1, "offset": 0, "items": []}
            )
        return httpx.Response(404, json={"detail": "Not Found"})


@pytest.fixture()
def service() -> FakeService:
    return FakeService()


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "false")
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
                User(id="outsider-1", email=OUTSIDER, role=UserRole.MEMBER),
                Project(
                    id=P1, name="Project One", slug="p1", created_by_user_id="admin-1"
                ),
                Project(
                    id=P2, name="Project Two", slug="p2", created_by_user_id="admin-1"
                ),
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
                    project_id=P2, user_id="outsider-1", role=ProjectRole.MANAGER
                ),
            ]
        )
        s.commit()
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory, service):
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


def _create(client, email=MANAGER, project_id=P1, **extra):
    body = {"name": "staging", "base_url": URL, "api_key": KEY, **extra}
    return client.post(_url(project_id), headers=_headers(email), json=body)


def _created(client, **extra) -> dict:
    res = _create(client, **extra)
    assert res.status_code == 200, res.text
    return res.json()


# --------------------------------------------------------------------------- create


def test_create_tests_fetches_schema_and_proposes_slots(
    client, session_factory, service
):
    body = _created(client, base_url="HTTPS://Eval.Example.COM:443/prefix/evals/")
    env = body["environment"]
    assert env["base_url"] == URL
    assert env["health_status"] == "ok"
    assert env["schema_hash"] and env["current_schema_id"]
    assert env["api_key_set"] is True
    assert env["api_key_hint"] == "••••9876"
    assert env["allow_connection_keys"] is False
    assert body["needs_confirmation"] is True
    keys = {s["slot_key"]: s for s in body["slots"]}
    assert keys["endpoint:primary"]["required"] is True
    assert keys["endpoint:primary"]["status"] == "proposed"

    # Auth probe then schema fetch, both authenticated with the env key.
    paths = [r.url.path for r in service.requests]
    assert paths == ["/prefix/evals", "/prefix/evals/env-overrides/schema"]
    assert service.requests[0].url.params["limit"] == "1"

    with session_factory() as s:
        row = s.get(EvalEnvironment, env["id"])
        assert KEY not in row.api_key_encrypted
        assert row.api_key_last4 == "9876"
        schema = s.get(EvalEnvironmentSchema, row.current_schema_id)
        assert schema.form_descriptor and schema.form_descriptor["fields"]
        assert s.query(EvalModelSlot).filter_by(schema_id=schema.id).count() == len(
            body["slots"]
        )


def test_key_never_returned(client):
    responses = [_create(client)]
    env_id = responses[0].json()["environment"]["id"]
    for suffix in ("", f"/{env_id}", f"/{env_id}/form", f"/{env_id}/model-slots"):
        responses.append(client.get(_url(suffix=suffix), headers=_headers(MEMBER)))
    responses.append(
        client.post(_url(suffix=f"/{env_id}/test"), headers=_headers(MANAGER))
    )
    for res in responses:
        assert res.status_code == 200, res.text
        assert KEY not in res.text
        assert "api_key_encrypted" not in res.text


def test_short_key_gets_no_hint(client, service):
    service.valid_keys.add("abc12")
    env = _created(client, api_key="abc12")["environment"]
    assert env["api_key_set"] is True
    assert env["api_key_hint"] == ""


def test_create_refused_without_encryption_key(client, session_factory, monkeypatch):
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", raising=False)
    res = _create(client)
    assert res.status_code == 400
    assert "QYM_LLM_CONFIG_ENCRYPTION_KEY" in res.json()["detail"]
    with session_factory() as s:
        assert s.query(EvalEnvironment).count() == 0


def test_https_required_unless_private_allowed(client, monkeypatch):
    res = _create(client, base_url="http://eval.example.com")
    assert res.status_code == 400
    assert "https" in res.json()["detail"]
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    assert _create(client, base_url="http://eval.example.com").status_code == 200


@pytest.mark.parametrize(
    "bad",
    ["ftp://eval.example.com", "https://user:pw@eval.example.com", "https://x.io/?a=1"],
)
def test_invalid_urls_refused(client, bad):
    assert _create(client, base_url=bad).status_code == 400


def test_private_address_refused_by_default(client):
    assert _create(client, base_url="https://10.0.0.5").status_code == 400


def test_bad_env_key_refuses_create(client, session_factory):
    res = _create(client, api_key="wrong-key-0000")
    assert res.status_code == 400
    assert "rejected the environment API key" in res.json()["detail"]
    assert "wrong-key-0000" not in res.text
    with session_factory() as s:
        assert s.query(EvalEnvironment).count() == 0


def test_unreachable_service_refuses_create(client, service, session_factory):
    service.down = True
    res = _create(client)
    assert res.status_code == 502
    with session_factory() as s:
        assert s.query(EvalEnvironment).count() == 0


def test_duplicate_name_in_project_refused(client):
    _created(client)
    res = _create(client, base_url="https://other.example.com")
    assert res.status_code == 409


# --------------------------------------------------------------------------- URL ownership


def test_duplicate_base_url_in_other_project_names_owner(client):
    _created(client, base_url="https://eval.example.com/prefix/")
    for variant in (URL, "HTTPS://EVAL.example.com/prefix", URL + "/evals"):
        res = _create(client, email=OUTSIDER, project_id=P2, base_url=variant)
        assert res.status_code == 409, variant
        assert res.json()["detail"] == (
            "This environment already belongs to project 'Project One'"
        )


def test_duplicate_base_url_in_same_project_refused(client):
    _created(client)
    res = _create(client, name="again")
    assert res.status_code == 409
    assert "already registered in this project as 'staging'" in res.json()["detail"]


def test_put_base_url_to_taken_url_refused(client):
    _created(client)
    other = _created(
        client, email=OUTSIDER, project_id=P2, base_url="https://b.example.com"
    )["environment"]
    res = client.put(
        _url(P2, f"/{other['id']}"),
        headers=_headers(OUTSIDER),
        json={"base_url": URL + "/"},
    )
    assert res.status_code == 409
    assert "Project One" in res.json()["detail"]


# --------------------------------------------------------------------------- permissions


def test_member_reads_manager_writes(client):
    env_id = _created(client)["environment"]["id"]
    for suffix in ("", f"/{env_id}", f"/{env_id}/form", f"/{env_id}/model-slots"):
        assert (
            client.get(_url(suffix=suffix), headers=_headers(MEMBER)).status_code == 200
        )

    member = _headers(MEMBER)
    assert (
        _create(client, email=MEMBER, name="m", base_url="https://m.io").status_code
        == 403
    )
    assert (
        client.put(
            _url(suffix=f"/{env_id}"), headers=member, json={"name": "x"}
        ).status_code
        == 403
    )
    assert (
        client.post(_url(suffix=f"/{env_id}/test"), headers=member).status_code == 403
    )
    assert (
        client.post(
            _url(suffix=f"/{env_id}/schema/refresh"), headers=member
        ).status_code
        == 403
    )
    assert (
        client.put(
            _url(suffix=f"/{env_id}/model-slots"), headers=member, json={"slots": []}
        ).status_code
        == 403
    )
    assert client.delete(_url(suffix=f"/{env_id}"), headers=member).status_code == 403

    # Admins act as managers everywhere.
    res = client.put(
        _url(suffix=f"/{env_id}"), headers=_headers(ADMIN), json={"description": "d"}
    )
    assert res.status_code == 200


def test_outsider_cannot_read_or_reach_other_projects_env(client):
    env_id = _created(client)["environment"]["id"]
    assert client.get(_url(), headers=_headers(OUTSIDER)).status_code == 403
    assert (
        client.get(_url(suffix=f"/{env_id}"), headers=_headers(OUTSIDER)).status_code
        == 403
    )
    # A manager of P2 can't address P1's environment through P2's path.
    res = client.put(
        _url(P2, f"/{env_id}"), headers=_headers(OUTSIDER), json={"name": "x"}
    )
    assert res.status_code == 404
    assert (
        client.delete(_url(P2, f"/{env_id}"), headers=_headers(OUTSIDER)).status_code
        == 404
    )


def test_connection_key_opt_in_is_manager_only(client, session_factory):
    env_id = _created(client)["environment"]["id"]
    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MEMBER),
        json={"allow_connection_keys": True},
    )
    assert res.status_code == 403
    with session_factory() as s:
        assert s.get(EvalEnvironment, env_id).allow_connection_keys is False

    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MANAGER),
        json={"allow_connection_keys": True, "max_priority": "HIGH"},
    )
    assert res.status_code == 200
    assert res.json()["allow_connection_keys"] is True
    assert res.json()["max_priority"] == "HIGH"


def test_default_priority_cannot_exceed_max(client):
    res = _create(client, default_priority="HIGH", max_priority="NORMAL")
    assert res.status_code == 400


# --------------------------------------------------------------------------- update


def test_put_blank_key_keeps_stored_key(client, session_factory):
    env_id = _created(client)["environment"]["id"]
    with session_factory() as s:
        before = s.get(EvalEnvironment, env_id).api_key_encrypted
    for blank in ("", "   ", "__KEEP__", None):
        res = client.put(
            _url(suffix=f"/{env_id}"),
            headers=_headers(MANAGER),
            json={"api_key": blank, "description": "x"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["api_key_hint"] == "••••9876"
    with session_factory() as s:
        assert s.get(EvalEnvironment, env_id).api_key_encrypted == before

    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MANAGER),
        json={"api_key": "rotated-key-5555"},
    )
    body = res.json()
    assert body["api_key_hint"] == "••••5555"
    assert body["health_status"] == "unknown"
    assert "rotated-key-5555" not in res.text
    test = client.post(_url(suffix=f"/{env_id}/test"), headers=_headers(MANAGER))
    assert test.json()["ok"] is True


# --------------------------------------------------------------------------- delete


def test_delete_unused_hard_deletes(client, session_factory):
    env_id = _created(client)["environment"]["id"]
    res = client.delete(_url(suffix=f"/{env_id}"), headers=_headers(MANAGER))
    assert res.json() == {"ok": True, "id": env_id, "deleted": True, "disabled": False}
    with session_factory() as s:
        assert s.get(EvalEnvironment, env_id) is None
        assert s.query(EvalEnvironmentSchema).count() == 0
        assert s.query(EvalModelSlot).count() == 0
    # The URL is free again.
    assert _create(client, email=OUTSIDER, project_id=P2).status_code == 200


def test_delete_in_use_soft_disables_and_reactivation_conflict(
    client, session_factory, monkeypatch
):
    env_id = _created(client)["environment"]["id"]
    monkeypatch.setattr(env_api, "_environment_in_use", lambda db, env: True)
    res = client.delete(_url(suffix=f"/{env_id}"), headers=_headers(MANAGER))
    assert res.json()["disabled"] is True
    with session_factory() as s:
        assert s.get(EvalEnvironment, env_id).is_active is False
    listed = client.get(_url(), headers=_headers(MEMBER), params={"active": True})
    assert listed.json()["environments"] == []

    # The URL of a disabled env can be registered by another project...
    assert _create(client, email=OUTSIDER, project_id=P2).status_code == 200
    # ...and then the disabled env can't come back while the URL is taken.
    res = client.put(
        _url(suffix=f"/{env_id}"), headers=_headers(MANAGER), json={"is_active": True}
    )
    assert res.status_code == 409
    assert res.json()["detail"].startswith("Cannot reactivate")
    assert "Project Two" in res.json()["detail"]


# --------------------------------------------------------------------------- test / refresh


def test_test_endpoint_records_health(client, service, session_factory):
    env_id = _created(client)["environment"]["id"]
    service.valid_keys = {"something-else"}
    res = client.post(_url(suffix=f"/{env_id}/test"), headers=_headers(MANAGER))
    assert res.status_code == 200
    assert res.json()["ok"] is False
    assert KEY not in res.text
    with session_factory() as s:
        env = s.get(EvalEnvironment, env_id)
        assert env.health_status == "error"
        assert "API key" in env.health_error
    service.valid_keys = {KEY}
    body = client.post(_url(suffix=f"/{env_id}/test"), headers=_headers(MANAGER)).json()
    assert body["ok"] is True and body["schema_changed"] is False


def _schema_b(schema: dict) -> dict:
    new = copy.deepcopy(schema)
    props = new["properties"]
    props.pop("REQUEST_TIMEOUT")
    props["NEW_FLAG"] = {
        "anyOf": [{"type": "boolean"}, {"type": "null"}],
        "default": None,
    }
    props["SQL_RESULT_LIMIT"] = {
        "anyOf": [{"type": "string"}, {"type": "null"}],
        "default": None,
    }
    return new


def test_schema_refresh_diff_and_revert_keeps_confirmed_slots(
    client, service, session_factory
):
    created = _created(client)
    env_id = created["environment"]["id"]
    schema_a_id = created["environment"]["current_schema_id"]
    refresh = _url(suffix=f"/{env_id}/schema/refresh")

    same = client.post(refresh, headers=_headers(MANAGER)).json()
    assert same["changed"] is False
    assert same["added"] == same["removed"] == same["changed_types"] == []
    assert same["schema_id"] == schema_a_id

    schema_a = service.schema
    service.schema = _schema_b(schema_a)
    res = client.post(refresh, headers=_headers(MANAGER))
    assert res.status_code == 200, res.text
    diff = res.json()
    assert diff["changed"] is True
    assert "/NEW_FLAG" in diff["added"]
    assert "/REQUEST_TIMEOUT" in diff["removed"]
    assert {"pointer": "/SQL_RESULT_LIMIT", "from": "integer", "to": "string"} in diff[
        "changed_types"
    ]
    schema_b_id = diff["schema_id"]
    assert schema_b_id != schema_a_id

    # Confirm on B with a custom label.
    slots = client.get(
        _url(suffix=f"/{env_id}/model-slots"), headers=_headers(MANAGER)
    ).json()["slots"]
    payload = []
    for slot in slots:
        item = {
            k: slot[k]
            for k in ("slot_key", "kind", "label", "field_map", "transport_fields")
        }
        if slot["slot_key"] == "endpoint:primary":
            item["label"] = "Main model"
        payload.append(item)
    res = client.put(
        _url(suffix=f"/{env_id}/model-slots"),
        headers=_headers(MANAGER),
        json={"slots": payload, "schema_id": schema_b_id},
    )
    assert res.status_code == 200, res.text
    assert res.json()["needs_confirmation"] is False

    # Revert to A: the existing row is reused and B's confirmations carry over.
    service.schema = schema_a
    back = client.post(refresh, headers=_headers(MANAGER)).json()
    assert back["changed"] is True
    assert back["schema_id"] == schema_a_id
    assert back["previous_schema_id"] == schema_b_id
    primary = next(s for s in back["slots"] if s["slot_key"] == "endpoint:primary")
    assert primary["status"] == "confirmed"
    assert primary["label"] == "Main model"
    with session_factory() as s:
        assert (
            s.query(EvalEnvironmentSchema).filter_by(environment_id=env_id).count() == 2
        )


def test_refresh_auth_failure_maps_to_400(client, service):
    env_id = _created(client)["environment"]["id"]
    service.valid_keys = set()
    res = client.post(
        _url(suffix=f"/{env_id}/schema/refresh"), headers=_headers(MANAGER)
    )
    assert res.status_code == 400
    assert KEY not in res.text


# --------------------------------------------------------------------------- form / slots


def test_form_returns_cached_descriptor(client):
    env = _created(client)["environment"]
    res = client.get(_url(suffix=f"/{env['id']}/form"), headers=_headers(MEMBER))
    body = res.json()
    assert body["schema_id"] == env["current_schema_id"]
    assert body["schema_hash"] == env["schema_hash"]
    assert "/MILVUS_SEARCH_THRESHOLD" in body["descriptor"]["fields"]


def test_model_slots_validation_and_stale_schema(client):
    env = _created(client)["environment"]
    slots_url = _url(suffix=f"/{env['id']}/model-slots")
    res = client.put(slots_url, headers=_headers(MANAGER), json={"slots": []})
    assert res.status_code == 422  # primary is required
    assert res.json()["detail"]["errors"]
    res = client.put(
        slots_url, headers=_headers(MANAGER), json={"slots": [], "schema_id": "old"}
    )
    assert res.status_code == 409

    preview = client.get(
        slots_url, headers=_headers(MEMBER), params={"propose_endpoint": "fast"}
    ).json()
    assert preview["proposal"]["slot_key"] == "endpoint:fast"


def test_key_with_control_characters_refused(client, service):
    res = _create(client, api_key="abc\ndef-1234")
    assert res.status_code == 400
    assert service.requests == []


def test_url_change_resets_connection_key_opt_in(client):
    env_id = _created(client, allow_connection_keys=True)["environment"]["id"]
    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MANAGER),
        json={"base_url": "https://moved.example.com"},
    )
    body = res.json()
    assert body["base_url"] == "https://moved.example.com"
    assert body["allow_connection_keys"] is False
    assert body["health_status"] == "unknown"
    # Re-opting in together with the URL change is explicit and allowed.
    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MANAGER),
        json={"base_url": "https://moved2.example.com", "allow_connection_keys": True},
    )
    assert res.json()["allow_connection_keys"] is True
