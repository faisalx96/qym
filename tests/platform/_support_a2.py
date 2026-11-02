"""Shared fixtures for the API-level pytest suites that replaced the vanilla-dashboard browser tests.

- ``source_run_api``: the real runs router over an in-memory DB seeded with two
  3-pass runs (``payload``-shaped rows), as the former ``test_performance_views_browser``.
- ``_publish``: settle the runs-list projection (former ``test_archived_project_browser``).
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone


def payload(run_id="run-1", count=260, samples=1):
    rows = []
    for i in range(count):
        output = f"Answer {i}\nneedle-{i} " + ("a" * 400)
        if i == count - 1:
            output = json.dumps({"late_only_field": "last", "answer": output})
        if run_id == "run-2" and i % 2:
            output += " changed"
        row = {
            "item_id": f"item-{i}",
            "compare_item_id": f"aligned-{i}",
            "index": i,
            "input": f"Question {i}",
            "input_full": f"Question {i}",
            "expected": f"Expected {i}",
            "expected_full": f"Expected {i}",
            "output": output,
            "output_full": output,
            "metric_values": [i % 2, i],
            "status": "error" if i == 23 else "completed",
            "error": "timeout: upstream" if i == 23 else "",
            "latency_ms": i * 10,
            "metric_meta": {
                "accuracy": {
                    "explanation": "Judge explanation " + str(i),
                    "modified": i == 7,
                },
                "count": {},
            },
            "item_metadata": {
                "complexity": "hard" if i % 3 else "easy",
                "domain": "finance",
                "root_cause": "Reasoning Error" if i % 2 == 0 else "",
            },
            "retry_count": i % 3,
            "review_correction_status": "approved" if i == 5 else "",
        }
        if samples > 1:
            row["pass_scores"] = {"accuracy": [0, 1, i % 2], "count": [i, i + 1, i + 2]}
            row["pass_metric_meta"] = {
                "accuracy": [
                    {"explanation": f"pass-{p} judge {i}"} for p in range(1, 4)
                ]
            }
            row["pass_attempts"] = [
                {
                    "pass_number": p,
                    "status": "completed",
                    "output": f"pass-{p} output {i}",
                    "latency_ms": i + p,
                    "retry_count": p - 1,
                }
                for p in range(1, 4)
            ]
        rows.append(row)
    return {
        "run": {
            "run_id": run_id,
            "file_path": run_id,
            "run_name": run_id,
            "model_name": run_id,
            "task_name": "task",
            "dataset_name": "dataset",
            "metric_names": ["accuracy", "count"],
            "status": "COMPLETED",
            "samples": samples,
            "can_edit": True,
            "compare_alignment_status": "aligned",
            "project": {"slug": "demo", "name": "Demo"},
            "config": {},
            "metadata": {},
            "owner": {"id": "user-1", "display_name": "User"},
        },
        "snapshot": {
            "rows": rows,
            "stats": {"total": count, "completed": count},
            "metric_names": ["accuracy", "count"],
            "metric_specs": {
                "accuracy": {"score_type": "boolean", "direction": "maximize"},
                "count": {"score_type": "number", "direction": "maximize"},
            },
        },
    }


@contextmanager
def source_run_api(count=61, seed_issues=False, meta_hook=None):
    """Real source rows, repeats and score mutations behind the shipped pages.

    ``meta_hook(kind, run_id, index, metric, pass_number)`` may return the ``meta``
    stored on a run-level (``kind="score"``) or pass-level (``kind="pass"``) score.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from qym_platform.api.runs import router
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db.base import Base
    from qym_platform.db.models import (
        Project,
        Run,
        RunItem,
        RunItemAttempt,
        RunItemPassScore,
        RunItemScore,
        RunMetricSpec,
        RunWorkflowStatus,
        User,
        UserRole,
    )
    from qym_platform.deps import get_db

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id="user-1",
            email="source@example.test",
            display_name="User",
            role=UserRole.ADMIN,
        )
        db.add(user)
        db.flush()
        db.add(
            Project(id="project", slug="demo", name="Demo", created_by_user_id=user.id)
        )
        db.flush()
        for run_id in ("run-1", "run-2"):
            run = Run(
                id=run_id,
                project_id="project",
                owner_user_id=user.id,
                created_by_user_id=user.id,
                task="task",
                dataset="dataset",
                model=run_id,
                metrics=["accuracy", "count"],
                status=RunWorkflowStatus.COMPLETED,
                samples=3,
                run_metadata={"last_completed_pass": 3},
                run_config={"run_name": run_id},
            )
            db.add(run)
            db.flush()
            for position, metric in enumerate(run.metrics):
                db.add(
                    RunMetricSpec(
                        run_id=run_id,
                        metric_name=metric,
                        position=position,
                        score_type="boolean" if metric == "accuracy" else "number",
                    )
                )
            for row in payload(run_id, count, 3)["snapshot"]["rows"]:
                if seed_issues and row["index"] == 0:
                    row["item_metadata"].update(
                        root_causes=["Aggregate only"],
                        root_cause_issues=[
                            {
                                "category": "Aggregate only",
                                "subcategory": "Stale summary",
                                "finding": "Aggregate diagnosis must not appear in a pass",
                            }
                        ],
                        root_cause_reason="Aggregate category explanation",
                    )
                db.add(
                    RunItem(
                        run_id=run_id,
                        item_id=row["item_id"],
                        index=row["index"],
                        input=row["input"],
                        expected=row["expected"],
                        output=row["output"],
                        error=row["error"] or None,
                        latency_ms=row["latency_ms"],
                        retry_count=row["retry_count"],
                        item_metadata=row["item_metadata"],
                    )
                )
                for metric_index, metric in enumerate(run.metrics):
                    value = row["metric_values"][metric_index]
                    db.add(
                        RunItemScore(
                            run_id=run_id,
                            item_id=row["item_id"],
                            metric_name=metric,
                            score_numeric=value,
                            score_raw=value,
                            explanation=row["metric_meta"]
                            .get(metric, {})
                            .get("explanation"),
                            meta=(meta_hook("score", run_id, row["index"], metric, None) if meta_hook else {}),
                        )
                    )
                    for pass_index, value in enumerate(row["pass_scores"][metric]):
                        db.add(
                            RunItemPassScore(
                                run_id=run_id,
                                item_id=row["item_id"],
                                metric_name=metric,
                                pass_number=pass_index + 1,
                                score_numeric=value,
                                explanation=f"pass-{pass_index + 1} judge {row['index']}",
                                meta=(meta_hook("pass", run_id, row["index"], metric, pass_index + 1) if meta_hook else {}),
                            )
                        )
                for attempt in row["pass_attempts"]:
                    output = attempt["output"]
                    if row["index"] == count - 1 and attempt["pass_number"] == 2:
                        output = {"late_only_field": "last", "answer": output}
                    db.add(
                        RunItemAttempt(
                            run_id=run_id,
                            item_id=row["item_id"],
                            pass_number=attempt["pass_number"],
                            attempt_number=1,
                            is_last_attempt=True,
                            status="completed",
                            output=output,
                            latency_ms=attempt["latency_ms"],
                        )
                    )
        db.commit()
        principal = Principal(user=user, auth_type="local_password")
        db.expunge(user)
    app = FastAPI()
    app.include_router(router)

    def session():
        with Session(engine, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_ui_principal] = lambda: principal
    try:
        with TestClient(app) as client:
            if seed_issues:
                for pass_number in (1, 2, 3):
                    issues = [
                        {
                            "category": "Reasoning Error",
                            "subcategory": "First mechanism",
                            "finding": f"pass-{pass_number} first finding {count - 1}",
                        }
                    ]
                    if pass_number == 2:
                        issues.append(
                            {
                                "category": "Reasoning Error",
                                "subcategory": "Second mechanism",
                                "finding": f"pass-2 second finding {count - 1}",
                            }
                        )
                    response = client.post(
                        "/api/runs/update_root_cause",
                        json={
                            "run_id": "run-1",
                            "item_id": f"item-{count - 1}",
                            "metric_name": "accuracy",
                            "pass_number": pass_number,
                            "root_cause_issues": issues,
                        },
                    )
                    assert response.status_code == 200, response.text
            yield client
    finally:
        engine.dispose()


