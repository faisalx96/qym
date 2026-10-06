"""The member-removal dialog offers to transfer the member's runs (real browser).

P1 round 2, C072: the dialog lists how many runs the member owns in the
project and offers another active member to take them, in the same request as
the removal. Removing without a transfer stays possible. Destructive dialog:
it opens on Cancel and Escape closes it without a request.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.db.base import Base
from qym_platform.db.models import (
    AuditLog,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)

from test_reviews_queue_browser import App, browser  # noqa: F401  (fixture)

pytestmark = pytest.mark.browser

NOW = datetime.utcnow().replace(microsecond=0)


@pytest.fixture()
def make(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="owner", email="dev@local", display_name="Dev", role=UserRole.ADMIN),
                User(id="dana", email="dana@example.com", display_name="Dana Doe", role=UserRole.MEMBER),
                User(id="sam", email="sam@example.com", display_name="Sam Lee", role=UserRole.MEMBER),
                User(id="off", email="off@example.com", display_name="Off Line", role=UserRole.MEMBER, is_active=False),
            ]
        )
        db.flush()
        db.add(Project(id="pa", name="Support bot", slug="pa", created_by_user_id="owner"))
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id="pa", user_id="owner", role=ProjectRole.MANAGER),
                ProjectMembership(project_id="pa", user_id="dana", role=ProjectRole.MEMBER),
                ProjectMembership(project_id="pa", user_id="sam", role=ProjectRole.MEMBER),
                ProjectMembership(project_id="pa", user_id="off", role=ProjectRole.MEMBER),
            ]
        )
        for index in range(3):
            db.add(
                Run(
                    id=f"r{index}", project_id="pa", created_by_user_id="dana", owner_user_id="dana",
                    task="t", dataset="d", metrics=["accuracy"], run_metadata={}, run_config={"run_name": f"run {index}"},
                    status=RunWorkflowStatus.COMPLETED, created_at=NOW - timedelta(days=index),
                    deleted_at=NOW if index == 2 else None,
                )
            )
        db.commit()
    yield factory
    engine.dispose()


@pytest.fixture()
def app(browser, make):  # noqa: F811
    instance = App(browser, make)
    yield instance
    instance.close()


def _open_removal(app):
    page = app.goto("/projects/pa/settings")
    page.click("#settings-tab-members")
    page.locator('[data-member-remove="dana"]').click()
    page.locator("#remove-member-dialog").wait_for()
    page.wait_for_function(
        "document.getElementById('remove-member-runs').textContent.includes('owns 3 runs')"
    )
    return page


def _deletes(app):
    return [target for method, target, _ in app.requests if method == "DELETE"]


def _owners(make):
    with make() as db:
        return {run.id: run.owner_user_id for run in db.query(Run).order_by(Run.id)}


def test_removal_dialog_transfers_the_members_runs_in_one_request(app, make):
    page = _open_removal(app)
    # A destructive dialog opens on Cancel.
    assert page.evaluate("document.activeElement.textContent") == "Cancel"
    assert page.locator("#remove-member-runs").inner_text() == "Dana Doe owns 3 runs in this project, 1 of them in Deleted Runs."
    options = page.eval_on_selector_all("#remove-member-transfer option", "opts => opts.map(o => [o.value, o.textContent])")
    # Only other active members can take the runs (in the members list order).
    assert options[0] == ["", "Keep them with Dana Doe"]
    assert sorted(options[1:]) == [
        ["owner", "Transfer to Dev (dev@local)"],
        ["sam", "Transfer to Sam Lee (sam@example.com)"],
    ]
    assert page.locator("#remove-member-confirm").inner_text() == "Remove member"
    page.select_option("#remove-member-transfer", "sam")
    assert page.locator("#remove-member-confirm").inner_text() == "Transfer 3 runs and remove"
    assert "Sam Lee becomes their owner" in page.locator("#remove-member-note").inner_text()

    page.click("#remove-member-confirm")
    page.locator("#remove-member-dialog").wait_for(state="detached")
    page.wait_for_function("!document.querySelector('[data-member-remove=\"dana\"]')")
    assert _deletes(app) == ["/v1/projects/pa/members/dana?transfer_runs_to=sam"]
    assert _owners(make) == {"r0": "sam", "r1": "sam", "r2": "sam"}
    with make() as db:
        assert db.query(AuditLog).filter_by(action="run.owner_transferred").count() == 3
    assert app.errors == []


def test_removal_without_a_transfer_and_escape_send_what_they_say(app, make):
    page = _open_removal(app)
    page.keyboard.press("Escape")
    page.locator("#remove-member-dialog").wait_for(state="detached")
    assert _deletes(app) == []

    page.locator('[data-member-remove="dana"]').click()
    page.wait_for_function("document.getElementById('remove-member-runs').textContent.includes('owns 3 runs')")
    assert "They stay in the project, owned by Dana Doe" in page.locator("#remove-member-note").inner_text()
    page.click("#remove-member-confirm")
    page.locator("#remove-member-dialog").wait_for(state="detached")
    assert _deletes(app) == ["/v1/projects/pa/members/dana"]
    assert _owners(make) == {"r0": "dana", "r1": "dana", "r2": "dana"}
    assert app.errors == []
