"""Run review workflow: frozen reviewed runs, restored outcomes, history (C012/C014/C020)."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "proxy_headers")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    Approval,
    ApprovalDecision,
    AuditLog,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunEvent,
    RunItem,
    RunItemScore,
    RunWorkflowEvent,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from test_root_cause_issue_persistence import (
    ISSUES,
    _seed_run,
    db_session,
)  # noqa: F401

TOKEN = "review-token"
ENDED_AT = datetime(2026, 9, 1, 12, 0, 0)


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    try:
        yield SessionLocal
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _ui(email: str) -> dict:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def _seed(session: Session, *, status=RunWorkflowStatus.COMPLETED) -> str:
    """A finished run owned by a member, reviewed by a project manager."""
    run_id = str(uuid4())
    owner = User(
        id="owner-1",
        email="owner@example.com",
        role=UserRole.MEMBER,
        display_name="Owner",
    )
    manager = User(
        id="manager-1",
        email="manager@example.com",
        role=UserRole.MEMBER,
        display_name="Maya Manager",
    )
    admin = User(id="admin-1", email="admin@example.com", role=UserRole.ADMIN)
    outsider = User(id="outsider-1", email="outsider@example.com", role=UserRole.MEMBER)
    project = Project(
        id="project-1", name="Project", slug="project", created_by_user_id=admin.id
    )
    # Flush users before the project: Postgres enforces the foreign keys.
    session.add_all([owner, manager, admin, outsider])
    session.flush()
    session.add(project)
    session.flush()
    session.add_all(
        [
            ProjectMembership(
                project_id=project.id, user_id=owner.id, role=ProjectRole.MEMBER
            ),
            ProjectMembership(
                project_id=project.id, user_id=manager.id, role=ProjectRole.MANAGER
            ),
            ApiKey(
                id="key-1",
                user_id=owner.id,
                project_id=project.id,
                name="runner",
                prefix=api_key_prefix(TOKEN),
                key_hash=hash_api_key(TOKEN),
                scopes=[],
            ),
            Run(
                id=run_id,
                project_id=project.id,
                created_by_user_id=owner.id,
                owner_user_id=owner.id,
                task="task",
                dataset="dataset",
                metrics=["accuracy"],
                run_metadata={},
                run_config={},
                status=status,
                started_at=ENDED_AT - timedelta(minutes=5),
                ended_at=ENDED_AT,
                last_event_at=ENDED_AT,
            ),
        ]
    )
    session.flush()
    session.add_all(
        [
            RunItem(
                run_id=run_id,
                item_id="item-1",
                index=0,
                input={"q": "hi"},
                output="original output",
                item_metadata={},
            ),
            RunItemScore(
                run_id=run_id,
                item_id="item-1",
                metric_name="accuracy",
                score_numeric=1.0,
                score_raw=1.0,
                meta={},
            ),
        ]
    )
    session.commit()
    return run_id


def _act(client: TestClient, run_id: str, action: str, email: str, comment=None):
    kwargs = {"headers": _ui(email)}
    if comment is not None:
        kwargs["json"] = {"comment": comment}
    elif action in ("approve", "reject"):
        kwargs["json"] = {}
    return client.post(f"/v1/runs/{run_id}/{action}", **kwargs)


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _event(
    run_id: str, type_: str, payload: dict, *, sequence: int = 100, event_id=None
) -> dict:
    return {
        "schema_version": 1,
        "event_id": event_id or str(uuid4()),
        "sequence": sequence,
        "sent_at": "2026-09-02T00:00:00Z",
        "type": type_,
        "run_id": run_id,
        "payload": payload,
    }


def _post_events(client: TestClient, run_id: str, events: list):
    return client.post(
        f"/v1/runs/{run_id}/events",
        content="\n".join(json.dumps(evt) for evt in events),
        headers={"Authorization": f"Bearer {TOKEN}"},
    )


LATE_DATA_EVENTS = {
    "run_started": {
        "task": "task",
        "dataset": "dataset",
        "metrics": ["accuracy"],
        "started_at": "2026-09-02T00:00:00Z",
    },
    "item_started": {"item_id": "item-1", "index": 0, "input": {"q": "changed"}},
    "metric_scored": {
        "item_id": "item-1",
        "metric_name": "accuracy",
        "score_numeric": 0.0,
    },
    "item_completed": {
        "item_id": "item-1",
        "output": "totally different output",
        "latency_ms": 5,
    },
    "run_completed": {"ended_at": "2026-09-02T00:00:00Z", "final_status": "COMPLETED"},
}


def _snapshot(session_factory, run_id: str) -> dict:
    with session_factory() as db:
        run = db.get(Run, run_id)
        item = db.query(RunItem).filter_by(run_id=run_id, item_id="item-1").one()
        score = db.query(RunItemScore).filter_by(run_id=run_id, item_id="item-1").one()
        approval = db.query(Approval).filter_by(run_id=run_id).one_or_none()
        return {
            "status": run.status,
            "status_reason": run.status_reason,
            "ended_at": run.ended_at,
            "last_event_at": run.last_event_at,
            "input": item.input,
            "output": item.output,
            "score": score.score_numeric,
            "decision": approval.decision if approval else None,
            "comment": approval.comment if approval else None,
            "events": db.query(RunEvent).filter_by(run_id=run_id).count(),
        }


def _approve(client, run_id, comment="approved at 100%"):
    _ok(_act(client, run_id, "submit", "owner@example.com"))
    _ok(_act(client, run_id, "approve", "manager@example.com", comment))


# ---------------------------------------------------------------------------
# C014: reviewed runs are frozen against late runner events
# ---------------------------------------------------------------------------


def test_late_heartbeat_is_a_no_op_on_an_approved_run(client, session_factory):
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    before = _snapshot(session_factory, run_id)

    response = _post_events(
        client,
        run_id,
        [_event(run_id, "run_heartbeat", {"heartbeat_at": "2026-09-02T00:00:00Z"})],
    )

    assert response.status_code == 200, response.text
    assert response.json()["applied"] == 0
    after = _snapshot(session_factory, run_id)
    assert after == before
    assert after["status"] == RunWorkflowStatus.APPROVED
    # Still resubmittable/unapprovable: the review was not stranded in RUNNING.
    assert (
        _ok(_act(client, run_id, "unapprove", "manager@example.com"))["status"]
        == "COMPLETED"
    )


@pytest.mark.parametrize("event_type", sorted(LATE_DATA_EVENTS))
def test_late_runner_data_cannot_rewrite_an_approved_run(
    client, session_factory, event_type
):
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    before = _snapshot(session_factory, run_id)

    response = _post_events(
        client,
        run_id,
        [
            _event(
                run_id,
                "run_heartbeat",
                {"heartbeat_at": "2026-09-02T00:00:00Z"},
                sequence=99,
            ),
            _event(run_id, event_type, LATE_DATA_EVENTS[event_type]),
        ],
    )

    assert response.status_code == 409, response.text
    assert response.headers["X-Qym-Run-State"] == "in_review"
    assert response.headers["X-Qym-Run-Status"] == "APPROVED"
    assert "under review" in response.json()["detail"]
    assert _snapshot(session_factory, run_id) == before


def test_score_rewrite_batch_after_approval_changes_nothing(client, session_factory):
    """The reported repro: metric_scored 0.0 + item_completed + run_completed."""
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    before = _snapshot(session_factory, run_id)

    response = _post_events(
        client,
        run_id,
        [
            _event(
                run_id, "metric_scored", LATE_DATA_EVENTS["metric_scored"], sequence=101
            ),
            _event(
                run_id,
                "item_completed",
                LATE_DATA_EVENTS["item_completed"],
                sequence=102,
            ),
            _event(
                run_id, "run_completed", LATE_DATA_EVENTS["run_completed"], sequence=103
            ),
        ],
    )

    assert response.status_code == 409
    after = _snapshot(session_factory, run_id)
    assert after == before
    assert (after["score"], after["output"], after["decision"], after["comment"]) == (
        1.0,
        "original output",
        ApprovalDecision.APPROVED,
        "approved at 100%",
    )


@pytest.mark.parametrize("review_status", ["SUBMITTED", "REJECTED"])
def test_submitted_and_rejected_runs_are_frozen_too(
    client, session_factory, review_status
):
    with session_factory() as db:
        run_id = _seed(db)
    _ok(_act(client, run_id, "submit", "owner@example.com"))
    if review_status == "REJECTED":
        _ok(_act(client, run_id, "reject", "manager@example.com", "redo"))
    before = _snapshot(session_factory, run_id)

    heartbeat = _post_events(
        client,
        run_id,
        [_event(run_id, "run_heartbeat", {"heartbeat_at": "2026-09-02T00:00:00Z"})],
    )
    data = _post_events(
        client,
        run_id,
        [_event(run_id, "item_completed", LATE_DATA_EVENTS["item_completed"])],
    )

    assert heartbeat.status_code == 200
    assert data.status_code == 409
    assert data.headers["X-Qym-Run-Status"] == review_status
    assert _snapshot(session_factory, run_id) == before


def test_redelivered_events_on_a_reviewed_run_stay_idempotent(client, session_factory):
    with session_factory() as db:
        run_id = _seed(db)
    delivered = _event(
        run_id,
        "metric_scored",
        {"item_id": "item-1", "metric_name": "accuracy", "score_numeric": 1.0},
    )
    assert _post_events(client, run_id, [delivered]).status_code == 200
    _approve(client, run_id)

    # A retry of a batch the server already applied (lost response) is not new data.
    response = _post_events(client, run_id, [delivered])

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "applied": 0,
        "skipped": 1,
        "rejected": 0,
        "rejected_events": [],
    }


def test_frozen_run_keeps_the_per_event_rejection_contract(client, session_factory):
    """A reviewed run reports invalid lines like any other run (C005 + C014)."""
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    before = _snapshot(session_factory, run_id)
    heartbeat = json.dumps(
        _event(run_id, "run_heartbeat", {"heartbeat_at": "2026-09-02T00:00:00Z"})
    )
    headers = {"Authorization": f"Bearer {TOKEN}"}

    mixed = client.post(
        f"/v1/runs/{run_id}/events",
        content=heartbeat + "\n{not json",
        headers=headers,
    )
    assert mixed.status_code == 200, mixed.text
    body = mixed.json()
    assert (body["applied"], body["skipped"], body["rejected"]) == (0, 1, 1)
    assert body["rejected_events"][0]["line"] == 2
    assert "invalid JSON" in body["rejected_events"][0]["error"]

    all_invalid = client.post(
        f"/v1/runs/{run_id}/events", content="not json\n{nope", headers=headers
    )
    assert all_invalid.status_code == 422, all_invalid.text
    assert all_invalid.json()["rejected"] == 2
    assert [row["line"] for row in all_invalid.json()["rejected_events"]] == [1, 2]
    assert _snapshot(session_factory, run_id) == before


def test_split_retry_on_a_frozen_run_returns_the_full_contract(
    client, session_factory
):
    """The isolation path sums each half's verdicts; a frozen half must carry them."""
    from qym_platform.api import ingest
    from qym_platform.auth import Principal

    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    heartbeat = lambda seq: json.dumps(  # noqa: E731
        _event(
            run_id,
            "run_heartbeat",
            {"heartbeat_at": "2026-09-02T00:00:00Z"},
            sequence=seq,
        )
    )
    with session_factory() as db:
        bind = db.get_bind()
        owner = db.get(User, "owner-1")
        principal = Principal(
            user=User(id=owner.id), auth_type="api_key", project_id="project-1"
        )

    result = ingest._split_line_range(
        run_id,
        [heartbeat(1), heartbeat(2)],
        0,
        2,
        bind,
        principal,
        ValueError("refused"),
    )

    assert result == {
        "applied": 0,
        "skipped": 2,
        "rejected": 0,
        "rejected_events": [],
    }


