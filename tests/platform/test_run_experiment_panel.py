"""Run page Experiment panel and "Rerun with this config" (plan §11/§12.3, issue #26)."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    EvalEnvironment,
    EvalEnvironmentSchema,
    EvalExperiment,
    EvalExperimentJob,
    EvalJobStatus,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunOrigin,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db

DASHBOARD = PLATFORM_SRC / "qym_platform" / "_static" / "dashboard"
RUN_HTML = DASHBOARD / "run.html"
PANEL_JS = DASHBOARD / "run_experiment_panel.js"
RUNS_API = PLATFORM_SRC / "qym_platform" / "api" / "runs.py"

TOKEN = "launch-token-secret-ZZZZ9999"
SECRET_REF = "tmpkey-ref-abc123"
LITERAL_KEY = "sk-live-literal-KKKK"
MEMBER = "member@example.com"
OUTSIDER = "outsider@example.com"

QYM_CONFIG = {
    "schema_hash": "hash-abc-123456789",
    "base_source": {"kind": "official", "preset_version_id": "pv-1"},
    "evaluator": {"config": {"temperature": 0.2}},
    "slot_bindings": {
        "endpoint:primary": {"connection_id": "c-1", "name": "GPT-4o prod", "model": "gpt-4o"},
        "endpoint:judge": {
            "temporary": {
                "label": "Scratch",
                "model": "m-tmp",
                "api_key": {"$secret": "redacted"},
            }
        },
    },
    "env_overrides": {"TOP_K": "5"},
    "sweep": {"/evaluator/config/temperature": 0.2},
}


def _headers(email: str) -> dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def sessions(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'panel.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(engine)
    try:
        yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    finally:
        engine.dispose()


@pytest.fixture()
def seed(sessions):
    with sessions() as db:
        member = User(id="member", email=MEMBER, role=UserRole.MEMBER)
        outsider = User(id="outsider", email=OUTSIDER, role=UserRole.MEMBER)
        db.add_all([member, outsider])
        db.flush()
        project = Project(id="p1", name="P1", slug="proj-1", created_by_user_id=member.id)
        other = Project(id="p2", name="P2", slug="proj-2", created_by_user_id=outsider.id)
        db.add_all([project, other])
        db.flush()
        db.add_all(
            [
                ProjectMembership(project_id="p1", user_id="member", role=ProjectRole.MEMBER),
                ProjectMembership(project_id="p2", user_id="outsider", role=ProjectRole.MEMBER),
            ]
        )
        env = EvalEnvironment(
            project_id="p1", name="staging-env", base_url="https://staging.example"
        )
        db.add(env)
        db.flush()
        schema = EvalEnvironmentSchema(
            environment_id=env.id, schema_hash=QYM_CONFIG["schema_hash"], schema_json={}
        )
        db.add(schema)
        db.flush()
        experiment = EvalExperiment(
            project_id="p1",
            created_by_user_id="member",
            name="temp sweep",
            environment_ids=[env.id],
            base_source={"kind": "official", "preset_version_id": "pv-1"},
            spec={
                "evaluator": {"config": {"temperature": {"sweep": [0.2, 0.7]}}},
                "slot_bindings": {},
            },
            job_count=2,
        )
        db.add(experiment)
        db.flush()
        stored_config = json.loads(json.dumps(QYM_CONFIG))
        # The stored request body keeps a real ref; responses must drop it.
        stored_config["slot_bindings"]["endpoint:judge"]["temporary"]["api_key"] = {
            "$secret": SECRET_REF
        }
        job = EvalExperimentJob(
            experiment_id=experiment.id,
            environment_id=env.id,
            combo_index=0,
            schema_id=schema.id,
            params={"sweep": {"/evaluator/config/temperature": 0.2}},
            request_body={
                "evaluator": {
                    "config": {
                        "run_metadata": {
                            "qym_launch": {"experiment_id": experiment.id},
                            "qym_config": stored_config,
                        }
                    }
                }
            },
            launch_token_hash="0" * 64,
            remote_job_id="remote-42",
            remote_status="SUCCEEDED",
            remote_result={"score": 0.9, "api_key": LITERAL_KEY},
            remote_versioning={"agent_version": "1.12", "kb_version": "381"},
            status=EvalJobStatus.SUCCEEDED,
        )
        other_job = EvalExperimentJob(
            experiment_id=experiment.id,
            environment_id=env.id,
            combo_index=1,
            schema_id=schema.id,
            params={"sweep": {"/evaluator/config/temperature": 0.7}},
            request_body={},
            status=EvalJobStatus.QUEUED,
        )
        db.add_all([job, other_job])
        db.flush()
        launch = {
            "experiment_id": experiment.id,
            "job_id": job.id,
            "environment_id": env.id,
            "combo_index": 0,
            "attempt": 0,
            # Never expected here after ingest; the API must still not echo it.
            "token": TOKEN,
        }
        official = Run(
            id="run-official",
            project_id="p1",
            created_by_user_id="member",
            owner_user_id="member",
            task="t",
            dataset="d",
            metrics=[],
            run_metadata={"qym_launch": launch, "qym_config": QYM_CONFIG},
            run_config={},
            origin=RunOrigin.OFFICIAL,
            experiment_job_id=job.id,
            status=RunWorkflowStatus.COMPLETED,
        )
        orphan = Run(
            id="run-orphan",
            project_id="p1",
            created_by_user_id="member",
            owner_user_id="member",
            task="t",
            dataset="d",
            metrics=[],
            run_metadata={
                "qym_launch": {k: v for k, v in launch.items() if k != "token"},
                "qym_config": QYM_CONFIG,
            },
            run_config={},
            origin=RunOrigin.OFFICIAL,
            experiment_job_id=None,
            status=RunWorkflowStatus.COMPLETED,
        )
        local = Run(
            id="run-local",
            project_id="p1",
            created_by_user_id="member",
            owner_user_id="member",
            task="t",
            dataset="d",
            metrics=[],
            # Copied metadata never makes a run official.
            run_metadata={"qym_launch": {"job_id": job.id}, "qym_config": QYM_CONFIG},
            run_config={},
            origin=RunOrigin.LOCAL,
            status=RunWorkflowStatus.COMPLETED,
        )
        job.run_id = official.id
        db.add_all([official, orphan, local])
        db.commit()
        return {
            "env_id": env.id,
            "experiment_id": experiment.id,
            "job_id": job.id,
            "other_job_id": other_job.id,
        }


@pytest.fixture()
def client(sessions):
    app = create_app()

    def override_get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _run(client, run_id, email=MEMBER):
    response = client.get(f"/api/runs/{run_id}?view=compact", headers=_headers(email))
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------- API


def test_official_run_has_enriched_experiment_panel(client, seed):
    data = _run(client, "run-official")
    panel = data["run"]["experiment"]
    assert panel["origin"] == "official"
    assert panel["experiment_id"] == seed["experiment_id"]
    assert panel["experiment_name"] == "temp sweep"
    assert panel["experiment_available"] is True
    assert panel["job_id"] == seed["job_id"]
    assert panel["job_available"] is True
    assert panel["job_status"] == "SUCCEEDED"
    assert panel["environment_id"] == seed["env_id"]
    assert panel["environment_name"] == "staging-env"
    assert panel["combo_index"] == 0
    assert panel["remote_job_id"] == "remote-42"
    assert panel["remote_status"] == "SUCCEEDED"
    assert panel["remote_result"]["score"] == 0.9
    assert panel["remote_versioning"] == {"agent_version": "1.12", "kb_version": "381"}
    assert panel["base_source"] == {"kind": "official", "preset_version_id": "pv-1"}
    assert panel["sweep"] == {"/evaluator/config/temperature": 0.2}
    assert panel["schema_hash"] == QYM_CONFIG["schema_hash"]
    assert panel["slot_bindings"]["endpoint:primary"]["name"] == "GPT-4o prod"


def test_panel_never_carries_tokens_or_secret_refs(client, seed):
    data = _run(client, "run-official")
    dumped = json.dumps(data)
    assert TOKEN not in dumped
    assert SECRET_REF not in dumped
    assert LITERAL_KEY not in dumped
    panel = data["run"]["experiment"]
    assert "token" not in panel
    assert "launch_token_hash" not in json.dumps(panel)
    assert "request_body" not in panel
    assert "$secret" not in json.dumps(panel)
    # The run metadata itself is returned without the launch token too.
    assert "token" not in data["run"]["metadata"]["qym_launch"]


def test_panel_works_from_run_metadata_without_job_row(client, seed):
    panel = _run(client, "run-orphan")["run"]["experiment"]
    assert panel["job_available"] is False
    assert panel["remote_job_id"] is None
    assert panel["remote_result"] is None
    # Everything below comes from qym_launch / qym_config alone.
    assert panel["job_id"] == seed["job_id"]
    assert panel["combo_index"] == 0
    assert panel["schema_hash"] == QYM_CONFIG["schema_hash"]
    assert panel["sweep"] == {"/evaluator/config/temperature": 0.2}
    assert panel["base_source"]["kind"] == "official"
    assert panel["environment_name"] == "staging-env"
    # The experiment still exists, so a whole-experiment clone stays possible.
    assert panel["experiment_available"] is True


def test_local_run_has_no_experiment_panel(client, seed):
    data = _run(client, "run-local")
    assert data["run"]["experiment"] is None


def test_non_member_cannot_read_run(client, seed):
    response = client.get("/api/runs/run-official", headers=_headers(OUTSIDER))
    assert response.json() == {"error": "Access denied"}


def test_clone_with_job_prefills_only_that_combination(client, seed):
    url = f"/v1/projects/p1/experiments/{seed['experiment_id']}/clone"
    response = client.post(url, params={"job_id": seed["job_id"]}, headers=_headers(MEMBER))
    assert response.status_code == 200, response.text
    prefill = response.json()
    assert prefill["environment_ids"] == [seed["env_id"]]
    assert prefill["base_source"] == {
        "kind": "clone",
        "experiment_id": seed["experiment_id"],
        "job_id": seed["job_id"],
    }
    # The combination's resolved document, not the sweep.
    assert prefill["spec"]["evaluator"] == {"config": {"temperature": 0.2}}
    assert "sweep" not in json.dumps(prefill["spec"])
    assert prefill["combo"]["combo_index"] == 0
    assert prefill["combo"]["sweep"] == {"/evaluator/config/temperature": 0.2}
    assert prefill["combo"]["from_snapshot"] is True
    judge = prefill["spec"]["slot_bindings"]["endpoint:judge"]["temporary"]
    assert "api_key" not in judge
    dumped = json.dumps(prefill)
    assert SECRET_REF not in dumped and "$secret" not in dumped


def test_clone_without_job_keeps_whole_experiment(client, seed):
    url = f"/v1/projects/p1/experiments/{seed['experiment_id']}/clone"
    prefill = client.post(url, headers=_headers(MEMBER)).json()
    assert prefill["spec"]["evaluator"]["config"]["temperature"] == {"sweep": [0.2, 0.7]}
    assert "combo" not in prefill


def test_clone_job_without_snapshot_falls_back_to_spec(client, seed):
    url = f"/v1/projects/p1/experiments/{seed['experiment_id']}/clone"
    prefill = client.post(
        url, params={"job_id": seed["other_job_id"]}, headers=_headers(MEMBER)
    ).json()
    assert prefill["combo"]["from_snapshot"] is False
    assert prefill["spec"]["evaluator"]["config"]["temperature"] == {"sweep": [0.2, 0.7]}


def test_clone_access_follows_project_membership(client, seed):
    url = f"/v1/projects/p1/experiments/{seed['experiment_id']}/clone"
    denied = client.post(url, params={"job_id": seed["job_id"]}, headers=_headers(OUTSIDER))
    assert denied.status_code == 403
    missing = client.post(url, params={"job_id": "nope"}, headers=_headers(MEMBER))
    assert missing.status_code == 404


# --------------------------------------------------------------------------- UI


def test_run_page_loads_and_mounts_panel():
    html = RUN_HTML.read_text(encoding="utf-8")
    head = html.split("</head>", 1)[0]
    assert '<script src="/static/run_experiment_panel.js?v=' in head
    assert '<div id="run-experiment-panel"></div>' in html
    assert "renderSummary();\n        renderExperimentPanel();" in html
    assert "window.QymRunExperimentPanel.render(container, run," in html
    assert "#run-experiment-panel:empty { display: none; }" in html
    # Official runs show qym_* in the panel, not again in the metadata context.
    assert "if (run.experiment) { hiddenMetadataKeys.add('qym_config');" in html


def test_panel_js_renders_only_official_and_escapes():
    js = PANEL_JS.read_text(encoding="utf-8")
    assert "panel.origin !== 'official'" in js
    assert "container.innerHTML = '';" in js
    assert "function esc(value)" in js
    for raw in ("panel.experiment_name +", "panel.error +", "panel.remote_job_id +"):
        assert raw not in js, raw
    # Rerun URL contract shared with the launch form (#23/#31).
    assert "'/experiments?'" in js
    assert "params.set('new', '1');" in js
    assert "params.set('clone', String(panel.experiment_id));" in js
    assert "if (panel.job_available && panel.job_id) params.set('job', String(panel.job_id));" in js
    assert "Rerun with this config" in js
    assert "Official run" in js


def test_panel_follows_design_components():
    js = PANEL_JS.read_text(encoding="utf-8")
    assert "qym-inline-action qym-inline-action--accent" in js
    assert "qym-tag qym-tag--accent" in js
    assert "qym-badge qym-badge--" in js
    assert "fontSize" not in js
    html = RUN_HTML.read_text(encoding="utf-8")
    panel_css = html.split("/* ─── Experiment panel", 1)[1].split("</style>", 1)[0]
    assert "px;\n      font-size" not in panel_css
    assert "var(--text-dim)" not in panel_css
    assert "font-size: var(--font-" in panel_css


def test_run_export_drops_panel_script():
    # The export strips every remaining /static/ script; the panel's tag must match it.
    source = RUNS_API.read_text(encoding="utf-8")
    strip_all = r'\s*<script\s+(?:defer\s+)?src="/static/[^"]+"></script>\s*'
    assert strip_all in source
    tag = re.search(r'<script[^>]*run_experiment_panel\.js[^>]*></script>', RUN_HTML.read_text(encoding="utf-8"))
    assert tag and re.fullmatch(strip_all, tag.group(0))
