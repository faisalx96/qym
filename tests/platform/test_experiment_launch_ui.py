"""New-experiment launch form (plan §12.2, issue #23).

The ``model-options`` picker endpoint, the slot preview for an added endpoint, and an API round trip with exactly the body the form builds: one official
launch with a project model bound to ``endpoint:primary`` (the P2 exit criterion).
"""

from __future__ import annotations


import pytest
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalPriority,
)
from qym_platform.services.eval_bindings import prepare_dispatch
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    CONN_KEY,
    MANAGER,
    MEMBER,
    OUTSIDER,
    P1,
    PRIMARY,
    _headers,
    _jobs,
    _url,
    client,
    conn,
    encryption,
    env,
    session_factory,
)


def _options_url(env_id: str, project_id: str = P1) -> str:
    return f"/v1/projects/{project_id}/eval-environments/{env_id}/model-options"


def _form_body(env_id: str, conn_id: str, **extra) -> dict:
    """The request experiment_launch.js buildRequest() sends for a blank base."""
    return {
        "name": "primary on gpt-4o",
        "environment_ids": [env_id],
        "spec": {
            "evaluator": {"dataset": "playground_set_v2"},
            "slot_bindings": {PRIMARY: {"connection_id": conn_id}},
            "env_overrides": {"MILVUS_SEARCH_THRESHOLD": 0.7},
        },
        "base_source": {"kind": "blank"},
        "dry_run": False,
        "secrets": {},
        "save_to_project_models": [],
        **extra,
    }


# --------------------------------------------------------------------------- picker API


