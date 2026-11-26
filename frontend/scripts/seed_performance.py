"""Seed the Performance area through the published APIs, and move its clock for the e2e specs.

Usage (platform running with QYM_AUTH_MODE=none):

    python frontend/scripts/seed_performance.py --base http://127.0.0.1:8800 --slug qa-performance
    python frontend/scripts/seed_performance.py --base http://127.0.0.1:8800 --slug qa-performance --running
    python frontend/scripts/seed_performance.py --base http://127.0.0.1:8800 --slug qa-platform --platform

``seed`` (the default) uses only the stdlib and the platform's HTTP routes, as a person and a runner
would: it creates or looks up the project, mints an API key and chooses it as the runner key,
registers a runner under that key, adds the targets "QA - Preprod" and "QA - Production" with their
sign-in tokens, uploads the published dataset "QA - Load questions", and walks one Breakpoint run
(breaks at 20 users) and one Smoke run (passes) through the twelve runner routes to their end.
``--running`` leaves one more Breakpoint run holding at 20 users. The runner sends no heartbeat after
the script ends, so the Runner page reads "Not connected" 30 seconds later.

    PYTHONPATH=packages/sdk:packages/platform python frontend/scripts/seed_performance.py age \
        --database-url sqlite:////abs/path/.qym-e2e.db --project-id <id> --seconds 150

``age`` moves every stored receive time of the project's runner and of its runs that are not final
back by ``--seconds``, through the platform's own models: the same as that much time passing without a
word from the runner (the backend tests patch the clock instead). The e2e specs use it to see a runner
go silent and a run end ``interrupted`` without waiting minutes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

RUNNER_KEY = "qa-runner-1"
DATASET_NAME = "QA - Load questions"
TARGETS = (
    {
        "name": "QA - Preprod",
        "base_url": "https://preprod.qa-target.example.test",
        "is_production": False,
        "tokens": {"access_token": "qa-access-token-a1b2", "refresh_token": "qa-refresh-token-c3d4"},
    },
    {
        "name": "QA - Production",
        "base_url": "https://production.qa-target.example.test",
        "is_production": True,
        "tokens": {"refresh_token": "qa-prod-refresh-e5f6"},
    },
)
QUESTIONS = (
    ("qa_simple_rows", "simple", "How many rows does the sample table hold?", "And how many of them are new?"),
    ("qa_simple_regions", "simple", "Which regions are in the sample?", None),
    ("qa_medium_trend", "medium", "How did the sample totals change between the two years?", None),
    ("qa_medium_share", "medium", "What share of the sample is in the largest group?", None),
    ("qa_complex_compare", "complex", "Compare the monthly totals of the first quarter by group.", None),
    ("qa_complex_rank", "complex", "Rank the groups by growth and explain the top three.", None),
)
ACTIVE = ("queued", "starting", "running", "stopping")
TIERS = ("simple", "medium", "complex")
# The two levels the seeded Breakpoint run measures, as the runner reports them: level 10 passes, level 20
# breaks the time limit 40% into its hold and the run stops itself. The progress reports and the result are
# built from these same figures. ``by_tier``: answers, avg_ms, p95_ms of each kind of question.
SEEDED_LEVELS: dict[int, dict[str, Any]] = {
    10: {
        "hold_elapsed_pct": 100,
        "answers": 24,
        "errors": 0,
        "interrupted": 0,
        "follow_ups": 4,
        "p50_ms": 21000,
        "p90_ms": 41000,
        "p95_ms": 48000,
        "p99_ms": 57000,
        "avg_ms": 24500,
        "min_ms": 9100,
        "max_ms": 60000,
        "ttfb_p50_ms": 9800,
        "ttfb_p95_ms": 15000,
        "by_tier": {"simple": (12, 15800, 26000), "medium": (8, 27400, 41000), "complex": (4, 44100, 57000)},
    },
    20: {
        "hold_elapsed_pct": 40,
        "answers": 12,
        "errors": 0,
        "interrupted": 2,
        "follow_ups": 2,
        "p50_ms": 61000,
        "p90_ms": 171000,
        "p95_ms": 196000,
        "p99_ms": 214000,
        "avg_ms": 82300,
        "min_ms": 12400,
        "max_ms": 221000,
        "ttfb_p50_ms": 18400,
        "ttfb_p95_ms": 31000,
        "by_tier": {"simple": (6, 39800, 71000), "medium": (4, 88400, 142000), "complex": (2, 171500, 214000)},
    },
}
# Where the level on hold stands in a report sent while it runs.
RUNNING_HOLD_PCT = 40


class ApiError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def call(
    base: str,
    path: str,
    *,
    method: str = "GET",
    body: Any = None,
    headers: Optional[dict[str, str]] = None,
    content_type: str = "application/json",
) -> Any:
    """One request; JSON in and out unless ``body`` is bytes."""
    data = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base.rstrip("/") + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", content_type)
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise ApiError(error.code, error.read().decode("utf-8", "replace")) from None
    return json.loads(raw) if raw else None


def multipart(fields: dict[str, str], file_name: str, file_bytes: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
            "Content-Type: application/x-ndjson\r\n\r\n"
        ).encode()
        + file_bytes
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def ensure_project(base: str, slug: str, name: str) -> dict[str, Any]:
    try:
        return call(base, "/v1/projects", method="POST", body={"name": name, "slug": slug})
    except ApiError as error:
        if error.status != 400:
            raise
        return call(base, f"/v1/projects/by-slug/{slug}")


class Runner:
    """The runner side: the twelve routes of docs/performance-runner-protocol-v1.0.md."""

    def __init__(self, base: str, project_id: str, api_key: str):
        self.base = base
        self.path = f"/v1/projects/{project_id}/performance/runners/{RUNNER_KEY}"
        self.headers = {"Authorization": f"Bearer {api_key}", "X-Qym-Runner-Instance": str(uuid.uuid4())}
        self.seq: dict[str, int] = {}

    def send(self, method: str, sub: str, body: Any = None, content_type: str = "application/json") -> Any:
        return call(
            self.base,
            self.path + sub,
            method=method,
            body=body,
            headers=self.headers,
            content_type=content_type,
        )

    def register(self, *, platform: bool = False) -> dict[str, Any]:
        return self.send(
            "PUT",
            "",
            {
                "name": "QA - Runner",
                "info": {
                    "runner_version": "qa-1",
                    **({"supported_target_kinds": ["chat", "estishraf_platform"]} if platform else {}),
                    "k6_version": "1.4.2",
                    "suite_commit": "qa0000",
                    "host": "qa-runner-host",
                    "location": "QA lab",
                },
            },
        )

    def heartbeat(self, state: str = "idle", run_id: Optional[str] = None) -> None:
        self.send("POST", "/heartbeat", {"at": now(), "state": state, "run_id": run_id})

    def control(self) -> dict[str, Any]:
        return self.send("GET", "/control")

    def progress(self, run_id: str, status: str, progress: dict[str, Any], exit_code: Optional[int] = None) -> Any:
        seq = self.seq.get(run_id, 0) + 1
        self.seq[run_id] = seq
        body = {"seq": seq, "status": status, "at": now(), "progress": progress, "exit_code": exit_code}
        return self.send("POST", f"/runs/{run_id}/progress", body)

    def items(self, run_id: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        after: Optional[str] = None
        while True:
            query = "?limit=500" + (f"&after={after}" if after else "")
            page = self.send("GET", f"/runs/{run_id}/dataset-items{query}")
            items += page["items"]
            after = page["next_after"]
            if after is None:
                return items


def hold_of(plan: dict[str, Any], level: int) -> dict[str, Any]:
    """The hold stage of a level of the plan."""
    return next(s for s in plan["stages"] if s["role"] == "hold" and s["target_users"] == level)


def judge(plan: dict[str, Any], p95_ms: float, error_pct: float) -> tuple[str, Optional[str]]:
    """The suite's rule for a level (guide 4.3): ``break`` at or above a limit, else ``pass``; with the reason."""
    latency = p95_ms >= plan["limit_ms"]
    errors = error_pct >= plan["max_error_rate_pct"]
    reason = "both" if latency and errors else "latency" if latency else "errors" if errors else None
    return ("break" if reason else "pass"), reason


