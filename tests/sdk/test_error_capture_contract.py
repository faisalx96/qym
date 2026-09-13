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
