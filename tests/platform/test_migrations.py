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

    assert heads == ["0060"]


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


EVAL_TABLES = {"eval_environments", "eval_environment_schemas", "eval_model_slots"}
TS = "2026-09-29 00:00:00"


def _eval_environment_prerequisites(engine: sa.engine.Engine) -> sa.Table:
    """Create the minimal pre-0060 tables the eval-environment migration touches."""
    metadata = sa.MetaData()
    sa.Table("users", metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table("projects", metadata, sa.Column("id", sa.String(36), primary_key=True))
    connections = sa.Table(
        "project_llm_connections",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id")),
        sa.Column("name", sa.String(200), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO users (id) VALUES ('u')"))
        connection.execute(sa.text("INSERT INTO projects (id) VALUES ('p1'), ('p2')"))
        connection.execute(
            connections.insert().values(id="c1", project_id="p1", name="existing")
        )
    return connections


def _insert_environment(connection: sa.Connection, env_id: str, **values: Any) -> None:
    row = {
        "id": env_id,
        "project_id": "p1",
        "name": env_id,
        "base_url": "https://eval.example.test/api",
        "created_at": TS,
        "updated_at": TS,
        **values,
    }
    columns = ", ".join(row)
    params = ", ".join(f":{key}" for key in row)
    connection.execute(
        sa.text(f"INSERT INTO eval_environments ({columns}) VALUES ({params})"), row
    )


def _assert_eval_environment_constraints(connection: sa.Connection) -> None:
    """Exercise 0060 defaults, uniqueness, checks and cascades on either dialect."""

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    def rejected(statement: Any, params: dict[str, Any]) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                connection.execute(statement, params)

    def env_rejected(env_id: str, **values: Any) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                _insert_environment(connection, env_id, **values)

    # Existing connections default to being offered in the model picker.
    assert bool(scalar("SELECT available_for_experiments FROM project_llm_connections"))

    _insert_environment(connection, "e1")
    env = (
        connection.execute(sa.text("SELECT * FROM eval_environments")).mappings().one()
    )
    assert env["default_priority"] == "NORMAL"
    assert env["max_priority"] == "NORMAL"
    assert env["max_inflight_jobs"] == 5
    assert not env["allow_connection_keys"]
    assert env["is_active"]
    assert env["health_status"] == "unknown"
    assert env["api_key_encrypted"] == "" and env["api_key_last4"] == ""
    assert env["current_schema_id"] is None
    assert env["ranking_metric"] is None and env["ranking_k"] is None

    # Platform-wide: the same active URL can't be registered in another project.
    env_rejected("dup-url", project_id="p2")
    # Names are unique per project; the same name in another project is fine.
    env_rejected("e1-name", name="e1", base_url="https://other.test")
    _insert_environment(
        connection, "e2", project_id="p2", name="e1", base_url="https://b.test"
    )
    env_rejected("bad-priority", base_url="https://c.test", max_priority="URGENT")
    env_rejected("bad-cap", base_url="https://d.test", max_inflight_jobs=0)

    # The index covers active environments only: a soft-disabled one frees its URL.
    connection.execute(
        sa.text("UPDATE eval_environments SET is_active = :off WHERE id = 'e1'"),
        {"off": False},
    )
    _insert_environment(connection, "e3", project_id="p2")
    env_rejected("e4", base_url="https://eval.example.test/api")

    insert_schema = sa.text(
        "INSERT INTO eval_environment_schemas "
        "(id, environment_id, schema_hash, schema_json, fetched_at, first_seen_at) "
        "VALUES (:id, 'e1', :hash, '{}', :ts, :ts)"
    )
    connection.execute(insert_schema, {"id": "s1", "hash": "a" * 64, "ts": TS})
    rejected(insert_schema, {"id": "s2", "hash": "a" * 64, "ts": TS})
    connection.execute(
        sa.text("UPDATE eval_environments SET current_schema_id = 's1' WHERE id = 'e1'")
    )

    insert_slot = sa.text(
        "INSERT INTO eval_model_slots (id, environment_id, schema_id, slot_key, kind, "
        "field_map, transport_fields, created_at, updated_at) VALUES "
        "(:id, 'e1', 's1', :slot_key, :kind, '{}', '{}', :ts, :ts)"
    )
    connection.execute(
        insert_slot,
        {"id": "m1", "slot_key": "endpoint:primary", "kind": "endpoint", "ts": TS},
    )
    slot = (
        connection.execute(sa.text("SELECT * FROM eval_model_slots")).mappings().one()
    )
    assert slot["status"] == "proposed" and not slot["required"]
    assert slot["label"] == ""
    rejected(
        insert_slot,
        {"id": "m2", "slot_key": "endpoint:primary", "kind": "endpoint", "ts": TS},
    )
    rejected(
        insert_slot, {"id": "m3", "slot_key": "flat:VIZ", "kind": "nested", "ts": TS}
    )

    # Deleting a schema clears the environment's pointer to it.
    connection.execute(sa.text("DELETE FROM eval_environment_schemas WHERE id = 's1'"))
    assert (
        scalar("SELECT current_schema_id FROM eval_environments WHERE id = 'e1'")
        is None
    )
    assert scalar("SELECT COUNT(*) FROM eval_model_slots") == 0

    # Deleting an environment cascades to its schemas and slots.
    connection.execute(insert_schema, {"id": "s1", "hash": "b" * 64, "ts": TS})
    connection.execute(
        insert_slot, {"id": "m4", "slot_key": "flat:VIZ", "kind": "flat", "ts": TS}
    )
    connection.execute(sa.text("DELETE FROM eval_environments WHERE id = 'e1'"))
    assert scalar("SELECT COUNT(*) FROM eval_environment_schemas") == 0
    assert scalar("SELECT COUNT(*) FROM eval_model_slots") == 0


def _assert_eval_environments_dropped(connection: sa.Connection) -> None:
    inspector = sa.inspect(connection)
    assert not set(inspector.get_table_names()) & EVAL_TABLES
    assert "available_for_experiments" not in {
        column["name"] for column in inspector.get_columns("project_llm_connections")
    }


def test_eval_environments_migration_sqlite_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _load_migration("0060_eval_environments.py")
    engine = sa.create_engine("sqlite://")
    _eval_environment_prerequisites(engine)

    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert EVAL_TABLES <= set(inspector.get_table_names())
        assert {
            fk["referred_table"]
            for fk in inspector.get_foreign_keys("eval_environments")
        } == {"projects", "users", "eval_environment_schemas"}
        _assert_eval_environment_constraints(connection)

        migration.downgrade()
        _assert_eval_environments_dropped(connection)
        assert (
            connection.execute(
                sa.text("SELECT name FROM project_llm_connections")
            ).scalar_one()
            == "existing"
        )

        # Re-upgrading after a downgrade is clean.
        migration.upgrade()
        assert EVAL_TABLES <= set(sa.inspect(connection).get_table_names())

    engine.dispose()


def test_eval_environments_migration_matches_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ORM models and migration 0060 describe the same schema."""
    from alembic.autogenerate import compare_metadata
    from qym_platform.db import models
    from qym_platform.db.base import Base

    migration = _load_migration("0060_eval_environments.py")
    engine = sa.create_engine("sqlite://")
    _eval_environment_prerequisites(engine)

    def include_object(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
        table = obj if kind == "table" else getattr(obj, "table", None)
        return table is not None and table.name in EVAL_TABLES

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True, "include_object": include_object},
        )
        assert compare_metadata(context, Base.metadata) == []

    column = models.ProjectLlmConnection.__table__.c.available_for_experiments
    assert column.server_default is not None and not column.nullable
    engine.dispose()


@pytest.fixture
def postgres_engine(request: pytest.FixtureRequest) -> sa.engine.Engine:
    import os
    from uuid import uuid4

    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_migration_0060_" + uuid4().hex
    admin = sa.create_engine(url)
    with admin.begin() as connection:
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    scoped = sa.engine.make_url(url).update_query_dict(
        {"options": f"-csearch_path={schema}"}
    )
    engine = sa.create_engine(scoped)

    def cleanup() -> None:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()

    request.addfinalizer(cleanup)
    return engine


def test_eval_environments_migration_postgres_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    migration = _load_migration("0060_eval_environments.py")
    _eval_environment_prerequisites(postgres_engine)

    with postgres_engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert EVAL_TABLES <= set(inspector.get_table_names())
        base_url_index = next(
            index
            for index in inspector.get_indexes("eval_environments")
            if index["name"] == "ux_eval_environments_active_base_url"
        )
        assert base_url_index["unique"]
        assert "is_active" in str(base_url_index["dialect_options"]["postgresql_where"])
        schema_json = next(
            column
            for column in inspector.get_columns("eval_environment_schemas")
            if column["name"] == "schema_json"
        )
        assert schema_json["type"].__class__.__name__ == "JSONB"
        _assert_eval_environment_constraints(connection)

        migration.downgrade()
        _assert_eval_environments_dropped(connection)

        migration.upgrade()
        assert EVAL_TABLES <= set(sa.inspect(connection).get_table_names())
