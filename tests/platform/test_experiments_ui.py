"""Experiments page shell (plan §12.2, issue #22).

Route rendering and access for ``/projects/{slug}/experiments``, the project-nav
entry in ``shell.js``, the served assets, and static contract checks on
``experiments.js`` (API endpoints, list columns, cancel/retry gating, polling,
escaping). No browser or ``node`` is needed.
"""

from __future__ import annotations

import re
from pathlib import Path

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

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
PAGE = (DASHBOARD / "experiments.html").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "experiments.js").read_text(encoding="utf-8")
SHELL = (DASHBOARD / "shell.js").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- route


def test_route_renders_for_members(client):
    for email in (MEMBER, MANAGER):
        res = client.get("/projects/p1/experiments", headers=_headers(email))
        assert res.status_code == 200, res.text
        assert "text/html" in res.headers["content-type"]
        assert 'id="exp-root"' in res.text
        assert "/static/experiments.js" in res.text
        assert "window.__QYM_ROOT_PATH__" in res.text
    # Detail is a query parameter on the same route.
    res = client.get(
        "/projects/p1/experiments?experiment=abc", headers=_headers(MEMBER)
    )
    assert res.status_code == 200 and 'id="exp-root"' in res.text


def test_route_is_refused_for_non_members_and_unknown_projects(client):
    denied = client.get("/projects/p1/experiments", headers=_headers(OUTSIDER))
    assert denied.status_code in (403, 404)
    assert 'id="exp-root"' not in denied.text
    missing = client.get("/projects/nope/experiments", headers=_headers(MEMBER))
    assert missing.status_code == 404
    assert 'id="exp-root"' not in missing.text


def test_page_assets_are_served(client):
    assets = re.findall(r'(?:src|href)="/static/([^"?]+)', PAGE)
    assert "experiments.js" in assets and "qym_table.js" in assets
    assert "ui_components.css" in assets and "ui_components.js" in assets
    for asset in assets:
        res = client.get(f"/static/{asset}")
        assert res.status_code == 200, asset
    js = client.get("/static/experiments.js")
    assert "javascript" in js.headers["content-type"]


# --------------------------------------------------------------------------- shell nav


def test_project_nav_links_to_experiments():
    assert (
        "buildNavItem('Experiments', 'experiments', 'experiments', "
        "{ href: projectSlug ? projectUrl(projectSlug, 'experiments') : '#' })"
    ) in SHELL
    assert "experiments: '<path" in SHELL  # nav icon
    assert "experiments: 'Experiments'" in SHELL  # breadcrumb label
    assert "'experiments': projectUrl(slug, 'experiments')" in SHELL  # href rebuild
    assert "else if (rest === 'experiments') page = 'experiments';" in SHELL
    # Client-side navigation and root-path detection know the route.
    assert "models|experiments|datasets" in SHELL
    assert r"/\/projects\/[^/]+\/experiments$/" in SHELL


# --------------------------------------------------------------------------- page


def test_page_follows_design_language_anatomy():
    # Constrained page, page-local exp- prefix, shared styles after page styles.
    assert '<main class="page exp-page" id="exp-root"' in PAGE
    assert PAGE.index("<style>") < PAGE.index('href="/static/ui_components.css')
    style = re.search(r"<style>(.*?)</style>", PAGE, re.S).group(1)
    assert not re.search(r"font-size:\s*\d", style)
    selectors = re.findall(r"(?:^|\})\s*([^{}]+?)\s*\{", style)
    assert selectors
    for selector in selectors:
        for part in selector.split(","):
            classes = re.findall(r"\.([\w-]+)", part)
            assert any(c.startswith("exp-") for c in classes), part.strip()


def test_module_consumes_experiments_api():
    for path in (
        "'/experiments'",
        "'/cancel'",
        "'/jobs/'",
        "'/retry'",
        "/eval-environments",
        "v1/projects/by-slug/",
    ):
        assert path in MODULE, path
    # Detail is ?experiment=<id>; the launch form (#23) is ?new=1.
    assert "'?experiment='" in MODULE and "params.get('experiment')" in MODULE
    assert "'data-exp-new': '1'" in MODULE
    assert "navigate(projectPage('/experiments?new=1'))" in MODULE


def test_list_has_required_columns_and_empty_best_score():
    for label in (
        "Name",
        "Environments",
        "Base source",
        "Jobs",
        "Best score",
        "Creator",
        "Age",
    ):
        assert f"label: '{label}'" in MODULE, label
    # Jobs column shows ✓/✗/running counts; best score falls back to an em dash.
    assert "'✓ '" in MODULE and "'✗ '" in MODULE and "'● '" in MODULE
    assert "return '—';" in MODULE


def test_detail_has_job_list_run_links_and_controls():
    for hook in (
        "data-exp-cancel-all",
        "data-exp-job-cancel",
        "data-exp-job-retry",
        "function runUrl(",
        "'/runs/'",
    ):
        assert hook in MODULE, hook
    # Cancelling always asks first; retry is offered only for retryable jobs.
    for fn in ("cancelExperiment", "cancelJob"):
        body = MODULE[MODULE.index(f"async function {fn}(") :]
        body = body[: body.index("\n  }\n")]
        assert "await confirmDialog(" in body, fn
        assert body.index("confirmDialog(") < body.index("postJson("), fn
    assert "const RETRYABLE = ['FAILED', 'CANCELLED', 'TIMED_OUT', 'BLOCKED'];" in MODULE


def test_controls_respect_permissions():
    # Creator, project manager or admin; a 403 disables the controls.
    assert "experiment.created_by_user_id === me.id" in MODULE
    assert "state.project.role === 'MANAGER'" in MODULE
    assert "res.status === 403" in MODULE and "state.denied = true" in MODULE
    assert MODULE.count("disabled: !allowed") >= 2


def test_high_retry_asks_for_preemption_acknowledgement():
    # #14: a HIGH retry is refused with PREEMPTION_ACK_REQUIRED until the user
    # confirms the server's warning; the page then resends with the flag.
    from qym_platform.services.eval_priority import PREEMPTION_ACK_REQUIRED

    assert f"const PREEMPTION_ACK_REQUIRED = '{PREEMPTION_ACK_REQUIRED}';" in MODULE
    retry = MODULE[MODULE.index("async function retryJob") :]
    retry = retry[: retry.index("\n  }\n")]
    assert "detail.code === PREEMPTION_ACK_REQUIRED" in retry
    assert retry.index("confirmDialog(") < retry.index("acknowledge_preemption: true")


def test_detail_polls_while_jobs_are_live_and_pauses_when_hidden():
    assert "!isTerminal(job.status)" in MODULE
    assert "document.hidden" in MODULE
    assert "addEventListener('visibilitychange', onVisibility)" in MODULE
    assert "removeEventListener('visibilitychange', onVisibility)" in MODULE
    assert "addEventListener('qym:before-navigate', teardown" in MODULE
    assert "POLL_MIN_MS" in MODULE and "POLL_MAX_MS" in MODULE


def test_server_strings_never_reach_html_parsing():
    assert "innerHTML" not in MODULE.replace("there is no innerHTML", "")
    assert "insertAdjacentHTML" not in MODULE
    assert "outerHTML" not in MODULE
    assert "document.write" not in MODULE
    # el() only sets text through textContent.
    assert "node.textContent = String(value)" in MODULE


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
