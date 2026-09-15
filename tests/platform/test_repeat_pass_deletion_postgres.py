"""HTTP pass deletion across inline and deferred PostgreSQL JSON migrations."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.orm import sessionmaker

from qym_platform.app import create_app
from qym_platform.db import migration_helpers
from qym_platform.db.models import (
    AuditLog,
    Project,
    Run,
    RunEvent,
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunMetricAnalysis,
    User,
)
from qym_platform.deps import get_db
from test_repeat_pass_deletion import HEADERS, RUN_ID, _seed
from test_retention import migrated_postgres  # noqa: F401


@pytest.fixture(params=["json", "jsonb"])
def payload_type(request, monkeypatch):
    if request.param == "json":
        original = migration_helpers.is_large

        def defer_event_rewrite(bind, table, *args, **kwargs):
            return table == "run_events" or original(bind, table, *args, **kwargs)

        monkeypatch.setattr(migration_helpers, "is_large", defer_event_rewrite)
    return request.param


@pytest.fixture
def deletion_env(payload_type, request, monkeypatch):
    # Resolve after the size predicate is patched, so the real upgrade queues
    # its paused maintenance job rather than converting the event column.
    engine = request.getfixturevalue("migrated_postgres")
    with engine.connect() as connection:
        actual_type = connection.execute(
            text(
                "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
                "WHERE attrelid = 'run_events'::regclass AND attname = 'payload'"
            )
        ).scalar_one()
        assert actual_type == payload_type
        if payload_type == "json":
            job = connection.execute(
                text(
                    "SELECT status, params FROM maintenance_jobs "
                    "WHERE kind = 'alter_column_types'"
                )
            ).one()
            assert job.status == "paused"
            assert job.params["tables"] == ["run_events"]

    sessions = sessionmaker(bind=engine, autoflush=False)
    with sessions() as session:
        # The shared SQLite seed submits every row together. Flush its parents
        # first because these fixtures use scalar FKs, not ORM relationships.
        def flush_seed_parents(db):
            for model in (User, Project, Run):
                db.flush([row for row in db.new if isinstance(row, model)])

        event.listen(session, "before_commit", flush_seed_parents, once=True)
        _seed(session)
        for sequence, event_type, payload in (
            (0, "run_started", {"run_config": {"samples": 3, "keep": True}}),
            (
                4,
                "run_completed",
                {"summary": {"samples": 3, "run_metadata": {"samples": 3}}},
            ),
            (5, "custom_event", {"unscoped": {"keep": [1, 2, 3]}}),
        ):
            session.add(
                RunEvent(
                    run_id=RUN_ID,
                    event_id=f"extra-{sequence}",
                    sequence=sequence,
                    type=event_type,
                    sent_at=datetime(2026, 8, 9),
                    payload=payload,
                )
            )
        session.commit()

    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    app = create_app()

    def override_get_db():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, sessions


def _events(session):
    return {
        row.event_id: row.payload
        for row in session.query(RunEvent).filter_by(run_id=RUN_ID)
    }


@pytest.mark.parametrize("bulk", [False, True], ids=["single", "bulk"])
def test_http_pass_deletion_rewrites_deferred_and_converted_events(deletion_env, bulk):
    client, sessions = deletion_env
    if bulk:
        response = client.request(
            "DELETE",
            f"/api/runs/{RUN_ID}/passes",
            headers=HEADERS,
            json={"pass_numbers": [1, 2], "expected_pass_version": 0},
        )
        expected_samples = 1
        survivors = {"event-3": 1}
    else:
        response = client.delete(
            f"/api/runs/{RUN_ID}/passes/2?expected_pass_version=0",
            headers=HEADERS,
        )
        expected_samples = 2
        survivors = {"event-1": 1, "event-3": 2}
    assert response.status_code == 200, response.text
    assert response.json()["samples"] == expected_samples

    with sessions() as session:
        run = session.get(Run, RUN_ID)
        assert run.samples == expected_samples
        assert run.run_metadata["pass_revision"] == (2 if bulk else 1)
        assert run.run_metadata["has_repeat_pass_context"] is True
        events = _events(session)
        numbered = {
            key: value for key, value in events.items() if key.startswith("event-")
        }
        assert set(numbered) == set(survivors)
        for event_id, number in survivors.items():
            payload = numbered[event_id]
            assert payload["pass_number"] == number
            assert payload["item_id"] == "item-1"
            assert payload["trace_id"] == f"trace-pass-{event_id[-1]}"
        if not bulk:
            assert numbered["event-1"]["output"] == "out-pass-1"
        assert events["extra-0"] == {
            "run_config": {"samples": expected_samples, "keep": True}
        }
        assert events["extra-4"]["summary"]["samples"] == expected_samples
        assert events["extra-4"]["summary"]["run_metadata"] == {
            "samples": expected_samples,
            "last_completed_pass": expected_samples,
        }
        assert events["extra-5"] == {"unscoped": {"keep": [1, 2, 3]}}
        assert [
            row.pass_number
            for row in session.query(RunItemAttempt).order_by(
                RunItemAttempt.pass_number
            )
        ] == list(range(1, expected_samples + 1))
        aggregate = session.query(RunItemScore).filter_by(run_id=RUN_ID).one()
        assert aggregate.score_numeric == pytest.approx(0.0 if bulk else 0.5)
        item = session.query(RunItem).filter_by(run_id=RUN_ID).one()
        assert item.output == (None if bulk else "out-pass-1")
        assert item.error == "boom"
        assert session.query(RunMetricAnalysis).count() == 0
        assert session.query(AuditLog).filter_by(action="run.pass_deleted").count() == (
            2 if bulk else 1
        )


def test_failed_bulk_deletion_rolls_back_event_rewrite(deletion_env):
    client, sessions = deletion_env
    with sessions() as session:
        # Pass 2 can be removed, but the subsequent Pass 1 removal must fail.
        # Its events deliberately remain, so rollback must restore the earlier
        # event deletion and renumber as well as scores and run metadata.
        for model in (RunItemAttempt, RunItemPassScore):
            session.query(model).filter_by(run_id=RUN_ID, pass_number=1).delete(
                synchronize_session=False
            )
        session.commit()
        original_events = _events(session)
        original_metadata = dict(session.get(Run, RUN_ID).run_metadata)

    response = client.request(
        "DELETE",
        f"/api/runs/{RUN_ID}/passes",
        headers=HEADERS,
        json={"pass_numbers": [1, 2], "expected_pass_version": 0},
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Pass has no stored data"
    with sessions() as session:
        run = session.get(Run, RUN_ID)
        assert run.samples == 3
        assert run.run_metadata == original_metadata
        assert _events(session) == original_events
        for model in (RunItemAttempt, RunItemPassScore):
            assert [
                row.pass_number
                for row in session.query(model)
                .filter_by(run_id=RUN_ID)
                .order_by(model.pass_number)
            ] == [2, 3]
        assert session.query(RunMetricAnalysis).count() == 1
        assert session.query(AuditLog).filter_by(action="run.pass_deleted").count() == 0
