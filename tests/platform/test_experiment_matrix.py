"""Experiment detail matrix (plan §12.2, issue #35).

Backend: the detail payload carries each combination's sweep label, the job's
secret-free ``qym_config`` (for "Save as preset"), and the linked run's metric means
with a headline metric (the environment's ``ranking_metric`` first). Frontend: static
contract checks on ``experiment_matrix.js`` (no browser or ``node`` needed).
"""

from __future__ import annotations

import re
from pathlib import Path

from qym_platform.db.models import (
    EvalEnvironment,
    EvalExperimentJob,
    EvalJobStatus,
    Run,
    RunItem,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
)

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MEMBER,
    MEMBER2,
    PRIMARY,
    _add_env,
    _created,
    _headers,
    _jobs,
    _spec,
    _url,
    client,
    encryption,
    env,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
PAGE = (DASHBOARD / "experiments.html").read_text(encoding="utf-8")
PAGE_JS = (DASHBOARD / "experiments.js").read_text(encoding="utf-8")
MATRIX = (DASHBOARD / "experiment_matrix.js").read_text(encoding="utf-8")


def _swept_spec() -> dict:
    spec = _spec()
    spec["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] = {"sweep": [0.5, 0.7]}
    return spec


def _link_run(session_factory, job_id: str, scores: dict, errors: int = 0, **run):
    """Link a completed run whose items score ``scores[metric] = [values]``."""
    with session_factory() as s:
        row = Run(
            project_id="project-1",
            created_by_user_id="member-1",
            owner_user_id="member-1",
            task="agent",
            dataset="playground_set_v2",
            model="gpt-4o",
            metrics=list(scores),
            status=RunWorkflowStatus.COMPLETED,
            **run,
        )
        s.add(row)
        s.flush()
        count = max(len(v) for v in scores.values())
        for i in range(count + errors):
            s.add(
                RunItem(
                    run_id=row.id,
                    item_id=f"i{i}",
                    index=i,
                    input={"q": i},
                    error="boom" if i >= count else None,
                )
            )
        for metric, values in scores.items():
            for i, value in enumerate(values):
                s.add(
                    RunItemScore(
                        run_id=row.id,
                        item_id=f"i{i}",
                        metric_name=metric,
                        score_numeric=value,
                    )
                )
        job = s.get(EvalExperimentJob, job_id)
        job.run_id = row.id
        job.status = EvalJobStatus.SUCCEEDED
        s.commit()
        return row.id


# --------------------------------------------------------------------------- data


def test_detail_labels_combinations_and_exposes_sweep_keys(client, session_factory, env):
    created = _created(client, [env.id], spec=_swept_spec())
    detail = client.get(
        _url(suffix=f"/{created['id']}"), headers=_headers(MEMBER2)
    ).json()
    pointer = "/env_overrides/MILVUS_SEARCH_THRESHOLD"
    assert list(detail["sweep_keys"]) == [pointer]
    labels = {j["combo_index"]: j["combo_label"] for j in detail["jobs"]}
    key = detail["sweep_keys"][pointer]
    assert labels == {0: f"{key}=0.5", 1: f"{key}=0.7"}
    # The label matches the one in the generated run name.
    for job in detail["jobs"]:
        assert job["run_name"].endswith(job["combo_label"])
        assert job["params"]["sweep"][pointer] in (0.5, 0.7)


def test_unswept_experiment_has_one_unlabelled_combination(client, env):
    created = _created(client, [env.id])
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    assert detail["sweep_keys"] == {}
    (job,) = detail["jobs"]
    assert job["combo_label"] == "" and job["run"] is None


def test_job_carries_secret_free_qym_config_for_presets(client, session_factory, env):
    spec = _swept_spec()
    created = _created(client, [env.id], spec=spec)
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    job = detail["jobs"][1]
    config = job["qym_config"]
    assert config["schema_hash"] == "h-staging"
    assert config["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7
    assert config["evaluator"]["dataset"] == "playground_set_v2"
    assert config["sweep"] == {"/env_overrides/MILVUS_SEARCH_THRESHOLD": 0.7}
    assert "qym_launch" not in str(config) and "token" not in config
    assert "$secret" not in str(config)

    # The page posts these keys as a saved preset; the preset API accepts them.
    preset = {k: config[k] for k in ("schema_hash", "evaluator", "slot_bindings", "env_overrides")}
    res = client.post(
        f"/v1/projects/project-1/eval-environments/{env.id}/presets",
        headers=_headers(MEMBER2),
        json={"kind": "saved", "name": "thr 0.7", "config": preset},
    )
    assert res.status_code == 200, res.text
    stored = res.json()["preset"]["current_version"]["config"]
    assert stored["env_overrides"]["MILVUS_SEARCH_THRESHOLD"] == 0.7


def test_temporary_binding_is_saved_without_its_key(client, session_factory, env):
    # The detail strips a temporary model's key ref, so the page posts label/model/
    # base_url only and says the key is not saved. Even a (redacted) ref sent to the
    # preset API is dropped with a warning.
    overrides = _spec()["env_overrides"]
    overrides["LLM_OVERRIDES"]["endpoints"]["primary"].pop("model")
    config = {
        "schema_hash": "h-staging",
        "evaluator": _spec()["evaluator"],
        "slot_bindings": {
            PRIMARY: {
                "temporary": {
                    "label": "trial",
                    "model": "gpt-4o-mini",
                    "base_url": "https://llm.example.com/v1",
                    "api_key": {"$secret": "redacted"},
                }
            }
        },
        "env_overrides": overrides,
    }
    res = client.post(
        f"/v1/projects/project-1/eval-environments/{env.id}/presets",
        headers=_headers(MEMBER),
        json={"kind": "saved", "name": "trial", "config": config},
    )
    assert res.status_code == 200, res.text
    assert any(w.get("rule") == "temporary_key_dropped" for w in res.json()["warnings"])
    stored = res.json()["preset"]["current_version"]["config"]
    assert "api_key" not in stored["slot_bindings"][PRIMARY]["temporary"]

    # End to end: a launch with a temporary model, saved from the detail payload.
    spec = _spec()
    spec["env_overrides"] = overrides
    spec["slot_bindings"] = {PRIMARY: config["slot_bindings"][PRIMARY]}
    spec["slot_bindings"][PRIMARY]["temporary"]["api_key"] = {"$secret": "k1"}
    created = _created(client, [env.id], spec=spec, secrets={"k1": "sk-temp-KEY-42"})
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER))
    assert "sk-temp-KEY-42" not in detail.text and "$secret" not in detail.text
    snapshot = detail.json()["jobs"][0]["qym_config"]
    assert snapshot["slot_bindings"][PRIMARY] == {
        "temporary": {
            "label": "trial",
            "model": "gpt-4o-mini",
            "base_url": "https://llm.example.com/v1",
        }
    }
    preset = {k: snapshot[k] for k in ("schema_hash", "evaluator", "slot_bindings", "env_overrides")}
    res = client.post(
        f"/v1/projects/project-1/eval-environments/{env.id}/presets",
        headers=_headers(MEMBER),
        json={"kind": "saved", "name": "trial from matrix", "config": preset},
    )
    assert res.status_code == 200, res.text
    stored = res.json()["preset"]["current_version"]["config"]
    assert stored["slot_bindings"][PRIMARY]["temporary"]["model"] == "gpt-4o-mini"


