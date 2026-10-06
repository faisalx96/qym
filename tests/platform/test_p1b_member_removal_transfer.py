"""Transfer a member's runs in the member-removal dialog (P1 round 2, C072).

The removal dialog lists how many runs the member owns in the project and
offers to transfer them to another active member. The transfer happens in the
same server call as the removal (DELETE .../members/{id}?transfer_runs_to=),
is audited per run and on the removal, and removal without a transfer stays
possible.
"""

from __future__ import annotations

from datetime import datetime

from qym_platform.db.dashboard_models import DashboardChangeEvent
from qym_platform.db.models import (
    AuditLog,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    User,
)

from test_review_rules import (  # noqa: F401  (fixtures)
    ADMIN,
    MANAGER,
    MEMBER,
    _ok,
    _run,
    _ui,
    client,
    session_factory,
)

PREVIEW = "/v1/projects/project-1/members/owner-1/removal-preview"
REMOVE = "/v1/projects/project-1/members/owner-1"


def _seed_owned_runs(session_factory):
    with session_factory() as db:
        _run(db, "r1")
        _run(db, "r2")
        _run(db, "r3")
        _run(db, "theirs", owner="member-1")
        db.get(Run, "r3").deleted_at = datetime(2026, 9, 3)
        # The same person's run in another project is not part of this one.
        db.add(Project(id="project-2", name="Other", slug="other", created_by_user_id="admin-1"))
        db.flush()
        db.add(ProjectMembership(project_id="project-2", user_id="owner-1", role=ProjectRole.MEMBER))
        db.flush()
        _run(db, "elsewhere")
        db.get(Run, "elsewhere").project_id = "project-2"
        db.commit()


def _owners(session_factory):
    with session_factory() as db:
        return {run.id: run.owner_user_id for run in db.query(Run).order_by(Run.id)}


def _is_member(session_factory, user_id="owner-1"):
    with session_factory() as db:
        return db.query(ProjectMembership).filter_by(project_id="project-1", user_id=user_id).count() == 1


def test_preview_counts_the_runs_the_member_owns(client, session_factory):
    _seed_owned_runs(session_factory)
    for who in (MANAGER, ADMIN):
        assert _ok(client.get(PREVIEW, headers=_ui(who))) == {
            "project_id": "project-1",
            "user_id": "owner-1",
            "owned_runs": 2,
            "owned_deleted_runs": 1,
        }
    assert _ok(client.get("/v1/projects/project-1/members/manager-1/removal-preview", headers=_ui(MANAGER)))["owned_runs"] == 0
    assert client.get(PREVIEW, headers=_ui(MEMBER)).status_code == 403
    assert client.get("/v1/projects/project-1/members/outsider-1/removal-preview", headers=_ui(MANAGER)).status_code == 404


def test_removal_transfers_every_run_in_one_call_and_audits_it(client, session_factory):
    _seed_owned_runs(session_factory)
    with session_factory() as db:
        events_before = db.query(DashboardChangeEvent).count()
    body = _ok(client.delete(REMOVE, params={"transfer_runs_to": "member-1"}, headers=_ui(MANAGER)))
    assert body["transferred_runs"] == 3 and body["runs_transferred_to"] == "member-1"
    assert not _is_member(session_factory)
    # Runs in Trash move too, so a restored run has an owner who is a member.
    assert _owners(session_factory) == {
        "elsewhere": "owner-1",
        "r1": "member-1",
        "r2": "member-1",
        "r3": "member-1",
        "theirs": "member-1",
    }
    with session_factory() as db:
        transfers = db.query(AuditLog).filter_by(action="run.owner_transferred").order_by(AuditLog.entity_id).all()
        assert [(a.entity_id, a.actor_user_id, a.before, a.after) for a in transfers] == [
            (run_id, "manager-1", {"owner_user_id": "owner-1"}, {"owner_user_id": "member-1", "reason": "member_removed"})
            for run_id in ("r1", "r2", "r3")
        ]
        removal = db.query(AuditLog).filter_by(action="project.member_removed").one()
        assert removal.after == {"revoked_api_key_ids": [], "runs_transferred_to": "member-1", "transferred_runs": 3}
        # The runs list and dashboards read owners from their projection:
        # each moved run is queued for it.
        changed = {
            row.partition_key
            for row in db.query(DashboardChangeEvent).order_by(DashboardChangeEvent.source_version).offset(events_before)
        }
        assert {"r1", "r2", "r3"} <= changed and "elsewhere" not in changed
    # The new owner submits; the old one is gone.
    _ok(client.post("/v1/runs/r1/submit", headers=_ui(MEMBER)))


def test_removal_without_transfer_keeps_the_runs(client, session_factory):
    _seed_owned_runs(session_factory)
    body = _ok(client.delete(REMOVE, headers=_ui(MANAGER)))
    assert body["transferred_runs"] == 0 and body["runs_transferred_to"] is None
    assert not _is_member(session_factory)
    assert _owners(session_factory)["r1"] == "owner-1"
    with session_factory() as db:
        assert db.query(AuditLog).filter_by(action="run.owner_transferred").count() == 0
        assert db.query(AuditLog).filter_by(action="project.member_removed").one().after == {"revoked_api_key_ids": []}


def test_a_refused_transfer_removes_no_one_and_moves_nothing(client, session_factory):
    _seed_owned_runs(session_factory)
    with session_factory() as db:
        db.add(User(id="disabled-1", email="disabled@example.com", is_active=False))
        db.flush()
        db.add(ProjectMembership(project_id="project-1", user_id="disabled-1", role=ProjectRole.MEMBER))
        db.commit()
    for target, detail in (
        ("outsider-1", "The new owner must be an active member of the project"),
        ("disabled-1", "The new owner must be an active member of the project"),
        ("nobody", "The new owner must be an active member of the project"),
        ("owner-1", "Choose another member to take the runs"),
    ):
        response = client.delete(REMOVE, params={"transfer_runs_to": target}, headers=_ui(MANAGER))
        assert response.status_code == 400, (target, response.text)
        assert response.json()["detail"] == detail
    assert _is_member(session_factory)
    assert _owners(session_factory)["r1"] == "owner-1"
    # Only managers and admins remove members.
    assert client.delete(REMOVE, params={"transfer_runs_to": "manager-1"}, headers=_ui(MEMBER)).status_code == 403
    assert _is_member(session_factory)


def test_archived_project_removes_members_but_moves_no_runs(client, session_factory):
    _seed_owned_runs(session_factory)
    _ok(client.post("/v1/admin/projects/project-1/archive", headers=_ui(ADMIN)))
    refused = client.delete(REMOVE, params={"transfer_runs_to": "member-1"}, headers=_ui(MANAGER))
    assert refused.status_code == 409, refused.text
    assert _is_member(session_factory) and _owners(session_factory)["r1"] == "owner-1"
    _ok(client.delete(REMOVE, headers=_ui(MANAGER)))
    assert not _is_member(session_factory)
