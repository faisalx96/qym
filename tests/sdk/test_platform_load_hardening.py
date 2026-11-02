"""SDK behaviour that keeps long-lived processes and the platform database healthy.

Covers: one shared span processor per TracerProvider (no per-run leak),
frozen-batch retries with jitter and timeouts above the server's statement
budget, the adaptive flush cadence, non-blocking span emission, per-field
truncation, byte-accurate batching, and serialized direct sends.
"""

import asyncio
import gc
import json
import logging
import random
import threading
import time
import weakref

import pytest
from qym import Evaluator, InMemoryDataset
from qym.platform import client as client_module
from qym.platform.client import (
    TRUNCATION_MARKER,
    PlatformEventStream,
    PlatformRunHandle,
)


def _stream(monkeypatch, post, **limits):
    monkeypatch.setattr(client_module, "_post_ndjson", post)
    monkeypatch.setattr(PlatformEventStream, "HEARTBEAT_INTERVAL", 60)
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)
    for name, value in limits.items():
        monkeypatch.setattr(PlatformEventStream, name, value)
    return PlatformEventStream("http://unused.invalid", "test-only", "run-test")


def _events(ndjson):
    return [json.loads(line) for line in ndjson.splitlines()]


# --- 1. one span processor per provider, no stream kept alive -------------


def _fake_platform(monkeypatch, posted):
    def post(url, ndjson, key, **kwargs):
        posted.extend(_events(ndjson))

    monkeypatch.setattr(client_module, "_post_ndjson", post)
    monkeypatch.setattr(
        client_module.PlatformClient,
        "create_run",
        lambda self, **kwargs: PlatformRunHandle(
            kwargs["external_run_id"], "http://unused.invalid/run"
        ),
    )
    monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)


def test_evaluators_share_one_span_processor_and_release_their_streams(
    monkeypatch, tmp_path
):
    import qym.core.otel as otel_module
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider

    provider = TracerProvider()
    monkeypatch.setattr(trace, "get_tracer_provider", lambda: provider)
    monkeypatch.setattr(
        trace, "get_tracer", lambda name, *a, **k: provider.get_tracer(name)
    )
    # Skip global instrumentor setup; only the processor install is under test.
    monkeypatch.setattr(otel_module, "_initialized", True)
    posted = []
    _fake_platform(monkeypatch, posted)

    async def task(value):
        with trace.get_tracer("t").start_as_current_span(
            "fake-llm", attributes={"openinference.span.kind": "LLM"}
        ):
            await asyncio.sleep(0)
        return value

    stream_refs = []
    for run in range(4):
        evaluator = Evaluator(
            task,
            InMemoryDataset([{"input": "a", "expected_output": "a"}]),
            ["exact_match"],
            config={
                "run_name": f"leak-{run}",
                "otel_enabled": True,
                "checkpoint_enabled": False,
                "platform_api_key": "test-only",
                "platform_url": "http://unused.invalid",
                "output_dir": str(tmp_path),
            },
        )
        asyncio.run(evaluator.arun(show_tui=False, auto_save=False))
        assert evaluator._run_completed
        stream_refs.append(weakref.ref(evaluator._platform_stream))
        del evaluator

    processors = [
        p
        for p in provider._active_span_processor._span_processors
        if isinstance(p, otel_module.QymSpanProcessor)
    ]
    assert len(processors) == 1
    gc.collect()
    assert [ref() for ref in stream_refs] == [None] * 4
    # Every run still got its own span.
    spans = [e for e in posted if e["type"] == "span_completed"]
    assert len({e["run_id"] for e in spans}) == 4
    # Nothing outside an evaluation is tracked.
    processors[0]._llm_span_ids.clear()
    with trace.get_tracer("t").start_as_current_span(
        "outside", attributes={"openinference.span.kind": "LLM"}
    ):
        pass
    assert processors[0]._llm_span_ids == set()


def test_install_is_idempotent_per_provider():
    import qym.core.otel as otel_module
    from opentelemetry.sdk.trace import TracerProvider

    first, second = TracerProvider(), TracerProvider()
    a = otel_module._install_qym_processor(first)
    assert otel_module._install_qym_processor(first) is a
    assert otel_module._install_qym_processor(second) is not a
    assert len(first._active_span_processor._span_processors) == 1


# --- 2. frozen retries, jitter, timeouts ----------------------------------


def test_retry_resends_exactly_the_failed_batch(monkeypatch):
    attempts = []
    stream = None

    def post(url, ndjson, key, **kwargs):
        attempts.append([e["event_id"] for e in _events(ndjson)])
        if len(attempts) == 1:
            # New events arrive while the first request is failing.
            for i in range(3):
                stream.emit("item_started", {"item_id": f"late-{i}", "index": i})
            raise TimeoutError("server still working")

    stream = _stream(
        monkeypatch, post, RETRY_BACKOFF_BASE=0.001, RETRY_BACKOFF_MAX=0.001
    )
    stream.emit("item_started", {"item_id": "first", "index": 0})
    assert stream.flush(timeout=5)
    stream.close()

    assert attempts[1] == attempts[0]  # same events, same event_ids
    later = {eid for batch in attempts[2:] for eid in batch}
    assert len(later) == 3 and not later & set(attempts[0])
    assert stream.sent_events == 4 and stream.dropped_events == 0


