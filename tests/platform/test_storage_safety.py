"""Storage migration safeguards exercised against the real PostgreSQL schema."""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from threading import Event
from uuid import uuid4

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from qym_platform.db.maintenance_models import MaintenanceJob
from qym_platform.services import maintenance, retention


@pytest.fixture
def legacy_postgres(monkeypatch):
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_storage_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("QYM_DATABASE_URL", scoped.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "true")
    config = Config()
    config.set_main_option(
        "script_location",
        str(
            Path(__file__).resolve().parents[2]
            / "packages/platform/qym_platform/migrations"
        ),
    )
    engine = create_engine(scoped)
    now = datetime.utcnow()
    try:
        command.upgrade(config, "0052")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, email, display_name, title, role, is_active, created_at, updated_at) VALUES ('u', 'u@example.test', 'U', '', 'ADMIN', true, now(), now())"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO projects (id, name, slug, is_active, created_by_user_id, created_at, updated_at) VALUES ('p', 'P', 'p', true, 'u', now(), now())"
                )
            )
            for run_id, age, deleted in (
                ("live", 10, None),
                ("deleted", 45, now - timedelta(days=40)),
                ("old", 120, None),
            ):
                conn.execute(
                    text("""
                    INSERT INTO runs (id, project_id, created_by_user_id, owner_user_id, task, dataset,
                                      metrics, run_metadata, run_config, samples, status, created_at, updated_at, deleted_at)
                    VALUES (:id, 'p', 'u', 'u', 't', 'd', '[]', '{}', '{}', 1, 'COMPLETED', :c, :c, :d)
                """),
                    {"id": run_id, "c": now - timedelta(days=age), "d": deleted},
                )
                conn.execute(
                    text("""
                    INSERT INTO spans (run_id, trace_id, span_id, name, kind, status, attributes, events, links)
                    VALUES (:r, 't', :s, 'original span', 'INTERNAL', 'UNSET', '{}', '[]', '[]')
                """),
                    {"r": run_id, "s": run_id + "-span"},
                )
        command.upgrade(config, "head")
        # Tests explicitly schedule their own jobs after exercising real DDL.
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM maintenance_jobs"))
        yield engine, now
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _job(engine, kind, params=None):
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        job = maintenance.enqueue(db, kind, params)
        db.commit()
        job_id = job.id
    worker = maintenance.MaintenanceWorker(factory, engine, retention_interval=0)
    status = worker.tick()
    with factory() as db:
        job = db.get(MaintenanceJob, job_id)
        return status, dict(job.progress), job.error


def _legacy_exists(engine):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT to_regclass('spans_legacy') IS NOT NULL")
        ).scalar()


@pytest.mark.parametrize("force", [False, True])
def test_drop_rejects_unrelated_spans_and_wrong_partition_key(legacy_postgres, force):
    engine, now = legacy_postgres
    with engine.begin() as conn:
        # Exceed the legacy row count, including the right run/span identifiers
        # under the wrong run_created_at. Neither proves the copy is complete.
        conn.execute(text("""
            INSERT INTO spans (run_created_at, run_id, trace_id, span_id, name)
            SELECT created_at + interval '1 day', id, 't', id || '-span', 'wrong partition'
            FROM runs WHERE id IN ('live', 'deleted')
        """))
        conn.execute(text("""
            INSERT INTO spans (run_created_at, run_id, trace_id, span_id, name)
            SELECT created_at, id, 'new', 'unrelated-' || n, 'new span'
            FROM runs CROSS JOIN generate_series(1, 4) AS n WHERE id = 'live'
        """))
    status, progress, error = _job(engine, "drop_legacy_spans", {"force": force})
    assert status == "failed"
    assert "uncopied span" in error
    assert progress["missing_span"]["run_id"] in {"live", "deleted"}
    assert _legacy_exists(engine)


def test_copy_preserves_restorable_runs_then_drop_and_purge_resume(legacy_postgres):
    engine, now = legacy_postgres
    # The old FK still points at runs, so purge waits for completion of the copy.
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == []
    status, progress, error = _job(engine, "migrate_spans", {"batch_runs": 1})
    assert status == "succeeded", error
    assert progress["rows_copied"] == 2
    with engine.connect() as conn:
        copied = set(conn.execute(text("SELECT run_id FROM spans")).scalars())
    assert copied == {"live", "deleted"}
    status, _, error = _job(engine, "drop_legacy_spans")
    assert status == "succeeded", error
    assert not _legacy_exists(engine)
    assert retention.purge_soft_deleted_runs(engine, grace_days=30, now=now) == [
        "deleted"
    ]
    assert _job(engine, "drop_legacy_spans")[0] == "succeeded"


