"""Collect slow-query evidence: pg_stat_statements top-N and auto_explain plans.

    python -m qym_platform.tools.perf.explain --url $PGURL --container qym-db-perf --out artifacts/perf/baseline/explain.md
    python -m qym_platform.tools.perf.explain --url $PGURL --reset      # zero pg_stat_statements before a run

``auto_explain`` output is read from the Postgres container log (``docker logs``),
which is where the perf-lab config sends it. Pass ``--since 30m`` to bound it.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from typing import List

from sqlalchemy import create_engine, text

_TOP = text(
    """
    SELECT calls,
           round(total_exec_time::numeric)::bigint AS total_ms,
           round(mean_exec_time::numeric, 1)       AS mean_ms,
           round(max_exec_time::numeric, 1)        AS max_ms,
           rows,
           shared_blks_hit, shared_blks_read,
           query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT ILIKE 'COPY %' AND query NOT ILIKE '%pg_stat_statements%'
    ORDER BY total_exec_time DESC LIMIT :top
    """
)


def top_statements(url: str, top: int) -> List[dict]:
    engine = create_engine(url)
    with engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(_TOP, {"top": top})]


def reset_statements(url: str) -> None:
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_stat_statements_reset()"))


def auto_explain_plans(container: str, since: str, min_ms: float) -> List[str]:
    """Split the container log into auto_explain blocks slower than ``min_ms``."""
    cmd = ["docker", "logs", "--since", since, container]
    try:
        raw = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return []
    log = raw.stdout + raw.stderr
    blocks: List[str] = []
    current: List[str] = []
    duration = None
    for line in log.splitlines():
        m = re.search(r"LOG:\s+duration: ([0-9.]+) ms\s+plan:", line)
        if m:
            if current and duration is not None and duration >= min_ms:
                blocks.append("\n".join(current))
            current = [line]
            duration = float(m.group(1))
            continue
        if current:
            if re.search(r"\b(LOG|ERROR|STATEMENT|WARNING|FATAL):", line) and "Query Text" not in line:
                if duration is not None and duration >= min_ms:
                    blocks.append("\n".join(current))
                current, duration = [], None
            else:
                current.append(line)
    if current and duration is not None and duration >= min_ms:
        blocks.append("\n".join(current))
    blocks.sort(key=lambda b: -float(re.search(r"duration: ([0-9.]+)", b).group(1)))
    return blocks


def render(stmts: List[dict], plans: List[str], *, max_plans: int) -> str:
    out = ["# Slow query evidence", "", "## pg_stat_statements (by total time)", "", "| calls | total ms | mean ms | max ms | rows | hit | read | query |", "|---|---|---|---|---|---|---|---|"]
    for s in stmts:
        q = " ".join(str(s["query"]).split())[:300].replace("|", "\\|")
        out.append(f"| {s['calls']:,} | {s['total_ms']:,} | {s['mean_ms']} | {s['max_ms']} | {s['rows']:,} | {s['shared_blks_hit']:,} | {s['shared_blks_read']:,} | `{q}` |")
    out += ["", f"## auto_explain plans ({len(plans)} captured, showing {min(len(plans), max_plans)})", ""]
    for block in plans[:max_plans]:
        out += ["```", block, "```", ""]
    return "\n".join(out)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("QYM_TEST_POSTGRES_URL") or os.environ.get("QYM_DATABASE_URL"))
    parser.add_argument("--container", default="qym-db-perf")
    parser.add_argument("--since", default="2h")
    parser.add_argument("--min-ms", type=float, default=250.0)
    parser.add_argument("--top", type=int, default=25)
    parser.add_argument("--max-plans", type=int, default=15)
    parser.add_argument("--out", default=None)
    parser.add_argument("--reset", action="store_true", help="reset pg_stat_statements and exit")
    args = parser.parse_args(argv)
    if not args.url:
        parser.error("--url required")
    if args.reset:
        reset_statements(args.url)
        print("pg_stat_statements reset")
        return 0
    report = render(top_statements(args.url, args.top), auto_explain_plans(args.container, args.since, args.min_ms), max_plans=args.max_plans)
    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"wrote {args.out}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
