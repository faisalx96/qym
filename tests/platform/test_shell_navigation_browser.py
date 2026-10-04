"""In-app navigation to pages with relative asset URLs (Compare, Deleted Runs).

compare.html and trash.html load ``./static/...``. shell.js used to resolve
those against the page being left, so from a nested route every script 404ed
and the shell fell back to a full reload.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)

pytestmark = pytest.mark.browser


@pytest.fixture(scope="module")
def browser():
    api = pytest.importorskip("playwright.sync_api")
    with api.sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


def test_shell_navigation_to_trash_from_a_nested_route_stays_in_app(browser):
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(10000)
    missing = []

    def handle(route):
        url = route.request.url
        path = url.split("http://qym.test", 1)[-1].split("?", 1)[0]
        if path == "/projects/demo/settings":
            return route.fulfill(
                body=(STATIC / "profile.html").read_text(encoding="utf-8"),
                content_type="text/html",
            )
        if path == "/trash":
            return route.fulfill(
                body=(STATIC / "trash.html").read_text(encoding="utf-8"),
                content_type="text/html",
            )
        if path == "/v1/me":
            return route.fulfill(
                body=json.dumps(
                    {
                        "id": "admin",
                        "email": "admin@example.com",
                        "role": "ADMIN",
                        "projects": [
                            {"id": "p", "slug": "demo", "name": "Demo", "role": "ADMIN"}
                        ],
                    }
                ),
                content_type="application/json",
            )
        if path == "/api/runs/trash":
            return route.fulfill(
                body="[]",
                content_type="application/json",
                headers={"X-Qym-Deleted-Run-Grace-Days": "30"},
            )
        if "/static/" in path:
            name = path.split("/static/", 1)[1]
            file = STATIC / name
            if path.startswith("/static/") and file.is_file():
                return route.fulfill(path=str(file))
            missing.append(path)
            return route.fulfill(status=404, body="")
        return route.fulfill(body="{}", content_type="application/json")

    page.route("http://qym.test/**", handle)
    try:
        page.goto("http://qym.test/projects/demo/settings")
        page.wait_for_function("() => Boolean(window.QymShell && window.QymShell.getUser())")
        page.evaluate("window.__stayedInApp = true")
        page.evaluate("QymShell.navigateTo('/trash')")
        page.wait_for_function("() => document.title.includes('Deleted Runs')")
        page.locator("#trash-retention-copy").wait_for()
        assert page.evaluate("window.__stayedInApp === true"), "fell back to a full reload"
        assert missing == []
    finally:
        context.close()
