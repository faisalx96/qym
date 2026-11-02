"""C173: the run page's "Export HTML" builds its file from the built React export page.

``GET /api/export/run-template`` returns ``_static/app/export.html`` as built
by the frontend, or a 404 that says to build it. The old template, still used
by the Compare export and API callers, is a read-only snapshot.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from qym_platform.api import spa
from qym_platform.app import create_app
from qym_platform.auth import require_ui_principal
from qym_platform.db.base import Base
from qym_platform.deps import get_db
from qym_platform.services.html_export import EXPORT_TEMPLATE_DIR


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    app = create_app()

    def override():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    # The page holds no data; only the route is under test, not the auth mode another test may have left set.
    app.dependency_overrides[require_ui_principal] = lambda: None
    return TestClient(app)


def test_template_route_serves_the_built_export_page(client, tmp_path, monkeypatch):
    (tmp_path / "export.html").write_text("<!doctype html><!--__QYM_RUN_SNAPSHOT__--><div id=root></div>")
    monkeypatch.setattr(spa, "spa_dir", lambda: tmp_path)
    response = client.get("/api/export/run-template")
    assert response.status_code == 200
    assert "<!--__QYM_RUN_SNAPSHOT__-->" in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_template_route_says_to_build_when_the_page_is_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(spa, "spa_dir", lambda: tmp_path)
    response = client.get("/api/export/run-template")
    assert response.status_code == 404
    assert "npm run build" in response.text


def test_old_template_has_no_offline_edit_mode():
    page = (EXPORT_TEMPLATE_DIR / "run.html").read_text(encoding="utf-8")
    assert "Download with Changes" not in page
    assert "Edits are saved in your browser" not in page
    assert "qym_export_" not in page
    assert "Read-only snapshot" in page
