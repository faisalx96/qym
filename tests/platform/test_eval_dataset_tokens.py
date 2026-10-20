"""The experiment's dataset read token (``services/eval_dataset_tokens``, WP-B feature 4).

Mint at launch, inject at dispatch when the schema declares ``QYM_DATASET_READ_TOKEN``,
revoke with the API key once every job is terminal, keep alive or re-mint on retry, and
never store, return or log the raw token. Criteria ids refer to spec-b.md.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import pytest
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    DatasetReadToken,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
)
from qym_platform.secrets import decrypt_llm_api_key
from qym_platform.services.dataset_read_tokens import TOKEN_PREFIX, token_grants_project
from qym_platform.services.eval_dataset_tokens import (
    DATASET_TOKEN_UNAVAILABLE,
    TOKEN_ENV_KEY,
    DatasetTokenUnavailable,
    ensure_dataset_token_for_retry,
    issue_experiment_dataset_token,
    resolve_dataset_token,
    revoke_dataset_token_when_settled,
    token_name,
)
from qym_platform.services.eval_experiments import (
    TERMINAL_JOB_STATUSES,
    recompute_experiment_status,
)
from qym_platform.services.eval_schema_form import schema_declares_env_key
from qym_platform.services.eval_service_client import RequestRejected, redact_text
from qym_platform.services.eval_submitter_keys import KEY_REVOKE_GRACE
from test_eval_dispatcher import (  # noqa: F401  (clock, service, sessions, _env: fixtures)
    FakeService,
    _dispatcher,
    _env,
    _job,
    _seed,
    clock,
    service,
    sessions,
)
from test_experiments_api import (  # noqa: F401  (client, env, session_factory: fixtures)
    FIXTURE,
    MANAGER,
    MEMBER,
    P1,
    _add_env,
    _create,
    _created,
    _headers,
    _jobs,
    _set_job,
    _spec,
    _url,
    client,
    encryption,
    env,
    session_factory,
)
from test_private_test_sets import ADMIN as WORLD_ADMIN  # noqa: F401  (world: fixture)
from test_private_test_sets import SECRET_INPUT, _member_api_key, world

DECLARING = {"type": "object", "properties": {TOKEN_ENV_KEY: {"type": "string"}}}


def _declaring_schema() -> dict:
    schema = json.loads(FIXTURE.read_text())
    schema["properties"][TOKEN_ENV_KEY] = {"type": "string"}
    return schema


def _add_declaring_env(session_factory, name: str = "declares"):
    """An environment whose schema declares ``QYM_DATASET_READ_TOKEN``."""
    env = _add_env(session_factory, name)
    with session_factory() as s:
        schema = s.get(EvalEnvironmentSchema, env.current_schema_id)
        schema.schema_json = _declaring_schema()
        s.commit()
    return env


def _token_state(session_factory, experiment_id):
    """``(token row, decrypted token or None)`` for the experiment's current token."""
    with session_factory() as s:
        experiment = s.get(EvalExperiment, experiment_id)
        row = s.get(DatasetReadToken, experiment.dataset_read_token_id)
        s.expunge(row)
        blob = experiment.dataset_read_token_encrypted
        return row, decrypt_llm_api_key(blob) if blob else None


def _settle(
    session_factory, job_id, status, *, ago=KEY_REVOKE_GRACE + timedelta(minutes=1)
):
    with session_factory() as s:
        job = s.get(EvalExperimentJob, job_id)
        job.status = status
        job.finished_at = utc_now_naive() - ago
        recompute_experiment_status(s, job.experiment_id)
        s.commit()


# --------------------------------------------------------------------------- units


def test_token_name_is_prefixed_and_fits_the_column():
    assert token_name("rag") == "Evaluation Service · rag"
    long = token_name("x" * 500)
    assert len(long) == 200 and long.endswith("…")


