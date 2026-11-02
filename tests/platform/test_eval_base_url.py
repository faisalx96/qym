"""The platform's own address on a submit (integration guide v1.3 §4.3).

``env_overrides.QYM_BASE_URL`` is sent only to a job whose schema declares the key and
is always this platform's value, so an Evaluation Service shared by several qym
instances reports the run to the instance that submitted it. The key is platform-owned
like the dataset read token: a document that sets it is rejected.
"""

from __future__ import annotations

import json

import pytest
from qym_platform.db.models import EvalEnvironmentSchema, EvalExperiment
from qym_platform.services.eval_dispatcher import BASE_URL_ENV_KEY
from test_eval_dispatcher import (  # noqa: F401  (clock, service, sessions, _env: fixtures)
    _dispatcher,
    _env,
    _seed,
    clock,
    service,
    sessions,
)
from test_experiments_api import (  # noqa: F401  (client, env, session_factory: fixtures)
    FIXTURE,
    _add_env,
    _create,
    _spec,
    client,
    encryption,
    env,
    session_factory,
)

DECLARING = {"type": "object", "properties": {BASE_URL_ENV_KEY: {"type": "string"}}}


def _sent(service):
    (body,) = service.bodies
    return body.get("env_overrides") or {}


def test_dispatch_sends_this_platforms_url_when_the_schema_declares_it(
    sessions, service, clock
):
    _seed(sessions, schema_json=DECLARING)
    _dispatcher(sessions, service, clock, base_url="https://qym.example/").tick()
    assert _sent(service)[BASE_URL_ENV_KEY] == "https://qym.example"


def test_dispatch_omits_the_url_for_a_schema_that_does_not_declare_it(
    sessions, service, clock
):
    _seed(sessions, schema_json={})
    _dispatcher(sessions, service, clock, base_url="https://qym.example").tick()
    assert BASE_URL_ENV_KEY not in _sent(service)


def test_the_default_is_the_settings_base_url(sessions, service, clock, monkeypatch):
    monkeypatch.setenv("QYM_BASE_URL", "https://qym.settings.example/")
    _seed(sessions, schema_json=DECLARING)
    _dispatcher(sessions, service, clock).tick()
    assert _sent(service)[BASE_URL_ENV_KEY] == "https://qym.settings.example"


def test_an_empty_url_is_not_sent(sessions, service, clock):
    _seed(sessions, schema_json=DECLARING)
    _dispatcher(sessions, service, clock, base_url="").tick()
    assert BASE_URL_ENV_KEY not in _sent(service)


@pytest.mark.parametrize("value", ["https://other.example", None, 5])
def test_config_cannot_set_the_url_pointer(client, session_factory, value):
    env = _add_env(session_factory, "declares-url")
    with session_factory() as s:
        schema = s.get(EvalEnvironmentSchema, env.current_schema_id)
        declaring = json.loads(FIXTURE.read_text())
        declaring["properties"][BASE_URL_ENV_KEY] = {"type": "string"}
        schema.schema_json = declaring
        s.commit()
    spec = _spec()
    spec["env_overrides"][BASE_URL_ENV_KEY] = value
    dry = _create(client, [env.id], spec=spec, dry_run=True)
    assert dry.status_code == 200 and dry.json()["ok"] is False
    owned = dry.json()["errors"] + dry.json()["jobs"][0]["errors"]
    owned = [e for e in owned if e["rule"] == "platform_owned"]
    assert owned and owned[0]["section"] == "env_overrides"
    assert owned[0]["pointer"] == "/env_overrides/" + BASE_URL_ENV_KEY
    assert (
        owned[0]["message"] == f"{BASE_URL_ENV_KEY} is set by the platform; remove it"
    )
    assert _create(client, [env.id], spec=spec).status_code == 422
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0
