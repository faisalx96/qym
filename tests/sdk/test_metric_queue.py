"""Metrics run in their own queue, separate from task execution.

A task worker hands a finished output to the metric queue and immediately
takes the next item; metric workers (``metric_concurrency`` /
``QYM_METRIC_CONCURRENCY``) score the outputs. These tests pin that tasks are
never blocked by metrics, that metric concurrency is bounded, and that
results, progress, checkpoints and repeat passes still come out complete.
"""

from __future__ import annotations

import asyncio
import csv
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import pytest

from qym import Evaluator
from qym.core.config import EvaluatorConfig
from qym.core.evaluator import ItemSpans, _resolve_metric_concurrency
from qym.core.observers import EvaluationObserver


@dataclass
class _Item:
    id: str
    input: str
    expected_output: str
    metadata: Dict[str, Any] = field(default_factory=dict)


class _Dataset:
    name = "metric-queue"

    def __init__(self, n: int):
        self._items = [_Item(f"item-{i}", f"q{i}", f"q{i}") for i in range(n)]

    def get_items(self) -> List[_Item]:
        return list(self._items)


class _Recorder(EvaluationObserver):
    def __init__(self) -> None:
        self.metric_results: List[tuple] = []
        self.completed: Dict[int, Dict[str, Any]] = {}
        self.order: List[tuple] = []
        self.passes: List[Dict[str, Any]] = []

    def on_metric_result(self, *, item_index, metric_name, **kwargs) -> None:
        self.metric_results.append((item_index, metric_name))
        self.order.append(("metric", item_index, metric_name))

    def on_item_complete(self, *, item_index, result, **kwargs) -> None:
        self.completed[item_index] = result
        self.order.append(("complete", item_index))

    def on_pass_completed(self, **kwargs) -> None:
        self.passes.append(kwargs)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    for name in (
        "QYM_API_KEY",
        "QYM_BASE_URL",
        "QYM_METRIC_CONCURRENCY",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
    ):
        monkeypatch.delenv(name, raising=False)


def _config(**overrides: Any) -> Dict[str, Any]:
    config: Dict[str, Any] = {
        "run_name": "metric-queue",
        "task_name": "task",
        "max_retries": 0,
        "checkpoint_enabled": False,
        "otel_enabled": False,
    }
    config.update(overrides)
    return config


def _run(evaluator: Evaluator, timeout: float = 20.0):
    async def _go():
        return await asyncio.wait_for(
            evaluator.arun(show_tui=False, auto_save=False), timeout
        )

    return asyncio.run(_go())


# --------------------------------------------------------------- config


def test_metric_concurrency_defaults_to_max_concurrency():
    assert _resolve_metric_concurrency(EvaluatorConfig(max_concurrency=7)) == 7


def test_metric_concurrency_env_var(monkeypatch):
    monkeypatch.setenv("QYM_METRIC_CONCURRENCY", "3")
    assert _resolve_metric_concurrency(EvaluatorConfig(max_concurrency=7)) == 3


def test_metric_concurrency_config_wins_over_env(monkeypatch):
    monkeypatch.setenv("QYM_METRIC_CONCURRENCY", "3")
    config = EvaluatorConfig(max_concurrency=7, metric_concurrency=5)
    assert _resolve_metric_concurrency(config) == 5


@pytest.mark.parametrize("raw", ["0", "-2", "many", "1.5"])
def test_invalid_metric_concurrency_env_falls_back(monkeypatch, raw):
    monkeypatch.setenv("QYM_METRIC_CONCURRENCY", raw)
    assert _resolve_metric_concurrency(EvaluatorConfig(max_concurrency=4)) == 4


def test_metric_concurrency_config_rejects_zero():
    with pytest.raises(ValueError):
        EvaluatorConfig(metric_concurrency=0)


# --------------------------------------------------------------- non-blocking


@pytest.mark.parametrize("task_kind", ["async", "sync"])
@pytest.mark.parametrize("metric_kind", ["async", "sync"])
def test_tasks_are_not_blocked_by_metrics(task_kind, metric_kind):
    """Every metric waits until ALL tasks have finished.

    With metrics computed inline by the task workers this deadlocks (a worker
    would wait on its own metric before taking the next item); with the
    metric queue every task finishes first and then every item is scored.
    """
    n = 6
    tasks_done = threading.Event()
    done_count = {"n": 0}
    lock = threading.Lock()

    def _mark_done():
        with lock:
            done_count["n"] += 1
            if done_count["n"] == n:
                tasks_done.set()

    def sync_task(question: str) -> str:
        _mark_done()
        return question

    async def async_task(question: str) -> str:
        await asyncio.sleep(0)
        _mark_done()
        return question

    def sync_metric(output: str, expected: str) -> float:
        assert tasks_done.wait(10), "a metric blocked task execution"
        return 1.0 if output == expected else 0.0

    async def async_metric(output: str, expected: str) -> float:
        while not tasks_done.is_set():
            await asyncio.sleep(0.01)
        return 1.0 if output == expected else 0.0

    metric = sync_metric if metric_kind == "sync" else async_metric
    metric.__name__ = "waits_for_all_tasks"
    evaluator = Evaluator(
        task=sync_task if task_kind == "sync" else async_task,
        dataset=_Dataset(n),
        metrics=[metric],
        config=_config(max_concurrency=2, metric_concurrency=n, metric_timeout=15),
    )

    result = _run(evaluator)

    assert tasks_done.is_set()
    assert len(result.results) == n
    assert not result.errors
    for item_result in result.results.values():
        assert item_result["scores"]["waits_for_all_tasks"] == 1.0


