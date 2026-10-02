"""Two reviewers deciding the same correction at once (Postgres row locks).

Approve, reject and reset lock the correction row (SELECT ... FOR UPDATE) and
check its status again after the lock. When another reviewer's decision is
committed while the request waits, the request reads that decision and answers
409 instead of overwriting it. Only Postgres has these row locks, so the tests
need QYM_TEST_POSTGRES_URL.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app  # noqa: E402
from qym_platform.db.base import Base  # noqa: E402
from qym_platform.db.models import (  # noqa: E402
    CorrectionStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db  # noqa: E402

HEADERS = {"X-User-Email": "reviewer@example.com", "Origin": "http://localhost:8000"}
DECIDED_AT = datetime(2026, 9, 2)


@pytest.fixture()
def pg(monkeypatch):
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    schema = "correction_race_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        with sessions() as db:
            db.add_all(
                [
                    User(id="reviewer-1", email="reviewer@example.com", role=UserRole.MEMBER),
                    User(id="other-1", email="other@example.com", role=UserRole.MEMBER),
                ]
            )
            db.flush()
            db.add(Project(id="p1", name="P", slug="p", created_by_user_id="reviewer-1"))
            db.flush()
            db.add(ProjectMembership(project_id="p1", user_id="reviewer-1", role=ProjectRole.MANAGER))
            db.add(ProjectMembership(project_id="p1", user_id="other-1", role=ProjectRole.MANAGER))
            for run_id in ("r1", "r2"):
                db.add(
                    Run(
                        id=run_id, project_id="p1", created_by_user_id="reviewer-1",
                        owner_user_id="reviewer-1", task="t", dataset="d", metrics=["accuracy"],
                        run_metadata={}, run_config={}, status=RunWorkflowStatus.COMPLETED,
                    )
                )
                db.flush()
                db.add(RunItem(run_id=run_id, item_id="item-1", index=0, input={"q": 1}, output="o", item_metadata={}))
                db.add(RunItemScore(run_id=run_id, item_id="item-1", metric_name="accuracy", score_numeric=0.0, score_raw=0.0, meta={}))
            db.commit()
        app = create_app()

        def override_get_db():
            db = sessions()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        with TestClient(app) as client:
            yield client, sessions, engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _correction(sessions, run_id, *, metadata=None):
    with sessions() as db:
        if metadata is not None:
            db.query(RunItem).filter_by(run_id=run_id).one().item_metadata = metadata
        row = ReviewCorrection(
            run_id=run_id, item_id="item-1", metric_name=None, task="t", ai_root_cause="",
            human_root_cause="Retrieval miss", human_root_causes=["Retrieval miss"],
            corrected_by_user_id="other-1", is_active=True, status=CorrectionStatus.PENDING,
            created_at=datetime(2026, 9, 1),
        )
        db.add(row)
        db.commit()
        return row.id


def _waiting_on_a_lock(engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE wait_event_type = 'Lock' AND datname = current_database()"
                )
            ).scalar()
        )


def _race(client, sessions, engine, correction_ids, request):
    """Another reviewer approves the corrections and holds the row locks
    while ``request`` runs; it commits once the request waits on them."""
    other = sessions()
    for correction_id in correction_ids:
        row = (
            other.query(ReviewCorrection)
            .filter_by(id=correction_id)
            .with_for_update()
            .one()
        )
        row.status = CorrectionStatus.APPROVED
        row.reviewed_by_user_id = "other-1"
        row.reviewed_at = DECIDED_AT
    other.flush()
    results = {}

    def send():
        method, path, body = request
        results["response"] = client.request(method, path, json=body, headers=HEADERS)

    worker = threading.Thread(target=send)
    worker.start()
    deadline = time.time() + 10
    while not _waiting_on_a_lock(engine) and time.time() < deadline:
        time.sleep(0.05)
    other.commit()
    other.close()
    worker.join(30)
    return results["response"]


def _state(sessions, correction_id):
    with sessions() as db:
        row = db.get(ReviewCorrection, correction_id)
        return row.status, row.reviewed_by_user_id


def test_single_approve_reads_the_decision_committed_while_it_waited(pg):
    client, sessions, engine = pg
    cid = _correction(sessions, "r1")
    response = _race(client, sessions, engine, [cid], ("POST", f"/api/corrections/{cid}/approve", {}))
    assert response.status_code == 409, response.text
    assert "This correction is approved" in response.json()["detail"]
    assert _state(sessions, cid) == (CorrectionStatus.APPROVED, "other-1")


def test_bulk_reject_reads_the_decisions_committed_while_it_waited(pg):
    client, sessions, engine = pg
    first = _correction(sessions, "r1")
    second = _correction(sessions, "r2")
    response = _race(
        client, sessions, engine, [second],
        ("POST", "/api/corrections/bulk", {"ids": [first, second], "action": "reject", "expected_count": 2}),
    )
    assert response.status_code == 409, response.text
    assert "1 of the 2 selected corrections are not pending" in response.json()["detail"]
    assert _state(sessions, first) == (CorrectionStatus.PENDING, None)
    assert _state(sessions, second) == (CorrectionStatus.APPROVED, "other-1")


def test_run_page_issue_approval_reads_the_decision_committed_while_it_waited(pg):
    client, sessions, engine = pg
    issues = [
        {"category": "Agent behavior", "subcategory": "Retrieval omission", "finding": "Missed a status."},
        {"category": "Agent behavior", "subcategory": "Predicate", "finding": "OR instead of AND."},
    ]
    with sessions() as db:
        db.query(RunItem).filter_by(run_id="r1").one().item_metadata = {
            "metric_analyses": {"accuracy": {"root_cause_issues": issues, "root_cause": "Agent behavior", "source": "ai"}}
        }
        db.commit()
    base = {"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy", "issue_index": 0}
    # Saving the first issue unchanged splits the diagnosis into issue rows.
    split = client.post(
        "/api/runs/update_root_cause_issue",
        json={**base, "action": "edit", "expected_issue": issues[0], "issue": issues[0]},
        headers=HEADERS,
    )
    assert split.status_code == 200, split.text
    with sessions() as db:
        saved = db.query(RunItem).filter_by(run_id="r1").one().item_metadata["metric_analyses"]["accuracy"]
        first_issue = saved["root_cause_issues"][0]
        rows = db.query(ReviewCorrection).filter_by(run_id="r1", is_active=True).order_by(ReviewCorrection.id).all()
        target = rows[0].id
    response = _race(
        client, sessions, engine, [target],
        (
            "POST",
            "/api/runs/update_root_cause_issue",
            {**base, "action": "approve", "issue_id": first_issue["issue_id"], "expected_issue": first_issue},
        ),
    )
    assert response.status_code == 409, response.text
    assert "This issue is approved" in response.json()["detail"]
    assert _state(sessions, target) == (CorrectionStatus.APPROVED, "other-1")
