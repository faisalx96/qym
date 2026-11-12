"""Migration 0095 (Live chart images): matches the models and round-trips on SQLite and PostgreSQL."""

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

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "packages/platform/qym_platform/migrations"
FILE = MIGRATIONS / "versions/0095_live_chart_images.py"


@pytest.fixture(params=["sqlite", "postgres"])
def engine(request, tmp_path, monkeypatch):
    from qym_platform.db import models
    from qym_platform.db.base import Base

    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_live_chart_" + uuid4().hex
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
        _create_api_keys_before_0092(eng)
        Base.metadata.create_all(
            eng,
            tables=[
                Base.metadata.tables[name] for name in ("live_sources", "live_turns")
            ],
        )
        yield eng
    finally:
        eng.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def _create_api_keys_before_0092(eng) -> None:
    """Create api_keys as it was before migration 0092 (no kind, no experiment_id).

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


def test_revision_chain_names_0094() -> None:
    spec = importlib.util.spec_from_file_location("migration_0095", FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (module.revision, module.down_revision) == ("0095", "0094")


def test_matches_models_and_round_trips(engine) -> None:
    from qym_platform.db.base import Base

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))

    def include(obj, name, kind, reflected, compare_to):
        table = obj if kind == "table" else getattr(obj, "table", None)
        return table is not None and table.name == "live_chart_images"

    # Seed 0094 prerequisites; older migrations contain PostgreSQL-only DDL.
    command.stamp(config, "0094")
    command.upgrade(config, "0095")
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert "live_chart_images" in inspector.get_table_names()
        assert {
            constraint["name"]: constraint["column_names"]
            for constraint in inspector.get_unique_constraints("live_chart_images")
        } == {"uq_live_chart_image": ["turn_pk", "ref"]}
        assert {
            index["name"]: index["column_names"]
            for index in inspector.get_indexes("live_chart_images")
            if not index.get("duplicates_constraint")
        } == {"ix_live_chart_images_turn_pk": ["turn_pk"]}
        (foreign_key,) = inspector.get_foreign_keys("live_chart_images")
        assert foreign_key["constrained_columns"] == ["turn_pk"]
        assert foreign_key["referred_table"] == "live_turns"
        assert foreign_key["referred_columns"] == ["id"]
        assert foreign_key["options"].get("ondelete") == "CASCADE"
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": include}
        )
        assert compare_metadata(context, Base.metadata) == []

    command.downgrade(config, "0094")
    assert "live_chart_images" not in sa.inspect(engine).get_table_names()
    command.upgrade(config, "0095")
    assert "live_chart_images" in sa.inspect(engine).get_table_names()
