"""Re-encrypt every stored secret with the current encryption key (key rotation).

After a rotation ``QYM_LLM_CONFIG_ENCRYPTION_KEY`` holds the new key and
``QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS`` the old one(s). Stored values keep
decrypting through the previous keys; this command rewrites them with the current
key so the previous keys can be dropped. Columns covered:

- ``project_llm_connections.llm_api_key_encrypted`` (project LLM connections)
- ``eval_environments.api_key_encrypted`` (Evaluation Service keys)
- ``eval_experiments.secrets_encrypted`` (temporary-model keys of live experiments)
- ``eval_experiments.qym_api_key_encrypted`` (the creator's per-experiment qym API
  key of live experiments; rewriting it only changes the blob, never the key)

It is idempotent: values that already decrypt with the current key are left alone,
so re-running it rewrites nothing. Each batch is committed separately, and a row is
only updated if its value hasn't changed since it was read. Plaintext never leaves
``qym_platform.secrets`` and nothing secret is printed.

Usage (from repo root)::

    QYM_DATABASE_URL=postgresql+psycopg2://qym:qym@localhost:5432/qym \\
      QYM_LLM_CONFIG_ENCRYPTION_KEY=<new> \\
      QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS=<old> \\
      PYTHONPATH=packages/platform \\
      python -m qym_platform.tools.reencrypt_llm_keys [--dry-run]

Prints one JSON object: per column ``{"scanned", "already_current", "reencrypted",
"failed", "failed_ids", "skipped_changed"}`` plus totals. With ``--dry-run``
``reencrypted`` counts what would be rewritten. Exit codes: 0 success, 1 some values
could not be decrypted with any configured key, 2 encryption not configured.
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Callable, Dict, Optional, Sequence, Tuple

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from qym_platform.db.models import EvalEnvironment, EvalExperiment, ProjectLlmConnection
from qym_platform.secrets import (
    encryption_available,
    is_encrypted_with_current_key,
    reencrypt_llm_api_key,
)
from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)

# (label, model, column attribute name)
ENCRYPTED_COLUMNS: Tuple[Tuple[str, Any, str], ...] = (
    ("project_llm_connections.llm_api_key_encrypted", ProjectLlmConnection, "llm_api_key_encrypted"),
    ("eval_environments.api_key_encrypted", EvalEnvironment, "api_key_encrypted"),
    ("eval_experiments.secrets_encrypted", EvalExperiment, "secrets_encrypted"),
    ("eval_experiments.qym_api_key_encrypted", EvalExperiment, "qym_api_key_encrypted"),
)

_MAX_FAILED_IDS = 50


def _empty_stats() -> Dict[str, Any]:
    return {
        "scanned": 0,
        "already_current": 0,
        "reencrypted": 0,
        "failed": 0,
        "failed_ids": [],
        "skipped_changed": 0,
    }


def reencrypt_column(
    db: Session,
    model: Any,
    attr: str,
    *,
    settings: PlatformSettings,
    dry_run: bool = False,
    batch_size: int = 200,
) -> Dict[str, Any]:
    """Re-encrypt one column in id-ordered batches, committing after each batch."""
    stats = _empty_stats()
    column = getattr(model, attr)
    last_id: Optional[str] = None
    while True:
        query = select(model.id, column).where(column.isnot(None), column != "")
        if last_id is not None:
            query = query.where(model.id > last_id)
        rows = db.execute(query.order_by(model.id).limit(batch_size)).all()
        if not rows:
            break
        for row_id, value in rows:
            stats["scanned"] += 1
            if is_encrypted_with_current_key(value, settings):
                stats["already_current"] += 1
                continue
            try:
                new_value = reencrypt_llm_api_key(value, settings)
            except RuntimeError:
                logger.warning("could not re-encrypt stored LLM key (row %s); left unchanged", row_id)
                stats["failed"] += 1
                if len(stats["failed_ids"]) < _MAX_FAILED_IDS:
                    stats["failed_ids"].append(row_id)
                continue
            if dry_run:
                stats["reencrypted"] += 1
                continue
            # Only if nobody replaced the value since it was read.
            result = db.execute(
                update(model)
                .where(model.id == row_id, column == value)
                .values({attr: new_value})
                .execution_options(synchronize_session=False)
            )
            if result.rowcount:
                stats["reencrypted"] += 1
            else:
                stats["skipped_changed"] += 1
        if dry_run:
            db.rollback()
        else:
            db.commit()
        last_id = rows[-1][0]
    return stats


def reencrypt_all(
    db: Session,
    *,
    settings: Optional[PlatformSettings] = None,
    dry_run: bool = False,
    batch_size: int = 200,
) -> Dict[str, Any]:
    runtime_settings = settings or PlatformSettings()
    columns: Dict[str, Any] = {}
    totals = _empty_stats()
    del totals["failed_ids"]
    for label, model, attr in ENCRYPTED_COLUMNS:
        stats = reencrypt_column(
            db,
            model,
            attr,
            settings=runtime_settings,
            dry_run=dry_run,
            batch_size=batch_size,
        )
        columns[label] = stats
        for key in totals:
            totals[key] += stats[key]
    return {"dry_run": dry_run, "columns": columns, "totals": totals}


def main(
    argv: Optional[Sequence[str]] = None,
    session_factory: Optional[Callable[[], Session]] = None,
    settings: Optional[PlatformSettings] = None,
) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m qym_platform.tools.reencrypt_llm_keys",
        description="Re-encrypt stored LLM/Evaluation Service keys with the current key (idempotent).",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Count what would change; write nothing."
    )
    parser.add_argument(
        "--batch-size", type=int, default=200, help="Rows per commit (default 200)."
    )
    args = parser.parse_args(argv)
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")

    runtime_settings = settings or PlatformSettings()
    if not encryption_available(runtime_settings):
        print(
            json.dumps({"error": "QYM_LLM_CONFIG_ENCRYPTION_KEY is not configured"}),
        )
        return 2

    if session_factory is None:
        from qym_platform.db.session import SessionLocal

        session_factory = SessionLocal

    try:
        with session_factory() as db:
            stats = reencrypt_all(
                db,
                settings=runtime_settings,
                dry_run=args.dry_run,
                batch_size=args.batch_size,
            )
    except RuntimeError as exc:
        # e.g. a malformed key; the message names the setting, never the key.
        logger.error("LLM key re-encryption aborted", exc_info=True)
        print(json.dumps({"error": str(exc)}))
        return 2
    print(json.dumps(stats, sort_keys=True))
    return 1 if stats["totals"]["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