def progress_level(plan: dict[str, Any], level: int, done: bool) -> dict[str, Any]:
    """One entry of ``progress.levels`` (guide 4.3): a done level as it ended, the level on hold as it stands."""
    figures = SEEDED_LEVELS[level]
    pct = figures["hold_elapsed_pct"] if done else RUNNING_HOLD_PCT
    answers = min(figures["answers"], round(figures["answers"] * pct / figures["hold_elapsed_pct"]))
    error_pct = round(100 * figures["errors"] / figures["answers"], 2)
    result, reason = judge(plan, figures["p95_ms"], error_pct)
    hold = hold_of(plan, level)
    return {
        "level": level,
        "state": "done" if done else "running",
        "hold_elapsed_pct": pct,
        "answers": answers,
        "errors": figures["errors"],
        "error_pct": error_pct,
        "auth_errors": 0,
        "interrupted": figures["interrupted"] if done else 0,
        "p50_ms": figures["p50_ms"],
        "p95_ms": figures["p95_ms"],
        "max_ms": figures["max_ms"],
        "ttfb_p95_ms": figures["ttfb_p95_ms"],
        # Answers over the minutes of the hold that have passed.
        "per_minute": round(answers / ((hold["end_s"] - hold["start_s"]) * pct / 100 / 60), 1),
        "quality_mean": 98.0,
        "no_data_pct": 0.0,
        "result": result,
        "reason": reason,
    }


