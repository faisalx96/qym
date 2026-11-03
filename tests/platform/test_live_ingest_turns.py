"""Live turn and canary ingestion on SQLite and PostgreSQL."""

from __future__ import annotations

import json
from datetime import date, datetime

import pytest
from test_live_ingest_sources import (  # noqa: F401
    BASE,
    SOURCE,
    _auth_headers,
    _auth_mode,
    session_factory,
)

from qym_platform.db.models import LiveCanaryResult, LiveSource, LiveTurn, LiveTurnScore
from qym_platform.settings import PlatformSettings

METRICS = ("accuracy", "compliance", "coverage")


def _create_source(client):
    response = client.put(BASE, headers=_auth_headers(), json=SOURCE)
    assert response.status_code == 201, response.text
    response = client.put(
        BASE + "/metric-specs",
        headers=_auth_headers(),
        json={
            "specs": [
                {
                    "metric_name": name,
                    "group": "quality",
                    "label": name.title(),
                    "score_type": "percentage",
                }
                for name in METRICS
            ]
        },
    )
    assert response.status_code == 200, response.text


def _turn(turn_id="turn-1", **values):
    return {
        "turn_id": turn_id,
        "turn_at": "2026-11-01T10:00:00Z",
        "status": "completed",
        "question": "How many orders were placed?",
        "answer": "There were 12 orders.",
        "scores": [{"metric_name": name, "score_numeric": 0.8} for name in METRICS],
        **values,
    }


def _push(client, turns):
    response = client.post(
        BASE + "/turns", headers=_auth_headers(), json={"turns": turns}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_batch_creates_turns_and_scores(client, session_factory):
    _create_source(client)
    first = _turn(
        conversation_id="conversation-1",
        turn_index=2,
        evaluated_at="2026-11-01T13:05:00+03:00",
        user_ref="user-1",
        mode="inquiry",
        outcome="ok",
        label="correct",
        label_reason="The answer matches the result.",
        sql=[{"text": "SELECT 12", "executed": True, "rows": 1}],
        latency_ms=125.5,
        result_rows=1,
        tool_calls=1,
        trace_url="https://traces.example.test/turn-1",
        eval_trace_url="https://traces.example.test/eval-1",
        summary={"custom": "kept"},
        detail={"producer": {"value": 1}},
    )
    first["scores"][0].update(
        score_raw={"value": 0.8}, label="good", explanation="Accurate", meta={"n": 1}
    )
    first["scores"][2].update(
        score_numeric=None, skipped=True, skip_reason="Not needed"
    )
    report = _push(client, [first, _turn("turn-2", turn_at="2026-11-01T11:00:00Z")])
    assert report == {
        "accepted": 2,
        "updated": 0,
        "rejected": 0,
        "results": [
            {"turn_id": name, "status": "created", "error": None, "notes": []}
            for name in ("turn-1", "turn-2")
        ],
    }
    with session_factory() as session:
        rows = session.query(LiveTurn).order_by(LiveTurn.turn_id).all()
        assert len(rows) == 2
        row = rows[0]
        assert row.day == date(2026, 11, 1)
        assert row.evaluated_at == datetime(2026, 11, 1, 10, 5)
        assert row.received_at is not None
        for name in (
            "conversation_id",
            "turn_index",
            "user_ref",
            "mode",
            "status",
            "outcome",
            "label",
            "label_reason",
            "question",
            "answer",
            "sql",
            "latency_ms",
            "result_rows",
            "tool_calls",
            "trace_url",
            "eval_trace_url",
            "summary",
            "detail",
        ):
            assert getattr(row, name) == first[name]
        assert row.rejected is None
        assert session.query(LiveTurnScore).count() == 6
        scores = session.query(LiveTurnScore).filter_by(turn_pk=row.id).all()
        for score in scores:
            expected = next(
                s for s in first["scores"] if s["metric_name"] == score.metric_name
            )
            for name, value in expected.items():
                assert getattr(score, name) == value
        assert session.query(LiveSource).one().last_turn_at == datetime(2026, 11, 1, 11)


def test_repush_replaces_turn_and_scores(client, session_factory, monkeypatch):
    from qym_platform.services import live_ingest

    _create_source(client)
    monkeypatch.setattr(live_ingest, "utcnow", lambda: datetime(2026, 11, 1, 12))
    _push(
        client,
        [_turn(conversation_id="old", detail={"old": True}, summary={"old": True})],
    )
    with session_factory() as session:
        original = session.query(LiveTurn).one()
        turn_pk, received_at = original.id, original.received_at
    monkeypatch.setattr(live_ingest, "utcnow", lambda: datetime(2026, 11, 1, 13))
    replacement = _turn(
        turn_at="2026-10-31T10:00:00Z",
        day="2026-11-02",
        question="Revised question",
        answer=None,
        scores=[{"metric_name": name, "score_numeric": 1.0} for name in METRICS[:2]],
    )
    report = _push(client, [replacement])
    assert (report["accepted"], report["updated"], report["rejected"]) == (0, 1, 0)
    assert report["results"] == [
        {"turn_id": "turn-1", "status": "updated", "error": None, "notes": []}
    ]
    with session_factory() as session:
        row = session.query(LiveTurn).one()
        assert row.id == turn_pk
        assert row.received_at == received_at == datetime(2026, 11, 1, 12)
        assert row.summary == {"replaced_at": "2026-11-01T13:00:00Z"}
        assert row.day == date(2026, 11, 2)
        assert row.turn_at == datetime(2026, 10, 31, 10)
        assert row.question == "Revised question"
        assert row.answer is None and row.conversation_id is None and row.detail is None
        scores = session.query(LiveTurnScore).order_by(LiveTurnScore.metric_name).all()
        assert [(score.metric_name, score.score_numeric) for score in scores] == [
            ("accuracy", 1.0),
            ("compliance", 1.0),
        ]
        assert session.query(LiveSource).one().last_turn_at == datetime(2026, 11, 1, 10)


def test_duplicate_turn_id_in_one_batch_last_wins(client, session_factory):
    _create_source(client)
    report = _push(client, [_turn(), _turn(question="Last question", scores=[])])
    assert (report["accepted"], report["updated"], report["rejected"]) == (1, 1, 0)
    assert [(row["turn_id"], row["status"]) for row in report["results"]] == [
        ("turn-1", "created"),
        ("turn-1", "updated"),
    ]
    with session_factory() as session:
        row = session.query(LiveTurn).one()
        assert row.question == "Last question"
        assert row.summary["replaced_at"].endswith("Z")
        assert session.query(LiveTurnScore).count() == 0


def test_detail_over_limit_is_truncated_not_refused(
    client, session_factory, monkeypatch
):
    _create_source(client)
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_detail_max_bytes=4096),
    )
    report = _push(
        client, [_turn(detail={"payload": "x" * 4096}, summary={"kept": True})]
    )
    assert report["accepted"] == 1 and report["rejected"] == 0
    assert report["results"][0]["notes"] == ["detail truncated"]
    with session_factory() as session:
        row = session.query(LiveTurn).one()
        assert row.detail is None
        assert row.summary == {"kept": True, "detail_truncated": True}
        assert row.rejected == ["detail truncated"]
        assert session.query(LiveTurnScore).count() == 3


