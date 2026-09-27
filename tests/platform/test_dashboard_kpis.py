"""C011: one server-side KPI definition for Overview cards and every topbar."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.db.dashboard_models import (
    DashboardPartitionState as Partition,
    DashboardRunDimension as Dimension,
    DashboardRunSummary as Summary,
)
from qym_platform.db.models import RunItemScore, RunWorkflowStatus

from test_dashboard_durable_summaries import database, drain, item, run
from test_dashboard_projection_api import dataset, get


def add_run(
    db,
    run_id,
    *,
    task="qa",
    model="gpt|||plain",
    data=None,
    project="project",
    status="COMPLETED",
    revision=1,
    present=True,
    hidden=False,
    index=0,
):
    stamp = datetime(2026, 9, 1) + timedelta(hours=index)
    db.add(
        Dimension(
            run_key=run_id,
            project_key=project,
            task=task,
            model=model,
            dataset="dataset",
            version="",
            owner="owner",
            status=status,
            timestamp=stamp,
            created_at=stamp,
            present=present,
            hidden_at=stamp if hidden else None,
            descriptor={
                "run_id": run_id,
                "file_path": run_id,
                "task_name": task,
                "model_name": model.split("|||")[0],
                "dataset_name": "dataset",
                "timestamp": stamp.isoformat() + "Z",
                "metrics": ["accuracy"],
            },
        )
    )
    db.add(
        Summary(
            run_key=run_id,
            project_key=project,
            data=data or {},
            projection_revision=revision,
            applied_source_version=index + 1,
        )
    )
    db.add(
        Partition(
            partition_key=run_id,
            project_key=project,
            last_enqueued_version=index + 1,
            last_applied_version=index + 1,
            queue_state="ready",
            backfill_complete=True,
        )
    )


def published(items, successes, task_errors=0, metric_errors=0):
    return {
        "total_items": items,
        "success_count": successes,
        "error_count": items - successes,
        "success_rate": successes / items if items else 0.0,
        "task_error_count": task_errors,
        "metric_error_count": metric_errors,
    }


def seed_kpi_project(engine):
    with Session(engine) as db:
        # Clean, large run: dominates the item-weighted success.
        add_run(db, "clean", data=published(100, 100), index=0)
        # Reasoning variant of the same model; half of its items failed.
        add_run(
            db,
            "task-errors",
            model="gpt|||reasoning",
            data=published(10, 5, task_errors=5),
            index=1,
        )
        # Scorer errors only: execution success stays 100% but the run has errors.
        add_run(
            db,
            "metric-errors",
            task="sql",
            model="claude|||plain",
            data=published(50, 50, metric_errors=3),
            index=2,
        )
        # A summary published before the task/metric split, and no model name.
        add_run(
            db,
            "legacy",
            task="sql",
            model="nomodel|||plain",
            data={"total_items": 40, "success_count": 39, "error_count": 1},
            index=3,
        )
        # Listed but not yet published: counts as a run, contributes no items.
        add_run(
            db,
            "pending",
            model="mistral|||plain",
            status="RUNNING",
            revision=0,
            index=4,
        )
        # Never in scope: deleted, hidden, or another project.
        add_run(db, "hidden", data=published(1000, 0, task_errors=1000), hidden=True)
        add_run(db, "absent", data=published(1000, 0, task_errors=1000), present=False)
        add_run(
            db,
            "other",
            project="private",
            model="llama|||plain",
            data=published(1000, 0, task_errors=1000),
        )
        db.commit()


def test_project_kpis_weight_success_by_items_and_count_runs_with_errors(dataset):
    engine, client, _ = dataset
    seed_kpi_project(engine)

    body = get(client, "kpis").json()

    assert body["kpis"] == {
        "scope": "project",
        "runs": 5,
        # gpt (both variants) + claude + mistral; the model-less run is not a model.
        "models": 3,
        "items": 200,
        # (100 + 5 + 50 + 39) / 200, not the unweighted mean of run rates (0.87).
        "execution_success": pytest.approx(194 / 200),
        "runs_with_errors": 3,
    }
    assert body["project"]["slug"] == "project"
    assert body["freshness"]["updating"] is False


def test_filtered_kpis_state_their_scope(dataset):
    engine, client, _ = dataset
    seed_kpi_project(engine)

    qa = get(client, "kpis", filters={"tasks": ["qa"]}).json()["kpis"]
    assert qa == {
        "scope": "filtered",
        "runs": 3,
        "models": 2,
        "items": 110,
        "execution_success": pytest.approx(105 / 110),
        "runs_with_errors": 1,
    }
    variant = get(client, "kpis", filters={"models": ["gpt|||reasoning"]}).json()
    assert variant["kpis"]["runs"] == 1
    assert variant["kpis"]["execution_success"] == pytest.approx(0.5)
    none = get(client, "kpis", filters={"tasks": ["__none__"]}).json()["kpis"]
    assert none == {
        "scope": "filtered",
        "runs": 0,
        "models": 0,
        "items": 0,
        "execution_success": None,
        "runs_with_errors": 0,
    }


def test_every_surface_reads_the_same_kpis(dataset):
    """Overview cards, the Runs/Charts/Models topbar and POST all agree."""
    engine, client, _ = dataset
    seed_kpi_project(engine)

    for filters in ({}, {"tasks": ["sql"]}):
        kpis = get(client, "kpis", filters=filters).json()["kpis"]
        posted = client.post(
            "/api/dashboard/kpis",
            json={"project_slug": "project", "filters": filters},
        ).json()["kpis"]
        overview = get(client, "overview", filters=filters).json()
        runs_page = client.post(
            "/api/dashboard/runs",
            json={
                "project_slug": "project",
                "filters": filters,
                "include_overview": True,
            },
        ).json()
        assert posted == kpis
        assert overview["kpis"] == kpis
        assert runs_page["overview"]["kpis"] == kpis
        # The run count is the same number the table footer reports.
        assert kpis["runs"] == overview["total_runs"] == runs_page["total_runs"]
    assert get(client, "overview").json()["kpis"]["runs"] == 5


def test_kpis_endpoint_validates_like_other_dashboard_reads(dataset):
    _, client, _ = dataset
    assert get(client, "kpis", filters={"unknown": []}).status_code == 400
    assert (
        client.post("/api/dashboard/kpis", json={"sort": "time-desc"}).status_code
        == 400
    )
    response = client.get(
        "/api/dashboard/kpis",
        params={"project_slug": "private", "filters": json.dumps({})},
    )
    assert response.status_code == 403


def test_kpis_follow_published_projection_errors(database):
    """Task and scorer errors from real summaries both mark a run as errored."""
    with Session(database) as db:
        run(db, "task-run", status=RunWorkflowStatus.COMPLETED)
        item(db, "a", run_id="task-run")
        item(db, "b", run_id="task-run")
        item(db, "c", run_id="task-run", output=None, error="Timeout")
        run(db, "scorer-run", status=RunWorkflowStatus.COMPLETED, model="other/m2")
        item(db, "a", run_id="scorer-run")
        db.add(
            RunItemScore(
                run_id="scorer-run",
                item_id="a",
                metric_name="score",
                score_numeric=None,
                meta={"status": "error", "error": "Judge failed"},
            )
        )
        run(db, "clean-run", status=RunWorkflowStatus.COMPLETED)
        item(db, "a", run_id="clean-run")
        db.commit()
    drain(database)

    with Session(database) as db:
        project = {"id": "p"}
        kpis = dashboard._kpis(db, dashboard._base_conditions(project), filtered=False)
        rates = [
            summary.data["success_rate"]
            for summary in db.query(Summary).order_by(Summary.run_key)
        ]
    assert kpis["runs"] == 3
    assert kpis["models"] == 2
    assert kpis["items"] == 5
    assert kpis["execution_success"] == pytest.approx(4 / 5)
    assert kpis["execution_success"] != pytest.approx(sum(rates) / len(rates))
    assert kpis["runs_with_errors"] == 2
