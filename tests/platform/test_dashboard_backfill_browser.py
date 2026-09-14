"""Backfill serves published pages immediately; missing history is explicit."""

import re
from urllib.parse import parse_qs, urlparse

import pytest
from test_dashboard_paging_browser import DashboardFixture, STATIC, browser, nested
from test_dashboard_durable_summaries import database

pytestmark = pytest.mark.browser


class BackfillFixture(DashboardFixture):
    def __init__(self, browser, view="table"):
        self.backfilling = True
        self.published = 123
        self.global_role = "ADMIN"
        self.project_role = "MANAGER"
        self.response_status = 200
        self.hold_offset = None
        self.held = []
        super().__init__(browser, view=view)
        self.page.add_init_script((STATIC / "auth.js").read_text())

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path == "/v1/me":
            route.fulfill(
                json={
                    "id": "owner",
                    "role": self.global_role,
                    "display_name": "Owner",
                    "projects": [
                        {
                            "id": "project",
                            "slug": "demo",
                            "name": "Demo",
                            "role": self.project_role,
                        }
                    ],
                }
            )
            return
        if url.path == "/api/runs":
            self.requests.append((url.path, {}))
            # Any use of raw history is a regression, including for an empty projection.
            route.fulfill(status=503, json={"detail": "raw history unavailable"})
            return
        if url.path.startswith("/api/dashboard/"):
            fixture = self

            class ProjectedRoute:
                request = route.request

                def fulfill(self, **kwargs):
                    if fixture.response_status != 200:
                        route.fulfill(
                            status=fixture.response_status,
                            json={"detail": "Unavailable"},
                        )
                        return
                    payload = kwargs["json"]
                    freshness = {
                        "updating": fixture.backfilling,
                        "backfilling": fixture.backfilling,
                        "unpublished_runs": max(0, len(all_runs) - fixture.published),
                    }
                    payload["freshness"] = freshness
                    if "overview" in payload:
                        payload["overview"]["freshness"] = freshness
                    query = route.request.post_data_json or {}
                    if query.get(
                        "offset", 0
                    ) == fixture.hold_offset and url.path.endswith("/runs"):
                        fixture.held.append((route, payload))
                    else:
                        route.fulfill(json=payload)

            all_runs = self.runs
            self.runs = all_runs[: self.published]
            try:
                super().route(ProjectedRoute())
            finally:
                self.runs = all_runs
            return
        if url.path == "/projects/demo/models":
            source = (STATIC / "models.html").read_text()
            source = re.sub(
                r'<script src="/static/(?:auth|shell)\.js[^\"]*"></script>', "", source
            )
            route.fulfill(body=source, content_type="text/html")
            return
        super().route(route)

    def open(self):
        suffix = "" if self.view == "table" else "/" + self.view
        self.page.goto("https://qym.test/projects/demo" + suffix)
        self.page.wait_for_function("__dashboardTest.state.dashboardBackfilling")


@pytest.mark.parametrize("view", ["table", "charts", "models"])
def test_backfill_keeps_published_history_global_facets_and_bounded_pages(
    browser, view
):
    fixture = BackfillFixture(browser, view)
    try:
        fixture.open()
        page = fixture.page
        assert page.evaluate("__dashboardTest.state.aggregations.totalItems") == 1230
        assert "Rare task" in page.locator("#filter-task-dropdown").inner_text()
        assert "late-version" in page.locator("#filter-version-dropdown").inner_text()
        assert not any(path == "/api/runs" for path, _ in fixture.requests)
        assert "Updating summaries" in page.locator("#last-updated").inner_text()
        if view == "table":
            assert page.locator("#runs-tbody tr[data-idx]").count() == 50
            assert page.evaluate("__dashboardTest.state.flatRuns.length") == 50
            assert page.locator("#status-filter").inner_text() == "123 runs"
            assert (
                len([path for path, _ in fixture.requests if path.endswith("/runs")])
                == 1
            )
    finally:
        fixture.close()


@pytest.mark.parametrize("published", [0, 12])
def test_initial_import_discloses_partial_totals_and_renders_available_rows(
    browser, published
):
    fixture = BackfillFixture(browser)
    fixture.published = published
    try:
        fixture.open()
        page = fixture.page
        assert page.evaluate("__dashboardTest.state.flatRuns.length") == published
        assert page.locator("#table-view").is_visible()
        assert (
            str(123 - published) + " runs preparing"
            in page.locator("#last-updated").inner_text()
        )
        assert "ready runs only" in page.locator("#status-filter").inner_text()
        fixture.published = 123
        fixture.backfilling = False
        page.evaluate("__dashboardTest.fetchRuns()")
        assert page.evaluate("__dashboardTest.state.flatRuns.length") == 50
        assert page.locator("#status-filter").inner_text() == "123 runs"
        assert not any(path == "/api/runs" for path, _ in fixture.requests)
    finally:
        fixture.close()


