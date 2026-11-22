"""Run bookmarks in groups: one bookmark per user and run, private or public,
filed in one of the author's groups; pinning is the group's.

The fixture is the archived-project one (project ``pa``; ``mgr`` manages it,
``member`` is a member, ``outsider`` is not; runs ``r1``, ``r-review`` and the
deleted ``r-trash``; the member's group ``bg1`` General). The route-role and
archived-project suites cover the Viewer and archive refusals of the write
routes.
"""

from __future__ import annotations

from datetime import datetime

import pytest
import sqlalchemy as sa
import test_archived_project_read_only as arch
from alembic.migration import MigrationContext
from alembic.operations import Operations
from qym_platform.db.models import (Base, BookmarkGroup, BookmarkVisibility,
                                    Run, RunBookmark)
from test_archived_project_read_only import client  # noqa: F401 (fixtures)
from test_archived_project_read_only import session_factory
from test_migrations import _load_migration

MEMBER, MGR, OUTSIDER, ADMIN = arch.MEMBER, arch.MGR, arch.OUTSIDER, arch.ADMIN
BOOKMARK_TABLES = {"bookmark_groups", "run_bookmarks"}


def _save(client, run_id: str, headers, **body):
    return client.put(f"/api/runs/{run_id}/bookmark", json=body, headers=headers)


