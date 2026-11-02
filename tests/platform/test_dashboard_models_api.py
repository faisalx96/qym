"""Runs / Models dashboard reads over the real projection (API level).

Replaces the Chromium parts of the former ``test_dashboard_paging_browser.py`` and
``test_models_paging_browser.py`` that asserted *server* behaviour through the vanilla
dashboard: stable API order across pages, off-page totals and facets, pinned rows,
full-scope Models candidates (latest K by the run's timestamp, extra selected runs,
metric detection, version filters, the selector's config groups) and the points
pages behind the Charts page. How the React pages use them is covered in
frontend/e2e/runs-list (list-load, charts, cutover-models, cutover-selection).
"""

from __future__ import annotations

import pytest

from _support_a2 import make_runs, model_rows, projected_dashboard


@pytest.fixture(autouse=True)
def _sqlite(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite://")


def _runs(client, **body):
    body.setdefault("project_slug", "demo")
    response = client.post("/api/dashboard/runs", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _models(client, filters=None, k=5, selected=None):
    response = client.post(
        "/api/dashboard/models",
        json={"project_slug": "demo", "filters": filters or {}, "k": k, "selected": selected or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "sort", ["time-desc", "time-asc", "metric-accuracy-desc", "metric-accuracy-asc"]
)
def test_interleaved_runs_keep_one_api_order_across_pages(sort):
    """Runs sharing a task, model, timestamp or score still page without gaps or repeats."""
    rows = make_runs(63)
    timestamps = [row["timestamp"] for row in rows]
    for index, row in enumerate(rows):
        row.update(
            task_name=f"Task {index % 2}",
            model_name=f"Model {(index // 2) % 2}",
            dataset_version="v1",
            timestamp=timestamps[index // 2],
            metric_averages={"accuracy": ((index * 17) % 31) // 2 / 15},
        )
    with projected_dashboard(rows) as client:
        everything = [row["run_id"] for row in _runs(client, sort=sort, limit=500)["rows"]]
        paged = []
        for offset in (0, 50):
            page = _runs(client, sort=sort, limit=50, offset=offset)
            assert page["offset"] == offset
            paged.extend(row["run_id"] for row in page["rows"])
    assert len(everything) == len(set(everything)) == 63
    assert paged == everything


def test_first_page_keeps_global_totals_and_offpage_facets():
    rows = make_runs(123)
    for row in rows:
        row["dataset_version"] = "v1"
    with projected_dashboard(rows) as client:
        page = _runs(client, limit=50, include_overview=True)
    assert len(page["rows"]) == 50 and page["total_runs"] == 123 and page["has_more"] is True
    overview = page["overview"]
    assert overview["total_count"] == 123 and overview["total_runs"] == 123
    # Values that only occur beyond the first page are still offered as facets.
    assert "Rare task" in overview["facets"]["tasks"]
    assert "late-version" in overview["facets"]["versions"]


def test_pinned_rows_filters_sort_and_global_total_follow_the_selection():
    rows = make_runs(123)
    for row in rows:
        row["dataset_version"] = "v1"
    with projected_dashboard(rows) as client:
        # Picks from other pages arrive as pinned rows next to the page.
        page = _runs(client, limit=50, offset=100, ids=["run-000", "run-122"])
        assert len(page["rows"]) == 23
        assert [row["run_id"] for row in page["pinned_rows"]] == ["run-000", "run-122"]
        # Sorting by a metric is global; a filter narrows the total but not the global count.
        top = _runs(client, limit=50, sort="metric-accuracy-desc")["rows"][0]
        assert top["run_id"] == "run-122"
        rare = _runs(client, limit=50, filters={"tasks": ["Rare task"]}, include_overview=True)
        assert rare["total_runs"] == 23
        assert rare["overview"]["total_count"] == 123 and rare["overview"]["total_runs"] == 23
        # Selecting no value of a facet is a valid, empty view.
        empty = _runs(client, limit=50, filters={"tasks": ["__none__"]})
        assert empty["total_runs"] == 0 and empty["rows"] == []


def test_task_sort_orders_by_the_task_name():
    rows = make_runs(123)
    for row in rows:
        row["dataset_version"] = "v1"
    with projected_dashboard(rows) as client:
        first = _runs(client, limit=50, sort="task-desc")["rows"][0]
    assert first["task_name"] == "Rare task"


def test_points_pages_cover_one_task_and_dataset_in_full():
    rows = make_runs(650)
    for row in rows:
        row["task_name"] = "task"
        row["dataset_name"] = "Opened" if int(row["run_id"].split("-")[1]) < 600 else "Hidden"
        row["dataset_version"] = "v1"
    with projected_dashboard(rows) as client:
        def points(dataset, offset, limit=500):
            response = client.post(
                "/api/dashboard/points",
                json={"project_slug": "demo", "task": "task", "dataset": dataset, "limit": limit, "offset": offset},
            )
            assert response.status_code == 200, response.text
            return response.json()

        first = points("Opened", 0)
        second = points("Opened", 500)
        opened = [row["run_id"] for row in first["rows"] + second["rows"]]
        assert len(opened) == len(set(opened)) == 600
        assert first["has_more"] is True and second["has_more"] is False
        hidden = points("Hidden", 0)
        assert len(hidden["rows"]) == 50 and hidden["has_more"] is False


def test_models_candidates_are_the_latest_k_by_run_time_plus_the_selected_ones():
    rows = model_rows()
    with projected_dashboard(rows) as client:
        body = _models(client, k=5)
        by_model = {m["model_key"]: m for m in body["models"]}
        # alpha plain and alpha with reasoning tokens are separate models
        assert sorted(by_model) == ["alpha|||plain", "alpha|||reasoning", "beta|||plain"]
        assert all(m["total_runs"] == 60 for m in by_model.values())
        # newest by the run's own timestamp, not by when it was created
        assert [r["run_id"] for r in by_model["alpha|||plain"]["rows"]] == [f"m0-0{i}" for i in range(5)]
        assert body["scope"] == {"tasks": ["Task"], "datasets": ["Data␟v1"]}
        # a metric only an old run carries is still offered, with its kind detected
        assert body["metrics"] == ["accuracy", "count", "late_metric"]
        assert body["metric_summary"]["count"]["is_numeric"] is True
        assert body["metric_summary"]["late_metric"]["is_boolean"] is True
        # a version filter narrows every model's total and the candidates
        old = _models(client, filters={"versions": ["old"]}, k=5, selected={"alpha|||plain": ["m0-59"]})
        old_by_model = {m["model_key"]: m for m in old["models"]}
        assert all(m["total_runs"] == 10 for m in old_by_model.values())
        assert [r["run_id"] for r in old_by_model["alpha|||plain"]["rows"]] == [
            "m0-50", "m0-51", "m0-52", "m0-53", "m0-54", "m0-59",
        ]
        # a large K returns every run of every model
        assert [len(m["rows"]) for m in _models(client, k=100)["models"]] == [60, 60, 60]
        # nothing selected in a facet: no model
        assert _models(client, filters={"datasets": ["__none__"]})["models"] == []


def test_model_run_selector_pages_with_config_groups():
    rows = model_rows()
    with projected_dashboard(rows) as client:
        base = {"project_slug": "demo", "filters": {"models": ["alpha|||plain"]}, "sort": "time-desc", "limit": 20}
        first = _runs(client, **base, offset=0, include_config_groups=True)
        last = _runs(client, **base, offset=40, include_config_groups=True)
    assert first["total_runs"] == 60
    assert {g["key"]: g["total_runs"] for g in first["config_groups"]} == {"cold": 30, "warm": 30}
    assert len(first["tasks"]["Task"]["alpha"]) == 20
    assert len(last["tasks"]["Task"]["alpha"]) == 20