def test_retention_disabled_copies_all_history(legacy_postgres):
    engine, _ = legacy_postgres
    status, progress, error = _job(engine, "migrate_spans", {"retention_days": 0})
    assert status == "succeeded", error
    assert progress["rows_copied"] == 3
    assert _job(engine, "drop_legacy_spans", {"retention_days": 0})[0] == "succeeded"


def test_copy_restart_keeps_original_cutoff(legacy_postgres):
    engine, now = legacy_postgres
    factory = sessionmaker(bind=engine)
    original_cutoff = now - timedelta(days=180)
    with factory() as db:
        job = maintenance.enqueue(
            db, "migrate_spans", {"retention_days": 1, "batch_runs": 1}
        )
        job.progress = {"cutoff": original_cutoff.isoformat()}
        db.commit()
        job_id = job.id
    assert maintenance.MaintenanceWorker(factory, engine).tick() == "succeeded"
    with factory() as db:
        progress = db.get(MaintenanceJob, job_id).progress
        assert progress["cutoff"] == original_cutoff.isoformat()
        assert progress["rows_copied"] == 3


def test_drop_requires_maintenance_mode(legacy_postgres, monkeypatch):
    engine, _ = legacy_postgres
    assert _job(engine, "migrate_spans")[0] == "succeeded"
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    status, _, error = _job(engine, "drop_legacy_spans")
    assert status == "failed"
    assert "QYM_MAINTENANCE_MODE" in error
    assert _legacy_exists(engine)


def test_drop_rolls_back_if_ddl_fails(legacy_postgres):
    engine, _ = legacy_postgres
    assert _job(engine, "migrate_spans")[0] == "succeeded"
    with engine.begin() as conn:
        conn.execute(
            text("CREATE VIEW retain_legacy AS SELECT span_id FROM spans_legacy")
        )
    status, _, error = _job(engine, "drop_legacy_spans")
    assert status == "failed"
    assert "depend" in error
    assert _legacy_exists(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP VIEW retain_legacy"))
    assert _job(engine, "drop_legacy_spans")[0] == "succeeded"


def test_verification_blocks_destination_deletes_and_job_reclaims(legacy_postgres):
    engine, _ = legacy_postgres
    assert _job(engine, "migrate_spans")[0] == "succeeded"
    factory = sessionmaker(bind=engine)
    with factory() as db:
        job = maintenance.enqueue(db, "drop_legacy_spans")
        # Already expired when the handler begins, as with a very long step.
        job.status = "running"
        job.lease_owner = "first"
        job.lease_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
        job_id = job.id
    checked, resume = Event(), Event()

    def pause_after_check(conn, cursor, statement, parameters, context, executemany):
        if "AND d.run_created_at = r.created_at" in statement:
            checked.set()
            assert resume.wait(10)

    event.listen(engine, "after_cursor_execute", pause_after_check)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                maintenance.run_job, job_id, factory, engine, owner="first"
            )
            assert checked.wait(10)
            try:
                with factory() as db:
                    assert maintenance._claim(db, "second") is None
                with engine.connect() as conn:
                    conn.execute(text("SET LOCAL lock_timeout = '100ms'"))
                    with pytest.raises(Exception, match="lock timeout"):
                        conn.execute(text("DELETE FROM spans WHERE run_id = 'live'"))
                    conn.rollback()
            finally:
                resume.set()
            assert pending.result(timeout=15) == "succeeded"
    finally:
        resume.set()
        event.remove(engine, "after_cursor_execute", pause_after_check)
    assert not _legacy_exists(engine)


def test_cancel_requested_before_drop_preserves_legacy(legacy_postgres):
    engine, _ = legacy_postgres
    assert _job(engine, "migrate_spans")[0] == "succeeded"
    factory = sessionmaker(bind=engine)
    with factory() as db:
        job = maintenance.enqueue(db, "drop_legacy_spans")
        job.status = "cancel_requested"
        job.lease_owner = "worker"
        job.lease_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert maintenance.MaintenanceWorker(factory, engine).tick() == "cancelled"
    assert _legacy_exists(engine)


