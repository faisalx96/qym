"""Migration 0103 (Live chart snapshots and stylesheets): matches the models and round-trips on SQLite and PostgreSQL."""

from __future__ import annotations

import importlib.util

import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from test_migration_0095 import MIGRATIONS, engine  # noqa: F401

FILE = MIGRATIONS / "versions/0103_live_chart_snapshots.py"
TABLES = {"live_chart_snapshots", "live_chart_styles"}


def test_revision_chain_names_0102() -> None:
    spec = importlib.util.spec_from_file_location("migration_0103", FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (module.revision, module.down_revision) == ("0103", "0102")


def test_matches_models_and_round_trips(engine) -> None:  # noqa: F811
    from qym_platform.db.base import Base

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))

    def include(obj, name, kind, reflected, compare_to):
        table = obj if kind == "table" else getattr(obj, "table", None)
        return table is not None and table.name in TABLES

    def constraints(inspector, table):
        return {
            constraint["name"]: constraint["column_names"]
            for constraint in inspector.get_unique_constraints(table)
        }

    def indexes(inspector, table):
        return {
            index["name"]: index["column_names"]
            for index in inspector.get_indexes(table)
            if not index.get("duplicates_constraint")
        }

    def foreign_key(inspector, table):
        (key,) = inspector.get_foreign_keys(table)
        return (
            key["constrained_columns"],
            key["referred_table"],
            key["referred_columns"],
            key["options"].get("ondelete"),
        )

    # Seed 0102 prerequisites; older migrations contain PostgreSQL-only DDL.
    command.stamp(config, "0102")
    command.upgrade(config, "0103")
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert TABLES <= set(inspector.get_table_names())
        assert constraints(inspector, "live_chart_snapshots") == {
            "uq_live_chart_snapshot": ["turn_pk", "ref"]
        }
        assert indexes(inspector, "live_chart_snapshots") == {
            "ix_live_chart_snapshots_turn_pk": ["turn_pk"],
            "ix_live_chart_snapshots_style_sha256": ["style_sha256"],
        }
        assert foreign_key(inspector, "live_chart_snapshots") == (
            ["turn_pk"],
            "live_turns",
            ["id"],
            "CASCADE",
        )
        assert constraints(inspector, "live_chart_styles") == {
            "uq_live_chart_style": ["source_id", "sha256"]
        }
        assert indexes(inspector, "live_chart_styles") == {}
        assert foreign_key(inspector, "live_chart_styles") == (
            ["source_id"],
            "live_sources",
            ["id"],
            "CASCADE",
        )
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": include}
        )
        assert compare_metadata(context, Base.metadata) == []

    command.downgrade(config, "0102")
    assert not TABLES & set(sa.inspect(engine).get_table_names())
    command.upgrade(config, "0103")
    assert TABLES <= set(sa.inspect(engine).get_table_names())
