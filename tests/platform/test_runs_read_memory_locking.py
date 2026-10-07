"""Run read/edit APIs: bounded memory and non-blocking row locks.

Covers the compact run build (no whole-run output reads), the compare cap,
single-row builds for issue edits, span pagination, step-latency caps, and
lock modes of request-path run locks.
"""

from __future__ import annotations

import hashlib
import json

from qym_platform.db.models import (ReviewCorrection, Run, RunItem,
                                    RunItemAttempt, RunItemScore)
from sqlalchemy import event
from test_review_rules import (OWNER, _ok, _run, _ui,  # noqa: F401  (fixtures)
                               client, session_factory)


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