def test_schema_declares_env_key_reads_top_level_and_combined_properties():
    assert schema_declares_env_key(DECLARING, TOKEN_ENV_KEY)
    assert not schema_declares_env_key({"properties": {}}, TOKEN_ENV_KEY)
    assert not schema_declares_env_key(None, TOKEN_ENV_KEY)
    assert schema_declares_env_key({"allOf": [DECLARING]}, TOKEN_ENV_KEY)


def test_redact_text_masks_dataset_read_tokens_in_free_text():
    text = redact_text("rejected because qym_dr_abcdefghijklmnop was refused")
    assert "qym_dr_abcdefghijkl" not in text


# --------------------------------------------------------------------------- B4-3 .. B4-5


def test_launch_mints_one_token_per_experiment_whatever_the_job_count(
    client, session_factory, env
):
    spec = _spec()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.6, 0.7]}
    created = _created(client, [env.id], spec=spec)
    assert len(created["jobs"]) == 3
    with session_factory() as s:
        rows = s.query(DatasetReadToken).all()
        assert len(rows) == 1
        row = rows[0]
        experiment = s.get(EvalExperiment, created["id"])
        assert experiment.dataset_read_token_id == row.id
        assert row.kind == "experiment" and row.experiment_id == created["id"]
        assert row.project_id == P1 and row.created_by_user_id == "member-1"
        assert row.name == "Evaluation Service · rag-vs-model"
        assert row.prefix.startswith(TOKEN_PREFIX) and row.revoked_at is None
    _, token = _token_state(session_factory, created["id"])
    assert (
        token
        and token.startswith(TOKEN_PREFIX)
        and row.prefix == token[: len(row.prefix)]
    )


def test_dry_run_mints_nothing(client, session_factory, env):
    res = _create(client, [env.id], dry_run=True)
    assert res.status_code == 200 and res.json()["ok"] is True
    with session_factory() as s:
        assert s.query(DatasetReadToken).count() == 0
        assert s.query(EvalExperiment).count() == 0


def test_the_token_is_in_no_response_and_no_stored_column(client, session_factory, env):
    created = _created(client, [env.id])
    _, token = _token_state(session_factory, created["id"])
    with session_factory() as s:
        blob = s.get(EvalExperiment, created["id"]).dataset_read_token_encrypted
    texts = [json.dumps(created)]
    for path in (_url(), _url(suffix=f"/{created['id']}")):
        texts.append(client.get(path, headers=_headers(MEMBER)).text)
    texts.append(
        client.get(f"/v1/projects/{P1}/eval-queue", headers=_headers(MEMBER)).text
    )
    texts.append(_create(client, [env.id], dry_run=True).text)
    for text in texts:
        assert token not in text and blob not in text and "qym_dr_" not in text
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        stored = [json.dumps(experiment.spec, default=str)]
        for job in s.query(EvalExperimentJob).all():
            stored += [
                json.dumps(
                    [
                        job.request_body,
                        job.remote_result,
                        job.remote_versioning,
                        job.error,
                        job.wait_reason,
                        job.params,
                    ],
                    default=str,
                )
            ]
    assert all(token not in text for text in stored)


# --------------------------------------------------------------------------- B4-7


@pytest.mark.parametrize("value", ["qym_dr_user-chosen-value-1234", None, 5])
def test_config_cannot_set_the_token_pointer(client, session_factory, value):
    env = _add_declaring_env(session_factory)
    spec = _spec()
    spec["env_overrides"][TOKEN_ENV_KEY] = value
    dry = _create(client, [env.id], spec=spec, dry_run=True)
    assert dry.status_code == 200 and dry.json()["ok"] is False
    assert "qym_dr_user-chosen-value-1234" not in dry.text
    owned = [e for e in dry.json()["errors"] + dry.json()["jobs"][0]["errors"]]
    owned = [e for e in owned if e["rule"] == "platform_owned"]
    assert owned and owned[0]["section"] == "env_overrides"
    assert owned[0]["pointer"] == "/env_overrides/" + TOKEN_ENV_KEY
    assert owned[0]["message"] == f"{TOKEN_ENV_KEY} is set by the platform; remove it"
    launch = _create(client, [env.id], spec=spec)
    assert launch.status_code == 422
    assert "qym_dr_user-chosen-value-1234" not in launch.text
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0


