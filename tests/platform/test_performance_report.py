"""The result of a run: the summary and the report file, their caps and the token refusal."""

from __future__ import annotations

import hashlib
import html
import json
import zlib
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    NOW,
    TOKENS,
    at_time,
    get_run,
    make_run,
    runner_headers,
    runner_path,
    seed_performance,
    seed_token,
    summary_body,
    supply_token,
    use_encryption_key,
)
from qym_platform.db.models import PerformanceReport, PerformanceRun, PerformanceTarget
from qym_platform.services import performance_ingest
from qym_platform.settings import PlatformSettings

PROJECT = "performance-project-1"
BASE = runner_path(PROJECT)
REFRESH = TOKENS["refresh_token"]
MARKUP_TOKEN = 'tok<en>&"41bd'
REPORT = "<!doctype html><title>QA - report</title><p>Breaks at 20 users · حد 180 ث</p>".encode(
    "utf-8"
)
HEADLINE_COLUMNS = (
    "safe_load_users",
    "breaking_level_users",
    "breaking_reason",
    "recommended_max_users",
    "p95_at_safe_load_ms",
    "answers_measured",
    "answers_total",
    "errors_total",
    "error_rate_pct",
    "p95_ms",
    "ttfb_p95_ms",
    "max_users",
    "duration_s",
    "quality_mean",
)


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


