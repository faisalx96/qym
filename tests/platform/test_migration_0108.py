"""Migration 0108 (Performance): matches the models, round-trips on SQLite and PostgreSQL, and its partial unique indexes hold."""

from __future__ import annotations

import importlib.util
import os
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from _performance_support import (
    NOW,
    TOKENS,
    run_config,
    seed_dataset,
    seed_performance,
    seed_project,
    seed_run,
    seed_runner,
    seed_target,
    seed_token,
    target_tokens,
    token_value,
    use_encryption_key,
)
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "packages/platform/qym_platform/migrations"
FILE = MIGRATIONS / "versions/0108_performance.py"
TABLES = {
    "performance_runners",
    "performance_targets",
    "performance_target_tokens",
    "performance_runs",
    "performance_questions",
    "performance_dashboard_steps",
    "performance_log_lines",
    "performance_reports",
    "performance_events",
}
ACTIVE = ("queued", "starting", "running", "stopping")
FINAL = ("finished", "stopped", "failed", "interrupted", "expired")


@pytest.fixture(params=["sqlite", "postgres"])
def engine(request, tmp_path, monkeypatch):
    """A database at revision 0107: every table of the models but the performance ones."""
    from qym_platform.db import models  # noqa: F401
    from qym_platform.db.base import Base

    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_performance_" + uuid4().hex
        admin = sa.create_engine(url)
        with admin.begin() as conn:
            conn.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
        url = sa.engine.make_url(url).update_query_dict(
            {"options": f"-csearch_path={schema}"}
        )
    else:
        url = sa.engine.URL.create("sqlite", database=str(tmp_path / "migration.db"))
    eng = sa.create_engine(url)
    monkeypatch.setenv("QYM_DATABASE_URL", url.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    try:
        # Older migrations contain PostgreSQL-only DDL, so the schema before 0108
        # is built from the models.
        Base.metadata.create_all(
            eng,
            tables=[
                table
                for table in Base.metadata.sorted_tables
                if table.name not in TABLES
            ],
        )
        yield eng
    finally:
        eng.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


@pytest.fixture()
def migrated(engine, monkeypatch):
    """The same database upgraded to 0108, with an encryption key for the tokens."""
    use_encryption_key(monkeypatch)
    command.stamp(_config(), "0107")
    command.upgrade(_config(), "0108")
    return engine


def _config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    return config


def test_revision_chain_names_0107() -> None:
    spec = importlib.util.spec_from_file_location("migration_0108", FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (module.revision, module.down_revision) == ("0108", "0107")


def test_models_name_exactly_the_eight_tables() -> None:
    from qym_platform.db.base import Base

    assert {
        name for name in Base.metadata.tables if name.startswith("performance_")
    } == TABLES


def test_matches_models_and_round_trips(engine) -> None:
    from qym_platform.db.base import Base

    config = _config()
    dialect = engine.dialect.name

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
            index["name"]: (
                index["column_names"],
                bool(index["unique"]),
                str(index["dialect_options"].get(dialect + "_where", "")),
            )
            for index in inspector.get_indexes(table)
            if not index.get("duplicates_constraint")
            and not index["name"].startswith("sqlite_autoindex")
        }

    def foreign_keys(inspector, table):
        return {
            (key["constrained_columns"][0], key["referred_table"]): key["options"].get(
                "ondelete"
            )
            for key in inspector.get_foreign_keys(table)
        }

    command.stamp(config, "0107")
    command.upgrade(config, "0108")
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert TABLES <= set(inspector.get_table_names())

        assert constraints(inspector, "performance_runners") == {
            "uq_performance_runner_key": ["project_id", "key"]
        }
        assert indexes(inspector, "performance_runners") == {}
        assert foreign_keys(inspector, "performance_runners") == {
            ("project_id", "projects"): None,
            ("registered_key_id", "api_keys"): "SET NULL",
            ("runner_key_id", "api_keys"): "SET NULL",
            ("runner_key_changed_by_user_id", "users"): None,
        }

        assert constraints(inspector, "performance_targets") == {}
        target_indexes = indexes(inspector, "performance_targets")
        assert set(target_indexes) == {
            "uq_performance_target_name",
            "uq_performance_target_base_url",
        }
        for name, columns in (
            ("uq_performance_target_name", ["project_id", "name"]),
            ("uq_performance_target_base_url", ["project_id", "kind", "base_url"]),
        ):
            found, unique, predicate = target_indexes[name]
            assert (found, unique) == (columns, True)
            assert "archived_at IS NULL" in predicate
        assert foreign_keys(inspector, "performance_targets") == {
            ("project_id", "projects"): None,
            ("created_by_user_id", "users"): None,
        }
        columns = {
            column["name"]: column
            for column in inspector.get_columns("performance_targets")
        }
        assert "environment" not in columns
        assert columns["is_production"]["default"] is not None
        assert columns["max_users"]["nullable"]
        assert columns["max_duration_s"]["nullable"]

        assert constraints(inspector, "performance_target_tokens") == {
            "uq_performance_target_token": ["target_id", "name"]
        }
        assert foreign_keys(inspector, "performance_target_tokens") == {
            ("target_id", "performance_targets"): "CASCADE",
            ("updated_by_user_id", "users"): None,
        }

        assert constraints(inspector, "performance_runs") == {
            "uq_performance_run_number": ["project_id", "number"]
        }
        run_indexes = indexes(inspector, "performance_runs")
        assert set(run_indexes) == {
            "ix_performance_runs_project_requested",
            "ix_performance_runs_target",
            "uq_performance_runs_active_runner",
            "uq_performance_runs_active_target",
        }
        assert run_indexes["ix_performance_runs_project_requested"] == (
            ["project_id", "requested_at"],
            False,
            "",
        )
        assert run_indexes["ix_performance_runs_target"] == (
            ["target_id", "requested_at"],
            False,
            "",
        )
        for name, column in (
            ("uq_performance_runs_active_runner", "runner_id"),
            ("uq_performance_runs_active_target", "target_id"),
        ):
            found, unique, predicate = run_indexes[name]
            assert (found, unique) == ([column], True)
            assert all(status in predicate for status in ACTIVE)
            assert not any(status in predicate for status in FINAL)
        assert foreign_keys(inspector, "performance_runs") == {
            ("project_id", "projects"): None,
            ("runner_id", "performance_runners"): None,
            ("target_id", "performance_targets"): "SET NULL",
            ("dataset_version_id", "dataset_versions"): "SET NULL",
            ("requested_by_user_id", "users"): None,
            ("stop_requested_by_user_id", "users"): None,
        }

        assert constraints(inspector, "performance_questions") == {
            "uq_performance_question": ["run_id", "seq"]
        }
        assert indexes(inspector, "performance_questions") == {
            "ix_performance_questions_run_status": (["run_id", "status"], False, ""),
            "ix_performance_questions_run_level": (["run_id", "level"], False, ""),
            "ix_performance_questions_run_tier": (["run_id", "tier"], False, ""),
        }
        assert constraints(inspector, "performance_log_lines") == {
            "uq_performance_log_line": ["run_id", "seq"]
        }
        assert inspector.get_pk_constraint("performance_reports")[
            "constrained_columns"
        ] == ["run_id"]
        for table in (
            "performance_questions",
            "performance_dashboard_steps",
            "performance_log_lines",
            "performance_reports",
        ):
            assert foreign_keys(inspector, table) == {
                ("run_id", "performance_runs"): "CASCADE"
            }

        assert indexes(inspector, "performance_events") == {
            "ix_performance_events_runner_at": (["runner_id", "at"], False, ""),
            "ix_performance_events_run": (["run_id", "id"], False, ""),
        }
        assert foreign_keys(inspector, "performance_events") == {
            ("runner_id", "performance_runners"): "CASCADE"
        }

        context = MigrationContext.configure(
            connection,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": include,
            },
        )
        assert compare_metadata(context, Base.metadata) == []

    command.downgrade(config, "0107")
    assert not TABLES & set(sa.inspect(engine).get_table_names())
    command.upgrade(config, "0108")
    assert TABLES <= set(sa.inspect(engine).get_table_names())