def test_config_cannot_set_the_token_pointer_when_the_schema_does_not_declare_it(
    client, session_factory, env
):
    spec = _spec()
    spec["env_overrides"][TOKEN_ENV_KEY] = "x"
    res = _create(client, [env.id], spec=spec, dry_run=True)
    errors = [e for job in res.json()["jobs"] for e in job["errors"]]
    pointed = [e for e in errors if e["pointer"] == "/env_overrides/" + TOKEN_ENV_KEY]
    assert [e["rule"] for e in pointed] == ["platform_owned"]


# --------------------------------------------------------------------------- B4-20


def test_dry_run_warns_when_a_private_dataset_meets_an_undeclaring_schema(
    client, session_factory, env
):
    from qym_platform.db.models import Dataset

    with session_factory() as s:
        s.add(
            Dataset(
                id="ds-1",
                project_id=P1,
                name="golden",
                slug="golden",
                private_test_set=True,
                created_by_user_id="admin-1",
            )
        )
        s.commit()
    spec = _spec()
    spec["evaluator"]["dataset"] = "golden"
    body = _create(client, [env.id], spec=spec, dry_run=True).json()
    assert body["ok"] is True
    assert body["warnings"] == [
        {
            "code": "dataset_token_not_declared",
            "environment_ids": [env.id],
            "message": (
                "The schema of staging does not declare QYM_DATASET_READ_TOKEN, so "
                "“golden” (private) is read with the worker’s own token."
            ),
        }
    ]
    # A dataset that is neither restricted nor private: no warning. Same for a
    # declaring environment.
    plain = _create(client, [env.id], dry_run=True).json()
    assert plain["warnings"] == []
    declaring = _add_declaring_env(session_factory)
    again = _create(client, [declaring.id], spec=spec, dry_run=True).json()
    assert again["warnings"] == []


# --------------------------------------------------------------------------- B4-19


def test_no_launch_gate_for_private_datasets(client, session_factory, env):
    from qym_platform.db.models import Dataset

    with session_factory() as s:
        s.add(
            Dataset(
                id="ds-1",
                project_id=P1,
                name="golden",
                slug="golden",
                private_test_set=True,
                created_by_user_id="admin-1",
            )
        )
        s.commit()
    spec = _spec()
    spec["evaluator"]["dataset"] = "golden"
    res = _create(client, [env.id], spec=spec)
    assert res.status_code == 200, res.text
    with session_factory() as s:
        assert s.query(DatasetReadToken).count() == 1


def test_launch_datasets_lists_every_dataset_of_the_project(client, session_factory):
    from datetime import datetime

    from qym_platform.db.models import Dataset

    with session_factory() as s:
        s.add_all(
            [
                Dataset(
                    id="a",
                    project_id=P1,
                    name="alpha",
                    slug="alpha",
                    created_by_user_id="admin-1",
                ),
                Dataset(
                    id="b",
                    project_id=P1,
                    name="beta",
                    slug="beta",
                    private_test_set=True,
                    created_by_user_id="admin-1",
                ),
                Dataset(
                    id="c",
                    project_id=P1,
                    name="gone",
                    slug="gone",
                    created_by_user_id="admin-1",
                    deleted_at=datetime.utcnow(),
                ),
                Dataset(
                    id="d",
                    project_id="project-2",
                    name="other",
                    slug="other",
                    created_by_user_id="admin-1",
                ),
            ]
        )
        s.commit()
    res = client.get(_url(suffix="/launch-datasets"), headers=_headers(MEMBER))
    assert res.status_code == 200
    rows = res.json()["datasets"]
    assert [(d["name"], d["private_test_set"], d["access_mode"]) for d in rows] == [
        ("alpha", False, "project"),
        ("beta", True, "project"),
    ]
    assert set(rows[0]) == {"id", "name", "slug", "private_test_set", "access_mode"}
    outsider = client.get(
        _url(suffix="/launch-datasets"), headers=_headers("outsider@example.com")
    )
    assert outsider.status_code in (403, 404)


