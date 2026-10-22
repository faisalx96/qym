"""Several dataset versions per experiment (change request v1.4; spec-d QD-71 to QD-92)."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

from qym_platform.api.eval_environments import get_eval_client_factory
from qym_platform.app import create_app
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentEvaluatorSchema,
    EvalExperimentJob,
    EvalJobStatus,
)
from qym_platform.deps import get_db
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services import eval_datasets
from qym_platform.services.eval_service_client import EvalServiceClient

from test_experiments_api import (  # noqa: F401  (fixtures)
    MEMBER,
    P1,
    _add_env,
    _create,
    _headers,
    _jobs,
    _set_job,
    _spec,
    _url,
    conn,
    encryption,
    env,
    session_factory,
)

V14 = Path(__file__).parent / "fixtures" / "eval_evaluator_schema-v14.json"
PAIRS = [
    {"dataset": "support-tickets", "version": "v3"},
    {"dataset": "support-tickets", "version": "v4"},
    {"dataset": "billing-faq", "version": "v2"},
    {"dataset": "refund-cases"},
]
SHAPE_ERROR = "Dataset versions cannot be swept; choose “One run each” to run each one."


def declare(session_factory, env_id: str, *, datasets: bool = True, task: bool = True) -> None:
    """Give the environment a stored evaluator schema declaring the v1.4 keys."""
    schema = json.loads(V14.read_text())
    if not datasets:
        schema["properties"].pop("datasets")
    if not task:
        schema["properties"].pop("task")
    with session_factory() as db:
        row = EvalEnvironmentEvaluatorSchema(
            environment_id=env_id, schema_hash=("d" if datasets else "t") * 63 + str(task)[0], schema_json=schema
        )
        db.add(row)
        db.flush()
        environment = db.get(EvalEnvironment, env_id)
        environment.current_evaluator_schema_id = row.id
        environment.evaluator_schema_status = "available"
        environment.api_key_encrypted = encrypt_llm_api_key("service-key-0000")
        db.commit()


def multi_spec(datasets: Optional[List[dict]] = None, **evaluator: Any) -> Dict[str, Any]:
    spec = _spec()
    spec["evaluator"].pop("dataset")
    if datasets is not None:
        spec["evaluator"]["datasets"] = copy.deepcopy(datasets)
    spec["evaluator"].update(evaluator)
    return spec


class Tasks:
    """What the fake service answers on GET /evals/tasks."""

    def __init__(self) -> None:
        self.status = 200
        self.items = [
            {"id": "answer-ticket", "name": "Answer a ticket", "description": "d", "default": True},
            {"id": "route-ticket", "name": "Route a ticket", "description": None, "default": False},
            {"id": "bad id!", "name": "skipped"},
        ]
        self.calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/evals/tasks"):
            self.calls += 1
            if self.status == 200:
                return httpx.Response(200, json={"tasks": self.items})
            if self.status == 503:
                return httpx.Response(503, json={"detail": "could not list tasks: x"})
            return httpx.Response(self.status, json={"detail": "nope"})
        return httpx.Response(404, json={"detail": "Not Found"})


@pytest.fixture()
def tasks() -> Tasks:
    return Tasks()


@pytest.fixture()
def client(session_factory, tasks):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    def override_factory():
        def factory(base_url: str, api_key: str) -> EvalServiceClient:
            http = httpx.AsyncClient(transport=httpx.MockTransport(tasks.handler))
            return EvalServiceClient(base_url, api_key, allow_private=True, http_client=http)

        return factory

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_eval_client_factory] = override_factory
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def two_envs(session_factory):
    """production takes a list and a task, staging is a v1.3 service."""
    production = _add_env(session_factory, "production")
    staging = _add_env(session_factory, "staging")
    declare(session_factory, production.id)
    return production, staging


def _dry(client, env_ids, spec, **extra):
    return _create(client, env_ids, spec=spec, dry_run=True, **extra)


def _errors(res) -> List[dict]:
    body = res.json()
    return (body.get("detail") or body)["errors"] if res.status_code == 422 else body["errors"]


# --------------------------------------------------------------------------- normalize


def norm(evaluator: dict, env_ids=("e1",), maximum: int = 20):
    return eval_datasets.normalize({"evaluator": evaluator}, list(env_ids), max_datasets=maximum)


def test_entry_with_version_and_alias_is_invalid():  # QD-71
    _, errors = norm({"datasets": [{"dataset": "a", "version": "v1", "alias": "prod"}, PAIRS[1]]})
    assert errors == [
        {
            "section": "evaluator",
            "pointer": "/evaluator/datasets/0",
            "form_pointer": "/evaluator/datasets/0",
            "field": None,
            "params": {},
            "rule": "datasets_invalid",
            "message": "give a version or an alias, not both",
        }
    ]


@pytest.mark.parametrize(
    "entry",
    [{"dataset": "a", "colour": 1}, {"dataset": "  "}, "a", {"dataset": "a", "version": "v" * 101}, {"dataset": "a", "version": 3}],
)
def test_malformed_entries_are_invalid(entry):  # QD-71
    _, errors = norm({"datasets": [entry, PAIRS[1]]})
    assert [e["rule"] for e in errors] == ["datasets_invalid"]
    assert errors[0]["pointer"] == "/evaluator/datasets/0"


def test_one_entry_collapses_to_the_scalar_form():  # QD-72, QD-D6
    stored, errors = norm({"datasets": [{"dataset": "a", "alias": "prod"}], "run_shape": "combined"})
    assert errors == []
    assert stored["evaluator"] == {"dataset": "a", "config": {"dataset_alias": "prod"}}
    stored, _ = norm({"datasets": [{"dataset": "a", "version": "v2"}]})
    assert stored["evaluator"] == {"dataset": "a", "dataset_version": "v2"}


def test_scalar_only_spec_is_unchanged():  # QD-72
    evaluator = {"dataset": "a", "dataset_version": "v1", "config": {"samples": 2}}
    stored, errors = norm(evaluator)
    assert errors == [] and stored["evaluator"] == evaluator


def test_duplicates_and_limit():  # QD-73
    _, errors = norm({"datasets": [PAIRS[0], PAIRS[1], PAIRS[0]]})
    assert [(e["rule"], e["message"]) for e in errors] == [
        ("datasets_duplicate", "support-tickets v3 is chosen twice.")
    ]
    _, errors = norm({"datasets": [{"dataset": f"d{i}"} for i in range(21)]})
    assert [(e["rule"], e["message"]) for e in errors] == [
        ("datasets_limit", "At most 20 dataset versions per experiment.")
    ]
    _, errors = norm({"datasets": [{"dataset": f"d{i}"} for i in range(4)]}, maximum=3)
    assert errors[0]["message"] == "At most 3 dataset versions per experiment."


def test_scalar_must_equal_entry_zero():  # QD-74
    _, errors = norm({"dataset": "other", "datasets": PAIRS[:2]})
    assert [(e["rule"], e["pointer"], e["message"]) for e in errors] == [
        ("datasets_conflict", "/evaluator/dataset", "evaluator.dataset must equal the first dataset in evaluator.datasets")
    ]
    stored, errors = norm({"dataset": "support-tickets", "datasets": PAIRS[:2]})
    assert errors == []
    assert stored["evaluator"]["dataset_version"] == "v3"


def test_run_shape_rules():  # QD-75
    _, errors = norm({"datasets": PAIRS[:2], "run_shape": "all"})
    assert [e["rule"] for e in errors] == ["run_shape_invalid"]
    _, errors = norm({"datasets": PAIRS[:1], "run_shape": "one_each"})
    assert [e["rule"] for e in errors] == ["run_shape_without_datasets"]
    _, errors = norm({"dataset": "a", "run_shape": "one_each"})
    assert [e["rule"] for e in errors] == ["run_shape_without_datasets"]
    stored, errors = norm({"dataset": "a", "run_shape": "combined"})
    assert errors == [] and "run_shape" not in stored["evaluator"]
    stored, _ = norm({"datasets": PAIRS[:2]})
    assert stored["evaluator"]["run_shape"] == "combined"


def test_task_forms():  # QD-76
    stored, errors = norm({"dataset": "a", "task": "answer-ticket"})
    assert errors == [] and stored["evaluator"]["task"] == "answer-ticket"
    stored, errors = norm({"dataset": "a", "task": {"e1": "answer-ticket", "e2": None}}, ("e1", "e2"))
    assert errors == [] and stored["evaluator"]["task"] == {"e1": "answer-ticket"}
    stored, _ = norm({"dataset": "a", "task": {"e1": None}})
    assert "task" not in stored["evaluator"]
    _, errors = norm({"dataset": "a", "task": {"zzz": "x"}})
    assert [(e["rule"], e["pointer"]) for e in errors] == [("task_unknown_environment", "/evaluator/task/zzz")]
    _, errors = norm({"dataset": "a", "task": "bad id!"})
    assert [e["rule"] for e in errors] == ["task_invalid"]
    _, errors = norm({"dataset": "a", "task": 3})
    assert [e["rule"] for e in errors] == ["task_invalid"]


def test_sweep_rules():  # QD-80
    for evaluator, pointer in (
        ({"datasets": {"sweep": [PAIRS[:2], PAIRS[2:]]}}, "/evaluator/datasets"),
        ({"datasets": PAIRS[:2], "run_shape": {"sweep": ["combined", "one_each"]}}, "/evaluator/run_shape"),
        ({"dataset": {"sweep": ["a", "b"]}, "datasets": PAIRS[:2]}, "/evaluator/dataset"),
        ({"datasets": PAIRS[:2], "dataset_version": {"sweep": ["v1", "v2"]}}, "/evaluator/dataset_version"),
    ):
        _, errors = norm(evaluator)
        assert (errors[0]["rule"], errors[0]["pointer"], errors[0]["message"]) == ("sweep", pointer, SHAPE_ERROR)
    stored, errors = norm({"dataset": "a", "task": {"sweep": ["answer-ticket", "route-ticket"]}})
    assert errors == [] and stored["evaluator"]["task"] == {"sweep": ["answer-ticket", "route-ticket"]}
    _, errors = norm({"dataset": {"sweep": ["a", "b"]}})  # today's scalar sweep stays allowed
    assert errors == []


def test_plan_units_cases():  # section 3.3
    two = {"datasets": PAIRS[:2]}
    assert eval_datasets.plan_units({"dataset": "a"}, accepts_datasets=False)[0] == "single"
    mode, reason, units = eval_datasets.plan_units(two, accepts_datasets=True)
    assert (mode, reason, len(units)) == ("combined", None, 1)
    mode, reason, units = eval_datasets.plan_units(two, accepts_datasets=False)
    assert (mode, reason, [u.index for u in units]) == ("fan_out", "service_without_datasets", [0, 1])
    mode, reason, units = eval_datasets.plan_units({**two, "run_shape": "one_each"}, accepts_datasets=True)
    assert (mode, reason, len(units)) == ("fan_out", "run_shape", 2)


# --------------------------------------------------------------------------- API


def test_single_dataset_launch_is_unchanged(client, session_factory, env):  # QD-72, QD-81
    res = _create(client, [env.id])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["spec"]["evaluator"]["dataset"] == "playground_set_v2"
    assert "datasets" not in body["spec"]["evaluator"] and "run_shape" not in body["spec"]["evaluator"]
    assert body["selection"] == {
        "datasets": [{"dataset": "playground_set_v2", "version": None, "alias": None}],
        "run_shape": None,
        "tasks": {},
    }
    (job,) = _jobs(session_factory, body["id"])
    assert job.dataset_index == 0 and "dataset" not in job.params and "datasets" not in job.params
    assert "datasets" not in job.request_body["evaluator"] and "task" not in job.request_body["evaluator"]
    assert body["jobs"][0]["dataset"] is None and body["jobs"][0]["task"] is None


def test_one_pair_list_is_stored_like_scalars(client, env):  # QD-72
    a = _create(client, [env.id], spec=multi_spec(PAIRS[:1])).json()["spec"]
    b = _create(client, [env.id], spec=multi_spec(None, dataset="support-tickets", dataset_version="v3")).json()["spec"]
    assert a == b


def test_fan_out_counts_and_bodies(client, session_factory, two_envs):  # QD-79, QD-81, QD-82, QD-86
    production, staging = two_envs
    res = _dry(client, [production.id, staging.id], multi_spec(PAIRS))
    body = res.json()
    assert body["ok"], body["errors"]
    assert body["job_count"] == 5
    assert body["datasets_plan"] == [
        {"environment_id": production.id, "environment_name": "production", "mode": "combined", "units": 1, "reason": None},
        {"environment_id": staging.id, "environment_name": "staging", "mode": "fan_out", "units": 4, "reason": "service_without_datasets"},
    ]
    assert len(body["jobs"]) == 5
    assert [j["dataset_index"] for j in body["jobs"] if j["environment_id"] == staging.id] == [0, 1, 2, 3]

    created = _create(client, [production.id, staging.id], spec=multi_spec(PAIRS))
    assert created.status_code == 200, created.text
    detail = created.json()
    assert detail["job_count"] == 5
    assert detail["spec"]["evaluator"]["run_shape"] == "combined"
    assert detail["spec"]["evaluator"]["dataset"] == "support-tickets"
    assert detail["spec"]["evaluator"]["dataset_version"] == "v3"
    jobs = sorted(_jobs(session_factory, detail["id"]), key=lambda j: (j.environment_id != production.id, j.dataset_index))
    combined = jobs[0]
    assert combined.environment_id == production.id
    assert combined.request_body["evaluator"]["datasets"] == [
        {"dataset": "support-tickets", "version": "v3"},
        {"dataset": "support-tickets", "version": "v4"},
        {"dataset": "billing-faq", "version": "v2"},
        {"dataset": "refund-cases"},
    ]
    assert combined.params["datasets"][3] == {"dataset": "refund-cases", "version": None, "alias": None}
    fanned = [j for j in jobs if j.environment_id == staging.id]
    assert [j.dataset_index for j in fanned] == [0, 1, 2, 3]
    assert [j.request_body["evaluator"]["dataset"] for j in fanned] == [
        "support-tickets", "support-tickets", "billing-faq", "refund-cases"
    ]
    assert [j.request_body["evaluator"].get("dataset_version") for j in fanned] == ["v3", "v4", "v2", None]
    assert all("datasets" not in j.request_body["evaluator"] for j in fanned)
    assert fanned[1].params["dataset"] == {"dataset": "support-tickets", "version": "v4", "alias": None}
    assert fanned[1].request_body["evaluator"]["config"]["run_name"].endswith(" · support-tickets v4")
    assert fanned[3].request_body["evaluator"]["config"]["run_name"].endswith(" · refund-cases latest")
    for job in jobs:
        assert "run_shape" not in json.dumps(job.request_body)  # QD-87
        launch = job.request_body["evaluator"]["config"]["run_metadata"]["qym_launch"]
        assert ("dataset_index" in launch) == (job.environment_id == staging.id)
    # qym_config holds the unit's evaluator (QD-83)
    snapshot = fanned[2].request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    assert snapshot["evaluator"]["dataset"] == "billing-faq" and "datasets" not in snapshot["evaluator"]
    combined_cfg = combined.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    assert len(combined_cfg["evaluator"]["datasets"]) == 4 and "run_shape" not in combined_cfg["evaluator"]

    # The detail reports the selection (QD-85)
    assert detail["selection"]["run_shape"] == "combined" and len(detail["selection"]["datasets"]) == 4
    by_index = {(j["environment_id"], j["dataset_index"]): j for j in detail["jobs"]}
    assert by_index[(staging.id, 1)]["dataset"]["version"] == "v4"
    assert by_index[(production.id, 0)]["datasets"][0]["dataset"] == "support-tickets"


def test_one_each_fans_out_everywhere(client, two_envs):  # QD-79
    production, staging = two_envs
    body = _dry(client, [production.id, staging.id], multi_spec(PAIRS, run_shape="one_each")).json()
    assert body["job_count"] == 8
    assert {p["mode"] for p in body["datasets_plan"]} == {"fan_out"}
    assert {p["reason"] for p in body["datasets_plan"]} == {"run_shape"}


def test_sweep_multiplies_units_and_cap(client, session_factory, two_envs, monkeypatch):  # QD-79
    production, staging = two_envs
    spec = multi_spec(PAIRS)
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    assert _dry(client, [production.id, staging.id], spec).json()["job_count"] == 10
    spec["evaluator"]["run_shape"] = "one_each"
    assert _dry(client, [production.id, staging.id], spec).json()["job_count"] == 16
    monkeypatch.setenv("QYM_EVAL_SWEEP_MAX_JOBS", "12")
    dry = _dry(client, [production.id, staging.id], spec)
    assert dry.status_code == 200 and not dry.json()["ok"]
    assert dry.json()["errors"][0]["rule"] == "sweep_cap"
    real = _create(client, [production.id, staging.id], spec=spec)
    assert real.status_code == 422 and real.json()["detail"]["errors"][0]["rule"] == "sweep_cap"
    with session_factory() as db:
        assert db.query(EvalExperimentJob).count() == 0


def test_errors_and_dry_run(client, two_envs):  # QD-84
    production, staging = two_envs
    res = _dry(client, [production.id], multi_spec([{**PAIRS[0], "alias": "x"}, PAIRS[1]]))
    assert res.status_code == 200
    body = res.json()
    assert not body["ok"] and body["jobs"] == []
    assert body["errors"][0]["code"] == "datasets_invalid"
    real = _create(client, [production.id], spec=multi_spec([{**PAIRS[0], "alias": "x"}, PAIRS[1]]))
    assert real.status_code == 422


def test_sweep_of_datasets_is_refused(client, two_envs):  # QD-80
    production, _ = two_envs
    spec = multi_spec(PAIRS[:2])
    spec["evaluator"]["run_shape"] = {"sweep": ["combined", "one_each"]}
    errors = _errors(_dry(client, [production.id], spec))
    assert errors[0]["rule"] == "sweep" and errors[0]["message"] == SHAPE_ERROR


def test_stored_spec_is_intent_not_expansion(client, session_factory, two_envs):  # QD-86
    production, staging = two_envs
    detail = _create(client, [production.id, staging.id], spec=multi_spec(PAIRS)).json()
    stored = detail["spec"]["evaluator"]
    assert len(stored["datasets"]) == 4 and "task" not in stored
    declare(session_factory, staging.id)  # the service later gains the key
    again = client.get(_url(suffix=f"/{detail['id']}"), headers=_headers(MEMBER)).json()
    assert again["spec"] == detail["spec"]


def test_dataset_token_warning_once_per_dataset(client, session_factory, two_envs):  # QD-88
    from qym_platform.db.models import Dataset

    production, staging = two_envs
    with session_factory() as db:
        db.add(Dataset(id="ds-1", project_id=P1, name="billing-faq", slug="billing-faq", private_test_set=True, created_by_user_id="admin-1"))
        db.commit()
    body = _dry(client, [production.id, staging.id], multi_spec(PAIRS)).json()
    warnings = [w for w in body["warnings"] if w["code"] == "dataset_token_not_declared"]
    assert len(warnings) == 1 and "billing-faq" in warnings[0]["message"]


def test_retry_keeps_the_pair_and_supersedes_only_itself(client, session_factory, two_envs):  # QD-59, QD-91, QD-100
    production, staging = two_envs
    detail = _create(client, [staging.id], spec=multi_spec(PAIRS[:3])).json()
    jobs = {j.dataset_index: j for j in _jobs(session_factory, detail["id"])}
    _set_job(session_factory, jobs[1].id, status=EvalJobStatus.FAILED)
    res = client.post(_url(suffix=f"/{detail['id']}/jobs/{jobs[1].id}/retry"), headers=_headers(MEMBER), json={})
    assert res.status_code == 200, res.text
    after = _jobs(session_factory, detail["id"])
    retry = next(j for j in after if j.retry_of_job_id == jobs[1].id)
    assert (retry.dataset_index, retry.attempt, retry.combo_index) == (1, 1, 0)
    assert retry.params["dataset"] == jobs[1].params["dataset"]
    assert retry.request_body["evaluator"]["dataset_version"] == "v4"
    assert retry.request_body["evaluator"]["config"]["run_metadata"]["qym_launch"]["dataset_index"] == 1
    superseded = {j["id"] for j in res.json()["experiment"]["jobs"] if j["superseded"]}
    assert superseded == {jobs[1].id}


def test_queue_order_includes_the_pair():  # QD-92
    from qym_platform.services.eval_queue import dispatch_order

    names = [getattr(c, "name", None) or str(c) for c in dispatch_order()]
    assert "dataset_index" in " ".join(names) and names.index("dataset_index") < names.index("id")


# --------------------------------------------------------------------------- task


def test_task_unsupported_for_a_service_without_it(client, two_envs):  # QD-77
    production, staging = two_envs
    spec = multi_spec(None, dataset="d", task="answer-ticket")
    errors = _errors(_dry(client, [production.id, staging.id], spec))
    mismatch = [e for e in errors if e["rule"] == "task_unsupported"]
    assert [e["environment_id"] for e in mismatch] == [staging.id]
    assert mismatch[0]["message"] == 'Environment "staging" does not offer task selection; clear its task or deselect it.'
    assert mismatch[0]["pointer"] == f"/evaluator/task/{staging.id}"
    object_form = multi_spec(None, dataset="d", task={production.id: "answer-ticket", staging.id: "route-ticket"})
    assert [e["environment_id"] for e in _errors(_dry(client, [production.id, staging.id], object_form)) if e["rule"] == "task_unsupported"] == [staging.id]


def test_task_per_environment_is_sent_and_stored(client, session_factory, two_envs, tasks):  # QD-76, QD-78, QD-81
    production, staging = two_envs
    spec = multi_spec(None, dataset="d", task={production.id: "answer-ticket", staging.id: None})
    detail = _create(client, [production.id, staging.id], spec=spec).json()
    jobs = {j.environment_id: j for j in _jobs(session_factory, detail["id"])}
    assert jobs[production.id].request_body["evaluator"]["task"] == "answer-ticket"
    assert jobs[production.id].params["task"] == {"id": "answer-ticket", "name": "Answer a ticket"}
    assert "task" not in jobs[staging.id].request_body["evaluator"] and "task" not in jobs[staging.id].params
    assert detail["selection"]["tasks"] == {production.id: {"id": "answer-ticket", "name": "Answer a ticket"}, staging.id: None}
    assert tasks.calls == 1  # one call per environment with a task
    one = {j["environment_id"]: j["task"] for j in detail["jobs"]}
    assert one[production.id]["name"] == "Answer a ticket" and one[staging.id] is None


def test_string_task_applies_to_every_environment(client, session_factory, two_envs):  # QD-76
    production, _ = two_envs
    other = _add_env(session_factory, "canary")
    declare(session_factory, other.id)
    detail = _create(client, [production.id, other.id], spec=multi_spec(None, dataset="d", task="route-ticket")).json()
    assert {j.request_body["evaluator"]["task"] for j in _jobs(session_factory, detail["id"])} == {"route-ticket"}


def test_unknown_task_is_an_error(client, two_envs):  # QD-78
    production, _ = two_envs
    errors = _errors(_dry(client, [production.id], multi_spec(None, dataset="d", task="no-such-task")))
    assert [(e["rule"], e["message"]) for e in errors] == [
        ("task_unknown", 'Environment "production" does not list the task "no-such-task".')
    ]


@pytest.mark.parametrize("status", [503, 404, 422])
def test_unverifiable_task_is_a_warning(client, two_envs, tasks, status):  # QD-78, QD-D8
    production, _ = two_envs
    tasks.status = status
    body = _dry(client, [production.id], multi_spec(None, dataset="d", task="route-ticket")).json()
    assert body["ok"], body["errors"]
    assert [w["code"] for w in body["warnings"] if w["code"] == "task_unverified"] == ["task_unverified"]
    created = _create(client, [production.id], spec=multi_spec(None, dataset="d", task="route-ticket"))
    assert created.status_code == 200
    assert created.json()["jobs"][0]["task"] == {"id": "route-ticket", "name": "route-ticket"}


def test_task_sweep_makes_one_job_per_value(client, two_envs):  # QD-80
    production, _ = two_envs
    spec = multi_spec(None, dataset="d", task={production.id: {"sweep": ["answer-ticket", "route-ticket"]}})
    body = _dry(client, [production.id], spec).json()
    assert body["ok"], body["errors"]
    assert body["job_count"] == 2
    assert [j["task"]["id"] for j in body["jobs"]] == ["answer-ticket", "route-ticket"]


def test_rate_limit_and_priority_rules_still_apply(client, two_envs):  # QD-89
    production, _ = two_envs
    res = _create(client, [production.id], spec=multi_spec(PAIRS[:2]), priority="HIGH")
    assert res.status_code in (403, 422)