def test_withdrawn_approval_reopens_the_run_to_ingest(client, session_factory):
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    _ok(_act(client, run_id, "unapprove", "manager@example.com", "rescoring"))

    response = _post_events(
        client,
        run_id,
        [_event(run_id, "metric_scored", LATE_DATA_EVENTS["metric_scored"])],
    )

    assert response.status_code == 200, response.text
    assert _snapshot(session_factory, run_id)["score"] == 0.0


def test_lifecycle_helpers_never_move_a_reviewed_run(session_factory):
    from qym_platform.services.run_lifecycle import (
        mark_run_running,
        mark_run_terminal,
        touch_run_event,
    )

    for status in (
        RunWorkflowStatus.SUBMITTED,
        RunWorkflowStatus.APPROVED,
        RunWorkflowStatus.REJECTED,
    ):
        run = Run(status=status, ended_at=ENDED_AT, last_event_at=ENDED_AT)
        mark_run_running(run)
        mark_run_terminal(run, RunWorkflowStatus.COMPLETED, ended_at=utc_now_naive())
        touch_run_event(run, utc_now_naive())
        assert (run.status, run.ended_at, run.last_event_at) == (
            status,
            ENDED_AT,
            ENDED_AT,
        )


# ---------------------------------------------------------------------------
# C014: withdrawing a decision restores the real execution outcome
# ---------------------------------------------------------------------------


