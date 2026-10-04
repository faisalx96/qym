"""Archived projects in a real browser, against the real app.

The Archive dialogs (Project Settings and Admin > Projects) list runs still in
progress, since archiving cuts off their remaining results; with none the
dialog stays as it was. An archived project opens read-only for admins and its
members (runs, dashboard, datasets, settings): the shell says so above every
page, the edit controls are gone, and revoking keys, removing members,
Unarchive and Delete stay. Unarchive names the API keys that start working
again. Deleted Runs shows the purge as paused. Decided with these: the admin
password reset dialog says the user is signed out of every browser.
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
    ApiKey,
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


def test_archive_instead_shows_the_running_run_warning_too(app, factory):
    _add_running_runs(factory, 1)
    page = app.goto("/projects/pa/settings")
    page.locator("#settings-tab-danger").click()
    for confirm in (False, True):
        page.locator("#delete-project-btn").click()
        page.locator("#shell-confirm-submit", has_text="Archive instead").click()
        warning = page.locator("#shell-confirm-dialog .shell-modal-warning")
        warning.wait_for()
        assert "1 run is still in progress." in warning.inner_text()
        page.locator("#shell-confirm-submit" if confirm else "#shell-confirm-cancel").click()
        page.wait_for_function("() => !document.getElementById('shell-confirm-dialog')")
        page.wait_for_timeout(300)
        assert _is_active(factory) is (not confirm)
    assert app.errors == []


def test_settings_archive_dialog_without_running_runs_stays_as_it_was(app, factory):
    _page, dialog = _open_settings_archive(app)
    assert dialog.locator(".shell-modal-warning").count() == 0
    assert dialog.locator("#shell-confirm-submit").inner_text() == "Archive project"
    text = dialog.inner_text()
    # What an archived project is: readable, read-only, security actions kept.
    assert "will be hidden from the project list" in text
    assert "can still open its runs, datasets and settings, read-only" in text
    assert "can still revoke API keys and remove members, and an admin can delete the project" in text
    assert "their purge is paused until it is unarchived" in text
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
    assert "can still open its runs, datasets and settings, read-only" in dialog.inner_text()
    assert "their purge is paused until it is unarchived" in dialog.inner_text()
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


def _archived_notice(page):
    notice = page.locator("#shell-archived-notice")
    notice.wait_for()
    return notice


def test_run_page_of_an_archived_project_is_read_only(app, factory):
    page = app.goto("/run/candidate")
    assert _open_first_item(page).is_visible()
    assert page.locator("#shell-archived-notice").is_hidden()

    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/run/candidate")
    notice = _archived_notice(page)
    assert '"Support bot" is archived' in notice.inner_text()
    assert "nothing can be changed until an admin unarchives it" in notice.inner_text()
    # One notice: the shell's, not a second one from the run page.
    assert page.locator(".run-read-only-notice").count() == 0
    app.shot("run-read-only")
    assert not _open_first_item(page).is_visible()
    assert not page.locator("#items-auto-analyze-btn").is_visible()
    assert app.errors == []


def test_project_run_link_of_an_archived_project_opens_the_read_only_run_page(app, factory):
    """The SDK's live link and bookmarks use the project URL of the run."""
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/projects/pa/runs/candidate")
    _archived_notice(page)
    assert urlparse(page.url).path == "/projects/pa/runs/candidate"
    assert "candidate" in page.locator("#run-content").inner_text()
    assert not _open_first_item(page).is_visible()
    # The project's own pages open read-only too.
    page = app.goto("/projects/pa/overview")
    _archived_notice(page)
    assert "Project not found" not in page.locator("body").inner_text()
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
    _archived_notice(page)
    page.wait_for_function("() => document.getElementById('shell-breadcrumbs').innerText.includes('Support bot')")
    assert "Archived" in _crumbs(page)
    assert "Other project" not in _crumbs(page)
    # The archived project is the (read-only) context: its readable pages are
    # linked, Auto-analysis and Reviews are not.
    sidebar_class = page.locator("#qym-sidebar").get_attribute("class")
    assert "no-project" not in sidebar_class and "project-archived" in sidebar_class
    assert page.locator('#qym-sidebar .nav-item[data-page="runs"]').get_attribute("href") == "/projects/pa"
    assert page.locator('#qym-sidebar .nav-item[data-page="reviews"]').is_hidden()
    assert page.locator('#qym-sidebar .nav-item[data-page="analysis"]').is_hidden()
    app.shot("run-archived-context")

    # A remembered project that is now archived is no guess; the run's own
    # project still becomes the context once the run loads.
    page.evaluate("() => localStorage.setItem('qym:last-project-slug', 'pa')")
    page = app.goto("/run/candidate")
    _archived_notice(page)
    assert "Project not found" not in page.locator("body").inner_text()
    assert "candidate" in page.locator("#run-content").inner_text()
    # Visiting an archived project never makes it the remembered one.
    page = app.goto("/projects/pb")
    page = app.goto("/projects/pa")
    _archived_notice(page)
    assert page.evaluate("() => localStorage.getItem('qym:last-project-slug')") == "pb"
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


