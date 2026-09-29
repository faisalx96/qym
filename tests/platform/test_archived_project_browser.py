"""Archived projects in a real browser, against the real app.

The Archive dialogs (Project Settings and Admin > Projects) list runs still in
progress, since archiving cuts off their remaining results; with none the
dialog stays as it was. Pages of an archived project say they are read-only
and drop their edit controls.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db

pytestmark = pytest.mark.browser

SHOTS = os.environ.get("QYM_ARCHIVE_SCREENSHOTS")


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


def _run(run_id: str, **fields) -> Run:
    values = dict(
        id=run_id,
        project_id="pa",
        created_by_user_id="owner",
        owner_user_id="owner",
        task="support-qa",
        dataset="golden",
        metrics=["accuracy"],
        run_metadata={},
        run_config={"run_name": run_id},
        status=RunWorkflowStatus.COMPLETED,
    )
    values.update(fields)
    return Run(**values)


@pytest.fixture()
def factory(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add_all(
            [
                User(id="owner", email="owner@x.com", display_name="Owner", role=UserRole.ADMIN),
                Project(id="pa", name="Support bot", slug="pa", created_by_user_id="owner", is_active=True),
            ]
        )
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="owner", role=ProjectRole.MANAGER))
        db.add_all([_run("baseline"), _run("candidate")])
        db.flush()
        for run_id, score in (("baseline", 0.5), ("candidate", 0.75)):
            db.add(RunItem(run_id=run_id, item_id="i1", index=0, input="Where is my order?", output="On its way."))
            db.add(RunItemScore(run_id=run_id, item_id="i1", metric_name="accuracy", score_numeric=score))
        db.commit()
    yield make
    engine.dispose()


def _add_running_runs(make, count: int) -> None:
    now = datetime.utcnow()
    with make() as db:
        for index in range(count):
            db.add(
                _run(
                    f"nightly-{index + 1}",
                    status=RunWorkflowStatus.RUNNING,
                    started_at=now - timedelta(minutes=5 * index),
                    last_event_at=now,
                )
            )
        db.commit()


def _is_active(make) -> bool:
    with make() as db:
        return db.get(Project, "pa").is_active


class App:
    """Serve every browser request from the real app through a TestClient."""

    def __init__(self, browser, make):
        app = create_app()

        def session():
            db = make()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.errors = []
        self.context = browser.new_context(viewport={"width": 1280, "height": 900})
        self.page = self.context.new_page()
        self.page.set_default_timeout(8000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self._forward)

    def _forward(self, route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname != "qym.test":
            return route.abort()
        target = url.path + (f"?{url.query}" if url.query else "")
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() in {"content-type", "accept"}
        }
        response = self.client.request(
            request.method,
            target,
            headers=headers,
            content=request.post_data_buffer,
            follow_redirects=False,
        )
        if response.is_redirect:
            # Chromium does not follow a fulfilled redirect on navigation, so
            # replay it in the page: the browser then shows the real URL.
            location = urljoin(request.url, response.headers["location"])
            return route.fulfill(
                status=200,
                headers={"content-type": "text/html"},
                body=f"<script>location.replace({json.dumps(location)})</script>",
            )
        route.fulfill(
            status=response.status_code,
            headers={"content-type": response.headers.get("content-type", "text/plain")},
            body=response.content,
        )

    def goto(self, path: str):
        self.page.goto(f"http://qym.test{path}")
        return self.page

    def shot(self, name: str) -> None:
        if SHOTS:
            Path(SHOTS).mkdir(parents=True, exist_ok=True)
            self.page.wait_for_timeout(400)  # let the dialog finish fading in
            self.page.screenshot(path=str(Path(SHOTS) / f"{name}.png"), full_page=False)

    def close(self):
        self.context.close()
        self.client.close()


@pytest.fixture()
def app(browser, factory):
    instance = App(browser, factory)
    yield instance
    instance.close()


def _open_settings_archive(app):
    page = app.goto("/projects/pa/settings")
    page.locator("#settings-tab-danger").click()
    page.locator("#archive-project-btn").click()
    dialog = page.locator("#shell-confirm-dialog")
    dialog.wait_for()
    return page, dialog


def test_settings_archive_dialog_lists_runs_in_progress(app, factory):
    _add_running_runs(factory, 7)
    page, dialog = _open_settings_archive(app)
    warning = dialog.locator(".shell-modal-warning")
    warning.wait_for()
    text = warning.inner_text()
    assert "7 runs are still in progress." in text
    assert "their remaining results will be lost" in text
    assert "Unarchiving does not bring them back" in text
    items = warning.locator("li").all_inner_texts()
    assert len(items) == 6
    assert items[0].startswith("nightly-1") and "started" in items[0]
    assert items[-1] == "and 2 more"
    # The warning comes before the buttons, and the button says what happens.
    submit = dialog.locator("#shell-confirm-submit")
    assert submit.inner_text() == "Archive anyway"
    assert "shell-btn-danger" in submit.get_attribute("class")
    app.shot("settings-archive-running")

    dialog.locator("#shell-confirm-cancel").click()
    assert _is_active(factory) is True
    page.locator("#archive-project-btn").click()
    page.locator("#shell-confirm-submit").click()
    page.wait_for_function("() => !document.getElementById('shell-confirm-dialog')")
    page.wait_for_timeout(300)
    assert _is_active(factory) is False
    assert app.errors == []


def test_settings_archive_dialog_without_running_runs_stays_as_it_was(app, factory):
    _page, dialog = _open_settings_archive(app)
    assert dialog.locator(".shell-modal-warning").count() == 0
    assert dialog.locator("#shell-confirm-submit").inner_text() == "Archive project"
    assert "will be hidden from navigation" in dialog.inner_text()
    app.shot("settings-archive-idle")
    dialog.locator("#shell-confirm-cancel").click()
    assert app.errors == []


def test_non_admins_get_no_archive_controls(browser, factory, monkeypatch):
    """Archive and Delete are admin-only; a project manager never sees the
    'runs could not be checked' warning for an action the server refuses."""
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    with factory() as db:
        db.add(User(id="mgr", email="mgr@x.com", display_name="Manager", role=UserRole.MEMBER))
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER))
        db.commit()
    app = App(browser, factory)
    try:
        app.client.headers["X-User-Email"] = "mgr@x.com"
        page = app.goto("/projects/pa/settings")
        page.wait_for_function("() => document.getElementById('project-title').textContent === 'Support bot'")
        assert page.locator("#settings-tab-danger").is_hidden()
        assert page.locator("#settings-tab-members").is_visible()
        # The shared dialog treats the preview's 403 as "admins only", not as a failed check.
        result = page.evaluate("() => window.QymShell.confirmArchiveProject({ id: 'pa', name: 'Support bot' })")
        assert result == {"confirmed": False}
        assert page.locator("#shell-confirm-dialog").count() == 0
        assert "Only an admin can archive" in page.locator("#shell-toast-container").inner_text()
        assert _is_active(factory) is True
        assert app.errors == []
    finally:
        app.close()


def test_admin_archive_dialog_lists_runs_in_progress(app, factory):
    _add_running_runs(factory, 1)
    page = app.goto("/admin")
    page.locator("#admin-tab-projects").click()
    page.locator('[data-project-archive="pa"]').click()
    dialog = page.locator("#shell-confirm-dialog")
    warning = dialog.locator(".shell-modal-warning")
    warning.wait_for()
    assert "1 run is still in progress." in warning.inner_text()
    assert "its remaining results will be lost" in warning.inner_text()
    assert warning.locator("li").all_inner_texts()[0].startswith("nightly-1")
    app.shot("admin-archive-running")
    dialog.locator("#shell-confirm-submit").click()
    page.locator('[data-project-unarchive="pa"]').wait_for()
    assert _is_active(factory) is False
    assert app.errors == []


def test_admin_archive_dialog_without_running_runs(app, factory):
    page = app.goto("/admin")
    page.locator("#admin-tab-projects").click()
    page.locator('[data-project-archive="pa"]').click()
    dialog = page.locator("#shell-confirm-dialog")
    dialog.wait_for()
    page.wait_for_timeout(200)
    assert dialog.locator(".shell-modal-warning").count() == 0
    assert dialog.locator("#shell-confirm-submit").inner_text() == "Archive project"
    dialog.locator("#shell-confirm-cancel").click()
    assert _is_active(factory) is True


def _open_first_item(page):
    page.locator("#items-grid .item-header-expand").first.click()
    edit = page.locator("#items-grid .metric-edit-open").first
    edit.wait_for(state="attached")
    return edit


def test_run_page_of_an_archived_project_is_read_only(app, factory):
    page = app.goto("/run/candidate")
    assert _open_first_item(page).is_visible()
    assert page.locator(".run-read-only-notice").count() == 0

    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/run/candidate")
    notice = page.locator(".run-read-only-notice")
    notice.wait_for()
    assert "archived project" in notice.inner_text()
    app.shot("run-read-only")
    assert not _open_first_item(page).is_visible()
    assert not page.locator("#items-auto-analyze-btn").is_visible()
    assert app.errors == []


def test_project_run_link_of_an_archived_project_opens_the_read_only_run_page(app, factory):
    """The SDK's live link and bookmarks use the project URL of the run."""
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/projects/pa/runs/candidate")
    page.locator(".run-read-only-notice").wait_for()
    assert urlparse(page.url).path == "/run/candidate"
    assert "candidate" in page.locator("#run-content").inner_text()
    assert not _open_first_item(page).is_visible()
    # The project's own pages stay hidden.
    app.goto("/projects/pa/overview")
    assert "Project not found" in page.locator("body").inner_text()
    assert app.errors == []


