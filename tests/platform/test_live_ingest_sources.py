"""Project-scoped live source ingestion on SQLite and PostgreSQL."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.db.models import (
    ApiKey,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.security import api_key_prefix, hash_api_key

TOKEN = "live-test-token"
BASE = "/v1/projects/live-project-1/live/sources/worker-1"
SOURCE = {"name": "Production worker", "environment": "production"}


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


def _auth_headers(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_api_key(session: Session, token: str = TOKEN, suffix: str = "1") -> None:
    user = User(
        id=f"live-user-{suffix}",
        email=f"live-owner-{suffix}@example.test",
        role=UserRole.MEMBER,
    )
    session.add(user)
    session.flush()
    project = Project(
        id=f"live-project-{suffix}",
        name=f"Live project {suffix}",
        slug=f"live-project-{suffix}",
        created_by_user_id=user.id,
    )
    session.add(project)
    session.flush()
    session.add_all(
        [
            ProjectMembership(
                project_id=project.id, user_id=user.id, role=ProjectRole.MANAGER
            ),
            ApiKey(
                id=f"live-key-{suffix}",
                user_id=user.id,
                project_id=project.id,
                name="live worker",
                prefix=api_key_prefix(token),
                key_hash=hash_api_key(token),
                scopes=[],
            ),
        ]
    )
    session.commit()


@pytest.fixture()
def session_factory(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as session:
        _seed_api_key(session)
    return factory


def _create_source(client, **values):
    response = client.put(BASE, headers=_auth_headers(), json={**SOURCE, **values})
    assert response.status_code == 201, response.text
    return response.json()


def test_put_source_creates_then_updates(client, session_factory):
    created = _create_source(
        client, product="Assistant", worker={"worker_version": "1"}
    )
    assert created == {
        "id": created["id"],
        "key": "worker-1",
        **SOURCE,
        "product": "Assistant",
        "worker": {"worker_version": "1"},
        "created_at": created["created_at"],
    }
    assert created["created_at"].endswith("Z")
    response = client.put(
        BASE,
        headers=_auth_headers(),
        json={**SOURCE, "name": "Renamed worker", "worker": {"worker_version": "2"}},
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["created_at"] == created["created_at"]
    assert updated["name"] == "Renamed worker"
    assert updated["worker"] == {"worker_version": "2"}
    with session_factory() as session:
        source = session.query(LiveSource).one()
        assert source.name == "Renamed worker"
        assert source.day_key_timezone == "UTC"


def test_key_of_another_project_is_403(client, session_factory):
    with session_factory() as session:
        _seed_api_key(session, token="other-live-token", suffix="2")
    other_base = BASE.replace("live-project-1", "live-project-2")
    created = client.put(
        other_base, headers=_auth_headers("other-live-token"), json=SOURCE
    )
    assert created.status_code == 201
    response = client.put(other_base, headers=_auth_headers(), json=SOURCE)
    assert response.status_code == 403
    assert response.json() == {"detail": "API key belongs to another project"}


def test_archived_project_is_409(client, session_factory):
    with session_factory() as session:
        session.get(Project, "live-project-1").is_active = False
        session.commit()
    response = client.put(BASE, headers=_auth_headers(), json=SOURCE)
    assert response.status_code == 409
    assert response.json() == {
        "detail": "Project is archived; its API keys stop working until an admin unarchives it"
    }
    with session_factory() as session:
        assert session.query(LiveSource).count() == 0


def test_bad_source_key_is_422(client):
    response = client.put(
        BASE.replace("worker-1", "a/b"), headers=_auth_headers(), json=SOURCE
    )
    assert response.status_code == 422


def test_heartbeat_updates_source_and_day_counters(
    client, session_factory, monkeypatch
):
    _create_source(client, worker={"worker_version": "1", "suite": "daily"})
    from qym_platform.services import live_ingest

    now = datetime(2026, 11, 1, 12)
    for seconds in (0, 120):
        received_at = now + timedelta(seconds=seconds)
        monkeypatch.setattr(live_ingest, "utcnow", lambda: received_at)
        response = client.post(
            BASE + "/heartbeat",
            headers=_auth_headers(),
            json={
                "at": "2026-11-01T10:00:00Z",
                "last_poll_at": "2026-11-01T13:01:00+03:00",
                "current_day": "2026-11-01",
                "worker": {"worker_version": "2"},
            },
        )
        assert response.status_code == 204
        assert response.content == b""
    with session_factory() as session:
        source = session.query(LiveSource).one()
        assert source.last_heartbeat_at == datetime(2026, 11, 1, 12, 2)
        assert source.last_poll_at == datetime(2026, 11, 1, 10, 1)
        assert source.worker == {"worker_version": "2", "suite": "daily"}
        day = session.query(LiveDay).one()
        assert day.day == date(2026, 11, 1)
        assert day.status == "running"
        assert day.polls == 2
        assert day.max_poll_gap_s == 120


def test_heartbeat_out_of_order_never_goes_negative(
    client, session_factory, monkeypatch
):
    _create_source(client)
    from qym_platform.services import live_ingest

    for now, at in (
        (datetime(2026, 11, 1, 12), "2026-11-01T11:00:00Z"),
        (datetime(2026, 11, 1, 11, 59), "2026-11-01T10:00:00Z"),
    ):
        monkeypatch.setattr(live_ingest, "utcnow", lambda: now)
        response = client.post(
            BASE + "/heartbeat",
            headers=_auth_headers(),
            json={"at": at, "current_day": "2026-11-01"},
        )
        assert response.status_code == 204
    with session_factory() as session:
        day = session.query(LiveDay).one()
        assert day.polls == 2
        assert day.max_poll_gap_s == 0
        assert session.query(LiveSource).one().last_heartbeat_at == datetime(
            2026, 11, 1, 11, 59
        )


def test_metric_specs_replace_the_set(client, session_factory):
    _create_source(client)
    specs = [
        {
            "metric_name": name,
            "group": "quality",
            "label": name.title(),
            "score_type": "percentage",
            "direction": "maximize",
            "position": position,
        }
        for position, name in enumerate(("accuracy", "compliance", "coverage"))
    ]
    response = client.put(
        BASE + "/metric-specs", headers=_auth_headers(), json={"specs": specs}
    )
    assert response.status_code == 200
    assert response.json() == {"count": 3}
    specs[0]["label"] = "Answer accuracy"
    response = client.put(
        BASE + "/metric-specs", headers=_auth_headers(), json={"specs": specs[:2]}
    )
    assert response.status_code == 200
    assert response.json() == {"count": 2}
    with session_factory() as session:
        rows = session.query(LiveMetricSpec).order_by(LiveMetricSpec.position).all()
        assert [row.metric_name for row in rows] == ["accuracy", "compliance"]
        assert rows[0].label == "Answer accuracy"
        assert rows[0].group_name == "quality"


def test_metric_specs_reject_two_primaries(client, session_factory):
    _create_source(client)
    specs = [
        {
            "metric_name": name,
            "group": "quality",
            "label": name.title(),
            "score_type": "percentage",
            "is_primary": True,
        }
        for name in ("accuracy", "compliance")
    ]
    response = client.put(
        BASE + "/metric-specs", headers=_auth_headers(), json={"specs": specs[:1]}
    )
    assert response.status_code == 200, response.text
    response = client.put(
        BASE + "/metric-specs", headers=_auth_headers(), json={"specs": specs}
    )
    assert response.status_code == 422, response.text
    assert any(
        "at most one metric may be primary" in error["msg"]
        for error in response.json()["detail"]
    )
    with session_factory() as session:
        assert session.query(LiveMetricSpec).one().metric_name == "accuracy"


def test_day_upsert_keeps_counters(client, session_factory):
    _create_source(client)
    response = client.put(BASE + "/days/2026-11-01", headers=_auth_headers(), json={})
    assert response.status_code == 200
    created = response.json()
    assert created["status"] == "running"
    with session_factory() as session:
        day = session.query(LiveDay).one()
        day.polls = 3
        day.max_poll_gap_s = 120
        session.commit()
    body = {
        "run_ref": "daily-1",
        "status": "closed",
        "turns_seen": 47,
        "evaluated": 40,
        "failed": 2,
        "incomplete": 1,
        "excluded": 4,
        "first_poll_at": "2026-11-01T00:00:00Z",
        "last_poll_at": "2026-11-01T23:59:00Z",
        "closed_at": "2026-11-02T03:00:00+03:00",
        "parameters": {"suite": "daily"},
    }
    response = client.put(BASE + "/days/2026-11-01", headers=_auth_headers(), json=body)
    assert response.status_code == 200
    assert response.json() == {
        **body,
        "id": created["id"],
        "source_id": created["source_id"],
        "day": "2026-11-01",
        "closed_at": "2026-11-02T00:00:00Z",
        "polls": 3,
        "max_poll_gap_s": 120,
    }
    with session_factory() as session:
        day = session.query(LiveDay).one()
        assert (
            day.turns_seen,
            day.evaluated,
            day.failed,
            day.incomplete,
            day.excluded,
        ) == (47, 40, 2, 1, 4)
        assert day.closed_at == datetime(2026, 11, 2)


def test_maintenance_mode_closes_live_ingest(client, session_factory, monkeypatch):
    from qym_platform.settings import PlatformSettings

    monkeypatch.setattr(
        "qym_platform.api.ingest.ingest_settings",
        lambda: PlatformSettings(maintenance_mode=True),
    )
    response = client.put(BASE, headers=_auth_headers(), json=SOURCE)
    assert response.status_code == 503 and response.headers["Retry-After"] == "60"
    heartbeat = client.post(
        f"{BASE}/heartbeat", headers=_auth_headers(), json={"at": "2026-11-01T09:00:00Z"}
    )
    assert heartbeat.status_code == 503
    with session_factory() as session:
        assert session.query(LiveSource).count() == 0