@pytest.mark.parametrize("status", ACTIVE)
def test_one_active_run_per_runner_and_per_target(migrated, status) -> None:
    """A second queued or active run on a busy runner or a busy target is refused by
    the database itself; a finished run frees both."""
    with Session(migrated) as db:
        owner, project = seed_project(db)
        runner = seed_runner(db, project)
        other_runner = seed_runner(
            db, project, key="runner-2", instance_id="instance-2"
        )
        target = seed_target(db, project, user=owner)
        other_target = seed_target(
            db,
            project,
            user=owner,
            name="QA - Second target",
            base_url="https://second.example.test",
            tokens={},
        )
        first = seed_run(db, project, runner, target, user=owner, status=status)
        db.commit()
        first_id = first.id

        # Same runner, another target.
        with pytest.raises(IntegrityError):
            seed_run(db, project, runner, other_target, user=owner)
        db.rollback()
        # Same target, another runner.
        with pytest.raises(IntegrityError):
            seed_run(db, project, other_runner, target, user=owner)
        db.rollback()

        # Neither shared: allowed.
        second = seed_run(db, project, other_runner, other_target, user=owner)
        db.commit()
        second.status = "interrupted"
        db.commit()

        # A run that ended no longer blocks its runner or its target.
        for final in FINAL:
            db.get(type(first), first_id).status = final
            db.commit()
            again = seed_run(db, project, runner, target, user=owner, status="queued")
            db.commit()
            db.delete(again)
            db.commit()

        # Changing a finished run back into an active one is refused the same way.
        busy = seed_run(db, project, runner, target, user=owner, status="running")
        db.commit()
        db.get(type(first), first_id).status = status
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        assert busy.number == 3


