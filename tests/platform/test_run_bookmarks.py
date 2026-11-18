"""Run bookmarks: one per user and run, private or public, pinned ones first.

The fixture is the archived-project one (project ``pa``; ``mgr`` manages it,
``member`` is a member, ``outsider`` is not; runs ``r1``, ``r-review`` and the
deleted ``r-trash``). The route-role and archived-project suites cover the
Viewer and archive refusals of the two write routes.
"""

from __future__ import annotations

from datetime import datetime

import pytest
import sqlalchemy as sa
import test_archived_project_read_only as arch
from alembic.migration import MigrationContext
from alembic.operations import Operations
from qym_platform.db.models import Base, BookmarkVisibility, Run, RunBookmark
from test_archived_project_read_only import (client,  # noqa: F401 (fixtures)
                                             session_factory)
from test_migrations import _load_migration

MEMBER, MGR, OUTSIDER, ADMIN = arch.MEMBER, arch.MGR, arch.OUTSIDER, arch.ADMIN


def _save(client, run_id: str, headers, **body):
    return client.put(f"/api/runs/{run_id}/bookmark", json=body, headers=headers)


def _listed(client, headers, **params):
    response = client.get("/api/projects/pa/bookmarks", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_bookmark_starts_private_unpinned_and_empty(client):
    created = _save(client, "r1", MEMBER)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["run_id"] == "r1" and body["project_slug"] == "pa"
    assert (
        body["visibility"] == "private"
        and body["pinned"] is False
        and body["pinned_at"] is None
    )
    assert body["note"] == "" and body["is_mine"] is True
    assert body["user"]["email"] == "member@x.com"
    assert body["run"]["run_name"] == "r1" and body["run"]["status"] == "COMPLETED"

    # Saving again updates the same bookmark (200), and an omitted field keeps its value.
    again = _save(client, "r1", MEMBER, note="## Keep\n\nthe baseline")
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    assert again.json()["note"] == "## Keep\n\nthe baseline"
    assert again.json()["visibility"] == "private"

    page = client.get("/api/runs/r1/bookmarks", headers=MEMBER).json()
    assert page["mine"]["id"] == body["id"] and page["others"] == []


def test_a_private_bookmark_is_the_authors_alone(client):
    _save(client, "r1", MEMBER, note="mine")
    # Another member sees neither the run page's bookmark nor a list entry.
    assert client.get("/api/runs/r1/bookmarks", headers=MGR).json() == {
        "run_id": "r1",
        "mine": None,
        "others": [],
    }
    assert _listed(client, MGR)["bookmarks"] == []
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


def test_public_bookmarks_show_to_every_member_and_pinned_ones_lead(client):
    assert _save(client, "r-review", MGR, note="first").status_code == 201
    assert (
        _save(
            client, "r1", MEMBER, visibility="public", note="team baseline"
        ).status_code
        == 201
    )
    assert (
        _save(
            client, "r-review", MEMBER, visibility="public", pinned=True, note="pinned"
        ).status_code
        == 201
    )

    # The manager's list: the member's pinned public bookmark first, then the newest.
    rows = _listed(client, MGR)["bookmarks"]
    assert [(b["run_id"], b["note"], b["is_mine"]) for b in rows] == [
        ("r-review", "pinned", False),
        ("r1", "team baseline", False),
        ("r-review", "first", True),
    ]
    assert rows[0]["pinned"] and rows[0]["pinned_at"]
    assert rows[0]["user"]["email"] == "member@x.com"
    # The run page lists the others' public bookmarks beside the caller's own.
    page = client.get("/api/runs/r-review/bookmarks", headers=MGR).json()
    assert page["mine"]["note"] == "first"
    assert [b["note"] for b in page["others"]] == ["pinned"]
    # scope=mine narrows to the caller's own; the total header follows the scope.
    mine = client.get(
        "/api/projects/pa/bookmarks", params={"scope": "mine"}, headers=MGR
    )
    assert [b["note"] for b in mine.json()["bookmarks"]] == ["first"]
    assert mine.headers["X-Qym-Total-Count"] == "1" and mine.json()["total"] == 1
    # A platform admin reads the project's public bookmarks without a membership.
    assert [b["note"] for b in _listed(client, ADMIN)["bookmarks"]] == [
        "pinned",
        "team baseline",
    ]


def test_pinning_stamps_the_pin_time_and_unpinning_clears_it(client):
    _save(client, "r1", MEMBER)
    pinned = _save(client, "r1", MEMBER, pinned=True).json()
    assert pinned["pinned"] is True and pinned["pinned_at"]
    stamp = pinned["pinned_at"]
    # A save that does not touch pinned keeps the stamp (the pin order stays).
    assert _save(client, "r1", MEMBER, note="n").json()["pinned_at"] == stamp
    assert _save(client, "r1", MEMBER, pinned=True).json()["pinned_at"] == stamp
    unpinned = _save(client, "r1", MEMBER, pinned=False).json()
    assert unpinned["pinned"] is False and unpinned["pinned_at"] is None
    public = _save(client, "r1", MEMBER, visibility="public").json()
    assert public["visibility"] == "public"
    assert (
        _save(client, "r1", MEMBER, visibility="private").json()["visibility"]
        == "private"
    )


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
    assert _save(client, "missing", MEMBER).status_code == 404


def test_a_deleted_run_takes_no_bookmark_and_leaves_the_list(
    client, session_factory
):  # noqa: F811
    assert _save(client, "r-trash", MEMBER).status_code == 404
    _save(client, "r1", MEMBER, visibility="public", pinned=True)
    _save(client, "r-review", MEMBER)
    with session_factory() as db:
        db.query(Run).filter(Run.id == "r1").update({"deleted_at": datetime.utcnow()})
        db.commit()
    assert [b["run_id"] for b in _listed(client, MEMBER)["bookmarks"]] == ["r-review"]
    assert client.get("/api/runs/r1/bookmarks", headers=MEMBER).status_code == 404
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
    refused = _save(client, "r1", viewer)
    assert refused.status_code == 403 and refused.json()["detail"] == VIEWER_DETAIL
    assert client.delete("/api/runs/r1/bookmark", headers=viewer).status_code == 403


def test_the_rows_go_with_their_run(session_factory):  # noqa: F811
    """The run foreign key cascades: a purge needs no extra step (Postgres; SQLite with the pragma on)."""
    engine = session_factory.kw["bind"]
    with session_factory() as db:
        db.add(
            RunBookmark(
                run_id="r1",
                project_id="pa",
                user_id="member",
                visibility=BookmarkVisibility.PUBLIC,
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
            == 0
        )


def test_migration_0103_matches_the_model_and_downgrades(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from alembic.autogenerate import compare_metadata

    migration = _load_migration("0103_run_bookmarks.py")
    engine = sa.create_engine("sqlite://")
    # Everything but the new table, as the chain before 0103 leaves it.
    Base.metadata.create_all(
        engine,
        tables=[t for t in Base.metadata.sorted_tables if t.name != "run_bookmarks"],
    )
    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "run_bookmarks" in inspector.get_table_names()
        assert {
            fk["referred_table"]: fk["options"].get("ondelete")
            for fk in inspector.get_foreign_keys("run_bookmarks")
        } == {
            "runs": "CASCADE",
            "projects": None,
            "users": "CASCADE",
        }
        assert {ix["name"] for ix in inspector.get_indexes("run_bookmarks")} == {
            "ix_run_bookmarks_project_id",
            "ix_run_bookmarks_user_id",
        }
        assert [
            uc["column_names"]
            for uc in inspector.get_unique_constraints("run_bookmarks")
        ] == [["run_id", "user_id"]]

        def only_bookmarks(obj, name, kind, reflected, compare_to):  # type: ignore[no-untyped-def]
            table = obj if kind == "table" else getattr(obj, "table", None)
            return getattr(table, "name", name) == "run_bookmarks"

        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "include_object": only_bookmarks}
        )
        diffs = compare_metadata(context, Base.metadata)
        assert diffs == [], diffs
        migration.downgrade()
        assert "run_bookmarks" not in sa.inspect(connection).get_table_names()
    engine.dispose()
