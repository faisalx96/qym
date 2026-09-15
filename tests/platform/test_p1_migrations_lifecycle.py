"""Full-chain PostgreSQL migration and real ASGI worker lifecycle validation."""

from __future__ import annotations

import os
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.db.dashboard_models import DashboardRunDimension, DashboardRunSummary
from qym_platform.db.models import (
    Project,
    ProjectAnalysisCategoryCatalogVersion,
    ReviewCorrection,
    Run,
    RunEvent,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)

MIGRATIONS = (
    Path(__file__).resolve().parents[2] / "packages/platform/qym_platform/migrations"
)


@pytest.fixture
def postgres(request, monkeypatch):
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_migration_lifecycle_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    engine = create_engine(scoped)
    monkeypatch.setenv("QYM_DATABASE_URL", scoped.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))

    def cleanup():
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()

    request.addfinalizer(cleanup)
    return engine, config


def seed(engine, *, before_dashboard=False):
    with Session(engine) as db:
        if before_dashboard:
            db.info["dashboard_projection_worker"] = True
        db.add(User(id="owner", email="owner@example.invalid", role=UserRole.ADMIN))
        db.flush()
        db.add(
            Project(
                id="project", name="Project", slug="project", created_by_user_id="owner"
            )
        )
        db.flush()
        db.add(
            Run(
                id="run",
                project_id="project",
                owner_user_id="owner",
                created_by_user_id="owner",
                task="test",
                dataset="test",
                model=None,
                metrics=["quality"],
                run_config={},
                run_metadata={"total_items": 1},
                status=RunWorkflowStatus.COMPLETED,
                created_at=datetime.now(),
                started_at=datetime.now(),
                last_event_at=datetime.now(),
            )
        )
        db.flush()
        db.add(
            ProjectAnalysisCategoryCatalogVersion(
                id="catalog",
                project_id="project",
                version=1,
                content_hash="f" * 64,
                subcategory_taxonomy={
                    "reasoning": {"math": {"label": "Math", "description": "Preserve"}}
                },
            )
        )
        db.execute(
            ReviewCorrection.__table__.insert().values(
                run_id="run",
                item_id="item",
                task="test",
                ai_root_cause="reasoning",
                human_root_cause="reasoning",
                ai_root_cause_issues=[
                    {"category": "reasoning", "subcategory": "math", "finding": "AI"}
                ],
                human_root_cause_issues=[
                    {"category": "reasoning", "subcategory": "math", "finding": "Human"}
                ],
            )
        )
        db.add(
            RunItem(
                run_id="run",
                item_id="item",
                input={"preserve": "source"},
                output="original",
                latency_ms=12,
            )
        )
        db.add(
            RunItemScore(
                run_id="run", item_id="item", metric_name="quality", score_numeric=0.75
            )
        )
        db.add(
            RunEvent(
                run_id="run",
                event_id=str(uuid4()),
                sequence=1,
                sent_at=datetime.now(),
                type="item_completed",
                payload={"preserve": True},
            )
        )
        db.commit()


def source_snapshot(engine):
    with Session(engine) as db:
        source = db.scalar(select(RunItem))
        return {
            "run": db.get(Run, "run").id,
            "input": source.input,
            "output": source.output,
            "score": db.scalar(select(RunItemScore.score_numeric)),
            "event": db.scalar(select(RunEvent.payload)),
            "subcategory_taxonomy": db.scalar(
                select(ProjectAnalysisCategoryCatalogVersion.subcategory_taxonomy)
            ),
            "ai_root_cause_issues": db.scalar(
                select(ReviewCorrection.ai_root_cause_issues)
            ),
            "human_root_cause_issues": db.scalar(
                select(ReviewCorrection.human_root_cause_issues)
            ),
        }


@pytest.mark.parametrize("populated", [False, True])
def test_postgres_full_chain_upgrade_p1_downgrade_reupgrade(postgres, populated):
    engine, config = postgres
    command.upgrade(config, "0046")
    if populated:
        seed(engine, before_dashboard=True)
        expected = source_snapshot(engine)
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert (
            connection.scalar(text("select version_num from alembic_version")) == "0057"
        )
        inspector = inspect(connection)
        assert "ix_dashboard_event_retention" in {
            row["name"] for row in inspector.get_indexes("dashboard_change_events")
        }
        assert "ix_dashboard_record_retention" in {
            row["name"] for row in inspector.get_indexes("dashboard_record_state")
        }
        tables = set(inspector.get_table_names())
        assert {
            "run_trace_summaries",
            "dashboard_run_summaries",
            "dashboard_partition_state",
        } <= tables
    if populated:
        assert source_snapshot(engine) == expected
        from qym_platform.db.dashboard_models import DashboardPartitionState

        with Session(engine) as db:
            partition = db.get(DashboardPartitionState, "run")
            assert partition and not partition.backfill_complete
    command.downgrade(config, "0046")
    with engine.connect() as connection:
        assert (
            connection.scalar(text("select version_num from alembic_version")) == "0046"
        )
        tables = set(inspect(connection).get_table_names())
        assert (
            "run_trace_summaries" not in tables
            and "dashboard_run_summaries" not in tables
        )
    if populated:
        assert source_snapshot(engine) == expected
    command.upgrade(config, "head")
    if populated:
        assert source_snapshot(engine) == expected


