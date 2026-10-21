"""Experiments refuse ``versioning_details`` (QA2-1 to QA2-6; migration 0084 history)."""

from __future__ import annotations

import pytest

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


REFUSED = (
    "Versioning details are set by the Evaluation Service and cannot be sent "
    "with an experiment."
)


def _counts(session_factory):
    from qym_platform.db.models import EvalExperimentJob

    with session_factory() as db:
        return (
            db.query(EvalExperiment).count(),
            db.query(EvalExperimentJob).count(),
        )


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.parametrize(
    "bad", [{"agent_version": "x"}, "x", ["a"], 3, True, {"": "x"}]
)
def test_non_empty_or_non_object_versioning_details_are_refused(
    client, session_factory, env, conn, bad, dry_run
):
    """QA2-1 to QA2-3: 422 and the fixed text, nothing persisted."""
    res = _launch(client, env.id, conn.id, versioning_details=bad, dry_run=dry_run)
    assert res.status_code == 422, res.text
    assert res.json()["detail"] == REFUSED
    assert _counts(session_factory) == (0, 0)


@pytest.mark.parametrize(
    "extra", [{}, {"versioning_details": None}, {"versioning_details": {}}]
)
def test_null_empty_and_absent_versioning_details_are_accepted(
    client, session_factory, env, conn, extra
):
    preview = _launch(client, env.id, conn.id, dry_run=True, **extra)
    assert preview.status_code == 200, preview.text
    config = preview.json()["jobs"][0]["request_body"]["evaluator"]["config"]
    assert "versioning_details" not in config

    res = _launch(client, env.id, conn.id, **extra)
    assert res.status_code == 200, res.text
    assert res.json()["versioning_details"] == {}
    with session_factory() as db:
        assert db.get(EvalExperiment, res.json()["id"]).versioning_details is None


def test_launch_sends_no_versioning_details_to_the_service(
    client, session_factory, env, conn
):
    """QA2-4: not even to an environment whose schema declares the key."""
    _give_evaluator_schema(session_factory, env.id)
    res = _launch(client, env.id, conn.id)
    assert res.status_code == 200, res.text
    (body,) = _job_bodies(session_factory, res.json()["id"])
    assert "versioning_details" not in body["evaluator"]["config"]


def _legacy_experiment(session_factory, experiment_id):
    """An experiment created before this change: it stored the user's keys."""
    legacy = {"agent_version": "manual-1.0", "owner": "qa"}
    with session_factory() as db:
        db.get(EvalExperiment, experiment_id).versioning_details = legacy
        db.commit()
    return legacy


def test_clone_prefill_has_no_versioning_details(client, session_factory, env, conn):
    """QA2-5: also for an experiment whose stored details are not empty."""
    res = _launch(client, env.id, conn.id)
    assert res.status_code == 200, res.text
    experiment_id = res.json()["id"]
    _legacy_experiment(session_factory, experiment_id)
    prefill = client.post(
        _url(suffix=f"/{experiment_id}/clone"), headers=_headers(MEMBER)
    )
    assert prefill.status_code == 200, prefill.text
    assert "versioning_details" not in prefill.json()


def test_legacy_experiment_stays_readable_and_retry_resends_the_stored_body(
    client, session_factory, env, conn
):
    """QA2-6 and D-QB11: history is kept; retry never re-derives versioning."""
    from qym_platform.db.models import EvalExperimentJob, EvalJobStatus

    res = _launch(client, env.id, conn.id)
    experiment_id = res.json()["id"]
    legacy = _legacy_experiment(session_factory, experiment_id)
    detail = client.get(_url(suffix=f"/{experiment_id}"), headers=_headers(MEMBER))
    assert detail.json()["versioning_details"] == legacy
    listed = client.get(_url(), headers=_headers(MEMBER)).json()
    rows = (
        listed
        if isinstance(listed, list)
        else next(v for v in listed.values() if isinstance(v, list))
    )
    assert [r["versioning_details"] for r in rows if r["id"] == experiment_id] == [
        legacy
    ]
    with session_factory() as db:
        job = db.query(EvalExperimentJob).filter_by(experiment_id=experiment_id).one()
        job.status = EvalJobStatus.FAILED
        job_id = job.id
        db.commit()
    retry = client.post(
        _url(suffix=f"/{experiment_id}/jobs/{job_id}/retry"), headers=_headers(MEMBER)
    )
    assert retry.status_code == 200, retry.text
    for body in _job_bodies(session_factory, experiment_id):
        assert "versioning_details" not in body["evaluator"]["config"]


# ------------------------------------------------------- guide v1.1 (B23)


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
