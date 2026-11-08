"""Payloads that list a person carry the user id and a display name (B-25)."""

from __future__ import annotations

from datetime import datetime

from test_experiments_api import (  # noqa: F401  (client, session_factory, env, encryption: fixtures)
    MEMBER,
    _created,
    _headers,
    _url,
    client,
    encryption,
    env,
    session_factory,
)

from qym_platform.api.experiments import _user_emails
from qym_platform.db.feedback_models import FeedbackRequestEvent
from qym_platform.db.models import User, UserRole
from qym_platform.feedback_agent.store import event_payload


def test_user_emails_also_returns_names_with_the_email_local_part_fallback(
    db_session,
):
    db_session.add_all(
        [
            User(id="a", email="ann@example.com", display_name="Ann Lee", role=UserRole.MEMBER),
            User(id="b", email="bob.k@example.com", display_name="", role=UserRole.MEMBER),
        ]
    )
    db_session.flush()
    emails, names = _user_emails(db_session, ["a", "b", None, "missing", "a"])
    assert emails == {"a": "ann@example.com", "b": "bob.k@example.com"}
    assert names == {"a": "Ann Lee", "b": "bob.k"}
    assert _user_emails(db_session, [None]) == ({}, {})


def test_experiment_list_and_detail_carry_the_creator_name(
    client, session_factory, env
):
    created = _created(client, [env.id])
    # member-1 has no display name yet: the email local part.
    assert created["created_by_name"] == MEMBER.split("@")[0]
    with session_factory() as s:
        s.get(User, "member-1").display_name = "Mia Member"
        s.commit()
    (row,) = client.get(_url(), headers=_headers(MEMBER)).json()["experiments"]
    assert row["created_by_user_id"] == "member-1"
    assert row["created_by_email"] == MEMBER
    assert row["created_by_name"] == "Mia Member"
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER))
    assert detail.status_code == 200, detail.text
    assert detail.json()["created_by_name"] == "Mia Member"


def test_feedback_event_carries_the_actor_user_id():
    users = {
        "admin-1": User(id="admin-1", email="admin@example.com", display_name="Admin")
    }
    at = datetime(2026, 11, 5, 12)
    acted = event_payload(
        FeedbackRequestEvent(id=1, kind="status", actor_user_id="admin-1", created_at=at),
        users,
    )
    assert acted["actor"] == "Admin"
    assert acted["actor_user_id"] == "admin-1"
    system = event_payload(
        FeedbackRequestEvent(id=2, kind="status", actor_user_id=None, created_at=at),
        users,
    )
    assert system["actor"] == ""
    assert system["actor_user_id"] is None