def test_target_name_and_address_are_unique_until_archived(migrated) -> None:
    with Session(migrated) as db:
        owner, project = seed_project(db)
        _, other_project = seed_project(db, "2")
        first = seed_target(db, project, user=owner)
        db.commit()

        with pytest.raises(IntegrityError):
            seed_target(db, project, base_url="https://other.example.test", tokens={})
        db.rollback()
        with pytest.raises(IntegrityError):
            seed_target(db, project, name="QA - Other name", tokens={})
        db.rollback()

        # Another project may use both.
        seed_target(db, other_project, tokens={})
        db.commit()

        # An archived target frees its name and its address, and stays stored.
        first.archived_at = NOW
        db.commit()
        replacement = seed_target(db, project, user=owner)
        db.commit()
        assert replacement.id != first.id
        again = seed_target(db, project, tokens={}, archived_at=NOW + timedelta(days=1))
        db.commit()
        assert again.archived_at is not None

        # Bringing the archived one back while its name is taken is refused.
        first.archived_at = None
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_identities_of_tokens_runs_questions_and_log_lines(migrated) -> None:
    from qym_platform.db.models import PerformanceLogLine, PerformanceQuestion

    def question(run_id, seq):
        return PerformanceQuestion(
            run_id=run_id,
            seq=seq,
            asked_at=NOW,
            elapsed_s=1.5,
            stage="hold",
            level=10,
            user_number=1,
            tier="simple",
            question_id="simple-1",
            question="Question simple-1?",
            status="ok",
            http_status=200,
            duration_ms=1200.0,
        )

    with Session(migrated) as db:
        owner, project = seed_project(db)
        runner = seed_runner(db, project)
        target = seed_target(db, project, user=owner)
        run = seed_run(db, project, runner, target, user=owner, status="finished")
        db.commit()

        with pytest.raises(IntegrityError):
            seed_token(db, target, "refresh_token", "another-value-9f3a")
        db.rollback()
        with pytest.raises(IntegrityError):
            seed_run(db, project, runner, target, status="finished", number=run.number)
        db.rollback()

        db.add_all([question(run.id, 1), question(run.id, 2)])
        db.add(
            PerformanceLogLine(run_id=run.id, seq=1, at=NOW, level="info", message="a")
        )
        db.commit()
        db.add(question(run.id, 2))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.add(
            PerformanceLogLine(run_id=run.id, seq=1, at=NOW, level="info", message="b")
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        stored = db.scalars(
            sa.select(PerformanceQuestion).order_by(PerformanceQuestion.seq)
        ).all()
        assert [
            (row.seq, row.is_followup, row.no_data, row.warmup, row.attempts)
            for row in stored
        ] == [
            (1, False, False, False, 1),
            (2, False, False, False, 1),
        ]
        assert stored[0].answer is None and stored[0].answer_truncated is False


def test_status_reason_holds_every_code(migrated) -> None:
    """Why a run ended is stored with it: NULL while all is normal, else one code."""
    from qym_platform.db.models import PERFORMANCE_STATUS_REASONS, PerformanceRun

    assert PERFORMANCE_STATUS_REASONS == (
        "stopped_before_claim",
        "stopped_by_person",
        "preflight_failed",
        "k6_failed",
        "runner_restarted",
        "runner_silent",
        "runner_shutdown",
        "stopped_while_runner_silent",
        "not_claimed",
    )
    column = PerformanceRun.__table__.c.status_reason
    assert column.nullable
    assert max(map(len, PERFORMANCE_STATUS_REASONS)) <= column.type.length
    with Session(migrated) as db:
        owner, project = seed_project(db)
        runner = seed_runner(db, project)
        target = seed_target(db, project, user=owner)
        normal = seed_run(db, project, runner, target, user=owner, status="finished")
        assert normal.status_reason is None
        ids = {}
        for code in PERFORMANCE_STATUS_REASONS:
            run = seed_run(
                db, project, runner, target, status="interrupted", status_reason=code
            )
            ids[run.id] = code
        db.commit()
        db.expire_all()
        stored = {
            run.id: run.status_reason
            for run in db.scalars(
                sa.select(PerformanceRun).where(PerformanceRun.id.in_(ids))
            )
        }
        assert stored == ids


def test_support_rows_fit_the_migrated_tables(migrated) -> None:
    """The shared helpers build a project that is ready to start a run, with the
    tokens encrypted and only their last 4 characters readable."""
    from qym_platform.db.models import (
        PERFORMANCE_DEFAULT_AUTH_PATH,
        PERFORMANCE_DEFAULT_CHAT_PATH,
        PerformanceRun,
    )

    with Session(migrated) as db:
        seeded = seed_performance(db)
        run = seed_run(
            db,
            seeded.project,
            seeded.runner,
            seeded.target,
            version=seeded.version,
            user=seeded.member,
            status="running",
        )
        db.commit()
        run_id = run.id
        db.expire_all()

        run = db.get(PerformanceRun, run_id)
        assert (run.number, run.status, run.test_type) == (1, "running", "breakpoint")
        assert run.claim_instance_id == "instance-1"
        assert run.claimed_at == run.started_at == run.last_seen_at == NOW
        assert (run.progress, run.progress_seq, run.summary) == ({}, 1, None)
        assert (run.questions_received, run.questions_dropped) == (0, 0)
        assert (run.log_lines_received, run.log_lines_dropped) == (0, 0)
        assert run.dataset_version_id == seeded.version.id
        config = run.config
        assert config["dataset"]["tier_counts"] == {
            "simple": 2,
            "medium": 2,
            "complex": 2,
        }
        assert config["dataset"]["single_kind"] is False
        assert config["tokens"] == [
            {"name": "access_token", "hint": "0c2e", "version": 1},
            {"name": "refresh_token", "hint": "41bd", "version": 1},
        ]
        assert config["target"]["chat_path"] == PERFORMANCE_DEFAULT_CHAT_PATH
        assert config["target"]["token_refresh_path"] == PERFORMANCE_DEFAULT_AUTH_PATH
        assert config["target"]["refresh_cookie_name"] == "estishraf_rt"
        assert config["target"]["auth_server"] is None

        target = seeded.target
        tokens = target_tokens(db, target)
        assert set(tokens) == set(TOKENS)
        for name, value in TOKENS.items():
            row = tokens[name]
            assert row.token_hint == value[-4:] and len(row.token_hint) == 4
            assert value not in row.token_encrypted
            assert token_value(row) == value

        # A dataset without any kind counts as one kind.
        plain = seed_dataset(
            db,
            seeded.project,
            seeded.owner,
            name="QA - Plain questions",
            tiers=(None,),
            per_tier=3,
        )
        plain_config = run_config(db, target, plain, test_type="smoke")
        assert plain_config["dataset"]["single_kind"] is True
        assert plain_config["dataset"]["tier_counts"] == {
            "simple": 0,
            "medium": 3,
            "complex": 0,
        }
        assert plain_config["mix"] == {"simple": 0, "medium": 100, "complex": 0}


def test_settings_defaults_are_the_planned_limits(monkeypatch) -> None:
    from qym_platform.settings import PlatformSettings

    for name in list(os.environ):
        if name.startswith("QYM_PERFORMANCE_"):
            monkeypatch.delenv(name)
    settings = PlatformSettings(_env_file=None)
    assert settings.performance_enabled is True
    assert settings.performance_starts_per_hour == 20
    assert settings.performance_max_users == 200
    assert settings.performance_max_duration_seconds == 28800
    assert settings.performance_runner_fresh_seconds == 30
    # Below two heartbeats (10 s each) the runner would count as away at random.
    monkeypatch.setenv("QYM_PERFORMANCE_RUNNER_FRESH_SECONDS", "19")
    with pytest.raises(ValueError):
        PlatformSettings(_env_file=None)
    monkeypatch.setenv("QYM_PERFORMANCE_RUNNER_FRESH_SECONDS", "20")
    assert PlatformSettings(_env_file=None).performance_runner_fresh_seconds == 20
    monkeypatch.delenv("QYM_PERFORMANCE_RUNNER_FRESH_SECONDS")
    assert settings.performance_stale_after_seconds == 120
    assert settings.performance_queue_timeout_seconds == 600
    assert settings.performance_late_window_seconds == 600
    assert (
        settings.performance_detail_retention_days,
        settings.performance_report_retention_days,
        settings.performance_retention_days,
        settings.performance_events_retention_days,
    ) == (90, 180, 730, 30)
    assert {
        "info_max_bytes": settings.performance_info_max_bytes,
        "progress_max_bytes": settings.performance_progress_max_bytes,
        "questions_batch_max": settings.performance_questions_batch_max,
        "questions_max_bytes": settings.performance_questions_max_bytes,
        "questions_per_run_max": settings.performance_questions_per_run_max,
        "log_batch_max": settings.performance_log_batch_max,
        "log_max_bytes": settings.performance_log_max_bytes,
        "log_lines_per_run_max": settings.performance_log_lines_per_run_max,
        "events_batch_max": settings.performance_events_batch_max,
        "events_max_bytes": settings.performance_events_max_bytes,
        "summary_max_bytes": settings.performance_summary_max_bytes,
        "report_max_bytes": settings.performance_report_max_bytes,
        "question_chars_max": settings.performance_question_chars_max,
        "answer_chars_max": settings.performance_answer_chars_max,
        "log_message_chars_max": settings.performance_log_message_chars_max,
    } == {
        "info_max_bytes": 8192,
        "progress_max_bytes": 65536,
        "questions_batch_max": 200,
        "questions_max_bytes": 1048576,
        "questions_per_run_max": 50000,
        "log_batch_max": 500,
        "log_max_bytes": 262144,
        "log_lines_per_run_max": 50000,
        "events_batch_max": 100,
        "events_max_bytes": 262144,
        "summary_max_bytes": 262144,
        "report_max_bytes": 5242880,
        "question_chars_max": 2000,
        "answer_chars_max": 1000,
        "log_message_chars_max": 2000,
    }
    monkeypatch.setenv("QYM_PERFORMANCE_STARTS_PER_HOUR", "0")
    monkeypatch.setenv("QYM_PERFORMANCE_MAX_DURATION_SECONDS", "7200")
    changed = PlatformSettings(_env_file=None)
    assert (
        changed.performance_starts_per_hour,
        changed.performance_max_duration_seconds,
    ) == (0, 7200)


def test_performance_error_carries_code_status_and_message() -> None:
    from qym_platform.services.performance_runs import PerformanceError

    error = PerformanceError(
        "target_busy", 409, "A run is active on this target.", {"run_id": "r1"}
    )
    assert (error.code, error.status, error.message) == (
        "target_busy",
        409,
        "A run is active on this target.",
    )
    assert error.details == {"run_id": "r1"}
    assert str(error) == "A run is active on this target."
    assert PerformanceError("forbidden", 403, "Not allowed.").details == {}
