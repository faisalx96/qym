"""Run bookmarks in groups: a user's saved runs, each with a markdown note,
filed in one of their bookmark groups.

A group is a named folder of its owner in a project; the owner may pin it
(pinned groups lead the owner's list, newest pin first). A bookmark is
``private`` (its author only) or ``public`` (every member of the project):
a group shows to other members when it holds a public bookmark, and they see
its public bookmarks only.

``GET`` / ``POST /api/projects/{project_slug}/bookmark-groups`` list and make
groups; ``GET`` / ``PATCH`` / ``DELETE /api/bookmark-groups/{group_id}`` read
one (with its visible bookmarks and their run ids, the runs list of the
group's page), rename / describe / pin it, and remove it with its bookmarks.
``PUT /api/runs/{run_id}/bookmark`` creates or updates the caller's bookmark
of a run (one per user and run; ``group_id`` files it, a new bookmark without
one goes to the caller's ``General`` group, created on demand) and ``DELETE``
removes it. ``GET /api/projects/{project_slug}/bookmarks`` lists the bookmarks
the caller may see; ``GET /api/runs/{run_id}/bookmarks`` is the run page's
view. Only the author changes a bookmark, only the owner a group. Writes go
through ``require_project_writable``, so a Viewer (403, C033) and an archived
project (409) are refused; a run the caller cannot view answers 404 like the
run routes (C057).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    BookmarkGroup,
    BookmarkVisibility,
    Project,
    Run,
    RunBookmark,
    User,
)
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import (
    can_view_run,
    project_for_read_by_slug,
    require_project_writable,
)
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

logger = get_logger(__name__)

router = APIRouter()

NOTE_MAX_CHARS = 20_000
GROUP_NAME_MAX = 120
GROUP_DESCRIPTION_MAX = 4_000
LIST_PAGE_MAX = 200
DEFAULT_GROUP_NAME = "General"
GROUP_OWNER_DETAIL = "Only the group's owner changes it"


class BookmarkWrite(BaseModel):
    """Fields of the caller's bookmark to set; an omitted field keeps its value."""

    group_id: Optional[str] = Field(default=None, min_length=1, max_length=36)
    visibility: Optional[BookmarkVisibility] = None
    note: Optional[str] = Field(default=None, max_length=NOTE_MAX_CHARS)


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=GROUP_NAME_MAX)
    description: str = Field(default="", max_length=GROUP_DESCRIPTION_MAX)


class GroupPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=GROUP_NAME_MAX)
    description: Optional[str] = Field(default=None, max_length=GROUP_DESCRIPTION_MAX)
    pinned: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


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


def _users_by_id(db: Session, user_ids: set[str]) -> Dict[str, User]:
    if not user_ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}


def _payload(
    bookmark: RunBookmark,
    run: Run,
    *,
    author: Optional[User],
    project: Optional[Project],
    group: Optional[BookmarkGroup],
    viewer_id: str,
) -> Dict[str, Any]:
    return {
        "id": bookmark.id,
        "run_id": bookmark.run_id,
        "project_id": bookmark.project_id,
        "project_slug": project.slug if project else None,
        "project_name": project.name if project else None,
        "group": (
            {"id": group.id, "name": group.name}
            if group
            else {"id": bookmark.group_id, "name": ""}
        ),
        "visibility": bookmark.visibility.value,
        "note": bookmark.note or "",
        "created_at": to_api_timestamp(bookmark.created_at),
        "updated_at": to_api_timestamp(bookmark.updated_at),
        "is_mine": bookmark.user_id == viewer_id,
        "user": _user_brief(author, bookmark.user_id),
        "run": _run_brief(run),
    }


def _group_payload(
    group: BookmarkGroup,
    *,
    owner: Optional[User],
    project: Optional[Project],
    viewer_id: str,
    counts: Dict[str, int],
) -> Dict[str, Any]:
    mine = group.owner_user_id == viewer_id
    return {
        "id": group.id,
        "project_id": group.project_id,
        "project_slug": project.slug if project else None,
        "name": group.name,
        "description": group.description or "",
        # A pin is the owner's: it orders their own list and shows on their cards only.
        "pinned": bool(group.pinned) if mine else False,
        "pinned_at": to_api_timestamp(group.pinned_at) if mine else None,
        "is_mine": mine,
        "owner": _user_brief(owner, group.owner_user_id),
        # Bookmarks the viewer may see in it (all of the owner's own; others' public ones).
        "bookmark_count": int(counts.get(group.id, 0)),
        "created_at": to_api_timestamp(group.created_at),
        "updated_at": to_api_timestamp(group.updated_at),
    }


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _visible(me: str):
    """The bookmarks the caller may see: their own and everyone's public ones."""
    return or_(
        RunBookmark.user_id == me, RunBookmark.visibility == BookmarkVisibility.PUBLIC
    )


