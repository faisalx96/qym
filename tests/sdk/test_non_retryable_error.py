from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from qym import BusinessRuleError, Evaluator, NonRetryableError


@dataclass
class _Item:
    id: str
    input: str
    expected_output: str
    metadata: dict[str, Any] = field(default_factory=dict)


class _Dataset:
    name = "non-retryable-error-contract"

    def __init__(self, item: _Item) -> None:
        self._item = item

    def get_items(self) -> list[_Item]:
        return [self._item]


def _clear_remote_configuration(monkeypatch) -> None:
    for name in (
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "QYM_API_KEY",
        "QYM_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)


def test_business_rule_error_is_a_public_non_retryable_error() -> None:
    assert issubclass(BusinessRuleError, NonRetryableError)


def test_task_business_rule_error_is_not_retried(monkeypatch) -> None:
    _clear_remote_configuration(monkeypatch)
    calls = {"task": 0, "metric": 0}

    def task(value: str) -> str:
        del value
        calls["task"] += 1
        raise BusinessRuleError("Customer is not eligible")

    def metric(output: str, expected: str) -> float:
        del output, expected
        calls["metric"] += 1
        return 1.0

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(_Item("task-business-error", "question", "answer")),
        metrics=[metric],
        config={
            "run_name": "task-business-rule-error",
            "max_retries": 5,
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )

    result = asyncio.run(evaluator.arun(show_tui=False, auto_save=False))

    assert calls == {"task": 1, "metric": 0}
    assert "task-business-error" in result.errors
    assert (
        result.errors["task-business-error"]["error"]
        == "BusinessRuleError: Customer is not eligible"
    )
    assert "task-business-error" not in result.results


def test_metric_business_rule_error_is_not_retried(monkeypatch) -> None:
    _clear_remote_configuration(monkeypatch)
    calls = {"task": 0, "metric": 0}

    def task(value: str) -> str:
        calls["task"] += 1
        return value

    def metric(output: str, expected: str) -> float:
        del output, expected
        calls["metric"] += 1
        raise BusinessRuleError("Answer violates the policy")

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(_Item("metric-business-error", "answer", "answer")),
        metrics=[metric],
        config={
            "run_name": "metric-business-rule-error",
            "metric_max_retries": 5,
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )

    result = asyncio.run(evaluator.arun(show_tui=False, auto_save=False))

    assert calls == {"task": 1, "metric": 1}
    assert "metric-business-error" not in result.errors
    metric_result = result.results["metric-business-error"]["scores"]["metric"]
    assert metric_result["score"] == 0
    assert metric_result["error"] == "Answer violates the policy"
    assert "BusinessRuleError: Answer violates the policy" in metric_result["traceback"]


def test_async_task_business_rule_error_is_not_retried(monkeypatch) -> None:
    _clear_remote_configuration(monkeypatch)
    task_calls = 0

    async def task(value: str) -> str:
        nonlocal task_calls
        del value
        task_calls += 1
        raise BusinessRuleError("Async task business rule")

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(_Item("async-task-business-error", "question", "answer")),
        metrics=[],
        config={
            "run_name": "async-task-business-rule-error",
            "max_retries": 5,
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )

    result = asyncio.run(evaluator.arun(show_tui=False, auto_save=False))

    assert task_calls == 1
    assert "async-task-business-error" in result.errors


def test_async_metric_business_rule_error_is_not_retried(monkeypatch) -> None:
    _clear_remote_configuration(monkeypatch)
    metric_calls = 0

    async def metric(output: str, expected: str) -> float:
        nonlocal metric_calls
        del output, expected
        metric_calls += 1
        raise BusinessRuleError("Async metric business rule")

    evaluator = Evaluator(
        task=lambda value: value,
        dataset=_Dataset(_Item("async-metric-business-error", "answer", "answer")),
        metrics=[metric],
        config={
            "run_name": "async-metric-business-rule-error",
            "metric_max_retries": 5,
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )

    result = asyncio.run(evaluator.arun(show_tui=False, auto_save=False))

    assert metric_calls == 1
    metric_result = result.results["async-metric-business-error"]["scores"][
        "metric"
    ]
    assert metric_result["score"] == 0
    assert metric_result["error"] == "Async metric business rule"


def test_ordinary_task_exception_still_uses_retry_policy(monkeypatch) -> None:
    _clear_remote_configuration(monkeypatch)
    task_calls = 0

    def task(value: str) -> str:
        nonlocal task_calls
        del value
        task_calls += 1
        raise RuntimeError("Temporary service failure")

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(_Item("technical-error", "question", "answer")),
        metrics=[],
        config={
            "run_name": "technical-error-still-retries",
            "max_retries": 1,
            "checkpoint_enabled": False,
            "otel_enabled": False,
        },
    )

    result = asyncio.run(evaluator.arun(show_tui=False, auto_save=False))

    assert task_calls == 2
    assert "technical-error" in result.errors
