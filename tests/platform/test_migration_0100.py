"""Migration 0100 matches the models and round-trips on SQLite and PostgreSQL."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "packages/platform/qym_platform/migrations"
TABLES = {"live_sources", "live_worker_settings", "live_jobs", "live_worker_events"}
COLUMNS = {
    "desired_state",
    "state_changed_at",
    "state_changed_by_user_id",
    "worker_key_id",
    "worker_key_changed_at",
    "worker_key_changed_by_user_id",
}


@pytest.fixture(params=["sqlite", "postgres"])
def engine(request, tmp_path, monkeypatch):
    from qym_platform.db import models
    from qym_platform.db.base import Base

    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_live_worker_" + uuid4().hex
        admin = sa.create_engine(url)
        with admin.begin() as conn:
            conn.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
        url = sa.engine.make_url(url).update_query_dict(
            {"options": f"-csearch_path={schema}"}
        )
    else:
        url = sa.engine.URL.create("sqlite", database=str(tmp_path / "migration.db"))
    eng = sa.create_engine(url)
    monkeypatch.setenv("QYM_DATABASE_URL", url.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    try:
        Base.metadata.create_all(
            eng, tables=[Base.metadata.tables[name] for name in ("users", "projects")]
        )
        _create_api_keys_before_0101(eng)
        # Build the actual pre-0100 live schema; older migrations have PG-only DDL.
        with eng.begin() as conn:
            for filename in ("0098_live_evaluation.py", "0099_live_chart_images.py"):
                spec = importlib.util.spec_from_file_location(
                    "live_prerequisite", MIGRATIONS / "versions" / filename
                )
                migration = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(migration)
                migration.op = Operations(MigrationContext.configure(conn))
                migration.upgrade()
        yield eng
    finally:
        eng.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def _create_api_keys_before_0101(eng) -> None:
    """Create api_keys as it was before migration 0101 (no kind, no experiment_id).

    The model now has both columns, and experiment_id points at eval_experiments, which these
    tests do not build. users and projects must already exist.
    """
    from qym_platform.db.base import Base

    md = sa.MetaData()
    for name in ("users", "projects", "api_keys"):
        skip = {"kind", "experiment_id"} if name == "api_keys" else set()
        sa.Table(
            name,
            md,
            *[
                c._copy()
                for c in Base.metadata.tables[name].columns
                if c.name not in skip
            ],
        )
    md.create_all(eng, tables=[md.tables["api_keys"]])


def test_revision_chain_names_0099() -> None:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    script = ScriptDirectory.from_config(config).get_revision("0100")
    assert (script.revision, script.down_revision) == ("0100", "0099")


def test_matches_models_and_round_trips(engine) -> None:
    from qym_platform.db.base import Base

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))

    def include(obj, name, kind, reflected, compare_to):
        table = obj if kind == "table" else getattr(obj, "table", None)
        return table is not None and table.name in TABLES

    command.stamp(config, "0099")
    # Up to 0100 only: 0101 and 0102 change api_keys and eval_experiment_jobs, which this test does not build.
    command.upgrade(config, "0100")
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert TABLES <= set(inspector.get_table_names())
        indexes = {index["name"]: index for index in inspector.get_indexes("live_jobs")}
        active = indexes["uq_live_jobs_active"]
        assert active["unique"]
        assert active["column_names"] == ["source_id", "kind"]
        predicate = str(active["dialect_options"][engine.dialect.name + "_where"])
        assert (
            "status" in predicate and "queued" in predicate and "running" in predicate
        )
        columns = {
            column["name"]: column for column in inspector.get_columns("live_sources")
        }
        assert COLUMNS <= columns.keys()
        assert "running" in columns["desired_state"]["default"]
        foreign_keys = {
            tuple(fk["constrained_columns"]): fk
            for fk in inspector.get_foreign_keys("live_sources")
        }
        assert foreign_keys[("worker_key_id",)]["options"]["ondelete"] == "SET NULL"
        for table in TABLES - {"live_sources"}:
            (source_fk,) = [
                fk
                for fk in inspector.get_foreign_keys(table)
                if fk["constrained_columns"] == ["source_id"]
            ]
            assert source_fk["options"]["ondelete"] == "CASCADE"
        context = MigrationContext.configure(
            connection,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": include,
            },
        )
        assert compare_metadata(context, Base.metadata) == []

    command.downgrade(config, "0099")
    inspector = sa.inspect(engine)
    assert not (TABLES - {"live_sources"}) & set(inspector.get_table_names())
    assert not COLUMNS & {
        column["name"] for column in inspector.get_columns("live_sources")
    }
    command.upgrade(config, "0100")
    assert TABLES <= set(sa.inspect(engine).get_table_names())