def test_withdrawing_a_decision_keeps_a_failed_run_failed(client, session_factory):
    with session_factory() as db:
        run_id = _seed(db, status=RunWorkflowStatus.FAILED)

    _ok(_act(client, run_id, "submit", "owner@example.com"))
    _ok(_act(client, run_id, "reject", "manager@example.com", "look again"))
    assert (
        _ok(_act(client, run_id, "unreject", "manager@example.com"))["status"]
        == "FAILED"
    )

    # A rejection that is resubmitted still remembers the original outcome.
    _ok(_act(client, run_id, "submit", "owner@example.com"))
    _ok(_act(client, run_id, "reject", "manager@example.com"))
    _ok(_act(client, run_id, "submit", "owner@example.com"))
    _ok(_act(client, run_id, "approve", "manager@example.com", "fine"))
    assert (
        _ok(_act(client, run_id, "unapprove", "manager@example.com"))["status"]
        == "FAILED"
    )

    with session_factory() as db:
        run = db.get(Run, run_id)
        assert (run.status, run.ended_at) == (RunWorkflowStatus.FAILED, ENDED_AT)
        assert (
            db.query(Approval).filter_by(run_id=run_id).one().execution_status
            == "FAILED"
        )


def test_a_new_review_round_records_the_current_outcome(client, session_factory):
    """An outcome that changed between review rounds is not restored stale."""
    with session_factory() as db:
        run_id = _seed(db, status=RunWorkflowStatus.FAILED)
    _approve(client, run_id)
    assert _ok(_act(client, run_id, "unapprove", "manager@example.com"))["status"] == (
        "FAILED"
    )
    # Unfrozen again, the runner finishes the run successfully this time.
    completed = _post_events(
        client,
        run_id,
        [_event(run_id, "run_completed", LATE_DATA_EVENTS["run_completed"])],
    )
    assert completed.status_code == 200, completed.text

    _approve(client, run_id)
    assert _ok(_act(client, run_id, "unapprove", "manager@example.com"))["status"] == (
        "COMPLETED"
    )


