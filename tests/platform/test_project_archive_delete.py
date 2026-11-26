"""C021: "Archive" archives and "Delete" deletes.

Archive is reversible and never removes rows. Delete needs a typed
confirmation, removes everything a run-less project owns (including datasets
and LLM connections, which used to fail on a foreign key), and is refused with
a clear 409 while the project still has runs.
"""

from __future__ import annotations

import hashlib
import os
import sys
import zlib
from datetime import datetime
from pathlib import Path

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from _helpers import app_client
from _live_support import _png
from _performance_support import (
    NOW as PERFORMANCE_NOW,
    seed_dataset,
    seed_run,
    seed_runner,
    seed_target,
    use_encryption_key,
)

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    AnalyzerDocument,
    ApiKey,
    AuditLog,
    Dataset,
    DatasetAlias,
    DatasetItem,
    DatasetItemRevision,
    DatasetReadToken,
    DatasetVersion,
    DatasetVersionChange,
    DatasetVersionStatus,
    LiveCanaryResult,
    LiveChartImage,
    LiveChartSnapshot,
    LiveChartStyle,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
    PerformanceEvent,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceReport,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    PerformanceTargetToken,
    Project,
    ProjectAnalysisCategoryCatalogVersion,
    ProjectAnalysisRuleMergeParent,
    ProjectAnalysisRuleVersion,
    ProjectLlmConnection,
    ProjectMembership,
    ProjectRole,
    Run,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key

ADMIN = {"X-User-Email": "admin@x.com", "Origin": "http://localhost:8000"}
MANAGER = {"X-User-Email": "mgr@x.com", "Origin": "http://localhost:8000"}


@pytest.fixture()
def session_factory(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    # Enforce foreign keys like PostgreSQL does, so a missed child table fails.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
            ]
        )
        db.commit()
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = create_app()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _create_project(client, session_factory, slug: str) -> str:
    """A project set up like a new one: rules, catalog, member, key, dataset, LLM."""
    response = client.post("/v1/projects", json={"name": f"Project {slug}", "slug": slug}, headers=ADMIN)
    assert response.status_code == 200
    project_id = response.json()["id"]
    with session_factory() as db:
        db.add(ProjectMembership(project_id=project_id, user_id="mgr", role=ProjectRole.MANAGER))
        db.add(
            ApiKey(
                id=f"key-{slug}",
                user_id="mgr",
                project_id=project_id,
                name="ci",
                prefix=api_key_prefix(f"tok-{slug}-xxxxxxxx"),
                key_hash=hash_api_key(f"tok-{slug}-xxxxxxxx"),
                scopes=[],
            )
        )
        db.add(
            ProjectLlmConnection(
                id=f"llm-{slug}", project_id=project_id, name="default", is_default=True
            )
        )
        db.add(
            AnalyzerDocument(
                id=f"doc-{slug}",
                project_id=project_id,
                uploaded_by_user_id="admin",
                name="guide.md",
                content="text",
                characters=4,
            )
        )
        # One live and one revoked read token: both keep a foreign key.
        for index, revoked in enumerate((None, datetime.utcnow())):
            db.add(
                DatasetReadToken(
                    project_id=project_id, name=f"svc-{index}", prefix=f"qrt{index}{slug}"[:16],
                    token_hash=b"x", created_by_user_id="admin", revoked_at=revoked,
                )
            )
        dataset = Dataset(id=f"ds-{slug}", project_id=project_id, name="golden", slug="golden", created_by_user_id="mgr")
        db.add(dataset)
        db.flush()
        v1 = DatasetVersion(
            id=f"v1-{slug}", dataset_id=dataset.id, version="v1", created_by_user_id="mgr",
            status=DatasetVersionStatus.PUBLISHED,
        )
        db.add(v1)
        db.flush()
        v2 = DatasetVersion(
            id=f"v2-{slug}", dataset_id=dataset.id, version="v2", created_by_user_id="mgr",
            parent_version_id=v1.id, base_version_id=v1.id,
        )
        db.add(v2)
        db.flush()
        item = DatasetItem(dataset_version_id=v2.id, item_id="case-1", input="q", fingerprint="f")
        db.add(item)
        db.flush()
        db.add_all(
            [
                DatasetItemRevision(
                    dataset_item_id=item.id, dataset_version_id=v2.id, revision_number=1,
                    change_type="add", actor_user_id="mgr",
                ),
                DatasetVersionChange(dataset_version_id=v2.id, parent_version_id=v1.id),
                DatasetAlias(dataset_id=dataset.id, alias="production", dataset_version_id=v1.id, updated_by_user_id="mgr"),
            ]
        )
        first_rules = (
            db.query(ProjectAnalysisRuleVersion)
            .filter(ProjectAnalysisRuleVersion.project_id == project_id)
            .one()
        )
        merged = ProjectAnalysisRuleVersion(
            id=f"rules-merged-{slug}", project_id=project_id, version=2,
            parent_version_id=first_rules.id, base_version_id=first_rules.id,
        )
        db.add(merged)
        db.flush()
        db.add(ProjectAnalysisRuleMergeParent(version_id=merged.id, parent_version_id=first_rules.id))
        db.commit()
    return project_id


