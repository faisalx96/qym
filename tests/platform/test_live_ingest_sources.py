"""Project-scoped live source ingestion on SQLite and PostgreSQL."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.db.models import (
    ApiKey,
    LiveCanaryResult,
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
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.settings import PlatformSettings

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
        client,
        product="Assistant",
        worker={"worker_version": "1"},
        day_key_timezone="Asia/Riyadh",
    )
    assert created == {
        "id": created["id"],
        "key": "worker-1",
        **SOURCE,
        "product": "Assistant",
        "day_key_timezone": "Asia/Riyadh",
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
    assert updated["day_key_timezone"] == "Asia/Riyadh"
    assert updated["name"] == "Renamed worker"
    assert updated["worker"] == {"worker_version": "2"}
    with session_factory() as session:
        source = session.query(LiveSource).one()
        assert source.name == "Renamed worker"
        assert source.day_key_timezone == "Asia/Riyadh"


@pytest.mark.parametrize("zone", [None, "UTC", "Asia/Riyadh"])
def test_put_source_timezone_defaults_and_explicit_updates(
    client, session_factory, zone
):
    created = _create_source(client)
    assert created["day_key_timezone"] == "UTC"
    with session_factory() as session:
        source = session.query(LiveSource).one()
        assert source.day_key_timezone == "UTC"
        source.day_key_timezone = "Asia/Riyadh"
        session.commit()
    response = client.put(
        BASE, headers=_auth_headers(), json={**SOURCE, "day_key_timezone": zone}
    )
    assert response.status_code == 200, response.text
    expected = zone or "Asia/Riyadh"
    assert response.json()["day_key_timezone"] == expected
    with session_factory() as session:
        assert session.query(LiveSource).one().day_key_timezone == expected


@pytest.mark.parametrize("zone", ["Unknown/Timezone", "/UTC", "../UTC", "Asia"])
def test_put_source_unknown_timezone_is_422(client, session_factory, zone):
    response = client.put(
        BASE, headers=_auth_headers(), json={**SOURCE, "day_key_timezone": zone}
    )
    assert response.status_code == 422, response.text
    assert any(
        error["loc"] == ["body", "day_key_timezone"]
        and "day_key_timezone is not a known timezone" in error["msg"]
        for error in response.json()["detail"]
    )
    with session_factory() as session:
        assert session.query(LiveSource).count() == 0


def test_put_source_preserves_heartbeat_control(client, session_factory):
    created = _create_source(
        client, product="Assistant", worker={"worker_version": "1", "suite": "daily"}
    )
    control = {"state": "running", "settings_version_applied": 3}
    response = client.post(
        BASE + "/heartbeat",
        headers=_auth_headers(),
        json={"at": "2026-11-01T10:00:00Z", "worker": {"control": control}},
    )
    assert response.status_code == 204
    with session_factory() as session:
        assert session.query(LiveSource).one().worker["control"] == control

    response = client.put(
        BASE,
        headers=_auth_headers(),
        json={**SOURCE, "name": "Renamed worker", "worker": {"worker_version": "2"}},
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["name"] == "Renamed worker"
    assert updated["product"] is None
    assert updated["worker"] == {"worker_version": "2", "control": control}
    with session_factory() as session:
        source = session.query(LiveSource).one()
        assert source.worker == {"worker_version": "2", "control": control}


@pytest.mark.parametrize(
    "stored_worker, worker, expected",
    [
        ({"worker_version": "1"}, None, None),
        ({"control": None, "worker_version": "1"}, None, {"control": None}),
        (
            {"control": {"state": "running"}, "worker_version": "1"},
            None,
            {"control": {"state": "running"}},
        ),
        ({"control": {"state": "running"}}, {}, {"control": {"state": "running"}}),
        (
            {"control": {"state": "running"}},
            {"control": {"state": "paused"}},
            {"control": {"state": "paused"}},
        ),
        ({"control": {"state": "running"}}, {"control": None}, {"control": None}),
    ],
)
def test_upsert_source_control_replacement_rules(
    client, session_factory, stored_worker, worker, expected
):
    from qym_platform.api.live_ingest import SourceBody
    from qym_platform.services.live_ingest import upsert_source

    _create_source(client, worker=stored_worker)
    # SourceBody rejects null over HTTP; exercise the service's compatibility path.
    body = SourceBody.model_construct(**SOURCE, worker=worker)
    with session_factory() as session:
        source, created = upsert_source(session, "live-project-1", "worker-1", body)
        assert created is False
        assert source.worker == expected


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
    assert response.json()["detail"] == "API key belongs to another project"


def test_archived_project_is_409(client, session_factory):
    with session_factory() as session:
        session.get(Project, "live-project-1").is_active = False
        session.commit()
    response = client.put(BASE, headers=_auth_headers(), json=SOURCE)
    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "Project is archived; its API keys stop working until an admin unarchives it"
    )
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
        f"{BASE}/heartbeat",
        headers=_auth_headers(),
        json={"at": "2026-11-01T09:00:00Z"},
    )
    assert heartbeat.status_code == 503
    with session_factory() as session:
        assert session.query(LiveSource).count() == 0


def test_metric_threshold_must_be_finite(client, session_factory):
    _create_source(client)
    for number in ("nan", "inf", "-inf"):
        response = client.put(
            BASE + "/metric-specs",
            headers={**_auth_headers(), "Content-Type": "application/json"},
            content=json.dumps(
                {
                    "specs": [
                        {
                            "metric_name": "accuracy",
                            "group": "quality",
                            "label": "Accuracy",
                            "score_type": "percentage",
                            "pass_threshold": float(number),
                        }
                    ]
                }
            ),
        )
        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "specs", 0, "pass_threshold"]
            and "pass_threshold must be finite" in error["msg"]
            for error in response.json()["detail"]
        )
    with session_factory() as session:
        assert session.query(LiveMetricSpec).count() == 0


@pytest.mark.parametrize(
    "field", ["turns_seen", "evaluated", "failed", "incomplete", "excluded"]
)
def test_day_counters_are_bounded_to_int32(client, session_factory, field):
    _create_source(client)
    response = client.put(
        BASE + "/days/2026-11-01", headers=_auth_headers(), json={field: 2147483647}
    )
    assert response.status_code == 200, response.text
    assert response.json()[field] == 2147483647
    response = client.put(
        BASE + "/days/2026-11-01", headers=_auth_headers(), json={field: 2147483648}
    )
    assert response.status_code == 422, response.text
    assert any(
        error["loc"] == ["body", field] and error["type"] == "less_than_equal"
        for error in response.json()["detail"]
    )
    with session_factory() as session:
        assert getattr(session.query(LiveDay).one(), field) == 2147483647


@pytest.mark.parametrize("error_type", [DataError, IntegrityError])
def test_commit_value_errors_are_conflicts_and_roll_back(
    client, session_factory, error_type
):
    _create_source(client)

    def refuse_commit(session):
        session.flush()
        raise error_type("UPDATE live_sources", {}, ValueError("out of range"))

    event.listen(session_factory, "before_commit", refuse_commit)
    try:
        response = client.put(
            BASE, headers=_auth_headers(), json={**SOURCE, "name": "Rejected"}
        )
    finally:
        event.remove(session_factory, "before_commit", refuse_commit)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Live ingest conflicts with existing data"
    with session_factory() as session:
        assert session.query(LiveSource).one().name == SOURCE["name"]


@pytest.mark.parametrize("length", ["declared", "missing", "understated"])
@pytest.mark.parametrize(
    "method,path,body,status",
    [
        ("PUT", "", {**SOURCE, "name": "Updated"}, 200),
        ("POST", "/heartbeat", {"at": "2026-11-01T10:00:00Z"}, 204),
        ("PUT", "/metric-specs", {"specs": []}, 200),
        ("PUT", "/days/2026-11-01", {"turns_seen": 1}, 200),
        (
            "POST",
            "/turns",
            {
                "turns": [
                    {
                        "turn_id": "turn-1",
                        "turn_at": "2026-11-01T10:00:00Z",
                        "status": "completed",
                        "question": "Question",
                    }
                ]
            },
            200,
        ),
        (
            "POST",
            "/canaries",
            {
                "results": [
                    {
                        "canary": "database",
                        "checked_at": "2026-11-01T10:00:00Z",
                        "status": "ok",
                    }
                ]
            },
            200,
        ),
    ],
)
def test_live_body_limit_covers_every_write(
    client, session_factory, monkeypatch, method, path, body, status, length
):
    _create_source(client)
    limit = 1_048_576
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_ingest_max_body_bytes=limit),
    )
    raw = json.dumps(body).encode("utf-8")
    at_limit = raw + b" " * (limit - len(raw))
    headers = {**_auth_headers(), "Content-Type": "application/json"}
    if length == "understated":
        headers["Content-Length"] = "1"
    content = at_limit + b" "
    if length != "declared":
        content = iter([content[:limit], content[limit:]])
    response = client.request(method, BASE + path, headers=headers, content=content)
    assert response.status_code == 413, response.text
    assert f"{limit} byte limit" in response.json()["detail"]
    assert "send smaller batches" in response.json()["detail"]
    with session_factory() as session:
        source = session.query(LiveSource).one()
        assert source.name == SOURCE["name"] and source.last_heartbeat_at is None
        for model in (LiveDay, LiveMetricSpec, LiveTurn, LiveCanaryResult):
            assert session.query(model).count() == 0
    response = client.request(method, BASE + path, headers=headers, content=at_limit)
    assert response.status_code == status, response.text


@pytest.mark.parametrize(
    "content,content_type",
    [
        (b"{", "application/json"),
        (b"", "application/json"),
        (b"[]", "application/json"),
        (b"{}", "application/json"),
        (json.dumps({**SOURCE, "extra": True}).encode(), "application/json"),
        (json.dumps(SOURCE).encode(), "text/plain"),
    ],
)
def test_capped_body_preserves_validation_errors(
    client, session_factory, content, content_type
):
    response = client.put(
        BASE, headers={**_auth_headers(), "Content-Type": content_type}, content=content
    )
    assert response.status_code == 422, response.text
    assert isinstance(response.json()["detail"], list)
    assert all(error["loc"][0] == "body" for error in response.json()["detail"])
    with session_factory() as session:
        assert session.query(LiveSource).count() == 0


@pytest.mark.parametrize("service", ["main", "ingestion"])
def test_live_write_openapi_keeps_body_schemas(service):
    from qym_platform.app import create_app, create_ingestion_app

    factory = create_ingestion_app if service == "ingestion" else create_app
    app = factory(PlatformSettings(service=service, database_url="sqlite://"))
    document = app.openapi()
    schemas = document["components"]["schemas"]
    base = "/v1/projects/{project_id}/live/sources/{key}"
    prefixes = ("", "/ingestion") if service == "ingestion" else ("",)
    for prefix in prefixes:
        for method, suffix, model, required in (
            ("put", "", "SourceBody", ["name", "environment"]),
            ("post", "/heartbeat", "HeartbeatBody", ["at"]),
            ("put", "/metric-specs", "MetricSpecsBody", ["specs"]),
            ("put", "/days/{day}", "DayBody", []),
            ("post", "/turns", "TurnsBody", ["turns"]),
            ("post", "/canaries", "CanariesBody", ["results"]),
        ):
            operation = document["paths"][prefix + base + suffix][method]
            assert "requestBody" in operation, (service, method, suffix)
            body = operation["requestBody"]
            assert body["required"] is True
            assert body["content"]["application/json"]["schema"] == {
                "$ref": f"#/components/schemas/{model}"
            }
            assert schemas[model]["title"] == model
            assert schemas[model].get("required", []) == required
            assert schemas[model]["additionalProperties"] is False
    for model, field, item_model, required in (
        ("MetricSpecsBody", "specs", "MetricSpecBody", "metric_name"),
        ("CanariesBody", "results", "CanaryBody", "checked_at"),
    ):
        assert schemas[model]["properties"][field]["items"] == {
            "$ref": f"#/components/schemas/{item_model}"
        }
        assert required in schemas[item_model]["required"]
        assert schemas[item_model]["additionalProperties"] is False


def test_deeply_nested_json_returns_422_without_server_error(
    client, session_factory, caplog
):
    _create_source(client)
    with caplog.at_level(
        logging.ERROR, logger="qym_platform.middleware.request_context"
    ):
        response = client.post(
            BASE + "/turns",
            headers={**_auth_headers(), "Content-Type": "application/json"},
            content="[" * 1200 + "]" * 1200,
        )
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == [
        {"type": "json_invalid", "loc": ["body"], "msg": "JSON nesting too deep"}
    ]
    assert not [
        record
        for record in caplog.records
        if record.name == "qym_platform.middleware.request_context"
        and record.levelno >= logging.ERROR
    ]
    with session_factory() as session:
        assert session.query(LiveTurn).count() == 0
