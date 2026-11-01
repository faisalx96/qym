"""Project-scoped live turn reads and exports on SQLite and PostgreSQL."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from _live_support import seed_week
from qym_platform.db.models import LiveMetricSpec, LiveSource, LiveTurn, LiveTurnScore

ADMIN = {"X-User-Email": "owner@example.test"}
BASE = "/api/projects/test/live"
DAY = "2026-11-01"


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_week(db, "p")
        db.commit()
    return factory


def _turns(client, **params):
    response = client.get(f"{BASE}/turns", headers=ADMIN, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(body):
    return [row["turn_id"] for row in body["rows"]]


def test_list_default_is_newest_first_and_paginated(client, session_factory):
    body = _turns(client)
    assert body["total"] == len(body["rows"]) == 40
    assert [row["turn_at"] for row in body["rows"]] == sorted(
        (row["turn_at"] for row in body["rows"]), reverse=True
    )
    first = body["rows"][0]
    assert first["turn_id"] == f"turn-{DAY}-5"
    assert first["turn_at"] == "2026-11-01T10:05:00Z"
    assert first["charts"] == {"count": 0, "failed": 0}
    assert first["services_not_ok"] == []
    assert set(first["scores"]) == {"agent_success", "compliance_a", "chart_fidelity"}
    assert first["scores"]["agent_success"] == {
        "score_numeric": 1.0,
        "label": None,
        "skipped": True,
    }
    page = _turns(client, page=2, page_size=3)
    assert page["total"] == 40
    assert _ids(page) == _ids(body)[3:6]
    for params in ({"page": 0}, {"page_size": 201}, {"sort": "unknown"}):
        response = client.get(f"{BASE}/turns", headers=ADMIN, params=params)
        assert response.status_code == 422


def test_filter_by_day_label_and_status(client, session_factory):
    body = _turns(client, day=DAY, label=["ok", "suboptimal"], status="completed")
    assert body["total"] == 3
    assert _ids(body) == [f"turn-{DAY}-{index}" for index in (2, 1, 0)]
    failed = _turns(client, day=DAY, status="failed")
    assert _ids(failed) == [f"turn-{DAY}-{index}" for index in (5, 4, 3)]
    assert all(row["outcome"] == "agent_failed" for row in failed["rows"])
    assert all(row["outcome"] == "ok" for row in body["rows"])
    assert _turns(client, day=DAY, status="incomplete_ingest")["total"] == 0
    assert "midnight-turn" in _ids(_turns(client, day="2026-10-31"))
    assert "midnight-turn" not in _ids(_turns(client, day="2026-10-30"))
    body = _turns(
        client,
        **{"from": "2026-10-31", "to": DAY},
        outcome=["ok", "agent_failed"],
        mode=["standard", "other"],
        user="user-0",
        conversation=f"conversation-{DAY}",
    )
    assert _ids(body) == [f"turn-{DAY}-{index}" for index in (4, 2, 0)]
    for params in ({"day": "bad"}, {"from": DAY, "to": "2026-10-01"}):
        assert (
            client.get(f"{BASE}/turns", headers=ADMIN, params=params).status_code == 422
        )


def test_filter_metric_range_uses_score_numeric(client, session_factory):
    with session_factory() as db:
        turn = db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-2").one()
        score = (
            db.query(LiveTurnScore)
            .filter_by(turn_pk=turn.id, metric_name="agent_success")
            .one()
        )
        score.score_raw = 100
        db.commit()
    body = _turns(client, day=DAY, metric="agent_success", min=0.4, max=0.6)
    assert _ids(body) == [f"turn-{DAY}-2"]
    body = _turns(client, day=DAY, metric="agent_success", min=1, max=1)
    assert _ids(body) == [f"turn-{DAY}-1", f"turn-{DAY}-0"]
    assert _turns(client, metric="missing", min=0)["total"] == 0
    for params in ({"min": 0}, {"metric": "agent_success", "min": "nan"}):
        assert (
            client.get(f"{BASE}/turns", headers=ADMIN, params=params).status_code == 422
        )


def test_filter_service_not_ok(client, session_factory):
    body = _turns(client, day=DAY, service="sql_generation", service_status="not_ok")
    assert _ids(body) == [f"turn-{DAY}-4", f"turn-{DAY}-3"]
    with session_factory() as db:
        spec = (
            db.query(LiveMetricSpec)
            .filter_by(metric_name="service.sql_generation")
            .one()
        )
        spec.pass_threshold = 0.5
        db.commit()
    body = _turns(client, day=DAY, service="sql_generation", service_status="not_ok")
    assert _ids(body) == [f"turn-{DAY}-4"]
    assert (
        _turns(client, day=DAY, service="sql_generation", service_status="ok")["total"]
        == 5
    )


def test_search_matches_question_and_answer_case_insensitive(client, session_factory):
    assert _ids(_turns(client, q="المبيعات")) == [f"turn-{DAY}-0"]
    assert _ids(_turns(client, day=DAY, q="qUeStIoN 2")) == [f"turn-{DAY}-1"]
    assert _ids(_turns(client, day=DAY, q="aNsWeR 3")) == [f"turn-{DAY}-2"]
    assert _turns(client, q="not present")["total"] == 0


def test_sort_by_metric_desc_with_nulls_last(client, session_factory):
    with session_factory() as db:
        turn = db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-0").one()
        db.query(LiveTurnScore).filter_by(
            turn_pk=turn.id, metric_name="agent_success"
        ).delete()
        db.commit()
    rows = _turns(client, day=DAY, sort="-metric:agent_success")["rows"]
    assert [row["scores"]["agent_success"]["score_numeric"] for row in rows[:4]] == [
        1,
        0.5,
        0,
        0,
    ]
    assert {row["turn_id"] for row in rows[4:]} == {f"turn-{DAY}-0", f"turn-{DAY}-5"}
    rows = _turns(client, day=DAY, sort="metric:agent_success")["rows"]
    assert [row["scores"]["agent_success"]["score_numeric"] for row in rows[:4]] == [
        0,
        0,
        0.5,
        1,
    ]
    assert {row["turn_id"] for row in rows[4:]} == {f"turn-{DAY}-0", f"turn-{DAY}-5"}


def test_facets_count_the_filtered_set(client, session_factory):
    with session_factory() as db:
        turns = (
            db.query(LiveTurn)
            .filter_by(day=date(2026, 11, 1))
            .order_by(LiveTurn.turn_index)
            .all()
        )
        for turn in turns:
            turn.summary = {
                "charts": (
                    [{"issues": ["missing legend"]}, {"issues": []}]
                    if turn.turn_index in (3, 4)
                    else [{"issues": []}]
                ),
                "services": {"sql_generation": {"status": "failed", "fault": "infra"}},
            }
        turns[0].summary = {"charts": None}
        db.commit()
    body = _turns(client, day=DAY, charts="failed", page_size=1)
    assert body["total"] == 2
    assert len(body["rows"]) == 1
    assert body["rows"][0]["charts"] == {"count": 2, "failed": 1}
    assert body["rows"][0]["services_not_ok"] == [
        {"name": "sql_generation", "fault": "infra"}
    ]
    assert body["facets"] == {
        "labels": {"problem_a": 1, "problem_b": 1},
        "modes": {"standard": 2},
        "services": {"sql_generation": 2},
        "users": [{"user_ref": "user-0", "n": 1}, {"user_ref": "user-1", "n": 1}],
    }
    assert _turns(client, day=DAY, charts="any")["total"] == 5
    assert _turns(client, day=DAY, charts="none")["total"] == 1
    empty = _turns(client, day=DAY, label="unknown")
    assert empty == {
        "rows": [],
        "total": 0,
        "facets": {"labels": {}, "modes": {}, "services": {}, "users": []},
    }


def test_turn_detail_has_conversation_siblings_in_time_order(client, session_factory):
    with session_factory() as db:
        turn = db.query(LiveTurn).filter_by(turn_id="midnight-turn").one()
        turn.detail = {"extra": "evidence"}
        turn.summary = {"judges_agree": True}
        db.add(
            LiveTurnScore(
                turn_pk=turn.id, metric_name="unregistered", score_numeric=0.7
            )
        )
        db.commit()
    response = client.get(f"{BASE}/turns/midnight-turn", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["turn"]["day"] == "2026-10-31"
    assert body["turn"]["turn_at"] == "2026-10-30T23:59:00Z"
    assert body["turn"]["answer"] == "Answer 6"
    assert body["summary"] == {"judges_agree": True}
    assert body["detail"] == {"extra": "evidence"}
    assert [row["turn_id"] for row in body["conversation"]] == [
        "midnight-turn",
        *(f"turn-2026-10-31-{index}" for index in range(5)),
    ]
    assert [row["current"] for row in body["conversation"]] == [
        True,
        False,
        False,
        False,
        False,
        False,
    ]
    scores = {row["metric_name"]: row for row in body["scores"]}
    assert scores["agent_success"]["spec"]["is_primary"] is True
    assert scores["unregistered"]["spec"] is None
    assert len(body["specs"]) == 6


def test_turn_detail_404(client, session_factory):
    with session_factory() as db:
        source = LiveSource(
            project_id="p",
            key="other",
            name="Other",
            environment="test",
            is_active=False,
        )
        db.add(source)
        db.flush()
        db.add(
            LiveTurn(
                source_id=source.id,
                day=date(2026, 11, 1),
                turn_id="other-turn",
                turn_at=datetime(2026, 11, 1),
                status="completed",
                question="Other",
            )
        )
        db.commit()
    for turn_id in ("missing", "other-turn"):
        response = client.get(f"{BASE}/turns/{turn_id}", headers=ADMIN)
        assert response.status_code == 404
        assert response.json() == {"detail": "turn not found"}
    assert _turns(client)["total"] == 40
    response = client.get(
        f"{BASE}/turns/other-turn", headers=ADMIN, params={"source": "other"}
    )
    assert response.status_code == 200


def test_csv_export_has_one_column_per_spec(client, session_factory):
    response = client.get(
        f"{BASE}/turns.csv",
        headers=ADMIN,
        params={"day": DAY, "page_size": 1, "page": 2, "sort": "turn_at"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="live-turns-{DAY}.csv"'
    )
    rows = list(csv.reader(io.StringIO(response.text)))
    assert rows[0] == [
        "time",
        "day",
        "turn_id",
        "conversation_id",
        "user_ref",
        "mode",
        "status",
        "outcome",
        "label",
        "label_reason",
        "latency_ms",
        "result_rows",
        "agent_success",
        "diagnosis",
        "compliance_a",
        "service.sql_generation",
        "service.viz_agent",
        "chart_fidelity",
    ]
    assert len(rows) == 7
    assert all(len(row) == len(rows[0]) for row in rows)
    assert [row[2] for row in rows[1:]] == [f"turn-{DAY}-{index}" for index in range(6)]
    assert rows[1][12:15] == ["1.0", "ok", "1.0"]
    assert rows[-1][12] == rows[-1][-1] == ""


def test_csv_neutralises_formula_cells(client, session_factory):
    with session_factory() as db:
        turn = db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-0").one()
        turn.label_reason = "=1+1"
        turn.mode = "+mode"
        turn.label = "-label"
        turn.conversation_id = "\tconversation"
        turn.user_ref = "\ruser"
        score = (
            db.query(LiveTurnScore)
            .filter_by(turn_pk=turn.id, metric_name="diagnosis")
            .one()
        )
        score.label = "@cmd"
        db.add(
            LiveMetricSpec(
                source_id=turn.source_id,
                metric_name="=raw_metric",
                position=99,
                score_type="categorical",
                group_name="quality",
                label="Raw metric",
            )
        )
        db.add(
            LiveTurnScore(turn_pk=turn.id, metric_name="=raw_metric", score_raw="=2+2")
        )
        db.commit()
    response = client.get(f"{BASE}/turns.csv", headers=ADMIN, params={"q": "المبيعات"})
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 1
    row = rows[0]
    assert row["label_reason"] == "'=1+1"
    assert row["diagnosis"] == "'@cmd"
    assert row["mode"] == "'+mode"
    assert row["label"] == "'-label"
    assert row["conversation_id"] == "'\tconversation"
    assert row["user_ref"] == "'\ruser"
    assert row["'=raw_metric"] == "'=2+2"


def test_csv_export_runs_one_turn_query(client, session_factory):
    with session_factory() as db:
        source = db.query(LiveSource).filter_by(key="worker-1").one()
        turns = [
            LiveTurn(
                source_id=source.id,
                day=date(2026, 11, 2),
                turn_id=f"export-{index}",
                turn_at=datetime(2026, 11, 2) + timedelta(seconds=index),
                status="completed",
                outcome="ok",
                question=f"Export {index}",
            )
            for index in range(500)
        ]
        db.add_all(turns)
        db.flush()
        db.add_all(
            LiveTurnScore(
                turn_pk=turn.id, metric_name="agent_success", score_numeric=index
            )
            for index, turn in enumerate(turns)
        )
        db.commit()
        engine = db.get_bind()

    turn_queries = []
    score_queries = []

    def count_queries(connection, cursor, statement, parameters, context, executemany):
        sql = " ".join(statement.split())
        if sql.startswith("SELECT"):
            if "FROM live_turns" in sql:
                turn_queries.append(sql)
            elif "FROM live_turn_scores" in sql:
                score_queries.append(sql)

    event.listen(engine, "before_cursor_execute", count_queries)
    try:
        response = client.get(f"{BASE}/turns.csv", headers=ADMIN)
    finally:
        event.remove(engine, "before_cursor_execute", count_queries)
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 540
    assert [row["turn_id"] for row in rows[:500]] == [
        f"export-{index}" for index in reversed(range(500))
    ]
    assert [row["agent_success"] for row in rows[:500]] == [
        str(float(index)) for index in reversed(range(500))
    ]
    assert rows[500]["turn_id"] == f"turn-{DAY}-5"
    assert rows[500]["agent_success"] == ""
    assert rows[501]["agent_success"] == "0.0"
    assert len(turn_queries) == 1, turn_queries
    assert len(score_queries) == 2, score_queries


def test_turn_id_with_slash_is_retrievable(client, session_factory):
    with session_factory() as db:
        source = db.query(LiveSource).filter_by(key="worker-1").one()
        db.add(
            LiveTurn(
                source_id=source.id,
                day=date(2026, 11, 1),
                turn_id="trace/1",
                turn_at=datetime(2026, 11, 1),
                status="completed",
                outcome="ok",
                question="Slash in turn id",
            )
        )
        db.commit()
    for path in ("trace%2F1", "trace/1"):
        response = client.get(f"{BASE}/turns/{path}", headers=ADMIN)
        assert response.status_code == 200, response.text
        assert response.json()["turn"]["turn_id"] == "trace/1"
    response = client.get(f"{BASE}/turns.csv", headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