def _visible_counts(db: Session, me: str, group_ids: List[str]) -> Dict[str, int]:
    """Visible bookmarks of active runs per group id."""
    if not group_ids:
        return {}
    rows = (
        db.query(RunBookmark.group_id, func.count(RunBookmark.id))
        .join(Run, Run.id == RunBookmark.run_id)
        .filter(
            RunBookmark.group_id.in_(group_ids),
            Run.deleted_at.is_(None),
            _visible(me),
        )
        .group_by(RunBookmark.group_id)
    )
    return {group_id: int(n) for group_id, n in rows}


def _group_for_caller(
    db: Session, principal: Principal, group_id: str, *, write: bool = False
) -> BookmarkGroup:
    """The group when the caller may see it: the owner always, another member
    only when it holds a public bookmark of an active run; else 404. A
    non-member is refused as the project read refuses them (403). With
    ``write`` the project must take changes (a Viewer 403, an archived
    project 409, checked first) and the caller must own the group (403)."""
    group = db.get(BookmarkGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Bookmark group not found")
    project = db.query(Project).filter(Project.id == group.project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Bookmark group not found")
    project_for_read_by_slug(db, principal, project.slug)
    if write:
        require_project_writable(db, group.project_id)
    me = principal.user.id
    if group.owner_user_id != me:
        if write:
            raise HTTPException(status_code=403, detail=GROUP_OWNER_DETAIL)
        shared = (
            db.query(RunBookmark.id)
            .join(Run, Run.id == RunBookmark.run_id)
            .filter(
                RunBookmark.group_id == group.id,
                RunBookmark.visibility == BookmarkVisibility.PUBLIC,
                Run.deleted_at.is_(None),
            )
            .first()
        )
        if shared is None:
            raise HTTPException(status_code=404, detail="Bookmark group not found")
    return group


def _default_group(db: Session, project_id: str, user_id: str) -> BookmarkGroup:
    """The caller's General group in the project, created on first use."""
    group = (
        db.query(BookmarkGroup)
        .filter(
            BookmarkGroup.project_id == project_id,
            BookmarkGroup.owner_user_id == user_id,
            BookmarkGroup.name == DEFAULT_GROUP_NAME,
        )
        .first()
    )
    if group is None:
        group = BookmarkGroup(
            project_id=project_id, owner_user_id=user_id, name=DEFAULT_GROUP_NAME
        )
        db.add(group)
        db.flush()
    return group


def _name_taken(
    db: Session, project_id: str, user_id: str, name: str, *, except_id: Optional[str]
) -> bool:
    query = db.query(BookmarkGroup.id).filter(
        BookmarkGroup.project_id == project_id,
        BookmarkGroup.owner_user_id == user_id,
        func.lower(BookmarkGroup.name) == name.lower(),
    )
    if except_id:
        query = query.filter(BookmarkGroup.id != except_id)
    return query.first() is not None


# Newest bookmark first.
def _list_order():
    return (RunBookmark.created_at.desc(), RunBookmark.id.asc())


# The owner's pinned groups first (newest pin first), then by name.
def _group_order():
    return (
        BookmarkGroup.pinned.desc(),
        # Every pinned group has a stamp and no unpinned one does, so NULL ordering never mixes them.
        BookmarkGroup.pinned_at.desc(),
        func.lower(BookmarkGroup.name).asc(),
        BookmarkGroup.id.asc(),
    )


# ── Groups ────────────────────────────────────────────────────────────────────


@router.get("/api/projects/{project_slug}/bookmark-groups")
def list_groups(
    project_slug: str,
    scope: Literal["all", "mine"] = Query(default="all"),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The caller's groups (every one, pinned first) and, with ``scope=all``,
    the other members' groups that hold a public bookmark of an active run."""
    project = project_for_read_by_slug(db, principal, project_slug)
    me = principal.user.id
    mine = (
        db.query(BookmarkGroup)
        .filter(
            BookmarkGroup.project_id == project.id, BookmarkGroup.owner_user_id == me
        )
        .order_by(*_group_order())
        .all()
    )
    others: List[BookmarkGroup] = []
    if scope == "all":
        shared_ids = {
            group_id
            for (group_id,) in db.query(RunBookmark.group_id)
            .join(Run, Run.id == RunBookmark.run_id)
            .filter(
                RunBookmark.project_id == project.id,
                RunBookmark.user_id != me,
                RunBookmark.visibility == BookmarkVisibility.PUBLIC,
                Run.deleted_at.is_(None),
            )
            .distinct()
        }
        if shared_ids:
            others = (
                db.query(BookmarkGroup)
                .filter(BookmarkGroup.id.in_(shared_ids))
                .order_by(func.lower(BookmarkGroup.name).asc(), BookmarkGroup.id.asc())
                .all()
            )
    groups = mine + others
    counts = _visible_counts(db, me, [g.id for g in groups])
    users = _users_by_id(db, {g.owner_user_id for g in groups})
    return {
        "project_id": project.id,
        "project_slug": project.slug,
        "scope": scope,
        "groups": [
            _group_payload(
                g,
                owner=users.get(g.owner_user_id),
                project=project,
                viewer_id=me,
                counts=counts,
            )
            for g in groups
        ],
    }


@router.post("/api/projects/{project_slug}/bookmark-groups", status_code=201)
def create_group(
    project_slug: str,
    body: GroupCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Make a group of the caller's in the project; a name they already use answers 409."""
    project = project_for_read_by_slug(db, principal, project_slug)
    require_project_writable(db, project.id)
    me = principal.user.id
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Give the group a name")
    if _name_taken(db, project.id, me, name, except_id=None):
        raise HTTPException(
            status_code=409, detail="You already have a group with this name"
        )
    group = BookmarkGroup(
        project_id=project.id,
        owner_user_id=me,
        name=name,
        description=body.description.strip(),
    )
    db.add(group)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="You already have a group with this name"
        ) from None
    db.refresh(group)
    logger.info("Bookmark group %s created by user %s", group.id, me)
    return _group_payload(
        group, owner=principal.user, project=project, viewer_id=me, counts={}
    )


@router.get("/api/bookmark-groups/{group_id}")
def get_group(
    group_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """One group with the bookmarks the caller may see in it (newest first)
    and ``run_ids``, the active runs those bookmarks are of: the group's page
    shows them in the runs list."""
    group = _group_for_caller(db, principal, group_id)
    me = principal.user.id
    project = db.query(Project).filter(Project.id == group.project_id).first()
    rows = (
        db.query(RunBookmark, Run)
        .join(Run, Run.id == RunBookmark.run_id)
        .filter(
            RunBookmark.group_id == group.id, Run.deleted_at.is_(None), _visible(me)
        )
        .order_by(*_list_order())
        .all()
    )
    users = _users_by_id(db, {group.owner_user_id} | {b.user_id for b, _ in rows})
    payload = _group_payload(
        group,
        owner=users.get(group.owner_user_id),
        project=project,
        viewer_id=me,
        counts={group.id: len(rows)},
    )
    payload["run_ids"] = [run.id for _, run in rows]
    payload["bookmarks"] = [
        _payload(
            bookmark,
            run,
            author=users.get(bookmark.user_id),
            project=project,
            group=group,
            viewer_id=me,
        )
        for bookmark, run in rows
    ]
    return payload


@router.patch("/api/bookmark-groups/{group_id}")
def update_group(
    group_id: str,
    body: GroupPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Rename, describe or pin the caller's own group. Pinning stamps
    ``pinned_at`` so the newest pin leads; unpinning clears it."""
    group = _group_for_caller(db, principal, group_id, write=True)
    me = principal.user.id
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Give the group a name")
        if _name_taken(db, group.project_id, me, name, except_id=group.id):
            raise HTTPException(
                status_code=409, detail="You already have a group with this name"
            )
        group.name = name
    if body.description is not None:
        group.description = body.description.strip()
    if body.pinned is not None and body.pinned != bool(group.pinned):
        group.pinned = body.pinned
        group.pinned_at = utc_now_naive() if body.pinned else None
    group.updated_at = utc_now_naive()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="You already have a group with this name"
        ) from None
    db.refresh(group)
    project = db.query(Project).filter(Project.id == group.project_id).first()
    counts = _visible_counts(db, me, [group.id])
    return _group_payload(
        group, owner=principal.user, project=project, viewer_id=me, counts=counts
    )


@router.delete("/api/bookmark-groups/{group_id}")
def delete_group(
    group_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Remove the caller's own group with every bookmark in it; the runs stay."""
    group = _group_for_caller(db, principal, group_id, write=True)
    removed = (
        db.query(RunBookmark)
        .filter(RunBookmark.group_id == group.id)
        .delete(synchronize_session=False)
    )
    db.delete(group)
    db.commit()
    logger.info(
        "Bookmark group %s removed by user %s (%s bookmarks)",
        group_id,
        principal.user.id,
        removed,
    )
    return {"ok": True, "bookmarks_removed": int(removed)}


# ── Bookmarks ─────────────────────────────────────────────────────────────────


@router.get("/api/projects/{project_slug}/bookmarks")
def list_project_bookmarks(
    project_slug: str,
    response: Response,
    scope: Literal["all", "mine"] = Query(default="all"),
    group_id: Optional[str] = Query(default=None, max_length=36),
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=LIST_PAGE_MAX, ge=1, le=LIST_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The project's bookmarks the caller may see, newest first.

    ``scope=all`` (default) is the caller's own bookmarks and everyone's public
    ones; ``scope=mine`` only the caller's; ``group_id`` one group. ``q``
    narrows by run name, run id or note. Bookmarks of deleted runs are left
    out. ``X-Qym-Total-Count`` carries how many match.
    """
    project = project_for_read_by_slug(db, principal, project_slug)
    me = principal.user.id
    query = (
        db.query(RunBookmark, Run)
        .join(Run, Run.id == RunBookmark.run_id)
        .filter(RunBookmark.project_id == project.id, Run.deleted_at.is_(None))
    )
    query = (
        query.filter(RunBookmark.user_id == me)
        if scope == "mine"
        else query.filter(_visible(me))
    )
    if group_id:
        query = query.filter(RunBookmark.group_id == group_id)
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
    groups = {
        g.id: g
        for g in db.query(BookmarkGroup).filter(
            BookmarkGroup.id.in_({bookmark.group_id for bookmark, _ in rows} or {""})
        )
    }
    return {
        "project_id": project.id,
        "project_slug": project.slug,
        "scope": scope,
        "total": total,
        "bookmarks": [
            _payload(
                bookmark,
                run,
                author=users.get(bookmark.user_id),
                project=project,
                group=groups.get(bookmark.group_id),
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
        .filter(RunBookmark.run_id == run.id, _visible(me))
        .order_by(RunBookmark.created_at.asc(), RunBookmark.id.asc())
        .all()
    )
    project = db.query(Project).filter(Project.id == run.project_id).first()
    users = _users_by_id(db, {b.user_id for b in rows})
    groups = {
        g.id: g
        for g in db.query(BookmarkGroup).filter(
            BookmarkGroup.id.in_({b.group_id for b in rows} or {""})
        )
    }
    mine = next((b for b in rows if b.user_id == me), None)
    return {
        "run_id": run.id,
        "mine": (
            _payload(
                mine,
                run,
                author=users.get(me),
                project=project,
                group=groups.get(mine.group_id),
                viewer_id=me,
            )
            if mine
            else None
        ),
        "others": [
            _payload(
                b,
                run,
                author=users.get(b.user_id),
                project=project,
                group=groups.get(b.group_id),
                viewer_id=me,
            )
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

    A new bookmark starts private and without a note, in ``group_id`` (one of
    the caller's groups in the run's project) or, without one, in the
    caller's ``General`` group, created on demand. The body sets any of
    ``group_id`` (moves the bookmark), ``visibility`` and ``note``.
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
    group: Optional[BookmarkGroup] = None
    if body.group_id is not None:
        group = db.get(BookmarkGroup, body.group_id)
        if (
            group is None
            or group.owner_user_id != me
            or group.project_id != run.project_id
        ):
            raise HTTPException(
                status_code=422, detail="Choose one of your groups in this project"
            )
    elif created:
        group = _default_group(db, run.project_id, me)
    if bookmark is None:
        bookmark = RunBookmark(
            run_id=run.id, project_id=run.project_id, user_id=me, group_id=group.id  # type: ignore[union-attr]
        )
        db.add(bookmark)
    elif group is not None:
        bookmark.group_id = group.id
    if body.visibility is not None:
        bookmark.visibility = body.visibility
    if body.note is not None:
        bookmark.note = body.note.rstrip()
    try:
        db.commit()
    except IntegrityError:
        # The same user bookmarked the run from another tab at the same time.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The bookmark changed at the same time; reload and retry",
        ) from None
    db.refresh(bookmark)
    project = db.query(Project).filter(Project.id == run.project_id).first()
    group = group or db.get(BookmarkGroup, bookmark.group_id)
    if created:
        response.status_code = 201
        logger.info("Run %s bookmarked by user %s", run.id, me)
    return _payload(
        bookmark, run, author=principal.user, project=project, group=group, viewer_id=me
    )


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
