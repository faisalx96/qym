"""Why an item failed (C065): the reasons endpoint and the run export carrying the run page's own scripts.

The reason order (task error -> scorer error -> reason -> explanation -> label) lives in the React
run page: frontend/src/features/run-detail/lib/__tests__/cutover-item-reasons.test.ts.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from qym_platform.services.run_payloads import (
    REASON_TEXT_LIMIT,
    compact_row,
    reason_fields,
    reason_request,
)


def test_reason_fields_keep_only_bounded_reason_text():
    meta = {
        "reason": "r" * (REASON_TEXT_LIMIT + 50),
        "error": {"code": 429},
        "status": "error",
        "explanation": "",
        "label": True,
        "gold_results": [[1, 2]],
        "comparison": {"error": "Result Error"},
    }
    fields = reason_fields(meta)
    assert set(fields) == {"reason", "error", "status", "label"}
    assert len(fields["reason"]) == REASON_TEXT_LIMIT
    assert fields["error"] == '{"code": 429}'
    assert fields["label"] == "true"
    assert reason_fields(None) == {} and reason_fields(["x"]) == {}


def test_the_index_drops_what_the_reasons_endpoint_serves():
    row = {
        "item_id": "a",
        "metric_meta": {
            "m": {"reason": "x" * 300, "explanation": "why", "label": "bad"}
        },
    }
    compact = compact_row(row)["metric_meta"]["m"]
    assert "reason" not in compact and "explanation" not in compact
    assert compact["label"] == "bad"


@pytest.mark.parametrize(
    "body, message",
    [
        ({"metric": "m"}, "item_ids"),
        ({"item_ids": ["a"]}, "metric"),
        ({"item_ids": ["a"], "metric": ""}, "metric"),
        ({"item_ids": ["a"], "metric": "m", "pass_number": 0}, "pass_number"),
        ({"item_ids": ["a"], "metric": "m", "pass_number": True}, "pass_number"),
        ({"item_ids": ["a"] * 2, "metric": "m", "pass_number": "2"}, "pass_number"),
    ],
)
def test_reason_requests_are_validated(body, message):
    with pytest.raises(HTTPException) as error:
        reason_request(body)
    assert error.value.status_code == 422
    assert message in error.value.detail


def test_reasons_endpoint_serves_run_and_pass_reasons():
    from _support_a2 import source_run_api

    with source_run_api(count=4) as client:
        response = client.post(
            "/api/runs/run-1/items/reasons",
            json={
                "item_ids": ["item-0", "item-2", "missing"],
                "metric": "accuracy",
                "pass_number": 2,
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["pass_number"] == 2
        assert data["reasons"] == {
            "item-0": {"explanation": "pass-2 judge 0"},
            "item-2": {"explanation": "pass-2 judge 2"},
        }
        response = client.post(
            "/api/runs/run-1/items/reasons",
            json={"item_ids": ["item-1"], "metric": "count"},
        )
        assert response.status_code == 200, response.text
        assert set(response.json()["reasons"]) == {"item-1"}
        assert (
            client.post(
                "/api/runs/nope/items/reasons", json={"item_ids": ["a"], "metric": "m"}
            ).status_code
            == 404
        )
        assert (
            client.post(
                "/api/runs/run-1/items/reasons", json={"item_ids": [], "metric": "m"}
            ).status_code
            == 422
        )


def test_run_export_keeps_the_run_page_scripts_inline():
    from _support_a2 import source_run_api

    with source_run_api(count=2) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    html = response.text
    assert "window.QymItemReasons = {" in html
    assert "window.QymRunSectionNav = { create: create };" in html
    assert "/static/item_reasons.js" not in html
    assert "/static/run_section_nav.js" not in html


def test_run_export_inlines_the_json_viewer():
    """The offline export keeps the shared JSON viewer (run metadata that holds JSON opens in it)."""
    from _support_a2 import source_run_api

    with source_run_api(count=2) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    html = response.text
    assert "window.QymJsonViewer = {" in html
    assert ".qjv-tree {" in html
    assert "/static/json_viewer.js" not in html
    assert "/static/json_viewer.css" not in html
