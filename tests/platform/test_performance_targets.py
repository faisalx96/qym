"""Targets and their sign-in tokens: Manager only, unique name and address, encrypted tokens."""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import timedelta

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    NOW,
    TOKENS,
    page_time,
    seed_performance,
    seed_run,
    seed_target,
    seed_user,
    target_tokens,
    token_value,
    use_encryption_key,
)
from qym_platform.db.models import (
    AuditLog,
    PerformanceRun,
    PerformanceTarget,
    PerformanceTargetToken,
    Project,
    ProjectRole,
)
from qym_platform.services import performance_targets

BASE = "/api/projects/performance-project-1/performance"
MANAGER = {"X-User-Email": "performance-user-owner-1@example.test"}
MEMBER = {"X-User-Email": "performance-user-member-1@example.test"}
VIEWER = {"X-User-Email": "performance-user-viewer-1@example.test"}
OUTSIDER = {"X-User-Email": "performance-user-outsider-1@example.test"}
NEW_TARGET = {
    "name": "QA - Playground 17",
    "is_production": False,
    "base_url": "https://playground17.example.test",
}
NEW_TOKEN = "example-new-refresh-token-7a2e"
# The code the platform gives its Viewer rule (derived from the sentence).
VIEWER_CODE = "viewers_cannot_change_this_project"


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    page_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seeded = seed_performance(db)
        seed_user(db, seeded.project, suffix="viewer-1", role=ProjectRole.VIEWER)
        seed_user(db, suffix="outsider-1")
        db.commit()
    return factory


@contextmanager
def statements(engine):
    """Count the statements the engine runs inside the block."""
    seen: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


def refused(response, http: int, code: str, **details):
    assert response.status_code == http, response.text
    error = response.json()["error"]
    assert error["code"] == code, error
    assert error["message"]
    for name, value in details.items():
        assert error["details"][name] == value, error
    return error


def target_id(session_factory, name: str = "QA - Preprod") -> str:
    with session_factory() as db:
        return db.scalars(
            select(PerformanceTarget.id).where(PerformanceTarget.name == name)
        ).one()


