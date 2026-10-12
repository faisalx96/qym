"""Seed a dev platform with eval environments, a preset and experiments (area 06).

    python frontend/scripts/seed_experiments.py http://127.0.0.1:8804 exp-demo \
        http://127.0.0.1:8904 http://127.0.0.1:8905

Everything goes through the public API. Needs two fake_eval_service.py instances.
"""

from __future__ import annotations

import sys
import time

import httpx

PRIMARY = "endpoint:primary"


def seed(base: str, slug: str, svc1: str, svc2: str) -> dict:
    c = httpx.Client(base_url=base, timeout=60)
    r = c.post("/v1/projects", json={"name": slug.title(), "slug": slug})
    if r.status_code == 400:
        r = c.get(f"/v1/projects/by-slug/{slug}")
    r.raise_for_status()
    pid = r.json()["id"]
    conn = c.post(
        f"/v1/projects/{pid}/llm-connections",
        json={"name": "gpt-4o prod", "llm_model": "gpt-4o", "llm_base_url": "https://api.example.com/v1", "llm_api_key": "sk-test-1234567890"},
    ).json()
    envs = {}
    for name, url in (("staging", f"{svc1}/{slug}"), ("production", f"{svc2}/{slug}")):
        e = c.post(f"/v1/projects/{pid}/eval-environments", json={"name": name, "base_url": url, "api_key": "fake-key-12345"})
        e.raise_for_status()
        env = e.json()["environment"]
        slots = c.get(f"/v1/projects/{pid}/eval-environments/{env['id']}/model-slots").json()
        put = c.put(
            f"/v1/projects/{pid}/eval-environments/{env['id']}/model-slots",
            json={
                "schema_id": slots["schema_id"],
                "slots": [
                    {k: s[k] for k in ("slot_key", "kind", "label", "field_map", "transport_fields", "extra_field_maps")}
                    for s in slots["slots"]
                ],
            },
        )
        put.raise_for_status()
        c.put(f"/v1/projects/{pid}/eval-environments/{env['id']}", json={"max_priority": "HIGH", "allow_connection_keys": True})
        envs[name] = env["id"]

    def spec(timeout: int = 60, **ev):
        return {
            "evaluator": {"dataset": "golden", "config": {"samples": 2, "report_k": 1}, **ev},
            "slot_bindings": {PRIMARY: {"connection_id": conn["id"]}},
            "env_overrides": {"LLM_OVERRIDES": {"endpoints": {"primary": {"timeout": timeout}}}},
        }

    out = {"project_id": pid, "envs": envs, "connection_id": conn["id"], "experiments": {}}
    # default preset v1 on staging
    eid = envs["staging"]
    p = c.post(
        f"/v1/projects/{pid}/eval-environments/{eid}/presets",
        json={"kind": "official", "name": "Default", "config": spec(), "notes": "Initial default"},
    )
    out["preset_status"] = p.status_code
    c.post(
        f"/v1/projects/{pid}/eval-environments/{eid}/presets",
        json={"kind": "saved", "name": "Fast timeouts", "config": spec(timeout=15), "notes": ""},
    )
    # experiments
    for key, body in {
        "single": {"name": "baseline run", "environment_ids": [eid], "spec": spec()},
        "both": {"name": "staging vs prod", "environment_ids": list(envs.values()), "spec": spec()},
        "sweep": {
            "name": "timeout sweep",
            "environment_ids": [eid],
            "spec": {**spec(), "env_overrides": {"LLM_OVERRIDES": {"endpoints": {"primary": {"timeout": {"sweep": [10, 30, 60]}}}}}},
            "description": "Timeout 10/30/60",
        },
        "high": {"name": "urgent check", "environment_ids": [eid], "spec": spec(), "priority": "HIGH", "acknowledge_preemption": True},
    }.items():
        res = c.post(f"/v1/projects/{pid}/experiments", json=body)
        out["experiments"][key] = res.json() if res.status_code == 200 else {"error": res.text, "status": res.status_code}
    time.sleep(0.5)
    return out


if __name__ == "__main__":
    import json

    a = sys.argv
    print(json.dumps(seed(a[1], a[2], a[3], a[4]), indent=1)[:3000])
