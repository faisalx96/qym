"""A tiny stand-in Evaluation Service for dev and e2e (guide v1.2 subset).

    python frontend/scripts/fake_eval_service.py 8904
    python frontend/scripts/fake_eval_service.py 8905 --flags    # schema declares QYM_DATASET_READ_TOKEN
                                                                 # and EVAL_VLLM_POST_RUN_MAX_REQUESTS (guide v1.3)

Serves the fixture schemas under /evals/..., accepts jobs (PENDING -> RUNNING on the
next read, never finishing by itself) and exposes /__control to drive them:

    POST /__control/jobs/{id}   {"status": "SUCCEEDED", "error": null}
                                also: "deferrals", "deferral_reason", "admitted_at", "contaminated_attempts"
                                (the admission state of a latency-sensitive job, guide v1.3 section 2.2)
    GET  /__control/jobs        every job it holds
    POST /__control/reset       forget jobs, restore health
    POST /__control/health      {"down": true}   next requests answer 503
    POST /__control/schema      {"array_leaves": true}   serve three list settings in the schema (reset restores)
    POST /__control/versioning  {"agent_version": "..."}   what /evals/versioning-details/current answers (reset restores)
    POST /__control/capabilities {"datasets": true, "task": true}   the evaluator schema declares them (reset restores)
    POST /__control/tasks       {"tasks": [{"id","name","description","default"}], "status": 200|404|422|503, "delay_ms": 0}
                                what GET /evals/tasks answers (reset restores)

    python frontend/scripts/fake_eval_service.py 8906 --datasets --tasks
        change request v1.4: the evaluator schema declares `datasets` and `task`, GET /evals/tasks lists the tasks,
        a submit stores and echoes `datasets` / `task` and answers 422 "unknown task: <id>" for a task outside the list.
        Without the flags the service behaves like v1.3: it drops those keys and GET /evals/tasks answers the 422 of
        the /evals/{job_id} UUID route.
Valid API key: any non-empty bearer token.
"""

from __future__ import annotations

import asyncio
import copy
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "platform" / "fixtures"
SCHEMA = json.loads((FIXTURES / "eval_env_overrides_schema.json").read_text())
EVALUATOR = json.loads((FIXTURES / "eval_evaluator_schema.json").read_text())
EVALUATOR_V14 = json.loads((FIXTURES / "eval_evaluator_schema-v14.json").read_text())
DEFAULT_TASKS = [
    {"id": "answer-ticket", "name": "Answer a ticket", "description": "Reply to a support ticket from the knowledge base", "default": True},
    {"id": "route-ticket", "name": "Route a ticket", "description": "Pick the team that should handle the ticket", "default": False},
    {"id": "summarise-ticket", "name": "Summarise a ticket", "description": None, "default": False},
]

app = FastAPI()
JOBS: Dict[str, Dict[str, Any]] = {}
DEFAULT_VERSIONING = {"agent_version": "agent-1.4.2", "image_version": "img-20261001", "kb_version": "kb-77"}
ARRAY_LEAVES = {
    "STOP_WORDS": {"type": "array", "items": {"type": "string"}, "title": "Stop Words", "default": []},
    "ALLOWED_REGIONS": {"type": "array", "items": {"type": "integer"}, "title": "Allowed Regions", "default": []},
    "TOOL_LIMITS": {
        "type": "array",
        "title": "Tool Limits",
        "default": [],
        "items": {
            "type": "object",
            "properties": {"name": {"type": "string"}, "limit": {"type": "integer"}},
        },
    },
}
# Guide v1.3: the keys a service declares once it supports the per-experiment dataset
# read token (section 4.3) and the latency-sensitive post-run ceiling (section 2.2).
FLAG_PROPERTIES = {
    "QYM_DATASET_READ_TOKEN": {"type": "string", "title": "Qym Dataset Read Token"},
    "EVAL_VLLM_POST_RUN_MAX_REQUESTS": {
        "anyOf": [{"type": "integer", "minimum": 1}, {"type": "null"}],
        "default": None,
        "title": "Eval Vllm Post Run Max Requests",
    },
}
STATE: Dict[str, Any] = {
    "down": False,
    "versioning": dict(DEFAULT_VERSIONING),
    "array_leaves": False,
    "flags": "--flags" in sys.argv[2:],
    "datasets": "--datasets" in sys.argv[2:],
    "task": "--tasks" in sys.argv[2:],
    "tasks": copy.deepcopy(DEFAULT_TASKS),
    "tasks_status": 200,
    "tasks_delay_ms": 0,
}
# Control fields a test may set on a job.
CONTROL_FIELDS = {
    "status",
    "error",
    "result",
    "deferrals",
    "deferral_reason",
    "admitted_at",
    "contaminated_attempts",
}
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.middleware("http")
async def gate(request: Request, call_next):
    # Any prefix before /evals is accepted (EVAL_SERVER_PREFIX), so one fake can back
    # several environments that need distinct base URLs: http://host:8904/<anything>.
    path = request.scope["path"]
    if "/evals" in path and not path.startswith("/evals"):
        request.scope["path"] = path[path.index("/evals") :]
    if request.url.path.startswith("/__control"):
        return await call_next(request)
    if STATE["down"]:
        return JSONResponse({"detail": "service unavailable"}, status_code=503)
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return JSONResponse({"detail": "Invalid or missing API key"}, status_code=401)
    return await call_next(request)