def test_model_options_lists_project_models_per_slot(client, env, conn):
    res = client.get(_options_url(env.id), headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["environment_id"] == env.id
    assert data["temporary_keys_allowed"] is True
    assert data["temporary_keys_reason"] is None
    (option,) = data["connections"]
    assert option["connection_id"] == conn.id
    assert option["name"] == "GPT-4o prod" and option["model"] == "gpt-4o"
    assert option["available"] is True
    assert option["slots"][PRIMARY]["available"] is True
    assert CONN_KEY not in res.text
    assert option["api_key_hint"] == "••••" + CONN_KEY[-4:]


def test_model_options_explains_when_keys_are_not_sent(
    client, session_factory, env, conn
):
    with session_factory() as s:
        s.get(EvalEnvironment, env.id).allow_connection_keys = False
        s.commit()
    data = client.get(_options_url(env.id), headers=_headers(MEMBER)).json()
    assert data["temporary_keys_allowed"] is False
    assert data["temporary_keys_reason"]
    (option,) = data["connections"]
    assert option["slots"][PRIMARY]["available"] is False
    assert option["slots"][PRIMARY]["reason"]


def test_model_options_access(client, env):
    assert client.get(_options_url(env.id), headers=_headers(OUTSIDER)).status_code in (
        403,
        404,
    )
    assert (
        client.get(_options_url("missing"), headers=_headers(MEMBER)).status_code == 404
    )


# --------------------------------------------------------------------------- round trip


def test_form_launch_binds_a_project_model_to_primary(
    client, session_factory, env, conn
):
    # The debounced preview: a dry run of the same body.
    preview = client.post(
        _url(), headers=_headers(MEMBER), json=_form_body(env.id, conn.id, dry_run=True)
    )
    assert preview.status_code == 200, preview.text
    dry = preview.json()
    assert dry["ok"] is True and dry["errors"] == []
    assert dry["job_count"] == 1
    assert dry["preemption_warning"] is None
    (job_preview,) = dry["jobs"]
    assert job_preview["run_name"]
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0

    # Launch.
    res = client.post(
        _url(), headers=_headers(MEMBER), json=_form_body(env.id, conn.id)
    )
    assert res.status_code == 200, res.text
    created = res.json()
    assert created["id"] and created["base_source"] == {"kind": "blank"}

    (job,) = _jobs(session_factory, created["id"])
    assert job.environment_id == env.id
    assert job.params["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    body = job.request_body
    snapshot = body["evaluator"]["config"]["run_metadata"]["qym_config"]
    assert snapshot["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    assert snapshot["base_source"] == {"kind": "blank"}
    # The slot fills the primary endpoint and names the run (§7.4); the stored body
    # holds placeholders that dispatch resolves from the connection (no key here).
    placeholder = "{{qym:slot:endpoint:primary:model}}"
    assert body["evaluator"]["model"] == placeholder
    primary = body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert primary["model"] == placeholder
    assert primary["api_key"] == "{{qym:slot:endpoint:primary:api_key}}"
    assert body["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert body["evaluator"]["dataset"] == "playground_set_v2"
    assert CONN_KEY not in str(body)

    # Dispatch resolves the binding to the project model (what the service receives).
    with session_factory() as s:
        environment = s.get(EvalEnvironment, env.id)
        schema = s.get(EvalEnvironmentSchema, job.schema_id)
        prep = prepare_dispatch(
            s,
            environment,
            body=job.request_body,
            slot_bindings=job.params["slot_bindings"],
            slots=list_model_slots(s, schema.id),
            descriptor=descriptor_for_schema(schema),
        )
    assert not prep.problems
    sent = prep.body
    assert sent["evaluator"]["model"] == "gpt-4o"
    sent_primary = sent["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert sent_primary["model"] == "gpt-4o"
    assert sent_primary["base_url"] == "https://llm.example.com/v1"
    assert sent_primary["api_key"] == CONN_KEY

    # onLaunched navigates to the detail, which loads.
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER))
    assert detail.status_code == 200 and detail.json()["id"] == created["id"]


def test_preview_errors_point_at_form_fields(client, env, conn):
    body = _form_body(env.id, conn.id, dry_run=True)
    body["spec"]["evaluator"]["dataset"] = None
    body["spec"]["env_overrides"] = {
        "MILVUS_SEARCH_THRESHOLD": "high",
        "LLM_OVERRIDES": {"endpoints": {"primary": {"model": "raw"}}},
    }
    data = client.post(_url(), headers=_headers(MEMBER), json=body).json()
    assert data["ok"] is False
    pointers = {e["pointer"] for e in data["errors"]}
    assert "/evaluator/dataset" in pointers
    assert "/env_overrides/MILVUS_SEARCH_THRESHOLD" in pointers
    # A raw value under a bound slot conflicts; the form locks those inputs.
    assert "/env_overrides/LLM_OVERRIDES/endpoints/primary/model" in pointers
    for error in data["errors"]:
        assert error["environment_id"] in (env.id, None)


@pytest.mark.parametrize("email,status", [(MEMBER, 403), (MANAGER, 422)])
def test_high_priority_needs_a_manager_and_an_acknowledgement(
    client, session_factory, env, conn, email, status
):
    with session_factory() as s:
        s.get(EvalEnvironment, env.id).max_priority = EvalPriority.HIGH
        s.commit()
    res = client.post(
        _url(),
        headers=_headers(email),
        json=_form_body(env.id, conn.id, priority="HIGH"),
    )
    assert res.status_code == status, res.text
    if email == MANAGER:
        assert res.json()["detail"]["code"] == "preemption_acknowledgement_required"
        dry = client.post(
            _url(),
            headers=_headers(email),
            json=_form_body(env.id, conn.id, priority="HIGH", dry_run=True),
        ).json()
        assert "HIGH" in dry["preemption_warning"]
        ok = client.post(
            _url(),
            headers=_headers(email),
            json=_form_body(
                env.id, conn.id, priority="HIGH", acknowledge_preemption=True
            ),
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["priority"] == "HIGH"


# --------------------------------------------------------------------------- extra LLM endpoints


def test_slot_preview_for_a_new_endpoint(client, env):
    url = f"/v1/projects/{P1}/eval-environments/{env.id}/model-slots"
    res = client.get(url, headers=_headers(MEMBER), params={"propose_endpoint": "fast"})
    assert res.status_code == 200, res.text
    proposal = res.json()["proposal"]
    assert proposal["slot_key"] == "endpoint:fast"
    assert proposal["field_map"]["model"] == "/LLM_OVERRIDES/endpoints/fast/model"


def test_form_launch_binds_a_project_model_to_an_added_endpoint(
    client, session_factory, env, conn
):
    # The body buildRequest() sends after "+ Add LLM endpoint" → fast → a project model.
    body = _form_body(env.id, conn.id)
    body["spec"]["slot_bindings"]["endpoint:fast"] = {"connection_id": conn.id}
    preview = client.post(
        _url(), headers=_headers(MEMBER), json=dict(body, dry_run=True)
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["errors"] == []

    res = client.post(_url(), headers=_headers(MEMBER), json=body)
    assert res.status_code == 200, res.text
    (job,) = _jobs(session_factory, res.json()["id"])
    with session_factory() as s:
        environment = s.get(EvalEnvironment, env.id)
        schema = s.get(EvalEnvironmentSchema, job.schema_id)
        prep = prepare_dispatch(
            s,
            environment,
            body=job.request_body,
            slot_bindings=job.params["slot_bindings"],
            slots=list_model_slots(s, schema.id),
            descriptor=descriptor_for_schema(schema),
        )
    assert not prep.problems
    fast = prep.body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["fast"]
    assert fast["model"] == "gpt-4o"
    assert fast["api_key"] == CONN_KEY
