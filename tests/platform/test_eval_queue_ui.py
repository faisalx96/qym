"""Queue page UI (plan §12.2a, §12.3, §13.1, §14.1; issue #25).

Route rendering and access for ``/projects/{slug}/experiments/queue``, the shell's
navigation and the Experiments | Queue tabs, static contract checks on
``eval_queue.js`` (poll pause, confirm-before-cancel, manager-only orphan cancel,
no HTML parsing of server strings), the queue strip on the experiment detail, and
an API round trip through the endpoints the page calls that proves the P2 exit: a
QUEUED and a RUNNING job cancelled from the queue page. No browser or ``node``.
"""

from __future__ import annotations

import re
from pathlib import Path

from qym_platform.db.models import EvalJobStatus, Project, ProjectRole

# Reuse the queue API fixtures (sessions, fake clock, fake service, TestClient).
from test_eval_queue import (  # noqa: F401  (pytest fixtures)
    _add_experiment,
    _add_user,
    _as,
    _env,
    _job,
    _join,
    _queue_seed,
    _queue_url,
    _remote_item,
    _same_clock,
    _store_snapshot,
    _submitted,
    api,
    clock,
    service,
    sessions,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages" / "platform" / "qym_platform" / "_static" / "dashboard"
PAGE = (DASHBOARD / "eval_queue.html").read_text(encoding="utf-8")
MODULE = (DASHBOARD / "eval_queue.js").read_text(encoding="utf-8")
EXPERIMENTS = (DASHBOARD / "experiments.js").read_text(encoding="utf-8")
EXPERIMENTS_PAGE = (DASHBOARD / "experiments.html").read_text(encoding="utf-8")
SHELL = (DASHBOARD / "shell.js").read_text(encoding="utf-8")


def _slug(sessions, seed):
    with sessions() as db:
        return db.get(Project, seed["project_id"]).slug


def _function(source, name):
    body = source[source.index(f"function {name}(") :]
    return body[: body.index("\n  }\n")]


# --------------------------------------------------------------------------- route


def test_route_renders_for_members_and_managers(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    slug = _slug(sessions, seed)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    for user in (seed["user_id"], manager):
        res = api.get(f"/projects/{slug}/experiments/queue", headers=_as(sessions, user))
        assert res.status_code == 200, res.text
        assert "text/html" in res.headers["content-type"]
        assert 'id="exq-root"' in res.text
        assert "/static/eval_queue.js" in res.text
        assert "window.__QYM_ROOT_PATH__" in res.text
    # Filters are query parameters on the same route.
    res = api.get(
        f"/projects/{slug}/experiments/queue?experiment={seed['experiment_id']}&mine=1",
        headers=_as(sessions, seed["user_id"]),
    )
    assert res.status_code == 200 and 'id="exq-root"' in res.text


def test_route_is_refused_for_non_members_and_unknown_projects(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    slug = _slug(sessions, seed)
    outsider = _add_user(sessions)
    denied = api.get(
        f"/projects/{slug}/experiments/queue", headers=_as(sessions, outsider)
    )
    assert denied.status_code in (403, 404)
    assert 'id="exq-root"' not in denied.text
    missing = api.get(
        "/projects/nope/experiments/queue", headers=_as(sessions, seed["user_id"])
    )
    assert missing.status_code == 404
    assert 'id="exq-root"' not in missing.text


def test_page_assets_are_served(api):
    assets = re.findall(r'(?:src|href)="/static/([^"?]+)', PAGE)
    for needed in ("eval_queue.js", "qym_table.js", "ui_components.css", "ui_components.js"):
        assert needed in assets, needed
    for asset in assets:
        assert api.get(f"/static/{asset}").status_code == 200, asset
    js = api.get("/static/eval_queue.js")
    assert "javascript" in js.headers["content-type"]


# --------------------------------------------------------------------------- nav and tabs


def test_shell_knows_the_queue_route():
    # Root-path detection, page parsing, client-side navigation allowlist.
    assert r"/\/projects\/[^/]+\/experiments\/queue$/" in SHELL
    assert "else if (rest === 'experiments/queue') page = 'experiments-queue';" in SHELL
    assert r"/^projects\/[^/]+\/experiments\/queue$/" in SHELL
    # The Experiments nav item stays active; breadcrumbs read Experiments / Queue.
    assert "'experiments-queue': 'experiments'," in SHELL
    assert "'experiments-queue': 'Queue'," in SHELL
    crumbs = SHELL[SHELL.index("ctx.page === 'experiments-queue'") :][:300]
    assert "projectUrl(ctx.projectSlug, 'experiments')" in crumbs


def test_experiments_and_queue_pages_share_a_tab_pair():
    for source, prefix in ((MODULE, "exq"), (EXPERIMENTS, "exp")):
        assert f"className: 'qym-tabs {prefix}-tabs', role: 'tablist'" in source
        assert source.count("role: 'tab'") == 2
        assert "text: 'Experiments'" in source and "text: 'Queue'" in source
    # Each page marks itself selected and links to the other.
    assert "exq-tab active', role: 'tab', 'aria-selected': 'true'" in MODULE
    assert "href: experimentUrl(null), text: 'Experiments'" in MODULE
    assert "exp-tab active', role: 'tab', 'aria-selected': 'true'" in EXPERIMENTS
    assert "href: queuePageUrl(null), text: 'Queue'" in EXPERIMENTS
    assert "projectPage('/experiments/queue')" in EXPERIMENTS
    assert "projectPage('/experiments/queue')" in MODULE
    assert "root.replaceChildren(header, sectionTabs(), toolbar, card);" in EXPERIMENTS


# --------------------------------------------------------------------------- page


def test_page_follows_design_language_anatomy():
    assert '<main class="page exq-page" id="exq-root"' in PAGE
    assert PAGE.index("<style>") < PAGE.index('href="/static/ui_components.css')
    # Only the shared sheets are <link>ed: client-side navigation carries <style> only.
    links = re.findall(r'<link rel="stylesheet" href="/static/([^"?]+)', PAGE)
    assert links == ["dashboard.css", "shell.css", "ui_components.css"]
    for html, prefix in ((PAGE, "exq-"), (EXPERIMENTS_PAGE, "exp-")):
        style = re.search(r"<style>(.*?)</style>", html, re.S).group(1)
        assert not re.search(r"font-size:\s*\d", style)
        selectors = re.findall(r"(?:^|\})\s*([^{}]+?)\s*\{", style)
        assert selectors
        for selector in selectors:
            for part in selector.split(","):
                classes = re.findall(r"\.([\w-]+)", part)
                assert any(c.startswith(prefix) for c in classes), part.strip()


def test_module_consumes_the_queue_api():
    for needle in (
        "'/eval-queue'",
        "queuePath('/remote'",
        "queuePath('/cancel')",
        "queuePath('/remote/cancel')",
        "/eval-environments",
        "v1/projects/by-slug/",
        "query.set('environment_id'",
        "query.set('experiment_id'",
        "query.set('status'",
        "query.set('mine', 'true')",
    ):
        assert needle in MODULE, needle
    # Header per environment: in-flight n/cap, queued, health, HIGH banner.
    for needle in (
        "env.inflight + '/'",
        "env.queued",
        "env.health_status",
        "env.high_active",
        "data-exq-high",
    ):
        assert needle in MODULE, needle
    # Our jobs: wait_reason, dispatch position, linked-run progress bar.
    for needle in (
        "job.wait_reason",
        "job.queue_position",
        "role: 'progressbar'",
        "run.items_done",
        "run.items_total",
        "runUrl(run.id)",
    ):
        assert needle in MODULE, needle
    for label in (
        "Experiment",
        "Environment",
        "Priority",
        "Status",
        "Created by",
        "Age",
        "Elapsed",
        "Run progress",
    ):
        assert f"label: '{label}'" in MODULE, label


def test_every_cancel_asks_first_and_splits_the_selection():
    for fn in ("cancelJobs", "cancelQueuedInExperiment", "cancelOrphans"):
        body = _function(MODULE, fn)
        assert "await confirmCancel(" in body, fn
        assert "result.confirmed" in body, fn
        send = "postJson(" if "postJson(" in body else "sendCancel("
        assert body.index("confirmCancel(") < body.index(send), fn
    # The dialog groups: queued here / on the service / not allowed (skipped).
    split = _function(MODULE, "splitSections")
    for text in (
        "Queued here (not yet sent)",
        "Submitted or running on the service",
        "partial results stay on the linked run",
        "Not allowed (skipped)",
    ):
        assert text in split, text
    assert "const QUEUED_HERE = ['QUEUED', 'BLOCKED'];" in MODULE
    # Optional reason, sent only when given.
    assert "'data-exq-reason': '1'" in MODULE and "maxlength: '1000'" in MODULE
    assert "if (reason) body.reason = reason;" in MODULE
    # Row, bulk and "cancel all queued in experiment".
    for hook in (
        "'data-exq-cancel': job.id",
        "'data-exq-bulk-cancel': '1'",
        "'data-exq-cancel-experiment': '1'",
        "{ experiment_id: experimentId, statuses: QUEUED_HERE.slice() }",
        "{ job_ids: ids }",
    ):
        assert hook in MODULE, hook
    # Permission per job comes from the server's can_cancel.
    assert "return !!job.can_cancel && job.status !== 'CANCELLING';" in MODULE


def test_orphan_cancel_is_offered_to_managers_only():
    assert "const canCancel = remote.can_cancel_orphans === true;" in MODULE
    assert "if (canCancel && item.orphan)" in MODULE
    assert "if (canCancel && view.orphan_count)" in MODULE
    guard = _function(MODULE, "cancelOrphans")
    assert "!(state.remote && state.remote.can_cancel_orphans)" in guard
    # Collapsible remote section, fetched only while open.
    assert "'aria-expanded': state.remoteOpen ? 'true' : 'false'" in MODULE
    assert "state.remoteOpen ? request(queuePath('/remote'" in MODULE


def test_polls_with_backoff_and_pauses_when_hidden():
    assert "const POLL_MIN_MS = 5000;" in MODULE and "const POLL_MAX_MS = 60000;" in MODULE
    assert "Math.min(POLL_MAX_MS, Math.round(state.pollDelay * 1.5))" in MODULE
    assert "if (document.hidden) return; // resumed by visibilitychange" in MODULE
    assert "addEventListener('visibilitychange', onVisibility)" in MODULE
    assert "removeEventListener('visibilitychange', onVisibility)" in MODULE
    assert "addEventListener('qym:before-navigate', teardown" in MODULE
    teardown = _function(MODULE, "teardown")
    assert "clearPoll();" in teardown and "closeDialog();" in teardown


def test_server_strings_never_reach_html_parsing():
    for source in (MODULE, EXPERIMENTS):
        assert "innerHTML" not in source.replace("there is no innerHTML", "")
        assert "insertAdjacentHTML" not in source
        assert "outerHTML" not in source
        assert "document.write" not in source
    assert "node.textContent = String(value)" in MODULE


def test_experiment_detail_shows_a_queue_strip():
    strip = _function(EXPERIMENTS, "refreshQueueStrip")
    assert "'/eval-queue'" in strip and "'?experiment_id='" in strip
    node = _function(EXPERIMENTS, "queueStripNode")
    for needle in (
        "' queued'",
        "' running'",
        "'position '",
        "queuePageUrl(state.detail.id)",
    ):
        assert needle in node, needle
    assert "[header, stats, queueStripNode()]" in EXPERIMENTS
    assert "refreshQueueStrip();" in _function(EXPERIMENTS, "applyDetail")


# --------------------------------------------------------------------------- data


def test_queue_strip_payload_for_an_experiment(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    body = api.get(
        _queue_url(seed),
        headers=_as(sessions, seed["user_id"]),
        params={"experiment_id": seed["experiment_id"], "limit": 1000},
    ).json()
    by_status = {}
    for job in body["jobs"]:
        by_status.setdefault(job["status"], []).append(job)
        for key in ("environment_id", "environment_name", "queue_position", "status"):
            assert key in job, key
    assert sorted(j["queue_position"] for j in by_status["QUEUED"]) == [1, 2]
    assert [j["id"] for j in by_status["RUNNING"]] == [running]


def test_p2_exit_cancel_a_queued_and_a_running_job_from_the_queue_page(
    api, sessions, service, clock
):
    """The page's calls: GET the queue, POST /cancel for the selection, poll again."""
    seed, dispatcher, remote = _submitted(sessions, service, clock)
    (running,) = seed["job_ids"]
    _join(sessions, seed, user_id=seed["user_id"])
    creator = _as(sessions, seed["user_id"])

    # The submitted job starts running on the service; a second job waits here.
    service.set_status(remote[running], "RUNNING")
    job = _job(sessions, running)
    clock.advance(max(0.0, (job.next_attempt_at - clock()).total_seconds()))
    dispatcher.tick()
    assert _job(sessions, running).status == EvalJobStatus.RUNNING
    queued = _add_experiment(sessions, seed, seed["user_id"])

    listed = api.get(_queue_url(seed), headers=creator)
    assert listed.status_code == 200, listed.text
    jobs = {j["id"]: j for j in listed.json()["jobs"]}
    assert jobs[queued]["status"] == "QUEUED" and jobs[queued]["can_cancel"]
    assert jobs[running]["status"] == "RUNNING" and jobs[running]["can_cancel"]

    # Bulk cancel of both selected rows, with the optional reason.
    res = api.post(
        _queue_url(seed, "/cancel"),
        headers=creator,
        json={"job_ids": [queued, running], "reason": "P2 exit"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {
        "outcomes": {queued: "cancelled", running: "cancelling"},
        "counts": {"cancelled": 1, "cancelling": 1},
    }
    assert _job(sessions, queued).status == EvalJobStatus.CANCELLED
    assert _job(sessions, queued).cancel_reason == "P2 exit"
    assert service.cancel_calls == []  # the queued job never reached the service

    # The next poll shows the running job stopping; the dispatcher hard-stops it.
    polled = api.get(_queue_url(seed), headers=creator).json()
    assert [(j["id"], j["status"]) for j in polled["jobs"]] == [
        (running, "CANCELLING")
    ]
    dispatcher.tick()
    assert [c[0] for c in service.cancel_calls] == [remote[running]]
    assert service.jobs[remote[running]]["status"] == "CANCELLED"
    stopped = _job(sessions, running)
    assert stopped.status == EvalJobStatus.CANCELLED
    assert stopped.cancel_reason == "P2 exit"
    assert api.get(_queue_url(seed), headers=creator).json()["jobs"] == []


def test_cancel_all_queued_in_experiment_as_the_page_sends_it(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    done, backoff, fresh, running, blocked = seed["job_ids"]
    res = api.post(
        _queue_url(seed, "/cancel"),
        headers=_as(sessions, seed["user_id"]),
        json={
            "experiment_id": seed["experiment_id"],
            "statuses": ["QUEUED", "BLOCKED"],
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["outcomes"] == {
        fresh: "cancelled",
        blocked: "cancelled",
        backoff: "cancelled",
    }
    assert _job(sessions, running).status == EvalJobStatus.RUNNING


def test_remote_view_gates_orphan_cancel_by_role(api, sessions, clock):
    seed, _ = _queue_seed(sessions, clock)
    manager = _join(sessions, seed, ProjectRole.MANAGER)
    _store_snapshot(
        sessions, seed["env_id"], [_remote_item("r-ours"), _remote_item("r-orphan")]
    )
    member_view = api.get(
        _queue_url(seed, "/remote"), headers=_as(sessions, seed["user_id"])
    ).json()
    assert member_view["can_cancel_orphans"] is False
    items = {i["remote_job_id"]: i for i in member_view["environments"][0]["items"]}
    assert items["r-orphan"]["orphan"] is True and items["r-ours"]["orphan"] is False
    manager_view = api.get(
        _queue_url(seed, "/remote"), headers=_as(sessions, manager)
    ).json()
    assert manager_view["can_cancel_orphans"] is True
