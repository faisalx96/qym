"""``dataset_index`` on SQLite and PostgreSQL (QD-90 to QD-92, QD-100)."""

from __future__ import annotations

import copy
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from qym_platform.db.models import EvalExperimentJob, EvalJobStatus
from qym_platform.services.eval_experiments import superseded_job_ids

from test_eval_dispatcher import (  # noqa: F401  (fixtures and helpers)
    T0,
    _dispatcher,
    _env,
    _seed,
    clock,
    service,
    sessions,
)


def _add_pair(sessions, seed, index, *, attempt=0, retry_of=None, created=0):
    with sessions() as db:
        first = db.get(EvalExperimentJob, seed["job_ids"][0])
        job_id = str(uuid4())
        db.add(
            EvalExperimentJob(
                id=job_id,
                experiment_id=first.experiment_id,
                environment_id=first.environment_id,
                combo_index=first.combo_index,
                dataset_index=index,
                attempt=attempt,
                retry_of_job_id=retry_of,
                schema_id=first.schema_id,
                params={"dataset": {"dataset": f"d{index}"}},
                request_body=copy.deepcopy(first.request_body),
                created_at=T0 + timedelta(seconds=created),
                updated_at=T0,
            )
        )
        db.commit()
        return job_id


def test_pairs_of_one_combination_coexist_and_cannot_repeat(sessions):  # QD-90, QD-102
    seed = _seed(sessions)
    _add_pair(sessions, seed, 1)
    _add_pair(sessions, seed, 2)
    _add_pair(sessions, seed, 1, attempt=1)
    with pytest.raises(IntegrityError):
        _add_pair(sessions, seed, 2)
    with pytest.raises(IntegrityError):
        _add_pair(sessions, seed, -1)


def test_a_retry_supersedes_only_its_own_pair(sessions):  # QD-91
    seed = _seed(sessions)
    one = _add_pair(sessions, seed, 1)
    two = _add_pair(sessions, seed, 2)
    retry = _add_pair(sessions, seed, 1, attempt=1, retry_of=one)
    with sessions() as db:
        jobs = db.query(EvalExperimentJob).all()
        assert superseded_job_ids(jobs) == {one}
        by_id = {j.id: j for j in jobs}
        assert by_id[retry].dataset_index == by_id[one].dataset_index == 1
        assert by_id[two].dataset_index == 2


def test_dispatch_order_follows_dataset_index(sessions, service, clock):  # QD-92
    seed = _seed(sessions)
    ids = {i: _add_pair(sessions, seed, i) for i in (3, 1, 2)}
    claimed = _dispatcher(sessions, service, clock, batch=10).claim()
    # Same created_at and combination: the pair index orders the rest.
    order = [j for j in claimed if j in ids.values()]
    assert order == [ids[1], ids[2], ids[3]]