# --------------------------------------------------------------------------- B4-9 settle


def test_token_is_revoked_with_the_api_key_after_the_grace(
    client, session_factory, env
):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    _, token = _token_state(session_factory, created["id"])

    _settle(session_factory, job.id, EvalJobStatus.BLOCKED)  # not terminal here
    row, still = _token_state(session_factory, created["id"])
    assert row.revoked_at is None and still == token

    _settle(
        session_factory,
        job.id,
        EvalJobStatus.SUCCEEDED,
        ago=timedelta(minutes=9, seconds=59),
    )
    row, still = _token_state(session_factory, created["id"])
    assert row.revoked_at is None and still == token

    _settle(session_factory, job.id, EvalJobStatus.SUCCEEDED)
    row, cleared = _token_state(session_factory, created["id"])
    assert row.revoked_at is not None and cleared is None
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        assert s.get(ApiKey, experiment.qym_api_key_id).revoked_at is not None
        actions = [a.action for a in s.query(AuditLog).order_by(AuditLog.id)]
    assert (
        "eval.dataset_token_issued" in actions
        and "eval.dataset_token_revoked" in actions
    )
    with session_factory() as s:
        audit = " ".join(json.dumps(a.after) for a in s.query(AuditLog))
    assert token not in audit


def test_settle_sweep_selects_experiments_holding_only_a_token(
    sessions, service, clock
):
    seed = _seed(sessions)
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        experiment.qym_api_key_encrypted = None  # as after a manual clear
        issue_experiment_dataset_token(db, experiment)
        for job in db.query(EvalExperimentJob):
            job.status = EvalJobStatus.SUCCEEDED
            job.finished_at = clock() - KEY_REVOKE_GRACE - timedelta(minutes=1)
        db.commit()
    _dispatcher(sessions, service, clock).settle_sweep()
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        assert experiment.dataset_read_token_encrypted is None
        assert db.get(DatasetReadToken, experiment.dataset_read_token_id).revoked_at


# --------------------------------------------------------------------------- B4-10, B4-11


def test_token_scope_and_revocation_against_item_reads(world):
    client, SessionLocal = world
    from qym_platform.db.models import EvalExperiment as Exp

    key = _member_api_key(SessionLocal)
    with SessionLocal() as db:
        experiment = Exp(
            project_id="project-1",
            created_by_user_id="member-1",
            name="exp",
            job_count=0,
        )
        db.add(experiment)
        db.flush()
        issue_experiment_dataset_token(db, experiment)
        db.commit()
        token = decrypt_llm_api_key(experiment.dataset_read_token_encrypted)
        experiment_id = experiment.id
    items = "/v1/datasets/secret/versions/v1/items"
    bearer = {"Authorization": f"Bearer {key}"}
    with_token = {**bearer, "X-Qym-Dataset-Read-Token": token}

    assert client.get(items, headers=bearer).status_code == 403
    assert client.get(items, headers=with_token).status_code == 200
    assert SECRET_INPUT in client.get(items, headers=with_token).text
    # Reads only.
    edit = client.patch(items + "/item-1", json={"input": "x"}, headers=with_token)
    assert edit.status_code == 403

    # The experiment token shows in the admin list with its kind and experiment.
    listed = client.get(
        "/v1/projects/project-1/dataset-read-tokens", headers=WORLD_ADMIN
    ).json()["tokens"]
    (row,) = listed
    assert row["kind"] == "experiment"
    assert row["experiment"] == {"id": experiment_id, "name": "exp"}
    assert token not in json.dumps(listed)

    # An admin revokes it by hand (twice: idempotent); item reads answer as unknown.
    path = f"/v1/projects/project-1/dataset-read-tokens/{row['id']}"
    assert client.delete(path, headers=WORLD_ADMIN).status_code == 200
    assert client.delete(path, headers=WORLD_ADMIN).status_code == 200
    denied = client.get(items, headers=with_token)
    unknown = client.get(
        items, headers={**bearer, "X-Qym-Dataset-Read-Token": "qym_dr_nope"}
    )
    assert denied.status_code == unknown.status_code == 403
    assert denied.json() == unknown.json()
    with SessionLocal() as db:
        manual = [
            a for a in db.query(AuditLog) if a.action == "eval.dataset_token_revoked"
        ]
        assert manual and manual[0].after["reason"] == "manual"


