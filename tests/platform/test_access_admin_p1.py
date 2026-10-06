"""P1 access and admin fixes (C067, C075, C076, C077, C078, C062, C194).

- C067: an admin cannot demote themselves (or disable themselves, or leave no
  active admin).
- C075: the user directory (/v1/users) is admin-only; managers find people to
  add through /v1/projects/{id}/member-candidates, plain members get nothing.
- C076: ``next`` after sign-in only ever points at this site.
- C077: failed password sign-ins are throttled per email and client, cost the
  same whether or not the account exists, and self sign-up is off unless
  QYM_AUTH_LOCAL_SIGNUP is set (or nobody holds the admin role yet).
- C078: renaming a project refuses an empty name.
- C062: project members can read analysis documents; changing them and running
  analysis stay with managers and run owners, and the config says which.
- C194: Deleted Runs pages through every deleted run with a total, filters by
  project and name, names each run's project, and restores several at once.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.api import auth as auth_api
from qym_platform.app import create_app
from qym_platform.auth_oidc import sanitize_next
from qym_platform.db import dashboard_models, maintenance_models  # noqa: F401  (tables)
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalyzerDocument,
    AuditLog,
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
from qym_platform.login_throttle import LoginThrottle
from qym_platform.security import hash_password

ORIGIN = {"Origin": "http://testserver"}
PASSWORD = "strong-pass-123"


def _as(email: str) -> dict:
    return {**ORIGIN, "X-User-Email": email}


ADMIN = _as("admin@x.com")
MGR = _as("mgr@x.com")
MEMBER = _as("member@x.com")
OWNER = _as("owner@x.com")


def _make_engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    monkeypatch.setenv("QYM_BASE_URL", "http://testserver")
    monkeypatch.setenv("QYM_ENVIRONMENT", "test")
    monkeypatch.delenv("QYM_AUTH_LOCAL_SIGNUP", raising=False)
    return monkeypatch


def _client(make):
    app = create_app()

    def override_get_db():
        db = make()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _seed_people(make) -> None:
    with make() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", display_name="Admin", role=UserRole.ADMIN),
                User(id="admin2", email="admin2@x.com", display_name="Second Admin", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", display_name="Manager", role=UserRole.MEMBER),
                User(id="member", email="member@x.com", display_name="Member", role=UserRole.MEMBER),
                User(id="owner", email="owner@x.com", display_name="Owner", role=UserRole.MEMBER),
                User(id="out1", email="outside_one@x.com", display_name="Pat 100%", role=UserRole.MEMBER),
                User(id="out2", email="other@y.com", display_name="Robin", role=UserRole.MEMBER),
                User(id="off", email="off@x.com", display_name="Off", role=UserRole.MEMBER, is_active=False),
            ]
        )
        db.flush()
        db.add_all(
            [
                Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin"),
                Project(id="pb", name="Project B", slug="pb", created_by_user_id="admin"),
            ]
        )
        db.flush()
        for user_id, role in (("mgr", ProjectRole.MANAGER), ("member", ProjectRole.MEMBER), ("owner", ProjectRole.MEMBER)):
            db.add(
                ProjectMembership(project_id="pa", user_id=user_id, role=role, added_by_user_id="admin")
            )
        db.commit()


@pytest.fixture()
def people(env):
    engine = _make_engine()
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    _seed_people(make)
    with _client(make) as client:
        yield client, make
    engine.dispose()


# ── C067 ─────────────────────────────────────────────────────────────────


def test_admin_cannot_demote_themselves_even_with_other_admins(people):
    client, make = people
    own = client.put("/v1/admin/users/admin", json={"role": "MEMBER"}, headers=ADMIN)
    assert own.status_code == 409
    assert "your own admin role" in own.json()["detail"]
    own_disable = client.put("/v1/admin/users/admin", json={"is_active": False}, headers=ADMIN)
    assert own_disable.status_code == 400
    # Another admin can still be demoted, and can demote you.
    other = client.put("/v1/admin/users/admin2", json={"role": "MEMBER"}, headers=ADMIN)
    assert other.status_code == 200
    # Keeping your own role (e.g. a name edit sending role=ADMIN) still works.
    rename = client.put(
        "/v1/admin/users/admin", json={"display_name": "Boss", "role": "ADMIN"}, headers=ADMIN
    )
    assert rename.status_code == 200
    with make() as db:
        me = db.get(User, "admin")
        assert me.role == UserRole.ADMIN and me.is_active and me.display_name == "Boss"


# ── C075 ─────────────────────────────────────────────────────────────────


def test_user_directory_is_admin_only(people):
    client, _ = people
    assert client.get("/v1/users", headers=MEMBER).status_code == 403
    assert client.get("/v1/users", headers=MGR).status_code == 403
    listed = client.get("/v1/users", headers=ADMIN)
    assert listed.status_code == 200
    assert "member@x.com" in {row["email"] for row in listed.json()}


def test_member_candidates_for_managers_exclude_members_and_search(people):
    client, _ = people
    assert client.get("/v1/projects/pa/member-candidates", headers=MEMBER).status_code == 403
    assert client.get("/v1/projects/pb/member-candidates", headers=MGR).status_code == 403

    everyone = client.get("/v1/projects/pa/member-candidates", headers=MGR)
    assert everyone.status_code == 200
    emails = [row["email"] for row in everyone.json()["users"]]
    # Active non-members only, by email; no roles or titles.
    assert emails == ["admin2@x.com", "admin@x.com", "other@y.com", "outside_one@x.com"]
    assert set(everyone.json()["users"][0]) == {"id", "email", "display_name"}

    by_name = client.get("/v1/projects/pa/member-candidates?q=robin", headers=MGR).json()
    assert [row["id"] for row in by_name["users"]] == ["out2"]
    # LIKE wildcards in the query are literal.
    assert [r["id"] for r in client.get("/v1/projects/pa/member-candidates?q=_", headers=MGR).json()["users"]] == ["out1"]
    assert [r["id"] for r in client.get("/v1/projects/pa/member-candidates?q=100%25", headers=MGR).json()["users"]] == ["out1"]

    limited = client.get("/v1/projects/pa/member-candidates?limit=2", headers=ADMIN).json()
    assert len(limited["users"]) == 2 and limited["has_more"] is True


# ── C076 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value",
    ["/\\evil.com", "/\\\\evil.com", "/\t/evil.com", "/\n/evil.com", "//evil.com", "https://evil.com", "evil.com", "/x\x7f"],
)
def test_sanitize_next_refuses_values_that_leave_the_site(value):
    assert sanitize_next(value, default="/home") == "/home"


@pytest.mark.parametrize(
    "value", ["/", "/projects/demo/runs?x=1#top", "/%5Cexample.com", "/projects/a b", "/a//b"]
)
def test_sanitize_next_keeps_paths_on_this_site(value):
    assert sanitize_next(value) == value


# ── C077 / C076 password flows ───────────────────────────────────────────


@pytest.fixture()
def local(env):
    env.setenv("QYM_AUTH_LOCAL_ENABLED", "true")
    env.setenv("QYM_AUTH_SESSION_SECRET", "test-session-secret")
    engine = _make_engine()
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with make() as db:
        db.add(User(id="u1", email="person@x.com", role=UserRole.MEMBER))
        db.flush()
        db.add(LocalAuthCredential(user_id="u1", password_hash=hash_password(PASSWORD)))
        db.commit()
    yield make
    engine.dispose()


def _login(client, email, password, next_value=None):
    url = "/v1/auth/login/password"
    if next_value is not None:
        url += "?next=" + next_value
    return client.post(url, json={"email": email, "password": password}, headers=ORIGIN)


def test_password_login_never_returns_an_off_site_next(local):
    with _client(local) as client:
        bad = _login(client, "person@x.com", PASSWORD, "/%5Cevil.com")
        assert bad.status_code == 200
        # Decoded by the query parser: "/\evil.com" -> refused.
        assert bad.json()["next"] == "/"
    with _client(local) as client:
        good = _login(client, "person@x.com", PASSWORD, "/projects/demo")
        assert good.json()["next"] == "/projects/demo"


def test_unknown_email_costs_a_password_hash_like_a_known_one(local, monkeypatch):
    calls = []
    real = auth_api.verify_password

    def counting(password, stored):
        calls.append(stored)
        return real(password, stored)

    monkeypatch.setattr(auth_api, "verify_password", counting)
    with _client(local) as client:
        unknown = _login(client, "nobody@x.com", "wrong-password")
        known = _login(client, "person@x.com", "wrong-password")
    assert unknown.status_code == known.status_code == 401
    assert unknown.json() == known.json() == {"detail": "Invalid email or password"}
    assert len(calls) == 2 and all(stored for stored in calls)


def test_failed_sign_ins_are_throttled_per_email(local):
    with _client(local) as client:
        for _ in range(5):
            assert _login(client, "person@x.com", "wrong-password").status_code == 401
        blocked = _login(client, "person@x.com", PASSWORD)
        # The right password does not get through while the email is locked.
        assert blocked.status_code == 429
        assert "Too many sign-in attempts" in blocked.json()["detail"]
        assert int(blocked.headers["Retry-After"]) > 0
        # An unknown email is throttled the same way, so 429 reveals nothing.
        for _ in range(5):
            assert _login(client, "nobody@x.com", "wrong-password").status_code == 401
        assert _login(client, "nobody@x.com", "wrong-password").status_code == 429
        # The change-password step shares the limit.
        change = client.post(
            "/v1/auth/password/change",
            json={"email": "person@x.com", "current_password": PASSWORD, "new_password": "another-pass-1"},
            headers=ORIGIN,
        )
        assert change.status_code == 429


def test_failed_sign_ins_are_throttled_per_client(local, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_LOGIN_MAX_FAILURES_PER_CLIENT", "3")
    with _client(local) as client:
        for index in range(3):
            assert _login(client, f"guess{index}@x.com", "wrong-password").status_code == 401
        assert _login(client, "person@x.com", PASSWORD).status_code == 429


def test_throttle_window_releases_and_success_resets():
    now = [1000.0]
    throttle = LoginThrottle(max_per_email=2, max_per_client=100, window_seconds=60, clock=lambda: now[0])
    throttle.record_failure("a@x.com", "c")
    throttle.record_failure("a@x.com", "c")
    with pytest.raises(Exception) as blocked:
        throttle.check("a@x.com", "c")
    assert blocked.value.status_code == 429
    assert blocked.value.headers["Retry-After"] == "60"
    now[0] += 61
    throttle.check("a@x.com", "c")
    throttle.record_failure("a@x.com", "c")
    throttle.record_success("a@x.com", "c")
    throttle.record_failure("a@x.com", "c")
    throttle.check("a@x.com", "c")


def test_signup_is_off_once_an_admin_exists_unless_enabled(local, monkeypatch):
    payload = {"email": "new@x.com", "password": PASSWORD}
    with _client(local) as client:
        # Nobody holds the admin role yet: the first person can sign up.
        assert client.get("/v1/auth/providers").json()["local_auth"]["signup_enabled"] is True
    with local() as db:
        db.add(User(id="a", email="a@x.com", role=UserRole.ADMIN))
        db.commit()
    with _client(local) as client:
        assert client.get("/v1/auth/providers").json()["local_auth"] == {
            "enabled": True,
            "signup_enabled": False,
        }
        refused = client.post("/v1/auth/signup/password", json=payload, headers=ORIGIN)
        assert refused.status_code == 403
        assert "Ask an admin" in refused.json()["detail"]
        page = client.get("/login")
        assert '"signup_enabled": false' in page.text
    monkeypatch.setenv("QYM_AUTH_LOCAL_SIGNUP", "true")
    with _client(local) as client:
        assert client.get("/v1/auth/providers").json()["local_auth"]["signup_enabled"] is True
        created = client.post("/v1/auth/signup/password", json=payload, headers=ORIGIN)
        assert created.status_code == 201


# ── C078 ─────────────────────────────────────────────────────────────────


def test_project_rename_requires_a_name(people):
    client, make = people
    blank = client.patch("/v1/admin/projects/pa", json={"name": "   "}, headers=ADMIN)
    assert blank.status_code == 400
    assert client.patch("/v1/admin/projects/pa", json={"name": "x" * 201}, headers=ADMIN).status_code == 400
    assert client.patch("/v1/admin/projects/pa", json={"name": "Renamed"}, headers=MGR).status_code == 403
    renamed = client.patch("/v1/admin/projects/pa", json={"name": "  Renamed A "}, headers=ADMIN)
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed A"
    assert renamed.json()["slug"] == "pa"
    with make() as db:
        audit = db.query(AuditLog).filter(AuditLog.action == "project.updated").one()
        assert audit.after == {"name": "Renamed A"}


# ── C062 ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def analysis(people):
    client, make = people
    with make() as db:
        db.add(
            Run(
                id="r1",
                project_id="pa",
                created_by_user_id="owner",
                owner_user_id="owner",
                task="t",
                dataset="d",
                metrics=["m"],
                run_metadata={},
                run_config={"run_name": "r1"},
                status=RunWorkflowStatus.COMPLETED,
            )
        )
        db.add(AnalyzerDocument(id="doc1", project_id="pa", uploaded_by_user_id="mgr", name="rubric.txt", content="Use evidence.", characters=13))
        db.commit()
    return client


def test_members_can_read_analysis_documents_but_not_change_them(analysis):
    client = analysis
    for path in ("/api/projects/pa/analysis-documents", "/api/runs/r1/analysis-documents"):
        listed = client.get(path, headers=MEMBER)
        assert listed.status_code == 200, path
        assert [doc["name"] for doc in listed.json()["documents"]] == ["rubric.txt"]
    upload = client.post(
        "/api/projects/pa/analysis-documents",
        headers=MEMBER,
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert upload.status_code == 403
    select = client.patch("/api/runs/r1/analysis-documents/doc1", json={"selected": False}, headers=MEMBER)
    assert select.status_code == 403
    # Outsiders still see nothing.
    assert client.get("/api/projects/pa/analysis-documents", headers=_as("other@y.com")).status_code in {403, 404}


def test_analysis_config_says_who_can_operate(analysis):
    client = analysis
    flags = lambda path, who: client.get(path, headers=who).json()["can_operate_analyzer"]  # noqa: E731
    assert flags("/api/projects/pa/analysis-config", MEMBER) is False
    assert flags("/api/projects/pa/analysis-config", OWNER) is False
    assert flags("/api/projects/pa/analysis-config", MGR) is True
    assert flags("/api/runs/r1/analysis-config", MEMBER) is False
    # The run's owner may analyze their own run.
    assert flags("/api/runs/r1/analysis-config", OWNER) is True
    assert flags("/api/runs/r1/analysis-config", MGR) is True


# ── C194 ─────────────────────────────────────────────────────────────────


@pytest.fixture(params=["sqlite", "postgres"])
def trash(request, env):
    env.setenv("QYM_DELETED_RUN_GRACE_DAYS", "30")
    cleanup = None
    if request.param == "postgres":
        from uuid import uuid4

        from sqlalchemy.engine import make_url

        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_trash_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(make_url(url).update_query_dict({"options": f"-csearch_path={schema}"}))

        def cleanup():
            engine.dispose()
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()

        Base.metadata.create_all(engine)
    else:
        engine = _make_engine()
    make = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    _seed_people(make)
    base = datetime(2026, 9, 1, 12, 0, 0)
    with make() as db:
        db.add(Project(id="pc", name="Archived C", slug="pc", created_by_user_id="admin", is_active=False))
        db.flush()
        for index in range(7):
            project = "pa" if index % 2 == 0 else "pb"
            db.add(
                Run(
                    id=f"run-{index}",
                    project_id=project,
                    created_by_user_id="owner",
                    owner_user_id="owner",
                    task="t",
                    dataset="d",
                    metrics=["m"],
                    run_metadata={},
                    run_config={"run_name": f"Nightly {index}" if index != 3 else "Weekly_report"},
                    status=RunWorkflowStatus.COMPLETED,
                    deleted_at=base + timedelta(hours=index),
                    deleted_by_user_id="admin",
                )
            )
        db.add(
            Run(
                id="run-arch",
                project_id="pc",
                created_by_user_id="owner",
                owner_user_id="owner",
                task="t",
                dataset="d",
                metrics=["m"],
                run_metadata={},
                run_config={"run_name": "Archived run"},
                status=RunWorkflowStatus.COMPLETED,
                deleted_at=base + timedelta(hours=10),
            )
        )
        db.add(
            Run(
                id="run-live",
                project_id="pa",
                created_by_user_id="owner",
                owner_user_id="owner",
                task="t",
                dataset="d",
                metrics=["m"],
                run_metadata={},
                run_config={"run_name": "Nightly live"},
                status=RunWorkflowStatus.COMPLETED,
            )
        )
        db.commit()
    try:
        with _client(make) as client:
            yield client, make
    finally:
        if cleanup:
            cleanup()
        else:
            engine.dispose()


def test_trash_pages_through_every_deleted_run(trash):
    client, _ = trash
    seen = []
    offset = 0
    while True:
        page = client.get(f"/api/runs/trash?limit=3&offset={offset}", headers=ADMIN)
        assert page.status_code == 200
        assert page.headers["X-Qym-Total-Count"] == "8"
        rows = page.json()
        if not rows:
            break
        assert len(rows) <= 3
        seen.extend(row["id"] for row in rows)
        offset += 3
    # Every deleted run once, soonest purge first; never the live run.
    assert seen == [f"run-{i}" for i in range(7)] + ["run-arch"]
    first = client.get("/api/runs/trash?limit=1", headers=ADMIN).json()[0]
    assert (first["project_id"], first["project_name"], first["project_slug"]) == ("pa", "Project A", "pa")
    assert client.get("/api/runs/trash?limit=201", headers=ADMIN).status_code == 422
    assert client.get("/api/runs/trash", headers=MGR).status_code == 403


def test_trash_filters_by_project_and_name(trash):
    client, _ = trash
    only_b = client.get("/api/runs/trash?project_id=pb", headers=ADMIN)
    assert only_b.headers["X-Qym-Total-Count"] == "3"
    assert [row["id"] for row in only_b.json()] == ["run-1", "run-3", "run-5"]
    by_name = client.get("/api/runs/trash?q=WEEKLY", headers=ADMIN)
    assert [row["id"] for row in by_name.json()] == ["run-3"]
    # "_" is literal, not a wildcard.
    assert [row["id"] for row in client.get("/api/runs/trash?q=y_r", headers=ADMIN).json()] == ["run-3"]
    by_id = client.get("/api/runs/trash?q=run-ar", headers=ADMIN)
    assert [row["id"] for row in by_id.json()] == ["run-arch"]

    facets = client.get("/api/runs/trash/projects", headers=ADMIN)
    assert facets.status_code == 200
    assert facets.json() == [
        {"id": "pc", "name": "Archived C", "slug": "pc", "archived": True, "deleted_runs": 1},
        {"id": "pa", "name": "Project A", "slug": "pa", "archived": False, "deleted_runs": 4},
        {"id": "pb", "name": "Project B", "slug": "pb", "archived": False, "deleted_runs": 3},
    ]
    assert client.get("/api/runs/trash/projects", headers=MGR).status_code == 403


def test_trash_restores_several_runs_at_once(trash):
    client, make = trash
    restored = client.post(
        "/api/runs/restore",
        json={"run_ids": ["run-2", "run-0", "run-arch", "run-live", "run-2"]},
        headers=ADMIN,
    )
    assert restored.status_code == 200
    body = restored.json()
    assert body["restored"] == ["run-0", "run-2"]
    assert {row["run_id"]: row["reason"] for row in body["skipped"]} == {
        "run-arch": "Project is archived; unarchive it to make changes",
        "run-live": "Deleted run not found",
    }
    with make() as db:
        assert db.get(Run, "run-0").deleted_at is None
        assert db.get(Run, "run-2").deleted_at is None
        assert db.get(Run, "run-arch").deleted_at is not None
        assert db.query(AuditLog).filter(AuditLog.action == "run.restored").count() == 2
    assert client.get("/api/runs/trash", headers=ADMIN).headers["X-Qym-Total-Count"] == "6"
    assert client.post("/api/runs/restore", json={"run_ids": []}, headers=ADMIN).status_code == 400
    assert client.post("/api/runs/restore", json={"run_ids": ["x"] * 201}, headers=ADMIN).status_code == 400
    assert client.post("/api/runs/restore", json={"run_ids": ["run-1"]}, headers=MGR).status_code == 403
