"""P1 access and admin fixes in a real browser, against the real app.

- C067: disabling a user asks first and offers Undo; your own row cannot.
- C073: the shared form dialog keeps quotes and markup in a value exactly.
- C075: the member picker searches people who are not members; nobody loads
  the user directory on Project Settings.
- C078: Save Changes renames the project (admins) and updates the switcher;
  others see the name read-only.
- C062: a plain member opens Auto-analysis read-only instead of an error.
- C190/C194: Deleted Runs pages through every deleted run, filters by project,
  restores several runs at once, and keeps Restore in view.
- C076/C077: sign-in never leaves the site through ``next``, and the sign-up
  link only shows when sign-up is allowed.
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
from qym_platform.db import dashboard_models, maintenance_models  # noqa: F401  (tables)
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalyzerDocument,
    LocalAuthCredential,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import hash_password

pytestmark = pytest.mark.browser

SHOTS = os.environ.get("QYM_ACCESS_ADMIN_SCREENSHOTS")
PASSWORD = "strong-pass-123"


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


@pytest.fixture()
def factory(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", "30")
    monkeypatch.delenv("QYM_AUTH_LOCAL_SIGNUP", raising=False)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", display_name="Admin", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", display_name="Mona Manager", role=UserRole.MEMBER),
                User(id="member", email="member@x.com", display_name="Sam Member", role=UserRole.MEMBER),
                User(id="nour", email="nour@x.com", display_name="Nour Outside", role=UserRole.MEMBER),
                User(id="omar", email="omar@x.com", display_name="Omar Outside", role=UserRole.MEMBER),
            ]
        )
        db.flush()
        db.add_all(
            [
                Project(id="pa", name="Support bot", slug="pa", created_by_user_id="admin"),
                Project(id="pb", name="Search bot", slug="pb", created_by_user_id="admin"),
            ]
        )
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER, added_by_user_id="admin"))
        db.add(ProjectMembership(project_id="pa", user_id="member", role=ProjectRole.MEMBER, added_by_user_id="admin"))
        db.add(AnalyzerDocument(id="doc1", project_id="pa", uploaded_by_user_id="mgr", name="rubric.md", content="Use evidence.", characters=13))
        db.commit()
    yield make
    engine.dispose()


class App:
    """Serve every browser request from the real app, signed in as ``email``."""

    def __init__(self, browser, make, email, width=1280):
        app = create_app()

        def session():
            db = make()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.email = email
        self.errors = []
        self.requests = []
        self.context = browser.new_context(viewport={"width": width, "height": 900})
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
        self.requests.append(target)
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() in {"content-type", "accept", "origin"}
        }
        if self.email:
            headers["X-User-Email"] = self.email
        response = self.client.request(
            request.method, target, headers=headers, content=request.post_data_buffer, follow_redirects=False
        )
        if response.is_redirect:
            location = urljoin(request.url, response.headers["location"])
            return route.fulfill(
                status=200,
                headers={"content-type": "text/html"},
                body=f"<script>location.replace({json.dumps(location)})</script>",
            )
        route.fulfill(
            status=response.status_code,
            headers={
                key: value
                for key, value in response.headers.items()
                if key.lower() in {"content-type", "x-qym-total-count", "x-qym-deleted-run-grace-days", "set-cookie", "retry-after"}
            },
            body=response.content,
        )

    def goto(self, path):
        self.page.goto(f"http://qym.test{path}")
        return self.page

    def shot(self, name):
        if SHOTS:
            Path(SHOTS).mkdir(parents=True, exist_ok=True)
            self.page.wait_for_timeout(300)
            self.page.screenshot(path=str(Path(SHOTS) / f"{name}.png"))

    def close(self):
        self.context.close()
        self.client.close()


@pytest.fixture()
def open_as(browser, factory):
    apps = []

    def opener(email, width=1280):
        instance = App(browser, factory, email, width)
        apps.append(instance)
        return instance

    yield opener
    for instance in apps:
        instance.close()


# ── C067 ─────────────────────────────────────────────────────────────────


def test_disabling_a_user_asks_first_and_can_be_undone(open_as, factory):
    app = open_as("admin@x.com")
    page = app.goto("/admin")
    page.locator("#admin-tab-users").click()
    toggle = page.locator('[data-user-toggle="member"]')
    toggle.wait_for()
    own = page.locator("#users-tbody tr", has_text="admin@x.com").locator("button", has_text="Disable")
    assert own.is_disabled()
    assert "own account" in own.get_attribute("title")

    toggle.click()
    page.locator("#shell-confirm-submit").click()
    undo = page.locator(".shell-toast-action", has_text="Undo")
    undo.wait_for()
    with factory() as db:
        assert db.get(User, "member").is_active is False
    app.shot("admin-disable-undo")
    undo.click()
    page.locator(".shell-toast", has_text="Enabled Sam Member again").wait_for()
    with factory() as db:
        assert db.get(User, "member").is_active is True
    page.locator('[data-user-toggle="member"][data-active="false"]').wait_for()
    assert app.errors == []


# ── C073 ─────────────────────────────────────────────────────────────────


def test_form_dialog_keeps_quotes_and_markup_in_values(open_as):
    app = open_as("admin@x.com")
    page = app.goto("/admin")
    page.wait_for_function("() => window.QymShell && window.QymShell.openFormDialog")
    tricky = 'QA set "v2" (gold) <b>x</b> & a" autofocus onfocus="window.__pwn=1'
    page.evaluate(
        """(value) => { window.__dialog = window.QymShell.openFormDialog({
            title: 'Rename', fields: [
              { name: 'name', label: 'Name', value },
              { name: 'note', label: 'Note', type: 'textarea', value },
              { name: 'count', label: 'Count', type: 'number', value: 0 },
              { name: 'level', label: 'Level', type: 'select', value: 0,
                options: [{ value: 0, label: 0 }, { value: 1, label: 'One' }] },
            ] }); }""",
        tricky,
    )
    page.locator("#shell-form-dialog").wait_for()
    assert page.locator("#shell-form-field-0").input_value() == tricky
    assert page.locator("#shell-form-field-1").input_value() == tricky
    assert page.locator("#shell-form-field-2").input_value() == "0"
    # An option whose value or label is 0 keeps both.
    assert page.locator("#shell-form-field-3 option").first.get_attribute("value") == "0"
    assert page.locator("#shell-form-field-3 option").first.inner_text() == "0"
    assert page.locator("#shell-form-field-3").input_value() == "0"
    page.locator("#shell-form-submit").click()
    values = page.evaluate("() => window.__dialog.then(result => result.values)")
    assert values["name"] == tricky and values["note"] == tricky
    assert values["level"] == "0"
    assert page.evaluate("() => window.__pwn") is None
    assert app.errors == []


# ── C075 / C078 ──────────────────────────────────────────────────────────


def test_admin_renames_the_project_from_settings(open_as, factory):
    app = open_as("admin@x.com")
    page = app.goto("/projects/pa/settings")
    page.wait_for_function("() => document.getElementById('gen-name').value === 'Support bot'")
    save = page.locator("#save-general-btn")
    assert save.is_disabled(), "Nothing to save yet"
    page.locator("#gen-name").fill("   ")
    assert save.is_disabled(), "A blank name cannot be saved"
    page.locator("#gen-name").fill('Support "bot" v2')
    assert save.is_enabled()
    save.click()
    page.locator(".shell-toast.success", has_text="Project renamed").wait_for()
    with factory() as db:
        assert db.get(Project, "pa").name == 'Support "bot" v2'
    assert page.locator("#project-title").inner_text() == 'Support "bot" v2'
    page.wait_for_function(
        "() => document.getElementById('shell-project-trigger').textContent.includes('Support \"bot\" v2')"
    )
    assert save.is_disabled()
    app.shot("settings-renamed")
    assert app.errors == []


def test_manager_adds_a_member_by_search_without_the_user_directory(open_as, factory):
    app = open_as("mgr@x.com")
    page = app.goto("/projects/pa/settings")
    page.wait_for_function("() => document.getElementById('gen-name').value === 'Support bot'")
    # Managers cannot rename: the field is read-only and says who can.
    assert page.locator("#gen-name").get_attribute("readonly") is not None
    assert page.locator("#gen-name-note").inner_text() == "Only admins can rename a project."
    assert not page.locator("#save-general-btn").is_visible()

    page.locator("#settings-tab-members").click()
    search = page.locator("#member-search")
    search.click()
    page.locator(".member-result").first.wait_for()
    shown = page.locator(".member-result").all_inner_texts()
    # Only people outside the project, never current members.
    assert len(shown) == 3 and not any("member@x.com" in text or "mgr@x.com" in text for text in shown)
    search.fill("omar")
    page.wait_for_function("() => document.querySelectorAll('.member-result').length === 1")
    page.keyboard.press("Enter")
    assert search.input_value() == "Omar Outside (omar@x.com)"
    page.locator("#add-member-btn").click()
    page.locator(".shell-toast.success", has_text="Added Omar Outside").wait_for()
    with factory() as db:
        assert db.query(ProjectMembership).filter_by(project_id="pa", user_id="omar").count() == 1
    assert not any(path.startswith("/v1/users") for path in app.requests)
    app.shot("settings-member-added")
    assert app.errors == []


def test_plain_members_never_load_the_user_directory(open_as):
    app = open_as("member@x.com")
    page = app.goto("/projects/pa/settings")
    page.wait_for_function("() => document.getElementById('gen-name').value === 'Support bot'")
    page.wait_for_timeout(200)
    assert not any("/v1/users" in path or "member-candidates" in path for path in app.requests)
    assert app.errors == []


# ── C062 ─────────────────────────────────────────────────────────────────


def test_members_open_auto_analysis_read_only(open_as):
    app = open_as("member@x.com", width=1440)
    page = app.goto("/projects/pa/analysis")
    banner = page.locator("#pg-read-only-banner")
    banner.wait_for()
    assert "Only project managers can upload documents, change rules or run analysis" in banner.inner_text()
    assert page.locator("#analysis-error").is_hidden()
    assert page.locator("#pg-document-dropzone").count() == 0
    assert page.locator("#pg-create-rule-version").is_disabled()
    page.locator("#analysis-documents-tab").click()
    page.locator("#analysis-documents-view .pg-document-name", has_text="rubric.md").wait_for()
    assert page.locator(".pg-document-select").is_disabled()
    assert page.locator(".pg-document-remove").count() == 0
    documents = page.locator("#analysis-documents-view").inner_text()
    assert "Add documents" not in documents
    assert "Only project managers can add, include or delete documents." in documents
    app.shot("analysis-member-documents")
    assert app.errors == []


CATALOG = {
    "categories": ["Retrieval"],
    "category_details_map": {"Retrieval": ["Missing doc"]},
    "category_taxonomy": {"Retrieval": {"description": "Bad retrieval", "when_to_use": "Context lacks the answer"}},
    "subcategory_taxonomy": {"Retrieval": {"Missing doc": {"description": "Doc missing", "when_to_use": "Not found"}}},
    "max_root_cause_categories": 3,
}

CATEGORY_CONTROLS = """() => {
  const shown = el => !!(el && el.offsetParent);
  const all = s => [...document.querySelectorAll(s)];
  return {
    addCategory: shown(document.getElementById('pg-add-category-btn')),
    addSubcategory: all('.pg-add-detail-row').some(r => !r.hidden && getComputedStyle(r).display !== 'none'),
    removeSubcategory: all('.pg-detail-remove').some(b => !b.hidden),
    fields: all('[data-taxonomy-field], [data-subcategory-taxonomy-field]').map(t => t.readOnly),
  };
}"""


@pytest.mark.parametrize("who,locked", [("member@x.com", True), ("mgr@x.com", False)])
def test_category_catalog_is_read_only_for_members(open_as, who, locked):
    """Members read the categories; only people who can analyze edit them."""
    app = open_as(who, width=1440)
    saved = app.client.put(
        "/api/projects/pa/analysis-category-catalog",
        json=CATALOG,
        headers={"X-User-Email": "mgr@x.com", "Origin": "http://testserver"},
    )
    assert saved.status_code == 200, saved.text
    page = app.goto("/projects/pa/analysis")
    page.locator("#analysis-diagnosis-tab").click()
    page.locator("[data-taxonomy-field='description']").first.wait_for(state="attached")
    controls = page.evaluate(CATEGORY_CONTROLS)
    assert controls["fields"] and all(value is locked for value in controls["fields"]), controls
    assert controls["addCategory"] is (not locked), controls
    assert controls["addSubcategory"] is (not locked), controls
    assert controls["removeSubcategory"] is (not locked), controls
    assert app.errors == []


def test_managers_keep_the_full_auto_analysis_workspace(open_as):
    app = open_as("mgr@x.com", width=1440)
    page = app.goto("/projects/pa/analysis")
    page.locator("#pg-create-rule-version").wait_for(state="attached")
    assert page.locator("#pg-read-only-banner").count() == 0
    assert page.locator("#pg-create-rule-version").is_enabled()
    assert page.locator("#pg-document-input").count() == 1
    assert app.errors == []


# ── C190 / C194 ──────────────────────────────────────────────────────────


def _deleted_runs(factory, count):
    now = datetime.utcnow()
    with factory() as db:
        for index in range(count):
            db.add(
                Run(
                    id=f"del-{index:03d}",
                    project_id="pa" if index % 2 == 0 else "pb",
                    created_by_user_id="mgr",
                    owner_user_id="mgr",
                    task="support-qa",
                    dataset="golden-set-with-a-long-name",
                    model="anthropic/claude-sonnet-5",
                    metrics=["accuracy"],
                    run_metadata={},
                    run_config={"run_name": f"qwen2.5-72b_insightor_arabic_subset_{index:03d}"},
                    status=RunWorkflowStatus.COMPLETED,
                    deleted_at=now - timedelta(days=20, minutes=count - index),
                    deleted_by_user_id="admin",
                )
            )
        db.commit()


@pytest.mark.parametrize("width", [1280, 1440])
def test_deleted_runs_pages_filters_and_keeps_restore_in_view(open_as, factory, width):
    _deleted_runs(factory, 61)
    app = open_as("admin@x.com", width=width)
    page = app.goto("/trash")
    rows = page.locator(".trash-table tbody tr")
    rows.nth(49).wait_for()
    assert rows.count() == 50
    assert page.locator("#trash-stat-total").inner_text() == "61"
    assert page.locator(".qym-pagination__summary").inner_text() == "1–50 of 61 deleted runs"
    layout = page.evaluate(
        """() => {
          const wrap = document.querySelector('.trash-table-wrap').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('.restore-btn')].slice(0, 8);
          const names = [...document.querySelectorAll('.trash-run-name')].slice(0, 8);
          const rows = [...document.querySelectorAll('.trash-table tbody tr')].slice(0, 8);
          return {
            restoreInView: buttons.every(b => { const r = b.getBoundingClientRect(); return r.left >= wrap.left && r.right <= wrap.right + 0.5; }),
            oneLineNames: names.every(n => n.getBoundingClientRect().height < 20),
            maxRow: Math.max(...rows.map(r => r.getBoundingClientRect().height)),
            modelOneLine: [...document.querySelectorAll('.trash-col-model .model-label')].slice(0, 8).every(m => m.getBoundingClientRect().height < 20),
          };
        }"""
    )
    assert layout["restoreInView"], layout
    assert layout["oneLineNames"] and layout["modelOneLine"], layout
    assert layout["maxRow"] <= 56, layout
    app.shot(f"trash-{width}")

    page.locator(".qym-pagination__button[data-qym-page='next']").click()
    page.wait_for_function("() => document.querySelectorAll('.trash-table tbody tr').length === 11")
    assert page.locator(".qym-pagination__summary").inner_text() == "51–61 of 61 deleted runs"

    page.locator("#trash-project").select_option("pb")
    page.wait_for_function("() => document.getElementById('trash-stat-total').textContent === '30 matching'")
    assert page.locator(".trash-table tbody tr").count() == 30
    assert set(page.locator(".trash-col-project .trash-cell-text").all_inner_texts()) == {"Search bot"}
    assert app.errors == []


def test_deleted_runs_restores_a_selection_at_once(open_as, factory):
    _deleted_runs(factory, 6)
    app = open_as("admin@x.com", width=1440)
    page = app.goto("/trash")
    page.locator(".trash-table tbody tr").nth(5).wait_for()
    page.locator("#trash-search").fill("_003")
    page.wait_for_function("() => document.querySelectorAll('.trash-table tbody tr').length === 1")
    page.locator("#trash-search").fill("")
    page.wait_for_function("() => document.querySelectorAll('.trash-table tbody tr').length === 6")
    page.locator('input[data-select-run="del-001"]').check()
    page.locator('input[data-select-run="del-004"]').check()
    bulk = page.locator("#trash-restore-selected")
    assert bulk.inner_text() == "Restore 2 selected"
    bulk.click()
    page.locator(".shell-toast.success", has_text="Restored 2 runs").wait_for()
    page.wait_for_function("() => document.querySelectorAll('.trash-table tbody tr').length === 4")
    with factory() as db:
        assert db.get(Run, "del-001").deleted_at is None
        assert db.get(Run, "del-004").deleted_at is None
        assert db.get(Run, "del-000").deleted_at is not None
    assert bulk.is_disabled()
    assert app.errors == []


# ── C076 / C077 ──────────────────────────────────────────────────────────


@pytest.fixture()
def local_login(factory, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "true")
    monkeypatch.setenv("QYM_AUTH_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("QYM_BASE_URL", "http://qym.test")
    with factory() as db:
        db.add(LocalAuthCredential(user_id="member", password_hash=hash_password(PASSWORD)))
        db.commit()
    return factory


def test_sign_in_never_follows_an_off_site_next(open_as, local_login):
    app = open_as(None)
    page = app.goto("/login?next=/%5Cevil.example/phish")
    page.locator("#email").wait_for()
    # An admin exists and sign-up is not enabled: no sign-up path.
    assert page.locator("[data-toggle-mode]").count() == 0
    assert "Create" not in page.locator("#auth-root").inner_text()
    page.locator("#email").fill("member@x.com")
    page.locator("#password").fill(PASSWORD)
    page.locator(".auth-submit").click()
    page.wait_for_url("http://qym.test/**")
    page.wait_for_function("() => !location.pathname.startsWith('/login')")
    assert urlparse(page.url).hostname == "qym.test"
    assert "evil" not in page.url
    # Nothing but the sign-in page and its POST ever named the bad target.
    assert all(path.startswith(("/login", "/v1/auth/login/password")) for path in app.requests if "evil" in path)
    assert app.errors == []


def test_sign_up_link_sits_below_the_form_when_enabled(open_as, local_login, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOCAL_SIGNUP", "true")
    app = open_as(None)
    page = app.goto("/login")
    link = page.locator(".auth-alt [data-toggle-mode]")
    link.wait_for()
    assert link.inner_text() == "Create an account"
    form_bottom = page.locator("#local-auth-form").bounding_box()
    link_box = link.bounding_box()
    assert link_box["y"] > form_bottom["y"] + form_bottom["height"] - 1
    link.click()
    page.locator("#display-name").wait_for()
    assert page.locator(".auth-alt [data-toggle-mode]").inner_text() == "Sign in"
    app.shot("login-signup")
    assert app.errors == []
