"""LLM connections: the ``available_for_experiments`` flag and its picker filter."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
os.environ.setdefault(
    "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
)
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
SDK_SRC = ROOT / "packages" / "sdk"
for src in (PLATFORM_SRC, SDK_SRC):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import Project, ProjectLlmConnection, User, UserRole
from qym_platform.deps import get_db
from qym_platform.services.llm_connections import (
    list_experiment_connections,
    project_connections_query,
)

PROJECT_ID = "proj-1"
OTHER_PROJECT_ID = "proj-2"
CONNECTIONS_URL = f"/v1/projects/{PROJECT_ID}/llm-connections"
ADMIN = "user@example.com"


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as session:
        # Admins have access to every project, so no membership rows are needed.
        session.add(User(id="user-1", email=ADMIN, role=UserRole.ADMIN))
        for pid in (PROJECT_ID, OTHER_PROJECT_ID):
            session.add(
                Project(id=pid, name=pid, slug=pid, created_by_user_id="user-1")
            )
        session.commit()
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _headers() -> dict[str, str]:
    # Origin matches the default base_url so the same-origin write guard allows writes.
    return {"X-User-Email": ADMIN, "Origin": "http://localhost:8000"}


def _create(client, name: str, **extra) -> dict:
    res = client.post(
        CONNECTIONS_URL,
        headers=_headers(),
        json={"name": name, "llm_api_key": "sk-secret-1234", **extra},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _update(client, conn_id: str, **fields) -> dict:
    res = client.put(
        f"{CONNECTIONS_URL}/{conn_id}",
        headers=_headers(),
        json={"llm_api_key": "__KEEP__", **fields},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_create_defaults_to_available(client, session_factory) -> None:
    created = _create(client, "c1")
    assert created["available_for_experiments"] is True
    with session_factory() as session:
        conn = session.get(ProjectLlmConnection, created["id"])
        assert conn.available_for_experiments is True


def test_create_can_opt_out(client, session_factory) -> None:
    created = _create(client, "analyzer", available_for_experiments=False)
    assert created["available_for_experiments"] is False
    listing = client.get(CONNECTIONS_URL, headers=_headers()).json()["connections"]
    assert listing[0]["available_for_experiments"] is False
    with session_factory() as session:
        conn = session.get(ProjectLlmConnection, created["id"])
        assert conn.available_for_experiments is False


def test_update_toggles_and_omission_keeps_value(client, session_factory) -> None:
    conn_id = _create(client, "c1")["id"]

    off = _update(client, conn_id, name="c1", available_for_experiments=False)
    assert off["available_for_experiments"] is False

    # Clients that don't send the field must not flip it back on.
    renamed = _update(client, conn_id, name="c1b")
    assert renamed["available_for_experiments"] is False

    on = _update(client, conn_id, name="c1b", available_for_experiments=True)
    assert on["available_for_experiments"] is True
    with session_factory() as session:
        assert session.get(ProjectLlmConnection, conn_id).available_for_experiments


def test_list_endpoint_filters_by_availability(client) -> None:
    _create(client, "a")
    _create(client, "b", available_for_experiments=False)
    _create(client, "c")

    def names(params=None) -> list[str]:
        res = client.get(CONNECTIONS_URL, headers=_headers(), params=params)
        assert res.status_code == 200
        return [x["name"] for x in res.json()["connections"]]

    assert names() == ["a", "b", "c"]
    assert names({"available_for_experiments": "true"}) == ["a", "c"]
    assert names({"available_for_experiments": "false"}) == ["b"]


def test_list_experiment_connections_helper(session_factory) -> None:
    with session_factory() as session:
        session.add_all(
            [
                ProjectLlmConnection(
                    id="c-on", project_id=PROJECT_ID, name="experiment model"
                ),
                ProjectLlmConnection(
                    id="c-off",
                    project_id=PROJECT_ID,
                    name="analyzer only",
                    available_for_experiments=False,
                ),
                ProjectLlmConnection(
                    id="c-default",
                    project_id=PROJECT_ID,
                    name="default",
                    is_default=True,
                ),
                ProjectLlmConnection(
                    id="c-other", project_id=OTHER_PROJECT_ID, name="other project"
                ),
            ]
        )
        session.commit()

        ids = [c.id for c in list_experiment_connections(session, PROJECT_ID)]
        # Default first; opted-out and other projects' connections are excluded.
        assert ids == ["c-default", "c-on"]

        everything = project_connections_query(session, PROJECT_ID).all()
        assert {c.id for c in everything} == {"c-default", "c-off", "c-on"}
        assert list_experiment_connections(session, "missing-project") == []


def test_draft_test_checks_the_form_values_before_a_save(client, monkeypatch):
    """C157: Test connection works on unsaved values, with the rules a save applies."""
    from types import SimpleNamespace

    from qym_platform.api import projects as projects_api

    seen = {}

    async def provider(client_obj, **kwargs):
        seen["model"] = kwargs["model"]
        seen["key"] = client_obj.api_key
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])

    monkeypatch.setattr(projects_api, "create_chat_completion_compat", provider)
    url = f"{CONNECTIONS_URL}/test"
    ok = client.post(
        url,
        headers=_headers(),
        json={"llm_base_url": "https://llm.example.com/v1", "llm_model": "m-1", "llm_api_key": "sk-new"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["ok"] is True and seen == {"model": "m-1", "key": "sk-new"}

    # The experiments https rule answers as a save does (this fixture allows private hosts).
    body = {"llm_base_url": "http://llm.example.com/v1", "llm_api_key": "sk", "available_for_experiments": True}
    plain = client.post(url, headers=_headers(), json=body)
    save = client.post(CONNECTIONS_URL, headers=_headers(), json={"name": "plain", **body})
    assert plain.status_code == save.status_code

    # A saved connection's key is used on its own host, and refused on another.
    saved = _create(client, "stored", llm_base_url="https://llm.example.com/v1")
    same = client.post(
        url,
        headers=_headers(),
        json={"llm_base_url": "https://llm.example.com/v2", "connection_id": saved["id"]},
    )
    assert same.status_code == 200 and seen["key"] == "sk-secret-1234"
    other = client.post(
        url,
        headers=_headers(),
        json={"llm_base_url": "https://evil.example.com/v1", "connection_id": saved["id"]},
    )
    assert other.status_code == 400

    no_key = client.post(url, headers=_headers(), json={"llm_base_url": "https://llm.example.com/v1"})
    assert no_key.status_code == 400 and "API key" in no_key.json()["detail"]
