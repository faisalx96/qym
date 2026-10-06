"""The creator's per-experiment ``qym_api_key`` (``services/eval_submitter_keys``).

Mint at launch, send at dispatch, revoke once every job is terminal, keep alive or
re-mint on retry, and never store, return or log the raw key.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import pytest
from fastapi import HTTPException
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
    MANAGER,
    MEMBER,
    P1,
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

from qym_platform.auth import clear_api_key_cache, require_api_key_principal
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (
    ApiKey,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    ProjectMembership,
    User,
)
from qym_platform.secrets import decrypt_llm_api_key
from qym_platform.security import verify_api_key
from qym_platform.services.eval_experiments import recompute_experiment_status
from qym_platform.services.eval_service_client import RequestRejected
from qym_platform.services.eval_submitter_keys import (
    CREATOR_MISSING,
    CREATOR_NOT_MEMBER,
    KEY_NAME_MAX,
    KEY_NAME_PREFIX,
    KEY_REVOKE_GRACE,
    KEY_UNAVAILABLE,
    SUBMITTER_KEY_SCOPES,
    SubmitterKeyUnavailable,
    key_name,
    resolve_submitter_key,
)


def _key_state(session_factory, experiment_id):
    """``(key row, decrypted token or None)`` for the experiment's current key."""
    with session_factory() as s:
        experiment = s.get(EvalExperiment, experiment_id)
        row = s.get(ApiKey, experiment.qym_api_key_id)
        s.expunge(row)
        blob = experiment.qym_api_key_encrypted
        return row, decrypt_llm_api_key(blob) if blob else None


def _authenticate(session_factory, token):
    clear_api_key_cache()
    with session_factory() as s:
        return require_api_key_principal(db=s, authorization=f"Bearer {token}")


def _settle(session_factory, job_id, status, *, ago=KEY_REVOKE_GRACE + timedelta(minutes=1)):
    """Finish the job ``ago`` in the past (default: past the revocation grace)."""
    with session_factory() as s:
        job = s.get(EvalExperimentJob, job_id)
        job.status = status
        job.finished_at = utc_now_naive() - ago
        recompute_experiment_status(s, job.experiment_id)
        s.commit()


# --------------------------------------------------------------------------- units


def test_key_name_is_prefixed_and_fits_the_column():
    assert key_name("rag") == KEY_NAME_PREFIX + "rag"
    assert key_name(None) == KEY_NAME_PREFIX
    long = key_name("x" * 500)
    assert len(long) == KEY_NAME_MAX and long.endswith("…")


# --------------------------------------------------------------------------- launch


def test_launch_mints_a_creator_key_that_is_never_returned(
    client, session_factory, env
):
    created = _created(client, [env.id])
    row, token = _key_state(session_factory, created["id"])
    assert row.user_id == "member-1" and row.project_id == P1
    assert row.name == KEY_NAME_PREFIX + "rag-vs-model"
    assert list(row.scopes) == list(SUBMITTER_KEY_SCOPES)
    assert row.revoked_at is None
    assert token and verify_api_key(token, row.key_hash)

    # It authenticates as the creator, bound to the experiment's project.
    principal = _authenticate(session_factory, token)
    assert principal.user.id == "member-1" and principal.project_id == P1

    with session_factory() as s:
        blob = s.get(EvalExperiment, created["id"]).qym_api_key_encrypted
        (job,) = _jobs(session_factory, created["id"])
        assert token not in json.dumps(job.request_body)
    for path in (_url(), _url(suffix=f"/{created['id']}")):
        text = client.get(path, headers=_headers(MEMBER)).text
        assert token not in text and blob not in text
        assert "qym_api_key" not in text


def test_dry_run_mints_nothing(client, session_factory, env):
    res = _create(client, [env.id], dry_run=True)
    assert res.status_code == 200 and res.json()["ok"] is True
    with session_factory() as s:
        assert s.query(ApiKey).count() == 0


def test_config_cannot_set_qym_api_key(client, session_factory, env):
    spec = {**_spec(), "qym_api_key": "sk-user-chosen-key-123456"}
    res = _create(client, [env.id], spec=spec, dry_run=True)
    assert "sk-user-chosen-key-123456" not in res.text
    if res.status_code == 200:
        body = res.json()
        assert body["ok"] is False
        errors = body.get("errors") or body["jobs"][0]["errors"]
    else:
        assert res.status_code == 422
        errors = res.json()["detail"]
    assert "platform_owned" in json.dumps(errors)
    assert "/qym_api_key" in json.dumps(errors)


# --------------------------------------------------------------------------- settle


def test_key_is_revoked_once_every_job_is_terminal(client, session_factory, env):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    _, token = _key_state(session_factory, created["id"])

    # BLOCKED is not terminal here: the job may be retried and must still upload.
    _settle(session_factory, job.id, EvalJobStatus.BLOCKED)
    row, still = _key_state(session_factory, created["id"])
    assert row.revoked_at is None and still == token

    # Just finished: the key stays usable so the SDK's last events still land.
    _settle(session_factory, job.id, EvalJobStatus.SUCCEEDED, ago=timedelta(0))
    row, still = _key_state(session_factory, created["id"])
    assert row.revoked_at is None and still == token

    _settle(session_factory, job.id, EvalJobStatus.SUCCEEDED)
    row, cleared = _key_state(session_factory, created["id"])
    assert row.revoked_at is not None and cleared is None
    with pytest.raises(HTTPException) as denied:
        _authenticate(session_factory, token)
    assert denied.value.status_code == 401


