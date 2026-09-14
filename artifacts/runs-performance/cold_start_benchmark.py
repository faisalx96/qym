"""Rebuild real PostgreSQL history under concurrent API reads, from revision zero.

Set QYM_TEST_POSTGRES_URL to a disposable database. Only a private schema is
created/dropped. This includes source rows, a worker restart, and live writes.
"""

import contextvars
import json
import os
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from uuid import uuid4

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import Session, sessionmaker
from qym_platform.api import dashboard
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.base import Base
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.models import (
    Project,
    Run,
    RunEvent,
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.services.dashboard_summaries import DashboardSummaryWorker


def benchmark(run_count=1894, users=20):
    admin = create_engine(os.environ["QYM_TEST_POSTGRES_URL"])
    schema = "qym_cold_start_" + uuid4().hex
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(
        admin.url,
        connect_args={"options": f"-csearch_path={schema}"},
        pool_pre_ping=True,
    )
    factory = sessionmaker(engine, autoflush=False)
    stop = threading.Event()
    started = time.monotonic()
    publications = {}
    worker_errors = []
    try:
        Base.metadata.create_all(engine)
        now = datetime.utcnow()
        rich_ids = {f"history-{n:04}" for n in range(run_count - 20, run_count)}
        with Session(engine) as db:
            db.info["dashboard_projection_worker"] = True
            owner = User(
                id="owner", email="benchmark@example.invalid", role=UserRole.ADMIN
            )
            db.add(owner)
            db.flush()
            db.add(
                Project(
                    id="project", slug="load", name="Load", created_by_user_id="owner"
                )
            )
            db.commit()
            _ = owner.role
            db.expunge(owner)

        def insert(model, rows):
            batch = []
            for row in rows:
                batch.append(row)
                if len(batch) == 500:
                    with engine.begin() as conn:
                        conn.execute(model.__table__.insert(), batch)
                    batch = []
            if batch:
                with engine.begin() as conn:
                    conn.execute(model.__table__.insert(), batch)

        ids = [f"history-{n:04}" for n in range(run_count)]
        counts = {rid: 501 if rid in rich_ids else 10 for rid in ids}
        insert(
            Run,
            (
                dict(
                    id=rid,
                    project_id="project",
                    created_by_user_id="owner",
                    owner_user_id="owner",
                    task="task",
                    model="model",
                    dataset="dataset",
                    metrics=["quality"],
                    samples=3 if rid in rich_ids else 1,
                    status="COMPLETED",
                    created_at=now + timedelta(seconds=n),
                    started_at=now + timedelta(seconds=n),
                    ended_at=now + timedelta(seconds=n + 1),
                    run_config={},
                    run_metadata={"total_items": counts[rid], "last_completed_pass": 3},
                )
                for n, rid in enumerate(ids)
            ),
        )
        insert(
            RunItem,
            (
                dict(
                    run_id=rid,
                    item_id=str(i),
                    input={"input": "x" * 1024},
                    output="y" * 16384,
                    error="failed" if rid in rich_ids and i == 1 else None,
                    retry_count=2 if rid in rich_ids and i == 0 else 0,
                    latency_ms=10.0,
                    item_metadata={},
                )
                for rid in ids
                for i in range(counts[rid])
            ),
        )
        insert(
            RunItemScore,
            (
                dict(
                    run_id=rid,
                    item_id=str(i),
                    metric_name="quality",
                    score_numeric=0.8,
                    meta={},
                )
                for rid in ids
                for i in range(counts[rid])
            ),
        )
        insert(
            RunItemAttempt,
            (
                dict(
                    run_id=rid,
                    item_id=str(i),
                    pass_number=p,
                    attempt_number=3 if i == 0 and p == 1 else 1,
                    is_last_attempt=True,
                    status="FAILED" if i == 1 and p == 3 else "COMPLETED",
                    latency_ms=10.0,
                )
                for rid in sorted(rich_ids)
                for p in (1, 2, 3)
                for i in range(counts[rid])
            ),
        )
        insert(
            RunItemPassScore,
            (
                dict(
                    run_id=rid,
                    item_id=str(i),
                    pass_number=p,
                    metric_name="quality",
                    score_numeric=0.0 if i == 0 and p == 2 else 0.8,
                    meta={"status": "error"} if i == 0 and p == 2 else {},
                )
                for rid in sorted(rich_ids)
                for p in (1, 2, 3)
                for i in range(counts[rid])
            ),
        )
        insert(
            RunEvent,
            (
                dict(
                    run_id=rid,
                    event_id=str(uuid4()),
                    sequence=n,
                    type=kind,
                    sent_at=now,
                    payload={
                        "item_id": str(i),
                        "pass_number": p,
                        "retry_count": retry,
                        "output": "z" * 16384,
                    },
                )
                for rid in sorted(rich_ids)
                for n, kind, i, p, retry in (
                    (1, "item_completed", 0, 1, 2),
                    (2, "item_failed", 1, 3, 0),
                )
            ),
        )
        insert(
            Partition,
            (
                dict(
                    partition_key=rid,
                    project_key="project",
                    queue_state="backfill",
                    backfill_complete=False,
                    oldest_pending_event=now - timedelta(hours=2),
                    updated_at=now,
                )
                for rid in ids
            ),
        )
        print(
            json.dumps(
                {
                    "phase": "seeded",
                    "runs": run_count,
                    "items": sum(counts.values()),
                    "repeat_runs": len(rich_ids),
                    "source_output_bytes_per_item": 16384,
                    "seconds": round(time.monotonic() - started, 1),
                }
            ),
            flush=True,
        )
        request_scope = contextvars.ContextVar("dashboard_read", default=False)
        source_queries = []

        def capture(conn, cursor, sql, *args):
            if request_scope.get() and any(
                name in sql
                for name in (
                    "run_items",
                    "run_events",
                    "run_item_scores",
                    "run_item_attempts",
                    "run_item_pass_scores",
                    "spans",
                )
            ):
                source_queries.append(sql)

        event.listen(engine, "before_cursor_execute", capture)
        app = FastAPI()
        app.include_router(dashboard.router)

        @app.middleware("http")
        async def scope(request, call_next):
            token = request_scope.set(True)
            try:
                return await call_next(request)
            finally:
                request_scope.reset(token)

        def session():
            with factory() as db:
                yield db

        app.dependency_overrides[get_db] = session
        app.dependency_overrides[require_ui_principal] = lambda: Principal(
            user=owner, auth_type="none"
        )
        started = time.monotonic()

        def write_live():
            with factory() as db:
                db.add(
                    Run(
                        id="live",
                        project_id="project",
                        created_by_user_id="owner",
                        owner_user_id="owner",
                        task="task",
                        model="model",
                        dataset="dataset",
                        metrics=["quality"],
                        status="RUNNING",
                        created_at=datetime.utcnow(),
                        started_at=datetime.utcnow(),
                        last_event_at=datetime.utcnow(),
                        run_config={},
                        run_metadata={"total_items": 1},
                    )
                )
                db.flush()
                db.add(
                    RunItem(
                        run_id="live",
                        item_id="i",
                        input="question",
                        output="answer",
                        latency_ms=5.0,
                    )
                )
                db.add(
                    RunItemScore(
                        run_id="live",
                        item_id="i",
                        metric_name="quality",
                        score_numeric=1,
                        meta={},
                    )
                )
                db.commit()
            publications["live_written_at"] = time.monotonic() - started

        def rebuild():
            worker = DashboardSummaryWorker(factory)
            try:
                for tick in range(1, 1000):
                    if stop.is_set():
                        return
                    worker.tick()
                    if tick == 2:
                        worker = DashboardSummaryWorker(factory)
                        publications["restarted_after_tick"] = tick
                        write_live()
                    if tick % 5 == 0:
                        print(
                            json.dumps(
                                {
                                    "phase": "rebuilding",
                                    "tick": tick,
                                    "seconds": round(time.monotonic() - started, 1),
                                }
                            ),
                            flush=True,
                        )
                    if stop.wait(1):
                        return
            except Exception as exc:
                worker_errors.append(repr(exc))

        timings = []
        last = None
        with TestClient(app) as client, ThreadPoolExecutor(
            max_workers=users + 1
        ) as pool:

            def read(_):
                begin = time.monotonic()
                response = client.post(
                    "/api/dashboard/runs",
                    json={
                        "project_slug": "load",
                        "limit": 50,
                        "include_overview": True,
                    },
                )
                response.raise_for_status()
                return (time.monotonic() - begin) * 1000, response.json()

            initial = read(0)[1]
            assert (
                initial["revision"] == 0
                and initial["freshness"]["unpublished_runs"] == run_count
            )
            background = pool.submit(rebuild)
            try:
                while time.monotonic() - started < 180:
                    batch = list(pool.map(read, range(users)))
                    for elapsed, payload in batch:
                        timings.append(elapsed)
                        assert payload["freshness"]["failed_partitions"] == 0
                        for row in payload["rows"]:
                            if row["run_id"] == "live":
                                publications.setdefault(
                                    "live_visible_seconds", time.monotonic() - started
                                )
                                assert (
                                    row["total_items"] == 1
                                    and row["metric_averages"]["quality"] == 1
                                )
                            elif row["run_id"] in rich_ids:
                                publications.setdefault(
                                    "first_history_seconds", time.monotonic() - started
                                )
                                assert row["total_items"] == 501
                                assert row["execution_error_count"] == 2
                                assert row["total_retries"] == 2
                                assert [
                                    p["error_count"] for p in row["pass_summaries"]
                                ] == [0, 1, 1]
                        last = payload
                    if (
                        "first_history_seconds" in publications
                        and "live_visible_seconds" in publications
                    ):
                        break
                    if worker_errors:
                        raise AssertionError(worker_errors)
                    time.sleep(0.5)
                else:
                    raise AssertionError(
                        "No complete initial history publication within 180 seconds"
                    )
            finally:
                stop.set()
                background.result(timeout=60)
        assert not source_queries and not worker_errors
        timings.sort()
        print(
            json.dumps(
                {
                    "phase": "result",
                    "runs": run_count,
                    "users": users,
                    "requests": len(timings),
                    "request_p50_ms": round(statistics.median(timings), 1),
                    "request_p95_ms": round(timings[int(len(timings) * 0.95) - 1], 1),
                    "first_history_seconds": round(
                        publications["first_history_seconds"], 1
                    ),
                    "live_publish_latency_seconds": round(
                        publications["live_visible_seconds"]
                        - publications["live_written_at"],
                        1,
                    ),
                    "restarted_after_tick": publications["restarted_after_tick"],
                    "unpublished_remaining": last["freshness"]["unpublished_runs"],
                    "revision": last["revision"],
                    "request_source_history_queries": len(source_queries),
                    "verified": "complete item/error/retry/pass counts",
                }
            ),
            flush=True,
        )
    finally:
        stop.set()
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    benchmark()
