"""Promote to official (plan §9.1, §9.3, §7.5; issue #39).

- ``GET …/eval-environments/{env}/promote-prefill?kind=saved|run|job&id=…`` returns
  the official-defaults editor prefill: the source's §8.1 document re-mapped onto
  the current schema, temporary-model slots unbound and listed, dropped settings
  listed. Managers only; the source must be in the same project and environment.
- It never publishes: no promote path creates a preset or a version (counts are
  unchanged after every prefill), and the UI only ever opens the editor.
- Static checks: the saved-preset row, the run panel and the matrix cell link to
  the settings page editor (ids only in the URL), managers only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from qym_platform.db.models import (
    EvalConfigPreset,
    EvalConfigPresetKind,
    EvalConfigPresetVersion,
    EvalExperimentJob,
    Run,
    RunOrigin,
    RunWorkflowStatus,
)

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MANAGER,
    MEMBER,
    OUTSIDER,
    P1,
    P2,
    PRIMARY,
    _add_env,
    _add_preset_version,
    _created,
    _headers,
    _jobs,
    _spec,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
MODULE = (DASHBOARD / "eval_official_defaults.js").read_text(encoding="utf-8")
MATRIX = (DASHBOARD / "experiment_matrix.js").read_text(encoding="utf-8")
PANEL = (DASHBOARD / "run_experiment_panel.js").read_text(encoding="utf-8")
SETTINGS = (DASHBOARD / "project_settings.html").read_text(encoding="utf-8")
LAUNCH = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")

TEMP_KEY = "sk-temp-PROMOTE-77"


def _prefill_url(env_id: str, project_id: str = P1) -> str:
    return f"/v1/projects/{project_id}/eval-environments/{env_id}/promote-prefill"


def _prefill(client, env_id, kind, source_id, email=MANAGER, project_id=P1):
    return client.get(
        _prefill_url(env_id, project_id),
        params={"kind": kind, "id": source_id},
        headers=_headers(email),
    )


def _counts(session_factory) -> tuple[int, int]:
    with session_factory() as s:
        return s.query(EvalConfigPreset).count(), s.query(EvalConfigPresetVersion).count()


def _temporary_spec() -> dict:
    spec = _spec()
    spec["env_overrides"]["LLM_OVERRIDES"]["endpoints"]["primary"].pop("model")
    spec["slot_bindings"] = {
        PRIMARY: {
            "temporary": {
                "label": "trial",
                "model": "gpt-4o-mini",
                "base_url": "https://llm.example.com/v1",
                "api_key": {"$secret": "k1"},
            }
        }
    }
    return spec


def _add_run(session_factory, job: EvalExperimentJob, **values) -> str:
    """An official run linked to ``job``, with the job's stored ``qym_config``."""
    snapshot = job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    fields = dict(
        project_id=P1,
        created_by_user_id="member-1",
        owner_user_id="member-1",
        task="t",
        dataset="d",
        metrics=[],
        run_metadata={
            "qym_launch": {"job_id": job.id, "environment_id": job.environment_id},
            "qym_config": snapshot,
        },
        run_config={},
        origin=RunOrigin.OFFICIAL,
        experiment_job_id=job.id,
        status=RunWorkflowStatus.COMPLETED,
    )
    fields.update(values)
    with session_factory() as s:
        run = Run(**fields)
        s.add(run)
        s.commit()
        return run.id


# --------------------------------------------------------------------------- API


