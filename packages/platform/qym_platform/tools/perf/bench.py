"""HTTP benchmark of the platform's hot read/write paths.

    python -m qym_platform.tools.perf.bench --base-url http://localhost:8010 \
        --url postgresql+psycopg2://qym:qym@localhost:15433/qym_perf --label baseline

Runs each scenario ``--iterations`` times (``--concurrency`` parallel clients
for the list/overview scenarios) against a *running* platform and records
p50/p95/max wall time, response bytes and — when the server has
``QYM_REQUEST_TIMING=1`` — server-side DB time and statement counts from the
``Server-Timing`` header. Results go to ``artifacts/perf/<label>/bench.jsonl``
plus a Markdown table on stdout.

Target runs are picked from the database (``--url``) so the same shapes are
measured every time: a classic COMPLETED run with the most items, the repeat
run with the most passes, and a RUNNING run.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

import httpx
from sqlalchemy import create_engine, text

DEFAULT_SCENARIOS = (
    "runs_list_dashboard",
    "overview",
    "runs_list_legacy",
    "run_open_classic",
    "run_open_repeat",
    "items_details_batch",
    "passes",
    "group_metrics",
    "spans",
    "step_latency",
    "item_trace",
    "delete_restore",
)


class Targets:
    def __init__(self, url: str):
        self.engine = create_engine(url)
        with self.engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT r.id, p.slug, (SELECT count(*) FROM run_items i WHERE i.run_id = r.id) AS n
                    FROM runs r JOIN projects p ON p.id = r.project_id
                    WHERE r.deleted_at IS NULL AND r.samples = 1 AND r.status = 'COMPLETED'
                    ORDER BY n DESC LIMIT 1
                    """
                )
            ).first()
            self.classic_run, self.project_slug, self.classic_items = row[0], row[1], row[2]
            row = conn.execute(
                text(
                    """
                    SELECT r.id, r.samples, (SELECT count(*) FROM run_items i WHERE i.run_id = r.id) AS n,
                           (SELECT metric_name FROM run_metric_specs m WHERE m.run_id = r.id ORDER BY position LIMIT 1)
                    FROM runs r WHERE r.deleted_at IS NULL AND r.samples > 1 AND r.status = 'COMPLETED'
                    ORDER BY r.samples DESC, n DESC LIMIT 1
                    """
                )
            ).first()
            self.repeat_run, self.repeat_samples, self.repeat_items, self.repeat_metric = row[0], row[1], row[2], row[3]
            self.classic_item_ids = [
                r[0] for r in conn.execute(text("SELECT item_id FROM run_items WHERE run_id = :r ORDER BY index LIMIT 100"), {"r": self.classic_run})
            ]
            self.repeat_item_ids = [
                r[0] for r in conn.execute(text("SELECT item_id FROM run_items WHERE run_id = :r ORDER BY index LIMIT 100"), {"r": self.repeat_run})
            ]
            self.delete_candidates = [
                r[0]
                for r in conn.execute(
                    text("SELECT id FROM runs WHERE deleted_at IS NULL AND samples = 1 AND status = 'COMPLETED' ORDER BY created_at LIMIT 50")
                )
            ]
            self.total_runs = conn.execute(text("SELECT count(*) FROM runs WHERE deleted_at IS NULL")).scalar()

    def describe(self) -> Dict[str, Any]:
        return {
            "project_slug": self.project_slug,
            "classic_run": self.classic_run,
            "classic_items": self.classic_items,
            "repeat_run": self.repeat_run,
            "repeat_samples": self.repeat_samples,
            "repeat_items": self.repeat_items,
            "total_runs": self.total_runs,
        }


def _server_timing(resp: httpx.Response) -> Dict[str, float]:
    out: Dict[str, float] = {}
    header = resp.headers.get("server-timing", "")
    for part in header.split(","):
        part = part.strip()
        if ";dur=" in part:
            name, dur = part.split(";dur=", 1)
            try:
                out[name.strip()] = float(dur)
            except ValueError:
                pass
    return out