def progress_object(
    run: dict[str, Any], users: int, finished: int, done: list[int], *, final: bool = False
) -> dict[str, Any]:
    """A progress object (guide 4.3). ``final``: the last report, sent with the final status."""
    plan = run["config"]["plan"]
    stages = plan["stages"]
    holds = [i for i, s in enumerate(stages) if s["role"] in ("hold", "steady")]
    index = next((i for i in holds if stages[i]["target_users"] == users), holds[0] if holds else 0)
    stage = stages[index] if stages else {"role": "steady", "target_users": users, "start_s": 0, "end_s": 0}
    breakpoint = run["config"]["test_type"] == "breakpoint"
    levels = []
    if breakpoint:
        levels = [progress_level(plan, level, level in done) for level in sorted(set(done) | {users})]
        on = next(level for level in levels if level["level"] == users)
        elapsed = stage["start_s"] + (stage["end_s"] - stage["start_s"]) * on["hold_elapsed_pct"] / 100
    else:
        elapsed = plan["total_seconds"] if final else stage["start_s"] + 60
    in_flight = 0 if final else 2
    interrupted = sum(level["interrupted"] for level in levels)
    return {
        # The last report of a run is sent while it finishes: nobody is active and nothing is in flight.
        "phase": "finishing" if final else "hold" if breakpoint else "steady",
        "step": None,
        "elapsed_s": float(elapsed),
        "planned_s": plan["total_seconds"],
        "stage": None if final and not breakpoint else {"index": index + 1, "of": len(stages), **stage},
        "level": users if breakpoint else None,
        "users": 0 if final else users,
        "users_max": max((s["target_users"] for s in stages), default=users),
        "answers": {
            "sent": finished + 2,
            "finished": finished,
            "ok": finished,
            "errors": 0,
            "interrupted": interrupted,
            "in_flight": in_flight,
            "oldest_in_flight_s": 9.0 if in_flight else None,
            "follow_ups": 1,
            "warmup": 1,
        },
        "errors_by_kind": {"auth": 0, "rate_limit": 0, "server": 0, "network": 0, "run_failed": 0, "other": 0},
        "p95_ms": 52000,
        "ttfb_p95_ms": 15000,
        "quality_mean": 98.0,
        "no_data_pct": 0.0,
        "levels": levels,
        "auth": {"state": "ok", "token_versions": {}},
        "waiting_for_token": None,
        "dropped": {"questions": 0, "log_lines": 0},
    }


def summary_level(plan: dict[str, Any], level: int) -> dict[str, Any]:
    """One entry of ``summary.levels`` (guide 4.7) with every field the runner sends; a level never reached
    has no data, as the runner reports it."""
    hold = hold_of(plan, level)
    entry: dict[str, Any] = {"level": level, "hold_start_s": hold["start_s"], "hold_end_s": hold["end_s"]}
    figures = SEEDED_LEVELS.get(level)
    if figures is None:
        return {
            **entry,
            "answers": 0,
            "interrupted": 0,
            "p50_ms": None,
            "p90_ms": 0,
            "p95_ms": 0,
            "p99_ms": None,
            "avg_ms": 0,
            "min_ms": None,
            "max_ms": 0,
            "ttfb_p50_ms": None,
            "ttfb_p95_ms": None,
            "error_pct": 0,
            "no_data_pct": None,
            "auth_error_pct": None,
            "auth_contaminated": False,
            "quality_mean": 0,
            "follow_ups": 0,
            "per_minute": 0,
            "by_tier": {tier: {"answers": None, "avg_ms": None, "p95_ms": None} for tier in TIERS},
            "passed": False,
            "latency_breach": False,
            "error_breach": False,
            "has_data": False,
            "result": "no_data",
            "hold_elapsed_pct": 0,
        }
    error_pct = round(100 * figures["errors"] / figures["answers"], 2)
    result, reason = judge(plan, figures["p95_ms"], error_pct)
    names = ("p50_ms", "p90_ms", "p95_ms", "p99_ms", "avg_ms", "min_ms", "max_ms", "ttfb_p50_ms", "ttfb_p95_ms")
    return {
        **entry,
        "answers": figures["answers"],
        "interrupted": figures["interrupted"],
        **{name: figures[name] for name in names},
        "error_pct": error_pct,
        "no_data_pct": 0.0,
        "auth_error_pct": 0.0,
        "auth_contaminated": False,
        "quality_mean": 98.0,
        "follow_ups": figures["follow_ups"],
        # Answers over the whole hold in minutes, as the suite writes it.
        "per_minute": round(figures["answers"] / ((hold["end_s"] - hold["start_s"]) / 60), 1),
        "by_tier": {
            tier: {"answers": answers, "avg_ms": avg_ms, "p95_ms": p95_ms}
            for tier, (answers, avg_ms, p95_ms) in figures["by_tier"].items()
        },
        "passed": result == "pass",
        "latency_breach": reason in ("latency", "both"),
        "error_breach": reason in ("errors", "both"),
        "has_data": True,
        "result": result,
        "hold_elapsed_pct": figures["hold_elapsed_pct"],
    }


