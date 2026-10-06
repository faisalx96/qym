"""Experiments list: one versioning select per versioning_metadata key."""

from __future__ import annotations

import mimetypes
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest


STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)
pytestmark = pytest.mark.browser

EXPERIMENTS = [
    ("Nightly", {"agent_version": "v1", "kb_version": "381"}),
    ("Prompt sweep", {"agent_version": "v2", "kb_version": "400"}),
]


def experiment(name):
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "status": "COMPLETED",
        "environment_ids": [],
        "base_source": None,
        "job_counts": {"SUCCEEDED": 1},
        "created_by_email": "owner@example.test",
        "created_at": "2026-10-01T10:00:00Z",
    }


class ExperimentsFixture:
    def __init__(self, browser):
        self.requests = []
        self.errors = []
        self.context = browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        query = parse_qs(url.query)
        if url.path.startswith("/static/"):
            file = STATIC / url.path.split("/static/", 1)[1]
            if file.is_file():
                route.fulfill(
                    path=str(file),
                    content_type=mimetypes.guess_type(file.name)[0]
                    or "application/octet-stream",
                )
            else:
                route.fulfill(status=404, body="")
            return
        if url.path == "/v1/me":
            route.fulfill(json={"id": "owner", "role": "ADMIN"})
        elif url.path == "/v1/projects/by-slug/demo":
            route.fulfill(json={"id": "p", "slug": "demo", "name": "Demo"})
        elif url.path == "/v1/projects/p/eval-environments":
            route.fulfill(json={"environments": []})
        elif url.path == "/v1/projects/p/experiments":
            self.requests.append(query)
            wanted = dict(entry.split("=", 1) for entry in query.get("versioning", []))
            rows = [
                experiment(name)
                for name, versioning in EXPERIMENTS
                if all(versioning.get(k) == v for k, v in wanted.items())
            ]
            body = {"experiments": rows, "total": len(rows), "limit": 25, "offset": 0}
            if query.get("include_versioning_facets") == ["true"]:
                body["versioning_facets"] = {
                    "agent_version": ["v2", "v1"],
                    "kb_version": ["400", "381"],
                }
            route.fulfill(json=body)
        elif url.path == "/projects/demo/experiments":
            source = (STATIC / "experiments.html").read_text()
            source = re.sub(
                r'<script src="/static/(?:auth|shell)\.js[^\"]*"></script>', "", source
            )
            route.fulfill(body=source, content_type="text/html")
        else:
            route.fulfill(status=404, json={"error": url.path})


def names(page):
    return page.locator("[data-experiment-id] .exp-name").all_inner_texts()


def test_versioning_selects_filter_experiments_and_sync_url(browser):  # noqa: F811
    view = ExperimentsFixture(browser)
    page = view.page
    try:
        page.goto("https://qym.test/projects/demo/experiments")
        page.wait_for_selector("[data-experiment-id]")
        assert sorted(names(page)) == ["Nightly", "Prompt sweep"]
        selects = page.locator("select[data-exp-versioning]")
        assert selects.evaluate_all(
            "nodes => nodes.map(n => [n.dataset.expVersioning, n.options[0].text])"
        ) == [
            ["agent_version", "All agent versions"],
            ["kb_version", "All KB versions"],
        ]

        page.select_option('select[data-exp-versioning="kb_version"]', "381")
        page.wait_for_function(
            "() => document.querySelectorAll('[data-experiment-id]').length === 1"
        )
        assert names(page) == ["Nightly"]
        assert view.requests[-1]["versioning"] == ["kb_version=381"]
        assert "versioning=kb_version%3D381" in page.url

        # Reloading restores the selection from the URL.
        page.reload()
        page.wait_for_selector("[data-experiment-id]")
        assert names(page) == ["Nightly"]
        assert (
            page.locator('select[data-exp-versioning="kb_version"]').input_value()
            == "381"
        )

        page.select_option('select[data-exp-versioning="kb_version"]', "")
        page.wait_for_function(
            "() => document.querySelectorAll('[data-experiment-id]').length === 2"
        )
        assert "versioning" not in view.requests[-1]
        assert view.errors == []
    finally:
        view.context.close()
