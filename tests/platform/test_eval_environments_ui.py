"""Project environments: the P1 exit flow the Environments UI drives over the API.

Register two environments, load their generated forms, confirm their slots, and the
HIGH priority warning text the React page mirrors. The UI is covered by
frontend/e2e/experiments/environments.spec.ts and
frontend/e2e/experiments/cutover-environments.spec.ts."""

from __future__ import annotations

# Reuse the environments API fixtures (fake Evaluation Service, users, projects).
from test_eval_environments_api import (  # noqa: F401  (pytest fixtures)
    KEY,
    MANAGER,
    MEMBER,
    _headers,
    _url,
    client,
    service,
    session_factory,
)

# --------------------------------------------------------------------------- P1 flow


def _create(client, name: str, url: str) -> dict:
    res = client.post(
        _url(),
        headers=_headers(MANAGER),
        json={"name": name, "base_url": url, "api_key": KEY},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_p1_exit_register_two_envs_review_forms_confirm_slots(client):
    """What the Environments tab drives: two envs → forms → confirmed slots."""
    first = _create(client, "staging", "https://eval-a.example.com/prefix")
    second = _create(client, "prod-mirror", "https://eval-b.example.com/prefix")

    listed = client.get(_url(), headers=_headers(MEMBER)).json()["environments"]
    assert [e["name"] for e in listed] == ["prod-mirror", "staging"]
    for env in listed:
        # Columns the table renders.
        for key in (
            "base_url",
            "health_status",
            "schema_hash",
            "schema_fetched_at",
            "model_slots",
            "max_priority",
            "api_key_hint",
        ):
            assert key in env, key
        assert "max_inflight_jobs" not in env
        assert env["model_slots"]["needs_confirmation"] is True
        assert KEY not in str(env)

    for created in (first, second):
        env_id = created["environment"]["id"]
        # Step 2: the generated form (members may read it).
        form = client.get(_url(suffix=f"/{env_id}/form"), headers=_headers(MEMBER))
        assert form.status_code == 200
        descriptor = form.json()["descriptor"]
        assert descriptor["groups"] and any(
            f["kind"] == "field" for f in descriptor["fields"].values()
        )

        # Step 3: edit the proposal like the slot editor does and confirm it.
        slots = {s["slot_key"]: s for s in created["slots"]}
        primary = slots["endpoint:primary"]
        edited = [
            {
                "slot_key": "endpoint:primary",
                "kind": "endpoint",
                "label": "Main LLM",  # rename
                "field_map": {**primary["field_map"], "api_key": None},  # split
                "transport_fields": primary["transport_fields"],
            }
        ]
        preview = client.get(
            _url(suffix=f"/{env_id}/model-slots"),
            headers=_headers(MANAGER),
            params={"propose_endpoint": "fast"},
        ).json()
        edited.append({**preview["proposal"], "label": "Fast LLM"})  # add manually
        # flat:VIZ_LLM is left out: removed, its fields stay plain inputs.

        # Members cannot confirm.
        denied = client.put(
            _url(suffix=f"/{env_id}/model-slots"),
            headers=_headers(MEMBER),
            json={
                "slots": edited,
                "schema_id": created["environment"]["current_schema_id"],
            },
        )
        assert denied.status_code == 403

        res = client.put(
            _url(suffix=f"/{env_id}/model-slots"),
            headers=_headers(MANAGER),
            json={
                "slots": edited,
                "schema_id": created["environment"]["current_schema_id"],
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["needs_confirmation"] is False
        confirmed = {s["slot_key"]: s for s in body["slots"]}
        assert set(confirmed) == {"endpoint:primary", "endpoint:fast"}
        assert confirmed["endpoint:primary"]["label"] == "Main LLM"
        assert confirmed["endpoint:primary"]["field_map"]["api_key"] is None
        assert all(s["status"] == "confirmed" for s in body["slots"])

    listed = client.get(_url(), headers=_headers(MEMBER)).json()["environments"]
    assert all(not e["model_slots"]["needs_confirmation"] for e in listed)
    assert all(e["model_slots"]["counts"]["confirmed"] == 2 for e in listed)


def test_slot_editor_errors_come_back_per_slot(client):
    created = _create(client, "staging", "https://eval-a.example.com/prefix")
    env_id = created["environment"]["id"]
    res = client.put(
        _url(suffix=f"/{env_id}/model-slots"),
        headers=_headers(MANAGER),
        json={
            "slots": [
                {
                    "slot_key": "flat:VIZ_LLM",
                    "kind": "flat",
                    "field_map": {"model": "/VIZ_LLM_MODEL"},
                }
            ]
        },
    )
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    # The UI maps these onto cards by slot_key (primary is required).
    assert any(e["slot_key"] == "endpoint:primary" for e in errors)


def test_drawer_save_payload_round_trips(client):
    created = _create(client, "staging", "https://eval-a.example.com/prefix")
    env_id = created["environment"]["id"]
    body = {
        "name": "staging",
        "base_url": "https://eval-a.example.com/prefix",
        "ranking_metric": "exact_match",
        "ranking_k": 3,
        "max_priority": "HIGH",
        "default_priority": "NORMAL",
        "max_inflight_jobs": 7,  # removed: ignored when an old client still sends it
        "allow_connection_keys": True,
    }
    res = client.put(_url(suffix=f"/{env_id}"), headers=_headers(MANAGER), json=body)
    assert res.status_code == 200, res.text
    env = res.json()
    assert env["ranking_metric"] == "exact_match" and env["ranking_k"] == 3
    assert env["max_priority"] == "HIGH" and "max_inflight_jobs" not in env
    assert env["allow_connection_keys"] is True
    assert env["api_key_hint"] == "••••" + KEY[-4:]
    # Clearing the metric and k (blank inputs) sends nulls.
    res = client.put(
        _url(suffix=f"/{env_id}"),
        headers=_headers(MANAGER),
        json={**body, "ranking_metric": None, "ranking_k": None},
    )
    assert res.json()["ranking_metric"] is None and res.json()["ranking_k"] is None


def test_high_priority_warning_text_is_the_one_the_page_shows():
    """The environment page mirrors this exact text (format.ts highPriorityWarning)."""
    from qym_platform.services.eval_priority import (
        HIGH_PRIORITY_WARNING,
        high_priority_warning,
    )

    assert HIGH_PRIORITY_WARNING == (
        "Launching at HIGH cancels every running LOW/NORMAL job on {env} for all users."
    )
    assert high_priority_warning(["staging"]) == (
        "Launching at HIGH cancels every running LOW/NORMAL job on staging for all users."
    )
