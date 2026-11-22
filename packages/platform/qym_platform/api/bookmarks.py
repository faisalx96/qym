"""Run bookmarks: a user's saved runs, each with a markdown note.

``PUT /api/runs/{run_id}/bookmark`` creates or updates the caller's bookmark
of a run (one per user and run) and ``DELETE`` removes it. A bookmark is
``private`` (its author only) or ``public`` (every member of the project), and
``pinned`` bookmarks lead every list, newest pin first.
``GET /api/projects/{project_slug}/bookmarks`` lists the project's bookmarks
the caller may see; ``GET /api/runs/{run_id}/bookmarks`` is the run page's
view: the caller's own bookmark and the public ones of others. Only the
author changes a bookmark. Writes go through ``require_project_writable``,
so a Viewer (403, C033) and an archived project (409) are refused; a run the
caller cannot view answers 404 like the run routes (C057).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (BookmarkVisibility, Project, Run,
                                    RunBookmark, User)
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import (can_view_run, project_for_read_by_slug,
                                      require_project_writable)
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

logger = get_logger(__name__)

router = APIRouter()

NOTE_MAX_CHARS = 20_000
LIST_PAGE_MAX = 200


class BookmarkWrite(BaseModel):
    """Fields of the caller's bookmark to set; an omitted field keeps its value."""

    visibility: Optional[BookmarkVisibility] = None
    note: Optional[str] = Field(default=None, max_length=NOTE_MAX_CHARS)
    pinned: Optional[bool] = None


def _run_for_caller(db: Session, principal: Principal, run_id: str) -> Run:
    run = Run.active(db).filter(Run.id == run_id).first()
    # A missing run and one the caller cannot view both answer 404 (C057).
    if not run or not can_view_run(db, principal, run):
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _run_name(run: Run) -> str:
    name = ""
    if isinstance(run.run_config, dict):
        name = str(run.run_config.get("run_name") or "")
    return name or run.external_run_id or ""


def _run_brief(run: Run) -> Dict[str, Any]:
    return {
        "run_id": run.id,
        "run_name": _run_name(run),
        "external_run_id": run.external_run_id,
        "task": run.task,
        "dataset": run.dataset,
        "model": run.model,
        "status": run.status.value if run.status else None,
        "origin": run.origin.value if run.origin else None,
        "owner_user_id": run.owner_user_id,
        "created_at": to_api_timestamp(run.created_at),
        "started_at": to_api_timestamp(run.started_at),
        "ended_at": to_api_timestamp(run.ended_at),
    }


def _user_brief(user: Optional[User], user_id: str) -> Dict[str, Any]:
    if user is None:
        return {"id": user_id, "display_name": "", "email": ""}
    return {"id": user.id, "display_name": user.display_name or "", "email": user.email}


def _payload(
    bookmark: RunBookmark,
    run: Run,
    *,
    author: Optional[User],
    project: Optional[Project],
    viewer_id: str,
) -> Dict[str, Any]:
    return {
        "id": bookmark.id,
        "run_id": bookmark.run_id,
        "project_id": bookmark.project_id,
        "project_slug": project.slug if project else None,
        "project_name": project.name if project else None,
        "visibility": bookmark.visibility.value,
        "note": bookmark.note or "",
        "pinned": bool(bookmark.pinned),
        "pinned_at": to_api_timestamp(bookmark.pinned_at),
        "created_at": to_api_timestamp(bookmark.created_at),
        "updated_at": to_api_timestamp(bookmark.updated_at),
        "is_mine": bookmark.user_id == viewer_id,
        "user": _user_brief(author, bookmark.user_id),
        "run": _run_brief(run),
    }


def _users_by_id(db: Session, user_ids: set[str]) -> Dict[str, User]:
    if not user_ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


# Pinned bookmarks first, the newest pin first among them, then the newest
# bookmark; coalesce keeps NULL pinned_at out of the dialects' NULL ordering.
def _list_order():
    return (
        RunBookmark.pinned.desc(),
        func.coalesce(RunBookmark.pinned_at, RunBookmark.created_at).desc(),
        RunBookmark.created_at.desc(),
        RunBookmark.id.asc(),
    )


