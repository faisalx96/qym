"""C053: one table maps every write route to its least role, and each route is called per role.

The routes, request bodies and fixture come from test_archived_project_read_only.py,
which already lists every write route with a body that reaches its handler. Here each
of those routes is called on an active project as a non-member, a member, a member on
a run of their own, a manager and an admin, and the outcome must match
qym_platform.route_roles.ROUTE_ROLES.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

import test_archived_project_read_only as arch
from test_archived_project_read_only import client, session_factory  # noqa: F401 (fixtures)
from qym_platform.app import create_app
from qym_platform.db.models import RunItem, RunItemScore
from qym_platform.route_roles import PROBE_LIMITS, ROLES, ROUTE_ROLES

HIDDEN = {"Project not found", "Run not found"}
ALLOWED_FOR = {
    "outsider": set(),
    "member": {"member"},
    "owner": {"member", "owner_or_manager"},
    "mgr": {"member", "owner_or_manager", "manager"},
    "admin": {"member", "owner_or_manager", "manager", "admin"},
}
HEADERS = {"outsider": arch.OUTSIDER, "member": arch.MEMBER, "owner": arch.MEMBER, "mgr": arch.MGR, "admin": arch.ADMIN}


def _denied(response) -> bool:
    if response.status_code in (401, 403):
        return True
    if response.status_code != 404:
        return False
    try:
        return response.json().get("detail") in HIDDEN
    except ValueError:
        return False


def _own_run(path, kwargs):
    """The same call on ``r-mine``, a run the member owns; None when the route names no run."""
    body = json.dumps((kwargs or {}).get("json", ""))
    if "/r1" not in path and '"r1"' not in body:
        return None
    kwargs = copy.deepcopy(kwargs) if kwargs else None
    if kwargs and "json" in kwargs:
        kwargs["json"] = json.loads(body.replace('"r1"', '"r-mine"'))
    for old, new in (("/r1/", "/r-mine/"), ("/r1:", "/r-mine:")):
        path = path.replace(old, new)
    if path.endswith("/r1"):
        path = path[: -len("/r1")] + "/r-mine"
    return path, kwargs


def test_every_write_route_has_a_role():
    routes = arch._write_routes(create_app().routes)
    assert len(routes) > 100
    missing = sorted(routes - set(ROUTE_ROLES))
    stale = sorted(set(ROUTE_ROLES) - routes)
    assert not missing, f"Add these write routes to qym_platform/route_roles.py with their least role: {missing}"
    assert not stale, f"Routes in route_roles.py that no longer exist: {stale}"
    assert set(ROUTE_ROLES.values()) <= set(ROLES)


def test_the_docs_publish_the_table():
    text = (Path(__file__).resolve().parents[2] / "docs" / "ROLES.md").read_text()
    for (method, template), role in ROUTE_ROLES.items():
        assert f"| {method} | `{template}` | {role} |" in text, (method, template)


CASES = [
    (row, who)
    for row in arch.REFUSED
    if (row[0], row[1]) not in PROBE_LIMITS
    for who in ALLOWED_FOR
]


@pytest.mark.parametrize("row,who", CASES, ids=[f"{r[0]} {r[1]} as {who}" for r, who in CASES])
def test_each_route_answers_by_its_least_role(client, session_factory, row, who):
    method, template, path, kwargs, _ = row
    role = ROUTE_ROLES[(method, template)]
    if who == "owner":
        own = _own_run(path, kwargs)
        if own is None:
            pytest.skip("the route names no run")
        path, kwargs = own
        with session_factory() as db:
            db.add(arch._run("r-mine", created_by_user_id="member", owner_user_id="member"))
            db.flush()
            db.add(RunItem(run_id="r-mine", item_id="i1", index=0, input="q", output="a"))
            db.add(RunItemScore(run_id="r-mine", item_id="i1", metric_name="m", score_numeric=0.5))
            db.commit()
    response = arch._call(client, method, path, kwargs, HEADERS[who])
    expected_allowed = role in ALLOWED_FOR[who]
    assert _denied(response) != expected_allowed, (role, who, response.status_code, response.text[:200])
