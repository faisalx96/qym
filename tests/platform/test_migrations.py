import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any, Optional

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT / "packages" / "platform" / "qym_platform" / "migrations"


def _load_migration(filename: str) -> ModuleType:
    path = MIGRATIONS_DIR / "versions" / filename
    spec = importlib.util.spec_from_file_location(f"test_migration_{path.stem}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_alembic_revision_ids_fit_default_version_column() -> None:
    """Alembic stores revision IDs in VARCHAR(32) unless configured otherwise."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    revisions = list(ScriptDirectory.from_config(config).walk_revisions())

    oversized = [
        revision.revision for revision in revisions if len(revision.revision) > 32
    ]

    assert oversized == []


def test_alembic_has_one_upgrade_head() -> None:
    """The deployment entrypoint uses ``upgrade head``, which requires one head."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    heads = ScriptDirectory.from_config(config).get_heads()

    assert heads == ["0065"]


def test_migrations_name_their_own_revision_in_job_logs() -> None:
    """Admins see "queued by migration NNNN" in the maintenance UI; after a
    renumbering the text must still name the migration that queued the job."""
    import re

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    wrong = []
    for revision in ScriptDirectory.from_config(config).walk_revisions():
        source = Path(revision.path).read_text(encoding="utf-8")
        for named in re.findall(r"queued by migration (\w+)", source):
            if named != revision.revision:
                wrong.append((Path(revision.path).name, named))

    assert wrong == []


def test_user_sessions_migration_creates_and_drops_the_session_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _load_migration("0061_user_sessions.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("users", metadata, sa.Column("id", sa.String(length=36), primary_key=True))
    metadata.create_all(engine)

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert {c["name"] for c in inspector.get_columns("user_sessions")} == {
            "id",
            "user_id",
            "provider",
            "created_at",
            "last_seen_at",
        }
        assert {i["name"] for i in inspector.get_indexes("user_sessions")} == {
            "ix_user_sessions_user_id",
            "ix_user_sessions_last_seen_at",
        }
        (foreign_key,) = inspector.get_foreign_keys("user_sessions")
        assert foreign_key["referred_table"] == "users"
        assert foreign_key["options"].get("ondelete") == "CASCADE"

        migration.downgrade()
        assert "user_sessions" not in sa.inspect(connection).get_table_names()


def test_item_failure_events_migration_queues_the_repair_job_for_repeat_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from qym_platform.db.maintenance_models import MaintenanceJob
    from qym_platform.services import maintenance

    migration = _load_migration("0064_project_item_failure_events.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    runs = sa.Table(
        "runs",
        metadata,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("samples", sa.Integer()),
    )
    metadata.create_all(engine)
    MaintenanceJob.__table__.create(engine)
    jobs = "SELECT kind, status FROM maintenance_jobs"

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        connection.execute(runs.insert(), [{"id": "classic", "samples": 1}])
        migration.upgrade()
        # Only repeat runs can have a pass that failed through item_failed alone.
        assert connection.execute(sa.text(jobs)).all() == []

        connection.execute(runs.insert(), [{"id": "repeat", "samples": 3}])
        migration.upgrade()
        assert connection.execute(sa.text(jobs)).all() == [
            ("project_item_failure_events", "queued")
        ]
    assert "project_item_failure_events" in maintenance.registry()


def test_purge_pause_migration_adds_nullable_columns_and_starts_archived_pauses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _load_migration("0065_archived_project_purge_pause.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    projects = sa.Table(
        "projects",
        metadata,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("is_active", sa.Boolean()),
    )
    sa.Table("runs", metadata, sa.Column("id", sa.String(length=36), primary_key=True))
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            projects.insert(),
            [{"id": "live", "is_active": True}, {"id": "archived", "is_active": False}],
        )
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        inspector = sa.inspect(connection)
        columns = {c["name"]: c for c in inspector.get_columns("projects")}
        assert columns["archived_at"]["nullable"] is True
        run_columns = {c["name"]: c for c in inspector.get_columns("runs")}
        assert run_columns["purge_clock_started_at"]["nullable"] is True
        rows = dict(connection.execute(sa.text("SELECT id, archived_at FROM projects")).all())
        # A project archived before this version pauses its purge from now on.
        assert rows["live"] is None and rows["archived"] is not None

        migration.downgrade()
        inspector = sa.inspect(connection)
        assert "archived_at" not in {c["name"] for c in inspector.get_columns("projects")}
        assert "purge_clock_started_at" not in {c["name"] for c in inspector.get_columns("runs")}
    engine.dispose()


def test_subcategory_taxonomy_migration_preserves_rows_and_defaults_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _load_migration("0045_subcategory_taxonomy.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    catalog = sa.Table(
        "project_analysis_category_catalog_versions",
        metadata,
        sa.Column("id", sa.String(length=36), primary_key=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(catalog.insert().values(id="existing"))
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]: column
            for column in sa.inspect(connection).get_columns(catalog.name)
        }
        taxonomy_column = columns["subcategory_taxonomy"]
        assert isinstance(taxonomy_column["type"], sa.JSON)
        assert taxonomy_column["nullable"] is False
        stored = connection.execute(
            sa.text(
                "SELECT subcategory_taxonomy "
                "FROM project_analysis_category_catalog_versions "
                "WHERE id = 'existing'"
            )
        ).scalar_one()
        assert stored == "{}"

        migration.downgrade()
        column_names = {
            column["name"]
            for column in sa.inspect(connection).get_columns(catalog.name)
        }
        assert "subcategory_taxonomy" not in column_names

    engine.dispose()


def test_root_cause_issue_migration_preserves_rows_and_nullable_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _load_migration("0046_root_cause_issues.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    corrections = sa.Table(
        "review_corrections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(corrections.insert().values(id=1))
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]: column
            for column in sa.inspect(connection).get_columns(corrections.name)
        }
        for name in ("ai_root_cause_issues", "human_root_cause_issues"):
            assert isinstance(columns[name]["type"], sa.JSON)
            assert columns[name]["nullable"] is True
        stored = connection.execute(
            sa.text(
                "SELECT ai_root_cause_issues, human_root_cause_issues "
                "FROM review_corrections WHERE id = 1"
            )
        ).one()
        assert tuple(stored) == (None, None)

        migration.downgrade()
        column_names = {
            column["name"]
            for column in sa.inspect(connection).get_columns(corrections.name)
        }
        assert "ai_root_cause_issues" not in column_names
        assert "human_root_cause_issues" not in column_names

    engine.dispose()


def test_catalog_backfill_scopes_streaming_to_select_statements() -> None:
    """PostgreSQL cannot execute INSERT through a server-side SELECT cursor."""
    migration = _load_migration("0043_backfill_analysis_category_catalogs.py")

    class EmptyResult:
        def fetchmany(self, _size: int) -> list[Any]:
            return []

        def close(self) -> None:
            pass

    class FakeConnection:
        def __init__(self) -> None:
            self.execute_options: list[Optional[dict[str, Any]]] = []

        def execution_options(self, **_options: Any) -> Any:
            raise AssertionError("streaming must not mutate the Alembic connection")

        def execute(
            self,
            _statement: Any,
            _parameters: Any = None,
            *,
            execution_options: Optional[dict[str, Any]] = None,
        ) -> EmptyResult:
            self.execute_options.append(execution_options)
            return EmptyResult()

    connection = FakeConnection()
    migration._legacy_project_catalog(connection, "project-1")

    assert connection.execute_options == [{"stream_results": True}]