def test_a_token_reads_no_dataset_of_another_project(world):
    client, SessionLocal = world
    from qym_platform.db.models import EvalExperiment as Exp
    from qym_platform.db.models import Project, ProjectMembership, ProjectRole

    with SessionLocal() as db:
        db.add(
            Project(id="project-2", name="Q", slug="q", created_by_user_id="admin-1")
        )
        db.add(
            ProjectMembership(
                project_id="project-2", user_id="admin-1", role=ProjectRole.MANAGER
            )
        )
        experiment = Exp(
            project_id="project-2", created_by_user_id="admin-1", name="o", job_count=0
        )
        db.add(experiment)
        db.flush()
        issue_experiment_dataset_token(db, experiment)
        db.commit()
        token = decrypt_llm_api_key(experiment.dataset_read_token_encrypted)
        assert token_grants_project(db, token, "project-2")
        assert not token_grants_project(db, token, "project-1")
    key = _member_api_key(SessionLocal)
    res = client.get(
        "/v1/datasets/secret/versions/v1/items",
        headers={"Authorization": f"Bearer {key}", "X-Qym-Dataset-Read-Token": token},
    )
    assert res.status_code == 403 and SECRET_INPUT not in res.text


def test_the_token_list_is_capped_at_the_newest_200(world):
    client, SessionLocal = world
    from datetime import datetime

    with SessionLocal() as db:
        for i in range(205):
            db.add(
                DatasetReadToken(
                    project_id="project-1",
                    name=f"t{i}",
                    prefix="qym_dr_x",
                    token_hash=b"x",
                    created_by_user_id="admin-1",
                    created_at=datetime(2026, 1, 1) + timedelta(minutes=i),
                )
            )
        db.commit()
    tokens = client.get(
        "/v1/projects/project-1/dataset-read-tokens", headers=WORLD_ADMIN
    ).json()["tokens"]
    assert len(tokens) == 200 and tokens[0]["name"] == "t204"
    assert all(t["kind"] == "admin" and t["experiment"] is None for t in tokens)


# --------------------------------------------------------------------------- B4-12 retry


def test_retry_keeps_a_live_token_and_remints_after_settle(
    client, session_factory, env
):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    before, token = _token_state(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.BLOCKED)
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MANAGER)
    )
    assert res.status_code == 200, res.text
    after, same = _token_state(session_factory, created["id"])
    assert after.id == before.id and after.revoked_at is None and same == token

    (retried,) = [j for j in _jobs(session_factory, created["id"]) if j.attempt == 1]
    _settle(session_factory, retried.id, EvalJobStatus.FAILED)
    revoked, cleared = _token_state(session_factory, created["id"])
    assert revoked.revoked_at is not None and cleared is None

    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{retried.id}/retry"),
        headers=_headers(MEMBER),
    )
    assert res.status_code == 200, res.text
    new, new_token = _token_state(session_factory, created["id"])
    assert new.id != before.id and new.revoked_at is None and new_token != token
    with session_factory() as s:
        assert s.get(DatasetReadToken, before.id).revoked_at is not None
        assert new.experiment_id == created["id"] and new.kind == "experiment"
    # The old token no longer reads.
    with session_factory() as s:
        assert not token_grants_project(s, token, P1)
        assert token_grants_project(s, new_token, P1)


def test_retry_of_an_experiment_launched_before_the_feature_mints_a_token(
    client, session_factory, env
):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        s.delete(s.get(DatasetReadToken, experiment.dataset_read_token_id))
        experiment.dataset_read_token_id = None
        experiment.dataset_read_token_encrypted = None
        s.commit()
    _set_job(session_factory, job.id, status=EvalJobStatus.FAILED)
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MEMBER)
    )
    assert res.status_code == 200, res.text
    row, token = _token_state(session_factory, created["id"])
    assert row.revoked_at is None and token