def _crumbs(page) -> str:
    return page.locator("#shell-breadcrumbs").inner_text()


def test_run_page_takes_the_project_of_its_run_not_the_last_visited(app, factory):
    """/run/{id} starts from the last visited project; once the run loads the
    shell shows the run's own project, or no project when it is archived."""
    with factory() as db:
        db.add(Project(id="pb", name="Other project", slug="pb", created_by_user_id="owner", is_active=True))
        db.flush()
        db.add(ProjectMembership(project_id="pb", user_id="owner", role=ProjectRole.MANAGER))
        db.commit()
    page = app.goto("/projects/pb")
    page.evaluate("() => localStorage.setItem('qym:last-project-slug', 'pb')")

    page = app.goto("/run/candidate")
    page.wait_for_function("() => document.getElementById('shell-breadcrumbs').innerText.includes('Support bot')")
    assert "Other project" not in _crumbs(page)
    assert page.locator('#qym-sidebar .nav-item[data-page="runs"]').get_attribute("href") == "/projects/pa"

    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/projects/pa/runs/candidate")
    page.locator(".run-read-only-notice").wait_for()
    page.wait_for_function("() => document.getElementById('shell-breadcrumbs').innerText.includes('Archived project: Support bot')")
    assert "Other project" not in _crumbs(page)
    assert "no-project" in page.locator("#qym-sidebar").get_attribute("class")
    app.shot("run-archived-context")

    # A remembered project that is now archived is no context either.
    page.evaluate("() => localStorage.setItem('qym:last-project-slug', 'pa')")
    page = app.goto("/run/candidate")
    page.locator(".run-read-only-notice").wait_for()
    assert "Project not found" not in page.locator("body").inner_text()
    assert "candidate" in page.locator("#run-content").inner_text()
    assert app.errors == []