@router.get("/api/projects/{project_slug}/bookmarks")
def list_project_bookmarks(
    project_slug: str,
    response: Response,
    scope: Literal["all", "mine"] = Query(default="all"),
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=LIST_PAGE_MAX, ge=1, le=LIST_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The project's bookmarks the caller may see, pinned first.

    ``scope=all`` (default) is the caller's own bookmarks and everyone's public
    ones; ``scope=mine`` only the caller's. ``q`` narrows by run name, run id or
    note. Bookmarks of deleted runs are left out. ``X-Qym-Total-Count`` carries
    how many match.
    """
    project = project_for_read_by_slug(db, principal, project_slug)
    me = principal.user.id
    query = (
        db.query(RunBookmark, Run)
        .join(Run, Run.id == RunBookmark.run_id)
        .filter(RunBookmark.project_id == project.id, Run.deleted_at.is_(None))
    )
    if scope == "mine":
        query = query.filter(RunBookmark.user_id == me)
    else:
        query = query.filter(
            or_(
                RunBookmark.user_id == me,
                RunBookmark.visibility == BookmarkVisibility.PUBLIC,
            )
        )
    term = (q or "").strip().lower()
    if term:
        pattern = _like(term)
        run_name = func.coalesce(Run.run_config["run_name"].as_string(), "")
        query = query.filter(
            or_(
                func.lower(run_name).like(pattern, escape="\\"),
                func.lower(func.coalesce(Run.external_run_id, "")).like(
                    pattern, escape="\\"
                ),
                func.lower(Run.id).like(pattern, escape="\\"),
                func.lower(RunBookmark.note).like(pattern, escape="\\"),
            )
        )
    total = query.order_by(None).count()
    response.headers["X-Qym-Total-Count"] = str(total)
    rows = query.order_by(*_list_order()).offset(offset).limit(limit).all()
    users = _users_by_id(db, {bookmark.user_id for bookmark, _ in rows})
    return {
        "project_id": project.id,
        "project_slug": project.slug,
        "scope": scope,
        "total": total,
        "pinned_count": sum(1 for bookmark, _ in rows if bookmark.pinned),
        "bookmarks": [
            _payload(
                bookmark,
                run,
                author=users.get(bookmark.user_id),
                project=project,
                viewer_id=me,
            )
            for bookmark, run in rows
        ],
    }


@router.get("/api/runs/{run_id}/bookmarks")
def run_bookmarks(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The run page's view: the caller's bookmark (``mine``, null when none)
    and the public bookmarks of other members (``others``, oldest first)."""
    run = _run_for_caller(db, principal, run_id)
    me = principal.user.id
    rows: List[RunBookmark] = (
        db.query(RunBookmark)
        .filter(
            RunBookmark.run_id == run.id,
            or_(
                RunBookmark.user_id == me,
                RunBookmark.visibility == BookmarkVisibility.PUBLIC,
            ),
        )
        .order_by(RunBookmark.created_at.asc(), RunBookmark.id.asc())
        .all()
    )
    project = db.query(Project).filter(Project.id == run.project_id).first()
    users = _users_by_id(db, {b.user_id for b in rows})
    mine = next((b for b in rows if b.user_id == me), None)
    return {
        "run_id": run.id,
        "mine": (
            _payload(mine, run, author=users.get(me), project=project, viewer_id=me)
            if mine
            else None
        ),
        "others": [
            _payload(b, run, author=users.get(b.user_id), project=project, viewer_id=me)
            for b in rows
            if b.user_id != me
        ],
    }


@router.put("/api/runs/{run_id}/bookmark")
def save_bookmark(
    run_id: str,
    body: BookmarkWrite,
    response: Response,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Create (201) or update (200) the caller's bookmark of the run.

    A new bookmark starts private, unpinned and without a note; the body sets
    any of ``visibility``, ``note`` and ``pinned``. Pinning stamps
    ``pinned_at`` so the newest pin leads; unpinning clears it.
    """
    run = _run_for_caller(db, principal, run_id)
    require_project_writable(db, run.project_id)
    me = principal.user.id
    bookmark = (
        db.query(RunBookmark)
        .filter(RunBookmark.run_id == run.id, RunBookmark.user_id == me)
        .first()
    )
    created = bookmark is None
    if bookmark is None:
        bookmark = RunBookmark(run_id=run.id, project_id=run.project_id, user_id=me)
        db.add(bookmark)
    if body.visibility is not None:
        bookmark.visibility = body.visibility
    if body.note is not None:
        bookmark.note = body.note.rstrip()
    if body.pinned is not None and body.pinned != bool(bookmark.pinned):
        bookmark.pinned = body.pinned
        bookmark.pinned_at = utc_now_naive() if body.pinned else None
    try:
        db.commit()
    except IntegrityError:
        # The same user bookmarked the run from another tab at the same time.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The bookmark changed at the same time; reload and retry",
        )
    db.refresh(bookmark)
    project = db.query(Project).filter(Project.id == run.project_id).first()
    if created:
        response.status_code = 201
        logger.info("Run %s bookmarked by user %s", run.id, me)
    return _payload(bookmark, run, author=principal.user, project=project, viewer_id=me)


@router.delete("/api/runs/{run_id}/bookmark")
def remove_bookmark(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Remove the caller's bookmark of the run; ``removed`` is false when there was none."""
    run = _run_for_caller(db, principal, run_id)
    require_project_writable(db, run.project_id)
    removed = (
        db.query(RunBookmark)
        .filter(RunBookmark.run_id == run.id, RunBookmark.user_id == principal.user.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "removed": bool(removed)}
