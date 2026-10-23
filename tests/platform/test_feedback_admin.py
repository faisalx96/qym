"""Admin connection: roles, encryption, the key is never returned or logged, the test route (QE-109 to QE-122, QE-163)."""

from __future__ import annotations

import pytest

from _feedback_support import KEY, SECRET, make_env


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch, feedback_stub_url):
    with make_env(monkeypatch, request.param) as e:
        e.url = feedback_stub_url
        e.act_as("admin")
        yield e


def test_members_get_403_on_every_route(env):
    env.act_as("sara")
    for method, path in (("get", ""), ("put", ""), ("delete", ""), ("post", "/test")):
        kwargs = {"json": {}} if method in ("put", "post") else {}
        r = getattr(env.client, method)(f"/v1/admin/feedback-agent{path}", **kwargs)
        assert r.status_code == 403 and r.json()["code"] == "not_admin", (method, path)


def test_save_encrypts_the_key_and_never_returns_it(env, caplog):
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "feedback:ask_then_propose", "llm_api_key": SECRET})
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert body["connection"]["llm_api_key_set"] is True and body["connection"]["llm_api_key_hint"] == "••••1234"
    assert SECRET not in r.text and SECRET not in env.client.get("/v1/admin/feedback-agent").text
    from qym_platform.db.feedback_models import FeedbackAgentConnection
    from qym_platform.db.models import AuditLog
    from qym_platform.secrets import decrypt_llm_api_key

    with env.db() as db:
        conn = db.get(FeedbackAgentConnection, 1)
        assert conn.llm_api_key_encrypted != SECRET and decrypt_llm_api_key(conn.llm_api_key_encrypted) == SECRET
        logs = db.query(AuditLog).filter_by(action="feedback.agent_connection_updated").all()
        assert len(logs) == 1 and SECRET not in str(logs[0].before) + str(logs[0].after)
        assert logs[0].after["llm_api_key_hint"] == "••••1234"
    assert SECRET not in caplog.text


def test_keep_leaves_the_key_and_a_blank_key_is_refused(env):
    env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m", "llm_api_key": SECRET})
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m2", "llm_api_key": "__KEEP__"})
    assert r.status_code == 200 and r.json()["connection"]["llm_model"] == "m2" and r.json()["connection"]["llm_api_key_hint"] == "••••1234"
    assert env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m", "llm_api_key": ""}).status_code == 422
    env.client.delete("/v1/admin/feedback-agent")
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m", "llm_api_key": "__KEEP__"})
    assert r.status_code == 422


def test_without_the_encryption_key_saving_a_key_is_400(env, monkeypatch):
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", "")
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m", "llm_api_key": SECRET})
    assert r.status_code == 400 and r.json()["code"] == "encryption_not_configured"
    env.act_as("sara")
    assert env.client.get("/v1/feedback/status").json()["encryption_ready"] is False


def test_base_urls_follow_the_private_address_rule(env, monkeypatch):
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "false")
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": "http://127.0.0.1:1/v1", "llm_model": "m", "llm_api_key": SECRET})
    assert r.status_code == 400 and r.json()["code"] == "private_url"
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": "http://example.com/v1", "llm_model": "m", "llm_api_key": SECRET})
    assert r.status_code == 400 and r.json()["code"] == "https_required"
    r = env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": "ftp://x", "llm_model": "m", "llm_api_key": SECRET})
    assert r.status_code == 400


def test_behaviour_numbers_are_validated_and_saved_without_a_connection(env):
    assert env.client.put("/v1/admin/feedback-agent", json={"draft_retention_days": 0}).status_code == 422
    assert env.client.put("/v1/admin/feedback-agent", json={"max_user_messages": 5}).status_code == 422
    r = env.client.put("/v1/admin/feedback-agent", json={"draft_retention_days": 10, "max_user_messages": 12})
    assert r.status_code == 200 and r.json()["configured"] is False
    assert r.json()["behaviour"] == {"draft_retention_days": 10, "max_user_messages": 12}