# --------------------------------------------------------------------------- retry


def test_retry_of_a_blocked_job_keeps_the_same_key(client, session_factory, env):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    before, token = _key_state(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.BLOCKED)

    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MANAGER)
    )
    assert res.status_code == 200, res.text
    after, same = _key_state(session_factory, created["id"])
    assert after.id == before.id and after.revoked_at is None and same == token
    # Retried by a manager, still owned by (and submitted as) the creator.
    assert after.user_id == "member-1"


def test_retry_after_settle_mints_a_new_key(client, session_factory, env):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    old, old_token = _key_state(session_factory, created["id"])
    _settle(session_factory, job.id, EvalJobStatus.FAILED)
    assert _key_state(session_factory, created["id"])[0].revoked_at is not None

    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MEMBER)
    )
    assert res.status_code == 200, res.text
    new, new_token = _key_state(session_factory, created["id"])
    assert new.id != old.id and new.revoked_at is None
    assert new.user_id == "member-1" and new.project_id == P1
    assert new_token and new_token != old_token
    assert _authenticate(session_factory, new_token).user.id == "member-1"
    with session_factory() as s:
        assert s.get(ApiKey, old.id).revoked_at is not None


def test_retry_is_refused_when_the_creator_left_the_project(
    client, session_factory, env
):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.FAILED)
    with session_factory() as s:
        s.query(ProjectMembership).filter_by(project_id=P1, user_id="member-1").delete()
        s.commit()

    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MANAGER)
    )
    assert res.status_code == 409
    assert res.json()["detail"] == CREATOR_NOT_MEMBER
    assert len(_jobs(session_factory, created["id"])) == 1


# --------------------------------------------------------------------------- dispatch


def test_dispatch_sends_the_creators_key(sessions, service, clock):
    seed = _seed(sessions)
    _dispatcher(sessions, service, clock).tick()
    assert _job(sessions, seed["job_ids"][0]).status == EvalJobStatus.SUBMITTED
    (sent,) = service.bodies
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        assert sent["qym_api_key"] == resolve_submitter_key(db, experiment)


@pytest.mark.parametrize(
    "breakage, reason",
    [
        ("left_project", CREATOR_NOT_MEMBER),
        ("disabled", CREATOR_NOT_MEMBER),
        ("revoked", KEY_UNAVAILABLE),
        ("unreadable", KEY_UNAVAILABLE),
        ("missing", KEY_UNAVAILABLE),
    ],
)
def test_unavailable_key_blocks_instead_of_submitting(
    sessions, service, clock, breakage, reason
):
    seed = _seed(sessions)
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        if breakage == "left_project":
            db.query(ProjectMembership).filter_by(
                project_id=experiment.project_id,
                user_id=experiment.created_by_user_id,
            ).delete()
        elif breakage == "disabled":
            db.get(User, experiment.created_by_user_id).is_active = False
        elif breakage == "revoked":  # e.g. the user revoked it on the API keys page
            db.get(ApiKey, experiment.qym_api_key_id).revoked_at = utc_now_naive()
        elif breakage == "unreadable":
            experiment.qym_api_key_encrypted = "not-a-fernet-token"
        else:  # an experiment launched before migration 0065
            experiment.qym_api_key_id = None
            experiment.qym_api_key_encrypted = None
        db.commit()

    _dispatcher(sessions, service, clock).tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.BLOCKED
    assert job.wait_reason == reason and job.next_attempt_at is None
    assert service.calls["submit"] == 0


def test_resolve_reports_a_deleted_creator(sessions):
    seed = _seed(sessions)
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        experiment.created_by_user_id = None
        with pytest.raises(SubmitterKeyUnavailable) as exc:
            resolve_submitter_key(db, experiment)
    assert str(exc.value) == CREATOR_MISSING


class EchoingService(FakeService):
    """A service whose 422 repeats the submitted ``qym_api_key`` in free text."""

    async def submit(self, body):
        key = body["qym_api_key"]
        raise RequestRejected(
            f"Evaluation service rejected the request: bad key {key}",
            errors=[{"loc": ["body", "notes"], "msg": f"saw {key}", "type": "x"}],
        )


def test_echoed_key_is_scrubbed_before_anything_is_stored(sessions, clock, caplog):
    seed = _seed(sessions)
    caplog.set_level(logging.DEBUG)
    _dispatcher(sessions, EchoingService(clock), clock).tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.BLOCKED
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        key = resolve_submitter_key(db, experiment)
    stored = json.dumps(
        [job.error, job.wait_reason, job.remote_result], default=str
    )
    assert key not in stored and key not in caplog.text
