"""Q2: profile GET /api/runs/{id}/passes in-process (FastAPI TestClient against the seeded SQLite DB).

    QYM_DATABASE_URL=sqlite:////abs/path.db QYM_AUTH_MODE=none QYM_ENVIRONMENT=test QYM_ADMIN_BOOTSTRAP_TOKEN=x \
    PYTHONPATH=packages/sdk:packages/platform python docs/internal/ui-migration/redesign7/measure/passes_profile.py \
        <seed-r7.json> [reps]

Prints, for a 10-pass run over 300 items and the 10-pass run over 1,200 items: wall time (median / p95 of `reps`),
payload bytes, the number of SQL statements, the time spent in the database, the slowest statements, and the top
Python functions by cumulative time (cProfile of one request). Output is JSON on stdout.
"""
from __future__ import annotations

import cProfile
import io
import json
import pstats
import statistics
import sys
import time

from fastapi.testclient import TestClient
from sqlalchemy import event

from qym_platform.db.session import engine  # noqa: E402
from qym_platform.api.runs import run_passes
from qym_platform.auth import Principal
from qym_platform.db.models import User
from qym_platform.db.session import SessionLocal
from qym_platform.main import app

seed = json.load(open(sys.argv[1]))
reps = int(sys.argv[2]) if len(sys.argv) > 2 else 9
client = TestClient(app)

statements: list[dict] = []
_t: dict = {}


@event.listens_for(engine, "before_cursor_execute")
def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
    _t["t"] = time.perf_counter()


@event.listens_for(engine, "after_cursor_execute")
def _after(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
    statements.append(
        {
            "ms": (time.perf_counter() - _t["t"]) * 1000,
            "rows": cursor.rowcount,
            "sql": " ".join(statement.split())[:170],
        }
    )


def direct(run_id: str) -> float:
    """The handler alone (no HTTP, no thread hop), so cProfile sees it."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "dev@local").first()
        t = time.perf_counter()
        run_passes(run_id, db=db, principal=Principal(user=user, auth_type="none"))
        return (time.perf_counter() - t) * 1000


def one(run_id: str) -> tuple[float, int]:
    t = time.perf_counter()
    r = client.get(f"/api/runs/{run_id}/passes")
    dt = (time.perf_counter() - t) * 1000
    assert r.status_code == 200, r.text[:200]
    return dt, len(r.content)


def case(name: str, run_id: str) -> dict:
    one(run_id)  # warm the connection and the import graph
    times = [one(run_id)[0] for _ in range(reps)]
    size = one(run_id)[1]
    direct(run_id)
    direct_times = [direct(run_id) for _ in range(reps)]
    statements.clear()
    direct(run_id)
    sql_total = sum(s["ms"] for s in statements)
    top = sorted(statements, key=lambda s: -s["ms"])[:6]
    prof = cProfile.Profile()
    prof.enable()
    direct(run_id)
    prof.disable()
    buf = io.StringIO()
    pstats.Stats(prof, stream=buf).sort_stats("cumulative").print_stats(22)
    return {
        "case": name,
        "run_id": run_id,
        "wall_ms": {"median": round(statistics.median(times), 1), "p95": round(sorted(times)[int(0.95 * (len(times) - 1))], 1), "min": round(min(times), 1), "max": round(max(times), 1)},
        "handler_ms": {"median": round(statistics.median(direct_times), 1), "min": round(min(direct_times), 1)},
        "payload_bytes": size,
        "sql_statements": len(statements),
        "sql_ms_total": round(sql_total, 1),
        "slowest_sql": [{"ms": round(s["ms"], 1), "rows": s["rows"], "sql": s["sql"]} for s in top],
        "cprofile_top": [ln for ln in buf.getvalue().splitlines() if ln.strip()][:24],
    }


out = {
    "reps": reps,
    "r300": case("10 passes x 300 items", seed["repeat300"][0]),
    "r1200": case("10 passes x 1200 items", seed["passes1200"]),
}
print(json.dumps(out, indent=2))
