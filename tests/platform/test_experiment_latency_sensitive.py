"""Latency-sensitive runs (WP-B feature 5): flag, environment gate, body field, warnings,
admission state of a job, filters. Criteria ids refer to spec-b.md (B5-n)."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import pytest
from qym_platform.db.models import (
    ApiKey,
    AuditLog,
    DatasetReadToken,
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    EvalPriority,
)
from qym_platform.services.eval_launch_flags import (
    CEILING_KEY,
    CEILING_MESSAGE,
    latency_gate_message,
    latency_gate_names,
)
from sqlalchemy import event
from test_eval_dispatcher import (  # noqa: F401  (clock, service, sessions, _env: fixtures)
    T0,
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
    ADMIN,
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

ENV_URL = f"/v1/projects/{P1}/eval-environments"


def _managers_only(session_factory, name="production", **values):
    return _add_env(
        session_factory, name, latency_sensitive_min_role="manager", **values
    )


def _declaring_ceiling_env(session_factory, name="vllm"):
    env = _add_env(session_factory, name)
    schema = json.loads(FIXTURE.read_text())
    schema["properties"][CEILING_KEY] = {"type": "integer"}
    with session_factory() as s:
        s.get(EvalEnvironmentSchema, env.current_schema_id).schema_json = schema
        s.commit()
    return env


def _counts(session_factory):
    with session_factory() as s:
        return (
            s.query(EvalExperiment).count(),
            s.query(DatasetReadToken).count(),
            s.query(ApiKey).count(),
        )


# --------------------------------------------------------------------------- units


def test_gate_names_and_message():
    class E:
        def __init__(self, name, role):
            self.name, self.latency_sensitive_min_role = name, role

    envs = [E("staging", "member"), E("production", "manager"), E("edge", "manager")]
    assert latency_gate_names(envs, is_manager=True) == []
    names = latency_gate_names(envs, is_manager=False)
    assert names == ["production", "edge"]
    assert latency_gate_message(["production"]) == (
        "Latency-sensitive runs on production need a project manager"
    )
    assert latency_gate_message(names).endswith(
        "production, edge need a project manager"
    )


# --------------------------------------------------------------------------- B5-2


def test_flag_is_stored_and_carried_by_every_payload(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    assert created["latency_sensitive"] is True
    plain = _created(client, [env.id])
    assert plain["latency_sensitive"] is False
    listed = client.get(_url(), headers=_headers(MEMBER)).json()["experiments"]
    assert {x["id"]: x["latency_sensitive"] for x in listed} == {
        created["id"]: True,
        plain["id"]: False,
    }
    detail = client.get(
        _url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)
    ).json()
    assert detail["latency_sensitive"] is True
    queue = client.get(f"/v1/projects/{P1}/eval-queue", headers=_headers(MEMBER)).json()
    assert {j["experiment_id"]: j["latency_sensitive"] for j in queue["jobs"]} == {
        created["id"]: True,
        plain["id"]: False,
    }
    with session_factory() as s:
        audit = [a for a in s.query(AuditLog) if a.action == "eval_experiment.created"]
    assert {a.after["latency_sensitive"] for a in audit} == {True, False}


def test_experiments_created_before_the_feature_read_false(
    client, session_factory, env
):
    created = _created(client, [env.id])
    with session_factory() as s:
        s.execute(EvalExperiment.__table__.update().values(latency_sensitive=False))
        s.commit()
    listed = client.get(_url(), headers=_headers(MEMBER)).json()["experiments"]
    assert [x["latency_sensitive"] for x in listed] == [False]


def test_the_flag_cannot_be_changed_after_launch(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    res = client.patch(
        _url(suffix=f"/{created['id']}"),
        headers=_headers(MANAGER),
        json={"latency_sensitive": False},
    )
    assert res.status_code in (404, 405)
    with session_factory() as s:
        assert s.get(EvalExperiment, created["id"]).latency_sensitive is True


# --------------------------------------------------------------------------- B5-3, B5-20


def test_environment_payload_and_role_edit(client, session_factory, env):
    listed = client.get(ENV_URL, headers=_headers(MEMBER)).json()["environments"]
    assert [e["latency_sensitive_min_role"] for e in listed] == ["member"]

    path = f"{ENV_URL}/{env.id}"
    assert (
        client.put(
            path,
            headers=_headers(MEMBER),
            json={"latency_sensitive_min_role": "manager"},
        ).status_code
        == 403
    )
    bad = client.put(
        path, headers=_headers(MANAGER), json={"latency_sensitive_min_role": "owner"}
    )
    assert bad.status_code == 422
    with session_factory() as s:
        before_schema = s.get(EvalEnvironment, env.id).current_schema_id
        s.get(EvalEnvironment, env.id).health_status = "ok"
        s.commit()
    ok = client.put(
        path, headers=_headers(MANAGER), json={"latency_sensitive_min_role": "manager"}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["latency_sensitive_min_role"] == "manager"
    with session_factory() as s:
        row = s.get(EvalEnvironment, env.id)
        # Health, schema and presets are untouched by a role change.
        assert row.health_status == "ok" and row.current_schema_id == before_schema
        audit = [a for a in s.query(AuditLog) if a.action == "eval.environment_updated"]
    assert audit[0].before == {"latency_sensitive_min_role": "member"}
    assert audit[0].after == {"latency_sensitive_min_role": "manager"}
    back = client.put(
        path, headers=_headers(ADMIN), json={"latency_sensitive_min_role": "member"}
    )
    assert back.json()["latency_sensitive_min_role"] == "member"
    # An unrelated edit records no role change.
    client.put(path, headers=_headers(MANAGER), json={"description": "x"})
    with session_factory() as s:
        assert (
            len(
                [a for a in s.query(AuditLog) if a.action == "eval.environment_updated"]
            )
            == 2
        )


# --------------------------------------------------------------------------- B5-4 .. B5-6


def test_member_is_refused_on_a_managers_only_environment(client, session_factory):
    prod = _managers_only(session_factory)
    res = _create(client, [prod.id], latency_sensitive=True)
    assert res.status_code == 403
    assert (
        res.json()["detail"]
        == "Latency-sensitive runs on production need a project manager"
    )
    assert _counts(session_factory) == (0, 0, 0)


def test_several_managers_only_environments_are_named_in_order(client, session_factory):
    staging = _add_env(session_factory, "staging")
    prod = _managers_only(session_factory, "production")
    edge = _managers_only(session_factory, "edge")
    res = _create(client, [staging.id, prod.id, edge.id], latency_sensitive=True)
    assert res.status_code == 403
    assert res.json()["detail"] == (
        "Latency-sensitive runs on production, edge need a project manager"
    )


def test_dry_run_reports_the_gate_as_a_blocking_item(client, session_factory):
    prod = _managers_only(session_factory)
    res = _create(client, [prod.id], latency_sensitive=True, dry_run=True)
    body = res.json()
    assert res.status_code == 200 and body["ok"] is False
    (item,) = [e for e in body["errors"] if e["pointer"] == "/latency_sensitive"]
    assert item["section"] == "document" and item["code"] == "latency_sensitive_role"
    assert (
        item["message"] == "Latency-sensitive runs on production need a project manager"
    )


def test_managers_admins_members_and_unflagged_launches_pass(client, session_factory):
    prod = _managers_only(session_factory)
    assert (
        _create(client, [prod.id], email=MANAGER, latency_sensitive=True).status_code
        == 200
    )
    assert (
        _create(client, [prod.id], email=ADMIN, latency_sensitive=True).status_code
        == 200
    )
    assert _create(client, [prod.id], latency_sensitive=False).status_code == 200
    open_env = _add_env(session_factory, "open")
    assert _create(client, [open_env.id], latency_sensitive=True).status_code == 200
    ok = _create(client, [prod.id], email=MANAGER, latency_sensitive=True, dry_run=True)
    assert ok.json()["ok"] is True


def test_retry_rechecks_the_gate_like_high(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    (job,) = _jobs(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.FAILED)
    with session_factory() as s:
        s.get(EvalEnvironment, env.id).latency_sensitive_min_role = "manager"
        s.commit()
    res = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MEMBER)
    )
    assert res.status_code == 403
    assert (
        res.json()["detail"]
        == "Latency-sensitive runs on staging need a project manager"
    )
    ok = client.post(
        _url(suffix=f"/{created['id']}/jobs/{job.id}/retry"), headers=_headers(MANAGER)
    )
    assert ok.status_code == 200, ok.text


def test_latency_is_orthogonal_to_priority(client, session_factory):
    high = _add_env(session_factory, "high", max_priority=EvalPriority.HIGH)
    res = _create(
        client,
        [high.id],
        email=MANAGER,
        priority="HIGH",
        acknowledge_preemption=True,
        latency_sensitive=True,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["priority"] == "HIGH" and body["latency_sensitive"] is True
    (job,) = _jobs(session_factory, body["id"])
    assert job.request_body["priority"] == "HIGH"


# --------------------------------------------------------------------------- B5-7, B5-8


def test_dry_run_preview_shows_the_flag_only_when_true(client, env):
    on = _create(client, [env.id], latency_sensitive=True, dry_run=True).json()
    off = _create(client, [env.id], dry_run=True).json()
    assert on["jobs"][0]["request_body"]["latency_sensitive"] is True
    assert "latency_sensitive" not in off["jobs"][0]["request_body"]


def test_stored_body_never_holds_the_flag(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    (job,) = _jobs(session_factory, created["id"])
    assert "latency_sensitive" not in job.request_body


def test_dispatcher_sends_the_field_only_when_true(sessions, service, clock):
    on = _seed(sessions)
    with sessions() as db:
        db.get(EvalExperiment, on["experiment_id"]).latency_sensitive = True
        db.commit()
    _dispatcher(sessions, service, clock).tick()
    (sent,) = service.bodies
    assert sent["latency_sensitive"] is True


def test_dispatcher_omits_the_field_when_false(sessions, service, clock):
    _seed(sessions)
    _dispatcher(sessions, service, clock).tick()
    (sent,) = service.bodies
    assert "latency_sensitive" not in sent


@pytest.mark.parametrize("dry_run", [True, False])
def test_a_document_cannot_set_the_field(client, env, session_factory, dry_run):
    spec = {**_spec(), "latency_sensitive": True}
    res = _create(client, [env.id], spec=spec, dry_run=dry_run)
    if dry_run:
        assert res.status_code == 200 and res.json()["ok"] is False
        errors = res.json()["errors"]
    else:
        assert res.status_code == 422
        errors = res.json()["detail"]["errors"]
    (item,) = [e for e in errors if e["pointer"] == "/latency_sensitive"]
    assert item["rule"] == "platform_owned"
    assert item["message"] == "latency_sensitive is set by the platform; remove it"


# --------------------------------------------------------------------------- B5-9, B5-10


def test_warnings_array_exists_in_every_dry_run(client, env):
    assert _create(client, [env.id], dry_run=True).json()["warnings"] == []


def test_ceiling_warning_when_declared_and_unset(client, session_factory):
    vllm = _declaring_ceiling_env(session_factory)
    body = _create(client, [vllm.id], latency_sensitive=True, dry_run=True).json()
    assert body["ok"] is True
    assert body["warnings"] == [
        {
            "code": "vllm_ceiling_unset",
            "pointer": "/env_overrides/" + CEILING_KEY,
            "environment_ids": [vllm.id],
            "message": CEILING_MESSAGE,
        }
    ]
    # Launch is not blocked.
    assert _create(client, [vllm.id], latency_sensitive=True).status_code == 200


def test_no_ceiling_warning_when_off_undeclared_or_set(client, session_factory, env):
    vllm = _declaring_ceiling_env(session_factory)
    assert _create(client, [vllm.id], dry_run=True).json()["warnings"] == []
    assert (
        _create(client, [env.id], latency_sensitive=True, dry_run=True).json()[
            "warnings"
        ]
        == []
    )
    spec = _spec()
    spec["env_overrides"][CEILING_KEY] = 8
    assert (
        _create(
            client, [vllm.id], spec=spec, latency_sensitive=True, dry_run=True
        ).json()["warnings"]
        == []
    )
    spec["env_overrides"][CEILING_KEY] = None
    assert (
        len(
            _create(
                client, [vllm.id], spec=spec, latency_sensitive=True, dry_run=True
            ).json()["warnings"]
        )
        == 1
    )


def test_ceiling_warning_when_a_swept_combination_leaves_it_unset(
    client, session_factory
):
    vllm = _declaring_ceiling_env(session_factory)
    spec = _spec()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.6]}
    spec["env_overrides"][CEILING_KEY] = 8
    assert (
        _create(
            client, [vllm.id], spec=spec, latency_sensitive=True, dry_run=True
        ).json()["warnings"]
        == []
    )
    spec["env_overrides"][CEILING_KEY] = {"sweep": [8, None]}
    body = _create(
        client, [vllm.id], spec=spec, latency_sensitive=True, dry_run=True
    ).json()
    assert [w["code"] for w in body["warnings"]] == ["vllm_ceiling_unset"]


# --------------------------------------------------------------------------- B5-11, B5-13


class AdmissionService(FakeService):
    """Reports the admission state of a latency-sensitive job on every poll."""

    def admission(self, rid, **fields):
        with self.lock:
            self.jobs[rid].update(**fields)


def _submit_and_poll(sessions, clock, **fields):
    service = AdmissionService(clock)
    seed = _seed(sessions)
    with sessions() as db:
        db.get(EvalExperiment, seed["experiment_id"]).latency_sensitive = True
        db.commit()
    dispatcher = _dispatcher(sessions, service, clock)
    dispatcher.tick()
    (rid,) = service.jobs
    return seed, service, dispatcher, rid


def test_poll_stores_the_admission_state_and_noops_when_unchanged(sessions, clock):
    seed, service, dispatcher, rid = _submit_and_poll(sessions, clock)
    job_id = seed["job_ids"][0]
    assert _job(sessions, job_id).deferrals == 0

    service.admission(
        rid,
        deferrals=3,
        deferral_reason="vllm quiet window",
        admitted_at=None,
        contaminated_attempts=0,
    )
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, job_id)
    assert (job.deferrals, job.deferral_reason, job.admitted_at) == (
        3,
        "vllm quiet window",
        None,
    )
    changed_at = job.updated_at

    clock.advance(30)
    dispatcher.tick()  # same values: nothing meaningful changed
    assert _job(sessions, job_id).updated_at == changed_at

    service.admission(
        rid,
        status="RUNNING",
        admitted_at=(clock() + timedelta(seconds=5)).isoformat() + "+00:00",
        contaminated_attempts=1,
    )
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, job_id)
    assert job.admitted_at is not None and job.admitted_at.tzinfo is None
    assert job.contaminated_attempts == 1 and job.deferrals == 3
    assert job.updated_at > changed_at

    # Re-queued: the service nulls admitted_at again.
    service.admission(rid, status="PENDING", admitted_at=None, deferrals=4)
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, job_id)
    assert job.admitted_at is None and job.deferrals == 4


def test_deferral_reason_is_redacted_and_cut(sessions, clock):
    seed, service, dispatcher, rid = _submit_and_poll(sessions, clock)
    service.admission(
        rid,
        deferrals=1,
        deferral_reason="gateway busy api_key=sk-secret-value-1234567 " + "x" * 700,
    )
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, seed["job_ids"][0])
    assert "sk-secret-value" not in job.deferral_reason
    assert len(job.deferral_reason) <= 500


def test_an_older_service_leaves_defaults(sessions, clock):
    seed, service, dispatcher, rid = _submit_and_poll(sessions, clock)
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, seed["job_ids"][0])
    assert (
        job.admitted_at,
        job.deferrals,
        job.deferral_reason,
        job.contaminated_attempts,
    ) == (
        None,
        0,
        None,
        0,
    )


def test_a_job_failed_after_discarded_runs_keeps_the_text_and_count(sessions, clock):
    seed, service, dispatcher, rid = _submit_and_poll(sessions, clock)
    service.set_status(
        rid,
        "FAILED",
        error="giving up after 3 discarded run(s)",
        contaminated_attempts=3,
    )
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.FAILED
    assert job.error.endswith("giving up after 3 discarded run(s)")
    assert job.contaminated_attempts == 3


def test_a_contaminated_requeue_keeps_the_reason_until_the_next_attempt(
    sessions, clock
):
    seed, service, dispatcher, rid = _submit_and_poll(sessions, clock)
    service.admission(
        rid,
        status="PENDING",
        contaminated_attempts=1,
        error="vllm busier than ceiling during the run",
    )
    clock.advance(30)
    dispatcher.tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.SUBMITTED and job.contaminated_attempts == 1
    assert job.error == "vllm busier than ceiling during the run"
    service.admission(rid, status="RUNNING", error=None)
    clock.advance(30)
    dispatcher.tick()
    assert _job(sessions, seed["job_ids"][0]).error is None


# --------------------------------------------------------------------------- B5-12


def test_detail_and_queue_carry_the_admission_fields(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    (job,) = _jobs(session_factory, created["id"])
    _set_job(
        session_factory,
        job.id,
        deferrals=2,
        deferral_reason="vllm quiet window",
        contaminated_attempts=1,
    )
    detail = client.get(
        _url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)
    ).json()
    queue = client.get(f"/v1/projects/{P1}/eval-queue", headers=_headers(MEMBER)).json()
    for payload in (detail["jobs"][0], queue["jobs"][0]):
        assert payload["deferrals"] == 2
        assert payload["deferral_reason"] == "vllm quiet window"
        assert payload["contaminated_attempts"] == 1
        assert payload["admitted_at"] is None


# --------------------------------------------------------------------------- B5-14, B5-15


def test_list_and_queue_filters(client, session_factory, env):
    flagged = _created(client, [env.id], latency_sensitive=True)
    plain = _created(client, [env.id])
    only = client.get(
        _url(), params={"latency_sensitive": "true"}, headers=_headers(MEMBER)
    ).json()
    assert [x["id"] for x in only["experiments"]] == [flagged["id"]] and only[
        "total"
    ] == 1
    none = client.get(
        _url(), params={"latency_sensitive": "false"}, headers=_headers(MEMBER)
    ).json()
    assert [x["id"] for x in none["experiments"]] == [plain["id"]]
    assert client.get(_url(), headers=_headers(MEMBER)).json()["total"] == 2
    assert (
        client.get(
            _url(), params={"latency_sensitive": "maybe"}, headers=_headers(MEMBER)
        ).status_code
        == 422
    )

    queue_url = f"/v1/projects/{P1}/eval-queue"
    q = client.get(
        queue_url, params={"latency_sensitive": "true"}, headers=_headers(MEMBER)
    ).json()
    assert [j["experiment_id"] for j in q["jobs"]] == [flagged["id"]] and q[
        "total"
    ] == 1
    assert (
        client.get(
            queue_url, params={"latency_sensitive": "x"}, headers=_headers(MEMBER)
        ).status_code
        == 422
    )


def test_queue_environment_summary_reports_latency_active(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    _created(client, [env.id])
    queue_url = f"/v1/projects/{P1}/eval-queue"

    def active():
        body = client.get(queue_url, headers=_headers(MEMBER)).json()
        return [e["latency_active"] for e in body["environments"]]

    assert active() == [False]  # queued only: not active yet
    (job,) = _jobs(session_factory, created["id"])
    _set_job(session_factory, job.id, status=EvalJobStatus.RUNNING)
    assert active() == [True]
    _set_job(session_factory, job.id, status=EvalJobStatus.SUCCEEDED)
    assert active() == [False]


def test_filter_statement_count_does_not_depend_on_the_flagged_rows(
    client, session_factory, env
):
    def count_statements(params):
        engine = session_factory.kw["bind"]
        seen = []

        def listener(conn, cursor, statement, *args):
            seen.append(statement)

        event.listen(engine, "before_cursor_execute", listener)
        try:
            res = client.get(_url(), params=params, headers=_headers(MEMBER))
            assert res.status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen), [
            s
            for s in seen
            if s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
        ]

    for _ in range(2):
        _created(client, [env.id], latency_sensitive=True)
    few_filtered, writes = count_statements({"latency_sensitive": "true"})
    few_plain, _ = count_statements({})
    for _ in range(8):
        _created(client, [env.id], latency_sensitive=True)
    many_filtered, writes_many = count_statements({"latency_sensitive": "true"})
    many_plain, _ = count_statements({})
    assert few_filtered == many_filtered and few_plain == many_plain
    assert few_filtered == few_plain
    assert writes == [] and writes_many == []


# --------------------------------------------------------------------------- B5-16


def test_clone_carries_the_flag(client, session_factory, env):
    created = _created(client, [env.id], latency_sensitive=True)
    res = client.post(_url(suffix=f"/{created['id']}/clone"), headers=_headers(MEMBER))
    assert res.status_code == 200 and res.json()["latency_sensitive"] is True
    plain = _created(client, [env.id])
    again = client.post(
        _url(suffix=f"/{plain['id']}/clone"), headers=_headers(MEMBER)
    ).json()
    assert again["latency_sensitive"] is False
