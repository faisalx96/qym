"""Q2-1 / Q2-2: GET /api/runs/{id}/group-metrics?view=group against the seeded SQLite DB (FastAPI TestClient, loopback).

    QYM_DATABASE_URL=sqlite:////abs/path.db QYM_AUTH_MODE=none QYM_ENVIRONMENT=test QYM_ADMIN_BOOTSTRAP_TOKEN=x \
    PYTHONPATH=packages/sdk:packages/platform python docs/internal/ui-migration/redesign7/measure/q2_group_view.py <seed-r7.json>

For the 10 x 300 and 10 x 1,200 runs: five distinct thresholds (each is a first request for its key), each timed over HTTP and through the
handler alone; the response size (raw and gzip), the keys, the number of `run_metric_analyses` rows before and after (must stay equal), and the
default (no `view`) response for the same arguments: its first-request time and its size, so the two can be compared. Output: JSON on stdout.
"""
from __future__ import annotations

import gzip
import json
import statistics
import sys
import time

from fastapi.testclient import TestClient
from sqlalchemy import func

from qym_platform.api.runs import run_group_metrics
from qym_platform.auth import Principal
from qym_platform.db.models import RunMetricAnalysis, User
from qym_platform.db.session import SessionLocal
from qym_platform.main import app

seed = json.load(open(sys.argv[1]))
client = TestClient(app)
THRESHOLDS = (0.55, 0.6, 0.65, 0.7, 0.75)


def analyses() -> int:
    with SessionLocal() as db:
        return db.query(func.count(RunMetricAnalysis.id)).scalar()


def direct(run_id: str, threshold: float, view: str | None) -> float:
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "dev@local").first()
        t = time.perf_counter()
        run_group_metrics(run_id, metric="quality", threshold=threshold, view=view, db=db, principal=Principal(user=user, auth_type="none"))
        return (time.perf_counter() - t) * 1000


def case(name: str, run_id: str) -> dict:
    client.get(f"/api/runs/{run_id}/passes")  # warm the import graph and the connection
    before = analyses()
    http, handler = [], []
    body = b""
    for th in THRESHOLDS:
        t = time.perf_counter()
        r = client.get(f"/api/runs/{run_id}/group-metrics?metric=quality&threshold={th}&view=group")
        http.append((time.perf_counter() - t) * 1000)
        assert r.status_code == 200, r.text[:200]
        body = r.content
    after_view = analyses()
    for th in (0.8, 0.85, 0.9, 0.95, 0.99):
        handler.append(direct(run_id, th, "group"))
    keys = sorted(json.loads(body).keys())
    # the default view for one threshold nobody asked for: the bootstrap the strip no longer waits for
    t = time.perf_counter()
    full = client.get(f"/api/runs/{run_id}/group-metrics?metric=quality&threshold=0.42")
    full_ms = (time.perf_counter() - t) * 1000
    t = time.perf_counter()
    client.get(f"/api/runs/{run_id}/group-metrics?metric=quality&threshold=0.42")
    full_warm_ms = (time.perf_counter() - t) * 1000
    same = client.get(f"/api/runs/{run_id}/group-metrics?metric=quality&threshold=0.42&view=group").json()["group"] == full.json()["group"]
    return {
        "case": name,
        "run_id": run_id,
        "view_group_http_ms": [round(x, 1) for x in http],
        "view_group_http_median_ms": round(statistics.median(http), 1),
        "view_group_handler_ms": [round(x, 1) for x in handler],
        "view_group_handler_median_ms": round(statistics.median(handler), 1),
        "keys": keys,
        "payload_bytes": len(body),
        "gzip_bytes": len(gzip.compress(body)),
        "run_metric_analyses_before": before,
        "run_metric_analyses_after_view_group": after_view,
        "default_view_first_request_ms": round(full_ms, 1),
        "default_view_repeat_request_ms": round(full_warm_ms, 1),
        "default_view_bytes": len(full.content),
        "group_equal_in_both_views": same,
    }


out = {
    "r300x10": case("10 passes x 300 items", seed["repeat300"][2]),
    "r1200x10": case("10 passes x 1,200 items", seed["passes1200"]),
}
print(json.dumps(out, indent=2))