@pytest.mark.parametrize(
    "final_status,expected",
    [("FAILED", "FAILED"), ("COMPLETED", "COMPLETED"), (None, "COMPLETED")],
)
def test_pre_upgrade_reviews_resolve_outcome_from_the_run_completed_event(
    client, session_factory, final_status, expected
):
    """Reviews started before 0060 have no stored outcome (lazy backfill)."""
    with session_factory() as db:
        run_id = _seed(db, status=RunWorkflowStatus.APPROVED)
        db.add(
            Approval(
                run_id=run_id,
                submitted_by_user_id="owner-1",
                decision=ApprovalDecision.APPROVED,
                decision_by_user_id="manager-1",
                decision_at=ENDED_AT,
                comment="legacy",
            )
        )
        if final_status:
            db.add(
                RunEvent(
                    run_id=run_id,
                    event_id=str(uuid4()),
                    sequence=7,
                    type="run_completed",
                    sent_at=ENDED_AT,
                    payload={
                        "ended_at": "2026-09-01T12:00:00Z",
                        "final_status": final_status,
                    },
                )
            )
        db.commit()

    assert (
        _ok(_act(client, run_id, "unapprove", "manager@example.com"))["status"]
        == expected
    )
    with session_factory() as db:
        assert (
            db.query(Approval).filter_by(run_id=run_id).one().execution_status
            == expected
        )


# ---------------------------------------------------------------------------
# C014: transitions lock the run and check state inside the lock
# ---------------------------------------------------------------------------


def test_review_transitions_lock_the_run_and_reject_stale_decisions(
    client, session_factory
):
    with session_factory() as db:
        run_id = _seed(db)
    locked = []

    def _capture(state):
        statement = state.statement
        if state.is_select and getattr(statement, "_for_update_arg", None) is not None:
            locked.extend(
                desc.get("entity").__tablename__
                for desc in statement.column_descriptions
                if desc.get("entity") is not None
            )

    event.listen(Session, "do_orm_execute", _capture)
    try:
        for action, email in (
            ("submit", "owner@example.com"),
            ("approve", "manager@example.com"),
            ("unapprove", "manager@example.com"),
            ("submit", "owner@example.com"),
            ("reject", "manager@example.com"),
            ("unreject", "manager@example.com"),
        ):
            locked.clear()
            _ok(_act(client, run_id, action, email))
            assert locked[:2] == ["runs", "approvals"], action
    finally:
        event.remove(Session, "do_orm_execute", _capture)

    # A second reviewer acting on the state they loaded earlier gets a
    # conflict naming the current state, not a silent overwrite.
    _ok(_act(client, run_id, "submit", "owner@example.com"))
    _ok(_act(client, run_id, "approve", "manager@example.com", "first"))
    for action in ("approve", "reject", "unreject"):
        stale = _act(client, run_id, action, "admin@example.com", "second")
        assert stale.status_code == 409, action
        assert stale.headers["X-Qym-Run-Status"] == "APPROVED"
        assert "run is APPROVED" in stale.json()["detail"]
    resubmit = _act(client, run_id, "submit", "owner@example.com")
    assert resubmit.status_code == 409
    with session_factory() as db:
        approval = db.query(Approval).filter_by(run_id=run_id).one()
        assert (approval.decision, approval.comment) == (
            ApprovalDecision.APPROVED,
            "first",
        )


@pytest.fixture()
def postgres_client(monkeypatch):
    """The app on a throwaway Postgres schema, where row locks really block."""
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    schema = "review_workflow_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        app = create_app()

        def override_get_db():
            db = sessions()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        with TestClient(app) as test_client:
            yield test_client, sessions, engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _while_run_is_locked(engine, run_id, calls):
    """Start ``calls`` while another transaction holds the run row lock.

    Returns their responses once the lock is released; asserts none of them
    finished while it was held.
    """
    results = {}
    holder = engine.connect()
    transaction = holder.begin()
    holder.execute(text("SELECT id FROM runs WHERE id = :r FOR UPDATE"), {"r": run_id})
    threads = []
    for name, call in calls:
        thread = threading.Thread(
            target=lambda name=name, call=call: results.__setitem__(name, call())
        )
        thread.start()
        threads.append(thread)
        time.sleep(0.3)
    time.sleep(1.0)
    assert results == {}, "a transition did not wait for the run lock"
    transaction.commit()
    holder.close()
    for thread in threads:
        thread.join(30)
    return results


