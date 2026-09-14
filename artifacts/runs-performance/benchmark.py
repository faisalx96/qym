"""PostgreSQL read load for 5,000 published runs while summaries refresh.

Set QYM_TEST_POSTGRES_URL to a disposable PostgreSQL database. Creates and drops
its own schema. No production table is read or changed. Timing covers ASGI,
serialization and PostgreSQL on this host, not internet/proxy/browser latency.
"""

import concurrent.futures
import json
import os
import statistics
import threading
import time
from datetime import datetime, timedelta
from uuid import uuid4

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session
from qym_platform.api import dashboard, runs
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.base import Base
from qym_platform.db.dashboard_models import (
    DashboardRunDimension as Dimension,
    DashboardRunSummary as Summary,
    DashboardPartitionState as Partition,
)
from qym_platform.db.models import Project, Run, User, UserRole
from qym_platform.deps import get_db


def benchmark(count=5000, concurrency=20, iterations=3):
    url = os.environ["QYM_TEST_POSTGRES_URL"]
    schema = "qym_runs_load_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(
        url, connect_args={"options": f"-csearch_path={schema}"}, pool_pre_ping=True
    )
    try:
        Base.metadata.create_all(engine)
        now = datetime(2026, 9, 1)
        with Session(engine) as db:
            db.info["dashboard_projection_worker"] = True
            owner = User(id="owner", email="load@example.invalid", role=UserRole.ADMIN)
            db.add(owner)
            db.flush()
            db.add(
                Project(
                    id="project", slug="load", name="Load", created_by_user_id="owner"
                )
            )
            db.flush()
            source = []
            dimensions = []
            summaries = []
            partitions = []
            for i in range(count):
                rid = f"run-{i:06}"
                created = now + timedelta(seconds=i)
                descriptor = dict(
                    run_id=rid,
                    file_path=rid,
                    run_name=rid,
                    task_name=f"task-{i%4}",
                    model_name=f"model-{i%5}",
                    dataset_name=f"dataset-{i%3}",
                    timestamp=created.isoformat() + "Z",
                    metrics=["quality", "accuracy"],
                    samples=3,
                    status="COMPLETED",
                    owner={
                        "id": "owner",
                        "email": "load@example.invalid",
                        "display_name": "Owner",
                    },
                    metric_specs={},
                    run_config={},
                    config_group_key="group",
                )
                data = dict(
                    total_items=1000,
                    success_count=990,
                    error_count=10,
                    execution_error_count=15,
                    total_retries=12,
                    metric_averages={"quality": (i % 101) / 100, "accuracy": 0.9},
                    avg_latency_ms=100.0,
                    median_latency_ms=90.0,
                    duration_ms=10000.0,
                    success_rate=0.99,
                    progress_completed=1000,
                    progress_total=1000,
                    progress_pct=1.0,
                    pass_summaries=[
                        dict(
                            pass_number=p,
                            status="completed",
                            primary_score=0.9,
                            error_count=5,
                            retry_count=4,
                            analysis_cause_count=1,
                        )
                        for p in (1, 2, 3)
                    ],
                    analysis_cause_count=3,
                )
                source.append(
                    dict(
                        id=rid,
                        project_id="project",
                        created_by_user_id="owner",
                        owner_user_id="owner",
                        task=descriptor["task_name"],
                        model=descriptor["model_name"],
                        dataset=descriptor["dataset_name"],
                        metrics=descriptor["metrics"],
                        samples=3,
                        status="COMPLETED",
                        created_at=created,
                        started_at=created,
                        ended_at=created,
                        run_metadata={},
                        run_config={},
                    )
                )
                dimensions.append(
                    dict(
                        run_key=rid,
                        project_key="project",
                        task=descriptor["task_name"],
                        model=descriptor["model_name"] + "|||plain",
                        dataset=descriptor["dataset_name"],
                        version="",
                        owner="owner",
                        status="COMPLETED",
                        timestamp=created,
                        created_at=created,
                        present=True,
                        descriptor=descriptor,
                    )
                )
                summaries.append(
                    dict(
                        run_key=rid,
                        project_key="project",
                        projection_revision=1,
                        data=data,
                        avg_latency_ms=100.0,
                        median_latency_ms=90.0,
                        success_rate=0.99,
                    )
                )
                partitions.append(
                    dict(
                        partition_key=rid,
                        project_key="project",
                        queue_state="backfill",
                        backfill_complete=False,
                        last_applied_version=1,
                        last_enqueued_version=1,
                    )
                )
            for model, data in (
                (Run, source),
                (Dimension, dimensions),
                (Summary, summaries),
                (Partition, partitions),
            ):
                db.bulk_insert_mappings(model, data)
            db.commit()
            principal = Principal(user=owner, auth_type="none")
            _ = owner.id, owner.role
            db.expunge(owner)
        app = FastAPI()
        app.include_router(dashboard.router)
        app.include_router(runs.router)

        def session():
            with Session(engine) as db:
                yield db

        app.dependency_overrides[get_db] = session
        app.dependency_overrides[require_ui_principal] = lambda: principal
        source_queries = []

        def capture(conn, cursor, sql, *args):
            if any(
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
        with TestClient(app) as client:

            def request(kind, filters=None):
                start = time.perf_counter()
                if kind == "dashboard":
                    response = client.post(
                        "/api/dashboard/runs",
                        json={
                            "project_slug": "load",
                            "limit": 50,
                            "include_overview": True,
                            "filters": filters or {},
                        },
                    )
                else:
                    response = client.get(
                        "/api/runs", params={"project_slug": "load", "limit": 100}
                    )
                elapsed = (time.perf_counter() - start) * 1000
                response.raise_for_status()
                payload = response.json()
                assert payload["total_count"] == count
                assert payload["freshness"]["backfilling"]
                return elapsed, len(response.content)

            for kind in ("dashboard", "legacy"):
                cold, size = request(kind)
                serial = [request(kind)[0] for _ in range(3)]
                timings = []
                with concurrent.futures.ThreadPoolExecutor(
                    max_workers=concurrency
                ) as pool:
                    for _ in range(iterations):
                        barrier = threading.Barrier(concurrency)

                        def synchronized(_):
                            barrier.wait()
                            return request(kind)[0]

                        timings.extend(pool.map(synchronized, range(concurrency)))
                timings.sort()
                print(
                    json.dumps(
                        dict(
                            endpoint=kind,
                            runs=count,
                            concurrency=concurrency,
                            requests=len(timings),
                            cold_ms=round(cold, 1),
                            warm_serial_median_ms=round(statistics.median(serial), 1),
                            concurrent_p50_ms=round(statistics.median(timings), 1),
                            concurrent_p95_ms=round(
                                timings[int(len(timings) * 0.95) - 1], 1
                            ),
                            max_ms=round(max(timings), 1),
                            response_bytes=size,
                            source_payload_queries=len(source_queries),
                        )
                    ),
                    flush=True,
                )
            # Exercise simultaneous cold requests and different user filters,
            # not only repeated hits on a single warmed query.
            from qym_platform.services.dashboard_cache import DashboardSnapshotCache

            for case, varied in (
                ("cold_same_query", False),
                ("cold_distinct_filters", True),
            ):
                dashboard._page_cache = DashboardSnapshotCache()
                dashboard._overview_cache = DashboardSnapshotCache()
                dashboard._catalog_cache = DashboardSnapshotCache(
                    max_entries=4, max_bytes=16 * 1024 * 1024
                )
                barrier = threading.Barrier(concurrency)

                def cold(index):
                    barrier.wait()
                    filters = (
                        {
                            "tasks": [f"task-{index%4}"],
                            "models": [f"model-{index%5}|||plain"],
                        }
                        if varied
                        else None
                    )
                    return request("dashboard", filters)[0]

                with concurrent.futures.ThreadPoolExecutor(
                    max_workers=concurrency
                ) as pool:
                    timings = sorted(pool.map(cold, range(concurrency)))
                print(
                    json.dumps(
                        dict(
                            endpoint="dashboard",
                            case=case,
                            runs=count,
                            concurrency=concurrency,
                            p50_ms=round(statistics.median(timings), 1),
                            p95_ms=round(timings[int(len(timings) * 0.95) - 1], 1),
                            source_payload_queries=len(source_queries),
                        )
                    ),
                    flush=True,
                )
            # Publish once per second during sustained concurrent reads. Every
            # committed revision must invalidate cached results automatically.
            stopped = threading.Event()
            publications = []

            def publish():
                while not stopped.wait(1):
                    with engine.begin() as db:
                        db.execute(
                            Summary.__table__.update()
                            .where(Summary.run_key == "run-000000")
                            .values(projection_revision=Summary.projection_revision + 1)
                        )
                    publications.append(1)

            with concurrent.futures.ThreadPoolExecutor(
                max_workers=concurrency + 1
            ) as pool:
                writer = pool.submit(publish)
                timings = []
                started = time.perf_counter()
                try:
                    for _ in range(10):
                        timings.extend(
                            pool.map(
                                lambda _: request("dashboard")[0], range(concurrency)
                            )
                        )
                finally:
                    stopped.set()
                    writer.result()
            timings.sort()
            print(
                json.dumps(
                    dict(
                        endpoint="dashboard",
                        case="live_publications",
                        runs=count,
                        concurrency=concurrency,
                        requests=len(timings),
                        elapsed_seconds=round(time.perf_counter() - started, 1),
                        publications=len(publications),
                        p50_ms=round(statistics.median(timings), 1),
                        p95_ms=round(timings[int(len(timings) * 0.95) - 1], 1),
                        source_payload_queries=len(source_queries),
                    )
                ),
                flush=True,
            )
        assert not source_queries
    finally:
        engine.dispose()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    benchmark()
