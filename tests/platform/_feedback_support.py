"""Shared helpers for the feedback tests: an app on SQLite or PostgreSQL, users, a configured stub connection."""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Any, Iterator, Optional
from uuid import uuid4

from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

KEY = Fernet.generate_key().decode()
SECRET = "sk-feedback-secret-ABCD1234"


def parse_sse(body: str) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for block in body.split("\n\n"):
        event, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if event:
            events.append((event, data or {}))
    return events


class Env:
    def __init__(self, app, factory, client, engine):
        self.app, self.factory, self.client, self.engine = app, factory, client, engine
        self.users: dict[str, str] = {}

    def db(self):
        return self.factory()

    def make_user(self, key: str, role: str = "MEMBER") -> str:
        from qym_platform.db.models import User, UserRole

        uid = f"user-{key}"
        with self.db() as db:
            db.add(User(id=uid, email=f"{key}@example.test", display_name=key.title(), role=UserRole(role)))
            db.commit()
        self.users[key] = uid
        return uid

    def act_as(self, key: str) -> None:
        """Make the next requests come from this user (a UI principal)."""
        from qym_platform.auth import Principal, require_ui_principal
        from qym_platform.db.models import User

        def principal():
            with self.db() as db:
                user = db.get(User, self.users[key])
                db.expunge(user)
            return Principal(user=user, auth_type="proxy_headers", provider="proxy_headers")

        self.app.dependency_overrides[require_ui_principal] = principal

    def configure(self, base_url: str, script: str = "ask_then_propose", **extra: Any) -> None:
        self.act_as("admin")
        body = {"llm_base_url": base_url, "llm_model": f"feedback:{script}", "llm_api_key": SECRET, **extra}
        r = self.client.put("/v1/admin/feedback-agent", json=body)
        assert r.status_code == 200, r.text

    def set_script(self, script: str) -> None:
        with self.db() as db:
            from qym_platform.db.feedback_models import FeedbackAgentConnection

            db.get(FeedbackAgentConnection, 1).llm_model = f"feedback:{script}"
            db.commit()

    def confirmed(self, key: str, title: str, *, number: int, subject: str = "platform", status: str = "new", **fields: Any) -> str:
        from datetime import datetime

        from qym_platform.db.feedback_models import FeedbackRequest
        from qym_platform.feedback_agent.text import search_text

        with self.db() as db:
            row = FeedbackRequest(
                number=number,
                subject=subject,
                title=title,
                summary=fields.pop("summary", title),
                description=fields.pop("description", "A long enough description of the request."),
                business_need=fields.pop("business_need", ""),
                justification="",
                priority=fields.pop("priority", "medium"),
                complexity=fields.pop("complexity", "M"),
                status=status,
                submitter_user_id=self.users[key],
                confirmed_at=datetime.utcnow(),
                created_at=fields.pop("created_at", datetime.utcnow()),
                checklist={},
                conflicts=fields.pop("conflicts", []),
                agent_reasoning={},
                **fields,
            )
            row.search_text = search_text(row.title, row.summary, row.business_need)
            db.add(row)
            db.commit()
            return row.id


@contextmanager
def make_env(monkeypatch, backend: str = "sqlite") -> Iterator[Env]:
    from fastapi.testclient import TestClient

    from qym_platform.app import create_app
    from qym_platform.db.base import Base
    from qym_platform.db import models  # noqa: F401
    from qym_platform.deps import get_db
    from qym_platform.secrets import _fernet_for_key, _multi_fernet_for_keys

    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", KEY)
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    monkeypatch.setenv("QYM_FEEDBACK_MESSAGES_PER_HOUR", "0")
    monkeypatch.setenv("QYM_FEEDBACK_DRAFTS_PER_DAY", "0")
    admin = schema = None
    if backend == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            import pytest

            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_fbk_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            env = Env(app, factory, client, engine)
            env.make_user("admin", "ADMIN")
            env.make_user("sara")
            env.make_user("omar")
            env.act_as("sara")
            yield env
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
