"""Bulk-load a production-shaped dataset into Postgres.

    python -m qym_platform.tools.perf.synth --url postgresql+psycopg2://qym:qym@localhost:15433/qym_perf \
        --scale 0.25 --legacy-dup-spans --label baseline

Defaults reproduce production as observed in Sept 2026: 11 projects, ~3000
runs (x ``--scale``), 50-100 items per run, 3-5 LLM-judged metrics, 15 % repeat
runs (k in 3/5/8/12), agentic traces with 10-40 spans per item, and every span
stored twice when ``--legacy-dup-spans`` is set (the pre-fix ``run_events``
behaviour). Rows are written with ``COPY`` so a 0.25 scale (~15 GB) loads in
minutes; the dashboard outbox hooks are bypassed so the summary worker's
backfill can be benchmarked separately.

Ownership: every generated id is prefixed ``perf-`` so ``--reset`` only removes
what this tool created.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from qym_platform.api.ingest import (
    _apply_span_to_bucket,
    _build_run_trace_stats,
    _empty_trace_bucket,
    _public_trace_bucket,
)
from qym_platform.db.models import (
    ApiKey,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.event_storage import span_columns_from_attributes
from qym_platform.tools.perf import shape

PREFIX = "perf-"
EVENT_TABLES = (
    "run_events",
    "spans",
    "run_trace_aggregates",
    "run_item_pass_scores",
    "run_item_scores",
    "run_item_attempts",
    "run_items",
    "run_metric_specs",
)
PROD_RUNS = 3000
PROD_PROJECTS = 11
PROD_USERS = 12
HISTORY_DAYS = 270


class Copier:
    """Buffered CSV ``COPY`` writer for one table."""

    def __init__(self, raw_conn, table: str, columns: Sequence[str], flush_rows: int = 5000):
        self.raw_conn = raw_conn
        self.table = table
        self.columns = list(columns)
        self.flush_rows = flush_rows
        self.buf = io.StringIO()
        self.writer = csv.writer(self.buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        self.pending = 0
        self.total = 0
        self.bytes = 0

    def add(self, row: Sequence[Any]) -> None:
        self.writer.writerow(["\\N" if v is None else v for v in row])
        self.pending += 1
        if self.pending >= self.flush_rows:
            self.flush()

    def flush(self) -> None:
        if not self.pending:
            return
        data = self.buf.getvalue()
        self.bytes += len(data)
        cols = ", ".join(f'"{c}"' for c in self.columns)
        sql = f"COPY {self.table} ({cols}) FROM STDIN WITH (FORMAT csv, NULL '\\N')"
        with self.raw_conn.cursor() as cur:
            cur.copy_expert(sql, io.StringIO(data))
        self.total += self.pending
        self.pending = 0
        self.buf = io.StringIO()
        self.writer = csv.writer(self.buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")


def _j(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S.%f")


def _ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).replace(tzinfo=None)


def reset(engine) -> None:
    """Delete everything owned by this tool (ids prefixed ``perf-``)."""
    with engine.begin() as conn:
        run_ids = [r[0] for r in conn.execute(text("SELECT id FROM runs WHERE id LIKE :p"), {"p": PREFIX + "%"})]
        if run_ids:
            for table in EVENT_TABLES + (
                "run_trace_summaries",
                "run_trace_contributions",
                "run_trace_named_contributions",
                "run_metric_analyses",
                "approvals",
                "root_cause_revisions",
                "review_corrections",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE run_id LIKE :p"), {"p": PREFIX + "%"})
            for table in ("dashboard_run_summaries", "dashboard_run_dimensions", "dashboard_record_state", "dashboard_record_causes"):
                conn.execute(text(f"DELETE FROM {table} WHERE run_key LIKE :p"), {"p": PREFIX + "%"})
            conn.execute(text("DELETE FROM dashboard_partition_state WHERE partition_key LIKE :p"), {"p": PREFIX + "%"})
            conn.execute(text("DELETE FROM dashboard_change_events WHERE partition_key LIKE :p"), {"p": PREFIX + "%"})
            conn.execute(text("DELETE FROM runs WHERE id LIKE :p"), {"p": PREFIX + "%"})
        conn.execute(text("DELETE FROM api_keys WHERE id LIKE :p"), {"p": PREFIX + "%"})
        conn.execute(text("DELETE FROM project_memberships WHERE project_id LIKE :p"), {"p": PREFIX + "%"})
        conn.execute(text("DELETE FROM projects WHERE id LIKE :p"), {"p": PREFIX + "%"})
        conn.execute(text("DELETE FROM users WHERE id LIKE :p"), {"p": PREFIX + "%"})


def seed_org(db: Session, rng: random.Random, *, projects: int, users: int) -> tuple[List[User], List[Project], Dict[str, str]]:
    """Users, projects, memberships and one API key per project. Returns raw tokens."""
    user_rows = []
    for i in range(users):
        user_rows.append(
            User(
                id=f"{PREFIX}user-{i:02d}",
                email=f"perf.user{i:02d}@example.test",
                display_name=f"Perf User {i:02d}",
                role=UserRole.ADMIN if i == 0 else UserRole.MEMBER,
            )
        )
    db.add_all(user_rows)
    db.flush()
    project_rows = []
    tokens: Dict[str, str] = {}
    for p in range(projects):
        proj = Project(
            id=f"{PREFIX}project-{p:02d}",
            name=f"Perf Project {p:02d}",
            slug=f"perf-project-{p:02d}",
            created_by_user_id=user_rows[0].id,
        )
        db.add(proj)
        project_rows.append(proj)
        db.flush()  # ApiKey/ProjectMembership have no relationship to Project, so order explicitly
        members = rng.sample(user_rows, k=min(len(user_rows), rng.randint(3, 8)))
        for m in members:
            db.add(ProjectMembership(project_id=proj.id, user_id=m.id, role=ProjectRole.MANAGER if m is members[0] else ProjectRole.MEMBER, added_by_user_id=user_rows[0].id))
        token = f"qk{p:02d}perf_" + "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(24))
        tokens[proj.slug] = token
        db.add(
            ApiKey(
                id=f"{PREFIX}key-{p:02d}",
                user_id=members[0].id,
                project_id=proj.id,
                name="perf-lab",
                prefix=api_key_prefix(token),
                key_hash=hash_api_key(token),
                scopes=["runs:read", "runs:write", "datasets:read", "datasets:write"],
            )
        )
    db.flush()
    return user_rows, project_rows, tokens


def _run_created_at(rng: random.Random, now: datetime) -> datetime:
    # Recent-heavy: half of all runs in the last 60 days, the rest spread back.
    if rng.random() < 0.5:
        days = rng.uniform(0, 60)
    else:
        days = rng.uniform(60, HISTORY_DAYS)
    return now - timedelta(days=days, seconds=rng.uniform(0, 86400))


class RunWriter:
    """Writes one run and all its children through COPY buffers."""

    def __init__(self, raw_conn, *, legacy_dup_spans: bool):
        self.legacy_dup_spans = legacy_dup_spans
        self.items = Copier(raw_conn, "run_items", ["run_id", "item_id", "index", "input", "expected", "output", "error", "item_metadata", "latency_ms", "retry_count", "trace_id", "trace_url"])
        self.attempts = Copier(raw_conn, "run_item_attempts", ["run_id", "item_id", "pass_number", "attempt_number", "status", "latency_ms", "task_started_at_ms", "trace_id", "trace_url", "error", "is_last_attempt", "output"])
        self.scores = Copier(raw_conn, "run_item_scores", ["run_id", "item_id", "metric_name", "score_numeric", "score_raw", "meta", "label", "explanation"])
        self.pass_scores = Copier(raw_conn, "run_item_pass_scores", ["run_id", "item_id", "metric_name", "pass_number", "score_numeric", "label", "meta", "explanation"])
        self.spans = Copier(raw_conn, "spans", ["run_id", "run_created_at", "trace_id", "span_id", "parent_span_id", "name", "kind", "start_time_ns", "end_time_ns", "duration_ms", "status", "attributes", "events", "links", "oi_kind", "usage_scope", "model_name", "tool_name", "token_total", "token_prompt", "token_completion"], flush_rows=2000)
        self.events = Copier(raw_conn, "run_events", ["run_id", "event_id", "sequence", "type", "sent_at", "payload"], flush_rows=2000)
        self.aggregates = Copier(raw_conn, "run_trace_aggregates", ["run_id", "trace_id", "span_count", "tokens", "cost", "llm_calls", "tool_calls", "tool_errors", "malformed_tool_calls", "noisy_reasoning", "provider_errors", "has_reasoning", "has_reasoning_tokens", "reasoning_tokens", "raw_bucket"])
        self.all = [self.items, self.attempts, self.scores, self.pass_scores, self.spans, self.events, self.aggregates]

    def flush(self) -> None:
        for c in self.all:
            c.flush()

    def write_run(self, rng: random.Random, run_id: str, rs: shape.RunShape, created_at: datetime) -> Dict[str, Any]:
        seq = 0
        started_ms = int(created_at.timestamp() * 1000)
        clock_ms = started_ms
        heartbeat_due_ms = started_ms + 15_000

        def emit(ev_type: str, payload: Dict[str, Any], at_ms: int) -> None:
            nonlocal seq, heartbeat_due_ms
            # Interleave heartbeats the way the SDK's stream thread does.
            while heartbeat_due_ms < at_ms and seq < 100_000:
                seq += 1
                self.events.add([run_id, f"{run_id}-hb-{seq}", seq, "run_heartbeat", _ts(_ms_to_dt(heartbeat_due_ms)), _j({"heartbeat_at": _ms_to_dt(heartbeat_due_ms).isoformat()})])
                heartbeat_due_ms += 15_000
            seq += 1
            self.events.add([run_id, f"{run_id}-{seq}", seq, ev_type, _ts(_ms_to_dt(at_ms)), _j(payload)])

        metric_names = [m.name for m in rs.metrics]
        emit(
            "run_started",
            {
                "task": rs.task,
                "dataset": rs.dataset,
                "model": rs.model,
                "metrics": metric_names,
                "metric_specs": {m.name: {"score_type": m.score_type, "direction": m.direction, "pass_threshold": m.pass_threshold} for m in rs.metrics},
                "total_items": rs.item_count,
                "run_metadata": {},
                "run_config": {"samples": rs.samples, "concurrency": 8},
                "started_at": created_at.isoformat(),
            },
            started_ms,
        )

        item_buckets: List[Dict[str, Any]] = []
        n_spans = 0
        n_bytes_attrs = 0
        items = [shape.item_shape(rng, i) for i in range(rs.item_count)]
        # RUNNING runs stop partway through their last pass.
        stop_at = None
        if rs.status == "RUNNING":
            stop_at = (rs.samples, rng.randint(rs.item_count // 3, rs.item_count - 1))
        per_pass_scores: Dict[str, Dict[str, List[float]]] = {it.item_id: {m: [] for m in metric_names} for it in items}
        last_pass_output: Dict[str, Any] = {}
        last_pass_error: Dict[str, Optional[str]] = {}
        last_pass: Dict[str, shape.PassShape] = {}
        # 8 items in flight: stagger starts so heartbeats/latencies overlap realistically.
        lane_clock = [clock_ms] * 8
        for pass_number in range(1, rs.samples + 1):
            for it in items:
                if stop_at and (pass_number, it.index) >= stop_at:
                    break
                lane = it.index % 8
                start_ms = lane_clock[lane]
                p = shape.item_pass(rng, item=it, run=rs, pass_number=pass_number, started_at_ms=start_ms)
                end_ms = start_ms + int(p.latency_ms) + 50
                lane_clock[lane] = end_ms
                emit("item_started", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "input": it.input, "expected": it.expected, "item_metadata": it.item_metadata}, start_ms)
                emit("item_attempt_started", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "attempt_number": 1, "trace_id": p.trace_id, "task_started_at_ms": start_ms}, start_ms)
                # spans
                bucket = _empty_trace_bucket()
                parent_kind = {s.span_id: s.oi_kind for s in p.spans}
                for s in p.spans:
                    dur_ms = (s.end_ns - s.start_ns) / 1e6
                    attrs_json = _j(s.attributes)
                    n_bytes_attrs += len(attrs_json)
                    n_spans += 1
                    promoted = span_columns_from_attributes(s.attributes)
                    self.spans.add([run_id, _ts(created_at), p.trace_id, s.span_id, s.parent_span_id, s.name, s.kind, s.start_ns, s.end_ns, dur_ms, s.status, attrs_json, "[]", "[]", promoted["oi_kind"], promoted["usage_scope"], promoted["model_name"], promoted["tool_name"], promoted["token_total"], promoted["token_prompt"], promoted["token_completion"]])
                    _apply_span_to_bucket(bucket, attributes=s.attributes, status=s.status, duration_ms=dur_ms, parent_oi_kind=parent_kind.get(s.parent_span_id or ""))
                    if self.legacy_dup_spans:
                        emit(
                            "span_completed",
                            {"trace_id": p.trace_id, "span_id": s.span_id, "parent_span_id": s.parent_span_id, "name": s.name, "kind": s.kind, "start_time_ns": s.start_ns, "end_time_ns": s.end_ns, "duration_ms": dur_ms, "status": s.status, "attributes": s.attributes, "events": [], "links": []},
                            int(s.end_ns / 1_000_000),
                        )
                self.aggregates.add([run_id, p.trace_id, bucket["span_count"], bucket["tokens"], bucket["cost"], bucket["llm_calls"], bucket["tool_calls"], bucket["tool_errors"], bucket["malformed_tool_calls"], bucket["noisy_reasoning"], bucket["provider_errors"], bucket["has_reasoning"], bucket["has_reasoning_tokens"], bucket["reasoning_tokens"], _j(bucket)])
                status = "failed" if p.error else "completed"
                emit("item_attempt_finished", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "attempt_number": 1, "status": status, "trace_id": p.trace_id, "latency_ms": p.latency_ms, "task_started_at_ms": start_ms, "output": p.output, "error": p.error, "is_last_attempt": True}, end_ms)
                self.attempts.add([run_id, it.item_id, pass_number, 1, status.upper(), p.latency_ms, start_ms, p.trace_id, None, p.error, True, _j(p.output) if p.output is not None else None])
                for m, sc in p.scores.items():
                    emit("metric_scored", {"item_id": it.item_id, "pass_number": pass_number, "metric_name": m, "score_numeric": sc["score"], "score_raw": sc["meta"]["raw"], "meta": sc["meta"], "explanation": sc["explanation"]}, end_ms)
                    self.pass_scores.add([run_id, it.item_id, m, pass_number, sc["score"], None, _j(sc["meta"]), sc["explanation"]])
                    per_pass_scores[it.item_id][m].append(sc["score"])
                if p.error:
                    emit("item_failed", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "error": p.error, "latency_ms": p.latency_ms, "trace_id": p.trace_id, "task_started_at_ms": start_ms, "retry_count": 0}, end_ms)
                else:
                    emit("item_completed", {"item_id": it.item_id, "index": it.index, "pass_number": pass_number, "is_final_pass": pass_number == rs.samples, "output": p.output, "item_metadata": it.item_metadata, "task_metadata": {}, "latency_ms": p.latency_ms, "trace_id": p.trace_id, "task_started_at_ms": start_ms, "retry_count": 0}, end_ms)
                    item_buckets.append(bucket)
                last_pass_output[it.item_id] = p.output
                last_pass_error[it.item_id] = p.error
                last_pass[it.item_id] = p
                if not p.error:
                    it.item_metadata = dict(it.item_metadata, trace_stats=_public_trace_bucket(bucket))
                clock_ms = max(clock_ms, end_ms)
            else:
                emit("pass_completed", {"pass_number": pass_number, "samples": rs.samples, "metrics": {}}, clock_ms)
                continue
            break

        for it in items:
            p = last_pass.get(it.item_id)
            if p is None:
                continue
            meta = dict(it.item_metadata, task_started_at_ms=p.started_at_ms, retry_count=0)
            self.items.add([run_id, it.item_id, it.index, _j(it.input), _j(it.expected), _j(p.output) if p.output is not None else None, p.error, _j(meta), p.latency_ms, 0, p.trace_id, None])
            for m in metric_names:
                vals = per_pass_scores[it.item_id][m]
                if not vals:
                    continue
                mean = sum(vals) / len(vals)
                sc = p.scores.get(m) or {"explanation": None, "meta": {"status": "ok"}}
                self.scores.add([run_id, it.item_id, m, round(mean, 4), _j({"score": mean}), _j(sc["meta"]), None, sc["explanation"]])

        ended_at = _ms_to_dt(clock_ms)
        if rs.status != "RUNNING":
            emit("run_completed", {"ended_at": ended_at.isoformat(), "summary": {}, "final_status": rs.status}, clock_ms)
        trace_stats = _build_run_trace_stats(item_buckets)
        return {
            "ended_at": None if rs.status == "RUNNING" else ended_at,
            "last_event_at": ended_at,
            "run_metadata": {"total_items": rs.item_count, "trace_stats": trace_stats, **({"last_completed_pass": rs.samples} if rs.samples > 1 and rs.status != "RUNNING" else {})},
            "events": seq,
            "spans": n_spans,
            "span_attr_bytes": n_bytes_attrs,
            "items": len(items),
        }


def _load_org(db: Session) -> tuple[List[User], List[Project], Dict[str, str]]:
    users = db.query(User).filter(User.id.like(PREFIX + "%")).order_by(User.id).all()
    projects = db.query(Project).filter(Project.id.like(PREFIX + "%")).order_by(Project.id).all()
    return users, projects, {}


def generate(
    url: Optional[str] = None,
    *,
    engine=None,
    scale: float,
    seed: int,
    projects: int,
    users: int,
    legacy_dup_spans: bool,
    label: str,
    out_dir: str,
    repeat_share: float,
    progress_every: int = 25,
    resume: bool = False,
) -> Dict[str, Any]:
    rng = random.Random(seed)
    if engine is None:
        if not url:
            raise ValueError("generate() needs a url or an engine")
        engine = create_engine(url)
    started = time.time()
    n_runs = max(1, round(PROD_RUNS * scale))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    totals = {"runs": 0, "items": 0, "spans": 0, "events": 0, "span_attr_bytes": 0, "repeat_runs": 0}
    with Session(engine) as db:
        # Bypass dashboard outbox hooks: the seeded backlog is meant to be
        # backfilled by the worker, exactly like production after 0049/0050.
        db.info["dashboard_projection_worker"] = True
        start_index = 0
        if resume:
            users_rows, project_rows, tokens = _load_org(db)
            if not project_rows:
                raise SystemExit("--resume: no perf-* projects found; run without --resume first")
            last = db.execute(text("SELECT max(id) FROM runs WHERE id LIKE :p"), {"p": f"{PREFIX}run-%"}).scalar()
            start_index = int(last.rsplit("-", 1)[1]) + 1 if last else 0
            print(f"[synth] resuming at run {start_index}/{n_runs}", file=sys.stderr, flush=True)
        else:
            users_rows, project_rows, tokens = seed_org(db, rng, projects=projects, users=users)
        user_ids = [u.id for u in users_rows]
        project_ids = [p.id for p in project_rows]
        db.commit()
        raw = db.connection().connection  # psycopg2 connection inside the ORM transaction
        writer = RunWriter(raw, legacy_dup_spans=legacy_dup_spans)
        for i in range(start_index, n_runs):
            # Per-run RNG: deterministic for a (seed, index) pair and resumable.
            rng = random.Random(f"{seed}:{i}")
            project_index = i % len(project_ids) if i < len(project_ids) else rng.randrange(len(project_ids))
            member_ids = rng.sample(user_ids, k=2)
            rs = shape.run_shape(rng, project_index=project_index, repeat_share=repeat_share)
            created_at = _run_created_at(rng, now)
            if rs.status == "RUNNING":
                created_at = now - timedelta(minutes=rng.uniform(5, 90))
            run_id = f"{PREFIX}run-{i:05d}"
            run = Run(
                id=run_id,
                project_id=project_ids[project_index],
                external_run_id=f"{rs.task}-{i:05d}",
                created_by_user_id=member_ids[0],
                owner_user_id=member_ids[0],
                task=rs.task,
                dataset=rs.dataset,
                model=rs.model,
                metrics=[m.name for m in rs.metrics],
                run_metadata={},
                run_config={"samples": rs.samples, "concurrency": 8},
                samples=rs.samples,
                status=RunWorkflowStatus[rs.status],
                started_at=created_at,
                created_at=created_at,
                updated_at=created_at,
            )
            db.add(run)
            for pos, m in enumerate(rs.metrics):
                db.add(RunMetricSpec(run_id=run_id, metric_name=m.name, position=pos, score_type=m.score_type, direction=m.direction, pass_threshold=m.pass_threshold))
            db.flush()
            info = writer.write_run(rng, run_id, rs, created_at)
            run.ended_at = info["ended_at"]
            run.last_event_at = info["last_event_at"]
            run.updated_at = info["last_event_at"]
            run.run_metadata = info["run_metadata"]
            db.flush()
            totals["runs"] += 1
            totals["items"] += info["items"]
            totals["spans"] += info["spans"]
            totals["events"] += info["events"]
            totals["span_attr_bytes"] += info["span_attr_bytes"]
            totals["repeat_runs"] += 1 if rs.samples > 1 else 0
            if (i + 1) % progress_every == 0 or i + 1 == n_runs:
                writer.flush()
                db.commit()
                db.expunge_all()  # keep the identity map from growing across 3000 runs
                db.info["dashboard_projection_worker"] = True
                raw = db.connection().connection
                for c in writer.all:
                    c.raw_conn = raw
                elapsed = time.time() - started
                print(f"[synth] {i + 1}/{n_runs} runs  {totals['spans']:,} spans  {totals['events']:,} events  {totals['span_attr_bytes'] / 1e9:.2f} GB attrs  {elapsed:,.0f}s", file=sys.stderr, flush=True)
        writer.flush()
        db.commit()
    manifest = {
        "label": label,
        "generated_at": now.isoformat(),
        "seed": seed,
        "scale": scale,
        "legacy_dup_spans": legacy_dup_spans,
        "projects": projects,
        "users": users,
        "repeat_share": repeat_share,
        "start_index": start_index,
        "totals": totals,
        "api_tokens": tokens,
        "elapsed_seconds": round(time.time() - started, 1),
        "url": (url or str(engine.url)).split("@")[-1],
    }
    os.makedirs(os.path.join(out_dir, label), exist_ok=True)
    with open(os.path.join(out_dir, label, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("QYM_TEST_POSTGRES_URL") or os.environ.get("QYM_DATABASE_URL"), help="SQLAlchemy Postgres URL")
    parser.add_argument("--scale", type=float, default=0.25, help="fraction of production run count (3000)")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--projects", type=int, default=PROD_PROJECTS)
    parser.add_argument("--users", type=int, default=PROD_USERS)
    parser.add_argument("--repeat-share", type=float, default=0.15)
    parser.add_argument("--legacy-dup-spans", action="store_true", help="also store every span as a span_completed run_event (pre-fix behaviour)")
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--out-dir", default=os.path.join("artifacts", "perf"))
    parser.add_argument("--reset", action="store_true", help="delete previously generated perf-* data first")
    parser.add_argument("--reset-only", action="store_true")
    parser.add_argument("--resume", action="store_true", help="continue a previous seed from the last perf-run-* id")
    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.url:
        parser.error("--url or QYM_TEST_POSTGRES_URL is required")
    if not args.url.startswith("postgresql"):
        parser.error("synth requires a PostgreSQL URL")
    if args.reset or args.reset_only:
        reset(create_engine(args.url))
        print("[synth] removed previous perf-* data", file=sys.stderr)
        if args.reset_only:
            return 0
    manifest = generate(
        args.url,
        scale=args.scale,
        seed=args.seed,
        projects=args.projects,
        users=args.users,
        legacy_dup_spans=args.legacy_dup_spans,
        label=args.label,
        out_dir=args.out_dir,
        repeat_share=args.repeat_share,
        resume=args.resume,
    )
    print(json.dumps({k: v for k, v in manifest.items() if k != "api_tokens"}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
