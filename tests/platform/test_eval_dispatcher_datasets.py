"""What the dispatcher sends for several dataset versions and a task (QD-98 to QD-100)."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentEvaluatorSchema,
    EvalExperimentJob,
    EvalJobStatus,
)

from test_eval_dispatcher import (  # noqa: F401  (fixtures and helpers)
    _dispatcher,
    _env,
    _job,
    _seed,
    _update_job,
    clock,
    service,
    sessions,
)

V13 = Path(__file__).parent / "fixtures" / "eval_evaluator_schema.json"
V14 = Path(__file__).parent / "fixtures" / "eval_evaluator_schema-v14.json"
LIST = [{"dataset": "support-tickets", "version": "v3"}, {"dataset": "billing-faq"}]


def _declare(sessions, env_id, *, datasets=True, task=True, v14=True):
    schema = json.loads((V14 if v14 else V13).read_text())
    if v14 and not datasets:
        schema["properties"].pop("datasets")
    if v14 and not task:
        schema["properties"].pop("task")
    with sessions() as db:
        row = EvalEnvironmentEvaluatorSchema(
            environment_id=env_id, schema_hash=uuid_hash(), schema_json=schema
        )
        db.add(row)
        db.flush()
        env = db.get(EvalEnvironment, env_id)
        env.current_evaluator_schema_id = row.id
        env.evaluator_schema_status = "available"
        db.commit()


def uuid_hash() -> str:
    from uuid import uuid4

    return uuid4().hex + uuid4().hex


def _with_evaluator(sessions, job_id, **evaluator):
    with sessions() as db:
        job = db.get(EvalExperimentJob, job_id)
        body = copy.deepcopy(job.request_body)
        body["evaluator"].update(evaluator)
        job.request_body = body
        db.commit()


def test_single_dataset_body_is_the_v13_body(sessions, service, clock):  # QD-98
    seed = _seed(sessions)
    _declare(sessions, seed["env_id"], v14=False)
    before = _job(sessions, seed["job_ids"][0]).request_body
    assert _dispatcher(sessions, service, clock).tick() == 1
    evaluator = service.bodies[0]["evaluator"]
    assert "datasets" not in evaluator and "task" not in evaluator and "run_shape" not in evaluator
    assert evaluator["dataset"] == before["evaluator"]["dataset"]


def test_combined_job_sends_the_list_and_the_task(sessions, service, clock):  # QD-98
    seed = _seed(sessions)
    _declare(sessions, seed["env_id"])
    _with_evaluator(sessions, seed["job_ids"][0], datasets=LIST, task="answer-ticket")
    assert _dispatcher(sessions, service, clock).tick() == 1
    evaluator = service.bodies[0]["evaluator"]
    assert evaluator["datasets"] == LIST and evaluator["task"] == "answer-ticket"


def test_run_shape_never_reaches_a_service(sessions, service, clock):  # QD-98
    seed = _seed(sessions)
    _declare(sessions, seed["env_id"])
    _with_evaluator(sessions, seed["job_ids"][0], datasets=LIST, run_shape="combined")
    assert _dispatcher(sessions, service, clock).tick() == 1
    assert "run_shape" not in json.dumps(service.bodies[0])


def test_fanned_out_job_sends_one_pair(sessions, service, clock):  # QD-98, QD-100
    seed = _seed(sessions)
    _declare(sessions, seed["env_id"], v14=False)
    _with_evaluator(sessions, seed["job_ids"][0], dataset="billing-faq", dataset_version="v2")
    _update_job(sessions, seed["job_ids"][0], dataset_index=3)
    assert _dispatcher(sessions, service, clock).tick() == 1
    evaluator = service.bodies[0]["evaluator"]
    assert (evaluator["dataset"], evaluator["dataset_version"]) == ("billing-faq", "v2")
    assert "datasets" not in evaluator


def test_guard_blocks_a_list_the_service_no_longer_declares(sessions, service, clock):  # QD-99
    seed = _seed(sessions)
    _declare(sessions, seed["env_id"], v14=False)
    _with_evaluator(sessions, seed["job_ids"][0], datasets=LIST)
    assert _dispatcher(sessions, service, clock).tick() == 1
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.BLOCKED
    assert job.wait_reason == "The Evaluation Service no longer accepts datasets; launch again"
    assert service.bodies == [] and service.submitted_job_ids == []


def test_guard_blocks_a_task_the_service_no_longer_declares(sessions, service, clock):  # QD-99
    seed = _seed(sessions)
    _declare(sessions, seed["env_id"], task=False)
    _with_evaluator(sessions, seed["job_ids"][0], task="answer-ticket")
    _dispatcher(sessions, service, clock).tick()
    job = _job(sessions, seed["job_ids"][0])
    assert job.status == EvalJobStatus.BLOCKED
    assert job.wait_reason == "The Evaluation Service no longer accepts task; launch again"
    assert service.bodies == []


def test_a_job_with_no_stored_schema_and_a_task_is_blocked(sessions, service, clock):  # QD-99
    seed = _seed(sessions)
    _with_evaluator(sessions, seed["job_ids"][0], task="answer-ticket")
    _dispatcher(sessions, service, clock).tick()
    assert _job(sessions, seed["job_ids"][0]).status == EvalJobStatus.BLOCKED