def test_run_summary_has_metric_means_and_headline(client, session_factory, env):
    created = _created(client, [env.id], spec=_swept_spec())
    first, second = sorted(
        _jobs(session_factory, created["id"]), key=lambda j: j.combo_index
    )
    # Errored items count as 0, like the runs list: (1 + 0.5) / (2 + 1) = 0.5.
    run_a = _link_run(
        session_factory, first.id, {"accuracy": [1.0, 0.5], "latency": [3.0, 5.0]}, errors=1
    )
    run_b = _link_run(session_factory, second.id, {"accuracy": [1.0, 1.0]})
    with session_factory() as s:
        s.add(
            RunMetricSpec(
                run_id=run_a, metric_name="latency", score_type="numeric", direction="minimize"
            )
        )
        s.commit()

    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    runs = {j["combo_index"]: j["run"] for j in detail["jobs"]}
    assert runs[0]["metric_means"] == {"accuracy": 0.5, "latency": 8.0 / 3}
    assert runs[0]["headline_metric"] == {
        "name": "accuracy",
        "mean": 0.5,
        "direction": "maximize",
    }
    assert runs[1]["headline_metric"]["mean"] == 1.0
    assert detail["ranking_metrics"] == {env.id: None}

    # The environment's ranking metric wins when the run has it.
    with session_factory() as s:
        s.get(EvalEnvironment, env.id).ranking_metric = "latency"
        s.commit()
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    runs = {j["combo_index"]: j["run"] for j in detail["jobs"]}
    assert runs[0]["headline_metric"]["name"] == "latency"
    assert runs[0]["headline_metric"]["direction"] == "minimize"
    # A run without the ranking metric falls back to its first metric.
    assert runs[1]["headline_metric"]["name"] == "accuracy"


