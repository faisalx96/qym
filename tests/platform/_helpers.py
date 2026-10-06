"""Helpers shared by the platform test modules and ``conftest.py``.

Pytest imports every ``conftest.py`` as a module named ``conftest``, so tests
import shared helpers from here instead. qym_platform is imported inside each
function: some test modules stub ``openai`` before they import the app, and
importing this module must not change that order.
"""

from contextlib import contextmanager
from copy import deepcopy

from sqlalchemy import Column, MetaData, Table, create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ISSUES = [
    {
        "category": "Agent behavior",
        "subcategory": "Retrieval omission",
        "finding": "The lookup omitted a valid active status.",
    },
    {
        "category": "Agent behavior",
        "subcategory": "Predicate construction",
        "finding": "The final filter used OR instead of AND.",
    },
]


@contextmanager
def sqlite_session_factory():
    """Yield a sessionmaker bound to a new in-memory SQLite schema."""
    from qym_platform.db.base import Base

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    try:
        yield SessionLocal
    finally:
        engine.dispose()


def insert_at_revision(connection, model, /, **values):
    """Insert one ``model`` row into a schema migrated to an older revision.

    An ORM insert names every column of the current model, so a table that
    predates a later migration rejects it. Insert only the columns the live
    table has, with the model's types and Python-side defaults.
    """
    live = {column["name"] for column in inspect(connection).get_columns(model.__tablename__)}
    unknown = set(values) - live
    assert not unknown, f"{model.__tablename__} has no {sorted(unknown)} at this revision"
    columns = [column for column in model.__table__.columns if column.name in live]
    row = dict(values)
    for column in columns:
        default = column.default
        if column.name in row or default is None:
            continue
        row[column.name] = default.arg(None) if default.is_callable else default.arg
    table = Table(
        model.__tablename__,
        MetaData(),
        *(Column(column.name, column.type, primary_key=column.primary_key) for column in columns),
    )
    connection.execute(table.insert().values(row))


@contextmanager
def app_client(session_factory):
    """Yield a TestClient for a new app whose ``get_db`` uses ``session_factory``."""
    from fastapi.testclient import TestClient

    from qym_platform.app import create_app
    from qym_platform.deps import get_db

    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _make_env():
    """Return ``(app, SessionLocal)`` for a new app on an in-memory SQLite schema."""
    from qym_platform.app import create_app
    from qym_platform.db.base import Base
    from qym_platform.deps import get_db

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    app = create_app()

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return app, SessionLocal


def _seed_run(session):
    """Seed the user, project, completed run, item and score of the issue tests."""
    from qym_platform.db.models import (
        Project,
        Run,
        RunItem,
        RunItemScore,
        RunWorkflowStatus,
        User,
    )

    actor = User(id="issue-user", email="issue-user@example.com")
    project = Project(
        id="issue-project",
        name="Issue Project",
        slug="issue-project",
        created_by_user_id=actor.id,
        is_active=True,
    )
    run = Run(
        id="issue-run",
        project_id=project.id,
        created_by_user_id=actor.id,
        owner_user_id=actor.id,
        task="issue-task",
        dataset="issue-dataset",
        metrics=["accuracy"],
        status=RunWorkflowStatus.COMPLETED,
    )
    item = RunItem(
        run_id=run.id,
        item_id="issue-item",
        index=0,
        input={"question": "q"},
        expected={"answer": "expected"},
        output={"answer": "actual"},
        item_metadata={},
    )
    score = RunItemScore(
        run_id=run.id,
        item_id=item.item_id,
        metric_name="accuracy",
        score_numeric=0.0,
        meta={"reason": "wrong"},
    )
    session.add_all([actor, project, run, item, score])
    session.commit()
    return actor, run, item


def setup(session):
    """Seed the issue run with an AI accuracy analysis that holds ``ISSUES``."""
    from qym_platform.auth import Principal

    actor, run, item = _seed_run(session)
    analysis = {"root_cause_issues": deepcopy(ISSUES), "root_cause": ISSUES[0]["category"], "source": "ai", "solution": "Old shared solution", "solution_note": "Shared notes"}
    item.item_metadata = {"metric_analyses": {"accuracy": analysis, "style": {"keep": True}}}
    session.commit()
    return actor, run, item, Principal(user=actor, auth_type="none")