def test_request_timeouts_exceed_server_statement_budget(monkeypatch):
    timeouts = []

    def post(url, ndjson, key, *, timeout):
        timeouts.append(timeout)

    stream = _stream(monkeypatch, post)
    stream.emit("item_started", {"item_id": "x", "index": 0})
    assert stream.flush(timeout=5)
    stream.emit("run_completed", {}, sync=True)
    stream.close()
    assert timeouts[0] == 60.0 and timeouts[0] > 30
    assert timeouts[-1] == 45.0 and timeouts[-1] > 30

    monkeypatch.setenv("QYM_PLATFORM_REQUEST_TIMEOUT", "90")
    monkeypatch.setenv("QYM_PLATFORM_DRAIN_REQUEST_TIMEOUT", "50")
    timeouts.clear()
    stream = _stream(monkeypatch, post)
    stream.emit("item_started", {"item_id": "x", "index": 0})
    assert stream.flush(timeout=5)
    stream.emit("run_completed", {}, sync=True)
    stream.close()
    assert timeouts == [90.0, 50.0]


def test_backoff_has_full_jitter_and_a_cap(monkeypatch):
    stream = _stream(monkeypatch, lambda *a, **k: None)
    try:
        random.seed(7)
        values = [stream._retry_backoff(6) for _ in range(200)]
        assert all(0 <= v <= stream.RETRY_BACKOFF_MAX for v in values)
        assert len({round(v, 3) for v in values}) > 50
        assert all(0 <= stream._retry_backoff(1) <= 0.5 for _ in range(50))
    finally:
        stream.close()


# --- 3. adaptive flush cadence ------------------------------------------


def test_flush_interval_defaults_to_one_second_and_stretches_when_slow(monkeypatch):
    assert PlatformEventStream.FLUSH_INTERVAL == 1.0
    monkeypatch.setattr(client_module, "_post_ndjson", lambda *a, **k: None)
    stream = PlatformEventStream("http://unused.invalid", "k", "run")
    try:
        assert stream._next_flush_interval(0.2) == 1.0
        assert stream._next_flush_interval(2.0) == 4.0
        assert stream._next_flush_interval(30.0) == stream.MAX_FLUSH_INTERVAL
    finally:
        stream.close()
    monkeypatch.setenv("QYM_PLATFORM_FLUSH_INTERVAL", "2.5")
    stream = PlatformEventStream("http://unused.invalid", "k", "run")
    try:
        assert stream._next_flush_interval(0.1) == 2.5
    finally:
        stream.close()


def test_slow_posts_reduce_request_rate(monkeypatch):
    posts = []

    def post(url, ndjson, key, **kwargs):
        posts.append(time.monotonic())
        time.sleep(0.03)

    stream = _stream(
        monkeypatch,
        post,
        FLUSH_INTERVAL=0.01,
        SLOW_POST_SECONDS=0.02,
        MAX_FLUSH_INTERVAL=0.2,
    )
    try:
        deadline = time.monotonic() + 0.6
        while time.monotonic() < deadline:
            stream.emit("run_heartbeat", {"heartbeat_at": "2026-01-01T00:00:00Z"})
            time.sleep(0.002)
    finally:
        stream.close()
    gaps = [b - a for a, b in zip(posts[1:-1], posts[2:-1])]
    # Each 30ms POST stretches the cadence to ~60ms, not 10ms.
    assert gaps and min(gaps) >= 0.05


# --- 4. span emission never blocks --------------------------------------


def test_span_emission_drops_instead_of_blocking_on_a_full_backlog(monkeypatch, capsys):
    release = threading.Event()

    def post(url, ndjson, key, **kwargs):
        release.wait(5)

    stream = _stream(
        monkeypatch,
        post,
        MAX_PENDING_MEMORY_BYTES=600,
        MAX_PENDING_DISK_BYTES=0,
        MAX_BATCH_EVENTS=1,
    )
    try:
        payload = {"name": "s", "attributes": {"x": "y" * 200}}
        started = time.monotonic()
        results = [stream.emit_nowait("span_completed", payload) for _ in range(10)]
        elapsed = time.monotonic() - started
        assert elapsed < 10 * stream.SPAN_ENQUEUE_TIMEOUT + 0.5
        assert results[0] and not all(results)
        assert stream.dropped_spans == results.count(False)
        # Dropped spans never hold completion.
        assert stream.dropped_events == 0
    finally:
        release.set()
        stream.close()
    assert capsys.readouterr().err.count("skipped a platform span_completed") == 1


def test_span_emission_after_close_is_not_sent_inline(monkeypatch):
    posts = []
    stream = _stream(monkeypatch, lambda url, ndjson, key, **k: posts.append(ndjson))
    stream.close()
    assert stream.emit_nowait("span_completed", {"name": "late"}) is False
    assert posts == [] and stream.dropped_spans == 1


