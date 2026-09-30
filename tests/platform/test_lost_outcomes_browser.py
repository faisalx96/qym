"""The run page on real source rows: items never received, and repeat items
judged per pass (C024 x C011/C015).

- A completed run's item whose outcome never arrived shows "Not received"
  (no verdict), is counted apart in the overview strip, and is left out of the
  metric cards' means, which match the runs list.
- A repeat item whose task failed on one pass reads the same whichever pass
  failed last: its card flags the failed pass and the metric cards show the
  runs list's means.
"""

import os

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from qym_platform.db.models import (  # noqa: E402
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
)
from test_dashboard_durable_summaries import run  # noqa: E402
from test_minimize_errors_browser import (  # noqa: E402
    _approx,
    _listed_means,
    _run_page_means,
    _runs_api,
)
from test_performance_views_browser import ViewFixture, browser  # noqa: E402,F401

pytestmark = pytest.mark.browser

QUALITY = {"score_type": "percentage", "direction": "maximize", "schema_version": 2}


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


def _not_received_run(db, run_id="run-1"):
    """a and b answered (q 1.0, 0.5). c only started: the platform rejected
    its completion, though its score arrived (q 0.0)."""
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


def test_item_never_received_has_no_verdict_and_stays_out_of_the_means(browser):
    with _runs_api(_not_received_run) as client:
        listed = client.get("/api/runs", params={"project_slug": "demo"}).json()
        [row] = [
            row
            for models in listed["tasks"].values()
            for rows in models.values()
            for row in rows
        ]
        assert row["metric_averages"] == _approx({"q": 0.75})
        assert (row["not_received_count"], row["execution_count"]) == (1, 2)
        fixture = ViewFixture(browser, "run", count=3)
        fixture.api_client = client
        try:
            assert _run_page_means(fixture) == _approx({"q": 0.75})
            page = fixture.page
            strip = page.locator(".overview-summary-strip")
            values = dict(
                zip(
                    strip.locator(".overview-summary-label").all_inner_texts(),
                    strip.locator(".overview-summary-value").all_inner_texts(),
                )
            )
            assert values == {
                "Items": "3",
                "Completed": "2",
                "Errors": "0",
                "Not received": "1",
            }
            pill = strip.locator(".overview-summary-pill.not-received")
            assert "left out of Execution success" in pill.get_attribute("title")
            # The four pills share one row on a wide page.
            tops = page.evaluate(
                "Array.from(document.querySelectorAll('.overview-summary-pill'),"
                " pill => Math.round(pill.getBoundingClientRect().top))"
            )
            assert len(set(tops)) == 1
            cards = page.locator("#items-grid .item-card")
            tags = [cards.nth(index).locator(".qym-tag").inner_text() for index in range(3)]
            assert tags == ["Pass", "Fail", "Not received"]
            # Its score arrived but has no verdict: shown neutral, not red.
            value = cards.nth(2).locator(".metric-score-value")
            assert value.get_attribute("class").split() == ["metric-score-value"]
            assert fixture.errors == []
        finally:
            fixture.close()


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
def test_repeat_item_reads_the_same_whichever_pass_failed(browser, failed_pass):
    # x: (0.9 + 0.9 + 0) / 3; the run mean is (1.0 + 0.6) / 2.
    expected = {"q": 0.8}
    with _runs_api(lambda db: _repeat_run(db, failed_pass)) as client:
        assert _listed_means(client)["run-1"] == _approx(expected)
        fixture = ViewFixture(browser, "run", count=2, samples=3)
        fixture.api_client = client
        try:
            assert _run_page_means(fixture) == _approx(expected)
            page = fixture.page
            card = page.locator('#items-grid .item-card[data-item-id="x"]')
            indicator = card.locator(".item-error-indicator")
            assert indicator.get_attribute("title") == "Task execution failed in 1 pass"
            note = page.locator(".metric-card .metric-card-error-note").inner_text()
            assert "1 task error across passes" in note
            assert fixture.errors == []
        finally:
            fixture.close()
