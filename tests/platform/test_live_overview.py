"""Project-scoped live overview reads on SQLite and PostgreSQL."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from _live_support import seed_week
from qym_platform.db.models import (
    ApiKey,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)

ADMIN = {"X-User-Email": "owner@example.test"}
BASE = "/api/projects/test/live"


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setattr(
        "qym_platform.services.live_overview.utcnow", lambda: datetime(2026, 11, 1, 12)
    )


@pytest.fixture()
def session_factory(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_week(db, "p")
        db.commit()
    return factory


def _overview(client, **params):
    response = client.get(f"{BASE}/overview", headers=ADMIN, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_sources_lists_stale_flag(client, session_factory, monkeypatch):
    response = client.get(BASE, headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["default_source"] == "worker-1"
    assert body["sources"][0]["desired_state"] == "running"
    assert body["sources"][0]["worker_key_set"] is False
    assert body["sources"][0]["errors_last_hour"] == 0
    assert body["sources"][0]["stale"] is True
    assert body["sources"][0]["seconds_since_heartbeat"] is None
    assert body["sources"][0]["last_poll_at"] is None

    from qym_platform.services import live_overview

    now = datetime(2026, 11, 1, 12)
    monkeypatch.setattr(live_overview, "utcnow", lambda: now)
    with session_factory() as db:
        source = db.query(LiveSource).one()
        source.last_heartbeat_at = now - timedelta(seconds=10)
        source.last_poll_at = now - timedelta(seconds=40)
        db.add(
            ApiKey(
                id="worker-key", project_id="p", user_id="u", name="Worker",
                prefix="worker", key_hash=b"hash",
            )
        )
        db.flush()
        source.worker_key_id = "worker-key"
        source.desired_state = "paused"
        source.worker = {**source.worker, "control": {"errors_last_hour": 3}}
        db.add(
            LiveSource(
                project_id="p",
                key="worker-2",
                name="Second worker",
                environment="test",
                is_active=False,
                last_heartbeat_at=now - timedelta(seconds=1),
            )
        )
        db.commit()
    body = client.get(BASE, headers=ADMIN).json()
    assert body["default_source"] == "worker-1"
    source = next(row for row in body["sources"] if row["key"] == "worker-1")
    assert source["desired_state"] == "paused"
    assert source["worker_key_set"] is True
    assert source["errors_last_hour"] == 3
    assert source["stale"] is False
    assert source["seconds_since_heartbeat"] == 10
    assert source["last_heartbeat_at"] == "2026-11-01T11:59:50Z"
    assert source["last_poll_at"] == "2026-11-01T11:59:20Z"
    assert _overview(client, source="worker-1")["status"]["last_poll_at"] == source[
        "last_poll_at"
    ]
    assert source["last_turn_at"] == "2026-11-01T10:05:00Z"
    assert source["product"] == "Assistant"
    assert source["worker"]["judges"] == {"a": "judge-a", "b": "judge-b"}
    monkeypatch.setattr(live_overview, "utcnow", lambda: now + timedelta(seconds=291))
    body = client.get(BASE, headers=ADMIN).json()
    assert next(row for row in body["sources"] if row["key"] == "worker-1")["stale"]
    with session_factory() as db:
        db.query(LiveSource).filter_by(key="worker-2").one().is_active = True
        db.commit()
    assert client.get(BASE, headers=ADMIN).json()["default_source"] == "worker-2"
    with session_factory() as db:
        for source in db.query(LiveSource):
            source.is_active = False
            source.last_heartbeat_at = None
        db.commit()
    assert client.get(BASE, headers=ADMIN).json()["default_source"] is None
    assert _overview(client, source="worker-1")["status"]["key"] == "worker-1"


@pytest.mark.parametrize(
    "control",
    [
        "legacy",
        {"errors_last_hour": "unknown"},
        {"errors_last_hour": "3"},
        {"errors_last_hour": True},
        {"errors_last_hour": -1},
        {"errors_last_hour": 1.5},
    ],
)
def test_sources_malformed_heartbeat_control(client, session_factory, control):
    from qym_platform.services.live_ingest import record_heartbeat

    now = datetime(2026, 11, 3, 12)
    with session_factory() as db:
        source = db.query(LiveSource).one()
        record_heartbeat(db, source, now, None, None, {"control": control}, now)
        db.commit()
    response = client.get(BASE, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.json()["sources"][0]["errors_last_hour"] == 0


def test_overview_label_mix_and_in_qym_match_rows(client, session_factory):
    body = _overview(client)
    day = body["day"]
    assert day["row"]["day"] == "2026-11-01"
    assert day["row"]["first_poll_at"] == "2026-11-01T00:00:00Z"
    assert day["in_qym"] == 6
    assert day["label_mix"] == {
        "ok": 2,
        "suboptimal": 1,
        "problem_a": 1,
        "problem_b": 1,
        "inconclusive": 1,
    }
    with session_factory() as db:
        assert (
            db.query(LiveTurn).filter_by(day=date(2026, 11, 1)).count() == day["in_qym"]
        )
    assert day["latency"] == {"median_ms": 3500, "p90_ms": 330000, "over_5min": 1}
    assert body["primary_metric"] == "agent_success"
    assert body["status"]["key"] == "worker-1"
    assert len(body["specs"]) == 6
    assert body["canaries"] == [
        {
            "canary": "query",
            "status": "ok",
            "fault": None,
            "latency_ms": 100,
            "checked_at": "2026-11-01T11:00:00Z",
        },
        {
            "canary": "render",
            "status": "failed",
            "fault": "infra",
            "latency_ms": 200,
            "checked_at": "2026-11-01T11:00:00Z",
        },
    ]


def test_metric_means_exclude_skipped_and_null_when_all_skipped(client):
    means = {
        row["metric_name"]: row for row in _overview(client)["day"]["metric_means"]
    }
    assert means["agent_success"]["mean"] == pytest.approx(0.5)
    assert means["agent_success"]["n"] == 5
    assert means["compliance_a"]["mean"] == pytest.approx(2 / 3)
    assert means["chart_fidelity"]["mean"] == pytest.approx(0.7)
    assert means["chart_fidelity"]["n"] == 4
    assert means["agent_success"]["spec"]["is_primary"] is True
    assert means["diagnosis"]["spec"]["values"][2] == {
        "value": "problem_a",
        "label": "Problem A",
        "tone": "danger",
    }
    means = {
        row["metric_name"]: row
        for row in _overview(client, day="2026-10-29")["day"]["metric_means"]
    }
    assert means["chart_fidelity"]["mean"] is None
    assert means["chart_fidelity"]["n"] == 0
    assert means["chart_fidelity"]["spec"]["group"] == "charts"


def test_pushed_day_wins_over_turn_at(client, monkeypatch):
    monkeypatch.setattr(
        "qym_platform.services.live_overview.utcnow", lambda: datetime(2026, 10, 31, 12)
    )
    body = _overview(client, day="2026-10-31", trend_days=2)
    assert body["day"]["in_qym"] == 6
    assert body["day"]["label_mix"]["inconclusive"] == 1
    assert body["day"]["latency"]["over_5min"] == 1
    assert [row["turns"] for row in body["trend"]] == [6, 6]
    assert body["trend"][0]["primary_rate"] == pytest.approx(0.5)
    assert body["trend"][1]["primary_rate"] == pytest.approx(7 / 12)
    days = {row["day"]: row for row in body["days"]["rows"]}
    assert days["2026-10-30"]["in_qym"] == 6
    assert days["2026-10-31"]["in_qym"] == 6
    assert days["2026-10-31"]["primary_rate"] == pytest.approx(7 / 12)


def test_service_rates_and_fault_breakdown(client, session_factory):
    services = {row["name"]: row for row in _overview(client)["day"]["services"]}
    assert set(services) == {"service.sql_generation", "service.viz_agent"}
    assert services["service.sql_generation"] == {
        "name": "service.sql_generation",
        "ok_rate": pytest.approx(2 / 3),
        "n": 6,
        "fault_breakdown": {"infra": 2},
    }
    assert services["service.viz_agent"] == {
        "name": "service.viz_agent",
        "ok_rate": pytest.approx(5 / 6),
        "n": 6,
        "fault_breakdown": {"infra": 1},
    }
    with session_factory() as db:
        spec = (
            db.query(LiveMetricSpec)
            .filter_by(metric_name="service.sql_generation")
            .one()
        )
        spec.pass_threshold = 0
        db.commit()
    services = {row["name"]: row for row in _overview(client)["day"]["services"]}
    assert services["service.sql_generation"] == {
        "name": "service.sql_generation",
        "ok_rate": 1.0,
        "n": 6,
        "fault_breakdown": {},
    }


@pytest.mark.parametrize(
    "day, expected_days",
    [
        ("2026-10-30", ["2026-10-31", "2026-11-01"]),
        ("2026-11-02", ["2026-11-01", "2026-11-02"]),
    ],
)
def test_trend_ends_at_today_or_selected_future_day(client, day, expected_days):
    body = _overview(client, day=day, trend_days=2)
    assert [row["day"] for row in body["trend"]] == expected_days
    if day == "2026-10-30":
        assert body["trend"][-1]["turns"] == 6
        assert body["day"]["row"]["day"] == day
        assert body["day"]["in_qym"] == 6
        assert body["days"]["rows"][0]["day"] == "2026-11-01"


def test_trend_has_one_entry_per_day_with_zeros(client, monkeypatch):
    trend = _overview(client, trend_days=9)["trend"]
    assert [row["day"] for row in trend] == [
        "2026-10-24",
        "2026-10-25",
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
    ]
    assert trend[0] == {
        "day": "2026-10-24",
        "turns": 0,
        "counts_by_label": {},
        "primary_rate": None,
        "worker_gap": False,
    }
    assert [row["turns"] for row in trend] == [0, 0, 5, 5, 6, 6, 6, 6, 6]
    assert sum(row["turns"] for row in trend) == 40
    assert trend[6]["worker_gap"] is True
    assert trend[-1]["primary_rate"] == pytest.approx(0.5)
    monkeypatch.setenv("QYM_LIVE_TREND_MAX_DAYS", "7")
    assert len(_overview(client, trend_days=1000)["trend"]) == 7
    assert len(_overview(client, trend_days=0)["trend"]) == 1
    empty = _overview(client, day="2026-10-24")["day"]
    assert empty["row"] is None
    assert empty["in_qym"] == empty["not_in_qym"] == 0
    assert empty["latency"] == {"median_ms": None, "p90_ms": None, "over_5min": 0}


def test_days_page_marks_worker_gap(client, session_factory):
    body = _overview(client, day="2026-10-30")
    assert body["day"]["worker_gap_s"] == 7200
    page = body["days"]
    assert (page["total"], page["page"], page["page_size"]) == (7, 1, 30)
    assert [row["day"] for row in page["rows"]] == [
        "2026-11-01",
        "2026-10-31",
        "2026-10-30",
        "2026-10-29",
        "2026-10-28",
        "2026-10-27",
        "2026-10-26",
    ]
    assert [row["day"] for row in page["rows"] if row["worker_gap"]] == ["2026-10-30"]
    assert page["rows"][2]["polls"] == 720
    assert page["rows"][2]["max_poll_gap_s"] == 7200
    with session_factory() as db:
        source = db.query(LiveSource).one()
        source.worker = {}
        db.query(LiveDay).filter_by(day=date(2026, 10, 30)).one().max_poll_gap_s = 180
        db.commit()
    assert not _overview(client)["days"]["rows"][2]["worker_gap"]
    with session_factory() as db:
        db.query(LiveDay).filter_by(day=date(2026, 10, 30)).one().max_poll_gap_s = 181
        db.commit()
    assert _overview(client)["days"]["rows"][2]["worker_gap"] is True


@pytest.mark.parametrize("poll_interval", [None, "60"])
def test_worker_gap_tolerates_bad_poll_interval(client, session_factory, poll_interval):
    with session_factory() as db:
        db.query(LiveSource).one().worker = {"poll_interval_s": poll_interval}
        db.query(LiveDay).filter_by(day=date(2026, 10, 30)).one().max_poll_gap_s = 180
        db.commit()
    body = _overview(client)
    assert body["days"]["rows"][2]["worker_gap"] is False
    assert (
        next(row for row in body["trend"] if row["day"] == "2026-10-30")["worker_gap"]
        is False
    )
    with session_factory() as db:
        db.query(LiveDay).filter_by(day=date(2026, 10, 30)).one().max_poll_gap_s = 181
        db.commit()
    body = _overview(client)
    assert body["days"]["rows"][2]["worker_gap"] is True
    assert (
        next(row for row in body["trend"] if row["day"] == "2026-10-30")["worker_gap"]
        is True
    )


def test_days_page_param_pages_older_days(client, session_factory):
    with session_factory() as db:
        source = LiveSource(
            project_id="p", key="worker-2", name="Second worker", environment="test"
        )
        db.add(source)
        db.flush()
        db.add_all(
            LiveDay(source_id=source.id, day=date(2026, 11, 1) - timedelta(days=offset))
            for offset in range(35)
        )
        db.commit()
    first = _overview(client, source="worker-2")["days"]
    assert first["page"] == 1
    assert first["total"] == 35
    assert len(first["rows"]) == 30
    assert first["rows"][0]["day"] == "2026-11-01"
    assert first["rows"][-1]["day"] == "2026-10-03"
    second = _overview(client, source="worker-2", days_page=2)["days"]
    assert (second["page"], second["total"], second["page_size"]) == (2, 35, 30)
    assert [row["day"] for row in second["rows"]] == [
        "2026-10-02",
        "2026-10-01",
        "2026-09-30",
        "2026-09-29",
        "2026-09-28",
    ]
    response = client.get(f"{BASE}/overview", headers=ADMIN, params={"days_page": 0})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "days_page", [1_000_001, 99999999999999999999, 9223372036854775807]
)
def test_days_page_upper_bound_returns_validation_error(
    client, session_factory, days_page
):
    response = client.get(
        f"{BASE}/overview", headers=ADMIN, params={"days_page": days_page}
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["query", "days_page"]


def test_maximum_days_page_returns_empty_rows(client, session_factory):
    days = _overview(client, days_page=1_000_000)["days"]
    assert days["rows"] == []
    assert days["total"] == 7
    assert days["page"] == 1_000_000


def test_primary_rate_uses_the_selected_primary_metric(client, session_factory):
    with session_factory() as db:
        db.query(LiveMetricSpec).filter_by(
            metric_name="compliance_a"
        ).one().is_primary = True
        db.commit()
    body = _overview(client)
    assert body["primary_metric"] == "agent_success"
    assert body["trend"][-1]["primary_rate"] == pytest.approx(0.5)
    assert body["days"]["rows"][0]["primary_rate"] == pytest.approx(0.5)
    with session_factory() as db:
        db.query(LiveMetricSpec).filter_by(
            metric_name="compliance_a"
        ).one().position = 0
        db.commit()
    body = _overview(client)
    assert body["primary_metric"] == "agent_success"
    assert body["trend"][-1]["primary_rate"] == pytest.approx(0.5)
    with session_factory() as db:
        db.query(LiveMetricSpec).filter_by(
            metric_name="agent_success"
        ).one().position = 1
        db.commit()
    body = _overview(client)
    assert body["primary_metric"] == "compliance_a"
    assert body["trend"][-1]["primary_rate"] == pytest.approx(2 / 3)
    assert body["days"]["rows"][0]["primary_rate"] == pytest.approx(2 / 3)
    with session_factory() as db:
        for spec in db.query(LiveMetricSpec):
            spec.is_primary = False
        db.commit()
    body = _overview(client)
    assert body["primary_metric"] is None
    assert all(row["primary_rate"] is None for row in body["trend"])
    assert all(row["primary_rate"] is None for row in body["days"]["rows"])


def test_not_in_qym_is_turns_seen_minus_rows(client, session_factory):
    day = _overview(client)["day"]
    assert day["row"]["turns_seen"] == 8
    assert day["in_qym"] == 6
    assert day["not_in_qym"] == 2
    with session_factory() as db:
        db.query(LiveDay).filter_by(day=date(2026, 11, 1)).one().turns_seen = 2
        db.commit()
    assert _overview(client)["day"]["not_in_qym"] == 0


def test_unknown_source_is_404(client, session_factory):
    response = client.get(
        f"{BASE}/overview", headers=ADMIN, params={"source": "missing"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "live source not found"
    with session_factory() as db:
        db.add(
            Project(
                id="empty", slug="empty", name="Empty project", created_by_user_id="u"
            )
        )
        db.commit()
    response = client.get("/api/projects/empty/live/overview", headers=ADMIN)
    assert response.status_code == 404
    assert response.json()["detail"] == "live source not found"
    response = client.get(f"{BASE}/overview", headers=ADMIN, params={"day": "invalid"})
    assert response.status_code == 422


def test_other_projects_user_is_403(client, session_factory):
    with session_factory() as db:
        db.add(User(id="other-user", email="other@example.test", role=UserRole.MEMBER))
        db.flush()
        db.add(
            Project(
                id="other",
                slug="other",
                name="Other project",
                created_by_user_id="other-user",
            )
        )
        db.flush()
        db.add(
            ProjectMembership(
                project_id="other", user_id="other-user", role=ProjectRole.MEMBER
            )
        )
        db.commit()
    headers = {"X-User-Email": "other@example.test"}
    response = client.get(f"{BASE}/overview", headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Access denied"
    assert client.get(BASE, headers=headers).status_code == 403
