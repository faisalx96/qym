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

    assert heads == ["0084"]


def test_operations_docs_name_the_current_migration_head() -> None:
    """The deploy runbook tells operators which revision to wait for before
    the API is healthy and before a separate worker (QYM_SKIP_MIGRATIONS=1)
    starts; an older head there lets the worker start before the newest
    tables exist. Every place the docs name the head names this one."""
    import re

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    (head,) = ScriptDirectory.from_config(config).get_heads()
    pattern = re.compile(r"(?:one head,|migration head|migrated to|\(head)\s+`(\d{4})`")
    named = {}
    for doc in ("docs/internal/OPERATIONS.md", "docs/RELEASE_NOTES.md"):
        named[doc] = pattern.findall((ROOT / doc).read_text(encoding="utf-8"))
    # The chain's head, the runbook's wait and the worker's start, the
    # release note.
    assert len(named["docs/internal/OPERATIONS.md"]) == 3, named
    assert named["docs/RELEASE_NOTES.md"][:1] == [head], named
    assert {revision for found in named.values() for revision in found} == {head}, named


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


def test_dataset_search_migration_adds_nullable_columns_and_queues_the_backfill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from qym_platform.db.maintenance_models import MaintenanceJob
    from qym_platform.services import maintenance

    migration = _load_migration("0068_dataset_search_text.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    items = sa.Table("dataset_items", metadata, sa.Column("id", sa.Integer(), primary_key=True))
    sa.Table("dataset_versions", metadata, sa.Column("id", sa.String(length=36), primary_key=True))
    sa.Table("datasets", metadata, sa.Column("id", sa.String(length=36), primary_key=True))
    metadata.create_all(engine)
    MaintenanceJob.__table__.create(engine)
    jobs = "SELECT kind, status FROM maintenance_jobs"

    with engine.begin() as connection:
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert {c["name"]: c["nullable"] for c in inspector.get_columns("dataset_items")}["search_text"] is True
        assert {c["name"]: c["nullable"] for c in inspector.get_columns("dataset_versions")}["change_counts"] is True
        assert {c["name"]: c["nullable"] for c in inspector.get_columns("datasets")}["deleted_by_user_id"] is True
        # Queued on an empty table too: the job is what builds the trigram
        # index, so a fresh install must get it.
        assert connection.execute(sa.text(jobs)).all() == [("backfill_dataset_search_text", "queued")]
        migration.downgrade()
        connection.execute(sa.text("DELETE FROM maintenance_jobs"))
        connection.execute(items.insert(), [{"id": 1}])
        migration.upgrade()
        assert connection.execute(sa.text(jobs)).all() == [("backfill_dataset_search_text", "queued")]
        migration.downgrade()
        assert "search_text" not in {c["name"] for c in sa.inspect(connection).get_columns("dataset_items")}
    assert "backfill_dataset_search_text" in maintenance.registry()
    engine.dispose()


def test_dataset_search_backfill_job_fills_text_and_published_counts() -> None:
    from sqlalchemy.orm import sessionmaker

    from qym_platform.db.base import Base
    from qym_platform.db.models import Dataset, DatasetItem, DatasetVersion, Project, User
    from qym_platform.services import maintenance

    engine = sa.create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add(User(id="u", email="u@x.com"))
        db.add(Project(id="p", name="P", slug="p", created_by_user_id="u"))
        db.add(Dataset(id="d", project_id="p", name="D", slug="d", created_by_user_id="u"))
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.add(DatasetVersion(id="v2", dataset_id="d", version="v2", status="published", parent_version_id="v1", created_by_user_id="u"))
        db.flush()
        for version_id, value in (("v1", "قديم"), ("v2", "جديد")):
            db.add(DatasetItem(dataset_version_id=version_id, item_id="a", index=0, input=value, item_metadata={"tag": "X"}, fingerprint=value))
        db.commit()
        # Rows written before the column existed.
        db.execute(sa.update(DatasetItem).values(search_text=None))
        db.commit()
    with factory() as db:
        maintenance.enqueue(db, "backfill_dataset_search_text", {"window": 1})
        db.commit()
    assert maintenance.MaintenanceWorker(factory, engine).tick() == "succeeded"
    with factory() as db:
        texts = sorted(row.search_text for row in db.query(DatasetItem))
        counts = {v.id: v.change_counts for v in db.query(DatasetVersion)}
    assert texts == ["a\nجديد\n\n{\"tag\": \"x\"}", "a\nقديم\n\n{\"tag\": \"x\"}"]
    assert counts == {
        "v1": {"added": 1, "modified": 0, "deleted": 0, "unchanged": 0},
        "v2": {"added": 0, "modified": 1, "deleted": 0, "unchanged": 0},
    }
    engine.dispose()


def test_overview_store_and_runs_search_migrations_are_quick_ddl_that_queue_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C037/C060: 0069 adds two empty tables and queues the overview backfill;
    0070 only queues the runs search index job (the index is built
    CONCURRENTLY by the job, never by the migration)."""
    from sqlalchemy.orm import sessionmaker

    from qym_platform.db.maintenance_models import MaintenanceJob
    from qym_platform.services import maintenance

    overview = _load_migration("0069_dashboard_overview_store.py")
    search = _load_migration("0070_runs_search_index.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "dashboard_run_summaries", metadata, sa.Column("run_key", sa.String(36), primary_key=True)
    )
    metadata.create_all(engine)
    MaintenanceJob.__table__.create(engine)
    jobs = "SELECT kind, status FROM maintenance_jobs ORDER BY kind"

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(overview, "op", operations)
        monkeypatch.setattr(search, "op", operations)
        statements = []
        sa.event.listen(
            connection, "before_cursor_execute", lambda *args: statements.append(args[2])
        )
        overview.upgrade()
        search.upgrade()
        tables = set(sa.inspect(connection).get_table_names())
        assert {"dashboard_run_overview", "dashboard_overview_snapshots"} <= tables
        assert connection.execute(sa.text(jobs)).all() == [
            ("backfill_dashboard_overview", "queued"),
            ("build_runs_search_index", "queued"),
        ]
        assert not [s for s in statements if "INDEX" in s.upper() and "TRGM" in s.upper()]
        search.downgrade()
        overview.downgrade()
        tables = set(sa.inspect(connection).get_table_names())
        assert not {"dashboard_run_overview", "dashboard_overview_snapshots"} & tables
    registered = maintenance.registry()
    assert {"backfill_dashboard_overview", "build_runs_search_index"} <= set(registered)
    engine.dispose()

    # On SQLite both jobs finish at once.
    from qym_platform.db.base import Base

    engine = sa.create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    worker = maintenance.MaintenanceWorker(factory, engine)
    for kind in ("backfill_dashboard_overview", "build_runs_search_index"):
        with factory() as db:
            maintenance.enqueue(db, kind, {})
            db.commit()
        assert worker.tick() == "succeeded"
        with factory() as db:
            job = db.query(MaintenanceJob).filter_by(kind=kind).one()
            assert "skipped: not PostgreSQL" in job.log, kind
    engine.dispose()


def test_runs_search_text_migration_adds_a_column_and_queues_the_job_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """0071 adds the nullable ``search_text`` column (instant DDL) and queues
    build_runs_search_index again, unless a job 0070 queued still waits to
    start (this release's job does both)."""
    from sqlalchemy.orm import sessionmaker

    from qym_platform.db.base import Base
    from qym_platform.db.dashboard_models import DashboardRunDimension as Dimension
    from qym_platform.db.maintenance_models import MaintenanceJob
    from qym_platform.services import maintenance

    search = _load_migration("0070_runs_search_index.py")
    text_column = _load_migration("0071_runs_search_text.py")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "dashboard_run_dimensions", metadata, sa.Column("run_key", sa.String(36), primary_key=True)
    )
    metadata.create_all(engine)
    MaintenanceJob.__table__.create(engine)
    jobs = "SELECT kind, status FROM maintenance_jobs ORDER BY created_at"
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(search, "op", operations)
        monkeypatch.setattr(text_column, "op", operations)
        search.upgrade()
        text_column.upgrade()
        columns = {c["name"] for c in sa.inspect(connection).get_columns("dashboard_run_dimensions")}
        assert "search_text" in columns
        # 0070's job has not started: it is the one that runs.
        assert connection.execute(sa.text(jobs)).all() == [("build_runs_search_index", "queued")]
        text_column.downgrade()
        connection.execute(sa.text("UPDATE maintenance_jobs SET status = 'succeeded'"))
        # A database whose 0070 job already ran gets a new one.
        text_column.upgrade()
        assert connection.execute(sa.text(jobs)).all() == [
            ("build_runs_search_index", "succeeded"),
            ("build_runs_search_index", "queued"),
        ]
        text_column.downgrade()
        columns = {c["name"] for c in sa.inspect(connection).get_columns("dashboard_run_dimensions")}
        assert "search_text" not in columns
    engine.dispose()

    # The job fills the column for rows written before it existed.
    engine = sa.create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    stamp = sa.func.now()
    with factory() as db:
        for index, (external, name) in enumerate([("Base-0818", "Baseline"), ("", None), (7, "Seven")]):
            db.add(
                Dimension(
                    run_key=f"r{index}", project_key="p", task="t", model="m", dataset="d",
                    version="", owner="u", status="COMPLETED", timestamp=stamp, created_at=stamp,
                    present=True, descriptor={"external_run_id": external, "run_name": name},
                )
            )
        db.commit()
        maintenance.enqueue(db, "build_runs_search_index", {"window": 2})
        db.commit()
    assert maintenance.MaintenanceWorker(factory, engine).tick() == "succeeded"
    with factory() as db:
        assert {row.run_key: row.search_text for row in db.query(Dimension)} == {
            "r0": "base-0818\nbaseline", "r1": "\n", "r2": "7\nseven",
        }
        job = db.query(MaintenanceJob).filter_by(kind="build_runs_search_index").one()
        assert job.progress["runs_filled"] == 3
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


EVAL_TABLES = {"eval_environments", "eval_environment_schemas", "eval_model_slots"}
TS = "2026-09-29 00:00:00"


def _eval_environment_prerequisites(engine: sa.engine.Engine) -> sa.Table:
    """Create the minimal pre-0072 tables the eval-environment migration touches."""
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
    """Exercise 0072 defaults, uniqueness, checks and cascades on either dialect."""

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
    migration = _load_migration("0072_eval_environments.py")
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
    """The ORM models and migrations 0072 + 0080 + 0081 describe the same schema."""
    from alembic.autogenerate import compare_metadata
    from qym_platform.db import models
    from qym_platform.db.base import Base

    migration = _load_migration("0072_eval_environments.py")
    drop_cap = _load_migration("0080_drop_eval_inflight_cap.py")
    extra_maps = _load_migration("0081_eval_slot_extra_field_maps.py")
    engine = sa.create_engine("sqlite://")
    _eval_environment_prerequisites(engine)

    def include_object(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
        table = obj if kind == "table" else getattr(obj, "table", None)
        return table is not None and table.name in EVAL_TABLES

    with engine.begin() as connection:
        ops = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", ops)
        monkeypatch.setattr(drop_cap, "op", ops)
        monkeypatch.setattr(extra_maps, "op", ops)
        migration.upgrade()
        drop_cap.upgrade()
        extra_maps.upgrade()
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
    schema = "qym_migration_0072_" + uuid4().hex
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
    migration = _load_migration("0072_eval_environments.py")
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


EXPERIMENT_TABLES = {
    "eval_experiments",
    "eval_experiment_jobs",
    "eval_remote_queue_snapshots",
}
RUN_EXPERIMENT_COLUMNS = {"origin", "experiment_job_id"}
RUN_EXPERIMENT_INDEXES = {"ix_runs_origin", "ix_runs_experiment_job_id"}
SCORE_TABLES = frozenset({"eval_run_scores"})  # 0076
# Revisions after 0073 that change its tables: (table, column they add, file).
# (table, marker column, revision, whether the revision adds the marker or drops it)
LATER_REVISIONS = (
    ("eval_experiment_jobs", "attempt", "0075_eval_job_attempts.py", True),
    ("eval_experiment_jobs", "run_linked_at", "0076_eval_run_scores.py", True),
    (
        "eval_experiments",
        "qym_api_key_id",
        "0077_eval_experiment_qym_api_key.py",
        True,
    ),
    ("eval_environments", "max_inflight_jobs", "0080_drop_eval_inflight_cap.py", False),
    ("eval_model_slots", "extra_field_maps", "0081_eval_slot_extra_field_maps.py", True),
    ("eval_experiments", "versioning_details", "0084_run_versioning_details.py", True),
)


def _eval_experiment_prerequisites(
    engine: sa.engine.Engine, monkeypatch: pytest.MonkeyPatch
) -> ModuleType:
    """Build the minimal pre-0073 schema (0072 plus ``runs`` with legacy rows)."""
    _eval_environment_prerequisites(engine)
    metadata = sa.MetaData()
    sa.Table(
        "runs",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("task", sa.String(200), nullable=False),
    )
    # Referenced by eval_experiments.qym_api_key_id (0077).
    sa.Table("api_keys", metadata, sa.Column("id", sa.String(36), primary_key=True))
    # Referenced by eval_run_scores (0076).
    sa.Table("datasets", metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table(
        "dataset_versions",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("dataset_id", sa.String(36), sa.ForeignKey("datasets.id")),
    )
    metadata.create_all(engine)
    previous = _load_migration("0072_eval_environments.py")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO runs (id, project_id, task) "
                "VALUES ('r1', 'p1', 'legacy'), ('r2', 'p1', 'legacy')"
            )
        )
        monkeypatch.setattr(
            previous, "op", Operations(MigrationContext.configure(connection))
        )
        previous.upgrade()
        _insert_environment(connection, "e1")
        connection.execute(
            sa.text(
                "INSERT INTO eval_environment_schemas (id, environment_id, "
                "schema_hash, schema_json, fetched_at, first_seen_at) "
                "VALUES ('s1', 'e1', :hash, '{}', :ts, :ts)"
            ),
            {"hash": "a" * 64, "ts": TS},
        )
    return _load_migration("0073_eval_experiments.py")


def _insert_row(connection: sa.Connection, table: str, **row: Any) -> None:
    columns = ", ".join(row)
    params = ", ".join(f":{key}" for key in row)
    connection.execute(
        sa.text(f"INSERT INTO {table} ({columns}) VALUES ({params})"), row
    )


def _insert_experiment(connection: sa.Connection, xid: str, **values: Any) -> None:
    _insert_row(
        connection,
        "eval_experiments",
        **{
            "id": xid,
            "project_id": "p1",
            "created_by_user_id": "u",
            "name": xid,
            "environment_ids": '["e1"]',
            "base_source": '{"kind": "blank"}',
            "spec": "{}",
            "created_at": TS,
            "updated_at": TS,
            **values,
        },
    )


def _insert_job(connection: sa.Connection, job_id: str, **values: Any) -> None:
    _insert_row(
        connection,
        "eval_experiment_jobs",
        **{
            "id": job_id,
            "experiment_id": "x1",
            "environment_id": "e1",
            "combo_index": 0,
            "params": "{}",
            "request_body": "{}",
            "schema_id": "s1",
            "created_at": TS,
            "updated_at": TS,
            **values,
        },
    )


def _assert_eval_experiment_constraints(connection: sa.Connection) -> None:
    """Exercise 0073 backfill, defaults, uniqueness, checks and FK actions."""

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    def rejected(insert: Any, row_id: str, **values: Any) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                insert(connection, row_id, **values)

    def statement_rejected(sql: str) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                connection.execute(sa.text(sql))

    # Existing runs are backfilled as local and unlinked.
    rows = connection.execute(
        sa.text("SELECT origin, experiment_job_id FROM runs ORDER BY id")
    ).all()
    assert [tuple(row) for row in rows] == [("local", None), ("local", None)]
    statement_rejected("UPDATE runs SET origin = 'remote'")

    _insert_experiment(connection, "x1")
    experiment = (
        connection.execute(sa.text("SELECT * FROM eval_experiments")).mappings().one()
    )
    assert experiment["priority"] == "NORMAL"
    assert experiment["status"] == "QUEUED"
    assert experiment["job_count"] == 0
    assert experiment["description"] == ""
    assert experiment["secrets_encrypted"] is None
    rejected(_insert_experiment, "bad-priority", priority="URGENT")
    rejected(_insert_experiment, "bad-status", status="DONE")
    rejected(_insert_experiment, "bad-count", job_count=-1)

    _insert_job(connection, "j1")
    job = (
        connection.execute(sa.text("SELECT * FROM eval_experiment_jobs"))
        .mappings()
        .one()
    )
    assert job["status"] == "QUEUED"
    assert job["submit_attempts"] == 0
    for column in ("run_id", "lease_owner", "wait_reason", "cancel_requested_at"):
        assert job[column] is None
    # One job per (experiment, environment, combo).
    rejected(_insert_job, "j1-dup")
    _insert_job(connection, "j2", combo_index=1)
    rejected(_insert_job, "bad-status", combo_index=2, status="DONE")
    rejected(_insert_job, "bad-combo", combo_index=-1)
    rejected(_insert_job, "bad-env", combo_index=3, environment_id="missing")

    # Link run r1 <-> job j1; a run links to at most one job.
    connection.execute(
        sa.text("UPDATE eval_experiment_jobs SET run_id = 'r1' WHERE id = 'j1'")
    )
    statement_rejected("UPDATE eval_experiment_jobs SET run_id = 'r1' WHERE id = 'j2'")
    connection.execute(
        sa.text(
            "UPDATE runs SET origin = 'official', experiment_job_id = 'j1' "
            "WHERE id = 'r1'"
        )
    )
    statement_rejected("UPDATE runs SET experiment_job_id = 'missing' WHERE id = 'r2'")

    # Deleting a run unlinks its job; deleting a job unlinks its run.
    connection.execute(
        sa.text("UPDATE eval_experiment_jobs SET run_id = 'r2' WHERE id = 'j2'")
    )
    connection.execute(sa.text("DELETE FROM runs WHERE id = 'r2'"))
    assert scalar("SELECT run_id FROM eval_experiment_jobs WHERE id = 'j2'") is None
    connection.execute(sa.text("DELETE FROM eval_experiment_jobs WHERE id = 'j1'"))
    assert scalar("SELECT experiment_job_id FROM runs WHERE id = 'r1'") is None
    assert scalar("SELECT origin FROM runs WHERE id = 'r1'") == "official"

    snapshot = {"environment_id": "e1", "fetched_at": TS, "items": "[]"}
    _insert_row(connection, "eval_remote_queue_snapshots", **snapshot)
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            _insert_row(connection, "eval_remote_queue_snapshots", **snapshot)

    # Deleting an experiment cascades to its jobs.
    connection.execute(sa.text("DELETE FROM eval_experiments WHERE id = 'x1'"))
    assert scalar("SELECT COUNT(*) FROM eval_experiment_jobs") == 0

    # A project hard-delete reaches jobs through both experiments and
    # environments; it must succeed and take the snapshot with it.
    _insert_experiment(connection, "x2")
    _insert_job(connection, "j3", experiment_id="x2", run_id="r1")
    connection.execute(sa.text("DELETE FROM project_llm_connections"))
    connection.execute(sa.text("DELETE FROM projects WHERE id = 'p1'"))
    for table in ("eval_environments", "eval_experiments", "eval_experiment_jobs"):
        assert scalar(f"SELECT COUNT(*) FROM {table}") == 0
    assert scalar("SELECT COUNT(*) FROM eval_remote_queue_snapshots") == 0
    assert scalar("SELECT COUNT(*) FROM runs") == 1


def _assert_eval_experiments_dropped(connection: sa.Connection) -> None:
    inspector = sa.inspect(connection)
    assert not set(inspector.get_table_names()) & EXPERIMENT_TABLES
    assert EVAL_TABLES <= set(inspector.get_table_names())
    assert not RUN_EXPERIMENT_COLUMNS & {
        column["name"] for column in inspector.get_columns("runs")
    }
    assert not RUN_EXPERIMENT_INDEXES & {
        index["name"] for index in inspector.get_indexes("runs")
    }
    assert connection.execute(sa.text("SELECT COUNT(*) FROM runs")).scalar_one() == 1


def _assert_run_origin_indexed(connection: sa.Connection) -> None:
    indexes = {
        index["name"]: index["column_names"]
        for index in sa.inspect(connection).get_indexes("runs")
    }
    assert indexes["ix_runs_origin"] == ["origin"]
    assert indexes["ix_runs_experiment_job_id"] == ["experiment_job_id"]


def test_eval_experiments_migration_sqlite_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    migration = _eval_experiment_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert EXPERIMENT_TABLES <= set(inspector.get_table_names())
        # SQLAlchemy doesn't reflect options of an inline (ADD COLUMN) FK.
        fks = connection.exec_driver_sql("PRAGMA foreign_key_list(runs)").all()
        assert [(fk[2], fk[3], fk[6]) for fk in fks] == [
            ("eval_experiment_jobs", "experiment_job_id", "SET NULL")
        ]
        _assert_run_origin_indexed(connection)
        _assert_eval_experiment_constraints(connection)

        migration.downgrade()
        _assert_eval_experiments_dropped(connection)

        # Re-upgrading after a downgrade is clean and backfills again.
        migration.upgrade()
        assert EXPERIMENT_TABLES <= set(sa.inspect(connection).get_table_names())
        origins = connection.execute(sa.text("SELECT origin FROM runs")).scalars()
        assert set(origins) == {"local"}

    engine.dispose()


def _eval_experiment_model_diffs(
    connection: sa.Connection, extra_tables: frozenset[str] = frozenset()
) -> list[Any]:
    """Diff the ORM models against the 0072/0073 tables and ``runs`` additions.

    ``extra_tables`` adds tables from later revisions (e.g. 0074 presets).
    """
    from alembic.autogenerate import compare_metadata
    from qym_platform.db.base import Base

    sqlite = connection.dialect.name == "sqlite"

    def include_object(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
        table = obj if kind == "table" else getattr(obj, "table", None)
        if table is None:
            return False
        if table.name in EVAL_TABLES | EXPERIMENT_TABLES | SCORE_TABLES | extra_tables:
            return True
        if table.name != "runs":
            return False
        # The test ``runs`` table is minimal: compare only what 0073 adds.
        if kind == "column":
            return name in RUN_EXPERIMENT_COLUMNS
        if kind == "index":
            return name in RUN_EXPERIMENT_INDEXES
        if kind == "foreign_key_constraint":
            # SQLite reflects the inline FK without its name or ON DELETE, so
            # it is checked with PRAGMA there and compared on PostgreSQL.
            columns = {column.name for column in obj.columns}
            return not sqlite and columns == {"experiment_job_id"}
        return kind == "table"

    def include_eval_object(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
        # Same for eval_experiments.qym_api_key_id (0077): PRAGMA-checked on SQLite.
        if sqlite and kind == "foreign_key_constraint":
            columns = {column.name for column in obj.columns}
            if columns == {"qym_api_key_id"}:
                return False
        return include_object(obj, name, kind, reflected, compare_to)

    def diffs() -> list[Any]:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True, "include_object": include_eval_object},
        )
        return compare_metadata(context, Base.metadata)

    inspector = sa.inspect(connection)
    columns = {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in {table for table, _, _, _ in LATER_REVISIONS}
    }
    # The models describe the schema at head: apply the later revisions missing here.
    pending = [
        filename
        for table, marker, filename, adds in LATER_REVISIONS
        if (marker in columns[table]) != adds
    ]
    if not pending:
        return diffs()
    savepoint = connection.begin_nested()
    try:
        for filename in pending:
            later = _load_migration(filename)
            later.op = Operations(MigrationContext.configure(connection))
            later.upgrade()
        return diffs()
    finally:
        savepoint.rollback()


def test_eval_experiments_migration_matches_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ORM models and migration 0073 describe the same schema."""
    from qym_platform.db import models

    engine = sa.create_engine("sqlite://")
    migration = _eval_experiment_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        assert _eval_experiment_model_diffs(connection) == []

    origin = models.Run.__table__.c.origin
    assert origin.server_default is not None and not origin.nullable
    fk = next(iter(models.Run.__table__.c.experiment_job_id.foreign_keys))
    assert fk.ondelete == "SET NULL" and fk.use_alter
    engine.dispose()


def test_eval_experiments_migration_postgres_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    migration = _eval_experiment_prerequisites(postgres_engine, monkeypatch)

    with postgres_engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert EXPERIMENT_TABLES <= set(inspector.get_table_names())
        run_fk = next(
            fk
            for fk in inspector.get_foreign_keys("runs")
            if fk["name"] == "fk_runs_experiment_job_id"
        )
        assert run_fk["referred_table"] == "eval_experiment_jobs"
        assert run_fk["options"].get("ondelete") == "SET NULL"
        assert "ck_runs_origin" in {
            check["name"] for check in inspector.get_check_constraints("runs")
        }
        spec = next(
            column
            for column in inspector.get_columns("eval_experiments")
            if column["name"] == "spec"
        )
        assert spec["type"].__class__.__name__ == "JSONB"
        _assert_run_origin_indexed(connection)
        assert _eval_experiment_model_diffs(connection) == []
        _assert_eval_experiment_constraints(connection)

        migration.downgrade()
        _assert_eval_experiments_dropped(connection)

        migration.upgrade()
        assert EXPERIMENT_TABLES <= set(sa.inspect(connection).get_table_names())


PRESET_TABLES = frozenset({"eval_config_presets", "eval_config_preset_versions"})


def _eval_preset_prerequisites(
    engine: sa.engine.Engine, monkeypatch: pytest.MonkeyPatch
) -> ModuleType:
    """Build the pre-0074 schema (0072 + 0073) with an environment and schema."""
    previous = _eval_experiment_prerequisites(engine, monkeypatch)
    with engine.begin() as connection:
        monkeypatch.setattr(
            previous, "op", Operations(MigrationContext.configure(connection))
        )
        previous.upgrade()
    return _load_migration("0074_eval_config_presets.py")


def _insert_preset(connection: sa.Connection, preset_id: str, **values: Any) -> None:
    _insert_row(
        connection,
        "eval_config_presets",
        **{
            "id": preset_id,
            "environment_id": "e1",
            "name": preset_id,
            "kind": "saved",
            "created_by_user_id": "u",
            "created_at": TS,
            "updated_at": TS,
            **values,
        },
    )


def _insert_preset_version(
    connection: sa.Connection, version_id: str, **values: Any
) -> None:
    _insert_row(
        connection,
        "eval_config_preset_versions",
        **{
            "id": version_id,
            "preset_id": "official",
            "version": 1,
            "schema_id": "s1",
            "config": '{"evaluator": {}, "env_overrides": {}, "slot_bindings": {}}',
            "published_by_user_id": "u",
            "published_at": TS,
            **values,
        },
    )


def _assert_eval_preset_constraints(connection: sa.Connection) -> None:
    """Exercise 0074 defaults, uniqueness, checks and FK actions."""

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    def rejected(insert: Any, row_id: str, **values: Any) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                insert(connection, row_id, **values)

    def statement_rejected(sql: str) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                connection.execute(sa.text(sql))

    _insert_environment(connection, "e2", base_url="https://second.test")

    # At most one official preset per environment; saved ones are unlimited.
    _insert_preset(connection, "official", kind="official")
    rejected(_insert_preset, "official-2", kind="official")
    _insert_preset(connection, "official-e2", kind="official", environment_id="e2")
    _insert_preset(connection, "saved-1")
    _insert_preset(connection, "saved-2", name="saved-1")
    rejected(_insert_preset, "bad-kind", kind="draft")
    rejected(_insert_preset, "bad-env", environment_id="missing")
    statement_rejected(
        "UPDATE eval_config_presets SET kind = 'official' WHERE id = 'saved-2'"
    )
    preset = (
        connection.execute(
            sa.text("SELECT * FROM eval_config_presets WHERE id = 'official'")
        )
        .mappings()
        .one()
    )
    assert preset["current_version_id"] is None

    _insert_preset_version(connection, "v1")
    version = (
        connection.execute(sa.text("SELECT * FROM eval_config_preset_versions"))
        .mappings()
        .one()
    )
    assert version["notes"] == ""
    # One row per (preset, version); versions start at 1.
    rejected(_insert_preset_version, "v1-dup")
    rejected(_insert_preset_version, "v0", version=0)
    rejected(_insert_preset_version, "bad-schema", version=9, schema_id="missing")
    _insert_preset_version(connection, "v2", version=2, notes="Raise temperature")
    _insert_preset_version(connection, "saved-v1", preset_id="saved-1")
    connection.execute(
        sa.text(
            "UPDATE eval_config_presets SET current_version_id = 'v2' "
            "WHERE id = 'official'"
        )
    )
    statement_rejected(
        "UPDATE eval_config_presets SET current_version_id = 'missing' "
        "WHERE id = 'official'"
    )

    # Deleting the current version clears the pointer.
    connection.execute(
        sa.text("DELETE FROM eval_config_preset_versions WHERE id = 'v2'")
    )
    assert (
        scalar(
            "SELECT current_version_id FROM eval_config_presets WHERE id = 'official'"
        )
        is None
    )
    # Deleting a publisher keeps the version.
    connection.execute(sa.text("INSERT INTO users (id) VALUES ('publisher')"))
    _insert_preset_version(
        connection, "v3", version=3, published_by_user_id="publisher"
    )
    connection.execute(sa.text("DELETE FROM users WHERE id = 'publisher'"))
    assert (
        scalar(
            "SELECT published_by_user_id FROM eval_config_preset_versions "
            "WHERE id = 'v3'"
        )
        is None
    )

    # Deleting a preset cascades to its versions, including its current one.
    connection.execute(
        sa.text(
            "UPDATE eval_config_presets SET current_version_id = 'saved-v1' "
            "WHERE id = 'saved-1'"
        )
    )
    connection.execute(sa.text("DELETE FROM eval_config_presets WHERE id = 'saved-1'"))
    assert (
        scalar(
            "SELECT COUNT(*) FROM eval_config_preset_versions "
            "WHERE preset_id = 'saved-1'"
        )
        == 0
    )

    # Regression: a project hard-delete reaches versions through presets and
    # through schemas, and clears current_version_id pointers on the way. It
    # must succeed with presets, versions, experiments and jobs present.
    connection.execute(
        sa.text(
            "UPDATE eval_config_presets SET current_version_id = 'v3' "
            "WHERE id = 'official'"
        )
    )
    _insert_experiment(connection, "x1")
    _insert_job(connection, "j1")
    connection.execute(sa.text("DELETE FROM project_llm_connections"))
    connection.execute(sa.text("DELETE FROM projects WHERE id = 'p1'"))
    for table in (
        "eval_environments",
        "eval_environment_schemas",
        "eval_experiment_jobs",
        *sorted(PRESET_TABLES),
    ):
        assert scalar(f"SELECT COUNT(*) FROM {table}") == 0


def _assert_eval_presets_dropped(connection: sa.Connection) -> None:
    tables = set(sa.inspect(connection).get_table_names())
    assert not tables & PRESET_TABLES
    assert EVAL_TABLES | EXPERIMENT_TABLES <= tables


def test_eval_presets_migration_sqlite_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    migration = _eval_preset_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert PRESET_TABLES <= set(inspector.get_table_names())
        assert {
            fk["referred_table"]
            for fk in inspector.get_foreign_keys("eval_config_presets")
        } == {"eval_environments", "users", "eval_config_preset_versions"}
        _assert_eval_preset_constraints(connection)

        migration.downgrade()
        _assert_eval_presets_dropped(connection)

        # Re-upgrading after a downgrade is clean.
        migration.upgrade()
        assert PRESET_TABLES <= set(sa.inspect(connection).get_table_names())

    engine.dispose()


def test_eval_presets_migration_matches_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ORM models and migration 0074 describe the same schema."""
    from qym_platform.db import models

    engine = sa.create_engine("sqlite://")
    migration = _eval_preset_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        assert _eval_experiment_model_diffs(connection, PRESET_TABLES) == []

    table = models.EvalConfigPreset.__table__
    current_fk = next(iter(table.c.current_version_id.foreign_keys))
    assert current_fk.ondelete == "SET NULL" and current_fk.use_alter
    assert next(iter(table.c.environment_id.foreign_keys)).ondelete == "CASCADE"
    engine.dispose()


def test_eval_presets_migration_postgres_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    migration = _eval_preset_prerequisites(postgres_engine, monkeypatch)

    with postgres_engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert PRESET_TABLES <= set(inspector.get_table_names())
        current_fk = next(
            fk
            for fk in inspector.get_foreign_keys("eval_config_presets")
            if fk["name"] == "fk_eval_config_presets_current_version"
        )
        assert current_fk["referred_table"] == "eval_config_preset_versions"
        assert current_fk["options"].get("ondelete") == "SET NULL"
        official_index = next(
            index
            for index in inspector.get_indexes("eval_config_presets")
            if index["name"] == "ux_eval_config_presets_official_env"
        )
        assert official_index["unique"]
        assert "official" in str(official_index["dialect_options"]["postgresql_where"])
        config = next(
            column
            for column in inspector.get_columns("eval_config_preset_versions")
            if column["name"] == "config"
        )
        assert config["type"].__class__.__name__ == "JSONB"
        assert _eval_experiment_model_diffs(connection, PRESET_TABLES) == []
        _assert_eval_preset_constraints(connection)

        migration.downgrade()
        _assert_eval_presets_dropped(connection)

        migration.upgrade()
        assert PRESET_TABLES <= set(sa.inspect(connection).get_table_names())


JOB_INDEXES = {
    "ix_eval_experiment_jobs_status_next_attempt",
    "ix_eval_experiment_jobs_environment_status",
    "ix_eval_experiment_jobs_run_id",
}


def _eval_job_attempt_prerequisites(
    engine: sa.engine.Engine, monkeypatch: pytest.MonkeyPatch
) -> ModuleType:
    """Build the pre-0075 schema (0072-0074) with a job linked to run ``r1``."""
    previous = _eval_preset_prerequisites(engine, monkeypatch)
    with engine.begin() as connection:
        monkeypatch.setattr(
            previous, "op", Operations(MigrationContext.configure(connection))
        )
        previous.upgrade()
        _insert_experiment(connection, "x1")
        _insert_job(connection, "j1", run_id="r1")
        _insert_job(connection, "j2", combo_index=1)
        connection.execute(
            sa.text("UPDATE runs SET experiment_job_id = 'j1' WHERE id = 'r1'")
        )
    return _load_migration("0075_eval_job_attempts.py")


def _assert_eval_job_attempt_constraints(connection: sa.Connection) -> None:
    """Exercise 0075 backfill, the new unique key, checks, FKs and kept indexes."""

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    def rejected(job_id: str, **values: Any) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                _insert_job(connection, job_id, **values)

    # Existing rows are attempt 0 and keep their run links in both directions.
    rows = connection.execute(
        sa.text(
            "SELECT id, attempt, retry_of_job_id, run_id FROM eval_experiment_jobs "
            "ORDER BY id"
        )
    ).all()
    assert [tuple(r) for r in rows] == [("j1", 0, None, "r1"), ("j2", 0, None, None)]
    assert scalar("SELECT experiment_job_id FROM runs WHERE id = 'r1'") == "j1"
    assert JOB_INDEXES | {"ix_eval_experiment_jobs_retry_of_job_id"} <= {
        index["name"]
        for index in sa.inspect(connection).get_indexes("eval_experiment_jobs")
    }

    # A retry is the same combination with the next attempt.
    _insert_job(connection, "j1-retry", attempt=1, retry_of_job_id="j1")
    rejected("j1-dup", attempt=1)
    rejected("bad-attempt", attempt=-1, combo_index=5)
    rejected("bad-retry-of", attempt=2, retry_of_job_id="missing")
    # 0073's checks, FKs and the unique run link survive.
    rejected("bad-status", combo_index=6, status="DONE")
    rejected("bad-combo", combo_index=-1)
    rejected("bad-env", combo_index=7, environment_id="missing")
    rejected("bad-run", combo_index=8, run_id="r1")

    # Deleting the retried attempt keeps the retry, unlinked.
    connection.execute(sa.text("UPDATE runs SET experiment_job_id = NULL"))
    connection.execute(sa.text("DELETE FROM eval_experiment_jobs WHERE id = 'j1'"))
    assert (
        scalar("SELECT retry_of_job_id FROM eval_experiment_jobs WHERE id = 'j1-retry'")
        is None
    )
    # Restore the pre-test state for the downgrade.
    connection.execute(
        sa.text("DELETE FROM eval_experiment_jobs WHERE id = 'j1-retry'")
    )
    _insert_job(connection, "j1", run_id="r1")
    connection.execute(
        sa.text("UPDATE runs SET experiment_job_id = 'j1' WHERE id = 'r1'")
    )


def _assert_eval_job_attempts_downgraded(connection: sa.Connection) -> None:
    columns = {
        column["name"]
        for column in sa.inspect(connection).get_columns("eval_experiment_jobs")
    }
    assert not {"attempt", "retry_of_job_id"} & columns
    # Only the latest attempt of j2's combination is kept; run links survive.
    ids = connection.execute(
        sa.text("SELECT id FROM eval_experiment_jobs ORDER BY id")
    ).scalars()
    assert list(ids) == ["j1", "j2-retry"]
    assert (
        connection.execute(
            sa.text("SELECT experiment_job_id FROM runs WHERE id = 'r1'")
        ).scalar_one()
        == "j1"
    )
    assert JOB_INDEXES <= {
        index["name"]
        for index in sa.inspect(connection).get_indexes("eval_experiment_jobs")
    }
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            _insert_job(connection, "j1-dup")


def _run_eval_job_attempts_round_trip(
    connection: sa.Connection, migration: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        migration, "op", Operations(MigrationContext.configure(connection))
    )
    migration.upgrade()
    _assert_eval_job_attempt_constraints(connection)

    _insert_job(connection, "j2-retry", combo_index=1, attempt=1, retry_of_job_id="j2")
    migration.downgrade()
    _assert_eval_job_attempts_downgraded(connection)

    # Re-upgrading after a downgrade is clean.
    migration.upgrade()
    assert (
        connection.execute(
            sa.text("SELECT attempt FROM eval_experiment_jobs WHERE id = 'j2-retry'")
        ).scalar_one()
        == 0
    )


def test_eval_job_attempts_migration_sqlite_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    migration = _eval_job_attempt_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        _run_eval_job_attempts_round_trip(connection, migration, monkeypatch)
        fks = connection.exec_driver_sql(
            "PRAGMA foreign_key_list(eval_experiment_jobs)"
        ).all()
        retry_fk = [fk for fk in fks if fk[3] == "retry_of_job_id"]
        assert [(fk[2], fk[6]) for fk in retry_fk] == [
            ("eval_experiment_jobs", "SET NULL")
        ]
        run_fks = connection.exec_driver_sql("PRAGMA foreign_key_list(runs)").all()
        assert [(fk[2], fk[3]) for fk in run_fks] == [
            ("eval_experiment_jobs", "experiment_job_id")
        ]

    engine.dispose()


def test_eval_job_attempts_migration_matches_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ORM models and migrations 0072-0075 describe the same schema."""
    engine = sa.create_engine("sqlite://")
    migration = _eval_job_attempt_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        assert _eval_experiment_model_diffs(connection, PRESET_TABLES) == []
    engine.dispose()


def test_eval_job_attempts_migration_postgres_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    migration = _eval_job_attempt_prerequisites(postgres_engine, monkeypatch)

    with postgres_engine.begin() as connection:
        _run_eval_job_attempts_round_trip(connection, migration, monkeypatch)
        inspector = sa.inspect(connection)
        uniques = {
            u["name"]: u["column_names"]
            for u in inspector.get_unique_constraints("eval_experiment_jobs")
        }
        assert uniques["uq_eval_experiment_job_attempt"] == [
            "experiment_id",
            "environment_id",
            "combo_index",
            "attempt",
        ]
        assert "uq_eval_experiment_job_combo" not in uniques
        retry_fk = next(
            fk
            for fk in inspector.get_foreign_keys("eval_experiment_jobs")
            if fk["name"] == "fk_eval_experiment_jobs_retry_of_job_id"
        )
        assert retry_fk["options"].get("ondelete") == "SET NULL"
        assert "ck_eval_experiment_jobs_attempt" in {
            c["name"] for c in inspector.get_check_constraints("eval_experiment_jobs")
        }
        assert _eval_experiment_model_diffs(connection, PRESET_TABLES) == []


def _eval_run_scores_prerequisites(
    engine: sa.engine.Engine, monkeypatch: pytest.MonkeyPatch
) -> ModuleType:
    """Build the pre-0076 schema (0072-0075); job ``j1`` is linked to run ``r1``."""
    previous = _eval_job_attempt_prerequisites(engine, monkeypatch)
    with engine.begin() as connection:
        monkeypatch.setattr(
            previous, "op", Operations(MigrationContext.configure(connection))
        )
        previous.upgrade()
    return _load_migration("0076_eval_run_scores.py")


def _assert_eval_run_scores_upgraded(connection: sa.Connection) -> None:
    """Exercise the 0076 ``run_linked_at`` backfill and the empty score index."""
    rows = connection.execute(
        sa.text("SELECT id, run_linked_at FROM eval_experiment_jobs ORDER BY id")
    ).all()
    linked = {row[0]: row[1] for row in rows}
    # The linked job is closed at its last update time; the unlinked one is open.
    assert linked["j1"] is not None and str(linked["j1"]).startswith("2026-09-29")
    assert linked["j2"] is None
    # Data-free: existing runs are filled by the backfill command, not the migration.
    assert (
        connection.execute(sa.text("SELECT COUNT(*) FROM eval_run_scores")).scalar_one()
        == 0
    )
    indexes = {
        index["name"]: index["column_names"]
        for index in sa.inspect(connection).get_indexes("eval_run_scores")
    }
    assert indexes["ix_eval_run_scores_ranking"] == [
        "environment_id",
        "dataset_version_id",
        "metric_name",
        "mean_score",
    ]


def _insert_score(connection: sa.Connection, metric: str, **values: Any) -> None:
    _insert_row(
        connection,
        "eval_run_scores",
        **{
            "run_id": "r2",
            "metric_name": metric,
            "project_id": "p1",
            "environment_id": "e1",
            "mean_score": 0.5,
            "computed_at": TS,
            **values,
        },
    )


def _assert_eval_run_score_constraints(connection: sa.Connection) -> None:
    """Exercise 0076 defaults, key, checks and FK actions on ``eval_run_scores``."""

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    def rejected(metric: str, **values: Any) -> None:
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                _insert_score(connection, metric, **values)

    _insert_row(connection, "datasets", id="d1")
    _insert_row(connection, "dataset_versions", id="v1", dataset_id="d1")
    _insert_score(connection, "accuracy", dataset_id="d1", dataset_version_id="v1")
    row = (
        connection.execute(sa.text("SELECT * FROM eval_run_scores")).mappings().one()
    )
    assert row["direction"] == "maximize"
    assert (row["item_count"], row["error_item_count"]) == (0, 0)
    assert row["pass_at_k"] is None and row["completed_at"] is None

    rejected("accuracy")  # (run_id, metric_name) is the key
    rejected("bad-direction", direction="higher")
    rejected("bad-errors", item_count=1, error_item_count=2)
    rejected("bad-count", item_count=-1)
    rejected("bad-mean", mean_score=None)
    rejected("bad-env", environment_id="missing")
    rejected("bad-run", run_id="missing")

    # A deleted dataset (version) only clears the pointer.
    connection.execute(sa.text("DELETE FROM dataset_versions WHERE id = 'v1'"))
    connection.execute(sa.text("DELETE FROM datasets WHERE id = 'd1'"))
    assert scalar("SELECT dataset_version_id FROM eval_run_scores") is None
    assert scalar("SELECT dataset_id FROM eval_run_scores") is None

    # Rows go with their environment and with their run.
    _insert_environment(connection, "e9", base_url="https://e9.test")
    _insert_score(connection, "latency", environment_id="e9")
    connection.execute(sa.text("DELETE FROM eval_environments WHERE id = 'e9'"))
    assert scalar("SELECT COUNT(*) FROM eval_run_scores") == 1
    connection.execute(sa.text("DELETE FROM runs WHERE id = 'r2'"))
    assert scalar("SELECT COUNT(*) FROM eval_run_scores") == 0


def _assert_eval_run_scores_downgraded(connection: sa.Connection) -> None:
    columns = {
        column["name"]
        for column in sa.inspect(connection).get_columns("eval_experiment_jobs")
    }
    assert "run_linked_at" not in columns
    assert "attempt" in columns  # 0075 is untouched
    assert "eval_run_scores" not in sa.inspect(connection).get_table_names()
    assert (
        connection.execute(
            sa.text("SELECT run_id FROM eval_experiment_jobs WHERE id = 'j1'")
        ).scalar_one()
        == "r1"
    )


def _run_eval_run_scores_round_trip(
    connection: sa.Connection, migration: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        migration, "op", Operations(MigrationContext.configure(connection))
    )
    migration.upgrade()
    _assert_eval_run_scores_upgraded(connection)
    assert _eval_experiment_model_diffs(connection, PRESET_TABLES) == []
    _assert_eval_run_score_constraints(connection)

    migration.downgrade()
    _assert_eval_run_scores_downgraded(connection)

    # Re-upgrading after a downgrade is clean and backfills again.
    migration.upgrade()
    _assert_eval_run_scores_upgraded(connection)


def test_eval_run_scores_migration_sqlite_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    migration = _eval_run_scores_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        _run_eval_run_scores_round_trip(connection, migration, monkeypatch)
    engine.dispose()


def test_eval_run_scores_migration_postgres_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    migration = _eval_run_scores_prerequisites(postgres_engine, monkeypatch)

    with postgres_engine.begin() as connection:
        _run_eval_run_scores_round_trip(connection, migration, monkeypatch)
        inspector = sa.inspect(connection)
        pass_at_k = next(
            column
            for column in inspector.get_columns("eval_run_scores")
            if column["name"] == "pass_at_k"
        )
        assert pass_at_k["type"].__class__.__name__ == "JSONB"
        fks = {
            fk["name"]: fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("eval_run_scores")
        }
        assert fks == {
            "fk_eval_run_scores_run_id": "CASCADE",
            "fk_eval_run_scores_project_id": "CASCADE",
            "fk_eval_run_scores_environment_id": "CASCADE",
            "fk_eval_run_scores_dataset_id": "SET NULL",
            "fk_eval_run_scores_dataset_version_id": "SET NULL",
        }
        assert {
            "ck_eval_run_scores_direction",
            "ck_eval_run_scores_counts",
        } <= {c["name"] for c in inspector.get_check_constraints("eval_run_scores")}


def _eval_qym_api_key_prerequisites(
    engine: sa.engine.Engine, monkeypatch: pytest.MonkeyPatch
) -> ModuleType:
    """Build the pre-0077 schema (0072-0076) with experiment ``x1`` and key ``k1``."""
    previous = _eval_run_scores_prerequisites(engine, monkeypatch)
    with engine.begin() as connection:
        monkeypatch.setattr(
            previous, "op", Operations(MigrationContext.configure(connection))
        )
        previous.upgrade()
        _insert_row(connection, "api_keys", id="k1")
    return _load_migration("0077_eval_experiment_qym_api_key.py")


def _run_eval_qym_api_key_round_trip(
    connection: sa.Connection, migration: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    def columns() -> set[str]:
        return {
            column["name"]
            for column in sa.inspect(connection).get_columns("eval_experiments")
        }

    def scalar(sql: str) -> Any:
        return connection.execute(sa.text(sql)).scalar_one()

    monkeypatch.setattr(
        migration, "op", Operations(MigrationContext.configure(connection))
    )
    migration.upgrade()
    assert {"qym_api_key_id", "qym_api_key_encrypted"} <= columns()
    # Existing experiments have no key: their jobs block until retried.
    assert scalar("SELECT qym_api_key_id FROM eval_experiments WHERE id = 'x1'") is None
    assert "ix_eval_experiments_qym_api_key_id" in {
        index["name"] for index in sa.inspect(connection).get_indexes("eval_experiments")
    }
    assert _eval_experiment_model_diffs(connection, PRESET_TABLES) == []

    # Deleting the key only clears the pointer.
    connection.execute(
        sa.text(
            "UPDATE eval_experiments SET qym_api_key_id = 'k1', "
            "qym_api_key_encrypted = 'blob' WHERE id = 'x1'"
        )
    )
    connection.execute(sa.text("DELETE FROM api_keys WHERE id = 'k1'"))
    assert scalar("SELECT qym_api_key_id FROM eval_experiments WHERE id = 'x1'") is None
    assert scalar("SELECT COUNT(*) FROM eval_experiments") == 1

    migration.downgrade()
    assert not {"qym_api_key_id", "qym_api_key_encrypted"} & columns()
    assert scalar("SELECT COUNT(*) FROM eval_experiments") == 1

    migration.upgrade()
    assert {"qym_api_key_id", "qym_api_key_encrypted"} <= columns()


def test_eval_qym_api_key_migration_sqlite_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = sa.create_engine("sqlite://")
    migration = _eval_qym_api_key_prerequisites(engine, monkeypatch)

    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        _run_eval_qym_api_key_round_trip(connection, migration, monkeypatch)
        # SQLAlchemy doesn't reflect options of an inline (ADD COLUMN) FK.
        fks = connection.exec_driver_sql(
            "PRAGMA foreign_key_list(eval_experiments)"
        ).all()
        assert ("api_keys", "qym_api_key_id", "SET NULL") in {
            (fk[2], fk[3], fk[6]) for fk in fks
        }
    engine.dispose()


def test_eval_qym_api_key_migration_postgres_upgrade_and_downgrade(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    migration = _eval_qym_api_key_prerequisites(postgres_engine, monkeypatch)

    with postgres_engine.begin() as connection:
        _run_eval_qym_api_key_round_trip(connection, migration, monkeypatch)
        fk = next(
            fk
            for fk in sa.inspect(connection).get_foreign_keys("eval_experiments")
            if fk["name"] == "fk_eval_experiments_qym_api_key_id"
        )
        assert fk["referred_table"] == "api_keys"
        assert fk["options"].get("ondelete") == "SET NULL"


def test_drop_eval_inflight_cap_round_trips(monkeypatch: pytest.MonkeyPatch) -> None:
    """0080 drops max_inflight_jobs (keeping rows); downgrade restores it at 5."""
    migration = _load_migration("0072_eval_environments.py")
    drop_cap = _load_migration("0080_drop_eval_inflight_cap.py")
    engine = sa.create_engine("sqlite://")
    _eval_environment_prerequisites(engine)
    with engine.begin() as connection:
        ops = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", ops)
        monkeypatch.setattr(drop_cap, "op", ops)
        migration.upgrade()
        _insert_environment(connection, "e1", max_inflight_jobs=2)
        drop_cap.upgrade()
        columns = {
            c["name"] for c in sa.inspect(connection).get_columns("eval_environments")
        }
        assert "max_inflight_jobs" not in columns
        assert (
            connection.execute(sa.text("SELECT id FROM eval_environments")).scalar_one()
            == "e1"
        )
        drop_cap.downgrade()
        cap = connection.execute(
            sa.text("SELECT max_inflight_jobs FROM eval_environments")
        )
        assert cap.scalar_one() == 5
    engine.dispose()


def test_slot_extra_field_maps_round_trips(monkeypatch: pytest.MonkeyPatch) -> None:
    """0081 adds extra_field_maps (existing slots get []); downgrade drops it."""
    migration = _load_migration("0072_eval_environments.py")
    extra_maps = _load_migration("0081_eval_slot_extra_field_maps.py")
    engine = sa.create_engine("sqlite://")
    _eval_environment_prerequisites(engine)
    with engine.begin() as connection:
        ops = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", ops)
        monkeypatch.setattr(extra_maps, "op", ops)
        migration.upgrade()
        extra_maps.upgrade()
        columns = {
            c["name"] for c in sa.inspect(connection).get_columns("eval_model_slots")
        }
        assert "extra_field_maps" in columns
        extra_maps.downgrade()
        columns = {
            c["name"] for c in sa.inspect(connection).get_columns("eval_model_slots")
        }
        assert "extra_field_maps" not in columns
    engine.dispose()


def _versioning_details_prerequisites(engine: sa.engine.Engine) -> None:
    metadata = sa.MetaData()
    for table in ("runs", "eval_experiments"):
        sa.Table(table, metadata, sa.Column("id", sa.String(36), primary_key=True))
    metadata.create_all(engine)


def _run_versioning_details_round_trip(connection, monkeypatch) -> None:
    migration = _load_migration("0084_run_versioning_details.py")
    assert (migration.revision, migration.down_revision) == ("0084", "0083")

    def columns(table):
        return {c["name"]: c for c in sa.inspect(connection).get_columns(table)}

    connection.execute(sa.text("INSERT INTO runs (id) VALUES ('r1')"))
    monkeypatch.setattr(
        migration, "op", Operations(MigrationContext.configure(connection))
    )
    migration.upgrade()
    for table in ("runs", "eval_experiments"):
        assert columns(table)["versioning_details"]["nullable"]
    connection.execute(
        sa.text("UPDATE runs SET versioning_details = :v"), {"v": '{"agent": "v2"}'}
    )
    migration.downgrade()
    for table in ("runs", "eval_experiments"):
        assert "versioning_details" not in columns(table)
    assert connection.execute(sa.text("SELECT id FROM runs")).scalar_one() == "r1"


def test_run_versioning_details_migration_round_trips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """0084 adds nullable ``versioning_details`` to runs and experiments."""
    engine = sa.create_engine("sqlite://")
    _versioning_details_prerequisites(engine)
    with engine.begin() as connection:
        _run_versioning_details_round_trip(connection, monkeypatch)
    engine.dispose()


def test_run_versioning_details_migration_postgres_round_trips(
    monkeypatch: pytest.MonkeyPatch, postgres_engine: sa.engine.Engine
) -> None:
    _versioning_details_prerequisites(postgres_engine)
    with postgres_engine.begin() as connection:
        _run_versioning_details_round_trip(connection, monkeypatch)
