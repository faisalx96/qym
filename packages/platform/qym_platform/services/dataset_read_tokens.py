"""Dataset read tokens: per-project service tokens for private test set reads.

The Evaluation Service runs an experiment with the submitting user's API key, so
the run belongs to that user. A non-admin's key can't read a private test set's
items, which would block experiments on one. A dataset read token closes that
gap without changing who the run belongs to:

- Only platform admins issue, list and revoke tokens (``api/projects.py``).
- A token belongs to one project. It is sent in ``X-Qym-Dataset-Read-Token``
  next to the user's API key; the key still authenticates and picks the project.
- It only lifts the private test set block on dataset item *reads* in its own
  project (``api/datasets.py``). It identifies no user and grants nothing else.
- Only the PBKDF2 hash is stored; the raw token is returned once at creation.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from typing import Optional

from sqlalchemy.orm import Session

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import DatasetReadToken
from qym_platform.log import get_logger
from qym_platform.security import hash_api_key, verify_api_key

logger = get_logger(__name__)

HEADER = "X-Qym-Dataset-Read-Token"
TOKEN_PREFIX = "qym_dr_"
_PREFIX_LEN = 16  # dataset_read_tokens.prefix

# Verified tokens, so paging through a large set doesn't redo PBKDF2 per page.
_CACHE_TTL_SECONDS = 60.0
_CACHE_MAX = 1024
_cache: dict[str, tuple[str, float]] = {}
_cache_lock = threading.Lock()


def generate_token() -> tuple[str, str, bytes]:
    """A new token: ``(token, prefix, token_hash)``. The token is shown once."""
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    return token, token[:_PREFIX_LEN], hash_api_key(token)


def issue_token(db: Session, *, project_id: str, name: str, created_by_user_id: str) -> tuple[DatasetReadToken, str]:
    token, prefix, token_hash = generate_token()
    row = DatasetReadToken(
        project_id=project_id,
        name=name,
        prefix=prefix,
        token_hash=token_hash,
        created_by_user_id=created_by_user_id,
        created_at=utc_now_naive(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info(
        "dataset read token %s issued for project %s by user %s",
        row.id,
        project_id,
        created_by_user_id,
    )
    return row, token


def revoke_token(db: Session, row: DatasetReadToken) -> None:
    row.revoked_at = utc_now_naive()
    db.commit()
    clear_cache()
    logger.info("dataset read token %s of project %s revoked", row.id, row.project_id)


def token_grants_project(db: Session, token: Optional[str], project_id: str) -> bool:
    """Whether ``token`` is a live dataset read token of ``project_id``."""
    token = (token or "").strip()
    if not token.startswith(TOKEN_PREFIX):
        return False
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(digest)
    if hit and hit[1] > now:
        row = db.get(DatasetReadToken, hit[0])
        return bool(row and row.revoked_at is None and row.project_id == project_id)
    rows = (
        db.query(DatasetReadToken)
        .filter(
            DatasetReadToken.prefix == token[:_PREFIX_LEN],
            DatasetReadToken.project_id == project_id,
            DatasetReadToken.revoked_at.is_(None),
        )
        .all()
    )
    for row in rows:
        if verify_api_key(token, row.token_hash):
            with _cache_lock:
                if len(_cache) >= _CACHE_MAX:
                    _cache.clear()
                _cache[digest] = (row.id, now + _CACHE_TTL_SECONDS)
            return True
    return False


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