class Bench:
    def __init__(self, base_url: str, targets: Targets, *, iterations: int, concurrency: int, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.t = targets
        self.iterations = iterations
        self.concurrency = concurrency
        self.client = httpx.Client(base_url=self.base_url, timeout=timeout)
        self.results: List[Dict[str, Any]] = []

    # --- scenario request builders -------------------------------------------------
    def req_runs_list_dashboard(self, c: httpx.Client) -> httpx.Response:
        return c.post(
            "/api/dashboard/runs",
            json={"project_slug": self.t.project_slug, "filters": {}, "sort": "time-desc", "limit": 50, "offset": 0, "ids": [], "include_overview": True},
        )

    def req_overview(self, c: httpx.Client) -> httpx.Response:
        return c.post("/api/dashboard/overview", json={"project_slug": self.t.project_slug, "filters": {}})

    def req_runs_list_legacy(self, c: httpx.Client) -> httpx.Response:
        return c.get("/api/runs", params={"limit": 100, "offset": 0, "project_slug": self.t.project_slug})

    def req_run_open_classic(self, c: httpx.Client) -> httpx.Response:
        return c.get(f"/api/runs/{self.t.classic_run}", params={"view": "compact"})

    def req_run_open_repeat(self, c: httpx.Client) -> httpx.Response:
        return c.get(f"/api/runs/{self.t.repeat_run}", params={"view": "compact"})

    def req_items_details_batch(self, c: httpx.Client) -> httpx.Response:
        return c.post(f"/api/runs/{self.t.repeat_run}/items/details", json={"item_ids": self.t.repeat_item_ids})

    def req_passes(self, c: httpx.Client) -> httpx.Response:
        return c.get(f"/api/runs/{self.t.repeat_run}/passes")

    def req_group_metrics(self, c: httpx.Client) -> httpx.Response:
        return c.get(f"/api/runs/{self.t.repeat_run}/group-metrics", params={"metric": self.t.repeat_metric, "threshold": 0.8})

    def req_spans(self, c: httpx.Client) -> httpx.Response:
        return c.get(f"/api/runs/{self.t.classic_run}/spans")

    def req_step_latency(self, c: httpx.Client) -> httpx.Response:
        return c.get("/api/runs/step-latency", params={"run_ids": self.t.classic_run})

    def req_item_trace(self, c: httpx.Client) -> httpx.Response:
        return c.get(f"/api/runs/{self.t.repeat_run}/items/{self.t.repeat_item_ids[0]}/trace")

    # --- runner ---------------------------------------------------------------------
    def _timed(self, fn: Callable[[httpx.Client], httpx.Response], client: httpx.Client) -> Dict[str, Any]:
        started = time.perf_counter()
        resp = fn(client)
        wall = (time.perf_counter() - started) * 1000.0
        st = _server_timing(resp)
        return {"wall_ms": wall, "status": resp.status_code, "bytes": len(resp.content), "db_ms": st.get("db"), "db_count": st.get("db-count"), "app_ms": st.get("app")}

    def run_scenario(self, name: str, *, concurrent: bool) -> Dict[str, Any]:
        fn = getattr(self, f"req_{name}")
        samples: List[Dict[str, Any]] = []
        # one warm-up so cold module imports/caches don't dominate p95
        warm = self._timed(fn, self.client)
        if concurrent and self.concurrency > 1:
            clients = [httpx.Client(base_url=self.base_url, timeout=self.client.timeout) for _ in range(self.concurrency)]
            try:
                with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                    futures = [pool.submit(self._timed, fn, clients[i % self.concurrency]) for i in range(self.iterations)]
                    samples = [f.result() for f in futures]
            finally:
                for c in clients:
                    c.close()
        else:
            samples = [self._timed(fn, self.client) for _ in range(self.iterations)]
        return self._summarize(name, samples, warm=warm, concurrent=concurrent)

    def _summarize(self, name: str, samples: List[Dict[str, Any]], *, warm: Optional[Dict[str, Any]] = None, concurrent: bool = False, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        walls = sorted(s["wall_ms"] for s in samples)
        statuses = {}
        for s in samples:
            statuses[s["status"]] = statuses.get(s["status"], 0) + 1
        db_ms = [s["db_ms"] for s in samples if s.get("db_ms") is not None]
        db_count = [s["db_count"] for s in samples if s.get("db_count") is not None]

        def pct(values: List[float], p: float) -> Optional[float]:
            if not values:
                return None
            k = max(0, min(len(values) - 1, round((p / 100.0) * (len(values) - 1))))
            return values[k]

        row = {
            "scenario": name,
            "n": len(samples),
            "concurrency": self.concurrency if concurrent else 1,
            "p50_ms": pct(walls, 50),
            "p95_ms": pct(walls, 95),
            "max_ms": walls[-1] if walls else None,
            "cold_ms": warm["wall_ms"] if warm else None,
            "bytes": int(statistics.median(s["bytes"] for s in samples)) if samples else None,
            "db_ms_p50": pct(sorted(db_ms), 50) if db_ms else None,
            "db_count_p50": pct(sorted(db_count), 50) if db_count else None,
            "statuses": statuses,
        }
        if extra:
            row.update(extra)
        self.results.append(row)
        return row

    def run_delete_restore(self) -> Dict[str, Any]:
        samples = []
        restore_samples = []
        for run_id in self.t.delete_candidates[: self.iterations]:
            started = time.perf_counter()
            resp = self.client.post("/api/runs/delete", json={"file_path": run_id})
            wall = (time.perf_counter() - started) * 1000.0
            st = _server_timing(resp)
            samples.append({"wall_ms": wall, "status": resp.status_code, "bytes": len(resp.content), "db_ms": st.get("db"), "db_count": st.get("db-count")})
            started = time.perf_counter()
            r2 = self.client.post("/api/runs/restore", json={"run_id": run_id})
            restore_samples.append({"wall_ms": (time.perf_counter() - started) * 1000.0, "status": r2.status_code, "bytes": len(r2.content)})
        row = self._summarize("delete_run", samples)
        self._summarize("restore_run", restore_samples)
        return row

    def run_worker_drain(self, *, max_seconds: float, poll_seconds: float = 5.0) -> Dict[str, Any]:
        """Reset every partition the way migration 0050 did and time the refill.

        Requires the platform to be running with the worker enabled.
        """
        with self.t.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE dashboard_partition_state
                    SET queue_state = 'backfill', backfill_complete = false, backfill_kind = 'item',
                        backfill_cursor = 0, backfill_source_version = 0, lease_owner = NULL, lease_until = NULL
                    """
                )
            )
            total = conn.execute(text("SELECT count(*) FROM runs WHERE deleted_at IS NULL")).scalar()
        started = time.perf_counter()
        curve = []
        last_ready = -1
        while True:
            with self.t.engine.connect() as conn:
                ready = conn.execute(text("SELECT count(*) FROM dashboard_partition_state WHERE queue_state = 'ready'")).scalar()
                pending = conn.execute(text("SELECT count(*) FROM dashboard_change_events WHERE published_at IS NULL")).scalar()
                visible = conn.execute(text("SELECT count(*) FROM dashboard_run_summaries WHERE projection_revision > 0")).scalar()
            elapsed = time.perf_counter() - started
            curve.append({"t": round(elapsed, 1), "ready": ready, "pending_events": pending, "visible_runs": visible})
            if ready != last_ready:
                print(f"[drain] t={elapsed:6.0f}s ready={ready}/{total} visible={visible} pending_events={pending}", file=sys.stderr, flush=True)
                last_ready = ready
            if ready >= total or elapsed > max_seconds:
                break
            time.sleep(poll_seconds)
        row = {
            "scenario": "worker_drain",
            "total_runs": total,
            "ready_runs": ready,
            "seconds": round(time.perf_counter() - started, 1),
            "runs_per_minute": round(ready / max(1e-9, (time.perf_counter() - started) / 60.0), 1),
            "completed": ready >= total,
            "curve": curve,
        }
        self.results.append(row)
        return row


def render_markdown(rows: List[Dict[str, Any]]) -> str:
    lines = ["| scenario | n | conc | p50 ms | p95 ms | max ms | cold ms | bytes | db ms | db stmts | status |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r["scenario"] == "worker_drain":
            lines.append(f"| worker_drain | {r['ready_runs']}/{r['total_runs']} runs | | | | {r['seconds']} s | | | | {r['runs_per_minute']} runs/min | {'done' if r['completed'] else 'timeout'} |")
            continue

        def f(v):
            return "-" if v is None else (f"{v:,.0f}" if isinstance(v, (int, float)) else str(v))

        lines.append(
            f"| {r['scenario']} | {r['n']} | {r['concurrency']} | {f(r['p50_ms'])} | {f(r['p95_ms'])} | {f(r['max_ms'])} | {f(r['cold_ms'])} | {f(r['bytes'])} | {f(r['db_ms_p50'])} | {f(r['db_count_p50'])} | {r['statuses']} |"
        )
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=os.environ.get("QYM_BENCH_BASE_URL", "http://localhost:8010"))
    parser.add_argument("--url", default=os.environ.get("QYM_TEST_POSTGRES_URL") or os.environ.get("QYM_DATABASE_URL"), help="database URL used to pick target runs")
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--out-dir", default=os.path.join("artifacts", "perf"))
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument("--concurrency", type=int, default=5, help="parallel clients for list/overview scenarios")
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--scenarios", default=",".join(DEFAULT_SCENARIOS), help="comma-separated subset; add worker_drain explicitly")
    parser.add_argument("--drain-max-seconds", type=float, default=3 * 3600)
    args = parser.parse_args(argv)
    if not args.url:
        parser.error("--url is required to pick target runs")

    targets = Targets(args.url)
    bench = Bench(args.base_url, targets, iterations=args.iterations, concurrency=args.concurrency, timeout=args.timeout)
    health = bench.client.get("/healthz")
    health.raise_for_status()
    print(f"[bench] targets: {json.dumps(targets.describe())}", file=sys.stderr)

    wanted = [s.strip() for s in args.scenarios.split(",") if s.strip()]
    for name in wanted:
        started = time.perf_counter()
        if name == "delete_restore":
            row = bench.run_delete_restore()
        elif name == "worker_drain":
            row = bench.run_worker_drain(max_seconds=args.drain_max_seconds)
        else:
            row = bench.run_scenario(name, concurrent=name in {"runs_list_dashboard", "overview", "runs_list_legacy"})
        print(f"[bench] {name}: {json.dumps({k: v for k, v in row.items() if k != 'curve'}, default=str)}  ({time.perf_counter() - started:.0f}s)", file=sys.stderr, flush=True)

    out_dir = os.path.join(args.out_dir, args.label)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "bench.jsonl"), "a", encoding="utf-8") as fh:
        for row in bench.results:
            fh.write(json.dumps({"label": args.label, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "targets": targets.describe(), **row}, default=str) + "\n")
    print(render_markdown(bench.results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
