import os
import threading
from pathlib import Path
from uuid import uuid4

import pytest
from qym_platform.db.migration_lock import (
    MIGRATION_LOCK_CLASS,
    migration_guard,
    migration_lock_timeout,
)
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

MIGRATIONS = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "platform"
    / "qym_platform"
    / "migrations"
)


def test_lock_timeout_defaults_and_validates(monkeypatch):
    monkeypatch.delenv("QYM_MIGRATION_LOCK_TIMEOUT", raising=False)
    assert migration_lock_timeout() == "10s"
    for value in ("500ms", "0", "2min", "30"):
        monkeypatch.setenv("QYM_MIGRATION_LOCK_TIMEOUT", value)
        assert migration_lock_timeout() == value
    monkeypatch.setenv("QYM_MIGRATION_LOCK_TIMEOUT", "1s'; DROP TABLE runs; --")
    with pytest.raises(ValueError):
        migration_lock_timeout()


def test_guard_is_a_no_op_on_sqlite():
    engine = create_engine("sqlite://")
    with engine.connect() as connection:
        with migration_guard(connection):
            assert connection.execute(text("SELECT 1")).scalar() == 1


@pytest.fixture
def pg_schema(monkeypatch):
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_miglock_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("QYM_DATABASE_URL", scoped.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    engine = create_engine(scoped)
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _advisory_held(engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'"
                    " AND classid = CAST(:k AS oid)"
                    " AND objid = CAST(hashtext(current_schema()) AS oid) AND granted"
                ),
                {"k": MIGRATION_LOCK_CLASS},
            ).scalar()
        )


def test_guard_holds_the_lock_and_bounds_lock_waits(pg_schema, monkeypatch):
    monkeypatch.setenv("QYM_MIGRATION_LOCK_TIMEOUT", "750ms")
    with pg_schema.connect() as connection:
        with migration_guard(connection):
            assert not connection.in_transaction()
            assert connection.execute(text("SHOW lock_timeout")).scalar() == "750ms"
            connection.commit()
            assert _advisory_held(pg_schema)
        assert not _advisory_held(pg_schema)


def test_concurrent_upgrades_take_turns(pg_schema):
    from alembic import command
    from alembic.config import Config

    holder = pg_schema.connect()
    holder.execute(
        text(
            "SELECT pg_advisory_lock(CAST(:k AS integer), hashtext(current_schema()))"
        ),
        {"k": MIGRATION_LOCK_CLASS},
    )
    holder.commit()
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    errors = []

    def upgrade():
        try:
            command.upgrade(config, "head")
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    thread = threading.Thread(target=upgrade)
    thread.start()
    try:
        thread.join(timeout=2)
        # Waiting for the other "replica": no table created yet.
        assert thread.is_alive()
        with pg_schema.connect() as conn:
            assert (
                conn.execute(text("SELECT to_regclass('alembic_version')")).scalar()
                is None
            )
    finally:
        holder.execute(
            text(
                "SELECT pg_advisory_unlock(CAST(:k AS integer), hashtext(current_schema()))"
            ),
            {"k": MIGRATION_LOCK_CLASS},
        )
        holder.commit()
        holder.close()
    thread.join(timeout=300)
    assert not thread.is_alive()
    assert not errors, errors
    with pg_schema.connect() as conn:
        assert (
            conn.execute(text("SELECT to_regclass('alembic_version')")).scalar()
            is not None
        )
    assert not _advisory_held(pg_schema)
