"""Platform contract through the same page and runner routes as chat."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from _performance_support import (
    INSTANCE,
    NOW,
    at_time,
    get_run,
    page_time,
    runner_headers,
    runner_path,
    seed_performance,
    seed_user,
    stamp,
    use_encryption_key,
)
from qym_platform.db.models import (
    PerformanceDashboardStep,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    PerformanceTargetToken,
    ProjectRole,
)
from qym_platform.services import performance_platform as p
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

BASE = "/api/projects/performance-project-1/performance"
R = runner_path("performance-project-1")
OWNER = {
    "X-User-Email": "performance-user-owner-1@example.test",
    "X-Qym-Performance-Platform": "1",
}
VIEWER = {
    "X-User-Email": "performance-user-viewer-1@example.test",
    "X-Qym-Performance-Platform": "1",
}
COOKIE = "session=private-opaque-session-A; refresh=private-opaque-refresh-B"
FIXTURES = json.loads(
    (Path(__file__).parent / "performance/platform_contract.json").read_text()
)


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    page_time(monkeypatch, NOW)
    at_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seeded = seed_performance(db)
        seeded.runner.info = {"supported_target_kinds": ["chat", p.KIND]}
        seed_user(db, seeded.project, suffix="viewer-1", role=ProjectRole.VIEWER)
        db.commit()
    return factory


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def refused(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code, response.text


def target(client, **changes):
    body = dict(
        kind=p.KIND,
        name="Dashboards",
        is_production=False,
        base_url="https://platform.example.test",
    )
    body.update(changes)
    return ok(client.post(BASE + "/targets", headers=OWNER, json=body), 201)


def cookie(client, id, value=COOKIE):
    return client.put(
        f"{BASE}/targets/{id}/tokens/session_cookie",
        headers=OWNER,
        json={"token": value},
    )


def start(client, id, **changes):
    body = copy.deepcopy(FIXTURES["start_request"])
    body["target_id"] = id
    body.update(changes)
    return client.post(BASE + "/runs", headers=OWNER, json=body)


def running(client):
    t = target(client)
    ok(cookie(client, t["id"]))
    run = ok(start(client, t["id"]), 201)
    ok(client.post(f'{R}/runs/{run["id"]}/claim', headers=runner_headers(), json={}))
    return t, run, f'{R}/runs/{run["id"]}'


def discovery(client, url, **changes):
    value = copy.deepcopy(FIXTURES["discovery_request"])
    value.update(changes)
    return client.put(url + "/discovery", headers=runner_headers(), json=value)


def summary(run):
    value = copy.deepcopy(FIXTURES["final_summary_request"])
    value["identity"]["run_id"] = run["id"]
    value["identity"]["run_number"] = run["number"]
    value["identity"]["target_name"] = "Dashboards"
    return value


def test_target_cookie_roundtrip_compatibility_and_tombstone(client, session_factory):
    t = target(client)
    assert t["settings"] == p.target_settings({}) and not t["sign_in_ready"]
    first = ok(cookie(client, t["id"]))
    assert first["version"] == 1 and first["hint"] == "2 cookies, saved " + stamp(NOW)
    second = ok(cookie(client, t["id"]))
    assert second["version"] == 2
    assert "private-opaque" not in json.dumps(second)
    old = ok(
        client.get(BASE + "/targets", headers={"X-User-Email": OWNER["X-User-Email"]})
    )
    assert all(row["id"] != t["id"] for row in old["targets"])
    mixed = ok(client.get(BASE + "/targets", headers=OWNER))
    assert next(r for r in mixed["targets"] if r["id"] == t["id"])["sign_in_ready"]
    ok(
        client.delete(f'{BASE}/targets/{t["id"]}/tokens/session_cookie', headers=OWNER),
        204,
    )
    third = ok(cookie(client, t["id"]))
    assert third["version"] > second["version"]
    refused(
        client.put(
            f'{BASE}/targets/{t["id"]}',
            headers=OWNER,
            json=dict(
                kind="chat", name="Changed", base_url=t["base_url"], is_production=False
            ),
        ),
        409,
        "target_kind_immutable",
    )
    refused(
        client.put(
            f'{BASE}/targets/{t["id"]}/tokens/refresh_token',
            headers=OWNER,
            json={"token": "private"},
        ),
        409,
        "wrong_target_kind",
    )


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("base_url", "https://platform.test/prefix", "target_address_has_path"),
        ("settings", {"routes": {"session": "//another.test"}}, "target_route_invalid"),
    ],
)
def test_target_address_and_routes(client, session_factory, field, value, code):
    body = dict(
        kind=p.KIND,
        name="Dashboards",
        base_url="https://platform.test",
        is_production=False,
    )
    body[field] = value
    refused(client.post(BASE + "/targets", headers=OWNER, json=body), 422, code)


def test_start_capability_no_dataset_and_control(client, session_factory):
    t = target(client)
    refused(start(client, t["id"]), 409, "session_cookie_required")
    ok(cookie(client, t["id"]))
    with session_factory() as db:
        runner = db.scalar(select(PerformanceRunner))
        runner.info = {}
        db.commit()
    refused(start(client, t["id"]), 409, "runner_kind_unsupported")
    with session_factory() as db:
        runner = db.scalar(select(PerformanceRunner))
        runner.info = {"supported_target_kinds": ["chat", p.KIND]}
        db.commit()
    assert start(client, t["id"], dataset_version_id="forbidden").status_code == 422
    refused(start(client, t["id"], test_type="soak"), 422, "unsupported_test_type")
    run = ok(start(client, t["id"]), 201)
    stored = get_run(session_factory, run["id"])
    assert stored.dataset_id is None and stored.dataset_version_id is None
    assert set(stored.config) == {
        "schema",
        "test_type",
        "target",
        "tokens",
        "plan",
        "note",
    }
    control = ok(client.get(R + "/control", headers=runner_headers()))
    assert control["run"]["tokens"][0]["value"] == COOKIE
    assert control["limits"]["steps_per_run_max"] == 50000
    read = ok(client.get(f'{BASE}/runs/{run["id"]}', headers=OWNER))
    assert "dataset" not in read["run"] and read["discovery"] is None
    assert (
        client.get(
            f'{BASE}/runs/{run["id"]}', headers={"X-User-Email": OWNER["X-User-Email"]}
        ).status_code
        == 404
    )


def test_discovery_steps_summary_and_reads(client, session_factory):
    _, run, url = running(client)
    records = FIXTURES["steps_request"]
    refused(
        client.post(url + "/steps", headers=runner_headers(), json=records),
        409,
        "discovery_required",
    )
    ok(discovery(client, url))
    ok(discovery(client, url))
    refused(discovery(client, url, titles_truncated=1), 409, "discovery_conflict")
    result = ok(client.post(url + "/steps", headers=runner_headers(), json=records))
    assert result["accepted"] == 5
    assert (
        ok(client.post(url + "/steps", headers=runner_headers(), json=records))[
            "duplicates"
        ]
        == 5
    )
    progress = copy.deepcopy(FIXTURES["progress_request"])
    ok(client.post(url + "/progress", headers=runner_headers(), json=progress))
    page = ok(client.get(f'{BASE}/runs/{run["id"]}/steps?type=error', headers=VIEWER))
    assert page["total"] == 1 and page["rows"][0]["seq"] == 4
    assert page["facets"]["types"] == ["open", "filter", "error"]
    csv = client.get(f'{BASE}/runs/{run["id"]}/steps.csv', headers=OWNER)
    assert csv.status_code == 200 and csv.content.startswith(b"\xef\xbb\xbfseq,at,")
    dashboards = ok(client.get(f'{BASE}/runs/{run["id"]}/dashboards', headers=OWNER))
    assert (
        dashboards["source"] == "retained_steps" and dashboards["rows"][0]["opens"] == 2
    )
    ok(client.put(url + "/summary", headers=runner_headers(), json=summary(run)))
    read = ok(client.get(f'{BASE}/runs/{run["id"]}', headers=OWNER))
    assert "dashboards" not in read["summary"] and "dashboards" not in read["discovery"]
    assert read["counts"]["steps_stored"] == 5
    dashboards = ok(client.get(f'{BASE}/runs/{run["id"]}/dashboards', headers=OWNER))
    assert dashboards["source"] == "summary" and dashboards["rows"][0]["opens"] == 3
    home = ok(client.get(BASE, headers=OWNER))
    assert "capacity_cards" in home and home["runs"]["rows"][0]["target_kind"] == p.KIND
    old = ok(client.get(BASE, headers={"X-User-Email": OWNER["X-User-Email"]}))
    assert old["runs"]["rows"] == [] and old["active_run"] is None


def test_rotation_handoff_and_secret_history(client, session_factory):
    t, run, url = running(client)
    newer = "session=private-new-session-C; refresh=private-new-refresh-D"
    rotated = ok(
        client.put(
            url + "/tokens/session_cookie",
            headers=runner_headers(),
            json=dict(value=newer, replaces_version=1, expires_at=None),
        )
    )
    assert rotated["version"] == 2
    assert (
        ok(
            client.put(
                url + "/tokens/session_cookie",
                headers=runner_headers(),
                json=dict(value=newer, replaces_version=1, expires_at=None),
            )
        )
        == rotated
    )
    ok(
        client.post(
            f'{BASE}/runs/{run["id"]}/tokens',
            headers=OWNER,
            json=dict(name="session_cookie", token=COOKIE),
        )
    )
    refused(
        client.put(
            url + "/tokens/session_cookie",
            headers=runner_headers(),
            json=dict(value=newer, replaces_version=2, expires_at=None),
        ),
        409,
        "token_version_conflict",
    )
    dirty = copy.deepcopy(FIXTURES["discovery_request"])
    dirty["dashboards"][0]["title"] = "private-opaque-session-A private-new-refresh-D"
    ok(client.put(url + "/discovery", headers=runner_headers(), json=dirty))
    ok(
        client.post(
            url + "/log",
            headers=runner_headers(),
            json={
                "lines": [
                    {
                        "seq": 1,
                        "at": stamp(NOW),
                        "level": "info",
                        "message": COOKIE + " " + newer,
                    }
                ]
            },
        )
    )
    refused(
        client.put(
            url + "/report",
            headers={**runner_headers(), "Content-Type": "text/html"},
            content="<html>private-new-refresh-D</html>",
        ),
        422,
        "contains_token",
    )
    for path in ("", "/discovery", "/log", "/events"):
        read = client.get(f'{BASE}/runs/{run["id"]}' + path, headers=OWNER)
        assert read.status_code == 200
        assert "private-opaque" not in read.text and "private-new" not in read.text


@pytest.mark.parametrize(
    "suffix",
    [
        "steps",
        "steps.csv",
        "dashboards",
        "discovery",
        "log",
        "log.txt",
        "events",
        "report",
    ],
)
def test_old_pages_cannot_read_platform_details(client, session_factory, suffix):
    _, run, _ = running(client)
    response = client.get(
        f'{BASE}/runs/{run["id"]}/{suffix}',
        headers={"X-User-Email": OWNER["X-User-Email"]},
    )
    assert response.status_code == 404


@pytest.mark.parametrize(
    "query",
    [
        "type=answer",
        "stage=warmup",
        "level=0",
        "dashboard=invalid",
        "after_seq=1&sort=-seq",
        "page=0",
        "page_size=201",
        "has_errors=yes",
    ],
)
def test_invalid_step_filters(client, session_factory, query):
    _, run, _ = running(client)
    assert (
        client.get(f'{BASE}/runs/{run["id"]}/steps?{query}', headers=OWNER).status_code
        == 422
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"plan": {"warmup_seconds": 30}},
        {"plan": {"max_users": 201}},
        {"plan": {"baseline_users": 11}},
        {"plan": {"hold_seconds": 29}},
        {"plan": {"ramp_seconds": -1}},
        {"plan": {"pause_seconds": None}},
        {"plan": {"max_dashboards": 0}},
        {"plan": {"filters_per_dashboard": 10001}},
        {"plan": {"timeout_seconds": 29}},
        {"plan": {"handoff_wait_seconds": 0}},
        {"plan": {"discovery_budget_seconds": 3601}},
        {"mix": {}},
        {"options": {}},
        {"test_type": "smoke", "plan": {"users": 2}},
        {"test_type": "smoke", "plan": {"duration_seconds": 10}},
    ],
)
def test_start_rejects_ranges_and_chat_fields(client, session_factory, changes):
    t = target(client)
    ok(cookie(client, t["id"]))
    assert start(client, t["id"], **changes).status_code == 422


@pytest.mark.parametrize(
    "value",
    [
        "",
        "Cookie: no-pair",
        "a=",
        "a=x\nsecret=value",
        "a=x\0secret=value",
        "bad name=x",
        "a=" + "x" * 16384,
    ],
)
def test_cookie_rejections_never_echo(client, session_factory, value):
    t = target(client)
    response = cookie(client, t["id"], value)
    refused(response, 422, "session_cookie_invalid")
    if value:
        assert value not in response.text


def test_same_origin_other_kind_and_auth_edit_clears_cookie(client, session_factory):
    with session_factory() as db:
        chat = db.scalar(select(PerformanceTarget))
        origin = chat.base_url
    t = target(client, base_url=origin)
    ok(cookie(client, t["id"]))
    edited = ok(
        client.put(
            f'{BASE}/targets/{t["id"]}',
            headers=OWNER,
            json=dict(
                name="Dashboards",
                is_production=False,
                base_url=origin,
                settings={"client_id": "different"},
            ),
        )
    )
    assert not edited["sign_in_ready"] and edited["tokens"] == []
    assert ok(cookie(client, t["id"]))["version"] > 1
    run = ok(start(client, t["id"]), 201)
    refused(
        client.put(
            f'{BASE}/targets/{t["id"]}',
            headers=OWNER,
            json=dict(
                name="Dashboards",
                is_production=False,
                base_url=origin,
                settings={"client_id": "another"},
            ),
        ),
        409,
        "target_busy",
    )


def test_expired_cookie_and_viewer_guards(client, session_factory):
    t = target(client)
    ok(
        client.put(
            f'{BASE}/targets/{t["id"]}/tokens/session_cookie',
            headers=OWNER,
            json=dict(token=COOKIE, expires_at=stamp(NOW - timedelta(seconds=1))),
        )
    )
    refused(start(client, t["id"]), 409, "session_cookie_expired")
    for method, path, body in [
        (
            "post",
            "/targets",
            dict(
                kind=p.KIND, name="No", is_production=False, base_url="https://x.test"
            ),
        ),
        ("put", f'/targets/{t["id"]}/tokens/session_cookie', {"token": COOKIE}),
        (
            "post",
            "/runs",
            dict(target_id=t["id"], target_kind=p.KIND, test_type="smoke", plan={}),
        ),
    ]:
        assert (
            getattr(client, method)(BASE + path, headers=VIEWER, json=body).status_code
            == 403
        )


@pytest.mark.parametrize(
    "change", ["counts", "runnable", "plan", "unknown", "partial", "duplicate"]
)
def test_discovery_atomic_validation(client, session_factory, change):
    _, run, url = running(client)
    value = copy.deepcopy(FIXTURES["discovery_request"])
    if change == "counts":
        value["counts"]["charts_found"] += 1
    if change == "runnable":
        value["dashboards"][0]["runnable"] = False
    if change == "plan":
        value["resolved_plan"]["total_seconds"] += 1
    if change == "unknown":
        value["cookie"] = COOKIE
    if change == "partial":
        value["partial"] = True
    if change == "duplicate":
        value["dashboards"].append(value["dashboards"][0])
    response = client.put(url + "/discovery", headers=runner_headers(), json=value)
    assert response.status_code == 422, response.text
    assert get_run(session_factory, run["id"]).discovery is None


def test_step_cap_dedupe_wrong_kind_and_source_loss(
    client, session_factory, monkeypatch
):
    from qym_platform.settings import PlatformSettings

    monkeypatch.setattr(
        "qym_platform.api.performance_ingest.ingest_settings",
        lambda: PlatformSettings(performance_platform_steps_per_run_max=2),
    )
    _, run, url = running(client)
    ok(discovery(client, url))
    batch = copy.deepcopy(FIXTURES["steps_request"])
    result = ok(client.post(url + "/steps", headers=runner_headers(), json=batch))
    assert (result["accepted"], result["dropped"]) == (2, 3)
    again = ok(client.post(url + "/steps", headers=runner_headers(), json=batch))
    assert (again["duplicates"], again["dropped"]) == (2, 3)
    stored = get_run(session_factory, run["id"])
    assert (stored.steps_received, stored.steps_dropped) == (5, 3)
    table = ok(client.get(f'{BASE}/runs/{run["id"]}/dashboards', headers=OWNER))
    assert not table["records_complete"]
    from _performance_support import question_record

    refused(
        client.post(
            url + "/questions",
            headers=runner_headers(),
            json={"records": [question_record(1)]},
        ),
        409,
        "wrong_target_kind",
    )
    refused(
        client.get(url + "/dataset-items", headers=runner_headers()),
        409,
        "wrong_target_kind",
    )
    refused(
        client.get(f'{BASE}/runs/{run["id"]}/questions', headers=OWNER),
        409,
        "wrong_target_kind",
    )
    invalid = copy.deepcopy(batch["records"][0])
    invalid["seq"] = 10
    invalid["dashboard_id"] = "101"
    result = ok(
        client.post(
            url + "/steps", headers=runner_headers(), json={"records": [invalid]}
        )
    )
    assert result["rejected"] == 1


@pytest.mark.parametrize(
    "mutation",
    [
        "threshold",
        "coverage",
        "plan",
        "identity",
        "rate",
        "duration",
        "dashboard",
        "result",
        "unknown",
    ],
)
def test_summary_cross_checks(client, session_factory, mutation):
    _, run, url = running(client)
    ok(discovery(client, url))
    value = summary(run)
    if mutation == "threshold":
        value["thresholds"][0]["expression"] = "p(95)<20000"
    if mutation == "coverage":
        value["coverage_counts"]["charts_unusable"] = 1
    if mutation == "plan":
        value["plan"]["chart_batch"] = 8
    if mutation == "identity":
        value["identity"]["run_id"] = "other"
    if mutation == "rate":
        value["overall"]["error_rate_pct"] = 50
    if mutation == "duration":
        value["levels"][0]["actual_duration_s"] = 1
    if mutation == "dashboard":
        value["dashboards"][0]["dashboard_id"] = "101"
    if mutation == "result":
        value["levels"][0]["result"] = "break"
    if mutation == "unknown":
        value["suite_summary"] = {"cookie": COOKIE}
    response = client.put(url + "/summary", headers=runner_headers(), json=value)
    assert response.status_code == 422, response.text
    assert get_run(session_factory, run["id"]).summary is None


def test_progress_counters_and_discovery_required(client, session_factory):
    _, run, url = running(client)
    value = copy.deepcopy(FIXTURES["progress_request"])
    refused(
        client.post(url + "/progress", headers=runner_headers(), json=value),
        409,
        "discovery_required",
    )
    ok(discovery(client, url))
    ok(client.post(url + "/progress", headers=runner_headers(), json=value))
    value["seq"] += 1
    value["progress"]["dashboard_opens"] = 1
    refused(
        client.post(url + "/progress", headers=runner_headers(), json=value),
        422,
        "counters_must_not_decrease",
    )


def test_old_registration_fails_queued_platform_without_disclosure(
    client, session_factory
):
    t = target(client)
    ok(cookie(client, t["id"]))
    run = ok(start(client, t["id"]), 201)
    ok(client.put(R, headers=runner_headers(), json={"name": "Old runner", "info": {}}))
    stored = get_run(session_factory, run["id"])
    assert (
        stored.status == "failed" and stored.status_reason == "runner_kind_unsupported"
    )
    control = ok(client.get(R + "/control", headers=runner_headers()))
    assert control["run"] is None and "steps_per_run_max" not in control["limits"]


@pytest.mark.parametrize(
    "kinds", [[], ["chat", "chat"], ["unknown"], "chat", ["chat", p.KIND, "chat"]]
)
def test_capability_advertisement_validation(client, session_factory, kinds):
    assert (
        client.put(
            R,
            headers=runner_headers(),
            json={"name": "Runner", "info": {"supported_target_kinds": kinds}},
        ).status_code
        == 422
    )


def test_retention_preserves_discovery_summary_and_counters(
    client, session_factory, monkeypatch
):
    from qym_platform.services.performance_retention import purge_performance

    monkeypatch.setenv("QYM_PERFORMANCE_DETAIL_RETENTION_DAYS", "1")
    _, run, url = running(client)
    ok(discovery(client, url))
    ok(
        client.post(
            url + "/steps", headers=runner_headers(), json=FIXTURES["steps_request"]
        )
    )
    ok(client.put(url + "/summary", headers=runner_headers(), json=summary(run)))
    with session_factory() as db:
        row = db.get(PerformanceRun, run["id"])
        row.status = "finished"
        row.finished_at = NOW - timedelta(days=2)
        db.commit()
    assert purge_performance(session_factory, now=NOW)["steps"] == 5
    page = ok(client.get(f'{BASE}/runs/{run["id"]}/steps', headers=OWNER))
    assert (
        page["details_expired"] and not page["rows"] and page["counts"]["received"] == 5
    )
    read = ok(client.get(f'{BASE}/runs/{run["id"]}', headers=OWNER))
    assert read["summary"] and read["discovery"]


def test_late_rotation_cannot_restore_deleted_generation(client, session_factory):
    t, run, url = running(client)
    with session_factory() as db:
        row = db.get(PerformanceRun, run["id"])
        row.status = "failed"
        row.finished_at = NOW
        db.commit()
    ok(
        client.delete(f'{BASE}/targets/{t["id"]}/tokens/session_cookie', headers=OWNER),
        204,
    )
    new = ok(cookie(client, t["id"], "session=totally-new-generation"))
    refused(
        client.put(
            url + "/tokens/session_cookie",
            headers=runner_headers(),
            json={"value": COOKIE, "replaces_version": new["version"]},
        ),
        409,
        "token_version_conflict",
    )


@pytest.mark.parametrize(
    "channel", ["progress", "steps", "events", "summary", "registration"]
)
def test_cookie_values_redacted_on_every_ingest_channel(
    client, session_factory, channel
):
    _, run, url = running(client)
    secrets = [
        COOKIE,
        "private-opaque-session-A",
        "private-opaque-refresh-B",
        "session=private-opaque-session-A",
    ]
    dirty = " | ".join(secrets)
    d = copy.deepcopy(FIXTURES["discovery_request"])
    d["dashboards"][0]["title"] = dirty
    ok(client.put(url + "/discovery", headers=runner_headers(), json=d))
    if channel == "progress":
        body = copy.deepcopy(FIXTURES["progress_request"])
        body["progress"]["message"] = dirty
        ok(client.post(url + "/progress", headers=runner_headers(), json=body))
    elif channel == "steps":
        body = copy.deepcopy(FIXTURES["steps_request"])
        body["records"][1]["control"] = {"type": "filter", "id": dirty}
        ok(client.post(url + "/steps", headers=runner_headers(), json=body))
    elif channel == "events":
        body = {
            "events": [
                {
                    "at": stamp(NOW),
                    "level": "warning",
                    "code": "session_wait_started",
                    "message": dirty,
                    "details": {"note": dirty},
                    "run_id": run["id"],
                }
            ]
        }
        ok(client.post(R + "/events", headers=runner_headers(), json=body))
    elif channel == "summary":
        value = summary(run)
        value["source_verdict_reason"] = dirty
        value["dashboards"][0]["title"] = " | ".join(["[REDACTED]"] * 4)
        # Use the exact sanitized title emitted by discovery.
        value["dashboards"][0]["title"] = ok(
            client.get(f'{BASE}/runs/{run["id"]}/discovery', headers=OWNER)
        )["rows"][0]["title"]
        ok(client.put(url + "/summary", headers=runner_headers(), json=value))
    else:
        ok(
            client.put(
                R,
                headers=runner_headers(),
                json={
                    "name": dirty,
                    "info": {"note": dirty, "supported_target_kinds": ["chat", p.KIND]},
                },
            )
        )
    for suffix in ("", "/discovery", "/steps", "/dashboards", "/events"):
        text = client.get(f'{BASE}/runs/{run["id"]}' + suffix, headers=OWNER).text
        assert all(secret not in text for secret in secrets)
    assert all(
        secret not in client.get(BASE + "/runner", headers=OWNER).text
        for secret in secrets
    )


@pytest.mark.parametrize(
    "route,setting",
    [
        ("discovery", "performance_platform_discovery_max_bytes"),
        ("summary", "performance_platform_summary_max_bytes"),
        ("progress", "performance_platform_progress_max_bytes"),
    ],
)
def test_platform_payload_byte_limits(
    client, session_factory, monkeypatch, route, setting
):
    from qym_platform.settings import PlatformSettings

    _, run, url = running(client)
    monkeypatch.setattr(
        "qym_platform.api.performance_ingest.ingest_settings",
        lambda: PlatformSettings(**{setting: 100}),
    )
    payload = copy.deepcopy(
        FIXTURES[
            {
                "discovery": "discovery_request",
                "summary": "final_summary_request",
                "progress": "progress_request",
            }[route]
        ]
    )
    response = getattr(client, "post" if route == "progress" else "put")(
        url + "/" + route, headers=runner_headers(), json=payload
    )
    assert response.status_code == 413


def test_new_ingest_routes_honor_maintenance(client, session_factory, monkeypatch):
    from qym_platform.settings import PlatformSettings

    monkeypatch.setattr(
        "qym_platform.api.ingest.ingest_settings",
        lambda: PlatformSettings(maintenance_mode=True),
    )
    for method, suffix in (("put", "discovery"), ("post", "steps")):
        assert (
            getattr(client, method)(
                R + "/runs/any/" + suffix, headers=runner_headers(), json={}
            ).status_code
            == 503
        )


def test_cookie_words_do_not_corrupt_wire_structure(client, session_factory):
    t = target(client)
    ok(cookie(client, t["id"], "view=dashboard; mode=open; color=blue"))
    run = ok(start(client, t["id"]), 201)
    url = f'{R}/runs/{run["id"]}'
    ok(client.post(url + "/claim", headers=runner_headers(), json={}))
    ok(discovery(client, url))
    ok(
        client.post(
            url + "/steps", headers=runner_headers(), json=FIXTURES["steps_request"]
        )
    )
    ok(
        client.post(
            url + "/progress",
            headers=runner_headers(),
            json=FIXTURES["progress_request"],
        )
    )
    ok(client.put(url + "/summary", headers=runner_headers(), json=summary(run)))
    read = ok(client.get(f'{BASE}/runs/{run["id"]}', headers=OWNER))
    assert (
        read["summary"]["plan"]["theme"] == "blue"
        and "dashboard_opens" in read["progress"]
    )


def test_sample_overflow_refuses_dashboard_percentiles(client, session_factory):
    _, run, url = running(client)
    ok(discovery(client, url))
    value = summary(run)
    value["measurements"].update(percentiles_complete=False, reason="sample_limit")
    value["headline"].update(open_p95_ms=None, filter_p95_ms=None)
    value["thresholds"][0].update(measured=None, ok=None)
    response = client.put(url + "/summary", headers=runner_headers(), json=value)
    assert response.status_code == 422


def test_expired_details_hidden_before_cleanup(client, session_factory, monkeypatch):
    monkeypatch.setenv("QYM_PERFORMANCE_DETAIL_RETENTION_DAYS", "1")
    _, run, url = running(client)
    ok(discovery(client, url))
    ok(
        client.post(
            url + "/steps", headers=runner_headers(), json=FIXTURES["steps_request"]
        )
    )
    with session_factory() as db:
        row = db.get(PerformanceRun, run["id"])
        row.status = "finished"
        row.finished_at = NOW - timedelta(days=2)
        db.commit()
    path = f'{BASE}/runs/{run["id"]}'
    result = ok(client.get(path + "/steps", headers=OWNER))
    assert (
        result["details_expired"]
        and result["rows"] == []
        and result["total"] == 0
        and result["counts"]["retained"] == 0
    )
    csv = client.get(path + "/steps.csv", headers=OWNER)
    assert len(csv.text.splitlines()) == 1
    dashboards = ok(client.get(path + "/dashboards", headers=OWNER))
    assert dashboards["rows"][0]["opens"] == 0 and not dashboards["records_complete"]


def test_cookie_delete_repeat_and_chat_name_validation(client, session_factory):
    t = target(client)
    ok(cookie(client, t["id"]))
    path = f'{BASE}/targets/{t["id"]}/tokens/session_cookie'
    ok(client.delete(path, headers=OWNER), 204)
    with session_factory() as db:
        row = db.scalar(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.target_id == t["id"]
            )
        )
        before = (row.version, row.generation)
        chat = db.scalar(
            select(PerformanceTarget).where(PerformanceTarget.kind == "chat")
        )
        chat_id = chat.id
    ok(client.delete(path, headers=OWNER), 204)
    with session_factory() as db:
        row = db.scalar(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.target_id == t["id"]
            )
        )
        assert (row.version, row.generation) == before
    refused(
        client.delete(f"{BASE}/targets/{chat_id}/tokens/session_cookie", headers=OWNER),
        422,
        "validation_error",
    )


def test_cookie_words_preserve_registered_capabilities(client, session_factory):
    t = target(client)
    ok(cookie(client, t["id"], "workload=estishraf_platform; legacy=chat"))
    kinds = ["chat", p.KIND]
    response = ok(
        client.put(
            R,
            headers=runner_headers(),
            json={
                "name": "Performance runner",
                "info": {"supported_target_kinds": kinds},
            },
        )
    )
    assert response["info"]["supported_target_kinds"] == kinds
    ok(start(client, t["id"]), 201)


@pytest.mark.parametrize(
    "field",
    [
        "note",
        "stop_reason",
        "target_name",
        "event_code",
        "event_message",
        "error",
        "log",
        "title",
        "id",
        "verdict_reason",
    ],
)
def test_round2_free_text_masks_current_and_history(client, session_factory, field):
    t, run, url = running(client)
    old = "private_previous_cookie"
    current = "private_current_cookie"
    ok(cookie(client, t["id"], "session=" + old))
    ok(cookie(client, t["id"], "session=" + current))
    dirty = old + " " + current
    if field == "note":
        ok(client.post(f'{BASE}/runs/{run["id"]}/stop', headers=OWNER, json={}))
        ok(
            client.post(
                url + "/progress",
                headers=runner_headers(),
                json={"seq": 1, "status": "stopped", "at": stamp(NOW), "progress": {}},
            )
        )
        newer = ok(start(client, t["id"], note=dirty), 201)
        with session_factory() as db:
            assert old not in db.get(PerformanceRun, newer["id"]).config["note"]
            assert current not in db.get(PerformanceRun, newer["id"]).config["note"]
        return
    if field == "stop_reason":
        ok(
            client.post(
                f'{BASE}/runs/{run["id"]}/stop', headers=OWNER, json={"reason": dirty}
            )
        )
    elif field == "target_name":
        ok(
            client.put(
                f'{BASE}/targets/{t["id"]}',
                headers=OWNER,
                json={"name": dirty, "base_url": t["base_url"], "is_production": False},
            )
        )
        with session_factory() as db:
            assert old not in db.get(PerformanceTarget, t["id"]).name
            assert current not in db.get(PerformanceTarget, t["id"]).name
    elif field.startswith("event_"):
        body = {
            "events": [
                {
                    "at": stamp(NOW),
                    "level": "info",
                    "code": old if field == "event_code" else "notice",
                    "message": dirty,
                    "details": {},
                    "run_id": run["id"],
                }
            ]
        }
        ok(client.post(R + "/events", headers=runner_headers(), json=body))
    elif field == "error":
        ok(
            client.post(
                url + "/progress",
                headers=runner_headers(),
                json={
                    "seq": 1,
                    "status": "failed",
                    "at": stamp(NOW),
                    "progress": {},
                    "error": dirty,
                },
            )
        )
    elif field == "log":
        ok(
            client.post(
                url + "/log",
                headers=runner_headers(),
                json={
                    "lines": [
                        {"seq": 1, "at": stamp(NOW), "level": "info", "message": dirty}
                    ]
                },
            )
        )
    else:
        d = copy.deepcopy(FIXTURES["discovery_request"])
        if field == "title":
            d["dashboards"][0]["title"] = dirty
        if field == "id":
            d["dashboards"][0]["id"] = old
            d["resolved_plan"]["dashboard_ids"] = [old]
        ok(client.put(url + "/discovery", headers=runner_headers(), json=d))
        if field == "verdict_reason":
            value = summary(run)
            value["source_verdict_reason"] = dirty
            ok(client.put(url + "/summary", headers=runner_headers(), json=value))
    with session_factory() as db:
        from qym_platform.db.models import (
            AuditLog,
            PerformanceEvent,
            PerformanceLogLine,
        )

        row = db.get(PerformanceRun, run["id"])
        saved = [
            row.config,
            row.progress,
            row.summary,
            row.discovery,
            row.stop_reason,
            row.error,
        ]
        saved += [
            [r.code, r.message, r.details] for r in db.scalars(select(PerformanceEvent))
        ]
        saved += [r.message for r in db.scalars(select(PerformanceLogLine))]
        saved += [[r.before, r.after] for r in db.scalars(select(AuditLog))]
        text = json.dumps(saved, default=str)
        assert old not in text and current not in text


@pytest.mark.parametrize(
    "code", ["Upper", "two words", "a-b", "x" * 61, "cookie=private"]
)
def test_round2_event_identifier_validation(client, session_factory, code):
    _, run, _ = running(client)
    response = client.post(
        R + "/events",
        headers=runner_headers(),
        json={
            "events": [
                {
                    "at": stamp(NOW),
                    "level": "info",
                    "code": code,
                    "message": "Notice",
                    "run_id": run["id"],
                }
            ]
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "route",
    [
        "discovery",
        "summary",
        "progress",
        "events",
        "log",
        "steps",
        "tokens/session_cookie",
        "claim",
        "register",
        "heartbeat",
    ],
)
def test_round2_validation_does_not_echo_unknown_keys(client, session_factory, route):
    _, run, url = running(client)
    payload = {COOKIE: 1, "nested_unknown_" + COOKIE: 2}
    method = (
        "put"
        if route in ("discovery", "summary", "tokens/session_cookie", "register")
        else "post"
    )
    path = (
        R
        if route == "register"
        else R + "/" + route if route in ("events", "heartbeat") else url + "/" + route
    )
    response = getattr(client, method)(path, headers=runner_headers(), json=payload)
    assert response.status_code == 422
    assert COOKIE not in response.text and "nested_unknown_" not in response.text
    if route not in ("steps",):
        assert "Unknown fields are not allowed" in response.text
        assert "2" in response.text


@pytest.mark.parametrize(
    "mutation",
    [
        "unplanned",
        "no_data",
        "failed",
        "auth",
        "recommendation",
        "break_no_flags",
        "verdict_disagrees",
        "null_safe_recommendation",
    ],
)
def test_round2_summary_capacity_integrity(client, session_factory, mutation):
    _, run, url = running(client)
    ok(discovery(client, url))
    value = summary(run)
    h = value["headline"]
    row = value["levels"][0]
    if mutation == "unplanned":
        h.update(
            safe_load_users=9999, recommended_max_users=7999, p95_at_safe_load_ms=None
        )
    elif mutation == "no_data":
        row.update(has_data=False, result="no_data")
        h["highest_tested_users"] = 0
    elif mutation == "failed":
        row.update(passed=False, result="break", latency_breach=True)
    elif mutation == "auth":
        row.update(auth_contaminated=True, result="auth")
    elif mutation == "recommendation":
        h["recommended_max_users"] = 2
    elif mutation == "break_no_flags":
        value["verdict"] = "breakpoint_found"
        row.update(passed=False, result="break")
        h.update(
            safe_load_users=0,
            recommended_max_users=0,
            p95_at_safe_load_ms=None,
            breaking_level_users=1,
            breaking_reason="errors",
            p95_at_break_ms=1000,
        )
    elif mutation == "verdict_disagrees":
        value["verdict"] = "invalid_auth"
    else:
        h.update(
            safe_load_users=None, recommended_max_users=99, p95_at_safe_load_ms=None
        )
    refused(
        client.put(url + "/summary", headers=runner_headers(), json=value),
        422,
        "validation_error",
    )


def test_sign_in_verdict_accepts_a_wait_that_never_ended(client):
    """Baseline hand-off timeout: baseline data, no measured or affected hold.

    Mirrors the retained auth-timeout runner summary, using this fixture's
    identity, discovery, planned hold and baseline dashboard measurements.
    """
    _, run, url = running(client)
    ok(discovery(client, url))
    value = summary(run)
    began = datetime.fromisoformat(value["started_at"].removesuffix("Z"))
    value.update(
        verdict="invalid_auth",
        verdict_reason="Not valid: sign-in",
        source_verdict_reason="The wait for a new sign-in ended before any level was measured.",
        ended_by="error",
        exit_code=105,
        ended_at=stamp(began + timedelta(seconds=12)),
    )
    for row in value["levels"]:
        row.update(
            has_data=False,
            passed=False,
            latency_breach=False,
            error_breach=False,
            auth_contaminated=False,
            result="no_data",
        )
        for key in (
            "actual_duration_s",
            "hold_elapsed_pct",
            "per_minute",
            "requests",
            "request_outcomes",
            "failed_request_outcomes",
            "dashboards_opened",
            "filters_applied",
            "charts_drawn",
            "chart_unavailable_errors",
            "charts_failed",
            "auth_waits",
            "auth_wait_recovered",
        ):
            row[key] = 0
        for key in (
            "open_p50_ms",
            "open_p95_ms",
            "open_p99_ms",
            "open_max_ms",
            "filter_p50_ms",
            "filter_p95_ms",
            "filter_max_ms",
            "error_rate_pct",
            "auth_error_rate_pct",
        ):
            row[key] = None
        row["errors_by_class"] = {key: 0 for key in row["errors_by_class"]}
    for threshold in value["thresholds"]:
        if threshold["scope"] == "level":
            threshold.update(measured=None, ok=None)
    value["headline"].update(
        safe_load_users=0,
        recommended_max_users=0,
        p95_at_safe_load_ms=None,
        highest_tested_users=0,
        opens_measured=0,
        duration_s=12,
    )
    value["auth"].update(
        waits=1,
        wait_recovered=0,
        incident=dict(
            first_failure_s=11,
            last_failure_s=11,
            contaminated_levels=[],
            clean_levels=[],
        ),
        handoffs=[
            dict(
                phase="load",
                rejected_at=stamp(began + timedelta(seconds=9)),
                recovered_at=None,
                deadline_at=stamp(began + timedelta(seconds=12)),
                outcome="timed_out",
            )
        ],
    )
    accepted = ok(client.put(url + "/summary", headers=runner_headers(), json=value))
    assert accepted["verdict"] == "invalid_auth"
    value["auth"]["wait_recovered"] = value["auth"]["waits"]
    response = client.put(url + "/summary", headers=runner_headers(), json=value)
    refused(response, 422, "validation_error")
    assert (
        response.json()["detail"][0]["msg"]
        == "Sign-in verdict requires an affected measurement"
    )


def test_round2_summary_origin_checked_before_masking(client, session_factory):
    t, run, url = running(client)
    ok(cookie(client, t["id"], "session=platform"))
    ok(discovery(client, url))
    ok(client.put(url + "/summary", headers=runner_headers(), json=summary(run)))
    with session_factory() as db:
        assert (
            db.get(PerformanceRun, run["id"]).summary["target_url"]
            == "https://[REDACTED].example.test"
        )
    value = summary(run)
    value["target_url"] = "https://other.example.test"
    assert (
        client.put(url + "/summary", headers=runner_headers(), json=value).status_code
        == 422
    )


@pytest.mark.parametrize(
    "value,count", [("a=one", 1), ("a=one; a=two", 1), ("a=one; b=two", 2)]
)
def test_round2_cookie_hint_grammar(client, session_factory, value, count):
    t = target(client)
    assert (
        ok(cookie(client, t["id"], value))["hint"]
        == f'{count} {"cookie" if count == 1 else "cookies"}, saved {stamp(NOW)}'
    )


def test_round2_breakpoint_ramp_minimum(client, session_factory):
    assert ok(client.get(BASE + "/setup", headers=OWNER))["platform"]["limits"][
        "ramp_seconds"
    ] == [1, 3600]
    t = target(client)
    ok(cookie(client, t["id"]))
    response = start(client, t["id"], plan={"ramp_seconds": 0})
    refused(response, 422, "validation_error")
    assert "Give at least 1 second to reach each level" in response.text
    ok(start(client, t["id"], plan={"ramp_seconds": 1}), 201)


def test_round3_history_pruned_after_dependent_run_late_window(client, session_factory):
    from qym_platform.services import performance_redaction as red
    from qym_platform.services import performance_retention as retention

    t, run, _ = running(client)
    ok(cookie(client, t["id"], "session=obsolete"))
    ok(cookie(client, t["id"], "session=current"))
    retention.purge_performance(session_factory, now=NOW + timedelta(days=1))
    with session_factory() as db:
        assert "obsolete" in red.token_values(db, target_id=t["id"])
        row = db.get(PerformanceRun, run["id"])
        row.status = "finished"
        row.finished_at = NOW
        db.commit()
    retention.purge_performance(session_factory, now=NOW + timedelta(seconds=600))
    with session_factory() as db:
        assert "obsolete" in red.token_values(db, target_id=t["id"])
    retention.purge_performance(session_factory, now=NOW + timedelta(seconds=601))
    with session_factory() as db:
        assert "obsolete" not in red.token_values(db, target_id=t["id"])
        assert "current" in red.token_values(db, target_id=t["id"])


def test_round3_history_cap_never_blocks_person_save(
    client, session_factory, monkeypatch
):
    monkeypatch.setattr(p, "COOKIE_HISTORY_MAX", 3, raising=False)
    t, _, _ = running(client)
    for value in ("first", "second", "third"):
        ok(cookie(client, t["id"], "session=" + value))
    response = cookie(client, t["id"], "session=fourth")
    assert response.status_code == 200, response.text
    from qym_platform.services import performance_redaction as red

    with session_factory() as db:
        assert "first" in red.token_values(db, target_id=t["id"])
        assert "third" in red.token_values(db, target_id=t["id"])
        assert "private-opaque-session-A" not in red.token_values(db, target_id=t["id"])
        assert (
            len(
                p.cookie_history(
                    db.scalar(
                        select(PerformanceTargetToken).where(
                            PerformanceTargetToken.target_id == t["id"]
                        )
                    ),
                    NOW,
                )
            )
            == 3
        )


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
def test_round2_report_ingest_refuses_equivalent_escapes(
    client, session_factory, encoded
):
    t, _, url = running(client)
    ok(cookie(client, t["id"], "session=private_secret"))
    refused(
        client.put(
            url + "/report",
            headers={**runner_headers(), "Content-Type": "text/html"},
            content='<script>let value="' + encoded + '"</script>',
        ),
        422,
        "contains_token",
    )


@pytest.mark.parametrize(
    "route", ["log", "events", "progress", "discovery", "summary", "steps"]
)
def test_round2_nested_validation_names_are_not_echoed(client, session_factory, route):
    _, run, url = running(client)
    if route == "log":
        payload = {
            "lines": [
                {
                    "seq": 1,
                    "at": stamp(NOW),
                    "level": "info",
                    "message": "text",
                    COOKIE: 1,
                }
            ]
        }
    elif route == "events":
        payload = {
            "events": [
                {
                    "at": stamp(NOW),
                    "code": "notice",
                    "message": "text",
                    "level": "info",
                    COOKIE: 1,
                }
            ]
        }
    else:
        key = {
            "progress": "progress_request",
            "discovery": "discovery_request",
            "summary": "final_summary_request",
            "steps": "steps_request",
        }[route]
        payload = copy.deepcopy(FIXTURES[key])
        if route == "progress":
            payload["progress"]["auth"][COOKIE] = 1
        elif route == "discovery":
            payload["dashboards"][0][COOKIE] = 1
        elif route == "summary":
            payload["headline"][COOKIE] = 1
        else:
            ok(discovery(client, url))
            payload["records"][0][COOKIE] = 1
    response = getattr(client, "put" if route in ("discovery", "summary") else "post")(
        R + "/events" if route == "events" else url + "/" + route,
        headers=runner_headers(),
        json=payload,
    )
    assert response.status_code in (200, 422)
    assert COOKIE not in response.text
    if response.status_code == 200:
        assert response.json()["rejected"] >= 1


def test_round2_legacy_history_does_not_attach_to_future_runs(client, session_factory):
    from qym_platform import secrets
    from qym_platform.services import (
        performance_retention as retention,
        performance_redaction as red,
    )

    t, run, _ = running(client)
    with session_factory() as db:
        token = db.scalar(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.target_id == t["id"]
            )
        )
        token.history_encrypted = secrets.encrypt_llm_api_key(
            json.dumps(["session=obsolete_legacy"])
        )
        token.updated_at = NOW
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(token, "updated_at")
        db.get(PerformanceRun, run["id"]).requested_at = NOW + timedelta(days=1)
        db.commit()
    retention.purge_performance(session_factory, now=NOW + timedelta(days=2))
    with session_factory() as db:
        assert "obsolete_legacy" not in red.token_values(db, target_id=t["id"])
        token = db.scalar(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.target_id == t["id"]
            )
        )
        assert token.updated_at == NOW


def test_round2_generated_event_counts_keep_protocol_keys(client, session_factory):
    t, run, url = running(client)
    ok(cookie(client, t["id"], "view=dashboard; mode=count"))
    ok(discovery(client, url))
    from qym_platform.db.models import PerformanceEvent

    with session_factory() as db:
        event = db.scalar(
            select(PerformanceEvent).where(
                PerformanceEvent.run_id == run["id"],
                PerformanceEvent.code == "discovery_completed",
            )
        )
        assert event.details["counts"] == FIXTURES["discovery_request"]["counts"]


@pytest.mark.parametrize("safe", [0, None])
def test_round2_within_limits_requires_measured_capacity(client, session_factory, safe):
    _, run, url = running(client)
    ok(discovery(client, url))
    value = summary(run)
    value["headline"].update(
        safe_load_users=safe, recommended_max_users=0, p95_at_safe_load_ms=None
    )
    refused(
        client.put(url + "/summary", headers=runner_headers(), json=value),
        422,
        "validation_error",
    )


def test_round3_history_without_a_run_drops_immediately(client, session_factory):
    t = target(client)
    for index in range(3):
        ok(cookie(client, t["id"], f"session=round3_idle_{index}"))
        with session_factory() as db:
            token = db.scalar(
                select(PerformanceTargetToken).where(
                    PerformanceTargetToken.target_id == t["id"]
                )
            )
            assert token.history_encrypted is None


def test_round3_300_rotations_keep_latest_256_and_allow_person_save(
    client, session_factory
):
    from qym_platform.services import performance_redaction as red
    from qym_platform.services import performance_retention as retention

    t, run, url = running(client)
    for index in range(1, 301):
        result = ok(
            client.put(
                url + "/tokens/session_cookie",
                headers=runner_headers(),
                json=dict(
                    value=f"session=round3_rotation_{index:04d}_secret",
                    replaces_version=index,
                ),
            )
        )
        assert result["version"] == index + 1
    with session_factory() as db:
        token = db.scalar(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.target_id == t["id"]
            )
        )
        history = p.cookie_history(token, NOW)
        assert [entry["value"] for entry in history] == [
            f"session=round3_rotation_{index:04d}_secret" for index in range(44, 300)
        ]
        mask = red.masker(db, target_id=t["id"])
        for entry in history:
            value = entry["value"].split("=", 1)[1]
            assert mask.contains(value)
            assert value not in mask.text(entry["value"])
    ok(
        client.post(
            f'{BASE}/runs/{run["id"]}/tokens',
            headers=OWNER,
            json=dict(name="session_cookie", token="session=round3_person_handoff"),
        )
    )
    ok(cookie(client, t["id"], "session=round3_person_saved"))
    with session_factory() as db:
        row = db.get(PerformanceRun, run["id"])
        row.status, row.finished_at = "finished", NOW
        db.commit()
    retention.purge_performance(session_factory, now=NOW + timedelta(seconds=601))
    with session_factory() as db:
        token = db.scalar(
            select(PerformanceTargetToken).where(
                PerformanceTargetToken.target_id == t["id"]
            )
        )
        assert token.history_encrypted is None
        assert "round3_person_saved" in red.token_values(db, target_id=t["id"])
        assert db.get(PerformanceRun, run["id"]) is not None


def test_round3_rotation_event_keeps_first_position_and_separate_handoffs(
    client, session_factory, monkeypatch
):
    from qym_platform.db.models import PerformanceEvent

    _, run, url = running(client)
    for index in range(3):
        when = NOW + timedelta(seconds=index * 2)
        at_time(monkeypatch, when)
        payload = dict(
            value=f"session=round3_event_{index}", replaces_version=1 + index * 2
        )
        result = ok(
            client.put(
                url + "/tokens/session_cookie", headers=runner_headers(), json=payload
            )
        )
        assert (
            ok(
                client.put(
                    url + "/tokens/session_cookie",
                    headers=runner_headers(),
                    json=payload,
                )
            )
            == result
        )
        if index < 2:
            page_time(monkeypatch, when + timedelta(seconds=1))
            ok(
                client.post(
                    f'{BASE}/runs/{run["id"]}/tokens',
                    headers=OWNER,
                    json=dict(
                        name="session_cookie", token=f"session=round3_handoff_{index}"
                    ),
                )
            )
    with session_factory() as db:
        events = list(
            db.scalars(
                select(PerformanceEvent)
                .where(PerformanceEvent.run_id == run["id"])
                .order_by(PerformanceEvent.id)
            )
        )
        rotations = [event for event in events if event.code == "token_rotated"]
        handoffs = [event for event in events if event.code == "token_supplied"]
        assert len(rotations) == 1 and len(handoffs) == 2
        event = rotations[0]
        assert event.at == NOW and event.id < handoffs[0].id < handoffs[1].id
        assert (
            event.message
            == "The target replaced the session cookie 3 times; the latest one is saved"
        )
        assert event.details == dict(
            name="session_cookie",
            count=3,
            version=6,
            hint=result["hint"],
            last_at=stamp(NOW + timedelta(seconds=4)),
        )


def test_round3_updated_rotation_message_masks_the_new_cookie(client, session_factory):
    from qym_platform.db.models import PerformanceEvent

    _, run, url = running(client)
    for version, value in enumerate(("round3_first_value", "times"), start=1):
        ok(
            client.put(
                url + "/tokens/session_cookie",
                headers=runner_headers(),
                json=dict(value="session=" + value, replaces_version=version),
            )
        )
    with session_factory() as db:
        event = db.scalar(
            select(PerformanceEvent).where(
                PerformanceEvent.run_id == run["id"],
                PerformanceEvent.code == "token_rotated",
            )
        )
        assert "times" not in event.message
        assert "[REDACTED]" in event.message