def test_a_guarded_retry_that_lost_a_race_keeps_the_winners_token(
    session_factory, env, client
):
    created = _created(client, [env.id])
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        # Another retry replaced the blob after this one read it.
        stale = experiment.dataset_read_token_encrypted
        s.query(EvalExperiment).filter_by(id=experiment.id).update(
            {"dataset_read_token_encrypted": None}
        )
        s.commit()
        s.refresh(experiment)
        experiment.dataset_read_token_encrypted = stale  # in-memory only
        ensure_dataset_token_for_retry(s, experiment)
        s.commit()
        assert s.query(DatasetReadToken).count() >= 1
        refreshed = s.get(EvalExperiment, created["id"])
        assert refreshed.dataset_read_token_encrypted is not None


# --------------------------------------------------------------------------- B4-16, B4-17


def test_detail_carries_credential_states_and_per_job_token_flags(
    client, session_factory, env
):
    declaring = _add_declaring_env(session_factory)
    created = _created(client, [env.id, declaring.id])
    detail = client.get(
        _url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)
    ).json()
    assert detail["credentials"] == {
        "api_key": {"state": "active", "revoked_at": None},
        "dataset_read_token": {"state": "active", "revoked_at": None},
    }
    flags = {j["environment_id"]: j["dataset_token"] for j in detail["jobs"]}
    assert flags == {env.id: "not_declared", declaring.id: "sent"}
    assert set(detail["credentials"]["dataset_read_token"]) == {"state", "revoked_at"}

    for job in _jobs(session_factory, created["id"]):
        _settle(session_factory, job.id, EvalJobStatus.SUCCEEDED)
    after = client.get(
        _url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)
    ).json()
    assert after["credentials"]["dataset_read_token"]["state"] == "revoked"
    assert after["credentials"]["dataset_read_token"]["revoked_at"].endswith("Z")
    assert after["credentials"]["api_key"]["state"] == "revoked"

    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        experiment.dataset_read_token_id = None
        experiment.qym_api_key_id = None
        s.commit()
    old = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    assert old["credentials"]["dataset_read_token"] == {
        "state": "none",
        "revoked_at": None,
    }
    assert old["credentials"]["api_key"] == {"state": "none", "revoked_at": None}
    assert {j["dataset_token"] for j in old["jobs"]} == {None}


# --------------------------------------------------------------------------- dispatch


def _seed_with_token(sessions, *, declares: bool):
    seed = _seed(sessions, schema_json=_declaring_schema() if declares else {})
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        issue_experiment_dataset_token(db, experiment)
        db.commit()
    return seed


def test_dispatch_injects_the_token_only_when_the_schema_declares_it(
    sessions, service, clock
):
    seed = _seed_with_token(sessions, declares=True)
    _dispatcher(sessions, service, clock).tick()
    (sent,) = service.bodies
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        token = resolve_dataset_token(db, experiment)
    assert sent["env_overrides"][TOKEN_ENV_KEY] == token
    assert token.startswith(TOKEN_PREFIX)
    assert "latency_sensitive" not in sent


def test_dispatch_omits_the_token_for_a_schema_that_does_not_declare_it(
    sessions, service, clock
):
    _seed_with_token(sessions, declares=False)
    _dispatcher(sessions, service, clock).tick()
    (sent,) = service.bodies
    assert TOKEN_ENV_KEY not in (sent.get("env_overrides") or {})