# ── Archived projects open read-only ─────────────────────────────────────────


def _manager_app(browser, factory, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    with factory() as db:
        db.add_all(
            [
                User(id="mgr", email="mgr@x.com", display_name="Manager", role=UserRole.MEMBER),
                User(id="mem", email="mem@x.com", display_name="Member", role=UserRole.MEMBER),
            ]
        )
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER))
        db.add(ProjectMembership(project_id="pa", user_id="mem", role=ProjectRole.MEMBER))
        db.commit()
    app = App(browser, factory)
    app.client.headers["X-User-Email"] = "mgr@x.com"
    return app


def _add_keys(make, *names, owner="owner", revoked=()):
    with make() as db:
        for name in names:
            db.add(
                ApiKey(
                    id="key-" + name,
                    user_id=owner,
                    project_id="pa",
                    name=name,
                    prefix=("p-" + name)[:16],
                    key_hash=b"x",
                    scopes=[],
                    revoked_at=datetime.utcnow() if name in revoked else None,
                )
            )
        db.commit()


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


def test_archived_project_opens_read_only_for_a_manager(browser, factory, monkeypatch):
    app = _manager_app(browser, factory, monkeypatch)
    _add_keys(factory, "ci-nightly", owner="mem")
    _publish(factory)
    try:
        assert app.client.post(
            "/v1/admin/projects/pa/archive", headers={"X-User-Email": "owner@x.com"}
        ).status_code == 200
        page = app.goto("/projects/pa")
        notice = _archived_notice(page)
        assert "is archived" in notice.inner_text()
        page.locator("tbody tr[data-idx]").first.wait_for()
        assert page.locator("tbody tr[data-idx]").count() == 2
        # No row or bulk write action is offered.
        assert page.locator(".delete-run, .submit-run, .approve-run, .run-analysis-start").count() == 0
        assert "Archived" in _crumbs(page)
        assert page.locator('#qym-sidebar .nav-item[data-page="reviews"]').is_hidden()
        app.shot("runs-archived")

        page = app.goto("/projects/pa/settings")
        page.wait_for_function("() => document.getElementById('project-title').textContent === 'Support bot'")
        _archived_notice(page)
        note = page.locator("#settings-archived-note")
        assert "You can still revoke API keys and remove members; only an admin can unarchive it." in note.inner_text()
        assert page.locator("#settings-tab-danger").is_hidden()
        assert page.locator("#gen-name").get_attribute("readonly") is not None
        page.locator("#settings-tab-members").click()
        assert page.locator("#member-form").is_hidden()
        assert page.locator("[data-member-save], [data-member-role]").count() == 0
        assert page.locator("[data-member-remove]").count() == 3
        page.locator("#settings-tab-llm").click()
        assert page.locator("#llm-form").is_hidden() and page.locator("#save-llm-btn").is_hidden()
        page.locator("#settings-tab-apikeys").click()
        assert page.locator("#key-form").is_hidden()
        app.shot("settings-archived-keys")
        # Revoking a key stays possible while the project is archived.
        page.locator('[data-key-revoke="key-ci-nightly"]').click()
        dialog = page.locator("#shell-confirm-dialog")
        dialog.wait_for()
        assert 'Revoke the API key "ci-nightly"' in dialog.inner_text()
        dialog.locator("#shell-confirm-submit").click()
        page.locator("#shell-toast-container .shell-toast.success").wait_for()
        with factory() as db:
            assert db.get(ApiKey, "key-ci-nightly").revoked_at is not None
        page.wait_for_function("() => !document.querySelector('[data-key-revoke]')")
        assert app.errors == []
    finally:
        app.close()


