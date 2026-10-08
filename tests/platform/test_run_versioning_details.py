"""Free-form ``versioning_details`` on runs and experiments (migration 0084).

- ``POST /v1/runs`` stores the creator's object; bad values answer 422.
- An official run gets its experiment's keys merged in (the experiment wins).
- Run detail, run list and the dashboard descriptor return it.
- Experiments store it, return it and carry it in the clone prefill.
- The run page renders it with a self-contained, design-compliant panel.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from qym_platform.db.models import EvalExperiment, Run
from qym_platform.services.run_versioning import (
    merge_versioning_details,
    normalize_versioning_details,
)

# Ingest + linking fixtures (users, project A, one experiment job, API keys).
from test_eval_run_linking import (  # noqa: F401  (pytest fixtures)
    ENV_INGEST_KEY,
    _auth_mode,
    _launch,
    _run,
    client,
    seed,
    sessions,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
RUN_HTML = (DASHBOARD / "run.html").read_text(encoding="utf-8")
PANEL_JS = (DASHBOARD / "run_versioning_details.js").read_text(encoding="utf-8")
PANEL_CSS = (DASHBOARD / "run_versioning_details.css").read_text(encoding="utf-8")
LAUNCH_JS = (DASHBOARD / "experiment_launch.js").read_text(encoding="utf-8")
RUNS_API = (ROOT / "packages" / "platform" / "qym_platform" / "api" / "runs.py").read_text(
    encoding="utf-8"
)


def _create(client, details=None, launch=None, key=ENV_INGEST_KEY):
    body = {"task": "t", "dataset": "d", "metrics": [], "run_metadata": {}, "run_config": {}}
    if launch is not None:
        body["run_metadata"]["qym_launch"] = launch
    if details is not None:
        body["versioning_details"] = details
    return client.post("/v1/runs", headers={"Authorization": f"Bearer {key}"}, json=body)


# ------------------------------------------------------------------ normalize


def test_normalize_trims_keys_drops_nulls_and_keeps_json_values():
    assert normalize_versioning_details(None) == {}
    assert normalize_versioning_details(
        {" agent_version ": "v2", "kb": 381, "flags": {"rerank": True}, "gone": None}
    ) == {"agent_version": "v2", "kb": 381, "flags": {"rerank": True}}


@pytest.mark.parametrize(
    "raw",
    [
        ["not", "an", "object"],
        "agent=v2",
        {"": "blank key"},
        {"k" * 101: "long key"},
        {f"k{i}": i for i in range(51)},
        {"big": "x" * 16_001},
        {"nan": float("nan")},
    ],
)
def test_normalize_refuses_invalid_objects(raw):
    with pytest.raises(ValueError):
        normalize_versioning_details(raw)


def test_merge_later_layers_win():
    assert merge_versioning_details({"a": 1, "b": 1}, None, {"b": 2}) == {"a": 1, "b": 2}


# ------------------------------------------------------------------ ingest


def test_create_run_stores_and_returns_versioning_details(client, sessions, seed):
    res = _create(client, {"agent_version": "v2", "kb": 381, "empty": None})
    assert res.status_code == 200, res.text
    run_id = res.json()["run_id"]
    assert _run(sessions, run_id).versioning_details == {"agent_version": "v2", "kb": 381}

    detail = client.get(
        f"/api/runs/{run_id}?view=summary", headers={"X-User-Email": "ingest@example.com"}
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["run"]["versioning_details"] == {"agent_version": "v2", "kb": 381}

    listed = client.get(
        "/api/runs?project_slug=proj-a", headers={"X-User-Email": "ingest@example.com"}
    )
    assert listed.status_code == 200, listed.text
    rows = [
        row
        for models in listed.json()["tasks"].values()
        for runs in models.values()
        for row in runs
    ]
    (row,) = [row for row in rows if row["run_id"] == run_id]
    assert row["versioning_details"] == {"agent_version": "v2", "kb": 381}


def test_create_run_without_details_stores_null_and_returns_empty(client, sessions, seed):
    res = _create(client)
    assert res.status_code == 200, res.text
    run_id = res.json()["run_id"]
    assert _run(sessions, run_id).versioning_details is None
    detail = client.get(
        f"/api/runs/{run_id}?view=summary", headers={"X-User-Email": "ingest@example.com"}
    )
    assert detail.json()["run"]["versioning_details"] == {}


@pytest.mark.parametrize("bad", [["a"], {"": 1}, {f"k{i}": i for i in range(51)}])
def test_create_run_refuses_invalid_details(client, sessions, seed, bad):
    res = _create(client, bad)
    assert res.status_code == 422
    assert "versioning_details" in res.text
    with sessions() as db:
        assert db.query(Run).count() == 0


def test_official_run_merges_the_experiments_keys(client, sessions, seed):
    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        experiment.versioning_details = {"agent_version": "exp-v3", "suite": "nightly"}
        db.commit()
    res = _create(
        client, {"agent_version": "client-v1", "branch": "main"}, launch=_launch(seed)
    )
    assert res.status_code == 200, res.text
    run = _run(sessions, res.json()["run_id"])
    assert run.experiment_job_id == seed["job_id"]
    assert run.versioning_details == {
        "agent_version": "exp-v3",
        "branch": "main",
        "suite": "nightly",
    }


def test_details_sent_to_the_service_let_the_run_win(client, sessions, seed):
    """B22: the job sent evaluator.config.versioning_details (guide v1.1), so the
    service merged them already and owns kb_version: the run's value wins and the
    experiment's keys only fill gaps."""
    from qym_platform.db.models import EvalExperimentJob

    with sessions() as db:
        experiment = db.get(EvalExperiment, seed["experiment_id"])
        experiment.versioning_details = {"kb_version": "exp-kb", "suite": "nightly"}
        job = db.get(EvalExperimentJob, seed["job_id"])
        body = dict(job.request_body or {})
        evaluator = dict(body.get("evaluator") or {})
        config = dict(evaluator.get("config") or {})
        config["versioning_details"] = {"kb_version": "exp-kb", "suite": "nightly"}
        evaluator["config"] = config
        body["evaluator"] = evaluator
        job.request_body = body
        db.commit()
    res = _create(
        client,
        {"kb_version": "served-kb-17", "agent_version": "a1"},
        launch=_launch(seed),
    )
    assert res.status_code == 200, res.text
    run = _run(sessions, res.json()["run_id"])
    assert run.experiment_job_id == seed["job_id"]
    assert run.versioning_details == {
        "kb_version": "served-kb-17",
        "agent_version": "a1",
        "suite": "nightly",
    }