@app.get("/evals/env-overrides/schema")
def env_schema() -> Any:
    schema = copy.deepcopy(SCHEMA)
    if STATE["array_leaves"]:
        schema["properties"].update(copy.deepcopy(ARRAY_LEAVES))
    if STATE["flags"]:
        schema["properties"].update(copy.deepcopy(FLAG_PROPERTIES))
    return schema


@app.get("/evals/evaluator/schema")
def evaluator_schema() -> Any:
    if not (STATE["datasets"] or STATE["task"]):
        return copy.deepcopy(EVALUATOR)
    schema = copy.deepcopy(EVALUATOR_V14)
    for key in ("datasets", "task"):
        if not STATE[key]:
            schema["properties"].pop(key, None)
    if not STATE["datasets"]:
        schema["$defs"].pop("DatasetRef", None)
    return schema


@app.get("/evals/tasks")
async def tasks() -> Any:
    """Change request v1.4. A v1.3 service routes this to /evals/{job_id}: a UUID 422."""
    if not STATE["task"]:
        return JSONResponse(
            {"detail": [{"type": "uuid_parsing", "loc": ["path", "job_id"], "msg": "Input should be a valid UUID"}]},
            status_code=422,
        )
    if STATE["tasks_delay_ms"]:
        await asyncio.sleep(STATE["tasks_delay_ms"] / 1000)
    status = STATE["tasks_status"]
    if status == 503:
        return JSONResponse({"detail": "could not list tasks: registry offline"}, status_code=503)
    if status != 200:
        return JSONResponse({"detail": "not available"}, status_code=status)
    return {"tasks": copy.deepcopy(STATE["tasks"])}


@app.get("/evals/versioning-details/current")
def versioning() -> Any:
    return dict(STATE["versioning"])


@app.get("/evals")
def list_jobs(status: Optional[str] = None, limit: int = 50, offset: int = 0) -> Any:
    items = [j for j in JOBS.values() if not status or j["status"] == status]
    return {"total": len(items), "limit": limit, "offset": offset, "items": items[offset : offset + limit]}


@app.post("/evals", status_code=202)
async def submit(request: Request) -> Any:
    body = await request.json()
    evaluator = dict(body.get("evaluator") or {})
    # A v1.3 service silently drops keys it does not know.
    for key in ("datasets", "task"):
        if not STATE[key]:
            evaluator.pop(key, None)
    if STATE["task"] and evaluator.get("task") and STATE["tasks"]:
        if evaluator["task"] not in {t["id"] for t in STATE["tasks"]}:
            return JSONResponse({"detail": f"unknown task: {evaluator['task']}"}, status_code=422)
    priority = body.get("priority") or "NORMAL"
    if priority != "HIGH":
        for j in JOBS.values():
            if j["priority"] == "HIGH" and j["status"] not in TERMINAL:
                raise HTTPException(409, f"cannot accept {priority} priority job while HIGH priority job {j['id']} is active")
    job = {
        "id": str(uuid.uuid4()),
        "status": "PENDING",
        "priority": priority,
        "user_id": body.get("user_id"),
        "cancelled_by_user_id": None,
        "created_at": _now(),
        "updated_at": None,
        "env_overrides": body.get("env_overrides") or {},
        "latency_sensitive": body.get("latency_sensitive"),
        "eval_input": evaluator,
        "result": None,
        "error": None,
    }
    JOBS[job["id"]] = job
    return job