def test_job_prefill_is_the_cell_config_without_sweep(client, session_factory, env, conn):
    created = _created(client, [env.id], spec=_spec(conn.id))
    job = _jobs(session_factory, created["id"])[0]
    before = _counts(session_factory)
    res = _prefill(client, env.id, "job", job.id)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["environment_id"] == env.id
    assert body["source"]["kind"] == "job" and body["source"]["id"] == job.id
    config = body["config"]
    assert set(config) <= {"schema_hash", "evaluator", "slot_bindings", "env_overrides"}
    assert config["schema_hash"] == "h-staging"
    assert config["slot_bindings"][PRIMARY]["connection_id"] == conn.id
    assert config["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert body["unbound"] == [] and body["remap"]["dropped"] == []
    assert _counts(session_factory) == before


def test_temporary_slots_come_back_unbound_and_listed(client, session_factory, env):
    created = _created(
        client, [env.id], spec=_temporary_spec(), secrets={"k1": TEMP_KEY}
    )
    job = _jobs(session_factory, created["id"])[0]
    run_id = _add_run(session_factory, job)
    before = _counts(session_factory)
    for kind, source_id in (("job", job.id), ("run", run_id)):
        res = _prefill(client, env.id, kind, source_id)
        assert res.status_code == 200, res.text
        assert TEMP_KEY not in res.text and "$secret" not in res.text
        body = res.json()
        assert body["config"]["slot_bindings"][PRIMARY] is None
        assert [u["slot_key"] for u in body["unbound"]] == [PRIMARY]
        assert body["unbound"][0]["label"] == "trial"
        assert "project model" in body["unbound"][0]["reason"]
    assert _counts(session_factory) == before


def test_saved_preset_prefill_is_remapped_with_dropped_settings(
    client, session_factory, env, conn
):
    doc = _spec(conn.id)
    doc["schema_hash"] = "h-staging"
    doc["env_overrides"]["NO_LONGER_IN_SCHEMA"] = 5
    saved = _add_preset_version(
        session_factory, env, doc, kind=EvalConfigPresetKind.SAVED, name="mine"
    )
    official = _add_preset_version(session_factory, env, _spec(conn.id))
    before = _counts(session_factory)
    res = _prefill(client, env.id, "saved", saved.preset_id)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"]["version"] == 1 and body["source"]["name"] == "mine"
    assert "NO_LONGER_IN_SCHEMA" not in body["config"]["env_overrides"]
    assert [d["label"] for d in body["remap"]["dropped"]] == ["NO_LONGER_IN_SCHEMA"]
    assert "no longer supported" in body["remap"]["summary"]
    # The official preset itself is edited in the editor, not "promoted".
    res = _prefill(client, env.id, "saved", official.preset_id)
    assert res.status_code == 422
    assert _counts(session_factory) == before


def test_run_prefill_needs_a_completed_official_run(client, session_factory, env, conn):
    created = _created(client, [env.id], spec=_spec(conn.id))
    job = _jobs(session_factory, created["id"])[0]
    good = _add_run(session_factory, job)
    running = _add_run(session_factory, job, status=RunWorkflowStatus.RUNNING)
    local = _add_run(session_factory, job, origin=RunOrigin.LOCAL, experiment_job_id=None)
    assert _prefill(client, env.id, "run", good).status_code == 200
    assert _prefill(client, env.id, "run", running).status_code == 422
    assert _prefill(client, env.id, "run", local).status_code == 422
    assert _prefill(client, env.id, "run", "missing").status_code == 404


def test_managers_only_and_sources_scoped_to_project_and_environment(
    client, session_factory, env, conn
):
    created = _created(client, [env.id], spec=_spec(conn.id))
    job = _jobs(session_factory, created["id"])[0]
    other = _add_env(session_factory, "other")
    foreign = _add_env(session_factory, "theirs", project_id=P2)
    before = _counts(session_factory)

    assert _prefill(client, env.id, "job", job.id, email=MEMBER).status_code == 403
    assert _prefill(client, env.id, "job", job.id, email=OUTSIDER).status_code == 403
    # The job ran on `env`, not on `other`.
    assert _prefill(client, other.id, "job", job.id).status_code == 422
    # Another project's environment, reached through this project: not found.
    assert _prefill(client, foreign.id, "job", job.id).status_code == 404
    # The outsider manages P2, but the job belongs to P1.
    res = _prefill(client, foreign.id, "job", job.id, email=OUTSIDER, project_id=P2)
    assert res.status_code == 404
    assert _prefill(client, env.id, "bogus", job.id).status_code == 422
    assert _counts(session_factory) == before


def test_disabled_environment_refuses_prefill(client, session_factory, conn):
    disabled = _add_env(session_factory, "off", is_active=False)
    assert _prefill(client, disabled.id, "job", "x").status_code == 409


def test_prefill_route_is_read_only():
    """The route is a GET that never commits; publishing stays on the POST routes."""
    source = (
        ROOT / "packages" / "platform" / "qym_platform" / "api" / "eval_presets.py"
    ).read_text(encoding="utf-8")
    route = source[source.index("@router.get(\"/v1/projects/{project_id}/eval-environments/{env_id}/promote-prefill\")") :]
    assert "_commit(" not in route and "publish_version" not in route and "create_preset" not in route
    service = (
        ROOT / "packages" / "platform" / "qym_platform" / "services" / "eval_promote.py"
    ).read_text(encoding="utf-8")
    for forbidden in ("db.add(", "db.commit(", "db.flush(", "publish_version", "create_preset"):
        assert forbidden not in service


# --------------------------------------------------------------------------- UI


def test_editor_loads_the_promote_prefill_and_never_publishes_directly():
    assert "promote-prefill" in MODULE
    # The prefill is laid on top of the current official version as edits.
    assert re.search(r"initialConfig\s*=\s*promoted\.config", MODULE)
    # Temporary slots: the editor refuses to save until they are rebound.
    assert "rebind:" in MODULE and "opts.rebind" in LAUNCH
    # Only one publish path (the editor's onSave), never from promote code.
    assert MODULE.count("postJson(") == 3  # helper + the two publish POSTs
    # The row action is shown only when the viewer can publish (managers).
    assert "data-odx-promote" in MODULE
    assert re.search(r"const promotable = canPublish\(\) && typeof opts\.onEdit === 'function'", MODULE)
    assert re.search(r"const promote = promotable && version \? el\('button'", MODULE)


def test_settings_page_opens_the_editor_from_a_deep_link():
    assert "promote" in SETTINGS and "openOfficialDefaultsEditor" in SETTINGS
    assert re.search(r"params\.get\('promote'\)", SETTINGS)
    assert "history.replaceState" in SETTINGS


def test_run_panel_and_matrix_link_to_the_editor_for_managers_only():
    for source in (PANEL, MATRIX):
        assert "Promote to official" in source
        assert "promote=" in source and "tab=environments" in source
        assert "can_promote" in source or "canPromote" in source
    # Ids only in the URL: never the config document.
    assert "JSON.stringify" not in PANEL[PANEL.index("function promoteUrl") :][:600]
    assert "JSON.stringify" not in MATRIX[MATRIX.index("function promoteUrl") :][:600]


def test_run_panel_reports_the_promote_permission(client, session_factory, env, conn):
    created = _created(client, [env.id], spec=_spec(conn.id))
    job = _jobs(session_factory, created["id"])[0]
    run_id = _add_run(session_factory, job)
    as_manager = client.get(f"/api/runs/{run_id}", headers=_headers(MANAGER))
    assert as_manager.status_code == 200, as_manager.text
    assert as_manager.json()["run"]["experiment"]["can_promote"] is True
    as_member = client.get(f"/api/runs/{run_id}", headers=_headers(MEMBER)).json()
    assert as_member["run"]["experiment"]["can_promote"] is False


def test_experiments_page_passes_manager_permission_to_the_matrix():
    experiments = (DASHBOARD / "experiments.js").read_text(encoding="utf-8")
    assert re.search(r"canPromote:\s*canPromote\(\)", experiments)
