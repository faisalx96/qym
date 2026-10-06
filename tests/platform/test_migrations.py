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

    assert heads == ["0071"]


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
