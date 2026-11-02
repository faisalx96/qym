"""The platform's proxy for the service's task list (change request v1.4; QD-93 to QD-97)."""

from __future__ import annotations

import json

import httpx
import pytest

from qym_platform.services.eval_evaluator_schema import evaluator_capabilities
from qym_platform.services.eval_service_client import (
    EvalServiceClient,
    EvalServiceError,
    TasksUnavailable,
)

from test_eval_environments_api import (  # noqa: F401  (fixtures)
    EVALUATOR_FIXTURE,
    KEY,
    MEMBER,
    OUTSIDER,
    P1,
    _created,
    _headers,
    _url,
    client,
    service,
    session_factory,
)

V14 = EVALUATOR_FIXTURE.with_name("eval_evaluator_schema-v14.json")


def _tasks_url(env_id: str) -> str:
    return _url(suffix=f"/{env_id}/tasks")


def _env(client, service, *, declares_task: bool = True) -> str:
    schema = json.loads(V14.read_text())
    if not declares_task:
        schema["properties"].pop("task")
    service.evaluator_schema = schema
    return _created(client)["environment"]["id"]


def _calls(service) -> int:
    return sum(1 for r in service.requests if r.url.path.endswith("/evals/tasks"))


def test_tasks_are_listed_and_trimmed(client, service):  # QD-93, QD-95
    env_id = _env(client, service)
    service.tasks = (
        [{"id": "answer-ticket", "name": "Answer a ticket", "description": "Reply", "default": True}]
        + [{"id": "no-name"}, {"id": "bad id!", "name": "x"}, {"id": "answer-ticket", "name": "dup"}, "junk"]
        + [{"id": f"t{i}", "name": "n" * 300, "description": "d" * 900} for i in range(250)]
    )
    res = client.get(_tasks_url(env_id), headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok" and body["error"] is None and body["environment_id"] == env_id
    assert len(body["tasks"]) == 200
    assert body["tasks"][0] == {"id": "answer-ticket", "name": "Answer a ticket", "description": "Reply", "default": True}
    assert body["tasks"][1] == {"id": "no-name", "name": "no-name", "description": None, "default": False}
    assert len(body["tasks"][2]["name"]) == 120 and len(body["tasks"][2]["description"]) == 500
    assert KEY not in res.text


@pytest.mark.parametrize("status", [404, 405, 422])
def test_unsupported_answers(client, service, status):  # QD-94
    env_id = _env(client, service)
    service.tasks_status = status
    body = client.get(_tasks_url(env_id), headers=_headers(MEMBER)).json()
    assert (body["status"], body["tasks"], body["error"]) == ("unsupported", [], None)


def test_a_v13_service_answers_the_uuid_422(client, service):  # QD-94
    env_id = _env(client, service)
    body = client.get(_tasks_url(env_id), headers=_headers(MEMBER)).json()
    assert body["status"] == "unsupported"


def test_503_is_an_error_with_the_reason(client, service):  # QD-94
    env_id = _env(client, service)
    service.tasks_status = 503
    body = client.get(_tasks_url(env_id), headers=_headers(MEMBER)).json()
    assert body["status"] == "error" and "could not list tasks: x" in body["error"]
    assert KEY not in json.dumps(body)


def test_unreachable_service_is_an_error(client, service):  # QD-94, QD-95
    env_id = _env(client, service)
    service.down = True
    body = client.get(_tasks_url(env_id), headers=_headers(MEMBER)).json()
    assert body["status"] == "error" and body["error"]
    assert KEY not in json.dumps(body)


def test_schema_without_task_makes_no_call(client, service):  # QD-94
    env_id = _env(client, service, declares_task=False)
    before = _calls(service)
    body = client.get(_tasks_url(env_id), headers=_headers(MEMBER)).json()
    assert body["status"] == "unsupported" and _calls(service) == before == 0


def test_non_members_are_refused(client, service):  # QD-93
    env_id = _env(client, service)
    assert client.get(_tasks_url(env_id), headers=_headers(OUTSIDER)).status_code in (403, 404)


def test_capabilities_follow_the_stored_schema(client, service):  # QD-96
    service.evaluator_schema = json.loads(V14.read_text())
    env = _created(client)["environment"]
    assert env["evaluator_capabilities"] == {"datasets": True, "task": True}
    listed = client.get(_url(), headers=_headers(MEMBER)).json()["environments"][0]
    assert listed["evaluator_capabilities"] == {"datasets": True, "task": True}
    # no evaluator schema: both false
    service.evaluator_schema = None
    other = client.post(
        _url(), headers=_headers("manager@example.com"),
        json={"name": "old", "base_url": "https://old.example.com/p", "api_key": KEY},
    ).json()["environment"]
    assert other["evaluator_capabilities"] == {"datasets": False, "task": False}
    # a refresh that declares them flips the flags without a restart
    service.evaluator_schema = json.loads(V14.read_text())
    res = client.post(_url(suffix=f"/{other['id']}/schema/refresh"), headers=_headers("manager@example.com"))
    assert res.status_code == 200, res.text
    got = client.get(_url(suffix=f"/{other['id']}"), headers=_headers(MEMBER)).json()
    assert (got.get("environment") or got)["evaluator_capabilities"] == {"datasets": True, "task": True}


def test_capabilities_helper():
    assert evaluator_capabilities(None) == {"datasets": False, "task": False}
    assert evaluator_capabilities({"properties": {"task": {}}}) == {"datasets": False, "task": True}
    assert evaluator_capabilities({"properties": {"datasets": {}}}) == {"datasets": True, "task": False}


# --------------------------------------------------------------------------- client


def _client(handler) -> EvalServiceClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return EvalServiceClient("https://eval.example.com", "k", allow_private=True, http_client=http)


@pytest.mark.asyncio
async def test_tasks_list_answers():  # QD-97
    ok = _client(lambda r: httpx.Response(200, json={"tasks": [{"id": "a", "name": "A"}, "junk"]}))
    assert await ok.tasks_list() == [{"id": "a", "name": "A"}]
    for status in (404, 405, 422):
        assert await _client(lambda r, s=status: httpx.Response(s, json={"detail": "x"})).tasks_list() is None
    with pytest.raises(TasksUnavailable) as raised:
        await _client(lambda r: httpx.Response(503, json={"detail": "could not list tasks: x"})).tasks_list()
    assert raised.value.detail == "could not list tasks: x"
    with pytest.raises(EvalServiceError):
        await _client(lambda r: httpx.Response(200, text="not json")).tasks_list()
    with pytest.raises(EvalServiceError):
        await _client(lambda r: httpx.Response(200, json={"tasks": "no"})).tasks_list()
