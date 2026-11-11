"""Migration 0098 (Live evaluation): matches the models and round-trips on SQLite and PostgreSQL."""

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
FILE = ROOT / "packages/platform/qym_platform/migrations/versions/0098_live_evaluation.py"
LIVE_TABLES = {
    "live_sources",
    "live_metric_specs",
    "live_days",
    "live_turns",
    "live_turn_scores",
    "live_canary_results",
}


def _load():
    spec = importlib.util.spec_from_file_location("migration_0098", FILE)
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
        schema = "qym_live_" + uuid4().hex
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


def test_revision_chain_names_0097() -> None:
    module = _load()
    assert (module.revision, module.down_revision) == ("0098", "0097")


def test_matches_models_and_round_trips(engine, monkeypatch) -> None:
    from qym_platform.db.base import Base

    module = _load()

    later_source_columns = {  # added by 0100
        "desired_state",
        "state_changed_at",
        "state_changed_by_user_id",
        "worker_key_id",
        "worker_key_changed_at",
        "worker_key_changed_by_user_id",
    }

    def include(obj, name, kind, reflected, compare_to):
        table = obj if kind == "table" else getattr(obj, "table", None)
        if table is not None and table.name == "live_sources":
            if kind == "column" and name in later_source_columns:
                return False
            if kind in ("foreign_key_constraint", "index") and any(
                column.name in later_source_columns for column in obj.columns
            ):
                return False
        return table is not None and table.name in LIVE_TABLES

    with engine.begin() as connection:
        monkeypatch.setattr(
            module, "op", Operations(MigrationContext.configure(connection))
        )
        module.upgrade()
        assert LIVE_TABLES <= set(sa.inspect(connection).get_table_names())
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": include}
        )
        assert compare_metadata(context, Base.metadata) == []
        module.downgrade()
        assert not LIVE_TABLES & set(sa.inspect(connection).get_table_names())
        module.upgrade()
        assert LIVE_TABLES <= set(sa.inspect(connection).get_table_names())


def test_settings_defaults(monkeypatch) -> None:
    from qym_platform.settings import PlatformSettings

    for name in list(os.environ):
        if name.startswith("QYM_LIVE_"):
            monkeypatch.delenv(name, raising=False)

    settings = PlatformSettings()
    assert settings.live_retention_days == 180
    assert settings.live_stale_after_seconds == 300
    assert settings.live_turn_batch_max == 100
    assert settings.live_detail_max_bytes == 524288
    assert settings.live_trend_max_days == 90
