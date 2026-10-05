"""Fixtures shared by the platform test modules.

These fixtures were copied into, or imported across, several test modules. A
module that needs different behavior (auth env, seed data, database backend)
defines a fixture with the same name, and that local fixture wins.

qym_platform is imported inside the fixture bodies: some test modules set env
defaults or stub ``openai`` before they import the app, and loading this file
first must not change that order. Plain helpers live in ``_helpers.py``.
"""

import os
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from _helpers import app_client, setup, sqlite_session_factory

MIGRATIONS = (
    Path(__file__).resolve().parents[2] / "packages/platform/qym_platform/migrations"
)


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture()
def session_factory():
    with sqlite_session_factory() as factory:
        yield factory


@pytest.fixture()
def client(session_factory):
    with app_client(session_factory) as test_client:
        yield test_client


@pytest.fixture(params=["sqlite", "postgres"])
def database(request):
    from qym_platform.db.models import Base, Project, User, UserRole

    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_dashboard_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine(
            "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
        )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            User(
                id="u",
                email="owner@example.test",
                display_name="Owner",
                role=UserRole.ADMIN,
            )
        )
        db.flush()
        db.add(Project(id="p", name="Project", slug="test", created_by_user_id="u"))
        db.commit()
    try:
        yield engine
    finally:
        engine.dispose()
        if admin:
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


@pytest.fixture
def db_session():
    from qym_platform.db.base import Base

    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _sqlite_functions(connection, _record) -> None:
        connection.create_function("btrim", 1, lambda value: str(value or "").strip())

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def repeat(db_session):
    from qym_platform.db.models import RunItemAttempt, RunItemPassScore
    from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY

    # Match SessionLocal, not SQLAlchemy's default autoflush=True.
    db_session.autoflush = False
    _, run, item, principal = setup(db_session)
    run.samples = 2
    original = deepcopy(item.item_metadata)
    analysis = {
        "source": "ai",
        "confidence": 0.9,
        "root_cause": "New approved category",
        "root_cause_issues": [
            {
                "issue_id": "shared-issue-1",
                "category": "New approved category",
                "subcategory": "Approved detail",
                "finding": "First finding",
            },
            {
                "issue_id": "shared-issue-2",
                "category": "Unapproved category",
                "subcategory": "Unapproved detail",
                "finding": "Second finding",
            },
        ],
        "category_taxonomy": {
            "New approved category": {
                "description": "Reviewed failure.",
                "when_to_use": "When observed.",
            },
            "Unapproved category": {
                "description": "Pending failure.",
                "when_to_use": "Unreviewed.",
            },
        },
    }
    for number in (1, 2):
        db_session.add(
            RunItemPassScore(
                run_id=run.id,
                item_id=item.item_id,
                metric_name="accuracy",
                pass_number=number,
                score_numeric=number / 10,
                meta={
                    PASS_ANALYSIS_META_KEY: deepcopy(analysis),
                    "reason": "Judge reason",
                },
            )
        )
        db_session.add(
            RunItemAttempt(
                run_id=run.id,
                item_id=item.item_id,
                pass_number=number,
                attempt_number=1,
                status="completed",
                is_last_attempt=True,
                output={"answer": f"Pass {number}"},
            )
        )
    db_session.commit()
    return run, item, principal, original


@pytest.fixture
def migrated_postgres(monkeypatch):
    """A schema built by the real Alembic chain (partitioned spans, cascades)."""
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_ret_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("QYM_DATABASE_URL", scoped.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    command.upgrade(config, "head")
    engine = create_engine(scoped)
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture
def postgres(request, monkeypatch):
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_migration_lifecycle_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    engine = create_engine(scoped)
    monkeypatch.setenv("QYM_DATABASE_URL", scoped.render_as_string(hide_password=False))
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))

    def cleanup():
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()

    request.addfinalizer(cleanup)
    return engine, config
