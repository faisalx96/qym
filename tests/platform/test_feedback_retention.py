"""Draft retention (QE-164)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from _feedback_support import make_env


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch):
    with make_env(monkeypatch, request.param) as e:
        yield e


def make_draft(env, key, age_days):
    from qym_platform.db.feedback_models import (FeedbackMessage,
                                                 FeedbackRequest)

    with env.db() as db:
        row = FeedbackRequest(
            subject="platform",
            status="draft",
            submitter_user_id=env.users[key],
            checklist={},
            conflicts=[],
            agent_reasoning={},
            last_activity_at=datetime.utcnow() - timedelta(days=age_days),
        )
        db.add(row)
        db.flush()
        db.add(FeedbackMessage(request_id=row.id, seq=1, role="user", content="hello"))
        db.commit()
        return row.id


def test_purge_removes_old_drafts_with_messages_and_never_confirmed_requests(env):
    from qym_platform.db.feedback_models import (FeedbackMessage,
                                                 FeedbackRequest)
    from qym_platform.db.models import AuditLog
    from qym_platform.feedback_agent.retention import purge_drafts

    old = make_draft(env, "sara", 31)
    fresh = make_draft(env, "sara", 29)
    kept = env.confirmed(
        "omar",
        "Old but confirmed",
        number=1,
        created_at=datetime.utcnow() - timedelta(days=400),
    )
    with env.db() as db:
        assert purge_drafts(db) == 1
        assert (
            db.get(FeedbackRequest, old) is None
            and db.get(FeedbackRequest, fresh)
            and db.get(FeedbackRequest, kept)
        )
        assert db.query(FeedbackMessage).filter_by(request_id=old).count() == 0
        entries = db.query(AuditLog).filter_by(action="feedback.drafts_purged").all()
        assert len(entries) == 1 and entries[0].after["count"] == 1
        assert purge_drafts(db) == 0
        assert (
            db.query(AuditLog).filter_by(action="feedback.drafts_purged").count() == 1
        )


def test_retention_follows_the_admin_setting(env):
    from qym_platform.db.feedback_models import FeedbackAgentConnection
    from qym_platform.feedback_agent.retention import purge_drafts

    make_draft(env, "sara", 5)
    with env.db() as db:
        db.add(
            FeedbackAgentConnection(
                id=1,
                llm_base_url="",
                llm_model="",
                llm_api_key_encrypted="",
                llm_api_key_last4="",
                draft_retention_days=3,
                max_user_messages=30,
            )
        )
        db.commit()
        assert purge_drafts(db) == 1


def test_a_purged_draft_is_404_for_its_submitter(env):
    from qym_platform.feedback_agent.retention import purge_drafts

    rid = make_draft(env, "sara", 40)
    with env.db() as db:
        purge_drafts(db)
    assert env.client.get(f"/v1/feedback/{rid}").status_code == 404
