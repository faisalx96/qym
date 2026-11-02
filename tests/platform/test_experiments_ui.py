"""Experiments list/detail payloads the page renders and the cancel/retry permission split.

The UI itself is covered by frontend/e2e/experiments (list, detail)."""

from __future__ import annotations


from qym_platform.db.models import EvalJobStatus

# Reuse the experiments API fixtures (users, projects, environments, client).
from test_experiments_api import (  # noqa: F401  (pytest fixtures)
    MANAGER,
    MEMBER,
    MEMBER2,
    OUTSIDER,
    _created,
    _headers,
    _jobs,
    _url,
    client,
    encryption,
    env,
    session_factory,
)

# --------------------------------------------------------------------------- data


def test_list_and_detail_payloads_carry_what_the_page_renders(
    client, session_factory, env
):
    created = _created(client, [env.id])
    listed = client.get(_url(), headers=_headers(MEMBER2)).json()
    (row,) = listed["experiments"]
    for key in (
        "name",
        "status",
        "environment_ids",
        "base_source",
        "job_counts",
        "created_by_email",
        "created_by_user_id",
        "created_at",
    ):
        assert key in row, key
    assert row["job_counts"] == {"QUEUED": 1}

    detail = client.get(
        _url(suffix=f"/{created['id']}"), headers=_headers(MEMBER2)
    ).json()
    (job,) = detail["jobs"]
    for key in (
        "combo_index",
        "environment_name",
        "params",
        "status",
        "attempt",
        "superseded",
        "run_id",
        "run_name",
        "error",
        "wait_reason",
    ):
        assert key in job, key

    # What the Cancel / Retry buttons call, with the permission split they show.
    cancel = _url(suffix=f"/{created['id']}/jobs/{job['id']}/cancel")
    assert client.post(cancel, headers=_headers(MEMBER2)).status_code == 403
    res = client.post(cancel, headers=_headers(MEMBER), json={})
    assert res.status_code == 200 and res.json()["outcome"] == "cancelled"
    (row,) = _jobs(session_factory, created["id"])
    assert row.status == EvalJobStatus.CANCELLED

    retry = _url(suffix=f"/{created['id']}/jobs/{job['id']}/retry")
    assert client.post(retry, headers=_headers(MEMBER2)).status_code == 403
    res = client.post(retry, headers=_headers(MANAGER), json={})
    assert res.status_code == 200, res.text
    jobs = res.json()["experiment"]["jobs"]
    assert [j["superseded"] for j in jobs] == [True, False]
