"""Deleted Runs purge countdown and the run review history, in a real browser."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
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


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _trash_row(run_id: str, deleted_at: datetime, grace_days: int) -> dict:
    return {
        "id": run_id,
        "run_name": run_id,
        "task": "task",
        "dataset": "dataset",
        "model": "model",
        "status": "COMPLETED",
        "created_at": _iso(deleted_at - timedelta(days=1)),
        "deleted_at": _iso(deleted_at),
        "deleted_by_name": "Admin",
        "purge_at": (
            _iso(deleted_at + timedelta(days=grace_days)) if grace_days else None
        ),
    }


def _open_trash(browser, rows, grace_days, viewport=None):
    context = browser.new_context(**({"viewport": viewport} if viewport else {}))
    page = context.new_page()
    page.set_default_timeout(5000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def handle(route):
        url = route.request.url
        if url == "http://qym.test/trash":
            return route.fulfill(
                body=(STATIC / "trash.html").read_text(encoding="utf-8"),
                content_type="text/html",
            )
        if "/v1/me" in url:
            return route.fulfill(
                body=json.dumps(
                    {"id": "admin", "email": "admin@example.com", "role": "ADMIN"}
                ),
                content_type="application/json",
            )
        if "/api/runs/trash" in url:
            return route.fulfill(
                body=json.dumps(rows),
                content_type="application/json",
                headers={"X-Qym-Deleted-Run-Grace-Days": str(grace_days)},
            )
        name = url.split("/static/", 1)[-1].split("?", 1)[0]
        path = STATIC / name
        if "/static/" in url and path.is_file() and name not in {"auth.js", "shell.js"}:
            kind = "text/css" if name.endswith(".css") else "application/javascript"
            return route.fulfill(
                body=path.read_text(encoding="utf-8"), content_type=kind
            )
        return route.fulfill(body="", content_type="application/javascript")

    page.route("http://qym.test/**", handle)
    page.goto("http://qym.test/trash")
    return context, page, errors


def test_trash_lists_soonest_purge_first_and_flags_rows_near_purge(browser):
    now = datetime.now(timezone.utc)
    rows = [  # newest-deleted first, as the API returns them
        _trash_row("run-new", now - timedelta(days=1), 30),
        _trash_row("run-two-days", now - timedelta(days=27, hours=23), 30),
        _trash_row("run-hours", now - timedelta(days=29, hours=12), 30),
        _trash_row("run-overdue", now - timedelta(days=31), 30),
    ]
    context, page, errors = _open_trash(browser, rows, 30)
    try:
        page.locator(".trash-table tbody tr").nth(3).wait_for()
        assert page.locator("#trash-retention-copy").inner_text() == (
            "Deleted runs are permanently removed 30 days after deletion. "
            "Restore a run before its purge date to keep it."
        )
        assert page.locator("#trash-stat-retention").inner_text() == "30 days"
        order = page.eval_on_selector_all(
            ".trash-table tbody tr", "rows => rows.map(row => row.id)"
        )
        assert order == [
            "row-run-overdue",
            "row-run-hours",
            "row-run-two-days",
            "row-run-new",
        ]
        when = page.eval_on_selector_all(
            ".trash-table tbody tr .trash-purge-when",
            "cells => cells.map(cell => cell.textContent)",
        )
        assert when == ["Due now", "in under 1 day", "in 2 days", "in 28 days"]
        flagged = page.eval_on_selector_all(
            ".trash-table tbody tr.trash-row--purge-soon",
            "rows => rows.map(row => row.id)",
        )
        assert flagged == ["row-run-overdue", "row-run-hours", "row-run-two-days"]
        assert page.locator("#row-run-overdue .qym-tag--danger").count() == 1
        assert page.locator("#row-run-hours .qym-tag--warning").count() == 1
        assert page.locator("#row-run-new .qym-tag").count() == 0
        assert errors == []
    finally:
        context.close()


def test_trash_states_when_automatic_purge_is_off(browser):
    now = datetime.now(timezone.utc)
    context, page, errors = _open_trash(
        browser, [_trash_row("run-kept", now - timedelta(days=90), 0)], 0
    )
    try:
        page.locator("#row-run-kept").wait_for()
        assert page.locator("#trash-retention-copy").inner_text() == (
            "Automatic purge is off: deleted runs stay here until an admin restores them."
        )
        assert page.locator("#trash-stat-retention").inner_text() == "Off"
        assert "Not scheduled" in page.locator("#row-run-kept").inner_text()
        assert page.locator(".trash-row--purge-soon").count() == 0
        assert errors == []
    finally:
        context.close()


def test_trash_purge_column_keeps_restore_in_view_on_a_laptop_screen(browser):
    """The extra Purges column must not push Restore behind a horizontal scroll.

    1208px is the content width of a 1400px window once the shell sidebar
    (not loaded here) takes its share; the table fit there before the column.
    """
    now = datetime.now(timezone.utc)
    rows = []
    for index, (name, model) in enumerate(
        [
            ("chunk_512_overlap_64_hybrid_bm25", "openai/gpt-4o"),
            ("qwen2.5-72b_insightor_arabic_subset", "openai/gpt-4.1-mini"),
            ("hotfix_verify_tokenizer_whitespace_bug", "anthropic/claude-sonnet-5"),
        ]
    ):
        row = _trash_row(f"showcase-0{index}", now - timedelta(days=28 - index), 30)
        row.update(
            run_name=name,
            task="text2sql",
            model=model,
            dataset="text2sql-chart-showcase-v1",
            deleted_by_name="Faisal",
        )
        rows.append(row)
    context, page, errors = _open_trash(
        browser, rows, 30, viewport={"width": 1208, "height": 900}
    )
    try:
        page.locator(".trash-table tbody tr").nth(2).wait_for()
        overflow = page.evaluate(
            """() => {
              const wrap = document.querySelector('.trash-table-wrap');
              const edge = wrap.getBoundingClientRect().right;
              const buttons = [...document.querySelectorAll('.restore-btn')];
              return {
                scroll: wrap.scrollWidth - wrap.clientWidth,
                clipped: buttons.filter(b => b.getBoundingClientRect().right > edge).length,
              };
            }"""
        )
        assert overflow == {"scroll": 0, "clipped": 0}
        assert errors == []
    finally:
        context.close()


@pytest.fixture()
def history_page(browser):
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(5000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_content('<html><head></head><body><div id="host"></div></body></html>')
    page.add_script_tag(path=str(STATIC / "review_history.js"))
    yield page
    assert errors == []
    context.close()


def test_review_history_renders_every_transition_as_text(history_page):
    page = history_page
    events = [
        {
            "action": "submit",
            "to_status": "SUBMITTED",
            "actor": {"display_name": "Owner"},
            "comment": "",
            "at": "2026-09-20T10:00:00Z",
            "recorded": True,
        },
        {
            "action": "approve",
            "to_status": "APPROVED",
            "actor": {"display_name": "Maya"},
            "comment": "LGTM <img src=x onerror=window.pwned=1>",
            "at": "2026-09-20T11:00:00Z",
            "recorded": True,
        },
        {
            "action": "unapprove",
            "to_status": "FAILED",
            "actor": {"email": "lead@example.com"},
            "comment": "numbers were wrong",
            "at": "2026-09-21T09:30:00Z",
            "recorded": True,
        },
    ]
    page.evaluate(
        "events => QymReviewHistory.render(document.getElementById('host'), {events})",
        events,
    )

    entries = page.locator(".qym-review-history__entry")
    assert entries.count() == 3
    assert page.eval_on_selector_all(
        ".qym-review-history__entry .qym-tag",
        "tags => tags.map(tag => tag.textContent)",
    ) == ["Submitted", "Approved", "Approval withdrawn"]
    assert "Maya" in entries.nth(1).inner_text()
    assert "LGTM <img src=x onerror=window.pwned=1>" in entries.nth(1).inner_text()
    assert page.evaluate("window.pwned") is None
    assert page.locator(".qym-review-history img").count() == 0
    assert "returned the run to failed" in entries.nth(2).inner_text()
    assert "numbers were wrong" in entries.nth(2).inner_text()

    page.evaluate(
        "() => QymReviewHistory.render(document.getElementById('host'), {events: []})"
    )
    assert page.locator("#host").inner_html() == ""


def test_review_history_fetches_once_per_run_status(history_page):
    page = history_page
    page.evaluate("""() => {
      window.calls = [];
      window.fetch = url => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({events: [
          {action: 'submit', actor: null, comment: '', at: null, recorded: false}
        ]}), {status: 200, headers: {'content-type': 'application/json'}}));
      };
    }""")
    for status in ("APPROVED", "APPROVED", "COMPLETED"):
        page.evaluate(
            "status => QymReviewHistory.load(document.getElementById('host'), '/api/runs/r/review-history', status)",
            status,
        )
    page.locator(".qym-review-history__note").wait_for()
    assert page.evaluate("calls.length") == 2
    assert "Unknown user" in page.locator(".qym-review-history").inner_text()
