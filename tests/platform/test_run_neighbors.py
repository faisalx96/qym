"""Previous / next run in the Runs list order (C044 part 1).

POST /api/dashboard/neighbors answers with the runs on either side of a run
in exactly the order the Runs list pages in (POST /api/dashboard/runs) for the
same filters, sort and collation, across page ends. A text sort without a
collation asks for one first; a run outside the list asked for falls back to
the project's default order (newest first, no filters).
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
    Run,
    RunItem,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from test_archived_project_browser import _publish

RUNS = 64
MODELS = ("openai/gpt-4o", "anthropic/claude-x", "qwen/qwen3")
TASKS = ("support-qa", "sql-gen")
DATASETS = ("golden", "hard-cases", "Beta")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    now = datetime.utcnow().replace(microsecond=0)
    with make() as db:
        db.add_all(
            [
                User(id="dev", email="dev@local", display_name="Dev", role=UserRole.ADMIN),
                User(id="ann", email="ann@local", display_name="Ann", role=UserRole.MEMBER),
                Project(id="pa", name="Support bot", slug="pa", created_by_user_id="dev"),
                Project(id="pb", name="Other", slug="pb", created_by_user_id="dev"),
            ]
        )
        db.flush()
        for n in range(RUNS):
            run_id = f"run-{n:03d}"
            # Pairs of runs share a start time: the list breaks the tie by its
            # group order and the run id, and so must the neighbours.
            started = now - timedelta(hours=n // 2)
            db.add(
                Run(
                    id=run_id,
                    project_id="pa",
                    created_by_user_id="dev",
                    owner_user_id="dev" if n % 3 else "ann",
                    task=TASKS[n % 2],
                    dataset=DATASETS[n % 3],
                    model=MODELS[(n // 2) % 3],
                    metrics=["accuracy"],
                    run_metadata={},
                    run_config={"run_name": f"Run {n:03d}"},
                    status=RunWorkflowStatus.FAILED if n % 5 == 0 else RunWorkflowStatus.COMPLETED,
                    started_at=started,
                    ended_at=started + timedelta(minutes=2),
                    created_at=started + timedelta(seconds=n % 2),
                )
            )
            db.flush()
            db.add(RunMetricSpec(run_id=run_id, metric_name="accuracy", position=0, score_type="score"))
            db.add(RunItem(run_id=run_id, item_id="i0", index=0, input="q", output="a", latency_ms=100 + n))
            db.add(
                RunItemScore(
                    run_id=run_id,
                    item_id="i0",
                    metric_name="accuracy",
                    score_numeric=(n * 7 % 10) / 10,
                    score_raw=(n * 7 % 10) / 10,
                )
            )
        db.add(
            Run(
                id="other-run",
                project_id="pb",
                created_by_user_id="dev",
                owner_user_id="dev",
                task="support-qa",
                dataset="golden",
                model="openai/gpt-4o",
                metrics=[],
                run_metadata={},
                run_config={},
                status=RunWorkflowStatus.COMPLETED,
                started_at=now,
                created_at=now,
            )
        )
        db.commit()
    _publish(make)
    app = create_app()

    def session():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = session
    test_client = TestClient(app)
    yield test_client
    test_client.close()
    engine.dispose()


def _list_order(client, filters, sort, collation=None):
    """Every run id in the Runs list order, paged as the list pages."""
    order, offset = [], 0
    while True:
        payload = {"project_slug": "pa", "filters": filters, "sort": sort, "limit": 50, "offset": offset}
        if collation is not None:
            payload["collation"] = collation
        page = client.post("/api/dashboard/runs", json=payload)
        assert page.status_code == 200, page.text
        rows = page.json()["rows"]
        order += [row["run_id"] for row in rows]
        offset += len(rows)
        if not page.json()["has_more"]:
            return order


def _neighbors(client, run_id, filters, sort, collation=None, slug="pa"):
    payload = {"project_slug": slug, "run_id": run_id, "filters": filters, "sort": sort}
    if collation is not None:
        payload["collation"] = collation
    return client.post("/api/dashboard/neighbors", json=payload)


@pytest.mark.parametrize(
    "filters, sort, collation",
    [
        ({}, "time-desc", None),
        ({"statuses": ["COMPLETED"]}, "time-asc", None),
        ({"tasks": ["support-qa", "sql-gen"]}, "metric-accuracy-desc", None),
        ({}, "run-asc", None),
        # Text sorts follow the collation the browser sends, whatever it is.
        ({}, "model-asc", ["gpt-4o|||plain", "qwen3|||plain", "claude-x|||plain"]),
        ({"statuses": ["COMPLETED"]}, "dataset-desc", ["hard-cases", "Beta", "golden"]),
    ],
)
def test_neighbors_follow_the_list_order_across_page_ends(client, filters, sort, collation):
    order = _list_order(client, filters, sort, collation)
    assert len(order) > 50  # the list has a second page
    for index, run_id in enumerate(order):
        response = _neighbors(client, run_id, filters, sort, collation)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["context"] == "list"
        assert (data["position"], data["total"]) == (index + 1, len(order))
        previous = data["previous"] and data["previous"]["run_id"]
        following = data["next"] and data["next"]["run_id"]
        assert previous == (order[index - 1] if index else None), (index, run_id)
        assert following == (order[index + 1] if index + 1 < len(order) else None), (index, run_id)
    # Labels are the run names the run page shows.
    middle = _neighbors(client, order[1], filters, sort, collation).json()
    assert middle["previous"]["run_name"] == "Run " + order[0].split("-")[1]


def test_a_text_sort_without_collation_asks_for_one(client):
    data = _neighbors(client, "run-001", {"statuses": ["FAILED"]}, "dataset-asc").json()
    assert data["collation_needed"] is True
    failed = [n for n in range(RUNS) if n % 5 == 0]
    assert sorted(data["sort_values"]) == sorted({DATASETS[n % 3] for n in failed})
    assert "previous" not in data and "position" not in data
    owners = _neighbors(client, "run-001", {}, "owner-desc").json()
    assert sorted(owners["sort_values"]) == ["Ann", "Dev"]


def test_a_run_outside_the_list_falls_back_to_the_default_order(client):
    default = _list_order(client, {}, "time-desc")
    # run-011 is COMPLETED: not in a FAILED-only list.
    data = _neighbors(client, "run-011", {"statuses": ["FAILED"]}, "model-asc", ["qwen3|||plain"]).json()
    index = default.index("run-011")
    assert data["context"] == "default"
    assert data["position"] == index + 1 and data["total"] == RUNS
    assert data["previous"]["run_id"] == default[index - 1]
    assert data["next"]["run_id"] == default[index + 1]
    # No list asked for: the default order is the list.
    assert _neighbors(client, "run-001", {}, "time-desc").json()["context"] == "list"
    # A run of another project, or none at all, is in no list of this one.
    for run_id in ("other-run", "missing-run"):
        data = _neighbors(client, run_id, {"statuses": ["FAILED"]}, "time-desc").json()
        assert data == {
            "run_id": run_id, "context": None, "position": None, "total": 0,
            "previous": None, "next": None,
        }


def test_neighbors_refuse_bad_requests(client):
    good = {"project_slug": "pa", "run_id": "run-001", "filters": {}, "sort": "time-desc"}
    for change, status in (
        ({"project_slug": None}, 400),
        ({"run_id": ""}, 400),
        ({"run_id": "x" * 201}, 400),
        ({"run_id": 5}, 400),
        ({"sort": "nope"}, 400),
        ({"filters": {"unknown": []}}, 400),
        ({"collation": [1, 2]}, 400),
        ({"extra": True}, 400),
        ({"project_slug": "no-such-project"}, 404),
    ):
        response = client.post("/api/dashboard/neighbors", json={**good, **change})
        assert response.status_code == status, (change, response.text)
    assert client.post("/api/dashboard/neighbors", json=good).status_code == 200
