"""Global model on the Models step: the API side of what the launch form sends.

The global model is no new field: the form binds the same model to every
``endpoint:<name>`` slot (one shared ``{"$secret": ref}`` for a temporary model),
and a global model sweep is the same ``{"sweep": [...]}`` on every endpoint, linked
into one axis. These round trips check the service accepts and dispatches that.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from qym_platform.db.models import EvalEnvironment, EvalEnvironmentSchema, EvalExperiment
from qym_platform.services.eval_bindings import prepare_dispatch
from qym_platform.services.eval_model_slots import (
    descriptor_for_schema,
    list_model_slots,
)
from qym_platform.services.eval_temporary_models import secret_lookup
from test_eval_sweeps import conn2  # noqa: F401  (fixture)
from test_experiment_launch_sweeps import TEMP_KEY, _post, ui_request, ui_spec
from test_experiments_api import (  # noqa: F401  (fixtures)
    CONN_KEY,
    PRIMARY,
    _jobs,
    client,
    conn,
    encryption,
    env,
    session_factory,
)

FAST = "endpoint:fast"
ROOT = Path(__file__).resolve().parents[2]
LAUNCH = (
    ROOT / "packages/platform/qym_platform/_static/dashboard/experiment_launch.js"
).read_text(encoding="utf-8")


def _dispatched(session_factory, job, experiment_id):
    with session_factory() as s:
        environment = s.get(EvalEnvironment, job.environment_id)
        schema = s.get(EvalEnvironmentSchema, job.schema_id)
        experiment = s.get(EvalExperiment, experiment_id)
        prep = prepare_dispatch(
            s,
            environment,
            body=job.request_body,
            slot_bindings=job.params["slot_bindings"],
            slots=list_model_slots(s, schema.id),
            descriptor=descriptor_for_schema(schema),
            secret_lookup=secret_lookup(experiment),
        )
    assert not prep.problems, prep.problems
    return prep.body["env_overrides"]["LLM_OVERRIDES"]["endpoints"]


def test_one_temporary_key_ref_serves_every_endpoint(client, session_factory, env):
    temporary = {
        "temporary": {
            "label": "trial",
            "model": "gpt-4o-mini",
            "base_url": "https://llm.example.com/v1",
            "api_key": {"$secret": "tmp-global"},
        }
    }
    spec = ui_spec({PRIMARY: temporary, FAST: temporary}, {})
    request = ui_request([env.id], spec, dry_run=True, secrets={"tmp-global": TEMP_KEY})
    preview = _post(client, request)
    assert preview.status_code == 200, preview.text
    assert preview.json()["ok"], preview.json()["errors"]

    launched = _post(client, {**request, "dry_run": False})
    assert launched.status_code == 200, launched.text
    assert TEMP_KEY not in launched.text
    (job,) = _jobs(session_factory, launched.json()["id"])
    assert TEMP_KEY not in json.dumps(job.params)
    endpoints = _dispatched(session_factory, job, launched.json()["id"])
    for name in ("primary", "fast"):
        assert endpoints[name]["model"] == "gpt-4o-mini"
        assert endpoints[name]["api_key"] == TEMP_KEY


def test_global_model_sweep_is_one_linked_axis(
    client, session_factory, env, conn, conn2  # noqa: F811
):
    sweep = {"sweep": [{"connection_id": conn.id}, {"connection_id": conn2.id}]}
    links = [["/slot_bindings/endpoint:primary", "/slot_bindings/endpoint:fast"]]
    spec = ui_spec({PRIMARY: sweep, FAST: sweep}, {}, links=links)
    preview = _post(client, ui_request([env.id], spec, dry_run=True))
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data["ok"], data["errors"]
    assert data["combo_count"] == 2  # zipped, not 2 × 2

    launched = _post(client, ui_request([env.id], spec, dry_run=False))
    assert launched.status_code == 200, launched.text
    jobs = _jobs(session_factory, launched.json()["id"])
    models = set()
    for job in jobs:
        endpoints = _dispatched(session_factory, job, launched.json()["id"])
        # Every job runs every endpoint on the same model.
        assert endpoints["primary"]["model"] == endpoints["fast"]["model"]
        models.add(endpoints["primary"]["model"])
    assert models == {"gpt-4o", "qwen-72b"}


def test_launch_form_contract():
    # Shared key refs survive unbinding one endpoint; the global value is derived
    # from the bindings (no new spec field) whenever st.bindings is replaced.
    assert "const used = refsInUse(slotKey);" in LAUNCH
    assert "bindingSecretRefs(st.globalModel)" in LAUNCH
    assert "if (st.globalBindingsRef === st.bindings) return;" in LAUNCH
    assert "st.globalModel = commonEndpointBinding();" in LAUNCH
    assert not re.search(r"spec\.global|global_model", LAUNCH)
    # Clearing never touches the endpoints' bindings.
    clear = LAUNCH.split("async function setGlobalModel(binding) {", 1)[1].split("st.globalModel = deepCopy(binding);", 1)[0]
    assert "st.bindings" not in clear