def test_concurrent_reviewers_on_postgres_cannot_both_decide(postgres_client):
    client, sessions, engine = postgres_client
    with sessions() as db:
        run_id = _seed(db)
    _ok(_act(client, run_id, "submit", "owner@example.com"))

    results = _while_run_is_locked(
        engine,
        run_id,
        [
            ("approve", lambda: _act(client, run_id, "approve", "manager@example.com", "yes")),
            ("reject", lambda: _act(client, run_id, "reject", "admin@example.com", "no")),
        ],
    )

    assert [results["approve"].status_code, results["reject"].status_code] == [200, 409]
    assert results["reject"].headers["X-Qym-Run-Status"] == "APPROVED"
    with sessions() as db:
        approval = db.query(Approval).filter_by(run_id=run_id).one()
        assert db.get(Run, run_id).status == RunWorkflowStatus.APPROVED
        assert (approval.decision, approval.comment) == (ApprovalDecision.APPROVED, "yes")
        assert db.query(RunWorkflowEvent).filter_by(run_id=run_id).count() == 2
        assert db.query(AuditLog).filter_by(entity_id=run_id).count() == 2


def test_ingest_queued_behind_a_submission_on_postgres_is_rejected(postgres_client):
    client, sessions, engine = postgres_client
    with sessions() as db:
        run_id = _seed(db)
    late_output = _event(
        run_id, "item_completed", {"item_id": "item-1", "output": "late", "latency_ms": 1}
    )

    results = _while_run_is_locked(
        engine,
        run_id,
        [
            ("submit", lambda: _act(client, run_id, "submit", "owner@example.com")),
            ("ingest", lambda: _post_events(client, run_id, [late_output])),
        ],
    )

    assert results["submit"].status_code == 200
    assert results["ingest"].status_code == 409
    assert results["ingest"].headers["X-Qym-Run-State"] == "in_review"
    with sessions() as db:
        item = db.query(RunItem).filter_by(run_id=run_id, item_id="item-1").one()
        assert item.output == "original output"


def test_stale_decision_conflicts_name_the_action():
    """The 409 detail reaches the UI toast verbatim."""
    from qym_platform.api.runs import _DECISION_PAST

    assert _DECISION_PAST == {
        "approve": "approved",
        "reject": "rejected",
        "unapprove": "unapproved",
        "unreject": "unrejected",
    }


@pytest.mark.parametrize(
    "action, expected",
    [
        ("reject", "Only SUBMITTED runs can be rejected (run is APPROVED)"),
        ("unreject", "Only REJECTED runs can be unrejected (run is APPROVED)"),
        ("approve", "Only SUBMITTED runs can be approved (run is APPROVED)"),
    ],
)
def test_stale_decision_detail_reads_correctly(
    client, session_factory, action, expected
):
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    stale = _act(client, run_id, action, "admin@example.com", "late")
    assert stale.status_code == 409
    assert stale.json()["detail"] == expected


@pytest.mark.parametrize("email", ["outsider@example.com", "owner@example.com"])
@pytest.mark.parametrize("action", ["approve", "reject", "unapprove", "unreject"])
def test_non_reviewers_are_refused_before_learning_the_run_status(
    client, session_factory, email, action
):
    """A user who may not review gets 403 whatever state the run is in."""
    with session_factory() as db:
        run_id = _seed(db)
    response = _act(client, run_id, action, email, "x")
    assert response.status_code == 403, response.text
    assert "X-Qym-Run-Status" not in response.headers
    assert "COMPLETED" not in response.text


# ---------------------------------------------------------------------------
# C012: append-only history and audit rows for every transition
# ---------------------------------------------------------------------------


def test_every_review_transition_is_kept_and_audited(client, session_factory):
    with session_factory() as db:
        run_id = _seed(db)

    steps = [
        ("submit", "owner@example.com", None),
        ("approve", "manager@example.com", "LGTM"),
        ("unapprove", "manager@example.com", "numbers were wrong"),
        ("submit", "owner@example.com", None),
        ("reject", "manager@example.com", "needs work"),
        ("unreject", "admin@example.com", "rejected by mistake"),
    ]
    for action, email, comment in steps:
        _ok(_act(client, run_id, action, email, comment))

    with session_factory() as db:
        approval = db.query(Approval).filter_by(run_id=run_id).one()
        # The last decision stays on the approval row; it is never blanked.
        assert approval.decision == ApprovalDecision.REJECTED
        assert approval.decision_by_user_id == "manager-1"
        assert approval.decision_at is not None
        assert approval.comment == "needs work"

        history = (
            db.query(RunWorkflowEvent)
            .filter_by(run_id=run_id)
            .order_by(RunWorkflowEvent.id)
            .all()
        )
        assert [
            (e.action, e.from_status, e.to_status, e.actor_user_id, e.comment)
            for e in history
        ] == [
            ("submit", "COMPLETED", "SUBMITTED", "owner-1", ""),
            ("approve", "SUBMITTED", "APPROVED", "manager-1", "LGTM"),
            ("unapprove", "APPROVED", "COMPLETED", "manager-1", "numbers were wrong"),
            ("submit", "COMPLETED", "SUBMITTED", "owner-1", ""),
            ("reject", "SUBMITTED", "REJECTED", "manager-1", "needs work"),
            ("unreject", "REJECTED", "COMPLETED", "admin-1", "rejected by mistake"),
        ]

        audits = (
            db.query(AuditLog)
            .filter_by(entity_type="run", entity_id=run_id)
            .order_by(AuditLog.id)
            .all()
        )
        assert [(a.action, a.actor_user_id) for a in audits] == [
            ("run.submitted", "owner-1"),
            ("run.approved", "manager-1"),
            ("run.unapproved", "manager-1"),
            ("run.submitted", "owner-1"),
            ("run.rejected", "manager-1"),
            ("run.unrejected", "admin-1"),
        ]
        assert audits[2].before == {"status": "APPROVED"}
        assert audits[2].after["status"] == "COMPLETED"
        assert audits[2].after["comment"] == "numbers were wrong"
        assert audits[2].after["decision"] == "APPROVED"

    payload = _ok(
        client.get(
            f"/api/runs/{run_id}/review-history", headers=_ui("owner@example.com")
        )
    )
    assert payload["status"] == "COMPLETED"
    assert [
        (e["action"], e["actor"]["display_name"], e["comment"])
        for e in payload["events"]
    ] == [
        ("submit", "Owner", ""),
        ("approve", "Maya Manager", "LGTM"),
        ("unapprove", "Maya Manager", "numbers were wrong"),
        ("submit", "Owner", ""),
        ("reject", "Maya Manager", "needs work"),
        ("unreject", "admin", "rejected by mistake"),
    ]
    assert all(e["recorded"] and e["at"].endswith("Z") for e in payload["events"])


