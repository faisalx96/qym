"""Report where the database bytes are.

    python -m qym_platform.tools.perf.db_stats --url postgresql+psycopg2://... [--json] [--top 15]

Safe, read-only. Also importable: ``collect(engine)`` returns the same data as
a dict so the admin maintenance endpoint can serve it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

_TABLE_SIZES = text(
    """
    SELECT c.relname AS table,
           pg_total_relation_size(c.oid)                          AS total_bytes,
           pg_relation_size(c.oid)                                AS heap_bytes,
           COALESCE(pg_relation_size(c.reltoastrelid), 0)         AS toast_bytes,
           pg_indexes_size(c.oid)                                 AS index_bytes,
           COALESCE(s.n_live_tup, 0)                              AS live_rows,
           COALESCE(s.n_dead_tup, 0)                              AS dead_rows,
           s.last_autovacuum,
           s.last_autoanalyze
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
    ORDER BY pg_total_relation_size(c.oid) DESC
    """
)

_INDEX_SIZES = text(
    """
    SELECT i.relname AS index, t.relname AS table, pg_relation_size(i.oid) AS bytes,
           COALESCE(s.idx_scan, 0) AS scans
    FROM pg_class i
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = i.relnamespace
    LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
    WHERE n.nspname = current_schema()
    ORDER BY pg_relation_size(i.oid) DESC
    LIMIT :top
    """
)

_EVENT_TYPES = text(
    """
    SELECT type, count(*) AS rows, sum(pg_column_size(payload))::bigint AS payload_bytes
    FROM run_events GROUP BY type ORDER BY payload_bytes DESC
    """
)

_SPAN_SCOPES = text(
    """
    SELECT COALESCE(attributes ->> 'qym.usage_scope', 'task')     AS usage_scope,
           COALESCE(attributes ->> 'openinference.span.kind', '?') AS oi_kind,
           count(*) AS rows,
           sum(pg_column_size(attributes))::bigint AS attr_bytes
    FROM spans TABLESAMPLE SYSTEM (:pct)
    GROUP BY 1, 2 ORDER BY attr_bytes DESC
    """
)

_STATEMENTS = text(
    """
    SELECT calls, round(total_exec_time::numeric)::bigint AS total_ms, round(mean_exec_time::numeric, 1) AS mean_ms,
           rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY total_exec_time DESC LIMIT :top
    """
)

_PARTITIONS = text(
    """
    SELECT parent.relname AS parent, child.relname AS partition,
           pg_get_expr(child.relpartbound, child.oid) AS bounds,
           pg_total_relation_size(child.oid) AS bytes
    FROM pg_inherits
    JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    ORDER BY parent.relname, child.relname
    """
)


def _fmt(n: Optional[float]) -> str:
    if n is None:
        return "-"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:,.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


def collect(engine: Engine, *, top: int = 15, sample_pct: float = 5.0) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    with engine.connect() as conn:
        out["database"] = {
            "name": conn.execute(text("SELECT current_database()")).scalar(),
            "version": conn.execute(text("SHOW server_version")).scalar(),
            "size_bytes": conn.execute(text("SELECT pg_database_size(current_database())")).scalar(),
            "shared_buffers": conn.execute(text("SHOW shared_buffers")).scalar(),
            "work_mem": conn.execute(text("SHOW work_mem")).scalar(),
        }
        out["tables"] = [dict(r._mapping) for r in conn.execute(_TABLE_SIZES)]
        out["indexes"] = [dict(r._mapping) for r in conn.execute(_INDEX_SIZES, {"top": top})]
        tables = {t["table"] for t in out["tables"]}
        if "run_events" in tables:
            out["run_events_by_type"] = [dict(r._mapping) for r in conn.execute(_EVENT_TYPES)]
        if "spans" in tables:
            try:
                rows = conn.execute(_SPAN_SCOPES, {"pct": sample_pct}).fetchall()
                out["spans_by_scope_sample"] = {"sample_pct": sample_pct, "rows": [dict(r._mapping) for r in rows]}
            except Exception as exc:  # json vs jsonb operator support differs
                conn.rollback()
                out["spans_by_scope_sample"] = {"error": str(exc).splitlines()[0]}
        try:
            out["top_statements"] = [dict(r._mapping) for r in conn.execute(_STATEMENTS, {"top": top})]
        except Exception as exc:
            conn.rollback()
            out["top_statements"] = {"error": str(exc).splitlines()[0]}
        out["partitions"] = [dict(r._mapping) for r in conn.execute(_PARTITIONS)]
    return out


def render(stats: Dict[str, Any], *, top: int = 15) -> str:
    lines: List[str] = []
    db = stats["database"]
    lines.append(f"database {db['name']}  pg {db['version']}  size {_fmt(db['size_bytes'])}  shared_buffers={db['shared_buffers']} work_mem={db['work_mem']}")
    lines.append("")
    lines.append(f"{'table':38} {'total':>11} {'heap':>11} {'toast':>11} {'indexes':>11} {'live rows':>12} {'dead rows':>10}")
    for t in stats["tables"][:top]:
        lines.append(f"{t['table']:38} {_fmt(t['total_bytes']):>11} {_fmt(t['heap_bytes']):>11} {_fmt(t['toast_bytes']):>11} {_fmt(t['index_bytes']):>11} {t['live_rows']:>12,} {t['dead_rows']:>10,}")
    if stats.get("run_events_by_type"):
        lines.append("")
        lines.append(f"run_events by type          {'rows':>12} {'payload':>11}")
        for r in stats["run_events_by_type"]:
            lines.append(f"  {r['type']:26} {r['rows']:>12,} {_fmt(r['payload_bytes']):>11}")
    scopes = stats.get("spans_by_scope_sample") or {}
    if scopes.get("rows"):
        lines.append("")
        lines.append(f"spans by scope/kind ({scopes['sample_pct']}% sample)  {'rows':>10} {'attr bytes':>12}")
        for r in scopes["rows"]:
            lines.append(f"  {r['usage_scope']:8} {r['oi_kind']:10}            {r['rows']:>10,} {_fmt(r['attr_bytes']):>12}")
    if stats.get("indexes"):
        lines.append("")
        lines.append(f"{'index':46} {'table':24} {'size':>11} {'scans':>10}")
        for i in stats["indexes"][:top]:
            lines.append(f"{i['index']:46} {i['table']:24} {_fmt(i['bytes']):>11} {i['scans']:>10,}")
    if stats.get("partitions"):
        lines.append("")
        lines.append("partitions")
        for p in stats["partitions"]:
            lines.append(f"  {p['parent']:14} {p['partition']:28} {_fmt(p['bytes']):>11}  {p['bounds']}")
    ts = stats.get("top_statements")
    if isinstance(ts, list) and ts:
        lines.append("")
        lines.append(f"top statements by total time   {'calls':>9} {'total ms':>10} {'mean ms':>9}")
        for s in ts:
            lines.append(f"  {s['calls']:>9,} {s['total_ms']:>10,} {s['mean_ms']:>9}  {s['query']}")
    elif isinstance(ts, dict):
        lines.append("")
        lines.append(f"pg_stat_statements unavailable: {ts['error']}")
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("QYM_TEST_POSTGRES_URL") or os.environ.get("QYM_DATABASE_URL"))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--top", type=int, default=15)
    parser.add_argument("--sample-pct", type=float, default=5.0, help="TABLESAMPLE percent for the spans breakdown")
    args = parser.parse_args(argv)
    if not args.url:
        parser.error("--url or QYM_DATABASE_URL required")
    stats = collect(create_engine(args.url), top=args.top, sample_pct=args.sample_pct)
    if args.json:
        json.dump(stats, sys.stdout, indent=2, default=str)
    else:
        print(render(stats, top=args.top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