def _add_run(session_factory, project_id: str, *, trashed: bool = False) -> None:
    with session_factory() as db:
        db.add(
            Run(
                project_id=project_id,
                created_by_user_id="admin",
                owner_user_id="admin",
                task="t",
                dataset="d",
                metrics=[],
                run_metadata={},
                run_config={},
                status=RunWorkflowStatus.COMPLETED,
                deleted_at=datetime.utcnow() if trashed else None,
            )
        )
        db.commit()


def _row_counts(session_factory, project_id: str) -> dict:
    with session_factory() as db:
        dataset_ids = [d.id for d in db.query(Dataset).filter(Dataset.project_id == project_id)]
        return {
            "project": db.query(Project).filter(Project.id == project_id).count(),
            "keys": db.query(ApiKey).filter(ApiKey.project_id == project_id).count(),
            "read_tokens": db.query(DatasetReadToken)
            .filter(DatasetReadToken.project_id == project_id)
            .count(),
            "members": db.query(ProjectMembership).filter(ProjectMembership.project_id == project_id).count(),
            "llm": db.query(ProjectLlmConnection).filter(ProjectLlmConnection.project_id == project_id).count(),
            "docs": db.query(AnalyzerDocument).filter(AnalyzerDocument.project_id == project_id).count(),
            "datasets": len(dataset_ids),
            "versions": db.query(DatasetVersion).filter(DatasetVersion.dataset_id.in_(dataset_ids)).count(),
            "rules": db.query(ProjectAnalysisRuleVersion).filter(ProjectAnalysisRuleVersion.project_id == project_id).count(),
            "catalogs": db.query(ProjectAnalysisCategoryCatalogVersion)
            .filter(ProjectAnalysisCategoryCatalogVersion.project_id == project_id)
            .count(),
        }