def summary_object(run: dict[str, Any], test_type: str) -> dict[str, Any]:
    target = run["config"]["target"]
    plan = run["config"]["plan"]
    breakpoint = test_type == "breakpoint"
    measured = sum(level["answers"] for level in SEEDED_LEVELS.values())
    return {
        "schema": 1,
        "test_type": test_type,
        "verdict": "breakpoint_found" if breakpoint else "pass",
        "verdict_reason": None,
        "ended_by": "auto_stop" if breakpoint else "plan",
        "exit_code": 99 if breakpoint else 0,
        "started_at": now(),
        "ended_at": now(),
        "target_url": target["base_url"] + target["chat_path"],
        "headline": {
            "safe_load_users": 10 if breakpoint else None,
            "breaking_level_users": 20 if breakpoint else None,
            "breaking_reason": "latency" if breakpoint else None,
            "recommended_max_users": 8 if breakpoint else None,
            "p95_at_safe_load_ms": SEEDED_LEVELS[10]["p95_ms"] if breakpoint else None,
            "answers_measured": measured,
            "duration_s": 750.0 if breakpoint else 180.0,
            "p95_ms": 190000 if breakpoint else 42000,
            "answers_total": measured + 2,
            "errors_total": 0,
            "error_rate_pct": 0.0,
            "ttfb_p95_ms": 15000,
            "max_users": 20 if breakpoint else 1,
            "quality_mean": 98.0,
        },
        "thresholds": [
            {
                "scope": "run",
                "metric": "llm_response_duration",
                "expression": "p(95)<180000",
                "measured": 190000 if breakpoint else 42000,
                "ok": not breakpoint,
            }
        ],
        # Breakpoint: one entry per planned level, also the levels the run never reached.
        "levels": [summary_level(plan, level) for level in plan["levels"]] if breakpoint else [],
    }


def start(base: str, slug: str, target_id: str, version_id: str, test_type: str) -> dict[str, Any]:
    api = f"/api/projects/{slug}/performance"
    defaults = call(base, f"{api}/setup")["defaults"][test_type]
    body = {
        "target_id": target_id,
        "test_type": test_type,
        "dataset_version_id": version_id,
        "plan": defaults["plan"],
        "mix": defaults["mix"],
        "note": "Seeded run",
    }
    return call(base, f"{api}/runs", method="POST", body=body)


