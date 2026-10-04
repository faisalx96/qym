"""An analysis save and a reviewer's diagnosis edit must not deadlock (C005).

The save takes the run lock and then the item locks. The editor locks the item
and then inserts rows that reference the run, which needs FOR KEY SHARE on the
run row. With a plain FOR UPDATE run lock that ordering deadlocked on Postgres
and one side lost its work (the save lost paid model output). Only Postgres
has these row locks, so the tests need QYM_TEST_POSTGRES_URL.
"""

from __future__ import annotations

import os
import sys
import threading
import time
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

from qym_platform.api import analysis as analysis_api  # noqa: E402
from qym_platform.app import create_app  # noqa: E402
from qym_platform.auth import Principal  # noqa: E402
from qym_platform.db.base import Base  # noqa: E402
from qym_platform.db.models import (  # noqa: E402
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db  # noqa: E402
from qym_platform.services import issue_reviews  # noqa: E402
from qym_platform.services.llm_analyzer import AnalysisResult  # noqa: E402

RUN = "run-lock-order"


@pytest.fixture()
def pg(monkeypatch):
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    schema = "analysis_lock_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        with sessions() as db:
            owner = User(id="owner-1", email="owner@example.com", role=UserRole.MEMBER)
            db.add(owner)
            db.flush()
            db.add(Project(id="p1", name="P", slug="p", created_by_user_id=owner.id))
            db.flush()
            db.add(
                ProjectMembership(
                    project_id="p1", user_id=owner.id, role=ProjectRole.MANAGER
                )
            )
            db.add(
                Run(
                    id=RUN,
                    project_id="p1",
                    created_by_user_id=owner.id,
                    owner_user_id=owner.id,
                    task="t",
                    dataset="d",
                    metrics=["accuracy"],
                    run_metadata={},
                    run_config={},
                    status=RunWorkflowStatus.COMPLETED,
                )
            )
            db.flush()
            db.add(
                RunItem(
                    run_id=RUN,
                    item_id="item-1",
                    index=0,
                    input={"q": 1},
                    output="o",
                    item_metadata={},
                )
            )
            db.add(
                RunItemScore(
                    run_id=RUN,
                    item_id="item-1",
                    metric_name="accuracy",
                    score_numeric=0.0,
                    score_raw=0.0,
                    meta={},
                )
            )
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
            yield client, sessions
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _edit(client, results):
    started = time.time()
    response = client.post(
        "/api/runs/update_root_cause_issue",
        json={
            "run_id": RUN,
            "item_id": "item-1",
            "metric_name": "accuracy",
            "action": "add",
            "issue": {"category": "Hallucination", "finding": "made up"},
        },
        headers={"X-User-Email": "owner@example.com", "Origin": "http://localhost:8000"},
    )
    results["edit"] = (response.status_code, response.text[:200], time.time() - started)


def _save(sessions, results):
    db = sessions()
    try:
        run = db.get(Run, RUN)
        item = db.query(RunItem).filter_by(run_id=RUN, item_id="item-1").one()
        principal = Principal(user=db.get(User, "owner-1"), auth_type="proxy_headers")
        result = AnalysisResult(
            item_id="item-1",
            metric_name="accuracy",
            root_cause="Formatting",
            root_cause_note="n",
            confidence=0.9,
        )
        analysis_api._save_analysis_results(
            db, run, [(item, "accuracy")], [result], principal
        )
        db.commit()
        results["save"] = "saved"
    except Exception as exc:  # pragma: no cover - the failure being guarded
        db.rollback()
        results["save"] = f"{type(exc).__name__}: {getattr(exc, 'orig', exc)}"
    finally:
        db.close()


def test_edit_holding_the_item_lock_does_not_deadlock_the_save(pg, monkeypatch):
    client, sessions = pg
    holds_item = threading.Event()
    resume = threading.Event()
    real_sync = issue_reviews.sync_issue_candidates

    def paused_sync(*args, **kwargs):
        # Runs inside the editor's transaction, after lock_run_item.
        if not holds_item.is_set():
            holds_item.set()
            resume.wait(10)
        return real_sync(*args, **kwargs)

    monkeypatch.setattr(issue_reviews, "sync_issue_candidates", paused_sync)
    results = {}
    edit = threading.Thread(target=_edit, args=(client, results))
    edit.start()
    assert holds_item.wait(10)
    save = threading.Thread(target=_save, args=(sessions, results))
    save.start()
    time.sleep(0.5)  # the save now holds the run lock and waits for the item
    resume.set()
    edit.join(30)
    save.join(30)

    assert results["edit"][0] == 200, results
    assert results["save"] == "saved", results


def test_save_holding_the_run_lock_does_not_deadlock_the_edit(pg, monkeypatch):
    client, sessions = pg
    holds_run = threading.Event()
    resume = threading.Event()
    real_lock = analysis_api._lock_run_for_save

    def paused_lock(db, run):
        locked = real_lock(db, run)
        if not holds_run.is_set():
            holds_run.set()
            resume.wait(10)
        return locked

    monkeypatch.setattr(analysis_api, "_lock_run_for_save", paused_lock)
    results = {}
    save = threading.Thread(target=_save, args=(sessions, results))
    save.start()
    assert holds_run.wait(10)
    edit = threading.Thread(target=_edit, args=(client, results))
    edit.start()
    time.sleep(0.5)  # the edit now holds the item lock and inserts its rows
    resume.set()
    save.join(30)
    edit.join(30)

    assert results["edit"][0] == 200, results
    assert results["save"] == "saved", results
