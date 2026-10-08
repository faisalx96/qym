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
