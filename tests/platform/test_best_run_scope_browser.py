"""The best-run picker asks for its scope before it retrieves anything (plan §10.2)."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from test_dashboard_paging_browser import browser  # noqa: F401

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)
pytestmark = pytest.mark.browser

SCOPE = {
    "environment_id": "env",
    "datasets": [
        {
            "id": "ds-1",
            "name": "Golden",
            "slug": "golden",
            "run_count": 3,
            "versions": [
                {"id": "dv-3", "version": "v3", "name": "", "run_count": 2},
                {"id": "dv-1", "version": "v1", "name": "", "run_count": 1},
            ],
        }
    ],
    "other_run_count": 1,
    "versioning": {
        "agent_version": [
            {"value": "v2", "run_count": 1},
            {"value": "v1", "run_count": 2},
        ],
        "kb_version": [{"value": "381", "run_count": 3}],
    },
    "total_runs": 4,
}

# A page that hosts the picker the way experiment_launch.js does.
HARNESS = """<!doctype html><html><body><div id="host"></div>
<script src="/static/experiment_launch_best_run.js"></script>
<script>
  const host = document.getElementById('host');
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'selected' || key === 'checked' || key === 'disabled') node[key] = !!value;
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    [].concat(children == null ? [] : children).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  window.loads = [];
  let picker = null;
  const api = {
    el,
    tag: (text, modifier) => el('span', { className: 'qym-tag qym-tag--' + modifier, text }),
    request: async (path) => {
      const res = await fetch('/' + path);
      return { ok: res.ok, status: res.status, data: await res.json() };
    },
    errorMessage: (data, fallback) => (data && data.detail) || fallback,
    envPath: (id, suffix) => 'v1/projects/p/eval-environments/' + id + suffix,
    target: () => ({ envId: 'env' }),
    onPick: (runId) => { picker.load('env', runId).then((out) => { window.loads.push(out); render(); }); },
    reuseTemporary: () => {},
    rerender: () => render(),
  };
  function render() { host.replaceChildren(picker.render('')); }
  picker = window.QymLaunchBestRun.create(api);
  picker.load('env', '').then((out) => { window.loads.push(out); render(); });
</script></body></html>"""


def ranking(query):
    version = query.get("dataset_version_id", [None])[0]
    dataset = query.get("dataset_id", [None])[0]
    versioning = {}
    for entry in query.get("versioning", []):
        key, value = entry.split("=", 1)
        versioning.setdefault(key, []).append(value)
    is_global = not (version or dataset or versioning)
    return {
        "scope": {
            "dataset": (
                {"id": "ds-1", "name": "Golden", "slug": "golden"} if dataset else None
            ),
            "dataset_version": (
                {"id": version, "version": "v3", "name": ""} if version else None
            ),
            "versioning": versioning,
            "global": is_global,
        },
        "metric": "accuracy",
        "metrics": [{"name": "accuracy", "run_count": 2}],
        "k": None,
        "excluded_errored_count": 0,
        "reason": None,
        "runs": [
            {
                "rank": 1,
                "run_id": "run-top",
                "score": 0.9,
                "pass_at_k_value": None,
                "item_count": 10,
                "error_item_count": 0,
                "dataset": {"id": "ds-1", "name": "Golden"},
                "dataset_version": {"id": "dv-3", "version": "v3"},
                "remote_versioning": {"agent_version": "v2"},
                "params": {},
                "age_seconds": 60,
            },
            {
                "rank": 2,
                "run_id": "run-custom",
                "score": 0.8,
                "pass_at_k_value": None,
                "item_count": 10,
                "error_item_count": 0,
                "dataset": None,
                "dataset_version": None,
                "remote_versioning": None,
                "params": {},
                "age_seconds": 60,
            },
        ],
    }


class Picker:
    def __init__(self, browser):
        self.rankings = []
        self.errors = []
        self.context = browser.new_context(viewport={"width": 1280, "height": 800})
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path == "/harness":
            route.fulfill(body=HARNESS, content_type="text/html")
        elif url.path.startswith("/static/"):
            route.fulfill(
                path=str(STATIC / url.path.split("/static/", 1)[1]),
                content_type="application/javascript",
            )
        elif url.path.endswith("/best-runs/scope"):
            route.fulfill(json=SCOPE)
        elif url.path.endswith("/best-runs"):
            query = parse_qs(url.query)
            self.rankings.append(query)
            route.fulfill(json=ranking(query))
        elif "/best-runs/" in url.path and url.path.endswith("/base"):
            run_id = url.path.split("/best-runs/")[1].split("/")[0]
            route.fulfill(json={"run": {"id": run_id}, "config": {}})
        else:
            route.fulfill(status=404, json={"detail": url.path})

    def open(self):
        self.page.goto("https://qym.test/harness")
        self.page.wait_for_selector("[data-xlb-scope]")


@pytest.fixture
def picker(browser):  # noqa: F811
    view = Picker(browser)
    view.open()
    try:
        yield view
    finally:
        view.context.close()
        assert not view.errors


def test_nothing_is_retrieved_until_find_and_any_ranks_globally(picker):
    page = picker.page
    assert picker.rankings == []
    assert page.evaluate("window.loads") == [{"runId": "", "pending": True}]
    assert page.locator("[data-xlb-scope-hint]").is_visible()
    assert page.locator("[data-xlb-scope-version]").is_disabled()
    selects = page.locator("[data-xlb-scope-versioning]")
    assert selects.evaluate_all("nodes => nodes.map(n => n.options[0].text)") == [
        "Any agent version",
        "Any KB version",
    ]

    page.click("[data-xlb-find]")
    page.wait_for_selector("[data-xlb-table]")
    assert picker.rankings == [
        {"limit": ["5"]}
    ]  # global: no dataset, version or versioning
    assert page.evaluate("window.loads[1]")["runId"] == "run-top"
    assert page.locator("[data-xlb-mixed]").is_visible()
    datasets = page.locator("td.xlb-dataset").all_inner_texts()
    assert datasets == ["Golden v3", "Custom dataset"]
    assert page.locator("[data-xlb-find]").is_disabled()  # scope unchanged


def test_chosen_dataset_version_and_versioning_narrow_the_ranking(picker):
    page = picker.page
    page.select_option("[data-xlb-scope-dataset]", "ds-1")
    assert not page.locator("[data-xlb-scope-version]").is_disabled()
    page.select_option("[data-xlb-scope-version]", "dv-3")
    page.select_option('[data-xlb-scope-versioning][aria-label="Agent version"]', "v2")
    assert picker.rankings == []
    page.click("[data-xlb-find]")
    page.wait_for_selector("[data-xlb-table]")
    assert picker.rankings[-1] == {
        "dataset_id": ["ds-1"],
        "dataset_version_id": ["dv-3"],
        "versioning": ["agent_version=v2"],
        "limit": ["5"],
    }
    assert not page.locator("[data-xlb-mixed]").is_visible()
    assert page.locator("[data-xlb-find]").inner_text() == "Update best runs"

    # Back to any version: the next retrieval covers every version of the dataset.
    page.select_option("[data-xlb-scope-version]", "")
    page.click("[data-xlb-find]")
    page.wait_for_function("() => window.loads.length === 3")
    assert picker.rankings[-1] == {
        "dataset_id": ["ds-1"],
        "versioning": ["agent_version=v2"],
        "limit": ["5"],
    }
