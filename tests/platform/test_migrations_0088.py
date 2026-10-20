"""Migration 0088: experiment dataset read token and latency-sensitive runs.

The chain 0086 -> 0087 -> 0088 is verified at integration (0087 belongs to WP-A and is
absent from this branch), so this applies 0088 on its own to the four tables it touches,
on SQLite and, with ``QYM_TEST_POSTGRES_URL``, on PostgreSQL.
"""

from __future__ import annotations

from typing import Any

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from qym_platform.db import models  # noqa: F401  (registers the tables)
from qym_platform.db.base import Base
from test_migrations import _load_migration, postgres_engine  # noqa: F401

FILE = "0088_eval_experiment_dataset_token_latency.py"

NEW_COLUMNS = {
    "eval_experiments": {
        "dataset_read_token_id",
        "dataset_read_token_encrypted",
        "latency_sensitive",
    },
    "dataset_read_tokens": {"kind", "experiment_id"},
    "eval_environments": {"latency_sensitive_min_role"},
    "eval_experiment_jobs": {
        "admitted_at",
        "deferrals",
        "deferral_reason",
        "contaminated_attempts",
    },
}


def _before_schema(connection: sa.Connection) -> None:
    """The four tables as they are at 0086 (only the columns the test touches)."""
    for table in NEW_COLUMNS:
        connection.execute(
            sa.text(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, name VARCHAR(200))"
            )
        )
    connection.execute(
        sa.text("INSERT INTO eval_experiments (id, name) VALUES ('x1', 'x')")
    )
    connection.execute(
        sa.text("INSERT INTO dataset_read_tokens (id, name) VALUES ('t1', 'admin')")
    )
    connection.execute(
        sa.text("INSERT INTO eval_environments (id, name) VALUES ('e1', 'env')")
    )
    connection.execute(
        sa.text("INSERT INTO eval_experiment_jobs (id, name) VALUES ('j1', 'job')")
    )


def _columns(connection: sa.Connection, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(connection).get_columns(table)}


def _round_trip(connection: sa.Connection, monkeypatch: pytest.MonkeyPatch) -> None:
    migration = _load_migration(FILE)
    assert (migration.revision, migration.down_revision) == ("0088", "0087")
    monkeypatch.setattr(
        migration, "op", Operations(MigrationContext.configure(connection))
    )
    _before_schema(connection)

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    migration.upgrade()
    for table, names in NEW_COLUMNS.items():
        assert names <= _columns(connection, table), table

    # Existing rows get the defaults (B4-2, B5-1).
    assert scalar("SELECT kind FROM dataset_read_tokens WHERE id = 't1'") == "admin"
    assert (
        scalar("SELECT experiment_id FROM dataset_read_tokens WHERE id = 't1'") is None
    )
    assert not scalar("SELECT latency_sensitive FROM eval_experiments WHERE id = 'x1'")
    assert scalar("SELECT dataset_read_token_id FROM eval_experiments") is None
    assert (
        scalar("SELECT latency_sensitive_min_role FROM eval_environments") == "member"
    )
    assert scalar("SELECT deferrals FROM eval_experiment_jobs") == 0
    assert scalar("SELECT contaminated_attempts FROM eval_experiment_jobs") == 0
    assert scalar("SELECT admitted_at FROM eval_experiment_jobs") is None
    assert scalar("SELECT deferral_reason FROM eval_experiment_jobs") is None

    inspector = sa.inspect(connection)
    assert "ix_eval_experiments_dataset_read_token_id" in {
        i["name"] for i in inspector.get_indexes("eval_experiments")
    }
    assert "ix_dataset_read_tokens_experiment_id" in {
        i["name"] for i in inspector.get_indexes("dataset_read_tokens")
    }

    # The check constraints reject unknown values.
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            connection.execute(sa.text("UPDATE dataset_read_tokens SET kind = 'other'"))
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            connection.execute(
                sa.text(
                    "UPDATE eval_environments SET latency_sensitive_min_role = 'owner'"
                )
            )
    connection.execute(
        sa.text(
            "UPDATE dataset_read_tokens SET kind = 'experiment', experiment_id = 'x1' WHERE id = 't1'"
        )
    )
    connection.execute(
        sa.text("UPDATE eval_experiments SET dataset_read_token_id = 't1'")
    )

    # Deleting either side only clears the pointer (ON DELETE SET NULL).
    if connection.dialect.name == "sqlite":
        fks = connection.exec_driver_sql(
            "PRAGMA foreign_key_list(eval_experiments)"
        ).all()
        assert ("dataset_read_tokens", "dataset_read_token_id", "SET NULL") in {
            (fk[2], fk[3], fk[6]) for fk in fks
        }
        fks = connection.exec_driver_sql(
            "PRAGMA foreign_key_list(dataset_read_tokens)"
        ).all()
        assert ("eval_experiments", "experiment_id", "SET NULL") in {
            (fk[2], fk[3], fk[6]) for fk in fks
        }
    connection.execute(sa.text("DELETE FROM dataset_read_tokens WHERE id = 't1'"))
    assert scalar("SELECT dataset_read_token_id FROM eval_experiments") is None

    migration.downgrade()
    for table, names in NEW_COLUMNS.items():
        assert not names & _columns(connection, table), table
    assert scalar("SELECT COUNT(*) FROM eval_experiments") == 1
    assert scalar("SELECT COUNT(*) FROM eval_experiment_jobs") == 1

    migration.upgrade()  # clean after a downgrade
    for table, names in NEW_COLUMNS.items():
        assert names <= _columns(connection, table), table


def test_0088_sqlite_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        _round_trip(connection, monkeypatch)
    engine.dispose()


def test_0088_postgres_round_trip(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    with postgres_engine.begin() as connection:
        _round_trip(connection, monkeypatch)


def test_models_declare_the_columns_the_migration_adds() -> None:
    for table, names in NEW_COLUMNS.items():
        assert names <= {c.name for c in Base.metadata.tables[table].columns}, table
    token = Base.metadata.tables["dataset_read_tokens"]
    assert {c.name for c in token.constraints if c.name} >= {
        "ck_dataset_read_tokens_kind"
    }
    env = Base.metadata.tables["eval_environments"]
    assert "ck_eval_environments_latency_min_role" in {c.name for c in env.constraints}
