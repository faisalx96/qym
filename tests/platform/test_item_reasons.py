"""Why an item failed (C065): the reason order, the reasons endpoint, and the
run export carrying the run page's own scripts."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException

from qym_platform.services.run_payloads import (
    REASON_TEXT_LIMIT,
    compact_row,
    reason_fields,
    reason_request,
)

DASHBOARD = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "platform"
    / "qym_platform"
    / "_static"
    / "dashboard"
)


def run_reasons(cases):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required")
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const api = ctx.window.QymItemReasons;
const cases = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(cases.map(c => c.keys
  ? api.needsServerReason(api.pick(c.input), c.keys)
  : api.pick(c.input))));
"""
    result = subprocess.run(
        [node, "-e", script, str(DASHBOARD / "item_reasons.js"), json.dumps(cases)],
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_the_first_reason_that_exists_wins_in_the_documented_order():
    full = {
        "status": "timeout",
        "error": "judge timed out",
        "reason": "rows differ",
        "explanation": "long judge text",
        "label": "mismatch",
    }
    cases = [
        {"input": {"taskError": "boom", "meta": full}},
        {"input": {"taskError": True, "meta": {}}},
        {"input": {"meta": full}},
        {"input": {"meta": {"status": "failed"}}},
        {"input": {"scorerError": "Scorer failed in 2 of 3 passes: 429", "meta": {}}},
        {"input": {"meta": {k: v for k, v in full.items() if k not in ("status",)}}},
        {
            "input": {
                "meta": {"error": "Empty output", "explanation": "x", "label": "y"}
            }
        },
        {
            "input": {
                "meta": {
                    "explanation": "long judge text",
                    "label": "y",
                    "comparison": {"error": "Result Error"},
                }
            }
        },
        {
            "input": {
                "meta": {"label": "mismatch", "comparison": {"error": "Result Error"}}
            }
        },
        {
            "input": {
                "meta": {"comparison": {"error": "Result Error"}},
                "score": "False",
                "need": "True",
            }
        },
        {
            "input": {
                "meta": {"status": "ok", "reason": "  "},
                "score": "42.0%",
                "need": "≥80%",
            }
        },
    ]
    picked = run_reasons(cases)
    assert [(p["text"], p["source"]) for p in picked] == [
        ("boom", "task error"),
        ("Task execution failed", "task error"),
        ("judge timed out", "scorer error"),
        ("The scorer ended with status failed", "scorer error"),
        ("Scorer failed in 2 of 3 passes: 429", "scorer error"),
        ("rows differ", "reason"),
        ("Empty output", "reason"),
        ("long judge text", "explanation"),
        ("mismatch", "label"),
        # Custom keys (comparison.error) are never parsed.
        ("Scored False, pass needs True", "no reason recorded"),
        ("Scored 42.0%, pass needs ≥80%", "no reason recorded"),
    ]


def test_rows_ask_the_server_only_when_the_index_may_hide_a_better_reason():
    keys = ["reason", "explanation", "label"]
    cases = [
        {"input": {"taskError": "boom"}, "keys": keys},
        {"input": {"meta": {"status": "error"}}, "keys": keys},
        {"input": {"meta": {"reason": "short"}}, "keys": keys},
        # meta.reason outranks a verdict stored under error.
        {"input": {"meta": {"error": "Empty output"}}, "keys": keys},
        {"input": {"meta": {"error": "Empty output"}}, "keys": ["explanation"]},
        {"input": {"meta": {"label": "x"}}, "keys": ["explanation"]},
        {"input": {"meta": {}}, "keys": ["label"]},
        {"input": {"meta": {}}, "keys": []},
    ]
    assert run_reasons(cases) == [False, False, False, True, False, True, False, False]


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
    from test_performance_views_browser import source_run_api

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
    from test_performance_views_browser import source_run_api

    with source_run_api(count=2) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    html = response.text
    assert "window.QymItemReasons = {" in html
    assert "window.QymRunSectionNav = { create: create };" in html
    assert "/static/item_reasons.js" not in html
    assert "/static/run_section_nav.js" not in html