def listed(client, headers=MANAGER) -> dict:
    response = client.get(f"{BASE}/targets", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def by_name(client, name: str, headers=MANAGER) -> dict:
    return next(
        row for row in listed(client, headers)["targets"] if row["name"] == name
    )


def assert_no_token_values(payload, *extra: str) -> None:
    text = json.dumps(payload)
    for value in (*TOKENS.values(), NEW_TOKEN, *extra):
        assert value not in text
    assert "token_encrypted" not in text


def audit_rows(session_factory, action: str) -> list[AuditLog]:
    with session_factory() as db:
        return list(
            db.scalars(
                select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
            ).all()
        )


def add_active_run(session_factory, status: str = "running") -> str:
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        target = db.scalars(
            select(PerformanceTarget).where(PerformanceTarget.name == "QA - Preprod")
        ).one()
        from qym_platform.db.models import PerformanceRunner

        runner = db.scalars(select(PerformanceRunner)).one()
        run = seed_run(db, project, runner, target, status=status)
        db.commit()
        return run.id


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def test_list_shows_hints_and_never_a_token(client, session_factory):
    body = listed(client)
    assert body["can_manage"] is True
    assert body["encryption_ready"] is True
    assert body["platform_limits"] == {"max_users": 200, "max_duration_s": 28800}
    (target,) = body["targets"]
    assert target == {
        "id": target_id(session_factory),
        "name": "QA - Preprod",
        "is_production": False,
        "base_url": "https://target.example.test",
        "chat_path": "/change/api/chat",
        "token_refresh_path": "/auth/token",
        "max_users": None,
        "max_duration_s": None,
        "tokens": [
            {
                "name": "access_token",
                "hint": "0c2e",
                "version": 1,
                "expires_at": None,
                "expired": False,
                "updated_at": "2026-11-20T11:00:00Z",
                "updated_by": "QA - Person owner-1",
                "updated_by_user_id": "performance-user-owner-1",
            },
            {
                "name": "refresh_token",
                "hint": "41bd",
                "version": 1,
                "expires_at": None,
                "expired": False,
                "updated_at": "2026-11-20T11:00:00Z",
                "updated_by": "QA - Person owner-1",
                "updated_by_user_id": "performance-user-owner-1",
            },
        ],
        "sign_in_ready": True,
        "active_run_id": None,
        "can_start": True,
        "can_save_tokens": True,
        "settings": {"auth_server": None, "refresh_cookie_name": "estishraf_rt"},
        "archived_at": None,
        "created_by": "QA - Person owner-1",
        "created_by_user_id": "performance-user-owner-1",
        "created_at": "2026-11-20T11:00:00Z",
        "updated_at": "2026-11-20T11:00:00Z",
        "last_run": None,
    }
    assert_no_token_values(body)


def test_every_member_reads_and_only_a_manager_manages(client):
    assert listed(client, MEMBER)["can_manage"] is False
    viewer = listed(client, VIEWER)
    assert viewer["can_manage"] is False
    assert viewer["targets"][0]["can_start"] is False
    assert viewer["targets"][0]["can_save_tokens"] is False
    assert client.get(f"{BASE}/targets", headers=OUTSIDER).status_code == 403


def test_list_shows_the_latest_run_and_a_busy_target(client, session_factory):
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        target = db.scalars(select(PerformanceTarget)).one()
        from qym_platform.db.models import PerformanceRunner

        runner = db.scalars(select(PerformanceRunner)).one()
        seed_run(db, project, runner, target, status="finished", verdict="pass")
        run = seed_run(db, project, runner, target, status="running")
        db.commit()
        run_id = run.id
    target = by_name(client, "QA - Preprod")
    assert target["active_run_id"] == run_id
    assert target["last_run"] == {
        "id": run_id,
        "number": 2,
        "status": "running",
        "verdict": None,
        "finished_at": None,
    }


def test_list_uses_the_same_number_of_statements_for_one_target_and_for_many(
    client, session_factory, database
):
    with statements(database) as one:
        listed(client)
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        for number in range(2, 6):
            seed_target(
                db,
                project,
                name=f"QA - Target {number}",
                base_url=f"https://target-{number}.example.test",
            )
        db.commit()
    with statements(database) as many:
        assert len(listed(client)["targets"]) == 5
    assert len(many) == len(one)


# ---------------------------------------------------------------------------
# Adding and changing
# ---------------------------------------------------------------------------


def test_a_manager_adds_a_target_and_the_address_is_stored_as_an_origin(
    client, session_factory
):
    response = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={
            **NEW_TARGET,
            "name": "  QA -  Playground 17 ",
            "base_url": "HTTPS://Playground17.Example.Test:8443/",
            "max_users": 50,
            "settings": {"refresh_cookie_name": "qa_rt"},
        },
    )
    assert response.status_code == 201, response.text
    target = response.json()
    assert target["name"] == "QA - Playground 17"
    assert target["base_url"] == "https://playground17.example.test:8443"
    assert target["chat_path"] == "/change/api/chat"
    assert target["token_refresh_path"] == "/auth/token"
    assert target["max_users"] == 50
    assert target["settings"] == {"auth_server": None, "refresh_cookie_name": "qa_rt"}
    assert target["tokens"] == []
    assert target["sign_in_ready"] is False
    assert target["created_by"] == "QA - Person owner-1"
    assert target["created_at"] == "2026-11-20T11:00:00Z"
    assert by_name(client, "QA - Playground 17") == target
    (row,) = audit_rows(session_factory, "performance.target.create")
    assert row.entity_type == "performance_target"
    assert row.entity_id == target["id"]
    assert row.actor_user_id == "performance-user-owner-1"
    assert row.before == {}
    assert row.after["base_url"] == "https://playground17.example.test:8443"


@pytest.mark.parametrize("who", [MEMBER, VIEWER])
def test_only_a_manager_changes_targets(client, session_factory, who):
    # A Viewer meets the platform's Viewer rule first; a Member the Manager rule.
    code = "forbidden" if who is MEMBER else VIEWER_CODE
    existing = target_id(session_factory)
    calls = [
        ("POST", f"{BASE}/targets", NEW_TARGET),
        ("PUT", f"{BASE}/targets/{existing}", NEW_TARGET),
        ("DELETE", f"{BASE}/targets/{existing}", None),
        ("POST", f"{BASE}/targets/{existing}/restore", None),
    ]
    for method, path, body in calls:
        response = client.request(method, path, headers=who, json=body)
        refused(response, 403, code)
    # The role is checked before the body: an unusable body is still a 403.
    refused(client.post(f"{BASE}/targets", headers=who, json={}), 403, code)
    with session_factory() as db:
        assert len(db.scalars(select(PerformanceTarget)).all()) == 1
        assert db.get(PerformanceTarget, existing).archived_at is None


