"""Projection backfill, read through the dashboard API only.

Replaces ``test_real_unprojected_history_matches_after_backfill`` of the former
``test_dashboard_backfill_browser.py``: while a project's history is still being
projected the API serves what is published and says how much is missing; once the
worker catches up the summary rows equal the source rows, with timestamp ties
paging cleanly. The disclosure copy is frontend/e2e/runs-list/cutover-backfill.spec.ts.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from qym_platform.api import dashboard, runs
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.models import Project, RunItemScore, RunWorkflowStatus, User
from qym_platform.deps import get_db
from qym_platform.services import dashboard_summaries as service
from test_dashboard_durable_summaries import drain, item, run


@pytest.mark.parametrize(
    "run_count,tied_timestamps",
    [(123, False), (501, True)],
    ids=["distinct-timestamps", "tied-timestamps"],
)
def test_real_unprojected_history_matches_after_backfill(database, run_count, tied_timestamps):  # noqa: F811
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        db.get(Project, "p").slug = "demo"
        for index in range(run_count):
            run_id = f"real-{index:03}"
            run(
                db,
                run_id=run_id,
                status=RunWorkflowStatus.COMPLETED,
                created_at=datetime(2026, 9, 1) + timedelta(minutes=0 if tied_timestamps else index),
                run_metadata={"total_items": 2},
            )
            item(db, run_id=run_id, latency_ms=index + 1)
            item(db, item_id="failed", run_id=run_id, status="error", error="failed", latency_ms=50)
            db.add(RunItemScore(run_id=run_id, item_id="i", metric_name="score", score_numeric=(index % 10) / 10))
        db.commit()
        service.bootstrap_partitions(db, limit=run_count)
        db.commit()

    app = FastAPI()
    app.include_router(runs.router)
    app.include_router(dashboard.router)

    def session():
        with Session(database) as db:
            yield db

    with Session(database) as db:
        owner = db.get(User, "u")
        db.expunge(owner)
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_ui_principal] = lambda: Principal(user=owner, auth_type="none")

    def source_rows():
        found = {}
        for offset in range(0, run_count, 100):
            response = client.get(
                "/api/runs",
                params={"project_slug": "demo", "limit": 100, "offset": offset, "include_total": offset == 0},
            )
            assert response.status_code == 200
            for models in response.json()["tasks"].values():
                for group in models.values():
                    for row in group:
                        found[row["run_id"]] = row
        return found

    with TestClient(app) as client:
        if tied_timestamps:
            # LIMIT/OFFSET can return overlapping timestamp ties in PostgreSQL even
            # without concurrent writes: check every source page first.
            expected_order = [f"real-{index:03}" for index in range(run_count)]
            ids = []
            for offset in range(0, run_count, 100):
                response = client.get(
                    "/api/runs",
                    params={"project_slug": "demo", "limit": 100, "offset": offset, "include_total": offset == 0},
                )
                ids.extend(
                    row["run_id"]
                    for models in response.json()["tasks"].values()
                    for rows in models.values()
                    for row in rows
                )
            assert ids == expected_order

        expected = source_rows()

        # Nothing is published yet: no rows, the whole history is announced as missing.
        before = client.post("/api/dashboard/runs", json={"project_slug": "demo", "limit": 50}).json()
        assert before["rows"] == []
        assert before["freshness"]["backfilling"] is True
        assert before["freshness"]["unpublished_runs"] == run_count

        worker = service.DashboardSummaryWorker(sessionmaker(database, autoflush=False), max_partitions=4)
        for _ in range(2):
            worker.tick()
        partial = client.post("/api/dashboard/runs", json={"project_slug": "demo", "limit": 50}).json()
        assert partial["freshness"]["backfilling"] is True
        assert 0 < len(partial["rows"]) < 50
        first = partial["rows"][0]
        assert first["total_items"] == 2 and first["error_count"] == 1
        assert first["metric_averages"] == expected[first["run_id"]]["metric_averages"]

        drain(database, max_partitions=50)
        done = client.post("/api/dashboard/runs", json={"project_slug": "demo", "limit": 50, "include_overview": True}).json()
        assert done["freshness"]["backfilling"] is False
        assert done["total_runs"] == run_count and len(done["rows"]) == 50
        for actual in done["rows"]:
            for key in (
                "total_items",
                "success_count",
                "error_count",
                "metric_averages",
                "avg_latency_ms",
                "median_latency_ms",
                "status",
            ):
                assert actual[key] == expected[actual["run_id"]][key], (actual["run_id"], key)