def test_withdrawal_without_a_body_still_works(client, session_factory):
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id)
    response = client.post(
        f"/v1/runs/{run_id}/unapprove", headers=_ui("manager@example.com")
    )
    assert _ok(response)["status"] == "COMPLETED"


def test_review_history_reconstructs_pre_history_reviews_and_checks_access(
    client, session_factory
):
    with session_factory() as db:
        run_id = _seed(db, status=RunWorkflowStatus.APPROVED)
        db.add(
            Approval(
                run_id=run_id,
                submitted_by_user_id="owner-1",
                submitted_at=ENDED_AT,
                decision=ApprovalDecision.APPROVED,
                decision_by_user_id="manager-1",
                decision_at=ENDED_AT + timedelta(hours=1),
                comment="ship it",
            )
        )
        db.commit()

    payload = _ok(
        client.get(
            f"/api/runs/{run_id}/review-history", headers=_ui("owner@example.com")
        )
    )
    assert [
        (e["action"], e["to_status"], e["comment"], e["recorded"])
        for e in payload["events"]
    ] == [
        ("submit", "SUBMITTED", "", False),
        ("approve", "APPROVED", "ship it", False),
    ]
    assert payload["events"][1]["actor"]["id"] == "manager-1"

    denied = client.get(
        f"/api/runs/{run_id}/review-history", headers=_ui("outsider@example.com")
    )
    assert denied.status_code == 403
    missing = client.get(
        f"/api/runs/{uuid4()}/review-history", headers=_ui("owner@example.com")
    )
    assert missing.status_code == 404


@pytest.mark.parametrize("legacy_status", ["APPROVED", "SUBMITTED"])
def test_history_of_a_pre_upgrade_review_keeps_its_start(
    client, session_factory, legacy_status
):
    """A review begun before 0060 and finished after it shows both parts."""
    with session_factory() as db:
        run_id = _seed(db, status=RunWorkflowStatus(legacy_status))
        approved = legacy_status == "APPROVED"
        db.add(
            Approval(
                run_id=run_id,
                submitted_by_user_id="owner-1",
                submitted_at=ENDED_AT,
                decision=ApprovalDecision.APPROVED if approved else None,
                decision_by_user_id="manager-1" if approved else None,
                decision_at=ENDED_AT + timedelta(hours=1) if approved else None,
                comment="legacy approval" if approved else "",
            )
        )
        db.commit()

    action = "unapprove" if legacy_status == "APPROVED" else "approve"
    _ok(_act(client, run_id, action, "manager@example.com", "after upgrade"))

    payload = _ok(
        client.get(
            f"/api/runs/{run_id}/review-history", headers=_ui("owner@example.com")
        )
    )
    expected = [("submit", "", False)]
    if legacy_status == "APPROVED":
        expected.append(("approve", "legacy approval", False))
    expected.append((action, "after upgrade", True))
    assert [
        (e["action"], e["comment"], e["recorded"]) for e in payload["events"]
    ] == expected