def test_archived_datasets_turn_read_only_when_the_shell_loads_late(app, factory):
    """The page stops waiting for the shell after 250 ms; when the shell then
    says the project is archived, the create controls go away."""
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    app.page.add_init_script(
        """(() => {
      const realFetch = window.fetch;
      window.fetch = (url, options) => String(url).includes('v1/me')
        ? new Promise(resolve => setTimeout(resolve, 800)).then(() => realFetch(url, options))
        : realFetch(url, options);
    })()"""
    )
    page = app.goto("/projects/pa/datasets")
    # Drawn before the shell answers, with the placeholder project.
    page.get_by_text("+ New dataset").first.wait_for(state="attached")
    _archived_notice(page)
    page.wait_for_function("() => ![...document.querySelectorAll('button')].some(b => b.textContent.includes('New dataset'))")
    assert app.errors == []


def test_archived_project_datasets_are_read_only(app, factory):
    upload = app.client.post(
        "/v1/datasets:upload",
        data={"name": "Golden", "project_slug": "pa"},
        files={"file": ("golden.csv", b"input,expected_output\nWhere is my order?,On its way.\n", "text/csv")},
    )
    assert upload.status_code == 200, upload.text
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200

    page = app.goto("/projects/pa/datasets")
    _archived_notice(page)
    page.locator(".dsx-card").first.wait_for()
    assert "Golden" in page.locator("#dsx-catalog-grid").inner_text()
    assert page.get_by_text("+ New dataset").count() == 0

    page = app.goto("/projects/pa/datasets/golden")
    page.locator(".dsx-hero-name").wait_for()
    page.locator("#dsx-items-body tr, .dsx-items-table tbody tr, table tbody tr").first.wait_for()
    for label in ("+ Create draft", "Set as production", "Publish", "+ Add item", "+ Add a description"):
        assert page.get_by_text(label, exact=True).count() == 0, label
    assert page.locator(".dsx-name-edit").count() == 0
    app.shot("dataset-archived")
    assert app.errors == []


def _open_admin_projects(app):
    page = app.goto("/admin")
    page.locator("#admin-tab-projects").click()
    return page


