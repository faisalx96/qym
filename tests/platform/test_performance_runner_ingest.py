"""Runner routes: registration, heartbeat, the control document, events and tokens."""

from __future__ import annotations

from datetime import timedelta

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    INSTANCE,
    INSTANCE_HEADER,
    NOW,
    RUNNER_TOKEN,
    TOKENS,
    at_time,
    get_run,
    make_run,
    press_stop,
    progress_numbers,
    progress_report,
    runner_headers,
    runner_path,
    seed_performance,
    seed_runner,
    stamp,
    supply_token,
    token_value,
    use_encryption_key,
)
from qym_platform.api.performance_ingest import performance_ingest_router
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    PerformanceEvent,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTargetToken,
    Project,
    User,
)
from qym_platform.services import performance_control
from qym_platform.settings import PlatformSettings

PROJECT = "performance-project-1"
# A second key of the same project; its first 8 characters differ from the runner key's.
OTHER_TOKEN = "qa-other-project-key"
BASE = runner_path(PROJECT)
REGISTER = {
    "name": "QA - Runner",
    "info": {"runner_version": "0.1.0", "host": "qa-runner-host"},
}
LIMITS = {
    "heartbeat_interval_s": 10,
    "control_interval_idle_s": 10,
    "control_interval_run_s": 2,
    "progress_interval_s": 5,
    "stale_after_s": 120,
    "late_window_s": 600,
    "stop_kill_after_s": 20,
    "progress_max_bytes": 65536,
    "questions_batch_max": 200,
    "questions_max_bytes": 1048576,
    "questions_per_run_max": 50000,
    "log_batch_max": 500,
    "log_max_bytes": 262144,
    "log_lines_per_run_max": 50000,
    "events_batch_max": 100,
    "events_max_bytes": 262144,
    "summary_max_bytes": 262144,
    "report_max_bytes": 5242880,
    "question_chars_max": 2000,
    "answer_chars_max": 1000,
    "log_message_chars_max": 2000,
}


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    at_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_performance(db, other_token=OTHER_TOKEN)
        db.commit()
    return factory


