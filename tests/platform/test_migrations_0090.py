"""Migration 0090: ``eval_experiment_jobs.dataset_index`` and the wider job key (QD-102).

SQLite: the models' schema (``create_all``, which already holds the column) is taken back
to 0089 and forward again through the migration's own operations. PostgreSQL
(``QYM_TEST_POSTGRES_URL``): the real Alembic chain up to 0089, then 0090 and back.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from qym_platform.db import models
from qym_platform.db.base import Base
from _helpers import insert_at_revision
from test_migrations import _load_migration

FILE = "0090_eval_job_dataset_index.py"
UNIQUE = "uq_eval_experiment_job_attempt"


def _unique_columns(connection: sa.Connection) -> list[str]:
    inspector = sa.inspect(connection)
    for constraint in inspector.get_unique_constraints("eval_experiment_jobs"):
        if constraint["name"] == UNIQUE:
            return list(constraint["column_names"])
    return []


def _job(connection: sa.Connection, **values) -> None:
    base = dict(
        id=values.pop("id"),
        experiment_id="x1",
        environment_id="e1",
        combo_index=0,
        attempt=0,
        params={},
        request_body={},
        schema_id="s1",
        status=models.EvalJobStatus.QUEUED,
    )
    base.update(values)
    insert_at_revision(connection, models.EvalExperimentJob, **base)


def _seed_parents(connection: sa.Connection) -> None:
    insert_at_revision(connection, models.User, id="u1", email="u@example.test", role=models.UserRole.ADMIN)
    insert_at_revision(connection, models.Project, id="p1", name="P", slug="p", created_by_user_id="u1")
    insert_at_revision(connection, models.EvalEnvironment, id="e1", project_id="p1", name="staging", base_url="https://e.example")
    insert_at_revision(connection, models.EvalEnvironmentSchema, id="s1", environment_id="e1", schema_hash="h", schema_json={})
    insert_at_revision(connection, models.EvalExperiment, id="x1", project_id="p1", created_by_user_id="u1", name="x", environment_ids=["e1"], job_count=1)


def _exercise(connection: sa.Connection, migration) -> None:
    """Rows written before 0090 survive, the pair key works, the downgrade refuses."""
    assert "dataset_index" not in {c["name"] for c in sa.inspect(connection).get_columns("eval_experiment_jobs")}
    assert _unique_columns(connection) == ["experiment_id", "environment_id", "combo_index", "attempt"]
    _job(connection, id="old")
    migration.upgrade()
    columns = {c["name"]: c for c in sa.inspect(connection).get_columns("eval_experiment_jobs")}
    assert "dataset_index" in columns and not columns["dataset_index"]["nullable"]
    assert _unique_columns(connection) == [
        "experiment_id", "environment_id", "combo_index", "dataset_index", "attempt"
    ]
    assert connection.execute(sa.text("SELECT dataset_index FROM eval_experiment_jobs WHERE id = 'old'")).scalar_one() == 0

    # Two pairs of one environment and combination coexist; the same pair twice does not.
    _job(connection, id="pair1", dataset_index=1)
    _job(connection, id="pair2", dataset_index=2)
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            _job(connection, id="dup", dataset_index=1)
    _job(connection, id="pair1-retry", dataset_index=1, attempt=1)
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            _job(connection, id="neg", dataset_index=-1)

    # The downgrade refuses while a fan-out exists, and changes nothing.
    with pytest.raises(RuntimeError, match="dataset_index > 0"):
        migration.downgrade()
    assert "dataset_index" in {c["name"] for c in sa.inspect(connection).get_columns("eval_experiment_jobs")}

    connection.execute(sa.text("DELETE FROM eval_experiment_jobs WHERE dataset_index > 0"))
    migration.downgrade()
    assert "dataset_index" not in {c["name"] for c in sa.inspect(connection).get_columns("eval_experiment_jobs")}
    assert _unique_columns(connection) == ["experiment_id", "environment_id", "combo_index", "attempt"]
    assert connection.execute(sa.text("SELECT COUNT(*) FROM eval_experiment_jobs")).scalar_one() == 1
    migration.upgrade()  # clean after a downgrade
    assert connection.execute(sa.text("SELECT dataset_index FROM eval_experiment_jobs")).scalar_one() == 0


def test_revision_chain() -> None:
    migration = _load_migration(FILE)
    assert (migration.revision, migration.down_revision) == ("0090", "0089")


def test_sqlite_round_trip_keeps_rows_and_run_links(monkeypatch: pytest.MonkeyPatch) -> None:
    migration = _load_migration(FILE)
    engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _record) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        _seed_parents(connection)
        _job(connection, id="old")
        insert_at_revision(
            connection, models.Run, id="r1", project_id="p1", owner_user_id="u1", created_by_user_id="u1",
            task="t", dataset="d", model=None, metrics=[], run_config={}, run_metadata={},
            status=models.RunWorkflowStatus.COMPLETED, experiment_job_id="old",
        )
        connection.execute(sa.text("DELETE FROM eval_experiment_jobs"))  # clean slate for the exercise
        connection.execute(sa.text("UPDATE runs SET experiment_job_id = NULL"))
        migration.downgrade()
        _job(connection, id="old")
        connection.execute(sa.text("UPDATE runs SET experiment_job_id = 'old' WHERE id = 'r1'"))
        _exercise_after_downgrade(connection, migration)
    engine.dispose()


def _exercise_after_downgrade(connection: sa.Connection, migration) -> None:
    migration.upgrade()
    assert connection.execute(sa.text("SELECT experiment_job_id FROM runs WHERE id = 'r1'")).scalar_one() == "old"
    _job(connection, id="pair1", dataset_index=1)
    _job(connection, id="pair2", dataset_index=2)
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            _job(connection, id="dup", dataset_index=1)
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            _job(connection, id="neg", dataset_index=-1)
    with pytest.raises(RuntimeError, match="dataset_index > 0"):
        migration.downgrade()
    connection.execute(sa.text("DELETE FROM eval_experiment_jobs WHERE dataset_index > 0"))
    migration.downgrade()
    assert _unique_columns(connection) == ["experiment_id", "environment_id", "combo_index", "attempt"]
    assert connection.execute(sa.text("SELECT experiment_job_id FROM runs WHERE id = 'r1'")).scalar_one() == "old"
    migration.upgrade()
    assert connection.execute(sa.text("SELECT experiment_job_id FROM runs WHERE id = 'r1'")).scalar_one() == "old"
    assert connection.execute(sa.text("SELECT dataset_index FROM eval_experiment_jobs")).scalar_one() == 0


def test_postgres_real_chain_round_trip(postgres) -> None:
    engine, config = postgres
    command.upgrade(config, "0089")
    migration = _load_migration(FILE)
    with engine.begin() as connection:
        _seed_parents(connection)
    with engine.begin() as connection:
        import qym_platform.migrations  # noqa: F401  (package exists)
    command.upgrade(config, "0090")
    with engine.begin() as connection:
        assert _unique_columns(connection) == [
            "experiment_id", "environment_id", "combo_index", "dataset_index", "attempt"
        ]
        _job(connection, id="pair0")
        _job(connection, id="pair1", dataset_index=1)
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                _job(connection, id="dup", dataset_index=1)
    with pytest.raises(Exception, match="dataset_index > 0"):
        command.downgrade(config, "0089")
    with engine.begin() as connection:
        connection.execute(sa.text("DELETE FROM eval_experiment_jobs WHERE dataset_index > 0"))
    command.downgrade(config, "0089")
    with engine.begin() as connection:
        assert _unique_columns(connection) == ["experiment_id", "environment_id", "combo_index", "attempt"]
        assert connection.execute(sa.text("SELECT COUNT(*) FROM eval_experiment_jobs")).scalar_one() == 1
    command.upgrade(config, "0090")
    del migration
