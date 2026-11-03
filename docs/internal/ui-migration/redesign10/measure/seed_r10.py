"""Round 10 seed (design stage): the round 9 seed on ports 8998 / 9098 / 9099, plus
a second LLM connection and a 2-axis sweep over both environments: a linked pair
(primary model x MILVUS_SEARCH_THRESHOLD) and a plain axis (primary timeout 10/30/60) = 2 x 3 x 2 = 12 runs.

    python docs/internal/ui-migration/redesign10/measure/seed_r10.py
"""
import json
import sys

import httpx

sys.path.insert(0, "frontend/scripts")
from seed_experiments import PRIMARY, seed  # noqa: E402

BASE = "http://127.0.0.1:8998"
SLUG = "exp-demo"
for port, tasks in (
    (9098, [{"id": "answer-ticket", "name": "Answer ticket", "description": "Reply to a support ticket", "default": True},
            {"id": "classify-intent", "name": "Classify intent", "description": "Route a message to a queue", "default": False}]),
    (9099, [{"id": "answer-ticket", "name": "Answer ticket", "description": "Reply to a support ticket", "default": True}]),
):
    httpx.post(f"http://127.0.0.1:{port}/__control/tasks", json={"tasks": tasks}).raise_for_status()
c = httpx.Client(base_url=BASE, timeout=60)
c.post("/v1/projects", json={"name": "Exp Demo", "slug": SLUG})


def items(n, p):
    return [{"item_id": f"{p}-{i}", "input": f"question {i}", "expected_output": f"answer {i}"} for i in range(n)]


for name, vers in (("support-tickets", 3), ("billing-faq", 2), ("golden", 1)):
    c.post("/v1/datasets", json={"project_slug": SLUG, "name": name, "description": "demo"}).raise_for_status()
    for v in range(1, vers + 1):
        c.post(f"/v1/datasets/{name}/versions?project_slug={SLUG}", json={"from_version": f"v{v-1}"} if v > 1 else {}).raise_for_status()
        c.post(f"/v1/datasets/{name}/versions/v{v}/items:bulk?project_slug={SLUG}", json={"upserts": items(6 + v, name[:3])}).raise_for_status()
        c.post(f"/v1/datasets/{name}/versions/v{v}:publish?project_slug={SLUG}", json={"set_alias": "production"} if v == vers else {}).raise_for_status()
out = seed(BASE, SLUG, "http://127.0.0.1:9098", "http://127.0.0.1:9099")
pid = out["project_id"]
second = c.post(
    f"/v1/projects/{pid}/llm-connections",
    json={"name": "claude-sonnet eval", "llm_model": "claude-sonnet", "llm_base_url": "https://api.example.com/v1", "llm_api_key": "sk-test-0987654321"},
).json()
sweep = {
    "evaluator": {"dataset": "golden", "config": {"samples": 2, "report_k": 1}},
    "slot_bindings": {PRIMARY: {"sweep": [{"connection_id": out["connection_id"]}, {"connection_id": second["id"]}]}},
    "env_overrides": {
        "MILVUS_SEARCH_THRESHOLD": {"sweep": [0.5, 0.7]},
        "LLM_OVERRIDES": {"endpoints": {"primary": {"timeout": {"sweep": [10, 30, 60]}}}},
    },
    "links": [[f"/slot_bindings/{PRIMARY}", "/env_overrides/MILVUS_SEARCH_THRESHOLD"]],
}
r = c.post(f"/v1/projects/{pid}/experiments", json={"name": "model x threshold x timeout", "environment_ids": list(out["envs"].values()), "spec": sweep})
out["experiments"]["two_axis"] = r.json() if r.status_code == 200 else {"error": r.text, "status": r.status_code}
print(json.dumps({"envs": out["envs"], "experiments": {k: (v.get("experiment", v) or {}).get("id", v) for k, v in out["experiments"].items()}}, indent=1)[:3000])
