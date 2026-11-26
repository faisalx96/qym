"""Question records, log lines and the dataset items route: duplicates, caps, cutting, masking."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    NOW,
    TOKENS,
    at_time,
    get_run,
    log_line,
    make_run,
    question_record,
    runner_headers,
    runner_path,
    seed_performance,
    use_encryption_key,
)
from qym_platform.db.models import (
    DatasetItem,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceRun,
)
from qym_platform.services import performance_redaction
from qym_platform.settings import PlatformSettings

PROJECT = "performance-project-1"
BASE = runner_path(PROJECT)
REFRESH = TOKENS["refresh_token"]
ACCESS = TOKENS["access_token"]
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.c2lnbmF0dXJl"


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    at_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_performance(db)
        db.commit()
    return factory


def _limits(monkeypatch, **changes) -> None:
    """Run the routes with other limits than the defaults."""
    monkeypatch.setattr(
        "qym_platform.api.performance_ingest.ingest_settings",
        lambda: PlatformSettings(**changes),
    )


def _refused(response, status: int, code: str, detail: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert (body["error"]["code"], body["detail"]) == (code, detail)


def _questions(client, run_id, records, **headers):
    return client.post(
        f"{BASE}/runs/{run_id}/questions",
        headers={**runner_headers(), **headers},
        json={"records": records},
    )


def _log(client, run_id, lines):
    return client.post(
        f"{BASE}/runs/{run_id}/log", headers=runner_headers(), json={"lines": lines}
    )


def _stored_questions(factory) -> list[PerformanceQuestion]:
    with factory() as db:
        rows = db.scalars(
            select(PerformanceQuestion).order_by(PerformanceQuestion.seq)
        ).all()
        db.expunge_all()
        return rows


def _stored_lines(factory) -> list[PerformanceLogLine]:
    with factory() as db:
        rows = db.scalars(
            select(PerformanceLogLine).order_by(PerformanceLogLine.seq)
        ).all()
        db.expunge_all()
        return rows


# --------------------------------------------------------------------------- questions


def test_question_records_are_stored_as_sent(client, session_factory):
    run_id = make_run(session_factory, status="running")
    follow_up = question_record(
        2,
        stage="ramp",
        level=None,
        user=7,
        tier="complex",
        question_id="complex-1",
        is_followup=True,
        question="كم عدد المواطنين الموجودين الآن؟",
        status="error",
        http_status=503,
        error_kind="server",
        duration_ms=1500.5,
        ttfb_ms=None,
        quality=None,
        answer=None,
        attempts=2,
        warmup=True,
        no_data=True,
    )
    response = _questions(client, run_id, [question_record(1), follow_up])
    assert response.status_code == 200, response.text
    assert response.json() == {
        "accepted": 2,
        "duplicates": 0,
        "rejected": 0,
        "dropped": 0,
        "results": [
            {"seq": 1, "status": "created", "error": None},
            {"seq": 2, "status": "created", "error": None},
        ],
    }
    first, second = _stored_questions(session_factory)
    assert (first.run_id, first.seq, first.asked_at, first.elapsed_s) == (
        run_id,
        1,
        NOW,
        95.5,
    )
    assert (first.stage, first.level, first.user_number, first.tier) == (
        "hold",
        10,
        3,
        "simple",
    )
    assert (first.question_id, first.is_followup, first.question) == (
        "simple-1",
        False,
        "Question simple-1?",
    )
    assert (first.status, first.http_status, first.error_kind) == ("ok", 200, None)
    assert (first.duration_ms, first.ttfb_ms, first.quality) == (4200, 1300, 100)
    assert (first.no_data, first.warmup, first.attempts) == (False, False, 1)
    assert (first.answer, first.answer_truncated) == ("Answer to simple-1", False)
    assert (second.stage, second.level, second.user_number, second.tier) == (
        "ramp",
        None,
        7,
        "complex",
    )
    assert second.question == "كم عدد المواطنين الموجودين الآن؟"
    assert (second.status, second.http_status, second.error_kind) == (
        "error",
        503,
        "server",
    )
    assert (second.is_followup, second.attempts, second.warmup, second.no_data) == (
        True,
        2,
        True,
        True,
    )
    assert (second.duration_ms, second.ttfb_ms, second.quality, second.answer) == (
        1500.5,
        None,
        None,
        None,
    )
    assert get_run(session_factory, run_id).questions_received == 2


def test_a_repeated_question_record_is_a_duplicate_and_is_left_as_it_is(
    client, session_factory
):
    run_id = make_run(session_factory, status="running")
    assert (
        _questions(client, run_id, [question_record(1), question_record(2)]).json()[
            "accepted"
        ]
        == 2
    )
    # The whole batch again after a lost answer, with one new record and one seq sent twice.
    again = _questions(
        client,
        run_id,
        [
            question_record(1, answer="another answer"),
            question_record(2),
            question_record(3),
            question_record(3, answer="the same seq again"),
        ],
    ).json()
    assert (
        again["accepted"],
        again["duplicates"],
        again["rejected"],
        again["dropped"],
    ) == (1, 3, 0, 0)
    assert [result["status"] for result in again["results"]] == [
        "duplicate",
        "duplicate",
        "created",
        "duplicate",
    ]
    stored = _stored_questions(session_factory)
    assert [(row.seq, row.answer) for row in stored] == [
        (1, "Answer to simple-1"),
        (2, "Answer to simple-1"),
        (3, "Answer to simple-1"),
    ]
    assert get_run(session_factory, run_id).questions_received == 3


def test_one_bad_record_is_rejected_alone(client, session_factory):
    run_id = make_run(session_factory, status="running")
    not_finite = question_record(4)
    not_finite["duration_ms"] = float("nan")
    response = client.post(
        f"{BASE}/runs/{run_id}/questions",
        headers={**runner_headers(), "Content-Type": "application/json"},
        content=__import__("json").dumps(
            {
                "records": [
                    question_record(1),
                    question_record(2, status="slow"),
                    "not an object",
                    not_finite,
                    question_record(5, http_status=600),
                    question_record(6, unknown_field=1),
                    {"seq": "seven"},
                    question_record(8),
                ]
            }
        ),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (
        body["accepted"],
        body["duplicates"],
        body["rejected"],
        body["dropped"],
    ) == (2, 0, 6, 0)
    results = body["results"]
    assert [(result["seq"], result["status"]) for result in results] == [
        (1, "created"),
        (2, "rejected"),
        (None, "rejected"),
        (4, "rejected"),
        (5, "rejected"),
        (6, "rejected"),
        (None, "rejected"),
        (8, "created"),
    ]
    assert results[1]["error"].startswith(
        "status: Input should be 'ok', 'error' or 'interrupted'"
    )
    assert results[2]["error"] == "record must be a JSON object"
    assert results[3]["error"].startswith("duration_ms: ")
    assert results[4]["error"].startswith("http_status: ")
    assert results[5]["error"] == "Unknown fields are not allowed (count: 1)"
    assert "\n" not in "".join(result["error"] or "" for result in results)
    assert [row.seq for row in _stored_questions(session_factory)] == [1, 8]

    # A batch in which every record is refused is still a 200.
    all_bad = _questions(client, run_id, [{}, {}]).json()
    assert (all_bad["accepted"], all_bad["rejected"]) == (0, 2)


def test_question_text_is_cut_cleaned_and_free_of_tokens(client, session_factory):
    run_id = make_run(session_factory, status="running")
    records = [
        question_record(1, question="q" * 2500, answer="a" * 1500),
        question_record(2, question="with\x00nul", answer="exactly " + "a" * 992),
        question_record(3, answer="short", answer_truncated=True),
        question_record(
            4, question=f"is {REFRESH} valid?", answer=f"the token {ACCESS} was sent"
        ),
    ]
    assert _questions(client, run_id, records).json()["accepted"] == 4
    one, two, three, four = _stored_questions(session_factory)
    assert (len(one.question), len(one.answer), one.answer_truncated) == (
        2000,
        1000,
        True,
    )
    assert (two.question, len(two.answer), two.answer_truncated) == (
        "withnul",
        1000,
        False,
    )
    # The suite already cut this answer and said so.
    assert (three.answer, three.answer_truncated) == ("short", True)
    assert four.question == "is [REDACTED] valid?"
    assert four.answer == "the token [REDACTED] was sent"


def test_no_answer_is_stored_for_a_run_started_without_answers(client, session_factory):
    run_id = make_run(session_factory, status="running")
    with session_factory() as db:
        run = db.get(PerformanceRun, run_id)
        run.config = {
            **run.config,
            "options": {"store_answers": False, "question_sent_lines": True},
        }
        db.commit()
    assert (
        _questions(
            client, run_id, [question_record(1, answer="must not be kept")]
        ).json()["accepted"]
        == 1
    )
    (stored,) = _stored_questions(session_factory)
    assert stored.answer is None and stored.question == "Question simple-1?"


def test_questions_above_the_run_limit_are_counted_not_stored(
    client, session_factory, monkeypatch
):
    _limits(monkeypatch, performance_questions_per_run_max=3)
    run_id = make_run(session_factory, status="running")
    first = _questions(client, run_id, [question_record(n) for n in (1, 2)]).json()
    assert (first["accepted"], first["dropped"]) == (2, 0)
    second = _questions(
        client, run_id, [question_record(n) for n in (2, 3, 4, 5)]
    ).json()
    assert (second["accepted"], second["duplicates"], second["dropped"]) == (1, 1, 2)
    assert [result["status"] for result in second["results"]] == [
        "duplicate",
        "created",
        "dropped",
        "dropped",
    ]
    # A stored record sent again is still a duplicate, not a drop.
    third = _questions(client, run_id, [question_record(1), question_record(6)]).json()
    assert (third["duplicates"], third["dropped"]) == (1, 1)
    run = get_run(session_factory, run_id)
    assert (run.questions_received, run.questions_dropped) == (3, 3)
    assert [row.seq for row in _stored_questions(session_factory)] == [1, 2, 3]


def test_question_batches_have_a_size(client, session_factory, monkeypatch):
    run_id = make_run(session_factory, status="running")
    too_many = _questions(client, run_id, [question_record(n) for n in range(1, 202)])
    _refused(too_many, 422, "too_many_records", "too many records")
    full = _questions(client, run_id, [question_record(n) for n in range(1, 201)])
    assert full.status_code == 200 and full.json()["accepted"] == 200
    for body in (
        {"records": []},
        {},
        {"records": [question_record(1)], "extra": 1},
        {"records": {}},
    ):
        response = client.post(
            f"{BASE}/runs/{run_id}/questions", headers=runner_headers(), json=body
        )
        assert response.status_code == 422 and isinstance(
            response.json()["detail"], list
        )
    _limits(monkeypatch, performance_questions_max_bytes=65536)
    too_large = _questions(client, run_id, [question_record(900, answer="a" * 70000)])
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "payload_too_large"
    assert "65536 byte limit" in too_large.json()["detail"]
    assert get_run(session_factory, run_id).questions_received == 200


def test_questions_are_taken_in_every_claimed_state_and_not_before(
    client, session_factory
):
    queued = make_run(session_factory)
    _refused(
        _questions(client, queued, [question_record(1)]),
        409,
        "run_not_claimed",
        "run has not been claimed",
    )
    with session_factory() as db:
        db.get(PerformanceRun, queued).status = "stopped"
        db.commit()
    for status in ("starting", "running", "stopping"):
        run_id = make_run(session_factory, status=status)
        assert _questions(client, run_id, [question_record(1)]).json()["accepted"] == 1
        with session_factory() as db:
            db.get(PerformanceRun, run_id).status = "finished"
            db.commit()
    # Posting records is not a sign of life.
    run_id = make_run(session_factory, status="running")
    _questions(client, run_id, [question_record(1)])
    assert get_run(session_factory, run_id).last_seen_at == NOW


# --------------------------------------------------------------------------- log


def test_log_lines_are_stored_in_order_and_duplicates_are_left(client, session_factory):
    run_id = make_run(session_factory, status="running")
    lines = [
        log_line(
            1, "request  level=10  user=3  status=200    30.1 s  simple   simple-1"
        ),
        log_line(2, "refresh failed for user 4", level="warning"),
        log_line(3, "runner: the suite exited with code 99", level="error"),
    ]
    response = _log(client, run_id, lines)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "accepted": 3,
        "duplicates": 0,
        "rejected": 0,
        "dropped": 0,
    }
    again = _log(
        client,
        run_id,
        [log_line(3, "changed"), log_line(4, "new"), log_line(4, "twice")],
    ).json()
    assert again == {"accepted": 1, "duplicates": 2, "rejected": 0, "dropped": 0}
    stored = _stored_lines(session_factory)
    assert [(row.seq, row.level, row.at) for row in stored] == [
        (1, "info", NOW),
        (2, "warning", NOW),
        (3, "error", NOW),
        (4, "info", NOW),
    ]
    assert stored[2].message == "runner: the suite exited with code 99"
    assert get_run(session_factory, run_id).log_lines_received == 4


def test_token_text_is_masked_before_a_log_line_is_stored(client, session_factory):
    run_id = make_run(session_factory, status="running")
    messages = [
        f"refresh sent with {REFRESH}",
        f"cookie estishraf_rt={REFRESH}; Path=/",
        f"both {REFRESH} and {ACCESS}",
        "GET /chat Authorization: Bearer abc.DEF-123_x",
        'headers {"authorization": "Basic dXNlcjpwYXNz", "accept": "*/*"}',
        "retry with bearer xyz789 after 401",
        f"token {JWT} expired",
        "Set-Cookie: session=abc123; HttpOnly",
        "level 10 passed: p95 67.8 s, errors 0.9%",
    ]
    lines = [log_line(n, message) for n, message in enumerate(messages, start=1)]
    assert _log(client, run_id, lines).json()["accepted"] == len(messages)
    stored = [row.message for row in _stored_lines(session_factory)]
    assert stored == [
        "refresh sent with [REDACTED]",
        "cookie estishraf_rt=[REDACTED]; Path=/",
        "both [REDACTED] and [REDACTED]",
        "GET /chat Authorization: [REDACTED]",
        'headers {"authorization": "[REDACTED]", "accept": "*/*"}',
        "retry with bearer [REDACTED] after 401",
        "token [REDACTED] expired",
        "Set-Cookie: [REDACTED]",
        "level 10 passed: p95 67.8 s, errors 0.9%",
    ]
    for text in stored:
        assert REFRESH not in text and ACCESS not in text and "eyJ" not in text


def test_log_lines_are_cut_cleaned_and_checked_one_by_one(client, session_factory):
    run_id = make_run(session_factory, status="running")
    response = _log(
        client,
        run_id,
        [
            log_line(1, "m" * 2500),
            log_line(2, "with\x00nul"),
            log_line(3, "wrong level", level="debug"),
            log_line(4, ""),
            {"seq": 5, "level": "info", "message": "no time"},
            "not an object",
            log_line(7, "last"),
        ],
    )
    assert response.json() == {
        "accepted": 3,
        "duplicates": 0,
        "rejected": 4,
        "dropped": 0,
    }
    stored = _stored_lines(session_factory)
    assert [(row.seq, len(row.message)) for row in stored] == [
        (1, 2000),
        (2, 7),
        (7, 4),
    ]
    assert stored[1].message == "withnul"


def test_log_batches_and_the_run_limit(client, session_factory, monkeypatch):
    run_id = make_run(session_factory, status="running")
    too_many = _log(client, run_id, [log_line(n) for n in range(1, 502)])
    _refused(too_many, 422, "too_many_lines", "too many lines")
    assert _log(client, run_id, []).status_code == 422
    too_large = _log(client, run_id, [log_line(1, "m" * 262144)])
    assert (
        too_large.status_code == 413
        and too_large.json()["error"]["code"] == "payload_too_large"
    )

    _limits(monkeypatch, performance_log_lines_per_run_max=2)
    report = _log(client, run_id, [log_line(n) for n in (1, 2, 3, 4)]).json()
    assert report == {"accepted": 2, "duplicates": 0, "rejected": 0, "dropped": 2}
    report = _log(client, run_id, [log_line(2), log_line(5)]).json()
    assert report == {"accepted": 0, "duplicates": 1, "rejected": 0, "dropped": 1}
    run = get_run(session_factory, run_id)
    assert (run.log_lines_received, run.log_lines_dropped) == (2, 3)

    queued = make_run(session_factory, project_id=_second_project(session_factory))
    refused = client.post(
        f"{runner_path('performance-project-2')}/runs/{queued}/log",
        headers=runner_headers("t2-runner"),
        json={"lines": [log_line(1)]},
    )
    _refused(refused, 409, "run_not_claimed", "run has not been claimed")


def _second_project(factory) -> str:
    with factory() as db:
        seed_performance(
            db, suffix="2", runner_token="t2-runner", other_token="t2-other"
        )
        db.commit()
    return "performance-project-2"


# --------------------------------------------------------------------------- dataset items


def _items(client, run_id, query="", instance=None):
    headers = (
        runner_headers() if instance is None else runner_headers(instance=instance)
    )
    return client.get(f"{BASE}/runs/{run_id}/dataset-items{query}", headers=headers)


def test_dataset_items_come_in_dataset_order_page_by_page(client, session_factory):
    run_id = make_run(session_factory, status="starting")
    everything = _items(client, run_id)
    assert everything.status_code == 200, everything.text
    body = everything.json()
    assert (body["total"], body["next_after"]) == (6, None)
    assert [item["item_id"] for item in body["items"]] == [
        "simple-1",
        "simple-2",
        "medium-1",
        "medium-2",
        "complex-1",
        "complex-2",
    ]
    assert body["items"][0] == {
        "item_id": "simple-1",
        "index": 1,
        "input": "Question simple-1?",
        "expected_output": None,
        "metadata": {
            "must_not_contain": ["no data"],
            "tier": "simple",
            "follow_up": "Follow-up to simple-1?",
        },
        "labels": [],
    }

    first = _items(client, run_id, "?limit=4").json()
    assert [item["index"] for item in first["items"]] == [1, 2, 3, 4]
    assert first["total"] == 6 and first["next_after"] is not None
    second = _items(client, run_id, f"?limit=4&after={first['next_after']}").json()
    assert [item["item_id"] for item in second["items"]] == ["complex-1", "complex-2"]
    assert (second["total"], second["next_after"]) == (6, None)
    # A page that ends exactly at the last item says so at once.
    exact = _items(client, run_id, "?limit=6").json()
    assert len(exact["items"]) == 6 and exact["next_after"] is None


@pytest.mark.parametrize(
    "metadata, filled_tier",
    [
        ({"complexity": "Simple"}, "simple"),
        ({"complexity": " Medium "}, "medium"),
        ({"complexity": "Complex"}, "complex"),
        ({"tier": "simple"}, None),
        ({"tier": " SIMPLE ", "complexity": "Complex"}, "simple"),
        ({"tier": "unknown", "complexity": "Complex"}, "complex"),
        ({"tier": None, "complexity": "Simple"}, "simple"),
        ({"tier": ["simple"], "complexity": "Medium"}, "medium"),
        ({"complexity": "unknown"}, None),
        ({"tier": "unknown"}, None),
        ({}, None),
    ],
)
def test_dataset_items_give_the_runner_the_lowercase_kind(
    client, session_factory, metadata, filled_tier
):
    run_id = make_run(session_factory, status="starting")
    metadata = {
        **metadata,
        "domain": ["سكان"],
        "source": "test_set_v5",
        "follow_up": "وماذا بعد؟",
        "extra": {"keep": [1, None, True]},
    }
    with session_factory() as db:
        item = db.scalars(select(DatasetItem).order_by(DatasetItem.index)).first()
        item.item_metadata = metadata
        item.input = "كم عدد السكان؟"
        item.expected_output = "SELECT COUNT(*) FROM people"
        item.labels = ["unchanged"]
        db.commit()
    response = _items(client, run_id)
    assert response.status_code == 200, response.text
    rows = response.json()["items"]
    expected_metadata = {**metadata, "tier": filled_tier} if filled_tier else metadata
    assert rows[0] == {
        "item_id": "simple-1",
        "index": 1,
        "input": "كم عدد السكان؟",
        "expected_output": "SELECT COUNT(*) FROM people",
        "metadata": expected_metadata,
        "labels": ["unchanged"],
    }
    assert [row["metadata"]["tier"] for row in rows[1:]] == [
        "simple",
        "medium",
        "medium",
        "complex",
        "complex",
    ]
    with session_factory() as db:
        item = db.scalars(select(DatasetItem).order_by(DatasetItem.index)).first()
        assert item.item_metadata == metadata
        assert item.expected_output == "SELECT COUNT(*) FROM people"


def test_dataset_items_with_the_same_position_are_neither_repeated_nor_skipped(
    client, session_factory
):
    run_id = make_run(session_factory, status="running")
    with session_factory() as db:
        for item in db.scalars(select(DatasetItem)):
            item.index = 1 if item.item_id.startswith("simple") else 2
        disabled = db.scalars(
            select(DatasetItem).where(DatasetItem.item_id == "medium-2")
        ).one()
        disabled.disabled_at = datetime(2026, 11, 19)
        db.commit()
    seen, after = [], None
    for _ in range(10):
        page = _items(
            client, run_id, "?limit=1" + (f"&after={after}" if after else "")
        ).json()
        assert page["total"] == 5
        seen += [item["item_id"] for item in page["items"]]
        after = page["next_after"]
        if after is None:
            break
    # Disabled items are left out, and every other item comes exactly once.
    assert seen == ["simple-1", "simple-2", "medium-1", "complex-1", "complex-2"]


def test_dataset_items_refusals(client, session_factory):
    run_id = make_run(session_factory, status="stopping")
    assert _items(client, run_id).status_code == 200
    for query in ("?limit=0", "?limit=1001", "?after=abc", "?after=1", "?after=1:2:3"):
        refused = _items(client, run_id, query)
        assert refused.status_code == 422 and isinstance(
            refused.json()["detail"], list
        ), query
    stranger = _items(client, run_id, instance="instance-2")
    _refused(
        stranger,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    _refused(
        _items(client, "no-such-run"), 404, "run_not_found", "performance run not found"
    )
    with session_factory() as db:
        db.get(PerformanceRun, run_id).status = "stopped"
        db.commit()
    ended = _items(client, run_id)
    _refused(ended, 409, "run_finished", "run already finished")
    assert ended.json()["error"]["details"] == {"status": "stopped"}
    queued = make_run(session_factory)
    _refused(_items(client, queued), 409, "run_not_claimed", "run has not been claimed")


def test_dataset_items_of_a_lost_run_or_a_removed_version(
    client, session_factory, monkeypatch
):
    removed = make_run(session_factory, status="starting", version=None)
    assert _items(client, removed).json() == {
        "items": [],
        "next_after": None,
        "total": 0,
    }
    # Silent for the stale limit: the read says the run is over and writes nothing.
    at_time(monkeypatch, NOW + timedelta(seconds=120))
    lost = _items(client, removed)
    _refused(lost, 409, "run_finished", "run already finished")
    assert lost.json()["error"]["details"] == {"status": "interrupted"}
    assert get_run(session_factory, removed).status == "starting"


# --------------------------------------------------------------------------- masking rules


def test_mask_text_rules():
    mask = performance_redaction.mask_text
    assert mask("plain words stay", [REFRESH]) == "plain words stay"
    assert mask(f"a {REFRESH} b {REFRESH}", [REFRESH]) == "a [REDACTED] b [REDACTED]"
    assert mask(f"jwt {JWT}.") == "jwt [REDACTED]."
    assert mask("Bearer abc123") == "Bearer [REDACTED]"
    assert mask("authorization=abc123&next=1") == "authorization=[REDACTED]&next=1"
    assert mask("Proxy-Authorization: Basic abc") == "Proxy-Authorization: [REDACTED]"
    # Masking twice changes nothing more.
    once = mask(f"Authorization: Bearer {REFRESH}", [REFRESH])
    assert once == "Authorization: [REDACTED]" and mask(once, [REFRESH]) == once
    assert (
        performance_redaction.mask_exact(f"Bearer {REFRESH}", [REFRESH])
        == "Bearer [REDACTED]"
    )
    assert performance_redaction.mask_json(
        {"a": [f"x {REFRESH}", 1, None], "b": {"c": "Bearer abc"}}, [REFRESH]
    ) == {"a": ["x [REDACTED]", 1, None], "b": {"c": "Bearer [REDACTED]"}}


def test_a_token_is_found_in_its_escaped_spellings():
    token = 'tok<en>"&/é+1'
    found = performance_redaction.contains_token
    assert found(f"plain {token}", [token])
    assert found('json "tok<en>\\"&/\\u00e9+1"', [token])
    assert found("markup tok&lt;en&gt;&quot;&amp;/é+1", [token])
    assert found("url tok%3Cen%3E%22%26%2F%C3%A9%2B1", [token])
    assert not found("nothing here", [token])
    assert not found("anything", [""])
    in_json = performance_redaction.json_contains_token
    assert in_json({"a": [{"b": f"x{token}y"}]}, [token])
    assert in_json({token: 1}, [token])
    assert not in_json({"a": [1, None, "clean"]}, [token])


def test_credential_keys_are_dropped_at_any_depth():
    cleaned = performance_redaction.drop_credential_keys(
        {
            "host": "qa-host",
            "API_KEY": "x",
            "nested": [
                {"refresh_token": "x", "ok": 1},
                {"Cookie": "x", "SecretThing": "x"},
            ],
            "credentials": {"user": "u"},
        }
    )
    assert cleaned == {"host": "qa-host", "nested": [{"ok": 1}, {}]}


def test_token_values_come_from_the_database_longest_first(session_factory):
    with session_factory() as db:
        run_id = make_run(session_factory, status="running")
        run = db.get(PerformanceRun, run_id)
        values = performance_redaction.token_values(db, target_id=run.target_id)
        assert values == sorted(TOKENS.values(), key=len, reverse=True)
        assert performance_redaction.token_values(db, project_id=PROJECT) == values
        assert (
            performance_redaction.token_values(db, project_id="another-project") == []
        )
        assert performance_redaction.token_values(db) == []


# --------------------------------------------------------------------------- review fixes

LIVE = "live-access-9f3a7c1d5b2e"  # a token the target handed out; qym never saw it
SPECIAL = (
    "rt+Zm9v/YmFy+QUJD/REVGR0hJ==41bd"  # a saved token with URL and JSON characters
)


def _save_special_refresh_token(factory) -> None:
    from _performance_support import seed_token
    from qym_platform.db.models import PerformanceTarget

    with factory() as db:
        target = db.scalars(select(PerformanceTarget)).one()
        target.tokens.clear()
        db.flush()
        seed_token(db, target, "refresh_token", SPECIAL)
        db.commit()


def test_a_batch_sent_again_after_the_run_limit_counts_its_drops_once(
    client, session_factory, monkeypatch
):
    _limits(
        monkeypatch,
        performance_questions_per_run_max=2,
        performance_log_lines_per_run_max=2,
    )
    run_id = make_run(session_factory, status="running")
    questions = [question_record(n) for n in (1, 2, 3, 4)]
    lines = [log_line(n) for n in (1, 2, 3, 4)]
    for _attempt in (1, 2):
        sent = _questions(client, run_id, questions).json()
        assert (sent["dropped"], [r["status"] for r in sent["results"]][2:]) == (
            2,
            ["dropped", "dropped"],
        )
        assert _log(client, run_id, lines).json()["dropped"] == 2
    run = get_run(session_factory, run_id)
    assert (run.questions_received, run.questions_dropped) == (2, 2)
    assert (run.log_lines_received, run.log_lines_dropped) == (2, 2)
    # Later records are counted: each seq once, a repeat inside a batch too.
    _questions(client, run_id, [question_record(n) for n in (5, 5, 3)])
    _log(client, run_id, [log_line(5)])
    run = get_run(session_factory, run_id)
    assert (run.questions_dropped, run.log_lines_dropped) == (3, 3)
    # qym says once on the run's timeline that the limit was reached.
    from qym_platform.db.models import PerformanceEvent

    with session_factory() as db:
        marks = db.scalars(
            select(PerformanceEvent)
            .where(PerformanceEvent.run_id == run_id)
            .order_by(PerformanceEvent.code)
        ).all()
        assert [(row.code, row.source, row.level) for row in marks] == [
            ("log_limit_reached", "qym", "warning"),
            ("questions_limit_reached", "qym", "warning"),
        ]
        assert marks[1].details == {"limit": 2, "dropped_through_seq": 5}


def test_a_record_with_a_time_out_of_range_is_rejected_alone(client, session_factory):
    run_id = make_run(session_factory, status="running")
    early = "0001-01-01T00:00:00+14:00"  # before the year 1 in UTC
    late = "9999-12-31T23:59:59-14:00"  # after the year 9999 in UTC
    answer = _questions(
        client,
        run_id,
        [
            question_record(1),
            question_record(2, asked_at=early),
            question_record(3, asked_at=late),
        ],
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert (body["accepted"], body["rejected"]) == (1, 2)
    assert [r["status"] for r in body["results"]] == ["created", "rejected", "rejected"]
    assert "between the years 1 and 9999" in body["results"][1]["error"]
    lines = _log(client, run_id, [log_line(1), {**log_line(2), "at": early}]).json()
    assert (lines["accepted"], lines["rejected"]) == (1, 1)
    assert [row.seq for row in _stored_questions(session_factory)] == [1]
    # In a body that is checked whole, it is a validation error, not a failure of qym.
    event = {"at": early, "level": "info", "code": "qa_time", "message": "QA - time"}
    refused = client.post(
        BASE + "/events", headers=runner_headers(), json={"events": [event]}
    )
    assert refused.status_code == 422, refused.text


def test_token_text_in_brackets_cookies_and_other_spellings_is_masked(
    client, session_factory
):
    from urllib.parse import quote

    from qym_platform.db.models import PerformanceEvent

    _save_special_refresh_token(session_factory)
    run_id = make_run(session_factory, status="running")
    messages = [
        f"Authorization: [Bearer {LIVE}]",
        f"Authorization:<Bearer {LIVE}>",
        f"authorization=(bearer {LIVE})",
        f"headers: map[Authorization:[Bearer {LIVE}]]",
        f"Cookies: estishraf_rt={LIVE}",
        f"cookie jar: estishraf_rt={LIVE}; Path=/",
        f'refresh answer: {{"refresh_token":"{LIVE}"}}',
        f"url-encoded: rt={quote(SPECIAL, safe='')}",
        f"url-encoded, slash kept: rt={quote(SPECIAL)}",
        f"lower-case hex: rt={quote(SPECIAL, safe='').replace('%2F', '%2f')}",
        "json: " + json.dumps({"refresh_token": SPECIAL}).replace("/", "\\/"),
    ]
    lines = [log_line(n, message) for n, message in enumerate(messages, start=1)]
    assert _log(client, run_id, lines).json()["accepted"] == len(messages)
    event = {
        "at": "2026-11-20T11:00:00Z",
        "level": "info",
        "code": "qa_mask",
        "message": messages[0],
        "run_id": run_id,
    }
    assert (
        client.post(
            BASE + "/events", headers=runner_headers(), json={"events": [event]}
        ).status_code
        == 200
    )
    stored = [row.message for row in _stored_lines(session_factory)]
    with session_factory() as db:
        stored.append(
            db.scalars(
                select(PerformanceEvent.message).where(
                    PerformanceEvent.code == "qa_mask"
                )
            ).one()
        )
    assert stored[:7] + stored[-1:] == [
        "Authorization: [[REDACTED]]",
        "Authorization:<[REDACTED]>",
        "authorization=([REDACTED])",
        "headers: map[Authorization:[[REDACTED]]]",
        "Cookies: [REDACTED]",
        "cookie jar: estishraf_rt=[REDACTED]; Path=/",
        'refresh answer: {"refresh_token":"[REDACTED]"}',
        "Authorization: [[REDACTED]]",
    ]
    for text in stored:
        assert LIVE not in text and "Zm9v" not in text, text


def test_a_question_id_is_masked(client, session_factory):
    run_id = make_run(session_factory, status="running")
    record = question_record(1, question_id=f"q-{REFRESH}")
    assert _questions(client, run_id, [record]).json()["accepted"] == 1
    assert _stored_questions(session_factory)[0].question_id == "q-[REDACTED]"


def test_masking_finds_every_spelling_qym_can_predict():
    import base64
    from urllib.parse import quote, quote_plus

    found = performance_redaction.contains_token
    spellings = [
        SPECIAL,
        quote(SPECIAL, safe=""),
        quote(SPECIAL, safe="").lower(),
        quote(SPECIAL),
        quote_plus(SPECIAL),
        SPECIAL.replace("/", "\\/"),
    ]
    for shift in range(3):
        wrapped = "x" * shift + "Cookie: estishraf_rt=" + SPECIAL + "; Path=/"
        spellings.append(base64.b64encode(wrapped.encode()).decode())
        spellings.append(base64.urlsafe_b64encode(wrapped.encode()).decode())
    for text in spellings:
        assert found(f"<pre>{text}</pre>", [SPECIAL]), text
        assert SPECIAL not in performance_redaction.mask_exact(text, [SPECIAL])
    # Masking twice changes nothing more, and plain words stay.
    mask = performance_redaction.mask_text
    for text in (
        f"Authorization: [Bearer {LIVE}]",
        f"Cookies: estishraf_rt={LIVE}",
        f"rt={quote(SPECIAL)}",
    ):
        once = mask(text, [SPECIAL])
        assert mask(once, [SPECIAL]) == once
    assert mask("waiting_for_token: refresh_token, version 3") == (
        "waiting_for_token: refresh_token, version 3"
    )
    assert performance_redaction.mask_json(
        {f"k-{SPECIAL}": [f"Bearer {LIVE}"]}, [SPECIAL]
    ) == {"k-[REDACTED]": ["Bearer [REDACTED]"]}


@pytest.mark.parametrize(
    "encoded",
    [
        "%70rivate_secret",
        r"\u0070rivate_secret",
        "&#112;rivate_secret",
        "&#x70;rivate_secret",
        r"%5Cu0070rivate%5fsecret",
        "%26%23x70%3Brivate_secret",
    ],
)
def test_round2_noncanonical_escapes_are_redacted(encoded):
    mask = performance_redaction.Masker(["private_secret"])
    assert mask.contains(encoded)
    assert mask.exact(encoded) == "[REDACTED]"


def test_round2_escape_normalization_is_bounded(monkeypatch):
    decode = getattr(performance_redaction, "_decode_escapes", None)
    assert decode is not None
    sizes = []

    def counted(value):
        sizes.append(len(value))
        return decode(value)

    monkeypatch.setattr(performance_redaction, "_decode_escapes", counted)
    mask = performance_redaction.Masker(["private_secret"])
    sizes.clear()
    text = ("%25" + "25" * 100 + "70rivate_secret") * 10000
    assert mask.contains(
        text
    )  # An undecidable nesting depth is refused, never passed through.
    assert len(sizes) <= performance_redaction.NORMALIZE_PASSES
    assert sum(sizes) <= len(text) * performance_redaction.NORMALIZE_PASSES


@pytest.mark.parametrize(
    "name,expected",
    [("refresh_token", "abcd"), ("access_token", "abcd"), ("session_cookie", "ab\0cd")],
)
def test_round2_nul_exemption_is_cookie_only(name, expected):
    import asyncio
    from starlette.requests import Request
    from qym_platform.api.performance_ingest import _payload

    async def receive():
        return {
            "type": "http.request",
            "body": b'{"value":"ab\\u0000cd","replaces_version":1}',
            "more_body": False,
        }

    request = Request(
        {
            "type": "http",
            "path": "/v1/projects/p/performance/runners/k/runs/r/tokens/" + name,
            "headers": [],
        },
        receive,
    )
    payload, _ = asyncio.run(_payload(request, 65536))
    assert payload["value"] == expected


@pytest.mark.parametrize("prefix,number", [("&#", "112"), ("&#x", "70")])
def test_round2_zero_padded_entities_normalize_without_large_integers(prefix, number):
    mask = performance_redaction.Masker(["private_secret"])
    encoded = prefix + "0" * 10000 + number + ";rivate_secret"
    assert mask.contains(encoded)
    assert mask.exact(encoded) == "[REDACTED]"
    # Out-of-range numeric entities produce the Unicode replacement character,
    # without feeding an arbitrarily large integer to the HTML decoder.
    assert not mask.contains(prefix + "9" * 10000 + "; harmless")