def walk(runner: Runner, run_id: str, *, finish: bool) -> None:
    """Claim the queued run and report it as the suite would; ``finish`` sends the result."""
    control = runner.control()
    run = control["run"]
    if not run or run["id"] != run_id:
        raise RuntimeError(f"the control document does not show run {run_id}: {control['state']}")
    runner.send("POST", f"/runs/{run_id}/claim", {})
    runner.heartbeat("preflight", run_id)
    items = runner.items(run_id)
    test_type = run["config"]["test_type"]
    breakpoint = test_type == "breakpoint"
    runner.progress(run_id, "running", progress_object(run, 10 if breakpoint else 1, 12, []))
    runner.heartbeat("running", run_id)
    records = []
    for seq, item in enumerate(items, start=1):
        records.append(
            {
                "seq": seq,
                "asked_at": now(),
                "elapsed_s": 60.0 + seq,
                "stage": "hold" if breakpoint else "steady",
                "level": (10 if seq <= 3 else 20) if breakpoint else None,
                "user": seq,
                "tier": item["metadata"].get("tier", "medium"),
                "question_id": item["item_id"],
                "question": item["input"] if isinstance(item["input"], str) else item["input"]["question"],
                "status": "ok",
                "http_status": 200,
                "duration_ms": 30000 + 1000 * seq,
                "ttfb_ms": 11000,
                "quality": 100,
                "answer": f"QA answer {seq}",
            }
        )
    runner.send("POST", f"/runs/{run_id}/questions", {"records": records})
    lines = [
        {"seq": 1, "at": now(), "level": "info", "message": "runner: seeded run started"},
        {"seq": 2, "at": now(), "level": "info", "message": "stage hold  level=10  users=10"},
    ]
    runner.send("POST", f"/runs/{run_id}/log", {"lines": lines})
    event = {"at": now(), "level": "info", "code": "run_started", "message": "Seeded run started", "run_id": run_id}
    runner.send("POST", "/events", {"events": [event]})
    if breakpoint:
        runner.progress(run_id, "running", progress_object(run, 20, 36, [10]))
    if not finish:
        return
    runner.send("PUT", f"/runs/{run_id}/summary", summary_object(run, test_type))
    report = b"<!doctype html><meta charset=utf-8><title>QA report</title><p>Seeded report.</p>"
    runner.send("PUT", f"/runs/{run_id}/report", report, content_type="text/html; charset=utf-8")
    final = progress_object(run, 20 if breakpoint else 1, 36, [10, 20] if breakpoint else [], final=True)
    runner.progress(run_id, "finished", final, exit_code=99 if breakpoint else 0)
    runner.heartbeat("idle")


def seed(args: argparse.Namespace) -> None:
    base, slug = args.base, args.slug
    api = f"/api/projects/{slug}/performance"
    project = ensure_project(base, slug, args.name)
    slug = project["slug"]
    key = call(base, f"/v1/projects/{project['id']}/api-keys", method="POST", body={"name": "QA - Runner key"})
    call(base, f"{api}/runner/key", method="PUT", body={"api_key_id": key["id"]})
    runner = Runner(base, project["id"], key["token"])
    runner.register()
    runner.heartbeat()

    existing = {t["name"]: t for t in call(base, f"{api}/targets")["targets"] if not t.get("archived_at")}
    target_ids: dict[str, str] = {}
    for spec in TARGETS:
        target = existing.get(spec["name"])
        if target is None:
            body = {k: spec[k] for k in ("name", "base_url", "is_production")}
            target = call(base, f"{api}/targets", method="POST", body=body)
        target_ids[spec["name"]] = target["id"]
        for name, token in spec["tokens"].items():
            call(base, f"{api}/targets/{target['id']}/tokens/{name}", method="PUT", body={"token": token})

    listed = call(base, f"{api}/datasets")["datasets"]
    found = next((d for d in listed if d["name"] == DATASET_NAME and d["latest_published_version"]), None)
    if found:
        version_id = found["latest_published_version"]["id"]
    else:
        lines = [
            json.dumps(
                {
                    "item_id": item_id,
                    "input": text,
                    "expected_output": None,
                    "metadata": {"tier": tier, **({"follow_up": follow_up} if follow_up else {})},
                    "labels": [tier],
                }
            )
            for item_id, tier, text, follow_up in QUESTIONS
        ]
        fields = {
            "project_slug": slug,
            "name": DATASET_NAME,
            "create_only": "true",
            "publish": "true",
            "format": "jsonl",
        }
        body, content_type = multipart(fields, "questions.jsonl", "\n".join(lines).encode())
        uploaded = call(base, "/v1/datasets:upload", method="POST", body=body, content_type=content_type)
        version_id = uploaded["version"]["id"]

    preprod = target_ids["QA - Preprod"]
    for test_type in ("breakpoint", "smoke"):
        run = start(base, slug, preprod, version_id, test_type)
        walk(runner, run["id"], finish=True)
        print(f"run {run['number']}: {test_type}, finished")
    if args.running:
        run = start(base, slug, preprod, version_id, "breakpoint")
        walk(runner, run["id"], finish=False)
        print(f"run {run['number']}: breakpoint, running at 20 users")
    print(f"seeded: {base.rstrip('/')}/projects/{slug}/performance")