def _refused(response, status: int, code: str, detail: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["message"] == detail
    assert body["detail"] == detail


def _runner(factory) -> PerformanceRunner:
    with factory() as db:
        runner = db.scalars(
            select(PerformanceRunner).where(PerformanceRunner.project_id == PROJECT)
        ).one()
        db.expunge(runner)
        return runner


def _forget_runner(factory) -> None:
    with factory() as db:
        db.delete(db.scalars(select(PerformanceRunner)).one())
        db.commit()


def _event(code: str = "level_passed", **changes):
    return {
        "at": stamp(NOW),
        "level": "info",
        "code": code,
        "message": "Level 10 passed: p95 67.8 s, errors 0.9%",
        "details": {"level": 10},
        **changes,
    }


# --------------------------------------------------------------------------- register


def test_first_registration_creates_the_runner_and_a_repeat_updates_it(
    client, session_factory, monkeypatch
):
    _forget_runner(session_factory)
    response = client.put(BASE, headers=runner_headers(), json=REGISTER)
    assert response.status_code == 201, response.text
    created = response.json()
    assert created == {
        "id": created["id"],
        "key": "runner-1",
        "name": "QA - Runner",
        "info": REGISTER["info"],
        "instance_id": INSTANCE,
        # Nobody has chosen a runner key yet.
        "tokens_disclosed": False,
        "interrupted_run_id": None,
        "created_at": "2026-11-20T11:00:00Z",
        "registered_at": "2026-11-20T11:00:00Z",
    }

    later = at_time(monkeypatch, NOW + timedelta(minutes=5))
    response = client.put(
        BASE,
        headers=runner_headers(),
        json={"name": "QA - Runner 2", "info": {"runner_version": "0.2.0"}},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["created_at"] == created["created_at"]
    assert updated["registered_at"] == "2026-11-20T11:05:00Z"
    assert (updated["name"], updated["info"]) == (
        "QA - Runner 2",
        {"runner_version": "0.2.0"},
    )
    runner = _runner(session_factory)
    assert runner.last_heartbeat_at == later  # a registration counts as a heartbeat
    assert runner.registered_key_id == "performance-key-1"
    assert runner.instance_id == INSTANCE


def test_registration_says_whether_this_key_gets_the_tokens(client, session_factory):
    chosen = client.put(BASE, headers=runner_headers(), json=REGISTER)
    assert chosen.status_code == 200 and chosen.json()["tokens_disclosed"] is True
    other = client.put(BASE, headers=runner_headers(OTHER_TOKEN), json=REGISTER)
    assert other.status_code == 200 and other.json()["tokens_disclosed"] is False


def test_registration_takes_over_the_row_made_when_the_key_was_chosen_first(
    client, session_factory
):
    _forget_runner(session_factory)
    with session_factory() as db:
        project = db.get(Project, PROJECT)
        seed_runner(
            db,
            project,
            api_key=db.get(ApiKey, "performance-key-1"),
            user=db.get(User, "performance-user-owner-1"),
            key="chosen-before-any-runner",
            instance_id=None,
        )
        db.commit()
    never_connected = client.post(
        runner_path(PROJECT, "chosen-before-any-runner") + "/heartbeat",
        headers=runner_headers(),
        json={"at": stamp(NOW), "state": "idle"},
    )
    _refused(never_connected, 404, "runner_not_found", "performance runner not found")

    response = client.put(BASE, headers=runner_headers(), json=REGISTER)
    assert response.status_code == 201, response.text
    assert response.json()["tokens_disclosed"] is True
    assert response.json()["key"] == "runner-1"
    with session_factory() as db:
        runner = db.scalars(select(PerformanceRunner)).one()
        assert (runner.key, runner.runner_key_id) == ("runner-1", "performance-key-1")
        assert runner.instance_id == INSTANCE


def test_a_project_has_one_runner_key(client, session_factory):
    response = client.put(
        runner_path(PROJECT, "runner-2"), headers=runner_headers(), json=REGISTER
    )
    _refused(response, 409, "runner_limit_reached", "this project already has a runner")
    with session_factory() as db:
        assert [row.key for row in db.scalars(select(PerformanceRunner))] == [
            "runner-1"
        ]


def test_a_new_instance_ends_the_run_of_the_one_before_it(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    at_time(monkeypatch, NOW + timedelta(seconds=30))
    response = client.put(
        BASE, headers=runner_headers(instance="instance-2"), json=REGISTER
    )
    assert response.status_code == 200, response.text
    assert response.json()["interrupted_run_id"] == run_id
    assert response.json()["instance_id"] == "instance-2"

    run = get_run(session_factory, run_id)
    assert run.status == "interrupted"
    assert run.finished_at == NOW + timedelta(seconds=30)
    assert run.error == "A new runner process took over; the run was ended"
    assert run.status_reason == "runner_restarted"
    assert run.claim_instance_id == INSTANCE  # the run stays the old instance's
    with session_factory() as db:
        event = db.scalars(select(PerformanceEvent)).one()
        assert (event.code, event.source, event.run_id) == (
            "interrupted",
            "qym",
            run_id,
        )

    # The replaced process learns it on its next runner call and must not go on.
    for call in (
        client.post(
            BASE + "/heartbeat",
            headers=runner_headers(),
            json={"at": stamp(NOW), "state": "running"},
        ),
        client.get(BASE + "/control", headers=runner_headers()),
        client.post(BASE + "/events", headers=runner_headers(), json={"events": []}),
    ):
        _refused(
            call,
            409,
            "instance_mismatch",
            "another runner process holds this runner or run",
        )
    progress = client.post(
        f"{BASE}/runs/{run_id}/progress",
        headers=runner_headers(),
        json=progress_report(2),
    )
    _refused(progress, 409, "run_finished", "run already finished")
    assert progress.json()["error"]["details"] == {"status": "interrupted"}

    # The new process starts idle and can never take the lost run.
    control = client.get(
        BASE + "/control", headers=runner_headers(instance="instance-2")
    )
    assert control.json()["state"] == "idle" and control.json()["run"] is None
    assert control.json()["last_run"]["status"] == "interrupted"
    claim = client.post(
        f"{BASE}/runs/{run_id}/claim",
        headers=runner_headers(instance="instance-2"),
        json={},
    )
    _refused(claim, 409, "run_not_queued", "run is not waiting to be claimed")
    assert get_run(session_factory, run_id).status == "interrupted"


def test_a_new_instance_finds_the_run_already_lost_to_silence(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    at_time(monkeypatch, NOW + timedelta(seconds=500))
    response = client.put(
        BASE, headers=runner_headers(instance="instance-2"), json=REGISTER
    )
    assert response.json()["interrupted_run_id"] == run_id
    run = get_run(session_factory, run_id)
    # It ended when its 120 seconds ran out, not when the new process arrived.
    assert (run.status, run.finished_at) == (
        "interrupted",
        NOW + timedelta(seconds=120),
    )
    assert run.error == "The runner stopped answering; the run was ended"
    assert run.status_reason == "runner_silent"
    with session_factory() as db:
        assert [event.code for event in db.scalars(select(PerformanceEvent))] == [
            "interrupted"
        ]


def test_registering_again_with_the_same_instance_ends_nothing(client, session_factory):
    run_id = make_run(session_factory, status="running")
    response = client.put(BASE, headers=runner_headers(), json=REGISTER)
    assert response.status_code == 200 and response.json()["interrupted_run_id"] is None
    assert get_run(session_factory, run_id).status == "running"


def test_a_queued_run_waits_for_the_new_instance(client, session_factory):
    run_id = make_run(session_factory)
    response = client.put(
        BASE, headers=runner_headers(instance="instance-2"), json=REGISTER
    )
    assert response.json()["interrupted_run_id"] is None
    claim = client.post(
        f"{BASE}/runs/{run_id}/claim",
        headers=runner_headers(instance="instance-2"),
        json={},
    )
    assert claim.status_code == 200, claim.text
    assert get_run(session_factory, run_id).claim_instance_id == "instance-2"


def test_registration_drops_credential_keys_and_checks_the_body(
    client, session_factory
):
    info = {
        "host": "qa-runner-host",
        "api_key": "never-stored",
        "nested": {"Password": "never-stored", "location": "QA cluster"},
        "note": "Authorization: Bearer abc.def-123",
    }
    response = client.put(
        BASE, headers=runner_headers(), json={"name": "QA - Runner", "info": info}
    )
    assert response.status_code == 200, response.text
    assert response.json()["info"] == {
        "host": "qa-runner-host",
        "nested": {"location": "QA cluster"},
        "note": "Authorization: [REDACTED]",
    }
    assert "never-stored" not in str(_runner(session_factory).info)

    for body in (
        {"info": {}},
        {"name": ""},
        {"name": "QA - Runner", "instance_id": "in-the-body"},
        {"name": "QA - Runner", "info": {"blob": "x" * 9000}},
    ):
        refused = client.put(BASE, headers=runner_headers(), json=body)
        assert refused.status_code == 422, (body.keys(), refused.text)
        assert isinstance(refused.json()["detail"], list)
    not_finite = client.put(
        BASE,
        headers={**runner_headers(), "Content-Type": "application/json"},
        content=b'{"name": "QA - Runner", "info": {"load": NaN}}',
    )
    assert not_finite.status_code == 422


def test_every_route_needs_the_key_the_project_and_the_instance_header(
    client, session_factory
):
    with session_factory() as db:
        seed_performance(db, suffix="2", runner_token="token-2", other_token="other-2")
        db.commit()
    assert (
        client.put(BASE, json=REGISTER, headers={INSTANCE_HEADER: INSTANCE}).status_code
        == 401
    )
    wrong_key = client.put(BASE, json=REGISTER, headers=runner_headers("unknown-token"))
    assert wrong_key.status_code == 401
    other_project = client.put(BASE, json=REGISTER, headers=runner_headers("token-2"))
    assert other_project.status_code == 403
    assert other_project.json()["detail"] == "API key belongs to another project"

    no_instance = client.put(
        BASE, json=REGISTER, headers={"Authorization": f"Bearer {RUNNER_TOKEN}"}
    )
    assert no_instance.status_code == 422
    assert no_instance.json()["detail"][0]["loc"] == ["header", INSTANCE_HEADER]
    bad_instance = client.put(
        BASE, json=REGISTER, headers=runner_headers(instance="has space")
    )
    assert bad_instance.status_code == 422
    bad_key = client.put(
        runner_path(PROJECT, "bad key!"), json=REGISTER, headers=runner_headers()
    )
    assert bad_key.status_code == 422
    with session_factory() as db:
        assert db.scalars(select(PerformanceRunner.key)).all() == [
            "runner-1",
            "runner-1",
        ]


def _concrete(route) -> str:
    return (
        route.path.replace("{project_id}", PROJECT)
        .replace("{key}", "runner-1")
        .replace("{run_id}", "run-1")
        .replace("{name}", "refresh_token")
    )


def test_all_twelve_routes_wait_out_a_maintenance_window(
    client, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "qym_platform.api.ingest.ingest_settings",
        lambda: PlatformSettings(maintenance_mode=True),
    )
    routes = [
        (method, route)
        for route in performance_ingest_router.routes
        for method in route.methods
    ]
    assert len(routes) == 12
    for prefix in ("", "/ingestion"):
        for method, route in routes:
            response = client.request(
                method, prefix + _concrete(route), headers=runner_headers()
            )
            assert response.status_code == 503, (method, route.path)
            assert response.headers["Retry-After"] == "60"
            assert (
                response.json()["detail"]
                == "Platform is in maintenance mode; retry later"
            )


def test_all_twelve_routes_are_closed_when_the_area_is_switched_off(
    client, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "qym_platform.api.performance_ingest.ingest_settings",
        lambda: PlatformSettings(performance_enabled=False),
    )
    for route in performance_ingest_router.routes:
        for method in route.methods:
            response = client.request(
                method, _concrete(route), headers=runner_headers()
            )
            assert response.status_code == 404, (method, route.path)
            assert response.json()["detail"] == "Performance is switched off"
    # The key is still checked first: a stranger learns nothing about the deployment.
    stranger = client.get(BASE + "/control", headers=runner_headers("unknown-token"))
    assert stranger.status_code == 401


def test_the_ingestion_alias_serves_the_same_routes(client, session_factory):
    response = client.post(
        "/ingestion" + BASE + "/heartbeat",
        headers=runner_headers(),
        json={"at": stamp(NOW), "state": "idle", "run_id": None},
    )
    assert response.status_code == 204, response.text


# --------------------------------------------------------------------------- heartbeat


def test_heartbeat_moves_the_runner_and_is_a_sign_of_life_for_its_run(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    later = at_time(monkeypatch, NOW + timedelta(seconds=90))
    response = client.post(
        BASE + "/heartbeat",
        headers=runner_headers(),
        json={"at": "2031-01-01T00:00:00Z", "state": "running", "run_id": run_id},
    )
    assert response.status_code == 204 and response.content == b""
    runner = _runner(session_factory)
    # qym's receive time, never the runner's clock.
    assert runner.last_heartbeat_at == later
    assert (runner.reported_state, runner.current_run_id) == ("running", run_id)
    assert get_run(session_factory, run_id).last_seen_at == later


def test_heartbeat_refusals(client, session_factory):
    body = {"at": stamp(NOW), "state": "idle"}
    unknown = client.post(
        runner_path(PROJECT, "never-registered") + "/heartbeat",
        headers=runner_headers(),
        json=body,
    )
    _refused(unknown, 404, "runner_not_found", "performance runner not found")
    replaced = client.post(
        BASE + "/heartbeat", headers=runner_headers(instance="instance-2"), json=body
    )
    _refused(
        replaced,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    for bad in ({"state": "idle"}, {**body, "state": "sleeping"}, {**body, "extra": 1}):
        assert (
            client.post(
                BASE + "/heartbeat", headers=runner_headers(), json=bad
            ).status_code
            == 422
        )
    assert _runner(session_factory).last_heartbeat_at == NOW


# --------------------------------------------------------------------------- control


def test_control_is_idle_without_a_run_and_answers_304_when_unchanged(
    client, session_factory
):
    response = client.get(BASE + "/control", headers=runner_headers())
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    etag = response.headers["ETag"]
    assert etag.startswith('W/"')
    assert response.json() == {
        "state": "idle",
        "run": None,
        "last_run": None,
        "limits": LIMITS,
    }
    assert performance_control.limits(PlatformSettings()) == LIMITS

    unchanged = client.get(
        BASE + "/control", headers={**runner_headers(), "If-None-Match": etag}
    )
    assert unchanged.status_code == 304
    assert unchanged.content == b"" and unchanged.headers["ETag"] == etag
    unknown = client.get(
        runner_path(PROJECT, "never-registered") + "/control", headers=runner_headers()
    )
    _refused(unknown, 404, "runner_not_found", "performance runner not found")


def test_control_gives_the_queued_run_and_token_values_only_to_the_chosen_key(
    client, session_factory
):
    run_id = make_run(session_factory)
    chosen = client.get(BASE + "/control", headers=runner_headers())
    assert chosen.status_code == 200, chosen.text
    body = chosen.json()
    assert body["state"] == "queued" and body["last_run"] is None
    run = body["run"]
    assert set(run) == {
        "id",
        "number",
        "project_name",
        "status",
        "requested_at",
        "stop_requested",
        "stop_reason",
        "config",
        "tokens",
        "tokens_digest",
        "token_needed",
    }
    assert (run["id"], run["status"], run["requested_at"]) == (
        run_id,
        "queued",
        "2026-11-20T11:00:00Z",
    )
    assert (run["stop_requested"], run["stop_reason"], run["token_needed"]) == (
        False,
        None,
        None,
    )
    assert run["config"] == get_run(session_factory, run_id).config
    # The frozen settings name the tokens, never their values.
    assert run["config"]["tokens"] == [
        {"name": "access_token", "hint": "0c2e", "version": 1},
        {"name": "refresh_token", "hint": "41bd", "version": 1},
    ]
    assert run["tokens"] == [
        {
            "name": name,
            "value": TOKENS[name],
            "hint": TOKENS[name][-4:],
            "version": 1,
            "expires_at": None,
        }
        for name in ("refresh_token", "access_token")
    ]
    assert len(run["tokens_digest"]) == 64

    other = client.get(BASE + "/control", headers=runner_headers(OTHER_TOKEN))
    assert other.status_code == 200, other.text
    withheld = other.json()["run"]
    assert withheld["tokens_withheld"] is True and "tokens" not in withheld
    assert withheld["tokens_digest"] == run["tokens_digest"]
    assert withheld["config"] == run["config"]
    for value in TOKENS.values():
        assert value in chosen.text and value not in other.text
    # Withheld and disclosed documents never validate each other.
    assert other.headers["ETag"] != chosen.headers["ETag"]
    crossed = client.get(
        BASE + "/control",
        headers={
            **runner_headers(OTHER_TOKEN),
            "If-None-Match": chosen.headers["ETag"],
        },
    )
    assert crossed.status_code == 200


def test_control_withholds_tokens_when_no_key_is_chosen(client, session_factory):
    make_run(session_factory)
    with session_factory() as db:
        db.scalars(select(PerformanceRunner)).one().runner_key_id = None
        db.commit()
    response = client.get(BASE + "/control", headers=runner_headers())
    assert response.json()["run"]["tokens_withheld"] is True
    assert all(value not in response.text for value in TOKENS.values())


def test_control_follows_a_stop_and_a_token_hand_off(client, session_factory):
    run_id = make_run(session_factory, status="running")
    running = client.get(BASE + "/control", headers=runner_headers())
    assert running.json()["state"] == "active"
    etag = running.headers["ETag"]

    with session_factory() as db:
        run = db.get(PerformanceRun, run_id)
        run.token_needed = "refresh_token"
        db.commit()
    asked = client.get(
        BASE + "/control", headers={**runner_headers(), "If-None-Match": etag}
    )
    assert asked.status_code == 200
    assert asked.json()["run"]["token_needed"] == "refresh_token"
    # The rejected token is still there: nothing newer exists.
    assert asked.json()["run"]["tokens"][0]["version"] == 1

    with session_factory() as db:
        supply_token(
            db,
            db.get(PerformanceRun, run_id),
            "refresh_token",
            "example-new-refresh-token-7a2e",
        )
        db.commit()
    supplied = client.get(
        BASE + "/control",
        headers={**runner_headers(), "If-None-Match": asked.headers["ETag"]},
    )
    assert supplied.status_code == 200
    document = supplied.json()["run"]
    assert document["token_needed"] is None
    assert document["tokens"][0] == {
        "name": "refresh_token",
        "value": "example-new-refresh-token-7a2e",
        "hint": "7a2e",
        "version": 2,
        "expires_at": None,
    }
    assert document["tokens_digest"] != running.json()["run"]["tokens_digest"]

    with session_factory() as db:
        press_stop(db, db.get(PerformanceRun, run_id), reason="QA - target is needed")
        db.commit()
    stopping = client.get(
        BASE + "/control",
        headers={**runner_headers(), "If-None-Match": supplied.headers["ETag"]},
    )
    assert stopping.status_code == 200
    assert stopping.json()["state"] == "stopping"
    assert stopping.json()["run"]["status"] == "stopping"
    assert stopping.json()["run"]["stop_requested"] is True
    assert stopping.json()["run"]["stop_reason"] == "QA - target is needed"


def test_a_runner_that_stops_by_itself_reads_stopping_without_a_stop_request(
    client, session_factory
):
    make_run(session_factory, status="stopping", stop_requested_at=None)
    body = client.get(BASE + "/control", headers=runner_headers()).json()
    assert body["state"] == "stopping" and body["run"]["stop_requested"] is False


def test_reading_control_writes_nothing_and_is_not_a_sign_of_life(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    at_time(monkeypatch, NOW + timedelta(seconds=119))
    alive = client.get(BASE + "/control", headers=runner_headers())
    assert alive.json()["state"] == "active"
    assert get_run(session_factory, run_id).last_seen_at == NOW

    # One second later the run is lost: the document says so, the row is left to the writers.
    at_time(monkeypatch, NOW + timedelta(seconds=120))
    lost = client.get(
        BASE + "/control",
        headers={**runner_headers(), "If-None-Match": alive.headers["ETag"]},
    )
    assert lost.status_code == 200
    assert lost.json()["state"] == "idle" and lost.json()["run"] is None
    assert lost.json()["last_run"] == {
        "id": run_id,
        "status": "interrupted",
        "finished_at": "2026-11-20T11:02:00Z",
        "accepts_results_until": "2026-11-20T11:12:00Z",
    }
    assert get_run(session_factory, run_id).status == "running"


def test_control_names_the_last_run_while_its_late_window_is_open(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="finished")
    at_time(monkeypatch, NOW + timedelta(seconds=600))
    inside = client.get(BASE + "/control", headers=runner_headers()).json()
    assert inside["state"] == "idle"
    assert inside["last_run"] == {
        "id": run_id,
        "status": "finished",
        "finished_at": "2026-11-20T11:00:00Z",
        "accepts_results_until": "2026-11-20T11:10:00Z",
    }
    at_time(monkeypatch, NOW + timedelta(seconds=601))
    assert (
        client.get(BASE + "/control", headers=runner_headers()).json()["last_run"]
        is None
    )


def test_a_run_nobody_claimed_is_not_the_runners_last_run(client, session_factory):
    make_run(
        session_factory,
        status="stopped",
        claimed_at=None,
        claim_instance_id=None,
        last_seen_at=None,
        started_at=None,
        last_report_at=None,
        progress_seq=0,
    )
    assert (
        client.get(BASE + "/control", headers=runner_headers()).json()["last_run"]
        is None
    )


def test_control_says_when_a_stored_token_cannot_be_decrypted(
    client, session_factory, monkeypatch
):
    make_run(session_factory)
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode())
    response = client.get(BASE + "/control", headers=runner_headers())
    _refused(response, 500, "secret_cannot_be_decrypted", "secret cannot be decrypted")


# --------------------------------------------------------------------------- events


def test_events_are_stored_once_masked_and_without_credential_keys(
    client, session_factory
):
    run_id = make_run(session_factory, status="running")
    secret = TOKENS["refresh_token"]
    events = [
        _event(run_id=run_id),
        _event(
            "token_rejected",
            level="warning",
            message=f"refresh refused for {secret} with Authorization: Bearer abc.def",
            details={
                "token": secret,
                "inner": {"cookie": "c", "status": 401},
                "note": f"sent {secret}",
            },
        ),
        _event(run_id="a-run-of-nobody"),
    ]
    response = client.post(
        BASE + "/events", headers=runner_headers(), json={"events": events}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"accepted": 3}
    # A repeat after a lost answer stores nothing new.
    again = client.post(
        BASE + "/events", headers=runner_headers(), json={"events": events}
    )
    assert again.json() == {"accepted": 0}

    with session_factory() as db:
        rows = db.scalars(select(PerformanceEvent).order_by(PerformanceEvent.id)).all()
        assert [(row.code, row.run_id, row.source) for row in rows] == [
            ("level_passed", run_id, "runner"),
            ("token_rejected", None, "runner"),
            # Not a run of this runner: kept, but on no run's timeline.
            ("level_passed", None, "runner"),
        ]
        assert (
            rows[1].message
            == "refresh refused for [REDACTED] with Authorization: [REDACTED]"
        )
        assert rows[1].details == {"inner": {"status": 401}, "note": "sent [REDACTED]"}
        assert all(secret not in row.message + str(row.details) for row in rows)


def test_event_batches_are_checked_whole(client, session_factory):
    assert client.post(
        BASE + "/events", headers=runner_headers(), json={"events": []}
    ).json() == {"accepted": 0}
    too_many = client.post(
        BASE + "/events",
        headers=runner_headers(),
        json={
            "events": [_event(at=stamp(NOW + timedelta(seconds=n))) for n in range(101)]
        },
    )
    _refused(too_many, 422, "too_many_events", "too many events")
    for bad in (
        _event(level="debug"),
        _event(code="Not-Allowed"),
        _event(message=""),
        _event(component="extra"),
    ):
        one_bad = client.post(
            BASE + "/events", headers=runner_headers(), json={"events": [_event(), bad]}
        )
        assert one_bad.status_code == 422 and isinstance(one_bad.json()["detail"], list)
    too_large = client.post(
        BASE + "/events",
        headers=runner_headers(),
        json={"events": [_event(details={"blob": "x" * 262144})]},
    )
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "payload_too_large"
    unknown = client.post(
        runner_path(PROJECT, "never-registered") + "/events",
        headers=runner_headers(),
        json={"events": []},
    )
    _refused(unknown, 404, "runner_not_found", "performance runner not found")
    with session_factory() as db:
        assert db.scalars(select(PerformanceEvent)).all() == []


# --------------------------------------------------------------------------- tokens


def _rotate(
    client, run_id, value="example-rotated-refresh-token-c81f", version=1, **changes
):
    return client.put(
        f"{BASE}/runs/{run_id}/tokens/refresh_token",
        headers=changes.pop("headers", runner_headers()),
        json={
            "value": value,
            "replaces_version": version,
            "expires_at": None,
            **changes,
        },
    )


def _refresh_token(factory) -> PerformanceTargetToken:
    with factory() as db:
        token = db.scalars(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.name == "refresh_token"
            )
        ).one()
        db.expunge(token)
        return token


def test_a_rotated_refresh_token_is_saved_once_and_never_echoed(
    client, session_factory
):
    run_id = make_run(session_factory, status="running", token_needed="refresh_token")
    response = _rotate(client, run_id)
    assert response.status_code == 200, response.text
    assert response.json() == {"name": "refresh_token", "version": 2, "hint": "c81f"}
    token = _refresh_token(session_factory)
    assert token_value(token) == "example-rotated-refresh-token-c81f"
    assert (token.version, token.token_hint, token.updated_by_user_id) == (
        2,
        "c81f",
        None,
    )
    assert get_run(session_factory, run_id).token_needed is None

    # The answer was lost and the runner asks again: the same answer, no second version.
    repeat = _rotate(client, run_id)
    assert repeat.status_code == 200 and repeat.json() == response.json()
    assert _refresh_token(session_factory).version == 2

    with session_factory() as db:
        audit = db.scalars(select(AuditLog)).one()
        assert audit.action == "performance.token.rotated"
        assert audit.entity_type == "performance_target"
        assert audit.before == {"name": "refresh_token", "version": 1, "hint": "41bd"}
        assert audit.after == {
            "name": "refresh_token",
            "version": 2,
            "hint": "c81f",
            "run_id": run_id,
            "by": "runner",
        }
        event = db.scalars(select(PerformanceEvent)).one()
        assert (event.code, event.source, event.run_id) == (
            "token_rotated",
            "qym",
            run_id,
        )
        assert event.details == {
            "name": "refresh_token",
            "version": 2,
            "hint": "c81f",
            "count": 1,
            "last_at": stamp(NOW),
        }
        stored = (
            str(audit.before) + str(audit.after) + event.message + str(event.details)
        )
        assert "example-rotated-refresh-token" not in stored


def test_a_rotation_never_overwrites_a_token_a_person_saved(client, session_factory):
    run_id = make_run(session_factory, status="running")
    with session_factory() as db:
        supply_token(
            db,
            db.get(PerformanceRun, run_id),
            "refresh_token",
            "example-person-token-7a2e",
        )
        db.commit()
    response = _rotate(client, run_id, version=1)
    _refused(response, 409, "token_version_conflict", "a newer token is saved")
    token = _refresh_token(session_factory)
    assert (token.version, token_value(token)) == (2, "example-person-token-7a2e")


def test_token_route_refusals(client, session_factory, monkeypatch):
    run_id = make_run(session_factory, status="running")
    not_chosen = _rotate(client, run_id, headers=runner_headers(OTHER_TOKEN))
    _refused(
        not_chosen, 403, "tokens_not_disclosed", "this API key is not the runner key"
    )
    other_instance = _rotate(
        client, run_id, headers=runner_headers(instance="instance-2")
    )
    _refused(
        other_instance,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    unknown = _rotate(client, "no-such-run")
    _refused(unknown, 404, "run_not_found", "performance run not found")
    access = client.put(
        f"{BASE}/runs/{run_id}/tokens/access_token",
        headers=runner_headers(),
        json={"value": "v", "replaces_version": 1},
    )
    assert access.status_code == 422 and isinstance(access.json()["detail"], list)
    assert _rotate(client, run_id, value="").status_code == 422
    assert _rotate(client, run_id, extra=True).status_code == 422

    # After the run ended the token is still taken for ten minutes, then no more.
    with session_factory() as db:
        run = db.get(PerformanceRun, run_id)
        run.status, run.finished_at = "finished", NOW
        db.commit()
    at_time(monkeypatch, NOW + timedelta(seconds=601))
    closed = _rotate(client, run_id)
    _refused(closed, 409, "run_closed", "run no longer accepts results")
    at_time(monkeypatch, NOW + timedelta(seconds=600))
    assert _rotate(client, run_id).status_code == 200
    assert _refresh_token(session_factory).version == 2


def test_progress_numbers_helper_is_a_valid_report(client, session_factory):
    """The shared request builders stay in step with the routes."""
    run_id = make_run(session_factory, status="running")
    response = client.post(
        f"{BASE}/runs/{run_id}/progress",
        headers=runner_headers(),
        json=progress_report(2, progress=progress_numbers()),
    )
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------- review fixes

MEMBER = {"X-User-Email": "performance-user-member-1@example.test"}
PAGES = f"/api/projects/{PROJECT}/performance"


def _deep(levels: int) -> dict:
    """Objects nested ``levels`` deep: ``{}`` is one level."""
    value: dict = {}
    for _ in range(levels - 1):
        value = {"a": value}
    return value


def _too_deep(response) -> bool:
    return response.status_code == 422 and [
        item["type"] for item in response.json()["detail"]
    ] == ["json_too_deep"]


def test_registration_masks_the_name_and_the_keys_of_info(client, session_factory):
    refresh = TOKENS["refresh_token"]
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.c2lnbmF0dXJl"
    answer = client.put(
        BASE,
        headers=runner_headers(),
        json={
            "name": f"QA runner Bearer {refresh}",
            "info": {"host": "qa-host", f"note {jwt}": f"cookie: {refresh}"},
        },
    )
    assert answer.status_code == 200, answer.text
    runner = _runner(session_factory)
    assert runner.name == "QA runner Bearer [REDACTED]"
    assert runner.info == {"host": "qa-host", "note [REDACTED]": "cookie: [REDACTED]"}
    assert refresh not in answer.text and jwt not in answer.text


def test_the_tokens_digest_is_keyed_so_a_guess_cannot_be_checked(
    client, session_factory
):
    import hashlib
    import json

    make_run(session_factory)
    other = client.get(BASE + "/control", headers=runner_headers(token=OTHER_TOKEN))
    run = other.json()["run"]
    assert run["tokens_withheld"] is True and "tokens" not in run
    guess = json.dumps(
        [
            ["refresh_token", 1, TOKENS["refresh_token"]],
            ["access_token", 1, TOKENS["access_token"]],
        ],
        separators=(",", ":"),
    )
    assert hashlib.sha256(guess.encode()).hexdigest() != run["tokens_digest"]
    chosen = client.get(BASE + "/control", headers=runner_headers()).json()["run"]
    assert chosen["tokens_digest"] == run["tokens_digest"]
    assert chosen["tokens_digest"] == performance_control.tokens_digest(
        chosen["tokens"]
    )
    # The same document validates; a new token value changes the digest and the ETag.
    first = client.get(BASE + "/control", headers=runner_headers())
    same = client.get(
        BASE + "/control",
        headers={**runner_headers(), "If-None-Match": first.headers["ETag"]},
    )
    assert same.status_code == 304


def test_json_nested_deeper_than_32_levels_is_refused_on_every_runner_route(
    client, session_factory, monkeypatch
):
    from _performance_support import page_time, question_record, summary_body

    page_time(monkeypatch, NOW)
    run_id = make_run(session_factory, status="running")
    run = f"{BASE}/runs/{run_id}"
    event = {"at": stamp(NOW), "level": "info", "code": "qa_deep", "message": "QA"}
    # Each body below is 33 levels deep: one more than qym takes.
    sends = {
        "register": lambda: client.put(
            BASE, headers=runner_headers(), json={"name": "QA", "info": _deep(32)}
        ),
        "heartbeat": lambda: client.post(
            BASE + "/heartbeat", headers=runner_headers(), json={"x": _deep(32)}
        ),
        "events": lambda: client.post(
            BASE + "/events",
            headers=runner_headers(),
            json={"events": [{**event, "details": _deep(30)}]},
        ),
        "claim": lambda: client.post(
            run + "/claim", headers=runner_headers(), json={"x": _deep(32)}
        ),
        "progress": lambda: client.post(
            run + "/progress",
            headers=runner_headers(),
            json=progress_report(2, "running", {"x": _deep(31)}),
        ),
        "questions": lambda: client.post(
            run + "/questions",
            headers=runner_headers(),
            json={"records": [question_record(1, extra=_deep(30))]},
        ),
        "log": lambda: client.post(
            run + "/log", headers=runner_headers(), json={"lines": [_deep(31)]}
        ),
        "summary": lambda: client.put(
            run + "/summary",
            headers=runner_headers(),
            json=summary_body(suite_summary=_deep(32)),
        ),
        "token": lambda: client.put(
            run + "/tokens/refresh_token",
            headers=runner_headers(),
            json={"value": "x", "replaces_version": 1, "x": _deep(32)},
        ),
    }
    for route, send in sends.items():
        assert _too_deep(send()), route
    # Far deeper bodies, sent as text, get the same answer and never fail qym.
    for depth in (600, 5000):
        text = '{"a":' * depth + "{}" + "}" * depth
        raw = '{"seq":3,"status":"running","at":"%s","progress":{"x":%s}}' % (
            stamp(NOW),
            text,
        )
        assert _too_deep(
            client.post(
                run + "/progress",
                headers={**runner_headers(), "Content-Type": "application/json"},
                content=raw.encode(),
            )
        ), depth
    assert _runner(session_factory).instance_id == INSTANCE

    # 32 levels are taken, and the pages that show them still answer.
    assert (
        client.post(
            run + "/progress",
            headers=runner_headers(),
            json=progress_report(4, "running", {"x": _deep(30)}),
        ).status_code
        == 200
    )
    assert (
        client.post(
            BASE + "/events",
            headers=runner_headers(),
            json={"events": [{**event, "details": _deep(29), "run_id": run_id}]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            BASE, headers=runner_headers(), json={"name": "QA", "info": _deep(31)}
        ).status_code
        == 200
    )
    for page in (
        "/runner",
        "/runner/events",
        f"/runs/{run_id}",
        f"/runs/{run_id}/events",
    ):
        assert client.get(PAGES + page, headers=MEMBER).status_code == 200, page


def test_nul_characters_are_removed_from_every_string(client, session_factory):
    from _performance_support import question_record, summary_body

    registered = client.put(
        BASE,
        headers=runner_headers(),
        json={"name": "QA\u0000 runner", "info": {"ho\u0000st": "a\u0000b"}},
    )
    assert registered.status_code == 200, registered.text
    runner = _runner(session_factory)
    assert (runner.name, runner.info) == ("QA runner", {"host": "ab"})
    run_id = make_run(session_factory, status="running")
    run = f"{BASE}/runs/{run_id}"
    progress = progress_numbers(phase="hold\u0000")
    assert (
        client.post(
            run + "/progress",
            headers=runner_headers(),
            json=progress_report(2, "running", progress),
        ).status_code
        == 200
    )
    event = {
        "at": stamp(NOW),
        "level": "info",
        "code": "qa_nul",
        "message": "QA\u0000 event",
        "details": {"note": "a\u0000b"},
    }
    assert client.post(
        BASE + "/events", headers=runner_headers(), json={"events": [event]}
    ).json() == {"accepted": 1}
    record = question_record(1, question_id="q\u00001", question="Q\u0000?")
    assert (
        client.post(
            run + "/questions", headers=runner_headers(), json={"records": [record]}
        ).json()["accepted"]
        == 1
    )
    summary = client.put(
        run + "/summary",
        headers=runner_headers(),
        json=summary_body(verdict_reason="QA\u0000 reason"),
    )
    assert summary.status_code == 200, summary.text
    from qym_platform.db.models import PerformanceQuestion

    stored = get_run(session_factory, run_id)
    assert stored.progress["phase"] == "hold"
    assert stored.summary["verdict_reason"] == "QA reason"
    with session_factory() as db:
        row = db.scalars(
            select(PerformanceEvent).where(PerformanceEvent.code == "qa_nul")
        ).one()
        assert (row.message, row.details) == ("QA event", {"note": "ab"})
        question = db.scalars(select(PerformanceQuestion)).one()
        assert (question.question_id, question.question) == ("q1", "Q?")


def test_a_short_rotated_token_shows_no_characters_in_its_hint(client, session_factory):
    from qym_platform.services.performance_redaction import hint_for

    assert (hint_for("abcdefghijk"), hint_for("abcdefghijkl")) == ("", "ijkl")
    run_id = make_run(session_factory, status="running")
    short = _rotate(client, run_id, value="short-token")
    assert short.json() == {"name": "refresh_token", "version": 2, "hint": ""}
    assert _refresh_token(session_factory).token_hint == ""
    with session_factory() as db:
        assert db.scalars(select(AuditLog)).one().after["hint"] == ""
        assert db.scalars(select(PerformanceEvent)).one().details["hint"] == ""
    longer = _rotate(client, run_id, value="twelve-chars", version=2)
    assert longer.json()["hint"] == "hars"


def test_round3_chat_rotations_coalesce_per_run(client, session_factory, monkeypatch):
    first_run = make_run(session_factory, status="running")
    first = _rotate(client, first_run)
    assert first.status_code == 200, first.text
    at_time(monkeypatch, NOW + timedelta(seconds=5))
    second = _rotate(
        client, first_run, value="example-latest-refresh-token-a123", version=2
    )
    assert second.status_code == 200, second.text
    assert (
        _rotate(
            client, first_run, value="example-latest-refresh-token-a123", version=2
        ).json()
        == second.json()
    )
    with session_factory() as db:
        events = list(
            db.scalars(
                select(PerformanceEvent).where(PerformanceEvent.run_id == first_run)
            )
        )
        assert len(events) == 1
        event = events[0]
        assert event.at == NOW
        assert (
            event.message
            == "The target replaced the refresh token 2 times; the latest one is saved"
        )
        assert event.details == dict(
            name="refresh_token",
            version=3,
            hint="a123",
            count=2,
            last_at=stamp(NOW + timedelta(seconds=5)),
        )
        run = db.get(PerformanceRun, first_run)
        run.status, run.finished_at = "finished", NOW
        db.commit()
    second_run = make_run(session_factory, status="running")
    response = _rotate(
        client, second_run, value="example-another-refresh-token-b123", version=3
    )
    assert response.status_code == 200, response.text
    with session_factory() as db:
        event = db.scalar(
            select(PerformanceEvent).where(PerformanceEvent.run_id == second_run)
        )
        assert event.details["count"] == 1
        assert (
            event.message
            == "The target replaced the refresh token; the new one is saved"
        )


def test_round3_rotation_event_groups_by_token_name_and_source(session_factory):
    from qym_platform.services.performance_state import add_event

    run_id = make_run(session_factory, status="running")
    with session_factory() as db:
        run = db.get(PerformanceRun, run_id)
        db.add(
            PerformanceEvent(
                runner_id=run.runner_id,
                run_id=run.id,
                at=NOW,
                code="token_rotated",
                level="info",
                message="runner event",
                source="runner",
                details={"name": "refresh_token"},
            )
        )
        db.flush()
        for name in ("refresh_token", "access_token", "refresh_token", "access_token"):
            add_event(
                db,
                runner_id=run.runner_id,
                run_id=run.id,
                at=NOW,
                code="token_rotated",
                message="first rotation",
                details={"name": name, "version": 2, "hint": ""},
            )
            db.flush()
        events = list(
            db.scalars(
                select(PerformanceEvent).where(PerformanceEvent.run_id == run_id)
            )
        )
        assert len(events) == 3
        assert (
            next(event for event in events if event.source == "runner").message
            == "runner event"
        )
        assert {
            event.details["name"]: event.details["count"]
            for event in events
            if event.source == "qym"
        } == {"refresh_token": 2, "access_token": 2}