def test_a_pre_upgrade_rejection_survives_resubmission_and_the_next_decision(
    client, session_factory
):
    """Resubmitting rewrites the approval row; the old review stays in history."""
    with session_factory() as db:
        run_id = _seed(db, status=RunWorkflowStatus.REJECTED)
        db.add(
            Approval(
                run_id=run_id,
                submitted_by_user_id="owner-1",
                submitted_at=ENDED_AT,
                decision=ApprovalDecision.REJECTED,
                decision_by_user_id="manager-1",
                decision_at=ENDED_AT + timedelta(hours=1),
                comment="legacy: numbers look off",
            )
        )
        db.commit()

    _ok(_act(client, run_id, "submit", "owner@example.com"))
    _ok(_act(client, run_id, "approve", "manager@example.com", "fixed now"))

    payload = _ok(
        client.get(
            f"/api/runs/{run_id}/review-history", headers=_ui("owner@example.com")
        )
    )
    assert [
        (e["action"], e["from_status"], e["comment"], e["recorded"])
        for e in payload["events"]
    ] == [
        ("submit", None, "", False),
        ("reject", "SUBMITTED", "legacy: numbers look off", False),
        ("submit", "REJECTED", "", True),
        ("approve", "SUBMITTED", "fixed now", True),
    ]
    legacy_reject = payload["events"][1]
    assert legacy_reject["actor"]["id"] == "manager-1"
    assert legacy_reject["at"].startswith("2026-09-01T13:00:00")
    with session_factory() as db:
        rows = (
            db.query(RunWorkflowEvent)
            .filter_by(run_id=run_id)
            .order_by(RunWorkflowEvent.id)
            .all()
        )
        assert [row.reconstructed for row in rows] == [True, True, False, False]
        # Copied once: later transitions do not copy the (rewritten) row again.
        _ok(_act(client, run_id, "unapprove", "manager@example.com"))
        assert db.query(RunWorkflowEvent).filter_by(run_id=run_id).count() == 5


def test_runs_list_keeps_the_last_decision_for_a_withdrawn_review(
    client, session_factory
):
    with session_factory() as db:
        run_id = _seed(db)
    _approve(client, run_id, "LGTM")
    _ok(_act(client, run_id, "unapprove", "manager@example.com"))

    payload = _ok(
        client.get("/api/runs?project_slug=project", headers=_ui("owner@example.com"))
    )
    runs = [
        run
        for models in payload["tasks"].values()
        for items in models.values()
        for run in items
    ]
    assert [run["status"] for run in runs] == ["COMPLETED"]
    # The UI attributes the status to a reviewer only while decision == status.
    assert runs[0]["approval"]["decision"] == "APPROVED"
    assert runs[0]["approval"]["comment"] == "LGTM"


# ---------------------------------------------------------------------------
# C020: the Deleted Runs page reports the retention purge
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("grace_days", [30, 0])
def test_trash_reports_each_runs_purge_date(
    client, session_factory, monkeypatch, grace_days
):
    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", str(grace_days))
    with session_factory() as db:
        run_id = _seed(db)

    deleted = _ok(
        client.post(
            "/api/runs/delete",
            headers=_ui("owner@example.com"),
            json={"file_path": run_id},
        )
    )
    assert deleted["purge_after_days"] == grace_days

    response = client.get("/api/runs/trash", headers=_ui("admin@example.com"))
    assert response.status_code == 200
    assert response.headers["X-Qym-Deleted-Run-Grace-Days"] == str(grace_days)
    [row] = response.json()
    with session_factory() as db:
        deleted_at = db.get(Run, run_id).deleted_at
    if grace_days:
        expected = (deleted_at + timedelta(days=grace_days)).isoformat()
        assert row["purge_at"].rstrip("Z").startswith(expected[:19])
    else:
        assert row["purge_at"] is None


@pytest.mark.parametrize("grace_days", [30, 0])
def test_capped_trash_list_keeps_the_runs_closest_to_purge(
    client, session_factory, monkeypatch, grace_days
):
    """With more deleted runs than the list shows, none near purge is hidden."""
    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", str(grace_days))
    with session_factory() as db:
        template_id = _seed(db)
        template = db.get(Run, template_id)
        now = utc_now_naive()
        for index in range(201):
            db.add(
                Run(
                    id=f"deleted-{index:03d}",
                    project_id=template.project_id,
                    created_by_user_id=template.owner_user_id,
                    owner_user_id=template.owner_user_id,
                    task="task",
                    dataset="dataset",
                    metrics=[],
                    run_metadata={},
                    run_config={},
                    status=RunWorkflowStatus.COMPLETED,
                    # deleted-000 is the oldest deletion, so the first purged.
                    deleted_at=now - timedelta(days=29, minutes=201 - index),
                )
            )
        db.commit()

    response = client.get("/api/runs/trash", headers=_ui("admin@example.com"))
    ids = [row["id"] for row in _ok(response)]
    assert len(ids) == 200
    if grace_days:
        assert ids[0] == "deleted-000"
        assert "deleted-200" not in ids
    else:
        assert ids[0] == "deleted-200"
        assert "deleted-000" not in ids


def test_purge_due_at_matches_the_purge_cutoff():
    from qym_platform.services.retention import purge_due_at

    deleted_at = datetime(2026, 9, 2, 16, 35, 43)
    assert purge_due_at(deleted_at, 30) == datetime(2026, 10, 2, 16, 35, 43)
    assert purge_due_at(deleted_at, 0) is None
    assert purge_due_at(None, 30) is None


def test_trash_page_no_longer_promises_runs_stay_until_restored():
    page = (
        ROOT / "packages/platform/qym_platform/_static/dashboard/trash.html"
    ).read_text(encoding="utf-8")
    assert "remain here until restored" not in page
    assert "X-Qym-Deleted-Run-Grace-Days" in page
    assert "<th>Purges</th>" in page