# Fictional, sanitized protocol examples. No address or credential here is a deployment default.
def platform_seed_payload(test_type: str) -> dict[str, Any]:
    """Build the same fictional 12-dashboard story used by browser acceptance tests."""
    fixture = Path(__file__).resolve().parents[1] / "e2e/performance/fixtures/platform-story.json"
    story = json.loads(fixture.read_text())
    smoke = test_type == "smoke"
    read = story["reads"]["smoke" if smoke else "finished"]
    summary, discovery = read["summary"], read["discovery"]
    discovery["dashboards"] = story["discoveryRows"]
    summary["dashboards"] = story["dashboards"]
    if smoke:
        summary["levels"][0].update(end_s=108, actual_duration_s=108, hold_elapsed_pct=100,
                                     per_minute=12 * 60 / 108, open_p50_ms=4800,
                                     open_p95_ms=4800, open_p99_ms=4800, open_max_ms=4800,
                                     filter_p50_ms=1800, filter_p95_ms=1800, filter_max_ms=1800)
    zero = {name: 0 for name in summary["overall"]["errors_by_class"]}
    records: list[dict[str, Any]] = []
    dashboard_queue = [row for row in summary["dashboards"] for _ in range(1 if smoke else row["opens"])]
    inventory = {row["id"]: row for row in discovery["dashboards"]}
    cursor = 0
    for level in summary["levels"]:
        if not level["has_data"]:
            continue
        level_records = []
        for index in range(level["dashboards_opened"]):
            dashboard = dashboard_queue[cursor]
            cursor += 1
            detail = inventory[dashboard["dashboard_id"]]
            elapsed = level["start_s"] + (index + 1) * level["actual_duration_s"] / (level["dashboards_opened"] + 1)
            row = {
                "seq": 0, "at": now(), "elapsed_s": elapsed,
                "stage": "steady" if smoke else "hold", "level": level["level"], "user_number": 1,
                "type": "open", "dashboard_id": detail["id"], "title": detail["title"],
                "insight_id": None, "control": None, "step": None, "http_status": None,
                "error_class": None, "duration_ms": level["open_p95_ms"],
                "charts": detail["charts_usable"], "charts_ok": detail["charts_usable"], "errors": dict(zero),
            }
            level_records.append(row)
            for control in range(detail["filters_found"] if smoke else 2):
                level_records.append({**row, "type": "filter", "control": f"fictional-control-{control}",
                                      "duration_ms": level["filter_p95_ms"], "charts": 1, "charts_ok": None})
        level["charts_drawn"] = sum(row["charts_ok"] for row in level_records if row["type"] == "open")
        level["filters_applied"] = sum(row["type"] == "filter" for row in level_records)
        failures = level["failed_request_outcomes"]
        level["errors_by_class"] = {**zero, "callback_error": failures}
        for _ in range(failures):
            level_records.append({**level_records[0], "type": "error", "control": None,
                                  "step": "callback", "http_status": 500, "error_class": "callback_error",
                                  "duration_ms": None, "charts": None, "charts_ok": None})
        records.extend(level_records)
    records.sort(key=lambda row: row["elapsed_s"])
    for seq, row in enumerate(records, 1):
        row["seq"] = seq
    def percentile(rows: list[dict[str, Any]], kind: str, fraction: float) -> Optional[float]:
        values = sorted(row["duration_ms"] for row in rows if row["type"] == kind)
        if not values:
            return None
        rank = (len(values) - 1) * fraction
        index = int(rank)
        return values[index] + (rank - index) * (values[min(index + 1, len(values) - 1)] - values[index])
    for dashboard in summary["dashboards"]:
        rows = [row for row in records if row["dashboard_id"] == dashboard["dashboard_id"]]
        dashboard.update(opens=sum(row["type"] == "open" for row in rows),
                         filters=sum(row["type"] == "filter" for row in rows),
                         charts_drawn=sum(row["charts_ok"] for row in rows if row["type"] == "open"),
                         open_p50_ms=percentile(rows, "open", .5), open_p95_ms=percentile(rows, "open", .95),
                         filter_p95_ms=percentile(rows, "filter", .95),
                         errors_by_class={**zero, "callback_error": sum(row["type"] == "error" for row in rows)})
    outcomes = sum(level["request_outcomes"] for level in summary["levels"])
    failures = sum(level["failed_request_outcomes"] for level in summary["levels"])
    rate = 100 * failures / outcomes if outcomes else None
    summary["overall"].update(request_outcomes=outcomes, failed_request_outcomes=failures,
                              error_rate_pct=rate, errors_by_class={**zero, "callback_error": failures})
    summary["headline"].update(error_rate_pct=rate, open_p95_ms=percentile(records, "open", .95),
                               filter_p95_ms=percentile(records, "filter", .95),
                               charts_drawn=sum(row["charts_drawn"] for row in summary["dashboards"]),
                               filters_total=sum(row["filters"] for row in summary["dashboards"]))
    summary["counts"]["records_received"] = len(records)
    summary["measurements"]["records_retained"] = len(records)
    for threshold in summary["thresholds"]:
        if threshold["scope"] == "run":
            threshold["measured"] = rate / 100 if threshold["metric"] == "journey_errors" else summary["headline"]["open_p95_ms"]
            threshold["ok"] = threshold["measured"] < (.05 if threshold["metric"] == "journey_errors" else 10000)
    return {"discovery": discovery, "summary": summary, "records": records,
            "preflight": story["reads"]["discovery"]["progress"], "live": story["reads"]["running"]["progress"]}