def _refused(response, status: int, code: str, detail: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert (body["error"]["code"], body["detail"]) == (code, detail)


def _summary(client, run_id, body, **headers):
    return client.put(
        f"{BASE}/runs/{run_id}/summary",
        headers={**runner_headers(), **headers},
        json=body,
    )


def _report(
    client, run_id, content=REPORT, content_type="text/html; charset=utf-8", **headers
):
    return client.put(
        f"{BASE}/runs/{run_id}/report",
        headers={**runner_headers(), "Content-Type": content_type, **headers},
        content=content,
    )


def _stored_report(factory, run_id):
    with factory() as db:
        row = db.get(PerformanceReport, run_id)
        if row is not None:
            db.expunge(row)
        return row


# --------------------------------------------------------------------------- summary


def test_the_summary_is_stored_as_sent_and_its_headline_is_copied(
    client, session_factory
):
    run_id = make_run(session_factory, status="running")
    body = summary_body(
        verdict_reason="Breaks at 20 VUs (latency).",
        overall={"http_failed_rate": 0.0066, "p95_ms": 190000},
        suite_summary={
            "test": "breakpoint",
            "maxSustainableVUs": 10,
            "anything": [1, 2, {"deep": True}],
        },
        a_field_of_a_newer_runner={"kept": True},
    )
    body["headline"]["a_newer_headline_value"] = 7
    response = _summary(client, run_id, body)
    assert response.status_code == 200, response.text
    assert response.json() == {"id": run_id, "verdict": "breakpoint_found"}

    run = get_run(session_factory, run_id)
    assert run.summary == body  # nothing renamed, nothing lost
    assert run.verdict == "breakpoint_found"
    assert {column: getattr(run, column) for column in HEADLINE_COLUMNS} == {
        "safe_load_users": 10,
        "breaking_level_users": 20,
        "breaking_reason": "latency",
        "recommended_max_users": 8,
        "p95_at_safe_load_ms": 61000.5,
        "answers_measured": 28,
        "answers_total": 36,
        "errors_total": 1,
        "error_rate_pct": 2.78,
        "p95_ms": 190000,
        "ttfb_p95_ms": 30100,
        "max_users": 20,
        "duration_s": 212.4,
        "quality_mean": 98.5,
    }
    assert run.exit_code == 99
    # The summary does not end the run: the final progress report does.
    assert (run.status, run.finished_at) == ("running", None)
    assert tuple(performance_ingest.HEADLINE_COLUMNS) == HEADLINE_COLUMNS


def test_a_repeated_summary_replaces_the_stored_one(client, session_factory):
    run_id = make_run(session_factory, status="stopping")
    assert _summary(client, run_id, summary_body()).status_code == 200
    replaced = summary_body(verdict="not_reached", ended_by="plan", exit_code=0)
    replaced["headline"] = {"safe_load_users": 20, "answers_measured": 40}
    response = _summary(client, run_id, replaced)
    assert response.json() == {"id": run_id, "verdict": "not_reached"}
    run = get_run(session_factory, run_id)
    assert (run.verdict, run.safe_load_users, run.answers_measured) == (
        "not_reached",
        20,
        40,
    )
    # A headline value that is absent means null, also after a fuller summary.
    assert (run.breaking_level_users, run.breaking_reason, run.p95_ms) == (
        None,
        None,
        None,
    )
    assert run.summary["ended_by"] == "plan"


@pytest.mark.parametrize("test_type", ["smoke", "soak"])
def test_smoke_and_soak_summaries(client, session_factory, test_type):
    run_id = make_run(session_factory, status="running", test_type=test_type)
    assert _summary(client, run_id, summary_body(test_type)).json()["verdict"] == "pass"
    assert (
        _summary(client, run_id, summary_body(test_type, verdict="fail")).json()[
            "verdict"
        ]
        == "fail"
    )
    run = get_run(session_factory, run_id)
    assert (run.verdict, run.safe_load_users, run.answers_measured) == (
        "fail",
        None,
        28,
    )
    wrong_word = _summary(
        client, run_id, summary_body(test_type, verdict="breakpoint_found")
    )
    assert wrong_word.status_code == 422
    wrong_test = _summary(client, run_id, summary_body("breakpoint"))
    assert wrong_test.status_code == 422
    assert wrong_test.json()["detail"][0]["loc"] == ["body", "test_type"]
    assert get_run(session_factory, run_id).verdict == "fail"


def test_a_summary_is_checked_before_it_is_stored(client, session_factory):
    run_id = make_run(session_factory, status="running")
    missing_headline = summary_body()
    del missing_headline["headline"]
    missing_reason = summary_body()
    del missing_reason["verdict_reason"]
    bad_headline = summary_body()
    bad_headline["headline"]["safe_load_users"] = "ten"
    half_users = summary_body()
    half_users["headline"]["max_users"] = 10.5
    bad_reason = summary_body()
    bad_reason["headline"]["breaking_reason"] = "slow"
    bad_threshold = summary_body(
        thresholds=[{"scope": "run", "metric": "m", "expression": "e"}]
    )
    bad_level = summary_body(levels=[{"answers": 3}])
    for body in (
        summary_body(schema=2),
        summary_body(test_type="stress"),
        summary_body(verdict="passed"),
        summary_body(ended_by="crash"),
        summary_body(started_at="yesterday"),
        missing_headline,
        missing_reason,
        bad_headline,
        half_users,
        bad_reason,
        bad_threshold,
        bad_level,
        ["not", "an", "object"],
    ):
        response = _summary(client, run_id, body)
        assert response.status_code == 422, (body, response.text)
        assert isinstance(response.json()["detail"], list)
    for raw in (
        json.dumps(summary_body()).replace("212.4", "NaN"),
        json.dumps(summary_body(suite_summary={"rate": 1})).replace(
            '{"rate": 1}', '{"rate": Infinity}'
        ),
        "{not json",
    ):
        response = client.put(
            f"{BASE}/runs/{run_id}/summary",
            headers={**runner_headers(), "Content-Type": "application/json"},
            content=raw.encode("utf-8"),
        )
        assert response.status_code == 422, raw[:60]
    run = get_run(session_factory, run_id)
    assert (run.summary, run.verdict, run.safe_load_users) == (None, None, None)


def test_a_level_entry_without_the_fields_the_pages_read_is_refused(
    client, session_factory
):
    """Guide 4.7: a short level entry was stored and read as a hold that never finished (wave 1, item 8)."""
    run_id = make_run(session_factory, status="running")
    full = summary_body()["levels"]
    short = [
        {key: entry[key] for key in ("level", "answers", "result", "hold_elapsed_pct")}
        for entry in full
    ]
    refused = [summary_body(levels=short)]
    for field in (
        "has_data",
        "passed",
        "latency_breach",
        "error_breach",
        "hold_elapsed_pct",
        "error_pct",
        "per_minute",
        "p95_ms",
        "result",
    ):
        levels = [dict(entry) for entry in full]
        del levels[0][field]
        refused.append(summary_body(levels=levels))
    refused.append(summary_body(levels=[{**full[0], "result": "passed"}, full[1]]))
    refused.append(summary_body(levels=[{**full[0], "has_data": "yes"}, full[1]]))
    refused.append(
        summary_body(
            levels=[{**full[0], "by_tier": {"simple": {"p95_ms": 1}}}, full[1]]
        )
    )
    for body in refused:
        response = _summary(client, run_id, body)
        assert response.status_code == 422, (body["levels"], response.text)
        assert isinstance(response.json()["detail"], list)
    assert get_run(session_factory, run_id).summary is None
    # A null number stays a value the suite had none for; by_tier may be left out to fit (413).
    no_numbers = {**full[1], "p50_ms": None, "p99_ms": None, "ttfb_p95_ms": None}
    del no_numbers["by_tier"]
    response = _summary(client, run_id, summary_body(levels=[full[0], no_numbers]))
    assert response.status_code == 200, response.text
    stored = get_run(session_factory, run_id).summary["levels"]
    assert [(entry["has_data"], entry["passed"]) for entry in stored] == [
        (True, True),
        (True, False),
    ]


@pytest.mark.parametrize(
    "field", ["answers", "hold_elapsed_pct", "error_pct", "per_minute"]
)
def test_a_level_with_data_must_send_its_numbers(client, session_factory, field):
    """Guide 4.7: answers, hold share, error share and per minute are numbers when has_data is true."""
    run_id = make_run(session_factory, status="running")
    full = summary_body()["levels"]
    assert full[0]["has_data"] is True
    response = _summary(
        client, run_id, summary_body(levels=[{**full[0], field: None}, full[1]])
    )
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list)
    assert field in json.dumps(detail)
    assert get_run(session_factory, run_id).summary is None