# --- 5. per-field truncation and byte-accurate batches -------------------


def test_large_strings_are_truncated_and_marked(monkeypatch, capsys):
    posted = []
    stream = _stream(monkeypatch, lambda url, nd, key, **k: posted.extend(_events(nd)))
    big = "é" * (600 * 1024)
    stream.emit(
        "item_completed",
        {"item_id": "a", "output": big, "item_metadata": {"note": "short"}},
    )
    assert stream.flush(timeout=5)
    stream.close()
    [evt] = posted
    output = evt["payload"]["output"]
    marker_at = output.index("…[truncated by qym:")
    assert len(output[:marker_at].encode("utf-8")) <= stream.MAX_FIELD_BYTES
    assert evt["payload"]["item_metadata"] == {"note": "short"}
    assert evt["payload"]["_qym_truncated"]["fields"] == 1
    assert stream.truncated_events == 1
    assert "truncated for upload" in capsys.readouterr().err
    assert TRUNCATION_MARKER.split("{")[0] in output


def test_many_large_fields_shrink_until_the_event_fits(monkeypatch):
    posted = []
    stream = _stream(monkeypatch, lambda url, nd, key, **k: posted.extend(_events(nd)))
    attrs = {f"k{i}": "x" * (200 * 1024) for i in range(30)}  # ~6MB
    stream.emit_nowait("span_completed", {"name": "huge", "attributes": attrs})
    assert stream.flush(timeout=5)
    stream.close()
    [evt] = posted
    assert len(json.dumps(evt).encode("utf-8")) <= stream.MAX_EVENT_BYTES + 4096
    assert evt["payload"]["_qym_truncated"]["fields"] == 30


def test_field_cap_is_configurable_and_can_be_disabled(monkeypatch):
    monkeypatch.setenv("QYM_PLATFORM_MAX_FIELD_BYTES", "0")
    posted = []
    stream = _stream(monkeypatch, lambda url, nd, key, **k: posted.extend(_events(nd)))
    stream.emit("item_completed", {"item_id": "a", "output": "z" * 300_000})
    assert stream.flush(timeout=5)
    stream.close()
    assert posted[0]["payload"]["output"] == "z" * 300_000


def test_batch_byte_cap_accounts_for_the_incoming_event(monkeypatch):
    bodies = []
    stream = _stream(
        monkeypatch,
        lambda url, nd, key, **k: bodies.append(nd),
        MAX_BATCH_BYTES=1500,
        FLUSH_INTERVAL=0.5,
    )
    for i in range(6):
        stream.emit("item_started", {"item_id": str(i), "input": "p" * 600})
    assert stream.flush(timeout=5)
    stream.close()
    assert sum(len(_events(b)) for b in bodies) == 6
    for body in bodies:
        assert len(body.encode("utf-8")) <= 1500 or len(_events(body)) == 1


@pytest.mark.asyncio
async def test_unqueued_item_completed_is_logged_not_silent(
    monkeypatch, tmp_path, caplog
):
    posted = []
    _fake_platform(monkeypatch, posted)
    original = PlatformEventStream.aemit

    async def failing_aemit(self, type_, payload, *, sync=False):
        if type_ == "item_completed":
            raise ValueError("Platform event exceeds both backlog byte limits")
        return await original(self, type_, payload, sync=sync)

    monkeypatch.setattr(PlatformEventStream, "aemit", failing_aemit)

    async def task(value):
        return value

    evaluator = Evaluator(
        task,
        InMemoryDataset([{"id": "only", "input": "a", "expected_output": "a"}]),
        ["exact_match"],
        config={
            "run_name": "lost-item",
            "otel_enabled": False,
            "checkpoint_enabled": False,
            "platform_api_key": "test-only",
            "platform_url": "http://unused.invalid",
            "output_dir": str(tmp_path),
        },
    )
    with caplog.at_level(logging.WARNING, logger="qym.core.evaluator"):
        await asyncio.wait_for(evaluator.arun(show_tui=False, auto_save=False), 10)
    assert any(
        "item_completed could not be queued" in r.getMessage() for r in caplog.records
    )


# --- 8. direct sends never overlap a batch POST ---------------------------


def test_direct_send_waits_for_the_in_flight_batch(monkeypatch):
    in_flight = 0
    peak = 0
    order = []
    entered = threading.Event()
    lock = threading.Lock()

    def post(url, ndjson, key, **kwargs):
        nonlocal in_flight, peak
        with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        kinds = [e["type"] for e in _events(ndjson)]
        if "item_started" in kinds:
            entered.set()
            time.sleep(0.2)
        order.extend(kinds)
        with lock:
            in_flight -= 1

    stream = _stream(monkeypatch, post)
    stream.emit("item_started", {"item_id": "a", "index": 0})
    assert entered.wait(5)
    stream.emit("run_completed", {}, sync=True)
    stream.close()
    assert peak == 1
    assert order == ["item_started", "run_completed"]
