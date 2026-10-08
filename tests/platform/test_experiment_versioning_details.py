"""Experiments carry ``versioning_details`` into their runs (migration 0084)."""

from __future__ import annotations

from qym_platform.db.models import EvalExperiment

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MEMBER,
    _headers,
    _spec,
    _url,
    client,
    conn,
    encryption,
    env,
    session_factory,
)


def _launch(client, env_id, conn_id, **extra):
    return client.post(
        _url(),
        headers=_headers(MEMBER),
        json={
            "name": "versioned",
            "environment_ids": [env_id],
            "spec": _spec(conn_id),
            "base_source": {"kind": "blank"},
            **extra,
        },
    )


def test_experiment_stores_returns_and_clones_versioning_details(
    client, session_factory, env, conn
):
    details = {"agent_version": "v2", "kb": 381}
    res = _launch(client, env.id, conn.id, versioning_details=details)
    assert res.status_code == 200, res.text
    experiment = res.json()
    assert experiment["versioning_details"] == details
    with session_factory() as db:
        assert db.get(EvalExperiment, experiment["id"]).versioning_details == details

    detail = client.get(_url(suffix=f"/{experiment['id']}"), headers=_headers(MEMBER))
    assert detail.json()["versioning_details"] == details

    prefill = client.post(
        _url(suffix=f"/{experiment['id']}/clone"), headers=_headers(MEMBER)
    )
    assert prefill.status_code == 200, prefill.text
    assert prefill.json()["versioning_details"] == details


def test_experiment_without_details_returns_empty(client, session_factory, env, conn):
    res = _launch(client, env.id, conn.id)
    assert res.status_code == 200, res.text
    assert res.json()["versioning_details"] == {}
    with session_factory() as db:
        assert db.get(EvalExperiment, res.json()["id"]).versioning_details is None


def test_invalid_experiment_details_are_refused(client, session_factory, env, conn):
    for bad in (["a"], {"": "x"}, {f"k{i}": i for i in range(51)}):
        res = _launch(client, env.id, conn.id, versioning_details=bad, dry_run=True)
        assert res.status_code == 422, res.text
        assert "versioning_details" in res.text
    with session_factory() as db:
        assert db.query(EvalExperiment).count() == 0


# ------------------------------------------------------- guide v1.1 (B22)


def _give_evaluator_schema(session_factory, env_id):
    """Mark ``env_id`` as a v1.1 service with the fixture evaluator schema."""
    import json
    from pathlib import Path

    from qym_platform.db.models import (
        EvalEnvironment,
        EvalEnvironmentEvaluatorSchema,
    )

    fixture = Path(__file__).parent / "fixtures" / "eval_evaluator_schema.json"
    with session_factory() as db:
        row = EvalEnvironmentEvaluatorSchema(
            environment_id=env_id,
            schema_hash="e" * 64,
            schema_json=json.loads(fixture.read_text()),
        )
        db.add(row)
        db.flush()
        env = db.get(EvalEnvironment, env_id)
        env.current_evaluator_schema_id = row.id
        env.evaluator_schema_status = "available"
        db.commit()


def _job_bodies(session_factory, experiment_id):
    from qym_platform.db.models import EvalExperimentJob

    with session_factory() as db:
        return [
            job.request_body
            for job in db.query(EvalExperimentJob).filter_by(
                experiment_id=experiment_id
            )
        ]


def test_details_are_sent_to_environments_whose_schema_accepts_them(
    client, session_factory, env, conn
):
    _give_evaluator_schema(session_factory, env.id)
    details = {"agent_version": "v2", "kb": 381}
    preview = _launch(client, env.id, conn.id, versioning_details=details, dry_run=True)
    assert preview.status_code == 200, preview.text
    sent = preview.json()["jobs"][0]["request_body"]["evaluator"]["config"]
    assert sent["versioning_details"] == details

    res = _launch(client, env.id, conn.id, versioning_details=details)
    assert res.status_code == 200, res.text
    (body,) = _job_bodies(session_factory, res.json()["id"])
    assert body["evaluator"]["config"]["versioning_details"] == details


def test_details_stay_platform_side_for_older_services(
    client, session_factory, env, conn
):
    res = _launch(client, env.id, conn.id, versioning_details={"agent_version": "v2"})
    assert res.status_code == 200, res.text
    (body,) = _job_bodies(session_factory, res.json()["id"])
    assert "versioning_details" not in body["evaluator"]["config"]


def test_evaluator_config_is_validated_per_environment_schema(
    client, session_factory, env, conn
):
    spec = _spec(conn.id)
    config = spec["evaluator"].setdefault("config", {})
    config["metric_concurrency"] = 4

    def launch(spec):
        return client.post(
            _url(),
            headers=_headers(MEMBER),
            json={
                "name": "mc",
                "environment_ids": [env.id],
                "spec": spec,
                "base_source": {"kind": "blank"},
                "dry_run": True,
            },
        ).json()

    # An older service: the static mirror has no metric_concurrency.
    errors = launch(spec)["errors"]
    assert [(e["pointer"], e["rule"]) for e in errors] == [
        ("/evaluator/config/metric_concurrency", "not_in_environment")
    ]
    assert "staging" in errors[0]["message"]

    _give_evaluator_schema(session_factory, env.id)
    assert launch(spec)["ok"] is True
    config["metric_concurrency"] = 0
    errors = launch(spec)["errors"]
    assert errors[0]["field"] == "/metric_concurrency"
    assert errors[0]["rule"] == "schema"
    # The platform fills versioning_details: a document may not set it.
    config["metric_concurrency"] = 2
    config["versioning_details"] = {"a": 1}
    errors = launch(spec)["errors"]
    assert [(e["pointer"], e["rule"]) for e in errors] == [
        ("/evaluator/config/versioning_details", "platform_owned")
    ]
