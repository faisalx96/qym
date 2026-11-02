"""Run and Compare data contracts behind the items table (API level).

Replaces the Chromium parts of the former ``test_performance_views_browser.py``
that asserted *server* behaviour through the vanilla pages: bodies, search and
edits of off-page items of repeat runs, per-pass root-cause issues, the metric
field schema that a compact index omits, and the self-contained Compare export.
How the React pages use these endpoints is covered in frontend/e2e/run-detail
and frontend/e2e/compare.
"""

from __future__ import annotations

import json
import re

import pytest

from _support_a2 import source_run_api

COUNT = 61


@pytest.fixture(autouse=True)
def _sqlite(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite://")


def _details(client, run_id, item_ids):
    response = client.post(f"/api/runs/{run_id}/items/details", json={"item_ids": item_ids})
    assert response.status_code == 200, response.text
    return {row["item_id"]: row for row in response.json()["rows"]}


def test_offpage_item_bodies_of_every_pass_come_from_one_details_call():
    with source_run_api(count=COUNT) as client:
        row = _details(client, "run-1", [f"item-{COUNT - 1}"])[f"item-{COUNT - 1}"]
    assert row["__details_loaded"] is True
    attempts = {attempt["pass_number"]: attempt for attempt in row["pass_attempts"]}
    assert sorted(attempts) == [1, 2, 3]
    # The late-only field is a structured JSON output of pass 2 only.
    assert json.loads(attempts[2]["output"]) == {"late_only_field": "last", "answer": "pass-2 output 60"}
    assert attempts[3]["output"] == "pass-3 output 60"
    explanations = [meta["explanation"] for meta in row["pass_metric_meta"]["accuracy"]]
    assert explanations == [f"pass-{p} judge 60" for p in (1, 2, 3)]


def test_search_pass_columns_in_one_request_and_off_page_matches():
    with source_run_api(count=COUNT) as client:
        for run_id in ("run-1", "run-2"):
            response = client.post(
                f"/api/runs/{run_id}/items/search",
                json={
                    "conditions": [{"id": "c1", "field": "output", "value": "pass-2 output 60"}],
                    "pass_numbers": [1, 2, 3],
                },
            )
            assert response.status_code == 200, response.text
            by_pass = response.json()["matches_by_pass"]
            # Only pass 2 holds that text; one request answers all three passes.
            assert by_pass == {"1": {"c1": []}, "2": {"c1": ["item-60"]}, "3": {"c1": []}}
        # A single pass_number keeps the legacy shape.
        one = client.post(
            "/api/runs/run-1/items/search",
            json={"conditions": [{"id": "c1", "field": "output", "value": "pass-2 output 60"}], "pass_number": 2},
        ).json()
        assert one["matches"]["c1"] == ["item-60"]
        # The compare snapshot of both runs loads from the same sources.
        compare = client.get(
            "/api/compare",
            params=[("files", "run-1"), ("files", "run-2"), ("view", "compact")],
        )
        assert compare.status_code == 200
        assert [run["run"]["run_id"] for run in compare.json()["runs"]] == ["run-1", "run-2"]


def test_pass_score_edit_reaches_the_pass_and_the_reduced_run_score():
    with source_run_api(count=COUNT) as client:
        # accuracy is boolean, so the numeric `count` metric takes 0.25 (score
        # edits are validated by type, C009).
        before = client.get("/api/runs/run-1").json()["snapshot"]["rows"][60]
        response = client.post(
            "/api/runs/update_metric",
            json={
                "file_path": "run-1",
                "row_index": 60,
                "metric_name": "count",
                "new_score": 0.25,
                "pass_number": 2,
            },
        )
        assert response.status_code == 200, response.text
        edited = client.get("/api/runs/run-1").json()["snapshot"]["rows"][60]
    assert 0.25 in edited["pass_scores"]["count"]
    assert edited["pass_scores"]["count"][1] == 0.25 and before["pass_scores"]["count"][1] != 0.25
    # The run-level score is re-reduced as the mean over the passes.
    assert edited["metric_values"][1] == pytest.approx(sum(edited["pass_scores"]["count"]) / 3)
    assert str(edited["metric_meta"]["count"]["modified"]).lower() == "true"


def test_issue_records_stay_per_pass_and_a_single_edit_keeps_the_others():
    with source_run_api(count=COUNT, seed_issues=True) as client:
        row = _details(client, "run-1", ["item-60"])["item-60"]
        analyses = analyses_before = row["pass_metric_analyses"]["accuracy"]
        findings = [[i["finding"] for i in a["root_cause_issues"]] for a in analyses]
        assert findings == [
            ["pass-1 first finding 60"],
            ["pass-2 first finding 60", "pass-2 second finding 60"],
            ["pass-3 first finding 60"],
        ]
        response = client.post(
            "/api/runs/update_root_cause_issue",
            json={
                "run_id": "run-1",
                "item_id": "item-60",
                "metric_name": "accuracy",
                "pass_number": 2,
                "action": "edit",
                "issue_index": 1,
                "expected_issue": analyses_before[1]["root_cause_issues"][1],
                "issue": {
                    "category": "Reasoning Error",
                    "subcategory": "Second mechanism",
                    "finding": "Reviewed second issue",
                },
            },
        )
        assert response.status_code == 200, response.text
        updated = client.get("/api/runs/run-1").json()["snapshot"]["rows"][60]
    analyses = updated["pass_metric_analyses"]["accuracy"]
    assert analyses[1]["root_cause_issues"][1]["finding"] == "Reviewed second issue"
    assert analyses[1]["root_cause_issues"][0]["finding"] == "pass-2 first finding 60"
    assert analyses[0]["root_cause_issues"][0]["finding"] == "pass-1 first finding 60"
    assert analyses[2]["root_cause_issues"][0]["finding"] == "pass-3 first finding 60"


def test_compare_issue_update_rewrites_only_the_chosen_pass():
    """The Compare editor saves a pass's whole issue list (update_root_cause)."""
    with source_run_api(count=COUNT, seed_issues=True) as client:
        issues = [
            {"category": "Reasoning Error", "subcategory": "First mechanism", "finding": "pass-2 first finding 60"},
            {"category": "Reasoning Error", "subcategory": "Second mechanism", "finding": "Reviewed second issue"},
        ]
        response = client.post(
            "/api/runs/update_root_cause",
            json={
                "run_id": "run-1",
                "item_id": "item-60",
                "metric_name": "accuracy",
                "pass_number": 2,
                "root_cause_issues": issues,
            },
        )
        assert response.status_code == 200, response.text
        updated = _details(client, "run-1", ["item-60"])["item-60"]["pass_metric_analyses"]["accuracy"]
    assert [i["finding"] for i in updated[1]["root_cause_issues"]] == [
        "pass-2 first finding 60",
        "Reviewed second issue",
    ]
    assert [i["finding"] for i in updated[0]["root_cause_issues"]] == ["pass-1 first finding 60"]
    assert [i["finding"] for i in updated[2]["root_cause_issues"]] == ["pass-3 first finding 60"]


def _meta(kind, run_id, index, metric, pass_number):
    if metric != "accuracy":
        return {}
    if kind == "score" and index == 3:
        return {"llm_result": {"verdict": "x" * 5000}}
    if kind == "pass" and index == 3 and pass_number == 1:
        return {"status": "error", "error": "judge timeout"}
    if kind == "pass" and index == 4 and pass_number == 1:
        return {"llm_result": {"verdict": "x" * 5000}}
    return {}


def test_compact_index_omits_judge_payloads_but_lists_their_keys():
    with source_run_api(count=12, meta_hook=_meta) as client:
        snapshot = client.get("/api/runs/run-1", params={"view": "compact"}).json()["snapshot"]
    # The big payload stays out of the index row ...
    assert snapshot["detail_mode"] == "lazy"
    assert snapshot["rows"][4]["pass_metric_meta"]["accuracy"] == [{}, {}, {}]
    # ... yet the metric-field chooser still offers its key.
    assert {"explanation", "llm_result", "error", "status"} <= set(snapshot["pass_metric_meta_keys"]["accuracy"])
    # The full row of that item still carries it (details call).
    with source_run_api(count=12, meta_hook=_meta) as client:
        row = _details(client, "run-1", ["item-4"])["item-4"]
    assert "llm_result" in row["pass_metric_meta"]["accuracy"][0]


def test_single_pass_field_schema_lists_only_that_pass_keys():
    """A pass view offers the fields of that pass: an error flag or judge
    payload seen only in another pass is not offered."""
    with source_run_api(count=12, meta_hook=_meta) as client:
        snapshot = client.get("/api/runs/run-1", params={"view": "compact"}).json()["snapshot"]
    by_pass = snapshot["pass_metric_meta_keys_by_pass"]
    assert set(by_pass["2"]) == {"explanation"}
    assert {"error", "status", "llm_result"} <= set(by_pass["1"])
    assert set(by_pass["3"]) == {"explanation"}


def test_compare_export_is_self_contained_and_carries_every_body():
    with source_run_api(count=COUNT) as client:
        response = client.get(
            "/api/compare/export-html", params=[("files", "run-1"), ("files", "run-2")]
        )
    assert response.status_code == 200, response.text
    exported = response.text
    assert "needle-60" in exported
    assert "pass-2 judge 60" in exported
    # Nothing is fetched at open time: scripts and styles are inline.
    assert not re.search(r"<script\s+src=", exported)
    assert not re.search(r'<link\s+rel="stylesheet"\s+href=', exported)
    assert not re.search(r'(?:href|src)="[^"]*/static/', exported)


@pytest.mark.parametrize("mode", ["single", "bulk"])
def test_pass_delete_confirmed_after_renumbering_is_refused(mode):
    """A confirmation holds the pass version it was opened on: when another delete renumbered
    the passes meanwhile, the stale one is a 409 and removes nothing."""
    with source_run_api(count=2) as client:
        assert client.delete("/api/runs/run-1/passes/1").status_code == 200  # "elsewhere"
        if mode == "single":
            stale = client.delete("/api/runs/run-1/passes/2", params={"expected_pass_version": 0})
        else:
            stale = client.request(
                "DELETE",
                "/api/runs/run-1/passes",
                json={"pass_numbers": [2], "expected_pass_version": 0},
            )
        assert stale.status_code == 409, stale.text
        assert client.get("/api/runs/run-1").json()["run"]["samples"] == 2
        # The same request with the version the reader now sees goes through.
        current = client.get("/api/runs/run-1").json()["run"]["metadata"].get("pass_revision", 0)
        assert current == 1
        ok = client.delete("/api/runs/run-1/passes/2", params={"expected_pass_version": current})
        assert ok.status_code == 200, ok.text
