"""A run with a refused event completes, is flagged, and can be reviewed (C024).

The SDK streams a real evaluation into the full platform app. The platform
refuses one event (an item_completed that an older or custom emitter sent
without latency_ms). The SDK still sends run_completed with the refused count;
the run ends COMPLETED with the incomplete-ingest flag naming the event, the
run page payload and the runs list carry the flag, and the owner can submit
the run for review. Undelivered events keep holding completion.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
from unittest.mock import MagicMock
from urllib.error import HTTPError
from urllib.parse import urlsplit

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from qym import Evaluator, InMemoryDataset
from qym.platform import client as client_module
from qym.platform.client import PlatformEventStream

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.dashboard_models import DashboardPartitionState
from qym_platform.db.models import (
    ApiKey,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunEvent,
    RunItem,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.dashboard_summaries import drain_dashboard_changes

TOKEN = "rejected-completion-token"
OWNER = "owner@example.com"


@pytest.fixture()
def platform(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as db:
        db.add(User(id="owner-1", email=OWNER, role=UserRole.MEMBER))
        db.flush()
        db.add(
            Project(
                id="project-1",
                name="Project",
                slug="project",
                created_by_user_id="owner-1",
            )
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id="project-1", user_id="owner-1", role=ProjectRole.MEMBER
                ),
                ApiKey(
                    id="key-1",
                    user_id="owner-1",
                    project_id="project-1",
                    name="runner",
                    prefix=api_key_prefix(TOKEN),
                    key_hash=hash_api_key(TOKEN),
                    scopes=[],
                ),
            ]
        )
        db.commit()

    app = create_app()

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    sent = []
    try:
        with TestClient(app) as client:
            key = {"Authorization": f"Bearer {TOKEN}"}

            def post_json(url, payload, api_key, **kwargs):
                response = client.post(urlsplit(url).path, json=payload, headers=key)
                response.raise_for_status()
                return response.json()

            def post_ndjson(url, payload, api_key, **kwargs):
                # Behave like urllib: non-2xx responses raise HTTPError with a body.
                sent.extend(json.loads(line) for line in payload.splitlines() if line)
                response = client.post(
                    urlsplit(url).path,
                    content=payload,
                    headers={**key, "content-type": "application/x-ndjson"},
                )
                if response.status_code >= 400:
                    raise HTTPError(
                        url,
                        response.status_code,
                        response.text,
                        response.headers,
                        io.BytesIO(response.content),
                    )
                return response.json()

            monkeypatch.setattr(client_module, "_post_json", post_json)
            monkeypatch.setattr(client_module, "_post_ndjson", post_ndjson)
            yield engine, client, sent, post_ndjson
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _evaluator(tmp_path):
    async def task(value):
        return value

    return Evaluator(
        task,
        InMemoryDataset(
            [
                {"id": f"item-{i}", "input": f"q{i}", "expected_output": f"q{i}"}
                for i in range(3)
            ]
        ),
        ["exact_match"],
        config={
            "run_name": "rejected-completion",
            "task_name": "rejected-completion",
            "checkpoint_enabled": False,
            "otel_enabled": False,
            "platform_api_key": TOKEN,
            "platform_url": "http://testserver",
            "output_dir": str(tmp_path),
        },
    )


def _drain(engine):
    for _ in range(50):
        with Session(engine, autoflush=False) as db:
            drain_dashboard_changes(db)
            db.commit()
            pending = db.scalar(
                select(func.count())
                .select_from(DashboardPartitionState)
                .where(DashboardPartitionState.queue_state.in_(["pending", "backfill"]))
            )
        if not pending:
            return
    raise AssertionError("dashboard projection did not settle")


@pytest.mark.asyncio
async def test_run_with_one_rejected_event_completes_flagged_and_submittable(
    platform, monkeypatch, tmp_path, capsys
):
    engine, client, sent, post = platform
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)

    def drop_latency_of_item_1(url, payload, api_key, **kwargs):
        lines = []
        for line in payload.splitlines():
            evt = json.loads(line)
            if (
                evt["type"] == "item_completed"
                and evt["payload"].get("item_id") == "item-1"
            ):
                evt["payload"].pop("latency_ms", None)
            lines.append(json.dumps(evt))
        return post(url, "\n".join(lines) + "\n", api_key, **kwargs)

    monkeypatch.setattr(client_module, "_post_ndjson", drop_latency_of_item_1)

    evaluator = _evaluator(tmp_path)
    result = await evaluator.arun(show_tui=False, auto_save=False)

    assert result.total_items == 3
    stream = evaluator._platform_stream
    assert stream.rejected_events == 1 and stream.undelivered_events == 0
    assert evaluator._run_completed is True
    [completed] = [evt for evt in sent if evt["type"] == "run_completed"]
    assert completed["payload"]["summary"]["rejected_events"] == 1
    assert completed["payload"]["final_status"] == "COMPLETED"
    err = capsys.readouterr().err
    assert "1 platform events were rejected by the platform" in err
    assert "failed to upload" not in err

    with Session(engine) as db:
        run = db.query(Run).one()
        run_id = run.id
        assert run.status == RunWorkflowStatus.COMPLETED
        flag = run.run_metadata["ingest_incomplete"]
        assert flag["rejected_events"] == 1
        assert (flag["expected_items"], flag["received_items"]) == (3, 3)
        [named] = flag["rejected"]
        assert (named["type"], named["item_id"]) == ("item_completed", "item-1")
        assert "latency_ms" in named["error"]
        assert "item_completed for item item-1" in flag["reason"]
        assert db.query(RunItem).count() == 3
        assert db.query(RunEvent).filter_by(type="run_completed").count() == 1

    ui = {"X-User-Email": OWNER, "Origin": "http://localhost:8000"}
    # The run page payload carries the flag (not the tally's bookkeeping).
    page = client.get(f"/api/runs/{run_id}", headers=ui)
    assert page.status_code == 200, page.text
    metadata = page.json()["run"]["metadata"]
    assert metadata["ingest_incomplete"]["rejected_events"] == 1
    assert "seen" not in metadata["ingest_rejected"]

    def runs_page_row():
        # The runs page loads /api/runs: rows built from the run until the
        # projection publishes it, then the published descriptor.
        response = client.get("/api/runs?project_slug=project", headers=ui)
        assert response.status_code == 200, response.text
        [row] = [
            row
            for models in response.json()["tasks"].values()
            for rows in models.values()
            for row in rows
            if row["run_id"] == run_id
        ]
        return row

    # The runs list shows it too, before and after the projection catches up.
    assert runs_page_row()["ingest_incomplete"]["rejected_events"] == 1
    _drain(engine)
    assert runs_page_row()["ingest_incomplete"]["rejected_events"] == 1
    listing = client.get("/api/dashboard/runs?project_slug=project", headers=ui)
    assert listing.status_code == 200, listing.text
    [row] = [row for row in listing.json()["rows"] if row["run_id"] == run_id]
    assert row["ingest_incomplete"]["rejected_events"] == 1
    assert "item-1" in row["ingest_incomplete"]["reason"]

    # And the owner can submit it for review.
    submitted = client.post(f"/v1/runs/{run_id}/submit", headers=ui)
    assert submitted.status_code == 200, submitted.text
    with Session(engine) as db:
        assert db.get(Run, run_id).status == RunWorkflowStatus.SUBMITTED


@pytest.mark.asyncio
async def test_undelivered_event_still_holds_completion(
    platform, monkeypatch, tmp_path
):
    """An outage (retries exhausted) is not a rejection: no run_completed."""
    engine, client, sent, post = platform
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)
    monkeypatch.setattr(PlatformEventStream, "CLOSE_GIVEUP_FAILURES", 2)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_BASE", 0.001)
    monkeypatch.setattr(PlatformEventStream, "RETRY_BACKOFF_MAX", 0.001)
    monkeypatch.setattr(PlatformEventStream, "SYNC_SEND_RETRIES", 1)

    def unreachable_after_start(url, payload, api_key, **kwargs):
        if any(
            json.loads(line)["type"] != "run_started" for line in payload.splitlines()
        ):
            raise OSError("platform unreachable")
        return post(url, payload, api_key, **kwargs)

    monkeypatch.setattr(client_module, "_post_ndjson", unreachable_after_start)

    evaluator = _evaluator(tmp_path)
    await asyncio.wait_for(evaluator.arun(show_tui=False, auto_save=False), 30)

    stream = evaluator._platform_stream
    assert stream.undelivered_events > 0 and stream.rejected_events == 0
    assert evaluator._run_completed is False
    with Session(engine) as db:
        run = db.query(Run).one()
        assert run.status == RunWorkflowStatus.RUNNING
        assert "ingest_incomplete" not in (run.run_metadata or {})