@app.get("/evals/{job_id}")
def get_job(job_id: str) -> Any:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "eval job not found")
    if job["status"] == "PENDING":
        job["status"] = "RUNNING"
        job["updated_at"] = _now()
    return job


@app.post("/evals/{job_id}/cancel")
async def cancel(job_id: str, request: Request) -> Any:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "eval job not found")
    if job["status"] in TERMINAL:
        raise HTTPException(409, f"cannot cancel job in status {job['status']}")
    body = await request.json()
    job.update(status="CANCELLED", cancelled_by_user_id=body.get("user_id"), updated_at=_now())
    return job


@app.get("/__control/jobs")
def control_jobs() -> Any:
    return list(JOBS.values())


@app.post("/__control/jobs/{job_id}")
async def control_set(job_id: str, request: Request) -> Any:
    body = await request.json()
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    job.update({k: v for k, v in body.items() if k in CONTROL_FIELDS}, updated_at=_now())
    return job


@app.post("/__control/flags")
async def control_flags(request: Request) -> Any:
    """{"declared": true} serves the v1.3 keys in the schema (a schema refresh picks them up)."""
    STATE["flags"] = bool((await request.json()).get("declared"))
    return {"flags": STATE["flags"]}


@app.post("/__control/capabilities")
async def control_capabilities(request: Request) -> Any:
    """{"datasets": bool, "task": bool} declares the v1.4 evaluator keys (a schema refresh picks them up)."""
    body = await request.json()
    for key in ("datasets", "task"):
        if key in body:
            STATE[key] = bool(body[key])
    return {"datasets": STATE["datasets"], "task": STATE["task"]}


@app.post("/__control/tasks")
async def control_tasks(request: Request) -> Any:
    body = await request.json()
    if "tasks" in body:
        STATE["tasks"] = list(body["tasks"])
    if "status" in body:
        STATE["tasks_status"] = int(body["status"])
    if "delay_ms" in body:
        STATE["tasks_delay_ms"] = int(body["delay_ms"])
    return {"tasks": STATE["tasks"], "status": STATE["tasks_status"], "delay_ms": STATE["tasks_delay_ms"]}


@app.post("/__control/reset")
def control_reset() -> Any:
    JOBS.clear()
    STATE["datasets"] = "--datasets" in sys.argv[2:]
    STATE["task"] = "--tasks" in sys.argv[2:]
    STATE["tasks"] = copy.deepcopy(DEFAULT_TASKS)
    STATE["tasks_status"] = 200
    STATE["tasks_delay_ms"] = 0
    STATE["down"] = False
    STATE["versioning"] = dict(DEFAULT_VERSIONING)
    STATE["array_leaves"] = False
    STATE["flags"] = "--flags" in sys.argv[2:]
    return {"ok": True}


@app.post("/__control/versioning")
async def control_versioning(request: Request) -> Any:
    STATE["versioning"] = dict(await request.json())
    return STATE["versioning"]


@app.post("/__control/schema")
async def control_schema(request: Request) -> Any:
    """{"array_leaves": true} serves three list settings (STOP_WORDS, ALLOWED_REGIONS, TOOL_LIMITS) in the schema."""
    STATE["array_leaves"] = bool((await request.json()).get("array_leaves"))
    return {"array_leaves": STATE["array_leaves"]}


@app.post("/__control/health")
async def control_health(request: Request) -> Any:
    STATE["down"] = bool((await request.json()).get("down"))
    return STATE


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8904, log_level="warning")
