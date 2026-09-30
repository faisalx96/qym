"""C011: the Runs topbar and the Overview show one KPI definition end to end."""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)
pytestmark = pytest.mark.browser


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        yield browser
        browser.close()


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


class ShellPages:
    """Serve shipped pages with the real shell and forward dashboard reads."""

    def __init__(self, browser, client):
        self.client = client
        self.errors = []
        self.context = browser.new_context(
            viewport={"width": 1440, "height": 900}, reduced_motion="reduce"
        )
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        path = url.path
        if path.startswith("/static/"):
            file = STATIC / path.split("/static/", 1)[1]
            if file.is_file():
                route.fulfill(
                    path=str(file),
                    content_type=mimetypes.guess_type(file.name)[0]
                    or "application/octet-stream",
                )
            else:
                route.fulfill(status=404, body="")
            return
        if path in ("/v1/me", "/api/v1/me"):
            route.fulfill(
                json={
                    "id": "owner",
                    "email": "owner@example.invalid",
                    "display_name": "Owner",
                    "role": "ADMIN",
                    "projects": [
                        {
                            "id": "project",
                            "slug": "project",
                            "name": "Project",
                            "role": "MANAGER",
                        }
                    ],
                }
            )
            return
        if path.startswith("/api/dashboard/"):
            response = self.client.request(
                route.request.method,
                path,
                params=parse_qs(url.query),
                json=(
                    route.request.post_data_json
                    if route.request.method == "POST"
                    else None
                ),
            )
            route.fulfill(
                status=response.status_code,
                body=response.content,
                content_type="application/json",
            )
            return
        if path == "/api/corrections":
            route.fulfill(json={"corrections": [], "total": 0})
            return
        pages = {
            "/projects/project": "index.html",
            "/projects/project/overview": "overview.html",
        }
        if path in pages:
            route.fulfill(
                body=(STATIC / pages[path]).read_text(), content_type="text/html"
            )
            return
        route.fulfill(status=404, json={"detail": path})

    def topbar(self):
        self.page.wait_for_function(
            "document.querySelector('#shell-topbar-stats .topbar-stats-scope')"
        )
        return " ".join(self.page.locator("#shell-topbar-stats").inner_text().split())

    def close(self):
        self.context.close()
        assert not self.errors


def test_runs_topbar_and_overview_show_the_same_kpis(browser, api):
    pages = ShellPages(browser, api)
    try:
        page = pages.page
        page.goto("https://qym.test/projects/project")
        runs_topbar = pages.topbar()
        # 5 runs; (100 + 5 + 50 + 39) / 200 items; 3 runs carry task or metric
        # errors; gpt (two variants), claude and mistral; hidden and other
        # project runs excluded.
        assert runs_topbar == (
            "All runs 5 runs 97.0% execution success 3 runs with errors"
            " 3 models 200 items"
        )

        page.goto("https://qym.test/projects/project/overview")
        page.wait_for_function(
            "document.querySelector('#ov-items').textContent !== '—'"
        )
        assert pages.topbar() == runs_topbar
        values = page.eval_on_selector_all(
            "#overview-stats [data-kpi]",
            "cards => cards.map(card => card.querySelector('.stat-card-value').textContent)",
        )
        assert values == ["5", "97.0%", "3", "3", "200"]
    finally:
        pages.close()


TOPBAR_FIT = """() => {
  const crumbs = [...document.querySelectorAll('#shell-breadcrumbs > *')];
  const crumbRight = Math.max(...crumbs.map(item => item.getBoundingClientRect().right));
  const bar = document.getElementById('shell-topbar-stats').getBoundingClientRect();
  return [...document.querySelectorAll('#shell-topbar-stats > *')]
    .map(chip => [chip, chip.getBoundingClientRect()])
    .filter(([chip, box]) => getComputedStyle(chip).display !== 'none'
      && box.width > 0 && box.bottom > bar.top && box.top < bar.bottom)
    .map(([chip, box]) => ({
      text: chip.innerText.split(/\\s+/).join(' '),
      clear: box.left >= crumbRight && box.right <= bar.right + 0.5
        && box.top >= bar.top - 0.5 && box.bottom <= bar.bottom + 0.5,
    }));
}"""


@pytest.mark.parametrize("width", [1100, 900, 768])
def test_topbar_kpis_never_cover_the_breadcrumb(browser, api, width):
    """Chips that do not fit beside the breadcrumb drop out, lowest first."""
    pages = ShellPages(browser, api)
    try:
        page = pages.page
        page.set_viewport_size({"width": width, "height": 900})
        for path in ("/projects/project", "/projects/project/overview"):
            page.goto("https://qym.test" + path)
            pages.topbar()
            page.wait_for_function(
                "document.querySelector('.topbar-stat .topbar-stat-value')"
                "?.textContent === '5'"
            )
            shown = page.evaluate(TOPBAR_FIT)
            assert shown, (width, path)
            assert all(chip["clear"] for chip in shown), (width, path, shown)
            # The scope always leads whatever is shown, then the chips in order.
            order = [
                "All runs",
                "5 runs",
                "97.0% execution success",
                "3 runs with errors",
                "3 models",
                "200 items",
            ]
            assert [chip["text"] for chip in shown] == order[: len(shown)]
    finally:
        pages.close()


def test_runs_topbar_states_the_active_filter_scope(browser, api):
    pages = ShellPages(browser, api)
    try:
        page = pages.page
        page.goto("https://qym.test/projects/project")
        pages.topbar()
        page.locator("#filter-task-btn").click()
        page.get_by_role("button", name="Show only sql").click()
        page.wait_for_function(
            "document.querySelector('.topbar-stats-scope')?.textContent === 'Filtered runs'"
        )
        # sql: the metric-error run (50/50) and the legacy run (39/40), one
        # of them without a model name.
        assert pages.topbar() == (
            "Filtered runs 2 runs 98.8% execution success 2 runs with errors"
            " 1 model 90 items"
        )
        assert page.locator(".topbar-stats-scope").get_attribute("title") == (
            "Totals across the runs that match the active filters."
        )
    finally:
        pages.close()