def test_unknown_metric_is_noted_not_rejected(client, session_factory):
    _create_source(client)
    report = _push(
        client, [_turn(scores=[{"metric_name": "new_metric", "score_numeric": 0.5}])]
    )
    assert report["accepted"] == 1 and report["rejected"] == 0
    assert report["results"][0]["notes"] == ["unknown metric new_metric"]
    with session_factory() as session:
        assert session.query(LiveTurn).one().rejected == ["unknown metric new_metric"]
        score = session.query(LiveTurnScore).one()
        assert score.metric_name == "new_metric" and score.score_numeric == 0.5


def test_invalid_turn_does_not_fail_its_batch(client, session_factory):
    _create_source(client)
    invalid = _turn("missing-question")
    del invalid["question"]
    report = _push(client, [invalid, _turn()])
    assert (report["accepted"], report["updated"], report["rejected"]) == (1, 0, 1)
    rejected, created = report["results"]
    assert (
        rejected["turn_id"] == "missing-question" and rejected["status"] == "rejected"
    )
    assert "question" in rejected["error"] and "Field required" in rejected["error"]
    assert "\n" not in rejected["error"] and rejected["notes"] == []
    assert created["turn_id"] == "turn-1" and created["status"] == "created"
    # A score constraint failure must roll back the replacement, then continue.
    duplicate_scores = [{"metric_name": "accuracy"}, {"metric_name": "accuracy"}]
    report = _push(
        client,
        [
            _turn(
                question="Must roll back",
                turn_at="2026-11-03T10:00:00Z",
                scores=duplicate_scores,
            ),
            _turn("turn-2"),
            _turn("extra-field", unexpected=True),
            _turn(
                "extra-score-field",
                scores=[{"metric_name": "accuracy", "unexpected": True}],
            ),
        ],
    )
    assert (report["accepted"], report["updated"], report["rejected"]) == (1, 0, 3)
    assert [row["status"] for row in report["results"]] == [
        "rejected",
        "created",
        "rejected",
        "rejected",
    ]
    with session_factory() as session:
        rows = session.query(LiveTurn).order_by(LiveTurn.turn_id).all()
        assert [row.turn_id for row in rows] == ["turn-1", "turn-2"]
        assert rows[0].question == "How many orders were placed?"
        assert "replaced_at" not in rows[0].summary
        assert session.query(LiveTurnScore).count() == 6
        assert session.query(LiveSource).one().last_turn_at == datetime(2026, 11, 1, 10)