@pytest.mark.parametrize("declares", [True, False])
@pytest.mark.parametrize("breakage", ["revoked", "unreadable", "missing"])
def test_unusable_token_blocks_only_when_the_schema_declares_it(
    sessions, service, clock, breakage, declares
):
    seed = _seed_with_token(sessions, declares=declares)
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        if breakage == "revoked":
            db.get(DatasetReadToken, experiment.dataset_read_token_id).revoked_at = (
                utc_now_naive()
            )
        elif breakage == "unreadable":
            experiment.dataset_read_token_encrypted = "not-a-fernet-token"
        else:
            experiment.dataset_read_token_encrypted = None
        db.commit()
    _dispatcher(sessions, service, clock).tick()
    job = _job(sessions, seed["job_ids"][0])
    if declares:
        assert job.status == EvalJobStatus.BLOCKED
        assert job.wait_reason == job.error == DATASET_TOKEN_UNAVAILABLE
        assert job.next_attempt_at is None
        assert service.calls["submit"] == 0
    else:
        assert job.status == EvalJobStatus.SUBMITTED
        assert service.calls["submit"] == 1


def test_an_experiment_without_a_token_is_never_checked(sessions, service, clock):
    seed = _seed(
        sessions, schema_json=_declaring_schema()
    )  # launched before the feature
    _dispatcher(sessions, service, clock).tick()
    (sent,) = service.bodies
    assert TOKEN_ENV_KEY not in sent.get("env_overrides", {})
    assert _job(sessions, seed["job_ids"][0]).status == EvalJobStatus.SUBMITTED


def test_resolve_reports_an_unavailable_token(sessions):
    seed = _seed_with_token(sessions, declares=True)
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        experiment.dataset_read_token_encrypted = None
        with pytest.raises(DatasetTokenUnavailable) as exc:
            resolve_dataset_token(db, experiment)
    assert str(exc.value) == DATASET_TOKEN_UNAVAILABLE


class EchoingService(FakeService):
    """A service whose 422 and poll answers repeat the submitted secrets."""

    async def submit(self, body):
        token = body["env_overrides"][TOKEN_ENV_KEY]
        raise RequestRejected(
            f"Evaluation service rejected the request: bad token {token}",
            errors=[{"loc": ["body", "notes"], "msg": f"saw {token}", "type": "x"}],
        )


def test_echoed_token_is_scrubbed_before_anything_is_stored(sessions, clock, caplog):
    seed = _seed_with_token(sessions, declares=True)
    caplog.set_level(logging.DEBUG)
    _dispatcher(sessions, EchoingService(clock), clock).tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.BLOCKED
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        token = resolve_dataset_token(db, experiment)
        rows = [
            json.dumps(
                [j.error, j.wait_reason, j.remote_result, j.request_body, j.params],
                default=str,
            )
            for j in db.query(EvalExperimentJob)
        ]
    assert all(token not in row for row in rows) and token not in caplog.text


class EchoingPollService(FakeService):
    """Accepts the job, then echoes the whole submitted body in its job record."""

    async def submit(self, body):
        job = await super().submit(body)
        with self.lock:
            self.jobs[job["id"]]["env_overrides"] = body["env_overrides"]
            self.jobs[job["id"]][
                "note"
            ] = f"token was {body['env_overrides'][TOKEN_ENV_KEY]}"
        return job


def test_a_polled_echo_of_the_token_is_not_stored(sessions, clock, caplog):
    seed = _seed_with_token(sessions, declares=True)
    caplog.set_level(logging.DEBUG)
    service = EchoingPollService(clock)
    dispatcher = _dispatcher(sessions, service, clock)
    dispatcher.tick()
    (rid,) = service.jobs
    service.set_status(
        rid,
        "SUCCEEDED",
        result={"summary": f"used {service.bodies[0]['env_overrides'][TOKEN_ENV_KEY]}"},
    )
    clock.advance(60)
    dispatcher.tick()
    job = _job(sessions, seed["job_ids"][0])
    token = service.bodies[0]["env_overrides"][TOKEN_ENV_KEY]
    stored = json.dumps(
        [job.error, job.wait_reason, job.remote_result, job.remote_versioning],
        default=str,
    )
    assert token not in stored and token not in caplog.text


def test_issue_does_not_log_the_token(session_factory, client, env, caplog):
    caplog.set_level(logging.DEBUG)
    created = _created(client, [env.id])
    _, token = _token_state(session_factory, created["id"])
    assert token not in caplog.text