def walk_platform(runner: Runner, run_id: str, *, finish: bool) -> None:
    """Send a fictional runner lifecycle; never contact the target origin."""
    run = runner.control()["run"]
    if not run or run["id"] != run_id:
        raise RuntimeError(f"the control document does not show platform run {run_id}")
    config = run["config"]
    payload = platform_seed_payload(config["test_type"])
    discovery, summary = payload["discovery"], payload["summary"]
    smoke = config["test_type"] == "smoke"
    runner.send("POST", f"/runs/{run_id}/claim", {})
    runner.heartbeat("preflight", run_id)
    stamp = now()
    discovery.update(started_at=stamp, ended_at=stamp)
    preflight = payload["preflight"]
    preflight["users_max"] = 1 if smoke else config["plan"]["max_users"]
    preflight["auth"]["token_versions"] = {"session_cookie": config["tokens"][0]["version"]}
    runner.progress(run_id, "starting", preflight)
    runner.send("PUT", f"/runs/{run_id}/discovery", discovery)
    progress = payload["live"]
    progress["auth"] = preflight["auth"]
    if smoke or finish:
        headline = summary["headline"]
        progress.update(phase="steady" if smoke else "hold", stage=None if smoke else progress["stage"],
                        level=1 if smoke else 8, users=1 if smoke else 8, users_max=1 if smoke else 10,
                        elapsed_s=headline["duration_s"], planned_s=discovery["resolved_plan"]["total_seconds"],
                        dashboard_opens=headline["opens_total"], filter_changes=headline["filters_total"],
                        charts_drawn=headline["charts_drawn"], open_p95_ms=headline["open_p95_ms"],
                        filter_p95_ms=headline["filter_p95_ms"], errors_by_class=summary["overall"]["errors_by_class"],
                        levels=[])
        if not smoke:
            stage = next(stage for stage in summary["plan"]["stages"] if stage["role"] == "hold" and stage["target_users"] == 8)
            progress["stage"] = {"index": 17, "of": len(summary["plan"]["stages"]), **stage}
    records = [row for row in payload["records"] if finish or row["elapsed_s"] <= progress["elapsed_s"]]
    clock = datetime.now(timezone.utc) - timedelta(seconds=progress["elapsed_s"])
    for row in records:
        row["at"] = (clock + timedelta(seconds=row["elapsed_s"])).isoformat().replace("+00:00", "Z")
    progress["records"] = {"received": len(records), "dropped": 0, "malformed": 0, "uploaded": 0}
    runner.progress(run_id, "running", progress)
    runner.heartbeat("running", run_id)
    for offset in range(0, len(records), 200):
        runner.send("POST", f"/runs/{run_id}/steps", {"records": records[offset:offset + 200]})
    progress["records"]["uploaded"] = len(records)
    runner.send("POST", f"/runs/{run_id}/log", {"lines": [
        {"seq": 1, "at": stamp, "level": "info", "message": "Fictional seed: 12 dashboards, 87 charts, 84 usable, 3 unavailable, 31 filters."},
    ]})
    if not finish:
        runner.progress(run_id, "running", progress)
        return
    summary.update(started_at=clock.isoformat().replace("+00:00", "Z"), ended_at=now(),
                   target_url=config["target"]["base_url"],
                   identity={"run_id": run_id, "run_number": run["number"], "project_name": run["project_name"], "target_name": config["target"]["name"]})
    runner.send("PUT", f"/runs/{run_id}/summary", summary)
    report = ("<!doctype html><meta charset=utf-8><title>Fictional platform report</title>"
              "<h1>12 dashboards · 87 charts · 84 usable · 3 unavailable · 31 filters</h1>"
              "<p>Coverage incomplete: three charts unavailable.</p><p>" + summary["verdict_reason"] + "</p>").encode()
    runner.send("PUT", f"/runs/{run_id}/report", report, content_type="text/html; charset=utf-8")
    progress.update(phase="finishing", message="Fictional platform test finished", stage=None, users=0)
    runner.progress(run_id, "finished", progress, exit_code=summary["exit_code"])
    runner.heartbeat("idle")