def test_task_throughput_with_slow_metric():
    """A slow metric does not slow down task execution."""
    n = 8
    metric_s = 0.3
    task_finished_at: List[float] = []

    async def task(question: str) -> str:
        await asyncio.sleep(0.01)
        task_finished_at.append(time.monotonic())
        return question

    async def slow_metric(output: str, expected: str) -> float:
        await asyncio.sleep(metric_s)
        return 1.0

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(n),
        metrics=[slow_metric],
        config=_config(max_concurrency=2, metric_concurrency=2),
    )
    started = time.monotonic()
    result = _run(evaluator)
    elapsed = time.monotonic() - started

    assert len(result.results) == n
    # Inline metrics would need n/2 * (0.01 + 0.3) ~ 1.24s just to get
    # through the tasks; queued, all tasks are done in a fraction of one
    # metric's runtime.
    assert max(task_finished_at) - min(task_finished_at) < metric_s
    # The run still waits for the metric queue to drain: n/2 * 0.3s.
    assert elapsed >= (n / 2) * metric_s * 0.9


# --------------------------------------------------------------- bounded


@pytest.mark.parametrize("metric_kind", ["async", "sync"])
def test_metric_concurrency_is_bounded_by_env_var(monkeypatch, metric_kind):
    monkeypatch.setenv("QYM_METRIC_CONCURRENCY", "2")
    lock = threading.Lock()
    state = {"active": 0, "peak": 0}

    def _enter():
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])

    def _exit():
        with lock:
            state["active"] -= 1

    def sync_metric(output: str, expected: str) -> float:
        _enter()
        try:
            time.sleep(0.05)
        finally:
            _exit()
        return 1.0

    async def async_metric(output: str, expected: str) -> float:
        _enter()
        try:
            await asyncio.sleep(0.05)
        finally:
            _exit()
        return 1.0

    async def task(question: str) -> str:
        return question

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(10),
        metrics=[sync_metric if metric_kind == "sync" else async_metric],
        config=_config(max_concurrency=10),
    )
    assert evaluator.metric_concurrency == 2

    result = _run(evaluator)

    assert len(result.results) == 10
    assert state["peak"] == 2


# --------------------------------------------------------------- correctness


def test_items_complete_with_scores_after_their_metrics(tmp_path: Path):
    recorder = _Recorder()

    async def task(question: str) -> str:
        await asyncio.sleep(0.001)
        return question if question != "q3" else "wrong"

    async def exact(output: str, expected: str) -> float:
        await asyncio.sleep(0.02)
        return 1.0 if output == expected else 0.0

    def length(output: str) -> float:
        return float(len(output))

    def broken(output: str) -> float:
        raise ValueError("metric exploded")

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(6),
        metrics=[exact, length, broken],
        observer=recorder,
        config=_config(
            max_concurrency=3,
            metric_concurrency=2,
            checkpoint_enabled=True,
            output_dir=str(tmp_path),
        ),
    )
    result = _run(evaluator)

    assert sorted(result.results) == [f"item-{i}" for i in range(6)]
    assert result.results["item-3"]["scores"]["exact"] == 0.0
    assert result.results["item-0"]["scores"]["exact"] == 1.0
    assert result.results["item-0"]["scores"]["length"] == 2.0
    assert "metric exploded" in result.results["item-0"]["scores"]["broken"]["error"]

    # Each item is reported complete only after all of its metrics, and the
    # completion carries the scores (the same payload goes to the platform).
    assert sorted(recorder.completed) == list(range(6))
    for idx, completed in recorder.completed.items():
        assert set(completed["scores"]) == {"exact", "length", "broken"}
        complete_at = recorder.order.index(("complete", idx))
        metric_positions = [
            i
            for i, ev in enumerate(recorder.order)
            if ev[0] == "metric" and ev[1] == idx
        ]
        assert len(metric_positions) == 3
        assert max(metric_positions) < complete_at

    # The checkpoint has every item with its scores.
    checkpoint = Path(result.last_saved_path)
    with checkpoint.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 6
    exact_col = next(c for c in rows[0] if "exact" in c and "meta" not in c)
    by_id = {row["item_id"]: row for row in rows}
    assert float(by_id["item-0"][exact_col]) == 1.0
    assert float(by_id["item-3"][exact_col]) == 0.0


