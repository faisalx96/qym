"""Project-scoped live turn reads and exports on SQLite and PostgreSQL."""

from __future__ import annotations

import csv
import hashlib
import io
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker
from test_live_ingest_chart_images import OTHER_REF, REF, TURN_ID, _upload
from test_live_ingest_sources import _seed_api_key

from _live_support import _png, seed_week
from qym_platform.db.models import LiveMetricSpec, LiveSource, LiveTurn, LiveTurnScore

ADMIN = {"X-User-Email": "owner@example.test"}
BASE = "/api/projects/test/live"
DAY = "2026-11-01"
CHART_BASE = "/api/projects/live-project-1/live"


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


@pytest.fixture()
def chart_turn(session_factory):
    with session_factory() as db:
        _seed_api_key(db)
        source = seed_week(db, "live-project-1")
        turn = db.query(LiveTurn).filter_by(source_id=source.id, turn_id=TURN_ID).one()
        turn.summary = {"charts": [{"ref": REF}, {"ref": OTHER_REF}]}
        db.commit()


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


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page": 1_000_001},
        {"page": 99999999999999999999},
        {"page": 9223372036854775807},
        {"page_size": 201},
        {"page_size": 99999999999999999999},
        {"page_size": 9223372036854775807},
    ],
)
def test_pagination_bounds_return_validation_error(client, session_factory, params):
    response = client.get(f"{BASE}/turns", headers=ADMIN, params=params)
    assert response.status_code == 422, response.text
    assert (
        response.json()["detail"]
        == "page must be 1 to 1000000; page_size must be 1 to 200"
    )


def test_maximum_page_returns_empty_rows(client, session_factory):
    body = _turns(client, page=1_000_000, page_size=200)
    assert body["rows"] == []
    assert body["total"] == 40


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


def test_services_not_ok_excludes_ok_and_skipped(client, session_factory):
    with session_factory() as db:
        turn = db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-0").one()
        turn.summary = {
            "services": {
                "retrieval": {"status": "ok"},
                "visualization": {"status": "skipped"},
                "sql_generation": {"status": "failed", "fault": "infra"},
            }
        }
        db.commit()
    body = _turns(client, q="المبيعات")
    assert body["total"] == 1
    assert body["rows"][0]["services_not_ok"] == [
        {"name": "sql_generation", "fault": "infra"}
    ]


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
        "statuses": {"failed": 2},
        "outcomes": {"agent_failed": 2},
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
        "facets": {
            "labels": {
                "ok": 2,
                "suboptimal": 1,
                "problem_a": 1,
                "problem_b": 1,
                "inconclusive": 1,
            },
            "statuses": {},
            "outcomes": {},
            "modes": {},
            "services": {},
            "users": [],
        },
    }


def test_facets_exclude_their_own_filter(client, session_factory):
    with session_factory() as db:
        db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-0").one().mode = "chat"
        db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-1").one().mode = "report"
        db.commit()

    body = _turns(client, day=DAY, label="ok", page_size=1)
    assert body["total"] == 2
    assert len(body["rows"]) == 1
    assert body["facets"]["labels"] == {
        "ok": 2,
        "suboptimal": 1,
        "problem_a": 1,
        "problem_b": 1,
        "inconclusive": 1,
    }
    assert body["facets"]["modes"] == {"chat": 1, "report": 1}
    assert body["facets"]["statuses"] == {"completed": 2}
    assert body["facets"]["outcomes"] == {"ok": 2}

    body = _turns(client, day=DAY, mode="chat")
    assert body["total"] == 1
    assert body["facets"]["modes"] == {"chat": 1, "report": 1, "standard": 4}
    assert body["facets"]["labels"] == {"ok": 1}
    assert _turns(client, day=DAY, mode=["chat", "report"])["total"] == 2

    body = _turns(client, day=DAY, status="completed")
    assert body["total"] == 3
    assert body["facets"]["statuses"] == {"completed": 3, "failed": 3}
    assert body["facets"]["outcomes"] == {"ok": 3}

    body = _turns(client, day=DAY, outcome="ok")
    assert body["total"] == 3
    assert body["facets"]["outcomes"] == {"ok": 3, "agent_failed": 3}
    assert body["facets"]["statuses"] == {"completed": 3}

    body = _turns(client, day=DAY, user="user-0")
    assert body["total"] == 3
    assert body["facets"]["users"] == [
        {"user_ref": "user-0", "n": 3},
        {"user_ref": "user-1", "n": 3},
    ]
    assert body["facets"]["labels"] == {"ok": 1, "suboptimal": 1, "problem_b": 1}

    body = _turns(client, day=DAY, service="sql_generation", service_status="not_ok")
    assert body["total"] == 2
    assert body["facets"]["services"] == {"sql_generation": 2, "viz_agent": 1}
    assert body["facets"]["labels"] == {"problem_a": 1, "problem_b": 1}


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
    assert body["chart_images"] == {}
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
        assert response.json()["detail"] == "turn not found"
    assert _turns(client)["total"] == 40
    response = client.get(
        f"{BASE}/turns/other-turn", headers=ADMIN, params={"source": "other"}
    )
    assert response.status_code == 200