@pytest.mark.parametrize(
    "change, place",
    [
        ({"base_url": "playground17.example.test"}, "base_url"),
        ({"base_url": "ftp://playground17.example.test"}, "base_url"),
        ({"base_url": "https://playground17.example.test/chat"}, "base_url"),
        ({"base_url": "https://playground17.example.test?x=1"}, "base_url"),
        ({"base_url": "https://person:word@playground17.example.test"}, "base_url"),
        ({"name": "   "}, "name"),
        ({"chat_path": "change/api/chat"}, "chat_path"),
        ({"token_refresh_path": "//other.example.test/auth"}, "token_refresh_path"),
        ({"settings": {"refresh_cookie_name": "bad name"}}, "settings"),
        (
            {"settings": {"auth_server": "https://auth.example.test/path"}},
            "settings.auth_server",
        ),
        ({"max_users": 0}, "max_users"),
        ({"max_duration_s": 30}, "max_duration_s"),
    ],
)
def test_an_unusable_field_answers_422_with_its_place(client, change, place):
    response = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, **change}
    )
    error = refused(response, 422, "validation_error")
    assert error["details"][0]["loc"][:2] == ["body", place]
    assert error["details"][0]["msg"]


@pytest.mark.parametrize(
    "field, value, limit", [("max_users", 201, 200), ("max_duration_s", 28801, 28800)]
)
def test_a_target_cannot_allow_more_than_the_platform(client, field, value, limit):
    response = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, field: value}
    )
    refused(response, 422, "over_platform_limit", field=field, limit=limit, value=value)
    assert len(listed(client)["targets"]) == 1


def test_name_and_address_are_unique_among_targets_that_are_not_archived(
    client, session_factory
):
    existing = target_id(session_factory)
    same_name = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, "name": "QA - Preprod"}
    )
    refused(same_name, 409, "target_name_taken")
    same_address = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={**NEW_TARGET, "base_url": "https://TARGET.example.test/"},
    )
    refused(
        same_address,
        409,
        "target_address_taken",
        target_id=existing,
        name="QA - Preprod",
    )
    assert (
        client.delete(f"{BASE}/targets/{existing}", headers=MANAGER).status_code == 204
    )
    again = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={
            **NEW_TARGET,
            "name": "QA - Preprod",
            "base_url": "https://target.example.test",
        },
    )
    assert again.status_code == 201, again.text
    assert again.json()["id"] != existing


@pytest.mark.parametrize(
    "change, code",
    [
        ({"name": "QA - Preprod"}, "target_name_taken"),
        ({"base_url": "https://target.example.test"}, "target_address_taken"),
    ],
)
def test_a_save_that_loses_the_race_gets_the_same_refusal(
    client, session_factory, monkeypatch, change, code
):
    """Two saves at once both pass the check; the unique index stops the second."""
    real = performance_targets._conflict
    calls = []

    def blind_once(*args, **kwargs):
        calls.append(1)
        return None if len(calls) == 1 else real(*args, **kwargs)

    monkeypatch.setattr(performance_targets, "_conflict", blind_once)
    response = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, **change}
    )
    refused(response, 409, code)
    assert len(calls) == 2
    with session_factory() as db:
        assert len(db.scalars(select(PerformanceTarget)).all()) == 1


def test_changing_a_target_keeps_its_tokens_unless_the_address_changes(
    client, session_factory
):
    existing = target_id(session_factory)
    renamed = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={
            "name": "QA - Preprod (old)",
            "is_production": False,
            "base_url": "https://target.example.test",
            "max_users": 40,
        },
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "QA - Preprod (old)"
    assert renamed.json()["max_users"] == 40
    assert renamed.json()["sign_in_ready"] is True
    assert [token["name"] for token in renamed.json()["tokens"]] == [
        "access_token",
        "refresh_token",
    ]

    moved = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={
            "name": "QA - Preprod (old)",
            "is_production": False,
            "base_url": "https://moved.example.test",
        },
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["base_url"] == "https://moved.example.test"
    assert moved.json()["tokens"] == []
    assert moved.json()["sign_in_ready"] is False
    assert moved.json()["max_users"] is None
    with session_factory() as db:
        assert db.scalars(select(PerformanceTargetToken)).all() == []
    rows = audit_rows(session_factory, "performance.target.update")
    assert len(rows) == 2
    assert "tokens_removed" not in rows[0].after
    assert rows[1].before["base_url"] == "https://target.example.test"
    assert rows[1].after["base_url"] == "https://moved.example.test"
    assert sorted(rows[1].after["tokens_removed"], key=lambda row: row["name"]) == [
        {"name": "access_token", "hint": "0c2e", "version": 1},
        {"name": "refresh_token", "hint": "41bd", "version": 1},
    ]
    assert_no_token_values([row.after for row in rows])


