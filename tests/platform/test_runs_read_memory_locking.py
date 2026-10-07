"""Run read/edit APIs: bounded memory and non-blocking row locks.

Covers the compact run build (no whole-run output reads), the compare cap,
single-row builds for issue edits, span pagination, step-latency caps, and
lock modes of request-path run locks.
"""

from __future__ import annotations

import hashlib
import json

import sqlalchemy.orm
from sqlalchemy import event
from sqlalchemy.dialects import postgresql

from qym_platform.db.models import (
    ReviewCorrection,
    Run,
    RunItem,
    RunItemAttempt,
    RunItemScore,
    RunWorkflowStatus,
)

from test_review_rules import (  # noqa: F401  (fixtures)
    OWNER,
    _ok,
    _run,
    _ui,
    client,
    session_factory,
)


def _capture_statements(session_factory):
    with session_factory() as db:
        engine = db.get_bind()
    statements: list[str] = []

    def capture(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)

    def stop():
        event.remove(engine, "before_cursor_execute", capture)

    return statements, stop


def _repeat_run_with_attempts(db, run_id="rep-att", items=3, samples=2):
    _run(db, run_id, samples=samples)
    for index in range(items):
        item_id = f"it-{index}"
        db.add(
            RunItem(
                run_id=run_id,
                item_id=item_id,
                index=index,
                input={"q": index},
                output={"answer": index},
                latency_ms=5,
                item_metadata={},
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
                explanation="a long explanation " * 50,
            )
        )
        for pass_number in range(1, samples + 1):
            failed = index == 0 and pass_number == 2
            db.add(
                RunItemAttempt(
                    run_id=run_id,
                    item_id=item_id,
                    pass_number=pass_number,
                    attempt_number=1,
                    status="FAILED" if failed else "COMPLETED",
                    error="boom" if failed else None,
                    latency_ms=10.0 * pass_number,
                    is_last_attempt=True,
                    output=None if failed else {"pass": pass_number, "item": index},
                )
            )
    db.add(
        ReviewCorrection(
            run_id=run_id,
            item_id="it-1",
            metric_name=None,
            task="task",
            ai_root_cause="",
            ai_root_causes=[],
            human_root_cause="miss",
            human_root_causes=["miss"],
            input_snapshot={"big": "x" * 1000},
            output_snapshot={"big": "y" * 1000},
            corrected_by_user_id="owner-1",
            is_active=True,
        )
    )
    db.commit()


def _stringified(value):
    return json.dumps(value, indent=2, ensure_ascii=False)


def test_compact_build_keeps_digests_and_reads_outputs_in_batches(
    client, session_factory
):
    with session_factory() as db:
        _repeat_run_with_attempts(db)
    statements, stop = _capture_statements(session_factory)
    try:
        body = _ok(client.get("/api/runs/rep-att?view=compact", headers=_ui(OWNER)))
    finally:
        stop()
    rows = {row["item_id"]: row for row in body["snapshot"]["rows"]}
    for index in range(3):
        attempts = rows[f"it-{index}"]["pass_attempts"]
        for pass_number, attempt in enumerate(attempts, start=1):
            assert "output" not in attempt
            assert attempt["__has_output"] is True
            if index == 0 and pass_number == 2:
                text = "ERROR: boom"
                assert attempt["__execution_error"] == text
            else:
                text = _stringified({"pass": pass_number, "item": index})
                assert attempt["__execution_error"] == ""
            assert attempt["output_digest"] == hashlib.sha256(text.encode()).hexdigest()
    assert rows["it-1"]["review_correction_id"] is not None

    output_reads = [
        s
        for s in statements
        if "FROM run_item_attempts" in s and "run_item_attempts.output" in s
    ]
    # Outputs are read only by attempt id batches, never by a whole-run scan.
    assert output_reads
    assert all("run_item_attempts.id IN" in s for s in output_reads), output_reads
    # The run's attempt rows are scanned once (event state), not twice.
    attempt_scans = [
        s
        for s in statements
        if "FROM run_item_attempts" in s
        and "run_item_attempts.id IN" not in s
        and "run_item_attempts.attempt_number" in s
    ]
    assert len(attempt_scans) == 1, attempt_scans
    # Correction snapshots and score explanations are not loaded.
    assert not any("review_corrections.input_snapshot" in s for s in statements)
    assert not any(
        "FROM run_item_scores" in s and "run_item_scores.explanation AS" in s
        for s in statements
    )