@pytest.mark.parametrize("prefix", ["", "/qym", "/qym/"])
def test_real_application_starts_projects_restarts_and_stops_worker(
    postgres, monkeypatch, prefix
):
    engine, config = postgres
    command.upgrade(config, "head")
    from qym_platform import deps, main
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db import session as db_session
    from qym_platform.settings import PlatformSettings

    factory = sessionmaker(bind=engine, autoflush=False)
    monkeypatch.setattr(db_session, "SessionLocal", factory)
    monkeypatch.setattr(deps, "SessionLocal", factory)
    monkeypatch.setattr(
        main,
        "PlatformSettings",
        lambda: PlatformSettings(
            environment="test", auth_mode="none", root_path=prefix
        ),
    )
    # Historical source rows have no prebuilt summaries or outbox registration.
    seed(engine, before_dashboard=True)
    app = main.build_app()
    path = prefix.rstrip("/")
    inner = (
        next(route.app for route in app.routes if route.path == path) if path else app
    )
    with Session(engine) as db:
        owner = db.get(User, "owner")
        db.expunge(owner)
    inner.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=owner, auth_type="none"
    )
    worker = inner.state.dashboard_summary_worker
    worker.interval = 0.02

    def wait_for_output(expected):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with Session(engine) as db:
                summary = db.get(DashboardRunSummary, "run")
                if (
                    summary
                    and summary.data.get("metric_averages", {}).get("quality")
                    == expected
                ):
                    assert (
                        db.get(DashboardRunDimension, "run").model == "nomodel|||plain"
                    )
                    return
            time.sleep(0.02)
        raise AssertionError("application worker did not publish source change")

    with TestClient(app) as client:
        assert client.get(path + "/healthz").status_code == 200
        assert worker._thread is not None and worker._thread.is_alive()
        wait_for_output(0.75)
        response = client.get(
            path + "/api/dashboard/runs", params={"project_slug": "project"}
        )
        assert response.status_code == 200
        assert response.json()["rows"][0]["metric_averages"]["quality"] == 0.75
        assert response.json()["freshness"]["unpublished_runs"] == 0
        first_thread = worker._thread
    assert not first_thread.is_alive()
    # A stopped process leaves durable queued changes for its replacement.
    with Session(engine) as db:
        db.scalar(select(RunItemScore)).score_numeric = 0.25
        db.commit()
    with TestClient(app) as client:
        assert worker._thread is not first_thread and worker._thread.is_alive()
        wait_for_output(0.25)
        response = client.get(
            path + "/api/dashboard/runs", params={"project_slug": "project"}
        )
        assert response.json()["rows"][0]["metric_averages"]["quality"] == 0.25
    assert not worker._thread.is_alive()
    assert engine.pool.checkedout() == 0


def test_uvicorn_entrypoint_publishes_history_under_production_prefix(
    postgres, tmp_path
):
    import signal
    import socket
    import subprocess
    import sys

    import httpx

    engine, config = postgres
    command.upgrade(config, "head")
    seed(engine, before_dashboard=True)
    root = Path(__file__).resolve().parents[2]
    env = dict(
        os.environ,
        QYM_DATABASE_URL=engine.url.render_as_string(hide_password=False),
        QYM_ROOT_PATH="/qym",
        QYM_ENVIRONMENT="test",
        QYM_AUTH_MODE="none",
        QYM_AUTH_LOCAL_ENABLED="false",
        PYTHONPATH=os.pathsep.join(
            str(root / "packages" / package) for package in ("sdk", "platform")
        ),
    )
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    logfile = tmp_path / "uvicorn.log"
    with logfile.open("w") as output:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "qym_platform.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=tmp_path,
            env=env,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=2) as client:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    assert process.poll() is None, logfile.read_text()
                    try:
                        response = client.get(
                            "/qym/api/dashboard/runs",
                            params={"project_slug": "project"},
                        )
                    except httpx.TransportError:
                        time.sleep(0.1)
                        continue
                    assert response.status_code == 200, response.text
                    payload = response.json()
                    # Runs are listed as "pending" before their numbers are consistent.
                    if payload["rows"] and payload["rows"][0].get("summary_state") == "published":
                        row = payload["rows"][0]
                        assert row["run_id"] == "run"
                        assert row["total_items"] == 1
                        assert row["metric_averages"]["quality"] == 0.75
                        assert payload["freshness"]["unpublished_runs"] == 0
                        break
                    time.sleep(0.1)
                else:
                    pytest.fail(
                        "Uvicorn did not publish history:\n" + logfile.read_text()
                    )
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    assert process.returncode in (0, -signal.SIGTERM), logfile.read_text()
    logs = logfile.read_text()
    assert "Dashboard summary worker started" in logs
    assert "Dashboard summary worker stopped" in logs