SAME_ADDRESS = {
    "name": "QA - Preprod",
    "is_production": False,
    "base_url": "https://target.example.test",
}
# Each change moves where the runner sends the saved refresh token, or how.
SIGN_IN_CHANGES = {
    "sign-in host": {"settings": {"auth_server": "https://elsewhere.example.test"}},
    "renewal path": {"token_refresh_path": "/collect"},
    "refresh cookie": {"settings": {"refresh_cookie_name": "other_rt"}},
}


@pytest.mark.parametrize("what", list(SIGN_IN_CHANGES))
def test_changing_where_the_sign_in_goes_removes_the_tokens(
    client, session_factory, what
):
    existing = target_id(session_factory)
    response = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={**SAME_ADDRESS, **SIGN_IN_CHANGES[what]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["base_url"] == "https://target.example.test"
    assert response.json()["tokens"] == []
    assert response.json()["sign_in_ready"] is False
    with session_factory() as db:
        assert db.scalars(select(PerformanceTargetToken)).all() == []
    (row,) = audit_rows(session_factory, "performance.target.update")
    assert sorted(token["name"] for token in row.after["tokens_removed"]) == [
        "access_token",
        "refresh_token",
    ]
    assert_no_token_values(row.after)


def test_the_same_sign_in_settings_sent_again_keep_the_tokens(client, session_factory):
    existing = target_id(session_factory)
    response = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={
            **SAME_ADDRESS,
            "base_url": "HTTPS://Target.Example.Test:443/",
            "token_refresh_path": "/auth/token",
            "settings": {"auth_server": None, "refresh_cookie_name": "estishraf_rt"},
        },
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["tokens"]) == 2


@pytest.mark.parametrize("what", list(SIGN_IN_CHANGES))
def test_a_busy_target_keeps_where_its_sign_in_goes(client, session_factory, what):
    existing = target_id(session_factory)
    run_id = add_active_run(session_factory, status="queued")
    response = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={**SAME_ADDRESS, **SIGN_IN_CHANGES[what]},
    )
    refused(response, 409, "target_busy", run_id=run_id)
    target = by_name(client, "QA - Preprod")
    assert len(target["tokens"]) == 2
    assert target["token_refresh_path"] == "/auth/token"
    assert target["settings"] == {
        "auth_server": None,
        "refresh_cookie_name": "estishraf_rt",
    }


@pytest.mark.parametrize(
    "spelling",
    [
        "https://target.example.test.",
        "https://TARGET.example.test:443",
        "HTTPS://target.example.test:443/",
        "https://target.example.test:",
    ],
)
def test_the_same_system_cannot_be_added_under_another_spelling(
    client, session_factory, spelling
):
    existing = target_id(session_factory)
    response = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, "base_url": spelling}
    )
    refused(response, 409, "target_address_taken", target_id=existing)


@pytest.mark.parametrize(
    "first, second, stored",
    [
        (
            "http://plain.example.test:80",
            "http://plain.example.test",
            "http://plain.example.test",
        ),
        (
            "https://port.example.test:80",
            "https://port.example.test:0080",
            "https://port.example.test:80",
        ),
        ("http://127.0.0.1", "http://0x7f.1", "http://127.0.0.1"),
        ("http://2130706433:8080", "http://0177.0.0.1:8080", "http://127.0.0.1:8080"),
        ("https://[0:0:0:0:0:0:0:1]:8443", "https://[::1]:8443", "https://[::1]:8443"),
    ],
)
def test_an_address_is_stored_in_one_canonical_form(
    client, session_factory, first, second, stored
):
    created = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, "base_url": first}
    )
    assert created.status_code == 201, created.text
    assert created.json()["base_url"] == stored
    again = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={**NEW_TARGET, "name": "QA - Second", "base_url": second},
    )
    refused(again, 409, "target_address_taken", target_id=created.json()["id"])