def test_run_page_shows_history_and_runs_list_credits_only_decisions_in_effect():
    static = ROOT / "packages/platform/qym_platform/_static/dashboard"
    run_html = (static / "run.html").read_text(encoding="utf-8")
    dashboard_js = (static / "dashboard.js").read_text(encoding="utf-8")
    assert '<script src="/static/review_history.js?v=' in run_html
    assert '<div id="review-history-section"></div>' in run_html
    assert "window.QymReviewHistory.load(" in run_html
    # A withdrawn decision stays on the approval row; the status tooltip must
    # not credit it to the reviewer once the run has moved on.
    assert "approval.decision_by && approval.decision === status" in dashboard_js
    assert "return the run to completed" not in dashboard_js
    assert "Run returned to ${restored}" in dashboard_js


def test_review_history_migration_is_quick_ddl_and_reversible(monkeypatch):
    import importlib.util

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = (
        ROOT
        / "packages/platform/qym_platform/migrations/versions/0062_run_review_history.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0060", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert (migration.revision, migration.down_revision) == ("0062", "0061")

    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("users", metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table("runs", metadata, sa.Column("id", sa.String(36), primary_key=True))
    approvals = sa.Table(
        "approvals",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("run_id", sa.String(36)),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(approvals.insert().values(id=1, run_id="legacy"))
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        inspector = sa.inspect(connection)
        columns = {c["name"]: c for c in inspector.get_columns("approvals")}
        assert columns["execution_status"]["nullable"] is True
        # Existing reviews are left NULL and resolved lazily on withdrawal.
        assert (
            connection.execute(
                sa.text("SELECT execution_status FROM approvals")
            ).scalar()
            is None
        )
        assert {c["name"] for c in inspector.get_columns("run_workflow_events")} == {
            "id",
            "run_id",
            "action",
            "from_status",
            "to_status",
            "actor_user_id",
            "comment",
            "created_at",
            "reconstructed",
        }
        assert [
            fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("run_workflow_events")
            if fk["referred_table"] == "runs"
        ] == ["CASCADE"]
        migration.downgrade()
        inspector = sa.inspect(connection)
        assert "run_workflow_events" not in inspector.get_table_names()
        assert "execution_status" not in {
            c["name"] for c in inspector.get_columns("approvals")
        }
    engine.dispose()


# ---------------------------------------------------------------------------
# C012: Reviews-page decisions on diagnoses are audited too
# ---------------------------------------------------------------------------


def test_reviews_page_decisions_are_audited(db_session):  # noqa: F811
    from copy import deepcopy

    from qym_platform.api import analysis as analysis_api
    from qym_platform.auth import Principal
    from qym_platform.services.root_cause_changes import replace_metric_review_candidate

    actor, run, item = _seed_run(db_session)
    actor.role = UserRole.ADMIN
    analysis = {
        "root_cause_issues": deepcopy(ISSUES),
        "root_cause": ISSUES[0]["category"],
        "source": "ai",
    }
    item.item_metadata = {"metric_analyses": {"accuracy": analysis}}
    db_session.commit()
    candidate = replace_metric_review_candidate(
        db_session,
        run=run,
        item=item,
        metric_name="accuracy",
        analysis=analysis,
        actor_user_id=None,
        actor_source="ai",
    )
    db_session.commit()
    principal = Principal(user=actor, auth_type="proxy_headers")

    analysis_api.approve_correction(
        candidate.id, {"comment": "matches"}, db=db_session, principal=principal
    )
    analysis_api.reset_correction(candidate.id, db=db_session, principal=principal)
    analysis_api.reject_correction(
        candidate.id, {"comment": "wrong cause"}, db=db_session, principal=principal
    )
    analysis_api.bulk_correction_action(
        analysis_api.BulkActionRequest(ids=[candidate.id], action="reset"),
        db=db_session,
        principal=principal,
    )
    analysis_api.delete_correction(candidate.id, db=db_session, principal=principal)

    audits = (
        db_session.query(AuditLog)
        .filter_by(entity_type="review_correction", entity_id=str(candidate.id))
        .order_by(AuditLog.id)
        .all()
    )
    assert [a.action for a in audits] == [
        "correction.approved",
        "correction.reset",
        "correction.rejected",
        "correction.reset",
        "correction.deleted",
    ]
    assert {a.actor_user_id for a in audits} == {actor.id}
    # Reset clears the reviewer on the row; the audit keeps what was cleared.
    reset = audits[1]
    assert (
        reset.before["status"],
        reset.before["review_comment"],
        reset.before["reviewed_by_user_id"],
    ) == ("approved", "matches", actor.id)
    assert (reset.after["status"], reset.after["reviewed_by_user_id"]) == (
        "pending",
        None,
    )
    assert audits[2].after["review_comment"] == "wrong cause"
    assert (audits[4].after["status"], audits[4].after["is_active"]) == (
        "rejected",
        False,
    )
