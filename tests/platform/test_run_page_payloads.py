"""Rows the run page receives from the real runs API, and what the React run page makes of them.

Replaces the Chromium tests that opened the vanilla run page on these runs
(``test_lost_outcomes_browser.py`` and the run page / Compare halves of
``test_minimize_errors_browser.py``). The server side is asserted here; the rows are pinned with
``share_run_page`` and the numbers the React page derives are asserted in
``frontend/src/features/run-detail/lib/__tests__/cutover-server-payloads.test.ts``.
"""

from __future__ import annotations

import pytest
from _support_a1 import listed_means, runs_api_client, share_run_page
from qym_platform.db.models import (
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
)
from test_dashboard_durable_summaries import run
from test_minimize_errors import LABELED_H, _labeled


def _approx(values):
    return {key: pytest.approx(value, abs=5e-4) for key, value in values.items()}


def _spec(db, run_id, name="q"):
    db.add(
        RunMetricSpec(
            run_id=run_id,
            metric_name=name,
            position=0,
            schema_version=2,
            score_type="percentage",
            direction="maximize",
        )
    )


def _snapshot(client, run_id="run-1"):
    return client.get(f"/api/runs/{run_id}", params={"view": "compact"}).json()[
        "snapshot"
    ]


# ---------------------------------------------------------------- not received


def _not_received_run(db, run_id="run-1"):
    """a and b answered (q 1.0, 0.5). c only started: the platform rejected its
    completion, though its score arrived (q 0.0)."""
    run(
        db,
        run_id=run_id,
        metrics=["q"],
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={
            "total_items": 3,
            "ingest_incomplete": {
                "expected_items": 3,
                "received_items": 3,
                "rejected_events": 2,
            },
        },
    )
    _spec(db, run_id)
    for index, (item_id, score) in enumerate((("a", 1.0), ("b", 0.5), ("c", 0.0))):
        received = item_id != "c"
        db.add(
            RunItem(
                run_id=run_id,
                item_id=item_id,
                index=index,
                input=f"question {item_id}",
                output="answer" if received else None,
                latency_ms=10.0 if received else None,
            )
        )
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id=item_id,
                metric_name="q",
                score_numeric=score,
                meta={},
            )
        )
    db.commit()


def test_item_never_received_has_no_verdict_and_stays_out_of_the_means():
    with runs_api_client(_not_received_run) as client:
        listed = client.get("/api/runs", params={"project_slug": "demo"}).json()
        [row] = [
            r
            for models in listed["tasks"].values()
            for rows in models.values()
            for r in rows
        ]
        assert row["metric_averages"] == _approx({"q": 0.75})
        assert (row["not_received_count"], row["execution_count"]) == (1, 2)
        snapshot = _snapshot(client)
    # The run page shows 3 items, 2 completed, no error, 1 not received; the third reads
    # "Not received" (no verdict) and the means match the runs list.
    share_run_page(
        "lost_not_received_run_page",
        snapshot,
        {
            "means": {"q": 0.75},
            "run_counts": {"total": 3, "completed": 2, "errors": 0, "notReceived": 1},
            "statuses": {"q": {"a": "pass", "b": "fail", "c": "not_received"}},
        },
    )


# ---------------------------------------------------------------- repeat item, failed pass


def _repeat_run(db, failed_pass, run_id="run-1"):
    """samples=3; item x fails ``failed_pass`` (its RunItem holds pass 3)."""
    run(
        db,
        run_id=run_id,
        metrics=["q"],
        samples=3,
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 2, "last_completed_pass": 3},
    )
    _spec(db, run_id)
    for index, item_id in enumerate(("a", "x")):
        failed_last = item_id == "x" and failed_pass == 3
        db.add(
            RunItem(
                run_id=run_id,
                item_id=item_id,
                index=index,
                input=f"question {item_id}",
                output=None if failed_last else "answer",
                error="tool crashed" if failed_last else None,
                latency_ms=10.0,
            )
        )
        values = []
        for number in (1, 2, 3):
            failed = item_id == "x" and number == failed_pass
            score = 0.0 if failed else (1.0 if item_id == "a" else 0.9)
            values.append(score)
            db.add(
                RunItemPassScore(
                    run_id=run_id,
                    item_id=item_id,
                    metric_name="q",
                    pass_number=number,
                    score_numeric=score,
                    label="error" if failed else None,
                    meta={"task_error": True} if failed else {},
                )
            )
            db.add(
                RunItemAttempt(
                    run_id=run_id,
                    item_id=item_id,
                    pass_number=number,
                    attempt_number=1,
                    status="failed" if failed else "completed",
                    error="tool crashed" if failed else None,
                    is_last_attempt=True,
                    latency_ms=10.0,
                    output=None if failed else "answer",
                )
            )
        mean = sum(values) / 3
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id=item_id,
                metric_name="q",
                score_numeric=mean,
                score_raw=mean,
                meta={"sample_reducer": "mean", "samples_observed": 3},
            )
        )
    db.commit()


@pytest.mark.parametrize("failed_pass", [1, 3])
def test_repeat_item_reads_the_same_whichever_pass_failed(failed_pass):
    # x: (0.9 + 0.9 + 0) / 3; the run mean is (1.0 + 0.6) / 2.
    with runs_api_client(lambda db: _repeat_run(db, failed_pass)) as client:
        assert listed_means(client)["run-1"] == _approx({"q": 0.8})
        snapshot = _snapshot(client)
    share_run_page(
        f"lost_repeat_fails_pass_{failed_pass}",
        snapshot,
        {
            "means": {"q": 0.8},
            # the failed pass is one task error across the passes, whichever pass it was
            "error_counts": {"q": [1, 0]},
            "card_notes": {"q": "1 task error across passes"},
        },
        samples=3,
    )


# ---------------------------------------------------------------- error-labeled passes


def test_error_labeled_passes_read_the_same_in_full_and_compact_rows():
    """A scorer's own "error" label with a long reason, nested metadata or only an explanation is a
    judged pass; a failed task is not. Full rows and index rows give the runs list's mean, and the
    platform's task_error flag is never offered as a metric field."""
    with runs_api_client(lambda db: _labeled(db, "run-1")) as client:
        assert listed_means(client)["run-1"] == _approx({"h": LABELED_H})
        views = {
            view: client.get("/api/runs/run-1", params={"view": view}).json()[
                "snapshot"
            ]
            for view in ("full", "compact")
        }
    for view, snapshot in views.items():
        share_run_page(
            f"minimize_labeled_run_{view}",
            snapshot,
            {"means": {"h": LABELED_H}, "meta_keys_exclude": ["task_error"]},
            samples=3,
        )