@pytest.mark.parametrize(
    "address",
    [
        "https://%68ost.example.test",
        "https://host-d.example.test\\.evil.example.test",
        "https://host-j.example.test:0",
        "https://host-r.example.test\n.evil.example.test",
        "https://ho st.example.test",
        "https://host\t.example.test",
        "https://host.example.test:65536",
        "https://a..b.example.test",
        "https://.host.example.test",
        "https://host.example.test..",
        "https://höst.example.test",
        "https://host!.example.test",
        "https://@host.example.test",
        "https://[fe80::1%25en0]",
        "https://[::1",
        "http://1.2.3.256",
        "http://08.0.0.1",
    ],
)
def test_an_address_the_runner_could_read_another_way_is_refused(client, address):
    for path, field in (("base_url", "base_url"), ("settings", "settings.auth_server")):
        body = (
            {**NEW_TARGET, "base_url": address}
            if path == "base_url"
            else {**NEW_TARGET, "settings": {"auth_server": address}}
        )
        response = client.post(f"{BASE}/targets", headers=MANAGER, json=body)
        error = refused(response, 422, "validation_error")
        assert error["details"][0]["loc"][:2] == ["body", field], error
    assert len(listed(client)["targets"]) == 1


def test_link_local_and_metadata_hosts_are_refused_and_private_ones_allowed(client):
    """Tokens and questions never go to a link-local or cloud metadata host."""
    refused_hosts = [
        "http://169.254.169.254",
        "http://0xa9.16689662",
        "http://169.254.1.1:8080",
        "https://[fe80::1]",
        "https://[::ffff:169.254.169.254]",
        "http://metadata",
        "http://metadata.internal.example",
        "http://instance-data",
        "http://100.100.100.200",
        "http://0x64.0x64.0x64.0xc8",
        "https://[::ffff:100.100.100.200]",
        "http://[fd00:ec2::254]",
        "http://[FD00:0EC2:0:0:0:0:0:254]:8080",
    ]
    for address in refused_hosts:
        for body in (
            {**NEW_TARGET, "base_url": address},
            {**NEW_TARGET, "settings": {"auth_server": address}},
        ):
            response = client.post(f"{BASE}/targets", headers=MANAGER, json=body)
            error = refused(response, 422, "validation_error")
            assert "link-local" in error["details"][0]["msg"], (address, error)
    allowed = [
        "http://localhost:8080",
        "http://10.0.0.5",
        "http://192.168.1.10",
        "http://172.20.0.5",
        "https://[::1]:8443",
        "https://[fd12:3456::1]",
        "http://100.100.100.201",
        "http://[fd00:ec2::255]",
    ]
    for number, address in enumerate(allowed):
        response = client.post(
            f"{BASE}/targets",
            headers=MANAGER,
            json={**NEW_TARGET, "name": f"QA - Private {number}", "base_url": address},
        )
        assert response.status_code == 201, (address, response.text)
    assert len(listed(client)["targets"]) == 1 + len(allowed)


def test_the_sign_in_host_is_stored_in_the_same_canonical_form(client):
    response = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={
            **NEW_TARGET,
            "settings": {"auth_server": "HTTPS://Auth.Example.Test.:443/"},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["settings"]["auth_server"] == "https://auth.example.test"


def test_names_that_differ_only_in_case_are_the_same_name(client, session_factory):
    response = client.post(
        f"{BASE}/targets", headers=MANAGER, json={**NEW_TARGET, "name": "qa - PREPROD"}
    )
    refused(response, 409, "target_name_taken")


def test_restore_compares_addresses_in_the_canonical_form(client, session_factory):
    """A target archived with an older spelling is not restored beside the same system."""
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        old = seed_target(
            db,
            project,
            name="QA - Old spelling",
            base_url="https://legacy.example.test:443",
            tokens={},
            archived_at=NOW - timedelta(days=1),
        )
        db.commit()
        old_id = old.id
    created = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={**NEW_TARGET, "base_url": "https://LEGACY.example.test."},
    )
    assert created.status_code == 201, created.text
    response = client.post(f"{BASE}/targets/{old_id}/restore", headers=MANAGER)
    refused(response, 409, "target_address_taken", target_id=created.json()["id"])


