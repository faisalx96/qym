"""Queue rows carry the experiment creator's display name next to the email (B-25)."""

from __future__ import annotations

from test_eval_queue import (  # noqa: F401  (api, service, clock, sessions, autouse: fixtures)
    _as,
    _env,
    _queue_seed,
    _queue_url,
    _same_clock,
    api,
    clock,
    service,
    sessions,
)

from qym_platform.db.models import User


def test_queue_rows_carry_the_creator_name(api, sessions, service, clock):
    seed, _ = _queue_seed(sessions, clock)
    creator = _as(sessions, seed["user_id"])
    with sessions() as db:
        email = db.get(User, seed["user_id"]).email

    body = api.get(_queue_url(seed), headers=creator).json()
    # No display name: the email local part.
    assert {j["created_by_name"] for j in body["jobs"]} == {email.split("@")[0]}
    assert {j["created_by_email"] for j in body["jobs"]} == {email}
    assert {j["created_by_user_id"] for j in body["jobs"]} == {seed["user_id"]}

    with sessions() as db:
        db.get(User, seed["user_id"]).display_name = "Queue Owner"
        db.commit()
    body = api.get(_queue_url(seed), headers=creator).json()
    assert {j["created_by_name"] for j in body["jobs"]} == {"Queue Owner"}
