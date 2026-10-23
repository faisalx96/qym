"""Migration 0091 (AI-assisted feedback): matches the models, round-trips, runs on SQLite and PostgreSQL (QE-169)."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

ROOT = Path(__file__).resolve().parents[2]
FILE = ROOT / "packages/platform/qym_platform/migrations/versions/0091_feedback.py"
FEEDBACK_TABLES = {
    "feedback_requests",
    "feedback_messages",
    "feedback_request_events",
    "feedback_agent_connection",
}


def _load():
    spec = importlib.util.spec_from_file_location("migration_0091", FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(params=["sqlite", "postgres"])
def engine(request):
    from qym_platform.db import models
    from qym_platform.db.base import Base

    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_fb_" + uuid4().hex
        admin = sa.create_engine(url)
        with admin.begin() as conn:
            conn.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
        eng = sa.create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        eng = sa.create_engine("sqlite://")
    Base.metadata.create_all(
        eng, tables=[Base.metadata.tables["users"], Base.metadata.tables["projects"]]
    )
    try:
        yield eng
    finally:
        eng.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def test_revision_chain_names_0088() -> None:
    module = _load()
    assert (module.revision, module.down_revision) == ("0091", "0088")


def test_matches_models_and_round_trips(engine, monkeypatch) -> None:
    from qym_platform.db.base import Base

    module = _load()

    def include(obj, name, kind, reflected, compare_to):
        table = obj if kind == "table" else getattr(obj, "table", None)
        return table is not None and table.name in FEEDBACK_TABLES

    with engine.begin() as connection:
        monkeypatch.setattr(
            module, "op", Operations(MigrationContext.configure(connection))
        )
        module.upgrade()
        assert FEEDBACK_TABLES <= set(sa.inspect(connection).get_table_names())
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": include}
        )
        assert compare_metadata(context, Base.metadata) == []
        module.downgrade()
        assert not FEEDBACK_TABLES & set(sa.inspect(connection).get_table_names())
        module.upgrade()
        assert FEEDBACK_TABLES <= set(sa.inspect(connection).get_table_names())


def test_constraints_hold_after_the_migration(engine, monkeypatch) -> None:
    module = _load()
    now = "2026-10-23 10:00:00"
    with engine.begin() as connection:
        monkeypatch.setattr(
            module, "op", Operations(MigrationContext.configure(connection))
        )
        module.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO users (id, email, display_name, title, role, is_active, created_at, updated_at) "
                "VALUES ('u', 'u@example.test', 'U', '', 'MEMBER', :t, :n, :n)"
            ),
            {"t": True, "n": now},
        )
        base = {
            "id": "r1",
            "subject": "product",
            "pid": None,
            "status": "draft",
            "u": "u",
            "n": now,
        }
        insert = sa.text(
            "INSERT INTO feedback_requests (id, subject, project_id, title, summary, description, business_need, "
            "justification, agent_reasoning, checklist, status, conflicts, search_text, submitter_user_id, "
            "last_activity_at, created_at, updated_at) VALUES (:id, :subject, :pid, '', '', '', '', '', "
            "'{}', '{}', :status, '[]', '', :u, :n, :n, :n)"
        )
        with pytest.raises(sa.exc.IntegrityError):  # product needs a project
            with connection.begin_nested():
                connection.execute(insert, base)
        with pytest.raises(sa.exc.IntegrityError):  # unknown status
            with connection.begin_nested():
                connection.execute(
                    insert, {**base, "subject": "platform", "status": "weird"}
                )
        connection.execute(insert, {**base, "subject": "platform"})
        with pytest.raises(sa.exc.IntegrityError):  # the connection is a singleton
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "INSERT INTO feedback_agent_connection (id, llm_base_url, llm_model, llm_api_key_encrypted, "
                        "llm_api_key_last4, draft_retention_days, max_user_messages, created_at, updated_at) "
                        "VALUES (2, '', '', '', '', 30, 30, :n, :n)"
                    ),
                    {"n": now},
                )