def test_a_busy_target_keeps_its_address_and_cannot_be_archived(
    client, session_factory
):
    existing = target_id(session_factory)
    run_id = add_active_run(session_factory)
    moved = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={**NEW_TARGET, "name": "QA - Preprod"},
    )
    error = refused(moved, 409, "target_busy", run_id=run_id)
    assert "Run 1" in error["message"]
    refused(
        client.delete(f"{BASE}/targets/{existing}", headers=MANAGER),
        409,
        "target_busy",
        run_id=run_id,
    )
    refused(
        client.delete(
            f"{BASE}/targets/{existing}/tokens/refresh_token", headers=MANAGER
        ),
        409,
        "target_busy",
        run_id=run_id,
    )
    renamed = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={
            "name": "QA - Preprod busy",
            "is_production": False,
            "base_url": "https://target.example.test",
        },
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["active_run_id"] == run_id
    assert len(renamed.json()["tokens"]) == 2


def test_a_run_whose_runner_went_silent_no_longer_keeps_the_target_busy(
    client, session_factory, monkeypatch
):
    existing = target_id(session_factory)
    add_active_run(session_factory)
    page_time(monkeypatch, NOW + timedelta(seconds=121))
    assert by_name(client, "QA - Preprod")["active_run_id"] is None
    assert (
        client.delete(f"{BASE}/targets/{existing}", headers=MANAGER).status_code == 204
    )


def test_archive_hides_a_target_from_new_runs_and_restore_brings_it_back(
    client, session_factory
):
    existing = target_id(session_factory)
    assert (
        client.delete(f"{BASE}/targets/{existing}", headers=MANAGER).status_code == 204
    )
    assert (
        client.delete(f"{BASE}/targets/{existing}", headers=MANAGER).status_code == 204
    )
    archived = by_name(client, "QA - Preprod")
    assert archived["archived_at"] == "2026-11-20T11:00:00Z"
    assert archived["can_start"] is False
    assert len(archived["tokens"]) == 2
    setup = client.get(f"{BASE}/setup", headers=MANAGER).json()
    assert setup["targets"] == []
    home = client.get(BASE, headers=MANAGER).json()
    assert [(row["name"], row["archived"]) for row in home["targets"]] == [
        ("QA - Preprod", True)
    ]
    changed = client.put(
        f"{BASE}/targets/{existing}",
        headers=MANAGER,
        json={**NEW_TARGET, "name": "QA - Preprod"},
    )
    refused(changed, 409, "target_archived")
    refused(
        client.put(
            f"{BASE}/targets/{existing}/tokens/refresh_token",
            headers=MANAGER,
            json={"token": NEW_TOKEN},
        ),
        409,
        "target_archived",
    )

    restored = client.post(f"{BASE}/targets/{existing}/restore", headers=MANAGER)
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived_at"] is None
    assert restored.json()["sign_in_ready"] is True
    assert (
        client.post(f"{BASE}/targets/{existing}/restore", headers=MANAGER).status_code
        == 200
    )
    assert [
        row.action for row in audit_rows(session_factory, "performance.target.archive")
    ] == ["performance.target.archive"]
    (row,) = audit_rows(session_factory, "performance.target.restore")
    assert (row.before["archived"], row.after["archived"]) == (True, False)


@pytest.mark.parametrize(
    "taken, code",
    [
        (
            {"name": "QA - Preprod", "base_url": "https://other.example.test"},
            "target_name_taken",
        ),
        (
            {"name": "QA - Other", "base_url": "https://target.example.test"},
            "target_address_taken",
        ),
    ],
)
def test_restore_is_refused_while_another_target_has_the_name_or_the_address(
    client, session_factory, taken, code
):
    existing = target_id(session_factory)
    assert (
        client.delete(f"{BASE}/targets/{existing}", headers=MANAGER).status_code == 204
    )
    created = client.post(
        f"{BASE}/targets", headers=MANAGER, json={"is_production": False, **taken}
    )
    assert created.status_code == 201, created.text
    refused(
        client.post(f"{BASE}/targets/{existing}/restore", headers=MANAGER), 409, code
    )
    with session_factory() as db:
        assert db.get(PerformanceTarget, existing).archived_at is not None


def test_an_unknown_target_is_not_found(client):
    for method, path, body in [
        ("PUT", f"{BASE}/targets/missing", NEW_TARGET),
        ("DELETE", f"{BASE}/targets/missing", None),
        ("POST", f"{BASE}/targets/missing/restore", None),
        ("PUT", f"{BASE}/targets/missing/tokens/refresh_token", {"token": NEW_TOKEN}),
        ("DELETE", f"{BASE}/targets/missing/tokens/refresh_token", None),
    ]:
        response = client.request(method, path, headers=MANAGER, json=body)
        refused(response, 404, "target_not_found")
        assert response.json()["detail"] == "Target not found"