def test_full_build_still_returns_attempt_outputs(client, session_factory):
    with session_factory() as db:
        _repeat_run_with_attempts(db)
    body = _ok(client.get("/api/runs/rep-att", headers=_ui(OWNER)))
    rows = {row["item_id"]: row for row in body["snapshot"]["rows"]}
    attempts = rows["it-2"]["pass_attempts"]
    assert attempts[0]["output"] == _stringified({"pass": 1, "item": 2})
    assert rows["it-0"]["pass_attempts"][1]["output"] == "ERROR: boom"


def test_single_run_explanations_full_and_compact(client, session_factory):
    with session_factory() as db:
        _repeat_run_with_attempts(db, run_id="one", samples=1)
    full = _ok(client.get("/api/runs/one", headers=_ui(OWNER)))
    meta = full["snapshot"]["rows"][1]["metric_meta"]["accuracy"]
    assert meta["explanation"] == "a long explanation " * 50
    assert meta["label"] == "ok"
    compact = _ok(client.get("/api/runs/one?view=compact", headers=_ui(OWNER)))
    meta = compact["snapshot"]["rows"][1]["metric_meta"]["accuracy"]
    # The index keeps no explanation text, only its key for the chooser.
    assert "explanation" not in meta and meta["label"] == "ok"
    assert "explanation" in compact["snapshot"]["metric_meta_keys"]["accuracy"]


def test_compare_refuses_more_runs_than_the_cap(client, session_factory):
    from qym_platform.api.runs import MAX_COMPARE_RUNS

    files = [f"r{index}" for index in range(MAX_COMPARE_RUNS + 1)]
    response = client.get(
        "/api/compare", params={"files": files, "view": "compact"}, headers=_ui(OWNER)
    )
    assert response.status_code == 422, response.text
    assert str(MAX_COMPARE_RUNS) in response.json()["detail"]
    # Repeats of one run count once; a comma list counts each run.
    with session_factory() as db:
        _run(db, "c1")
        _run(db, "c2")
        db.commit()
    body = _ok(
        client.get(
            "/api/compare",
            params={"files": ["c1,c2"] + ["c1"] * MAX_COMPARE_RUNS, "view": "compact"},
            headers=_ui(OWNER),
        )
    )
    assert [run["run"]["run_id"] for run in body["runs"]] == ["c1", "c2"]


def test_root_cause_edit_builds_only_the_edited_item(
    client, session_factory, monkeypatch
):
    import qym_platform.api.runs as runs_api

    with session_factory() as db:
        _run(db, "r1")
        for index in range(2, 5):
            db.add(
                RunItem(
                    run_id="r1",
                    item_id=f"item-{index}",
                    index=index,
                    input={"q": index},
                    output="o",
                    latency_ms=1,
                    item_metadata={},
                )
            )
        db.commit()
    calls = []
    original = runs_api._build_run_data

    def spy(db, run, **kwargs):
        calls.append(kwargs.get("item_ids"))
        return original(db, run, **kwargs)

    monkeypatch.setattr(runs_api, "_build_run_data", spy)
    row = _ok(
        client.post(
            "/api/runs/update_root_cause",
            json={
                "run_id": "r1",
                "item_id": "item-1",
                "metric_name": "accuracy",
                "root_cause_issues": [{"category": "Retrieval miss"}],
            },
            headers=_ui(OWNER),
        )
    )["row"]
    assert calls == [["item-1"]]
    assert row["item_id"] == "item-1"
    assert row["compare_item_id"] == "item-1"
    issues = row["item_metadata"]["metric_analyses"]["accuracy"]["root_cause_issues"]
    assert [issue["category"] for issue in issues] == ["Retrieval miss"]


