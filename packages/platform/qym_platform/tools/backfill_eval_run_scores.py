"""Backfill ``eval_run_scores`` for existing official runs (plan §4.7, issue #36).

Migration ``0064`` only creates the table. This command fills it for official runs
that were already scored before it existed, and repairs rows a failed hook missed.
It recomputes each official, linked run from its scores and replaces its rows, so it
is idempotent and safe to re-run at any time (runs that aren't scorable yet end with
no rows; the completion hook writes them later).

Usage (from repo root)::

    QYM_DATABASE_URL=postgresql+psycopg2://qym:qym@localhost:5432/qym \\
      PYTHONPATH=packages/platform \\
      python -m qym_platform.tools.backfill_eval_run_scores [--project-slug SLUG]

Prints a JSON summary ``{"runs", "scored_runs", "rows", "failed"}`` to stdout.
Exit codes: 0 success, 1 some runs failed, 3 unknown project.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Callable, Optional, Sequence

from sqlalchemy.orm import Session

from qym_platform.db.models import Project
from qym_platform.services.eval_run_scores import backfill_run_scores


def main(
    argv: Optional[Sequence[str]] = None,
    session_factory: Optional[Callable[[], Session]] = None,
) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m qym_platform.tools.backfill_eval_run_scores",
        description="Recompute eval_run_scores for official runs (idempotent).",
    )
    parser.add_argument(
        "--project-slug", default=None, help="Only runs of this project."
    )
    parser.add_argument(
        "--batch-size", type=int, default=200, help="Runs per commit (default 200)."
    )
    args = parser.parse_args(argv)
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")

    if session_factory is None:
        from qym_platform.db.session import SessionLocal

        session_factory = SessionLocal

    with session_factory() as db:
        project_id = None
        if args.project_slug:
            project = (
                db.query(Project).filter(Project.slug == args.project_slug).first()
            )
            if project is None:
                print(f"Unknown project: {args.project_slug}", file=sys.stderr)
                return 3
            project_id = project.id
        stats = backfill_run_scores(
            db, project_id=project_id, batch_size=args.batch_size
        )
    print(json.dumps(stats, sort_keys=True))
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
