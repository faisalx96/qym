"""C033: a project Viewer reads everything and changes nothing.

Driven by the same route list as the archived-project rule and the route-role
table (C053): every write route a member or a run owner may call answers 403 to
a viewer, while the run page, the dashboard reads and compare keep working.
"""

from __future__ import annotations

import pytest

import test_archived_project_read_only as arch
from test_archived_project_read_only import client, session_factory  # noqa: F401 (fixtures)
from test_route_roles import _denied
from qym_platform.db.models import ProjectMembership, ProjectRole, User, UserRole
from qym_platform.permissions import VIEWER_DETAIL
from qym_platform.route_roles import PROBE_LIMITS, ROUTE_ROLES

VIEWER = {"X-User-Email": "viewer@x.com", "Origin": arch.ORIGIN}


@pytest.fixture()
def viewer_client(client, session_factory):
    with session_factory() as db:
        db.add(User(id="viewer", email="viewer@x.com", role=UserRole.MEMBER))
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="viewer", role=ProjectRole.VIEWER))
        db.commit()
    return client


WRITES = [
    row
    for row in arch.REFUSED
    if (row[0], row[1]) not in PROBE_LIMITS and ROUTE_ROLES[(row[0], row[1])] != "reader"
]


@pytest.mark.parametrize("method,template,path,kwargs,_headers", WRITES, ids=arch._ids(WRITES))
def test_a_viewer_cannot_write(viewer_client, method, template, path, kwargs, _headers):
    response = arch._call(viewer_client, method, path, kwargs, VIEWER)
    assert _denied(response), (response.status_code, response.text[:200])
    if ROUTE_ROLES[(method, template)] == "member":
        # Routes a member may call refuse a viewer with the viewer rule itself.
        assert response.json()["detail"] == VIEWER_DETAIL


def test_a_viewer_reads_the_project_its_runs_and_the_dashboard(viewer_client):
    project = viewer_client.get("/v1/projects/by-slug/pa", headers=VIEWER)
    assert project.status_code == 200 and project.json()["role"] == "VIEWER"
    assert viewer_client.get("/api/runs/r1", headers=VIEWER).status_code == 200
    rows = viewer_client.post("/api/dashboard/runs", json={"project_slug": "pa"}, headers=VIEWER)
    assert rows.status_code == 200


def test_a_viewer_cannot_cancel_jobs(viewer_client):
    response = viewer_client.post("/v1/projects/pa/eval-queue/cancel", json={"job_ids": ["j1"]}, headers=VIEWER)
    assert response.status_code == 403 and response.json()["detail"] == VIEWER_DETAIL


def test_a_manager_makes_a_member_a_viewer_and_back(viewer_client):
    method, template, path, kwargs, _ = next(row for row in WRITES if ROUTE_ROLES[(row[0], row[1])] == "member")
    assert not _denied(arch._call(viewer_client, "GET", "/v1/projects/by-slug/pa", None, arch.MEMBER))
    made = viewer_client.patch("/v1/projects/pa/members/member", json={"role": "VIEWER"}, headers=arch.MGR)
    assert made.status_code == 200, made.text
    refused = arch._call(viewer_client, method, path, kwargs, arch.MEMBER)
    assert refused.status_code == 403 and refused.json()["detail"] == VIEWER_DETAIL, template
    back = viewer_client.patch("/v1/projects/pa/members/member", json={"role": "MEMBER"}, headers=arch.MGR)
    assert back.status_code == 200
