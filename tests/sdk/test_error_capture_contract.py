from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock

from qym import Evaluator
from qym.core.evaluator import ItemSpans


@dataclass
class _Item:
    id: str
    input: str
    expected_output: str
    metadata: dict[str, Any] = field(default_factory=dict)


class _ErrorDataset:
    name = "task-and-metric-error-contract"

    def get_items(self) -> list[_Item]:
        return [
            _Item("task-error-item", "task-error", "ok"),
            _Item("metric-error-item", "metric-error", "ok"),
        ]


def test_task_and_metric_exceptions_are_caught_separately(monkeypatch) -> None:
    """Task errors enter result.errors; metric errors become scored results."""
    for name in (
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "QYM_API_KEY",
        "QYM_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)

    task_attempts = {"task-error": 0, "metric-error": 0}
    metric_calls = {"task-error": 0, "metric-error": 0}

    def task(value: str) -> str:
        task_attempts[value] += 1
        if value == "task-error":
            raise RuntimeError("task exploded")
        return "ok"

    def failing_metric(output: str, expected: str, input_data: str) -> float:
        del output, expected
        metric_calls[input_data] += 1
        raise ValueError("metric exploded")

    evaluator = Evaluator(
        task=task,
        dataset=_ErrorDataset(),
        metrics=[failing_metric],
        config={
            "run_name": "task-and-metric-error-contract",
            "task_name": "task",
            "max_concurrency": 1,
            "max_retries": 1,
            "metric_max_retries": 2,
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )

    result = asyncio.run(evaluator.arun(show_tui=False, auto_save=False))

    assert task_attempts == {"task-error": 2, "metric-error": 1}
    assert metric_calls == {"task-error": 0, "metric-error": 1}

    assert "task-error-item" in result.errors
    assert (
        "RuntimeError: task exploded"
        in result.errors["task-error-item"]["error"]
    )
    assert "task-error-item" not in result.results

    metric_item = result.results["metric-error-item"]
    metric_error = metric_item["scores"]["failing_metric"]
    assert metric_item["success"] is True
    assert metric_error["score"] == 0
    assert metric_error["error"] == "metric exploded"
    assert "ValueError: metric exploded" in metric_error["traceback"]
    assert "metric-error-item" not in result.errors


def test_sync_and_async_metric_exceptions_are_reported_as_errors(monkeypatch) -> None:
    """Every metric exception reaches the platform and TUI as Error, not Fail."""
    for name in (
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "QYM_API_KEY",
        "QYM_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)

    def sync_metric(output: str, expected: str) -> float:
        del output, expected
        raise ValueError("sync metric exploded")

    async def async_metric(output: str, expected: str) -> float:
        del output, expected
        raise RuntimeError("async metric exploded")

    item = _Item("metric-error-item", "metric-error", "ok")

    for metric in (sync_metric, async_metric):
        evaluator = Evaluator(
            task=lambda value: value,
            dataset=_ErrorDataset(),
            metrics=[metric],
            config={
                "run_name": "metric-error-reporting-contract",
                "metric_max_retries": 2,
                "checkpoint_enabled": False,
                "otel_enabled": False,
            },
        )
        evaluator._platform_stream = MagicMock()

        metric_name, raw_score = asyncio.run(
            evaluator._run_single_metric(
                metric.__name__,
                metric,
                "ok",
                "ok",
                0,
                item,
                ItemSpans(),
                {},
            )
        )

        assert metric_name == metric.__name__
        assert raw_score["score"] == 0
        assert "exploded" in raw_score["error"]
        assert "exploded" in raw_score["traceback"]

        emitted = evaluator._platform_stream.emit.call_args_list
        metric_events = [
            call.args for call in emitted if call.args[0] == "metric_scored"
        ]
        assert len(metric_events) == 1
        payload = metric_events[0][1]
        assert payload["score_numeric"] == 0
        assert payload["meta"]["status"] == "error"
        assert "exploded" in payload["meta"]["error"]
        assert "exploded" in payload["meta"]["traceback"]

        tracker = MagicMock()
        spans = ItemSpans(trace_id="trace-id", trace_url="trace-url")
        evaluator._update_tracker(
            0,
            item,
            "ok",
            {metric_name: raw_score},
            0.1,
            0,
            spans,
            tracker,
        )
        tracker.set_metric_error.assert_called_once_with(0, metric_name)
        tracker.update_metric.assert_not_called()


def _run_metric(metric, *, output="ok"):
    evaluator = Evaluator(
        task=lambda value: value,
        dataset=_ErrorDataset(),
        metrics=[metric],
        config={
            "run_name": "metric-reason-contract",
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )
    evaluator._platform_stream = MagicMock()
    item = _Item("reason-item", "reason", "ok")
    metric_name, raw_score = asyncio.run(
        evaluator._run_single_metric(
            metric.__name__, metric, output, "ok", 0, item, ItemSpans(), {}
        )
    )
    events = [
        call.args[1]
        for call in evaluator._platform_stream.emit.call_args_list
        if call.args[0] == "metric_scored"
    ]
    tracker = MagicMock()
    evaluator._update_tracker(
        0, item, output, {metric_name: raw_score}, 0.1, 0, ItemSpans(), tracker
    )
    return events, tracker


def test_verdict_reason_is_a_scored_zero_not_a_metric_error(monkeypatch) -> None:
    """C010: a reason in metadata (even under "error") is a judged 0."""
    for name in ("QYM_API_KEY", "QYM_BASE_URL"):
        monkeypatch.delenv(name, raising=False)

    def valid_sql(output: str, expected: str) -> dict:
        del output, expected
        return {"score": 0.0, "metadata": {"is_valid": False, "error": "syntax error"}}

    events, tracker = _run_metric(valid_sql)
    assert len(events) == 1
    assert "status" not in events[0]["meta"]
    assert events[0]["meta"]["error"] == "syntax error"
    tracker.set_metric_error.assert_not_called()
    tracker.update_metric.assert_called_once()


def test_declared_error_status_is_reported_as_metric_error(monkeypatch) -> None:
    """A metric (or judge) that returns status="error" failed to score."""
    from qym.metrics.result import MetricResult

    for name in ("QYM_API_KEY", "QYM_BASE_URL"):
        monkeypatch.delenv(name, raising=False)

    def judge(output: str, expected: str) -> MetricResult:
        del output, expected
        return MetricResult(
            score=0.0, kind="llm", metadata={"status": "error", "error": "429"}
        )

    events, tracker = _run_metric(judge)
    assert events[0]["meta"]["status"] == "error"
    assert events[0]["score_numeric"] == 0.0
    tracker.set_metric_error.assert_called_once_with(0, "judge")
    tracker.update_metric.assert_not_called()


def test_declared_error_status_records_a_score_of_zero(monkeypatch) -> None:
    """A scorer error scores 0 whatever score the metric returned with its
    error status, as a raised metric does: the platform counts the stored
    score, and a mean must not rise (nor a pass count) from a failed scorer.
    The local stats read it the same way (score_outcome)."""
    from qym.core.results import score_outcome
    from qym.metrics.result import MetricResult

    for name in ("QYM_API_KEY", "QYM_BASE_URL"):
        monkeypatch.delenv(name, raising=False)

    def judge(output: str, expected: str) -> MetricResult:
        del output, expected
        return MetricResult(score=0.95, kind="llm", metadata={"status": "failed"})

    def timed(output: str, expected: str) -> dict:
        del output, expected
        return {"score": 0.9, "metadata": {"status": "timeout"}}

    for metric, status in ((judge, "error"), (timed, "timeout")):
        evaluator = Evaluator(
            task=lambda value: value,
            dataset=_ErrorDataset(),
            metrics=[metric],
            config={
                "run_name": "declared-status-zero",
                "checkpoint_enabled": False,
                "otel_enabled": False,
            },
        )
        evaluator._platform_stream = MagicMock()
        item = _Item("status-item", "status", "ok")
        _, stored = asyncio.run(
            evaluator._run_single_metric(
                metric.__name__, metric, "ok", "ok", 0, item, ItemSpans(), {}
            )
        )
        [event] = [
            call.args[1]
            for call in evaluator._platform_stream.emit.call_args_list
            if call.args[0] == "metric_scored"
        ]
        assert event["meta"]["status"] == status
        assert (event["score_numeric"], event["score_value"]) == (0.0, 0)
        assert event["score_raw"]["score"] == 0.0
        assert score_outcome(stored) == (None, True)