def test_stale_worker_cannot_drop_or_overwrite_the_job(legacy_postgres):
    engine, _ = legacy_postgres
    assert _job(engine, "migrate_spans")[0] == "succeeded"
    factory = sessionmaker(bind=engine)
    with factory() as db:
        job = maintenance.enqueue(db, "drop_legacy_spans")
        job.status = "running"
        job.lease_owner = "new-worker"
        db.commit()
        job_id = job.id
    assert (
        maintenance.run_job(job_id, factory, engine, owner="stale-worker")
        == "lease_lost"
    )
    assert _legacy_exists(engine)
    with factory() as db:
        job = db.get(MaintenanceJob, job_id)
        assert job.lease_owner == "new-worker" and job.status == "running"


def test_postgres_event_prune_batches_versions_and_removes_causes(legacy_postgres):
    from qym_platform.db.dashboard_models import (
        DashboardChangeEvent,
        DashboardEventCause,
    )

    engine, now = legacy_postgres
    factory = sessionmaker(bind=engine)
    with factory() as db:
        for version, published in (
            (11, now - timedelta(days=30)),
            (12, now - timedelta(days=30)),
            (13, None),
        ):
            db.add(
                DashboardChangeEvent(
                    source_version=version,
                    event_id=str(version),
                    project_key="p",
                    partition_key="live",
                    record_key="live:item:" + str(version),
                    record_kind="item",
                    published_at=published,
                )
            )
            db.add(DashboardEventCause(source_version=version, cause_key="cause"))
        db.commit()
    status, progress, error = _job(
        engine, "prune_dashboard_events", {"days": 7, "batch": 1}
    )
    assert status == "succeeded", error
    assert progress["rows_deleted"] == 2
    with factory() as db:
        assert db.query(DashboardChangeEvent.source_version).all() == [(13,)]
        assert db.query(DashboardEventCause.source_version).all() == [(13,)]


def test_cold_worker_configures_models_before_concurrent_queries(
    legacy_postgres, tmp_path
):
    import subprocess
    import sys
    import time

    engine, _ = legacy_postgres
    factory = sessionmaker(bind=engine)
    with factory() as db:
        job = maintenance.enqueue(db, "prune_dashboard_events", {"days": 7})
        db.commit()
        job_id = job.id
    root = Path(__file__).resolve().parents[2]
    # Reproduce the bad import/query ordering without relying on scheduler
    # timing. Eager main-thread configuration bypasses both barriers.
    child = r"""
import ast
import importlib.util
import sys
import threading
from pathlib import Path
from qym_platform import worker

path = Path(importlib.util.find_spec("qym_platform.db.models").origin)
score_line = next(n.lineno for n in ast.parse(path.read_text()).body if isinstance(n, ast.ClassDef) and n.name == "RunItemScore")
model_paused = threading.Event()
claim_finished = threading.Event()

def trace_import(frame, event, arg):
    if frame.f_globals.get("__name__") != "qym_platform.db.models" or frame.f_code.co_name != "<module>":
        return None
    if event == "line" and frame.f_lineno == score_line:
        model_paused.set()
        assert claim_finished.wait(10)
    return trace_import

claim = worker.MaintenanceWorker.tick.__globals__["_claim"]
def synchronized_claim(db, owner):
    module = sys.modules.get("qym_platform.db.models")
    if module is None or not hasattr(module, "RunItemScore"):
        assert model_paused.wait(10)
    try:
        return claim(db, owner)
    finally:
        claim_finished.set()

worker.MaintenanceWorker.tick.__globals__["_claim"] = synchronized_claim
threading.settrace(trace_import)
raise SystemExit(worker.main())
"""
    environment = dict(os.environ)
    environment["QYM_DATABASE_URL"] = engine.url.render_as_string(hide_password=False)
    environment["QYM_ROLE"] = "worker"
    environment["PYTHONPATH"] = os.pathsep.join(
        (str(root / "packages/platform"), str(root / "packages/sdk"))
    )
    log_path = tmp_path / "worker.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            [sys.executable, "-c", child],
            cwd=root,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, log_path.read_text()
                with factory() as db:
                    status = db.get(MaintenanceJob, job_id).status
                if status == "succeeded":
                    break
                assert status != "failed", log_path.read_text()
                time.sleep(0.1)
            else:
                pytest.fail(log_path.read_text())
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    assert process.returncode == 0, log_path.read_text()
    assert "failed to initialize" not in log_path.read_text()