def test_a_level_without_data_may_send_its_numbers_as_null(client, session_factory):
    """Guide 4.7: a level the run never measured may send null for them (the runner's num() gives null)."""
    run_id = make_run(session_factory, status="running")
    full = summary_body()["levels"]
    empty = {
        **full[1],
        "has_data": False,
        "passed": False,
        "result": "no_data",
        "answers": None,
        "hold_elapsed_pct": None,
        "error_pct": None,
        "per_minute": None,
        "p50_ms": None,
        "p95_ms": None,
        "p99_ms": None,
        "ttfb_p95_ms": None,
    }
    # The key itself is still never left out.
    without_key = {key: value for key, value in empty.items() if key != "per_minute"}
    response = _summary(client, run_id, summary_body(levels=[full[0], without_key]))
    assert response.status_code == 422, response.text
    response = _summary(client, run_id, summary_body(levels=[full[0], empty]))
    assert response.status_code == 200, response.text
    stored = get_run(session_factory, run_id).summary["levels"][1]
    assert stored["has_data"] is False
    numbers = ("answers", "hold_elapsed_pct", "error_pct", "per_minute")
    assert [stored[key] for key in numbers] == [None, None, None, None]


def test_token_text_in_a_summary_is_masked_before_it_is_stored(client, session_factory):
    run_id = make_run(session_factory, status="running")
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYS11c2VyIn0.c2lnbmF0dXJl"
    body = summary_body(
        verdict_reason=f"refresh with {REFRESH} was refused",
        suite_summary={
            "config": {"env": [f"ACCESS_TOKEN={TOKENS['access_token']}"]},
            "live": f"Authorization: Bearer {jwt}",
            REFRESH: True,
        },
    )
    response = _summary(client, run_id, body)
    assert response.status_code == 200, response.text
    assert response.json()["verdict"] == "breakpoint_found"
    run = get_run(session_factory, run_id)
    assert run.summary["verdict_reason"] == "refresh with [REDACTED] was refused"
    assert run.summary["suite_summary"] == {
        "config": {"env": ["ACCESS_TOKEN=[REDACTED]"]},
        "live": "Authorization: [REDACTED]",
        "[REDACTED]": True,
    }
    # Numbers and fixed words are kept as they came.
    assert (run.verdict, run.safe_load_users) == ("breakpoint_found", 10)
    stored = json.dumps(run.summary)
    for secret in (REFRESH, TOKENS["access_token"], jwt):
        assert secret not in stored and secret not in response.text

    # A token is found however the JSON spells it.
    with session_factory() as db:
        target = db.scalars(select(PerformanceTarget)).one()
        target.tokens.clear()
        db.flush()
        seed_token(db, target, "refresh_token", "tok/en-é-41bd")
        db.commit()
    spelled = json.dumps(summary_body(verdict_reason="X")).replace(
        '"X"', '"sent tok\\/en-\\u00e9-41bd and tok%2Fen-%C3%A9-41bd"'
    )
    escaped = client.put(
        f"{BASE}/runs/{run_id}/summary",
        headers={**runner_headers(), "Content-Type": "application/json"},
        content=spelled.encode("utf-8"),
    )
    assert escaped.status_code == 200, escaped.text
    assert get_run(session_factory, run_id).summary["verdict_reason"] == (
        "sent [REDACTED] and [REDACTED]"
    )