def test_passes_view_reads_no_attempt_outputs(client, session_factory):
    with session_factory() as db:
        _repeat_run_with_attempts(db)
    statements, stop = _capture_statements(session_factory)
    try:
        body = _ok(client.get("/api/runs/rep-att/passes", headers=_ui(OWNER)))
    finally:
        stop()
    assert body
    assert not any(
        "FROM run_item_attempts" in s and "run_item_attempts.output" in s
        for s in statements
    )


def _spans(db, run_id, count, traces=2):
    from qym_platform.db.models import Span

    for index in range(count):
        db.add(
            Span(
                run_id=run_id,
                trace_id=f"t{index % traces}",
                span_id=f"s{index}",
                name=f"span-{index}",
                start_time_ns=1000 + index,
                attributes={},
            )
        )
    db.commit()


def test_run_spans_are_paginated(client, session_factory):
    with session_factory() as db:
        _run(db, "sp")
        db.commit()
        _spans(db, "sp", 7)
    first = _ok(client.get("/api/runs/sp/spans?limit=3", headers=_ui(OWNER)))
    assert [s["name"] for s in first["spans"]] == ["span-0", "span-1", "span-2"]
    assert first["next_offset"] == 3
    last = _ok(client.get("/api/runs/sp/spans?limit=3&offset=6", headers=_ui(OWNER)))
    assert [s["name"] for s in last["spans"]] == ["span-6"]
    assert last["next_offset"] is None
    # Default page holds every span of a small run.
    whole = _ok(client.get("/api/runs/sp/spans", headers=_ui(OWNER)))
    assert len(whole["spans"]) == 7 and whole["next_offset"] is None
    one_trace = _ok(client.get("/api/runs/sp/spans?trace_id=t1", headers=_ui(OWNER)))
    assert [s["name"] for s in one_trace["spans"]] == ["span-1", "span-3", "span-5"]
    too_many = client.get("/api/runs/sp/spans?limit=5001", headers=_ui(OWNER))
    assert too_many.status_code == 422


def _record_run_locks(monkeypatch):
    """PostgreSQL row-lock clauses of Run queries (SQLite renders none)."""
    locks: list[str] = []
    original = sqlalchemy.orm.Query.with_for_update

    def spy(self, *args, **kwargs):
        query = original(self, *args, **kwargs)
        entity = self.column_descriptions[0].get("entity")
        if entity is Run:
            sql = str(query.statement.compile(dialect=postgresql.dialect()))
            locks.append(sql[sql.rindex("FOR ") :])
        return query

    monkeypatch.setattr(sqlalchemy.orm.Query, "with_for_update", spy)
    return locks


def test_liveness_reconcile_skips_runs_ingestion_holds(
    client, session_factory, monkeypatch
):
    with session_factory() as db:
        _run(db, "stale", status=RunWorkflowStatus.RUNNING)
        db.commit()
    locks = _record_run_locks(monkeypatch)
    body = _ok(client.get("/api/runs/stale/live-status", headers=_ui(OWNER)))
    assert locks == ["FOR NO KEY UPDATE SKIP LOCKED"]
    assert "stopped" in json.dumps(body).lower()
    with session_factory() as db:
        assert db.get(Run, "stale").status == RunWorkflowStatus.STOPPED


def test_delete_and_restore_lock_runs_for_no_key_update(
    client, session_factory, monkeypatch
):
    with session_factory() as db:
        _run(db, "gone")
        db.commit()
    locks = _record_run_locks(monkeypatch)
    _ok(client.post("/api/runs/delete", json={"file_path": "gone"}, headers=_ui(OWNER)))
    _ok(
        client.post(
            "/api/runs/restore",
            json={"run_id": "gone"},
            headers=_ui("admin@example.com"),
        )
    )
    assert locks == ["FOR NO KEY UPDATE", "FOR NO KEY UPDATE"]