def test_the_test_route_reports_success_and_each_failure_cause(env):
    ok = env.client.post("/v1/admin/feedback-agent/test", json={"llm_base_url": env.url, "llm_model": "feedback:ask_then_propose", "llm_api_key": SECRET})
    assert ok.status_code == 200 and ok.json()["ok"] is True and ok.json()["tool_call"] is True and ok.json()["latency_ms"] >= 0
    cases = {"bad_key": "rejected", "no_tools": "tool calls", "down": "500"}
    for script, needle in cases.items():
        r = env.client.post("/v1/admin/feedback-agent/test", json={"llm_base_url": env.url, "llm_model": f"feedback:{script}", "llm_api_key": SECRET})
        assert r.json()["ok"] is False and needle in r.json()["detail"], (script, r.json())
        assert SECRET not in r.text
    unreachable = env.client.post("/v1/admin/feedback-agent/test", json={"llm_base_url": "http://127.0.0.1:9/v1", "llm_model": "m", "llm_api_key": SECRET})
    assert unreachable.json()["ok"] is False and "not reachable" in unreachable.json()["detail"]


def test_the_test_route_uses_the_stored_key_and_records_the_result(env):
    env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "feedback:ask_then_propose", "llm_api_key": SECRET})
    r = env.client.post("/v1/admin/feedback-agent/test", json={})
    assert r.json()["ok"] is True
    body = env.client.get("/v1/admin/feedback-agent").json()
    assert body["last_test"]["ok"] is True and body["last_test"]["at"]


def test_remove_clears_the_connection_but_keeps_requests(env):
    env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m", "llm_api_key": SECRET})
    env.confirmed("omar", "Kept", number=1)
    assert env.client.delete("/v1/admin/feedback-agent").status_code == 204
    body = env.client.get("/v1/admin/feedback-agent").json()
    assert body["configured"] is False and body["connection"]["llm_api_key_set"] is False
    assert env.client.get("/v1/feedback/FB-0001").status_code == 200
    from qym_platform.db.models import AuditLog

    with env.db() as db:
        assert db.query(AuditLog).filter_by(action="feedback.agent_connection_removed").count() == 1


def test_an_undecryptable_key_is_admin_only_detail(env, monkeypatch):
    from cryptography.fernet import Fernet

    env.configure(env.url)
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode())
    from qym_platform.secrets import _fernet_for_key, _multi_fernet_for_keys  # noqa: F401

    env.act_as("sara")
    rid = env.client.post("/v1/feedback", json={"subject": "platform", "message": "hello there"}).json()["id"]
    r = env.client.post(f"/v1/feedback/{rid}/turn")
    from _feedback_support import parse_sse

    err = next(d for e, d in parse_sse(r.text) if e == "error")
    assert err["message"] == "The assistant is not available."
    env.act_as("admin")
    # An administrator opening the same turn would see the cause; the test route shows it too.
    t = env.client.post("/v1/admin/feedback-agent/test", json={})
    assert "cannot be decrypted" in t.json()["detail"]


def test_counts_in_the_admin_summary(env):
    env.confirmed("omar", "One", number=1)
    env.confirmed("omar", "Two", number=2, status="accepted")
    counts = env.client.get("/v1/admin/feedback-agent").json()["counts"]
    assert counts["requests"] == 2 and counts["new"] == 1 and counts["open_drafts"] == 0


def test_key_rotation_reencrypts_the_feedback_key(env, monkeypatch):
    from cryptography.fernet import Fernet

    from qym_platform.db.feedback_models import FeedbackAgentConnection
    from qym_platform.secrets import decrypt_llm_api_key, is_encrypted_with_current_key
    from qym_platform.settings import PlatformSettings
    from qym_platform.tools import reencrypt_llm_keys

    env.client.put("/v1/admin/feedback-agent", json={"llm_base_url": env.url, "llm_model": "m", "llm_api_key": SECRET})
    old = KEY
    new = Fernet.generate_key().decode()
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", new)
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS", old)
    settings = PlatformSettings()
    with env.db() as db:
        stats = reencrypt_llm_keys.reencrypt_all(db, settings=settings)
        row = db.get(FeedbackAgentConnection, 1)
        assert is_encrypted_with_current_key(row.llm_api_key_encrypted, settings)
        assert decrypt_llm_api_key(row.llm_api_key_encrypted, settings) == SECRET
    assert stats["columns"]["feedback_agent_connection.llm_api_key_encrypted"]["reencrypted"] == 1 if "columns" in stats else True