def test_a_token_saved_during_the_run_is_masked_too(client, session_factory):
    run_id = make_run(session_factory, status="running")
    with session_factory() as db:
        supply_token(
            db,
            db.get(PerformanceRun, run_id),
            "refresh_token",
            "example-new-refresh-token-7a2e",
        )
        db.commit()
    response = _summary(
        client, run_id, summary_body(verdict_reason="example-new-refresh-token-7a2e")
    )
    assert response.status_code == 200, response.text
    assert get_run(session_factory, run_id).summary["verdict_reason"] == "[REDACTED]"


def test_summary_size_and_state_refusals(client, session_factory, monkeypatch):
    run_id = make_run(session_factory, status="running")
    too_large = _summary(
        client, run_id, summary_body(suite_summary={"blob": "x" * 262144})
    )
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "payload_too_large"
    stranger = client.put(
        f"{BASE}/runs/{run_id}/summary",
        headers=runner_headers(instance="instance-2"),
        json=summary_body(),
    )
    _refused(
        stranger,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    _refused(
        _summary(client, "no-such-run", summary_body()),
        404,
        "run_not_found",
        "performance run not found",
    )
    with session_factory() as db:
        run = db.get(PerformanceRun, run_id)
        run.status, run.finished_at = "stopped", NOW
        db.commit()
    at_time(monkeypatch, NOW + timedelta(seconds=601))
    closed = _summary(client, run_id, summary_body())
    _refused(closed, 409, "run_closed", "run no longer accepts results")
    assert get_run(session_factory, run_id).summary is None
    queued = make_run(session_factory)
    _refused(
        _summary(client, queued, summary_body()),
        409,
        "run_not_claimed",
        "run has not been claimed",
    )


# --------------------------------------------------------------------------- report


def test_the_report_file_is_stored_compressed_with_its_size_and_hash(
    client, session_factory, monkeypatch
):
    run_id = make_run(session_factory, status="running")
    response = _report(client, run_id)
    assert response.status_code == 204 and response.content == b""
    row = _stored_report(session_factory, run_id)
    assert zlib.decompress(row.html) == REPORT
    # Both sizes are the file's size as downloaded; the compressed size is internal.
    assert (row.html_size, row.byte_size) == (len(REPORT), len(REPORT))
    assert row.sha256 == hashlib.sha256(REPORT).hexdigest()
    assert (row.content_type, row.received_at) == ("text/html; charset=utf-8", NOW)
    assert get_run(session_factory, run_id).report_received_at == NOW
    with session_factory() as db:
        data, same_row = performance_ingest.read_report(db, run_id)
        assert data == REPORT and same_row.sha256 == row.sha256
        assert performance_ingest.read_report(db, "no-such-run") is None

    # A repeated upload replaces the file.
    later = at_time(monkeypatch, NOW + timedelta(seconds=30))
    bigger = REPORT + b"<p>" + b"raw log " * 500 + b"</p>"
    assert _report(client, run_id, bigger, content_type="text/html").status_code == 204
    row = _stored_report(session_factory, run_id)
    assert zlib.decompress(row.html) == bigger
    assert row.html_size == row.byte_size == len(bigger) > len(row.html)
    assert row.received_at == later
    with session_factory() as db:
        assert len(db.scalars(select(PerformanceReport)).all()) == 1


@pytest.mark.parametrize(
    "content_type",
    [
        "application/json",
        "text/plain",
        "multipart/form-data; boundary=x",
        "application/octet-stream",
    ],
)
def test_the_report_must_be_sent_as_html(client, session_factory, content_type):
    run_id = make_run(session_factory, status="running")
    response = _report(client, run_id, content_type=content_type)
    _refused(response, 415, "unsupported_content_type", "unsupported content type")
    assert _stored_report(session_factory, run_id) is None


def test_the_report_must_be_utf8_and_free_of_tokens(client, session_factory):
    run_id = make_run(session_factory, status="running")
    not_text = _report(client, run_id, b"<p>caf\xe9</p>")
    _refused(not_text, 422, "report_not_utf8", "report is not UTF-8")
    for holding in (
        f"<pre>ACCESS_TOKEN={TOKENS['access_token']}</pre>",
        f'<script>const raw = {json.dumps({"line": "cookie " + REFRESH})};</script>',
    ):
        response = _report(client, run_id, holding.encode("utf-8"))
        _refused(response, 422, "contains_token", "the body contains a sign-in token")
        assert (
            REFRESH not in response.text and TOKENS["access_token"] not in response.text
        )
    assert _stored_report(session_factory, run_id) is None
    assert get_run(session_factory, run_id).report_received_at is None

    # A token with markup characters is found in its escaped spelling as well.
    with session_factory() as db:
        target = db.scalars(select(PerformanceTarget)).one()
        target.tokens.clear()
        db.flush()
        seed_token(db, target, "refresh_token", MARKUP_TOKEN)
        db.commit()
    escaped = ("<pre>" + html.escape(MARKUP_TOKEN) + "</pre>").encode("utf-8")
    _refused(
        _report(client, run_id, escaped),
        422,
        "contains_token",
        "the body contains a sign-in token",
    )
    assert _report(client, run_id, b"<pre>clean</pre>").status_code == 204


def test_a_report_holding_a_token_in_any_predictable_spelling_is_refused(
    client, session_factory
):
    import base64
    from urllib.parse import quote

    token = "rt+Zm9v/YmFy+QUJD/REVGR0hJ==41bd"
    with session_factory() as db:
        target = db.scalars(select(PerformanceTarget)).one()
        target.tokens.clear()
        db.flush()
        seed_token(db, target, "refresh_token", token)
        db.commit()
    run_id = make_run(session_factory, status="running")
    for spelling in (
        quote(token, safe=""),
        quote(token, safe="").lower(),
        quote(token),
        token.replace("/", "\\/"),
        base64.b64encode(("Cookie: estishraf_rt=" + token).encode()).decode(),
        base64.b64encode(("Cookie: rt=" + token).encode()).decode(),
        # An access token the target handed out during the run; qym never saw it.
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.c2lnbmF0dXJl",
    ):
        response = _report(client, run_id, f"<pre>{spelling}</pre>".encode("utf-8"))
        _refused(response, 422, "contains_token", "the body contains a sign-in token")
    assert _stored_report(session_factory, run_id) is None


def test_the_report_has_a_size_limit(client, session_factory, monkeypatch):
    assert PlatformSettings().performance_report_max_bytes == 5 * 1024 * 1024
    monkeypatch.setattr(
        "qym_platform.api.performance_ingest.ingest_settings",
        lambda: PlatformSettings(performance_report_max_bytes=65536),
    )
    run_id = make_run(session_factory, status="running")
    assert _report(client, run_id, b"x" * 65536).status_code == 204
    too_large = _report(client, run_id, b"x" * 65537)
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "payload_too_large"
    assert "65536 byte limit" in too_large.json()["detail"]
    assert _stored_report(session_factory, run_id).html_size == 65536

    # The bytes that arrive are counted too, whatever Content-Length says.
    def chunks():
        for _ in range(9):
            yield b"x" * 8192

    streamed = client.put(
        f"{BASE}/runs/{run_id}/report",
        headers={**runner_headers(), "Content-Type": "text/html"},
        content=chunks(),
    )
    assert streamed.status_code == 413
    assert _stored_report(session_factory, run_id).html_size == 65536


def test_report_state_refusals(client, session_factory, monkeypatch):
    queued = make_run(session_factory)
    _refused(
        _report(client, queued), 409, "run_not_claimed", "run has not been claimed"
    )
    with session_factory() as db:
        db.get(PerformanceRun, queued).status = "stopped"
        db.commit()
    run_id = make_run(session_factory, status="finished")
    stranger = _report(client, run_id, **{"X-Qym-Runner-Instance": "instance-2"})
    _refused(
        stranger,
        409,
        "instance_mismatch",
        "another runner process holds this runner or run",
    )
    _refused(
        _report(client, "no-such-run"),
        404,
        "run_not_found",
        "performance run not found",
    )
    # A finished run still takes its report for ten minutes; a missing report never held the status back.
    at_time(monkeypatch, NOW + timedelta(seconds=600))
    assert _report(client, run_id).status_code == 204
    at_time(monkeypatch, NOW + timedelta(seconds=601))
    _refused(
        _report(client, run_id), 409, "run_closed", "run no longer accepts results"
    )
    assert _stored_report(session_factory, run_id).received_at == NOW + timedelta(
        seconds=600
    )
    assert get_run(session_factory, run_id).status == "finished"


def test_the_run_page_answers_the_size_of_the_file_as_downloaded(
    client, session_factory, monkeypatch
):
    from _performance_support import page_time

    page_time(monkeypatch, NOW)
    run_id = make_run(session_factory, status="running")
    body = REPORT + b"<pre>" + b"raw log line " * 2000 + b"</pre>"
    assert _report(client, run_id, body).status_code == 204
    member = {"X-User-Email": "performance-user-member-1@example.test"}
    pages = f"/api/projects/{PROJECT}/performance/runs/{run_id}"
    page = client.get(pages, headers=member)
    assert page.status_code == 200, page.text
    answer = page.json()
    report = (answer.get("run") or {}).get("report") or answer.get("report")
    downloaded = client.get(pages + "/report", headers=member)
    assert downloaded.status_code == 200 and downloaded.content == body
    assert report["byte_size"] == len(body) == len(downloaded.content)
    # Compression made the stored file much smaller; that size is never shown.
    assert len(_stored_report(session_factory, run_id).html) < len(body) // 10


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
def test_round2_report_refuses_equivalent_escapes(encoded):
    from qym_platform.services.performance_redaction import contains_token

    assert contains_token(
        '<script>let value="' + encoded + '"</script>', ["private_secret"]
    )
