"""C011: every surface reads one KPI definition (API level).

The topbar of the Runs page and the Overview cards are both rendered from
``/api/dashboard/kpis`` (the Overview/Runs payloads embed the same object). The
vanilla browser version of this file served the dashboard pages through Chromium;
the numbers it pinned are asserted here at the API, the layout in
frontend/e2e/runs-list/cutover-kpis.spec.ts.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from qym_platform.api import dashboard
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.db.base import Base
from qym_platform.db.models import Project, User, UserRole
from qym_platform.deps import get_db

from test_dashboard_kpis import seed_kpi_project


@pytest.fixture
def api():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(
            id="owner",
            email="owner@example.invalid",
            display_name="Owner",
            role=UserRole.ADMIN,
        )
        db.add(owner)
        db.flush()
        for slug in ("project", "private"):
            db.add(
                Project(
                    id=slug, name=slug.title(), slug=slug, created_by_user_id="owner"
                )
            )
        db.commit()
        _ = owner.id, owner.role, owner.email
        db.expunge(owner)
    seed_kpi_project(engine)
    app = FastAPI()
    app.include_router(dashboard.router)

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=owner, auth_type="local_password"
    )
    with TestClient(app) as client:
        yield client
    engine.dispose()


def _kpis(client, filters=None):
    return client.post(
        "/api/dashboard/kpis",
        json={"project_slug": "project", "filters": filters or {}},
    ).json()["kpis"]


def test_runs_topbar_and_overview_show_the_same_kpis(api):
    # 5 runs; (100 + 5 + 50 + 39) / 200 items; 3 runs carry task or metric
    # errors; gpt (two variants), claude and mistral; hidden and other-project
    # runs excluded.
    kpis = _kpis(api)
    assert kpis["scope"] == "project"
    assert (kpis["runs"], kpis["runs_with_errors"], kpis["models"], kpis["items"]) == (
        5,
        3,
        3,
        200,
    )
    assert kpis["execution_success"] == pytest.approx(194 / 200)
    overview = api.get("/api/dashboard/overview", params={"project_slug": "project"})
    assert overview.json()["kpis"] == kpis
    runs_page = api.post(
        "/api/dashboard/runs",
        json={"project_slug": "project", "filters": {}, "include_overview": True},
    ).json()
    assert runs_page["overview"]["kpis"] == kpis


def test_runs_topbar_states_the_active_filter_scope(api):
    # sql: the metric-error run (50/50) and the legacy run (39/40), one of them
    # without a model name.
    kpis = _kpis(api, {"tasks": ["sql"]})
    assert kpis["scope"] == "filtered"
    assert (kpis["runs"], kpis["runs_with_errors"], kpis["models"], kpis["items"]) == (
        2,
        2,
        1,
        90,
    )
    # The client floors this to 98.8%.
    assert kpis["execution_success"] == pytest.approx(89 / 90)
