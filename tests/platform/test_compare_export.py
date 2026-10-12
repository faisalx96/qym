"""The compare HTML export carries what the Compare page shows (comparison tab, summary cells)."""

from __future__ import annotations

import math
import re

import pytest

from qym_platform.services.compare_export import (
    build_comparison,
    render_comparison_html,
    t_critical,
    t_two_sided_p,
)
from qym_platform.services import html_export


def _payload(name, scores, *, status="RunWorkflowStatus.COMPLETED", errors=0, total=None, direction="maximize"):
    rows = [
        {
            "item_id": f"i{n}",
            "input_preview": f"question {n}",
            "status": "completed",
            "latency_ms": 100 + n,
            "metric_values": [s],
        }
        for n, s in enumerate(scores)
    ]
    return {
        "run": {
            "run_id": name,
            "run_name": name,
            "status": status,
            "dataset_name": "ds",
            "dataset_version": 3,
            "model_name": "m",
            "error_count": errors,
            "execution_error_count": 1,
            "duration_ms": 65000,
            "owner": {"display_name": "Ada"},
            "experiment": {"id": "e1", "name": "Exp one"},
            "metric_names": ["quality"],
            "metric_specs": {"quality": {"direction": direction, "schema_version": 2, "score_type": "percentage"}},
        },
        "snapshot": {
            "rows": rows,
            "metric_names": ["quality"],
            "stats": {"total": total or len(rows)},
        },
    }


def test_t_distribution_matches_scipy_reference_values():
    assert t_critical(3) == pytest.approx(3.1824, abs=1e-3)
    assert t_critical(1000) == pytest.approx(1.9623, abs=1e-3)
    assert t_two_sided_p(2.0, 10) == pytest.approx(0.0734, abs=1e-3)
    assert math.isfinite(t_two_sided_p(0.0, 5))


def test_comparison_has_averages_deltas_strip_and_item_diff():
    base = _payload("base", [0.2, 0.4, 0.6, 0.5, 0.3])
    better = _payload("better", [0.6, 0.8, 0.9, 0.7, 0.8])
    cmp = build_comparison([base, better])
    cells = cmp["per_metric"]["quality"]
    assert cells[0]["mean"] == pytest.approx(0.4)
    assert cells[1]["mean"] == pytest.approx(0.76)
    delta = cells[1]["delta"]
    assert delta["mean"] == pytest.approx(0.36)
    assert delta["counts"] == {"improved": 5, "regressed": 0, "same": 0}
    assert delta["verdict"] == "improved"
    assert delta["half_width"] is not None and delta["p"] < 0.05
    strip = cmp["strip"]
    assert strip["wins"] == [0, 5] and strip["ties"] == 0 and strip["items"] == 5
    assert [r["moves"][1] for r in cmp["items"]] == ["improved"] * 5

    html = render_comparison_html(cmp)
    assert "Per-run averages" in html and "Winner strip" in html
    assert 'data-verdict="improved"' in html
    assert "+36.0 pts" in html
    assert html.count("<tr data-item=") == 5


def test_minimize_metric_flips_the_verdict():
    cmp = build_comparison([_payload("a", [0.5, 0.6, 0.4, 0.7, 0.5, 0.6], direction="minimize"), _payload("b", [0.1, 0.2, 0.3, 0.2, 0.1, 0.2], direction="minimize")])
    assert cmp["per_metric"]["quality"][1]["delta"]["verdict"] == "improved"


def test_export_summary_cells_are_readable():
    a = _payload("run-a", [0.5] * 40, errors=2, total=40)
    b = _payload("run-b", [0.7] * 40, status="RUNNING", errors=0, total=40)
    page = html_export.build_compare_export_html([a, b])
    text = re.sub(r"<[^>]+>", " ", page.split('id="comparison"', 1)[1].split("<iframe", 1)[0])
    text = re.sub(r"\s+", " ", text)
    assert "RunWorkflowStatus" not in text
    assert "COMPLETED" in text and "RUNNING" in text
    # Items = the snapshot total (not "-"), Errors = task + scorer errors like the page.
    assert re.search(r"run-a\s+COMPLETED\s+Ada\s+ds v3\s+m\s+40\s+3\b", text)
    assert "Exp one" in text and "1m 5s" in text
    # One tab for the comparison plus one per run; the panels are all present.
    assert page.count('role="tab"') == 3
    assert page.count('role="tabpanel"') == 3
    assert "prefers-color-scheme: light" not in page


def test_runs_without_a_shared_item_still_render():
    a = _payload("a", [0.5])
    b = _payload("b", [])
    html = html_export.build_compare_export_html([a, b])
    assert "Per-run averages" in html
