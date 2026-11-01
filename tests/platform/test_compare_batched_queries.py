"""GET /api/compare loads its runs with batched queries (C008).

The compare once built each run with its own 14-24 queries, so a 20-run
compare ran hundreds of statements. These tests count the SQL statements of a
compare of 2 and of 6 runs: the count must not grow with the run count. They
also check that the payload sends each row's trace stats once.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event

from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Project,
    ReviewCorrection,
    Run,
    RunEvent,
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunOrigin,
    RunTraceAggregate,
    RunWorkflowStatus,
)

from test_review_rules import (  # noqa: F401  (fixtures)
    ENDED_AT,
    OWNER,
    _ok,
    _ui,
    client,
    session_factory,
)

ITEMS = 3
SAMPLES = 3
TRACE_STATS = {"tokens": 120, "cost": 0.01, "tool_errors": 1, "llm_calls": 2}


def _experiment(db):
    env = EvalEnvironment(
        project_id="project-1", name="env", base_url="https://env.example"
    )
    db.add(env)
    db.flush()
    schema = EvalEnvironmentSchema(
        environment_id=env.id, schema_hash="hash", schema_json={}
    )
    experiment = EvalExperiment(
        project_id="project-1",
        created_by_user_id="admin-1",
        name="sweep",
        environment_ids=[env.id],
        base_source={},
        spec={},
        job_count=1,
    )
    db.add_all([schema, experiment])
    db.flush()
    return env, schema, experiment


def _official_run(db, run_id, combo, env, schema, experiment):
    """A classic run launched by an experiment job (Experiment panel)."""
    job = EvalExperimentJob(
        experiment_id=experiment.id,
        environment_id=env.id,
        combo_index=combo,
        schema_id=schema.id,
        params={},
        request_body={},
        status=EvalJobStatus.SUCCEEDED,
    )
    db.add(job)
    db.flush()
    launch = {
        "experiment_id": experiment.id,
        "job_id": job.id,
        "environment_id": env.id,
    }
    _add_run(
        db,
        run_id,
        samples=1,
        origin=RunOrigin.OFFICIAL,
        experiment_job_id=job.id,
        run_metadata={"qym_launch": launch, "trace_stats": {"has_spans": True}},
    )
    for index in range(ITEMS):
        item_id = f"it-{index}"
        metadata = {"trace_stats": dict(TRACE_STATS), "topic": "a"}
        if index:
            metadata["task_started_at_ms"] = 1_000 + index
        _add_item(db, run_id, index, metadata)
    # The item without task_started_at_ms reads its item_started event.
    db.add(
        RunEvent(
            run_id=run_id,
            event_id=f"{run_id}-started-0",
            sequence=1,
            type="item_started",
            sent_at=ENDED_AT - timedelta(minutes=4),
            payload={"item_id": "it-0"},
        )
    )


def _repeat_run(db, run_id):
    """A repeat run with a traced final attempt for every pass."""
    _add_run(db, run_id, samples=SAMPLES, run_metadata={"last_completed_pass": SAMPLES})
    for index in range(ITEMS):
        item_id = f"it-{index}"
        metadata = {"trace_stats": dict(TRACE_STATS), "task_started_at_ms": 1_000}
        _add_item(db, run_id, index, metadata)
        for number in range(1, SAMPLES + 1):
            trace_id = f"{run_id}-{item_id}-p{number}"
            db.add(
                RunItemPassScore(
                    run_id=run_id,
                    item_id=item_id,
                    metric_name="accuracy",
                    pass_number=number,
                    score_numeric=float(number % 2),
                    explanation=f"pass {number} judge",
                    meta={},
                )
            )
            db.add(
                RunItemAttempt(
                    run_id=run_id,
                    item_id=item_id,
                    pass_number=number,
                    attempt_number=1,
                    status="COMPLETED",
                    latency_ms=10.0 * number,
                    trace_id=trace_id,
                    is_last_attempt=True,
                    output={"pass": number, "item": index},
                )
            )
            db.add(
                RunTraceAggregate(
                    run_id=run_id,
                    trace_id=trace_id,
                    span_count=3,
                    tokens=50 * number,
                    tool_errors=number - 1,
                    provider_errors=1 if number == SAMPLES else 0,
                    raw_bucket={},
                )
            )


def _add_run(db, run_id, *, samples, run_metadata, project_id="project-1", **extra):
    db.add(
        Run(
            id=run_id,
            project_id=project_id,
            created_by_user_id="owner-1",
            owner_user_id="owner-1",
            task="task",
            dataset="dataset",
            metrics=["accuracy"],
            run_metadata=run_metadata,
            run_config={"run_name": f"Run {run_id}"},
            samples=samples,
            status=RunWorkflowStatus.COMPLETED,
            started_at=ENDED_AT - timedelta(minutes=5),
            ended_at=ENDED_AT,
            last_event_at=ENDED_AT,
            **extra,
        )
    )
    db.flush()
    db.add(
        RunMetricSpec(
            run_id=run_id, metric_name="accuracy", position=0, score_type="number"
        )
    )


def _add_item(db, run_id, index, metadata):
    item_id = f"it-{index}"
    db.add(
        RunItem(
            run_id=run_id,
            item_id=item_id,
            index=index,
            input={"q": index},
            expected="yes",
            output={"answer": index},
            latency_ms=5,
            item_metadata=metadata,
        )
    )
    db.add(
        RunItemScore(
            run_id=run_id,
            item_id=item_id,
            metric_name="accuracy",
            score_numeric=1.0,
            score_raw=1.0,
            meta={"reason": "short"},
            label="ok",
            explanation="a long explanation " * 20,
        )
    )
    if index == 1:
        db.add(
            ReviewCorrection(
                run_id=run_id,
                item_id=item_id,
                metric_name="accuracy",
                task="task",
                ai_root_cause="",
                ai_root_causes=[],
                human_root_cause="miss",
                human_root_causes=["miss"],
                corrected_by_user_id="owner-1",
                is_active=True,
            )
        )


def _seed(session_factory, count):
    """``count`` runs: even ones are official classic runs, odd ones repeat runs."""
    with session_factory() as db:
        env, schema, experiment = _experiment(db)
        run_ids = []
        for number in range(count):
            run_id = f"cmp-{number}"
            if number % 2:
                _repeat_run(db, run_id)
            else:
                _official_run(db, run_id, number, env, schema, experiment)
            run_ids.append(run_id)
        db.commit()
    return run_ids


def _compare(client, session_factory, run_ids):
    """The compare payload and every SQL statement it ran."""
    with session_factory() as db:
        engine = db.get_bind()
    statements: list[str] = []

    def capture(conn, cursor, statement, params, context, executemany):  # noqa: ANN001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        body = _ok(
            client.get(
                "/api/compare",
                params=[("files", run_id) for run_id in run_ids]
                + [("view", "compact")],
                headers=_ui(OWNER),
            )
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    return body, statements


def _tables(statements):
    """Statement count per first table read, for a readable failure message."""
    counts: Counter = Counter()
    for statement in statements:
        words = statement.split()
        table = words[words.index("FROM") + 1] if "FROM" in words else words[0]
        counts[table] += 1
    return dict(counts)


def test_compare_statement_count_does_not_grow_with_the_run_count(
    client, session_factory
):
    run_ids = _seed(session_factory, 6)
    two, two_statements = _compare(client, session_factory, run_ids[:2])
    six, six_statements = _compare(client, session_factory, run_ids)

    assert [run["run"]["run_id"] for run in two["runs"]] == run_ids[:2]
    assert [run["run"]["run_id"] for run in six["runs"]] == run_ids
    assert len(six_statements) == len(two_statements), (
        _tables(two_statements),
        _tables(six_statements),
    )
    # The exit criterion of C008: a compare runs fewer than 30 statements.
    assert len(six_statements) < 30, _tables(six_statements)


def test_a_liveness_commit_does_not_reload_the_runs_one_by_one(
    client, session_factory, monkeypatch
):
    from qym_platform.api import runs as runs_api

    run_ids = _seed(session_factory, 6)

    def committing(db, runs):
        # What the liveness check does when a RUNNING run turns out to be live:
        # the commit expires every loaded run.
        db.commit()

    monkeypatch.setattr(runs_api, "_reconcile_run_liveness", committing)
    _, two_statements = _compare(client, session_factory, run_ids[:2])
    _, six_statements = _compare(client, session_factory, run_ids)
    assert len(six_statements) == len(two_statements), (
        _tables(two_statements),
        _tables(six_statements),
    )


def test_each_compared_run_matches_its_own_run_page_build(client, session_factory):
    from qym_platform.api.runs import _send_compare_trace_stats_once

    run_ids = _seed(session_factory, 6)
    body, _ = _compare(client, session_factory, run_ids)
    for compared in body["runs"]:
        run_id = compared["run"]["run_id"]
        alone = _ok(client.get(f"/api/runs/{run_id}?view=compact", headers=_ui(OWNER)))
        # Built with the other runs, each run gets the rows it gets alone,
        # less the trace stats only the compare drops.
        _send_compare_trace_stats_once(alone)
        assert compared == alone, run_id


def test_compare_rows_send_their_trace_stats_once(client, session_factory):
    run_ids = _seed(session_factory, 2)
    body, _ = _compare(client, session_factory, run_ids)
    official, repeat = body["runs"]
    for row in official["snapshot"]["rows"] + repeat["snapshot"]["rows"]:
        # The row keeps its trace stats; the metadata copy is gone.
        assert row["trace_stats"] == TRACE_STATS
        assert "trace_stats" not in row["item_metadata"]
    assert official["snapshot"]["rows"][0]["item_metadata"] == {"topic": "a"}
    # A pass attempt keeps the trace error counts a pass column reads; a finished
    # run's index leaves out the zero counts (C084), which the page reads as 0.
    attempts = repeat["snapshot"]["rows"][0]["pass_attempts"]
    assert [attempt["trace_stats"] for attempt in attempts] == [
        {},
        {"tool_errors": 1},
        {"tool_errors": 2, "provider_errors": 1},
    ]
    # The run page still gets every copy.
    page = _ok(client.get(f"/api/runs/{run_ids[1]}?view=compact", headers=_ui(OWNER)))
    row = page["snapshot"]["rows"][0]
    assert row["item_metadata"]["trace_stats"] == TRACE_STATS
    assert row["pass_attempts"][1]["trace_stats"]["tokens"] == 100


def test_runs_over_the_batch_budget_build_in_batches_with_the_same_payload(
    client, session_factory, monkeypatch
):
    from qym_platform.api import runs as runs_api

    run_ids = _seed(session_factory, 4)
    together, together_statements = _compare(client, session_factory, run_ids)
    # A repeat run has ITEMS x SAMPLES item passes: each run is a batch of its own.
    monkeypatch.setattr(runs_api, "_RUN_BUILD_BATCH_ITEM_PASSES", ITEMS * SAMPLES)
    batched, batched_statements = _compare(client, session_factory, run_ids)
    assert batched == together
    assert len(batched_statements) > len(together_statements)


def test_compare_lists_the_runs_the_caller_cannot_get_in_request_order(
    client, session_factory
):
    run_ids = _seed(session_factory, 2)
    with session_factory() as db:
        db.add(
            Project(
                id="project-2", name="Other", slug="other", created_by_user_id="admin-1"
            )
        )
        db.flush()
        _add_run(db, "hidden", samples=1, run_metadata={}, project_id="project-2")
        _add_run(db, "deleted", samples=1, run_metadata={}, deleted_at=ENDED_AT)
        db.commit()
    body, _ = _compare(
        client, session_factory, ["hidden", run_ids[0], "nope", "deleted", run_ids[1]]
    )
    assert [run["run"]["run_id"] for run in body["runs"]] == run_ids
    assert body["missing_runs"] == [
        {"run_id": "hidden"},
        {"run_id": "nope"},
        {"run_id": "deleted"},
    ]


def test_a_live_compared_run_carries_its_live_revision(client, session_factory):
    run_ids = _seed(session_factory, 2)
    now = datetime.utcnow()
    with session_factory() as db:
        run = db.get(Run, run_ids[0])
        run.status = RunWorkflowStatus.RUNNING
        run.ended_at = None
        run.last_event_at = now
        db.add(
            RunEvent(
                run_id=run.id,
                event_id="heartbeat-9",
                sequence=9,
                type="heartbeat",
                sent_at=now,
                payload={},
            )
        )
        db.commit()
    body, _ = _compare(client, session_factory, run_ids)
    live = _ok(client.get(f"/api/runs/{run_ids[0]}/live-status", headers=_ui(OWNER)))
    assert live["live"] is True
    assert body["runs"][0]["run"]["live_revision"] == live["revision"]
    assert live["revision"].endswith("|9")
    assert "live_revision" not in body["runs"][1]["run"]