def test_run_without_scores_has_no_headline(client, session_factory, env):
    created = _created(client, [env.id])
    (job,) = _jobs(session_factory, created["id"])
    with session_factory() as s:
        row = Run(
            project_id="project-1",
            created_by_user_id="member-1",
            owner_user_id="member-1",
            task="agent",
            dataset="d",
            status=RunWorkflowStatus.RUNNING,
        )
        s.add(row)
        s.flush()
        s.get(EvalExperimentJob, job.id).run_id = row.id
        s.commit()
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    (row,) = detail["jobs"]
    assert row["run"]["metric_means"] == {} and row["run"]["headline_metric"] is None


def test_matrix_spans_environments(client, session_factory, env):
    other = _add_env(session_factory, "prod")
    created = _created(client, [env.id, other.id], spec=_swept_spec())
    detail = client.get(_url(suffix=f"/{created['id']}"), headers=_headers(MEMBER)).json()
    cells = {(j["combo_index"], j["environment_name"]) for j in detail["jobs"]}
    assert cells == {(0, "staging"), (0, "prod"), (1, "staging"), (1, "prod")}
    assert len({j["combo_label"] for j in detail["jobs"]}) == 2


# --------------------------------------------------------------------------- page


def test_page_loads_the_matrix_module_before_the_page_script():
    assert '<script src="/static/experiment_matrix.js' in PAGE
    assert PAGE.index("experiment_matrix.js") < PAGE.index('src="/static/experiments.js')
    assert "window.QymExperimentMatrix" in PAGE_JS
    assert "window.QymExperimentMatrix = " in MATRIX


def test_matrix_has_rows_columns_cells_and_bulk_actions():
    for hook in (
        "data-exp-matrix",
        "data-exp-cell",
        "data-exp-compare",
        "data-exp-select",
        "data-exp-save-preset",
        "data-exp-chart",
        "data-exp-attempts",
    ):
        assert hook in MATRIX, hook
    # Cells show only the current attempt; earlier attempts stay reachable.
    assert "!job.superseded" in MATRIX
    # Compare selected opens the compare page with repeated runs= parameters.
    assert "'compare?'" in MATRIX and "'runs=' + encodeURIComponent(" in MATRIX
    # Retry all failed goes through the page (HIGH acknowledgement stays there).
    assert "data-exp-retry-all" in PAGE_JS and "async function retryAll(" in PAGE_JS
    retry_all = PAGE_JS[PAGE_JS.index("async function retryAll(") :]
    retry_all = retry_all[: retry_all.index("\n  }\n")]
    assert "PREEMPTION_ACK_REQUIRED" in retry_all
    assert retry_all.index("confirmDialog(") < retry_all.index("postJson(")


def test_save_as_preset_posts_a_saved_preset_without_sweeps_or_keys():
    save = MATRIX[MATRIX.index("function presetConfig(") :]
    save = save[: save.index("\n  }\n")]
    for key in ("schema_hash", "evaluator", "slot_bindings", "env_overrides"):
        assert f"'{key}'" in save, key
    assert "sweep" not in save and "base_source" not in save
    assert "/eval-environments/" in MATRIX and "'/presets'" in MATRIX
    assert "kind: 'saved'" in MATRIX
    # Temporary models: the key is never saved, and the dialog says so.
    assert "temporary" in MATRIX and "without its key" in MATRIX


def test_chart_uses_chart_tokens_and_escapes_nothing():
    assert "createElementNS" in MATRIX
    assert "var(--chart-" in MATRIX
    for sink in ("innerHTML", "insertAdjacentHTML", "outerHTML", "document.write"):
        assert sink not in MATRIX, sink
    assert "node.textContent = String(value)" in MATRIX
    # No hardcoded font sizes or hex colours (DESIGN_LANGUAGE §2).
    assert not re.search(r"fontSize|font-size:\s*\d", MATRIX)
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", MATRIX)
