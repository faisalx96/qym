"""Drive the real SDK event stream against a running platform — no LLM calls.

    python -m qym_platform.tools.perf.live_stream --base-url http://localhost:8010 \
        --api-key qk00perf_... --runs 5 --items 80 --items-per-second 2

Each simulated run goes through ``PlatformClient.create_run`` and a
``PlatformEventStream`` exactly like ``qym.Evaluator`` does (200 events / 2 MB /
0.25 s batches, heartbeats, one in-flight POST per run), emitting the same
event sequence and the same agentic span payloads as ``shape.py``. Reports
accepted events/s, batch latency and any 4xx/5xx.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from qym.platform.client import PlatformClient, PlatformEventStream

from qym_platform.tools.perf import shape


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()


_LAT_LOCK = threading.Lock()
_BATCH_LATENCIES_MS: List[float] = []
_BATCH_ERRORS: List[str] = []


def _install_post_timer() -> None:
    """Wrap the SDK's module-level NDJSON POST so batch latency is observable."""
    import qym.platform.client as client_mod

    if getattr(client_mod, "_qym_perf_timed", False):
        return
    original = client_mod._post_ndjson

    def timed(url, ndjson, api_key, **kw):
        started = time.perf_counter()
        try:
            return original(url, ndjson, api_key, **kw)
        except Exception as exc:  # noqa: BLE001 - recorded, then re-raised for the SDK's retry logic
            with _LAT_LOCK:
                _BATCH_ERRORS.append(str(exc)[:200])
            raise
        finally:
            with _LAT_LOCK:
                _BATCH_LATENCIES_MS.append((time.perf_counter() - started) * 1000.0)

    client_mod._post_ndjson = timed
    client_mod._qym_perf_timed = True