def test_nul_and_oversized_text_are_sanitised(client, session_factory):
    _create_source(client)
    report = _push(
        client,
        [
            _turn(question="a\x00b" + "q" * 200000, answer="c\x00d" + "a" * 200000),
            _turn("nul-only", question="a\x00b", answer="c\x00d"),
        ],
    )
    assert report["accepted"] == 2 and report["rejected"] == 0
    with session_factory() as session:
        row = session.query(LiveTurn).filter_by(turn_id="turn-1").one()
        assert row.question == "ab" + "q" * 199998
        assert row.answer == "cd" + "a" * 199998
        assert row.summary["text_truncated"] is True
        row = session.query(LiveTurn).filter_by(turn_id="nul-only").one()
        assert row.question == "ab" and row.answer == "cd"
        assert "text_truncated" not in row.summary


def test_batch_over_cap_is_422(client, session_factory, monkeypatch):
    _create_source(client)
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_turn_batch_max=2),
    )
    for turns in ([_turn(str(index)) for index in range(3)], [], {}, "invalid", None):
        response = client.post(
            BASE + "/turns", headers=_auth_headers(), json={"turns": turns}
        )
        assert response.status_code == 422, response.text
    with session_factory() as session:
        assert session.query(LiveTurn).count() == 0


def test_canaries_idempotent_on_canary_and_checked_at(client, session_factory):
    _create_source(client)
    first = {
        "canary": "database",
        "checked_at": "2026-11-01T10:00:00Z",
        "status": "failed",
        "fault": "timeout",
        "latency_ms": 1500,
        "detail": {"attempt": 1},
        "eval_code_version": "v1",
    }
    results = [first, {**first, "checked_at": "2026-11-01T13:00:00+03:00"}]
    for expected in (1, 0):
        response = client.post(
            BASE + "/canaries", headers=_auth_headers(), json={"results": results}
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"accepted": expected}
    response = client.post(
        BASE + "/canaries",
        headers=_auth_headers(),
        json={
            "results": [
                {**first, "checked_at": "2026-11-01T11:00:00Z"},
                {**first, "canary": "service"},
            ]
        },
    )
    assert response.status_code == 200 and response.json() == {"accepted": 2}
    with session_factory() as session:
        assert session.query(LiveCanaryResult).count() == 3
        row = (
            session.query(LiveCanaryResult)
            .filter_by(canary="database", checked_at=datetime(2026, 11, 1, 10))
            .one()
        )
        for name in ("status", "fault", "latency_ms", "detail", "eval_code_version"):
            assert getattr(row, name) == first[name]


def test_turn_ids_for_day(client, session_factory):
    _create_source(client)
    _push(client, [_turn(), _turn("turn-2", day="2026-11-02")])
    for day, expected in (
        ("2026-11-01", ["turn-1"]),
        ("2026-11-02", ["turn-2"]),
        ("2026-11-03", []),
    ):
        response = client.get(
            BASE + "/turns/ids", headers=_auth_headers(), params={"day": day}
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"turn_ids": expected}
    for params in ({}, {"day": "invalid"}):
        response = client.get(
            BASE + "/turns/ids", headers=_auth_headers(), params=params
        )
        assert response.status_code == 422


def test_non_object_entries_are_rejected_individually(client, session_factory):
    _create_source(client)
    report = _push(client, [_turn(), None, "x"])
    rejected = {
        "turn_id": None,
        "status": "rejected",
        "error": "turn must be a JSON object",
        "notes": [],
    }
    assert report == {
        "accepted": 1,
        "updated": 0,
        "rejected": 2,
        "results": [
            {"turn_id": "turn-1", "status": "created", "error": None, "notes": []},
            rejected,
            rejected,
        ],
    }
    with session_factory() as session:
        assert session.query(LiveTurn).one().turn_id == "turn-1"