def test_task_failures_skip_the_metric_queue():
    scored: List[str] = []

    def task(question: str) -> str:
        if question == "q1":
            raise RuntimeError("task exploded")
        return question

    def metric(output: str) -> float:
        scored.append(output)
        return 1.0

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(3),
        metrics=[metric],
        config=_config(max_concurrency=2),
    )
    result = _run(evaluator)

    assert sorted(scored) == ["q0", "q2"]
    assert "item-1" in result.errors
    assert sorted(result.results) == ["item-0", "item-2"]


def test_repeat_passes_wait_for_their_metrics():
    recorder = _Recorder()

    async def task(question: str) -> str:
        return question

    async def slow_exact(output: str, expected: str) -> float:
        await asyncio.sleep(0.02)
        return 1.0 if output == expected else 0.0

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(4),
        metrics=[slow_exact],
        observer=recorder,
        samples=2,
        config=_config(max_concurrency=4, metric_concurrency=1),
    )
    result = _run(evaluator)

    assert len(result.results) == 4
    for entries in result.passes.values():
        assert sorted(entries) == [1, 2]
    # pass_completed for pass 1 fires once pass 1's metrics are all in.
    assert recorder.passes and recorder.passes[0]["pass_number"] == 1
    assert recorder.passes[0]["metrics"]


def test_graceful_stop_still_scores_finished_tasks():
    started: List[str] = []
    stop = {"flag": False}

    async def task(question: str) -> str:
        started.append(question)
        if len(started) >= 3:
            stop["flag"] = True
        return question

    async def slow_metric(output: str) -> float:
        await asyncio.sleep(0.05)
        return 1.0

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(10),
        metrics=[slow_metric],
        config=_config(max_concurrency=1, metric_concurrency=1),
    )
    evaluator.config.should_stop = lambda: stop["flag"]

    result = _run(evaluator)

    assert result.interrupted
    # Every task that ran was scored before the run finished.
    assert len(result.results) == len(started) == 3
    for item_result in result.results.values():
        assert item_result["scores"]["slow_metric"] == 1.0


def test_cancel_reports_queued_outputs_as_failed():
    """Cancelling a run marks outputs still waiting for metrics as failed."""
    failed: List[int] = []

    class _Failures(EvaluationObserver):
        def on_item_error(self, *, item_index, error, **kwargs):
            failed.append(item_index)

    async def task(question: str) -> str:
        return question

    async def stuck_metric(output: str) -> float:
        await asyncio.sleep(30)
        return 1.0

    evaluator = Evaluator(
        task=task,
        dataset=_Dataset(4),
        metrics=[stuck_metric],
        observer=_Failures(),
        config=_config(
            max_concurrency=4,
            metric_concurrency=1,
            metric_timeout=None,
            interrupt_grace_seconds=0.1,
        ),
    )
    async def _go():
        run = asyncio.ensure_future(evaluator.arun(show_tui=False, auto_save=False))
        await asyncio.sleep(0.3)
        run.cancel()
        with pytest.raises(asyncio.CancelledError):
            await run

    asyncio.run(_go())
    # 3 outputs were queued behind the one stuck metric; the stuck one is
    # cancelled after the grace period. None of them is left in limbo.
    assert sorted(failed) == [0, 1, 2, 3]


# --------------------------------------------------------------- tracing


def test_eval_span_context_moves_from_task_worker_to_metric_worker():
    """The hand-off must not nest the next item under the previous one."""
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test")

    async def _main():
        handed: asyncio.Queue = asyncio.Queue()

        async def task_worker():
            for i in range(2):
                spans = ItemSpans(tracer=tracer)
                spans.eval_span, spans.eval_token = ItemSpans._start_span(
                    tracer, f"eval-{i}"
                )
                spans.task_span, spans.task_token = ItemSpans._start_span(
                    tracer, f"task-{i}"
                )
                spans.end_task(output="ok")
                spans.suspend_eval_context()
                # Back to the worker's own (empty) context.
                assert not trace.get_current_span().get_span_context().is_valid
                await handed.put(spans)

        async def metric_worker():
            for _ in range(2):
                spans = await handed.get()
                spans.resume_eval_context()
                spans.metrics_span, spans.metrics_token = ItemSpans._start_span(
                    tracer, "eval_metrics"
                )
                spans.end_metrics(scores={})
                spans.end_eval(output="ok")
                assert not trace.get_current_span().get_span_context().is_valid

        await asyncio.gather(task_worker(), metric_worker())

    asyncio.run(_main())

    finished = {span.name: span for span in exporter.get_finished_spans()}
    assert finished["eval-0"].parent is None
    assert finished["eval-1"].parent is None
    assert finished["task-1"].parent.span_id == finished["eval-1"].context.span_id
    metrics_spans = [s for s in exporter.get_finished_spans() if s.name == "eval_metrics"]
    parents = {s.parent.span_id for s in metrics_spans}
    assert parents == {
        finished["eval-0"].context.span_id,
        finished["eval-1"].context.span_id,
    }