def simulate_run(base_url: str, api_key: str, *, index: int, items: int, items_per_second: float, samples: int, seed: int) -> Dict[str, Any]:
    rng = random.Random(seed * 1000 + index)
    rs = shape.run_shape(rng, project_index=index, repeat_share=0.0)
    rs.item_count = items
    rs.samples = samples
    rs.status = "COMPLETED"
    client = PlatformClient(base_url, api_key)
    handle = client.create_run(
        external_run_id=f"perf-live-{index}-{int(time.time())}",
        task=rs.task,
        dataset=rs.dataset,
        model=rs.model,
        metrics=[m.name for m in rs.metrics],
        run_metadata={"total_items": items, "perf_live": True},
        run_config={"samples": samples, "concurrency": 8},
        metric_specs={m.name: {"score_type": m.score_type, "direction": m.direction, "pass_threshold": m.pass_threshold} for m in rs.metrics},
    )
    stream = PlatformEventStream(base_url, api_key, handle.run_id)
    now_ms = int(time.time() * 1000)
    stream.emit(
        "run_started",
        {
            "task": rs.task,
            "dataset": rs.dataset,
            "model": rs.model,
            "metrics": [m.name for m in rs.metrics],
            "total_items": items,
            "run_metadata": {"perf_live": True},
            "run_config": {"samples": samples},
            "started_at": _iso(now_ms),
        },
    )
    emitted = 1
    started = time.perf_counter()
    item_shapes = [shape.item_shape(rng, i) for i in range(items)]
    for pass_number in range(1, samples + 1):
        for it in item_shapes:
            t_item = time.perf_counter()
            start_ms = int(time.time() * 1000)
            p = shape.item_pass(rng, item=it, run=rs, pass_number=pass_number, started_at_ms=start_ms)
            stream.emit("item_started", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "input": it.input, "expected": it.expected, "item_metadata": it.item_metadata})
            stream.emit("item_attempt_started", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "attempt_number": 1, "trace_id": p.trace_id, "task_started_at_ms": start_ms})
            emitted += 2
            for s in p.spans:
                stream.emit(
                    "span_completed",
                    {"trace_id": p.trace_id, "span_id": s.span_id, "parent_span_id": s.parent_span_id, "name": s.name, "kind": s.kind, "start_time_ns": s.start_ns, "end_time_ns": s.end_ns, "duration_ms": (s.end_ns - s.start_ns) / 1e6, "status": s.status, "attributes": s.attributes, "events": [], "links": []},
                )
                emitted += 1
            status = "failed" if p.error else "completed"
            stream.emit("item_attempt_finished", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "attempt_number": 1, "status": status, "trace_id": p.trace_id, "latency_ms": p.latency_ms, "task_started_at_ms": start_ms, "output": p.output, "error": p.error, "is_last_attempt": True})
            emitted += 1
            for m, sc in p.scores.items():
                stream.emit("metric_scored", {"item_id": it.item_id, "pass_number": pass_number, "metric_name": m, "score_numeric": sc["score"], "score_raw": sc["meta"]["raw"], "meta": sc["meta"], "explanation": sc["explanation"]})
                emitted += 1
            if p.error:
                stream.emit("item_failed", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "error": p.error, "latency_ms": p.latency_ms, "trace_id": p.trace_id, "task_started_at_ms": start_ms, "retry_count": 0})
            else:
                stream.emit("item_completed", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "is_final_pass": pass_number == samples, "output": p.output, "item_metadata": it.item_metadata, "task_metadata": {}, "latency_ms": p.latency_ms, "trace_id": p.trace_id, "task_started_at_ms": start_ms, "retry_count": 0})
            emitted += 1
            # pace to the requested item rate
            budget = 1.0 / max(items_per_second, 1e-6)
            spent = time.perf_counter() - t_item
            if spent < budget:
                time.sleep(budget - spent)
        if samples > 1:
            stream.emit("pass_completed", {"pass_number": pass_number, "samples": samples, "metrics": {}})
            emitted += 1
    stream.emit("run_completed", {"ended_at": _iso(int(time.time() * 1000)), "summary": {}, "final_status": "COMPLETED"})
    emitted += 1
    stream.close()
    elapsed = time.perf_counter() - started
    return {
        "run_id": handle.run_id,
        "emitted": emitted,
        "sent": stream.sent_events,
        "dropped": stream.dropped_events,
        "seconds": round(elapsed, 1),
        "events_per_second": round(emitted / max(elapsed, 1e-9), 1),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=os.environ.get("QYM_BENCH_BASE_URL", "http://localhost:8010"))
    parser.add_argument("--api-key", default=os.environ.get("QYM_API_KEY"), required=False)
    parser.add_argument("--runs", type=int, default=3, help="concurrent simulated runs")
    parser.add_argument("--items", type=int, default=60)
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--items-per-second", type=float, default=1.5, help="per run; ~8 concurrent items at 3-5 s each in prod")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not args.api_key:
        parser.error("--api-key (or QYM_API_KEY) required — see artifacts/perf/<label>/manifest.json api_tokens")

    _install_post_timer()
    results: List[Dict[str, Any]] = [None] * args.runs  # type: ignore[list-item]

    def worker(i: int) -> None:
        results[i] = simulate_run(args.base_url, args.api_key, index=i, items=args.items, items_per_second=args.items_per_second, samples=args.samples, seed=args.seed)

    threads = [threading.Thread(target=worker, args=(i,), name=f"live-{i}") for i in range(args.runs)]
    started = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    total_events = sum(r["emitted"] for r in results)
    elapsed = time.perf_counter() - started
    with _LAT_LOCK:
        lat = sorted(_BATCH_LATENCIES_MS)
        errors = list(_BATCH_ERRORS)
    summary = {
        "batches": len(lat),
        "batch_p50_ms": round(lat[len(lat) // 2], 1) if lat else None,
        "batch_p95_ms": round(lat[min(len(lat) - 1, int(len(lat) * 0.95))], 1) if lat else None,
        "batch_max_ms": round(lat[-1], 1) if lat else None,
        "errors": errors[:10],
        "runs": args.runs,
        "items": args.items,
        "samples": args.samples,
        "seconds": round(elapsed, 1),
        "total_events": total_events,
        "aggregate_events_per_second": round(total_events / max(elapsed, 1e-9), 1),
        "dropped": sum(r["dropped"] for r in results),
        "per_run": results,
    }
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"{args.runs} runs x {args.items} items x {args.samples} passes: {total_events:,} events in {elapsed:.0f}s = {summary['aggregate_events_per_second']} ev/s, dropped={summary['dropped']}")
        print(f"  batches={summary['batches']} p50={summary['batch_p50_ms']} p95={summary['batch_p95_ms']} max={summary['batch_max_ms']} ms, errors={len(errors)}")
        for r in results:
            print(f"  {r['run_id']}: {r['emitted']:,} events sent={r['sent']} dropped={r['dropped']} in {r['seconds']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