def _listed(client, headers, **params):
    response = client.get("/api/projects/pa/bookmarks", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _groups(client, headers, **params):
    response = client.get(
        "/api/projects/pa/bookmark-groups", params=params, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()["groups"]


def _new_group(client, headers, name, **body):
    return client.post(
        "/api/projects/pa/bookmark-groups", json={"name": name, **body}, headers=headers
    )


def test_a_bookmark_starts_private_and_empty_in_the_general_group(client):
    created = _save(client, "r1", MEMBER)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["run_id"] == "r1" and body["project_slug"] == "pa"
    assert body["visibility"] == "private" and body["note"] == ""
    assert body["group"] == {"id": "bg1", "name": "General"}
    assert body["is_mine"] is True and body["user"]["email"] == "member@x.com"
    assert body["run"]["run_name"] == "r1" and body["run"]["status"] == "COMPLETED"
    assert "pinned" not in body

    # Saving again updates the same bookmark (200), and an omitted field keeps its value.
    again = _save(client, "r1", MEMBER, note="## Keep\n\nthe baseline")
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    assert again.json()["note"] == "## Keep\n\nthe baseline"
    assert again.json()["visibility"] == "private"
    assert again.json()["group"]["id"] == "bg1"

    page = client.get("/api/runs/r1/bookmarks", headers=MEMBER).json()
    assert page["mine"]["id"] == body["id"] and page["others"] == []

    # A first bookmark of someone without a group makes their General group.
    first = _save(client, "r1", MGR)
    assert first.status_code == 201 and first.json()["group"]["name"] == "General"
    assert [g["name"] for g in _groups(client, MGR, scope="mine")] == ["General"]


def test_groups_are_made_named_pinned_and_removed_by_their_owner(client):
    made = _new_group(client, MEMBER, "  Baselines ", description=" release 4 ")
    assert made.status_code == 201, made.text
    group = made.json()
    assert group["name"] == "Baselines" and group["description"] == "release 4"
    assert (
        group["is_mine"] and group["pinned"] is False and group["bookmark_count"] == 0
    )
    assert group["owner"]["email"] == "member@x.com"
    # Names are unique per owner, whatever the case.
    assert _new_group(client, MEMBER, "baselines").status_code == 409
    assert _new_group(client, MEMBER, "   ").status_code == 422
    assert _new_group(client, MGR, "Baselines").status_code == 201

    # The bookmark goes into the chosen group and moves later.
    saved = _save(client, "r1", MEMBER, group_id=group["id"], note="n")
    assert saved.status_code == 201 and saved.json()["group"]["id"] == group["id"]
    moved = _save(client, "r1", MEMBER, group_id="bg1")
    assert moved.status_code == 200 and moved.json()["group"]["id"] == "bg1"
    assert moved.json()["note"] == "n"
    # Another owner's group, or one of another project, is refused.
    theirs = _groups(client, MGR, scope="mine")[0]["id"]
    assert _save(client, "r1", MEMBER, group_id=theirs).status_code == 422
    assert _save(client, "r1", MEMBER, group_id="nope").status_code == 422

    # Pinning stamps the time; the owner's list leads with pinned groups, newest pin first.
    pinned = client.patch(
        f"/api/bookmark-groups/{group['id']}", json={"pinned": True}, headers=MEMBER
    )
    assert (
        pinned.status_code == 200
        and pinned.json()["pinned"]
        and pinned.json()["pinned_at"]
    )
    stamp = pinned.json()["pinned_at"]
    renamed = client.patch(
        f"/api/bookmark-groups/{group['id']}",
        json={"name": "Release baselines", "description": ""},
        headers=MEMBER,
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Release baselines"
    assert renamed.json()["pinned_at"] == stamp
    assert [g["name"] for g in _groups(client, MEMBER, scope="mine")] == [
        "Release baselines",
        "General",
    ]
    unpinned = client.patch(
        f"/api/bookmark-groups/{group['id']}", json={"pinned": False}, headers=MEMBER
    ).json()
    assert unpinned["pinned"] is False and unpinned["pinned_at"] is None
    assert [g["name"] for g in _groups(client, MEMBER, scope="mine")] == [
        "General",
        "Release baselines",
    ]
    # A rename onto another of the owner's names is refused.
    assert (
        client.patch(
            f"/api/bookmark-groups/{group['id']}",
            json={"name": "general"},
            headers=MEMBER,
        ).status_code
        == 409
    )
    # Only the owner changes or removes a group.
    assert (
        client.patch(
            f"/api/bookmark-groups/{group['id']}", json={"pinned": True}, headers=MGR
        ).status_code
        == 403
    )
    assert (
        client.delete(f"/api/bookmark-groups/{group['id']}", headers=MGR).status_code
        == 403
    )
    # Removing a group takes its bookmarks with it; the runs stay.
    _save(client, "r-review", MEMBER, group_id=group["id"])
    removed = client.delete(f"/api/bookmark-groups/{group['id']}", headers=MEMBER)
    assert removed.status_code == 200 and removed.json()["bookmarks_removed"] == 1
    assert (
        client.get(f"/api/bookmark-groups/{group['id']}", headers=MEMBER).status_code
        == 404
    )
    assert [b["run_id"] for b in _listed(client, MEMBER)["bookmarks"]] == ["r1"]
    assert client.get("/api/runs/r-review", headers=MEMBER).status_code == 200


def test_a_private_bookmark_is_the_authors_alone(client):
    _save(client, "r1", MEMBER, note="mine")
    # Another member sees neither the run page's bookmark nor a list entry nor the group.
    assert client.get("/api/runs/r1/bookmarks", headers=MGR).json() == {
        "run_id": "r1",
        "mine": None,
        "others": [],
    }
    assert _listed(client, MGR)["bookmarks"] == []
    assert _groups(client, MGR) == []
    assert client.get("/api/bookmark-groups/bg1", headers=MGR).status_code == 404
    assert [b["note"] for b in _listed(client, MEMBER)["bookmarks"]] == ["mine"]
    # The manager's own save makes a second bookmark, not an edit of the member's.
    assert _save(client, "r1", MGR, note="theirs").status_code == 201
    assert (
        client.get("/api/runs/r1/bookmarks", headers=MEMBER).json()["mine"]["note"]
        == "mine"
    )
    # Removing is the author's too: the manager's delete leaves the member's row.
    assert client.delete("/api/runs/r1/bookmark", headers=MGR).json() == {
        "ok": True,
        "removed": True,
    }
    assert client.delete("/api/runs/r1/bookmark", headers=MGR).json() == {
        "ok": True,
        "removed": False,
    }
    assert (
        client.get("/api/runs/r1/bookmarks", headers=MEMBER).json()["mine"]["note"]
        == "mine"
    )


def test_a_group_with_a_public_bookmark_shows_to_the_team_with_its_public_part(
    client,
):
    assert _save(client, "r-review", MGR, note="first").status_code == 201
    assert (
        _save(
            client, "r1", MEMBER, visibility="public", note="team baseline"
        ).status_code
        == 201
    )
    assert _save(client, "r-review", MEMBER, note="my private one").status_code == 201

    # The manager sees the member's General group with its one public bookmark; the pin is the owner's.
    client.patch("/api/bookmark-groups/bg1", json={"pinned": True}, headers=MEMBER)
    groups = _groups(client, MGR)
    assert [
        (g["name"], g["is_mine"], g["bookmark_count"], g["pinned"]) for g in groups
    ] == [
        ("General", True, 1, False),
        ("General", False, 1, False),
    ]
    assert groups[1]["owner"]["email"] == "member@x.com"
    detail = client.get("/api/bookmark-groups/bg1", headers=MGR).json()
    assert detail["run_ids"] == ["r1"] and detail["bookmark_count"] == 1
    assert [(b["note"], b["is_mine"]) for b in detail["bookmarks"]] == [
        ("team baseline", False)
    ]
    # The owner's view of the same group has both, newest first, and the pin.
    own = client.get("/api/bookmark-groups/bg1", headers=MEMBER).json()
    assert own["run_ids"] == ["r-review", "r1"] and own["pinned"] is True
    assert [b["note"] for b in own["bookmarks"]] == ["my private one", "team baseline"]
    # The flat list: the manager's own and the member's public one, newest first.
    rows = _listed(client, MGR)["bookmarks"]
    assert [(b["run_id"], b["note"], b["is_mine"]) for b in rows] == [
        ("r1", "team baseline", False),
        ("r-review", "first", True),
    ]
    assert (
        rows[0]["group"]["name"] == "General"
        and rows[0]["user"]["email"] == "member@x.com"
    )
    # group_id narrows the list to one group's visible bookmarks.
    assert [b["note"] for b in _listed(client, MGR, group_id="bg1")["bookmarks"]] == [
        "team baseline"
    ]
    # The run page lists the others' public bookmarks beside the caller's own.
    page = client.get("/api/runs/r1/bookmarks", headers=MGR).json()
    assert page["mine"] is None and [b["note"] for b in page["others"]] == [
        "team baseline"
    ]
    # scope=mine narrows to the caller's own; the total header follows the scope.
    mine = client.get(
        "/api/projects/pa/bookmarks", params={"scope": "mine"}, headers=MGR
    )
    assert [b["note"] for b in mine.json()["bookmarks"]] == ["first"]
    assert mine.headers["X-Qym-Total-Count"] == "1" and mine.json()["total"] == 1
    # A platform admin reads the project's public bookmarks without a membership.
    assert [b["note"] for b in _listed(client, ADMIN)["bookmarks"]] == ["team baseline"]
    assert [g["is_mine"] for g in _groups(client, ADMIN)] == [False]


def test_search_narrows_by_run_name_id_or_note(client):
    _save(client, "r1", MEMBER, note="the baseline for release 4")
    _save(client, "r-review", MEMBER, note="candidate")
    assert [b["run_id"] for b in _listed(client, MEMBER, q="release")["bookmarks"]] == [
        "r1"
    ]
    assert [b["run_id"] for b in _listed(client, MEMBER, q="REVIEW")["bookmarks"]] == [
        "r-review"
    ]
    assert _listed(client, MEMBER, q="nothing-here")["bookmarks"] == []
    # LIKE wildcards in the search are literal.
    assert _listed(client, MEMBER, q="%")["bookmarks"] == []


def test_the_request_shape_is_checked(client):
    assert _save(client, "r1", MEMBER, note="x" * 20_001).status_code == 422
    assert _save(client, "r1", MEMBER, visibility="everyone").status_code == 422
    assert _new_group(client, MEMBER, "x" * 121).status_code == 422
    assert (
        client.get(
            "/api/projects/pa/bookmarks", params={"scope": "theirs"}, headers=MEMBER
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/projects/pa/bookmarks", params={"limit": 0}, headers=MEMBER
        ).status_code
        == 422
    )


def test_a_run_the_caller_cannot_view_answers_not_found(client):
    assert _save(client, "r1", OUTSIDER).json()["detail"] == "Run not found"
    assert client.delete("/api/runs/r1/bookmark", headers=OUTSIDER).status_code == 404
    assert client.get("/api/runs/r1/bookmarks", headers=OUTSIDER).status_code == 404
    # The project helper refuses a non-member as every project read does (403; 404 once archived).
    assert client.get("/api/projects/pa/bookmarks", headers=OUTSIDER).status_code == 403
    assert (
        client.get("/api/projects/pa/bookmark-groups", headers=OUTSIDER).status_code
        == 403
    )
    assert client.get("/api/bookmark-groups/bg1", headers=OUTSIDER).status_code == 403
    assert client.get("/api/bookmark-groups/nope", headers=MEMBER).status_code == 404
    assert _save(client, "missing", MEMBER).status_code == 404


def test_a_deleted_run_takes_no_bookmark_and_leaves_the_list(
    client, session_factory
):  # noqa: F811
    assert _save(client, "r-trash", MEMBER).status_code == 404
    _save(client, "r1", MEMBER, visibility="public")
    _save(client, "r-review", MEMBER)
    with session_factory() as db:
        db.query(Run).filter(Run.id == "r1").update({"deleted_at": datetime.utcnow()})
        db.commit()
    assert [b["run_id"] for b in _listed(client, MEMBER)["bookmarks"]] == ["r-review"]
    assert client.get("/api/runs/r1/bookmarks", headers=MEMBER).status_code == 404
    # The group's page and count follow; the only public bookmark gone, the team no longer sees the group.
    detail = client.get("/api/bookmark-groups/bg1", headers=MEMBER).json()
    assert detail["run_ids"] == ["r-review"] and detail["bookmark_count"] == 1
    assert _groups(client, MGR) == []
    # The row itself waits for the restore (or the purge, which cascades).
    with session_factory() as db:
        assert db.query(RunBookmark).filter(RunBookmark.run_id == "r1").count() == 1


def test_a_viewer_reads_public_bookmarks_and_writes_none(
    client, session_factory
):  # noqa: F811
    from qym_platform.db.models import (ProjectMembership, ProjectRole, User,
                                        UserRole)
    from qym_platform.permissions import VIEWER_DETAIL

    viewer = {"X-User-Email": "viewer@x.com", "Origin": arch.ORIGIN}
    with session_factory() as db:
        db.add(User(id="viewer", email="viewer@x.com", role=UserRole.MEMBER))
        db.flush()
        db.add(
            ProjectMembership(
                project_id="pa", user_id="viewer", role=ProjectRole.VIEWER
            )
        )
        db.commit()
    _save(client, "r1", MEMBER, visibility="public", note="shared")
    assert [b["note"] for b in _listed(client, viewer)["bookmarks"]] == ["shared"]
    assert [g["bookmark_count"] for g in _groups(client, viewer)] == [1]
    refused = _save(client, "r1", viewer)
    assert refused.status_code == 403 and refused.json()["detail"] == VIEWER_DETAIL
    assert client.delete("/api/runs/r1/bookmark", headers=viewer).status_code == 403
    assert _new_group(client, viewer, "Mine").status_code == 403


def test_the_rows_go_with_their_run_and_their_group(session_factory):  # noqa: F811
    """The foreign keys cascade: a purge needs no extra step (Postgres; SQLite with the pragma on)."""
    engine = session_factory.kw["bind"]
    with session_factory() as db:
        db.add(
            RunBookmark(
                run_id="r1",
                project_id="pa",
                user_id="member",
                group_id="bg1",
                visibility=BookmarkVisibility.PUBLIC,
            )
        )
        db.add(
            BookmarkGroup(id="bg2", project_id="pa", owner_user_id="member", name="Two")
        )
        db.flush()
        db.add(
            RunBookmark(
                run_id="r-review", project_id="pa", user_id="member", group_id="bg2"
            )
        )
        db.commit()
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.exec_driver_sql("DELETE FROM review_corrections WHERE run_id = 'r1'")
        connection.exec_driver_sql("DELETE FROM run_item_scores WHERE run_id = 'r1'")
        connection.exec_driver_sql("DELETE FROM run_items WHERE run_id = 'r1'")
        connection.exec_driver_sql("DELETE FROM runs WHERE id = 'r1'")
        assert (
            connection.exec_driver_sql("SELECT count(*) FROM run_bookmarks").scalar()
            == 1
        )
        connection.exec_driver_sql("DELETE FROM bookmark_groups WHERE id = 'bg2'")
        assert (
            connection.exec_driver_sql("SELECT count(*) FROM run_bookmarks").scalar()
            == 0
        )


def test_migration_0106_files_every_bookmark_in_a_general_group_and_downgrades(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from alembic.autogenerate import compare_metadata

    before = _load_migration("0104_run_bookmarks.py")
    migration = _load_migration("0106_bookmark_groups.py")
    engine = sa.create_engine("sqlite://")
    # Everything but the two tables; 0104 then makes run_bookmarks in its old shape.
    Base.metadata.create_all(
        engine,
        tables=[
            t for t in Base.metadata.sorted_tables if t.name not in BOOKMARK_TABLES
        ],
    )
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(before, "op", operations)
        before.upgrade()
        # SQLite enforces no foreign key here: the users and the project need no rows.
        for row_id, user, pinned in (("b1", "u1", 1), ("b2", "u1", 0), ("b3", "u2", 0)):
            connection.exec_driver_sql(
                "INSERT INTO run_bookmarks (id, run_id, project_id, user_id, visibility, note, "
                f"pinned, pinned_at, created_at, updated_at) VALUES ('{row_id}', 'run-{row_id}', "
                f"'p1', '{user}', 'private', '', {pinned}, "
                + ("'2026-02-02 10:00:00'" if pinned else "NULL")
                + ", '2026-01-01', '2026-01-01')"
            )
        monkeypatch.setattr(migration, "op", operations)
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert BOOKMARK_TABLES <= set(inspector.get_table_names())
        columns = {c["name"] for c in inspector.get_columns("run_bookmarks")}
        assert "group_id" in columns and not {"pinned", "pinned_at"} & columns
        groups = connection.exec_driver_sql(
            "SELECT owner_user_id, name, pinned, pinned_at FROM bookmark_groups ORDER BY owner_user_id"
        ).fetchall()
        assert [(g[0], g[1], bool(g[2]), bool(g[3])) for g in groups] == [
            ("u1", "General", True, True),
            ("u2", "General", False, False),
        ]
        filed = connection.exec_driver_sql(
            "SELECT b.id, g.owner_user_id FROM run_bookmarks b JOIN bookmark_groups g ON g.id = b.group_id ORDER BY b.id"
        ).fetchall()
        assert [tuple(r) for r in filed] == [("b1", "u1"), ("b2", "u1"), ("b3", "u2")]
        assert {
            fk["referred_table"]: fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("run_bookmarks")
        } == {
            "runs": "CASCADE",
            "projects": None,
            "users": "CASCADE",
            "bookmark_groups": "CASCADE",
        }

        def only_bookmarks(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
            table = obj if kind == "table" else getattr(obj, "table", None)
            return getattr(table, "name", name) in BOOKMARK_TABLES

        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": only_bookmarks}
        )
        diffs = compare_metadata(context, Base.metadata)
        assert diffs == [], diffs
        migration.downgrade()
        inspector = sa.inspect(connection)
        assert "bookmark_groups" not in inspector.get_table_names()
        columns = {c["name"] for c in inspector.get_columns("run_bookmarks")}
        assert {"pinned", "pinned_at"} <= columns and "group_id" not in columns
    engine.dispose()