def test_a_target_of_another_project_is_not_found(client, session_factory):
    with session_factory() as db:
        other = seed_performance(db, suffix="2", runner_token="t-2", other_token="o-2")
        other_target = other.target.id
        db.commit()
    refused(
        client.delete(f"{BASE}/targets/{other_target}", headers=MANAGER),
        404,
        "target_not_found",
    )
    assert [row["name"] for row in listed(client)["targets"]] == ["QA - Preprod"]


# ---------------------------------------------------------------------------
# Sign-in tokens
# ---------------------------------------------------------------------------


def test_a_token_is_stored_encrypted_and_answered_as_a_hint(client, session_factory):
    existing = target_id(session_factory)
    path = f"{BASE}/targets/{existing}/tokens/refresh_token"
    response = client.put(
        path,
        headers=MEMBER,
        json={"token": f"  {NEW_TOKEN}\n", "expires_at": "2026-11-21T11:00:00Z"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "name": "refresh_token",
        "hint": "7a2e",
        "version": 2,
        "expires_at": "2026-11-21T11:00:00Z",
        "expired": False,
        "updated_at": "2026-11-20T11:00:00Z",
        "updated_by": "QA - Person member-1",
        "updated_by_user_id": "performance-user-member-1",
    }
    with session_factory() as db:
        token = target_tokens(db, db.get(PerformanceTarget, existing))["refresh_token"]
        assert NEW_TOKEN not in token.token_encrypted
        assert token_value(token) == NEW_TOKEN
        assert token.updated_by_user_id == "performance-user-member-1"
    again = client.put(path, headers=MANAGER, json={"token": TOKENS["refresh_token"]})
    assert again.json()["version"] == 3
    assert again.json()["expires_at"] is None
    assert_no_token_values([response.json(), again.json(), listed(client)])
    rows = audit_rows(session_factory, "performance.target.token")
    assert [(row.before, row.after) for row in rows] == [
        (
            {"name": "refresh_token", "hint": "41bd", "version": 1},
            {"name": "refresh_token", "hint": "7a2e", "version": 2},
        ),
        (
            {"name": "refresh_token", "hint": "7a2e", "version": 2},
            {"name": "refresh_token", "hint": "41bd", "version": 3},
        ),
    ]


def test_a_token_that_has_run_out_is_marked_and_the_sign_in_is_not_ready(
    client, session_factory
):
    existing = target_id(session_factory)
    response = client.put(
        f"{BASE}/targets/{existing}/tokens/refresh_token",
        headers=MANAGER,
        json={"token": NEW_TOKEN, "expires_at": "2026-11-20T10:59:00Z"},
    )
    assert response.json()["expired"] is True
    assert by_name(client, "QA - Preprod")["sign_in_ready"] is False


def test_an_empty_or_unusable_token_is_refused_without_echo(client, session_factory):
    existing = target_id(session_factory)
    path = f"{BASE}/targets/{existing}/tokens/refresh_token"
    refused(
        client.put(path, headers=MANAGER, json={"token": "   "}), 422, "token_empty"
    )
    refused(client.put(path, headers=MANAGER, json={}), 422, "token_empty")
    wrong_type = client.put(
        path, headers=MANAGER, json={"token": ["secret-in-a-list-9f3c"]}
    )
    refused(wrong_type, 422, "token_empty")
    assert "secret-in-a-list-9f3c" not in wrong_type.text
    unknown = client.put(
        f"{BASE}/targets/{existing}/tokens/session_cookie",
        headers=MANAGER,
        json={"token": NEW_TOKEN},
    )
    refused(unknown, 422, "validation_error")
    assert NEW_TOKEN not in unknown.text
    with session_factory() as db:
        token = target_tokens(db, db.get(PerformanceTarget, existing))["refresh_token"]
        assert (token.version, token.token_hint) == (1, "41bd")


SECRET_BODY = "eyJhbGciOiJIUzI1NiJ9.a-pasted-token-body.c4d9"


@pytest.mark.parametrize(
    "content, content_type",
    [
        (json.dumps(SECRET_BODY), "application/json"),
        (json.dumps([SECRET_BODY]), "application/json"),
        (json.dumps([{"token": SECRET_BODY}]), "application/json"),
        (SECRET_BODY, "text/plain"),
        (SECRET_BODY, "application/json"),
        (f"token={SECRET_BODY}", "application/x-www-form-urlencoded"),
    ],
)
def test_a_token_body_that_is_not_an_object_never_comes_back(
    client, session_factory, content, content_type
):
    existing = target_id(session_factory)
    response = client.put(
        f"{BASE}/targets/{existing}/tokens/refresh_token",
        headers={**MANAGER, "Content-Type": content_type},
        content=content,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] in ("token_empty", "validation_error")
    assert SECRET_BODY not in response.text
    assert "pasted-token" not in response.text
    with session_factory() as db:
        token = target_tokens(db, db.get(PerformanceTarget, existing))["refresh_token"]
        assert (token.version, token.token_hint) == (1, "41bd")


def test_without_an_encryption_key_no_token_is_stored(
    client, session_factory, monkeypatch
):
    existing = target_id(session_factory)
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY")
    response = client.put(
        f"{BASE}/targets/{existing}/tokens/refresh_token",
        headers=MANAGER,
        json={"token": NEW_TOKEN},
    )
    refused(response, 409, "encryption_key_missing")
    assert listed(client)["encryption_ready"] is False


def test_a_production_sign_in_is_saved_by_a_manager_only(client, session_factory):
    with session_factory() as db:
        project = db.get(Project, "performance-project-1")
        production = seed_target(
            db,
            project,
            name="QA - Production",
            base_url="https://production.example.test",
            is_production=True,
            tokens={},
        )
        db.commit()
        production_id = production.id
    path = f"{BASE}/targets/{production_id}/tokens/refresh_token"
    refused(
        client.put(path, headers=MEMBER, json={"token": NEW_TOKEN}),
        403,
        "production_requires_manager",
    )
    refused(client.delete(path, headers=MEMBER), 403, "production_requires_manager")
    refused(
        client.put(path, headers=VIEWER, json={"token": NEW_TOKEN}), 403, VIEWER_CODE
    )
    as_member = by_name(client, "QA - Production", MEMBER)
    assert (as_member["can_start"], as_member["can_save_tokens"]) == (False, False)
    saved = client.put(path, headers=MANAGER, json={"token": NEW_TOKEN})
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 1
    as_manager = by_name(client, "QA - Production")
    assert (as_manager["can_start"], as_manager["sign_in_ready"]) == (True, True)


def test_a_token_is_removed_and_a_repeat_changes_nothing(client, session_factory):
    existing = target_id(session_factory)
    path = f"{BASE}/targets/{existing}/tokens/access_token"
    assert client.delete(path, headers=MEMBER).status_code == 204
    assert client.delete(path, headers=MEMBER).status_code == 204
    target = by_name(client, "QA - Preprod")
    assert [token["name"] for token in target["tokens"]] == ["refresh_token"]
    assert target["sign_in_ready"] is True
    (row,) = audit_rows(session_factory, "performance.target.token.delete")
    assert row.before == {"name": "access_token", "hint": "0c2e", "version": 1}
    assert row.after == {}
    saved = client.put(path, headers=MEMBER, json={"token": TOKENS["access_token"]})
    assert saved.json()["version"] == 1


def test_removing_the_refresh_token_makes_the_sign_in_not_ready(
    client, session_factory
):
    existing = target_id(session_factory)
    path = f"{BASE}/targets/{existing}/tokens/refresh_token"
    assert client.delete(path, headers=MANAGER).status_code == 204
    assert by_name(client, "QA - Preprod")["sign_in_ready"] is False
    with session_factory() as db:
        assert db.scalars(select(PerformanceRun)).all() == []


def test_setup_carries_advanced_values_for_editing(client, session_factory):
    settings = {"auth_server": "https://login", "refresh_cookie_name": "production_rt"}
    created = client.post(
        f"{BASE}/targets",
        headers=MANAGER,
        json={**NEW_TARGET, "settings": settings, "max_duration_s": 901},
    )
    assert created.status_code == 201, created.text
    target = created.json()
    setup = client.get(f"{BASE}/setup", headers=MANAGER)
    assert setup.status_code == 200, setup.text
    loaded = next(row for row in setup.json()["targets"] if row["id"] == target["id"])
    assert loaded["settings"] == settings
    assert loaded["max_duration_s"] == 901
    saved = client.put(
        f"{BASE}/targets/{target['id']}",
        headers=MANAGER,
        json={
            **NEW_TARGET,
            "name": "Renamed production",
            "settings": loaded["settings"],
            "max_duration_s": loaded["max_duration_s"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["settings"] == settings
    assert saved.json()["max_duration_s"] == 901