def _publish(make) -> None:
    """Publish the runs list projection (the worker does this in the app)."""
    from sqlalchemy import func, select

    from qym_platform.db.dashboard_models import DashboardPartitionState
    from qym_platform.services.dashboard_summaries import bootstrap_partitions, drain_dashboard_changes

    with make() as db:
        bootstrap_partitions(db)
        db.commit()
    for _ in range(50):
        with make() as db:
            drain_dashboard_changes(db)
            db.commit()
            pending = db.scalar(
                select(func.count())
                .select_from(DashboardPartitionState)
                .where(DashboardPartitionState.queue_state.in_(["pending", "backfill"]))
            )
        if not pending:
            return
    raise AssertionError("the runs projection did not settle")


def model_key(row):
    return row["model_name"] + (
        "|||reasoning"
        if row.get("trace_stats", {}).get("reasoning_tokens")
        else "|||plain"
    )


@contextmanager
def projected_dashboard(rows):
    """Connect Chromium's dashboard reads to the real SQL/FastAPI contract."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from qym_platform.api.dashboard import router
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db.base import Base
    from qym_platform.db.dashboard_models import (
        DashboardRunDimension,
        DashboardRunSummary,
    )
    from qym_platform.db.models import Project, User, UserRole
    from qym_platform.deps import get_db

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id="owner",
            email="models@example.test",
            display_name="Owner",
            role=UserRole.ADMIN,
        )
        db.add(user)
        db.flush()
        db.add(Project(id="p", slug="demo", name="Demo", created_by_user_id="owner"))
        for index, row in enumerate(rows):
            stamp = datetime.fromisoformat(row["timestamp"]).replace(tzinfo=None)
            db.add(
                DashboardRunDimension(
                    run_key=row["run_id"],
                    project_key="p",
                    task=row["task_name"],
                    model=model_key(row),
                    dataset=row["dataset_name"] + "␟" + row["dataset_version"],
                    version=row["git_commit"],
                    owner="owner",
                    status=row["status"],
                    timestamp=stamp,
                    # Deliberately disagree with started-at order to catch latest-K
                    # ranking by creation time instead of the UI timestamp.
                    created_at=stamp + timedelta(hours=(index % 60) * 2),
                    descriptor=row,
                )
            )
            db.add(
                DashboardRunSummary(
                    run_key=row["run_id"],
                    project_key="p",
                    data=row,
                    count=20,
                    success_count=20,
                    applied_source_version=index + 1,
                )
            )
        db.commit()
        principal = Principal(user=user, auth_type="local_password")
        db.expunge(user)

    app = FastAPI()
    app.include_router(router)

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_ui_principal] = lambda: principal
    try:
        with TestClient(app) as client:
            yield client
    finally:
        engine.dispose()


def make_runs(count=123):
    """Dashboard rows (the former test_dashboard_paging_browser fixture)."""
    now = datetime.now(timezone.utc)
    return [
        dict(
            run_id=f"run-{i:03}",
            file_path=f"run-{i:03}",
            run_name=f"Run {i}",
            task_name="Rare task" if i >= 100 else "Common task",
            model_name="model",
            dataset_name="dataset",
            timestamp=(now - timedelta(hours=i)).isoformat(),
            total_items=10,
            success_count=8,
            error_count=1,
            success_rate=0.8,
            metrics=["accuracy"],
            metric_averages={"accuracy": i / 124},
            metric_specs={"accuracy": {"score_type": "continuous", "direction": "maximize"}},
            metric_neighbor_values={"accuracy": [(i - 1) / 124, (i + 1) / 124]},
            avg_latency_ms=100 + i,
            median_latency_ms=90 + i,
            duration_ms=1000 + i,
            status="COMPLETED",
            samples=1,
            owner={"id": "owner", "display_name": "Owner"},
            git_commit="late-version" if i >= 100 else "early-version",
        )
        for i in range(count)
    ]


def model_rows():
    """Three models x 60 runs for the Models page contract (alpha twice: plain and reasoning)."""
    rows = []
    now = datetime.now(timezone.utc)
    for model_index, model in enumerate(("alpha", "beta", "alpha")):
        for i in range(60):
            rows.append(
                {
                    "run_id": f"m{model_index}-{i:02}",
                    "file_path": f"m{model_index}-{i:02}",
                    "run_name": f"Experiment {model_index} {i}",
                    "model_name": model,
                    "task_name": "Task",
                    "dataset_name": "Data",
                    "dataset_version": "v1",
                    "timestamp": (now - timedelta(hours=i)).isoformat(),
                    "status": "COMPLETED",
                    "total_items": 20,
                    "success_count": 20,
                    "error_count": 0,
                    "success_rate": 1,
                    "metrics": ["accuracy", "count"] + (["late_metric"] if i == 59 else []),
                    "metric_averages": {"accuracy": 0.5, "count": 12 if i == 59 else 1},
                    "metric_specs": {},
                    "git_commit": "old" if i >= 50 else "new",
                    "owner": {"id": "owner", "display_name": "Owner"},
                    "samples": 3 if i == 0 else 1,
                    "avg_latency_ms": 100 + i,
                    "total_retries": i,
                    "trace_stats": {"reasoning_tokens": 20} if model_index == 2 else {},
                    "run_config": {"temperature": i % 2},
                    "config_group_key": "cold" if i % 2 == 0 else "warm",
                    "_revision": 1,
                }
            )
    return rows
