"""Seed live evaluation through the published ingest API using only the stdlib.

Usage (platform running with QYM_AUTH_MODE=none):

    python frontend/scripts/seed_live.py --base http://127.0.0.1:8800 --slug demo

Creates/looks up the project, mints a key, and publishes repeatable sample turns.
--stale sends no heartbeat at all, so the source reads as stale at once.
the source fresh until QYM_LIVE_STALE_AFTER_SECONDS elapses (default 300 seconds).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, time, timedelta, timezone

DIAGNOSES = [
    ("ok", "OK", "accent", 40),
    ("suboptimal", "Suboptimal", "warning", 15),
    ("agent_problem", "Agent problem", "danger", 12),
    ("reference_problem", "Reference problem", "warning", 8),
    ("system_problem", "System problem", "meta", 10),
    ("inconclusive", "Inconclusive", "neutral", 15),
]
SERVICES = (
    "router", "retrieval", "sql_generation", "sql_execution", "visualization",
    "finalize", "eval_health",
)
QUESTIONS = [
    (
        "ما إجمالي عدد السكان في المناطق خلال عام 2025؟",
        "يبلغ إجمالي السكان في البيانات التجريبية ٣٢٠ ألف نسمة.",
        "SELECT SUM(population) AS population FROM population_sample WHERE year = 2025",
        1,
    ),
    (
        "كيف تغير عدد السكان بين عامي 2024 و2025؟",
        "ارتفع عدد السكان في العينة من ٣١٠ آلاف إلى ٣٢٠ ألف نسمة.",
        "SELECT year, SUM(population) FROM population_sample WHERE year IN (2024, 2025) GROUP BY year ORDER BY year",
        2,
    ),
    (
        "ما توزيع التأشيرات حسب النوع في الربع الأول؟",
        "تتوزع التأشيرات التجريبية بين الزيارة والعمل والدراسة.",
        "SELECT visa_type, COUNT(*) FROM visa_sample WHERE quarter = 1 GROUP BY visa_type",
        3,
    ),
    (
        "قارن عدد التأشيرات الصادرة في يناير وفبراير.",
        "أُصدرت ١٢٠٠ تأشيرة في يناير و١٣٥٠ في فبراير ضمن العينة.",
        "SELECT month, COUNT(*) FROM visa_sample WHERE month IN (1, 2) GROUP BY month ORDER BY month",
        2,
    ),
    (
        "ما نسبة التوظيف حسب الفئة العمرية؟",
        "تتفاوت نسبة التوظيف بين الفئات العمرية الثلاث في البيانات التجريبية.",
        "SELECT age_group, AVG(employed) AS employment_rate FROM employment_sample GROUP BY age_group",
        3,
    ),
    (
        "أي القطاعات سجلت أعلى نمو في عدد العاملين؟",
        "سجل قطاع الخدمات أعلى نمو في العينة، يليه قطاع الصناعة.",
        "SELECT sector, SUM(new_jobs) AS growth FROM employment_sample GROUP BY sector ORDER BY growth DESC",
        4,
    ),
]
REASONS = {
    "ok": "The query and answer cover the requested period and categories.",
    "suboptimal": "The totals are correct, but the answer omits one comparison.",
    "agent_problem": "The generated query uses an incomplete category filter.",
    "reference_problem": "The reference definitions disagree about the reporting period.",
    "system_problem": "A service timed out before the evaluation could finish.",
    "inconclusive": "The judges disagree and the available evidence is insufficient.",
}


def call(base, path, *, method="GET", body=None, token=None):
    headers = {}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise SystemExit(f"{method} {path} -> {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise SystemExit(f"{method} {path} -> connection failed: {exc.reason}") from None


def ensure_project(base, slug):
    for project in call(base, "/v1/projects")["projects"]:
        if project["slug"] == slug:
            return project
    return call(base, "/v1/projects", method="POST", body={"name": slug, "slug": slug})


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def metric_specs():
    specs = [
        {"metric_name": "agent_success", "group": "quality", "label": "Agent success",
         "score_type": "percentage", "direction": "maximize", "pass_threshold": 0.5,
         "is_primary": True},
        {"metric_name": "diagnosis", "group": "diagnosis", "label": "Diagnosis",
         "score_type": "categorical",
         "values": [{"value": value, "label": label, "tone": tone}
                    for value, label, tone, _ in DIAGNOSES]},
    ]
    for name, label in (
        ("compliance_a", "Judge A compliance"), ("compliance_b", "Judge B compliance"),
        ("error_detection", "Error detection"),
    ):
        specs.append({"metric_name": name, "group": "quality", "label": label,
                      "score_type": "percentage", "direction": "maximize", "pass_threshold": 0.5})
    specs.append({"metric_name": "response_latency", "group": "latency", "label": "Response latency",
                  "score_type": "duration", "direction": "minimize", "unit": "ms", "precision": 0})
    for name, label in (("chart_fidelity", "Chart fidelity"), ("chart_vision", "Chart vision")):
        specs.append({"metric_name": name, "group": "charts", "label": label,
                      "score_type": "percentage", "direction": "maximize", "pass_threshold": 0.5})
    for name in SERVICES:
        specs.append({"metric_name": f"service.{name}", "group": "service",
                      "label": "Evaluation health" if name == "eval_health" else name.replace("_", " ").capitalize(),
                      "score_type": "boolean", "direction": "maximize", "pass_threshold": 1.0})
    for position, spec in enumerate(specs):
        spec["position"] = position
    return specs


def build_turn(day, index, total, label, rng, now, specs):
    question, answer, sql_text, rows = QUESTIONS[index % len(QUESTIONS)]
    good = label == "ok"
    problem = label in {"agent_problem", "system_problem"}
    chart = rng.random() < 0.4
    chart_issue = chart and label in {"suboptimal", "agent_problem"}
    latency = round(rng.uniform(20000, 360000), 1)
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    end = min(start + timedelta(days=1), now)
    window = max(0.0, (end - start).total_seconds() - 360)
    turn_at = start + timedelta(seconds=window * (index + 1) / (total + 1))
    status = "failed" if label == "system_problem" else "completed"
    if label == "inconclusive" and index % 3 == 0:
        status = "incomplete_ingest"
    if problem:
        answer = "تعذر إكمال المقارنة المطلوبة؛ النتائج المتاحة غير مكتملة."
    compliance = {}
    judges = {}
    coverage = {"covered": 3 if good else 2 if label == "suboptimal" else 1, "total": 3}
    for judge in ("a", "b"):
        score = round(rng.uniform(0.86, 1.0) if good else rng.uniform(0.2, 0.72), 2)
        if label == "inconclusive":
            score = 0.85 if judge == "a" else 0.25
        compliance[judge] = score
        judges[judge] = {
            "model": f"judge-{judge}",
            "compliance": {"sql": score, "response": round(max(0, score - 0.05), 2), "overall": score},
            "reasoning": REASONS[label],
            "sql_parts": [{"text": sql_text, "executed": status != "failed",
                           "rows": rows if status != "failed" else None,
                           "error": "Query timeout" if status == "failed" else None}],
            "vs_agent": {"equivalent": good, "result_set_match": not problem, "coverage": coverage},
        }
    services = {}
    failing = "sql_generation" if label == "agent_problem" else None
    if label == "system_problem":
        failing = "sql_execution" if index % 2 else "eval_health"
    for name in SERVICES:
        skipped = name == "visualization" and not chart
        failed = name == failing or name == "visualization" and chart_issue
        services[name] = {
            "status": "skipped" if skipped else "failed" if failed else "ok",
            "score": None if skipped else 0.0 if failed else 1.0,
            "fault": ("system" if label == "system_problem" else "agent") if failed else None,
            "signals": {"latency_ms": round(rng.uniform(20, 1200), 1)},
        }
    tools = ["retrieval", "sql_execution"] + (["visualization"] if chart else [])
    tool_list = [{"name": name, "step": step, "ok": services[name]["status"] == "ok"}
                 for step, name in enumerate(tools, 1)]
    failures = [{"name": entry["name"], "step": entry["step"],
                 "error": "Query timeout" if label == "system_problem" else "Output validation failed",
                 "fault": services[entry["name"]]["fault"]}
                for entry in tool_list if not entry["ok"]]
    chart_scores = {"chart_fidelity": 0.45 if chart_issue else 0.94,
                    "chart_vision": 0.6 if chart_issue else 0.91}
    summary = {
        "router": {"intent": "analytical_query", "confidence": 0.97},
        "judges": judges, "judges_agree": label != "inconclusive", "coverage": coverage,
        "cross_review": {
            "a_on_b": {"text": "The coverage assessment differs." if label == "inconclusive" else "The assessment is supported by the results.",
                       "score": 0.3 if label == "inconclusive" else 0.95},
            "b_on_a": {"text": REASONS[label], "score": compliance["b"]},
        },
        "deviations": [] if good else [{"judge": "a", "axis": "response", "text": REASONS[label]}],
        "envelope": {"intent": "analytical_query", "expected_tools": tools,
                     "actual_tools": tools, "matched": True},
        "tools": {"calls": len(tools), "budget": 8, "failures": failures, "list": tool_list},
        "sql_notes": {"reused_by_judges": index % 4 == 0, "dialect_ok": True,
                      "validator_ok": label != "agent_problem"},
        "charts": [{"ref": f"chart-{day}-{index + 1}", "kind": "bar", "scores": chart_scores,
                    "issues": ["Missing category label"] if chart_issue else [],
                    "reading": "يقارن الرسم القيم في الفئات الواردة في السؤال."}] if chart else [],
        "services": services, "manifest_hash": "sample-manifest-v1",
        "evaluation_failed": label == "system_problem", "skipped": status == "incomplete_ingest",
        "eval_meta": {"models": {"a": "judge-a", "b": "judge-b"}, "eval_code_version": "seed-v1",
                      "attempt": 1, "durations": {"evaluation_ms": round(rng.uniform(1500, 9000), 1)},
                      "mode": "inquiry"},
    }
    if summary["skipped"]:
        summary["skip_reason"] = "Incomplete execution evidence"
    scores = []
    for spec in specs:
        name = spec["metric_name"]
        value = None
        skip_reason = None
        if name == "diagnosis":
            scores.append({"metric_name": name, "score_raw": label, "label": label,
                           "explanation": REASONS[label]})
            continue
        if name == "agent_success":
            value = 1.0 if good else 0.65 if label == "suboptimal" else 0.0
            if label in {"reference_problem", "inconclusive"}:
                skip_reason = "No reliable final verdict"
        elif name.startswith("compliance_"):
            value = compliance[name[-1]]
            if label == "reference_problem":
                skip_reason = "Reference definitions conflict"
        elif name == "error_detection":
            value = 1.0 if problem else 0.9
        elif name == "response_latency":
            value = latency
        elif name in chart_scores:
            value = chart_scores[name]
            if not chart:
                skip_reason = "No chart produced"
        elif name.startswith("service."):
            service = services[name.split(".", 1)[1]]
            value = service["score"]
            if service["status"] == "skipped":
                skip_reason = "Service not required for this turn"
        if status == "incomplete_ingest" and spec["group"] in {"quality", "charts"}:
            skip_reason = summary["skip_reason"]
        scores.append({"metric_name": name, "score_numeric": None if skip_reason else value,
                       "skipped": skip_reason is not None, "skip_reason": skip_reason,
                       "explanation": skip_reason or REASONS[label]})
    return {
        "turn_id": f"turn-{day}-{index + 1:04d}", "day": day.isoformat(),
        "conversation_id": f"conversation-{day}-{index // 3 + 1:03d}", "turn_index": index % 3,
        "turn_at": iso(turn_at), "evaluated_at": iso(min(end, turn_at + timedelta(milliseconds=latency))),
        "user_ref": f"sample-user-{index % 8 + 1:02d}", "mode": "inquiry", "status": status,
        "outcome": "agent_failed" if problem else "ok", "label": label, "label_reason": REASONS[label],
        "question": question, "answer": answer, "sql": judges["a"]["sql_parts"],
        "latency_ms": latency, "result_rows": rows if status != "failed" else None,
        "tool_calls": len(tools), "summary": summary, "scores": scores,
        "detail": {"sample": True, "evaluation": {"verdict": label, "reasoning": REASONS[label]}},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8800")
    parser.add_argument("--slug", default="demo")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--turns-per-day", type=int, default=30)
    parser.add_argument("--source-key", default="worker-preprod")
    parser.add_argument("--stale", action="store_true",
                        help="skip the final heartbeat; earlier receipts age out after the server's stale threshold")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    if args.days < 1 or args.turns_per_day < 1:
        parser.error("--days and --turns-per-day must be positive")
    if re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", args.source_key) is None:
        parser.error("--source-key must be 1–100 ASCII letters, digits, underscores, dots, colons or hyphens")
    base = args.base.rstrip("/")
    rng = random.Random(args.seed)
    now = datetime.now(timezone.utc)
    project = ensure_project(base, args.slug)
    token = call(base, f"/v1/projects/{project['id']}/api-keys", method="POST",
                 body={"name": f"seed-live-{uuid.uuid4().hex[:6]}"})["token"]
    source = f"/v1/projects/{project['id']}/live/sources/{args.source_key}"
    worker = {"poll_interval_s": 60, "judges": {"a": "judge-a", "b": "judge-b"},
              "eval_code_version": "seed-v1", "worker_version": "seed-v1", "manifest_hash": "sample-manifest-v1"}
    call(base, source, method="PUT", token=token,
         body={"name": "Evaluation worker", "environment": "preprod", "worker": worker,
               "day_key_timezone": "UTC"})
    specs = metric_specs()
    call(base, source + "/metric-specs", method="PUT", token=token, body={"specs": specs})
    # Allocate the requested mix across the whole seed, then randomize its order.
    total = args.days * args.turns_per_day
    counts = [total * weight // 100 for _, _, _, weight in DIAGNOSES]
    remainders = sorted(range(len(DIAGNOSES)),
                        key=lambda index: total * DIAGNOSES[index][3] % 100, reverse=True)
    for index in remainders[:total - sum(counts)]:
        counts[index] += 1
    labels = [entry[0] for entry, size in zip(DIAGNOSES, counts) for _ in range(size)]
    rng.shuffle(labels)
    count = 0
    for offset in range(args.days):
        day = now.date() - timedelta(days=args.days - offset - 1)
        start = datetime.combine(day, time.min, tzinfo=timezone.utc)
        historical = day < now.date()
        end = start + timedelta(days=1) if historical else now
        last_poll = end - timedelta(seconds=60) if historical else now
        day_body = {"run_ref": f"daily-{day}", "status": "running", "first_poll_at": iso(start),
                    "last_poll_at": iso(start), "parameters": worker}
        call(base, source + f"/days/{day}", method="PUT", token=token, body=day_body)
        turns = [build_turn(day, index, args.turns_per_day,
                            labels[offset * args.turns_per_day + index], rng, now, specs)
                 for index in range(args.turns_per_day)]
        for batch_start in range(0, len(turns), 50):
            batch = turns[batch_start:batch_start + 50]
            report = call(base, source + "/turns", method="POST", token=token, body={"turns": batch})
            if report["rejected"]:
                raise SystemExit(f"Rejected seed turns: {json.dumps(report['results'])}")
            count += report["accepted"] + report["updated"]
        if historical and not args.stale:
            call(base, source + "/heartbeat", method="POST", token=token,
                 body={"at": iso(last_poll), "last_poll_at": iso(last_poll),
                       "current_day": day.isoformat(), "worker": worker})
        day_body.update({
            "status": "closed" if historical else "running",
            "turns_seen": len(turns) + (3 if offset in {max(0, args.days - 8), args.days - 1} else 0),
            "evaluated": sum(turn["status"] == "completed" for turn in turns),
            "failed": sum(turn["status"] == "failed" for turn in turns),
            "incomplete": sum(turn["status"] == "incomplete_ingest" for turn in turns), "excluded": 0,
            "last_poll_at": iso(last_poll), "closed_at": iso(end) if historical else None,
        })
        held = call(base, source + f"/turns/ids?day={day}", token=token)["turn_ids"]
        if not {turn["turn_id"] for turn in turns}.issubset(held):
            raise SystemExit(f"Day {day} is missing seeded turns after reconciliation")
        # Counters describe every turn the server holds for the day (a rerun with
        # fewer turns per day keeps earlier ones), plus the deliberate gap.
        day_body["turns_seen"] = len(held) + (day_body["turns_seen"] - len(turns))
        call(base, source + f"/days/{day}", method="PUT", token=token, body=day_body)
    checks = []
    for name in SERVICES[:-1]:
        failed = name == "visualization"
        checks.append({"canary": name, "checked_at": iso(now), "status": "failed" if failed else "ok",
                       "fault": "system" if failed else None, "latency_ms": round(rng.uniform(20, 1200), 1),
                       "detail": {"message": "Probe timed out" if failed else "Probe completed"},
                       "eval_code_version": "seed-v1"})
    call(base, source + "/canaries", method="POST", token=token, body={"results": checks})
    if not args.stale:
        at = datetime.now(timezone.utc)
        call(base, source + "/heartbeat", method="POST", token=token,
             body={"at": iso(at), "last_poll_at": iso(at), "current_day": now.date().isoformat(),
                   "worker": worker})
    print(json.dumps({"project": project["slug"], "source": args.source_key, "days": args.days, "turns": count}))


if __name__ == "__main__":
    sys.exit(main())
