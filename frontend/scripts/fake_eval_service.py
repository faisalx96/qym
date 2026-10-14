"""A tiny stand-in Evaluation Service for dev and e2e (guide v1.2 subset).

    python frontend/scripts/fake_eval_service.py 8904

Serves the fixture schemas under /evals/..., accepts jobs (PENDING -> RUNNING on the
next read, never finishing by itself) and exposes /__control to drive them:

    POST /__control/jobs/{id}   {"status": "SUCCEEDED", "error": null}
    GET  /__control/jobs        every job it holds
    POST /__control/reset       forget jobs, restore health
    POST /__control/health      {"down": true}   next requests answer 503
    POST /__control/versioning  {"agent_version": "..."}   what /evals/versioning-details/current answers (reset restores)
Valid API key: any non-empty bearer token.
"""

from __future__ import annotations

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

app = FastAPI()
JOBS: Dict[str, Dict[str, Any]] = {}
DEFAULT_VERSIONING = {"agent_version": "agent-1.4.2", "image_version": "img-20261001", "kb_version": "kb-77"}
STATE: Dict[str, Any] = {"down": False, "versioning": dict(DEFAULT_VERSIONING)}
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
    return copy.deepcopy(SCHEMA)


@app.get("/evals/evaluator/schema")
def evaluator_schema() -> Any:
    return copy.deepcopy(EVALUATOR)


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
        "eval_input": body.get("evaluator") or {},
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
    job.update({k: v for k, v in body.items() if k in {"status", "error", "result"}}, updated_at=_now())
    return job


@app.post("/__control/reset")
def control_reset() -> Any:
    JOBS.clear()
    STATE["down"] = False
    STATE["versioning"] = dict(DEFAULT_VERSIONING)
    return {"ok": True}


@app.post("/__control/versioning")
async def control_versioning(request: Request) -> Any:
    STATE["versioning"] = dict(await request.json())
    return STATE["versioning"]


@app.post("/__control/health")
async def control_health(request: Request) -> Any:
    STATE["down"] = bool((await request.json()).get("down"))
    return STATE


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8904, log_level="warning")
