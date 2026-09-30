"""A task failure the database refuses is not a clean result (C024 x C011/C015).

The real SDK streams into the full platform app. A task error whose text the
database refuses (a NUL, on PostgreSQL; emulated on SQLite) makes the platform
reject both item_failed and the item's failed final attempt. The run still
completes, flagged Incomplete. The item has no outcome at all, so it shows as
not received: left out of Execution success and of the means, and not a
success. In a repeat run, the same failure on one pass leaves the pass out.
"""

from __future__ import annotations

import pytest
from sqlalchemy import event
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from qym import Evaluator, InMemoryDataset
from qym.platform import client as client_module
from qym.platform.client import PlatformEventStream
from qym_platform.db.models import Run, RunItem, RunWorkflowStatus
from test_platform_rejected_completion_e2e import (  # noqa: F401
    OWNER,
    TOKEN,
    _drain,
    platform,
)


def _refuse_nul(engine):
    """PostgreSQL refuses NUL in text; SQLite stores it, so refuse it here."""

    def refuse(conn, cursor, statement, parameters, context, executemany):
        values = parameters if isinstance(parameters, (list, tuple)) else [parameters]
        stack = list(values)
        while stack:
            value = stack.pop()
            if isinstance(value, dict):
                stack.extend(value.values())
            elif isinstance(value, (list, tuple)):
                stack.extend(value)
            elif isinstance(value, str) and ("\x00" in value or "\\u0000" in value):
                raise DataError(statement, parameters, Exception("NUL refused"))

    event.listen(engine, "before_cursor_execute", refuse)


def _evaluator(tmp_path, samples):
    calls = {}

    async def task(value):
        # item-1 crashes with text the database refuses: on its only pass,
        # or on the last pass of a repeat run.
        calls[value] = calls.get(value, 0) + 1
        if value == "q1" and calls[value] == samples:
            raise RuntimeError("search crashed \x00")
        return value

    return Evaluator(
        task,
        InMemoryDataset(
            [
                {"id": f"item-{i}", "input": f"q{i}", "expected_output": f"q{i}"}
                for i in range(3)
            ]
        ),
        ["exact_match"],
        samples=samples,
        config={
            "run_name": "lost-failure",
            "task_name": "lost-failure",
            "checkpoint_enabled": False,
            "otel_enabled": False,
            "max_retries": 0,
            "platform_api_key": TOKEN,
            "platform_url": "http://testserver",
            "output_dir": str(tmp_path),
        },
    )


def _runs_page_row(client, run_id):
    ui = {"X-User-Email": OWNER, "Origin": "http://localhost:8000"}
    response = client.get("/api/runs?project_slug=project", headers=ui)
    assert response.status_code == 200, response.text
    [row] = [
        row
        for models in response.json()["tasks"].values()
        for rows in models.values()
        for row in rows
        if row["run_id"] == run_id
    ]
    return row


@pytest.mark.asyncio
async def test_refused_task_failure_leaves_the_item_not_received(
    platform, monkeypatch, tmp_path
):
    engine, client, sent, post = platform
    _refuse_nul(engine)
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)
    evaluator = _evaluator(tmp_path, 1)
    await evaluator.arun(show_tui=False, auto_save=False)

    assert evaluator._platform_stream.rejected_events == 2
    assert evaluator._run_completed is True
    with Session(engine) as db:
        run = db.query(Run).one()
        run_id = run.id
        assert run.status == RunWorkflowStatus.COMPLETED
        rejected = run.run_metadata["ingest_incomplete"]["rejected"]
        assert {row["type"] for row in rejected} == {"item_failed", "item_attempt_finished"}
        item = db.query(RunItem).filter_by(item_id="item-1").one()
        assert (item.error, item.output, item.latency_ms) == (None, None, None)

    for published in (False, True):
        if published:
            _drain(engine)
        row = _runs_page_row(client, run_id)
        assert row["not_received_count"] == 1, published
        assert (row["execution_count"], row["execution_success_count"]) == (2, 2)
        assert row["task_error_count"] == 0
        # item-0 and item-2 match; item-1 is neither a 0 nor a 1.
        assert row["metric_averages"] == {"exact_match": pytest.approx(1.0)}

    ui = {"X-User-Email": OWNER, "Origin": "http://localhost:8000"}
    page = client.get(f"/api/runs/{run_id}", headers=ui).json()
    status = {row["item_id"]: row["status"] for row in page["snapshot"]["rows"]}
    assert status == {"item-0": "completed", "item-1": "not_received", "item-2": "completed"}


@pytest.mark.asyncio
async def test_refused_failure_of_a_repeat_pass_stays_out_of_the_means(
    platform, monkeypatch, tmp_path
):
    engine, client, sent, post = platform
    _refuse_nul(engine)
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)
    evaluator = _evaluator(tmp_path, 2)
    await evaluator.arun(show_tui=False, auto_save=False)

    assert evaluator._platform_stream.rejected_events == 2
    with Session(engine) as db:
        run = db.query(Run).one()
        run_id = run.id
        assert run.status == RunWorkflowStatus.COMPLETED
        assert run.run_metadata["ingest_incomplete"]["rejected_events"] == 2
    _drain(engine)
    row = _runs_page_row(client, run_id)
    # item-1 is its pass 1 only (1.0); nothing says pass 2 failed.
    assert row["metric_averages"] == {"exact_match": pytest.approx(1.0)}
    assert row["task_error_count"] == 0
