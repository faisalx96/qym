"""Migration 0089 (QC-49, QC-50): ``run_datasets``, ``runs.dataset_count``, ``run_items.dataset_position``.

0089 is applied on its own to the four tables it touches, on SQLite and, with
``QYM_TEST_POSTGRES_URL``, on PostgreSQL; the chain 0088 -> 0089 is checked at integration.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from qym_platform.db import models  # noqa: F401  (registers the tables)
from qym_platform.db.base import Base
from test_migrations import _load_migration, postgres_engine  # noqa: F401

FILE = "0089_run_datasets.py"


def _before_schema(connection: sa.Connection) -> None:
    for table in ("runs", "run_items", "datasets", "dataset_versions"):
        connection.execute(
            sa.text(f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, name VARCHAR(200))")
        )
    connection.execute(sa.text("INSERT INTO runs (id, name) VALUES ('r1', 'old run')"))
    connection.execute(sa.text("INSERT INTO run_items (id, name) VALUES ('i1', 'old item')"))
    connection.execute(sa.text("INSERT INTO datasets (id, name) VALUES ('d1', 'd')"))
    connection.execute(sa.text("INSERT INTO dataset_versions (id, name) VALUES ('v1', 'v')"))


def _columns(connection: sa.Connection, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(connection).get_columns(table)}


def _round_trip(connection: sa.Connection, monkeypatch: pytest.MonkeyPatch) -> None:
    migration = _load_migration(FILE)
    assert (migration.revision, migration.down_revision) == ("0089", "0088")
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
    _before_schema(connection)

    def scalar(sql: str):
        return connection.execute(sa.text(sql)).scalar_one()

    migration.upgrade()
    assert "run_datasets" in sa.inspect(connection).get_table_names()
    assert "dataset_count" in _columns(connection, "runs")
    assert "dataset_position" in _columns(connection, "run_items")
    # Existing runs read as single-dataset; items carry no position.
    assert scalar("SELECT dataset_count FROM runs WHERE id = 'r1'") == 1
    assert scalar("SELECT dataset_position FROM run_items WHERE id = 'i1'") is None
    inspector = sa.inspect(connection)
    assert {"ix_run_datasets_run_id", "ix_run_datasets_dataset_id", "ix_run_datasets_version_id"} <= {
        i["name"] for i in inspector.get_indexes("run_datasets")
    }
    uniques = {u["name"] for u in inspector.get_unique_constraints("run_datasets")}
    assert "uq_run_datasets_run_position" in uniques
    connection.execute(
        sa.text(
            "INSERT INTO run_datasets (id, run_id, position, dataset, created_at) "
            "VALUES ('a', 'r1', 0, 'x', CURRENT_TIMESTAMP)"
        )
    )
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            connection.execute(
                sa.text(
                    "INSERT INTO run_datasets (id, run_id, position, dataset, created_at) "
                    "VALUES ('b', 'r1', 0, 'y', CURRENT_TIMESTAMP)"
                )
            )
    migration.downgrade()
    assert "run_datasets" not in sa.inspect(connection).get_table_names()
    assert "dataset_count" not in _columns(connection, "runs")
    assert "dataset_position" not in _columns(connection, "run_items")
    assert scalar("SELECT COUNT(*) FROM runs") == 1
    migration.upgrade()  # clean after a downgrade
    assert "run_datasets" in sa.inspect(connection).get_table_names()


def test_0089_sqlite_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        _round_trip(connection, monkeypatch)
    engine.dispose()


def test_0089_postgres_round_trip(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    with postgres_engine.begin() as connection:
        _round_trip(connection, monkeypatch)


def test_models_declare_what_the_migration_adds() -> None:
    table = Base.metadata.tables["run_datasets"]
    assert {
        "id", "run_id", "position", "dataset", "dataset_id", "dataset_version_id",
        "version", "alias", "item_count", "disabled_count", "created_at",
    } == {c.name for c in table.columns}
    assert "uq_run_datasets_run_position" in {c.name for c in table.constraints}
    assert {"ix_run_datasets_run_id", "ix_run_datasets_dataset_id", "ix_run_datasets_version_id"} <= {
        i.name for i in table.indexes
    }
    assert Base.metadata.tables["runs"].c.dataset_count.nullable is False
    assert Base.metadata.tables["run_items"].c.dataset_position.nullable is True
    fks = {fk.parent.name: fk.ondelete for fk in table.foreign_keys}
    assert fks == {"run_id": "CASCADE", "dataset_id": "SET NULL", "dataset_version_id": "SET NULL"}


def test_postgres_chain_matches_the_models_for_what_0089_adds(migrated_postgres) -> None:
    """The real Alembic chain on PostgreSQL gives the objects the models declare (QC-49, QC-50, QC-81)."""
    inspector = sa.inspect(migrated_postgres)
    assert "run_datasets" in inspector.get_table_names()
    runs = {c["name"]: c for c in inspector.get_columns("runs")}
    assert runs["dataset_count"]["nullable"] is False
    positions = {c["name"]: c for c in inspector.get_columns("run_items")}
    assert "SMALLINT" in str(positions["dataset_position"]["type"]).upper()
    model = Base.metadata.tables["run_datasets"]
    assert {c["name"] for c in inspector.get_columns("run_datasets")} == {c.name for c in model.columns}
    assert {f["constrained_columns"][0]: f["options"].get("ondelete") for f in inspector.get_foreign_keys("run_datasets")} == {
        "run_id": "CASCADE",
        "dataset_id": "SET NULL",
        "dataset_version_id": "SET NULL",
    }