@pytest.mark.parametrize("role,can_manage", [("MANAGER", True), ("MEMBER", False)])
def test_backfill_preserves_project_management_actions(browser, role, can_manage):
    fixture = BackfillFixture(browser)
    fixture.global_role = "MEMBER"
    fixture.project_role = role
    fixture.runs[0]["owner"] = {"id": "someone-else", "display_name": "Another owner"}
    fixture.runs[0]["status"] = "SUBMITTED"
    try:
        fixture.open()
        page = fixture.page
        for backfilling in (True, False):
            fixture.backfilling = backfilling
            page.evaluate("__dashboardTest.fetchRuns()")
            assert page.evaluate("__dashboardTest.state.currentProject.role") == role
            assert page.locator(".approve-run").count() == int(can_manage)
            page.evaluate(
                "() => { const t=__dashboardTest; t.state.selectMode=true; if (!t.state.selectedRuns.has('run-000')) t.toggleSelect('run-000'); }"
            )
            assert page.locator("#delete-selected").is_enabled() == can_manage
    finally:
        fixture.close()


def test_backfill_transition_preserves_pagination_filters_and_selections(browser):
    fixture = BackfillFixture(browser)
    try:
        fixture.open()
        page = fixture.page
        page.evaluate(
            "() => {const t=__dashboardTest; t.state.selectMode=true; t.toggleSelect('run-000'); t.setTablePage(3); t.render();}"
        )
        page.wait_for_function("__dashboardTest.state.dashboardPage.offset===100")
        page.evaluate("__dashboardTest.toggleSelect('run-122')")
        fixture.backfilling = False
        page.evaluate("__dashboardTest.fetchRuns()")
        assert page.evaluate("__dashboardTest.state.dashboardPage.offset") == 100
        assert page.evaluate("[...__dashboardTest.state.selectedRuns]") == [
            "run-000",
            "run-122",
        ]
        assert page.locator("#compare-view").is_enabled()
        page.evaluate(
            "() => {const t=__dashboardTest; t.state.filterTasks=new Set(['Rare task']); t.state.sortKey='metric-accuracy-desc'; t.render();}"
        )
        page.wait_for_function(
            "__dashboardTest.state.dashboardPage.rows[0]?.run_id==='run-122'"
        )
        assert page.evaluate(
            "__dashboardTest.state.dashboardPage.rows.map(r=>r.run_id)"
        ) == [f"run-{i:03}" for i in range(122, 99, -1)]
    finally:
        fixture.close()


def test_failed_refresh_preserves_displayed_data_and_can_retry(browser):
    fixture = BackfillFixture(browser)
    try:
        fixture.open()
        page = fixture.page
        fixture.response_status = 503
        fixture.runs[0] = {**fixture.runs[0], "run_name": "Changed"}
        page.evaluate("__dashboardTest.fetchRuns()")
        assert page.evaluate("__dashboardTest.state.flatRuns[0].run_name") == "Run 0"
        fixture.response_status = 200
        page.evaluate("__dashboardTest.fetchRuns()")
        assert page.evaluate("__dashboardTest.state.flatRuns[0].run_name") == "Changed"
    finally:
        fixture.close()


def test_expired_session_stops_summary_reads(browser):
    fixture = BackfillFixture(browser)
    try:
        fixture.open()
        fixture.response_status = 401
        fixture.page.evaluate("__dashboardTest.fetchRuns()")
        fixture.page.get_by_role("link", name="Sign in", exact=True).wait_for()
        before = len(fixture.requests)
        fixture.page.evaluate("__dashboardTest.fetchRuns()")
        assert len(fixture.requests) == before
        assert fixture.page.locator("#runs-tbody").count() == 0
    finally:
        fixture.close()


def test_new_page_does_not_wait_for_obsolete_slow_page(browser):
    fixture = BackfillFixture(browser)
    try:
        fixture.open()
        page = fixture.page
        fixture.hold_offset = 50
        page.evaluate(
            "() => {__dashboardTest.setTablePage(2); __dashboardTest.render();}"
        )
        for _ in range(100):
            if fixture.held:
                break
            page.wait_for_timeout(20)
        assert fixture.held
        page.evaluate(
            "() => {__dashboardTest.setTablePage(3); __dashboardTest.render();}"
        )
        page.wait_for_function("__dashboardTest.state.dashboardPage.offset===100")
        assert page.locator("#runs-tbody tr[data-idx]").count() == 23
    finally:
        fixture.close()