def test_local_run_never_gets_experiment_keys(client, sessions, seed):
    with sessions() as db:
        db.get(EvalExperiment, seed["experiment_id"]).versioning_details = {"suite": "x"}
        db.commit()
    res = _create(client, {"a": "1"}, launch=_launch(seed, token="wrong-token"))
    assert res.status_code == 200, res.text
    assert _run(sessions, res.json()["run_id"]).versioning_details == {"a": "1"}


def test_dashboard_descriptor_carries_versioning_details(client, sessions, seed):
    from qym_platform.services import dashboard_summaries

    res = _create(client, {"agent_version": "v2"})
    run_id = res.json()["run_id"]
    with sessions() as db:
        dimension, _ = dashboard_summaries._sync_dimension(db, run_id, 1)
        assert dimension.descriptor["versioning_details"] == {"agent_version": "v2"}


# ------------------------------------------------------------------ UI (static)


def test_run_page_mounts_the_versioning_details_panel():
    head = RUN_HTML.split("</head>", 1)[0]
    assert '<script src="/static/run_versioning_details.js?v=' in head
    assert '<link rel="stylesheet" href="/static/run_versioning_details.css?v=' in head
    assert '<div id="run-versioning-details"></div>' in RUN_HTML
    assert "renderExperimentPanel();\n        renderVersioningDetails();" in RUN_HTML
    assert "window.QymRunVersioningDetails.render(container, state.run || {});" in RUN_HTML


def test_panel_escapes_and_follows_the_design_language():
    assert "function esc(value)" in PANEL_JS
    assert "esc(key)" in PANEL_JS and "esc(value)" in PANEL_JS
    assert "QymSafe.textDirAttrs(value)" in PANEL_JS
    assert "fontSize" not in PANEL_JS
    assert "#run-versioning-details:empty { display: none; }" in PANEL_CSS
    assert not re.search(r"font-size:\s*[\d.]+px", PANEL_CSS)
    assert "var(--text-dim)" not in PANEL_CSS
    assert "font-family: var(--font-mono)" in PANEL_CSS  # values are data
    assert "font-family: var(--font-sans)" in PANEL_CSS  # keys are labels


def test_export_inlines_the_panel():
    assert '"run_versioning_details.js",' in RUNS_API
    assert "run_versioning_details\\.css" in RUNS_API


def test_launch_form_sends_versioning_details():
    assert "versioningText: ''," in LAUNCH_JS
    assert "body.versioning_details = versioning;" in LAUNCH_JS
    assert "st.versioningText = versioningText(data.versioning_details);" in LAUNCH_JS
    assert "'data-xl-pointer': '#versioning-details'" in LAUNCH_JS