def test_archive_never_deletes_a_runless_project(client, session_factory):
    project_id = _create_project(client, session_factory, "fresh")
    before = _row_counts(session_factory, project_id)
    assert before["keys"] == 1 and before["members"] == 2

    response = client.post(f"/v1/admin/projects/{project_id}/archive", headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        assert db.get(Project, project_id).is_active is False
        assert db.query(AuditLog).filter(AuditLog.action == "project.archived").count() == 1

    # Idempotent, and reversible.
    assert client.post(f"/v1/admin/projects/{project_id}/archive", headers=ADMIN).status_code == 200
    restored = client.post(f"/v1/admin/projects/{project_id}/unarchive", headers=ADMIN)
    assert restored.status_code == 200
    assert restored.json()["is_active"] is True
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        assert db.query(AuditLog).filter(AuditLog.action == "project.unarchived").count() == 1


def test_delete_requires_typed_confirmation(client, session_factory):
    project_id = _create_project(client, session_factory, "confirm-me")
    before = _row_counts(session_factory, project_id)
    for url in (
        f"/v1/admin/projects/{project_id}",
        f"/v1/admin/projects/{project_id}?confirm=wrong",
    ):
        response = client.delete(url, headers=ADMIN)
        assert response.status_code == 400
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        # The old combined endpoint archived on DELETE; now nothing happens.
        assert db.get(Project, project_id).is_active is True


def test_delete_removes_datasets_llm_connections_and_settings(client, session_factory):
    project_id = _create_project(client, session_factory, "doomed")
    keep_id = _create_project(client, session_factory, "keeper")
    keep_before = _row_counts(session_factory, keep_id)

    preview = client.get(f"/v1/admin/projects/{project_id}/deletion", headers=ADMIN)
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_delete"] is True and body["blocked_reason"] is None
    assert body["counts"] == {
        "runs": 0,
        "runs_in_trash": 0,
        "datasets": 1,
        "api_keys": 1,
        "members": 2,
        "llm_connections": 1,
        "rule_versions": 2,
        "analyzer_documents": 1,
        "live_sources": 0,
        "live_turns": 0,
        "performance_runners": 0,
        "performance_targets": 0,
        "performance_runs": 0,
    }

    response = client.delete(f"/v1/admin/projects/{project_id}?confirm=Project%20doomed", headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is True
    assert response.json()["counts"]["datasets"] == 1
    assert _row_counts(session_factory, project_id) == {
        "project": 0, "keys": 0, "read_tokens": 0, "members": 0, "llm": 0, "docs": 0,
        "datasets": 0, "versions": 0, "rules": 0, "catalogs": 0,
    }
    with session_factory() as db:
        assert db.query(DatasetItem).count() == 1  # the other project's item
        assert db.query(ProjectAnalysisRuleMergeParent).count() == 1
        audit = db.query(AuditLog).filter(AuditLog.action == "project.deleted").one()
        assert audit.entity_id == project_id
    assert _row_counts(session_factory, keep_id) == keep_before


@pytest.mark.parametrize("foreign_keys", [True, False])
def test_delete_removes_live_rows_only_for_the_project(client, session_factory, foreign_keys):
    if not foreign_keys:
        with session_factory() as db:
            db.connection().exec_driver_sql("PRAGMA foreign_keys=OFF")
    image = _png()
    projects = {}
    now = datetime(2026, 11, 1, 12)
    for slug in ("live-doomed", "live-keeper"):
        project_id = _create_project(client, session_factory, slug)
        with session_factory() as db:
            source = LiveSource(
                project_id=project_id, key="worker", name="Worker", environment="test"
            )
            db.add(source)
            db.flush()
            turn = LiveTurn(
                source_id=source.id, day=now.date(), turn_id="turn-1",
                turn_at=now, status="completed", question="Question?",
            )
            db.add_all(
                [
                    LiveMetricSpec(
                        source_id=source.id, metric_name="accuracy", score_type="numeric",
                        group_name="quality", label="Accuracy",
                    ),
                    LiveDay(source_id=source.id, day=now.date()),
                    turn,
                    LiveCanaryResult(
                        source_id=source.id, canary="health", checked_at=now, status="ok"
                    ),
                ]
            )
            db.flush()
            db.add(LiveTurnScore(turn_pk=turn.id, metric_name="accuracy", score_numeric=1.0))
            db.add(
                LiveChartImage(
                    turn_pk=turn.id, ref="chart_20261101_abcd1234", content_type="image/png",
                    byte_size=len(image), width=3, height=2,
                    sha256=hashlib.sha256(image).hexdigest(), image=image, received_at=now,
                )
            )
            db.add(
                LiveChartSnapshot(
                    turn_pk=turn.id, ref="chart_20261101_ffff0000", html=b"x", html_size=1,
                    byte_size=1, sha256="0" * 64, style_sha256="1" * 64, viewport_width=1248,
                    box_x=0, box_y=0, box_width=1248, box_height=462, received_at=now,
                )
            )
            db.add(
                LiveChartStyle(
                    source_id=source.id, sha256="1" * 64, css=b"x", css_size=1, byte_size=1,
                    received_at=now,
                )
            )
            projects[slug] = (project_id, source.id, turn.id)
            db.commit()

    project_id, _, _ = projects["live-doomed"]
    preview = client.get(f"/v1/admin/projects/{project_id}/deletion", headers=ADMIN)
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_delete"] is True and body["blocked_reason"] is None

    response = client.delete(
        f"/v1/admin/projects/{project_id}?confirm=live-doomed", headers=ADMIN
    )
    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is True
    assert body["counts"]["live_sources"] == 1
    assert body["counts"]["live_turns"] == 1
    assert response.json()["counts"] == body["counts"]
    with session_factory() as db:
        for slug, expected in (("live-doomed", 0), ("live-keeper", 1)):
            project_id, source_id, turn_pk = projects[slug]
            assert db.query(Project).filter(Project.id == project_id).count() == expected
            assert db.query(LiveSource).filter(LiveSource.project_id == project_id).count() == expected
            for model in (LiveMetricSpec, LiveDay, LiveTurn, LiveCanaryResult, LiveChartStyle):
                assert db.query(model).filter(model.source_id == source_id).count() == expected
            assert db.query(LiveTurnScore).filter(LiveTurnScore.turn_pk == turn_pk).count() == expected
            assert db.query(LiveChartImage).filter(LiveChartImage.turn_pk == turn_pk).count() == expected
            assert db.query(LiveChartSnapshot).filter(LiveChartSnapshot.turn_pk == turn_pk).count() == expected


def _add_performance_rows(db, project_id: str, slug: str) -> dict:
    """A runner with two events, a target with both tokens, an ended run with two
    questions, a report and more log lines than one delete batch, and a run in progress."""
    project, manager = db.get(Project, project_id), db.get(User, "mgr")
    runner = seed_runner(
        db, project, api_key=db.get(ApiKey, f"key-{slug}"), user=manager
    )
    target = seed_target(db, project, user=manager)
    version = seed_dataset(db, project, manager)
    ended = seed_run(
        db, project, runner, target, version=version, user=manager,
        status="finished", report_received_at=PERFORMANCE_NOW,
    )
    active = seed_run(
        db, project, runner, target, version=version, user=manager, status="running"
    )
    for seq in (1, 2):
        db.add(
            PerformanceQuestion(
                run_id=ended.id, seq=seq, asked_at=PERFORMANCE_NOW, elapsed_s=float(seq),
                stage="hold", level=10, user_number=1, tier="simple",
                question_id="simple-1", question="Question simple-1?", status="ok",
                http_status=200, duration_ms=1200.0,
            )
        )
    db.execute(
        insert(PerformanceLogLine),
        [
            {"run_id": ended.id, "seq": seq, "at": PERFORMANCE_NOW, "level": "info", "message": f"line {seq}"}
            for seq in range(1, 1002)
        ],
    )
    db.add(
        PerformanceLogLine(
            run_id=active.id, seq=1, at=PERFORMANCE_NOW, level="info", message="started"
        )
    )
    html = zlib.compress(b"<p>report</p>")
    db.add(
        PerformanceReport(
            run_id=ended.id, content_type="text/html", html=html, html_size=13,
            byte_size=len(html), sha256=hashlib.sha256(b"<p>report</p>").hexdigest(),
            received_at=PERFORMANCE_NOW,
        )
    )
    db.add_all(
        [
            PerformanceEvent(
                runner_id=runner.id, run_id=ended.id, at=PERFORMANCE_NOW, level="info",
                code="claimed", message="The runner took the run.", source="qym",
            ),
            PerformanceEvent(
                runner_id=runner.id, at=PERFORMANCE_NOW, level="warning",
                code="records_dropped", message="Some records were dropped.",
            ),
        ]
    )
    db.flush()
    return {"runner": runner.id, "target": target.id, "runs": [ended.id, active.id]}


def _performance_row_counts(db, project_id: str, ids: dict) -> dict:
    return {
        "runners": db.query(PerformanceRunner).filter(PerformanceRunner.project_id == project_id).count(),
        "events": db.query(PerformanceEvent).filter(PerformanceEvent.runner_id == ids["runner"]).count(),
        "targets": db.query(PerformanceTarget).filter(PerformanceTarget.project_id == project_id).count(),
        "tokens": db.query(PerformanceTargetToken).filter(PerformanceTargetToken.target_id == ids["target"]).count(),
        "runs": db.query(PerformanceRun).filter(PerformanceRun.project_id == project_id).count(),
        "questions": db.query(PerformanceQuestion).filter(PerformanceQuestion.run_id.in_(ids["runs"])).count(),
        "log_lines": db.query(PerformanceLogLine).filter(PerformanceLogLine.run_id.in_(ids["runs"])).count(),
        "reports": db.query(PerformanceReport).filter(PerformanceReport.run_id.in_(ids["runs"])).count(),
    }


def _check_delete_removes_performance_rows(client, session_factory) -> None:
    projects = {}
    for slug in ("performance-doomed", "performance-keeper"):
        project_id = _create_project(client, session_factory, slug)
        with session_factory() as db:
            projects[slug] = (project_id, _add_performance_rows(db, project_id, slug))
            db.commit()
    seeded = {
        "runners": 1, "events": 2, "targets": 1, "tokens": 2,
        "runs": 2, "questions": 2, "log_lines": 1002, "reports": 1,
    }
    with session_factory() as db:
        for project_id, ids in projects.values():
            assert _performance_row_counts(db, project_id, ids) == seeded

    project_id, _ = projects["performance-doomed"]
    preview = client.get(f"/v1/admin/projects/{project_id}/deletion", headers=ADMIN)
    assert preview.status_code == 200
    body = preview.json()
    # A performance run, even one in progress, does not block the delete.
    assert body["can_delete"] is True and body["blocked_reason"] is None
    assert body["counts"]["performance_runners"] == 1
    assert body["counts"]["performance_targets"] == 1
    assert body["counts"]["performance_runs"] == 2

    response = client.delete(
        f"/v1/admin/projects/{project_id}?confirm=performance-doomed", headers=ADMIN
    )
    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is True
    assert response.json()["counts"] == body["counts"]
    with session_factory() as db:
        for slug, expected in (
            ("performance-doomed", dict.fromkeys(seeded, 0)),
            ("performance-keeper", seeded),
        ):
            project_id, ids = projects[slug]
            assert db.query(Project).filter(Project.id == project_id).count() == (slug == "performance-keeper")
            assert _performance_row_counts(db, project_id, ids) == expected
        # Nothing of the deleted project is left in any performance table.
        assert db.query(PerformanceLogLine).count() == seeded["log_lines"]
        assert db.query(PerformanceTargetToken).count() == seeded["tokens"]


@pytest.mark.parametrize("foreign_keys", [True, False])
def test_delete_removes_performance_rows_only_for_the_project(
    client, session_factory, monkeypatch, foreign_keys
):
    use_encryption_key(monkeypatch)
    if not foreign_keys:
        with session_factory() as db:
            db.connection().exec_driver_sql("PRAGMA foreign_keys=OFF")
    _check_delete_removes_performance_rows(client, session_factory)


def test_delete_removes_performance_rows_on_postgresql(postgres_engine, monkeypatch):
    """The same delete where the database itself refuses a row left behind."""
    use_encryption_key(monkeypatch)
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    factory = sessionmaker(bind=postgres_engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(id="admin", email="admin@x.com", role=UserRole.ADMIN),
                User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
            ]
        )
        db.commit()
    with app_client(factory) as postgres_client:
        _check_delete_removes_performance_rows(postgres_client, factory)


def test_delete_accepts_the_slug_as_confirmation(client, session_factory):
    project_id = _create_project(client, session_factory, "by-slug")
    response = client.delete(f"/v1/admin/projects/{project_id}?confirm=by-slug", headers=ADMIN)
    assert response.status_code == 200


@pytest.mark.parametrize("trashed", [False, True])
def test_delete_is_refused_while_the_project_has_runs(client, session_factory, trashed):
    project_id = _create_project(client, session_factory, "has-runs")
    _add_run(session_factory, project_id, trashed=trashed)
    before = _row_counts(session_factory, project_id)

    preview = client.get(f"/v1/admin/projects/{project_id}/deletion", headers=ADMIN).json()
    assert preview["can_delete"] is False
    assert bool(re.search(r"\b1 deleted run\b", preview["blocked_reason"])) is trashed

    response = client.delete(f"/v1/admin/projects/{project_id}?confirm=has-runs", headers=ADMIN)
    assert response.status_code == 409
    assert response.json()["detail"] == preview["blocked_reason"]
    assert _row_counts(session_factory, project_id) == before
    with session_factory() as db:
        assert db.get(Project, project_id).is_active is True
        assert db.query(Run).filter(Run.project_id == project_id).count() == 1


def test_blocked_delete_says_when_trash_stops_blocking(client, session_factory, monkeypatch):
    """Deleting the runs is not enough: they block until Deleted runs purges them (C178 names)."""
    project_id = _create_project(client, session_factory, "trash-wait")
    _add_run(session_factory, project_id, trashed=True)
    url = f"/v1/admin/projects/{project_id}/deletion"

    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", "7")
    reason = client.get(url, headers=ADMIN).json()["blocked_reason"]
    assert "1 deleted run" in reason and "Trash" not in reason
    assert "purged 7 days after deletion" in reason

    monkeypatch.setenv("QYM_DELETED_RUN_GRACE_DAYS", "0")
    reason = client.get(url, headers=ADMIN).json()["blocked_reason"]
    assert "Retention is Off on this platform, so deleted runs are kept until restored" in reason


def test_patch_toggling_is_active_is_audited_like_archive(client, session_factory):
    """PATCH is_active cuts off or restores API keys, so it leaves the same trail."""
    project_id = _create_project(client, session_factory, "patched")
    url = f"/v1/admin/projects/{project_id}"

    archived = client.patch(url, json={"is_active": False}, headers=ADMIN)
    assert archived.status_code == 200
    assert archived.json()["is_active"] is False
    # A no-op PATCH writes nothing.
    assert client.patch(url, json={"is_active": False}, headers=ADMIN).status_code == 200
    restored = client.patch(url, json={"is_active": True}, headers=ADMIN)
    assert restored.json()["is_active"] is True
    renamed = client.patch(
        url, json={"name": "Renamed", "slug": "renamed"}, headers=ADMIN
    )
    assert (renamed.json()["name"], renamed.json()["slug"]) == ("Renamed", "renamed")

    with session_factory() as db:
        rows = (
            db.query(AuditLog)
            .filter(AuditLog.entity_type == "project", AuditLog.entity_id == project_id)
            .order_by(AuditLog.id)
            .all()
        )
        trail = [(row.action, row.before["is_active"], row.after) for row in rows]
        assert trail == [
            ("project.archived", True, {"is_active": False}),
            ("project.unarchived", False, {"is_active": True}),
            ("project.updated", True, {"name": "Renamed", "slug": "renamed"}),
        ]
        assert rows[-1].before["slug"] == "patched"
        assert all(row.actor_user_id == "admin" for row in rows)


def test_project_lifecycle_endpoints_are_admin_only(client, session_factory):
    project_id = _create_project(client, session_factory, "guarded")
    for method, url in (
        ("post", f"/v1/admin/projects/{project_id}/archive"),
        ("post", f"/v1/admin/projects/{project_id}/unarchive"),
        ("get", f"/v1/admin/projects/{project_id}/deletion"),
        ("delete", f"/v1/admin/projects/{project_id}?confirm=guarded"),
    ):
        assert getattr(client, method)(url, headers=MANAGER).status_code == 403
    assert _row_counts(session_factory, project_id)["project"] == 1
