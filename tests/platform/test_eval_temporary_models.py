"""Temporary models for a single experiment (plan §7.5, §15; issue #12).

Covers: the key is encrypted into ``secrets_encrypted`` and never leaks (responses,
job rows, ``qym_config``, audit logs, logs, clone, presets); it is only sent to
environments with ``allow_connection_keys``; it is cleared once every current job has
settled and a retry asks for it again; "Save to project models"; best-run reload
leaves the slot unbound.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from cryptography.fernet import Fernet
from sqlalchemy import text
from test_eval_dispatcher import ENV_KEY, FakeClock, FakeService
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MANAGER,
    MEMBER,
    PRIMARY,
    _add_env,
    _create,
    _created,
    _headers,
    _jobs,
    _set_job,
    _spec,
    _url,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (
    AuditLog,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    ProjectLlmConnection,
)
from qym_platform.secrets import decrypt_llm_api_key, encrypt_llm_api_key
from qym_platform.services import eval_dispatcher
from qym_platform.services.eval_bindings import connection_options
from qym_platform.services.eval_dispatcher import EvalDispatcher
from qym_platform.services.eval_experiments import clear_secrets_when_settled
from qym_platform.services.eval_model_slots import list_model_slots
from qym_platform.services.eval_presets import prepare_config
from qym_platform.services.eval_temporary_models import (
    UNBOUND_REASON,
    decrypt_secrets,
    encrypt_secrets,
    unbind_temporary,
)

KEY = "sk-temporary-secret-KEY-1234"
KEY2 = "sk-temporary-rotated-KEY-5678"
BASE_URL = "https://llm.example.com/v1"
TEMPORARY = {"label": "mini trial", "model": "gpt-4o-mini", "base_url": BASE_URL}


def _temp_spec(ref: str = "k1", **temporary) -> dict:
    spec = _spec()
    # The bound primary slot sets the model; drop _spec's literal one.
    del spec["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]["model"]
    binding = {**TEMPORARY, **temporary}
    if ref is not None:
        binding["api_key"] = {"$secret": ref}
    spec["slot_bindings"] = {PRIMARY: {"temporary": binding}}
    return spec


def _launch(client, env_ids, email=MEMBER, secrets=None, **kwargs):
    return _create(
        client,
        env_ids,
        email=email,
        spec=kwargs.pop("spec", None) or _temp_spec(),
        secrets={"k1": KEY} if secrets is None else secrets,
        **kwargs,
    )


def _experiment(session_factory, experiment_id) -> EvalExperiment:
    with session_factory() as s:
        row = s.get(EvalExperiment, experiment_id)
        s.expunge(row)
        return row


def _codes(res) -> set:
    return {e.get("code") for e in res.json()["detail"]["errors"]}


def _all_rows_text(session_factory) -> str:
    """Every column of every experiment, job, audit and connection row."""
    chunks = []
    with session_factory() as s:
        for table in (
            "eval_experiments",
            "eval_experiment_jobs",
            "audit_logs",
            "project_llm_connections",
        ):
            for row in s.execute(text(f"SELECT * FROM {table}")).mappings():
                chunks.append(json.dumps({k: str(v) for k, v in row.items()}))
    return "\n".join(chunks)


def _set_env(session_factory, env_id, **values) -> None:
    with session_factory() as s:
        row = s.get(EvalEnvironment, env_id)
        for key, value in values.items():
            setattr(row, key, value)
        s.commit()


def _dispatcher(session_factory, env_id):
    """A dispatcher against a fake Evaluation Service, with the default secret lookup."""
    _set_env(session_factory, env_id, api_key_encrypted=encrypt_llm_api_key(ENV_KEY))
    clock = FakeClock(utc_now_naive() + timedelta(seconds=1))
    service = FakeService(clock)
    dispatcher = EvalDispatcher(
        session_factory, client_factory=service.factory, clock=clock
    )
    return dispatcher, service, clock


# --------------------------------------------------------------------------- launch


def test_key_is_encrypted_at_launch_and_never_returned_or_stored(
    client, session_factory, env, caplog
):
    caplog.set_level(logging.DEBUG)
    res = _launch(client, [env.id])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["temporary_keys_stored"] is True
    assert "secrets_encrypted" not in body

    experiment = _experiment(session_factory, body["id"])
    assert experiment.secrets_encrypted and KEY not in experiment.secrets_encrypted
    assert json.loads(decrypt_llm_api_key(experiment.secrets_encrypted)) == {"k1": KEY}
    assert decrypt_secrets(experiment.secrets_encrypted) == {"k1": KEY}

    (job,) = _jobs(session_factory, body["id"])
    # The job keeps the ref (not the key) so the dispatcher can resolve it.
    assert job.params["slot_bindings"][PRIMARY] == {
        "temporary": {**TEMPORARY, "api_key": {"$secret": "k1"}}
    }
    metadata = job.request_body["evaluator"]["config"]["run_metadata"]
    # qym_config shows that a key was used, never the ref (#16); spec carries
    # label/model/base_url only.
    assert metadata["qym_config"]["slot_bindings"][PRIMARY] == {
        "temporary": {**TEMPORARY, "api_key": {"$secret": "redacted"}}
    }
    assert "k1" not in json.dumps(metadata["qym_config"])
    assert experiment.spec["slot_bindings"][PRIMARY] == {"temporary": TEMPORARY}
    primary = job.request_body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
    assert primary["model"] == "gpt-4o-mini" and primary["base_url"] == BASE_URL
    assert primary["api_key"] == "{{qym:slot:endpoint:primary:api_key}}"
    assert job.request_body["evaluator"]["model"] == "gpt-4o-mini"

    detail = client.get(_url(suffix=f"/{body['id']}"), headers=_headers(MEMBER))
    listing = client.get(_url(), headers=_headers(MEMBER))
    for text_ in (res.text, detail.text, listing.text):
        assert KEY not in text_
        assert "$secret" not in text_
        assert experiment.secrets_encrypted not in text_
    assert detail.json()["jobs"][0]["params"]["slot_bindings"][PRIMARY] == {
        "temporary": TEMPORARY
    }
    assert KEY not in _all_rows_text(session_factory)
    assert KEY not in caplog.text


def test_dry_run_validates_without_storing_or_echoing_the_key(
    client, session_factory, env
):
    res = _launch(client, [env.id], dry_run=True)
    assert res.status_code == 200 and res.json()["ok"] is True, res.text
    assert KEY not in res.text and "$secret" not in res.text
    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0


def test_launch_requires_the_key_and_a_safe_base_url(client, session_factory, env):
    missing = _launch(client, [env.id], secrets={})
    assert missing.status_code == 422
    assert "temporary_key_required" in _codes(missing)
    blank = _launch(client, [env.id], secrets={"k1": "   "})
    assert "temporary_key_required" in _codes(blank)
    other_ref = _launch(client, [env.id], secrets={"k2": KEY})
    assert "temporary_key_required" in _codes(other_ref)
    assert KEY not in other_ref.text

    for url in (
        "http://127.0.0.1:8000/v1",
        "ftp://llm.example.com",
        "https://u:p@x.io",
    ):
        bad = _launch(client, [env.id], spec=_temp_spec(base_url=url))
        assert bad.status_code == 422, url
        assert "temporary_base_url_invalid" in _codes(bad)
        assert KEY not in bad.text  # the 422 never echoes the key

    bad_ref = _launch(client, [env.id], spec=_temp_spec(ref="no spaces!"))
    assert "temporary_key_ref_invalid" in _codes(bad_ref)
    literal = _temp_spec()
    literal["slot_bindings"] = {PRIMARY: {"temporary": {**TEMPORARY, "api_key": KEY}}}
    res = _launch(client, [env.id], spec=literal)
    assert res.status_code == 422 and KEY not in res.text  # keys are refs only

    with session_factory() as s:
        assert s.query(EvalExperiment).count() == 0


def test_private_base_url_allowed_when_opted_in(
    client, session_factory, env, monkeypatch
):
    monkeypatch.setenv("QYM_ALLOW_PRIVATE_LLM_BASE_URLS", "true")
    res = _launch(client, [env.id], spec=_temp_spec(base_url="http://127.0.0.1:8000"))
    assert res.status_code == 200, res.text


def test_keys_need_encryption_configured(client, env, monkeypatch):
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY")
    res = _launch(client, [env.id], dry_run=True)
    assert res.status_code == 200 and res.json()["ok"] is False
    codes = {e.get("code") for e in res.json()["errors"]}
    assert "encryption_unavailable" in codes
    assert _launch(client, [env.id]).status_code == 400


def test_keys_only_sent_to_environments_that_opt_in(client, session_factory, env):
    closed = _add_env(session_factory, "closed")
    _set_env(session_factory, closed.id, allow_connection_keys=False)
    res = _launch(client, [env.id, closed.id])
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    refused = [e for e in errors if e.get("code") == "keys_not_allowed"]
    assert refused and {e["environment_id"] for e in refused} == {closed.id}
    assert KEY not in res.text

    # A keyless temporary model sends no key, so it is fine anywhere.
    assert (
        _launch(client, [closed.id], spec=_temp_spec(ref=None), secrets={}).status_code
        == 200
    )
    with session_factory() as s:
        options = connection_options(
            s,
            s.get(EvalEnvironment, closed.id),
            list_model_slots(s, closed.current_schema_id),
        )
        assert options["temporary_keys_allowed"] is False
        assert options["temporary_keys_reason"]

    # The dispatcher refuses too if the flag was turned off after launch.
    created = _launch(client, [env.id]).json()
    _set_env(session_factory, env.id, allow_connection_keys=False)
    dispatcher, service, _ = _dispatcher(session_factory, env.id)
    try:
        dispatcher.tick()
    finally:
        dispatcher.close()
    (job,) = _jobs(session_factory, created["id"])
    assert job.status == EvalJobStatus.BLOCKED
    assert "does not accept model keys" in job.wait_reason
    assert service.bodies == []


# --------------------------------------------------------------------------- dispatch


def test_dispatch_sends_key_in_memory_and_clears_it_when_terminal(
    client, session_factory, env, caplog
):
    caplog.set_level(logging.DEBUG)
    created = _launch(client, [env.id]).json()
    dispatcher, service, clock = _dispatcher(session_factory, env.id)
    try:
        dispatcher.tick()
        (job,) = _jobs(session_factory, created["id"])
        assert job.status == EvalJobStatus.SUBMITTED, job.wait_reason
        (sent,) = service.bodies
        primary = sent["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"]
        assert primary == {
            "model": "gpt-4o-mini",
            "base_url": BASE_URL,
            "api_key": KEY,
            "timeout": 60,
        }
        qym_config = sent["evaluator"]["config"]["run_metadata"]["qym_config"]
        assert KEY not in json.dumps(qym_config) and "k1" not in json.dumps(qym_config)
        # Still in flight: the key is kept (a resubmit after a crash needs it).
        assert _experiment(session_factory, created["id"]).secrets_encrypted

        service.set_status(job.remote_job_id, "SUCCEEDED", result={"ok": 1})
        clock.advance(60)
        dispatcher.tick()
    finally:
        dispatcher.close()
    (job,) = _jobs(session_factory, created["id"])
    assert job.status == EvalJobStatus.SUCCEEDED
    assert _experiment(session_factory, created["id"]).secrets_encrypted is None
    assert KEY not in _all_rows_text(session_factory)
    assert KEY not in caplog.text
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER))
    assert detail.json()["temporary_keys_stored"] is False


def test_dispatch_blocks_when_the_key_is_gone(client, session_factory, env):
    created = _launch(client, [env.id]).json()
    with session_factory() as s:
        s.get(EvalExperiment, created["id"]).secrets_encrypted = None
        s.commit()
    dispatcher, service, _ = _dispatcher(session_factory, env.id)
    try:
        dispatcher.tick()
    finally:
        dispatcher.close()
    (job,) = _jobs(session_factory, created["id"])
    assert job.status == EvalJobStatus.BLOCKED
    assert "enter it again" in job.wait_reason and KEY not in job.wait_reason
    assert service.bodies == []


def test_dispatch_never_sends_a_temporary_model_without_its_key(
    client, session_factory, env
):
    """A key placeholder whose ref vanished blocks instead of inheriting a key."""
    created = _launch(client, [env.id]).json()
    (job,) = _jobs(session_factory, created["id"])
    params = json.loads(json.dumps(job.params))
    del params["slot_bindings"][PRIMARY]["temporary"]["api_key"]
    _set_job(session_factory, job.id, params=params)
    dispatcher, service, _ = _dispatcher(session_factory, env.id)
    try:
        dispatcher.tick()
    finally:
        dispatcher.close()
    job = _jobs(session_factory, created["id"])[0]
    assert job.status == EvalJobStatus.BLOCKED
    assert "no longer stored" in job.wait_reason
    assert service.bodies == []


# --------------------------------------------------------------------------- clearing


def test_keys_cleared_only_when_every_current_job_settled(client, session_factory, env):
    other = _add_env(session_factory, "prod")
    created = _launch(client, [env.id, other.id]).json()
    first, second = _jobs(session_factory, created["id"])
    _set_job(session_factory, first.id, status=EvalJobStatus.SUCCEEDED)
    _set_job(session_factory, second.id, status=EvalJobStatus.RUNNING)
    with session_factory() as s:
        eval_dispatcher.recompute_experiment_status(s, created["id"])
        s.commit()
    assert _experiment(session_factory, created["id"]).secrets_encrypted

    _set_job(session_factory, second.id, status=EvalJobStatus.BLOCKED)
    with session_factory() as s:
        eval_dispatcher.recompute_experiment_status(s, created["id"])
        s.commit()
    # BLOCKED needs a user action (a retry, which asks for the key again).
    assert _experiment(session_factory, created["id"]).secrets_encrypted is None


def test_clear_helper_ignores_superseded_attempts(encryption):
    blob = encrypt_secrets({"k1": KEY})
    experiment = EvalExperiment(id="x", secrets_encrypted=blob)
    old = EvalExperimentJob(id="a", status=EvalJobStatus.QUEUED)
    retry = EvalExperimentJob(id="b", status=EvalJobStatus.FAILED, retry_of_job_id="a")
    assert clear_secrets_when_settled(experiment, [old, retry]) is True
    assert experiment.secrets_encrypted is None
    experiment.secrets_encrypted = blob
    retry.status = EvalJobStatus.QUEUED
    assert clear_secrets_when_settled(experiment, [old, retry]) is False
    assert clear_secrets_when_settled(experiment, []) is False


def test_clear_does_not_overwrite_a_blob_written_concurrently(
    client, session_factory, env
):
    created = _launch(client, [env.id]).json()
    (job,) = _jobs(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.FAILED)
    with session_factory() as s:
        experiment = s.get(EvalExperiment, created["id"])
        jobs = s.query(EvalExperimentJob).all()
        assert experiment.secrets_encrypted
        # A retry commits a fresh blob after this session read the old one.
        with session_factory() as other:
            other.get(EvalExperiment, created["id"]).secrets_encrypted = (
                encrypt_secrets({"k1": KEY2})
            )
            other.commit()
        assert clear_secrets_when_settled(experiment, jobs) is False
        s.commit()
    stored = _experiment(session_factory, created["id"]).secrets_encrypted
    assert decrypt_secrets(stored) == {"k1": KEY2}


def test_cancel_clears_keys_and_retry_asks_for_them_again(client, session_factory, env):
    created = _launch(client, [env.id]).json()
    (job,) = _jobs(session_factory, created["id"])
    res = client.post(_url(suffix=f"/{created['id']}/cancel"), headers=_headers(MEMBER))
    assert res.status_code == 200, res.text
    assert res.json()["experiment"]["temporary_keys_stored"] is False
    assert _experiment(session_factory, created["id"]).secrets_encrypted is None

    retry_path = _url(suffix=f"/{created['id']}/jobs/{job.id}/retry")
    refused = client.post(retry_path, headers=_headers(MEMBER))
    assert refused.status_code == 422
    detail = refused.json()["detail"]
    assert detail["code"] == "temporary_key_required"
    assert detail["slots"] == [
        {
            "slot_key": PRIMARY,
            "label": "mini trial",
            "model": "gpt-4o-mini",
            "base_url": BASE_URL,
        }
    ]
    assert len(_jobs(session_factory, created["id"])) == 1  # nothing created

    wrong_slot = client.post(
        retry_path, headers=_headers(MEMBER), json={"temporary_keys": {"x": KEY2}}
    )
    assert wrong_slot.status_code == 422 and KEY2 not in wrong_slot.text

    res = client.post(
        retry_path, headers=_headers(MEMBER), json={"temporary_keys": {PRIMARY: KEY2}}
    )
    assert res.status_code == 200, res.text
    assert KEY2 not in res.text
    assert res.json()["experiment"]["temporary_keys_stored"] is True
    stored = _experiment(session_factory, created["id"]).secrets_encrypted
    assert decrypt_secrets(stored) == {"k1": KEY2}
    new = {j.id: j for j in _jobs(session_factory, created["id"])}[res.json()["job_id"]]
    assert new.params == job.params  # same ref
    assert KEY2 not in _all_rows_text(session_factory)


def test_retry_while_keys_are_stored_needs_no_key(client, session_factory, env):
    other = _add_env(session_factory, "prod")
    created = _launch(client, [env.id, other.id]).json()
    first, _ = _jobs(session_factory, created["id"])
    _set_job(session_factory, first.id, status=EvalJobStatus.FAILED)
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{first.id}/retry"), headers=_headers(MEMBER)
    )
    assert res.status_code == 200, res.text
    stored = _experiment(session_factory, created["id"]).secrets_encrypted
    assert decrypt_secrets(stored) == {"k1": KEY}


# --------------------------------------------------------------------------- copies


def test_clone_and_presets_never_copy_the_key(client, session_factory, env):
    created = _launch(client, [env.id]).json()
    clone = client.post(
        _url(suffix=f"/{created['id']}/clone"), headers=_headers(MEMBER)
    )
    assert clone.status_code == 200
    assert KEY not in clone.text and "$secret" not in clone.text
    assert clone.json()["spec"]["slot_bindings"][PRIMARY] == {"temporary": TEMPORARY}

    with session_factory() as s:
        env_row = s.get(EvalEnvironment, env.id)
        schema = s.get(EvalEnvironmentSchema, env_row.current_schema_id)
        stored, warnings = prepare_config(
            s, env_row, schema, _temp_spec(), official=False
        )
    assert stored["slot_bindings"][PRIMARY] == {"temporary": TEMPORARY}
    assert any(w.get("rule") == "temporary_key_dropped" for w in warnings)


# --------------------------------------------------------------------------- save


def test_save_to_project_models_creates_a_connection(client, session_factory, env):
    member = _launch(client, [env.id], save_to_project_models=[PRIMARY])
    assert member.status_code == 403
    dry = _launch(
        client, [env.id], email=MANAGER, save_to_project_models=[PRIMARY], dry_run=True
    )
    assert dry.status_code == 200 and dry.json()["ok"] is True
    with session_factory() as s:
        assert s.query(ProjectLlmConnection).count() == 0

    res = _launch(client, [env.id], email=MANAGER, save_to_project_models=[PRIMARY])
    assert res.status_code == 200, res.text
    assert KEY not in res.text
    with session_factory() as s:
        (conn_row,) = s.query(ProjectLlmConnection).all()
        assert conn_row.name == "mini trial"
        assert conn_row.llm_model == "gpt-4o-mini"
        assert conn_row.llm_base_url == BASE_URL
        assert conn_row.available_for_experiments is True
        assert decrypt_llm_api_key(conn_row.llm_api_key_encrypted) == KEY
        assert conn_row.llm_api_key_last4 == KEY[-4:]
        conn_id = conn_row.id
    body = res.json()
    assert body["spec"]["slot_bindings"][PRIMARY]["connection_id"] == conn_id
    assert body["temporary_keys_stored"] is False  # nothing temporary left
    assert _experiment(session_factory, body["id"]).secrets_encrypted is None
    (job,) = _jobs(session_factory, body["id"])
    assert job.params["slot_bindings"][PRIMARY]["connection_id"] == conn_id
    with session_factory() as s:
        audit = (
            s.query(AuditLog)
            .filter(AuditLog.action == "eval_experiment.created")
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert audit.after["saved_connection_ids"] == [conn_id]

    # The name is taken now: nothing is created, the launch is refused.
    again = _launch(client, [env.id], email=MANAGER, save_to_project_models=[PRIMARY])
    assert again.status_code == 409 and KEY not in again.text
    with session_factory() as s:
        assert s.query(ProjectLlmConnection).count() == 1
        assert s.query(EvalExperiment).count() == 1


def test_save_to_project_models_needs_a_temporary_binding_url_and_key(
    client, session_factory, env, conn
):
    not_temporary = _create(
        client,
        [env.id],
        email=MANAGER,
        spec=_spec(conn.id),
        save_to_project_models=[PRIMARY],
    )
    assert not_temporary.status_code == 422
    keyless = _launch(
        client,
        [env.id],
        email=MANAGER,
        spec=_temp_spec(ref=None, label="keyless"),
        secrets={},
        save_to_project_models=[PRIMARY],
    )
    assert keyless.status_code == 422
    no_url = _launch(
        client,
        [env.id],
        email=MANAGER,
        spec=_temp_spec(base_url=None, label="no url"),
        save_to_project_models=[PRIMARY],
    )
    assert no_url.status_code == 422
    with session_factory() as s:
        assert s.query(ProjectLlmConnection).count() == 1  # only the fixture's
        assert s.query(EvalExperiment).count() == 0


# --------------------------------------------------------------------------- reload


def test_best_run_reload_leaves_temporary_slot_unbound(
    client, session_factory, env, conn
):
    qym_config = {
        "schema_hash": "h-staging",
        "slot_bindings": {
            PRIMARY: {"connection_id": conn.id, "name": "GPT-4o prod"},
            "endpoint:fast": {"temporary": TEMPORARY},
        },
        "env_overrides": {"MILVUS_SEARCH_THRESHOLD": 0.7},
    }
    loaded, unbound = unbind_temporary(qym_config)
    assert loaded["slot_bindings"]["endpoint:fast"] is None
    assert loaded["slot_bindings"][PRIMARY] == qym_config["slot_bindings"][PRIMARY]
    assert loaded["env_overrides"] == qym_config["env_overrides"]
    assert unbound == [
        {
            "slot_key": "endpoint:fast",
            "label": "mini trial",
            "model": "gpt-4o-mini",
            "base_url": BASE_URL,
            "reason": UNBOUND_REASON,
        }
    ]
    assert qym_config["slot_bindings"]["endpoint:fast"] == {"temporary": TEMPORARY}

    # The same holds for the config stored by a real launch.
    created = _launch(client, [env.id]).json()
    (job,) = _jobs(session_factory, created["id"])
    stored = job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    loaded, unbound = unbind_temporary(stored)
    assert loaded["slot_bindings"][PRIMARY] is None
    assert [u["slot_key"] for u in unbound] == [PRIMARY]
    assert unbind_temporary(None) == (None, [])


def test_decrypt_secrets_tolerates_rotation(encryption, monkeypatch):
    blob = encrypt_secrets({"k1": KEY})
    assert decrypt_secrets(blob) == {"k1": KEY}
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    assert decrypt_secrets(blob) == {}
    assert encrypt_secrets({}) is None