def test_chart_image_bytes_headers_and_replacement(client, chart_turn):
    first = _png()
    uploaded = _upload(client, first)
    assert uploaded.status_code == 204, uploaded.text
    detail = client.get(f"{CHART_BASE}/turns/{TURN_ID}", headers=ADMIN)
    assert detail.status_code == 200, detail.text
    url = detail.json()["chart_images"][REF]["url"]
    response = client.get(url, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.content == first
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-length"] == str(len(first))
    assert response.headers["cache-control"] == "private, max-age=86400"
    etag = response.headers["etag"]
    assert etag == f'"{hashlib.sha256(first).hexdigest()}"'

    second = _png(width=2, height=1, color=b"\x00\xff\x00\xff")
    uploaded = _upload(client, second)
    assert uploaded.status_code == 204, uploaded.text
    detail = client.get(f"{CHART_BASE}/turns/{TURN_ID}", headers=ADMIN)
    assert detail.status_code == 200, detail.text
    replacement_url = detail.json()["chart_images"][REF]["url"]
    assert replacement_url != url
    assert replacement_url.endswith(f"&v={hashlib.sha256(second).hexdigest()[:16]}")
    response = client.get(replacement_url, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.content == second
    response = client.get(url, headers={**ADMIN, "If-None-Match": etag})
    assert response.status_code == 200, response.text
    assert response.content == second
    assert response.headers["content-length"] == str(len(second))
    assert response.headers["etag"] != etag
    assert response.headers["etag"] == f'"{hashlib.sha256(second).hexdigest()}"'


@pytest.mark.parametrize("etag_form", ["plain", "weak", "list"])
def test_chart_image_matching_etag_is_304(client, chart_turn, etag_form):
    data = _png()
    uploaded = _upload(client, data)
    assert uploaded.status_code == 204, uploaded.text
    etag = f'"{hashlib.sha256(data).hexdigest()}"'
    condition = {
        "plain": etag,
        "weak": f"W/{etag}",
        "list": f'"stale", W/{etag}, "other"',
    }[etag_form]
    response = client.get(
        f"{CHART_BASE}/chart-image",
        params={"turn_id": TURN_ID, "ref": REF},
        headers={**ADMIN, "If-None-Match": condition},
    )
    assert response.status_code == 304, response.text
    assert response.content == b""
    assert response.headers["etag"] == etag
    assert response.headers["cache-control"] == "private, max-age=86400"


@pytest.mark.parametrize(
    "turn_id, ref", [("unknown", REF), (TURN_ID, "unknown"), (TURN_ID, OTHER_REF)]
)
def test_chart_image_not_found(client, chart_turn, turn_id, ref):
    uploaded = _upload(client)
    assert uploaded.status_code == 204, uploaded.text
    response = client.get(
        f"{CHART_BASE}/chart-image",
        headers=ADMIN,
        params={"turn_id": turn_id, "ref": ref},
    )
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "chart image not found"}


@pytest.mark.parametrize("ref", [None, "", "bad ref", "bad/ref", "x" * 101])
def test_chart_image_ref_is_validated(client, chart_turn, ref):
    params = {"turn_id": TURN_ID}
    if ref is not None:
        params["ref"] = ref
    response = client.get(f"{CHART_BASE}/chart-image", headers=ADMIN, params=params)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("turn_id", [None, "", "x" * 201])
def test_chart_image_turn_id_is_validated(client, chart_turn, turn_id):
    params = {"ref": REF}
    if turn_id is not None:
        params["turn_id"] = turn_id
    response = client.get(f"{CHART_BASE}/chart-image", headers=ADMIN, params=params)
    assert response.status_code == 422, response.text


def test_turn_detail_loads_chart_metadata_without_bytes(
    client, session_factory, chart_turn
):
    images = {REF: _png(), OTHER_REF: _png(width=4, height=1)}
    for ref, data in images.items():
        uploaded = _upload(client, data, ref=ref)
        assert uploaded.status_code == 204, uploaded.text
    with session_factory() as db:
        engine = db.get_bind()
    image_queries = []

    def record_queries(connection, cursor, statement, parameters, context, executemany):
        sql = " ".join(statement.split())
        if sql.startswith("SELECT") and "FROM live_chart_images" in sql:
            image_queries.append(sql)

    event.listen(engine, "before_cursor_execute", record_queries)
    try:
        response = client.get(f"{CHART_BASE}/turns/{TURN_ID}", headers=ADMIN)
    finally:
        event.remove(engine, "before_cursor_execute", record_queries)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"] == {"charts": [{"ref": REF}, {"ref": OTHER_REF}]}
    assert body["turn"]["summary"] == body["summary"]
    assert body["chart_images"] == {
        ref: {
            "url": (
                f"{CHART_BASE}/chart-image?source=worker-1&turn_id={TURN_ID}"
                f"&ref={ref}&v={hashlib.sha256(images[ref]).hexdigest()[:16]}"
            ),
            "width": width,
            "height": height,
            "byte_size": len(images[ref]),
        }
        for ref, width, height in ((REF, 3, 2), (OTHER_REF, 4, 1))
    }
    assert len(image_queries) == 1, image_queries
    selected = image_queries[0].split(" FROM ")[0]
    assert "live_chart_images.image" not in selected
    for column in ("ref", "width", "height", "byte_size", "sha256"):
        assert f"live_chart_images.{column}" in selected
    for metadata in body["chart_images"].values():
        response = client.get(metadata["url"], headers=ADMIN)
        assert response.status_code == 200, response.text


def test_chart_image_urls_quote_turn_ref_and_source(client, session_factory, chart_turn):
    ref = "chart:one"
    with session_factory() as db:
        source = db.query(LiveSource).filter_by(project_id="live-project-1").one()
        turn = db.query(LiveTurn).filter_by(source_id=source.id, turn_id=TURN_ID).one()
        turn.turn_id = "trace/1"
        turn.summary = {"charts": [{"ref": ref}]}
        db.commit()
    uploaded = _upload(client, turn_id="trace/1", ref=ref)
    assert uploaded.status_code == 204, uploaded.text
    with session_factory() as db:
        source = db.query(LiveSource).filter_by(project_id="live-project-1").one()
        source.key = "worker:blue"
        db.commit()
    for path in ("trace%2F1", "trace/1"):
        response = client.get(
            f"{CHART_BASE}/turns/{path}",
            headers=ADMIN,
            params={"source": "worker:blue"},
        )
        assert response.status_code == 200, response.text
        url = response.json()["chart_images"][ref]["url"]
        assert url == (
            f"{CHART_BASE}/chart-image?source=worker%3Ablue"
            f"&turn_id=trace%2F1&ref=chart%3Aone"
            f"&v={hashlib.sha256(_png()).hexdigest()[:16]}"
        )
        response = client.get(url, headers=ADMIN)
        assert response.status_code == 200, response.text
        assert response.content == _png()


def test_turn_detail_with_chart_image_suffix(client, session_factory, chart_turn):
    turn_id = f"{TURN_ID}/charts/{REF}/image"
    with session_factory() as db:
        source = db.query(LiveSource).filter_by(project_id="live-project-1").one()
        turn = db.query(LiveTurn).filter_by(source_id=source.id, turn_id=TURN_ID).one()
        turn.turn_id = turn_id
        db.commit()
    uploaded = _upload(client, turn_id=turn_id)
    assert uploaded.status_code == 204, uploaded.text
    response = client.get(f"{CHART_BASE}/turns/{turn_id}", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["turn"]["turn_id"] == turn_id
    response = client.get(body["chart_images"][REF]["url"], headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.content == _png()


def test_chart_image_url_includes_root_path(client, chart_turn, monkeypatch):
    uploaded = _upload(client)
    assert uploaded.status_code == 204, uploaded.text
    monkeypatch.setattr(client.app, "root_path", "/qym")
    response = client.get(f"{CHART_BASE}/turns/{TURN_ID}", headers=ADMIN)
    assert response.status_code == 200, response.text
    url = response.json()["chart_images"][REF]["url"]
    assert url == (
        f"/qym{CHART_BASE}/chart-image?source=worker-1&turn_id={TURN_ID}"
        f"&ref={REF}&v={hashlib.sha256(_png()).hexdigest()[:16]}"
    )
    response = client.get(url, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.content == _png()


def test_chart_image_is_scoped_to_selected_source(client, session_factory, chart_turn):
    uploaded = _upload(client)
    assert uploaded.status_code == 204, uploaded.text
    # The other project has the same source key and turn id, but no image.
    response = client.get(
        f"{BASE}/chart-image",
        headers=ADMIN,
        params={"turn_id": TURN_ID, "ref": REF},
    )
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "chart image not found"}
    response = client.get(f"{BASE}/turns/{TURN_ID}", headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.json()["chart_images"] == {}
    with session_factory() as db:
        source = LiveSource(
            project_id="live-project-1",
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
                turn_id=TURN_ID,
                turn_at=datetime(2026, 11, 1),
                status="completed",
                question="Other",
            )
        )
        db.commit()
    response = client.get(
        f"{CHART_BASE}/chart-image",
        headers=ADMIN,
        params={"source": "other", "turn_id": TURN_ID, "ref": REF},
    )
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "chart image not found"}
    response = client.get(
        f"{CHART_BASE}/chart-image",
        headers=ADMIN,
        params={"source": "worker-1", "turn_id": TURN_ID, "ref": REF},
    )
    assert response.status_code == 200, response.text
    assert response.content == _png()


def test_chart_image_requires_project_access(client, session_factory, chart_turn):
    uploaded = _upload(client)
    assert uploaded.status_code == 204, uploaded.text
    with session_factory() as db:
        _seed_api_key(db, token="other-project-token", suffix="2")
    headers = {"X-User-Email": "live-owner-2@example.test"}
    url = f"{CHART_BASE}/turns/{TURN_ID}"
    detail = client.get(url, headers=headers)
    assert detail.status_code == 403, detail.text
    etag = f'"{hashlib.sha256(_png()).hexdigest()}"'
    response = client.get(
        f"{CHART_BASE}/chart-image",
        params={"turn_id": TURN_ID, "ref": REF},
        headers={**headers, "If-None-Match": etag},
    )
    assert response.status_code == detail.status_code, response.text
    assert response.json() == detail.json()


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
    assert response.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0] == [
        "time",
        "day",
        "turn_id",
        "question",
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
    assert [row[3] for row in rows[1:]] == [
        "Question 1: ما المبيعات؟",
        "Question 2",
        "Question 3",
        "Question 4",
        "Question 5",
        "Question 6",
    ]
    assert rows[1][13:16] == ["1.0", "ok", "1.0"]
    assert rows[-1][13] == rows[-1][-1] == ""


@pytest.mark.parametrize("prefix", ["=", "+", "-", "@", "\t"])
def test_csv_neutralises_formula_cells(client, session_factory, prefix):
    with session_factory() as db:
        turn = db.query(LiveTurn).filter_by(turn_id=f"turn-{DAY}-0").one()
        turn.question = prefix + "ما المبيعات؟"
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
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 1
    row = rows[0]
    assert row["question"] == "'" + prefix + "ما المبيعات؟"
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
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 540
    assert [row["turn_id"] for row in rows[:500]] == [
        f"export-{index}" for index in reversed(range(500))
    ]
    assert [row["question"] for row in rows[:500]] == [
        f"Export {index}" for index in reversed(range(500))
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