@pytest.mark.parametrize(
    "run_count,tied_timestamps",
    [(123, False), (501, True)],
    ids=["distinct-timestamps", "tied-timestamps"],
)
def test_real_unprojected_history_matches_after_backfill(
    browser, database, run_count, tied_timestamps
):
    from datetime import datetime, timedelta

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session, sessionmaker

    from qym_platform.api import dashboard, runs
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db.models import Project, RunItemScore, RunWorkflowStatus, User
    from qym_platform.deps import get_db
    from qym_platform.services import dashboard_summaries as service
    from test_dashboard_durable_summaries import drain, item, run

    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        db.get(Project, "p").slug = "demo"
        for index in range(run_count):
            run_id = f"real-{index:03}"
            run(
                db,
                run_id=run_id,
                status=RunWorkflowStatus.COMPLETED,
                created_at=datetime(2026, 9, 1)
                + timedelta(minutes=0 if tied_timestamps else index),
                run_metadata={"total_items": 2},
            )
            item(db, run_id=run_id, latency_ms=index + 1)
            item(
                db,
                item_id="failed",
                run_id=run_id,
                status="error",
                error="failed",
                latency_ms=50,
            )
            db.add(
                RunItemScore(
                    run_id=run_id,
                    item_id="i",
                    metric_name="score",
                    score_numeric=(index % 10) / 10,
                )
            )
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
    app.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=owner, auth_type="none"
    )

    class SourceFixture(DashboardFixture):
        def route(self, route):
            url = urlparse(route.request.url)
            if url.path == "/api/runs":
                response = self.api_client.get(url.path, params=parse_qs(url.query))
                route.fulfill(
                    status=response.status_code,
                    body=response.content,
                    content_type="application/json",
                )
                return
            super().route(route)

    with TestClient(app) as client:
        if tied_timestamps:
            # LIMIT/OFFSET can return overlapping timestamp ties in PostgreSQL
            # even without concurrent writes. Check every source page first.
            ids = []
            for offset in range(0, run_count, 100):
                response = client.get(
                    "/api/runs",
                    params={
                        "project_slug": "demo",
                        "limit": 100,
                        "offset": offset,
                        "include_total": offset == 0,
                    },
                )
                assert response.status_code == 200
                ids.extend(
                    row["run_id"]
                    for models in response.json()["tasks"].values()
                    for rows in models.values()
                    for row in rows
                )
            assert ids == [f"real-{index:03}" for index in range(run_count)]
        fixture = SourceFixture(browser)
        fixture.api_client = client
        try:
            page = fixture.page
            page.goto("https://qym.test/projects/demo")
            page.wait_for_function("__dashboardTest.state.dashboardBackfilling")
            assert page.evaluate("__dashboardTest.state.flatRuns.length") == 0
            assert str(run_count) in page.locator("#last-updated").inner_text()
            assert "ready runs only" in page.locator("#status-filter").inner_text()
            assert not any(path == "/api/runs" for path, _ in fixture.requests)
            expected = {}
            for offset in range(0, run_count, 100):
                response = client.get(
                    "/api/runs",
                    params={"project_slug": "demo", "limit": 100, "offset": offset},
                )
                expected.update(
                    {
                        row["run_id"]: row
                        for models in response.json()["tasks"].values()
                        for group in models.values()
                        for row in group
                    }
                )
            worker = service.DashboardSummaryWorker(
                sessionmaker(database, autoflush=False), max_partitions=4
            )
            for _ in range(2):
                worker.tick()
            page.evaluate("__dashboardTest.fetchRuns()")
            page.wait_for_function("__dashboardTest.state.flatRuns.length===1")
            assert page.evaluate("__dashboardTest.state.dashboardBackfilling")
            assert "1 run" in page.locator("#status-filter").inner_text()
            first = page.evaluate("__dashboardTest.state.flatRuns[0]")
            assert first["total_items"] == 2
            assert first["error_count"] == 1
            assert (
                first["metric_averages"] == expected[first["run_id"]]["metric_averages"]
            )
            drain(database, max_partitions=50)
            assert not client.get(
                "/api/dashboard/runs", params={"project_slug": "demo"}
            ).json()["freshness"]["backfilling"]
            page.evaluate("__dashboardTest.fetchRuns()")
            # The 15-second poll can already be in flight while PostgreSQL is
            # draining. fetchRuns queues another refresh in that case.
            page.wait_for_function("!__dashboardTest.state.dashboardBackfilling")
            assert page.evaluate("__dashboardTest.state.flatRuns.length") == 50
            assert page.locator("#status-filter").inner_text() == f"{run_count} runs"
            for actual in page.evaluate("__dashboardTest.state.flatRuns"):
                for key in (
                    "total_items",
                    "success_count",
                    "error_count",
                    "metric_averages",
                    "avg_latency_ms",
                    "median_latency_ms",
                    "status",
                ):
                    assert actual[key] == expected[actual["run_id"]][key]
        finally:
            fixture.close()
