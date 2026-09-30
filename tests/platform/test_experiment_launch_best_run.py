"""'Start from best run' in the launch form (plan §10.3, §12.2, §10.2, §7.5; #38).

- ``GET …/eval-environments/{eid}/best-runs/{run_id}/base`` turns an official run into
  a launch-ready base: the run's ``qym_config`` (falling back to the job row), re-mapped
  onto the current schema, connections re-resolved (a deleted one becomes unbound
  with a warning), temporary models unbound with a prompt, and agent/KB drift against
  the environment's latest job.
- ``base_source: {kind: best_run, run_id}`` is validated on launch: the run is
  official, in this project, and ran on one of the selected environments.
- P5 exit: launching from a best run reproduces its config; drift warnings are shown.
- Static checks on the picker module and its hook in the launch form.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from qym_platform.db.models import (
    Dataset,
    DatasetVersion,
    DatasetVersionStatus,
    EvalExperimentJob,
    EvalJobStatus,
    EvalRunScore,
    ProjectLlmConnection,
    Run,
    RunOrigin,
    RunWorkflowStatus,
)

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MEMBER,
    OUTSIDER,
    P1,
    P2,
    PRIMARY,
    _add_env,
    _created,
    _headers,
    _jobs,
    _set_job,
    _spec,
    _url,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
LAUNCH = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "experiment_launch_best_run.js").read_text(encoding="utf-8")
STYLES = (DASHBOARD / "experiment_launch_best_run.css").read_text(encoding="utf-8")
PAGE = (DASHBOARD / "experiments.html").read_text(encoding="utf-8")

T0 = datetime(2026, 9, 30, 12, 0, 0)
RUN_VERSIONS = {"agent_version": "v1.12", "kb_version": "381"}


# --------------------------------------------------------------------------- helpers


def _envs_url(env_id: str, suffix: str = "", project_id: str = P1) -> str:
    return f"/v1/projects/{project_id}/eval-environments/{env_id}{suffix}"


def _base(client, env_id, run_id, email=MEMBER, **params):
    return client.get(
        _envs_url(env_id, f"/best-runs/{run_id}/base"),
        headers=_headers(email),
        params=params,
    )


@pytest.fixture()
def dataset(session_factory):
    """A project dataset ``golden`` with one published version ``v1``."""
    with session_factory() as s:
        ds = Dataset(
            id="ds-golden",
            project_id=P1,
            name="golden",
            slug="golden",
            created_by_user_id="admin-1",
        )
        s.add(ds)
        s.flush()
        s.add(
            DatasetVersion(
                id="dv-golden-1",
                dataset_id=ds.id,
                version="v1",
                status=DatasetVersionStatus.PUBLISHED,
                created_by_user_id="admin-1",
                created_at=T0,
                published_at=T0,
            )
        )
        s.commit()
    return "dv-golden-1"


def _golden_spec(conn_id=None):
    return _spec(conn_id, dataset="golden", dataset_version="v1")


def _official_run(
    session_factory,
    client,
    env,
    spec,
    *,
    score=0.84,
    metric="accuracy",
    versioning=RUN_VERSIONS,
    finished_at=T0,
    run_metadata=None,
    origin=RunOrigin.OFFICIAL,
    dataset_version_id="dv-golden-1",
    project_id=P1,
):
    """Launch ``spec`` on ``env``, then record the run ingest would link to its job.

    The run carries the job's ``qym_config`` in ``run_metadata`` (as the SDK does),
    unless ``run_metadata`` is given.
    """
    created = _created(client, [env.id], spec=spec)
    (job,) = _jobs(session_factory, created["id"])
    snapshot = job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    with session_factory() as s:
        run = Run(
            project_id=project_id,
            created_by_user_id="member-1",
            owner_user_id="member-1",
            task="rag",
            dataset="golden",
            dataset_id="ds-golden" if dataset_version_id else None,
            dataset_version_id=dataset_version_id,
            metrics=[metric],
            status=RunWorkflowStatus.COMPLETED,
            origin=origin,
            experiment_job_id=job.id,
            ended_at=finished_at,
            created_at=finished_at,
            run_metadata=(
                run_metadata
                if run_metadata is not None
                else {"qym_config": snapshot, "team": "rag"}
            ),
        )
        s.add(run)
        s.flush()
        if dataset_version_id:
            s.add(
                EvalRunScore(
                    run_id=run.id,
                    metric_name=metric,
                    project_id=P1,
                    environment_id=env.id,
                    dataset_id="ds-golden",
                    dataset_version_id=dataset_version_id,
                    mean_score=score,
                    direction="maximize",
                    pass_at_k={"1": 0.8},
                    item_count=50,
                    error_item_count=0,
                    completed_at=finished_at,
                )
            )
        row = s.get(EvalExperimentJob, job.id)
        row.run_id = run.id
        row.status = EvalJobStatus.SUCCEEDED
        row.finished_at = finished_at
        row.remote_versioning = dict(versioning) if versioning else None
        s.commit()
        return run.id, job


def _assert_secret_free(value) -> None:
    text = json.dumps(value)
    assert "$secret" not in text
    assert "sk-" not in text


# --------------------------------------------------------------------------- P5 exit


def test_launching_from_a_best_run_reproduces_its_config(
    client, session_factory, env, conn, dataset
):
    """P5 exit: pick the top run, load its base, launch it: same config."""
    spec = _golden_spec(conn.id)
    _official_run(session_factory, client, env, spec, score=0.61)
    best_id, best_job = _official_run(session_factory, client, env, spec, score=0.84)

    ranked = client.get(
        _envs_url(env.id, "/best-runs"),
        headers=_headers(MEMBER),
        params={"dataset_id": "golden", "dataset_version": "v1"},
    )
    assert ranked.status_code == 200, ranked.text
    top = ranked.json()["runs"][0]
    assert top["run_id"] == best_id and top["score"] == 0.84

    res = _base(client, env.id, best_id, metric="accuracy")
    assert res.status_code == 200, res.text
    base = res.json()
    assert base["config_source"] == "run"
    assert base["base_source"] == {
        "kind": "best_run",
        "run_id": best_id,
        "job_id": best_job.id,
        "experiment_id": best_job.experiment_id,
        "environment_id": env.id,
    }
    assert base["score"]["metric"] == "accuracy" and base["score"]["score"] == 0.84
    assert base["remap"]["ok"] is True and base["remap"]["dropped"] == []
    assert base["warnings"] == [] and base["prompts"] == []
    config = base["config"]
    assert config["evaluator"] == spec["evaluator"]
    assert config["env_overrides"] == spec["env_overrides"]
    assert config["slot_bindings"] == {
        PRIMARY: {"connection_id": conn.id, "name": "GPT-4o prod", "model": "gpt-4o"}
    }
    assert set(config) == {"schema_hash", "evaluator", "env_overrides", "slot_bindings"}
    assert base["versioning"] == RUN_VERSIONS
    assert base["drift"] == {"status": "same", "changes": []}
    _assert_secret_free(base)

    launched = client.post(
        _url(),
        headers=_headers(MEMBER),
        json={
            "name": "from best run",
            "environment_ids": [env.id],
            "spec": config,
            "base_source": {"kind": "best_run", "run_id": best_id},
        },
    )
    assert launched.status_code == 200, launched.text
    experiment = launched.json()
    assert experiment["base_source"] == base["base_source"]
    (job,) = _jobs(session_factory, experiment["id"])
    assert job.request_body["env_overrides"] == best_job.request_body["env_overrides"]
    assert job.request_body["evaluator"]["dataset"] == "golden"
    assert job.params["slot_bindings"] == best_job.params["slot_bindings"]
    snapshot = job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
    original = best_job.request_body["evaluator"]["config"]["run_metadata"][
        "qym_config"
    ]
    assert snapshot["base_source"] == base["base_source"]
    for key in ("evaluator", "env_overrides", "slot_bindings"):
        assert snapshot[key] == original[key], key


# --------------------------------------------------------------------------- drift


def test_drift_against_the_environments_latest_versions(
    client, session_factory, env, conn, dataset
):
    run_id, _ = _official_run(
        session_factory, client, env, _golden_spec(conn.id), finished_at=T0
    )
    # A later job reports newer agent versions (the env's latest known state).
    newer = _created(client, [env.id], spec=_golden_spec(conn.id))
    (later,) = _jobs(session_factory, newer["id"])
    _set_job(
        session_factory,
        later.id,
        status=EvalJobStatus.SUCCEEDED,
        finished_at=T0 + timedelta(days=1),
        remote_versioning={"agent_version": "v1.13", "kb_version": "381"},
    )
    base = _base(client, env.id, run_id).json()
    assert base["versioning"] == RUN_VERSIONS
    assert base["latest_versioning"]["versioning"] == {
        "agent_version": "v1.13",
        "kb_version": "381",
    }
    assert base["latest_versioning"]["job_id"] == later.id
    assert base["drift"] == {
        "status": "changed",
        "changes": [{"key": "agent_version", "run": "v1.12", "latest": "v1.13"}],
    }
    # The ranking carries the same latest versions, so the list can flag drift too.
    ranked = client.get(
        _envs_url(env.id, "/best-runs"),
        headers=_headers(MEMBER),
        params={"dataset_id": "golden"},
    ).json()
    assert ranked["latest_remote_versioning"]["versioning"]["agent_version"] == "v1.13"
    assert ranked["runs"][0]["remote_versioning"] == RUN_VERSIONS

    # Legacy flat keys in the result count as a report too.
    _set_job(
        session_factory,
        later.id,
        remote_versioning=None,
        remote_result={"agent_version": "v1.12", "kb_version": "381"},
    )
    assert _base(client, env.id, run_id).json()["drift"]["status"] == "same"


def test_drift_is_unknown_without_versioning(
    client, session_factory, env, conn, dataset
):
    run_id, _ = _official_run(
        session_factory, client, env, _golden_spec(conn.id), versioning=None
    )
    base = _base(client, env.id, run_id).json()
    assert base["versioning"] is None and base["latest_versioning"] is None
    assert base["drift"] == {"status": "unknown", "changes": []}


# --------------------------------------------------------------------------- bindings


def test_deleted_connection_becomes_an_unbound_slot_with_a_warning(
    client, session_factory, env, conn, dataset
):
    spec = _golden_spec(conn.id)
    run_id, _ = _official_run(session_factory, client, env, spec)
    with session_factory() as s:
        s.delete(s.get(ProjectLlmConnection, conn.id))
        s.commit()
    res = _base(client, env.id, run_id)
    assert res.status_code == 200, res.text
    base = res.json()
    assert base["config"]["slot_bindings"] == {PRIMARY: None}
    (warning,) = base["warnings"]
    assert warning["slot_key"] == PRIMARY
    assert warning["code"] == "connection_missing"
    assert warning["rule"] == "connection_unbound"
    assert warning["connection_id"] == conn.id
    assert warning["pointer"] == "/slot_bindings/endpoint:primary"
    assert "GPT-4o prod" in warning["message"] and "unbound" in warning["message"]
    # The rest of the configuration is kept.
    assert base["config"]["env_overrides"] == spec["env_overrides"]
    assert base["prompts"] == []


def test_hidden_connection_is_unbound_and_renamed_connection_is_refreshed(
    client, session_factory, env, conn, dataset
):
    run_id, _ = _official_run(session_factory, client, env, _golden_spec(conn.id))
    with session_factory() as s:
        row = s.get(ProjectLlmConnection, conn.id)
        row.name = "GPT-4o (renamed)"
        s.commit()
    binding = _base(client, env.id, run_id).json()["config"]["slot_bindings"][PRIMARY]
    assert binding == {
        "connection_id": conn.id,
        "name": "GPT-4o (renamed)",
        "model": "gpt-4o",
    }
    with session_factory() as s:
        s.get(ProjectLlmConnection, conn.id).available_for_experiments = False
        s.commit()
    base = _base(client, env.id, run_id).json()
    assert base["config"]["slot_bindings"][PRIMARY] is None
    assert [w["code"] for w in base["warnings"]] == ["connection_unavailable"]


def test_temporary_model_becomes_unbound_with_a_prompt(
    client, session_factory, env, conn, dataset
):
    spec = _golden_spec(conn.id)
    run_id, job = _official_run(session_factory, client, env, spec)
    snapshot = json.loads(
        json.dumps(
            job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
        )
    )
    snapshot["slot_bindings"] = {
        PRIMARY: {
            "temporary": {
                "label": "mini trial",
                "model": "gpt-4o-mini",
                "base_url": "https://llm.example.com/v1",
                "api_key": {"$secret": "redacted"},
            }
        }
    }
    with session_factory() as s:
        s.get(Run, run_id).run_metadata = {"qym_config": snapshot}
        s.commit()
    res = _base(client, env.id, run_id)
    assert res.status_code == 200, res.text
    base = res.json()
    assert base["config"]["slot_bindings"] == {PRIMARY: None}
    (prompt,) = base["prompts"]
    assert prompt["slot_key"] == PRIMARY
    assert prompt["label"] == "mini trial" and prompt["model"] == "gpt-4o-mini"
    assert prompt["base_url"] == "https://llm.example.com/v1"
    assert "enter its key again" in prompt["reason"]
    assert base["warnings"] == []
    _assert_secret_free(base)


# --------------------------------------------------------------------------- sources


def test_config_falls_back_to_the_job_row_then_the_experiment(
    client, session_factory, env, conn, dataset
):
    spec = _golden_spec(conn.id)
    run_id, job = _official_run(
        session_factory, client, env, spec, run_metadata={"team": "rag"}
    )
    base = _base(client, env.id, run_id).json()
    assert base["config_source"] == "job"
    assert base["config"]["env_overrides"] == spec["env_overrides"]
    assert base["config"]["slot_bindings"][PRIMARY]["connection_id"] == conn.id

    # A job without a stored snapshot (pre-#16): the experiment spec at its combo.
    body = json.loads(json.dumps(job.request_body))
    body["evaluator"]["config"]["run_metadata"].pop("qym_config")
    _set_job(session_factory, job.id, request_body=body)
    base = _base(client, env.id, run_id).json()
    assert base["config_source"] == "experiment"
    assert base["config"]["env_overrides"] == spec["env_overrides"]
    assert base["config"]["evaluator"]["dataset"] == "golden"
    assert base["config"]["slot_bindings"][PRIMARY]["name"] == "GPT-4o prod"


def test_stored_config_is_remapped_and_reserved_keys_are_dropped(
    client, session_factory, env, conn, dataset
):
    spec = _golden_spec(conn.id)
    run_id, job = _official_run(session_factory, client, env, spec)
    snapshot = json.loads(
        json.dumps(
            job.request_body["evaluator"]["config"]["run_metadata"]["qym_config"]
        )
    )
    snapshot["env_overrides"]["NO_LONGER_IN_SCHEMA"] = 3
    snapshot["evaluator"]["config"]["run_metadata"]["qym_launch"] = {"token": "x"}
    snapshot["sweep"] = {"/env_overrides/MILVUS_SEARCH_THRESHOLD": 0.7}
    with session_factory() as s:
        s.get(Run, run_id).run_metadata = {"qym_config": snapshot}
        s.commit()
    base = _base(client, env.id, run_id).json()
    config = base["config"]
    assert "NO_LONGER_IN_SCHEMA" not in config["env_overrides"]
    assert config["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert [d["pointer"] for d in base["remap"]["dropped"]] == [
        "/env_overrides/NO_LONGER_IN_SCHEMA"
    ]
    assert "1 setting no longer supported" in base["remap"]["summary"]
    assert config["evaluator"]["config"]["run_metadata"] == {"team": "rag"}
    assert "sweep" not in config and "base_source" not in config


# --------------------------------------------------------------------------- scoping


def test_base_rejects_local_foreign_deleted_and_other_env_runs(
    client, session_factory, env, conn, dataset
):
    spec = _golden_spec(conn.id)
    local_id, _ = _official_run(
        session_factory, client, env, spec, origin=RunOrigin.LOCAL
    )
    res = _base(client, env.id, local_id)
    assert res.status_code == 422
    assert "official run" in res.json()["detail"]

    other = _add_env(session_factory, "other")
    run_id, _ = _official_run(session_factory, client, env, spec)
    res = _base(client, other.id, run_id)
    assert res.status_code == 422
    assert "not launched on this environment" in res.json()["detail"]

    assert _base(client, env.id, "no-such-run").status_code == 404
    # Another project's member sees nothing.
    assert _base(client, env.id, run_id, email=OUTSIDER).status_code in (403, 404)
    # A run of another project is "not found" through this project's environment.
    with session_factory() as s:
        s.get(Run, local_id).project_id = P2
        s.commit()
    assert _base(client, env.id, local_id).status_code == 404

    with session_factory() as s:
        s.get(Run, run_id).deleted_at = T0
        s.commit()
    assert _base(client, env.id, run_id).status_code == 404


def test_launch_validates_best_run_base_source(
    client, session_factory, env, conn, dataset
):
    spec = _golden_spec(conn.id)
    run_id, job = _official_run(session_factory, client, env, spec)
    local_id, _ = _official_run(
        session_factory, client, env, spec, origin=RunOrigin.LOCAL
    )
    other = _add_env(session_factory, "other")

    def launch(env_ids, source):
        return client.post(
            _url(),
            headers=_headers(MEMBER),
            json={
                "name": "best",
                "environment_ids": env_ids,
                "spec": spec,
                "base_source": source,
                "dry_run": True,
            },
        )

    for source, status, fragment in [
        ({"kind": "best_run"}, 422, "base_source.run_id is required"),
        ({"kind": "best_run", "run_id": "nope"}, 422, "Run not found"),
        ({"kind": "best_run", "run_id": local_id}, 422, "official run"),
    ]:
        res = launch([env.id], source)
        assert res.status_code == status, res.text
        assert fragment in res.json()["detail"], res.json()
    res = launch([other.id], {"kind": "best_run", "run_id": run_id})
    assert res.status_code == 422
    assert "base_source.run_id: The run was not launched on" in res.json()["detail"]

    # Stored canonically; extra keys are not kept.
    res = client.post(
        _url(),
        headers=_headers(MEMBER),
        json={
            "name": "best",
            "environment_ids": [env.id, other.id],
            "spec": spec,
            "base_source": {"kind": "best_run", "run_id": run_id, "x": "y"},
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["base_source"] == {
        "kind": "best_run",
        "run_id": run_id,
        "job_id": job.id,
        "experiment_id": job.experiment_id,
        "environment_id": env.id,
    }


def test_environment_without_schema_answers_409(
    client, session_factory, env, conn, dataset
):
    run_id, _ = _official_run(session_factory, client, env, _golden_spec(conn.id))
    from qym_platform.db.models import EvalEnvironment

    with session_factory() as s:
        s.get(EvalEnvironment, env.id).current_schema_id = None
        s.commit()
    assert _base(client, env.id, run_id).status_code == 409


# --------------------------------------------------------------------------- static UI


def test_best_run_option_is_enabled_and_wired():
    base = re.search(r"const BASE_OPTIONS = \[(.*?)\];", LAUNCH, re.S).group(1)
    assert re.search(r"kind: 'best_run'[^}]*available: true", base)
    assert "'Coming soon' };" not in LAUNCH.split("function baseAvailability")[1][:400]
    # Needs an environment and a project dataset (custom strings are never ranked).
    assert "Runs on a custom dataset string are never ranked" in LAUNCH
    assert "Pick a project dataset first" in LAUNCH
    # base_source for the launch, validated server-side.
    assert "return { kind: 'best_run', run_id: info.runId };" in LAUNCH
    # The picker is created through the hook and its env follows the base env.
    assert "window.QymLaunchBestRun.create({" in LAUNCH
    assert "picker.load(envId, runId)" in LAUNCH
    assert "st.bestRunEnv === envId ? st.bestRunId : ''" in LAUNCH
    assert "kind === 'official' || kind === 'saved' || kind === 'best_run'" in LAUNCH
    # Header "Base: run … · metric score · agent … / kb …" and the drift marker.
    assert "bestRun.header(info)" in LAUNCH
    assert "'data-xl-base-drift': '1'" in LAUNCH and "bestRun.drifted(" in LAUNCH
    # Temporary models come back without a key and ask for it (§7.5).
    assert "needsKey: true" in LAUNCH.split("function reuseTemporary")[1][:900]
    assert "'static/experiment_launch_best_run.css" in LAUNCH


def test_picker_module_uses_the_best_run_apis_safely():
    assert "window.QymLaunchBestRun = { create" in MODULE
    assert "'/best-runs?'" in MODULE
    assert "'/best-runs/' + encodeURIComponent(id) + '/base'" in MODULE
    assert "q.set('exclude_errored', 'false')" in MODULE
    assert "'data-xlb-metric': '1'" in MODULE  # metric selector
    assert "const LIMIT = 5;" in MODULE  # top 5 (§10.2)
    assert "latest_version_with_runs" in MODULE
    assert "'data-xlb-drift': '1'" in MODULE and "'data-xlb-prompts': '1'" in MODULE
    assert "['run ' + shortId(base.run.id)]" in MODULE
    assert "innerHTML" not in MODULE and "insertAdjacentHTML" not in MODULE
    assert "api_key" not in MODULE and "localStorage" not in MODULE


def test_picker_assets_are_loaded_by_the_page():
    script = 'src="/static/experiment_launch_best_run.js'
    assert script in PAGE
    assert PAGE.index(script) < PAGE.index('src="/static/experiment_launch.js')
    assert 'href="/static/experiment_launch_best_run.css' in PAGE
    # Tokens only (docs/DESIGN_LANGUAGE.md); page-local classes use the xlb- prefix.
    assert not re.search(r"font-size:\s*\d", STYLES)
    assert "#" not in re.sub(r"/\*.*?\*/", "", STYLES, flags=re.S)
    assert all(
        sel.startswith(".xlb-")
        for sel in re.findall(r"^(\.[\w-]+)", STYLES, flags=re.M)
    )