def test_compare_page_marks_archived_runs_read_only(app, factory):
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/compare?runs=baseline&runs=candidate")
    notice = page.locator(".compare-read-only-notice")
    notice.wait_for()
    assert "2 of these runs belong to archived projects" in notice.inner_text()
    app.shot("compare-read-only")
    page.locator("#items-grid .item-header-expand").first.click()
    page.locator("#items-grid .metric-compare-row").first.wait_for()
    assert page.locator(".metric-edit-open").count() == 0
    assert page.locator(".compare-issue-edit").count() == 0
    assert not page.locator("#compare-auto-analyze-btn").is_visible()
    assert app.errors == []


def test_trash_disables_restore_for_runs_of_archived_projects(app, factory):
    with factory() as db:
        db.add(_run("deleted-run", deleted_at=datetime.utcnow()))
        db.commit()
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/trash")
    row = page.locator("#row-deleted-run")
    row.wait_for()
    assert "Project archived" in row.inner_text()
    restore = row.locator(".restore-btn")
    assert restore.is_disabled()
    assert "unarchive" in restore.get_attribute("title")
    app.shot("trash-archived")
    assert app.errors == []


def test_trash_restore_reports_success_and_failure(app, factory):
    """Restore used a toast container the page does not have: it threw and
    never said whether the run came back or why not."""
    with factory() as db:
        db.add(_run("deleted-a", deleted_at=datetime.utcnow()))
        db.add(_run("deleted-b", deleted_at=datetime.utcnow()))
        db.commit()
    page = app.goto("/trash")
    page.locator("#row-deleted-a .restore-btn").click()
    success = page.locator("#shell-toast-container .shell-toast.success")
    success.wait_for()
    assert "Run Restored" in success.inner_text()
    assert page.locator("#row-deleted-a").count() == 0

    # The run is purged elsewhere before the click: the server's reason is shown.
    with factory() as db:
        db.delete(db.get(Run, "deleted-b"))
        db.commit()
    page.locator("#row-deleted-b .restore-btn").click()
    failure = page.locator("#shell-toast-container .shell-toast.error")
    failure.wait_for()
    assert "Restore Failed: Deleted run not found" in failure.inner_text()
    assert page.locator("#row-deleted-b .restore-btn").inner_text() == "Restore"
    assert app.errors == []