def seed_platform(args: argparse.Namespace) -> None:
    """Opt-in platform seed; default chat seeding and its credentials stay unchanged."""
    project = ensure_project(args.base, args.slug, args.name)
    api = f"/api/projects/{project['slug']}/performance"
    key = call(args.base, f"/v1/projects/{project['id']}/api-keys", method="POST", body={"name": "QA - Platform runner key"})
    call(args.base, f"{api}/runner/key", method="PUT", body={"api_key_id": key["id"]})
    runner = Runner(args.base, project["id"], key["token"])
    runner.register(platform=True)
    runner.heartbeat()
    listed = call(args.base, f"{api}/targets", headers={"X-Qym-Performance-Platform": "1"})["targets"]
    target = next((row for row in listed if row.get("kind") == "estishraf_platform"
                   and row["name"] == "QA - Estishraf platform (stand-in)" and not row.get("archived_at")), None)
    if target is None:
        target = call(args.base, f"{api}/targets", method="POST", body={
            "kind": "estishraf_platform", "name": "QA - Estishraf platform (stand-in)",
            "is_production": False, "base_url": "https://platform.qa-target.example.test",
            "max_users": 10, "max_duration_s": 3600, "settings": {},
        })
    call(args.base, f"{api}/targets/{target['id']}/tokens/session_cookie", method="PUT",
         body={"token": "example_session=fictional-seed-a; example_refresh=fictional-seed-b", "expires_at": None})
    for test_type, finish in [("breakpoint", True), ("smoke", True)] + ([("breakpoint", False)] if args.running else []):
        run = call(args.base, f"{api}/runs", method="POST", body={
            "target_id": target["id"], "target_kind": "estishraf_platform", "test_type": test_type,
            "plan": {"max_users": 10} if test_type == "breakpoint" else {"smoke_max_duration_seconds": 600}, "note": "Fictional platform seed",
        })
        walk_platform(runner, run["id"], finish=finish)
        print(f"run {run['number']}: platform {test_type}, {'finished' if finish else 'running at 5 users'}")
    print(f"seeded: {args.base.rstrip('/')}/projects/{project['slug']}/performance")


def age(args: argparse.Namespace) -> None:
    if not (args.database_url and args.project_id and args.seconds):
        sys.exit("age needs --database-url, --project-id and --seconds")
    os.environ.setdefault("QYM_DATABASE_URL", args.database_url)
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from qym_platform.db.models import PerformanceRun, PerformanceRunner

    delta = timedelta(seconds=args.seconds)

    def back(row: Any, *names: str) -> None:
        for name in names:
            value = getattr(row, name)
            if value is not None:
                setattr(row, name, value - delta)

    engine = create_engine(args.database_url)
    try:
        with Session(engine) as db:
            runners = db.scalars(select(PerformanceRunner).where(PerformanceRunner.project_id == args.project_id))
            for runner in runners:
                back(runner, "last_heartbeat_at", "registered_at")
            runs = db.scalars(
                select(PerformanceRun).where(
                    PerformanceRun.project_id == args.project_id, PerformanceRun.status.in_(ACTIVE)
                )
            )
            for run in runs:
                back(run, "requested_at", "claimed_at", "started_at", "last_report_at", "last_seen_at")
            db.commit()
    finally:
        engine.dispose()
    print(f"aged project {args.project_id} by {args.seconds}s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", nargs="?", default="seed", choices=("seed", "age"))
    parser.add_argument("--base", default="http://127.0.0.1:8800")
    parser.add_argument("--slug", default="qa-performance")
    parser.add_argument("--name", default="QA - Performance")
    parser.add_argument("--platform", action="store_true", help="seed the additive Estishraf Platform sample instead of chat")
    parser.add_argument("--running", action="store_true", help="leave one Breakpoint run in progress")
    parser.add_argument("--database-url", help="age: the platform's database")
    parser.add_argument("--project-id", help="age: the project whose runner goes silent")
    parser.add_argument("--seconds", type=int, help="age: how far to move the clock")
    args = parser.parse_args()
    try:
        (age if args.command == "age" else seed_platform if args.platform else seed)(args)
    except ApiError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
