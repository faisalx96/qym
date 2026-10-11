# Copied verbatim from ui/overview-runs-list commit d2437fd2 (frontend/scripts/seed_runs.py); not reimplemented here.
"""Seed a project with runs through the public API (never by editing the DB).

Usage (platform running with QYM_AUTH_MODE=none):

    python frontend/scripts/seed_runs.py --base http://127.0.0.1:8801 --slug demo [--runs 42] [--running 1]

Creates the project if needed, issues an API key, pushes `--runs` runs across
three tasks, two models (one with reasoning tokens), mixed statuses
(COMPLETED, FAILED, STOPPED, SUBMITTED, APPROVED, REJECTED, RUNNING), two
repeat runs (samples=3), git branch/commit versioning and dates spread over
the last 45 days. Stdlib only so it works in any shell.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

TASKS = {
    "text2sql": ["spider-dev", "bird-mini"],
    "summarize": ["cnn-sample"],
    "rag-qa": ["hotpot-small", "nq-open-100"],
}
MODELS = ["openai/gpt-4o", "anthropic/claude-sonnet-4"]
METRICS = {
    "text2sql": ["exact_match", "execution_accuracy"],
    "summarize": ["rouge_l", "faithfulness"],
    "rag-qa": ["answer_correctness", "context_recall", "latency_s"],
}
SPECS = {
    "exact_match": {"direction": "maximize", "score_type": "boolean", "schema_version": 2},
    "execution_accuracy": {"direction": "maximize", "score_type": "percentage", "schema_version": 2},
    "rouge_l": {"direction": "maximize", "score_type": "percentage", "schema_version": 2},
    "faithfulness": {"direction": "maximize", "score_type": "percentage", "schema_version": 2},
    "answer_correctness": {"direction": "maximize", "score_type": "percentage", "schema_version": 2},
    "context_recall": {"direction": "maximize", "score_type": "percentage", "schema_version": 2},
    "latency_s": {"direction": "minimize", "score_type": "number", "schema_version": 2},
}
BRANCHES = [("main", "a1b2c3d"), ("main", "e4f5a6b"), ("feat/prompt-v2", "9c8d7e6"), ("", "")]


def call(base, path, *, method="GET", body=None, token=None, ndjson=False):
    headers = {}
    data = None
    if body is not None:
        if ndjson:
            headers["Content-Type"] = "application/x-ndjson"
            data = body.encode()
        else:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise SystemExit(f"{method} {path} -> {exc.code}: {detail}") from None


def ensure_project(base, slug, name):
    me = call(base, "/v1/me")
    for p in me["projects"]:
        if p["slug"] == slug:
            return p
    try:
        return call(base, "/v1/projects", method="POST", body={"name": name, "slug": slug})
    except SystemExit:
        return call(base, f"/v1/projects/by-slug/{slug}")


def event(run_id, seq, type_, payload, at):
    return json.dumps(
        {
            "schema_version": 1,
            "event_id": str(uuid.uuid4()),
            "sequence": seq,
            "sent_at": at.isoformat().replace("+00:00", "Z"),
            "type": type_,
            "run_id": run_id,
            "payload": payload,
        }
    )


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def build_run(index, rng, now):
    task = list(TASKS)[index % len(TASKS)]
    dataset = TASKS[task][index % len(TASKS[task])]
    model = MODELS[(index // 2) % len(MODELS)]
    reasoning = model.startswith("anthropic") and index % 4 == 0
    status_cycle = ["COMPLETED"] * 6 + ["FAILED", "COMPLETED", "SUBMITTED", "APPROVED", "REJECTED", "STOPPED"]
    status = status_cycle[index % len(status_cycle)]
    samples = 3 if index in (5, 17) else 1
    branch, commit = BRANCHES[index % len(BRANCHES)]
    days_ago = (index * 1.37) % 45
    started = now - timedelta(days=days_ago, hours=rng.random() * 6)
    items = 8 + (index % 5)
    quality = 0.45 + 0.5 * ((index * 7) % 10) / 10
    if model.startswith("anthropic"):
        quality = min(0.98, quality + 0.08)
    return {
        "task": task,
        "dataset": dataset,
        "model": model,
        "reasoning": reasoning,
        "status": status,
        "samples": samples,
        "branch": branch,
        "commit": commit,
        "started": started,
        "items": items,
        "quality": quality,
        "name": f"{task}-{model.split('/')[-1]}-{index:03d}",
    }


def push_run(base, token, spec, rng, *, running=False):
    task, dataset, model = spec["task"], spec["dataset"], spec["model"]
    metrics = METRICS[task]
    config = {"samples": spec["samples"], "run_name": spec["name"], "max_concurrency": 4}
    if spec["branch"]:
        config["git_branch"] = spec["branch"]
    if spec["commit"]:
        config["git_commit"] = spec["commit"]
    created = call(
        base,
        "/v1/runs",
        method="POST",
        token=token,
        body={
            "external_run_id": spec["name"],
            "task": task,
            "dataset": dataset,
            "model": model,
            "metrics": metrics,
            "metric_specs": {m: SPECS[m] for m in metrics},
            "run_config": config,
            "run_metadata": {"dataset_version": "v3" if dataset.endswith("dev") else ""},
        },
    )
    run_id = created["id"] if isinstance(created, dict) and "id" in created else created.get("run_id")
    started = spec["started"]
    lines = []
    seq = 1
    lines.append(
        event(
            run_id,
            seq,
            "run_started",
            {
                "external_run_id": spec["name"],
                "task": task,
                "dataset": dataset,
                "model": model,
                "metrics": metrics,
                "metric_specs": {m: SPECS[m] for m in metrics},
                "total_items": spec["items"],
                "run_config": config,
                "started_at": iso(started),
            },
            started,
        )
    )
    total = spec["items"]
    done_items = total // 2 if running else total
    t = started
    for pass_number in range(1, spec["samples"] + 1):
        pass_metrics = {m: [] for m in metrics}
        for i in range(done_items):
            if running and pass_number > 1:
                break
            item_id = f"item-{i + 1}"
            t += timedelta(seconds=rng.uniform(1, 12))
            seq += 1
            lines.append(
                event(
                    run_id,
                    seq,
                    "item_started",
                    {"item_id": item_id, "index": i, "pass_number": pass_number, "input": {"q": f"question {i + 1}"}, "expected": "42"},
                    t,
                )
            )
            fails = spec["status"] == "FAILED" and i % 3 == 0 or (i == 2 and spec["quality"] < 0.6)
            latency = rng.uniform(400, 2600) * (1.6 if spec["reasoning"] else 1)
            if fails:
                seq += 1
                lines.append(
                    event(
                        run_id,
                        seq,
                        "item_failed",
                        {"item_id": item_id, "index": i, "pass_number": pass_number, "error": "Task raised TimeoutError", "latency_ms": latency},
                        t,
                    )
                )
                continue
            for m in metrics:
                if m == "latency_s":
                    val = round(latency / 1000, 2)
                else:
                    val = 1.0 if rng.random() < spec["quality"] else (0.0 if SPECS[m]["score_type"] == "boolean" else round(rng.uniform(0.1, 0.6), 2))
                pass_metrics[m].append(val)
                seq += 1
                lines.append(
                    event(
                        run_id,
                        seq,
                        "metric_scored",
                        {"item_id": item_id, "pass_number": pass_number, "metric_name": m, "score_numeric": val, "meta": {"verdict": "correct" if val >= 0.5 else "incorrect"}},
                        t,
                    )
                )
            seq += 1
            lines.append(
                event(
                    run_id,
                    seq,
                    "item_completed",
                    {
                        "item_id": item_id,
                        "index": i,
                        "pass_number": pass_number,
                        "is_final_pass": pass_number == spec["samples"],
                        "output": f"answer {i + 1}",
                        "latency_ms": latency,
                        "retry_count": 1 if i == 4 else 0,
                        "task_metadata": {"trace_stats": {"total_tokens": 1200, "llm_calls": 2, "reasoning_tokens": 300}} if spec["reasoning"] else {},
                    },
                    t,
                )
            )
            seq += 1
            lines.append(
                event(
                    run_id,
                    seq,
                    "item_attempt_finished",
                    {"item_id": item_id, "index": i, "pass_number": pass_number, "attempt_number": 1, "status": "completed", "latency_ms": latency, "is_last_attempt": True},
                    t,
                )
            )
        if spec["samples"] > 1 and not running:
            seq += 1
            lines.append(
                event(
                    run_id,
                    seq,
                    "pass_completed",
                    {"pass_number": pass_number, "samples": spec["samples"], "metrics": {m: (sum(v) / len(v) if v else None) for m, v in pass_metrics.items()}},
                    t,
                )
            )
    if not running:
        final = "COMPLETED"
        if spec["status"] == "FAILED":
            final = "FAILED"
        elif spec["status"] == "STOPPED":
            final = "STOPPED"
        seq += 1
        lines.append(event(run_id, seq, "run_completed", {"ended_at": iso(t + timedelta(seconds=3)), "final_status": final}, t))
    call(base, f"/v1/runs/{run_id}/events", method="POST", token=token, body="\n".join(lines) + "\n", ndjson=True)
    if not running and spec["status"] in ("SUBMITTED", "APPROVED", "REJECTED"):
        call(base, f"/v1/runs/{run_id}/submit", method="POST", body={"comment": "ready for review"})
        if spec["status"] == "APPROVED":
            call(base, f"/v1/runs/{run_id}/approve", method="POST", body={"comment": "looks good"})
        elif spec["status"] == "REJECTED":
            call(base, f"/v1/runs/{run_id}/reject", method="POST", body={"comment": "regressed"})
    return run_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8801")
    parser.add_argument("--slug", default="demo")
    parser.add_argument("--name", default="Demo project")
    parser.add_argument("--runs", type=int, default=42)
    parser.add_argument("--running", type=int, default=1, help="how many RUNNING runs to leave open")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    now = datetime.now(timezone.utc)
    project = ensure_project(args.base, args.slug, args.name)
    key = call(args.base, f"/v1/projects/{project['id']}/api-keys", method="POST", body={"name": f"seed-{uuid.uuid4().hex[:6]}"})
    token = key["token"]
    ids = []
    for i in range(args.runs):
        spec = build_run(i, rng, now)
        ids.append(push_run(args.base, token, spec, rng))
    for i in range(args.running):
        spec = build_run(args.runs + i, rng, now)
        spec["started"] = now - timedelta(minutes=3)
        spec["status"] = "RUNNING"
        ids.append(push_run(args.base, token, spec, rng, running=True))
    print(json.dumps({"project": project["slug"], "runs": len(ids), "run_ids": ids}))


if __name__ == "__main__":
    sys.exit(main())