def test_unarchive_names_the_keys_that_start_working_again(app, factory):
    _add_keys(factory, "ci-nightly", "notebook", "old-laptop", revoked=("old-laptop",))
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = _open_admin_projects(app)
    # An archived row opens the project read-only, or its settings.
    row = page.locator("#projects-tbody tr", has=page.locator('[data-project-unarchive="pa"]'))
    assert row.get_by_role("link", name="Open").get_attribute("href") == "/projects/pa"
    assert row.get_by_role("link", name="Settings").get_attribute("href") == "/projects/pa/settings"

    page.locator('[data-project-unarchive="pa"]').click()
    dialog = page.locator("#shell-confirm-dialog")
    warning = dialog.locator(".shell-modal-warning")
    warning.wait_for()
    assert "2 API keys start working again." in warning.inner_text()
    items = warning.locator("li").all_inner_texts()
    assert sorted(item.split(" · ")[0] for item in items) == ["ci-nightly", "notebook"]
    assert "Deleted runs of the project in Trash resume their purge countdown" in dialog.inner_text()
    assert dialog.locator("#shell-confirm-submit").inner_text() == "Unarchive anyway"
    app.shot("unarchive-dialog")
    # Enter on a focused Cancel cancels; it does not confirm.
    dialog.locator("#shell-confirm-cancel").focus()
    page.keyboard.press("Enter")
    page.wait_for_function("() => !document.getElementById('shell-confirm-dialog')")
    page.wait_for_timeout(200)
    assert _is_active(factory) is False

    # "Revoke keys first" opens the project's API keys, still archived. Enter
    # on it does the same.
    page.locator('[data-project-unarchive="pa"]').click()
    page.locator("#shell-confirm-alt").focus()
    page.keyboard.press("Enter")
    page.wait_for_function("() => location.pathname === '/projects/pa/settings'")
    page.wait_for_function("() => document.getElementById('settings-tab-apikeys').classList.contains('active')")
    assert "tab=apikeys" in page.url
    assert page.locator("[data-key-revoke]").count() == 2
    assert _is_active(factory) is False

    # Unarchive from the project's Danger Zone.
    page.locator("#settings-tab-danger").click()
    assert page.locator("#archive-label").inner_text() == "Unarchive this project"
    page.locator("#archive-project-btn").click()
    page.locator("#shell-confirm-dialog .shell-modal-warning").wait_for()
    page.locator("#shell-confirm-submit").click()
    page.wait_for_function("() => document.getElementById('archive-project-btn').textContent === 'Archive'")
    assert _is_active(factory) is True
    assert page.locator("#shell-archived-notice").is_hidden()
    assert "Archived" not in _crumbs(page)
    assert app.errors == []


def test_unarchive_without_active_keys_is_a_plain_confirm(app, factory):
    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = _open_admin_projects(app)
    page.locator('[data-project-unarchive="pa"]').click()
    dialog = page.locator("#shell-confirm-dialog")
    dialog.wait_for()
    page.wait_for_timeout(200)
    assert dialog.locator(".shell-modal-warning").count() == 0
    assert dialog.locator("#shell-confirm-alt").count() == 0
    assert "It has no active API keys, so no key starts working again." in dialog.inner_text()
    dialog.locator("#shell-confirm-submit").click()
    page.locator('[data-project-archive="pa"]').wait_for()
    assert _is_active(factory) is True
    assert app.errors == []


def test_trash_says_purge_is_paused_while_the_project_is_archived(app, factory):
    with factory() as db:
        db.add(_run("deleted-run", deleted_at=datetime.utcnow()))
        db.commit()
    page = app.goto("/trash")
    row = page.locator("#row-deleted-run")
    row.wait_for()
    assert "Purge paused" not in row.inner_text()

    assert app.client.post("/v1/admin/projects/pa/archive").status_code == 200
    page = app.goto("/trash")
    row = page.locator("#row-deleted-run")
    row.wait_for()
    assert "Purge paused while the project is archived" in row.inner_text()
    app.shot("trash-purge-paused")
    assert app.errors == []


def test_reset_password_dialog_says_the_user_is_signed_out_everywhere(app, factory):
    with factory() as db:
        db.add(User(id="u2", email="nour@x.com", display_name="Nour", role=UserRole.MEMBER))
        db.commit()
    # The reset action shows only where password sign-in is on.
    app.page.route(
        "**/v1/auth/providers",
        lambda route: route.fulfill(
            status=200,
            headers={"content-type": "application/json"},
            body=json.dumps({"local_auth": {"enabled": True}, "providers": []}),
        ),
    )
    page = app.goto("/admin")
    page.locator("#admin-tab-users").click()
    page.locator('[data-user-edit="u2"]').click()
    page.locator("#edit-user-reset-password").click()
    dialog = page.locator("#shell-confirm-dialog")
    dialog.wait_for()
    assert (
        "Reset the password for nour@x.com? The current password stops working now. "
        "They are signed out of every browser." in dialog.inner_text()
    )
    app.shot("reset-password-dialog")
    dialog.locator("#shell-confirm-cancel").click()
    assert app.errors == []
