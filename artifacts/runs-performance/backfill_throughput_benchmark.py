"""Measure complete historical backfill through the deployed /qym entry point.

Uses a private schema in QYM_TEST_POSTGRES_URL and drops only that schema.
"""

import json
import os
import statistics
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from qym_platform import deps, main
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db import session as db_session
from qym_platform.db.base import Base
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.models import Project, Run, RunItem, RunItemScore, User, UserRole
from qym_platform.settings import PlatformSettings


def benchmark(count=200, items=20, readers=20):
    admin = create_engine(os.environ["QYM_TEST_POSTGRES_URL"])
    schema = "qym_backfill_speed_" + uuid4().hex
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(
        admin.url, connect_args={"options": f"-csearch_path={schema}"}
    )
    factory = sessionmaker(engine, autoflush=False)
    try:
        Base.metadata.create_all(engine)
        now = datetime(2026, 9, 1)
        with Session(engine) as db:
            db.add(User(id="owner", email="load@example.invalid", role=UserRole.ADMIN))
            db.flush()
            db.add(
                Project(
                    id="project", slug="load", name="Load", created_by_user_id="owner"
                )
            )
            db.commit()
            owner = db.get(User, "owner")
            db.expunge(owner)
        with engine.begin() as conn:
            conn.execute(
                Run.__table__.insert(),
                [
                    dict(
                        id=f"run-{n:04}",
                        project_id="project",
                        owner_user_id="owner",
                        created_by_user_id="owner",
                        task="task",
                        model="model",
                        dataset="dataset",
                        metrics=["quality"],
                        status="COMPLETED",
                        created_at=now + timedelta(seconds=n),
                        started_at=now + timedelta(seconds=n),
                        run_config={},
                        run_metadata={"total_items": items},
                    )
                    for n in range(count)
                ],
            )
            conn.execute(
                Partition.__table__.insert(),
                [
                    dict(
                        partition_key=f"run-{n:04}",
                        project_key="project",
                        queue_state="backfill",
                        backfill_complete=False,
                    )
                    for n in range(count)
                ],
            )
        for n in range(count):
            with engine.begin() as conn:
                conn.execute(
                    RunItem.__table__.insert(),
                    [
                        dict(
                            run_id=f"run-{n:04}",
                            item_id=str(i),
                            input={"input": "x" * 1024},
                            output="y" * 65536,
                            error="failed" if i % 7 == 0 else None,
                            latency_ms=10.0,
                            item_metadata={},
                        )
                        for i in range(items)
                    ],
                )
                conn.execute(
                    RunItemScore.__table__.insert(),
                    [
                        dict(
                            run_id=f"run-{n:04}",
                            item_id=str(i),
                            metric_name="quality",
                            score_numeric=0.8,
                            meta={},
                        )
                        for i in range(items)
                    ],
                )
        sql_stats = defaultdict(lambda: [0, 0.0])

        def before(conn, cursor, sql, params, context, many):
            if threading.current_thread().name == "qym-dashboard-summary":
                context.benchmark_started = time.perf_counter()

        def after(conn, cursor, sql, params, context, many):
            if hasattr(context, "benchmark_started"):
                entry = sql_stats[sql.splitlines()[0][:120]]
                entry[0] += 1
                entry[1] += time.perf_counter() - context.benchmark_started

        event.listen(engine, "before_cursor_execute", before)
        event.listen(engine, "after_cursor_execute", after)
        settings = PlatformSettings(
            environment="test",
            auth_mode="none",
            auth_local_enabled=False,
            root_path="/qym",
        )
        durations, ticks = [], []
        first = None
        with patch.object(db_session, "SessionLocal", factory), patch.object(
            deps, "SessionLocal", factory
        ), patch.object(main, "PlatformSettings", return_value=settings):
            app = main.build_app()
            inner = next(route.app for route in app.routes if route.path == "/qym")
            inner.dependency_overrides[require_ui_principal] = lambda: Principal(
                user=owner, auth_type="none"
            )
            worker = inner.state.dashboard_summary_worker
            original_tick = worker.tick

            def tick():
                start = time.monotonic()
                result = original_tick()
                ticks.append(time.monotonic() - start)
                return result

            worker.tick = tick
            start = time.monotonic()
            with TestClient(app) as client, ThreadPoolExecutor(
                max_workers=readers
            ) as pool:
                assert worker._thread and worker._thread.is_alive()

                def read(_):
                    begin = time.monotonic()
                    response = client.post(
                        "/qym/api/dashboard/runs",
                        json={"project_slug": "load", "limit": 50},
                    )
                    response.raise_for_status()
                    return (time.monotonic() - begin) * 1000, response.json()

                while time.monotonic() - start < 300:
                    batch = list(pool.map(read, range(readers)))
                    for elapsed, payload in batch:
                        durations.append(elapsed)
                        assert payload["freshness"]["failed_partitions"] == 0
                        if payload["rows"]:
                            first = first or time.monotonic() - start
                            assert all(
                                row["total_items"] == items for row in payload["rows"]
                            )
                            assert all(
                                row["error_count"] == 3 for row in payload["rows"]
                            )
                    last = batch[-1][1]
                    if not last["freshness"]["updating"]:
                        break
                    time.sleep(0.25)
                else:
                    raise AssertionError("Backfill did not finish in 300 seconds")
                elapsed = time.monotonic() - start
                assert last["total_count"] == count
        durations.sort()
        print(
            json.dumps(
                dict(
                    runs=count,
                    source_items=count * items,
                    output_bytes_per_item=65536,
                    readers=readers,
                    complete_seconds=round(elapsed, 2),
                    first_seconds=round(first, 2),
                    ticks=len(ticks),
                    tick_work_seconds=round(sum(ticks), 2),
                    requests=len(durations),
                    request_p50_ms=round(statistics.median(durations), 1),
                    request_p95_ms=round(durations[int(len(durations) * 0.95) - 1], 1),
                    worker_sql_queries=sum(value[0] for value in sql_stats.values()),
                    slowest_sql=sorted(
                        [
                            dict(sql=sql, calls=v[0], seconds=round(v[1], 3))
                            for sql, v in sql_stats.items()
                        ],
                        key=lambda v: v["seconds"],
                        reverse=True,
                    )[:8],
                )
            ),
            flush=True,
        )
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    benchmark()
