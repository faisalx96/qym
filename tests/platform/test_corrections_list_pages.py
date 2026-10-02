"""GET /api/corrections is a bounded, paged list of summary rows (C030, C063).

The list pages by cursor (default 50 rows) in the chosen order, carries no
revision history and only short snapshot previews (the detail endpoint keeps
both), and answers the status strip, the filtered total and every facet from
one grouped read. Bulk actions can name how many corrections the reviewer saw
so a stale selection is refused (C042).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    CorrectionStatus,
    Project,
    ReviewCorrection,
    Run,
    RunItem,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.testing.query_budget import record_queries

BASE_TIME = datetime(2026, 9, 1, 12, 0, 0)
LONG_TEXT = "SELECT " + ", ".join(f"column_{index}" for index in range(400))


@pytest.fixture(params=["sqlite", "postgres"])
def env(monkeypatch, request):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    schema = None
    if request.param == "postgres":
        # The grouped facet read, the JSON run-name expression and the keyset
        # comparisons also run on Postgres (production).
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "corrections_pages_" + uuid4().hex
        with create_engine(url).begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add(
            User(id="dev", email="dev@local", display_name="Dev", role=UserRole.ADMIN)
        )
        db.flush()
        db.add(Project(id="p1", name="Demo", slug="demo", created_by_user_id="dev"))
        db.flush()
        runs = [
            ("r-sql", "text2sql", "golden", "openai/gpt-4o", "SQL run"),
            ("r-router", "router", "routing", "acme/gptx4o", "Router run"),
            ("r-other", "text2sql", "golden", "anthropic/claude", "Other run"),
        ]
        for run_id, task, dataset, model, name in runs:
            db.add(
                Run(
                    id=run_id,
                    project_id="p1",
                    created_by_user_id="dev",
                    owner_user_id="dev",
                    task=task,
                    dataset=dataset,
                    model=model,
                    metrics=["accuracy"],
                    run_metadata={},
                    run_config={"run_name": name},
                    status=RunWorkflowStatus.COMPLETED,
                    created_at=BASE_TIME,
                )
            )
        db.flush()
        statuses = [CorrectionStatus.PENDING] * 4 + [
            CorrectionStatus.APPROVED,
            CorrectionStatus.REJECTED,
        ]
        index = 0
        for run_id, task, _dataset, _model, _name in runs:
            for status in statuses:
                item_id = f"{run_id}-item-{index}"
                db.add(
                    RunItem(
                        run_id=run_id, item_id=item_id, index=index, input={"q": index}
                    )
                )
                confidence = (
                    None if index % 7 == 0 else round(0.05 + (index * 37 % 90) / 100, 2)
                )
                db.add(
                    ReviewCorrection(
                        run_id=run_id,
                        item_id=item_id,
                        metric_name="accuracy",
                        task=task,
                        input_snapshot={
                            "question": f"Question {index}",
                            "context": LONG_TEXT,
                        },
                        expected_snapshot={"sql": LONG_TEXT},
                        output_snapshot={"sql": LONG_TEXT, "note": "x" * 2000},
                        scores_snapshot={"accuracy": 0.1},
                        ai_root_cause="Wrong join",
                        human_root_cause="Wrong join",
                        ai_confidence=confidence,
                        is_active=True,
                        status=status,
                        corrected_by_user_id="dev",
                        # Two rows share each timestamp so the id tiebreak matters.
                        created_at=BASE_TIME + timedelta(minutes=index // 2),
                    )
                )
                # A superseded candidate of the same item is revision history.
                db.add(
                    ReviewCorrection(
                        run_id=run_id,
                        item_id=item_id,
                        metric_name="accuracy",
                        task=task,
                        input_snapshot={"question": "old " * 500},
                        output_snapshot={"sql": LONG_TEXT},
                        scores_snapshot={},
                        ai_root_cause="Old",
                        human_root_cause="Old",
                        is_active=False,
                        status=CorrectionStatus.REJECTED,
                        created_at=BASE_TIME - timedelta(days=1),
                    )
                )
                index += 1
        db.commit()

    app = create_app()

    def session():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = session
    with TestClient(app) as client:
        yield client, make, engine
    engine.dispose()
    if schema:
        with create_engine(os.environ["QYM_TEST_POSTGRES_URL"]).begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def _get(client, **params):
    response = client.get("/api/corrections", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _all_pages(client, **params):
    rows, cursor, pages = [], None, 0
    while True:
        query = dict(params)
        if cursor:
            query["cursor"] = cursor
        payload = _get(client, **query)
        rows.extend(payload["corrections"])
        pages += 1
        if not payload["has_more"]:
            assert payload["next_cursor"] is None
            return rows, pages
        cursor = payload["next_cursor"]
        assert cursor


def test_default_page_is_bounded_and_rows_are_summaries(env):
    client, make, _ = env
    with make() as db:
        extra_run = db.get(Run, "r-sql")
        for index in range(60):
            db.add(
                ReviewCorrection(
                    run_id=extra_run.id,
                    item_id=f"bulk-{index}",
                    metric_name="accuracy",
                    task="text2sql",
                    input_snapshot={"question": LONG_TEXT},
                    ai_root_cause="Wrong join",
                    human_root_cause="Wrong join",
                    is_active=True,
                    status=CorrectionStatus.PENDING,
                    created_at=BASE_TIME + timedelta(days=1, minutes=index),
                )
            )
        db.commit()

    payload = _get(client, project_slug="demo")
    assert len(payload["corrections"]) == 50
    assert payload["limit"] == 50
    assert payload["has_more"] is True
    assert payload["total"] == 78
    row = payload["corrections"][0]
    assert "history" not in row
    for field in ("input", "expected", "output"):
        assert f"{field}_snapshot" not in row
    assert len(row["input_preview"]) <= 280
    assert row["input_preview"].endswith("…")
    # One page stays small however long the snapshots and histories are.
    assert len(json.dumps(payload)) < 100_000

    detail = client.get(f"/api/corrections/{row['id']}").json()
    assert detail["input_snapshot"]["question"] == LONG_TEXT
    assert isinstance(detail["history"], list)


def test_previews_read_as_short_text(env):
    client, _make, _ = env
    row = next(
        item
        for item in _get(client, sort="oldest", limit=50)["corrections"]
        if item["item_id"] == "r-sql-item-1"
    )
    assert row["input_preview"].startswith("question: Question 1 · context: SELECT")
    assert row["expected_preview"].startswith("sql: SELECT column_0, column_1")


@pytest.mark.parametrize("sort", ["newest", "oldest", "confidence"])
def test_cursor_pages_cover_every_row_once_in_order(env, sort):
    client, _make, _ = env
    rows, pages = _all_pages(client, sort=sort, limit=4)
    assert pages == 5
    ids = [row["id"] for row in rows]
    assert len(ids) == 18 == len(set(ids))
    if sort == "newest":
        keys = [(row["created_at"], row["id"]) for row in rows]
        assert keys == sorted(keys, reverse=True)
    elif sort == "oldest":
        keys = [(row["created_at"], row["id"]) for row in rows]
        assert keys == sorted(keys)
    else:
        keys = [
            (
                2.0 if row["ai_confidence"] is None else row["ai_confidence"],
                row["created_at"],
                row["id"],
            )
            for row in rows
        ]
        assert keys == sorted(keys)
        assert rows[-1]["ai_confidence"] is None


def test_pending_queue_pages_by_status(env):
    client, _make, _ = env
    rows, _pages = _all_pages(client, status="pending", sort="oldest", limit=5)
    assert len(rows) == 12
    assert {row["status"] for row in rows} == {"pending"}


def test_cursor_and_sort_are_validated(env):
    client, _make, _ = env
    assert (
        client.get("/api/corrections", params={"cursor": "not-a-cursor"}).status_code
        == 400
    )
    assert (
        client.get("/api/corrections", params={"sort": "priority"}).status_code == 400
    )
    newest_cursor = _get(client, sort="newest", limit=2)["next_cursor"]
    mismatch = client.get(
        "/api/corrections", params={"sort": "oldest", "cursor": newest_cursor}
    )
    assert mismatch.status_code == 400


def test_counts_and_facets_follow_each_filter(env):
    client, _make, _ = env
    everything = _get(client)
    assert everything["stats"] == {
        "total": 18,
        "pending": 12,
        "approved": 3,
        "rejected": 3,
    }
    assert everything["facet_counts"]["task"] == {"text2sql": 12, "router": 6}
    assert everything["facet_counts"]["model"] == {
        "gpt-4o": 6,
        "gptx4o": 6,
        "claude": 6,
    }
    assert everything["facet_counts"]["run_name"] == {
        "SQL run": 6,
        "Router run": 6,
        "Other run": 6,
    }
    assert everything["tasks"] == ["router", "text2sql"]
    assert everything["models"] == ["claude", "gpt-4o", "gptx4o"]

    pending_sql = _get(client, status="pending", task=["text2sql"], model=["gpt-4o"])
    # The status strip ignores the status filter; the total honours it.
    assert pending_sql["stats"] == {
        "total": 6,
        "pending": 4,
        "approved": 1,
        "rejected": 1,
    }
    assert pending_sql["total"] == 4
    assert len(pending_sql["corrections"]) == 4
    # Each facet leaves out its own filter and keeps the others.
    assert pending_sql["facet_counts"]["task"] == {"text2sql": 4}
    assert pending_sql["facet_counts"]["model"] == {"gpt-4o": 4, "claude": 4}
    assert pending_sql["facet_counts"]["dataset"] == {"golden": 4}
    assert pending_sql["facet_counts"]["run_name"] == {"SQL run": 4}

    by_run = _get(client, run_name=["Router run"], status="approved")
    assert by_run["total"] == 1
    assert by_run["stats"]["total"] == 6


def test_model_filter_matches_literally(env):
    client, _make, _ = env
    # "_" is a LIKE wildcard: unescaped, "gpt_4o" matched "openai/gpt-4o".
    assert _get(client, model=["gpt_4o"])["total"] == 0
    assert _get(client, model=["gpt-4o"])["total"] == 6
    assert _get(client, model=["acme/gptx4o"])["total"] == 6


def test_list_reads_stay_bounded(env):
    client, _make, engine = env
    with record_queries(engine) as log:
        _get(client, project_slug="demo", status="pending", task=["text2sql"])
    # Was ~16 statements (total, 4 status counts, 4 DISTINCT lists, 4 facet
    # group-bys, page, ...) plus history reads for every row.
    review_reads = log.touching("review_corrections")
    assert len(review_reads) <= 3, log.summary()
    assert not log.touching("root_cause_revisions"), log.summary()


def test_bulk_refuses_a_stale_selection(env):
    client, make, _ = env
    pending = _get(client, status="pending", sort="oldest", limit=3)["corrections"]
    ids = [row["id"] for row in pending]
    with make() as db:
        gone = db.get(ReviewCorrection, ids[0])
        gone.is_active = False
        db.commit()

    refused = client.post(
        "/api/corrections/bulk",
        json={"ids": ids, "action": "approve", "expected_count": len(ids)},
    )
    assert refused.status_code == 409
    assert "2 of the 3 selected corrections" in refused.json()["detail"]

    accepted = client.post(
        "/api/corrections/bulk",
        json={"ids": ids[1:], "action": "approve", "expected_count": 2},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["affected"] == 2
    # Without expected_count the call keeps its old contract (the two now
    # approved rows can be reset; the inactive one is left out).
    legacy = client.post("/api/corrections/bulk", json={"ids": ids, "action": "reset"})
    assert legacy.status_code == 200
    assert legacy.json()["affected"] == 2


def test_bulk_refuses_rows_that_left_the_tab(env):
    client, make, _ = env
    pending = _get(client, status="pending", sort="oldest", limit=3)["corrections"]
    ids = [row["id"] for row in pending]
    with make() as db:
        # Another reviewer approved one of them after the list loaded.
        db.get(ReviewCorrection, ids[0]).status = CorrectionStatus.APPROVED
        db.commit()

    refused = client.post(
        "/api/corrections/bulk",
        json={
            "ids": ids,
            "action": "reject",
            "expected_count": 3,
            "expected_status": "pending",
        },
    )
    assert refused.status_code == 409
    assert "1 of the 3 selected corrections are no longer pending" in (
        refused.json()["detail"]
    )
    with make() as db:
        assert db.get(ReviewCorrection, ids[1]).status == CorrectionStatus.PENDING

    bad = client.post(
        "/api/corrections/bulk",
        json={"ids": ids, "action": "reject", "expected_status": "later"},
    )
    assert bad.status_code == 400

    accepted = client.post(
        "/api/corrections/bulk",
        json={"ids": ids[1:], "action": "reject", "expected_status": "pending"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["affected"] == 2
