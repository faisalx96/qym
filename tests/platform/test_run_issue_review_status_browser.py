"""Run page Approve follows each issue's own review status (C042/C074 leftover).

Older data can have an issue whose JSON says pending while its correction is
approved or rejected. The server judges Approve by the correction (409 on a
decided one), so the run page reads the status the run payload names for each
issue (``review_issue_statuses``), not the JSON.
"""

import os

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_performance_views_browser import ViewFixture  # noqa: E402

pytestmark = pytest.mark.browser


def test_issue_approve_follows_the_review_status_not_the_issue_json(browser):
    fixture = ViewFixture(browser, "run", count=20)
    row = fixture.data["run-1"]["snapshot"]["rows"][0]
    row["item_metadata"] = {
        **(row.get("item_metadata") or {}),
        "metric_analyses": {
            "accuracy": {
                "review_status": "pending",
                "root_cause_issues": [
                    {"issue_id": "i1", "category": "Retrieval", "finding": "Missed a document", "review_status": "pending"},
                    {"issue_id": "i2", "category": "Prompt", "finding": "Asked twice", "review_status": "pending"},
                    {"issue_id": "i3", "category": "Format", "finding": "No JSON", "review_status": "pending"},
                ],
            }
        },
    }
    row["review_issue_statuses"] = {
        "accuracy": [
            {"issue_id": "i1", "status": "approved"},
            {"issue_id": "i2", "status": "rejected"},
            {"issue_id": "i3", "status": "pending"},
        ]
    }
    try:
        fixture.goto()
        fixture.page.locator("#items-grid .item-header-expand").first.click()
        issues = fixture.page.locator("#items-grid .metric-analysis-issue")
        issues.first.wait_for()
        assert issues.count() == 3
        pills = [issues.nth(n).locator(".rc-status-pill").inner_text() for n in range(3)]
        assert pills == ["Approved", "Rejected", "Pending review"]
        approve = [issues.nth(n).locator("[data-approve-issue]").count() for n in range(3)]
        assert approve == [0, 0, 1]
        assert fixture.errors == []
    finally:
        fixture.close()
