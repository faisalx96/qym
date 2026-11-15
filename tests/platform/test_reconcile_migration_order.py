"""Repair the pre-renumbering Live head without replaying the Live migrations."""

from __future__ import annotations

import logging

import pytest
import sqlalchemy as sa
from alembic import command


@pytest.mark.parametrize(
    "stamp,kind,priority,expected",
    [
        (stamp, kind, priority, expected)
        for stamp, expected in [
            ("0100", "repair"),
            ("0102", "repair"),
            ("0091", "repair"),
            ("0092", "repair"),
            ("0093", "repair"),
            ("0094", "none"),
            ("0099", "none"),
            ("0101", "none"),
            ("0103", "none"),
            (None, "none"),
        ]
        for kind, priority in [(False, False), (True, False), (False, True)]
    ]
    + [
        ("0100", True, True, "none"),  # new chain mid-upgrade
        ("0102", True, True, "none"),  # complete new chain
        ("0091", True, True, "stamp"),
        ("0092", True, True, "stamp"),
        ("0093", True, True, "stamp"),
    ],
)
def test_detection(stamp, kind, priority, expected):
    from qym_platform.tools.reconcile_migration_order import (
        Facts,
        reconciliation_action,
    )

    assert reconciliation_action(stamp, Facts(True, True, kind, priority)) == expected


@pytest.mark.parametrize("stamp", ["0091", "0092", "0093", "0100", "0102"])
@pytest.mark.parametrize("sources,jobs", [(False, False), (False, True), (True, False)])
@pytest.mark.parametrize("kind,priority", [(False, False), (True, True)])
def test_requires_both_live_tables(stamp, sources, jobs, kind, priority):
    from qym_platform.tools.reconcile_migration_order import (
        Facts,
        reconciliation_action,
    )

    assert reconciliation_action(stamp, Facts(sources, jobs, kind, priority)) == "none"


@pytest.mark.parametrize("stamp", [None, "empty", "0100", "0102", "0091"])
def test_sqlite_is_unchanged(tmp_path, monkeypatch, caplog, stamp):
    from qym_platform.tools.reconcile_migration_order import main

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    monkeypatch.setenv("QYM_DATABASE_URL", url)
    engine = sa.create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE live_sources (id INTEGER)"))
            connection.execute(sa.text("CREATE TABLE live_jobs (id INTEGER)"))
            if stamp is not None:
                connection.execute(
                    sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
                )
                if stamp != "empty":
                    connection.execute(
                        sa.text("INSERT INTO alembic_version VALUES (:stamp)"),
                        {"stamp": stamp},
                    )
        with engine.connect() as connection:
            before = list(connection.connection.driver_connection.iterdump())
        with caplog.at_level(logging.INFO):
            main()
        with engine.connect() as connection:
            assert list(connection.connection.driver_connection.iterdump()) == before
        assert caplog.messages == ["migration order: no action (dialect=sqlite)"]
    finally:
        engine.dispose()


@pytest.mark.parametrize("stamp", ["0100", "0102", "0091", "0092", "0093"])
def test_postgres_repairs_and_is_idempotent(postgres, monkeypatch, stamp):
    from qym_platform.tools.reconcile_migration_order import main

    engine, config = postgres
    command.upgrade(config, "head")
    with engine.begin() as connection:
        # Recreate the old head, or a committed intermediate repair step.
        if stamp not in {"0092", "0093"}:
            connection.execute(sa.text("ALTER TABLE api_keys DROP COLUMN kind"))
            connection.execute(
                sa.text("ALTER TABLE api_keys DROP COLUMN experiment_id CASCADE")
            )
        if stamp != "0093":
            connection.execute(
                sa.text("ALTER TABLE eval_experiment_jobs DROP COLUMN priority")
            )
        connection.execute(
            sa.text("UPDATE alembic_version SET version_num = :stamp"), {"stamp": stamp}
        )

    main()

    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert (
            connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
            == "0102"
        )
        assert {"kind", "experiment_id"} <= {
            column["name"] for column in inspector.get_columns("api_keys")
        }
        assert "priority" in {
            column["name"] for column in inspector.get_columns("eval_experiment_jobs")
        }
        assert "ix_api_keys_experiment_id" in {
            index["name"] for index in inspector.get_indexes("api_keys")
        }
        assert "fk_api_keys_experiment_id" in {
            fk["name"] for fk in inspector.get_foreign_keys("api_keys")
        }

    def unexpected_command(*args, **kwargs):
        pytest.fail("a reconciled database must not run Alembic commands again")

    monkeypatch.setattr(command, "stamp", unexpected_command)
    monkeypatch.setattr(command, "upgrade", unexpected_command)
    main()


@pytest.mark.parametrize("version_table", [False, True])
def test_postgres_without_stamp_is_unchanged(postgres, version_table):
    from qym_platform.tools.reconcile_migration_order import main

    engine, _ = postgres
    if version_table:
        with engine.begin() as connection:
            connection.execute(
                sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
            )
    main()
    with engine.connect() as connection:
        assert sa.inspect(connection).get_table_names() == (
            ["alembic_version"] if version_table else []
        )


@pytest.mark.parametrize("stamp", ["0091", "0092", "0093", "0100", "0102"])
def test_postgres_with_columns_only_finishes_interrupted_stamp(postgres, stamp):
    from qym_platform.tools.reconcile_migration_order import main

    engine, config = postgres
    command.upgrade(config, "head")
    command.stamp(config, stamp)
    main()
    with engine.connect() as connection:
        assert connection.scalar(
            sa.text("SELECT version_num FROM alembic_version")
        ) == ("0100" if stamp == "0100" else "0102")


def test_postgres_failed_step_releases_lock_and_can_resume(postgres, monkeypatch):
    from qym_platform.tools.reconcile_migration_order import RECONCILE_LOCK_CLASS, main

    engine, config = postgres
    command.upgrade(config, "head")
    with engine.begin() as connection:
        connection.execute(sa.text("ALTER TABLE api_keys DROP COLUMN kind"))
        connection.execute(
            sa.text("ALTER TABLE api_keys DROP COLUMN experiment_id CASCADE")
        )
        connection.execute(
            sa.text("ALTER TABLE eval_experiment_jobs DROP COLUMN priority")
        )
    command.stamp(config, "0100")

    def fail_upgrade(*args, **kwargs):
        raise RuntimeError("interrupted upgrade")

    with monkeypatch.context() as patch:
        patch.setattr(command, "upgrade", fail_upgrade)
        with pytest.raises(RuntimeError, match="interrupted upgrade"):
            main()

    with engine.connect() as connection:
        assert (
            connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
            == "0091"
        )
        acquired = connection.scalar(
            sa.text(
                "SELECT pg_try_advisory_lock(CAST(:k AS integer), hashtext(current_schema()))"
            ),
            {"k": RECONCILE_LOCK_CLASS},
        )
        try:
            assert acquired
        finally:
            if acquired:
                connection.execute(
                    sa.text(
                        "SELECT pg_advisory_unlock(CAST(:k AS integer), hashtext(current_schema()))"
                    ),
                    {"k": RECONCILE_LOCK_CLASS},
                )
    main()
    with engine.connect() as connection:
        assert (
            connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
            == "0102"
        )