def test_out_of_range_or_nonfinite_values_are_rejected_not_500(client, session_factory):
    _create_source(client)
    response = client.post(
        BASE + "/turns",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        content=json.dumps(
            {
                "turns": [
                    _turn(),
                    _turn("out-of-range", tool_calls=9223372036854775808),
                    _turn(
                        "nonfinite",
                        scores=[
                            {"metric_name": "accuracy", "score_numeric": float("nan")}
                        ],
                    ),
                ]
            },
            allow_nan=True,
        ),
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert (report["accepted"], report["updated"], report["rejected"]) == (1, 0, 2)
    assert [(row["turn_id"], row["status"]) for row in report["results"]] == [
        ("turn-1", "created"),
        ("out-of-range", "rejected"),
        ("nonfinite", "rejected"),
    ]
    assert "tool_calls" in report["results"][1]["error"]
    assert "score_numeric" in report["results"][2]["error"]
    with session_factory() as session:
        assert session.query(LiveTurn).one().turn_id == "turn-1"


@pytest.mark.parametrize("field", ["latency_ms", "score_numeric"])
def test_nonfinite_turn_numbers_are_rejected_individually(
    client, session_factory, field
):
    _create_source(client)
    turns = [_turn(latency_ms=125.5)]
    for number in ("nan", "inf", "-inf"):
        values = {field: float(number)}
        if field == "score_numeric":
            values = {"scores": [{"metric_name": "accuracy", **values}]}
        turns.append(_turn(number, **values))
    response = client.post(
        BASE + "/turns",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        content=json.dumps({"turns": turns}),
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert (report["accepted"], report["updated"], report["rejected"]) == (1, 0, 3)
    for result in report["results"][1:]:
        assert result["status"] == "rejected"
        assert f"{field} must be finite" in result["error"]
    with session_factory() as session:
        row = session.query(LiveTurn).one()
        assert row.turn_id == "turn-1" and row.latency_ms == 125.5


@pytest.mark.parametrize("field", ["summary", "detail", "sql", "score_raw", "meta"])
def test_nested_nonfinite_json_rejects_only_its_turn(client, session_factory, field):
    _create_source(client)
    _push(client, [_turn("existing")])
    turns = []
    for index, number in enumerate(("nan", "inf", "-inf")):
        nested = {"nested": [None, {"value": float(number)}]}
        values = {field: [nested] if field == "sql" else nested}
        if field in {"score_raw", "meta"}:
            values = {"scores": [{"metric_name": "accuracy", **values}]}
        turns.append(
            _turn("existing" if index == 0 else number, question="Invalid", **values)
        )
    turns.append(_turn())
    response = client.post(
        BASE + "/turns",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        content=json.dumps({"turns": turns}),
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert (report["accepted"], report["updated"], report["rejected"]) == (1, 0, 3)
    for result in report["results"][:3]:
        assert result["status"] == "rejected"
        assert result["error"] == "non-finite number in JSON"
        assert result["notes"] == []
    with session_factory() as session:
        rows = session.query(LiveTurn).order_by(LiveTurn.turn_id).all()
        assert [row.turn_id for row in rows] == ["existing", "turn-1"]
        assert rows[0].question == "How many orders were placed?"
        assert "replaced_at" not in rows[0].summary
        assert session.query(LiveTurnScore).count() == 6


def test_canary_latency_must_be_finite(client, session_factory):
    _create_source(client)
    for number in ("nan", "inf", "-inf"):
        response = client.post(
            BASE + "/canaries",
            headers={**_auth_headers(), "Content-Type": "application/json"},
            content=json.dumps(
                {
                    "results": [
                        {
                            "canary": "database",
                            "checked_at": "2026-11-01T10:00:00Z",
                            "status": "ok",
                            "latency_ms": float(number),
                        }
                    ]
                }
            ),
        )
        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "results", 0, "latency_ms"]
            and "latency_ms must be finite" in error["msg"]
            for error in response.json()["detail"]
        )
    with session_factory() as session:
        assert session.query(LiveCanaryResult).count() == 0


def test_detail_cap_uses_compact_utf8_bytes(client, session_factory, monkeypatch):
    _create_source(client)
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_detail_max_bytes=4096),
    )
    # Compact JSON adds 14 bytes; each Arabic character adds two UTF-8 bytes.
    detail = {"payload": "ع" * 2041}
    report = _push(
        client,
        [
            _turn("at-limit", detail=detail),
            _turn("over-limit", detail={"payload": detail["payload"] + "x"}),
        ],
    )
    assert (report["accepted"], report["rejected"]) == (2, 0)
    assert report["results"][0]["notes"] == []
    assert report["results"][1]["notes"] == ["detail truncated"]
    with session_factory() as session:
        rows = session.query(LiveTurn).order_by(LiveTurn.turn_id).all()
        assert rows[0].detail == detail
        assert "detail_truncated" not in rows[0].summary
        assert rows[0].rejected is None
        assert rows[1].detail is None
        assert rows[1].summary["detail_truncated"] is True
        assert rows[1].rejected == ["detail truncated"]


def test_default_batch_cap_rejects_101_turns(client, session_factory):
    _create_source(client)
    response = client.post(
        BASE + "/turns",
        headers=_auth_headers(),
        json={"turns": [_turn(str(index)) for index in range(101)]},
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "Turn batch exceeds the configured limit"
    with session_factory() as session:
        assert session.query(LiveTurn).count() == 0
