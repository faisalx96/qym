"""List endpoint at 5,000 requests: constant statement count, no N+1, drafts limited to the caller (QE-160)."""

from __future__ import annotations

import time
from datetime import datetime

import pytest
from sqlalchemy import event

from _feedback_support import make_env


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch):
    with make_env(monkeypatch, request.param) as e:
        yield e


def fill(env, count, offset=0):
    from qym_platform.db.feedback_models import FeedbackRequest
    from qym_platform.feedback_agent.text import search_text

    now = datetime.utcnow()
    with env.db() as db:
        db.bulk_save_objects(
            [
                FeedbackRequest(
                    number=offset + i + 1, subject="platform", status="new", title=f"Request {offset + i}", summary="s", business_need="b",
                    search_text=search_text(f"Request {offset + i}", "s", "b"), priority="medium", complexity="M",
                    submitter_user_id=env.users["omar"], checklist={}, conflicts=[], agent_reasoning={}, last_activity_at=now,
                    created_at=now, updated_at=now, confirmed_at=now,
                )
                for i in range(count)
            ]
        )
        db.commit()


def count_statements(env, path):
    seen = []

    def watch(conn, cursor, statement, params, context, executemany):  # noqa: ANN001
        seen.append(statement)

    event.listen(env.engine, "before_cursor_execute", watch)
    try:
        start = time.perf_counter()
        r = env.client.get(path)
        elapsed = time.perf_counter() - start
    finally:
        event.remove(env.engine, "before_cursor_execute", watch)
    assert r.status_code == 200
    return len(seen), elapsed, r.json()


def test_statement_count_is_the_same_at_50_and_5000_requests_and_fast(env):
    fill(env, 50)
    small, _, body = count_statements(env, "/v1/feedback?page_size=50")
    assert len(body["items"]) == 50
    fill(env, 4950, offset=50)
    big, _, body = count_statements(env, "/v1/feedback?page_size=50")
    assert len(body["items"]) == 50 and body["total"] == 5000
    assert big == small
    times = sorted(count_statements(env, "/v1/feedback?page_size=50")[1] for _ in range(20))
    assert times[18] < 0.15, times


def test_drafts_are_limited_to_the_caller(env):
    from qym_platform.db.feedback_models import FeedbackRequest

    with env.db() as db:
        for key in ("sara", "sara", "omar"):
            db.add(FeedbackRequest(subject="platform", status="draft", submitter_user_id=env.users[key], checklist={}, conflicts=[], agent_reasoning={}))
        db.commit()
    assert len(env.client.get("/v1/feedback").json()["drafts"]) == 2
    env.act_as("omar")
    assert len(env.client.get("/v1/feedback").json()["drafts"]) == 1
