"""Scope enforcement for the keys minted for Evaluation Service experiments (migration 0098).

An experiment key can upload runs and read dataset items, nothing else; a key a user
creates is still unscoped. The key list tells the two kinds apart.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from _dataset_access_env import ADMIN, MGR, dataset_world, upload
from cryptography.fernet import Fernet
from qym_platform.auth import clear_api_key_cache
from qym_platform.db.models import ApiKey, EvalExperiment
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.dataset_read_tokens import HEADER, clear_cache, issue_token
from qym_platform.services.eval_submitter_keys import (
    SUBMITTER_KEY_SCOPES,
    issue_experiment_api_key,
)

DENIED = (
    "This Evaluation Service key may only upload runs and read dataset items "
    "(scope '{scope}' required)"
)
RUN_BODY = {"task": "t", "dataset": "qa", "metrics": []}
CSV = b"input,output,expected\nq,a,a\n"


@pytest.fixture()
def world(monkeypatch):
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    with dataset_world(monkeypatch) as env:
        yield env


def _experiment_key(factory, name="rag") -> str:
    """Mint a key the way a launch does; returns the raw token (read back by prefix)."""
    from qym_platform.secrets import decrypt_llm_api_key

    with factory() as db:
        experiment = EvalExperiment(
            project_id="pa",
            created_by_user_id="mem",
            name=name,
            environment_ids=[],
            job_count=0,
        )
        db.add(experiment)
        db.flush()
        issue_experiment_api_key(db, experiment)
        db.commit()
        return decrypt_llm_api_key(experiment.qym_api_key_encrypted)


def _user_key(factory, token="user-key-token") -> dict:
    with factory() as db:
        db.add(
            ApiKey(
                user_id="mem",
                project_id="pa",
                name="ci",
                prefix=api_key_prefix(token),
                key_hash=hash_api_key(token),
                scopes=["runs:write"],
            )
        )
        db.commit()
    return {"Authorization": f"Bearer {token}"}


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_dataset(client):
    response = upload(client, MGR, "qa", [("a", "question", "answer", "t")], publish="true")
    assert response.status_code == 200, response.text


def _restrict(client):
    response = client.put(
        "/v1/datasets/qa/access",
        params={"project_slug": "pa"},
        headers=MGR,
        json={"access_mode": "restricted", "grants": []},
    )
    assert response.status_code == 200, response.text


def _denied(response, scope):
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == DENIED.format(scope=scope)
    assert response.headers["X-Qym-Key-State"] == "scope_denied"


def test_scope_set_is_what_the_worker_needs():
    assert SUBMITTER_KEY_SCOPES == ("runs:write", "datasets:read")


def test_minted_key_is_an_experiment_key(world):
    _, factory, _ = world
    _experiment_key(factory)
    with factory() as db:
        row = db.query(ApiKey).one()
        experiment = db.query(EvalExperiment).one()
        assert row.kind == "experiment" and row.experiment_id == experiment.id
        assert list(row.scopes) == ["runs:write", "datasets:read"]


def test_experiment_key_uploads_runs_and_reads_dataset_items(world):
    client, factory, _ = world
    _seed_dataset(client)
    key = _bearer(_experiment_key(factory))

    created = client.post("/v1/runs", json=RUN_BODY, headers=key)
    assert created.status_code == 200, created.text
    run_id = created.json()["run_id"] if "run_id" in created.json() else created.json()["id"]
    assert client.post(f"/v1/runs/{run_id}/events", content=b"", headers=key).status_code == 200
    uploaded = client.post(
        "/v1/runs:upload",
        headers=key,
        files={"file": ("r.csv", CSV, "text/csv")},
        data={"task": "t", "dataset": "qa"},
    )
    assert uploaded.status_code == 200, uploaded.text

    assert client.get("/v1/datasets", headers=key).status_code == 200
    assert client.get("/v1/datasets/qa", headers=key).status_code == 200
    items = client.get("/v1/datasets/qa/versions/v1/items", headers=key)
    assert items.status_code == 200 and items.json()["total"] == 1
    assert client.get("/v1/datasets/qa/versions/v1/items/a", headers=key).status_code == 200
    assert client.get("/v1/datasets/qa/versions/v1:download", headers=key).status_code == 200


def test_experiment_key_reads_restricted_items_only_with_the_read_token(world):
    client, factory, _ = world
    _seed_dataset(client)
    _restrict(client)
    clear_cache()
    key = _bearer(_experiment_key(factory))
    with factory() as db:
        _, token = issue_token(db, project_id="pa", name="svc", created_by_user_id="admin")
    refused = client.get("/v1/datasets/qa/versions/v1/items", headers=key)
    assert refused.status_code == 403
    assert "scope" not in refused.json()["detail"]
    assert refused.headers.get("X-Qym-Key-State") != "scope_denied"
    ok = client.get("/v1/datasets/qa/versions/v1/items", headers={**key, HEADER: token})
    assert ok.status_code == 200 and ok.json()["total"] == 1


def test_experiment_key_cannot_do_anything_else(world):
    client, factory, _ = world
    _seed_dataset(client)
    key = _bearer(_experiment_key(factory))
    _denied(client.post("/v1/datasets", json={"name": "golden"}, headers=key), "datasets:write")
    _denied(client.patch("/v1/datasets/qa", json={"description": "x"}, headers=key), "datasets:write")
    _denied(client.delete("/v1/datasets/qa", headers=key), "datasets:delete")
    _denied(
        client.post("/v1/datasets/qa/versions/v1/items", json={"input": "q"}, headers=key),
        "datasets:write",
    )
    _denied(client.get("/v1/product-evals/does-not-exist", headers=key), "runs:read")


def test_user_key_keeps_full_access(world):
    client, factory, _ = world
    _seed_dataset(client)
    key = _user_key(factory)  # carries only runs:write, still unscoped
    assert client.get("/v1/datasets", headers=key).status_code == 200
    assert client.get("/v1/datasets/qa/versions/v1/items", headers=key).status_code == 200
    assert client.post("/v1/datasets", json={"name": "golden"}, headers=key).status_code != 403
    # A member may not delete datasets (dataset permissions), but the scope never decides.
    deleted = client.delete("/v1/datasets/qa", headers=key)
    assert deleted.headers.get("X-Qym-Key-State") != "scope_denied"
    assert client.get("/v1/product-evals/does-not-exist", headers=key).status_code != 403


def test_key_list_carries_kind_and_experiment(world):
    client, factory, _ = world
    _experiment_key(factory, name="rag")
    created = client.post(
        "/v1/projects/pa/api-keys",
        headers=MGR,
        json={"name": "mine", "scopes": ["runs:write"]},
    )
    assert created.status_code == 200
    # A client cannot ask for an experiment key.
    extra = client.post(
        "/v1/projects/pa/api-keys",
        headers=MGR,
        json={"name": "sneaky", "kind": "experiment", "experiment_id": "x"},
    )
    assert extra.status_code in (200, 422)
    listed = client.get("/v1/projects/pa/api-keys", headers=MGR).json()["api_keys"]
    by_name = {k["name"]: k for k in listed}
    exp = by_name["Evaluation Service · rag"]
    assert exp["kind"] == "experiment" and exp["experiment_name"] == "rag"
    assert exp["experiment_id"]
    assert by_name["mine"]["kind"] == "user"
    assert by_name["mine"]["experiment_id"] is None and by_name["mine"]["experiment_name"] is None
    if "sneaky" in by_name:
        assert by_name["sneaky"]["kind"] == "user"


# ------------------------------------------------------------------- migration


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/migrations/versions/0098_api_key_kind.py"
)


def test_migration_backfill_marks_only_keys_an_experiment_references():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from qym_platform.db import models
    from qym_platform.db.base import Base

    spec = importlib.util.spec_from_file_location("migration_0098", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (module.revision, module.down_revision) == ("0098", "0097")

    engine = sa.create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        # Take the schema back to 0097: no kind / experiment_id on api_keys.
        connection.execute(sa.text("DROP TABLE api_keys"))
        connection.execute(
            sa.text(
                "CREATE TABLE api_keys (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL "
                "REFERENCES users (id), project_id VARCHAR(36) NOT NULL REFERENCES projects (id), "
                "name VARCHAR(200) NOT NULL, prefix VARCHAR(16) NOT NULL, key_hash BLOB NOT NULL, "
                "scopes JSON, created_at DATETIME, revoked_at DATETIME)"
            )
        )
        for table, values in (
            (models.User, dict(id="u1", email="u@x.test", role=models.UserRole.ADMIN)),
            (models.Project, dict(id="p1", name="P", slug="p", created_by_user_id="u1")),
        ):
            connection.execute(sa.insert(table.__table__).values(**values))
        connection.execute(
            sa.insert(models.EvalExperiment.__table__).values(
                id="x1", project_id="p1", created_by_user_id="u1", name="x",
                environment_ids=[], job_count=0, qym_api_key_id="k-exp",
            )
        )
        for key_id, name in (
            ("k-exp", "Evaluation Service · x"),  # referenced and named: marked
            ("k-name", "Evaluation Service · orphan"),  # name only: not enough
            ("k-ref", "my ci key"),  # not named like one: not marked
            ("k-user", "ci"),
        ):
            connection.execute(
                sa.text(
                    "INSERT INTO api_keys (id, user_id, project_id, name, prefix, key_hash, scopes, created_at) "
                    "VALUES (:id, 'u1', 'p1', :name, :p, x'00', '[\"runs:write\"]', CURRENT_TIMESTAMP)"
                ),
                dict(id=key_id, name=name, p=key_id[:8]),
            )
        connection.execute(sa.text("UPDATE eval_experiments SET qym_api_key_id = 'k-exp'"))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
        rows = {
            r[0]: r[1:]
            for r in connection.execute(sa.text("SELECT id, kind, experiment_id, scopes FROM api_keys"))
        }
        assert rows["k-exp"][0] == "experiment" and rows["k-exp"][1] == "x1"
        assert "datasets:read" in rows["k-exp"][2]
        for other in ("k-name", "k-ref", "k-user"):
            assert rows[other][0] == "user" and rows[other][1] is None
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
        columns = {c["name"] for c in sa.inspect(connection).get_columns("api_keys")}
        assert "kind" not in columns and "experiment_id" not in columns


def test_postgres_real_chain_backfill_and_round_trip(postgres) -> None:
    from alembic import command
    from _helpers import insert_at_revision
    from qym_platform.db import models

    engine, config = postgres
    command.upgrade(config, "0097")
    with engine.begin() as connection:
        insert_at_revision(connection, models.User, id="u1", email="u@x.test", role=models.UserRole.ADMIN)
        insert_at_revision(connection, models.Project, id="p1", name="P", slug="p", created_by_user_id="u1")
        for key_id, name in (("k-exp", "Evaluation Service · x"), ("k-name", "Evaluation Service · y")):
            connection.execute(
                sa.text(
                    "INSERT INTO api_keys (id, user_id, project_id, name, prefix, key_hash, scopes, created_at) "
                    "VALUES (:id, 'u1', 'p1', :name, :p, '\\x00', CAST('[\"runs:write\"]' AS JSON), now())"
                ),
                dict(id=key_id, name=name, p=key_id),
            )
        insert_at_revision(
            connection, models.EvalExperiment, id="x1", project_id="p1", created_by_user_id="u1",
            name="x", environment_ids=[], job_count=0, qym_api_key_id="k-exp",
        )
    command.upgrade(config, "0098")
    with engine.begin() as connection:
        rows = {
            r[0]: r[1:]
            for r in connection.execute(sa.text("SELECT id, kind, experiment_id FROM api_keys"))
        }
        assert rows == {"k-exp": ("experiment", "x1"), "k-name": ("user", None)}
        scopes = connection.execute(sa.text("SELECT scopes FROM api_keys WHERE id = 'k-exp'")).scalar_one()
        assert "datasets:read" in scopes
    command.downgrade(config, "0097")
    with engine.begin() as connection:
        columns = {c["name"] for c in sa.inspect(connection).get_columns("api_keys")}
        assert "kind" not in columns and "experiment_id" not in columns
    command.upgrade(config, "0098")
